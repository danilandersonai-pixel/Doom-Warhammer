// Задания бейкера: какая модель, как перекрасить, что навесить, какие анимации и сколько кадров.
// Модели — CC0 (Quaternius), см. CREDITS.md. Цвета — sRGB.
const M = '/assets/models/';

// общие пропорции: голова меньше, конечности длиннее — уходим от «чиби» к взрослым пропорциям
const HUMAN_BONES = { Head: 0.62, UpperLegL: [1, 1.22, 1], UpperLegR: [1, 1.22, 1], LowerLegL: [1, 1.1, 1], LowerLegR: [1, 1.1, 1], UpperArmL: [1, 1.15, 1], UpperArmR: [1, 1.15, 1], Torso: [1.05, 1.12, 1.05] };

export const JOBS = {
  // 1. Фанатик: культист в багровом балахоне с капюшоном, тесак, горящие глаза
  fanatic: {
    model: M + 'chars/Ninja_Sand.gltf', height: 1.85, boneScale: HUMAN_BONES,
    colors: { Skin: '#1a1012', Main: '#8a1c1c', Details: '#2a1a14', Grey: '#5a2a1e', Face: '#1a1012' },
    attach: [
      { bone: 'FistR', part: 'cleaver', pos: [0, 0.02, 0.0], rot: [1.5, 0, 0] },
      { bone: 'Head', part: 'eyes', pos: [0, 0.24, 0.29], r: 0.042, spread: 0.08, green: true },
      { bone: 'Head', part: 'horns', pos: [0, 0.46, 0.0], len: 0.42, r: 0.065, color: 0xd8c8a0, out: -1.45, curl: 0.5, spread: 0.2 },
      { bone: 'Hips', part: 'skirt', pos: [0, 0.08, 0], h: 0.62, top: 0.24, bottom: 0.4, color: 0x5e1212 },
    ],
    cell: [112, 128], viewH: 2.15, camY: 1.0, elev: 8, colorsN: 22,
    anims: [
      { name: 'idle', clip: 'Idle', frames: 2, loop: true, fps: 3 },
      { name: 'walk', clip: 'Run', frames: 6, loop: true, fps: 12 },
      { name: 'attack', clip: 'SwordSlash', frames: 3, from: 0.25, to: 0.65, fps: 10 },
      { name: 'hit', clip: 'RecieveHit', frames: 1, from: 0.4, to: 0.4 },
      { name: 'death', clip: 'Death', frames: 5, fps: 9 },
    ],
  },
  // 2. Стрелок: латник в вороненой броне, противогаз с зелёными линзами, багровая накидка, тяжёлое ружьё
  gunner: {
    model: M + 'chars/Soldier_Male.gltf', height: 1.9, boneScale: HUMAN_BONES,
    colors: { Skin: '#141416', Main: '#5a564c', Black: '#1c1a1a', DarkGreen: '#7a1a14', Face: '#24221f', Helmet: '#4a463e' },
    attach: [
      { bone: 'FistR', part: 'rifle', pos: [0, 0.06, 0.02], rot: [-1.57, 0, 0] },
      { bone: 'Head', part: 'gasmask', pos: [0, 0.2, 0.33], scale: 1.7 },
      { bone: 'UpperArmL', part: 'pauldron', pos: [0, 0.02, 0], r: 0.2, color: 0x6a1a14 },
      { bone: 'UpperArmR', part: 'pauldron', pos: [0, 0.02, 0], r: 0.2, color: 0x6a1a14 },
      { bone: 'Hips', part: 'skirt', pos: [0, 0.06, 0], h: 0.4, top: 0.25, bottom: 0.34, color: 0x6a1612 },
    ],
    cell: [112, 128], viewH: 2.15, camY: 1.0, elev: 8, colorsN: 22,
    anims: [
      { name: 'idle', clip: 'Idle', frames: 2, loop: true, fps: 3 },
      { name: 'walk', clip: 'Walk', frames: 6, loop: true, fps: 9 },
      { name: 'attack', clip: 'Shoot_OneHanded', frames: 3, from: 0.1, to: 0.6, fps: 10 },
      { name: 'hit', clip: 'RecieveHit', frames: 1, from: 0.4, to: 0.4 },
      { name: 'death', clip: 'Death', frames: 5, fps: 9 },
    ],
  },
  // 3. Тяжёлый демон: багровая туша с черепом вместо головы, рога, шипы, булава с шипами
  heavy: {
    model: M + 'monsters/Orc_Skull.gltf', height: 2.75, boneScale: { Head: 0.85, UpperArmL: 1.1, UpperArmR: 1.1 },
    colors: { Atlas: { keepMap: true, color: '#ffffff', rough: 0.8, shifts: [
      { from: 55, to: 175, set: 352, sat: 1.1, light: 0.72 },   // зелёная кожа → багровая
      { from: 270, to: 350, set: 22, sat: 1.2, light: 1.1 },     // розовый гребень → огненный
    ] } },
    attach: [
      { bone: 'Head', part: 'horns', pos: [0, 0.6, 0.05], len: 0.6, r: 0.09, color: 0x2a1a14, out: -1.25, curl: 0.45, spread: 0.26, tilt: -0.4 },
      { bone: 'Head', part: 'eyes', pos: [0, 0.32, 0.44], r: 0.055, spread: 0.12 },
      { bone: 'Torso', part: 'spikes', pos: [0, 0.45, -0.55], n: 5, len: 0.5, r: 0.08, step: 0.16, tilt: -0.8 },
    ],
    cell: [160, 176], viewH: 3.1, camY: 1.45, elev: 8, colorsN: 24,
    anims: [
      { name: 'idle', clip: 'Idle', frames: 2, loop: true, fps: 3 },
      { name: 'walk', clip: 'Walk', frames: 6, loop: true, fps: 8 },
      { name: 'run', clip: 'Run', frames: 4, loop: true, fps: 12 },
      { name: 'attack', clip: 'Weapon', frames: 3, from: 0.2, to: 0.7, fps: 9 },
      { name: 'hit', clip: 'HitReact', frames: 1, from: 0.4, to: 0.4 },
      { name: 'death', clip: 'Death', frames: 5, fps: 9 },
    ],
  },
  // 4. Босс «Колосс»: боевая машина в багровой броне с латунью, пылающее ядро, шипы, знамя
  boss: {
    model: M + 'mech/Mike.gltf', height: 6.2,
    colors: { Main: '#5e1a16', Accent: '#c8963c', Grey: '#34363e', LightGrey: '#767a84', Black: '#141416', Eye: { color: '#ff4020', emissive: '#ff3010', glow: 2.5 } },
    attach: [
      { bone: 'Chest', part: 'core', pos: [0, 0.2, 0.75], r: 0.32 },
      { bone: 'ShoulderL', part: 'spikes', pos: [0, 1.05, 0], n: 3, len: 0.9, r: 0.13, step: 0.25, tilt: 0 },
      { bone: 'ShoulderR', part: 'spikes', pos: [0, 1.05, 0], n: 3, len: 0.9, r: 0.13, step: 0.25, tilt: 0 },
      { bone: 'LowerArmL', part: 'cannon', pos: [0, 0.2, 0], rot: [-1.57, 0, 0], scale: 1.5 },
    ],
    cell: [224, 256], viewH: 7.2, camY: 3.4, elev: 8, colorsN: 28,
    anims: [
      { name: 'idle', clip: 'Idle', frames: 2, loop: true, fps: 3 },
      { name: 'walk', clip: 'Walk', frames: 6, loop: true, fps: 7 },
      { name: 'attack', clip: 'Shoot', frames: 3, from: 0.1, to: 0.7, fps: 10 },
      { name: 'smash', clip: 'Punch', frames: 3, from: 0.2, to: 0.8, fps: 8 },
      { name: 'hit', clip: 'HitRecieve_1', frames: 1, from: 0.4, to: 0.4 },
      { name: 'death', clip: 'Death', frames: 5, fps: 6 },
    ],
  },
  // ---------- Оружие от первого лица (кадр 384×256 из виртуального экрана 560×256, справа) ----------
  w_rifle: {
    fp: 'rifle', cell: [384, 256], view: { full: [560, 256], x: 176, y: 0 }, fov: 55, colorsN: 32,
    light: { hemi: 0.9, keyI: 3.2, rimI: 1.6 },
    anims: [
      { name: 'idle', frames: 3, loop: true, fps: 3 },
      { name: 'fire', frames: 4, fps: 22 },
      { name: 'reload', frames: 8, fps: 8 },
      { name: 'raise', frames: 4, fps: 14 },
    ],
  },
  w_shotgun: {
    fp: 'shotgun', cell: [384, 256], view: { full: [560, 256], x: 176, y: 0 }, fov: 55, colorsN: 32, light: { hemi: 0.9, keyI: 3.2, rimI: 1.6 },
    anims: [{ name: 'idle', frames: 3, loop: true, fps: 3 }, { name: 'fire', frames: 4, fps: 14 }, { name: 'reload', frames: 8, fps: 9 }, { name: 'raise', frames: 4, fps: 14 }],
  },
  w_plasma: {
    fp: 'plasma', cell: [384, 256], view: { full: [560, 256], x: 176, y: 0 }, fov: 55, colorsN: 32, light: { hemi: 0.9, keyI: 3.0, rimI: 1.6 },
    anims: [{ name: 'idle', frames: 3, loop: true, fps: 4 }, { name: 'fire', frames: 4, fps: 16 }, { name: 'reload', frames: 8, fps: 8 }, { name: 'raise', frames: 4, fps: 14 }],
  },
  w_thermal: {
    fp: 'thermal', cell: [384, 256], view: { full: [560, 256], x: 176, y: 0 }, fov: 55, colorsN: 32, light: { hemi: 0.9, keyI: 3.0, rimI: 1.6 },
    anims: [{ name: 'idle', frames: 3, loop: true, fps: 4 }, { name: 'fire', frames: 4, fps: 18 }, { name: 'reload', frames: 8, fps: 8 }, { name: 'raise', frames: 4, fps: 14 }],
  },
  w_chainblade: {
    fp: 'chainblade', cell: [384, 256], view: { full: [560, 256], x: 120, y: 0 }, fov: 55, colorsN: 32, light: { hemi: 0.9, keyI: 3.2, rimI: 1.8 },
    anims: [{ name: 'idle', frames: 3, loop: true, fps: 14 }, { name: 'swing', frames: 6, fps: 20 }, { name: 'raise', frames: 4, fps: 14 }],
  },
  w_throw: {
    fp: 'throw', cell: [384, 256], view: { full: [560, 256], x: 0, y: 0 }, fov: 55, colorsN: 24, light: { hemi: 0.9, keyI: 3.2, rimI: 1.6 },
    anims: [{ name: 'throw', frames: 5, fps: 14 }],
  },
};
