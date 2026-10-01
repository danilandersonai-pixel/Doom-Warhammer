// Точка входа: рендер, игровой цикл, стрельба, состояния игры (меню / бой / пауза / победа / поражение).
import * as THREE from 'three';
import { buildArena } from './arena.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { Enemies } from './enemies.js';
import { Waves } from './waves.js';
import { Hud } from './hud.js';
import { Particles, Tracers } from './effects.js';
import { initAudio, sfx } from './audio.js';

const BOLT_DAMAGE = 22;
const MELEE_DAMAGE = 70;
const MELEE_RANGE = 2.4;

// Телефон или планшет — показываем сенсорное управление
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- Рендер ----------
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.autoClear = false; // рисуем две сцены: мир и оружие поверх
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 150);
camera.rotation.order = 'YXZ';

// Вспышка выстрела освещает мир вокруг игрока (один точечный свет, обычно выключен)
const muzzleLight = new THREE.PointLight(0xffa050, 0, 14, 2);
scene.add(muzzleLight);

const arena = buildArena(scene);
const blood = new Particles(scene, 500, { size: 0.13 });
const sparks = new Particles(scene, 400, { size: 0.1, additive: true });
const tracers = new Tracers(scene);
const hud = new Hud();
const input = new Input(isTouch);
const player = new Player();

const game = { state: 'menu', time: 0, elapsed: 0, kills: 0, endT: -1, wasLocked: false };

const enemies = new Enemies(scene, arena.colliders, arena.solidMeshes, blood, sparks, {
  onKill(e) {
    game.kills++;
    if (e.type === 'boss') {
      player.addTrauma(0.8);
      game.endT = 1.8; // небольшая пауза перед экраном победы
    }
  },
  onPlayerHit(amount) {
    player.damage(amount);
    sfx.hurt();
  },
});

const waves = new Waves(enemies, arena.spawnPoints, player, hud);

const weapon = new Weapon({
  onFire: shoot,
  onMelee: melee,
  onReloadStart: () => sfx.reload(),
  onEmpty: () => sfx.empty(),
});

// ---------- Стрельба ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const muzzleWorld = new THREE.Vector3();
const tmp = new THREE.Vector3();
let muzzleT = 0;
let fpsN = 0;

