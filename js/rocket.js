// Finds Ori's cardboard rocket in a photo and cuts it out: the rocket (nose, body, fins, legs, base)
// stays, the kids' faces show through the round windows, and the room around it is removed.
// Returns null when there is no rocket in the photo, so the caller can fall back to plain
// background removal.
//
// How: find the blue stripe, the two yellow rings and the red nose (easy colours to spot), fit the
// rocket's known shape onto them with a perspective transform, then snap the outline to the real
// edges in the photo. Red fins and legs are taken by colour near where the template expects them.

// ---------- the rocket's shape, measured on a straight-on photo (1500×2000 px) ----------
const T = {
  stripe: [[428, 1068], [1075, 1070], [1075, 1195], [430, 1193]], // TL TR BR BL
  rings: [[760, 733], [761, 985]],                                  // big (upper), small
  apex: [765, 250],
  noseBase: [[522, 601], [1000, 616]],                              // left, right
  // nose + body outline, clockwise from the tip; `nose` marks where the red nose ends
  nose: [[765, 250], [830, 300], [880, 390], [935, 480], [975, 560], [1000, 616]],
  bodyRight: [[1030, 690], [1050, 770], [1062, 850], [1070, 950], [1075, 1050], [1075, 1195],
    [1060, 1300], [1040, 1400], [1020, 1500], [1005, 1600], [988, 1642]],
  bodyBottom: [[750, 1645], [512, 1642]],
  bodyLeft: [[502, 1600], [485, 1500], [462, 1400], [445, 1300], [430, 1193], [430, 1050],
    [438, 950], [450, 850], [470, 750], [500, 670], [522, 601]],
  noseLeft: [[545, 550], [585, 480], [640, 390], [700, 315]],
  fins: [
    [[440, 1262], [420, 1300], [380, 1400], [340, 1500], [305, 1600], [285, 1680], [292, 1712], [315, 1727],
      [350, 1722], [370, 1700], [400, 1640], [440, 1590], [480, 1555], [497, 1548], [485, 1500], [462, 1400], [445, 1300]],
    [[1060, 1270], [1080, 1350], [1110, 1450], [1140, 1550], [1170, 1630], [1190, 1680], [1185, 1710], [1160, 1722],
      [1130, 1715], [1110, 1690], [1080, 1640], [1040, 1590], [1020, 1565], [1010, 1560], [1020, 1500], [1040, 1400], [1060, 1300]],
  ],
  legs: [
    [[545, 1560], [573, 1518], [565, 1700], [528, 1930], [495, 1935], [520, 1700]],
    [[940, 1522], [965, 1555], [985, 1700], [985, 1918], [965, 1920], [945, 1700]],
  ],
  base: [[498, 1648], [992, 1645], [992, 1702], [498, 1727]],
  // spots that are always plain white body / red nose, for sampling their colour in each photo
  whiteSpots: [[540, 850], [980, 850], [600, 1350], [900, 1350], [750, 1450], [560, 1000], [960, 1000]],
  redSpots: [[765, 420], [700, 520], [830, 520], [765, 540]],
  blueSpots: [[500, 1130], [650, 1130], [800, 1130], [950, 1130], [1010, 1130]],
};
const T_STRIPE_W = 647;

const WORK = 700; // long side of the analysis image

// why the last photo had no rocket (for the console)
export let lastMiss = '';

// ---------- small image helpers ----------
const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

// square-kernel dilate / erode via an integral image
function boxCount(m, w, h, r) {
  const W1 = w + 1, I = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += m[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; }
  }
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
    }
  }
  return out;
}
const dilate = (m, w, h, r) => { const c = boxCount(m, w, h, r), o = new Uint8Array(w * h); for (let i = 0; i < o.length; i++) o[i] = c[i] > 0; return o; };
const invert = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = !m[i]; return o; };
const erode = (m, w, h, r) => invert(dilate(invert(m), w, h, r));
const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

function components(m, w, h, minArea) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    const id = comps.length + 1, c = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0 };
    let sp = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      c.area++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && m[i - w] && !lab[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && m[i + w] && !lab[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
    }
    if (c.area >= minArea) { c.cx = c.sx / c.area; c.cy = c.sy / c.area; c.bw = c.x1 - c.x0 + 1; c.bh = c.y1 - c.y0 + 1; comps.push(c); }
  }
  return { lab, comps };
}

