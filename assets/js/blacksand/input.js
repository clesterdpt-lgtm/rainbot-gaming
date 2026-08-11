/* ============================================================
   BLACKSAND - input

   Pointer-lock mouse look, rebindable keyboard, gamepad and a touch
   layer, all normalised into one `state` object the player controller
   reads. Nothing downstream ever asks "was this a key or a stick?".

   Mouse deltas accumulate into `state.look` and are drained once per
   simulation step. Draining rather than sampling matters: a 1000Hz
   mouse fires several move events per frame and sampling the last one
   throws most of the motion away, which is exactly the "sluggish aim"
   complaint that kills a shooter's feel.
   ============================================================ */

import { clamp } from "./core.js";

const DEFAULT_BINDS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  crouch: ["ControlLeft", "KeyC"],
  prone: ["KeyZ"],
  sprint: ["ShiftLeft"],
  reload: ["KeyR"],
  use: ["KeyE"],
  melee: ["KeyF", "KeyV"],
  grenade: ["KeyG"],
  lean_left: ["KeyQ"],
  lean_right: ["KeyE"],
  weapon1: ["Digit1"],
  weapon2: ["Digit2"],
  weapon3: ["Digit3"],
  weapon4: ["Digit4"],
  nextWeapon: ["KeyX"],
  map: ["KeyM"],
  scoreboard: ["Tab"],
  commorose: ["KeyT"],
  spot: ["KeyQ"],
  freelook: ["AltLeft"],
  flashlight: ["KeyL"],
  exitVehicle: ["KeyE"],
};

const ACTIONS = Object.keys(DEFAULT_BINDS);

