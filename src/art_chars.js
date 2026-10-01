// Спрайты врагов: фанатик, стрелок, тяжёлый демон, босс-колосс.
// Каждый тип — функция draw(pose), которая рисует один кадр масками с затенением (см. pixel.js).
// Кадры: ходьба ×4, атака ×2–3, попадание ×1, смерть ×4 (последний — труп).
import { Pix, ramp, hex, sheet } from './pixel.js';

// ---------- Палитры (свои, не из эталона) ----------
const C = {
  robe: ramp('#8c1f26', { spread: 0.42 }),
  robeDark: ramp('#3b2530', { spread: 0.3 }),
  flesh: ramp('#b49a90', { spread: 0.45 }),
  bone: ramp('#e2d6bc', { spread: 0.4 }),
  steel: ramp('#9aa3b2', { spread: 0.5 }),
  leather: ramp('#6e4a34', { spread: 0.4 }),
  iron: ramp('#4c4e5a', { spread: 0.38 }),
  coat: ramp('#b4602c', { spread: 0.45 }),
  olive: ramp('#5d6448', { spread: 0.4 }),
  brass: ramp('#c49a3e', { spread: 0.5 }),
  demon: ramp('#6a3446', { spread: 0.55, shift: 30 }),
  demonBelly: ramp('#a0645e', { spread: 0.45 }),
  demonDark: ramp('#3a2030', { spread: 0.35 }),
  horn: ramp('#d8cdb0', { spread: 0.45 }),
  hull: ramp('#4e4446', { spread: 0.45 }),
  plate: ramp('#7a1c1c', { spread: 0.45 }),
  blood: ramp('#c8141c', { spread: 0.35 }),
};
const GLOW_ORANGE = hex('#ffc040'), GLOW_ORANGE2 = hex('#ff7a10');
const GLOW_GREEN = hex('#c8ff50'), GLOW_GREEN2 = hex('#5ad01a');
const GLOW_YELLOW = hex('#fff070'), GLOW_YELLOW2 = hex('#ffb000');

// Короткие помощники
const limb = (P, a, b, r1, r2, rmp, o) => P.fill(P.mask().limb(a[0], a[1], b[0], b[1], r1, r2), rmp, o);
const blob = (P, cx, cy, rx, ry, rmp, o, rot = 0) => P.fill(P.mask().ellipse(cx, cy, rx, ry, rot), rmp, o);
const poly = (P, pts, rmp, o) => P.fill(P.mask().poly(pts), rmp, o);

// Складки ткани — вертикальные полосы
const folds = (k = 0.9, step = 5, seed = 0) => (x, y) => (((x + seed) % step) === 0 ? -k : ((x + seed) % step) === 1 ? k * 0.4 : 0);

// Вспышка выстрела: звезда с лучами
function muzzleStar(P, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx), ray = Math.pow(Math.abs(Math.cos(a * 3)), 6) * r * 0.5;
    const lim = r * 0.45 + ray;
    if (d > lim) continue;
    const k = d / lim;
    P.set(x, y, k < 0.35 ? [255, 255, 230] : k < 0.65 ? GLOW_YELLOW : GLOW_YELLOW2);
  }
}

// Лужа крови под трупом
function bloodPool(P, cx, cy, rx) {
  P.fill(P.mask().ellipse(cx, cy, rx, rx * 0.22).cut(P.mask().rect(0, 0, P.w, cy - rx * 0.12)), C.blood, { round: 2, grad: 0.1, contour: false });
}

// Кадры смерти: поворачиваем кадр "попадание" вокруг ног и кладём на землю.
// len — примерный рост фигуры в пикселях, thick — половина толщины тела.
function deathFrames(hit, feetX, feetY, dir, len, thick) {
  const out = [];
  const angles = [0.35, 0.85, 1.3, Math.PI / 2];
  angles.forEach((a, i) => {
    const k = a / (Math.PI / 2);
    const dx = -dir * len * 0.45 * k, dy = -thick * k;
    const f = hit.rotated(a * dir, feetX, feetY, dx, dy);
    if (i >= 2) {
      // лежит: подложим лужу крови под тело
      const g = new Pix(hit.w, hit.h);
      bloodPool(g, feetX + dx + dir * len * 0.5, feetY - 2, len * (i === 3 ? 0.42 : 0.28));
      g.draw(f);
      out.push(g.outline());
    } else out.push(f);
  });
  return out;
}

