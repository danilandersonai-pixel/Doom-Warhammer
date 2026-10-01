// Оружие от первого лица: 3D-модели рук в броне и пяти видов оружия + позы анимаций.
// Камера игрока смотрит вдоль -Z; модель стоит справа-снизу. Бейкер рендерит кадры и пикселизирует.
// Свои цвета героя: синяя броня, латунь, багровый корпус, сталь.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- Материалы с лёгкой «потёртостью» (процедурная текстура) ----------
function wearTexture(seed = 1, scratches = 14) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) { const v = 200 + R() * 55 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(R() * 128, R() * 128, 2 + R() * 6, 2 + R() * 6); }
  g.strokeStyle = 'rgba(80,70,60,0.55)';
  for (let i = 0; i < scratches; i++) { g.lineWidth = 1 + R(); g.beginPath(); const x = R() * 128, y = R() * 128; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 20); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const WEAR = [];
const wear = (i) => (WEAR[i] ||= wearTexture(i + 1));
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0.35, map: o.clean ? null : wear(o.w ?? 0),
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.glow ?? 1,
  });
}
const M = {
  armor: () => mat(0x2f4f9e, { rough: 0.42, metal: 0.45, w: 1 }),
  armorDark: () => mat(0x1d2f63, { rough: 0.5, metal: 0.4, w: 1 }),
  brass: () => mat(0xd09a38, { rough: 0.32, metal: 0.85, w: 2 }),
  casing: () => mat(0x8e1a1c, { rough: 0.45, metal: 0.3, w: 3 }),
  steel: () => mat(0x9aa2b2, { rough: 0.32, metal: 0.8, w: 4 }),
  iron: () => mat(0x34363f, { rough: 0.5, metal: 0.6, w: 5 }),
  black: () => mat(0x16161a, { rough: 0.6, metal: 0.3, clean: true }),
  leather: () => mat(0x5a3826, { rough: 0.8, metal: 0.05, w: 6 }),
  wood: () => mat(0x6e3e22, { rough: 0.7, metal: 0.05, w: 7 }),
  cyan: (k = 1) => mat(0x40d8ff, { emissive: 0x20c8ff, glow: 1.6 * k, clean: true, rough: 0.3 }),
  heat: (k = 1) => mat(0xff7a20, { emissive: 0xff5a10, glow: 1.8 * k, clean: true, rough: 0.4 }),
  red: () => mat(0xff3020, { emissive: 0xff2010, glow: 1.5, clean: true }),
};

// ---------- Примитивы ----------
const mesh = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; return o; };
const rbox = (w, h, d, m, r = 0.006) => mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)), m);
const cyl = (r1, r2, h, m, seg = 16) => mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
const sph = (r, m, seg = 12) => mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6 | 0)), m);
const tor = (r, t, m) => mesh(new THREE.TorusGeometry(r, t, 6, 20), m);
const put = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
const grp = (...ch) => { const g = new THREE.Group(); ch.forEach((c) => g.add(c)); return g; };
// Профиль в плоскости (вдоль оружия = x вперёд, y вверх) → вытягиваем по ширине; результат смотрит вдоль -Z
function profile(pts, width, m, bevel = 0.004) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2);   // x вперёд → -Z
  return mesh(geo, m);
}
// Ряд заклёпок вдоль -Z
function rivets(n, x, y, z0, step, m, r = 0.0045) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(put(sph(r, m, 6), x, y, z0 - i * step));
  return g;
}

