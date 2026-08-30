// =============================================================
// controls.js — Phase 1 "stiff neck" pointer-lock camera
//
// The player is paralysed. They can only roll their eyes / turn
// their head a little: the look is heavily clamped, low-sensitivity,
// and lags behind the mouse (smoothed) to sell a stiff, leaden neck.
// A slow breathing bob rides on top so the body always feels alive.
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

TW.ClampedLook = class ClampedLook {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement  element used for pointer-lock
   * @param {object} cfg              CONFIG.camera + CONFIG.look + CONFIG.breath
   */
  constructor(camera, domElement, cfg) {
    this.camera = camera;
    this.dom = domElement;
    this.look = cfg.look;
    this.breath = cfg.breath;

    this.basePos = new THREE.Vector3(cfg.camera.pos.x, cfg.camera.pos.y, cfg.camera.pos.z);
    this.basePitch = cfg.camera.basePitch;

    // target (where the head wants to be) vs current (where it actually is)
    this.tYaw = 0;   this.tPitch = 0;
    this.yaw = 0;    this.pitch = 0;

    this.locked = false;
    this.enabled = false;        // only steer while in the paralysis phase
    this.shake = 0;              // entity-proximity / jumpscare screen shake
    this._clock = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // a small involuntary tremor target, so even a "still" head drifts faintly
    this._tremor = 0;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChange = this._onLockChange.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);

    this.apply(0); // place the camera at its resting pose immediately
  }

  /** Request pointer lock (must be called synchronously from a user gesture). */
  requestLock() {
    if (!this.dom.requestPointerLock) return;
    try {
      const p = this.dom.requestPointerLock();
      // newer browsers return a promise that rejects if activation was lost
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* ignore — the absolute-position fallback covers this */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.dom;
    if (this.onLockChange) this.onLockChange(this.locked);
  }

  _onMouseMove(e) {
    if (!this.enabled) return;

    if (this.locked) {
      // ---- pointer lock: relative movement with edge resistance ----
      const s = this.look.sensitivity;
      const yawDelta = -e.movementX * s;
      const pitchDelta = -e.movementY * s;
      const yawResist = edgeResistance(
        this.tYaw, yawDelta, this.look.yawClamp, this.look.yawClamp, this.look.edgeResist,
      );
      const pitchResist = edgeResistance(
        this.tPitch, pitchDelta, this.look.pitchDown, this.look.pitchUp, this.look.edgeResist,
      );

      this.tYaw += yawDelta * yawResist;
      this.tPitch += pitchDelta * pitchResist;
    } else {
      // ---- fallback when pointer lock is unavailable / not yet granted:
      // the cursor's position on screen drives where the eyes strain to. ----
      const nx = (e.clientX / window.innerWidth) * 2 - 1;   // -1 (left) .. 1 (right)
      const ny = (e.clientY / window.innerHeight) * 2 - 1;  // -1 (up)   .. 1 (down)
      this.tYaw = -nx * this.look.yawClamp;
      this.tPitch = -ny * (ny > 0 ? this.look.pitchDown : this.look.pitchUp);
    }

    // hard clamps — cannot look behind, cannot sit up
    this.tYaw = clamp(this.tYaw, -this.look.yawClamp, this.look.yawClamp);
    this.tPitch = clamp(this.tPitch, -this.look.pitchDown, this.look.pitchUp);
  }

  /** Nudge the head (used by anomalies / forced glances later). */
  forceGaze(yaw, pitch) {
    this.tYaw = clamp(yaw, -this.look.yawClamp, this.look.yawClamp);
    this.tPitch = clamp(pitch, -this.look.pitchDown, this.look.pitchUp);
  }

  resetGaze() {
    this.tYaw = this.yaw = 0;
    this.tPitch = this.pitch = 0;
    this._tremor = 0;
    this.apply(0);
  }

  /** apply a relative look from a touch drag (px), same clamps as the mouse */
  applyLookDelta(dx, dy) {
    if (!this.enabled) return;
    const s = 0.0052;   // per-pixel; a short drag covers the stiff-neck range
    const yawDelta = -dx * s;
    const pitchDelta = -dy * s;
    const yawResist = edgeResistance(
      this.tYaw, yawDelta, this.look.yawClamp, this.look.yawClamp, this.look.edgeResist,
    );
    const pitchResist = edgeResistance(
      this.tPitch, pitchDelta, this.look.pitchDown, this.look.pitchUp, this.look.edgeResist,
    );
    this.tYaw = clamp(this.tYaw + yawDelta * yawResist, -this.look.yawClamp, this.look.yawClamp);
    this.tPitch = clamp(this.tPitch + pitchDelta * pitchResist, -this.look.pitchDown, this.look.pitchUp);
  }

  update(dt) {
    this._clock += dt;
    this.apply(dt);
  }

  apply(dt) {
    // stiff-neck smoothing: head crawls toward where the eyes want to look
    const k = 1 - Math.exp(-this.look.smoothing * dt);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;

    // slow, heavy breathing rides on top of everything
    const b = this.breath;
    const phase = this._clock * Math.PI * 2 * b.rate;
    const bobY = Math.sin(phase) * b.bobY;
    const roll = Math.sin(phase * 0.5) * b.roll;
    const breathPitch = Math.sin(phase + 0.6) * b.pitch;

    // faint involuntary tremor (re-rolled slowly)
    this._tremor += (Math.random() - 0.5) * dt * 0.04;
    this._tremor *= 0.96;

    // entity-proximity / jumpscare shake
    const sh = this.shake;
    const shakeRoll = sh > 0 ? (Math.random() - 0.5) * sh * 0.6 : 0;
    const sx = sh > 0 ? (Math.random() - 0.5) * sh : 0;
    const sy = sh > 0 ? (Math.random() - 0.5) * sh : 0;

    this._euler.set(
      this.basePitch + this.pitch + breathPitch,
      this.yaw + this._tremor * 0.4,
      roll + this._tremor + shakeRoll,
      'YXZ',
    );
    this.camera.quaternion.setFromEuler(this._euler);
    this.camera.position.set(this.basePos.x + sx, this.basePos.y + bobY + sy, this.basePos.z);
  }

  /** current breathing phase 0..1 — lets the blanket rise/fall in sync */
  get breathPhase() {
    return (Math.sin(this._clock * Math.PI * 2 * this.breath.rate) + 1) * 0.5;
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Only resist motion that pushes farther toward the edge currently occupied.
// Reversing direction always receives full input, so a clamp can never trap
// the camera. negLimit/posLimit support Phase 1's asymmetric pitch range.
function edgeResistance(value, delta, negLimit, posLimit, amount) {
  if (value === 0 || value * delta <= 0) return 1;
  const limit = value < 0 ? negLimit : posLimit;
  const norm = clamp(Math.abs(value) / limit, 0, 1);
  return Math.max(0.05, 1 - Math.pow(norm, 3) * amount);
}
})();
