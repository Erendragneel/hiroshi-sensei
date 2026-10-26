import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {
  constants, createCipheriv, createHash, createPublicKey, publicEncrypt,
  randomBytes, timingSafeEqual, verify,
} from 'node:crypto';

export const BACKEND_ORIGIN = 'https://koa-personal-companion.elijio-villa.chatgpt.site';
export const OPENAI = Object.freeze({
  issuer:'https://auth.openai.com',
  discovery:'https://auth.openai.com/.well-known/openid-configuration',
  authorize:'https://auth.openai.com/api/accounts/authorize',
  token:'https://auth.openai.com/api/accounts/oauth/token',
  jwks:'https://auth.openai.com/.well-known/jwks.json',
  resource:'https://api.openai.com/v1',
});
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const TOKEN_LIMIT = 262144;
const PROVIDER_CODES = new Set(['invalid_client','invalid_grant','invalid_request','invalid_scope','invalid_target',
  'unauthorized_client','unsupported_grant_type','access_denied','server_error','temporarily_unavailable',
  'subscription_sharing_user_not_eligible','chatpass_v2_scope_not_authorized','chatpass_v2_invalid_authorization_context']);
const HOST_CODES = new Set(['CONNECTION_UNAVAILABLE','CHATGPT_CONNECTION_INTERRUPTED','CHATGPT_ACCESS_DENIED',
  'CHATGPT_SERVICE_ERROR','CHATGPT_INVALID_RESPONSE','CHATGPT_MODELS_UNAVAILABLE','CHATGPT_NO_MODELS',
  'CHATGPT_LIMIT_REACHED','IDENTITY_INVALID','IDENTITY_KEY_UNAVAILABLE','INVALID_IMPORT','STORAGE_UNAVAILABLE',
  'SETUP_EXPIRED','SETUP_BUSY','AI_EMPTY_REPLY','AI_INVALID_REPLY','AI_INCOMPLETE_REPLY','PLAN_PERMISSION_REQUIRED',
  'AI_INVALID_STREAM','AI_INCOMPLETE','AI_REFUSAL','AI_REPLY_TOO_LARGE','CHATGPT_REQUEST_FAILED']);
const HOST_STAGES = new Set(['decrypt','identity','checkpoint','models','inference','commit']);
const random = bytes => randomBytes(bytes).toString('base64url');
export const pkceChallenge = value => createHash('sha256').update(value,'ascii').digest('base64url');
const constantEquals = (left,right) => typeof left==='string' && typeof right==='string'
  && Buffer.byteLength(left)===Buffer.byteLength(right)
  && timingSafeEqual(Buffer.from(left),Buffer.from(right));
const dictionary = value => value!==null && typeof value==='object' && !Array.isArray(value);

export class SetupError extends Error {
  constructor(code,message,httpStatus=0,{providerCode,requestId,hostCode,hostStage,diagnosticType,responseType}={}){
    super(message);this.name='SetupError';this.code=code;this.httpStatus=httpStatus;
    if(PROVIDER_CODES.has(providerCode))this.providerCode=providerCode;
    if(HOST_CODES.has(hostCode))this.hostCode=hostCode;
    if(HOST_STAGES.has(hostStage))this.hostStage=hostStage;
    if(['Error','TypeError','RangeError','NotSupportedError','DataError','OperationError','InvalidAccessError','BodyTooLarge','InvalidJson','UnreadableBody','ContentType','EventJson','EventTooLarge','DeltaType'].includes(diagnosticType))this.diagnosticType=diagnosticType;
    if(['json','html','other','event-stream'].includes(responseType))this.responseType=responseType;
    if(typeof requestId==='string'&&(/^(?:req_[A-Za-z0-9_-]{8,100}|[A-Fa-f0-9-]{16,64})$/.test(requestId)))this.requestId=requestId;
  }
}
const fail = (code,message,status=0,details) => new SetupError(code,message,status,details);
const callbackFailure = () => fail('CALLBACK_REJECTED','This sign-in return could not be accepted. Start the setup again.');

