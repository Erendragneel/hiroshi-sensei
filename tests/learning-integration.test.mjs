import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {SCENES} from '../public/practice.js';
import {LESSONS, createTeacherState, sanitizeTeacherState, recordLessonPractice, submitAssignment} from '../public/teacher-core.js';
import {createLearningState, sanitizeLearningState, importCourseHistory, getLearningSummary, recommendLesson,
  buildPreparedLesson, startLearningUnit, saveLearningAnswer, checkLearningAnswer, advanceLearningStep} from '../public/learning-core.js';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `The real application section must exist: ${start}`);
  return source.slice(from, to);
}
const validationSource = section('const defaults=()=>', '\nlet state;');
const learningSource = section('function learningMemory()', '\nconst learningUI=');
const exportSource = section('function exportBackup()', '\nfunction showSettings()');
const canonical = value => JSON.parse(JSON.stringify(value));
const correct = exercises => Object.fromEntries(exercises.map(question => [question.id, question.answers[0]]));
const baseTime = Date.parse('2026-10-30T00:00:00.000Z');
const stamp = seconds => new Date(baseTime + seconds * 1000).toISOString();
const endpoint = 'https://koa-personal-companion.elijio-villa.chatgpt.site/api/hiroshi';

function validationHarness() {
  const context = vm.createContext({APP_CONFIG: {id: 'hiroshi-sensei'}, COMPANION_NAME: 'Hiroshi sensei', CHARACTER_REVISION: 1,
    clean: (value, max = 2500) => typeof value === 'string' ? value.slice(0, max) : '',
    LESSONS, SCENES, createTeacherState, sanitizeTeacherState, createLearningState, sanitizeLearningState, importCourseHistory,
    crypto: webcrypto});
  vm.runInContext(validationSource, context, {filename: 'public/app.js actual save validation'});
  return {context, defaults: () => canonical(vm.runInContext('defaults()', context)), validate: raw => context.validateData(raw)};
}

function oldCoursework() {
  let teacher = recordLessonPractice(createTeacherState(), LESSONS[0].id,
    {...correct(LESSONS[0].practice), [LESSONS[0].practice[0].id]: 'not the greeting'}, stamp(0)).state;
  teacher = recordLessonPractice(teacher, LESSONS[0].id, correct(LESSONS[0].practice), stamp(1)).state;
  const assignment = teacher.assignments[0];
  teacher = submitAssignment(teacher, assignment.id,
    {...correct(LESSONS[0].homework), [LESSONS[0].homework[0].id]: 'still learning this greeting'}, stamp(2)).state;
  teacher.assignments[0].answers[LESSONS[0].homework[1].id] = 'an unfinished saved revision';
  return teacher;
}
function oldSave(harness) {
  const raw = harness.defaults(); delete raw.learning;
  raw.profile = {name: 'Elijio', companionName: 'Hiroshi sensei', interests: 'Everyday Japanese'};
  raw.teacher = oldCoursework();
  raw.sessions = {'live:cafe:ja': {stage: 0, complete: false, messages: [
    {id: 'old-question', role: 'user', text: 'Please keep this conversation.', reply: '', reading: '', translation: '', correction: '', suggestions: []},
    {id: 'old-reply', role: 'assistant', text: '', reply: 'Of course.', reading: '', translation: '', correction: '', suggestions: []},
  ]}};
  raw.memories = ['I want to order food confidently.'];
  raw.phrases = [{id: 'phrase-one', text: 'ありがとうございます。', reading: 'Arigatō gozaimasu.', meaning: 'Thank you.', language: 'ja'}];
  return raw;
}
function newUnit(state = createLearningState(), seconds = 10) {
  const lesson = buildPreparedLesson(recommendLesson(state, stamp(seconds)), state, {name: 'Elijio'});
  return startLearningUnit(state, lesson, {source: 'authored', nowISO: stamp(seconds)});
}

test('actual save migration retains old conversations and homework while importing remembered struggles once', () => {
  const h = validationHarness(), raw = oldSave(h), restored = h.validate(raw);
  assert.deepEqual(canonical(restored.sessions), canonical(raw.sessions));
  assert.deepEqual(canonical(restored.teacher), canonical(sanitizeTeacherState(raw.teacher)));
  assert.deepEqual(canonical(restored.phrases), raw.phrases); assert.deepEqual(canonical(restored.memories), raw.memories);
  const summary = getLearningSummary(restored.learning, stamp(5));
  assert.ok(summary.weaknesses.some(item => item.answer === 'still learning this greeting'));
  assert.ok(summary.weaknesses.some(item => item.prompt === LESSONS[0].homework[0].prompt));
  assert.equal(restored.learning.units.length, 0);
  const again = h.validate(canonical(restored));
  assert.equal(again.learning.evidence.length, restored.learning.evidence.length);
  assert.deepEqual(canonical(again.teacher), canonical(restored.teacher));
});

