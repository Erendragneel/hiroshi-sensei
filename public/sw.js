const CACHE = 'hiroshi-sensei-shell-v5';
const SHELL = ['./','./index.html','./style.css','./app.js','./app-config.js','./install.js','./practice.js','./teacher-core.js','./teacher-ui.js','./manifest.webmanifest','./assets/icon.svg','./assets/icon-180.png','./assets/icon-192.png','./assets/icon-512.png','./assets/hiroshi-sensei.png','./assets/room.svg','./assets/walk.svg','./assets/travel.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('hiroshi-sensei-shell-') || key.startsWith('koa-shell-')) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const appPath = new URL(self.registration.scope).pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(appPath) || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok && SHELL.some(file => new URL(file,self.registration.scope).href === url.href)) {
      const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request,copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
