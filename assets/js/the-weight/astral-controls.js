// =============================================================
// astral-controls.js — Phase 2 free first-person controller
//
// Full WASD + mouse look (pointer lock, with an absolute-position
// fallback). Movement is intentionally floaty: momentum builds and
// coasts as if you weigh nothing. Horizontal motion is collided
// against the scene's wall AABBs; eye height floats with a soft bob.
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

const EYE = 1.62;

TW.AstralControls = class AstralControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom        pointer-lock target (the canvas)
   * @param {object} world          must expose resolve(vec, radius)
   */
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;

    this.position = new THREE.Vector3(0, EYE, 11);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;     // 0 = facing -z
    this.pitch = 0;
    this.radius = 0.38;

    this.enabled = false;
    this.locked = document.pointerLockElement === dom;
    this.shake = 0;
    this._keys = Object.create(null);
    this._clock = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // tuning
    this.accel = 42;        // m/s^2 toward input
    this.maxSpeed = 4.7;
    this.damping = 4.2;     // lower = floatier coast
    this.sensitivity = 0.0022;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChangeEv = this._onLockChangeEv.bind(this);
    this._onKeyDown = (e) => this._setKey(e, true);
    this._onKeyUp = (e) => this._setKey(e, false);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChangeEv);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    this._apply(0);
  }

  setPosition(v) { this.position.set(v.x, EYE, v.z); this.velocity.set(0, 0, 0); }

  requestLock() {
    if (!this.dom.requestPointerLock) return;
    try {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  _onLockChangeEv() {
    this.locked = document.pointerLockElement === this.dom;
    if (this.onLockChange) this.onLockChange(this.locked);
  }

  _setKey(e, down) {
    const c = e.code;
    if (c === 'KeyW' || c === 'ArrowUp') this._keys.f = down;
    else if (c === 'KeyS' || c === 'ArrowDown') this._keys.b = down;
    else if (c === 'KeyA' || c === 'ArrowLeft') this._keys.l = down;
    else if (c === 'KeyD' || c === 'ArrowRight') this._keys.r = down;
    else return;
    if (this.enabled && (c.startsWith('Arrow'))) e.preventDefault();
  }

  _onMouseMove(e) {
    if (!this.enabled) return;
    if (this.locked) {
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
    } else {
      // fallback: cursor position aims the view
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      this.yaw = -nx * Math.PI;          // full turn across the screen
      this.pitch = -ny * 1.2;
    }
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  }

  update(dt) {
    this._clock += dt;

    // ---- desired move direction in world space (horizontal) ----
    let ix = 0, iz = 0;
    if (this._keys.f) iz -= 1;
    if (this._keys.b) iz += 1;
    if (this._keys.l) ix -= 1;
    if (this._keys.r) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 0 && this.enabled) {
      ix /= len; iz /= len;
      // camera forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw).
      // move = forward*(-iz) + right*ix  (W => iz=-1 => +forward)
      const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
      const wx = ix * cos + iz * sin;
      const wz = iz * cos - ix * sin;
      this.velocity.x += wx * this.accel * dt;
      this.velocity.z += wz * this.accel * dt;
    }

    // floaty damping (exponential)
    const d = Math.exp(-this.damping * dt);
    this.velocity.x *= d;
    this.velocity.z *= d;

    // clamp speed
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (sp > this.maxSpeed) {
      const k = this.maxSpeed / sp;
      this.velocity.x *= k; this.velocity.z *= k;
    }

    // integrate + collide (resolve per-axis so we slide along walls)
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    if (this.world && this.world.resolve) this.world.resolve(this.position, this.radius);

    this._apply(dt);
  }

  _apply(dt) {
    const bob = Math.sin(this._clock * 2.1) * 0.025 + Math.sin(this._clock * 0.8) * 0.04;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sr = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;

    this.camera.position.set(this.position.x + sx, this.position.y + bob + sy, this.position.z);
    this._euler.set(this.pitch, this.yaw, sr, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChangeEv);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }
};
})();