// =====================================================================
// ФАНАТИК: бегун в рваном багровом балахоне, костяная маска, два серпа
// =====================================================================
function drawFanatic(pose) {
  const P = new Pix(96, 96);
  const cx = 48 + (pose.lean || 0), gy = 93;
  const bob = pose.bob || 0;
  const hipY = 60 + bob, shY = 36 + bob, headY = 25 + bob + (pose.headDrop || 0);
  // ноги: lift — подъём ступни, spread — разведение
  const legs = [-1, 1].map((s) => {
    const lift = s < 0 ? pose.liftL || 0 : pose.liftR || 0;
    const hip = [cx + s * 5, hipY];
    const foot = [cx + s * (7 + (pose.spread || 0)), gy - 3 - lift];
    const knee = [cx + s * (8 + lift * 0.4), (hipY + foot[1]) / 2 - lift * 0.3];
    return { hip, knee, foot, lift };
  });
  // плащ сзади (тёмный, рваный)
  P.fill(P.mask().poly([[cx - 14, shY], [cx + 14, shY], [cx + 20, gy - 10], [cx - 20, gy - 10]]).keep((x, y) => y < gy - 14 + ((x * 7) % 5) * 2), C.robeDark, { round: 4, grad: 0.3 });
  // ноги в обмотках
  for (const L of legs) {
    limb(P, L.hip, L.knee, 4, 3.4, C.robeDark, { round: 2 });
    limb(P, L.knee, L.foot, 3.4, 2.8, C.leather, { round: 2, tex: (x, y) => (y % 3 === 0 ? -0.8 : 0) });
    blob(P, L.foot[0], L.foot[1] + 1, 4.5, 2.6, C.iron, { round: 2 });
  }
  // юбка балахона с рваным низом
  P.fill(P.mask().poly([[cx - 11, hipY - 6], [cx + 11, hipY - 6], [cx + 16, hipY + 16], [cx - 16, hipY + 16]])
    .keep((x, y) => y < hipY + 11 + ((x * 13) % 7)), C.robe, { round: 4, tex: folds(0.9, 5, 1) });
  // торс
  P.fill(P.mask().poly([[cx - 12, shY], [cx + 12, shY], [cx + 10, hipY - 2], [cx - 10, hipY - 2]]), C.robe, { round: 5, grad: 0.35 });
  // ремни крест-накрест
  P.fill(P.mask().limb(cx - 10, shY + 2, cx + 9, hipY - 4, 1.6), C.leather, { round: 1 });
  P.fill(P.mask().limb(cx + 10, shY + 2, cx - 9, hipY - 4, 1.6), C.leather, { round: 1 });
  blob(P, cx, shY + 13, 2.5, 2.5, C.brass, { round: 2 });
  // пояс
  P.fill(P.mask().rect(cx - 11, hipY - 6, 22, 3), C.leather, { round: 1 });
  // руки: плечо -> локоть -> кисть (кисти задаёт поза)
  const arms = [-1, 1].map((s) => {
    const sh = [cx + s * 12, shY + 3];
    const hand = s < 0 ? pose.handL : pose.handR;
    const h = [cx + hand[0] * s, shY + hand[1]];
    const el = [(sh[0] + h[0]) / 2 + s * 3, (sh[1] + h[1]) / 2 + 2];
    return { s, sh, el, h };
  });
  // шипастый ворот
  for (let i = -3; i <= 3; i++) P.fill(P.mask().poly([[cx + i * 4 - 2, shY + 1], [cx + i * 4 + 2, shY + 1], [cx + i * 4, shY - 5]]), C.iron, { round: 1 });
  // голова: острый капюшон, ниспадающий на плечи, внутри — костяная маска-череп
  const hood = P.mask().ellipse(cx, headY + 1, 10, 10.5)
    .poly([[cx - 7, headY - 6], [cx + 5, headY - 7], [cx + 3, headY - 17]])
    .poly([[cx - 12, headY + 4], [cx + 12, headY + 4], [cx + 14, shY + 4], [cx - 14, shY + 4]]);
  P.fill(hood, C.robe, { round: 5, grad: 0.45, bias: -0.08, tex: folds(0.6, 7, 3) });
  P.fill(P.mask().ellipse(cx, headY + 2, 6.5, 7.5), C.robeDark, { round: 2, bias: -0.6, contour: false });
  P.fill(P.mask().ellipse(cx, headY + 2.5, 4.6, 5.8).cut(P.mask().rect(cx - 6, headY + 6, 12, 1)), C.bone, { round: 2.5 });
  // глазницы и горящие зрачки
  for (const s2 of [-1, 1]) {
    P.rect(cx + (s2 < 0 ? -4 : 1), headY, 3, 3, [24, 8, 10]);
    P.set(cx + (s2 < 0 ? -3 : 2), headY + 1, GLOW_ORANGE);
  }
  P.set(cx, headY + 3, [40, 20, 20]);                       // нос
  for (let i = -2; i <= 2; i++) P.set(cx + i, headY + 6, i % 2 ? [200, 190, 170] : [40, 20, 20]); // зубы
  // руки и серпы
  for (const A of arms) {
    limb(P, A.sh, A.el, 3.6, 3, C.flesh, { round: 2 });
    limb(P, A.el, A.h, 3, 2.6, C.flesh, { round: 2, tex: (x, y) => ((x + y) % 4 === 0 ? -0.7 : 0) });
    blob(P, A.h[0], A.h[1], 3, 3, C.leather, { round: 2 });
    // серп: рукоять + изогнутое лезвие (направление задаёт поза)
    const ang = (A.s < 0 ? pose.bladeL : pose.bladeR) ?? 1.9;
    const tip = [A.h[0] + Math.cos(ang) * 16 * A.s, A.h[1] + Math.sin(ang) * 16];
    limb(P, A.h, [A.h[0] + Math.cos(ang) * 5 * A.s, A.h[1] + Math.sin(ang) * 5], 1.2, 1.2, C.leather, { round: 1 });
    const blade = P.mask();
    for (let t = 0.3; t <= 1; t += 0.05) {
      const bx = A.h[0] + (tip[0] - A.h[0]) * t + Math.sin(t * Math.PI) * 5 * A.s * Math.sin(ang);
      const by = A.h[1] + (tip[1] - A.h[1]) * t - Math.sin(t * Math.PI) * 5 * Math.cos(ang);
      blade.ellipse(bx, by, 2.2 * (1.1 - t * 0.7), 2.2 * (1.1 - t * 0.7));
    }
    P.fill(blade, C.steel, { round: 1.5, grad: 0, bias: 0.15 });
  }
  return P;
}

