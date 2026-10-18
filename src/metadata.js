// Book details from OverDrive's public catalog API, and the details that can be read from a
// fulfillment download URL.

export async function fetchMedia(overdriveId) {
  const r = await fetch(`https://thunder.api.overdrive.com/v2/media/${encodeURIComponent(overdriveId)}`);
  if (!r.ok) throw new Error(`OverDrive catalog returned ${r.status} for ${overdriveId}`);
  return r.json();
}

// The formats a title is published in, e.g. ['ebook-epub-adobe', 'ebook-kindle'].
export function formatIds(media) {
  return (media?.formats || []).map(f => f.id);
}

// Download URLs look like
//   https://fulfill.contentreserve.com/ChildrenofTime_9780316452496_4056736.acsm?RetailerID=LosAngeles&...
//   https://fulfill.contentreserve.com/RogueProtocol_9781250185433_3462640.epub?RetailerID=santaclara&...
// .acsm is an Adobe (DRM) ticket; .epub / .pdf is the DRM-free book itself.
export function parseFulfillUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)contentreserve\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/_([0-9Xx]{10,13})_(\d+)\.(acsm|epub|pdf)$/i);
  if (!m) return null;
  const ext = m[3].toLowerCase();
  return {
    isbn: m[1],
    overdriveId: m[2],
    ext,
    drm: ext === 'acsm' ? 'DRM' : 'DRM-free',
    library: u.searchParams.get('RetailerID') || '',
  };
}

function lastNameFirst(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}` : name;
}

// Template variables for one download.
export function variables(media, download, format) {
  const m = media || {};
  let authors = (m.creators || []).filter(c => /author/i.test(c.role || '')).map(c => c.name);
  if (!authors.length && m.firstCreatorName) authors = [m.firstCreatorName];
  const date = (m.publishDate || m.estimatedReleaseDate || '').slice(0, 10);
  const anyIsbn = (m.formats || []).flatMap(f => f.identifiers || []).find(i => i.type === 'ISBN')?.value;
  return {
    title: m.title || '',
    subtitle: m.subtitle || '',
    author: authors[0] || '',
    authors: authors.join(' & '),
    authorSort: authors[0] ? lastNameFirst(authors[0]) : '',
    series: m.detailedSeries?.seriesName || m.series || '',
    seriesNumber: m.detailedSeries?.readingOrder || '',
    publisher: m.publisher?.name || '',
    year: date.slice(0, 4),
    date,
    isbn: download.isbn || anyIsbn || '',
    overdriveId: String(m.id || download.overdriveId || ''),
    format: format || (download.ext === 'pdf' ? 'PDF' : 'EPUB'),
    drm: download.drm,
    library: download.library,
    language: m.languages?.[0]?.name || '',
  };
}
