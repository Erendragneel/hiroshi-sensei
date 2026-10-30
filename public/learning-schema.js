// Shared by the browser and protected lesson-generation route. These are display
// data, never model instructions or executable HTML.
const PHRASE_SKILLS = [
  {id:'introductions',label:'Greetings and introductions',description:'First meetings, your name, and saying that you study Japanese.'},
  {id:'cafe-requests',label:'Polite requests',description:'Ordering drinks, asking for water, sizes, and paying politely.'},
  {id:'likes-dislikes',label:'Likes and preferences',description:'Likes, dislikes, joining nouns, and gentle negatives.'},
  {id:'daily-routine',label:'Daily routines',description:'Clock times, daily habits, and polite present verbs.'},
  {id:'directions-travel',label:'Directions and travel',description:'Asking where places are, destinations, and simple directions.'},
  {id:'past-weekend',label:'Talking about the past',description:'Yesterday, past actions, and a short past-tense account.'},
  {id:'numbers-shopping',label:'Shopping and numbers',description:'Prices, counting small quantities, and buying an item.'},
  {id:'future-plans',label:'Plans and invitations',description:'Tomorrow, simple plans, invitations, and accepting politely.'},
  {id:'describing-things',label:'Describing things',description:'Simple adjectives, linking descriptions, and comparisons of everyday things.'},
];