function publicRsaKey(jwk) {
  if(!dictionary(jwk)||jwk.kty!=='RSA'||['d','p','q','dp','dq','qi','oth'].some(name=>name in jwk))throw new Error();
  for(const name of ['n','e'])if(typeof jwk[name]!=='string'||!jwk[name].match(/^[A-Za-z0-9_-]+$/))throw new Error();
  const modulus=Buffer.from(jwk.n,'base64url'), exponent=Buffer.from(jwk.e,'base64url');
  if(modulus.length<256||modulus.length>1024||exponent.length===0||exponent.length>4)throw new Error();
  const number=BigInt('0x'+exponent.toString('hex'));
  if(number<3n||number%2n!==1n)throw new Error();
  const key=createPublicKey({key:{kty:'RSA',n:jwk.n,e:jwk.e},format:'jwk'});
  if(key.asymmetricKeyDetails.modulusLength<2048||key.asymmetricKeyDetails.modulusLength>8192)throw new Error();
  return key;
}

/** Validate a signed identity before any credential is imported into the host. */
export function validateIdToken(jwt,jwks,{clientId,nonce,now=Date.now()}) {
  try {
    if(typeof jwt!=='string'||jwt.length>64000)throw new Error();
    const parts=jwt.split('.');if(parts.length!==3)throw new Error();
    for(const part of parts)if(!/^[A-Za-z0-9_-]+$/.test(part)||Buffer.from(part,'base64url').toString('base64url')!==part)throw new Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(!dictionary(header)||header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256
      ||['crit','jku','jwk','x5u'].some(name=>name in header))throw new Error();
    if(!Array.isArray(jwks?.keys)||jwks.keys.length>100)throw new Error();
    const selected=jwks.keys.filter(key=>dictionary(key)&&key.kid===header.kid&&key.kty==='RSA'
      &&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256'));
    if(selected.length!==1)throw new Error();
    if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicRsaKey(selected[0]),Buffer.from(parts[2],'base64url')))throw new Error();
    const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')), seconds=Math.floor(now/1000);
    if(!dictionary(claims)||claims.iss!==OPENAI.issuer||!Number.isSafeInteger(claims.exp)||claims.exp<=seconds-5
      ||!Number.isSafeInteger(claims.iat)||claims.iat<0||claims.iat>seconds+5
      ||('nbf' in claims&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>seconds+5))
      ||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>512)throw new Error();
    const audiences=typeof claims.aud==='string'?[claims.aud]:claims.aud;
    if(!Array.isArray(audiences)||!audiences.every(value=>typeof value==='string')||!audiences.includes(clientId)
      ||(audiences.length>1&&claims.azp!==clientId)||('azp' in claims&&claims.azp!==clientId)
      ||!constantEquals(nonce,claims.nonce))throw new Error();
    return claims;
  }catch{throw fail('IDENTITY_NOT_VERIFIED','OpenAI returned an identity that could not be verified. Please start setup again.');}
}

