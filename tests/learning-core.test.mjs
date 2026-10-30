import test from 'node:test';
import assert from 'node:assert/strict';
import {LESSONS,createTeacherState,recordLessonPractice,submitAssignment,gradeExercise} from '../public/teacher-core.js';
import {createLearningState,sanitizeLearningState,importCourseHistory,getLearningSummary,recommendLesson,buildPreparedLesson,startLearningUnit,getLearningUnit,saveLearningAnswer,useLearningHint,checkLearningAnswer,advanceLearningStep,LEARNING_SKILLS,validateGeneratedLesson} from '../public/learning-core.js';

const base='2026-10-30T00:00:00.000Z';
const time=minutes=>new Date(Date.parse(base)+minutes*60000).toISOString();
function complete(raw,{skillId='introductions',difficulty=1,wrong=[],hinted=false,minute=0,lesson}={}) {
  const content=lesson||buildPreparedLesson({skillId,difficulty},raw);
  let {state,unit}=startLearningUnit(raw,content,{nowISO:time(minute)}), clock=minute;
  for(const phase of ['lesson','assignment'])for(const question of content[phase==='lesson'?'practice':'homework']){
    if(wrong.includes(question.id))state=checkLearningAnswer(state,unit.id,phase,question.id,'not this answer',time(++clock)).state;
    if(hinted)state=useLearningHint(state,unit.id,phase,question.id);
    state=checkLearningAnswer(state,unit.id,phase,question.id,question.answers[0],time(++clock)).state;
    state=advanceLearningStep(state,unit.id,phase,time(++clock));
  }
  return {state,unit:getLearningUnit(state,unit.id),clock};
}
const summaryFor=(state,id='introductions',stamp=time(500))=>getLearningSummary(state,stamp).skills.find(skill=>skill.id===id);

test('all nine prepared topics have validated, answerable variations at three genuine support levels',()=>{
  assert.equal(LEARNING_SKILLS.length,9);
  for(const skill of LEARNING_SKILLS)for(const difficulty of [1,2,3]){
    const lesson=buildPreparedLesson({skillId:skill.id,difficulty});
    assert.deepEqual(validateGeneratedLesson(lesson,{skillId:skill.id,difficulty}),lesson);
    assert.ok(lesson.examples.length>=2);assert.ok(lesson.explanation[0].includes(lesson.examples[0].target));
    for(const question of [...lesson.practice,...lesson.homework])for(const answer of question.answers)assert.equal(gradeExercise(question,answer).correct,true,question.id);
    if(difficulty===1)assert.ok(lesson.practice.some(question=>question.type==='choice'));
    if(difficulty>=2)assert.ok(lesson.practice.every(question=>question.type==='write'));
    if(difficulty===3){
      const combined=lesson.homework.at(-1);assert.match(combined.prompt,/two sentences/);
      assert.equal(gradeExercise(combined,lesson.examples[0].target).correct,false);
    }
  }
});

test('checking and advancing are separate; drafts, hints, assignment dates and resume survive a backup',()=>{
  const lesson=buildPreparedLesson({skillId:'introductions',difficulty:1});
  const start=startLearningUnit(createLearningState(),lesson,{nowISO:base});let state=start.state;
  const id=start.unit.id, question=lesson.practice[0];
  state=saveLearningAnswer(state,id,'lesson',question.id,question.answers[0]);
  assert.equal(getLearningUnit(state,id).practice.attempts.length,0);
  assert.equal(getLearningUnit(advanceLearningStep(state,id,'lesson'),id).practiceIndex,0);
  const blank=checkLearningAnswer(state,id,'lesson',question.id,'',base);assert.equal(blank.report.correct,false);
  assert.equal(getLearningSummary(blank.state).skills[0].wrong,0,'empty checks are not learning evidence');
  state=useLearningHint(state,id,'lesson',question.id);
  const checked=checkLearningAnswer(state,id,'lesson',question.id,question.answers[0],time(1));state=checked.state;
  assert.equal(checked.report.independent,false);assert.equal(getLearningUnit(state,id).practiceIndex,0);
  state=advanceLearningStep(state,id,'lesson',time(2));
  for(const [index,next] of lesson.practice.entries())if(index>0){state=checkLearningAnswer(state,id,'lesson',next.id,next.answers[0],time(index+3)).state;state=advanceLearningStep(state,id,'lesson',time(index+4));}
  const restored=sanitizeLearningState(JSON.parse(JSON.stringify(state))), unit=getLearningUnit(restored,id);
  assert.equal(unit.phase,'assignment');assert.equal(unit.homeworkIndex,0);
  assert.equal(Date.parse(unit.homework.dueAt)-Date.parse(unit.homework.assignedAt),86400000);
  assert.equal(unit.practice.answers[question.id],question.answers[0]);assert.equal(unit.practice.hints[question.id],true);
  assert.deepEqual(startLearningUnit(restored,lesson,{nowISO:time(100)}).state,restored,'a repeated start resumes rather than duplicating or resetting due dates');
});

