// Host page: controls the big screen and makes the QR code for the entrance sign.
import { config } from './config.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
let msgTimer;
function flash(text) {
  $('msg').textContent = text;
  $('msg').classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => $('msg').classList.remove('show'), 1800);
}

addEventListener('unhandledrejection', (e) => flash(e.reason?.message || 'Something went wrong'));

// ---------- big screen settings ----------
let titleTimer;
async function loadSettings() {
  const s = await store.getSettings();
  if (document.activeElement !== $('titleInput')) $('titleInput').value = s.title;
  $('spotToggle').checked = !!s.spotlight;
  $('cutToggle').checked = !!s.cut;
}
$('titleInput').oninput = (e) => {
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => store.saveSettings({ title: e.target.value }), 300);
};
$('spotToggle').onchange = (e) => store.saveSettings({ spotlight: e.target.checked }).then(() => flash('Saved'));
$('cutToggle').onchange = (e) => store.saveSettings({ cut: e.target.checked }).then(() => flash('Saved'));
$('spotBtn').onclick = () => store.sendCommand({ name: 'spotlight' }).then(() => flash('Spotlight sent to the big screen'));

// ---------- photos list ----------
// Rows are kept and updated in place (not rebuilt), so a name being typed isn't lost when a photo arrives.
const rows = new Map(); // id → { li, img, input, meta, url, photo }
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function makeRow(p) {
  const li = document.createElement('li'); li.className = 'photo';
  const img = new Image(); img.alt = ''; img.loading = 'lazy';
  const info = document.createElement('div'); info.className = 'info';
  const input = document.createElement('input');
  input.className = 'name-input'; input.type = 'text'; input.dir = 'auto'; input.maxLength = 40;
  input.placeholder = 'Add a name'; input.setAttribute('aria-label', 'Name');
  const meta = document.createElement('div'); meta.className = 'meta';
  info.append(input, meta);
  const actions = document.createElement('div'); actions.className = 'row-actions';
  const star = document.createElement('button'); star.className = 'btn sm'; star.type = 'button'; star.textContent = 'Spotlight';
  const del = document.createElement('button'); del.className = 'btn sm danger'; del.type = 'button'; del.textContent = 'Remove';
  actions.append(star, del);
  li.append(img, info, actions);
  const row = { li, img, input, meta, url: null, photo: p };

  // rename: Enter or leaving the field saves, Escape undoes
  const save = async () => {
    const name = input.value.trim();
    if (name === (row.photo.name || '')) return;
    try {
      await store.renamePhoto(row.photo.id, name);
      row.photo.name = name;
      showMeta(row, 'Saved');
    } catch (e) {
      console.error(e);
      input.value = row.photo.name || '';
      flash(/host_rename_photo|function/i.test(e.message || '')
        ? 'Renaming needs a one-time database update (see supabase-update-rename.sql)'
        : "Couldn't save the name. Check the internet and try again.");
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = row.photo.name || ''; input.blur(); }
  };
  input.onblur = save;
  star.onclick = () => store.sendCommand({ name: 'spotlight', id: row.photo.id }).then(() => flash('Spotlight sent to the big screen'));
  del.onclick = () => {
    if (confirm(`Remove ${row.photo.name || 'this photo'} from the big screen?`)) store.deletePhoto(row.photo.id).then(() => flash('Photo removed'));
  };
  return row;
}

function showMeta(row, note) {
  row.meta.replaceChildren(document.createTextNode('Added ' + timeFmt.format(row.photo.created)));
  if (note) {
    const s = document.createElement('span'); s.className = 'saved'; s.textContent = ' · ' + note;
    row.meta.appendChild(s);
    setTimeout(() => { if (s.isConnected) s.remove(); }, 2000);
  }
}

async function renderList() {
  const photos = await store.listPhotos();
  $('count').textContent = photos.length;
  const list = $('list'), ids = new Set(photos.map((p) => p.id));
  for (const [id, row] of rows) if (!ids.has(id)) { row.li.remove(); if (row.url) URL.revokeObjectURL(row.url); rows.delete(id); }

  let prev = null;
  for (const p of [...photos].reverse()) { // newest first
    let row = rows.get(p.id);
    if (!row) {
      row = makeRow(p); rows.set(p.id, row);
      store.getPhoto(p.id).then((blob) => { if (blob && rows.get(p.id) === row) { row.url = URL.createObjectURL(blob); row.img.src = row.url; } });
    }
    row.photo = { ...row.photo, ...p };
    if (document.activeElement !== row.input) row.input.value = p.name || '';
    showMeta(row);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (row.li !== want) list.insertBefore(row.li, want);
    prev = row.li;
  }
  list.querySelector('.empty')?.remove();
  if (!photos.length) {
    const e = document.createElement('li'); e.className = 'empty'; e.textContent = 'No photos yet. They appear here as guests send them.';
    list.appendChild(e);
  }
}
$('clearBtn').onclick = async () => {
  if (!confirm('Remove ALL photos from the big screen and from storage? This cannot be undone.')) return;
  await store.clearPhotos();
  flash('All photos removed');
};