const FAN_POSES = {
  walk: [
    { liftL: 9, liftR: 0, handL: [9, 20], handR: [16, 6], bladeL: 1.6, bladeR: -0.6, bob: 0, spread: 1 },
    { liftL: 3, liftR: 1, handL: [13, 14], handR: [14, 14], bladeL: 1.2, bladeR: 1.2, bob: -2 },
    { liftL: 0, liftR: 9, handL: [16, 6], handR: [9, 20], bladeL: -0.6, bladeR: 1.6, bob: 0, spread: 1 },
    { liftL: 1, liftR: 3, handL: [14, 14], handR: [13, 14], bladeL: 1.2, bladeR: 1.2, bob: -2 },
  ],
  attack: [
    { handL: [10, -14], handR: [10, -14], bladeL: -1.2, bladeR: -1.2, bob: -1 },        // замах над головой
    { handL: [-4, 22], handR: [-4, 22], bladeL: 2.6, bladeR: 2.6, bob: 1, spread: 3 },   // удар крест-накрест
  ],
  hit: { handL: [18, 2], handR: [18, 2], bladeL: -0.3, bladeR: -0.3, lean: 3, headDrop: 2, spread: 2 },
};

// =====================================================================
// СТРЕЛОК: шинель цвета ржавчины, противогаз с зелёными линзами, автомат у бедра
// =====================================================================
function drawGunner(pose) {
  const P = new Pix(96, 96);
  const cx = 48 + (pose.lean || 0), gy = 93, bob = pose.bob || 0;
  const hipY = 58 + bob, shY = 34 + bob, headY = 23 + bob + (pose.headDrop || 0);
  // рюкзак/скатка за спиной
  blob(P, cx, shY + 4, 15, 7, C.olive, { round: 3 });
  // ноги в сапогах
  for (const s of [-1, 1]) {
    const lift = s < 0 ? pose.liftL || 0 : pose.liftR || 0;
    const hip = [cx + s * 6, hipY], foot = [cx + s * (8 + (pose.spread || 0)), gy - 3 - lift];
    const knee = [cx + s * (8 + lift * 0.3), (hipY + foot[1]) / 2 - lift * 0.3];
    limb(P, hip, knee, 4.5, 4, C.iron, { round: 2 });
    limb(P, knee, foot, 4, 3.6, C.leather, { round: 2, bias: -0.15 });
    blob(P, foot[0], foot[1] + 1, 5, 2.8, C.iron, { round: 2, bias: -0.2 });
    blob(P, knee[0], knee[1], 3.4, 3, C.iron, { round: 2, bias: 0.15 }); // наколенник
  }
  // полы шинели
  P.fill(P.mask().poly([[cx - 13, hipY - 8], [cx + 13, hipY - 8], [cx + 17, hipY + 18], [cx + 3, hipY + 17], [cx, hipY + 4], [cx - 3, hipY + 17], [cx - 17, hipY + 18]]),
    C.coat, { round: 4, tex: folds(0.8, 6, 2) });
  // торс шинели
  P.fill(P.mask().poly([[cx - 14, shY], [cx + 14, shY], [cx + 13, hipY - 4], [cx - 13, hipY - 4]]), C.coat, { round: 5, grad: 0.3 });
  // бронежилет
  P.fill(P.mask().poly([[cx - 9, shY + 2], [cx + 9, shY + 2], [cx + 8, hipY - 8], [cx - 8, hipY - 8]]), C.iron, { round: 3, tex: (x, y) => (y % 6 === 0 ? -0.7 : 0) });
  // подсумки и ремень
  P.fill(P.mask().rect(cx - 13, hipY - 8, 26, 3), C.leather, { round: 1 });
  for (const s of [-1, 1]) P.fill(P.mask().rect(cx + s * 8 - 2, hipY - 12, 5, 5), C.olive, { round: 1 });
  // наплечники
  for (const s of [-1, 1]) blob(P, cx + s * 13, shY + 2, 6, 4.5, C.iron, { round: 3 });
  // голова: каска + противогаз
  blob(P, cx, headY + 4, 7, 7, C.robeDark, { round: 3 });                         // капюшон-подшлемник
  blob(P, cx, headY + 4, 6, 6.5, C.iron, { round: 3, bias: -0.1 });              // маска
  blob(P, cx - 3, headY + 3, 2.4, 2.4, [[40, 60, 20], [60, 110, 30], GLOW_GREEN2, GLOW_GREEN, [240, 255, 200]], { round: 2, contour: false });
  blob(P, cx + 3, headY + 3, 2.4, 2.4, [[40, 60, 20], [60, 110, 30], GLOW_GREEN2, GLOW_GREEN, [240, 255, 200]], { round: 2, contour: false });
  blob(P, cx, headY + 9, 3, 2.6, C.steel, { round: 2 });                          // фильтр
  limb(P, [cx + 2, headY + 10], [cx + 10, shY + 6], 1.2, 1.2, C.leather, { round: 1 }); // шланг
  P.fill(P.mask().ellipse(cx, headY - 1, 8.5, 5.5).cut(P.mask().rect(0, headY + 1, 96, 30)), C.olive, { round: 3 }); // каска
  P.fill(P.mask().rect(cx - 9, headY, 18, 2), C.olive, { round: 1, bias: -0.2 });
  // руки и автомат (держит у бедра, ствол на зрителя чуть вправо)
  const gunX = cx + (pose.gunX || 4), gunY = shY + (pose.gunY || 17);
  limb(P, [cx - 13, shY + 3], [cx - 9, shY + 13], 3.8, 3.4, C.coat, { round: 2 });
  limb(P, [cx - 9, shY + 13], [gunX - 4, gunY + 2], 3.4, 3, C.coat, { round: 2 });
  limb(P, [cx + 13, shY + 3], [cx + 14, shY + 13], 3.8, 3.4, C.coat, { round: 2 });
  limb(P, [cx + 14, shY + 13], [gunX + 7, gunY + 4], 3.4, 3, C.coat, { round: 2 });
  // автомат: приклад, корпус, магазин, ствол с дульным тормозом
  P.fill(P.mask().poly([[gunX - 12, gunY - 2], [gunX + 10, gunY - 3], [gunX + 12, gunY + 4], [gunX - 12, gunY + 5]]), C.iron, { round: 2 });
  P.fill(P.mask().rect(gunX - 2, gunY + 4, 4, 8), C.iron, { round: 1, bias: -0.2 });
  P.fill(P.mask().poly([[gunX + 8, gunY - 4], [gunX + 16, gunY - 2], [gunX + 16, gunY + 3], [gunX + 8, gunY + 3]]), C.steel, { round: 1.5 });
  blob(P, gunX + 16, gunY, 2.4, 3, C.iron, { round: 1, bias: -0.3 });
  P.set(gunX + 16, gunY, [10, 10, 10]);
  P.fill(P.mask().rect(gunX - 8, gunY - 4, 10, 2), C.brass, { round: 1 });
  blob(P, gunX - 4, gunY + 3, 3, 3, C.leather, { round: 2 });
  blob(P, gunX + 7, gunY + 5, 3, 3, C.leather, { round: 2 });
  if (pose.flash) muzzleStar(P, gunX + 18, gunY, 11);
  return P;
}

