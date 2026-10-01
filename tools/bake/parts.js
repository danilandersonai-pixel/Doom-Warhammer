// Навесные детали из примитивов (рога, клинки, оружие, наплечники, глаза) — превращают CC0-модели в своих существ.
// Все размеры в метрах (бейкер компенсирует масштаб кости).
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.2, emissive: o.emissive || 0x000000, emissiveIntensity: o.glow ?? 1 });
const MAT = {
  iron: () => std(0x3a3c44, { metal: 0.6, rough: 0.5 }),
  steel: () => std(0x9aa2b0, { metal: 0.7, rough: 0.35 }),
  brass: () => std(0xc89a40, { metal: 0.7, rough: 0.4 }),
  bone: () => std(0xe0d4b4, { rough: 0.8 }),
  leather: () => std(0x4a2e1e),
  red: () => std(0x8e1a1a, { rough: 0.6 }),
  glowRed: () => std(0xff3010, { emissive: 0xff2a00, glow: 2.2 }),
  glowGreen: () => std(0x9cff40, { emissive: 0x7cff20, glow: 2 }),
  cloth: (c) => std(c, { rough: 0.95, metal: 0 }),
};
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r1, r2, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

// изогнутый рог: цепочка сужающихся конусов
function horn(len, r, curl, m) {
  const g = new THREE.Group();
  let p = g, n = 5;
  for (let i = 0; i < n; i++) {
    const seg = cyl(r * (1 - (i + 1) / (n + 0.6)), r * (1 - i / (n + 0.6)), len / n, m, 8);
    seg.position.y = len / n / 2;
    const j = new THREE.Group();
    j.position.y = i === 0 ? 0 : len / n;
    j.rotation.z = curl;
    j.add(seg);
    p.add(j);
    p = j;
  }
  return g;
}

