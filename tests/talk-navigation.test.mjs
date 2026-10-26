import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createChatGPTConnectionView} from '../public/chatgpt-connection.js';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Exercise actual app code: ${startMarker}`);
  return source.slice(start, end);
}
const navigation = between('function setPrimaryNavigation(', '\nfunction outstandingAssignments(');
const handlers = between("for(const id of ['nav-talk','mobile-talk'])", "\nsetPrimaryNavigation('tutor');");
const functionLine = name => {
  const line = source.split(/\r?\n/).find(line => line.startsWith(`function ${name}(`));
  assert.ok(line, `Exercise actual ${name} function`);
  return line;
};

class Element {
  constructor(tag, calls, tasks) {
    this.tagName = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.className = ''; this.textContent = ''; this.hidden = false; this.style = {};
    this.calls = calls; this.tasks = tasks; this.open = false; this._value = ''; this.valueWrites = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const include = force === undefined ? !classes.has(name) : Boolean(force);
        if(include) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' '); return include;
      },
      add: (...names) => names.forEach(name => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach(name => this.classList.toggle(name, false)),
    };
  }
  get value() { return this._value; }
  set value(next) { this.valueWrites++; this._value = next; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, callback) {
    if(!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type) { for(const callback of this.listeners.get(type) || []) callback({preventDefault() {}}); }
  click() { if(!this.disabled) this.dispatch('click'); }
  focus() { this.calls.push('focus:' + this.id); }
  scrollIntoView(options) { this.calls.push({scroll: this.id, ...options}); }
  showModal() { this.open = true; }
  close() {
    if(!this.open) return;
    this.open = false;
    this.calls.push('close');
    // Dialog close dispatch is queued in the browser, after the click handler.
    this.tasks.push(() => this.dispatch('close'));
  }
  querySelector(selector) {
    if(selector === 'option[value="live"]') return descendants(this).find(item => item.tagName === 'option' && item.value === 'live') || null;
    if(selector.startsWith('.')) return descendants(this).find(item => item.classList.contains(selector.slice(1))) || null;
    assert.fail('Unexpected selector: ' + selector);
  }
}
const descendants = element => [element, ...element.children.flatMap(child => child instanceof Element ? descendants(child) : [])];

function harness({draft = 'Keep my unfinished Japanese question. 日本語', connected = false} = {}) {
  const calls = [], tasks = [], elements = new Map(), subscriptions = new Set();
  const createElement = tag => new Element(tag, calls, tasks);
  for(const id of ['nav-talk','mobile-talk','nav-teacher','mobile-teacher','nav-assignments','mobile-assignments','nav-progress','mobile-progress','classroom-home','classroom-heading','modal','modal-title','modal-eyebrow','modal-content','message-input','learning-plan','companion-art','connection-label']) {
    const element = createElement(id === 'modal' ? 'dialog' : 'div'); element.id = id; elements.set(id, element);
  }
  const body = createElement('body'), portrait = elements.get('companion-art');
  portrait.src = './assets/hiroshi-sensei.png';
  const input = elements.get('message-input'); input._value = draft;
  const panels = new Map(['.conversation-panel', '.page-header'].map(selector => {
    const element = createElement('section'); element.id = selector; return [selector, element];
  }));
  const document = {
    body, createElement, createTextNode: text => ({textContent: text}),
    getElementById: id => elements.get(id) ?? assert.fail('Unexpected element: ' + id),
    querySelector: selector => panels.get(selector) ?? assert.fail('Unexpected selector: ' + selector),
  };
  const state = {
    profile: {name: 'My learner', companionName: 'Hiroshi sensei', interests: 'travel'},
    preferences: {language: 'ja', level: 'beginner', mode: 'live', readings: true, corrections: false, autoVoice: false},
    sessions: {'teacher:introductions:ja': {messages: [{role: 'assistant', reply: 'Your saved lesson conversation.'}]}},
    teacher: {activeLessonId: 'introductions', assignments: [{id: 'saved-homework', answers: {first: 'Saved draft'}}]},
    progress: {days: {today: 3}},
  };
  const activeTeacherContext = {lessonId: 'introductions', title: 'Meet your teacher'};
  const chatGPTConnection = {
    enabled: true,
    subscribe(callback) {
      subscriptions.add(callback);
      callback({configured: connected, stage: connected ? 'connected' : 'disconnected', message: 'Your connection state.', model: '', busy: false});
      return () => {subscriptions.delete(callback); calls.push('unsubscribe');};
    },
    connect() { calls.push('connect'); }, refresh() { calls.push('refresh'); }, disconnect() { calls.push('disconnect'); },
  };
  const context = vm.createContext({
    document, $: id => document.getElementById(id), state, activeTeacherContext, busy: false,
    liveConfigured: connected, aiProvider: connected ? 'chatgpt' : 'none', chatGPTConnection,
    APP_CONFIG: {apiBase: '/api', native: false}, COMPANION_NAME: 'Hiroshi sensei',
    createChatGPTConnectionView,
    installUI: {getSettingsLabel: () => 'Install app', show() {calls.push('install');}},
    resetPending() {calls.push('reset');}, sendMessage() {calls.push('send');},
    save() {calls.push('save');}, renderConversation() {calls.push('render');}, session() {calls.push('session');},
    resizeComposer() {calls.push('resize');}, toast() {},
    exportBackup() {}, showMemories() {}, showReset() {}, showScenes() {},
  });
  vm.runInContext(`let conversationFocused = false, modalCleanup = null;\n${navigation}\n${handlers}\n${functionLine('openModal')}\n${functionLine('node')}\n${functionLine('button')}\n${functionLine('field')}\n${functionLine('checkField')}\n${functionLine('showSettings')}`, context, {filename: 'public/app.js real talk navigation and Settings'});
  const snapshot = JSON.stringify(state);
  return {
    context, state, input, calls, subscriptions, elements, body, portrait, activeTeacherContext, snapshot,
    focused: () => vm.runInContext('conversationFocused', context),
    flush: () => {while(tasks.length) tasks.shift()();},
    assertPreserved() {
      assert.equal(input.value, draft); assert.equal(input.valueWrites, 0);
      assert.equal(context.activeTeacherContext, activeTeacherContext);
      assert.equal(context.state, state); assert.equal(JSON.stringify(state), snapshot);
      assert.ok(!calls.some(call => typeof call === 'string' && (/^focus:/.test(call) || ['send','reset','save','render','session','resize'].includes(call))), JSON.stringify(calls));
    },
  };
}

test('desktop and phone Talk clicks open a distinct portrait/chat view without keyboard, messages, or state changes', () => {
  for(const id of ['nav-talk', 'mobile-talk']) for(const connected of [false, true]) {
    const h = harness({connected});
    h.context.setPrimaryNavigation('assignments');
    h.elements.get('modal').showModal();
    h.elements.get(id).click(); h.flush();
    assert.equal(h.focused(), true); assert.equal(h.body.classList.contains('conversation-focused'), true);
    assert.equal(h.elements.get('classroom-home').hidden, false);
    assert.equal(h.elements.get('classroom-heading').textContent, 'Talk with Hiroshi sensei.');
    assert.equal(h.elements.get('modal').open, false);
    for(const nav of ['nav-talk', 'mobile-talk']) {
      assert.equal(h.elements.get(nav).getAttribute('aria-current'), 'page');
      assert.equal(h.elements.get(nav).classList.contains('active'), true);
    }
    assert.equal(h.elements.get('nav-assignments').getAttribute('aria-current'), null);
    assert.equal(h.portrait.src, './assets/hiroshi-sensei.png'); assert.equal(h.portrait.hidden, false);
    assert.ok(h.calls.some(call => call.scroll === '.conversation-panel' && call.block === 'end'));
    h.assertPreserved();
    // Reopening the same view must remain a navigation action, not restart tutoring.
    h.elements.get(id).click(); h.flush(); h.assertPreserved();
  }
});

test('Learning plan returns from focused Talk and other classroom navigation also clears focus without discarding work', () => {
  const h = harness();
  h.elements.get('mobile-talk').click();
  h.elements.get('classroom-home').click();
  assert.equal(h.focused(), false); assert.equal(h.body.classList.contains('conversation-focused'), false);
  assert.equal(h.elements.get('classroom-home').hidden, true);
  assert.equal(h.elements.get('classroom-heading').textContent, 'Your classroom with Hiroshi sensei.');
  assert.ok(h.calls.some(call => call.scroll === '.page-header' && call.block === 'start'));
  for(const section of ['lessons', 'assignments', 'progress']) {
    h.elements.get('nav-talk').click(); h.context.setPrimaryNavigation(section);
    assert.equal(h.focused(), false); assert.equal(h.elements.get('classroom-home').hidden, true);
  }
  h.assertPreserved();
});

test('actual Settings view releases its connection subscription on close or replacement and preserves the composer', () => {
  const h = harness({connected: true});
  h.context.showSettings();
  assert.equal(h.subscriptions.size, 1); assert.equal(h.elements.get('modal').open, true);
  const first = descendants(h.elements.get('modal-content')).find(element => element.getAttribute('data-surface') === 'settings');
  assert.ok(first); assert.equal(first.hidden, false);
  const oldDisconnect = descendants(first).find(element => element.textContent === 'Disconnect');
  h.elements.get('nav-talk').click(); h.flush();
  assert.equal(h.subscriptions.size, 0); assert.equal(h.focused(), true);
  const previousCalls = h.calls.length; oldDisconnect.click(); assert.equal(h.calls.length, previousCalls);
  h.context.showSettings(); assert.equal(h.subscriptions.size, 1);
  h.context.showSettings();
  assert.equal(h.subscriptions.size, 1, 'Replacing Settings disposes the old view immediately');
  h.flush();
  assert.equal(h.subscriptions.size, 1, 'A queued close event must not dispose the newly opened view');
  h.context.openModal('Another classroom panel'); h.flush();
  assert.equal(h.subscriptions.size, 0);
  h.elements.get('modal').close(); h.flush();
  assert.equal(h.subscriptions.size, 0);
  assert.equal(h.calls.filter(call => call === 'unsubscribe').length, 3);
  h.assertPreserved();
});
