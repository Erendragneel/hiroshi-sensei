import http from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChat, normalizeLocalBaseUrl } from './companion-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Only recognized settings are loaded. Nothing from this file is ever served or logged.
function localSettings(envPath) {
  try {
    const contents = readFileSync(envPath, 'utf8');
    const settings = {};
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      settings[match[1]] = value;
    }
    return settings;
  } catch { return {}; }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validHost(req) {
  try {
    const host = new URL(`http://${req.headers.host}`);
    return LOOPBACK_HOSTS.has(host.hostname) && Number(host.port || 80) === req.socket.localPort
      && host.pathname === '/' && !host.username && !host.password;
  } catch { return false; }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function serveStatic(req, res, publicDir) {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch {
    throw new RequestError(400, 'INVALID_PATH', 'The requested path is invalid.');
  }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
    || pathname.split('/').some((part) => part.startsWith('.'))) {
    throw new RequestError(403, 'FORBIDDEN', 'This file is not available.');
  }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(publicDir, `.${pathname}`);
  if (!isInside(publicDir, target) || !MIME_TYPES[path.extname(target).toLowerCase()]) throw new RequestError(404, 'NOT_FOUND', 'This file was not found.');
  let bytes;
  try {
    const [root, resolved] = await Promise.all([realpath(publicDir), realpath(target)]);
    if (!isInside(root, resolved) || !(await stat(resolved)).isFile()) throw new RequestError(403, 'FORBIDDEN', 'This file is not available.');
    bytes = await readFile(resolved);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(404, 'NOT_FOUND', 'This file was not found.');
  }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(target).toLowerCase()], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

/** Creates a local-only companion server. Inject fetchImpl and apiKey for isolated tests. */
export function createServer(options = {}) {
  const settings = options.readEnv === false ? {} : localSettings(options.envPath || path.join(ROOT, '.env.local'));
  const apiKey = (options.apiKey ?? (process.env.OPENAI_API_KEY?.trim() || settings.OPENAI_API_KEY) ?? '').trim();
  const model = options.model || process.env.OPENAI_MODEL || settings.OPENAI_MODEL || 'gpt-5.4-mini';
  const publicDir = path.resolve(options.publicDir || path.join(ROOT, 'public'));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const localSetting = options.localBaseUrl ?? (Object.hasOwn(process.env, 'KOA_LOCAL_AI_URL') ? process.env.KOA_LOCAL_AI_URL.trim() || 'http://127.0.0.1:4318' : '');
  const localBaseUrl = normalizeLocalBaseUrl(localSetting);
  const timeoutMs = options.timeoutMs;
  const requestLimit = options.requestLimit ?? 20;
  const rateWindowMs = options.rateWindowMs ?? 60000;
  const rates = new Map();
  let health = { ready: false, checkedAt: 0 };
  let healthPromise;
  async function providerStatus() {
    if (!localSetting) return { configured: Boolean(apiKey), provider: apiKey ? 'openai' : 'none' };
    if (!localBaseUrl) return { configured: false, provider: 'none' };
    if (Date.now() - health.checkedAt > (options.healthCacheMs ?? 2000)) {
      healthPromise ??= (async () => {
        let ready = false;
        try {
          const response = await fetchImpl(`${localBaseUrl}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
          ready = response.ok && (await response.json()).status === 'ok';
        } catch { /* Health failures are never exposed as raw diagnostics. */ }
        health = { ready, checkedAt: Date.now() };
      })();
      try { await healthPromise; } finally { healthPromise = undefined; }
    }
    return { configured: health.ready, provider: health.ready ? 'local' : 'none' };
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      if (!validHost(req)) throw new RequestError(403, 'INVALID_HOST', 'Use the local game address to connect.');
      const route = req.url.split('?')[0];
      if (route === '/api/status' && req.method === 'GET') return json(res, 200, await providerStatus());
      if (route === '/api/chat' && req.method === 'POST') {
        const now = Date.now();
        for (const [address, entry] of rates) if (entry.resetAt <= now) rates.delete(address);
        const address = req.socket.remoteAddress;
        const rate = rates.get(address) || { count: 0, resetAt: now + rateWindowMs };
        rates.set(address, rate);
        if (++rate.count > requestLimit) {
          res.setHeader('Retry-After', String(Math.ceil((rate.resetAt - now) / 1000)));
          throw new RequestError(429, 'RATE_LIMITED', 'Take a moment, then send your next message.');
        }
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half' });
        const response = await handleChat(request, { apiKey, model, localBaseUrl: localSetting, fetchImpl, timeoutMs });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if (route.startsWith('/api/')) throw new RequestError(404, 'NOT_FOUND', 'This endpoint was not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new RequestError(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
      await serveStatic(req, res, publicDir);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof RequestError) return json(res, error.status, { error: { code: error.code, message: error.message } });
      json(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Choose a valid local port with PORT.');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', () => {
      console.error('The local game could not start. Close another copy or choose a different PORT.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
  }
}
