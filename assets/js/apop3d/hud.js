/* ============================================================
   APOP DEMON MOGGERS 3D - HUD, menus and overlays

   DOM, not canvas. Text rendered by the browser is crisper at any DPI
   than glyphs baked into a WebGL texture, costs zero draw calls
   against the 300-call budget, and is readable by a screen reader.

   Implements the frozen §9 surface:

     setHealth · setClout · setRecords · setMog · toast · prompt
     clearPrompt · openMenu · closeMenu · setBeatPulse · setVisible

   plus setDeals, setTimer, courseCard and setUnderwater, which
   collect.js and world.js need and which do not change any existing
   signature.

   Five rules this file is built around:

   1. THE POWER METER IS A DIAL, NOT A BAR. SM64's is a segmented
      wedge that only exists when it matters - it spins in when you
      take a hit or go under water, and spins out again when you are
      whole. A bar pinned to the corner all game is a different genre.

   2. NUMBERS TICK, THEY DO NOT SNAP. Clout and Records ease toward
      their target and punch on each integer. This is most of what
      makes a collectathon HUD feel expensive, and it costs one
      exponential per frame.

   3. LEGIBLE OVER A BRIGHT SKY. Courses are neon and the sky is not
      dark. The stylesheet gives .ap-hud a hard text shadow; on top of
      that every readout carries its own scrim plate, so no glyph ever
      depends on what happens to be behind it.

   4. NO LAYOUT PER FRAME. Every write goes through setText/setStyle/
      setFlag, which skip no-op assignments, and anything that moves
      uses `transform`. A HUD that dirties layout sixty times a second
      costs more than the renderer does.

   5. setVisible(false) LEAVES NOTHING. The screenshot harness hides
      the HUD to compare frames blind against real Super Mario 64
      captures. Hidden means the HUD root and the overlay are both
      display:none AND every per-frame write is skipped - a HUD that
      is merely transparent still shows up in a compositor grab.

   The whole HUD scales from one number, `--ap-hs`, computed from the
   stage rectangle rather than from vw/vh: the game normally sits in a
   1280px panel inside the site chrome and only fills the viewport in
   fullscreen, so viewport units would size it for the wrong box.
   ============================================================ */

import { clamp, clamp01, damp, ease } from "apop3d/core.js";

const DESIGN_WIDTH = 1280;
const HUD_SCALE_MIN = 0.52;
const HUD_SCALE_MAX = 1.7;

const HEALTH_HOLD = 2.4;      // seconds the dial stays up after topping off
const PROMPT_LINGER = 0.28;   // a prompt not refreshed this long fades out
const TOAST_LIFE = 2.9;
const TOAST_MAX = 3;
const BEAT_EXTERNAL_TIMEOUT = 1.2;   // fall back to clock.beat after this

const COURSE_NAMES = {
  0: "THE LABEL LOBBY",
  1: "THE MALL FOOD COURT",
  2: "THE AWARDS-SHOW RED CARPET",
  3: "THE STREAMING FARM BASEMENT",
  4: "INFLUENCER ROOFTOP AFTERPARTY",
  5: "BOYZ II HELL - FINAL LIVESTREAM",
};

const COURSE_SUBS = {
  0: "Five paintings. Thirty-five Records. One boy band to disband.",
  1: "A demon flash mob broke out by the Cinnabon.",
  2: "Step and repeat, then step on their necks.",
  3: "Somebody is farming your streams. Unplug them.",
  4: "The party is on the roof. So is the drop.",
  5: "Live. Unedited. Unsigned.",
};

/* --------------------------- geometry --------------------------- */

/** Annular sector path, angles in radians clockwise from twelve. The
 *  power dial is eight of these; drawing it in SVG rather than with
 *  border tricks keeps the segment gaps crisp at every scale. */
