// Точка входа: рендер, игровой цикл, связь систем, попадания и урон, экраны, настройки.
import * as THREE from 'three';
import { World } from './physics.js';
import { buildLevel } from './level.js';
import { createFX } from './effects.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Projectiles } from './projectiles.js';
import { Enemies } from './enemies.js';
import { Pickups } from './pickups.js';
import { Flow } from './flow.js';
import { Hud } from './hud.js';
import { initAudio, sfx, audioSettings, music } from './audio.js';
import { loadSprites, loadTextureImages } from './sprites.js';
import { createSky } from './sky.js';
import { PostFX } from './postfx.js';

// Шрифты грузим из скрипта, чтобы они не задерживали старт (нет сети — останутся системные)
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Forum&family=Press+Start+2P&family=Yanone+Kaffeesatz:wght@400;700&display=swap';
document.head.appendChild(fontLink);

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---------- Настройки (сохраняются в браузере, если можно) ----------
const settings = { sens: 1, btnSize: 1, btnAlpha: 0.55, music: true, gyro: false, volume: 1, quality: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('ironCrusadeSettings') || '{}')); } catch { /* без сохранения */ }
function saveSettings() { try { localStorage.setItem('ironCrusadeSettings', JSON.stringify(settings)); } catch { /* нет хранилища */ } }
function applySettings() {
  document.documentElement.style.setProperty('--btn-scale', settings.btnSize);
  document.documentElement.style.setProperty('--btn-alpha', settings.btnAlpha);
  audioSettings(settings);
}
applySettings();

// ---------- Рендер: близко к родному разрешению (окружение гладкое, пиксели — в текстурах) ----------
// Качество графики: low — без постобработки и теней (слабые телефоны); medium — свечение и тени;
// high — плюс сглаживание, лучи света, тени высокого разрешения. auto: телефон → medium, компьютер → high.
const QUALITY = {
  low: { scale: isTouch ? 0.7 : 1, shadow: 0, lights: 2 },
  medium: { scale: isTouch ? 0.75 : 1, shadow: 1024, lights: 4 },
  high: { scale: 1, shadow: 2048, lights: 7 },
};
const qualityName = () => (QUALITY[settings.quality] ? settings.quality : isTouch ? 'medium' : 'high');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;       // тени статичны: карта пересчитывается только когда двигаются ворота
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 900);
camera.rotation.order = 'YXZ';
const overlay = document.getElementById('overlay');
const post = new PostFX(renderer);
post.setOverlay(overlay);

// ---------- Общий контекст игры ----------
const G = { scene, camera, isTouch, settings, renderer, post };
// запечённые атласы врагов (3D → 8 ракурсов → пиксели) — до постройки уровня и врагов
await loadTextureImages(['floor', 'metal', 'rust', 'rock', 'cobble']);
await loadSprites(['fanatic', 'gunner', 'heavy', 'boss', 'w_rifle', 'w_shotgun', 'w_plasma', 'w_thermal', 'w_chainblade', 'w_throw']);
G.world = new World();
G.sky = createSky(scene);
G.sky.lightning.onStrike = (delay) => sfx.thunder(delay, 0.5 + Math.random() * 0.5);
G.level = buildLevel(scene, G.world, G);
G.fx = createFX(scene);
G.input = new Input(isTouch, settings);
G.player = new Player(G.world);
G.hud = new Hud(G);
G.projectiles = new Projectiles(G);
G.enemies = new Enemies(G);
G.pickups = new Pickups(G);
G.weapons = new Weapons(G, overlay);
G.flow = new Flow(G);
const game = { state: 'menu', time: 0, stats: { kills: 0, shots: 0 } };
G.game = game;

// ---------- Луч выстрела: геометрия уровня + хитбоксы врагов + бочки ----------
const ray = new THREE.Raycaster();
G.hitscan = (origin, dir, far) => {
  ray.set(origin, dir);
  ray.far = far;
  const targets = G.level.solid.concat(G.enemies.hitboxes(), G.pickups.barrelMeshes());
  const h = ray.intersectObjects(targets, false)[0];
  if (!h) return null;
  return {
    point: h.point, distance: h.distance, object: h.object,
    enemy: h.object.userData.enemy || null, barrel: h.object.userData.barrel || null,
    normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0),
  };
};

