/* ============================================================
   APOP DEMON MOGGERS 3D - input

   Keyboard, mouse, gamepad and touch, unified into the one intent
   object CONTRACT.md §9 freezes. Nothing downstream ever asks "was
   that a key or a stick?", and nothing downstream does trigonometry
   on the camera to work out which way forward is.

   Three decisions in here are load-bearing for how the game feels:

   1. MOVEMENT LEAVES THIS MODULE ALREADY IN WORLD SPACE. `move.x` is
      world +X and `move.y` is world +Z, rotated out of stick space by
      the camera's ground heading. Doing it once here is the only way
      the rule stays true everywhere: in SM64 the stick means "go that
      way on screen", and a controller that resolves it per-consumer
      ends up with the player, the dive and the camera disagreeing
      about forward for one frame after every camera swing.

   2. JUMP IS BUFFERED (120ms) AND COYOTE-TIMED (100ms). Without both,
      the triple jump is not landable: the input window for the second
      and third hop is a handful of frames wide, and a press that
      arrives four frames before touchdown is the normal case, not the
      edge case. Both windows are measured in ctx.clock.t, not
      performance.now() - the screenshot harness steps the world
      faster than the wall clock and a buffer keyed to real time
      silently empties itself mid-pose.

   3. RADIAL CLAMP, NOT PER-AXIS CLAMP. Diagonals are normalised so a
      stick pushed into the corner is not 1.41x faster than one pushed
      straight ahead. The deadzone rescales what is left of the range
      instead of chopping it, so the stick still has fine control just
      outside the dead area rather than snapping to 82%.

   E does double duty, as the page's own control list says: tap for the
   Mog Beam, hold to swing the camera. The beam fires on key-down with
   no delay - a signature verb must never wait to find out whether the
   player meant something else - and the swing only starts once the key
   has been down longer than a tap.
   ============================================================ */

import { clamp } from "apop3d/core.js";

/** Key bindings are by KeyboardEvent.code, so they survive layouts. */
const DEFAULT_BINDS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  walk: ["AltLeft"],
  jump: ["Space"],
  crouch: ["ShiftLeft", "ShiftRight"],
  pound: ["ControlLeft", "ControlRight"],
  beam: ["KeyE"],
  aura: ["KeyF"],
  pause: ["Escape", "KeyP"],
  camLeft: ["KeyQ"],
  camRight: ["KeyE"],
  camReset: ["KeyR"],
  camIn: ["Equal", "NumpadAdd"],
  camOut: ["Minus", "NumpadSubtract"],
};

/** Bound codes whose browser default would fight the game. */
const SWALLOW = new Set([
  "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab",
  "Minus", "Equal", "KeyQ", "KeyE", "KeyF", "KeyR",
]);

const JUMP_BUFFER = 0.12;      // seconds, CONTRACT §9
const COYOTE_TIME = 0.10;      // seconds, CONTRACT §9
const SWING_HOLD = 0.18;       // held past this, Q/E swings instead of tapping
const SWING_RATE = 2.6;        // radians per second while swinging
const PAD_LOOK_RATE = 3.0;     // radians per second at full right stick
const AURA_HOLD = 0.45;        // touch: hold the special button this long for the aura
const WALK_BAND = 0.62;        // stick magnitude below this is a walk, not a run
const TOUCH_RADIUS = 58;       // px from the touch origin to full tilt

