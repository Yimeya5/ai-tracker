// AI Tracker service worker.
// Data (data/*) = network first, saved copy when offline, so the app never shows old data while online.
// App files = saved copy first for speed, refreshed in the background on every visit.
const VERSION = "v7b-2026-11-02";
const SHELL = "ait-shell-" + VERSION;
const DATA = "ait-data";
const SHELL_FILES = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
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
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/data/")) {
    const key = url.origin + url.pathname;   // ignore ?t= so one saved copy per file
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
