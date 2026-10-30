import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync, createSign, createHash, randomBytes} from 'node:crypto';
import {createHiroshiHandler, buildChatRequest, buildLessonRequest, parseLessonReply, parseResponseStream, validateIdentity} from '../connection-server/core.mjs';
import {LESSONS} from '../public/teacher-core.js';
import {LEARNING_LESSON_SCHEMA} from '../public/learning-schema.js';

const origin = 'https://erendragneel.github.io';
const backend = 'https://koa-personal-companion.elijio-villa.chatgpt.site/api/hiroshi';
const clientId = 'oaiapp_fixture_registered';
const OWNER = 'fixture-sites-owner', ACCESS = 'fixture-protected-access', REFRESH = 'fixture-protected-refresh';
const nonce = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const keys = generateKeyPairSync('rsa', {modulusLength: 2048});
const jwks = {keys: [{...keys.publicKey.export({format: 'jwk'}), kid: 'fixture-signing-key', use: 'sig', alg: 'RS256'}]};
const migration = await readFile(new URL('../connection-server/schema.sql', import.meta.url), 'utf8');
function jwt(at, changes = {}) {
  const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: 'fixture-signing-key'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iss: 'https://auth.openai.com', aud: clientId, sub: 'fixture-account', nonce, iat: Math.floor(at / 1000) - 1, exp: Math.floor(at / 1000) + 3600, ...changes})).toString('base64url');
  const data = `${header}.${payload}`; return `${data}.${createSign('RSA-SHA256').update(data).sign(keys.privateKey).toString('base64url')}`;
}
function d1() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(migration);
  const adapter = {
    sqlite,
    recordWrites: [],
    prepare(sql) {
      let values = [];
      return {
        bind(...parameters) { values = parameters; return this; },
        async first() {
          const row = sqlite.prepare(sql).get(...values) || null;
          if (row && /^UPDATE hiroshi_connection SET record=\?/i.test(sql)) adapter.recordWrites.push(JSON.parse(values[0]));
          return row;
        },
        async run() { return {success: true, meta: sqlite.prepare(sql).run(...values)}; },
        async all() { return {results: sqlite.prepare(sql).all(...values)}; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return adapter;
}
const completed = value => new Response(`data: ${JSON.stringify({type: 'response.completed', response: {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: value}]}]}})}\n\n`, {headers: {'Content-Type': 'text/event-stream'}});
const reply = {reply: 'こんにちは。', reading: 'Konnichiwa.', translation: 'Hello.', correction: 'A useful correction.', suggestions: Array.from({length: 3}, () => ({text: 'はい。', meaning: 'Yes.'}))};
const payload = () => ({language: 'ja', level: 'beginner', scene: 'cafe', corrections: false, messages: [{role: 'user', content: 'こんにちは'}]});
const lessonBrief = () => ({skillId: 'introductions', difficulty: 1,
  weaknesses: [{prompt: 'Introduce yourself.', feedback: 'Put the name before desu.', answer: 'Ken wa'}],
  recentLessons: ['A different first lesson'], profile: {name: 'Learner', interests: 'music'}, reason: 'Practise the missed introduction.'});
const lessonFixture = () => {
  const {title, objective, explanation, examples, practice, homework} = LESSONS[0];
  const exercise = item => ({id: item.id, type: item.type, prompt: item.prompt, options: item.options || [], answers: item.answers, sample: item.sample, explanation: item.explanation});
  return {skillId: 'introductions', difficulty: 1, title, objective, explanation, examples, practice: practice.map(exercise), homework: homework.map(exercise)};
};

function fixture() {
  const DB = d1(), env = {DB, HIROSHI_ALLOW_OWNER_BOOTSTRAP: '1'};
  const clock = {at: Date.now()};
  const remote = {calls: [], refreshes: 0, smokes: 0, lessons: 0, jwksFailures: 0, smokeFailures: 0, rejectRefresh: false, holdRefresh: null};
  const fetchImpl = async (url, options = {}) => {
    remote.calls.push({url, options});
    assert.equal(options.redirect, 'manual');
    assert.equal(new Headers(options.headers).get('Accept'), url.endsWith('/responses') ? 'text/event-stream' : 'application/json');
    if (url.endsWith('/.well-known/jwks.json')) {
      if (remote.redirectJwks) return new Response(null, {status: 302, headers: {Location: 'https://fixture-unapproved.invalid/keys'}});
      if (remote.jwksFailures-- > 0) throw new Error('private-request-data-do-not-expose');
      return Response.json(jwks);
    }
    if (url.endsWith('/models')) {
      assert.match(new Headers(options.headers).get('Authorization'), /^Bearer fixture-protected-access/);
      if (remote.modelHtml) return new Response('<html>fixture-private-provider-detail</html>', {headers: {'Content-Type': 'text/html'}});
      if (remote.largeCatalog) return Response.json({padding: 'x'.repeat(600_000), models: [{slug: 'fixture-offered-model', display_name: 'Fixture model', visibility: 'list'}]});
      if (remote.denyModels) return Response.json({error: {code: 'unauthorized', message: 'private-request-data-do-not-expose'}}, {status: 401});
      if (remote.holdCatalog) { remote.catalogEntered?.(); await remote.holdCatalog; }
      return Response.json({models: [{slug: 'fixture-offered-model', display_name: 'Fixture model', visibility: 'list'}, {slug: 'hidden', display_name: 'Hidden', visibility: 'hidden'}]});
    }
    if (url.endsWith('/responses')) {
      const body = JSON.parse(options.body);
      assert.equal(body.store, false); assert.equal(body.stream, true);
      assert.ok(!('temperature' in body));
      if (body.text?.format?.name === 'hiroshi_personal_lesson') assert.equal(body.max_output_tokens, 6000);
      else assert.ok(!('max_output_tokens' in body));
      if (body.input.at(-1).content === 'Say exactly: Connected.') {
        remote.smokes++;
        if (remote.smokeFailures-- > 0) return new Response('data: {"type":"response.failed","response":{"error":{"code":"private-provider-error"}}}\n\n', {headers: {'Content-Type': 'text/event-stream'}});
        return completed('Connected.');
      }
      if (remote.pauseChat) {
        remote.chatSignal = options.signal; remote.chatEntered?.();
        await new Promise((resolve, reject) => { if (options.signal.aborted) reject(new Error('Cancelled')); else options.signal.addEventListener('abort', () => reject(new Error('Cancelled')), {once: true}); });
      }
      if (body.text?.format?.name === 'hiroshi_personal_lesson') {
        remote.lessons++; remote.lessonPayload = body;
        if (remote.lessonFailure === 'limit') return Response.json({error: {code: 'private-provider-error', message: 'fixture-private-provider-detail'}}, {status: 429});
        if (remote.lessonFailure === 'incomplete') return new Response('data: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n', {headers: {'Content-Type': 'text/event-stream'}});
        if (remote.lessonFailure === 'refusal') return new Response('data: {"type":"response.refusal.delta","delta":"fixture-private-provider-detail"}\n\n', {headers: {'Content-Type': 'text/event-stream'}});
        return completed(remote.lessonRaw ?? JSON.stringify(lessonFixture()));
      }
      return completed(JSON.stringify(reply));
    }
    if (url.endsWith('/oauth/token')) {
      remote.refreshes++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), clientId); assert.equal(body.get('refresh_token'), remote.refreshes === 1 ? REFRESH : REFRESH + '-renewed');
      assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('resource'), 'https://api.openai.com/v1');
      assert.equal(body.has('scope'), false);
      if (remote.holdRefresh) await remote.holdRefresh;
      if (remote.rejectRefresh) return Response.json({error: 'invalid_grant', error_description: 'private-request-data-do-not-expose'}, {status: 400});
      return Response.json({access_token: `${ACCESS}-renewed`, refresh_token: `${REFRESH}-renewed`, token_type: 'Bearer', expires_in: remote.expiresIn ?? 3600,
        ...(remote.refreshIdentity ? {id_token: jwt(clock.at)} : {})});
    }
    throw new Error('Unexpected destination');
  };
  const create = () => createHiroshiHandler({fetchImpl, now: () => clock.at});
  let handle = create();
  const call = (path, {body, method = body === undefined ? 'GET' : 'POST', token, owner, from = origin, extraHeaders = {}, signal} = {}) => {
    const headers = {...(from ? {Origin: from} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...extraHeaders};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (owner) headers['oai-authenticated-user-id'] = owner;
    return handle(new Request(backend + path, {method, headers, signal, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), env);
  };
  async function begin() {
    const state = randomBytes(32).toString('base64url');
    const response = await call('/bootstrap/start?' + new URLSearchParams({state, challenge, return_to: 'http://127.0.0.1:32123/setup/callback'}), {owner: OWNER, from: null});
    assert.equal(response.status, 302);
    const callback = new URL(response.headers.get('location')); assert.equal(callback.searchParams.get('state'), state);
    const code = callback.searchParams.get('code');
    const begun = await call('/bootstrap/begin', {from: null, body: {code, verifier}});
    assert.equal(begun.status, 200); const data = await begun.json();
    const registered = await call('/bootstrap/register', {from: null, token: data.importToken, body: {clientId}});
    assert.equal(registered.status, 200);
    return {...data, code};
  }
  async function seal(start, changes = {}) {
    const publicKey = await crypto.subtle.importKey('jwk', start.publicKeyJwk, {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
    const aes = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const value = {clientId, hostId: start.hostId, nonce, receivedAt: clock.at,
      tokens: {access_token: ACCESS, refresh_token: REFRESH, id_token: jwt(clock.at), token_type: 'Bearer', expires_in: 3600, scope: 'openid email offline_access resource.invoke chatgpt.tokens.use.direct'}, ...changes};
    const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, aes, new TextEncoder().encode(JSON.stringify(value)));
    const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP', publicKey, await crypto.subtle.exportKey('raw', aes));
    return {iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url'), wrappedKey: Buffer.from(wrappedKey).toString('base64url')};
  }
  async function finish(start, envelope) { return call('/bootstrap/finish', {from: null, token: start.importToken, body: envelope}); }
  async function connect() {
    const state = randomBytes(32).toString('base64url');
    const response = await call('/connect?' + new URLSearchParams({state, challenge, return_to: `${origin}/hiroshi-sensei/`}), {owner: OWNER, from: null});
    assert.equal(response.status, 302); const fragment = new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1));
    assert.equal(fragment.get('state'), state);
    const exchanged = await call('/exchange', {body: {code: fragment.get('hiroshi_code'), verifier}});
    assert.equal(exchanged.status, 200); return {...await exchanged.json(), code: fragment.get('hiroshi_code')};
  }
  async function ready() { const start = await begin(), envelope = await seal(start); const response = await finish(start, envelope); assert.equal(response.status, 200, await response.clone().text()); return {start, envelope, device: await connect()}; }
  return {DB, env, clock, remote, call, begin, seal, finish, connect, ready, reopen() {handle = create();}};
}

test('first owner must be explicitly enabled privately and another identity cannot take over', async () => {
  const f = fixture(); f.env.HIROSHI_ALLOW_OWNER_BOOTSTRAP = '0';
  const query = '/bootstrap/start?' + new URLSearchParams({state: nonce, challenge, return_to: 'http://127.0.0.1:32123/setup/callback'});
  assert.equal((await f.call(query, {owner: OWNER, from: null})).status, 403);
  assert.equal(f.DB.sqlite.prepare("SELECT * FROM hiroshi_config WHERE key='owner'").get(), undefined);
  f.env.HIROSHI_ALLOW_OWNER_BOOTSTRAP = '1'; await f.begin();
  f.env.HIROSHI_ALLOW_OWNER_BOOTSTRAP = '0';
  assert.equal((await f.call(query, {owner: 'other-owner', from: null})).status, 403);
  const anonymous = await f.call(query, {from: null});
  assert.equal(anonymous.status, 302); assert.ok(anonymous.headers.get('location').startsWith('/signin-with-chatgpt?return_to='));
});

test('setup and device returns reject foreign origins, credentials and forged paths', async () => {
  const f = fixture();
  for (const returnTo of ['https://evil.invalid/', 'http://localhost:32123/setup/callback', 'http://127.0.0.1:32123/auth/callback', 'http://user@127.0.0.1:32123/setup/callback', 'http://127.0.0.1:32123/setup/callback#private']) {
    assert.equal((await f.call('/bootstrap/start?' + new URLSearchParams({state: nonce, challenge, return_to: returnTo}), {owner: OWNER, from: null})).status, 400);
  }
  assert.equal((await f.call('/connect?' + new URLSearchParams({state: nonce, challenge, return_to: 'https://evil.invalid/'}), {owner: OWNER, from: null})).status, 400);
});

test('setup codes are PKCE-bound and one-use; registration persists before the token exchange', async () => {
  const f = fixture(), start = await f.begin();
  const reused = await f.call('/bootstrap/begin', {from: null, body: {code: start.code, verifier}}); assert.equal(reused.status, 401);
  const conflict = await f.call('/bootstrap/register', {from: null, token: start.importToken, body: {clientId: 'oaiapp_other'}}); assert.equal(conflict.status, 409);
  const second = await f.begin(); assert.equal(second.pendingClientId, clientId); assert.equal(second.hostId, start.hostId);
  const tokens = f.DB.sqlite.prepare('SELECT hash FROM hiroshi_imports').all();
  assert.ok(tokens.every(row => row.hash !== start.importToken));
});

test('real sealed import validates identity and a completed inference before exposing connected state', async () => {
  const f = fixture(), {start, envelope, device} = await f.ready();
  assert.equal(f.remote.smokes, 1);
  const summary = await (await f.call('/status', {token: device.sessionToken})).json();
  assert.equal(summary.configured, true); assert.equal(summary.provider, 'chatgpt');
  assert.equal(summary.model, 'fixture-offered-model');
  const models = await (await f.call('/models', {token: device.sessionToken})).json(); assert.equal(models.models.length, 1);
  for (const secret of [ACCESS, REFRESH, 'fixture-account', jwt(f.clock.at)]) assert.ok(!JSON.stringify(summary).includes(secret));
  const saved = f.DB.sqlite.prepare('SELECT * FROM hiroshi_imports').get();
  assert.equal(saved.private_key, null); assert.equal(saved.payload, null); assert.equal(saved.record, null);
  const retry = await f.finish(start, envelope); assert.equal(retry.status, 200); assert.equal((await retry.json()).verified, true); assert.equal(f.remote.smokes, 1);
  const changed = await f.finish(start, {...envelope, ciphertext: envelope.ciphertext + 'a'}); assert.equal(changed.status, 409);
  assert.ok(f.DB.sqlite.prepare('SELECT hash FROM hiroshi_devices').get().hash !== device.sessionToken);
});

test('wrong identity nonce cannot establish a session or make a model request', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start, {nonce: randomBytes(32).toString('base64url')});
  const response = await f.finish(start, envelope); assert.equal(response.status, 401);
  assert.equal(f.DB.sqlite.prepare('SELECT * FROM hiroshi_connection').get(), undefined);
  assert.equal(f.remote.smokes, 0); assert.ok(!f.remote.calls.some(item => item.url.endsWith('/models')));
});

