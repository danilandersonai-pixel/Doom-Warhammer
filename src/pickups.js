// Пикапы (аптечка, броня, патроны, гранаты, оружие, реликвия) и взрывные бочки.
// Пикап — пиксельный спрайт, покачивается над землёй, под ним светящееся кольцо-ореол.
import * as THREE from 'three';
import { nearestTexture } from './pixel.js';
import { miscArt, ringCanvas, haloCanvas } from './art_misc.js';
import { envTextures } from './textures.js';
import { HEALTH_MAX, ARMOR_MAX } from './player.js';
import { WEAPONS, GRENADES_MAX } from './weapons.js';
import { sfx } from './audio.js';

const LABELS = { health: '+25 здоровья', armor: '+25 брони', ammo: 'Патроны', grenades: '+2 гранаты', relic: 'Реликвия ордена: +50 брони, +2 гранаты' };

export class Pickups {
  constructor(G) {
    this.G = G;
    const art = miscArt();
    this.tex = {};
    for (const [k, c] of Object.entries(art.pickups)) this.tex[k] = nearestTexture(c);
    for (const [k, c] of Object.entries(art.icons)) this.tex['weapon:' + k] = nearestTexture(c);
    this.ringTex = { lime: new THREE.CanvasTexture(ringCanvas('200,255,60')), gold: new THREE.CanvasTexture(ringCanvas('255,210,90')) };
    this.list = [];
    this.barrels = [];
    // бочки
    const T = envTextures();
    this.barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12);
    this.barrelMat = [new THREE.MeshLambertMaterial({ map: T.barrel }), new THREE.MeshLambertMaterial({ color: 0x5a1a14 }), new THREE.MeshLambertMaterial({ color: 0x3a3a42 })];
  }

  reset() {
    for (const p of this.list) this.G.scene.remove(p.group);
    this.list = [];
    for (const b of this.barrels) { this.G.scene.remove(b.mesh); if (b.box) b.box.disabled = true; }
    this.barrels = [];
    const L = this.G.level;
    for (const s of L.pickupSpots) this.add(s.type, s.x, s.y || 0, s.z);
    for (const [x, z] of L.barrelSpots) this.addBarrel(x, z);
  }

  add(type, x, y, z, { drop = false } = {}) {
    const isWeapon = type.startsWith('weapon:');
    const group = new THREE.Group();
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[type] }));
    const s = isWeapon ? 1.3 : type === 'relic' ? 0.85 : 0.7;
    spr.scale.set(s * (isWeapon ? 1 : 1), s * (isWeapon ? 20 / 48 : 1), 1);
    group.add(spr);
    // светящееся кольцо: лаймовое у оружия и важных вещей, золотое у остальных
    const ringMat = new THREE.MeshBasicMaterial({ map: this.ringTex[isWeapon || type === 'relic' ? 'lime' : 'gold'], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: isWeapon || type === 'relic' ? 0.9 : 0.55 });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), ringMat);
    ring.scale.setScalar(isWeapon || type === 'relic' ? 2.6 : 1.6);
    ring.position.y = 0.03;
    group.add(ring);
    if (isWeapon || type === 'relic') {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringTex.lime, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
      halo.scale.set(2.2, 2.2, 1);
      group.add(halo);
      group.userData.halo = halo;
    }
    group.position.set(x, y, z);
    this.G.scene.add(group);
    const p = { type, group, spr, ring, x, y, z, phase: Math.random() * 6, taken: false, drop, life: drop ? 25 : Infinity };
    this.list.push(p);
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
    this.G.scene.add(mesh);
    const b = { mesh, x, z, hp: 25, dead: false, box: this.G.world.box(x, z, 0.8, 0.8, 0, 1.15) };
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
    if (b.hp > 0) return;
    b.dead = true;
    b.box.disabled = true;
    this.G.scene.remove(b.mesh);
    const p = new THREE.Vector3(b.x, 0.7, b.z);
    // небольшая задержка — цепная реакция выглядит лучше
    setTimeout(() => {
      const G = this.G;
      G.fx.explosions.spawn(p, 4.5, 0.75);
      G.fx.decals.floor(b.x, 0.01, b.z, 3.4, 'scorch');
      G.fx.gibs.burst(p, 5, 6, 0.3, 0);
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
    G.scene.remove(p.group);
    G.hud.pickupMsg(msg);
    G.hud.pickupFlash();
    sfx.pickup(p.type.startsWith('weapon:') || p.type === 'relic');
  }

  update(dt, time) {
    const P = this.G.player;
    for (const p of this.list) {
      if (p.taken) continue;
      p.spr.position.y = 0.55 + Math.sin(time * 2.5 + p.phase) * 0.12;
      p.ring.material.opacity = (p.type.startsWith('weapon:') || p.type === 'relic' ? 0.95 : 0.7) + Math.sin(time * 4 + p.phase) * 0.15;
      if (p.group.userData.halo) p.group.userData.halo.position.y = p.spr.position.y;
      if (p.drop) { p.life -= dt; if (p.life <= 0) { p.taken = true; this.G.scene.remove(p.group); continue; } }
      const dx = P.pos.x - p.x, dz = P.pos.z - p.z, dy = P.pos.y - p.y;
      if (dx * dx + dz * dz < 1.3 * 1.3 && dy > -1 && dy < 1.6 && this.canTake(p)) this.take(p);
    }
    this.list = this.list.filter((p) => !p.taken);
  }
}
