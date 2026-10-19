import { DEFAULTS, VARIABLES, SAMPLE, buildPath, unknownVariables } from './template.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
const FIELDS = ['folder', 'template', 'formatOrder', 'conflict', 'skipDownloaded', 'limit', 'batchPause', 'batchSize', 'debug'];

// A second example with no series and a DRM-free PDF, to show optional parts dropping out.
const STANDALONE = {
  ...SAMPLE, title: 'Piranesi', author: 'Susanna Clarke', authors: 'Susanna Clarke',
  authorSort: 'Clarke, Susanna', series: '', seriesNumber: '', publisher: 'Bloomsbury',
  year: '2020', date: '2020-09-15', isbn: '9781635575644', overdriveId: '5387639',
  format: 'PDF', drm: 'DRM-free',
};

function current() {
  const s = {};
  for (const f of FIELDS) {
    const el = $(f);
    s[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : el.value;
  }
  if (!s.template.trim()) s.template = DEFAULTS.template;
  return s;
}

function preview() {
  const s = current();
  const lines = [
    [buildPath(s, SAMPLE, 'acsm'), 'book in a series'],
    [buildPath(s, STANDALONE, 'pdf'), 'standalone book'],
  ];
  $('preview').replaceChildren(...lines.map(([path, what]) => {
    const div = document.createElement('div');
    const code = document.createElement('code');
    code.textContent = 'Downloads/' + path;
    const note = document.createElement('span');
    note.textContent = what;
    div.append(code, note);
    return div;
  }));
  const unknown = unknownVariables(s.template);
  $('unknown').hidden = !unknown.length;
  $('unknown').textContent = unknown.length
    ? `${unknown.map(n => '{' + n + '}').join(', ')} isn't a field, so it will come out blank.`
    : '';
}

let savedTimer;
async function save() {
  await api.storage.local.set({ settings: current() });
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
}

function insertVariable(name) {
  const el = $('template');
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const token = '{' + name + '}';
  el.value = el.value.slice(0, start) + token + el.value.slice(end);
  el.focus();
  el.setSelectionRange(start + token.length, start + token.length);
  preview();
  save();
}

async function init() {
  const { settings = {} } = await api.storage.local.get('settings');
  const s = { ...DEFAULTS, ...settings };
  for (const f of FIELDS) {
    const el = $(f);
    if (el.type === 'checkbox') el.checked = !!s[f];
    // "Download at most" shows blank for no limit; the wait shows its number, including 0.
    else el.value = f === 'limit' ? (s[f] || '') : s[f];
  }
  // Each field is a button: click to add it to the name pattern. Hover shows an example.
  $('vars').replaceChildren(...VARIABLES.map(([name, what, example]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = example ? `For example: ${example}` : 'Often empty';
    const code = document.createElement('code');
    code.textContent = '{' + name + '}';
    const label = document.createElement('span');
    label.textContent = what;
    button.append(code, label);
    button.addEventListener('click', () => insertVariable(name));
    return button;
  }));
  for (const f of FIELDS) {
    $(f).addEventListener('input', preview);
    $(f).addEventListener('change', save);
  }
  $('template').addEventListener('input', save);
  $('folder').addEventListener('input', save);
  $('resetTemplate').addEventListener('click', () => {
    $('template').value = DEFAULTS.template;
    preview();
    save();
  });
  preview();
}

init();
