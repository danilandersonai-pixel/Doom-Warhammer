// Арена 40×40 м в стиле ретро-шутера: пиксельные текстуры, витражи, знамёна, жаровни с огнём.
// Всё собрано из коробок и плоскостей, текстуры рисуются кодом (см. sprites.js).
import * as THREE from 'three';
import { makeCanvas, pixelTexture, rng, fireAtlas } from './sprites.js';

export const ARENA_HALF = 20;

// --- Пиксельные текстуры 64×64 ---
function tex(draw, seed, size = 64) {
  const c = makeCanvas(size, size);
  draw(c.getContext('2d'), size, rng(seed));
  return pixelTexture(c, true);
}
const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

// Пол: тёсаные каменные плиты с фаской и трещинами
function drawFloor(g, s, R) {
  const tones = ['#3a3430', '#4a423c', '#564d45'];
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const x0 = tx * 32, y0 = ty * 32;
    px(g, tones[(tx + ty * 2 + 1) % 3], x0, y0, 32, 32);
    for (let i = 0; i < 70; i++) px(g, R() < 0.5 ? '#2e2824' : '#5e544a', x0 + 1 + R() * 30 | 0, y0 + 1 + R() * 30 | 0);
    px(g, '#6a6056', x0 + 1, y0 + 1, 30, 1); px(g, '#6a6056', x0 + 1, y0 + 1, 1, 30); // светлая фаска
    px(g, '#221c18', x0, y0 + 31, 32, 1); px(g, '#221c18', x0 + 31, y0, 1, 32);       // шов
  }
  // трещина
  let x = 10, y = 40;
  for (let i = 0; i < 14; i++) { px(g, '#1a1412', x, y); x += R() < 0.6 ? 1 : 0; y += R() < 0.7 ? 1 : -1; }
}

// Стены: крупная кладка с подсветкой граней и мхом
function drawBricks(g, s, R) {
  px(g, '#1e1a1c', 0, 0, s, s);
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * 8;
    for (let c = -1; c < 4; c++) {
      const x = c * 16 + off, y = r * 8;
      const base = ['#4a4448', '#544c50', '#3e3a3e'][(R() * 3) | 0];
      px(g, base, x + 1, y + 1, 15, 7);
      px(g, '#6a6266', x + 1, y + 1, 15, 1);
      px(g, '#2a2628', x + 1, y + 7, 15, 1);
      if (R() < 0.3) px(g, '#2e2a2c', x + 3 + R() * 10 | 0, y + 3, 2, 2);
    }
  }
  for (let i = 0; i < 25; i++) px(g, R() < 0.5 ? '#3a4a2a' : '#2a3820', R() * s | 0, 56 + R() * 8 | 0); // мох внизу
}

// Металл: клёпаные пластины с ржавчиной (ящики, жаровни)
function drawMetal(g, s, R) {
  px(g, '#3a3634', 0, 0, s, s);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = i * 32, y = j * 32;
    px(g, '#4a4440', x + 2, y + 2, 28, 28);
    px(g, '#5e5650', x + 2, y + 2, 28, 1);
    px(g, '#26221e', x + 2, y + 29, 28, 1);
    for (const [rx, ry] of [[4, 4], [26, 4], [4, 26], [26, 26]]) { px(g, '#7a7068', x + rx, y + ry, 2, 2); px(g, '#1e1a18', x + rx + 1, y + ry + 1); }
    for (let k = 0; k < 18; k++) px(g, R() < 0.5 ? '#6a3a1a' : '#4a2a14', x + 2 + R() * 28 | 0, y + 10 + R() * 20 | 0);
  }
  px(g, '#8a6a2a', 0, 30, s, 2); // латунная полоса
}

