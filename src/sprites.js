// Пиксельная графика, нарисованная кодом: спрайты врагов, кровь, куски, взрывы, огонь.
// Всё оригинальное — рисуем прямоугольниками на маленьком canvas, потом растягиваем без сглаживания.
import * as THREE from 'three';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Текстура "без размытия" — пиксели остаются квадратными
export function pixelTexture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = repeat ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  t.generateMipmaps = repeat;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Предсказуемый генератор случайных чисел — чтобы картинка всегда была одинаковой
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Тёмный контур в 1 пиксель вокруг непрозрачных пикселей — классика пиксель-арта
function outline(g, x0, y0, w, h, color = [12, 6, 6]) {
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
  const mark = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a(x, y) === 0 && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) mark.push((y * w + x) * 4);
    }
  }
  for (const i of mark) { d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2]; d[i + 3] = 255; }
  g.putImageData(img, x0, y0);
}

// Рисовалка: P(цвет, x, y, w, h) внутри кадра со смещением ox
function painter(g, ox) {
  return (c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(ox + x, y, w, h); };
}

// ---------- Враг ближнего боя: культист в рваном балахоне с серпом ----------
// Кадры: 0,1 — шаг; 2 — замах; 3 — удар
function drawCultist(P, f) {
  const robe = ['#2c0e0c', '#5a1a14', '#8a2c22'], skin = '#b08468', boot = '#1a1210';
  const blade = '#d0d0c8', bladeD = '#7a7a72';
  // ноги
  P(boot, f === 1 ? 7 : 8, 37, 4, 3);
  P(boot, f === 1 ? 14 : 13, 37, 4, 3);
  // балахон расширяется книзу
  for (let y = 13; y < 37; y++) {
    const w = Math.round(9 + ((y - 13) / 24) * 7);
    const x0 = 12 - Math.floor(w / 2);
    P(robe[1], x0, y, w);
    P(robe[2], x0, y, 2);
    P(robe[0], x0 + w - 3, y, 3);
  }
  P(robe[0], 11, 24, 1, 12);                  // складка
  for (let x = 6; x < 18; x += 3) P(robe[0], x, 36, 1, 1); // рваный край
  P('#a07a34', 8, 22, 9, 1);                  // верёвка-пояс
  P('#d0a040', 9, 23, 1, 3);
  // капюшон
  P(robe[1], 8, 4, 8, 10);
  P(robe[1], 9, 3, 6, 1);
  P(robe[2], 8, 5, 1, 8);
  P(robe[0], 15, 5, 1, 9);
  P('#100606', 10, 7, 5, 5);                  // темнота под капюшоном
  P('#ffd040', 11, 9); P('#ffd040', 13, 9);   // горящие глаза
  // левая рука
  P(robe[1], 5, 14, 3, 9);
  P(skin, 5, 23, 3, 2);
  // правая рука с серпом
  if (f === 2) {
    P(robe[1], 16, 5, 3, 9);
    P(skin, 16, 3, 3, 2);
    P(blade, 17, 0, 2, 3); P(blade, 19, 0, 3, 1); P(bladeD, 21, 1, 1, 2);
  } else if (f === 3) {
    P(robe[1], 16, 13, 4, 4);
    P(skin, 19, 16, 3, 2);
    for (let i = 0; i < 7; i++) P(i < 2 ? '#6a4a30' : blade, 20 - i, 18 + i, 2, 1);
  } else {
    P(robe[1], 16, 14, 3, 9);
    P(skin, 16, 23, 3, 2);
    P('#6a4a30', 17, 25, 1, 3);
    P(blade, 17, 28, 1, 7); P(blade, 18, 34, 3, 1); P(bladeD, 18, 28, 1, 6);
  }
}

