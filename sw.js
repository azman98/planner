// Service worker: app shell works offline. Google API calls are never cached.
// Bump VERSION on every deploy and add a matching entry to changelog.js; the app compares the two to detect updates.
const VERSION = "planner-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "changelog.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
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
  if (url.searchParams.has("check")) return;  // update checks (sw.js?check=…) are never cached
  // Own files: network first (revalidated past GitHub Pages' 10-minute HTTP cache) so updates arrive, cache as offline fallback.
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match("index.html"))
  );
});
