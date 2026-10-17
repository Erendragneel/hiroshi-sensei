// Browsers expose installation in different ways. Keep an accessible route to
// instructions even when a native install prompt is unavailable or dismissed.
export const PHONE_APP_URL = 'https://koa-personal-companion.elijio-villa.chatgpt.site/play/';

export function createInstallUI({openModal, toast, getName = () => 'Hiroshi sensei', getConnection = () => ({configured:false, provider:'none'}), phoneURL = PHONE_APP_URL}) {
  let deferredPrompt = null;
  let installedThisSession = false;
  let prompting = false;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const installed = () => installedThisSession || standalone.matches || navigator.standalone === true;
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
    const label = installed() ? 'App installed' : 'Install app';
    for(const id of ['install-app-label', 'install-label']) {
      const el = document.getElementById(id);
      if(el) el.textContent = label;
    }
    for(const id of ['install-app-button', 'install-button']) {
      const el = document.getElementById(id);
      if(el) { el.setAttribute('aria-label', label); el.classList.toggle('is-installed', installed()); }
    }
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
      else toast('You can install later from this button or your browser menu.');
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
  function show() {
    // A prompt must run directly in a user gesture. Local visits instead show
    // the phone URL first, since localhost on a phone refers to the phone itself.
    if(deferredPrompt && !isLocal && !installed()) { void promptInstall(); return; }
    const name = getName();
    const container = openModal(installed() ? `${name} is installed` : `Install ${name}`, 'YOUR TEACHER · ON YOUR HOME SCREEN');
    const hero = element('div', 'install-hero');
    const image = element('img', 'install-app-icon');
    image.src = './assets/icon-180.png'; image.width = 64; image.height = 64; image.alt = '';
    const intro = element('div');
    intro.append(element('h3', '', installed() ? 'Your own little learning space' : 'One tap away, every day'), element('p', '', installed() ? 'Open your home-screen icon to return to your lessons and conversations.' : 'Add your companion to your home screen and open it like an app.'));
    hero.append(image, intro); container.append(hero);

    if(isLocal) {
      const phone = element('section', 'install-phone-card');
      phone.append(element('h3', '', 'Start here on your phone'), element('p', '', 'Open this private web link in your phone’s browser. Sign in with your account if asked.'));
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
      if(deferredPrompt) container.append(action('Install on this device', 'primary-button install-native-action', () => { void promptInstall(); }));
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
    }
    const note = element('section', 'install-availability');
    note.append(element('h3', '', 'What comes with you'));
    note.append(element('p', '', 'Guided scenes, lessons, homework, and progress are available offline after a complete online visit. Each device keeps its own progress; use Settings → Export backup to move your saved work.'));
    const connection = getConnection();
    note.append(element('p', '', connection.configured && connection.provider !== 'local' ? 'AI conversation and lesson explanations need an internet connection.' : 'The computer’s on-device AI stays on this computer. The phone app needs a hosted AI connection for free conversation and AI explanations; guided scenes and coursework are ready to use.'));
    container.append(note);
  }
  for(const id of ['install-app-button', 'install-button']) document.getElementById(id)?.addEventListener('click', show);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; refresh(); });
  window.addEventListener('appinstalled', () => { installedThisSession = true; deferredPrompt = null; refresh(); toast(`${getName()} is now an app.`); });
  standalone.addEventListener?.('change', refresh);
  refresh();
  return {show, refresh};
}