test('actual save validation preserves adaptive drafts, checked attempts, and their separate teacher conversation', () => {
  const h = validationHarness(), raw = oldSave(h);
  const started = newUnit(importCourseHistory(createLearningState(), raw.teacher));
  const question = started.unit.lesson.practice[0];
  let learning = checkLearningAnswer(started.state, started.unit.id, 'lesson', question.id, 'my first attempt was wrong', stamp(11)).state;
  learning = saveLearningAnswer(learning, started.unit.id, 'lesson', question.id, 'my unfinished answer');
  raw.learning = learning;
  const key = `teacher:${started.unit.id}:ja`;
  raw.sessions[key] = {stage: 0, complete: false, messages: [{id: 'adaptive-question', role: 'user', text: 'Can you give me a smaller hint?'}]};
  raw.sessions['teacher:unknown-unit:ja'] = {messages: [{role: 'user', text: 'not associated with a saved lesson'}]};
  const restored = h.validate(raw), unit = restored.learning.units[0];
  assert.equal(unit.id, started.unit.id); assert.equal(unit.phase, 'lesson');
  assert.equal(unit.practice.answers[question.id], 'my unfinished answer');
  assert.equal(unit.practice.attempts[0].answer, 'my first attempt was wrong'); assert.equal(unit.practice.attempts[0].correct, false);
  assert.equal(restored.sessions[key].messages[0].text, 'Can you give me a smaller hint?');
  assert.equal(restored.sessions['teacher:unknown-unit:ja'], undefined);
  assert.deepEqual(canonical(restored.teacher), canonical(sanitizeTeacherState(raw.teacher)));
});

test('the actual export backup contains adaptive drafts and old work and restores them without losing either', async () => {
  const h = validationHarness(), raw = oldSave(h), started = newUnit(importCourseHistory(createLearningState(), raw.teacher));
  const question = started.unit.lesson.practice[0];
  raw.learning = saveLearningAnswer(started.state, started.unit.id, 'lesson', question.id, 'unfinished backup answer');
  const state = h.validate(raw); let backup, clicked = 0;
  Object.assign(h.context, {state, Blob, dayKey: () => '2026-10-30', toast() {},
    URL: {createObjectURL(blob) {backup = blob; return 'blob:fixture-backup';}, revokeObjectURL() {}},
    node(tag) {assert.equal(tag, 'a'); return {click() {clicked++;}};}, setTimeout(callback) {callback();}});
  vm.runInContext(exportSource, h.context, {filename: 'public/app.js actual backup export'});
  h.context.exportBackup(); assert.equal(clicked, 1); assert.ok(backup instanceof Blob);
  const exported = JSON.parse(await backup.text());
  assert.equal(exported.learning.units[0].practice.answers[question.id], 'unfinished backup answer');
  assert.deepEqual(exported.teacher, canonical(state.teacher)); assert.deepEqual(exported.sessions, canonical(state.sessions));
  const restored = h.validate(exported);
  assert.deepEqual(canonical(restored.learning), canonical(state.learning));
  assert.deepEqual(canonical(restored.sessions), canonical(state.sessions));
});

test('malformed adaptive records cannot forge completion or break the valid older save', () => {
  const h = validationHarness(), raw = oldSave(h), started = newUnit();
  const valid = canonical(started.unit), question = valid.lesson.practice[0];
  valid.phase = 'complete'; valid.completedAt = stamp(30); valid.practiceIndex = 9999; valid.homeworkIndex = 9999;
  valid.practice.answers[question.id] = 'not a correct answer';
  valid.practice.attempts = [{exerciseId: question.id, answer: 'not a correct answer', at: stamp(12), correct: true, independent: true, score: 100}];
  raw.learning = {version: 1, units: [null, {id: 'fake', lesson: {title: '<script>bad</script>'}}, valid],
    evidence: [{skillId: 'fake', correct: true, score: 100}], importedKeys: Array.from({length: 2000}, (_, index) => 'key-' + index)};
  const restored = h.validate(raw);
  assert.equal(restored.learning.units.length, 1); assert.equal(restored.learning.units[0].phase, 'lesson');
  assert.equal(restored.learning.units[0].completedAt, null); assert.equal(restored.learning.units[0].practiceIndex, 0);
  assert.equal(restored.learning.units[0].practice.attempts[0].correct, false);
  assert.ok(restored.learning.importedKeys.length <= 1200);
  assert.ok(!restored.learning.evidence.some(item => item.skillId === 'fake'));
  assert.deepEqual(canonical(restored.sessions), canonical(raw.sessions));
  assert.deepEqual(canonical(restored.teacher), canonical(sanitizeTeacherState(raw.teacher)));
});

