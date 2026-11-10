// AI Pro service worker.
// Data (data/*) = network first, saved copy when offline, so the app never shows old data while online.
// App files = saved copy first for speed, refreshed in the background on every visit.
const VERSION = "v17k-2026-11-09";
const SHELL = "ait-shell-" + VERSION;
const DATA = "ait-data";
const SHELL_FILES = ["./", "./app.css", "./app.js", "./tips.js", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./terms.html", "./refund.html", "./privacy.html", "./icons/icon.svg", "./icons/logo.svg"];   // + the maker logos (OPTIONAL, below)
// the makers' logos on New releases (v16f3): saved when present, so they show offline too; never block the install
const MAKER_ICONS = ["./icons/makers/ai21.svg", "./icons/makers/alibaba.svg", "./icons/makers/amazon.svg", "./icons/makers/anthropic.svg", "./icons/makers/apple.svg", "./icons/makers/baidu.svg", "./icons/makers/bytedance.svg", "./icons/makers/cohere.svg", "./icons/makers/deepseek.svg", "./icons/makers/google.svg", "./icons/makers/ibm.svg", "./icons/makers/inception.svg", "./icons/makers/inclusionai.svg", "./icons/makers/liquid-ai.svg", "./icons/makers/meta.svg", "./icons/makers/microsoft.svg", "./icons/makers/minimax.svg", "./icons/makers/mistral.svg", "./icons/makers/moonshot.svg", "./icons/makers/nvidia.svg", "./icons/makers/openai.svg", "./icons/makers/perplexity.svg", "./icons/makers/stepfun.svg", "./icons/makers/tencent.svg", "./icons/makers/xai.svg", "./icons/makers/xiaomi.svg", "./icons/makers/z-ai.svg"];
const OPTIONAL = ["./terms.html", "./refund.html", "./privacy.html", "./icons/icon.svg", "./icons/logo.svg"].concat(MAKER_ICONS);   // saved when present; never block the install
// The data is saved at install too, so the app works offline after ONE visit. Same key as the fetch handler below
// (origin + path, no ?t=). A missing file never stops the install.
const DATA_FILES = ["./data/data.js", "./data/data.json"];
function dataKey(u) { const url = new URL(u, self.location); return url.origin + url.pathname; }

// Pages: Cloudflare Pages answers /terms.html with a 308 to /terms (and /index.html with one to /). A browser refuses
// a REDIRECTED response for a page, so every page is saved as a clean (non-redirected) copy under one key:
// /terms.html and /terms -> /terms (same for refund, privacy); /index.html -> /. No ?query in keys.
function pageKey(u) {
  const url = new URL(u, self.location);
  const path = url.pathname.replace(/\/index\.html$/, "/").replace(/\/(terms|refund|privacy)\.html$/, "/$1");
  return url.origin + path;
}
const HOME = () => pageKey(new URL("./", self.registration.scope).href);
function clean(res) {
  if (!res.redirected) return Promise.resolve(res);
  return res.blob().then((b) => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }));
}
function save(cache, key, res) { return clean(res).then((c) => cache.put(key, c)); }

self.addEventListener("install", (e) => {
  const shell = caches.open(SHELL).then((c) => {
    const get = (f) => fetch(f, { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(f + " " + res.status);
      return save(c, pageKey(f), res);
    });
    return Promise.all(SHELL_FILES.filter((f) => !OPTIONAL.includes(f)).map(get))
      .then(() => Promise.all(OPTIONAL.map((f) => get(f).catch(() => null))));
  });
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

  // app files and pages: the saved clean copy first, refreshed in the background. A redirect itself (a page's
  // "opaqueredirect") is never saved; the page it leads to is, under its own key.
  const key = pageKey(req.url), nav = req.mode === "navigate";
  e.respondWith(
    caches.match(key).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(SHELL).then((c) => save(c, key, copy)); }
          return res;
        })
        .catch(() => hit || (nav ? caches.match(HOME()) : undefined) || Response.error())
        .then((res) => res || Response.error());
      return hit || net;
    })
  );
});
