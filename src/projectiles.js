// Снаряды: плазма игрока, гранаты, пули стрелков, огненные шары и ракеты босса.
// Пул спрайтов с HDR-ореолами и шлейфами частиц — ничего не создаётся в бою.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, haloCanvas } from './art_misc.js';
import { fxArt } from './art_fx.js';
import { sfx } from './audio.js';

// core — множитель яркости самого шара (HDR: светится), haloGain — яркость ореола
const KINDS = {
  plasma: { tex: 'plasmaOrb', size: 0.6, core: [1.8, 2.4, 3.2], halo: 0x50c8ff, haloSize: 2.3, haloGain: 2.2, gravity: 0, owner: 'player' },
  grenade: { tex: null, size: 0.32, core: [1, 1, 1], halo: 0xff3020, haloSize: 0.9, haloGain: 2.4, gravity: 18, owner: 'player' },
  bullet: { tex: 'fireOrb', size: 0.3, core: [3.0, 2.0, 1.1], halo: 0xffb040, haloSize: 1.0, haloGain: 1.8, gravity: 0, owner: 'enemy' },
  fireball: { tex: 'fireOrb', size: 0.85, core: [2.8, 1.7, 0.9], halo: 0xff7020, haloSize: 2.8, haloGain: 1.8, gravity: 0, owner: 'enemy' },
  rocket: { tex: 'greenOrb', size: 0.6, core: [1.8, 2.8, 1.2], halo: 0x9cff40, haloSize: 2.3, haloGain: 1.7, gravity: 4, owner: 'enemy' },
};
const UP = new THREE.Vector3(0, 1, 0);

