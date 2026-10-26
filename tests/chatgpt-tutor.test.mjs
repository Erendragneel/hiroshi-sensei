import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHiroshiMcp, HIROSHI_RESOURCE_URI, HIROSHI_RESOURCE_MIME, HIROSHI_LESSON_SCHEMA} from '../chatgpt-tutor/mcp.mjs';
import {HIROSHI_WIDGET_HTML} from '../chatgpt-tutor/widget.mjs';

const ENDPOINT = 'https://koa-personal-companion.elijio-villa.chatgpt.site/mcp';
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const headers = {'Content-Type': 'application/json'};
const rpc = (method, params = {}, id = 1) => ({jsonrpc: '2.0', id, method, params});
const request = (body, extra = {}) => new Request(ENDPOINT, {method: 'POST', headers: {...headers, ...extra}, body: JSON.stringify(body)});
async function call(handle, method, params = {}, extra = {}) { const response = await handle(request(rpc(method, params), extra)); return {status: response.status, body: await response.json(), headers: response.headers}; }
const owner = () => createHiroshiMcp({authorize: async () => true});
const lesson = () => ({
  title: 'A short introduction', explanation: 'Use は to mark the topic. Here it is pronounced wa.',
  japanese: '私はエリジオです。', reading: 'Watashi wa Erijio desu.', translation: 'I am Elijio.',
  tokens: [{text: '私', reading: 'watashi', meaning: 'I', role: 'pronoun'}, {text: 'は', reading: 'wa', meaning: 'topic marker', role: 'particle'}],
  examples: [{japanese: '私は学生です。', reading: 'Watashi wa gakusei desu.', translation: 'I am a student.'}],
  homework: ['Introduce yourself in Japanese.'],
});

test('public discovery and legacy initialize describe a stateless classroom without invoking authorization', async () => {
  let checks = 0; const handle = createHiroshiMcp({authorize: async () => {checks++; return false;}});
  const discover = await call(handle, 'server/discover');
  assert.equal(discover.status, 200);
  assert.equal(discover.body.result.resultType, 'complete');
  assert.ok(discover.body.result.supportedVersions.includes('2026-07-28'));
  assert.equal(discover.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'hiroshi-classroom');
  assert.ok(discover.body.result.capabilities.resources);
  for (const protocolVersion of ['2024-11-05', '2025-03-26', '2025-11-25']) {
    const init = await call(handle, 'initialize', {protocolVersion, clientInfo: {name: 'Fixture client', version: '1.0.0'}, capabilities: {}});
    assert.equal(init.body.result.protocolVersion, protocolVersion);
    assert.equal(init.body.result.serverInfo.name, 'hiroshi-classroom');
  }
  assert.equal(checks, 0);
});

test('modern metadata echoes completion semantics and conflicting headers fail before tool authorization', async () => {
  let checks = 0; const handle = createHiroshiMcp({authorize: async () => {checks++; return true;}});
  const params = {_meta: {[VERSION_KEY]: '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'Fixture', version: '1'}, 'io.modelcontextprotocol/clientCapabilities': {}}};
  const modern = await call(handle, 'tools/list', params, {'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list'});
  assert.equal(modern.body.result.resultType, 'complete');
  for (const extra of [{'MCP-Protocol-Version': '2025-11-25'}, {'Mcp-Method': 'tools/call'}]) {
    const mismatch = await call(handle, 'tools/list', params, extra);
    assert.equal(mismatch.status, 400); assert.equal(mismatch.body.error.code, -32020);
  }
  const unsupported = await call(handle, 'server/discover', {_meta: {[VERSION_KEY]: '1900-01-01'}});
  assert.equal(unsupported.body.error.code, -32022);
  assert.ok(unsupported.body.error.data.supported.includes('2026-07-28'));
  assert.equal(checks, 0);
});

test('tool discovery publishes plain bounded schemas, UI resource links, and read-only annotations', async () => {
  const {body} = await call(createHiroshiMcp(), 'tools/list');
  assert.deepEqual(body.result.tools.map(tool => tool.name), ['open_hiroshi_classroom', 'show_hiroshi_lesson']);
  for (const tool of body.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false); assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool._meta.ui.resourceUri, HIROSHI_RESOURCE_URI);
    assert.equal(tool._meta['openai/outputTemplate'], HIROSHI_RESOURCE_URI);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool._meta['openai/toolInvocation/invoking']); assert.ok(tool._meta['openai/toolInvocation/invoked']);
  }
  assert.deepEqual(body.result.tools[1].inputSchema, HIROSHI_LESSON_SCHEMA);
});

