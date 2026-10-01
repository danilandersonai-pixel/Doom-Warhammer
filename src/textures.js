// Процедурные текстуры окружения: тайлы 128–256 px, чёткие пиксели (NearestFilter),
// но с деталями: заклёпки, швы, трещины, потёртости, копоть, снежный налёт, шум.
import { nearestTexture, rng, noise2, hex } from './pixel.js';

// Холст с прямым доступом к пикселям
function canvasRGBA(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const set = (x, y, r, gg, b, a = 255) => {
    x = ((x % w) + w) % w; y = ((y % h) + h) % h; // тайлинг: выход за край заворачивается
    const i = (y * w + x) * 4;
    if (a >= 255) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; return; }
    const k = a / 255;
    d[i] = d[i] * (1 - k) + r * k; d[i + 1] = d[i + 1] * (1 - k) + gg * k; d[i + 2] = d[i + 2] * (1 - k) + b * k; d[i + 3] = 255;
  };
  const get = (x, y) => { x = ((x % w) + w) % w; y = ((y % h) + h) % h; const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const shade = (x, y, k) => { const [r, gg, b] = get(x, y); set(x, y, r * k, gg * k, b * k); };
  const done = () => { g.putImageData(img, 0, 0); return c; };
  return { c, g, d, set, get, shade, done, w, h };
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));

// Многооктавный шум для "живой" поверхности (тайлится, если период кратен размеру)
function fbm(n, x, y, oct = 3) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += n(x * f, y * f) * a; a *= 0.5; f *= 2; }
  return v;
}

// ---------- Снег (256) ----------
function snow() {
  const T = canvasRGBA(256, 256), R = rng(1), n = noise2(3);
  const base = hex('#dfe5ef'), shadow = hex('#b9c4d6'), bright = hex('#f4f7fb');
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = fbm(n, x / 32, y / 32);
    const ripple = Math.sin((x * 0.06 + y * 0.11) + fbm(n, x / 64 + 9, y / 64) * 6) * 0.5 + 0.5; // рябь от ветра
    let c = mix(shadow, base, clamp(v * 1.3 - 0.1 + ripple * 0.25, 0, 1));
    if (ripple > 0.9) c = mix(c, bright, 0.6);
    const q = Math.round((c[0] - 200) / 7) * 7 + 200; // мягкая постеризация — пиксельные пятна
    T.set(x, y, clamp(q), clamp(c[1] + (q - c[0])), clamp(c[2] + (q - c[0])));
  }
  for (let i = 0; i < 600; i++) T.set(R() * 256 | 0, R() * 256 | 0, 255, 255, 255); // искры
  for (let i = 0; i < 40; i++) { // камешки
    const x = R() * 256 | 0, y = R() * 256 | 0;
    T.set(x, y, 90, 92, 110); T.set(x + 1, y, 120, 122, 140); T.set(x, y + 1, 70, 70, 86);
  }
  return T.done();
}

// ---------- Скала (128): грани-фасетки, трещины, снег в щелях ----------
function rock() {
  const T = canvasRGBA(128, 128), R = rng(2), n = noise2(5);
  const pts = [];
  for (let i = 0; i < 26; i++) pts.push([R() * 128, R() * 128, 0.75 + R() * 0.5, R() * 6.28]);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    // ближайшая и вторая ближайшая точки (ячейки Вороного) — каменные грани
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) {
      const d = Math.hypot(x - p[0] - ox, y - p[1] - oy);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    const facet = Math.cos(best[3] - 2.3) * 0.18 + best[2] * 0.15; // разный наклон граней
    let v = 0.55 + facet + (fbm(n, x / 16, y / 16) - 0.5) * 0.35;
    if (edge < 1.6) v = 0.22;                    // трещина между гранями
    else if (edge < 3) v += 0.12;                 // светлая кромка
    const c = mix(hex('#4a4656'), hex('#9a96a8'), clamp(v, 0, 1));
    T.set(x, y, c[0], c[1], c[2]);
    if (edge < 1.6 && y % 3 === 0 && R() < 0.5) T.set(x, y, 225, 232, 242); // снег в щелях
  }
  for (let i = 0; i < 30; i++) { const x = R() * 128 | 0, y = R() * 128 | 0; T.set(x, y, 110, 130, 90); T.set(x + 1, y, 90, 110, 70); } // лишайник
  return T.done();
}

