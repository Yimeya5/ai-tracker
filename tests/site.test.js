const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const R = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");
// Until the daily Action has run v6 once, data/data.json has no "agents" part: the Agents-tab tests then use
// tests/fixtures/agents_sample.json (built by v6 from the real pages saved on 2026-11-02).
const AGENTS_SAMPLE = () => JSON.parse(read("tests/fixtures/agents_sample.json"));
const data = () => { const d = JSON.parse(read("data/data.json")); if (!d.agents) d.agents = AGENTS_SAMPLE(); return d; };

function loadApp(d) {
  const ctx = { AI_DATA: d || data() };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("app.js"), ctx);
  return ctx.AITracker;
}

test("page has title, viewport, manifest and local assets only", () => {
  const h = read("index.html");
  assert.match(h, /<title>AI Tracker/);
  assert.match(h, /name="viewport"[^>]*width=device-width/);
  assert.match(h, /rel="manifest" href="manifest.webmanifest"/);
  for (const m of h.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:/.test(m[1])) assert.fail("remote asset " + m[1]);
    assert.ok(fs.existsSync(path.join(R, m[1])), "missing " + m[1]);
  }
});

test("manifest is installable", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.sizes === "512x512"));
  assert.ok(m.icons.some((i) => i.sizes === "192x192"));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(R, i.src)));
});

test("service worker: new version, data from the network first", () => {
  const s = read("sw.js");
  assert.match(s, /const VERSION = "v7b-2026-11-02"/);
  assert.match(s, /\/data\//);
  assert.match(s, /fetch\(req, \{ cache: "no-store" \}\)/);
});

test("workflow runs daily, passes the AA key only to the data step, checks the new data shape", () => {
  const w = read(".github/workflows/update.yml");
  assert.match(w, /cron: "0 10 \* \* \*"/);
  assert.match(w, /deploy-pages/);
  assert.match(w, /git diff --cached --quiet/);
  assert.match(w, /AA_API_KEY: \$\{\{ secrets\.AA_API_KEY \}\}/);
  assert.match(w, /AA_ENABLED: \$\{\{ vars\.AA_ENABLED \}\}/);
  assert.match(w, /d\.get\("v"\) == 3/);
  assert.match(w, /rm -f _site\/data\/history\.json _site\/data\/raw\.json/);
});

test("exactly 5 tabs (short labels on a phone), a Sources view, no tables, no leftovers", () => {
  const h = read("index.html");
  const nav = [...h.matchAll(/<nav[\s\S]*?<\/nav>/g)][0][0];
  const tabs = nav.match(/data-tab="([^"]+)"/g).map((s) => s.slice(10, -1));
  assert.deepStrictEqual(tabs, ["best", "cost", "releases", "news", "agents"]);
  assert.match(h, />Best for what</); assert.match(h, />Cost</); assert.match(h, />New releases</); assert.match(h, />Big news</); assert.match(h, />Agents</);
  for (const short of ["Best", "Cost", "New", "News", "Agents"]) assert.match(nav, new RegExp('class="short" aria-hidden="true">' + short + "<"));
  assert.match(nav, /🤖/);
  const css = read("app.css");
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.tabs \.long\{display:none\}/);
  assert.match(h, /data-tab="sources"/);
  const all = h + read("app.js") + read("app.css");
  assert.doesNotMatch(all, /<table|<th\b|<td\b/);
  assert.doesNotMatch(h + read("app.js"), /lorem ipsum|TODO|\[PLACEHOLDER\]|undefined</);
});

test("no secrets in the app or data", () => {
  const blob = read("app.js") + read("index.html") + read("data/data.json") + read("data/data.js");
  assert.doesNotMatch(blob, /x-api-key|api_key|AA_API_KEY=/i);
});

