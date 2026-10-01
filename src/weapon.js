// Оружие в руках: модель из коробок, стрельба, отдача, вспышка, патроны, перезарядка, удар.
// Оружие рисуется отдельной сценой поверх мира, чтобы не "проваливаться" в стены.
import * as THREE from 'three';

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
    this.scene.add(new THREE.HemisphereLight(0xc8b0a0, 0x302020, 1.6));
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
    const metal = new THREE.MeshLambertMaterial({ color: 0x2c2c32 });
    const casing = new THREE.MeshLambertMaterial({ color: 0x5c1c18 }); // тёмно-красный корпус
    const brass = new THREE.MeshLambertMaterial({ color: 0xa07a38 });
    const armor = new THREE.MeshLambertMaterial({ color: 0x34363e });
    const g = new THREE.Group();
    const add = (mat, sx, sy, sz, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
      return m;
    };
    add(metal, 0.15, 0.17, 0.5, 0, 0, 0);              // ствольная коробка
    add(casing, 0.17, 0.07, 0.44, 0, 0.11, -0.02);     // верхний кожух
    add(metal, 0.11, 0.11, 0.36, 0, 0.02, -0.4);       // кожух ствола
    add(brass, 0.12, 0.02, 0.38, 0, 0.085, -0.4);      // латунная полоса
    add(brass, 0.175, 0.03, 0.03, 0, 0.0, 0.2);        // латунные кольца
    add(brass, 0.175, 0.03, 0.03, 0, 0.0, -0.2);
    add(metal, 0.04, 0.06, 0.06, 0, 0.17, -0.12);      // прицел
    add(metal, 0.09, 0.24, 0.13, 0, -0.18, -0.06, 0.15); // магазин
    add(metal, 0.08, 0.2, 0.09, 0, -0.15, 0.18, -0.35);  // рукоять
    add(armor, 0.17, 0.14, 0.2, 0.01, -0.2, 0.24);     // бронированная перчатка
    add(armor, 0.2, 0.12, 0.18, -0.06, -0.08, -0.36);  // вторая рука под стволом
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8), metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.02, -0.63);
    g.add(muzzle);

    // Вспышка выстрела: три скрещённые плоскости со светящейся текстурой
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const cg = c.getContext('2d');
    const grad = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.3, 'rgba(255,180,60,0.9)');
    grad.addColorStop(1, 'rgba(255,80,0,0)');
    cg.fillStyle = grad;
    cg.fillRect(0, 0, 64, 64);
    const flashMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const plane = new THREE.PlaneGeometry(0.5, 0.5);
    const p1 = new THREE.Mesh(plane, flashMat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.9), flashMat);
    p2.rotation.x = Math.PI / 2;
    const p3 = p2.clone();
    p3.rotation.z = Math.PI / 2;
    p2.position.z = p3.position.z = -0.3;
    this.flash.add(p1, p2, p3);
    this.flash.position.set(0, 0.02, -0.72);
    g.add(this.flash);

    this.model = g;
    this.basePos = new THREE.Vector3(0.21, -0.2, -0.46);
    g.scale.setScalar(0.56);
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
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scale.set(s, s, s);
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
