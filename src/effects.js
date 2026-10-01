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

// ---------- Куски врагов (гибы): летят, отскакивают и лежат на полу ----------
export class Gibs {
  constructor(scene, textures, count = 90) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: textures[i % textures.length] });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.items.push({ s, vel: new THREE.Vector3(), life: 0, size: 0.3, spin: 0, rest: false });
    }
    this.next = 0;
  }

  // Разлёт кусков из точки p
  burst(p, count, power = 6, size = 0.32) {
    for (let n = 0; n < count; n++) {
      const g = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      g.s.position.set(p.x + (Math.random() - 0.5) * 0.5, p.y + Math.random() * 0.6, p.z + (Math.random() - 0.5) * 0.5);
      const a = Math.random() * Math.PI * 2, h = power * (0.3 + Math.random() * 0.7);
      g.vel.set(Math.cos(a) * h, power * (0.5 + Math.random() * 0.8), Math.sin(a) * h);
      g.size = size * (0.7 + Math.random() * 0.8);
      g.s.scale.set(g.size, g.size, 1);
      g.spin = (Math.random() - 0.5) * 14;
      g.life = 9 + Math.random() * 3;
      g.rest = false;
      g.s.visible = true;
    }
  }

  update(dt) {
    for (const g of this.items) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) { g.s.visible = false; continue; }
      if (!g.rest) {
        g.vel.y -= 18 * dt;
        g.s.position.addScaledVector(g.vel, dt);
        g.s.material.rotation += g.spin * dt;
        const lim = 19.7;
        g.s.position.x = Math.max(-lim, Math.min(lim, g.s.position.x));
        g.s.position.z = Math.max(-lim, Math.min(lim, g.s.position.z));
        const floorY = g.size * 0.35;
        if (g.s.position.y < floorY) {
          g.s.position.y = floorY;
          if (Math.abs(g.vel.y) < 2) { g.rest = true; }
          g.vel.y *= -0.35; g.vel.x *= 0.5; g.vel.z *= 0.5; g.spin *= 0.5;
        }
      }
      if (g.life < 1) { const k = g.size * g.life; g.s.scale.set(k, k, 1); } // исчезает, уменьшаясь
    }
  }

  clear() { for (const g of this.items) { g.life = 0; g.s.visible = false; } }
}

// ---------- Лужи крови на полу ----------
export class Decals {
  constructor(scene, textures, count = 40) {
    const mats = textures.map((map) => new THREE.MeshLambertMaterial({
      map, transparent: true, alphaTest: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      m.visible = false;
      scene.add(m);
      this.items.push(m);
    }
    this.next = 0;
  }

  add(x, z, size) {
    const m = this.items[this.next];
    m.position.set(x, 0.01 + (this.next % 10) * 0.001, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.set(size, 1, size);
    m.visible = true;
    this.next = (this.next + 1) % this.items.length;
  }

  clear() { for (const m of this.items) m.visible = false; }
}

// ---------- Пиксельные взрывы (анимированные спрайты) ----------
export class Explosions {
  constructor(scene, atlas, count = 16) {
    this.frames = atlas.frames;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const map = atlas.texture.clone();
      map.repeat.set(1 / atlas.frames, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: false, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, map, t: -1, dur: 0.3 });
    }
    this.next = 0;
  }

  spawn(p, size = 1, dur = 0.3) {
    const e = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    e.s.position.copy(p);
    e.s.scale.set(size, size, 1);
    e.s.material.rotation = Math.floor(Math.random() * 4) * Math.PI / 2;
    e.t = 0;
    e.dur = dur;
    e.s.visible = true;
    e.map.offset.x = 0;
  }

  update(dt) {
    for (const e of this.items) {
      if (e.t < 0) continue;
      e.t += dt;
      const f = Math.floor((e.t / e.dur) * this.frames);
      if (f >= this.frames) { e.t = -1; e.s.visible = false; continue; }
      e.map.offset.x = f / this.frames;
    }
  }

  clear() { for (const e of this.items) { e.t = -1; e.s.visible = false; } }
}
