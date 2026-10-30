import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const pagesURL = 'https://erendragneel.github.io/hiroshi-sensei/';

function workerHarness(cacheNames = [], {offline = false, cached = {}} = {}) {
  const handlers = new Map();
  const cacheKeys = new Set(cacheNames);
  const deleted = [];
  const fetched = [];
  const fetchOptions = [];
  const installed = [];
  const stored = [];
  const matched = [];
  const contents = new Map(Object.entries(cached).map(([url, body]) => [url, new Response(body)]));
  let claimed = false;
  const caches = {
    keys: async () => [...cacheKeys],
    delete: async name => { deleted.push(name); return cacheKeys.delete(name); },
    open: async name => {
      cacheKeys.add(name);
      return {
        addAll: async requests => { installed.push(...requests); },
        put: async (request, response) => {
          const url = typeof request === 'string' ? request : request.url;
          stored.push({ name, url, response }); contents.set(url, response.clone());
        },
      };
    },
    match: async request => {
      const url = typeof request === 'string' ? request : request.url;
      matched.push(url); return contents.get(url)?.clone();
    },
  };
  const self = {
    registration: { scope: pagesURL },
    location: { origin: new URL(pagesURL).origin },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: async () => {},
    addEventListener: (type, handler) => handlers.set(type, handler),
  };
  vm.runInNewContext(workerSource, {
    self, caches, URL, Request, Response,
    fetch: async (request, options) => {
      fetched.push(request.url); fetchOptions.push(options);
      if (offline) throw new TypeError('Offline');
      return new Response(options?.cache === 'no-store' ? 'Latest Hiroshi code' : 'HTTP-cached Hiroshi artwork');
    },
  }, { filename: 'public/sw.js' });
  return {
    cacheKeys, deleted, fetched, stored, fetchOptions, installed, matched,
    get claimed() { return claimed; },
    async install() {
      const waits = [];
      handlers.get('install')({ waitUntil: promise => waits.push(promise) });
      await Promise.all(waits);
    },
    async activate() {
      const waits = [];
      handlers.get('activate')({ waitUntil: promise => waits.push(promise) });
      await Promise.all(waits);
    },
    async fetch(url, method = 'GET', mode = 'cors') {
      const waits = [];
      let response;
      handlers.get('fetch')({
        request: { url, method, mode },
        waitUntil: promise => waits.push(promise),
        respondWith: promise => { response = promise; },
      });
      const result = response ? await response : undefined;
      await Promise.all(waits);
      return result;
    },
  };
}

test('Hiroshi activation preserves Language Miner and unrelated caches', async () => {
  const retained = ['language-miner-v6.4.185-vocabulary-r1', 'language-miner-update-guardian-meta', 'another-app-shell'];
  const worker = workerHarness([...retained, 'hiroshi-sensei-shell-v17-kana-foundations', 'hiroshi-sensei-shell-v16-adaptive-teacher', 'hiroshi-sensei-shell-v11-chatgpt-session', 'hiroshi-sensei-shell-v8-android-startup', 'hiroshi-sensei-shell-v6-phone-chat', 'hiroshi-sensei-shell-v5', 'hiroshi-sensei-shell-v4', 'koa-shell-v4-install']);
  await worker.activate();
  for (const name of retained) assert.ok(worker.cacheKeys.has(name), `${name} must survive`);
  assert.ok(worker.cacheKeys.has('hiroshi-sensei-shell-v17-kana-foundations'));
  assert.deepEqual(worker.deleted.sort(), ['hiroshi-sensei-shell-v11-chatgpt-session', 'hiroshi-sensei-shell-v16-adaptive-teacher', 'hiroshi-sensei-shell-v4', 'hiroshi-sensei-shell-v5', 'hiroshi-sensei-shell-v6-phone-chat', 'hiroshi-sensei-shell-v8-android-startup', 'koa-shell-v4-install']);
  assert.equal(worker.claimed, true);
});

test('Hiroshi worker ignores Language Miner, sibling paths, foreign origins, and API requests', async () => {
  const worker = workerHarness();
  for (const url of [
    'https://erendragneel.github.io/language-miner/?v=chatgpt',
    'https://erendragneel.github.io/language-miner/index.html',
    'https://erendragneel.github.io/language-miner/language-miner-icon-192.png',
    'https://erendragneel.github.io/hiroshi-sensei-other/index.html?v=chatgpt',
    'https://erendragneel.github.io/api/status',
    `${pagesURL}api/status`,
    `${pagesURL}api/chat`,
    `${pagesURL}api`,
    `${pagesURL}%61pi/status`,
    'https://example.com/hiroshi-sensei/app.js?v=chatgpt',
  ]) assert.equal(await worker.fetch(url), undefined, `Must not intercept ${url}`);
  assert.equal(await worker.fetch(`${pagesURL}app.js`, 'POST'), undefined);
  assert.deepEqual(worker.fetched, []);
  assert.deepEqual(worker.stored, []);
});

