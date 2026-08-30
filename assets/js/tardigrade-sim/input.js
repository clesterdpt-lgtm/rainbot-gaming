/* ============================================================
   Tardigrade Simulator - unified input

   Merges keyboard, mouse (with pointer lock), gamepad and touch
   into one action set. Gameplay code never touches raw events:

       const move = ctx.input.move;        // {x, y} in [-1,1]
       if (ctx.input.pressed("jump")) ...  // edge triggered
       if (ctx.input.down("sprint")) ...   // level triggered

   Touch controls are *declared* here (virtual stick + buttons) but
   drawn by ui.js, which calls `input.bindTouchStick(el)` and
   `input.bindTouchButton(el, action)`.
   ============================================================ */

import { clamp } from "./core.js";

const KEY_BINDINGS = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "jump",
  ShiftLeft: "sprint", ShiftRight: "sprint",
  KeyE: "grapple",
  KeyQ: "slam",
  KeyR: "ragdoll",
  KeyC: "tun",
  KeyF: "interact",
  KeyV: "cameraToggle",
  KeyP: "photo",
  KeyM: "map",
  Tab: "scoreboard",
  Escape: "pause",
  Backquote: "debug",
};

const GAMEPAD_BUTTONS = {
  0: "jump",       // A / cross
  1: "tun",        // B / circle
  2: "slam",       // X / square
  3: "ragdoll",    // Y / triangle
  4: "cameraToggle",
  5: "grapple",    // RB
  6: "sprint",     // LT
  7: "grapple",    // RT
  9: "pause",
};

const ALL_ACTIONS = [
  "forward", "back", "left", "right",
  "jump", "sprint", "grapple", "slam", "ragdoll", "tun",
  "interact", "cameraToggle", "photo", "map", "scoreboard", "pause", "debug",
];

