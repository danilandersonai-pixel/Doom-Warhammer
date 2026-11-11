// Арт окружения, который рисуется кодом при запуске: витражи и окно-роза, пиксельный огонь,
// печать ордена на полу, ковровая дорожка, световые столбы и пятна, раскалённый металл.
import { rng } from './pixel.js';

function px(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const set = (x, y, r, gg, b, a = 255) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = a;
  };
  const done = () => { g.putImageData(img, 0, 0); return c; };
  return { c, g, d, set, done, w, h };
}

// Самоцветные цвета стекла
const GLASS = {
  ruby: [200, 30, 40], amber: [255, 170, 50], gold: [255, 214, 110], sapphire: [40, 90, 220], sky: [90, 180, 255],
  emerald: [30, 160, 90], violet: [130, 60, 200], rose: [240, 90, 130], white: [250, 240, 220],
};
const LEAD = [14, 12, 18];

// ---------- Огонь: классический «doom fire» — тепло поднимается и остывает, кадры снимаются из симуляции ----------
export function fireSheet(frames = 8, w = 32, h = 48, seed = 3) {
  const R = rng(seed), heat = new Float32Array(w * h);
  const pal = [[0, 0, 0, 0], [70, 10, 6, 150], [150, 26, 8, 235], [226, 78, 14, 255], [255, 150, 36, 255], [255, 214, 96, 255], [255, 246, 200, 255]];
  const step = () => {
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2 + 0.5) / (w * 0.36);
      heat[(h - 1) * w + x] = Math.max(0, 1 - u * u) * (0.75 + R() * 0.25);
    }
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x + ((R() * 3) | 0) - 1));
      const lean = (x - w / 2) / w;                              // края остывают быстрее — язык сужается кверху
      heat[y * w + x] = Math.max(0, heat[(y + 1) * w + sx] - (0.012 + R() * 0.034 + Math.abs(lean) * 0.035));
    }
  };
  for (let i = 0; i < 80; i++) step();
  const T = px(w * frames, h);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < 5; i++) step();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = heat[y * w + x], k = Math.min(pal.length - 1, Math.floor(v * pal.length * 1.08));
      const p = pal[k];
      if (p[3]) T.set(f * w + x, y, p[0], p[1], p[2], p[3]);
    }
  }
  return { canvas: T.done(), count: frames, w, h };
}

// ---------- Витраж в стрельчатой арке (48×112): мозаика из цветных стёкол в свинцовой оплётке ----------
// kind: 0 — меч и солнце ордена (рубин и золото), 1 — холодный геометрический, 2 — осквернённый (фиолетово-зелёный)
export function stainedGlass(kind = 0, seed = 1) {
  const W = 48, H = 112, T = px(W, H), R = rng(seed * 31 + kind * 7);
  const inArch = (x, y) => {
    const cx = W / 2 - 0.5, hw = W / 2 - 1.5, spring = 30;       // пята арки
    if (x < cx - hw || x > cx + hw || y > H - 2) return false;
    if (y >= spring) return true;
    // стрельчатая арка: две дуги с центрами в противоположных пятах
    const r = hw * 2;
    return Math.hypot(x - (cx - hw), y - spring) < r && Math.hypot(x - (cx + hw), y - spring) < r;
  };
  const pals = [
    [GLASS.ruby, GLASS.ruby, GLASS.amber, GLASS.gold, GLASS.rose, GLASS.sapphire],
    [GLASS.sapphire, GLASS.sky, GLASS.sky, GLASS.white, GLASS.violet, GLASS.sapphire],
    [GLASS.violet, GLASS.violet, GLASS.emerald, GLASS.rose, GLASS.sapphire, GLASS.emerald],
  ][kind];
  // мозаика Вороного
  const pts = [];
  for (let i = 0; i < 46; i++) pts.push([R() * W, R() * H, pals[(R() * pals.length) | 0], 0.7 + R() * 0.5]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inArch(x, y)) continue;
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) { const d = Math.hypot(x - p[0], (y - p[1]) * 0.7); if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d; }
    const edge = !inArch(x - 1, y) || !inArch(x + 1, y) || !inArch(x, y - 1) || !inArch(x, y + 1);
    if (d2 - d1 < 0.9 || edge) { T.set(x, y, ...LEAD); continue; }
    const k = best[3] * (0.8 + 0.35 * (1 - Math.hypot(x - W / 2, y - H * 0.45) / (H * 0.6)));   // к центру светлее
    T.set(x, y, Math.min(255, best[2][0] * k), Math.min(255, best[2][1] * k), Math.min(255, best[2][2] * k));
  }
  // средник и перекладины
  for (let y = 8; y < H - 2; y++) if (inArch(W / 2, y)) { T.set(W / 2 - 1, y, ...LEAD); T.set(W / 2, y, ...LEAD); }
  for (const yy of [30, 58, 86]) for (let x = 0; x < W; x++) if (inArch(x, yy)) T.set(x, yy, ...LEAD);
  // центральный знак
  const cx = W / 2 - 0.5, cy = 46;
  const fig = (x, y, c) => { if (inArch(x, y)) T.set(x, y, ...c); };
  if (kind === 0) {
    for (let a = 0; a < 6.283; a += 0.05) for (let r = 9; r < 12; r++) fig(cx + Math.cos(a) * r, cy + Math.sin(a) * r, GLASS.gold);
    for (let k = 0; k < 8; k++) for (let r = 12; r < 16; r++) fig(cx + Math.cos(k * 0.785) * r, cy + Math.sin(k * 0.785) * r, GLASS.amber);
    for (let y = -15; y < 26; y++) { fig(cx, cy + y, GLASS.white); fig(cx + 1, cy + y, GLASS.white); }
    for (let x = -6; x <= 7; x++) { fig(cx + x, cy - 6, GLASS.gold); fig(cx + x, cy - 5, GLASS.gold); }
  } else if (kind === 1) {
    for (let k = 0; k < 4; k++) for (let i = -9; i <= 9; i++) { fig(cx + i, cy + (k - 1.5) * 9 + Math.abs(i), GLASS.white); }
  } else {
    for (let a = 0; a < 6.283; a += 0.04) fig(cx + Math.cos(a) * 13, cy + Math.sin(a) * 8, GLASS.emerald);
    for (let t = 0; t < 12; t += 0.05) fig(cx + Math.cos(t * 1.6) * t * 0.8, cy + Math.sin(t * 1.6) * t * 0.55, GLASS.white);
  }
  return T.done();
}

