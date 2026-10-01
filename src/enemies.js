// Враги: фанатик (бегун), стрелок, тяжёлый демон (рывок), босс «Колосс» с тремя фазами.
// Каждый — спрайт-билборд из запечённого атласа (3D-модель → 8 ракурсов → пиксели, tools/bake_sprites.mjs):
// кадр выбирается по анимации и по углу между взглядом врага и камерой, как в Doom. Плюс невидимый хитбокс и тень.
import * as THREE from 'three';
import { SPRITES, spriteTexture, setSpriteFrame, viewDir, spriteGeometry } from './sprites.js';
import { sfx } from './audio.js';

export const TYPES = {
  fanatic: { hp: 55, speed: 7.4, radius: 0.42, height: 1.85, dmg: 9, range: 1.7, windup: 0.26, cooldown: 0.75, walkFps: 13 },
  gunner: { hp: 70, speed: 3.6, radius: 0.42, height: 1.85, fireDelay: 1.9, burst: 3, bulletDmg: 6, keepMin: 7, keepMax: 16, walkFps: 9, muzzle: [0.85, -0.3, 1.2] },
  heavy: { hp: 420, speed: 2.5, radius: 0.85, height: 2.8, dmg: 26, range: 2.7, windup: 0.42, cooldown: 1.3, walkFps: 8 },
  boss: { hp: 2000, speed: 2.7, radius: 1.6, height: 6.0, dmg: 32, range: 4.2, windup: 0.55, cooldown: 1.6, walkFps: 7, muzzle: [2.4, 1.3, 3.2] },
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HIDDEN = new THREE.MeshBasicMaterial();
const SHADOW_GEO = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x1a2030, transparent: true, opacity: 0.32, depthWrite: false });
// Маршруты на платформу: низ лестницы -> верх
const STAIRS = [{ bottom: { x: 0, z: -6.4 }, top: { x: 0, z: -12 } }, { bottom: { x: -16.6, z: -16 }, top: { x: -11.4, z: -16 } }];

