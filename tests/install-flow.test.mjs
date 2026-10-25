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

test('installed Android web app offers its actual ChatGPT APK instead of another web installation',()=>{
  const h=harness({installed:true});let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  h.ui.show();
  assert.equal(prompts,0);assert.equal(h.modals[0].title,'Get ChatGPT update');
  assert.equal(h.elements.get('install-app-label').textContent,'Update app');
  const links=descendants(h.modals[0].content).filter(n=>n.tagName==='a');
  assert.equal(links.find(n=>n.textContent==='Download Android update').href,release.downloadURL);
  assert.equal(links.find(n=>n.textContent.includes('GitHub release notes')).href,release.releaseURL);
  assert.match(text(h.modals[0].content),/Tap Continue with ChatGPT/);
  assert.match(text(h.modals[0].content),/cannot turn into that Android app automatically/);
});

test('Android update route takes priority even before the web app is installed',()=>{
  const h=harness();let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  h.ui.show();assert.equal(prompts,0);assert.equal(h.modals[0].title,'Get ChatGPT update');
});

test('progress export is explicit and opening an update never clears or transfers saved data',()=>{
  const h=harness({installed:true});h.ui.showAndroidUpdate();
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

test('desktop browser retains its normal PWA prompt and offers a phone link in manual instructions',async()=>{
  const h=harness({android:false});let prompts=0;
  h.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
  h.ui.show();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prompts,1);assert.equal(h.modals.length,0);
  h.ui.show();
  assert.ok(descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  const copy=descendants(h.modals[0].content).find(n=>n.textContent==='Copy Android update link');
  await copy.click();assert.deepEqual(h.copies,[release.downloadURL]);
});

test('Apple web installation does not advertise an Android installer as an iPhone update',()=>{
  const h=harness({android:false,apple:true});h.ui.show();
  assert.ok(!descendants(h.modals[0].content).some(n=>n.href===release.downloadURL));
  assert.match(text(h.modals[0].content),/Continue with ChatGPT is currently in the Android preview/);
  assert.match(text(h.modals[0].content),/On your iPhone or iPad/);
});
