// Оружие от первого лица — нарисованные пиксельные спрайты (никаких 3D-боксов).
// Холст кадра 192×144, ствол смотрит вверх в центр экрана, руки в латных перчатках.
// Цвета героя (свои): багровый корпус, сталь, латунь.
import { Pix, ramp, hex, sheet } from './pixel.js';

const M = {
  casing: ramp('#a01e24', { spread: 0.45 }),
  steel: ramp('#8c94a4', { spread: 0.5 }),
  iron: ramp('#41434e', { spread: 0.4 }),
  brass: ramp('#cba146', { spread: 0.5 }),
  glove: ramp('#6f7a8c', { spread: 0.48 }),
  leather: ramp('#5e3c2a', { spread: 0.4 }),
  cyan: [hex('#0e2a3a'), hex('#14607e'), hex('#2cb4e6'), hex('#8af2ff'), hex('#eaffff')],
  blueArmor: ramp('#2a4aa6', { spread: 0.5 }),
  wood: ramp('#6a3a22', { spread: 0.45 }),
  heat: [hex('#3a0e06'), hex('#8e2208'), hex('#e05812'), hex('#ffac36'), hex('#fff2c6')],
};
const W = 192, H = 144;

const fill = (P, m, r, o) => P.fill(m, r, o);
const blob = (P, cx, cy, rx, ry, r, o, rot = 0) => P.fill(P.mask().ellipse(cx, cy, rx, ry, rot), r, o);
const poly = (P, pts, r, o) => P.fill(P.mask().poly(pts), r, o);
const limb = (P, a, b, r1, r2, r, o) => P.fill(P.mask().limb(a[0], a[1], b[0], b[1], r1, r2), r, o);

// Точка между a и b
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
// Точка схода — куда "уходит" оружие (центр экрана, выше кадра)
const VP = [100, -60];
const toward = (pts, t) => pts.map((p) => lerp(p, VP, t));

// Призма в перспективе: near — ближнее сечение [лв, пв, пн, лн], far = near, сдвинутое к точке схода.
// Грани рисуем от дальних к ближним: низ, правая, левая, верх, торец.
function prism(P, near, depth, rTop, rSide = rTop, { cap = true, capR = null, topTex = null, sideTex = null } = {}) {
  const far = toward(near, depth);
  const face = (i) => { const j = (i + 1) % 4; return [near[i], near[j], far[j], far[i]]; };
  poly(P, face(2), rSide, { round: 1.5, bias: -0.55, grad: 0, tex: sideTex });
  poly(P, face(1), rSide, { round: 1.5, bias: -0.3, grad: 0.1, tex: sideTex });
  poly(P, face(3), rSide, { round: 1.5, bias: 0.05, grad: 0.1, tex: sideTex });
  poly(P, face(0), rTop, { round: 3, bias: -0.02, grad: 0.3, tex: topTex });
  if (cap) poly(P, near, capR || rSide, { round: 3, bias: -0.25, tex: rivets(7) });
  return far;
}

// Цилиндр в перспективе (ствол): от центра a радиуса r1 к центру b радиуса r2
function tube(P, a, b, r1, r2, rmp, { rings = 0, ringR = M.brass, mouth = true } = {}) {
  limb(P, a, b, r1, r2, rmp, { round: Math.max(2, r1 * 0.7), grad: 0 });
  for (let i = 1; i <= rings; i++) {
    const t = i / (rings + 1), c = lerp(a, b, t), r = r1 + (r2 - r1) * t;
    P.fill(P.mask().ellipse(c[0], c[1], r + 1, (r + 1) * 0.45).cut(P.mask().ellipse(c[0], c[1] - 2, r + 1, (r + 1) * 0.45)), ringR, { round: 1, contour: false });
  }
  if (mouth) {
    blob(P, b[0], b[1], r2, r2 * 0.5, M.iron, { round: 1.5, bias: 0.2 });
    blob(P, b[0], b[1], r2 * 0.6, r2 * 0.3, [hex('#050506'), hex('#0c0c10'), hex('#14141a'), hex('#1c1c22'), hex('#24242c')], { round: 1, contour: false });
  }
}