test('same-answer double checks and stale callbacks cannot inflate evidence or advance unchecked work',()=>{
  const lesson=buildPreparedLesson({skillId:'introductions',difficulty:1});let {state,unit}=startLearningUnit(createLearningState(),lesson,{nowISO:base});
  const question=lesson.practice[0];
  state=checkLearningAnswer(state,unit.id,'lesson',question.id,'wrong',time(1)).state;
  state=checkLearningAnswer(state,unit.id,'lesson',question.id,'wrong',time(2)).state;
  assert.equal(getLearningUnit(state,unit.id).practice.attempts.length,1);
  state=checkLearningAnswer(state,unit.id,'lesson',question.id,question.answers[0],time(3)).state;
  state=saveLearningAnswer(state,unit.id,'lesson',question.id,'an unchecked edit');
  assert.equal(getLearningUnit(advanceLearningStep(state,unit.id,'lesson',time(4)),unit.id).practiceIndex,0);
  state=checkLearningAnswer(state,unit.id,'lesson',question.id,question.answers[0],time(5)).state;
  state=advanceLearningStep(state,unit.id,'lesson',time(6));
  const stale=checkLearningAnswer(state,unit.id,'lesson',question.id,'old button',time(7));
  assert.equal(stale.report.stale,true);assert.deepEqual(stale.state,state);
});

test('independent homework success increases support level and opens a new topic; hints and retries do not fake mastery',()=>{
  let state=complete(createLearningState()).state;
  assert.equal(summaryFor(state).level,1);
  state=complete(state,{minute:60}).state;
  assert.equal(summaryFor(state).level,2);
  assert.equal(recommendLesson(state,time(100)).skillId,'cafe-requests');
  assert.equal(recommendLesson(state,time(100)).difficulty,1,'a new topic still begins gently');
  let helped=complete(createLearningState(),{hinted:true}).state;
  helped=complete(helped,{hinted:true,minute:60}).state;
  assert.equal(summaryFor(helped).level,1);assert.equal(summaryFor(helped).independentCorrect,0);
  let retried=complete(createLearningState(),{wrong:['homework-1','homework-2','homework-3','homework-4']}).state;
  retried=complete(retried,{wrong:['homework-1','homework-2','homework-3','homework-4'],minute:60}).state;
  assert.equal(summaryFor(retried).level,1);assert.ok(summaryFor(retried).wrong>=8);
});

test('recurring mistakes produce remembered remediation and a gentler next lesson',()=>{
  let state=complete(createLearningState()).state;state=complete(state,{minute:60}).state;
  assert.equal(summaryFor(state).level,2);
  state=complete(state,{difficulty:2,wrong:['practice-1','practice-2','homework-1','homework-2'],minute:120}).state;
  const summary=getLearningSummary(state,time(160)), skill=summary.skills[0];
  assert.equal(skill.level,1);assert.ok(skill.weaknesses.length>=2);
  assert.ok(skill.weaknesses.some(weakness=>weakness.answer==='not this answer'&&weakness.feedback&&weakness.expected));
  assert.equal(summary.next.skillId,'introductions');assert.equal(summary.next.difficulty,1);assert.match(summary.next.reason,/gentler review/);
  assert.deepEqual(getLearningSummary(sanitizeLearningState(JSON.parse(JSON.stringify(state))),time(160)),summary);
});

test('sustained independent homework clears active weakness across new AI wording while preserving mistake history',()=>{
  const initial=buildPreparedLesson({skillId:'introductions',difficulty:1});
  for(const question of [...initial.practice,...initial.homework])question.sample=`Original expected form: ${question.sample}`;
  let state=complete(createLearningState(),{lesson:initial,wrong:['homework-1'],minute:0}).state;
  assert.ok(summaryFor(state).weaknesses.length);
  const createVariation=(suffix)=>{const lesson=buildPreparedLesson({skillId:'introductions',difficulty:1},state);for(const question of [...lesson.practice,...lesson.homework])question.sample=`Fresh model wording ${suffix}: ${question.sample}`;return lesson;};
  state=complete(state,{lesson:createVariation('A'),minute:60}).state;
  assert.ok(summaryFor(state).weaknesses.length,'one later unit does not erase the old struggle');
  state=complete(state,{lesson:createVariation('B'),minute:120}).state;
  assert.equal(summaryFor(state).weaknesses.length,0);assert.equal(summaryFor(state).level,2);
  assert.ok(summaryFor(state).wrong>0,'past mistakes remain in the saved evidence');
  assert.ok(state.units.some(unit=>unit.homework.attempts.some(attempt=>!attempt.correct)));
});

test('spaced review becomes due without changing saved assignments or issuing a model call',()=>{
  let state=complete(createLearningState()).state;state=complete(state,{minute:60}).state;
  assert.equal(recommendLesson(state,time(100)).skillId,'cafe-requests');
  const due=getLearningSummary(state,time(60*24*3));
  assert.equal(due.next.skillId,'introductions');assert.match(due.next.reason,/spaced review/);
  assert.equal(due.activeUnit,null);assert.equal(due.pendingAssignments,0);
});

