import { LESSONS, createAssignment, recordLessonPractice, submitAssignment } from './teacher-core.js';

// Visual breakdowns of the course's existing examples, not additional grammar.
const CONCEPT_BOARDS = {
  introductions: { exampleIndex: 1, parts: [
    ['私', 'watashi', 'I', 'word'], ['は', 'wa', 'marks the topic', 'particle'],
    ['ケン', 'Ken', 'Ken', 'word'], ['です', 'desu', 'polite introduction ending', 'phrase'],
  ] },
  'cafe-requests': { exampleIndex: 0, parts: [
    ['コーヒー', 'kōhī', 'coffee', 'word'], ['を', 'o', 'marks the item you want', 'particle'],
    ['ください', 'kudasai', 'please give me', 'request'],
  ] },
  'likes-dislikes': { exampleIndex: 0, parts: [
    ['音楽', 'ongaku', 'music', 'word'], ['が', 'ga', 'marks what you like', 'particle'],
    ['好きです', 'suki desu', 'like', 'phrase'],
  ] },
  'daily-routine': { exampleIndex: 0, parts: [
    ['七時', 'shichiji', 'seven o’clock', 'time'], ['に', 'ni', 'marks the clock time', 'particle'],
    ['起きます', 'okimasu', 'wake up', 'verb'],
  ] },
  'directions-travel': { exampleIndex: 0, parts: [
    ['駅', 'eki', 'station', 'word'], ['は', 'wa', 'marks the topic', 'particle'],
    ['どこですか', 'doko desu ka', 'where is it?', 'question'],
  ] },
  'past-weekend': { exampleIndex: 0, parts: [
    ['昨日', 'kinō', 'yesterday', 'time'], ['東京', 'Tōkyō', 'Tokyo', 'word'],
    ['に', 'ni', 'marks the destination', 'particle'], ['行きました', 'ikimashita', 'went', 'verb'],
  ] },
};

