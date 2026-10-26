import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {LESSONS, createTeacherState, createAssignment, recordLessonPractice, submitAssignment, sanitizeTeacherState} from '../public/teacher-core.js';

const source = (await readFile(new URL('../public/teacher-ui.js', import.meta.url), 'utf8')).replace(/^import .*?;\r?\n/m, '').replace('export function ', 'function ');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ''; this.listeners = new Map(); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  querySelector(selector) { return descendants(this).find(item => item.className?.split(' ').includes(selector.slice(1))) || null; }
  click() { if (!this.disabled) return this.listeners.get('click')?.(); }
  dispatch(type) { return this.listeners.get(type)?.({preventDefault() {}}); }
}
const descendants = element => [element, ...element.children.flatMap(child => child instanceof Element ? descendants(child) : [])];
const text = element => descendants(element).map(item => item.textContent).join(' ');
const correct = exercises => Object.fromEntries(exercises.map(exercise => [exercise.id, exercise.answers[0]]));
const today = new Date().toISOString();
function harness(initial = createTeacherState(), {live = false, accepted = true, extras = false, onNavigate} = {}) {
  let state = sanitizeTeacherState(initial), writes = 0;
  const modals = [], asks = [], toasts = [], opened = [];
  const context = vm.createContext({document: {createElement: tag => new Element(tag)}, structuredClone, Intl, Date, LESSONS, createAssignment, recordLessonPractice, submitAssignment});
  vm.runInContext(source, context, {filename: 'public/teacher-ui.js'});
  const ui = context.createTeacherUI({getCompanionName: () => 'Hiroshi sensei', getState: () => state, setState: next => {writes++; state = sanitizeTeacherState(next);},
    openModal: (title, subtitle) => {const content = new Element('section'); modals.push({title, subtitle, content}); return content;}, toast: message => toasts.push(message), speak() {}, canAsk: () => live,
    onAsk: (lessonContext, question) => {asks.push({lessonContext, question}); return accepted;},
    ...(onNavigate ? {onNavigate} : {}),
    ...(extras ? {onOpenScenes: () => opened.push('scenes'), onOpenPhrases: () => opened.push('phrases'), onOpenNotebook: () => opened.push('notebook')} : {}),
  });
  return {ui, modals, asks, toasts, opened, get state() {return state;}, get writes() {return writes;}, get current() {return modals.at(-1);}};
}
function presence(modal) {
  const strip = modal.content.children[0];
  assert.equal(strip.className, 'teacher-presence');
  const portrait = descendants(strip).find(item => item.tagName === 'img');
  assert.equal(portrait.src, './assets/hiroshi-sensei.png');
  assert.equal(portrait.alt, 'Hiroshi sensei');
  assert.match(text(strip), /Hiroshi sensei.*Your Japanese tutor/);
}

test('Assignments is a direct list, has a useful empty state, and keeps Hiroshi present on every teaching screen', () => {
  const h = harness();
  h.ui.showAssignments(); assert.equal(h.current.title, 'Your assignments'); presence(h.current);
  assert.match(text(h.current.content), /Your first assignment is waiting/);
  assert.equal(h.writes, 0); assert.equal(h.asks.length, 0);
  descendants(h.current.content).find(item => item.textContent === 'Find a lesson →').click();
  presence(h.current); assert.equal(h.current.title, 'Learn with Hiroshi sensei');
  h.ui.showLesson(LESSONS[0].id); presence(h.current);
  h.ui.showProgress(); presence(h.current);
});

test('assignment cards group current work and reviewed work, open the saved draft, and save edits without grading', () => {
  const practiced = recordLessonPractice(createTeacherState(), LESSONS[0].id, correct(LESSONS[0].practice), today).state;
  const active = practiced.assignments[0]; active.answers[LESSONS[0].homework[0].id] = 'Hajimemashite';
  const reviewed = createAssignment(LESSONS[1].id, today); practiced.assignments.push(reviewed);
  const initial = submitAssignment(practiced, reviewed.id, correct(LESSONS[1].homework), today).state;
  const h = harness(initial); h.ui.showAssignments();
  assert.match(text(h.current.content), /To work on · 1/); assert.match(text(h.current.content), /Reviewed assignments · 1/);
  assert.match(text(h.current.content), /1\/4 answers saved/); assert.match(text(h.current.content), /Last submitted review: 4\/4 target phrases/);
  const cards = descendants(h.current.content).filter(item => item.className === 'teacher-assignment-card');
  assert.equal(cards.length, 2); cards[0].click(); presence(h.current);
  const input = descendants(h.current.content).find(item => item.tagName === 'textarea');
  assert.equal(input.value, 'Hajimemashite');
  input.value = 'My saved draft'; input.dispatch('input');
  assert.equal(h.state.assignments.find(item => item.id === active.id).answers[LESSONS[0].homework[0].id], 'My saved draft');
  assert.equal(h.state.assignments.find(item => item.id === active.id).attempts.length, 0);
  assert.match(text(h.current.content), /Draft saved · 1\/4 answers saved/);
  assert.equal(h.asks.length, 0);
});

