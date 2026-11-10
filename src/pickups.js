// Пикапы (аптечка, броня, патроны, гранаты, оружие, реликвия) и взрывные бочки.
// Пикап — пиксельный спрайт, покачивается над землёй; под ним мягкое свечение и вращающееся пиксельное кольцо,
// над ним — столб света (виден издалека), изредка поднимаются искорки.
// Палитра: янтарь — обычные вещи, холодный голубой — оружие и реликвия.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, ringCanvas } from './art_misc.js';
import { fxArt } from './art_fx.js';
import { envTextures } from './textures.js';
import { HEALTH_MAX, ARMOR_MAX } from './player.js';
import { WEAPONS, GRENADES_MAX } from './weapons.js';
import { sfx } from './audio.js';

const LABELS = { health: '+25 здоровья', armor: '+25 брони', ammo: 'Патроны', grenades: '+2 гранаты', relic: 'Реликвия ордена: +50 брони, +2 гранаты' };
const AMBER = 0xffb347, COLD = 0x7fd0e8;
const UP = new THREE.Vector3(0, 1, 0);

// Столб света: две скрещённые вертикальные плоскости (видно с любой стороны), основание на y = 0
function pillarGeo() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const cat = (name, n) => new THREE.Float32BufferAttribute([...a.attributes[name].array, ...b.attributes[name].array], n);
  g.setAttribute('position', cat('position', 3));
  g.setAttribute('uv', cat('uv', 2));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + 4)]);
  return g;
}

