// Прочий пиксель-арт: пикапы, иконки оружия, портреты героя и советника,
// кровь, куски, огонь, взрывы, дым, золотые метки-следы, ореолы.
import { Pix, ramp, hex, sheet, rng } from './pixel.js';

const M = {
  steel: ramp('#8c94a4', { spread: 0.5 }),
  iron: ramp('#41434e', { spread: 0.4 }),
  brass: ramp('#cba146', { spread: 0.5 }),
  gold: ramp('#e8b840', { spread: 0.5 }),
  casing: ramp('#a01e24', { spread: 0.45 }),
  olive: ramp('#5d6448', { spread: 0.42 }),
  glove: ramp('#6f7a8c', { spread: 0.48 }),
  blood: ramp('#e21b22', { spread: 0.4 }),
  meat: ramp('#b8343a', { spread: 0.45 }),
  bone: ramp('#e6dcc4', { spread: 0.4 }),
  lime: [hex('#2a4006'), hex('#5a8a0a'), hex('#9cd010'), hex('#d4ff40'), hex('#f8ffd0')],
  cyan: [hex('#0e2a3a'), hex('#14607e'), hex('#2cb4e6'), hex('#8af2ff'), hex('#eaffff')],
  heat: [hex('#3a0e06'), hex('#8e2208'), hex('#e05812'), hex('#ffac36'), hex('#fff2c6')],
  cloth: ramp('#7a1418', { spread: 0.4 }),
};
const blob = (P, cx, cy, rx, ry, r, o, rot = 0) => P.fill(P.mask().ellipse(cx, cy, rx, ry, rot), r, o);
const poly = (P, pts, r, o) => P.fill(P.mask().poly(pts), r, o);
const limb = (P, a, b, r1, r2, r, o) => P.fill(P.mask().limb(a[0], a[1], b[0], b[1], r1, r2), r, o);

// ---------- Пикапы (32×32) ----------
function medkit() {
  const P = new Pix(32, 32);
  poly(P, [[6, 12], [26, 12], [27, 29], [5, 29]], M.steel, { round: 3 });
  P.fill(P.mask().rect(5, 18, 23, 4), M.casing, { round: 1 });
  blob(P, 16, 11, 7, 3, M.steel, { round: 2, bias: 0.1 });
  P.fill(P.mask().rect(13, 4, 6, 8), M.brass, { round: 2 });              // ручка
  P.fill(P.mask().rect(14, 14, 4, 12).rect(10, 18, 12, 4), M.lime, { round: 1.5, contour: false, bias: 0.2 }); // зелёный крест
  return P.outline();
}
function armorPlate() {
  const P = new Pix(32, 32);
  poly(P, [[5, 6], [27, 6], [27, 18], [16, 29], [5, 18]], M.steel, { round: 5 });
  P.fill(P.mask().rect(5, 6, 23, 3), M.brass, { round: 1 });
  blob(P, 16, 15, 4, 4, M.lime, { round: 2, bias: 0.2, contour: false });
  for (const x of [8, 24]) P.set(x, 11, hex('#fff0b0'));
  return P.outline();
}
function ammoBox() {
  const P = new Pix(32, 32);
  for (let i = 0; i < 4; i++) limb(P, [9 + i * 4, 14], [9 + i * 4, 6], 1.8, 1.4, M.brass, { round: 1 }); // патроны
  poly(P, [[4, 14], [28, 14], [28, 29], [4, 29]], M.olive, { round: 3, tex: (x, y) => (y === 21 ? -1 : 0) });
  P.fill(P.mask().rect(13, 18, 6, 6), M.gold, { round: 1, contour: false });
  return P.outline();
}
function grenades() {
  const P = new Pix(32, 32);
  for (const [x, y] of [[11, 19], [21, 21]]) {
    blob(P, x, y, 6.5, 7, M.iron, { round: 3 });
    P.fill(P.mask().rect(x - 6, y - 1, 13, 2), M.casing, { round: 1, contour: false });
    P.fill(P.mask().rect(x - 2, y - 10, 4, 3), M.brass, { round: 1 });
  }
  return P.outline();
}
function relic() {
  const P = new Pix(32, 32);
  poly(P, [[7, 5], [25, 5], [21, 16], [11, 16]], M.gold, { round: 4 });   // чаша
  P.fill(P.mask().rect(14, 16, 4, 7), M.gold, { round: 1 });
  poly(P, [[8, 23], [24, 23], [22, 28], [10, 28]], M.gold, { round: 2 });
  blob(P, 16, 9, 2.5, 2.5, M.casing, { round: 1, bias: 0.3, contour: false });
  return P.outline();
}

