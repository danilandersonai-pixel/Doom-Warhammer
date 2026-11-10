// Карта: южный двор (старт, десантная капсула) → ворота → арена 40×40 с платформой, плавильной пропастью
// и секретом → северные врата под фасадом собора (выход).
// Окружение — 3D с детальными пиксельными текстурами и рельефом; огонь, трупы и знамёна — спрайты.
// Вся неподвижная геометрия сливается в несколько больших мешей (по одному на материал) — сотни блоков
// рисуются десятком вызовов. Для лучей выстрелов остаются отдельные невидимые «коробки».
import * as THREE from 'three';
import { envTextures } from './textures.js';
import { SPRITES, spriteTexture, setSpriteFrame, spriteGeometry } from './sprites.js';
import { miscArt, haloCanvas } from './art_misc.js';
import { nearestTexture, rng, noise2 } from './pixel.js';
import { SUN_DIR, noiseTex } from './sky.js';
import { fireSheet, stainedGlass, roseWindow, sigil, carpet, shaftCanvas, poolCanvas, chainCanvas } from './art_env.js';

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
    const k = h > 0.6 ? 0.58 + 0.42 * Math.min(1, t * 1.6) : 0.82 + 0.18 * t;
    col.push(k, k, k * 1.03);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Сборщик статичной геометрии: копит треугольники по материалам, затем делает по одному мешу на материал
class Batch {
  constructor() { this.buckets = new Map(); this.v = new THREE.Vector3(); this.n = new THREE.Vector3(); this.nm = new THREE.Matrix3(); }
  add(geo, material, matrix, { start = 0, count = Infinity, tint = null } = {}) {
    let b = this.buckets.get(material);
    if (!b) { b = { pos: [], nrm: [], uv: [], col: [] }; this.buckets.set(material, b); }
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, C = geo.attributes.color, I = geo.index;
    const total = I ? I.count : P.count, end = Math.min(total, start + count);
    this.nm.getNormalMatrix(matrix);
    const { v, n } = this;
    for (let k = start; k < end; k++) {
      const i = I ? I.getX(k) : k;
      v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      b.pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize();
      b.nrm.push(n.x, n.y, n.z);
      if (U) b.uv.push(U.getX(i), U.getY(i)); else b.uv.push(0, 0);
      let r = 1, g = 1, bl = 1;
      if (C) { r = C.getX(i); g = C.getY(i); bl = C.getZ(i); }
      if (tint) { r *= tint[0]; g *= tint[1]; bl *= tint[2]; }
      b.col.push(r, g, bl);
    }
  }
  build(scene, shadows = true) {
    const out = [];
    for (const [material, b] of this.buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      const m = new THREE.Mesh(g, material);
      m.castShadow = shadows; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      scene.add(m);
      out.push(m);
    }
    this.buckets.clear();
    return out;
  }
}

const RAY_MAT = new THREE.MeshBasicMaterial();
const HDR = (r, g, b) => new THREE.Color().setRGB(r, g, b);

