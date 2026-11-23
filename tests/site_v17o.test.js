// v17o (cloudflare-v9): one main public test per task. Top Picks and Find your AI show the SAME ordered list; untested
// models are unranked; fixed tiebreakers (lower verified cost, fewer usage limits, fresher test); Free / Paid keeps only
// models with an exact plan-access record (with "See paid options" when nothing is); "early data" labels; source + date on every pick.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const R = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");
const AGENTS_SAMPLE = () => JSON.parse(read("tests/fixtures/agents_sample.json"));

const MAIN = (board, extra) => Object.assign({ src: "lmarena", name: "LMArena", board, date: "2026-11-19", url: "https://lmarena.ai/leaderboard/text", unit: "rating" }, extra || {});
const C = (k, n, o, s, r, extra) => Object.assign({ k, n, o, s, r, fast: false }, extra || {});
function task(id, label, list, extra) {
  const full = (c) => ({ k: c.k, n: c.n, o: c.o, top3: 1, covered: 1, votes: null, notSure: false, why: [], fast: false,
    ranks: [{ src: "lmarena", name: "LMArena", board: "x", date: "2026-11-19", url: "https://lmarena.ai/", rank: c.r, score: c.s, top3: c.r <= 3 }] });
  return Object.assign({ id, label, icon: "x", status: "lead", need: 1, n: 1, rules: "v17o", main: MAIN("Text, style-adjusted"), ranked: list,
    early: false, why: "Top rating in people's blind votes (LMArena Text, style-adjusted).", winners: [full(list[0])],
    candidates: list.slice(1).map(full), new: [], usesAA: false, how: "LMArena ...", boards: [{ src: "lmarena", name: "LMArena", board: "x", date: "2026-11-19", url: "https://lmarena.ai/", top: [] }] }, extra || {});
}
function data() {
  const d = JSON.parse(read("data/data.json"));
  if (!d.agents) d.agents = AGENTS_SAMPLE();
  d.picks = [
    // Carbon and Argon are NOT within each other's ranges (Carbon 1527 is outside Argon's 1515..1525): no tie
    task("chat", "Chat & questions", [C("gemini-4-carbon", "Gemini 4 Carbon", "Google", 1527, 1, { lo: 1517, hi: 1537 }),
      C("gemini-4-argon", "Gemini 4 Argon", "Google", 1520, 2, { lo: 1515, hi: 1525 }),
      C("claude-sonnet-5-5", "Claude Sonnet 5.5", "Anthropic", 1480, 3, { lo: 1474, hi: 1486 })]),
    // equal published scores: Opus listed first, Sonnet is free (verified) -> Sonnet starts, "costs less"
    task("writing", "Writing", [C("claude-opus-5-5", "Claude Opus 5.5", "Anthropic", 1530, 1), C("claude-sonnet-5-5", "Claude Sonnet 5.5", "Anthropic", 1530, 1),
      C("gpt-6-astra", "GPT-6 Astra", "OpenAI", 1500, 3)]),
    // both free; Terra is "limited" on free, Sonnet fully free -> Sonnet, "fewer usage limits"
    task("webdev", "Coding: websites", [C("gpt-6-1-terra", "GPT-6.1 Terra", "OpenAI", 1800, 1, { lo: 1790, hi: 1810 }),
      C("claude-sonnet-5-5", "Claude Sonnet 5.5", "Anthropic", 1795, 2, { lo: 1788, hi: 1802 })],
      { cross: { src: "designarena", name: "DesignArena", board: "Website", date: "2026-11-22", url: "https://www.designarena.ai/leaderboard", top: "Muse Wonder", agree: false } }),
    // same app, same plan, same limits -> the fresher test decides
    task("coding", "Coding: other code", [C("claude-opus-5-5", "Claude Opus 5.5", "Anthropic", 90, 1, { d: "2026-10-01" }),
      C("claude-fable-5-1", "Claude Fable 5.1", "Anthropic", 90, 1, { d: "2026-11-06" })],
      { main: { src: "livebench", name: "LiveBench", board: "LiveBench 2.0, Coding", date: "2026-11-06", url: "https://livebench.ai/", unit: "score" } }),
    // the DesignArena cross-check disagrees (no tie): the main #1 stays, with a note
    task("pictures", "Pictures", [C("gpt-image-2-5-sunburst", "GPT-Image-2.5 Sunburst", "OpenAI", 1428, 1), C("nano-banana-pro", "Nano Banana Pro", "Google", 1390, 2)],
      { cross: { src: "designarena", name: "DesignArena", board: "Image", date: "2026-11-22", url: "https://www.designarena.ai/leaderboard", top: "Other", agree: false } }),
  ].concat(JSON.parse(read("data/data.json")).picks.filter((p) => p.id === "cheap"));
  d.finder.tasks = [
    // Research: the #1 is a model no app of ours offers -> on Free nothing is verified: no invented match
    task("research", "Research", [C("amazon-web-search-agent", "Amazon Web Search Agent", "Amazon", 1266, 1, { lo: 1251, hi: 1281 }),
      C("gpt-6-1-sol", "GPT-6.1 Sol", "OpenAI", 1230, 2, { lo: 1221, hi: 1239 })], { finder: true, main: MAIN("Search, factuality view", { url: "https://lmarena.ai/leaderboard/search" }) }),
    task("video", "Video: from text", [C("gemini-omni-1-2-flash", "Gemini Omni 1.2 Flash", "Google", 1540, 1)], { finder: true, early: true, main: MAIN("Text-to-video") }),
    task("voice", "Voice & talking", [C("gpt-live-1", "GPT Live 1", "OpenAI", 79.9, 1), C("grok-voice-think-fast-2-0", "Grok Voice Think Fast 2.0", "xAI", 71.4, 2)],
      { finder: true, early: true, main: { src: "taubench", name: "Sierra τ-Voice", board: "τ-Voice, pass@1", date: "2026-10-20", url: "https://taubench.com/leaderboard/", unit: "%" } }),
    task("video_image", "Video: from an image", [C("gemini-omni-flash", "Gemini Omni Flash", "Google", 1509, 1)], { finder: true, early: true, main: MAIN("Image-to-video") }),
  ];
  d.agents.best = { status: "lead", need: 1, n: 2, rules: "v17o", winners: [], candidates: [], why: "", testsUsed: ["vals_tb4", "apex"],
    groups: [task("terminal", "Terminal work", [C("claude-opus-5-5", "Claude Opus 5.5", "Anthropic", 65.15, 1), C("claude-fable-5-2", "Claude Fable 5.2", "Anthropic", 65.15, 1)],
      { main: { src: "vals", name: "Vals AI", board: "Terminal-Bench 4.0, average task pass rate", date: "2026-11-19", url: "https://www.vals.ai/benchmarks/terminal-bench-4", unit: "%" }, why: "Highest average task pass rate." }),
    task("pro", "Professional tasks", [C("gemini-4-carbon", "Gemini 4 Carbon", "Google", 84.2, 1, { lo: 79.9, hi: 88.5 })],
      { early: true, main: { src: "mercor", name: "Mercor", board: "APEX-Agents, pass@1 (fully passed)", date: "2026-11-22", checked: "2026-11-22", url: "https://www.mercor.com/apex/", unit: "%" }, why: "Most tasks fully passed." })] };
  d.agents.best.winners = d.agents.best.groups[0].winners;
  return d;
}
function load(d) {
  const ctx = { AI_DATA: d || data() };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("cloudflare-v9/app.js"), ctx);
  return ctx.AITracker;
}
const finderFor = (A, t, plan) => { A.setFinder("task", t); A.setFinder("plan", plan || "any"); return A.finderHtml(); };
const startName = (html) => { const m = html.match(/<span class="fkick">Start here<\/span><span class="fname"><b>([^<]+)<\/b>/); return m ? m[1].replace(/&amp;/g, "&") : null; };
const fullOrder = (html) => [...html.matchAll(/<li data-k="([^"]+)">/g)].map((m) => m[1]);