// ---------- Рука в латной перчатке ----------
// Начало координат — центр хвата. Предплечье уходит назад (+Z) и вниз к краю экрана.
// fingers: 'grip' (обхват рукояти), 'support' (ладонь снизу), 'open'
function arm(side = 1, pose = 'grip') {
  const A = M.armor(), D = M.armorDark(), B = M.brass(), I = M.iron();
  const g = new THREE.Group();
  // ладонь
  const palm = rbox(0.085, 0.04, 0.095, D, 0.012);
  put(palm, side * 0.012, -0.004, 0.012);
  g.add(palm);
  // тыльная пластина и латунная накладка на костяшки
  g.add(put(rbox(0.09, 0.016, 0.08, A, 0.006), side * 0.02, 0.024, 0.01, 0, 0, side * -0.15));
  g.add(put(rbox(0.085, 0.014, 0.022, B, 0.004), side * 0.022, 0.026, -0.03, 0, 0, side * -0.15));
  // пальцы: 4 по две фаланги, обхватывают рукоять (идут вниз-вбок)
  for (let k = 0; k < 4; k++) {
    const z = -0.034 + k * 0.024;
    const f = new THREE.Group();
    f.add(put(rbox(0.024, 0.022, 0.044, A, 0.006), 0, 0, -0.022));
    const tip = put(rbox(0.022, 0.02, 0.036, D, 0.006), 0, 0, -0.04);
    const j2 = new THREE.Group(); j2.position.z = -0.044; j2.add(tip);
    j2.rotation.x = pose === 'open' ? -0.2 : -1.2;
    f.add(j2);
    f.position.set(-side * 0.03, 0.006, z + 0.03);
    f.rotation.set(0, side * Math.PI / 2, pose === 'open' ? 0.2 : side * 1.0);
    g.add(f);
  }
  // большой палец
  const th = put(rbox(0.026, 0.024, 0.05, A, 0.007), side * 0.04, -0.01, -0.03, 0.3, side * 0.6, 0);
  g.add(th);
  // запястье и наруч: конусная латная пластина, латунные обручи, заклёпки
  const fore = new THREE.Group();
  const lat = mesh(new THREE.LatheGeometry([0.042, 0.048, 0.056, 0.062, 0.066, 0.068].map((r, i) => new THREE.Vector2(r, i * 0.06)), 14), A);
  lat.rotation.x = Math.PI / 2;
  fore.add(lat);
  fore.add(put(tor(0.05, 0.008, B), 0, 0, 0.02));
  fore.add(put(tor(0.064, 0.009, B), 0, 0, 0.2));
  fore.add(put(rbox(0.06, 0.03, 0.24, D, 0.01), 0, 0.06, 0.15, -0.08, 0, 0));       // накладная пластина сверху
  fore.add(rivets(4, 0, 0.078, 0.24, 0.05, B));
  fore.add(put(rbox(0.11, 0.07, 0.07, I, 0.012), 0, -0.01, 0.31));                      // локоть
  fore.add(put(rbox(0.13, 0.11, 0.2, A, 0.03), side * 0.01, 0.0, 0.43, 0.2, 0, 0));    // начало плеча — уходит за кадр
  fore.position.set(side * 0.01, -0.01, 0.05);
  fore.rotation.set(0.5, side * 0.55, 0);   // предплечье уходит назад-вниз-наружу, к краю экрана
  g.add(fore);
  return g;
}

