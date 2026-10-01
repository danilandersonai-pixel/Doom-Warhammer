// Арена 40×40 м: пол, стены, укрытия, шпили на горизонте, небо и туман.
// Всё собрано из простых коробок, текстуры рисуются на canvas.
import * as THREE from 'three';

export const ARENA_HALF = 20; // половина размера арены

// Рисуем текстуру на canvas
function makeTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Случайные пятна — "грязь" на камне
function grime(g, s, count, base) {
  for (let i = 0; i < count; i++) {
    const v = base + Math.random() * 40 - 20;
    g.fillStyle = `rgba(${v | 0},${(v - 5) | 0},${(v - 10) | 0},0.35)`;
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
}

// Каменные плиты пола (2×2 плиты на текстуру)
function drawFloor(g, s) {
  g.fillStyle = '#4a433e';
  g.fillRect(0, 0, s, s);
  grime(g, s, 1800, 70);
  g.strokeStyle = '#1c1816';
  g.lineWidth = 5;
  g.strokeRect(0, 0, s / 2, s / 2);
  g.strokeRect(s / 2, 0, s / 2, s / 2);
  g.strokeRect(0, s / 2, s / 2, s / 2);
  g.strokeRect(s / 2, s / 2, s / 2, s / 2);
  // трещины
  g.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += Math.random() * 30 - 15; y += Math.random() * 30 - 15; g.lineTo(x, y); }
    g.stroke();
  }
}

// Кирпичная кладка для стен
function drawBricks(g, s) {
  g.fillStyle = '#3e3936';
  g.fillRect(0, 0, s, s);
  const rows = 8, h = s / rows, w = s / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * w / 2;
    for (let c = -1; c < 5; c++) {
      const v = 55 + Math.random() * 25;
      g.fillStyle = `rgb(${v | 0},${(v - 6) | 0},${(v - 10) | 0})`;
      g.fillRect(c * w + off + 2, r * h + 2, w - 4, h - 4);
    }
  }
  grime(g, s, 900, 50);
}

// Коробка, у которой UV растянуты по размеру — текстура не "плывёт" на больших блоках
function boxGeo(w, h, d, texScale = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / texScale, (uv.getY(k) * dims[f][1]) / texScale);
    }
  }
  return g;
}