const GUN_POSES = {
  walk: [
    { liftL: 7, liftR: 0, bob: 0, gunY: 17 },
    { liftL: 2, liftR: 1, bob: -1, gunY: 16 },
    { liftL: 0, liftR: 7, bob: 0, gunY: 17 },
    { liftL: 1, liftR: 2, bob: -1, gunY: 16 },
  ],
  attack: [
    { spread: 3, gunY: 13, gunX: 2 },              // прицел
    { spread: 3, gunY: 12, gunX: 1, flash: true }, // выстрел
  ],
  hit: { lean: 3, headDrop: 2, spread: 2, gunY: 20, gunX: 7 },
};

// =====================================================================
// ТЯЖЁЛЫЙ ДЕМОН: сутулый громила с рогами и когтями
// =====================================================================
function drawHeavy(pose) {
  const P = new Pix(128, 128);
  const cx = 64 + (pose.lean || 0), gy = 125, bob = pose.bob || 0;
  const hipY = 84 + bob, shY = 44 + bob, headY = 47 + bob + (pose.headDrop || 0);
  // жилы-полосы на коже
  const sinew = (x, y) => (((x * 2 + y) % 9) === 0 ? -0.9 : 0);
  // шипы на спине (видны над плечами)
  for (let k = -2; k <= 2; k++) P.fill(P.mask().poly([[cx + k * 9 - 4, shY + 4], [cx + k * 9 + 4, shY + 4], [cx + k * 11, shY - 14 + Math.abs(k) * 4]]), C.horn, { round: 1.5 });
  // ноги — толстые, "звериные"
  for (const s of [-1, 1]) {
    const lift = s < 0 ? pose.liftL || 0 : pose.liftR || 0;
    const hip = [cx + s * 12, hipY], knee = [cx + s * (19 + lift * 0.3), hipY + 15 - lift * 0.4], foot = [cx + s * (15 + (pose.spread || 0)), gy - 4 - lift];
    limb(P, hip, knee, 10, 8, C.demon, { round: 4, tex: sinew });
    limb(P, knee, foot, 7, 5, C.demonDark, { round: 3 });
    blob(P, foot[0], foot[1] + 1, 9, 4, C.demonDark, { round: 2 });
    for (let k = -1; k <= 1; k++) P.fill(P.mask().poly([[foot[0] + k * 5 - 1.5, foot[1] + 3], [foot[0] + k * 5 + 1.5, foot[1] + 3], [foot[0] + k * 6, foot[1] + 7]]), C.horn, { round: 1 });
  }
  // набедренные железные пластины на цепях
  P.fill(P.mask().poly([[cx - 17, hipY - 6], [cx + 17, hipY - 6], [cx + 11, hipY + 15], [cx - 11, hipY + 15]]), C.iron, { round: 2, tex: (x, y) => (x % 7 === 0 ? -0.9 : y % 6 === 0 ? 0.6 : 0) });
  // торс: широкая грудь, живот с рубцами
  P.fill(P.mask().poly([[cx - 30, shY + 2], [cx + 30, shY + 2], [cx + 22, hipY - 2], [cx - 22, hipY - 2]]), C.demon, { round: 6, grad: 0.35, tex: sinew });
  P.fill(P.mask().poly([[cx - 13, shY + 26], [cx + 13, shY + 26], [cx + 11, hipY - 4], [cx - 11, hipY - 4]]), C.demonBelly, { round: 4, tex: (x, y) => (y % 5 === 0 ? -1 : 0) });
  for (const s of [-1, 1]) P.fill(P.mask().poly([[cx + s * 2, shY + 6], [cx + s * 26, shY + 4], [cx + s * 22, shY + 22], [cx + s * 3, shY + 24]]), C.demon, { round: 5, bias: 0.1 });
  // латунное кольцо в груди и шрамы
  blob(P, cx, shY + 20, 4, 4, C.brass, { round: 2 });
  P.line(cx - 18, shY + 10, cx - 8, shY + 18, hex('#2a1018'));
  P.line(cx + 8, shY + 28, cx + 16, shY + 22, hex('#2a1018'));
  // массивные плечи-наплечники из кости
  for (const s of [-1, 1]) {
    blob(P, cx + s * 27, shY + 4, 13, 10, C.demon, { round: 5, tex: sinew });
    P.fill(P.mask().poly([[cx + s * 18, shY - 4], [cx + s * 38, shY - 2], [cx + s * 34, shY + 6], [cx + s * 20, shY + 4]]), C.horn, { round: 2 });
  }
  // голова втянута между плеч, рога вперёд
  blob(P, cx, headY, 10, 9, C.demonDark, { round: 4 });
  for (const s of [-1, 1]) {
    const horn = P.mask();
    for (let t = 0; t <= 1; t += 0.04) horn.ellipse(cx + s * (8 + t * 18), headY - 5 - Math.sin(t * 2.2) * 14 + t * t * 6, 4.5 * (1 - t * 0.8), 4.5 * (1 - t * 0.8));
    P.fill(horn, C.horn, { round: 2, tex: (x, y) => ((x + y) % 4 === 0 ? -0.7 : 0) });
  }
  P.rect(cx - 7, headY - 3, 5, 3, [16, 4, 6]); P.rect(cx + 2, headY - 3, 5, 3, [16, 4, 6]);
  P.rect(cx - 6, headY - 2, 3, 1, GLOW_YELLOW); P.rect(cx + 3, headY - 2, 3, 1, GLOW_YELLOW);
  P.set(cx - 5, headY - 1, GLOW_YELLOW2); P.set(cx + 4, headY - 1, GLOW_YELLOW2);
  // пасть с клыками
  P.fill(P.mask().ellipse(cx, headY + 5, 7, 3), [[30, 6, 10], [60, 10, 16], [90, 20, 24], [110, 30, 30], [130, 40, 40]], { round: 1, contour: false });
  for (let k = -2; k <= 2; k++) P.fill(P.mask().poly([[cx + k * 3 - 1, headY + 3], [cx + k * 3 + 1, headY + 3], [cx + k * 3, headY + 6 + (k % 2 ? 0 : 2)]]), C.horn, { round: 1, contour: false });
  // руки с когтями
  for (const s of [-1, 1]) {
    const hand = s < 0 ? pose.handL : pose.handR;
    const sh = [cx + s * 30, shY + 8], h = [cx + s * hand[0], shY + hand[1]];
    const el = [(sh[0] + h[0]) / 2 + s * 6, (sh[1] + h[1]) / 2];
    limb(P, sh, el, 9, 7, C.demon, { round: 4, tex: sinew });
    limb(P, el, h, 7, 6, C.demon, { round: 3, tex: sinew });
    blob(P, el[0], el[1], 5, 4, C.iron, { round: 2 }); // наруч
    blob(P, h[0], h[1], 7, 6, C.demonDark, { round: 3 });
    const cd = (s < 0 ? pose.clawL : pose.clawR) ?? 1.4; // направление когтей
    for (let k = -1; k <= 1; k++) {
      const a = cd + k * 0.35;
      const base = [h[0] + Math.cos(a) * 5 * s, h[1] + Math.sin(a) * 5];
      const tip = [h[0] + Math.cos(a) * 16 * s, h[1] + Math.sin(a) * 16];
      limb(P, base, tip, 2.2, 0.6, C.horn, { round: 1 });
    }
  }
  return P;
}

