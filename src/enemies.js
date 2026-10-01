// Враги: модели из коробок, ИИ (ближний, дальний, чемпион), снаряды, урон по игроку.
import * as THREE from 'three';
import { resolveCircle, pointInColliders } from './collision.js';
import { ARENA_HALF } from './arena.js';
import { sfx } from './audio.js';
import { enemyAtlas, plasmaTexture, SPRITE_FRAMES } from './sprites.js';

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
const HIDDEN_MAT = new THREE.MeshBasicMaterial();
const tmpV = new THREE.Vector3();
// Размер спрайта в метрах на один пиксель
const PIXEL = { melee: 0.047, ranged: 0.047, boss: 0.062 };

// Враг — плоский пиксельный спрайт, всегда повёрнутый к камере (как в шутерах 90-х)
function buildModel(type) {
  const atlas = enemyAtlas(type);
  const g = new THREE.Group();
  const map = new THREE.CanvasTexture(atlas.canvas);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.repeat.set(1 / SPRITE_FRAMES, 1);
  // emissiveMap = та же текстура: спрайт немного "светится" своими цветами и не тонет в темноте
  const mat = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0x383030, alphaTest: 0.5, side: THREE.DoubleSide });
  const w = atlas.frameW * PIXEL[type], h = atlas.frameH * PIXEL[type];
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2, 0);
  const sprite = new THREE.Mesh(geo, mat);
  g.add(sprite);

  // Невидимый хитбокс для попаданий
  const hitbox = new THREE.Mesh(BOX, HIDDEN_MAT);
  hitbox.visible = false;
  hitbox.scale.set(w * 0.75, h * 0.95, w * 0.75);
  hitbox.position.y = h * 0.475;
  g.add(hitbox);
  return { group: g, sprite, map, mats: [mat], hitbox, height: h };
}

