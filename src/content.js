// Runs inside the Libby web app. Adds two buttons to Libby's footer.
// Download goes through the loans and, for each, opens the loan's "How to open" screen and picks
// EPUB or PDF, which makes Libby hand the browser the download. The background script names the
// file. It never clicks Return, Renew, Suspend or Cancel.
// Return asks first, then returns loans through each one's Manage Loan sheet. Return is the only
// button it clicks that changes a loan.
(() => {
  if (window.__bookhoard) return;
  window.__bookhoard = true;

  const api = globalThis.browser ?? globalThis.chrome;
  // During a book's steps, Stop takes effect at the next wait (within a fraction of a second).
  class StopNow extends Error {}
  let interruptible = false;
  const sleep = ms => new Promise((resolve, reject) => setTimeout(
    () => (interruptible && stopRequested ? reject(new StopNow('stopped')) : resolve()), ms));
  const txt = el => (el?.innerText || el?.getAttribute?.('aria-label') || '').trim().replace(/\s+/g, ' ');
  const NEVER = /return|renew|suspend|cancel|delete|remove|passkey|sign out|log out|forget|unlink/i;
  // When returning loans, only buttons that say Return (early) may be clicked to change a loan.
  const RETURN_BUTTON = /^return( early| now| (this )?(loan|title|book))?!?$/i;
  // Libby's sign-in, backup and passkey screens live under /interview. bookhoard never acts there.
  const onAccountScreen = () => location.pathname.startsWith('/interview');
  let host = null;    // the progress panel's container
  let navBtn = null;  // our footer Download button
  let retBtn = null;  // our footer Return button
  // (all are kept out of every search below, so a run never clicks its own controls)
  const ours = e => e === host || !!navBtn?.contains(e) || !!retBtn?.contains(e);

  // Is el what is actually on screen at its own centre (not hidden behind a sheet)?
  const onTop = el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // Look through bookhoard's own panel and footer button: they must not count as covering Libby.
    const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      .find(e => !ours(e));
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  // Deepest on-screen Libby elements whose text matches re (long-text containers skipped cheaply).
  const topEls = re => {
    const hits = [...document.querySelectorAll('body *')]
      .filter(e => !ours(e) && e.textContent.length < 300 && re.test(txt(e)) && onTop(e));
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
    if (onAccountScreen()) throw new Error('on a Libby account screen; not clicking ' + label);
    if (NEVER.test(label)) throw new Error('refused to click ' + label);
    el.click();
    return label;
  };
  const pressReturn = el => {
    const label = txt(el);
    if (onAccountScreen()) throw new Error('on a Libby account screen; not clicking ' + label);
    if (!RETURN_BUTTON.test(label)) throw new Error('refused to click ' + label);
    el.click();
    return label;
  };
  const deepestOf = list => list.filter(e => !list.some(o => o !== e && e.contains(o)));
  const ask = msg => api.runtime.sendMessage(msg);

  // Logging. Errors always go to the console; with Debug on (options page) every step does too.
  // Everything is also kept for the panel's Copy log button.
  let debug = false;
  const trace = [];
  let saveTimer = 0;
  const keep = line => {
    trace.push(new Date().toISOString().slice(11, 19) + ' ' + line);
    if (trace.length > 3000) trace.shift();
    // Saved as it goes (at most once a second): Libby reloads the page after "too many requests",
    // and the log from before that is what explains it.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.storage.local.set({ lastLog: { at: Date.now(), results, trace: trace.slice(-1000) } }).catch(() => {});
    }, 1000);
  };
  let earlier = null;  // the log from before Libby reloaded the page mid-run, for Copy log
  const show = v => (v instanceof Error ? v.stack || v.message : typeof v === 'string' ? v : JSON.stringify(v));
  const log = (...args) => {
    keep(args.map(show).join(' '));
    if (debug) console.log('[bookhoard]', ...args);
  };
  const fail = (...args) => {
    keep('ERROR ' + args.map(show).join(' '));
    console.error('[bookhoard]', ...args);
  };
  api.storage.local.get('settings').then(({ settings }) => { debug = !!settings?.debug; });
  api.storage.onChanged.addListener(changes => {
    if (changes.settings) debug = !!changes.settings.newValue?.debug;
  });
  // What is on screen right now (for the log when a step fails).
  const onScreen = () => [...new Set([...document.querySelectorAll('button, a, [role=button]')]
    .filter(e => !ours(e) && onTop(e)).map(txt).filter(Boolean))].slice(0, 15);

  const HOW_TO_OPEN = /^(EPUB|PDF)\b|^other options|^kindle\b.*devices|^libby (on this device|open the book)/i;
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

  // Libby is driven only through its own buttons, as a person would. Changing the address
  // directly makes Libby reload, and in some browsers send you to its "Back Up Your Data" screen.

  const sheetOpen = () => topEls(/^(return early|renew loan)$/i).length > 0;
  // Libby keeps the shelf's cards in the page behind other screens, so the address is what tells
  // us the shelf is really showing: /shelf or /shelf/loans (How to open is .../fulfill).
  const onShelfPage = () => /^\/shelf(\/loans)?\/?$/.test(location.pathname) && !sheetOpen();
  const onShelf = () => onShelfPage() && readShelf().length > 0;

  // Up to 15 seconds: after a full page load Libby can take a while to show the shelf.
  async function shelfReady() {
    for (let i = 0; i < 150; i++) {
      if (readShelf().length) return true;
      await sleep(100);
    }
    return false;
  }

  const shelfPath = () => /^\/shelf(\/loans)?\/?$/.test(location.pathname);

  // Libby's own Shelf button in the footer. It reaches the shelf from any page that shows the
  // footer. (Changing the address instead would reload Libby.)
  async function shelfFromFooter() {
    const button = document.querySelector('.app-footer-nav-bar-button-shelf') ||
      [...document.querySelectorAll('.app-footer-nav-bar-controls button')].find(b => !ours(b) && /^shelf$/i.test(txt(b)));
    if (!button) return false;
    button.click();
    for (let w = 0; w < 50 && !shelfPath(); w++) await sleep(100);
    return shelfPath();
  }

  // Get the shelf showing. Anywhere else, the footer's Shelf button. On the shelf with a sheet open
  // (which the Shelf button doesn't close), or if the button didn't work: Done, the sheet's Close,
  // Back, Escape. After returning the last loan the shelf is empty, which also counts.
  // Libby's /interview screens (sign-in, backup, passkeys, and its menu) are only ever left by the
  // footer, and only when a run starts there (fromAnywhere). Mid-run, landing on one stops the run.
  async function backToShelf({ emptyOk = false, fromAnywhere = false } = {}) {
    const there = emptyOk ? onShelfPage : onShelf;
    for (let k = 0; k < 6; k++) {
      if (there()) return true;
      if (onAccountScreen()) {
        if (!fromAnywhere || !(await shelfFromFooter())) return false;
        continue;
      }
      if (!shelfPath() && (await shelfFromFooter())) {
        for (let w = 0; w < 30 && !there(); w++) await sleep(100);
        continue;
      }
      const close = [/^done$/i, /^(dismiss dialog|close)$/i, /^back$/i].map(re => topEls(re)[0]).find(Boolean);
      if (close) press(close);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      for (let w = 0; w < 30 && !there(); w++) await sleep(100);
    }
    return there();
  }

  // The open Manage Loan sheet labels its book "Book: <title>, by <author>" (shelf cards say
  // "Book: '<title>'. Cover image."), so this tells us the sheet is for the loan we clicked.
  function sheetIsFor(loan) {
    const esc = loan.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = new RegExp(`^[A-Za-z]+: ${esc}, by `);
    return [...document.querySelectorAll('body *')].some(e => label.test(txt(e)) && onTop(e));
  }

  // Opens the loan's Manage Loan sheet. Returns null on success, or why not.
  async function openManageLoan(loan) {
    if (!onShelf() && !(await backToShelf())) return 'could not get back to the shelf first';
    // Every Manage Loan button for this loan: /shelf/loans shows its own list while Libby keeps
    // the /shelf cards hidden behind it, so a loan can be in the page twice. Use the one on screen.
    const buttons = () => [...document.querySelectorAll(`a[href$="/shelf/loans/${CSS.escape(loan.id)}/return"]`)]
      .map(a => {
        let card = a;
        while (card.parentElement && !card.querySelector('.title-tile-actions')) card = card.parentElement;
        return deepestOf([...card.querySelectorAll('button, a, [role=button]')].filter(e => /^manage loan$/i.test(txt(e))))[0];
      })
      .filter(b => b && (b.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? b.getClientRects().length > 0));
    if (!buttons().length) return 'its card is not on the shelf';
    let manage = buttons().find(onTop);
    for (const b of manage ? [] : buttons()) {
      b.scrollIntoView({ block: 'center' });
      await sleep(400);
      // Libby swaps shelf elements as it scrolls, so look the buttons up again after scrolling.
      manage = buttons().find(onTop);
      if (manage) break;
    }
    if (!manage) return "its Manage Loan button isn't on screen";
    manage.click();
    if (!(await waitTop(/^(return early|renew loan)$/i, 4000))) return 'its Manage Loan sheet did not open';
    if (!sheetIsFor(loan)) return 'the sheet that opened was for a different book';
    return null;
  }

  // Manage Loan -> Read With... -> the How to open screen. Returns null on success, or why not.
  async function openHowToOpen(loan) {
    const problem = await openManageLoan(loan);
    if (problem) return problem;
    let sheet = topEls(/^(return early|renew loan)$/i)[0];
    while (sheet && !/read with/i.test(txt(sheet))) sheet = sheet.parentElement;
    const readWith = sheet && deepestOf([...sheet.querySelectorAll('*')].filter(e => /^read with/i.test(txt(e))))[0];
    if (!readWith) return 'its Manage Loan sheet has no Read With...';
    press(readWith);
    return (await waitTop(HOW_TO_OPEN, 5000)) ? null : 'How to open did not appear after Read With...';
  }

  // Manage Loan -> Return Early -> Libby's "Returning" screen (/shelf/loans/<id>/return) -> its
  // RETURN LOAN button -> Libby's "returned" screen (Go To Shelf, Similar Titles) -> the shelf.
  // Returns null once the loan's card has gone from the shelf, or why not. Libby keeps the card in
  // the page behind the "returned" screen, so the shelf itself is checked.
  async function returnLoan(loan) {
    const problem = await openManageLoan(loan);
    if (problem) return problem;
    const early = topEls(/^return early$/i)[0];
    if (!early) return 'its Manage Loan sheet has no Return Early';
    pressReturn(early);
    const link = `a[href$="/shelf/loans/${CSS.escape(loan.id)}/return"]`;
    const gone = () => !document.querySelector(link);
    let confirmed = '';
    let clicks = 0;
    let lastClick = 0;
    for (const t = Date.now(); Date.now() - t < 10000; await sleep(200)) {
      if (onAccountScreen()) return `Libby went to ${location.pathname}`;
      if (gone()) break;
      if (confirmed && topEls(/^go to shelf$/i).length) break;  // Libby's "returned" screen
      // Libby asks on its "Returning" screen. Confirm only there, and only for this loan: the address
      // names it. Its RETURN LOAN button, or failing that any real button saying Return (not the
      // "Returning" heading). A second time only if Libby still shows it 5 seconds later.
      if (clicks >= 2 || Date.now() - lastClick < 5000) continue;
      if (location.pathname.replace(/\/$/, '') !== `/shelf/loans/${loan.id}/return`) continue;
      const confirm = topEls(RETURN_BUTTON)
        .map(e => e.closest('button, a, [role=button]'))
        .filter(b => b && !b.contains(early) && !early.contains(b) && !ours(b))
        .sort((a, b) => b.matches('.circ-confirm-button') - a.matches('.circ-confirm-button'))[0];
      if (confirm) {
        confirmed = pressReturn(confirm);
        interruptible = false;  // the return is under way: see it through
        clicks++;
        lastClick = Date.now();
        log(`  confirming: ${confirmed}`);
      }
    }
    if (!confirmed && !gone()) {
      log('  no Returning screen. Screen shows:', onScreen());
      return "Libby's Returning screen didn't appear";
    }
    // Back to the shelf (Go To Shelf, else Back), and give Libby a moment to drop the card there.
    log('  after confirming, screen shows:', onScreen());
    const toShelf = topEls(/^go to shelf$/i)[0];
    if (toShelf) press(toShelf);
    await backToShelf({ emptyOk: true });
    for (const t = Date.now(); Date.now() - t < 5000 && !gone(); ) await sleep(200);
    if (gone()) return null;
    log('  still on the shelf. Screen shows:', onScreen());
    return 'Libby still shows it on the shelf after confirming';
  }

  // ---- The footer button and the progress panel --------------------------------------------

  let ui = null;
  let running = false;
  let stopRequested = false;
  let paused = false;
  let results = [];
  let panelOpen = false;  // stays open after a run until closed
  let resumeCancelled = false;  // × pressed during the countdown after "too many requests"
  let mode = 'download';  // which footer button started the current run
  let choose = null;      // while the panel is asking a question: call with the answer
  let choices = [];       // [{ label, value }] buttons shown for that question
  let onPickChange = null;  // while picking books: refreshes the count and button

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

  // A closed book with a return arrow on its cover: sending the book back.
  const RETURN_ICON = `
    <svg version="1.1" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="shibui-graphic icon"
         aria-hidden="true" data-decorative="">
      <g fill="none" stroke="none">
        <path class="color-shadow icon-solid" d="M25.5,13 L43,13 C44.1,13 45,13.9 45,15 L45,49 C45,50.1 44.1,51 43,51 L25.5,51 Z"
              fill="#000000" fill-opacity="0.08"></path>
        <path class="color-highlight icon-hollow" d="M22,12 L43,12 C44.7,12 46,13.3 46,15 L46,49 C46,50.7 44.7,52 43,52 L22,52 C20.3,52 19,50.7 19,49 L19,15 C19,13.3 20.3,12 22,12 Z M24.5,12 L24.5,52"
              stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path class="icon-hollow" d="M31,24.5 L27.5,28 L31,31.5 M27.5,28 L36.5,28 C39.5,28 41.5,30.4 41.5,33.25 C41.5,36.1 39.5,38.5 36.5,38.5 L31,38.5"
              stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </g>
    </svg>`;

  function footerButton(bar, { name, mine, label, aria, icon, start }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `app-footer-nav-bar-button-${name} nav-icon-selectable halo`;
    btn.dataset.haloStates = 'focus';
    btn.setAttribute('aria-label', aria);
    btn.innerHTML = icon + `<span class="app-footer-nav-label"><span role="text">${label}</span></span>`;
    // Size the icon like its neighbours, whatever size Libby is using right now.
    const sibling = bar.querySelector('button:not([class*="-bookhoard"]) svg');
    if (sibling) {
      const cs = getComputedStyle(sibling);
      Object.assign(btn.querySelector('svg').style, { width: cs.width, height: cs.height });
    }
    btn.addEventListener('click', () => {
      if (!running) start().catch(err => fail('run failed:', err));
      else if (mode === mine) requestStop();  // the other button is dimmed and does nothing
    });
    bar.append(btn);
    return btn;
  }

  function buildNavButtons(bar) {
    navBtn?.remove();
    retBtn?.remove();
    navBtn = footerButton(bar, { name: 'bookhoard', mine: 'download', label: 'Download', aria: 'Download loans (bookhoard)', icon: ICON, start: run });
    retBtn = footerButton(bar, { name: 'bookhoard-return', mine: 'return', label: 'Return', aria: 'Return loans (bookhoard)', icon: RETURN_ICON, start: returnAll });
  }

  function requestStop() {
    if (choose) { choose(null); return; }
    if (!running) return;
    stopRequested = true;
    log('stop requested');
    render('Stopping…');
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    log(paused ? 'paused' : 'resumed');
    render(paused ? 'Pausing after this book…' : 'Resuming…');
  }

  function buildPanel() {
    host = document.createElement('div');
    host.dataset.bookhoardPanel = '';
    // The host lets clicks through, so it never hides Libby's own buttons from the search above.
    // Pinned in the bottom-right corner, clear of Libby's footer and of its book screens (which sit
    // on the left). It never moves, so it is easy to reach.
    host.style.cssText = 'position:fixed;right:20px;bottom:110px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .panel { pointer-events: auto; width: min(380px, 90vw);
                 background: #1c1c1c; color: #e0e0e0; border: 1px solid #333; border-radius: 10px;
                 padding: 10px 12px; box-shadow: 0 4px 18px rgba(0,0,0,.5); }
        .status { color: #b8b8b8; margin-bottom: 6px; }
        /* The list is always exactly 5 one-line rows tall and the buttons sit along the bottom edge,
           so nothing shifts while results come in and every click lands where you aimed. */
        .list { height: calc(5 * 24px); overflow: hidden; }
        .bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px;
               border-top: 1px solid #333; }
        .bar .close { margin-left: auto; }
        .close { background: none; border: 0; color: #b8b8b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .pause, .stop, .copy { background: #2a2a2a; border: 1px solid #3a3a3a; color: #d0d0d0; border-radius: 6px;
                font-size: 13px; padding: 4px 12px; cursor: pointer; white-space: nowrap; }
        .pause:hover, .stop:hover, .copy:hover { border-color: #2a9d8f; }
        .choices { display: contents; }
        .choices button { background: #2a2a2a; border: 1px solid #3a3a3a; color: #d0d0d0; border-radius: 6px;
                font-size: 13px; padding: 4px 12px; cursor: pointer; white-space: nowrap; }
        .choices button:hover { border-color: #2a9d8f; }
        .choices button.danger { background: #5a2323; border-color: #7a3030; color: #f2dede; }
        .choices button.danger:hover { border-color: #e07070; }
        .choices button:disabled { opacity: .45; cursor: default; }
        .picker[hidden], .list[hidden] { display: none; }
        .pick-tools { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .pick-tools button { background: none; border: 1px solid #3a3a3a; color: #c8c8c8; border-radius: 6px;
                font-size: 12px; padding: 2px 10px; cursor: pointer; }
        .pick-tools button:hover { border-color: #2a9d8f; }
        .pick-count { margin-left: auto; color: #8a8a8a; font-size: 12px; }
        .pick-list { max-height: min(50vh, 420px); overflow-y: auto; border: 1px solid #2a2a2a; border-radius: 6px; }
        .pick-row { display: flex; align-items: center; gap: 8px; padding: 0 8px; height: 28px; cursor: pointer;
                font-size: 13px; }
        .pick-row + .pick-row { border-top: 1px solid #2a2a2a; }
        .pick-row:hover { background: #242424; }
        .pick-row input { accent-color: #2a9d8f; margin: 0; flex: none; }
        .pick-row .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pick-row .nd { flex: none; color: #e3b25a; font-size: 12px; }
        .pick-row .nd.muted { color: #8a8a8a; }
        .pick-quick { display: contents; }
        .status { white-space: pre-line; }
        .row { height: 24px; line-height: 24px; font-size: 13px; white-space: nowrap; overflow: hidden;
               text-overflow: ellipsis; }
        .row + .row { border-top: 1px solid #2a2a2a; }
        .ok { color: #8fcf9f; }
        .more { color: #8a8a8a; font-size: 12px; padding-top: 4px; }
        .skip { color: #8a8a8a; }
      </style>
      <div class="panel" hidden>
        <div class="status"></div>
        <div class="list"></div>
        <div class="picker" hidden>
          <div class="pick-tools">
            <span class="pick-quick"></span><span class="pick-count"></span>
          </div>
          <div class="pick-list"></div>
        </div>
        <div class="bar">
          <span class="choices"></span>
          <button class="pause">Pause</button><button class="stop">Stop</button><button class="copy">Copy log</button>
          <button class="close" title="Close">&times;</button>
        </div>
      </div>`;
    document.body.append(host);
    ui = { panel: root.querySelector('.panel'), status: root.querySelector('.status'), root,
           copy: root.querySelector('.copy'), stop: root.querySelector('.stop'), pause: root.querySelector('.pause'),
           list: root.querySelector('.list'), close: root.querySelector('.close'),
           choices: root.querySelector('.choices'), picker: root.querySelector('.picker'),
           pickList: root.querySelector('.pick-list'), pickCount: root.querySelector('.pick-count'),
           pickQuick: root.querySelector('.pick-quick') };
    ui.panel.addEventListener('mouseenter', () => { hovering = true; });
    ui.panel.addEventListener('mouseleave', () => { hovering = false; });
    ui.close.addEventListener('click', () => { resumeCancelled = true; panelOpen = false; results = []; render(''); });
    ui.copy.addEventListener('click', () => copyReport().catch(err => fail('copy log failed:', err)));
    ui.stop.addEventListener('click', requestStop);
    ui.pause.addEventListener('click', togglePause);
  }

  function render(status) {
    try {
      draw(status);
    } catch (err) {
      fail('could not update the panel:', err);
    }
  }

  function draw(status) {
    if (!ui) return;
    ui.panel.hidden = !panelOpen;
    if (status) ui.status.textContent = status;
    ui.close.hidden = running;
    ui.copy.hidden = running;
    ui.stop.hidden = !running || !!choose;
    ui.stop.disabled = stopRequested;
    ui.pause.hidden = !running || stopRequested || !!choose;
    ui.picker.hidden = !onPickChange;
    ui.list.hidden = !!onPickChange;
    ui.choices.replaceChildren(...(choose ? choices : []).map(c => {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (c.danger) b.className = 'danger';
      b.disabled = !!c.disabled;
      b.addEventListener('click', () => choose?.(c.value));
      return b;
    }));
    ui.pause.textContent = paused ? 'Resume' : 'Pause';
    const SHOWN = 5;
    const rows = results.slice(-SHOWN).reverse().map(r => {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('strong');
      name.textContent = r.title;
      const what = document.createElement('span');
      what.className = r.ok ? 'ok' : 'skip';
      what.textContent = ' ' + r.result;
      row.append(name, what);
      row.title = `${r.title}: ${r.result}`;
      return row;
    });
    ui.list.replaceChildren(...rows);
    ui.list.title = results.length > SHOWN ? `${results.length - SHOWN} earlier book(s) are in Copy log` : '';
    // The button that started the run says Stop; the other one is dimmed until it ends.
    for (const [btn, name, label] of [[navBtn, 'download', 'Download'], [retBtn, 'return', 'Return']]) {
      if (!btn) continue;
      const mine = running && mode === name;
      let text = btn.querySelector('.app-footer-nav-label [role=text]');
      if (!text) {
        btn.querySelector('.app-footer-nav-label')?.remove();
        btn.insertAdjacentHTML('beforeend', '<span class="app-footer-nav-label"><span role="text"></span></span>');
        text = btn.querySelector('.app-footer-nav-label [role=text]');
      }
      text.textContent = mine ? (choose ? 'Cancel' : 'Stop') : label;
      btn.style.opacity = running && !mine ? '0.4' : '';
    }
  }

  // List every loan with a checkbox and wait for the action button (the ticked loans) or Cancel
  // (null). rows: [{ loan, ticked, tag, muted }]. quick: [{ id, label, pick: row => ticked? }].
  function askPick(status, rows, quick, action) {
    const boxes = rows.map(r => {
      const row = document.createElement('label');
      row.className = 'pick-row';
      row.title = r.loan.title;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = r.ticked;
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = r.loan.title;
      row.append(box, t);
      if (r.tag) {
        const tag = document.createElement('span');
        tag.className = r.muted ? 'nd muted' : 'nd';
        tag.textContent = r.tag;
        row.append(tag);
      }
      box.addEventListener('change', () => onPickChange?.());
      return { ...r, box, row };
    });
    ui.pickList.replaceChildren(...boxes.map(b => b.row));
    ui.pickList.scrollTop = 0;
    ui.pickQuick.replaceChildren(...quick.map(q => {
      const b = document.createElement('button');
      b.textContent = q.label;
      b.dataset.pick = q.id;
      b.addEventListener('click', () => {
        for (const r of boxes) r.box.checked = q.pick(r);
        onPickChange?.();
      });
      return b;
    }));
    return new Promise(resolve => {
      const ticked = () => boxes.filter(r => r.box.checked).map(r => r.loan);
      onPickChange = () => {
        const k = ticked().length;
        ui.pickCount.textContent = `${k} of ${rows.length} ticked`;
        choices = [{ label: action.label(k), value: 'go', danger: action.danger, disabled: !k },
                   { label: 'Cancel', value: null }];
        render('');
      };
      choose = value => {
        const picked = value ? ticked() : null;
        choose = null;
        choices = [];
        onPickChange = null;
        resolve(picked);
      };
      ui.status.textContent = status;
      onPickChange();
    });
  }

  // Libby centres its five footer buttons around the Menu orb, so ours must not take up space in
  // the row: they sit one and two steps to the right of the last button instead.
  function placeNavButtons(bar) {
    const own = [...bar.children].filter(c => !String(c.className).includes('-bookhoard'));
    if (own.length < 2) return;
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    const last = own[own.length - 1];
    const step = last.offsetLeft - own[own.length - 2].offsetLeft;
    // On a narrow screen there is no room to the right, so sit just above the last two buttons.
    const fits = bar.getBoundingClientRect().left + last.offsetLeft + 2 * step + last.offsetWidth <= innerWidth - 4;
    [navBtn, retBtn].forEach((btn, k) => {
      const below = own[own.length - 1 - k];
      Object.assign(btn.style, {
        position: 'absolute',
        left: (fits ? last.offsetLeft + (k + 1) * step : below.offsetLeft) + 'px',
        top: (fits ? last.offsetTop : below.offsetTop - below.offsetHeight - 8) + 'px',
        width: last.offsetWidth + 'px', height: last.offsetHeight + 'px',
      });
    });
  }

  // A plain-text report of the last run for the Copy log button: results, the file names the
  // background chose, and the step-by-step trace. No download links (they carry access tokens).
  async function report() {
    const names = (await ask({ type: 'names' })) || [];
    const { settings = {} } = await api.storage.local.get('settings');
    return [
      `bookhoard ${api.runtime.getManifest().version} log, ${new Date().toISOString()}`,
      navigator.userAgent,
      `page: ${location.pathname}`,
      `settings: ${JSON.stringify(settings)}`,
      '',
      'Results:',
      ...results.map(r => `  ${r.ok ? 'OK  ' : 'SKIP'} ${r.title}: ${r.result}`),
      '',
      'File names:',
      ...names.map(n => `  ${n.time.slice(11, 19)} ${n.from} -> ${n.to}${n.error ? '  ERROR ' + n.error : ''}`),
      '',
      'Trace:',
      ...trace,
      ...(earlier ? [
        '',
        `Before Libby reloaded the page (${new Date(earlier.at).toISOString().slice(11, 19)}):`,
        ...earlier.results.map(r => `  ${r.ok ? 'OK  ' : 'SKIP'} ${r.title}: ${r.result}`),
        ...earlier.trace,
      ] : []),
    ].join('\n');
  }

  async function copyReport() {
    const text = await report();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      ui.root.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    ui.copy.textContent = 'Copied';
    setTimeout(() => { ui.copy.textContent = 'Copy log'; }, 1500);
  }

  // Libby rebuilds its footer at times, so keep checking the button is still there.
  function syncUi() {
    if (!document.body) return;
    // The extension was reloaded or updated: this copy is out of date, so take its UI away.
    if (!api.runtime?.id) {
      clearInterval(syncTimer);
      stopRequested = true;
      choose?.(null);
      navBtn?.remove();
      retBtn?.remove();
      host?.remove();
      return;
    }
    const bar = document.querySelector('.app-footer-nav-bar-controls');
    if (bar && !(navBtn && bar.contains(navBtn) && retBtn && bar.contains(retBtn))) {
      buildNavButtons(bar);
      render('');
    }
    if (navBtn && bar) placeNavButtons(bar);
    if (!host) buildPanel();
    if (!host.isConnected) document.body.append(host);
  }

  // Get the shelf showing before the real work starts (from whatever page the button was clicked
  // on). Returns null, or why it couldn't.
  async function reachShelf() {
    if (onShelfPage() || (await backToShelf({ emptyOk: true, fromAnywhere: true }))) return null;
    fail("couldn't reach the shelf from", location.pathname, '- screen shows:', onScreen());
    return "Couldn't get to your shelf from this page. Open it, then try again.";
  }

  // After a run: Cancel just closes the panel. Otherwise it shows how it went and closes itself
  // after the seconds set in the options (default 5; 0 keeps it open). It stays open while the
  // pointer is over it, and when something went wrong, so Copy log is at hand.
  let closeTimer = 0;
  let hovering = false;
  const PROBLEM = /^(skipped:|error|not returned)|no download started/i;
  async function endRun(text, { cancelled = false, ok = true } = {}) {
    running = false;
    clearTimeout(closeTimer);
    if (cancelled) {
      panelOpen = false;
      results = [];
      render('');
      syncUi();
      return;
    }
    render(text);
    syncUi();
    if (!ok || results.some(r => PROBLEM.test(r.result))) return;
    const { settings = {} } = await api.storage.local.get('settings');
    const seconds = Number(settings.autoClose ?? 5);
    if (!(seconds > 0)) return;
    const later = () => {
      closeTimer = setTimeout(() => {
        if (running) return;
        if (hovering) return later();
        panelOpen = false;
        results = [];
        render('');
      }, seconds * 1000);
    };
    later();
  }

  // ---- The download run -----------------------------------------------------------------------

  // After "too many requests": long enough for Libby's download server to allow a full batch again
  // (it refills at roughly 5 books a minute).
  const RECOVER_MS = 120000;

  const ACCOUNT_SCREEN_STOP =
    "Libby switched to one of its sign-in or backup screens, so bookhoard stopped. " +
    "It hasn't clicked anything there. Finish or close that screen in Libby, then try again.";

  // Libby sometimes reloads the whole page (for example to its "Back Up Your Data" screen), which
  // ends a run without warning. If that happened while a loan was being opened, say so.
  async function explainInterruptedRun() {
    const { inFlight } = await api.storage.local.get('inFlight');
    if (!inFlight) return;
    await api.storage.local.remove('inFlight');
    if (Date.now() - inFlight.at > 2 * 60 * 1000) return;
    ({ lastLog: earlier = null } = await api.storage.local.get('lastLog'));
    const limited = await ask({ type: 'rateLimited', since: inFlight.at - 5000 });
    let message;
    if (limited) {
      fail(`download server said "too many requests" at "${inFlight.title}"; carrying on in ${RECOVER_MS / 1000}s`);
      syncUi();
      panelOpen = true;
      resumeCancelled = false;
      for (let left = RECOVER_MS / 1000; left > 0; left--) {
        if (running) return;  // Download was clicked during the countdown
        if (resumeCancelled) { render('Cancelled. Click Download to carry on.'); return; }
        render(`Libby asked bookhoard to slow down at "${inFlight.title}". Carrying on in ${left}s… ` +
          '(× to cancel)');
        await sleep(1000);
      }
      run({ resume: true }).catch(err => fail('run failed:', err));
      return;
    } else {
      const what = onAccountScreen() ? `switched to its ${location.pathname} screen` : 'reloaded the page';
      message = `While opening "${inFlight.title}", Libby ${what}, so bookhoard stopped. ` +
        "It hasn't clicked anything since. Finish or close that screen in Libby, then try again.";
    }
    fail(message);
    syncUi();
    panelOpen = true;
    render(message);
  }

  async function run({ resume = false } = {}) {
    running = true;
    clearTimeout(closeTimer);
    mode = 'download';
    panelOpen = true;
    stopRequested = false;
    paused = false;
    results = [];
    let downloaded = 0;
    const count = () => {
      const skipped = results.length - downloaded;
      return `${downloaded} downloaded, ${skipped} skipped`;
    };
    const note = (loan, result, ok = false) => {
      log(`${loan.title} [${loan.id}]: ${result}`);
      results.push({ title: loan.title, result, ok });
      if (ok) downloaded++;
      render(stopRequested ? `Stopping… ${count()}`
        : paused ? `Pausing after this book… ${count()}` : `Working… ${count()}`);
    };
    render('Starting…');
    let ending = 'Done.';
    let cancelled = false;
    let ok = true;
    try {
      // Libby keeps the loan cards in the page on every page, so the list can be shown right here.
      // Only go to the shelf first if they aren't there yet, or when carrying on after a reload.
      if (resume || !readShelf().length) {
        const why = await reachShelf();
        if (why) { ending = why; ok = false; return; }
      }
      if (!(await shelfReady())) {
        ending = 'No loans showing. Open your Libby shelf, then try again.';
        ok = false;
        fail('no loans found on', location.pathname, '- screen shows:', onScreen());
        return;
      }
      const { settings = {} } = await api.storage.local.get('settings');
      log('run started; settings:', settings);
      const order = { 'epub-pdf': ['EPUB', 'PDF'], epub: ['EPUB'], 'pdf-epub': ['PDF', 'EPUB'] }[settings.formatOrder || 'epub-pdf'];
      // A break after every few books keeps OverDrive from refusing downloads. The count is saved,
      // not kept per run, so Pause, Stop or starting again can't skip a break that is due, and time
      // spent stopped counts toward it. Firefox fetches each book twice, so its books count double.
      const batchSize = Math.max(1, Number(settings.batchSize ?? 10) || 10);
      let batchPauseMs = Math.max(0, Number(settings.batchPause ?? 60)) * 1000;
      const perBook = (await ask({ type: 'requestsPerBook' })) || 1;
      const breakAt = batchSize;  // requests between breaks: a Chrome book is 1, a Firefox book 2
      const getPace = async () => (await api.storage.local.get('pace')).pace || { count: 0, lastAt: 0 };
      const setPace = pace => api.storage.local.set({ pace });
      const runStart = Date.now();
      let lastLimit = 0;
      const retried = new Set();
      // Wait with a countdown, but give up early if Stop is pressed.
      const pauseFor = async (ms, why) => {
        for (const end = Date.now() + ms; Date.now() < end && !stopRequested; await sleep(250)) {
          const left = Math.ceil((end - Date.now()) / 1000);
          render(paused ? `Paused. The break still counts down: ${left}s left. ${count()}`
            : `${why} (carrying on in ${left}s) ${count()}`);
        }
        if (!stopRequested) render(`Working… ${count()}`);
      };
      // Did the download server say "too many requests" since we last looked? Then wait long enough
      // for a full batch, and take longer breaks from now on.
      const checkRateLimit = async () => {
        const hit = await ask({ type: 'rateLimited', since: Math.max(runStart, lastLimit + 1) });
        if (!hit) return false;
        lastLimit = hit.at;
        batchPauseMs = Math.max(batchPauseMs, RECOVER_MS);
        fail('download server said "too many requests"; waiting two minutes');
        await pauseFor(RECOVER_MS, 'Libby asked bookhoard to slow down. Waiting two minutes');
        await setPace({ count: 0, lastAt: Date.now() });
        if (!stopRequested) await retryRenames();
        return true;
      };
      // Firefox: fetch again any renamed copies that OverDrive refused, now that we've paused.
      const retryRenames = async () => {
        const n = await ask({ type: 'retryRenames' });
        if (n) log(`  fetching ${n} renamed ${n === 1 ? 'copy' : 'copies'} again`);
      };
      // One left over from an earlier run (the pause has long passed): fetch it now.
      await retryRenames();
      // Before each book: take the break if one is due. Time since the last download already counts,
      // and a gap at least as long as the break resets the count.
      const takeBreakIfDue = async () => {
        const pace = await getPace();
        const idle = Date.now() - pace.lastAt;
        if (!batchPauseMs || idle >= batchPauseMs) {
          if (pace.count) await setPace({ count: 0, lastAt: pace.lastAt });
          return;
        }
        if (pace.count < breakAt) return;
        log(`  taking a break: ${pace.count / perBook} books since the last one`);
        await pauseFor(batchPauseMs - idle, `Taking a short break so Libby keeps the downloads coming.`);
        if (!stopRequested) await setPace({ count: 0, lastAt: pace.lastAt });
      };
      const countDownload = async () => {
        const pace = await getPace();
        await setPace({ count: pace.count + perBook, lastAt: Date.now() });
      };
      const optionRe = name => new RegExp('^' + name + '\\b');

      // Which books: ticked in the list (new ones start ticked), or after Libby reloaded the page
      // mid-run, the same choice as before.
      const loans = readShelf();
      const audio = loan => /audiobook/i.test(loan.main);
      let todo;
      const { downloadChoice } = await api.storage.local.get('downloadChoice');
      if (resume && downloadChoice) {
        todo = loans.filter(l => downloadChoice.includes(l.id));
      } else {
        const done = new Set();
        for (const loan of loans) {
          if (await ask({ type: 'downloaded', overdriveId: loan.titleId })) done.add(loan.id);
        }
        const fresh = r => !done.has(r.loan.id) && !audio(r.loan);
        const rows = loans.map(loan => ({
          loan, ticked: fresh({ loan }),
          tag: audio(loan) ? 'audiobook' : done.has(loan.id) ? 'downloaded' : '', muted: true,
        }));
        let question = 'Tick the books to download.';
        if (done.size) {
          question += `\n${done.size} ${done.size === 1 ? 'was' : 'were'} downloaded before, so ` +
            `${done.size === 1 ? 'it starts' : 'they start'} unticked.`;
        }
        todo = await askPick(question, rows,
          [{ id: 'all', label: 'All', pick: () => true },
           { id: 'new', label: 'Not downloaded', pick: fresh },
           { id: 'none', label: 'None', pick: () => false }],
          { label: k => `Download ${k}`, danger: false });
        if (!todo) { cancelled = true; return; }
        await api.storage.local.set({ downloadChoice: todo.map(l => l.id) });
      }
      // Now the work starts: get the shelf showing.
      const why = await reachShelf();
      if (why) { ending = why; ok = false; return; }
      let lost = false;
      log(`${loans.length} loans on the shelf; downloading ${todo.length}${resume ? ' (carrying on)' : ''}:`,
        todo.map(l => l.title));
      render(`Working… ${count()}`);
      for (let i = 0; i < todo.length; i++) {
        const loan = todo[i];
        // Paused: the current book has finished, so say so, and wait for Resume or Stop.
        if (paused && !stopRequested) {
          render(`Paused. ${count()}. Press Resume to carry on.`);
          while (paused && !stopRequested) await sleep(200);
          if (!stopRequested) render(`Working… ${count()}`);
        }
        if (stopRequested) { ending = 'Stopped.'; break; }
        if (onAccountScreen()) { ending = ACCOUNT_SCREEN_STOP; fail(ending, location.pathname); break; }
        if (lost) {
          ending = "Couldn't get back to the shelf, so bookhoard stopped.";
          fail(ending, 'Screen shows:', onScreen());
          break;
        }
        if (audio(loan)) { note(loan, 'audiobook, skipped'); continue; }
        // Carrying on after a reload: what finished before it is done. (A book ticked by hand is
        // downloaded even if it was before.)
        if (resume && (await ask({ type: 'downloaded', overdriveId: loan.titleId }))) {
          note(loan, 'already downloaded');
          continue;
        }
        log(`${loan.title} [${loan.id}]: card says "${loan.main}"`);
        const details = await ask({ type: 'media', overdriveId: loan.titleId });
        log('  formats in the catalog:', details?.formats ?? '(lookup failed)');
        if (details?.formats?.length &&
            !details.formats.some(f => order.some(o => f.startsWith('ebook-' + o.toLowerCase())))) {
          note(loan, `no ${order.join(' or ')}, skipped`);
          continue;
        }
        await takeBreakIfDue();
        if (stopRequested) { ending = 'Stopped.'; break; }
        try {
          interruptible = true;
          await api.storage.local.set({ inFlight: { title: loan.title, id: loan.id, at: Date.now() } });
          const problem = await openHowToOpen(loan);
          if (onAccountScreen()) {
            ending = ACCOUNT_SCREEN_STOP;
            fail(`${loan.title}: Libby went to ${location.pathname} instead of How to open`);
            break;
          }
          if (problem) {
            log(`  ${problem}. Screen shows:`, onScreen());
            note(loan, `skipped: ${problem}`);
            continue;
          }
          // How to open slides in over the Manage Loan sheet: wait until the sheet is gone and the
          // format rows have appeared, rather than judging a half-drawn screen.
          for (const t = Date.now(); Date.now() - t < 4000; await sleep(100)) {
            if (!sheetOpen() && topEls(/^(EPUB|PDF)\b|^other options/i).length) break;
          }
          log('  How to open shows:', onScreen());

          if (!topEls(optionRe(order[0]))[0]) {
            const other = topEls(/^other options/i)[0];
            if (other) {
              press(other);
              await waitTop(new RegExp('^(' + order.join('|') + ')\\b'), 3000);
            }
          }
          const found = order.map(o => [o, topEls(optionRe(o))[0]]).find(([, el]) => el);
          if (!found) {
            log('  none of', order, 'offered. Screen shows:', onScreen());
            note(loan, `no ${order.join(' or ')} offered, skipped`);
            continue;
          }
          const [format, button] = found;
          log('  choosing', format);
          await ask({ type: 'expect', overdriveId: loan.titleId, format });
          const since = Date.now();
          press(button);

          // Move on as soon as the browser has started this book's download (Libby only sometimes
          // shows a Done screen). Click a confirm button if Libby asks first.
          let confirmed = false;
          let started = false;
          let doneSince = 0;
          for (const t = Date.now(); Date.now() - t < 15000; await sleep(250)) {
            if (await ask({ type: 'started', overdriveId: loan.titleId, since })) { started = true; break; }
            // Libby's Done screen means it handed over the file. If bookhoard still hasn't seen the
            // download two seconds later, trust Libby rather than waiting out the full 15 seconds.
            if (topEls(/^done$/i).length) {
              doneSince ||= Date.now();
              if (Date.now() - doneSince > 2000) {
                started = true;
                fail(`${loan.title}: Libby showed Done but bookhoard didn't see the download; check its file name`);
                break;
              }
            }
            const c = !confirmed && topEls(/^(download|continue|confirm|ok|yes|got it)$/i)[0];
            if (c) { log('  confirming:', txt(c)); press(c); confirmed = true; }
          }
          if (!started) {
            if ((await checkRateLimit()) && !retried.has(loan.id)) {
              retried.add(loan.id);
              log(`  trying ${loan.title} again`);
              i--;
              continue;
            }
            fail(`${loan.title}: chose ${format} but no download started within 15s. Screen shows:`, onScreen());
            note(loan, `${format} chosen, but no download started`);
            continue;
          }
          log(`  download started after ${((Date.now() - since) / 1000).toFixed(1)}s`);
          note(loan, format, true);
          await countDownload();
          await checkRateLimit();
        } catch (err) {
          if (err instanceof StopNow) {
            log(`${loan.title}: stopped part-way`);
            ending = 'Stopped.';
            break;
          }
          fail(`${loan.title}:`, err);
          note(loan, 'error: ' + err.message);
        } finally {
          interruptible = false;
          await api.storage.local.remove('inFlight');
          if (!onAccountScreen() && !(await backToShelf())) lost = true;
        }
      }
      // A renamed copy (Firefox) may have been refused just after the last book. Wait out the pause
      // and fetch it again, unless Stop was pressed (then the next run does it).
      if (perBook > 1) await sleep(3000);
      if (perBook > 1 && !stopRequested && !(await checkRateLimit()) && (await ask({ type: 'renamesWaiting' }))) {
        await pauseFor(RECOVER_MS, 'Libby refused a renamed copy. Waiting two minutes to try it again');
        if (!stopRequested) await retryRenames();
      }
    } catch (err) {
      fail('run failed:', err);
      ending = 'Something went wrong: ' + err.message;
      ok = false;
    } finally {
      await api.storage.local.remove('inFlight');
      log('run finished:', cancelled ? 'cancelled' : ending, count());
      if (!/^(Done|Stopped)\./.test(ending)) ok = false;
      await endRun(results.length ? `${ending} ${count()}.` : ending, { cancelled, ok });
    }
  }

  // ---- The return run -------------------------------------------------------------------------

  // Returns loans to the library, after asking. Books not downloaded yet are pointed out first, and
  // can be kept. A loan only counts as returned once its card has gone from the shelf.
  async function returnAll() {
    running = true;
    clearTimeout(closeTimer);
    mode = 'return';
    panelOpen = true;
    stopRequested = false;
    paused = false;
    results = [];
    let returned = 0;
    const count = () => `${returned} returned, ${results.length - returned} not returned`;
    const note = (loan, result, ok = false) => {
      log(`${loan.title} [${loan.id}]: ${result}`);
      results.push({ title: loan.title, result, ok });
      if (ok) returned++;
      render(stopRequested ? `Stopping… ${count()}`
        : paused ? `Pausing after this book… ${count()}` : `Returning… ${count()}`);
    };
    render('Looking at your loans…');
    let ending = 'Done.';
    let cancelled = false;
    let ok = true;
    try {
      // The list can be shown right here (see Download); the shelf is only needed for the returns.
      if (!readShelf().length) {
        const why = await reachShelf();
        if (why) { ending = why; ok = false; return; }
      }
      if (!(await shelfReady())) {
        ending = 'No loans showing. Open your Libby shelf, then try again.';
        ok = false;
        return;
      }
      const loans = readShelf();
      const notDownloaded = [];
      for (const loan of loans) {
        if (!(await ask({ type: 'downloaded', overdriveId: loan.titleId }))) notDownloaded.push(loan);
      }
      log(`return: ${loans.length} loans, ${notDownloaded.length} not downloaded in this browser`);
      // Every loan, ticked or not, so nothing goes back by surprise.
      let question = "Tick the books to return. This can't be undone: you'd have to borrow them again.";
      if (notDownloaded.length) {
        question += `\n${notDownloaded.length} ${notDownloaded.length === 1 ? "isn't" : "aren't"} downloaded in ` +
          'this browser, so they start unticked.';
      }
      const nd = new Set(notDownloaded.map(l => l.id));
      const todo = await askPick(question,
        loans.map(loan => ({ loan, ticked: !nd.has(loan.id), tag: nd.has(loan.id) ? 'not downloaded' : '' })),
        [{ id: 'all', label: 'All', pick: () => true },
         { id: 'downloaded', label: 'Downloaded', pick: r => !nd.has(r.loan.id) },
         { id: 'none', label: 'None', pick: () => false }],
        { label: k => `Return ${k}`, danger: true });
      if (!todo) { cancelled = true; return; }
      const why = await reachShelf();
      if (why) { ending = why; ok = false; return; }
      log(`returning ${todo.length} of ${loans.length} loans:`, todo.map(l => l.title));
      render(`Returning… ${count()}`);

      let failedInARow = 0;
      for (const loan of todo) {
        if (paused && !stopRequested) {
          render(`Paused. ${count()}. Press Resume to carry on.`);
          while (paused && !stopRequested) await sleep(200);
          if (!stopRequested) render(`Returning… ${count()}`);
        }
        if (stopRequested) { ending = 'Stopped.'; break; }
        if (onAccountScreen()) { ending = ACCOUNT_SCREEN_STOP; fail(ending, location.pathname); break; }
        // Something about Libby's screens isn't as expected: stop rather than keep trying.
        if (failedInARow >= 2) {
          ending = "Couldn't return two books in a row, so bookhoard stopped. Copy log has the details.";
          break;
        }
        if (!readShelf().some(l => l.id === loan.id)) {
          note(loan, 'already gone from the shelf');
          continue;
        }
        try {
          interruptible = true;
          const problem = await returnLoan(loan);
          if (problem) {
            failedInARow++;
            note(loan, `not returned: ${problem}`);
          } else {
            failedInARow = 0;
            note(loan, 'returned', true);
          }
        } catch (err) {
          if (err instanceof StopNow) {
            log(`${loan.title}: stopped before it was returned`);
            ending = 'Stopped.';
            break;
          }
          failedInARow++;
          fail(`${loan.title}:`, err);
          note(loan, 'error: ' + err.message);
        } finally {
          interruptible = false;
          if (!onAccountScreen() && !(await backToShelf({ emptyOk: true }))) {
            ending = "Couldn't get back to the shelf, so bookhoard stopped.";
            fail(ending, 'Screen shows:', onScreen());
            break;
          }
        }
        await sleep(1000);  // a moment between books, as a person would take
      }
    } catch (err) {
      fail('return run failed:', err);
      ending = 'Something went wrong: ' + err.message;
      ok = false;
    } finally {
      if (choose) choose(null);
      log('return run finished:', cancelled ? 'cancelled' : ending, count());
      if (!/^(Done|Stopped)\./.test(ending)) ok = false;
      await endRun(results.length ? `${ending} ${count()}.` : ending, { cancelled, ok });
    }
  }

  for (const old of document.querySelectorAll('[class*="app-footer-nav-bar-button-bookhoard"], [data-bookhoard-panel]')) {
    old.remove();
  }
  const syncTimer = setInterval(syncUi, 500);
  syncUi();
  explainInterruptedRun().catch(err => fail('could not check the last run:', err));
})();
