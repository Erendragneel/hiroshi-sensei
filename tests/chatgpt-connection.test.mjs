import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createChatGPTConnection, createChatGPTConnectionView, mountChatGPTConnection} from '../public/chatgpt-connection.js';

const BACKEND='https://koa-personal-companion.elijio-villa.chatgpt.site';
const PHONE='https://erendragneel.github.io/hiroshi-sensei/';
const SESSION='hiroshi.chatgpt.connection.v1',PENDING='hiroshi.chatgpt.pending.v1';
const NOW=Date.now(),TOKEN='device-session-'+ 'a'.repeat(40),EXPIRY=NOW+86400000;
function memoryStorage(initial={}) {
  const values=new Map(Object.entries(initial)),writes=[];
  return {values,writes,getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(['set',key]);},removeItem(key){values.delete(key);writes.push(['remove',key]);}};
}
function fixture({saved=true,hash='',native=false,backend=BACKEND,local=false,fetcher,persistentStorage}={}) {
  let url=new URL(local?'http://127.0.0.1:4322/':PHONE);url.hash=hash;
  const navigations=[],requests=[],changes=[];
  const localStorage=persistentStorage||memoryStorage({'koa.personal.v1':'keep-game-progress',...(saved?{[SESSION]:JSON.stringify({sessionToken:TOKEN,expiresAt:EXPIRY})}:{})});
  const sessionStorage=memoryStorage();
  const location={get href(){return url.href;},get pathname(){return url.pathname;},get search(){return url.search;},get hash(){return url.hash;},assign:target=>navigations.push(target)};
  const history={state:null,replaceState(_state,_title,target){url=new URL(target,url);}};
  const environment={location,history,localStorage,sessionStorage,crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),Date:{now:()=>NOW},
    async fetch(input,options={}) {const requested=String(input);requests.push({url:requested,options});return fetcher?fetcher(requested,options):Response.json({configured:true,provider:'chatgpt',model:'offered-model'});}};
  const client=createChatGPTConnection({backend,phoneURL:PHONE,native,onChange:value=>changes.push(value)},environment);
  return {client,environment,localStorage,sessionStorage,navigations,requests,changes,get url(){return url;}};
}

test('an approved device reconnects automatically on launch without a browser redirect',async()=>{
  const f=fixture();await f.client.ready;
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,`${BACKEND}/api/hiroshi/status`);
  assert.equal(f.requests[0].options.headers.get('Authorization'),`Bearer ${TOKEN}`);
  assert.equal(f.requests[0].options.credentials,'omit');
  assert.equal(f.client.snapshot().configured,true);assert.equal(f.client.snapshot().provider,'chatgpt');
  assert.equal(f.client.snapshot().model,'offered-model');assert.deepEqual(f.navigations,[]);
  assert.equal(f.client.consumeNewApproval(),false);
  assert.equal(f.localStorage.getItem('koa.personal.v1'),'keep-game-progress');
});

