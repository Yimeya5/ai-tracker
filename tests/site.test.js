const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const R = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");
const data = () => JSON.parse(read("data/data.json"));

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
  assert.match(s, /const VERSION = "v5-2026-11-01"/);
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

test("exactly 4 tabs, a Sources view, no tables, no leftovers", () => {
  const h = read("index.html");
  const tabs = [...h.matchAll(/<nav[\s\S]*?<\/nav>/g)][0][0].match(/data-tab="([^"]+)"/g).map((s) => s.slice(10, -1));
  assert.deepStrictEqual(tabs, ["best", "cost", "releases", "news"]);
  assert.match(h, />Best for what</); assert.match(h, />Cost</); assert.match(h, />New releases</); assert.match(h, />Big news</);
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
  const ids = ["lmarena", "livebench", "epoch", "openrouter", "official", "prices", "news"].concat(d.aaEnabled ? ["aa"] : []);
  for (const s of ids) {
    assert.ok(d.status[s], "no status for " + s);
    assert.ok(d.sources.some((x) => x.id === s), "no source entry for " + s);
  }
  assert.equal(d.ruleInfo.textSources, d.aaEnabled ? 4 : 3);
  assert.equal(d.ruleInfo.picSources, d.aaEnabled ? 2 : 1);
  assert.ok(d.picks.length >= 3);
  for (const p of d.picks) {
    assert.ok(["best", "tie", "none", "single"].includes(p.status), p.id);
    if (p.status === "single") assert.ok(p.id === "pictures" && p.n === 1 && !d.aaEnabled, "single-source pick only for pictures with AA off");
    else assert.ok(p.n >= 2, "pick from a single source: " + p.id);
    assert.ok(p.why && p.how && p.boards.length >= (p.status === "single" ? 1 : 2), p.id);
    for (const b of p.boards) assert.ok(b.name && b.board && /^https:\/\//.test(b.url), p.id + " board without link");
    for (const w of p.winners) for (const r of w.ranks) assert.ok(r.name && /^https:\/\//.test(r.url), "rank without source link");
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
  for (const t of ["best", "cost", "releases", "news", "sources"]) assert.equal(A.routeFor("#" + t).tab, t);
  assert.equal(A.routeFor("#cost-more").more, true);
  assert.equal(A.routeFor("#news-more").tab, "news");
  assert.equal(A.routeFor("#main"), null);
});

test("every view renders, simple views are short, See more is there", () => {
  const A = loadApp();
  for (const t of ["best", "cost", "releases", "news"]) {
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
  const all = ["best", "cost", "releases", "news"].map((t) => A.view(t, false) + A.view(t, true)).join("") + A.view("sources", false);
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
  assert.equal((html.match(/href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/g) || []).length, 2);
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
