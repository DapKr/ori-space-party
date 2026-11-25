// Projector "show" page: space scene, floating kids, cut-out processing, host menu.
import { config } from './config.js';
import * as store from './store.js';
import { cutRocket, lastMiss as rocketMiss } from './rocket.js';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutBack = (t) => { const c = 1.7; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

// ---------- cut-out cache (this laptop only, so a reload doesn't re-cut everyone) ----------
const CUT_VERSION = 9; // bump when the cutting changes, so photos cut the old way get cut again
const cacheDb = new Promise((res) => {
  try {
    const r = indexedDB.open('ori-space-show', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cutouts', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch { res(null); }
});
async function cacheDo(mode, fn) {
  const db = await cacheDb;
  if (!db) return null;
  return new Promise((res) => {
    const t = db.transaction('cutouts', mode);
    const req = fn(t.objectStore('cutouts'));
    t.oncomplete = () => res(req ? req.result : null);
    t.onerror = () => res(null);
  });
}
const cache = {
  get: (id) => cacheDo('readonly', (s) => s.get(id)),
  put: (rec) => cacheDo('readwrite', (s) => s.put(rec)),
  del: (id) => cacheDo('readwrite', (s) => s.delete(id)),
  clear: () => cacheDo('readwrite', (s) => s.clear()),
};

// ---------- sky (canvas) ----------
const sky = $('sky');
const ctx = sky.getContext('2d');
let W = 0, H = 0, DPR = 1, stars = [], nebula = null;
const particles = [];
const shooting = [];
let nextShoot = performance.now() + 3000;

function buildNebula() {
  nebula = document.createElement('canvas');
  nebula.width = Math.max(1, W * DPR); nebula.height = Math.max(1, H * DPR);
  const n = nebula.getContext('2d');
  n.scale(DPR, DPR);
  const g = n.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#04051a'); g.addColorStop(1, '#0c0b30');
  n.fillStyle = g; n.fillRect(0, 0, W, H);
  n.globalCompositeOperation = 'lighter';
  const clouds = [
    [0.2, 0.3, 0.5, 'rgba(120, 60, 200, 0.22)'],
    [0.8, 0.25, 0.45, 'rgba(40, 120, 220, 0.20)'],
    [0.65, 0.8, 0.55, 'rgba(220, 60, 140, 0.16)'],
    [0.15, 0.85, 0.4, 'rgba(30, 170, 190, 0.14)'],
    [0.5, 0.5, 0.35, 'rgba(90, 80, 220, 0.10)'],
  ];
  for (const [x, y, r, c] of clouds) {
    const rad = Math.max(1, r * Math.max(W, H));
    const rg = n.createRadialGradient(x * W, y * H, 0, x * W, y * H, rad);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    n.fillStyle = rg; n.fillRect(0, 0, W, H);
  }
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  sky.width = Math.max(1, W * DPR); sky.height = Math.max(1, H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const count = Math.round((W * H) / 2600);
  stars = Array.from({ length: count }, () => {
    const layer = Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2;
    return { x: Math.random() * W, y: Math.random() * H, layer,
      r: [0.6, 1.1, 1.8][layer] * rand(0.7, 1.3), tw: rand(0.5, 2.5), ph: rand(0, 6.28),
      hue: Math.random() < 0.15 ? rand(180, 230) : Math.random() < 0.1 ? rand(20, 50) : 0 };
  });
  buildNebula();
}
resize();

function drawPlanet(x, y, r, c1, c2, ring) {
  const ringArc = (from, to, alpha) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35);
    ctx.strokeStyle = `rgba(255, 215, 165, ${alpha})`; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.9, r * 0.5, 0, from, to); ctx.stroke();
    ctx.restore();
  };
  if (ring) ringArc(Math.PI, Math.PI * 2, 0.45);
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (ring) ringArc(0, Math.PI, 0.6);
}

function drawSky(dt, now) {
  const t = now / 1000;
  ctx.drawImage(nebula, 0, 0, W, H);

  const m = Math.min(W, H);
  drawPlanet(W * 0.1 + Math.sin(t * 0.05) * 20, H * 0.62 + Math.cos(t * 0.04) * 12, m * 0.09, '#ffcf8a', '#b0532d', true);
  drawPlanet(W * 0.9 + Math.cos(t * 0.06) * 14, H * 0.2 + Math.sin(t * 0.05) * 10, m * 0.045, '#9fe0ff', '#2a4fb0', false);
  drawPlanet(W * 0.78 + Math.sin(t * 0.03) * 10, H * 0.88, m * 0.025, '#ffa8c8', '#8a2b6b', false);

  const speeds = [4, 10, 22];
  for (const s of stars) {
    s.x -= speeds[s.layer] * dt;
    if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
    const a = 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
    ctx.fillStyle = s.hue ? `hsla(${s.hue}, 90%, 80%, ${a})` : `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }

  if (now > nextShoot) {
    nextShoot = now + rand(3500, 9000);
    shooting.push({ x: rand(W * 0.2, W * 1.1), y: rand(-20, H * 0.4), vx: -rand(700, 1100), vy: rand(250, 450), life: 1 });
  }
  ctx.lineCap = 'round';
  for (let i = shooting.length - 1; i >= 0; i--) {
    const s = shooting[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.9;
    if (s.life <= 0) { shooting.splice(i, 1); continue; }
    const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.15, s.y - s.vy * 0.15);
    g.addColorStop(0, `rgba(255,255,255,${s.life})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.15, s.y - s.vy * 0.15); ctx.stroke();
  }

  ctx.globalCompositeOperation = 'lighter';
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    const k = p.life / p.max;
    ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${k * 0.8})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + k), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- floating kids ----------