test('first approval only begins on an explicit click and sends PKCE challenge, never verifier or session token',async()=>{
  const f=fixture({saved:false});await f.client.ready;
  assert.equal(f.requests.length,0);assert.equal(f.navigations.length,0);
  await f.client.connect();
  const target=new URL(f.navigations[0]),pending=JSON.parse(f.localStorage.getItem(PENDING));
  assert.equal(target.origin,BACKEND);assert.equal(target.pathname,'/api/hiroshi/connect');
  assert.equal(target.searchParams.get('return_to'),PHONE);
  assert.equal(target.searchParams.get('state'),pending.state);
  assert.equal(target.searchParams.get('challenge'),createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(target.searchParams.has('verifier'),false);assert.equal(target.href.includes(TOKEN),false);
  assert.equal(pending.verifier.length,43);assert.equal(pending.state.length,43);
});

test('a bound callback is consumed once, preserves other fragment fields and stores only the app session',async()=>{
  const verifier='v'.repeat(43),state='s'.repeat(43),code='c'.repeat(43);
  const f=fixture({saved:false,hash:`scene=home&hiroshi_code=${code}&state=${state}`,fetcher:async(url,options)=>{
    if(url.endsWith('/exchange')) {
      assert.deepEqual(JSON.parse(options.body),{code,verifier});
      assert.equal(new Headers(options.headers).has('Authorization'),false);
      return Response.json({sessionToken:TOKEN,expiresAt:EXPIRY,access_token:'must-not-be-saved',refresh_token:'must-not-be-saved-either'});
    }
    return Response.json({configured:true,provider:'chatgpt',model:'offered-model'});
  }});
  f.localStorage.setItem(PENDING,JSON.stringify({verifier,state,createdAt:NOW-1000}));
  await f.client.ready;
  assert.equal(f.client.snapshot().configured,true);assert.equal(f.url.hash,'#scene=home');
  assert.equal(f.localStorage.getItem(PENDING),null);
  assert.deepEqual(JSON.parse(f.localStorage.getItem(SESSION)),{sessionToken:TOKEN,expiresAt:EXPIRY});
  assert.equal(f.localStorage.getItem(SESSION).includes('must-not-be-saved'),false);
  assert.equal(f.client.consumeNewApproval(),true);assert.equal(f.client.consumeNewApproval(),false);
  await f.client.refresh();assert.equal(f.requests.filter(r=>r.url.endsWith('/exchange')).length,1);
  assert.equal(f.client.consumeNewApproval(),false);
});

test('wrong, expired, duplicated or foreign-origin callbacks cannot exchange or replace a saved connection',async()=>{
  for(const variation of ['wrong','expired','duplicate','foreign']) {
    const state='s'.repeat(43),verifier='v'.repeat(43);
    const f=fixture({saved:true,local:variation==='foreign',hash:`hiroshi_code=${'c'.repeat(43)}&state=${variation==='wrong'?'bad':state}${variation==='duplicate'?'&state=second':''}`});
    f.localStorage.setItem(PENDING,JSON.stringify({state,verifier,createdAt:NOW-(variation==='expired'?600001:100)}));
    await f.client.ready;
    assert.equal(f.client.snapshot().stage,'attention',variation);
    assert.equal(f.requests.length,0,variation);assert.equal(f.client.snapshot().configured,false);
    assert.equal(JSON.parse(f.localStorage.getItem(SESSION)).sessionToken,TOKEN);
    assert.equal(f.localStorage.getItem(PENDING),null);assert.equal(f.url.hash,'');
  }
});

test('device authorization is attached only to the exact configured backend API path',async()=>{
  const f=fixture();await f.client.ready;
  for(const url of ['https://example.com/api/hiroshi/chat',`${BACKEND}/assets/icon.png`,`${BACKEND}/api/hiroshi-other/chat`,`${BACKEND.replace('https:','http:')}/api/hiroshi/chat`,`https://user:password@${new URL(BACKEND).host}/api/hiroshi/chat`]) await f.client.fetch(url);
  for(const request of f.requests.slice(1)) assert.equal(new Headers(request.options.headers).has('Authorization'),false,request.url);
  await f.client.fetch(`${BACKEND}/api/hiroshi/chat`,{method:'POST',headers:{Authorization:'Bearer untrusted', 'Content-Type':'application/json'},body:'{}'});
  const scoped=f.requests.at(-1);
  assert.equal(scoped.options.headers.get('Authorization'),`Bearer ${TOKEN}`);
  assert.equal(scoped.options.headers.get('Content-Type'),'application/json');
  assert.equal(scoped.options.redirect,'error');
});

test('offline checks retain the approved device session and a later retry reconnects',async()=>{
  let offline=true;
  const f=fixture({fetcher:async()=>{if(offline)throw new Error('private-network-diagnostic');return Response.json({configured:true,provider:'chatgpt',model:'offered-model'});}});
  await f.client.ready;assert.equal(f.client.snapshot().stage,'offline');
  assert.equal(JSON.parse(f.localStorage.getItem(SESSION)).sessionToken,TOKEN);
  assert.equal(f.client.snapshot().message.includes('private-network-diagnostic'),false);
  offline=false;await f.client.refresh();assert.equal(f.client.snapshot().configured,true);
  assert.deepEqual(f.navigations,[]);
});

test('a revoked device session clears only connection storage and does not start OAuth automatically',async()=>{
  const f=fixture({fetcher:async()=>Response.json({error:{message:'Connection expired'}},{status:401})});
  await f.client.ready;
  assert.equal(f.client.snapshot().configured,false);assert.equal(f.localStorage.getItem(SESSION),null);
  assert.equal(f.localStorage.getItem('koa.personal.v1'),'keep-game-progress');assert.equal(f.navigations.length,0);
  assert.ok(f.localStorage.writes.every(([,key])=>key===SESSION));
});

test('disconnect revokes this device and never resets game progress, including when offline',async()=>{
  let failDisconnect=false;
  const f=fixture({fetcher:async(url)=>{if(url.endsWith('/disconnect')&&failDisconnect)throw new Error('offline');return Response.json(url.endsWith('/status')?{configured:true,provider:'chatgpt'}:{disconnected:true});}});
  await f.client.ready;failDisconnect=true;await f.client.disconnect();
  assert.equal(f.client.snapshot().configured,false);assert.equal(f.localStorage.getItem(SESSION),null);
  assert.equal(f.localStorage.getItem('koa.personal.v1'),'keep-game-progress');
  assert.match(f.client.snapshot().message,/Remote sign-out could not be confirmed/);
});

test('native/local editions and unrecognized backend configurations never mount or inspect a device connection',async()=>{
  for(const options of [{native:true},{backend:null},{backend:'https://example.com'},{backend:`${BACKEND}/not-the-root`},{backend:`https://user:secret@${new URL(BACKEND).host}`}]){
    const f=fixture(options);await f.client.ready;
    assert.equal(f.client.enabled,false);assert.equal(f.requests.length,0);
    assert.equal(mountChatGPTConnection(f.client,{querySelector(){throw new Error('DOM must not be inspected');}}),null);
  }
});

test('connection actions are disabled during a game reply and never navigate from a local preview',async()=>{
  const f=fixture({saved:false});await f.client.ready;
  f.client.setBusy(true);await f.client.connect();assert.equal(f.navigations.length,0);
  f.client.setBusy(false);await f.client.connect();assert.equal(f.navigations.length,1);
  const local=fixture({saved:false,local:true});await local.client.connect();
  assert.equal(local.navigations.length,0);assert.match(local.client.snapshot().message,/Open the GitHub game/);
});

test('the connection card reflects real connection state and disables every action during a reply',async()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.events={};this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,callback){this.events[name]=callback;}
  }
  const inserted=[],anchor={parentNode:{insertBefore:element=>inserted.push(element)}};
  const document={querySelector:selector=>selector==='.game-layout'?anchor:null,createElement:tag=>new Element(tag)};
  const f=fixture();const card=mountChatGPTConnection(f.client,document);await f.client.ready;
  assert.equal(inserted[0],card);assert.equal(card['aria-label'],'ChatGPT connection');
  const [copy,actions]=card.children,[title,detail]=copy.children,[connect,retry,disconnect]=actions.children;
  assert.equal(title.textContent,'ChatGPT connected');assert.match(detail.textContent,/offered-model/);
  assert.equal(card.hidden,true);
  assert.equal(connect.hidden,true);assert.equal(disconnect.hidden,false);
  f.client.setBusy(true);assert.ok(actions.children.every(button=>button.disabled));
  f.client.setBusy(false);assert.ok(actions.children.every(button=>!button.disabled));
  await f.client.disconnect();assert.equal(title.textContent,'Connect your ChatGPT plan');
  assert.equal(card.hidden,false);
  assert.equal(connect.hidden,false);assert.equal(disconnect.hidden,true);assert.equal(retry.hidden,true);
});

