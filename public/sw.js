const CACHE = 'hiroshi-sensei-shell-v10-browser-install';
const SHELL = ['./','./index.html','./style.css','./app.js','./app-config.js','./app-updates.js','./android-release.js','./install.js','./practice.js','./teacher-core.js','./teacher-ui.js','./manifest.webmanifest','./assets/icon.svg','./assets/icon-180.png','./assets/icon-192.png','./assets/icon-512.png','./assets/hiroshi-sensei.png','./assets/room.svg','./assets/walk.svg','./assets/travel.svg'];
const SHELL_URLS = new Set(SHELL.map(file => new URL(file, self.registration.scope).href));
const needsFreshCode = url => url.pathname.endsWith('/') || /\.(?:html|js|css)$/i.test(url.pathname);
// A new worker must not install an old HTML/module copy from the browser's HTTP
// cache. Artwork keeps normal HTTP caching; it does not change the update UI.
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(file => {
  const url = new URL(file, self.registration.scope);
  return needsFreshCode(url) ? new Request(url.href, {cache:'reload'}) : url.href;
}))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('hiroshi-sensei-shell-') || key.startsWith('koa-shell-')) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const appPath = new URL(self.registration.scope).pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(appPath)) return;
  let relativePath;
  try { relativePath = decodeURIComponent(url.pathname.slice(appPath.length)); } catch { return; }
  if (/^api(?:\/|$)/i.test(relativePath)) return;
  // Versioned HTML/module URLs share the shell's canonical cache entry, so an
  // offline launch can load the same versioned imports as its saved HTML.
  const canonical = new URL(url.href); canonical.search = ''; canonical.hash = '';
  const shellURL = SHELL_URLS.has(canonical.href) ? canonical.href : null;
  event.respondWith(fetch(event.request, shellURL && needsFreshCode(url) ? {cache:'no-store'} : undefined).then(response => {
    if(response.ok && shellURL) {
      const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(shellURL,copy)));
    }
    return response;
  }).catch(async () => (await caches.match(shellURL || event.request)) || (event.request.mode === 'navigate' ? caches.match(new URL('./index.html',self.registration.scope).href) : Response.error())));
});