test('public resource is a static template with no request text or authorization state and narrow CSP', async () => {
  const handle = createHiroshiMcp();
  const listed = await call(handle, 'resources/list');
  assert.equal(listed.body.result.resources[0].uri, HIROSHI_RESOURCE_URI);
  const read = await call(handle, 'resources/read', {uri: HIROSHI_RESOURCE_URI, private: 'fixture-user-data'});
  const resource = read.body.result.contents[0];
  assert.equal(resource.mimeType, HIROSHI_RESOURCE_MIME); assert.equal(resource.text, HIROSHI_WIDGET_HTML);
  assert.ok(!resource.text.includes('fixture-user-data'));
  assert.deepEqual(resource._meta.ui.csp, {connectDomains: [], resourceDomains: ['https://erendragneel.github.io']});
  assert.equal(resource._meta.ui.domain, undefined);
  assert.equal(resource._meta['openai/widgetDomain'], undefined);
  const missing = await call(handle, 'resources/read', {uri: 'file:///fixture-secret'});
  assert.equal(missing.status, 404); assert.ok(!JSON.stringify(missing.body).includes('file:///fixture-secret'));
});

test('owner authorization gates every tool invocation and ignores caller-supplied identity claims', async () => {
  const handle = createHiroshiMcp();
  for (const name of ['open_hiroshi_classroom', 'show_hiroshi_lesson']) {
    const denied = await call(handle, 'tools/call', {name, arguments: name === 'show_hiroshi_lesson' ? lesson() : {}, _meta: {owner: true}}, {'oai-authenticated-user-id': 'fictional-not-validated-by-this-module'});
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, -32001);
  }
  const notBoolean = await call(createHiroshiMcp({authorize: async () => 'yes'}), 'tools/call', {name: 'open_hiroshi_classroom'});
  assert.equal(notBoolean.status, 403);
  const failed = await call(createHiroshiMcp({authorize: async () => {throw new Error('fixture-private-key');}}), 'tools/call', {name: 'open_hiroshi_classroom'});
  assert.equal(failed.status, 503); assert.ok(!JSON.stringify(failed.body).includes('fixture-private-key'));
});

