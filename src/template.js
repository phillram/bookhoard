// File-name templates: settings defaults, the variables a template can use, and turning a
// template plus a book's details into a safe relative download path.

export const DEFAULTS = {
  folder: '',                      // subfolder inside the browser's Downloads folder; '' = Downloads itself
  template: '{title} - {author}',
  formatOrder: 'epub-pdf',         // 'epub-pdf' | 'epub' | 'pdf-epub'
  conflict: 'uniquify',            // 'uniquify' | 'overwrite'
  skipDownloaded: true,
  includeLocked: false,
  limit: 0,                        // most books per run; 0 = no limit
};

// [name, description, example]
export const VARIABLES = [
  ['title', 'Title', 'Children of Time'],
  ['subtitle', 'Subtitle', ''],
  ['author', 'First author', 'Adrian Tchaikovsky'],
  ['authors', 'All authors, joined with &', 'Adrian Tchaikovsky'],
  ['authorSort', 'First author, last name first', 'Tchaikovsky, Adrian'],
  ['series', 'Series name', 'Children of Time'],
  ['seriesNumber', 'Number in the series', '1'],
  ['publisher', 'Publisher', 'Orbit'],
  ['year', 'Year this edition was published', '2018'],
  ['date', 'Publication date, YYYY-MM-DD', '2018-09-18'],
  ['isbn', 'ISBN of the edition downloaded', '9780316452496'],
  ['overdriveId', 'OverDrive / Libby title ID', '4056736'],
  ['format', 'EPUB or PDF', 'EPUB'],
  ['drm', 'DRM or DRM-free', 'DRM'],
  ['library', 'Library, as OverDrive names it', 'LosAngeles'],
  ['language', 'Language', 'English'],
];

export const SAMPLE = Object.fromEntries(VARIABLES.map(([name, , example]) => [name, example]));

const KNOWN = new Set(VARIABLES.map(([name]) => name));

// Names in a template that are not variables, e.g. a typo like {tilte}.
export function unknownVariables(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(n => !KNOWN.has(n));
}

// Fill in a template. Text inside < > is optional: it is dropped when any variable inside it is
// empty, so "<{series} {seriesNumber} - >{title}" leaves out the series part for standalone books.
export function render(template, vars) {
  const value = name => (vars[name] == null ? '' : String(vars[name]));
  const filled = template.replace(/<([^<>]*)>/g, (_, inner) => {
    let empty = false;
    const out = inner.replace(/\{(\w+)\}/g, (_m, name) => {
      if (!value(name)) empty = true;
      return value(name);
    });
    return empty ? '' : out;
  });
  return filled.replace(/\{(\w+)\}/g, (_m, name) => value(name));
}

const ILLEGAL = /[\\:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function cleanSegment(s) {
  let out = s.replace(ILLEGAL, '').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (out.length > 120) out = out.slice(0, 120).trim();
  return RESERVED.test(out) ? out + '_' : out;
}

// Relative path (forward slashes) for a download: folder setting + rendered template + extension.
// "/" in the template makes subfolders, e.g. "{author}/{title}".
export function buildPath(settings, vars, ext) {
  const folder = (settings.folder || '').split(/[\\/]+/);
  const name = render(settings.template || DEFAULTS.template, vars).split('/');
  const segments = [...folder, ...name].map(cleanSegment).filter(Boolean);
  const nameParts = name.map(cleanSegment).filter(Boolean);
  if (!nameParts.length) segments.push(vars.overdriveId || 'libby-download');
  segments[segments.length - 1] += '.' + ext;
  return segments.join('/');
}
