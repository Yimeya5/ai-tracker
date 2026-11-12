// v17l (cloudflare-v9): new short texts, no "It may contain mistakes.", all releases with type labels and Show more
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const R = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");
const AGENTS_SAMPLE = () => JSON.parse(read("tests/fixtures/agents_sample.json"));
const data = () => { const d = JSON.parse(read("data/data.json")); if (!d.agents) d.agents = AGENTS_SAMPLE(); return d; };
function load(d) {
  const ctx = { AI_DATA: d || data() };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("cloudflare-v9/app.js"), ctx);
  return ctx.AITracker;
}
function manyReleases(n) {
  const types = ["text", "image", "video", "voice", "music", "audio", "embeddings", "world"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 10, 10) - i * 5 * 864e5).toISOString().slice(0, 10);
    out.push({ k: "m" + i, n: "Model " + i, o: "OpenAI", d, u: "https://openrouter.ai/x/" + i, src: "OpenRouter", official: false, how: "h", fast: false, ty: types[i % types.length] });
  }
  return out;
}

test("v17l: version bumped in app.js and sw.js (v17m: header sizes)", () => {
  assert.match(read("cloudflare-v9/sw.js"), /const VERSION = "v17m-2026-11-11"/);
  assert.match(read("cloudflare-v9/app.js"), /var VERSION = "v17m-2026-11-11"/);
  assert.equal(load().version, "v17m-2026-11-11");
});

test("v17l2: 'It may contain mistakes.' and the 'Summary written by AI' line are both gone, no empty line left", () => {
  assert.doesNotMatch(read("cloudflare-v9/app.js"), /may contain mistakes/i);
  const A = load(), d = JSON.parse(JSON.stringify(data()));
  d.bignews.items[0].xd = "One.\n\nTwo."; d.bignews.items[0].xdBy = "AI summary";
  A.setData(d);
  const s = A.storyHtml("news", 0);
  assert.doesNotMatch(s, /Summary written by AI/);
  assert.doesNotMatch(s, /mistakes/);
  assert.doesNotMatch(s, /<p class="smeta">\s*<\/p>/);
  assert.match(s, /<p>One\.<\/p><p>Two\.<\/p>/);
  assert.doesNotMatch(read("cloudflare-v9/app.js"), /Summary written by AI/);
});

test("v17l2: a robot model shows a Robotics label", () => {
  const A = load(), d = JSON.parse(JSON.stringify(data()));
  const it = JSON.parse(JSON.stringify(d.releases.items[0]));
  it.n = "Gemini Robotics 2.5"; it.k = "geminirobotics25"; it.ty = "robotics";
  d.releases = { items: [it], all: true, days: null };
  A.setData(d);
  assert.match(A.view("releases", true), /<span class="rtype">Robotics<\/span>/);
});

test("v17l: Agents card says 'The best AI model for agents.'", () => {
  const A = load();
  const h = A.view("agents", false);
  assert.match(h, /The best AI model for agents\./);
  assert.doesNotMatch(h, /The AI model inside an agent\./);
});

test("v17l: See more = 'New Releases' + short sub, no days, no long paragraph; works with old data (days: 60)", () => {
  for (const days of [null, 60]) {
    const A = load(), d = JSON.parse(JSON.stringify(data()));
    d.releases = { items: manyReleases(10), all: days === null, days };
    A.setData(d);
    const h = A.view("releases", true);
    assert.match(h, /<h2>New Releases<\/h2><p class="sub">New AI models, newest first\.<\/p>/);
    assert.doesNotMatch(h, /last \d+ days|Date and link =|Text models only/);
  }
});

test("v17l: all releases, newest first, batches of 40 with Show more, no count note, a type label on every card", () => {
  const A = load(), d = JSON.parse(JSON.stringify(data()));
  const items = manyReleases(130);
  d.releases = { items: items.slice().reverse(), all: true, days: null };          // the app sorts newest first
  A.setData(d);
  const h = A.view("releases", true);
  assert.equal((h.match(/class="relcard"/g) || []).length, 40);
  assert.match(h, /id="relmore"[^>]*>Show more</);
  assert.doesNotMatch(h, /\b(?:of|showing) 130\b|130 (?:models|releases)/i);
  const names = [...h.matchAll(/data-rel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(names.slice(0, 3), ["m0", "m1", "m2"]);
  assert.equal((h.match(/class="rtype"/g) || []).length, 40);
  for (const t of ["Text", "Image", "Video", "Voice", "Music", "Audio", "Embeddings", "World"]) assert.match(h, new RegExp('<span class="rtype">' + t + "</span>"));
  const main = A.view("releases", false);
  assert.equal((main.match(/class="rtype"/g) || []).length, 6);
  assert.doesNotMatch(main, /relmore/);
});

test("v17l: no type label for old data without 'ty'; the model sheet names the type", () => {
  const A = load(), d = JSON.parse(JSON.stringify(data()));
  const items = manyReleases(3); delete items[0].ty;
  d.releases = { items, all: true, days: null };
  A.setData(d);
  const h = A.view("releases", true);
  assert.equal((h.match(/class="rtype"/g) || []).length, 2);
  assert.doesNotMatch(h, /relmore/);                                                 // everything fits: no button
});

test("v17l: the real data has every release ever, newest first, with known types", () => {
  const r = data().releases;
  assert.ok(r.all === true && r.days === null);
  assert.ok(r.items.length > 100, "only " + r.items.length);
  const ds = r.items.map((x) => x.d);
  assert.deepStrictEqual(ds, ds.slice().sort().reverse());
  assert.ok(ds[ds.length - 1] < "2025-01-01", "oldest " + ds[ds.length - 1]);
  const ty = new Set(r.items.map((x) => x.ty));
  for (const t of ty) assert.ok(["text", "image", "video", "voice", "music", "audio", "embeddings", "world", "robotics"].includes(t), t);
  for (const t of ["text", "image", "video"]) assert.ok(ty.has(t), "no " + t);
  assert.ok(r.items.every((x) => !/artificialanalysis/.test(x.u || "")));
});
