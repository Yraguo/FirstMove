const CACHE_NAME = "efficiency-workbench-shell-v4";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/src/brand/xianxing-32.png",
  "/src/brand/xianxing-180.png",
  "/src/brand/xianxing-192.png",
  "/src/brand/xianxing-512.png",
  "/styles/tokens.css",
  "/styles/app.css",
  "/src/main.js",
  "/src/api.js",
  "/src/offline.js",
  "/src/store.js",
  "/src/icons.js",
  "/src/utils.js",
  "/src/views/auth.js",
  "/src/views/agenda.js",
  "/src/views/records.js",
  "/src/views/projects.js",
  "/src/views/me.js",
  "/src/views/search.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS.map((path) => new Request(path, { cache: "reload" })))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("efficiency-workbench-shell-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html")))
  );
});