// ---------- 1. Тяжёлая винтовка «Громовержец» ----------
function rifle() {
  const C = M.casing(), S = M.steel(), I = M.iron(), B = M.brass(), K = M.black();
  const gun = new THREE.Group();
  // корпус-ствольная коробка: боковой профиль со скосами
  gun.add(put(profile([[-0.16, -0.02], [0.2, -0.02], [0.27, 0.02], [0.27, 0.075], [0.06, 0.09], [-0.12, 0.09], [-0.16, 0.06]], 0.085, C, 0.006), 0, 0, 0));
  // латунная окантовка граней корпуса
  for (const y of [-0.016, 0.086]) gun.add(put(rbox(0.088, 0.008, 0.36, B, 0.002), 0, y, -0.03));
  gun.add(put(rbox(0.09, 0.07, 0.008, B, 0.002), 0, 0.035, 0.155));
  // тёмная прорезь выброса гильз + затвор справа
  gun.add(put(rbox(0.012, 0.03, 0.08, K, 0.003), 0.043, 0.05, -0.02));
  gun.add(put(rbox(0.014, 0.018, 0.05, S, 0.003), 0.047, 0.05, -0.02));
  // эмблема на боку: кольцо и крест
  const em = new THREE.Group();
  em.add(put(tor(0.022, 0.004, B), 0, 0, 0, 0, Math.PI / 2, 0));
  em.add(put(rbox(0.006, 0.05, 0.008, B, 0.002), 0, 0, 0));
  em.add(put(rbox(0.006, 0.008, 0.036, B, 0.002), 0, 0.006, 0));
  gun.add(put(em, 0.045, 0.028, 0.08));
  gun.add(put(em.clone(), -0.045, 0.028, 0.08));
  // прицельная планка и мушка сверху
  gun.add(put(rbox(0.04, 0.025, 0.22, I, 0.004), 0, 0.105, 0.0));
  for (let i = 0; i < 6; i++) gun.add(put(rbox(0.044, 0.006, 0.012, S, 0.002), 0, 0.12, 0.08 - i * 0.03));
  gun.add(put(rbox(0.04, 0.03, 0.035, S, 0.006), 0, 0.125, 0.11));                  // задний прицел
  gun.add(put(rbox(0.014, 0.012, 0.02, K, 0.003), 0, 0.135, 0.095));
  // массивный стальной задний блок с круглой крышкой и щелью (виден со стороны игрока)
  gun.add(put(rbox(0.1, 0.13, 0.07, S, 0.012), 0, 0.03, 0.19));
  gun.add(put(cyl(0.032, 0.032, 0.02, I, 16), 0.0, 0.05, 0.228, Math.PI / 2));
  gun.add(put(cyl(0.02, 0.02, 0.026, S, 12), 0.0, 0.05, 0.232, Math.PI / 2));
  gun.add(put(rbox(0.06, 0.035, 0.012, I, 0.004), 0, -0.01, 0.226));
  gun.add(put(rbox(0.02, 0.006, 0.004, M.red(), 0.001), 0.012, -0.01, 0.233));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) gun.add(put(sph(0.006, B, 6), sx * 0.04, 0.03 + sy * 0.05, 0.226));
  // кожух ствола с прорезями
  const shroud = rbox(0.07, 0.065, 0.2, I, 0.01);
  gun.add(put(shroud, 0, 0.04, -0.36));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) gun.add(put(rbox(0.006, 0.03, 0.018, K, 0.002), s * 0.035, 0.04, -0.29 - i * 0.033));
  // ствол и дульный тормоз
  gun.add(put(cyl(0.017, 0.017, 0.16, S), 0, 0.045, -0.5, Math.PI / 2));
  const brake = cyl(0.03, 0.03, 0.07, S, 12);
  gun.add(put(brake, 0, 0.045, -0.58, Math.PI / 2));
  for (const s of [-1, 1]) gun.add(put(rbox(0.012, 0.016, 0.04, K, 0.002), s * 0.027, 0.045, -0.58));
  gun.add(put(tor(0.031, 0.005, B), 0, 0.045, -0.545));
  // рукоять и спуск
  gun.add(put(rbox(0.045, 0.12, 0.055, M.leather(), 0.012), 0, -0.07, 0.05, 0.3, 0, 0));
  gun.add(put(tor(0.025, 0.005, S), 0, -0.035, -0.0, 0, Math.PI / 2, 0));
  // магазин (отдельная группа — для перезарядки)
  const mag = new THREE.Group();
  mag.add(put(rbox(0.05, 0.17, 0.07, I, 0.008), 0, -0.08, 0, -0.18, 0, 0));
  mag.add(put(rbox(0.054, 0.02, 0.075, B, 0.004), 0, -0.16, 0.016, -0.18, 0, 0));
  mag.position.set(0, -0.02, -0.12);
  gun.add(mag);
  // цевьё снизу перед магазином
  gun.add(put(rbox(0.07, 0.04, 0.14, M.armorDark(), 0.01), 0, -0.03, -0.26));
  return { gun, mag, muzzle: new THREE.Vector3(0, 0.045, -0.63), grip: new THREE.Vector3(0, -0.06, 0.05), fore: new THREE.Vector3(0, -0.05, -0.26) };
}