// Результат попадания: кровь/искры, урон, декали
G.applyHit = (hit, dmg, dir, source, quiet = false) => {
  if (hit.enemy) {
    const killed = G.enemies.damage(hit.enemy, dmg, hit.point, source, dir);
    if (!quiet || killed) G.hud.hitmarker(killed);
    if (!quiet) sfx.flesh();
  } else if (hit.barrel) {
    G.pickups.damageBarrel(hit.barrel, dmg);
    G.fx.sparks.burst(hit.point, 6, 0xffc060, { speed: 4, life: 0.3, size: 0.06, hdr: 3 });
  } else if (!quiet) {
    G.fx.impact(hit.point, hit.normal);     // выбоина с раскалённой кромкой, искры, пыль
  }
};

// Урон по площади (взрывы): враги, бочки, игрок
G.damageArea = (p, radius, dmg, source, except = null, quiet = false) => {
  for (const e of G.enemies.list) {
    if (e.dead || !e.active || e === except) continue;
    const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dy = e.pos.y + e.height / 2 - p.y;
    const d = Math.max(0, Math.hypot(dx, dy, dz) - e.radius);
    if (d > radius) continue;
    const k = 1 - d / radius;
    G.enemies.damage(e, dmg * k, { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, source, { x: dx, y: 0.5, z: dz });
    if (!quiet && e.type !== 'boss') G.enemies.knockback(e, dx / (d + 0.5), dz / (d + 0.5), 8 * k);
  }
  for (const b of G.pickups.barrels) {
    if (b.dead || source === 'thermal') continue;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d < radius) G.pickups.damageBarrel(b, dmg * (1 - d / radius));
  }
  if (source !== 'rifle' && source !== 'thermal') {
    const P = G.player;
    const d = Math.hypot(P.pos.x - p.x, P.pos.y + 1 - p.y, P.pos.z - p.z);
    if (d < radius) G.hurtPlayer(dmg * (1 - d / radius) * (source === 'enemyRocket' ? 1 : 0.4), p);
  }
};

G.hurtPlayer = (amount, from) => {
  if (game.state !== 'playing' || amount <= 0) return;
  G.player.damage(amount);
  G.hud.hurt(from, amount);      // from — точка в мире, откуда пришёл урон (для указателя направления)
  sfx.hurt();
};

G.onEnemyKilled = (e) => {
  game.stats.kills++;
  if (G.hud.kill) G.hud.kill(e);
  if (e.type !== 'boss') G.pickups.drop(e);
};
G.onBossPhase = (phase) => G.flow.onBossPhase(phase);
G.onBossDead = () => G.flow.onBossDead();
G.onComplete = () => endGame(true);

// ---------- Экраны ----------
// Один оверлей #screen в четырёх режимах (data-mode): menu — титул поверх облёта арены, pause, dead, won.
// Поверх него открываются листы настроек и управления.
const screen = document.getElementById('screen');
const $ = (id) => document.getElementById(id);
const INTRO = 'Орден Железного Похода высадился у осквернённой площади. Очисти её от еретиков и сокруши их Колосса.';
$('controlsHelp').innerHTML = isTouch
  ? `<ul class="touchHelp">
      <li><b>Движение</b> — коснись левой части экрана: появится стик.</li>
      <li><b>Обзор</b> — свайп по правой части. Кнопку огня можно вести пальцем, чтобы целиться.</li>
      <li><b>Кнопки справа</b> — огонь, прыжок, рывок, удар цепным клинком.</li>
      <li><b>Нижняя панель</b> — тап по иконке оружия меняет оружие, по счётчику патронов — перезарядка, по гранате — бросок.</li>
      <li><b>Пауза</b> — три полоски справа сверху.</li>
    </ul>`
  : `<div class="keys">
      <kbd>W A S D</kbd><span>бег</span><kbd>Мышь</kbd><span>обзор</span>
      <kbd>ЛКМ</kbd><span>огонь</span><kbd>ПКМ · F</kbd><span>цепной клинок</span>
      <kbd>Пробел</kbd><span>прыжок</span><kbd>Shift</kbd><span>рывок</span>
      <kbd>G</kbd><span>граната</span><kbd>R</kbd><span>перезарядка</span>
      <kbd>1–5 · колесо</kbd><span>смена оружия</span><kbd>Esc</kbd><span>пауза</span>
    </div>`;
$('screenText').textContent = INTRO;
$('footHint').innerHTML = isTouch ? '' : '<b>WASD</b> бег · <b>ЛКМ</b> огонь · <b>Shift</b> рывок · <b>F</b> клинок · <b>G</b> граната · <b>Esc</b> пауза';