export function buildLevel(scene, world, G) {
  const T = envTextures();
  const R = rng(42);
  const solid = [];               // невидимые меши для лучей выстрелов
  const batch = new Batch(), batchFar = new Batch();   // far — без теней (колоссы за стенами)
  const mat = (map, normalMap, extra = {}) => new THREE.MeshLambertMaterial({ map, normalMap, vertexColors: true, ...extra });
  const shiny = (map, normalMap, specularMap, extra = {}) => new THREE.MeshPhongMaterial({ map, normalMap, specularMap, specular: 0x8fa2c4, shininess: 70, vertexColors: true, ...extra });
  const tex = (canvas, repeat = false) => nearestTexture(canvas, repeat);
  const M = {
    snow: shiny(T.snow, T.snowN, T.snowS), rock: mat(T.rock, T.rockN), blocks: mat(T.blocks, T.blocksN),
    metal: shiny(T.metal, T.metalN, null, { specular: 0x56606e, shininess: 34 }),
    crate: shiny(T.crate, T.crateN, null, { specular: 0x4a4636, shininess: 26 }), gate: shiny(T.gate, T.gateN, null, { specular: 0x505866, shininess: 30 }),
    tiles: shiny(T.tiles, T.tilesN, T.tilesS), hull: mat(T.hull, T.hullN),
    slate: new THREE.MeshLambertMaterial({ color: 0x2a2e3e, vertexColors: true }),
    iron: new THREE.MeshPhongMaterial({ color: 0x23252e, specular: 0x55606c, shininess: 30, vertexColors: true }),
    brass: new THREE.MeshPhongMaterial({ color: 0xa87a2c, specular: 0xffd890, shininess: 46, vertexColors: true }),
    wax: new THREE.MeshLambertMaterial({ color: 0xd8cdb4, emissive: 0x3a2a14 }),
    carpet: new THREE.MeshLambertMaterial({ map: tex(carpet(), true), vertexColors: true }),
  };
  const capMat = M.snow; // верхние грани — каменные плиты
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const mtxOf = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));

  // мягкая тень-пятно под предметом (контакт с землёй)
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
    gr.addColorStop(0, 'rgba(10,12,22,0.4)'); gr.addColorStop(1, 'rgba(10,12,22,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const batchShadow = new Batch();
  function contactShadow(x, z, w, d, y = 0, rotY = 0) {
    batchShadow.add(shadowGeo, shadowMat, mtxOf(x, y + 0.012, z, 0, rotY, 0, w + 1.4, 1, d + 1.4));
  }

  // Блок: рисуемая геометрия уходит в сборщик, для лучей — отдельный невидимый меш, для физики — коробка.
  // top — материал верхней грани, texScale — метров на повтор
  function block(x, z, w, d, y0, h, m, { top = capMat, texScale = 2, collide = true, ray = true, rotY = 0, tint = null } = {}) {
    const geo = boxGeo(w, h, d, texScale);
    const mesh = new THREE.Mesh(geo, RAY_MAT);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.rotation.y = rotY;
    mesh.updateMatrixWorld();
    if (collide && h > 0.5 && w < 8 && d < 8 && y0 < 0.3) contactShadow(x, z, w, d, y0, rotY);
    const topMat = top || m;
    for (let f = 0; f < 6; f++) batch.add(geo, f === 2 ? topMat : m, mesh.matrixWorld, { start: f * 6, count: 6, tint });
    if (ray) solid.push(mesh);
    let box = null;
    if (collide) {
      const ww = Math.abs(Math.cos(rotY)) * w + Math.abs(Math.sin(rotY)) * d;
      const dd = Math.abs(Math.sin(rotY)) * w + Math.abs(Math.cos(rotY)) * d;
      box = world.box(x, z, ww, dd, y0, h);
    }
    return { mesh, box };
  }
  // Деталь без физики: любая геометрия с матрицей → в сборщик (ray — участвует ли в лучах)
  function deco(geo, m, matrix, { ray = false, tint = null, far = false } = {}) {
    (far ? batchFar : batch).add(geo, m, matrix, { tint });
    if (ray) { const mesh = new THREE.Mesh(geo, RAY_MAT); mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.matrixWorld.copy(matrix); solid.push(mesh); }
  }
  const box = (w, h, d, ts = 2) => boxGeo(w, h, d, ts);

  // Земля: плита с UV в метрах и крупными пятнами тона (цвет вершин) — пол не выглядит «обоями»
  const gn = noise2(71);
  function ground(x0, x1, z0, z1, y, m, texScale = 8) {
    const w = x1 - x0, d = z1 - z0, sx = Math.max(1, Math.round(w / 2.5)), sz = Math.max(1, Math.round(d / 2.5));
    const g = new THREE.PlaneGeometry(w, d, sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const P = g.attributes.position, uv = g.attributes.uv, col = [];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i);
      uv.setXY(i, x / texScale, -z / texScale);
      let k = 0.74 + gn(x / 7 + 40, z / 7 + 40) * 0.36 + gn(x / 2.3, z / 2.3) * 0.12;
      const inArena = Math.abs(x) < 20.2 && Math.abs(z) < 20.2;
      if (inArena) k *= 0.8 + 0.2 * Math.min(1, (20.2 - Math.max(Math.abs(x), Math.abs(z))) / 2.2);   // темнее у стен
      const warm = gn(x / 11 + 9, z / 11) - 0.5;
      col.push(k * (1 + warm * 0.1), k, k * (1 - warm * 0.1));
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    batch.add(g, m, new THREE.Matrix4());
    const rayMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2), RAY_MAT);
    rayMesh.updateMatrixWorld();
    solid.push(rayMesh);
  }

  const cone4 = new THREE.ConeGeometry(1, 1, 4);
  const cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const noise = noiseTex();

  // общие мягкие текстуры света
  const poolTex = new THREE.CanvasTexture(poolCanvas());
  const shaftTex = new THREE.CanvasTexture(shaftCanvas());
  const haloTex = new THREE.CanvasTexture(haloCanvas('255,255,255', 64));
  const addMat = (map, color, opacity = 1) => {
    const m = new THREE.MeshBasicMaterial({ map, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    m.defines = { FOG_ADDITIVE: '' };      // в тумане аддитивный свет гаснет, а не сереет
    return m;
  };
  const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const wallGeo = new THREE.PlaneGeometry(1, 1);
  // пятно света на полу (или на стене, если задан поворот onWall)
  function lightPool(x, y, z, w, d, color, opacity = 0.5, onWall = null) {
    const m = new THREE.Mesh(onWall !== null ? wallGeo : floorGeo, addMat(poolTex, color, opacity));
    m.position.set(x, y, z);
    if (onWall !== null) { m.rotation.y = onWall; m.scale.set(w, d, 1); } else m.scale.set(w, 1, d);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  }

  // ---------------- Земля с дырой-пропастью ----------------
  const PIT = { minX: 13, maxX: 20, minZ: -6, maxZ: 6 };
  ground(-80, PIT.minX, -80, 80, 0, M.snow);
  ground(PIT.minX, 80, -80, PIT.minZ, 0, M.snow);
  ground(PIT.minX, 80, PIT.maxZ, 80, 0, M.snow);
  ground(PIT.maxX, 80, PIT.minZ, PIT.maxZ, 0, M.snow);
  world.addPit(PIT.minX, PIT.maxX, PIT.minZ, PIT.maxZ);
  // стенки плавильной пропасти уходят вниз к расплаву
  const pitCx = (PIT.minX + PIT.maxX) / 2;
  block(PIT.minX - 0.5, 0, 1, 12, -16, 16, M.rock, { top: M.rock, collide: false, texScale: 4 });
  block(PIT.maxX + 0.5, 0, 1, 12, -16, 15.9, M.rock, { top: M.rock, collide: false, texScale: 4 });
  block(pitCx, PIT.minZ - 0.5, 9, 1, -16, 16, M.rock, { top: M.rock, collide: false, texScale: 4 });
  block(pitCx, PIT.maxZ + 0.5, 9, 1, -16, 16, M.rock, { top: M.rock, collide: false, texScale: 4 });
  // расплав на дне: текущая корка с раскалёнными трещинами (шейдер), светится в HDR
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { tNoise: { value: noise }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float; uniform sampler2D tNoise; uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 p = vUv * vec2(0.9, 1.5);
        float n = texture2D(tNoise, p + vec2(uTime * 0.011, 0.0)).r;
        float m = texture2D(tNoise, p * 2.1 - vec2(0.0, uTime * 0.017) + n * 0.22).g;
        float crust = smoothstep(0.4, 0.6, n * 0.58 + m * 0.42);
        float vein = smoothstep(0.09, 0.0, abs(n - m));
        vec3 hot = mix(vec3(3.0, 0.62, 0.07), vec3(6.5, 3.0, 0.7), vein);
        vec3 col = mix(hot, vec3(0.07, 0.022, 0.016) + vec3(1.6, 0.3, 0.03) * vein, crust);
        gl_FragColor = vec4(col * (0.9 + 0.1 * sin(uTime * 2.3 + n * 20.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(PIT.maxX - PIT.minX, PIT.maxZ - PIT.minZ).rotateX(-Math.PI / 2), lavaMat);
  lava.position.set(pitCx, -13, 0);
  scene.add(lava);
  // жар над пропастью: аддитивные «занавесы» вдоль стенок
  const heatMat = addMat(shaftTex, HDR(1.5, 0.42, 0.08), 0.5);
  for (const [x, z, w, ry] of [[PIT.minX + 0.04, 0, 12, Math.PI / 2], [PIT.maxX - 0.04, 0, 12, Math.PI / 2], [pitCx, PIT.minZ + 0.04, 7, 0], [pitCx, PIT.maxZ - 0.04, 7, 0]]) {
    const m = new THREE.Mesh(wallGeo, heatMat);
    m.scale.set(w, 15, 1);
    m.rotation.order = 'YXZ';
    m.rotation.set(Math.PI, ry, 0);      // яркий край — снизу
    m.position.set(x, -5.6, z);
    scene.add(m);
  }
  const pitGlow = lightPool(pitCx, 0.4, 0, 9, 14, HDR(1.2, 0.36, 0.08), 0.3);
  // для врагов пропасть — стена
  world.addBox(PIT.minX - 0.3, PIT.maxX, -100, 100, PIT.minZ - 0.3, PIT.maxZ + 0.3, { enemyOnly: true });
  // узкий железный мост через пропасть (короткий путь для игрока, враги по нему не ходят)
  block(16.5, 0, 1.5, 13, -0.22, 0.22, M.metal, { top: M.metal, texScale: 2 });
  for (const z of [-6.2, -3, 0.2, 3.4, 6.2]) for (const sx of [-0.7, 0.7]) block(16.5 + sx, z, 0.12, 0.12, 0, 0.8 + (z === 0.2 && sx > 0 ? -0.5 : 0), M.iron, { top: M.iron, collide: false, ray: false });
  for (const sx of [-0.7, 0.7]) block(16.5 + sx, -1.4, 0.06, 6.2, 0.76, 0.05, M.iron, { top: M.iron, collide: false, ray: false });   // перила (одно сорвано)
  for (let z = -4.6; z <= 4.6; z += 2.3) deco(box(1.7, 0.16, 0.16), M.iron, mtxOf(16.5, -0.3, z));       // балки под настилом
  // сломанное ограждение у края
  for (let z = -5; z <= 5; z += 2.5) if (R() < 0.8) block(PIT.minX - 0.2, z, 0.18, 0.18, 0, 0.6 + R() * 0.6, M.iron, { top: M.iron, collide: false, ray: false });

  // ---------------- Крепостные стены арены ----------------
  const WH = 10, H = 20;
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
  merlMesh.castShadow = merlMesh.receiveShadow = true;
  scene.add(merlMesh);
  // контрфорсы внутрь арены
  for (const i of [-12, 12]) {
    for (const [x, z, w, d] of [[i, H - 0.2, 1.4, 1.4], [-H + 0.2, i, 1.4, 1.4], [H - 0.2, i + (i > 0 ? 4 : -4), 1.4, 1.4]]) block(x, z, w, d, 0, WH + 1, M.blocks, { texScale: 4 });
  }
  // угловые башни с шатровыми крышами и шпилями
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    block(sx * (H + 1), sz * (H + 1), 4, 4, 0, 14, M.blocks, { texScale: 4 });
    deco(box(4.6, 0.5, 4.6, 4), M.blocks, mtxOf(sx * (H + 1), 14.25, sz * (H + 1)));
    deco(cone4, M.slate, mtxOf(sx * (H + 1), 17.2, sz * (H + 1), 0, Math.PI / 4, 0, 3.4, 5.4, 3.4));
    deco(cyl8, M.iron, mtxOf(sx * (H + 1), 21.2, sz * (H + 1), 0, 0, 0, 0.05, 3, 0.05));
  }

  // ---------------- Убранство стен: цоколь, карниз, пилястры, витражи, факелы ----------------
  const fs = fireSheet(8, 32, 48, 3);
  const fireMats = [0, 1, 2].map((i) => {
    const map = nearestTexture(fs.canvas);
    map.repeat.set(1 / fs.count, 1);
    return { map, phase: i * 2.7, mat: new THREE.SpriteMaterial({ map, color: HDR(2.1, 1.55, 1.05), fog: true }) };
  });
  const haloMats = [0, 1, 2].map(() => new THREE.SpriteMaterial({ map: haloTex, color: HDR(1.0, 0.5, 0.16), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
  const emberSpots = [];            // откуда изредка летят угольки
  let fireN = 0;
  function fire(x, y, z, s = 1, halo = true) {
    const k = fireN++ % 3;
    const spr = new THREE.Sprite(fireMats[k].mat);
    spr.scale.set(0.86 * s, 1.3 * s, 1);
    spr.position.set(x, y + 0.56 * s, z);
    scene.add(spr);
    if (halo) {
      const h = new THREE.Sprite(haloMats[k]);
      h.scale.set(2.9 * s, 2.9 * s, 1);
      h.position.set(x, y + 0.55 * s, z);
      scene.add(h);
    }
    if (s >= 0.8) emberSpots.push([x, y + 0.9 * s, z]);
  }

  const glass = [0, 1, 2].map((k) => tex(stainedGlass(k, 1)));
  const glassCol = [HDR(1.6, 0.62, 0.22), HDR(0.42, 0.78, 1.7), HDR(1.0, 0.42, 1.5)];
  const glassMats = glass.map((map) => new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, color: HDR(2.3, 2.3, 2.3) }));
  const shaftMats = glassCol.map((c) => addMat(shaftTex, c, 0.34));
  const shaftGeo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
  // сторона стены: n — внутренняя нормаль (dx, dz), along — ось, вдоль которой идёт стена
  const SIDES = {
    S: { n: [0, -1], along: 'x', fixed: H, gap: [-3.4, 3.4], skipPil: [0], win: [-13.5, -6.5, 6.5, 13.5], kind: 0, shafts: false },
    N: { n: [0, 1], along: 'x', fixed: -H, gap: [-12.4, 12.4], skipPil: [-8, 0, 8], win: [-15, 15], kind: 0, shafts: true, noPool: true },
    W: { n: [1, 0], along: 'z', fixed: -H, gap: [8.6, 12.4], skipPil: [8], win: [-14, -6, 2, 16.5], kind: 1, shafts: true },
    E: { n: [-1, 0], along: 'z', fixed: H, gap: null, skipPil: [], win: [-15.5, -8.5, 8.5, 15.5], kind: 2, shafts: true },
  };
  const torchSpots = [];
  for (const S of Object.values(SIDES)) {
    const [nx, nz] = S.n, ry = Math.atan2(nx, nz);                  // поворот плоскости лицом внутрь арены
    const at = (a, off) => (S.along === 'x' ? [a, S.fixed + nz * off] : [S.fixed + nx * off, a]);
    const strip = (len, h, t, ts = 2) => (S.along === 'x' ? box(len, h, t, ts) : box(t, h, len, ts));
    // цоколь (с разрывом у проёмов) и карниз во всю длину
    for (const [a0, a1] of S.gap ? [[-H, S.gap[0]], [S.gap[1], H]] : [[-H, H]]) {
      const [cx, cz] = at((a0 + a1) / 2, 0.17);
      deco(strip(a1 - a0, 0.55, 0.34), M.blocks, mtxOf(cx, 0.275, cz), { tint: [0.82, 0.82, 0.86] });
    }
    {
      const [cx, cz] = at(0, 0.2), [cx2, cz2] = at(0, 0.28);
      deco(strip(H * 2, 0.36, 0.4), M.blocks, mtxOf(cx, WH - 0.5, cz), { tint: [1.1, 1.1, 1.12] });
      deco(strip(H * 2, 0.16, 0.56), M.blocks, mtxOf(cx2, WH - 0.24, cz2), { tint: [1.15, 1.15, 1.17] });
    }
    // пилястры с факелами
    for (const a of [-16, -8, 0, 8, 16]) {
      if (S.skipPil.includes(a)) continue;
      const [px, pz] = at(a, 0.17), y0 = 0;
      deco(strip(1.0, WH - 0.7 - y0, 0.34, 3), M.blocks, mtxOf(px, y0 + (WH - 0.7 - y0) / 2, pz), { tint: [1.08, 1.08, 1.1] });
      deco(strip(1.3, 0.5, 0.5), M.blocks, mtxOf(px, y0 + 0.8, pz));
      deco(strip(1.24, 0.4, 0.46), M.blocks, mtxOf(px, WH - 1.0, pz));
      torchSpots.push([...at(a, 0.62), ry, ...at(a, 0.36), y0]);
    }
    // витражи
    for (const a of S.win) {
      const [wx, wz] = at(a, 0.03);
      const g = new THREE.Mesh(wallGeo, glassMats[S.kind]);
      g.scale.set(2.05, 4.8, 1);
      g.position.set(wx, 6.3, wz);
      g.rotation.y = ry;
      scene.add(g);
      const [sx2, sz2] = at(a, 0.14);
      deco(strip(2.6, 0.22, 0.3), M.blocks, mtxOf(sx2, 3.78, sz2), { tint: [1.12, 1.12, 1.14] });   // подоконник
      if (!S.shafts) continue;
      // столб цветного света от окна вниз и пятно на полу
      const sh = new THREE.Mesh(shaftGeo, shaftMats[S.kind]);
      sh.scale.set(2.3, 9.5, 1);
      sh.position.set(wx + nx * 0.1, 8.4, wz + nz * 0.1);
      sh.rotation.order = 'YXZ';
      sh.rotation.set(-0.72, ry, 0);
      sh.renderOrder = 3;
      scene.add(sh);
      if (S.noPool) continue;
      const [fx2, fz2] = at(a, 5.6);
      lightPool(fx2, 0.03, fz2, S.along === 'x' ? 3.4 : 7, S.along === 'x' ? 7 : 3.4, glassCol[S.kind], 0.2);
    }
  }
  // факелы: кованый держатель, пламя, отсвет на стене
  const wallGlowMat = addMat(poolTex, HDR(1.3, 0.55, 0.16), 0.5);
  for (const [x, z, ry, gx, gz, y0] of torchSpots) {
    deco(box(0.1, 0.1, 0.5, 1), M.iron, mtxOf(x - Math.sin(ry) * 0.2, y0 + 3.0, z - Math.cos(ry) * 0.2, 0.5, ry, 0));
    deco(cyl8, M.iron, mtxOf(x, y0 + 3.14, z, 0, 0, 0, 0.13, 0.26, 0.13));
    fire(x, y0 + 3.18, z, 0.62, false);
    const g = new THREE.Mesh(wallGeo, wallGlowMat);
    g.scale.set(2.6, 3.4, 1);
    g.position.set(gx, y0 + 3.9, gz);
    g.rotation.y = ry;
    g.renderOrder = 2;
    scene.add(g);
  }

  // ---------------- Фасад собора над северными вратами ----------------
  const FZ = -H - 0.6;                                             // плоскость северной стены
  block(0, FZ - 0.1, 16, 1.4, WH, 8.6, M.blocks, { texScale: 3, collide: false, ray: false });
  {
    // щипец (треугольный фронтон), карниз и крест-меч на коньке
    const sh = new THREE.Shape([[-8.2, 0], [8.2, 0], [0, 5.6]].map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: false });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    deco(g, M.blocks, mtxOf(0, WH + 8.6, FZ - 0.8));
    deco(box(16.6, 0.4, 1.8, 3), M.blocks, mtxOf(0, WH + 8.5, FZ - 0.1), { tint: [1.14, 1.14, 1.16] });
    deco(cyl8, M.iron, mtxOf(0, WH + 15.6, FZ - 0.1, 0, 0, 0, 0.07, 3, 0.07));
    deco(box(1.3, 0.14, 0.14, 1), M.iron, mtxOf(0, WH + 16.3, FZ - 0.1));
  }
  // башни-шпили по бокам фасада
  for (const sx of [-1, 1]) {
    block(sx * 9.6, FZ - 0.2, 2.8, 2.8, WH, 12.5, M.blocks, { texScale: 3, collide: false, ray: false });
    deco(box(3.3, 0.45, 3.3, 3), M.blocks, mtxOf(sx * 9.6, WH + 12.7, FZ - 0.2), { tint: [1.14, 1.14, 1.16] });
    deco(cone4, M.slate, mtxOf(sx * 9.6, WH + 17.4, FZ - 0.2, 0, Math.PI / 4, 0, 2.3, 9, 2.3));
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) deco(cone4, M.slate, mtxOf(sx * 9.6 + dx, WH + 14, FZ - 0.2 + dz, 0, Math.PI / 4, 0, 0.36, 2.2, 0.36));
    // узкие окна башен
    const g = new THREE.Mesh(wallGeo, glassMats[0]);
    g.scale.set(1.3, 4.6, 1);
    g.position.set(sx * 9.6, WH + 6.6, FZ + 1.23);
    scene.add(g);
  }
  // окно-роза: витраж в каменном кольце, столб света на платформу
  const roseMat = new THREE.MeshBasicMaterial({ map: tex(roseWindow()), alphaTest: 0.5, color: HDR(2.6, 2.6, 2.6) });
  const rose = new THREE.Mesh(wallGeo, roseMat);
  rose.scale.set(7.2, 7.2, 1);
  rose.position.set(0, WH + 4.3, FZ + 0.64);
  scene.add(rose);
  deco(new THREE.TorusGeometry(3.62, 0.3, 6, 28), M.blocks, mtxOf(0, WH + 4.3, FZ + 0.62), { tint: [1.2, 1.2, 1.22] });
  for (const sx of [-1, 1]) {                                       // стрельчатые окна по бокам розы
    const g = new THREE.Mesh(wallGeo, glassMats[0]);
    g.scale.set(1.5, 4.4, 1);
    g.position.set(sx * 5.9, WH + 3.6, FZ + 0.64);
    scene.add(g);
  }
  const roseShaft = new THREE.Mesh(shaftGeo, addMat(shaftTex, HDR(1.5, 0.7, 0.3), 0.3));
  roseShaft.scale.set(7.5, 17, 1);
  roseShaft.position.set(0, WH + 6, FZ + 0.9);
  roseShaft.rotation.set(-0.64, 0, 0);
  roseShaft.renderOrder = 3;
  scene.add(roseShaft);

  // ---------------- Северная платформа со ступенями ----------------
  const PH = 1.6;
  block(0, -15.5, 24, 9, 0, PH, M.blocks, { top: M.tiles, texScale: 4 });
  for (let i = 1; i <= 5; i++) {
    const h = i * 0.32;
    block(0, -7 - 0.8 * i + 0.4, 6, 0.8, 0, h, M.blocks, { top: M.tiles, texScale: 2 });   // центральная лестница
    block(-12 - 0.8 * (6 - i) + 0.4, -16, 0.8, 4, 0, h, M.blocks, { top: M.tiles, texScale: 2 }); // западная лестница
    deco(box(2.2, 0.03, 0.8, 2), M.carpet, mtxOf(0, h + 0.016, -7 - 0.8 * i + 0.4));        // ковровая дорожка по ступеням
    deco(box(2.2, 0.32, 0.03, 2), M.carpet, mtxOf(0, h - 0.16, -7 - 0.8 * i + 0.8 + 0.016));
  }
  deco(box(2.2, 0.03, 9, 2), M.carpet, mtxOf(0, PH + 0.016, -15.5));
  lightPool(0, PH + 0.05, -14.6, 8, 9, HDR(1.3, 0.62, 0.3), 0.22);                           // свет розы на плитах
  // парапет по краю платформы (с проёмом над лестницей)
  for (const x of [-11, -8, -5, 5, 8, 11]) {
    block(x, -11.3, 2.2, 0.6, PH, 0.7, M.blocks, { texScale: 2 });
    deco(box(2.4, 0.12, 0.76, 2), M.blocks, mtxOf(x, PH + 0.76, -11.3), { tint: [1.14, 1.14, 1.16] });
  }
  // колонны: база, ствол, капитель
  const shaftG = new THREE.CylinderGeometry(0.5, 0.56, 1, 12);
  {
    const uv = shaftG.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  }
  function column(x, z, y0, h) {
    block(x, z, 1.4, 1.4, y0, 0.5, M.blocks, { texScale: 2 });
    deco(box(1.16, 0.2, 1.16, 2), M.blocks, mtxOf(x, y0 + 0.6, z), { tint: [1.1, 1.1, 1.12] });
    deco(shaftG, M.blocks, mtxOf(x, y0 + 0.7 + (h - 1.4) / 2, z, 0, 0, 0, 1, h - 1.4, 1), { ray: true });
    deco(box(1.2, 0.2, 1.2, 2), M.blocks, mtxOf(x, y0 + h - 0.6, z), { tint: [1.1, 1.1, 1.12] });
    block(x, z, 1.5, 1.5, y0 + h - 0.5, 0.5, M.blocks, { texScale: 2, collide: false });
    world.box(x, z, 1.1, 1.1, y0, h);
  }
  for (const x of [-9, -4, 4, 9]) column(x, -18.5, PH, 6);
  column(-8, -3, 0, 7);
  column(8, 7, 0, 7);
  // обломок колонны (низкий — через него можно перешагнуть)
  deco(shaftG, M.blocks, mtxOf(-10.4, 0.3, -1.2, 0.06, 0.4, 0.04, 1, 0.6, 1), { ray: true });
  world.box(-10.4, -1.2, 1.0, 1.0, 0, 0.42);
  contactShadow(-10.4, -1.2, 1, 1);

  // проход за северными воротами: коридор и свет в конце
  block(0, -25.5, 6, 10, 0, PH, M.blocks, { top: M.tiles, texScale: 4 });
  block(-3.6, -25.5, 1.2, 10, 0, 7, M.rock, { texScale: 4 });
  block(3.6, -25.5, 1.2, 10, 0, 7, M.rock, { texScale: 4 });
  block(0, -25.5, 8.4, 10, 7, 0.8, M.rock, { texScale: 4, collide: false, ray: false });
  const exitGlow = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: HDR(3.2, 2.5, 1.6), fog: false }));
  exitGlow.scale.set(6, 5.4, 1);
  exitGlow.position.set(0, PH + 2.7, -30.4);
  scene.add(exitGlow);
  const exitShaft = lightPool(0, PH + 0.04, -26, 5.6, 9, HDR(1.4, 1.0, 0.6), 0.5);

  // ---------------- Южный двор (старт) ----------------
  for (const [x, z, w, d, h] of [[-8.5, 27, 3, 14, 8], [8.5, 27, 3, 14, 7], [0, 35, 20, 2, 9], [-6, 33, 4, 3, 5], [6.5, 31, 3, 4, 4]]) {
    block(x, z, w, d, 0, h, M.rock, { texScale: 4 });
  }
  // десантная капсула ордена: на ней герой прибыл на площадь
  {
    const px0 = 0, pz0 = 32.6;
    const livery = [2.1, 0.8, 0.7];
    deco(new THREE.CylinderGeometry(1.2, 1.45, 2.5, 6), M.hull, mtxOf(px0, 1.45, pz0, 0, Math.PI / 6, 0), { ray: true, tint: livery });
    deco(new THREE.CylinderGeometry(0.5, 1.2, 0.9, 6), M.hull, mtxOf(px0, 3.15, pz0, 0, Math.PI / 6, 0), { tint: livery });
    deco(new THREE.CylinderGeometry(1.55, 1.2, 0.34, 6), M.iron, mtxOf(px0, 0.17, pz0, 0, Math.PI / 6, 0));
    world.box(px0, pz0, 2.3, 2.3, 0, 3.4);
    contactShadow(px0, pz0, 3.2, 3.2);
    for (let k = 0; k < 6; k++) {                                   // раскрытые лепестки-аппарели и тормозные стойки
      const a = k * (Math.PI / 3), cx = px0 + Math.sin(a) * 2.2, cz = pz0 + Math.cos(a) * 2.2;
      if (cz > 33.6) continue;
      deco(box(1.3, 0.1, 1.9, 2), M.hull, mtxOf(cx, 0.16, cz, 0.12, a, 0), { tint: livery });
      deco(box(0.12, 0.12, 1.5, 1), M.iron, mtxOf(px0 + Math.sin(a) * 1.7, 0.7, pz0 + Math.cos(a) * 1.7, -0.7, a, 0));
    }
    deco(box(0.9, 1.7, 0.08, 1), M.iron, mtxOf(px0, 1.3, pz0 - 1.3));               // открытый люк: тёмный проём
    const lamp = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: HDR(1.2, 2.6, 3.2), side: THREE.DoubleSide }));
    lamp.scale.set(0.7, 0.12, 1);
    lamp.position.set(px0, 2.3, pz0 - 1.36);
    scene.add(lamp);
    lightPool(px0, 0.03, pz0 - 2.8, 4.6, 4.6, HDR(0.3, 0.7, 0.95), 0.5);
    fire(px0 - 2.6, 0, pz0 - 0.6, 0.7); fire(px0 + 2.4, 0, pz0 + 0.2, 0.55);                // горит тормозное топливо
  }

  // ---------------- Ворота (опускаются и поднимаются) и порталы вокруг них ----------------
  function makeGate(x, z, y0, open) {
    const g = { mesh: null, box: null, y0, open, y: open ? y0 + 4.8 : y0 };
    g.mesh = new THREE.Mesh(boxGeo(5, 4.6, 0.5, 2), M.gate);
    g.mesh.castShadow = g.mesh.receiveShadow = true;
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
  // портал: откосы, стрельчатый тимпан с латунной печатью
  function portal(z, y0, dir) {
    const zf = z + dir * 0.72;
    for (const sx of [-1, 1]) {
      deco(box(0.7, 5.3, 0.36, 2), M.blocks, mtxOf(sx * 2.9, y0 + 2.65, zf), { tint: [1.16, 1.16, 1.18] });
      deco(box(0.9, 0.4, 0.5, 2), M.blocks, mtxOf(sx * 2.9, y0 + 0.2, zf));
    }
    const sh = new THREE.Shape([[-3.4, 0], [3.4, 0], [3.4, 0.5], [0, 2.5], [-3.4, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.36, bevelEnabled: false });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    deco(g, M.blocks, mtxOf(0, y0 + 5.2, zf - 0.18), { tint: [1.16, 1.16, 1.18] });
    deco(cyl8, M.brass, mtxOf(0, y0 + 6.05, zf + dir * 0.2, Math.PI / 2, 0, 0, 0.62, 0.08, 0.62));
    deco(box(0.1, 0.9, 0.06, 1), M.iron, mtxOf(0, y0 + 6.05, zf + dir * 0.26));
    deco(box(0.44, 0.1, 0.06, 1), M.iron, mtxOf(0, y0 + 6.22, zf + dir * 0.26));
  }
  portal(H + 0.6, 0, -1);
  portal(-H - 0.6, PH, 1);

  // ---------------- Баррикады из металлических плит с фасками ----------------
  const slabShape = new THREE.Shape([[-1.3, 0], [1.3, 0], [1.3, 0.25], [1.2, 0.25], [1.2, 1.45], [0.85, 2.0], [-0.85, 2.0], [-1.2, 1.45], [-1.2, 0.25], [-1.3, 0.25]].map(([x, y]) => new THREE.Vector2(x, y)));
  const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  slabGeo.translate(0, 0, -0.25);
  // UV экструзии — в метрах; растягиваем: 1 повтор текстуры на 2.4 м
  const suv = slabGeo.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) / 2.4 + 0.5, suv.getY(i) / 2.4);
  function slab(x, z, rotY = 0) {
    deco(slabGeo, M.crate, mtxOf(x, 0, z, 0, rotY, 0), { ray: true });
    const vertical = Math.abs(Math.sin(rotY)) > 0.5;
    world.box(x, z, vertical ? 0.6 : 2.6, vertical ? 2.6 : 0.6, 0, 2.0);
    contactShadow(x, z, 2.6, 0.6, 0, rotY);
    deco(box(1.75, 0.08, 0.56, 2), M.metal, mtxOf(x, 2.03, z, 0, rotY, 0));
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
      contactShadow(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, 0.2, 0.2);
    }
  }
  sandbagArc(-6, 14, 3, -0.4, 1.3);
  sandbagArc(6, 3, 2.6, 2.0, 3.6);
  sandbagArc(-12, -6, 2.8, -1.2, 0.6);
  sandbagArc(14, 13, 2.4, 3.2, 4.6);
  sandbagArc(0, 26, 3, 3.6, 5.8, 2);
  const bags = new THREE.InstancedMesh(bagGeo, new THREE.MeshLambertMaterial({ map: T.bag, normalMap: T.bagN }), bagList.length);
  const dummy = new THREE.Object3D();
  bagList.forEach(([x, y, z, ry], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, ry, (R() - 0.5) * 0.1); dummy.updateMatrix(); bags.setMatrixAt(i, dummy.matrix); });
  bags.castShadow = bags.receiveShadow = true;
  scene.add(bags);
  solid.push(bags);

  // ---------------- Ящики ----------------
  for (const [x, z, s, y0] of [[-16, 16, 1.4, 0], [-14.5, 16.4, 1.2, 0], [-15.6, 16.2, 1.1, 1.4], [16.5, -15, 1.4, 0], [-19.4, 10, 1.0, 0], [4.5, 24, 1.3, 0], [-17, -17.5, 1.4, 0]]) {
    block(x, z, s, s, y0, s, M.crate, { top: M.crate, texScale: s, rotY: (R() - 0.5) * 0.3 });
  }

  // ---------------- Подбитая техника ----------------
  {
    const TM = mtxOf(-15, 0.2, -10, 0.06, 0.5, -0.08);
    const part = (g, m, x, y, z, rx = 0, ry = 0, rz = 0, tint = null) => deco(g, m, new THREE.Matrix4().multiplyMatrices(TM, mtxOf(x, y, z, rx, ry, rz)), { ray: true, tint });
    const soot = [0.62, 0.6, 0.6];
    part(box(3.2, 1.3, 5.2, 2), M.hull, 0, 1.0, 0);                                   // корпус
    part(box(3.3, 0.5, 1.6, 2), M.hull, 0, 1.55, 2.3, -0.35, 0, 0, soot);             // лобовая плита
    for (const sx of [-1.9, 1.9]) {
      part(box(0.8, 1.1, 5.6, 2), M.metal, sx, 0.55, 0, 0, 0, 0, soot);              // гусеницы
      part(box(1.0, 0.1, 5.9, 2), M.iron, sx, 1.14, 0);
      for (let k = -2; k <= 2; k++) part(new THREE.CylinderGeometry(0.44, 0.44, 0.86, 10), M.iron, sx, 0.5, k * 1.15, 0, 0, Math.PI / 2);   // катки
    }
    part(box(2.2, 0.9, 2.4, 2), M.hull, 0.1, 2.1, -0.3, 0, 0.3, 0);                   // башня, свёрнута набок
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 10), M.iron, 0.5, 2.62, -0.1);   // люк
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), M.iron, 1.1, 2.75, -0.7, 0.9, 0, 0.3);
    part(new THREE.CylinderGeometry(0.15, 0.17, 3.4, 8), M.iron, 0.9, 2.02, -2.7, Math.PI / 2 - 0.25, 0.3, 0);   // ствол, опущен
    part(box(0.5, 0.5, 0.7, 1), M.iron, 1.3, 1.9, -4.2, -0.25, 0.3, 0);
    part(box(2.6, 0.12, 1.6, 1), M.iron, 0, 1.7, -1.9, 0, 0, 0, soot);                // решётка двигателя
    for (let k = -1; k <= 1; k++) part(box(0.5, 0.5, 0.7, 1), M.crate, k * 0.9, 1.5, -2.95, 0, 0, 0, soot);   // ящики на корме
    world.box(-15, -10, 4.2, 5.2, 0, 2.6);
    contactShadow(-15, -10, 5, 6);
  }

  // ---------------- Бочки (взрываются, логика в pickups.js) ----------------
  const barrelSpots = [[-9.5, 5], [6.5, -0.5], [-4, 12.4], [11, 13.6], [-10, -9.5], [14.5, -9], [15.5, 16], [-2.6, -9.6]];

  // ---------------- Знамёна: на столбах и длинные полотнища на стенах (колышутся) ----------------
  const cloths = [];
  const clothMat = (friend) => new THREE.MeshLambertMaterial({ map: friend ? T.bannerFriend : T.bannerEnemy, alphaTest: 0.5, side: THREE.DoubleSide });
  const clothMats = { true: clothMat(true), false: clothMat(false) };
  function cloth(w, h, friend) {
    const g = new THREE.PlaneGeometry(w, h, 4, 8);
    g.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(g, clothMats[friend]);
    m.castShadow = true; m.receiveShadow = true;
    cloths.push({ g, base: g.attributes.position.array.slice(), h, phase: R() * 10 });
    return m;
  }
  function bannerPole(x, z, y0, friend, rotY = 0) {
    deco(cyl8, M.iron, mtxOf(x, y0 + 2.2, z, 0, 0, 0, 0.08, 4.4, 0.08));
    deco(cyl8, M.iron, mtxOf(x, y0 + 4.1, z, 0, rotY, Math.PI / 2, 0.05, 1.6, 0.05));
    deco(cone4, M.brass, mtxOf(x, y0 + 4.56, z, 0, 0, 0, 0.1, 0.34, 0.1));
    const c = cloth(1.3, 2.6, friend);
    c.position.set(x + Math.sin(rotY) * 0.02, y0 + 4.1, z + Math.cos(rotY) * 0.02);
    c.rotation.y = rotY;
    scene.add(c);
    world.box(x, z, 0.3, 0.3, y0, 4.4);
  }
  bannerPole(-10, -12.4, PH, false); bannerPole(10, -12.4, PH, false); bannerPole(-17.5, 1.5, 0, false, 0.6);
  bannerPole(17, -11, 0, false, -0.5); bannerPole(-4.5, 27.5, 0, true, 0.3); bannerPole(4.5, 21.8, 0, true, -0.3);
  // длинные знамёна на стенах: еретики завесили площадь своими полотнищами, у входа — стяги ордена
  for (const [x, z, ry, friend] of [[-4.6, H - 0.06, Math.PI, true], [4.6, H - 0.06, Math.PI, true], [-H + 0.06, -4, Math.PI / 2, false], [-H + 0.06, 6, Math.PI / 2, false],
    [H - 0.06, -12, -Math.PI / 2, false], [H - 0.06, 12, -Math.PI / 2, false], [-7.6, -H + 0.06, 0, false], [7.6, -H + 0.06, 0, false]]) {
    const c = cloth(1.7, 5.2, friend);
    c.position.set(x, 9.2, z);
    c.rotation.y = ry;
    scene.add(c);
    deco(cyl8, M.iron, mtxOf(x, 9.25, z, 0, ry, Math.PI / 2, 0.05, 2.0, 0.05));
  }

  // ---------------- Валуны и каменный бой ----------------
  const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
  const bp = boulderGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const k = 0.8 + R() * 0.35; bp.setXYZ(i, bp.getX(i) * k, bp.getY(i) * k * 0.8, bp.getZ(i) * k); }
  boulderGeo.computeVertexNormals();
  const buv = boulderGeo.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getX(i) * 2, buv.getY(i) * 1);
  for (const [x, z, s] of [[-18, 18, 1.8], [18, 18.5, 1.5], [-18.5, -12, 1.4], [18.4, -18, 1.6], [-7.5, 31, 1.3], [7.5, 23, 1.1], [2.5, 31.5, 0.9]]) {
    deco(boulderGeo, M.rock, mtxOf(x, s * 0.45, z, 0, R() * 3, 0, s), { ray: true });
    world.box(x, z, s * 1.4, s * 1.4, 0, s * 1.2);
    contactShadow(x, z, s * 1.5, s * 1.5);
  }
  // мелкий щебень (InstancedMesh) — у стен, у техники и баррикад
  {
    const spots = [];
    for (let i = 0; i < 130; i++) {
      const k = R();
      let x, z;
      if (k < 0.5) { const a = R() * 6.283, edge = 17.4 + R() * 2.2; x = Math.max(-19.5, Math.min(19.5, Math.cos(a) * edge * 1.2)); z = Math.max(-19.5, Math.min(19.5, Math.sin(a) * edge * 1.2)); }
      else if (k < 0.7) { x = -15 + (R() - 0.5) * 9; z = -10 + (R() - 0.5) * 9; }
      else { x = (R() - 0.5) * 36; z = (R() - 0.5) * 36; }
      const sz = 0.06 + R() * R() * 0.22;
      if (world.inPit(x, z) || world.solidAt(x, 0.3, z) || z < -6.9) continue;
      spots.push([x, z, sz]);
    }
    const rub = new THREE.InstancedMesh(boulderGeo, new THREE.MeshLambertMaterial({ map: T.rock }), spots.length);
    spots.forEach(([x, z, s], i) => { dummy.position.set(x, s * 0.3, z); dummy.rotation.set(R() * 3, R() * 3, R() * 3); dummy.scale.setScalar(s); dummy.updateMatrix(); rub.setMatrixAt(i, dummy.matrix); });
    rub.castShadow = rub.receiveShadow = true;
    scene.add(rub);
    dummy.scale.setScalar(1);
    dummy.rotation.set(0, 0, 0);
  }
  // упавшие зубцы и плиты (низкие, можно перешагнуть)
  for (const [x, z, ry, rx] of [[-18.6, -3.2, 0.4, 0.2], [18.2, 9.2, 1.1, -0.15], [-8.6, 18.4, 0.2, 0.12], [12.4, 18.6, 2.0, 0.2], [18.5, -11.6, 0.8, 0.1], [-18.2, 14.6, 1.7, -0.2], [9, -6.2, 0.5, 0.1]]) {
    deco(box(1, 0.7, 1.2, 2), M.blocks, mtxOf(x, 0.24, z, rx, ry, 0.1), { ray: true });
    world.box(x, z, 1.0, 1.0, 0, 0.42);
    contactShadow(x, z, 1.1, 1.1);
  }

  // ---------------- Статуи рыцарей: на консолях фасада и два колосса за стеной ----------------
  function statue(x, y, z, s, ry, far = false) {
    const B = mtxOf(x, y, z, 0, ry, 0, s);
    const tint = far ? [0.7, 0.72, 0.82] : [0.92, 0.94, 1.0];
    const part = (g, px2, py2, pz2, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => deco(g, M.rock, new THREE.Matrix4().multiplyMatrices(B, mtxOf(px2, py2, pz2, rx, 0, rz, sx, sy, sz)), { far, tint });
    part(box(1.5, 0.5, 1.5, 2), 0, 0.25, 0);                                           // постамент
    part(new THREE.CylinderGeometry(0.42, 0.72, 2.1, 8), 0, 1.55, 0);                  // латная юбка
    part(box(1.25, 1.1, 0.7, 2), 0, 3.0, 0);                                           // кираса
    for (const sx of [-1, 1]) {
      part(sph, sx * 0.78, 3.42, 0, 0, 0, 0.42, 0.42, 0.42);                           // наплечники
      part(box(0.3, 1.25, 0.34, 2), sx * 0.66, 2.62, 0.3, -0.42, sx * 0.1);            // руки сведены на эфесе
    }
    part(sph, 0, 3.92, 0.02, 0, 0, 0.3, 0.34, 0.32);                                   // шлем
    part(cone4, 0, 4.36, -0.02, 0, 0, 0.16, 0.5, 0.16);                                // гребень
    part(box(0.16, 2.9, 0.06, 2), 0, 1.72, 0.74);                                      // меч остриём вниз
    part(box(0.84, 0.12, 0.12, 2), 0, 2.62, 0.74);
    part(box(1.5, 2.9, 0.12, 2), 0, 2.2, -0.42, 0.1);                                  // плащ за спиной
  }
  statue(-5.9, PH + 4.5, -H + 0.5, 0.74, 0);
  statue(5.9, PH + 4.5, -H + 0.5, 0.74, 0);
  for (const sx of [-1, 1]) deco(box(1.5, 0.3, 1.0, 2), M.blocks, mtxOf(sx * 5.9, PH + 4.35, -H + 0.3), { tint: [1.14, 1.14, 1.16] });   // консоли под статуями
  statue(-17.5, 0, -40, 5.4, 0.25, true);
  statue(17.5, 0, -40, 5.4, -0.25, true);

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
    d.receiveShadow = true;
    scene.add(d);
  };
  // трупы — последние кадры смерти из листов врагов
  const corpseSprite = (type, x, z, flip) => {
    const sh = SPRITES[type], t2 = spriteTexture(sh);
    setSpriteFrame(t2, sh, 'death', sh.meta.anims.death.frames - 1, flip ? 2 : 6);
    const m = new THREE.Mesh(spriteGeometry(sh), new THREE.MeshLambertMaterial({ map: t2, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x282424, emissiveMap: t2 }));
    m.position.set(x, -0.02, z);
    m.receiveShadow = true;
    scene.add(m);
    staticDecal(x, z, 2.2);
    return m;
  };
  const corpses = [
    corpseSprite('fanatic', -2, 24, false), corpseSprite('gunner', 3.5, 28.5, true), corpseSprite('gunner', -12, 12, false),
    corpseSprite('fanatic', 10, 3.5, true), corpseSprite('heavy', 3, -5.5, false),
  ];
  for (let i = 0; i < 10; i++) staticDecal((R() - 0.5) * 34, (R() - 0.5) * 34, 1 + R() * 2);

  // печать ордена в центре площади: резьба по камню + свечение, которое разгорается в бою
  const sg = sigil();
  const sigilLines = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sg.lines), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, opacity: 0.8 }));
  sigilLines.scale.set(11, 1, 11);
  sigilLines.position.set(0, 0.016, 2.5);
  scene.add(sigilLines);
  const sigilGlow = new THREE.Mesh(floorGeo, addMat(new THREE.CanvasTexture(sg.glow), HDR(1.6, 0.6, 0.16), 0.2));
  sigilGlow.scale.set(11, 1, 11);
  sigilGlow.position.set(0, 0.022, 2.5);
  sigilGlow.renderOrder = 2;
  scene.add(sigilGlow);

  // жаровни: тренога, чаша с углями, высокое пламя
  const coalMat = new THREE.MeshBasicMaterial({ color: HDR(3.0, 0.9, 0.16) });
  const coalGeo = new THREE.CircleGeometry(0.56, 10).rotateX(-Math.PI / 2);
  const brazier = (x, y, z) => {
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.4; deco(cyl8, M.iron, mtxOf(x + Math.cos(a) * 0.22, y + 0.6, z + Math.sin(a) * 0.22, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3, 0.05, 1.3, 0.05)); }
    deco(new THREE.CylinderGeometry(0.62, 0.3, 0.42, 10), M.iron, mtxOf(x, y + 1.32, z));
    deco(new THREE.TorusGeometry(0.62, 0.05, 5, 12), M.brass, mtxOf(x, y + 1.53, z, Math.PI / 2));
    const coals = new THREE.Mesh(coalGeo, coalMat);
    coals.position.set(x, y + 1.5, z);
    scene.add(coals);
    world.box(x, z, 0.35, 0.35, y, 1.1);
    contactShadow(x, z, 0.5, 0.5, y);
    fire(x, y + 1.46, z, 1.25);
  };
  for (const [x, y, z] of [[-4, 0, 19.2], [4, 0, 19.2], [-4.5, PH, -11.9], [4.5, PH, -11.9], [-19, 0, -19], [19, 0, -19], [-3.6, PH, -19.2], [3.6, PH, -19.2]]) brazier(x, y, z);
  fire(-15.4, 2.6, -10.5, 1.5); fire(-14, 1.8, -8.8, 1.0); fire(-16.4, 1.6, -11.6, 0.8); fire(10.6, 0, 3.4, 0.8); fire(-2.6, 0, 24.6, 0.9); fire(2.6, 0, -5, 0.7); fire(-12.6, 0, 12.4, 0.7);

  // свечи: гроздья у лестницы, на парапете, в тайнике, у стен
  {
    const spots = [];
    const cluster = (cx, cy, cz, n, rad) => {
      for (let i = 0; i < n; i++) { const a = R() * 6.283, r = R() * rad; spots.push([cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, 0.12 + R() * 0.3]); }
      lightPool(cx, cy + 0.03, cz, rad * 4 + 1.4, rad * 4 + 1.4, HDR(1.2, 0.55, 0.18), 0.3);
    };
    cluster(-3.5, 0, -7.2, 9, 0.5); cluster(3.5, 0, -7.2, 9, 0.5);
    for (const x of [-11, -5, 5, 11]) cluster(x, PH + 0.82, -11.3, 4, 0.22);
    cluster(-23.6, 1.2, 9.2, 6, 0.3); cluster(-23.6, 1.2, 11.9, 6, 0.3);
    cluster(-19.83, 0.55, -2, 7, 0.13); cluster(19.83, 0.55, 12, 7, 0.13); cluster(-1.6, 0, 19.3, 5, 0.3); cluster(1.6, 0, 19.3, 5, 0.3);
    cluster(-2.1, PH, -19.5, 6, 0.3); cluster(2.1, PH, -19.5, 6, 0.3);
    const wax = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.045, 1, 5), M.wax, spots.length);
    const fp = new Float32Array(spots.length * 3);
    spots.forEach(([x, y, z, h], i) => { dummy.position.set(x, y + h / 2, z); dummy.scale.set(1, h, 1); dummy.updateMatrix(); wax.setMatrixAt(i, dummy.matrix); fp[i * 3] = x; fp[i * 3 + 1] = y + h + 0.05; fp[i * 3 + 2] = z; });
    dummy.scale.set(1, 1, 1);
    scene.add(wax);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    scene.add(new THREE.Points(fg, new THREE.PointsMaterial({ color: HDR(3.4, 2.0, 0.7), size: 0.1, sizeAttenuation: true, map: poolTex, transparent: true, alphaTest: 0.25, depthWrite: false })));
  }

  // лампады на цепях у стен: покачиваются на ветру
  const lanterns = [];
  {
    const chainCv = chainCanvas();
    const lampMat = new THREE.SpriteMaterial({ map: haloTex, color: HDR(1.25, 0.62, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const cageGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.42, 6), ironPlain = new THREE.MeshPhongMaterial({ color: 0x23252e, specular: 0x55606c, shininess: 30 });
    for (const [x, z, ry, len] of [[-12, H - 0.9, Math.PI, 3.6], [12, H - 0.9, Math.PI, 4.2], [-H + 0.9, -9.5, Math.PI / 2, 4.0], [-H + 0.9, 3.5, Math.PI / 2, 3.4],
      [H - 0.9, 13.5, -Math.PI / 2, 3.8], [H - 0.9, -14, -Math.PI / 2, 4.4], [-12.5, -H + 0.9, 0, 3.2], [12.5, -H + 0.9, 0, 3.2]]) {
      deco(box(0.14, 0.14, 1.5, 1), M.iron, mtxOf(x - Math.sin(ry) * 0.3, 9.1, z - Math.cos(ry) * 0.3, 0, ry, 0));
      const grp = new THREE.Group();
      grp.position.set(x + Math.sin(ry) * 0.3, 9.05, z + Math.cos(ry) * 0.3);
      const cm = tex(chainCv, true);
      cm.repeat.set(1, len / 0.5);
      const chain = new THREE.Mesh(new THREE.PlaneGeometry(0.13, len).translate(0, -len / 2, 0), new THREE.MeshLambertMaterial({ map: cm, alphaTest: 0.5, side: THREE.DoubleSide }));
      chain.rotation.y = ry + 0.8;
      grp.add(chain);
      const cage = new THREE.Mesh(cageGeo, ironPlain);
      cage.position.y = -len - 0.2;
      grp.add(cage);
      const glow = new THREE.Sprite(lampMat);
      glow.scale.set(2.1, 2.1, 1);
      glow.position.y = -len - 0.2;
      grp.add(glow);
      scene.add(grp);
      lanterns.push({ grp, phase: R() * 10 });
    }
  }

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
  {
    // витраж-алтарь в глубине тайника
    const g = new THREE.Mesh(wallGeo, glassMats[0]);
    g.scale.set(1.1, 2.0, 1);
    g.position.set(-24.07, 2.4, 10.5);
    g.rotation.y = Math.PI / 2;
    scene.add(g);
  }

  // статичная геометрия → несколько больших мешей
  batch.build(scene, true);
  batchFar.build(scene, false);
  for (const m of batchShadow.build(scene, false)) { m.receiveShadow = false; m.renderOrder = 1; }

  // ---------------- Свет от огня: настоящие точечные источники в ключевых местах ----------------
  const fireLights = [];
  for (const [x, y, z, power, dist, color] of [
    [0, 2.9, 18.2, 80, 17, 0xff8a3c], [0, PH + 2.7, -11.0, 80, 17, 0xff8a3c], [16.5, -0.4, 0, 110, 15, 0xff5216], [0, PH + 3.0, -18.2, 70, 15, 0xff8a3c],
    [-14.6, 3.4, -9.6, 70, 14, 0xff7a30], [-19, 2.6, -19, 46, 13, 0xff8a3c], [19, 2.6, -19, 46, 13, 0xff8a3c],
  ]) {
    const l = new THREE.PointLight(color, power, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
    fireLights.push({ l, power, phase: R() * 10 });
  }
  function setLights(n) { fireLights.forEach((f, i) => { f.l.visible = i < n; }); }

  // ---------------- Световая сетка: где на площади лежит прямой свет светила ----------------
  // Нужна для местного освещения спрайтов (оружие в руках, тени врагов) без дорогих расчётов в кадре.
  const LG = { x0: -27, z0: -32, nx: 54, nz: 72, sun: null };
  LG.sun = new Float32Array(LG.nx * LG.nz);
  {
    const rc = new THREE.Raycaster(), o = new THREE.Vector3();
    rc.far = 90;
    scene.updateMatrixWorld(true);
    for (let j = 0; j < LG.nz; j++) for (let i = 0; i < LG.nx; i++) {
      const x = LG.x0 + i + 0.5, z = LG.z0 + j + 0.5;
      const gy = Math.max(0, world.groundAt(x, z, 3, 0.1));
      rc.set(o.set(x, gy + 1.3, z), SUN_DIR);
      LG.sun[j * LG.nx + i] = rc.intersectObjects(solid, false).length ? 0 : 1;
    }
  }
  const sunAt = (x, z) => {
    const fx = Math.max(0, Math.min(LG.nx - 1.001, x - LG.x0 - 0.5)), fz = Math.max(0, Math.min(LG.nz - 1.001, z - LG.z0 - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, S = LG.sun, n = LG.nx;
    return (S[j * n + i] * (1 - tx) + S[j * n + i + 1] * tx) * (1 - tz) + (S[(j + 1) * n + i] * (1 - tx) + S[(j + 1) * n + i + 1] * tx) * tz;
  };
  // Цвет местного света в точке: холодная тень / тёплое солнце + отсвет ближайших огней
  function lightAt(p, out) {
    const s = sunAt(p.x, p.z);
    let f = 0;
    for (const fl of fireLights) {
      if (!fl.l.visible) continue;
      const d2 = (fl.l.position.x - p.x) ** 2 + (fl.l.position.z - p.z) ** 2 + (fl.l.position.y - p.y) ** 2;
      f += Math.max(0, 1 - Math.sqrt(d2) / fl.l.distance) ** 2 * 0.5;
    }
    f = Math.min(0.6, f);
    if (out) out.setRGB(0.6 + s * 0.5 + f * 0.7, 0.68 + s * 0.34 + f * 0.32, 0.86 + s * 0.06);
    return s;
  }

  // ---------------- Анимация: огонь, знамёна, лампады, расплав, печать ----------------
  const api = { shadowsDirty: true };
  let emberT = 0, smokeT = 0, sigilK = 0.2;
  const _ep = new THREE.Vector3();
  function update(dt, time) {
    for (const f of fireLights) f.l.intensity = f.power * (0.86 + Math.sin(time * 11 + f.phase) * 0.07 + Math.sin(time * 23.7 + f.phase * 2) * 0.07);
    if (Math.abs(gates.entry.y - (gates.entry.open ? 4.8 : 0)) > 0.01 || Math.abs(gates.exit.y - PH - (gates.exit.open ? 4.8 : 0)) > 0.01) api.shadowsDirty = true;
    fireMats.forEach((f, i) => {
      f.map.offset.x = (Math.floor(time * 11 + f.phase) % fs.count) / fs.count;
      haloMats[i].opacity = 0.46 + Math.sin(time * 13 + f.phase) * 0.07 + Math.sin(time * 29 + f.phase) * 0.04;
    });
    // знамёна: волна бежит сверху вниз, низ полотнища гуляет сильнее
    for (const c of cloths) {
      const a = c.g.attributes.position.array, b = c.base;
      for (let i = 0; i < a.length; i += 3) {
        const k = -b[i + 1] / c.h;
        a[i + 2] = b[i + 2] + Math.sin(time * 2.1 + b[i + 1] * 1.6 + c.phase) * 0.09 * k + Math.sin(time * 3.7 + b[i] * 3 + c.phase) * 0.03 * k;
      }
      c.g.attributes.position.needsUpdate = true;
    }
    for (const l of lanterns) { l.grp.rotation.z = Math.sin(time * 1.1 + l.phase) * 0.06; l.grp.rotation.x = Math.sin(time * 0.83 + l.phase * 1.7) * 0.05; }
    lavaMat.uniforms.uTime.value = time;
    pitGlow.material.opacity = 0.26 + Math.sin(time * 1.7) * 0.05;
    // печать разгорается, пока идёт бой
    const st = G && G.flow ? G.flow.stage : '';
    const target = st === 'wave' ? 0.75 : st === 'boss' ? 1 : st === 'between' ? 0.45 : 0.16;
    sigilK += (target - sigilK) * Math.min(1, dt * 1.5);
    sigilGlow.material.opacity = sigilK * (0.75 + 0.25 * Math.sin(time * 2.6));
    // свет в конце коридора ярче, когда выход открыт
    exitShaft.material.opacity = gates.exit.open ? 0.5 : 0.12;
    gates.entry.update(dt);
    gates.exit.update(dt);
    // угольки от жаровен и расплава, дым над подбитой техникой
    if (G && G.fx && dt > 0) {
      emberT -= dt;
      if (emberT <= 0) {
        emberT = 0.12;
        const s = emberSpots[(Math.random() * emberSpots.length) | 0];
        G.fx.sparks.burst(_ep.set(s[0], s[1], s[2]), 1, 0xffa040, { speed: 1.6, life: 1.6, gravity: -1.4, size: 0.05, up: 1.2, spread: 0.6 });
        if (Math.random() < 0.5) G.fx.sparks.burst(_ep.set(pitCx + (Math.random() - 0.5) * 6, -0.5, (Math.random() - 0.5) * 11), 1, 0xff7020, { speed: 2.4, life: 2.2, gravity: -1.8, size: 0.06, up: 1.5, spread: 0.3 });
      }
      smokeT -= dt;
      if (smokeT <= 0) {
        smokeT = 0.22;
        G.fx.dust.burst(_ep.set(-15.2 + (Math.random() - 0.5), 3.4, -10.2 + (Math.random() - 0.5)), 1, 0x1c1c24, { speed: 1.2, life: 3.2, gravity: -1.1, size: 0.9, sizeVar: 0.5, alpha: 0.5, up: 1.4, spread: 0.3 });
      }
    }
  }

  return Object.assign(api, {
    solid, spawnPoints, pickupSpots, barrelSpots, gates, secret, update, PH, setLights, lightAt, sunAt,
    playerStart: { x: 0, z: 30, yaw: 0 },
    arenaEnter: (p) => p.z < 18.5 && Math.abs(p.x) < 19,
    exitReached: (p) => p.z < -26,
    exitPoint: { x: 0, y: PH, z: -24 },
    arenaCenter: { x: 0, y: 0, z: 6 },
    decorCorpses: corpses,
  });
}
