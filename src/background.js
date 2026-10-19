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

// The content script says which format it picked just before clicking it, because an .acsm URL
// alone does not say whether the book inside is an EPUB or a PDF.
async function expectedFormat(overdriveId) {
  const { expected } = await sessionStore.get('expected');
  return expected?.[overdriveId];
}

async function targetFor(url) {
  const download = parseFulfillUrl(url);
  if (!download) return null;
  const settings = await getSettings();
  let details = null;
  try {
    details = await media(download.overdriveId);
  } catch (err) {
    fail(`catalog lookup failed for ${download.overdriveId}; naming from the link only:`, err);
  }
  const vars = variables(details, download, await expectedFormat(download.overdriveId));
  if (!vars.title) vars.title = shortUrl(url).split('_')[0];
  const filename = buildPath(settings, vars, download.ext);
  log('naming', shortUrl(url), '->', filename, vars);
  await remember({ from: shortUrl(url), to: filename, lookedUp: !!details });
  return { filename, conflictAction: settings.conflict };
}

function fulfillUrlOf(item) {
  return [item.url, item.finalUrl].find(u => u && parseFulfillUrl(u));
}

// Note when each Libby download starts, so the page can move on as soon as it has (Libby does not
// always show its "Done" screen).
api.downloads.onCreated.addListener(async item => {
  const download = parseFulfillUrl(fulfillUrlOf(item) || '');
  if (!download) return;
  const { started = {} } = await sessionStore.get('started');
  started[download.overdriveId] = Date.now();
  await sessionStore.set({ started });
  log('download started for', download.overdriveId);
});

// OverDrive's download server answers 429 Too Many Requests when books are fetched too fast.
// Only watched, never changed: the page uses this to back off and retry.
api.webRequest?.onHeadersReceived.addListener(async details => {
  if (details.statusCode !== 429 || !parseFulfillUrl(details.url)) return;
  await sessionStore.set({ rateLimited: { at: Date.now(), url: shortUrl(details.url) } });
  fail('download server said 429 Too Many Requests for', shortUrl(details.url));
}, { urls: ['https://*.contentreserve.com/*'] });

if (api.downloads.onDeterminingFilename) {
  // Chrome and Edge: suggest the name as the download starts.
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const url = fulfillUrlOf(item);
    if (!url) return;  // not a Libby download: leave it alone
    targetFor(url)
      .then(t => (t ? suggest({ filename: t.filename, conflictAction: t.conflictAction }) : suggest()))
      .catch(err => {
        fail('could not name', shortUrl(url), '- kept the browser\'s name:', err);
        remember({ from: shortUrl(url), to: '(browser default)', error: String(err) });
        suggest();
      });
    return true;  // suggest() is called asynchronously
  });
} else {
  // Firefox has no way to rename a download in flight. So fetch the same link again under the
  // right name, and remove Libby's copy only once ours has finished: if ours fails, Libby's copy
  // is kept under its own name rather than losing the book.
  const ours = new Set();
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
    const url = fulfillUrlOf(item);
    if (!url || ours.has(item.url)) return;
    try {
      const t = await targetFor(url);
      if (!t) return;
      ours.add(item.url);
      const id = await api.downloads.download({ url: item.url, filename: t.filename, conflictAction: t.conflictAction });
      replacing.set(id, item.id);
      // A tiny .acsm can finish before we start listening for it.
      const [now] = await api.downloads.search({ id });
      if (now && now.state !== 'in_progress') await settle(id, now.state, now.error);
    } catch (err) {
      fail('could not re-download', shortUrl(url), 'under the new name:', err);
      remember({ from: shortUrl(url), to: '(failed)', error: String(err) });
    }
  });
  api.downloads.onChanged.addListener(delta => {
    if (delta.state) settle(delta.id, delta.state.current, delta.error?.current);
  });
}

api.action.onClicked.addListener(() => api.runtime.openOptionsPage());

// 0.1.7 and 0.1.8 defaulted to a 3-second wait between books; the default is now none.
api.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason !== 'update' || !['0.1.7', '0.1.8'].includes(previousVersion)) return;
  const { settings } = await api.storage.local.get('settings');
  if (settings?.delay === 3) await api.storage.local.set({ settings: { ...settings, delay: 0 } });
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
        const { expected = {} } = await sessionStore.get('expected');
        expected[msg.overdriveId] = msg.format;
        await sessionStore.set({ expected });
        return true;
      }
      case 'downloaded': {
        const found = await api.downloads.search({
          urlRegex: `contentreserve\\.com/[^?]*_${msg.overdriveId}\\.(acsm|epub|pdf)`,
        });
        return found.some(d => d.state !== 'interrupted' && d.exists !== false);
      }
      case 'started': {
        const { started = {} } = await sessionStore.get('started');
        return (started[msg.overdriveId] || 0) >= msg.since;
      }
      case 'rateLimited': {
        const { rateLimited } = await sessionStore.get('rateLimited');
        return rateLimited && rateLimited.at >= msg.since ? rateLimited : null;
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
