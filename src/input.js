// Управление: клавиатура + мышь (десктоп) и виртуальный стик + кнопки (телефон).
// Наружу отдаём простые значения: движение, поворот камеры, огонь, удар, перезарядка.

const STICK_RADIUS = 55;   // радиус хода стика в пикселях
const MOUSE_SENS = 0.0022; // радиан на пиксель мыши
const TOUCH_SENS = 0.006;  // радиан на пиксель свайпа

export class Input {
  constructor(isTouch) {
    this.isTouch = isTouch;
    this.keys = new Set();
    this.lookX = 0; this.lookY = 0;   // накопленный поворот за кадр
    this.mouseFire = false;
    this.touchFire = false;
    this.meleeQueued = false;
    this.reloadQueued = false;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = null;            // { id, x, y } — палец, вращающий камеру
    this.fireTouch = null;            // палец на кнопке "Огонь" (тоже может вращать камеру)

    // --- Клавиатура: используем e.code, чтобы работало и в русской раскладке ---
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.meleeQueued = true;
      if (e.code === 'KeyR') this.reloadQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());

    // --- Мышь (работает при захвате курсора pointer lock) ---
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      // Chrome иногда присылает "прыжок" на сотни пикселей сразу после захвата курсора — игнорируем
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      this.lookX += e.movementX * MOUSE_SENS;
      this.lookY += e.movementY * MOUSE_SENS;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.meleeQueued = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    if (isTouch) this.setupTouch();
  }

  setupTouch() {
    const layer = document.getElementById('touch');
    this.stickBase = document.getElementById('stickBase');
    this.stickKnob = document.getElementById('stickKnob');
    this.btnFire = document.getElementById('btnFire');
    const opts = { passive: false };
    layer.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    layer.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    layer.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    layer.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
    // Запрещаем системный зум жестами в iOS Safari
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const id = t.target && t.target.id;
      if (id === 'btnFire') {
        this.touchFire = true;
        this.fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        this.btnFire.classList.add('active');
      } else if (id === 'btnMelee') {
        this.meleeQueued = true;
        flash(t.target);
      } else if (id === 'btnReload') {
        this.reloadQueued = true;
        flash(t.target);
      } else if (t.clientX < window.innerWidth * 0.5 && this.stick.id === null) {
        // Левая половина — стик появляется там, где коснулись
        Object.assign(this.stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        this.stickBase.style.left = t.clientX + 'px';
        this.stickBase.style.top = t.clientY + 'px';
        this.stickBase.style.bottom = 'auto';
        this.stickBase.classList.add('active');
        this.stickKnob.style.transform = 'translate(0px, 0px)';
      } else if (t.clientX >= window.innerWidth * 0.5 && this.lookTouch === null) {
        // Правая половина — поворот камеры
        this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }

  onTouchMove(e) {
    e.preventDefault();
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
          this.lookX += (t.clientX - lt.x) * TOUCH_SENS;
          this.lookY += (t.clientY - lt.y) * TOUCH_SENS;
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
        this.fireTouch = null;
        this.touchFire = false;
        this.btnFire.classList.remove('active');
      }
    }
  }

  releaseStick() {
    Object.assign(this.stick, { id: null, x: 0, y: 0 });
    if (!this.stickBase) return;
    this.stickBase.classList.remove('active');
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.stickBase.style.bottom = '';
    this.stickKnob.style.transform = 'translate(0px, 0px)';
  }

  // Направление движения: x — вправо, z — вперёд (от -1 до 1)
  getMove() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.stick.id !== null && Math.hypot(this.stick.x, this.stick.y) > 0.12) {
      x += this.stick.x;
      z -= this.stick.y;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  get fire() { return this.mouseFire || this.touchFire; }

  consumeLook() {
    const l = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return l;
  }
  consumeMelee() { const v = this.meleeQueued; this.meleeQueued = false; return v; }
  consumeReload() { const v = this.reloadQueued; this.reloadQueued = false; return v; }

  // Сброс всех нажатий (при паузе, потере фокуса, рестарте)
  reset() {
    this.keys.clear();
    this.mouseFire = this.touchFire = false;
    this.meleeQueued = this.reloadQueued = false;
    this.lookX = this.lookY = 0;
    this.lookTouch = this.fireTouch = null;
    if (this.btnFire) this.btnFire.classList.remove('active');
    this.releaseStick();
  }
}

// Короткая подсветка кнопки при нажатии
function flash(el) {
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 120);
}
