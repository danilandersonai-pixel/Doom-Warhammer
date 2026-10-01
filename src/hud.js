// Интерфейс: нижняя панель (портрет, броня/здоровье, клинок-полоса, оружие), полоса задачи с советником,
// ромб-маркер цели и стрелка у края, баннеры, подсказки. DOM меняем только когда значение изменилось.
import * as THREE from 'three';
import { miscArt } from './art_misc.js';
import { WEAPONS } from './weapons.js';
import { DASH_COOLDOWN } from './player.js';

const $ = (id) => document.getElementById(id);

// Рваная тёмная подложка для полосы задачи (рисуется один раз)
function raggedBackground() {
  const w = 220, h = 44, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = 7;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(30,36,44,0.88)';
  for (let x = 0; x < w; x++) {
    const top = 2 + Math.floor(R() * 3) + (x % 17 < 2 ? 1 : 0), bot = h - 2 - Math.floor(R() * 3);
    let l = 0, r = w;
    g.fillRect(x, top, 1, bot - top);
  }
  // рваные бока
  g.clearRect(0, 0, 3, h); g.clearRect(w - 3, 0, 3, h);
  for (let y = 0; y < h; y++) { g.clearRect(0, y, 3 + Math.floor(R() * 4), 1); g.clearRect(w - 3 - Math.floor(R() * 4), y, 8, 1); }
  // "дырки" у краёв
  for (let i = 0; i < 14; i++) {
    const x = 6 + R() * (w - 12), y = R() < 0.5 ? 3 + R() * 4 : h - 7 + R() * 4, r = 1 + R() * 2;
    g.clearRect(x - r, y - r, r * 2, r * 2);
  }
  return c.toDataURL();
}

export class Hud {
  constructor(G) {
    this.G = G;
    this.art = miscArt();
    this.el = {
      hud: $('hud'), damage: $('damage'), hit: $('hitmarker'), obj: $('objective'), objText: $('objText'), objShort: $('objShort'),
      banner: $('banner'), pickup: $('pickupMsg'), marker: $('marker'), markerDist: $('markerDist'), arrow: $('edgeArrow'),
      bossbar: $('bossbar'), bossFill: $('bossFill'), armor: $('armorNum'), health: $('healthNum'), hpRect: $('hpRect'),
      ammo: $('ammoText'), ammoRes: $('ammoRes'), gren: $('grenText'), dash: $('dashPip'), arRect: $('arRect'), bossLost: $('bossLost'), eliteName: $('eliteName'),
    };
    this.el.obj.style.backgroundImage = `url(${raggedBackground()})`;
    this.portrait = $('portrait').getContext('2d');
    this.weaponIcon = $('weaponIcon').getContext('2d');
    $('advisor').getContext('2d').drawImage(this.art.advisor, 0, 0);
    this.cache = {};
    this.objTimer = 0;
    this.v = new THREE.Vector3();
    this.bloodDots = [];
  }

  set(k, v, fn) { if (this.cache[k] === v) return; this.cache[k] = v; fn(v); }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  // Полная задача (советник говорит) — показывается на несколько секунд
  objective(text, short) {
    this.el.objText.textContent = text;
    this.el.obj.classList.remove('dim');
    this.cache.objDim = false;   // иначе set() не вернёт класс, и плашка останется поверх полосы элиты
    this.objTimer = 6;
    if (short) this.objectiveShort(short);
  }
  objectiveFlash(text) { this.objective(text, this.cache.short); }
  objectiveShort(text) { this.set('short', text, (v) => { this.el.objShort.textContent = v; }); }