// ---------- Стрелок: солдат-предатель в шлеме с винтовкой ----------
// Кадры: 0,1 — шаг; 2 — прицел; 3 — выстрел (вспышка)
function drawGunner(P, f) {
  const arm = ['#24281e', '#3e4634', '#5c6a4a'], cloth = '#3a2a22', boot = '#14100c';
  P(boot, f === 1 ? 7 : 8, 36, 5, 4);
  P(boot, f === 1 ? 15 : 14, 36, 5, 4);
  P(cloth, 8, 26, 4, 10); P(cloth, 14, 26, 4, 10);     // штаны
  P(arm[1], 7, 28, 5, 3); P(arm[1], 14, 28, 5, 3);      // наколенники
  P(arm[1], 7, 13, 12, 14);                              // броня торса
  P(arm[2], 7, 13, 2, 13); P(arm[0], 16, 13, 3, 14);
  P('#7a2a20', 7, 25, 12, 2);                            // пояс
  P(arm[1], 3, 12, 5, 5); P(arm[2], 3, 12, 5, 1);       // наплечники
  P(arm[1], 18, 12, 5, 5); P(arm[2], 18, 12, 5, 1);
  // шлем с зелёным визором
  P(arm[1], 9, 3, 8, 9); P(arm[2], 9, 3, 2, 8); P(arm[0], 15, 4, 2, 8);
  P('#0c100a', 10, 6, 6, 2); P('#70ff50', 10, 6, 2, 1); P('#70ff50', 14, 6, 2, 1);
  P(arm[0], 10, 10, 6, 2);                               // респиратор
  // винтовка у груди, ствол смотрит на игрока
  P(arm[1], 5, 17, 3, 6); P(arm[1], 18, 17, 3, 6);       // руки
  P('#1c1c1c', 6, 19, 14, 4); P('#4a4a4a', 6, 19, 14, 1);
  P('#2a2a2a', 11, 17, 4, 7); P('#101010', 12, 18, 2, 2); // дуло на нас
  P('#8a6a3a', 17, 22, 3, 4);                             // приклад
  if (f === 3) { // вспышка выстрела
    P('#a0ff60', 9, 14, 8, 8); P('#f0ffc0', 11, 16, 4, 4);
    P('#60e040', 12, 11, 2, 3); P('#60e040', 6, 17, 3, 2); P('#60e040', 17, 17, 3, 2);
  } else if (f === 2) {
    P('#60e040', 12, 18, 2, 2); // заряд светится
  }
}

// ---------- Чемпион: огромный рогатый воин в багровой броне ----------
// Кадры: 0,1 — шаг; 2 — замах когтем / прицел; 3 — выстрел
function drawChampion(P, f) {
  const r = ['#3a0a0a', '#6e1414', '#a02420', '#c84030'], b = ['#7a5a20', '#c09a40', '#f0d070'];
  const bone = '#d8ccb0', boneD = '#9a8c70';
  // ноги
  const lx = f === 1 ? 10 : 12, rx = f === 1 ? 26 : 24;
  P(r[1], lx, 40, 8, 14); P(r[2], lx, 40, 2, 14); P(r[0], lx, 54, 9, 6);
  P(r[1], rx, 40, 8, 14); P(r[0], rx + 6, 40, 2, 14); P(r[0], rx - 1, 54, 9, 6);
  P(b[1], lx, 46, 8, 2); P(b[1], rx, 46, 8, 2);
  // торс
  P(r[1], 9, 18, 26, 23); P(r[2], 9, 18, 4, 22); P(r[0], 30, 18, 5, 23);
  P(r[0], 15, 24, 14, 1); P(r[0], 15, 30, 14, 1);          // пластины
  P(b[1], 10, 38, 24, 3); P(b[2], 10, 38, 24, 1);          // золотой пояс
  P(bone, 19, 36, 6, 6); P('#1a0c0c', 20, 38, 1, 2); P('#1a0c0c', 23, 38, 1, 2); // костяная пряжка
  // огромные наплечники с шипами
  for (const [x, flip] of [[0, 0], [33, 1]]) {
    P(r[1], x, 14, 11, 10); P(r[2], x, 14, 11, 2); P(b[1], x, 23, 11, 2);
    P(boneD, x + (flip ? 7 : 2), 9, 2, 5); P(bone, x + (flip ? 7 : 2), 7, 1, 3);
  }
  // голова в шлеме и рога
  P(r[1], 16, 6, 12, 12); P(r[2], 16, 6, 3, 11); P(r[0], 25, 7, 3, 11);
  P('#0c0606', 18, 10, 8, 3); P('#90ff40', 18, 11, 3, 1); P('#90ff40', 23, 11, 3, 1);
  P(b[1], 19, 15, 6, 2);
  P(bone, 13, 2, 3, 6); P(bone, 12, 0, 2, 3); P(boneD, 15, 5, 1, 3);
  P(bone, 28, 2, 3, 6); P(bone, 30, 0, 2, 3); P(boneD, 28, 5, 1, 3);
  // левая рука — пушка
  P(r[1], 1, 24, 8, 12); P('#2a2a2a', 0, 34, 10, 10); P('#4a4a4a', 0, 34, 10, 2);
  P('#0c0c0c', 2, 40, 6, 4);
  if (f === 3) { P('#a0ff60', -1 + 1, 38, 10, 8); P('#f0ffc0', 3, 40, 4, 4); P('#60e040', 4, 46, 2, 3); }
  // правая рука — когти
  if (f === 2) {
    P(r[1], 35, 4, 8, 12); P(b[1], 35, 14, 8, 2);
    P(bone, 35, 0, 2, 4); P(bone, 38, 0, 2, 4); P(bone, 41, 1, 2, 4);
  } else {
    P(r[1], 35, 24, 8, 12); P(b[1], 35, 34, 8, 2);
    P(bone, 35, 36, 2, 6); P(bone, 38, 36, 2, 7); P(bone, 41, 36, 2, 6);
  }
}

