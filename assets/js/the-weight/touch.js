// =============================================================
// touch.js — mobile / touch input
//
// Splits the screen into a left "move" zone (a floating virtual joystick,
// phase 2 only) and a "look" zone (drag to turn). Multi-touch aware:
// one finger drives movement, another drives the look. Blink and pause
// are separate on-screen buttons wired in main.js.
// =============================================================

(function () {
window.TW = window.TW || {};

TW.Touch = class Touch {
  constructor(layer, joyBase, joyThumb) {
    this.layer = layer;
    this.joyBase = joyBase;
    this.joyThumb = joyThumb;
    this.enabled = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this.moveEnabled = false;            // joystick only matters in phase 2
    this.move = { x: 0, y: 0 };          // -1..1; y<0 = forward
    this.onLook = null;                  // (dx, dy) callback in px

    this._moveId = null;
    this._lookId = null;
    this._moveOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._radius = 56;                   // joystick travel in px

    if (this.enabled && layer) {
      const opt = { passive: false };
      layer.addEventListener('touchstart', (e) => this._start(e), opt);
      layer.addEventListener('touchmove', (e) => this._move(e), opt);
      layer.addEventListener('touchend', (e) => this._end(e), opt);
      layer.addEventListener('touchcancel', (e) => this._end(e), opt);
    }
  }

  _start(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const leftZone = t.clientX < window.innerWidth * 0.5;
      if (this.moveEnabled && leftZone && this._moveId === null) {
        this._moveId = t.identifier;
        this._moveOrigin.x = t.clientX; this._moveOrigin.y = t.clientY;
        this._showJoy();
      } else if (this._lookId === null) {
        this._lookId = t.identifier;
        this._lookLast.x = t.clientX; this._lookLast.y = t.clientY;
      }
    }
  }

  _move(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this._moveId) {
        let dx = t.clientX - this._moveOrigin.x;
        let dy = t.clientY - this._moveOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > this._radius) { dx *= this._radius / len; dy *= this._radius / len; }
        this.move.x = dx / this._radius;
        this.move.y = dy / this._radius;
        this._moveThumb(dx, dy);
      } else if (t.identifier === this._lookId) {
        const dx = t.clientX - this._lookLast.x;
        const dy = t.clientY - this._lookLast.y;
        this._lookLast.x = t.clientX; this._lookLast.y = t.clientY;
        if (this.onLook) this.onLook(dx, dy);
      }
    }
  }

  _end(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this._moveId) {
        this._moveId = null; this.move.x = 0; this.move.y = 0; this._hideJoy();
      } else if (t.identifier === this._lookId) {
        this._lookId = null;
      }
    }
  }

  reset() {
    this._moveId = null; this._lookId = null;
    this.move.x = 0; this.move.y = 0; this._hideJoy();
  }

  _showJoy() {
    if (!this.joyBase) return;
    this.joyBase.style.display = 'block';
    this.joyBase.style.left = this._moveOrigin.x + 'px';
    this.joyBase.style.top = this._moveOrigin.y + 'px';
    this._moveThumb(0, 0);
  }
  _moveThumb(dx, dy) {
    if (!this.joyThumb) return;
    this.joyThumb.style.display = 'block';
    this.joyThumb.style.left = (this._moveOrigin.x + dx) + 'px';
    this.joyThumb.style.top = (this._moveOrigin.y + dy) + 'px';
  }
  _hideJoy() {
    if (this.joyBase) this.joyBase.style.display = 'none';
    if (this.joyThumb) this.joyThumb.style.display = 'none';
  }
};
})();
