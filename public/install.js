// Browsers expose installation in different ways. Keep an accessible route to
// instructions even when a native install prompt is unavailable or dismissed.
import { APP_CONFIG } from './app-config.js?v=20261030-adaptive-teacher';
export const PHONE_APP_URL = APP_CONFIG.phoneURL;

export function createInstallUI({openModal, toast, getName = () => 'Hiroshi sensei', getConnection = () => ({configured:false, provider:'none'}), phoneURL = PHONE_APP_URL, onExportBackup = null}) {
  let deferredPrompt = null;
  let installedThisSession = false;
  let prompting = false;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const androidRelease = !APP_CONFIG.native ? APP_CONFIG.androidApp : null;
  // These are local signals, not a claim about copies installed from another
  // browser. Do not persist an installation guess alongside the learner's save.
  const appView = () => standalone.matches || navigator.standalone === true;
  const installed = () => APP_CONFIG.native === true || installedThisSession || appView();
  const getInstallState = () => ({native:APP_CONFIG.native === true, appView:appView(), installedThisSession, canPrompt:!installed() && !isLocal && deferredPrompt !== null});
  const getSettingsLabel = () => installed() ? 'Installation details' : 'Install app';
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if(className) el.className = className;
    if(text) el.textContent = text;
    return el;
  };
  const action = (label, className, handler) => {
    const button = element('button', className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  };
  function refresh() {
    // Installation belongs in Settings. Keep older shells quiet as well as the
    // current classroom; install events must never reintroduce these controls.
    for(const id of ['install-app-button', 'install-button']) {
      const el = document.getElementById(id);
      if(el) { el.hidden = true; el.style.display = 'none'; el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); }
    }
    return getInstallState();
  }
  async function promptInstall() {
    if(prompting) return;
    if(!deferredPrompt) { show(); return; }
    prompting = true;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if(choice.outcome === 'accepted') toast(`${getName()} is being added to your apps.`);
      else toast('You can install later from Settings or your browser menu.');
    } catch {
      show();
    } finally {
      prompting = false;
      refresh();
    }
  }
  function instructions(title, steps) {
    const section = element('section', 'install-instructions');
    section.append(element('h3', '', title));
    const list = element('ol');
    for(const step of steps) list.append(element('li', '', step));
    section.append(list);
    return section;
  }
  function androidDownload(label = 'Download optional Android APK') {
    const link = element('a', 'primary-button install-android-download', label);
    link.href = androidRelease.downloadURL;
    link.target = '_blank'; link.rel = 'noopener';
    return link;
  }
  function androidCard() {
    const card = element('section', 'install-phone-card android-install-card');
    card.append(element('h3', '', `Android ${androidRelease.version} · Optional ChatGPT preview`), element('p', '', 'This separate Android preview includes Continue with ChatGPT. It is not required to install the GitHub web game.'));
    card.append(androidDownload(), action('Copy APK link', 'secondary-button', async () => {
      try { await navigator.clipboard.writeText(androidRelease.downloadURL); toast('Optional APK link copied.'); }
      catch { toast('Use the optional Android APK link above.'); }
    }));
    return card;
  }
  function showAndroidUpdate() {
    if(!androidRelease) { showWebInstall(); return; }
    const container = openModal('Optional Android preview', 'HIROSHI SENSEI · ADVANCED');
    container.append(element('p', 'modal-intro', 'The GitHub web game installs from your browser. This optional APK is a separate preview of the Android ChatGPT connection.'));
    container.append(androidCard());
    container.append(instructions('Install, then connect', [
      'Download and open the .apk file, then choose Install or Update. Android may ask you to allow installation from your browser or Files app.',
      'Open Hiroshi sensei from your Android apps after installation.',
      'Tap Continue with ChatGPT near the top of the game, finish sign-in and plan approval in your browser, then return to Hiroshi.'
    ]));
    container.append(element('p', 'help-note', `Version ${androidRelease.version} includes the Continue with ChatGPT button. It is a preview: your phone’s sign-in, account eligibility, model access, and actual replies still need verification.`));
    container.append(element('p', 'help-note', 'AI replies need internet and an eligible ChatGPT plan. Your plan’s normal limits apply; your PC can stay off.'));
    const progress = element('section', 'install-availability');
    progress.append(element('h3', '', 'Keep your progress'), element('p', '', 'Your saved work stays in this web app. Before installing, export a backup if you want to bring your chats, lessons, and homework to Android.'));
    if(typeof onExportBackup === 'function') progress.append(action('Export backup before installing', 'secondary-button', onExportBackup));
    progress.append(element('p', '', 'In the Android app, open Settings → Restore a companion backup, choose your file, and review it before restoring. Restoring replaces that Android app’s saved work; nothing transfers automatically.'));
    container.append(progress);
    const notes = element('a', 'install-phone-link', 'GitHub release notes and installer files ↗');
    notes.href = androidRelease.releaseURL; notes.target = '_blank'; notes.rel = 'noopener';
    container.append(notes);
  }
  function show() {
    showWebInstall();
  }
  function showWebInstall() {
    // A prompt must run directly in a user gesture. Local visits instead show
    // the phone URL first, since localhost on a phone refers to the phone itself.
    if(deferredPrompt && !isLocal && !installed()) { void promptInstall(); return; }
    const name = getName();
    const container = openModal(installed() ? 'App installation' : `Install ${name}`, 'YOUR TEACHER · ON YOUR HOME SCREEN');
    const hero = element('div', 'install-hero');
    const image = element('img', 'install-app-icon');
    image.src = './assets/icon-180.png'; image.width = 64; image.height = 64; image.alt = '';
    const intro = element('div');
    const installationNote = APP_CONFIG.native === true
      ? 'You are using the Android app. Its installation is separate from the GitHub browser game.'
      : appView() ? 'You are already using the app view. There is nothing else to install here.'
      : installedThisSession ? `Your browser confirmed installation during this visit. Open your existing ${name} icon to return to your lessons.`
      : 'Add your tutor to your home screen and open it like an app.';
    intro.append(element('h3', '', installed() ? 'Your classroom is ready' : 'One tap away, every day'), element('p', '', installationNote));
    hero.append(image, intro); container.append(hero);

    if(isLocal) {
      const phone = element('section', 'install-phone-card');
      phone.append(element('h3', '', 'Start here on your phone'), element('p', '', 'Open this game link in your phone’s browser.'));
      const link = element('a', 'install-phone-link', phoneURL);
      link.href = phoneURL; link.target = '_blank'; link.rel = 'noopener';
      phone.append(link);
      const copy = action('Copy phone link', 'secondary-button', async () => {
        try { await navigator.clipboard.writeText(phoneURL); toast('Phone link copied. Open it on your phone to install.'); }
        catch { toast('Copy the web link above, then open it on your phone.'); }
      });
      phone.append(copy, element('p', 'install-small', 'The 127.0.0.1 address works only on this computer. Use the web link on your phone.'));
      container.append(phone);
    }
    if(!installed()) {
      if(deferredPrompt) container.append(action('Install web app on this device', 'primary-button install-native-action', () => { void promptInstall(); }));
      const appleSteps = ['Open the web link in Safari on your iPhone or iPad.', 'Tap Share (the square with the upward arrow).', 'Choose “Add to Home Screen”, then tap “Add”.'];
      const androidSteps = ['Open the web link in Chrome on your Android phone.', 'Tap the browser menu (⋮).', 'Choose “Install app” or “Add to Home screen”, then follow the prompt.'];
      const desktopSteps = ['Open the web link in Chrome or Edge.', 'Use the install icon in the address bar, or choose “Install app” in the browser menu.'];
      if(isAppleMobile) container.append(instructions('On your iPhone or iPad', appleSteps));
      else if(isAndroid) container.append(instructions('On your Android phone', androidSteps));
      else {
        container.append(instructions('iPhone · Safari', appleSteps), instructions('Android · Chrome', androidSteps));
        const details = element('details', 'install-desktop');
        details.append(element('summary', '', 'Install on this computer'), instructions('Chrome or Edge', desktopSteps));
        container.append(details);
      }
      container.append(element('p', 'install-small', 'If this page is inside another app, open the link in your regular browser first. Your browser controls whether an install prompt is available.'));
      container.append(element('p', 'install-small', 'Already added Hiroshi? Open the app icon you already have. This page cannot reliably check installations from another browser.'));
    }
    const note = element('section', 'install-availability');
    note.append(element('h3', '', 'What comes with you'));
    note.append(element('p', '', 'Guided scenes, lessons, homework, and progress are available offline after a complete online visit. Each device keeps its own progress; use Settings → Export backup to move your saved work.'));
    const connection = getConnection();
    note.append(element('p', '', connection.configured && connection.provider !== 'local' ? 'AI conversation and lesson explanations need an internet connection.' : 'Guided practice is ready now. Live AI availability is shown in Settings; installing this web app does not sign in to ChatGPT.'));
    container.append(note);
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = installed() ? null : event; refresh(); });
  window.addEventListener('appinstalled', () => { installedThisSession = true; deferredPrompt = null; refresh(); toast(`${getName()} is now an app.`); });
  standalone.addEventListener?.('change', refresh);
  refresh();
  return {show, showAndroidUpdate, refresh, getSettingsLabel, getInstallState};
}
