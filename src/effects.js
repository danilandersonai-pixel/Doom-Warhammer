// Эффекты: частицы (кровь, дым, HDR-искры), куски и обломки, декали крови/копоти, следы пуль,
// многослойные взрывы с ударной волной, варп-разломы, трассеры и луч термокопья, гильзы, остаточные огни,
// пул точечных огней для вспышек, экранные импульсы и замедление времени.
// Всё создаётся один раз и переиспользуется (пулы) — в бою нет новых объектов.
// Цвета ярче 1 (HDR) подхватывает постобработка: «горячие» ядра светятся (bloom).
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, haloCanvas } from './art_misc.js';
import { fxArt } from './art_fx.js';

const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ---------- Частицы: свой простой шейдер, у каждой частицы свой размер ----------
export class Particles {
  constructor(scene, max = 700, { additive = false, solid = false, puff = false } = {}) {
    this.max = max;
    this.solid = solid;   // сплошные частицы (кровь): без прозрачности, в конце жизни просто исчезают
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);     // торможение о воздух (дым)
    this.grow = new Float32Array(max);     // рост размера, м/с (дым клубится)
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 }, ...THREE.UniformsLib.fog },
      defines: additive ? { FOG_ADDITIVE: '' } : puff ? { PUFF: '' } : {},
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vCol; uniform float scale;
        #include <fog_pars_vertex>
        void main() {
          vCol = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / -mvPosition.z, 160.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          if (vCol.a < 0.01) discard;
          gl_FragColor = vCol;
          #ifdef PUFF
            // клуб дыма из крупных «пикселей»: срезанные углы, светлее сверху-слева
            vec2 pc = floor(gl_PointCoord * 6.0);
            vec2 pd = abs(pc - 2.5);
            if (pd.x + pd.y > 3.6) discard;
            gl_FragColor.rgb *= 1.0 + (2.5 - pc.x) * 0.045 + (2.5 - pc.y) * 0.075;
          #endif
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
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

  // Выброс частиц. size — размер в метрах (± разброс), dir — направление, hdr — множитель яркости (свечение),
  // drag — торможение, grow — рост размера (для дыма), tint — THREE.Color местного света (для крови)
  burst(p, count, color, { speed = 4, life = 0.7, gravity = 9, dir = null, spread = 1, size = 0.08, sizeVar = 0.6, alpha = 1, up = 0, hdr = 1, drag = 0, grow = 0, tint = null } = {}) {
    const c = color instanceof THREE.Color ? color : _c.set(color);
    const r = c.r * hdr * (tint ? tint.r : 1), g = c.g * hdr * (tint ? tint.g : 1), b = c.b * hdr * (tint ? tint.b : 1);
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
      this.col[i * 4] = r * shade; this.col[i * 4 + 1] = g * shade; this.col[i * 4 + 2] = b * shade; this.col[i * 4 + 3] = alpha;
      this.size[i] = size * (1 - sizeVar / 2 + Math.random() * sizeVar);
      this.life[i] = this.life0[i] = life * (0.5 + Math.random() * 0.5);
      this.grav[i] = gravity;
      this.drag[i] = drag;
      this.grow[i] = grow;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      if (this.drag[i] > 0) { const d = Math.exp(-this.drag[i] * dt); this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d; }
      if (this.grow[i] !== 0) this.size[i] += this.grow[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02 && this.grav[i] > 0 && this.pos[k + 1] > -1) {
        this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.2; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5;
      }
      const t = this.life[i] / this.life0[i];
      if (t < 0.3 && !this.solid) this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], t / 0.3);
      else if (t < 0.25 && this.solid) this.size[i] *= 0.9;
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

  // Сколько света от вспышек приходит в точку (для спрайтов врагов, которые сцена сама не освещает)
  addAt(p, out, k = 1) {
    for (const it of this.items) {
      if (it.t <= 0) continue;
      const lp = it.l.position, d2 = (lp.x - p.x) ** 2 + (lp.y - p.y) ** 2 + (lp.z - p.z) ** 2;
      const fall = Math.max(0, 1 - Math.sqrt(d2) / it.l.distance);
      if (fall <= 0) continue;
      const a = Math.min(2.5, (it.l.intensity * fall * fall) / (d2 + 4)) * 0.12 * k;
      out.r += it.l.color.r * a; out.g += it.l.color.g * a; out.b += it.l.color.b * a;
    }
  }

  clear() { for (const it of this.items) { it.t = 0; it.l.intensity = 0; } }
}

