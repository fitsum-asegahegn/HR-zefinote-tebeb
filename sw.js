const CACHE = "finote-attendance-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./i18n.js",
  "./auth.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

const RUNTIME_LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js",
  "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(APP_SHELL).then(() =>
        Promise.allSettled(RUNTIME_LIBS.map((u) => cache.add(u)))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((netResp) => {
          if (netResp && netResp.status === 200) {
            const copy = netResp.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return netResp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