// ---------- Каменная кладка (128): блоки с фаской, сколы, копоть ----------
function blocks() {
  const T = canvasRGBA(128, 128), R = rng(3), n = noise2(7);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = 0.5 + (fbm(n, x / 12, y / 12) - 0.5) * 0.4;
    const c = mix(hex('#4e5262'), hex('#8a8e9e'), v);
    T.set(x, y, c[0], c[1], c[2]);
  }
  const rowH = 32;
  for (let r = 0; r < 4; r++) {
    const off = (r % 2) * 32;
    for (let k = 0; k < 3; k++) {
      const x0 = k * 64 + off, y0 = r * rowH;
      const tone = 0.85 + R() * 0.3;
      for (let y = 0; y < rowH; y++) for (let x = 0; x < 64; x++) {
        const px = x0 + x, py = y0 + y;
        if (y < 2 || x < 2) { T.set(px, py, 38, 40, 50); continue; }             // шов
        if (y === 2 || x === 2) { T.shade(px, py, 1.35); continue; }              // светлая фаска
        if (y === rowH - 1 || x === 63) { T.shade(px, py, 0.7); continue; }       // тень
        T.shade(px, py, tone);
      }
      // скол на углу
      if (R() < 0.5) for (let i = 0; i < 6; i++) for (let j = 0; j < 6 - i; j++) T.shade(x0 + 3 + i, y0 + 3 + j, 0.75);
    }
  }
  // копоть потёками сверху вниз
  for (let i = 0; i < 6; i++) {
    const x = R() * 128 | 0, len = 20 + R() * 60;
    for (let y = 0; y < len; y++) for (let w = 0; w < 3; w++) T.shade(x + w, y, 0.86 + y / len * 0.14);
  }
  return T.done();
}

// ---------- Металлическая плита (128): рамка, заклёпки, гравировка, ржавые потёки ----------
function metal() {
  const T = canvasRGBA(128, 128), R = rng(4), n = noise2(9);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = 0.5 + (fbm(n, x / 10, y / 10) - 0.5) * 0.3;
    const c = mix(hex('#4a4e5c'), hex('#868c9c'), v);
    T.set(x, y, c[0], c[1], c[2]);
  }
  // рамка с фаской
  for (let i = 0; i < 128; i++) for (let t = 0; t < 8; t++) {
    const k = t < 2 ? 1.3 : t > 5 ? 0.75 : 1.1;
    T.shade(i, t, k); T.shade(t, i, k); T.shade(i, 127 - t, 1.6 - k); T.shade(127 - t, i, 1.6 - k);
  }
  // вдавленная центральная панель
  for (let y = 18; y < 110; y++) for (let x = 18; x < 110; x++) T.shade(x, y, y === 18 || x === 18 ? 0.6 : y === 109 || x === 109 ? 1.3 : 0.92);
  // заклёпки по контуру
  const rivet = (x, y) => {
    T.set(x, y, 160, 166, 180); T.set(x + 1, y, 120, 126, 140); T.set(x, y + 1, 120, 126, 140); T.set(x + 1, y + 1, 40, 42, 52);
    T.set(x - 1, y, 200, 206, 216);
    for (let k = 2; k < 10 + R() * 18; k++) T.set(x + (k % 2), y + k, 120 + R() * 30, 60, 30, 70); // ржавый потёк
  };
  for (let i = 10; i < 128; i += 18) { rivet(i, 4); rivet(4, i); rivet(i, 122); rivet(122, i); }
  // гравировка — своя эмблема: меч в круге с лучами
  const cx = 64, cy = 64;
  for (let a = 0; a < 6.28; a += 0.02) {
    for (const r of [22, 23]) { const x = cx + Math.cos(a) * r | 0, y = cy + Math.sin(a) * r | 0; T.shade(x, y, 0.55); T.shade(x + 1, y + 1, 1.3); }
  }
  for (let k = 0; k < 8; k++) { const a = k * 0.785; for (let r = 25; r < 34; r++) T.shade(cx + Math.cos(a) * r | 0, cy + Math.sin(a) * r | 0, 0.6); }
  for (let y = cy - 28; y < cy + 26; y++) { T.shade(cx, y, 0.5); T.shade(cx + 1, y, 1.35); }
  for (let x = cx - 9; x < cx + 10; x++) { T.shade(x, cy - 12, 0.5); T.shade(x, cy - 11, 1.35); }
  // царапины
  for (let i = 0; i < 14; i++) { let x = R() * 128, y = R() * 128; const a = R() * 6.28; for (let k = 0; k < 8 + R() * 14; k++) { T.shade(x | 0, y | 0, 1.25); x += Math.cos(a); y += Math.sin(a); } }
  return T.done();
}

