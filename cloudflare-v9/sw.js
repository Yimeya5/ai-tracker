// AI Pro service worker.
// Data (data/*) = network first, saved copy when offline, so the app never shows old data while online.
// App files = saved copy first for speed, refreshed in the background on every visit.
const VERSION = "v13-2026-11-05";
const SHELL = "ait-shell-" + VERSION;
const DATA = "ait-data";
const SHELL_FILES = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./terms.html", "./refund.html", "./privacy.html"];
const OPTIONAL = ["./terms.html", "./refund.html", "./privacy.html"];   // saved when present; never block the install
// The data is saved at install too, so the app works offline after ONE visit. Same key as the fetch handler below
// (origin + path, no ?t=). A missing file never stops the install.
const DATA_FILES = ["./data/data.js", "./data/data.json"];
function dataKey(u) { const url = new URL(u, self.location); return url.origin + url.pathname; }

self.addEventListener("install", (e) => {
  const shell = caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.filter((f) => !OPTIONAL.includes(f)))
    .then(() => Promise.all(OPTIONAL.map((f) => c.add(f).catch(() => null)))));
  const data = caches.open(DATA).then((c) => Promise.all(DATA_FILES.map((f) =>
    fetch(f, { cache: "no-store" }).then((res) => (res.ok ? c.put(dataKey(f), res) : null)).catch(() => null))));
  e.waitUntil(Promise.all([shell, data]).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                // POST (Ask all 4) is never touched
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;     // other sites (the Ask helper, the AIs) are never cached

  if (url.pathname.includes("/data/")) {
    const key = dataKey(req.url);   // ignore ?t= so one saved copy per file
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(key, copy)); }
          return res;
        })
        .catch(() => caches.match(key).then((hit) => hit || new Response("", { status: 504 })))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return res; })
        .catch(() => hit || caches.match("./index.html"));
      return hit || net;
    })
  );
});