const HEAVY_POSES = {
  walk: [
    { liftL: 8, liftR: 0, handL: [30, 44], handR: [32, 50], bob: 0, lean: -2 },
    { liftL: 2, liftR: 0, handL: [31, 47], handR: [31, 47], bob: -2 },
    { liftL: 0, liftR: 8, handL: [32, 50], handR: [30, 44], bob: 0, lean: 2 },
    { liftL: 0, liftR: 2, handL: [31, 47], handR: [31, 47], bob: -2 },
  ],
  attack: [
    { handL: [34, -14], handR: [34, -14], clawL: -1.2, clawR: -1.2, bob: -2, spread: 4 },   // руки вверх
    { handL: [16, 44], handR: [16, 44], clawL: 2.2, clawR: 2.2, bob: 2, spread: 6 },        // удар вниз
    { handL: [40, 30], handR: [40, 30], clawL: 0.2, clawR: 0.2, bob: 3, lean: 0, headDrop: 4 }, // рывок: руки назад, наклон
  ],
  hit: { handL: [38, 20], handR: [38, 20], lean: 4, headDrop: 3, spread: 3, clawL: -0.4, clawR: -0.4 },
};

// =====================================================================
// БОСС «КОЛОСС»: демоническая боевая машина с топкой в груди
// =====================================================================
function drawBoss(pose) {
  const P = new Pix(192, 192);
  const cx = 96 + (pose.lean || 0), gy = 189, bob = pose.bob || 0;
  const hullY = 92 + bob;
  // трубы за плечами с раскалёнными верхушками
  for (const s of [-1, 1]) {
    P.fill(P.mask().poly([[cx + s * 40 - 6, 64 + bob], [cx + s * 40 + 6, 64 + bob], [cx + s * 46 + 4, 22 + bob], [cx + s * 46 - 6, 22 + bob]]), C.iron, { round: 3 });
    P.fill(P.mask().rect(cx + s * 46 - 8, 18 + bob, 14, 5), C.brass, { round: 2 });
    P.fill(P.mask().ellipse(cx + s * 46 - 1, 18 + bob, 5, 2), [hex('#5a1004'), hex('#b02808'), hex('#ff6a10'), hex('#ffb030'), hex('#fff0b0')], { round: 2, contour: false, bias: 0.3 });
  }
  // ноги-поршни
  for (const s of [-1, 1]) {
    const lift = s < 0 ? pose.liftL || 0 : pose.liftR || 0;
    const hip = [cx + s * 24, hullY + 34], knee = [cx + s * (40 + lift * 0.4), hullY + 62 - lift * 0.5], foot = [cx + s * (34 + (pose.spread || 0)), gy - 6 - lift];
    limb(P, hip, knee, 14, 11, C.hull, { round: 6 });
    blob(P, knee[0], knee[1], 10, 10, C.brass, { round: 4 });
    limb(P, knee, foot, 10, 8, C.hull, { round: 5, tex: (x, y) => (y % 8 === 0 ? -0.8 : 0) });
    limb(P, [hip[0] - s * 6, hip[1] + 6], [foot[0] - s * 8, foot[1] - 12], 2.5, 2.5, C.steel, { round: 1 }); // гидравлика
    P.fill(P.mask().poly([[foot[0] - 18, foot[1] + 5], [foot[0] + 18, foot[1] + 5], [foot[0] + 12, foot[1] - 6], [foot[0] - 12, foot[1] - 6]]), C.iron, { round: 3 });
    for (let k = -1; k <= 1; k++) P.fill(P.mask().poly([[foot[0] + k * 11 - 3, foot[1] + 4], [foot[0] + k * 11 + 3, foot[1] + 4], [foot[0] + k * 13, foot[1] + 9]]), C.horn, { round: 1 });
  }
  // корпус: бочкообразный, клёпаный
  P.fill(P.mask().ellipse(cx, hullY, 46, 42), C.hull, { round: 14, grad: 0.3, tex: (x, y) => ((x * 3 + y * 5) % 23 === 0 ? 0.9 : 0) });
  // латунные пояса с заклёпками
  for (const yy of [hullY - 28, hullY + 26]) {
    P.fill(P.mask().ellipse(cx, hullY, 46, 42).clip(P.mask().rect(0, yy, 192, 6)), C.brass, { round: 2 });
    for (let x = cx - 40; x <= cx + 40; x += 8) P.set(x, yy + 2, hex('#fff0b0'));
  }
  // топка в груди: решётка с огнём
  const fire = [hex('#5a1004'), hex('#b02808'), hex('#ff6a10'), hex('#ffb030'), hex('#fff0b0')];
  P.fill(P.mask().ellipse(cx, hullY + 2, 18, 16), C.iron, { round: 4, bias: -0.2 });
  P.fill(P.mask().ellipse(cx, hullY + 4, 14, 12), fire, { round: 6, grad: -0.4, bias: (pose.fireGlow || 0) + 0.25, contour: false });
  for (let x = cx - 12; x <= cx + 12; x += 5) P.fill(P.mask().rect(x, hullY - 8, 2, 24).clip(P.mask().ellipse(cx, hullY + 4, 14, 12)), C.iron, { round: 1 });
  // багровые наплечники с шипами
  for (const s of [-1, 1]) {
    blob(P, cx + s * 44, hullY - 24, 18, 14, C.plate, { round: 6, tex: (x, y) => ((x + y * 2) % 11 === 0 ? -0.8 : 0) });
    for (let k = 0; k < 3; k++) P.fill(P.mask().poly([[cx + s * (34 + k * 9), hullY - 34], [cx + s * (40 + k * 9), hullY - 34], [cx + s * (38 + k * 10), hullY - 50 + k * 3]]), C.horn, { round: 1 });
  }
  // голова — рогатый железный череп с надбровьем и зубастой челюстью
  const hy = 50 + bob + (pose.headDrop || 0);
  for (const s of [-1, 1]) {
    const horn = P.mask();
    for (let t = 0; t <= 1; t += 0.03) horn.ellipse(cx + s * (14 + t * 30), hy - 8 - Math.sin(t * 2.4) * 26, 6.5 * (1 - t * 0.8), 6.5 * (1 - t * 0.8));
    P.fill(horn, C.horn, { round: 3, tex: (x, y) => ((x + y) % 5 === 0 ? -0.6 : 0) });
  }
  P.fill(P.mask().ellipse(cx, hy, 19, 17).poly([[cx - 14, hy + 6], [cx + 14, hy + 6], [cx + 9, hy + 22], [cx - 9, hy + 22]]), C.iron, { round: 6 });
  P.fill(P.mask().poly([[cx - 18, hy - 6], [cx + 18, hy - 6], [cx + 14, hy - 1], [cx, hy + 2], [cx - 14, hy - 1]]), C.plate, { round: 2 }); // надбровье
  for (const s of [-1, 1]) {
    P.fill(P.mask().poly([[cx + s * 3, hy + 1], [cx + s * 13, hy - 1], [cx + s * 11, hy + 5], [cx + s * 4, hy + 5]]), [[8, 16, 4], [20, 40, 8], GLOW_GREEN2, GLOW_GREEN, [240, 255, 200]], { round: 2, contour: false, bias: 0.25 });
  }
  P.fill(P.mask().rect(cx - 10, hy + 10, 20, 10), [[20, 6, 6], [50, 10, 8], [90, 20, 10], [130, 40, 14], [160, 60, 20]], { round: 3, contour: false, bias: 0.1 }); // жар в пасти
  for (let x = cx - 9; x <= cx + 8; x += 3) {
    P.fill(P.mask().poly([[x, hy + 9], [x + 2, hy + 9], [x + 1, hy + 14]]), C.horn, { round: 1, contour: false });
    P.fill(P.mask().poly([[x, hy + 21], [x + 2, hy + 21], [x + 1, hy + 16]]), C.horn, { round: 1, contour: false });
  }
  // левая рука — многоствольная пушка
  const gx = cx - 62, gyy = hullY + (pose.gunY || 0);
  limb(P, [cx - 44, hullY - 18], [gx + 6, gyy - 4], 11, 9, C.hull, { round: 5 });
  P.fill(P.mask().poly([[gx - 12, gyy - 14], [gx + 14, gyy - 14], [gx + 14, gyy + 26], [gx - 12, gyy + 26]]), C.iron, { round: 4 });
  for (let k = 0; k < 3; k++) P.fill(P.mask().rect(gx - 9 + k * 7, gyy + 24, 5, 16), C.steel, { round: 2 });
  P.fill(P.mask().rect(gx - 12, gyy + 6, 26, 4), C.brass, { round: 1 });
  if (pose.flash) muzzleStar(P, gx + 1, gyy + 46, 18);
  // правая рука — огромная клешня
  const clawUp = pose.clawUp || 0;
  limb(P, [cx + 44, hullY - 18], [cx + 64, hullY + 10 - clawUp], 11, 9, C.hull, { round: 5 });
  blob(P, cx + 64, hullY + 12 - clawUp, 12, 11, C.brass, { round: 4 });
  for (const k of [-1, 1]) {
    const m = P.mask();
    for (let t = 0; t <= 1; t += 0.05) m.ellipse(cx + 64 + k * (4 + Math.sin(t * 2.8) * 10), hullY + 20 - clawUp + t * 30, 5 * (1 - t * 0.7), 5 * (1 - t * 0.7));
    P.fill(m, C.steel, { round: 2 });
  }
  return P;
}

