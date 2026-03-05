/* --- sw.js: Sıfır Engel Versiyonu --- */
const CACHE_NAME = 'polyglot-cache-v16';
const ASSETS_TO_CACHE = ['/', '/index.html', '/reader.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // KRİTİK BYPASS: Dış bağlantılar ve Blob/Data URL'lerine ASLA dokunma
  if (event.request.url.includes('allorigins') || event.request.url.startsWith('blob:')) {
    event.respondWith(fetch(event.request, { redirect: 'follow' }));
    return;
  }

  if (event.request.url.includes('google') ||
    event.request.url.startsWith('data:')) {
    return; // Tarayıcının varsayılan ağ yönetimini kullanmasına izin ver
  }

  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});
