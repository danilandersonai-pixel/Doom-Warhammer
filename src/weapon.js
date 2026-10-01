// Оружие в руках: модель из коробок, стрельба, отдача, вспышка, патроны, перезарядка, удар.
// Оружие рисуется отдельной сценой поверх мира, чтобы не "проваливаться" в стены.
import * as THREE from 'three';
import { muzzleTexture } from './sprites.js';

export const MAG_SIZE = 24;    // патронов в магазине (запас — бесконечный)
const FIRE_DELAY = 0.13;       // секунд между выстрелами
const RELOAD_TIME = 1.4;
const MELEE_TIME = 0.45;       // длительность удара
const MELEE_HIT_AT = 0.12;     // в какой момент удара наносится урон

export class Weapon {
  // hooks: { onFire, onMelee, onReloadStart, onEmpty }
  constructor(hooks) {
    this.hooks = hooks;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

    // Свой свет для сцены оружия
    this.scene.add(new THREE.HemisphereLight(0xc8b8c8, 0x302020, 1.5));
    const dl = new THREE.DirectionalLight(0xffd0a0, 1.6);
    dl.position.set(-1, 2, 1);
    this.scene.add(dl);
    this.flashLight = new THREE.PointLight(0xffa040, 0, 3, 2);
    this.flashLight.position.set(0.25, -0.15, -1.1);
    this.scene.add(this.flashLight);

    this.buildModel();
    this.reset();
  }

