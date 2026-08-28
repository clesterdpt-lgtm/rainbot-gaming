/* ============================================================
   SAINTFALL - field orientation

   A short, input-aware walkthrough that begins after a NEW operation
   reaches the basin. It observes the same player/touch state the game
   already owns; it never injects an action or duplicates a gameplay rule.
   Continue and Load bypass it at the entry controller.
   ============================================================ */

import {
  keybindLabel, keybindPrimaryLabel, keybindMatches, keybindDown,
} from "saintfall/keybinds.js";

const STEP_COUNT = 4;

/* THE TUTORIAL TEACHES THE PLAYER'S OWN SCHEME, NOT THE SHIPPED ONE.
   Copy and legends carry `{{action}}` tokens rather than key faces, so
   a rebound Boost is taught as the key it now is. Resolved at render,
   which is also when a mid-tutorial rebind takes effect. */
const bindToken = /\{\{([a-zA-Z]+)(!?)\}\}/g;
const resolveBinds = (text) => String(text ?? "")
  .replace(bindToken, (_, id, primaryOnly) => (primaryOnly
    ? keybindPrimaryLabel(id) : keybindLabel(id)));

const DESKTOP_STEPS = Object.freeze([
  {
    id: "orientation",
    kicker: "FIELD ORIENTATION",
    title: "Take the road",
    copy: "Click the battlefield to link your sight. Move off the landing mark and scan the basin.",
    controls: ["{{moveForward!}} {{moveLeft!}} {{moveBack!}} {{moveRight!}}", "MOUSE"],
    hint: "Move and look to continue",
    checks: [["move", "MOVE"], ["look", "LOOK"]],
  },
  {
    id: "mobility",
    kicker: "RELIQUARY MOBILITY",
    title: "Break the distance",
    copy: "Tap {{boost!}} for a burst, hold it to glide, vault with {{jump!}}, then combine both inputs for the jetpack.",
    controls: ["{{boost!}}", "{{jump!}}", "{{boost!}} + {{jump!}}"],
    hint: "Try each mobility input",
    checks: [["glide", "GLIDE"], ["vault", "VAULT"], ["jet", "JET"]],
  },
  {
    id: "combat",
    kicker: "WEAPON LITURGY",
    title: "Ready the Vesper lance",
    copy: "Fire and aim with the mouse. A small white omen over an attacker marks a committed melee strike; raise {{block}} before contact. Projectiles carry their own warning. {{melee}} strikes and {{vent}} vents heat.",
    controls: ["LMB", "RMB", "{{melee}}", "{{block}}", "{{vent}}"],
    hint: "Follow the training beat, then cycle every combat control",
    checks: [["fire", "FIRE"], ["aim", "AIM"], ["melee", "MELEE"], ["aegis", "AEGIS"], ["vent", "VENT"]],
  },
  {
    id: "command",
    kicker: "FIELD COMMAND",
    title: "Call down the sky",
    copy: "Hold {{wheel}} to open the command wheel. Hover a support sigil and left click to deploy; release to cancel.",
    controls: ["HOLD {{wheel}}", "LMB"],
    hint: "Open the command wheel",
    checks: [["command", "COMMAND WHEEL"]],
  },
]);

const TOUCH_STEPS = Object.freeze([
  {
    id: "orientation",
    kicker: "FIELD ORIENTATION",
    title: "Take the road",
    copy: "Drag the left relic to move off the landing mark. Swipe the right side of the battlefield to scan the basin.",
    controls: ["LEFT RELIC", "SWIPE TO LOOK"],
    hint: "Move and look to continue",
    checks: [["move", "MOVE"], ["look", "LOOK"]],
  },
  {
    id: "mobility",
    kicker: "RELIQUARY MOBILITY",
    title: "Break the distance",
    copy: "Tap or hold the labeled mobility controls. Glide crosses ground, Vault clears hazards, and Jet sustains flight.",
    controls: ["GLIDE", "VAULT", "JET"],
    hint: "Try each mobility control",
    checks: [["glide", "GLIDE"], ["vault", "VAULT"], ["jet", "JET"]],
  },
  {
    id: "combat",
    kicker: "WEAPON LITURGY",
    title: "Ready the Vesper lance",
    copy: "A small white omen over an attacker marks a committed melee strike; raise Aegis before contact. Projectiles carry their own warning. Then try each labeled combat control.",
    controls: ["FIRE", "AIM", "MELEE", "AEGIS", "VENT"],
    hint: "Follow the training beat, then cycle every combat control",
    checks: [["fire", "FIRE"], ["aim", "AIM"], ["melee", "MELEE"], ["aegis", "AEGIS"], ["vent", "VENT"]],
  },
  {
    id: "command",
    kicker: "FIELD COMMAND",
    title: "Call down the sky",
    copy: "Hold Call, drag toward a support sigil, then release to confirm. Return to the centre to cancel.",
    controls: ["HOLD CALL", "DRAG + RELEASE"],
    hint: "Open the command wheel",
    checks: [["command", "COMMAND WHEEL"]],
  },
]);

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function unavailableStatus(reason = "disabled") {
  return {
    enabled: false,
    active: false,
    completed: false,
    skipped: false,
    mode: reason,
    step: null,
    stepIndex: -1,
    stepNumber: 0,
    stepCount: STEP_COUNT,
    inputMode: "desktop",
    observed: {},
  };
}

