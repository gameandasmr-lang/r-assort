// Réseau d'abord (pour recevoir les mises à jour), cache en secours si pas de réseau.
// Les demandes passent par `cache: 'no-cache'` : GitHub Pages permet au navigateur de garder un fichier 10 minutes
// (max-age=600), ce qui retardait l'arrivée d'une nouvelle version. Là, le serveur est toujours interrogé
// (réponse légère « inchangé » si le fichier n'a pas bougé).
// À changer à chaque version, avec APP_VERSION dans app.js (un test vérifie qu'ils vont ensemble).
var CACHE = 'reassort-v13';
var FILES = ['./', 'index.html', 'style.css', 'catalog.js', 'logic.js', 'scanner.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== location.origin) return;   // images de picard.fr : le navigateur s'en occupe
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      return response;
    }).catch(function () {
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});
