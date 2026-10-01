// Бейкер спрайтов: 3D-модель (glTF) → кадры анимаций с 8 направлений → пикселизация → атлас PNG + JSON.
// Работает в headless-браузере (Playwright), запускается из tools/bake_sprites.mjs.
// Шаги: свет сверху-слева + холодный контровой, ортокамера; рендер с запасом SS×,
// усреднение блоков (пиксели без сглаживания краёв), общая палитра (k-means), тёмный контур 1 px.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PARTS } from './parts.js';
import { FP } from './fp.js';

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const loader = new GLTFLoader();
const gltfCache = {};
function loadGltf(url) {
  if (!gltfCache[url]) gltfCache[url] = new Promise((res, rej) => loader.load(url, res, undefined, rej));
  return gltfCache[url];
}

// ---------- Материалы: перекраска под свой дизайн ----------
function makeMat(spec, orig) {
  if (typeof spec === 'string') spec = { color: spec };
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color || (orig && orig.color) || '#888'),
    roughness: spec.rough ?? 0.75, metalness: spec.metal ?? 0.1,
    emissive: new THREE.Color(spec.emissive || '#000'), emissiveIntensity: spec.glow ?? 1,
    map: spec.keepMap && orig ? (spec.hue !== undefined || spec.shifts ? shiftTex(orig.map, spec) : orig.map) : null,
    flatShading: !!spec.flat,
  });
  return m;
}

// Перекраска текстуры: сдвиг оттенка в диапазонах (shifts: [{from, to, hue, sat, light}]) — свои цвета существ
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function shiftTex(tex, spec) {
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  const shifts = spec.shifts || [{ from: 0, to: 360, hue: spec.hue, sat: spec.sat ?? 1, light: spec.light ?? 1 }];
  for (let i = 0; i < a.length; i += 4) {
    let [h, s, l] = rgb2hsl(a[i], a[i + 1], a[i + 2]);
    for (const S of shifts) {
      if (s < (S.minSat ?? 0.12) && S.from !== 0) continue;
      const inR = S.from <= S.to ? h >= S.from && h < S.to : h >= S.from || h < S.to;
      if (!inR) continue;
      h = S.set !== undefined ? S.set : h + (S.hue || 0); s = Math.min(1, s * (S.sat ?? 1)); l = Math.min(1, l * (S.light ?? 1));
      break;
    }
    const [r, gg, b] = hsl2rgb(h, s, l);
    a[i] = r; a[i + 1] = gg; a[i + 2] = b;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}

function recolor(root, colors = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const conv = (mat) => {
      const spec = colors[mat.name] ?? colors['*'];
      if (spec === undefined) { const m = makeMat({ color: '#' + mat.color.getHexString(), keepMap: true }, mat); m.name = mat.name; return m; }
      if (spec === null) { const m = new THREE.MeshBasicMaterial({ visible: false }); m.name = mat.name; return m; }
      const m = makeMat(spec, mat); m.name = mat.name; return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

// ---------- Сцена для одной модели ----------
async function buildModel(job) {
  const root = new THREE.Group();
  let mixer = null, clips = [];
  if (job.model) {
    const g = await loadGltf(job.model);
    const m = SkeletonUtils.clone(g.scene);
    recolor(m, job.colors);
    m.scale.setScalar(job.scale || 1);
    if (job.offset) m.position.set(...job.offset);
    root.add(m);
    mixer = new THREE.AnimationMixer(m);
    clips = g.animations;
    // подгонка роста: позируем покой, меряем скиннингованные меши, масштабируем, ставим ноги на y=0
    if (job.height) {
      const fc = clips.find((c) => c.name === (job.fitClip || 'Idle')) || clips[0];
      if (fc) { const a = mixer.clipAction(fc); a.play(); mixer.update(0); }
      applyBones(m, job);
      const box = measure(m);
      const k = job.height / (box.max.y - box.min.y);
      m.scale.multiplyScalar(k);
      const b2 = measure(m);
      m.position.y -= b2.min.y;
      m.position.x -= (b2.min.x + b2.max.x) / 2;
      m.position.z -= (b2.min.z + b2.max.z) / 2;
      mixer.stopAllAction();
    }
    // навесные детали из примитивов на кости
    for (const a of job.attach || []) {
      const bone = a.bone ? m.getObjectByName(a.bone) : m;
      if (!bone) { console.warn('no bone', a.bone); continue; }
      const part = PARTS[a.part](a);
      // компенсируем масштаб модели, чтобы размеры и смещения деталей были в метрах
      const ws = new THREE.Vector3(); bone.updateWorldMatrix(true, false); bone.getWorldScale(ws);
      if (a.pos) part.position.set(...a.pos).multiplyScalar(1 / ws.x);
      if (a.rot) part.rotation.set(...a.rot);
      if (a.scale) part.scale.setScalar(a.scale);
      if (!a.keepScale) part.scale.multiplyScalar(1 / ws.x);
      part.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      bone.add(part);
      if (window.DEBUG) { part.updateWorldMatrix(true, true); const wp = new THREE.Vector3(), sc = new THREE.Vector3(); part.getWorldPosition(wp); part.getWorldScale(sc); console.log('part', a.part, a.bone, 'ws', ws.x.toFixed(4), 'world', wp.toArray().map((v) => v.toFixed(2)).join(','), 'scale', sc.x.toFixed(3)); }
    }
  }
  if (job.build) root.add(PARTS[job.build](job));
  return { root, mixer, clips, model: root.children[0] };
}

// Пропорции: масштаб костей (меньше голова, длиннее ноги) — после каждого шага анимации
function applyBones(m, job) {
  if (!m || !job.boneScale) return;
  for (const [name, k] of Object.entries(job.boneScale)) {
    const b = m.getObjectByName(name);
    if (!b) continue;
    if (Array.isArray(k)) b.scale.set(k[0], k[1], k[2]); else b.scale.setScalar(k);
  }
}

function measure(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || (o.material && o.material.visible === false)) return;
    if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); const b = o.boundingBox.clone().applyMatrix4(o.matrixWorld); box.union(b); }
    else { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
  });
  return box;
}

