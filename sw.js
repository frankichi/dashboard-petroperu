// Service Worker del Panel de Suministro — ahora con caché real del
// "app shell" (el propio index.html + librerías de CDN que casi nunca
// cambian) usando la estrategia "stale-while-revalidate":
//   1. Si hay una copia en caché, se sirve INMEDIATAMENTE (instantáneo,
//      sin esperar red) — esto es lo que hace que la app se sienta
//      rápida al reabrirla desde el ícono del celular.
//   2. En paralelo, SIEMPRE se pide una copia fresca por red y se
//      guarda en caché para la PRÓXIMA vez — así nunca te quedas
//      pegado en una versión vieja para siempre, solo "un abrir de
//      retraso" como máximo.
// Los DATOS del dashboard (Google Apps Script) NUNCA se cachean acá —
// eso ya lo maneja el propio backend (Code.gs, caché de 10 min) y debe
// seguir viniendo de la red cada vez para no mostrar información vieja.
const CACHE_NAME = 'pp-suministro-shell-v1';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ¿Esta petición es candidata a cachearse? Solo el documento HTML
// principal (navegación/misma-página) y archivos estáticos de
// librerías (CDN). NUNCA la API de Google Apps Script — esos datos
// siempre deben pedirse frescos.
function _esCacheable(request, url) {
  if (url.hostname.indexOf('script.google.com') !== -1) return false;
  if (url.hostname.indexOf('script.googleusercontent.com') !== -1) return false;
  if (request.method !== 'GET') return false;
  return true;
}

self.addEventListener('fetch', function(event) {
  var url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (!_esCacheable(event.request, url)) return; // deja pasar tal cual (ej. la API de datos)

  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(networkResp) {
          if (networkResp && networkResp.ok) cache.put(event.request, networkResp.clone());
          return networkResp;
        }).catch(function() {
          return cached;
        });
        // Estrategia clave: si hay copia en caché, se entrega YA
        // (instantáneo) y la red solo actualiza el caché para la
        // próxima — el usuario no espera la red en absoluto.
        return cached || fetchPromise;
      });
    })
  );
});