// Латная перчатка. side: 1 — правая (рукоять снизу справа), -1 — левая (под цевьём слева).
// Предплечье уходит за край кадра, кисть сжимает рукоять, пальцы-пластины загнуты.
function gauntlet(P, x, y, side, s = 1) {
  const edgeX = side > 0 ? W + 30 : -30;
  // предплечье: наруч из двух пластин
  P.fill(P.mask().poly([[x + side * 4 * s, y - 6 * s], [x + side * 18 * s, y - 14 * s], [edgeX, y + 18 * s], [edgeX, H + 40], [x + side * 4 * s, H + 40]]), M.glove, { round: 7, grad: 0.2 });
  P.fill(P.mask().limb(x + side * 22 * s, y - 12 * s, x + side * 12 * s, y + 22 * s, 3.2 * s), M.brass, { round: 2 }); // латунный обруч
  P.fill(P.mask().limb(x + side * 40 * s, y - 2 * s, x + side * 28 * s, y + 40 * s, 2.4 * s), M.brass, { round: 1.5 });
  P.fill(P.mask().poly([[x + side * 34 * s, y + 18 * s], [edgeX, y + 40 * s], [edgeX, H + 40], [x + side * 26 * s, H + 40]]), M.casing, { round: 5 }); // багровая ткань-подбой
  // тыльная сторона кисти
  P.fill(P.mask().poly([[x - side * 4 * s, y - 14 * s], [x + side * 14 * s, y - 16 * s], [x + side * 18 * s, y + 8 * s], [x - side * 2 * s, y + 12 * s]]), M.glove, { round: 5 });
  P.fill(P.mask().ellipse(x + side * 6 * s, y - 2 * s, 7 * s, 5 * s, side * -0.3), M.brass, { round: 2 }); // накладка
  // пальцы: 4 загнутые пластины вдоль рукояти
  for (let k = 0; k < 4; k++) {
    const fx = x - side * (9 - k * 0.5) * s, fy = y - 12 * s + k * 7 * s;
    P.fill(P.mask().ellipse(fx, fy, 6.5 * s, 3.8 * s, side * 0.15), M.glove, { round: 2.5, bias: 0.1 });
    P.set(fx - side * 2 * s, fy - 2 * s, hex('#e4ecf6'));
  }
  // большой палец сверху
  P.fill(P.mask().limb(x + side * 2 * s, y - 14 * s, x - side * 10 * s, y - 20 * s, 4.5 * s, 3.5 * s), M.glove, { round: 2.5, bias: 0.15 });
}

// Гравировка-эмблема героя: меч в круге (своя)
function emblem(P, cx, cy) {
  P.fill(P.mask().ellipse(cx, cy, 6, 4.5).cut(P.mask().ellipse(cx, cy, 4, 2.8)), M.brass, { round: 1, contour: false });
  P.line(cx, cy - 6, cx, cy + 5, hex('#ffe9a0'));
  P.line(cx - 3, cy - 2, cx + 3, cy - 2, hex('#ffe9a0'));
}

// Полоски-вентиляция
const slits = (step, k = 1.1) => (x, y) => (y % step === 0 ? -k : y % step === 1 ? k * 0.5 : 0);
const rivets = (step) => (x, y) => (x % step === 0 && y % step === 0 ? 1.2 : 0);