// The stripe's 4 corners. Its top and bottom edges are straight lines; follow them out from the middle
// and stop where the blue shape stops matching them (e.g. where a blue book or album touches the end).
function stripeCorners(lab, w, c) {
  const cols = [];
  for (let x = c.x0; x <= c.x1; x++) {
    let t = -1, b = -1;
    for (let y = c.y0; y <= c.y1; y++) if (lab[y * w + x] === c.id) { if (t < 0) t = y; b = y; }
    if (t >= 0) cols.push([x, t, b]);
  }
  const line = (pts) => { // least squares y = a + b x
    const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, den = 0; for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    const b = den ? num / den : 0; return (x) => my + b * (x - mx);
  };
  const mid = cols.slice(Math.floor(cols.length * 0.3), Math.ceil(cols.length * 0.7));
  if (mid.length < 5) return null;
  const top = line(mid.map(([x, t]) => [x, t])), bot = line(mid.map(([x, , b]) => [x, b]));
  const thick = bot(mid[mid.length >> 1][0]) - top(mid[mid.length >> 1][0]);
  const tol = Math.max(3, 0.25 * thick);
  const good = ([x, t, b]) => Math.abs(t - top(x)) < tol && Math.abs(b - bot(x)) < tol;
  const walk = (from, step) => {
    let last = from, bad = 0;
    for (let i = from; i >= 0 && i < cols.length && bad < 6; i += step) {
      if (good(cols[i])) { last = i; bad = 0; } else bad++;
    }
    return cols[last][0];
  };
  const m = cols.length >> 1, xl = walk(m, -1), xr = walk(m, 1);
  return [[xl, top(xl)], [xr, top(xr)], [xr, bot(xr)], [xl, bot(xl)]];
}

// leftmost and rightmost pixel of each row of the given components (enough points for a convex hull)
function rowEnds(lab, w, ids, comps) {
  const y0 = Math.min(...comps.map((c) => c.y0)), y1 = Math.max(...comps.map((c) => c.y1));
  const x0 = Math.min(...comps.map((c) => c.x0)), x1 = Math.max(...comps.map((c) => c.x1));
  const pts = [];
  for (let y = y0; y <= y1; y++) {
    let l = -1, r = -1;
    for (let x = x0; x <= x1; x++) if (ids.has(lab[y * w + x])) { if (l < 0) l = x; r = x; }
    if (l >= 0) pts.push([l, y], [r + 1, y], [l, y + 1], [r + 1, y + 1]);
  }
  return pts;
}

// convex hull (monotone chain)
function hull(pts) {
  if (pts.length < 3) return [];
  pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// pixels reachable from the image border without crossing the mask
function outside(m, w, h) {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => { if (!m[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w);
  }
  return seen;
}

// the component's pixel that is furthest along direction (dx, dy)
function extreme(lab, w, c, dx, dy) {
  let best = -Infinity, bp = null;
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
    if (lab[y * w + x] !== c.id) continue;
    const v = x * dx + y * dy;
    if (v > best) { best = v; bp = [x, y]; }
  }
  return bp;
}

function polyMask(polys, w, h, grow = 0) {
  const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = grow * 2;
  for (const p of polys) {
    g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fill(); if (grow) g.stroke();
  }
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127;
  return m;
}

// ---------- transforms (least squares) ----------
function solve(A, b) { // normal equations + Gaussian elimination
  const n = A[0].length, M = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let r = 0; r < A.length; r++) for (let i = 0; i < n; i++) {
    M[i][n] += A[r][i] * b[r];
    for (let j = 0; j < n; j++) M[i][j] += A[r][i] * A[r][j];
  }
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function normalizer(pts) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const md = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
  const s = Math.SQRT2 / md;
  return { f: (p) => [(p[0] - cx) * s, (p[1] - cy) * s], inv: (p) => [p[0] / s + cx, p[1] / s + cy] };
}
// returns a function template-point -> image-point
function fit(src, dst, perspective) {
  const ns = normalizer(src), nd = normalizer(dst), A = [], b = [];
  src.forEach((sp, i) => {
    const [x, y] = ns.f(sp), [u, v] = nd.f(dst[i]);
    if (perspective) {
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    } else {
      A.push([x, y, 1, 0, 0, 0]); b.push(u);
      A.push([0, 0, 0, x, y, 1]); b.push(v);
    }
  });
  const h = solve(A, b);
  if (!h) return null;
  const [a, bb, c, d, e, f, g = 0, k = 0] = h;
  return (p) => { const [x, y] = ns.f(p), z = g * x + k * y + 1; return nd.inv([(a * x + bb * y + c) / z, (d * x + e * y + f) / z]); };
}
const errs = (map, src, dst) => src.map((p, i) => { const q = map(p); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]); });
// fit, then keep dropping the worst landmark (e.g. a stripe corner that ran into a blue book) until all agree
function robustFit(src, dst, perspective, tol, minPts) {
  src = [...src]; dst = [...dst];
  while (src.length >= minPts) {
    const map = fit(src, dst, perspective);
    if (!map) return null;
    const e = errs(map, src, dst), worst = e.indexOf(Math.max(...e));
    if (e[worst] <= tol) return { map, src, dst };
    src.splice(worst, 1); dst.splice(worst, 1);
  }
  return null;
}

