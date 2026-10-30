import {LESSONS} from './teacher-core.js';
import {validateGeneratedLesson,getFoundationGroup} from './learning-schema.js';

const extra = [
  {id:'numbers-shopping',title:'A little shopping',objective:'Ask a price and politely choose an item or quantity.',explanation:[
    'いくらですか (Ikura desu ka) asks “How much is it?” Point at an item and ask politely.',
    'これ (kore) means “this.” これをください (Kore o kudasai) means “This one, please.”',
    '二つ (futatsu) means two items. 三百円 (sanbyaku en) means 300 yen. The pronunciation of 三百 is sanbyaku.',
  ],examples:[
    {target:'いくらですか。',reading:'Ikura desu ka.',meaning:'How much is it?'},
    {target:'これをください。',reading:'Kore o kudasai.',meaning:'This one, please.'},
    {target:'二つください。',reading:'Futatsu kudasai.',meaning:'Two items, please.'},
    {target:'これは三百円です。',reading:'Kore wa sanbyaku en desu.',meaning:'This is 300 yen.'},
  ]},
  {id:'future-plans',title:'Plans for tomorrow',objective:'Describe a simple plan and invite someone to join you.',explanation:[
    '明日 (ashita) means tomorrow. 明日、図書館に行きます means “I will go to the library tomorrow.” The polite form 行きます can describe a future plan when the time is clear.',
    '一緒に (issho ni) means together. 一緒に行きませんか (Issho ni ikimasen ka) is an invitation: “Would you like to go together?”',
    'はい、行きましょう (Hai, ikimashō) means “Yes, let’s go.” 明日は休みです (Ashita wa yasumi desu) means “Tomorrow is a day off.”',
  ],examples:[
    {target:'明日、図書館に行きます。',reading:'Ashita, toshokan ni ikimasu.',meaning:'I will go to the library tomorrow.'},
    {target:'一緒に行きませんか。',reading:'Issho ni ikimasen ka.',meaning:'Would you like to go together?'},
    {target:'はい、行きましょう。',reading:'Hai, ikimashō.',meaning:'Yes, let’s go.'},
    {target:'明日は休みです。',reading:'Ashita wa yasumi desu.',meaning:'Tomorrow is a day off.'},
  ]},
  {id:'describing-things',title:'Describe something around you',objective:'Use simple adjectives to describe a book, a town, a room, or a bag.',explanation:[
    'この (kono) means “this” before a noun: この本 (kono hon) is “this book.” は marks the thing you are describing.',
    '面白い (omoshiroi) means interesting, 広い (hiroi) means spacious, and 大きい (ōkii) means big. Put the description before です.',
    '静か (shizuka) means quiet. この町は静かです (Kono machi wa shizuka desu) means “This town is quiet.”',
  ],examples:[
    {target:'この本は面白いです。',reading:'Kono hon wa omoshiroi desu.',meaning:'This book is interesting.'},
    {target:'この町は静かです。',reading:'Kono machi wa shizuka desu.',meaning:'This town is quiet.'},
    {target:'この部屋は広いです。',reading:'Kono heya wa hiroi desu.',meaning:'This room is spacious.'},
    {target:'このかばんは大きいです。',reading:'Kono kaban wa ōkii desu.',meaning:'This bag is big.'},
  ]},
];
const bank = [...LESSONS, ...extra];
const plain = text => text.replace(/[。.!！?？]$/u,'');
const normalized = value => plain(value).normalize('NFKC').replace(/[\s。、,.!?]/gu,'').toLowerCase();
const variants = example => {
  const taught = LESSONS.flatMap(lesson=>[...lesson.practice,...lesson.homework]).find(exercise=>exercise.answers.some(answer=>normalized(answer)===normalized(example.target)));
  return [...new Set([plain(example.target),plain(example.reading),...(taught?.answers||[])].filter(Boolean))].slice(0,8);
};
const write = (id,example,withSupport) => ({id,type:'write',prompt:`Write in Japanese: “${example.meaning}”${withSupport?' You can use the taught romanization.':''}`,options:[],answers:variants(example),sample:`${example.target} / ${example.reading}`,explanation:`${example.target} means “${example.meaning}”`});
const combine = (id,first,second) => ({id,type:'write',prompt:`Write two sentences in this order: “${first.meaning}” Then: “${second.meaning}”`,options:[],answers:[`${first.target}${second.target}`,`${first.reading} ${second.reading}`],sample:`${first.target}${second.target} / ${first.reading} ${second.reading}`,explanation:'Recall and combine the two complete sentences from this lesson. Keep their order and their original meanings.'});
function choice(id,example,examples) {
  const options = [example.meaning,...examples.filter(item=>item.meaning!==example.meaning).map(item=>item.meaning)].slice(0,3);
  // Deterministic rotation avoids making every correct option the first one.
  const shift = [...id+example.target].reduce((sum,character)=>sum+character.codePointAt(0),0) % options.length;
  return {id,type:'choice',prompt:`What does ${example.target} mean? (${example.reading})`,options:[...options.slice(shift),...options.slice(0,shift)],answers:[example.meaning],sample:example.meaning,explanation:`${example.target} means “${example.meaning}”`};
}
export function buildPreparedLesson(recommendation,state={units:[]},_profile={}) {
  const foundation=getFoundationGroup(recommendation?.skillId);
  if(foundation)return buildFoundationLesson(foundation,recommendation?.difficulty,state);
  const base = bank.find(lesson=>lesson.id===recommendation?.skillId) || bank[0];
  const difficulty = [1,2,3].includes(recommendation?.difficulty)?recommendation.difficulty:1;
  const cycle = (state.units||[]).filter(unit=>unit.lesson?.skillId===base.id).length;
  const examples = [...base.examples.slice(cycle % base.examples.length),...base.examples.slice(0,cycle % base.examples.length)].slice(0,4);
  const question = (example,index,phase) => (difficulty===1&&index%2===0)
    ? choice(`${phase}-${index+1}`,example,examples)
    : write(`${phase}-${index+1}`,example,difficulty<3);
  const lesson = {
    skillId:base.id,difficulty,title:`${base.title} · ${cycle===0?'First steps':`Practice ${cycle+1}`}`,
    objective:base.objective,
    explanation:examples.map(example=>{
      const mapping={introductions:[0,1,2,2],'cafe-requests':[0,1,0,2],'likes-dislikes':[0,0,1,2],'daily-routine':[0,1,2],'directions-travel':[0,1,2,3],'past-weekend':[1,2,2,1],'numbers-shopping':[0,1,2,2],'future-plans':[0,1,2,2],'describing-things':[0,2,1,1]};
      const index=base.examples.indexOf(example), note=base.explanation[(mapping[base.id]||[])[index]||0];
      return `${example.target} (${example.reading}) means “${example.meaning}” ${note}`;
    }),
    examples,
    practice:examples.slice(0,3).map((example,index)=>question(example,index,'practice')),
    homework:Array.from({length:4},(_,index)=>difficulty===3&&index>=2?combine(`homework-${index+1}`,examples[(index+1)%examples.length],examples[(index+2)%examples.length]):question(examples[(index+1)%examples.length],index,'homework')),
  };
  return validateGeneratedLesson(lesson,{skillId:base.id,difficulty});
}