export const PARTS = {
  // пара рогов на голову
  horns(a) {
    const g = new THREE.Group(), m = a.color ? std(a.color, { rough: 0.6 }) : MAT.bone();
    const L = a.len || 0.28, R = a.r || 0.05;
    for (const s of [-1, 1]) {
      const h = horn(L, R, -s * (a.curl ?? 0.32), m);
      h.position.set(s * (a.spread || 0.1), 0, 0);
      h.rotation.set(a.tilt ?? -0.2, 0, s * (a.out ?? -0.7));
      g.add(h);
    }
    return g;
  },
  // рваная юбка-балахон (открытый конус с зубчатым краем) — крепится к тазу
  skirt(a) {
    const h = a.h || 0.7, geo = new THREE.CylinderGeometry(a.top || 0.2, a.bottom || 0.36, h, 18, 3, true);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -h / 2 + 0.01) p.setY(i, y + ((i * 7919) % 5) * 0.035 - 0.05);   // рваный низ
    }
    geo.computeVertexNormals();
    const m = std(a.color || 0x6a1414, { rough: 0.95, metal: 0 });
    m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = -h / 2;
    const g = new THREE.Group();
    g.add(mesh);
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry((a.top || 0.2) * 1.02, 0.025, 6, 18), MAT.leather()), 0, -0.02, 0, Math.PI / 2));
    return g;
  },
  // светящиеся глаза
  eyes(a) {
    const g = new THREE.Group(), m = a.green ? MAT.glowGreen() : MAT.glowRed();
    for (const s of [-1, 1]) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(a.r || 0.025, 8, 6), m), s * (a.spread || 0.05), 0, 0));
    return g;
  },
  // тесак-серп культиста (держится в кулаке, лезвие вверх-вперёд)
  cleaver(a) {
    const g = new THREE.Group();
    g.add(at(cyl(0.022, 0.026, 0.26, MAT.leather()), 0, 0, 0));
    g.add(at(box(0.09, 0.03, 0.05, MAT.brass()), 0, 0.14, 0));
    const shape = new THREE.Shape();
    shape.moveTo(-0.03, 0); shape.lineTo(0.05, 0); shape.quadraticCurveTo(0.16, 0.25, 0.06, 0.55); shape.lineTo(0.0, 0.5); shape.quadraticCurveTo(0.06, 0.25, -0.03, 0.06);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), MAT.steel());
    blade.position.set(0, 0.15, -0.006);
    g.add(blade);
    // зубья
    for (let i = 0; i < 4; i++) g.add(at(box(0.03, 0.02, 0.014, MAT.iron()), -0.03, 0.22 + i * 0.07, 0, 0, 0, 0.6));
    return g;
  },
  // тяжёлое ружьё стрелка
  rifle(a) {
    const g = new THREE.Group();
    const red = std(a.color || 0x5a1414, { rough: 0.55, metal: 0.3 });
    g.add(at(box(0.09, 0.13, 0.5, red), 0, 0.02, 0.12));            // корпус
    g.add(at(box(0.07, 0.05, 0.42, MAT.iron()), 0, 0.1, 0.1));        // верх
    g.add(at(cyl(0.028, 0.028, 0.42, MAT.iron()), 0, 0.05, 0.55, Math.PI / 2));  // ствол
    g.add(at(cyl(0.04, 0.04, 0.08, MAT.brass()), 0, 0.05, 0.74, Math.PI / 2));   // дульный тормоз
    g.add(at(box(0.06, 0.16, 0.08, MAT.iron()), 0, -0.1, 0.18, 0.3));   // магазин
    g.add(at(box(0.05, 0.12, 0.06, MAT.leather()), 0, -0.07, -0.05, -0.4)); // рукоять
    g.add(at(box(0.1, 0.02, 0.5, MAT.brass()), 0, -0.05, 0.12));     // латунная полоса
    return g;
  },
  // наплечник с шипом
  pauldron(a) {
    const g = new THREE.Group();
    const m = a.color ? std(a.color, { metal: 0.5, rough: 0.5 }) : MAT.iron();
    const s = new THREE.Mesh(new THREE.SphereGeometry(a.r || 0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    s.scale.set(1, 0.8, 1.1);
    g.add(s);
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry((a.r || 0.14) * 0.98, 0.012, 6, 16), MAT.brass()), 0, 0.005, 0, Math.PI / 2));
    if (a.spike !== false) g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 8), MAT.bone()), 0, (a.r || 0.14) * 0.8, 0));
    return g;
  },
  // ряд шипов вдоль спины/плеч
  spikes(a) {
    const g = new THREE.Group(), m = a.color ? std(a.color) : MAT.bone();
    const n = a.n || 4;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(a.r || 0.04, a.len || 0.22, 6), m);
      c.position.set(((i - (n - 1) / 2) * (a.step || 0.1)), 0, 0);
      c.rotation.set(a.tilt ?? -0.5, 0, (i - (n - 1) / 2) * 0.25);
      g.add(c);
    }
    return g;
  },
  // маска-противогаз
  gasmask(a) {
    const g = new THREE.Group();
    const m = std(a.color || 0x2a2a2e, { rough: 0.6 });
    g.add(at(box(0.16, 0.12, 0.08, m), 0, 0, 0));
    for (const s of [-1, 1]) g.add(at(cyl(0.032, 0.032, 0.02, MAT.glowGreen(), 10), s * 0.045, 0.025, 0.045, Math.PI / 2));
    g.add(at(cyl(0.035, 0.045, 0.07, MAT.iron(), 8), 0, -0.05, 0.06, Math.PI / 2.4));
    return g;
  },
  // пушка-рука для колосса
  cannon(a) {
    const g = new THREE.Group(), red = std(0x6a1612, { metal: 0.4, rough: 0.5 });
    g.add(at(box(0.5, 0.5, 0.9, red), 0, 0, 0.2));
    for (const [x, y] of [[-0.12, 0.12], [0.12, 0.12], [-0.12, -0.12], [0.12, -0.12]]) g.add(at(cyl(0.08, 0.08, 0.9, MAT.iron(), 10), x, y, 0.85, Math.PI / 2));
    g.add(at(box(0.56, 0.08, 0.95, MAT.brass()), 0, 0.27, 0.2));
    return g;
  },
  // светящееся ядро
  core(a) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(a.r || 0.18, 14, 10), MAT.glowRed()));
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry((a.r || 0.18) * 1.15, 0.035, 8, 20), MAT.brass()), 0, 0, 0));
    return g;
  },
  // знамя на шесте за спиной
  banner(a) {
    const g = new THREE.Group();
    g.add(at(cyl(0.02, 0.02, a.h || 1.4, MAT.iron(), 6), 0, (a.h || 1.4) / 2, 0));
    g.add(at(box(0.5, 0.025, 0.025, MAT.brass()), 0, (a.h || 1.4) - 0.06, 0));
    const cloth = box(0.44, 0.7, 0.01, MAT.cloth(a.color || 0x6a1010));
    g.add(at(cloth, 0, (a.h || 1.4) - 0.43, 0.01));
    g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), std(0xd8c070)), 0, (a.h || 1.4) - 0.36, 0.018));
    return g;
  },
};
