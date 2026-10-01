// Игрок: быстрый бег с лёгкой инерцией, прыжок, рывок (дэш) с откатом, гравитация,
// ступеньки, пропасть с возвратом на чекпоинт, здоровье и броня, тряска камеры.

const SPEED = 8.5;
const ACCEL_GROUND = 60, ACCEL_AIR = 16;
const JUMP_V = 7.0, GRAVITY = 21;
const DASH_SPEED = 21, DASH_TIME = 0.17;
export const DASH_COOLDOWN = 1.1;
const EYE = 1.62, HEIGHT = 1.8;
export const HEALTH_MAX = 200, ARMOR_MAX = 200;   // подборы поднимают выше 100, как в классике

export class Player {
  constructor(world) {
    this.world = world;
    this.radius = 0.4;
    this.reset({ x: 0, z: 30, yaw: 0 });
  }

  reset(start) {
    this.pos = { x: start.x, y: 0, z: start.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = start.yaw || 0;
    this.pitch = 0;
    this.health = 100;
    this.armor = 50;
    this.onGround = true;
    this.dashT = 0;        // >0 — идёт рывок
    this.dashCd = 0;       // откат рывка
    this.dashDir = { x: 0, z: 0 };
    this.trauma = 0;
    this.hurtFlash = 0;
    this.kick = 0;
    this.bob = 0;
    this.speed01 = 0;
    this.land = 0;         // "присед" камеры после приземления
    this.dead = false;
    this.checkpoint = { x: start.x, y: 0, z: start.z };
    this.cpTimer = 0;
    this.stepT = 0;
    this.events = [];      // 'jump' | 'land' | 'dash' | 'step' | 'fall' — для звука
  }

  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy));
  }

  jump() {
    if (!this.onGround || this.dead) return;
    this.vel.y = JUMP_V;
    this.onGround = false;
    this.events.push('jump');
  }

  dash(move) {
    if (this.dashCd > 0 || this.dead) return;
    const f = this.forward();
    let dx = -f.z * move.x + f.x * move.z, dz = f.x * move.x + f.z * move.z;
    // при неподвижности рывок вперёд
    if (Math.hypot(dx, dz) < 0.2) { dx = f.x; dz = f.z; }
    const l = Math.hypot(dx, dz);
    this.dashDir = { x: dx / l, z: dz / l };
    this.dashT = DASH_TIME;
    this.dashCd = DASH_COOLDOWN;
    this.addTrauma(0.15);
    this.events.push('dash');
  }

  update(dt, move) {
    const f = this.forward();
    const rx = -f.z, rz = f.x; // вправо
    const tx = (rx * move.x + f.x * move.z) * SPEED;
    const tz = (rz * move.x + f.z * move.z) * SPEED;
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      if (this.vel.y < 0) this.vel.y *= 0.6; // рывок слегка "подвешивает" в воздухе
    } else {
      // лёгкая инерция: разгон к целевой скорости
      const a = (this.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt;
      const dvx = tx - this.vel.x, dvz = tz - this.vel.z, dl = Math.hypot(dvx, dvz);
      if (dl > 0) { const k = Math.min(1, a / dl); this.vel.x += dvx * k; this.vel.z += dvz * k; }
    }
    this.vel.y -= GRAVITY * dt;

    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolve(this.pos, this.radius, HEIGHT);
    this.pos.y += this.vel.y * dt;

    // земля под ногами
    const g = this.world.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, prevY), this.radius * 0.7);
    const wasGround = this.onGround;
    if (this.pos.y <= g + 0.001 && g > -50) {
      if (!wasGround && this.vel.y < -6) { this.land = Math.min(0.25, -this.vel.y * 0.02); this.events.push('land'); }
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y - g > 0.05) {
      // со ступеньки вниз "прилипаем", если невысоко и не в прыжке
      if (wasGround && this.vel.y <= 0 && this.pos.y - g < 0.5) { this.pos.y = g; this.vel.y = 0; this.onGround = true; }
      else this.onGround = false;
    }
    // потолок (например, перемычка над проёмом)
    this.world.resolve(this.pos, this.radius, HEIGHT);

    // чекпоинт: последняя надёжная точка на земле
    this.cpTimer -= dt;
    if (this.onGround && this.cpTimer <= 0 && !this.world.inPit(this.pos.x + this.vel.x * 0.4, this.pos.z + this.vel.z * 0.4)) {
      this.checkpoint = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
      this.cpTimer = 0.5;
    }
    // упал в пропасть
    if (this.pos.y < -7) {
      this.events.push('fall');
      this.pos = { ...this.checkpoint };
      this.vel = { x: 0, y: 0, z: 0 };
      this.damage(15, true);
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = Math.min(1, hs / SPEED);
    if (this.onGround) {
      this.bob += dt * 12 * this.speed01;
      this.stepT -= dt * this.speed01;
      if (this.stepT <= 0 && this.speed01 > 0.3) { this.stepT = 0.36; this.events.push('step'); }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.kick *= Math.exp(-12 * dt);
    this.land *= Math.exp(-9 * dt);
  }

  // Урон: броня поглощает 2/3, остальное — здоровье
  damage(amount, ignoreArmor = false) {
    if (this.dead) return;
    let toArmor = ignoreArmor ? 0 : Math.min(this.armor, amount * 0.66);
    this.armor -= toArmor;
    this.health -= amount - toArmor;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.5 + amount * 0.02);
    this.addTrauma(0.25 + amount * 0.01);
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  applyCamera(camera, time) {
    const s = this.trauma * this.trauma;
    const n1 = Math.sin(time * 41.3) * Math.sin(time * 17.1 + 1.7);
    const n2 = Math.sin(time * 37.7 + 3.1) * Math.sin(time * 23.3);
    const n3 = Math.sin(time * 29.9 + 5.3);
    const bobY = Math.sin(this.bob * 2) * 0.05 * this.speed01 * (this.onGround ? 1 : 0);
    camera.position.set(this.pos.x, this.pos.y + EYE + bobY - this.land, this.pos.z);
    camera.rotation.set(this.pitch + this.kick + n1 * 0.07 * s, this.yaw + n2 * 0.07 * s, n3 * 0.05 * s + Math.sin(this.bob) * 0.006 * this.speed01, 'YXZ');
    const fovTarget = this.dashT > 0 ? 1.12 : 1;
    camera.userData.fovK = (camera.userData.fovK || 1) + (fovTarget - (camera.userData.fovK || 1)) * 0.25;
  }
}
