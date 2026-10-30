import {LESSONS,gradeExercise,sanitizeTeacherState} from './teacher-core.js';
import {LEARNING_SKILLS,validateGeneratedLesson,FOUNDATION_GROUPS,isFoundationSkill,getFoundationGroup,validateFoundationExercise} from './learning-schema.js';
import {buildPreparedLesson} from './learning-curriculum.js';
export {LEARNING_SKILLS,validateGeneratedLesson,FOUNDATION_GROUPS,FOUNDATION_SKILLS,isFoundationSkill,getFoundationGroup} from './learning-schema.js';
export {buildPreparedLesson};

// Evidence is checked again from saved answers. The model never assigns scores,
// levels, completion, or a proficiency certificate.
const MAX_UNITS=40, MAX_ATTEMPTS=24, MAX_LEGACY=360;
const trustedLessons=new WeakSet(),trustedProofs=new WeakMap();
function freezeData(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freezeData(child);Object.freeze(value);}return value;}
function checkedLesson(raw){if(raw&&trustedLessons.has(raw))return raw;const lesson=freezeData(validateGeneratedLesson(raw));trustedLessons.add(lesson);return lesson;}
const knownSkill=id=>LEARNING_SKILLS.find(skill=>skill.id===id);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(value);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&/^\d{4}-\d{2}-\d{2}T/.test(value)?new Date(value).toISOString():null;
const nowTime=value=>iso(value)||new Date().toISOString();
const answerText=value=>typeof value==='string'?(value.length<=1000?value:`${value.slice(0,940)} [answer exceeded 1000 characters]`):'';
const side=phase=>phase==='assignment'?'homework':'practice';
const indexKey=phase=>phase==='assignment'?'homeworkIndex':'practiceIndex';
const questions=(unit,phase)=>unit.lesson[side(phase)];
const latest=(unit,phase,id)=>unit[side(phase)].attempts.findLast(attempt=>attempt.exerciseId===id);
const checked=(unit,phase,question)=>{const attempt=latest(unit,phase,question.id);return Boolean(attempt?.correct&&attempt.answer===unit[side(phase)].answers[question.id]);};
const dateAfter=(stamp,days)=>new Date(Date.parse(stamp)+days*86400000).toISOString();
export function createLearningState(){return {version:1,units:[],evidence:[],importedKeys:[],foundations:{}};}

