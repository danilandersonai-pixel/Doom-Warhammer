// Карта: южный двор (старт) → ворота → арена 40×40 с платформой, пропастью и секретом → северные ворота (выход).
// Окружение — 3D с детальными пиксельными текстурами; трупы, огонь и знамёна — спрайты.
import * as THREE from 'three';
import { envTextures } from './textures.js';
import { enemySheet } from './art_chars.js';
import { miscArt, haloCanvas } from './art_misc.js';
import { nearestTexture, rng } from './pixel.js';

export const FOG_COLOR = 0xa9bcd6;

// Коробка, у которой UV растянуты по размеру (texScale метров на один повтор текстуры)
function boxGeo(w, h, d, texScale) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / texScale, (uv.getY(k) * dims[f][1]) / texScale);
  }
  // затемнение у основания (дешёвая "окклюзия"): низ боковых граней темнее
  const pos = g.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    const k = h > 0.6 ? 0.55 + 0.45 * Math.min(1, t * 1.6) : 0.8 + 0.2 * t;
    col.push(k, k, k * 1.04);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function buildLevel(scene, world) {
  const T = envTextures();
  const R = rng(42);
  const solid = [];               // меши для лучей выстрелов
  const mat = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
  const M = {
    snow: mat(T.snow), rock: mat(T.rock), blocks: mat(T.blocks), metal: mat(T.metal), sand: mat(T.sandbags),
    crate: mat(T.crate), gate: mat(T.gate), tiles: mat(T.tiles), hull: mat(T.hull),
    slate: new THREE.MeshLambertMaterial({ color: 0x3c4252 }),
  };
  const capMat = M.snow; // снег на верхушках

  // Блок: меш + коллайдер. top — материал верхней грани (снег), texScale — метров на повтор
  // материалы с учётом цвета вершин (для затемнения у основания)
  const aoCache = new Map();
  const ao = (m) => { if (!aoCache.has(m)) { const c = m.clone(); c.vertexColors = true; aoCache.set(m, c); } return aoCache.get(m); };
  // мягкая тень-пятно под предметом
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,26,40,0.55)'); gr.addColorStop(1, 'rgba(20,26,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  function contactShadow(x, z, w, d, y = 0, rotY = 0) {
    const s = new THREE.Mesh(shadowGeo, shadowMat);
    s.scale.set(w + 1.4, 1, d + 1.4);
    s.position.set(x, y + 0.012, z);
    s.rotation.y = rotY;
    scene.add(s);
  }

  function block(x, z, w, d, y0, h, m, { top = capMat, texScale = 2, collide = true, ray = true, rotY = 0 } = {}) {
    const mats = [ao(m), ao(m), ao(top || m), ao(m), ao(m), ao(m)];
    if (collide && h > 0.5 && w < 8 && d < 8) contactShadow(x, z, w, d, y0, rotY);
    const mesh = new THREE.Mesh(boxGeo(w, h, d, texScale), mats);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
    if (ray) solid.push(mesh);
    let box = null;
    if (collide) {
      const ww = Math.abs(Math.cos(rotY)) * w + Math.abs(Math.sin(rotY)) * d;
      const dd = Math.abs(Math.sin(rotY)) * w + Math.abs(Math.cos(rotY)) * d;
      box = world.box(x, z, ww, dd, y0, h);
    }
    return { mesh, box };
  }

  // Плоскость пола/земли с UV в метрах
  function ground(x0, x1, z0, z1, y, m, texScale = 8) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / texScale, (uv.getY(i) * (z1 - z0)) / texScale);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    scene.add(mesh);
    solid.push(mesh);
    return mesh;
  }

  // ---------------- Небо, туман, свет ----------------
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.02);
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const top = new THREE.Color(0x6f8db8), hor = new THREE.Color(FOG_COLOR), cols = [];
  const sp = skyGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = Math.max(0, sp.getY(i) / 400);
    const c = hor.clone().lerp(top, Math.pow(t, 0.6));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  // крупное бледное светило с ореолом
  const sunTex = new THREE.CanvasTexture(haloCanvas('255,250,235', 128));
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
  sunHalo.scale.set(140, 140, 1);
  sunHalo.position.set(150, 170, -260);
  scene.add(sunHalo);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: 0xfbf8ee, fog: false }));
  disc.position.copy(sunHalo.position);
  disc.lookAt(0, 0, 0);
  scene.add(disc);

  scene.add(new THREE.HemisphereLight(0xdfe9f7, 0x4a5262, 0.95));
  const sun = new THREE.DirectionalLight(0xffe4bc, 1.5);
  sun.position.set(30, 50, -40);
  scene.add(sun);

  // ---------------- Дальний план: горы и шпили в дымке ----------------
  const hazeMat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false });
  const ico = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + R() * 0.2, d = 150 + R() * 70;
    const m = new THREE.Mesh(ico, hazeMat(new THREE.Color(FOG_COLOR).lerp(new THREE.Color(0x8a9cb8), 0.25 + R() * 0.2)));
    const h = 40 + R() * 70;
    m.scale.set(30 + R() * 30, h, 30 + R() * 30);
    m.position.set(Math.cos(a) * d, h * 0.25, Math.sin(a) * d);
    m.rotation.y = R() * 3;
    scene.add(m);
    // снежные шапки
    const capM = new THREE.Mesh(ico, hazeMat(new THREE.Color(0xdde6f2)));
    capM.scale.set(m.scale.x * 0.45, h * 0.35, m.scale.z * 0.45);
    capM.position.set(m.position.x, m.position.y + h * 0.6, m.position.z);
    scene.add(capM);
  }
  const cone4 = new THREE.ConeGeometry(1, 1, 4);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + R() * 0.3, d = 70 + R() * 30;
    const c = new THREE.Color(FOG_COLOR).lerp(new THREE.Color(0x5a6a86), 0.25 + R() * 0.15);
    const w = 3 + R() * 4, h = 14 + R() * 26;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), hazeMat(c));
    tower.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d);
    scene.add(tower);
    const roof = new THREE.Mesh(cone4, hazeMat(c));
    roof.scale.set(w * 0.8, h * 0.5, w * 0.8);
    roof.position.set(tower.position.x, h - 2 + h * 0.25, tower.position.z);
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);
  }

  // ---------------- Земля (снег) с дырой-пропастью ----------------
  const PIT = { minX: 13, maxX: 20, minZ: -6, maxZ: 6 };
  ground(-80, PIT.minX, -80, 80, 0, M.snow);
  ground(PIT.minX, 80, -80, PIT.minZ, 0, M.snow);
  ground(PIT.minX, 80, PIT.maxZ, 80, 0, M.snow);
  ground(PIT.maxX, 80, PIT.minZ, PIT.maxZ, 0, M.snow);
  world.addPit(PIT.minX, PIT.maxX, PIT.minZ, PIT.maxZ);
  // стенки пропасти уходят вниз, дно тонет в темноте
  block(PIT.minX - 0.5, 0, 1, 12, -16, 16, M.rock, { top: M.rock, collide: false });
  block((PIT.minX + PIT.maxX) / 2, PIT.minZ - 0.5, 7, 1, -16, 16, M.rock, { top: M.rock, collide: false });
  block((PIT.minX + PIT.maxX) / 2, PIT.maxZ + 0.5, 7, 1, -16, 16, M.rock, { top: M.rock, collide: false });
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(8, 13), new THREE.MeshBasicMaterial({ color: 0x1a2030 }));
  abyss.rotation.x = -Math.PI / 2;
  abyss.position.set(16.5, -15, 0);
  scene.add(abyss);
  // для врагов пропасть — стена
  world.addBox(PIT.minX - 0.3, PIT.maxX, -100, 100, PIT.minZ - 0.3, PIT.maxZ + 0.3, { enemyOnly: true });
  // сломанное ограждение у края
  for (let z = -5; z <= 5; z += 2.5) if (R() < 0.8) block(PIT.minX - 0.2, z, 0.18, 0.18, 0, 0.6 + R() * 0.6, M.metal, { top: M.metal, collide: false, ray: false });

  // ---------------- Крепостные стены арены ----------------
  const WH = 7, H = 20;
  // стена вдоль оси с проёмами: holes [{a, b, y0, y1}]
  function wall(axis, fixed, from, to, holes = []) {
    const pieces = [[from, to, 0, WH]];
    for (const hl of holes) {
      for (let i = pieces.length - 1; i >= 0; i--) {
        const [a, b, y0, y1] = pieces[i];
        if (hl.b <= a || hl.a >= b) continue;
        pieces.splice(i, 1);
        if (hl.a > a) pieces.push([a, hl.a, y0, y1]);
        if (hl.b < b) pieces.push([hl.b, b, y0, y1]);
        pieces.push([Math.max(a, hl.a), Math.min(b, hl.b), hl.y1, y1]); // перемычка над проёмом
        if (hl.y0 > 0) pieces.push([Math.max(a, hl.a), Math.min(b, hl.b), 0, hl.y0]);
      }
    }
    for (const [a, b, y0, y1] of pieces) {
      if (b - a < 0.05 || y1 - y0 < 0.05) continue;
      const c = (a + b) / 2, len = b - a;
      if (axis === 'x') block(c, fixed, len, 1.2, y0, y1 - y0, M.blocks, { texScale: 3 });
      else block(fixed, c, 1.2, len, y0, y1 - y0, M.blocks, { texScale: 3 });
    }
  }
  wall('x', H + 0.6, -H - 1.2, H + 1.2, [{ a: -2.5, b: 2.5, y0: 0, y1: 5 }]);          // юг: входные ворота
  wall('x', -H - 0.6, -H - 1.2, H + 1.2, [{ a: -2.5, b: 2.5, y0: 1.6, y1: 6.2 }]);     // север: выход над платформой
  wall('z', -H - 0.6, -H, H, [{ a: 8.8, b: 12.2, y0: 1.2, y1: 3.6 }]);                 // запад: пролом к секрету
  wall('z', H + 0.6, -H, H);
  // зубцы — InstancedMesh
  const merl = [];
  for (let i = -H; i <= H; i += 2) merl.push([i, H + 0.6], [i, -H - 0.6], [H + 0.6, i], [-H - 0.6, i]);
  const merlMesh = new THREE.InstancedMesh(boxGeo(1, 1.2, 1.3, 2), M.blocks, merl.length);
  const mtx = new THREE.Matrix4();
  merl.forEach(([x, z], i) => merlMesh.setMatrixAt(i, mtx.makeTranslation(x, WH + 0.6, z)));
  scene.add(merlMesh);
  // контрфорсы внутрь арены
  for (const i of [-12, 12]) {
    for (const [x, z, w, d] of [[i, H - 0.2, 1.4, 1.4], [-H + 0.2, i, 1.4, 1.4], [H - 0.2, i + (i > 0 ? 4 : -4), 1.4, 1.4]]) block(x, z, w, d, 0, WH + 1, M.blocks, { texScale: 4 });
  }
  // угловые башни с шатровыми крышами
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    block(sx * (H + 1), sz * (H + 1), 4, 4, 0, 11, M.blocks, { texScale: 4 });
    const roof = new THREE.Mesh(cone4, M.slate);
    roof.scale.set(3.6, 5, 3.6);
    roof.position.set(sx * (H + 1), 13.5, sz * (H + 1));
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);
  }

  // ---------------- Северная платформа со ступенями ----------------
  const PH = 1.6;
  block(0, -15.5, 24, 9, 0, PH, M.blocks, { top: M.tiles, texScale: 4 });
  for (let i = 1; i <= 5; i++) {
    const h = i * 0.32;
    block(0, -7 - 0.8 * i + 0.4, 6, 0.8, 0, h, M.blocks, { top: M.tiles, texScale: 2 });   // центральная лестница
    block(-12 - 0.8 * (6 - i) + 0.4, -16, 0.8, 4, 0, h, M.blocks, { top: M.tiles, texScale: 2 }); // западная лестница
  }
  // парапет по краю платформы (с проёмом над лестницей)
  for (const x of [-11, -8, -5, 5, 8, 11]) block(x, -11.3, 2.2, 0.6, PH, 0.7, M.blocks, { texScale: 2 });
  // колонны на платформе
  function column(x, z, y0, h) {
    block(x, z, 1.4, 1.4, y0, 0.5, M.blocks, { texScale: 2 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, h - 1, 10), M.blocks);
    shaft.position.set(x, y0 + 0.5 + (h - 1) / 2, z);
    scene.add(shaft);
    solid.push(shaft);
    block(x, z, 1.5, 1.5, y0 + h - 0.5, 0.5, M.blocks, { texScale: 2 });
    world.box(x, z, 1.1, 1.1, y0, h);
  }
  for (const x of [-9, -4, 4, 9]) column(x, -18.5, PH, 6);
  column(-8, -3, 0, 7);
  column(8, 7, 0, 7);

  // проход за северными воротами
  block(0, -25.5, 6, 10, 0, PH, M.blocks, { top: M.tiles, texScale: 4 });
  block(-3.6, -25.5, 1.2, 10, 0, 7, M.rock, { texScale: 4 });
  block(3.6, -25.5, 1.2, 10, 0, 7, M.rock, { texScale: 4 });

  // ---------------- Южный двор (старт) ----------------
  for (const [x, z, w, d, h] of [[-8.5, 27, 3, 14, 8], [8.5, 27, 3, 14, 7], [0, 35, 20, 2, 9], [-6, 33, 4, 3, 5], [6.5, 31, 3, 4, 4]]) {
    block(x, z, w, d, 0, h, M.rock, { texScale: 4 });
  }

  // ---------------- Ворота (опускаются и поднимаются) ----------------
  function makeGate(x, z, y0, open) {
    const g = { mesh: null, box: null, y0, open, y: open ? y0 + 4.8 : y0 };
    g.mesh = new THREE.Mesh(boxGeo(5, 4.6, 0.5, 2), M.gate);
    scene.add(g.mesh);
    solid.push(g.mesh);
    g.mesh.position.set(x, g.y + 2.3, z);
    g.box = world.box(x, z, 5, 0.5, y0, 4.6);
    g.box.disabled = open;
    g.set = (o) => { g.open = o; g.box.disabled = o; };
    g.update = (dt) => {
      const target = g.open ? y0 + 4.8 : y0;
      g.y += Math.sign(target - g.y) * Math.min(Math.abs(target - g.y), dt * 3.5);
      g.mesh.position.y = g.y + 2.3;
    };
    return g;
  }
  const gates = { entry: makeGate(0, H + 0.6, 0, true), exit: makeGate(0, -H - 0.6, PH, false) };

  // ---------------- Баррикады из металлических плит с фасками ----------------
  const slabShape = new THREE.Shape([[-1.3, 0], [1.3, 0], [1.3, 0.25], [1.2, 0.25], [1.2, 1.45], [0.85, 2.0], [-0.85, 2.0], [-1.2, 1.45], [-1.2, 0.25], [-1.3, 0.25]].map(([x, y]) => new THREE.Vector2(x, y)));
  const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  slabGeo.translate(0, 0, -0.25);
  // UV экструзии — в метрах; растягиваем: 1 повтор текстуры на 2.4 м
  const suv = slabGeo.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) / 2.4 + 0.5, suv.getY(i) / 2.4);
  function slab(x, z, rotY = 0) {
    const m = new THREE.Mesh(slabGeo, M.metal);
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    scene.add(m);
    solid.push(m);
    const vertical = Math.abs(Math.sin(rotY)) > 0.5;
    world.box(x, z, vertical ? 0.6 : 2.6, vertical ? 2.6 : 0.6, 0, 2.0);
    contactShadow(x, z, 2.6, 0.6, 0, rotY);
    // снежный налёт на верхушке
    const cap = new THREE.Mesh(boxGeo(1.75, 0.08, 0.56, 2), M.snow);
    cap.position.set(x, 2.03, z);
    cap.rotation.y = rotY;
    scene.add(cap);
  }
  for (const [x, z, r] of [[-14, 6, 0], [-11, 6, 0], [5.5, -2, 0], [8.5, -2, 0], [9.5, 12, 0], [-4, -2, Math.PI / 2], [3, 15, 0]]) slab(x, z, r);

  // ---------------- Мешки с песком (дуги) ----------------
  const bagGeo = new THREE.SphereGeometry(1, 10, 6);
  bagGeo.scale(0.42, 0.17, 0.27);
  const bagUv = bagGeo.attributes.uv;
  for (let i = 0; i < bagUv.count; i++) bagUv.setXY(i, bagUv.getX(i) * 2, bagUv.getY(i));
  const bagList = [];
  function sandbagArc(cx, cz, rad, a0, a1, layers = 3) {
    const len = rad * (a1 - a0), n = Math.max(2, Math.round(len / 0.78));
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < n - (l % 2); i++) {
        const a = a0 + ((i + (l % 2) * 0.5 + 0.5) / n) * (a1 - a0);
        bagList.push([cx + Math.cos(a) * rad, 0.15 + l * 0.29, cz + Math.sin(a) * rad, -a + Math.PI / 2 + (R() - 0.5) * 0.15]);
      }
    }
    // коллайдер — кусочки вдоль дуги
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) / n) * (a1 - a0);
      world.box(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, 0.75, 0.75, 0, 0.95);
    }
  }
  sandbagArc(-6, 14, 3, -0.4, 1.3);
  sandbagArc(6, 3, 2.6, 2.0, 3.6);
  sandbagArc(-12, -6, 2.8, -1.2, 0.6);
  sandbagArc(14, 13, 2.4, 3.2, 4.6);
  sandbagArc(0, 26, 3, 3.6, 5.8, 2);
  const bags = new THREE.InstancedMesh(bagGeo, new THREE.MeshLambertMaterial({ map: T.bag }), bagList.length);
  const dummy = new THREE.Object3D();
  bagList.forEach(([x, y, z, ry], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, ry, (R() - 0.5) * 0.1); dummy.updateMatrix(); bags.setMatrixAt(i, dummy.matrix); });
  scene.add(bags);
  solid.push(bags);

  // ---------------- Ящики ----------------
  for (const [x, z, s, y0] of [[-16, 16, 1.4, 0], [-14.5, 16.4, 1.2, 0], [-15.6, 16.2, 1.1, 1.4], [16.5, -15, 1.4, 0], [-19.4, 10, 1.0, 0], [4.5, 24, 1.3, 0], [-17, -17.5, 1.4, 0]]) {
    block(x, z, s, s, y0, s, M.crate, { texScale: s, rotY: (R() - 0.5) * 0.3 });
  }

  // ---------------- Подбитая техника ----------------
  const tank = new THREE.Group();
  const addPart = (w, h, d, x, y, z, m, rx = 0, rz = 0) => {
    const p = new THREE.Mesh(boxGeo(w, h, d, 2), m);
    p.position.set(x, y, z);
    p.rotation.set(rx, 0, rz);
    tank.add(p);
    solid.push(p);
  };
  addPart(3.2, 1.3, 5.2, 0, 1.0, 0, M.hull);                 // корпус
  addPart(0.8, 1.1, 5.6, -1.9, 0.55, 0, M.metal);            // гусеницы
  addPart(0.8, 1.1, 5.6, 1.9, 0.55, 0, M.metal);
  addPart(2.2, 0.9, 2.4, 0.1, 2.1, -0.3, M.hull);            // башня
  addPart(0.3, 0.3, 3.2, 0.1, 2.1, -2.8, M.metal, 0.25);     // ствол, опущен
  tank.position.set(-15, 0.2, -10);
  tank.rotation.set(0.06, 0.5, -0.08);
  scene.add(tank);
  world.box(-15, -10, 4.2, 5.2, 0, 2.6);

  // ---------------- Бочки (взрываются, логика в pickups.js) ----------------
  const barrelSpots = [[-9.5, 5], [6.5, -0.5], [-4, 12.4], [11, 13.6], [-10, -9.5], [14.5, -9], [15.5, 16], [-2.6, -9.6]];

  // ---------------- Знамёна на столбах ----------------
  const poleMat = M.metal;
  const bannerGeo = new THREE.PlaneGeometry(1.3, 2.6);
  function bannerPole(x, z, y0, friend, rotY = 0) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6), poleMat);
    pole.position.set(x, y0 + 2.2, z);
    scene.add(pole);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), poleMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0, 0);
    const holder = new THREE.Group();
    holder.position.set(x, y0 + 4.1, z);
    holder.rotation.y = rotY;
    holder.add(bar);
    const cloth = new THREE.Mesh(bannerGeo, new THREE.MeshLambertMaterial({ map: friend ? T.bannerFriend : T.bannerEnemy, alphaTest: 0.5, side: THREE.DoubleSide }));
    cloth.position.set(0, -1.3, 0.02);
    holder.add(cloth);
    scene.add(holder);
    world.box(x, z, 0.3, 0.3, y0, 4.4);
    return cloth;
  }
  const banners = [
    bannerPole(-10, -12.4, PH, false), bannerPole(10, -12.4, PH, false), bannerPole(-17.5, 1.5, 0, false, 0.6),
    bannerPole(17, -11, 0, false, -0.5), bannerPole(-4.5, 27.5, 0, true, 0.3), bannerPole(4.5, 21.8, 0, true, -0.3),
  ];

  // ---------------- Валуны со снегом ----------------
  const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
  const bp = boulderGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const k = 0.8 + R() * 0.35; bp.setXYZ(i, bp.getX(i) * k, bp.getY(i) * k * 0.8, bp.getZ(i) * k); }
  boulderGeo.computeVertexNormals();
  const buv = boulderGeo.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getX(i) * 2, buv.getY(i) * 1);
  for (const [x, z, s] of [[-18, 18, 1.8], [18, 18.5, 1.5], [-18.5, -12, 1.4], [18.4, -18, 1.6], [-7.5, 31, 1.3], [7.5, 23, 1.1], [2.5, 31.5, 0.9]]) {
    const b = new THREE.Mesh(boulderGeo, M.rock);
    b.scale.set(s, s, s);
    b.position.set(x, s * 0.45, z);
    b.rotation.y = R() * 3;
    scene.add(b);
    solid.push(b);
    world.box(x, z, s * 1.4, s * 1.4, 0, s * 1.2);
    const cap = new THREE.Mesh(boulderGeo, M.snow);
    cap.scale.set(s * 0.8, s * 0.35, s * 0.8);
    cap.position.set(x, s * 0.95, z);
    scene.add(cap);
  }

  // ---------------- Остатки боя: трупы, кровь, костры ----------------
  const art = miscArt();
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  decalGeo.rotateX(-Math.PI / 2);
  const splatMats = art.splats.map((c) => new THREE.MeshLambertMaterial({ map: nearestTexture(c), transparent: true, alphaTest: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const staticDecal = (x, z, s, y = 0.02) => {
    const d = new THREE.Mesh(decalGeo, splatMats[(R() * splatMats.length) | 0]);
    d.position.set(x, y, z);
    d.rotation.y = R() * 6.28;
    d.scale.set(s, 1, s);
    scene.add(d);
  };
  // трупы — последние кадры смерти из листов врагов
  const corpseSprite = (type, x, z, flip) => {
    const sh = enemySheet(type);
    const tex = nearestTexture(sh.canvas);
    tex.repeat.set(1 / sh.count, 1);
    tex.offset.x = sh.death[3] / sh.count;
    if (flip) { tex.repeat.x *= -1; tex.offset.x += 1 / sh.count; }
    const px = type === 'heavy' ? 0.024 : 0.021;
    const g = new THREE.PlaneGeometry(sh.w * px, sh.h * px);
    g.translate(0, (sh.h * px) / 2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x302828, emissiveMap: tex }));
    m.position.set(x, -0.02, z);
    scene.add(m);
    staticDecal(x, z, 2.2);
    return m;
  };
  const corpses = [
    corpseSprite('fanatic', -2, 24, false), corpseSprite('gunner', 3.5, 28.5, true), corpseSprite('gunner', -12, 12, false),
    corpseSprite('fanatic', 10, 3.5, true), corpseSprite('heavy', 3, -5.5, false),
  ];
  for (let i = 0; i < 10; i++) staticDecal((R() - 0.5) * 34, (R() - 0.5) * 34, 1 + R() * 2);

  // костры (анимированные спрайты + ореол)
  const fires = [];
  const fireTex = art.fire;
  const haloTex = new THREE.CanvasTexture(haloCanvas('255,150,60', 64));
  function fire(x, y, z, s = 1) {
    const map = nearestTexture(fireTex.canvas);
    map.repeat.set(1 / fireTex.count, 1);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: true }));
    spr.scale.set(0.75 * s, 1.0 * s, 1);
    spr.position.set(x, y + 0.48 * s, z);
    scene.add(spr);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    halo.scale.set(2.6 * s, 2.6 * s, 1);
    halo.position.set(x, y + 0.5 * s, z);
    scene.add(halo);
    fires.push({ map, halo, phase: R() * 10, count: fireTex.count });
  }
  const brazier = (x, y, z) => {
    block(x, z, 0.35, 0.35, y, 1.1, M.metal, { top: M.metal, texScale: 1 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.4, 8), M.metal);
    bowl.position.set(x, y + 1.3, z);
    scene.add(bowl);
    fire(x, y + 1.45, z, 1.1);
  };
  for (const [x, y, z] of [[-4, 0, 19.2], [4, 0, 19.2], [-4.5, PH, -11.9], [4.5, PH, -11.9], [-19, 0, -19], [19, 0, -19], [-3.6, PH, -19.2], [3.6, PH, -19.2]]) brazier(x, y, z);
  fire(-15.4, 2.6, -10.5, 1.3); fire(-14, 1.8, -8.8, 0.9); fire(10.6, 0, 3.4, 0.8); fire(-2.6, 0, 24.6, 0.9); fire(2.6, 0, -5, 0.7); fire(-12.6, 0, 12.4, 0.7);

  // ---------------- Точки появления врагов ----------------
  const spawnPoints = [
    { x: -17, z: 12.5, y: 0 }, { x: 15, z: 18.6, y: 0 }, { x: -17, z: -5, y: 0 }, { x: -17, z: 3, y: 0 }, { x: 0, z: 17.5, y: 0 },
    { x: 16.5, z: -14.5, y: 0 }, { x: 17, z: 10, y: 0 }, { x: -9, z: -16, y: PH }, { x: 9, z: -16, y: PH }, { x: 0, z: -17, y: PH },
  ];

  const pickupSpots = [
    { type: 'health', x: -17.5, z: -1 }, { type: 'health', x: 17, z: 9.5 }, { type: 'health', x: 6.5, z: -15, y: PH },
    { type: 'armor', x: 0, z: -16, y: PH }, { type: 'ammo', x: -6, z: 17 }, { type: 'ammo', x: 9.5, z: -9 },
    { type: 'ammo', x: -14, z: 2 }, { type: 'grenades', x: -15, z: -14 }, { type: 'grenades', x: 3, z: 20.5 },
    { type: 'weapon:plasma', x: -6.5, z: -15, y: PH },
    // секрет в нише за проломом западной стены
    { type: 'relic', x: -22.5, z: 10.5, y: 1.2 }, { type: 'armor', x: -22.5, z: 9.3, y: 1.2 }, { type: 'grenades', x: -22.5, z: 11.7, y: 1.2 },
  ];

  // ---------------- Секретная ниша ----------------
  block(-22.6, 10.5, 3, 4.6, 0, 1.2, M.blocks, { top: M.tiles, texScale: 2 });     // пол ниши
  block(-22.6, 7.8, 3, 1, 0, 4, M.rock, { texScale: 2 });                           // стенки
  block(-22.6, 13.2, 3, 1, 0, 4, M.rock, { texScale: 2 });
  block(-24.6, 10.5, 1, 6.4, 0, 4, M.rock, { texScale: 2 });
  block(-22.6, 10.5, 3, 4.6, 3.6, 0.6, M.rock, { texScale: 2 });                    // потолок
  const secret = { minX: -24.2, maxX: -21.2, minZ: 8.4, maxZ: 12.6 };

  // ---------------- Анимация: огонь мерцает, знамёна колышутся ----------------
  function update(dt, time) {
    for (const f of fires) {
      f.map.offset.x = (Math.floor(time * 10 + f.phase) % f.count) / f.count;
      f.halo.material.opacity = 0.45 + Math.sin(time * 13 + f.phase) * 0.08;
    }
    banners.forEach((b, i) => { b.rotation.x = Math.sin(time * 1.3 + i) * 0.08; });
    gates.entry.update(dt);
    gates.exit.update(dt);
  }

  return {
    solid, spawnPoints, pickupSpots, barrelSpots, gates, secret, update, PH,
    playerStart: { x: 0, z: 30, yaw: 0 },
    arenaEnter: (p) => p.z < 18.5 && Math.abs(p.x) < 19,
    exitReached: (p) => p.z < -26,
    exitPoint: { x: 0, y: PH, z: -24 },
    arenaCenter: { x: 0, y: 0, z: 6 },
    decorCorpses: corpses,
  };
}
