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

// Шрифты грузим из скрипта, чтобы они не задерживали старт (нет сети — останутся системные)
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Yanone+Kaffeesatz:wght@400;700&display=swap';
document.head.appendChild(fontLink);

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---------- Настройки (сохраняются в браузере, если можно) ----------
const settings = { sens: 1, btnSize: 1, btnAlpha: 0.55, music: true, gyro: false, volume: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('ironCrusadeSettings') || '{}')); } catch { /* без сохранения */ }
function saveSettings() { try { localStorage.setItem('ironCrusadeSettings', JSON.stringify(settings)); } catch { /* нет хранилища */ } }
function applySettings() {
  document.documentElement.style.setProperty('--btn-scale', settings.btnSize);
  document.documentElement.style.setProperty('--btn-alpha', settings.btnAlpha);
  audioSettings(settings);
}
applySettings();

// ---------- Рендер: близко к родному разрешению (окружение гладкое, пиксели — в текстурах) ----------
const RENDER_SCALE = isTouch ? 0.75 : 1;
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * RENDER_SCALE);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 900);
camera.rotation.order = 'YXZ';
const overlay = document.getElementById('overlay');

// ---------- Общий контекст игры ----------
const G = { scene, camera, isTouch, settings };
// запечённые атласы врагов (3D → 8 ракурсов → пиксели) — до постройки уровня и врагов
await loadTextureImages(['floor', 'metal', 'rust', 'rock', 'cobble']);
await loadSprites(['fanatic', 'gunner', 'heavy', 'boss', 'w_rifle', 'w_shotgun', 'w_plasma', 'w_thermal', 'w_chainblade', 'w_throw']);
G.world = new World();
G.level = buildLevel(scene, G.world);
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
    G.fx.sparks.burst(hit.point, 6, 0xffc060, { speed: 4, life: 0.3, size: 0.06 });
  } else if (!quiet) {
    G.fx.sparks.burst(hit.point, 9, 0xffc060, { speed: 6, life: 0.3, gravity: 8, dir: hit.normal, spread: 0.7, size: 0.06 });
    G.fx.dust.burst(hit.point, 6, 0xd8dee8, { speed: 2, life: 0.8, gravity: 3, dir: hit.normal, spread: 0.7, size: 0.18, alpha: 0.8 }); // снежная/каменная пыль
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
  G.hud.hurt();
  sfx.hurt();
};

G.onEnemyKilled = (e) => {
  game.stats.kills++;
  if (e.type !== 'boss') G.pickups.drop(e);
};
G.onBossPhase = (phase) => G.flow.onBossPhase(phase);
G.onBossDead = () => G.flow.onBossDead();
G.onComplete = () => endGame(true);

// ---------- Экраны ----------
const screen = document.getElementById('screen');
const $ = (id) => document.getElementById(id);
$('controlsHelp').innerHTML = isTouch
  ? 'Слева — стик движения, справа — свайп для обзора. Кнопки: огонь (можно вести пальцем), прыжок, рывок, удар клинком, граната, перезарядка/смена оружия.'
  : 'WASD — бег · мышь — обзор · ЛКМ — огонь · Пробел — прыжок · Shift — рывок<br>F или ПКМ — цепной клинок · G — граната · R — перезарядка · 1–5 или колесо — оружие · Esc — пауза';
$('screenText').textContent = 'Орден Железного Похода высадился у осквернённой площади. Очисти её от еретиков и сокруши их Колосса.';

function showScreen(title, sub, html, btn, restart = false) {
  $('screenTitle').textContent = title;
  $('screenSub').textContent = sub;
  $('screenText').innerHTML = html;
  $('screenBtn').textContent = btn;
  $('restartBtn').classList.toggle('hidden', !restart);
  screen.classList.remove('hidden');
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
  if (document.pointerLockElement) document.exitPointerLock();
  showScreen('ПАУЗА', 'бой ждёт', '', 'ПРОДОЛЖИТЬ', true);
}

function fmtTime(t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }

function endGame(won) {
  game.state = won ? 'won' : 'dead';
  G.input.reset();
  sfx.beam(false);
  $('touch').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const stats = `<div class="stats"><span>Время</span><b>${fmtTime(game.elapsed)}</b><span>Убито врагов</span><b>${game.stats.kills}</b><span>Секреты</span><b>${G.flow.secretFound ? 1 : 0} / 1</b></div>`;
  if (won) {
    sfx.victory();
    music.setIntensity(0);
    showScreen('ПЛОЩАДЬ ОЧИЩЕНА', 'уровень пройден', stats, 'ЕЩЁ РАЗ');
  } else {
    sfx.defeat();
    showScreen('ВЫ ПАЛИ', 'орден помнит', stats, 'ЗАНОВО');
  }
}

$('screenBtn').addEventListener('click', () => { if (game.state === 'paused') resume(); else startGame(); });
$('restartBtn').addEventListener('click', () => startGame());
$('menuBtn').addEventListener('click', () => pause());
$('menuBtn').addEventListener('touchend', (e) => { e.preventDefault(); pause(); });
document.getElementById('weaponIcon').addEventListener('touchend', (e) => { e.preventDefault(); G.weapons.cycle(1); });

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

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) game.wasLocked = true;
  else if (game.wasLocked && game.state === 'playing') pause();
});
renderer.domElement.addEventListener('click', () => { if (game.state === 'playing' && !document.pointerLockElement) lockPointer(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Размер окна ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.userData.baseFov = w < h ? 92 : 76;
  camera.updateProjectionMatrix();
  // пиксельный слой: ~280 "пикселей" по высоте → оружие занимает ~45% кадра, пиксели крупные и чёткие
  overlay.height = 256;
  overlay.width = Math.round((256 * w) / h);
  G.fx.setScale(h * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

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

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.time += dt;
  if (game.state === 'playing') update(dt);
  else if (game.state === 'won' || game.state === 'dead') G.enemies.update(dt, game.time);
  G.level.update(dt, game.time);
  G.fx.update(dt, G.world, camera.position, game.time);
  G.player.applyCamera(camera, game.time);
  const fov = (camera.userData.baseFov || 76) * (camera.userData.fovK || 1);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
  if (game.state === 'playing' || game.state === 'paused') G.weapons.draw(dt, game.time);
  else G.weapons.ctx.clearRect(0, 0, overlay.width, overlay.height);
}
G.player.reset(G.level.playerStart);
G.pickups.reset();
G.flow.reset();
G.hud.show(false);
frame();

// Для отладки из консоли браузера (например: __game.G.player.health = 999)
window.__game = { G, game, update, THREE, startGame };