export class Projectiles {
  constructor(G) {
    this.G = G;
    if (G.fx.bind) G.fx.bind(G);
    const art = miscArt();
    const tex = {};
    for (const k of ['plasmaOrb', 'fireOrb', 'greenOrb']) tex[k] = nearestTexture(art[k]);
    tex.grenade = nearestTexture(art.icons.grenade);
    const haloTex = new THREE.CanvasTexture(haloCanvas('255,255,255', 64));
    const arcs = fxArt().arcs;
    this.arcFrames = arcs.count;
    this.items = [];
    for (let i = 0; i < 60; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.fireOrb, fog: false }));
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = h.visible = false;
      G.scene.add(s, h);
      this.items.push({ s, h, a: null, active: false, kind: null, vel: new THREE.Vector3(), life: 0, dmg: 0, splash: 0, splashDmg: 0, fuse: 0, trailT: 0, age: 0 });
    }
    // электрические дуги вокруг сгустка плазмы — отдельный небольшой пул (плазмы в воздухе немного)
    this.arcs = [];
    for (let i = 0; i < 8; i++) {
      const map = nearestTexture(arcs.canvas);
      map.repeat.set(1 / arcs.count, 1);
      const a = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: new THREE.Color(1.6, 2.6, 3.4) }));
      a.visible = false;
      G.scene.add(a);
      this.arcs.push({ a, map, used: false });
    }
    this.tex = tex;
    this.prev = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }

  get(kind) {
    const p = this.items.find((q) => !q.active);
    if (!p) return null;
    const K = KINDS[kind];
    p.kind = kind;
    p.K = K;
    p.active = true;
    p.age = 0;
    p.trailT = 0;
    p.s.material.map = kind === 'grenade' ? this.tex.grenade : this.tex[K.tex];
    p.s.material.rotation = 0;
    p.s.material.color.setRGB(K.core[0], K.core[1], K.core[2]);
    p.s.scale.set(K.size * (kind === 'grenade' ? 2.4 : 1), K.size, 1);
    p.s.visible = true;
    p.h.visible = !!K.halo;
    if (K.halo) { p.h.material.color.set(K.halo).multiplyScalar(K.haloGain); p.h.scale.set(K.haloSize, K.haloSize, 1); }
    p.a = null;
    if (kind === 'plasma') {
      const arc = this.arcs.find((q) => !q.used);
      if (arc) { arc.used = true; arc.a.visible = true; p.a = arc; }
    }
    return p;
  }

  release(p) {
    p.active = false;
    p.s.visible = p.h.visible = false;
    if (p.a) { p.a.used = false; p.a.a.visible = false; p.a = null; }
  }

  playerPlasma(from, dir, w) {
    const p = this.get('plasma');
    if (!p) return;
    p.s.position.copy(from);
    p.vel.copy(dir).multiplyScalar(30);
    p.life = 3;
    p.dmg = w.dmg; p.splash = w.splash; p.splashDmg = w.splashDmg;
  }

  throwGrenade() {
    const G = this.G, p = this.get('grenade');
    if (!p) return;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    p.s.position.copy(G.camera.position).addScaledVector(d, 0.6);
    p.vel.copy(d).multiplyScalar(15);
    p.vel.y += 4.5;
    p.vel.x += G.player.vel.x * 0.5; p.vel.z += G.player.vel.z * 0.5;
    p.life = 6; p.fuse = 1.5;
    p.dmg = 0; p.splash = 4.5; p.splashDmg = 170;
  }

  // Выстрел врага: from — точка дула, target — точка прицела
  enemyShot(kind, from, target, { speed = 20, dmg = 7, spread = 0.03, splash = 0, splashDmg = 0, lob = 0 } = {}) {
    const p = this.get(kind);
    if (!p) return;
    p.s.position.copy(from);
    p.vel.set(target.x - from.x, target.y - from.y, target.z - from.z).normalize();
    p.vel.x += (Math.random() - 0.5) * spread; p.vel.y += (Math.random() - 0.5) * spread; p.vel.z += (Math.random() - 0.5) * spread;
    p.vel.normalize().multiplyScalar(speed);
    p.vel.y += lob;
    p.life = 5; p.dmg = dmg; p.splash = splash; p.splashDmg = splashDmg;
  }

  explode(p, at) {
    const G = this.G, fx = G.fx;
    const pos = at || p.s.position;
    if (p.kind === 'plasma') {
      // синяя вспышка, расходящееся кольцо, искры-дуги, остывающее пятно на земле
      fx.sparks.burst(pos, 26, 0x80e0ff, { speed: 8, life: 0.5, gravity: 2, size: 0.1, hdr: 2.8 });
      fx.sparks.burst(pos, 10, 0xffffff, { speed: 15, life: 0.22, gravity: 0, size: 0.05, hdr: 4 });
      fx.halos.spawn(pos, 0x60c0ff, 4.2, 0.3, 2.6);
      fx.rings.spawn(pos, 0x8adcff, 0.8, 0.28, 2.4, p.splash * 2.2);
      fx.lights.flash(pos, 0x60c0ff, 50, 0.3, 10);
      const gy = G.world.groundAt(pos.x, pos.z, pos.y + 0.4, 0.1);
      if (pos.y - gy < 1.4 && gy > -10) {
        this.tmp.set(pos.x, gy, pos.z);
        fx.flat.spawn('ring', this.tmp, UP, { size: 0.8, grow: p.splash * 1.9, dur: 0.36, color: 0x70d0ff, gain: 2.4, pow: 1.3, lift: 0.05 });
        fx.flat.spawn('molten', this.tmp, UP, { size: 1.5, dur: 1.8, color: 0x50b8ff, gain: 2.4, pow: 1.5, fadeIn: 0.02, lift: 0.04 });
      }
      G.damageArea(pos, p.splash, p.splashDmg, 'plasma');
      sfx.plasmaHit();
    } else if (p.kind === 'grenade' || p.kind === 'rocket') {
      fx.explosions.spawn(pos, p.kind === 'grenade' ? 4.2 : 3, 0.7);
      if (p.kind === 'rocket') fx.sparks.burst(pos, 14, 0x9cff40, { speed: 7, life: 0.7, gravity: 5, size: 0.07, hdr: 2.6 });
      fx.decals.floor(pos.x, G.world.groundAt(pos.x, pos.z, pos.y + 0.5) + 0.01, pos.z, 3, 'scorch');
      G.damageArea(pos, p.splash, p.splashDmg, p.kind === 'grenade' ? 'grenade' : 'enemyRocket');
      G.player.addTrauma(Math.max(0, 0.7 - pos.distanceTo(G.camera.position) / 25));
      sfx.explosion(Math.max(0.3, 1 - pos.distanceTo(G.camera.position) / 40));
    } else {
      const fire = p.kind === 'fireball';
      fx.sparks.burst(pos, fire ? 12 : 7, fire ? 0xff8030 : 0xffc060, { speed: fire ? 4.5 : 3, life: 0.4, gravity: 4, size: 0.07, hdr: 3 });
      fx.halos.spawn(pos, fire ? 0xff6020 : 0xffb050, fire ? 2.6 : 1.1, fire ? 0.25 : 0.12, 2.4);
      if (fire) {
        fx.dust.burst(pos, 3, 0x3a3640, { speed: 0.8, life: 0.9, gravity: -1, size: 0.3, alpha: 0.45, grow: 0.5, drag: 1.5 });
        fx.lights.flash(pos, 0xff7020, 18, 0.18, 7);
      }
    }
    this.release(p);
  }

  // Шлейф за снарядом
  trail(p, pos, dt) {
    const fx = this.G.fx, k = p.kind;
    p.trailT -= dt;
    if (p.trailT > 0) return;
    if (k === 'plasma') {
      p.trailT = 0.022;
      fx.sparks.burst(pos, 1, 0x70d8ff, { speed: 0.9, life: 0.32, gravity: 0, size: 0.11, sizeVar: 0.9, hdr: 2.2 });
    } else if (k === 'fireball') {
      p.trailT = 0.035;
      fx.sparks.burst(pos, 1, 0xff7a28, { speed: 0.7, life: 0.35, gravity: -1.5, size: 0.16, sizeVar: 0.9, hdr: 2.2 });
      if (Math.random() < 0.4) fx.dust.burst(pos, 1, 0x2e2a32, { speed: 0.3, life: 0.7, gravity: -0.8, size: 0.22, alpha: 0.4, grow: 0.4 });
    } else if (k === 'rocket') {
      p.trailT = 0.03;
      fx.dust.burst(pos, 1, 0x5a5c62, { speed: 0.4, life: 1.0, gravity: -0.5, size: 0.22, alpha: 0.5, grow: 0.5, drag: 1 });
      fx.sparks.burst(pos, 1, 0x9cff40, { speed: 1.2, life: 0.3, gravity: 2, size: 0.07, hdr: 2.4 });
    } else if (k === 'bullet') {
      p.trailT = 0.03;
      fx.sparks.burst(pos, 1, 0xffb050, { speed: 0.3, life: 0.16, gravity: 0, size: 0.07, hdr: 2.2 });
    } else if (k === 'grenade') {
      p.trailT = 0.06;
      fx.dust.burst(pos, 1, 0x6a6a72, { speed: 0.2, life: 0.5, gravity: -0.4, size: 0.1, alpha: 0.3, grow: 0.2 });
    }
  }

  update(dt) {
    const G = this.G, P = G.player;
    for (const p of this.items) {
      if (!p.active) continue;
      const pos = p.s.position, K = p.K;
      p.vel.y -= K.gravity * dt;
      const prev = this.prev.copy(pos);
      pos.addScaledVector(p.vel, dt);
      p.h.position.copy(pos);
      p.life -= dt;
      p.age += dt;
      this.trail(p, pos, dt);
      // пульсация: шар «дышит», ореол мерцает
      const pulse = 1 + Math.sin(p.age * 38) * 0.12;
      if (p.kind !== 'grenade') {
        p.s.scale.set(K.size * pulse, K.size * pulse, 1);
        p.s.material.rotation += dt * 9;
        p.h.scale.set(K.haloSize * (2 - pulse), K.haloSize * (2 - pulse), 1);
      }
      if (p.a) {
        const arc = p.a;
        arc.a.position.copy(pos);
        arc.map.offset.x = (Math.floor(p.age * 24) % this.arcFrames) / this.arcFrames;
        arc.a.material.rotation = Math.floor(p.age * 24) * 1.9;
        arc.a.scale.set(1.25, 1.25, 1);
      }
      if (p.kind === 'grenade') {
        p.s.material.rotation += dt * 12;
        p.fuse -= dt;
        // красный огонёк мигает всё чаще к взрыву
        const blink = Math.sin((1.5 - p.fuse) * (6 + (1.5 - p.fuse) * 14)) > 0.2 ? 1 : 0.12;
        p.h.material.color.set(K.halo).multiplyScalar(K.haloGain * blink);
        // отскок от земли и стен
        const gy = G.world.groundAt(pos.x, pos.z, prev.y + 0.2, 0.1);
        if (pos.y < gy + 0.15) {
          pos.y = gy + 0.15;
          if (Math.abs(p.vel.y) > 2) { sfx.bounce(); G.fx.dust.burst(pos, 3, 0x8e8c9a, { speed: 1.2, life: 0.4, gravity: 1, size: 0.1, alpha: 0.4 }); }
          p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6;
        }
        if (G.world.solidAt(pos.x, pos.y, pos.z)) { pos.copy(prev); p.vel.x *= -0.4; p.vel.z *= -0.4; }
        // взрыв по таймеру или при касании врага
        if (p.fuse <= 0 || G.enemies.hitTest(pos, 0.3)) this.explode(p);
        continue;
      }
      if (p.life <= 0) { this.explode(p); continue; }
      if (G.world.solidAt(pos.x, pos.y, pos.z)) { this.explode(p, prev.clone()); continue; }
      if (K.owner === 'player') {
        const e = G.enemies.hitTest(pos, 0.25);
        const b = G.pickups.barrelHit(pos, 0.3);
        if (e) { G.enemies.damage(e, p.dmg, pos, 'plasma'); this.explode(p); continue; }
        if (b) { G.pickups.damageBarrel(b, p.dmg); this.explode(p); continue; }
      } else {
        // попадание в игрока (цилиндр)
        const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z;
        if (dx * dx + dz * dz < 0.5 * 0.5 && pos.y > P.pos.y && pos.y < P.pos.y + 1.9) {
          if (p.splash) this.explode(p);
          else { G.hurtPlayer(p.dmg, prev.clone()); this.explode(p); }
          continue;
        }
      }
    }
  }

  clear() { for (const p of this.items) this.release(p); }
}