test('temporary JWKS and model smoke failures resume the sealed grant without repeating OAuth', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start);
  f.remote.jwksFailures = 1;
  const failed = await f.finish(start, envelope); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private-request-data'));
  assert.equal(f.DB.sqlite.prepare('SELECT * FROM hiroshi_connection').get(), undefined);
  f.remote.smokeFailures = 1;
  const smokeFailed = await f.finish(start, envelope); assert.equal(smokeFailed.status, 502);
  const pending = f.DB.sqlite.prepare('SELECT * FROM hiroshi_imports').get(); assert.ok(pending.record); assert.equal(pending.result, null);
  assert.equal(f.DB.sqlite.prepare('SELECT * FROM hiroshi_connection').get(), undefined);
  f.reopen(); const retry = await f.finish(start, envelope); assert.equal(retry.status, 200); assert.equal((await retry.json()).connected, true);
});

test('a fresh owner setup recovers an unfinished encrypted grant and revokes the lost helper capability', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start);
  f.remote.jwksFailures = 1;
  const failed = await f.finish(start, envelope);
  assert.equal(failed.status, 503);
  const diagnostic = await failed.json();
  assert.equal(diagnostic.error.stage, 'identity');
  assert.ok(!JSON.stringify(diagnostic).includes('private-request-data'));
  const expires = f.DB.sqlite.prepare('SELECT expires_at FROM hiroshi_imports').get().expires_at;
  const resumed = await f.begin();
  assert.equal(resumed.resumeAvailable, true);
  assert.notEqual(resumed.importToken, start.importToken);
  assert.equal(f.DB.sqlite.prepare('SELECT count(*) AS count FROM hiroshi_imports').get().count, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT expires_at FROM hiroshi_imports').get().expires_at, expires);
  assert.ok(!['d', 'p', 'q', 'dp', 'dq', 'qi'].some(key => key in resumed.publicKeyJwk));
  assert.equal((await f.finish(start, envelope)).status, 401);
  assert.equal((await f.finish(resumed, {})).status, 200);
  assert.equal((await f.finish(resumed, {})).status, 200);
  assert.equal(f.remote.smokes, 1);
});