// evenly spaced points along a closed polyline, keeping which segment kind each came from
function resample(pts, kinds, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let j = 0; j < n; j++) out.push({ p: [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], kind: kinds[i] });
  }
  return out;
}

// ---------- main ----------
export async function cutRocket(blob, { debug = false } = {}) {
  const bmp = await createImageBitmap(blob);
  const FW = bmp.width, FH = bmp.height, k = Math.min(1, WORK / Math.max(FW, FH));
  const w = Math.round(FW * k), h = Math.round(FH * k), N = w * h;
  const wc = newCanvas(w, h), wg = wc.getContext('2d', { willReadFrequently: true });
  wg.drawImage(bmp, 0, 0, w, h);
  const raw = wg.getImageData(0, 0, w, h).data;
  wg.filter = 'blur(1.5px)'; wg.drawImage(bmp, 0, 0, w, h); wg.filter = 'none';
  const px = wg.getImageData(0, 0, w, h).data; // blurred, for edges

  // colour classes
  const red = new Uint8Array(N), blue = new Uint8Array(N), yellow = new Uint8Array(N), baseYellow = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const [hh, s, v] = hsv(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]);
    red[i] = (hh >= 335 || hh <= 14) && s > 0.32 && v > 0.1;
    blue[i] = hh >= 190 && hh <= 235 && s > 0.4 && v > 0.2;
    yellow[i] = hh >= 45 && hh <= 65 && s > 0.38 && v > 0.3; // ring gold is hue 50–56; blonde hair is usually below 45
    baseYellow[i] = hh >= 44 && hh <= 70 && s > 0.3 && v > 0.15; // the base is in shadow; the wood floor is below hue 44
  }

  // 1. blue stripe + two yellow rings above it
  const minA = N * 0.003;
  const bl = components(close(blue, w, h, 2), w, h, minA);
  const stripes = bl.comps.filter((c) => c.bw > 2.5 * c.bh).sort((a, b) => b.area - a.area);
  // the two rings touch, so look for the windows instead: holes enclosed by yellow
  const yc = close(yellow, w, h, 2), windows = new Uint8Array(N), yOut = outside(yc, w, h);
  for (let i = 0; i < N; i++) windows[i] = !yOut[i] && !yc[i];
  const ylw = components(windows, w, h, N * 0.0008);
  let found = null;
  for (const st of stripes.slice(0, 4)) {
    const ws = st.bw;
    const rings = ylw.comps.filter((c) =>
      c.cx > st.x0 && c.cx < st.x1 && c.y1 < st.y0 + 0.1 * ws && c.y0 > st.y0 - 1.6 * ws &&
      // loose limits: a kid's blonde hair can look yellow and eat into a window
      c.bw > 0.08 * ws && c.bw < 0.6 * ws && c.bw / c.bh > 0.5 && c.bw / c.bh < 2 &&
      c.area / (c.bw * c.bh) > 0.35).sort((a, b) => b.area - a.area).slice(0, 2);
    if (rings.length < 2) continue;
    rings.sort((a, b) => a.cy - b.cy);
    const ratio = rings[0].bw / rings[1].bw;
    if (ratio < 0.9 || ratio > 2.4) continue;
    found = { st, rings };
    break;
  }
  if (!found) {
    lastMiss = `no stripe+rings (stripes: ${stripes.slice(0, 4).map((c) => `${c.bw}x${c.bh}@${c.x0},${c.y0}`).join(' ')}; ` +
      `yellow: ${ylw.comps.filter((c) => c.bw > 20).map((c) => `${c.bw}x${c.bh}@${c.x0},${c.y0} f${(c.area / (c.bw * c.bh)).toFixed(2)}`).join(' ')})`;
    return null;
  }
  const { st, rings } = found;
  const corners = stripeCorners(bl.lab, w, st);
  if (!corners) { lastMiss = 'stripe too small'; return null; }
  const src = [...T.stripe, ...T.rings], dst = [...corners, [rings[0].cx, rings[0].cy], [rings[1].cx, rings[1].cy]];
  // rocket scale (stripe width), taken from the window spacing: the stripe corners can be fooled by blue books
  const ws = Math.hypot(rings[1].cx - rings[0].cx, rings[1].cy - rings[0].cy) * T_STRIPE_W / Math.hypot(T.rings[1][0] - T.rings[0][0], T.rings[1][1] - T.rings[0][1]);

  // 2. first guess (affine), then add the nose tip + nose base corners and fit with perspective
  const first = robustFit(src, dst, false, 0.05 * ws, 4);
  if (!first) { lastMiss = 'landmarks do not fit the rocket shape'; return null; }
  let map = first.map, used = first;
  const nosePoly = [...T.nose, ...T.noseLeft].map(map);
  const noseGate = polyMask([nosePoly], w, h, Math.round(0.08 * ws));
  const noseRed = new Uint8Array(N); for (let i = 0; i < N; i++) noseRed[i] = red[i] && noseGate[i];
  const nr = components(close(noseRed, w, h, 2), w, h, N * 0.002);
  const nose = nr.comps.sort((a, b) => b.area - a.area)[0];
  if (nose) {
    const up = (() => { const a = map([760, 1130]), b = map(T.apex); const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; })();
    const right = [-up[1], up[0]];
    const tip = extreme(nr.lab, w, nose, up[0], up[1]);
    const nbl = extreme(nr.lab, w, nose, -up[0] - right[0], -up[1] - right[1]);
    const nbr = extreme(nr.lab, w, nose, -up[0] + right[0], -up[1] + right[1]);
    const src2 = [...src, T.apex, ...T.noseBase], dst2 = [...dst, tip, nbl, nbr];
    const second = robustFit(src2, dst2, true, 0.035 * ws, 6);
    if (second) { map = second.map; used = second; }
  }

  // 3. snap the nose + body outline to the real edges
  const sample = (spots) => {
    const cs = spots.map(map).map(([x, y]) => { const i = (Math.round(Math.min(h - 1, Math.max(0, y))) * w + Math.round(Math.min(w - 1, Math.max(0, x)))) * 4; return [px[i], px[i + 1], px[i + 2]]; });
    return [0, 1, 2].map((ch) => cs.map((c) => c[ch]).sort((a, b) => a - b)[cs.length >> 1]);
  };
  const ref = { white: sample(T.whiteSpots), red: sample(T.redSpots), blue: sample(T.blueSpots) };
  const tOutline = [...T.nose, ...T.bodyRight, ...T.bodyBottom, ...T.bodyLeft, ...T.noseLeft];
  const kinds = [...T.nose.map(() => 'red'), ...T.bodyRight.map(() => 'white'), 'fixed', 'fixed', ...T.bodyLeft.map(() => 'white'), ...T.noseLeft.map(() => 'red')];
  kinds[T.nose.length + T.bodyRight.length - 1] = 'fixed'; // body's bottom-right corner → bottom edge
  const pts = resample(tOutline, kinds, 14).map((o) => ({ ...o, q: map(o.p) }));
  for (const o of pts) if (o.kind === 'white' && o.p[1] > 1075 && o.p[1] < 1188) o.kind = 'blue'; // edge of the stripe
  const dist = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return 1;
    const i = (y * w + x) * 4;
    return Math.hypot(px[i] - c[0], px[i + 1] - c[1], px[i + 2] - c[2]) / 255;
  };
  const R = Math.max(4, Math.round(0.05 * ws)), n = pts.length;
  const offs = new Float64Array(n);
  pts.forEach((o, i) => {
    const a = pts[(i - 1 + n) % n].q, b = pts[(i + 1) % n].q;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; // outward (clockwise outline)
    o.n = [nx, ny];
    if (o.kind === 'fixed') return;
    const c = ref[o.kind];
    let best = -Infinity;
    for (let d = -R; d <= R; d++) {
      let inside = 0, outside = 0;
      for (let t = 2; t <= 5; t++) {
        inside += dist(o.q[0] + (d - t) * nx, o.q[1] + (d - t) * ny, c);
        outside += dist(o.q[0] + (d + t) * nx, o.q[1] + (d + t) * ny, c);
      }
      // moving out costs more than moving in: a sliver of room looks worse than a sliver less rocket
      const score = (outside - inside) / 4 - (d > 0 ? 0.3 : 0.12) * Math.abs(d) / R;
      if (score > best) { best = score; offs[i] = d; }
    }
  });
  // smooth the offsets along the outline (median, then mean) so one bad spot can't make a dent
  const med = offs.map((_, i) => { const win = []; for (let j = -3; j <= 3; j++) win.push(offs[(i + j + n) % n]); return win.sort((a, b) => a - b)[3]; });
  const sm = med.map((_, i) => { let s = 0; for (let j = -2; j <= 2; j++) s += med[(i + j + n) % n]; return s / 5; });
  const outline = pts.map((o, i) => [o.q[0] + o.n[0] * sm[i], o.q[1] + o.n[1] * sm[i]]);

  // 4. fins, legs (red) and the base (yellow), by colour near where the template puts them.
  //    They stick out of the board or lie on the floor, so the board's perspective only roughly fits them.
  const redGate = polyMask([...T.fins, ...T.legs].map((p) => p.map(map)), w, h, Math.round(0.06 * ws));
  const baseGate = polyMask([T.base.map(map)], w, h, Math.round(0.06 * ws));
  const parts = new Uint8Array(N), basePx = new Uint8Array(N);
  for (let i = 0; i < N; i++) { parts[i] = red[i] && redGate[i]; basePx[i] = baseYellow[i] && baseGate[i]; }
  const pc = components(close(parts, w, h, 3), w, h, N * 0.0004);
  const partsMask = new Uint8Array(N);
  const keep = new Set(pc.comps.map((c) => c.id));
  for (let i = 0; i < N; i++) if (keep.has(pc.lab[i])) partsMask[i] = 1;
  const partsOut = outside(partsMask, w, h); // fill glitter gaps inside the parts
  for (let i = 0; i < N; i++) if (!partsOut[i]) partsMask[i] = 1;
  // The base is in shadow, so only some of its glitter reads as yellow: a speckled mask that would come
  // out see-through. It's a straight strip, so fill the convex hull of what was found instead.
  const bc = components(close(basePx, w, h, 3), w, h, N * 0.0004);
  // its top corners meet the board, so the template knows them well: they close any gap to the body
  const baseHull = bc.comps.length
    ? hull([...rowEnds(bc.lab, w, new Set(bc.comps.map((c) => c.id)), bc.comps), map(T.base[0]), map(T.base[1]), map([520, 1625]), map([980, 1625])]) : []; // overlap the body a little: no seam

  // 5. build the full-size cut-out
  const sc = 1 / k;
  const mask = newCanvas(FW, FH), mg = mask.getContext('2d');
  mg.fillStyle = '#fff';
  // smooth curve through the outline (quadratic segments between midpoints)
  mg.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2 * sc, (a[1] + b[1]) / 2 * sc];
  mg.moveTo(...mid(outline[n - 1], outline[0]));
  for (let i = 0; i < n; i++) mg.quadraticCurveTo(outline[i][0] * sc, outline[i][1] * sc, ...mid(outline[i], outline[(i + 1) % n]));
  mg.closePath(); mg.fill();
  if (baseHull.length > 2) {
    mg.beginPath(); baseHull.forEach(([x, y], i) => (i ? mg.lineTo(x * sc, y * sc) : mg.moveTo(x * sc, y * sc))); mg.closePath(); mg.fill();
  }
  const pm = newCanvas(w, h), pg = pm.getContext('2d'), pd = pg.createImageData(w, h);
  for (let i = 0; i < N; i++) if (partsMask[i]) pd.data.set([255, 255, 255, 255], i * 4);
  pg.putImageData(pd, 0, 0);
  mg.imageSmoothingQuality = 'high'; mg.drawImage(pm, 0, 0, FW, FH);

  let x0 = FW, y0 = FH, x1 = 0, y1 = 0;
  const grow = (x, y) => { x *= sc; y *= sc; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  outline.forEach(([x, y]) => grow(x, y)); baseHull.forEach(([x, y]) => grow(x, y));
  for (let i = 0; i < N; i++) if (partsMask[i]) grow(i % w, (i / w) | 0);
  const pad = 6;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(FW, Math.ceil(x1 + pad)); y1 = Math.min(FH, Math.ceil(y1 + pad));

  const out = newCanvas(x1 - x0, y1 - y0), og = out.getContext('2d');
  og.drawImage(bmp, -x0, -y0);
  og.globalCompositeOperation = 'destination-in';
  og.filter = 'blur(1px)'; // soft edge instead of a jagged one
  og.drawImage(mask, -x0, -y0);
  bmp.close?.();
  const result = await toBlob(out);
  if (!debug) return result;
  return { blob: result, k, debug: { used, err: used.src.map((p, i) => Math.round(Math.hypot(map(p)[0] - used.dst[i][0], map(p)[1] - used.dst[i][1]))), corners, rings: rings.map((r) => [r.cx, r.cy]), template: pts.map((o) => o.q), outline, base: T.base.map(map), partsMask, w, h } };
}