function lights(scene, L = {}) {
  scene.add(new THREE.HemisphereLight(L.sky || 0xcfd6e6, L.ground || 0x4a3a30, L.hemi ?? 0.75));
  const key = new THREE.DirectionalLight(L.key || 0xfff0dc, L.keyI ?? 3.4);
  key.position.set(-4, 7, 5);      // сверху-слева-спереди
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera; sc.left = sc.bottom = -6; sc.right = sc.top = 6; sc.near = 0.1; sc.far = 30;
  key.shadow.bias = -0.0015; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(L.rim || 0x9ec4ff, L.rimI ?? 2.4);   // холодный контровой
  rim.position.set(5, 3, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffc89a, L.fillI ?? 0.35);
  fill.position.set(4, 1, 4);
  scene.add(fill);
}

// ---------- Пикселизация ----------
// hi: ImageData размером (w*SS)×(h*SS) → массив RGBA w×h (без сглаживания краёв)
function downsample(hi, w, h, SS, cover = 0.45) {
  const out = new Uint8ClampedArray(w * h * 4), W = w * SS;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const k = ((y * SS + j) * W + (x * SS + i)) * 4;
      if (hi[k + 3] > 100) { r += hi[k]; g += hi[k + 1]; b += hi[k + 2]; n++; }
    }
    const o = (y * w + x) * 4;
    if (n / (SS * SS) >= cover) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255; }
  }
  return out;
}