export class Pickups {
  constructor(G) {
    this.G = G;
    const art = miscArt(), fart = fxArt();
    this.tex = {};
    for (const [k, c] of Object.entries(art.pickups)) this.tex[k] = nearestTexture(c);
    for (const [k, c] of Object.entries(art.icons)) this.tex['weapon:' + k] = nearestTexture(c);
    this.glowTex = { amber: new THREE.CanvasTexture(ringCanvas('255,179,71')), cold: new THREE.CanvasTexture(ringCanvas('127,208,232')) };
    this.ringTex = fart.pickupRing;
    this.pillarTex = fart.pillar;
    this.flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pillarGeo = pillarGeo();
    this.list = [];
    this.barrels = [];
    // бочки
    const T = envTextures();
    this.barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12);
    this.barrelMat = [new THREE.MeshLambertMaterial({ map: T.barrel, normalMap: T.barrelN || null }), new THREE.MeshLambertMaterial({ color: 0x5a1a14 }), new THREE.MeshLambertMaterial({ color: 0x3a3a42 })];
    this.tmp = new THREE.Vector3();
  }

  reset() {
    for (const p of this.list) this.remove(p);
    this.list = [];
    for (const b of this.barrels) { this.G.scene.remove(b.mesh); if (b.box) b.box.disabled = true; }
    this.barrels = [];
    const L = this.G.level;
    for (const s of L.pickupSpots) this.add(s.type, s.x, s.y || 0, s.z);
    for (const [x, z] of L.barrelSpots) this.addBarrel(x, z);
  }

  remove(p) {
    this.G.scene.remove(p.group);
    for (const m of p.mats) m.dispose();
  }

  add(type, x, y, z, { drop = false } = {}) {
    const isWeapon = type.startsWith('weapon:'), special = isWeapon || type === 'relic';
    const color = special ? COLD : AMBER, add = { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false };
    const group = new THREE.Group();
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[type], color: new THREE.Color(1.25, 1.25, 1.25) }));
    const s = isWeapon ? 1.3 : type === 'relic' ? 0.85 : 0.7;
    spr.scale.set(s, s * (isWeapon ? 20 / 48 : 1), 1);
    group.add(spr);
    // мягкое свечение на земле
    const glowMat = new THREE.MeshBasicMaterial({ map: this.glowTex[special ? 'cold' : 'amber'], ...add, opacity: special ? 0.9 : 0.6 });
    const glow = new THREE.Mesh(this.flatGeo, glowMat);
    glow.scale.setScalar(special ? 2.6 : 1.7);
    glow.position.y = 0.03;
    group.add(glow);
    // вращающееся пиксельное кольцо
    const ringMat = new THREE.MeshBasicMaterial({ map: this.ringTex, ...add, color: new THREE.Color(color).multiplyScalar(special ? 2.4 : 1.8) });
    const ring = new THREE.Mesh(this.flatGeo, ringMat);
    ring.scale.setScalar(special ? 1.9 : 1.25);
    ring.position.y = 0.05;
    group.add(ring);
    // столб света
    const pillarMat = new THREE.MeshBasicMaterial({ map: this.pillarTex, ...add, side: THREE.DoubleSide, color: new THREE.Color(color).multiplyScalar(special ? 1.5 : 0.8) });
    const pillar = new THREE.Mesh(this.pillarGeo, pillarMat);
    pillar.scale.set(special ? 0.9 : 0.55, special ? 4.2 : 2.2, special ? 0.9 : 0.55);
    group.add(pillar);
    // ореол вокруг самого предмета у оружия и реликвии
    let halo = null;
    const mats = [spr.material, glowMat, ringMat, pillarMat];
    if (special) {
      halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex.cold, ...add, opacity: 0.75 }));
      halo.scale.set(2.2, 2.2, 1);
      group.add(halo);
      mats.push(halo.material);
    }
    group.position.set(x, y, z);
    this.G.scene.add(group);
    const p = { type, group, spr, ring, glow, pillar, halo, mats, color, special, x, y, z, phase: Math.random() * 6, taken: false, drop, life: drop ? 25 : Infinity, age: drop ? 0 : 1, sparkT: Math.random() * 2, size: s };
    this.list.push(p);
    if (drop) this.G.fx.sparks.burst({ x, y: y + 0.5, z }, 8, color, { speed: 3, life: 0.5, gravity: 4, size: 0.06, hdr: 2.6 });
    return p;
  }

  // Выпадение из врага
  drop(e) {
    const r = Math.random();
    const table = e.type === 'heavy' ? [['armor', 0.5], ['health', 1]] : e.type === 'gunner' ? [['ammo', 0.35], ['health', 0.5], ['grenades', 0.56]] : [['health', 0.18], ['ammo', 0.3]];
    for (const [type, p] of table) if (r < p) { this.add(type, e.pos.x, e.pos.y, e.pos.z, { drop: true }); return; }
  }

  addBarrel(x, z) {
    const mesh = new THREE.Mesh(this.barrelGeo, this.barrelMat);
    mesh.position.set(x, 0.58, z);
    mesh.rotation.y = Math.random() * 6;
    mesh.userData.barrel = null;
    mesh.receiveShadow = true;
    this.G.scene.add(mesh);
    const b = { mesh, x, z, hp: 25, dead: false, burnT: 0, box: this.G.world.box(x, z, 0.8, 0.8, 0, 1.15) };
    mesh.userData.barrel = b;
    this.barrels.push(b);
  }

  barrelMeshes() { return this.barrels.filter((b) => !b.dead).map((b) => b.mesh); }

  barrelHit(p, r) {
    for (const b of this.barrels) {
      if (b.dead) continue;
      if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < (0.45 + r) ** 2 && p.y < 1.25) return b;
    }
    return null;
  }

  damageBarrel(b, dmg) {
    if (b.dead) return;
    b.hp -= dmg;
    if (b.hp > 0) { b.burning = true; return; }      // пробита: из дыры бьёт язычок пламени
    b.dead = true;
    b.box.disabled = true;
    this.G.scene.remove(b.mesh);
    const p = new THREE.Vector3(b.x, 0.7, b.z);
    // небольшая задержка — цепная реакция выглядит лучше
    setTimeout(() => {
      const G = this.G;
      G.fx.explosions.spawn(p, 5.2, 0.8);
      G.fx.decals.floor(b.x, 0.01, b.z, 3.6, 'scorch');
      G.fx.gibs.burst(p, 5, 6, 0.3, 0, G.fx.lightTint(p));
      G.fx.sparks.burst(p, 16, 0xffd070, { speed: 12, life: 0.8, gravity: 9, size: 0.08, up: 0.8, hdr: 3.4 });
      G.damageArea(p, 4.2, 140, 'barrel');
      G.player.addTrauma(Math.max(0, 0.8 - p.distanceTo(G.camera.position) / 20));
      sfx.explosion(Math.max(0.3, 1 - p.distanceTo(G.camera.position) / 40));
    }, 90);
  }

  // Можно ли взять (не брать аптечку при полном здоровье и т.п.)
  canTake(p) {
    const G = this.G, P = G.player, W = G.weapons;
    if (p.type === 'health') return P.health < HEALTH_MAX;
    if (p.type === 'armor') return P.armor < ARMOR_MAX;
    if (p.type === 'grenades') return W.grenades < GRENADES_MAX;
    if (p.type === 'ammo') return Object.entries(W.ammo).some(([k, a]) => WEAPONS[k].mag && W.owned.has(k) && a.reserve < WEAPONS[k].reserveMax);
    return true;
  }

  take(p) {
    const G = this.G, P = G.player, W = G.weapons;
    let msg = LABELS[p.type];
    if (p.type === 'health') P.health = Math.min(HEALTH_MAX, P.health + 25);
    if (p.type === 'armor') P.armor = Math.min(ARMOR_MAX, P.armor + 25);
    if (p.type === 'ammo') W.addAmmo();
    if (p.type === 'grenades') W.grenades = Math.min(GRENADES_MAX, W.grenades + 2);
    if (p.type === 'relic') { P.armor = Math.min(ARMOR_MAX, P.armor + 50); W.grenades = Math.min(GRENADES_MAX, W.grenades + 2); }
    if (p.type.startsWith('weapon:')) {
      const k = p.type.slice(7);
      W.give(k);
      msg = `${WEAPONS[k].name} — новое оружие [${WEAPONS[k].slot}]`;
      G.hud.objectiveFlash(`${WEAPONS[k].name}! Испытай его на еретиках.`);
    }
    p.taken = true;
    this.remove(p);
    // вспышка подбора: кольцо расходится по земле, искры взлетают
    const at = this.tmp.set(p.x, p.y + 0.04, p.z);
    G.fx.flat.spawn('ringThin', at, UP, { size: 0.6, grow: p.special ? 3.4 : 2.2, dur: 0.4, color: p.color, gain: 2.6, pow: 1.3, lift: 0.03 });
    G.fx.sparks.burst({ x: p.x, y: p.y + 0.5, z: p.z }, p.special ? 22 : 12, p.color, { speed: 4, life: 0.6, gravity: -3, size: 0.06, up: 1.2, hdr: 2.8 });
    if (p.special) G.fx.lights.flash({ x: p.x, y: p.y + 0.8, z: p.z }, COLD, 26, 0.3, 8);
    G.hud.pickupMsg(msg);
    G.hud.pickupFlash();
    sfx.pickup(p.type.startsWith('weapon:') || p.type === 'relic');
  }

  update(dt, time) {
    const G = this.G, P = G.player;
    for (const p of this.list) {
      if (p.taken) continue;
      p.age = Math.min(1, p.age + dt * 4);                         // выпавший пикап «выскакивает»
      const pop = p.age < 1 ? 0.3 + p.age * 0.7 + Math.sin(p.age * Math.PI) * 0.25 : 1;
      const bob = Math.sin(time * 2.5 + p.phase);
      p.spr.position.y = 0.55 + bob * 0.12;
      p.spr.scale.set(p.size * pop, p.size * pop * (p.type.startsWith('weapon:') ? 20 / 48 : 1), 1);
      p.glow.material.opacity = (p.special ? 0.85 : 0.6) + Math.sin(time * 4 + p.phase) * 0.15;
      p.ring.rotation.y = time * (p.special ? 1.6 : 1.1) + p.phase;
      const rs = (p.special ? 1.9 : 1.25) * (1 + Math.sin(time * 3 + p.phase) * 0.06);
      p.ring.scale.setScalar(rs);
      p.pillar.rotation.y = time * 0.4 + p.phase;
      p.pillar.scale.y = (p.special ? 4.2 : 2.2) * (0.9 + Math.sin(time * 2.2 + p.phase) * 0.1) * pop;
      if (p.halo) p.halo.position.y = p.spr.position.y;
      // последние секунды выпавшего пикапа — мигает
      if (p.drop) {
        p.life -= dt;
        if (p.life <= 0) { p.taken = true; this.remove(p); continue; }
        p.group.visible = p.life > 4 || Math.sin(p.life * 16) > -0.2;
      }
      p.sparkT -= dt;
      if (p.sparkT <= 0) {
        p.sparkT = p.special ? 0.25 + Math.random() * 0.3 : 0.7 + Math.random() * 0.9;
        const a = Math.random() * 6.283, r = Math.random() * 0.45;
        G.fx.sparks.burst({ x: p.x + Math.cos(a) * r, y: p.y + 0.2 + Math.random() * 0.5, z: p.z + Math.sin(a) * r }, 1, p.color, { speed: 0.6, life: 1.1, gravity: -1.4, size: 0.05, up: 1.5, hdr: 2.4 });
      }
      const dx = P.pos.x - p.x, dz = P.pos.z - p.z, dy = P.pos.y - p.y;
      if (dx * dx + dz * dz < 1.3 * 1.3 && dy > -1 && dy < 1.6 && this.canTake(p)) this.take(p);
    }
    this.list = this.list.filter((p) => !p.taken);
    // пробитые бочки горят: язычок пламени у верхнего края, искры
    for (const b of this.barrels) {
      if (b.dead || !b.burning) continue;
      b.burnT -= dt;
      if (b.burnT > 0) continue;
      b.burnT = 1.1;
      G.fx.flames.spawn(b.x + 0.18, 1.1, b.z + 0.1, 0.55, 1.35);
      G.fx.sparks.burst({ x: b.x, y: 1.25, z: b.z }, 4, 0xffa040, { speed: 2.2, life: 0.7, gravity: -1, size: 0.05, up: 1.4, hdr: 3 });
    }
  }
}