// Сборка: оружие + две руки. base — положение в кадре.
function rig(build, opts = {}) {
  const root = new THREE.Group();
  const holder = new THREE.Group();       // всё оружие с руками (отдача, покачивание)
  root.add(holder);
  const W = build();
  holder.add(W.gun);
  const rArm = arm(1, 'grip');
  rArm.position.copy(W.grip).add(new THREE.Vector3(0.006, 0.02, 0));
  rArm.rotation.set(0.3, 0, 0);
  W.gun.add(rArm);
  let lArm = null;
  if (opts.left !== false) {
    lArm = arm(-1, 'support');
    lArm.position.copy(W.fore).add(new THREE.Vector3(-0.005, -0.035, 0.02));
    lArm.rotation.set(0.2, -0.3, -0.35);
    holder.add(lArm);
  }
  const base = opts.base || { x: 0.17, y: -0.155, z: -0.66, rx: 0.04, ry: 0.22, rz: 0 };
  const set = (o) => {
    holder.position.set(base.x + (o.x || 0), base.y + (o.y || 0), base.z + (o.z || 0));
    holder.rotation.set(base.rx + (o.rx || 0), base.ry + (o.ry || 0), base.rz + (o.rz || 0));
  };
  set({});
  return { root, holder, gun: W.gun, mag: W.mag, lArm, rArm, W, set, base };
}

// ---------- 2. Дробовик «Сокрушитель»: два ствола, деревянные накладки, помпа ----------
function shotgun() {
  const S = M.steel(), I = M.iron(), B = M.brass(), Wd = M.wood(), K = M.black();
  const gun = new THREE.Group();
  gun.add(put(profile([[-0.16, -0.02], [0.14, -0.02], [0.18, 0.01], [0.18, 0.08], [-0.12, 0.09], [-0.16, 0.06]], 0.09, I, 0.006), 0, 0, 0));
  for (const s of [-1, 1]) gun.add(put(rbox(0.012, 0.07, 0.26, Wd, 0.004), s * 0.046, 0.035, -0.0));   // деревянные щёчки
  for (const y of [-0.016, 0.088]) gun.add(put(rbox(0.094, 0.008, 0.33, B, 0.002), 0, y, -0.0));
  // два ствола
  for (const x of [-0.022, 0.022]) {
    gun.add(put(cyl(0.022, 0.022, 0.5, S, 14), x, 0.06, -0.42, Math.PI / 2));
    gun.add(put(cyl(0.025, 0.025, 0.03, I, 14), x, 0.06, -0.66, Math.PI / 2));
    gun.add(put(cyl(0.014, 0.014, 0.032, K, 10), x, 0.06, -0.665, Math.PI / 2));
  }
  gun.add(put(rbox(0.09, 0.02, 0.46, I, 0.004), 0, 0.085, -0.4));                      // планка над стволами
  for (const z of [-0.25, -0.5]) gun.add(put(rbox(0.1, 0.06, 0.02, B, 0.003), 0, 0.06, z));
  // помпа (двигается)
  const pump = new THREE.Group();
  pump.add(rbox(0.08, 0.05, 0.16, Wd, 0.012));
  for (let i = 0; i < 4; i++) pump.add(put(rbox(0.084, 0.006, 0.008, K, 0.001), 0, 0.012, -0.05 + i * 0.033));
  pump.position.set(0, 0.015, -0.32);
  gun.add(pump);
  // задний стальной блок как у винтовки
  gun.add(put(rbox(0.1, 0.12, 0.07, S, 0.012), 0, 0.035, 0.19));
  gun.add(put(cyl(0.03, 0.03, 0.02, I, 16), 0, 0.05, 0.228, Math.PI / 2));
  gun.add(put(rbox(0.05, 0.03, 0.012, Wd, 0.004), 0, -0.005, 0.226));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) gun.add(put(sph(0.006, B, 6), sx * 0.04, 0.035 + sy * 0.045, 0.226));
  gun.add(put(rbox(0.045, 0.12, 0.055, Wd, 0.012), 0, -0.07, 0.06, 0.3, 0, 0));          // рукоять
  // патрон в руке при перезарядке
  const shell = new THREE.Group();
  shell.add(put(cyl(0.012, 0.012, 0.05, M.casing(), 10), 0, 0, 0, Math.PI / 2));
  shell.add(put(cyl(0.013, 0.013, 0.012, B, 10), 0, 0, 0.026, Math.PI / 2));
  return { gun, pump, shell, muzzle: new THREE.Vector3(0, 0.06, -0.68), grip: new THREE.Vector3(0, -0.06, 0.06), fore: new THREE.Vector3(0, -0.01, -0.32) };
}

