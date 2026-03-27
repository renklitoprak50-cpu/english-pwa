/* --- sw.js: Sıfır Engel Versiyonu --- */
const CACHE_NAME = 'polyglot-cache-v19';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/reader.html',
  'https://cdn.jsdelivr.net/npm/idb@7/build/umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // BYPASS SERVICE WORKER COMPLETELY FOR THESE URLS
  // Fixes "redirected response was used for a request whose redirect mode is not 'follow'"
  if (
    url.includes('allorigins') ||
    url.includes('corsproxy.io') ||
    url.includes('/api/proxy') ||
    url.startsWith('blob:') ||
    url.includes('translate.googleapis.com') ||
    url.startsWith('data:')
  ) {
    return; // Let browser natively handle it
  }

  const isCDN = url.includes('cdn.tailwindcss.com') || 
                url.includes('cdnjs.cloudflare.com') || 
                url.includes('cdn.jsdelivr.net') || 
                url.includes('fonts.googleapis.com') || 
                url.includes('fonts.gstatic.com');

  if (isCDN) {
    // Cache First for CDN and Fonts
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(response => {
          // Allow opaque responses (status 0) for cross-origin resources
          if (!response || (response.status !== 200 && response.status !== 0) || event.request.method !== 'GET') {
             return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          return response;
        });
      })
    );
  } else {
    // Network First for Local App Files
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails (Offline Mode)
          return caches.match(event.request);
        })
    );
  }
});