function generationHarness({state, live = true, provider = 'chatgpt', enabled = true, fetchImpl} = {}) {
  const calls = [], transitions = [], timers = new Map(); let timerId = 0;
  const context = vm.createContext({state: state || {learning: createLearningState(), profile: {name: 'Elijio', interests: 'music'}},
    liveConfigured: live, aiProvider: provider, busy: false, chatGPTConnection: {enabled}, APP_CONFIG: {apiBase: endpoint, chatgptBackend: 'https://koa-personal-companion.elijio-villa.chatgpt.site'},
    clean: (value, max = 2500) => typeof value === 'string' ? value.slice(0, max) : '', getLearningSummary,
    AbortController, DOMException, URL,
    setTimeout(callback, milliseconds) {const id = ++timerId; timers.set(id, {callback, milliseconds}); return id;},
    clearTimeout(id) {timers.delete(id);},
    setBusy(value) {context.busy = value; transitions.push(value);},
    appFetch: async (url, options) => {calls.push({url, options}); return fetchImpl ? fetchImpl(url, options) : Response.json({lesson: {title: 'The UI validates this lesson before saving'}});},
  });
  vm.runInContext(learningSource, context, {filename: 'public/app.js actual learning connection helpers'});
  return {context, calls, transitions, timers, generate: (recommendation, options) => context.generateLearningLesson(recommendation, options)};
}

test('personal lesson generation is explicit, uses the exact configured endpoint, and sends bounded real struggle evidence', async () => {
  const h = validationHarness(), state = h.validate(oldSave(h));
  const started = newUnit(state.learning); state.learning = started.state;
  const before = canonical(state.learning), recommendation = getLearningSummary(state.learning, stamp(12)).next;
  const g = generationHarness({state}); assert.equal(g.calls.length, 0);
  const returned = await g.generate(recommendation);
  assert.equal(returned.title, 'The UI validates this lesson before saving');
  assert.equal(g.calls.length, 1); assert.equal(g.calls[0].url, endpoint + '/lesson');
  const options = g.calls[0].options, body = JSON.parse(options.body);
  assert.equal(options.method, 'POST'); assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  assert.equal(body.skillId, recommendation.skillId); assert.equal(body.difficulty, recommendation.difficulty);
  assert.equal(body.profile.name, state.profile.name); assert.equal(body.profile.interests, state.profile.interests);
  assert.equal(body.recentLessons[0], started.unit.lesson.title); assert.ok(body.recentLessons.length <= 8);
  assert.ok(body.weaknesses.length > 0 && body.weaknesses.length <= 6);
  const remembered = getLearningSummary(state.learning).weaknesses;
  assert.ok(body.weaknesses.every(item => remembered.some(real => real.prompt.slice(0, 240) === item.prompt && real.answer.slice(0, 240) === item.answer)));
  assert.ok(body.weaknesses.every(item => item.prompt.length <= 240 && item.feedback.length <= 400 && item.answer.length <= 240));
  assert.deepEqual(g.transitions, [true, false]); assert.equal(g.timers.size, 0); assert.equal(g.context.busy, false);
  assert.deepEqual(canonical(state.learning), before);
});

test('the actual generation helper blocks duplicate requests while busy and releases the UI after success', async () => {
  let release; const held = new Promise(resolve => {release = resolve;});
  const g = generationHarness({fetchImpl: async () => {await held; return Response.json({lesson: {title: 'ready'}});}});
  const recommendation = recommendLesson(createLearningState());
  const first = g.generate(recommendation);
  assert.equal(g.context.busy, true); assert.equal(g.calls.length, 1);
  await assert.rejects(g.generate(recommendation), /finish the current reply/);
  assert.equal(g.calls.length, 1); release(); assert.equal((await first).title, 'ready');
  assert.equal(g.context.busy, false); assert.deepEqual(g.transitions, [true, false]); assert.equal(g.timers.size, 0);
});

test('personalized lessons cannot use a missing or foreign backend configuration', async () => {
  for (const apiBase of [undefined, '', 'https://unapproved.invalid/api/hiroshi', 'https://koa-personal-companion.elijio-villa.chatgpt.site/api/chat']) {
    const g = generationHarness(); g.context.APP_CONFIG.apiBase = apiBase;
    await assert.rejects(g.generate(recommendLesson(createLearningState())), /not configured correctly/);
    assert.equal(g.calls.length, 0); assert.deepEqual(g.transitions, []); assert.equal(g.timers.size, 0);
  }
});