// ---------- Иконки оружия (вид сбоку, 48×20) — для пикапов и HUD ----------
function icon(kind) {
  const P = new Pix(48, 20);
  if (kind === 'rifle') {
    poly(P, [[4, 6], [30, 6], [32, 12], [4, 12]], M.casing, { round: 2 });
    P.fill(P.mask().rect(30, 7, 16, 3), M.steel, { round: 1 });
    poly(P, [[12, 12], [17, 12], [16, 19], [11, 19]], M.iron, { round: 1 });
    poly(P, [[24, 12], [28, 12], [29, 17], [25, 17]], M.iron, { round: 1 });
  } else if (kind === 'shotgun') {
    P.fill(P.mask().rect(14, 5, 32, 3).rect(14, 9, 32, 3), M.iron, { round: 1 });
    poly(P, [[2, 7], [16, 6], [18, 13], [6, 17]], M.casing, { round: 2 });
    P.fill(P.mask().rect(20, 12, 10, 3), ramp('#6e4a34'), { round: 1 });
  } else if (kind === 'plasma') {
    blob(P, 14, 10, 11, 7, M.steel, { round: 3 });
    for (let x = 24; x < 44; x += 4) blob(P, x, 10, 2, 4, M.cyan, { round: 1, bias: 0.3, contour: false });
    P.fill(P.mask().rect(24, 9, 22, 2), M.iron, { round: 1, contour: false });
  } else if (kind === 'thermal') {
    poly(P, [[4, 5], [26, 5], [26, 15], [4, 15]], M.iron, { round: 2 });
    poly(P, [[26, 6], [40, 4], [44, 2], [44, 18], [40, 16], [26, 14]], M.steel, { round: 2 });
    blob(P, 43, 10, 1.5, 6, M.heat, { round: 1, bias: 0.3, contour: false });
    limb(P, [6, 15], [20, 15], 3, 3, M.casing, { round: 2 });
  } else if (kind === 'chainblade') {
    poly(P, [[14, 6], [44, 7], [47, 10], [44, 13], [14, 14]], M.casing, { round: 2 });
    for (let x = 16; x < 44; x += 3) P.set(x, 5, hex('#c8d0dc'));
    P.fill(P.mask().rect(10, 3, 3, 14), M.brass, { round: 1 });
    P.fill(P.mask().rect(2, 7, 8, 6), M.iron, { round: 1 });
  } else if (kind === 'grenade') {
    blob(P, 24, 11, 6, 7, M.iron, { round: 3 });
    P.fill(P.mask().rect(18, 10, 13, 2), M.casing, { round: 1, contour: false });
    P.fill(P.mask().rect(22, 2, 4, 3), M.brass, { round: 1 });
  }
  return P.outline();
}