// ---------- Ореолы и кольца: аддитивные спрайты (gain > 1 — HDR, светится через bloom) ----------
export class Halos {
  constructor(scene, count = 24, tex = null) {
    this.items = [];
    const map = tex || new THREE.CanvasTexture(haloCanvas('255,255,255', 64));
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, t: 0, dur: 1, size: 1, size1: 1, col: new THREE.Color() });
    }
    this.next = 0;
  }

  // size1 — конечный размер (кольцо ударной волны растёт); по умолчанию ореол слегка сжимается
  spawn(p, color, size, dur = 0.1, gain = 1, size1 = null) {
    const h = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    h.s.position.set(p.x, p.y, p.z);
    h.col.set(color).multiplyScalar(gain);
    h.t = h.dur = dur;
    h.size = size;
    h.size1 = size1;
    h.s.visible = true;
    h.s.material.color.copy(h.col);
    h.s.scale.set(size, size, 1);
  }

  update(dt) {
    for (const h of this.items) {
      if (h.t <= 0) continue;
      h.t -= dt;
      if (h.t <= 0) { h.s.visible = false; continue; }
      const k = h.t / h.dur;
      const s = h.size1 === null ? h.size * (0.6 + k * 0.4) : h.size + (h.size1 - h.size) * (1 - k * k);
      h.s.scale.set(s, s, 1);
      h.s.material.color.copy(h.col).multiplyScalar(h.size1 === null ? k : k * k);
    }
  }

  clear() { for (const h of this.items) { h.t = 0; h.s.visible = false; } }
}

// ---------- Плоские светящиеся эффекты на поверхностях: ударные кольца, сигилы, расплав, угольки ----------
export class FlatFX {
  constructor(scene, count = 44) {
    const art = fxArt();
    this.tex = { ring: art.ring, ringThin: art.ringThin, sigil: art.sigil, molten: art.molten, embers: art.embers, glow: art.holeGlow };
    const geo = new THREE.PlaneGeometry(1, 1);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: art.ring, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      m.visible = false;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 1, age: 0, size: 1, grow: 0, spin: 0, fadeIn: 0.05, flicker: 0, pow: 1, col: new THREE.Color() });
    }
    this.next = 0;
  }

  // kind: ring | ringThin | sigil | molten | embers | glow. grow — прибавка к размеру за время жизни
  spawn(kind, point, normal, { size = 1, grow = 0, dur = 1, color = 0xffffff, gain = 1, spin = 0, fadeIn = 0.04, flicker = 0, pow = 1.5, lift = 0.03 } = {}) {
    const f = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    const m = f.m;
    m.material.map = this.tex[kind] || this.tex.ring;
    m.position.set(point.x, point.y, point.z).addScaledVector(normal, lift);
    m.lookAt(_v.copy(m.position).add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    f.col.set(color).multiplyScalar(gain);
    f.t = f.dur = dur; f.age = 0;
    f.size = size; f.grow = grow; f.spin = spin; f.fadeIn = fadeIn; f.flicker = flicker; f.pow = pow;
    m.scale.set(size, size, 1);
    m.material.color.setScalar(0);
    m.visible = true;
    return f;
  }

  update(dt) {
    for (const f of this.items) {
      if (f.t <= 0) continue;
      f.t -= dt; f.age += dt;
      if (f.t <= 0) { f.m.visible = false; continue; }
      const k = f.t / f.dur, e = 1 - k;
      const s = f.size + f.grow * (1 - (1 - e) * (1 - e));          // быстро в начале, замедляется
      f.m.scale.set(s, s, 1);
      if (f.spin) f.m.rotateZ(f.spin * dt);
      let a = Math.min(1, f.age / f.fadeIn) * Math.pow(k, f.pow);
      if (f.flicker) a *= 1 - f.flicker * Math.random();
      f.m.material.color.copy(f.col).multiplyScalar(a);
    }
  }

  clear() { for (const f of this.items) { f.t = 0; f.m.visible = false; } }
}