export class Enemies {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.corpses = [];
    this.sheets = {};
    for (const t of Object.keys(TYPES)) this.sheets[t] = SPRITES[t];
    this.tmp = new THREE.Vector3();
    this.camRight = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.minionTimer = 0;
  }

  get alive() { return this.list.filter((e) => !e.dead); }
  get aliveCount() { let n = 0; for (const e of this.list) if (!e.dead) n++; return n; }
  get boss() { return this.list.find((e) => e.type === 'boss') || null; }

  spawn(type, x, y, z, { silent = false } = {}) {
    const t = TYPES[type], sh = this.sheets[type];
    const map = spriteTexture(sh);
    const mat = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0x3a3434, alphaTest: 0.5, side: THREE.DoubleSide });
    const sprite = new THREE.Mesh(spriteGeometry(sh), mat);
    const group = new THREE.Group();
    group.add(sprite);
    const hitbox = new THREE.Mesh(BOX, HIDDEN);
    hitbox.visible = false;
    hitbox.scale.set(t.radius * 2, t.height, t.radius * 2);
    hitbox.position.y = t.height / 2;
    group.add(hitbox);
    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.scale.setScalar(t.radius * 1.3);
    shadow.position.y = 0.02;
    group.add(shadow);
    group.position.set(x, y, z);
    this.G.scene.add(group);
    const e = {
      type, t, sheet: sh, group, sprite, map, mat, hitbox, shadow,
      pos: { x, y, z }, vy: 0, hp: t.hp, maxHp: t.hp, radius: t.radius, height: t.height,
      dead: false, active: false, spawnT: 0, flashT: 0, painT: 0, stunT: 0,
      state: 'chase', stateT: 0, cooldown: 0.6 + Math.random() * 0.6, fireT: 1 + Math.random() * 1.5, burst: 0,
      walk: Math.random() * 4, moving: false, strafe: Math.random() < 0.5 ? -1 : 1, strafeT: 1 + Math.random() * 2,
      avoid: 0, avoidT: 0, kb: { x: 0, z: 0 }, chargeDir: null, deathT: 0, yaw: Math.random() * 6.28, dir: 0,
      cryT: 2 + Math.random() * 4, phase: 1, summonT: 10, spiralT: 6, attackKind: null, frame: 0,
    };
    hitbox.userData.enemy = e;
    this.list.push(e);
    if (!silent) this.spawnFx(x, y, z, type === 'boss' ? 3 : type === 'heavy' ? 1.6 : 1);
    return e;
  }

  // Эффект появления: тёмно-багровый варп-всплеск
  spawnFx(x, y, z, k) {
    const fx = this.G.fx, p = { x, y: y + 0.6 * k, z };
    fx.sparks.burst(p, Math.round(40 * k), 0xc040ff, { speed: 5 * k, life: 0.8, gravity: -3, size: 0.08, up: 1.5 });
    fx.dust.burst(p, Math.round(12 * k), 0x40204a, { speed: 2, life: 1.0, gravity: -1, size: 0.5 * k, alpha: 0.7 });
    fx.halos.spawn(p, 0xa040ff, 3.5 * k, 0.4);
    fx.lights.flash(p, 0xa050ff, 25 * k, 0.3, 8);
    sfx.spawn(this.volumeAt(p));
  }

  hitboxes() {
    const out = [];
    for (const e of this.list) {
      if (e.dead || !e.active) continue;
      e.group.updateMatrixWorld();
      out.push(e.hitbox);
    }
    return out;
  }

  // Враг, в цилиндр которого попала точка (для снарядов)
  hitTest(p, r) {
    for (const e of this.list) {
      if (e.dead || !e.active) continue;
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
      if (dx * dx + dz * dz < (e.radius + r) ** 2 && p.y > e.pos.y - r && p.y < e.pos.y + e.height + r) return e;
    }
    return null;
  }

  volumeAt(p) {
    const P = this.G.player.pos;
    return Math.max(0.12, 1 - Math.hypot(p.x - P.x, p.z - P.z) / 40);
  }

  // Урон врагу. source: 'rifle' | 'shotgun' | 'plasma' | 'thermal' | 'chainblade' | 'grenade' | 'barrel'
  damage(e, amount, point, source, dir = null) {
    if (e.dead || !e.active) return false;
    const G = this.G;
    e.hp -= amount;
    e.flashT = 0.08;
    if (e.type === 'heavy' || e.type === 'boss') this.lastElite = e;
    const small = source === 'thermal';
    if (!small || Math.random() < 0.15) G.fx.bloodBurst(point, e.type === 'boss' ? 0.6 : 0.8, dir ? { x: dir.x * 2, y: 1, z: dir.z * 2 } : null);
    if (source === 'thermal' && Math.random() < 0.3) G.fx.sparks.burst(point, 3, 0xffa040, { speed: 2, life: 0.4, gravity: -2, size: 0.06 });
    // брызги на стену за врагом
    if (dir && !small && Math.random() < 0.8) this.wallSplat(point, dir);
    // реакция на попадание
    if (e.type !== 'boss' && (e.type !== 'heavy' || Math.random() < 0.25) && amount >= 10) {
      e.painT = 0.14;
      e.stunT = e.type === 'heavy' ? 0.15 : 0.1;
      if (Math.random() < 0.3) sfx.enemyPain(e.type, this.volumeAt(e.pos));
    }
    if (e.hp > 0) return false;
    this.kill(e, source, amount);
    return true;
  }

  wallSplat(point, dir) {
    const G = this.G;
    this.ray.set(this.tmp.set(point.x, point.y, point.z), new THREE.Vector3(dir.x, dir.y || 0, dir.z).normalize());
    this.ray.far = 3.5;
    const h = this.ray.intersectObjects(G.level.solid, false)[0];
    if (h && h.face) G.fx.decals.add(h.point, h.face.normal.clone().transformDirection(h.object.matrixWorld), 1 + Math.random() * 1.2);
  }

  kill(e, source, amount) {
    const G = this.G;
    e.dead = true;
    e.deathT = 0;
    e.hitbox.visible = false;
    const c = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    const explosive = source === 'grenade' || source === 'plasma' || source === 'barrel' || source === 'rifle';
    // разрыв на куски: взрывом, при большом перебитии, или клинком/дробью вблизи
    e.gibbed = e.type !== 'boss' && (explosive && (e.hp < -12 || Math.random() < 0.45)) || (e.type === 'fanatic' && (source === 'chainblade' || source === 'shotgun') && Math.random() < 0.5);
    if (e.type === 'boss') { e.gibbed = false; sfx.bossDeath(); }
    else sfx.enemyDeath(e.type, this.volumeAt(e.pos));
    if (e.gibbed) this.gib(e);
    else G.fx.bloodBurst(c, 1.6);
    // убийство вблизи — кровь на экран
    const pd = Math.hypot(e.pos.x - G.player.pos.x, e.pos.z - G.player.pos.z);
    if (pd < 4.5 && e.type !== 'boss') G.weapons.splatterScreen(Math.round((e.gibbed ? 16 : 9) * (1.3 - pd / 4.5)));
    const gy = G.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.3, 0.2, true);
    G.fx.decals.floor(e.pos.x, gy + 0.01, e.pos.z, e.type === 'heavy' ? 3.2 : 2.2 + Math.random());
    G.onEnemyKilled(e);
  }

  gib(e) {
    const G = this.G, c = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    const k = e.type === 'heavy' ? 2 : e.type === 'boss' ? 4 : 1;
    G.fx.gibs.burst(c, 8 * k, 7, 0.35 * Math.sqrt(k), e.pos.y);
    G.fx.bloodBurst(c, 2.5 * k);
    G.fx.blood.burst(c, 45 * k, 0xe21b22, { speed: 11, life: 1.3, gravity: 16, size: 0.16, sizeVar: 1.8, up: 0.6 });
    G.fx.blood.burst(c, 18 * k, 0xff6670, { speed: 4, life: 0.9, gravity: 5, size: 0.6, sizeVar: 1, alpha: 0.5 });
    e.sprite.visible = false;
    e.shadow.visible = false;
  }

  knockback(e, dx, dz, force) { e.kb.x += dx * force; e.kb.z += dz * force; }

  // Видно ли игрока из точки (луч по геометрии уровня)
  canSee(from, to) {
    const d = this.tmp.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const dist = d.length();
    this.ray.set(new THREE.Vector3(from.x, from.y, from.z), d.normalize());
    this.ray.far = dist;
    return this.ray.intersectObjects(this.G.level.solid, false).length === 0;
  }

  // Куда идти: напрямую к цели или через лестницу на платформу
  goal(e, P) {
    const PH = this.G.level.PH;
    if (P.pos.y > PH - 0.3 && e.pos.y < 0.5 && Math.abs(P.pos.y - e.pos.y) > 0.8) {
      const s = STAIRS.reduce((a, b) => (Math.hypot(a.bottom.x - e.pos.x, a.bottom.z - e.pos.z) < Math.hypot(b.bottom.x - e.pos.x, b.bottom.z - e.pos.z) ? a : b));
      const db = Math.hypot(s.bottom.x - e.pos.x, s.bottom.z - e.pos.z);
      return db > 1.5 && !e.onStairs ? s.bottom : (e.onStairs = true, s.top);
    }
    e.onStairs = false;
    return P.pos;
  }

  steer(e, dx, dz, dt) {
    const W = this.G.world, look = 1.1 + e.radius;
    const blocked = (x, z) => W.blockedFor(e.pos.x + x * look, e.pos.z + z * look, e.pos.y, e.radius * 0.8);
    e.avoidT -= dt;
    const rot = (a) => [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
    if (e.avoidT > 0 && e.avoid) { const [rx, rz] = rot(e.avoid); if (!blocked(rx, rz)) return { x: rx, z: rz }; }
    if (!blocked(dx, dz)) { e.avoid = 0; return { x: dx, z: dz }; }
    for (const a of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8]) {
      const [rx, rz] = rot(a * (e.strafe || 1));
      if (!blocked(rx, rz)) { e.avoid = a * (e.strafe || 1); e.avoidT = 0.7; return { x: rx, z: rz }; }
    }
    return { x: dx, z: dz };
  }

  update(dt, time) {
    const G = this.G, P = G.player, cam = G.camera;
    this.camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    for (const e of this.list) {
      if (e.dead) { this.updateDeath(e, dt, time); continue; }
      // появление: враг "вырастает" из варп-всплеска
      if (!e.active) {
        e.spawnT += dt;
        e.group.scale.set(1, Math.min(1, e.spawnT / 0.45), 1);
        if (e.spawnT >= 0.45) e.active = true;
        this.place(e, cam);
        continue;
      }
      e.flashT -= dt; e.painT -= dt; e.stunT -= dt; e.cooldown -= dt; e.stateT += dt;
      e.cryT -= dt;
      if (e.cryT <= 0) { e.cryT = 3 + Math.random() * 5; sfx.enemyCry(e.type, this.volumeAt(e.pos)); }
      const tgt = this.goal(e, P);
      const dx = tgt.x - e.pos.x, dz = tgt.z - e.pos.z, dist = Math.hypot(dx, dz) || 0.01;
      const pdx = P.pos.x - e.pos.x, pdz = P.pos.z - e.pos.z, pdist = Math.hypot(pdx, pdz) || 0.01;
      const vdist = Math.abs(P.pos.y - e.pos.y);
      let move = null, speed = e.t.speed;
      if (e.stunT <= 0) {
        if (e.type === 'fanatic') move = this.aiMelee(e, P, dx / dist, dz / dist, pdist, vdist, dt);
        else if (e.type === 'gunner') ({ move, speed } = this.aiGunner(e, P, dx / dist, dz / dist, pdist, dt, speed));
        else if (e.type === 'heavy') ({ move, speed } = this.aiHeavy(e, P, dx / dist, dz / dist, pdist, vdist, dt, speed));
        else ({ move, speed } = this.aiBoss(e, P, dx / dist, dz / dist, pdist, vdist, dt, speed, time));
      }
      e.moving = !!move;
      // защита от застревания: 2 с почти без движения — уходим в случайную сторону
      e.stuckT = (e.stuckT || 0) + dt;
      if (e.stuckT > 2) {
        const moved = Math.hypot(e.pos.x - (e.lastX ?? e.pos.x), e.pos.z - (e.lastZ ?? e.pos.z));
        if (move && moved < 0.6) { const a = Math.random() * Math.PI * 2; e.escape = { x: Math.cos(a), z: Math.sin(a) }; e.escapeT = 1; }
        e.stuckT = 0; e.lastX = e.pos.x; e.lastZ = e.pos.z;
      }
      if (e.escapeT > 0 && move) { e.escapeT -= dt; move = e.escape; }
      // куда смотрит: по ходу движения, в бою и на месте — на игрока
      let face = Math.atan2(pdx, pdz);
      if (move) {
        const d = e.state === 'charge' ? move : this.steer(e, move.x, move.z, dt);
        e.pos.x += d.x * speed * dt;
        e.pos.z += d.z * speed * dt;
        e.walk += dt * e.t.walkFps * (speed / e.t.speed);
        if (e.type !== 'gunner' && e.type !== 'boss') face = Math.atan2(d.x, d.z);
      }
      let da = face - e.yaw;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      e.yaw += da * (1 - Math.exp(-(e.type === 'boss' ? 4 : 10) * dt));
      e.pos.x += e.kb.x * dt; e.pos.z += e.kb.z * dt;
      const damp = Math.exp(-7 * dt);
      e.kb.x *= damp; e.kb.z *= damp;
    }
    this.separate(P);
    for (const e of this.list) {
      if (e.dead || !e.active) continue;
      G.world.resolve(e.pos, e.radius, e.height, true);
      // гравитация и ступеньки
      const g = G.world.groundAt(e.pos.x, e.pos.z, e.pos.y, e.radius * 0.6, true);
      if (e.pos.y > g + 0.02) { e.vy -= 20 * dt; e.pos.y = Math.max(g, e.pos.y + e.vy * dt); } else { e.pos.y = g; e.vy = 0; }
      this.place(e, cam);
      this.animate(e, time);
    }
  }

  place(e, cam) {
    e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
    e.group.rotation.y = Math.atan2(cam.position.x - e.pos.x, cam.position.z - e.pos.z);
  }

  // Ближний бой: несётся к игроку, замах, удар
  aiMelee(e, P, nx, nz, pdist, vdist, dt) {
    if (e.state === 'attack') {
      if (e.stateT >= e.t.windup) {
        if (pdist < e.t.range + 0.6 && vdist < 1.5) this.G.hurtPlayer(e.t.dmg, e.pos);
        e.state = 'chase'; e.stateT = 0; e.cooldown = e.t.cooldown;
        sfx.enemySwing(this.volumeAt(e.pos));
      }
      return null;
    }
    if (pdist < e.t.range + e.radius && vdist < 1.5 && e.cooldown <= 0) { e.state = 'attack'; e.stateT = 0; return null; }
    if (pdist < e.t.range * 0.8 && vdist < 1.5) return null;
    return { x: nx, z: nz };
  }

  // Стрелок: держит дистанцию, ходит боком, стреляет очередями
  aiGunner(e, P, nx, nz, pdist, dt, speed) {
    const G = this.G;
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 1.4 + Math.random() * 2; }
    if (e.state === 'shoot') {
      if (e.stateT > 0.32) {
        e.stateT = 0;
        e.burst--;
        const m = this.muzzlePos(e);
        G.projectiles.enemyShot('bullet', m, { x: P.pos.x, y: P.pos.y + 1.2, z: P.pos.z }, { speed: 24, dmg: e.t.bulletDmg, spread: 0.06 });
        G.fx.lights.flash(m, 0xffa040, 30, 0.08, 9);
        G.fx.halos.spawn(m, 0xffb040, 1.6, 0.09);
        e.shotT = 0.09;
        sfx.enemyShot(this.volumeAt(e.pos));
        if (e.burst <= 0) { e.state = 'chase'; e.fireT = e.t.fireDelay * (0.8 + Math.random() * 0.5); }
      }
      return { move: null, speed };
    }
    e.fireT -= dt;
    let mx, mz;
    const sx = -nz * e.strafe, sz = nx * e.strafe;
    if (pdist > e.t.keepMax || e.seekT > 0) { mx = nx; mz = nz; }
    else if (pdist < e.t.keepMin) { mx = -nx * 0.8 + sx * 0.5; mz = -nz * 0.8 + sz * 0.5; }
    else { mx = sx; mz = sz; speed *= 0.7; }
    e.seekT = (e.seekT || 0) - dt;
    if (e.fireT <= 0) {
      const eye = { x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z };
      if (pdist < 32 && this.canSee(eye, { x: P.pos.x, y: P.pos.y + 1.4, z: P.pos.z })) { e.state = 'shoot'; e.stateT = 0.1; e.burst = e.t.burst; }
      else { e.fireT = 0.5; e.seekT = 1.5; }
    }
    return { move: { x: mx, z: mz }, speed };
  }

  // Тяжёлый демон: медленный, живучий, рывок-таран
  aiHeavy(e, P, nx, nz, pdist, vdist, dt, speed) {
    const G = this.G;
    if (e.state === 'charge') {
      if (e.stateT > 1.0 || G.world.blockedFor(e.pos.x + e.chargeDir.x * 1.5, e.pos.z + e.chargeDir.z * 1.5, e.pos.y, e.radius * 0.7)) {
        e.state = 'recover'; e.stateT = 0;
        G.player.addTrauma(Math.max(0, 0.4 - pdist / 30));
        return { move: null, speed };
      }
      if (pdist < e.radius + 0.9 && vdist < 1.5 && !e.chargeHit) {
        e.chargeHit = true;
        G.hurtPlayer(e.t.dmg, e.pos);
        G.player.vel.x += e.chargeDir.x * 14; G.player.vel.z += e.chargeDir.z * 14; G.player.vel.y = 4;
      }
      return { move: e.chargeDir, speed: 13 };
    }
    if (e.state === 'recover') { if (e.stateT > 0.7) { e.state = 'chase'; e.cooldown = 2.5; } return { move: null, speed }; }
    if (e.state === 'attack') {
      if (e.stateT >= e.t.windup) {
        if (pdist < e.t.range + 0.8 && vdist < 2) this.G.hurtPlayer(e.t.dmg, e.pos);
        e.state = 'chase'; e.stateT = 0; e.cooldown = e.t.cooldown;
        sfx.enemySwing(this.volumeAt(e.pos));
      }
      return { move: null, speed };
    }
    if (pdist < e.t.range + e.radius && vdist < 2 && e.cooldown <= 0) { e.state = 'attack'; e.stateT = 0; return { move: null, speed }; }
    if (pdist > 5 && pdist < 14 && vdist < 1 && e.cooldown <= 0 && this.canSee({ x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z }, { x: P.pos.x, y: P.pos.y + 1, z: P.pos.z })) {
      const ddx = P.pos.x - e.pos.x, ddz = P.pos.z - e.pos.z, l = Math.hypot(ddx, ddz);
      e.state = 'charge'; e.stateT = 0; e.chargeDir = { x: ddx / l, z: ddz / l }; e.chargeHit = false;
      sfx.heavyRoar(this.volumeAt(e.pos));
      return { move: null, speed };
    }
    return { move: { x: nx, z: nz }, speed };
  }

  // Босс: фаза 1 — веер огня и удар; фаза 2 — ракеты и призыв фанатиков; фаза 3 — ярость, спираль
  aiBoss(e, P, nx, nz, pdist, vdist, dt, speed, time) {
    const G = this.G, frac = e.hp / e.maxHp;
    const phase = frac > 0.6 ? 1 : frac > 0.3 ? 2 : 3;
    if (phase !== e.phase) {
      e.phase = phase;
      G.onBossPhase(phase);
      sfx.bossRoar();
      G.player.addTrauma(0.5);
    }
    const rage = phase === 3 ? 1.5 : 1;
    speed *= phase === 3 ? 1.35 : 1;
    if (e.state === 'attack') {
      if (e.stateT >= e.t.windup) {
        // удар клешнёй + ударная волна
        if (pdist < e.t.range + 1.5) { G.hurtPlayer(e.t.dmg, e.pos); G.player.vel.x += nx * 10; G.player.vel.z += nz * 10; G.player.vel.y = 5; }
        G.fx.dust.burst({ x: e.pos.x + nx * 2, y: e.pos.y + 0.2, z: e.pos.z + nz * 2 }, 30, 0xdde4ee, { speed: 7, life: 0.9, gravity: 2, size: 0.4, alpha: 0.8 });
        G.player.addTrauma(0.5);
        sfx.explosion(0.6);
        e.state = 'chase'; e.stateT = 0; e.cooldown = e.t.cooldown / rage;
      }
      return { move: null, speed };
    }
    if (e.state === 'volley') {
      // залп: веер огненных шаров (или ракеты во 2-й фазе)
      if (e.stateT > 0.35 && !e.fired) {
        e.fired = true;
        const m = this.muzzlePos(e), target = { x: P.pos.x, y: P.pos.y + 1, z: P.pos.z };
        if (e.attackKind === 'rockets') {
          for (let i = 0; i < 3; i++) {
            const off = (i - 1) * 2.5;
            G.projectiles.enemyShot('rocket', m, { x: target.x - nz * off, y: target.y, z: target.z + nx * off }, { speed: 13, dmg: 0, spread: 0.02, splash: 3.2, splashDmg: 24, lob: 3 });
          }
        } else if (e.attackKind === 'spiral') {
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + time;
            G.projectiles.enemyShot('fireball', m, { x: m.x + Math.cos(a) * 10, y: m.y - 1.2, z: m.z + Math.sin(a) * 10 }, { speed: 11, dmg: 12, spread: 0 });
          }
        } else {
          const n = phase === 3 ? 7 : 5;
          for (let i = 0; i < n; i++) {
            const a = (i - (n - 1) / 2) * 0.14;
            const tx = P.pos.x - e.pos.x, tz = P.pos.z - e.pos.z;
            const rx = tx * Math.cos(a) - tz * Math.sin(a), rz = tx * Math.sin(a) + tz * Math.cos(a);
            G.projectiles.enemyShot('fireball', m, { x: e.pos.x + rx, y: target.y, z: e.pos.z + rz }, { speed: 14 * (phase === 3 ? 1.2 : 1), dmg: 12, spread: 0 });
          }
        }
        G.fx.lights.flash(m, 0xff8030, 60, 0.15, 16);
        G.fx.halos.spawn(m, 0xffa040, 4, 0.15);
        e.shotT = 0.15;
        sfx.bossShot();
      }
      if (e.stateT > 0.75) { e.state = 'chase'; e.stateT = 0; }
      return { move: null, speed };
    }
    // призыв фанатиков во 2-й и 3-й фазе
    if (phase >= 2) {
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = phase === 3 ? 16 : 14;
        if (this.aliveCount < 7) for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          G.flow.spawnAt('fanatic', e.pos.x + Math.cos(a) * 3, e.pos.y, e.pos.z + Math.sin(a) * 3);
        }
      }
    }
    if (pdist < e.t.range + e.radius && vdist < 3 && e.cooldown <= 0) { e.state = 'attack'; e.stateT = 0; return { move: null, speed }; }
    e.fireT -= dt * rage;
    if (e.fireT <= 0 && pdist > 4) {
      e.state = 'volley'; e.stateT = 0; e.fired = false;
      e.spiralT -= 1;
      e.attackKind = phase === 3 && e.spiralT <= 0 ? 'spiral' : phase >= 2 && Math.random() < 0.45 ? 'rockets' : 'fan';
      if (e.attackKind === 'spiral') e.spiralT = 3;
      e.fireT = 2.2;
      return { move: null, speed };
    }
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 2 + Math.random() * 2; }
    if (pdist > 9) return { move: { x: nx, z: nz }, speed };
    return { move: { x: -nz * e.strafe * 0.8 + nx * 0.3, z: nx * e.strafe * 0.8 + nz * 0.3 }, speed: speed * 0.8 };
  }

  // Точка дула в мире: вперёд по взгляду врага, вбок (+ влево от него) и вверх
  muzzlePos(e) {
    const [fwd, side, up] = e.t.muzzle, sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    return new THREE.Vector3(e.pos.x + sy * fwd + cy * side, e.pos.y + up, e.pos.z + cy * fwd - sy * side);
  }

  separate(P) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.dead || !a.active) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.dead || !b.active || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        const k = ((min - d) / d) * 0.5;
        const wa = a.type === 'boss' ? 0.1 : 1, wb = b.type === 'boss' ? 0.1 : 1;
        a.pos.x -= dx * k * wa; a.pos.z -= dz * k * wa;
        b.pos.x += dx * k * wb; b.pos.z += dz * k * wb;
      }
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz), min = a.radius + P.radius;
      if (d < min && d > 1e-4 && Math.abs(a.pos.y - P.pos.y) < 1.6) {
        const k = (min - d) / d;
        const wa = a.type === 'boss' ? 0.05 : 0.7;
        a.pos.x += dx * k * wa; a.pos.z += dz * k * wa;
        P.pos.x -= dx * k * (1 - wa); P.pos.z -= dz * k * (1 - wa);
      }
    }
  }

  // Выбор кадра: анимация + номер кадра, направление — по углу к камере
  animate(e, time) {
    const cam = this.G.camera;
    e.dir = viewDir(e.yaw, e.pos.x, e.pos.z, cam.position.x, cam.position.z);
    const A = e.sheet.meta.anims;
    let anim = 'idle', f = Math.floor(time * A.idle.fps + e.walk) % A.idle.frames;
    if (e.moving) { anim = 'walk'; f = Math.floor(e.walk) % A.walk.frames; }
    const wind = (k) => Math.min(2, Math.floor((e.stateT / e.t.windup) * k));
    if (e.type === 'fanatic' && e.state === 'attack') { anim = 'attack'; f = wind(3); }
    if (e.type === 'gunner') {
      if (e.state === 'shoot') { anim = 'attack'; f = e.shotT > 0.05 ? 1 : e.shotT > 0 ? 2 : 0; }
      else if (e.fireT < 0.3) { anim = 'attack'; f = 0; }
    }
    if (e.type === 'heavy') {
      if (e.state === 'attack') { anim = 'attack'; f = wind(3); }
      if (e.state === 'charge') { anim = 'run'; f = Math.floor(e.stateT * 12) % A.run.frames; }
      if (e.state === 'recover') { anim = 'hit'; f = 0; }
    }
    if (e.type === 'boss') {
      if (e.state === 'volley') { anim = 'attack'; f = e.shotT > 0.07 ? 1 : e.shotT > 0 ? 2 : 0; }
      if (e.state === 'attack') { anim = 'smash'; f = wind(3); }
    }
    e.shotT = (e.shotT || 0) - 1 / 60;
    if (e.painT > 0) { anim = 'hit'; f = 0; }
    e.anim = anim; e.frame = f;
    setSpriteFrame(e.map, e.sheet, anim, f, e.dir);
    // белая вспышка от попадания и ярость босса
    const fl = e.flashT > 0;
    const rage = e.type === 'boss' && e.phase === 3 ? 0.25 + Math.sin(time * 10) * 0.15 : 0;
    e.mat.emissive.setRGB(fl ? 1 : 0.23 + rage, fl ? 0.95 : 0.2, fl ? 0.9 : 0.2);
  }

  // Смерть: 4 кадра падения, потом труп остаётся. Босс — серия взрывов.
  updateDeath(e, dt, time) {
    const G = this.G;
    e.deathT += dt;
    if (e.type === 'boss' && e.deathT < 2.4) {
      e.boomT = (e.boomT || 0) - dt;
      if (e.boomT <= 0) {
        e.boomT = 0.18;
        const p = { x: e.pos.x + (Math.random() - 0.5) * 3, y: e.pos.y + 1 + Math.random() * 4, z: e.pos.z + (Math.random() - 0.5) * 3 };
        G.fx.explosions.spawn(p, 2.5 + Math.random() * 2, 0.6);
        G.fx.bloodBurst(p, 0.8);
        sfx.explosion(0.8);
        G.player.addTrauma(0.2);
      }
      setSpriteFrame(e.map, e.sheet, Math.random() < 0.5 ? 'hit' : 'attack', 1, e.dir);
      e.mat.emissive.setRGB(1, 0.5 + Math.random() * 0.5, 0.3);
      return;
    }
    if (e.type === 'boss' && !e.bossFinal) {
      e.bossFinal = true;
      G.fx.explosions.spawn({ x: e.pos.x, y: e.pos.y + 2.5, z: e.pos.z }, 9, 0.9);
      G.fx.gibs.burst({ x: e.pos.x, y: e.pos.y + 3, z: e.pos.z }, 40, 10, 0.6, e.pos.y);
      G.fx.bloodBurst({ x: e.pos.x, y: e.pos.y + 3, z: e.pos.z }, 6);
      G.player.addTrauma(1);
      G.onBossDead(e);
    }
    if (e.gibbed) return;
    const D = e.sheet.meta.anims.death, k = e.type === 'boss' ? Math.max(0, e.deathT - 2.4) : e.deathT;
    const i = Math.min(D.frames - 1, Math.floor(k * D.fps));
    setSpriteFrame(e.map, e.sheet, 'death', i, e.dir);
    e.mat.emissive.setRGB(0.2, 0.17, 0.17);
    e.group.rotation.y = Math.atan2(G.camera.position.x - e.pos.x, G.camera.position.z - e.pos.z);
    e.dir = viewDir(e.yaw, e.pos.x, e.pos.z, G.camera.position.x, G.camera.position.z);
    if (i === D.frames - 1 && !e.corpse) {
      e.corpse = true;
      this.corpses.push(e);
      if (this.corpses.length > 40) { const old = this.corpses.shift(); old.group.visible = false; }
    }
  }

  clear() {
    for (const e of this.list) { this.G.scene.remove(e.group); e.mat.dispose(); e.map.dispose(); e.sprite.geometry.dispose(); }
    this.list = [];
    this.corpses = [];
  }

  // Убираем из списка совсем старые трупы, которых уже не видно (держим список коротким)
  prune() {
    this.list = this.list.filter((e) => {
      if (e.dead && (e.gibbed || !e.group.visible) && e.deathT > 3) { this.G.scene.remove(e.group); e.mat.dispose(); e.map.dispose(); e.sprite.geometry.dispose(); return false; }
      return true;
    });
  }
}