// ---------- Портрет героя (40×40): шлем с Т-образным визором ----------
// state: 0 — цел, 1 — поцарапан, 2 — разбит и в крови; hurt — вспышка боли
function heroPortrait(state, hurt = false) {
  const P = new Pix(40, 40);
  const R = rng(9 + state);
  // наплечники и ворот
  blob(P, 6, 36, 10, 7, M.casing, { round: 4 });
  blob(P, 34, 36, 10, 7, M.casing, { round: 4 });
  P.fill(P.mask().rect(10, 30, 20, 10), M.glove, { round: 3 });
  // гребень-плюмаж
  P.fill(P.mask().ellipse(20, 6, 3, 6), M.cloth, { round: 2, tex: (x, y) => (y % 2 ? -0.6 : 0) });
  // шлем
  P.fill(P.mask().ellipse(20, 18, 12, 14).cut(P.mask().rect(0, 33, 40, 7)), M.steel, { round: 6 });
  P.fill(P.mask().rect(8, 15, 24, 2), M.brass, { round: 1 });                      // латунный обод
  // Т-образный визор
  const eye = hurt ? [hex('#ffffff'), hex('#ff8080')] : [hex('#d0fbff'), hex('#40c8ff')];
  P.rect(11, 18, 18, 3, [12, 14, 20]);
  P.rect(18, 18, 4, 11, [12, 14, 20]);
  P.rect(12, 19, 5, 1, eye[1]); P.rect(23, 19, 5, 1, eye[1]);
  P.set(13, 19, eye[0]); P.set(26, 19, eye[0]);
  for (let y = 23; y < 30; y += 2) { P.set(15, y, [40, 44, 54]); P.set(24, y, [40, 44, 54]); } // дыхательные прорези
  if (state >= 1) { // царапины
    P.line(9, 10, 14, 14, [60, 64, 76]); P.line(26, 24, 31, 21, [60, 64, 76]);
  }
  if (state >= 2) { // трещины и кровь
    P.line(22, 8, 25, 14, [30, 30, 36]); P.line(25, 14, 23, 17, [30, 30, 36]);
    for (let i = 0; i < 70; i++) {
      const x = 4 + R() * 32 | 0, y = 4 + R() * 30 | 0;
      if (P.alpha(x, y) && R() < 0.7) P.set(x, y, R() < 0.5 ? hex('#c8141c') : hex('#7a0a10'));
    }
  }
  return P.outline();
}

// ---------- Портрет советника (40×52): латунная маска-оракул с зелёной линзой в клетке ----------
function advisorPortrait() {
  const P = new Pix(40, 52);
  // клетка-фонарь
  for (let x = 7; x <= 33; x += 6) P.fill(P.mask().rect(x, 4, 2, 30), M.iron, { round: 1 });
  P.fill(P.mask().rect(5, 3, 30, 3).rect(5, 32, 30, 3), M.brass, { round: 1 });
  // свечи внутри клетки
  for (const x of [12, 20, 28]) {
    P.fill(P.mask().rect(x - 1, 14, 3, 10), M.bone, { round: 1 });
    P.glow(x + 0.5, 11, 2.5, hex('#fff6c0'), hex('#ffb030'));
  }
  // маска-оракул: латунное лицо с надбровьем, пустой глазницей и зелёной линзой
  P.fill(P.mask().ellipse(20, 40, 12, 11), M.brass, { round: 5 });
  P.fill(P.mask().poly([[8, 35], [32, 35], [30, 38], [10, 38]]), M.iron, { round: 1 });   // надбровье
  P.fill(P.mask().ellipse(14, 40, 3.5, 2.5), [[10, 6, 4], [24, 14, 8], [36, 22, 12], [48, 30, 16], [60, 40, 20]], { round: 1, contour: false });
  blob(P, 26, 40, 4.5, 4.5, M.iron, { round: 1.5 });
  blob(P, 26, 40, 3.2, 3.2, M.lime, { round: 2, bias: 0.25, contour: false });          // зелёная линза
  P.set(25, 39, hex('#ffffff'));
  P.line(20, 39, 20, 45, [120, 90, 40]);                                                 // переносица
  for (let x = 14; x <= 26; x += 3) P.rect(x, 47, 2, 2, [40, 28, 14]);                   // решётка рта
  // трубки
  P.fill(P.mask().limb(8, 44, 3, 51, 1.5), M.iron, { round: 1 });
  P.fill(P.mask().limb(32, 44, 37, 51, 1.5), M.casing, { round: 1 });
  return P.outline();
}

