// Offline support: keeps the app's own files so it opens without internet.
// Data offline support comes from Firestore's local cache.
const CACHE = 'pump-crm-v2026-10-13';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, so updates show straight away; fall back to the saved copy when offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: false })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./') : undefined))
        .then((hit) => hit || Response.error())),
  );
});
