// Service Worker del Panel de Suministro
//
// ⚠️ CORREGIDO — bug real confirmado: la versión anterior usaba
// "stale-while-revalidate" para TODO, incluyendo el propio documento
// HTML (index.html / executive.html) — eso significa que SIEMPRE se
// servía la copia guardada en caché primero, sin importar qué tan
// vieja fuera, y la red solo actualizaba el caché "para la próxima
// vez". En la práctica, durante desarrollo activo (subidas frecuentes)
// esto hacía que las actualizaciones nunca se vieran reflejadas de
// inmediato — a veces ni con una recarga, porque el navegador seguía
// entregando la copia vieja mientras el fetch de fondo fallaba
// silenciosamente o nunca llegaba a completarse antes de cerrar la
// pestaña.
//
// Estrategia nueva, distinta según el tipo de archivo:
//   • Documento HTML (index.html / executive.html): RED PRIMERO.
//     Si hay internet, SIEMPRE se pide la versión más nueva del
//     servidor. Solo si la red falla (sin conexión) se usa la copia
//     guardada como respaldo — así nunca te quedas viendo una versión
//     vieja teniendo internet disponible.
//   • Todo lo demás (librerías de CDN, que casi nunca cambian):
//     sigue usando "stale-while-revalidate" (caché primero, más
//     rápido, se actualiza solo en segundo plano) — ahí SÍ tiene
//     sentido porque son archivos que casi nunca cambian.
//
// Los DATOS del dashboard (Google Apps Script) NUNCA se cachean acá —
// eso ya lo maneja el propio backend (Code.gs, caché de 10 min) y debe
// seguir viniendo de la red cada vez para no mostrar información vieja.
const CACHE_NAME = 'pp-suministro-shell-v2'; // ⚠️ versión subida a propósito — esto borra cualquier caché viejo (v1) apenas se active este service worker nuevo

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

function _esCacheable(request, url) {
  // ⚠️ CORREGIDO — bug real confirmado: "Failed to execute 'put' on
  // 'Cache': Request scheme 'chrome-extension' is unsupported". Este
  // chequeo no existía, así que peticiones con esquema distinto a
  // http/https (ej. chrome-extension://, que algunas extensiones del
  // navegador inyectan en la página) pasaban como "cacheable" y luego
  // cache.put() fallaba, porque el Cache API SOLO acepta http/https.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.hostname.indexOf('script.google.com') !== -1) return false;
  if (url.hostname.indexOf('script.googleusercontent.com') !== -1) return false;
  if (request.method !== 'GET') return false;
  return true;
}

// ¿Es el documento HTML principal? (navegación de página completa, o
// una petición explícita de un .html) — a esto se le aplica la
// estrategia de RED PRIMERO. Todo lo demás (CDN, imágenes, etc.) usa
// la estrategia de caché primero de siempre.
function _esDocumentoHTML(request) {
  if (request.mode === 'navigate') return true;
  var dest = request.destination;
  if (dest === 'document') return true;
  return false;
}

self.addEventListener('fetch', function(event) {
  var url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (!_esCacheable(event.request, url)) return; // deja pasar tal cual (ej. la API de datos)

  if (_esDocumentoHTML(event.request)) {
    // RED PRIMERO — nunca sirvas una copia vieja del HTML si hay
    // internet disponible. El caché es solo un respaldo para cuando
    // no hay conexión.
    //
    // ⚠️ CORREGIDO (segunda vuelta) — "red primero" no bastaba por sí
    // solo: fetch() por defecto SIGUE respetando la caché HTTP normal
    // del navegador (la que depende de los encabezados Cache-Control
    // que envía el servidor) — si Vercel sirve el HTML con encabezados
    // de caché agresivos (algo común por defecto en hosting de
    // archivos estáticos), fetch() podía devolver una respuesta de esa
    // caché SIN llegar a tocar la red en absoluto, aunque la lógica de
    // "red primero" estuviera bien. { cache: 'no-store' } obliga a
    // fetch() a ignorar por completo la caché HTTP del navegador y
    // pedir siempre una copia 100% fresca del servidor.
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function(networkResp) {
        if (networkResp && networkResp.ok) {
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, networkResp.clone());
          });
        }
        return networkResp;
      }).catch(function() {
        return caches.open(CACHE_NAME).then(function(cache) {
          return cache.match(event.request);
        });
      })
    );
    return;
  }

  // Todo lo demás (librerías CDN que casi nunca cambian): caché
  // primero, actualiza en segundo plano para la próxima vez.
  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(networkResp) {
          if (networkResp && networkResp.ok) cache.put(event.request, networkResp.clone());
          return networkResp;
        }).catch(function() {
          return cached;
        });
        return cached || fetchPromise;
      });
    })
  );
});
