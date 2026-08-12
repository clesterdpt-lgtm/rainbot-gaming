/* ============================================================
   SAINTFALL - native field interface

   Owns the hold-to-command wheel and the in-game field menu. The
   simulation reacts only to the body classes this module exposes;
   durable game state remains owned by the save and mission systems.
   ============================================================ */

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const SETTINGS_KEY = "saintfall:field-ui:v1";
const PANEL_NAMES = new Set(["operation", "map", "saves", "controls", "settings"]);
const WHEEL_POINTS = Object.freeze([
  { x: 0, y: -1, angle: -90 },
  { x: 0.866, y: 0.5, angle: 30 },
  { x: -0.866, y: 0.5, angle: 150 },
]);

const ICONS = Object.freeze({
  crest: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c6 0 10 5 10 11 0 7-4 11-10 15C10 25 6 21 6 14 6 8 10 3 16 3Z"/><path d="M10 15h12M16 9v13"/></svg>`,
  orbital: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v9M11 7l5 5 5-5M7 25h18M10 21h12"/><path d="m16 12 4 8h-8Z"/></svg>`,
  cluster: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4v7M16 21v7M4 16h7M21 16h7M7.5 7.5l5 5M19.5 19.5l5 5M24.5 7.5l-5 5M12.5 19.5l-5 5"/><circle cx="16" cy="16" r="4"/></svg>`,
  resupply: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 10 6v14l-10 6-10-6V9Z"/><path d="M16 9v14M9 16h14"/></svg>`,
  operation: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m12 7 3 5-3 5-3-5Z"/></svg>`,
  map: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 5-2 6 2 5-2v16l-5 2-6-2-5 2Z"/><path d="M9 3v16M15 5v16"/><circle cx="15" cy="11" r="2"/></svg>`,
  saves: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>`,
  controls: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a5 5 0 0 1 4 7l-1 3a2 2 0 0 1-3 1l-3-2h-4l-3 2a2 2 0 0 1-3-1l-1-3a5 5 0 0 1 4-7Z"/><path d="M7 12h4M9 10v4M16 12h.1M18 14h.1"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg>`,
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatSavedAt(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "No field record";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(Number(timestamp)));
  } catch (_) { return "Recorded"; }
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      hudScale: saved.hudScale === "large" ? "large" : "standard",
      reducedMotion: !!saved.reducedMotion,
      highContrast: !!saved.highContrast,
    };
  } catch (_) {
    return { hudScale: "standard", reducedMotion: false, highContrast: false };
  }
}

function writeSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* optional */ }
}

function commandMarkup(order, mission) {
  return order.map((key, index) => {
    const spec = mission.stratagems?.[key] || { name: key, role: "Field command" };
    const point = WHEEL_POINTS[index] || WHEEL_POINTS[0];
    return `<button class="sf-command-wheel__option" type="button"
      data-command="${escapeHtml(key)}" data-index="${index}" data-state="ready"
      style="--sf-command-angle:${point.angle}deg" aria-pressed="false">
      <span class="sf-command-wheel__sigil">${ICONS[key] || ICONS.crest}</span>
      <span class="sf-command-wheel__copy"><strong>${escapeHtml(spec.name)}</strong>
        <small>${escapeHtml(spec.role || "Field command")}</small></span>
      <b data-command-status>READY</b>
    </button>`;
  }).join("");
}

function slotMarkup(kind, index, title) {
  const manual = kind === "manual";
  return `<article class="sf-save-slot" data-save-kind="${kind}" data-save-index="${index}">
    <header><span>${escapeHtml(title)}</span><b data-slot-state>EMPTY</b></header>
    <div class="sf-save-slot__summary">
      <strong data-slot-district>No field record</strong>
      <span data-slot-progress>Awaiting deployment state</span>
      <small data-slot-time>—</small>
    </div>
    <div class="sf-save-slot__actions">
      ${manual ? `<button type="button" data-save-action="save">SAVE</button>` : ""}
      <button type="button" data-save-action="load" disabled>LOAD</button>
      ${manual ? `<button type="button" data-save-action="clear" disabled>CLEAR</button>` : ""}
    </div>
  </article>`;
}

function controlRow(key, action, detail = "") {
  return `<div class="sf-control-row"><kbd>${key}</kbd><span><strong>${action}</strong>${detail ? `<small>${detail}</small>` : ""}</span></div>`;
}