// ---------- 3. Плазменная пушка: сталь, светящиеся катушки и энергоячейка ----------
function plasma(glow = 1) {
  const S = M.steel(), I = M.iron(), B = M.brass(), K = M.black(), Cy = M.cyan(glow);
  const gun = new THREE.Group();
  gun.add(put(profile([[-0.16, -0.03], [0.16, -0.03], [0.22, 0.0], [0.22, 0.08], [0.0, 0.1], [-0.12, 0.1], [-0.16, 0.07]], 0.11, S, 0.008), 0, 0, 0));
  for (const y of [-0.026, 0.096]) gun.add(put(rbox(0.114, 0.008, 0.34, B, 0.002), 0, y, -0.03));
  // ствол-излучатель с кольцами-катушками
  gun.add(put(cyl(0.03, 0.036, 0.3, I, 16), 0, 0.04, -0.37, Math.PI / 2));
  for (let i = 0; i < 4; i++) gun.add(put(tor(0.04, 0.009, Cy), 0, 0.04, -0.27 - i * 0.06));
  gun.add(put(cyl(0.045, 0.03, 0.05, S, 16), 0, 0.04, -0.54, Math.PI / 2));
  gun.add(put(cyl(0.022, 0.022, 0.052, Cy, 12), 0, 0.04, -0.545, Math.PI / 2));
  // светящиеся щели на корпусе
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) gun.add(put(rbox(0.006, 0.05, 0.012, Cy, 0.002), s * 0.056, 0.035, 0.1 - i * 0.04));
  // энергоячейка сбоку (отдельная — для перезарядки)
  const cell = new THREE.Group();
  cell.add(put(cyl(0.028, 0.028, 0.14, I, 14), 0, 0, 0, Math.PI / 2));
  cell.add(put(cyl(0.022, 0.022, 0.1, Cy, 14), 0, 0, 0, Math.PI / 2));
  for (const z of [-0.06, 0.06]) cell.add(put(tor(0.029, 0.006, B), 0, 0, z));
  cell.position.set(-0.075, 0.03, -0.05);
  gun.add(cell);
  gun.add(put(rbox(0.1, 0.13, 0.07, I, 0.014), 0, 0.035, 0.19));
  gun.add(put(cyl(0.03, 0.03, 0.02, I, 16), 0, 0.05, 0.228, Math.PI / 2));
  gun.add(put(cyl(0.01, 0.01, 0.024, Cy, 10), 0, 0.05, 0.23, Math.PI / 2));
  gun.add(put(rbox(0.045, 0.12, 0.055, M.leather(), 0.012), 0, -0.08, 0.06, 0.3, 0, 0));
  gun.add(put(rbox(0.08, 0.045, 0.14, M.armorDark(), 0.012), 0, -0.04, -0.22));
  return { gun, mag: cell, muzzle: new THREE.Vector3(0, 0.04, -0.58), grip: new THREE.Vector3(0, -0.07, 0.06), fore: new THREE.Vector3(0, -0.06, -0.22), glowMats: [Cy] };
}

