// Пиксель-арт боевых эффектов: огненный шар взрыва (12 кадров), ударные кольца, сигил варп-разлома,
// выбоины от пуль с раскалённой кромкой, расплав, тлеющие угольки, гильзы, обломки камня,
// трассер, электрические дуги плазмы, столб света пикапа.
// Всё рисуется кодом один раз при запуске (как и в art_misc.js) и кэшируется.
import * as THREE from 'three';
import { Pix, ramp, hex, sheet, rng, noise2, nearestTexture } from './pixel.js';

const FIRE = [[255, 252, 226], [255, 228, 124], [255, 164, 48], [226, 94, 24], [152, 46, 22]];
const SMOKE = [[128, 122, 132], [94, 90, 102], [64, 62, 74], [42, 40, 50]];

// ---------- Огненный шар: шум клубится и поднимается, жар остывает от ядра к краю и со временем ----------
function fireballFrames(n = 12, S = 96, seed = 5) {
  const N = noise2(seed), frames = [];
  const fbm = (x, y) => N(x, y) * 0.5 + N(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + N(x * 4.3 + 1, y * 4.3 + 9) * 0.2;
  for (let f = 0; f < n; f++) {
    const P = new Pix(S, S), t = f / (n - 1);
    const rad = 0.34 + 0.62 * (1 - Math.pow(1 - t, 2.4));
    const lift = t * t * 0.2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5 - S / 2) / (S / 2), v = (y + 0.5 - S / 2) / (S / 2) + lift;
      const r = Math.hypot(u, v * 1.06);
      const tb = fbm(x * 0.075 + t * 0.5, y * 0.075 + t * 1.5);
      const edge = rad * (0.7 + tb * 0.56);
      if (r > edge) continue;
      const k = r / edge;
      // к концу дым рвётся на клочья
      const tb2 = fbm(x * 0.14 + 30, y * 0.14 + t * 2.4);
      if (t > 0.42 && tb2 < (t - 0.42) * 1.6 + (k > 0.7 ? 0.1 : 0)) continue;
      const heat = 1.2 - k * 0.92 + (tb - 0.5) * 1.15 - t * 1.55 + (f < 2 ? 0.55 : 0);
      let c;
      if (heat > 0.24) c = FIRE[heat > 0.96 ? 0 : heat > 0.72 ? 1 : heat > 0.5 ? 2 : heat > 0.36 ? 3 : 4];
      else {
        const l = (-u - v) * 0.3 + tb * 0.95 + heat * 0.6 + 0.12;       // дым освещён сверху-слева, подсвечен жаром
        c = SMOKE[l > 0.74 ? 0 : l > 0.5 ? 1 : l > 0.3 ? 2 : 3];
      }
      P.set(x, y, c);
    }
    frames.push(P);
  }
  return frames;
}

// ---------- Кольцо ударной волны (64×64): пиксельное, с рваной кромкой ----------
function ringCanvasPx(S = 64, seed = 3, thick = 0.16) {
  const P = new Pix(S, S), R = rng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
    const d = (r - (1 - thick)) / thick;            // 0 — внутренний край кольца, 1 — внешний
    if (d < -1.4 || d > 1) continue;
    const a = d < 0 ? Math.max(0, 1 + d / 1.4) * 0.35 : 1 - Math.pow(d, 3);
    const n = R();
    if (a < 0.12 + n * 0.12) continue;
    const v = d < 0 ? 150 + n * 40 : 255;
    P.set(x, y, [v, v, v], Math.min(255, a * 255));
  }
  return P.toCanvas();
}

// ---------- Сигил варп-разлома (64×64): круги, зубцы и глаз-спираль (эмблема еретиков) ----------
function sigil() {
  const S = 64, P = new Pix(S, S), c = S / 2, W = [255, 255, 255];
  for (let a = 0; a < 6.283; a += 0.008) {
    for (const r of [30, 29, 22]) P.set(c + Math.cos(a) * r, c + Math.sin(a) * r, W);
    if (Math.floor(a / (6.283 / 48)) % 2 === 0) P.set(c + Math.cos(a) * 25.5, c + Math.sin(a) * 25.5, W, 200);   // пунктир
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 6.283;
    P.line(c + Math.cos(a) * 22, c + Math.sin(a) * 22, c + Math.cos(a + 0.18) * 29, c + Math.sin(a + 0.18) * 29, W);
    P.line(c + Math.cos(a) * 22, c + Math.sin(a) * 22, c + Math.cos(a - 0.18) * 29, c + Math.sin(a - 0.18) * 29, W);
  }
  for (let k = 0; k < 3; k++) {                       // треугольник
    const a = -1.5708 + (k / 3) * 6.283, b = -1.5708 + ((k + 1) / 3) * 6.283;
    P.line(c + Math.cos(a) * 21, c + Math.sin(a) * 21, c + Math.cos(b) * 21, c + Math.sin(b) * 21, W);
  }
  for (let t = 0; t < 11; t += 0.04) { const r = t * 0.85; P.set(c + Math.cos(t * 1.7) * r, c + Math.sin(t * 1.7) * r, W); }   // спираль
  return P.toCanvas();
}

