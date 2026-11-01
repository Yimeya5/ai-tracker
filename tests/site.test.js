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
