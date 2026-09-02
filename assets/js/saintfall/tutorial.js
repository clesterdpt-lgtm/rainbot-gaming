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

const TUTORIAL_PROFILES = Object.freeze({
  "vesper-reliquary": Object.freeze({
    id: "vesper-reliquary",
    name: "Saint Aurel",
    role: "VANGUARD",
    orientationTitle: "Advance as the Vanguard",
    mobilityTitle: "Sustain the ascent",
    mobilityCopy: "Tap {{boost!}} for a reliquary burst, hold it to glide, vault with {{jump!}}, then combine both inputs for Saint Aurel's sustained flight.",
    touchMobilityCopy: "Glide crosses ground, Vault clears hazards, and Jet sustains Saint Aurel's flight.",
    combatTitle: "Censer-lance and Aegis",
    combatCopy: "LMB fires the Censer-lance, RMB aims, and {{melee}} begins a procession strike. When the red melee omen closes, hold {{block}}: Saint Aurel raises the visible Aegis block pose. {{vent}} vents lance heat.",
    touchCombatCopy: "Fire the Censer-lance, Aim, and use Melee. When the red omen closes, hold Aegis until Saint Aurel raises the shield; Vent clears lance heat.",
    controls: ["LMB", "RMB", "{{melee}}", "HOLD {{block}}", "{{vent}}"],
    touchControls: ["FIRE", "AIM", "MELEE", "HOLD AEGIS", "VENT"],
    checks: [["primary", "LANCE"], ["secondary", "AIM"], ["melee", "MELEE"], ["guard", "AEGIS BLOCK"], ["vent", "VENT"]],
    defense: Object.freeze({ kind: "guard", check: "guard", label: "AEGIS BLOCK" }),
  }),
  "white-vigil": Object.freeze({
    id: "white-vigil",
    name: "Saint Veyra",
    role: "SCOUT",
    orientationTitle: "Find the Scout's line",
    mobilityTitle: "Keep the Vigil moving",
    mobilityCopy: "Tap {{boost!}} to break pursuit, hold it to glide, vault with {{jump!}}, then combine both inputs to take Saint Veyra's firing line into the air.",
    touchMobilityCopy: "Glide breaks pursuit, Vault clears hazards, and Jet carries Saint Veyra's firing line into the air.",
    combatTitle: "Crescents and Vigil Step",
    combatCopy: "LMB fires the twin crescents; RMB and {{melee}} work the quick blades. Saint Veyra cannot block: when the red melee omen closes, tap {{block}} to Blink through the attack line.",
    touchCombatCopy: "Fire the twin crescents and use the quick blades. Saint Veyra cannot block: when the red omen closes, tap Blink to vanish through the attack line.",
    controls: ["LMB", "RMB", "{{melee}}", "TAP {{block}}"],
    touchControls: ["FIRE", "QUICK BLADE", "MELEE", "TAP BLINK"],
    checks: [["primary", "CRESCENTS"], ["secondary", "QUICK BLADE"], ["melee", "MELEE"], ["blink", "BLINK EVADE"]],
    defense: Object.freeze({ kind: "blink", check: "blink", label: "BLINK EVADE" }),
  }),
  "bastion-penitent": Object.freeze({
    id: "bastion-penitent",
    name: "Saint Torren",
    role: "BULWARK",
    orientationTitle: "Take the Bulwark's ground",
    mobilityTitle: "Commit the advance",
    mobilityCopy: "Tap {{boost!}} to drive forward, vault with {{jump!}}, then combine both inputs for Saint Torren's powered leap. The Bulwark wins ground instead of hovering over it.",
    touchMobilityCopy: "Glide drives forward, Vault clears hazards, and Jet commits Saint Torren's powered leap.",
    combatTitle: "Hammer and tower guard",
    combatCopy: "LMB swings the reliquary hammer, RMB casts it, and {{melee}} commits another hammer strike. When the red melee omen closes, hold {{block}}: Saint Torren plants the visible tower-shield block pose.",
    touchCombatCopy: "Swing or cast the reliquary hammer. When the red omen closes, hold Guard until Saint Torren plants the tower shield in its block pose.",
    controls: ["LMB", "RMB", "{{melee}}", "HOLD {{block}}"],
    touchControls: ["HAMMER", "HAMMER CAST", "MELEE", "HOLD GUARD"],
    checks: [["primary", "HAMMER"], ["secondary", "HAMMER CAST"], ["melee", "MELEE"], ["guard", "TOWER GUARD"]],
    defense: Object.freeze({ kind: "guard", check: "guard", label: "TOWER GUARD" }),
  }),
});

function tutorialProfile(id, saintName = "") {
  const selected = TUTORIAL_PROFILES[id] || TUTORIAL_PROFILES["vesper-reliquary"];
  return saintName && saintName !== selected.name ? { ...selected, name: saintName } : selected;
}

