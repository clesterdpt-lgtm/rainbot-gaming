/* ============================================================
   SAINTFALL - touch controller

   This module owns gestures and presentation only. The player input
   object remains the single source of gameplay intent, so touch,
   keyboard, mouse and QA all reach the same movement/action paths.
   ============================================================ */

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export const TOUCH_CONFIG = Object.freeze({
  stickDeadZone: 0.12,
  stickSprint: 0.82,
  lookScaleX: 2.2,
  lookScaleY: 2.0,
});

const HOLD_ACTIONS = Object.freeze({
  fire: "firing",
  furnace: "furnace",
  aim: "ads",
  shield: "block",
  jet: "jetpack",
  /* The glide is a HYBRID on touch, exactly as it is on the keyboard:
     the press ignites it and the hold sustains it. Anything else would
     make the sustained glide - the whole point of the rebind - reachable
     only with a keyboard. */
  boost: "boostHeld",
});

/** Hold buttons that also fire a one-shot on the way down. */
const HOLD_PRESS_EVENTS = Object.freeze({ boost: "boost" });

const TAP_ACTIONS = Object.freeze({
  vault: ["jump", null],
  melee: ["melee", null],
  vent: ["vent", null],
});

function actionButton(action, glyph, label, mode, extra = "") {
  const pressed = mode === "hold" ? " aria-pressed=\"false\"" : "";
  return `
    <button class="sf-touch__button ${extra}" type="button"
      data-touch-action="${action}" aria-label="${label}, ${mode}"
      ${pressed}>
      <b aria-hidden="true">${glyph}</b>
      <span>${label}</span>
      <small>${mode}</small>
    </button>`;
}

function buildMarkup() {
  return `
    <div class="sf-touch__look" data-touch-look aria-label="Swipe to look" role="application">
      <span>SWIPE TO LOOK</span>
    </div>

    <div class="sf-touch__stick" data-touch-stick aria-label="Movement joystick" role="application">
      <i class="sf-touch__stick-ring" aria-hidden="true">
        <b class="sf-touch__stick-knob"></b>
      </i>
      <span>MOVE <small>RIM: SPRINT</small></span>
    </div>

    <div class="sf-touch__stack" data-touch-actions aria-label="Combat controls">
      <div class="sf-touch__utility">
        ${actionButton("vent", "↻", "VENT", "tap")}
        ${actionButton("furnace", "◆", "LANCE", "hold")}
        <button class="sf-touch__button sf-touch__button--command" type="button"
          data-touch-command aria-label="Hold and drag to select battlefield support"
          aria-haspopup="dialog" style="min-width:48px;min-height:48px">
          <b aria-hidden="true">⌁</b>
          <span>CALL</span>
          <small>hold + drag</small>
        </button>
      </div>
      <div class="sf-touch__mobility">
        ${actionButton("vault", "↑", "VAULT", "tap")}
        ${actionButton("boost", "»", "GLIDE", "hold")}
        ${actionButton("jet", "✦", "JET", "hold")}
      </div>
      <div class="sf-touch__actions">
        ${actionButton("aim", "◎", "AIM", "hold")}
        ${actionButton("shield", "◇", "AEGIS", "hold")}
        ${actionButton("melee", "╱", "MELEE", "tap")}
        ${actionButton("fire", "●", "FIRE", "hold", "sf-touch__button--fire")}
      </div>
    </div>`;
}

/** Build the authored touch layer and route every gesture through the
 *  player's existing input API. `?touch=1` forces it on for browser QA;
 *  `?touch=0` is an explicit desktop opt-out. */
