import { LESSONS, createAssignment, recordLessonPractice, submitAssignment } from './teacher-core.js';

// The lesson/checking engine is shared with tests. This module only renders UI.
export function createTeacherUI({ getCompanionName = () => 'Hiroshi sensei', getState, setState, openModal, toast, speak, canAsk, onAsk }) {
  const el = (tag, cls, text) => {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const action = (text, cls, handler) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  };
  const change = fn => {
    const next = structuredClone(getState());
    fn(next);
    setState(next);
    return next;
  };
  const lessonById = id => LESSONS.find(item => item.id === id);
  const latest = item => item?.attempts?.at(-1);
  const dateText = value => new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(value)) + ' JST';
  const hasDraftRevision = item => Boolean(latest(item)?.results.some(result => (item.answers[result.exerciseId] || '') !== result.answer));
  const isDone = item => Number.isInteger(item?.latestScore) && item.latestScore === lessonById(item.lessonId)?.homework.length && !hasDraftRevision(item);
  const statusText = item => hasDraftRevision(item) ? 'Unsubmitted revision' : isDone(item) ? 'Reviewed · complete' : item.status === 'submitted' ? 'Ready to revise' : 'Homework assigned';
  const open = (title, subtitle) => openModal(title, subtitle);

  function context(lesson, question, review) {
    return {
      lessonId: lesson.id, title: lesson.title, objective: lesson.objective,
      explanation: lesson.explanation.slice(0, 3), examples: lesson.examples.slice(0, 3),
      ...(question ? { question } : {}), ...(review?.prompt?.trim() && review?.studentAnswer?.trim() && review?.feedback?.trim() ? { assignmentReview: review } : {})
    };
  }
  function explainButton(lesson, question, review) {
    const b = action(`Ask ${getCompanionName()} to explain ↗`, 'secondary-button', () => onAsk(context(lesson, question, review), question || `Please explain the lesson “${lesson.title}” with a short example. Help me understand, then ask me one practice question.`));
    b.disabled = !canAsk();
    if (!canAsk()) b.title = 'AI explanations are available when your local companion or hosted AI connection is running.';
    return b;
  }
  function navigation(content, tab) {
    const row = el('nav', 'teacher-tabs');
    row.setAttribute('aria-label', 'Teacher mode');
    for (const [label, key, handler] of [['Lessons', 'lessons', show], ['Homework', 'homework', showHomework], ['My progress', 'progress', showProgress]]) {
      const b = action(label, `teacher-tab${key === tab ? ' selected' : ''}`, handler);
      if (key === tab) b.setAttribute('aria-current', 'page');
      row.append(b);
    }
    content.append(row);
  }
  function summary(content) {
    const state = getState();
    const practiced = LESSONS.filter(l => state.lessons[l.id]?.completedAt).length;
    const reviewed = state.assignments.filter(isDone).length;
    const row = el('div', 'teacher-stats');
    for (const [n, label] of [[`${practiced}/${LESSONS.length}`, 'lessons practiced'], [String(state.assignments.length - reviewed), 'homework to work on'], [String(reviewed), 'homework completed']]) {
      const card = el('div');
      card.append(el('strong', '', n), el('span', '', label));
      row.append(card);
    }
    content.append(row);
  }
  function show() {
    const content = open(`Learn with ${getCompanionName()}`, 'TEACHER MODE · BEGINNER JAPANESE');
    navigation(content, 'lessons');
    content.append(el('p', 'modal-intro', 'A clear learning goal, a short lesson, a little practice, and homework you can return to. Work through the course in order or revisit any topic.'));
    summary(content);
    const journey = el('p', 'teacher-journey', 'Learn → Practice → Homework → Review');
    content.append(journey);
    const list = el('div', 'teacher-lessons');
    for (const [index, lesson] of LESSONS.entries()) {
      const state = getState();
      const completed = Boolean(state.lessons[lesson.id]?.completedAt);
      const homework = state.assignments.find(a => a.lessonId === lesson.id);
      const card = action('', `teacher-lesson-card${completed ? ' practiced' : ''}`, () => showLesson(lesson.id));
      const number = el('span', 'lesson-number', completed ? '✓' : String(index + 1).padStart(2, '0'));
      const body = el('span', 'lesson-card-body');
      body.append(el('strong', '', lesson.title), el('span', '', lesson.subtitle || lesson.objective));
      const meta = el('span', 'lesson-card-meta');
      meta.append(el('span', '', `${lesson.minutes} min`), el('small', '', homework ? statusText(homework) : completed ? 'Practiced' : 'Start lesson'));
      card.append(number, body, meta);
      list.append(card);
    }
    content.append(list, el('p', 'teacher-footnote', 'Course: beginner Japanese, with English explanations. Lessons, homework drafts, and attempts stay in this browser and are included in your backups.'));
  }
  function showLesson(id, showFeedback = false) {
    const lesson = lessonById(id);
    if (!lesson) return show();
    change(s => { s.activeLessonId = id; });
    const content = open(lesson.title, 'YOUR LESSON · BEGINNER JAPANESE');
    const top = el('div', 'teacher-toolbar');
    top.append(action('← All lessons', 'teacher-link', show), el('span', 'teacher-duration', `${lesson.minutes} minutes · go at your pace`));
    content.append(top);
    const goal = el('section', 'lesson-goal');
    goal.append(el('span', 'eyebrow', 'TODAY’S LEARNING GOAL'), el('p', '', lesson.objective));
    content.append(goal);
    const teaching = el('section', 'teacher-explanation');
    teaching.append(el('h3', '', 'Let’s learn it together'));
    for (const paragraph of lesson.explanation) teaching.append(el('p', '', paragraph));
    content.append(teaching);
    const examples = el('section', 'lesson-examples');
    examples.append(el('h3', '', 'See it in a conversation'));
    for (const example of lesson.examples) {
      const row = el('div', 'lesson-example');
      const body = el('div');
      const target = el('p', 'example-target', example.target);
      target.lang = 'ja';
      body.append(target, el('p', 'example-reading', example.reading), el('p', 'example-meaning', example.meaning));
      const listen = action('Listen', 'teacher-link', () => speak(example.target, 'ja', listen));
      listen.setAttribute('aria-label', `Listen to lesson example: ${example.target}`);
      row.append(body, listen);
      examples.append(row);
    }
    content.append(examples);
    const askRow = el('div', 'action-row');
    askRow.append(explainButton(lesson));
    content.append(askRow);
    if (!canAsk()) content.append(el('p', 'help-note', 'The lesson and homework work offline. Start the local companion for a personal AI explanation.'));
    const practice = el('section', 'teacher-practice');
    practice.append(el('h3', '', 'Try it with me'), el('p', 'help-note', 'Try the target phrase in each prompt. You can use Japanese writing or one of the taught romanized forms. Feedback explains what to try next.'));
    const state = getState();
    const saved = state.lessons[id];
    const report = showFeedback ? latest(saved) : null;
    const form = el('form', 'teacher-form');
    appendExercises(form, lesson.practice, saved?.answers || {}, report, answers => {
      change(s => { s.lessons[id] = { ...s.lessons[id], answers }; });
    }, 'practice');
    const submit = el('button', 'primary-button', 'Check my practice');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const outcome = recordLessonPractice(getState(), id, getState().lessons[id]?.answers || {}, new Date().toISOString());
      setState(outcome.state);
      showLesson(id, true);
      if (outcome.report.score === outcome.report.total) toast(`Lesson practiced. ${getCompanionName()} has assigned your homework.`);
      else toast('Your feedback is ready. Take your time and try again.');
    });
    practice.append(form);
    if (report) practice.append(resultSummary(report, 'Practice feedback'));
    content.append(practice);
    const assignment = getState().assignments.find(item => item.lessonId === id);
    const homework = el('section', 'teacher-homework-callout');
    homework.append(el('h3', '', assignment ? 'Your homework is ready' : 'A little homework for later'), el('p', '', assignment ? `Due ${dateText(assignment.dueAt)}. Your draft saves as you work.` : 'Four short exercises to help the lesson stick. Finishing the practice assigns it automatically, or you can ask for it now.'));
    homework.append(action(assignment ? 'Open my homework →' : 'Assign this homework →', 'primary-button', () => {
      if (assignment) return showAssignment(assignment.id);
      let created;
      change(s => {
        created = createAssignment(id, new Date().toISOString());
        s.assignments.push(created);
      });
      toast('Homework assigned for tomorrow.');
      showAssignment(created.id);
    }));
    content.append(homework);
  }
  function appendExercises(form, exercises, initial, report, onDraft, prefix) {
    const answers = { ...initial };
    for (const [index, exercise] of exercises.entries()) {
      const group = el('fieldset', 'teacher-exercise');
      group.append(el('legend', '', `${index + 1}. ${exercise.prompt}`));
      const update = answer => {
        answers[exercise.id] = answer;
        onDraft({ ...answers });
        // A previous review describes its submitted answer, not a newly edited draft.
        group.querySelector('.exercise-feedback')?.setAttribute('hidden', '');
      };
      if (exercise.type === 'choice') {
        const options = el('div', 'exercise-options');
        for (const [optionIndex, option] of exercise.options.entries()) {
          const label = el('label', 'exercise-choice');
          const input = el('input');
          input.type = 'radio';
          input.name = `${prefix}-${exercise.id}`;
          input.value = option;
          input.checked = answers[exercise.id] === option;
          input.addEventListener('change', () => update(option));
          label.append(input, el('span', '', option));
          options.append(label);
        }
        group.append(options);
      } else {
        const input = el('textarea', 'teacher-answer');
        input.rows = 2;
        input.maxLength = 500;
        input.placeholder = 'Write your answer…';
        input.value = answers[exercise.id] || '';
        input.setAttribute('aria-label', exercise.prompt);
        input.addEventListener('input', () => update(input.value));
        group.append(input);
      }
      const reviewed = report?.results.find(item => item.exerciseId === exercise.id);
      if (reviewed && (initial[exercise.id] || '') === reviewed.answer) {
        const feedback = el('div', `exercise-feedback ${reviewed.correct ? 'correct' : 'retry'}`);
        feedback.append(el('strong', '', reviewed.correct ? '✓ You used the target phrase' : 'Try this phrasing'), el('p', '', reviewed.feedback));
        feedback.setAttribute('role', 'status');
        group.append(feedback);
      }
      form.append(group);
    }
  }
  function resultSummary(report, label) {
    const summary = el('div', 'teacher-report');
    summary.append(el('h3', '', `${label}: ${report.score}/${report.total}`), el('p', '', report.score === report.total ? 'You used all the target phrases. Revisit the lesson whenever you want a refresher.' : 'A few phrases need another try. Read the explanations, revise your answers, and submit again.'));
    return summary;
  }
  function showHomework() {
    const content = open('Your homework', 'ASSIGNMENTS · A LITTLE PRACTICE FOR LATER');
    navigation(content, 'homework');
    content.append(el('p', 'modal-intro', 'Your drafts save as you type. Submit when you’re ready, then use the feedback to revise. Due dates help you plan; there are no penalties or automatic notifications.'));
    const assignments = [...getState().assignments].reverse();
    if (!assignments.length) {
      const empty = el('div', 'teacher-empty');
      empty.append(el('span', '', '✎'), el('h3', '', 'Your first assignment is waiting'), el('p', '', `Choose a lesson, learn the phrases, then let ${getCompanionName()} give you a little homework.`), action('Find a lesson →', 'primary-button', show));
      content.append(empty);
    }
    for (const assignment of assignments) {
      const lesson = lessonById(assignment.lessonId);
      const card = action('', 'teacher-assignment-card', () => showAssignment(assignment.id));
      const text = el('span');
      text.append(el('strong', '', lesson.title), el('small', '', `Due ${dateText(assignment.dueAt)}`));
      const tag = el('span', `assignment-status${isDone(assignment) ? ' complete' : ''}`, statusText(assignment));
      card.append(text, tag);
      content.append(card);
    }
  }
  function showAssignment(id, review = true) {
    const assignment = getState().assignments.find(item => item.id === id);
    if (!assignment) return showHomework();
    const lesson = lessonById(assignment.lessonId);
    const content = open(lesson.title, 'HOMEWORK · YOUR ANSWERS SAVE AS YOU TYPE');
    const top = el('div', 'teacher-toolbar');
    top.append(action('← All homework', 'teacher-link', showHomework), el('span', 'teacher-duration', `Due ${dateText(assignment.dueAt)}`));
    content.append(top, el('p', 'modal-intro', lesson.objective));
    const prior = latest(assignment);
    if (prior) {
      const history = el('div', 'teacher-attempts');
      history.append(el('strong', '', `First submission: ${assignment.firstScore}/${lesson.homework.length} · Latest: ${assignment.latestScore}/${lesson.homework.length}`), el('span', '', `${assignment.attempts.length} saved submission${assignment.attempts.length === 1 ? '' : 's'} · ${statusText(assignment)}`));
      content.append(history);
    }
    const form = el('form', 'teacher-form');
    appendExercises(form, lesson.homework, assignment.answers, review ? prior : null, answers => {
      change(s => { const item = s.assignments.find(a => a.id === id); if (item) item.answers = answers; });
    }, `homework-${id}`);
    const submit = el('button', 'primary-button', prior ? 'Submit my revision' : 'Submit homework');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const current = getState().assignments.find(item => item.id === id);
      const result = submitAssignment(getState(), id, current.answers, new Date().toISOString());
      setState(result.state);
      showAssignment(id, true);
      toast(result.report.score === result.report.total ? 'Homework reviewed. All target phrases used.' : 'Your homework feedback is ready. You can revise it any time.');
    });
    content.append(form);
    if (prior) content.append(resultSummary(prior, 'Last submitted homework'));
    const hints = el('section', 'teacher-homework-callout');
    hints.append(el('h3', '', 'Want a little help?'), el('p', '', `Revisit the lesson or ask ${getCompanionName()} for a hint. Coursework feedback checks this exercise’s taught phrasing; other natural wording may need a teacher-chat explanation.`));
    const row = el('div', 'action-row');
    row.append(action('Review the lesson', 'secondary-button', () => showLesson(lesson.id)), explainButton(lesson, `Help me understand the homework for “${lesson.title}”. Start with a hint, not the completed assignment.`, prior?.results.find(r => !r.correct) ? {
      prompt: lesson.homework.find(e => e.id === prior.results.find(r => !r.correct).exerciseId)?.prompt || '',
      studentAnswer: prior.results.find(r => !r.correct).answer,
      feedback: prior.results.find(r => !r.correct).feedback
    } : undefined));
    hints.append(row);
    content.append(hints);
    if (assignment.attempts.length) {
      const history = el('details', 'teacher-history');
      history.append(el('summary', '', 'View previous submissions'));
      for (const attempt of [...assignment.attempts].reverse()) {
        const card = el('section', 'teacher-history-attempt');
        card.append(el('h4', '', `${dateText(attempt.submittedAt)} · ${attempt.score}/${attempt.total}`));
        for (const [index, result] of attempt.results.entries()) card.append(el('p', '', `${index + 1}. ${result.answer || '(No answer)'} — ${result.correct ? 'target phrase used' : 'needs another try'}`));
        history.append(card);
      }
      content.append(history);
    }
    content.append(el('p', 'teacher-footnote', 'Written answers are checked against the lesson’s accepted forms. Feedback is practice guidance, not an official proficiency assessment.'));
  }
  function showProgress() {
    const content = open('Your learning progress', 'LESSONS · HOMEWORK · REVIEW');
    navigation(content, 'progress');
    summary(content);
    content.append(el('p', 'modal-intro', 'Lesson progress comes from practicing the target phrases. Homework keeps your first submission and revisions so you can see what improved. Opening a lesson alone doesn’t count as completing it.'));
    for (const lesson of LESSONS) {
      const state = getState();
      const practiced = state.lessons[lesson.id];
      const homework = state.assignments.find(a => a.lessonId === lesson.id);
      const row = el('section', 'teacher-progress-row');
      row.append(el('h3', '', lesson.title), el('p', '', practiced?.completedAt ? `Practiced ${dateText(practiced.completedAt)}` : 'Ready when you are'));
      if (homework?.firstScore !== null && homework?.firstScore !== undefined) row.append(el('p', '', `Homework: first ${homework.firstScore}/${lesson.homework.length} → latest ${homework.latestScore}/${lesson.homework.length}`));
      const buttons = el('div', 'action-row');
      buttons.append(action(practiced?.completedAt ? 'Review lesson' : 'Open lesson', 'teacher-link', () => showLesson(lesson.id)));
      if (homework) buttons.append(action('View homework', 'teacher-link', () => showAssignment(homework.id)));
      row.append(buttons);
      content.append(row);
    }
  }
  return { show, showHomework, showLesson };
}