function showScreen(mode, title, sub, html, btn, restart = false) {
  screen.dataset.mode = mode;
  $('screenTitle').textContent = title;
  $('screenSub').textContent = sub;
  $('screenText').innerHTML = html;
  $('screenBtn').textContent = btn;
  $('restartBtn').classList.toggle('hidden', !restart);
  closeSheets();
  screen.classList.remove('hidden');
}

// листы настроек и управления
function closeSheets() {
  $('settings').classList.add('hidden');
  $('controls').classList.add('hidden');
  screen.classList.remove('sheetOpen');
}
function openSheet(id) {
  closeSheets();
  $(id).classList.remove('hidden');
  screen.classList.add('sheetOpen');
}

function lockPointer() {
  if (isTouch) return;
  const p = renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

function startGame() {
  initAudio();
  G.enemies.clear();
  G.projectiles.clear();
  G.fx.clear();
  G.player.reset(G.level.playerStart);
  G.weapons.reset();
  G.pickups.reset();
  G.hud.reset();
  G.flow.reset();
  game.stats = { kills: 0 };
  game.elapsed = 0;
  resume();
}

function resume() {
  initAudio();
  game.state = 'playing';
  screen.classList.add('hidden');
  G.hud.show(true);
  $('touch').classList.toggle('hidden', !isTouch);
  G.input.reset();
  lockPointer();
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  G.input.reset();
  sfx.beam(false);
  $('touch').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  showScreen('pause', 'ПАУЗА', 'бой ждёт', '', 'ПРОДОЛЖИТЬ', true);
}

function fmtTime(t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }

// Ранг за прохождение: скорость и найденный тайник
function rankOf(t, secret) {
  const pts = (t < 240 ? 2 : t < 360 ? 1 : 0) + (secret ? 1 : 0);
  return pts >= 3 ? ['I', 'Паладин похода'] : pts === 2 ? ['II', 'Рыцарь ордена'] : pts === 1 ? ['III', 'Брат-воин'] : ['IV', 'Оруженосец'];
}

function endGame(won) {
  game.state = won ? 'won' : 'dead';
  G.input.reset();
  sfx.beam(false);
  $('touch').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const secret = G.flow.secretFound;
  const rows = `<span>Время</span><b>${fmtTime(game.elapsed)}</b><span>Убито врагов</span><b>${game.stats.kills}</b><span>Секреты</span><b>${secret ? 1 : 0} / 1</b>`;
  if (won) {
    const [num, name] = rankOf(game.elapsed, secret);
    const medal = `<div class="medal r${ROMAN_RANK[num]}"><svg viewBox="0 0 100 100"><use href="#crest"/></svg></div>`;
    sfx.victory();
    music.setIntensity(0);
    showScreen('won', 'ПЛОЩАДЬ ОЧИЩЕНА', 'уровень пройден', `<div class="result">${medal}<div class="stats">${rows}<div class="rank">Ранг ${num} · ${name}</div></div></div>`, 'ЕЩЁ РАЗ');
  } else {
    const F = G.flow;
    const where = F.stage === 'boss' ? 'в бою с Колоссом' : F.wave >= 0 ? `на волне ${F.wave + 1} из 3` : 'на подступах к площади';
    sfx.defeat();
    showScreen('dead', 'ВЫ ПАЛИ', 'орден помнит', `<div class="result"><div class="stats">${rows}<div class="rank">Пал ${where}</div></div></div>`, 'ЗАНОВО');
  }
}
const ROMAN_RANK = { I: 1, II: 2, III: 3, IV: 4 };

$('screenBtn').addEventListener('click', () => { if (game.state === 'paused') resume(); else startGame(); });
$('restartBtn').addEventListener('click', () => startGame());
$('settingsBtn').addEventListener('click', () => openSheet('settings'));
$('controlsBtn').addEventListener('click', () => openSheet('controls'));
for (const b of document.querySelectorAll('.sheetClose')) b.addEventListener('click', closeSheets);
$('menuBtn').addEventListener('click', () => pause());
window.addEventListener('keydown', (e) => {
  if (game.state === 'playing') return;
  if (e.code === 'Enter' && e.target && e.target.closest && e.target.closest('button, input')) return;   // Enter на кнопке — её собственный клик
  if (e.code === 'Escape' && screen.classList.contains('sheetOpen')) closeSheets();
  else if (e.code === 'Enter' && !screen.classList.contains('sheetOpen')) $('screenBtn').click();
});

// настройки
const bind = (id, key, parse = Number) => {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
  el.addEventListener('input', async () => {
    settings[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
    if (key === 'gyro' && settings.gyro) { settings.gyro = await G.input.enableGyro(); el.checked = settings.gyro; }
    applySettings();
    saveSettings();
  });
};
bind('setSens', 'sens'); bind('setBtnSize', 'btnSize'); bind('setBtnAlpha', 'btnAlpha'); bind('setMusic', 'music'); bind('setGyro', 'gyro');

// качество графики: Авто / Низкое / Среднее / Высокое
const QUALITY_LABEL = { low: 'Низкое', medium: 'Среднее', high: 'Высокое' };
const QUALITY_HINT = { low: 'без теней и свечения — для слабых телефонов', medium: 'тени и свечение', high: 'тени высокого разрешения, сглаживание, лучи света' };
function showQuality() {
  const cur = QUALITY[settings.quality] ? settings.quality : 'auto', real = qualityName();
  for (const b of $('setQuality').children) b.classList.toggle('on', b.dataset.q === cur);
  $('qualityHint').textContent = (cur === 'auto' ? `Авто → ${QUALITY_LABEL[real]}: ` : '') + QUALITY_HINT[real];
}
for (const b of $('setQuality').children) {
  b.addEventListener('click', () => {
    settings.quality = b.dataset.q;
    saveSettings();
    G.applyQuality();
    showQuality();
  });
}
showQuality();

// всё загружено и построено — убираем экран загрузки
const loading = $('loading');
if (loading) { loading.classList.add('done'); setTimeout(() => loading.remove(), 700); }

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) game.wasLocked = true;
  else if (game.wasLocked && game.state === 'playing') pause();
});
renderer.domElement.addEventListener('click', () => { if (game.state === 'playing' && !document.pointerLockElement) lockPointer(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Размер окна и качество графики ----------
// Адаптивное разрешение: если кадр считается слишком долго, плавно снижаем разрешение рендера (до 55%),
// а если и этого мало — ступень качества. Интерфейс и пиксельные спрайты при этом остаются чёткими.
const perf = { k: 1, acc: 0, n: 0, slow: 0, auto: !navigator.webdriver };
function resize() {
  const w = window.innerWidth, h = window.innerHeight, Q = QUALITY[qualityName()];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * Q.scale * perf.k);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.userData.baseFov = w < h ? 92 : 76;
  camera.updateProjectionMatrix();
  // пиксельный слой: 256 "пикселей" по высоте → оружие занимает ~45% кадра, пиксели крупные и чёткие
  overlay.height = 256;
  overlay.width = Math.round((256 * w) / h);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(size.x, size.y);
  G.fx.setScale(h * renderer.getPixelRatio());
  G.sky.setScale(h * renderer.getPixelRatio());
}
function applyQuality() {
  const name = qualityName(), Q = QUALITY[name];
  post.setQuality(name);
  document.body.classList.toggle('postfx', post.enabled);
  G.sky.setMask(post.enabled);
  const shadows = Q.shadow > 0;
  if (renderer.shadowMap.enabled !== shadows || G.sky.sun.shadow.mapSize.x !== (Q.shadow || 512)) {
    renderer.shadowMap.enabled = shadows;
    G.sky.sun.castShadow = shadows;
    G.sky.sun.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512);
    if (G.sky.sun.shadow.map) { G.sky.sun.shadow.map.dispose(); G.sky.sun.shadow.map = null; }
    scene.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; });
  }
  G.level.setLights(Q.lights);
  renderer.shadowMap.needsUpdate = true;
  resize();
}
function watchPerformance(dt) {
  if (!perf.auto || game.state !== 'playing') return;
  perf.acc += dt; perf.n++;
  if (perf.acc < 2.5) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0; perf.n = 0;
  if (avg > 1 / 42) {
    if (perf.k > 0.56) { perf.k = Math.max(0.55, perf.k - 0.15); resize(); }
    else if (++perf.slow >= 2) {
      // разрешение уже минимальное — опускаем качество на ступень
      const name = qualityName(), next = name === 'high' ? 'medium' : name === 'medium' ? 'low' : null;
      perf.slow = 0;
      if (next) { settings.quality = next; perf.k = 0.85; applyQuality(); G.hud.pickupMsg(next === 'low' ? 'Графика: низкое качество (для плавности)' : 'Графика: среднее качество (для плавности)'); }
    }
  } else if (avg < 1 / 57 && perf.k < 1) { perf.slow = 0; perf.k = Math.min(1, perf.k + 0.1); resize(); }
}
window.addEventListener('resize', resize);
applyQuality();
G.applyQuality = applyQuality;   // вызвать после смены settings.quality ('auto' | 'low' | 'medium' | 'high')

