// Service worker minimal untuk Catatan Warung Pro.
// Tugasnya cuma dua: (1) bikin app ini "installable" sebagai PWA, dan
// (2) supaya file inti (HTML/CSS/JS/icon) tetap kebuka cepat & tetap bisa
// dibuka meski koneksi lagi jelek/putus. Data transaksi TIDAK di-cache di
// sini — itu selalu diambil langsung dari API supaya selalu fresh/akurat.

const CACHE_NAME = 'catatan-warung-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani GET untuk file milik app sendiri (same-origin). Request ke
  // Apps Script (API) dan CDN eksternal (Tailwind/SweetAlert2/font) sengaja
  // dibiarkan lewat jaringan biasa apa adanya — supaya data selalu fresh dan
  // tidak ada risiko CORS/opaque-response yang aneh dari cache lintas domain.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      // Cache-first kalau ada (biar cepat), sambil diam-diam refresh dari
      // jaringan di background. Kalau belum ada cache, baru tunggu jaringan.
      return cached || networkFetch;
    })
  );
});