const SPRITE_DEFS = {
  melee: { w: 24, h: 40, draw: drawCultist },
  ranged: { w: 26, h: 40, draw: drawGunner },
  boss: { w: 44, h: 60, draw: drawChampion },
};
export const SPRITE_FRAMES = 4;

// Атлас: 4 кадра в ряд (с отступом в 2 пикселя для контура)
const atlasCache = {};
export function enemyAtlas(type) {
  if (atlasCache[type]) return atlasCache[type];
  const def = SPRITE_DEFS[type];
  const fw = def.w + 2, fh = def.h + 2;
  const c = makeCanvas(fw * SPRITE_FRAMES, fh);
  const g = c.getContext('2d', { willReadFrequently: true });
  for (let f = 0; f < SPRITE_FRAMES; f++) {
    const P = painter(g, f * fw + 1);
    const P2 = (col, x, y, w, h) => P(col, x, y + 1, w, h); // сдвиг на 1 пиксель вниз для контура сверху
    def.draw(P2, f);
    outline(g, f * fw, 0, fw, fh);
  }
  atlasCache[type] = { canvas: c, frameW: fw, frameH: fh, aspect: fw / fh };
  return atlasCache[type];
}

// ---------- Куски (гибы): мясо, кость, броня ----------
export function gibTextures() {
  const list = [];
  const shapes = [
    (P) => { P('#7a0a0a', 1, 2, 6, 4); P('#c01818', 2, 2, 4, 2); P('#e04040', 2, 2, 2, 1); P('#4a0404', 1, 5, 6, 1); },
    (P) => { P('#e8dcc0', 0, 3, 8, 2); P('#e8dcc0', 0, 2, 2, 4); P('#e8dcc0', 6, 2, 2, 4); P('#a09478', 1, 4, 6, 1); },
    (P) => { P('#5a1010', 1, 1, 5, 6); P('#9a2020', 2, 1, 3, 3); P('#c03030', 2, 2, 1, 1); },
    (P) => { P('#3e4634', 1, 2, 6, 4); P('#5c6a4a', 1, 2, 6, 1); P('#7a2a20', 1, 5, 6, 1); },
  ];
  for (const s of shapes) {
    const c = makeCanvas(10, 10);
    const g = c.getContext('2d', { willReadFrequently: true });
    s(painter(g, 1), 0);
    outline(g, 0, 0, 10, 10);
    list.push(pixelTexture(c));
  }
  return list;
}

