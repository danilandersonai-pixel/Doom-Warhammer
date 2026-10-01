// Эффекты: частицы разного размера, куски-гибы, декали крови (пол и стены), пиксельные взрывы,
// пул точечных огней для вспышек, снегопад, луч термокопья, трассеры.
// Всё создаётся один раз и переиспользуется (пулы) — в бою нет новых объектов.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, haloCanvas } from './art_misc.js';

// ---------- Частицы: свой простой шейдер, у каждой частицы свой размер ----------
export class Particles {
  constructor(scene, max = 700, { additive = false } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 }, ...THREE.UniformsLib.fog },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vCol; uniform float scale;
        #include <fog_pars_vertex>
        void main() {
          vCol = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          if (vCol.a < 0.01) discard;
          gl_FragColor = vCol;
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.clear();
  }

  setScale(h) { this.material.uniforms.scale.value = h * 0.6; }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // Выброс частиц. size — размер в метрах (± разброс), dir — направление
  burst(p, count, color, { speed = 4, life = 0.7, gravity = 9, dir = null, spread = 1, size = 0.08, sizeVar = 0.6, alpha = 1, up = 0 } = {}) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const k = i * 3;
      this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
      let vx = (Math.random() * 2 - 1) * spread, vy = (Math.random() * 2 - 1) * spread + up, vz = (Math.random() * 2 - 1) * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * (0.3 + Math.random() * 0.7), len = Math.hypot(vx, vy, vz) || 1;
      this.vel[k] = (vx / len) * s; this.vel[k + 1] = (vy / len) * s; this.vel[k + 2] = (vz / len) * s;
      const shade = 0.75 + Math.random() * 0.25;
      this.col[i * 4] = c.r * shade; this.col[i * 4 + 1] = c.g * shade; this.col[i * 4 + 2] = c.b * shade; this.col[i * 4 + 3] = alpha;
      this.size[i] = size * (1 - sizeVar / 2 + Math.random() * sizeVar);
      this.life[i] = this.life0[i] = life * (0.5 + Math.random() * 0.5);
      this.grav[i] = gravity;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02 && this.grav[i] > 0 && this.pos[k + 1] > -1) {
        this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.2; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5;
      }
      const t = this.life[i] / this.life0[i];
      if (t < 0.3) this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], t / 0.3);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true;
    g.color.needsUpdate = true;
    g.size.needsUpdate = true;
  }
}

// ---------- Пул точечных огней: вспышки выстрелов и взрывов подсвечивают окружение ----------
export class LightPool {
  constructor(scene, count = 4) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 12, 1.6);
      scene.add(l);
      this.items.push({ l, t: 0, dur: 1, peak: 0 });
    }
    this.next = 0;
  }

  flash(p, color = 0xffa040, peak = 30, dur = 0.08, dist = 12) {
    // берём самый "слабый" огонь
    let best = this.items[0];
    for (const it of this.items) if (it.t <= 0 || it.peak * (it.t / it.dur) < best.peak * (best.t / best.dur)) best = it;
    best.l.position.set(p.x, p.y, p.z);
    best.l.color.set(color);
    best.l.distance = dist;
    best.t = best.dur = dur;
    best.peak = peak;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.t <= 0) { it.l.intensity = 0; continue; }
      it.t -= dt;
      it.l.intensity = Math.max(0, it.peak * (it.t / it.dur));
    }
  }

  clear() { for (const it of this.items) { it.t = 0; it.l.intensity = 0; } }
}

// ---------- Ореолы: дешёвая имитация свечения (аддитивные спрайты) ----------
export class Halos {
  constructor(scene, count = 24) {
    this.items = [];
    const tex = new THREE.CanvasTexture(haloCanvas('255,255,255', 64));
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, t: 0, dur: 1, size: 1 });
    }
    this.next = 0;
  }

  spawn(p, color, size, dur = 0.1) {
    const h = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    h.s.position.set(p.x, p.y, p.z);
    h.s.material.color.set(color);
    h.t = h.dur = dur;
    h.size = size;
    h.s.visible = true;
  }

  update(dt) {
    for (const h of this.items) {
      if (h.t <= 0) continue;
      h.t -= dt;
      if (h.t <= 0) { h.s.visible = false; continue; }
      const k = h.t / h.dur;
      h.s.scale.set(h.size * (0.6 + k * 0.4), h.size * (0.6 + k * 0.4), 1);
      h.s.material.opacity = k;
    }
  }

  clear() { for (const h of this.items) { h.t = 0; h.s.visible = false; } }
}

