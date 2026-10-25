import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const pagesURL = 'https://erendragneel.github.io/hiroshi-sensei/';

function workerHarness(cacheNames = []) {
  const handlers = new Map();
  const cacheKeys = new Set(cacheNames);
  const deleted = [];
  const fetched = [];
  const stored = [];
  let claimed = false;
  const caches = {
    keys: async () => [...cacheKeys],
    delete: async name => { deleted.push(name); return cacheKeys.delete(name); },
    open: async name => {
      cacheKeys.add(name);
      return {
        addAll: async () => {},
        put: async (request, response) => { stored.push({ name, url: request.url, response }); },
      };
    },
    match: async () => undefined,
  };
  const self = {
    registration: { scope: pagesURL },
    location: { origin: new URL(pagesURL).origin },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: async () => {},
    addEventListener: (type, handler) => handlers.set(type, handler),
  };
  vm.runInNewContext(workerSource, {
    self, caches, URL, Response,
    fetch: async request => { fetched.push(request.url); return new Response('Hiroshi asset'); },
  }, { filename: 'public/sw.js' });
  return {
    cacheKeys, deleted, fetched, stored,
    get claimed() { return claimed; },
    async activate() {
      const waits = [];
      handlers.get('activate')({ waitUntil: promise => waits.push(promise) });
      await Promise.all(waits);
    },
    async fetch(url, method = 'GET') {
      const waits = [];
      let response;
      handlers.get('fetch')({
        request: { url, method, mode: 'cors' },
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
  const worker = workerHarness([...retained, 'hiroshi-sensei-shell-v6-phone-chat', 'hiroshi-sensei-shell-v5', 'hiroshi-sensei-shell-v4', 'koa-shell-v4-install']);
  await worker.activate();
  for (const name of retained) assert.ok(worker.cacheKeys.has(name), `${name} must survive`);
  assert.ok(worker.cacheKeys.has('hiroshi-sensei-shell-v6-phone-chat'));
  assert.deepEqual(worker.deleted.sort(), ['hiroshi-sensei-shell-v4', 'hiroshi-sensei-shell-v5', 'koa-shell-v4-install']);
  assert.equal(worker.claimed, true);
});

test('Hiroshi worker ignores Language Miner, sibling paths, foreign origins, and API requests', async () => {
  const worker = workerHarness();
  for (const url of [
    'https://erendragneel.github.io/language-miner/',
    'https://erendragneel.github.io/language-miner/index.html',
    'https://erendragneel.github.io/language-miner/language-miner-icon-192.png',
    'https://erendragneel.github.io/hiroshi-sensei-other/index.html',
    'https://erendragneel.github.io/api/status',
    'https://example.com/hiroshi-sensei/app.js',
  ]) assert.equal(await worker.fetch(url), undefined, `Must not intercept ${url}`);
  assert.equal(await worker.fetch(`${pagesURL}app.js`, 'POST'), undefined);
  assert.deepEqual(worker.fetched, []);
  assert.deepEqual(worker.stored, []);
});

test('Hiroshi worker serves and caches its own shell within its scope', async () => {
  const worker = workerHarness();
  const url = `${pagesURL}app.js`;
  const response = await worker.fetch(url);
  assert.equal(await response.text(), 'Hiroshi asset');
  assert.deepEqual(worker.fetched, [url]);
  assert.deepEqual(worker.stored.map(({ name, url }) => ({ name, url })), [{ name: 'hiroshi-sensei-shell-v6-phone-chat', url }]);
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