// Готическое окно-витраж со стрельчатой аркой (прозрачное вокруг)
function drawWindow(g, w, h) {
  const cx = w / 2;
  const inside = (x, y, inset) => {
    const r = cx - inset;
    if (y > h - 2 - inset || x < inset || x > w - inset) return false;
    if (y >= r * 1.2 + inset) return true;
    // стрельчатая арка из двух дуг
    const yy = r * 1.2 + inset - y;
    const d1 = Math.hypot(x - (inset + r * 1.6), yy), d2 = Math.hypot(x - (w - inset - r * 1.6), yy);
    return x < cx ? d1 < r * 1.6 : d2 < r * 1.6;
  };
  const R = rng(11);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x + 0.5, y + 0.5, 0)) continue;
    let c = '#2a2426';                                  // каменная рама
    if (inside(x + 0.5, y + 0.5, 2)) {
      // стекло: тёплые цвета, свинцовые переплёты
      const lead = x % 6 === 0 || y % 8 === 0 || Math.abs(x - cx + 0.5) < 0.6;
      const hue = ['#ff9a30', '#e05a20', '#ffd060', '#c03018', '#ff7a20'][(Math.floor(x / 6) + Math.floor(y / 8) * 3 + (R() < 0.1 ? 1 : 0)) % 5];
      c = lead ? '#1a1012' : hue;
    }
    px(g, c, x, y);
  }
}

// Знамя: багровое полотно, золотая кайма, простая эмблема-пламя, рваный низ
function drawBanner(g, w, h) {
  px(g, '#6a1010', 0, 0, w, h - 4);
  px(g, '#8a1a16', 2, 0, w - 4, h - 4);
  px(g, '#c09a40', 0, 0, w, 2);
  px(g, '#c09a40', 0, 0, 1, h - 4); px(g, '#c09a40', w - 1, 0, 1, h - 4);
  for (let x = 0; x < w; x += 4) px(g, '#6a1010', x, h - 4, 2, 2 + (x % 8 ? 2 : 0)); // бахрома
  // эмблема: пламя в ромбе
  const cx = w / 2 | 0, cy = h / 2 | 0;
  for (let y = -7; y <= 7; y++) { const k = 7 - Math.abs(y); px(g, '#c09a40', cx - k, cy + y, k * 2, 1); }
  for (let y = -5; y <= 5; y++) { const k = 5 - Math.abs(y); px(g, '#3a0808', cx - k, cy + y, k * 2, 1); }
  px(g, '#ffb020', cx - 1, cy - 3, 2, 6); px(g, '#ff6010', cx - 2, cy, 4, 3); px(g, '#fff0a0', cx - 1, cy + 1, 2, 1);
}

// Коробка с UV по размеру — текстура не растягивается на больших блоках
function boxGeo(w, h, d, texScale = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / texScale, (uv.getY(k) * dims[f][1]) / texScale);
  }
  return g;
}

