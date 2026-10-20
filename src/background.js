// Background: names Libby downloads from the user's template, and answers the content script's
// questions (book details, was this already downloaded, which format is about to be chosen).

import { DEFAULTS, buildPath } from './template.js';
import { fetchMedia, formatIds, parseFulfillUrl, variables } from './metadata.js';

const api = globalThis.browser ?? globalThis.chrome;
const sessionStore = api.storage.session ?? api.storage.local;

async function getSettings() {
  const { settings } = await api.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

// Logging. Errors always go to this background console; step-by-step detail only in debug mode.
// Every naming decision is also kept (last 200) so the in-page "Copy log" report can include it.
// Download links carry one-time tokens, so only their path is ever logged.
let debug = false;
getSettings().then(s => { debug = !!s.debug; });
api.storage.onChanged.addListener(changes => {
  if (changes.settings) debug = !!changes.settings.newValue?.debug;
});
const shortUrl = url => { try { return new URL(url).pathname.split('/').pop(); } catch { return '?'; } };
const log = (...args) => { if (debug) console.log('[bookhoard]', ...args); };
const fail = (...args) => console.error('[bookhoard]', ...args);
async function remember(entry) {
  const { names = [] } = await sessionStore.get('names');
  names.push({ time: new Date().toISOString(), ...entry });
  await sessionStore.set({ names: names.slice(-200) });
}

const mediaCache = new Map();
function media(overdriveId) {
  if (!mediaCache.has(overdriveId)) {
    if (mediaCache.size >= 300) mediaCache.delete(mediaCache.keys().next().value);
    mediaCache.set(overdriveId, fetchMedia(overdriveId).catch(err => {
      mediaCache.delete(overdriveId);
      throw err;
    }));
  }
  return mediaCache.get(overdriveId);
}

// ---- Which book is a download? ------------------------------------------------------------------
//
// Usually the address says: https://fulfill.contentreserve.com/Title_ISBN_ID.acsm. But DRM-free
// EPUBs redirect to a storage address named {GUID}Fmt810.epub, and Firefox reports the download
// under that. So there are two fallbacks: the redirect, if the browser let us see it, and the book
// the page said it was about to download (it tells us just before clicking EPUB or PDF).

const redirectedFrom = new Map();  // redirected address -> OverDrive link
api.webRequest?.onBeforeRedirect.addListener(details => {
  if (!parseFulfillUrl(details.url)) return;
  redirectedFrom.set(details.redirectUrl, details.url);
  if (redirectedFrom.size > 200) redirectedFrom.delete(redirectedFrom.keys().next().value);
}, { urls: ['https://*.contentreserve.com/*'] });

let pending = null;           // { overdriveId, format, at, claimedBy } - the book about to download
const known = new Map();      // download id -> { download, url } once we know which book it is
const PENDING_MS = 20000;

function remembered(id, book) {
  known.set(id, book);
  if (known.size > 500) known.delete(known.keys().next().value);
  return book;
}

function bookOf(item) {
  if (known.has(item.id)) return known.get(item.id);
  for (const u of [item.url, item.finalUrl]) {
    if (!u) continue;
    const link = parseFulfillUrl(u) ? u : redirectedFrom.get(u);
    if (!link) continue;
    const download = parseFulfillUrl(link);
    // The expected book has arrived, so nothing else can be mistaken for it.
    if (pending?.overdriveId === download.overdriveId && pending.claimedBy === undefined) pending.claimedBy = item.id;
    return remembered(item.id, { download, url: link });
  }
  // A book-type file starting just after the page chose a format is that book.
  const ext = [item.filename, item.url].map(s => (s || '').match(/\.(acsm|epub|pdf)(?:$|[?#])/i)?.[1])
    .find(Boolean)?.toLowerCase();
  if (ext && pending && Date.now() - pending.at < PENDING_MS &&
      (pending.claimedBy === undefined || pending.claimedBy === item.id)) {
    pending.claimedBy = item.id;
    return remembered(item.id, {
      download: { overdriveId: pending.overdriveId, isbn: '', ext, drm: ext === 'acsm' ? 'DRM' : 'DRM-free', library: '' },
      url: item.url,
    });
  }
  return null;
}

async function targetFor(book) {
  const { download, url } = book;
  const settings = await getSettings();
  let details = null;
  try {
    details = await media(download.overdriveId);
  } catch (err) {
    fail(`catalog lookup failed for ${download.overdriveId}; naming from the link only:`, err);
  }
  const format = pending?.overdriveId === download.overdriveId ? pending.format : undefined;
  const vars = variables(details, download, format);
  if (!vars.title) vars.title = shortUrl(url).split('_')[0];
  const filename = buildPath(settings, vars, download.ext);
  log('naming', shortUrl(url), '->', filename, vars);
  await remember({ from: shortUrl(url), to: filename, lookedUp: !!details });
  return { filename, conflictAction: settings.conflict };
}

// ---- Download events ------------------------------------------------------------------------

// Note when each book's download starts, so the page can move on as soon as it has.
api.downloads.onCreated.addListener(async item => {
  const book = bookOf(item);
  if (!book) return;
  const { started = {} } = await sessionStore.get('started');
  started[book.download.overdriveId] = Date.now();
  await sessionStore.set({ started });
  log('download started for', book.download.overdriveId);
});

// bookhoard's record of finished downloads: { overdriveId: { d: download id, t: when } }. It keeps
// the last 1,000 books, dropping the oldest (entries from before times were kept count as oldest).
// Saves are queued, so two downloads finishing together can't overwrite each other.
const RECORD_MAX = 1000;
let recordQueue = Promise.resolve();
function recordDownload(overdriveId, downloadId) {
  recordQueue = recordQueue.then(async () => {
    const { completed = {} } = await api.storage.local.get('completed');
    completed[overdriveId] = { d: downloadId, t: Date.now() };
    const ids = Object.keys(completed);
    if (ids.length > RECORD_MAX) {
      const when = id => completed[id]?.t ?? 0;
      for (const id of ids.sort((a, b) => when(a) - when(b)).slice(0, ids.length - RECORD_MAX)) delete completed[id];
    }
    await api.storage.local.set({ completed });
  }).catch(err => fail('could not save the download record:', err));
  return recordQueue;
}

// Remember finished downloads by book, so "already downloaded" works whatever address the browser
// recorded.
api.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== 'complete') return;
  const [item] = await api.downloads.search({ id: delta.id });
  const book = item && bookOf(item);
  if (book) await recordDownload(book.download.overdriveId, delta.id);
});

// OverDrive's download server answers 429 Too Many Requests when books are fetched too fast.
// Only watched, never changed: the page uses this to back off and retry.
api.webRequest?.onHeadersReceived.addListener(async details => {
  if (details.statusCode !== 429 || !parseFulfillUrl(details.url)) return;
  await sessionStore.set({ rateLimited: { at: Date.now(), url: shortUrl(details.url) } });
  fail('download server said 429 Too Many Requests for', shortUrl(details.url));
  // Libby opens downloads in its own tab, so the browser's error page replaces Libby. Load the
  // shelf again (a normal visit; reloading the book's own screen can upset Libby), and the page
  // carries on after a pause.
  if (details.type === 'main_frame' && details.tabId >= 0 && pending && Date.now() - pending.at < 60000) {
    setTimeout(() => api.tabs.update(details.tabId, { url: 'https://libbyapp.com/shelf' })
      .catch(err => log('could not reopen the shelf:', err)), 1500);
  }
}, { urls: ['https://*.contentreserve.com/*'] });

// Firefox only: fetch renamed copies that failed (set below). Chrome renames in place, so has none.
let retryRenames = async () => 0;

if (api.downloads.onDeterminingFilename) {
  // Chrome and Edge: suggest the name as the download starts.
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const book = bookOf(item);
    if (!book) return;  // not a Libby download: leave it alone
    targetFor(book)
      .then(t => suggest({ filename: t.filename, conflictAction: t.conflictAction }))
      .catch(err => {
        fail('could not name', shortUrl(book.url), "- kept the browser's name:", err);
        remember({ from: shortUrl(book.url), to: '(browser default)', error: String(err) });
        suggest();
      });
    return true;  // suggest() is called asynchronously
  });
} else {
  // Firefox has no way to rename a download in flight. So fetch the same file again under the
  // right name, and remove Libby's copy only once ours has finished: if ours fails, Libby's copy
  // is kept under its own name rather than losing the book.
  const ours = new Set();       // addresses we are fetching ourselves
  const replacing = new Map();  // our download id -> Libby's download id
  const fetches = new Map();    // our download id -> what to fetch again if it fails

  const removeLibbysCopy = async original => {
    try {
      const [item] = await api.downloads.search({ id: original });
      if (item?.state === 'in_progress') await api.downloads.cancel(original);
      else if (item?.state === 'complete' && item.exists !== false) await api.downloads.removeFile(original);
      await api.downloads.erase({ id: original });
    } catch (err) {
      log("could not remove Libby's copy:", err);
    }
  };
  const settle = async (oursId, state, error) => {
    const original = replacing.get(oursId);
    if (original === undefined || (state !== 'complete' && state !== 'interrupted')) return;
    const again = fetches.get(oursId);
    fetches.delete(oursId);
    if (state === 'complete') {
      replacing.delete(oursId);
      // Done with this address. (A failed one is kept: it may be fetched again shortly.)
      if (again) setTimeout(() => ours.delete(again.url), 60000);  // its onCreated has long passed
      await removeLibbysCopy(original);
    } else if (state === 'interrupted') {
      replacing.delete(oursId);
      // Usually OverDrive saying "too many requests". Try once more after the page's pause (saved,
      // because Firefox may unload this script while it waits).
      if (again && !again.retried && error !== 'USER_CANCELED') {
        const { renameRetries = [] } = await sessionStore.get('renameRetries');
        renameRetries.push({ ...again, original });
        await sessionStore.set({ renameRetries });
        fail(`renamed copy of ${again.filename} failed (${error}); will try again after the pause`);
        remember({ from: '(renamed copy)', to: '(failed; trying again after the pause)', error: String(error) });
      } else {
        fail("renamed copy failed, so Libby's copy was kept under its own name:", error);
        remember({ from: '(renamed copy)', to: "(failed; Libby's copy kept)", error: String(error) });
      }
    }
  };

  // Fetch the renamed copies that failed again, once each. Libby's copy is still only removed once
  // ours has finished.
  retryRenames = async () => {
    const { renameRetries = [] } = await sessionStore.get('renameRetries');
    if (!renameRetries.length) return 0;
    await sessionStore.set({ renameRetries: [] });
    for (const r of renameRetries) {
      try {
        ours.add(r.url);
        const id = await api.downloads.download({ url: r.url, filename: r.filename, conflictAction: r.conflictAction });
        remembered(id, r.book);
        replacing.set(id, r.original);
        fetches.set(id, { ...r, retried: true });
        log('fetching the renamed copy again:', r.filename);
        const [now] = await api.downloads.search({ id });
        if (now && now.state !== 'in_progress') await settle(id, now.state, now.error);
      } catch (err) {
        fail(`could not fetch ${r.filename} again; Libby's copy was kept under its own name:`, err);
      }
    }
    return renameRetries.length;
  };

  api.downloads.onCreated.addListener(async item => {
    if (ours.has(item.url)) return;
    const book = bookOf(item);
    if (!book) return;
    try {
      const t = await targetFor(book);
      // Fetch the OverDrive link if we know it, otherwise the address Firefox reported.
      const url = book.url || item.url;
      ours.add(url);
      ours.add(item.url);
      const id = await api.downloads.download({ url, filename: t.filename, conflictAction: t.conflictAction });
      remembered(id, book);
      replacing.set(id, item.id);
      fetches.set(id, { url, filename: t.filename, conflictAction: t.conflictAction, book });
      // A tiny .acsm can finish before we start listening for it.
      const [now] = await api.downloads.search({ id });
      if (now && now.state !== 'in_progress') await settle(id, now.state, now.error);
    } catch (err) {
      fail('could not re-download', shortUrl(book.url || item.url), 'under the new name:', err);
      remember({ from: shortUrl(book.url || item.url), to: '(failed)', error: String(err) });
    }
  });
  api.downloads.onChanged.addListener(delta => {
    if (delta.state) settle(delta.id, delta.state.current, delta.error?.current);
  });
}