// ---------- След пули (16×16): тёмная выбоина со сколами + отдельная раскалённая кромка ----------
function bulletHole(seed) {
  const P = new Pix(16, 16), R = rng(seed);
  const m = P.mask().ellipse(8, 8, 2.6 + R(), 2.4 + R(), R() * 3);
  for (let i = 0; i < 4; i++) { const a = R() * 6.283; m.limb(8, 8, 8 + Math.cos(a) * (4 + R() * 3), 8 + Math.sin(a) * (4 + R() * 3), 0.9, 0.3); }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!m.m[y * 16 + x]) continue;
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    P.set(x, y, d < 1.8 ? [10, 9, 12] : d < 3.2 ? [26, 24, 30] : [44, 42, 50]);
  }
  for (let i = 0; i < 5; i++) { const a = R() * 6.283, r = 3.5 + R() * 2.5; P.set(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, [150, 150, 164], 220); }   // светлые сколы
  return P.toCanvas();
}
function holeGlow() {
  const P = new Pix(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    if (d > 5.2) continue;
    P.set(x, y, d < 1.6 ? [255, 250, 220] : d < 3 ? [255, 190, 80] : [255, 110, 30], d < 3 ? 255 : 255 * (1 - (d - 3) / 2.2));
  }
  return P.toCanvas();
}

// ---------- Расплав от термокопья и плазмы (32×32): белое ядро → рыжий край ----------
function molten(seed = 9) {
  const P = new Pix(32, 32), N = noise2(seed);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 15 + (N(x * 0.35, y * 0.35) - 0.5) * 0.45;
    if (d > 1) continue;
    P.set(x, y, d < 0.25 ? [255, 255, 255] : d < 0.5 ? [255, 236, 170] : d < 0.74 ? [255, 170, 80] : [200, 90, 40], d < 0.74 ? 255 : 255 * (1 - (d - 0.74) / 0.26));
  }
  return P.toCanvas();
}

// ---------- Тлеющие угольки на копоти (48×48): россыпь горячих пикселей ----------
function embers(seed = 21) {
  const P = new Pix(48, 48), R = rng(seed);
  for (let i = 0; i < 90; i++) {
    const a = R() * 6.283, r = Math.pow(R(), 0.7) * 21;
    const x = 24 + Math.cos(a) * r, y = 24 + Math.sin(a) * r, hot = R();
    P.set(x, y, hot > 0.7 ? [255, 240, 180] : hot > 0.3 ? [255, 160, 60] : [220, 80, 30]);
    if (hot > 0.8) P.set(x + 1, y, [255, 150, 50]);
  }
  for (let i = 0; i < 5; i++) {                       // светящиеся трещины
    let x = 24 + (R() - 0.5) * 14, y = 24 + (R() - 0.5) * 14; const a = R() * 6.283;
    for (let k = 0; k < 9; k++) { P.set(x, y, [255, 120, 40], 200); x += Math.cos(a + (R() - 0.5)) * 1.1; y += Math.sin(a + (R() - 0.5)) * 1.1; }
  }
  return P.toCanvas();
}

// ---------- Трещины от удара Колосса (64×64): тёмная звезда разломов ----------
function cracks(seed = 31) {
  const P = new Pix(64, 64), R = rng(seed);
  for (let i = 0; i < 9; i++) {
    let x = 32, y = 32, a = (i / 9) * 6.283 + R() * 0.5;
    const len = 16 + R() * 14;
    for (let k = 0; k < len; k++) {
      P.set(x, y, [14, 12, 16]); if (k < len * 0.5) P.set(x + 1, y, [22, 20, 26]);
      if (k % 3 === 0) P.set(x - 1, y + 1, [120, 118, 130], 150);
      a += (R() - 0.5) * 0.7; x += Math.cos(a) * 1.05; y += Math.sin(a) * 1.05;
      if (R() < 0.08) { let bx = x, by = y; const ba = a + (R() < 0.5 ? 1 : -1); for (let j = 0; j < 6; j++) { P.set(bx, by, [20, 18, 24]); bx += Math.cos(ba); by += Math.sin(ba); } }
    }
  }
  P.fill(P.mask().ellipse(32, 32, 5, 4.4), [[8, 8, 10], [14, 12, 16], [22, 20, 26], [30, 28, 36], [40, 38, 46]], { round: 2, contour: false, dither: 0 });
  return P.toCanvas();
}