// ---------- 4. Термокопьё: два толстых ствола с раскалёнными срезами и баком ----------
function thermal(glow = 1) {
  const S = M.steel(), I = M.iron(), B = M.brass(), C = M.casing(), H = M.heat(glow), K = M.black();
  const gun = new THREE.Group();
  gun.add(put(profile([[-0.16, -0.03], [0.14, -0.03], [0.2, 0.0], [0.2, 0.09], [-0.12, 0.1], [-0.16, 0.07]], 0.12, C, 0.008), 0, 0, 0));
  for (const y of [-0.026, 0.096]) gun.add(put(rbox(0.124, 0.008, 0.32, B, 0.002), 0, y, -0.01));
  for (const x of [-0.032, 0.032]) {
    gun.add(put(cyl(0.034, 0.04, 0.3, I, 16), x, 0.04, -0.33, Math.PI / 2));
    gun.add(put(cyl(0.044, 0.044, 0.05, S, 16), x, 0.04, -0.49, Math.PI / 2));
    gun.add(put(cyl(0.026, 0.026, 0.052, H, 12), x, 0.04, -0.495, Math.PI / 2));
    for (let i = 0; i < 3; i++) gun.add(put(tor(0.041, 0.006, B), x, 0.04, -0.22 - i * 0.07));
  }
  // бак с топливом сверху (снимается при перезарядке)
  const tank = new THREE.Group();
  tank.add(put(cyl(0.035, 0.035, 0.2, S, 16), 0, 0, 0, Math.PI / 2));
  tank.add(put(sph(0.035, S), 0, 0, -0.1)); tank.add(put(sph(0.035, S), 0, 0, 0.1));
  for (const z of [-0.06, 0, 0.06]) tank.add(put(tor(0.036, 0.006, B), 0, 0, z));
  tank.add(put(rbox(0.012, 0.04, 0.012, H, 0.002), 0, 0.03, 0.0));
  tank.position.set(0, 0.14, 0.0);
  gun.add(tank);
  gun.add(put(rbox(0.11, 0.13, 0.07, S, 0.014), 0, 0.035, 0.19));
  gun.add(put(cyl(0.032, 0.032, 0.02, I, 16), 0, 0.05, 0.228, Math.PI / 2));
  gun.add(put(rbox(0.02, 0.006, 0.004, H, 0.001), 0.0, 0.0, 0.228));
  gun.add(put(rbox(0.045, 0.12, 0.055, M.leather(), 0.012), 0, -0.08, 0.06, 0.3, 0, 0));
  gun.add(put(rbox(0.09, 0.045, 0.14, M.armorDark(), 0.012), 0, -0.045, -0.2));
  return { gun, mag: tank, muzzle: new THREE.Vector3(0, 0.04, -0.52), grip: new THREE.Vector3(0, -0.07, 0.06), fore: new THREE.Vector3(0, -0.06, -0.2), glowMats: [H] };
}

// ---------- 5. Цепной клинок: багровый корпус, стальное полотно, бегущая цепь зубьев ----------
function chainblade() {
  const S = M.steel(), I = M.iron(), B = M.brass(), C = M.casing(), K = M.black();
  const g = new THREE.Group();
  // рукоять и гарда (начало координат — хват)
  g.add(put(cyl(0.022, 0.024, 0.14, M.leather(), 10), 0, -0.03, 0));
  g.add(put(rbox(0.12, 0.03, 0.06, B, 0.008), 0, 0.05, 0));
  // корпус мотора
  g.add(put(rbox(0.09, 0.16, 0.1, C, 0.02), 0, 0.14, 0));
  g.add(put(cyl(0.04, 0.04, 0.1, I, 14), 0, 0.14, 0, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) g.add(put(tor(0.03, 0.006, B), s * 0.05, 0.14, 0, 0, Math.PI / 2, 0));
  g.add(put(rbox(0.094, 0.01, 0.104, B, 0.002), 0, 0.22, 0));
  // полотно
  const L = 0.62, Wd = 0.085;
  g.add(put(rbox(0.02, L, Wd, S, 0.008), 0, 0.22 + L / 2, 0));
  g.add(put(rbox(0.024, L - 0.04, 0.02, I, 0.004), 0, 0.22 + L / 2, 0));
  // цепь зубьев по контуру полотна
  const teeth = [];
  const path = (u) => {   // u 0..1 по периметру (прямоугольник со скруглённым концом)
    const per = 2 * L + Math.PI * Wd / 2, d = u * per;
    if (d < L) return [Wd / 2 + 0.006, 0.22 + d, 0, 0];
    if (d < L + Math.PI * Wd / 2) { const a = (d - L) / (Wd / 2); return [Math.cos(a) * (Wd / 2 + 0.006), 0.22 + L + Math.sin(a) * (Wd / 2 + 0.006), 0, a]; }
    return [-Wd / 2 - 0.006, 0.22 + L - (d - L - Math.PI * Wd / 2), 0, Math.PI];
  };
  const N = 30;
  for (let i = 0; i < N; i++) {
    const t = new THREE.Group();
    t.add(put(rbox(0.016, 0.018, 0.026, S, 0.003), 0, 0, 0));
    t.add(put(new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 4), S), 0.012, 0.004, 0, 0, 0, -Math.PI / 2));
    g.add(t);
    teeth.push(t);
  }
  const setTeeth = (off) => teeth.forEach((t, i) => { const [x, y, , a] = path(((i + off) / N) % 1); t.position.set(0, y, x); t.rotation.set(-a, 0, 0); t.rotation.y = Math.PI / 2; });
  // полотно идёт вдоль локальной Y, зубья по краям вдоль Z
  setTeeth(0);
  return { g, setTeeth };
}

