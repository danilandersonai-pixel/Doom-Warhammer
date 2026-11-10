// Небо и атмосфера: грозовое небо с затмением (шейдер), слои далёкого города-собора в дымке,
// прожекторы и вспышки зенитного огня на горизонте, столбы дыма, молнии, пепел и угольки в воздухе.
// Здесь же — свет сцены (небесный + направленный от короны затмения с тенями) и «умный» туман:
// стелется у земли и теплеет в сторону светила.
import * as THREE from 'three';
import { rng } from './pixel.js';

// Направление на светило: с северо-востока, невысоко над стенами — длинные косые тени через арену
const AZ = 0.56, EL = 0.50;
export const SUN_DIR = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), -Math.cos(AZ) * Math.cos(EL)).normalize();
export const FOG_COLOR = 0x4d5a78;
const FOG_DENSITY = 0.0105;

// ---------- Туман: общий для всех материалов (подменяем кусок шейдера three.js) ----------
// К обычному туману по дальности добавлен слой дымки у земли (плотность падает с высотой, интеграл по лучу
// считается точно) и тёплое рассеяние в сторону светила. Аддитивные материалы в тумане гаснут, а не «сереют».
const f3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  vec3 fogV = vFogWorld - cameraPosition;
  float fogD = length( fogV );
  #ifdef FOG_EXP2
    float fogTau = fogDensity * fogDensity * fogD * fogD;
  #else
    float fogTau = 3.0 * smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogY0 = max( cameraPosition.y, -1.5 ), fogY1 = max( vFogWorld.y, -1.5 );
  float fogDy = fogY1 - fogY0;
  float fogE0 = exp( -0.5 * fogY0 ), fogE1 = exp( -0.5 * fogY1 );
  float fogMist = abs( fogDy ) > 0.02 ? ( fogE0 - fogE1 ) / ( 0.5 * fogDy ) : fogE0;
  fogTau += 0.02 * fogD * fogMist;
  float fogFactor = 1.0 - exp( -fogTau );
  #ifdef FOG_ADDITIVE
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #else
    float fogSun = pow( max( dot( fogV / max( fogD, 1e-4 ), ${f3(SUN_DIR)} ), 0.0 ), 5.0 );
    vec3 fogTint = mix( fogColor, fogColor * vec3( 1.9, 1.4, 1.0 ) + vec3( 0.1, 0.04, 0.0 ), fogSun * 0.7 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
  #endif
#endif`;

// ---------- Тайловый шум для облаков (R и G — два независимых слоя) ----------
let noiseCache = null;
export function noiseTex() { return noiseCache || (noiseCache = noiseTexture()); }
function noiseTexture(size = 256) {
  const R = rng(77);
  const layer = (octaves) => {
    const out = new Float32Array(size * size);
    let amp = 0.5, total = 0;
    for (let o = 0; o < octaves; o++) {
      const P = 4 << o, lat = new Float32Array(P * P);
      for (let i = 0; i < lat.length; i++) lat[i] = R();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = (x / size) * P, fy = (y / size) * P, xi = Math.floor(fx), yi = Math.floor(fy);
        const tx = fx - xi, ty = fy - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = lat[(yi % P) * P + (xi % P)], b = lat[(yi % P) * P + ((xi + 1) % P)];
        const c = lat[((yi + 1) % P) * P + (xi % P)], d = lat[((yi + 1) % P) * P + ((xi + 1) % P)];
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
      total += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  };
  const A = layer(6), B = layer(5), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255; data[i * 4 + 2] = R() * 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
precision highp float;
uniform sampler2D tNoise; uniform vec3 uSunDir; uniform float uTime; uniform float uFlash; uniform vec3 uFlashDir;
uniform vec3 uHorizon; uniform vec3 uMid; uniform vec3 uZenith;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = dot(d, uSunDir), sdp = max(sd, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.2, h));
  col = mix(col, uZenith, smoothstep(0.12, 0.8, h));
  // тёплое зарево вокруг светила
  col += vec3(1.0, 0.46, 0.2) * (pow(sdp, 4.0) * 0.2 + pow(sdp, 30.0) * 0.3);

  // затмение: чёрный диск, пылающая корона со «стримерами», яркое кольцо
  float ang = acos(clamp(sd, -1.0, 1.0));
  const float R = 0.078;
  vec3 sx = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir)), sy = cross(uSunDir, sx);
  float pa = atan(dot(d, sy), dot(d, sx)) / 6.2831853;
  float st = texture2D(tNoise, vec2(pa * 3.0, uTime * 0.006)).g;
  float st2 = texture2D(tNoise, vec2(pa * 8.0 + 0.3, 0.37 - uTime * 0.011)).r;
  float edge = max(ang - R, 0.0);
  float corona = exp(-edge * (13.0 + st * 44.0)) * (0.5 + st2 * 1.0);
  float ring = exp(-pow((ang - R) / 0.0055, 2.0));
  float bead = exp(-pow(distance(vec2(pa, ang), vec2(0.19, R)) / 0.012, 2.0));
  float disc = smoothstep(R - 0.006, R + 0.001, ang);
  vec3 sun = vec3(1.0, 0.62, 0.3) * corona * 4.2 + vec3(1.0, 0.88, 0.7) * ring * 6.0 + vec3(1.0, 0.95, 0.9) * bead * 14.0;
  col = col * mix(0.04, 1.0, disc) + sun * disc;

  // облака: два слоя шума на «потолке», ползут в разные стороны
  vec2 cuv = d.xz / (max(h, 0.0) + 0.16);
  vec2 w = vec2(uTime * 0.0034, uTime * 0.0012);
  float n1 = texture2D(tNoise, cuv * 0.05 + w).r;
  float n2 = texture2D(tNoise, cuv * 0.13 - w * 1.9 + n1 * 0.07).g;
  float n3 = texture2D(tNoise, cuv * 0.37 + w * 3.3).r;
  float dens = n1 * 0.56 + n2 * 0.29 + n3 * 0.15;
  float nearSun = pow(sdp, 22.0);
  float cover = smoothstep(0.36 + nearSun * 0.26, 0.6 + nearSun * 0.26, dens);
  float thick = smoothstep(0.47, 0.74, dens);
  float thin = cover * (1.0 - thick);
  vec3 cc = mix(vec3(0.2, 0.215, 0.29), vec3(0.04, 0.045, 0.07), thick);
  cc += vec3(0.32, 0.2, 0.2) * thin * (0.5 + 0.5 * n3) * (0.35 + 0.65 * smoothstep(-0.4, 0.6, sd));          // закатный румянец кромок
  cc += vec3(1.5, 0.82, 0.4) * thin * (pow(sdp, 3.0) * 0.4 + pow(sdp, 14.0) * 0.9);   // золотая кайма у светила
  cc += vec3(0.22, 0.27, 0.42) * thin * 0.45;
  cc += vec3(0.5, 0.2, 0.1) * thick * pow(sdp, 2.0) * 0.14;
  cc += uFlash * vec3(0.8, 0.9, 1.25) * (0.18 + pow(max(dot(d, uFlashDir), 0.0), 3.0) * 3.0) * (0.35 + thin * 1.4);
  col = mix(col, cc + sun * disc * 0.12, cover * smoothstep(0.0, 0.14, h) * 0.94);

  // дымка у горизонта, тёплая со стороны светила; ниже горизонта — темнее
  vec3 haze = uHorizon + vec3(1.0, 0.42, 0.14) * pow(sdp, 3.0) * 0.32;
  col = mix(col, haze, smoothstep(0.16, -0.01, h));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.3, h));
  gl_FragColor = vec4(col, 0.0);   // альфа 0 — «это небо» (маска для лучей света)
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- Силуэты далёкого города: пиксельные панорамы на трёх кольцах ----------
// Громады города-собора: ступенчатые ульи с контрфорсами, соборы с парными башнями и окнами-розами,
// мануфактуры с трубами, руины. Чем дальше слой, тем крупнее формы и тем сильнее их съедает дымка.
function skylineCanvas(seed, { maxH, minH, tone, haze, glow, gap, fires, scale = 1 }) {
  const W = 2048, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const R = rng(seed);
  const base = H;
  const shade = (k) => { g.fillStyle = `rgb(${tone.map((v) => Math.round(v * k)).join(',')})`; };
  const px = (x, y, w, h) => g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const lit = [];
  // шпиль: треугольник со ступенчатыми «крабами» по рёбрам
  const spire = (cx, y, w, h) => {
    for (let i = 0; i < h; i++) { const ww = Math.max(1, w * (1 - i / h)); px(cx - ww / 2, y - i, ww, 1); }
    for (let i = 3; i < h - 4; i += 5) { const ww = w * (1 - i / h); px(cx - ww / 2 - 1, y - i, 1, 2); px(cx + ww / 2, y - i, 1, 2); }
    px(cx, y - h - 3, 1, 4); px(cx - 1, y - h - 1, 3, 1);            // крест-навершие
  };
  // башня: тело, пояса, зубцы или шпиль, контрфорсы у основания
  const tower = (x, w, h, top) => {
    px(x, base - h, w, h);
    for (let yy = base - h + 10; yy < base; yy += 22) px(x - 1, yy, w + 2, 2);
    for (let i = 0; i < 3; i++) { px(x - 2 - i * 2, base - h * (0.5 - i * 0.14), 2, h); px(x + w + i * 2, base - h * (0.5 - i * 0.14), 2, h); }
    if (top === 0) for (let i = 0; i < w; i += 4) px(x + i, base - h - 3, 2, 3);
    else { spire(x + w / 2, base - h, w * 0.95, h * (0.22 + R() * 0.22)); spire(x + 1, base - h, 3, 8); spire(x + w - 1, base - h, 3, 8); }
    for (let i = 0, n = Math.round(w * h * glow * 0.006); i < n; i++) lit.push([x + 2 + R() * (w - 4), base - 6 - R() * (h - 14), 1, 2 + (R() * 2 | 0)]);
  };
  let x = -20;
  while (x < W + 20) {
    const kind = R(), sc = scale * (0.7 + R() * 0.6);
    const h = minH + Math.pow(R(), 1.5) * (maxH - minH);
    shade(0.85 + R() * 0.3);
    let w;
    if (kind < 0.27) {
      // собор: неф с крышей, две башни, окно-роза, аркбутаны
      w = (54 + R() * 40) * sc;
      const tw = w * 0.2, nh = h * 0.56;
      px(x, base - nh, w, nh);
      for (let i = 0; i < w / 2; i++) px(x + w / 2 - i, base - nh - (w / 2 - i) * 0.5, i * 2, 1);     // двускатная крыша
      tower(x - 1, tw, h, 1); tower(x + w - tw + 1, tw, h * (0.86 + R() * 0.14), 1);
      spire(x + w / 2, base - nh - w * 0.25, 5, h * 0.3);                                            // игла над средокрестием
      for (let i = 1; i < 5; i++) px(x + tw + (i / 5) * (w - tw * 2), base - nh * 0.82, 2, nh * 0.82);
      lit.push([x + w / 2 - 3, base - nh * 0.72, 6, 6, 2]);
      for (let i = 0; i < 4; i++) if (R() < glow * 1.6) lit.push([x + tw + 3 + (i / 4) * (w - tw * 2 - 6), base - nh * 0.42, 2, 5, 1]);
    } else if (kind < 0.52) {
      // улей: ступенчатая громада с гроздью башен
      w = (70 + R() * 70) * sc;
      const steps = 3 + (R() * 3 | 0);
      for (let i = 0; i < steps; i++) { const ww = w * (1 - i * 0.2), hh = h * (0.34 + (i / steps) * 0.42); px(x + (w - ww) / 2, base - hh, ww, hh); for (let k = 0; k < ww; k += 5) px(x + (w - ww) / 2 + k, base - hh - 2, 3, 2); }
      const n = 2 + (R() * 3 | 0);
      for (let i = 0; i < n; i++) { const tw = (7 + R() * 9) * sc; tower(x + w * 0.2 + (i / n) * w * 0.6, tw, h * (0.72 + R() * 0.28), R() < 0.75 ? 1 : 0); }
      for (let i = 0, m = Math.round(w * h * glow * 0.004); i < m; i++) lit.push([x + 4 + R() * (w - 8), base - 6 - R() * h * 0.42, 1 + (R() * 2 | 0), 1]);
    } else if (kind < 0.72) {
      // одинокая башня-колокольня
      w = (10 + R() * 14) * sc;
      tower(x, w, h * (0.6 + R() * 0.4), R() < 0.7 ? 1 : 0);
    } else if (kind < 0.88) {
      // мануфактура: корпус с пилообразной крышей и трубы
      w = (44 + R() * 44) * sc;
      const bh = h * 0.3;
      px(x, base - bh, w, bh);
      for (let i = 0; i < w; i += 9) for (let k = 0; k < 9; k++) px(x + i + k, base - bh - k * 0.6, 1, k * 0.6 + 1);
      for (let i = 0, n = 2 + (R() * 3 | 0); i < n; i++) { const cx = x + 5 + (i / n) * (w - 10), ch = h * (0.55 + R() * 0.4); px(cx, base - ch, 5, ch); px(cx - 1, base - ch, 7, 2); }
      for (let i = 0; i < 5; i++) if (R() < glow * 2) lit.push([x + 4 + R() * (w - 8), base - bh * 0.5, 3, 2, 1]);
    } else {
      // руина: обломанная арка моста
      w = (36 + R() * 30) * sc;
      px(x, base - h * 0.6, 7, h * 0.6); px(x + w - 7, base - h * 0.4, 7, h * 0.4);
      for (let i = 0; i < w; i++) { const t = i / w, yy = base - h * 0.6 + Math.sin(t * Math.PI) * -6 + t * h * 0.18; if (t < 0.58 || R() < 0.25) px(x + i, yy, 1, 5); }
    }
    x += w + (R() < gap ? 6 + R() * 50 * scale : -6);
  }
  shade(0.8);
  for (let i = 0; i < W; i += 5) px(i, base - 12 - R() * 10, 5, 30);          // сплошная «подошва» города
  // окна: тёплые огни, изредка холодные; окна-розы — крупные
  for (const [lx, ly, lw, lh, big] of lit) {
    g.fillStyle = big === 2 ? '#ffe2b0' : big ? '#ffc070' : R() < 0.8 ? '#ffae58' : '#a8dcff';
    px(lx, ly, lw, lh);
    if (big === 2) { g.fillStyle = '#ff9a40'; px(lx - 1, ly + 1, lw + 2, lh - 2); px(lx + 1, ly - 1, lw - 2, lh + 2); g.fillStyle = '#fff0cc'; px(lx + 1, ly + 1, lw - 2, lh - 2); }
  }
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < fires; i++) {                                             // зарево пожаров снизу
    const fx = R() * W, fy = base - 8 - R() * 26, fr = 8 + R() * 16;
    const gr = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
    gr.addColorStop(0, 'rgba(255,200,110,1)'); gr.addColorStop(0.35, 'rgba(255,120,40,0.8)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = gr;
    g.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }
  // дымка съедает основание (атмосферная перспектива)
  const gr = g.createLinearGradient(0, base - maxH * 0.7, 0, base - 4);
  gr.addColorStop(0, `rgba(${haze.join(',')},0)`); gr.addColorStop(1, `rgba(${haze.join(',')},0.96)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(32, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 32; x++) {
    const u = Math.abs(x - 15.5) / 16, v = y / 127;     // v = 0 — дальний конец
    const a = Math.pow(1 - u, 2.2) * Math.pow(v, 0.7) * (0.25 + 0.75 * v);
    const i = (y * 32 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function softDot(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// ---------- Пепел и угольки: частицы целиком на видеокарте (позиция считается в шейдере от времени) ----------
function ashField(count, box) {
  const R = rng(5), seed = new Float32Array(count * 4), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = R(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 400 }, uBox: { value: new THREE.Vector3(...box) } },
    vertexShader: `
      attribute vec4 seed; uniform float uTime; uniform vec3 uCam; uniform float uScale; uniform vec3 uBox;
      varying vec4 vCol;
      void main() {
        float ember = step(0.86, seed.w);
        vec3 p = seed.xyz * uBox;
        float sp = mix(0.35 + seed.w * 0.5, -(0.5 + seed.x * 0.9), ember);     // пепел оседает, угольки поднимаются
        p.y -= uTime * sp;
        p.x += uTime * 0.55 + sin(uTime * 0.6 + seed.z * 40.0) * 0.6;
        p.z += cos(uTime * 0.45 + seed.x * 40.0) * 0.6 - uTime * 0.2;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float tw = 0.6 + 0.4 * sin(uTime * (3.0 + seed.y * 5.0) + seed.z * 30.0);
        vCol = mix(vec4(0.5, 0.52, 0.6, 0.42), vec4(vec3(3.2, 1.25, 0.32) * tw, 1.0), ember);
        float fade = smoothstep(uBox.x * 0.5, uBox.x * 0.32, length(p.xz - uCam.xz));
        vCol.a *= fade;
        gl_PointSize = clamp((0.035 + seed.y * 0.03 + ember * 0.012) * uScale / -mv.z, 1.0, 5.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec4 vCol;
      void main() {
        if (vCol.a < 0.02) discard;
        gl_FragColor = vCol;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createSky(scene) {
  const fogCol = new THREE.Color(FOG_COLOR);
  scene.background = fogCol.clone();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  // ----- свет -----
  const hemi = new THREE.HemisphereLight(0xaab6d4, 0x5c4e52, 2.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc896, 5.6);
  sun.position.copy(SUN_DIR).multiplyScalar(90).add(new THREE.Vector3(0, 0, 3));
  sun.target.position.set(0, 0, 3);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 190;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  // ----- купол неба -----
  const noise = noiseTex();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      tNoise: { value: noise }, uSunDir: { value: SUN_DIR }, uTime: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 0.3, 1) },
      uHorizon: { value: fogCol.clone() }, uMid: { value: new THREE.Color(0x2a3558) }, uZenith: { value: new THREE.Color(0x0b0e1e) },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  scene.add(dome);

  // ----- далёкий город: три кольца силуэтов -----
  // высота кольца = длина окружности × (256 / 2048) — пиксели панорамы квадратные
  const hz = [74, 86, 116];
  const layers = [
    { r: 480, seed: 11, o: { maxH: 236, minH: 80, tone: [26, 32, 54], haze: hz, glow: 0.5, gap: 0.3, fires: 0, scale: 1.5 }, bright: 1.0 },
    { r: 340, seed: 23, o: { maxH: 176, minH: 46, tone: [16, 20, 36], haze: hz, glow: 0.9, gap: 0.5, fires: 7, scale: 1.1 }, bright: 1.7 },
    { r: 210, seed: 37, o: { maxH: 104, minH: 22, tone: [9, 10, 19], haze: hz, glow: 1.0, gap: 0.7, fires: 12, scale: 0.8 }, bright: 2.0 },
  ];
  const far = new THREE.Group();
  layers.forEach((L, i) => {
    const tex = skylineCanvas(L.seed, L.o), h = L.r * 0.785;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, h, 64, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, fog: false, color: new THREE.Color(L.bright, L.bright, L.bright) }));
    cyl.position.y = h / 2 - 5;
    cyl.rotation.y = 0.6 + i * 2.1;
    cyl.renderOrder = -90 + i;
    far.add(cyl);
  });
  scene.add(far);

  // ----- прожекторы -----
  const beamTex = beamTexture();
  const beams = [];
  const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  for (const [a, len, ph] of [[2.5, 300, 0], [4.2, 340, 1.7], [0.9, 320, 4.4]]) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, color: new THREE.Color(0.2, 0.25, 0.38) }));
    const r = 300;
    m.position.set(Math.cos(a) * r, 4, Math.sin(a) * r);
    m.scale.set(11, len, 1);
    m.rotation.y = -a + Math.PI / 2;
    m.renderOrder = -80;
    far.add(m);
    beams.push({ m, ph, base: -a + Math.PI / 2 });
  }

  // ----- вспышки зенитного огня и далёких разрывов -----
  const dotTex = softDot();
  const flak = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: 0xffffff }));
    s.visible = false;
    s.renderOrder = -79;
    far.add(s);
    flak.push({ s, t: 0, dur: 0.3, wait: Math.random() * 4, size: 10 });
  }

  // ----- столбы дыма над пожарами -----
  const smokeMat = () => new THREE.ShaderMaterial({
    uniforms: { tNoise: { value: noise }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float; uniform sampler2D tNoise; uniform float uTime; uniform float uSeed; varying vec2 vUv;
      void main() {
        float lean = vUv.y * vUv.y * 0.32;
        vec2 p = vec2(vUv.x - lean, vUv.y);
        float n = texture2D(tNoise, vec2(p.x * 0.6 + uSeed, p.y * 0.9 - uTime * 0.02)).r * 0.6 + texture2D(tNoise, vec2(p.x * 1.7, p.y * 2.3 - uTime * 0.045 + uSeed)).g * 0.4;
        float width = 0.1 + vUv.y * 0.3;
        float body = smoothstep(width, width * 0.25, abs(p.x - 0.36));
        float a = body * smoothstep(0.34, 0.62, n + body * 0.25) * smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
        vec3 col = mix(vec3(0.9, 0.36, 0.12), vec3(0.05, 0.055, 0.08), smoothstep(0.0, 0.2, vUv.y));
        col = mix(col, vec3(0.13, 0.15, 0.21), smoothstep(0.3, 1.0, vUv.y));
        gl_FragColor = vec4(col, a * 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const smokes = [];
  for (const [a, r, w, h] of [[3.6, 190, 90, 170], [5.05, 300, 130, 260], [1.75, 185, 80, 150], [0.35, 310, 120, 230]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), smokeMat());
    m.position.set(Math.cos(a) * r, h / 2 + 4, Math.sin(a) * r);
    m.lookAt(0, h / 2, 0);
    m.renderOrder = -85;
    far.add(m);
    smokes.push(m);
  }

  // ----- пепел и угольки -----
  const ash = ashField(700, [44, 18, 44]);
  scene.add(ash);

  // ----- молнии -----
  const L = { t: 5 + Math.random() * 6, flash: 0, seq: [], onStrike: null };
  const hemiBase = hemi.intensity, hemiCol = hemi.color.clone(), fogBase = fogCol.clone();
  const bolt = new THREE.Color(0.75, 0.85, 1.2);

  function update(dt, time, camera) {
    dome.position.copy(camera.position);
    skyMat.uniforms.uTime.value = time;
    ash.material.uniforms.uTime.value = time;
    ash.material.uniforms.uCam.value.copy(camera.position);
    for (const s of smokes) s.material.uniforms.uTime.value = time;
    for (const b of beams) b.m.rotation.z = Math.sin(time * 0.13 + b.ph) * 0.55 + Math.sin(time * 0.31 + b.ph * 2.0) * 0.12;
    for (const f of flak) {
      if (f.t > 0) {
        f.t -= dt;
        const k = Math.max(0, f.t / f.dur);
        f.s.material.opacity = k * k;
        f.s.scale.setScalar(f.size * (1.4 - k * 0.6));
        if (f.t <= 0) f.s.visible = false;
        continue;
      }
      f.wait -= dt;
      if (f.wait > 0) continue;
      f.wait = 0.4 + Math.random() * 5;
      const a = Math.random() * 6.283, r = 230 + Math.random() * 180;
      f.s.position.set(Math.cos(a) * r, 30 + Math.random() * 150, Math.sin(a) * r);
      f.size = 9 + Math.random() * 20;
      f.t = f.dur = 0.14 + Math.random() * 0.25;
      f.s.material.color.setRGB(3.0, 1.9 + Math.random(), 1.0 + Math.random() * 0.6);
      f.s.visible = true;
    }
    // молния: двойная вспышка в облаках, на мгновение высвечивает сцену холодным светом
    L.t -= dt;
    if (L.t <= 0) {
      L.t = 7 + Math.random() * 13;
      const a = Math.random() * 6.283;
      skyMat.uniforms.uFlashDir.value.set(Math.cos(a), 0.25 + Math.random() * 0.4, Math.sin(a)).normalize();
      L.seq = [[0, 1], [0.07, 0.15], [0.13, 0.85], [0.3, 0.3]];
      L.age = 0;
      if (L.onStrike) L.onStrike(0.6 + Math.random() * 1.6);
    }
    if (L.seq.length) {
      L.age += dt;
      while (L.seq.length && L.age >= L.seq[0][0]) L.flash = Math.max(L.flash, L.seq.shift()[1]);
    }
    L.flash *= Math.exp(-9 * dt);
    const fl = L.flash < 0.003 ? 0 : L.flash;
    skyMat.uniforms.uFlash.value = fl;
    hemi.intensity = hemiBase + fl * 2.2;
    hemi.color.copy(hemiCol).lerp(bolt, Math.min(1, fl));
    scene.fog.color.copy(fogBase).lerp(bolt, fl * 0.3);
  }

  return {
    sun, hemi, sunDir: SUN_DIR, lightning: L, update,
    setScale: (h) => { ash.material.uniforms.uScale.value = h * 0.6; },
    // экранное положение светила (0..1) и видимость — для лучей света
    sunScreen(camera, out) {
      const v = _v.copy(SUN_DIR).multiplyScalar(500).add(camera.position).project(camera);
      out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
      const front = _v2.set(0, 0, -1).applyQuaternion(camera.quaternion).dot(SUN_DIR);
      return front <= 0.05 ? 0 : Math.min(1, (front - 0.05) * 2.2) * Math.max(0, 1 - Math.max(Math.abs(v.x), Math.abs(v.y)) * 0.42);
    },
  };
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