// ---------- Игровой цикл ----------
const clock = new THREE.Clock();
let pruneT = 0;

function update(dt) {
  const I = G.input, P = G.player;
  game.elapsed += dt;
  I.pollGamepad(dt);
  if (I.take('pause')) { pause(); return; }
  const look = I.consumeLook();
  P.look(look.x, look.y);
  const move = I.getMove();
  if (I.take('jump')) P.jump();
  if (I.take('dash')) P.dash(move);
  P.update(dt, move);
  for (const ev of P.events) {
    if (ev === 'step') sfx.step(); else if (ev === 'jump') sfx.jump(); else if (ev === 'land') sfx.land(); else if (ev === 'dash') sfx.dash();
    else if (ev === 'fall') G.hud.objectiveFlash('Пропасть! Возвращаю к последней точке.');
  }
  P.events.length = 0;
  P.applyCamera(camera, game.time);
  camera.updateMatrixWorld();
  G.weapons.update(dt, I, game.time);
  G.enemies.update(dt, game.time);
  G.projectiles.update(dt);
  G.pickups.update(dt, game.time);
  G.flow.update(dt);
  G.hud.update(dt);
  pruneT -= dt;
  if (pruneT <= 0) { pruneT = 2; G.enemies.prune(); }
  if (P.dead) endGame(false);
}