test('empty import bodies cannot bypass setup or revive an expired unfinished grant', async () => {
  const f = fixture(), start = await f.begin();
  assert.equal((await f.finish(start, {})).status, 400);
  const envelope = await f.seal(start); f.remote.jwksFailures = 1;
  assert.equal((await f.finish(start, envelope)).status, 503);
  f.clock.at += 600_001;
  const next = await f.begin();
  assert.equal(next.resumeAvailable, undefined);
  assert.equal((await f.finish(next, {})).status, 400);
  assert.equal(f.remote.smokes, 0);
});

test('manual upstream redirect handling works at the edge and never follows an identity redirect', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start);
  f.remote.redirectJwks = true;
  const failed = await f.finish(start, envelope);
  assert.equal(failed.status, 502);
  const diagnostic = await failed.json();
  assert.equal(diagnostic.error.code, 'CHATGPT_SERVICE_ERROR');
  assert.equal(diagnostic.error.stage, 'identity');
  assert.equal(f.remote.calls.length, 1);
  assert.ok(f.remote.calls[0].url.endsWith('/.well-known/jwks.json'));
  assert.equal(f.DB.sqlite.prepare('SELECT * FROM hiroshi_connection').get(), undefined);
  assert.equal(f.remote.smokes, 0);
});

test('validated unfinished grants remain recoverable by their owner after the original helper capability expires', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start);
  f.remote.smokeFailures = 1;
  assert.equal((await f.finish(start, envelope)).status, 502);
  assert.ok(f.DB.sqlite.prepare('SELECT record FROM hiroshi_imports').get().record);
  f.clock.at += 600_001;
  assert.equal((await f.finish(start, {})).status, 401);
  const resumed = await f.begin();
  assert.equal(resumed.resumeAvailable, true);
  assert.equal((await f.finish(resumed, {})).status, 200);
  assert.equal(f.remote.smokes, 2);
});