// k-means по цветам всех кадров → палитра из k цветов
function buildPalette(frames, k, fixed = []) {
  const samples = [];
  for (const f of frames) for (let i = 0; i < f.length; i += 4) if (f[i + 3] && Math.random() < 0.35) samples.push([f[i], f[i + 1], f[i + 2]]);
  if (!samples.length) return fixed.slice();
  // старт: равномерно по яркости
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let C = [];
  for (let i = 0; i < k; i++) C.push(samples[Math.floor(((i + 0.5) / k) * samples.length)].slice());
  for (let it = 0; it < 14; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let bi = 0, bd = 1e9;
      for (let c = 0; c < C.length; c++) { const d = dist(s, C[c]); if (d < bd) { bd = d; bi = c; } }
      const a = acc[bi]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++;
    }
    C = C.map((c, i) => (acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c));
  }
  return C.map((c) => c.map(Math.round)).concat(fixed);
}
// взвешенное расстояние (глаз чувствительнее к зелёному)
const dist = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;

function quantize(f, P) {
  for (let i = 0; i < f.length; i += 4) {
    if (!f[i + 3]) continue;
    const s = [f[i], f[i + 1], f[i + 2]];
    let bi = 0, bd = 1e9;
    for (let c = 0; c < P.length; c++) { const d = dist(s, P[c]); if (d < bd) { bd = d; bi = c; } }
    f[i] = P[bi][0]; f[i + 1] = P[bi][1]; f[i + 2] = P[bi][2];
  }
}

// Контур 1 px: прозрачный пиксель рядом с непрозрачным → тёмный оттенок соседа
function outline(f, w, h, k = 0.28, tint = [18, 12, 16]) {
  const src = new Uint8ClampedArray(f);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (src[o + 3]) continue;
    let nb = -1;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = (yy * w + xx) * 4;
      if (src[q + 3]) { nb = q; break; }
    }
    if (nb < 0) continue;
    f[o] = tint[0] + src[nb] * k; f[o + 1] = tint[1] + src[nb + 1] * k; f[o + 2] = tint[2] + src[nb + 2] * k; f[o + 3] = 255;
  }
}