// ---------- Гильзы (8×4) и обломки камня (12×12) ----------
function casing(red) {
  const P = new Pix(8, 4);
  const body = red ? ramp('#a8202a', { spread: 0.4 }) : ramp('#d0a040', { spread: 0.5 });
  P.fill(P.mask().rect(0, 0, 8, 4), body, { round: 1.5, contour: false, dither: 0 });
  if (red) P.fill(P.mask().rect(0, 0, 3, 4), ramp('#d0a040', { spread: 0.5 }), { round: 1.5, contour: false, dither: 0 });
  P.set(7, 1, [40, 30, 20]); P.set(7, 2, [40, 30, 20]);
  return P.toCanvas();
}
function rubble(kind) {
  const P = new Pix(12, 12), st = ramp(kind === 2 ? '#4a4c58' : '#74768a', { spread: 0.42 });
  const shapes = [[[2, 3], [9, 1], [11, 7], [6, 11], [1, 8]], [[1, 5], [6, 1], [11, 4], [9, 10], [3, 11]], [[3, 2], [10, 3], [8, 9], [2, 8]]];
  P.fill(P.mask().poly(shapes[kind]), st, { round: 2, dither: 0.3 });
  return P.outline([16, 14, 20]).toCanvas();
}

// ---------- Трассер (64×8): яркая голова, гаснущий хвост; электрическая дуга (4 кадра 32×32) ----------
function tracerCanvas() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d'), img = g.createImageData(64, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) {
    const u = x / 63, v = Math.abs(y - 3.5) / 4;
    const a = Math.pow(u, 1.6) * Math.pow(1 - v, 1.5) * (u > 0.94 ? (1 - u) / 0.06 : 1);
    const i = (y * 64 + x) * 4, core = v < 0.3 ? 1 : 0.75;
    img.data[i] = 255; img.data[i + 1] = 255 * core; img.data[i + 2] = 255 * core * core; img.data[i + 3] = Math.min(255, a * 300);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}
function beamCanvas() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 16;
  const g = c.getContext('2d'), img = g.createImageData(4, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) {
    const v = Math.abs(y - 7.5) / 8, i = (y * 4 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = 255 * Math.pow(1 - v, 1.7);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
function arcFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const P = new Pix(32, 32), R = rng(60 + f);
    for (let b = 0; b < 3; b++) {
      let x = 16, y = 16, a = R() * 6.283;
      for (let k = 0; k < 13; k++) {
        const nx = x + Math.cos(a) * 1.2, ny = y + Math.sin(a) * 1.2;
        P.set(nx, ny, [255, 255, 255]); if (k < 6) P.set(nx + 1, ny, [200, 240, 255], 180);
        x = nx; y = ny; a += (R() - 0.5) * 1.5;
      }
    }
    frames.push(P);
  }
  return frames;
}

// ---------- Столб света над пикапом (16×64) и мягкое пятно ----------
function pillarCanvas() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const g = c.getContext('2d'), img = g.createImageData(16, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) {
    const u = Math.abs(x - 7.5) / 8, v = y / 63;         // v = 0 — верх
    const i = (y * 16 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = 255 * Math.pow(1 - u, 2) * Math.pow(v, 1.6) * 0.9;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
// Вращающееся кольцо пикапа (48×48): пунктирная окружность с засечками
function pickupRing() {
  const S = 48, P = new Pix(S, S), c = S / 2, W = [255, 255, 255];
  for (let a = 0; a < 6.283; a += 0.01) {
    const seg = Math.floor(a / (6.283 / 12));
    if (seg % 3 !== 2) { P.set(c + Math.cos(a) * 21, c + Math.sin(a) * 21, W); P.set(c + Math.cos(a) * 20, c + Math.sin(a) * 20, W, 150); }
    P.set(c + Math.cos(a) * 15, c + Math.sin(a) * 15, W, 70);
  }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * 6.283; P.line(c + Math.cos(a) * 17, c + Math.sin(a) * 17, c + Math.cos(a) * 23, c + Math.sin(a) * 23, W); }
  return P.toCanvas();
}

let cache = null;
export function fxArt() {
  if (cache) return cache;
  const tex = (c) => nearestTexture(c);
  cache = {
    fireball: sheet(fireballFrames()),
    ring: tex(ringCanvasPx(64, 3, 0.1)),
    ringThin: tex(ringCanvasPx(64, 4, 0.07)),
    sigil: tex(sigil()),
    holes: [41, 42, 43].map((s) => bulletHole(s)),
    holeGlow: tex(holeGlow()),
    molten: tex(molten()),
    embers: tex(embers()),
    cracks: cracks(),
    casing: tex(casing(false)), shell: tex(casing(true)),
    rubble: [0, 1, 2].map((k) => rubble(k)),
    tracer: tracerCanvas(),
    beam: beamCanvas(),
    arcs: sheet(arcFrames()),
    pillar: pillarCanvas(),
    pickupRing: tex(pickupRing()),
  };
  return cache;
}