// ---------- 1. Тяжёлая винтовка «Громовержец» (разрывные патроны) ----------
function drawRifle({ casingOut = false } = {}) {
  const P = new Pix(W, H);
  gauntlet(P, 58, 112, -1);                                                    // левая рука поддерживает снизу
  prism(P, [[56, 92], [70, 92], [72, 128], [58, 130]], 0.18, M.iron, M.iron, { sideTex: slits(5) }); // магазин сбоку
  // корпус: верх — багровый кожух, бока — сталь
  const far = prism(P, [[70, 122], [142, 122], [148, 176], [64, 176]], 0.55, M.casing, M.steel, { topTex: rivets(9), sideTex: slits(9, 0.6) });
  // латунные кромки верхней грани
  P.fill(P.mask().limb(70, 122, far[0][0], far[0][1], 1.4), M.brass, { round: 1 });
  P.fill(P.mask().limb(142, 122, far[1][0], far[1][1], 1.4), M.brass, { round: 1 });
  emblem(P, 106, 100);
  // верхний короб с прицелом
  prism(P, [[92, 76], [120, 76], [122, 90], [90, 90]], 0.35, M.iron, M.iron, { topTex: slits(4, 0.7) });
  P.fill(P.mask().rect(104, 36, 4, 8), M.steel, { round: 1 });
  P.set(105, 35, hex('#ff5030')); P.set(106, 35, hex('#ff5030'));
  // ствол с латунными кольцами
  tube(P, [106, 66], [103, 8], 13, 9, M.steel, { rings: 2 });
  // правая рука на рукояти
  gauntlet(P, 150, 122, 1);
  if (casingOut) {
    P.fill(P.mask().limb(150, 70, 160, 62, 3), M.brass, { round: 2 }); // вылетающая гильза
    for (let i = 0; i < 8; i++) P.set(98 + i * 2, 1 + (i % 2), [220, 220, 230], 110);
  }
  return P.outline();
}

// ---------- 2. Дробовик «Молот» ----------
function drawShotgun() {
  const P = new Pix(W, H);
  tube(P, [92, 82], [92, 14], 11, 8, M.iron, { rings: 2 });
  tube(P, [118, 82], [114, 14], 11, 8, M.iron, { rings: 2 });
  gauntlet(P, 66, 108, -1);
  prism(P, [[78, 92], [130, 92], [134, 108], [74, 108]], 0.25, M.leather, M.leather, { topTex: slits(3, 0.7) }); // цевьё
  const far = prism(P, [[70, 120], [142, 120], [150, 176], [62, 176]], 0.34, M.iron, M.iron, { sideTex: slits(8, 0.6) });
  P.fill(P.mask().poly([[86, 120], [126, 120], lerp([126, 120], VP, 0.34), lerp([86, 120], VP, 0.34)]), M.casing, { round: 3, bias: -0.05, grad: 0.3 });
  P.fill(P.mask().limb(70, 120, far[0][0], far[0][1], 1.4), M.brass, { round: 1 });
  P.fill(P.mask().limb(142, 120, far[1][0], far[1][1], 1.4), M.brass, { round: 1 });
  emblem(P, 106, 108);
  gauntlet(P, 154, 126, 1);
  return P.outline();
}

// ---------- 3. Плазменный излучатель «Звезда» ----------
function drawPlasma({ glow = 0 } = {}) {
  const P = new Pix(W, H);
  limb(P, [52, 84], [56, 132], 10, 10, M.cyan, { round: 5, bias: glow - 0.1, contour: false }); // колба с плазмой
  for (const yy of [82, 132]) blob(P, 54, yy, 12, 5, M.brass, { round: 2 });
  gauntlet(P, 62, 118, -1, 0.9);
  prism(P, [[68, 116], [146, 116], [152, 176], [62, 176]], 0.42, M.iron, M.steel, { topTex: rivets(10), sideTex: slits(7, 0.7) });
  for (let k = 0; k < 3; k++) poly(P, [[144 + k * 6, 86], [148 + k * 6, 86], [156 + k * 6, 120], [152 + k * 6, 120]], M.iron, { round: 1 }); // рёбра охлаждения
  emblem(P, 106, 92);
  // ствол из колец: тёмные кольца + светящиеся катушки
  for (let i = 0; i < 7; i++) {
    const y = 72 - i * 9, r = 17 - i * 1.4;
    blob(P, 105, y, r, r * 0.45, M.iron, { round: 2 });
    blob(P, 105, y - 4, r - 2, (r - 2) * 0.45, M.cyan, { round: 2, bias: glow + (i % 2) * 0.1, contour: false });
  }
  blob(P, 105, 8, 10, 4.5, M.iron, { round: 2 });
  blob(P, 105, 8, 6, 2.5, M.cyan, { round: 1, bias: 0.4 + glow, contour: false });
  gauntlet(P, 152, 124, 1);
  return P.outline();
}

