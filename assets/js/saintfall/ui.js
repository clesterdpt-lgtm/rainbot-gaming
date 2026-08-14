/* ============================================================
   SAINTFALL - native field interface

   Owns the hold-to-command wheel and the in-game field menu. The
   simulation reacts only to the body classes this module exposes;
   durable game state remains owned by the save and mission systems.
   ============================================================ */

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const SETTINGS_KEY = "saintfall:field-ui:v1";
const PANEL_NAMES = new Set(["operation", "map", "doctrine", "saves", "controls", "settings"]);
const DOCTRINE_SIGILS = Object.freeze({
  censer: new URL("../../img/saintfall/doctrine/order-censer-sigil-ai-v1.jpg", import.meta.url).href,
  procession: new URL("../../img/saintfall/doctrine/order-procession-sigil-ai-v1.jpg", import.meta.url).href,
  wing: new URL("../../img/saintfall/doctrine/order-wing-sigil-ai-v1.jpg", import.meta.url).href,
  halo: new URL("../../img/saintfall/doctrine/order-halo-sigil-ai-v1.jpg", import.meta.url).href,
  edict: new URL("../../img/saintfall/doctrine/order-edict-sigil-ai-v1.jpg", import.meta.url).href,
});
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
  doctrine: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/><path d="M12 3v6M20.6 9.2l-5.7 1.9M17.3 19l-3.5-4.9M6.7 19l3.5-4.9M3.4 9.2l5.7 1.9"/><path d="m12 3 8.6 6.2-3.3 9.8H6.7L3.4 9.2Z"/></svg>`,
  saves: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>`,
  controls: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a5 5 0 0 1 4 7l-1 3a2 2 0 0 1-3 1l-3-2h-4l-3 2a2 2 0 0 1-3-1l-1-3a5 5 0 0 1 4-7Z"/><path d="M7 12h4M9 10v4M16 12h.1M18 14h.1"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>`,
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function doctrineSigilMarkup(orderId, role, modifier = "") {
  const id = String(orderId || "");
  const source = DOCTRINE_SIGILS[id];
  if (!source) return "";
  const classes = `sf-doctrine__sigil ${modifier}`.trim();
  return `<img class="${classes}" data-doctrine-sigil data-sigil-role="${escapeHtml(role)}" data-order-id="${escapeHtml(id)}" src="${escapeHtml(source)}" width="512" height="512" alt="" aria-hidden="true" draggable="false" decoding="async">`;
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
      // Default ON: it only ever acts when the frame is over budget.
      dynamicRes: saved.dynamicRes !== false,
    };
  } catch (_) {
    return {
      hudScale: "standard", reducedMotion: false, highContrast: false,
      dynamicRes: true,
    };
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

export function buildGameUi(ctx, { stage, canvas, save, touch, render } = {}) {
  if (!stage || !canvas || !ctx?.mission) {
    const closed = () => ({ open: false });
    return {
      update() {}, toggleAudio: () => false, openMenu: () => false,
      openMap: () => false, closeMenu: () => false, cancelWheel: () => false, refresh() {},
      wheelState: closed, menuState: closed,
      settingsState: () => ({ audioEnabled: false, hudScale: "standard", reducedMotion: false, highContrast: false, dynamicRes: true }),
    };
  }

  stage.__saintfallGameUi?.destroy?.();
  stage.querySelector("#sf-native-ui")?.remove();
  const order = Array.from(ctx.mission.wheelOrder || ["orbital", "cluster", "resupply"]);
  const root = document.createElement("div");
  root.id = "sf-native-ui";
  root.className = "sf-native-ui";
  root.innerHTML = `
    <button type="button" class="sf-menu-trigger sf-menu-trigger--mobile" data-menu-open
      aria-label="Open field menu" aria-haspopup="dialog">
      ${ICONS.menu}<span>MENU</span>
    </button>
    <div id="sf-command-wheel" class="sf-command-wheel" role="dialog"
      aria-label="Field command wheel" aria-modal="false" aria-hidden="true" hidden
      data-open="false" data-selection="">
      <div class="sf-command-wheel__veil"></div>
      <div class="sf-command-wheel__dial">
        <div class="sf-command-wheel__ring" aria-hidden="true"></div>
        ${commandMarkup(order, ctx.mission)}
        <button class="sf-command-wheel__core" type="button" data-wheel-cancel>
          ${ICONS.crest}<span data-wheel-status>HOVER TO SELECT</span><small>CLICK TO CONFIRM</small>
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
            <button type="button" data-menu-panel="operation" aria-label="Operation" aria-current="page">${ICONS.operation}<span data-mobile-label="OPS">OPERATION</span></button>
            <button type="button" data-menu-panel="map" aria-label="Tactical map">${ICONS.map}<span data-mobile-label="MAP">TACTICAL MAP</span></button>
            <button type="button" data-menu-panel="doctrine" aria-label="Field Doctrine">${ICONS.doctrine}<span data-mobile-label="RITES">DOCTRINE</span></button>
            <button type="button" data-menu-panel="saves" aria-label="Save and load">${ICONS.saves}<span data-mobile-label="SAVES">SAVE / LOAD</span><b data-career-recovery-nav hidden>REVIEW</b></button>
            <button type="button" data-menu-panel="controls" aria-label="Controls">${ICONS.controls}<span data-mobile-label="CTRL">CONTROLS</span></button>
            <button type="button" data-menu-panel="settings" aria-label="Settings">${ICONS.settings}<span data-mobile-label="SET">SETTINGS</span></button>
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
              <div class="sf-menu__callout"><span>FIELD DOCTRINE</span><p>Hold <kbd>F</kbd>, hover toward a command sigil, and left click to confirm. Releasing <kbd>F</kbd> cancels.</p></div>
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
            <section class="sf-menu__page sf-menu__page--doctrine" data-menu-page="doctrine" hidden>
              <div class="sf-menu__pagehead"><span>RELIQUARY FORMATION</span><h3 tabindex="-1">FIELD DOCTRINE</h3><p>Inscribe five Orders and bind at most two capstone Vows. Revise doctrine when Bloom pressure is quiet.</p></div>
              <div class="sf-doctrine__summary" aria-label="Field rank and doctrine summary">
                <div class="sf-doctrine__rank"><small>FIELD RANK</small><strong data-doctrine-rank>1</strong></div>
                <div class="sf-doctrine__xp">
                  <span><small>CAREER ASCENSION</small><b data-doctrine-xp-text>0 / 0 XP</b></span>
                  <i data-doctrine-xp role="progressbar" aria-label="Progress to next Field Rank" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><em data-doctrine-xp-fill></em></i>
                </div>
                <div class="sf-doctrine__points"><small>DOCTRINE POINTS</small><strong data-doctrine-points>0</strong><span>AVAILABLE</span></div>
                <div class="sf-doctrine__seals"><small>VOW SEALS</small><strong data-doctrine-vow-count>0 / 2</strong><span>BOUND</span></div>
                <div class="sf-doctrine__vow-slots" data-doctrine-vows aria-label="Active capstone Vows"></div>
              </div>
              <p class="sf-doctrine__lock" data-doctrine-lock role="status" hidden></p>
              <div class="sf-doctrine__body">
                <nav class="sf-doctrine__orders" data-doctrine-orders role="tablist" aria-label="Doctrine Orders" aria-orientation="horizontal"></nav>
                <section class="sf-doctrine__order" data-doctrine-order-panel role="tabpanel" tabindex="0" aria-live="polite">
                  <header class="sf-doctrine__order-head">
                    <img class="sf-doctrine__sigil sf-doctrine__sigil--hero" data-doctrine-sigil data-sigil-role="hero" width="512" height="512" alt="" aria-hidden="true" draggable="false" decoding="async" hidden>
                    <span><small data-doctrine-order-kicker>ORDER</small><h4 data-doctrine-order-name>Awaiting doctrine</h4><p data-doctrine-order-focus>Select an Order to inspect its rites.</p></span>
                    <b data-doctrine-invested>0 / 8</b>
                  </header>
                  <div class="sf-doctrine__rites" data-doctrine-talents></div>
                  <div data-doctrine-capstone></div>
                </section>
              </div>
              <footer class="sf-doctrine__footer">
                <p data-doctrine-edit-reason>Doctrine may be revised while field pressure is quiet.</p>
                <button type="button" data-doctrine-action="respec" data-talent-respec>RESET DOCTRINE</button>
              </footer>
            </section>
            <section class="sf-menu__page" data-menu-page="saves" hidden>
              <div class="sf-menu__pagehead"><span>FIELD RECORDS</span><h3>SAVE / LOAD</h3><p>Three manual reliquaries and one automatic field record.</p></div>
              <section class="sf-career-recovery" data-career-recovery aria-labelledby="sf-career-recovery-title" aria-describedby="sf-career-recovery-copy" aria-busy="false" tabindex="-1" hidden>
                <header class="sf-career-recovery__head">
                  <span><small>DOCTRINE CAREER SYNC</small><h4 id="sf-career-recovery-title">Choose the career to preserve</h4></span>
                  <b data-career-recovery-badge>REVIEW REQUIRED</b>
                </header>
                <p id="sf-career-recovery-copy">This device and the synced record changed separately. Both are safe until you review them and confirm one version.</p>
                <div class="sf-career-recovery__branches" data-career-recovery-branches>
                  <article class="sf-career-branch" data-career-branch-card="local">
                    <header><span><small>CURRENT SESSION</small><strong>THIS DEVICE</strong></span><b data-career-branch-revision="local">REV —</b></header>
                    <dl>
                      <div><dt>FIELD RANK</dt><dd data-career-branch-rank="local">—</dd></div>
                      <div><dt>CAREER XP</dt><dd data-career-branch-xp="local">—</dd></div>
                      <div><dt>RITES</dt><dd data-career-branch-points="local">—</dd></div>
                      <div><dt>VOWS</dt><dd data-career-branch-vows="local">—</dd></div>
                    </dl>
                    <p data-career-branch-build="local">No Doctrine inscriptions recorded.</p>
                    <small data-career-branch-time="local">Recovered on this device</small>
                    <button type="button" data-career-recovery-action="choose" data-career-choice="local" aria-describedby="sf-career-recovery-status">KEEP THIS DEVICE</button>
                  </article>
                  <article class="sf-career-branch" data-career-branch-card="synced">
                    <header><span><small>CLOUD RECORD</small><strong>SYNCED CAREER</strong></span><b data-career-branch-revision="synced">REV —</b></header>
                    <dl>
                      <div><dt>FIELD RANK</dt><dd data-career-branch-rank="synced">—</dd></div>
                      <div><dt>CAREER XP</dt><dd data-career-branch-xp="synced">—</dd></div>
                      <div><dt>RITES</dt><dd data-career-branch-points="synced">—</dd></div>
                      <div><dt>VOWS</dt><dd data-career-branch-vows="synced">—</dd></div>
                    </dl>
                    <p data-career-branch-build="synced">No Doctrine inscriptions recorded.</p>
                    <small data-career-branch-time="synced">Recovered from synced storage</small>
                    <button type="button" data-career-recovery-action="choose" data-career-choice="synced" aria-describedby="sf-career-recovery-status">USE SYNCED CAREER</button>
                  </article>
                </div>
                <p class="sf-career-recovery__status" id="sf-career-recovery-status" data-career-recovery-status role="status" aria-live="polite" aria-atomic="true">Compare both records. Your field saves are not affected.</p>
              </section>
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
                <article><h4>MOVEMENT</h4>${controlRow("W A S D", "Move")}${controlRow("SHIFT", "Boost", "Tap to boost, hold to keep gliding")}${controlRow("SPACE", "Vault")}${controlRow("SHIFT + SPACE", "Reliquary jetpack")}${controlRow("Q", "Ground slam", "While airborne")}</article>
                <article><h4>COMBAT</h4>${controlRow("MOUSE", "Look / aim")}${controlRow("LMB", "Fire")}${controlRow("RMB", "Aim down sights")}${controlRow("Q", "Censer-lance strike")}${controlRow("E", "Aegis block")}${controlRow("R", "Vent weapon heat")}</article>
                <article><h4>COMMAND</h4>${controlRow("HOLD F + LMB", "Command wheel", "Hover a field support sigil and left click to deploy; release F to cancel")}${controlRow("TAB", "Field menu")}${controlRow("ESC", "Field menu", "Also resumes")}${controlRow("M", "Tactical map", "Press again to resume")}${controlRow("TOUCH", "Hold the command sigil", "Drag and release to confirm")}</article>
              </div>
            </section>
            <section class="sf-menu__page" data-menu-page="settings" hidden>
              <div class="sf-menu__pagehead"><span>FIELD CONFIGURATION</span><h3>SETTINGS</h3><p>Readability and presentation preferences are saved on this device.</p></div>
              <div class="sf-settings-list">
                <div class="sf-setting"><span><strong>FIELD AUDIO</strong><small>Music, weapons, ambience, and interface cues</small></span><button type="button" role="switch" data-setting="sound" aria-label="Field audio" aria-checked="true">ON</button></div>
                <div class="sf-setting"><span><strong id="sf-hud-scale-label">HUD SCALE</strong><small>Increase tactical instrument size</small></span><div class="sf-setting__segments" role="group" aria-labelledby="sf-hud-scale-label"><button type="button" data-hud-scale="standard" aria-label="Standard HUD scale">STANDARD</button><button type="button" data-hud-scale="large" aria-label="Large HUD scale">LARGE</button></div></div>
                <div class="sf-setting"><span><strong>REDUCED MOTION</strong><small>Calmer interface transitions and pulses</small></span><button type="button" role="switch" data-setting="reduced-motion" aria-label="Reduced motion" aria-checked="false">OFF</button></div>
                <div class="sf-setting"><span><strong>HIGH CONTRAST</strong><small>Stronger text, panel, and instrument separation</small></span><button type="button" role="switch" data-setting="high-contrast" aria-label="High contrast" aria-checked="false">OFF</button></div>
                <div class="sf-setting"><span><strong>DYNAMIC RESOLUTION</strong><small>Trims render resolution only while the frame rate is suffering, and restores it when it recovers</small></span><button type="button" role="switch" data-setting="dynamic-res" aria-label="Dynamic resolution" aria-checked="true">ON</button></div>
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
  const progression = ctx.progression;
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
  const doctrine = {
    orderId: null,
    inspectedTalentId: null,
    respecUntil: 0,
    latestState: null,
  };
  const careerRecovery = {
    armedChoice: null,
    armedUntil: 0,
    resolving: false,
    resolvedMessage: "",
    errorMessage: "",
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
    for (const [name, value] of [["reduced-motion", settings.reducedMotion],
      ["high-contrast", settings.highContrast], ["dynamic-res", settings.dynamicRes]]) {
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

  function progressionDefinitions() {
    let raw = {};
    try {
      raw = typeof progression?.definitions === "function"
        ? progression.definitions() : progression?.definitions || {};
    } catch (_) { raw = {}; }
    const definitions = raw?.doctrine || raw?.progression?.doctrine || raw || {};
    const looseTalents = Array.isArray(definitions.talents) ? definitions.talents : [];
    const looseCapstones = Array.isArray(definitions.capstones) ? definitions.capstones : [];
    const orders = (Array.isArray(definitions.orders) ? definitions.orders : []).map((entry) => ({
      ...entry,
      talents: Array.isArray(entry.talents)
        ? entry.talents : looseTalents.filter((talent) => talent.orderId === entry.id),
      capstone: entry.capstone
        || looseCapstones.find((capstone) => capstone.orderId === entry.id) || null,
    }));
    return {
      ...definitions,
      maxPointsPerOrder: definitions.maxPointsPerOrder
        ?? raw?.maxPointsPerOrder ?? raw?.rules?.maxPointsPerOrder,
      capstoneEligibilityPoints: definitions.capstoneEligibilityPoints
        ?? raw?.capstoneEligibilityPoints ?? raw?.rules?.capstoneEligibilityPoints,
      vowSealRanks: definitions.vowSealRanks
        ?? raw?.vowSealRanks ?? raw?.rules?.vowSealRanks,
      orders,
    };
  }

  function progressionState() {
    try {
      const state = progression?.state?.() || {};
      doctrine.latestState = state;
      return state;
    } catch (_) {
      const state = { editLocked: true, lockReason: "Doctrine state is unavailable." };
      doctrine.latestState = state;
      return state;
    }
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function runtimeOrder(state, orderId) {
    if (Array.isArray(state?.orders)) return state.orders.find((entry) => entry?.id === orderId) || {};
    return state?.orders?.[orderId] || {};
  }

  function runtimeTalent(state, orderState, talentId) {
    const local = Array.isArray(orderState?.talents)
      ? orderState.talents.find((entry) => entry?.id === talentId)
      : orderState?.talents?.[talentId];
    if (local) return local;
    if (Array.isArray(state?.talents)) return state.talents.find((entry) => entry?.id === talentId) || {};
    return state?.talents?.[talentId] || {};
  }

  function editState(state) {
    let raw = null;
    try { raw = progression?.canEdit?.(); } catch (_) { raw = false; }
    const apiAllows = typeof raw === "boolean" ? raw
      : raw && typeof raw === "object" ? !!(raw.ok ?? raw.canEdit ?? raw.allowed) : !state?.editLocked;
    const locked = !!state?.editLocked || !apiAllows || !progression;
    const reason = state?.lockReason || raw?.message || raw?.reason
      || (locked ? "Doctrine cannot be revised during this deployment." : "");
    return { allowed: !locked, reason };
  }

  function orderPoints(orderState) {
    const explicit = Number(orderState?.points ?? orderState?.pointsSpent);
    if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
    return asArray(orderState?.talents).reduce((sum, talent) =>
      sum + Math.max(0, Math.floor(Number(talent?.rank) || 0)), 0);
  }

  function activeCapstones(state) {
    const active = Array.isArray(state?.activeCapstones)
      ? state.activeCapstones.slice(0, 2) : [];
    while (active.length < 2) active.push(null);
    return active;
  }

  function capstoneRecord(state, orderState, definition) {
    if (orderState?.capstone && typeof orderState.capstone === "object") return orderState.capstone;
    const direct = Array.isArray(state?.capstones)
      ? state.capstones.find((entry) => entry?.id === definition.id)
      : state?.capstones?.[definition.id];
    if (direct) return direct;
    return activeCapstones(state).includes(definition.id) ? { id: definition.id, equipped: true } : {};
  }

  function implementationState(definition, runtime = {}) {
    const implemented = definition?.implemented ?? runtime?.implemented;
    return {
      implemented: implemented === true,
      note: runtime?.implementationNote || definition?.implementationNote
        || (implemented === false
          ? "This doctrine mechanic is forthcoming."
          : "This doctrine has not yet been confirmed field-ready."),
    };
  }

  function sealRanks(definitions) {
    const ranks = definitions?.vowSealRanks || definitions?.vowSeals?.ranks;
    return Array.isArray(ranks) && ranks.length ? ranks.slice(0, 2) : [12, 22];
  }

  function earnedSeals(state, definitions) {
    const explicit = Number(state?.vowSealsEarned ?? state?.sealsEarned);
    if (Number.isFinite(explicit)) return clamp(Math.floor(explicit), 0, 2);
    const rank = Math.max(1, Math.floor(Number(state?.rank) || 1));
    return sealRanks(definitions).filter((threshold) => rank >= Number(threshold)).length;
  }

  function safeDomId(value) {
    return String(value || "order").replace(/[^a-z0-9_-]+/gi, "-");
  }

  function rankNumeral(rank) {
    return ["0", "I", "II", "III", "IV"][rank] || String(rank);
  }

  function disabledAttributes(disabled, reason) {
    if (!disabled) return "";
    const copy = escapeHtml(reason || "This rite is unavailable.");
    return ` disabled aria-disabled="true" data-disabled-reason="${copy}" title="${copy}"`;
  }

  function talentEligibility(definition, current, state, orderState, edit, definitions) {
    const rank = Math.max(0, Math.floor(Number(current?.rank) || 0));
    const maxRank = Math.max(1, Math.floor(Number(definition?.maxRank) || 1));
    const points = Math.max(0, Math.floor(Number(state?.pointsAvailable) || 0));
    const invested = orderPoints(orderState);
    const required = Math.max(0, Math.floor(Number(definition?.requires?.orderPoints) || 0));
    const orderLimit = Math.max(1, Math.floor(Number(definitions?.maxPointsPerOrder) || 8));
    const runtimeEligible = typeof current?.eligible === "boolean" ? current.eligible : null;
    const implementation = implementationState(definition, current);
    const implemented = implementation.implemented;
    let reason = "";
    if (!implemented) reason = implementation.note;
    else if (!edit.allowed) reason = edit.reason;
    else if (rank >= maxRank) reason = "Maximum rank reached.";
    else if (invested < required) reason = `Requires ${required} points in this Order.`;
    else if (invested >= orderLimit) reason = `This Order is limited to ${orderLimit} Doctrine Points.`;
    else if (points < 1) {
      const fieldRank = Math.max(1, Math.floor(Number(state?.rank) || 1));
      const rankCap = Math.max(fieldRank, Math.floor(Number(definitions?.rankCap) || 25));
      reason = fieldRank < rankCap
        ? "Earn 1 Doctrine Point at the next Field Rank."
        : "No Doctrine Points remain. Refund another rite to revise this Order.";
    }
    else if (runtimeEligible === false) reason = current?.lockReason || current?.reason
      || current?.eligibilityReason || "This rite is not currently available.";
    const canSpend = !reason;

    let refundReason = "";
    const runtimeRefundable = typeof current?.refundable === "boolean" ? current.refundable : null;
    if (!edit.allowed) refundReason = edit.reason;
    else if (rank <= 0) refundReason = "No rank has been inscribed.";
    else if (runtimeRefundable === false) refundReason = current?.refundReason
      || "Refund the dependent rites first.";
    return { rank, maxRank, implemented, canSpend, reason,
      canRefund: !refundReason, refundReason };
  }

  function renderTalent(definition, current, state, orderState, edit, definitions) {
    const eligibility = talentEligibility(definition, current, state, orderState, edit, definitions);
    const { rank, maxRank } = eligibility;
    const inspected = doctrine.inspectedTalentId === definition.id;
    const cardState = !eligibility.implemented ? "forthcoming"
      : rank >= maxRank ? "maxed" : rank > 0 ? "owned"
      : eligibility.canSpend ? "available" : "locked";
    const pips = Array.from({ length: maxRank }, (_, index) =>
      `<i data-state="${index < rank ? "owned" : "empty"}" aria-hidden="true"></i>`).join("");
    const ranks = Array.isArray(definition.ranks) ? definition.ranks : [];
    const detailId = `sf-talent-detail-${safeDomId(definition.id)}`;
    const rankDetails = ranks.length ? `<ol>${ranks.map((entry, index) =>
      `<li data-state="${index < rank ? "owned" : index === rank ? "next" : "locked"}"><b>RANK ${rankNumeral(index + 1)}</b><span>${escapeHtml(entry?.description || "Rite effect awaiting record.")}</span></li>`).join("")}</ol>`
      : `<p>${escapeHtml(definition.description || definition.summary || "Rite effect awaiting record.")}</p>`;
    const spendLabel = !eligibility.implemented ? "FORTHCOMING"
      : rank >= maxRank ? "MAX RANK" : `INSCRIBE ${rankNumeral(rank + 1)}`;
    const reason = eligibility.reason || (rank > 0 ? `Rank ${rank} of ${maxRank} inscribed.` : "Ready to inscribe.");
    return `<article class="sf-doctrine-talent" data-doctrine-talent data-talent-id="${escapeHtml(definition.id)}" data-state="${cardState}" data-tier="${Math.max(1, Number(definition.tier) || 1)}" data-inspected="${inspected ? "true" : "false"}">
      <header><span><small>TIER ${Math.max(1, Number(definition.tier) || 1)}</small><strong>${escapeHtml(definition.name || "Unnamed Rite")}</strong></span><b data-talent-rank="${rank}" aria-label="Rank ${rank} of ${maxRank}">${pips}</b></header>
      <p>${escapeHtml(definition.summary || "A Reliquary rite awaiting inscription.")}</p>
      <div class="sf-doctrine-talent__actions">
        <button type="button" data-doctrine-action="inspect" data-talent-action="inspect" data-talent-id="${escapeHtml(definition.id)}" aria-expanded="${inspected ? "true" : "false"}" aria-controls="${detailId}">${inspected ? "BACK TO RITES" : "DETAILS"}</button>
        ${rank > 0 ? `<button type="button" data-doctrine-action="refund" data-talent-action="refund" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canRefund, eligibility.refundReason)}>REFUND</button>` : ""}
        <button type="button" data-doctrine-action="spend" data-talent-action="spend" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canSpend, eligibility.reason)}>${spendLabel}</button>
      </div>
      <small class="sf-doctrine-talent__reason" data-talent-reason>${escapeHtml(reason)}</small>
      <div class="sf-doctrine-talent__detail" id="${detailId}" data-talent-detail${inspected ? "" : " hidden"}>${rankDetails}</div>
    </article>`;
  }

  function renderCapstone(definition, orderDefinition, orderState, state, edit, definitions) {
    const host = root.querySelector("[data-doctrine-capstone]");
    if (!host) return;
    if (!definition) {
      host.innerHTML = `<article class="sf-doctrine__vow" data-state="locked"><small>CAPSTONE VOW</small><strong>SEALED RECORD</strong><p>This Order's final Vow has not been recovered.</p></article>`;
      return;
    }
    const active = activeCapstones(state);
    const slot = active.indexOf(definition.id);
    const invested = orderPoints(orderState);
    const required = Math.max(1, Math.floor(Number(definition?.requires?.orderPoints
      ?? definitions?.capstoneEligibilityPoints) || 8));
    const seals = earnedSeals(state, definitions);
    const emptySlot = active.findIndex((entry, index) => !entry && index < seals);
    const runtime = capstoneRecord(state, orderState, definition);
    const runtimeEligible = typeof runtime?.eligible === "boolean" ? runtime.eligible : null;
    const implementation = implementationState(definition, runtime);
    const implemented = implementation.implemented;
    const inspected = doctrine.inspectedTalentId === definition.id;
    let reason = "";
    if (!implemented) reason = implementation.note;
    else if (!edit.allowed) reason = edit.reason;
    else if (slot < 0 && runtimeEligible === false) reason = runtime?.reason
      || runtime?.lockReason || `Invest ${required} points in ${orderDefinition.shortName || orderDefinition.name}.`;
    else if (slot < 0 && invested < required) reason = `Invest ${required} points in ${orderDefinition.shortName || orderDefinition.name}.`;
    else if (slot < 0 && seals < 1) reason = `The first Vow Seal unlocks at Field Rank ${sealRanks(definitions)[0]}.`;
    else if (slot < 0 && emptySlot < 0) reason = "Both earned Vow Seals are already bound. Unbind one first.";
    const stateName = !implemented ? "forthcoming" : slot >= 0 ? "equipped" : reason ? "locked" : "eligible";
    const action = slot >= 0 ? "unequip" : "equip";
    const actionSlot = slot >= 0 ? slot : emptySlot;
    const label = slot >= 0 ? `UNBIND VOW ${rankNumeral(slot + 1)}`
      : emptySlot >= 0 ? `BIND VOW ${rankNumeral(emptySlot + 1)}` : "BIND VOW";
    const fusions = Array.isArray(definition.fusions) && definition.fusions.length
      ? `<ul class="sf-doctrine__fusions">${definition.fusions.map((fusion) =>
        `<li><b>${escapeHtml(fusion.name)}</b><span>${escapeHtml(fusion.description)}</span></li>`).join("")}</ul>` : "";
    host.innerHTML = `<article class="sf-doctrine__vow" data-doctrine-vow data-capstone-id="${escapeHtml(definition.id)}" data-order-id="${escapeHtml(orderDefinition.id)}" data-state="${stateName}" data-equipped="${slot >= 0 ? "true" : "false"}" data-inspected="${inspected ? "true" : "false"}">
      ${doctrineSigilMarkup(orderDefinition.id, "capstone", "sf-doctrine__sigil--capstone")}
      <header><span><small>CAPSTONE VOW</small><strong>${escapeHtml(definition.name || "Unnamed Vow")}</strong></span><b>${!implemented ? "FORTHCOMING" : slot >= 0 ? `BOUND · SEAL ${rankNumeral(slot + 1)}` : invested >= required ? "ELIGIBLE" : `${invested} / ${required}`}</b></header>
      <p>${escapeHtml(definition.summary || "The final expression of this Order.")}</p>
      <div class="sf-doctrine__vow-detail" id="sf-capstone-detail-${safeDomId(definition.id)}" data-talent-detail${inspected ? "" : " hidden"}>${escapeHtml(definition.description || "Capstone effect awaiting record.")}</div>
      ${fusions}
      <div class="sf-doctrine__vow-action"><small>${escapeHtml(reason || (slot >= 0 ? "This Vow occupies one of two active seals." : "An earned Vow Seal is ready."))}</small><span><button type="button" data-doctrine-action="inspect" data-talent-action="inspect" data-talent-id="${escapeHtml(definition.id)}" aria-expanded="${inspected ? "true" : "false"}" aria-controls="sf-capstone-detail-${safeDomId(definition.id)}">${inspected ? "BACK TO RITES" : "DETAILS"}</button><button type="button" data-doctrine-action="vow" data-capstone-action="${action}" data-capstone-id="${escapeHtml(definition.id)}" data-order-id="${escapeHtml(orderDefinition.id)}" data-capstone-slot="${actionSlot}"${disabledAttributes(!edit.allowed || (slot < 0 && !!reason), reason)}>${label}</button></span></div>
    </article>`;
  }

  function focusAfterDoctrineRefresh(selector) {
    if (!selector) return;
    requestAnimationFrame(() => {
      if (!destroyed && menu.open && menu.panel === "doctrine") {
        const target = root.querySelector(selector);
        target?.focus?.({ preventScroll: true });
        target?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "auto" });
      }
    });
  }

  function selectDoctrineOrder(orderId, { focus = false } = {}) {
    const definitions = progressionDefinitions();
    if (!definitions.orders.some((entry) => entry.id === orderId)) return false;
    doctrine.orderId = orderId;
    doctrine.inspectedTalentId = null;
    refreshDoctrine();
    const panel = root.querySelector("[data-doctrine-order-panel]");
    if (panel) panel.scrollTop = 0;
    if (focus) focusAfterDoctrineRefresh(`[data-doctrine-order="${CSS.escape(orderId)}"]`);
    menuSfx("switch");
    return true;
  }

  function refreshDoctrine(stateOverride = null) {
    const definitions = progressionDefinitions();
    const state = stateOverride && typeof stateOverride === "object"
      ? stateOverride : progressionState();
    doctrine.latestState = state;
    const orders = definitions.orders;
    if (!doctrine.orderId || !orders.some((entry) => entry.id === doctrine.orderId)) {
      doctrine.orderId = orders[0]?.id || null;
      doctrine.inspectedTalentId = null;
    }
    const rank = Math.max(1, Math.floor(Number(state?.rank) || 1));
    const xpInto = Math.max(0, Math.floor(Number(state?.xpIntoRank) || 0));
    const xpForNext = Math.max(0, Math.floor(Number(state?.xpForNext) || 0));
    const atCap = xpForNext <= 0;
    const xpProgress = atCap ? 1 : clamp(xpInto / Math.max(1, xpForNext), 0, 1);
    root.querySelector("[data-doctrine-rank]").textContent = String(rank);
    root.querySelector("[data-doctrine-points]").textContent = String(Math.max(0,
      Math.floor(Number(state?.pointsAvailable) || 0)));
    root.querySelector("[data-doctrine-xp-text]").textContent = atCap
      ? "FIELD RANK CAP" : `${xpInto} / ${xpForNext} XP`;
    const xp = root.querySelector("[data-doctrine-xp]");
    xp.setAttribute("aria-valuemax", String(atCap ? 1 : xpForNext));
    xp.setAttribute("aria-valuenow", String(atCap ? 1 : Math.min(xpInto, xpForNext)));
    root.querySelector("[data-doctrine-xp-fill]").style.width = `${(xpProgress * 100).toFixed(2)}%`;

    const active = activeCapstones(state);
    const seals = earnedSeals(state, definitions);
    const bound = active.filter(Boolean).length;
    root.querySelector("[data-doctrine-vow-count]").textContent = `${bound} / ${seals}`;
    const sealCopy = root.querySelector(".sf-doctrine__seals>span");
    if (sealCopy) sealCopy.textContent = `${seals} EARNED`;
    const capstoneNames = new Map(orders.filter((entry) => entry.capstone)
      .map((entry) => [entry.capstone.id, entry.capstone.name]));
    root.querySelector("[data-doctrine-vows]").innerHTML = [0, 1].map((index) => {
      const capstoneId = active[index];
      const unlocked = index < seals;
      return `<span data-state="${capstoneId ? "bound" : unlocked ? "empty" : "locked"}"><small>VOW ${rankNumeral(index + 1)}</small><strong>${escapeHtml(capstoneId ? capstoneNames.get(capstoneId) || capstoneId : unlocked ? "UNBOUND" : `RANK ${sealRanks(definitions)[index] || "—"}`)}</strong></span>`;
    }).join("");

    const edit = editState(state);
    const lock = root.querySelector("[data-doctrine-lock]");
    lock.hidden = edit.allowed;
    lock.textContent = edit.allowed ? "" : edit.reason;
    const footerReason = root.querySelector("[data-doctrine-edit-reason]");
    footerReason.textContent = edit.allowed
      ? "Field pressure quiet · Doctrine revision available."
      : edit.reason;
    const respec = root.querySelector("[data-talent-respec]");
    const pointsSpent = Math.max(0, Math.floor(Number(state?.pointsSpent) || 0));
    const hasChoices = pointsSpent > 0 || bound > 0;
    const respecReason = !edit.allowed ? edit.reason : !hasChoices ? "No Doctrine choices have been made." : "";
    respec.disabled = !!respecReason;
    respec.setAttribute("aria-disabled", respecReason ? "true" : "false");
    respec.dataset.disabledReason = respecReason;
    respec.title = respecReason;
    respec.textContent = doctrine.respecUntil > performance.now() ? "CONFIRM RESET" : "RESET DOCTRINE";

    const tabs = root.querySelector("[data-doctrine-orders]");
    tabs.innerHTML = orders.map((entry) => {
      const selected = entry.id === doctrine.orderId;
      const points = orderPoints(runtimeOrder(state, entry.id));
      const accessibleName = `${entry.name || entry.shortName}, ${points} Doctrine ${points === 1 ? "point" : "points"}`;
      return `<button type="button" id="sf-doctrine-tab-${safeDomId(entry.id)}" role="tab" data-doctrine-order="${escapeHtml(entry.id)}" data-order-id="${escapeHtml(entry.id)}" data-accent="${escapeHtml(entry.accent || "gold")}" aria-label="${escapeHtml(accessibleName)}" aria-selected="${selected ? "true" : "false"}" aria-controls="sf-doctrine-order-panel" tabindex="${selected ? "0" : "-1"}">${doctrineSigilMarkup(entry.id, "tab", "sf-doctrine__sigil--tab")}<span>${escapeHtml(entry.shortName || entry.name)}</span><small>${points} PTS</small></button>`;
    }).join("");

    const panel = root.querySelector("[data-doctrine-order-panel]");
    const heroSigil = root.querySelector("[data-doctrine-sigil][data-sigil-role='hero']");
    panel.id = "sf-doctrine-order-panel";
    if (!doctrine.orderId) {
      if (heroSigil) {
        heroSigil.hidden = true;
        heroSigil.removeAttribute("src");
        delete heroSigil.dataset.orderId;
      }
      panel.removeAttribute("aria-labelledby");
      root.querySelector("[data-doctrine-order-name]").textContent = "Doctrine unavailable";
      root.querySelector("[data-doctrine-order-focus]").textContent = "No Order definitions were provided.";
      root.querySelector("[data-doctrine-talents]").innerHTML = "";
      root.querySelector("[data-doctrine-capstone]").innerHTML = "";
      return state;
    }
    const orderDefinition = orders.find((entry) => entry.id === doctrine.orderId);
    const orderState = runtimeOrder(state, doctrine.orderId);
    const invested = orderPoints(orderState);
    const maxOrder = Math.max(1, Math.floor(Number(definitions?.maxPointsPerOrder) || 8));
    const heroSource = DOCTRINE_SIGILS[doctrine.orderId];
    if (heroSigil) {
      heroSigil.hidden = !heroSource;
      if (heroSource) heroSigil.src = heroSource;
      heroSigil.dataset.orderId = doctrine.orderId;
    }
    panel.dataset.orderId = doctrine.orderId;
    panel.dataset.doctrineOrderPanel = doctrine.orderId;
    panel.dataset.accent = orderDefinition.accent || "gold";
    const talentIds = new Set((orderDefinition.talents || []).map((talent) => talent.id));
    panel.dataset.view = doctrine.inspectedTalentId === orderDefinition.capstone?.id
      ? "capstone" : talentIds.has(doctrine.inspectedTalentId) ? "talent" : "overview";
    panel.setAttribute("aria-labelledby", `sf-doctrine-tab-${safeDomId(doctrine.orderId)}`);
    root.querySelector("[data-doctrine-order-kicker]").textContent = "RELIQUARY ORDER";
    root.querySelector("[data-doctrine-order-name]").textContent = orderDefinition.name || orderDefinition.shortName;
    root.querySelector("[data-doctrine-order-focus]").textContent = orderDefinition.focus || "A recovered field doctrine.";
    root.querySelector("[data-doctrine-invested]").textContent = `${invested} / ${maxOrder}`;
    root.querySelector("[data-doctrine-talents]").innerHTML = (orderDefinition.talents || [])
      .map((talent) => renderTalent(talent, runtimeTalent(state, orderState, talent.id),
        state, orderState, edit, definitions)).join("");
    renderCapstone(orderDefinition.capstone, orderDefinition, orderState, state, edit, definitions);
    return state;
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
    wheelStatusEl.textContent = key ? (ctx.mission.stratagems?.[key]?.short || key).toUpperCase() : "HOVER TO SELECT";
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
    announce("Command wheel open. Hover over a command and click to confirm.");
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
    const content = root.querySelector(".sf-menu__content");
    if (content) content.scrollTop = 0;
    if (next === "saves") refreshSaves();
    if (next === "operation") refreshOperation();
    if (next === "doctrine") refreshDoctrine();
    else doctrine.respecUntil = 0;
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
        title: breachDone ? `CYCLE ${breach.cyclesCleared || 1} CLEARED` : breachActive
          ? `CYCLE ${breach?.cycle || 1} · ${breach?.name || "RUPTURE DETECTED"}` : "SIGNAL QUIET",
        detail: breachDone ? `Next pressure cycle in ${formatClock(breach.timer)}` : breach?.phase === "warning"
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
      heading.textContent = "OPERATION COMPLETE";
      copy.textContent = "The standing order and the false saint are broken. Vesper-IX releases you.";
    } else if (phase === "lost") {
      heading.textContent = "OPERATION FAILED";
      copy.textContent = "The reliquary is dark. Restart the operation to return.";
    } else if (phase === "extract") {
      heading.textContent = "REACH EXTRACTION";
      copy.textContent = "Hold the Fallen Saint until the shuttle can lift.";
    } else if (phase === "cathedralBoss") {
      heading.textContent = "RETURN TO THE CATHEDRAL";
      copy.textContent = "The final signal is wearing your reliquary. Destroy the Apostate.";
    } else {
      heading.textContent = "THE GILDED SILENCE";
      copy.textContent = "Silence every vox-relay and contain the Bloom.";
    }
    root.querySelector("[data-operation-objective]").textContent = objective?.name || "Awaiting field order";
    root.querySelector("[data-operation-distance]").textContent = objective ? `${Math.round(objective.dist || 0)}m from current position` : "No active directive";
    root.querySelector("[data-operation-relays]").textContent = `${state.relaysDone || 0} / ${ctx.mission.relays?.length || 3}`;
    root.querySelector("[data-operation-reinforcements]").textContent = String(Math.max(0, state.reinforcements ?? 0));
    root.querySelector("[data-operation-clock]").textContent = formatClock(state.elapsed);
    const breachActive = !!breach && ["warning", "active", "intermission"].includes(breach.phase);
    const breachName = breach?.complete ? `CYCLE ${breach.cyclesCleared || 1} CLEARED`
      : breachActive ? (breach.phase === "warning" ? "RUPTURE INCOMING" : `CYCLE ${breach.cycle || 1} · BREACH ${breach.wave || 1}`)
        : "SIGNAL QUIET";
    root.querySelector("[data-operation-breach]").textContent = breachName;
    root.querySelector("[data-operation-breach-detail]").textContent = breachActive
      ? (breach.phase === "warning" ? `${Math.ceil(breach.timer || 0)} seconds to emergence`
        : `${Math.max(0, breach.remaining || 0)} hostiles remain`)
      : breach?.complete ? `Next pressure cycle in ${formatClock(breach.timer)}` : "No active rupture";
  }

  function readCareerConflict() {
    try {
      const direct = save?.conflictState?.();
      if (direct && typeof direct.then !== "function") return direct;
      return save?.state?.()?.careerConflict || null;
    } catch (_) {
      return null;
    }
  }

  function careerRankAtXp(totalXp, explicitRank) {
    if (Number.isFinite(Number(explicitRank))) return Math.max(1, Math.floor(Number(explicitRank)));
    let raw = {};
    try {
      raw = typeof progression?.definitions === "function"
        ? progression.definitions() : progression?.definitions || {};
    } catch (_) { raw = {}; }
    const thresholds = raw?.fieldRank?.xpThresholds
      || raw?.progression?.fieldRank?.xpThresholds || [];
    const xp = Math.max(0, Number(totalXp) || 0);
    let rank = 1;
    thresholds.forEach((threshold, index) => {
      if (Number.isFinite(Number(threshold)) && xp >= Number(threshold)) rank = index + 1;
    });
    return rank;
  }

  function doctrinePointCount(summary = {}) {
    if (Number.isFinite(Number(summary.pointsSpent))) {
      return Math.max(0, Math.floor(Number(summary.pointsSpent)));
    }
    if (summary.doctrinePoints && typeof summary.doctrinePoints === "object") {
      const value = summary.doctrinePoints.spent ?? summary.doctrinePoints.used;
      if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
    }
    if (Number.isFinite(Number(summary.doctrinePoints))) {
      return Math.max(0, Math.floor(Number(summary.doctrinePoints)));
    }
    if (summary.allocations && typeof summary.allocations === "object") {
      return Object.values(summary.allocations).reduce((sum, value) =>
        sum + (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0), 0);
    }
    return 0;
  }

  function activeVowCount(summary = {}) {
    if (Array.isArray(summary.activeVows)) return summary.activeVows.filter(Boolean).length;
    if (Array.isArray(summary.activeCapstones)) return summary.activeCapstones.filter(Boolean).length;
    if (Number.isFinite(Number(summary.activeVows))) {
      return Math.max(0, Math.floor(Number(summary.activeVows)));
    }
    return 0;
  }

  function doctrinePointLabel(summary = {}) {
    const spent = doctrinePointCount(summary);
    const source = summary.doctrinePoints && typeof summary.doctrinePoints === "object"
      ? summary.doctrinePoints : summary;
    const earned = source.earned ?? summary.pointsEarned;
    return Number.isFinite(Number(earned))
      ? `${spent} / ${Math.max(spent, Math.floor(Number(earned)))}` : String(spent);
  }

  function doctrineBuildLabel(summary = {}) {
    const authored = summary.buildLabel ?? summary.build ?? summary.doctrineBuild ?? summary.orderPoints;
    if (typeof authored === "string" && authored.trim()) return authored.trim();
    if (Array.isArray(authored)) {
      const labels = authored.map((entry) => typeof entry === "string" ? entry.trim()
        : entry?.name ? `${entry.name}${Number(entry.points) > 0 ? ` ${entry.points}` : ""}` : "").filter(Boolean);
      if (labels.length) {
        const vows = (summary.activeVowNames || summary.activeVows || []).filter?.(Boolean) || [];
        return `${labels.join(" · ")}${vows.length ? ` · Vows: ${vows.join(", ")}` : ""}`;
      }
    }
    const allocations = summary.allocations && typeof summary.allocations === "object"
      ? summary.allocations : null;
    if (allocations) {
      const orders = progressionDefinitions().orders || [];
      const labels = orders.map((order) => {
        const points = (order.talents || []).reduce((sum, talent) =>
          sum + Math.max(0, Math.floor(Number(allocations[talent.id]) || 0)), 0);
        return points > 0 ? `${order.shortName || order.name || order.id} ${points}` : "";
      }).filter(Boolean);
      if (labels.length) return labels.join(" · ");
    }
    const points = doctrinePointCount(summary);
    return points > 0 ? `${points} Doctrine ${points === 1 ? "point" : "points"} inscribed.`
      : "No Doctrine inscriptions recorded.";
  }

  function formatCareerTime(value, fallback) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return formatSavedAt(numeric);
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? formatSavedAt(parsed) : fallback;
  }

  function refreshCareerRecovery() {
    const panel = root.querySelector("[data-career-recovery]");
    if (!panel) return null;
    const conflict = readCareerConflict();
    const active = !!conflict?.active;
    const navBadge = root.querySelector("[data-career-recovery-nav]");
    const navButton = navBadge?.closest("[data-menu-panel='saves']");
    if (navBadge) navBadge.hidden = !active;
    if (navButton) {
      if (active) navButton.setAttribute("aria-label", "Save and load, Doctrine career review required");
      else navButton.removeAttribute("aria-label");
      navButton.classList.toggle("has-career-conflict", active);
    }
    if (!active && !careerRecovery.resolvedMessage) {
      panel.hidden = true;
      panel.dataset.state = "idle";
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
      careerRecovery.errorMessage = "";
      return conflict;
    }

    panel.hidden = false;
    const title = panel.querySelector("#sf-career-recovery-title");
    const copy = panel.querySelector("#sf-career-recovery-copy");
    const badge = panel.querySelector("[data-career-recovery-badge]");
    const status = panel.querySelector("[data-career-recovery-status]");
    if (!active) {
      panel.dataset.state = "resolved";
      panel.setAttribute("aria-busy", "false");
      title.textContent = "Career recovery complete";
      copy.textContent = "The selected Doctrine career is now authoritative.";
      badge.textContent = "SAVING RESUMED";
      status.textContent = careerRecovery.resolvedMessage;
      return conflict;
    }

    if (careerRecovery.armedUntil <= performance.now()) {
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
    }
    panel.dataset.state = careerRecovery.resolving ? "resolving" : "conflict";
    panel.setAttribute("aria-busy", careerRecovery.resolving ? "true" : "false");
    title.textContent = "Choose the career to preserve";
    badge.textContent = careerRecovery.resolving ? "RECOVERING" : "REVIEW REQUIRED";

    const branches = conflict.branches || {};
    const availableChoices = ["local", "synced"].filter((choice) => {
      const branch = branches[choice];
      return branch && branch.available !== false && branch.valid !== false;
    });
    copy.textContent = availableChoices.length < 2
      ? "A stored Doctrine career could not be verified. The verified record remains safe until you review and confirm it. Field saves are unaffected."
      : "This device and the synced record changed separately. Both are safe until you review and confirm one version. Field saves are unaffected.";
    for (const choice of ["local", "synced"]) {
      const branch = branches[choice] || {};
      const summary = branch.summary || {};
      const available = branch.available !== false && branch.valid !== false && !!branches[choice];
      const armed = careerRecovery.armedChoice === choice;
      const card = panel.querySelector(`[data-career-branch-card="${choice}"]`);
      const button = card?.querySelector("[data-career-recovery-action]");
      if (!card || !button) continue;
      card.dataset.state = available ? (armed ? "armed" : "available") : "unavailable";
      card.setAttribute("aria-label", `${choice === "local" ? "This device" : "Synced career"}${available ? "" : ", unavailable"}`);
      panel.querySelector(`[data-career-branch-rank="${choice}"]`).textContent = available
        ? String(careerRankAtXp(summary.totalXp, summary.rank)) : "—";
      panel.querySelector(`[data-career-branch-xp="${choice}"]`).textContent = available
        ? Math.max(0, Math.floor(Number(summary.totalXp) || 0)).toLocaleString() : "—";
      panel.querySelector(`[data-career-branch-points="${choice}"]`).textContent = available
        ? doctrinePointLabel(summary) : "—";
      panel.querySelector(`[data-career-branch-vows="${choice}"]`).textContent = available
        ? String(activeVowCount(summary)) : "—";
      panel.querySelector(`[data-career-branch-revision="${choice}"]`).textContent = available
        ? `REV ${Math.max(0, Math.floor(Number(summary.revision) || 0))}` : "NOT VERIFIED";
      panel.querySelector(`[data-career-branch-build="${choice}"]`).textContent = available
        ? doctrineBuildLabel(summary) : "This career record did not pass validation and cannot be selected.";
      const time = summary.updatedAt ?? branch.updatedAt ?? branch.at ?? conflict.at;
      panel.querySelector(`[data-career-branch-time="${choice}"]`).textContent = `${choice === "local" ? "Device record" : "Synced record"} · ${formatCareerTime(time, "time unavailable")}`;
      button.disabled = careerRecovery.resolving || !available;
      button.textContent = armed
        ? (choice === "local" ? "CONFIRM KEEP THIS DEVICE" : "CONFIRM USE SYNCED CAREER")
        : (choice === "local" ? "KEEP THIS DEVICE" : "USE SYNCED CAREER");
      button.setAttribute("aria-pressed", armed ? "true" : "false");
    }

    if (careerRecovery.resolving) {
      status.textContent = `Recovering the ${careerRecovery.armedChoice === "synced" ? "synced" : "device"} career…`;
    } else if (careerRecovery.errorMessage) {
      status.textContent = careerRecovery.errorMessage;
    } else if (careerRecovery.armedChoice) {
      status.textContent = `${careerRecovery.armedChoice === "local" ? "This device" : "Synced career"} selected. Press its confirm button to make it authoritative.`;
    } else {
      status.textContent = availableChoices.length === 1
        ? `Only the ${availableChoices[0] === "local" ? "device" : "synced"} career passed validation. Confirm it to resume career saving.`
        : "Compare both records. Your field saves are not affected.";
    }
    return conflict;
  }

  function refreshSaves() {
    try { saveData = save?.read?.() || saveData; } catch (_) { /* keep cache */ }
    refreshCareerRecovery();
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
    const openedFromTouchMenu = menu.lastFocus?.matches?.(".sf-menu-trigger--mobile");
    menu.returnToPointerLock = !openedFromTouchMenu && (document.pointerLockElement === canvas
      || document.activeElement === canvas || document.documentElement.classList.contains("sf-maximised"));
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
    careerRecovery.armedChoice = null;
    careerRecovery.armedUntil = 0;
    careerRecovery.errorMessage = "";
    if (!careerRecovery.resolving) careerRecovery.resolvedMessage = "";
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

  async function handleCareerRecovery(button) {
    const choice = button.dataset.careerChoice;
    if (!["local", "synced"].includes(choice) || careerRecovery.resolving) return false;
    const conflict = readCareerConflict();
    const branch = conflict?.branches?.[choice];
    if (!conflict?.active || !branch || branch.available === false || branch.valid === false) {
      careerRecovery.errorMessage = "That career record is unavailable and cannot be selected.";
      refreshCareerRecovery();
      menuSfx("error");
      announce(careerRecovery.errorMessage);
      return false;
    }

    if (careerRecovery.armedChoice !== choice || careerRecovery.armedUntil <= performance.now()) {
      careerRecovery.armedChoice = choice;
      careerRecovery.armedUntil = performance.now() + 8000;
      careerRecovery.errorMessage = "";
      refreshCareerRecovery();
      menuSfx("question");
      const prompt = `${choice === "local" ? "This device" : "Synced career"} selected. Press confirm to make it authoritative.`;
      announce(prompt);
      scheduleUiTimeout(() => {
        if (careerRecovery.armedChoice === choice
          && careerRecovery.armedUntil <= performance.now()) {
          careerRecovery.armedChoice = null;
          careerRecovery.armedUntil = 0;
          refreshCareerRecovery();
        }
      }, 8100);
      return true;
    }

    if (typeof save?.resolveCareerConflict !== "function") {
      careerRecovery.errorMessage = "Career recovery is temporarily unavailable. Both records remain preserved.";
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
      refreshCareerRecovery();
      menuSfx("error");
      announce(careerRecovery.errorMessage);
      return false;
    }

    careerRecovery.resolving = true;
    careerRecovery.errorMessage = "";
    refreshCareerRecovery();
    announce(`Recovering the ${choice === "local" ? "device" : "synced"} career.`);
    let result = null;
    try {
      result = await Promise.resolve(save.resolveCareerConflict(choice));
    } catch (error) {
      result = { ok: false, message: error?.message || "Career recovery failed." };
    }
    careerRecovery.resolving = false;
    careerRecovery.armedChoice = null;
    careerRecovery.armedUntil = 0;
    const resolved = result?.ok === true && !readCareerConflict()?.active;
    if (resolved) {
      careerRecovery.resolvedMessage = result.message
        || `${choice === "local" ? "This device" : "The synced career"} is now authoritative. Automatic career saving resumed.`;
      careerRecovery.errorMessage = "";
      refreshSaves();
      refreshDoctrine();
      menuSfx("confirm");
      announce(careerRecovery.resolvedMessage);
      requestAnimationFrame(() => {
        if (!destroyed && menu.open && menu.panel === "saves") {
          root.querySelector("[data-career-recovery]")?.focus?.({ preventScroll: true });
        }
      });
      return true;
    }

    careerRecovery.resolvedMessage = "";
    careerRecovery.errorMessage = result?.message
      || "Career recovery could not be completed. Both records remain preserved.";
    refreshCareerRecovery();
    menuSfx("error");
    announce(careerRecovery.errorMessage);
    requestAnimationFrame(() => {
      if (!destroyed && menu.open && menu.panel === "saves") {
        root.querySelector(`[data-career-choice="${choice}"]`)?.focus?.({ preventScroll: true });
      }
    });
    return false;
  }

  function finishDoctrineMutation(result, fallbackMessage, focusSelector = null) {
    const normalized = result && typeof result === "object"
      ? result : { ok: result !== false, message: fallbackMessage };
    const ok = normalized.ok !== false;
    refreshDoctrine(normalized.state || null);
    focusAfterDoctrineRefresh(focusSelector);
    menuSfx(ok ? "confirm" : "error");
    announce(normalized.message || fallbackMessage || (ok ? "Doctrine updated." : "Doctrine action unavailable."));
    return ok;
  }

  function callDoctrine(method, args, fallbackMessage, focusSelector) {
    if (typeof progression?.[method] !== "function") {
      return finishDoctrineMutation({ ok: false,
        message: "Doctrine service is unavailable." }, fallbackMessage, focusSelector);
    }
    try {
      return finishDoctrineMutation(progression[method](...args), fallbackMessage, focusSelector);
    } catch (error) {
      return finishDoctrineMutation({ ok: false,
        message: error?.message || "Doctrine action failed." }, fallbackMessage, focusSelector);
    }
  }

  function handleDoctrineAction(button) {
    const action = button.dataset.doctrineAction;
    const talentId = button.dataset.talentId;
    if (action === "inspect" && talentId) {
      doctrine.inspectedTalentId = doctrine.inspectedTalentId === talentId ? null : talentId;
      refreshDoctrine();
      const panel = root.querySelector("[data-doctrine-order-panel]");
      if (panel) panel.scrollTop = 0;
      focusAfterDoctrineRefresh(`[data-talent-action="inspect"][data-talent-id="${CSS.escape(talentId)}"]`);
      menuSfx("switch");
      return true;
    }
    if (action === "spend" && talentId) {
      return callDoctrine("spend", [talentId], "Rite inscribed.",
        `[data-talent-action="spend"][data-talent-id="${CSS.escape(talentId)}"]`);
    }
    if (action === "refund" && talentId) {
      return callDoctrine("refund", [talentId], "Rite refunded.",
        `[data-talent-action="refund"][data-talent-id="${CSS.escape(talentId)}"], [data-talent-action="spend"][data-talent-id="${CSS.escape(talentId)}"]`);
    }
    if (action === "vow") {
      const capstoneId = button.dataset.capstoneId;
      const slot = Number(button.dataset.capstoneSlot);
      if (button.dataset.capstoneAction === "unequip") {
        return callDoctrine("unequipCapstone", [slot], "Capstone Vow unbound.",
          `[data-capstone-id="${CSS.escape(capstoneId)}"] [data-doctrine-action="vow"]`);
      }
      return callDoctrine("equipCapstone", [capstoneId, slot], "Capstone Vow bound.",
        `[data-capstone-id="${CSS.escape(capstoneId)}"] [data-doctrine-action="vow"]`);
    }
    if (action === "respec") {
      if (doctrine.respecUntil <= performance.now()) {
        doctrine.respecUntil = performance.now() + 4500;
        refreshDoctrine();
        focusAfterDoctrineRefresh("[data-talent-respec]");
        menuSfx("question");
        announce("Press reset doctrine again to confirm.");
        scheduleUiTimeout(() => {
          if (doctrine.respecUntil && doctrine.respecUntil <= performance.now()) {
            doctrine.respecUntil = 0;
            if (menu.open && menu.panel === "doctrine") refreshDoctrine();
          }
        }, 4600);
        return true;
      }
      doctrine.respecUntil = 0;
      return callDoctrine("respec", [], "Doctrine reset.", "[data-talent-respec]");
    }
    return false;
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-menu-open]")) { openMenu("operation"); return; }
    if (target.matches("[data-menu-close]")) { closeMenu({ requestLock: true }); return; }
    if (target.matches("[data-menu-panel]")) { setPanel(target.dataset.menuPanel); return; }
    if (target.matches("[data-doctrine-order]")) {
      selectDoctrineOrder(target.dataset.doctrineOrder, { focus: true }); return;
    }
    if (target.matches("[data-doctrine-action]")) { handleDoctrineAction(target); return; }
    if (target.matches("[data-career-recovery-action]")) { void handleCareerRecovery(target); return; }
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
    if (target.matches('[data-setting="dynamic-res"]')) {
      settings.dynamicRes = !settings.dynamicRes;
      /* Applied on the CLICK, not in applySettings: applySettings runs
         on every menu refresh, and a `?dynres=0` session override must
         survive those. An explicit press still wins over the URL. */
      render?.setAutoScale?.(settings.dynamicRes);
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
      const doctrineTab = event.target instanceof Element
        ? event.target.closest("[data-doctrine-order][role='tab']") : null;
      if (doctrineTab && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.code)) {
        const tabs = Array.from(root.querySelectorAll("[data-doctrine-order][role='tab']"));
        const current = tabs.indexOf(doctrineTab);
        let next = current;
        if (event.code === "Home") next = 0;
        else if (event.code === "End") next = tabs.length - 1;
        else if (["ArrowLeft", "ArrowUp"].includes(event.code)) next = (current - 1 + tabs.length) % tabs.length;
        else next = (current + 1) % tabs.length;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && tabs[next]) selectDoctrineOrder(tabs[next].dataset.doctrineOrder, { focus: true });
      } else if (event.code === "KeyM") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) openMap();
      } else if (event.code === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        closeMenu({ requestLock: true });
      } else if (event.code === "Tab") {
        trapFocus(event);
        event.stopImmediatePropagation();
      } else if (!interactiveTarget
        && ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyQ", "KeyE", "KeyF", "KeyR"].includes(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (wheel.open) {
      if (event.code === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); cancelWheel("escape"); return;
      }
      if (event.code === "KeyF") { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.code === "Tab") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) {
          cancelWheel("menu");
          openMenu("operation", { force: true });
        }
        return;
      }
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
      if (openMenu("operation", { force: true })) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (event.code === "KeyF") {
      if (!ownsGameKeyboard()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) openWheel("keyboard");
    }
  }

  function onKeyUp(event) {
    if (menu.open) {
      if (event.code === "Tab" || event.code === "Escape" || event.code === "KeyF" || event.code === "KeyE") {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (event.code === "KeyF" && wheel.open && wheel.source === "keyboard") {
      event.preventDefault(); event.stopImmediatePropagation();
      cancelWheel("hold-release");
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

  function onMouseDown(event) {
    if (!wheel.open || wheel.source !== "keyboard") return;
    if (event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
      const cancelTarget = event.target instanceof Element && event.target.closest("[data-wheel-cancel]");
      if (cancelTarget) {
        cancelWheel("center");
        return;
      }
      const optionTarget = event.target instanceof Element && event.target.closest(".sf-command-wheel__option");
      if (optionTarget) {
        setWheelSelection(Number(optionTarget.dataset.index));
        closeWheel({ confirm: true, reason: "pointer-click" });
        return;
      }
      if (wheel.selectedIndex >= 0) {
        closeWheel({ confirm: true, reason: "pointer-click" });
      } else {
        cancelWheel("center");
      }
    }
  }

  function onMouseClick(event) {
    if (wheel.open && wheel.source === "keyboard" && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }

  function onMouseUp(event) {
    if (wheel.open && wheel.source === "keyboard" && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
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

  function canOpenCareerRecovery() {
    if (destroyed || ctx.runtime?.phase !== "playing" || ctx.intro?.isBlocking?.()
      || ctx.combat?.player?.dead) return false;
    const breachPhase = ctx.breaches?.status?.()?.phase;
    if (["warning", "active"].includes(breachPhase)) return false;
    return !ctx.player?.action && !ctx.boost?.state?.active && !ctx.slam?.state?.active
      && !ctx.shield?.state?.active && !ctx.jetpack?.state?.inFlight;
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("click", onMouseClick, true);
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
    if (result?.type === "career-conflict" && readCareerConflict()?.active) {
      let revealed = false;
      if (menu.open) { setPanel("saves"); revealed = true; }
      else if (canOpenCareerRecovery()) revealed = openMenu("saves");
      else announce("Doctrine career sync needs review. Open Save and Load when the field is quiet.");
      if (revealed) requestAnimationFrame(() => {
        if (!destroyed && menu.open && menu.panel === "saves") {
          root.querySelector("[data-career-recovery]")?.focus?.({ preventScroll: true });
        }
      });
    }
    if (result?.message) announce(result.message);
  });
  const stopProgression = progression?.onChange?.((result) => {
    const state = result?.state || (result?.rank !== undefined ? result : null);
    if (menu.open && menu.panel === "doctrine") refreshDoctrine(state);
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
      if (menu.panel === "doctrine" && doctrine.respecUntil
        && doctrine.respecUntil < performance.now()) {
        doctrine.respecUntil = 0;
        refreshDoctrine();
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
      || active.dataset.careerRecoveryAction !== undefined
      || active.dataset.doctrineAction !== undefined
      || active.dataset.doctrineOrder !== undefined
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
      doctrine: {
        order: doctrine.orderId,
        rank: doctrine.latestState?.rank ?? null,
        points: doctrine.latestState?.pointsAvailable ?? null,
        activeVows: activeCapstones(doctrine.latestState || {}).filter(Boolean),
        respecArmed: doctrine.respecUntil > performance.now(),
      },
      careerRecovery: {
        active: !!readCareerConflict()?.active,
        armedChoice: careerRecovery.armedChoice,
        resolving: careerRecovery.resolving,
        visible: !root.querySelector("[data-career-recovery]")?.hidden,
        state: root.querySelector("[data-career-recovery]")?.dataset.state || "idle",
        status: root.querySelector("[data-career-recovery-status]")?.textContent?.trim() || "",
      },
    };
  }

  function settingsState() {
    return {
      audioEnabled: audioEnabled(),
      hudScale: settings.hudScale,
      reducedMotion: settings.reducedMotion,
      highContrast: settings.highContrast,
      dynamicRes: settings.dynamicRes,
    };
  }

  function refresh() {
    if (destroyed) return;
    updateCommands();
    refreshOperation();
    refreshMap();
    refreshSaves();
    refreshDoctrine();
    applySettings();
    syncMaximizeButton();
  }

  /* One construction-time sync of the stored preference onto the
     renderer. main.js applies any `?dynres` URL override AFTER this,
     so the param wins for the session without a fight over refresh(). */
  render?.setAutoScale?.(settings.dynamicRes);

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
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onMouseClick, true);
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
      stopWon?.(); stopLost?.(); stopSave?.(); stopProgression?.();

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
      doctrine.respecUntil = 0;
      clearedUntil.clear();
      root.remove();
      if (stage.__saintfallGameUi === publicApi) delete stage.__saintfallGameUi;
      return true;
    },
  };
  stage.__saintfallGameUi = publicApi;
  return publicApi;
}
