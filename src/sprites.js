// Запечённые спрайты (tools/bake_sprites.mjs): атлас PNG + JSON с раскладкой кадров.
// Ячейка i = start анимации + кадр*dirs + направление; направление 0 — враг смотрит на камеру, дальше через 45° против часовой.
import * as THREE from 'three';

export const SPRITES = {};

export async function loadSprites(names) {
  await Promise.all(names.map(async (n) => {
    const emb = window.__SPRITES && window.__SPRITES[n];   // в однофайловой сборке атласы встроены
    const meta = emb ? emb.meta : await (await fetch(`assets/sprites/${n}.json`)).json();
    const img = new Image();
    img.src = emb ? emb.png : `assets/sprites/${n}.png`;
    await img.decode();
    const tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    SPRITES[n] = { name: n, meta, img, tex };
  }));
}

// Копия текстуры со своим смещением (картинка общая, на видеокарту грузится один раз)
export function spriteTexture(sheet) {
  const t = sheet.tex.clone();
  const { cols, gridRows } = sheet.meta;
  t.repeat.set(1 / cols, 1 / gridRows);
  t.needsUpdate = true;
  return t;
}

// Поставить кадр: anim — имя анимации, frame — номер кадра, dir — 0..7
export function setSpriteFrame(tex, sheet, anim, frame, dir) {
  const m = sheet.meta, A = m.anims[anim] || m.anims.idle;
  const f = Math.min(A.frames - 1, Math.max(0, frame | 0));
  const i = A.start + f * A.dirs + (A.dirs > 1 ? dir : 0);
  const cx = i % m.cols, cy = Math.floor(i / m.cols);
  tex.offset.set(cx / m.cols, 1 - (cy + 1) / m.gridRows);
}

// Направление спрайта: угол между взглядом врага и направлением на камеру → сектор 0..7
export function viewDir(yaw, ex, ez, cx, cz) {
  const toCam = Math.atan2(cx - ex, cz - ez);
  const a = yaw - toCam;
  return (((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8);
}

// Плоскость под спрайт: ноги (footPx от верха кадра) на y = 0
export function spriteGeometry(sheet, scale = 1) {
  const m = sheet.meta, px = m.pxWorld * scale;
  const w = m.cell[0] * px, h = m.cell[1] * px;
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2 - (m.cell[1] - m.footPx) * px, 0);
  return g;
}
