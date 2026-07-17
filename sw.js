// Service Worker mínimo — su única función es existir y responder al
// evento 'fetch' con un passthrough simple. Algunas versiones de
// Chrome/Android exigen un service worker registrado con un manejador
// de 'fetch' como parte de los criterios de "instalabilidad" para
// disparar el evento beforeinstallprompt (el que activa el botón
// "📲 Instalar" del Panel de Suministro). No cachea nada a propósito,
// para no interferir con que el dashboard siempre cargue datos frescos.

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});