// ---------- Лужи крови на полу ----------
export function splatTextures(count = 4) {
  const list = [];
  for (let n = 0; n < count; n++) {
    const R = rng(100 + n);
    const s = 32, c = makeCanvas(s, s), g = c.getContext('2d');
    const blob = (cx, cy, r, col) => {
      g.fillStyle = col;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) g.fillRect(cx + x, cy + y, 1, 1);
    };
    blob(16, 16, 7, '#6a0606');
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, d = 5 + R() * 9;
      blob(Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d), 1 + Math.floor(R() * 3), '#6a0606');
    }
    blob(15, 15, 4, '#9a1010');
    blob(14, 14, 1, '#c82020');
    list.push(pixelTexture(c));
  }
  return list;
}

// ---------- Взрыв болта: 5 кадров ----------
export function explosionAtlas() {
  const s = 24, frames = 5;
  const c = makeCanvas(s * frames, s), g = c.getContext('2d');
  const R = rng(7);
  for (let f = 0; f < frames; f++) {
    const ox = f * s, r = 3 + f * 2.2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x - 12 + 0.5, y - 12 + 0.5) + R() * 2;
        if (d > r) continue;
        const k = d / r + f * 0.18;
        let col = '#fff6c0';
        if (k > 0.35) col = '#ffd040';
        if (k > 0.6) col = '#ff7a10';
        if (k > 0.85) col = '#a02808';
        if (k > 1.05) col = (x + y) % 2 ? '#3a2a24' : null; // дым с дизерингом
        if (f >= 3 && R() < (f - 2) * 0.3) col = null;     // рассеивается
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(ox + x, y, 1, 1);
      }
    }
  }
  return { texture: pixelTexture(c), frames };
}

// ---------- Огонь жаровни: 4 кадра ----------
export function fireAtlas() {
  const w = 16, h = 24, frames = 4;
  const c = makeCanvas(w * frames, h), g = c.getContext('2d');
  for (let f = 0; f < frames; f++) {
    const R = rng(30 + f);
    for (let y = 0; y < h; y++) {
      const t = y / h; // 0 сверху
      const half = Math.max(0, (t * 7) - (1 - t) * 1 + Math.sin(y * 0.7 + f * 1.6) * 1.5);
      for (let x = 0; x < w; x++) {
        const dx = Math.abs(x - 7.5);
        if (dx > half || R() < 0.08 * (1 - t)) continue;
        const k = dx / (half + 0.01) * 0.6 + (1 - t) * 0.6;
        g.fillStyle = k < 0.45 ? '#fff0a0' : k < 0.75 ? '#ffb020' : k < 1 ? '#ff5a10' : '#a01808';
        g.fillRect(f * w + x, y, 1, 1);
      }
    }
  }
  return { texture: pixelTexture(c), frames };
}

// ---------- Варп-снаряд врагов (зелёный) ----------
export function plasmaTexture() {
  const s = 12, c = makeCanvas(s, s), g = c.getContext('2d');
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - 5.5, y - 5.5);
    const col = d < 2 ? '#f0ffd0' : d < 3.5 ? '#90ff40' : d < 5 ? ((x + y) % 2 ? '#30a020' : null) : null;
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return pixelTexture(c);
}

// ---------- Вспышка выстрела оружия игрока ----------
export function muzzleTexture() {
  const s = 32, c = makeCanvas(s, s), g = c.getContext('2d');
  const R = rng(3);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x - 15.5, dy = y - 15.5, d = Math.hypot(dx, dy);
    const ray = Math.abs(Math.sin(Math.atan2(dy, dx) * 4)) * 6;  // 8 лучей
    const lim = 7 + ray;
    if (d > lim || R() < 0.1) continue;
    const k = d / lim;
    g.fillStyle = k < 0.3 ? '#ffffff' : k < 0.55 ? '#fff080' : k < 0.8 ? '#ffa020' : '#ff5a08';
    g.fillRect(x, y, 1, 1);
  }
  return pixelTexture(c);
}