// ---------- 4. Термокопьё (луч, огромный урон вблизи) ----------
function drawThermal({ hot = 0 } = {}) {
  const P = new Pix(W, H);
  limb(P, [30, 128], [78, 104], 15, 15, M.casing, { round: 6 });                   // топливный бак
  for (const t of [0.12, 0.88]) blob(P, 30 + 48 * t, 128 - 24 * t, 6, 16, M.brass, { round: 2 }, 1.05);
  gauntlet(P, 64, 120, -1, 0.85);
  prism(P, [[70, 118], [144, 118], [150, 176], [64, 176]], 0.4, M.casing, M.iron, { topTex: rivets(9), sideTex: slits(8, 0.6) });
  tube(P, [106, 92], [105, 34], 24, 19, M.steel, { rings: 2, mouth: false });       // ствол
  blob(P, 105, 30, 26, 10, M.iron, { round: 3 });                                    // раструб
  blob(P, 105, 29, 20, 7, M.steel, { round: 2, bias: -0.2 });
  blob(P, 105, 28, 14, 5, M.heat, { round: 3, bias: hot - 0.25, contour: false });
  blob(P, 105, 28, 6, 2, M.heat, { round: 2, bias: hot + 0.2, contour: false });
  emblem(P, 106, 128);
  if (hot > 0.3) for (let i = 0; i < 50; i++) P.set(86 + ((i * 37) % 38), 6 + ((i * 53) % 16), [255, 220, 160], 90); // марево
  gauntlet(P, 152, 126, 1);
  return P.outline();
}

// ---------- 5. Цепной клинок ----------
// hilt — точка рукояти, ang — направление лезвия, teeth — сдвиг зубьев (анимация), smear — шлейф удара
function drawChainblade({ hilt = [146, 138], ang = -2.12, len = 176, teeth = 0, smear = 0 } = {}) {
  const P = new Pix(W, H);
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx; // вдоль и поперёк лезвия
  const at = (t, o) => [hilt[0] + dx * t + nx * o, hilt[1] + dy * t + ny * o];
  if (smear) {
    // шлейф удара: полупрозрачная дуга позади лезвия
    for (let i = 0; i < 1400; i++) {
      const t = 40 + Math.random() * (len - 40), o = -14 - Math.random() * 46 * smear;
      const [x, y] = at(t, o);
      P.set(x, y, [255, 250, 235], 50 + Math.random() * 60);
    }
  }
  // корпус лезвия: боковая грань (тёмная) + лицевая (багровая)
  poly(P, [at(30, 12), at(len, 9), at(len + 8, 0), at(len, 13), at(30, 17)], M.casing, { round: 2, bias: -0.45 });
  poly(P, [at(30, -14), at(len, -10), at(len + 8, 0), at(len, 10), at(30, 13)], M.casing, { round: 6 });
  P.fill(P.mask().poly([at(32, -14), at(len - 2, -10), at(len - 2, -6), at(32, -9)]), M.steel, { round: 1 }); // направляющая цепи
  P.fill(P.mask().poly([at(40, 1), at(len - 14, 1), at(len - 14, 4), at(40, 4)]), M.brass, { round: 1 });    // латунная жила
  // зубья цепи по кромке (сдвигаются — "вращение")
  for (let t = 34 + (teeth % 7); t < len; t += 7) {
    P.fill(P.mask().poly([at(t, -12), at(t + 5, -12), at(t + 1, -21)]), M.steel, { round: 1, bias: 0.15 });
  }
  for (let t = 44; t < len - 10; t += 22) { const [x, y] = at(t, 7); P.fill(P.mask().ellipse(x, y, 2, 2), M.brass, { round: 1 }); } // заклёпки
  // мотор и латунная гарда
  poly(P, [at(4, -18), at(34, -18), at(34, 18), at(4, 18)], M.iron, { round: 4, tex: slits(4, 0.8) });
  poly(P, [at(28, -28), at(37, -28), at(37, 28), at(28, 28)], M.brass, { round: 2 });
  gauntlet(P, hilt[0] + 6, hilt[1] - 4, 1);
  return P.outline();
}


