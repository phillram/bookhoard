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
  try { details = await media(download.overdriveId); } catch { /* name from the URL alone */ }
  const vars = variables(details, download, await expectedFormat(download.overdriveId));
  if (!vars.title) vars.title = new URL(url).pathname.split('/').pop().split('_')[0];
  return { filename: buildPath(settings, vars, download.ext), conflictAction: settings.conflict };
}

function fulfillUrlOf(item) {
  return [item.url, item.finalUrl].find(u => u && parseFulfillUrl(u));
}

if (api.downloads.onDeterminingFilename) {
  // Chrome and Edge: suggest the name as the download starts.
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const url = fulfillUrlOf(item);
    if (!url) return;  // not a Libby download: leave it alone
    targetFor(url)
      .then(t => (t ? suggest({ filename: t.filename, conflictAction: t.conflictAction }) : suggest()))
      .catch(() => suggest());
    return true;  // suggest() is called asynchronously
  });
} else {
  // Firefox has no way to rename a download in flight, so cancel Libby's copy and download the
  // same link again under the right name.
  const ours = new Set();
  api.downloads.onCreated.addListener(async item => {
    const url = fulfillUrlOf(item);
    if (!url || ours.has(item.url)) return;
    const t = await targetFor(url);
    if (!t) return;
    ours.add(item.url);
    try {
      await api.downloads.cancel(item.id);
      await api.downloads.erase({ id: item.id });
    } catch { /* already finished or gone */ }
    await api.downloads.download({ url: item.url, filename: t.filename, conflictAction: t.conflictAction });
  });
}

api.action.onClicked.addListener(() => api.runtime.openOptionsPage());

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'media': {
        try {
          const m = await media(msg.overdriveId);
          return { title: m.title, formats: formatIds(m) };
        } catch {
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
      default:
        return undefined;
    }
  })().then(sendResponse, () => sendResponse(undefined));
  return true;
});