test('main connection card disappears only after success and reappears for checking and recovery',()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.events={};this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,callback){this.events[name]=callback;}
  }
  const listeners=new Set();let current={configured:false,stage:'disconnected',message:'Ready',model:'',busy:false};
  const connection={enabled:true,subscribe(listener){listeners.add(listener);listener(current);return()=>listeners.delete(listener);},connect(){},refresh(){},disconnect(){}};
  const document={createElement:tag=>new Element(tag)};
  const view=createChatGPTConnectionView(connection,document);
  const publish=value=>{current={...current,...value};for(const listener of listeners)listener(current);};
  assert.equal(view.element.hidden,false);
  publish({stage:'connecting'});assert.equal(view.element.hidden,false);
  publish({stage:'connected',configured:true});assert.equal(view.element.hidden,true);
  publish({busy:true});assert.equal(view.element.hidden,true);
  for(const stage of ['checking','offline','attention']){publish({stage});assert.equal(view.element.hidden,false,stage);}
  publish({stage:'connected'});assert.equal(view.element.hidden,true);
  publish({stage:'disconnected',configured:false});assert.equal(view.element.hidden,false);
  view.dispose();assert.equal(listeners.size,0);
});

test('Settings retains shared connection controls and disposed modal views release their subscriptions',async()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.events={};this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,callback){this.events[name]=callback;}
  }
  const listeners=new Set(),calls=[];let current={configured:true,stage:'connected',message:'Shared Codex / ChatGPT Work allowance.',model:'offered-model',busy:false};
  const connection={enabled:true,subscribe(listener){listeners.add(listener);listener(current);return()=>listeners.delete(listener);},connect:()=>calls.push('connect'),refresh:()=>calls.push('refresh'),disconnect:()=>calls.push('disconnect')};
  const document={createElement:tag=>new Element(tag)},main=createChatGPTConnectionView(connection,document);
  for(let i=0;i<3;i++){
    const view=createChatGPTConnectionView(connection,document,{surface:'settings'});
    assert.equal(listeners.size,2);assert.equal(view.element.hidden,false);assert.equal(main.element.hidden,true);
    const [copy,actions]=view.element.children,[connect,retry,disconnect]=actions.children;
    assert.match(copy.children[1].textContent,/Shared Codex/);assert.equal(disconnect.hidden,false);
    disconnect.events.click();assert.equal(calls.at(-1),'disconnect');
    current={...current,stage:'offline'};for(const listener of listeners)listener(current);
    assert.equal(view.element.hidden,false);assert.equal(retry.hidden,false);retry.events.click();assert.equal(calls.at(-1),'refresh');
    current={...current,configured:false,stage:'disconnected'};for(const listener of listeners)listener(current);
    assert.equal(view.element.hidden,false);assert.equal(connect.hidden,false);connect.events.click();assert.equal(calls.at(-1),'connect');
    view.dispose();view.dispose();assert.equal(listeners.size,1);
    const prior=calls.length;disconnect.events.click();assert.equal(calls.length,prior);
    current={...current,configured:true,stage:'connected'};for(const listener of listeners)listener(current);
  }
  main.dispose();assert.equal(listeners.size,0);
});