const ease = (t) => t * t * (3 - 2 * t);
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));
const projMuzzle = (R, cam) => {
  R.set({}); R.root.updateMatrixWorld(true);
  const p = R.W.muzzle.clone().applyMatrix4(R.gun.matrixWorld).project(cam);
  return { muzzle: [+(p.x * 0.5 + 0.5).toFixed(3), +(-p.y * 0.5 + 0.5).toFixed(3)] };
};

// Общий набор поз для стрелкового оружия: idle, fire, reload, raise (+ особые детали через hooks)
function gunFP(build, job, hooks = {}) {
  const R = rig(build, { base: job.base });
  const mag = R.W.mag, magHome = mag ? mag.position.clone() : null;
  const lHome = R.lArm.position.clone(), lRot = R.lArm.rotation.clone();
  const casing = put(cyl(0.008, 0.008, 0.03, M.brass(), 8), 0, 0, 0, 0, 0, Math.PI / 2);
  casing.visible = false;
  R.gun.add(casing);
  const glow = (k) => (R.W.glowMats || []).forEach((m) => { m.emissiveIntensity = (m.userData.base ??= m.emissiveIntensity) * k; });
  return {
    root: R.root,
    pose(anim, t) {
      if (mag) { mag.position.copy(magHome); mag.visible = true; }
      R.lArm.position.copy(lHome); R.lArm.rotation.copy(lRot); casing.visible = false; glow(1);
      if (hooks.reset) hooks.reset(R);
      if (anim === 'idle') { R.set({ y: Math.sin(t * Math.PI * 2) * 0.004, rz: Math.sin(t * Math.PI * 2) * 0.01 }); glow(0.85 + 0.3 * Math.sin(t * Math.PI * 2)); }
      else if (anim === 'fire') {
        const k = [1, 0.7, 0.3, 0.08][Math.round(t * 3)];
        const kick = hooks.kick || 1;
        R.set({ z: 0.05 * k * kick, y: 0.012 * k * kick, rx: 0.12 * k * kick, rz: -0.02 * k });
        glow(1 + 1.8 * k);
        if (hooks.casing !== false && t > 0.1 && t < 0.8) { casing.visible = true; casing.position.set(0.07 + t * 0.12, 0.08 + t * 0.06, -0.02 + t * 0.03); casing.rotation.z = t * 6; }
        if (hooks.fire) hooks.fire(R, t);
      } else if (anim === 'reload') {
        const tilt = bump(t, 0, 1);
        R.set({ y: -0.04 * tilt, rx: 0.25 * tilt, rz: 0.45 * tilt, x: -0.02 * tilt });
        const out = t < 0.5 ? ease(Math.min(1, t / 0.35)) : 1 - ease(Math.min(1, (t - 0.5) / 0.35));
        if (hooks.reload) hooks.reload(R, t, out);
        else if (mag) {
          mag.position.y = magHome.y - out * 0.25 * (hooks.magDir || 1);
          mag.visible = out < 0.95;
          R.lArm.position.lerp(new THREE.Vector3(lHome.x + 0.03, lHome.y - 0.22 * out, lHome.z + 0.08), Math.min(1, out * 1.5));
        }
      } else if (anim === 'raise') {
        const k = 1 - ease(t);
        R.set({ y: -0.22 * k, rx: -0.6 * k, rz: 0.2 * k });
      }
    },
    meta: (cam) => projMuzzle(R, cam),
  };
}