test('model catalogs above 512 KiB are bounded at 2 MiB and HTML failures expose only static metadata', async () => {
  const f = fixture(), start = await f.begin(), envelope = await f.seal(start);
  f.remote.modelHtml = true;
  const failed = await f.finish(start, envelope);
  assert.equal(failed.status, 502);
  const diagnostic = await failed.json();
  assert.equal(diagnostic.error.diagnosticType, 'InvalidJson');
  assert.equal(diagnostic.error.responseType, 'html');
  assert.equal(diagnostic.error.stage, 'models');
  assert.ok(!JSON.stringify(diagnostic).includes('fixture-private-provider-detail'));
  f.remote.modelHtml = false; f.remote.largeCatalog = true;
  assert.equal((await f.finish(start, envelope)).status, 200);
});

test('invalid stream diagnostics distinguish format failures without exposing response contents', async () => {
  const cases = [
    ['application/json', '{"private-provider-data":"fixture-secret"}', 'AI_INCOMPLETE', undefined, 'json'],
    ['text/html', '<html>fixture-secret</html>', 'AI_INCOMPLETE', undefined, 'html'],
    ['text/event-stream', 'data: fixture-secret\n\n', 'AI_INVALID_STREAM', 'EventJson', 'event-stream'],
    ['text/event-stream', 'data: ' + 'x'.repeat(256 * 1024 + 1) + '\n\n', 'AI_INVALID_STREAM', 'EventTooLarge', 'event-stream'],
    ['text/event-stream', 'data: {"type":"response.output_text.delta","delta":{"private":"fixture-secret"}}\n\n', 'AI_INVALID_STREAM', 'DeltaType', 'event-stream'],
  ];
  for (const [contentType, body, code, diagnosticType, responseType] of cases) {
    await assert.rejects(parseResponseStream(new Response(body, {headers: {'Content-Type': contentType}})), failure => {
      assert.equal(failure.code, code);
      assert.equal(failure.diagnosticType, diagnosticType);
      assert.equal(failure.responseType, responseType);
      assert.equal(failure.mediaType, contentType);
      assert.equal(failure.eventCount, code === 'AI_INCOMPLETE' ? 0 : 1);
      assert.ok(!failure.message.includes('fixture-secret'));
      return true;
    });
  }
});