// Разбитый витраж: в стекле неровная дыра, от неё расходятся трещины; по краям арки остаются осколки
export function brokenGlass(src, seed = 1) {
  const W = src.width, H = src.height, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, W, H), d = img.data, R = rng(seed * 13 + 5);
  const cx = W / 2, cy = H * 0.56, N = 14, rad = [];
  for (let i = 0; i < N; i++) rad.push(0.62 + R() * 0.38);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) / (W * 0.46), dy = (y - cy) / (H * 0.4), r = Math.hypot(dx, dy);
    const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * N, i0 = Math.floor(a) % N, f = a - Math.floor(a);
    const edge = rad[i0] * (1 - f) + rad[(i0 + 1) % N] * f - Math.abs(f - 0.5) * 0.22;   // зубчатый край
    const i = (y * W + x) * 4;
    if (r < edge) d[i + 3] = 0;
    else if (r < edge + 0.07 || Math.abs(f - 0.5) > 0.47) { d[i] *= 0.3; d[i + 1] *= 0.3; d[i + 2] *= 0.34; }   // кромка и трещины
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- Окно-роза (128×128): лепестки, кольца, каменные переплёты ----------
export function roseWindow() {
  const S = 128, T = px(S, S), c = S / 2 - 0.5, N = 12;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (r > 62) continue;
    const seg = ((a / (Math.PI * 2)) * N + N) % N, f = seg - Math.floor(seg), si = Math.floor(seg);
    let col = null;
    if (r > 58 || (r > 44 && r < 46.5) || (r > 17 && r < 19.5) || r < 1.5) col = LEAD;                     // кольца-переплёты
    else if (r >= 46.5) {                                                                                   // внешний пояс кружков
      const pr = Math.hypot((f - 0.5) * (r * Math.PI * 2 / N), r - 52);
      col = pr < 4.2 ? (si % 2 ? GLASS.sky : GLASS.gold) : pr < 5.6 ? LEAD : GLASS.sapphire;
    } else if (r >= 19.5) {                                                                                 // лепестки
      const wdt = Math.abs(f - 0.5) * (r * Math.PI * 2 / N);
      const tip = (r - 19.5) / 25, half = 5.5 * (0.35 + Math.sin(tip * Math.PI) * 0.9);
      if (wdt < half - 1.2) col = si % 2 ? GLASS.ruby : GLASS.amber;
      else if (wdt < half) col = LEAD;
      else col = si % 3 === 0 ? GLASS.violet : GLASS.sapphire;
      if (f < 0.045 || f > 0.955) col = LEAD;
    } else {                                                                                                 // сердцевина: солнце ордена
      const ray = Math.abs(Math.sin(a * 4)) * 5;
      col = r < 7 ? GLASS.white : r < 9 + ray ? GLASS.gold : GLASS.ruby;
    }
    const k = col === LEAD ? 1 : 0.78 + 0.3 * (1 - r / 62) + ((x * 7 + y * 13) % 5) * 0.02;
    T.set(x, y, Math.min(255, col[0] * k), Math.min(255, col[1] * k), Math.min(255, col[2] * k));
  }
  // меч поверх сердцевины
  for (let y = -15; y <= 16; y++) { T.set(c, c + y, ...GLASS.white); T.set(c + 1, c + y, ...GLASS.white); }
  for (let x = -6; x <= 7; x++) T.set(c + x, c - 8, ...GLASS.white);
  return T.done();
}

