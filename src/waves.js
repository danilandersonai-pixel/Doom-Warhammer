// Волны врагов: 5 → 8 → 10, затем чемпион.
import { sfx } from './audio.js';

const WAVES = [
  { melee: 4, ranged: 1 },
  { melee: 5, ranged: 3 },
  { melee: 6, ranged: 4 },
];
const MAX_ALIVE = 7;       // сколько врагов одновременно на арене
const SPAWN_INTERVAL = 0.8;

export class Waves {
  constructor(enemies, spawnPoints, player, hud) {
    this.enemies = enemies;
    this.spawnPoints = spawnPoints;
    this.player = player;
    this.hud = hud;
    this.reset();
  }

  reset() {
    this.index = -1;
    this.phase = 'intermission'; // intermission | wave | boss
    this.timer = 2;
    this.queue = [];
    this.spawnTimer = 0;
  }

  get total() { return WAVES.length; }
  // сколько врагов осталось в текущей волне (ещё не появились + живые)
  get remaining() { return this.queue.length + this.enemies.aliveCount; }

  update(dt) {
    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.index < WAVES.length - 1) this.startWave(this.index + 1);
        else this.startBoss();
      }
      return;
    }
    if (this.phase === 'wave') {
      this.spawnTimer -= dt;
      if (this.queue.length && this.spawnTimer <= 0 && this.enemies.aliveCount < MAX_ALIVE) {
        this.spawnOne(this.queue.pop());
        this.spawnTimer = SPAWN_INTERVAL;
      }
      if (!this.queue.length && this.enemies.aliveCount === 0) {
        this.phase = 'intermission';
        this.timer = 4;
        this.hud.banner(this.index < WAVES.length - 1 ? 'ВОЛНА ОТБИТА' : 'ЧТО-ТО ПРИБЛИЖАЕТСЯ…', 2.5);
      }
    }
    // фаза boss: победу засчитывает main.js, когда чемпион убит
  }

  startWave(i) {
    this.index = i;
    this.phase = 'wave';
    const w = WAVES[i];
    this.queue = [...Array(w.melee).fill('melee'), ...Array(w.ranged).fill('ranged')];
    // перемешиваем, чтобы типы шли вперемешку
    for (let k = this.queue.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [this.queue[k], this.queue[j]] = [this.queue[j], this.queue[k]];
    }
    this.spawnTimer = 0.5;
    this.hud.banner(`ВОЛНА ${i + 1}`, 2);
    sfx.wave();
  }

  startBoss() {
    this.phase = 'boss';
    this.queue = [];
    this.spawnOne('boss');
    this.hud.banner('ЧЕМПИОН!', 2.5);
    sfx.boss();
  }

  // Появление врага в точке подальше от игрока
  spawnOne(type) {
    const p = this.player.pos;
    const far = this.spawnPoints.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > (type === 'boss' ? 16 : 11));
    const list = far.length ? far : this.spawnPoints;
    const s = list[Math.floor(Math.random() * list.length)];
    const jx = (Math.random() - 0.5) * 1.5, jz = (Math.random() - 0.5) * 1.5;
    this.enemies.spawn(type, s.x + jx, s.z + jz);
    sfx.spawn(0.6);
  }
}
