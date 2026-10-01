// Визуальные эффекты: частицы (пул точек), трассеры выстрелов.
// Все объекты создаются один раз и переиспользуются — никакого мусора в каждом кадре.
import * as THREE from 'three';

// Система частиц на одном THREE.Points — один draw call на все частицы
export class Particles {
  constructor(scene, max = 400, { size = 0.12, additive = false } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.clear();
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000; // прячем под пол
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  // Выброс частиц из точки. dir — преимущественное направление (необязательно)
  burst(p, count, color, { speed = 4, life = 0.6, gravity = 9, dir = null, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const k = i * 3;
      this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
      // случайное направление + сдвиг в сторону dir
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      vx *= spread; vy *= spread; vz *= spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * (0.4 + Math.random() * 0.6);
      const len = Math.hypot(vx, vy, vz) || 1;
      this.vel[k] = (vx / len) * s; this.vel[k + 1] = (vy / len) * s; this.vel[k + 2] = (vz / len) * s;
      const shade = 0.7 + Math.random() * 0.3;
      this.col[k] = c.r * shade; this.col[k + 1] = c.g * shade; this.col[k + 2] = c.b * shade;
      this.life[i] = life * (0.5 + Math.random() * 0.5);
      this.grav[i] = gravity;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[k + 1] = -1000; continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.03) { // отскок от пола
        this.pos[k + 1] = 0.03;
        this.vel[k + 1] *= -0.3;
        this.vel[k] *= 0.6; this.vel[k + 2] *= 0.6;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Трассеры: короткие светящиеся "лучи" от ствола до точки попадания
export class Tracers {
  constructor(scene, count = 8) {
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    geo.translate(0, 0, 0.5); // начало в нуле, тянется вдоль +Z
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.items.push({ mesh: m, life: 0 });
    }
    this.next = 0;
  }

  fire(from, to) {
    const t = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, from.distanceTo(to));
    t.mesh.visible = true;
    t.life = 0.06;
  }

  update(dt) {
    for (const t of this.items) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.06);
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  clear() { for (const t of this.items) { t.life = 0; t.mesh.visible = false; } }
}
