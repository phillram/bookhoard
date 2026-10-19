// Runs inside the Libby web app. Adds a Download button to Libby's footer. When clicked, it goes through the loans and, for each, opens the loan's "How to open" screen
// (/shelf/loans/<cardId-titleId>/fulfill) and picks EPUB or PDF, which makes Libby hand the browser
// the download. The background script names the file. It never clicks Return, Renew, Suspend or
// Cancel.
(() => {
  if (window.__bookhoard) return;
  window.__bookhoard = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = el => (el?.innerText || el?.getAttribute?.('aria-label') || '').trim().replace(/\s+/g, ' ');
  const NEVER = /return|renew|suspend|cancel|delete|remove/i;
  let host = null;    // the progress panel's container
  let navBtn = null;  // our footer button
  // (both are kept out of every search below, so the run never clicks its own controls)

  // Is el what is actually on screen at its own centre (not hidden behind a sheet)?
  const onTop = el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  // Deepest on-screen Libby elements whose text matches re (long-text containers skipped cheaply).
  const topEls = re => {
    const hits = [...document.querySelectorAll('body *')]
      .filter(e => e !== host && !navBtn?.contains(e) && e.textContent.length < 300 && re.test(txt(e)) && onTop(e));
    return hits.filter(e => !hits.some(o => o !== e && e.contains(o)));
  };
  const waitTop = async (re, ms) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const el = topEls(re)[0];
      if (el) return el;
      await sleep(100);
    }
    return null;
  };
  const press = el => {
    const label = txt(el);
    if (NEVER.test(label)) throw new Error('refused to click ' + label);
    el.click();
    return label;
  };
  const go = path => {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  };
  const ask = msg => api.runtime.sendMessage(msg);

  const HOW_TO_OPEN = /^(EPUB|PDF)\b|^other options|^kindle\b|^libby\b/i;
  const COVER = /^[A-Za-z]+: '(.+)'\. Cover image/;

  // Loans on the shelf: id (cardId-titleId, from the card's Return link), title, card's main button.
  function readShelf() {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="/shelf/loans/"][href$="/return"]')) {
      const id = a.getAttribute('href').match(/\/shelf\/loans\/([^/]+)\/return$/)?.[1];
      if (!id || seen.has(id)) continue;
      let card = a;
      while (card.parentElement && !card.querySelector('.title-tile-actions')) card = card.parentElement;
      const cover = [...card.querySelectorAll('*')].find(e => COVER.test(txt(e)));
      seen.set(id, {
        id,
        titleId: id.split('-').pop(),
        title: cover ? txt(cover).match(COVER)[1] : id,
        main: txt(card.querySelector('.title-tile-actions')?.querySelector('button, [role=button], a')),
        card,
      });
    }
    return [...seen.values()];
  }

  async function shelfReady() {
    if (readShelf().length) return true;
    go('/shelf/loans');
    for (let i = 0; i < 100; i++) {
      if (readShelf().length) return true;
      await sleep(100);
    }
    return false;
  }

  // Fallback way to the How to open screen: the card's Manage Loan button, then Read With...
  async function viaMenu(loan) {
    const card = readShelf().find(l => l.id === loan.id)?.card;
    if (!card) return false;
    card.scrollIntoView({ block: 'center' });
    await sleep(300);
    const buttons = [...card.querySelectorAll('button, [role=button], a')].filter(e => /^manage loan$/i.test(txt(e)));
    if (!buttons.length) return false;
    buttons[buttons.length - 1].click();
    if (!(await waitTop(/^(return early|renew loan)$/i, 4000))) return false;
    const readWith = await waitTop(/^read with/i, 1500);
    if (!readWith) return false;
    press(readWith);
    return !!(await waitTop(HOW_TO_OPEN, 4000));
  }

  // ---- The footer button and the progress panel --------------------------------------------

  let ui = null;
  let running = false;
  let stopRequested = false;
  let results = [];
  let panelOpen = false;  // stays open after a run until closed

  // A download-tray icon drawn like Libby's own footer icons (64x64, same classes, so Libby's
  // light and dark themes color it the same way).
  const ICON = `
    <svg version="1.1" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="shibui-graphic icon"
         aria-hidden="true" data-decorative="">
      <g fill="none" stroke="none">
        <path class="color-shadow icon-solid" d="M17,40 L47,40 L47,45 C47,46.6568542 45.6568542,48 44,48 L20,48 C18.3431458,48 17,46.6568542 17,45 Z"
              fill="#000000" fill-opacity="0.08"></path>
        <path class="color-highlight icon-hollow" d="M16,37 L16,45 C16,47.209139 17.790861,49 20,49 L44,49 C46.209139,49 48,47.209139 48,45 L48,37"
              stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path class="icon-hollow" d="M32,14 L32,38 M23.5,29.5 L32,38 L40.5,29.5"
              stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </g>
    </svg>`;

  function buildNavButton(bar) {
    navBtn = document.createElement('button');
    navBtn.type = 'button';
    navBtn.className = 'app-footer-nav-bar-button-bookhoard nav-icon-selectable halo';
    navBtn.dataset.haloStates = 'focus';
    navBtn.setAttribute('aria-label', 'Download loans (bookhoard)');
    navBtn.innerHTML = ICON + '<span class="app-footer-nav-label"><span role="text">Download</span></span>';
    // Size the icon like its neighbours, whatever size Libby is using right now.
    const sibling = bar.querySelector('button svg');
    if (sibling) {
      const cs = getComputedStyle(sibling);
      Object.assign(navBtn.querySelector('svg').style, { width: cs.width, height: cs.height });
    }
    navBtn.addEventListener('click', () => {
      if (running) { stopRequested = true; render('Stopping after this book…'); }
      else run();
    });
    bar.append(navBtn);
  }

  function buildPanel() {
    host = document.createElement('div');
    // The host lets clicks through, so it never hides Libby's own buttons from the search above.
    host.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .panel { pointer-events: auto; width: min(420px, 92vw); max-height: 45vh; overflow-y: auto;
                 background: #1c1c1c; color: #e0e0e0; border: 1px solid #333; border-radius: 10px;
                 padding: 10px 12px; box-shadow: 0 4px 18px rgba(0,0,0,.5); }
        .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; }
        .status { color: #b8b8b8; }
        .close { background: none; border: 0; color: #b8b8b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .row { padding: 3px 0; border-top: 1px solid #333; font-size: 13px; }
        .ok { color: #8fcf9f; }
        .skip { color: #8a8a8a; }
      </style>
      <div class="panel" hidden>
        <div class="top"><span class="status"></span><button class="close" title="Close">&times;</button></div>
        <div class="list"></div>
      </div>`;
    document.body.append(host);
    ui = { panel: root.querySelector('.panel'), status: root.querySelector('.status'),
           list: root.querySelector('.list'), close: root.querySelector('.close') };
    ui.close.addEventListener('click', () => { panelOpen = false; results = []; render(''); });
  }

  function render(status) {
    if (!ui) return;
    ui.panel.hidden = !panelOpen;
    if (status) ui.status.textContent = status;
    ui.close.hidden = running;
    ui.list.replaceChildren(...results.slice().reverse().map(r => {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('strong');
      name.textContent = r.title;
      const what = document.createElement('span');
      what.className = r.ok ? 'ok' : 'skip';
      what.textContent = ' ' + r.result;
      row.append(name, what);
      return row;
    }));
    const label = navBtn?.querySelector('.app-footer-nav-label [role=text]');
    if (label) label.textContent = running ? 'Stop' : 'Download';
  }

  // Libby centres its five footer buttons around the Menu orb, so ours must not take up space in
  // the row: it sits one step to the right of the last button instead.
  function placeNavButton(bar) {
    const own = [...bar.children].filter(c => c !== navBtn);
    if (own.length < 2) return;
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    const last = own[own.length - 1];
    const step = last.offsetLeft - own[own.length - 2].offsetLeft;
    // On a narrow screen there is no room to the right, so sit just above the last button.
    const fits = bar.getBoundingClientRect().left + last.offsetLeft + step + last.offsetWidth <= innerWidth - 4;
    Object.assign(navBtn.style, {
      position: 'absolute',
      left: (fits ? last.offsetLeft + step : last.offsetLeft) + 'px',
      top: (fits ? last.offsetTop : last.offsetTop - last.offsetHeight - 8) + 'px',
      width: last.offsetWidth + 'px', height: last.offsetHeight + 'px',
    });
  }

  // Libby rebuilds its footer at times, so keep checking the button is still there.
  function syncUi() {
    if (!document.body) return;
    const bar = document.querySelector('.app-footer-nav-bar-controls');
    if (bar && !(navBtn && bar.contains(navBtn))) {
      buildNavButton(bar);
      render('');
    }
    if (navBtn && bar) placeNavButton(bar);
    if (!host) buildPanel();
    if (!host.isConnected) document.body.append(host);
    // Sit just above the footer's icons (and above our button when it is raised on narrow screens).
    const tops = [bar, navBtn].filter(Boolean).map(e => e.getBoundingClientRect().top).filter(t => t > 0);
    const top = tops.length ? Math.min(...tops) : innerHeight;
    host.style.bottom = Math.max(12, innerHeight - top + 10) + 'px';
  }

  // ---- The download run -----------------------------------------------------------------------

  async function run() {
    running = true;
    panelOpen = true;
    stopRequested = false;
    results = [];
    let downloaded = 0;
    const count = () => {
      const skipped = results.length - downloaded;
      return `${downloaded} downloaded, ${skipped} skipped`;
    };
    const note = (loan, result, ok = false) => {
      results.push({ title: loan.title, result, ok });
      if (ok) downloaded++;
      render(stopRequested ? `Stopping after this book… ${count()}` : `Working… ${count()}`);
    };
    render('Starting…');
    let ending = 'Done.';
    try {
      if (!(await shelfReady())) { ending = 'No loans found. Are you signed in?'; return; }
      const { settings = {} } = await api.storage.local.get('settings');
      const order = { 'epub-pdf': ['EPUB', 'PDF'], epub: ['EPUB'], 'pdf-epub': ['PDF', 'EPUB'] }[settings.formatOrder || 'epub-pdf'];
      const skipDownloaded = settings.skipDownloaded !== false;
      const includeLocked = !!settings.includeLocked;
      const max = Number(settings.limit) > 0 ? Number(settings.limit) : Infinity;
      const { done = [] } = await api.storage.local.get('done');
      const doneIds = new Set(done);
      const markDone = async loan => {
        doneIds.add(loan.id);
        await api.storage.local.set({ done: [...doneIds] });
      };
      const optionRe = name => new RegExp('^' + name + '\\b');

      for (const loan of readShelf()) {
        if (stopRequested) { ending = 'Stopped.'; break; }
        if (downloaded >= max) break;
        if (doneIds.has(loan.id)) continue;
        if (/audiobook/i.test(loan.main)) { note(loan, 'audiobook, skipped'); continue; }
        if (!/^read with/i.test(loan.main) && !includeLocked) { note(loan, `skipped: says "${loan.main}"`); continue; }
        if (skipDownloaded && (await ask({ type: 'downloaded', overdriveId: loan.titleId }))) {
          await markDone(loan);
          note(loan, 'already downloaded');
          continue;
        }
        const details = await ask({ type: 'media', overdriveId: loan.titleId });
        if (details?.formats?.length &&
            !details.formats.some(f => order.some(o => f.startsWith('ebook-' + o.toLowerCase())))) {
          note(loan, `no ${order.join(' or ')}, skipped`);
          continue;
        }
        try {
          go(`/shelf/loans/${loan.id}/fulfill`);
          let ready = await waitTop(HOW_TO_OPEN, 3000);
          if (!ready) {
            go('/shelf/loans');
            await sleep(800);
            ready = await viaMenu(loan);
          }
          if (!ready) { note(loan, "couldn't open, skipped"); continue; }

          if (!topEls(optionRe(order[0]))[0]) {
            const other = topEls(/^other options/i)[0];
            if (other) {
              press(other);
              await waitTop(new RegExp('^(' + order.join('|') + ')\\b'), 3000);
            }
          }
          const found = order.map(o => [o, topEls(optionRe(o))[0]]).find(([, el]) => el);
          if (!found) { note(loan, `no ${order.join(' or ')} offered, skipped`); continue; }
          const [format, button] = found;
          await ask({ type: 'expect', overdriveId: loan.titleId, format });
          press(button);

          // Libby shows a Done screen once the download has started; confirm if it asks first.
          let confirmed = false;
          let sawDone = false;
          for (const t = Date.now(); Date.now() - t < 10000;) {
            if (topEls(/^done$/i).length) { sawDone = true; break; }
            const c = !confirmed && topEls(/^(download|continue|confirm|ok|yes|got it)$/i)[0];
            if (c) { press(c); confirmed = true; }
            await sleep(100);
          }
          await markDone(loan);
          note(loan, sawDone ? format : `${format}? check your downloads`, true);
        } catch (err) {
          note(loan, 'error: ' + err.message);
        } finally {
          go('/shelf/loans');
          await sleep(300);
        }
      }
    } finally {
      running = false;
      render(results.length ? `${ending} ${count()}.` : ending);
      syncUi();
    }
  }

  syncUi();
  setInterval(syncUi, 500);
})();
