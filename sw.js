// Service worker: app shell works offline. Google API calls are never cached.
const VERSION = "planner-v1";
const SHELL = ["./", "index.html", "styles.css?v=1", "app.js?v=1", "config.js?v=1", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Fonts: cache first.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // Google APIs and sign-in go straight to the network.
  // Own files: network first so updates arrive, cache as offline fallback.
  e.respondWith(
    fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })
      .catch(async () => (await caches.match(req, { ignoreSearch: req.mode === "navigate" })) || caches.match("index.html"))
  );
});
