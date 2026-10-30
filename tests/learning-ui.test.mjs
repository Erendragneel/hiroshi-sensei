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
function wordsState(initial) {
  // A saved learner fixture contains checked answers for the basic characters.
  // The real sanitizer rechecks these records before allowing word lessons.
  const state = structuredClone(initial), stamp = '2026-10-30T01:00:00.000Z';
  state.foundations = Object.fromEntries(core.FOUNDATION_GROUPS.map(group => {
    const lesson = core.buildPreparedLesson({skillId:group.id,difficulty:1}, core.createLearningState());
    const checks = questions => questions.map(question => ({question,answer:question.answers[0],firstAnswer:question.answers[0],firstHinted:false,hinted:false,firstAt:stamp,at:stamp}));
    return [group.id, [{unitId:`saved-${group.id}`,completedAt:stamp,difficulty:1,practice:checks(lesson.practice),homework:checks(lesson.homework)}]];
  }));
  return state;
}
function harness(initial = core.createLearningState(), {connected = false, generate, accepted = true, wordsStage = false} = {}) {
  let state = core.sanitizeLearningState(wordsStage ? wordsState(initial) : initial), writes = 0, ui;
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
  assert.match(contentText(h.current.content), /Letters and sounds come first/);
  assert.match(contentText(h.current.content), /Hiragana.*Katakana.*Words and sentences/);
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
  assert.match(contentText(h.current.content), /That’s the sound!/);
  advance(h); completePractice(h);
  const unit = h.state.units[0]; assert.equal(unit.phase, 'assignment');
  assert.ok(unit.homework.assignedAt); assert.ok(unit.homework.dueAt);
  assert.equal(unit.homework.attempts.length, 0);
  assert.match(h.current.subtitle, /YOUR (?:ASSIGNMENT|LETTER PRACTICE)/);
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
  assert.match(contentText(h.current.content), /Let’s try that sound again/);
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

test('at the later words stage, new AI lessons require an explicit action and concurrent clicks share one request', async () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  const h = harness(undefined, {connected:true, wordsStage:true, generate: () => promise});
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
  const h = harness(undefined, {connected:true, wordsStage:true, generate: () => new Promise(done => {resolve = done;})});
  const generation = h.ui.continueLearning(), recommendation = h.calls[0][0];
  h.ui.show(); const title = h.current.title, count = h.modals.length;
  assert.equal(h.calls[0][1].signal.aborted, true);
  resolve(core.buildPreparedLesson(recommendation, h.state));
  assert.equal(await generation, false); assert.equal(h.state.units.length, 0);
  assert.equal(h.modals.length, count); assert.equal(h.current.title, title);
});

test('malformed generated material shows a safe recovery view and prepared fallback saves only a real prepared lesson', async () => {
  const h = harness(undefined, {connected:true, wordsStage:true, generate: async () => ({title:'Incomplete material'})});
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
  const h = harness(undefined, {connected:true, wordsStage:true, generate: async () => {throw error;}});
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
  const h = harness(undefined, {connected:true, wordsStage:true, generate: async () => {throw {message: {raw:'not display text'}, stack:'PRIVATE'};}});
  assert.equal(await h.ui.continueLearning(), false);
  const detail = findClass(h.current.content, 'learning-error-detail');
  assert.equal(detail.role, 'status'); assert.match(detail.textContent, /connection could not finish this lesson/);
  assert.ok(action(h.current.content, 'Try preparing again'));
  assert.equal(h.state.units.length, 0); assert.equal(h.calls.length, 1);
});

test('a connected beginner starts hiragana instantly with a large character, English sound support, and no generation request', async () => {
  const h = harness(undefined, {connected:true, generate: () => {throw new Error('Letters must be ready instantly');}});
  h.ui.show();
  assert.ok(action(h.current.content, 'Start with hiragana →'));
  assert.equal(await h.ui.continueLearning(), true);
  const unit = h.state.units[0]; assert.equal(unit.lesson.skillId, 'kana-hiragana-01');
  assert.equal(unit.source, 'authored'); assert.equal(h.calls.length, 0);
  assert.match(h.current.subtitle, /LOOK · LISTEN · CHOOSE A SOUND/);
  assert.ok(h.current.content.className.split(' ').includes('learning-foundation'));
  const card = findClass(h.current.content, 'learning-character-card'); assert.ok(card);
  assert.equal(findClass(card, 'learning-japanese').textContent, unit.lesson.examples[0].target);
  assert.equal(findClass(card, 'learning-reading').textContent, unit.lesson.examples[0].reading);
  assert.match(contentText(card), /Hiragana character.*Sound in English letters.*How to say it/);
  assert.match(contentText(h.current.content), /No Japanese keyboard needed/);
  action(card, 'Listen to the sound').click();
  assert.equal(h.spoken[0][0], unit.lesson.examples[0].target); assert.equal(h.spoken[0][1], 'ja');
  assert.equal(descendants(h.current.content).filter(item => item.tagName === 'fieldset').length, 1);
  for(const question of [...unit.lesson.practice, ...unit.lesson.homework]) if(question.type === 'write') {
    assert.ok(question.answers.every(value => !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value)), 'Written foundations must accept English letters');
  }
});