// ---------- Куски (гибы) и обломки: летят, отскакивают, лежат до конца уровня (до лимита) ----------
export class Gibs {
  constructor(scene, count = 120, fx = null, { debris = false } = {}) {
    const textures = (debris ? fxArt().rubble : miscArt().gibs).map((c) => nearestTexture(c));
    this.fx = fx;
    this.debris = debris;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[i % textures.length] }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, vel: new THREE.Vector3(), active: false, rest: false, size: 0.3, spin: 0, floor: 0, trail: 0 });
    }
    this.next = 0;
  }

  burst(p, count, power = 6, size = 0.3, floorY = 0, tint = null) {
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
      g.trail = Math.random() * 0.05;
      if (tint) g.s.material.color.copy(tint); else g.s.material.color.setScalar(1);
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
      // кровавый шлейф за летящим куском (у обломков — пыль)
      g.trail -= dt;
      if (g.trail <= 0 && this.fx) {
        g.trail = 0.045;
        if (this.debris) this.fx.dust.burst(p, 1, 0x8a8a96, { speed: 0.4, life: 0.5, gravity: -0.3, size: 0.12, alpha: 0.5, grow: 0.2 });
        else this.fx.blood.burst(p, 1, 0xc0141c, { speed: 0.8, life: 0.55, gravity: 10, size: g.size * 0.38, sizeVar: 0.8, tint: g.s.material.color });
      }
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

// ---------- Декали: кровь на полу и стенах, копоть от взрывов (с тлеющими угольками) ----------
export class Decals {
  constructor(scene, count = 70, fx = null) {
    const art = miscArt();
    const mk = (c) => new THREE.MeshLambertMaterial({ map: nearestTexture(c), transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.fx = fx;
    this.blood = art.splats.map(mk);
    this.scorch = mk(art.scorch);
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, this.blood[0]);
      m.visible = false;
      m.receiveShadow = true;
      m.userData.grow = 0;
      scene.add(m);
      this.items.push(m);
    }
    this.next = 0;
    this.tmp = new THREE.Vector3();
    this.growing = [];
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
    m.userData.grow = 0;
    m.visible = true;
    // копоть тлеет: россыпь угольков и трещин светится и медленно гаснет
    if (kind === 'scorch' && this.fx) this.fx.flat.spawn('embers', point, normal, { size: size * 0.8, dur: 4.5 + Math.random() * 2, color: 0xff8030, gain: 2.6, flicker: 0.35, pow: 1.2, lift: 0.035 });
    return m;
  }

  floor(x, y, z, size, kind) { return this.add(this.tmp.set(x, y, z).clone(), UP, size, kind); }

  // Лужа крови под телом: появляется маленькой и растекается
  pool(x, y, z, size) {
    const m = this.floor(x, y, z, size * 0.35, 'blood');
    m.userData.grow = size;
    if (!this.growing.includes(m)) this.growing.push(m);
    return m;
  }

  update(dt) {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const m = this.growing[i], to = m.userData.grow;
      if (!to || !m.visible) { this.growing.splice(i, 1); continue; }
      const s = m.scale.x + (to - m.scale.x) * Math.min(1, dt * 1.6);
      m.scale.set(s, s, 1);
      if (to - s < 0.02) { m.userData.grow = 0; this.growing.splice(i, 1); }
    }
  }

  clear() { for (const m of this.items) { m.visible = false; m.userData.grow = 0; } this.growing.length = 0; }
}

// ---------- Следы пуль и трещины: тёмные выбоины (отдельный пул, чтобы не вытеснять кровь) ----------
export class Marks {
  constructor(scene, count = 64) {
    const art = fxArt();
    const mk = (c, alphaTest) => new THREE.MeshLambertMaterial({ map: nearestTexture(c), transparent: true, alphaTest, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.holes = art.holes.map((c) => mk(c, 0.4));
    this.cracks = mk(art.cracks, 0.3);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, this.holes[0]);
      m.visible = false;
      m.receiveShadow = true;
      scene.add(m);
      this.items.push(m);
    }
    this.next = 0;
  }

  add(point, normal, size = 0.3, kind = 'hole') {
    const m = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    m.material = kind === 'cracks' ? this.cracks : this.holes[(Math.random() * this.holes.length) | 0];
    m.position.set(point.x, point.y, point.z).addScaledVector(normal, 0.012 + (this.next % 5) * 0.002);
    m.lookAt(_v.copy(m.position).add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.set(size, size, 1);
    m.visible = true;
  }

  clear() { for (const m of this.items) m.visible = false; }
}

// ---------- Остаточные огни: несколько секунд горят на месте взрыва ----------
export class Flames {
  constructor(scene, count = 12, fx = null) {
    const art = miscArt().fire;
    this.fx = fx;
    this.frames = art.count;
    const haloTex = new THREE.CanvasTexture(haloCanvas('255,150,60', 64));
    this.items = [];
    for (let i = 0; i < count; i++) {
      const map = nearestTexture(art.canvas);
      map.repeat.set(1 / art.count, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.7, 1.2) }));
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = h.visible = false;
      scene.add(s, h);
      this.items.push({ s, h, map, t: 0, dur: 1, size: 1, phase: Math.random() * 10, spark: 0 });
    }
    this.next = 0;
  }

  spawn(x, y, z, size = 0.6, dur = 4) {
    const f = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    f.s.position.set(x, y + size * 0.5, z);
    f.h.position.set(x, y + size * 0.45, z);
    f.t = f.dur = dur;
    f.size = size;
    f.s.visible = f.h.visible = true;
    return f;
  }

  update(dt, time) {
    for (const f of this.items) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) { f.s.visible = f.h.visible = false; continue; }
      const k = Math.min(1, f.t / 0.8) * Math.min(1, (f.dur - f.t) / 0.15);     // вспыхивает, в конце опадает
      f.map.offset.x = (Math.floor(time * 11 + f.phase) % this.frames) / this.frames;
      f.s.scale.set(0.75 * f.size * (0.5 + k * 0.5), f.size * k, 1);
      f.s.position.y = f.h.position.y - f.size * 0.45 + f.size * k * 0.5;
      const hs = f.size * 2.6 * k;
      f.h.scale.set(hs, hs, 1);
      f.h.material.opacity = (0.4 + Math.sin(time * 14 + f.phase) * 0.1) * k;
      f.spark -= dt;
      if (f.spark <= 0 && this.fx) {
        f.spark = 0.25 + Math.random() * 0.4;
        this.fx.sparks.burst(f.s.position, 1, 0xffa040, { speed: 1.4, life: 0.9, gravity: -1.6, size: 0.05, up: 1.2, hdr: 2.5 });
      }
    }
  }

  clear() { for (const f of this.items) { f.t = 0; f.s.visible = f.h.visible = false; } }
}

