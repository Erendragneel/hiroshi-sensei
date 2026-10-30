import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as core from '../public/learning-core.js';

const source = (await readFile(new URL('../public/learning-ui.js', import.meta.url), 'utf8'))
  .replace(/^import \{[\s\S]*?\} from '\.\/learning-core\.js';\r?\n/, '').replace('export function ', 'function ');
class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this.listeners = new Map(); this.textContent = ''; this.classList = {add: (...names) => {this.className = [...new Set([...(this.className || '').split(' '), ...names])].join(' ').trim();}};}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children; this.textContent = '';}
  setAttribute(name, value) {this[name] = value;}
  addEventListener(name, handler) {this.listeners.set(name, handler);}
  click() {return this.disabled ? undefined : this.listeners.get('click')?.();}
  dispatch(name) {return this.listeners.get(name)?.({preventDefault() {}});}
  scrollIntoView() {}
}
const descendants = node => [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])];
const contentText = node => descendants(node).filter(item => !item.hidden).map(item => item.textContent).join(' ');
const findClass = (node, cls) => descendants(node).find(item => item.className?.split(' ').includes(cls));
const action = (node, label) => descendants(node).find(item => item.tagName === 'button' && item.textContent === label);
function harness(initial = core.createLearningState(), {connected = false, generate, accepted = true} = {}) {
  let state = core.sanitizeLearningState(initial), writes = 0, ui;
  const modals = [], calls = [], toasts = [], asks = [], spoken = [], visited = [];
  const context = vm.createContext({...core, AbortController, Intl, Date,
    document: {createElement: tag => new Element(tag)},
  });
  vm.runInContext(source, context, {filename:'public/learning-ui.js'});
  ui = context.createLearningUI({getState: () => state, setState: next => {writes++; state = core.sanitizeLearningState(next);},
    getCompanionName: () => 'Hiroshi sensei', getProfile: () => ({name:'Learner'}),
    openModal: (title, subtitle) => {ui?.dispose(); const content = new Element('section'); modals.push({title, subtitle, content}); return content;},
    toast: text => toasts.push(text), speak: (...args) => spoken.push(args), canGenerate: () => connected,
    generateLesson: (...args) => {calls.push(args); return generate?.(...args);},
    onAsk: (...args) => {asks.push(args); return accepted;}, onNavigate: route => visited.push(route),
    onOpenLibrary: () => visited.push('library'), onOpenCourseAssignments: () => visited.push('course-assignments'),
  });
  return {ui, modals, calls, toasts, asks, spoken, visited, get current() {return modals.at(-1);}, get state() {return state;}, get writes() {return writes;}};
}
function currentExercise(h) {
  const unit = core.getLearningSummary(h.state).activeUnit;
  const phase = unit.phase === 'assignment' ? 'assignment' : 'lesson';
  const exercise = phase === 'assignment' ? unit.lesson.homework[unit.homeworkIndex] : unit.lesson.practice[unit.practiceIndex];
  return {unit, phase, exercise};
}
function answer(h, value) {
  const {exercise} = currentExercise(h);
  if(exercise.type === 'choice') {
    const radio = descendants(h.current.content).find(item => item.tagName === 'input' && item.value === value);
    assert.ok(radio, 'Expected choice to be visible'); radio.dispatch('change');
  } else {
    const input = descendants(h.current.content).find(item => item.tagName === 'textarea');
    input.value = value; input.dispatch('input');
  }
  findClass(h.current.content, 'learning-question').dispatch('submit');
}
function advance(h) {
  const button = descendants(h.current.content).find(item => item.tagName === 'button' && ['Next small step →','Open my assignment →','Finish this assignment →'].includes(item.textContent));
  assert.ok(button); assert.equal(button.disabled, false); button.click();
}
function completePractice(h) {
  for(let limit = 0; limit < 6; limit++) {
    const data = currentExercise(h); if(data.phase === 'assignment') return;
    answer(h, data.exercise.answers[0]); advance(h);
  }
  assert.fail('Practice did not reach an assignment');
}

test('viewing the learning plan never generates or grades and gives saved coursework a clear route', () => {
  const h = harness(undefined, {connected:true}); h.ui.show();
  assert.equal(h.current.title, 'Your learning plan');
  assert.match(contentText(h.current.content), /Your first answers will show me where to give you more help/);
  assert.equal(h.writes, 0); assert.equal(h.calls.length, 0);
  const portrait = descendants(h.current.content).find(item => item.tagName === 'img');
  assert.equal(portrait.src, './assets/hiroshi-sensei.png');
  action(h.current.content, 'Earlier course assignments').click();
  assert.equal(h.visited.at(-1), 'course-assignments');
});