test('old coursework imports once, keeps failures after revisions, and never trusts stored grades',()=>{
  const lesson=LESSONS[0], correct=exercises=>Object.fromEntries(exercises.map(question=>[question.id,question.answers[0]]));
  let teacher=recordLessonPractice(createTeacherState(),lesson.id,{},base).state;
  teacher=recordLessonPractice(teacher,lesson.id,correct(lesson.practice),time(20)).state;
  teacher=submitAssignment(teacher,teacher.assignments[0].id,correct(lesson.homework),time(40)).state;
  const before=JSON.stringify(teacher), once=importCourseHistory(createLearningState(),teacher), twice=importCourseHistory(once,teacher);
  assert.deepEqual(twice,once);assert.equal(JSON.stringify(teacher),before);
  assert.ok(summaryFor(once).wrong>=3);assert.ok(once.importedKeys.length>=3);
  const forged=structuredClone(once);forged.evidence.find(event=>!event.correct).correct=true;
  assert.ok(getLearningSummary(sanitizeLearningState(forged)).skills[0].wrong>=3);
});

test('malformed generated lessons, duplicate question IDs and forged completion cannot become progress',()=>{
  const valid=buildPreparedLesson({skillId:'introductions',difficulty:1});
  for(const change of [lesson=>lesson.skillId='unknown',lesson=>lesson.practice[0].options=['unrelated','other'],lesson=>lesson.homework[0].id=lesson.practice[0].id,lesson=>lesson.examples[0].target='not Japanese',lesson=>lesson.extra='untrusted']){
    const lesson=structuredClone(valid);change(lesson);assert.throws(()=>validateGeneratedLesson(lesson));
  }
  assert.throws(()=>validateGeneratedLesson(valid,{skillId:'future-plans'}));
  assert.throws(()=>validateGeneratedLesson(valid,{difficulty:3}));
  const started=startLearningUnit(createLearningState(),valid,{nowISO:base});
  const forged=structuredClone(started.state);forged.units[0].phase='complete';forged.units[0].completedAt=base;forged.units[0].practiceIndex=99;
  const restored=sanitizeLearningState(forged);assert.equal(restored.units[0].phase,'lesson');assert.equal(restored.units[0].practiceIndex,0);assert.equal(getLearningSummary(restored).completedUnits,0);
  const duplicate=structuredClone(restored);duplicate.units.push(duplicate.units[0]);assert.equal(sanitizeLearningState(duplicate).units.length,1);
});

test('bounded long-term saves retain evidence for earlier skills when another topic is practised often',()=>{
  let state=createLearningState();for(let index=0;index<4;index++)state=complete(state,{minute:index*60}).state;
  const remembered=summaryFor(state).level;
  const cafe=complete(createLearningState(),{skillId:'cafe-requests',minute:300}).unit;
  for(let index=0;index<45;index++)state.units.push({...structuredClone(cafe),id:`retention-cafe-${index}`,createdAt:time(400+index),completedAt:time(450+index)});
  const restored=sanitizeLearningState(state);
  assert.ok(restored.units.length<=40);
  assert.equal(restored.units.filter(unit=>unit.lesson.skillId==='introductions').length,4);
  assert.equal(summaryFor(restored).level,remembered);
  assert.ok(getLearningSummary(restored).skills.find(skill=>skill.id==='cafe-requests').attempts>0);
});

test('long-term retention keeps every known skill and an unresolved mistake despite later hinted-only work',()=>{
  let state=createLearningState();let clock=0;
  for(const skill of LEARNING_SKILLS){
    const unit=complete(createLearningState(),{skillId:skill.id,minute:clock}).unit;
    for(let index=0;index<4;index++)state.units.push({...structuredClone(unit),id:`known-${skill.id}-${index}`,createdAt:time(clock+index),completedAt:time(clock+30+index)});
    clock+=60;
  }
  state=sanitizeLearningState(state);
  const before=getLearningSummary(state,time(clock+100)).skills.map(skill=>[skill.id,skill.level]);
  const cafe=complete(createLearningState(),{skillId:'cafe-requests',minute:clock+200}).unit;
  for(let index=0;index<45;index++)state=sanitizeLearningState({...state,units:[...state.units,{...structuredClone(cafe),id:`many-cafe-${index}`,createdAt:time(clock+300+index),completedAt:time(clock+340+index)}]});
  assert.ok(state.units.length<=40);
  for(const [id,level] of before){const skill=summaryFor(state,id);assert.ok(skill.attempts>0,id);assert.equal(skill.level,level,id);}
  let struggling=complete(createLearningState(),{wrong:['homework-1'],minute:0}).state;
  const originalWrong=struggling.units[0].id;
  const helped=complete(createLearningState(),{hinted:true,minute:60}).unit;
  for(let index=0;index<45;index++)struggling=sanitizeLearningState({...struggling,units:[...struggling.units,{...structuredClone(helped),id:`helped-${index}`,createdAt:time(200+index),completedAt:time(240+index)}]});
  assert.ok(struggling.units.some(unit=>unit.id===originalWrong),'the unresolved question keeps its evidence anchor');
  assert.ok(summaryFor(struggling).weaknesses.length>0);
  assert.ok(summaryFor(struggling).wrong>0);
  assert.equal(summaryFor(struggling).level,1);
});
