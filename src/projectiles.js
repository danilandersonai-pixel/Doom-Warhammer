// Снаряды: плазма игрока, гранаты, пули стрелков, огненные шары и ракеты босса.
// Пул спрайтов с ореолами — ничего не создаётся в бою.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, haloCanvas } from './art_misc.js';
import { sfx } from './audio.js';

const KINDS = {
  plasma: { tex: 'plasmaOrb', size: 0.55, halo: 0x60d0ff, haloSize: 1.8, gravity: 0, owner: 'player' },
  grenade: { tex: null, size: 0.32, halo: 0, haloSize: 0, gravity: 18, owner: 'player' },
  bullet: { tex: 'fireOrb', size: 0.28, halo: 0xffb040, haloSize: 0.9, gravity: 0, owner: 'enemy' },
  fireball: { tex: 'fireOrb', size: 0.8, halo: 0xff7020, haloSize: 2.6, gravity: 0, owner: 'enemy' },
  rocket: { tex: 'greenOrb', size: 0.6, halo: 0x9cff40, haloSize: 2.2, gravity: 4, owner: 'enemy' },
};

export class Projectiles {
  constructor(G) {
    this.G = G;
    const art = miscArt();
    const tex = {};
    for (const k of ['plasmaOrb', 'fireOrb', 'greenOrb']) tex[k] = nearestTexture(art[k]);
    tex.grenade = nearestTexture(art.icons.grenade);
    const haloTex = new THREE.CanvasTexture(haloCanvas('255,255,255', 64));
    this.items = [];
    for (let i = 0; i < 60; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.fireOrb, fog: false }));
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = h.visible = false;
      G.scene.add(s, h);
      this.items.push({ s, h, active: false, kind: null, vel: new THREE.Vector3(), life: 0, dmg: 0, splash: 0, splashDmg: 0, fuse: 0 });
    }
    this.tex = tex;
  }

  get(kind) {
    const p = this.items.find((q) => !q.active);
    if (!p) return null;
    const K = KINDS[kind];
    p.kind = kind;
    p.K = K;
    p.active = true;
    p.s.material.map = kind === 'grenade' ? this.tex.grenade : this.tex[K.tex];
    p.s.material.rotation = 0;
    p.s.scale.set(K.size * (kind === 'grenade' ? 2.4 : 1), K.size, 1);
    p.s.visible = true;
    p.h.visible = !!K.halo;
    if (K.halo) { p.h.material.color.set(K.halo); p.h.scale.set(K.haloSize, K.haloSize, 1); }
    return p;
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
    const G = this.G;
    const pos = at || p.s.position;
    if (p.kind === 'plasma') {
      G.fx.sparks.burst(pos, 26, 0x80e0ff, { speed: 8, life: 0.5, gravity: 2, size: 0.1 });
      G.fx.halos.spawn(pos, 0x60c0ff, 4, 0.3);
      G.fx.lights.flash(pos, 0x60c0ff, 50, 0.3, 10);
      G.damageArea(pos, p.splash, p.splashDmg, 'plasma');
      sfx.plasmaHit();
    } else if (p.kind === 'grenade' || p.kind === 'rocket') {
      G.fx.explosions.spawn(pos, p.kind === 'grenade' ? 4.2 : 3, 0.7);
      G.fx.decals.floor(pos.x, G.world.groundAt(pos.x, pos.z, pos.y + 0.5) + 0.01, pos.z, 3, 'scorch');
      G.damageArea(pos, p.splash, p.splashDmg, p.kind === 'grenade' ? 'grenade' : 'enemyRocket');
      G.player.addTrauma(Math.max(0, 0.7 - pos.distanceTo(G.camera.position) / 25));
      sfx.explosion(Math.max(0.3, 1 - pos.distanceTo(G.camera.position) / 40));
    } else {
      G.fx.sparks.burst(pos, 8, p.kind === 'fireball' ? 0xff8030 : 0xffc060, { speed: 3, life: 0.35, gravity: 4, size: 0.07 });
      if (p.kind === 'fireball') G.fx.halos.spawn(pos, 0xff6020, 2.4, 0.25);
    }
    p.active = false;
    p.s.visible = p.h.visible = false;
  }

  update(dt) {
    const G = this.G, P = G.player;
    for (const p of this.items) {
      if (!p.active) continue;
      const pos = p.s.position;
      p.vel.y -= p.K.gravity * dt;
      const prev = pos.clone();
      pos.addScaledVector(p.vel, dt);
      p.h.position.copy(pos);
      p.life -= dt;
      if (p.kind === 'grenade') {
        p.s.material.rotation += dt * 12;
        p.fuse -= dt;
        // отскок от земли и стен
        const gy = G.world.groundAt(pos.x, pos.z, prev.y + 0.2, 0.1);
        if (pos.y < gy + 0.15) {
          pos.y = gy + 0.15;
          if (Math.abs(p.vel.y) > 2) sfx.bounce();
          p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6;
        }
        if (G.world.solidAt(pos.x, pos.y, pos.z)) { pos.copy(prev); p.vel.x *= -0.4; p.vel.z *= -0.4; }
        // взрыв по таймеру или при касании врага
        if (p.fuse <= 0 || G.enemies.hitTest(pos, 0.3)) this.explode(p);
        continue;
      }
      if (p.life <= 0) { this.explode(p); continue; }
      if (G.world.solidAt(pos.x, pos.y, pos.z)) { this.explode(p, prev); continue; }
      if (p.K.owner === 'player') {
        const e = G.enemies.hitTest(pos, 0.25);
        const b = G.pickups.barrelHit(pos, 0.3);
        if (e) { G.enemies.damage(e, p.dmg, pos, 'plasma'); this.explode(p); continue; }
        if (b) { G.pickups.damageBarrel(b, p.dmg); this.explode(p); continue; }
      } else {
        // попадание в игрока (цилиндр)
        const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z;
        if (dx * dx + dz * dz < 0.5 * 0.5 && pos.y > P.pos.y && pos.y < P.pos.y + 1.9) {
          if (p.splash) this.explode(p);
          else { G.hurtPlayer(p.dmg, prev); this.explode(p); }
          continue;
        }
      }
    }
  }

  clear() { for (const p of this.items) { p.active = false; p.s.visible = p.h.visible = false; } }
}
