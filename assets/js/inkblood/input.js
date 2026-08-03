/* ============================================================
   INKBLOOD — input.js
   Movement is the only verb, so this stays small: WASD/arrows, a
   gamepad stick, and an invisible floating thumbstick on touch.
   ============================================================ */

"use strict";

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.x = 0;
    this.y = 0;
    this.touchId = null;
    this.touchOrigin = [0, 0];
    this.touchNow = [0, 0];
    this.touchActive = false;
    this.pausePressed = false;
    this.anyPressed = false;
    // Edge-triggered key queue for menus. Polling `keys` once a frame
    // misses a quick tap entirely: press and release both land inside
    // one frame and the key is already gone by the time anything
    // looks at it. Capped so it cannot grow during normal play.
    this.pressQueue = [];
    this.bind();
  }

  bind() {
    const down = (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      this.anyPressed = true;
      this.pressQueue.push(k);
      if (this.pressQueue.length > 12) this.pressQueue.shift();
      if (k === "p" || k === "escape") this.pausePressed = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d"].includes(k)) {
        e.preventDefault();
      }
    };
    const up = (e) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    this._down = down;
    this._up = up;

    const el = this.target;
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      if (this.touchId !== null) return;
      this.touchId = e.pointerId;
      this.touchActive = true;
      this.touchOrigin = [e.clientX, e.clientY];
      this.touchNow = [e.clientX, e.clientY];
      this.anyPressed = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.touchId) return;
      this.touchNow = [e.clientX, e.clientY];
    });
    const end = (e) => {
      if (e.pointerId !== this.touchId) return;
      this.touchId = null;
      this.touchActive = false;
      this.x = 0; this.y = 0;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  /** Resolve all sources into a single unit-ish vector. */
  update() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("arrowleft") || k.has("a")) x -= 1;
    if (k.has("arrowright") || k.has("d")) x += 1;
    if (k.has("arrowup") || k.has("w")) y -= 1;
    if (k.has("arrowdown") || k.has("s")) y += 1;

    if (this.touchActive) {
      const dx = this.touchNow[0] - this.touchOrigin[0];
      const dy = this.touchNow[1] - this.touchOrigin[1];
      const d = Math.hypot(dx, dy);
      const DEAD = 14;
      const MAXR = 78;
      if (d > DEAD) {
        const s = Math.min(1, (d - DEAD) / (MAXR - DEAD)) / d;
        x += dx * s;
        y += dy * s;
      }
    }

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y += ay;
      if (p.buttons[9] && p.buttons[9].pressed) this.pausePressed = true;
      if (p.buttons[0] && p.buttons[0].pressed) this.anyPressed = true;
      // D-pad
      if (p.buttons[14] && p.buttons[14].pressed) x -= 1;
      if (p.buttons[15] && p.buttons[15].pressed) x += 1;
      if (p.buttons[12] && p.buttons[12].pressed) y -= 1;
      if (p.buttons[13] && p.buttons[13].pressed) y += 1;
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.x = x;
    this.y = y;
  }

  consumePause() {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }

  /** Drain the edge-triggered key presses since the last call. */
  takePressed() {
    const q = this.pressQueue;
    this.pressQueue = [];
    return q;
  }

  consumeAny() {
    const p = this.anyPressed;
    this.anyPressed = false;
    return p;
  }

  /** Screen-space thumbstick, for drawing the touch ring. */
  stickInfo() {
    if (!this.touchActive) return null;
    return { ox: this.touchOrigin[0], oy: this.touchOrigin[1], nx: this.touchNow[0], ny: this.touchNow[1] };
  }

  dispose() {
    window.removeEventListener("keydown", this._down);
    window.removeEventListener("keyup", this._up);
  }
}
