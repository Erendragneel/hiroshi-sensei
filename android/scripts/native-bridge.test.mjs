import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../web/native-bootstrap.js',import.meta.url),'utf8');
function bridge(){
  const calls=[],external=[],cancelled=[],events=[],listeners={},nodes=new Map();
  const element=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){},replaceChildren(){},append(){}});return nodes.get(id);};
  const window={addEventListener(){},dispatchEvent:event=>events.push(event.type),fetch:async(...args)=>{external.push(args);return new Response('external');},HiroshiAndroid:{request:(...args)=>calls.push(args),cancel:id=>cancelled.push(id)}};
  const context=vm.createContext({window,document:{addEventListener:(name,callback)=>{listeners[name]=callback;},getElementById:element,createElement:()=>({})},location:{href:'https://appassets.androidplatform.net/index.html',origin:'https://appassets.androidplatform.net'},URL,Response,Event,DOMException,setTimeout,clearTimeout,queueMicrotask,Map,JSON});
  vm.runInContext(source,context);
  return {window,calls,external,cancelled,events,start:()=>listeners.DOMContentLoaded()};
}
test('only native API paths enter bridge; unrelated URLs never receive native credentials',async()=>{
  const b=bridge();const result=b.window.fetch('/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'こんにちは'}]})});
  assert.equal(b.calls.length,1);assert.equal(b.calls[0][1],'chat');
  const id=b.calls[0][0];b.window.__hiroshiReply(id,200,{reply:'こんにちは！'});
  assert.equal((await (await result).json()).reply,'こんにちは！');
  await b.window.fetch('https://example.com/api/chat');assert.equal(b.external.length,1);assert.equal(b.calls.length,1);
  assert.equal((await b.window.fetch('/api/not-supported')).status,404);assert.equal(b.calls.length,1);
});
test('structured native errors remain errors instead of becoming successful practice replies',async()=>{
  const b=bridge();const result=b.window.fetch('/api/chat',{body:'{}'});
  b.window.__hiroshiReply(b.calls[0][0],429,{error:{code:'CHATGPT_LIMIT_REACHED',message:'Review your usage.'}});
  const response=await result;assert.equal(response.ok,false);assert.equal((await response.json()).error.code,'CHATGPT_LIMIT_REACHED');
});
test('aborted conversations cancel native work and ignore a later completion',async()=>{
  const b=bridge(),controller=new AbortController();
  const result=b.window.fetch('/api/chat',{body:'{}',signal:controller.signal});const id=b.calls[0][0];
  controller.abort();await assert.rejects(result,{name:'AbortError'});assert.deepEqual(b.cancelled,[id]);
  b.window.__hiroshiReply(id,200,{reply:'too late'});
});
test('a connection event during initial loading is queued and reaches the game before model UI work',async()=>{
  const b=bridge();b.start();assert.equal(b.calls[0][1],'status');
  b.window.__hiroshiConnectionChanged();
  b.window.__hiroshiReply(b.calls[0][0],200,{configured:false,signedIn:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.calls[1][1],'status');
  b.window.__hiroshiReply(b.calls[1][0],200,{configured:true,signedIn:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.calls[2][1],'models');
  assert.equal(b.events.filter(e=>e==='hiroshi-connection-change').length,2);
  b.window.__hiroshiReply(b.calls[2][0],200,{models:[{slug:'offered-model',display_name:'Offered model'}],selected:'offered-model'});
  await new Promise(resolve=>setImmediate(resolve));
});