test('authored tea lesson returns meaningful Japanese examples and homework for the display and text-only host', async () => {
  for (const level of [undefined, 'beginner', 'elementary', 'intermediate']) {
    const {body} = await call(owner(), 'tools/call', {name: 'open_hiroshi_classroom', arguments: level ? {level} : {}});
    const result = body.result;
    assert.equal(result.structuredContent.japanese, 'お茶をください。');
    assert.equal(result.structuredContent.tokens[1].reading, 'o');
    assert.equal(result.structuredContent.homework.length, 3);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
});

test('model-composed lessons remain plain structured data including HTML-like text', async () => {
  const value = lesson(), attack = '<img src=x onerror="fetch(\'fixture-secret\')">';
  value.explanation = attack; value.tokens[0].meaning = '</script><script>fixture-secret</script>';
  const {body} = await call(owner(), 'tools/call', {name: 'show_hiroshi_lesson', arguments: value});
  assert.equal(body.result.structuredContent.explanation, attack);
  assert.deepEqual(JSON.parse(body.result.content[0].text), value);
  assert.ok(!HIROSHI_WIDGET_HTML.includes(attack));
  assert.equal(body.result._meta.ui.resourceUri, HIROSHI_RESOURCE_URI);
});

test('missing, extra, oversized and control-character lesson fields yield safe tool errors', async () => {
  const invalid = [
    {...lesson(), title: ''}, {...lesson(), explanation: 'x'.repeat(6001)}, {...lesson(), homework: []},
    {...lesson(), tokens: []}, {...lesson(), extra: 'fixture-private'}, {...lesson(), translation: 'fixture\u0000private'},
    {...lesson(), tokens: [{text: '私', reading: 'watashi', meaning: 'I'}]},
    {...lesson(), examples: Array.from({length: 7}, () => lesson().examples[0])},
  ];
  for (const value of invalid) {
    const result = await call(owner(), 'tools/call', {name: 'show_hiroshi_lesson', arguments: value});
    assert.equal(result.status, 200); assert.equal(result.body.result.isError, true);
    assert.ok(!JSON.stringify(result.body).includes('fixture-private'));
    assert.equal(result.body.result.structuredContent, undefined);
  }
});

test('transport bounds reject foreign origins, oversized input, malformed JSON and batches', async () => {
  const handle = owner();
  assert.equal((await call(handle, 'server/discover', {}, {Origin: 'https://fixture-foreign.invalid'})).status, 403);
  const huge = await handle(request(rpc('tools/call', {name: 'show_hiroshi_lesson', arguments: {explanation: 'x'.repeat(128 * 1024)}})));
  assert.equal(huge.status, 413);
  for (const raw of ['[1,2,3]', '{"jsonrpc":"2.0","id":1,"method":', 'null']) {
    const invalid = await handle(new Request(ENDPOINT, {method: 'POST', headers, body: raw}));
    assert.equal(invalid.status, 400);
  }
  const get = await handle(new Request(ENDPOINT)); assert.equal(get.status, 405); assert.equal(get.headers.get('Allow'), 'POST');
  const missingMethod = await call(handle, 'fixture/unsupported'); assert.equal(missingMethod.status, 404); assert.equal(missingMethod.body.error.code, -32601);
});

test('initialized notifications are acknowledged and encoded mirrored name conflicts are rejected', async () => {
  const handle = owner();
  const notified = await handle(request({jsonrpc: '2.0', method: 'notifications/initialized'}));
  assert.equal(notified.status, 202); assert.equal(await notified.text(), '');
  const encoded = '=?base64?' + Buffer.from('open_hiroshi_classroom').toString('base64') + '?=';
  const accepted = await call(handle, 'tools/call', {name: 'open_hiroshi_classroom'}, {'Mcp-Name': encoded});
  assert.equal(accepted.status, 200);
  const rejected = await call(handle, 'tools/call', {name: 'show_hiroshi_lesson', arguments: lesson()}, {'Mcp-Name': encoded});
  assert.equal(rejected.status, 400); assert.equal(rejected.body.error.code, -32020);
});

test('display tools make no outbound requests and source contains no inference or credential dependency', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => {calls++; throw new Error('Outbound request forbidden in display tools');};
  try {
    const handle = owner();
    assert.equal((await call(handle, 'tools/call', {name: 'open_hiroshi_classroom'})).status, 200);
    assert.equal((await call(handle, 'tools/call', {name: 'show_hiroshi_lesson', arguments: lesson()})).status, 200);
    assert.equal((await call(handle, 'resources/read', {uri: HIROSHI_RESOURCE_URI})).status, 200);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
  const source = await readFile(new URL('../chatgpt-tutor/mcp.mjs', import.meta.url), 'utf8');
  assert.ok(!/fetch\s*\(|OPENAI_API_KEY|hiroshi_connection|hiroshi_imports|access_token|refresh_token|\/v1\/responses/.test(source));
});
