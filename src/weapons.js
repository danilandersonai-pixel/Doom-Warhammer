// Оружие игрока: 5 видов + гранаты. Логика стрельбы и анимация спрайта в руках.
// Спрайт рисуется на 2D-холсте поверх 3D (низкое разрешение → крупные чёткие пиксели).
import * as THREE from 'three';
import { weaponSprites } from './art_weapons.js';
import { sfx } from './audio.js';
import { miscArt } from './art_misc.js';

export const WEAPONS = {
  rifle: { slot: 1, name: 'Громовержец', delay: 0.11, dmg: 18, pellets: 1, spread: 0.014, mag: 30, reserve: 150, reserveMax: 300, reload: 1.35, kick: 0.026, shake: 0.1, splash: 1.3, splashDmg: 10, flash: 0.8 },
  shotgun: { slot: 2, name: 'Молот', delay: 0.85, dmg: 11, pellets: 11, spread: 0.08, mag: 2, reserve: 24, reserveMax: 60, reload: 1.2, kick: 0.1, shake: 0.4, flash: 1.3, semi: true },
  plasma: { slot: 3, name: 'Звезда', delay: 0.36, projectile: true, dmg: 45, splash: 2.8, splashDmg: 50, mag: 20, reserve: 40, reserveMax: 160, reload: 1.7, kick: 0.04, shake: 0.14, flash: 1 },
  thermal: { slot: 4, name: 'Термокопьё', beam: true, range: 10, dps: 340, mag: 100, reserve: 100, reserveMax: 300, burn: 24, reload: 2.0, shake: 0.05 },
  chainblade: { slot: 5, name: 'Цепной клинок', melee: true, delay: 0.45, dmg: 90, range: 2.9 },
};
export const ORDER = ['rifle', 'shotgun', 'plasma', 'thermal', 'chainblade'];
const SWING = [['windup', 0.07], ['slash', 0.09], ['follow', 0.12]]; // кадры удара клинком
export const GRENADES_MAX = 6;

export class Weapons {
  constructor(G, overlay) {
    this.G = G;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.spr = weaponSprites();
    this.ray = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.screenBlood = [];
    this.reset();
  }

  reset() {
    this.owned = new Set(['rifle', 'shotgun', 'chainblade']);
    this.ammo = {};
    for (const [k, w] of Object.entries(WEAPONS)) this.ammo[k] = { mag: w.mag || 0, reserve: w.reserve || 0 };
    this.current = 'rifle';
    this.pending = null;     // оружие, на которое переключаемся
    this.switchT = 0;        // 0..1 — опускание/подъём при смене
    this.cooldown = 0;
    this.reloadT = 0;
    this.recoil = 0;
    this.flashT = 0;
    this.swingT = -1;        // удар клинком (свой или быстрый)
    this.swingHit = false;
    this.throwT = 0;
    this.grenades = 3;
    this.beamOn = false;
    this.teeth = 0;
    this.semiLatch = false;
    this.screenBlood = [];
  }

  get def() { return WEAPONS[this.current]; }
  get reloading() { return this.reloadT > 0; }

  give(kind) {
    const isNew = !this.owned.has(kind);
    this.owned.add(kind);
    const a = this.ammo[kind], w = WEAPONS[kind];
    a.reserve = Math.min(w.reserveMax, a.reserve + (w.mag || 0) * 2);
    if (isNew) this.select(kind);
    return isNew;
  }

  // Подбор патронов: каждому оружию доля запаса
  addAmmo() {
    for (const k of ORDER) {
      const w = WEAPONS[k];
      if (!w.mag) continue;
      this.ammo[k].reserve = Math.min(w.reserveMax, this.ammo[k].reserve + Math.round(w.reserveMax * 0.3));
    }
  }

  select(kind) {
    if (!this.owned.has(kind) || (kind === this.current && !this.pending)) return;
    this.pending = kind;
    this.reloadT = 0;
  }

  cycle(step) {
    const list = ORDER.filter((k) => this.owned.has(k));
    const i = list.indexOf(this.pending || this.current);
    this.select(list[(i + step + list.length) % list.length]);
  }