// ---------- Кровь на полу/стенах (64×64): брызги разного размера ----------
function bloodSplat(seed) {
  const P = new Pix(64, 64), R = rng(seed);
  const disk = (cx, cy, r) => P.mask().ellipse(cx, cy, r, r * (0.7 + R() * 0.3), R() * 3);
  const m = disk(32, 32, 9 + R() * 5);
  for (let i = 0; i < 12; i++) { const a = R() * 6.28, d = 6 + R() * 16; m.ellipse(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 2 + R() * 5, 2 + R() * 4, a); }
  for (let i = 0; i < 26; i++) { const a = R() * 6.28, d = 14 + R() * 16; const r = 0.6 + R() * 1.8; m.ellipse(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, r); }
  P.fill(m, M.blood, { round: 3, grad: 0, bias: -0.15, contour: false, dither: 0.8 });
  return P;
}

// ---------- Копоть от взрыва ----------
function scorch() {
  const P = new Pix(64, 64), R = rng(77);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 32, y - 32) / 30 + (R() - 0.5) * 0.25;
    if (d < 1) P.set(x, y, d < 0.5 ? [24, 20, 22] : [50, 44, 46], 255 * (1 - d * d) * 0.9);
  }
  return P;
}

// ---------- Куски (гибы) 14×14 ----------
function gib(kind) {
  const P = new Pix(14, 14);
  if (kind === 0) { blob(P, 7, 7, 5, 4, M.meat, { round: 2 }); P.set(5, 5, hex('#ff8080')); }
  if (kind === 1) { limb(P, [3, 10], [11, 4], 1.6, 1.6, M.bone, { round: 1 }); blob(P, 3, 10, 2.2, 2.2, M.bone, { round: 1 }); blob(P, 11, 4, 2.2, 2.2, M.bone, { round: 1 }); }
  if (kind === 2) { blob(P, 7, 7, 4, 5, M.blood, { round: 2 }); blob(P, 6, 6, 2, 2, M.meat, { round: 1, bias: 0.3 }); }
  if (kind === 3) { poly(P, [[2, 4], [12, 3], [11, 10], [3, 11]], M.iron, { round: 2 }); }
  if (kind === 4) { blob(P, 7, 7, 6, 3, M.meat, { round: 2 }, 0.6); }
  if (kind === 5) { poly(P, [[3, 3], [11, 4], [10, 11], [2, 10]], ramp('#8c1f26'), { round: 2 }); }
  return P.outline();
}

// ---------- Взрыв: 8 кадров 64×64 (огненный шар -> дым с дизерингом) ----------
function explosionFrames() {
  const frames = [], R = rng(5);
  const puffs = [];
  for (let i = 0; i < 14; i++) puffs.push([R() * 6.28, 0.3 + R() * 0.7, 0.5 + R() * 0.5]);
  for (let f = 0; f < 8; f++) {
    const P = new Pix(64, 64), t = f / 7;
    const fire = Math.max(0, 1 - t * 1.5), smoke = Math.min(1, t * 1.6);
    for (const [a, d, s] of puffs) {
      const cx = 32 + Math.cos(a) * d * (8 + t * 16), cy = 32 + Math.sin(a) * d * (8 + t * 16) - t * 10;
      const r = (6 + t * 10) * s;
      if (smoke > 0.1) P.fill(P.mask().ellipse(cx, cy, r, r), ramp('#5a5560', { spread: 0.35 }), { round: r * 0.6, contour: false, bias: -0.1 });
      if (fire > 0) P.fill(P.mask().ellipse(cx, cy + 2, r * fire * 1.1, r * fire), M.heat, { round: r * 0.6, contour: false, bias: -0.05 + fire * 0.15 });
    }
    if (f < 2) P.fill(P.mask().ellipse(32, 32, 10 + f * 8, 10 + f * 8), M.heat, { round: 10, contour: false, bias: 0.15 - f * 0.2, grad: 0.3 });
    // дым рассеивается — выкусываем пиксели шахматкой
    if (t > 0.6) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x + y + f) % (f > 6 ? 2 : 3) === 0) P.d[(y * 64 + x) * 4 + 3] = 0;
    frames.push(P);
  }
  return frames;
}