// ---------- Основная функция бейка ----------
// job: { name, model, scale, colors, attach, cell:[w,h], viewH, camY, elev, SS, colorsN, anims:[{name, clip, frames, dirs, loop, from, to, fps}] }
window.bakeJob = async function (job) {
  const [cw, ch] = job.cell, SS = job.SS || 4;
  const scene = new THREE.Scene();
  lights(scene, job.light);
  let root, mixer = null, clips = [], model = null, fp = null, cam, target = new THREE.Vector3(), elev = 0, viewH = 1;
  if (job.fp) {
    // оружие от первого лица: модель рук и оружия перед перспективной камерой игрока
    fp = FP[job.fp](job);
    root = fp.root;
    cam = new THREE.PerspectiveCamera(job.fov || 50, cw / ch, 0.01, 50);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    // кадр — часть виртуального экрана (оружие справа-снизу), перспектива как у полного экрана
    if (job.view) { const [fw, fh] = job.view.full; cam.aspect = fw / fh; cam.setViewOffset(fw, fh, job.view.x, job.view.y, cw, ch); cam.updateProjectionMatrix(); }
  } else {
    ({ root, mixer, clips, model } = await buildModel(job));
    viewH = job.viewH;
    const viewW = viewH * cw / ch;
    cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 100);
    elev = THREE.MathUtils.degToRad(job.elev ?? 8);
    target.set(0, job.camY ?? viewH / 2, 0);
    cam.position.set(0, target.y + Math.sin(elev) * 20, Math.cos(elev) * 20);
    cam.lookAt(target);
  }
  scene.add(root);
  renderer.setSize(cw * SS, ch * SS);
  const ctx2 = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctx2.canvas.width = cw * SS; ctx2.canvas.height = ch * SS;

  // кадры кладутся подряд: ячейка = start + кадр*dirs + направление
  const frames = [], layout = {};
  let rows = 0;
  for (const A of job.anims) {
    const clip = A.clip ? clips.find((c) => c.name === A.clip) : null;
    if (A.clip && !clip) throw new Error(`${job.name}: нет анимации ${A.clip}; есть: ${clips.map((c) => c.name).join(', ')}`);
    const dirs = fp ? 1 : (A.dirs ?? 8);
    layout[A.name] = { start: frames.length, frames: A.frames, dirs, fps: A.fps || 10, loop: !!A.loop };
    for (let i = 0; i < A.frames; i++) {
      const u = A.loop ? i / A.frames : i / Math.max(1, A.frames - 1);
      if (clip) {
        mixer.stopAllAction();
        const act = mixer.clipAction(clip);
        act.reset(); act.play();
        const from = (A.from ?? 0) * clip.duration, to = (A.to ?? 1) * clip.duration;
        act.time = Math.min(from + (to - from) * u, clip.duration - 1e-4);
        mixer.update(0);
      }
      applyBones(model, job);
      if (fp) fp.pose(A.pose || A.name, (A.from ?? 0) + ((A.to ?? 1) - (A.from ?? 0)) * u, i);
      for (let d = 0; d < dirs; d++) {
        if (!fp) root.rotation.y = (d * Math.PI) / 4;
        root.updateMatrixWorld(true);
        renderer.render(scene, cam);
        ctx2.clearRect(0, 0, cw * SS, ch * SS);
        ctx2.drawImage(renderer.domElement, 0, 0);
        const hi = ctx2.getImageData(0, 0, cw * SS, ch * SS).data;
        frames.push({ px: job.raw ? null : downsample(hi, cw, ch, SS, job.cover), hi: job.raw ? ctx2.canvas.toDataURL() : null });
      }
    }
    rows += A.frames;
  }
  if (!fp) root.rotation.y = 0;

  if (job.raw) return { frames: frames.map((f) => f.hi) };

  // палитра на весь лист + контур
  const pal = buildPalette(frames.map((f) => f.px), job.colorsN || 24, job.fixedColors || []);
  for (const f of frames) { quantize(f.px, pal); if (job.outline !== false) outline(f.px, cw, ch); }

  // атлас-сетка не шире и не выше 4096 px (лимит текстур на телефонах)
  const total = frames.length, C = Math.min(total, Math.floor((job.maxW || 4096) / cw)), R = Math.ceil(total / C);
  if (R * ch > 4096) console.warn(job.name + ': атлас выше 4096 px');
  const atlas = document.createElement('canvas');
  atlas.width = cw * C; atlas.height = ch * R;
  const g = atlas.getContext('2d');
  frames.forEach((f, i) => g.putImageData(new ImageData(f.px, cw, ch), (i % C) * cw, Math.floor(i / C) * ch));
  // где на кадре стоят ноги (по низу ортокамеры): мировая y=0 → пиксель от верха
  const footPx = fp ? ch : Math.round(ch / 2 + (target.y / viewH) * ch * Math.cos(elev));
  const extra = fp && fp.meta ? fp.meta(cam, cw, ch) : {};
  return {
    png: atlas.toDataURL('image/png'),
    meta: { name: job.name, cell: [cw, ch], frames: total, cols: C, gridRows: R, anims: layout, pxWorld: fp ? 0 : viewH / ch, footPx, palette: pal.length, ...extra },
  };
};

window.bakeReady = true;

// Отладка: габариты и кости модели
window.inspect = async function (url) {
  const g = await loadGltf(url);
  const box = new THREE.Box3().setFromObject(g.scene);
  const bones = [];
  g.scene.traverse((o) => { if (o.isBone) bones.push(o.name); });
  return { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)), bones, anims: g.animations.map((a) => a.name + ':' + a.duration.toFixed(2)) };
};

window.debugBones = async function (url) {
  const g = await loadGltf(url);
  const m = SkeletonUtils.clone(g.scene);
  const out = [];
  m.traverse((o) => { if (o.name === 'Head' || o.isSkinnedMesh) out.push(o.type + ':' + o.name + (o.isSkinnedMesh ? ' bones=' + o.skeleton.bones.length + ' hasHead=' + o.skeleton.bones.some((b) => b.name === 'Head') + ' same=' + (o.skeleton.bones.find((b) => b.name === 'Head') === m.getObjectByName('Head')) : '')); });
  return out;
};