// ---------- Оружие в ракурсе "сзади-сбоку", низко справа (как в видео-эталоне) ----------
// Виден задний торец (сталь, круглая крышка, прорезь прицела), верх и левый бок корпуса,
// золотая плетёная лента и синий бронированный наруч. kind: rifle | shotgun | plasma | thermal
function drawGunRear(kind, { glow = 0, casingOut = false } = {}) {
  const P = new Pix(W, H);
  // координаты задаём в "дизайн-сетке", затем ужимаем и прижимаем к низу кадра
  const S = 0.82, OX = 45, OY = 26;
  const T = (p) => [OX + p[0] * S, OY + p[1] * S];
  const Q = (pts, r, o) => poly(P, pts.map(T), r, o);
  const B = (cx, cy, rx, ry, r, o, rot = 0) => { const [x, y] = T([cx, cy]); blob(P, x, y, rx * S, ry * S, r, o, rot); };
  const L = (a, b, r1, r, o) => { const [x1, y1] = T(a), [x2, y2] = T(b); P.fill(P.mask().limb(x1, y1, x2, y2, r1 * S), r, o); };
  const R = (x, y, w, h, r, o) => Q([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, o);
  const side = kind === 'shotgun' ? M.wood : kind === 'plasma' ? M.steel : M.casing;
  const top = kind === 'plasma' ? M.iron : kind === 'thermal' ? M.steel : M.casing;
  // синий бронированный наруч снизу слева (левая рука поддерживает цевьё)
  Q([[-60, 190], [10, 118], [62, 112], [96, 190]], M.blueArmor, { round: 6, grad: 0.2 });
  L([6, 124], [60, 116], 4, M.brass, { round: 2 });
  for (let i = 0; i < 8; i++) B(12 + i * 7, 136 + (i % 2) * 2, 3.4, 2.6, M.brass, { round: 2, bias: i % 2 ? 0.2 : -0.1 }, 0.4);
  // ствол и кожух у дальнего конца
  if (kind === 'shotgun') {
    for (const [bx, by] of [[20, 70], [26, 84]]) { B(bx, by, 10, 8, M.iron, { round: 3 }); B(bx - 2, by, 5, 4, [hex('#050506'), hex('#101014'), hex('#18181e'), hex('#22222a'), hex('#2c2c36')], { round: 1, contour: false }); }
  } else if (kind === 'thermal') {
    B(22, 78, 14, 20, M.iron, { round: 4 });
    B(20, 78, 9, 13, M.heat, { round: 4, bias: glow - 0.2, contour: false });
    B(18, 78, 4, 6, M.heat, { round: 2, bias: glow + 0.3, contour: false });
  } else {
    Q([[10, 62], [42, 58], [44, 98], [12, 96]], M.iron, { round: 3, tex: slits(4, 0.8) });
    B(14, 78, 7, 10, M.iron, { round: 2, bias: -0.3 });
    if (kind === 'plasma') B(14, 78, 4, 6, M.cyan, { round: 2, bias: 0.3 + glow, contour: false });
    else B(13, 78, 3, 5, [hex('#050506'), hex('#101014'), hex('#18181e'), hex('#22222a'), hex('#2c2c36')], { round: 1, contour: false });
  }
  // длинный бок корпуса (к нам), уходит вдаль влево
  Q([[36, 58], [112, 62], [116, 150], [40, 112]], side, { round: 6, grad: 0.15, bias: -0.3, rim: false, shine: 0, tex: kind === 'shotgun' ? (x, y) => (((x * 3 + y) % 9) === 0 ? -0.8 : 0) : null });
  // нижняя накладка бока: тёмная сталь с прорезями
  Q([[40, 100], [114, 120], [116, 150], [42, 116]], M.iron, { round: 3, tex: slits(5, 0.7) });
  // верхняя грань
  Q([[36, 58], [64, 50], [160, 54], [112, 62]], top, { round: 4, grad: -0.2, bias: 0 });
  // планка на верхней грани
  Q([[48, 55], [62, 52], [140, 55], [110, 59]], M.iron, { round: 2, tex: (x, y) => ((x + y) % 5 === 0 ? -1 : 0) });
  // латунная окантовка граней и рамка панели
  for (const [a, b] of [[[36, 58], [112, 62]], [[112, 62], [160, 54]], [[36, 58], [40, 112]], [[112, 62], [116, 150]], [[52, 70], [100, 72]], [[52, 70], [54, 102]]]) L(a, b, 1.6, M.brass, { round: 1 });
  // детали бока
  if (kind === 'rifle' || kind === 'thermal') { const [ex, ey] = T([78, 86]); emblem(P, ex, ey); }
  if (kind === 'rifle') { B(102, 86, 7, 9, M.casing, { round: 3, bias: 0.2 }); B(102, 86, 3, 4, M.brass, { round: 1 }); }
  if (kind === 'plasma') for (let i = 0; i < 4; i++) L([50 + i * 16, 72], [52 + i * 16, 104], 2.4, M.cyan, { round: 1, bias: glow, contour: false });
  if (kind === 'thermal') { L([46, 66], [104, 70], 7, M.casing, { round: 4 }); for (const xx of [58, 92]) B(xx, 68, 4, 9, M.brass, { round: 2 }); }
  // задний торец — массивный стальной блок с круглой крышкой и прицелом
  Q([[112, 62], [160, 54], [166, 176], [116, 176]], M.iron, { round: 6, bias: -0.1 });
  R(126, 40, 26, 20, M.steel, { round: 3, bias: 0.1 });           // прицельный блок сверху
  R(131, 46, 16, 8, M.iron, { round: 1, bias: -0.4 });
  B(118, 104, 16, 18, M.steel, { round: 6 });                     // круглая крышка на ребре
  B(118, 104, 9, 10, M.iron, { round: 3, bias: 0.1 });
  B(116, 101, 3, 3, M.steel, { round: 1, bias: 0.5 });
  R(132, 112, 30, 34, M.steel, { round: 3, bias: -0.1 });
  R(137, 118, 20, 22, M.iron, { round: 2, bias: -0.4 });
  // висящие золотые шнуры у дальнего конца
  for (let k = 0; k < 2; k++) for (let i = 0; i < 9; i++) {
    const t = i / 8;
    B(40 + k * 7 + Math.sin(t * 4 + k) * 2, 66 + t * 52, 2.6, 2.2, M.brass, { round: 2, bias: i % 2 ? 0.25 : -0.05 }, 0.3);
  }
  if (casingOut) {
    L([30, 30], [38, 24], 3.4, M.brass, { round: 2 });               // гильзы летят влево-вверх
    L([8, 46], [15, 42], 3, M.brass, { round: 2, bias: -0.2 });
  }
  return P.outline();
}

// "Подсвеченный" кадр: всё оружие залито тёплым светом вспышки (как в видео при выстреле)
function litCanvas(c, color = '#ffc860') {
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d');
  g.drawImage(c, 0, 0);
  // умножаем на тёплый цвет вспышки и добавляем немного света — металл становится золотым
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, o.width, o.height);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(110,70,10,0.9)';
  g.fillRect(0, 0, o.width, o.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(c, 0, 0);
  return o;
}

// ---------- Бросок гранаты: рука с гранатой ----------
function drawThrow() {
  const P = new Pix(W, H);
  blob(P, 122, 74, 12, 13, M.iron, { round: 4 });
  P.fill(P.mask().rect(111, 70, 23, 3), M.casing, { round: 1 });
  P.fill(P.mask().rect(119, 58, 7, 5), M.brass, { round: 1 });
  gauntlet(P, 134, 94, 1, 1.1);
  return P.outline();
}

// ---------- Вспышка выстрела (аддитивная): лучи + ореол ----------
export function flashSprite(r = 40, color = [255, 200, 90], seed = 1) {
  const S = r * 2, P = new Pix(S, S);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rays = 7, phase = rnd() * 6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r, d = Math.hypot(dx, dy) / r;
    const a = Math.atan2(dy, dx);
    const ray = Math.pow(Math.abs(Math.cos(a * rays * 0.5 + phase)), 8) * 0.9;
    const lim = 0.32 + ray * (0.6 + rnd() * 0.15);
    if (d > lim) {
      if (d < 0.75) P.set(x, y, color, 70 * (1 - d / 0.75)); // мягкий ореол
      continue;
    }
    const k = d / lim;
    P.set(x, y, k < 0.35 ? [255, 255, 240] : k < 0.7 ? [255, 236, 150] : color);
  }
  return P;
}