test("v17p: version bumped in app.js and sw.js", () => {
  assert.match(read("cloudflare-v9/sw.js"), /const VERSION = "v17p-2026-11-22"/);
  assert.equal(load().version, "v17p-2026-11-22");
});

test("v17p: Start here collapses to one tappable row; the info opens on tap", () => {
  const A = load();
  for (const p of data().picks.filter((x) => x.rules === "v17o").concat(data().finder.tasks)) {
    const html = finderFor(A, p.id, "any");
    assert.match(html, /<details class="fbest fbestx"><summary>/, p.id + ": card is a details row");
    assert.doesNotMatch(html, /<details class="fbest fbestx" open/, p.id + ": collapsed by default");
    assert.match(html, /<span class="chev" aria-hidden="true"><\/span><\/summary>/, p.id + ": chevron on the row");
    const shut = html.indexOf("<summary>"), open = html.indexOf("</summary>");
    assert.ok(html.indexOf('class="fwhyline"') > open, p.id + ": the why only shows after the row");
    assert.ok(html.indexOf('class="fwhy"') > open, p.id + ": the price chips only show after the row");
    assert.ok(shut >= 0 && open > shut, p.id);
    assert.equal(startName(html), A.taskOrder(p.id, "any").list[0].n, p.id + ": the answer stays on the row");
  }
});