export function createInput(ctx) {
  const { canvas, settings } = ctx;
  const bus = ctx.bus;

  const down = new Set();
  const pressedThisStep = new Set();
  const releasedThisStep = new Set();

  const binds = { ...DEFAULT_BINDS };
  const codeToActions = new Map();
  function rebuildBindMap() {
    codeToActions.clear();
    for (const action of Object.keys(binds)) {
      for (const code of binds[action]) {
        if (!codeToActions.has(code)) codeToActions.set(code, []);
        codeToActions.get(code).push(action);
      }
    }
  }
  rebuildBindMap();

  /** Non-null while a test is driving movement. See injectMove. */
  let moveOverride = null;

  const state = {
    /** -1..1 strafe, -1..1 forward (negative is forward, matching -Z). */
    moveX: 0,
    moveY: 0,
    /** Accumulated look delta in radians since the last drain. */
    lookYaw: 0,
    lookPitch: 0,
    /** Continuous triggers. */
    fire: false,
    ads: false,
    sprint: false,
    crouch: false,
    prone: false,
    lean: 0,
    /** True while the mouse is captured. */
    locked: false,
    /** Set when any input arrived from a gamepad this frame - the HUD
     *  swaps its prompt glyphs off this. */
    lastDevice: "kbm",
    hasGamepad: false,
    /** Touch look, in the same units as the mouse. */
    touchActive: false,
  };

  /* --------------------------- helpers --------------------------- */

  const isDown = (action) => down.has(action);
  const wasPressed = (action) => pressedThisStep.has(action);
  const wasReleased = (action) => releasedThisStep.has(action);

  function press(action) {
    if (!down.has(action)) {
      down.add(action);
      pressedThisStep.add(action);
      bus.emit("input:press", action);
    }
  }

  function release(action) {
    if (down.has(action)) {
      down.delete(action);
      releasedThisStep.add(action);
      bus.emit("input:release", action);
    }
  }

  /* ------------------------- pointer lock ------------------------- */

  let lockRequested = false;

  function requestLock() {
    if (settings.isTouch) return;
    lockRequested = true;
    const el = canvas;
    if (!el || document.pointerLockElement === el) return;
    const promise = el.requestPointerLock
      ? el.requestPointerLock({ unadjustedMovement: true })
      : null;
    // `unadjustedMovement` is rejected on platforms without raw input.
    // Retry plain, otherwise the game silently never captures the mouse.
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => { try { el.requestPointerLock(); } catch (error) { /* ignore */ } });
    }
  }

  function exitLock() {
    lockRequested = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function onLockChange() {
    const locked = document.pointerLockElement === canvas;
    if (locked === state.locked) return;
    state.locked = locked;
    if (!locked) {
      // Never leave a key stuck down through a lock break - the classic
      // "player walks into a wall forever after alt-tab" bug.
      for (const action of Array.from(down)) release(action);
      state.fire = false;
      state.ads = false;
    }
    bus.emit("input:lock", locked);
  }

  /* ---------------------------- mouse ---------------------------- */

  function onMouseMove(event) {
    if (!state.locked) return;
    const sens = settings.prefs.sensitivity
      * (state.ads ? settings.prefs.adsSensitivityScale : 1);
    // Chrome can deliver a single enormous delta after a lock regain.
    // Anything past a full screen-width of travel in one event is a
    // glitch, not a flick.
    const dx = clamp(event.movementX || 0, -900, 900);
    const dy = clamp(event.movementY || 0, -900, 900);
    state.lookYaw -= dx * sens;
    state.lookPitch -= dy * sens * (settings.prefs.invertY ? -1 : 1);
    state.lastDevice = "kbm";
  }

  function onMouseDown(event) {
    if (!state.locked) {
      requestLock();
      return;
    }
    if (event.button === 0) { state.fire = true; press("fire"); }
    if (event.button === 2) {
      if (settings.prefs.toggleAds) { state.ads = !state.ads; }
      else { state.ads = true; }
      press("ads");
    }
    if (event.button === 1) press("spot");
    event.preventDefault();
  }

  function onMouseUp(event) {
    if (event.button === 0) { state.fire = false; release("fire"); }
    if (event.button === 2) {
      if (!settings.prefs.toggleAds) state.ads = false;
      release("ads");
    }
    if (event.button === 1) release("spot");
  }

  function onWheel(event) {
    if (!state.locked) return;
    bus.emit("input:wheel", Math.sign(event.deltaY));
    event.preventDefault();
  }

  /* --------------------------- keyboard --------------------------- */

  function onKeyDown(event) {
    if (event.repeat) return;
    const actions = codeToActions.get(event.code);
    if (!actions) return;
    // Tab scrolls focus and F-keys do browser things. Only swallow keys
    // we actually bound, so the page stays usable when not locked.
    if (state.locked || event.code === "Tab") event.preventDefault();
    state.lastDevice = "kbm";
    for (const action of actions) press(action);
  }

  function onKeyUp(event) {
    const actions = codeToActions.get(event.code);
    if (!actions) return;
    for (const action of actions) release(action);
  }

  function onBlur() {
    for (const action of Array.from(down)) release(action);
    state.fire = false;
    state.ads = false;
    state.moveX = 0;
    state.moveY = 0;
  }

  /* --------------------------- gamepad --------------------------- */

  const gamepad = {
    index: -1,
    deadzone: 0.16,
    lookScale: 3.1,
  };

  function applyDeadzone(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < gamepad.deadzone) return [0, 0];
    // Radial scaling, so the stick reaches full tilt at the rim rather
    // than snapping from dead to 84%.
    const scaled = (mag - gamepad.deadzone) / (1 - gamepad.deadzone);
    return [(x / mag) * scaled, (y / mag) * scaled];
  }

  function pollGamepad(dt) {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = null;
    for (let i = 0; i < pads.length; i += 1) {
      if (pads[i] && pads[i].connected) { pad = pads[i]; gamepad.index = i; break; }
    }
    state.hasGamepad = Boolean(pad);
    if (!pad) return;

    const [lx, ly] = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0);
    const [rx, ry] = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0);

    if (Math.abs(lx) + Math.abs(ly) > 0.001) {
      state.moveX = lx;
      state.moveY = ly;
      state.lastDevice = "pad";
    }
    if (Math.abs(rx) + Math.abs(ry) > 0.001) {
      // Cubic response: precise near centre, fast at the rim. Linear
      // sticks are the reason pad aiming feels either twitchy or slow.
      const curve = (v) => v * v * v * 0.72 + v * 0.28;
      state.lookYaw -= curve(rx) * gamepad.lookScale * dt;
      state.lookPitch -= curve(ry) * gamepad.lookScale * dt
        * (settings.prefs.invertY ? -1 : 1);
      state.lastDevice = "pad";
    }

    const button = (i) => Boolean(pad.buttons[i] && pad.buttons[i].pressed);
    const trigger = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);

    const setFrom = (action, pressed) => (pressed ? press(action) : release(action));
    setFrom("jump", button(0));
    setFrom("crouch", button(1));
    setFrom("reload", button(2));
    setFrom("use", button(3));
    setFrom("melee", button(10));
    setFrom("grenade", button(5));
    setFrom("sprint", button(11));
    setFrom("scoreboard", button(8));

    state.fire = trigger(7) > 0.35;
    state.ads = trigger(6) > 0.3;
    if (state.fire) press("fire"); else release("fire");
  }

  function rumble(strong = 0.5, weak = 0.3, duration = 120) {
    if (settings.qa) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[gamepad.index];
    if (!pad || !pad.vibrationActuator) return;
    pad.vibrationActuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      strongMagnitude: clamp(strong, 0, 1),
      weakMagnitude: clamp(weak, 0, 1),
    }).catch(() => {});
  }

  /* ---------------------------- touch ---------------------------- */

  const touch = {
    moveId: null,
    moveOrigin: [0, 0],
    lookId: null,
    lookLast: [0, 0],
  };

  function onTouchStart(event) {
    state.touchActive = true;
    state.lastDevice = "touch";
    for (const t of event.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.42;
      if (left && touch.moveId === null) {
        touch.moveId = t.identifier;
        touch.moveOrigin = [t.clientX, t.clientY];
      } else if (!left && touch.lookId === null) {
        touch.lookId = t.identifier;
        touch.lookLast = [t.clientX, t.clientY];
      }
    }
  }

  function onTouchMove(event) {
    for (const t of event.changedTouches) {
      if (t.identifier === touch.moveId) {
        const dx = t.clientX - touch.moveOrigin[0];
        const dy = t.clientY - touch.moveOrigin[1];
        const radius = 62;
        state.moveX = clamp(dx / radius, -1, 1);
        state.moveY = clamp(dy / radius, -1, 1);
        if (Math.hypot(dx, dy) > radius * 1.25) press("sprint");
        else release("sprint");
      } else if (t.identifier === touch.lookId) {
        const sens = settings.prefs.sensitivity * 1.35
          * (state.ads ? settings.prefs.adsSensitivityScale : 1);
        state.lookYaw -= (t.clientX - touch.lookLast[0]) * sens;
        state.lookPitch -= (t.clientY - touch.lookLast[1]) * sens
          * (settings.prefs.invertY ? -1 : 1);
        touch.lookLast = [t.clientX, t.clientY];
      }
    }
    event.preventDefault();
  }

  function onTouchEnd(event) {
    for (const t of event.changedTouches) {
      if (t.identifier === touch.moveId) {
        touch.moveId = null;
        state.moveX = 0;
        state.moveY = 0;
        release("sprint");
      }
      if (t.identifier === touch.lookId) touch.lookId = null;
    }
  }

  /* ---------------------------- wiring ---------------------------- */

  const listeners = [];
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }

  listen(document, "pointerlockchange", onLockChange);
  listen(document, "pointerlockerror", () => bus.emit("input:lockerror"));
  listen(window, "blur", onBlur);
  listen(window, "keydown", onKeyDown);
  listen(window, "keyup", onKeyUp);
  listen(canvas, "mousedown", onMouseDown);
  listen(window, "mouseup", onMouseUp);
  listen(window, "mousemove", onMouseMove);
  listen(canvas, "wheel", onWheel, { passive: false });
  listen(canvas, "contextmenu", (e) => e.preventDefault());
  listen(canvas, "touchstart", onTouchStart, { passive: false });
  listen(canvas, "touchmove", onTouchMove, { passive: false });
  listen(window, "touchend", onTouchEnd);
  listen(window, "touchcancel", onTouchEnd);

  /* ----------------------------- api ----------------------------- */

  const api = {
    state,
    binds,
    ACTIONS,

    isDown,
    wasPressed,
    wasReleased,
    press,
    release,
    requestLock,
    exitLock,
    rumble,

    /** Called once per simulation step, before the player reads input. */
    beginStep(dt) {
      // A synthetic move overrides the keyboard entirely. Without this
      // branch `injectMove` is useless: the block below recomputes
      // moveX/moveY from the key state on every step and overwrites
      // whatever a test wrote, so a probe driving the player looks
      // exactly like a player standing still - which is how a movement
      // probe reports 0.00 m/s for every speed check and blames the
      // player controller.
      if (moveOverride) {
        state.moveX = moveOverride.x;
        state.moveY = moveOverride.y;
      } else if (!settings.isTouch) {
        // Keyboard movement is resolved here rather than on keydown so
        // opposite keys cancel exactly and a released key takes effect
        // the same step, not the next one.
        let x = 0;
        let y = 0;
        if (isDown("forward")) y -= 1;
        if (isDown("back")) y += 1;
        if (isDown("left")) x -= 1;
        if (isDown("right")) x += 1;
        const mag = Math.hypot(x, y);
        if (mag > 1) { x /= mag; y /= mag; }
        state.moveX = x;
        state.moveY = y;
      }
      pollGamepad(dt);

      state.sprint = isDown("sprint");
      state.crouch = isDown("crouch");
      state.prone = isDown("prone");
      state.lean = (isDown("lean_right") ? 1 : 0) - (isDown("lean_left") ? 1 : 0);
    },

    /** Returns and clears the accumulated look delta. */
    drainLook() {
      const yaw = state.lookYaw;
      const pitch = state.lookPitch;
      state.lookYaw = 0;
      state.lookPitch = 0;
      return { yaw, pitch };
    },

    /** Called at the end of a step - edge sets live for exactly one step. */
    endStep() {
      pressedThisStep.clear();
      releasedThisStep.clear();
    },

    setBind(action, codes) {
      binds[action] = Array.isArray(codes) ? codes : [codes];
      rebuildBindMap();
    },

    /** Test hook: synthesises a look delta without a real mouse. */
    injectLook(yaw, pitch) {
      state.lookYaw += yaw;
      state.lookPitch += pitch;
    },

    /** Test hook: drives movement directly, overriding the keyboard
     *  until cleared. Pass (0, 0) to release it. */
    injectMove(x, y) {
      if (x === 0 && y === 0) {
        moveOverride = null;
        state.moveX = 0;
        state.moveY = 0;
        return;
      }
      moveOverride = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
      state.moveX = moveOverride.x;
      state.moveY = moveOverride.y;
    },

    /** Drop a synthetic move override. */
    releaseMove() { moveOverride = null; state.moveX = 0; state.moveY = 0; },

    dispose() {
      listeners.forEach((off) => off());
      listeners.length = 0;
    },
  };

  return api;
}
