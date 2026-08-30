/* ============================================================
   BLACKSAND - HUD, objective UI, map and full-screen flow

   DOM rather than canvas. Text rendered by the browser is crisper at
   any DPI than anything drawn into a WebGL texture, it costs no draw
   calls, and it is accessible. The only canvas elements are the maps,
   which genuinely need per-frame drawing.

   Three rules this file is built around:

   1. THE CROSSHAIR TELLS THE TRUTH. Its gap is the weapon's real cone
      half-angle projected to screen pixels through the live FOV, not a
      tuned multiplier. Everything else in the HUD may be decorative;
      this may not be.

   2. LEGIBLE OVER BRIGHT SAND. The frame this sits on averages a much
      higher luma than a night-time shooter. Every glyph therefore
      carries its own dark ground - a scrim plate or a hard shadow -
      rather than relying on the scene being dark behind it.

   3. NO LAYOUT PER FRAME. Every write goes through setText/setStyle,
      which skip no-op assignments, and anything that moves uses
      `transform` rather than `left`/`top`. A HUD that dirties layout
      sixty times a second costs more than the renderer does.

   The HUD scales from one number, `--hs`, computed from the stage size
   rather than from `vw`/`vh`. The game normally sits in a 1150x650
   panel inside the site's page chrome and only fills the viewport when
   `__BS.maximize()` runs, so viewport units would size the HUD for the
   wrong rectangle in the common case.
   ============================================================ */

import { clamp, clamp01, damp, formatTime, hashString, DEG } from "./core.js";
import { TEAM } from "./world.js";
import { LAYER } from "./physics.js";

/* ---------------------------- content ---------------------------- */

/** Bots carry no display name, so the HUD assigns a stable one from a
 *  hash of the bot id. Deterministic, so the kill feed and scoreboard
 *  never disagree. See the report: this belongs in bots.js eventually. */
const CALLSIGNS = [
  "HOLLAND", "MERCER", "VOSS", "KADAR", "REYES", "SOKOLOV", "ADEYEMI", "BRANNIGAN",
  "OKONKWO", "SILVA", "HARLOW", "NAJJAR", "PETROV", "DELANEY", "IBARRA", "TANAKA",
  "FAULKNER", "AMARI", "KOVAC", "WHITLOCK", "BEHRENS", "RASHID", "LINDQVIST", "MOREAU",
  "ODUYA", "STRAND", "CASTELLANO", "NGUYEN", "BAKKER", "ELLIOT", "HAAS", "ZAHRA",
  "PRICE", "MARSH", "DIALLO", "KEEGAN", "ORTIZ", "VANCE", "SHAW", "BENEDIKT",
];

/** Weapon silhouettes for the kill feed, as 32x12 paths. Deliberately
 *  blocky: at 20px wide a detailed outline turns to mush, a silhouette
 *  still reads as "rifle" or "sniper". */
const WEAPON_GLYPHS = {
  rifle: "M2 5h5V3h2v2h5V3h2v2h9v2h-9v1h-2l-1 4h-2l1-4H9v2H7V8H2z",
  carbine: "M2 5h5V3h3v2h4V3h2v2h9v2h-9v1h-3l-1 4H10l1-4H7v2H5V8H2z",
  marksman: "M9 1h9v2h-1v2h7v2h-7v1h-2l-1 4h-2l1-4H9v2H7V7H2V5h7z",
  smg: "M4 5h4V3h2v2h9v2h-9v1h-2l-1 4H5l1-4H4z",
  lmg: "M2 5h5V3h3v2h12v2H12v1h-1v4H8V8H7v2H5V8H2zM11 8h4v4h-4z",
  pistol: "M6 3h9v3h-2l-1 1h-2l-2 5H6l1-5H5V3z",
  explosive: "M16 0l2 5 5-2-3 4 6 2-6 2 3 4-5-2-2 5-2-5-5 2 3-4-6-2 6-2-3-4 5 2z",
  vehicle: "M2 8h3l2-3h9l2 3h5v3h-2a2 2 0 01-4 0H9a2 2 0 01-4 0H2z",
  melee: "M3 10L19 1l4 2-16 9z",
  fall: "M16 1l4 5h-3v5h-2V6h-3z",
};

const OPTION_TABS = ["controls", "video", "audio", "interface"];