// ---------- Гильзы: вылетают вбок, падают, отскакивают, лежат несколько секунд ----------
export class Casings {
  constructor(scene, count = 24) {
    const art = fxArt();
    this.items = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: art.casing }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, vel: new THREE.Vector3(), t: 0, rest: false, spin: 0 });
    }
    this.next = 0;
    this.tex = { brass: art.casing, shell: art.shell };
  }

  spawn(pos, vel, shell = false, tint = null) {
    const c = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    c.s.material.map = shell ? this.tex.shell : this.tex.brass;
    c.s.position.copy(pos);
    c.vel.copy(vel);
    c.s.scale.set(shell ? 0.075 : 0.056, shell ? 0.038 : 0.028, 1);
    if (tint) c.s.material.color.copy(tint).multiplyScalar(0.95); else c.s.material.color.setScalar(1);
    c.s.material.opacity = 1;
    c.t = 4;
    c.rest = false;
    c.spin = (Math.random() - 0.5) * 40;
    c.s.visible = true;
  }

  update(dt, world) {
    for (const c of this.items) {
      if (c.t <= 0) continue;
      c.t -= dt;
      if (c.t <= 0) { c.s.visible = false; continue; }
      if (c.t < 0.5) { c.s.material.transparent = true; c.s.material.opacity = c.t / 0.5; }
      if (c.rest) continue;
      c.vel.y -= 20 * dt;
      c.s.position.addScaledVector(c.vel, dt);
      c.s.material.rotation += c.spin * dt;
      const p = c.s.position;
      const floor = world ? world.groundAt(p.x, p.z, p.y + 0.3, 0.03) : 0;
      if (p.y < floor + 0.03) {
        p.y = floor + 0.03;
        if (Math.abs(c.vel.y) < 1.6) { c.rest = true; c.s.material.rotation = Math.round(c.s.material.rotation / Math.PI) * Math.PI; continue; }
        c.vel.y *= -0.42; c.vel.x *= 0.55; c.vel.z *= 0.55; c.spin *= 0.5;
      }
    }
  }

  clear() { for (const c of this.items) { c.t = 0; c.s.visible = false; } }
}