test("v17o: Top Picks and Find your AI show one identical order for every task", () => {
  const A = load(), d = data();
  for (const p of d.picks.filter((x) => x.rules === "v17o").concat(d.finder.tasks)) {
    const ord = A.taskOrder(p.id, "any").list.map((r) => r.k);
    const html = finderFor(A, p.id, "any");
    assert.deepEqual(fullOrder(html), ord, p.id);                                     // the finder's full ranking = the list
    assert.equal(startName(html), A.taskOrder(p.id, "any").list[0].n, p.id);          // its "Start here" = the list's #1
    const tp = d.picks.find((x) => x.id === p.id);
    if (tp) assert.equal(A.pickTitle(tp), startName(html), p.id);                     // Top Picks shows that same #1
  }
  const best = A.view("best", false), more = A.view("best", true);
  assert.doesNotMatch(best, /No clear winner|>Tie</);
  for (const p of d.picks.filter((x) => x.rules === "v17o")) {
    const n = A.taskOrder(p.id, "any").list[0].n.replace(/&/g, "&amp;");
    assert.ok(best.indexOf(n) >= 0 && more.indexOf(n) >= 0, p.id + ": the #1 is on Top Picks and See more");
  }
});

test("v17o: untested models are unranked, published ties keep their shared place", () => {
  const A = load();
  const chat = A.taskOrder("chat", "any").list;
  assert.deepEqual(chat.map((r) => r.k), ["gemini-4-carbon", "gemini-4-argon", "claude-sonnet-5-5"]);
  assert.ok(!chat.some((r) => r.k === "gpt-6-astra"), "not on the main test: not in the list at all");
  assert.equal(A.taskOrder("chat", "any").note, "");                                // Carbon is clear of Argon's range
  const w = A.taskOrder("writing", "any").list;
  assert.deepEqual(w.map((r) => r.pos), [1, 1, 3]);                                  // the tied pair both show 1
});

// synthetic plan-access records (the app's own list is replaced for these tests)
const REC = (k, tasks, plan, app, planName, usd, limits) => ({ k, tasks, plan, app, planName, usd, limits, url: "https://example.com/official-plans", checked: "2026-11-22", what: "test" });
function loadWith(recs) { const A = load(); A.planAccess.length = 0; recs.forEach((r) => A.planAccess.push(r)); return A; }