function shoot() {
  sfx.shoot();
  player.addTrauma(0.14);
  player.kick += 0.035;
  muzzleT = 0.05;

  // небольшой разброс
  ndc.set((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
  ray.setFromCamera(ndc, camera);
  ray.far = 100;
  const hits = ray.intersectObjects(arena.solidMeshes.concat(enemies.hitboxes()), false);
  muzzleWorld.set(0.22, -0.2, -0.8);
  camera.localToWorld(muzzleWorld);

  if (!hits.length) {
    tracers.fire(muzzleWorld, tmp.copy(ray.ray.direction).multiplyScalar(60).add(ray.ray.origin));
    return;
  }
  const h = hits[0];
  tracers.fire(muzzleWorld, h.point);
  const enemy = h.object.userData.enemy;
  // болт взрывается при попадании: искры
  if (enemy) {
    const killed = enemies.damage(enemy, BOLT_DAMAGE, h.point);
    hud.hitmarker(killed);
    sparks.burst(h.point, 12, 0xffa040, { speed: 5, life: 0.25, gravity: 2 });
    sfx.flesh();
  } else {
    const n = h.face ? tmp.copy(h.face.normal).transformDirection(h.object.matrixWorld) : null;
    sparks.burst(h.point, 14, 0xffb050, { speed: 6, life: 0.3, gravity: 6, dir: n, spread: 0.8 });
    blood.burst(h.point, 8, 0x8a8078, { speed: 2.5, life: 0.7, gravity: 6, dir: n, spread: 0.8 }); // пыль
    const d = h.distance;
    sfx.impact(Math.max(0.15, 1 - d / 40));
  }
}

// ---------- Ближний бой ----------
function melee() {
  sfx.melee();
  player.addTrauma(0.12);
  const f = player.forward();
  let hit = false, killed = false;
  for (const e of enemies.list) {
    if (e.dead || e.spawnT < 0.3) continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    if (d - e.radius > MELEE_RANGE) continue;
    if ((dx * f.x + dz * f.z) / d < 0.45) continue; // только то, что перед нами
    const point = tmp.set(e.pos.x, 1.2 * e.t.scale, e.pos.z);
    killed = enemies.damage(e, MELEE_DAMAGE, point) || killed;
    enemies.knockback(e, dx / d, dz / d, e.type === 'boss' ? 3 : 12);
    hit = true;
  }
  if (hit) {
    sfx.meleeHit();
    player.addTrauma(0.3);
    hud.hitmarker(killed);
  }
}

// ---------- Экраны и состояния ----------
const screen = document.getElementById('screen');
const screenTitle = document.getElementById('screenTitle');
const screenText = document.getElementById('screenText');
const screenBtn = document.getElementById('screenBtn');
document.getElementById('controlsHelp').innerHTML = isTouch
  ? 'Левая половина экрана — движение · правая — поворот камеры<br>ОГОНЬ — стрельба (можно вести пальцем) · УДАР — ближний бой · R — перезарядка'
  : 'WASD — движение · мышь — обзор · ЛКМ — огонь<br>ПКМ или F — ближний бой · R — перезарядка · Esc — пауза';
screenText.textContent = 'Отбейте три волны врагов и одолейте их чемпиона.';

function showScreen(title, text, btn) {
  screenTitle.textContent = title;
  screenText.innerHTML = text;
  screenBtn.textContent = btn;
  screen.classList.remove('hidden');
}

function lockPointer() {
  if (isTouch) return;
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {}); // браузер может отказать — не страшно
}

function startGame() {
  initAudio();
  enemies.clear();
  blood.clear();
  sparks.clear();
  tracers.clear();
  player.reset();
  weapon.reset();
  waves.reset();
  input.reset();
  hud.hideBanner();
  game.kills = 0;
  game.elapsed = 0;
  game.endT = -1;
  resume();
}

function resume() {
  initAudio();
  game.state = 'playing';
  screen.classList.add('hidden');
  hud.show(true);
  document.getElementById('touch').classList.toggle('hidden', !isTouch);
  input.reset();
  lockPointer();
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  input.reset();
  showScreen('ПАУЗА', 'Бой ждёт.', 'ПРОДОЛЖИТЬ');
}

function endGame(won) {
  game.state = won ? 'won' : 'lost';
  hud.hideBanner();
  input.reset();
  document.getElementById('touch').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const m = Math.floor(game.elapsed / 60), s = Math.floor(game.elapsed % 60).toString().padStart(2, '0');
  const stats = `Время: ${m}:${s} · Убито врагов: ${game.kills}`;
  if (won) {
    sfx.victory();
    showScreen('ПОБЕДА', `Чемпион повержен. Арена очищена.<br>${stats}`, 'ЗАНОВО');
  } else {
    sfx.defeat();
    showScreen('ПОРАЖЕНИЕ', `Вы пали в бою.<br>${stats}`, 'ЗАНОВО');
  }
}

screenBtn.addEventListener('click', () => {
  if (game.state === 'paused') resume();
  else startGame();
});

// Десктоп: если курсор освободили (Esc) во время боя — пауза
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) game.wasLocked = true;
  else if (game.wasLocked && game.state === 'playing') pause();
});
renderer.domElement.addEventListener('click', () => {
  if (game.state === 'playing' && !document.pointerLockElement) lockPointer();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Размер окна ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // на узком (портретном) экране чуть шире обзор
  camera.fov = w < h ? 90 : 75;
  camera.updateProjectionMatrix();
  weapon.resize(w / h);
}
window.addEventListener('resize', resize);
resize();

// ---------- Игровой цикл ----------
const clock = new THREE.Clock();

function update(dt) {
  game.elapsed += dt;
  const look = input.consumeLook();
  player.look(look.x, look.y);
  player.update(dt, input.getMove(), arena.colliders);
  weapon.update(dt, input, player, game.time);
  enemies.update(dt, player);
  waves.update(dt);
  hud.update(player, weapon, waves, enemies.boss);

  if (player.dead) endGame(false);
  if (game.endT > 0) {
    game.endT -= dt;
    if (game.endT <= 0) endGame(true);
  }
}

function frame() {
  requestAnimationFrame(frame);
  fpsN++;
  const dt = Math.min(clock.getDelta(), 0.05); // не даём шагу стать огромным после паузы
  game.time += dt;

  if (game.state === 'playing') update(dt);
  else if (game.state === 'won' || game.state === 'lost') enemies.update(dt, player); // доигрываем анимации смерти

  blood.update(dt);
  sparks.update(dt);
  tracers.update(dt);
  muzzleT -= dt;
  muzzleLight.intensity = muzzleT > 0 ? 60 : 0;
  muzzleLight.position.set(player.pos.x, 1.5, player.pos.z);
  player.applyCamera(camera, game.time);

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(weapon.scene, weapon.camera);
}
player.applyCamera(camera, 0);
frame();

// Для отладки из консоли браузера
window.__cam = camera;
window.__game = { game, player, enemies, waves, weapon, input, update };
let fpsT = performance.now();
setInterval(() => { const n = performance.now(); window.__game.fps = Math.round(fpsN * 1000 / (n - fpsT)); fpsN = 0; fpsT = n; }, 1000);