test('approval survives Chrome returning to a different PWA window with no shared sessionStorage',async()=>{
  const first=fixture({saved:false});await first.client.ready;await first.client.connect();
  const pending=JSON.parse(first.localStorage.getItem(PENDING));
  assert.equal(first.sessionStorage.getItem(PENDING),null);
  const second=fixture({saved:false,persistentStorage:first.localStorage,hash:`hiroshi_code=${'c'.repeat(43)}&state=${pending.state}`,fetcher:async(url,options)=>{
    if(url.endsWith('/exchange')) {
      assert.equal(JSON.parse(options.body).verifier,pending.verifier);
      return Response.json({sessionToken:TOKEN,expiresAt:EXPIRY});
    }
    return Response.json({configured:true,provider:'chatgpt',model:'offered-model'});
  }});
  await second.client.ready;
  assert.notEqual(first.sessionStorage,second.sessionStorage);
  assert.equal(second.client.snapshot().configured,true);assert.equal(second.client.consumeNewApproval(),true);
  assert.equal(second.localStorage.getItem(PENDING),null);assert.equal(second.navigations.length,0);
  assert.equal(second.localStorage.getItem('koa.personal.v1'),'keep-game-progress');
});

test('an abandoned expired pairing transaction is removed without touching the game or starting login',async()=>{
  const persistent=memoryStorage({'koa.personal.v1':'keep-game-progress',[PENDING]:JSON.stringify({state:'s'.repeat(43),verifier:'v'.repeat(43),createdAt:NOW-600001})});
  const f=fixture({saved:false,persistentStorage:persistent});await f.client.ready;
  assert.equal(persistent.getItem(PENDING),null);assert.equal(persistent.getItem('koa.personal.v1'),'keep-game-progress');
  assert.equal(f.requests.length,0);assert.equal(f.navigations.length,0);
});

