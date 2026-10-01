// Фабрика пиксель-арта.
// Рисуем не прямоугольниками, а "масками" (эллипсы, многоугольники, конечности),
// а затенение считаем автоматически по форме маски: свет сверху-слева, 4–5 тонов,
// дизеринг на переходах, внутренний контур между частями и внешний контур 1 px.
import * as THREE from 'three';

// ---------- Цвета ----------
export function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsl2rgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

// Сдвинуть оттенок h к target не больше чем на deg градусов
function towardHue(h, target, deg) {
  let d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), deg);
}

// "Рампа" материала: n тонов от тени к блику. Тени уходят в холодный (синий),
// блики — в тёплый (жёлтый) — классический приём пиксель-арта.
export function ramp(base, { n = 5, spread = 0.5, shift = 22, sat = 0.08 } = {}) {
  const [h, s, l] = rgb2hsl(hex(base));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // -0.5 .. 0.5
    const hh = t < 0 ? towardHue(h, 250, -t * 2 * shift) : towardHue(h, 55, t * 2 * shift * 0.7);
    const ss = Math.min(1, Math.max(0, s + (t < 0 ? -t * sat * 2 : -t * sat)));
    const ll = Math.min(0.97, Math.max(0.03, l + t * spread * 2 * (t < 0 ? Math.min(1, l * 1.6) : Math.min(1, (1 - l) * 1.6))));
    out.push(hsl2rgb([hh, ss, ll]));
  }
  return out;
}

// Матрица Байера 4×4 для дизеринга
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);

// ---------- Маска формы ----------
export class Mask {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.m = new Uint8Array(w * h);
  }

  _each(x0, y0, x1, y1, test) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.w - 1, Math.ceil(x1)); y1 = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (test(x + 0.5, y + 0.5)) this.m[y * this.w + x] = 1;
    return this;
  }

  ellipse(cx, cy, rx, ry, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), r = Math.max(rx, ry) + 1;
    return this._each(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      return u * u + v * v <= 1;
    });
  }

  rect(x, y, w, h) { return this._each(x, y, x + w - 1, y + h - 1, () => true); }

  // Многоугольник [[x,y], ...]
  poly(pts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return this._each(x0, y0, x1, y1, (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    });
  }

  // Сужающаяся "конечность" от (x1,y1) радиусом r1 до (x2,y2) радиусом r2
  limb(x1, y1, x2, y2, r1, r2 = r1) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1, r = Math.max(r1, r2) + 1;
    return this._each(Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const px = x1 + dx * t, py = y1 + dy * t, rr = r1 + (r2 - r1) * t;
      return (x - px) ** 2 + (y - py) ** 2 <= rr * rr;
    });
  }

  // Вырезать другую маску
  cut(other) { for (let i = 0; i < this.m.length; i++) if (other.m[i]) this.m[i] = 0; return this; }
  // Оставить только пересечение
  clip(other) { for (let i = 0; i < this.m.length; i++) if (!other.m[i]) this.m[i] = 0; return this; }
  // Произвольный фильтр по координатам
  keep(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.m[y * this.w + x] && !fn(x, y)) this.m[y * this.w + x] = 0; return this; }
}

