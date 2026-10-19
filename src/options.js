import { DEFAULTS, VARIABLES, SAMPLE, buildPath, unknownVariables } from './template.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
const FIELDS = ['folder', 'template', 'formatOrder', 'conflict', 'skipDownloaded', 'limit', 'delay', 'debug'];

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
    [buildPath(s, SAMPLE, 'acsm'), 'copy-protected EPUB'],
    [buildPath(s, STANDALONE, 'pdf'), 'DRM-free PDF, no series'],
  ];
  $('preview').replaceChildren(...lines.map(([path, what]) => {
    const div = document.createElement('div');
    const code = document.createElement('code');
    code.textContent = 'Downloads/' + path;
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = '  (' + what + ')';
    div.append(code, note);
    return div;
  }));
  const unknown = unknownVariables(s.template);
  $('unknown').hidden = !unknown.length;
  $('unknown').textContent = unknown.length
    ? `Not a variable, so it will be left empty: ${unknown.map(n => '{' + n + '}').join(', ')}`
    : '';
}

let savedTimer;
async function save() {
  await api.storage.local.set({ settings: current() });
  $('saved').textContent = 'Saved.';
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
    else el.value = el.type === 'number' ? (s[f] || '') : s[f];
  }
  $('vars').replaceChildren(...VARIABLES.map(([name, what, example]) => {
    const tr = document.createElement('tr');
    const td = (child, cls) => {
      const cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.append(child);
      return cell;
    };
    const code = document.createElement('code');
    code.textContent = '{' + name + '}';
    code.title = 'Add to the template';
    code.addEventListener('click', () => insertVariable(name));
    tr.append(td(code), td(what), td(example || '(often empty)', 'muted'));
    return tr;
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
