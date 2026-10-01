// Интерфейс: полоски здоровья/брони, патроны, волна, баннеры, маркер попадания.
// Меняем DOM только когда значение изменилось — так дешевле для телефона.
import { MAX_HEALTH, MAX_ARMOR } from './player.js';
import { MAG_SIZE } from './weapon.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), health: $('healthFill'), healthNum: $('healthNum'), armor: $('armorFill'), armorNum: $('armorNum'),
      ammo: $('ammo'), ammoNum: $('ammoNum'), reload: $('reloadHint'), wave: $('waveLabel'), left: $('enemiesLeft'),
      banner: $('banner'), boss: $('boss'), bossFill: $('bossFill'), hit: $('hitmarker'), damage: $('damage'),
    };
    this.cache = {};
    this.bannerTimer = null;
  }

  // Записать значение, только если оно изменилось
  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  update(player, weapon, waves, boss) {
    const e = this.el;
    const h = Math.ceil(player.health), a = Math.ceil(player.armor);
    this.set('h', h, (v) => { e.health.style.transform = `scaleX(${v / MAX_HEALTH})`; e.healthNum.textContent = v; });
    this.set('a', a, (v) => { e.armor.style.transform = `scaleX(${v / MAX_ARMOR})`; e.armorNum.textContent = v; });
    this.set('ammo', weapon.ammo, (v) => {
      e.ammoNum.textContent = v;
      e.ammo.classList.toggle('low', v <= MAG_SIZE / 4);
    });
    this.set('rl', weapon.reloading, (v) => { e.reload.textContent = v ? 'ПЕРЕЗАРЯДКА' : ''; });

    let label, left = '';
    if (waves.phase === 'boss') label = 'ФИНАЛЬНЫЙ БОЙ';
    else if (waves.index < 0) label = 'ПРИГОТОВЬСЯ';
    else {
      label = `ВОЛНА ${waves.index + 1} / ${waves.total}`;
      if (waves.phase === 'wave') left = `врагов: ${waves.remaining}`;
    }
    this.set('wave', label, (v) => { e.wave.textContent = v; });
    this.set('left', left, (v) => { e.left.textContent = v; });

    const bossHp = boss && !boss.dead ? Math.max(0, boss.hp / boss.maxHp) : -1;
    const b = Math.round(bossHp * 100);
    this.set('boss', b, (v) => {
      e.boss.classList.toggle('hidden', v < 0);
      if (v >= 0) e.bossFill.style.transform = `scaleX(${v / 100})`;
    });

    // Красная виньетка: вспышка при уроне + постоянная при низком здоровье
    const low = player.health < 30 ? 0.35 + Math.sin(performance.now() / 250) * 0.1 : 0;
    const dmg = Math.max(player.hurtFlash, low);
    this.set('dmg', Math.round(dmg * 50) / 50, (v) => { e.damage.style.opacity = v; });
  }

  banner(text, seconds = 2) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), seconds * 1000);
  }

  hideBanner() {
    clearTimeout(this.bannerTimer);
    this.el.banner.classList.remove('show');
  }

  // Маркер попадания у прицела (перезапуск CSS-анимации)
  hitmarker(kill) {
    const h = this.el.hit;
    h.classList.remove('show');
    h.classList.toggle('kill', kill);
    void h.offsetWidth;
    h.classList.add('show');
  }
}