function cleanPhase(raw,exercises) {
  const answers=Object.fromEntries(exercises.map(question=>[question.id,answerText(raw?.answers?.[question.id])]));
  const hints=Object.fromEntries(exercises.filter(question=>raw?.hints?.[question.id]===true).map(question=>[question.id,true]));
  const attempts=[];
  // Preserve each question's first attempt as well as recent retries. Losing a
  // failed first answer must never turn a later copied answer into mastery.
  const source=Array.isArray(raw?.attempts)?raw.attempts:[];
  const first=[]; const seen=new Set();
  for(const attempt of source){if(record(attempt)&&!seen.has(attempt.exerciseId)){seen.add(attempt.exerciseId);first.push(attempt);}}
  const candidates=[...first,...source.slice(-MAX_ATTEMPTS)]; const used=new Set();
  for(const attempt of candidates){
    const question=exercises.find(item=>item.id===attempt?.exerciseId), at=iso(attempt?.at);
    if(!question||!at||typeof attempt.answer!=='string')continue;
    const answer=answerText(attempt.answer), key=JSON.stringify([question.id,at,answer,attempt.hinted===true]);
    if(used.has(key))continue;used.add(key);
    const attemptNumber=attempts.filter(item=>item.exerciseId===question.id).length+1;
    attempts.push({exerciseId:question.id,answer,at,hinted:attempt.hinted===true,attemptNumber,independent:attemptNumber===1&&attempt.hinted!==true,...gradeExercise(question,answer)});
  }
  return {answers,hints,attempts};
}
function cleanUnit(raw) {
  if(!record(raw)||!validId(raw.id)||!iso(raw.createdAt))return null;
  let lesson;try{lesson=checkedLesson(raw.lesson);}catch{return null;}
  const unit={id:raw.id,lesson,source:raw.source==='ai'?'ai':'authored',createdAt:iso(raw.createdAt),phase:'lesson',practiceIndex:0,homeworkIndex:0,practice:cleanPhase(raw.practice,lesson.practice),homework:cleanPhase(raw.homework,lesson.homework),completedAt:null};
  const firstMissing=lesson.practice.findIndex(question=>!checked(unit,'lesson',question));
  const maxPractice=firstMissing<0?lesson.practice.length-1:firstMissing;
  unit.practiceIndex=Math.min(Number.isInteger(raw.practiceIndex)?Math.max(0,raw.practiceIndex):0,maxPractice);
  const allPractice=firstMissing<0;
  unit.homework.assignedAt=allPractice?iso(raw.homework?.assignedAt):null;
  unit.homework.dueAt=unit.homework.assignedAt?dateAfter(unit.homework.assignedAt,1):null;
  if(allPractice&&unit.homework.assignedAt&&['assignment','complete'].includes(raw.phase))unit.phase='assignment';
  const firstHomeworkMissing=lesson.homework.findIndex(question=>!checked(unit,'assignment',question));
  const maxHomework=firstHomeworkMissing<0?lesson.homework.length-1:firstHomeworkMissing;
  unit.homeworkIndex=Math.min(Number.isInteger(raw.homeworkIndex)?Math.max(0,raw.homeworkIndex):0,maxHomework);
  if(unit.phase==='assignment'&&raw.phase==='complete'&&firstHomeworkMissing<0&&iso(raw.completedAt)){
    unit.phase='complete';unit.completedAt=iso(raw.completedAt);
  }
  return unit;
}
function cleanLegacy(raw) {
  if(!record(raw)||!validId(raw.key)||!validId(raw.unitId)||!knownSkill(raw.skillId)||!iso(raw.at)||!['lesson','assignment'].includes(raw.phase))return null;
  const lesson=LESSONS.find(item=>item.id===raw.skillId);
  const question=lesson?.[side(raw.phase)]?.find(item=>item.id===raw.exerciseId);
  if(!question||typeof raw.answer!=='string')return null;
  const answer=answerText(raw.answer);
  return {key:raw.key,unitId:raw.unitId,skillId:raw.skillId,difficulty:1,phase:raw.phase,exerciseId:question.id,answer,at:iso(raw.at),hinted:false,firstAttempt:raw.firstAttempt===true,completed:raw.completed===true,...gradeExercise(question,answer),prompt:question.prompt};
}
function cleanFoundationProof(raw,group) {
  if(raw&&trustedProofs.get(raw)===group.id)return raw;
  if(!record(raw)||!validId(raw.unitId)||!iso(raw.completedAt)||![1,2,3].includes(raw.difficulty))return null;
  const proof={unitId:raw.unitId,completedAt:iso(raw.completedAt),difficulty:raw.difficulty,practice:[],homework:[]}, ids=new Set();
  for(const phase of ['practice','homework']){
    const checks=raw[phase];if(!Array.isArray(checks)||checks.length<(phase==='practice'?2:3)||checks.length>(phase==='practice'?3:4))return null;
    for(const check of checks){
      let question;try{question=validateFoundationExercise(check?.question,group.id);}catch{return null;}
      if(ids.has(question.id)||typeof check.answer!=='string'||typeof check.firstAnswer!=='string'||typeof check.firstHinted!=='boolean'||typeof check.hinted!=='boolean'||!iso(check.at)||!iso(check.firstAt))return null;
      ids.add(question.id);
      const answer=answerText(check.answer),firstAnswer=answerText(check.firstAnswer);
      if(!gradeExercise(question,answer).correct)return null;
      proof[phase].push({question,answer,firstAnswer,firstHinted:check.firstHinted,hinted:check.hinted,firstAt:iso(check.firstAt),at:iso(check.at)});
    }
    if(group.characters.some(character=>!proof[phase].some(check=>check.question.answers.includes(character.reading))))return null;
  }
  freezeData(proof);trustedProofs.set(proof,group.id);return proof;
}
function proofForUnit(unit) {
  if(unit.phase!=='complete'||!isFoundationSkill(unit.lesson.skillId))return null;
  const proof={unitId:unit.id,completedAt:unit.completedAt,difficulty:unit.lesson.difficulty,practice:[],homework:[]};
  for(const phase of ['lesson','assignment'])for(const question of questions(unit,phase)){
    const attempts=unit[side(phase)].attempts.filter(attempt=>attempt.exerciseId===question.id),first=attempts[0],last=attempts.at(-1);
    if(!first||!last)return null;
    proof[side(phase)].push({question,answer:last.answer,firstAnswer:first.answer,firstHinted:first.hinted,hinted:last.hinted,firstAt:first.at,at:last.at});
  }
  return cleanFoundationProof(proof,getFoundationGroup(unit.lesson.skillId));
}
function independentlyRecalls(proof,character) {
  // Count only the first homework question for this character in a session.
  // A repeated review item later in the same assignment may follow shown help.
  const check=proof.homework.find(item=>item.question.prompt.includes(character.target));
  return Boolean(check&&!check.firstHinted&&!check.hinted&&gradeExercise(check.question,check.firstAnswer).correct);
}
function foundationReady(foundations,group) {
  const records=foundations?.[group.id]||[];
  return group.characters.every(character=>records.some(proof=>independentlyRecalls(proof,character)));
}
function foundationProofs(raw,units) {
  const foundations={};
  for(const group of FOUNDATION_GROUPS){
    const proofs=new Map();
    for(const item of (Array.isArray(raw?.[group.id])?raw[group.id]:[]).slice(-8)){const proof=cleanFoundationProof(item,group);if(proof)proofs.set(proof.unitId,proof);}
    for(const unit of units.filter(item=>item.lesson.skillId===group.id)){const proof=proofForUnit(unit);if(proof)proofs.set(proof.unitId,proof);}
    const records=[...proofs.values()].sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.unitId.localeCompare(b.unitId));
    if(records.length){
      const retained=new Map();
      for(const proof of [records[0],...records.slice(-2)])retained.set(proof.unitId,proof);
      // Preserve a checked independent proof for EACH sound, even if later
      // reviews need help. This is compact, durable prerequisite evidence.
      for(const character of group.characters){const proof=records.find(item=>independentlyRecalls(item,character));if(proof)retained.set(proof.unitId,proof);}
      foundations[group.id]=[...retained.values()].sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.unitId.localeCompare(b.unitId));
    }
  }
  return foundations;
}
function nextFoundation(raw) {
  const foundations=raw?.foundations||{};
  return FOUNDATION_GROUPS.find(group=>!foundationReady(foundations,group))||null;
}
export function getNextFoundation(raw){return nextFoundation(sanitizeLearningState(raw));}
function selectedActiveUnit(state) {
  const foundation=nextFoundation(state);
  return state.units.find(unit=>unit.phase!=='complete'&&(!foundation||unit.lesson.skillId===foundation.id))||null;
}
export function sanitizeLearningState(raw) {
  const state=createLearningState();if(!record(raw)||raw.version!==1)return state;
  const units=(Array.isArray(raw.units)?raw.units:[]).slice(-80).map(cleanUnit).filter(Boolean), used=new Set();
  state.foundations=foundationProofs(raw.foundations,units);
  const foundation=nextFoundation(state);
  const pending=units.filter(unit=>unit.phase!=='complete').sort((a,b)=>Number(b.lesson.skillId===foundation?.id)-Number(a.lesson.skillId===foundation?.id)).slice(0,4), done=units.filter(unit=>unit.phase==='complete');
  // Preserve recent evidence for EVERY skill, not only the last topic practised.
  // Four independent completed units can substantiate all three support levels.
  // This also prevents a long run of café lessons from erasing an earlier skill.
  const retained=new Map();
  const retentionEvents=learningEvents({units:done,evidence:[]});
  for(const skill of LEARNING_SKILLS.filter(item=>!isFoundationSkill(item.id))){
    const recent=done.filter(item=>item.lesson.skillId===skill.id).slice(-4);
    const weak=statsFor(skill,retentionEvents,{units:done},Date.now()).weaknesses;
    const anchorCounts=new Map();
    for(const weakness of weak){
      const event=retentionEvents.findLast(item=>item.skillId===skill.id&&!item.correct&&item.at===weakness.at&&item.exerciseId===weakness.exerciseId&&item.expected===weakness.expected);
      if(event)anchorCounts.set(event.unitId,(anchorCounts.get(event.unitId)||0)+1);
    }
    const anchorId=[...anchorCounts].sort((a,b)=>b[1]-a[1])[0]?.[0], anchor=done.find(item=>item.id===anchorId);
    const chosen=anchor&&!recent.some(unit=>unit.id===anchor.id)?[anchor,...recent.slice(-3)]:recent;
    for(const unit of chosen)retained.set(unit.id,unit);
  }
  for(const unit of [...done].reverse())if(retained.size<MAX_UNITS-pending.length)retained.set(unit.id,unit);
  for(const unit of [...retained.values(),...pending].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(!used.has(unit.id)){state.units.push(unit);used.add(unit.id);}}
  const evidenceUsed=new Set(), legacy=[];
  for(const item of (Array.isArray(raw.evidence)?raw.evidence:[]).slice(-1200)){
    const event=cleanLegacy(item);if(event&&!evidenceUsed.has(event.key)){evidenceUsed.add(event.key);legacy.push(event);}
  }
  // Keep the first submitted evidence and a recent mistake for each old course
  // question, then fill with recent work. A busy later topic must not crowd all
  // introduction evidence out of the migration ledger.
  for(const lesson of LESSONS){
    const entries=legacy.filter(event=>event.skillId===lesson.id).sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key)), retainedEvidence=new Map();
    for(const phase of ['lesson','assignment'])for(const question of lesson[side(phase)]){
      const first=entries.find(event=>event.phase===phase&&event.exerciseId===question.id&&event.firstAttempt);
      const wrong=entries.findLast(event=>event.phase===phase&&event.exerciseId===question.id&&!event.correct);
      for(const event of [first,wrong])if(event)retainedEvidence.set(event.key,event);
    }
    for(const event of [...entries].reverse())if(retainedEvidence.size<MAX_LEGACY/LESSONS.length)retainedEvidence.set(event.key,event);
    state.evidence.push(...[...retainedEvidence.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key)));
  }
  state.importedKeys=[...new Set((Array.isArray(raw.importedKeys)?raw.importedKeys:[]).filter(validId))].slice(-1200);
  return state;
}
export function importCourseHistory(raw,teacherState) {
  const state=sanitizeLearningState(raw), teacher=sanitizeTeacherState(teacherState), imported=new Set(state.importedKeys);
  const add=(lesson,phase,group,reports,firstEligible=true)=>{
    const unique=new Map();for(const report of reports.filter(Boolean))unique.set(report.submittedAt,report);
    const sorted=[...unique.values()].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));
    for(const [reportIndex,report] of sorted.entries()){
      const stamp=Date.parse(report.submittedAt).toString(36), key=`legacy-${phase}-${group}-${stamp}`;
      if(imported.has(key))continue;
      const unitId=`legacy-${phase}-${group}`;
      for(const result of report.results){
        const question=lesson[side(phase)].find(item=>item.id===result.exerciseId);if(!question)continue;
        const event=cleanLegacy({key:`${key}-${question.id}`,unitId,skillId:lesson.id,phase,exerciseId:question.id,answer:result.answer,at:report.submittedAt,firstAttempt:firstEligible&&reportIndex===0,completed:report.passed});
        if(event)state.evidence.push(event);
      }
      imported.add(key);
    }
  };
  for(const lesson of LESSONS){
    const practice=teacher.lessons[lesson.id];if(practice)add(lesson,'lesson',lesson.id,[practice.completionAttempt,...practice.attempts],practice.attempts.length<12);
    const homework=teacher.assignments.find(item=>item.lessonId===lesson.id);if(homework)add(lesson,'assignment',homework.id,[homework.firstAttempt,...homework.attempts]);
  }
  state.importedKeys=[...imported].slice(-1200);return sanitizeLearningState(state);
}
export function getLearningUnit(raw,id){return sanitizeLearningState(raw).units.find(unit=>unit.id===id)||null;}
export function startLearningUnit(raw,lesson,{source='authored',nowISO}={}) {
  const state=sanitizeLearningState(raw), active=selectedActiveUnit(state);
  if(active)return {state,unit:active};
  let clean=validateGeneratedLesson(lesson);const foundation=nextFoundation(state);
  if(foundation&&clean.skillId!==foundation.id){clean=buildPreparedLesson({skillId:foundation.id,difficulty:1},state);source='authored';}
  const stamp=nowTime(nowISO);
  const token=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  const unit={id:`learning-${token}`,lesson:clean,source:source==='ai'?'ai':'authored',createdAt:stamp,phase:'lesson',practiceIndex:0,homeworkIndex:0,practice:cleanPhase({},clean.practice),homework:{...cleanPhase({},clean.homework),assignedAt:null,dueAt:null},completedAt:null};
  state.units.push(unit);return {state:sanitizeLearningState(state),unit};
}
function currentUnit(state,id,phase,exerciseId) {
  const unit=state.units.find(item=>item.id===id);if(!unit||unit.phase!==phase)return null;
  const foundation=nextFoundation(state);if(foundation&&unit.lesson.skillId!==foundation.id)return null;
  const question=questions(unit,phase)[unit[indexKey(phase)]];
  return question&&(!exerciseId||question.id===exerciseId)?{unit,question,phaseData:unit[side(phase)]}:null;
}
export function saveLearningAnswer(raw,id,phase,exerciseId,answer) {
  const state=sanitizeLearningState(raw), current=currentUnit(state,id,phase,exerciseId);
  if(current)current.phaseData.answers[exerciseId]=answerText(answer);return state;
}
export function useLearningHint(raw,id,phase,exerciseId) {
  const state=sanitizeLearningState(raw), current=currentUnit(state,id,phase,exerciseId);
  if(current)current.phaseData.hints[exerciseId]=true;return state;
}
export function checkLearningAnswer(raw,id,phase,exerciseId,answer,nowISO) {
  const state=sanitizeLearningState(raw), current=currentUnit(state,id,phase,exerciseId);
  if(!current)return {state,report:{correct:false,feedback:'This question is no longer current. Reopen your lesson.',expected:'',attemptNumber:0,independent:false,stale:true}};
  const text=answerText(answer), {unit,question,phaseData}=current;
  phaseData.answers[exerciseId]=text;
  if(!text.trim())return {state,report:{exerciseId,answer:text,at:nowTime(nowISO),hinted:false,attemptNumber:0,independent:false,...gradeExercise(question,text)}};
  const prior=latest(unit,phase,exerciseId), hinted=phaseData.hints[exerciseId]===true;
  if(prior&&prior.answer===text&&prior.hinted===hinted)return {state,report:prior};
  const attemptNumber=phaseData.attempts.filter(item=>item.exerciseId===exerciseId).length+1;
  const report={exerciseId,answer:text,at:nowTime(nowISO),hinted,attemptNumber,independent:attemptNumber===1&&!hinted,...gradeExercise(question,text)};
  phaseData.attempts.push(report);return {state:sanitizeLearningState(state),report};
}
export function advanceLearningStep(raw,id,phase,nowISO) {
  const state=sanitizeLearningState(raw), current=currentUnit(state,id,phase);if(!current)return state;
  const {unit,question}=current;if(!checked(unit,phase,question))return state;
  if(unit[indexKey(phase)]<questions(unit,phase).length-1)unit[indexKey(phase)]++;
  else if(phase==='lesson'){
    unit.phase='assignment';unit.homework.assignedAt=nowTime(nowISO);unit.homework.dueAt=dateAfter(unit.homework.assignedAt,1);
  }else{unit.phase='complete';unit.completedAt=nowTime(nowISO);}
  return sanitizeLearningState(state);
}

