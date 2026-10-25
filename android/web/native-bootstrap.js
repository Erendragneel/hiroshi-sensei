/* Only packaged in Android. The bridge receives requests, never OAuth credentials. */
(()=>{
  'use strict';
  const pending=new Map();let sequence=0;
  const native=window.HiroshiAndroid;
  const originalFetch=window.fetch.bind(window);
  function request(action,body={},signal){
    if(!native)return Promise.reject(new Error('Open the installed Hiroshi Android app.'));
    const id=String(++sequence);
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
      const abort=()=>{pending.delete(id);clearTimeout(timer);native.cancel(id);reject(new DOMException('Cancelled','AbortError'));};
      const timer=setTimeout(()=>{pending.delete(id);signal?.removeEventListener('abort',abort);native.cancel(id);reject(new Error('The connection took too long. Please try again.'));},action==='connect'?420000:96000);
      pending.set(id,{resolve,reject,timer,signal,abort});signal?.addEventListener('abort',abort,{once:true});
      native.request(id,action,JSON.stringify(body));
    });
  }
  window.__hiroshiReply=(id,status,data)=>{
    const item=pending.get(String(id));if(!item)return;
    pending.delete(String(id));clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);
    item.resolve({status,data});
  };
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
      const action=url.pathname.slice(5);if(!['status','chat'].includes(action))return new Response('{}',{status:404});
      const result=await request(action,options.body?JSON.parse(options.body):{},options.signal);
      return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}});
    }
    return originalFetch(input,options);
  };
  let refreshBusy=false,queuedNotify=false,lastConnection=null,connecting=false,chatBusy=false,nativeBusy=false,connectionError='';
  const element=id=>document.getElementById(id);
  function controls(){for(const id of ['native-connect','native-model','native-disconnect'])element(id).disabled=connecting||chatBusy||nativeBusy;}
  function showConnectionError(message){
    connectionError=typeof message==='string'&&message?message:'Hiroshi could not finish connecting. Try Continue with ChatGPT again.';
    element('native-status').textContent='Connection needs attention';
    element('native-detail').textContent=connectionError;
    element('native-detail').setAttribute('role','alert');
    element('native-copy-connection').hidden=false;
    element('native-connect').closest('.native-account')?.classList.add('is-error');
  }
  async function refresh(notify=false){
    queuedNotify=queuedNotify||notify;
    if(refreshBusy)return;refreshBusy=true;
    const shouldNotify=queuedNotify;queuedNotify=false;
    try{
      const result=await request('status');
      if(result.status>=400)throw new Error(result.data.error?.message||'Hiroshi could not check the connection.');
      const {data}=result;
      nativeBusy=data.busy===true;
      const connected=data.configured===true;
      const failed=Boolean(data.errorCode&&data.errorCode!=='NONE');
      if(connected)connectionError='';
      const hasError=!connected&&(failed||Boolean(connectionError));
      element('native-status').textContent=connected?'Using ChatGPT plan':hasError?'Connection needs attention':connecting||data.busy?'Connecting Hiroshi…':data.signedIn?'ChatGPT connection needs attention':'Connect your ChatGPT plan';
      element('native-detail').textContent=connected?'Your selected ChatGPT model replies over the internet. Your PC can stay off. Your plan’s normal limits apply.':failed?data.message:connectionError||data.message||'Sign in with an eligible ChatGPT plan. Guided lessons work without signing in. Model access and conversation must be checked after connecting.';
      element('native-detail').setAttribute('role',hasError?'alert':'status');
      element('native-copy-connection').hidden=!hasError;
      element('native-connect').closest('.native-account')?.classList.toggle('is-error',hasError);
      document.getElementById('native-connect').hidden=connected;
      document.getElementById('native-disconnect').hidden=!data.signedIn;
      controls();
      if(shouldNotify||lastConnection!==connected){lastConnection=connected;window.dispatchEvent(new Event('hiroshi-connection-change'));}
      if(connected){const models=await request('models');if(models.status>=400)throw new Error('Model access could not be refreshed. Reconnect to check your ChatGPT account.');const select=document.getElementById('native-model');select.replaceChildren();for(const m of models.data.models||[]){const o=document.createElement('option');o.value=m.slug;o.textContent=m.display_name;o.selected=m.slug===models.data.selected;select.append(o);}document.getElementById('native-model-wrap').hidden=false;}
      else document.getElementById('native-model-wrap').hidden=true;
    }finally{refreshBusy=false;if(queuedNotify){queuedNotify=false;queueMicrotask(()=>refresh(true).catch(()=>{}));}}
  }
  window.__hiroshiConnectionChanged=()=>refresh(true).catch(e=>showConnectionError(e.message));
  document.addEventListener('DOMContentLoaded',()=>{
    const connect=document.getElementById('native-connect');
    window.addEventListener('hiroshi-busy-change',e=>{chatBusy=Boolean(e.detail);controls();});
    element('native-copy-connection').addEventListener('click',()=>native?.copyConnectionDetails());
    connect.addEventListener('click',async()=>{
      connecting=true;connectionError='';controls();connect.textContent='Connecting…';
      element('native-status').textContent='Connecting Hiroshi…';
      element('native-detail').textContent='If your browser opens, finish sign-in and tap Open Hiroshi sensei. The app will finish connecting here.';
      element('native-detail').setAttribute('role','status');element('native-copy-connection').hidden=true;
      connect.closest('.native-account')?.classList.remove('is-error');
      try{const r=await request('connect');if(r.status>=400)throw new Error(r.data.error?.message||'ChatGPT sign-in could not complete.');
        let welcomeSeen=false;try{welcomeSeen=localStorage.getItem('hiroshi.chatgpt-welcome.v1')==='1';}catch{}
        if(r.data.configured&&!welcomeSeen){alert('You’re using your ChatGPT plan. Eligible requests use your plan’s allowance. Manage your usage in ChatGPT settings. Hiroshi does not automatically receive your past ChatGPT chats.');try{localStorage.setItem('hiroshi.chatgpt-welcome.v1','1');}catch{}}
      }catch(e){showConnectionError(e.message);}finally{connecting=false;controls();connect.textContent='Continue with ChatGPT';await refresh(true).catch(e=>showConnectionError(e.message));}
    });
    document.getElementById('native-disconnect').addEventListener('click',async()=>{if(!confirm('Disconnect ChatGPT from Hiroshi on this phone? Your saved game stays here.'))return;await request('disconnect');await refresh(true);});
    document.getElementById('native-model').addEventListener('change',async e=>{const r=await request('select-model',{model:e.target.value});if(r.status>=400)alert(r.data.error?.message||'The model could not be changed.');await refresh(true);});
    document.addEventListener('click',async e=>{const a=e.target.closest?.('a[download]');if(!a||!a.href.startsWith('blob:'))return;e.preventDefault();try{const blob=await originalFetch(a.href);const text=await blob.text();native.saveBackup(a.download,text);}catch{alert('The backup could not be saved.');}},true);
    refresh().catch(()=>showConnectionError('The app could not check its connection. Close and reopen Hiroshi.'));
  });
})();
