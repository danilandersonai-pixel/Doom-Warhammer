// Вспышки выстрела (аддитивные пиксельные лучи + ореол). Само оружие в руках — запечённые из 3D кадры
// (tools/bake/fp.js → assets/sprites/w_*.png), здесь остались только процедурные вспышки.
import { Pix } from './pixel.js';

// ---------- Вспышка выстрела (аддитивная): лучи + ореол ----------
export function flashSprite(r = 40, color = [255, 200, 90], seed = 1) {
  const S = r * 2, P = new Pix(S, S);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rays = 7, phase = rnd() * 6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r, d = Math.hypot(dx, dy) / r;
    const a = Math.atan2(dy, dx);
    const ray = Math.pow(Math.abs(Math.cos(a * rays * 0.5 + phase)), 8) * 0.9;
    const lim = 0.32 + ray * (0.6 + rnd() * 0.15);
    if (d > lim) {
      if (d < 0.75) P.set(x, y, color, 70 * (1 - d / 0.75)); // мягкий ореол
      continue;
    }
    const k = d / lim;
    P.set(x, y, k < 0.35 ? [255, 255, 240] : k < 0.7 ? [255, 236, 150] : color);
  }
  return P;
}

let cache = null;
export function muzzleFlashes() {
  if (cache) return cache;
  cache = {
    flash: [flashSprite(40, [255, 170, 60], 3), flashSprite(40, [255, 190, 80], 7)].map((f) => f.toCanvas()),
    flashBlue: flashSprite(40, [120, 220, 255], 5).toCanvas(),
  };
  return cache;
}