const vowelHints={a:'ah, as in father; keep it short',i:'ee, as in see; keep it short',u:'oo, as in food, with relaxed lips; keep it short',e:'eh, as in bed; keep it short',o:'oh, held steady without an extra w sound'};
const soundHints={
  shi:'shi: like shee, kept short',chi:'chi: like chee, kept short',tsu:'tsu: start with ts, as at the end of cats, then a short oo',
  fu:'fu: a soft breath between English f and h, followed by a short oo',n:'n: a short nasal sound; it changes a little before other sounds',
  ji:'ji: like jee, kept short',sha:'sha: sh plus a short ah, as one beat',shu:'shu: sh plus a short oo, as one beat',sho:'sho: sh plus a short oh, as one beat',
  cha:'cha: ch plus a short ah, as one beat',chu:'chu: ch plus a short oo, as one beat',cho:'cho: ch plus a short oh, as one beat',
  ja:'ja: j plus a short ah, as one beat',ju:'ju: j plus a short oo, as one beat',jo:'jo: j plus a short oh, as one beat',
};
const soundMeaning=reading=>soundHints[reading]||(reading.length===1?vowelHints[reading]:`${reading}: ${reading.slice(0,-1)} + ${vowelHints[reading.at(-1)]||reading.at(-1)}${reading.startsWith('r')?' (use a light tongue tap, between English r and l)':''}${reading.includes('y')?'; blend it into one short beat':''}`);
const row=(targets,readings,label)=>({targets:targets.split(' '),readings:readings.split(' '),label});
const kanaRows=[
  row('あ い う','a i u','First three vowel sounds'),row('え お','e o','Two more vowel sounds'),
  row('か き く','ka ki ku','The k sounds, part 1'),row('け こ','ke ko','The k sounds, part 2'),
  row('さ し す','sa shi su','The s sounds, part 1'),row('せ そ','se so','The s sounds, part 2'),
  row('た ち つ','ta chi tsu','The t sounds, part 1'),row('て と','te to','The t sounds, part 2'),
  row('な に ぬ','na ni nu','The n sounds, part 1'),row('ね の','ne no','The n sounds, part 2'),
  row('は ひ ふ','ha hi fu','The h sounds, part 1'),row('へ ほ','he ho','The h sounds, part 2'),
  row('ま み む','ma mi mu','The m sounds, part 1'),row('め も','me mo','The m sounds, part 2'),
  row('や ゆ よ','ya yu yo','The y sounds'),row('ら り る','ra ri ru','The r sounds, part 1'),row('れ ろ','re ro','The r sounds, part 2'),
  row('わ を ん','wa o n','The last basic letters'),
  row('が ぎ ぐ','ga gi gu','Two dots: the g sounds, part 1'),row('げ ご','ge go','Two dots: the g sounds, part 2'),
  row('ざ じ ず','za ji zu','Two dots: the z sounds, part 1'),row('ぜ ぞ','ze zo','Two dots: the z sounds, part 2'),
  row('だ ぢ づ','da ji zu','Two dots: the d row, part 1'),row('で ど','de do','Two dots: the d row, part 2'),
  row('ば び ぶ','ba bi bu','Two dots: the b sounds, part 1'),row('べ ぼ','be bo','Two dots: the b sounds, part 2'),
  row('ぱ ぴ ぷ','pa pi pu','Small circle: the p sounds, part 1'),row('ぺ ぽ','pe po','Small circle: the p sounds, part 2'),
  row('きゃ きゅ きょ','kya kyu kyo','Small y letters: kya, kyu, kyo'),row('しゃ しゅ しょ','sha shu sho','Small y letters: sha, shu, sho'),
  row('ちゃ ちゅ ちょ','cha chu cho','Small y letters: cha, chu, cho'),row('にゃ にゅ にょ','nya nyu nyo','Small y letters: nya, nyu, nyo'),
  row('ひゃ ひゅ ひょ','hya hyu hyo','Small y letters: hya, hyu, hyo'),row('みゃ みゅ みょ','mya myu myo','Small y letters: mya, myu, myo'),
  row('りゃ りゅ りょ','rya ryu ryo','Small y letters: rya, ryu, ryo'),row('ぎゃ ぎゅ ぎょ','gya gyu gyo','Small y letters: gya, gyu, gyo'),
  row('じゃ じゅ じょ','ja ju jo','Small y letters: ja, ju, jo'),row('びゃ びゅ びょ','bya byu byo','Small y letters: bya, byu, byo'),
  row('ぴゃ ぴゅ ぴょ','pya pyu pyo','Small y letters: pya, pyu, pyo'),
];
const katakana=value=>[...value].map(character=>{const code=character.codePointAt(0);return code>=0x3041&&code<=0x3096?String.fromCodePoint(code+0x60):character;}).join('');
const entry=(target,reading,meaning,aliases=[])=>({target,reading,meaning,aliases});
const basicGroups=script=>kanaRows.map(spec=>({label:spec.label,characters:spec.targets.map((target,index)=>{
  const output=script==='katakana'?katakana(target):target,reading=spec.readings[index];
  const note=(target==='を'?'o: the oh sound; this spelling is often typed wo.':target==='ぢ'?'ji: the same common sound as ji in the z row; the spelling differs.':target==='づ'?'zu: the same common sound as zu in the z row; the spelling differs.':soundMeaning(reading));
  return entry(output,reading,note,target==='を'?['wo']:[]);
})}));
const hiraExtras=[
  {label:'Small tsu: a short pause',characters:[entry('っ','pause','A small tsu has no vowel sound of its own. It briefly holds or doubles the next consonant.'),entry('きって','kitte','Say kit-te, holding the t briefly. This word means stamp.')]},
  {label:'Hold a vowel for another beat',characters:[entry('ああ','aa','Two a letters: hold ah for two beats.'),entry('いい','ii','Two i letters: hold ee for two beats.'),entry('うう','uu','Two u letters: hold oo for two beats, with relaxed lips.')]},
  {label:'Long e and o spellings',characters:[entry('えい','ei','Written ei; in many words this is a held e sound.'),entry('おう','ou','Written ou; in many words this is a held o sound.'),entry('おお','oo','Written oo: hold the o sound for two beats.')]},
];
const kataExtras=[
  {label:'Small tsu in katakana',characters:[entry('ッ','pause','A small tsu briefly holds or doubles the next consonant. It has no vowel sound of its own.'),entry('キット','kitto','Say kit-to, holding the t briefly. This loanword means kit.')]},
  {label:'The long-vowel mark',characters:[entry('ー','long vowel','Stretch the vowel before this mark for another beat.'),entry('コーヒー','koohii','Say koh-hee, holding both vowel sounds for two beats. This word means coffee.')]},
  {label:'Small vowel letters, part 1',characters:[entry('ァ','a','A small a letter; it joins another letter to spell a combined sound.'),entry('ィ','i','A small i letter; it joins another letter to spell a combined sound.'),entry('ゥ','u','A small u letter; it joins another letter to spell a combined sound.')]},
  {label:'Small vowel letters, part 2',characters:[entry('ェ','e','A small e letter, used in combined sounds.'),entry('ォ','o','A small o letter, used in combined sounds.')]},
  {label:'Loanword sounds: fa, fi, fe',characters:[entry('ファ','fa','f plus a short ah, blended into one beat.'),entry('フィ','fi','f plus a short ee, blended into one beat.'),entry('フェ','fe','f plus a short eh, blended into one beat.')]},
  {label:'Loanword sounds: fo, ti, di',characters:[entry('フォ','fo','f plus a short oh, blended into one beat.'),entry('ティ','ti','t plus a short ee, blended into one beat.'),entry('ディ','di','d plus a short ee, blended into one beat.')]},
  {label:'Loanword sounds: wi, we, wo',characters:[entry('ウィ','wi','w plus a short ee, blended into one beat.'),entry('ウェ','we','w plus a short eh, blended into one beat.'),entry('ウォ','wo','w plus a short oh, blended into one beat.')]},
  {label:'Loanword v sounds, part 1',characters:[entry('ヴァ','va','v plus a short ah; some speakers use a b-like sound.'),entry('ヴィ','vi','v plus a short ee; some speakers use a b-like sound.'),entry('ヴ','vu','v plus a short oo; some speakers use a b-like sound.')]},
  {label:'Loanword v sounds, part 2',characters:[entry('ヴェ','ve','v plus a short eh; some speakers use a b-like sound.'),entry('ヴォ','vo','v plus a short oh; some speakers use a b-like sound.')]},
  {label:'Loanword sounds: she, je, che',characters:[entry('シェ','she','sh plus a short eh, blended into one beat.'),entry('ジェ','je','j plus a short eh, blended into one beat.'),entry('チェ','che','ch plus a short eh, blended into one beat.')]},
  {label:'Loanword sounds: tu and du',characters:[entry('トゥ','tu','t plus a short oo, blended into one beat.'),entry('ドゥ','du','d plus a short oo, blended into one beat.')]},
];
// The beginner gate is the 46 basic characters in each script. Voicing marks,
// small-letter combinations, and loanword spellings belong to later study;
// they must not keep a new learner away from their first useful words.
const groupSpecs=[...basicGroups('hiragana').slice(0,18).map(group=>({...group,script:'hiragana'})),...basicGroups('katakana').slice(0,18).map(group=>({...group,script:'katakana'}))];
const scriptCounts={hiragana:0,katakana:0};
export const FOUNDATION_GROUPS=Object.freeze(groupSpecs.map((group,index)=>{
  const number=++scriptCounts[group.script],id=`kana-${group.script}-${String(number).padStart(2,'0')}`;
  const label=`${group.script==='hiragana'?'Hiragana':'Katakana'} ${number}: ${group.characters.map(character=>character.target).join(' · ')}`;
  return Object.freeze({...group,id,label,description:`${group.label}. Learn ${group.characters.length} symbols or sound patterns, one at a time.`,prerequisiteId:index?`kana-${groupSpecs[index-1].script}-${String(groupSpecs.slice(0,index).filter(previous=>previous.script===groupSpecs[index-1].script).length).padStart(2,'0')}`:null,order:index});
}));
const foundationById=new Map(FOUNDATION_GROUPS.map(group=>[group.id,group]));
export const isFoundationSkill=id=>foundationById.has(id);
export const getFoundationGroup=id=>foundationById.get(id)||null;
export const FOUNDATION_SKILLS=FOUNDATION_GROUPS;
export const LEARNING_SKILLS=Object.freeze([...FOUNDATION_GROUPS.map(group=>({id:group.id,label:group.label,description:group.description,stage:group.script,foundation:true})),...PHRASE_SKILLS.map(skill=>({...skill,stage:'words',foundation:false}))]);
const text = (maxLength,minLength=1) => ({type:'string',minLength,maxLength});
const shape = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const strings = (minItems,maxItems,maxLength) => ({type:'array',minItems,maxItems,items:text(maxLength)});
const example = shape({target:text(300),reading:text(450,0),meaning:text(500)});
const exercise = shape({id:text(70),type:{type:'string',enum:['write','choice']},prompt:text(700),options:strings(0,4,500),answers:strings(1,8,500),sample:text(650),explanation:text(1000)});
export const LEARNING_EXERCISE_SCHEMA=exercise;
export const LEARNING_LESSON_SCHEMA = Object.freeze(shape({
  skillId:{type:'string',enum:LEARNING_SKILLS.map(skill=>skill.id)},
  difficulty:{type:'integer',minimum:1,maximum:3},
  title:text(140),objective:text(650),explanation:strings(1,4,1400),
  examples:{type:'array',minItems:2,maxItems:4,items:example},
  practice:{type:'array',minItems:2,maxItems:3,items:exercise},
  homework:{type:'array',minItems:3,maxItems:4,items:exercise},
}));
const record = value => value !== null && typeof value==='object' && !Array.isArray(value);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
function validate(value,schema) {
  if(schema.type==='string') {
    if(typeof value!=='string'||value.length<schema.minLength||value.length>schema.maxLength||(schema.minLength>0&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)||(schema.enum&&!schema.enum.includes(value))) throw new TypeError('The lesson contains an invalid text field.');
    return value.trim();
  }
  if(schema.type==='integer') {
    if(!Number.isInteger(value)||value<schema.minimum||value>schema.maximum) throw new TypeError('The lesson difficulty is invalid.');
    return value;
  }
  if(schema.type==='array') {
    if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems) throw new TypeError('The lesson has an invalid number of items.');
    return value.map(item=>validate(item,schema.items));
  }
  if(!record(value)||Object.keys(value).some(key=>!own(schema.properties,key))||schema.required.some(key=>!own(value,key))) throw new TypeError('The lesson does not match the supported format.');
  return Object.fromEntries(Object.entries(schema.properties).map(([key,property])=>[key,validate(value[key],property)]));
}
export function validateLearningExercise(value) {
    const question=validate(value,exercise);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,69}$/.test(question.id)) throw new TypeError('A lesson question identifier is invalid.');
    if(new Set(question.answers).size!==question.answers.length) throw new TypeError('The lesson repeats an accepted answer.');
    if(question.type==='write'&&question.options.length!==0) throw new TypeError('Written questions cannot contain choice options.');
    if(question.type==='choice'&&(question.options.length<2||new Set(question.options).size!==question.options.length||question.answers.some(answer=>!question.options.includes(answer)))) throw new TypeError('A choice answer must be one of its options.');
    return question;
}
export function validateFoundationExercise(value,skillId) {
  const question=validateLearningExercise(value),group=getFoundationGroup(skillId);
  if(!group)throw new TypeError('Unknown kana group.');
  const sounds=new Set(group.characters.flatMap(character=>[character.reading,...character.aliases]));
  if(question.answers.some(answer=>!sounds.has(answer.toLowerCase()))||!sounds.has(question.sample.toLowerCase()))throw new TypeError('Kana questions must accept the group’s sounds in English letters.');
  if(question.options.some(option=>!sounds.has(option.toLowerCase())))throw new TypeError('A beginning kana choice must use sounds already in this group.');
  const shown=group.characters.filter(character=>question.prompt.includes(character.target));
  if(shown.length!==1||question.answers.some(answer=>![shown[0].reading,...shown[0].aliases].includes(answer.toLowerCase()))||![shown[0].reading,...shown[0].aliases].includes(question.sample.toLowerCase()))throw new TypeError('A kana question must check the correct sound of one displayed symbol.');
  const allowed=new Set(group.characters.flatMap(character=>[...character.target]));
  const all=[question.prompt,question.sample,question.explanation,...question.options,...question.answers].join(' ');
  if(/[\p{Script=Han}]/u.test(all)||[...all].some(character=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)&&!allowed.has(character)))throw new TypeError('The kana question includes material outside this small group.');
  return question;
}
export function validateGeneratedLesson(value,{skillId,difficulty}={}) {
  const lesson=validate(value,LEARNING_LESSON_SCHEMA);
  if((skillId&&lesson.skillId!==skillId)||(difficulty!==undefined&&lesson.difficulty!==difficulty)) throw new TypeError('The lesson does not match the requested learning step.');
  const ids=new Set();
  for(const question of [...lesson.practice,...lesson.homework]) {
    validateLearningExercise(question);
    if(ids.has(question.id)) throw new TypeError('Lesson question identifiers must be unique.');
    ids.add(question.id);
  }
  if(lesson.examples.some(item=>!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(item.target))) throw new TypeError('The examples must teach Japanese.');
  const foundation=getFoundationGroup(lesson.skillId);
  if(foundation){
    const allowedTargets=new Set(foundation.characters.map(character=>character.target)),allowedSymbols=new Set(foundation.characters.flatMap(character=>[...character.target]));
    if(lesson.examples.length!==allowedTargets.size||new Set(lesson.examples.map(example=>example.target)).size!==allowedTargets.size||lesson.examples.some(example=>!allowedTargets.has(example.target)||example.reading!==foundation.characters.find(character=>character.target===example.target).reading))throw new TypeError('A kana lesson must show only the characters and readings in its small group.');
    const all=[lesson.title,lesson.objective,...lesson.explanation,...lesson.examples.flatMap(example=>[example.meaning,example.reading])].join(' ');
    if(/[\p{Script=Han}]/u.test(all)||[...all].some(character=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)&&!allowedSymbols.has(character)))throw new TypeError('A beginning kana lesson cannot introduce outside letters or sentences.');
    for(const phase of ['practice','homework']){
      lesson[phase].forEach(question=>validateFoundationExercise(question,foundation.id));
      if(foundation.characters.some(character=>!lesson[phase].some(question=>question.answers.includes(character.reading))))throw new TypeError('Each kana sound must be checked before moving on.');
    }
  }
  if(JSON.stringify(lesson).length>20000) throw new TypeError('The generated lesson is too large.');
  return lesson;
}