function wedgePath(cx, cy, rOuter, rInner, a0, a1) {
  const px = (r, a) => (cx + Math.cos(a - Math.PI / 2) * r).toFixed(2);
  const py = (r, a) => (cy + Math.sin(a - Math.PI / 2) * r).toFixed(2);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${px(rOuter, a0)} ${py(rOuter, a0)}`
    + `A${rOuter} ${rOuter} 0 ${large} 1 ${px(rOuter, a1)} ${py(rOuter, a1)}`
    + `L${px(rInner, a1)} ${py(rInner, a1)}`
    + `A${rInner} ${rInner} 0 ${large} 0 ${px(rInner, a0)} ${py(rInner, a0)}Z`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/* ----------------------------- module ----------------------------- */

export function create(ctx) {
  const hudRoot = document.getElementById("ap-hud");
  const overlayRoot = document.getElementById("ap-overlay");

  // A missing host is not a crash. The engine has to keep running for
  // whoever is looking at the renderer.
  if (!hudRoot) {
    console.warn("[apop3d] #ap-hud not found; HUD disabled");
    return { update() {}, setVisible() {}, closeMenu() {} };
  }

  hudRoot.innerHTML = "";
  if (overlayRoot) overlayRoot.innerHTML = "";

  /* -------------------------- dom plumbing -------------------------- */

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    (parent || hudRoot).appendChild(node);
    return node;
  };

  const svgEl = (tag, parent, attrs) => {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  };

  // Expando-cached writes. Individually cheap, ruinous in aggregate.
  const setText = (node, value) => {
    if (node.__t !== value) { node.__t = value; node.textContent = value; }
  };
  const setStyle = (node, prop, value) => {
    const key = `__s_${prop}`;
    if (node[key] !== value) { node[key] = value; node.style.setProperty(prop, value); }
  };
  const setFlag = (node, name, on) => {
    const key = `__c_${name}`;
    if (node[key] !== on) { node[key] = on; node.classList.toggle(name, on); }
  };

  /* ----------------------------- state ----------------------------- */

  const state = {
    visible: true,
    hs: 1,
    stageW: 0,

    clout: { value: 0, shown: 0, punch: 0 },
    records: { value: 0, total: 7, shown: 0, punch: 0, all: 0 },

    health: { value: 8, max: 8, shown: 8, hold: 0, open: 0, target: 0, underwater: false, hurt: 0 },
    mog: { value: 0, shown: 0 },

    beat: { pulse: 0, phase: 0, index: 0, onBeat: false, external: -99, hot: 0 },

    prompt: { text: "", stamp: -99, open: 0 },
    toasts: [],
    timer: { seconds: null, label: "", flash: 0 },
    deals: [],

    card: { life: 0 },
    menu: null,
    menuData: null,
  };

  /* ============================================================
     COLLECTION READOUTS - top left
     ============================================================ */

  const counters = el("div", "ap-counters");

  /* ---- Platinum Records ---- */

  const recordBlock = el("div", "ap-count ap-count--record", counters);
  const recordGlyph = svgEl("svg", recordBlock, { viewBox: "0 0 40 40", class: "ap-count__glyph", "aria-hidden": "true" });
  svgEl("circle", recordGlyph, { cx: 20, cy: 20, r: 18, class: "ap-disc__body" });
  svgEl("circle", recordGlyph, { cx: 20, cy: 20, r: 13.5, class: "ap-disc__groove" });
  svgEl("circle", recordGlyph, { cx: 20, cy: 20, r: 9.5, class: "ap-disc__groove" });
  svgEl("circle", recordGlyph, { cx: 20, cy: 20, r: 5.5, class: "ap-disc__label" });
  svgEl("circle", recordGlyph, { cx: 20, cy: 20, r: 1.4, class: "ap-disc__hole" });
  // A rim arc, not a diagonal across the middle: a bar through a pink
  // circle reads as a no-entry sign, which is not what a record is.
  svgEl("path", recordGlyph, { d: "M7.4 14.2 A14 14 0 0 1 17 6.4", class: "ap-disc__shine" });

  const recordRead = el("div", "ap-count__read", recordBlock);
  const recordNum = el("b", "ap-count__num", recordRead, "0");
  el("s", "ap-count__slash", recordRead, "/");
  const recordTotal = el("i", "ap-count__total", recordRead, "7");

  // Seven pips inline with the number rather than hung below the plate:
  // the counters stack tightly and anything overhanging one lands on
  // top of the next.
  const recordPips = el("div", "ap-pips", recordBlock);
  const pipNodes = [];
  for (let i = 0; i < 7; i += 1) pipNodes.push(el("i", "ap-pips__pip", recordPips));

  /* ---- Clout ---- */

  const cloutBlock = el("div", "ap-count ap-count--clout", counters);
  const cloutGlyph = svgEl("svg", cloutBlock, { viewBox: "0 0 40 40", class: "ap-count__glyph", "aria-hidden": "true" });
  svgEl("circle", cloutGlyph, { cx: 20, cy: 20, r: 17, class: "ap-coin__body" });
  svgEl("circle", cloutGlyph, { cx: 20, cy: 20, r: 13, class: "ap-coin__rim" });
  const cloutMark = svgEl("text", cloutGlyph, { x: 20, y: 26.5, class: "ap-coin__mark", "text-anchor": "middle" });
  cloutMark.textContent = "C";

  const cloutRead = el("div", "ap-count__read", cloutBlock);
  el("s", "ap-count__x", cloutRead, "×");
  const cloutNum = el("b", "ap-count__num", cloutRead, "0");
  const cloutGain = el("u", "ap-count__gain", cloutBlock, "");

  /* ============================================================
     THE POWER METER - top right
     ============================================================ */

  const power = el("div", "ap-power");
  const powerSvg = svgEl("svg", power, { viewBox: "0 0 120 120", class: "ap-power__dial", "aria-hidden": "true" });

  const powerDefs = svgEl("defs", powerSvg);
  const powerGrad = svgEl("radialGradient", powerDefs, { id: "apPowerCore", cx: "38%", cy: "32%", r: "78%" });
  svgEl("stop", powerGrad, { offset: "0%", "stop-color": "#3a1230" });
  svgEl("stop", powerGrad, { offset: "100%", "stop-color": "#0a0710" });

  svgEl("circle", powerSvg, { cx: 60, cy: 60, r: 52, class: "ap-power__plate" });
  svgEl("circle", powerSvg, { cx: 60, cy: 60, r: 52, class: "ap-power__rim" });
  const wedgeLayer = svgEl("g", powerSvg, { class: "ap-power__wedges" });
  svgEl("circle", powerSvg, { cx: 60, cy: 60, r: 25, class: "ap-power__core", fill: "url(#apPowerCore)" });
  svgEl("circle", powerSvg, { cx: 60, cy: 60, r: 25, class: "ap-power__corerim" });

  // The core holds the number and nothing else. A character portrait or
  // a glyph at this size (the core is ~46 CSS pixels) competes with the
  // one thing the player is actually reading.
  const powerLabel = el("b", "ap-power__value", power, "8");
  const powerCaption = el("s", "ap-power__caption", power, "HEALTH");

  let wedgeNodes = [];
  /** Rebuild only when the segment count changes. maxHp is fixed for a
   *  course, so in practice this runs once. */
  function buildWedges(segments) {
    while (wedgeLayer.firstChild) wedgeLayer.removeChild(wedgeLayer.firstChild);
    wedgeNodes = [];
    const step = (Math.PI * 2) / segments;
    const gap = Math.min(0.09, step * 0.16);
    for (let i = 0; i < segments; i += 1) {
      const a0 = i * step + gap * 0.5;
      const a1 = (i + 1) * step - gap * 0.5;
      const d = wedgePath(60, 60, 50, 28, a0, a1);
      svgEl("path", wedgeLayer, { d, class: "ap-power__slot" });
      wedgeNodes.push(svgEl("path", wedgeLayer, { d, class: "ap-power__wedge" }));
    }
  }
  buildWedges(8);

  /* ---- Record Deal timers, under the dial ---- */

  const dealRack = el("div", "ap-deals");
  const dealNodes = new Map();   // dealId -> { row, fill, name, time }

  /* ============================================================
     BEAT + MOG - bottom left
     ============================================================ */

  const rhythm = el("div", "ap-rhythm");

  const beatBox = el("div", "ap-beat", rhythm);
  const beatRing = el("i", "ap-beat__ring", beatBox);
  const beatCore = el("s", "ap-beat__core", beatBox);
  const beatPips = el("div", "ap-beat__pips", beatBox);
  const beatPipNodes = [];
  for (let i = 0; i < 4; i += 1) beatPipNodes.push(el("i", "ap-beat__pip", beatPips));
  const beatLabel = el("b", "ap-beat__label", beatBox, "124 BPM");

  const mogBox = el("div", "ap-mog", rhythm);
  el("span", "ap-mog__label", mogBox, "MOG");
  const mogTrack = el("div", "ap-mog__track", mogBox);
  const mogFill = el("i", "ap-mog__fill", mogTrack);
  const mogKey = el("kbd", "ap-mog__key", mogBox, "F");

  /* ============================================================
     TIMER, TOASTS, PROMPT, TITLE CARD
     ============================================================ */

  const timerBox = el("div", "ap-timer");
  const timerLabel = el("s", "ap-timer__label", timerBox, "");
  const timerValue = el("b", "ap-timer__value", timerBox, "0.0");

  const toastStack = el("div", "ap-toasts");

  const promptBox = el("div", "ap-prompt");
  const promptKey = el("kbd", "ap-prompt__key", promptBox, "");
  const promptText = el("span", "ap-prompt__text", promptBox, "");

  const titleCard = el("div", "ap-card");
  const cardKicker = el("s", "ap-card__kicker", titleCard, "");
  const cardTitle = el("b", "ap-card__title", titleCard, "");
  const cardSub = el("i", "ap-card__sub", titleCard, "");

  /* ============================================================
     OVERLAY MENUS
     ============================================================ */

  const menuHost = overlayRoot || el("div", "ap-overlay");
  const menuScrim = el("div", "ap-menu__scrim", menuHost);
  const menuPanel = el("div", "ap-menu", menuHost);

  function clearPanel() {
    while (menuPanel.firstChild) menuPanel.removeChild(menuPanel.firstChild);
    menuPanel.className = "ap-menu";
  }

  const menuButton = (parent, label, action, tone) => {
    const btn = el("button", `ap-btn${tone ? ` ap-btn--${tone}` : ""}`, parent, label);
    btn.type = "button";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      runAction(action);
    });
    return btn;
  };

  function runAction(action) {
    if (action === "resume") { closeMenu(); ctx.state.paused = false; ctx.bus.emit("hud:resume", {}); return; }
    if (action === "restart") { closeMenu(); ctx.state.paused = false; ctx.bus.emit("hud:restart", { course: ctx.state.course }); return; }
    if (action === "hub") { closeMenu(); ctx.state.paused = false; ctx.bus.emit("hud:quit", { to: 0 }); return; }
    if (action === "close") { closeMenu(); return; }
    ctx.bus.emit("hud:action", { action });
  }

  const statRow = (parent, label, value, tone) => {
    const row = el("div", `ap-stat${tone ? ` ap-stat--${tone}` : ""}`, parent);
    el("s", "ap-stat__label", row, label);
    const v = el("b", "ap-stat__value", row, String(value));
    return v;
  };

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  /* ---- the big record disc, reused by the ceremony card ---- */

  function buildBigDisc(parent) {
    const wrap = el("div", "ap-bigdisc", parent);
    const s = svgEl("svg", wrap, { viewBox: "0 0 120 120", "aria-hidden": "true" });
    const defs = svgEl("defs", s);
    const grad = svgEl("radialGradient", defs, { id: "apBigDisc", cx: "36%", cy: "30%", r: "80%" });
    svgEl("stop", grad, { offset: "0%", "stop-color": "#ffffff" });
    svgEl("stop", grad, { offset: "42%", "stop-color": "#dfe7f2" });
    svgEl("stop", grad, { offset: "78%", "stop-color": "#9aabc2" });
    svgEl("stop", grad, { offset: "100%", "stop-color": "#63738c" });
    svgEl("circle", s, { cx: 60, cy: 60, r: 56, fill: "url(#apBigDisc)" });
    for (let r = 22; r < 55; r += 4) {
      svgEl("circle", s, { cx: 60, cy: 60, r, class: "ap-bigdisc__groove" });
    }
    svgEl("circle", s, { cx: 60, cy: 60, r: 19, class: "ap-bigdisc__label" });
    svgEl("circle", s, { cx: 60, cy: 60, r: 3, class: "ap-bigdisc__hole" });
    svgEl("path", s, { d: "M18 26 A56 56 0 0 1 92 14 L74 40 A34 34 0 0 0 34 46 Z", class: "ap-bigdisc__shine" });
    return wrap;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  function setClout(n) {
    const value = Math.max(0, Math.floor(Number(n) || 0));
    if (value > state.clout.value) {
      const gain = value - state.clout.value;
      state.clout.punch = 1;
      setText(cloutGain, `+${gain}`);
      cloutGain.classList.remove("is-pop");
      // Restart the CSS animation: reading offsetWidth is the cheapest
      // reliable way to force the reflow that re-arms it.
      void cloutGain.offsetWidth;
      cloutGain.classList.add("is-pop");
    }
    state.clout.value = value;
  }

  function setRecords(n, total) {
    const value = Math.max(0, Math.floor(Number(n) || 0));
    if (value > state.records.value) state.records.punch = 1;
    state.records.value = value;
    if (Number.isFinite(total) && total > 0) state.records.total = Math.floor(total);
  }

  function setHealth(v, max) {
    const m = Number.isFinite(max) && max > 0 ? Math.floor(max) : state.health.max;
    const value = clamp(Number(v) || 0, 0, m);
    if (m !== state.health.max) { state.health.max = m; buildWedges(clamp(m, 3, 16)); }
    if (value < state.health.value) state.health.hurt = 1;
    // The hold window keeps the dial up for a beat AFTER the player is
    // whole again. It must only be armed by an actual change: player.js
    // pushes health every frame, and refreshing on every call would pin
    // the meter open for the whole game, which is the one thing the
    // SM64 power meter never does.
    const changed = value !== state.health.value;
    state.health.value = value;
    if (changed || value < m) state.health.hold = HEALTH_HOLD;
  }

  function setMog(v) { state.mog.value = clamp01(Number(v) || 0); }

  /** strength 0..1. Called by audio.js on each beat; if nothing calls it
   *  the HUD drives itself from clock.beat so the window is always
   *  visible - a beat indicator that stops moving is worse than none. */
  function setBeatPulse(strength) {
    const s = clamp01(Number(strength) || 0);
    state.beat.external = ctx.clock.t;
    if (s > state.beat.pulse) {
      state.beat.pulse = s;
      state.beat.index = (state.beat.index + 1) % 4;
    }
  }

  function toast(text, opts) {
    if (!text) return null;
    const o = opts || {};
    const node = el("div", `ap-toast${o.tone ? ` ap-toast--${o.tone}` : ""}${o.small ? " is-small" : ""}`, toastStack);
    el("b", "ap-toast__text", node, String(text));
    if (o.sub) el("s", "ap-toast__sub", node, String(o.sub));
    if (Number.isFinite(o.color)) {
      node.style.setProperty("--toast-tint", `#${(o.color >>> 0).toString(16).padStart(6, "0")}`);
    }
    const entry = { node, life: Number.isFinite(o.life) ? o.life : TOAST_LIFE, age: 0 };
    state.toasts.push(entry);
    while (state.toasts.length > TOAST_MAX) {
      const dropped = state.toasts.shift();
      dropped.node.remove();
    }
    return entry;
  }

  /** Context prompts are pushed every frame while the player is in
   *  range, so this is idempotent and self-expiring. Callers do not
   *  have to remember to clear. */
  function prompt(text, opts) {
    const value = String(text || "");
    if (!value) { clearPrompt(); return; }
    state.prompt.stamp = ctx.clock.t;
    if (state.prompt.text === value) return;
    state.prompt.text = value;
    const key = (opts && opts.key) || guessPromptKey(value);
    setText(promptKey, key);
    setStyle(promptKey, "display", key ? "" : "none");
    setText(promptText, value);
  }

  /** The verb in the prompt implies the button. Authoring a key at
   *  every call site is how prompts end up disagreeing with the
   *  control scheme. */
  function guessPromptKey(text) {
    const t = text.toLowerCase();
    if (t.indexOf("pound") !== -1) return "CTRL";
    if (t.indexOf("jump") !== -1 || t.indexOf("climb") !== -1) return "SPACE";
    if (t.indexOf("beam") !== -1) return "E";
    if (t.indexOf("aura") !== -1 || t.indexOf("mog") !== -1) return "F";
    if (t.indexOf("crouch") !== -1 || t.indexOf("crawl") !== -1) return "SHIFT";
    return "";
  }

  function clearPrompt() {
    state.prompt.text = "";
    state.prompt.stamp = -99;
  }

  /** Added: countdown for blue-switch windows and timed runs. Pass null
   *  to clear, a number alone to update, or (n, label) to relabel. */
  function setTimer(seconds, label) {
    if (seconds === null || seconds === undefined) { state.timer.seconds = null; return; }
    state.timer.seconds = Math.max(0, Number(seconds) || 0);
    if (label !== undefined) state.timer.label = String(label);
  }

  /** Added: the live Record Deal list, straight from collect.js. */
  function setDeals(list) {
    state.deals = Array.isArray(list) ? list : [];
  }

  /** Added: the course intro slam. SM64 names the course over the first
   *  seconds of the drop-in and it is half of what makes arriving feel
   *  like arriving. */
  function courseCard(title, sub, kicker) {
    const id = ctx.state.course;
    setText(cardKicker, String(kicker || (id ? `COURSE ${id}` : "HUB")));
    setText(cardTitle, String(title || COURSE_NAMES[id] || "APOP DEMON MOGGERS"));
    setText(cardSub, String(sub !== undefined ? sub : (COURSE_SUBS[id] || "")));
    state.card.life = 4.2;
    titleCard.classList.remove("is-in");
    void titleCard.offsetWidth;
    titleCard.classList.add("is-in");
  }

  function setUnderwater(on) { state.health.underwater = !!on; }

  /* ------------------------------ menus ------------------------------ */

  function openMenu(name, data) {
    if (name === "course-title") { courseCard(data && data.title, data && data.sub); return; }

    state.menu = name;
    state.menuData = data || {};
    clearPanel();

    if (name === "pause") buildPause(data || {});
    else if (name === "results") buildResults(data || {});
    else if (name === "record") buildRecordCard(data || {});
    else if (name === "door-locked") buildDoorLocked(data || {});
    else buildGeneric(name, data || {});

    menuHost.classList.add("is-open");
    // "passive" menus are cinematic, not interactive: they must not eat
    // the pointer, because the game underneath is still playing.
    const passive = name === "record" || name === "door-locked";
    setFlag(menuHost, "ap-overlay--passive", passive);
    menuPanel.classList.add("is-in");
    if (state.visible === false) menuHost.style.display = "none";
    ctx.bus.emit("hud:menu", { name, open: true });
  }

  function closeMenu() {
    if (!state.menu) return;
    const was = state.menu;
    state.menu = null;
    state.menuData = null;
    menuHost.classList.remove("is-open");
    setFlag(menuHost, "ap-overlay--passive", false);
    menuPanel.classList.remove("is-in");
    ctx.bus.emit("hud:menu", { name: was, open: false });
  }

  function buildPause(data) {
    menuPanel.classList.add("ap-menu--pause");
    el("s", "ap-menu__kicker", menuPanel, COURSE_NAMES[ctx.state.course] || "APOP DEMON MOGGERS");
    el("b", "ap-menu__title", menuPanel, "PAUSED");

    const stats = el("div", "ap-menu__stats", menuPanel);
    statRow(stats, "PLATINUM RECORDS", `${state.records.value} / ${state.records.total}`, "platinum");
    statRow(stats, "CLOUT THIS COURSE", state.clout.value, "gold");
    statRow(stats, "RECORDS IN ALL", data.allRecords !== undefined ? data.allRecords : (ctx.state.records || 0));

    const actions = el("div", "ap-menu__actions", menuPanel);
    menuButton(actions, "RESUME", "resume", "primary");
    menuButton(actions, "RESTART COURSE", "restart");
    menuButton(actions, "EXIT TO THE LOBBY", "hub", "ghost");

    el("i", "ap-menu__foot", menuPanel, "ESC to resume");
  }

  function buildResults(data) {
    menuPanel.classList.add("ap-menu--results");
    el("s", "ap-menu__kicker", menuPanel, COURSE_NAMES[data.courseId !== undefined ? data.courseId : ctx.state.course] || "");
    el("b", "ap-menu__title", menuPanel, data.title || "COURSE CLEAR");

    const stats = el("div", "ap-menu__stats", menuPanel);
    statRow(stats, "RECORDS FOUND", `${data.records !== undefined ? data.records : state.records.value} / 7`, "platinum");
    statRow(stats, "CLOUT", data.clout !== undefined ? data.clout : state.clout.value, "gold");
    statRow(stats, "TIME", formatTime(data.time), "");
    if (Number.isFinite(data.best)) statRow(stats, "BEST", formatTime(data.best), "cyan");

    if (Array.isArray(data.badges) && data.badges.length) {
      const rack = el("div", "ap-menu__badges", menuPanel);
      for (const badge of data.badges) el("span", "ap-badge", rack, String(badge));
    }

    const actions = el("div", "ap-menu__actions", menuPanel);
    menuButton(actions, "BACK TO THE LOBBY", "hub", "primary");
    menuButton(actions, "RUN IT AGAIN", "restart");
  }

  /** The ceremony card. collect.js opens this at the top of the orbit
   *  and closes it when the course exits. */
  function buildRecordCard(data) {
    menuPanel.classList.add("ap-menu--record");
    buildBigDisc(menuPanel);
    el("s", "ap-menu__kicker", menuPanel, "YOU GOT A");
    el("b", "ap-menu__title", menuPanel, "PLATINUM RECORD");
    el("i", "ap-menu__name", menuPanel, String(data.name || ""));

    const tally = el("div", "ap-menu__tally", menuPanel);
    for (let i = 0; i < (data.total || 7); i += 1) {
      el("i", `ap-pips__pip${i < (data.index || 1) ? " is-on" : ""}`, tally);
    }
    el("u", "ap-menu__count", menuPanel,
      `${data.index || 1} OF ${data.total || 7} IN ${COURSE_NAMES[data.courseId] || "THIS COURSE"}`);
  }

  function buildDoorLocked(data) {
    menuPanel.classList.add("ap-menu--locked");
    el("s", "ap-menu__kicker", menuPanel, "THE DOOR WILL NOT OPEN");
    el("b", "ap-menu__title", menuPanel, `${data.need || 8} RECORDS`);
    const have = data.have !== undefined ? data.have : (ctx.state.records || 0);
    el("i", "ap-menu__name", menuPanel,
      `You are holding ${have}. ${Math.max(0, (data.need || 8) - have)} to go.`);
  }

  function buildGeneric(name, data) {
    el("b", "ap-menu__title", menuPanel, String(data.title || name).toUpperCase());
    if (data.body) el("i", "ap-menu__name", menuPanel, String(data.body));
    const actions = el("div", "ap-menu__actions", menuPanel);
    menuButton(actions, "CLOSE", "close", "primary");
  }

  /* ---------------------------- visibility ---------------------------- */

  function setVisible(on) {
    const next = !!on;
    if (state.visible === next) return;
    state.visible = next;
    hudRoot.classList.toggle("is-hidden", !next);
    // The overlay lives outside the HUD root, so hiding one is not
    // enough. A blind-comparison frame must contain nothing of ours.
    menuHost.style.display = next ? "" : "none";
    if (next && state.menu) menuHost.classList.add("is-open");
  }

  /* ============================================================
     PER-FRAME
     ============================================================ */

  /** The HUD sizes off the stage rectangle, not the viewport. A
   *  ResizeObserver rather than a resize listener, because entering
   *  fullscreen resizes the stage without resizing the window. */
  const stage = hudRoot.parentElement || hudRoot;
  function measure() {
    const width = stage.clientWidth || ctx.canvas.clientWidth || DESIGN_WIDTH;
    if (Math.abs(width - state.stageW) < 2) return;
    state.stageW = width;
    state.hs = clamp(width / DESIGN_WIDTH, HUD_SCALE_MIN, HUD_SCALE_MAX);
    hudRoot.style.setProperty("--ap-hs", state.hs.toFixed(3));
    menuHost.style.setProperty("--ap-hs", state.hs.toFixed(3));
  }
  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(measure);
    observer.observe(stage);
  }
  measure();

  /* ---- number tickers ---- */

  /** Ease toward the target, but guarantee at least one unit of travel
   *  per frame so a big payout finishes in a bounded time instead of
   *  asymptotically creeping for ten seconds. */
  function tick(shown, target, dt, rate) {
    if (shown === target) return target;
    let next = damp(shown, target, rate, dt);
    const step = Math.max(1, Math.abs(target - shown) * 0.02);
    if (Math.abs(target - next) < step * 0.5 || Math.abs(next - shown) < step * dt * 30) {
      next = target > shown ? Math.min(target, shown + step) : Math.max(target, shown - step);
    }
    return Math.abs(target - next) < 0.5 ? target : next;
  }

  function updateCounters(dt) {
    const c = state.clout;
    c.shown = tick(c.shown, c.value, dt, 9);
    setText(cloutNum, String(Math.round(c.shown)));
    c.punch = damp(c.punch, 0, 9, dt);
    setStyle(cloutBlock, "--punch", c.punch.toFixed(3));

    const r = state.records;
    r.shown = tick(r.shown, r.value, dt, 7);
    setText(recordNum, String(Math.round(r.shown)));
    setText(recordTotal, String(r.total));
    r.punch = damp(r.punch, 0, 7, dt);
    setStyle(recordBlock, "--punch", r.punch.toFixed(3));

    const filled = Math.round(r.shown);
    for (let i = 0; i < pipNodes.length; i += 1) {
      setFlag(pipNodes[i], "is-on", i < filled);
      setFlag(pipNodes[i], "is-hidden", i >= r.total);
    }
  }

  function updateHealth(dt) {
    const h = state.health;
    h.shown = damp(h.shown, h.value, 12, dt);
    h.hurt = damp(h.hurt, 0, 5, dt);
    if (h.hold > 0) h.hold -= dt;

    // The dial exists only when it has something to say: damaged, under
    // water, or inside the hold window after being topped back up.
    const wants = h.value < h.max || h.underwater || h.hold > 0;
    h.target = wants ? 1 : 0;
    h.open = damp(h.open, h.target, wants ? 13 : 8, dt);
    if (h.open < 0.002 && !wants) h.open = 0;

    setFlag(power, "is-up", h.open > 0.01);
    setStyle(power, "--open", h.open.toFixed(3));
    setStyle(power, "--hurt", h.hurt.toFixed(3));
    if (h.open < 0.01) return;

    const whole = Math.ceil(h.shown - 0.001);
    const frac = h.shown - Math.floor(h.shown);
    const low = h.value <= Math.max(1, Math.floor(h.max * 0.28));
    setFlag(power, "is-low", low);
    setFlag(power, "is-water", h.underwater);

    for (let i = 0; i < wedgeNodes.length; i += 1) {
      const on = i < whole;
      setFlag(wedgeNodes[i], "is-on", on);
      // The partially-drained wedge fades rather than blinking off, so
      // chip damage is legible on a dial with only eight steps.
      const alpha = on && i === whole - 1 && frac > 0 ? 0.35 + frac * 0.65 : 1;
      setStyle(wedgeNodes[i], "opacity", on ? alpha.toFixed(2) : "0");
    }
    setText(powerLabel, String(Math.max(0, Math.ceil(h.shown - 0.001))));
    setText(powerCaption, h.underwater ? "BREATH" : "HEALTH");
  }

  function updateBeat(dt) {
    const b = state.beat;
    const clock = ctx.clock;

    // Self-drive when nothing external is feeding us. audio.js takes
    // over the moment it starts calling setBeatPulse.
    if (clock.t - b.external > BEAT_EXTERNAL_TIMEOUT) {
      const phase = clamp01(clock.beat || 0);
      if (phase < b.phase) { b.pulse = 1; b.index = (clock.beatIndex || 0) % 4; }
      b.phase = phase;
      b.onBeat = !!clock.onBeat;
    } else {
      b.phase = clamp01(clock.beat || 0);
      b.onBeat = !!clock.onBeat;
    }

    b.pulse = damp(b.pulse, 0, 7, dt);
    b.hot = damp(b.hot, b.onBeat ? 1 : 0, b.onBeat ? 22 : 9, dt);

    // The ring collapses toward the core across the beat and snaps out
    // on the downbeat: the player reads the window by watching the gap
    // close, not by reacting to a flash that has already happened.
    const collapse = 1.9 - ease.outCubic(clamp01(b.phase)) * 0.95 + b.pulse * 0.55;
    setStyle(beatRing, "transform", `translate(-50%, -50%) scale(${collapse.toFixed(3)})`);
    setStyle(beatRing, "opacity", (0.44 + b.hot * 0.56).toFixed(3));
    setStyle(beatCore, "transform", `translate(-50%, -50%) scale(${(1 + b.pulse * 0.42).toFixed(3)})`);
    setFlag(beatBox, "is-hot", b.hot > 0.4);
    for (let i = 0; i < beatPipNodes.length; i += 1) setFlag(beatPipNodes[i], "is-on", i === b.index);
    setText(beatLabel, b.hot > 0.4 ? "ON BEAT" : "124 BPM");

    const m = state.mog;
    m.shown = damp(m.shown, m.value, 10, dt);
    setStyle(mogFill, "transform", `scaleX(${m.shown.toFixed(3)})`);
    setFlag(mogBox, "is-full", m.value > 0.995);
    setFlag(mogKey, "is-ready", m.value > 0.995);
  }

  function updateDeals(dt) {
    const seen = new Set();
    for (let i = 0; i < state.deals.length; i += 1) {
      const deal = state.deals[i];
      seen.add(deal.id);
      let row = dealNodes.get(deal.id);
      if (!row) {
        const node = el("div", "ap-deal", dealRack);
        const head = el("div", "ap-deal__head", node);
        const name = el("b", "ap-deal__name", head, deal.name || deal.id);
        const time = el("s", "ap-deal__time", head, "");
        const track = el("div", "ap-deal__track", node);
        const fill = el("i", "ap-deal__fill", track);
        row = { node, name, time, fill };
        dealNodes.set(deal.id, row);
      }
      const hex = Number.isFinite(deal.color)
        ? `#${(deal.color >>> 0).toString(16).padStart(6, "0")}` : "#ffd23f";
      setStyle(row.node, "--deal", hex);
      setText(row.name, String(deal.name || deal.id));
      setText(row.time, `${Math.max(0, deal.remaining).toFixed(1)}s`);
      setStyle(row.fill, "transform", `scaleX(${clamp01(deal.remaining / (deal.duration || 1)).toFixed(3)})`);
      setFlag(row.node, "is-ending", deal.remaining < 3);
    }
    for (const [id, row] of dealNodes) {
      if (seen.has(id)) continue;
      row.node.remove();
      dealNodes.delete(id);
    }
    void dt;
  }

  function updateToasts(dt) {
    for (let i = state.toasts.length - 1; i >= 0; i -= 1) {
      const entry = state.toasts[i];
      entry.age += dt;
      if (entry.age >= entry.life) {
        entry.node.classList.add("is-out");
        if (entry.age >= entry.life + 0.4) { entry.node.remove(); state.toasts.splice(i, 1); }
      }
    }
  }

  function updatePrompt(dt) {
    const fresh = ctx.clock.t - state.prompt.stamp < PROMPT_LINGER;
    state.prompt.open = damp(state.prompt.open, fresh ? 1 : 0, fresh ? 16 : 12, dt);
    setFlag(promptBox, "is-up", state.prompt.open > 0.02);
    setStyle(promptBox, "--open", state.prompt.open.toFixed(3));
  }

  function updateTimer(dt) {
    const t = state.timer;
    const on = t.seconds !== null;
    setFlag(timerBox, "is-up", on);
    if (!on) return;
    t.seconds = Math.max(0, t.seconds - dt);
    setText(timerLabel, t.label || "TIME");
    setText(timerValue, t.seconds.toFixed(1));
    setFlag(timerBox, "is-urgent", t.seconds <= 5);
  }

  function updateCard(dt) {
    if (state.card.life <= 0) { setFlag(titleCard, "is-up", false); return; }
    state.card.life -= dt;
    setFlag(titleCard, "is-up", true);
    if (state.card.life <= 0) titleCard.classList.remove("is-in");
  }

  /* ---- pause plumbing ---- */

  // The page's own Pause button belongs to the HUD's menu, not to the
  // input layer: it opens the same panel the pause key does.
  const pageBtnPause = document.getElementById("btn-pause");
  const pageBtnRestart = document.getElementById("btn-restart");
  const togglePause = () => {
    if (state.menu === "pause") { runAction("resume"); return; }
    if (state.menu) return;
    ctx.state.paused = true;
    openMenu("pause", { allRecords: ctx.state.records });
  };
  if (pageBtnPause && !pageBtnPause.dataset.apBound) {
    pageBtnPause.dataset.apBound = "1";
    pageBtnPause.addEventListener("click", togglePause);
  }
  if (pageBtnRestart && !pageBtnRestart.dataset.apBound) {
    pageBtnRestart.dataset.apBound = "1";
    pageBtnRestart.addEventListener("click", () => runAction("restart"));
  }

  const onKey = (event) => {
    if (event.key !== "Escape") return;
    if (state.menu === "pause") runAction("resume");
    else if (!state.menu) togglePause();
  };
  document.addEventListener("keydown", onKey);

  menuScrim.addEventListener("click", () => { if (state.menu === "pause") runAction("resume"); });

  // world.js announces the course; the title card is the HUD's answer.
  ctx.bus.on("world:loaded", (event) => {
    const id = event && event.courseId !== undefined ? event.courseId : ctx.state.course;
    courseCard(COURSE_NAMES[id], COURSE_SUBS[id], id ? `COURSE ${id}` : "HUB");
  });
  ctx.bus.on("hub:doorLocked", (event) => openMenu("door-locked", event || {}));

  /* ---- initial paint ---- */

  setHealth(ctx.state.hp, ctx.state.maxHp);
  state.health.hold = 0;
  state.health.open = 0;
  setClout(ctx.state.clout || 0);
  state.clout.shown = state.clout.value;
  setRecords(ctx.state.records || 0, 7);
  state.records.shown = state.records.value;

  return {
    /* frozen §9 surface */
    setHealth, setClout, setRecords, setMog,
    toast, prompt, clearPrompt,
    openMenu, closeMenu,
    setBeatPulse, setVisible,

    /* added */
    setDeals, setTimer, courseCard, setUnderwater,
    get menu() { return state.menu; },
    get visible() { return state.visible; },

    update() {
      // Hidden means hidden: no reads, no writes, nothing for the
      // compositor to pick up in a blind-comparison capture.
      if (!state.visible) return;
      // UI animates on unscaled time. Slow motion should slow the world,
      // not the readouts, and a paused game still has a HUD.
      const dt = Math.min(ctx.clock.raw || 0, 0.1);
      measure();
      updateCounters(dt);
      updateHealth(dt);
      updateBeat(dt);
      updateDeals(dt);
      updateToasts(dt);
      updatePrompt(dt);
      updateTimer(dt);
      updateCard(dt);
    },

    dispose() {
      document.removeEventListener("keydown", onKey);
      if (observer) observer.disconnect();
      hudRoot.innerHTML = "";
      if (overlayRoot) overlayRoot.innerHTML = "";
    },
  };
}

export const COURSE_TITLES = COURSE_NAMES;