  buildModel() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const metal = flat(0x2a2a30), metalL = flat(0x4a4a54);
    const casing = flat(0x6a1a16);               // тёмно-красный корпус
    const brass = flat(0xc09a40);
    const armor = flat(0x3a4a6a), armorL = flat(0x5a6e94); // бронированная перчатка
    const g = new THREE.Group();
    const add = (mat, sx, sy, sz, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
      return m;
    };
    // корпус — массивный, "квадратный", как у тяжёлого ретро-оружия
    add(metal, 0.2, 0.2, 0.62, 0, 0, 0);
    add(casing, 0.22, 0.09, 0.56, 0, 0.14, 0.0);
    add(brass, 0.23, 0.02, 0.56, 0, 0.1, 0.0);
    add(metalL, 0.06, 0.07, 0.3, 0, 0.21, -0.08);           // прицельная планка
    add(brass, 0.08, 0.04, 0.05, 0, 0.26, -0.2);
    // ствол с кожухом и прорезями
    add(metal, 0.15, 0.15, 0.42, 0, 0.02, -0.5);
    for (let i = 0; i < 3; i++) add(metalL, 0.16, 0.03, 0.06, 0, 0.09, -0.38 - i * 0.11);
    add(brass, 0.17, 0.17, 0.04, 0, 0.02, -0.3);
    add(brass, 0.17, 0.17, 0.04, 0, 0.02, -0.7);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 6), metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.02, -0.76);
    g.add(muzzle);
    // магазин, торчащий снизу, и рукоять
    add(metal, 0.12, 0.3, 0.16, 0, -0.22, -0.12, 0.12);
    add(brass, 0.125, 0.04, 0.165, 0, -0.33, -0.1, 0.12);
    add(metal, 0.1, 0.24, 0.12, 0, -0.18, 0.22, -0.3);
    // латные перчатки
    add(armor, 0.24, 0.18, 0.26, 0.02, -0.26, 0.3);
    add(armorL, 0.25, 0.05, 0.27, 0.02, -0.17, 0.3);
    add(armor, 0.26, 0.15, 0.22, -0.04, -0.11, -0.5);
    add(armorL, 0.27, 0.04, 0.23, -0.04, -0.04, -0.5);

    // Вспышка выстрела — пиксельная звезда
    const flashMat = new THREE.MeshBasicMaterial({
      map: muzzleTexture(), transparent: true, alphaTest: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), flashMat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), flashMat);
    p2.rotation.x = Math.PI / 2;
    p2.position.z = -0.25;
    this.flash.add(p1, p2);
    this.flash.position.set(0, 0.02, -0.86);
    g.add(this.flash);

    this.model = g;
    // ближе к центру экрана, как в классических шутерах
    this.basePos = new THREE.Vector3(0.12, -0.22, -0.5);
    g.scale.setScalar(0.6);
    g.position.copy(this.basePos);
    this.scene.add(g);
  }

  reset() {
    this.ammo = MAG_SIZE;
    this.cooldown = 0;
    this.reloadT = 0;   // >0 — идёт перезарядка
    this.meleeT = 0;    // >0 — идёт удар
    this.meleeDone = false;
    this.recoil = 0;
    this.flashT = 0;
    this.emptyClicked = false;
  }

  get reloading() { return this.reloadT > 0; }

  startReload() {
    if (this.reloadT > 0 || this.ammo === MAG_SIZE) return;
    this.reloadT = RELOAD_TIME;
    this.hooks.onReloadStart();
  }

  update(dt, input, player, time) {
    this.cooldown -= dt;

    // Перезарядка
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.ammo = MAG_SIZE; }
    }
    if (input.consumeReload()) this.startReload();

    // Удар в ближнем бою (прерывает перезарядку)
    if (input.consumeMelee() && this.meleeT <= 0) {
      this.meleeT = MELEE_TIME;
      this.meleeDone = false;
      this.reloadT = 0;
    }
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (!this.meleeDone && MELEE_TIME - this.meleeT >= MELEE_HIT_AT) {
        this.meleeDone = true;
        this.hooks.onMelee();
      }
    }

    // Стрельба (зажатая кнопка = автоматический огонь)
    if (input.fire && this.cooldown <= 0 && this.reloadT <= 0 && this.meleeT <= 0) {
      if (this.ammo > 0) {
        this.ammo--;
        this.cooldown = FIRE_DELAY;
        this.recoil = 1;
        this.flashT = 0.05;
        this.emptyClicked = false;
        this.hooks.onFire();
        if (this.ammo === 0) this.startReload(); // автоперезарядка
      } else if (!this.emptyClicked) {
        this.emptyClicked = true;
        this.hooks.onEmpty();
        this.startReload();
      }
    }

    this.animate(dt, player, time);
  }

  // Анимация модели: отдача, покачивание при ходьбе, перезарядка, удар
  animate(dt, player, time) {
    this.recoil *= Math.exp(-14 * dt);
    this.flashT -= dt;
    const m = this.model;
    const bob = player.speed01;
    m.position.set(
      this.basePos.x + Math.cos(player.bob) * 0.012 * bob,
      this.basePos.y + Math.abs(Math.sin(player.bob)) * 0.014 * bob + Math.sin(time * 1.6) * 0.003,
      this.basePos.z + this.recoil * 0.11
    );
    m.rotation.set(this.recoil * 0.22, 0, 0);

    if (this.reloadT > 0) {
      // ствол уходит вниз и поворачивается, затем возвращается
      const p = 1 - this.reloadT / RELOAD_TIME;
      const a = Math.sin(p * Math.PI);
      m.rotation.x -= a * 0.6;
      m.rotation.z = a * 0.5;
      m.position.y -= a * 0.12;
    }
    if (this.meleeT > 0) {
      // резкий выпад вперёд-влево прикладом
      const p = 1 - this.meleeT / MELEE_TIME;
      const a = Math.sin(Math.min(1, p * 1.6) * Math.PI);
      m.position.x -= a * 0.22;
      m.position.z -= a * 0.25;
      m.rotation.y = a * 0.9;
      m.rotation.z = -a * 0.4;
    }

    // Вспышка
    const on = this.flashT > 0;
    this.flash.visible = on;
    this.flashLight.intensity = on ? 4 : 0;
    if (on) {
      this.flash.rotation.z = Math.floor(Math.random() * 4) * Math.PI / 4;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scale.set(s, s, s);
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