export async function createHud(ctx) {
  const {
    THREE, hudRoot, overlayRoot, touchRoot,
    world, player, weapons, settings, render, input, terrain, structures,
  } = ctx;

  if (!hudRoot) return { update() {}, report: () => ({}) };

  hudRoot.innerHTML = "";
  if (overlayRoot) overlayRoot.innerHTML = "";
  if (touchRoot) touchRoot.innerHTML = "";
  hudRoot.classList.add("bs-hud");

  const params = new URLSearchParams(window.location.search);
  /** `?touch=1` forces the touch layer on a desktop browser. The
   *  screenshot harness has no coarse pointer, so without this the
   *  mobile controls can never be captured. */
  const touchMode = settings.isTouch || params.get("touch") === "1";
  const prefs = settings.prefs;
  // The bottom corners belong to thumbs on a phone, so the whole HUD
  // reflows rather than sitting under the controls.
  if (touchMode) hudRoot.classList.add("is-touch");

  /* ------------------------- dom plumbing ------------------------- */

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    (parent || hudRoot).appendChild(node);
    return node;
  };

  const svg = (parent, viewBox, path, className) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", viewBox);
    node.setAttribute("aria-hidden", "true");
    if (className) node.setAttribute("class", className);
    node.innerHTML = Array.isArray(path)
      ? path.map((d) => `<path d="${d}"/>`).join("")
      : `<path d="${path}"/>`;
    if (parent) parent.appendChild(node);
    return node;
  };

  // Expando-cached writes. `textContent` and `style` assignments are
  // cheap individually and ruinous in aggregate; skipping the no-ops
  // takes per-frame HUD cost from ~180 property writes to under 20.
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

  /* ---------------------------- state ---------------------------- */

  const localState = {
    /** HUD-owned until the engine grows equipment. See report. */
    grenades: 4,
    grenadeCooldown: 0,
    spotted: new Map(),          // bot -> expiry time
    botScores: new Map(),        // bot -> { kills, deaths }
    overlay: null,               // deploy | scoreboard | options | map | summary | pause
    optionTab: "controls",
    deployTeam: player.state.team,
    deploySpawn: null,
    deployKit: 0,
    hs: 1,
    lastSize: { w: 0, h: 0 },
  };

  const nameOf = (bot) => {
    if (!bot) return "UNKNOWN";
    if (bot.__callsign) return bot.__callsign;
    const index = hashString(bot.id) % CALLSIGNS.length;
    bot.__callsign = CALLSIGNS[index];
    return bot.__callsign;
  };

  const scoreOf = (bot) => {
    let record = localState.botScores.get(bot);
    if (!record) { record = { kills: 0, deaths: 0 }; localState.botScores.set(bot, record); }
    return record;
  };

  const enemyTeam = () => (player.state.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE);
  const teamKey = (team) => (team === TEAM.BLUE ? "blue" : team === TEAM.RED ? "red" : "none");
  const isFriendly = (team) => team === player.state.team;

  /* ============================================================
     COMBAT HUD
     ============================================================ */

  /* ---- suppression + damage ---- */

  const suppression = el("div", "bs-supp");
  const damageRing = el("div", "bs-dmg");
  const damageMarks = [];

  /* ---- crosshair ---- */

  const crosshair = el("div", "bs-cross");
  ["t", "b", "l", "r"].forEach((side) => el("i", `bs-cross__${side}`, crosshair));
  const crossDot = el("s", "bs-cross__dot", crosshair);
  const hitMarker = el("div", "bs-hitmark", crosshair);
  hitMarker.innerHTML = "<i></i><i></i><i></i><i></i>";
  const hitRing = el("u", "bs-hitmark__ring", hitMarker);
  const scorePops = el("div", "bs-pops", crosshair);

  /* ---- compass ---- */

  const compass = el("div", "bs-compass");
  el("i", "bs-compass__caret", compass);
  const compassTrack = el("div", "bs-compass__track", compass);
  const COMPASS_PX_PER_DEG = 2.6;

  // Ticks are laid out once from -180 to 540 so the visible window never
  // runs off the end of the strip and no wrap-around bookkeeping is
  // needed while the player spins.
  const CARDINALS = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  for (let deg = -180; deg <= 540; deg += 15) {
    const wrapped = ((deg % 360) + 360) % 360;
    const label = CARDINALS[wrapped];
    const tick = el("i", `bs-compass__tick${label ? " is-major" : ""}`, compassTrack);
    tick.style.left = `calc(${(deg + 180) * COMPASS_PX_PER_DEG}px * var(--hs))`;
    if (label) {
      const text = el("b", "bs-compass__label", compassTrack, label);
      text.style.left = `calc(${(deg + 180) * COMPASS_PX_PER_DEG}px * var(--hs))`;
      if (wrapped === 0) text.classList.add("is-north");
    }
  }

  // Objective pips ride on the same track. Three copies of each point so
  // one is always inside the window regardless of which way the player
  // is facing.
  const compassPips = [];
  for (const point of world.controlPoints) {
    for (const turn of [-360, 0, 360]) {
      const pip = el("b", "bs-compass__pip", compassTrack, point.id);
      compassPips.push({ point, turn, node: pip });
    }
  }

  /* ---- objective bar ---- */

  const objectiveBar = el("div", "bs-obj");

  function ticketBlock(team) {
    const wrap = el("div", `bs-ticket bs-ticket--${teamKey(team)}`, objectiveBar);
    const name = el("span", "bs-ticket__name", wrap, world.teamName(team));
    const num = el("b", "bs-ticket__num", wrap, "250");
    const bleed = el("i", "bs-ticket__bleed", wrap);
    const rate = el("s", "bs-ticket__rate", wrap, "");
    return { wrap, name, num, bleed, rate };
  }

  const ticketBlue = ticketBlock(TEAM.BLUE);
  const flagStrip = el("div", "bs-flags", objectiveBar);
  const ticketRed = ticketBlock(TEAM.RED);
  objectiveBar.insertBefore(ticketBlue.wrap, flagStrip);

  const flagCells = world.controlPoints.map((point) => {
    const node = el("div", "bs-flag", flagStrip);
    const fill = el("i", "bs-flag__fill", node);
    el("b", "bs-flag__id", node, point.id);
    const pin = el("s", "bs-flag__here", node);
    return { point, node, fill, pin };
  });

  const clock = el("div", "bs-clock", objectiveBar, "20:00");

  /* ---- kill feed ---- */

  const killfeed = el("div", "bs-feed");
  const feedEntries = [];

  function feedName(text, team, extra = "") {
    const cls = team === null ? "bs-feed__name is-neutral"
      : isFriendly(team) ? "bs-feed__name is-friendly" : "bs-feed__name is-hostile";
    return `<span class="${cls} ${extra}">${text}</span>`;
  }

  /**
   * One kill-feed row. `weapon` selects the silhouette; `headshot` adds
   * the ring glyph. Rows involving the local player are highlighted -
   * in a 32-player feed the only line that matters is yours.
   */
  function addKill({ killer, killerTeam, victim, victimTeam, weapon = "rifle", headshot = false, mine = false, note = null }) {
    const row = el("div", `bs-feed__row${mine ? " is-mine" : ""}`, killfeed);
    const glyph = WEAPON_GLYPHS[weapon] || WEAPON_GLYPHS.rifle;
    row.innerHTML = note
      ? `<span class="bs-feed__note">${note}</span>`
      : feedName(killer, killerTeam)
        + `<svg class="bs-feed__gun" viewBox="0 0 32 12" aria-hidden="true"><path d="${glyph}"/></svg>`
        + (headshot ? '<svg class="bs-feed__hs" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke-width="1.6"/><circle cx="6" cy="6" r="1.1"/></svg>' : "")
        + feedName(victim, victimTeam);
    feedEntries.push({ node: row, born: ctx.time });
    while (feedEntries.length > 6) feedEntries.shift().node.remove();
    return row;
  }

  function addNote(text, tone = "neutral") {
    const row = el("div", `bs-feed__row bs-feed__row--${tone}`, killfeed);
    row.innerHTML = `<span class="bs-feed__note">${text}</span>`;
    feedEntries.push({ node: row, born: ctx.time });
    while (feedEntries.length > 6) feedEntries.shift().node.remove();
    return row;
  }

  /* ---- vitals ---- */

  const vitals = el("div", "bs-vitals");

  const stanceEl = el("div", "bs-stance", vitals);
  const stanceIcon = svg(stanceEl, "0 0 16 16", "", "bs-stance__icon");
  const stanceText = el("b", "bs-stance__text", stanceEl, "STAND");

  const healthWrap = el("div", "bs-health", vitals);
  const healthTrack = el("i", "bs-health__track", healthWrap);
  const healthGhost = el("i", "bs-health__ghost", healthWrap);
  const healthFill = el("i", "bs-health__fill", healthWrap);
  const healthText = el("span", "bs-health__num", healthWrap, "100");

  const staminaWrap = el("div", "bs-stamina", vitals);
  const staminaFill = el("i", "bs-stamina__fill", staminaWrap);

  /* ---- minimap ---- */

  const minimapWrap = el("div", "bs-minimap");
  const minimap = el("canvas", "bs-minimap__canvas", minimapWrap);
  const mctx = minimap.getContext("2d");
  const minimapNorth = el("i", "bs-minimap__north", minimapWrap);
  const minimapScale = el("b", "bs-minimap__scale", minimapWrap, "400m");

  /* ---- weapon block ---- */

  const arms = el("div", "bs-arms");
  const ammoRow = el("div", "bs-ammo", arms);
  const ammoMag = el("span", "bs-ammo__mag", ammoRow, "30");
  el("span", "bs-ammo__sep", ammoRow, "/");
  const ammoReserve = el("span", "bs-ammo__res", ammoRow, "210");
  const weaponMeta = el("div", "bs-ammo__meta", arms);
  const weaponName = el("b", "bs-ammo__name", weaponMeta, "M4A1");
  const fireModeEl = el("s", "bs-ammo__mode", weaponMeta, "AUTO");
  const magPips = el("div", "bs-mag", arms);
  const reloadBar = el("div", "bs-reload", arms);
  const reloadFill = el("i", "bs-reload__fill", reloadBar);
  const reloadText = el("b", "bs-reload__text", reloadBar, "RELOADING");

  const gear = el("div", "bs-gear", arms);
  const gearSlot = (glyph, label) => {
    const node = el("div", "bs-gear__slot", gear);
    svg(node, "0 0 32 12", glyph, "bs-gear__icon");
    const count = el("b", "bs-gear__count", node, "");
    el("s", "bs-gear__key", node, label);
    return { node, count };
  };
  const grenadeSlot = gearSlot(WEAPON_GLYPHS.explosive, "G");
  const knifeSlot = gearSlot(WEAPON_GLYPHS.melee, "F");

  /* ---- centre-screen text ---- */

  const capture = el("div", "bs-capture");
  const captureLabel = el("b", "bs-capture__label", capture, "");
  const captureBar = el("div", "bs-capture__bar", capture);
  el("i", "bs-capture__mid", captureBar);
  const captureFill = el("i", "bs-capture__fill", captureBar);
  const captureState = el("s", "bs-capture__state", capture, "");

  const prompt = el("div", "bs-prompt");
  const banner = el("div", "bs-banner");
  const bannerMain = el("b", "bs-banner__main", banner, "");
  const bannerSub = el("s", "bs-banner__sub", banner, "");
  let bannerUntil = 0;

  const respawnPanel = el("div", "bs-respawn");
  const respawnCount = el("b", "bs-respawn__num", respawnPanel, "5");
  el("s", "bs-respawn__label", respawnPanel, "REDEPLOYING");

  const fpsPanel = el("div", "bs-fps");

  /* ---- projected world markers ---- */

  const worldLayer = el("div", "bs-world");

  function makeMarker(kind) {
    const node = el("div", `bs-mark bs-mark--${kind}`, worldLayer);
    const head = el("div", "bs-mark__head", node);
    const id = el("b", "bs-mark__id", head, "");
    const dist = el("s", "bs-mark__dist", node, "");
    el("i", "bs-mark__stalk", node);
    const arrow = el("u", "bs-mark__arrow", node);
    return { node, head, id, dist, arrow, visible: false };
  }

  const objectiveMarkers = world.controlPoints.map((point) => ({
    point,
    ...makeMarker("objective"),
    los: true,
    losTimer: Math.random() * 0.4,
  }));

  const spotMarkerPool = [];
  function acquireSpotMarker(index) {
    while (spotMarkerPool.length <= index) spotMarkerPool.push(makeMarker("spot"));
    return spotMarkerPool[index];
  }

  /* ============================================================
     MAP RENDERING
     ============================================================ */

  const MAP_SIZE = terrain.MAP_SIZE;
  const BAKE_PX = 768;
  const RELIEF_PX = 224;

  /**
   * The static half of the map - hillshaded relief, roads, building
   * footprints, base compounds - baked once into an offscreen canvas.
   *
   * Rebuilding this per frame would mean 50k height samples and 60+
   * polygon fills at 12Hz. Baking makes every map draw a single rotated
   * blit plus the handful of things that actually move.
   */
  const bakeCanvas = document.createElement("canvas");
  bakeCanvas.width = BAKE_PX;
  bakeCanvas.height = BAKE_PX;

  function bakeBase() {
    const g = bakeCanvas.getContext("2d");
    const toPx = (v) => ((v + MAP_SIZE * 0.5) / MAP_SIZE) * BAKE_PX;
    const metresToPx = BAKE_PX / MAP_SIZE;

    g.clearRect(0, 0, BAKE_PX, BAKE_PX);

    /* ---- relief ---- */
    // Sampled coarse and upscaled with smoothing. A per-pixel bake at
    // 768^2 is 590k heightAt calls and a visible hitch on load; 224^2 is
    // 50k and indistinguishable once blurred up.
    const relief = document.createElement("canvas");
    relief.width = RELIEF_PX;
    relief.height = RELIEF_PX;
    const rg = relief.getContext("2d");
    const image = rg.createImageData(RELIEF_PX, RELIEF_PX);
    const step = MAP_SIZE / (RELIEF_PX - 1);
    const heights = new Float32Array(RELIEF_PX * RELIEF_PX);
    for (let j = 0; j < RELIEF_PX; j += 1) {
      const z = -MAP_SIZE * 0.5 + j * step;
      for (let i = 0; i < RELIEF_PX; i += 1) {
        heights[j * RELIEF_PX + i] = terrain.heightAt(-MAP_SIZE * 0.5 + i * step, z);
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i += 1) {
      if (heights[i] < lo) lo = heights[i];
      if (heights[i] > hi) hi = heights[i];
    }
    const span = Math.max(1, hi - lo);
    for (let j = 0; j < RELIEF_PX; j += 1) {
      for (let i = 0; i < RELIEF_PX; i += 1) {
        const idx = j * RELIEF_PX + i;
        const h = heights[idx];
        const hl = heights[j * RELIEF_PX + Math.max(0, i - 1)];
        const hr = heights[j * RELIEF_PX + Math.min(RELIEF_PX - 1, i + 1)];
        const hu = heights[Math.max(0, j - 1) * RELIEF_PX + i];
        const hd = heights[Math.min(RELIEF_PX - 1, j + 1) * RELIEF_PX + i];
        // Hillshade with the light from the north-west, the cartographic
        // convention. Relief lit from below reads as holes, not hills.
        const slopeX = (hl - hr) / (2 * step);
        const slopeZ = (hu - hd) / (2 * step);
        const shade = clamp01(0.55 + (slopeX * 0.62 + slopeZ * 0.62) * 3.4);
        const altitude = clamp01((h - lo) / span);
        const base = 26 + altitude * 34;
        const value = base * (0.45 + shade * 0.95);
        const o = idx * 4;
        image.data[o] = clamp(value * 1.22, 0, 255);
        image.data[o + 1] = clamp(value * 1.10, 0, 255);
        image.data[o + 2] = clamp(value * 0.86, 0, 255);
        image.data[o + 3] = 255;
      }
    }
    rg.putImageData(image, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(relief, 0, 0, BAKE_PX, BAKE_PX);

    /* ---- playable boundary ---- */
    g.save();
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(BAKE_PX * 0.5, BAKE_PX * 0.5, BAKE_PX * 0.5 * 0.985, 0, Math.PI * 2);
    g.fill();
    g.restore();

    /* ---- roads ---- */
    for (const pass of [
      { width: 1.9, colour: "rgba(20,16,12,0.55)" },
      { width: 1.0, colour: "rgba(196,178,140,0.62)" },
    ]) {
      g.strokeStyle = pass.colour;
      g.lineJoin = "round";
      g.lineCap = "round";
      for (const segment of world.roadSegments) {
        g.lineWidth = Math.max(1.4, segment.width * metresToPx * pass.width);
        g.beginPath();
        segment.points.forEach((p, i) => {
          const x = toPx(p.x);
          const y = toPx(p.z);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
      }
    }

    /* ---- building footprints ---- */
    // Taller buildings read lighter, so a town has a legible skyline on
    // the map rather than being one grey smear.
    for (const b of structures.buildings) {
      const w = b.width * metresToPx;
      const d = b.depth * metresToPx;
      const tone = clamp(0.34 + b.storeys * 0.13, 0.3, 0.78);
      g.save();
      g.translate(toPx(b.x), toPx(b.z));
      g.rotate(b.rotation);
      g.fillStyle = `rgba(226,214,190,${tone})`;
      g.fillRect(-w * 0.5, -d * 0.5, w, d);
      g.strokeStyle = "rgba(10,12,16,0.6)";
      g.lineWidth = 0.8;
      g.strokeRect(-w * 0.5, -d * 0.5, w, d);
      g.restore();
    }

    /* ---- base compounds ---- */
    for (const base of world.bases) {
      g.save();
      g.translate(toPx(base.position.x), toPx(base.position.z));
      g.strokeStyle = base.team === TEAM.BLUE ? "rgba(79,168,255,0.5)" : "rgba(255,90,74,0.5)";
      g.setLineDash([5, 4]);
      g.lineWidth = 1.6;
      const r = 56 * metresToPx;
      g.strokeRect(-r, -r * 0.85, r * 2, r * 1.7);
      g.restore();
    }
  }

  bakeBase();

  /** Where the last full-size map draw put the world, so a click on the
   *  deploy screen can be turned back into a world position. */
  let lastMapTransform = null;

  /**
   * One map renderer for three surfaces: the rotating minimap, the
   * full-screen map on M, and the deploy screen's spawn selector.
   * Keeping them in one function is what stops the big map and the
   * corner map drifting apart visually.
   */
  function drawMap(g, opts) {
    const {
      width, height, centreX, centreZ, span, rotate = 0,
      showNames = false, showSpawns = false, interactive = false,
    } = opts;
    const scale = Math.min(width, height) / span;

    g.save();
    g.clearRect(0, 0, width, height);
    g.fillStyle = "rgba(7,10,14,0.92)";
    g.fillRect(0, 0, width, height);

    g.translate(width * 0.5, height * 0.5);
    g.rotate(rotate);
    g.scale(scale, scale);
    g.translate(-centreX, -centreZ);

    if (interactive) {
      lastMapTransform = { width, height, centreX, centreZ, scale, rotate };
    }

    /* ---- baked base ---- */
    g.imageSmoothingEnabled = true;
    g.drawImage(bakeCanvas, -MAP_SIZE * 0.5, -MAP_SIZE * 0.5, MAP_SIZE, MAP_SIZE);

    /* ---- capture zones ---- */
    const invScale = 1 / scale;
    for (const point of world.controlPoints) {
      const colour = point.owner === TEAM.BLUE ? "79,168,255"
        : point.owner === TEAM.RED ? "255,90,74" : "228,224,214";
      g.beginPath();
      g.arc(point.position.x, point.position.z, point.radius, 0, Math.PI * 2);
      g.fillStyle = `rgba(${colour},${point.contested ? 0.26 : 0.16})`;
      g.fill();
      g.lineWidth = (point.contested ? 2.4 : 1.4) * invScale;
      g.strokeStyle = point.contested ? "rgba(255,209,102,0.95)" : `rgba(${colour},0.8)`;
      g.stroke();
    }

    /* ---- spawn candidates ---- */
    if (showSpawns) {
      for (const spawn of spawnOptions()) {
        const selected = localState.deploySpawn === spawn.key;
        g.beginPath();
        g.arc(spawn.x, spawn.z, (selected ? 13 : 9) * invScale * 1.4, 0, Math.PI * 2);
        g.fillStyle = selected ? "rgba(232,201,138,0.95)" : "rgba(232,201,138,0.30)";
        g.fill();
        g.lineWidth = 2 * invScale;
        g.strokeStyle = selected ? "#fff" : "rgba(232,201,138,0.8)";
        g.stroke();
      }
    }

    /* ---- vehicles ---- */
    if (ctx.vehicles) {
      for (const vehicle of ctx.vehicles.vehicles) {
        if (!vehicle.alive) continue;
        const friendly = isFriendly(vehicle.team);
        g.save();
        g.translate(vehicle.position.x, vehicle.position.z);
        g.rotate(-vehicle.yaw);
        g.fillStyle = friendly ? "rgba(126,200,255,0.92)" : "rgba(255,120,100,0.72)";
        const s = 4.6;
        if (vehicle.spec.aircraft) {
          g.fillRect(-s * 0.35, -s * 0.9, s * 0.7, s * 1.8);
          g.fillRect(-s * 1.1, -s * 0.16, s * 2.2, s * 0.32);
        } else {
          g.fillRect(-s * 0.5, -s * 0.8, s, s * 1.6);
        }
        g.restore();
      }
    }

    /* ---- soldiers ---- */
    if (ctx.bots) {
      for (const bot of ctx.bots.bots) {
        if (!bot.alive) continue;
        const friendly = isFriendly(bot.team);
        const spotted = localState.spotted.has(bot);
        if (!friendly && !spotted) continue;
        g.save();
        g.translate(bot.position.x, bot.position.z);
        g.rotate(-bot.yaw);
        if (friendly) {
          // Chevron, so a squadmate's facing is readable at a glance.
          g.beginPath();
          g.moveTo(0, -4.4);
          g.lineTo(3.2, 3.0);
          g.lineTo(0, 1.4);
          g.lineTo(-3.2, 3.0);
          g.closePath();
          g.fillStyle = "#8fd0ff";
          g.fill();
          g.lineWidth = 0.9 * invScale;
          g.strokeStyle = "rgba(6,12,20,0.85)";
          g.stroke();
        } else {
          g.beginPath();
          g.moveTo(0, -4.4);
          g.lineTo(4.0, 0);
          g.lineTo(0, 4.4);
          g.lineTo(-4.0, 0);
          g.closePath();
          g.fillStyle = "#ff6a58";
          g.fill();
          g.lineWidth = 1.0 * invScale;
          g.strokeStyle = "rgba(10,4,4,0.9)";
          g.stroke();
        }
        g.restore();
      }
    }

    /* ---- objective letters, always upright ---- */
    for (const point of world.controlPoints) {
      g.save();
      g.translate(point.position.x, point.position.z);
      g.rotate(-rotate);
      g.scale(invScale, invScale);
      const r = showNames ? 13 : 9.5;
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
      g.fillStyle = point.owner === TEAM.BLUE ? "#2f7fd4"
        : point.owner === TEAM.RED ? "#d23b2c" : "#4a5058";
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = point.contested ? "#ffd166" : "rgba(240,244,250,0.9)";
      g.stroke();
      g.fillStyle = "#fff";
      g.font = `800 ${showNames ? 15 : 11}px "Barlow Condensed", system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(point.id, 0, showNames ? 1 : 0.5);
      if (showNames) {
        g.font = '600 11px "Inter", system-ui, sans-serif';
        g.fillStyle = "rgba(233,238,244,0.92)";
        g.strokeStyle = "rgba(0,0,0,0.8)";
        g.lineWidth = 3;
        g.strokeText(point.label, 0, r + 12);
        g.fillText(point.label, 0, r + 12);
      }
      g.restore();
    }

    g.restore();

    /* ---- view cone and player arrow, in screen space ---- */
    const px = width * 0.5 + ((player.position.x - centreX) * Math.cos(rotate)
      - (player.position.z - centreZ) * Math.sin(rotate)) * scale;
    const py = height * 0.5 + ((player.position.x - centreX) * Math.sin(rotate)
      + (player.position.z - centreZ) * Math.cos(rotate)) * scale;

    g.save();
    g.translate(px, py);
    // Screen-space yaw: the map is already rotated by `rotate`, so the
    // arrow only has to make up the difference.
    g.rotate(-player.state.yaw + rotate);

    const half = (render.camera.fov * render.camera.aspect * 0.42) * DEG;
    const coneLength = Math.min(width, height) * 0.34;
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, coneLength);
    cone.addColorStop(0, "rgba(233,240,250,0.34)");
    cone.addColorStop(1, "rgba(233,240,250,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, coneLength, -Math.PI * 0.5 - half, -Math.PI * 0.5 + half);
    g.closePath();
    g.fill();

    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.6, 6);
    g.lineTo(0, 3.4);
    g.lineTo(-5.6, 6);
    g.closePath();
    g.fillStyle = "#f2f7ff";
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = "rgba(6,10,16,0.9)";
    g.stroke();
    g.restore();
  }

  /* ============================================================
     OVERLAYS
     ============================================================ */

  const overlay = overlayRoot || hudRoot;
  const overlayRootEl = el("div", "bs-ov", overlay);

  /* ---- shared chrome ---- */

  function panel(name, title, subtitle) {
    const wrap = el("div", `bs-ov__panel bs-ov__panel--${name}`, overlayRootEl);
    const head = el("div", "bs-ov__head", wrap);
    el("h2", "bs-ov__title", head, title);
    if (subtitle) el("p", "bs-ov__sub", head, subtitle);
    const body = el("div", "bs-ov__body", wrap);
    const foot = el("div", "bs-ov__foot", wrap);
    wrap.style.display = "none";
    return { wrap, head, body, foot };
  }

  function button(parent, label, className = "") {
    const node = el("button", `bs-btn ${className}`.trim(), parent, label);
    node.type = "button";
    return node;
  }

  /* ---- deploy ---- */

  const deploy = panel("deploy", "DEPLOYMENT", "Select a team, then a spawn point.");
  const deployGrid = el("div", "bs-deploy", deploy.body);
  const deployLeft = el("div", "bs-deploy__col", deployGrid);
  const deployMapWrap = el("div", "bs-deploy__map", deployGrid);
  const deployCanvas = el("canvas", "bs-deploy__canvas", deployMapWrap);
  const dctx = deployCanvas.getContext("2d");
  const deployRight = el("div", "bs-deploy__col", deployGrid);

  el("h3", "bs-deploy__h", deployLeft, "FACTION");
  const teamButtons = [TEAM.BLUE, TEAM.RED].map((team) => {
    const node = el("button", `bs-team bs-team--${teamKey(team)}`, deployLeft);
    node.type = "button";
    el("b", "bs-team__name", node, world.teamName(team));
    const meta = el("span", "bs-team__meta", node, "");
    node.addEventListener("click", () => {
      localState.deployTeam = team;
      localState.deploySpawn = null;
      refreshDeploy();
    });
    return { team, node, meta };
  });

  el("h3", "bs-deploy__h", deployRight, "KIT");
  const kitButtons = weapons.loadout.map((slot, index) => {
    const node = el("button", "bs-kit", deployRight);
    node.type = "button";
    svg(node, "0 0 32 12", WEAPON_GLYPHS[slot.def.id] || WEAPON_GLYPHS.rifle, "bs-kit__icon");
    el("b", "bs-kit__name", node, slot.def.name);
    el("s", "bs-kit__class", node, slot.def.class.toUpperCase());
    node.addEventListener("click", () => { localState.deployKit = index; refreshDeploy(); });
    return { node, index };
  });

  const deployHint = el("div", "bs-deploy__hint", deployRight, "");
  const deployButton = button(deploy.foot, "DEPLOY", "bs-btn--primary");
  const optionsFromDeploy = button(deploy.foot, "OPTIONS", "bs-btn--ghost");

  /** Every place the player may legitimately appear, as flat records the
   *  map and the deploy list both read. */
  function spawnOptions() {
    const team = localState.deployTeam;
    const out = [];
    const base = world.bases.find((b) => b.team === team);
    if (base) {
      out.push({ key: `base-${team}`, label: base.label, x: base.position.x, z: base.position.z, kind: "base" });
    }
    for (const point of world.controlPoints) {
      if (point.owner !== team) continue;
      out.push({
        key: `cp-${point.id}`, label: `${point.id} · ${point.label}`,
        x: point.position.x, z: point.position.z, kind: "point", point,
      });
    }
    return out;
  }

  function refreshDeploy() {
    const options = spawnOptions();
    if (!options.some((o) => o.key === localState.deploySpawn)) {
      localState.deploySpawn = options.length ? options[0].key : null;
    }
    for (const entry of teamButtons) {
      setFlag(entry.node, "is-active", entry.team === localState.deployTeam);
      const held = world.controlPoints.filter((p) => p.owner === entry.team).length;
      const alive = ctx.bots ? ctx.bots.countFor(entry.team) : 0;
      setText(entry.meta, `${Math.max(0, Math.round(world.match.tickets[entry.team]))} tickets · ${held}/5 held · ${alive} in the field`);
    }
    for (const kit of kitButtons) setFlag(kit.node, "is-active", kit.index === localState.deployKit);
    const chosen = options.find((o) => o.key === localState.deploySpawn);
    setText(deployHint, chosen
      ? `Spawning at ${chosen.label}.`
      : "No friendly spawn available — take a point.");
    setFlag(deployButton, "is-disabled", !chosen);
    drawDeployMap();
  }

  function drawDeployMap() {
    const rect = deployMapWrap.getBoundingClientRect();
    const size = Math.max(180, Math.min(rect.width, rect.height) || 320);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (deployCanvas.width !== Math.round(size * dpr)) {
      deployCanvas.width = Math.round(size * dpr);
      deployCanvas.height = Math.round(size * dpr);
    }
    deployCanvas.style.width = `${size}px`;
    deployCanvas.style.height = `${size}px`;
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(dctx, {
      width: size, height: size,
      centreX: 0, centreZ: 0, span: MAP_SIZE * 1.02,
      rotate: 0, showNames: true, showSpawns: true, interactive: true,
    });
  }

  deployMapWrap.addEventListener("click", (event) => {
    if (!lastMapTransform) return;
    const rect = deployCanvas.getBoundingClientRect();
    const sx = event.clientX - rect.left - lastMapTransform.width * 0.5;
    const sy = event.clientY - rect.top - lastMapTransform.height * 0.5;
    const wx = sx / lastMapTransform.scale + lastMapTransform.centreX;
    const wz = sy / lastMapTransform.scale + lastMapTransform.centreZ;
    let best = null;
    let bestDistance = 90;
    for (const option of spawnOptions()) {
      const d = Math.hypot(option.x - wx, option.z - wz);
      if (d < bestDistance) { bestDistance = d; best = option; }
    }
    if (best) { localState.deploySpawn = best.key; refreshDeploy(); }
  });

  deployButton.addEventListener("click", () => doDeploy());
  optionsFromDeploy.addEventListener("click", () => setOverlay("options"));

  function doDeploy() {
    const option = spawnOptions().find((o) => o.key === localState.deploySpawn);
    if (!option) return;
    player.state.team = localState.deployTeam;
    weapons.switchTo(localState.deployKit);
    if (!player.state.alive) player.respawn();
    // Nudge onto the chosen spawn ring rather than the exact centre, so
    // deploying onto a held point does not drop the player on a flagpole.
    const angle = Math.random() * Math.PI * 2;
    const radius = option.kind === "base" ? 16 : (option.point ? option.point.radius * 0.8 : 12);
    const x = option.x + Math.cos(angle) * radius;
    const z = option.z + Math.sin(angle) * radius;
    player.teleport(x, terrain.heightAt(x, z) + 0.25, z);
    player.state.health = player.state.maxHealth;
    player.state.stamina = 1;
    setOverlay(null);
    if (!touchMode) input.requestLock();
    showBanner("DEPLOYED", option.label, 1.6);
  }

  /* ---- scoreboard ---- */

  const scoreboard = panel("scoreboard", "CONQUEST — BLACKSAND", "Tab");
  const sbGrid = el("div", "bs-sb", scoreboard.body);
  const sbColumns = [TEAM.BLUE, TEAM.RED].map((team) => {
    const col = el("div", `bs-sb__col bs-sb__col--${teamKey(team)}`, sbGrid);
    const head = el("div", "bs-sb__head", col);
    el("b", "bs-sb__team", head, world.teamName(team));
    const tickets = el("s", "bs-sb__tickets", head, "250");
    const flags = el("div", "bs-sb__flags", head);
    const flagPips = world.controlPoints.map(() => el("i", null, flags));
    const table = el("div", "bs-sb__table", col);
    const header = el("div", "bs-sb__row is-header", table);
    ["SOLDIER", "SCORE", "K", "D", "PING"].forEach((label) => el("span", null, header, label));
    const rows = el("div", "bs-sb__rows", table);
    return { team, col, tickets, flagPips, rows, pool: [] };
  });
  const sbFooter = el("div", "bs-sb__footer", scoreboard.foot, "");

  /* ---- options ---- */

  const options = panel("options", "OPTIONS", "");
  const optTabs = el("div", "bs-tabs", options.head);
  const optBody = el("div", "bs-opts", options.body);
  const optPages = {};
  const tabButtons = OPTION_TABS.map((name) => {
    const node = el("button", "bs-tab", optTabs, name.toUpperCase());
    node.type = "button";
    node.addEventListener("click", () => { localState.optionTab = name; refreshOptions(); });
    optPages[name] = el("div", "bs-opts__page", optBody);
    return { name, node };
  });

  function row(page, label, hint) {
    const wrap = el("div", "bs-opt", optPages[page]);
    const head = el("div", "bs-opt__label", wrap);
    el("b", null, head, label);
    if (hint) el("s", null, head, hint);
    const control = el("div", "bs-opt__control", wrap);
    return control;
  }

  function slider(page, label, key, min, max, step, format, apply) {
    const control = row(page, label);
    const input$ = el("input", "bs-slider", control);
    input$.type = "range";
    input$.min = String(min);
    input$.max = String(max);
    input$.step = String(step);
    input$.value = String(prefs[key]);
    const readout = el("b", "bs-opt__value", control, format(prefs[key]));
    input$.addEventListener("input", () => {
      const value = Number(input$.value);
      settings.set(key, value);
      setText(readout, format(value));
      if (apply) apply(value);
    });
    return { input: input$, readout, key, format };
  }

  function toggle(page, label, key, apply) {
    const control = row(page, label);
    const node = el("button", "bs-toggle", control);
    node.type = "button";
    el("i", null, node);
    el("b", null, node, prefs[key] ? "ON" : "OFF");
    setFlag(node, "is-on", Boolean(prefs[key]));
    node.addEventListener("click", () => {
      const value = !prefs[key];
      settings.set(key, value);
      setFlag(node, "is-on", value);
      setText(node.querySelector("b"), value ? "ON" : "OFF");
      if (apply) apply(value);
    });
    return node;
  }

  function choice(page, label, values, get, set) {
    const control = row(page, label);
    const nodes = values.map((value) => {
      const node = el("button", "bs-choice", control, value.label);
      node.type = "button";
      node.addEventListener("click", () => { set(value.id); refreshOptions(); });
      return { node, id: value.id };
    });
    return { nodes, get };
  }

  const optionWidgets = [];

  optionWidgets.push(slider("controls", "Mouse sensitivity", "sensitivity", 0.0004, 0.0060, 0.0001,
    (v) => (v * 1000).toFixed(2)));
  optionWidgets.push(slider("controls", "ADS sensitivity", "adsSensitivityScale", 0.3, 1.2, 0.01,
    (v) => `${Math.round(v * 100)}%`));
  toggle("controls", "Invert vertical look", "invertY");
  toggle("controls", "Hold to aim (off = toggle)", "toggleAds", (v) => { prefs.toggleAds = v; });
  toggle("controls", "Toggle crouch", "toggleCrouch");

  optionWidgets.push(slider("video", "Field of view", "fov", 55, 110, 1, (v) => `${Math.round(v)}°`));
  const qualityChoice = choice("video", "Quality tier",
    [
      { id: "auto", label: "AUTO" }, { id: "low", label: "LOW" }, { id: "medium", label: "MED" },
      { id: "high", label: "HIGH" }, { id: "ultra", label: "ULTRA" },
    ],
    () => prefs.quality,
    (id) => {
      if (id === "auto") { settings.set("quality", "auto"); settings.setTier(settings.detected); }
      else settings.setTier(id);
    });
  optionWidgets.push(slider("video", "Motion blur", "motionBlurAmount", 0, 1, 0.05,
    (v) => `${Math.round(v * 100)}%`, (v) => render.grade({ motionBlur: v })));
  optionWidgets.push(slider("video", "Camera shake", "cameraShake", 0, 1.5, 0.05,
    (v) => `${Math.round(v * 100)}%`));
  toggle("video", "Adaptive resolution", "adaptiveResolution");

  optionWidgets.push(slider("audio", "Master", "masterVolume", 0, 1, 0.01,
    (v) => `${Math.round(v * 100)}%`, (v) => ctx.audio?.setVolume?.("master", v)));
  optionWidgets.push(slider("audio", "Effects", "sfxVolume", 0, 1, 0.01,
    (v) => `${Math.round(v * 100)}%`, (v) => ctx.audio?.setVolume?.("sfx", v)));
  optionWidgets.push(slider("audio", "Music", "musicVolume", 0, 1, 0.01,
    (v) => `${Math.round(v * 100)}%`, (v) => ctx.audio?.setVolume?.("music", v)));
  optionWidgets.push(slider("audio", "Voice", "voiceVolume", 0, 1, 0.01,
    (v) => `${Math.round(v * 100)}%`));

  optionWidgets.push(slider("interface", "HUD scale", "hudScale", 0.75, 1.4, 0.05,
    (v) => `${Math.round(v * 100)}%`, () => applyScale(true)));
  const crosshairChoice = choice("interface", "Crosshair",
    [{ id: "dynamic", label: "DYNAMIC" }, { id: "dot", label: "DOT" }, { id: "cross", label: "CROSS" }],
    () => prefs.crosshair, (id) => settings.set("crosshair", id));
  toggle("interface", "Show HUD", "showHud");
  toggle("interface", "Show performance", "showFps");
  toggle("interface", "Blood effects", "bloodEffects");

  const optionsResume = button(options.foot, "RESUME", "bs-btn--primary");
  const optionsReset = button(options.foot, "RESET TO DEFAULTS", "bs-btn--ghost");
  optionsResume.addEventListener("click", () => setOverlay(null));
  optionsReset.addEventListener("click", () => { settings.reset(); refreshOptions(); applyScale(true); });

  function refreshOptions() {
    for (const tab of tabButtons) {
      setFlag(tab.node, "is-active", tab.name === localState.optionTab);
      setStyle(optPages[tab.name], "display", tab.name === localState.optionTab ? "" : "none");
    }
    for (const widget of optionWidgets) {
      if (widget.input.value !== String(prefs[widget.key])) widget.input.value = String(prefs[widget.key]);
      setText(widget.readout, widget.format(prefs[widget.key]));
    }
    for (const entry of qualityChoice.nodes) setFlag(entry.node, "is-active", entry.id === prefs.quality);
    for (const entry of crosshairChoice.nodes) setFlag(entry.node, "is-active", entry.id === prefs.crosshair);
  }

  /* ---- full map ---- */

  const mapPanel = panel("map", "THEATRE MAP", "M to close");
  const mapWrap = el("div", "bs-map", mapPanel.body);
  const mapCanvas = el("canvas", "bs-map__canvas", mapWrap);
  const mapCtx = mapCanvas.getContext("2d");
  const mapLegend = el("div", "bs-map__legend", mapPanel.foot);
  [
    ["friendly", "Friendly"], ["hostile", "Spotted hostile"],
    ["objective", "Objective"], ["vehicle", "Vehicle"],
  ].forEach(([kind, label]) => {
    const item = el("div", "bs-map__key", mapLegend);
    el("i", `bs-map__swatch is-${kind}`, item);
    el("span", null, item, label);
  });

  function drawFullMap() {
    const rect = mapWrap.getBoundingClientRect();
    const size = Math.max(220, Math.min(rect.width, rect.height) || 480);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (mapCanvas.width !== Math.round(size * dpr)) {
      mapCanvas.width = Math.round(size * dpr);
      mapCanvas.height = Math.round(size * dpr);
    }
    mapCanvas.style.width = `${size}px`;
    mapCanvas.style.height = `${size}px`;
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(mapCtx, {
      width: size, height: size,
      centreX: 0, centreZ: 0, span: MAP_SIZE * 1.02,
      rotate: 0, showNames: true,
    });
  }

  /* ---- pause ---- */

  const pause = panel("pause", "BLACKSAND", "Mouse released");
  el("p", "bs-pause__body", pause.body,
    "Click resume to take the mouse back. Press Esc at any time to release it.");
  const pauseResume = button(pause.foot, "RESUME", "bs-btn--primary");
  const pauseOptions = button(pause.foot, "OPTIONS", "bs-btn--ghost");
  const pauseDeploy = button(pause.foot, "REDEPLOY", "bs-btn--ghost");
  pauseResume.addEventListener("click", () => { setOverlay(null); input.requestLock(); });
  pauseOptions.addEventListener("click", () => setOverlay("options"));
  pauseDeploy.addEventListener("click", () => setOverlay("deploy"));

  /* ---- end of round ---- */

  const summary = panel("summary", "ROUND OVER", "");
  const summaryHero = el("div", "bs-sum__hero", summary.body);
  const summaryResult = el("b", "bs-sum__result", summaryHero, "");
  const summaryLine = el("s", "bs-sum__line", summaryHero, "");
  const summaryStats = el("div", "bs-sum__stats", summary.body);
  const summaryBoard = el("div", "bs-sum__board", summary.body);
  const summaryAgain = button(summary.foot, "PLAY AGAIN", "bs-btn--primary");
  const summaryBack = el("a", "bs-btn bs-btn--ghost", summary.foot, "BACK TO RAINBOT");
  summaryBack.href = "../games.html";
  summaryAgain.addEventListener("click", () => window.location.reload());

  function statTile(label, value) {
    const tile = el("div", "bs-sum__tile", summaryStats);
    el("b", null, tile, value);
    el("s", null, tile, label);
  }

  function buildSummary(winner) {
    const won = winner === player.state.team;
    setText(summaryResult, winner === TEAM.NONE ? "DRAW" : (won ? "VICTORY" : "DEFEAT"));
    setFlag(summaryResult, "is-win", won && winner !== TEAM.NONE);
    setFlag(summaryResult, "is-loss", !won && winner !== TEAM.NONE);
    setText(summaryLine, winner === TEAM.NONE
      ? "Both sides held. Tickets ran out together."
      : `${world.teamName(winner)} holds the field — ${Math.round(world.match.tickets[winner])} tickets remaining.`);
    summaryStats.innerHTML = "";
    const report = weapons.report();
    statTile("KILLS", String(player.state.kills));
    statTile("DEATHS", String(player.state.deaths));
    statTile("SCORE", String(player.state.score));
    statTile("ACCURACY", `${Math.round((report.accuracy || 0) * 100)}%`);
    statTile("SHOTS", String(report.shotsFired));
    summaryBoard.innerHTML = "";
    const roster = rosterFor(player.state.team).slice(0, 6);
    for (const entry of roster) {
      const line = el("div", "bs-sum__row", summaryBoard);
      el("span", null, line, entry.name);
      el("span", null, line, String(entry.score));
      el("span", null, line, `${entry.kills} / ${entry.deaths}`);
    }
  }

  /* ---- overlay switching ---- */

  const panels = {
    deploy, scoreboard, options, map: mapPanel, pause, summary,
  };

  /** Scoreboard and map are read-only huds-on-top: they never take the
   *  mouse. Anything with a control in it does, or the player cannot
   *  click the thing they opened it for. */
  const PASSIVE = { scoreboard: true, map: true };

  function setOverlay(name) {
    if (localState.overlay === name) return;
    localState.overlay = name;
    for (const key of Object.keys(panels)) {
      setStyle(panels[key].wrap, "display", key === name ? "" : "none");
    }
    setFlag(overlayRootEl, "is-open", Boolean(name));
    setFlag(overlayRootEl, "is-modal", Boolean(name) && name !== "scoreboard");
    setFlag(overlayRootEl, "is-passive", Boolean(name) && Boolean(PASSIVE[name]));
    if (overlayRoot) overlayRoot.style.pointerEvents = name && !PASSIVE[name] ? "auto" : "none";

    if (name === "deploy") refreshDeploy();
    if (name === "options") refreshOptions();
    if (name === "map") drawFullMap();
    if (name === "scoreboard") refreshScoreboard();
    if (name && !PASSIVE[name] && !touchMode && input.state.locked) input.exitLock();
  }

  /* ============================================================
     TOUCH CONTROLS
     ============================================================ */

  const touch = { stickId: null, origin: [0, 0], knob: null };

  if (touchRoot && touchMode) {
    touchRoot.classList.add("is-touch");

    // The look area is deliberately pointer-events:none so touches fall
    // straight through to the canvas, where input.js's own look handler
    // already lives. Duplicating it here would mean two systems fighting
    // over the same finger.
    el("div", "bs-touch__look", touchRoot);

    const stick = el("div", "bs-touch__stick", touchRoot);
    const stickRing = el("i", "bs-touch__ring", stick);
    const stickKnob = el("s", "bs-touch__knob", stick);
    touch.knob = stickKnob;

    const STICK_RADIUS = 54;

    const stickMove = (event) => {
      const point = [...event.touches].find((t) => t.identifier === touch.stickId);
      if (!point) return;
      const dx = point.clientX - touch.origin[0];
      const dy = point.clientY - touch.origin[1];
      const magnitude = Math.hypot(dx, dy);
      const nx = clamp(dx / STICK_RADIUS, -1, 1);
      const ny = clamp(dy / STICK_RADIUS, -1, 1);
      input.injectMove(nx, ny);
      if (magnitude > STICK_RADIUS * 1.22 && ny < -0.4) input.press("sprint");
      else input.release("sprint");
      const clampedMag = Math.min(magnitude, STICK_RADIUS);
      const angle = Math.atan2(dy, dx);
      stickKnob.style.transform =
        `translate(calc(-50% + ${Math.cos(angle) * clampedMag}px), calc(-50% + ${Math.sin(angle) * clampedMag}px))`;
      event.preventDefault();
    };

    stick.addEventListener("touchstart", (event) => {
      const point = event.changedTouches[0];
      touch.stickId = point.identifier;
      touch.origin = [point.clientX, point.clientY];
      stick.classList.add("is-active");
      event.preventDefault();
    }, { passive: false });
    stick.addEventListener("touchmove", stickMove, { passive: false });
    const stickEnd = (event) => {
      if (![...event.changedTouches].some((t) => t.identifier === touch.stickId)) return;
      touch.stickId = null;
      input.injectMove(0, 0);
      input.release("sprint");
      stick.classList.remove("is-active");
      stickKnob.style.transform = "translate(-50%, -50%)";
    };
    stick.addEventListener("touchend", stickEnd);
    stick.addEventListener("touchcancel", stickEnd);
    void stickRing;

    /** A touch button that maps to an input action or a raw state flag. */
    function padButton(parent, className, label, options$ = {}) {
      const node = el("button", `bs-pad ${className}`, parent);
      node.type = "button";
      if (options$.glyph) svg(node, options$.viewBox || "0 0 32 12", options$.glyph, "bs-pad__icon");
      if (label) el("b", null, node, label);
      const down = (event) => {
        node.classList.add("is-down");
        if (options$.action) input.press(options$.action);
        if (options$.state) input.state[options$.state] = true;
        if (options$.onDown) options$.onDown();
        event.preventDefault();
      };
      const up = (event) => {
        node.classList.remove("is-down");
        if (options$.action) input.release(options$.action);
        if (options$.state && !options$.latch) input.state[options$.state] = false;
        if (options$.onUp) options$.onUp();
        if (event) event.preventDefault();
      };
      node.addEventListener("touchstart", down, { passive: false });
      node.addEventListener("touchend", up);
      node.addEventListener("touchcancel", up);
      node.addEventListener("mousedown", down);
      node.addEventListener("mouseup", up);
      node.addEventListener("mouseleave", () => { if (node.classList.contains("is-down")) up(null); });
      return node;
    }

    const rightCluster = el("div", "bs-touch__right", touchRoot);
    padButton(rightCluster, "bs-pad--fire", "", { state: "fire", glyph: WEAPON_GLYPHS.rifle });
    padButton(rightCluster, "bs-pad--ads", "ADS", { state: "ads" });
    padButton(rightCluster, "bs-pad--jump", "JUMP", { action: "jump" });
    padButton(rightCluster, "bs-pad--crouch", "CROUCH", { action: "crouch" });

    const utility = el("div", "bs-touch__utility", touchRoot);
    padButton(utility, "bs-pad--reload", "RELOAD", { action: "reload" });
    padButton(utility, "bs-pad--use", "USE", { action: "use" });
    padButton(utility, "bs-pad--nade", "FRAG", { action: "grenade" });
    padButton(utility, "bs-pad--swap", "SWAP", { action: "nextWeapon" });

    const topCluster = el("div", "bs-touch__top", touchRoot);
    padButton(topCluster, "bs-pad--map", "MAP", {
      onDown: () => setOverlay(localState.overlay === "map" ? null : "map"),
    });
    padButton(topCluster, "bs-pad--score", "SCORE", {
      onDown: () => setOverlay(localState.overlay === "scoreboard" ? null : "scoreboard"),
    });
    padButton(topCluster, "bs-pad--menu", "MENU", {
      onDown: () => setOverlay(localState.overlay === "options" ? null : "options"),
    });
  }

  /* ============================================================
     EVENTS
     ============================================================ */

  const unbind = [];
  const on = (type, fn) => unbind.push(ctx.bus.on(type, fn));

  function showBanner(main, sub = "", seconds = 2.4) {
    setText(bannerMain, main);
    setText(bannerSub, sub);
    setFlag(banner, "has-sub", Boolean(sub));
    bannerUntil = ctx.time + seconds;
    banner.classList.remove("is-pop");
    void banner.offsetWidth;
    banner.classList.add("is-pop");
  }

  /** A floating score number at the crosshair. The single clearest
   *  feedback a shooter can give: it confirms the hit, the kind of hit,
   *  and the reward, in one glance without leaving the aim point. */
  function popScore(text, tone, hold = false) {
    const node = el("b", `bs-pop bs-pop--${tone}`, scorePops, text);
    node.style.setProperty("--drift", `${(Math.random() - 0.5) * 26}px`);
    if (hold) {
      // The harness drives frames synchronously, so a wall-clock CSS
      // animation has already finished by the time a capture happens.
      node.classList.add("is-held");
    } else {
      window.setTimeout(() => node.remove(), 900);
    }
    while (scorePops.childElementCount > 6) scorePops.firstElementChild.remove();
  }

  /* ---- hits ---- */

  let pendingBotDeath = null;

  on("weapon:hit", ({ headshot, killed, distance }) => {
    hitMarker.classList.remove("is-hit", "is-head", "is-kill");
    void hitMarker.offsetWidth;
    hitMarker.classList.add(killed ? "is-kill" : headshot ? "is-head" : "is-hit");
    ctx.audio?.playAt?.(killed ? "click" : "click", player.position, { spatial: false, volume: 0.25 });

    if (killed) {
      const victim = pendingBotDeath ? pendingBotDeath.bot : null;
      popScore(headshot ? "+150" : "+100", headshot ? "head" : "kill");
      addKill({
        killer: "YOU", killerTeam: player.state.team,
        victim: victim ? nameOf(victim) : "HOSTILE",
        victimTeam: victim ? victim.team : enemyTeam(),
        weapon: weapons.state.def.id, headshot, mine: true,
      });
      if (victim) { scoreOf(victim).deaths += 1; pendingBotDeath = null; }
    } else if (distance > 90) {
      popScore("+10", "hit");
    }
  });

  /* ---- deaths ---- */

  on("bot:death", ({ bot, headshot }) => {
    pendingBotDeath = { bot, headshot, at: ctx.time };
    scoreOf(bot).deaths += 1;
  });

  on("player:damage", ({ amount, source, cause }) => {
    const magnitude = clamp01(amount / 40);
    if (source && source.position) {
      addDamageMark(source.position, magnitude);
      // Being hit reveals the shooter briefly. Nothing else in a shooter
      // is as frustrating as dying to something you were never shown.
      if (source.team !== undefined && !isFriendly(source.team)) {
        localState.spotted.set(source, ctx.time + 3.2);
      }
    } else {
      addDamageMark(null, magnitude);
    }
    healthWrap.classList.remove("is-hurt");
    void healthWrap.offsetWidth;
    healthWrap.classList.add("is-hurt");
    void cause;
  });

  on("player:death", ({ source, cause }) => {
    const killer = source && source.id ? nameOf(source) : null;
    localState.deathAt = ctx.time;
    showBanner("YOU WERE KILLED", killer ? `by ${killer}` : (cause === "fall" ? "the ground" : ""), 4.2);
    addKill({
      killer: killer || "—", killerTeam: source ? source.team : null,
      victim: "YOU", victimTeam: player.state.team,
      weapon: cause === "fall" ? "fall" : "rifle", mine: true,
    });
    damageMarks.length = 0;
    damageRing.innerHTML = "";
  });

  on("player:respawn", () => {
    showBanner("DEPLOYED", "", 1.2);
    localState.grenades = 4;
  });

  on("world:capture", ({ point, to, from }) => {
    const good = to === player.state.team;
    if (to === TEAM.NONE) {
      addNote(`${point.id} — ${point.label} NEUTRALISED`, from === player.state.team ? "bad" : "good");
    } else {
      addNote(`${world.teamName(to)} CAPTURED ${point.id} — ${point.label}`, good ? "good" : "bad");
      showBanner(good ? `${point.id} CAPTURED` : `${point.id} LOST`, point.label, 2.2);
    }
    ctx.audio?.playAt?.(good ? "capture" : "lost", player.position, { spatial: false });
    if (localState.overlay === "deploy") refreshDeploy();
  });

  on("world:matchend", ({ winner }) => {
    buildSummary(winner);
    setOverlay("summary");
  });

  on("weapon:reloadstart", () => { reloadBar.classList.add("is-live"); });
  on("weapon:reloadend", () => { reloadBar.classList.remove("is-live"); });

  on("input:press", (action) => {
    if (action === "map") setOverlay(localState.overlay === "map" ? null : "map");
    if (action === "spot") doSpot();
    if (action === "grenade") throwGrenade();
  });

  on("input:lock", (locked) => {
    // Losing the mouse mid-match is the browser's pause button. Treat it
    // as one rather than leaving the player staring at a live firefight
    // they cannot aim at.
    if (!locked && !settings.qa && !touchMode && localState.overlay === null && world.match.state === "playing") {
      setOverlay("pause");
    } else if (locked && localState.overlay === "pause") {
      setOverlay(null);
    }
  });

  on("render:resize", () => { applyScale(true); });

  /* ---- audio unlock ---- */

  const unlockAudio = () => {
    ctx.audio?.unlock?.();
    window.removeEventListener("pointerdown", unlockAudio);
  };
  window.addEventListener("pointerdown", unlockAudio);

  /* ---- damage indicators ---- */

  const _dmgVec = new THREE.Vector3();

  function addDamageMark(sourcePosition, magnitude) {
    const node = el("i", "bs-dmg__mark", damageRing);
    let bearing = 0;
    if (sourcePosition) {
      _dmgVec.copy(sourcePosition).sub(player.position);
      // Relative bearing: 0 is dead ahead, positive is to the right.
      const worldAngle = Math.atan2(_dmgVec.x, -_dmgVec.z);
      bearing = worldAngle + player.state.yaw;
    }
    node.style.setProperty("--bearing", `${(bearing / DEG).toFixed(1)}deg`);
    node.style.setProperty("--weight", (0.5 + magnitude * 0.5).toFixed(2));
    damageMarks.push({ node, born: ctx.time, life: 1.5, source: sourcePosition ? sourcePosition.clone() : null });
    while (damageMarks.length > 5) damageMarks.shift().node.remove();
  }

  /* ---- spotting ---- */

  const _spotDir = new THREE.Vector3();
  const _spotTo = new THREE.Vector3();

  function doSpot() {
    if (!ctx.bots || !player.state.alive) return;
    const aim = player.aimDirection;
    const eye = player.eyePosition;
    let marked = 0;
    const candidates = [];
    for (const bot of ctx.bots.bots) {
      if (!bot.alive || isFriendly(bot.team)) continue;
      _spotTo.set(bot.position.x, bot.position.y + 1.2, bot.position.z).sub(eye);
      const distance = _spotTo.length();
      if (distance > 320) continue;
      _spotDir.copy(_spotTo).multiplyScalar(1 / distance);
      const dot = _spotDir.dot(aim);
      if (dot < Math.cos(26 * DEG)) continue;
      candidates.push({ bot, dot, distance });
    }
    candidates.sort((a, b) => b.dot - a.dot);
    for (const candidate of candidates.slice(0, 3)) {
      if (!ctx.physics.lineOfSight(eye, candidate.bot.position, LAYER.TERRAIN | LAYER.STATIC)) continue;
      localState.spotted.set(candidate.bot, ctx.time + 9);
      marked += 1;
    }
    if (marked) {
      addNote(`SPOTTED — ${marked} hostile${marked > 1 ? "s" : ""}`, "spot");
      ctx.audio?.playAt?.("click", player.position, { spatial: false, volume: 0.4 });
    }
  }

  /**
   * Equipment is HUD-owned for now: nothing in weapons.js throws
   * anything. The indicator reads `player.state.grenades` the moment the
   * engine defines it, and the bus event below is the contract a future
   * implementation should listen on. See the handover notes.
   */
  function throwGrenade() {
    if (player.state.grenades !== undefined) return;
    if (localState.grenades <= 0 || localState.grenadeCooldown > 0) return;
    localState.grenades -= 1;
    localState.grenadeCooldown = 1.1;
    ctx.bus.emit("player:grenade", { position: player.position.clone(), direction: player.aimDirection });
  }

  /* ============================================================
     SCOREBOARD DATA
     ============================================================ */

  function rosterFor(team) {
    const out = [];
    if (team === player.state.team) {
      out.push({
        name: prefs.name || "YOU", score: player.state.score,
        kills: player.state.kills, deaths: player.state.deaths, ping: 0, me: true,
      });
    }
    if (ctx.net) {
      for (const peer of ctx.net.state.peers.values()) {
        if (peer.team !== undefined && peer.team !== team) continue;
        out.push({
          name: peer.name, score: peer.score || 0,
          kills: peer.kills || 0, deaths: peer.deaths || 0, ping: peer.ping || 30,
        });
      }
    }
    if (ctx.bots) {
      for (const bot of ctx.bots.bots) {
        if (bot.team !== team) continue;
        const record = scoreOf(bot);
        out.push({
          name: nameOf(bot),
          score: record.kills * 100,
          kills: record.kills, deaths: record.deaths,
          ping: 0, bot: true, alive: bot.alive,
        });
      }
    }
    out.sort((a, b) => b.score - a.score || b.kills - a.kills);
    return out;
  }

  function refreshScoreboard() {
    for (const column of sbColumns) {
      setText(column.tickets, `${Math.max(0, Math.round(world.match.tickets[column.team]))} TICKETS`);
      world.controlPoints.forEach((point, index) => {
        const pip = column.flagPips[index];
        setFlag(pip, "is-held", point.owner === column.team);
        setFlag(pip, "is-contested", point.contested);
      });

      const roster = rosterFor(column.team);
      while (column.pool.length < roster.length) {
        const node = el("div", "bs-sb__row", column.rows);
        for (let i = 0; i < 5; i += 1) el("span", null, node);
        column.pool.push(node);
      }
      column.pool.forEach((node, index) => {
        const entry = roster[index];
        setStyle(node, "display", entry ? "" : "none");
        if (!entry) return;
        setFlag(node, "is-me", Boolean(entry.me));
        setFlag(node, "is-down", entry.alive === false);
        const cells = node.children;
        setText(cells[0], entry.name);
        setText(cells[1], String(entry.score));
        setText(cells[2], String(entry.kills));
        setText(cells[3], String(entry.deaths));
        setText(cells[4], entry.bot ? "AI" : `${entry.ping}`);
      });
    }
    const botReport = ctx.bots ? ctx.bots.report() : null;
    setText(sbFooter, botReport
      ? `${botReport.alive} soldiers in the field · ${botReport.engaging} in contact · ${formatTime(world.match.timeRemaining)} remaining`
      : formatTime(world.match.timeRemaining));
  }

  /* ============================================================
     LAYOUT / SCALE
     ============================================================ */

  /**
   * One number drives the whole HUD's size. Derived from the stage, not
   * the viewport: the game normally occupies a panel inside the site
   * page, so `vw`/`vh` would size the HUD for the browser window rather
   * than for the rectangle the player is actually looking at.
   */
  function applyScale(force = false) {
    const w = render.size.width;
    const h = render.size.height;
    if (!force && w === localState.lastSize.w && h === localState.lastSize.h) return;
    localState.lastSize.w = w;
    localState.lastSize.h = h;

    const fit = Math.min(w / 1600, h / 900);
    const hs = clamp(fit, 0.58, 1.5) * clamp(prefs.hudScale || 1, 0.7, 1.5);
    localState.hs = hs;
    hudRoot.style.setProperty("--hs", hs.toFixed(3));
    if (overlayRoot) overlayRoot.style.setProperty("--hs", hs.toFixed(3));
    if (touchRoot) touchRoot.style.setProperty("--hs", hs.toFixed(3));
    setFlag(hudRoot, "is-narrow", w < 620);
    setFlag(hudRoot, "is-short", h < 460);
    if (overlayRoot) setFlag(overlayRoot, "is-narrow", w < 620);

    // Minimap backing store follows the CSS box so the relief stays
    // crisp on a high-DPI phone without paying for it on a laptop.
    const rect = minimapWrap.getBoundingClientRect();
    const side = Math.max(96, Math.round(rect.width || 150));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    minimap.width = Math.round(side * dpr);
    minimap.height = Math.round(side * dpr);
    minimap.__css = side;
    minimap.__dpr = dpr;
    if (localState.overlay === "map") drawFullMap();
    if (localState.overlay === "deploy") drawDeployMap();
  }

  /* ============================================================
     PER-FRAME
     ============================================================ */

  let smoothedSpread = 0;
  let smoothedHealth = 100;
  let minimapTimer = 0;
  let overlayTimer = 0;
  const MINIMAP_SPAN = 400;

  const _mkCam = new THREE.Vector3();
  const _mkNdc = new THREE.Vector3();
  const _mkPos = new THREE.Vector3();

  /**
   * World position to HUD pixels. Off-screen and behind-camera targets
   * are pinned to the frame edge with a direction arrow rather than
   * dropped, which is what makes an objective marker usable for
   * navigation instead of only for confirmation.
   */
  function projectMarker(worldPos, out) {
    const cam = render.camera;
    _mkCam.copy(worldPos).applyMatrix4(cam.matrixWorldInverse);
    const depth = -_mkCam.z;
    _mkNdc.copy(worldPos).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);

    let nx = _mkNdc.x;
    let ny = _mkNdc.y;
    if (depth <= 0) {
      // Behind the camera the perspective divide mirrors the point;
      // negate it and push it past the frame so the edge clamp fires.
      nx = -nx;
      ny = -ny;
      const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1e-4;
      nx = (nx / m) * 1.4;
      ny = (ny / m) * 1.4;
    }

    const margin = 0.88;
    let offscreen = false;
    if (Math.abs(nx) > margin || Math.abs(ny) > margin) {
      offscreen = true;
      const m = Math.max(Math.abs(nx) / margin, Math.abs(ny) / margin);
      nx /= m;
      ny /= m;
    }

    out.x = (nx * 0.5 + 0.5) * render.size.width;
    out.y = (-ny * 0.5 + 0.5) * render.size.height;
    out.depth = depth;
    out.offscreen = offscreen;
    out.angle = Math.atan2(-ny, nx);
    return out;
  }

  const _mark = { x: 0, y: 0, depth: 0, offscreen: false, angle: 0 };

  function updateWorldMarkers(dt) {
    const camPos = render.camera.position;

    for (const marker of objectiveMarkers) {
      const point = marker.point;
      _mkPos.set(point.position.x, point.position.y + 3.4, point.position.z);
      projectMarker(_mkPos, _mark);
      const distance = camPos.distanceTo(point.position);

      // Line of sight is the expensive part, so it runs at ~7Hz per
      // marker on a stagger rather than every frame for all five.
      marker.losTimer -= dt;
      if (marker.losTimer <= 0) {
        marker.losTimer = 0.14 + Math.random() * 0.06;
        marker.los = ctx.physics.lineOfSight(camPos, _mkPos, LAYER.TERRAIN | LAYER.STATIC);
      }

      const node = marker.node;
      setStyle(node, "transform", `translate(${_mark.x.toFixed(1)}px, ${_mark.y.toFixed(1)}px)`);
      // Occluded markers dim to an outline rather than vanishing. A flag
      // you cannot see is exactly the flag you need to navigate to; BF
      // keeps them visible for the same reason.
      setFlag(node, "is-occluded", !marker.los);
      setFlag(node, "is-edge", _mark.offscreen);
      setFlag(node, "is-near", distance < point.radius * 1.3);
      node.dataset.owner = teamKey(point.owner);
      setFlag(node, "is-contested", point.contested);
      setText(marker.id, point.id);
      setText(marker.dist, distance > 8 ? `${Math.round(distance)}m` : "HERE");
      if (_mark.offscreen) {
        setStyle(marker.arrow, "transform", `rotate(${(_mark.angle / DEG).toFixed(0)}deg)`);
      }
      setStyle(node, "opacity", "1");
    }

    /* ---- spotted hostiles ---- */
    let index = 0;
    if (ctx.bots) {
      for (const [bot, expiry] of localState.spotted) {
        if (ctx.time > expiry || !bot.alive) { localState.spotted.delete(bot); continue; }
        if (index >= 8) break;
        const marker = acquireSpotMarker(index);
        index += 1;
        _mkPos.set(bot.position.x, bot.position.y + 2.15, bot.position.z);
        projectMarker(_mkPos, _mark);
        const distance = camPos.distanceTo(bot.position);
        setStyle(marker.node, "display", "");
        setStyle(marker.node, "transform", `translate(${_mark.x.toFixed(1)}px, ${_mark.y.toFixed(1)}px)`);
        setStyle(marker.node, "opacity", clamp01((expiry - ctx.time) / 1.4).toFixed(2));
        setFlag(marker.node, "is-edge", _mark.offscreen);
        setText(marker.dist, `${Math.round(distance)}m`);
        if (_mark.offscreen) {
          setStyle(marker.arrow, "transform", `rotate(${(_mark.angle / DEG).toFixed(0)}deg)`);
        }
      }
    }
    for (let i = index; i < spotMarkerPool.length; i += 1) {
      setStyle(spotMarkerPool[i].node, "display", "none");
    }
  }

  /* ---- minimap ---- */

  function drawMinimap() {
    const side = minimap.__css || 150;
    const dpr = minimap.__dpr || 1;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(mctx, {
      width: side, height: side,
      centreX: player.position.x, centreZ: player.position.z,
      span: MINIMAP_SPAN, rotate: player.state.yaw,
    });
    // North pip on the rim, so a rotating map never disorients.
    const bearing = -player.state.yaw;
    setStyle(minimapNorth, "transform",
      `translate(-50%, -50%) rotate(${(bearing / DEG).toFixed(1)}deg) translateY(calc(var(--r) * -1))`);
  }

  /* ---- compass ---- */

  function updateCompass() {
    // Bearing measured clockwise from -Z, which is the world's north.
    const heading = ((-player.state.yaw / DEG) % 360 + 360) % 360;
    setStyle(compassTrack, "transform",
      `translateX(calc(${(-(heading + 180) * COMPASS_PX_PER_DEG).toFixed(1)}px * var(--hs)))`);

    for (const pip of compassPips) {
      const dx = pip.point.position.x - player.position.x;
      const dz = pip.point.position.z - player.position.z;
      const bearing = ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360 + pip.turn;
      setStyle(pip.node, "transform",
        `translateX(calc(${((bearing + 180) * COMPASS_PX_PER_DEG).toFixed(1)}px * var(--hs)))`);
      pip.node.dataset.owner = teamKey(pip.point.owner);
      setFlag(pip.node, "is-contested", pip.point.contested);
    }
  }

  /* ---- stance glyph ---- */

  const STANCE_GLYPHS = {
    stand: "M8 1a1.6 1.6 0 110 3.2A1.6 1.6 0 018 1zm-2.4 4h4.8l1.4 4.2-1.5.5-.9-2.6V15H9.1v-4.6H6.9V15H5.6V7.1l-.9 2.6-1.5-.5z",
    crouch: "M8 1a1.6 1.6 0 110 3.2A1.6 1.6 0 018 1zM5.2 5.2h5.2l1.6 3.5-1.4.7-1-2v2.4l2 2.6v2.4h-1.7v-1.9l-2-2.4-1.6 2v2.3H4.6v-3l1.8-2.2V7.4l-1 2-1.4-.7z",
    prone: "M3 9.4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM6 9.6h5.6l1.4-1.6 1.2 1-1.9 2.2H6z",
  };

  function updateStance() {
    const stance = player.state.stance;
    if (stanceEl.__stance !== stance) {
      stanceEl.__stance = stance;
      stanceIcon.innerHTML = `<path d="${STANCE_GLYPHS[stance] || STANCE_GLYPHS.stand}"/>`;
      setText(stanceText, stance.toUpperCase());
      stanceEl.dataset.stance = stance;
    }
    setFlag(stanceEl, "is-sprint", player.state.sprinting);
  }

  /* ---- magazine pips ---- */

  let magPipCount = -1;
  function updateMagPips(slot, def) {
    // Pips only up to 30. A 100-round LMG belt as dots is noise; past
    // that the number carries the information on its own.
    const wanted = def.magazine <= 30 ? def.magazine : 0;
    if (wanted !== magPipCount) {
      magPipCount = wanted;
      magPips.innerHTML = "";
      for (let i = 0; i < wanted; i += 1) el("i", null, magPips);
    }
    if (!wanted) return;
    const children = magPips.children;
    for (let i = 0; i < children.length; i += 1) {
      setFlag(children[i], "is-spent", i >= slot.ammo);
    }
  }

  /* ---- the frame ---- */

  function update(dt) {
    applyScale();

    const p = player.state;
    const slot = weapons.state.slot;
    const def = weapons.state.def;

    setFlag(hudRoot, "is-hidden", !prefs.showHud);
    setFlag(hudRoot, "is-dead", !p.alive);

    /* ---- crosshair ---- */
    // Project the cone half-angle onto the screen. tan(theta) over
    // tan(fov/2) times half the viewport height is the exact pixel
    // radius the spread covers - not an arbitrary multiplier.
    const halfFov = render.camera.fov * 0.5 * DEG;
    const pixels = (Math.tan(slot.spread * DEG) / Math.tan(halfFov)) * (render.size.height * 0.5);
    smoothedSpread = damp(smoothedSpread, pixels, 18, dt);
    const gap = clamp(smoothedSpread, 3, 220);
    setStyle(crosshair, "--gap", `${gap.toFixed(1)}px`);
    const crossHidden = !p.alive || p.adsAmount > 0.75 || localState.overlay;
    setStyle(crosshair, "opacity", crossHidden ? "0" : (1 - p.adsAmount * 0.9).toFixed(2));
    setFlag(crosshair, "is-dot", prefs.crosshair === "dot");
    setFlag(crosshair, "is-static", prefs.crosshair === "cross");
    setStyle(crossDot, "opacity", prefs.crosshair === "dot" ? "1" : "0.5");
    setFlag(crosshair, "is-suppressed", p.suppression > 0.25);

    /* ---- suppression ---- */
    setStyle(suppression, "opacity", (clamp01(p.suppression) * 0.9).toFixed(2));

    /* ---- damage arcs ---- */
    for (let i = damageMarks.length - 1; i >= 0; i -= 1) {
      const mark = damageMarks[i];
      const age = (ctx.time - mark.born) / mark.life;
      if (age >= 1) { mark.node.remove(); damageMarks.splice(i, 1); continue; }
      // Re-bear the arc as the player turns, so spinning towards the
      // shooter visibly brings the indicator to the top of the screen.
      if (mark.source) {
        _dmgVec.copy(mark.source).sub(player.position);
        const bearing = Math.atan2(_dmgVec.x, -_dmgVec.z) + p.yaw;
        setStyle(mark.node, "--bearing", `${(bearing / DEG).toFixed(1)}deg`);
      }
      setStyle(mark.node, "opacity", (1 - age * age).toFixed(2));
    }

    /* ---- vitals ---- */
    const healthPct = clamp01(p.health / p.maxHealth) * 100;
    smoothedHealth = damp(smoothedHealth, healthPct, 3.4, dt);
    setStyle(healthFill, "width", `${healthPct.toFixed(1)}%`);
    setStyle(healthGhost, "width", `${Math.max(smoothedHealth, healthPct).toFixed(1)}%`);
    setFlag(healthWrap, "is-critical", p.health <= 25);
    setFlag(healthWrap, "is-low", p.health <= 60 && p.health > 25);
    setText(healthText, String(Math.max(0, Math.round(p.health))));
    setStyle(staminaFill, "width", `${(p.stamina * 100).toFixed(1)}%`);
    setFlag(staminaWrap, "is-idle", p.stamina > 0.99);
    setFlag(staminaWrap, "is-spent", p.stamina < 0.2);
    updateStance();

    /* ---- ammo ---- */
    setText(ammoMag, String(slot.ammo));
    setText(ammoReserve, String(slot.reserve));
    setText(weaponName, def.name);
    setText(fireModeEl, def.fireMode[slot.modeIndex % def.fireMode.length].toUpperCase());
    const lowAmmo = slot.ammo <= Math.max(1, Math.ceil(def.magazine * 0.25));
    setFlag(arms, "is-low", lowAmmo && slot.ammo > 0);
    setFlag(arms, "is-empty", slot.ammo === 0);
    setFlag(arms, "is-dry", slot.reserve === 0 && slot.ammo === 0);
    updateMagPips(slot, def);

    const reloading = slot.reloading > 0;
    setFlag(reloadBar, "is-live", reloading);
    if (reloading) {
      const total = slot.ammo === 0 ? def.reloadEmptyTime : def.reloadTime;
      setStyle(reloadFill, "width", `${(clamp01(1 - slot.reloading / total) * 100).toFixed(1)}%`);
    }
    setText(reloadText, reloading ? "RELOADING" : (slot.ammo === 0 ? "RELOAD  [R]" : ""));
    setFlag(reloadBar, "is-warning", !reloading && slot.ammo === 0 && slot.reserve > 0);

    localState.grenadeCooldown = Math.max(0, localState.grenadeCooldown - dt);
    const grenades = p.grenades !== undefined ? p.grenades : localState.grenades;
    setText(grenadeSlot.count, String(grenades));
    setFlag(grenadeSlot.node, "is-empty", grenades <= 0);
    setText(knifeSlot.count, "∞");

    /* ---- match ---- */
    const blueHeld = world.controlPoints.filter((pt) => pt.owner === TEAM.BLUE).length;
    const redHeld = world.controlPoints.filter((pt) => pt.owner === TEAM.RED).length;
    const gap2 = blueHeld - redHeld;
    const bleedPhase = clamp01((world.match.bleedTimer || 0) / 3);

    const applyTickets = (block, team, bleeding) => {
      setText(block.num, String(Math.max(0, Math.round(world.match.tickets[team]))));
      setFlag(block.wrap, "is-bleeding", bleeding > 0);
      setText(block.rate, bleeding > 0 ? `▼${bleeding}` : "");
      setStyle(block.bleed, "width", bleeding > 0 ? `${(bleedPhase * 100).toFixed(0)}%` : "0%");
      setFlag(block.wrap, "is-low", world.match.tickets[team] < world.match.maxTickets * 0.2);
    };
    applyTickets(ticketBlue, TEAM.BLUE, gap2 < 0 ? -gap2 : 0);
    applyTickets(ticketRed, TEAM.RED, gap2 > 0 ? gap2 : 0);
    setText(clock, formatTime(world.match.timeRemaining));
    setFlag(clock, "is-urgent", world.match.timeRemaining < 120);

    /* ---- flags ---- */
    let standingOn = null;
    let standingDistance = Infinity;
    for (const cell of flagCells) {
      const point = cell.point;
      cell.node.dataset.owner = teamKey(point.owner);
      setFlag(cell.node, "is-contested", point.contested);
      setStyle(cell.fill, "height", `${(Math.abs(point.capture) * 100).toFixed(0)}%`);
      setFlag(cell.fill, "is-blue", point.capture > 0);
      const d = Math.hypot(player.position.x - point.position.x, player.position.z - point.position.z);
      const inside = d <= point.radius;
      setFlag(cell.node, "is-here", inside);
      setStyle(cell.pin, "opacity", inside ? "1" : "0");
      if (inside && d < standingDistance) { standingDistance = d; standingOn = point; }
    }

    /* ---- capture bar ---- */
    if (standingOn && p.alive) {
      setFlag(capture, "is-live", true);
      setText(captureLabel, `${standingOn.id} — ${standingOn.label}`);
      const progress = standingOn.capture;
      const mine = player.state.team === TEAM.BLUE ? progress : -progress;
      setStyle(captureFill, "width", `${(Math.abs(progress) * 50).toFixed(1)}%`);
      setStyle(captureFill, "left", progress >= 0 ? "50%" : `${(50 - Math.abs(progress) * 50).toFixed(1)}%`);
      setFlag(captureFill, "is-blue", progress > 0);
      capture.dataset.owner = teamKey(standingOn.owner);
      const state = standingOn.contested ? "CONTESTED"
        : standingOn.owner === player.state.team ? (mine >= 1 ? "SECURED" : "CAPTURING")
          : mine > 0 ? "CAPTURING" : "LOSING GROUND";
      setText(captureState, state);
      setFlag(capture, "is-contested", standingOn.contested);
    } else {
      setFlag(capture, "is-live", false);
    }

    /* ---- prompts ---- */
    let promptText = "";
    if (p.inVehicle) {
      promptText = "[E]  EXIT VEHICLE";
    } else if (ctx.vehicles && p.alive) {
      const candidate = ctx.vehicles.nearestUsable(player.position, p.team);
      if (candidate) promptText = `[E]  ENTER ${candidate.spec.name.toUpperCase()}`;
    }
    setText(prompt, promptText);
    setStyle(prompt, "opacity", promptText ? "1" : "0");

    /* ---- banner / respawn ---- */
    setStyle(banner, "opacity", ctx.time < bannerUntil ? "1" : "0");
    setFlag(respawnPanel, "is-live", !p.alive);
    // player.js respawns on a 4.2s timer from the death event.
    if (!p.alive) {
      const left = 4.2 - (ctx.time - (localState.deathAt || ctx.time));
      setText(respawnCount, String(Math.max(0, Math.ceil(left))));
    }

    /* ---- kill feed ageing ---- */
    for (let i = feedEntries.length - 1; i >= 0; i -= 1) {
      const entry = feedEntries[i];
      const age = ctx.time - entry.born;
      if (age > 8) { entry.node.remove(); feedEntries.splice(i, 1); }
      else setStyle(entry.node, "opacity", clamp01((8 - age) / 1.6).toFixed(2));
    }

    /* ---- unclaimed bot deaths ---- */
    // weapon:hit fires immediately after bot:death for the player's own
    // kills, so anything still pending here was a bot-on-bot kill.
    if (pendingBotDeath && ctx.time - pendingBotDeath.at > 0.001) {
      const { bot, headshot } = pendingBotDeath;
      const killer = bot.target && bot.target.ref && bot.target.ref.id ? bot.target.ref : null;
      addKill({
        killer: killer ? nameOf(killer) : world.teamName(bot.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE),
        killerTeam: killer ? killer.team : (bot.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE),
        victim: nameOf(bot), victimTeam: bot.team,
        weapon: "rifle", headshot: Boolean(headshot),
      });
      if (killer) scoreOf(killer).kills += 1;
      pendingBotDeath = null;
    }

    /* ---- compass and world markers ---- */
    updateCompass();
    updateWorldMarkers(dt);

    /* ---- minimap ---- */
    // 15Hz. A minimap redrawn every frame is a full canvas repaint for
    // information that changes at walking pace.
    minimapTimer += dt;
    if (minimapTimer > 1 / 15) { minimapTimer = 0; drawMinimap(); }

    /* ---- perf readout ---- */
    setFlag(fpsPanel, "is-live", Boolean(prefs.showFps));
    if (prefs.showFps) {
      const stats = render.stats();
      setText(fpsPanel,
        `${(ctx.stats?.fps || 0).toFixed(0)} fps · ${stats.frameMs.toFixed(1)}ms · ${stats.calls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris`);
    }

    /* ---- overlays ---- */
    const wantsScoreboard = input.isDown("scoreboard");
    if (wantsScoreboard && localState.overlay === null) setOverlay("scoreboard");
    else if (!wantsScoreboard && localState.overlay === "scoreboard" && !touchMode) setOverlay(null);

    overlayTimer += dt;
    if (overlayTimer > 0.25) {
      overlayTimer = 0;
      if (localState.overlay === "scoreboard") refreshScoreboard();
      if (localState.overlay === "map") drawFullMap();
      if (localState.overlay === "deploy") drawDeployMap();
    }
  }

  /* ============================================================
     BOOT
     ============================================================ */

  applyScale(true);
  refreshOptions();
  // The screenshot harness needs an unobstructed frame, and a headless
  // run has nobody to press DEPLOY.
  if (!settings.qa) setOverlay("deploy");

  /* ------------------------------- api ------------------------------- */

  return {
    update,
    addFeed: (text, tone) => addNote(text, tone === "kill" ? "good" : tone || "neutral"),
    addKill,
    showBanner,
    setOverlay,
    get overlay() { return localState.overlay; },
    elements: { crosshair, minimap, killfeed, prompt, banner, worldLayer },

    /** Drives the HUD into a representative combat state so a capture
     *  shows what a firefight actually looks like, not an idle frame. */
    demo(kind = "combat") {
      if (kind === "combat" || kind === "all") {
        const hostiles = ctx.bots
          ? ctx.bots.bots.filter((b) => b.alive && !isFriendly(b.team)).slice(0, 5)
          : [];
        hostiles.forEach((bot) => localState.spotted.set(bot, ctx.time + 30));
        addKill({ killer: "YOU", killerTeam: player.state.team, victim: "SOKOLOV", victimTeam: enemyTeam(), weapon: "rifle", headshot: true, mine: true });
        addKill({ killer: "HOLLAND", killerTeam: player.state.team, victim: "PETROV", victimTeam: enemyTeam(), weapon: "marksman" });
        addNote("INSURGENCY CAPTURED D — MARKET", "bad");
        addKill({ killer: "NAJJAR", killerTeam: enemyTeam(), victim: "REYES", victimTeam: player.state.team, weapon: "lmg" });
        addKill({ killer: "VOSS", killerTeam: player.state.team, victim: "TANAKA", victimTeam: enemyTeam(), weapon: "explosive" });
        hitMarker.classList.add("is-kill", "is-frozen");
        popScore("+150", "head", true);
        popScore("+100", "kill", true);
        const behind = player.position.clone();
        behind.x += 40;
        behind.z -= 22;
        addDamageMark(behind, 0.9);
        const side = player.position.clone();
        side.x -= 55;
        side.z -= 8;
        addDamageMark(side, 0.5);
        player.state.suppression = 0.55;
        player.state.health = 43;
        player.state.stamina = 0.42;
        weapons.state.slot.ammo = 7;
        showBanner("C CAPTURED", "THE CITADEL", 30);
      }
      return true;
    },

    report() {
      return {
        overlay: localState.overlay,
        feed: feedEntries.length,
        spotted: localState.spotted.size,
        scale: Number(localState.hs.toFixed(3)),
        touch: touchMode,
        markers: objectiveMarkers.length,
      };
    },

    dispose() {
      unbind.forEach((off) => off && off());
      window.removeEventListener("pointerdown", unlockAudio);
      hudRoot.innerHTML = "";
      if (overlayRoot) overlayRoot.innerHTML = "";
      if (touchRoot) touchRoot.innerHTML = "";
    },
  };
}