export function buildTouchControls(ctx, player, host, stage) {
  if (!host || !stage || !player?.input) {
    return {
      config: TOUCH_CONFIG,
      enabled: false,
      update() {},
      releaseAll() {},
      setEnabled() { return false; },
      status: () => ({ enabled: false, reason: "missing-host" }),
    };
  }

  host.innerHTML = buildMarkup();
  const input = player.input;
  const surface = stage.closest(".rb-standalone-surface");
  const params = new URLSearchParams(window.location.search);
  const touchParam = params.get("touch");
  const forcedOn = touchParam !== null && touchParam !== "0" && touchParam !== "false";
  const forcedOff = touchParam === "0" || touchParam === "false";
  const coarseQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
  const noHoverQuery = window.matchMedia("(hover: none)");

  const stick = host.querySelector("[data-touch-stick]");
  const knob = host.querySelector(".sf-touch__stick-knob");
  const lookZone = host.querySelector("[data-touch-look]");
  const actionButtons = new Map();
  host.querySelectorAll("[data-touch-action]").forEach((button) => {
    actionButtons.set(button.dataset.touchAction, button);
  });

  let enabled = null;
  let stickPointer = null;
  let lookPointer = null;
  let lookX = 0;
  let lookY = 0;
  let lookHintCleared = false;
  let wasDead = false;
  const holdPointers = new Map();

  const prevent = (event) => {
    if (event.cancelable) event.preventDefault();
  };

  function pulse(pattern = 7) {
    try {
      if (enabled && navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {
      // Vibration is optional and may be blocked outside a user gesture.
    }
  }

  ctx.guardReadability?.bus?.on?.("threatReady", (event = {}) => {
    pulse(event.guardType === "unblockable" ? [10, 34, 14] : 10);
  });
  ctx.combat?.bus?.on?.("shieldBlock", (event = {}) => {
    pulse(event.perfect ? [8, 24, 16] : 12);
  });
  ctx.combat?.bus?.on?.("shieldRejected", () => pulse([14, 30, 14]));

  function setHeld(button, action, held) {
    input.setTouchHold(HOLD_ACTIONS[action], held);
    button.classList.toggle("is-held", held);
    button.setAttribute("aria-pressed", held ? "true" : "false");
  }

  function releaseHold(action, pointerId = null) {
    const held = holdPointers.get(action);
    if (held === undefined) return;
    if (pointerId !== null && held !== pointerId) return;
    holdPointers.delete(action);
    const button = actionButtons.get(action);
    if (button) setHeld(button, action, false);
  }

  function resetStick(pointerId = null) {
    if (pointerId !== null && stickPointer !== pointerId) return;
    stickPointer = null;
    stick.classList.remove("is-held", "is-sprinting");
    knob.style.transform = "translate3d(0, 0, 0)";
    input.setTouchMove(0, 0, false);
  }

  function moveStick(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(24, rect.width * 0.33);
    const rawX = (clientX - cx) / radius;
    const rawY = (clientY - cy) / radius;
    const rawMag = Math.hypot(rawX, rawY);
    const visualMag = Math.min(1, rawMag);
    const ux = rawMag > 1e-5 ? rawX / rawMag : 0;
    const uy = rawMag > 1e-5 ? rawY / rawMag : 0;
    const amount = rawMag <= TOUCH_CONFIG.stickDeadZone
      ? 0
      : clamp(
        (Math.min(1, rawMag) - TOUCH_CONFIG.stickDeadZone)
          / (1 - TOUCH_CONFIG.stickDeadZone),
        0,
        1
      );
    const x = ux * amount;
    const y = uy * amount;
    const visualX = ux * visualMag * radius;
    const visualY = uy * visualMag * radius;
    knob.style.transform = `translate3d(${visualX.toFixed(1)}px, ${visualY.toFixed(1)}px, 0)`;
    const move = input.setTouchMove(x, y, true);
    stick.classList.toggle("is-sprinting", move.sprint);
  }

  stick.addEventListener("pointerdown", (event) => {
    if (!enabled || stickPointer !== null) return;
    prevent(event);
    stickPointer = event.pointerId;
    stick.classList.add("is-held");
    try { stick.setPointerCapture(event.pointerId); } catch (_) { /* best effort */ }
    moveStick(event.clientX, event.clientY);
    pulse();
  }, { passive: false });
  stick.addEventListener("pointermove", (event) => {
    if (!enabled || event.pointerId !== stickPointer) return;
    prevent(event);
    moveStick(event.clientX, event.clientY);
  }, { passive: false });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    stick.addEventListener(type, (event) => resetStick(event.pointerId));
  }

  function resetLook(pointerId = null) {
    if (pointerId !== null && lookPointer !== pointerId) return;
    lookPointer = null;
    lookZone.classList.remove("is-held");
  }

  lookZone.addEventListener("pointerdown", (event) => {
    if (!enabled || lookPointer !== null) return;
    prevent(event);
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    lookZone.classList.add("is-held");
    try { lookZone.setPointerCapture(event.pointerId); } catch (_) { /* best effort */ }
  }, { passive: false });
  lookZone.addEventListener("pointermove", (event) => {
    if (!enabled || event.pointerId !== lookPointer) return;
    prevent(event);
    const dx = event.clientX - lookX;
    const dy = event.clientY - lookY;
    lookX = event.clientX;
    lookY = event.clientY;
    if (!lookHintCleared && Math.hypot(dx, dy) > 2) {
      lookHintCleared = true;
      host.classList.add("sf-touch-looked");
    }
    input.addTouchLook(dx * TOUCH_CONFIG.lookScaleX, dy * TOUCH_CONFIG.lookScaleY);
  }, { passive: false });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    lookZone.addEventListener(type, (event) => resetLook(event.pointerId));
  }

  for (const [action, inputName] of Object.entries(HOLD_ACTIONS)) {
    const button = actionButtons.get(action);
    if (!button) continue;
    void inputName;
    button.addEventListener("pointerdown", (event) => {
      if (!enabled || holdPointers.has(action)) return;
      prevent(event);
      holdPointers.set(action, event.pointerId);
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* best effort */ }
      setHeld(button, action, true);
      if (HOLD_PRESS_EVENTS[action]) input.pressTouch(HOLD_PRESS_EVENTS[action], {});
      pulse(HOLD_PRESS_EVENTS[action] ? 12 : 7);
    }, { passive: false });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, (event) => releaseHold(action, event.pointerId));
    }
    button.addEventListener("keydown", (event) => {
      if (!enabled || event.repeat || !["Enter", " "].includes(event.key)) return;
      prevent(event);
      holdPointers.set(action, `key:${action}`);
      setHeld(button, action, true);
      if (HOLD_PRESS_EVENTS[action]) input.pressTouch(HOLD_PRESS_EVENTS[action], {});
    });
    button.addEventListener("keyup", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      prevent(event);
      releaseHold(action, `key:${action}`);
    });
    button.addEventListener("blur", () => releaseHold(action));
  }

  for (const [action, [eventType, detail]] of Object.entries(TAP_ACTIONS)) {
    const button = actionButtons.get(action);
    if (!button) continue;
    const press = (event) => {
      if (!enabled) return;
      prevent(event);
      input.pressTouch(eventType, detail || {});
      button.classList.remove("is-tapped");
      // Restarting the class makes repeated code-pad taps visible.
      void button.offsetWidth;
      button.classList.add("is-tapped");
      pulse(action === "melee" ? 12 : 7);
    };
    button.addEventListener("pointerdown", press, { passive: false });
    button.addEventListener("animationend", () => button.classList.remove("is-tapped"));
    button.addEventListener("keydown", (event) => {
      if (event.repeat || !["Enter", " "].includes(event.key)) return;
      press(event);
    });
  }

  function releaseAll() {
    resetStick();
    resetLook();
    for (const action of [...holdPointers.keys()]) releaseHold(action);
    input.clearTouch();
    host.querySelectorAll(".is-held, .is-tapped").forEach((el) => {
      el.classList.remove("is-held", "is-tapped");
      if (el.matches("button")) el.setAttribute("aria-pressed", "false");
    });
  }

  function setEnabled(next) {
    const value = !!next;
    if (value === enabled) return enabled;
    enabled = value;
    if (!enabled) releaseAll();
    stage.classList.toggle("sf-touch-enabled", enabled);
    surface?.classList.toggle("sf-touch-surface", enabled);
    host.setAttribute("aria-hidden", enabled ? "false" : "true");
    return enabled;
  }

  function detected() {
    if (forcedOff) return false;
    if (forcedOn) return true;
    return coarseQuery.matches
      || ((navigator.maxTouchPoints || 0) > 0 && noHoverQuery.matches);
  }

  const refreshDetection = () => setEnabled(detected());
  coarseQuery.addEventListener?.("change", refreshDetection);
  noHoverQuery.addEventListener?.("change", refreshDetection);

  window.addEventListener("pointerup", (event) => {
    resetStick(event.pointerId);
    resetLook(event.pointerId);
    for (const action of [...holdPointers.keys()]) releaseHold(action, event.pointerId);
  });
  window.addEventListener("pointercancel", (event) => {
    resetStick(event.pointerId);
    resetLook(event.pointerId);
    for (const action of [...holdPointers.keys()]) releaseHold(action, event.pointerId);
  });
  window.addEventListener("blur", releaseAll);
  window.addEventListener("pagehide", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
  const menuObserver = new MutationObserver(() => {
    if (document.body.classList.contains("rb-escape-menu-open")) releaseAll();
  });
  menuObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  function setButtonState(action, state) {
    const button = actionButtons.get(action);
    if (!button) return;
    button.dataset.state = state;
  }

  function update() {
    const fuel = ctx.jetpack?.state?.fuel || 0;
    /* MELEE doubles as the slam trigger in the air, so it lights up
       for a slam - but it must never read as unavailable on the
       ground, where it is still the swing and has no cooldown. */
    setButtonState("melee", ctx.slam?.state?.active ? "active" : "ready");
    setButtonState("boost", ctx.boost?.state?.active
      ? "active"
      : fuel + 1e-6 < (ctx.boost?.config?.ignitionCost || 0) ? "low" : "ready");
    setButtonState("jet", ctx.jetpack?.state?.active
      ? "active"
      : ctx.jetpack?.state?.inFlight ? "glide" : fuel <= 0 ? "low" : "ready");
    const shield = ctx.shield?.status?.();
    setButtonState("shield", shield?.active
      ? (shield.activeFor <= shield.perfectWindow ? "timed" : "active")
      : fuel <= 0 ? "low" : "ready");
    setButtonState("fire", ctx.weapons?.carry?.overheated ? "low" : "ready");
    const furnaceRank = ctx.progression?.rank?.("censer_furnace_reprieve") || 0;
    const furnaceButton = actionButtons.get("furnace");
    if (furnaceButton) furnaceButton.hidden = furnaceRank <= 0;
    const furnaceState = ctx.weapons?.furnaceChargeState?.();
    setButtonState("furnace", furnaceState?.charging
      ? (furnaceState.ready ? "ready" : "active")
      : furnaceRank <= 0 || fuel <= 0 || ctx.weapons?.carry?.overheated ? "low" : "ready");
    setButtonState("vent", (ctx.weapons?.carry?.venting || 0) > 0 ? "active" : "ready");
    const dead = !!ctx.combat?.player?.dead;
    if (dead && !wasDead) releaseAll();
    wasDead = dead;
    host.dataset.dead = dead ? "true" : "false";
  }

  function status() {
    return {
      enabled,
      forced: forcedOn,
      move: {
        active: input.touch.moveActive,
        x: Number(input.touch.move.x.toFixed(3)),
        y: Number(input.touch.move.y.toFixed(3)),
        sprint: input.touch.sprint,
      },
      holds: {
        fire: input.touch.firing,
        furnace: input.touch.furnace,
        aim: input.touch.ads,
        shield: input.touch.block,
        jet: input.touch.jetpack,
      },
      pointers: {
        stick: stickPointer,
        look: lookPointer,
        holds: holdPointers.size,
      },
    };
  }

  refreshDetection();
  update();

  return {
    config: TOUCH_CONFIG,
    host,
    get enabled() { return enabled; },
    update,
    releaseAll,
    setEnabled,
    status,
  };
}
