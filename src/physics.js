// Простая физика мира: всё твёрдое — это коробки (AABB) с высотой.
// Игрок и враги — вертикальные цилиндры (круг в плоскости XZ + высота).
// Ступеньку ниже STEP можно "перешагнуть", на коробку можно встать сверху.

export const STEP = 0.45;   // высота ступеньки, на которую поднимаемся без прыжка

export class World {
  constructor() {
    this.boxes = [];   // { minX, maxX, minY, maxY, minZ, maxZ, disabled, enemyOnly, tag }
    this.pits = [];    // прямоугольники пропастей { minX, maxX, minZ, maxZ }
  }

  addBox(minX, maxX, minY, maxY, minZ, maxZ, opts = {}) {
    const b = { minX, maxX, minY, maxY, minZ, maxZ, disabled: false, enemyOnly: false, ...opts };
    this.boxes.push(b);
    return b;
  }

  // Коробка по центру и размерам (y — низ)
  box(x, z, w, d, y0, h, opts) {
    return this.addBox(x - w / 2, x + w / 2, y0, y0 + h, z - d / 2, z + d / 2, opts);
  }

  addPit(minX, maxX, minZ, maxZ) { this.pits.push({ minX, maxX, minZ, maxZ }); }

  inPit(x, z) {
    for (const p of this.pits) if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return true;
    return false;
  }

  // Высота опоры под точкой: самая высокая "крыша" коробки не выше y + STEP
  groundAt(x, z, y, r = 0.3, forEnemy = false) {
    let g = this.inPit(x, z) ? -100 : 0;
    for (const b of this.boxes) {
      if (b.disabled || (b.enemyOnly && !forEnemy)) continue;
      if (b.maxY > y + STEP || b.maxY <= g) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) g = b.maxY;
    }
    return g;
  }

  // Вытолкнуть цилиндр из стен (коробок выше ступеньки на уровне тела)
  resolve(p, r, height, forEnemy = false) {
    for (const b of this.boxes) {
      if (b.disabled || (b.enemyOnly && !forEnemy)) continue;
      // выше пояса — это потолок/перемычка: вбок не толкает (см. ceilingAt)
      if (b.maxY <= p.y + STEP || b.minY >= p.y + height * 0.55) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p.x += dx * k; p.z += dz * k;
      } else {
        // центр внутри коробки — выталкиваем через ближайшую сторону
        const opts = [[p.x - b.minX, 'x', b.minX - r], [b.maxX - p.x, 'x', b.maxX + r], [p.z - b.minZ, 'z', b.minZ - r], [b.maxZ - p.z, 'z', b.maxZ + r]];
        opts.sort((a, c) => a[0] - c[0]);
        p[opts[0][1]] = opts[0][2];
      }
    }
  }

  // Низ ближайшего потолка над головой (или Infinity)
  ceilingAt(x, z, y, r, height) {
    let c = Infinity;
    for (const b of this.boxes) {
      if (b.disabled || b.enemyOnly) continue;
      if (b.minY < y + height * 0.55 || b.minY > y + height + 0.5) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) c = Math.min(c, b.minY);
    }
    return c;
  }

  // Точка внутри твёрдого? (для снарядов)
  solidAt(x, y, z) {
    if (y < (this.inPit(x, z) ? -100 : 0)) return true;
    for (const b of this.boxes) {
      if (b.disabled || b.enemyOnly) continue;
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  // Свободен ли путь для врага в точку (проверка "щупальцем")
  blockedFor(x, z, y, r) {
    if (this.inPit(x, z)) return true;
    for (const b of this.boxes) {
      if (b.disabled) continue;
      if (b.maxY <= y + STEP || b.minY >= y + 1.6) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  }
}