// Облёт арены на титульном экране
function menuCamera(t) {
  const a = t * 0.045 + 0.6;
  camera.position.set(Math.sin(a) * 11.5, 3.3 + Math.sin(t * 0.11) * 1.3, 8.5 + Math.cos(a * 0.8) * 7);
  camera.lookAt(Math.sin(a * 0.6 + 1) * 3.5, 7.2, -20);
}

const sunUv = new THREE.Vector2();
function frame() {
  requestAnimationFrame(frame);
  const dt = G.fx.scaleTime(Math.min(clock.getDelta(), 0.05));   // миг остановки при мощном ударе, замедление при гибели босса
  game.time += dt;
  watchPerformance(dt);
  if (game.state === 'playing') update(dt);
  else if (game.state === 'won' || game.state === 'dead') G.enemies.update(dt, game.time);
  G.level.update(dt, game.time);
  if (G.level.shadowsDirty) { renderer.shadowMap.needsUpdate = true; G.level.shadowsDirty = false; }
  G.fx.update(dt, G.world, camera.position, game.time);
  const P = G.player, inMenu = game.state === 'menu';
  if (inMenu) menuCamera(game.time); else P.applyCamera(camera, game.time);
  const fov = inMenu ? 62 : (camera.userData.baseFov || 76) * (camera.userData.fovK || 1);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  G.sky.update(dt, game.time, camera);
  if (game.state === 'playing' || game.state === 'paused') G.weapons.draw(dt, game.time);
  else G.weapons.ctx.clearRect(0, 0, overlay.width, overlay.height);

  // параметры постобработки от состояния игры
  const fx = post.fx, W = G.weapons, alive = !inMenu && !P.dead;
  fx.damage = alive ? Math.min(1, P.hurtFlash) : 0;
  fx.lowHp = alive && P.health < 30 ? 0.5 * (1 - P.health / 30) + 0.15 : game.state === 'dead' ? 0.6 : 0;
  fx.desat = game.state === 'dead' ? 0.7 : alive && P.health < 30 ? 0.35 * (1 - P.health / 30) : 0;
  fx.dash += ((alive && P.dashT > 0 ? 1 : 0) - fx.dash) * Math.min(1, dt * 14);
  fx.flash = Math.max(0, fx.flash - dt * 2.4);
  fx.weaponBoost = W.flashT > 0 || W.beamOn ? 2.4 : 0;
  fx.rays = G.sky.sunScreen(camera, sunUv) * 0.6;
  fx.sunScreen.copy(sunUv);
  G.level.lightAt(camera.position, fx.weaponTint);
  post.render(scene, camera, game.time);
}
G.player.reset(G.level.playerStart);
G.pickups.reset();
G.flow.reset();
G.hud.show(false);
frame();

// Для отладки из консоли браузера (например: __game.G.player.health = 999)
window.__game = { G, game, update, THREE, startGame, applyQuality };
