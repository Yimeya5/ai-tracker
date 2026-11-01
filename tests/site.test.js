const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const R = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");

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

test("service worker fetches data from the network first", () => {
  const s = read("sw.js");
  assert.match(s, /\/data\//);
  assert.match(s, /fetch\(req, \{ cache: "no-store" \}\)/);
});

test("data has every section with real content", () => {
  const d = JSON.parse(read("data/data.json"));
  for (const k of ["arena", "aa", "releases", "news", "trending", "best", "labs", "week"]) assert.ok(d[k], "missing " + k);
  assert.ok(d.arena.boards.length >= 8);
  assert.ok(d.aa.models.length >= 25);
  assert.ok(d.best.length >= 8);
  assert.ok(d.news.items.length >= 8);
  assert.ok(d.best.every((b) => b.pick && b.src && b.why));
  const js = read("data/data.js");
  assert.ok(js.startsWith("window.AI_DATA="));
  assert.doesNotMatch(read("index.html") + read("app.js"), /lorem ipsum|TODO|\[PLACEHOLDER\]|undefined</);
});

test("workflow runs daily and deploys pages", () => {
  const w = read(".github/workflows/update.yml");
  assert.match(w, /cron: "0 10 \* \* \*"/);
  assert.match(w, /deploy-pages/);
  assert.match(w, /git diff --cached --quiet/);
});

// ---- simple 3-tab front end
const vm = require("node:vm");
function loadApp() {
  const ctx = { AI_DATA: JSON.parse(read("data/data.json")) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("app.js"), ctx);
  return ctx.AITracker;
}

test("app has exactly 3 tabs and no tables", () => {
  const h = read("index.html");
  const tabs = [...h.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(tabs, ["today", "best", "more"]);
  assert.doesNotMatch(h + read("app.js") + read("app.css"), /<table|<th\b|<td\b/);
});

test("old #links still open the right place", () => {
  const A = loadApp();
  assert.equal(A.routeFor("#today").tab, "today");
  assert.equal(A.routeFor("#home").tab, "today");
  assert.equal(A.routeFor("#best").tab, "best");
  assert.equal(A.routeFor("#more").tab, "more");
  for (const s of ["ranks", "prices", "news", "timeline", "sources"]) {
    const r = A.routeFor("#" + s);
    assert.equal(r.tab, "more", s);
    assert.equal(r.open, s);
  }
  assert.equal(A.routeFor("#main"), null);
});

test("home shows simple picks and 5 short lines", () => {
  const A = loadApp();
  const picks = A.homePicks();
  assert.ok(picks.length >= 3 && picks.length <= 5, "picks: " + picks.length);
  for (const p of picks) { assert.ok(p.name && p.label, p.key); assert.ok(p.why, "no reason for " + p.key); }
  const lines = A.whatsNew();
  assert.equal(lines.length, 5);
  for (const l of lines) assert.doesNotMatch(l.t, /\$|per 1M/);
  const html = A.views.today();
  assert.equal((html.match(/<details class="pick"/g) || []).length, picks.length);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("Best AI and More render every job and section", () => {
  const A = loadApp();
  const d = JSON.parse(read("data/data.json"));
  const best = A.views.best();
  for (const b of d.best) assert.ok(best.includes('id="b-' + b.id + '"'), "missing " + b.id);
  const more = A.views.more();
  for (const s of A.sections) assert.ok(more.includes('id="sec-' + s[0] + '"'), "missing section " + s[0]);
  assert.doesNotMatch(best + more, /undefined|NaN/);
});