// ---------- Холст спрайта ----------
export class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }

  mask() { return new Mask(this.w, this.h); }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  alpha(x, y) { return this.inb(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0; }

  set(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (!this.inb(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) { this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; return; }
    // смешивание с тем, что уже нарисовано
    const k = a / 255, ia = this.d[i + 3] / 255, oa = k + ia * (1 - k);
    for (let j = 0; j < 3; j++) this.d[i + j] = (c[j] * k + this.d[i + j] * ia * (1 - k)) / (oa || 1);
    this.d[i + 3] = oa * 255;
  }

  rect(x, y, w, h, c, a) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a); }

  line(x0, y0, x1, y1, c, a) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c, a);
  }

  // Светящаяся точка: яркое ядро + ореол
  glow(cx, cy, r, core, halo) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      if (d < 0.45) this.set(x, y, core);
      else if (halo && this.alpha(x, y) > 0) this.set(x, y, halo, 255 * (1 - d) * 1.4);
    }
  }

  // Залить маску материалом с объёмным затенением.
  // round — "толщина" скругления в пикселях (больше — мягче объём), grad — верх светлее низа,
  // tex(x,y) — добавка к тону (царапины, складки), contour — тёмная кромка там, где деталь лежит поверх другой.
  fill(mask, rmp, { round = 3, grad = 0.25, bias = 0, dither = 0.6, contour = true, tilt = 1.8, tex = null, flat = false } = {}) {
    const { w, h } = this, M = mask.m, n = rmp.length;
    // 1) расстояние до края маски (два прохода "шахматным" способом)
    const D = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) D[i] = M[i] ? 1e6 : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!M[i]) continue;
      D[i] = Math.min(D[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.41, at(x + 1, y - 1) + 1.41);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!M[i]) continue;
      D[i] = Math.min(D[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.41, at(x - 1, y + 1) + 1.41);
    }
    // 2) "высота" поверхности: купол у краёв, плато в середине
    const H = new Float32Array(w * h);
    let y0 = h, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!M[i]) continue;
      H[i] = Math.sqrt(Math.min(D[i], round) / round);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const hAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : H[y * w + x]);
    const L = [-0.5, -0.7, 0.75];
    const ll = Math.hypot(...L);
    // 3) нормаль -> освещённость -> индекс тона с дизерингом
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!M[i]) continue;
      let v;
      if (flat) v = 0.6;
      else {
        const gx = (hAt(x - 1, y) - hAt(x + 1, y)) * tilt, gy = (hAt(x, y - 1) - hAt(x, y + 1)) * tilt;
        const nl = Math.hypot(gx, gy, 1);
        const lam = (gx * L[0] + gy * L[1] + L[2]) / (nl * ll);
        v = 0.15 + lam * 0.85;
      }
      v += grad * (0.5 - (y - y0) / Math.max(1, y1 - y0)) + bias;
      let f = v * (n - 1);
      if (tex) f += tex(x, y);
      if (dither) f += BAYER[(x & 3) + (y & 3) * 4] * dither;
      let idx = Math.max(0, Math.min(n - 1, Math.round(f)));
      // кромка: если рядом уже нарисованная деталь (не пустота) — тёмный внутренний контур
      if (contour) {
        const nb = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of nb) {
          const xx = x + dx, yy = y + dy;
          const outside = xx < 0 || yy < 0 || xx >= w || yy >= h || !M[yy * w + xx];
          if (outside && this.alpha(xx, yy) > 0) { idx = dx < 0 || dy < 0 ? Math.min(idx, 1) : 0; break; }
        }
      }
      this.set(x, y, rmp[idx]);
    }
    return this;
  }

  // Внешний контур 1 px вокруг всего силуэта
  outline(c = [20, 14, 20]) {
    const { w, h } = this, mark = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (this.alpha(x, y) > 0) continue;
      if (this.alpha(x - 1, y) > 128 || this.alpha(x + 1, y) > 128 || this.alpha(x, y - 1) > 128 || this.alpha(x, y + 1) > 128) mark.push([x, y]);
    }
    for (const [x, y] of mark) this.set(x, y, c);
    return this;
  }

  // Повёрнутая копия (поворот вокруг точки px,py, ближайший пиксель) — для кадров падения
  rotated(angle, px, py, dx = 0, dy = 0) {
    const out = new Pix(this.w, this.h), c = Math.cos(-angle), s = Math.sin(-angle);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const rx = x + 0.5 - px - dx, ry = y + 0.5 - py - dy;
      const sx = Math.floor(px + rx * c - ry * s), sy = Math.floor(py + rx * s + ry * c);
      if (!this.inb(sx, sy)) continue;
      const i = (sy * this.w + sx) * 4, o = (y * this.w + x) * 4;
      for (let k = 0; k < 4; k++) out.d[o + k] = this.d[i + k];
    }
    return out;
  }

  // Наложить другой спрайт сверху (со смещением)
  draw(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.d[i + 3] > 0) this.set(x + ox, y + oy, [src.d[i], src.d[i + 1], src.d[i + 2]], src.d[i + 3]);
    }
    return this;
  }

  clone() { const p = new Pix(this.w, this.h); p.d.set(this.d); return p; }

  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    return c;
  }
}

// Лист кадров: все кадры в один ряд
export function sheet(frames) {
  const w = frames[0].w, h = frames[0].h;
  const c = document.createElement('canvas');
  c.width = w * frames.length;
  c.height = h;
  const g = c.getContext('2d');
  frames.forEach((f, i) => g.putImageData(new ImageData(f.d, w, h), i * w, 0));
  return { canvas: c, w, h, count: frames.length };
}

// Текстура с чёткими пикселями
export function nearestTexture(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = repeat ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = repeat;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Предсказуемый генератор случайных чисел
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Простой шум (value noise) для текстур
export function noise2(seed = 1) {
  const R = rng(seed), P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = R();
  const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