function learningEvents(state) {
  const events=state.evidence.map(event=>({...event,independent:event.firstAttempt&&!event.hinted}));
  for(const unit of state.units)for(const phase of ['lesson','assignment']){
    const phaseData=unit[side(phase)], seen=new Set();
    for(const attempt of phaseData.attempts){
      const question=questions(unit,phase).find(item=>item.id===attempt.exerciseId);if(!question)continue;
      const firstAttempt=!seen.has(question.id);seen.add(question.id);
      events.push({...attempt,key:`${unit.id}:${phase}:${question.id}:${attempt.at}`,unitId:unit.id,skillId:unit.lesson.skillId,difficulty:unit.lesson.difficulty,phase,prompt:question.prompt,firstAttempt,independent:firstAttempt&&!attempt.hinted,completed:unit.phase==='complete'});
    }
  }
  const represented=new Set(state.units.map(unit=>unit.id));
  for(const group of FOUNDATION_GROUPS)for(const proof of state.foundations?.[group.id]||[]){
    if(represented.has(proof.unitId))continue;
    for(const phase of ['lesson','assignment'])for(const check of proof[side(phase)]){
      const common={unitId:proof.unitId,skillId:group.id,difficulty:proof.difficulty,phase,exerciseId:check.question.id,prompt:check.question.prompt,completed:true};
      events.push({...common,key:`${proof.unitId}:${phase}:${check.question.id}:first`,answer:check.firstAnswer,at:check.firstAt,hinted:check.firstHinted,firstAttempt:true,independent:!check.firstHinted,...gradeExercise(check.question,check.firstAnswer)});
      if(check.answer!==check.firstAnswer||check.at!==check.firstAt)events.push({...common,key:`${proof.unitId}:${phase}:${check.question.id}:last`,answer:check.answer,at:check.at,hinted:check.hinted,firstAttempt:false,independent:false,...gradeExercise(check.question,check.answer)});
    }
  }
  return events.sort((a,b)=>a.at.localeCompare(b.at));
}
function statsFor(skill,events,state,now) {
  const all=events.filter(event=>event.skillId===skill.id), first=all.filter(event=>event.firstAttempt);
  const groups=new Map();
  for(const event of all){const key=event.unitId;if(!groups.has(key))groups.set(key,{id:key,difficulty:event.difficulty,at:event.at,events:[],completed:false});const group=groups.get(key);group.events.push(event);group.completed ||= event.completed;group.at=event.at;}
  let level=1, streak=0;
  for(const group of [...groups.values()].sort((a,b)=>a.at.localeCompare(b.at))){
    if(!group.completed)continue;
    const answers=group.events.filter(event=>event.firstAttempt&&(event.phase==='assignment'||group.id.startsWith('legacy-lesson-')));
    const independent=answers.filter(event=>event.independent&&event.correct).length;
    const ratio=answers.length?independent/answers.length:0;
    if(ratio>=.8&&independent>=2&&group.difficulty>=level){streak++;if(streak>=2){level=Math.min(3,level+1);streak=0;}}
    else if(ratio<.5){level=Math.max(1,level-1);streak=0;}
  }
  const recent=first.slice(-4), recentWrong=recent.filter(event=>!event.correct).length;
  if(recentWrong>=2){level=Math.max(1,level-1);streak=0;}
  const unresolved=new Map();
  for(const event of all){
    const key=event.expected.normalize('NFKC').toLowerCase();
    if(!event.correct){const before=unresolved.get(key);unresolved.set(key,{exerciseId:event.exerciseId,prompt:event.prompt,answer:event.answer,expected:event.expected,feedback:event.feedback,at:event.at,misses:(before?.misses||0)+1,unitId:event.unitId,successfulUnits:new Set()});}
    else if(event.independent){
      unresolved.delete(key);
      // A generated lesson may phrase its sample differently. Two later,
      // completed homework sessions provide skill-level recovery evidence even
      // when no new question repeats the exact old expected-answer string.
      if(event.phase==='assignment'&&event.completed)for(const [oldKey,weakness] of unresolved){
        if(event.unitId!==weakness.unitId){weakness.successfulUnits.add(event.unitId);if(weakness.successfulUnits.size>=2)unresolved.delete(oldKey);}
      }
    }
  }
  const weaknesses=[...unresolved.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8).map(({unitId,successfulUnits,...weakness})=>weakness);
  const last=all.at(-1), lastPracticedAt=last?.at||null;
  const dueAt=lastPracticedAt?dateAfter(lastPracticedAt,weaknesses.length?10/1440:level===1?1:level===2?2:4):null;
  const independentCorrect=first.filter(event=>event.correct&&event.independent).length;
  return {id:skill.id,skillId:skill.id,label:skill.label,difficulty:level,level,attempts:all.length,correct:all.filter(event=>event.correct).length,independentCorrect,wrong:all.filter(event=>!event.correct).length,accuracy:first.length?first.filter(event=>event.correct).length/first.length:null,streak,dueAt,lastPracticedAt,weaknesses,reason:weaknesses.length?'Revisit a phrase that needed help.':first.length?'Build recall with another small step.':'Start with a simple example.'};
}
function chooseNext(state,skills,now) {
  const foundation=nextFoundation(state),active=selectedActiveUnit(state);
  if(active){const skill=skills.find(item=>item.id===active.lesson.skillId);return {skillId:skill.id,label:skill.label,difficulty:active.lesson.difficulty,reason:active.phase==='assignment'?'Continue your saved assignment.':'Continue your saved lesson.'};}
  if(foundation)return {skillId:foundation.id,label:foundation.label,difficulty:1,foundation:true,reason:state.foundations[foundation.id]?.length?'A short review will help these letter sounds stick. Try each sound without a hint before the next letters.':'Start with a few Japanese letters and their sounds before words or sentences.'};
  skills=skills.filter(skill=>!isFoundationSkill(skill.id));
  const weak=skills.filter(skill=>skill.weaknesses.length&&(skill.accuracy<.8||skill.weaknesses.some(item=>item.misses>=2))).sort((a,b)=>b.weaknesses.length-a.weaknesses.length||a.accuracy-b.accuracy)[0];
  if(weak)return {skillId:weak.id,label:weak.label,difficulty:weak.level,reason:'A recent answer showed that this needs a gentler review.'};
  const due=skills.filter(skill=>skill.dueAt&&Date.parse(skill.dueAt)<=now).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt))[0];
  if(due)return {skillId:due.id,label:due.label,difficulty:due.level,reason:'This is due for a spaced review to help it stick.'};
  const building=skills.find(skill=>skill.attempts>0&&skill.level===1);
  if(building)return {skillId:building.id,label:building.label,difficulty:1,reason:'Practise another small variation before increasing the challenge.'};
  const unseen=skills.find(skill=>skill.attempts===0);
  if(unseen)return {skillId:unseen.id,label:unseen.label,difficulty:1,reason:'You are ready to meet a new topic, one example at a time.'};
  const grow=[...skills].sort((a,b)=>a.level-b.level||(a.lastPracticedAt||'').localeCompare(b.lastPracticedAt||''))[0];
  return {skillId:grow.id,label:grow.label,difficulty:grow.level,reason:grow.level===3?'Use the familiar grammar in a fresh challenge.':'Build independent recall with a new variation.'};
}
export function getLearningSummary(raw,nowISO) {
  const state=sanitizeLearningState(raw), now=Date.parse(nowTime(nowISO)), events=learningEvents(state);
  const skills=LEARNING_SKILLS.map(skill=>statsFor(skill,events,state,now));
  const foundation=nextFoundation(state),pendingUnits=state.units.filter(unit=>unit.phase==='assignment'&&(!foundation||unit.lesson.skillId===foundation.id)), activeUnit=selectedActiveUnit(state);
  const completed=foundation?foundation.order:FOUNDATION_GROUPS.length;
  const next=chooseNext(state,skills,now);next.foundation=isFoundationSkill(next.skillId);
  return {skills,next,activeUnit,foundationNext:foundation,foundations:{completed,total:FOUNDATION_GROUPS.length,currentScript:foundation?.script||'words'},completedUnits:state.units.filter(unit=>unit.phase==='complete').length,pendingAssignments:pendingUnits.length,pendingUnits,
    weaknesses:skills.flatMap(skill=>skill.weaknesses.map(item=>({...item,skillId:skill.id,label:skill.label}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,12)};
}
export function recommendLesson(raw,nowISO){return getLearningSummary(raw,nowISO).next;}
