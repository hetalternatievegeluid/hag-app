// Eenvoudige service worker: altijd eerst het netwerk, offline de laatst bewaarde versie.
const CACHE = "hag-v3";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/logo.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("/index.html")))
  );
});

// Pushmeldingen
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titel: "Het Alternatieve Geluid", tekst: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titel || "Het Alternatieve Geluid", {
    body: d.tekst || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag, data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const doel = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(lijst => {
    for (const c of lijst) { if (new URL(c.url).origin === self.location.origin) { c.navigate(doel); return c.focus(); } }
    return clients.openWindow(doel);
  }));
});