test('first Assignments opens actual foundation practice immediately instead of an empty overview or an AI request', async () => {
  const h = harness(undefined, {connected:true}); await h.ui.showAssignments();
  assert.equal(h.state.units.length, 1); assert.equal(h.state.units[0].lesson.skillId, 'kana-hiragana-01');
  assert.equal(h.calls.length, 0); assert.ok(findClass(h.current.content, 'learning-question'));
  assert.equal(findClass(h.current.content, 'learning-assignment-empty'), undefined);
  const saved = h.state.units[0].id; await h.ui.showAssignments();
  assert.equal(h.state.units.length, 1); assert.equal(h.state.units[0].id, saved);
});

test('beginner foundation routing pauses an older greeting unit without discarding its answers', async () => {
  const lesson = core.buildPreparedLesson({skillId:'introductions',difficulty:1}, core.createLearningState());
  const earlier = {id:'learning-before-characters',lesson,source:'authored',createdAt:'2026-10-26T01:00:00.000Z',phase:'lesson',practiceIndex:0,homeworkIndex:0,
    practice:{answers:{[lesson.practice[0].id]:lesson.practice[0].answers[0]},attempts:[],hints:{}},homework:{answers:{},attempts:[],hints:{},assignedAt:null,dueAt:null},completedAt:null};
  const saved = {...core.createLearningState(),units:[earlier]};
  const oldAnswers = structuredClone(core.getLearningUnit(saved, earlier.id).practice.answers);
  const h = harness(saved, {connected:true}); await h.ui.continueLearning();
  assert.ok(findClass(h.current.content, 'learning-character-card'));
  assert.equal(h.state.units.length, 2); assert.equal(h.calls.length, 0);
  assert.deepEqual(core.getLearningUnit(h.state, earlier.id).practice.answers, oldAnswers);
  assert.equal(core.getLearningSummary(h.state).activeUnit.lesson.skillId, 'kana-hiragana-01');
});

test('the two-character group teaches the character in the current question even when examples are reordered', async () => {
  const starter = harness(); await starter.ui.continueLearning(); completePractice(starter);
  while(core.getLearningSummary(starter.state).activeUnit?.phase === 'assignment') {
    answer(starter, currentExercise(starter).exercise.answers[0]); advance(starter);
  }
  assert.equal(starter.state.units[0].phase, 'complete');
  const recommendation = core.recommendLesson(starter.state); assert.equal(recommendation.skillId, 'kana-hiragana-02');
  const lesson = core.buildPreparedLesson(recommendation, starter.state);
  assert.equal(lesson.practice.length, 2); assert.equal(lesson.homework.length, 3);
  const firstCharacter = lesson.examples[0].target, secondCharacter = lesson.examples[1].target;
  lesson.examples.reverse(); lesson.explanation.reverse();
  const outcome = core.startLearningUnit(starter.state, lesson, {source:'authored'});
  const h = harness(outcome.state, {connected:true}); h.ui.showUnit(outcome.unit.id);
  assert.equal(findClass(h.current.content, 'learning-japanese').textContent, firstCharacter);
  assert.match(contentText(findClass(h.current.content, 'learning-teaching')), new RegExp(firstCharacter));
  answer(h, currentExercise(h).exercise.answers[0]); advance(h);
  assert.equal(findClass(h.current.content, 'learning-japanese').textContent, secondCharacter);
  assert.match(contentText(findClass(h.current.content, 'learning-teaching')), new RegExp(secondCharacter));
  answer(h, currentExercise(h).exercise.answers[0]); advance(h);
  assert.equal(currentExercise(h).phase, 'assignment', 'There must not be an invented third practice question');
  for(let index = 0; index < 2; index++) { answer(h, currentExercise(h).exercise.answers[0]); advance(h); }
  assert.equal(currentExercise(h).unit.homeworkIndex, 2);
  assert.match(currentExercise(h).exercise.prompt, new RegExp(firstCharacter), 'The third homework question repeats the first taught character');
  assert.equal(h.calls.length, 0);
});

test('Assignments preserves a future kana draft while opening the first missing character group', async () => {
  const lesson = core.buildPreparedLesson({skillId:'kana-hiragana-02',difficulty:1}, core.createLearningState());
  const stamp = '2026-10-30T01:00:00.000Z';
  const future = {id:'learning-restored-later-letters',lesson,source:'authored',createdAt:stamp,phase:'assignment',practiceIndex:lesson.practice.length - 1,homeworkIndex:0,
    practice:{answers:Object.fromEntries(lesson.practice.map(question => [question.id,question.answers[0]])),attempts:lesson.practice.map(question => ({exerciseId:question.id,answer:question.answers[0],at:stamp,hinted:false})),hints:{}},
    homework:{answers:{[lesson.homework[0].id]:lesson.homework[0].answers[0]},attempts:[],hints:{},assignedAt:stamp,dueAt:'2026-10-31T01:00:00.000Z'},completedAt:null};
  const saved = {...core.createLearningState(),units:[future]};
  const before = core.getLearningUnit(saved, future.id);
  assert.equal(before.phase, 'assignment'); assert.equal(core.getLearningSummary(saved).pendingUnits.length, 0);
  const h = harness(saved, {connected:true}); await h.ui.showAssignments();
  const selected = core.getLearningSummary(h.state).activeUnit;
  assert.equal(selected.lesson.skillId, 'kana-hiragana-01');
  assert.equal(findClass(h.current.content, 'learning-japanese').textContent, 'あ');
  assert.deepEqual(core.getLearningUnit(h.state, future.id).homework.answers, before.homework.answers);
  assert.equal(core.getLearningUnit(h.state, future.id).homework.dueAt, before.homework.dueAt);
  assert.equal(h.state.units.length, 2); assert.equal(h.calls.length, 0);
});