test('a prepared lesson teaches one small part and shows one question, saving drafts without recording a result', async () => {
  const h = harness(); await h.ui.continueLearning();
  assert.equal(h.state.units.length, 1); assert.equal(h.state.units[0].source, 'authored');
  assert.equal(descendants(h.current.content).filter(item => item.tagName === 'fieldset').length, 1);
  assert.ok(findClass(h.current.content, 'learning-teaching')); assert.ok(findClass(h.current.content, 'learning-example'));
  const before = h.state.units[0].practice.attempts.length;
  const exercise = currentExercise(h).exercise;
  const input = descendants(h.current.content).find(item => item.tagName === 'input' && item.value === exercise.answers[0]);
  if(input) input.dispatch('change');
  else {const area = descendants(h.current.content).find(item => item.tagName === 'textarea'); area.value = 'Unfinished answer'; area.dispatch('input');}
  assert.equal(h.state.units[0].practice.attempts.length, before);
  assert.equal(h.state.units[0].phase, 'lesson'); assert.equal(h.calls.length, 0);
  const opened = h.modals.length, resumed = harness(h.state, {connected:true}); await resumed.ui.continueLearning();
  assert.equal(resumed.calls.length, 0); assert.equal(resumed.state.units.length, 1);
  assert.deepEqual(resumed.state.units[0].practice.answers, h.state.units[0].practice.answers);
  assert.equal(h.modals.length, opened);
});

test('correct checks wait for an explicit next step and a finished lesson issues real homework with saved drafts', async () => {
  const h = harness(); await h.ui.continueLearning();
  const first = currentExercise(h); answer(h, first.exercise.answers[0]);
  assert.equal(h.state.units[0].practiceIndex, 0, 'A check must leave feedback visible');
  assert.match(contentText(h.current.content), /You used the taught form/);
  advance(h); completePractice(h);
  const unit = h.state.units[0]; assert.equal(unit.phase, 'assignment');
  assert.ok(unit.homework.assignedAt); assert.ok(unit.homework.dueAt);
  assert.equal(unit.homework.attempts.length, 0);
  assert.match(h.current.subtitle, /YOUR ASSIGNMENT/);
  assert.equal(descendants(h.current.content).filter(item => item.tagName === 'fieldset').length, 1);
  assert.ok(action(h.current.content, 'Earlier course assignments'));
  const before = unit.homework.attempts.length;
  const exercise = currentExercise(h).exercise;
  if(exercise.type === 'choice') descendants(h.current.content).find(item => item.tagName === 'input' && item.value === exercise.answers[0]).dispatch('change');
  else {const field = descendants(h.current.content).find(item => item.tagName === 'textarea'); field.value = 'My homework draft'; field.dispatch('input');}
  assert.equal(h.state.units[0].homework.attempts.length, before);
  const resume = harness(h.state, {connected:true}); resume.ui.showAssignments();
  assert.equal(resume.calls.length, 0); assert.deepEqual(resume.state.units[0].homework.answers, h.state.units[0].homework.answers);
  assert.equal(resume.state.units[0].homework.dueAt, unit.homework.dueAt);
});

test('hints and opening homework notes record support, and a wrong answer cannot advance the lesson', async () => {
  const h = harness(); await h.ui.continueLearning();
  const current = currentExercise(h), wrong = current.exercise.type === 'choice' ? current.exercise.options.find(item => !current.exercise.answers.includes(item)) : 'something different';
  answer(h, wrong);
  const next = action(h.current.content, 'Next small step →'); assert.equal(next.disabled, true);
  assert.equal(h.state.units[0].practiceIndex, 0);
  action(h.current.content, 'Give me a hint').click();
  assert.equal(h.state.units[0].practice.hints[current.exercise.id], true);
  answer(h, current.exercise.answers[0]);
  const report = h.state.units[0].practice.attempts.at(-1); assert.equal(report.independent, false);
  advance(h); completePractice(h);
  const homework = currentExercise(h), notes = findClass(h.current.content, 'learning-notes');
  notes.open = true; notes.dispatch('toggle');
  assert.equal(h.state.units[0].homework.hints[homework.exercise.id], true);
  h.ui.showProgress(); assert.match(contentText(h.current.content), /What we are working on/);
  assert.equal(h.calls.length, 0);
});

