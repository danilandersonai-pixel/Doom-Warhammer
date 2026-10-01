// Управление: клавиатура + мышь, сенсорный экран (стик + свайп + кнопки), геймпад, гироскоп.
// Наружу — простые значения: движение, поворот, нажатия ("pressed" срабатывают один раз).

const STICK_RADIUS = 50;
const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.0042;   // умеренная по умолчанию
const PAD_SENS = 2.6;        // рад/с при полном отклонении стика

export class Input {
  constructor(isTouch, settings) {
    this.isTouch = isTouch;
    this.settings = settings;   // { sens, gyro }
    this.keys = new Set();
    this.lookX = 0; this.lookY = 0;
    this.mouseFire = false; this.touchFire = false; this.padFire = false;
    this.pressed = new Set();   // одноразовые нажатия: jump, dash, grenade, reload, swap, melee, pause, w1..w5, next, prev
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = null;
    this.fireTouch = null;
    this.pad = { x: 0, z: 0, lx: 0, ly: 0, prev: {} };
    this.gyroLast = null;

    const keyMap = { Space: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyG: 'grenade', KeyR: 'reload', KeyF: 'melee', KeyQ: 'swap', Escape: 'pause', KeyP: 'pause',
      Digit1: 'w1', Digit2: 'w2', Digit3: 'w3', Digit4: 'w4', Digit5: 'w5' };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (keyMap[e.code]) this.pressed.add(keyMap[e.code]);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      // Chrome иногда присылает "прыжок" сразу после захвата курсора — отбрасываем
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      const s = MOUSE_SENS * this.settings.sens;
      this.lookX += e.movementX * s;
      this.lookY += e.movementY * s;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.isTouch || !document.pointerLockElement) return;
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.pressed.add('melee');
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    document.addEventListener('wheel', (e) => { if (document.pointerLockElement) this.pressed.add(e.deltaY > 0 ? 'next' : 'prev'); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    if (isTouch) this.setupTouch();
    window.addEventListener('deviceorientation', (e) => this.onGyro(e));
  }

  // ---------- Сенсорный экран ----------
  setupTouch() {
    const layer = document.getElementById('touch');
    this.stickBase = document.getElementById('stickBase');
    this.stickKnob = document.getElementById('stickKnob');
    const opts = { passive: false };
    layer.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    layer.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    layer.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    layer.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const btn = t.target.closest && t.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        btn.classList.add('active');
        if (act === 'fire') { this.touchFire = true; this.fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY, el: btn }; }
        else { this.pressed.add(act); setTimeout(() => btn.classList.remove('active'), 140); }
        continue;
      }
      if (t.clientX < window.innerWidth * 0.45 && this.stick.id === null) {
        Object.assign(this.stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        this.stickBase.style.left = t.clientX + 'px';
        this.stickBase.style.top = t.clientY + 'px';
        this.stickBase.classList.add('active');
        this.stickKnob.style.transform = 'translate(0px, 0px)';
      } else if (this.lookTouch === null) {
        this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    const s = TOUCH_SENS * this.settings.sens;
    for (const t of e.changedTouches) {
      if (t.identifier === this.stick.id) {
        let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        this.stick.x = dx / STICK_RADIUS;
        this.stick.y = dy / STICK_RADIUS;
        this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      for (const lt of [this.lookTouch, this.fireTouch]) {
        if (lt && t.identifier === lt.id) {
          this.lookX += (t.clientX - lt.x) * s;
          this.lookY += (t.clientY - lt.y) * s;
          lt.x = t.clientX; lt.y = t.clientY;
        }
      }
    }
  }

  onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stick.id) this.releaseStick();
      if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      if (this.fireTouch && t.identifier === this.fireTouch.id) {
        this.fireTouch.el.classList.remove('active');
        this.fireTouch = null;
        this.touchFire = false;
      }
    }
  }

  releaseStick() {
    Object.assign(this.stick, { id: null, x: 0, y: 0 });
    if (!this.stickBase) return;
    this.stickBase.classList.remove('active');
    this.stickBase.style.left = this.stickBase.style.top = '';
    this.stickKnob.style.transform = 'translate(0px, 0px)';
  }

  // ---------- Гироскоп (по желанию, включается в настройках) ----------
  async enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission(); // iOS спрашивает разрешение
        return r === 'granted';
      }
      return true;
    } catch { return false; }
  }

  onGyro(e) {
    if (!this.settings.gyro || e.alpha == null) { this.gyroLast = null; return; }
    // в альбомной ориентации: поворот вокруг вертикали ~ beta, наклон ~ gamma
    const cur = { a: e.beta, b: e.gamma };
    if (this.gyroLast) {
      const da = cur.a - this.gyroLast.a, db = cur.b - this.gyroLast.b;
      if (Math.abs(da) < 20 && Math.abs(db) < 20) {
        const k = 0.017 * this.settings.sens;
        this.lookX += da * k;
        this.lookY -= db * k * 0.7;
      }
    }
    this.gyroLast = cur;
  }

  // ---------- Геймпад (стандартная раскладка) ----------
  pollGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) { this.padFire = false; this.pad.x = this.pad.z = 0; return; }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    this.pad.x = dz(gp.axes[0]);
    this.pad.z = -dz(gp.axes[1]);
    const k = PAD_SENS * this.settings.sens * dt;
    this.lookX += dz(gp.axes[2]) * k;
    this.lookY += dz(gp.axes[3]) * k;
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    this.padFire = b(7);
    const map = { 0: 'jump', 1: 'dash', 2: 'reload', 3: 'swap', 4: 'melee', 5: 'grenade', 9: 'pause' };
    for (const [i, act] of Object.entries(map)) {
      const now = b(+i);
      if (now && !this.pad.prev[i]) this.pressed.add(act);
      this.pad.prev[i] = now;
    }
  }

  // Движение: x — вправо, z — вперёд
  getMove() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.stick.id !== null && Math.hypot(this.stick.x, this.stick.y) > 0.12) { x += this.stick.x; z -= this.stick.y; }
    x += this.pad.x; z += this.pad.z;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  get fire() { return this.mouseFire || this.touchFire || this.padFire; }
  take(act) { const v = this.pressed.has(act); this.pressed.delete(act); return v; }
  consumeLook() { const l = { x: this.lookX, y: this.lookY }; this.lookX = this.lookY = 0; return l; }

  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.mouseFire = this.touchFire = this.padFire = false;
    this.lookX = this.lookY = 0;
    this.lookTouch = null;
    if (this.fireTouch) this.fireTouch.el.classList.remove('active');
    this.fireTouch = null;
    this.releaseStick();
  }
}