function buildFoundationLesson(group,requestedDifficulty,state) {
  const difficulty=[1,2,3].includes(requestedDifficulty)?requestedDifficulty:1;
  const sounds=group.characters.map(character=>character.reading);
  const review=Math.max(state.foundations?.[group.id]?.length||0,(state.units||[]).filter(unit=>unit.lesson?.skillId===group.id).length);
  const makeQuestion=(character,index,phase)=>{
    const shift=(index*2+(phase==='homework'?1:0)+review)%sounds.length;
    const options=[...sounds.slice(shift),...sounds.slice(0,shift)];
    const type=difficulty===1?'choice':'write';
    return {id:`${group.id}-${phase}-${index+1}`,type,prompt:type==='choice'?`Which sound goes with ${character.target}? Choose its English letters.`:`What is the sound of ${character.target}? Type it with English letters.`,options:type==='choice'?options:[],answers:type==='choice'?[character.reading]:[character.reading,...character.aliases],sample:character.reading,explanation:`${character.target} is read ${character.reading}. ${character.meaning}`};
  };
  const lesson={skillId:group.id,difficulty,title:group.label,objective:`Recognize ${group.characters.map(character=>character.target).join(' · ')} and match each one to its sound. You can tap an answer or use English letters.`,
    explanation:group.characters.map(character=>`Look at ${character.target}. Its sound is ${character.reading}. ${character.meaning} These English sound hints are approximate; use Listen for a Japanese voice when available.`),
    examples:group.characters.map(({target,reading,meaning})=>({target,reading,meaning})),
    practice:group.characters.map((character,index)=>makeQuestion(character,index,'practice')),
    homework:Array.from({length:3},(_,index)=>makeQuestion(group.characters[index%group.characters.length],index,'homework')),
  };
  return validateGeneratedLesson(lesson,{skillId:group.id,difficulty});
}