// ---------- Листы ----------
let cache = null;
export function weaponSprites() {
  if (cache) return cache;
  const prevDither = Pix.dither;
  Pix.dither = 0.22; // на оружии тона ровнее, как в эталоне
  Pix.rim = true; Pix.shine = 0.5; // светлые кромки и блики на металле
  cache = {
    rifle: { idle: drawGunRear('rifle'), fire: drawGunRear('rifle', { casingOut: true }), muzzle: [55, 90], side: true },
    shotgun: { idle: drawGunRear('shotgun'), fire: drawGunRear('shotgun'), muzzle: [58, 84], side: true },
    plasma: { idle: drawGunRear('plasma'), idle2: drawGunRear('plasma', { glow: 0.25 }), fire: drawGunRear('plasma', { glow: 0.7 }), muzzle: [55, 90], side: true },
    thermal: { idle: drawGunRear('thermal'), fire: drawGunRear('thermal', { glow: 0.8 }), muzzle: [59, 90], side: true },
    chainblade: {
      idle: drawChainblade({ teeth: 0 }),
      idle2: drawChainblade({ teeth: 3 }),
      windup: drawChainblade({ hilt: [170, 140], ang: -1.62, len: 150, teeth: 1 }),
      slash: drawChainblade({ hilt: [160, 104], ang: -3.05, len: 176, teeth: 2, smear: 1 }),
      follow: drawChainblade({ hilt: [96, 150], ang: -3.6, len: 150, teeth: 4, smear: 0.5 }),
      muzzle: [60, 30],
    },
    throwHand: drawThrow(),
    flash: [flashSprite(40, [255, 170, 60], 3), flashSprite(40, [255, 190, 80], 7)],
    flashBlue: flashSprite(40, [120, 220, 255], 5),
  };
  // Pix -> canvas (для рисования на 2D-оверлее)
  for (const w of Object.values(cache)) {
    if (w instanceof Pix) continue;
    if (Array.isArray(w)) continue;
    for (const [k, v] of Object.entries(w)) if (v instanceof Pix) w[k] = v.toCanvas();
  }
  cache.throwHand = cache.throwHand.toCanvas();
  for (const k of ['rifle', 'shotgun', 'plasma', 'thermal']) cache[k].lit = litCanvas(cache[k].fire, k === 'plasma' ? '#a0e8ff' : k === 'thermal' ? '#ffa860' : '#ffc860');
  cache.flash = cache.flash.map((f) => f.toCanvas());
  cache.flashBlue = cache.flashBlue.toCanvas();
  Pix.dither = prevDither;
  Pix.rim = false; Pix.shine = 0;
  return cache;
}

// Для tools/preview.html
export function previewAll() {
  const s = weaponSprites(), out = {};
  for (const [name, w] of Object.entries(s)) {
    if (w instanceof HTMLCanvasElement) { out[name] = w; continue; }
    if (Array.isArray(w)) { w.forEach((c, i) => (out[`${name}${i}`] = c)); continue; }
    const frames = Object.entries(w).filter(([, v]) => v instanceof HTMLCanvasElement);
    const c = document.createElement('canvas');
    c.width = W * frames.length; c.height = H;
    frames.forEach(([, v], i) => c.getContext('2d').drawImage(v, i * W, 0));
    out[name + ': ' + frames.map(([k]) => k).join(', ')] = c;
  }
  return out;
}
