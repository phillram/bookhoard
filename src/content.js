// Runs inside the Libby web app. Adds a "Download loans" button to the bottom of the loans shelf.
// When clicked, it goes through the loans and, for each, opens the loan's "How to open" screen
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
  let host = null;  // the button's container, kept out of every search below

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
      .filter(e => e !== host && e.textContent.length < 300 && re.test(txt(e)) && onTop(e));
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

  // ---- The button and its progress list -------------------------------------------------------

  let ui = null;
  let running = false;
  let stopRequested = false;
  let results = [];

  function buildUi() {
    host = document.createElement('div');
    // The host lets clicks through, so it never hides Libby's own buttons from the search above.
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .box { pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
        button { border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer;
                 background: #e4407b; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
        button.quiet { background: #2b2f38; color: #e6e8ec; }
        button:disabled { opacity: .6; cursor: default; }
        .panel { width: 340px; max-height: 50vh; overflow-y: auto; background: #1f2229; color: #e6e8ec;
                 border: 1px solid #2e323b; border-radius: 10px; padding: 10px 12px;
                 box-shadow: 0 4px 18px rgba(0,0,0,.5); }
        .status { color: #9aa1ad; margin-bottom: 6px; }
        .row { padding: 3px 0; border-top: 1px solid #2e323b; font-size: 13px; }
        .ok { color: #5fbf7f; }
        .skip { color: #9aa1ad; }
        .buttons { display: flex; gap: 8px; }
      </style>
      <div class="box">
        <div class="panel" hidden><div class="status"></div><div class="list"></div></div>
        <div class="buttons">
          <button class="quiet stop" hidden>Stop</button>
          <button class="quiet close" hidden>Close</button>
          <button class="start">Download loans</button>
        </div>
      </div>`;
    document.body.append(host);
    const q = sel => root.querySelector(sel);
    ui = { panel: q('.panel'), status: q('.status'), list: q('.list'),
           start: q('.start'), stop: q('.stop'), close: q('.close') };
    ui.start.addEventListener('click', () => { if (!running) run(); });
    ui.stop.addEventListener('click', () => { stopRequested = true; ui.stop.disabled = true; });
    ui.close.addEventListener('click', () => { results = []; render(''); });
  }

  function render(status) {
    const shown = running || results.length > 0;
    ui.panel.hidden = !shown;
    ui.status.textContent = status;
    ui.start.disabled = running;
    ui.start.textContent = running ? 'Downloading…' : 'Download loans';
    ui.stop.hidden = !running;
    ui.close.hidden = running || !results.length;
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
  }

  const onLoansPage = () => /^\/shelf(\/loans)?\/?$/.test(location.pathname);

  function syncButton() {
    if (!document.body) return;
    if (!host) buildUi();
    if (!host.isConnected) document.body.append(host);
    // Stay visible while running: the run itself moves between loan screens.
    host.style.display = running || onLoansPage() ? '' : 'none';
  }

  // ---- The download run -----------------------------------------------------------------------

  async function run() {
    running = true;
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
      render(`Working… ${count()}`);
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
      render(`${ending} ${count()}.`);
      syncButton();
    }
  }

  // Libby is a single-page app, so watch for moving on to and away from the loans page.
  syncButton();
  setInterval(syncButton, 500);
})();
