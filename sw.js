const CACHE_NAME = 'english-reader-pwa-v15-singlefile';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/reader.html'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - EMERGENCY RESET
self.addEventListener('fetch', (event) => {
  // 1. Dış API'leri kesin engelle (Zero-Bug Build Bypass)
  if (event.request.url.includes('google') || event.request.url.includes('allorigins') || event.request.url.includes('corsproxy')) {
    return;
  }

  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // Bypass blob and data URLs (Crucial for EPUB.js rendering)
  if (event.request.url.startsWith('blob:') || event.request.url.startsWith('data:')) return;

  // Skip cross-origin requests, like Dictionary API or EPUB proxies
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response; // Serve from cache
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache successful network responses for same-origin GETs
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Return a basic fallback or nothing on full network failure
      console.warn('Network and cache failed for:', event.request.url);
    })
  );
});