/** AES-GCM tag is appended to ciphertext; all envelope fields use base64url. */
export function sealCredentialBundle(bundle,publicKeyJwk) {
  let plaintext,key;
  try {
    const rsa=publicRsaKey(publicKeyJwk),iv=randomBytes(12);key=randomBytes(32);
    plaintext=Buffer.from(JSON.stringify(bundle),'utf8');
    if(plaintext.length>200000)throw new Error();
    const cipher=createCipheriv('aes-256-gcm',key,iv);
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
    const wrappedKey=publicEncrypt({key:rsa,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
    return {iv:iv.toString('base64url'),ciphertext:ciphertext.toString('base64url'),wrappedKey:wrappedKey.toString('base64url')};
  }catch{throw fail('HOST_ENCRYPTION_FAILED','The hosted connection could not be prepared securely.');}
  finally{plaintext?.fill(0);key?.fill(0);}
}

function parseReturn(target,path,state) {
  try {
    if(typeof target!=='string'||target.length>16000||!target.startsWith('/')||target.startsWith('//')||target.includes('#'))throw new Error();
    const url=new URL(target,'http://127.0.0.1');
    if(url.pathname!==path)throw new Error();
    const parameters=new Map();
    for(const [name,value] of url.searchParams){if(parameters.has(name))throw new Error();parameters.set(name,value);}
    if(!constantEquals(parameters.get('state'),state))throw new Error();
    if(parameters.has('error'))throw fail('APPROVAL_DECLINED','The connection was not approved. You can start setup again when ready.');
    const code=parameters.get('code');
    if(typeof code!=='string'||!code||code.length>8000)throw new Error();
    return parameters;
  }catch(error){if(error instanceof SetupError)throw error;throw callbackFailure();}
}

const page = (message,success=false) => '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  +'<title>Hiroshi sensei connection</title><style>body{font:17px/1.65 system-ui,sans-serif;background:#f6f5f0;color:#345849;padding:32px;max-width:560px;margin:10vh auto}a{color:inherit}</style>'
  +'<h1>Hiroshi sensei</h1><p>'+message+'</p>'+(success?'<p><a href="https://erendragneel.github.io/hiroshi-sensei/">Open your GitHub game</a></p>':'')+'</html>';
function respond(response,status,message,success=false){
  response.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
  response.end(page(message,success));
}

/**
 * Only test fixtures inject fetchImpl. Production URLs, loopback binding and
 * credential destinations are fixed; no OAuth token is written to disk or a URL.
 */
export async function startChatGPTSetup({backend=BACKEND_ORIGIN,siteServiceToken='',fetchImpl=fetch,onEvent=()=>{},timeoutMs=600000,now=Date.now}={}) {
  if(backend!==BACKEND_ORIGIN)throw fail('BACKEND_REJECTED','The setup destination does not match Hiroshi.');
  if(typeof siteServiceToken!=='string'||siteServiceToken.length>16000||/[\r\n]/.test(siteServiceToken))throw fail('CONFIGURATION_INVALID','The setup configuration could not be accepted.');
  const setupState=random(32),setupVerifier=random(64),oauthState=random(32),oauthVerifier=random(64),nonce=random(32);
  const abort=new AbortController();let phase='READY',closed=false,done=false,timer,bootstrap,resolveDone,rejectDone;
  const completion=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});completion.catch(()=>{});
  const event=value=>{try{onEvent(value);}catch{/* Display callbacks never change authorization. */}};
  const stage=value=>{phase=value;event({type:'stage',stage:value});};
  const active=()=>{if(closed)throw fail('SETUP_CANCELLED','Setup stopped. You can start again when ready.');};
  const server=http.createServer({maxHeaderSize:16384,requestTimeout:15000,headersTimeout:15000},async(request,response)=>{
    if(request.method!=='GET'){respond(response,405,'Use the setup link shown on this computer.');return;}
    if(request.headers.host!==`127.0.0.1:${server.address()?.port}`){respond(response,400,'This local request could not be accepted.');return;}
    const pathname=typeof request.url==='string'?request.url.split('?')[0]:'';
    if(pathname==='/setup/callback'&&phase==='WAITING_FOR_HOST'){
      let parameters;try{parameters=parseReturn(request.url,'/setup/callback',setupState);}catch(error){respond(response,400,error.message);return;}
      stage('PREPARING_CONNECTION');
      try {
        bootstrap=await jsonRequest(backend+'/api/hiroshi/bootstrap/begin','POST',{code:parameters.get('code'),verifier:setupVerifier},{service:true});active();
        if(!dictionary(bootstrap)||typeof bootstrap.importToken!=='string'||!/^[-A-Za-z0-9_]{32,4096}$/.test(bootstrap.importToken)
          ||typeof bootstrap.hostId!=='string'||!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bootstrap.hostId))throw fail('HOST_RESPONSE_INVALID','The hosted connection returned an invalid setup response.');
        if(bootstrap.pendingClientId!==undefined&&bootstrap.pendingClientId!==null&&bootstrap.pendingClientId!==''
          &&(typeof bootstrap.pendingClientId!=='string'||!/^[-A-Za-z0-9_]{4,256}$/.test(bootstrap.pendingClientId)||bootstrap.pendingClientId==='dynamic_agent_client'))throw fail('HOST_RESPONSE_INVALID','The saved ChatGPT app registration could not be verified.');
        try{publicRsaKey(bootstrap.publicKeyJwk);}catch{throw fail('HOST_RESPONSE_INVALID','The hosted encryption key could not be verified.');}
        if(bootstrap.resumeAvailable!==undefined&&typeof bootstrap.resumeAvailable!=='boolean')throw fail('HOST_RESPONSE_INVALID','The saved setup could not be verified.');
        if(bootstrap.resumeAvailable===true){
          stage('VERIFYING_HOSTED_AI');
          completeHosted(await finishHostedConnection({}),response);return;
        }
        const metadata=await publicIdentityRequest(OPENAI.discovery);active();
        if(metadata.issuer!==OPENAI.issuer||metadata.authorization_endpoint!==OPENAI.authorize||metadata.token_endpoint!==OPENAI.token||metadata.jwks_uri!==OPENAI.jwks)throw fail('OPENAI_CONFIGURATION_INVALID','OpenAI sign-in configuration could not be verified.');
        const authorization=new URL(OPENAI.authorize);
        const authorizationParameters={client_id:bootstrap.pendingClientId||'dynamic_agent_client',ext_agent_host_id:bootstrap.hostId,
          response_type:'code',redirect_uri:redirectURI,scope:SCOPES,resource:OPENAI.resource,state:oauthState,nonce,
          code_challenge_method:'S256',code_challenge:pkceChallenge(oauthVerifier)};
        if(!bootstrap.pendingClientId)authorizationParameters.agent_name_hint='Hiroshi sensei';
        authorization.search=new URLSearchParams(authorizationParameters).toString();
        stage('WAITING_FOR_CHATGPT_APPROVAL');
        response.writeHead(302,{Location:authorization.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});response.end();
      }catch(error){finishFailure(error,response);}
      return;
    }
    if(pathname==='/auth/callback'&&phase==='WAITING_FOR_CHATGPT_APPROVAL'){
      let parameters;
      try{parameters=parseReturn(request.url,'/auth/callback',oauthState);}catch(error){
        respond(response,400,error.message);if(error.code==='APPROVAL_DECLINED')finishFailure(error);return;
      }
      const suppliedClientId=parameters.get('client_id'),savedClientId=bootstrap.pendingClientId||'',clientId=suppliedClientId||savedClientId;
      if(typeof clientId!=='string'||!/^[-A-Za-z0-9_]{4,256}$/.test(clientId)||clientId==='dynamic_agent_client'
        ||(savedClientId&&parameters.has('client_id')&&suppliedClientId!==savedClientId)){finishFailure(fail('REGISTRATION_INCOMPLETE','ChatGPT did not return the expected app registration.'),response);return;}
      stage('SAVING_REGISTRATION');
      try {
        const registered=await retryHostedRequest('/api/hiroshi/bootstrap/register',{clientId});active();
        if(registered.registered===false)throw fail('HOST_REGISTRATION_FAILED','The hosted app registration could not be saved.');
        stage('EXCHANGING_APPROVAL');
        const tokens=await jsonRequest(OPENAI.token,'POST',new URLSearchParams({grant_type:'authorization_code',client_id:clientId,
          code:parameters.get('code'),code_verifier:oauthVerifier,redirect_uri:redirectURI,resource:OPENAI.resource}));
        const receivedAt=now();active();
        const scopes=new Set(typeof tokens.scope==='string'?tokens.scope.trim().split(/\s+/):[]);
        if(!scopes.has('chatgpt.tokens.use.direct')||!scopes.has('resource.invoke'))throw fail('PLAN_PERMISSION_REQUIRED','ChatGPT plan usage was not approved. Start again and allow plan usage to connect Hiroshi.');
        if(typeof tokens.id_token!=='string'||typeof tokens.access_token!=='string'||!tokens.access_token||tokens.access_token.length>64000
          ||typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>64000
          ||typeof tokens.token_type!=='string'||tokens.token_type.toLowerCase()!=='bearer'
          ||!Number.isSafeInteger(tokens.expires_in)||tokens.expires_in<=0||tokens.expires_in>86400)throw fail('TOKEN_RESPONSE_INVALID','OpenAI returned an incomplete connection.');
        stage('VERIFYING_IDENTITY');
        const keys=await publicIdentityRequest(OPENAI.jwks);active();
        validateIdToken(tokens.id_token,keys,{clientId,nonce,now:receivedAt});
        const imported={};for(const name of ['id_token','access_token','refresh_token','token_type','scope','expires_in'])imported[name]=tokens[name];
        if(Number.isSafeInteger(tokens.earliest_refresh_at))imported.earliest_refresh_at=tokens.earliest_refresh_at;
        const sealed=sealCredentialBundle({tokens:imported,clientId,nonce,receivedAt,hostId:bootstrap.hostId},bootstrap.publicKeyJwk);
        stage('VERIFYING_HOSTED_AI');
        const result=await finishHostedConnection(sealed);active();
        completeHosted(result,response);
      }catch(error){finishFailure(error,response);}
      return;
    }
    if(pathname==='/'||pathname==='/status'){
      respond(response,200,done?'The hosted connection was verified. Return to your GitHub game.':'Complete the setup in the browser window that opened.',done);return;
    }
    respond(response,404,'This setup link is no longer active. Return to the game or start setup again.');
  });
  server.maxConnections=8;
  function completeHosted(result,response){
    active();
    if(result.connected!==true||result.verified!==true)throw fail('HOSTED_VERIFICATION_FAILED','The hosted ChatGPT connection has not completed a verified reply.');
    const safe={connected:true,verified:true};if(typeof result.model==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(result.model))safe.model=result.model;
    stage('CONNECTED');done=true;respond(response,200,'Your hosted ChatGPT connection is ready. You can return to Hiroshi on your phone. This computer is no longer needed for replies.',true);
    resolveDone(safe);event({type:'complete',...safe});closeServer();
  }
  function closeServer(){clearTimeout(timer);closed=true;abort.abort();bootstrap=null;siteServiceToken='';server.close();server.closeIdleConnections?.();}
  function finishFailure(error,response){
    if(done)return;
    const safe=error instanceof SetupError?error:fail('SETUP_INTERRUPTED','The connection could not finish. Return to the assistant to check the setup.');
    if(response&&!response.headersSent)respond(response,400,safe.message);
    done=true;event({type:'error',stage:phase,code:safe.code,httpStatus:safe.httpStatus||0,
      ...(safe.providerCode?{providerCode:safe.providerCode}:{}),...(safe.requestId?{requestId:safe.requestId}:{}),
      ...(safe.hostCode?{hostCode:safe.hostCode}:{}),...(safe.hostStage?{hostStage:safe.hostStage}:{}),
      ...(safe.diagnosticType?{diagnosticType:safe.diagnosticType}:{}),...(safe.responseType?{responseType:safe.responseType}:{})});rejectDone(safe);closeServer();
  }
  async function finishHostedConnection(sealed){
    // The host treats this exact capability/envelope as one idempotent import.
    // A lost reply must not make the owner repeat OAuth or create a second grant.
    return retryHostedRequest('/api/hiroshi/bootstrap/finish',sealed,220000);
  }
  async function retryHostedRequest(path,body,timeout=25000){
    for(let attempt=0;attempt<3;attempt++){
      active();
      try{return await jsonRequest(backend+path,'POST',body,{service:true,bearer:bootstrap.importToken,timeout});}
      catch(error){
        const retryable=error instanceof SetupError&&(error.code==='CONNECTION_INTERRUPTED'
          ||(error.code==='HOST_REQUEST_REJECTED'&&(error.httpStatus===429||error.httpStatus>=500)));
        if(!retryable||attempt===2)throw error;
        event({type:'retry',stage:phase,attempt:attempt+2});
        try{await delay(250*(attempt+1),undefined,{signal:abort.signal});}
        catch{active();throw error;}
      }
    }
  }
  async function publicIdentityRequest(url){
    if(![OPENAI.discovery,OPENAI.jwks].includes(url))throw fail('DESTINATION_REJECTED','The identity destination could not be verified.');
    for(let attempt=0;attempt<3;attempt++){
      active();
      try{return await jsonRequest(url,'GET');}
      catch(error){
        const retryable=error instanceof SetupError&&(error.code==='CONNECTION_INTERRUPTED'
          ||(error.code==='OPENAI_REQUEST_REJECTED'&&(error.httpStatus===429||error.httpStatus>=500)));
        if(!retryable||attempt===2)throw error;
        event({type:'retry',stage:phase,attempt:attempt+2});
        try{await delay(250*(attempt+1),undefined,{signal:abort.signal});}
        catch{active();throw error;}
      }
    }
  }
  async function jsonRequest(url,method,body,{service=false,bearer='',timeout=25000}={}){
    active();
    const target=new URL(url),isBackend=target.origin===backend;
    if((service||bearer)&&!isBackend)throw fail('DESTINATION_REJECTED','The credential destination could not be verified.');
    if(!isBackend&&![OPENAI.discovery,OPENAI.token,OPENAI.jwks].includes(url))throw fail('DESTINATION_REJECTED','The sign-in destination could not be verified.');
    const headers={Accept:'application/json'};
    if(service&&siteServiceToken)headers['OAI-Sites-Authorization']='Bearer '+siteServiceToken;
    if(bearer)headers.Authorization='Bearer '+bearer;
    const form=body instanceof URLSearchParams;
    if(body!==undefined)headers['Content-Type']=form?'application/x-www-form-urlencoded':'application/json';
    let response;
    try{response=await fetchImpl(url,{method,headers,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(timeout)]),
      ...(body===undefined?{}:{body:form?body.toString():JSON.stringify(body)})});}
    catch{throw fail(closed?'SETUP_CANCELLED':'CONNECTION_INTERRUPTED',closed?'Setup stopped. You can start again.':'A secure connection was interrupted. Please start setup again.');}
    active();
    if(!response.ok){
      const data=await readResponseJson(response,16384).catch(()=>null);
      const providerCode=typeof data?.error==='string'?data.error:dictionary(data?.error)?data.error.code:undefined;
      const requestId=response.headers.get('openai-request-id')||response.headers.get('x-request-id');
      throw fail(isBackend?'HOST_REQUEST_REJECTED':'OPENAI_REQUEST_REJECTED',isBackend?'The hosted connection did not accept this setup step.':'OpenAI did not accept this sign-in step.',response.status,{providerCode,requestId,
        ...(isBackend?{hostCode:providerCode,hostStage:data?.error?.stage,diagnosticType:data?.error?.diagnosticType,responseType:data?.error?.responseType}:{})});
    }
    return readResponseJson(response,TOKEN_LIMIT);
  }
  async function readResponseJson(response,limit){
    const reader=response.body?.getReader();let total=0;const chunks=[];
    if(!reader)throw fail('RESPONSE_INVALID','The connection returned an unreadable response.');
    try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw new Error();chunks.push(Buffer.from(value));}}
    catch{await reader.cancel().catch(()=>{});throw fail('RESPONSE_INVALID','The connection returned an unreadable response.');}
    finally{reader.releaseLock();}
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!dictionary(value))throw new Error();return value;}
    catch{throw fail('RESPONSE_INVALID','The connection returned an unreadable response.');}
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const local=`http://127.0.0.1:${server.address().port}`,redirectURI=local+'/auth/callback';
  const setupURL=new URL(backend+'/api/hiroshi/bootstrap/start');
  setupURL.search=new URLSearchParams({return_to:local+'/setup/callback',state:setupState,challenge:pkceChallenge(setupVerifier)}).toString();
  stage('WAITING_FOR_HOST');timer=setTimeout(()=>finishFailure(fail('SETUP_TIMED_OUT','Setup timed out. Start again when you are ready.')),timeoutMs);timer.unref();
  event({type:'open_browser',url:setupURL.href});
  return {setupURL:setupURL.href,redirectURI,completion,cancel:()=>finishFailure(fail('SETUP_CANCELLED','Setup stopped. You can start again when ready.'))};
}