// ---------- Варп-разлом: вертикальный «портал» с закрученным пиксельным шейдером ----------
// Тёмное ядро, пурпурные спиральные рукава, раскалённая HDR-кромка. Из него поднимается враг.
const PORTAL_FRAG = `
precision highp float;
uniform float uLife; uniform float uTime; uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 q = floor(vUv * vec2(44.0, 66.0)) / vec2(44.0, 66.0) + vec2(0.5 / 44.0, 0.5 / 66.0);    // крупные «пиксели»
  vec2 p = (q - 0.5) * 2.0;
  float r = length(p), a = atan(p.y, p.x);
  float open = smoothstep(0.0, 0.22, uLife) * (1.0 - smoothstep(0.72, 1.0, uLife));
  float wob = 0.06 * sin(a * 5.0 + uTime * 9.0 + uSeed) + 0.05 * sin(a * 9.0 - uTime * 13.0);
  float R = open * (0.88 + wob);
  if (r > R || open < 0.01) discard;
  float k = r / max(R, 1e-3);
  float sw = a + (1.0 - k) * 6.5 - uTime * 7.0 + uSeed;
  float arms = smoothstep(0.15, 0.95, 0.5 + 0.5 * sin(sw * 3.0));
  float n = hash(floor(vUv * vec2(44.0, 66.0)) + floor(uTime * 12.0));
  vec3 col = mix(vec3(0.012, 0.0, 0.03), vec3(0.42, 0.04, 0.62), arms * (0.35 + 0.65 * k));
  col += vec3(1.5, 0.25, 1.9) * arms * smoothstep(0.55, 1.0, k) * 0.9;
  col += vec3(4.2, 1.5, 4.6) * smoothstep(0.84, 0.99, k);                       // раскалённая кромка
  col += vec3(2.6, 1.6, 3.2) * step(0.965, n) * (1.0 - k);                       // искры в глубине
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export class Portals {
  constructor(scene, count = 6) {
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uLife: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: PORTAL_FRAG, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 1, x: 0, z: 0 });
    }
    this.next = 0;
  }

  spawn(x, y, z, k = 1, dur = 0.85) {
    const p = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    p.x = x; p.z = z;
    p.m.position.set(x, y - 0.1, z);
    p.m.scale.set(1.7 * k, 2.6 * k, 1);
    p.m.material.uniforms.uSeed.value = Math.random() * 10;
    p.t = 0; p.dur = dur;
    p.m.visible = true;
  }

  update(dt, cam, time) {
    for (const p of this.items) {
      if (!p.m.visible) continue;
      p.t += dt;
      if (p.t >= p.dur) { p.m.visible = false; continue; }
      p.m.material.uniforms.uLife.value = p.t / p.dur;
      p.m.material.uniforms.uTime.value = time;
      if (cam) {
        // лицом к камере и чуть позади точки появления — враг выходит из разлома, а не тонет в нём
        const dx = cam.x - p.x, dz = cam.z - p.z, d = Math.hypot(dx, dz) || 1;
        p.m.rotation.y = Math.atan2(dx, dz);
        p.m.position.x = p.x - (dx / d) * 0.4; p.m.position.z = p.z - (dz / d) * 0.4;
      }
    }
  }

  clear() { for (const p of this.items) p.m.visible = false; }
}

// ---------- Взрывы: вспышка → огненный шар (12 кадров) → ударная волна → дым, обломки, огоньки ----------
export class Explosions {
  constructor(scene, fx, count = 16) {
    const art = fxArt().fireball;
    this.frames = art.count;
    this.fx = fx;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const map = nearestTexture(art.canvas);
      map.repeat.set(1 / art.count, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, map, t: -1, dur: 0.6, gain: 3 });
    }
    this.next = 0;
  }

  // size < 1.4 — малый разрыв (разрывной патрон: дёшево, 9 раз в секунду); ≥ 2.2 — полный набор слоёв
  spawn(p, size = 3, dur = 0.65) {
    const fx = this.fx, tiny = size < 1.4, big = size >= 2.2;
    const e = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    const vs = size * (tiny ? 1.35 : 1.25);
    e.s.position.set(p.x, p.y + size * 0.15, p.z);
    e.s.scale.set(vs, vs, 1);
    e.s.material.rotation = (Math.random() - 0.5) * 0.5;
    e.t = 0;
    e.dur = dur * (tiny ? 1.1 : 1.25);
    e.gain = tiny ? 2.4 : 3.4;
    e.s.visible = true;
    e.map.offset.x = 0;
    e.s.material.color.setScalar(e.gain);
    fx.lights.flash(p, 0xff9030, 40 * size, tiny ? 0.2 : 0.4, 6 + size * 3);
    // белая вспышка-ядро
    fx.halos.spawn({ x: p.x, y: p.y + 0.2, z: p.z }, 0xffd2a0, size * (tiny ? 1.8 : 2.0), tiny ? 0.11 : 0.2, tiny ? 1.6 : 2.2);
    if (tiny) {
      fx.sparks.burst(p, 7, 0xffb040, { speed: 6, life: 0.5, gravity: 7, size: 0.05, up: 0.4, hdr: 3 });
      fx.dust.burst(p, 2, 0x4a4650, { speed: 0.8, life: 0.9, gravity: -0.8, size: 0.3, alpha: 0.45, grow: 0.5, drag: 1.5 });
      return;
    }
    fx.sparks.burst(p, 26, 0xffb040, { speed: 9, life: 1.0, gravity: 7, size: 0.07, up: 0.6, hdr: 3.2 });           // угольки
    fx.sparks.burst(p, 10, 0xfff0c0, { speed: 14, life: 0.35, gravity: 2, size: 0.05, hdr: 4 });                    // быстрые искры
    fx.dust.burst(p, 12, 0x3c3842, { speed: 1.8, life: 2.4, gravity: -1.1, size: 0.2 * size, alpha: 0.5, grow: 0.5, drag: 1.3, up: 0.9 });   // столб дыма
    fx.dust.burst(p, 8, 0x6a6672, { speed: 4.5, life: 1.1, gravity: 1.5, size: 0.14 * size, alpha: 0.5, grow: 0.9, drag: 2.5 });              // пыль по земле
    if (!big) return;
    const G = fx.G, gy = G ? Math.max(-50, G.world.groundAt(p.x, p.z, p.y + 0.5, 0.2)) : 0;
    // ударная волна: кольцо по земле (если взрыв у земли) + расходящаяся сфера-кольцо в воздухе
    if (p.y - gy < 1.6 && gy > -10) {
      fx.flat.spawn('ring', _v2.set(p.x, gy, p.z), UP, { size: size * 0.5, grow: size * 2.5, dur: 0.38, color: 0xffa860, gain: 1.5, pow: 1.7, lift: 0.05 });
      // остаточные огоньки вокруг
      for (let i = 0, n = 2 + (Math.random() * 2 | 0); i < n; i++) {
        const a = Math.random() * 6.283, r = size * (0.15 + Math.random() * 0.4);
        const fxp = p.x + Math.cos(a) * r, fzp = p.z + Math.sin(a) * r;
        const fy = G ? G.world.groundAt(fxp, fzp, p.y + 0.5, 0.1) : gy;
        if (fy > -10 && Math.abs(fy - gy) < 0.6) fx.flames.spawn(fxp, fy, fzp, 0.4 + Math.random() * 0.45, 2.5 + Math.random() * 3);
      }
    }
    fx.rings.spawn(p, 0xffd8b0, size * 0.6, 0.24, 1.5, size * 2.6);
    fx.debris.burst(p, 5 + (size | 0), 8, 0.2, gy);
    // импульс экрана для близких взрывов
    if (G) {
      const d = _v.set(p.x, p.y, p.z).distanceTo(G.camera.position);
      const k = Math.max(0, 1 - d / (size * 4.5));
      if (k > 0) { fx.screenFlash(k * 0.2, 0xffd9b0); fx.caKick(k * 0.006); }
    }
  }

  update(dt) {
    for (const e of this.items) {
      if (e.t < 0) continue;
      e.t += dt;
      const t = e.t / e.dur, f = Math.floor(t * this.frames);
      if (f >= this.frames) { e.t = -1; e.s.visible = false; continue; }
      e.map.offset.x = f / this.frames;
      e.s.material.color.setScalar(1 + (e.gain - 1) * Math.max(0, 1 - t * 1.8) ** 2);   // ядро «горит» только в первых кадрах
      e.s.position.y += dt * 0.5 * e.s.scale.y * t;                                       // дым всплывает
    }
  }

  clear() { for (const e of this.items) { e.t = -1; e.s.visible = false; } }
}

// ---------- Трассеры (летящие HDR-штрихи) и луч термокопья ----------
function crossGeo() {
  // две скрещённые плоскости вдоль +Z длиной 1: видно под любым углом
  const g = new THREE.BufferGeometry();
  const P = [], U = [];
  for (const [ax, ay] of [[1, 0], [0, 1]]) {
    const quad = [[-0.5, 0, 0, 0], [0.5, 0, 0, 1], [0.5, 1, 1, 1], [-0.5, 0, 0, 0], [0.5, 1, 1, 1], [-0.5, 1, 1, 0]];
    for (const [s, z, u, v] of quad) { P.push(s * ax, s * ay, z); U.push(u, v); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
export class Beams {
  constructor(scene, fx, count = 14) {
    const art = fxArt(), geo = crossGeo();
    this.fx = fx;
    const mk = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mk(art.tracer));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.items.push({ m, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, pos: 0, seg: 6, w: 0.1, speed: 150, col: new THREE.Color() });
    }
    this.next = 0;
    // луч термокопья: белая HDR-сердцевина + рыжая оболочка + широкое марево; пятно на конце
    this.beamCore = new THREE.Mesh(geo, mk(art.beam));
    this.beamGlow = new THREE.Mesh(geo, mk(art.beam));
    this.beamHaze = new THREE.Mesh(geo, mk(art.beam));
    this.beamEnd = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(haloCanvas('255,255,255', 64)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    for (const m of [this.beamCore, this.beamGlow, this.beamHaze, this.beamEnd]) { m.visible = false; m.frustumCulled = false; scene.add(m); }
    this.beamCore.material.color.setRGB(5.0, 4.2, 2.8);
    this.beamGlow.material.color.setRGB(2.6, 0.85, 0.2);
    this.beamHaze.material.color.setRGB(0.5, 0.12, 0.03);
    this.beamEnd.material.color.setRGB(4.0, 2.0, 0.7);
    this.markT = 0;
  }

  // dur сохранён для совместимости (время жизни теперь задаётся скоростью полёта штриха)
  tracer(from, to, color = 0xffd080, w = 0.04, dur = 0.06, gain = 3.2) {
    const t = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    t.from.copy(from);
    t.dir.copy(to).sub(from);
    t.len = t.dir.length();
    if (t.len < 0.6) return;
    t.dir.multiplyScalar(1 / t.len);
    t.seg = Math.min(t.len, 4 + Math.random() * 3);
    t.pos = t.seg * 0.8;
    t.speed = 130 + Math.random() * 50;
    t.w = w * 3.2;
    t.col.set(color).multiplyScalar(gain);
    t.m.material.color.copy(t.col);
    t.m.position.copy(from);
    t.m.lookAt(to);
    t.m.visible = true;
    this.place(t);
  }

  place(t) {
    const head = Math.min(t.len, t.pos), tail = Math.max(0, t.pos - t.seg);
    if (tail >= t.len) { t.m.visible = false; return; }
    t.m.position.copy(t.from).addScaledVector(t.dir, tail);
    const k = 1 - 0.5 * (tail / t.len);                         // к концу пути штрих сужается
    t.m.scale.set(t.w * k, t.w * k, Math.max(0.01, head - tail));
  }

  // hit — { point, normal, enemy } или null: куда упёрся луч (для расплава и дыма)
  beam(from, to, on, time, hit = null, dt = 0.016) {
    this.beamCore.visible = this.beamGlow.visible = this.beamHaze.visible = this.beamEnd.visible = !!on;
    if (!on) return;
    const len = from.distanceTo(to), wob = 1 + Math.sin(time * 60) * 0.15 + Math.sin(time * 37) * 0.1;
    for (const [m, w] of [[this.beamCore, 0.1 * wob], [this.beamGlow, 0.32 * wob], [this.beamHaze, 0.8]]) {
      m.position.copy(from);
      m.lookAt(to);
      m.scale.set(w, w, len);
    }
    this.beamEnd.position.copy(to);
    const es = 0.9 + Math.random() * 0.5;
    this.beamEnd.scale.set(es, es, 1);
    const fx = this.fx;
    // искры по спирали вокруг луча
    _v.copy(to).sub(from).normalize();
    for (let i = 0; i < 2; i++) {
      const s = Math.random() * len, a = time * 30 + s * 4 + i * 3.14;
      _v2.copy(from).addScaledVector(_v, s);
      _v2.x += Math.cos(a) * 0.09; _v2.y += Math.sin(a) * 0.09;
      fx.sparks.burst(_v2, 1, 0xffa040, { speed: 1.2, life: 0.3, gravity: -1, size: 0.04, hdr: 3 });
    }
    // расплав и дымок там, где луч упёрся в камень
    this.markT -= dt;
    if (hit && !hit.enemy && this.markT <= 0) {
      this.markT = 0.07;
      fx.flat.spawn('molten', hit.point, hit.normal, { size: 0.5 + Math.random() * 0.2, dur: 1.5, color: 0xffb060, gain: 3.2, pow: 1.6, fadeIn: 0.01 });
      fx.marks.add(hit.point, hit.normal, 0.42, 'hole');
      fx.dust.burst(hit.point, 1, 0x5a5660, { speed: 0.8, life: 1.0, gravity: -1.4, size: 0.2, alpha: 0.4, grow: 0.5, drag: 1.2, dir: hit.normal });
    }
  }

  update(dt) {
    for (const t of this.items) {
      if (!t.m.visible) continue;
      t.pos += t.speed * dt;
      this.place(t);
    }
  }

  clear() { for (const t of this.items) t.m.visible = false; this.beamCore.visible = this.beamGlow.visible = this.beamHaze.visible = this.beamEnd.visible = false; }
}

// Собрать все эффекты в один объект
export function createFX(scene) {
  const fx = { G: null };
  fx.blood = new Particles(scene, 900, { solid: true });
  fx.dust = new Particles(scene, 420, { puff: true });
  fx.sparks = new Particles(scene, 700, { additive: true });
  fx.lights = new LightPool(scene, 4);
  fx.halos = new Halos(scene, 32);
  fx.rings = new Halos(scene, 10, fxArt().ringThin);     // расходящиеся кольца-сферы (лицом к камере)
  fx.flat = new FlatFX(scene, 44);
  fx.gibs = new Gibs(scene, 120, fx);
  fx.debris = new Gibs(scene, 36, fx, { debris: true });
  fx.decals = new Decals(scene, 80, fx);
  fx.marks = new Marks(scene, 64);
  fx.flames = new Flames(scene, 12, fx);
  fx.casings = new Casings(scene, 24);
  fx.portals = new Portals(scene, 6);
  fx.explosions = new Explosions(scene, fx, 16);
  fx.beams = new Beams(scene, fx);
  // у fx.rings.spawn порядок как у ореолов: (p, color, size0, dur, gain, size1)

  // Связь с игрой (камера, мир, постобработка) — вызывается из игровых модулей при создании
  fx.bind = (G) => { fx.G = G; };

  // ---------- Время: короткая остановка при мощном ударе (hitstop) и замедление (смерть босса) ----------
  const T = { stop: 0, slowT: 0, slowK: 1, slowDur: 1 };
  fx.hitstop = (sec) => { T.stop = Math.max(T.stop, sec); };
  fx.slowmo = (k, sec) => { T.slowK = k; T.slowT = T.slowDur = sec; };
  // main.js пропускает через это dt кадра: возвращает «игровое» dt
  fx.scaleTime = (dt) => {
    if (T.stop > 0) { T.stop -= dt; return dt * 0.04; }
    if (T.slowT > 0) {
      T.slowT -= dt;
      const e = Math.min(1, T.slowT / (T.slowDur * 0.35));            // в конце плавно возвращаемся к норме
      return dt * (1 + (T.slowK - 1) * e);
    }
    return dt;
  };

  // ---------- Экранные импульсы (постобработка): вспышка и хроматическая аберрация ----------
  let ca = 0;
  fx.screenFlash = (k, color = 0xffe6c0) => {
    const post = fx.G && fx.G.post;
    if (!post || k <= post.fx.flash) return;
    post.fx.flash = Math.min(1, k);
    post.fx.flashColor.set(color);
  };
  fx.caKick = (k) => { ca = Math.min(0.02, Math.max(ca, k)); };

  const tint = new THREE.Color(1, 1, 1);
  // Цвет местного света в точке (тень/солнце/огонь) — чтобы несветящиеся спрайты не «горели» в тени
  fx.lightTint = (p, out = tint) => {
    const L = fx.G && fx.G.level;
    if (L && L.lightAt) L.lightAt(p, out); else out.setRGB(1, 1, 1);
    return out;
  };

  fx.update = (dt, world, cam, time) => {
    fx.blood.update(dt); fx.dust.update(dt); fx.sparks.update(dt);
    fx.lights.update(dt); fx.halos.update(dt); fx.rings.update(dt); fx.flat.update(dt);
    fx.gibs.update(dt, world); fx.debris.update(dt, world); fx.decals.update(dt);
    fx.flames.update(dt, time); fx.casings.update(dt, world); fx.portals.update(dt, cam, time);
    fx.explosions.update(dt); fx.beams.update(dt);
    if (ca > 0 || (fx.G && fx.G.post && fx.G.post.fx.ca > 0)) {
      ca = Math.max(0, ca - dt * 0.03);
      if (fx.G && fx.G.post) fx.G.post.fx.ca = ca;
    }
  };
  fx.setScale = (h) => { fx.blood.setScale(h); fx.dust.setScale(h); fx.sparks.setScale(h); };
  fx.clear = () => {
    fx.blood.clear(); fx.dust.clear(); fx.sparks.clear(); fx.lights.clear(); fx.halos.clear(); fx.rings.clear(); fx.flat.clear();
    fx.gibs.clear(); fx.debris.clear(); fx.decals.clear(); fx.marks.clear(); fx.flames.clear(); fx.casings.clear(); fx.portals.clear();
    fx.explosions.clear(); fx.beams.clear();
    T.stop = T.slowT = 0; ca = 0;
    if (fx.G && fx.G.post) fx.G.post.fx.ca = 0;
  };

  // Фонтан крови: крупные и мелкие капли разного размера + кусок-другой
  fx.bloodBurst = (p, amount = 1, dir = null) => {
    const t = fx.lightTint(p);
    // сплошные капли трёх тонов (тёмно-красный, красный, светлый блик) по дуге с гравитацией + светлые куски
    fx.blood.burst(p, Math.round(20 * amount), 0xe21b22, { speed: 7, life: 1.1, gravity: 14, size: 0.12, sizeVar: 1.6, dir, spread: 1, tint: t });
    fx.blood.burst(p, Math.round(12 * amount), 0x8a0a12, { speed: 5.5, life: 1.1, gravity: 14, size: 0.2, sizeVar: 1.4, dir, spread: 1, tint: t });
    fx.blood.burst(p, Math.round(6 * amount), 0xff5a4a, { speed: 6, life: 0.8, gravity: 12, size: 0.07, sizeVar: 0.8, dir, tint: t });
    fx.blood.burst(p, Math.round(5 * amount), 0xf0d2bc, { speed: 5, life: 0.9, gravity: 12, size: 0.1, sizeVar: 0.8, dir, up: 0.5, tint: t });
  };

  // Попадание пули в стену/пол: выбоина с раскалённой кромкой, HDR-искры по нормали, облачко пыли
  fx.impact = (point, normal, { mark = true, scale = 1 } = {}) => {
    fx.sparks.burst(point, Math.round(7 * scale), 0xffc060, { speed: 7, life: 0.32, gravity: 9, dir: normal, spread: 0.75, size: 0.05, hdr: 3.4 });
    fx.dust.burst(point, Math.round(4 * scale), 0x9a98a6, { speed: 1.8, life: 0.8, gravity: 1.5, dir: normal, spread: 0.7, size: 0.16, alpha: 0.5, grow: 0.35, drag: 2 });
    if (!mark) return;
    fx.marks.add(point, normal, (0.26 + Math.random() * 0.12) * scale, 'hole');
    fx.flat.spawn('glow', point, normal, { size: 0.3 * scale, dur: 0.9, color: 0xffa050, gain: 3, pow: 2, fadeIn: 0.01, lift: 0.02 });
  };

  // Клуб пыли из-под ног (приземление, рывок)
  fx.footDust = (p, amount = 1) => {
    fx.dust.burst(p, Math.round(8 * amount), 0x8e8c9a, { speed: 2.6 * amount, life: 0.7, gravity: 0.5, size: 0.2, alpha: 0.4, grow: 0.6, drag: 3, spread: 1, up: 0.15 });
  };
  return fx;
}