// ---------- Мешки с песком (128): ряды мешков со швами и складками ----------
function sandbags() {
  const T = canvasRGBA(128, 128), R = rng(5), n = noise2(11);
  T.g.fillStyle = '#3e3020';
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) T.set(x, y, 62, 48, 32);
  for (let r = 0; r < 4; r++) {
    const off = (r % 2) * 21;
    for (let k = -1; k < 4; k++) {
      const x0 = k * 42 + off, y0 = r * 32;
      for (let y = 1; y < 31; y++) for (let x = 1; x < 41; x++) {
        const u = (x - 20.5) / 20, v = (y - 15.5) / 15;
        const d = u * u * u * u + v * v * v * v;
        if (d > 1) continue;
        const lit = clamp(0.65 - v * 0.35 - u * 0.15 + (fbm(n, (x0 + x) / 6, (y0 + y) / 6) - 0.5) * 0.35 - d * 0.35, 0, 1);
        const c = mix(hex('#5a4228'), hex('#c8a070'), lit);
        T.set(x0 + x, y0 + y, c[0], c[1], c[2]);
      }
      for (let x = 4; x < 38; x += 2) T.shade(x0 + x, y0 + 5, 0.75);   // шов
      for (let i = 0; i < 3; i++) { const fx = x0 + 8 + R() * 24 | 0; for (let y = 8; y < 24; y++) T.shade(fx + (y % 3 === 0 ? 1 : 0), y0 + y, 0.85); } // складки
      if (R() < 0.6) for (let x = 6; x < 36; x++) if (R() < 0.6) T.set(x0 + x, y0 + 2, 236, 240, 248); // снег на верхушке
    }
  }
  return T.done();
}

// ---------- Ящик (128): оливковые доски, металлические уголки, трафарет ----------
function crate() {
  const T = canvasRGBA(128, 128), R = rng(6), n = noise2(13);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const plank = Math.floor(y / 21);
    const grain = Math.sin(x * 0.4 + plank * 7 + fbm(n, x / 20, y / 4) * 4) * 0.08;
    const c = mix(hex('#3e442e'), hex('#727a56'), 0.5 + grain + (plank % 2) * 0.06);
    T.set(x, y, c[0], c[1], c[2]);
    if (y % 21 === 0) T.set(x, y, 30, 32, 22);
  }
  for (let i = 0; i < 128; i++) for (let t = 0; t < 10; t++) { T.shade(i, t, 0.8); T.shade(t, i, 0.8); T.shade(i, 127 - t, 0.8); T.shade(127 - t, i, 0.8); }
  for (let i = 0; i < 128; i++) { T.shade(i, i, 0.7); T.shade(i + 1, i, 0.7); T.shade(i + 2, i, 1.2); } // диагональная планка
  for (const [cx, cy] of [[0, 0], [110, 0], [0, 110], [110, 110]]) for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) T.set(cx + x, cy + y, 110 + (x + y) % 3 * 10, 112, 122);
  // трафаретные знаки
  for (let k = 0; k < 3; k++) for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if ((x + y * 3 + k) % 4 !== 0) T.set(70 + k * 8 + x, 56 + y, 214, 200, 150, 200);
  return T.done();
}

