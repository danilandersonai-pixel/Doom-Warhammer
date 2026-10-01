// Игрок: движение, столкновения, здоровье/броня, тряска камеры.
import { resolveCircle } from './collision.js';

const SPEED = 6.5;          // м/с
const EYE_HEIGHT = 1.65;    // высота глаз
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
const ARMOR_REGEN_DELAY = 4; // через сколько секунд без урона броня начинает восстанавливаться
const ARMOR_REGEN = 12;      // единиц брони в секунду

export class Player {
  constructor() {
    this.radius = 0.45;
    this.reset();
  }

  reset() {
    this.pos = { x: 0, z: 6 };
    this.vel = { x: 0, z: 0 };
    this.yaw = 0;        // поворот влево-вправо (0 = смотрим на -Z)
    this.pitch = 0;      // наклон вверх-вниз
    this.health = MAX_HEALTH;
    this.armor = MAX_ARMOR;
    this.sinceHurt = 99;
    this.trauma = 0;     // сила тряски камеры (0..1)
    this.hurtFlash = 0;  // красная вспышка по краям экрана
    this.kick = 0;       // отдача — временный подъём камеры
    this.bob = 0;        // фаза покачивания при ходьбе
    this.speed01 = 0;    // насколько быстро идём (0..1), нужно для покачивания оружия
    this.dead = false;
  }

  // Направления "вперёд" и "вправо" по текущему yaw
  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy));
  }

  update(dt, move, colliders) {
    const f = this.forward();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (rx * move.x + f.x * move.z) * SPEED;
    const tz = (rz * move.x + f.z * move.z) * SPEED;
    // плавный разгон/торможение
    const k = 1 - Math.exp(-14 * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircle(this.pos, this.radius, colliders);

    this.speed01 = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / SPEED);
    this.bob += dt * 11 * this.speed01;

    // восстановление брони
    this.sinceHurt += dt;
    if (this.sinceHurt > ARMOR_REGEN_DELAY && this.armor < MAX_ARMOR) {
      this.armor = Math.min(MAX_ARMOR, this.armor + ARMOR_REGEN * dt);
    }
    // затухание эффектов
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.kick *= Math.exp(-12 * dt);
  }

  // Урон: сначала тратится броня, потом здоровье
  damage(amount) {
    if (this.dead) return;
    this.sinceHurt = 0;
    const absorbed = Math.min(this.armor, amount);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.6);
    this.addTrauma(0.35);
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  // Ставим камеру: позиция глаз + покачивание + отдача + тряска
  applyCamera(camera, time) {
    const s = this.trauma * this.trauma; // квадрат — мелкая тряска почти незаметна, сильная резкая
    const n1 = Math.sin(time * 41.3) * Math.sin(time * 17.1 + 1.7);
    const n2 = Math.sin(time * 37.7 + 3.1) * Math.sin(time * 23.3);
    const n3 = Math.sin(time * 29.9 + 5.3);
    const bobY = Math.sin(this.bob * 2) * 0.045 * this.speed01;
    camera.position.set(this.pos.x, EYE_HEIGHT + bobY, this.pos.z);
    camera.rotation.set(
      this.pitch + this.kick + n1 * 0.06 * s,
      this.yaw + n2 * 0.06 * s,
      n3 * 0.05 * s,
      'YXZ'
    );
  }
}
