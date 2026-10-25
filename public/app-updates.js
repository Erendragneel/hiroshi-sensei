// Updating the web shell must never discard an unfinished conversation.
// Android manages its own installed package and does not register this worker.
export function startWebUpdates({native = false, canReload = () => true, toast = () => {}} = {}, environment = globalThis) {
  const noop = {ready:Promise.resolve(false), check:async () => false, dismiss() {}, stop() {}};
  if(native) return noop;
  const win = environment.window || environment;
  const nav = environment.navigator || win.navigator;
  const doc = environment.document || win.document;
  const location = environment.location || win.location;
  if(!nav?.serviceWorker || !doc || !location || location.protocol === 'file:') return noop;

  const workers = nav.serviceWorker;
  const now = () => (environment.Date || Date).now();
  let controller = workers.controller || null;
  let registration = null;
  let lastCheck = -Infinity;
  let checking = false;
  let stopped = false;
  let notice = null;
  let detail = null;
  const listeners = [];
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };

  function dismiss() { if(notice) notice.hidden = true; }
  function showNotice() {
    if(stopped) return;
    if(!notice) {
      notice = doc.createElement('section');
      notice.className = 'web-update-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.setAttribute('aria-label', 'Web game update');
      const title = doc.createElement('strong');
      title.textContent = 'New web version ready';
      detail = doc.createElement('p');
      const actions = doc.createElement('div');
      actions.className = 'web-update-actions';
      const refresh = doc.createElement('button');
      refresh.type = 'button'; refresh.className = 'primary-button';
      refresh.textContent = 'Refresh web game';
      refresh.addEventListener('click', () => {
        let safe = false;
        try { safe = canReload() === true; } catch { /* Preserve the page if its state cannot be checked. */ }
        if(!safe) {
          const message = 'Finish the current reply, send or copy your unfinished message, and close any open dialog before refreshing.';
          detail.textContent = message;
          toast(message);
          return;
        }
        location.reload();
      });
      const later = doc.createElement('button');
      later.type = 'button'; later.className = 'secondary-button';
      later.textContent = 'Later'; later.addEventListener('click', dismiss);
      actions.append(refresh, later);
      notice.append(title, detail, actions);
      doc.body.append(notice);
    }
    detail.textContent = 'Refresh when you are ready to load the updated web game. Your saved progress stays on this device.';
    notice.hidden = false;
  }

  function changedController() {
    const next = workers.controller || null;
    if(stopped || !next || next === controller) return;
    const alreadyControlled = controller !== null;
    controller = next;
    if(alreadyControlled) showNotice();
  }

  async function check({force = false} = {}) {
    if(stopped || !registration || checking || (!force && now() - lastCheck < 60000)) return false;
    checking = true; lastCheck = now();
    try { await registration.update(); return !stopped; }
    catch { return false; } // Offline or rejected updates leave the current game usable.
    finally { checking = false; }
  }
  listen(workers, 'controllerchange', changedController);
  listen(win, 'online', () => { void check(); });
  listen(win, 'focus', () => { void check(); });
  listen(doc, 'visibilitychange', () => { if(doc.visibilityState === 'visible') void check(); });

  let ready;
  try {
    ready = Promise.resolve(workers.register('./sw.js', {updateViaCache:'none'})).then(async value => {
      if(stopped) return false;
      registration = value;
      await check();
      return true;
    }).catch(() => false);
  } catch { ready = Promise.resolve(false); }
  return {
    ready, check, dismiss,
    stop() {
      stopped = true;
      for(const remove of listeners) remove();
      notice?.remove();
    },
  };
}
