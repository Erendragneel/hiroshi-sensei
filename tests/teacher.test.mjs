import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LESSONS, MAX_ATTEMPTS, createTeacherState, createAssignment, gradeExercise,
  recordLessonPractice, submitAssignment, sanitizeTeacherState,
} from '../public/teacher-core.js';

const now = '2026-10-17T04:00:00.000Z';
const later = '2026-10-18T04:00:00.000Z';
const answersFor = (exercises) => Object.fromEntries(exercises.map(({ id, answers }) => [id, answers[0]]));

test('six authored lessons include examples, three practice tasks, and four homework tasks', () => {
  assert.equal(LESSONS.length, 6);
  const exerciseIds = new Set();
  for (const lesson of LESSONS) {
    assert.equal(lesson.practice.length, 3);
    assert.equal(lesson.homework.length, 4);
    assert.ok(lesson.examples.length >= 3);
    assert.ok(lesson.explanation.length >= 3);
    for (const exercise of [...lesson.practice, ...lesson.homework]) {
      assert.ok(!exerciseIds.has(exercise.id));
      exerciseIds.add(exercise.id);
      assert.ok(exercise.sample && exercise.prompt && exercise.explanation);
      for (const answer of exercise.answers) assert.equal(gradeExercise(exercise, answer).correct, true, exercise.id);
      if (exercise.type === 'choice') assert.ok(exercise.options.includes(exercise.answers[0]));
    }
  }
});

test('grading accepts taught variants and harmless formatting without matching different meanings', () => {
  const cafe = LESSONS[1].homework[0];
  for (const answer of [' 小さい コーヒー をください！ ', 'ちいさいコーヒーをください。', 'ＣＨＩＩＳＡＩ　ＫＯＯＨＩＩ　Ｏ　ＫＵＤＡＳＡＩ', '小さいｺｰﾋｰをください']) {
    assert.equal(gradeExercise(cafe, answer).correct, true, answer);
  }
  for (const answer of ['', '大きいコーヒーをください', '小さいコーヒーはいりません', '小さいコーヒーをください or tea', 'I do not want a small coffee', '小さいコーヒーをください水をください', '小さいこーひーをください']) {
    assert.equal(gradeExercise(cafe, answer).correct, false, answer);
  }
  assert.equal(gradeExercise(LESSONS[2].practice[2], 'あまりコーヒーが好きです').correct, false);
  assert.equal(gradeExercise(LESSONS[4].homework[1], '左に曲がってください').correct, false);
  assert.equal(gradeExercise(LESSONS[5].practice[1], 'ラーメンを食べませんでした').correct, false);
  assert.equal(gradeExercise(LESSONS[5].practice[1], 'ラーメンを食べます').correct, false);
  assert.equal(gradeExercise(cafe, `小さいコーヒーをください${' '.repeat(1100)}いいえ`).correct, false, 'long answers cannot pass by truncating a wrong suffix');
  assert.equal(gradeExercise({ answers: ['みぎ'], sample: 'みぎ', kanaEquivalent: true }, 'ミギ').correct, true);
  assert.equal(gradeExercise({ answers: ['みぎ'], sample: 'みぎ' }, 'ミギ').correct, false);
});

test('opening, drafting, and incorrect practice do not complete a lesson or issue homework', () => {
  const initial = createTeacherState();
  initial.activeLessonId = LESSONS[2].id;
  initial.lessons[LESSONS[2].id] = { answers: answersFor(LESSONS[2].practice), completedAt: now };
  const restored = sanitizeTeacherState(initial);
  assert.equal(restored.lessons[LESSONS[2].id].completedAt, null);
  assert.equal(restored.assignments.length, 0);
  const { state, report } = recordLessonPractice(restored, LESSONS[2].id, {}, now);
  assert.equal(report.score, 0);
  assert.equal(report.passed, false);
  assert.equal(state.lessons[LESSONS[2].id].completedAt, null);
  assert.equal(state.assignments.length, 0);
});

test('all three correct practice answers complete a lesson and assign homework due 24 hours later', () => {
  const lesson = LESSONS[0];
  const original = createTeacherState();
  const { state, report } = recordLessonPractice(original, lesson.id, answersFor(lesson.practice), now);
  assert.equal(report.score, 3);
  assert.equal(state.lessons[lesson.id].completedAt, now);
  assert.equal(state.assignments.length, 1);
  const assignment = state.assignments[0];
  assert.equal(assignment.assignedAt, now);
  assert.equal(assignment.dueAt, later);
  assert.equal(assignment.status, 'assigned');
  assert.equal(assignment.firstScore, null);
  assert.equal(original.assignments.length, 0);
  const retried = recordLessonPractice(state, lesson.id, answersFor(lesson.practice), later).state;
  assert.equal(retried.assignments.length, 1);
  assert.equal(retried.lessons[lesson.id].completedAt, now);
  assert.throws(() => createAssignment('__proto__', now), RangeError);
});