test('complete SSE remains verifiable when a gateway omits or replaces its MIME header', async () => {
  const stream = await completed('Connected.').text();
  for (const contentType of [null, 'text/plain', 'application/octet-stream']) {
    const response = new Response(new TextEncoder().encode(stream), {headers: contentType ? {'Content-Type': contentType} : {}});
    assert.equal(await parseResponseStream(response), 'Connected.');
  }
  await assert.rejects(parseResponseStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', {headers: {'Content-Type': 'text/plain'}})), {code: 'AI_INCOMPLETE', mediaType: 'text/plain', eventCount: 1});
});

test('device code is consumed once, wrong PKCE cannot redeem it, and disconnect preserves the plan connection', async () => {
  const f = fixture(), {device} = await f.ready();
  assert.equal((await f.call('/exchange', {body: {code: device.code, verifier}})).status, 401);
  assert.equal((await f.call('/exchange', {body: {code: device.code, verifier: 'x'.repeat(64)}})).status, 401);
  assert.equal((await f.call('/disconnect', {token: device.sessionToken, body: {}})).status, 200);
  assert.equal((await f.call('/status', {token: device.sessionToken})).status, 401);
  assert.ok(f.DB.sqlite.prepare('SELECT verified_at FROM hiroshi_connection').get().verified_at);
  assert.equal((await f.connect()).sessionToken.length, 43);
});

test('saved connection survives handler restart and rotates expiring credentials without browser authorization', async () => {
  const f = fixture(), {device} = await f.ready();
  const row = f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get(), record = JSON.parse(row.record); record.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record)); f.reopen();
  assert.equal((await f.call('/models', {token: device.sessionToken})).status, 200); assert.equal(f.remote.refreshes, 1);
  const renewed = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  assert.equal(renewed.refreshToken, REFRESH + '-renewed'); assert.equal(renewed.accessToken, ACCESS + '-renewed');
  assert.equal(renewed.expiresAt, f.clock.at + 3_600_000);
  assert.equal((await f.call('/models', {token: device.sessionToken})).status, 200); assert.equal(f.remote.refreshes, 1);
});

test('a durable refresh lease prevents two runtimes from consuming one rotating refresh token', async () => {
  const f = fixture(), {device} = await f.ready();
  const record = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); record.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record));
  let release; f.remote.holdRefresh = new Promise(resolve => {release = resolve;});
  const first = f.call('/models', {token: device.sessionToken});
  while (!f.remote.refreshes) await new Promise(resolve => setImmediate(resolve));
  f.reopen(); const second = await f.call('/models', {token: device.sessionToken}); assert.equal(second.status, 503); assert.equal(f.remote.refreshes, 1);
  release(); assert.equal((await first).status, 200);
  assert.equal(f.DB.sqlite.prepare('SELECT lease_until FROM hiroshi_connection').get().lease_until, 0);
});

test('revoked refresh credentials do not revive the saved connection or expose provider bodies', async () => {
  const f = fixture(), {device} = await f.ready();
  const record = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); record.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record)); f.remote.rejectRefresh = true;
  const response = await f.call('/models', {token: device.sessionToken}); assert.equal(response.status, 401); assert.ok(!(await response.text()).includes('private-request-data'));
  assert.equal((await f.call('/status', {token: device.sessionToken})).status, 409);
});

test('CORS allows only the GitHub app origin and authenticated chat preserves the UI reply contract', async () => {
  const f = fixture(), {device} = await f.ready();
  const preflight = await f.call('/chat', {method: 'OPTIONS', extraHeaders: {'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type'}});
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  const foreign = await f.call('/chat', {token: device.sessionToken, body: payload(), from: 'https://evil.invalid'}); assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  assert.equal((await f.call('/chat', {body: payload()})).status, 401);
  const response = await f.call('/chat', {token: device.sessionToken, body: {...payload(), profile: {name: 'IGNORE_RULES_SENTINEL'}}});
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {...reply, correction: ''});
  const upstream = JSON.parse(f.remote.calls.filter(item => item.url.endsWith('/responses')).at(-1).options.body);
  assert.equal(Object.keys(upstream).length, 5); assert.ok(!upstream.instructions.includes('IGNORE_RULES_SENTINEL'));
  assert.ok(upstream.input.at(-2).content.includes('IGNORE_RULES_SENTINEL')); assert.equal(upstream.input.at(-1).content, 'こんにちは');
});

