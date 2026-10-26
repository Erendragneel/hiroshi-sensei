// This stores Hiroshi's device session, never an OpenAI access/refresh token.
const SESSION_KEY = 'hiroshi.chatgpt.connection.v1';
const PENDING_KEY = 'hiroshi.chatgpt.pending.v1';
const PHONE_URL = 'https://erendragneel.github.io/hiroshi-sensei/';
const BACKEND_ORIGIN = 'https://koa-personal-companion.elijio-villa.chatgpt.site';
const DAY = 86400000;

function equal(left, right) {
  if(typeof left !== 'string' || typeof right !== 'string') return false;
  let different = left.length ^ right.length;
  for(let i = 0; i < Math.max(left.length, right.length); i++) different |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return different === 0;
}

export function createChatGPTConnection({backend, phoneURL = PHONE_URL, native = false, onChange = () => {}} = {}, environment = globalThis) {
  const win = environment.window || environment;
  const location = environment.location || win.location;
  const history = environment.history || win.history;
  const crypto = environment.crypto || win.crypto;
  const fetchOriginal = (environment.fetch || win.fetch).bind(environment.fetch ? environment : win);
  const now = () => (environment.Date || Date).now();
  const listeners = new Set();
  let storage;
  try { storage = environment.localStorage || win.localStorage; } catch { /* A private browser may deny storage. */ }
  let backendURL;
  try {
    const candidate = new URL(backend);
    if(candidate.origin === BACKEND_ORIGIN && !candidate.username && !candidate.password && candidate.pathname === '/' && !candidate.search && !candidate.hash && phoneURL === PHONE_URL) backendURL = candidate.origin;
  } catch { /* No configured connection in local/native editions. */ }
  const enabled = !native && Boolean(backendURL);
  const api = enabled ? `${backendURL}/api/hiroshi` : null;
  let session = null, operation = false, gameBusy = false, checking = null, newApproval = false;
  let state = {configured:false, stage:'disconnected', model:'', message:'In-game AI uses your shared Codex / ChatGPT Work allowance.', busy:false};
  const snapshot = () => ({...state, provider:state.configured ? 'chatgpt' : 'none', busy:operation || gameBusy});
  function publish(next) {
    const wasConnected = state.configured;
    state = {...state, ...next};
    for(const listener of listeners) listener(snapshot());
    if(wasConnected !== state.configured) onChange(snapshot());
  }
  function readSession() {
    try {
      const saved = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
      if(saved && typeof saved.sessionToken === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(saved.sessionToken) && Number.isFinite(saved.expiresAt) && saved.expiresAt > now() && saved.expiresAt <= now() + 31 * DAY) return saved;
      if(saved) storage?.removeItem(SESSION_KEY);
    } catch { /* A damaged device connection must not touch game saves. */ }
    return null;
  }
  function clearPending() { try { storage?.removeItem(PENDING_KEY); } catch { } }
  function discardExpiredPending() {
    try {
      const pending = JSON.parse(storage?.getItem(PENDING_KEY) || 'null');
      if(pending && (!Number.isFinite(pending.createdAt) || pending.createdAt > now() + 30000 || now() - pending.createdAt > 600000)) clearPending();
    } catch { clearPending(); }
  }
  function forgetSession(message = 'Continue with ChatGPT to reconnect this phone.') {
    session = null; newApproval = false;
    try { storage?.removeItem(SESSION_KEY); } catch { }
    publish({configured:false, stage:'disconnected', model:'', message});
  }
  function saveSession(value) {
    if(!value || typeof value.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(value.sessionToken) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now() || value.expiresAt > now() + 31 * DAY) throw new Error('Hiroshi could not save this device connection. Please reconnect.');
    const saved = {sessionToken:value.sessionToken, expiresAt:value.expiresAt};
    try { storage.setItem(SESSION_KEY, JSON.stringify(saved)); }
    catch { throw new Error('Hiroshi could not remember this connection in this browser. Your saved game is unchanged.'); }
    session = saved;
  }
  function randomValue() {
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    return encode(bytes);
  }
  function encode(bytes) {
    let text = ''; for(const byte of bytes) text += String.fromCharCode(byte);
    return (environment.btoa || win.btoa)(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  }
  async function challenge(verifier) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }
  async function safeError(response, fallback) {
    try { const body = await response.json(); if(typeof body.error?.message === 'string' && body.error.message.length <= 240) return body.error.message; } catch { }
    return fallback;
  }
  async function connectionFetch(input, options = {}) {
    if(!enabled) return fetchOriginal(input, options);
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch { return fetchOriginal(input, options); }
    if(url.origin !== backendURL || url.username || url.password || !url.pathname.startsWith('/api/hiroshi/')) return fetchOriginal(input, options);
    const headers = new Headers(typeof input === 'object' && input.headers ? input.headers : undefined);
    new Headers(options.headers).forEach((value, name) => headers.set(name, value));
    // Caller-supplied authorization never selects another account on this route.
    headers.delete('Authorization');
    if(session?.expiresAt <= now()) forgetSession();
    if(session) headers.set('Authorization', `Bearer ${session.sessionToken}`);
    const response = await fetchOriginal(input, {...options, headers, mode:'cors', credentials:'omit', cache:'no-store', redirect:'error'});
    if(response.status === 401) forgetSession();
    return response;
  }
  async function refreshNow() {
    if(!enabled) return snapshot();
    if(checking) return checking;
    if(!session) { publish({configured:false, stage:'disconnected', model:'', message:'In-game AI uses your shared Codex / ChatGPT Work allowance.'}); return snapshot(); }
    checking = (async () => {
      publish({stage:'checking', message:'Reconnecting Hiroshi…'});
      try {
        const response = await connectionFetch(`${api}/status`, {signal:AbortSignal.timeout(90000)});
        if(response.status === 401) return snapshot();
        if(!response.ok) throw new Error(await safeError(response, 'Hiroshi could not check the saved connection. Try again.'));
        const result = await response.json();
        if(result.configured === true && result.provider === 'chatgpt') publish({configured:true, stage:'connected', model:typeof result.model === 'string' ? result.model.slice(0,100) : '', message:'This in-game connection uses your shared Codex / ChatGPT Work allowance. Your PC can stay off.'});
        else publish({configured:false, stage:'attention', model:'', message:'The hosted ChatGPT connection needs attention. Your saved game is safe.'});
      } catch {
        // Keep the approved device session through offline/service failures.
        publish({stage:'offline', message:'The connection could not be checked. Your saved connection and game are still here. Try again when you are online.'});
      } finally { checking = null; }
      return snapshot();
    })();
    return checking;
  }
  function canonicalPage() {
    try { const current = new URL(location.href), expected = new URL(phoneURL); return current.origin === expected.origin && current.pathname === expected.pathname; } catch { return false; }
  }
  async function consumeReturn() {
    const fragment = new URLSearchParams(location.hash?.replace(/^#/,'') || '');
    if(!fragment.has('hiroshi_code')) return;
    const codes = fragment.getAll('hiroshi_code'), states = fragment.getAll('state');
    const code = codes[0], returnedState = states[0];
    fragment.delete('hiroshi_code'); fragment.delete('state');
    // Consume URL data before any network work; codes never enter server logs.
    history.replaceState(history.state, '', location.pathname + location.search + (fragment.size ? `#${fragment}` : ''));
    let pending;
    try { pending = JSON.parse(storage?.getItem(PENDING_KEY) || 'null'); } catch { }
    clearPending();
    if(!canonicalPage() || codes.length !== 1 || states.length !== 1 || !/^[A-Za-z0-9_-]{16,512}$/.test(code || '') || !pending || !equal(pending.state, returnedState) || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier || '') || !Number.isFinite(pending.createdAt) || pending.createdAt > now() + 30000 || now() - pending.createdAt > 600000) throw new Error('This connection return could not be verified. Tap Continue with ChatGPT to start again.');
    const response = await fetchOriginal(`${api}/exchange`, {method:'POST', mode:'cors', credentials:'omit', cache:'no-store', redirect:'error', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code, verifier:pending.verifier}), signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(await safeError(response, 'Hiroshi could not finish connecting this phone. Please try again.'));
    saveSession(await response.json());
    newApproval = true;
  }
  const ready = Promise.resolve().then(async () => {
    if(!enabled) return snapshot();
    operation = true; publish({});
    try {
      session = readSession();
      discardExpiredPending();
      try { await consumeReturn(); }
      catch(error) { publish({stage:'attention', configured:false, model:'', message:error.message}); return snapshot(); }
      return await refreshNow();
    } finally { operation = false; publish({}); }
  });
  async function connect() {
    await ready;
    if(!enabled || operation || gameBusy) return;
    operation = true; publish({stage:'connecting', message:'Opening ChatGPT approval…'});
    try {
      if(!canonicalPage()) throw new Error('Open the GitHub game on this device to connect ChatGPT.');
      const verifier = randomValue(), stateValue = randomValue();
      const pending = {verifier, state:stateValue, createdAt:now()};
      // This is Hiroshi's short-lived app transaction, not an OpenAI credential.
      // Shared-origin storage survives Chrome returning to a different PWA window.
      try { storage.setItem(PENDING_KEY, JSON.stringify(pending)); }
      catch { throw new Error('Hiroshi could not prepare a remembered connection in this browser. Your saved game is unchanged.'); }
      const target = new URL(`${api}/connect`);
      target.search = new URLSearchParams({return_to:phoneURL, state:stateValue, challenge:await challenge(verifier)}).toString();
      location.assign(target.href);
    } catch(error) {
      clearPending();
      publish({stage:'attention', message:error.message || 'Hiroshi could not start connecting. Please try again.'});
    } finally { operation = false; publish({}); }
  }
  async function disconnect() {
    await ready;
    if(!enabled || operation || gameBusy) return;
    operation = true; publish({});
    let remoteCleared = false;
    try { if(session) remoteCleared = (await connectionFetch(`${api}/disconnect`, {method:'POST', signal:AbortSignal.timeout(15000)})).ok; }
    catch { /* Local sign-out still succeeds while offline. */ }
    finally {
      forgetSession(remoteCleared ? 'Disconnected on this device. Your saved game is still here.' : 'Disconnected on this device. Remote sign-out could not be confirmed.');
      operation = false; publish({});
    }
  }
  return {
    enabled, ready, fetch:connectionFetch, snapshot, connect, disconnect,
    async refresh() { await ready; return refreshNow(); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    setBusy(value) { gameBusy = Boolean(value); publish({}); },
    consumeNewApproval() { if(!state.configured || !newApproval) return false; newApproval = false; return true; },
  };
}

// Views share one connection client. A modal owner disposes its view when the
// modal closes or replaces its contents, releasing the subscription immediately.
export function createChatGPTConnectionView(connection, document = globalThis.document, {surface = 'main'} = {}) {
  if(!connection.enabled || !document) return null;
  const settings = surface === 'settings';
  let disposed = false;
  const card = document.createElement('section'); card.className = 'chatgpt-connection'; card.setAttribute('aria-label','ChatGPT connection');
  card.setAttribute('data-surface', settings ? 'settings' : 'main');
  const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
  detail.setAttribute('aria-live','polite'); copy.append(title, detail);
  const actions = document.createElement('div'); actions.className = 'chatgpt-connection-actions';
  const connect = document.createElement('button'); connect.type='button'; connect.className='primary-button'; connect.textContent='Continue with ChatGPT';
  const retry = document.createElement('button'); retry.type='button'; retry.className='secondary-button'; retry.textContent='Retry connection';
  const disconnect = document.createElement('button'); disconnect.type='button'; disconnect.className='secondary-button'; disconnect.textContent='Disconnect';
  connect.addEventListener('click', () => { if(!disposed) void connection.connect(); });
  retry.addEventListener('click', () => { if(!disposed) void connection.refresh(); });
  disconnect.addEventListener('click', () => { if(!disposed) void connection.disconnect(); });
  actions.append(connect,retry,disconnect); card.append(copy,actions);
  const unsubscribe = connection.subscribe(state => {
    title.textContent = ['offline','attention'].includes(state.stage) ? 'Connection needs attention' : ['checking','connecting'].includes(state.stage) ? 'Connecting Hiroshi…' : state.configured ? 'ChatGPT connected' : 'Connect your ChatGPT plan';
    detail.textContent = state.message + (state.configured && state.model ? ` Model: ${state.model}.` : '');
    // Keep recovery visible during checks and failures. Busy conversation turns
    // do not bring back a card for an otherwise healthy remembered connection.
    card.hidden = !settings && state.configured === true && state.stage === 'connected';
    card.classList.toggle('needs-attention', ['offline','attention'].includes(state.stage));
    connect.hidden = state.configured; disconnect.hidden = !state.configured && state.stage !== 'offline';
    retry.hidden = !['offline','attention'].includes(state.stage);
    for(const button of [connect,retry,disconnect]) button.disabled = state.busy;
  });
  return {element:card, dispose() { if(disposed) return; disposed = true; unsubscribe(); }};
}

export function mountChatGPTConnection(connection, document = globalThis.document) {
  if(!connection.enabled || !document) return null;
  const anchor = document.querySelector('.game-layout');
  if(!anchor?.parentNode) return null;
  const view = createChatGPTConnectionView(connection, document);
  anchor.parentNode.insertBefore(view.element, anchor);
  return view.element;
}