test("v17o: tiebreakers in order - lower verified cost, fewer usage limits, the fresher test", () => {
  const A = loadWith([REC("claude-sonnet-5-5", ["writing"], "free", "Claude", "Free", 0, "limited"),
    REC("claude-opus-5-5", ["writing"], "paid", "Claude", "Max", 100, "limited"),
    REC("gpt-6-1-terra", ["webdev"], "paid", "ChatGPT", "Plus", 20, "limited"), REC("claude-sonnet-5-5", ["webdev"], "paid", "Claude", "Pro", 20, "none")]);
  const cost = A.taskOrder("writing", "any");                                        // both costs verified: $0 beats $100
  assert.equal(cost.list[0].k, "claude-sonnet-5-5");
  assert.equal(cost.note, "Similar scores; this one costs less.");
  const lim = A.taskOrder("webdev", "any");                                          // same verified cost: fewer limits
  assert.equal(lim.list[0].k, "claude-sonnet-5-5");
  assert.equal(lim.note, "Similar scores; this one has fewer usage limits.");
  const fresh = A.taskOrder("coding", "any");                                        // no records: cost / limits unknown -> fresher test
  assert.equal(fresh.list[0].k, "claude-fable-5-1");
  assert.equal(fresh.note, "Similar scores; this one has the fresher test.");
  const pics = A.taskOrder("pictures", "any");                                       // no tie: the cross-check only adds a note
  assert.equal(pics.list[0].k, "gpt-image-2-5-sunburst");
  assert.equal(pics.note, "DesignArena ranks a different model first.");
  const ag = A.agentBestCard(false);                                                 // Agents tab: same rules
  assert.match(ag, /Terminal work/);
  assert.match(ag, /Similar scores; first in the test&#39;s own order\./);
});

test("v17o: an unknown plan cost never decides a cheaper winner", () => {
  // only Sonnet has a record ($0): Opus's cost is unknown, so cost (and limits) can't decide; the test's own order does
  const A = loadWith([REC("claude-sonnet-5-5", ["writing"], "free", "Claude", "Free", 0, "limited")]);
  const o = A.taskOrder("writing", "any");
  assert.equal(o.list[0].k, "claude-opus-5-5");
  assert.equal(o.note, "Similar scores; first in the test's own order.");
  assert.equal(o.list.find((r) => r.k === "claude-opus-5-5").cost, null);
  // a paid record whose price can't be found is eligible for Paid but its cost stays unknown
  const B = loadWith([REC("claude-sonnet-5-5", ["writing"], "paid", "Claude", "No such plan", null, null),
    REC("claude-opus-5-5", ["writing"], "paid", "Claude", "Max", 100, null)]);
  const p = B.taskOrder("writing", "paid");
  assert.deepEqual(p.list.map((r) => r.k), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.equal(p.note, "Similar scores; first in the test's own order.");
});

test("v17o: Paid needs an exact record - a maker with paid plans is not proof", () => {
  const A = load();                                                                  // the app's real records
  const paid = A.taskOrder("chat", "paid").list.map((r) => r.k);
  assert.ok(paid.includes("gemini-4-carbon"), "Carbon: Google AI Ultra names it");
  assert.ok(!paid.includes("gemini-4-argon"), "Argon: Google sells plans, but no page names Argon");
  assert.ok(!paid.includes("claude-sonnet-5-5"), "Sonnet 5.5: the pricing page names the family only");
  const html = finderFor(A, "chat", "paid");
  assert.match(html, /Included in Google AI Ultra \$99\.99\/month/);                // cents kept, never rounded to $100
  assert.doesNotMatch(html, /Paid plan needed/);
  const anyHtml = finderFor(A, "chat", "any");                                      // Any: still the test's order; unknown = unconfirmed
  assert.deepEqual(fullOrder(anyHtml), ["gemini-4-carbon", "gemini-4-argon", "claude-sonnet-5-5"]);
  assert.match(anyHtml, /Plan access unconfirmed/);
  assert.doesNotMatch(anyHtml, /Paid plan needed|May be limited on free/);
  for (const r of A.planAccess) {                                                    // every shipped record is complete
    assert.ok(r.k && r.tasks.length && /^(free|paid)$/.test(r.plan) && r.app && r.planName, r.k);
    assert.match(r.url, /^https:\/\/(gemini\.google|support\.claude\.com|help\.openai\.com)\//, r.k);
    assert.match(r.checked, /^\d{4}-\d\d-\d\d$/, r.k);
  }
});

test("v17o: access for one task or feature never spills into another", () => {
  const A = load();
  // GPT-6 Astra is confirmed only in Codex (coding): not for Writing
  assert.ok(!A.taskOrder("writing", "paid").list.some((r) => r.k === "gpt-6-astra"));
  const B = loadWith([REC("gemini-omni-flash", ["video"], "paid", "Google Flow", "Google AI Plus", 4.99, null)]);
  assert.deepEqual(B.taskOrder("video_image", "paid").list.map((r) => r.k), []);      // video-from-text record: not image-to-video
  assert.deepEqual(B.taskOrder("video_x", "paid").list.map((r) => r.k), []);
});

test("v17o: the old / unconfirmed voice record can't pass Free; nothing verified -> no unfiltered #1", () => {
  const A = load();
  assert.ok(!Object.values(A.freeModels).some((m) => Object.keys(m).length), "no free record without an official page");
  assert.ok(!A.planAccess.some((r) => r.k === "gpt-live-1" || /voice/.test(r.tasks.join())));
  const v = finderFor(A, "voice", "free");
  assert.equal(startName(v), null);
  assert.doesNotMatch(v, /GPT Live 1/);
  assert.match(v, /id="fpaid" data-fplan="paid">See paid options</);
  assert.match(finderFor(A, "voice", "any"), /<b>GPT Live 1<\/b>[\s\S]*Plan access unconfirmed/);
  const r = finderFor(A, "research", "free");
  assert.equal(startName(r), null);
  assert.doesNotMatch(r, /Amazon Web Search Agent/);
  assert.match(r, /id="fpaid" data-fplan="paid">See paid options</);
  assert.match(r, /Also free, not tested for this task: ChatGPT Free, Claude Free, Gemini Free\./);   // apps only
  assert.doesNotMatch(r, /Sonnet 5\.5|GPT-6 Luna|Gemini Flash\)/);                      // no unconfirmed exact free model
  const rp = finderFor(A, "research", "paid");
  assert.equal(startName(rp), null);
  assert.doesNotMatch(rp, /Amazon Web Search Agent/);
  assert.match(rp, /id="fany" data-fplan="any">See all options</);
  assert.equal(startName(finderFor(A, "research", "any")), "Amazon Web Search Agent");   // Any: the test's own #1 as usual
});

test("v17o: Free / Paid keep only verified models; scores never change", () => {
  const A = loadWith([REC("claude-sonnet-5-5", ["chat"], "free", "Claude", "Free", 0, "limited")]);
  const any = A.taskOrder("chat", "any").list, free = A.taskOrder("chat", "free").list;
  assert.deepEqual(free.map((r) => r.k), ["claude-sonnet-5-5"]);
  for (const r of free) assert.equal(r.s, any.find((x) => x.k === r.k).s);
  assert.match(finderFor(A, "chat", "free"), /Free with limits in Claude/);
  assert.deepEqual(A.taskOrder("chat", "paid").list, []);                             // free-only record: not a paid one
});

test("v17o: 'early data' label and source + date on every pick", () => {
  const A = load(), d = data();
  const v = finderFor(A, "video", "any");
  assert.match(v, /Source: LMArena · Text-to-video · Nov\u00a019 <span class="badge none early">early data<\/span>/);
  assert.doesNotMatch(finderFor(A, "chat", "any"), /early data/);
  for (const p of d.picks.filter((x) => x.rules === "v17o")) {
    const card = A.pickCard(p, "p-");
    assert.match(card, /<p class="why">[^<]+<\/p>/, p.id);
    assert.match(card, /<p class="note psrc">Source: [^<]+ · [^<]+ · [A-Z][a-z]{2}\u00a0\d{1,2}/, p.id);
  }
  const ag = A.agentBestCard(false);
  assert.match(ag, /Professional tasks/);
  assert.match(ag, /<small class="psrc">Source: Mercor · APEX-Agents, pass@1 \(fully passed\) · Nov\u00a022 <span class="badge none early">early data<\/span><\/small>/);
});

test("v17o: old data (before v17o) still works the old way", () => {
  const old = JSON.parse(read("data/data.json"));
  if (!old.agents) old.agents = AGENTS_SAMPLE();
  for (const p of old.picks) delete p.rules;
  const A = load(old);
  assert.ok(A.view("best", false).length > 1000);
  assert.ok(A.view("best", true).length > 1000);
  assert.ok(A.finderHtml().indexOf("Your best match") >= 0 || A.finderHtml().indexOf("Start here") >= 0);
});

// ---- the REAL data/data.json (built by scripts/update_data.py) against the live app's v17o contract. The root app's
// old tests render a pinned pre-v17o file instead (tests/fixtures/data_pre_v17o.json); this one checks the real file.
const EARLY = new Set(["video", "video_image", "voice", "pro"]);
const FINDER_IDS = new Set(["research", "video", "video_image", "voice"]);
function v17oShape(t, where) {
  const m = t.main || {};
  assert.ok(m.name && /^https:\/\//.test(m.url || "") && (m.date || m.checked), where + ": main test without name, link or date");
  const rk = t.ranked || [];
  assert.ok(rk.length && rk.every((r) => r.k && r.n && typeof r.s === "number" && r.r >= 1), where + ": ranked list missing or incomplete");
  rk.slice(1).forEach((b, i) => {
    const a = rk[i];
    assert.ok(a.s >= b.s && (b.s === a.s ? b.r === a.r : b.r > a.r), where + ": not in published order at " + b.k);
  });
  assert.ok(t.why && t.winners && t.winners[0].k === rk[0].k, where + ": no why, or the winner isn't the test's #1");
  assert.equal(t.early, EARLY.has(t.id), where + ": early-data label");
  if (t.cross) assert.ok([true, false].includes(t.cross.agree) && /^https:\/\//.test(t.cross.url) && t.cross.date && !("s" in t.cross), where + ": cross-check");
}
test("v17o: the real data/data.json meets the live app's contract", () => {
  const d = JSON.parse(read("data/data.json"));
  assert.ok(d.picks.some((p) => p.rules === "v17o"),
    "data/data.json predates v17o: run scripts/update_data.py first (the root app's old tests use tests/fixtures/data_pre_v17o.json)");
  assert.equal(d.v, 3);
  assert.ok(read("data/data.js").startsWith("window.AI_DATA="));
  for (const p of d.picks) {
    if (p.id === "cheap") { assert.notEqual(p.rules, "v17o"); continue; }               // the cheap pick keeps its own rule
    assert.equal(p.rules, "v17o", p.id);
    assert.notEqual(p.status, "best", p.id);
    v17oShape(p, "pick " + p.id);
    assert.ok(p.boards.length === 1 && p.boards.every((b) => /^https:\/\//.test(b.url) && b.date), p.id + ": one main test, linked and dated");
  }
  for (const t of d.finder.tasks) {
    assert.ok(FINDER_IDS.has(t.id), "unexpected Find-your-AI task: " + t.id);           // no Translation
    assert.equal(t.rules, "v17o", t.id);
    v17oShape(t, "finder " + t.id);
    assert.ok(!t.note, t.id + ": no translation note");
  }
  const b = d.agents.best;
  assert.equal(b.rules, "v17o");
  assert.ok(b.groups.length && b.groups.every((g) => g.rules === "v17o" && ["terminal", "pro"].includes(g.id)));
  b.groups.forEach((g) => v17oShape(g, "agents " + g.id));
  assert.deepEqual(b.testsUsed, b.groups.map((g) => ({ terminal: "vals_tb4", pro: "apex" })[g.id]));
  // sources: no Epoch, no WMT26, no AA while it's off; every listed source has a status; the core ones are always there
  const ids = d.sources.map((x) => x.id);
  for (const gone of ["epoch", "wmt26", "eqbench", "lechmazur"]) assert.ok(!ids.includes(gone) && !(gone === "wmt26" && d.status.wmt26), gone + " still listed");
  if (!d.aaEnabled) assert.ok(!ids.includes("aa") && !d.status.aa);
  for (const id of ids.concat(["lmarena", "livebench", "mercor", "designarena", "openrouter", "official", "prices", "news", "agentapps"]))
    assert.ok(d.status[id], "no status for " + id);
  for (const id of ["mercor", "designarena"]) assert.ok(ids.includes(id), id + " not credited");
  // the live app renders it: every view, no blanks; one #1 per task on Top Picks and Find your AI; no Translation chip
  const A = load(d);
  for (const t of ["best", "cost", "releases", "news", "agents"]) for (const more of [false, true])
    assert.doesNotMatch(A.view(t, more), /undefined|NaN|Something went wrong/, t);
  assert.doesNotMatch(A.view("sources", false), /undefined|NaN|Epoch AI|WMT26/);
  for (const p of d.picks.filter((x) => x.rules === "v17o").concat(d.finder.tasks)) {
    const html = finderFor(A, p.id, "any");
    assert.equal(startName(html), A.taskOrder(p.id, "any").list[0].n, p.id);
    assert.deepEqual(fullOrder(html), A.taskOrder(p.id, "any").list.map((r) => r.k), p.id);
    if (d.picks.includes(p)) assert.equal(A.pickTitle(p), startName(html), p.id);
  }
  assert.doesNotMatch(finderFor(A, d.picks[0].id, "any"), /value="translate"|>Translation</);
  assert.match(A.agentBestCard(false), /Terminal work|Professional tasks/);
});
