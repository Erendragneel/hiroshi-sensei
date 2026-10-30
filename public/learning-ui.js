import {
  getLearningSummary, recommendLesson, buildPreparedLesson, startLearningUnit,
  getLearningUnit, saveLearningAnswer, useLearningHint, checkLearningAnswer, advanceLearningStep,
} from './learning-core.js';

const LEVELS = {1: 'With help', 2: 'On your own', 3: 'Challenge'};
const latestFor = (part, id) => part?.attempts?.findLast(item => item.exerciseId === id);
const plain = value => typeof value === 'string' ? value : '';

/** Presentation only. Saved evidence and advancement are owned by learning-core. */
export function createLearningUI({getState, setState, getCompanionName = () => 'Hiroshi sensei',
  getProfile = () => ({}), openModal, toast = () => {}, speak = () => {},
  canGenerate = () => false, generateLesson, onAsk, onNavigate = () => {},
  onOpenLibrary, onOpenCourseAssignments, onOpenNotebook}) {
  let pending = null, generationVersion = 0;
  const el = (tag, cls, text) => {
    const item = document.createElement(tag);
    if(cls) item.className = cls;
    if(text !== undefined) item.textContent = String(text);
    return item;
  };
  const action = (label, cls, handler) => {
    const button = el('button', cls, label); button.type = 'button';
    button.addEventListener('click', handler); return button;
  };
  const summary = () => getLearningSummary(getState());
  const update = next => { setState(next); return next; };
  const date = value => value ? new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(new Date(value)) + ' JST' : '';
  function dispose() {
    generationVersion++;
    const old = pending; pending = null; old?.controller.abort();
  }
  function open(title, subtitle, message, route = 'lessons') {
    const content = openModal(title, subtitle);
    content.classList?.add('adaptive-learning');
    onNavigate(route);
    const presence = el('section', 'teacher-presence learning-presence');
    presence.setAttribute('aria-label', `${getCompanionName()}, your Japanese tutor`);
    const portrait = el('img', 'teacher-presence-portrait');
    portrait.src = './assets/hiroshi-sensei.png'; portrait.alt = getCompanionName();
    portrait.width = 84; portrait.height = 84;
    const copy = el('div', 'teacher-presence-copy');
    copy.append(el('strong', '', getCompanionName()), el('span', '', 'Your personal Japanese teacher'), el('p', '', message));
    presence.append(portrait, copy); content.append(presence); return content;
  }
  function navigation(content, current) {
    const row = el('nav', 'teacher-tabs learning-tabs'); row.setAttribute('aria-label', 'Your learning');
    for(const [label, route, handler] of [['Learn', 'lessons', show], ['Assignments', 'assignments', showAssignments], ['My progress', 'progress', showProgress]]) {
      const item = action(label, `teacher-tab${current === route ? ' selected' : ''}`, handler);
      if(current === route) item.setAttribute('aria-current', 'page'); row.append(item);
    }
    content.append(row);
  }
  function shortcuts(content) {
    const entries = [['Course library', onOpenLibrary], ['Earlier course assignments', onOpenCourseAssignments], ['My notebook', onOpenNotebook]].filter(([, fn]) => typeof fn === 'function');
    if(!entries.length) return;
    const section = el('section', 'learning-shortcuts');
    section.append(el('h3', '', 'Your saved course work'));
    const row = el('div', 'action-row');
    for(const [label, fn] of entries) row.append(action(label, 'secondary-button', () => {dispose(); fn();}));
    section.append(row); content.append(section);
  }
  function memory(content, data, detailed = false) {
    const section = el('section', 'learning-memory');
    section.append(el('h3', '', 'What we are working on'));
    const weaknesses = Array.isArray(data.weaknesses) ? data.weaknesses : [];
    if(!weaknesses.length) section.append(el('p', '', 'Your first answers will show me where to give you more help. You can use a hint whenever you need one.'));
    else {
      section.append(el('p', '', 'These are phrases from your saved practice that deserve another small step. A mistake is useful information.'));
      const list = el('ul', 'learning-weaknesses');
      for(const item of weaknesses.slice(0, detailed ? 8 : 3)) {
        const entry = el('li'); entry.append(el('strong', '', item.label || 'Japanese practice'), el('span', '', item.prompt || item.feedback || 'We will practise this again.'));
        if(detailed && item.feedback) entry.append(el('small', '', item.feedback));
        list.append(entry);
      }
      section.append(list);
    }
    content.append(section);
  }
  function reason(content, recommendation) {
    const card = el('section', 'learning-reason');
    card.append(el('p', 'eyebrow', 'YOUR NEXT SMALL STEP'), el('h3', '', recommendation.label || 'A little Japanese'),
      el('span', 'learning-level', LEVELS[recommendation.difficulty] || LEVELS[1]),
      el('p', '', recommendation.reason || 'We will start simply and use your answers to choose what comes next.'));
    content.append(card); return card;
  }
  function show() {
    const data = summary();
    const content = open('Your learning plan', 'ONE SMALL STEP · THEN PRACTISE', 'We will learn a little, try it together, and return to anything that feels difficult.');
    navigation(content, 'lessons');
    const next = data.next || recommendLesson(getState());
    reason(content, next);
    const active = data.activeUnit;
    const row = el('div', 'action-row learning-primary-actions');
    row.append(action(active ? 'Continue where I stopped →' : 'Teach my next lesson →', 'primary-button', () => { void continueLearning(); }));
    if(!active && canGenerate() && typeof generateLesson === 'function') row.append(action('Use a prepared lesson', 'secondary-button', () => {void continueLearning({prepared:true});}));
    content.append(row, el('p', 'help-note', active ? 'Your lesson and answers are saved. Continue without starting again.' : canGenerate() ? 'Hiroshi can prepare a new lesson around your saved practice. You choose when to begin.' : 'Prepared lessons work without an AI connection. Your answers still guide the next topic and the amount of help.'));
    memory(content, data); shortcuts(content);
  }
  async function continueLearning({prepared = false} = {}) {
    if(pending) return pending.promise;
    const data = summary();
    if(data.activeUnit) { showUnit(data.activeUnit.id); return true; }
    const recommendation = data.next || recommendLesson(getState());
    if(prepared || !canGenerate() || typeof generateLesson !== 'function') {
      const lesson = buildPreparedLesson(recommendation, getState(), getProfile());
      const outcome = startLearningUnit(getState(), lesson, {source:'authored'});
      update(outcome.state); showUnit(outcome.unit.id); return true;
    }
    const content = open('Preparing your next lesson', 'A LESSON FOR YOUR NEXT STEP', 'I am preparing a short explanation, a little practice, and an assignment around your next step.');
    reason(content, recommendation);
    const status = el('p', 'learning-loading', 'Preparing your lesson…'); status.setAttribute('role', 'status'); content.append(status);
    content.append(action('Cancel and return to my plan', 'secondary-button', show));
    // openModal may dispose the previous view. Register this request afterwards.
    const job = {controller: new AbortController(), version: ++generationVersion, promise: null}; pending = job;
    job.promise = (async () => {
      try {
        const result = await generateLesson(recommendation, {signal:job.controller.signal, learningSummary:data});
        if(pending !== job || job.controller.signal.aborted || generationVersion !== job.version) return false;
        const outcome = startLearningUnit(getState(), result?.lesson || result, {source:'ai'});
        pending = null;
        update(outcome.state); showUnit(outcome.unit.id); return true;
      } catch(error) {
        if(pending !== job || job.controller.signal.aborted || generationVersion !== job.version) return false;
        pending = null;
        const failure = open('Your saved work is safe', 'LET’S KEEP YOUR NEXT STEP SIMPLE', 'I could not prepare a new AI lesson just now. We can still learn using a prepared lesson.');
        // The app adapter supplies bounded, user-facing errors. Keep them plain
        // text here; never render stacks, provider payloads, or HTML.
        const message = typeof error?.message === 'string'
          ? error.message.slice(0, 350).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
          : '';
        const detail = el('p', 'help-note learning-error-detail', message || 'The connection could not finish this lesson. You can use a prepared lesson now or try again later.');
        detail.setAttribute('role', 'status'); failure.append(detail);
        reason(failure, recommendation);
        const actions = el('div', 'action-row');
        const needsConnectionAction = /\b(?:quota|limit|permission|approve|expired|reauthoriz\w*|sign[ -]?in)\b|connect[^.]{0,100}\bsettings\b/i.test(message);
        actions.append(action('Use a prepared lesson →', 'primary-button', () => {void continueLearning({prepared:true});}),
          needsConnectionAction ? action('Back to my learning plan', 'secondary-button', show) : action('Try preparing again', 'secondary-button', () => {void continueLearning();}));
        if(needsConnectionAction) failure.append(el('p', 'help-note', 'Follow the connection or usage guidance above before preparing another AI lesson. Prepared lessons are available now.'));
        failure.append(actions, el('p', 'help-note', 'No new lesson or assignment was saved from the failed request. Your earlier progress is unchanged.'));
        return false;
      } finally { if(pending === job) pending = null; }
    })();
    return job.promise;
  }
  function example(content, item) {
    if(!item) return;
    const card = el('section', 'learning-example');
    const target = el('p', 'learning-japanese', item.target); target.lang = 'ja';
    card.append(target);
    if(item.reading) card.append(el('p', 'learning-reading', item.reading));
    card.append(el('p', 'learning-meaning', item.meaning));
    const listen = action('Listen', 'secondary-button', () => speak(item.target, 'ja', listen));
    listen.setAttribute('aria-label', `Listen to ${item.target}`); card.append(listen); content.append(card);
  }
  function showUnit(id) {
    const unit = getLearningUnit(getState(), id);
    if(!unit) { show(); return; }
    if(unit.phase === 'complete') { showComplete(unit); return; }
    const lesson = unit.lesson, assignment = unit.phase === 'assignment';
    const phase = assignment ? 'assignment' : 'lesson';
    const questions = assignment ? lesson.homework : lesson.practice;
    const index = assignment ? unit.homeworkIndex : unit.practiceIndex;
    const question = questions[index];
    if(!question) { show(); return; }
    const part = assignment ? unit.homework : unit.practice;
    const content = open(lesson.title, assignment ? 'YOUR ASSIGNMENT · ONE QUESTION AT A TIME' : 'LEARN · TRY · KEEP GOING',
      assignment ? 'Use what we learned. You can open the notes or ask for a hint whenever you need one.' : 'We will work through one small idea and one question at a time.', assignment ? 'assignments' : 'lessons');
    const top = el('div', 'learning-unit-toolbar');
    top.append(action('← My learning plan', 'teacher-link', show), el('span', 'learning-level', LEVELS[lesson.difficulty] || LEVELS[1]));
    content.append(top, el('p', 'learning-objective', lesson.objective));
    const progress = el('div', 'learning-step-progress');
    progress.append(el('strong', '', `${assignment ? 'Assignment' : 'Practice'} ${index + 1} of ${questions.length}`));
    const meter = el('progress'); meter.max = questions.length; meter.value = index;
    meter.setAttribute('aria-label', `${index} of ${questions.length} questions finished`); progress.append(meter); content.append(progress);
    if(assignment && part.dueAt) content.append(el('p', 'learning-due', `Due ${date(part.dueAt)} · your answers save as you type`));
    if(!assignment) {
      const teaching = el('section', 'learning-teaching');
      teaching.append(el('h3', '', 'Let’s learn this small part'));
      const paragraph = lesson.explanation[Math.min(index, lesson.explanation.length - 1)];
      if(paragraph) teaching.append(el('p', '', paragraph));
      content.append(teaching); example(content, lesson.examples[Math.min(index, lesson.examples.length - 1)]);
    } else {
      const notes = el('details', 'learning-notes'); notes.append(el('summary', '', 'Open my lesson notes'));
      for(const paragraph of lesson.explanation) notes.append(el('p', '', paragraph));
      for(const item of lesson.examples) example(notes, item);
      notes.addEventListener('toggle', () => {
        if(notes.open) update(useLearningHint(getState(), unit.id, phase, question.id));
      });
      content.append(notes);
    }
    const form = el('form', 'learning-question');
    const group = el('fieldset'); group.append(el('legend', '', question.prompt));
    let answer = plain(part.answers?.[question.id]);
    const previous = latestFor(part, question.id);
    const reviewed = previous && plain(previous.answer).trim() === answer.trim() ? previous : null;
    const feedback = el('div', `learning-feedback${reviewed?.correct ? ' correct' : ' retry'}`);
    feedback.setAttribute('role', 'status'); feedback.hidden = !reviewed;
    if(reviewed) renderFeedback(feedback, reviewed);
    const nextLabel = index + 1 < questions.length ? 'Next small step →' : assignment ? 'Finish this assignment →' : 'Open my assignment →';
    const next = action(nextLabel, 'primary-button', () => {
      const state = advanceLearningStep(getState(), unit.id, phase);
      update(state); showUnit(unit.id);
    }); next.disabled = !reviewed?.correct;
    const draft = value => {
      answer = value;
      update(saveLearningAnswer(getState(), unit.id, phase, question.id, value));
      feedback.hidden = true; next.disabled = true;
    };
    if(question.type === 'choice') {
      const options = el('div', 'learning-options');
      for(const option of question.options) {
        const label = el('label', 'learning-choice'), radio = el('input');
        radio.type = 'radio'; radio.name = `learning-${unit.id}-${question.id}`; radio.value = option; radio.checked = answer === option;
        radio.addEventListener('change', () => draft(option)); label.append(radio, el('span', '', option)); options.append(label);
      }
      group.append(options);
    } else {
      const input = el('textarea', 'learning-answer'); input.rows = 2; input.maxLength = 500; input.value = answer;
      input.placeholder = 'Japanese or the taught romanization'; input.setAttribute('aria-label', question.prompt);
      input.addEventListener('input', () => draft(input.value)); group.append(input);
    }
    const hints = el('div', 'learning-hint'); hints.hidden = !part.hints?.[question.id];
    if(!hints.hidden) hints.append(el('strong', '', 'A little help'), el('p', '', question.explanation));
    const hint = action(part.hints?.[question.id] ? 'Show my hint again' : 'Give me a hint', 'secondary-button', () => {
      update(useLearningHint(getState(), unit.id, phase, question.id));
      hints.hidden = false; hints.replaceChildren(el('strong', '', 'A little help'), el('p', '', question.explanation));
    });
    const check = el('button', 'primary-button', 'Check my answer'); check.type = 'submit';
    form.append(group, hints);
    const checks = el('div', 'action-row learning-answer-actions'); checks.append(check, hint); form.append(checks, feedback, next);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if(!answer.trim()) {toast('Try an answer, or use a hint first.'); return;}
      const outcome = checkLearningAnswer(getState(), unit.id, phase, question.id, answer);
      update(outcome.state);
      renderFeedback(feedback, outcome.report); feedback.hidden = false; next.disabled = !outcome.report.correct;
      feedback.scrollIntoView?.({block:'nearest', behavior:'smooth'});
    });
    content.append(form);
    if(typeof onAsk === 'function') {
      const ask = action(`Ask ${getCompanionName()} to explain`, 'teacher-link', () => {
        const lessonContext = {lessonId:unit.id, title:lesson.title, objective:lesson.objective, explanation:lesson.explanation.slice(0,3), examples:lesson.examples.slice(0,3)};
        const accepted = onAsk(lessonContext, `Help me with this question from “${lesson.title}”: ${question.prompt}. Give me a small hint first, then wait for my answer.`);
        if(accepted !== false) update(useLearningHint(getState(), unit.id, phase, question.id));
      });
      ask.disabled = !canGenerate(); content.append(ask);
    }
    content.append(el('p', 'learning-footnote', `${unit.source === 'ai' ? 'Personal AI lesson' : 'Prepared lesson'} · feedback checks this lesson’s taught forms. Hints and retries help Hiroshi choose how much support to give next.`));
    if(assignment) shortcuts(content);
  }
  function renderFeedback(node, report) {
    node.className = `learning-feedback ${report.correct ? 'correct' : 'retry'}`;
    node.replaceChildren(el('strong', '', report.correct ? 'You used the taught form' : 'Let’s try a small change'), el('p', '', report.feedback));
    if(!report.correct && report.expected) node.append(el('p', 'learning-expected', `Example to learn from: ${report.expected}`));
    if(report.correct && report.independent === false) node.append(el('small', '', 'Saved as practice with support. We will revisit it later.'));
  }
  function showComplete(unit) {
    const content = open('A small step completed', 'YOUR PRACTICE IS SAVED', 'You have finished this lesson and its assignment. We will use the answers you actually gave to choose what comes next.', 'progress');
    content.append(el('h3', 'learning-complete-title', unit.lesson.title), el('p', 'learning-objective', unit.lesson.objective));
    const independent = [...unit.practice.attempts, ...unit.homework.attempts].filter(item => item.correct && item.independent).length;
    content.append(el('p', '', `${independent} answers recorded without help. Using hints and revising also counts as useful practice.`));
    reason(content, summary().next || recommendLesson(getState()));
    content.append(action('Teach my next lesson →', 'primary-button', () => {void continueLearning();}), action('See my progress', 'secondary-button', showProgress));
    shortcuts(content);
  }
  function showAssignments() {
    const data = summary(), units = getState().units || [];
    const pendingUnits = units.filter(unit => unit.phase === 'assignment');
    // Keep a saved assignment one tap away, with its earlier coursework shortcut.
    if(pendingUnits.length === 1) {
      showUnit(pendingUnits[0].id); return;
    }
    const content = open('Your assignments', 'SAVED WORK · FEEDBACK · NEXT STEPS', 'Your assignment comes after a short lesson. We will keep the questions small and return to anything that needs practice.', 'assignments');
    navigation(content, 'assignments');
    if(!pendingUnits.length) {
      const card = el('section', 'learning-assignment-empty');
      card.append(el('h3', '', data.activeUnit ? 'Your next assignment follows this lesson' : 'Let’s prepare your next assignment'),
        el('p', '', data.activeUnit ? 'Finish the short practice with Hiroshi. Your assignment will then be ready, with a saved draft and due date.' : 'Begin the next small lesson, practise it together, then Hiroshi will give you an assignment for it.'),
        action(data.activeUnit ? 'Continue my lesson →' : 'Start my next lesson →', 'primary-button', () => {void continueLearning();}));
      content.append(card);
    }
    for(const unit of pendingUnits) {
      const card = action('', 'learning-assignment-card', () => showUnit(unit.id));
      const copy = el('span'); copy.append(el('strong', '', unit.lesson.title), el('small', '', `Question ${unit.homeworkIndex + 1} of ${unit.lesson.homework.length} · due ${date(unit.homework.dueAt)}`));
      card.append(copy, el('span', '', 'Continue →')); content.append(card);
    }
    const finished = units.filter(unit => unit.phase === 'complete').slice(-6).reverse();
    if(finished.length) {
      const section = el('section', 'learning-finished'); section.append(el('h3', '', 'Finished assignments'));
      for(const unit of finished) section.append(action(unit.lesson.title, 'teacher-link', () => showUnit(unit.id)));
      content.append(section);
    }
    shortcuts(content);
  }
  function showProgress() {
    const data = summary();
    const content = open('Your learning progress', 'YOUR ANSWERS GUIDE YOUR NEXT STEP', 'This is what your saved practice tells us. We can take more time with difficult phrases and gradually remove help as you improve.', 'progress');
    navigation(content, 'progress');
    const statistics = el('div', 'learning-stats');
    for(const [value, label] of [[data.completedUnits || 0, 'lesson assignments finished'], [data.pendingAssignments || 0, 'assignments to continue']]) {
      const item = el('div'); item.append(el('strong', '', value), el('span', '', label)); statistics.append(item);
    }
    content.append(statistics); reason(content, data.next || recommendLesson(getState()));
    content.append(action(data.activeUnit ? 'Continue where I stopped →' : 'Teach my next lesson →', 'primary-button', () => {void continueLearning();}));
    memory(content, data, true);
    const skills = Array.isArray(data.skills) ? data.skills : Object.values(data.skills || {});
    const section = el('section', 'learning-skills'); section.append(el('h3', '', 'Your topics'));
    for(const skill of skills) {
      const row = el('div', 'learning-skill');
      row.append(el('strong', '', skill.label || skill.skillId || skill.id), el('span', 'learning-level', LEVELS[skill.difficulty || skill.level] || LEVELS[1]),
        el('p', '', skill.attempts ? `${skill.independentCorrect || 0} answers without help · ${skill.attempts} saved attempts` : 'Ready when you are'));
      if(skill.reason) row.append(el('small', '', skill.reason));
      if(skill.dueAt) row.append(el('small', '', `Review ${date(skill.dueAt)}`)); section.append(row);
    }
    content.append(section, el('p', 'learning-footnote', 'Your learning record stays on this device and is included in your backup. These are practice signals, not an official language-level assessment.'));
    shortcuts(content);
  }
  return {show, continueLearning, showAssignments, showProgress, showUnit, dispose, cancelPending:dispose};
}