test('a fresh approval is activated only after successful verification and its flag is consumed once',async()=>{
  let offline=true;
  const f=fixture({saved:false,hash:`hiroshi_code=${'c'.repeat(43)}&state=${'s'.repeat(43)}`,fetcher:async(url)=>{
    if(url.endsWith('/exchange'))return Response.json({sessionToken:TOKEN,expiresAt:EXPIRY});
    if(offline)throw new Error('offline');
    return Response.json({configured:true,provider:'chatgpt',model:'offered-model'});
  }});
  f.localStorage.setItem(PENDING,JSON.stringify({verifier:'v'.repeat(43),state:'s'.repeat(43),createdAt:NOW}));
  await f.client.ready;assert.equal(f.client.consumeNewApproval(),false);
  offline=false;await f.client.refresh();assert.equal(f.client.consumeNewApproval(),true);assert.equal(f.client.consumeNewApproval(),false);
});

test('offline checks show attention even when retaining a previously connected session',async()=>{
  let offline=false;
  const f=fixture({fetcher:async()=>{if(offline)throw new Error('offline');return Response.json({configured:true,provider:'chatgpt',model:'offered-model'});}});
  class Element {constructor(){this.children=[];this.classList={toggle(){}};}append(...children){this.children.push(...children);}setAttribute(){}addEventListener(){}}
  const anchor={parentNode:{insertBefore(){}}};
  const card=mountChatGPTConnection(f.client,{querySelector:()=>anchor,createElement:()=>new Element()});
  await f.client.ready;offline=true;await f.client.refresh();
  assert.equal(f.client.snapshot().configured,true);assert.equal(card.children[0].children[0].textContent,'Connection needs attention');
  assert.equal(JSON.parse(f.localStorage.getItem(SESSION)).sessionToken,TOKEN);
});

test('a new approval activates live mode after the current reply without changing drafts or saved sessions; ordinary resume preserves guided choice',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const hookup=source.slice(source.indexOf('let webConnectionRefreshPending='),source.indexOf('\nfunction save()'));
  const check=source.slice(source.indexOf('async function checkConnection('),source.indexOf('\nconst installUI='));
  const setBusy=source.split(/\r?\n/).find(line=>line.startsWith('function setBusy('));
  for(const approved of [true,false]) {
    const queue=[],nodes=new Map();let callback,flag=approved;
    const state={preferences:{mode:'guided',modeChosen:true,language:'ja'},sessions:{guided:{messages:['saved reply']}},progress:{days:{today:4}}};
    const originalSessions=state.sessions,originalProgress=state.progress;
    const input={value:'keep my unfinished question',classList:{toggle(){}},setAttribute(){}};
    nodes.set('message-input',input);
    const client={enabled:true,ready:Promise.resolve(),fetch(){},snapshot:()=>({configured:true,stage:'connected'}),consumeNewApproval(){const result=flag;flag=false;return result;},setBusy(){}};
    const context=vm.createContext({APP_CONFIG:{phoneURL:PHONE,chatgptBackend:BACKEND},state,busy:approved,liveConfigured:false,aiProvider:'none',statusChecked:false,
      createChatGPTConnection:options=>{callback=options.onChange;return client;},mountChatGPTConnection(){},queueMicrotask:work=>queue.push(work),
      $:id=>{if(!nodes.has(id))nodes.set(id,{classList:{toggle(){}},setAttribute(){}});return nodes.get(id);},save(){},renderConversation(){},updateIdentity(){},renderSuggestions(){}});
    vm.runInContext(`${hookup}\n${check}\n${setBusy}`,context);
    callback({configured:true});
    if(approved){assert.equal(queue.length,0);assert.equal(state.preferences.mode,'guided');context.setBusy(false);}
    while(queue.length)queue.shift()();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.preferences.mode,approved?'live':'guided');assert.equal(state.preferences.modeChosen,true);
    assert.equal(input.value,'keep my unfinished question');assert.equal(state.sessions,originalSessions);assert.equal(state.progress,originalProgress);
    callback({configured:true});while(queue.length)queue.shift()();await new Promise(resolve=>setImmediate(resolve));
    if(approved){state.preferences.mode='guided';callback({configured:true});while(queue.length)queue.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(state.preferences.mode,'guided');}
  }
});