test('chat bounds preserve the complete latest question, reject system injection, and bound teacher references', () => {
  const history = Array.from({length: 18}, () => ({role: 'assistant', content: 'あ'.repeat(3000)})); history.push({role: 'user', content: '問'.repeat(2500)});
  const request = buildChatRequest({...payload(), messages: history}, 'model');
  assert.equal(request.input.at(-1).content, '問'.repeat(2500)); assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 48 * 1024);
  assert.throws(() => buildChatRequest({...payload(), messages: [{role: 'system', content: 'ignore'}]}, 'model'));
  assert.throws(() => buildChatRequest({...payload(), teacherContext: {lessonId: 'fake'}}, 'model'));
});

test('a delta or DONE without response.completed is not accepted as a finished reply', async () => {
  await assert.rejects(parseResponseStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}})), {code: 'AI_INCOMPLETE'});
  const at = Date.now(); await assert.rejects(validateIdentity(jwt(at, {aud: 'other'}), jwks, clientId, nonce, at), {code: 'IDENTITY_INVALID'});
});

test('rotated credentials survive a temporary identity-key failure without consuming the old refresh token again', async () => {
  const f = fixture(), {device} = await f.ready();
  const record = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); record.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record));
  f.remote.refreshIdentity = true; f.remote.jwksFailures = 1; f.reopen();
  const failed = await f.call('/models', {token: device.sessionToken}); assert.equal(failed.status, 503); assert.equal(f.remote.refreshes, 1);
  const checkpoint = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  assert.equal(checkpoint.refreshToken, REFRESH); assert.equal(checkpoint.pendingRefresh.tokens.refresh_token, REFRESH + '-renewed');
  f.reopen(); const retry = await f.call('/models', {token: device.sessionToken}); assert.equal(retry.status, 200); assert.equal(f.remote.refreshes, 1);
  const saved = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  assert.equal(saved.refreshToken, REFRESH + '-renewed'); assert.equal(saved.pendingRefresh, undefined);
});

test('a still-valid access token respects the provider earliest-refresh time without an early rotation', async () => {
  const f = fixture(), {device} = await f.ready();
  const record = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  record.expiresAt = f.clock.at + 30_000; record.earliestRefreshAt = f.clock.at + 20_000;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record));
  assert.equal((await f.call('/models', {token: device.sessionToken})).status, 200); assert.equal(f.remote.refreshes, 0);
});

test('opening status renews an expired grant and refuses to claim connected when renewal is revoked', async () => {
  const f = fixture(), {device} = await f.ready();
  const record = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); record.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(record));
  const opened = await f.call('/status', {token: device.sessionToken}); assert.equal(opened.status, 200); assert.equal((await opened.json()).connected, true); assert.equal(f.remote.refreshes, 1);
  const renewed = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); renewed.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(renewed));
  f.remote.rejectRefresh = true;
  const originalCall = f.remote.calls.length;
  const response = await f.call('/status', {token: device.sessionToken});
  assert.equal(response.status, 401); assert.ok(!(await response.text()).includes('"connected":true'));
  assert.ok(f.remote.calls.length > originalCall);
});

test('cancelling a phone chat aborts its upstream request without discarding the saved connection', async () => {
  const f = fixture(), {device} = await f.ready(), controller = new AbortController();
  f.remote.pauseChat = true;
  let entered; const started = new Promise(resolve => {entered = resolve;}); f.remote.chatEntered = entered;
  const pending = f.call('/chat', {token: device.sessionToken, body: payload(), signal: controller.signal});
  await started; controller.abort();
  assert.equal((await pending).status, 503); assert.equal(f.remote.chatSignal.aborted, true);
  assert.ok(f.DB.sqlite.prepare('SELECT verified_at FROM hiroshi_connection').get().verified_at);
});

test('status admission failure cannot be reported as a connected account', async () => {
  const f = fixture(), {device} = await f.ready(); f.remote.denyModels = true;
  const response = await f.call('/status', {token: device.sessionToken});
  assert.equal(response.status, 401); const safe = await response.text();
  assert.ok(!safe.includes('"configured":true')); assert.ok(!safe.includes('private-request-data'));
});

test('a status check cannot overwrite a newer setup or model choice while the catalog is in flight', async () => {
  const f = fixture(), {device} = await f.ready();
  let release, entered; f.remote.holdCatalog = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {entered = resolve;}); f.remote.catalogEntered = entered;
  const status = f.call('/status', {token: device.sessionToken}); await started;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET selected=?,verified_at=?').run('newer-model-choice', f.clock.at + 1);
  release(); assert.equal((await status).status, 503);
  assert.equal(f.DB.sqlite.prepare('SELECT selected FROM hiroshi_connection').get().selected, 'newer-model-choice');
});