test('new AI lessons require an explicit action, concurrent clicks share one request, and later visits resume without requests', async () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  const h = harness(undefined, {connected:true, generate: () => promise});
  h.ui.show(); assert.equal(h.calls.length, 0);
  const first = h.ui.continueLearning(), duplicate = h.ui.continueLearning();
  assert.equal(h.calls.length, 1); assert.equal(h.state.units.length, 0);
  assert.equal(h.current.title, 'Preparing your next lesson');
  const recommendation = h.calls[0][0]; assert.ok(h.calls[0][1].signal);
  assert.ok(h.calls[0][1].learningSummary);
  resolve(core.buildPreparedLesson(recommendation, h.state));
  assert.equal(await first, true); assert.equal(await duplicate, true);
  assert.equal(h.state.units.length, 1); assert.equal(h.state.units[0].source, 'ai');
  await h.ui.continueLearning(); assert.equal(h.calls.length, 1);
});

test('cancelled or dismissed AI generation never saves a late lesson or reopens a teaching screen', async () => {
  let resolve;
  const h = harness(undefined, {connected:true, generate: () => new Promise(done => {resolve = done;})});
  const generation = h.ui.continueLearning(), recommendation = h.calls[0][0];
  h.ui.show(); const title = h.current.title, count = h.modals.length;
  assert.equal(h.calls[0][1].signal.aborted, true);
  resolve(core.buildPreparedLesson(recommendation, h.state));
  assert.equal(await generation, false); assert.equal(h.state.units.length, 0);
  assert.equal(h.modals.length, count); assert.equal(h.current.title, title);
});

test('malformed generated material shows a safe recovery view and prepared fallback saves only a real prepared lesson', async () => {
  const h = harness(undefined, {connected:true, generate: async () => ({title:'Incomplete material'})});
  assert.equal(await h.ui.continueLearning(), false);
  assert.equal(h.current.title, 'Your saved work is safe'); assert.equal(h.state.units.length, 0);
  assert.match(contentText(h.current.content), /No new lesson or assignment was saved/);
  await action(h.current.content, 'Use a prepared lesson →').click();
  // The click callback intentionally starts the async action without returning it.
  await Promise.resolve();
  assert.equal(h.state.units.length, 1); assert.equal(h.state.units[0].source, 'authored');
  assert.equal(h.calls.length, 1);
});

test('generation recovery shows the bounded plain-text reason and directs plan or sign-in limits away from immediate retries', async () => {
  const supplied = 'ChatGPT has reached a plan limit. Review ChatGPT usage settings. <img src=x onerror=alert(1)> ' + 'x'.repeat(400);
  const error = new Error(supplied); error.stack = 'PRIVATE STACK MUST NOT BE DISPLAYED';
  const h = harness(undefined, {connected:true, generate: async () => {throw error;}});
  assert.equal(await h.ui.continueLearning(), false);
  const detail = findClass(h.current.content, 'learning-error-detail');
  assert.equal(detail.role, 'status'); assert.equal(detail.textContent, supplied.slice(0, 350));
  assert.equal(detail.textContent.length, 350); assert.equal(detail.innerHTML, undefined);
  assert.equal(descendants(h.current.content).filter(item => item.tagName === 'img').length, 1, 'Only the fixed Hiroshi portrait is an image');
  assert.doesNotMatch(contentText(h.current.content), /PRIVATE STACK/);
  assert.equal(action(h.current.content, 'Try preparing again'), undefined);
  assert.ok(action(h.current.content, 'Back to my learning plan'));
  assert.ok(action(h.current.content, 'Use a prepared lesson →'));
  assert.equal(h.state.units.length, 0); assert.equal(h.calls.length, 1);
});

test('generation recovery uses a useful generic status when no safe message is supplied', async () => {
  const h = harness(undefined, {connected:true, generate: async () => {throw {message: {raw:'not display text'}, stack:'PRIVATE'};}});
  assert.equal(await h.ui.continueLearning(), false);
  const detail = findClass(h.current.content, 'learning-error-detail');
  assert.equal(detail.role, 'status'); assert.match(detail.textContent, /connection could not finish this lesson/);
  assert.ok(action(h.current.content, 'Try preparing again'));
  assert.equal(h.state.units.length, 0); assert.equal(h.calls.length, 1);
});