async function readConfiguration(){
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  process.stdout.write('Ready for setup configuration on stdin (input is hidden).\n');
  let input='';
  return new Promise((resolve,reject)=>{
    const clean=()=>{process.stdin.off('data',onData);process.stdin.off('end',onEnd);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();process.stdin.unref?.();};
    const onEnd=()=>{clean();reject(fail('CONFIGURATION_INVALID','Setup configuration was not received.'));};
    const onData=chunk=>{
      input+=chunk.toString('utf8');if(input.includes('\u0003')||input.length>20000){clean();reject(fail('CONFIGURATION_INVALID','Setup configuration could not be accepted.'));return;}
      // Windows raw PTYs deliver Enter as CR; pipes commonly deliver LF.
      const end=input.search(/[\r\n]/);if(end<0)return;
      clean();try{const value=JSON.parse(input.slice(0,end));input='';if(!dictionary(value))throw new Error();resolve(value);}catch{reject(fail('CONFIGURATION_INVALID','Setup configuration could not be accepted.'));}
    };
    process.stdin.on('data',onData);process.stdin.once('end',onEnd);process.stdin.resume();
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==2)throw fail('CONFIGURATION_INVALID','This setup helper accepts configuration only through its protected input.');
    const configuration=await readConfiguration();
    const setup=await startChatGPTSetup({siteServiceToken:configuration.siteServiceToken||'',onEvent:event=>process.stdout.write(JSON.stringify(event)+'\n')});
    configuration.siteServiceToken='';
    process.once('SIGINT',()=>setup.cancel());process.once('SIGTERM',()=>setup.cancel());
    await setup.completion;
  }catch(error){
    if(!(error instanceof SetupError))process.stdout.write(JSON.stringify({type:'error',code:'SETUP_FAILED'})+'\n');
    else if(error.code==='CONFIGURATION_INVALID')process.stdout.write(JSON.stringify({type:'error',code:error.code})+'\n');
    process.exitCode=1;
  }
}
