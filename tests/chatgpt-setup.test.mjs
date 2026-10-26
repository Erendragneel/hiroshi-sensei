import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  constants, createDecipheriv, generateKeyPairSync, privateDecrypt, sign,
} from 'node:crypto';
import {BACKEND_ORIGIN,OPENAI,pkceChallenge,startChatGPTSetup,validateIdToken} from '../scripts/setup-chatgpt-plan.mjs';

const signing=generateKeyPairSync('rsa',{modulusLength:2048});
const hosting=generateKeyPairSync('rsa',{modulusLength:2048});
const publicSigning={...signing.publicKey.export({format:'jwk'}),kid:'fixture-key',use:'sig',alg:'RS256'};
const publicHosting=hosting.publicKey.export({format:'jwk'});
const CLIENT='oaiapp_fixture_client',ACCESS='fixture-private-access-token',REFRESH='fixture-private-refresh-token';
const IMPORT='fixture_private_import_capability_01234567890123456789',SERVICE='fixture_sites_server_access';
const hostId='urn:uuid:12345678-1234-4123-8123-123456789abc';
const response=value=>Response.json(value);

function identity(nonce,overrides={}){
  const time=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-key'})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({iss:OPENAI.issuer,aud:CLIENT,sub:'fixture-owner',iat:time,exp:time+3600,nonce,...overrides})).toString('base64url');
  return header+'.'+claims+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+claims),signing.privateKey).toString('base64url');
}
function decodeEnvelope(body){
  const envelope=JSON.parse(body),key=privateDecrypt({key:hosting.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64url'));
  const bytes=Buffer.from(envelope.ciphertext,'base64url'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64url'));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString('utf8'));
}
async function fixture(options={}){
  const events=[],calls=[];let authorization,imported,exchanges=0,finishes=0,discoveries=0,keyRequests=0;
  const transport=async(url,request)=>{
    calls.push({url,request});
    if(url===BACKEND_ORIGIN+'/api/hiroshi/bootstrap/begin'){
      const body=JSON.parse(request.body);assert.equal(body.code,'fixture-host-ticket');
      assert.equal(pkceChallenge(body.verifier),new URL(setup.setupURL).searchParams.get('challenge'));
      return response({importToken:IMPORT,publicKeyJwk:publicHosting,hostId,pendingClientId:options.returningClient?CLIENT:undefined});
    }
    if(url===BACKEND_ORIGIN+'/api/hiroshi/bootstrap/register'){
      assert.equal(request.headers.Authorization,'Bearer '+IMPORT);
      assert.equal(JSON.parse(request.body).clientId,CLIENT);
      return response({registered:true});
    }
    assert.ok(!request.headers['OAI-Sites-Authorization']||url.startsWith(BACKEND_ORIGIN+'/'));
    if(url===OPENAI.discovery){
      discoveries++;
      if(options.discovery503Once&&discoveries===1)return Response.json({error:'fixture-retry'},{status:503});
      return response({issuer:OPENAI.issuer,authorization_endpoint:OPENAI.authorize,token_endpoint:OPENAI.token,jwks_uri:OPENAI.jwks});
    }
    if(url===OPENAI.token){
      exchanges++;
      assert.equal(request.headers['Content-Type'],'application/x-www-form-urlencoded');
      const body=new URLSearchParams(request.body);
      assert.equal(body.get('client_id'),CLIENT);assert.equal(body.get('code'),'fixture-oauth-code');
      assert.equal(body.get('redirect_uri'),setup.redirectURI);
      assert.equal(body.get('resource'),OPENAI.resource);
      assert.equal(pkceChallenge(body.get('code_verifier')),authorization.searchParams.get('code_challenge'));
      if(options.rejectExchange){
        if(options.oversizedProviderError)return new Response('fixture-private-provider-detail'.repeat(1000),{status:401,headers:{'x-request-id':'req_fixture_12345678'}});
        return Response.json({error:options.unsafeProviderError?'fixture-private-provider-detail':'invalid_grant',error_description:'fixture-private-provider-detail'},
          {status:401,headers:{'x-request-id':options.unsafeProviderError?'private-account@example.invalid':'req_fixture_12345678'}});
      }
      return response({access_token:ACCESS,refresh_token:REFRESH,token_type:'Bearer',expires_in:3600,
        id_token:identity(options.wrongNonce?'different-private-nonce':authorization.searchParams.get('nonce')),
        scope:options.identityOnly?'openid profile email':'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
    }
    if(url===OPENAI.jwks){
      keyRequests++;
      if(options.jwks503Once&&keyRequests===1)return Response.json({error:'fixture-retry'},{status:503});
      if(options.jwksDenied)return Response.json({error:'fixture-denied'},{status:403});
      return response({keys:[publicSigning]});
    }
    if(url===BACKEND_ORIGIN+'/api/hiroshi/bootstrap/finish'){
      finishes++;
      assert.equal(request.headers.Authorization,'Bearer '+IMPORT);
      assert.ok(!request.body.includes(ACCESS));assert.ok(!request.body.includes(REFRESH));
      imported=decodeEnvelope(request.body);
      if(options.finish503Once&&finishes===1)return Response.json({error:'fixture-retry'},{status:503});
      if(options.finishDenied)return Response.json({error:'fixture-denied'},{status:403});
      return response(options.unverified?{connected:true,verified:false}:{connected:true,verified:true,model:'fixture-model'});
    }
    throw new Error('Unexpected fixture destination');
  };
  const setup=await startChatGPTSetup({fetchImpl:transport,siteServiceToken:SERVICE,onEvent:event=>events.push(event),timeoutMs:10000});
  async function startBrowser(){
    const params=new URL(setup.setupURL).searchParams;
    const callback=new URL(params.get('return_to'));callback.search=new URLSearchParams({code:'fixture-host-ticket',state:params.get('state')});
    const returned=await fetch(callback,{redirect:'manual'});assert.equal(returned.status,302);
    authorization=new URL(returned.headers.get('location'));assert.equal(authorization.origin+authorization.pathname,OPENAI.authorize);
    return authorization;
  }
  async function approve({omitClientId=false,clientId=CLIENT}={}){
    if(!authorization)await startBrowser();
    const parameters={code:'fixture-oauth-code',state:authorization.searchParams.get('state')};
    if(!omitClientId)parameters.client_id=clientId;
    const callback=new URL(setup.redirectURI);callback.search=new URLSearchParams(parameters);
    return fetch(callback,{redirect:'manual'});
  }
  return {setup,startBrowser,approve,events,calls,get imported(){return imported;},get exchanges(){return exchanges;},get finishes(){return finishes;},get discoveries(){return discoveries;},get keyRequests(){return keyRequests;}};
}

test('one-time local approval verifies PKCE and identity, then imports only an encrypted session',async()=>{
  const f=await fixture();
  try{
    const authorization=await f.startBrowser();
    assert.equal(authorization.searchParams.get('client_id'),'dynamic_agent_client');
    assert.equal(authorization.searchParams.get('agent_name_hint'),'Hiroshi sensei');
    assert.equal(authorization.searchParams.get('ext_agent_host_id'),hostId);
    assert.equal(authorization.searchParams.get('code_verifier'),null);
    const callback=await f.approve(),html=await callback.text();
    assert.equal(callback.status,200);
    assert.deepEqual(await f.setup.completion,{connected:true,verified:true,model:'fixture-model'});
    assert.equal(f.imported.clientId,CLIENT);assert.equal(f.imported.hostId,hostId);
    assert.equal(f.imported.tokens.access_token,ACCESS);assert.equal(f.imported.tokens.refresh_token,REFRESH);
    assert.equal(f.imported.nonce,authorization.searchParams.get('nonce'));
    assert.ok(f.imported.receivedAt<=Date.now());
    assert.equal(f.exchanges,1);
    const backendCalls=f.calls.filter(call=>call.url.startsWith(BACKEND_ORIGIN+'/'));
    assert.equal(backendCalls.length,3);
    assert.ok(backendCalls.every(call=>call.request.headers['OAI-Sites-Authorization']==='Bearer '+SERVICE));
    assert.ok(f.calls.filter(call=>call.url.startsWith(OPENAI.issuer)).every(call=>!call.request.headers.Authorization&&!call.request.headers['OAI-Sites-Authorization']));
    for(const secret of [ACCESS,REFRESH,IMPORT,SERVICE,'fixture-oauth-code','fixture-host-ticket']){
      assert.ok(!html.includes(secret));assert.ok(!JSON.stringify(f.events).includes(secret));
    }
    assert.equal(f.events.filter(event=>event.type==='open_browser').length,1);
    assert.ok(f.events[0].type==='stage');
  }finally{f.setup.cancel();}
});

test('a mismatched or duplicated loopback state cannot consume an authorization code',async()=>{
  const f=await fixture();
  try{
    const authorization=await f.startBrowser();
    const wrong=new URL(f.setup.redirectURI);wrong.search=new URLSearchParams({code:'fixture-oauth-code',state:'wrong-state',client_id:CLIENT});
    assert.equal((await fetch(wrong)).status,400);assert.equal(f.exchanges,0);
    const duplicated=new URL(f.setup.redirectURI);duplicated.search='?code=fixture-oauth-code&state='+authorization.searchParams.get('state')+'&state='+authorization.searchParams.get('state')+'&client_id='+CLIENT;
    assert.equal((await fetch(duplicated)).status,400);assert.equal(f.exchanges,0);
    assert.equal((await f.approve()).status,200);await f.setup.completion;
  }finally{f.setup.cancel();}
});

test('a saved registration is reused and a returning callback can omit its client ID',async()=>{
  const f=await fixture({returningClient:true});
  try{
    const authorization=await f.startBrowser();
    assert.equal(authorization.searchParams.get('client_id'),CLIENT);
    assert.equal(authorization.searchParams.get('agent_name_hint'),null);
    assert.equal((await f.approve({omitClientId:true})).status,200);await f.setup.completion;
    const registration=f.calls.findIndex(call=>call.url.endsWith('/bootstrap/register'));
    const exchange=f.calls.findIndex(call=>call.url===OPENAI.token);
    assert.ok(registration>=0&&exchange>registration);
    assert.equal(f.exchanges,1);
  }finally{f.setup.cancel();}
});

test('a returning callback cannot substitute another app registration',async()=>{
  const f=await fixture({returningClient:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='REGISTRATION_INCOMPLETE');
    assert.equal((await f.approve({clientId:'oaiapp_wrong_registration'})).status,400);await pending;
    assert.equal(f.exchanges,0);
    assert.ok(!f.calls.some(call=>call.url.endsWith('/bootstrap/register')));
  }finally{f.setup.cancel();}
});

test('a wrong signed nonce is rejected before any hosted credential import',async()=>{
  const f=await fixture({wrongNonce:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='IDENTITY_NOT_VERIFIED');
    assert.equal((await f.approve()).status,400);await pending;
    assert.equal(f.imported,undefined);
    assert.ok(!f.calls.some(call=>call.url.endsWith('/bootstrap/finish')));
  }finally{f.setup.cancel();}
});

test('identity-only approval never becomes permission to use the ChatGPT plan',async()=>{
  const f=await fixture({identityOnly:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='PLAN_PERMISSION_REQUIRED');
    assert.equal((await f.approve()).status,400);await pending;
    assert.equal(f.imported,undefined);
  }finally{f.setup.cancel();}
});

test('an exchange error keeps provider bodies and credentials out of local diagnostics',async()=>{
  const f=await fixture({rejectExchange:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='OPENAI_REQUEST_REJECTED'&&error.httpStatus===401);
    const returned=await f.approve(),html=await returned.text();await pending;
    assert.equal(returned.status,400);assert.equal(f.imported,undefined);
    assert.ok(!html.includes('fixture-private-provider-detail'));
    assert.ok(!JSON.stringify(f.events).includes('fixture-private-provider-detail'));
    const diagnostic=f.events.find(event=>event.type==='error');
    assert.equal(diagnostic.stage,'EXCHANGING_APPROVAL');assert.equal(diagnostic.httpStatus,401);
    assert.equal(diagnostic.providerCode,'invalid_grant');assert.equal(diagnostic.requestId,'req_fixture_12345678');
  }finally{f.setup.cancel();}
});

test('unknown provider codes and unsafe request IDs are omitted from diagnostics',async()=>{
  const f=await fixture({rejectExchange:true,unsafeProviderError:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='OPENAI_REQUEST_REJECTED');
    await f.approve();await pending;
    const diagnostic=f.events.find(event=>event.type==='error');
    assert.equal(diagnostic.httpStatus,401);assert.equal(diagnostic.providerCode,undefined);assert.equal(diagnostic.requestId,undefined);
    assert.ok(!JSON.stringify(f.events).includes('fixture-private-provider-detail'));
    assert.ok(!JSON.stringify(f.events).includes('private-account@example.invalid'));
  }finally{f.setup.cancel();}
});

test('oversized non-JSON error bodies preserve only HTTP status and safe request ID',async()=>{
  const f=await fixture({rejectExchange:true,oversizedProviderError:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='OPENAI_REQUEST_REJECTED'&&error.httpStatus===401);
    await f.approve();await pending;
    const diagnostic=f.events.find(event=>event.type==='error');
    assert.equal(diagnostic.providerCode,undefined);assert.equal(diagnostic.requestId,'req_fixture_12345678');
    assert.ok(!JSON.stringify(f.events).includes('fixture-private-provider-detail'));
  }finally{f.setup.cancel();}
});

test('the helper reports success only after the hosted connection verifies a completed reply',async()=>{
  const f=await fixture({unverified:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='HOSTED_VERIFICATION_FAILED');
    const returned=await f.approve();await pending;
    assert.equal(returned.status,400);
    assert.ok(!f.events.some(event=>event.type==='complete'));
  }finally{f.setup.cancel();}
});

test('a temporary hosted import failure retries the identical sealed envelope without another OAuth approval',async()=>{
  const f=await fixture({finish503Once:true});
  try{
    assert.equal((await f.approve()).status,200);
    assert.equal((await f.setup.completion).verified,true);
    assert.equal(f.exchanges,1);assert.equal(f.finishes,2);
    assert.equal(f.events.filter(event=>event.type==='open_browser').length,1);
    const attempts=f.calls.filter(call=>call.url.endsWith('/bootstrap/finish'));
    assert.equal(attempts[0].request.body,attempts[1].request.body);
    assert.equal(attempts[0].request.headers.Authorization,attempts[1].request.headers.Authorization);
  }finally{f.setup.cancel();}
});

test('a denied hosted import is not retried',async()=>{
  const f=await fixture({finishDenied:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='HOST_REQUEST_REJECTED'&&error.httpStatus===403);
    assert.equal((await f.approve()).status,400);await pending;
    assert.equal(f.exchanges,1);assert.equal(f.finishes,1);
  }finally{f.setup.cancel();}
});

test('a temporary signing-key failure after code exchange recovers without another approval',async()=>{
  const f=await fixture({jwks503Once:true});
  try{
    assert.equal((await f.approve()).status,200);
    assert.equal((await f.setup.completion).verified,true);
    assert.equal(f.exchanges,1);assert.equal(f.keyRequests,2);assert.equal(f.finishes,1);
    assert.equal(f.events.filter(event=>event.type==='open_browser').length,1);
  }finally{f.setup.cancel();}
});

test('temporary public discovery failure is retried without creating another hosted setup',async()=>{
  const f=await fixture({discovery503Once:true});
  try{
    assert.equal((await f.approve()).status,200);await f.setup.completion;
    assert.equal(f.discoveries,2);assert.equal(f.exchanges,1);
    assert.equal(f.calls.filter(call=>call.url.endsWith('/bootstrap/begin')).length,1);
    assert.equal(f.events.filter(event=>event.type==='open_browser').length,1);
  }finally{f.setup.cancel();}
});

test('a denied public signing-key request is not retried or imported',async()=>{
  const f=await fixture({jwksDenied:true});
  try{
    const pending=assert.rejects(f.setup.completion,error=>error.code==='OPENAI_REQUEST_REJECTED'&&error.httpStatus===403);
    assert.equal((await f.approve()).status,400);await pending;
    assert.equal(f.keyRequests,1);assert.equal(f.exchanges,1);assert.equal(f.finishes,0);
  }finally{f.setup.cancel();}
});

test('cancelling closes the loopback helper without starting an exchange or importing credentials',async()=>{
  const f=await fixture();
  const pending=assert.rejects(f.setup.completion,error=>error.code==='SETUP_CANCELLED');
  f.setup.cancel();await pending;
  assert.equal(f.calls.length,0);assert.equal(f.exchanges,0);
  await assert.rejects(fetch(f.setup.redirectURI));
});

test('production setup refuses arbitrary backend destinations',async()=>{
  await assert.rejects(startChatGPTSetup({backend:'https://example.com'}),error=>error.code==='BACKEND_REJECTED');
});

test('identity validation rejects wrong audience, signature, expired claims and untrusted key references',()=>{
  const nonce='fixture-original-nonce',keys={keys:[publicSigning]};
  assert.equal(validateIdToken(identity(nonce),keys,{clientId:CLIENT,nonce}).sub,'fixture-owner');
  for(const overrides of [{aud:'wrong-client'},{exp:0},{nonce:'wrong-nonce'},{iss:'https://example.com'}]){
    assert.throws(()=>validateIdToken(identity(nonce,overrides),keys,{clientId:CLIENT,nonce}),error=>error.code==='IDENTITY_NOT_VERIFIED');
  }
  const jwt=identity(nonce).split('.');jwt[2]='a'.repeat(jwt[2].length);
  assert.throws(()=>validateIdToken(jwt.join('.'),keys,{clientId:CLIENT,nonce}),error=>error.code==='IDENTITY_NOT_VERIFIED');
  assert.throws(()=>validateIdToken(identity(nonce),{keys:[publicSigning,publicSigning]},{clientId:CLIENT,nonce}),error=>error.code==='IDENTITY_NOT_VERIFIED');
});

for(const [label,terminator] of [['Windows Enter','\r'],['pipe newline','\n']]){
  test(`the CLI accepts ${label} configuration without echoing its service token`,async()=>{
    // Disable upstream fetch in this owned fixture process. Only its local HTTP
    // listener is exercised; this regression never contacts Sites or OpenAI.
    const preload='data:text/javascript,'+encodeURIComponent("globalThis.fetch=()=>{process.stderr.write('UNEXPECTED_UPSTREAM_CALL\\n');throw new Error('upstream disabled in CLI fixture');};");
    const child=spawn(process.execPath,['--import',preload,fileURLToPath(new URL('../scripts/setup-chatgpt-plan.mjs',import.meta.url))],
      {stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
    const exited=new Promise(resolve=>child.once('exit',resolve));
    const waitUntil=predicate=>new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{cleanup();reject(new Error('The setup fixture did not reach its expected state.'));},5000);
      const check=()=>{if(predicate()){cleanup();resolve();}};
      const ended=()=>{cleanup();reject(new Error('The setup fixture exited before its expected state.'));};
      const cleanup=()=>{clearTimeout(timeout);child.stdout.off('data',check);child.off('exit',ended);};
      child.stdout.on('data',check);child.once('exit',ended);check();
    });
    try{
      await waitUntil(()=>stdout.includes('Ready for setup configuration'));
      child.stdin.write(JSON.stringify({siteServiceToken:SERVICE})+terminator);
      await waitUntil(()=>stdout.includes('"type":"open_browser"'));
      const event=stdout.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(value=>value.type==='open_browser');
      const setupURL=new URL(event.url);
      assert.equal(setupURL.origin,BACKEND_ORIGIN);assert.equal(setupURL.pathname,'/api/hiroshi/bootstrap/start');
      const localURL=new URL(setupURL.searchParams.get('return_to'));
      assert.equal(localURL.hostname,'127.0.0.1');assert.equal(localURL.pathname,'/setup/callback');
      localURL.pathname='/status';localURL.search='';
      assert.equal((await fetch(localURL)).status,200);
      assert.ok(!stdout.includes(SERVICE));assert.equal(stderr,'');
      assert.ok(stdout.includes('WAITING_FOR_HOST'));
    }finally{
      child.kill('SIGTERM');await exited;
    }
  });
}