test("data file has the new shape", () => {
  const d = data();
  assert.equal(d.v, 3);
  for (const k of ["status", "sources", "picks", "cost", "releases", "bignews", "rule"]) assert.ok(d[k], "missing " + k);
  assert.equal(typeof d.aaEnabled, "boolean");
  const ids = ["lmarena", "livebench", "epoch", "openrouter", "official", "prices", "news"].concat(d.aaEnabled ? ["aa"] : [])
    .concat(JSON.parse(read("data/data.json")).agents ? ["agentapps"] : []);
  for (const s of ids) {
    assert.ok(d.status[s], "no status for " + s);
    assert.ok(d.sources.some((x) => x.id === s), "no source entry for " + s);
  }
  assert.equal(d.ruleInfo.textSources, d.aaEnabled ? 4 : 3);
  assert.equal(d.ruleInfo.picSources, d.aaEnabled ? 2 : 1);
  assert.ok(d.picks.length >= 3);
  for (const p of d.picks) {
    assert.ok(["best", "tie", "none", "single", "lead"].includes(p.status), p.id);
    if (p.status === "single") assert.ok(p.id === "pictures" && p.n === 1 && !d.aaEnabled, "single-source pick only for pictures with AA off");
    else assert.ok(p.n >= 2, "pick from a single source: " + p.id);
    assert.ok(p.why && p.how && p.boards.length >= (p.status === "single" ? 1 : 2), p.id);
    // v16i: the 4 extra tests are credited as plain text (no link) by design
    const PLAIN = ["eqbench", "lechmazur", "vals", "matharena"];
    for (const b of p.boards) assert.ok(b.name && b.board && (/^https:\/\//.test(b.url) || (PLAIN.includes(b.src) && b.url === "")), p.id + " board without link");
    for (const w of p.winners) for (const r of w.ranks) assert.ok(r.name && (/^https:\/\//.test(r.url) || (PLAIN.includes(r.src) && r.url === "")), "rank without source link");
  }
  for (const a of d.cost.apps) assert.ok(a.app && /^https:\/\//.test(a.page) && a.checked && typeof a.free === "boolean", "price without source/date " + a.app);
  for (const r of d.releases.items) assert.ok(r.n && r.d && /^https:\/\//.test(r.u) && r.src);
  assert.ok(d.bignews.items.length <= 30);
  for (const n of d.bignews.items) assert.ok(n.t && n.s && n.d && /^https?:\/\//.test(n.u));
  assert.ok(read("data/data.js").startsWith("window.AI_DATA="));
});

test("old #links fall back to the first tab; new links work", () => {
  const A = loadApp();
  for (const h of ["#today", "#home", "#more", "#ranks", "#prices", "#timeline", "#trending", "#labs", "", "#nonsense"]) {
    assert.equal(A.routeFor(h).tab, "best", h);
    assert.equal(A.routeFor(h).more, false, h);
  }
  for (const t of ["best", "cost", "releases", "news", "agents", "sources"]) assert.equal(A.routeFor("#" + t).tab, t);
  assert.equal(A.routeFor("#agents-more").tab, "agents");
  assert.equal(A.routeFor("#agents-more").more, true);
  assert.equal(A.routeFor("#cost-more").more, true);
  assert.equal(A.routeFor("#news-more").tab, "news");
  assert.equal(A.routeFor("#main"), null);
});

test("every view renders, simple views are short, See more is there", () => {
  const A = loadApp();
  for (const t of ["best", "cost", "releases", "news", "agents"]) {
    const simple = A.view(t, false), full = A.view(t, true);
    for (const h of [simple, full]) assert.doesNotMatch(h, /undefined|NaN|Something went wrong/, t);
    assert.ok(full.length >= simple.length, t + " details should not be shorter");
    assert.match(simple + full, /href="#sources"/, t + " should link to Sources");
  }
  assert.match(A.view("best", false), /data-more="best"/);
  assert.match(A.view("cost", false), /data-more="cost"/);
  assert.ok((A.view("releases", false).match(/<li>/g) || []).length <= 5);
  assert.ok((A.view("news", false).match(/<li>/g) || []).length <= 5);
  const s = A.view("sources", false);
  assert.doesNotMatch(s, /undefined|NaN/);
  for (const id of ["LMArena", "LiveBench", "Epoch AI", "OpenRouter"].concat(data().aaEnabled ? ["Artificial Analysis"] : [])) assert.match(s, new RegExp(id));
});

test("every pick card shows a source link and a date; AA is credited where used", () => {
  const d = data(), A = loadApp(d);
  const html = A.view("best", false);
  for (const p of d.picks) {
    const card = html.split('id="p-' + p.id + '"')[1].split("</details>")[0];
    if (p.status !== "none") {
      assert.match(card, /href="https:\/\//, p.id + " has no link");
      assert.match(card, /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/, p.id + " has no date");
    }
  }
  const usesAA = d.picks.some((p) => p.boards.some((b) => b.src === "aa"));
  if (usesAA) assert.match(html, /Artificial Analysis \(artificialanalysis\.ai\)/);
});

test("labels: tie, no clear winner and new-not-sure-yet show up", () => {
  const d = data();
  const p = JSON.parse(JSON.stringify(d.picks[0]));
  const A = loadApp(Object.assign({}, d, { picks: [
    Object.assign({}, p, { id: "t1", status: "tie", winners: [p.winners[0] || p.candidates[0], p.candidates[0] || p.winners[0]] }),
    Object.assign({}, p, { id: "t2", status: "none", winners: [] }),
    Object.assign({}, p, { id: "t3", status: "best", winners: [Object.assign({}, p.winners[0] || p.candidates[0], { notSure: true, why: ["only 4,403 LMArena votes so far"] })] })
  ] }));
  const html = A.view("best", false);
  assert.match(html, /Tie: /);
  assert.match(html, /No clear winner yet/);
  assert.match(html, /New, not sure yet/);
});

test("a failed source shows 'using last good copy'", () => {
  const d = data();
  d.status.epoch = { ok: false, updated: "2026-10-30T10:00:00+00:00", err: "HTTP 500" };
  const A = loadApp(d);
  assert.match(A.view("sources", false), /Using last good copy from Oct 30/);
  assert.match(A.view("best", false), /Using the last good copy from Oct 30/);
});

test("Artificial Analysis off: no AA anywhere, 3-of-3 rule, pictures marked '1 source only'", () => {
  const d = data();
  if (d.aaEnabled) return;   // this repo is running with AA on (private); covered by the next test
  assert.doesNotMatch(read("data/data.json") + read("data/data.js"), /artificialanalysis\.ai|"aa"/i);
  if (fs.existsSync(path.join(R, "data/raw.json"))) assert.doesNotMatch(read("data/raw.json"), /"aa":|artificialanalysis\.ai/);
  const A = loadApp(d);
  const all = ["best", "cost", "releases", "news", "agents"].map((t) => A.view(t, false) + A.view(t, true)).join("") + A.view("sources", false);
  assert.doesNotMatch(all, /Artificial Analysis|artificialanalysis/);
  assert.match(d.rule, /all 3/);
  assert.match(A.view("best", true), /all 3 independent sources/);
  assert.match(A.view("best", true), /no picture model is called best/);
  const pic = d.picks.find((p) => p.id === "pictures");
  if (pic) {
    assert.equal(pic.status, "single");
    assert.match(A.view("best", false), /1 source only/);
  }
});

test("Artificial Analysis on: 3-of-4 rule, attribution and non-endorsement shown", () => {
  const d = JSON.parse(JSON.stringify(data()));
  const p = d.picks[0];
  d.aaEnabled = true;
  d.ruleInfo = Object.assign({}, d.ruleInfo, { textSources: 4, picSources: 2 });
  d.rule = "A model is called best only when at least 3 of 4 independent sources put it in their top 3 (2 of 2 for pictures).";
  d.sources = d.sources.concat([{ id: "aa", name: "Artificial Analysis", credit: "Artificial Analysis (artificialanalysis.ai)", url: "https://artificialanalysis.ai/", what: "x", license: "", licenseUrl: "" }]);
  d.status.aa = { ok: true, updated: d.built };
  p.usesAA = true;
  p.boards.push({ src: "aa", name: "Artificial Analysis", board: "Intelligence Index (general)", date: "2026-11-01", url: "https://artificialanalysis.ai/leaderboards/models", top: ["X"] });
  const w = p.winners[0] || p.candidates[0];
  w.ranks.push({ src: "aa", name: "Artificial Analysis", board: "Intelligence Index (general)", date: "2026-11-01", url: "https://artificialanalysis.ai/leaderboards/models", rank: 2, score: 58.4, top3: true });
  if (!p.winners.length) p.winners = [w];
  const A = loadApp(d);
  const best = A.view("best", false), more = A.view("best", true);
  assert.match(best, /Based on data from <a href="https:\/\/artificialanalysis\.ai\/"[^>]*>Artificial Analysis \(artificialanalysis\.ai\)<\/a>/);
  assert.match(best, /not endorsed by Artificial Analysis/);
  assert.match(best, /Source: <a href="https:\/\/artificialanalysis\.ai\/leaderboards\/models"[^>]*>Artificial Analysis \(artificialanalysis\.ai\)<\/a>/);
  assert.match(more, /at least 3 of the 4 independent sources/);
  assert.match(A.view("sources", false), /Artificial Analysis \(artificialanalysis\.ai\)/);
});

test("Sources view credits licenses: CC BY 4.0 links for LMArena and Epoch, LiveBench by name", () => {
  const html = loadApp().view("sources", false);
  assert.match(html, /LMArena \(lmarena\.ai\)/);
  assert.match(html, /Epoch AI \(epoch\.ai\)/);
  assert.match(html, /LiveBench \(livebench\.ai\)/);
  // LMArena and Epoch AI in the main list, plus the agent tests that use the same data (Agent Arena, APEX, Vending-Bench, RLI)
  const main = html.split("<h3>")[0];
  assert.equal((main.match(/href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/g) || []).length, 2);
  assert.ok((html.match(/href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/g) || []).length >= 6);
});

test("⚡ Fast tag: name-based label in See more, dev prices and releases, explained, never on the simple Best view", () => {
  const d = JSON.parse(JSON.stringify(data()));
  assert.match(d.fastNote, /guessed from the model's name.*not a speed test/);
  for (const r of d.releases.items) assert.equal(typeof r.fast, "boolean");
  for (const x of d.cost.dev) assert.equal(typeof x.fast, "boolean");
  // make sure each place has at least one fast model to show
  d.releases.items[0].fast = true; d.cost.dev[0].fast = true;
  const p = d.picks.find((x) => x.winners.length) || d.picks[0];
  (p.winners[0] || p.candidates[0]).fast = true;
  p.boards[0].topFast = [true, false, false];
  const A = loadApp(d);
  assert.match(A.view("releases", false), /⚡ Fast/);
  assert.match(A.view("releases", true), /⚡ Fast[\s\S]*not a speed test|not a speed test[\s\S]*⚡ Fast/);
  assert.match(A.view("cost", true), /⚡ Fast/);
  assert.match(A.view("cost", true), /not a speed test/);
  const more = A.view("best", true);
  assert.ok((more.match(/class="fast"/g) || []).length >= 2, "winner and board top list should be tagged");
  assert.match(more, /not a speed test/);
  assert.doesNotMatch(A.view("best", false), /class="fast"/);
  assert.match(A.view("sources", false), /⚡ Fast:<\/b> .*not a speed test/);
});

test("v5: every app price shows its source page, last-checked date and a stale mark when old", () => {
  const d = JSON.parse(JSON.stringify(data()));
  for (const a of d.cost.apps) assert.ok(a.src && /^https:\/\//.test(a.src.url) && a.src.label && a.checked, a.app);
  const A = loadApp(d);
  const cost = A.view("cost", false);
  assert.match(cost, /App Store price \(US\)/);
  assert.doesNotMatch(cost, /⚠ stale/);
  const gpt = d.cost.apps.find((a) => a.app === "ChatGPT");
  gpt.readToday = false; gpt.stale = true; gpt.checked = "2026-09-20"; gpt.plans.forEach((p) => (p.stale = true));
  gpt.cheapest = Object.assign({}, gpt.cheapest, { stale: true });
  d.stalePrices = [{ app: "ChatGPT", plan: "Plus", usd_month: 19.99, checked: "2026-09-20" }];
  const B = loadApp(d);
  assert.match(B.view("cost", false), /price last checked Sep 20/);
  assert.match(B.view("cost", false), /⚠ stale/);
  assert.match(B.view("cost", true), /⚠ stale/);
  assert.match(B.view("sources", false), /not confirmed for more than 30 days: ChatGPT Plus/);
});

test("v5: Sources view lists each official page and each app's price page with today's result", () => {
  const d = data(), html = loadApp(d).view("sources", false);
  for (const o of d.officialSources) assert.ok(html.includes(o.label), o.label);
  for (const a of d.cost.apps) assert.ok(html.includes(a.app), a.app);
  assert.match(html, /Read today|Failed today/);
});

test("v5: New releases use the company's own page when there is one", () => {
  const d = data();
  const official = d.releases.items.filter((r) => r.official);
  assert.ok(official.length > 0);
  for (const r of official) assert.notEqual(r.src, "OpenRouter");
  const keys = d.releases.items.map((r) => r.n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  assert.equal(keys.length, new Set(keys).size, "a model is listed twice");
});

// ------------------------------------------------------------------ v6: Agents tab
test("v6 data: agents part has the right shape (every item has a source, link and date)", () => {
  const ag = data().agents;
  assert.ok(["best", "none"].includes(ag.best.status));
  assert.equal(ag.best.need, 2);
  for (const w of ag.best.winners) {
    assert.ok(w.top3 >= 2 && w.top3 <= ag.best.n, "best for agents needs top 3 in at least 2 tests: " + w.n);
    for (const r of w.ranks) assert.ok(r.name && /^https:\/\//.test(r.url) && r.date, "rank without source/date");
  }
  assert.deepStrictEqual(ag.tests.filter((t) => t.inRule).map((t) => t.id), ["arena", "lb_agentic", "apex"]);
  for (const t of ag.tests) assert.ok(t.name && t.credit && /^https:\/\//.test(t.url) && Array.isArray(t.top), t.id);
  assert.ok(ag.apps.length >= 10);
  for (const a of ag.apps) {
    assert.ok(a.app && a.what && ["tasks", "code", "assistants", "research"].includes(a.group), a.app);
    assert.ok(a.src && /^https:\/\//.test(a.src.url) && a.src.label && a.checked, "agent app without source/date: " + a.app);
    if (a.plansFrom) assert.ok(a.proof && /^https:\/\//.test(a.proof.url) && a.proof.checked, "no proof line for " + a.app);
  }
  assert.ok(ag.news.items.length <= 8);
  for (const n of ag.news.items) assert.ok(n.t && n.s && n.d && /^https:\/\//.test(n.u));
});

test("v6 Agents tab, simple view: best model, one line per app in 2 groups, a few news items, See more", () => {
  const d = data(), A = loadApp(d), h = A.view("agents", false);
  assert.match(h, /<h2>AI agents<\/h2>/);
  assert.match(h, /Best AI for agents/);
  for (const w of d.agents.best.winners) assert.ok(h.includes(w.n), w.n);
  assert.match(h, /top 3 in \d of \d agent tests/);
  for (const g of d.agents.groups) assert.ok(h.includes(g.label), g.label);
  for (const a of d.agents.apps) assert.ok(h.includes("<b>" + a.app + "</b>"), a.app);
  assert.match(h, /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/);
  assert.match(h, /data-more="agents"/);
  assert.match(h, /href="#sources"/);
  assert.ok((h.match(/class="tag"/g) || []).length <= 4, "simple view shows at most 4 news items");
  assert.doesNotMatch(h, /Included: /, "proof lines only under See more");
});

test("v6 Agents tab, See more: rule, every test's top 5, every plan with its proof line, all news", () => {
  const d = data(), h = loadApp(d).view("agents", true);
  assert.match(h, /top 3 of at least 2 of the 3/);
  for (const t of d.agents.tests) {
    assert.ok(h.includes(t.name), t.name);
    for (const r of t.top) assert.ok(h.includes(r.shown), t.id + " " + r.shown);
  }
  assert.match(h, /Info only/);
  assert.match(h, /APEX-Agents by Mercor, via Epoch AI/);
  for (const a of d.agents.apps) for (const p of a.plans) assert.ok(h.includes(p.name + ": <b>"), a.app + " " + p.name);
  for (const a of d.agents.apps.filter((x) => x.proof)) assert.ok(h.includes(a.proof.label), a.app);
  for (const n of d.agents.news.items) assert.ok(h.includes(n.t.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;")), n.t);
  assert.match(h, /Back to the simple view/);
});

test("v6 Agents tab: no clear winner, a skipped test, a stale price and a missing agents part all show plainly", () => {
  const d = JSON.parse(JSON.stringify(data()));
  d.agents.best = Object.assign({}, d.agents.best, { status: "none", winners: [], why: "Only 1 of the 3 agent tests has fresh data right now, so no model is named best." });
  const apex = d.agents.tests.find((t) => t.id === "apex");
  apex.skipped = true; apex.skipWhy = "newest result is from 2026-06-01, more than 120 days ago";
  const cur = d.agents.apps.find((a) => a.id === "cursor");
  cur.src.readToday = false; cur.src.stale = true; cur.src.checked = "2026-09-20"; cur.plans.forEach((p) => (p.stale = true));
  cur.cheapest = Object.assign({}, cur.cheapest, { stale: true });
  const A = loadApp(d);
  assert.match(A.view("agents", false), /No clear winner yet/);
  assert.match(A.view("agents", false), /last checked Sep 20/);
  assert.match(A.view("agents", false), /⚠ stale/);
  assert.match(A.view("agents", true), /Left out today: newest result is from 2026-06-01/);
  assert.match(A.view("sources", false), /Left out today/);
  const none = Object.assign({}, d); delete none.agents;
  const B = loadApp(none);
  assert.match(B.view("agents", false), /being built/);
  assert.doesNotMatch(B.view("agents", true) + B.view("sources", false), /undefined|NaN|Something went wrong/);
});

test("v6 Sources view lists every agent test and every agent app page with today's result", () => {
  const d = data(), html = loadApp(d).view("sources", false);
  assert.match(html, /Agent tests \(Agents tab\)/);
  for (const t of d.agents.tests) assert.ok(html.includes(t.credit), t.credit);
  assert.match(html, /Agent app pages/);
  for (const a of d.agents.apps) assert.ok(html.includes(a.app), a.app);
  assert.match(html, /https:\/\/www\.mercor\.com\/apex\//);
});

test("v6 Agents tab looks right in both themes: only theme colors, dark mode defined", () => {
  const css = read("app.css");
  const agentCss = css.split("/* Agents tab */")[1].split("/*")[0];
  assert.doesNotMatch(agentCss, /#[0-9a-f]{3,6}\b|rgb\(/i, "agent styles must use the theme variables");
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test("v6 leftovers: credits read 'Data from each company's…' (small e)", () => {
  const A = loadApp(data());
  const all = ["releases", "news", "cost", "agents"].map((t) => A.view(t, false) + A.view(t, true)).join("");
  assert.doesNotMatch(all, /Data from (<a[^>]*>)?Each /);
  assert.match(all, /each company's/);
});

// ------------------------------------------------------------------ v7: personal assistants
test("v7 Personal assistants group: simple view and See more, source link + date, no price numbers", () => {
  const d = data();
  assert.ok(d.agents.groups.some((g) => g.id === "assistants"), "sample/data has the new group");
  const A = loadApp(d), simple = A.view("agents", false), more = A.view("agents", true);
  for (const h of [simple, more]) {
    assert.match(h, /Personal assistants \(text or call them\)/);
    assert.match(h, /<b>Instinct<\/b>/); assert.match(h, /<b>Tab<\/b>/);
    assert.match(h, /Invite only \(waitlist\) · Price not public/);
    assert.match(h, /Invite or waitlist \(private beta\) · Free to use; paid plans for more speed/);
    assert.match(h, /href="https:\/\/instinct\.com\/"[^>]*>Instinct home page<\/a>/);
    assert.match(h, /href="https:\/\/tab\.bot"[^>]*>tab\.bot<\/a>, checked Nov 2/);
  }
  assert.ok(simple.indexOf("Personal assistants") < simple.indexOf("Coding agents"), "v7b: assistants are the first group");
  assert.ok(simple.indexOf("<b>Instinct</b>") < simple.indexOf("<b>Tab</b>"), "alphabetical");
  assert.match(more, /A personal assistant you text or call/);
  assert.match(more, /Access: Invite only \(waitlist\) · Price: Price not public/);
  const rowOf = (name) => simple.split("<b>" + name + "</b>")[1].split("</li>")[0];
  for (const name of ["Instinct", "Tab"]) assert.doesNotMatch(rowOf(name), /\$\d|Free ✓|Free\?|Paid</, "no prices or free badges on " + name);
  assert.doesNotMatch(simple + more, /undefined|NaN|Something went wrong/);
});

test("v7: an old v6 data.json (no Personal assistants group) still renders the Agents tab", () => {
  const d = JSON.parse(JSON.stringify(data()));
  d.agents.groups = d.agents.groups.filter((g) => g.id !== "assistants");
  d.agents.apps = d.agents.apps.filter((a) => a.group !== "assistants").map((a) => { const x = Object.assign({}, a); delete x.access; delete x.priceText; return x; });
  const A = loadApp(d);
  for (const h of [A.view("agents", false), A.view("agents", true), A.view("sources", false)]) {
    assert.doesNotMatch(h, /undefined|NaN|Something went wrong/);
    assert.doesNotMatch(h, /Personal assistants/);
  }
  assert.match(A.view("agents", false), /Coding agents/);
});

test("v7: both themes - assistant rows use only existing theme-colored classes", () => {
  const js = read("app.js");
  const fn = js.split("function assistantRow")[1].split("function agentAppRow")[0];
  assert.doesNotMatch(fn, /style=|#[0-9a-f]{3,6}\b/i);
  assert.match(read("app.css"), /:root\[data-theme="dark"\]/);
});

// ------------------------------------------------------------------ v7b: all notable agents (49 rows, 4 groups)
const GROUP_LABELS = ["Personal assistants (text or call them)", "Browser and computer agents", "Coding agents", "Research and work agents"];

test("v7b: 4 groups in order, collapsed by default, with counts", () => {
  const d = data(), A = loadApp(d), h = A.view("agents", false);
  assert.deepStrictEqual(d.agents.groups.map((g) => g.label), GROUP_LABELS);
  assert.equal(d.agents.apps.length, 49);
  const counts = {};
  for (const a of d.agents.apps) counts[a.group] = (counts[a.group] || 0) + 1;
  let last = -1;
  for (const g of d.agents.groups) {
    const re = new RegExp('<details class="agrp" id="ag-' + g.id + '"><summary><span>' + g.label.replace(/[()]/g, "\\$&") + ' <span class="cnt">\\(' + counts[g.id] + "\\)</span>");
    assert.match(h, re, g.id + " collapsed with count");
    assert.ok(h.indexOf('id="ag-' + g.id + '"') > last, "group order"); last = h.indexOf('id="ag-' + g.id + '"');
  }
  assert.match(h, /49 agents in 4 groups\. Tap a group to open it\./);
  assert.doesNotMatch(h, /class="agrp"[^>]* open/, "all closed at first");
});

test("v7b: opening a group shows its rows: name · maker, price line, badge, source + date", () => {
  const d = data(), A = loadApp(d);
  const h = A.view("agents", false);
  const code = h.split('id="ag-code"')[1].split("</details>")[0];
  for (const a of d.agents.apps.filter((x) => x.group === "code")) assert.ok(code.includes("<b>" + a.app + "</b>"), a.app);
  const lov = code.split("<b>Lovable</b>")[1].split("</li>")[0];
  assert.match(lov, /· Lovable<\/span>/);
  assert.match(lov, /Free · Pro \$25\/month · Business \$50\/month/);
  assert.match(lov, /href="https:\/\/lovable\.dev\/pricing"[^>]*>[^<]+<\/a>, checked Nov 2/);
  assert.match(lov, /Free ✓/);
  const factory = code.split("<b>Factory (Droids)</b>")[1].split("</li>")[0];
  assert.match(factory, />Paid</);
  const alexa = h.split("<b>Alexa+</b>")[1].split("</li>")[0];
  assert.match(alexa, /Free\?/);
  assert.match(h.split("<b>Devin</b>")[0].split('id="ag-code"')[1] + "", /Codex/, "existing rows first in Coding agents");
});

test("v7b: See more shows what, access, every plan, source and 'page still up'", () => {
  const d = JSON.parse(JSON.stringify(data()));
  const A = loadApp(d), more = A.view("agents", true);
  for (const g of d.agents.groups) assert.match(more, new RegExp('id="ag-' + g.id + '-more"'));
  const poke = more.split("<b>Poke</b>")[1].split("</li>")[0];
  assert.match(poke, /A personal assistant you text\./);
  assert.match(poke, /Access: Open to all/);
  assert.match(poke, /Pro: <b>\$19\/mo<\/b>/); assert.match(poke, /Ultra: <b>\$199\/mo<\/b>/);
  assert.match(poke, /Poke pricing page<\/a>, checked Nov 2/);
  assert.match(poke, /Page still up: /);
  assert.match(more, /Windsurf is now part of Devin/);
  const kiro = d.agents.apps.find((a) => a.id === "kiro");
  kiro.check.readToday = false; kiro.check.checked = "2026-09-20"; kiro.stale = true; kiro.check.stale = true;
  const k = loadApp(d).view("agents", true).split("<b>Kiro</b>")[1].split("</li>")[0];
  assert.match(k, /Page last read Sep 20/);
  assert.match(k, /⚠ stale/);
});

test("v7b: an old v7 data.json (no research group, no hand-checked rows) still renders", () => {
  const d = JSON.parse(JSON.stringify(data()));
  d.agents.groups = [{ id: "tasks", label: "Does tasks for you" }, { id: "code", label: "Writes code for you" }, { id: "assistants", label: "Personal assistants (text or call them)" }];
  d.agents.apps = d.agents.apps.filter((a) => !a.static);
  const A = loadApp(d);
  for (const h of [A.view("agents", false), A.view("agents", true), A.view("sources", false)]) assert.doesNotMatch(h, /undefined|NaN|Something went wrong/);
  assert.match(A.view("agents", false), /14 agents in 3 groups/);
  assert.doesNotMatch(A.view("agents", false), /Research and work agents/);
});

test("v7b: hand-checked rows never touch Best for agents or the stale price list", () => {
  const d = data();
  for (const s of d.stalePrices || []) assert.ok(!d.agents.apps.some((a) => a.static && a.app === s.app), s.app);
  for (const w of d.agents.best.winners) assert.ok(!d.agents.apps.some((a) => a.app === w.n));
});

test("v7b: both themes, every group open, nothing wider than 390 px", { skip: (() => { try { require.resolve("playwright"); return false; } catch (e) { return "playwright not installed"; } })() }, async () => {
  const { chromium } = require("playwright");
  const d = data(), A = loadApp(d);
  const html = (A.view("agents", false) + A.view("agents", true) + A.view("sources", false)).replace(/<details class="agrp"/g, '<details open class="agrp"');
  const b = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      await p.setContent('<!doctype html><html data-theme="' + theme + '"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + read("app.css") +
        '</style></head><body><main class="page"><div class="view">' + html + "</div></main></body></html>");
      const r = await p.evaluate(() => {
        const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 390.5).map((e) => e.tagName + "." + e.className);
        return { wide: wide.slice(0, 5), sw: document.documentElement.scrollWidth, bg: getComputedStyle(document.body).backgroundColor };
      });
      assert.deepStrictEqual(r.wide, [], theme + ": too wide");
      assert.ok(r.sw <= 390, theme + " scroll width " + r.sw);
      assert.equal(r.bg, theme === "dark" ? "rgb(15, 19, 26)" : "rgb(246, 245, 241)");
      await p.close();
    }
  } finally { await b.close(); }
});


// ---- v16h (cloudflare-v9, the live app): picker fix, no outside links, finder wording
test("v16h: cloudflare-v9 app - tapping the already-chosen model ticks the AI; no outside links; no '1 test' note on finder tasks", () => {
  const app = read("cloudflare-v9/app.js"), sw = read("cloudflare-v9/sw.js");
  assert.match(sw, /const VERSION = "(v16[hi]\d|v17[dehklm]2?|v17n3|v17n6)-2026-11-\d\d"/);
  assert.match(app, /function chooseSame\(input\)/);                                   // the same-row handler
  assert.match(app, /addEventListener\("click", function \(e\) \{\s*if \(e\.target && e\.target\.name === "mopt" && pro\.sheet\) chooseSame\(e\.target\);/);
  assert.match(app, /e\.key === "Enter" \|\| e\.key === " "\) && e\.target && e\.target\.name === "mopt"\) \{ chooseSame\(e\.target\)/);
  assert.doesNotMatch(app, /guide, not a verdict/);
  assert.match(app, /id: "lechat", name: "Vibe"/);                                     // Mistral renamed Le Chat to Vibe
  assert.match(app, /No summary from the source yet\./);                              // story page never blank
  assert.doesNotMatch(app, /return "No clear winner yet"/);
  // every target="_blank" left in the app belongs to an Ask launcher or the Stripe pay button
  let i = -1, n = 0;
  while ((i = app.indexOf("target=", i + 1)) >= 0) {
    n++;
    const ctx = app.slice(Math.max(0, i - 400), i);
    assert.ok(/askbtn|paybtn|PAY_LINK/.test(ctx), "outside link left near: " + app.slice(i - 120, i + 40));
  }
  assert.ok(n <= 2, "more target= links than the Ask launchers: " + n);
  for (const f of ["cloudflare-v9/index.html", "cloudflare-v9/privacy.html", "cloudflare-v9/terms.html", "cloudflare-v9/refund.html"]) {
    const h = read(f).replace(/<meta[^>]*>/g, "");
    assert.doesNotMatch(h, /href="https?:\/\//, f + " links out");
  }
});


// ---- v16i (cloudflare-v9): AI-written detailed story summaries + the 4 extra tests in Top Picks
test("v16i: story page shows the AI summary (xd) with its note, else x; boards graded by AI are marked", () => {
  const sw = read("cloudflare-v9/sw.js");
  assert.match(sw, /const VERSION = "(v16i\d|v17[dehklm]2?|v17n3|v17n6)-2026-11-\d\d"/);
  const ctx = { AI_DATA: data() };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("cloudflare-v9/app.js"), ctx);
  const A = ctx.AITracker;
  const d = JSON.parse(JSON.stringify(data()));
  const items = d.bignews.items;
  assert.ok(items.length >= 2);
  items[0].xd = "First paragraph of an AI summary.\n\nSecond paragraph of it.";
  items[0].xdBy = "AI summary";
  items[1].x = "The feed's own short text."; delete items[1].xd;
  const wb = d.picks.find((p) => p.id === "writing");
  wb.boards.push({ src: "eqbench", name: "EQ-Bench", board: "Creative Writing v3 (Elo)", date: "2026-10-28", url: "", ai: true, top: ["A", "B", "C"], topFast: [false, false, false] });
  d.ruleInfo = Object.assign({}, d.ruleInfo, { names: "LMArena, LiveBench, Epoch AI, EQ-Bench, Lech Mazur's story test, Vals AI and MathArena" });
  A.setData(d);
  const s0 = A.storyHtml("news", 0);
  assert.match(s0, /<p>First paragraph of an AI summary\.<\/p><p>Second paragraph of it\.<\/p>/);
  assert.doesNotMatch(s0, /Summary written by AI/);                                   // v17l2: the AI-summary line is gone (Yisroel, Nov 11)
  const s1 = A.storyHtml("news", 1);
  assert.match(s1, /The feed&#39;s own short text\.|The feed's own short text\./);
  assert.doesNotMatch(s1, /Summary written by AI/);
  const more = A.view("best", true);
  assert.match(more, /EQ-Bench · Creative Writing v3 \(Elo\) \(graded by AI\)/);
  assert.match(more, /Lech Mazur's story test|Lech Mazur&#39;s story test/);
  assert.doesNotMatch(more.replace(/<a [^>]*href="#[^"]*"/g, ""), /href="https?:/);
});