export function buildArena(scene) {
  const colliders = [];
  const solidMeshes = [];

  // --- Небо: багровое зарево у горизонта, ступенчатый градиент как в старых играх ---
  const FOG_COLOR = 0x4a1c18;
  scene.background = new THREE.Color(FOG_COLOR);
  const skyGeo = new THREE.SphereGeometry(100, 24, 16);
  const bands = [0xd0602a, 0x9a3420, 0x6a1c1a, 0x401018, 0x240a14, 0x12060c];
  const colors = [];
  const p = skyGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, p.getY(i) / 100);
    const c = new THREE.Color(bands[Math.min(bands.length - 1, Math.floor(h * 9))]);
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  scene.fog = new THREE.Fog(FOG_COLOR, 14, 70);

  // --- Свет: холодная "луна" + тёплые жаровни (ниже) ---
  scene.add(new THREE.HemisphereLight(0x9a8aa8, 0x2a1810, 1.1));
  const moon = new THREE.DirectionalLight(0x8aa0d8, 1.1);
  moon.position.set(-8, 20, 10);
  scene.add(moon);

  // --- Материалы ---
  const floorTex = tex(drawFloor, 1);
  floorTex.repeat.set(14, 14);
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
  const wallTex = tex(drawBricks, 2);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const darkMat = new THREE.MeshLambertMaterial({ map: wallTex, color: 0x9a8a90 });
  const metalMat = new THREE.MeshLambertMaterial({ map: tex(drawMetal, 3) });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  solidMeshes.push(floor);

  function block(x, z, w, h, d, mat = wallMat, collide = true, y = 0) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    scene.add(m);
    if (collide) {
      solidMeshes.push(m);
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: y + h });
    }
    return m;
  }

  // --- Внешние стены ---
  const H = ARENA_HALF, WH = 8;
  block(0, -H - 0.5, H * 2 + 2, WH, 1);
  block(0, H + 0.5, H * 2 + 2, WH, 1);
  block(-H - 0.5, 0, 1, WH, H * 2);
  block(H + 0.5, 0, 1, WH, H * 2);

  // Контрфорсы с "шапками"
  for (let i = -16; i <= 16; i += 8) {
    for (const [x, z, w, d] of [[i, -H + 0.45, 1.4, 0.9], [i, H - 0.45, 1.4, 0.9], [-H + 0.45, i, 0.9, 1.4], [H - 0.45, i, 0.9, 1.4]]) {
      block(x, z, w, 9.5, d, darkMat);
      block(x, z, w + 0.3, 0.4, d + 0.3, metalMat, false, 9.5);
    }
  }

  // Зубцы — InstancedMesh (один вызов отрисовки)
  const merlons = [];
  for (let i = -19; i <= 19; i += 2.5) merlons.push([i, -H - 0.5], [i, H + 0.5], [-H - 0.5, i], [H + 0.5, i]);
  const merlonMesh = new THREE.InstancedMesh(boxGeo(1, 1.2, 1), darkMat, merlons.length);
  const mtx = new THREE.Matrix4();
  merlons.forEach(([x, z], i) => merlonMesh.setMatrixAt(i, mtx.makeTranslation(x, WH + 0.6, z)));
  scene.add(merlonMesh);

  // --- Витражи между контрфорсами (светятся сами — MeshBasic) ---
  const wc = makeCanvas(32, 64);
  drawWindow(wc.getContext('2d'), 32, 64);
  const winMat = new THREE.MeshBasicMaterial({ map: pixelTexture(wc), alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
  const winGeo = new THREE.PlaneGeometry(2.6, 5.2);
  for (let i = -12; i <= 12; i += 8) {
    for (const [x, z, ry] of [[i, -H + 0.01, 0], [i, H - 0.01, Math.PI], [-H + 0.01, i, Math.PI / 2], [H - 0.01, i, -Math.PI / 2]]) {
      const m = new THREE.Mesh(winGeo, winMat);
      m.position.set(x, 4.2, z);
      m.rotation.y = ry;
      scene.add(m);
    }
  }

  // --- Шпили снаружи ---
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x1a1214 });
  const cone = new THREE.ConeGeometry(1.8, 7, 4);
  for (const [x, z, h] of [[-24, -24, 18], [24, -24, 15], [-24, 24, 14], [24, 24, 19], [0, -32, 26], [-34, 4, 17], [33, -6, 21], [6, 33, 16]]) {
    block(x, z, 3.4, h, 3.4, spireMat, false);
    const c = new THREE.Mesh(cone, spireMat);
    c.position.set(x, h + 3.5, z);
    c.rotation.y = Math.PI / 4;
    scene.add(c);
  }

  // --- Укрытия ---
  block(0, 0, 3, 1.2, 3, darkMat);                   // алтарь
  block(0, 0, 2, 0.3, 2, metalMat, false, 1.2);
  block(-8, -8, 1.4, 6, 1.4);                         // колонны
  block(8, 8, 1.4, 6, 1.4);
  block(8, -8, 1.4, 2.2, 1.4);                        // разрушенные колонны
  block(-8, 8, 1.4, 2.6, 1.4);
  block(-12, 0, 0.8, 1.4, 6);
  block(12, 0, 0.8, 1.4, 6);
  block(0, -12, 6, 1.4, 0.8);
  block(0, 12, 6, 1.4, 0.8);
  block(-14, -12, 4, 3, 0.8);
  block(14, 12, 4, 3, 0.8);
  block(-14, 13, 0.8, 2.5, 4);
  block(14, -13, 0.8, 2.5, 4);
  block(-5, -15, 1.4, 1.4, 1.4, metalMat);            // ящики
  block(6, 15.5, 1.4, 1.4, 1.4, metalMat);
  block(16, -3, 1.4, 1.4, 1.4, metalMat);
  block(-16, 4, 1.4, 1.4, 1.4, metalMat);
  block(5, -5, 1.2, 1.0, 1.2, metalMat);

  // --- Знамёна на целых колоннах и обломках стен ---
  const bc = makeCanvas(20, 48);
  drawBanner(bc.getContext('2d'), 20, 48);
  const bannerMat = new THREE.MeshLambertMaterial({ map: pixelTexture(bc), alphaTest: 0.5, side: THREE.DoubleSide });
  const bannerGeo = new THREE.PlaneGeometry(1.1, 2.6);
  for (const [x, y, z, ry] of [[-8, 4.4, -7.28, 0], [8, 4.4, 8.72, 0], [-8, 4.4, -8.72, Math.PI], [8, 4.4, 7.28, Math.PI], [-14, 1.7, -11.58, 0], [14, 1.7, 12.42, 0]]) {
    const m = new THREE.Mesh(bannerGeo, bannerMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  }

  // --- Жаровни: чаша + анимированный огонь + мерцающий свет ---
  const fire = fireAtlas();
  const braziers = [];
  const bowlMat = metalMat;
  for (const [x, z] of [[-10.5, -10.5], [10.5, 10.5], [-10.5, 10.5], [10.5, -10.5]]) {
    block(x, z, 0.5, 0.9, 0.5, bowlMat);
    block(x, z, 1.0, 0.35, 1.0, bowlMat, false, 0.9);
    const map = fire.texture.clone();
    map.repeat.set(1 / fire.frames, 1);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: false }));
    flame.scale.set(0.9, 1.35, 1);
    flame.position.set(x, 1.85, z);
    scene.add(flame);
    const light = new THREE.PointLight(0xff8a30, 18, 13, 1.6);
    light.position.set(x, 2.2, z);
    scene.add(light);
    braziers.push({ map, light, phase: Math.random() * 10 });
  }

  // Мусор на полу
  const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkMat, 40);
  const dummy = new THREE.Object3D();
  const R = rng(5);
  for (let i = 0; i < 40; i++) {
    const s = 0.15 + R() * 0.35;
    dummy.scale.set(s * (1 + R()), s, s * (1 + R()));
    dummy.position.set((R() - 0.5) * 38, s / 2 - 0.05, (R() - 0.5) * 38);
    dummy.rotation.set(R() * 0.5, R() * 3, R() * 0.5);
    dummy.updateMatrix();
    rubble.setMatrixAt(i, dummy.matrix);
  }
  scene.add(rubble);

  const spawnPoints = [
    [-17, -17], [0, -17.5], [17, -17], [17.5, 0], [17, 17], [0, 17.5], [-17, 17], [-17.5, 0],
    [-9, -17], [9, 17], [17, 9], [-17, -9],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  // Анимация огня: кадры сменяются 10 раз в секунду, свет мерцает
  function update(time) {
    for (const b of braziers) {
      const f = Math.floor(time * 10 + b.phase) % fire.frames;
      b.map.offset.x = f / fire.frames;
      b.light.intensity = 16 + Math.sin(time * 13 + b.phase) * 3 + Math.sin(time * 7.3 + b.phase * 2) * 2;
    }
  }

  return { colliders, solidMeshes, spawnPoints, update };
}
