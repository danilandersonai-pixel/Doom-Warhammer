// Враги: модели из коробок, ИИ (ближний, дальний, чемпион), снаряды, урон по игроку.
import * as THREE from 'three';
import { resolveCircle, pointInColliders } from './collision.js';
import { ARENA_HALF } from './arena.js';
import { sfx } from './audio.js';

// Характеристики типов врагов
const TYPES = {
  melee: { hp: 60, speed: 4.6, radius: 0.45, scale: 1, color: 0x6a2420, dark: 0x2a1a18,
    damage: 10, range: 1.6, windup: 0.35, cooldown: 1.0 },
  ranged: { hp: 45, speed: 3.0, radius: 0.45, scale: 1, color: 0x3e4634, dark: 0x22261e,
    fireDelay: 2.3, projSpeed: 10, projDamage: 8, keepMin: 8, keepMax: 15 },
  boss: { hp: 700, speed: 3.2, radius: 0.95, scale: 1.8, color: 0x4a1616, dark: 0x5a4428,
    damage: 22, range: 2.6, windup: 0.5, cooldown: 1.4,
    fireDelay: 1.3, burst: 3, projSpeed: 13, projDamage: 9 },
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HORN = new THREE.ConeGeometry(0.08, 0.35, 5);
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xff3010 });
const tmpV = new THREE.Vector3();

// Деталь модели: масштабированная коробка
function part(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Конечность с шарниром наверху (чтобы её можно было вращать)
function limb(parent, mat, x, y, w, len) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  part(pivot, mat, w, len, w * 1.1, 0, -len / 2, 0);
  parent.add(pivot);
  return pivot;
}

// Собираем модель врага. Перёд модели смотрит на +Z.
function buildModel(type, t) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const main = new THREE.MeshLambertMaterial({ color: t.color });
  const dark = new THREE.MeshLambertMaterial({ color: t.dark });
  const metal = new THREE.MeshLambertMaterial({ color: 0x777070 });
  const boss = type === 'boss';

  const legs = [limb(g, dark, -0.15, 0.85, 0.2, 0.85), limb(g, dark, 0.15, 0.85, 0.2, 0.85)];
  const torso = part(g, main, boss ? 0.8 : 0.56, 0.7, boss ? 0.48 : 0.34, 0, 1.22, 0);
  if (type === 'melee') torso.rotation.x = 0.25; // сутулый
  part(g, dark, 0.3, 0.3, 0.3, 0, 1.72, 0.02);   // голова
  part(g, EYE_MAT, 0.07, 0.04, 0.03, -0.07, 1.74, 0.17);
  part(g, EYE_MAT, 0.07, 0.04, 0.03, 0.07, 1.74, 0.17);
  const sx = boss ? 0.5 : 0.38;
  const arms = [limb(g, main, -sx, 1.5, 0.17, 0.7), limb(g, main, sx, 1.5, 0.17, 0.7)];

  if (type === 'melee') {
    part(arms[1], metal, 0.05, 0.85, 0.14, 0, -0.95, 0.05); // клинок
  } else {
    part(arms[1], metal, 0.13, boss ? 0.8 : 0.6, 0.15, 0, -0.85, 0); // оружие
  }
  if (boss) {
    // наплечники и рога
    part(g, dark, 0.38, 0.28, 0.5, -0.55, 1.58, 0);
    part(g, dark, 0.38, 0.28, 0.5, 0.55, 1.58, 0);
    part(g, metal, 0.5, 0.12, 0.2, 0, 1.0, 0.25); // пряжка пояса
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(HORN, metal);
      h.position.set(s * 0.13, 1.95, 0);
      h.rotation.z = -s * 0.5;
      g.add(h);
    }
  }

  // Невидимый хитбокс для попаданий — честнее и быстрее, чем луч по всем деталям
  const hitbox = new THREE.Mesh(BOX, main);
  hitbox.visible = false;
  hitbox.scale.set(boss ? 1.1 : 0.75, 1.95, boss ? 0.8 : 0.6);
  hitbox.position.y = 0.98;
  g.add(hitbox);

  g.scale.setScalar(t.scale);
  return { group: g, mats: [main, dark], legs, arms, hitbox };
}