function stepsFor(profile, inputMode) {
  const touchMode = inputMode === "touch";
  return [
    {
      id: "orientation",
      kicker: `${profile.role} // FIELD ORIENTATION`,
      title: profile.orientationTitle,
      copy: touchMode
        ? `Drag the left relic to move ${profile.name} off the landing mark. Swipe the battlefield to scan the basin.`
        : `Click the battlefield to link ${profile.name}'s sight. Move off the landing mark and scan the basin.`,
      controls: touchMode
        ? ["LEFT RELIC", "SWIPE TO LOOK"]
        : ["{{moveForward!}} {{moveLeft!}} {{moveBack!}} {{moveRight!}}", "MOUSE"],
      hint: "Move and look to continue",
      checks: [["move", "MOVE"], ["look", "LOOK"]],
    },
    {
      id: "mobility",
      kicker: `${profile.role} // MOBILITY`,
      title: profile.mobilityTitle,
      copy: touchMode ? profile.touchMobilityCopy : profile.mobilityCopy,
      controls: touchMode
        ? ["GLIDE", "VAULT", "JET"]
        : ["{{boost!}}", "{{jump!}}", "{{boost!}} + {{jump!}}"],
      hint: "Try each mobility input",
      checks: [["glide", "GLIDE"], ["vault", "VAULT"], ["jet", "JET"]],
    },
    {
      id: "combat",
      kicker: `${profile.role} // DEFENSE DRILL`,
      title: profile.combatTitle,
      copy: touchMode ? profile.touchCombatCopy : profile.combatCopy,
      controls: touchMode ? profile.touchControls : profile.controls,
      hint: `Read the red training omen, then perform ${profile.defense.label}`,
      checks: profile.checks,
    },
    {
      id: "command",
      kicker: `${profile.role} // FIELD COMMAND`,
      title: "Call down the sky",
      copy: touchMode
        ? `Hold Call, drag toward one of ${profile.name}'s support sigils, then release to confirm. Return to centre to cancel.`
        : `Hold {{wheel}} to open ${profile.name}'s command wheel. Hover a support sigil and left click to deploy; release to cancel.`,
      controls: touchMode ? ["HOLD CALL", "DRAG + RELEASE"] : ["HOLD {{wheel}}", "LMB"],
      hint: "Open the command wheel",
      checks: [["command", "COMMAND WHEEL"]],
    },
  ];
}

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
  const profile = tutorialProfile(options.characterId || ctx.playerCharacter?.id,
    options.saintName || ctx.playerCharacter?.name);
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
    defenseBaseline: 0,
    defenseAnimationSeen: false,
    origin: { x: 0, z: 0, yaw: 0, pitch: 0 },
    lookTravel: 0,
    lastYaw: 0,
    lastPitch: 0,
  };
  const heldKeys = new Set();
  let advanceTimer = 0;
  let hideTimer = 0;

  const stepSets = {
    desktop: stepsFor(profile, "desktop"),
    touch: stepsFor(profile, "touch"),
  };
  const steps = () => stepSets[state.inputMode];
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

  function defenseCount() {
    return profile.defense.kind === "blink"
      ? Number(ctx.kenosis?.status?.()?.blink?.casts) || 0
      : Number(ctx.shield?.status?.()?.blocks) || 0;
  }

  function setStep(index) {
    if (!state.active || state.completed || index < 0 || index >= STEP_COUNT) return false;
    state.stepIndex = index;
    state.mode = "running";
    state.observed = {};
    state.stepStartedAt = performance.now();
    state.guardPreviewAt = state.stepIndex === 2 ? performance.now() : 0;
    if (state.stepIndex === 2) state.defenseBaseline = defenseCount();
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
      kickerEl.textContent = `${profile.role} ORIENTATION COMPLETE`;
      titleEl.textContent = `${profile.name} is field ready`;
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
    state.defenseBaseline = defenseCount();
    state.defenseAnimationSeen = false;
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
    if (event.button === 0) mark("primary");
    if (event.button === 2) mark("secondary");
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
      const controls = { fire: "primary", aim: "secondary", melee: "melee", vent: "vent" };
      /* Defense is credited from the real shield/blink state in update(),
         never from touching the button. That keeps the visible animation
         and the completed check on the same authoritative action. */
      if (action !== "shield" && controls[action]) mark(controls[action]);
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
      if (!state.observed[profile.defense.check] && !activeGuard && now >= state.guardPreviewAt) {
        ctx.guardReadability?.preview?.({
          impactIn: 1.1,
          guardType: "frontal",
          label: profile.defense.label,
        });
        state.guardPreviewAt = now + 1900;
      }
      if (ctx.player.input.state.firing) mark("primary");
      if (ctx.player.input.state.ads) mark("secondary");
      if (profile.defense.kind === "guard") {
        const guard = ctx.shield?.status?.();
        if (guard?.active) {
          state.defenseAnimationSeen = true;
          mark(profile.defense.check);
        }
      } else {
        const casts = Number(ctx.kenosis?.status?.()?.blink?.casts) || 0;
        if (casts > state.defenseBaseline) {
          state.defenseAnimationSeen = true;
          mark(profile.defense.check);
        }
      }
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
      characterId: profile.id,
      saintName: profile.name,
      defense: profile.defense.kind,
      defenseLabel: profile.defense.label,
      defenseAnimationSeen: state.defenseAnimationSeen,
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