export class Enemies {
  // fx: { blood, sparks, gibs, decals, explosions }; hooks: { onKill(enemy), onPlayerHit(amount) }
  constructor(scene, colliders, solidMeshes, fx, hooks) {
    this.scene = scene;
    this.colliders = colliders;
    this.solidMeshes = solidMeshes;
    this.fx = fx;
    this.particles = fx.blood;
    this.sparks = fx.sparks;
    this.hooks = hooks;
    this.list = [];
    this.ray = new THREE.Raycaster();
    this.cameraPos = new THREE.Vector3();

    // Пул снарядов: зелёные варп-сгустки
    const pmat = new THREE.SpriteMaterial({ map: plasmaTexture(), fog: false, depthWrite: false });
    this.projectiles = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Sprite(pmat);
      m.visible = false;
      scene.add(m);
      this.projectiles.push({ mesh: m, active: false, vel: new THREE.Vector3(), life: 0, damage: 0 });
    }
  }

  get aliveCount() { return this.list.reduce((n, e) => n + (e.dead ? 0 : 1), 0); }
  get boss() { return this.list.find((e) => e.type === 'boss') || null; }

  spawn(type, x, z) {
    const t = TYPES[type];
    const model = buildModel(type);
    const e = {
      type, t, ...model,
      pos: { x, z }, yaw: 0, hp: t.hp, maxHp: t.hp, radius: t.radius,
      dead: false, deathT: 0, spawnT: 0, flashT: 0,
      cooldown: 0.5, attackT: 0, fireT: 1 + Math.random() * 1.5, burstLeft: 0, burstT: 0,
      walk: Math.random() * 6, moving: false, shotT: 0, painT: 0,
      strafe: Math.random() < 0.5 ? -1 : 1, strafeT: 1 + Math.random() * 2,
      avoid: 0, avoidT: 0, kb: { x: 0, z: 0 },
    };
    e.hitbox.userData.enemy = e;
    e.group.position.set(x, 0, z);
    e.group.scale.set(1, 0.01, 1);
    this.scene.add(e.group);
    this.list.push(e);
    // эффект появления: столб красных искр
    // эффект появления: столб зелёных варп-искр
    this.sparks.burst({ x, y: 0.5, z }, type === 'boss' ? 90 : 35, 0x60ff40, { speed: 5, life: 0.8, gravity: -3, dir: { x: 0, y: 2, z: 0 } });
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
    e.flashT = 0.12;
    e.painT = 0.15;
    this.particles.burst(point, 12, 0xd01010, { speed: 4, life: 0.6 });
    if (e.hp > 0) return false;
    e.dead = true;
    e.deathT = 0;
    if (e.type !== 'boss') this.explodeBody(e, 1);
    else sfx.explosion(0.8);
    this.hooks.onKill(e);
    return true;
  }

  // Тело разлетается на куски: гибы, кровь, лужа на полу
  explodeBody(e, k) {
    const c = { x: e.pos.x, y: e.height * 0.55, z: e.pos.z };
    this.fx.gibs.burst(c, Math.round(9 * k), 6 * Math.sqrt(k), 0.24 * Math.sqrt(k));
    this.particles.burst(c, Math.round(40 * k), 0xc01010, { speed: 7 * Math.sqrt(k), life: 1.0 });
    this.fx.explosions.spawn(new THREE.Vector3(c.x, c.y, c.z), 1.6 * Math.sqrt(k), 0.35);
    this.fx.decals.add(e.pos.x, e.pos.z, 1.6 * k + Math.random());
    e.sprite.visible = false;
    sfx.enemyDeath(1);
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
    p.mesh.scale.setScalar(e.type === 'boss' ? 0.75 : 0.5);
    e.shotT = 0.15;
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

  update(dt, player, camera) {
    if (camera) this.cameraPos.copy(camera.position);
    for (const e of this.list) {
      if (e.dead) { this.animateDeath(e, dt); continue; }

      // появление: враг "вырастает" из пола, пока не действует
      if (e.spawnT < 0.5) {
        e.spawnT += dt;
        const k = Math.min(1, e.spawnT / 0.5);
        e.group.scale.set(1, Math.max(0.01, k), 1);
        e.group.position.set(e.pos.x, 0, e.pos.z);
        e.group.rotation.y = Math.atan2(this.cameraPos.x - e.pos.x, this.cameraPos.z - e.pos.z);
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

      e.flashT -= dt;
      e.shotT -= dt;
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
      if (e.dead && e.deathT > 1.3 && !e.sprite.visible) {
        this.scene.remove(e.group);
        for (const m of e.mats) m.dispose();
        e.map.dispose();
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

  // Спрайт всегда смотрит на камеру; кадры меняются с низкой частотой — "дёрганая" ретро-анимация
  animate(e) {
    const g = e.group;
    g.position.set(e.pos.x, 0, e.pos.z);
    g.rotation.y = Math.atan2(this.cameraPos.x - e.pos.x, this.cameraPos.z - e.pos.z);
    let frame = e.moving ? Math.floor(e.walk / 1.6) % 2 : 0;
    if (e.attackT > 0) frame = e.type === 'boss' || e.attackT >= e.t.windup * 0.3 ? 2 : 3;
    if (e.shotT > 0) frame = 3;
    else if (e.type === 'ranged' && e.fireT < 0.35) frame = 2; // целится перед выстрелом
    e.map.offset.x = frame / SPRITE_FRAMES;
    // боль — красная вспышка
    const pain = e.flashT > 0;
    e.mats[0].emissive.setRGB(pain ? 1.2 : 0.22, pain ? 0.15 : 0.18, pain ? 0.1 : 0.18);
  }

  animateDeath(e, dt) {
    e.deathT += dt;
    if (e.type !== 'boss' || !e.sprite.visible) return;
    // чемпион: серия взрывов по телу, потом разлетается
    e.group.rotation.y = Math.atan2(this.cameraPos.x - e.pos.x, this.cameraPos.z - e.pos.z);
    e.mats[0].emissive.setRGB(Math.random() < 0.5 ? 1.2 : 0.2, 0.15, 0.1);
    e.boomT = (e.boomT || 0) - dt;
    if (e.boomT <= 0) {
      e.boomT = 0.12;
      const p = new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 3, e.pos.z + (Math.random() - 0.5) * 2);
      this.fx.explosions.spawn(p, 1.4 + Math.random(), 0.35);
      sfx.impact(1);
    }
    if (e.deathT > 1.1) {
      this.explodeBody(e, 3);
      sfx.explosion(1);
    }
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
    this.sparks.burst(p.mesh.position, 10, 0x80ff40, { speed: 3, life: 0.35, gravity: 4 });
  }

  clear() {
    for (const e of this.list) {
      this.scene.remove(e.group);
      for (const m of e.mats) m.dispose();
      e.map.dispose();
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