const stage = $('stage');
const sprites = [];
let featured = null;          // { s, start, dur, label }
const featureQueue = [];
let lastFeatureEnd = performance.now();
let settings = { ...config.defaults }; // replaced by the saved host settings on start

function baseHeight() {
  const n = Math.max(1, sprites.length);
  return H * Math.min(0.42, 0.95 / Math.sqrt(n + 0.8));
}

async function addSprite({ id, name, blob }, feature) {
  if (sprites.some((s) => s.id === id)) return;
  const url = URL.createObjectURL(blob);
  const el = new Image();
  el.className = 'kid';
  el.alt = name || 'space explorer';
  el.draggable = false;
  el.src = url;
  try { await el.decode(); } catch {}
  if (!known.has(id)) { URL.revokeObjectURL(url); return; } // deleted while loading
  const aspect = (el.naturalWidth || 1) / (el.naturalHeight || 1);
  const ang = rand(0, Math.PI * 2);
  const sp = rand(28, 50) * (H / 1080);
  const s = { id, name: name || '', url, el, aspect,
    x: feature ? W / 2 : rand(W * 0.2, W * 0.8), y: feature ? H / 2 : rand(H * 0.25, H * 0.8),
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    ph: rand(0, 6.28), rs: rand(0.35, 0.7), born: performance.now(), emit: 0, hue: rand(0, 360) };
  sprites.push(s);
  stage.appendChild(el);
  if (feature) featureQueue.push({ s, label: s.name ? `ברוכים הבאים לחלל, ${s.name}! 🚀` : 'שיגור חדש לחלל! 🚀' });
  refreshUI();
}

function removeSprite(id) {
  const i = sprites.findIndex((s) => s.id === id);
  if (i < 0) return;
  const [s] = sprites.splice(i, 1);
  s.el.remove();
  URL.revokeObjectURL(s.url);
  if (featured && featured.s === s) endFeature(performance.now());
  refreshUI();
}

function spotlight(s) {
  if (!s) s = sprites[Math.floor(Math.random() * sprites.length)];
  if (!s) return;
  featureQueue.push({ s, label: s.name ? `🌟 תראו מי פה: ${s.name}! 🌟` : '🌟 כוכבי החלל שלנו! 🌟' });
}

const banner = $('banner');
function endFeature(now) {
  if (featured) featured.s.el.style.zIndex = '';
  featured = null;
  banner.classList.remove('show');
  lastFeatureEnd = now;
}

const IN = 1000, OUT = 1000, DUR = 6000;

