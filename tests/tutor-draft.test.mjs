import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const teacherUI=createTeacherUI(');
const end = source.indexOf("\n$('nav-teacher')", start);
assert.ok(start >= 0 && end > start, 'The actual teacher UI hookup must be exercised.');
const hookupSource = source.slice(start, end);

function harness(draft, {live = true, busy = false} = {}) {
  let value = draft, writes = 0, hookup;
  const calls = [], sent = [], notices = [];
  const input = {get value() {return value;}, set value(next) {writes++; value = next;}};
  const priorContext = {lessonId: 'existing-lesson'};
  const state = {profile: {companionName: 'Hiroshi sensei'}, teacher: {assignments: []}, sessions: {saved: ['keep this conversation']}};
  const modal = {close() {calls.push('close');}, classList: {add() {}}};
  const context = vm.createContext({
    state, busy, liveConfigured: live, activeTeacherContext: priorContext,
    chatGPTConnection: {enabled: true},
    $: id => id === 'message-input' ? input : id === 'modal' ? modal : assert.fail('Unexpected element: ' + id),
    createTeacherUI: options => {hookup = options; return {};},
    setPrimaryNavigation: view => calls.push('navigate:' + view),
    setConversationFocus: focused => calls.push('focus-view:' + focused),
    showScenes() {}, showPhrases() {}, showMemories() {}, sanitizeTeacherState: next => next,
    openModal() {}, speak() {}, save() {}, updateProgress() {},
    toast: message => notices.push(message),
    resetPending() {calls.push('reset');},
    renderConversation() {calls.push('render');},
    resizeComposer() {calls.push('resize');},
    document: {querySelector: selector => {
      assert.equal(selector, '.conversation-panel');
      return {scrollIntoView() {calls.push('scroll');}};
    }},
    sendMessage() {calls.push('send'); sent.push(input.value);},
  });
  vm.runInContext(hookupSource, context, {filename: 'public/app.js teacher hookup'});
  return {hookup, context, input, calls, sent, notices, priorContext, state, writes: () => writes};
}

test('starting lesson help preserves an unsent tutor draft without resetting or sending', () => {
  for (const draft of ['未送信の質問です。', '  Keep my unfinished question.\n']) {
    const h = harness(draft), previousSessions = h.state.sessions;
    const accepted = h.hookup.onAsk({lessonId: 'new-lesson'}, 'Teach me a new lesson.');
    assert.equal(accepted, false);
    assert.equal(h.input.value, draft); assert.equal(h.writes(), 0);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.sent, []);
    assert.equal(h.context.activeTeacherContext, h.priorContext);
    assert.equal(h.state.sessions, previousSessions);
    assert.equal(h.notices.length, 1); assert.match(h.notices[0], /current message/i);
  }
});

test('an empty composer accepts live lesson help and sends only its explicit question', () => {
  for (const blank of ['', ' \n\t ']) {
    const h = harness(blank), lesson = {lessonId: 'new-lesson'}, question = 'Explain this lesson, then ask me one question.';
    assert.equal(h.hookup.onAsk(lesson, question), true);
    assert.equal(h.context.activeTeacherContext, lesson);
    assert.deepEqual(h.sent, [question]); assert.equal(h.writes(), 1);
    assert.deepEqual(h.calls, ['reset', 'navigate:tutor', 'focus-view:true', 'render', 'close', 'resize', 'scroll', 'send']);
    assert.deepEqual(h.notices, []);
  }
});

test('an empty composer still rejects lesson help while disconnected or already replying', () => {
  for (const options of [{live: false}, {busy: true}]) {
    const h = harness('', options);
    assert.equal(h.hookup.onAsk({lessonId: 'new-lesson'}, 'Teach me.'), false);
    assert.equal(h.writes(), 0); assert.deepEqual(h.calls, []); assert.deepEqual(h.sent, []);
    assert.equal(h.context.activeTeacherContext, h.priorContext);
  }
});
