import test from 'node:test';
import assert from 'node:assert/strict';
import {startWebUpdates} from '../public/app-updates.js';

class Element extends EventTarget {
  children = []; attributes = {}; hidden = false; textContent = '';
  constructor(tag) { super(); this.tagName = tag; }
  append(...elements) { this.children.push(...elements); for(const el of elements) el.parent = this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { if(this.parent) this.parent.children = this.parent.children.filter(el => el !== this); }
}

function harness({controlled = true, updateFails = false, registerFails = false} = {}) {
  const win = new EventTarget(), doc = new EventTarget(), workers = new EventTarget();
  const registrations = [], toasts = [];
  let checks = 0, reloads = 0, time = 1000, safe = true;
  doc.body = new Element('body'); doc.createElement = tag => new Element(tag); doc.visibilityState = 'visible';
  workers.controller = controlled ? {} : null;
  workers.register = async (...args) => {
    registrations.push(args);
    if(registerFails) throw new Error('Registration unavailable');
    return {update:async () => { checks++; if(updateFails) throw new Error('Offline'); }};
  };
  const environment = {window:win,document:doc,navigator:{serviceWorker:workers},location:{protocol:'https:',reload:() => reloads++},Date:{now:() => time}};
  Object.defineProperty(environment, 'localStorage', {get() { throw new Error('Updater must not access saved game data'); }});
  const options = {canReload:() => safe,toast:message => toasts.push(message)};
  return {
    environment, options, win, doc, workers, registrations, toasts,
    get checks() { return checks; }, get reloads() { return reloads; },
    set safe(value) { safe = value; }, advance:delta => { time += delta; },
    changed() { workers.controller = {}; workers.dispatchEvent(new Event('controllerchange')); },
    get notice() { return doc.body.children[0]; },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Android native, unsupported browsers, and file previews do not register or create update UI', async () => {
  const native = harness();
  const controller = startWebUpdates({...native.options,native:true}, native.environment);
  assert.equal(await controller.ready, false);
  assert.equal(native.registrations.length, 0); assert.equal(native.doc.body.children.length, 0);
  assert.equal(await startWebUpdates({}, {}).ready, false);
  const file = harness(); file.environment.location.protocol = 'file:';
  assert.equal(await startWebUpdates(file.options,file.environment).ready, false);
  assert.equal(file.registrations.length, 0);
});

test('an active worker update prompts for an explicit refresh; Later retains the current game', async () => {
  const h = harness(); const updates = startWebUpdates(h.options,h.environment); await updates.ready;
  assert.deepEqual(h.registrations, [['./sw.js',{updateViaCache:'none'}]]);
  h.changed();
  assert.equal(h.notice.attributes.role, 'status');
  assert.equal(h.notice.children[0].textContent, 'New web version ready');
  assert.equal(h.reloads, 0);
  const [refresh,later] = h.notice.children[2].children;
  later.dispatchEvent(new Event('click')); assert.equal(h.notice.hidden, true); assert.equal(h.reloads,0);
  h.changed(); assert.equal(h.notice.hidden, false);
  refresh.dispatchEvent(new Event('click')); assert.equal(h.reloads, 1);
  updates.stop(); assert.equal(h.doc.body.children.length,0);
});

test('unfinished work blocks reload without clearing drafts or saved data', async () => {
  const h = harness(); const updates = startWebUpdates(h.options,h.environment); await updates.ready; h.changed();
  h.safe = false;
  h.notice.children[2].children[0].dispatchEvent(new Event('click'));
  assert.equal(h.reloads,0); assert.match(h.toasts[0],/unfinished message/);
  h.safe = true; h.notice.children[2].children[0].dispatchEvent(new Event('click'));
  assert.equal(h.reloads,1);
});

test('first installation does not present itself as a pending web update', async () => {
  const h = harness({controlled:false}); await startWebUpdates(h.options,h.environment).ready;
  h.changed(); assert.equal(h.doc.body.children.length,0); assert.equal(h.reloads,0);
  h.changed(); assert.equal(h.doc.body.children.length,1);
});

test('offline update failures are harmless and foreground checks are throttled', async () => {
  const h = harness({updateFails:true}); const updates = startWebUpdates(h.options,h.environment);
  assert.equal(await updates.ready,true); assert.equal(h.checks,1);
  h.win.dispatchEvent(new Event('online')); h.win.dispatchEvent(new Event('focus')); await tick();
  assert.equal(h.checks,1); assert.equal(h.reloads,0); assert.equal(h.doc.body.children.length,0);
  h.advance(60001); h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(h.checks,1);
  h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(h.checks,2); assert.equal(h.toasts.length,0);
  updates.stop(); h.advance(60001); h.win.dispatchEvent(new Event('focus')); await tick(); assert.equal(h.checks,2);
});

test('registration rejection leaves the existing game and its data alone', async () => {
  const h = harness({registerFails:true}); const updates = startWebUpdates(h.options,h.environment);
  assert.equal(await updates.ready,false); h.win.dispatchEvent(new Event('focus')); await tick();
  assert.equal(h.checks,0); assert.equal(h.doc.body.children.length,0); assert.equal(h.reloads,0);
});