function animateKids(dt, now) {
  const t = now / 1000;

  if (!featured && featureQueue.length) {
    const q = featureQueue.shift();
    if (sprites.includes(q.s)) {
      featured = { ...q, start: now, dur: DUR };
      q.s.el.style.zIndex = 10;
      banner.textContent = q.label;
      banner.classList.add('show');
    }
  }
  if (featured) {
    const el = now - featured.start;
    if (el > featured.dur - OUT) banner.classList.remove('show');
    if (el > featured.dur) endFeature(now);
  } else if (settings.spotlight && sprites.length > 1 && now - lastFeatureEnd > 20000) {
    spotlight();
  }
  let fe = 0;
  if (featured) {
    const el = now - featured.start;
    fe = smooth(Math.min(1, el / IN)) * smooth(Math.min(1, Math.max(0, (featured.dur - el) / OUT)));
  }

  const base = baseHeight();
  for (const s of sprites) {
    let h = base, w = h * s.aspect;
    if (w > base * 1.3) { w = base * 1.3; h = w / s.aspect; }
    s.x += s.vx * dt; s.y += s.vy * dt;
    const minX = Math.min(w / 2, W / 2), minY = Math.min(h / 2, H / 2);
    if (s.x < minX) { s.x = minX; s.vx = Math.abs(s.vx); }
    if (s.x > W - minX) { s.x = W - minX; s.vx = -Math.abs(s.vx); }
    if (s.y < minY) { s.y = minY; s.vy = Math.abs(s.vy); }
    if (s.y > H - minY) { s.y = H - minY; s.vy = -Math.abs(s.vy); }

    let x = s.x, y = s.y + Math.sin(t * 0.9 + s.ph) * h * 0.03;
    let rot = Math.sin(t * s.rs + s.ph) * 8;
    let opacity = 1;
    const pop = easeOutBack(Math.min(1, (now - s.born) / 900));

    if (featured && featured.s === s) {
      const fh = Math.min(H * 0.72, (W * 0.8) / s.aspect);
      const bigH = lerp(h, fh, fe);
      x = lerp(x, W / 2, fe); y = lerp(y, H * 0.47, fe);
      rot *= 1 - fe;
      w = bigH * s.aspect; h = bigH;
    } else if (featured) {
      opacity = 1 - 0.5 * fe;
    }
    w *= pop; h *= pop;

    s.el.style.width = w + 'px';
    s.el.style.height = h + 'px';
    s.el.style.opacity = opacity;
    s.el.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${rot}deg)`;

    s.emit += dt;
    while (s.emit > 0.06 && particles.length < 700) {
      s.emit -= 0.06;
      const vl = Math.hypot(s.vx, s.vy) || 1;
      const dx = -s.vx / vl, dy = -s.vy / vl;
      particles.push({ x: x + dx * w * 0.32 + rand(-w * 0.12, w * 0.12), y: y + dy * h * 0.32 + rand(-h * 0.08, h * 0.08),
        vx: dx * rand(15, 40) + rand(-8, 8), vy: dy * rand(15, 40) + rand(-8, 8),
        r: rand(1.5, 3.5) * (h / 300 + 0.5), life: 1.6, max: 1.6, hue: (s.hue + rand(-30, 30) + t * 20) % 360 });
    }
  }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); // schedule first so one bad frame never stops the show
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (innerWidth !== W || innerHeight !== H) resize();
  if (!W || !H) return;
  try { drawSky(dt, now); } catch (e) { console.error(e); }
  try { animateKids(dt, now); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);

// ---------- cutting out photos ----------
let bgLib = null;
function loadLib() {
  if (!bgLib) {
    bgLib = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm')
      .catch((e) => { bgLib = null; throw e; });
  }
  return bgLib;
}

const toBlob = (canvas, type = 'image/png', q) => new Promise((res) => canvas.toBlob(res, type, q));

// downscale big photos (and fix EXIF rotation) before cutting
async function prepare(blob, max = 1600) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return toBlob(c, 'image/png');
}

// crop away fully transparent edges so the cut-out fills its box
async function trim(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return blob;
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return toBlob(o, 'image/png');
}

// ---------- processing queue ----------
const known = new Set();   // photo ids that are queued or on screen
const jobs = [];           // [{ meta: {id, name}, feature }]
let busy = false;
const toast = $('toast'), toastText = $('toastText'), toastBar = $('toastBar');

function setToast(text, pct) {
  toast.classList.add('show');
  toastText.textContent = text;
  toastBar.style.width = (pct == null ? 0 : Math.round(pct * 100)) + '%';
}

function queuePhoto(meta, feature) {
  if (known.has(meta.id)) return;
  known.add(meta.id);
  jobs.push({ meta, feature });
  runJobs();
}

async function runJobs() {
  if (busy) return;
  busy = true;
  while (jobs.length) {
    const { meta, feature } = jobs.shift();
    if (!known.has(meta.id)) continue;
    const waiting = jobs.length ? ` (עוד ${jobs.length} בתור)` : '';
    let original;
    try {
      setToast(`🚀 עוד רגע מגיעים לחלל…${waiting}`, 0.05);
      original = await store.getPhoto(meta.id);
      if (!original) { known.delete(meta.id); continue; }
      let out = await prepare(original);
      let cut = false;
      // Kids posing in Ori's rocket: cut out exactly the rocket (faces in the windows), nothing around it.
      const rocket = settings.cut ? await cutRocket(out).catch((e) => { console.warn(e); return null; }) : null;
      if (rocket) {
        out = rocket;
        cut = true;
      } else if (settings.cut) {
        console.info('No rocket found, using general background removal:', rocketMiss);
        const lib = await loadLib();
        const seen = {};
        out = await lib.removeBackground(out, {
          output: { format: 'image/png' },
          progress: (key, cur, tot) => {
            if (key.startsWith('fetch') && tot) {
              seen[key] = cur / tot;
              const vals = Object.values(seen);
              setToast(`מכינים את קסם הגזירה (רק בפעם הראשונה)…${waiting}`,
                0.1 + (vals.reduce((a, b) => a + b, 0) / vals.length) * 0.6);
            } else if (key.startsWith('compute')) {
              setToast(`✂️ גוזרים את התמונה…${waiting}`, 0.75 + (tot ? (cur / tot) * 0.2 : 0));
            }
          },
        });
        out = await trim(out);
        cut = true;
      }
      if (!known.has(meta.id)) continue;
      await cache.put({ id: meta.id, blob: out, cut, v: CUT_VERSION });
      setToast('שוגר! 🚀', 1);
      await addSprite({ id: meta.id, name: meta.name, blob: out }, feature);
    } catch (err) {
      console.error(err);
      // Never leave a kid out: show the uncut photo (not cached, so a reload tries cutting again).
      setToast('⚠️ לא הצלחנו לגזור את התמונה, מציגים אותה כמו שהיא', 0);
      try {
        if (original && known.has(meta.id)) await addSprite({ id: meta.id, name: meta.name, blob: await prepare(original) }, feature);
      } catch (e) { console.error(e); known.delete(meta.id); }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  busy = false;
  setTimeout(() => { if (!busy) toast.classList.remove('show'); }, 2500);
}

function forget(id) {
  known.delete(id);
  removeSprite(id);
  cache.del(id);
}

function refreshUI() {
  $('empty').classList.toggle('hide', sprites.length > 0);
}

function applySettings(s) {
  settings = { ...config.defaults, ...s };
  $('title').textContent = settings.title;
}

// ---------- everything the host page sends ----------
store.onChange((ev) => {
  if (ev.type === 'added') queuePhoto({ id: ev.id, name: ev.name }, true);
  else if (ev.type === 'deleted') forget(ev.id);
  else if (ev.type === 'cleared') { for (const id of [...known]) forget(id); featureQueue.length = 0; cache.clear(); }
  else if (ev.type === 'settings') applySettings(ev.settings);
  else if (ev.type === 'command' && ev.name === 'spotlight') {
    spotlight(ev.id ? sprites.find((s) => s.id === ev.id) : undefined);
  }
});

// ---------- fullscreen (browsers only allow it from a click or key press on this screen) ----------
const toggleFs = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
$('fsHint').onclick = toggleFs;
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f' || e.key === 'כ') toggleFs(); });
addEventListener('dblclick', toggleFs);
document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fs', !!document.fullscreenElement));

// hide the cursor + hint when the mouse is idle (clean projector view)
let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
}
addEventListener('mousemove', wake);
addEventListener('pointerdown', wake);
wake();

// ---------- start: show everyone already uploaded ----------
(async () => {
  try { applySettings(await store.getSettings()); } catch (e) { console.error(e); applySettings({}); }
  refreshUI();
  loadLib().catch(() => {}); // warm up the cut-out library in the background
  await sync(true);
  // Safety net: if the Wi-Fi drops for a moment, live updates can be missed, so re-check every 15 seconds.
  setInterval(() => sync(false), 15000);
})();

let syncing = false;
async function sync(first) {
  if (syncing) return;
  syncing = true;
  try {
    const photos = await store.listPhotos();
    const ids = new Set(photos.map((p) => p.id));
    for (const meta of photos) {
      if (known.has(meta.id)) continue;
      const hit = first ? await cache.get(meta.id) : null;
      if (hit && hit.v === CUT_VERSION) { known.add(meta.id); await addSprite({ id: meta.id, name: meta.name, blob: hit.blob }, false); }
      else queuePhoto(meta, true);
    }
    for (const id of [...known]) if (!ids.has(id)) forget(id);
    try { applySettings(await store.getSettings()); } catch {}
  } catch (e) {
    console.error(e);
  } finally {
    syncing = false;
  }
}