export class Enemies {
  // hooks: { onKill(enemy), onPlayerHit(amount) }
  constructor(scene, colliders, solidMeshes, particles, sparks, hooks) {
    this.scene = scene;
    this.colliders = colliders;
    this.solidMeshes = solidMeshes;
    this.particles = particles;
    this.sparks = sparks;
    this.hooks = hooks;
    this.list = [];
    this.ray = new THREE.Raycaster();

    // Пул снарядов: светящаяся сфера + ореол
    const core = new THREE.SphereGeometry(0.12, 8, 6);
    const glow = new THREE.SphereGeometry(0.28, 8, 6);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe080, fog: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4010, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.projectiles = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(core, coreMat);
      m.add(new THREE.Mesh(glow, glowMat));
      m.visible = false;
      scene.add(m);
      this.projectiles.push({ mesh: m, active: false, vel: new THREE.Vector3(), life: 0, damage: 0 });
    }
  }

  get aliveCount() { return this.list.reduce((n, e) => n + (e.dead ? 0 : 1), 0); }
  get boss() { return this.list.find((e) => e.type === 'boss') || null; }

  spawn(type, x, z) {
    const t = TYPES[type];
    const model = buildModel(type, t);
    const e = {
      type, t, ...model,
      pos: { x, z }, yaw: 0, hp: t.hp, maxHp: t.hp, radius: t.radius,
      dead: false, deathT: 0, spawnT: 0, flashT: 0,
      cooldown: 0.5, attackT: 0, fireT: 1 + Math.random() * 1.5, burstLeft: 0, burstT: 0,
      walk: Math.random() * 6, moving: false,
      strafe: Math.random() < 0.5 ? -1 : 1, strafeT: 1 + Math.random() * 2,
      avoid: 0, avoidT: 0, kb: { x: 0, z: 0 },
    };
    e.hitbox.userData.enemy = e;
    e.group.position.set(x, 0, z);
    e.group.scale.setScalar(0.01);
    this.scene.add(e.group);
    this.list.push(e);
    // эффект появления: столб красных искр
    this.sparks.burst({ x, y: 0.5, z }, type === 'boss' ? 80 : 30, 0xff3010, { speed: 5, life: 0.7, gravity: -2, dir: { x: 0, y: 2, z: 0 } });
    return e;
  }

  // Меши для лучей выстрелов игрока
  hitboxes() {
    const out = [];
    for (const e of this.list) {
      if (e.dead || e.spawnT <= 0.3) continue;
      e.group.updateMatrixWorld(); // позиция могла измениться после последней отрисовки
      out.push(e.hitbox);
    }
    return out;
  }

  // Урон врагу. Возвращает true, если враг убит
  damage(e, amount, point) {
    if (e.dead) return false;
    e.hp -= amount;
    e.flashT = 0.09;
    this.particles.burst(point, 10, 0x701010, { speed: 4, life: 0.6 });
    if (e.hp > 0) return false;
    e.dead = true;
    e.deathT = 0;
    const big = e.type === 'boss';
    const c = { x: e.pos.x, y: big ? 2 : 1.1, z: e.pos.z };
    this.particles.burst(c, big ? 120 : 35, 0x5a0c0c, { speed: big ? 9 : 6, life: 1.1 });
    this.sparks.burst(c, big ? 100 : 25, 0xff8030, { speed: big ? 12 : 7, life: 0.5 });
    big ? sfx.explosion(1) : sfx.enemyDeath(1);
    this.hooks.onKill(e);
    return true;
  }

  // Отбросить врага (удар в ближнем бою)
  knockback(e, dx, dz, force) {
    e.kb.x += dx * force;
    e.kb.z += dz * force;
  }

  // Видит ли враг игрока (нет ли стены между ними)
  canSee(e, player) {
    const from = tmpV.set(e.pos.x, 1.4, e.pos.z);
    const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    this.ray.set(from, new THREE.Vector3(dx / dist, 0.01, dz / dist));
    this.ray.far = dist;
    return this.ray.intersectObjects(this.solidMeshes, false).length === 0;
  }

  // Выпустить снаряд в игрока (angle — отклонение для очереди веером)
  shoot(e, player, angle = 0) {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    const s = e.t.scale;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const sx = e.pos.x + fx * 0.6 * s + fz * 0.35 * s;
    const sz = e.pos.z + fz * 0.6 * s - fx * 0.35 * s;
    const sy = 1.25 * s;
    p.mesh.position.set(sx, sy, sz);
    const dir = tmpV.set(player.pos.x - sx, 1.3 - sy, player.pos.z - sz).normalize();
    dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    p.vel.copy(dir).multiplyScalar(e.t.projSpeed);
    p.mesh.scale.setScalar(e.type === 'boss' ? 1.4 : 1);
    p.mesh.visible = true;
    p.active = true;
    p.life = 5;
    p.damage = e.t.projDamage;
    sfx.enemyShot(this.volumeAt(e, player));
  }

  volumeAt(e, player) {
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    return Math.max(0.15, 1 - d / 35);
  }

  // Обход препятствий: если впереди стена — пробуем повернуть
  steer(e, dx, dz, dt) {
    const look = 1.0 + e.radius;
    const blocked = (x, z) =>
      pointInColliders(e.pos.x + x * look, 0.5, e.pos.z + z * look, this.colliders, e.radius * 0.8);
    e.avoidT -= dt;
    if (e.avoidT > 0 && e.avoid !== 0) {
      const a = e.avoid;
      const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
      if (!blocked(rx, rz)) return { x: rx, z: rz };
    }
    if (!blocked(dx, dz)) { e.avoid = 0; return { x: dx, z: dz }; }
    for (const a of [0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
      const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
      if (!blocked(rx, rz)) { e.avoid = a; e.avoidT = 0.6; return { x: rx, z: rz }; }
    }
    return { x: dx, z: dz };
  }

  update(dt, player) {
    for (const e of this.list) {
      if (e.dead) { this.animateDeath(e, dt); continue; }

      // появление: враг "вырастает" из пола, пока не действует
      if (e.spawnT < 0.5) {
        e.spawnT += dt;
        e.group.scale.setScalar(e.t.scale * Math.min(1, e.spawnT / 0.5));
        continue;
      }

      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const nx = dx / dist, nz = dz / dist;
      let mx = 0, mz = 0, speedMul = 1;
      e.cooldown -= dt;

      if (e.type === 'melee') {
        ({ mx, mz } = this.meleeLogic(e, player, dist, nx, nz, dt));
      } else if (e.type === 'ranged') {
        ({ mx, mz, speedMul } = this.rangedLogic(e, player, dist, nx, nz, dt));
      } else {
        ({ mx, mz, speedMul } = this.bossLogic(e, player, dist, nx, nz, dt));
      }

      // движение с обходом препятствий
      e.moving = mx !== 0 || mz !== 0;
      if (e.moving) {
        const d = this.steer(e, mx, mz, dt);
        const sp = e.t.speed * speedMul;
        e.pos.x += d.x * sp * dt;
        e.pos.z += d.z * sp * dt;
        e.walk += dt * sp * 2.4;
      }
      // отбрасывание
      e.pos.x += e.kb.x * dt;
      e.pos.z += e.kb.z * dt;
      const kbDamp = Math.exp(-8 * dt);
      e.kb.x *= kbDamp; e.kb.z *= kbDamp;

      // поворот к игроку (плавно)
      let da = Math.atan2(nx, nz) - e.yaw;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      e.yaw += da * (1 - Math.exp(-10 * dt));

      // вспышка при попадании
      e.flashT -= dt;
      const f = e.flashT > 0 ? 0.9 : 0;
      for (const m of e.mats) m.emissive.setRGB(f, f * 0.8, f * 0.6);
    }

    this.separate(player);
    for (const e of this.list) {
      if (e.dead) continue;
      resolveCircle(e.pos, e.radius, this.colliders);
      this.animate(e);
    }
    this.updateProjectiles(dt, player);

    // убираем со сцены отыгравших смерть
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead && e.deathT > 1.3) {
        this.scene.remove(e.group);
        for (const m of e.mats) m.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  // Ближний бой: бежит к игроку, замахивается и бьёт
  meleeLogic(e, player, dist, nx, nz, dt) {
    if (e.attackT > 0) {
      e.attackT -= dt;
      if (e.attackT <= 0) {
        if (dist < e.t.range + 0.5) this.hooks.onPlayerHit(e.t.damage, e);
        e.cooldown = e.t.cooldown;
      }
      return { mx: nx * 0.15, mz: nz * 0.15 }; // во время замаха почти стоит
    }
    if (dist < e.t.range + e.radius && e.cooldown <= 0) {
      e.attackT = e.t.windup;
      sfx.enemyMelee(this.volumeAt(e, player));
      return { mx: 0, mz: 0 };
    }
    if (dist < e.t.range) return { mx: 0, mz: 0 };
    return { mx: nx, mz: nz };
  }

  // Дальний бой: держит дистанцию, ходит боком, стреляет медленными снарядами
  rangedLogic(e, player, dist, nx, nz, dt) {
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 1.5 + Math.random() * 2; }
    const sx = -nz * e.strafe, sz = nx * e.strafe; // вектор "вбок"
    let mx, mz, speedMul = 1;
    e.seekT = (e.seekT || 0) - dt;
    if (dist > e.t.keepMax || e.seekT > 0) { mx = nx; mz = nz; }
    else if (dist < e.t.keepMin) { mx = -nx * 0.8 + sx * 0.4; mz = -nz * 0.8 + sz * 0.4; }
    else { mx = sx; mz = sz; speedMul = 0.6; }

    e.fireT -= dt;
    if (e.fireT <= 0) {
      if (dist < 30 && this.canSee(e, player)) {
        this.shoot(e, player);
        e.fireT = e.t.fireDelay * (0.8 + Math.random() * 0.4);
      } else {
        e.fireT = 0.4;  // не видит — проверим позже,
        e.seekT = 1.2;  // а пока идёт к игроку
      }
    }
    return { mx, mz, speedMul };
  }

  // Чемпион: идёт на игрока, стреляет очередями веером, бьёт вблизи
  bossLogic(e, player, dist, nx, nz, dt) {
    // удар вблизи
    if (e.attackT > 0) {
      e.attackT -= dt;
      if (e.attackT <= 0) {
        if (dist < e.t.range + 0.6) {
          this.hooks.onPlayerHit(e.t.damage, e);
          player.vel.x += nx * 12; player.vel.z += nz * 12; // отбрасывает игрока
        }
        e.cooldown = e.t.cooldown;
      }
      return { mx: 0, mz: 0, speedMul: 0 };
    }
    if (dist < e.t.range + e.radius && e.cooldown <= 0) {
      e.attackT = e.t.windup;
      sfx.enemyMelee(1);
      return { mx: 0, mz: 0, speedMul: 0 };
    }

    // очередь из 3 снарядов веером
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        const angle = (e.burstLeft - 2) * 0.13;
        this.shoot(e, player, angle);
        e.burstLeft--;
        e.burstT = 0.14;
      }
    } else {
      e.fireT -= dt;
      if (e.fireT <= 0 && dist > 3.5 && this.canSee(e, player)) {
        e.burstLeft = e.t.burst;
        e.burstT = 0;
        e.fireT = e.t.fireDelay * (0.8 + Math.random() * 0.4);
      }
    }

    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 2 + Math.random() * 2; }
    const sx = -nz * e.strafe, sz = nx * e.strafe;
    if (dist > 6) return { mx: nx * 0.8 + sx * 0.3, mz: nz * 0.8 + sz * 0.3, speedMul: 1 };
    return { mx: nx, mz: nz, speedMul: 1.3 }; // рядом — рывок
  }

  // Враги не налезают друг на друга и на игрока
  separate(player) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.dead) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.dead) continue;
        pushApart(a.pos, b.pos, a.radius + b.radius, 0.5);
      }
      // с игроком: враг сдвигается сильнее
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz), min = a.radius + player.radius;
      if (d < min && d > 1e-4) {
        const push = (min - d) / d;
        a.pos.x += dx * push * 0.7; a.pos.z += dz * push * 0.7;
        player.pos.x -= dx * push * 0.3; player.pos.z -= dz * push * 0.3;
      }
    }
  }

  // Анимация ходьбы и атак
  animate(e) {
    const g = e.group;
    g.position.set(e.pos.x, 0, e.pos.z);
    g.rotation.y = e.yaw;
    const swing = e.moving ? Math.sin(e.walk) * 0.7 : 0;
    e.legs[0].rotation.x = swing;
    e.legs[1].rotation.x = -swing;
    e.arms[0].rotation.x = -swing * 0.6;
    if (e.type === 'melee' || (e.type === 'boss' && e.attackT > 0)) {
      if (e.attackT > 0) {
        // замах: рука поднимается над головой, в конце резко опускается
        const p = 1 - e.attackT / e.t.windup;
        e.arms[1].rotation.x = p < 0.75 ? -2.6 * (p / 0.75) : -2.6 + (p - 0.75) * 4 * 3.2;
      } else {
        e.arms[1].rotation.x = swing * 0.6 - 0.3;
      }
    } else {
      // стрелки держат оружие перед собой
      e.arms[1].rotation.x = -1.45;
      e.arms[0].rotation.x = -1.2;
    }
  }

  animateDeath(e, dt) {
    e.deathT += dt;
    const p = Math.min(1, e.deathT / 0.5);
    e.group.rotation.x = -p * Math.PI / 2;     // падает на спину
    e.group.position.y = -Math.max(0, e.deathT - 0.7) * 1.2; // уходит под пол
    for (const m of e.mats) m.emissive.setRGB(0, 0, 0);
  }

  updateProjectiles(dt, player) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const pos = p.mesh.position;
      pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      // попадание в игрока
      const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
      if (dx * dx + dz * dz < 0.6 * 0.6 && pos.y > 0.1 && pos.y < 2.0) {
        this.hooks.onPlayerHit(p.damage, null);
        this.kill(p);
        continue;
      }
      // в стену, в пол или улетел
      if (p.life <= 0 || pos.y < 0.05 || Math.abs(pos.x) > ARENA_HALF || Math.abs(pos.z) > ARENA_HALF ||
          pointInColliders(pos.x, pos.y, pos.z, this.colliders)) {
        this.kill(p);
      }
    }
  }

  kill(p) {
    p.active = false;
    p.mesh.visible = false;
    this.sparks.burst(p.mesh.position, 10, 0xff6020, { speed: 3, life: 0.35, gravity: 4 });
  }

  clear() {
    for (const e of this.list) {
      this.scene.remove(e.group);
      for (const m of e.mats) m.dispose();
    }
    this.list = [];
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
  }
}

function pushApart(a, b, min, k) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= min || d < 1e-4) return;
  const push = ((min - d) / d) * k;
  a.x -= dx * push; a.z -= dz * push;
  b.x += dx * push; b.z += dz * push;
}