test('homework submission and revision preserve the first score and honest attempt history', () => {
  const lesson = LESSONS[0];
  let state = recordLessonPractice(createTeacherState(), lesson.id, answersFor(lesson.practice), now).state;
  const assignmentId = state.assignments[0].id;
  const wrong = Object.fromEntries(lesson.homework.map(({ id }) => [id, 'wrong']));
  let result = submitAssignment(state, assignmentId, wrong, now);
  state = result.state;
  assert.equal(result.report.score, 0);
  assert.equal(state.assignments[0].status, 'submitted');
  assert.equal(state.assignments[0].firstScore, 0);
  assert.equal(state.assignments[0].latestScore, 0);
  result = submitAssignment(state, assignmentId, answersFor(lesson.homework), later);
  assert.equal(result.report.score, 4);
  assert.equal(result.state.assignments[0].firstScore, 0);
  assert.equal(result.state.assignments[0].latestScore, 4);
  assert.deepEqual(result.state.assignments[0].attempts.map(({ score }) => score), [0, 4]);
  assert.equal(state.assignments[0].attempts.length, 1, 'input state is not mutated');
  assert.throws(() => submitAssignment(state, 'missing', {}, now), RangeError);
});

test('saved drafts stay separate from submitted results and forged scores are recomputed', () => {
  const lesson = LESSONS[1];
  let state = recordLessonPractice(createTeacherState(), lesson.id, answersFor(lesson.practice), now).state;
  state = submitAssignment(state, state.assignments[0].id, {}, now).state;
  state.assignments[0].answers = answersFor(lesson.homework);
  state.assignments[0].latestScore = 999;
  state.assignments[0].firstScore = 999;
  state.assignments[0].attempts[0].score = 999;
  state.assignments[0].attempts[0].results[0].correct = true;
  const restored = sanitizeTeacherState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.assignments[0].answers, answersFor(lesson.homework));
  assert.equal(restored.assignments[0].latestScore, 0);
  assert.equal(restored.assignments[0].firstScore, 0);
  assert.equal(restored.assignments[0].attempts[0].results[0].correct, false);
  assert.equal(restored.assignments[0].attempts[0].results[0].answer, '');
  assert.equal(restored.lessons[lesson.id].completedAt, now);
});

test('bounded retry history retains the original score and original lesson completion', () => {
  const lesson = LESSONS[3];
  let state = recordLessonPractice(createTeacherState(), lesson.id, answersFor(lesson.practice), now).state;
  const id = state.assignments[0].id;
  state = submitAssignment(state, id, {}, now).state;
  for (let index = 0; index < MAX_ATTEMPTS + 3; index++) {
    state = submitAssignment(state, id, answersFor(lesson.homework), later).state;
    state = recordLessonPractice(state, lesson.id, {}, later).state;
  }
  const restored = sanitizeTeacherState(state);
  assert.equal(restored.assignments[0].attempts.length, MAX_ATTEMPTS);
  assert.equal(restored.assignments[0].firstScore, 0);
  assert.equal(restored.assignments[0].latestScore, 4);
  assert.equal(restored.lessons[lesson.id].attempts.length, MAX_ATTEMPTS);
  assert.equal(restored.lessons[lesson.id].completedAt, now);
});

test('malformed saved data is safely bounded and unknown identifiers cannot create course content', () => {
  for (const raw of [null, [], 'bad', 5, { version: 99, course: 'ja-beginner' }]) {
    assert.deepEqual(sanitizeTeacherState(raw), createTeacherState());
  }
  const assignment = createAssignment(LESSONS[0].id, now);
  const raw = {
    version: 1, course: 'ja-beginner', activeLessonId: '__proto__',
    lessons: JSON.parse('{"__proto__":{"completedAt":"2026-10-17T04:00:00.000Z"}}'),
    assignments: [assignment, assignment, { ...assignment, id: '<script>bad</script>' }],
  };
  const state = sanitizeTeacherState(raw);
  assert.equal(state.activeLessonId, LESSONS[0].id);
  assert.deepEqual(state.lessons, {});
  assert.equal(state.assignments.length, 1);
  state.assignments[0].answers[LESSONS[0].homework[0].id] = { toString() { throw Error('unsafe'); } };
  assert.equal(sanitizeTeacherState(state).assignments[0].answers[LESSONS[0].homework[0].id], '');
});
