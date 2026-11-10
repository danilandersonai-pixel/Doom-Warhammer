// Интерфейс «уголь и латунь».
// Слева внизу — герой (портрет, здоровье, броня, рывок); справа внизу — оружие (патроны, гранаты, слоты 1–5);
// слева сверху — сообщение советника; сверху по центру — задача, прогресс волны, полоса босса/элиты.
// Вокруг прицела — хитмаркер и дуги направления урона; ещё — лента подборов, серия убийств, объявления.
// DOM меняем только когда значение изменилось (set()).
import * as THREE from 'three';
import { miscArt } from './art_misc.js';
import { WEAPONS, ORDER } from './weapons.js';
import { DASH_COOLDOWN } from './player.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const STREAKS = [[8, 'Гнев ордена'], [6, 'Жатва'], [4, 'Расправа'], [3, 'Тройное'], [2, 'Двойное']];
const ELITE_NAMES = { boss: 'Колосс', heavy: 'Тяжёлый демон' };
const TINT = { cur: '#ffd27a', owned: '#cfc9b8', none: '#6a6658' };

export class Hud {
  constructor(G) {
    this.G = G;
    this.art = miscArt();
    this.el = {
      hud: $('hud'), damage: $('damage'), glow: $('pickupGlow'), cross: $('crosshair'), hit: $('hitmarker'), arcs: [...$('dmgArcs').children],
      obj: $('objective'), objText: $('objText'), objShort: $('objShort'), waveRow: $('waveRow'), waveLabel: $('waveLabel'), wavePips: $('wavePips'),
      banner: $('banner'), bannerText: $('bannerText'), feed: $('feed'), streak: $('streak'), streakNum: $('streakNum'), streakText: $('streakText'),
      marker: $('marker'), markerDist: $('markerDist'), arrow: $('edgeArrow'),
      bossbar: $('bossbar'), bossFill: $('bossFill'), bossLost: $('bossLost'), eliteName: $('eliteName'), bossPhase: [...$('bossPhase').children],
      vitals: $('vitals'), health: $('healthNum'), armor: $('armorNum'), hpFill: $('hpFill'), hpLag: $('hpLag'), hpOver: $('hpOver'), arFill: $('arFill'), arOver: $('arOver'),
      dash: $('dashPip'), dashFill: $('dashFill'),
      wname: $('weaponName'), ammo: $('ammoText'), ammoRes: $('ammoRes'), gren: $('grenText'), grenBox: $('grenBox'), reload: $('reloadBar'), reloadFill: $('reloadFill'), slots: $('slots'),
    };
    this.portrait = $('portrait').getContext('2d');
    this.weaponIcon = $('weaponIcon').getContext('2d');
    $('advisor').getContext('2d').drawImage(this.art.advisor, 0, 0);

    // слоты оружия 1–5: силуэт иконки + номер
    this.slots = {};
    for (const k of ORDER) {
      const d = document.createElement('div');
      d.className = 'slot none';
      const c = document.createElement('canvas');
      c.width = 48; c.height = 20;
      const b = document.createElement('b');
      b.textContent = WEAPONS[k].slot;
      d.append(c, b);
      this.el.slots.append(d);
      this.slots[k] = { d, g: c.getContext('2d'), state: '' };
    }
    // иконки для ленты подборов
    const url = (c) => c.toDataURL();
    this.icons = { health: url(this.art.pickups.health), armor: url(this.art.pickups.armor), ammo: url(this.art.pickups.ammo), grenades: url(this.art.pickups.grenades), relic: url(this.art.pickups.relic) };
    for (const k of ORDER) this.icons['w:' + k] = url(this.art.icons[k]);

    this.cache = {};
    this.objTimer = 0;
    this.objFull = '';
    this.typeN = 0;
    this.v = new THREE.Vector3();
    this.bloodDots = [];
    this.arcs = this.el.arcs.map(() => ({ t: 0, x: 0, z: 0, k: 1 }));
    this.arcNext = 0;
    this.streakN = 0;
    this.lastKill = -1e9;
    this.waveTotal = 0;
    this.portraitKey = '';

    window.addEventListener('resize', () => this.layoutTouch());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.layoutTouch());
  }

  set(k, v, fn) { if (this.cache[k] === v) return; this.cache[k] = v; fn(v); }
  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    if (on) this.layoutTouch();
  }

  // Новый забег: убрать ленту, серию, дуги урона и кровь с портрета
  reset() {
    this.el.feed.replaceChildren();
    this.el.streak.classList.remove('show');
    this.el.banner.classList.remove('show');
    for (let i = 0; i < this.arcs.length; i++) { this.arcs[i].t = 0; this.el.arcs[i].style.opacity = 0; }
    this.bloodDots.length = 0;
    this.streakN = 0;
    this.waveTotal = 0;
    this.cache.waveIdx = -2;
    this.portraitKey = '';
  }

  // Сенсорные зоны поверх нижней панели: иконка оружия — смена, счётчик патронов — перезарядка, граната — бросок
  layoutTouch() {
    if (!this.G.isTouch || this.el.hud.classList.contains('hidden')) return;
    const place = (btnId, target, padX, padY) => {
      const b = $(btnId), r = target.getBoundingClientRect();
      if (!b || !r.width) return;
      const h = Math.max(r.height + padY * 2, 44);
      b.style.left = Math.round(r.left - padX) + 'px';
      b.style.top = Math.round(r.top + r.height / 2 - h / 2) + 'px';
      b.style.width = Math.round(r.width + padX * 2) + 'px';
      b.style.height = Math.round(h) + 'px';
    };
    place('btnSwap', $('weaponIcon'), 5, 6);
    place('btnReload', this.el.ammo.parentElement, 5, 6);
    place('btnGrenade', this.el.grenBox, 3, 6);
  }

  // Сообщение советника: печатается по буквам, держится несколько секунд
  objective(text, short) {
    this.objFull = text;
    this.typeN = 0;
    this.el.objText.textContent = '';
    this.el.obj.classList.remove('dim');
    this.cache.objDim = false;
    this.objTimer = 6.5;
    if (short) this.objectiveShort(short);
  }
  objectiveFlash(text) { this.objective(text, this.cache.short); }
  objectiveShort(text) { this.set('short', text, (v) => { this.el.objShort.textContent = v; }); }

  // Объявление: крупная надпись между линейками. Цвет — по смыслу (босс, секрет)
  banner(text, sec = 2) {
    const b = this.el.banner;
    this.el.bannerText.textContent = text;
    b.classList.remove('show', 'boss', 'secret');
    if (/КОЛОСС/.test(text) && !/ПАЛ/.test(text)) b.classList.add('boss');
    if (/СЕКРЕТ/.test(text)) b.classList.add('secret');
    b.style.setProperty('--dur', (sec + 0.5) + 's');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // Лента подборов: строка с иконкой, гаснет сама
  pickupMsg(text) {
    const f = this.el.feed;
    const line = document.createElement('div');
    let icon = null, wide = false;
    if (/новое оружие/.test(text)) { const k = ORDER.find((w) => text.startsWith(WEAPONS[w].name)); icon = k && this.icons['w:' + k]; wide = true; line.className = 'line big'; }
    else {
      icon = /Реликвия/.test(text) ? this.icons.relic : /здоровья/.test(text) ? this.icons.health : /брони/.test(text) ? this.icons.armor : /гранат/.test(text) ? this.icons.grenades : /Патроны/.test(text) ? this.icons.ammo : null;
      line.className = /Реликвия/.test(text) ? 'line big' : 'line';
    }
    if (icon) { const im = document.createElement('img'); im.src = icon; if (wide) im.className = 'wide'; line.append(im); }
    line.append(document.createTextNode(text));
    f.prepend(line);
    while (f.children.length > 4) f.lastChild.remove();
    setTimeout(() => line.remove(), 2600);
  }
  pickupFlash() {
    const g = this.el.glow;
    g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
  }

  hitmarker(kill) {
    const h = this.el.hit;
    h.classList.remove('show');
    h.classList.toggle('kill', !!kill);
    void h.offsetWidth;
    h.classList.add('show');
  }

  // Ранение: кровь на портрете + дуга с той стороны, откуда пришёл урон (from — точка в мире)
  hurt(from, amount = 10) {
    for (let i = 0; i < 10; i++) this.bloodDots.push({ x: 6 + Math.random() * 28, y: 4 + Math.random() * 28, r: Math.random() < 0.3 ? 2 : 1, life: 2.5 });
    this.hurtT = 0.25;
    if (!from || typeof from.x !== 'number') return;
    const P = this.G.player.pos;
    if (Math.hypot(from.x - P.x, from.z - P.z) < 0.25) return;       // урон «из себя» — без направления
    const a = this.arcs[this.arcNext];
    this.arcNext = (this.arcNext + 1) % this.arcs.length;
    a.x = from.x; a.z = from.z; a.t = 1.2; a.k = Math.min(1, 0.55 + amount / 40);
  }

  // Серия убийств: несколько подряд за короткое время
  kill() {
    const now = performance.now();
    this.streakN = now - this.lastKill < 3200 ? this.streakN + 1 : 1;
    this.lastKill = now;
    if (this.streakN < 2) return;
    const tier = STREAKS.find(([n]) => this.streakN >= n);
    this.el.streakNum.textContent = '×' + this.streakN;
    this.el.streakText.textContent = tier[1];
    const s = this.el.streak;
    s.classList.remove('show'); void s.offsetWidth; s.classList.add('show');
  }

  hideAll() { this.el.objShort.classList.remove('show'); }

  // Силуэт иконки оружия в слоте, цвет — по состоянию
  drawSlot(k, state) {
    const s = this.slots[k];
    if (s.state === state) return;
    s.state = state;
    s.d.className = 'slot' + (state === 'cur' ? ' cur' : state === 'none' ? ' none' : '');
    const g = s.g;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 48, 20);
    g.drawImage(this.art.icons[k], 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = TINT[state];
    g.fillRect(0, 0, 48, 20);
    g.globalCompositeOperation = 'source-over';
  }

  update(dt) {
    const G = this.G, P = G.player, W = G.weapons, F = G.flow, e = this.el;

    // ----- сообщение советника: печать по буквам, потом гаснет -----
    if (this.typeN < this.objFull.length) {
      const before = Math.floor(this.typeN);
      this.typeN = Math.min(this.objFull.length, this.typeN + dt * 60);
      if (Math.floor(this.typeN) !== before) e.objText.textContent = this.objFull.slice(0, Math.floor(this.typeN));
    } else this.objTimer -= dt;
    this.set('objDim', this.objTimer <= 0, (v) => { e.obj.classList.toggle('dim', v); });

    // ----- здоровье, броня, рывок -----
    const hp = Math.ceil(P.health), ar = Math.ceil(P.armor);
    this.set('hp', hp, (v) => {
      e.health.textContent = v;
      const k = `scaleX(${Math.min(1, v / 100)})`;
      e.hpFill.style.transform = k; e.hpLag.style.transform = k;
      e.hpOver.style.transform = `scaleX(${Math.max(0, Math.min(1, (v - 100) / 100))})`;
      e.vitals.classList.toggle('crit', v < 30);
    });
    this.set('ar', ar, (v) => {
      e.armor.textContent = v;
      e.arFill.style.transform = `scaleX(${Math.min(1, v / 100)})`;
      e.arOver.style.transform = `scaleX(${Math.max(0, Math.min(1, (v - 100) / 100))})`;
    });
    this.set('dash', Math.round((1 - P.dashCd / DASH_COOLDOWN) * 20), (v) => { e.dashFill.style.transform = `scaleX(${v / 20})`; e.dash.classList.toggle('ready', v >= 20); });

    // ----- портрет: состояние по здоровью, вспышка боли, капли крови (перерисовка только при изменениях) -----
    this.hurtT = (this.hurtT || 0) - dt;
    const st = hp > 60 ? 0 : hp > 30 ? 1 : 2, pain = this.hurtT > 0;
    const pkey = st + (pain ? 'h' : '') + (this.bloodDots.length ? 'd' : '');
    if (this.bloodDots.length || pkey !== this.portraitKey) {
      this.portraitKey = pkey;
      const g = this.portrait;
      g.clearRect(0, 0, 40, 40);
      g.drawImage(pain ? this.art.heroHurt[st] : this.art.hero[st], 0, 0);
      for (let i = this.bloodDots.length - 1; i >= 0; i--) {
        const d = this.bloodDots[i];
        d.life -= dt;
        if (d.life <= 0) { this.bloodDots.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, d.life);
        g.fillStyle = '#c8141c';
        g.fillRect(Math.round(d.x), Math.round(d.y + (2.5 - d.life) * 2), d.r, d.r + 1);
      }
      g.globalAlpha = 1;
    }

    // ----- оружие: иконка, название, слоты, патроны, перезарядка, гранаты -----
    const w = WEAPONS[W.current], a = W.ammo[W.current];
    this.set('wicon', W.current, (k) => {
      const c = this.weaponIcon;
      c.clearRect(0, 0, 48, 20);
      c.drawImage(this.art.icons[k], 0, 0);
      e.wname.textContent = WEAPONS[k].name;
      e.wname.classList.remove('flash'); void e.wname.offsetWidth; e.wname.classList.add('flash');
    });
    let own = W.current;
    for (const k of ORDER) own += W.owned.has(k) ? '1' : '0';
    this.set('slots', own, () => { for (const k of ORDER) this.drawSlot(k, k === W.current ? 'cur' : W.owned.has(k) ? 'owned' : 'none'); });
    const magStr = w.mag ? String(Math.ceil(a.mag)) : '∞';
    this.set('ammo', magStr + '|' + (w.mag ? a.reserve : ''), () => {
      e.ammo.textContent = magStr;
      e.ammoRes.textContent = w.mag ? a.reserve : '';
      e.ammo.classList.toggle('low', !!w.mag && a.mag <= w.mag * 0.25);
    });
    this.set('rl', W.reloading ? Math.round((1 - W.reloadT / w.reload) * 24) : -1, (v) => {
      e.reload.classList.toggle('on', v >= 0);
      if (v >= 0) e.reloadFill.style.transform = `scaleX(${v / 24})`;
    });
    this.set('gren', W.grenades, (v) => { e.gren.textContent = v; e.grenBox.classList.toggle('empty', v <= 0); });

    // ----- прицел расходится от отдачи, бега и прыжка -----
    const gap = w.melee ? 8 : 5 + P.speed01 * 4 + W.recoil * 7 + (w.spread || 0) * 90 + (P.onGround ? 0 : 4);
    this.set('gap', Math.round(gap), (v) => { e.cross.style.setProperty('--gap', v + 'px'); });

    // ----- дуги направления урона: следят за источником, пока гаснут -----
    for (let i = 0; i < this.arcs.length; i++) {
      const A = this.arcs[i];
      if (A.t <= 0) continue;
      A.t -= dt;
      const s = e.arcs[i].style;
      if (A.t <= 0) { s.opacity = 0; continue; }
      const ang = P.yaw + Math.PI - Math.atan2(A.x - P.pos.x, A.z - P.pos.z);
      s.transform = `rotate(${ang.toFixed(3)}rad)`;
      s.opacity = (Math.min(1, A.t * 1.7) * A.k).toFixed(2);
    }

    // ----- без постобработки: красная кромка урона слоем DOM (иначе её рисует шейдер) -----
    if (!G.post || !G.post.enabled) {
      const low = hp < 30 ? 0.3 + Math.sin(performance.now() / 220) * 0.1 : 0;
      this.set('dmg', Math.round(Math.max(P.hurtFlash * 0.9, low) * 40) / 40, (v) => { e.damage.style.opacity = v; });
    }

    // ----- элитный враг (босс или последний раненый тяжёлый демон): полоса, имя, фазы -----
    const en = G.enemies;
    const el = en.boss && !en.boss.dead ? en.boss : en.lastElite && !en.lastElite.dead ? en.lastElite : null;
    const bh = el && el.active ? Math.round((el.hp / el.maxHp) * 200) : -1;
    this.set('boss', bh, (v) => {
      e.bossbar.classList.toggle('hidden', v < 0);
      if (v >= 0) { e.bossFill.style.transform = `scaleX(${v / 200})`; e.bossLost.style.transform = `scaleX(${v / 200})`; }
    });
    this.set('eliteName', el ? el.type : '', (t) => { e.eliteName.textContent = ELITE_NAMES[t] || ''; e.bossbar.classList.toggle('elite', t !== 'boss'); });
    this.set('bphase', el && el.type === 'boss' ? el.phase : 0, (v) => { e.bossPhase.forEach((p, i) => p.classList.toggle('on', i < v)); });

    // ----- волна: ромбы по числу врагов, убитые гаснут; в бою с боссом короткая задача уступает место полосе -----
    const inWave = F.stage === 'wave';
    if (inWave) {
      const rem = F.queue.length + en.aliveCount;
      if (this.cache.waveIdx !== F.wave) { this.cache.waveIdx = F.wave; this.waveTotal = 0; }
      this.waveTotal = Math.max(this.waveTotal, rem);
      this.set('wave', F.wave + '|' + this.waveTotal + '|' + rem, () => {
        e.waveLabel.textContent = `Волна ${ROMAN[F.wave] || F.wave + 1} из III`;
        const pips = e.wavePips;
        while (pips.children.length < this.waveTotal) pips.append(document.createElement('i'));
        while (pips.children.length > this.waveTotal) pips.lastChild.remove();
        const dead = this.waveTotal - rem;
        for (let i = 0; i < pips.children.length; i++) pips.children[i].classList.toggle('dead', i >= pips.children.length - dead);
      });
    }
    this.set('waveOn', inWave, (v) => { e.waveRow.classList.toggle('hidden', !v); });
    this.set('shortOn', !!this.cache.short && !inWave && !(F.stage === 'boss' && bh >= 0), (v) => { e.objShort.classList.toggle('show', v); });

    this.updateMarker();
  }

  // Ромб над целью; если цель за кадром — стрелка у края экрана
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