export function create(ctx) {
  const canvas = ctx.canvas;
  const bus = ctx.bus;
  const settings = ctx.settings || {};
  const prefs = settings.prefs || {};

  const binds = loadBinds();
  const codeToActions = new Map();
  rebuildBindMap();

  /* --------------------------- edge state --------------------------- */

  const downSet = new Set();
  const downAt = new Map();          // action -> ctx.clock.t when it went down
  let pendingPressed = new Set();
  let pendingReleased = new Set();
  let pressedSet = new Set();
  let releasedSet = new Set();

  /** A pending discrete camera swing from a Q/E tap. */
  let nudgeQueued = 0;

  let jumpPressedAt = -999;
  let jumpConsumedAt = -999;
  let lastGroundedAt = -999;
  let grounded = false;

  let lookAccumX = 0;
  let lookAccumY = 0;

  let syntheticMove = null;
  let lastYaw = Math.PI;
  let focused = false;

  const now = () => (ctx.clock ? ctx.clock.t : performance.now() / 1000);

  function press(action) {
    if (downSet.has(action)) return;
    downSet.add(action);
    downAt.set(action, now());
    pendingPressed.add(action);
    if (action === "jump") jumpPressedAt = now();
    bus.emit("input:press", action);
  }

  function release(action) {
    if (!downSet.has(action)) return;
    const heldFor = now() - (downAt.get(action) || 0);
    downSet.delete(action);
    pendingReleased.add(action);
    // A tap on a camera key is a discrete swing; a hold was a sweep and
    // already moved the camera, so it must not also snap it.
    if ((action === "camLeft" || action === "camRight") && heldFor < SWING_HOLD) {
      nudgeQueued = action === "camLeft" ? -1 : 1;
    }
    bus.emit("input:release", action);
  }

  /* ---------------------------- bindings ---------------------------- */

  function loadBinds() {
    const stored = prefs.binds && typeof prefs.binds === "object" ? prefs.binds : null;
    const out = {};
    for (const action of Object.keys(DEFAULT_BINDS)) {
      const custom = stored && Array.isArray(stored[action]) ? stored[action] : null;
      out[action] = custom && custom.length ? custom.slice() : DEFAULT_BINDS[action].slice();
    }
    return out;
  }

  function rebuildBindMap() {
    codeToActions.clear();
    for (const action of Object.keys(binds)) {
      for (const code of binds[action]) {
        if (!codeToActions.has(code)) codeToActions.set(code, []);
        codeToActions.get(code).push(action);
      }
    }
  }

  function persistBinds() {
    if (typeof settings.set === "function") settings.set("binds", binds);
  }

  /* --------------------------- stick shaping --------------------------- */

  /**
   * Deadzone plus radial clamp plus a gentle expo.
   *
   * The expo is what keeps a walk usable: a linear stick spends most of
   * its travel above running speed, so "creep to the edge of the
   * platform" is a five-degree band at the bottom of the throw.
   */
  function shape(x, y, out) {
    const dead = clamp(Number(prefs.deadzone) || 0.16, 0.02, 0.5);
    const mag = Math.hypot(x, y);
    if (mag <= dead) { out.x = 0; out.y = 0; out.mag = 0; return out; }
    const n = Math.min(1, (mag - dead) / (1 - dead));
    const shaped = n * n * 0.55 + n * 0.45;
    out.x = (x / mag) * shaped;
    out.y = (y / mag) * shaped;
    out.mag = shaped;
    return out;
  }

  /* ----------------------------- keyboard ----------------------------- */

  function onKeyDown(event) {
    if (event.repeat) return;
    const actions = codeToActions.get(event.code);
    if (!actions) return;
    if ((focused || locked()) && SWALLOW.has(event.code)) event.preventDefault();
    device = "kbm";
    for (const action of actions) press(action);
  }

  function onKeyUp(event) {
    const actions = codeToActions.get(event.code);
    if (!actions) return;
    for (const action of actions) release(action);
  }

  /** Losing focus with a key down is how a player ends up walking into
   *  a wall forever after an alt-tab. Drop everything. */
  function onBlur() {
    for (const action of Array.from(downSet)) release(action);
    syntheticMove = null;
    lookAccumX = 0;
    lookAccumY = 0;
    focused = false;
  }

  /* ------------------------------ mouse ------------------------------ */

  const locked = () => document.pointerLockElement === canvas;

  function requestLock() {
    if (settings.qa || settings.isTouch) return;
    if (!canvas || locked()) return;
    try {
      const p = canvas.requestPointerLock
        ? canvas.requestPointerLock({ unadjustedMovement: true })
        : null;
      // unadjustedMovement is rejected outright on platforms with no raw
      // input path. Retry plain or the mouse is never captured at all.
      if (p && typeof p.catch === "function") {
        p.catch(() => { try { canvas.requestPointerLock(); } catch (error) { /* no lock available */ } });
      }
    } catch (error) { /* no lock available */ }
  }

  function exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function onLockChange() {
    const on = locked();
    bus.emit("input:lock", on);
    if (!on) {
      for (const action of Array.from(downSet)) release(action);
      // Escape is the only way out of pointer lock and the browser eats
      // the keydown, so losing the lock IS the pause request.
      pendingPressed.add("pause");
    }
  }

  function onMouseMove(event) {
    if (!locked()) return;
    const sens = Number(prefs.sensitivity) || 0.0024;
    // Chrome delivers one enormous delta after a lock regain. Anything
    // past a screen of travel in a single event is a glitch, not a flick.
    const dx = clamp(event.movementX || 0, -900, 900);
    const dy = clamp(event.movementY || 0, -900, 900);
    lookAccumX += dx * sens;
    lookAccumY -= dy * sens * (prefs.invertY ? -1 : 1);
    device = "kbm";
  }

  function onMouseDown(event) {
    if (!locked()) { requestLock(); return; }
    if (event.button === 0) press("beam");
    if (event.button === 2) press("aura");
    if (event.button === 1) press("camReset");
    event.preventDefault();
  }

  function onMouseUp(event) {
    if (event.button === 0) release("beam");
    if (event.button === 2) release("aura");
    if (event.button === 1) release("camReset");
  }

  function onWheel(event) {
    if (!focused && !locked()) return;
    if (event.deltaY > 0) { press("camOut"); release("camOut"); }
    else if (event.deltaY < 0) { press("camIn"); release("camIn"); }
    event.preventDefault();
  }

  /* ----------------------------- gamepad ----------------------------- */

  const padStick = { x: 0, y: 0, mag: 0 };
  let padIndex = -1;
  let hasPad = false;
  let device = "kbm";

  function padButton(pad, i) { return Boolean(pad.buttons[i] && pad.buttons[i].pressed); }
  function padTrigger(pad, i) { return pad.buttons[i] ? pad.buttons[i].value : 0; }

  function pollGamepad(dt) {
    padStick.x = 0; padStick.y = 0; padStick.mag = 0;
    if (!navigator.getGamepads) { hasPad = false; return; }
    let pad = null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i += 1) {
      if (pads[i] && pads[i].connected) { pad = pads[i]; padIndex = i; break; }
    }
    hasPad = Boolean(pad);
    if (!pad) return;

    const raw = { x: pad.axes[0] || 0, y: -(pad.axes[1] || 0) };
    shape(raw.x, raw.y, padStick);

    // Dpad falls back to full tilt, so a dpad-only pad still plays.
    if (padStick.mag === 0) {
      let dx = 0; let dy = 0;
      if (padButton(pad, 12)) dy += 1;
      if (padButton(pad, 13)) dy -= 1;
      if (padButton(pad, 14)) dx -= 1;
      if (padButton(pad, 15)) dx += 1;
      if (dx || dy) {
        const m = Math.hypot(dx, dy);
        padStick.x = dx / m; padStick.y = dy / m; padStick.mag = 1;
      }
    }
    if (padStick.mag > 0) device = "pad";

    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    if (Math.abs(rx) + Math.abs(ry) > 0.14) {
      // Cubic response: precise near centre, fast at the rim. A linear
      // stick reads as either twitchy or sluggish and never as neither.
      const curve = (v) => v * v * v * 0.72 + v * 0.28;
      lookAccumX += curve(rx) * PAD_LOOK_RATE * dt;
      lookAccumY -= curve(ry) * PAD_LOOK_RATE * dt * (prefs.invertY ? -1 : 1);
      device = "pad";
    }

    const set = (action, on) => (on ? press(action) : release(action));
    set("jump", padButton(pad, 0));
    set("beam", padButton(pad, 1));
    set("aura", padButton(pad, 2));
    set("camReset", padButton(pad, 3) || padButton(pad, 11));
    set("camLeft", padButton(pad, 4));
    set("camRight", padButton(pad, 5));
    set("crouch", padTrigger(pad, 6) > 0.35);
    set("pound", padTrigger(pad, 7) > 0.35);
    set("camOut", padButton(pad, 8));
    set("camIn", padButton(pad, 10));
    set("pause", padButton(pad, 9));
  }

  function rumble(strong = 0.5, weak = 0.3, duration = 120) {
    if (settings.qa) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[padIndex];
    if (!pad || !pad.vibrationActuator) return;
    try {
      pad.vibrationActuator.playEffect("dual-rumble", {
        startDelay: 0, duration,
        strongMagnitude: clamp(strong, 0, 1),
        weakMagnitude: clamp(weak, 0, 1),
      }).catch(() => {});
    } catch (error) { /* older actuator api */ }
  }

  /* ------------------------------ touch ------------------------------ */

  /* Pointer events rather than touch events: each finger is its own
     pointerId, so moving the stick and hitting jump at the same instant
     are two independent streams. Touch events would work too, but the
     buttons are real <button> elements and pointer events give the same
     code path for a mouse in a desktop browser's device emulation. */

  const touchStick = { x: 0, y: 0, mag: 0 };
  const stickTouch = { id: null, ox: 0, oy: 0 };
  let specialDownAt = -999;
  let specialIsAura = false;
  let knob = null;

  function mountStick() {
    const el = document.getElementById("joystick");
    if (!el) return null;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    knob = document.createElement("div");
    knob.className = "ap-stick-knob";
    knob.style.cssText = [
      "position:absolute", "left:0", "top:0", "width:46px", "height:46px",
      "margin:-23px 0 0 -23px", "border-radius:50%", "opacity:0",
      "background:rgba(255,255,255,0.16)", "border:2px solid rgba(255,255,255,0.35)",
      "pointer-events:none", "transition:opacity 0.12s",
    ].join(";");
    el.appendChild(knob);
    return el;
  }

  function moveKnob(dx, dy, visible) {
    if (!knob) return;
    knob.style.opacity = visible ? "1" : "0";
    if (!visible) return;
    knob.style.transform = `translate(${stickTouch.ox + dx}px, ${stickTouch.oy + dy}px)`;
  }

  function onStickDown(event) {
    if (stickTouch.id !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    stickTouch.id = event.pointerId;
    // The stick origin is wherever the thumb landed, not the centre of
    // the box. That is what makes an invisible joystick feel placed
    // under the thumb rather than hunted for.
    stickTouch.ox = event.clientX - rect.left;
    stickTouch.oy = event.clientY - rect.top;
    device = "touch";
    moveKnob(0, 0, true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* not capturable */ }
    event.preventDefault();
  }

  function onStickMove(event) {
    if (event.pointerId !== stickTouch.id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - rect.left) - stickTouch.ox;
    const dy = (event.clientY - rect.top) - stickTouch.oy;
    shape(dx / TOUCH_RADIUS, -dy / TOUCH_RADIUS, touchStick);
    const m = Math.hypot(dx, dy);
    const cap = m > TOUCH_RADIUS ? TOUCH_RADIUS / m : 1;
    moveKnob(dx * cap, dy * cap, true);
    event.preventDefault();
  }

  function onStickUp(event) {
    if (event.pointerId !== stickTouch.id) return;
    stickTouch.id = null;
    touchStick.x = 0; touchStick.y = 0; touchStick.mag = 0;
    moveKnob(0, 0, false);
  }

  function bindTouchButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    const ids = new Set();
    listen(el, "pointerdown", (event) => {
      ids.add(event.pointerId);
      device = "touch";
      onDown();
      try { el.setPointerCapture(event.pointerId); } catch (error) { /* not capturable */ }
      event.preventDefault();
    });
    const up = (event) => {
      if (!ids.delete(event.pointerId)) return;
      onUp();
    };
    listen(el, "pointerup", up);
    listen(el, "pointercancel", up);
    listen(el, "contextmenu", (event) => event.preventDefault());
  }

  function wireTouch() {
    const stick = mountStick();
    if (stick) {
      listen(stick, "pointerdown", onStickDown);
      listen(stick, "pointermove", onStickMove);
      listen(stick, "pointerup", onStickUp);
      listen(stick, "pointercancel", onStickUp);
    }
    bindTouchButton("btn-jump", () => press("jump"), () => release("jump"));
    // The pound button is the N64 Z button: a pound in the air, a crouch
    // on the ground. The moveset decides which; input just reports both.
    bindTouchButton("btn-pound",
      () => { press("pound"); press("crouch"); },
      () => { release("pound"); release("crouch"); });
    bindTouchButton("btn-special",
      () => { specialDownAt = now(); specialIsAura = false; press("beam"); },
      () => {
        release("beam");
        if (specialIsAura) release("aura");
        specialDownAt = -999;
        specialIsAura = false;
      });
  }

  /** Held long enough, the special button escalates from beam to aura.
   *  Two buttons would not fit next to the jump button on a phone. */
  function pollTouchHold() {
    if (specialDownAt < 0 || specialIsAura) return;
    if (now() - specialDownAt >= AURA_HOLD) {
      specialIsAura = true;
      press("aura");
    }
  }

  /* ----------------------------- wiring ----------------------------- */

  const listeners = [];
  function listen(target, type, fn, options) {
    if (!target) return;
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }

  listen(window, "keydown", onKeyDown);
  listen(window, "keyup", onKeyUp);
  listen(window, "blur", onBlur);
  listen(document, "pointerlockchange", onLockChange);
  listen(canvas, "mousedown", onMouseDown);
  listen(window, "mouseup", onMouseUp);
  listen(window, "mousemove", onMouseMove);
  listen(canvas, "wheel", onWheel, { passive: false });
  listen(canvas, "contextmenu", (event) => event.preventDefault());
  listen(canvas, "mouseenter", () => { focused = true; });
  listen(canvas, "mouseleave", () => { focused = false; });
  listen(canvas, "focus", () => { focused = true; });
  listen(canvas, "blur", () => { focused = false; });
  listen(window, "gamepadconnected", () => { hasPad = true; });
  listen(window, "gamepaddisconnected", () => { hasPad = false; });
  wireTouch();

  bus.on("player:grounded", (on) => api.notifyGrounded(on !== false));

  /* ------------------------------- api ------------------------------- */

  const stick = { x: 0, y: 0, mag: 0 };

  /**
   * The ground heading the camera is looking along, in radians, so the
   * stick can be rotated into world space.
   *
   * Read off the camera's own world matrix rather than from a yaw
   * property on the rig. A rig's "yaw" is not a shared unit: camera.js
   * measures its boom yaw as the direction FROM the player TO the
   * camera, which is exactly pi away from the direction the player is
   * looking. Trusting the name inverted every control in the game - W
   * walked backwards and D strafed left - and it looked like a physics
   * bug, not an input one. The matrix cannot be misread that way: it is
   * where the camera is actually pointing, whoever put it there.
   *
   * A rig that wants to own the movement frame during a transition can
   * still say so, but it has to opt in under a name that can only mean
   * this one thing.
   */
  function cameraYaw() {
    const rig = ctx.cameraRig;
    if (rig) {
      if (Number.isFinite(rig.moveYaw)) return rig.moveYaw;
      if (typeof rig.getMoveYaw === "function") {
        const y = rig.getMoveYaw();
        if (Number.isFinite(y)) return y;
      }
    }
    const cam = ctx.camera;
    if (!cam) return lastYaw;
    const e = cam.matrixWorld.elements;
    // Third basis column is the camera's local +Z; forward is its
    // negation. Reading the matrix avoids allocating a vector per frame.
    const fx = -e[8];
    const fz = -e[10];
    if (Math.abs(fx) + Math.abs(fz) < 1e-6) return lastYaw;
    lastYaw = Math.atan2(fx, fz);
    return lastYaw;
  }

  const api = {
    /** Camera-relative, world-plane movement: x is world +X, y is
     *  world +Z. Radially clamped, so |move| never exceeds 1. */
    move: { x: 0, y: 0 },
    moveMag: 0,
    /** Raw stick space, before the camera rotation: y is "forward".
     *  Kept for anything that wants the intent rather than the vector. */
    moveStick: { x: 0, y: 0 },
    /** World heading the player should face, radians. */
    moveAngle: 0,
    /** True while the stick is inside the walk band. */
    walk: false,

    /** Yaw and pitch delta this frame, radians. Positive x swings the
     *  camera right, positive y looks up. */
    look: { x: 0, y: 0 },
    /** -1 | 0 | 1 for exactly one frame after a camera key tap. */
    cameraNudge: 0,

    binds,
    get device() { return device; },
    get hasGamepad() { return hasPad; },
    get locked() { return locked(); },

    pressed(name) { return pressedSet.has(name); },
    held(name) { return downSet.has(name); },
    released(name) { return releasedSet.has(name); },

    /**
     * True when jump was pressed inside the buffer window and has not
     * been spent. Read this instead of pressed("jump") anywhere a jump
     * can start, or the player loses the input on the frames where the
     * character is a centimetre off the floor.
     */
    bufferedJump() {
      return jumpPressedAt > jumpConsumedAt && (now() - jumpPressedAt) <= JUMP_BUFFER;
    },

    /** Spend the buffered jump. Returns whether there was one. */
    consumeJump() {
      if (!api.bufferedJump()) return false;
      jumpConsumedAt = now();
      return true;
    },

    /** Still inside the coyote window after walking off an edge. */
    coyoteOk() { return grounded || (now() - lastGroundedAt) <= COYOTE_TIME; },

    /** One call that answers "may a jump start this frame". */
    jumpAllowed(isGrounded) {
      const ok = isGrounded === undefined ? api.coyoteOk() : (isGrounded || api.coyoteOk());
      return ok && api.bufferedJump();
    },

    /** physics/player report ground contact here so the coyote window
     *  has something to measure from. Also mirrored on the bus event
     *  "player:grounded" for modules that would rather emit. */
    notifyGrounded(on) {
      const next = on !== false;
      if (grounded && !next) lastGroundedAt = now();
      if (next) lastGroundedAt = now();
      grounded = next;
    },

    /* ------------------------- rebinding ------------------------- */

    setBind(action, codes) {
      if (!Object.prototype.hasOwnProperty.call(binds, action)) return false;
      binds[action] = Array.isArray(codes) ? codes.slice() : [codes];
      rebuildBindMap();
      persistBinds();
      return true;
    },

    resetBinds() {
      for (const action of Object.keys(DEFAULT_BINDS)) binds[action] = DEFAULT_BINDS[action].slice();
      rebuildBindMap();
      persistBinds();
      return true;
    },

    requestLock,
    exitLock,
    rumble,

    /* --------------------------- test hooks --------------------------- */

    /** Drive movement without a device. Pass (0, 0) to release it. */
    injectMove(x, y) {
      if (!x && !y) { syntheticMove = null; return; }
      syntheticMove = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    },
    injectLook(x, y) { lookAccumX += x || 0; lookAccumY += y || 0; },
    injectPress(name) { press(name); },
    injectRelease(name) { release(name); },

    /* ----------------------------- frame ----------------------------- */

    update(context) {
      const c = context || ctx;
      const dt = (c.clock && c.clock.dt) || 0;

      pollGamepad(dt);
      pollTouchHold();

      // Edge sets are swapped after polling so a pad button pressed this
      // frame is visible this frame, not next. Keyboard events queued
      // since the last update land in the same swap.
      const p = pressedSet; pressedSet = pendingPressed; pendingPressed = p; pendingPressed.clear();
      const r = releasedSet; releasedSet = pendingReleased; pendingReleased = r; pendingReleased.clear();

      // Resolve the stick. Priority is synthetic, then whichever real
      // device is actually being touched this frame.
      if (syntheticMove) {
        shape(syntheticMove.x, syntheticMove.y, stick);
      } else if (touchStick.mag > 0) {
        stick.x = touchStick.x; stick.y = touchStick.y; stick.mag = touchStick.mag;
      } else if (padStick.mag > 0) {
        stick.x = padStick.x; stick.y = padStick.y; stick.mag = padStick.mag;
      } else {
        // Keyboard is resolved here rather than on keydown so opposite
        // keys cancel exactly and a release takes effect the same frame.
        let x = 0; let y = 0;
        if (downSet.has("forward")) y += 1;
        if (downSet.has("back")) y -= 1;
        if (downSet.has("left")) x -= 1;
        if (downSet.has("right")) x += 1;
        const m = Math.hypot(x, y);
        if (m > 0) {
          const scale = downSet.has("walk") ? 0.5 : 1;
          stick.x = (x / m) * scale; stick.y = (y / m) * scale; stick.mag = scale;
        } else { stick.x = 0; stick.y = 0; stick.mag = 0; }
      }

      api.moveStick.x = stick.x;
      api.moveStick.y = stick.y;
      api.moveMag = stick.mag;
      api.walk = stick.mag > 0 && stick.mag < WALK_BAND;

      if (stick.mag > 0) {
        const yaw = cameraYaw();
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        // right = forward x up, in the XZ plane.
        api.move.x = -fz * stick.x + fx * stick.y;
        api.move.y = fx * stick.x + fz * stick.y;
        api.moveAngle = Math.atan2(api.move.x, api.move.y);
      } else {
        api.move.x = 0;
        api.move.y = 0;
      }

      // A held camera key sweeps; a tapped one nudged on release.
      let swing = 0;
      const t = now();
      if (downSet.has("camLeft") && t - (downAt.get("camLeft") || t) >= SWING_HOLD) swing -= SWING_RATE * dt;
      if (downSet.has("camRight") && t - (downAt.get("camRight") || t) >= SWING_HOLD) swing += SWING_RATE * dt;

      api.look.x = lookAccumX + swing;
      api.look.y = lookAccumY;
      lookAccumX = 0;
      lookAccumY = 0;

      api.cameraNudge = nudgeQueued;
      nudgeQueued = 0;

      // The buffer must not outlive its window even if nobody asks.
      if (jumpPressedAt > 0 && t - jumpPressedAt > JUMP_BUFFER) jumpConsumedAt = Math.max(jumpConsumedAt, jumpPressedAt);
    },

    dispose() {
      listeners.forEach((off) => off());
      listeners.length = 0;
      if (knob && knob.parentNode) knob.parentNode.removeChild(knob);
    },
  };

  return api;
}
