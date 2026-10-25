import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../public/install.js',import.meta.url),'utf8'))
  .replace(/^import .*?;\r?\n/m,'').replaceAll('export ','');
const release=Object.freeze({version:'0.2.1',downloadURL:'https://github.com/Erendragneel/hiroshi-sensei/releases/download/v0.2.1-android-preview.2/hiroshi-sensei-0.2.1.apk',releaseURL:'https://github.com/Erendragneel/hiroshi-sensei/releases/tag/v0.2.1-android-preview.2'});
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';this.classList={toggle(){}};}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,callback){this.listeners.set(name,callback);}
  click(){return this.listeners.get('click')?.();}
}
const descendants=root=>[root,...root.children.flatMap(node=>node instanceof Element?descendants(node):[])];
const text=root=>descendants(root).map(node=>node.textContent).join(' ');
function harness({android=true,installed=false,native=false,apple=false}={}){
  const elements=new Map(['install-app-label','install-label','install-app-button','install-button'].map(id=>[id,new Element('button')]));
  const events=new Map(),modals=[],toasts=[],copies=[],storageWrites=[];let exports=0;
  const context=vm.createContext({
    APP_CONFIG:{name:'Hiroshi sensei',phoneURL:'https://erendragneel.github.io/hiroshi-sensei/',androidApp:release,native},
    window:{matchMedia:()=>({matches:installed,addEventListener(){}}),addEventListener:(name,callback)=>events.set(name,callback)},
    document:{createElement:tag=>new Element(tag),getElementById:id=>elements.get(id)},
    location:{hostname:native?'appassets.androidplatform.net':'erendragneel.github.io'},
    navigator:{userAgent:apple?'iPhone Safari':android?'Mozilla/5.0 Android Chrome':'Desktop Chrome',platform:'',maxTouchPoints:0,clipboard:{writeText:async value=>copies.push(value)}},
    localStorage:{setItem:(...args)=>storageWrites.push(args),removeItem:(...args)=>storageWrites.push(args),clear:()=>storageWrites.push('clear')},
  });
  vm.runInContext(source,context,{filename:'public/install.js'});
  const ui=context.createInstallUI({openModal:(title,eyebrow)=>{const content=new Element('section');modals.push({title,eyebrow,content});return content;},toast:message=>toasts.push(message),onExportBackup:()=>{exports++;}});
  return {ui,elements,events,modals,toasts,copies,storageWrites,get exports(){return exports;}};
}

test('installed Android web app stays installed without promoting an APK or repeating the install prompt',()=>{
  const h=harness({installed:true});let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  h.ui.show();
  assert.equal(prompts,0);assert.equal(h.modals[0].title,'Hiroshi sensei is installed');
  assert.equal(h.elements.get('install-app-label').textContent,'App installed');
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.match(text(h.modals[0].content),/Open your home-screen icon/);
  assert.deepEqual(h.storageWrites,[]);
});

test('Android Install app invokes the browser PWA prompt instead of an APK download',async()=>{
  const h=harness();let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  assert.equal(h.elements.get('install-app-label').textContent,'Install app');
  h.ui.show();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prompts,1);assert.equal(h.modals.length,0);
  assert.deepEqual(h.copies,[]);assert.deepEqual(h.storageWrites,[]);
  h.events.get('appinstalled')();
  assert.equal(h.elements.get('install-app-label').textContent,'App installed');
});

test('Android browsers without a prompt show browser installation steps and no APK promotion',()=>{
  const h=harness();h.ui.show();
  assert.equal(h.modals[0].title,'Install Hiroshi sensei');
  assert.match(text(h.modals[0].content),/Choose “Install app” or “Add to Home screen”/);
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.deepEqual(h.storageWrites,[]);
});

test('optional Android preview is explicit and never exports, transfers or resets progress automatically',async()=>{
  const h=harness({installed:true});h.ui.showAndroidUpdate();
  assert.equal(h.modals[0].title,'Optional Android preview');
  assert.match(text(h.modals[0].content),/not required to install the GitHub web game/);
  assert.match(text(h.modals[0].content),/actual replies still need verification/);
  const links=descendants(h.modals[0].content).filter(n=>n.tagName==='a');
  assert.equal(links.find(n=>n.textContent==='Download optional Android APK').href,release.downloadURL);
  assert.equal(links.find(n=>n.textContent.includes('GitHub release notes')).href,release.releaseURL);
  const copy=descendants(h.modals[0].content).find(n=>n.textContent==='Copy APK link');
  assert.deepEqual(h.copies,[]);await copy.click();assert.deepEqual(h.copies,[release.downloadURL]);
  assert.equal(h.exports,0);assert.deepEqual(h.storageWrites,[]);
  const exportButton=descendants(h.modals[0].content).find(n=>n.textContent==='Export backup before installing');
  exportButton.click();assert.equal(h.exports,1);assert.deepEqual(h.storageWrites,[]);
  assert.match(text(h.modals[0].content),/Restoring replaces that Android app’s saved work/);
  assert.match(text(h.modals[0].content),/nothing transfers automatically/);
});

test('native Android app does not offer another APK installation',()=>{
  const h=harness({native:true});h.ui.showAndroidUpdate();
  assert.equal(h.modals.length,1);
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.notEqual(h.elements.get('install-app-label').textContent,'Update app');
});

test('desktop browser retains its normal PWA prompt and browser installation instructions',async()=>{
  const h=harness({android:false});let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  h.ui.show();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prompts,1);assert.equal(h.modals.length,0);
  h.ui.show();
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.match(text(h.modals[0].content),/Chrome or Edge/);
  assert.match(text(h.modals[0].content),/Android · Chrome/);
});

test('Apple web installation does not advertise an Android installer as an iPhone update',()=>{
  const h=harness({android:false,apple:true});h.ui.show();
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.match(text(h.modals[0].content),/installing this web app does not sign in to ChatGPT/);
  assert.match(text(h.modals[0].content),/On your iPhone or iPad/);
});