export const FP = {
  rifle: (job) => gunFP(rifle, job),
  shotgun: (job) => {
    let W;
    return gunFP(() => (W = shotgun()), job, {
      kick: 1.5, casing: false,
      reset() { W.pump.position.z = -0.32; W.shell.removeFromParent(); },
      fire(R, t) { W.pump.position.z = -0.32 + bump(t, 0.3, 1.01) * 0.08; },   // помпа после выстрела
      reload(R, t, out) {
        // два патрона снизу левой рукой
        const ph = (t * 2) % 1;
        R.lArm.position.set(R.lArm.position.x, R.lArm.position.y - 0.06 * Math.sin(ph * Math.PI), R.lArm.position.z + 0.12 * out);
        if (ph < 0.7) { R.lArm.add(W.shell); W.shell.position.set(0.0, 0.03, -0.04); }
      },
    });
  },
  plasma: (job) => gunFP(() => plasma(), job, { kick: 1.3, casing: false, magDir: -1 }),
  thermal: (job) => gunFP(() => thermal(), job, { kick: 0.6, casing: false, magDir: -1 }),
  chainblade(job) {
    const root = new THREE.Group(), holder = new THREE.Group();
    root.add(holder);
    const B = chainblade();
    const hand = arm(1, 'grip');
    hand.rotation.set(Math.PI / 2, 0, 0);    // хват вокруг рукояти, предплечье вниз
    hand.position.set(0.0, -0.02, 0.0);
    B.g.add(hand);
    holder.add(B.g);
    const base = job.base || { x: 0.15, y: -0.2, z: -0.42, rx: -0.3, ry: 1.4, rz: 0.62 };
    holder.rotation.order = 'ZYX';   // rz — наклон в плоскости экрана (клинок по диагонали)
    const set = (o) => { holder.position.set(base.x + (o.x || 0), base.y + (o.y || 0), base.z + (o.z || 0)); holder.rotation.set(base.rx + (o.rx || 0), base.ry + (o.ry || 0), base.rz + (o.rz || 0)); };
    set({});
    return {
      root,
      pose(anim, t, i) {
        B.setTeeth(i * 0.37);
        if (anim === 'idle') set({ y: Math.sin(t * Math.PI * 2) * 0.004, rz: Math.sin(t * Math.PI * 2) * 0.012 });
        else if (anim === 'swing') {
          // замах вправо-вверх → рубящий удар влево-вниз → возврат
          const k = t < 0.25 ? ease(t / 0.25) : t < 0.6 ? 1 - 2 * ease((t - 0.25) / 0.35) : -1 + ease((t - 0.6) / 0.4);
          set({ x: 0.06 * k, y: 0.04 * k + 0.015 * Math.min(0, k), rz: -0.7 * k, rx: 0.2 * k, z: -0.04 * Math.abs(k) });
        } else if (anim === 'raise') { const k = 1 - ease(t); set({ y: -0.3 * k, rz: 0.5 * k }); }
      },
    };
  },
  // бросок гранаты левой рукой
  throw(job) {
    const root = new THREE.Group(), holder = new THREE.Group();
    root.add(holder);
    const hand = arm(-1, 'grip');
    const gren = new THREE.Group();
    gren.add(sph(0.04, M.iron(), 14));
    gren.add(put(tor(0.041, 0.007, M.brass()), 0, 0, 0, Math.PI / 2, 0, 0));
    gren.add(put(cyl(0.014, 0.014, 0.03, M.steel()), 0, 0.045, 0));
    gren.add(put(tor(0.012, 0.003, M.brass()), 0.014, 0.06, 0));
    gren.position.set(0.0, 0.035, -0.02);
    hand.add(gren);
    holder.add(hand);
    const set = (x, y, z, rx, ry, rz) => { holder.position.set(x, y, z); holder.rotation.set(rx, ry, rz); };
    return {
      root,
      pose(anim, t) {
        // замах назад-вверх → бросок вперёд → рука уходит вниз
        if (t < 0.3) { const k = ease(t / 0.3); set(-0.12 - 0.04 * k, -0.16 + 0.1 * k, -0.4 + 0.08 * k, 0.4 - 0.6 * k, 0.3, 0.2); gren.visible = true; }
        else if (t < 0.65) { const k = ease((t - 0.3) / 0.35); set(-0.16 + 0.1 * k, -0.06 - 0.02 * k, -0.32 - 0.16 * k, -0.2 + 0.9 * k, 0.3 - 0.4 * k, 0.2); gren.visible = k < 0.6; }
        else { const k = ease((t - 0.65) / 0.35); set(-0.06 + 0.02 * k, -0.08 - 0.2 * k, -0.48 + 0.1 * k, 0.7 + 0.3 * k, -0.1, 0.2); gren.visible = false; }
      },
    };
  },
};