api.action.onClicked.addListener(() => api.runtime.openOptionsPage());

// The old "wait between books" setting was replaced by "pause after every few books".
api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'update') return;
  const { settings } = await api.storage.local.get('settings');
  if (settings && 'delay' in settings) {
    const { delay, ...rest } = settings;
    await api.storage.local.set({ settings: rest });
  }
  // The old default pause (60 seconds after 10 books) was too fast for long runs. Move anyone
  // still on it to the new default, once: a pause chosen later, even 60/10, is left alone.
  const { settings: now, migrated = [] } = await api.storage.local.get(['settings', 'migrated']);
  if (!migrated.includes('pause120')) {
    if (now && Number(now.batchPause) === 60 && Number(now.batchSize ?? 10) === 10) {
      await api.storage.local.set({ settings: { ...now, batchPause: DEFAULTS.batchPause } });
    }
    await api.storage.local.set({ migrated: [...migrated, 'pause120'] });
  }
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'media': {
        try {
          const m = await media(msg.overdriveId);
          return { title: m.title, formats: formatIds(m) };
        } catch (err) {
          fail(`catalog lookup failed for ${msg.overdriveId}:`, err);
          return null;
        }
      }
      case 'openReader': {
        // A Media Do reader address Libby tried to open (see page-hook.js): open it in a tab of its
        // own, in the background. Only Media Do's own https addresses.
        let u;
        try { u = new URL(msg.url); } catch { return false; }
        if (u.protocol !== 'https:' || !/(^|\.)mediadotech\.com$/.test(u.hostname)) return false;
        await api.tabs.create({ url: u.href, active: false, index: sender?.tab ? sender.tab.index + 1 : undefined });
        return true;
      }
      case 'openLibby': {
        // A book only Libby's own reader opens: Libby's address for that reader, in a tab of its own.
        if (!/^\d+$/.test(String(msg.card)) || !/^\d+$/.test(String(msg.book))) return false;
        await api.tabs.create({ url: `https://libbyapp.com/open/loan/${msg.card}/${msg.book}`, active: false,
          index: sender?.tab ? sender.tab.index + 1 : undefined });
        return true;
      }
      case 'expect': {
        // The page is about to click EPUB/PDF for this book.
        pending = { overdriveId: msg.overdriveId, format: msg.format, at: Date.now() };
        return true;
      }
      case 'downloaded': {
        // Downloaded before, even if the file has since been moved (say, into an ebook library) or
        // the browser's download history cleared. bookhoard's own record of finished downloads
        // comes first; the history only adds what it has from before that record existed.
        if (!/^\d+$/.test(String(msg.overdriveId))) return false;
        const { completed = {} } = await api.storage.local.get('completed');
        if (completed[msg.overdriveId] !== undefined) return true;
        const found = await api.downloads.search({
          urlRegex: `contentreserve\\.com/[^?]*_${msg.overdriveId}\\.(acsm|epub|pdf)`,
        });
        const done = found.find(d => d.state === 'complete');
        if (done) await recordDownload(msg.overdriveId, done.id);
        return !!done || found.some(d => d.state === 'in_progress');
      }
      case 'started': {
        const { started = {} } = await sessionStore.get('started');
        return (started[msg.overdriveId] || 0) >= msg.since;
      }
      case 'rateLimited': {
        const { rateLimited } = await sessionStore.get('rateLimited');
        return rateLimited && rateLimited.at >= msg.since ? rateLimited : null;
      }
      case 'requestsPerBook': {
        // Firefox fetches each book twice (once by Libby, once under the right name).
        return api.downloads.onDeterminingFilename ? 1 : 2;
      }
      case 'retryRenames': {
        return retryRenames();
      }
      case 'renamesWaiting': {
        const { renameRetries = [] } = await sessionStore.get('renameRetries');
        return renameRetries.length;
      }
      case 'names': {
        const { names = [] } = await sessionStore.get('names');
        return names;
      }
      default:
        return undefined;
    }
  })().then(sendResponse, err => {
    fail(`message "${msg?.type}" failed:`, err);
    sendResponse(undefined);
  });
  return true;
});
