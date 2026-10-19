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

// Remember finished downloads by book, so "already downloaded" works whatever address the browser
// recorded.
api.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== 'complete') return;
  const [item] = await api.downloads.search({ id: delta.id });
  const book = item && bookOf(item);
  if (!book) return;
  const { completed = {} } = await api.storage.local.get('completed');
  completed[book.download.overdriveId] = delta.id;
  await api.storage.local.set({ completed });
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
  if (details.type === 'main_frame' && details.tabId >= 0) {
    setTimeout(() => api.tabs.update(details.tabId, { url: 'https://libbyapp.com/shelf' })
      .catch(err => log('could not reopen the shelf:', err)), 1500);
  }
}, { urls: ['https://*.contentreserve.com/*'] });

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
    if (original === undefined) return;
    if (state === 'complete') {
      replacing.delete(oursId);
      await removeLibbysCopy(original);
    } else if (state === 'interrupted') {
      replacing.delete(oursId);
      fail("renamed copy failed, so Libby's copy was kept under its own name:", error);
      remember({ from: '(renamed copy)', to: "(failed; Libby's copy kept)", error: String(error) });
    }
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
      known.set(id, book);
      replacing.set(id, item.id);
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
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
      case 'expect': {
        // The page is about to click EPUB/PDF for this book.
        pending = { overdriveId: msg.overdriveId, format: msg.format, at: Date.now() };
        return true;
      }
      case 'downloaded': {
        const found = await api.downloads.search({
          urlRegex: `contentreserve\\.com/[^?]*_${msg.overdriveId}\\.(acsm|epub|pdf)`,
        });
        if (found.some(d => d.state !== 'interrupted' && d.exists !== false)) return true;
        const { completed = {} } = await api.storage.local.get('completed');
        if (completed[msg.overdriveId] === undefined) return false;
        const [item] = await api.downloads.search({ id: completed[msg.overdriveId] });
        return !!item && item.state === 'complete' && item.exists !== false;
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