  startReload() {
    const w = this.def, a = this.ammo[this.current];
    if (!w.mag || this.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    this.reloadT = w.reload;
    sfx.reload(this.current);
  }

  update(dt, input, time) {
    const G = this.G, P = G.player;
    this.cooldown -= dt;
    this.flashT -= dt;
    this.recoil *= Math.exp(-14 * dt);
    this.teeth += dt * 60;

    // смена оружия: опускаем, меняем, поднимаем
    if (input.take('swap')) this.cycle(1);
    if (input.take('next')) this.cycle(1);
    if (input.take('prev')) this.cycle(-1);
    for (let i = 1; i <= 5; i++) if (input.take('w' + i)) this.select(ORDER[i - 1]);
    if (this.pending) {
      this.switchT = Math.min(1, this.switchT + dt * 7);
      if (this.switchT >= 1) { this.current = this.pending; this.pending = null; sfx.swap(); }
    } else this.switchT = Math.max(0, this.switchT - dt * 6);

    // перезарядка
    if (input.take('reload')) {
      // на телефоне одна кнопка "R": если перезаряжать нечего — смена оружия
      const a = this.ammo[this.current], w = this.def;
      if (!w.mag || a.mag >= w.mag || a.reserve <= 0) { if (G.isTouch) this.cycle(1); } else this.startReload();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.ammo[this.current], need = this.def.mag - a.mag, take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }

    // граната
    if (input.take('grenade') && this.grenades > 0 && this.throwT <= 0 && this.swingT < 0) {
      this.grenades--;
      this.throwT = 0.35;
      G.projectiles.throwGrenade();
      sfx.throw();
    }
    this.throwT -= dt;

    // ближний бой: цепной клинок с любым оружием в руках
    if (input.take('melee') && this.swingT < 0 && this.switchT <= 0.01) this.startSwing();
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (!this.swingHit && this.swingT > SWING[0][1]) { this.swingHit = true; this.meleeHit(); }
      if (this.swingT > SWING.reduce((s, f) => s + f[1], 0) + 0.12) this.swingT = -1;
    }

    // стрельба
    const w = this.def;
    const busy = this.switchT > 0.01 || this.reloadT > 0 || this.swingT >= 0 || this.throwT > 0;
    this.beamOn = false;
    if (!input.fire) this.semiLatch = false;
    if (input.fire && !busy && this.cooldown <= 0) {
      if (w.melee) this.startSwing();
      else if (w.beam) this.fireBeam(dt, time);
      else if (!(w.semi && this.semiLatch)) this.fire();
    }
    if (w.beam) {
      if (this.beamOn) sfx.beam(true); else sfx.beam(false);
    } else sfx.beam(false);
    if (!this.beamOn) G.fx.beams.beam(null, null, false);
  }

  startSwing() {
    this.swingT = 0;
    this.swingHit = false;
    this.cooldown = WEAPONS.chainblade.delay;
    sfx.chainSwing();
  }

  // Точка дула в мире (для трассеров и света)
  muzzleWorld() {
    return this.tmp.set(0.18, -0.2, -0.7).applyMatrix4(this.G.camera.matrixWorld).clone();
  }

  aimDir(spread) {
    const cam = this.G.camera;
    this.dir.set((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, -1).normalize();
    return this.dir.applyQuaternion(cam.quaternion).clone();
  }

  fire() {
    const G = this.G, w = this.def, a = this.ammo[this.current];
    if (a.mag <= 0) {
      if (a.reserve > 0) this.startReload();
      else { sfx.empty(); this.cooldown = 0.3; }
      return;
    }
    a.mag--;
    this.cooldown = w.delay;
    this.semiLatch = true;
    this.recoil = 1;
    this.flashT = 0.06;
    G.player.kick += w.kick;
    G.player.addTrauma(w.shake);
    const muzzle = this.muzzleWorld();
    G.fx.lights.flash(muzzle, this.current === 'plasma' ? 0x60d0ff : 0xffa040, 28 * w.flash, 0.07, 14);
    sfx.shot(this.current);
    if (w.projectile) {
      G.projectiles.playerPlasma(muzzle, this.aimDir(0.004), w);
    } else {
      const origin = G.camera.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < w.pellets; i++) {
        const d = this.aimDir(w.spread);
        const hit = G.hitscan(origin, d, 120);
        const end = hit ? hit.point : origin.clone().addScaledVector(d, 60);
        if (i < 3) G.fx.beams.tracer(muzzle, end, 0xffd080, this.current === 'shotgun' ? 0.025 : 0.04);
        if (hit) G.applyHit(hit, w.dmg, d, this.current);
        // разрывной патрон
        if (hit && w.splash) {
          G.fx.explosions.spawn(hit.point, 0.9, 0.35);
          G.damageArea(hit.point, w.splash, w.splashDmg, 'rifle', hit.enemy);
          sfx.impact(0.5);
        }
      }
    }
    if (a.mag === 0 && a.reserve > 0) setTimeout(() => this.startReload(), 250);
  }