test('Hiroshi worker serves and caches its own shell within its scope', async () => {
  const worker = workerHarness();
  const url = `${pagesURL}app.js`;
  const response = await worker.fetch(url);
  assert.equal(await response.text(), 'Latest Hiroshi code');
  assert.deepEqual(worker.fetched, [url]);
  assert.deepEqual(worker.stored.map(({ name, url }) => ({ name, url })), [{ name: 'hiroshi-sensei-shell-v17-kana-foundations', url }]);
});

test('new shell installation reloads code and includes the remembered ChatGPT connection module', async () => {
  const worker = workerHarness();
  await worker.install();
  const installed = new Map(worker.installed.map(request => [typeof request === 'string' ? request : request.url, request]));
  for (const file of ['', 'index.html', 'app.js', 'app-config.js', 'app-updates.js', 'chatgpt-connection.js', 'android-release.js', 'install.js', 'style.css']) {
    const request = installed.get(`${pagesURL}${file}`);
    assert.ok(request instanceof Request, `${file || 'index navigation'} must bypass a fresh but outdated HTTP cache`);
    assert.equal(request.cache, 'reload');
  }
  assert.equal(typeof installed.get(`${pagesURL}assets/hiroshi-sensei.png`), 'string', 'unchanged character art keeps normal HTTP caching');
});

test('HTML, styles, and versioned modules bypass stale HTTP cache while artwork stays cacheable', async () => {
  const worker = workerHarness();
  for (const file of ['', 'index.html', 'style.css', 'app-updates.js', 'app.js?update=chatgpt']) {
    const response = await worker.fetch(`${pagesURL}${file}`);
    assert.equal(await response.text(), 'Latest Hiroshi code');
    assert.equal(worker.fetchOptions.at(-1)?.cache, 'no-store');
  }
  const art = await worker.fetch(`${pagesURL}assets/hiroshi-sensei.png`);
  assert.equal(await art.text(), 'HTTP-cached Hiroshi artwork');
  assert.equal(worker.fetchOptions.at(-1), undefined);
});

test('versioned shell requests store canonically and remain available offline', async () => {
  const online = workerHarness();
  await online.fetch(`${pagesURL}app.js?v=20261025-chatgpt-update`);
  assert.deepEqual(online.stored.map(entry => entry.url), [`${pagesURL}app.js`]);
  const offline = workerHarness([], {offline:true, cached:{
    [`${pagesURL}app.js`]:'Saved application code',
    [`${pagesURL}android-release.js`]:'Saved Android release',
    [`${pagesURL}index.html`]:'Saved game shell',
  }});
  const module = await offline.fetch(`${pagesURL}app.js?v=20261025-chatgpt-update`);
  assert.equal(await module.text(), 'Saved application code');
  assert.equal(offline.matched.at(-1), `${pagesURL}app.js`);
  const release = await offline.fetch(`${pagesURL}android-release.js?v=20261025-chatgpt-update`);
  assert.equal(await release.text(), 'Saved Android release');
  const navigation = await offline.fetch(`${pagesURL}?update=chatgpt`, 'GET', 'navigate');
  assert.equal(await navigation.text(), 'Saved game shell');
});

test('unknown query resources are not normalized into shell cache entries', async () => {
  const online = workerHarness();
  await online.fetch(`${pagesURL}custom-image.png?v=chatgpt`);
  await online.fetch(`${pagesURL}unknown.js?v=chatgpt`);
  assert.deepEqual(online.stored, []);
  assert.deepEqual(online.fetchOptions, [undefined, undefined]);
  const offline = workerHarness([], {offline:true, cached:{[`${pagesURL}unknown.js`]:'Unversioned unrelated code'}});
  const result = await offline.fetch(`${pagesURL}unknown.js?v=chatgpt`);
  assert.equal(result.type, 'error');
  assert.deepEqual(offline.matched, [`${pagesURL}unknown.js?v=chatgpt`]);
});

test('relative manifest IDs give Hiroshi and Language Miner distinct identities on GitHub Pages', () => {
  // Identity fields inspected from the sibling language miner/game-source/manifest.webmanifest.
  // Keep this snapshot portable: repository tests must not require that sibling project.
  const minerManifest = { id: './', name: 'Language Miner', short_name: 'L-Miner', scope: './' };
  const hiroshiManifestURL = `${pagesURL}manifest.webmanifest`;
  const minerManifestURL = 'https://erendragneel.github.io/language-miner/manifest.webmanifest';
  const hiroshiID = new URL(manifest.id, hiroshiManifestURL).href;
  const minerID = new URL(minerManifest.id, minerManifestURL).href;
  assert.equal(hiroshiID, pagesURL);
  assert.equal(minerID, 'https://erendragneel.github.io/language-miner/');
  assert.notEqual(hiroshiID, minerID);
  assert.notEqual(manifest.name, minerManifest.name);
  assert.notEqual(manifest.short_name, minerManifest.short_name);
  assert.equal(new URL(manifest.scope, hiroshiManifestURL).href, pagesURL);
  assert.equal(new URL(manifest.start_url, hiroshiManifestURL).href, pagesURL);
});