// ---------- Бочка (64×128): красная с белой полосой и своим знаком ----------
function barrel() {
  const T = canvasRGBA(64, 128), n = noise2(15);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const v = 0.55 + (fbm(n, x / 6, y / 6) - 0.5) * 0.25;
    let c = mix(hex('#6a1410'), hex('#d0402c'), v);
    if (y > 50 && y < 74) c = mix(hex('#b8b8b0'), hex('#f0f0e8'), v);    // белая полоса
    if (y % 40 < 4) c = [50, 50, 58];                                       // обручи
    T.set(x, y, c[0], c[1], c[2]);
  }
  // знак "огонь" в треугольнике
  for (let y = 0; y < 18; y++) for (let x = -y / 2; x <= y / 2; x++) if (Math.abs(x) > y / 2 - 2 || y > 15) T.set(32 + x | 0, 53 + y, 30, 30, 30);
  for (let y = 6; y < 15; y++) T.set(32, 53 + y, 200, 60, 20);
  return T.done();
}

// ---------- Железо ворот (128): шипастые заклёпки и перекладины ----------
function gate() {
  const T = canvasRGBA(128, 128), n = noise2(17);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = 0.45 + (fbm(n, x / 8, y / 8) - 0.5) * 0.3;
    const c = mix(hex('#2c2e36'), hex('#5e6270'), v);
    T.set(x, y, c[0], c[1], c[2]);
    if (x % 32 < 3) T.shade(x, y, x % 32 === 0 ? 1.4 : 0.6);
  }
  for (const yy of [16, 64, 112]) for (let x = 0; x < 128; x++) for (let t = -4; t < 4; t++) T.shade(x, yy + t, t < -2 ? 1.4 : t > 2 ? 0.6 : 1.1);
  for (let y = 8; y < 128; y += 16) for (let x = 16; x < 128; x += 32) { T.set(x, y, 190, 160, 90); T.set(x + 1, y, 140, 110, 50); T.set(x, y + 1, 90, 70, 30); }
  return T.done();
}

// ---------- Плиты пола платформы (256): крупные плиты, снег по углам ----------
function tiles() {
  const T = canvasRGBA(256, 256), R = rng(8), n = noise2(19);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = 0.5 + (fbm(n, x / 14, y / 14) - 0.5) * 0.35;
    const c = mix(hex('#5c6070'), hex('#9a9eae'), v);
    T.set(x, y, c[0], c[1], c[2]);
    if (x % 64 < 2 || y % 64 < 2) T.set(x, y, 40, 42, 52);
    else if (x % 64 === 2 || y % 64 === 2) T.shade(x, y, 1.3);
    const sn = fbm(n, x / 40 + 3, y / 40 + 5);
    if (sn > 0.62) T.set(x, y, 222, 228, 238);                              // снежные пятна
    else if (sn > 0.58 && (x + y) % 2) T.set(x, y, 200, 208, 222);
  }
  for (let i = 0; i < 20; i++) { let x = R() * 256, y = R() * 256; for (let k = 0; k < 14; k++) { T.set(x | 0, y | 0, 34, 34, 42); x += R() * 2 - 0.5; y += R() * 2 - 0.5; } }
  return T.done();
}

// ---------- Броня техники (128): оливково-серые плиты, заклёпки, нагар ----------
function hull() {
  const T = canvasRGBA(128, 128), n = noise2(21);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = 0.5 + (fbm(n, x / 10, y / 10) - 0.5) * 0.35;
    const soot = fbm(n, x / 30 + 7, y / 30) > 0.6 ? 0.55 : 1;
    const c = mix(hex('#3c4236'), hex('#7a8270'), v).map((q) => q * soot);
    T.set(x, y, c[0], c[1], c[2]);
    if (y % 43 < 2) T.set(x, y, 30, 32, 28);
    if (y % 43 === 4 && x % 8 === 0) { T.set(x, y, 150, 156, 140); T.set(x + 1, y + 1, 30, 32, 28); }
  }
  return T.done();
}