export function buildArena(scene) {
  const colliders = [];   // для движения и снарядов
  const solidMeshes = []; // для лучей выстрелов

  // --- Небо: купол с вертикальным градиентом, у горизонта цвет совпадает с туманом ---
  const FOG_COLOR = 0x3a2624;
  scene.background = new THREE.Color(FOG_COLOR);
  const skyGeo = new THREE.SphereGeometry(100, 24, 12);
  const top = new THREE.Color(0x0a0608), mid = new THREE.Color(0x26141a), hor = new THREE.Color(FOG_COLOR);
  const colors = [];
  const p = skyGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, p.getY(i) / 100); // 0 у горизонта, 1 в зените
    const c = h < 0.25 ? hor.clone().lerp(mid, h / 0.25) : mid.clone().lerp(top, (h - 0.25) / 0.75);
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  // Зарево на горизонте — пара светящихся колец (пожары вдали)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7a2a14, transparent: true, opacity: 0.35, fog: false, side: THREE.BackSide, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(95, 95, 12, 24, 1, true), glowMat);
  glow.position.y = 2;
  scene.add(glow);
  scene.fog = new THREE.Fog(FOG_COLOR, 6, 44);

  // --- Свет: всего два источника, без теней (для скорости на телефоне) ---
  scene.add(new THREE.HemisphereLight(0xa8909a, 0x2a1c14, 1.4));
  const sun = new THREE.DirectionalLight(0xffb880, 1.8);
  sun.position.set(12, 20, 6);
  scene.add(sun);

  // --- Материалы ---
  const floorTex = makeTexture(drawFloor);
  floorTex.repeat.set(10, 10);
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
  const wallTex = makeTexture(drawBricks);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const darkMat = new THREE.MeshLambertMaterial({ map: wallTex, color: 0x8a7a70 });
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x3a3430 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x55402c });

  // Пол
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  solidMeshes.push(floor);

  // Добавить блок (x,z — центр, w/h/d — размеры, y — высота основания)
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

  // --- Внешние стены (высота 7) ---
  const H = ARENA_HALF, WH = 7;
  block(0, -H - 0.5, H * 2 + 2, WH, 1);
  block(0, H + 0.5, H * 2 + 2, WH, 1);
  block(-H - 0.5, 0, 1, WH, H * 2);
  block(H + 0.5, 0, 1, WH, H * 2);

  // Контрфорсы вдоль стен + зубцы сверху — "готический" силуэт
  for (let i = -16; i <= 16; i += 8) {
    block(i, -H + 0.35, 1.2, 8.5, 0.7, darkMat);
    block(i, H - 0.35, 1.2, 8.5, 0.7, darkMat);
    block(-H + 0.35, i, 0.7, 8.5, 1.2, darkMat);
    block(H - 0.35, i, 0.7, 8.5, 1.2, darkMat);
  }
  // Зубцы на стенах — один InstancedMesh вместо десятков отдельных объектов (быстрее на телефоне)
  const merlons = [];
  for (let i = -19; i <= 19; i += 2.5) {
    merlons.push([i, -H - 0.5], [i, H + 0.5], [-H - 0.5, i], [H + 0.5, i]);
  }
  const merlonMesh = new THREE.InstancedMesh(boxGeo(1, 1, 1), darkMat, merlons.length);
  const mtx = new THREE.Matrix4();
  merlons.forEach(([x, z], i) => merlonMesh.setMatrixAt(i, mtx.makeTranslation(x, WH + 0.5, z)));
  scene.add(merlonMesh);

  // --- Шпили снаружи арены (декорация, видны сквозь туман) ---
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x2a2020 });
  const cone = new THREE.ConeGeometry(1.6, 6, 4);
  const spires = [[-23, -23, 16], [23, -23, 13], [-23, 23, 12], [23, 23, 17], [0, -30, 22], [-32, 4, 15], [31, -6, 19], [6, 31, 14]];
  for (const [x, z, h] of spires) {
    block(x, z, 3, h, 3, spireMat, false);
    const c = new THREE.Mesh(cone, spireMat);
    c.position.set(x, h + 3, z);
    c.rotation.y = Math.PI / 4;
    scene.add(c);
  }

  // --- Укрытия внутри арены ---
  block(0, 0, 3, 1.2, 3, darkMat);                 // центральный алтарь
  block(0, 0, 1.2, 0.6, 1.2, metalMat, false, 1.2); // верх алтаря (декор)
  block(-8, -8, 1.4, 5, 1.4);                       // колонны
  block(8, 8, 1.4, 5, 1.4);
  block(8, -8, 1.4, 2.2, 1.4);                      // разрушенные колонны
  block(-8, 8, 1.4, 2.6, 1.4);
  block(-12, 0, 0.8, 1.4, 6);                       // низкие стенки
  block(12, 0, 0.8, 1.4, 6);
  block(0, -12, 6, 1.4, 0.8);
  block(0, 12, 6, 1.4, 0.8);
  block(-14, -12, 4, 3, 0.8);                       // обломки стен
  block(14, 12, 4, 3, 0.8);
  block(-14, 13, 0.8, 2.5, 4);
  block(14, -13, 0.8, 2.5, 4);
  block(-5, -15, 1.4, 1.4, 1.4, crateMat);          // ящики
  block(6, 15.5, 1.4, 1.4, 1.4, crateMat);
  block(16, -3, 1.4, 1.4, 1.4, crateMat);
  block(-16, 4, 1.4, 1.4, 1.4, crateMat);
  block(5, -5, 1.2, 1.0, 1.2, crateMat);

  // Мелкий мусор на полу (без столкновений, тоже одним InstancedMesh)
  const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkMat, 40);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 40; i++) {
    const s = 0.15 + Math.random() * 0.35;
    dummy.scale.set(s * (1 + Math.random()), s, s * (1 + Math.random()));
    dummy.position.set((Math.random() - 0.5) * 38, s / 2 - 0.05, (Math.random() - 0.5) * 38);
    dummy.rotation.set(Math.random() * 0.5, Math.random() * 3, Math.random() * 0.5);
    dummy.updateMatrix();
    rubble.setMatrixAt(i, dummy.matrix);
  }
  scene.add(rubble);

  // Точки появления врагов — у краёв арены
  const spawnPoints = [
    [-17, -17], [0, -17.5], [17, -17], [17.5, 0], [17, 17], [0, 17.5], [-17, 17], [-17.5, 0],
    [-9, -17], [9, 17], [17, 9], [-17, -9],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  return { colliders, solidMeshes, spawnPoints };
}
