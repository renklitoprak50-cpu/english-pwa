/* --- sw.js: Sıfır Engel Versiyonu --- */
const CACHE_NAME = 'polyglot-cache-v16';
const ASSETS_TO_CACHE = ['/', '/index.html', '/reader.html']; // Removed non-existent favicon.ico

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

  // KRİTİK BYPASS: Dış bağlantılar ve Blob/Data URL'lerine ASLA dokunma
  // 'redirect: follow' hatasını çözmek için bypass edilen istekleri doğrudan ağa gönder
  if (url.includes('allorigins') || url.startsWith('blob:') || url.includes('google') || url.startsWith('data:')) {
    event.respondWith(fetch(event.request, { redirect: 'follow' }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});