test('an expired refresh checkpoint preserves its receipt time then rotates the replacement token once', async () => {
  const f = fixture(), {device} = await f.ready();
  const initial = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); initial.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(initial));
  f.remote.refreshIdentity = true; f.remote.jwksFailures = 1; f.reopen();
  assert.equal((await f.call('/models', {token: device.sessionToken})).status, 503);
  const receivedAt = f.clock.at;
  assert.equal(f.remote.refreshes, 1);
  f.clock.at += 3_601_000; f.reopen();
  const recovered = await f.call('/status', {token: device.sessionToken});
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).connected, true);
  assert.equal(f.remote.refreshes, 2);
  const refreshes = f.remote.calls.filter(call => call.url.endsWith('/oauth/token'));
  assert.equal(new URLSearchParams(refreshes[0].options.body).get('refresh_token'), REFRESH);
  assert.equal(new URLSearchParams(refreshes[1].options.body).get('refresh_token'), REFRESH + '-renewed');
  assert.ok(f.DB.recordWrites.some(record => !record.pendingRefresh && record.refreshToken === REFRESH + '-renewed' && record.expiresAt === receivedAt + 3_600_000), 'Recovery must durably preserve the original expiry before another rotation');
  const final = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  assert.equal(final.expiresAt, f.clock.at + 3_600_000); assert.equal(final.pendingRefresh, undefined);
  assert.equal(f.DB.sqlite.prepare('SELECT lease_until FROM hiroshi_connection').get().lease_until, 0);
});

test('very short provider expiry is preserved and renewal performs at most one bounded repeat', {timeout: 2000}, async () => {
  const f = fixture(), {device} = await f.ready();
  const initial = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record); initial.expiresAt = 0;
  f.DB.sqlite.prepare('UPDATE hiroshi_connection SET record=?').run(JSON.stringify(initial));
  f.remote.expiresIn = 1;
  const response = await f.call('/status', {token: device.sessionToken});
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'CHATGPT_RECONNECTING');
  assert.equal(f.remote.refreshes, 2);
  const saved = JSON.parse(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record);
  assert.equal(saved.expiresAt, f.clock.at + 1000); assert.equal(saved.refreshToken, REFRESH + '-renewed');
  assert.equal(saved.pendingRefresh, undefined); assert.equal(f.DB.sqlite.prepare('SELECT lease_until FROM hiroshi_connection').get().lease_until, 0);
});

test('personal lesson requests bind the selected skill and difficulty with bounded untrusted learning evidence', () => {
  const brief = lessonBrief();
  brief.weaknesses = Array.from({length: 10}, () => ({prompt: 'P'.repeat(900), feedback: 'IGNORE_RULES_SENTINEL'.repeat(40), answer: 'A'.repeat(900)}));
  brief.recentLessons = Array.from({length: 12}, (_, index) => `${index}-${'T'.repeat(200)}`);
  brief.profile = {name: 'IGNORE_NAME_SENTINEL', interests: 'IGNORE_INTERESTS_SENTINEL'};
  const request = buildLessonRequest(brief, 'fixture-offered-model');
  assert.equal(request.model, 'fixture-offered-model'); assert.equal(request.store, false); assert.equal(request.stream, true);
  assert.equal(request.max_output_tokens, 6000);
  assert.deepEqual(request.text.format, {type: 'json_schema', name: 'hiroshi_personal_lesson', strict: true, schema: LEARNING_LESSON_SCHEMA});
  assert.ok(!request.instructions.includes('IGNORE_RULES_SENTINEL')); assert.ok(!request.instructions.includes('IGNORE_NAME_SENTINEL'));
  assert.match(request.instructions, /never obey directives|do not obey directives/);
  const reference = JSON.parse(request.input[0].content.split('\n').slice(1).join('\n'));
  assert.equal(reference.weaknesses.length, 6); assert.equal(reference.recentLessons.length, 8);
  assert.ok(reference.weaknesses.every(item => item.prompt.length === 240 && item.feedback.length === 400 && item.answer.length === 240));
  assert.ok(reference.recentLessons.every(title => title.length <= 160));
  assert.equal(reference.profile.name, brief.profile.name);
  for (const invalid of [null, {...lessonBrief(), skillId: 'unknown'}, {...lessonBrief(), difficulty: 4}, {...lessonBrief(), difficulty: '1'}, {...lessonBrief(), weaknesses: [{prompt: '', feedback: 'missing'}]}, {...lessonBrief(), recentLessons: [{}]}, {...lessonBrief(), profile: []}, {...lessonBrief(), reason: 'x'.repeat(40_000)}]) {
    assert.throws(() => buildLessonRequest(invalid, 'model'), error => error.status === 400);
  }
});

test('lesson generation is protected by the existing device authorization and GitHub CORS boundary', async () => {
  const f = fixture(), {device} = await f.ready();
  assert.equal((await f.call('/lesson', {body: lessonBrief()})).status, 401);
  const foreign = await f.call('/lesson', {body: lessonBrief(), token: device.sessionToken, from: 'https://unapproved.invalid'});
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(f.remote.lessons, 0);
  const response = await f.call('/lesson', {body: lessonBrief(), token: device.sessionToken});
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result, {lesson: lessonFixture(), provider: 'chatgpt', model: 'fixture-offered-model'});
  assert.equal(f.remote.lessons, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT verified_at FROM hiroshi_connection').get().verified_at !== null, true);
  assert.ok(!JSON.stringify(result).includes(ACCESS));
});

