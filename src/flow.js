// Ход уровня: задачи советника, ворота, волны 5 → 8 → 10 → босс, выход, секрет, статистика.
// Также — золотые метки-следы по земле, ведущие к цели.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt } from './art_misc.js';
import { sfx, music } from './audio.js';

const WAVES = [
  { fanatic: 4, gunner: 1 },
  { fanatic: 4, gunner: 3, heavy: 1 },
  { fanatic: 5, gunner: 3, heavy: 2 },
];
const MAX_ALIVE = 8;

export class Flow {
  constructor(G) {
    this.G = G;
    // метки-следы: плоские шевроны на земле
    const tex = nearestTexture(miscArt().footprint);
    const geo = new THREE.PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2);
    this.marks = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, depthWrite: false, fog: true }));
      m.visible = false;
      G.scene.add(m);
      this.marks.push(m);
    }
  }

  reset() {
    this.stage = 'approach';   // approach | wave | between | boss | exit | done
    this.wave = -1;
    this.queue = [];
    this.spawnT = 0;
    this.timer = 0;
    this.kills = 0;
    this.secretFound = false;
    this.time = 0;
    this.target = this.G.level.arenaCenter;
    this.G.level.gates.entry.set(true);
    this.G.level.gates.exit.set(false);
    this.G.hud.objective('Вход на площадь найден. Зачисти её от еретиков.', 'Иди к воротам площади');
    music.setIntensity(0);
  }

  get remaining() { return this.queue.length + this.G.enemies.alive.filter((e) => e.type !== 'boss').length; }

  // Появление врага в точке (используется и боссом для призыва)
  spawnAt(type, x, y, z) { return this.G.enemies.spawn(type, x, y, z); }

  spawnOne(type) {
    const G = this.G, P = G.player.pos;
    const pts = G.level.spawnPoints.filter((s) => Math.hypot(s.x - P.x, s.z - P.z) > 11);
    const s = (pts.length ? pts : G.level.spawnPoints)[(Math.random() * (pts.length || G.level.spawnPoints.length)) | 0];
    this.spawnAt(type, s.x + (Math.random() - 0.5), s.y, s.z + (Math.random() - 0.5));
  }

  startWave(i) {
    const G = this.G;
    this.wave = i;
    this.stage = 'wave';
    this.queue = [];
    for (const [type, n] of Object.entries(WAVES[i])) for (let k = 0; k < n; k++) this.queue.push(type);
    this.queue.sort(() => Math.random() - 0.5);
    this.spawnT = 0.3;
    G.hud.banner(`ВОЛНА ${i + 1}`);
    G.hud.objective(i === 0 ? 'Врата заперты за нами. Еретики идут — прими бой!' : i === 1 ? 'Вторая волна. Среди них — тяжёлый демон. Не стой на месте.' : 'Последняя волна перед их чемпионом. Держись!', `Волна ${i + 1} из 3`);
    sfx.horn();
    music.setIntensity(1);
  }

  startBoss() {
    const G = this.G;
    this.stage = 'boss';
    G.enemies.spawn('boss', 0, G.level.PH, -16.5);
    G.hud.banner('КОЛОСС');
    G.hud.objective('Колосс пробудился! Бей в пылающее сердце, держись подальше от клешни.', 'Сокруши Колосса');
    sfx.bossRoar();
    music.setIntensity(2);
  }

  update(dt) {
    const G = this.G, P = G.player.pos;
    this.time += dt;
    // секрет
    const S = G.level.secret;
    if (!this.secretFound && P.x > S.minX && P.x < S.maxX && P.z > S.minZ && P.z < S.maxZ) {
      this.secretFound = true;
      G.hud.banner('СЕКРЕТ НАЙДЕН', 2);
      G.hud.objectiveFlash('Тайник ордена! Здесь хранили реликвию и боеприпасы.');
      sfx.secret();
    }

    if (this.stage === 'approach') {
      this.target = G.level.arenaCenter;
      if (G.level.arenaEnter(P)) {
        G.level.gates.entry.set(false);
        sfx.gate();
        this.stage = 'between';
        this.timer = 1.2;
        this.nextWave = 0;
        this.target = null;
      }
    } else if (this.stage === 'between') {
      this.timer -= dt;
      if (this.timer <= 0) { if (this.nextWave < WAVES.length) this.startWave(this.nextWave); else this.startBoss(); }
    } else if (this.stage === 'wave') {
      this.spawnT -= dt;
      if (this.queue.length && this.spawnT <= 0 && G.enemies.aliveCount < MAX_ALIVE) { this.spawnOne(this.queue.pop()); this.spawnT = 0.7; }
      G.hud.objectiveShort(`Волна ${this.wave + 1} из 3 · врагов: ${this.remaining}`);
      if (!this.queue.length && G.enemies.aliveCount === 0) {
        this.stage = 'between';
        this.timer = 4;
        this.nextWave = this.wave + 1;
        G.hud.banner(this.wave < 2 ? 'ВОЛНА ОТБИТА' : 'ТИШИНА…', 2);
        music.setIntensity(0.4);
        if (this.wave === 1) {
          // после второй волны — новое оружие в центре
          G.pickups.add('weapon:thermal', 0, 0, 2.5);
          G.hud.objective('Оружейная капсула сброшена в центр площади. Подбери термокопьё!', 'Подбери термокопьё');
        }
      }
    } else if (this.stage === 'boss') {
      const b = G.enemies.boss;
      if (b) G.hud.objectiveShort(`Колосс: фаза ${b.phase} из 3`);
    } else if (this.stage === 'exit') {
      this.target = G.level.exitPoint;
      if (G.level.exitReached(P)) { this.stage = 'done'; G.onComplete(); }
    }
    this.updateTrail(dt);
  }

  onBossDead() {
    const G = this.G;
    setTimeout(() => {
      if (this.stage !== 'boss') return;
      this.stage = 'exit';
      G.level.gates.exit.set(true);
      sfx.gate();
      G.hud.banner('КОЛОСС ПАЛ');
      G.hud.objective('Площадь наша. Северные врата открыты — уходим!', 'Иди к северным вратам');
      music.setIntensity(0.3);
    }, 2600);
  }

  onBossPhase(phase) {
    const G = this.G;
    if (phase === 2) G.hud.objective('Колосс зовёт фанатиков и бьёт ракетами! Ищи укрытие.', 'Колосс: фаза 2');
    if (phase === 3) G.hud.objective('Он в ярости! Добей его, пока он не испепелил площадь!', 'Колосс: фаза 3');
  }

  // Цепочка золотых меток от игрока к цели (обновляется, мигает "бегущей" волной)
  updateTrail() {
    const G = this.G, P = G.player.pos, t = this.target;
    for (const m of this.marks) m.visible = false;
    if (!t || this.stage === 'done') return;
    const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz);
    if (d < 3) return;
    const nx = dx / d, nz = dz / d, yaw = Math.atan2(-nx, -nz);
    const n = Math.min(this.marks.length, Math.floor((d - 2) / 1.3));
    for (let i = 0; i < n; i++) {
      const m = this.marks[i], s = 2 + i * 1.3;
      const x = P.x + nx * s + Math.sin(i * 1.7) * 0.15, z = P.z + nz * s + Math.cos(i * 1.3) * 0.15;
      const y = G.world.groundAt(x, z, P.y + 2, 0.1);
      if (y < -1) continue;
      m.position.set(x, y + 0.03, z);
      m.rotation.y = yaw;
      m.material.opacity = 0.45 + 0.55 * Math.max(0, Math.sin(this.time * 4 - i * 0.6));
      m.visible = true;
    }
  }
}