// ---------- Куски (гибы): летят, отскакивают, лежат до конца уровня (до лимита) ----------
export class Gibs {
  constructor(scene, count = 120) {
    const art = miscArt();
    const textures = art.gibs.map((c) => nearestTexture(c));
    this.items = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[i % textures.length] }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, vel: new THREE.Vector3(), active: false, rest: false, size: 0.3, spin: 0, floor: 0 });
    }
    this.next = 0;
  }

  burst(p, count, power = 6, size = 0.3, floorY = 0) {
    for (let n = 0; n < count; n++) {
      const g = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      g.s.position.set(p.x + (Math.random() - 0.5) * 0.4, p.y + Math.random() * 0.5, p.z + (Math.random() - 0.5) * 0.4);
      const a = Math.random() * Math.PI * 2, h = power * (0.3 + Math.random() * 0.7);
      g.vel.set(Math.cos(a) * h, power * (0.5 + Math.random() * 0.8), Math.sin(a) * h);
      g.size = size * (0.6 + Math.random() * 0.9);
      g.s.scale.set(g.size, g.size, 1);
      g.spin = (Math.random() - 0.5) * 16;
      g.active = true;
      g.rest = false;
      g.floor = floorY;
      g.s.visible = true;
    }
  }

  update(dt, world) {
    for (const g of this.items) {
      if (!g.active || g.rest) continue;
      g.vel.y -= 20 * dt;
      g.s.position.addScaledVector(g.vel, dt);
      g.s.material.rotation += g.spin * dt;
      const p = g.s.position;
      const floor = world ? world.groundAt(p.x, p.z, p.y + 0.3, 0.05) : g.floor;
      if (p.y < floor + g.size * 0.3) {
        p.y = floor + g.size * 0.3;
        if (Math.abs(g.vel.y) < 2.5) g.rest = true;
        g.vel.y *= -0.3; g.vel.x *= 0.45; g.vel.z *= 0.45; g.spin *= 0.4;
      }
      if (p.y < -30) { g.active = false; g.s.visible = false; }
    }
  }

  clear() { for (const g of this.items) { g.active = false; g.s.visible = false; } }
}

// ---------- Декали: кровь на полу и стенах, копоть от взрывов ----------
export class Decals {
  constructor(scene, count = 70) {
    const art = miscArt();
    const mk = (c) => new THREE.MeshLambertMaterial({ map: nearestTexture(c), transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.blood = art.splats.map(mk);
    this.scorch = mk(art.scorch);
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, this.blood[0]);
      m.visible = false;
      scene.add(m);
      this.items.push(m);
    }
    this.next = 0;
    this.tmp = new THREE.Vector3();
  }