// ---------- Огонь: 4 кадра 24×32 ----------
function fireFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const P = new Pix(24, 32), R = rng(30 + f);
    for (let i = 0; i < 6; i++) {
      const x = 12 + (R() - 0.5) * 10, h = 10 + R() * 16, w = 3 + R() * 3;
      P.fill(P.mask().poly([[x - w, 31], [x + w, 31], [x + (R() - 0.5) * 6, 31 - h]]), M.heat, { round: 3, contour: false, bias: -0.25, grad: -0.6 });
    }
    P.fill(P.mask().ellipse(12, 28, 5, 3), M.heat, { round: 3, contour: false, bias: 0.2 });
    frames.push(P);
  }
  return frames;
}

// ---------- Золотая метка-след (16×16, шеврон) ----------
function footprint() {
  const P = new Pix(16, 16);
  P.fill(P.mask().poly([[2, 12], [8, 4], [14, 12], [11, 13], [8, 9], [5, 13]]), M.gold, { round: 2, contour: false, bias: 0.15 });
  return P.outline([90, 60, 10]);
}

// ---------- Сгусток плазмы и огненный снаряд врага (16×16) ----------
function orb(r) {
  const P = new Pix(16, 16);
  P.fill(P.mask().ellipse(8, 8, 6, 6), r, { round: 4, contour: false, bias: 0.35 });
  P.glow(8, 8, 2.4, [255, 255, 240]);
  return P;
}

// ---------- Мягкий ореол (не пиксельный) — дешёвый "bloom" ----------
export function haloCanvas(color = '255,200,90', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${color},1)`);
  gr.addColorStop(0.25, `rgba(${color},0.55)`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

// Кольцо-ореол пикапа (лаймовое, как подсветка целей)
export function ringCanvas(color = '200,255,60', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${color},0.15)`);
  gr.addColorStop(0.55, `rgba(${color},0.55)`);
  gr.addColorStop(0.7, `rgba(${color},0.35)`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

let cache = null;
export function miscArt() {
  if (cache) return cache;
  const toC = (p) => p.toCanvas();
  cache = {
    pickups: { health: toC(medkit()), armor: toC(armorPlate()), ammo: toC(ammoBox()), grenades: toC(grenades()), relic: toC(relic()) },
    icons: Object.fromEntries(['rifle', 'shotgun', 'plasma', 'thermal', 'chainblade', 'grenade'].map((k) => [k, toC(icon(k))])),
    hero: [0, 1, 2].map((s) => toC(heroPortrait(s))),
    heroHurt: [0, 1, 2].map((s) => toC(heroPortrait(s, true))),
    advisor: toC(advisorPortrait()),
    splats: [11, 12, 13, 14].map((s) => toC(bloodSplat(s))),
    scorch: toC(scorch()),
    gibs: [0, 1, 2, 3, 4, 5].map((k) => toC(gib(k))),
    explosion: sheet(explosionFrames()),
    fire: sheet(fireFrames()),
    footprint: toC(footprint()),
    plasmaOrb: toC(orb(M.cyan)),
    fireOrb: toC(orb(M.heat)),
    greenOrb: toC(orb(M.lime)),
  };
  return cache;
}

export function previewAll() {
  const a = miscArt(), out = {};
  const row = (list) => {
    const w = list.reduce((s, c) => s + c.width + 4, 0), h = Math.max(...list.map((c) => c.height));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    let x = 0; for (const it of list) { c.getContext('2d').drawImage(it, x, 0); x += it.width + 4; }
    return c;
  };
  out.pickups = row(Object.values(a.pickups));
  out.icons = row(Object.values(a.icons));
  out.portraits = row([...a.hero, ...a.heroHurt, a.advisor]);
  out.splats = row([...a.splats, a.scorch]);
  out.gibs = row(a.gibs);
  out.explosion = a.explosion.canvas;
  out.fire = a.fire.canvas;
  out.small = row([a.footprint, a.plasmaOrb, a.fireOrb, a.greenOrb, haloCanvas(), ringCanvas()]);
  return out;
}