  banner(text, sec = 2) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.bt);
    this.bt = setTimeout(() => b.classList.remove('show'), sec * 1000);
  }

  pickupMsg(text) {
    const p = this.el.pickup;
    p.textContent = text;
    p.classList.add('show');
    clearTimeout(this.pt);
    this.pt = setTimeout(() => p.classList.remove('show'), 1600);
  }
  pickupFlash() { this.pickupGlow = 0.4; }

  hitmarker(kill) {
    const h = this.el.hit;
    h.classList.remove('show');
    h.classList.toggle('kill', kill);
    void h.offsetWidth;
    h.classList.add('show');
  }

  // Кровь на портрете при ранении
  hurt() {
    for (let i = 0; i < 10; i++) this.bloodDots.push({ x: 6 + Math.random() * 28, y: 4 + Math.random() * 28, r: Math.random() < 0.3 ? 2 : 1, life: 2.5 });
    this.hurtT = 0.25;
  }

  hideAll() { this.el.objShort.classList.remove('show'); }

  update(dt) {
    const G = this.G, P = G.player, W = G.weapons, e = this.el;
    // задача: полоса гаснет, остаётся короткая строка
    this.objTimer -= dt;
    // полоса задачи — только на несколько секунд; если сверху полоса элиты — прячем
    const eliteOn = !e.bossbar.classList.contains('hidden');
    this.set('objDim', this.objTimer <= 0 || eliteOn, (v) => { e.obj.classList.toggle('dim', v); });

    // броня, здоровье, клинок
    const hp = Math.ceil(P.health), ar = Math.ceil(P.armor);
    this.set('hp', hp, (v) => { e.health.textContent = v; e.hpRect.setAttribute('width', String(5 + Math.min(1, v / 100) * 130)); });
    this.set('ar', ar, (v) => { e.armor.textContent = v; e.arRect.setAttribute('width', String(5 + Math.min(1, v / 100) * 112)); });

    // портрет: состояние по здоровью, вспышка боли, капли крови
    this.hurtT = (this.hurtT || 0) - dt;
    const st = hp > 60 ? 0 : hp > 30 ? 1 : 2;
    const g = this.portrait;
    g.clearRect(0, 0, 40, 40);
    g.drawImage(this.hurtT > 0 ? this.art.heroHurt[st] : this.art.hero[st], 0, 0);
    for (let i = this.bloodDots.length - 1; i >= 0; i--) {
      const d = this.bloodDots[i];
      d.life -= dt;
      if (d.life <= 0) { this.bloodDots.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, d.life);
      g.fillStyle = '#c8141c';
      g.fillRect(Math.round(d.x), Math.round(d.y + (2.5 - d.life) * 2), d.r, d.r + 1);
    }
    g.globalAlpha = 1;

    // оружие и патроны
    const w = WEAPONS[W.current], a = W.ammo[W.current];
    // лаймовый силуэт иконки оружия
    this.set('wicon', W.current, (k) => {
      const c = this.weaponIcon;
      c.clearRect(0, 0, 48, 20);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(this.art.icons[k], 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = '#bbde03';
      c.fillRect(0, 0, 48, 20);
      c.globalCompositeOperation = 'source-over';
    });
    const magStr = w.mag ? String(Math.ceil(a.mag)) : '∞';
    this.set('ammo', magStr + '|' + (w.mag ? a.reserve : '') + (W.reloading ? '*' : ''), () => {
      e.ammo.textContent = W.reloading ? '…' : magStr;
      e.ammoRes.textContent = w.mag ? a.reserve : '';
      e.ammo.classList.toggle('low', !!w.mag && a.mag <= w.mag * 0.25);
    });
    this.set('gren', W.grenades, (v) => { e.gren.textContent = v; });
    this.set('dash', Math.round((1 - P.dashCd / DASH_COOLDOWN) * 20), (v) => { e.dash.style.transform = `translateX(-50%) scaleX(${v / 20})`; e.dash.style.opacity = v >= 20 ? 0.85 : 0.35; });

    // красная вспышка урона + постоянная при низком здоровье
    const low = hp < 30 ? 0.3 + Math.sin(performance.now() / 220) * 0.1 : 0;
    this.set('dmg', Math.round(Math.max(P.hurtFlash * 0.9, low) * 40) / 40, (v) => { e.damage.style.opacity = v; });

    // элитный враг (босс или последний раненый тяжёлый демон): полоса и имя сверху
    const el = G.enemies.boss && !G.enemies.boss.dead ? G.enemies.boss : G.enemies.lastElite && !G.enemies.lastElite.dead ? G.enemies.lastElite : null;
    const bh = el && el.active ? Math.round((el.hp / el.maxHp) * 200) : -1;
    this.set('boss', bh, (v) => {
      e.bossbar.classList.toggle('hidden', v < 0);
      e.hud.classList.toggle('eliteOn', v >= 0);
      if (v >= 0) { e.bossFill.style.transform = `scaleX(${v / 200})`; e.bossLost.style.transform = `scaleX(${v / 200})`; }
    });
    this.set('eliteName', el ? el.type : '', (t) => { e.eliteName.textContent = t === 'boss' ? 'Колосс' : t === 'heavy' ? 'Тяжёлый демон' : ''; });

    this.updateMarker();
  }

  // Ромб над целью; если цель за кадром — золотая стрелка у края экрана
  updateMarker() {
    const G = this.G, t = G.flow.target, e = this.el;
    if (!t) { this.set('mk', 'off', () => { e.marker.style.display = 'none'; e.arrow.style.display = 'none'; }); return; }
    const W = window.innerWidth, H = window.innerHeight;
    const v = this.v.set(t.x, (t.y || 0) + 2.2, t.z).project(G.camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    const d = Math.round(Math.hypot(t.x - G.player.pos.x, t.z - G.player.pos.z));
    const onScreen = !behind && x > 40 && x < W - 40 && y > 60 && y < H - 80;
    this.cache.mk = null;
    if (onScreen) {
      e.marker.style.display = 'block';
      e.arrow.style.display = 'none';
      e.marker.style.left = x + 'px';
      e.marker.style.top = y + 'px';
      this.set('mdist', d, (val) => { e.markerDist.textContent = val + ' м'; });
    } else {
      e.marker.style.display = 'none';
      e.arrow.style.display = 'block';
      if (behind) { x = W - x; y = H - y; }
      const cx = W / 2, cy = H / 2;
      let ang = Math.atan2(y - cy, x - cx);
      if (behind) ang = Math.atan2(cy - cy, x < cx ? -1 : 1);
      const ax = cx + Math.cos(ang) * (W / 2 - 50), ay = cy + Math.sin(ang) * (H / 2 - 70);
      e.arrow.style.left = Math.max(40, Math.min(W - 40, ax)) + 'px';
      e.arrow.style.top = Math.max(70, Math.min(H - 90, ay)) + 'px';
      e.arrow.style.transform = `translate(-50%, -50%) rotate(${ang + Math.PI}rad)`;
    }
  }
}
