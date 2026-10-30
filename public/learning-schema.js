// Shared by the browser and protected lesson-generation route. These are display
// data, never model instructions or executable HTML.
export const LEARNING_SKILLS = Object.freeze([
  {id:'introductions',label:'Greetings and introductions',description:'First meetings, your name, and saying that you study Japanese.'},
  {id:'cafe-requests',label:'Polite requests',description:'Ordering drinks, asking for water, sizes, and paying politely.'},
  {id:'likes-dislikes',label:'Likes and preferences',description:'Likes, dislikes, joining nouns, and gentle negatives.'},
  {id:'daily-routine',label:'Daily routines',description:'Clock times, daily habits, and polite present verbs.'},
  {id:'directions-travel',label:'Directions and travel',description:'Asking where places are, destinations, and simple directions.'},
  {id:'past-weekend',label:'Talking about the past',description:'Yesterday, past actions, and a short past-tense account.'},
  {id:'numbers-shopping',label:'Shopping and numbers',description:'Prices, counting small quantities, and buying an item.'},
  {id:'future-plans',label:'Plans and invitations',description:'Tomorrow, simple plans, invitations, and accepting politely.'},
  {id:'describing-things',label:'Describing things',description:'Simple adjectives, linking descriptions, and comparisons of everyday things.'},
]);
const text = (maxLength,minLength=1) => ({type:'string',minLength,maxLength});
const shape = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const strings = (minItems,maxItems,maxLength) => ({type:'array',minItems,maxItems,items:text(maxLength)});
const example = shape({target:text(300),reading:text(450,0),meaning:text(500)});
const exercise = shape({id:text(70),type:{type:'string',enum:['write','choice']},prompt:text(700),options:strings(0,4,500),answers:strings(1,8,500),sample:text(650),explanation:text(1000)});
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
export function validateGeneratedLesson(value,{skillId,difficulty}={}) {
  const lesson=validate(value,LEARNING_LESSON_SCHEMA);
  if((skillId&&lesson.skillId!==skillId)||(difficulty!==undefined&&lesson.difficulty!==difficulty)) throw new TypeError('The lesson does not match the requested learning step.');
  const ids=new Set();
  for(const question of [...lesson.practice,...lesson.homework]) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,69}$/.test(question.id)||ids.has(question.id)) throw new TypeError('Lesson question identifiers must be unique.');
    ids.add(question.id);
    if(new Set(question.answers).size!==question.answers.length) throw new TypeError('The lesson repeats an accepted answer.');
    if(question.type==='write'&&question.options.length!==0) throw new TypeError('Written questions cannot contain choice options.');
    if(question.type==='choice'&&(question.options.length<2||new Set(question.options).size!==question.options.length||question.answers.some(answer=>!question.options.includes(answer)))) throw new TypeError('A choice answer must be one of its options.');
  }
  if(lesson.examples.some(item=>!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(item.target))) throw new TypeError('The examples must teach Japanese.');
  if(JSON.stringify(lesson).length>20000) throw new TypeError('The generated lesson is too large.');
  return lesson;
}