export function createInput(ctx) {
  const canvas = ctx.canvas;

  const down = new Set();
  const pressedThisFrame = new Set();
  const releasedThisFrame = new Set();

  /** Sources are OR-ed together so a key and a gamepad button can both drive an action. */
  const sources = {
    key: new Set(),
    pad: new Set(),
    touch: new Set(),
    pointer: new Set(),
  };

  const input = {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    /** Analogue stick magnitude, 0..1. Keyboard reports 1. */
    moveMagnitude: 0,
    pointerLocked: false,
    lastDevice: "keyboard",
    enabled: true,

    down: (action) => down.has(action),
    pressed: (action) => pressedThisFrame.has(action),
    released: (action) => releasedThisFrame.has(action),
    actions: ALL_ACTIONS.slice(),
  };

  /* ---------------------------------------------------------- */
  /* state plumbing                                             */
  /* ---------------------------------------------------------- */

  function recompute() {
    const next = new Set();
    for (const key of Object.keys(sources)) {
      for (const action of sources[key]) next.add(action);
    }
    for (const action of next) {
      if (!down.has(action)) pressedThisFrame.add(action);
    }
    for (const action of down) {
      if (!next.has(action)) releasedThisFrame.add(action);
    }
    down.clear();
    for (const action of next) down.add(action);
  }

  function setSource(bucket, action, isDown) {
    if (!action) return;
    const set = sources[bucket];
    if (isDown) set.add(action);
    else set.delete(action);
    recompute();
  }

  /* ---------------------------------------------------------- */
  /* keyboard                                                   */
  /* ---------------------------------------------------------- */

  function onKey(event, isDown) {
    if (!input.enabled) return;
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    // Do not steal browser shortcuts the player may need.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isDown && event.repeat) return;
    event.preventDefault();
    input.lastDevice = "keyboard";
    setSource("key", action, isDown);
  }

  const keyDownHandler = (event) => onKey(event, true);
  const keyUpHandler = (event) => onKey(event, false);
  window.addEventListener("keydown", keyDownHandler, { passive: false });
  window.addEventListener("keyup", keyUpHandler, { passive: false });
  window.addEventListener("blur", () => {
    sources.key.clear();
    sources.pointer.clear();
    recompute();
  });

  /* ---------------------------------------------------------- */
  /* mouse + pointer lock                                       */
  /* ---------------------------------------------------------- */

  let pendingLookX = 0;
  let pendingLookY = 0;

  // Drag-to-look fallback. Pointer lock is refused inside an iframe that was
  // not given allow="pointer-lock" - which is how the game is embedded in the
  // Claude preview pane - and the request fails silently, so `pointerLocked`
  // stayed false and the camera simply never turned. movementX/Y are still
  // delivered without a lock, so holding a mouse button and dragging works
  // everywhere as a fallback.
  let dragLook = false;

  const onPointerMove = (event) => {
    if (!input.enabled) return;
    if (!input.pointerLocked && !dragLook) return;
    pendingLookX += event.movementX || 0;
    pendingLookY += event.movementY || 0;
    input.lastDevice = "mouse";
  };

  const onPointerDown = (event) => {
    if (!input.enabled) return;
    if (ctx.state.phase !== "playing") return;
    if (!input.pointerLocked) {
      input.requestLock();
      // Start dragging to look straight away. If the lock succeeds this is
      // harmless (the lock path takes over and pointerup clears it); if it
      // is refused - an iframe without allow="pointer-lock" - this is the
      // only way the player can turn the camera at all.
      dragLook = true;
      return;
    }
    if (event.button === 0) setSource("pointer", "grapple", true);
    if (event.button === 2) setSource("pointer", "slam", true);
  };

  const onPointerUp = (event) => {
    if (event.button === 0) setSource("pointer", "grapple", false);
    if (event.button === 2) setSource("pointer", "slam", false);
    dragLook = false;
  };

  const onLockChange = () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    ctx.events.emit("input:pointerlock", input.pointerLocked);
    if (!input.pointerLocked) {
      sources.pointer.clear();
      recompute();
    }
  };

  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("mousemove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  input.pointerLockBlocked = false;
  input.requestLock = () => {
    if (ctx.settings.isTouch) return;
    let promise;
    try {
      promise = canvas.requestPointerLock?.({ unadjustedMovement: true });
    } catch (error) {
      input.pointerLockBlocked = true;
      return;
    }
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {
        // Retry once without the option, then give up and let drag-look
        // carry the camera rather than leaving the player unable to turn.
        try {
          const retry = canvas.requestPointerLock?.();
          if (retry && typeof retry.catch === "function") {
            retry.catch(() => { input.pointerLockBlocked = true; });
          }
        } catch (error) {
          input.pointerLockBlocked = true;
        }
      });
    }
  };
  input.releaseLock = () => {
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  };

  /* ---------------------------------------------------------- */
  /* touch                                                      */
  /* ---------------------------------------------------------- */

  const stick = { active: false, id: -1, originX: 0, originY: 0, x: 0, y: 0 };
  const lookTouch = { active: false, id: -1, lastX: 0, lastY: 0 };

  input.bindTouchStick = (element, radius = 66) => {
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", (event) => {
      stick.active = true;
      stick.id = event.pointerId;
      stick.originX = event.clientX;
      stick.originY = event.clientY;
      stick.x = 0;
      stick.y = 0;
      input.lastDevice = "touch";
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    element.addEventListener("pointermove", (event) => {
      if (!stick.active || event.pointerId !== stick.id) return;
      const dx = event.clientX - stick.originX;
      const dy = event.clientY - stick.originY;
      const dist = Math.hypot(dx, dy);
      const scale = dist > radius ? radius / dist : 1;
      stick.x = clamp((dx * scale) / radius, -1, 1);
      stick.y = clamp((dy * scale) / radius, -1, 1);
      ctx.events.emit("input:stick", { x: stick.x, y: stick.y });
      event.preventDefault();
    });
    const end = (event) => {
      if (event.pointerId !== stick.id) return;
      stick.active = false;
      stick.id = -1;
      stick.x = 0;
      stick.y = 0;
      ctx.events.emit("input:stick", { x: 0, y: 0 });
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  input.bindTouchLook = (element) => {
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", (event) => {
      if (lookTouch.active) return;
      lookTouch.active = true;
      lookTouch.id = event.pointerId;
      lookTouch.lastX = event.clientX;
      lookTouch.lastY = event.clientY;
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener("pointermove", (event) => {
      if (!lookTouch.active || event.pointerId !== lookTouch.id) return;
      pendingLookX += (event.clientX - lookTouch.lastX) * 1.6;
      pendingLookY += (event.clientY - lookTouch.lastY) * 1.6;
      lookTouch.lastX = event.clientX;
      lookTouch.lastY = event.clientY;
      input.lastDevice = "touch";
    });
    const end = (event) => {
      if (event.pointerId !== lookTouch.id) return;
      lookTouch.active = false;
      lookTouch.id = -1;
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  input.bindTouchButton = (element, action) => {
    element.style.touchAction = "none";
    const press = (event) => {
      setSource("touch", action, true);
      element.classList.add("is-active");
      input.lastDevice = "touch";
      event.preventDefault();
    };
    const release = (event) => {
      setSource("touch", action, false);
      element.classList.remove("is-active");
      if (event) event.preventDefault();
    };
    element.addEventListener("pointerdown", press);
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    element.addEventListener("pointerleave", release);
  };

  /* ---------------------------------------------------------- */
  /* gamepad                                                    */
  /* ---------------------------------------------------------- */

  const padStick = { x: 0, y: 0, lookX: 0, lookY: 0 };

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) { pad = candidate; break; }
    }
    if (!pad) {
      if (sources.pad.size) { sources.pad.clear(); recompute(); }
      padStick.x = padStick.y = padStick.lookX = padStick.lookY = 0;
      return;
    }

    const deadzone = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    padStick.x = deadzone(pad.axes[0] || 0);
    padStick.y = deadzone(pad.axes[1] || 0);
    padStick.lookX = deadzone(pad.axes[2] || 0);
    padStick.lookY = deadzone(pad.axes[3] || 0);

    if (padStick.x || padStick.y || padStick.lookX || padStick.lookY) input.lastDevice = "gamepad";

    const next = new Set();
    pad.buttons.forEach((button, index) => {
      const action = GAMEPAD_BUTTONS[index];
      if (action && button && button.pressed) next.add(action);
    });
    let changed = next.size !== sources.pad.size;
    if (!changed) {
      for (const action of next) if (!sources.pad.has(action)) { changed = true; break; }
    }
    if (changed) {
      sources.pad.clear();
      for (const action of next) sources.pad.add(action);
      recompute();
    }
  }

  /* ---------------------------------------------------------- */
  /* per-frame                                                  */
  /* ---------------------------------------------------------- */

  input.beginFrame = (dt) => {
    pollGamepad();

    // --- movement vector: keyboard digital OR analogue stick, whichever is larger
    let mx = 0;
    let my = 0;
    if (down.has("right")) mx += 1;
    if (down.has("left")) mx -= 1;
    if (down.has("forward")) my -= 1;
    if (down.has("back")) my += 1;
    const keyMag = Math.hypot(mx, my);
    if (keyMag > 1) { mx /= keyMag; my /= keyMag; }

    const analogueX = stick.active ? stick.x : padStick.x;
    const analogueY = stick.active ? stick.y : padStick.y;
    const analogueMag = Math.hypot(analogueX, analogueY);

    if (analogueMag > keyMag) {
      input.move.x = analogueX;
      input.move.y = analogueY;
      input.moveMagnitude = Math.min(1, analogueMag);
    } else {
      input.move.x = mx;
      input.move.y = my;
      input.moveMagnitude = Math.min(1, keyMag);
    }

    // --- look delta: mouse/touch pixels this frame + gamepad stick rate
    const sensitivity = ctx.settings.mouseSensitivity;
    const padRate = 190 * dt;
    input.look.x = pendingLookX * 0.0022 * sensitivity + padStick.lookX * padRate * 0.0022 * sensitivity;
    input.look.y = pendingLookY * 0.0022 * sensitivity + padStick.lookY * padRate * 0.0022 * sensitivity;
    if (ctx.settings.invertY) input.look.y *= -1;
    pendingLookX = 0;
    pendingLookY = 0;

    if (!input.enabled) {
      input.move.x = 0;
      input.move.y = 0;
      input.moveMagnitude = 0;
      input.look.x = 0;
      input.look.y = 0;
    }
  };

  input.endFrame = () => {
    pressedThisFrame.clear();
    releasedThisFrame.clear();
  };

  /** Used by QA scripts to drive the game without real events. */
  input.qaSet = (action, isDown) => setSource("key", action, isDown);
  input.qaMove = (x, y) => { stick.active = true; stick.x = clamp(x, -1, 1); stick.y = clamp(y, -1, 1); };
  input.qaClearMove = () => { stick.active = false; stick.x = 0; stick.y = 0; };
  input.qaLook = (dx, dy) => { pendingLookX += dx; pendingLookY += dy; };

  input.dispose = () => {
    window.removeEventListener("keydown", keyDownHandler);
    window.removeEventListener("keyup", keyUpHandler);
    document.removeEventListener("pointerlockchange", onLockChange);
    document.removeEventListener("mousemove", onPointerMove);
  };

  return input;
}