// The lesson/checking engine is shared with tests. This module only renders UI.
export function createTeacherUI({ getCompanionName = () => 'Hiroshi sensei', getState, setState, openModal, toast, speak, canAsk, onAsk, onOpenScenes, onOpenPhrases, onOpenNotebook, onNavigate = () => {} }) {
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
  const answered = (item, exercises) => exercises.filter(exercise => typeof item?.answers?.[exercise.id] === 'string' && item.answers[exercise.id].trim()).length;
  const statusText = item => hasDraftRevision(item) ? 'Unsubmitted revision' : isDone(item) ? 'Reviewed · complete' : item.status === 'submitted' ? 'Ready to revise' : answered(item, lessonById(item.lessonId)?.homework || []) ? 'Draft saved' : 'Assignment ready';
  const dueText = item => {
    const due = Date.parse(item.dueAt), now = Date.now();
    const jstDay = time => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const prefix = isDone(item) ? 'Due' : due < now ? 'Due date passed' : jstDay(due) === jstDay(now) ? 'Due today' : 'Due';
    return `${prefix} · ${dateText(item.dueAt)}`;
  };
  const assignmentDraftText = item => {
    const total = lessonById(item.lessonId)?.homework.length || 0;
    return `${statusText(item)} · ${answered(item, lessonById(item.lessonId)?.homework || [])}/${total} answers saved`;
  };
  const open = (title, subtitle, teachingContext = 'Choose what we will learn together today.') => {
    const content = openModal(title, subtitle);
    const presence = el('section', 'teacher-presence');
    presence.setAttribute('aria-label', `${getCompanionName()}, your Japanese tutor`);
    const portrait = el('img', 'teacher-presence-portrait');
    portrait.src = './assets/hiroshi-sensei.png';
    portrait.alt = getCompanionName();
    portrait.width = 84;
    portrait.height = 84;
    const copy = el('div', 'teacher-presence-copy');
    copy.append(el('strong', '', getCompanionName()), el('span', '', 'Your Japanese tutor'), el('p', '', teachingContext));
    presence.append(portrait, copy);
    content.append(presence);
    return content;
  };

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
    if (!canAsk()) b.title = 'Connect the tutor from your classroom to ask for a live explanation.';
    return b;
  }
  function teachLesson(id) {
    const lesson = lessonById(id);
    if (!lesson) return false;
    if (!canAsk()) {
      toast('Connect your tutor to begin live teaching. Written lessons and assignments are ready now.');
      return false;
    }
    const accepted = onAsk(context(lesson), `Teach me the lesson “${lesson.title}” as ${getCompanionName()}. Start with a short, clear explanation in English and one Japanese example with its pronunciation and translation. Then ask me one practice question and wait for my answer. Guide me step by step. Do not claim that a lesson is completed or an assignment is saved; I will record my practice in the lesson.`);
    if (accepted === false) return false;
    change(s => { s.activeLessonId = id; });
    onNavigate('tutor');
    return true;
  }
  function navigation(content, tab) {
    const row = el('nav', 'teacher-tabs');
    row.setAttribute('aria-label', 'Teacher mode');
    for (const [label, key, handler] of [['Lessons', 'lessons', show], ['Assignments', 'homework', openAssignments], ['Progress', 'progress', showProgress]]) {
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
  function conceptBoard(lesson) {
    const concept = CONCEPT_BOARDS[lesson.id];
    const example = concept && lesson.examples[concept.exampleIndex];
    if (!example) return null;
    const board = el('section', 'lesson-concept-board');
    board.append(el('h3', '', 'See how it fits together'));
    const phrase = el('p', 'concept-phrase', example.target);
    phrase.lang = 'ja';
    board.append(phrase, el('p', 'concept-whole-reading', example.reading));
    const tokens = el('div', 'concept-tokens');
    for (const [target, reading, meaning, role] of concept.parts) {
      const token = el('div', 'concept-token');
      token.setAttribute('data-role', role);
      const japanese = el('strong', 'concept-target', target);
      japanese.lang = 'ja';
      token.append(japanese, el('span', 'concept-reading', reading), el('span', 'concept-meaning', meaning));
      tokens.append(token);
    }
    board.append(tokens, el('p', 'concept-translation', example.meaning));
    return board;
  }
  function show() {
    const content = open(`Learn with ${getCompanionName()}`, 'YOUR JAPANESE CLASSROOM', 'A short lesson, practice together, and a small assignment for later.');
    onNavigate('lessons');
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
    const content = open(lesson.title, 'YOUR LESSON · BEGINNER JAPANESE', lesson.objective);
    onNavigate('lessons');
    const top = el('div', 'teacher-toolbar');
    top.append(action('← All lessons', 'teacher-link', show), el('span', 'teacher-duration', `${lesson.minutes} minutes · go at your pace`));
    content.append(top);
    const goal = el('section', 'lesson-goal');
    goal.append(el('span', 'eyebrow', 'TODAY’S LEARNING GOAL'), el('p', '', lesson.objective));
    content.append(goal);
    const visual = conceptBoard(lesson);
    if (visual) content.append(visual);
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
    if (!canAsk()) content.append(el('p', 'help-note', 'The lesson and homework work offline. Connect the tutor from your classroom for a live explanation.'));
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
  function openAssignments() {
    const state = getState();
    const pending = state.assignments.filter(item => lessonById(item.lessonId) && !isDone(item))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
    if (pending) return showAssignment(pending.id);
    if (!state.assignments.length) return assignNextLesson();
    return showHomework();
  }
  function assignNextLesson() {
    const state = getState();
    const pending = state.assignments.find(item => lessonById(item.lessonId) && !isDone(item));
    if (pending) return showAssignment(pending.id);
    const lesson = LESSONS.find(item => !state.assignments.some(assignment => assignment.lessonId === item.id));
    if (!lesson) return showHomework();
    const assignment = createAssignment(lesson.id, new Date().toISOString());
    change(next => { next.activeLessonId = lesson.id; next.assignments.push(assignment); });
    showAssignment(assignment.id);
  }
  function showHomework() {
    const content = open('Your assignments', 'TASKS · DRAFTS · FEEDBACK', 'Your assigned work, saved drafts, and feedback are all here.');
    onNavigate('assignments');
    navigation(content, 'homework');
    content.append(el('p', 'modal-intro', 'Your drafts save as you type. Submit when you’re ready, then use the feedback to revise. Due dates help you plan; there are no penalties or automatic notifications.'));
    const assignments = getState().assignments.filter(item => lessonById(item.lessonId));
    if (!assignments.length) {
      const empty = el('div', 'teacher-empty');
      empty.append(el('span', '', '✎'), el('h3', '', 'Start your first assignment'), el('p', '', 'Four short introduction exercises, with the lesson notes beside your work.'), action('Open my first assignment →', 'primary-button', assignNextLesson));
      content.append(empty);
    }
    const pending = assignments.filter(item => !isDone(item)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    const reviewed = assignments.filter(isDone).sort((a, b) => Date.parse(b.submittedAt || b.assignedAt) - Date.parse(a.submittedAt || a.assignedAt));
    for (const [heading, items] of [['To work on', pending], ['Reviewed assignments', reviewed]]) {
      if (!items.length) continue;
      const section = el('section', 'teacher-assignment-group');
      section.append(el('h3', '', `${heading} · ${items.length}`));
      for (const assignment of items) {
        const lesson = lessonById(assignment.lessonId);
        const card = action('', 'teacher-assignment-card', () => showAssignment(assignment.id));
        const text = el('span', 'teacher-assignment-detail');
        text.append(el('strong', '', lesson.title), el('small', 'teacher-assignment-due', dueText(assignment)), el('small', '', `${answered(assignment, lesson.homework)}/${lesson.homework.length} answers saved`));
        if (latest(assignment)) text.append(el('small', '', `Last submitted review: ${assignment.latestScore}/${lesson.homework.length} target phrases`));
        const tag = el('span', `assignment-status${isDone(assignment) ? ' complete' : ''}`, statusText(assignment));
        card.append(text, tag);
        section.append(card);
      }
      content.append(section);
    }
    if (assignments.length && !pending.length) {
      const nextLesson = LESSONS.find(lesson => !assignments.some(item => item.lessonId === lesson.id));
      const next = el('section', 'assignment-next');
      next.append(el('h3', '', nextLesson ? 'Ready for your next assignment?' : 'You have finished this set of assignments'));
      next.append(el('p', '', nextLesson ? `${nextLesson.title}: ${nextLesson.objective}` : 'Revisit a lesson, review your feedback, or practise these phrases with Hiroshi.'));
      next.append(action(nextLesson ? 'Get my next assignment →' : 'Review my lessons →', 'primary-button', nextLesson ? assignNextLesson : show));
      content.append(next);
    }
    if (assignments.length) content.append(el('p', 'teacher-footnote', 'Open an assignment to continue its saved draft, submit your work, or read earlier feedback. These are exercises from your Japanese course; feedback checks the taught phrases.'));
  }
  function showAssignment(id, review = true) {
    const assignment = getState().assignments.find(item => item.id === id);
    if (!assignment) return showHomework();
    const lesson = lessonById(assignment.lessonId);
    const content = open(lesson.title, 'ASSIGNMENT · YOUR ANSWERS SAVE AS YOU TYPE', `Let’s work on “${lesson.title}” together. Your feedback stays with this assignment.`);
    onNavigate('assignments');
    const top = el('div', 'teacher-toolbar');
    top.append(action('← All assignments', 'teacher-link', showHomework), el('span', 'teacher-duration', dueText(assignment)));
    const draftStatus = el('p', 'teacher-draft-status', assignmentDraftText(assignment));
    draftStatus.setAttribute('role', 'status');
    content.append(top, draftStatus);
    const brief = el('section', 'assignment-brief');
    brief.append(el('h3', '', 'Your task'), el('p', '', lesson.objective), el('p', '', `${lesson.homework.length} short exercises · Japanese or the taught romanization`));
    const steps = el('ol', 'assignment-steps');
    for (const instruction of ['Read or listen to the lesson examples.', 'Write your answers below. Your draft saves as you type.', 'Submit, read the feedback, and revise anything you want to practise.']) steps.append(el('li', '', instruction));
    brief.append(steps, action('Review the full lesson →', 'teacher-link', () => showLesson(lesson.id)));
    content.append(brief);
    const notes = el('details', 'assignment-lesson-help');
    notes.append(el('summary', '', 'Lesson notes and examples — open whenever you need help'));
    for (const explanation of lesson.explanation.slice(0, 3)) notes.append(el('p', '', explanation));
    const visual = conceptBoard(lesson); if (visual) notes.append(visual);
    for (const example of lesson.examples) {
      const row = el('div', 'lesson-example'), copy = el('div');
      const target = el('p', 'example-target', example.target); target.lang = 'ja';
      copy.append(target, el('p', 'example-reading', example.reading), el('p', 'example-meaning', example.meaning));
      const listen = action('Listen', 'teacher-link', () => speak(example.target, 'ja', listen));
      listen.setAttribute('aria-label', `Listen to assignment example: ${example.target}`);
      row.append(copy, listen); notes.append(row);
    }
    content.append(notes);
    const prior = latest(assignment);
    if (prior) {
      const history = el('div', 'teacher-attempts');
      history.append(el('strong', '', `First submission: ${assignment.firstScore}/${lesson.homework.length} · Latest: ${assignment.latestScore}/${lesson.homework.length}`), el('span', '', `${assignment.attempts.length} saved submission${assignment.attempts.length === 1 ? '' : 's'} · ${statusText(assignment)}`));
      content.append(history);
    }
    const form = el('form', 'teacher-form');
    appendExercises(form, lesson.homework, assignment.answers, review ? prior : null, answers => {
      change(s => { const item = s.assignments.find(a => a.id === id); if (item) item.answers = answers; });
      const current = getState().assignments.find(item => item.id === id);
      const label = assignmentDraftText(current);
      if (draftStatus.textContent !== label) draftStatus.textContent = label;
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
    const content = open('Your learning progress', 'LESSONS · PRACTICE · ASSIGNMENTS', 'See what you’ve practiced and choose your next small step.');
    onNavigate('progress');
    navigation(content, 'progress');
    summary(content);
    content.append(el('p', 'modal-intro', 'Lesson progress comes from practicing the target phrases. Homework keeps your first submission and revisions so you can see what improved. Opening a lesson alone doesn’t count as completing it.'));
    const state = getState();
    const nextAssignment = state.assignments.filter(item => !isDone(item)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
    const nextLesson = LESSONS.find(lesson => !state.lessons[lesson.id]?.completedAt);
    const nextStep = el('section', 'teacher-next-step');
    nextStep.append(el('h3', '', 'Your next step'));
    if (nextAssignment) {
      const lesson = lessonById(nextAssignment.lessonId);
      nextStep.append(el('p', '', `${lesson.title} · ${dueText(nextAssignment)}`), action('Continue this assignment →', 'primary-button', () => showAssignment(nextAssignment.id)));
    } else if (nextLesson) nextStep.append(el('p', '', nextLesson.objective), action(`Learn: ${nextLesson.title} →`, 'primary-button', () => showLesson(nextLesson.id)));
    else nextStep.append(el('p', '', 'You have practiced every lesson’s target phrases. Revisit a lesson or try the phrases in a conversation.'), action('Review the lessons →', 'secondary-button', show));
    content.append(nextStep);
    for (const lesson of LESSONS) {
      const practiced = state.lessons[lesson.id];
      const homework = state.assignments.find(a => a.lessonId === lesson.id);
      const row = el('section', 'teacher-progress-row');
      row.append(el('h3', '', lesson.title), el('p', '', practiced?.completedAt ? `Practiced ${dateText(practiced.completedAt)}` : 'Ready when you are'));
      if (practiced?.attempts?.length) {
        const report = latest(practiced);
        row.append(el('p', '', `${practiced.attempts.length} saved practice attempt${practiced.attempts.length === 1 ? '' : 's'} · latest ${report.score}/${report.total} target phrases`));
      }
      if (homework?.firstScore !== null && homework?.firstScore !== undefined) row.append(el('p', '', `Homework: first ${homework.firstScore}/${lesson.homework.length} → latest ${homework.latestScore}/${lesson.homework.length}`));
      if (homework) row.append(el('p', '', `${statusText(homework)} · ${answered(homework, lesson.homework)}/${lesson.homework.length} answers saved`));
      const buttons = el('div', 'action-row');
      buttons.append(action(practiced?.completedAt ? 'Review lesson' : 'Open lesson', 'teacher-link', () => showLesson(lesson.id)));
      if (homework) buttons.append(action('View homework', 'teacher-link', () => showAssignment(homework.id)));
      row.append(buttons);
      content.append(row);
    }
    const extras = [['Practice scenes', onOpenScenes], ['Saved phrases', onOpenPhrases], ['My notebook', onOpenNotebook]].filter(([, handler]) => typeof handler === 'function');
    if (extras.length) {
      const section = el('section', 'teacher-progress-extras');
      section.append(el('h3', '', 'More ways to practice'));
      const buttons = el('div', 'action-row');
      for (const [label, handler] of extras) buttons.append(action(label, 'secondary-button', handler));
      section.append(buttons);
      content.append(section);
    }
  }
  return { show, showHomework, showAssignments: openAssignments, showLesson, showAssignment, showProgress, teachLesson };
}
