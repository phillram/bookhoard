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
  const NEVER = /return|renew|suspend|cancel|delete|remove|passkey|sign out|log out|forget|unlink/i;
  // Libby's sign-in, backup and passkey screens live under /interview. bookhoard never acts there.
  const onAccountScreen = () => location.pathname.startsWith('/interview');
  let host = null;    // the progress panel's container
  let navBtn = null;  // our footer button
  // (both are kept out of every search below, so the run never clicks its own controls)

  // Is el what is actually on screen at its own centre (not hidden behind a sheet)?
  const onTop = el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // Look through bookhoard's own panel and footer button: they must not count as covering Libby.
    const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      .find(e => e !== host && !navBtn?.contains(e));
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
    if (onAccountScreen()) throw new Error('on a Libby account screen; not clicking ' + label);
    if (NEVER.test(label)) throw new Error('refused to click ' + label);
    el.click();
    return label;
  };
  const deepestOf = list => list.filter(e => !list.some(o => o !== e && e.contains(o)));
  const ask = msg => api.runtime.sendMessage(msg);

  // Logging. Errors always go to the console; with Debug on (options page) every step does too.
  // Everything is also kept for the panel's Copy log button.
  let debug = false;
  const trace = [];
  const keep = line => {
    trace.push(new Date().toISOString().slice(11, 19) + ' ' + line);
    if (trace.length > 3000) trace.shift();
  };
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
    .filter(e => !navBtn?.contains(e) && onTop(e)).map(txt).filter(Boolean))].slice(0, 15);

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
  const onShelf = () => /^\/shelf(\/loans)?\/?$/.test(location.pathname) && !sheetOpen() && readShelf().length > 0;

  async function shelfReady() {
    for (let i = 0; i < 30; i++) {
      if (readShelf().length) return true;
      await sleep(100);
    }
    return false;
  }

  // Close whatever Libby has open (Done, Back, or the sheet's own dismiss button) until the shelf
  // is showing again.
  async function backToShelf() {
    for (let k = 0; k < 6; k++) {
      if (onAccountScreen()) return false;
      if (onShelf()) return true;
      // Prefer Done, then the sheet's own close buttons, then Back.
      const close = [/^done$/i, /^(dismiss dialog|close)$/i, /^back$/i].map(re => topEls(re)[0]).find(Boolean);
      if (close) press(close);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      for (let w = 0; w < 30 && !onShelf(); w++) await sleep(100);
    }
    return onShelf();
  }

  // The open Manage Loan sheet labels its book "Book: <title>, by <author>" (shelf cards say
  // "Book: '<title>'. Cover image."), so this tells us the sheet is for the loan we clicked.
  function sheetIsFor(loan) {
    const esc = loan.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = new RegExp(`^[A-Za-z]+: ${esc}, by `);
    return [...document.querySelectorAll('body *')].some(e => label.test(txt(e)) && onTop(e));
  }

  // Manage Loan -> Read With... -> the How to open screen. Returns null on success, or why not.
  async function openHowToOpen(loan) {
    if (!onShelf() && !(await backToShelf())) return 'could not get back to the shelf first';
    const card = readShelf().find(l => l.id === loan.id)?.card;
    if (!card) return 'its card is not on the shelf';
    card.scrollIntoView({ block: 'center' });
    await sleep(400);
    // Libby swaps shelf elements as it scrolls, so look the card up again after scrolling.
    const fresh = readShelf().find(l => l.id === loan.id)?.card || card;
    const manage = deepestOf([...fresh.querySelectorAll('button, a, [role=button]')]
      .filter(e => /^manage loan$/i.test(txt(e))))[0];
    if (!manage) return 'its card has no Manage Loan button';
    manage.click();
    const mark = await waitTop(/^(return early|renew loan)$/i, 4000);
    if (!mark) return 'its Manage Loan sheet did not open';
    if (!sheetIsFor(loan)) return 'the sheet that opened was for a different book';
    let sheet = mark;
    while (sheet && !/read with/i.test(txt(sheet))) sheet = sheet.parentElement;
    const readWith = sheet && deepestOf([...sheet.querySelectorAll('*')].filter(e => /^read with/i.test(txt(e))))[0];
    if (!readWith) return 'its Manage Loan sheet has no Read With...';
    press(readWith);
    return (await waitTop(HOW_TO_OPEN, 5000)) ? null : 'How to open did not appear after Read With...';
  }

  // ---- The footer button and the progress panel --------------------------------------------

  let ui = null;
  let running = false;
  let stopRequested = false;
  let paused = false;
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
      if (running) requestStop();
      else run().catch(err => fail('run failed:', err));
    });
    bar.append(navBtn);
  }

  function requestStop() {
    if (!running) return;
    stopRequested = true;
    log('stop requested');
    render('Stopping after this book…');
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    log(paused ? 'paused' : 'resumed');
    render(paused ? 'Paused. Press Resume to carry on.' : 'Resuming…');
  }

  function buildPanel() {
    host = document.createElement('div');
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
        .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
        .status { color: #b8b8b8; flex: 1; min-width: 0; }
        .actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .close { background: none; border: 0; color: #b8b8b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .pause, .stop, .copy { background: #2a2a2a; border: 1px solid #3a3a3a; color: #d0d0d0; border-radius: 6px;
                font-size: 12px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
        .row { padding: 3px 0; border-top: 1px solid #333; font-size: 13px; }
        .ok { color: #8fcf9f; }
        .more { color: #8a8a8a; font-size: 12px; padding-top: 4px; }
        .skip { color: #8a8a8a; }
      </style>
      <div class="panel" hidden>
        <div class="top"><span class="status"></span>
          <span class="actions"><button class="pause">Pause</button><button class="stop">Stop</button><button class="copy">Copy log</button><button class="close" title="Close">&times;</button></span></div>
        <div class="list"></div>
      </div>`;
    document.body.append(host);
    ui = { panel: root.querySelector('.panel'), status: root.querySelector('.status'), root,
           copy: root.querySelector('.copy'), stop: root.querySelector('.stop'), pause: root.querySelector('.pause'),
           list: root.querySelector('.list'), close: root.querySelector('.close') };
    ui.close.addEventListener('click', () => { panelOpen = false; results = []; render(''); });
    ui.copy.addEventListener('click', () => copyReport().catch(err => fail('copy log failed:', err)));
    ui.stop.addEventListener('click', requestStop);
    ui.pause.addEventListener('click', togglePause);
  }

  function render(status) {
    if (!ui) return;
    ui.panel.hidden = !panelOpen;
    if (status) ui.status.textContent = status;
    ui.close.hidden = running;
    ui.copy.hidden = running;
    ui.stop.hidden = !running;
    ui.stop.disabled = stopRequested;
    ui.pause.hidden = !running || stopRequested;
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
      return row;
    });
    if (results.length > SHOWN) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = `${results.length - SHOWN} earlier book(s) in Copy log`;
      rows.push(more);
    }
    ui.list.replaceChildren(...rows);
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
    const bar = document.querySelector('.app-footer-nav-bar-controls');
    if (bar && !(navBtn && bar.contains(navBtn))) {
      buildNavButton(bar);
      render('');
    }
    if (navBtn && bar) placeNavButton(bar);
    if (!host) buildPanel();
    if (!host.isConnected) document.body.append(host);
  }

  // ---- The download run -----------------------------------------------------------------------

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
    const limited = await ask({ type: 'rateLimited', since: inFlight.at - 5000 });
    let message;
    if (limited) {
      message = `OverDrive's download server said "too many requests" while bookhoard was on ` +
        `"${inFlight.title}", so the run stopped. Wait a minute, then click Download again: ` +
        'books already downloaded are skipped. A longer wait between books in the options helps.';
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

  async function run() {
    running = true;
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
      render(stopRequested ? `Stopping after this book… ${count()}`
        : paused ? `Paused after this book. ${count()}` : `Working… ${count()}`);
    };
    render('Starting…');
    let ending = 'Done.';
    try {
      if (!(await shelfReady())) {
        ending = 'No loans showing. Open your Libby shelf, then try again.';
        fail('no loans found on', location.pathname, '- screen shows:', onScreen());
        return;
      }
      const { settings = {} } = await api.storage.local.get('settings');
      log('run started; settings:', settings);
      const order = { 'epub-pdf': ['EPUB', 'PDF'], epub: ['EPUB'], 'pdf-epub': ['PDF', 'EPUB'] }[settings.formatOrder || 'epub-pdf'];
      const skipDownloaded = settings.skipDownloaded !== false;
      const max = Number(settings.limit) > 0 ? Number(settings.limit) : Infinity;
      let gapMs = Math.max(0, Number(settings.delay ?? 0)) * 1000;
      const runStart = Date.now();
      let lastLimit = 0;
      const retried = new Set();
      // Wait, but give up early if Stop is pressed.
      const pauseFor = async (ms, status) => {
        if (status) render(status);
        for (const end = Date.now() + ms; Date.now() < end && !stopRequested;) await sleep(200);
      };
      // Did the download server say "too many requests" since we last looked? Then slow down.
      const checkRateLimit = async () => {
        const hit = await ask({ type: 'rateLimited', since: Math.max(runStart, lastLimit + 1) });
        if (!hit) return false;
        lastLimit = hit.at;
        gapMs = Math.max(gapMs * 2, 10000);
        fail(`download server said "too many requests"; waiting 60s, then ${gapMs / 1000}s between books`);
        await pauseFor(60000, 'OverDrive asked to slow down. Waiting a minute…');
        return true;
      };
      const optionRe = name => new RegExp('^' + name + '\\b');

      const shelf = readShelf();
      let lost = false;
      log(`${shelf.length} loans on the shelf`);
      for (let i = 0; i < shelf.length; i++) {
        const loan = shelf[i];
        while (paused && !stopRequested) await sleep(200);
        if (stopRequested) { ending = 'Stopped.'; break; }
        if (onAccountScreen()) { ending = ACCOUNT_SCREEN_STOP; fail(ending, location.pathname); break; }
        if (lost) {
          ending = "Couldn't get back to the shelf, so bookhoard stopped.";
          fail(ending, 'Screen shows:', onScreen());
          break;
        }
        if (downloaded >= max) break;
        if (/audiobook/i.test(loan.main)) { note(loan, 'audiobook, skipped'); continue; }
        // The browser's download history (finished downloads only) says what is already done, so a
        // download that failed is simply tried again next time.
        if (skipDownloaded && (await ask({ type: 'downloaded', overdriveId: loan.titleId }))) {
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
        try {
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
          if (!(await checkRateLimit()) && gapMs) await pauseFor(gapMs);
        } catch (err) {
          fail(`${loan.title}:`, err);
          note(loan, 'error: ' + err.message);
        } finally {
          await api.storage.local.remove('inFlight');
          if (!onAccountScreen() && !(await backToShelf())) lost = true;
        }
      }
    } catch (err) {
      fail('run failed:', err);
      ending = 'Something went wrong: ' + err.message;
    } finally {
      await api.storage.local.remove('inFlight');
      log('run finished:', ending, count());
      running = false;
      render(results.length ? `${ending} ${count()}.` : ending);
      syncUi();
    }
  }

  syncUi();
  setInterval(syncUi, 500);
  explainInterruptedRun().catch(err => fail('could not check the last run:', err));
})();