test('generation failures, cancellation, and unavailable connections retain saved learning and clear busy state', async () => {
  const state = {learning: newUnit().state, profile: {name: 'Elijio', interests: ''}}, before = canonical(state.learning);
  for (const fetchImpl of [async () => Response.json({error: {message: 'Please retry later.'}}, {status: 503}),
    async () => Response.json({unexpected: true}), async () => {throw new Error('network stopped');}]) {
    const g = generationHarness({state, fetchImpl});
    await assert.rejects(g.generate(recommendLesson(state.learning)));
    assert.equal(g.context.busy, false); assert.equal(g.timers.size, 0); assert.deepEqual(g.transitions, [true, false]);
    assert.deepEqual(canonical(state.learning), before);
  }
  const controller = new AbortController();
  const g = generationHarness({state, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {once: true});
  })});
  const pending = g.generate(recommendLesson(state.learning), {signal: controller.signal});
  controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(g.calls[0].options.signal.aborted, true); assert.equal(g.context.busy, false); assert.equal(g.timers.size, 0);
  assert.deepEqual(canonical(state.learning), before);
  const preCancelled = new AbortController(); preCancelled.abort();
  const cancelled = generationHarness({state}); await assert.rejects(cancelled.generate(recommendLesson(state.learning), {signal: preCancelled.signal}), {name: 'AbortError'});
  assert.equal(cancelled.calls.length, 0); assert.deepEqual(cancelled.transitions, []);
  for (const options of [{live: false}, {provider: 'local'}, {enabled: false}]) {
    const unavailable = generationHarness({...options, state});
    await assert.rejects(unavailable.generate(recommendLesson(state.learning)), /Connect your ChatGPT plan/);
    assert.equal(unavailable.calls.length, 0); assert.deepEqual(unavailable.transitions, []);
  }
});

test('the actual teacher chat context uses persisted adaptive difficulty and struggle memory', () => {
  const h = validationHarness(), state = h.validate(oldSave(h)), activeTeacherContext = {lessonId: 'introductions', title: 'A saved lesson'};
  const g = generationHarness({state}); g.context.activeTeacherContext = activeTeacherContext;
  const context = g.context.teacherConversationContext(), summary = getLearningSummary(state.learning);
  assert.equal(context.lessonId, activeTeacherContext.lessonId);
  assert.equal(context.learningMemory.difficulty, summary.next.difficulty);
  assert.ok(context.learningMemory.weaknesses.length > 0);
  assert.equal(activeTeacherContext.learningMemory, undefined);
  g.context.aiProvider = 'local'; assert.equal(g.context.teacherConversationContext(), activeTeacherContext);
});

test('ordinary Talk remembers the current learning focus and actual weak prompts without changing notebook notes', () => {
  const h = validationHarness(), fresh = h.defaults(); fresh.memories = ['My original notebook note.'];
  const newcomer = generationHarness({state: fresh});
  assert.equal(newcomer.context.conversationMemories(), fresh.memories);
  assert.deepEqual(fresh.memories, ['My original notebook note.']);
  const state = h.validate(oldSave(h)), started = newUnit(state.learning); state.learning = started.state;
  state.memories = Array.from({length: 12}, (_, index) => `${index}: ${'n'.repeat(240)}`);
  const notebook = state.memories, savedNotes = [...notebook], savedLearning = canonical(state.learning);
  const g = generationHarness({state}), result = g.context.conversationMemories(), summary = getLearningSummary(state.learning);
  assert.equal(result.length, 12); assert.ok(result.every(note => note.length <= 250));
  assert.deepEqual(canonical(result.slice(0, -1)), savedNotes.slice(-11));
  assert.ok(result.at(-1).includes(summary.next.label));
  assert.ok(result.at(-1).includes(({1: 'With help', 2: 'On your own', 3: 'Challenge'})[summary.next.difficulty]));
  assert.ok(result.at(-1).includes(summary.weaknesses[0].prompt.slice(0, 50)));
  assert.equal(state.memories, notebook); assert.deepEqual(state.memories, savedNotes);
  assert.deepEqual(canonical(state.learning), savedLearning); assert.equal(g.calls.length, 0);
  const sendSource = section('async function sendMessage()', '\nfunction openModal(');
  assert.match(sendSource, /memories:\s*conversationMemories\(\)/, 'The actual chat request must use the saved learning summary, not just notebook notes.');
});