  fireBeam(dt, time) {
    const G = this.G, w = this.def, a = this.ammo[this.current];
    if (a.mag <= 0) { if (a.reserve > 0) this.startReload(); return; }
    this.beamOn = true;
    a.mag = Math.max(0, a.mag - w.burn * dt);
    if (a.mag <= 0) { a.mag = 0; this.startReload(); }
    this.flashT = 0.05;
    G.player.addTrauma(w.shake * dt * 10);
    const origin = G.camera.getWorldPosition(new THREE.Vector3());
    const d = this.aimDir(0);
    const hit = G.hitscan(origin, d, w.range);
    const end = hit ? hit.point : origin.clone().addScaledVector(d, w.range);
    const muzzle = this.muzzleWorld();
    G.fx.beams.beam(muzzle, end, true, time);
    G.fx.lights.flash(end, 0xff7020, 22, 0.06, 7);
    if (Math.random() < 0.6) G.fx.sparks.burst(end, 3, 0xffa040, { speed: 4, life: 0.5, gravity: -1, size: 0.08 });
    if (hit) {
      G.applyHit(hit, w.dps * dt, d, 'thermal', true);
      G.damageArea(hit.point, 1.0, w.dps * dt * 0.4, 'thermal', hit.enemy, true);
    }
  }