export function buildTutorial(ctx, options = {}) {
  const enabled = options.enabled !== false;
  const host = options.host;
  const stage = options.stage;
  const canvas = options.canvas;
  const touch = options.touch;
  if (!enabled || !host || !stage || !canvas || !ctx.player?.input) {
    const status = unavailableStatus(enabled ? "missing-host" : "disabled");
    return {
      enabled: false,
      start: () => false,
      skip: () => false,
      update: () => false,
      dispose: () => false,
      status: () => ({ ...status }),
    };
  }

  host.innerHTML = `
    <section class="sf-tutorial" role="status" aria-live="polite" aria-atomic="true">
      <header class="sf-tutorial__head">
        <span><small data-tutorial-kicker>FIELD ORIENTATION</small><strong data-tutorial-title>Take the road</strong></span>
        <b data-tutorial-progress>01 / 04</b>
      </header>
      <p data-tutorial-copy></p>
      <div class="sf-tutorial__controls" data-tutorial-controls aria-label="Controls for this step"></div>
      <ul class="sf-tutorial__checks" data-tutorial-checks aria-label="Tutorial progress"></ul>
      <footer>
        <span data-tutorial-hint>Move and look to continue</span>
        <button type="button" data-tutorial-skip>SKIP TUTORIAL</button>
      </footer>
    </section>`;

  const kickerEl = host.querySelector("[data-tutorial-kicker]");
  const titleEl = host.querySelector("[data-tutorial-title]");
  const progressEl = host.querySelector("[data-tutorial-progress]");
  const copyEl = host.querySelector("[data-tutorial-copy]");
  const controlsEl = host.querySelector("[data-tutorial-controls]");
  const checksEl = host.querySelector("[data-tutorial-checks]");
  const hintEl = host.querySelector("[data-tutorial-hint]");
  const skipButton = host.querySelector("[data-tutorial-skip]");

  const state = {
    enabled: true,
    active: false,
    completed: false,
    skipped: false,
    disposed: false,
    mode: "idle",
    source: "",
    stepIndex: -1,
    inputMode: touch?.enabled ? "touch" : "desktop",
    observed: {},
    stepStartedAt: 0,
    completedAt: 0,
    guardPreviewAt: 0,
    origin: { x: 0, z: 0, yaw: 0, pitch: 0 },
    lookTravel: 0,
    lastYaw: 0,
    lastPitch: 0,
  };
  const heldKeys = new Set();
  let advanceTimer = 0;
  let hideTimer = 0;

  const steps = () => state.inputMode === "touch" ? TOUCH_STEPS : DESKTOP_STEPS;
  const step = () => steps()[state.stepIndex] || null;

  function clearTimers() {
    if (advanceTimer) window.clearTimeout(advanceTimer);
    if (hideTimer) window.clearTimeout(hideTimer);
    advanceTimer = 0;
    hideTimer = 0;
  }

  function resetOrigin() {
    const player = ctx.player.state;
    state.origin = {
      x: Number(player.x) || 0,
      z: Number(player.z) || 0,
      yaw: Number(player.camYaw) || 0,
      pitch: Number(player.camPitch) || 0,
    };
    state.lastYaw = state.origin.yaw;
    state.lastPitch = state.origin.pitch;
    state.lookTravel = 0;
  }

  function renderChecks() {
    const current = step();
    if (!current) return;
    checksEl.innerHTML = current.checks.map(([id, label]) => {
      const done = !!state.observed[id];
      return `<li data-check="${id}" data-done="${done ? "true" : "false"}"><i aria-hidden="true">${done ? "✓" : "·"}</i><span>${label}</span></li>`;
    }).join("");
  }

  function renderStep() {
    const current = step();
    if (!current) return false;
    kickerEl.textContent = current.kicker;
    titleEl.textContent = current.title;
    progressEl.textContent = `${String(state.stepIndex + 1).padStart(2, "0")} / ${String(STEP_COUNT).padStart(2, "0")}`;
    copyEl.textContent = resolveBinds(current.copy);
    controlsEl.innerHTML = current.controls
      .map((control) => `<kbd>${resolveBinds(control)}</kbd>`).join("");
    hintEl.textContent = current.hint;
    skipButton.textContent = "SKIP TUTORIAL";
    host.dataset.step = current.id;
    host.dataset.input = state.inputMode;
    renderChecks();
    return true;
  }

  function setStep(index) {
    if (!state.active || state.completed || index < 0 || index >= STEP_COUNT) return false;
    state.stepIndex = index;
    state.mode = "running";
    state.observed = {};
    state.stepStartedAt = performance.now();
    state.guardPreviewAt = state.stepIndex === 2 ? performance.now() : 0;
    resetOrigin();
    renderStep();
    return true;
  }

  function finish({ skipped = false, reason = "complete" } = {}) {
    if ((!state.active && state.completed) || state.disposed) return false;
    clearTimers();
    state.completed = true;
    state.skipped = !!skipped;
    state.active = false;
    state.mode = skipped ? "skipped" : "complete";
    state.completedAt = performance.now();
    heldKeys.clear();
    stage.classList.remove("sf-tutorial-active");
    host.dataset.state = state.mode;

    if (skipped) {
      host.classList.add("is-leaving");
      hideTimer = window.setTimeout(() => {
        host.hidden = true;
        host.setAttribute("aria-hidden", "true");
        host.classList.remove("is-active", "is-leaving");
      }, 180);
    } else {
      kickerEl.textContent = "ORIENTATION COMPLETE";
      titleEl.textContent = "The road is yours";
      progressEl.textContent = "FIELD READY";
      copyEl.textContent = resolveBinds("{{menu}} or Esc opens the operation menu. {{map}} opens the full "
        + "tactical map. Every control can be rebound under Controls.");
      controlsEl.innerHTML = `<kbd>${resolveBinds("{{menu}}")} / ESC</kbd><kbd>${resolveBinds("{{map}}")}</kbd>`;
      checksEl.innerHTML = "<li data-done=\"true\"><i aria-hidden=\"true\">✓</i><span>VESPER LINK GREEN</span></li>";
      hintEl.textContent = "Operation The Gilded Silence";
      skipButton.textContent = "CLOSE";
      host.classList.add("is-complete");
      hideTimer = window.setTimeout(() => {
        host.hidden = true;
        host.setAttribute("aria-hidden", "true");
        host.classList.remove("is-active", "is-complete");
      }, 4200);
    }
    options.onComplete?.({ skipped: state.skipped, reason, source: state.source });
    return true;
  }

  function skip(reason = "user") {
    if (!state.active && state.mode !== "complete") return false;
    if (state.mode === "complete") {
      clearTimers();
      host.hidden = true;
      host.setAttribute("aria-hidden", "true");
      host.classList.remove("is-active", "is-complete");
      return true;
    }
    return finish({ skipped: true, reason });
  }

  function start({ source = "new-operation" } = {}) {
    if (state.disposed) return false;
    clearTimers();
    state.active = true;
    state.completed = false;
    state.skipped = false;
    state.mode = "running";
    state.source = source;
    state.inputMode = touch?.enabled ? "touch" : "desktop";
    state.stepIndex = 0;
    state.observed = {};
    heldKeys.clear();
    resetOrigin();
    host.hidden = false;
    host.setAttribute("aria-hidden", "false");
    host.classList.remove("is-leaving", "is-complete");
    host.classList.add("is-active");
    host.dataset.state = "running";
    stage.classList.add("sf-tutorial-active");
    renderStep();
    return true;
  }

  function mark(id) {
    const current = step();
    if (!state.active || state.completed || !current?.checks.some(([check]) => check === id)
      || state.observed[id]) return false;
    state.observed[id] = true;
    renderChecks();
    return true;
  }

  function onKeyDown(event) {
    if (!state.active || state.completed) return;
    heldKeys.add(event.code);
    if (event.repeat) return;
    if (step()?.id === "mobility") {
      if (keybindMatches("boost", event.code)) mark("glide");
      if (keybindMatches("jump", event.code)) mark("vault");
      if (keybindDown(heldKeys, "boost") && keybindDown(heldKeys, "jump")) mark("jet");
    } else if (step()?.id === "combat") {
      if (keybindMatches("melee", event.code)) mark("melee");
      if (keybindMatches("block", event.code)) mark("aegis");
      if (keybindMatches("vent", event.code)) mark("vent");
    }
  }

  function onKeyUp(event) {
    heldKeys.delete(event.code);
  }

  function onMouseDown(event) {
    if (!state.active || state.completed || step()?.id !== "combat"
      || event.target?.closest?.("#sf-tutorial")) return;
    const ownsAim = document.pointerLockElement === canvas || !!ctx.player.input.state.locked;
    if (!ownsAim) return;
    if (event.button === 0) mark("fire");
    if (event.button === 2) mark("aim");
  }

  function onPointerDown(event) {
    if (!state.active || state.completed) return;
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest?.("[data-touch-action]")?.dataset.touchAction;
    if (step()?.id === "mobility") {
      if (action === "boost") mark("glide");
      if (action === "vault") mark("vault");
      if (action === "jet") mark("jet");
    } else if (step()?.id === "combat") {
      const controls = { fire: "fire", aim: "aim", melee: "melee", shield: "aegis", vent: "vent" };
      if (controls[action]) mark(controls[action]);
    } else if (step()?.id === "command" && target?.closest?.("[data-touch-command]")) {
      mark("command");
    }
  }

  function allObserved() {
    const current = step();
    return !!current && current.checks.every(([id]) => state.observed[id]);
  }

  function update() {
    if (!state.active || state.completed || state.disposed) return false;
    const inputMode = touch?.enabled ? "touch" : "desktop";
    if (inputMode !== state.inputMode) {
      state.inputMode = inputMode;
      renderStep();
    }

    const current = step();
    const player = ctx.player.state;
    if (current?.id === "orientation") {
      const moved = Math.hypot((Number(player.x) || 0) - state.origin.x,
        (Number(player.z) || 0) - state.origin.z);
      if (moved >= 1.25) mark("move");
      const yaw = Number(player.camYaw) || 0;
      const pitch = Number(player.camPitch) || 0;
      state.lookTravel += angleDistance(yaw, state.lastYaw) + Math.abs(pitch - state.lastPitch);
      state.lastYaw = yaw;
      state.lastPitch = pitch;
      if (state.lookTravel >= 0.14) mark("look");
    } else if (current?.id === "mobility") {
      if (ctx.boost?.state?.active || ctx.player.input.state.boostHeld) mark("glide");
      if (ctx.jetpack?.state?.active || ctx.jetpack?.state?.inFlight) mark("jet");
    } else if (current?.id === "combat") {
      const now = performance.now();
      const activeGuard = ctx.guardReadability?.status?.()?.primary;
      if (!state.observed.aegis && !activeGuard && now >= state.guardPreviewAt) {
        ctx.guardReadability?.preview?.({ impactIn: 1.1, guardType: "frontal" });
        state.guardPreviewAt = now + 1900;
      }
      if (ctx.player.input.state.firing) mark("fire");
      if (ctx.player.input.state.ads) mark("aim");
      if (ctx.player.input.state.block) mark("aegis");
    } else if (current?.id === "command"
      && document.body.classList.contains("sf-command-open")) {
      mark("command");
    }

    if (allObserved() && !advanceTimer) {
      /* Keep the final command check visible until its wheel closes. The wheel
         is a higher-priority decision layer and should not be covered by a
         completion card while the player's pointer is still choosing. */
      if (current?.id === "command" && document.body.classList.contains("sf-command-open")) {
        return true;
      }
      state.mode = "settling";
      hintEl.textContent = "LINK CONFIRMED";
      advanceTimer = window.setTimeout(() => {
        advanceTimer = 0;
        if (!state.active || state.completed) return;
        if (state.stepIndex >= STEP_COUNT - 1) finish({ reason: "walkthrough-complete" });
        else setStep(state.stepIndex + 1);
      }, 520);
    }
    return true;
  }

  function status() {
    const current = step();
    return {
      enabled: true,
      active: state.active,
      completed: state.completed,
      skipped: state.skipped,
      mode: state.mode,
      source: state.source,
      step: current?.id || null,
      stepIndex: state.stepIndex,
      stepNumber: state.stepIndex >= 0 ? state.stepIndex + 1 : 0,
      stepCount: STEP_COUNT,
      inputMode: state.inputMode,
      observed: { ...state.observed },
      visible: !host.hidden && host.getAttribute("aria-hidden") !== "true",
    };
  }

  function dispose() {
    if (state.disposed) return false;
    state.disposed = true;
    clearTimers();
    stage.classList.remove("sf-tutorial-active");
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("pointerdown", onPointerDown);
    skipButton.removeEventListener("click", onSkipClick);
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");
    host.replaceChildren();
    return true;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("pointerdown", onPointerDown);
  const onSkipClick = () => skip("user");
  skipButton.addEventListener("click", onSkipClick);
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");

  return {
    enabled: true,
    start,
    skip,
    update,
    dispose,
    status,
  };
}