test('Progress reflects recorded practice and homework history and optional practice shortcuts', () => {
  const practiced = recordLessonPractice(createTeacherState(), LESSONS[0].id, correct(LESSONS[0].practice), today).state;
  const assignment = practiced.assignments[0];
  const initial = submitAssignment(practiced, assignment.id, correct(LESSONS[0].homework), today).state;
  const h = harness(initial, {extras: true}); h.ui.showProgress();
  assert.match(text(h.current.content), /1\/6/); assert.match(text(h.current.content), /1 saved practice attempt · latest 3\/3 target phrases/);
  assert.match(text(h.current.content), /Homework: first 4\/4 → latest 4\/4/);
  assert.match(text(h.current.content), /Opening a lesson alone doesn’t count as completing it/);
  for (const label of ['Practice scenes', 'Saved phrases', 'My notebook']) descendants(h.current.content).find(item => item.textContent === label).click();
  assert.deepEqual(h.opened, ['scenes', 'phrases', 'notebook']);
  assert.equal(h.writes, 0); assert.equal(h.asks.length, 0);
});

test('live teaching starts only on explicit teachLesson, sends bounded lesson context, and never marks completion', () => {
  const h = harness(createTeacherState(), {live: true});
  assert.equal(h.asks.length, 0);
  assert.equal(h.ui.teachLesson(LESSONS[0].id), true);
  assert.equal(h.asks.length, 1); assert.equal(h.asks[0].lessonContext.lessonId, LESSONS[0].id);
  assert.match(h.asks[0].question, /one practice question and wait for my answer/);
  assert.equal(h.state.activeLessonId, LESSONS[0].id);
  assert.equal(h.state.lessons[LESSONS[0].id], undefined); assert.equal(h.state.assignments.length, 0);
  const unavailable = harness(); assert.equal(unavailable.ui.teachLesson(LESSONS[0].id), false);
  assert.equal(unavailable.asks.length, 0); assert.equal(unavailable.writes, 0);
  const busy = harness(createTeacherState(), {live: true, accepted: false});
  assert.equal(busy.ui.teachLesson(LESSONS[0].id), false); assert.equal(busy.writes, 0);
  assert.equal(h.ui.teachLesson('missing-lesson'), false);
});

test('navigation callback tracks internal lesson, assignment, progress and accepted tutor actions', () => {
  const initial = createTeacherState(), assignment = createAssignment(LESSONS[0].id, today); initial.assignments.push(assignment);
  const visited = [], h = harness(initial, {live: true, onNavigate: section => visited.push(section)});
  h.ui.show(); h.ui.showLesson(LESSONS[0].id); h.ui.showAssignments(); h.ui.showAssignment(assignment.id); h.ui.showProgress(); h.ui.teachLesson(LESSONS[0].id);
  assert.deepEqual(visited, ['lessons', 'lessons', 'assignments', 'assignments', 'progress', 'tutor']);
  const rejected = harness(initial, {live: true, accepted: false, onNavigate: section => visited.push(section)});
  rejected.ui.teachLesson(LESSONS[0].id);
  assert.equal(visited.length, 6);
});

test('every authored lesson has a visual phrase board grounded in its existing example', () => {
  const h = harness();
  for (const lesson of LESSONS) {
    h.ui.showLesson(lesson.id);
    const board = descendants(h.current.content).find(item => item.className === 'lesson-concept-board');
    assert.ok(board, lesson.id);
    const example = lesson.examples[lesson.id === 'introductions' ? 1 : 0];
    const nodes = descendants(board);
    assert.equal(nodes.find(item => item.className === 'concept-phrase').textContent, example.target);
    assert.equal(nodes.find(item => item.className === 'concept-whole-reading').textContent, example.reading);
    assert.equal(nodes.find(item => item.className === 'concept-translation').textContent, example.meaning);
    const parts = nodes.filter(item => item.className === 'concept-token');
    assert.ok(parts.length >= 3);
    const joined = parts.map(part => descendants(part).find(item => item.className === 'concept-target').textContent).join('');
    assert.equal(joined, example.target.replace(/[。、]/g, ''));
    for (const part of parts) {
      assert.ok(descendants(part).find(item => item.className === 'concept-reading').textContent);
      assert.ok(descendants(part).find(item => item.className === 'concept-meaning').textContent);
    }
  }
});