  // Удар цепным клинком: всё в конусе перед игроком
  meleeHit() {
    const G = this.G, P = G.player, f = P.forward(), w = WEAPONS.chainblade;
    let hits = 0;
    for (const e of G.enemies.list) {
      if (e.dead || !e.active) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 0.01;
      if (d - e.radius > w.range || Math.abs(e.pos.y - P.pos.y) > 2.2) continue;
      if ((dx * f.x + dz * f.z) / d < 0.45) continue;
      const killed = G.enemies.damage(e, w.dmg, { x: e.pos.x - dx / d * e.radius, y: e.pos.y + e.height * 0.55, z: e.pos.z - dz / d * e.radius }, 'chainblade', { x: dx / d, y: 0, z: dz / d });
      G.enemies.knockback(e, dx / d, dz / d, e.type === 'boss' ? 2 : 10);
      hits++;
      if (killed || Math.random() < 0.5) this.splatterScreen(killed ? 14 : 6);
    }
    for (const b of G.pickups.barrels) {
      if (b.dead) continue;
      const dx = b.x - P.pos.x, dz = b.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < w.range && (dx * f.x + dz * f.z) / d > 0.45) G.pickups.damageBarrel(b, w.dmg);
    }
    if (hits) { sfx.chainHit(); P.addTrauma(0.3); G.hud.hitmarker(false); }
  }

  // Брызги крови на экране
  splatterScreen(n) {
    for (let i = 0; i < n; i++) {
      const big = i < 3;
      this.screenBlood.push({
        x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.65,
        s: big ? 1.4 + Math.random() * 1.6 : 0.35 + Math.random() * 0.6,   // масштаб кляксы
        rot: Math.floor(Math.random() * 4), img: (Math.random() * 4) | 0,
        a: big ? 0.55 : 0.9,                                            // крупные — полупрозрачные
        life: 1 + Math.random() * 0.9, drip: 0,
      });
    }
  }

  // ---------- Рисование спрайта оружия на оверлее ----------
  draw(dt, time) {
    const c = this.overlay, g = this.ctx, P = this.G.player;
    const OH = c.height, OW = c.width;
    g.clearRect(0, 0, OW, OH);
    g.imageSmoothingEnabled = false;
    if (P.dead) return;

    const k = this.current, set = this.spr[k];
    let frame = set.idle;
    if (k === 'chainblade') frame = Math.floor(this.teeth / 3) % 2 ? set.idle2 : set.idle;
    if (k === 'plasma') frame = this.flashT > 0 ? set.fire : Math.floor(time * 4) % 2 ? set.idle2 : set.idle;
    if (k === 'thermal' && this.beamOn) frame = set.fire;
    if (k === 'rifle' && this.recoil > 0.5) frame = set.fire;
    if (k === 'shotgun' && this.reloadT > 0) frame = set.reload;

    // смещения: покачивание, отдача, смена, перезарядка
    const bob = P.speed01 * (P.onGround ? 1 : 0.3);
    let x = OW / 2 - 96 + 34 + Math.cos(P.bob) * 5 * bob;
    let y = OH - 144 + 22 + Math.abs(Math.sin(P.bob)) * 5 * bob + this.recoil * 9 + Math.sin(time * 1.7) * 1.2;
    y += this.switchT * 150;
    let rot = 0;
    if (this.reloadT > 0 && k !== 'shotgun') {
      const p = 1 - this.reloadT / this.def.reload, s = Math.sin(p * Math.PI);
      y += s * 46; rot = -s * 0.35;
    }
    if (k === 'shotgun' && this.reloadT > 0) y += Math.sin((1 - this.reloadT / this.def.reload) * Math.PI) * 18;
    // в прыжке оружие чуть "отстаёт"
    y += Math.max(-8, Math.min(10, P.vel.y * -0.8));

    // удар клинком (собственный или быстрый) заменяет кадр
    if (this.swingT >= 0) {
      let t = this.swingT, name = null;
      for (const [n, d] of SWING) { if (t < d) { name = n; break; } t -= d; }
      frame = this.spr.chainblade[name || 'idle'];
      if (!name) y += (this.swingT - 0.28) * 300;
      if (k !== 'chainblade' && !name) frame = null;
      x = OW / 2 - 96 + 34; rot = 0;
      if (k !== 'chainblade') y = OH - 144 + 22;
    }
    if (this.throwT > 0) { frame = this.spr.throwHand; x = OW / 2 - 96 + 40; y = OH - 144 + 22 + (0.35 - this.throwT) * -40; rot = 0; }

    if (frame) {
      g.save();
      g.translate(Math.round(x + 96), Math.round(y + 144));
      if (rot) g.rotate(rot);
      g.drawImage(frame, -96, -144);
      g.restore();
    }

    // вспышка выстрела (аддитивно): лучи + ореол
    if (this.flashT > 0 && frame && this.swingT < 0 && !this.def.melee) {
      const [mx, my] = set.muzzle;
      const fx = Math.round(x + mx), fy = Math.round(y + my);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const blue = k === 'plasma';
      const halo = g.createRadialGradient(fx, fy, 0, fx, fy, 60);
      halo.addColorStop(0, blue ? 'rgba(140,220,255,0.7)' : k === 'thermal' ? 'rgba(255,140,60,0.6)' : 'rgba(255,190,90,0.7)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = halo;
      g.fillRect(fx - 60, fy - 60, 120, 120);
      if (k !== 'thermal') {
        const fl = blue ? this.spr.flashBlue : this.spr.flash[Math.floor(time * 60) % 2];
        const s = k === 'shotgun' ? 1.3 : 1;
        g.translate(fx, fy - 6);
        g.rotate((Math.floor(Math.random() * 4) * Math.PI) / 4);
        g.drawImage(fl, -40 * s, -40 * s, 80 * s, 80 * s);
      }
      g.restore();
    }

    // кровь на экране: рваные пиксельные кляксы (спрайты брызг), стекают и тают
    const splats = miscArt().splats;
    for (let i = this.screenBlood.length - 1; i >= 0; i--) {
      const b = this.screenBlood[i];
      b.life -= dt;
      b.drip += dt * 6;
      if (b.life <= 0) { this.screenBlood.splice(i, 1); continue; }
      const size = 64 * b.s, cx = Math.round(b.x * OW), cy = Math.round(b.y * OH + b.drip);
      g.globalAlpha = Math.min(1, b.life * 1.4) * b.a;
      g.save();
      g.translate(cx, cy);
      g.rotate(b.rot * Math.PI / 2);
      g.drawImage(splats[b.img], -size / 2, -size / 2, size, size);
      g.restore();
      g.globalAlpha = 1;
    }
  }
}