// ---------- Печать ордена на полу (256×256): кольца, лучи, руны; lines — резьба, glow — свечение ----------
export function sigil() {
  const S = 256, A = px(S, S), B = px(S, S), c = S / 2 - 0.5, R = rng(17);
  const mark = (x, y, k = 1) => {
    A.set(x, y, 16, 14, 20, 200 * k);
    B.set(x, y, 255, 150, 60, 255 * k);
  };
  for (let a = 0; a < 6.2832; a += 0.0025) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const [r, w] of [[120, 3], [104, 1], [64, 2], [30, 2]]) for (let t = 0; t < w; t++) mark(c + ca * (r + t), c + sa * (r + t));
  }
  for (let k = 0; k < 16; k++) {                                   // лучи солнца
    const a = k * (Math.PI / 8), long = k % 2 === 0;
    for (let r = 32; r < (long ? 102 : 62); r++) { const wdt = long ? Math.max(0.5, 3 * (1 - (r - 32) / 70)) : 1; for (let t = -wdt; t <= wdt; t++) mark(c + Math.cos(a) * r - Math.sin(a) * t, c + Math.sin(a) * r + Math.cos(a) * t); }
  }
  for (let k = 0; k < 32; k++) {                                   // руны-засечки между кольцами
    const a = k * (Math.PI / 16) + 0.05, r0 = 107, n = 2 + (R() * 3 | 0);
    for (let i = 0; i < n; i++) for (let r = r0 + 2; r < r0 + 11; r++) { const aa = a + i * 0.022; if (R() < 0.85) mark(c + Math.cos(aa) * r, c + Math.sin(aa) * r); }
  }
  for (let y = -26; y <= 24; y++) for (let t = -1; t <= 1; t++) mark(c + t, c + y);          // меч в центре
  for (let x = -9; x <= 9; x++) { mark(c + x, c - 12); mark(c + x, c - 11); }
  return { lines: A.done(), glow: B.done() };
}

// ---------- Ковровая дорожка (32×32, тайл): багровая ткань с золотой каймой ----------
export function carpet() {
  const S = 32, T = px(S, S), R = rng(9);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = R() * 14 - 7, e = Math.min(x, S - 1 - x);
    let col = [120 + n, 16 + n * 0.3, 22 + n * 0.3];
    if (e < 2) col = [70, 44, 14]; else if (e < 4) col = [214 + n, 166 + n, 64]; else if (e === 4) col = [70, 10, 14];
    else if ((x + y) % 8 === 0 || (x - y + 64) % 8 === 0) col = [146 + n, 26, 30];
    T.set(x, y, col[0], col[1], col[2]);
  }
  return T.done();
}

// ---------- Мягкие градиенты (не пиксельные): столб света, пятно света, кольцо ----------
export function shaftCanvas() {
  const W = 64, H = 128, T = px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.abs(x - 31.5) / 32, v = y / (H - 1);                 // v = 0 — у окна
    const a = Math.pow(Math.max(0, 1 - u), 1.6) * Math.pow(1 - v, 1.3) * (0.6 + 0.4 * Math.sin(x * 0.9) * Math.sin(x * 0.37 + 1));
    T.set(x, y, 255, 255, 255, Math.max(0, a) * 255);
  }
  return T.done();
}
export function poolCanvas(size = 64) {
  const T = px(size, size), c = size / 2 - 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c) / (size / 2);
    T.set(x, y, 255, 255, 255, Math.pow(Math.max(0, 1 - d), 1.8) * 255);
  }
  return T.done();
}

// ---------- Кованая цепь (8×32, тайл по вертикали) ----------
export function chainCanvas() {
  const T = px(8, 32);
  for (let k = 0; k < 4; k++) {
    const y0 = k * 8, wide = k % 2 === 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = wide ? ((x === 1 || x === 6) && y > 0 && y < 7) || ((y === 0 || y === 7) && x > 1 && x < 6) : (x === 3 || x === 4);
      if (on) { const s = wide && x === 1 ? 150 : wide ? 86 : 110; T.set(x, y0 + y, s, s + 4, s + 16); }
    }
  }
  return T.done();
}
