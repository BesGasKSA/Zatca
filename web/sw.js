/* Service worker for the installed app.
   Pages are fetched from the network first, so every visit gets the latest release;
   the last good copy opens the app when the network is down. Requests to the backend
   (script.google.com) and to other sites are never touched or cached: tax data only
   ever lives in the company's Google Sheet. */
var CACHE = 'ir-shell-v1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
      return res;
    }).catch(function () { return caches.match('./index.html'); }));
    return;
  }
  if (/\/icons\/|manifest\.webmanifest$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
  }
});
