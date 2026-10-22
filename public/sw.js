// Permite abrir la app sin conexión con los últimos datos descargados.
const CACHE = "pizarra-v4";
const BASE = ["/", "/index.html", "/estilos.css", "/app.js", "/modelo.js", "/ia.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Red primero; si no hay conexión, lo último guardado.
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) {
        const copia = r.clone();
        const clave = url.pathname === "/api/datos" ? "/api/datos" : e.request;
        caches.open(CACHE).then((c) => c.put(clave, copia));
      }
      return r;
    }).catch(() => caches.match(url.pathname === "/api/datos" ? "/api/datos" : e.request)
      .then((r) => r || caches.match("/index.html")))
  );
});