export function buildGameUi(ctx, { stage, canvas, save, touch } = {}) {
  if (!stage || !canvas || !ctx?.mission) {
    const closed = () => ({ open: false });
    return {
      update() {}, toggleAudio: () => false, openMenu: () => false,
      openMap: () => false, closeMenu: () => false, cancelWheel: () => false, refresh() {},
      wheelState: closed, menuState: closed,
      settingsState: () => ({ audioEnabled: false, hudScale: "standard", reducedMotion: false, highContrast: false }),
    };
  }

  stage.__saintfallGameUi?.destroy?.();
  stage.querySelector("#sf-native-ui")?.remove();
  const order = Array.from(ctx.mission.wheelOrder || ["orbital", "cluster", "resupply"]);
  const root = document.createElement("div");
  root.id = "sf-native-ui";
  root.className = "sf-native-ui";
  root.innerHTML = `
    <div id="sf-command-wheel" class="sf-command-wheel" role="dialog"
      aria-label="Field command wheel" aria-modal="false" aria-hidden="true" hidden
      data-open="false" data-selection="">
      <div class="sf-command-wheel__veil"></div>
      <div class="sf-command-wheel__dial">
        <div class="sf-command-wheel__ring" aria-hidden="true"></div>
        ${commandMarkup(order, ctx.mission)}
        <button class="sf-command-wheel__core" type="button" data-wheel-cancel>
          ${ICONS.crest}<span data-wheel-status>DRAG TO SELECT</span><small>RELEASE TAB TO CONFIRM</small>
        </button>
        <i class="sf-command-wheel__cursor" aria-hidden="true"></i>
      </div>
      <p class="sf-command-wheel__instruction">COMMAND LITURGY · TIME HELD IN STASIS</p>
    </div>
    <div id="sf-menu" class="sf-menu" role="dialog" aria-modal="true" tabindex="-1"
      aria-labelledby="sf-menu-title" aria-describedby="sf-menu-subtitle"
      aria-hidden="true" data-panel="operation" data-phase="relays" hidden>
      <div class="sf-menu__veil"></div>
      <div class="sf-menu__frame">
        <header class="sf-menu__masthead">
          <div class="sf-menu__crest">${ICONS.crest}</div>
          <div><span>VESPER-IX · FIELD COMMAND</span><h2 id="sf-menu-title">OPERATION SAINTFALL</h2>
            <p id="sf-menu-subtitle">THE GILDED SILENCE</p></div>
          <button type="button" class="sf-menu__close" data-menu-close aria-label="Resume operation">×</button>
        </header>
        <div class="sf-menu__body">
          <nav class="sf-menu__rail" aria-label="Field menu">
            <button type="button" class="sf-menu__resume" data-menu-close>${ICONS.operation}<span><strong>RESUME</strong><small>Return to the basin</small></span></button>
            <button type="button" data-menu-panel="operation" aria-current="page">${ICONS.operation}<span>OPERATION</span></button>
            <button type="button" data-menu-panel="map">${ICONS.map}<span>TACTICAL MAP</span></button>
            <button type="button" data-menu-panel="saves">${ICONS.saves}<span>SAVE / LOAD</span></button>
            <button type="button" data-menu-panel="controls">${ICONS.controls}<span>CONTROLS</span></button>
            <button type="button" data-menu-panel="settings">${ICONS.settings}<span>SETTINGS</span></button>
            <div class="sf-menu__rail-spacer"></div>
            <button type="button" class="fullscreen-btn" id="sf-fullscreen"
              data-menu-action="maximize" aria-pressed="false">${ICONS.maximize}<span data-maximize-label>MAXIMIZE GAME</span></button>
            <button type="button" data-menu-action="restart"><span>RESTART OPERATION</span></button>
            <button type="button" data-menu-action="return"><span>RETURN TO ARCHIVE</span></button>
          </nav>
          <div class="sf-menu__content">
            <section class="sf-menu__page" data-menu-page="operation">
              <div class="sf-menu__pagehead"><span>ACTIVE DIRECTIVE</span><h3 data-operation-heading>THE GILDED SILENCE</h3><p data-operation-copy>Silence the vox-relays and contain the Bloom.</p></div>
              <div class="sf-operation-grid">
                <article class="sf-operation-card sf-operation-card--objective"><small>PRIORITY OBJECTIVE</small><strong data-operation-objective>Reading field order…</strong><span data-operation-distance>—</span></article>
                <article class="sf-operation-card"><small>VOX-RELAYS</small><strong data-operation-relays>0 / 3</strong><span>Silenced</span></article>
                <article class="sf-operation-card"><small>REINFORCEMENTS</small><strong data-operation-reinforcements>5</strong><span>Available</span></article>
                <article class="sf-operation-card"><small>MISSION CLOCK</small><strong data-operation-clock>00:00</strong><span>Elapsed</span></article>
                <article class="sf-operation-card sf-operation-card--breach"><small>BLOOM CONTAINMENT</small><strong data-operation-breach>Signal quiet</strong><span data-operation-breach-detail>No active rupture</span></article>
              </div>
              <div class="sf-menu__callout"><span>FIELD DOCTRINE</span><p>Hold <kbd>TAB</kbd>, point toward a command sigil, then release to confirm. The basin enters command stasis while the wheel is open.</p></div>
            </section>
            <section class="sf-menu__page sf-menu__page--map" data-menu-page="map" hidden>
              <div class="sf-menu__pagehead"><span>LIVE BASIN OVERVIEW</span><h3>TACTICAL MAP</h3><p>The whole two-kilometre basin, rendered from the authored terrain. North stays fixed.</p></div>
              <div class="sf-map-page">
                <figure class="sf-map-page__surface">
                  <header><span><small>VESPER-IX</small><strong>WHOLE-BASIN SURVEY</strong></span><b data-map-detail-range>—</b></header>
                  <canvas id="sf-map-canvas-large" width="720" height="720" role="img" aria-label="Large tactical map of Vesper-IX"></canvas>
                  <figcaption class="sf-map-page__legend"><span data-kind="player">RELIQUARY</span><span data-kind="objective">OBJECTIVE</span><span data-kind="relay">RELAY</span><span data-kind="breach">BLOOM</span></figcaption>
                </figure>
                <aside class="sf-map-page__orders" aria-label="Objective list">
                  <header><span>FIELD ORDERS</span><b data-map-order-count>0 / 3</b></header>
                  <div class="sf-map-page__list" data-map-objectives></div>
                  <p><kbd>M</kbd> CLOSE MAP · <kbd>ESC</kbd> RESUME</p>
                </aside>
              </div>
            </section>
            <section class="sf-menu__page" data-menu-page="saves" hidden>
              <div class="sf-menu__pagehead"><span>FIELD RECORDS</span><h3>SAVE / LOAD</h3><p>Three manual reliquaries and one automatic field record.</p></div>
              <div class="sf-save-grid">
                ${slotMarkup("autosave", -1, "AUTOSAVE")}
                ${slotMarkup("manual", 0, "FIELD SLOT I")}
                ${slotMarkup("manual", 1, "FIELD SLOT II")}
                ${slotMarkup("manual", 2, "FIELD SLOT III")}
              </div>
              <p class="sf-save-reason" data-save-reason></p>
            </section>
            <section class="sf-menu__page" data-menu-page="controls" hidden>
              <div class="sf-menu__pagehead"><span>TACTICAL CODEX</span><h3>CONTROLS</h3><p>Every field action, grouped by intent.</p></div>
              <div class="sf-controls-grid">
                <article><h4>MOVEMENT</h4>${controlRow("W A S D", "Move")}${controlRow("SHIFT", "Sprint")}${controlRow("CTRL / C", "Crouch", "Descend while airborne")}${controlRow("SPACE", "Vault")}${controlRow("SHIFT + SPACE", "Reliquary jetpack")}${controlRow("E", "Boost slide")}</article>
                <article><h4>COMBAT</h4>${controlRow("MOUSE", "Look / aim")}${controlRow("LMB", "Fire")}${controlRow("RMB", "Aim down sights")}${controlRow("Q", "Censer-lance strike")}${controlRow("X", "Aegis block")}${controlRow("R", "Vent weapon heat")}</article>
                <article><h4>COMMAND</h4>${controlRow("HOLD TAB", "Command wheel", "Point and release to confirm")}${controlRow("ESC", "Field menu")}${controlRow("M", "Tactical map", "Press again to resume")}${controlRow("TOUCH", "Hold the command sigil", "Drag and release to confirm")}</article>
              </div>
            </section>
            <section class="sf-menu__page" data-menu-page="settings" hidden>
              <div class="sf-menu__pagehead"><span>FIELD CONFIGURATION</span><h3>SETTINGS</h3><p>Readability and presentation preferences are saved on this device.</p></div>
              <div class="sf-settings-list">
                <div class="sf-setting"><span><strong>FIELD AUDIO</strong><small>Music, weapons, ambience, and interface cues</small></span><button type="button" role="switch" data-setting="sound" aria-label="Field audio" aria-checked="true">ON</button></div>
                <div class="sf-setting"><span><strong id="sf-hud-scale-label">HUD SCALE</strong><small>Increase tactical instrument size</small></span><div class="sf-setting__segments" role="group" aria-labelledby="sf-hud-scale-label"><button type="button" data-hud-scale="standard" aria-label="Standard HUD scale">STANDARD</button><button type="button" data-hud-scale="large" aria-label="Large HUD scale">LARGE</button></div></div>
                <div class="sf-setting"><span><strong>REDUCED MOTION</strong><small>Calmer interface transitions and pulses</small></span><button type="button" role="switch" data-setting="reduced-motion" aria-label="Reduced motion" aria-checked="false">OFF</button></div>
                <div class="sf-setting"><span><strong>HIGH CONTRAST</strong><small>Stronger text, panel, and instrument separation</small></span><button type="button" role="switch" data-setting="high-contrast" aria-label="High contrast" aria-checked="false">OFF</button></div>
              </div>
            </section>
          </div>
        </div>
        <footer class="sf-menu__footer"><span data-menu-context>FIELD STATE PAUSED</span><span><kbd>ESC</kbd> RESUME · <kbd>TAB</kbd> NAVIGATE</span></footer>
      </div>
    </div>
    <div class="sf-native-ui__live" data-ui-live aria-live="polite" aria-atomic="true"></div>`;
  stage.append(root);

  const wheelEl = root.querySelector("#sf-command-wheel");
  const dialEl = root.querySelector(".sf-command-wheel__dial");
  const cursorEl = root.querySelector(".sf-command-wheel__cursor");
  const wheelStatusEl = root.querySelector("[data-wheel-status]");
  const commandEls = Array.from(root.querySelectorAll(".sf-command-wheel__option"));
  const menuEl = root.querySelector("#sf-menu");
  const largeMapCanvas = root.querySelector("#sf-map-canvas-large");
  const largeMapRange = root.querySelector("[data-map-detail-range]");
  const maximizeButton = root.querySelector('[data-menu-action="maximize"]');
  const maximizeLabel = root.querySelector("[data-maximize-label]");
  const liveEl = root.querySelector("[data-ui-live]");
  const surface = stage.closest(".rb-standalone-surface") || stage;
  const settings = readSettings();
  const wheel = {
    open: false, selectedIndex: -1, source: null, x: 0, y: 0,
    deadZone: 42, maxRadius: 132, pointerId: null, touchOrigin: null,
    openedLocked: false, dispatchSeq: 0, lastDispatch: null, cancelReason: null,
  };
  const menu = {
    open: false, panel: "operation", lastFocus: null, restartUntil: 0,
    ariaRestore: null, returnToPointerLock: false,
  };
  const clearedUntil = new Map();
  const pendingTimers = new Set();
  const touchBindings = new Map();
  let saveData = { autosave: null, manuals: [null, null, null] };
  let updateClock = 0;
  let announceRaf = 0;
  let focusRaf = 0;
  let destroyed = false;

  function scheduleUiTimeout(callback, delay) {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (!destroyed) callback();
    }, delay);
    pendingTimers.add(timer);
    return timer;
  }

  function menuSfx(name) {
    try { void window.RBSfx?.play?.(name, { volume: 0.34, throttleMs: 25 }); } catch (_) { /* optional */ }
  }

  function wheelSfx(kind, index = 0) {
    try {
      if (kind === "open") ctx.audio?.chord?.([196, 294, 392], 0.22, 0.08);
      else if (kind === "select") ctx.audio?.blip?.(520 + index * 170, 0.045, 0.09, "triangle");
      else if (kind === "confirm") ctx.audio?.chord?.([392, 587, 784], 0.24, 0.1);
      else ctx.audio?.chord?.([220, 165], 0.16, 0.07);
    } catch (_) { /* optional */ }
  }

  function announce(message) {
    if (destroyed) return;
    liveEl.textContent = "";
    if (announceRaf) cancelAnimationFrame(announceRaf);
    announceRaf = requestAnimationFrame(() => {
      announceRaf = 0;
      if (!destroyed && liveEl.isConnected) liveEl.textContent = message;
    });
  }

  function audioEnabled() {
    if (window.RBSfx?.isMuted) return !window.RBSfx.isMuted();
    return ctx.audio?.enabled !== false;
  }

  function applySettings() {
    stage.dataset.sfHudScale = settings.hudScale;
    document.body.dataset.sfHudScale = settings.hudScale;
    document.body.classList.toggle("sf-reduced-motion", settings.reducedMotion);
    document.body.classList.toggle("sf-high-contrast", settings.highContrast);
    const sound = root.querySelector('[data-setting="sound"]');
    const enabled = audioEnabled();
    ctx.audio?.setEnabled?.(enabled);
    sound.setAttribute("aria-checked", enabled ? "true" : "false");
    sound.textContent = enabled ? "ON" : "OFF";
    for (const [name, value] of [["reduced-motion", settings.reducedMotion], ["high-contrast", settings.highContrast]]) {
      const button = root.querySelector(`[data-setting="${name}"]`);
      button.setAttribute("aria-checked", value ? "true" : "false");
      button.textContent = value ? "ON" : "OFF";
    }
    root.querySelectorAll("[data-hud-scale]").forEach((button) => {
      const active = button.dataset.hudScale === settings.hudScale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function toggleAudio(forced) {
    if (destroyed) return audioEnabled();
    const enabled = typeof forced === "boolean" ? forced : !audioEnabled();
    if (!enabled) menuSfx("toggle");
    window.RBSfx?.setMuted?.(!enabled);
    ctx.audio?.setEnabled?.(enabled);
    applySettings();
    if (enabled) menuSfx("toggle");
    announce(enabled ? "Field audio enabled" : "Field audio muted");
    return enabled;
  }

  function updateCommands() {
    commandEls.forEach((button, index) => {
      const key = order[index];
      const remaining = Math.max(0, Number(ctx.mission.cooldowns?.[key]) || 0);
      const ready = remaining <= 0.001;
      button.dataset.state = ready ? "ready" : "cooldown";
      button.querySelector("[data-command-status]").textContent = ready ? "READY" : `${Math.ceil(remaining)}s`;
      button.setAttribute("aria-label", `${ctx.mission.stratagems?.[key]?.name || key}, ${ready ? "ready" : `${Math.ceil(remaining)} seconds`}`);
    });
  }

  function setWheelSelection(index, { sound = true } = {}) {
    const next = Number.isInteger(index) && index >= 0 && index < order.length ? index : -1;
    if (next === wheel.selectedIndex) return;
    wheel.selectedIndex = next;
    const key = next >= 0 ? order[next] : null;
    wheelEl.dataset.selection = key || "";
    commandEls.forEach((button, i) => {
      const selected = i === next;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    wheelStatusEl.textContent = key ? (ctx.mission.stratagems?.[key]?.short || key).toUpperCase() : "DRAG TO SELECT";
    if (next >= 0 && sound) wheelSfx("select", next);
  }

  function selectFromVector(x, y) {
    const magnitude = Math.hypot(x, y);
    const scale = magnitude > wheel.maxRadius ? wheel.maxRadius / magnitude : 1;
    /* Clamp the logical vector as well as the drawn cursor. Otherwise one
       large mouse flick stores hundreds of invisible pixels and makes the
       player drag that entire distance back before another sector responds. */
    wheel.x = x * scale;
    wheel.y = y * scale;
    cursorEl.style.setProperty("--sf-command-x", `${wheel.x.toFixed(1)}px`);
    cursorEl.style.setProperty("--sf-command-y", `${wheel.y.toFixed(1)}px`);
    if (magnitude < wheel.deadZone) { setWheelSelection(-1); return -1; }
    const ux = x / magnitude;
    const uy = y / magnitude;
    let best = 0;
    let score = -Infinity;
    WHEEL_POINTS.slice(0, order.length).forEach((point, index) => {
      const dot = ux * point.x + uy * point.y;
      if (dot > score) { score = dot; best = index; }
    });
    setWheelSelection(best);
    return best;
  }

  function canOpenWheel() {
    return !menu.open && !ctx.combat?.player?.dead && ctx.runtime?.phase === "playing"
      && !ctx.intro?.isBlocking?.() && !document.hidden;
  }

  function ownsGameKeyboard() {
    return document.pointerLockElement === canvas
      || ctx.player?.input?.state?.locked
      || document.activeElement === canvas
      || document.documentElement.classList.contains("sf-maximised");
  }

  function isMaximized() {
    return !!document.fullscreenElement
      || stage.classList.contains("is-maxed")
      || document.documentElement.classList.contains("sf-maximised")
      || document.body.classList.contains("rb-game-maxed");
  }

  function syncMaximizeButton() {
    const active = isMaximized();
    if (maximizeLabel) maximizeLabel.textContent = active ? "EXIT MAX SCREEN" : "MAXIMIZE GAME";
    if (maximizeButton) {
      maximizeButton.setAttribute("aria-label", active ? "Exit max screen" : "Maximize game");
      maximizeButton.setAttribute("aria-pressed", active ? "true" : "false");
      maximizeButton.dataset.state = active ? "maximized" : "embedded";
    }
    return active;
  }

  function setMaximized(active) {
    stage.classList.toggle("is-maxed", active);
    document.documentElement.classList.toggle("sf-maximised", active);
    document.body.classList.toggle("rb-game-maxed", active);
    syncMaximizeButton();
    if (active && !document.fullscreenElement && surface.requestFullscreen) {
      try { surface.requestFullscreen().catch(() => false); } catch (_) { /* CSS fallback remains active. */ }
    } else if (!active && document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen().catch(() => false); } catch (_) { /* CSS state already restored. */ }
    }
    window.dispatchEvent(new Event("resize"));
    return active;
  }

  function toggleMaximized() {
    const active = !isMaximized();
    closeMenu({ requestLock: false });
    setMaximized(active);
    announce(active ? "Max screen enabled" : "Embedded view restored");
    return active;
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement) {
      stage.classList.remove("is-maxed");
      document.documentElement.classList.remove("sf-maximised");
      document.body.classList.remove("rb-game-maxed");
      window.dispatchEvent(new Event("resize"));
    }
    syncMaximizeButton();
  }

  function openWheel(source = "keyboard", origin = null) {
    if (destroyed || wheel.open || !canOpenWheel()) return false;
    wheel.open = true;
    wheel.source = source;
    wheel.x = 0;
    wheel.y = 0;
    wheel.pointerId = origin?.pointerId ?? null;
    wheel.touchOrigin = origin ? { x: origin.x, y: origin.y } : null;
    wheel.openedLocked = document.pointerLockElement === canvas;
    wheel.cancelReason = null;
    setWheelSelection(-1, { sound: false });
    cursorEl.style.setProperty("--sf-command-x", "0px");
    cursorEl.style.setProperty("--sf-command-y", "0px");
    updateCommands();
    wheelEl.hidden = false;
    wheelEl.setAttribute("aria-hidden", "false");
    wheelEl.dataset.open = "true";
    document.body.classList.add("sf-command-open");
    ctx.player?.input?.clearAll?.();
    touch?.releaseAll?.();
    wheelSfx("open");
    announce("Command wheel open. Point to a command and release to confirm.");
    return true;
  }

  function closeWheel({ confirm = false, reason = "cancelled" } = {}) {
    if (destroyed || !wheel.open) return false;
    const index = wheel.selectedIndex;
    const key = index >= 0 ? order[index] : null;
    wheel.open = false;
    wheel.pointerId = null;
    wheel.touchOrigin = null;
    wheel.cancelReason = confirm ? null : reason;
    wheelEl.hidden = true;
    wheelEl.setAttribute("aria-hidden", "true");
    wheelEl.dataset.open = "false";
    document.body.classList.remove("sf-command-open");
    ctx.player?.input?.clearAll?.();
    setWheelSelection(-1, { sound: false });
    if (confirm && key) {
      const result = ctx.mission.call(key);
      if (result) wheel.dispatchSeq += 1;
      wheel.lastDispatch = {
        seq: wheel.dispatchSeq, key, result, accepted: !!result, at: performance.now(),
      };
      wheelSfx(result ? "confirm" : "cancel");
      announce(result ? `${ctx.mission.stratagems?.[key]?.name || key} inbound` : `${ctx.mission.stratagems?.[key]?.name || key} unavailable`);
      return result || false;
    }
    wheelSfx("cancel");
    announce(key ? "Command cancelled" : "Command wheel closed without selection");
    return false;
  }

  const cancelWheel = (reason = "cancelled") => closeWheel({ confirm: false, reason });

  function setPanel(panel, { focus = false } = {}) {
    const next = PANEL_NAMES.has(panel) ? panel : "operation";
    menu.panel = next;
    menuEl.dataset.panel = next;
    root.querySelectorAll("[data-menu-panel]").forEach((button) => {
      const active = button.dataset.menuPanel === next;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      button.classList.toggle("is-active", active);
    });
    root.querySelectorAll("[data-menu-page]").forEach((page) => {
      page.hidden = page.dataset.menuPage !== next;
    });
    if (next === "saves") refreshSaves();
    if (next === "operation") refreshOperation();
    if (next === "map") {
      refreshMap();
      requestAnimationFrame(() => { if (!destroyed && menu.open && menu.panel === "map") refreshMap(); });
    }
    if (focus) root.querySelector(`[data-menu-page="${next}"] h3`)?.focus?.();
    menuSfx("switch");
  }

  function refreshMap() {
    const state = ctx.mission.state || {};
    const objective = ctx.mission.objective?.();
    const breach = ctx.breaches?.status?.();
    const relayTotal = ctx.mission.relays?.length || 3;
    const relayDone = Math.max(0, state.relaysDone || 0);
    const objectiveDone = !objective && state.phase === "won";
    const breachDone = !!breach?.complete;
    const relaysDone = relayDone >= relayTotal;
    const completed = [objectiveDone, breachDone, relaysDone].filter(Boolean).length;
    const breachActive = !!breach && ["warning", "active"].includes(breach.phase);
    let breachProgress = breachDone ? 1 : 0;
    if (breach?.boss) breachProgress = 1 - breach.boss.health / Math.max(1, breach.boss.maxHealth);
    else if (breach?.phase === "active" && breach.total) {
      breachProgress = 1 - Math.max(0, breach.remaining || 0) / breach.total;
    } else if (breach?.phase === "warning") {
      breachProgress = 1 - Math.max(0, breach.timer || 0) / Math.max(1, ctx.breaches?.config?.warningSeconds || 1);
    }
    const items = [
      {
        index: "01", kicker: "PRIORITY DIRECTIVE",
        title: objective?.name || (objectiveDone ? "OPERATION COMPLETE" : "AWAITING FIELD ORDER"),
        detail: objective ? `${Math.round(objective.dist || 0)}m from reliquary` : "No active destination",
        progress: objective?.progress || (objectiveDone ? 1 : 0),
        state: objectiveDone ? "complete" : "active",
      },
      {
        index: "02", kicker: "BLOOM CONTAINMENT",
        title: breachDone ? "SIGNAL SEVERED" : breachActive
          ? (breach?.name || "RUPTURE DETECTED") : "SIGNAL QUIET",
        detail: breachDone ? "All breach signatures neutralized" : breach?.phase === "warning"
          ? `Emergence in ${Math.ceil(breach.timer || 0)} seconds` : breach?.phase === "active"
            ? `${Math.max(0, breach.remaining || 0)} hostiles remain` : "Monitoring the basin",
        progress: breachProgress,
        state: breachDone ? "complete" : breachActive ? "threat" : "idle",
      },
      {
        index: "03", kicker: "VOX-RELAY NETWORK",
        title: relaysDone ? "NETWORK SILENCED" : `${relayDone} OF ${relayTotal} RELAYS SILENCED`,
        detail: relaysDone ? "The Cathedral signal is exposed" : "Relay sites remain marked on the field",
        progress: relayDone / Math.max(1, relayTotal),
        state: relaysDone ? "complete" : "active",
      },
    ];
    const list = root.querySelector("[data-map-objectives]");
    if (list) list.innerHTML = items.map((item) => `<article class="sf-map-order" data-state="${item.state}" style="--sf-order-progress:${clamp(item.progress, 0, 1)}">
      <i aria-hidden="true">${item.index}</i><span><small>${item.kicker}</small><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.detail)}</em></span>
      <b aria-label="${Math.round(clamp(item.progress, 0, 1) * 100)} percent complete"></b></article>`).join("");
    const count = root.querySelector("[data-map-order-count]");
    if (count) count.textContent = `${completed} / 3`;
    const semantic = ctx.hud?.redrawTacticalMap?.(largeMapCanvas);
    if (largeMapRange) largeMapRange.textContent = semantic?.range
      ? `${Math.round(semantic.range)}M BASIN` : "FIELD SURVEY";
    return semantic;
  }

  function refreshOperation() {
    const state = ctx.mission.state || {};
    const objective = ctx.mission.objective?.();
    const breach = ctx.breaches?.status?.();
    const phase = state.phase || "relays";
    menuEl.dataset.phase = phase;
    const heading = root.querySelector("[data-operation-heading]");
    const copy = root.querySelector("[data-operation-copy]");
    if (phase === "won") {
      heading.textContent = "EXTRACTION COMPLETE";
      copy.textContent = "The standing order is broken. Vesper-IX releases you.";
    } else if (phase === "lost") {
      heading.textContent = "OPERATION FAILED";
      copy.textContent = "The reliquary is dark. Restart the operation to return.";
    } else if (phase === "extract") {
      heading.textContent = "REACH EXTRACTION";
      copy.textContent = "Hold the Fallen Saint until the shuttle can lift.";
    } else {
      heading.textContent = "THE GILDED SILENCE";
      copy.textContent = "Silence every vox-relay and contain the Bloom.";
    }
    root.querySelector("[data-operation-objective]").textContent = objective?.name || "Awaiting field order";
    root.querySelector("[data-operation-distance]").textContent = objective ? `${Math.round(objective.dist || 0)}m from current position` : "No active directive";
    root.querySelector("[data-operation-relays]").textContent = `${state.relaysDone || 0} / ${ctx.mission.relays?.length || 3}`;
    root.querySelector("[data-operation-reinforcements]").textContent = String(Math.max(0, state.reinforcements ?? 0));
    root.querySelector("[data-operation-clock]").textContent = formatClock(state.elapsed);
    const breachActive = !!breach && !breach.complete
      && !["dormant", "complete"].includes(breach.phase);
    const breachName = breach?.complete ? "BLOOM SEVERED"
      : breachActive ? (breach.phase === "warning" ? "RUPTURE INCOMING" : `BREACH ${breach.wave || 1}`)
        : "SIGNAL QUIET";
    root.querySelector("[data-operation-breach]").textContent = breachName;
    root.querySelector("[data-operation-breach-detail]").textContent = breachActive
      ? (breach.phase === "warning" ? `${Math.ceil(breach.timer || 0)} seconds to emergence`
        : `${Math.max(0, breach.remaining || 0)} hostiles remain`)
      : breach?.complete ? "Containment objective complete" : "No active rupture";
  }

  function refreshSaves() {
    try { saveData = save?.read?.() || saveData; } catch (_) { /* keep cache */ }
    root.querySelectorAll(".sf-save-slot").forEach((slotEl) => {
      const kind = slotEl.dataset.saveKind;
      const index = Number(slotEl.dataset.saveIndex);
      const record = kind === "autosave" ? saveData.autosave : saveData.manuals?.[index];
      const snapshot = record?.snapshot;
      slotEl.classList.toggle("has-save", !!snapshot);
      slotEl.querySelector("[data-slot-state]").textContent = snapshot ? "RECORDED" : "EMPTY";
      slotEl.querySelector("[data-slot-district]").textContent = snapshot?.summary?.district || "No field record";
      slotEl.querySelector("[data-slot-progress]").textContent = snapshot
        ? `${snapshot.summary?.relays || "0/3"} relays · ${snapshot.summary?.breach || "Signal quiet"} · Vitality ${snapshot.summary?.vitality || "—"}`
        : "Awaiting deployment state";
      slotEl.querySelector("[data-slot-time]").textContent = snapshot
        ? `${formatSavedAt(snapshot.timestamp)} · ${formatClock(snapshot.summary?.elapsed)}` : "—";
      const load = slotEl.querySelector('[data-save-action="load"]');
      const clear = slotEl.querySelector('[data-save-action="clear"]');
      const write = slotEl.querySelector('[data-save-action="save"]');
      if (load) load.disabled = !snapshot;
      if (clear) {
        clear.disabled = !snapshot;
        clear.textContent = (clearedUntil.get(`clear:${index}`) || 0) > performance.now()
          ? "CONFIRM CLEAR" : "CLEAR";
      }
      if (write) {
        write.disabled = !save?.canSave?.();
        const overwriteArmed = (clearedUntil.get(`overwrite:${index}`) || 0) > performance.now();
        write.textContent = snapshot
          ? (overwriteArmed ? "CONFIRM OVERWRITE" : "OVERWRITE") : "SAVE";
      }
    });
    const reason = root.querySelector("[data-save-reason]");
    if (reason) {
      const ready = !!save?.canSave?.();
      reason.dataset.ready = ready ? "1" : "0";
      reason.textContent = ready
        ? "FIELD STATE STABLE · MANUAL SAVE AVAILABLE"
        : save?.saveReason?.() || "FIELD SAVE CURRENTLY UNAVAILABLE";
    }
  }

  function setMenuInert(value) {
    const touchHost = touch?.host || stage.querySelector("#sf-touch");
    if (value) {
      menu.ariaRestore = {
        canvas: canvas.getAttribute("aria-hidden"),
        touch: touchHost?.getAttribute("aria-hidden") ?? null,
      };
      canvas.inert = true;
      canvas.setAttribute("aria-hidden", "true");
      if (touchHost) {
        touchHost.inert = true;
        touchHost.setAttribute("aria-hidden", "true");
      }
      return;
    }
    canvas.inert = false;
    if (menu.ariaRestore?.canvas === null) canvas.removeAttribute("aria-hidden");
    else canvas.setAttribute("aria-hidden", menu.ariaRestore?.canvas || "false");
    if (touchHost) {
      touchHost.inert = false;
      if (menu.ariaRestore?.touch === null) touchHost.removeAttribute("aria-hidden");
      else touchHost.setAttribute("aria-hidden", menu.ariaRestore?.touch || "false");
    }
    menu.ariaRestore = null;
  }

  function openMenu(panel = "operation", { force = false } = {}) {
    if (destroyed) return false;
    if (menu.open) { setPanel(panel); return true; }
    if (!force && (ctx.runtime?.phase !== "playing" || ctx.intro?.isBlocking?.())) return false;
    cancelWheel("menu");
    menu.open = true;
    menu.lastFocus = document.activeElement;
    menu.returnToPointerLock = document.pointerLockElement === canvas
      || document.activeElement === canvas || document.documentElement.classList.contains("sf-maximised");
    menuEl.hidden = false;
    menuEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("rb-escape-menu-open");
    ctx.player?.input?.clearAll?.();
    touch?.releaseAll?.();
    setMenuInert(true);
    if (document.pointerLockElement) document.exitPointerLock?.();
    refreshOperation();
    refreshSaves();
    applySettings();
    syncMaximizeButton();
    setPanel(panel);
    if (focusRaf) cancelAnimationFrame(focusRaf);
    focusRaf = requestAnimationFrame(() => {
      focusRaf = 0;
      if (!destroyed && menu.open) root.querySelector("[data-menu-close]")?.focus();
    });
    menuSfx("open");
    announce("Field menu open. Operation paused.");
    return true;
  }

  function closeMenu({ requestLock = false } = {}) {
    if (destroyed || !menu.open) return false;
    menuSfx("close");
    menu.open = false;
    menu.restartUntil = 0;
    const restart = root.querySelector('[data-menu-action="restart"]');
    if (restart) restart.textContent = "RESTART OPERATION";
    menuEl.hidden = true;
    menuEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("rb-escape-menu-open");
    setMenuInert(false);
    ctx.player?.input?.clearAll?.();
    announce("Operation resumed");
    const shouldRequestLock = requestLock && menu.returnToPointerLock;
    if (shouldRequestLock && canvas.requestPointerLock) {
      try {
        const lock = canvas.requestPointerLock();
        lock?.catch?.(() => false);
      } catch (_) { /* browser policy */ }
    } else if (menu.lastFocus?.isConnected) {
      menu.lastFocus.focus?.({ preventScroll: true });
    }
    menu.lastFocus = null;
    menu.returnToPointerLock = false;
    return true;
  }

  function openMap() {
    if (destroyed) return false;
    if (menu.open) {
      if (menu.panel === "map") return closeMenu({ requestLock: true });
      setPanel("map");
      return true;
    }
    return openMenu("map");
  }

  function focusableMenuItems() {
    return Array.from(menuEl.querySelectorAll('button:not([disabled]), [href], select, input, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => {
        if (element.disabled || element.inert || element.closest("[hidden], [inert]")) return false;
        if (!element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden"
          && Number(style.opacity) !== 0;
      });
  }

  function trapFocus(event) {
    const items = focusableMenuItems();
    if (!items.length) { event.preventDefault(); menuEl.focus?.(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    const index = items.indexOf(current);
    if (index < 0) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && index === items.length - 1) {
      event.preventDefault(); first.focus();
    }
  }

  function handleSaveAction(button) {
    const slotEl = button.closest(".sf-save-slot");
    const kind = slotEl.dataset.saveKind;
    const index = Number(slotEl.dataset.saveIndex);
    const action = button.dataset.saveAction;
    const record = kind === "autosave" ? saveData.autosave : saveData.manuals?.[index];
    let ok = false;
    if (action === "save") {
      const key = `overwrite:${index}`;
      if (record?.snapshot && (clearedUntil.get(key) || 0) < performance.now()) {
        clearedUntil.set(key, performance.now() + 4000);
        button.textContent = "CONFIRM OVERWRITE";
        menuSfx("question");
        announce(`Press overwrite again to replace field slot ${index + 1}`);
        scheduleUiTimeout(() => {
          if ((clearedUntil.get(key) || 0) <= performance.now()) {
            clearedUntil.delete(key);
            if (menu.open && menu.panel === "saves") refreshSaves();
          }
        }, 4100);
        return;
      }
      clearedUntil.delete(key);
      ok = !!save?.saveManual?.(index);
    }
    else if (action === "load") ok = !!save?.load?.(kind, index);
    else if (action === "clear") {
      const key = `clear:${index}`;
      if ((clearedUntil.get(key) || 0) < performance.now()) {
        clearedUntil.set(key, performance.now() + 4000);
        button.textContent = "CONFIRM CLEAR";
        menuSfx("question");
        scheduleUiTimeout(() => {
          if ((clearedUntil.get(key) || 0) <= performance.now()) {
            clearedUntil.delete(key);
            if (menu.open && menu.panel === "saves") refreshSaves();
          }
        }, 4100);
        return;
      }
      ok = !!save?.clearManual?.(index);
      clearedUntil.delete(key);
    }
    refreshSaves();
    menuSfx(ok ? "confirm" : "error");
    announce(ok ? (action === "load" ? "Field state restored" : "Field record updated") : "Field record action unavailable");
    if (ok && action === "load") closeMenu({ requestLock: true });
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-menu-open]")) { openMenu("operation"); return; }
    if (target.matches("[data-menu-close]")) { closeMenu({ requestLock: true }); return; }
    if (target.matches("[data-menu-panel]")) { setPanel(target.dataset.menuPanel); return; }
    if (target.matches("[data-save-action]")) { handleSaveAction(target); return; }
    if (target.matches("[data-wheel-cancel]")) { cancelWheel("center"); return; }
    if (target.matches(".sf-command-wheel__option")) {
      setWheelSelection(Number(target.dataset.index));
      closeWheel({ confirm: true, reason: "pointer" });
      return;
    }
    if (target.matches('[data-setting="sound"]')) { toggleAudio(); return; }
    if (target.matches('[data-setting="reduced-motion"]')) {
      settings.reducedMotion = !settings.reducedMotion;
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches('[data-setting="high-contrast"]')) {
      settings.highContrast = !settings.highContrast;
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches("[data-hud-scale]")) {
      settings.hudScale = target.dataset.hudScale === "large" ? "large" : "standard";
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches('[data-menu-action="maximize"]')) { toggleMaximized(); return; }
    if (target.matches('[data-menu-action="restart"]')) {
      if (menu.restartUntil > performance.now()) { window.location.reload(); return; }
      menu.restartUntil = performance.now() + 4500;
      target.textContent = "CONFIRM RESTART";
      menuSfx("question");
      announce("Press restart again to confirm");
      scheduleUiTimeout(() => {
        if (menu.restartUntil && menu.restartUntil <= performance.now()) {
          menu.restartUntil = 0;
          const restart = root.querySelector('[data-menu-action="restart"]');
          if (restart) restart.textContent = "RESTART OPERATION";
        }
      }, 4600);
      return;
    }
    if (target.matches('[data-menu-action="return"]')) window.location.assign("../games.html");
  });

  commandEls.forEach((button) => {
    button.addEventListener("pointerenter", () => {
      if (wheel.open) setWheelSelection(Number(button.dataset.index));
    });
  });

  function onKeyDown(event) {
    if (menu.open) {
      const interactiveTarget = event.target instanceof Element
        && !!event.target.closest("button, a, input, select, textarea,"
          + " [role='button'], [role='switch'], [role='tab']");
      if (event.code === "KeyM") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) openMap();
      } else if (event.code === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        closeMenu({ requestLock: true });
      } else if (event.code === "Tab") {
        trapFocus(event);
        event.stopImmediatePropagation();
      } else if (!interactiveTarget
        && ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyQ", "KeyE", "KeyR", "KeyX"].includes(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (wheel.open) {
      if (event.code === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); cancelWheel("escape"); return;
      }
      if (event.code === "Tab") { event.preventDefault(); event.stopImmediatePropagation(); return; }
      /* Keyboard directions address the wheel's visible sectors directly;
         they are not next/previous controls. Down shares the lower-right
         Cluster sector, the deterministic side of the bottom boundary. */
      const directionIndex = ({
        ArrowUp: 0, KeyW: 0,
        ArrowRight: 1, ArrowDown: 1, KeyD: 1, KeyS: 1,
        ArrowLeft: 2, KeyA: 2,
      })[event.code];
      if (Number.isInteger(directionIndex)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) setWheelSelection(Math.min(directionIndex, order.length - 1));
        return;
      }
      if (/^Digit[1-3]$/.test(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation(); setWheelSelection(Number(event.code.slice(-1)) - 1);
      }
      return;
    }
    if (event.code === "Escape") {
      if (openMenu("operation", { force: true })) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (event.code === "KeyM") {
      if (!ownsGameKeyboard()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) openMap();
      return;
    }
    if (event.code === "Tab") {
      if (!ownsGameKeyboard()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) openWheel("keyboard");
    }
  }

  function onKeyUp(event) {
    if (menu.open) {
      if (event.code === "Tab" || event.code === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (event.code === "Tab" && wheel.open && wheel.source === "keyboard") {
      event.preventDefault(); event.stopImmediatePropagation();
      closeWheel({ confirm: wheel.selectedIndex >= 0, reason: "tab-release" });
    }
  }

  function onMouseMove(event) {
    if (!wheel.open || wheel.source !== "keyboard") return;
    event.stopImmediatePropagation();
    if (document.pointerLockElement === canvas) {
      selectFromVector(wheel.x + event.movementX, wheel.y + event.movementY);
    } else {
      const rect = dialEl.getBoundingClientRect();
      selectFromVector(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    }
  }

  function attachTouchCommand(button) {
    if (destroyed || touchBindings.has(button)) return;
    button.dataset.sfCommandBound = "true";
    const onTouchCommandDown = (event) => {
      if (!openWheel("touch", { pointerId: event.pointerId, x: event.clientX, y: event.clientY })) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* best effort */ }
    };
    const onTouchCommandKeyDown = (event) => {
      if (event.repeat || !["Enter", "Space"].includes(event.code)) return;
      event.preventDefault();
      if (openWheel("touch-keyboard")) setWheelSelection(0);
    };
    const onTouchCommandKeyUp = (event) => {
      if (!["Enter", "Space"].includes(event.code) || !wheel.open || wheel.source !== "touch-keyboard") return;
      event.preventDefault(); closeWheel({ confirm: true, reason: "touch-keyboard" });
    };
    touchBindings.set(button, {
      pointerdown: onTouchCommandDown,
      keydown: onTouchCommandKeyDown,
      keyup: onTouchCommandKeyUp,
    });
    button.addEventListener("pointerdown", onTouchCommandDown, { passive: false });
    button.addEventListener("keydown", onTouchCommandKeyDown);
    button.addEventListener("keyup", onTouchCommandKeyUp);
  }

  function detachTouchCommands() {
    for (const [button, binding] of touchBindings) {
      button.removeEventListener("pointerdown", binding.pointerdown);
      button.removeEventListener("keydown", binding.keydown);
      button.removeEventListener("keyup", binding.keyup);
      delete button.dataset.sfCommandBound;
    }
    touchBindings.clear();
  }

  stage.querySelectorAll("[data-touch-command]").forEach(attachTouchCommand);
  const touchObserver = new MutationObserver(() => {
    stage.querySelectorAll("[data-touch-command]").forEach(attachTouchCommand);
  });
  touchObserver.observe(stage, { childList: true, subtree: true });

  function onPointerMove(event) {
    if (!wheel.open || wheel.source !== "touch" || event.pointerId !== wheel.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selectFromVector(event.clientX - wheel.touchOrigin.x, event.clientY - wheel.touchOrigin.y);
  }

  function onPointerEnd(event) {
    if (!wheel.open || wheel.source !== "touch" || event.pointerId !== wheel.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    closeWheel({ confirm: event.type === "pointerup" && wheel.selectedIndex >= 0, reason: event.type });
  }

  function onWindowBlur() { cancelWheel("blur"); }
  function onVisibilityChange() {
    if (document.hidden) cancelWheel("visibility");
  }
  function onPointerLockChange() {
    if (wheel.open && wheel.openedLocked && document.pointerLockElement !== canvas) {
      cancelWheel("pointer-lock");
    }
  }
  function onSfxMuted() {
    if (destroyed) return;
    ctx.audio?.setEnabled?.(audioEnabled());
    applySettings();
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("rainbot:sfx-muted", onSfxMuted);

  const stopWon = ctx.mission.bus?.on?.("won", () => {
    scheduleUiTimeout(() => openMenu("operation", { force: true }), 900);
  });
  const stopLost = ctx.mission.bus?.on?.("lost", () => {
    scheduleUiTimeout(() => openMenu("operation", { force: true }), 900);
  });
  const stopSave = save?.onChange?.((result) => {
    refreshSaves();
    if (result?.message) announce(result.message);
  });

  function update(dt = 0) {
    if (destroyed) return;
    updateClock += Math.max(0, Number(dt) || 0);
    if (wheel.open && (ctx.combat?.player?.dead || menu.open || document.hidden)) {
      cancelWheel(ctx.combat?.player?.dead ? "death" : "unavailable");
    }
    if (updateClock < 0.18) return;
    updateClock = 0;
    updateCommands();
    if (menu.open) {
      refreshOperation();
      if (menu.panel === "map") refreshMap();
      root.querySelectorAll('[data-save-action="save"]').forEach((button) => {
        button.disabled = !save?.canSave?.();
      });
      if (menu.restartUntil && menu.restartUntil < performance.now()) {
        menu.restartUntil = 0;
        const restart = root.querySelector('[data-menu-action="restart"]');
        if (restart) restart.textContent = "RESTART OPERATION";
      }
    }
  }

  function wheelState() {
    return {
      open: wheel.open,
      selectedKey: wheel.selectedIndex >= 0 ? order[wheel.selectedIndex] : null,
      selectedIndex: wheel.selectedIndex,
      source: wheel.source,
      vector: { x: Number(wheel.x.toFixed(2)), y: Number(wheel.y.toFixed(2)), magnitude: Number(Math.hypot(wheel.x, wheel.y).toFixed(2)) },
      deadZone: wheel.deadZone,
      dispatchSeq: wheel.dispatchSeq,
      lastDispatch: wheel.lastDispatch ? { ...wheel.lastDispatch } : null,
      cancelReason: wheel.cancelReason,
      commands: order.map((key) => ({
        key,
        name: ctx.mission.stratagems?.[key]?.name || key,
        cooldown: Math.max(0, Number(ctx.mission.cooldowns?.[key]) || 0),
        ready: (Number(ctx.mission.cooldowns?.[key]) || 0) <= 0.001,
      })),
    };
  }

  function menuState() {
    const active = document.activeElement;
    const hasAction = active?.dataset && (
      active.dataset.menuAction !== undefined
      || active.dataset.menuPanel !== undefined
      || active.dataset.saveAction !== undefined
      || active.dataset.menuClose !== undefined
    );
    return {
      open: menu.open,
      panel: menu.panel,
      paused: document.body.classList.contains("rb-escape-menu-open"),
      focusedAction: hasAction ? (active.textContent || "").trim() : null,
      canSave: !!save?.canSave?.(),
      canLoad: !!(saveData.autosave || saveData.manuals?.some(Boolean)),
      phase: ctx.mission.state?.phase || null,
      restartArmed: menu.restartUntil > performance.now(),
      maximized: isMaximized(),
      maximizeLabel: maximizeLabel?.textContent?.trim() || null,
      mapRange: Number(largeMapRange?.textContent?.match(/\d+/)?.[0] || 0),
      mapPixels: largeMapCanvas ? [largeMapCanvas.width, largeMapCanvas.height] : null,
    };
  }

  function settingsState() {
    return {
      audioEnabled: audioEnabled(),
      hudScale: settings.hudScale,
      reducedMotion: settings.reducedMotion,
      highContrast: settings.highContrast,
    };
  }

  function refresh() {
    if (destroyed) return;
    updateCommands();
    refreshOperation();
    refreshMap();
    refreshSaves();
    applySettings();
    syncMaximizeButton();
  }

  applySettings();
  syncMaximizeButton();
  refresh();

  const publicApi = {
    root,
    wheel: wheelEl,
    menu: menuEl,
    update,
    refresh,
    toggleAudio,
    openMenu,
    openMap,
    closeMenu,
    cancelWheel,
    wheelState,
    menuState,
    settingsState,
    destroy() {
      if (destroyed) return false;
      destroyed = true;

      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("rainbot:sfx-muted", onSfxMuted);

      touchObserver.disconnect();
      detachTouchCommands();
      stopWon?.(); stopLost?.(); stopSave?.();

      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      if (announceRaf) cancelAnimationFrame(announceRaf);
      if (focusRaf) cancelAnimationFrame(focusRaf);
      announceRaf = 0;
      focusRaf = 0;

      wheel.open = false;
      wheel.pointerId = null;
      wheel.touchOrigin = null;
      wheelEl.hidden = true;
      wheelEl.setAttribute("aria-hidden", "true");
      wheelEl.dataset.open = "false";
      menu.open = false;
      menuEl.hidden = true;
      menuEl.setAttribute("aria-hidden", "true");
      document.body.classList.remove("sf-command-open", "rb-escape-menu-open");
      if (menu.ariaRestore) setMenuInert(false);
      ctx.player?.input?.clearAll?.();
      touch?.releaseAll?.();
      menu.lastFocus = null;
      clearedUntil.clear();
      root.remove();
      if (stage.__saintfallGameUi === publicApi) delete stage.__saintfallGameUi;
      return true;
    },
  };
  stage.__saintfallGameUi = publicApi;
  return publicApi;
}
