// Простейшая "физика": круги (игрок, враги) против прямоугольников (AABB) в плоскости XZ.
// Каждый коллайдер: { minX, maxX, minZ, maxZ, height }

// Выталкивает круг (pos.x, pos.z, radius) из всех коллайдеров
export function resolveCircle(pos, radius, colliders) {
  for (const b of colliders) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      // Обычный случай: сдвигаем от ближайшей точки коробки
      const d = Math.sqrt(d2);
      const push = radius - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else {
      // Центр оказался внутри коробки — выталкиваем через ближайшую сторону
      const left = pos.x - b.minX, right = b.maxX - pos.x;
      const front = pos.z - b.minZ, back = b.maxZ - pos.z;
      const m = Math.min(left, right, front, back);
      if (m === left) pos.x = b.minX - radius;
      else if (m === right) pos.x = b.maxX + radius;
      else if (m === front) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    }
  }
}

// Находится ли точка внутри какого-нибудь коллайдера (pad — запас по краям)
export function pointInColliders(x, y, z, colliders, pad = 0) {
  for (const b of colliders) {
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad && y < b.height + pad) {
      return true;
    }
  }
  return false;
}