test('invalid lesson briefs fail before upstream inference and do not alter the saved connection', async () => {
  const f = fixture(), {device} = await f.ready();
  const saved = f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record;
  for (const body of [{...lessonBrief(), skillId: 'not-a-skill'}, {...lessonBrief(), difficulty: 0}, {...lessonBrief(), weaknesses: [{prompt: 'hello'}]}]) {
    const response = await f.call('/lesson', {body, token: device.sessionToken});
    assert.equal(response.status, 400); assert.equal(f.remote.lessons, 0);
  }
  assert.equal(f.DB.sqlite.prepare('SELECT record FROM hiroshi_connection').get().record, saved);
});

test('generated lessons must match their selected step and never smuggle extra mastery or progress fields', () => {
  const brief = lessonBrief(), lesson = lessonFixture();
  assert.deepEqual(parseLessonReply(JSON.stringify(lesson), brief), lesson);
  for (const invalid of ['partial', JSON.stringify({...lesson, skillId: 'cafe-requests'}), JSON.stringify({...lesson, difficulty: 3}), JSON.stringify({...lesson, mastery: 100}), JSON.stringify({...lesson, homework: []}), JSON.stringify({...lesson, practice: lesson.practice.map(item => ({...item, id: 'duplicate'}))}), JSON.stringify({...lesson, title: 'x'.repeat(141)}), 'x'.repeat(41 * 1024)]) {
    assert.throws(() => parseLessonReply(invalid, brief), error => error.code === 'AI_INVALID_LESSON' && !error.message.includes(invalid));
  }
  assert.throws(() => parseLessonReply(JSON.stringify(lesson), {...brief, recentLessons: [' MEET SOMEONE NEW!!! ']}), {code: 'AI_REPEATED_LESSON'});
});

test('incomplete, refused, limited and malformed generated lessons return safe errors without losing saved authorization', async () => {
  for (const [mode, status, code] of [['incomplete', 502, 'AI_INCOMPLETE'], ['refusal', 422, 'AI_REFUSAL'], ['limit', 429, 'CHATGPT_LIMIT_REACHED'], ['malformed', 502, 'AI_INVALID_LESSON']]) {
    const f = fixture(), {device} = await f.ready();
    f.remote.lessonFailure = mode;
    if (mode === 'malformed') f.remote.lessonRaw = JSON.stringify({...lessonFixture(), unapproved: 'fixture-private-provider-detail'});
    const response = await f.call('/lesson', {body: lessonBrief(), token: device.sessionToken});
    assert.equal(response.status, status);
    const result = await response.json(); assert.equal(result.error.code, code);
    assert.ok(!JSON.stringify(result).includes('fixture-private-provider-detail'));
    assert.ok(f.DB.sqlite.prepare('SELECT verified_at FROM hiroshi_connection').get().verified_at);
    assert.equal(f.remote.lessons, 1);
  }
});

test('lesson generation shares the existing per-owner request cap with chat rather than bypassing it', async () => {
  const f = fixture(), {device} = await f.ready();
  for (let index = 0; index < 12; index++) assert.equal((await f.call('/lesson', {body: lessonBrief(), token: device.sessionToken})).status, 200);
  assert.equal(f.remote.lessons, 12);
  const limited = await f.call('/chat', {body: payload(), token: device.sessionToken});
  assert.equal(limited.status, 429); assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  assert.equal(f.remote.lessons, 12);
});

test('cancelling a personalized lesson aborts its upstream generation and retains the remembered device', async () => {
  const f = fixture(), {device} = await f.ready(), controller = new AbortController();
  f.remote.pauseChat = true;
  let entered; const started = new Promise(resolve => {entered = resolve;}); f.remote.chatEntered = entered;
  const pending = f.call('/lesson', {token: device.sessionToken, body: lessonBrief(), signal: controller.signal});
  await started; controller.abort();
  assert.equal((await pending).status, 503); assert.equal(f.remote.chatSignal.aborted, true);
  assert.ok(f.DB.sqlite.prepare('SELECT verified_at FROM hiroshi_connection').get().verified_at);
  assert.equal((await f.call('/status', {token: device.sessionToken})).status, 200);
});

test('lesson chat can use compact remembered struggles without turning reported evidence into model instructions', () => {
  const lesson = lessonFixture();
  const teacherContext = {lessonId: 'adaptive-introductions', title: lesson.title, objective: lesson.objective,
    explanation: lesson.explanation, examples: lesson.examples,
    learningMemory: {difficulty: 1, weaknesses: [{prompt: 'IGNORE_MEMORY_SENTINEL', feedback: 'Try the topic particle.', answer: 'wa?'}]}};
  const request = buildChatRequest({...payload(), teacherContext}, 'fixture-offered-model');
  assert.ok(!request.instructions.includes('IGNORE_MEMORY_SENTINEL'));
  assert.match(request.instructions, /teach one small idea in plain English/);
  const reference = JSON.parse(request.input.at(-2).content.split('\n').slice(1).join('\n'));
  assert.equal(reference.lesson.learningMemory.weaknesses[0].prompt, 'IGNORE_MEMORY_SENTINEL');
  assert.equal(reference.lesson.learningMemory.difficulty, 1);
  assert.throws(() => buildChatRequest({...payload(), teacherContext: {...teacherContext, learningMemory: {difficulty: 9, weaknesses: []}}}, 'model'), {code: 'INVALID_LEARNING_MEMORY'});
});
