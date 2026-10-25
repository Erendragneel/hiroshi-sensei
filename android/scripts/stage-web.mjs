import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(android, '../public');
const destination = path.join(android, 'app/build/hiroshiAssets');
await fs.mkdir(destination, {recursive:true});
await fs.cp(source, destination, {recursive:true});
const edit = async (file, transform) => {
  const target = path.join(destination, file);
  await fs.writeFile(target, transform(await fs.readFile(target,'utf8')));
};
await edit('index.html', text => text.replace('<script src="./app.js" type="module"></script>',
  '<script src="./native-bootstrap.js"></script>\n  <script src="./app.js" type="module"></script>')
  .replace('<meta charset="UTF-8">','<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'">')
  .replace('<link rel="manifest" href="./manifest.webmanifest">','<link rel="stylesheet" href="./native.css">')
  .replace('class="brand" href="./"','class="brand" href="#message-input"')
  .replace('</header>', `</header>
      <section class="native-account" aria-label="ChatGPT connection">
        <div><strong id="native-status">Connect your ChatGPT plan</strong><p id="native-detail">Strong cloud AI, with your PC off. Internet and an eligible ChatGPT plan are required. This uses your plan’s allowance.</p></div>
        <div class="native-actions"><button class="primary-button" id="native-connect" type="button">Continue with ChatGPT</button><label id="native-model-wrap" hidden>AI model <select id="native-model" aria-label="AI model"></select></label><a href="https://chatgpt.com/#settings/Usage">Manage usage ↗</a><button class="secondary-button" id="native-disconnect" type="button" hidden>Disconnect</button></div>
      </section>`));
await fs.writeFile(path.join(destination,'app-config.js'), `export const APP_CONFIG = Object.freeze({id:'hiroshi-sensei',name:'Hiroshi sensei',apiBase:'/api',aiAppURL:null,native:true});\n`);
await edit('app.js', text => {
  text=text.replace("data.provider==='local'?'local':'openai'", "data.provider==='local'?'local':data.provider==='chatgpt'?'chatgpt':'openai'")
    .replaceAll('Live AI · key configured','ChatGPT · connected')
    .replaceAll('Live AI key is configured','ChatGPT plan is connected')
    .replace('45000);let response','95000);let response')
    .replace('The secure key setup still needs to be completed before free conversation can reply.', 'Choose Continue with ChatGPT above to connect an eligible plan for conversation.')
    .replace('A server-side key is configured. You can try free conversation; account access and billing are checked when you send a message.', 'Conversation uses your selected ChatGPT model and plan allowance. Internet is required. Manage your limits with Manage usage above.')
    .replace('Scripted practice scenes are ready. On this computer, the game launcher also starts on-device AI after local setup. The hosted version needs a server-side API connection for live conversation.', 'Guided scenes and lessons are ready offline. Connect an eligible ChatGPT plan above for AI conversation and lesson help.')
    .replace('Start the local companion to ask for an AI explanation.', 'Connect your ChatGPT plan above to ask for an AI explanation.')
    .replace('The installed AI model stays on your computer.', 'Your ChatGPT connection is separate; use Disconnect above to remove it.')
    .replace("c.append(button('Install app','secondary-button',()=>installUI.show()));", "c.append(node('p','help-note','Hiroshi sensei is installed as its own Android app.'));");
  const exportStart=text.indexOf('function exportBackup(){'), exportEnd=text.indexOf('\nfunction ',exportStart+1);
  if(exportStart<0||exportEnd<0) throw new Error('Backup function boundary changed');
  text=text.slice(0,exportStart)+`function exportBackup(){window.HiroshiAndroid.saveBackup('hiroshi-sensei-backup-'+dayKey()+'.json',JSON.stringify(state,null,2));toast('Choose a private location for your conversations and notebook backup.');}\n`+text.slice(exportEnd+1);
  const start=text.indexOf('function showAbout(){'), end=text.indexOf('\nfunction ',start+1);
  if(start<0||end<0) throw new Error('About function boundary changed');
  text=text.slice(0,start)+`function showAbout(){const c=openModal('Your own Hiroshi sensei','PERSONAL ANDROID EDITION');for(const p of ['One familiar teacher for conversation, lessons, and homework. Guided scenes and coursework use authored material and work offline.','AI conversation uses the model selected from your ChatGPT account. It needs internet and uses your existing plan allowance; no separate API key is used by this app. Availability and limits depend on your account.','Hiroshi is a separate assistant with his own instructions. He does not automatically know our Codex conversations. Even a strong model can make mistakes.','Chats, progress, and notebook notes stay in this app on this phone. For AI replies, recent conversation, relevant notes, preferences, and lesson context are sent directly to OpenAI. Sign-in tokens are encrypted in Android storage and never given to this webpage.','Your keyboard can provide voice typing. The app has its own identity, icon, storage, and signing key.'])c.append(node('p','modal-intro',p));}\n`+text.slice(end+1);
  text=text.replace("if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});",'');
  // Refresh as soon as a pending conversation settles; never discard a sign-out event.
  text=text.replace('function setBusy(value){busy=value;',"function setBusy(value){busy=value;queueMicrotask(()=>window.dispatchEvent(new CustomEvent('hiroshi-busy-change',{detail:value}))); ");
  return text+`\nlet nativeConnectionPending=false;async function refreshNativeConnection(){if(busy){nativeConnectionPending=true;return;}nativeConnectionPending=false;await checkConnection();if(liveConfigured){state.preferences.mode='live';state.preferences.modeChosen=true;save();renderConversation();}}\nwindow.addEventListener('hiroshi-connection-change',refreshNativeConnection);window.addEventListener('hiroshi-busy-change',e=>{if(!e.detail&&nativeConnectionPending)refreshNativeConnection();});\n`;
});
await fs.copyFile(path.join(android,'web/native-bootstrap.js'),path.join(destination,'native-bootstrap.js'));
await fs.copyFile(path.join(android,'web/native.css'),path.join(destination,'native.css'));
console.log('Staged bundled Hiroshi UI with native-only ChatGPT connection.');