// ---------- Знамя (64×128) ----------
// friend: своё знамя (меч в солнце на багровом), иначе — знамя врага (глаз-спираль на тёмно-фиолетовом)
function banner(friend) {
  const T = canvasRGBA(64, 128), n = noise2(friend ? 23 : 25), R = rng(friend ? 4 : 6);
  const base = friend ? [hex('#4a0c10'), hex('#a8222a')] : [hex('#241430'), hex('#5e3a6a')];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const fold = Math.sin(x * 0.35) * 0.15;
    const c = mix(base[0], base[1], 0.55 + fold + (fbm(n, x / 8, y / 8) - 0.5) * 0.3);
    T.set(x, y, c[0], c[1], c[2]);
    if (x < 3 || x > 60 || y < 4) T.set(x, y, 200, 160, 70);       // кайма
  }
  const cx = 32, cy = 50;
  const gold = [232, 190, 80];
  if (friend) {
    for (let a = 0; a < 6.28; a += 0.3) for (let r = 12; r < 20; r++) T.set(cx + Math.cos(a) * r | 0, cy + Math.sin(a) * r | 0, ...gold);
    for (let y = cy - 18; y < cy + 18; y++) { T.set(cx, y, 240, 240, 250); T.set(cx + 1, y, 180, 180, 196); }
    for (let x = cx - 7; x < cx + 8; x++) T.set(x, cy - 8, ...gold);
  } else {
    // глаз со спиралью и тремя зубцами
    for (let a = 0; a < 6.28; a += 0.02) { const r = 13; T.set(cx + Math.cos(a) * r * 1.4 | 0, cy + Math.sin(a) * r * 0.7 | 0, 220, 200, 60); }
    for (let t = 0; t < 12; t += 0.05) { const r = t * 0.9; T.set(cx + Math.cos(t * 1.6) * r | 0, cy + Math.sin(t * 1.6) * r * 0.7 | 0, 240, 220, 70); }
    for (const dx of [-12, 0, 12]) for (let y = 0; y < 10; y++) { T.set(cx + dx, cy - 14 - y, 220, 200, 60); T.set(cx + dx + (y > 6 ? 1 : 0), cy - 14 - y, 220, 200, 60); }
  }
  // рваный низ — прозрачные зубцы
  for (let x = 0; x < 64; x++) {
    const cut = 104 + Math.abs(Math.sin(x * 0.5 + R())) * 14 + R() * 6;
    for (let y = cut | 0; y < 128; y++) { const i = (y * 64 + x) * 4; T.d[i + 3] = 0; }
  }
  for (let i = 0; i < 6; i++) { const x = 8 + R() * 48 | 0, y = 70 + R() * 30 | 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) T.d[((y + b) * 64 + x + a) * 4 + 3] = 0; } // дыры
  return T.done();
}

let cache = null;
export function envTextures() {
  if (cache) return cache;
  const tex = (c) => nearestTexture(c, true);
  cache = {
    snow: tex(snow()), rock: tex(rock()), blocks: tex(blocks()), metal: tex(metal()),
    sandbags: tex(sandbags()), crate: tex(crate()), barrel: tex(barrel()), gate: tex(gate()),
    tiles: tex(tiles()), hull: tex(hull()), bannerFriend: tex(banner(true)), bannerEnemy: tex(banner(false)),
  };
  return cache;
}

// Для tools/preview.html?set=tex — сами холсты
export function textureCanvases() {
  return { snow: snow(), rock: rock(), blocks: blocks(), metal: metal(), sandbags: sandbags(), crate: crate(), barrel: barrel(), gate: gate(), tiles: tiles(), hull: hull(), bannerFriend: banner(true), bannerEnemy: banner(false) };
}