  // Декаль на поверхности: point — точка, normal — нормаль поверхности
  add(point, normal, size, kind = 'blood') {
    const m = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    m.material = kind === 'scorch' ? this.scorch : this.blood[(Math.random() * this.blood.length) | 0];
    m.position.copy(point).addScaledVector(normal, 0.015 + (this.next % 7) * 0.002);
    m.lookAt(this.tmp.copy(m.position).add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.set(size, size, 1);
    m.visible = true;
  }

  floor(x, y, z, size, kind) { this.add(this.tmp.set(x, y, z).clone(), new THREE.Vector3(0, 1, 0), size, kind); }

  clear() { for (const m of this.items) m.visible = false; }
}

// ---------- Пиксельные взрывы: кадры спрайта + свет + ореол + угольки ----------
export class Explosions {
  constructor(scene, fx, count = 14) {
    const art = miscArt().explosion;
    this.frames = art.count;
    this.fx = fx;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const map = nearestTexture(art.canvas);
      map.repeat.set(1 / art.count, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, map, t: -1, dur: 0.6 });
    }
    this.next = 0;
  }

  spawn(p, size = 3, dur = 0.65) {
    const e = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    e.s.position.set(p.x, p.y + size * 0.15, p.z);
    e.s.scale.set(size, size, 1);
    e.s.material.rotation = Math.floor(Math.random() * 4) * Math.PI / 2;
    e.t = 0;
    e.dur = dur;
    e.s.visible = true;
    e.map.offset.x = 0;
    this.fx.lights.flash(p, 0xff9030, 40 * size, 0.35, 6 + size * 3);
    this.fx.halos.spawn({ x: p.x, y: p.y + 0.3, z: p.z }, 0xffa040, size * 2.2, 0.3);
    this.fx.sparks.burst(p, 18, 0xffb040, { speed: 7, life: 0.9, gravity: 6, size: 0.07, up: 0.6 });   // угольки
    this.fx.dust.burst(p, 10, 0x5a5560, { speed: 2, life: 1.4, gravity: -0.6, size: 0.5, alpha: 0.6 }); // дым
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

// ---------- Снегопад: пиксельные хлопья вокруг камеры ----------
export class Snowfall {
  constructor(scene, count = 900) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 50;
      this.pos[i * 3 + 1] = Math.random() * 20;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.drift[i] = Math.random() * 6.28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, cam, time) {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k + 1] -= dt * (1.2 + (i % 5) * 0.25);
      this.pos[k] += Math.sin(time * 0.7 + this.drift[i]) * dt * 0.6 + dt * 0.5;
      // держим хлопья в кубе 50×20×50 вокруг камеры
      if (this.pos[k + 1] < cam.y - 4) this.pos[k + 1] += 20;
      if (this.pos[k] - cam.x > 25) this.pos[k] -= 50; else if (this.pos[k] - cam.x < -25) this.pos[k] += 50;
      if (this.pos[k + 2] - cam.z > 25) this.pos[k + 2] -= 50; else if (this.pos[k + 2] - cam.z < -25) this.pos[k + 2] += 50;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- Трассеры и луч термокопья ----------
export class Beams {
  constructor(scene, count = 10) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 0.06, w: 0.04 });
    }
    this.next = 0;
    // луч термокопья: ядро + оболочка, видимы только пока стреляем
    this.beamCore = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.beamGlow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6018, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.beamCore.visible = this.beamGlow.visible = false;
    scene.add(this.beamCore, this.beamGlow);
  }

  tracer(from, to, color = 0xffd080, w = 0.04, dur = 0.06) {
    const t = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    t.m.position.copy(from);
    t.m.lookAt(to);
    t.m.scale.set(w, w, from.distanceTo(to));
    t.m.material.color.set(color);
    t.t = t.dur = dur;
    t.m.visible = true;
  }

  beam(from, to, on, time) {
    this.beamCore.visible = this.beamGlow.visible = on;
    if (!on) return;
    const len = from.distanceTo(to), wob = 1 + Math.sin(time * 60) * 0.15;
    for (const [m, w] of [[this.beamCore, 0.07 * wob], [this.beamGlow, 0.22 * wob]]) {
      m.position.copy(from);
      m.lookAt(to);
      m.scale.set(w, w, len);
    }
  }

  update(dt) {
    for (const t of this.items) {
      if (t.t <= 0) continue;
      t.t -= dt;
      t.m.material.opacity = Math.max(0, t.t / t.dur);
      if (t.t <= 0) t.m.visible = false;
    }
  }

  clear() { for (const t of this.items) { t.t = 0; t.m.visible = false; } this.beamCore.visible = this.beamGlow.visible = false; }
}

// Собрать все эффекты в один объект
export function createFX(scene) {
  const fx = {};
  fx.blood = new Particles(scene, 900);
  fx.dust = new Particles(scene, 300);
  fx.sparks = new Particles(scene, 500, { additive: true });
  fx.lights = new LightPool(scene, 4);
  fx.halos = new Halos(scene, 28);
  fx.gibs = new Gibs(scene, 120);
  fx.decals = new Decals(scene, 80);
  fx.explosions = new Explosions(scene, fx, 14);
  fx.snow = new Snowfall(scene);
  fx.beams = new Beams(scene);
  fx.update = (dt, world, cam, time) => {
    fx.blood.update(dt); fx.dust.update(dt); fx.sparks.update(dt);
    fx.lights.update(dt); fx.halos.update(dt); fx.gibs.update(dt, world);
    fx.explosions.update(dt); fx.snow.update(dt, cam, time); fx.beams.update(dt);
  };
  fx.setScale = (h) => { fx.blood.setScale(h); fx.dust.setScale(h); fx.sparks.setScale(h); };
  fx.clear = () => {
    fx.blood.clear(); fx.dust.clear(); fx.sparks.clear(); fx.lights.clear(); fx.halos.clear();
    fx.gibs.clear(); fx.decals.clear(); fx.explosions.clear(); fx.beams.clear();
  };
  // Фонтан крови: крупные и мелкие капли разного размера + кусок-другой
  fx.bloodBurst = (p, amount = 1, dir = null) => {
    // крупные насыщенные капли, полупрозрачные розоватые облачка и светлые кусочки плоти
    fx.blood.burst(p, Math.round(34 * amount), 0xe21b22, { speed: 7, life: 1.0, gravity: 14, size: 0.12, sizeVar: 1.6, dir, spread: 1 });
    fx.blood.burst(p, Math.round(12 * amount), 0xff5a64, { speed: 3.5, life: 0.7, gravity: 6, size: 0.42, sizeVar: 1, alpha: 0.55, dir });
    fx.blood.burst(p, Math.round(6 * amount), 0xffe0c8, { speed: 5, life: 0.8, gravity: 12, size: 0.11, sizeVar: 0.8, dir, up: 0.5 });
  };
  return fx;
}