// ---------- add from this device ----------
$('fileInput').onchange = async (e) => {
  const name = $('nameInput').value.trim();
  const files = [...e.target.files];
  e.target.value = '';
  $('nameInput').value = '';
  for (const f of files) {
    try { await store.addPhoto({ name, blob: f }); } catch (err) { console.error(err); flash('Could not save the photo'); }
  }
  if (files.length) flash(files.length > 1 ? files.length + ' photos sent to the big screen' : 'Photo sent to the big screen');
};

// ---------- QR code for the sign ----------
const uploadUrl = config.uploadUrl || new URL('upload.html', location.href).href;
$('uploadLink').value = uploadUrl;
$('openUpload').href = uploadUrl;
$('qrNote').textContent = /^(http:\/\/)?(localhost|127\.0\.0\.1)/.test(uploadUrl) || location.protocol === 'file:'
  ? "This is a local test link, so phones can't open it. Download the QR for printing only once the site is live."
  : 'For the sign: print it at least 4 cm wide, with a white margin around it.';
$('copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText(uploadUrl); flash('Link copied'); } catch { $('uploadLink').select(); }
};

let qr = null;
try {
  qr = window.qrcode(0, 'Q'); // 'Q' = strong error correction, still scans if the sign gets a bit scuffed
  qr.addData(uploadUrl);
  qr.make();
} catch (e) { console.error(e); }

function qrSvg(quiet = 4) {
  const n = qr.getModuleCount(), size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

if (qr) {
  $('qrPreview').innerHTML = qrSvg(0);
  $('dlSvg').onclick = () => download(new Blob([qrSvg()], { type: 'image/svg+xml' }), 'ori-space-party-qr.svg');
  $('dlPng').onclick = () => {
    const quiet = 4, n = qr.getModuleCount(), cell = Math.ceil(2400 / (n + quiet * 2));
    const c = document.createElement('canvas');
    c.width = c.height = (n + quiet * 2) * cell;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) g.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    c.toBlob((b) => download(b, 'ori-space-party-qr.png'), 'image/png');
  };
} else {
  $('qrPreview').textContent = 'QR library failed to load (check the internet connection).';
  $('dlPng').disabled = $('dlSvg').disabled = true;
}

// ---------- login: password typed once per device, then remembered ----------
// (The old secret link …/host.html#key=XXXX still works too.)
const KEY_STORE = 'ori-host-key';
const saveKey = (k) => { try { localStorage.setItem(KEY_STORE, k); } catch {} };
const forgetKey = () => { try { localStorage.removeItem(KEY_STORE); } catch {} };
function readKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('key');
  if (fromHash) {
    saveKey(fromHash);
    history.replaceState(null, '', location.pathname); // keep the key off the screen
    return fromHash;
  }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

async function tryKey(key) {
  store.setHostKey(key);
  try { return await store.checkHostKey(); } catch (e) { console.error(e); return null; } // null = network trouble
}

function askForPassword() {
  return new Promise((resolve) => {
    $('lock').hidden = false;
    $('pwInput').focus();
    $('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const pw = $('pwInput').value.trim();
      $('loginBtn').disabled = true;
      $('loginErr').textContent = '';
      const ok = await tryKey(pw);
      $('loginBtn').disabled = false;
      if (ok) { saveKey(pw); $('lock').hidden = true; $('pwInput').value = ''; resolve(); }
      else {
        $('loginErr').textContent = ok === null ? "Couldn't reach the server. Check the internet and try again." : 'Wrong password.';
        $('pwInput').select();
      }
    };
  });
}

$('logoutBtn').onclick = () => { forgetKey(); location.reload(); };

(async () => {
  const ok = await tryKey(readKey()); // local test mode always says yes
  if (!ok) {
    if (ok === false) forgetKey(); // wrong/old password; keep it if it was just a network hiccup
    await askForPassword();
  }

  // ---------- stay in sync ----------
  let listTimer;
  const refreshList = () => { clearTimeout(listTimer); listTimer = setTimeout(renderList, 250); };
  store.onChange((ev) => {
    if (ev.type === 'settings') loadSettings();
    else if (['added', 'deleted', 'cleared', 'renamed'].includes(ev.type)) refreshList();
  });
  loadSettings();
  renderList();
})();