const BOSS_POSES = {
  walk: [
    { liftL: 10, liftR: 0, bob: 0, lean: -2 },
    { liftL: 3, liftR: 0, bob: -3 },
    { liftL: 0, liftR: 10, bob: 0, lean: 2 },
    { liftL: 0, liftR: 3, bob: -3 },
  ],
  attack: [
    { gunY: -8, fireGlow: 0.2, spread: 4 },
    { gunY: -10, flash: true, fireGlow: 0.4, spread: 4 },
    { clawUp: 30, spread: 6, fireGlow: 0.2 },
  ],
  hit: { lean: 4, headDrop: 3, spread: 3, fireGlow: 0.5 },
};

// ---------- Сборка листов ----------
function build(draw, poses, feet, dir, len, thick) {
  const frames = [];
  for (const p of poses.walk) frames.push(draw(p).outline());
  for (const p of poses.attack) frames.push(draw(p).outline());
  const hit = draw(poses.hit).outline();
  frames.push(hit);
  frames.push(...deathFrames(hit, feet[0], feet[1], dir, len, thick));
  const s = sheet(frames);
  s.walk = [0, 1, 2, 3];
  s.attack = poses.attack.map((_, i) => 4 + i);
  s.hit = 4 + poses.attack.length;
  s.death = [s.hit + 1, s.hit + 2, s.hit + 3, s.hit + 4];
  return s;
}

const cache = {};
export function enemySheet(type) {
  if (cache[type]) return cache[type];
  const make = {
    fanatic: () => build(drawFanatic, FAN_POSES, [48, 93], 1, 78, 14),
    gunner: () => build(drawGunner, GUN_POSES, [48, 93], -1, 76, 16),
    heavy: () => build(drawHeavy, HEAVY_POSES, [64, 125], 1, 100, 26),
    boss: () => build(drawBoss, BOSS_POSES, [96, 189], -1, 170, 40),
  };
  cache[type] = make[type]();
  return cache[type];
}
