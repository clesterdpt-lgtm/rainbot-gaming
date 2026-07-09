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
    this.moveInput = null;       // {x,y} from a touch joystick (y<0 = forward)
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
      // fallback without pointer lock: relative deltas still steer the view
      // (movementX/Y exist unlocked too), and update() keeps turning while
      // the cursor rides the edge of the window — so a full 360° is always
      // possible even though the cursor can leave the game
      this.yaw -= (e.movementX || 0) * this.sensitivity * 1.4;
      this.pitch -= (e.movementY || 0) * this.sensitivity * 1.4;
      this._cursorX = e.clientX / window.innerWidth;
      this._cursorY = e.clientY / window.innerHeight;
    }
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  }

  /** relative look from a touch drag (px) */
  applyLookDelta(dx, dy) {
    if (!this.enabled) return;
    const s = this.sensitivity * 1.7;
    this.yaw -= dx * s;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * s));
  }

  update(dt) {
    this._clock += dt;

    // unlocked fallback: cursor parked in the outer band of the window keeps
    // the view turning at a rate that grows toward the edge
    if (!this.locked && this.enabled && this._cursorX !== undefined) {
      const band = 0.14, rate = 2.4;
      if (this._cursorX < band) {
        this.yaw += (1 - this._cursorX / band) * rate * dt;
      } else if (this._cursorX > 1 - band) {
        this.yaw -= (1 - (1 - this._cursorX) / band) * rate * dt;
      }
      if (this._cursorY < band) {
        this.pitch = Math.min(1.4, this.pitch + (1 - this._cursorY / band) * 1.1 * dt);
      } else if (this._cursorY > 1 - band) {
        this.pitch = Math.max(-1.4, this.pitch - (1 - (1 - this._cursorY) / band) * 1.1 * dt);
      }
    }

    // ---- desired move direction (touch joystick is analog; keys are unit) ----
    let ix = 0, iz = 0, analog = false;
    const mv = this.moveInput;
    if (mv && (Math.abs(mv.x) > 0.12 || Math.abs(mv.y) > 0.12)) {
      ix = mv.x; iz = mv.y; analog = true;
    } else {
      if (this._keys.f) iz -= 1;
      if (this._keys.b) iz += 1;
      if (this._keys.l) ix -= 1;
      if (this._keys.r) ix += 1;
    }
    let len = Math.hypot(ix, iz);
    if (len > 0 && this.enabled) {
      if (!analog) { ix /= len; iz /= len; }            // keyboard = full tilt
      else if (len > 1) { ix /= len; iz /= len; }        // clamp joystick to 1
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
