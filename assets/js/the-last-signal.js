/* ============================================
   THE LAST SIGNAL
   - Serious lore-forward RTS-lite skirmish: Humans vs Robots vs Aliens
     over an ancient signal buried under Earth.
   - Top-down canvas sim. Simulation state is kept separate from rendering:
     update*() functions mutate state, render*() functions only read it.
   - Modules: constants/helpers, Sfx (synth audio), FACTIONS (data),
     world/map, entities, orders, sim systems, AI, input, rendering,
     HUD/overlay DOM, game flow, debug hook (window.__TLS).
   ============================================ */
(function () {
  "use strict";

  /* ==================================================
     1. CONSTANTS + HELPERS
     ================================================== */
  const GAME_ID = "the-last-signal";
  const W = 1280, H = 720;               // canvas viewport
  const WORLD_W = 4200, WORLD_H = 3000;  // world size
  const MM = { x: 14, y: H - 168, w: 244, h: 154 }; // minimap rect (canvas space)
  const BUILD_RADIUS = 320;              // max distance from a friendly building
  const CLAIM_TIME = 2.4;                // seconds to secure a resource node
  const UNIT_CAP = 60;                   // per-team command bandwidth
  const QUEUE_CAP = 5;
  const EDGE_SCROLL = 820;               // px/s
  const CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 };
  const TAU = Math.PI * 2;
  const VISION = {
    worker: 360,
    combat: 430,
    scout: 760,
    building: 520,
    hq: 650,
    claimedNode: 500,
    claimingNode: 330,
  };

  const BASE_RATES = { matter: 0.9, energy: 1.0, signal: 0.3 };
  const NODE_RES = { matter: "m", energy: "e", signal: "s" };
  const NODE_COLORS = { matter: "#5fd6a7", energy: "#ffd43b", signal: "#b06cff" };
  const RES_GLYPH = { m: "◆", e: "⚡", s: "✦" }; // ◆ ⚡ ✦
  const RES_NAME = { m: "Matter", e: "Energy", s: "Signal" };
  const NODE_CLAIM_HP = { matter: 130, energy: 165, signal: 190 };
  const COMMAND_HINTS = {
    move: { label: "Move", color: "#74f7d4", shadow: "rgba(116,247,212,0.45)" },
    attack: { label: "Attack", color: "#ff5268", shadow: "rgba(255,82,104,0.48)" },
    attackMove: { label: "Attack move", color: "#ff9d5c", shadow: "rgba(255,157,92,0.44)" },
    breach: { label: "Breach", color: "#e8c37a", shadow: "rgba(232,195,122,0.44)" },
    gather: { label: "Gather", color: "#5fd6a7", shadow: "rgba(95,214,167,0.45)" },
    claim: { label: "Claim", color: "#7df3ff", shadow: "rgba(125,243,255,0.45)" },
    repair: { label: "Repair", color: "#9fe8ff", shadow: "rgba(159,232,255,0.48)" },
    rally: { label: "Rally", color: "#ffd43b", shadow: "rgba(255,212,59,0.4)" },
    blocked: { label: "Blocked", color: "#ffd43b", shadow: "rgba(255,212,59,0.38)" },
  };
  const ART_BASE = (() => {
    const scriptUrl = document.currentScript && document.currentScript.src;
    return scriptUrl
      ? new URL("../img/the-last-signal/", scriptUrl).href
      : "../assets/img/the-last-signal/";
  })();
  const ATLAS_COLS = 4, ATLAS_ROWS = 3;
  const UNIT_ATLAS = {
    "h-worker": [0, 0], "h-basic": [1, 0], "h-ranged": [2, 0], "h-heavy": [3, 0],
    "r-worker": [0, 1], "r-basic": [1, 1], "r-ranged": [2, 1], "r-heavy": [3, 1],
    "a-worker": [0, 2], "a-basic": [1, 2], "a-ranged": [2, 2], "a-heavy": [3, 2],
  };
  const BUILDING_ATLAS = {
    "h-hq": [0, 0], "h-ext": [1, 0], "h-prod": [2, 0], "h-tur": [3, 0],
    "r-hq": [0, 1], "r-ext": [1, 1], "r-prod": [2, 1], "r-tur": [3, 1],
    "a-hq": [0, 2], "a-ext": [1, 2], "a-prod": [2, 2], "a-tur": [3, 2],
  };
  const AtlasBounds = { units: {}, buildings: {} };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const d2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function costStr(c) {
    let out = [];
    if (c.m) out.push(`${RES_GLYPH.m}${c.m}`);
    if (c.e) out.push(`${RES_GLYPH.e}${c.e}`);
    if (c.s) out.push(`${RES_GLYPH.s}${c.s}`);
    return out.join(" ") || "free";
  }
  function loadArt(file, onload) {
    const img = new Image();
    img.decoding = "async";
    img.addEventListener("load", () => { if (onload) onload(img); });
    img.src = ART_BASE + file;
    return img;
  }
  function artReady(img) {
    return !!(img && img.complete && img.naturalWidth > 0);
  }
  function cacheAtlasBounds(img, map, store) {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cctx = c.getContext("2d", { willReadFrequently: true });
      cctx.drawImage(img, 0, 0);
      const sw = img.naturalWidth / ATLAS_COLS;
      const sh = img.naturalHeight / ATLAS_ROWS;
      Object.entries(map).forEach(([key, [cx, cy]]) => {
        const sx = Math.floor(cx * sw), sy = Math.floor(cy * sh);
        const w = Math.floor(sw), h = Math.floor(sh);
        const data = cctx.getImageData(sx, sy, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] < 16) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
        if (maxX >= minX && maxY >= minY) {
          const pad = 8;
          const x0 = Math.max(0, minX - pad);
          const y0 = Math.max(0, minY - pad);
          const x1 = Math.min(w, maxX + pad + 1);
          const y1 = Math.min(h, maxY + pad + 1);
          store[key] = {
            x: sx + x0,
            y: sy + y0,
            w: x1 - x0,
            h: y1 - y0,
          };
        }
      });
    } catch (e) {
      Object.keys(store).forEach((key) => delete store[key]);
    }
  }
  const Art = {
    terrain: loadArt("battlefield-ai-v1.jpg", () => { if (state.nodes.length) buildTerrain(); }),
    units: loadArt("units-atlas-ai-v1.png", (img) => cacheAtlasBounds(img, UNIT_ATLAS, AtlasBounds.units)),
    buildings: loadArt("buildings-atlas-ai-v1.png", (img) => cacheAtlasBounds(img, BUILDING_ATLAS, AtlasBounds.buildings)),
  };

  /* ==================================================
     2. DOM + SITE API
     ================================================== */
  const api = typeof RB !== "undefined"
    ? RB
    : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlayEl = document.getElementById("tls-overlay");
  const screenEl = document.getElementById("tls-screen");
  const el = {
    matter: document.getElementById("tls-matter"),
    energy: document.getElementById("tls-energy"),
    signal: document.getElementById("tls-signal"),
    army: document.getElementById("tls-army"),
    time: document.getElementById("tls-time"),
    best: document.getElementById("tls-best"),
    selTitle: document.getElementById("tls-sel-title"),
    selFlavor: document.getElementById("tls-sel-flavor"),
    selBody: document.getElementById("tls-sel-body"),
    actions: document.getElementById("tls-actions"),
    actionsM: document.getElementById("tls-actions-m"),
    objective: document.getElementById("tls-objective"),
    log: document.getElementById("tls-log"),
    dockSel: document.getElementById("tls-dock-sel"),
    dockRes: document.getElementById("tls-dock-res"),
  };
  const btn = {
    fullscreen: document.getElementById("btn-fullscreen"),
    pause: document.getElementById("btn-pause"),
    attack: document.getElementById("btn-cmd-attack"),
    stop: document.getElementById("btn-cmd-stop"),
    army: document.getElementById("btn-cmd-army"),
    dockAttack: document.getElementById("dock-attack"),
    dockStop: document.getElementById("dock-stop"),
    dockArmy: document.getElementById("dock-army"),
    dockX: document.getElementById("dock-x"),
    dockPause: document.getElementById("dock-pause"),
  };

  /* ==================================================
     3. SFX — 100% synthesized WebAudio
     ================================================== */
  const Sfx = (() => {
    let ac = null, master = null;
    function init() {
      if (ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.3;
        master.connect(ac.destination);
      } catch (e) { /* audio unavailable */ }
    }
    function tone(f0, f1, dur, type, vol, delay = 0) {
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol, freq = 900, delay = 0) {
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t0);
    }
    return {
      init,
      click: () => tone(660, 520, 0.06, "square", 0.12),
      place: () => { tone(180, 90, 0.22, "sawtooth", 0.2); noise(0.18, 0.16, 500); },
      complete: () => { tone(392, 392, 0.1, "sine", 0.18); tone(523, 523, 0.12, "sine", 0.18, 0.09); },
      trainDone: () => tone(494, 740, 0.13, "triangle", 0.18),
      shot: (kind) => {
        if (kind === "rail") { tone(1400, 220, 0.12, "sawtooth", 0.14); }
        else if (kind === "beam") { tone(220, 700, 0.1, "sawtooth", 0.1); }
        else if (kind === "psi") { tone(880, 440, 0.14, "sine", 0.1); }
        else if (kind === "melee") { noise(0.05, 0.1, 2200); }
        else { tone(520, 240, 0.06, "square", 0.1); }
      },
      boom: (big) => {
        noise(big ? 0.55 : 0.25, big ? 0.42 : 0.22, big ? 320 : 620);
        tone(big ? 120 : 200, 40, big ? 0.5 : 0.25, "sine", big ? 0.35 : 0.2);
      },
      alarm: () => { tone(660, 440, 0.22, "square", 0.16); tone(660, 440, 0.22, "square", 0.16, 0.28); },
      win: () => { [262, 330, 392, 523].forEach((f, i) => tone(f, f, 0.3, "triangle", 0.2, i * 0.16)); },
      lose: () => { [330, 294, 262, 196].forEach((f, i) => tone(f, f * 0.94, 0.34, "sine", 0.2, i * 0.2)); },
    };
  })();
  document.addEventListener("pointerdown", () => Sfx.init(), { once: true });

  /* ==================================================
     4. FACTIONS — all gameplay data + lore
     ================================================== */
  function U(o) { // unit def defaults
    return Object.assign({ shield: 0, splash: 0, aggro: 0, worker: false, scout: false, carry: 0, htime: 0, repair: 0, proj: "bullet" }, o);
  }
  function B(o) { // building def defaults
    return Object.assign({ trains: null, mult: null, dmg: 0, range: 0, rate: 1, proj: "bullet" }, o);
  }

  const FACTIONS = {
    humans: {
      id: "humans", name: "Terran Accord", short: "HUMANS",
      epithet: "It woke on our watch.",
      color: "#4da9ff", color2: "#ffb454", dark: "#101a2c",
      doctrine: "The Accord holds that the Signal is a warning left for whoever came next — and that means them. They will fortify the Hollow, decode the transmission on human terms, and bury it again if they must. Earth is not a relic. It is home.",
      strengths: ["Cheap, rapid construction", "Engineers repair structures fast", "Flexible, inexpensive infantry"],
      weaknesses: ["Fragile units", "Needs steady Matter income"],
      win: "The Hollow is quiet. The Accord flag stands over the fracture line — but tonight, eleven more signals answered from the far side of the Moon. This was the first hour of a very long war.",
      lose: "The command shelter is gone, and the Hollow belongs to someone else's certainty. Survivors fall back to the coastal line. Earth has not surrendered — it has only lost the first word of the argument.",
      gridRepair: false,
      units: {
        worker: U({ key: "worker", name: "Engineer", art: "h-worker", flavor: "Builds fast, patches faster. The Accord runs on coffee and weld seams.",
          cost: { m: 40 }, time: 7, hp: 50, speed: 80, r: 8, worker: true, carry: 10, htime: 2.6, repair: 16, dmg: 2, range: 16, rate: 0.9, proj: "melee" }),
        scout: U({ key: "scout", name: "Pathfinder Team", art: "h-basic", flavor: "Light recon with long-range optics. It wins fights by not being found first.",
          cost: { m: 35, e: 12 }, time: 8, hp: 42, speed: 138, r: 7, scout: true, dmg: 2, range: 95, rate: 0.85, aggro: 90 }),
        basic: U({ key: "basic", name: "Rifle Team", art: "h-basic", flavor: "Two soldiers, one job: hold the line until the line moves.",
          cost: { m: 45, e: 10 }, time: 8, hp: 70, speed: 78, r: 9, dmg: 5, range: 115, rate: 0.55, aggro: 150 }),
        ranged: U({ key: "ranged", name: "Railgun Rover", art: "h-ranged", flavor: "Light chassis, heavy argument. Strikes armor from a ridge away.",
          cost: { m: 55, e: 40 }, time: 11, hp: 60, speed: 92, r: 11, dmg: 24, range: 195, rate: 1.7, proj: "rail", aggro: 205 }),
        heavy: U({ key: "heavy", name: "Bastion Walker", art: "h-heavy", flavor: "Four legs, one promise: the wall walks with you.",
          cost: { m: 110, e: 60, s: 25 }, time: 18, hp: 300, speed: 46, r: 16, dmg: 20, range: 145, rate: 1.15, splash: 34, proj: "shell", aggro: 175 }),
      },
      buildings: {
        hq: B({ key: "hq", kind: "hq", name: "Command Shelter", art: "h-hq", flavor: "The Accord's forward brain. Lose it, and the Hollow is lost with it.",
          cost: { m: 0 }, time: 1, hp: 1600, r: 46, trains: ["worker", "scout"], dmg: 8, range: 170, rate: 0.9 }),
        extractor: B({ key: "extractor", kind: "extractor", name: "Matter Rig", art: "h-ext", flavor: "Automated extraction rig. Runs on anything, complains about nothing.",
          cost: { m: 55 }, time: 12, hp: 340, r: 22, mult: { m: 1, e: 1, s: 1 } }),
        production: B({ key: "production", kind: "production", name: "Field Barracks", art: "h-prod", flavor: "Prefab walls, permanent resolve.",
          cost: { m: 85, e: 20 }, time: 15, hp: 600, r: 30, trains: ["basic", "ranged", "heavy"] }),
        turret: B({ key: "turret", kind: "turret", name: "Sentry Nest", art: "h-tur", flavor: "It doesn't sleep, so the rifle teams sometimes can.",
          cost: { m: 45, e: 35 }, time: 10, hp: 280, r: 15, dmg: 9, range: 185, rate: 0.8 }),
      },
    },

    robots: {
      id: "robots", name: "The Continuum", short: "ROBOTS",
      epithet: "The instruction is complete.",
      color: "#ff4a57", color2: "#7df3ff", dark: "#180d12",
      doctrine: "The Continuum's networks decoded the Signal in nine seconds: not a warning — an activation order, addressed to any mind precise enough to parse it. The machines do not hate their makers. They simply have new work now.",
      strengths: ["Extractors yield 25% more", "Durable frames", "Units self-repair near the power grid"],
      weaknesses: ["Grid-dependent — slow recovery when structures fall", "Higher Energy costs"],
      win: "Objective complete. The fracture hums at full amplitude, and the Continuum begins to listen in earnest. Somewhere below, something acknowledges receipt — and issues the second instruction.",
      lose: "Grid collapse. The network sheds this node and withdraws into the dark fiber beneath the continents. The instruction remains unexecuted. The Continuum is patient in ways flesh and stone are not.",
      gridRepair: true,
      units: {
        worker: U({ key: "worker", name: "Fabricator", art: "r-worker", flavor: "It does not rest between tasks. There is no between tasks.",
          cost: { m: 45 }, time: 9, hp: 65, speed: 62, r: 9, worker: true, carry: 10, htime: 2.8, repair: 7, dmg: 2, range: 16, rate: 0.9, proj: "melee" }),
        scout: U({ key: "scout", name: "Survey Needle", art: "r-worker", flavor: "A thin machine built to map risk before the network spends bodies.",
          cost: { m: 40, e: 18 }, time: 9, hp: 58, speed: 128, r: 7, scout: true, dmg: 3, range: 70, rate: 0.75, proj: "arc", aggro: 80 }),
        basic: U({ key: "basic", name: "Cutter Drone", art: "r-basic", flavor: "Close-range shear drone. Efficient beyond argument.",
          cost: { m: 40, e: 25 }, time: 9, hp: 95, speed: 96, r: 9, dmg: 6, range: 30, rate: 0.5, proj: "melee", aggro: 145 }),
        ranged: U({ key: "ranged", name: "Arc Walker", art: "r-ranged", flavor: "Walks the grid's edge and carries the grid's anger.",
          cost: { m: 60, e: 50 }, time: 12, hp: 130, speed: 60, r: 12, dmg: 13, range: 150, rate: 1.0, proj: "arc", aggro: 180 }),
        heavy: U({ key: "heavy", name: "Prime Platform", art: "r-heavy", flavor: "When the network must be certain, it sends a Prime.",
          cost: { m: 130, e: 95, s: 30 }, time: 21, hp: 420, speed: 40, r: 17, dmg: 28, range: 165, rate: 1.5, splash: 26, proj: "plasma", aggro: 190 }),
      },
      buildings: {
        hq: B({ key: "hq", kind: "hq", name: "Network Core", art: "r-hq", flavor: "The local mind. Sever it and the grid goes quiet.",
          cost: { m: 0 }, time: 1, hp: 1750, r: 46, trains: ["worker", "scout"], dmg: 9, range: 165, rate: 1.0, proj: "arc" }),
        extractor: B({ key: "extractor", kind: "extractor", name: "Extractor Array", art: "r-ext", flavor: "Consumption scheduled to the millisecond. The ground never noticed.",
          cost: { m: 65 }, time: 14, hp: 380, r: 22, mult: { m: 1.25, e: 1.25, s: 1.1 } }),
        production: B({ key: "production", kind: "production", name: "Assembly Node", art: "r-prod", flavor: "Where the Continuum multiplies.",
          cost: { m: 100, e: 30 }, time: 17, hp: 650, r: 30, trains: ["basic", "ranged", "heavy"] }),
        turret: B({ key: "turret", kind: "turret", name: "Pulse Tower", art: "r-tur", flavor: "Overwatch, resolved to a single bright line.",
          cost: { m: 55, e: 45 }, time: 12, hp: 320, r: 15, dmg: 11, range: 175, rate: 0.95, proj: "arc" }),
      },
    },

    aliens: {
      id: "aliens", name: "Vessari Remnant", short: "ALIENS",
      epithet: "We did not come to conquer. We came to remember.",
      color: "#b06cff", color2: "#7dff9a", dark: "#1a1030",
      doctrine: "The Vessari fleets crossed forty centuries of dark to answer a voice they thought extinguished. Beneath the Hollow lies the foundation-stone of their first civilization. They will hold it — gently if permitted, absolutely if not.",
      strengths: ["Regenerating shields on every unit", "Elite, hard-hitting units", "Superior Signal attunement"],
      weaknesses: ["Costly units, few bodies early", "Slower economy"],
      win: "The foundation-stone answers our song for the first time in four thousand years. The Remnant kneels in the dust of the Hollow. What sleeps below is not ours — it is us. And it is almost awake.",
      lose: "The Remnant withdraws beyond the sky, carrying its dead. The Signal still calls, and the Vessari have crossed greater dark for smaller reasons. This world has not seen the last of its first people.",
      gridRepair: false,
      units: {
        worker: U({ key: "worker", name: "Shaper", art: "a-worker", flavor: "It sings to matter, and matter remembers its old shapes.",
          cost: { m: 50 }, time: 10, hp: 55, shield: 25, speed: 58, r: 9, worker: true, carry: 14, htime: 3.0, repair: 8, dmg: 2, range: 16, rate: 0.9, proj: "melee" }),
        scout: U({ key: "scout", name: "Veil Seer", art: "a-ranged", flavor: "It does not look through the dark. It remembers what the dark is hiding.",
          cost: { m: 48, e: 22, s: 2 }, time: 10, hp: 42, shield: 34, speed: 132, r: 7, scout: true, dmg: 3, range: 100, rate: 0.95, proj: "psi", aggro: 90 }),
        basic: U({ key: "basic", name: "Needle Wraith", art: "a-basic", flavor: "A sliver of the old war, still sharp.",
          cost: { m: 55, e: 30 }, time: 11, hp: 60, shield: 40, speed: 100, r: 9, dmg: 5, range: 95, rate: 0.42, proj: "needle", aggro: 150 }),
        ranged: U({ key: "ranged", name: "Rift Seer", art: "a-ranged", flavor: "It watches from a half-step outside the world.",
          cost: { m: 85, e: 55, s: 8 }, time: 14, hp: 75, shield: 55, speed: 56, r: 12, dmg: 15, range: 185, rate: 1.15, proj: "psi", aggro: 200 }),
        heavy: U({ key: "heavy", name: "Titan Bloom", art: "a-heavy", flavor: "The Vessari do not build weapons. They grow reminders.",
          cost: { m: 140, e: 100, s: 40 }, time: 23, hp: 330, shield: 130, speed: 44, r: 18, dmg: 30, range: 150, rate: 1.5, splash: 40, proj: "spore", aggro: 180 }),
      },
      buildings: {
        hq: B({ key: "hq", kind: "hq", name: "Signal Heart", art: "a-hq", flavor: "The Remnant's covenant with the buried voice.",
          cost: { m: 0 }, time: 1, hp: 1700, r: 46, trains: ["worker", "scout"], dmg: 10, range: 175, rate: 1.1, proj: "psi" }),
        extractor: B({ key: "extractor", kind: "extractor", name: "Root Harvester", art: "a-ext", flavor: "Roots older than the soil they drink.",
          cost: { m: 60 }, time: 15, hp: 350, r: 22, mult: { m: 1, e: 1, s: 1.3 } }),
        production: B({ key: "production", kind: "production", name: "Spawning Veil", art: "a-prod", flavor: "A membrane between here and the remembering place.",
          cost: { m: 105, e: 35 }, time: 19, hp: 620, r: 30, trains: ["basic", "ranged", "heavy"] }),
        turret: B({ key: "turret", kind: "turret", name: "Prism Spire", art: "a-tur", flavor: "Grief, focused to a point of light.",
          cost: { m: 60, e: 50 }, time: 13, hp: 300, r: 15, dmg: 14, range: 190, rate: 1.2, proj: "psi" }),
      },
    },
  };
  const FACTION_IDS = ["humans", "robots", "aliens"];

  // Online 1v1: puppet (remote team) unit/building ids are offset well clear of
  // any realistic local nextId range so they can share state.units/state.buildings
  // with real objects without ever colliding.
  const NET_ID_OFFSET = 1e9;
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ==================================================
     5. GAME STATE
     ================================================== */
  const state = {
    phase: "menu",       // menu | select | playing | over
    paused: false,
    time: 0,             // sim clock
    vt: 0,               // visual clock (always runs)
    teams: [],           // [0]=player, [1..3]=AI
    units: [],
    buildings: [],
    nodes: [],
    obstacles: [],       // impassable mountain circles (collision + nav)
    mountains: [],       // render groups of obstacle circles
    rocks: [],           // destructible rock barriers
    projectiles: [],
    beams: [],
    particles: [],
    commandFx: [],
    decals: [],
    vision: [],
    selection: [],
    selVersion: 0,
    placing: null,       // {def, x, y, node, valid}
    armed: null,         // 'attack' | null (command armed from a button)
    cam: { x: 320, y: 280 },
    result: null,        // {winnerTeam, }
    stats: { kills: 0, losses: 0 },
    best: 0,
    alarmT: -99,
    alarmPos: null,
    pick: null,          // faction id chosen on select screen
    pendingEnemies: null, // faction ids rolled for the AI teams
    opts: { enemies: 1, difficulty: "normal", mapReveal: true }, // skirmish setup (persists between rounds)
    setup: null,         // {difficulty, enemyCount} for the running match
    hint: "",
  };
  let nextId = 1;

  function playerTeam() { return state.teams[0] || null; }
  function enemyTeams() { return state.teams.filter((t) => t.idx !== 0 && !t.eliminated); }
  function aiTeam() { return enemyTeams()[0] || null; }

  function makeTeam(idx, factionId, isAI, diff) {
    const bonus = isAI && diff ? diff.startBonus : { m: 0, e: 0 };
    return {
      idx, isAI,
      faction: FACTIONS[factionId],
      res: { m: 150 + (bonus.m || 0), e: 60 + (bonus.e || 0), s: 0 },
      income: isAI && diff ? diff.income : 1,
      eliminated: false,
      ai: null,
      hqId: 0,
    };
  }

  /* ==================================================
     6. WORLD / MAP
     ================================================== */
  // 4-fold map symmetry: template points live in the bottom-left quadrant and
  // are stamped into all four corners so up to 4 commanders start fair.
  const SYM = [
    (x, y) => ({ x, y }),                           // bottom-left (player)
    (x, y) => ({ x: WORLD_W - x, y: WORLD_H - y }), // top-right
    (x, y) => ({ x: WORLD_W - x, y }),              // bottom-right
    (x, y) => ({ x, y: WORLD_H - y }),              // top-left
  ];
  function symPoints(x, y) {
    const out = [];
    for (const t of SYM) {
      const p = t(x, y);
      if (!out.some((q) => Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2)) out.push(p);
    }
    return out;
  }
  function addSymNode(kind, x, y, amount) {
    symPoints(x, y).forEach((p) => addNode(kind, p.x, p.y, amount));
  }
  function addSymCluster(kind, cx, cy, offsets, amount) {
    symPoints(cx, cy).forEach((p) => addCluster(kind, p.x, p.y, offsets, amount));
  }

  function clearOfLandmarks(x, y, r, hqClear) {
    for (const hq of HQ_POS) if (d2(x, y, hq.x, hq.y) < hqClear * hqClear) return false;
    for (const n of state.nodes) {
      const cl = n.r + r + 40;
      if (d2(x, y, n.x, n.y) < cl * cl) return false;
    }
    return true;
  }
  // mountain range: a spine polyline filled with overlapping impassable circles
  function addRange(spine, r) {
    const circles = [];
    const place = (x, y, rr) => {
      if (x < 40 || y < 40 || x > WORLD_W - 40 || y > WORLD_H - 40) return;
      if (!clearOfLandmarks(x, y, rr, 340)) return;
      const c = { x, y, r: rr, seed: rand(0, TAU) };
      circles.push(c);
      state.obstacles.push(c);
    };
    if (spine.length === 1) {
      place(spine[0][0], spine[0][1], r);
    } else {
      for (let s = 0; s < spine.length - 1; s++) {
        const [x1, y1] = spine[s], [x2, y2] = spine[s + 1];
        const steps = Math.max(1, Math.round(dist(x1, y1, x2, y2) / (r * 0.75)));
        for (let i = s === 0 ? 0 : 1; i <= steps; i++) {
          const t = i / steps;
          const j = i === 0 || i === steps ? 0 : r * 0.2;
          place(lerp(x1, x2, t) + rand(-j, j), lerp(y1, y2, t) + rand(-j, j), r * rand(0.82, 1.12));
        }
      }
    }
    if (circles.length) state.mountains.push({ circles });
  }
  function addSymRange(spine, r) {
    const seen = [];
    for (const T of SYM) {
      const pts = spine.map(([x, y]) => { const p = T(x, y); return [p.x, p.y]; });
      const a = pts[0], b = pts[pts.length - 1];
      const near = (p, q) => Math.abs(p[0] - q[0]) < 3 && Math.abs(p[1] - q[1]) < 3;
      if (seen.some(([sa, sb]) => (near(sa, a) && near(sb, b)) || (near(sa, b) && near(sb, a)))) continue;
      seen.push([a, b]);
      addRange(pts, r);
    }
  }
  // destructible rock barrier — attack it to open the route
  function addBoulder(x, y, r) {
    if (!clearOfLandmarks(x, y, r, 320)) return;
    const hp = Math.round(r * 9);
    state.rocks.push({ id: nextId++, kind: "rock", x, y, r, hp, maxHp: hp, seed: rand(0, TAU), lastHit: -99, dead: false });
  }
  function addSymBoulder(x, y, r) {
    symPoints(x, y).forEach((p) => addBoulder(p.x, p.y, r));
  }

  /* ---- navigation grid + A* over mountains and live rock barriers ---- */
  const NAV_CELL = 40;
  const NAV_COLS = Math.ceil(WORLD_W / NAV_CELL);
  const NAV_ROWS = Math.ceil(WORLD_H / NAV_CELL);
  const NAV_TOTAL = NAV_COLS * NAV_ROWS;
  const navBlocked = new Uint8Array(NAV_TOTAL);
  const navG = new Float64Array(NAV_TOTAL);
  const navF = new Float64Array(NAV_TOTAL);
  const navFrom = new Int32Array(NAV_TOTAL);
  const navSeen = new Int32Array(NAV_TOTAL);
  const navDone = new Int32Array(NAV_TOTAL);
  const navHeap = [];
  let navGen = 0;
  let navQuota = 8; // A* budget per sim tick so big group orders stay smooth

  function navCellX(x) { return clamp(Math.floor(x / NAV_CELL), 0, NAV_COLS - 1); }
  function navCellY(y) { return clamp(Math.floor(y / NAV_CELL), 0, NAV_ROWS - 1); }

  function buildNavGrid() {
    navBlocked.fill(0);
    const mark = (o) => {
      const rr = o.r + 14;
      const x0 = navCellX(o.x - rr), x1 = navCellX(o.x + rr);
      const y0 = navCellY(o.y - rr), y1 = navCellY(o.y + rr);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const px = cx * NAV_CELL + NAV_CELL / 2, py = cy * NAV_CELL + NAV_CELL / 2;
          if (d2(px, py, o.x, o.y) < rr * rr) navBlocked[cy * NAV_COLS + cx] = 1;
        }
      }
    };
    for (const o of state.obstacles) mark(o);
    for (const rk of state.rocks) if (!rk.dead) mark(rk);
  }

  function navFreeCellNear(cx, cy) {
    if (!navBlocked[cy * NAV_COLS + cx]) return { cx, cy };
    for (let ring = 1; ring <= 7; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= NAV_COLS || ny >= NAV_ROWS) continue;
          if (!navBlocked[ny * NAV_COLS + nx]) return { cx: nx, cy: ny };
        }
      }
    }
    return null;
  }

  function navLineFree(x0, y0, x1, y1) {
    const steps = Math.max(1, Math.ceil(dist(x0, y0, x1, y1) / (NAV_CELL * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (navBlocked[navCellY(lerp(y0, y1, t)) * NAV_COLS + navCellX(lerp(x0, x1, t))]) return false;
    }
    return true;
  }

  function heapPush(idx) {
    navHeap.push(idx);
    let i = navHeap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (navF[navHeap[p]] <= navF[navHeap[i]]) break;
      const tmp = navHeap[p]; navHeap[p] = navHeap[i]; navHeap[i] = tmp;
      i = p;
    }
  }
  function heapPop() {
    const top = navHeap[0];
    const last = navHeap.pop();
    if (navHeap.length) {
      navHeap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < navHeap.length && navF[navHeap[l]] < navF[navHeap[m]]) m = l;
        if (r < navHeap.length && navF[navHeap[r]] < navF[navHeap[m]]) m = r;
        if (m === i) break;
        const tmp = navHeap[m]; navHeap[m] = navHeap[i]; navHeap[i] = tmp;
        i = m;
      }
    }
    return top;
  }

  function findPath(sx, sy, tx, ty) {
    const sc = navFreeCellNear(navCellX(sx), navCellY(sy));
    const tc = navFreeCellNear(navCellX(tx), navCellY(ty));
    if (!sc || !tc) return null;
    const startI = sc.cy * NAV_COLS + sc.cx;
    const goalI = tc.cy * NAV_COLS + tc.cx;
    if (startI === goalI) return [];
    navGen++;
    navHeap.length = 0;
    navG[startI] = 0;
    navF[startI] = 0;
    navSeen[startI] = navGen;
    navFrom[startI] = -1;
    heapPush(startI);
    const gx = tc.cx, gy = tc.cy;
    let found = false, guard = 24000;
    while (navHeap.length && guard-- > 0) {
      const cur = heapPop();
      if (navDone[cur] === navGen) continue;
      navDone[cur] = navGen;
      if (cur === goalI) { found = true; break; }
      const cx = cur % NAV_COLS, cy = (cur / NAV_COLS) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= NAV_COLS || ny >= NAV_ROWS) continue;
          const ni = ny * NAV_COLS + nx;
          if (navBlocked[ni] || navDone[ni] === navGen) continue;
          // no corner cutting through diagonal gaps
          if (dx && dy && (navBlocked[cy * NAV_COLS + nx] || navBlocked[ny * NAV_COLS + cx])) continue;
          const g = navG[cur] + (dx && dy ? 1.41421 : 1);
          if (navSeen[ni] === navGen && g >= navG[ni]) continue;
          navSeen[ni] = navGen;
          navG[ni] = g;
          navFrom[ni] = cur;
          const hx = Math.abs(nx - gx), hy = Math.abs(ny - gy);
          navF[ni] = g + Math.max(hx, hy) + 0.41421 * Math.min(hx, hy);
          heapPush(ni);
        }
      }
    }
    if (!found) return null;
    const pts = [];
    let cur = goalI;
    while (cur !== -1 && cur !== startI) {
      pts.push({ x: (cur % NAV_COLS) * NAV_CELL + NAV_CELL / 2, y: ((cur / NAV_COLS) | 0) * NAV_CELL + NAV_CELL / 2 });
      cur = navFrom[cur];
    }
    pts.reverse();
    return pts;
  }

  function smoothPath(pts, sx, sy) {
    if (!pts.length) return pts;
    const out = [];
    let cx = sx, cy = sy, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      for (; j > i; j--) if (navLineFree(cx, cy, pts[j].x, pts[j].y)) break;
      out.push(pts[j]);
      cx = pts[j].x; cy = pts[j].y;
      i = j + 1;
    }
    return out;
  }
  function scarPath() {
    return [
      [CENTER.x - 720, CENTER.y + 520],
      [CENTER.x - 430, CENTER.y + 255],
      [CENTER.x - 150, CENTER.y + 82],
      [CENTER.x, CENTER.y],
      [CENTER.x + 145, CENTER.y - 76],
      [CENTER.x + 405, CENTER.y - 260],
      [CENTER.x + 720, CENTER.y - 520],
    ];
  }

  function addNode(kind, x, y, amount) {
    state.nodes.push({
      id: nextId++, kind, x, y,
      r: kind === "matter" ? 15 : kind === "energy" ? 21 : 19,
      amount, rig: null, team: null,
      hp: 0, maxHp: NODE_CLAIM_HP[kind] || 150,
      claimTeam: null, claimProgress: 0,
      lastHit: -99, seed: Math.random() * TAU,
    });
  }
  function addCluster(kind, cx, cy, offsets, amount) {
    offsets.forEach(([ox, oy]) => addNode(kind, cx + ox, cy + oy, amount));
  }

  const HQ_BASE = { x: 620, y: WORLD_H - 620 };
  const HQ_POS = SYM.map((t) => t(HQ_BASE.x, HQ_BASE.y)); // [player BL, TR, BR, TL]

  function initWorld() {
    state.nodes = [];
    state.obstacles = [];
    state.mountains = [];
    state.rocks = [];
    const richOffs = [[0, 0], [54, -30], [-48, 34], [42, 50], [-36, -54], [86, 18]];
    const fieldOffs = [[0, 0], [64, -26], [-58, 42], [50, 60], [-44, -62]];

    // matter fields (stamped into every corner): safe start, flank, forward, mid, center-side
    addSymCluster("matter", HQ_BASE.x - 145, HQ_BASE.y - 330, richOffs, 1900);
    addSymCluster("matter", HQ_BASE.x + 360, HQ_BASE.y + 270, fieldOffs, 1500);
    addSymCluster("matter", 1120, WORLD_H - 1030, fieldOffs, 1750);
    addSymCluster("matter", 1620, WORLD_H - 1400, fieldOffs.slice(0, 4), 1650);
    addSymCluster("matter", 860, CENTER.y - 260, fieldOffs.slice(0, 4), 1450);

    // energy vents (infinite geothermal)
    addSymNode("energy", HQ_BASE.x + 245, HQ_BASE.y + 255, Infinity);
    addSymNode("energy", HQ_BASE.x + 740, HQ_BASE.y - 70, Infinity);
    addSymNode("energy", 620, CENTER.y - 350, Infinity);

    // signal fractures: contested center ring + forward node + mid ring
    addNode("signal", CENTER.x, CENTER.y, Infinity);
    addSymNode("signal", CENTER.x - 185, CENTER.y + 120, Infinity);
    addSymNode("signal", HQ_BASE.x + 560, HQ_BASE.y - 700, Infinity);
    addSymNode("signal", 1330, 1120, Infinity);

    // mountain ranges — impassable, path around or find the pass
    addSymRange([[1230, 2748], [1360, 2610], [1480, 2438]], 56); // corner shield NE of each HQ
    addSymRange([[1720, 2150], [1960, 1900]], 54);               // mid approach ridge
    addSymRange([[1560, 1180], [1730, 1065]], 52);               // center bastion
    addSymRange([[235, 1785], [300, 1620]], 56);                 // coast band (west/east edges)
    addSymRange([[1800, 2845], [1985, 2880]], 54);               // edge band (bottom/top)
    addSymRange([[760, 1890]], 46);                              // lone peak
    addSymRange([[2100, 2350]], 50);                             // lone peak on the south axis

    // destructible rock barriers — breach them to open shortcuts
    addSymBoulder(300, 1500, 34);  // inland pass plug (west/east mid-map)
    addSymBoulder(150, 1500, 40);  // coast plug
    addSymBoulder(60, 1500, 40);
    addSymBoulder(2100, 2880, 40); // bottom/top center pass plug
    addSymBoulder(2100, 2960, 38);
    addSymBoulder(1445, 1985, 30); // forward-field cover rocks
    addSymBoulder(1500, 2062, 26);

    buildNavGrid();
    buildTerrain();
  }

  /* ==================================================
     7. ENTITY FACTORIES + QUERIES
     ================================================== */
  function makeUnit(team, def, x, y) {
    const u = {
      id: nextId++, kind: "unit", team, fid: team.faction.id, def,
      x, y, face: rand(0, TAU),
      hp: def.hp, maxHp: def.hp,
      shield: def.shield, maxShield: def.shield,
      state: "idle", ox: x, oy: y, attackMove: false, rx: null, ry: null,
      target: null, node: null, carry: 0, htimer: 0, nav: null,
      cool: 0, acqT: rand(0, 0.3), lastHit: -99, slowT: 0,
      bob: rand(0, TAU), dead: false,
    };
    state.units.push(u);
    return u;
  }

  function makeBuilding(team, def, x, y, node, prebuilt) {
    const b = {
      id: nextId++, kind: "building", team, fid: team.faction.id, def,
      x, y,
      hp: prebuilt ? def.hp : def.hp * 0.1, maxHp: def.hp,
      built: !!prebuilt, progress: prebuilt ? 1 : 0,
      queue: [], rally: null, node: node || null,
      cool: 0, acqT: rand(0, 0.3), face: 0, lastHit: -99, dead: false,
      dry: false,
    };
    if (node) node.rig = b.id;
    if (def.kind === "hq" || def.kind === "production") {
      const toC = Math.atan2(CENTER.y - y, CENTER.x - x);
      b.rally = { x: x + Math.cos(toC) * (def.r + 70), y: y + Math.sin(toC) * (def.r + 70) };
    }
    state.buildings.push(b);
    return b;
  }

  function teamHQ(team) {
    return state.buildings.find((b) => b.team === team && b.def.kind === "hq" && !b.dead) || null;
  }
  function teamUnits(team) { return state.units.filter((u) => u.team === team && !u.dead); }
  function teamMilitary(team) { return state.units.filter((u) => u.team === team && !u.dead && !u.def.worker); }
  function teamBuildings(team) { return state.buildings.filter((b) => b.team === team && !b.dead); }

  function nearestEnemyThing(team, x, y, range, unitsOnly) {
    let best = null, bd = range * range;
    for (const u of state.units) {
      if (u.dead || u.team === team) continue;
      const dd = d2(x, y, u.x, u.y);
      if (dd < bd) { bd = dd; best = u; }
    }
    if (!best && !unitsOnly) {
      bd = range * range;
      for (const b of state.buildings) {
        if (b.dead || b.team === team) continue;
        const dd = d2(x, y, b.x, b.y);
        if (dd < bd) { bd = dd; best = b; }
      }
      for (const n of state.nodes) {
        if (!isEnemyClaimedNode(n, team) || n.rig) continue;
        const dd = d2(x, y, n.x, n.y);
        if (dd < bd) { bd = dd; best = n; }
      }
    }
    return best;
  }

  function findMatterNode(u) {
    let best = null, bd = Infinity;
    for (const n of state.nodes) {
      if (n.kind !== "matter" || n.amount <= 0 || n.rig || (n.team && n.team !== u.team)) continue;
      const ownerPenalty = n.team === u.team ? 0 : 900 * 900;
      const dd = d2(u.x, u.y, n.x, n.y) + ownerPenalty;
      if (dd < bd) { bd = dd; best = n; }
    }
    return best;
  }

  function resourceNodeName(n) {
    return `${RES_NAME[NODE_RES[n.kind]]} node`;
  }
  function nodeHasResources(n) {
    return !!(n && (n.amount === Infinity || n.amount > 0));
  }
  function isNodeClaimedBy(n, team) {
    return !!(n && team && n.team === team && n.hp > 0);
  }
  function isEnemyClaimedNode(n, team) {
    return !!(n && team && n.team && n.team !== team && n.hp > 0);
  }
  function canUseNodeForExtractor(team, n) {
    return !!(n && nodeHasResources(n) && !n.rig && isNodeClaimedBy(n, team));
  }
  function claimNode(n, team) {
    if (!n || !team) return false;
    n.team = team;
    n.hp = n.maxHp;
    n.claimTeam = null;
    n.claimProgress = 0;
    n.lastHit = -99;
    spark(n.x, n.y, team.faction.color, 8);
    state.particles.push({ x: n.x, y: n.y, vx: 0, vy: 0, ttl: 0.42, max: 0.42, color: team.faction.color, size: n.r + 12, type: "ring" });
    if (team === playerTeam()) log(`${resourceNodeName(n)} claimed`);
    return true;
  }
  function releaseNode(n, attackerTeam) {
    if (!n || !n.team) return false;
    const oldTeam = n.team;
    n.team = null;
    n.hp = 0;
    n.claimTeam = null;
    n.claimProgress = 0;
    n.lastHit = state.time;
    if (oldTeam === playerTeam()) log(`${resourceNodeName(n)} claim destroyed`);
    else if (attackerTeam === playerTeam()) log(`Enemy ${resourceNodeName(n)} unclaimed`);
    return true;
  }

  function thingAt(wx, wy) {
    // units first (small pick radius), then buildings, then nodes
    let best = null, bd = Infinity;
    for (const u of state.units) {
      if (u.dead) continue;
      const dd = d2(wx, wy, u.x, u.y), rr = (u.def.r + 8) * (u.def.r + 8);
      if (dd < rr && dd < bd) { bd = dd; best = u; }
    }
    if (best) return best;
    for (const b of state.buildings) {
      if (b.dead) continue;
      if (d2(wx, wy, b.x, b.y) < b.def.r * b.def.r) return b;
    }
    for (const rk of state.rocks) {
      if (rk.dead) continue;
      if (d2(wx, wy, rk.x, rk.y) < (rk.r + 6) * (rk.r + 6)) return rk;
    }
    for (const n of state.nodes) {
      if (d2(wx, wy, n.x, n.y) < (n.r + 8) * (n.r + 8)) return n;
    }
    return null;
  }

  /* ==================================================
     8. ORDERS
     ================================================== */
  function selUnits() {
    const pt = playerTeam();
    return state.selection.filter((o) => o.kind === "unit" && o.team === pt && !o.dead);
  }
  function selWorkers() { return selUnits().filter((u) => u.def.worker); }

  function formationOffsets(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, r = 15 * Math.sqrt(i);
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
  }

  function orderMove(units, x, y, attackMove) {
    const offs = formationOffsets(units.length);
    units.forEach((u, i) => {
      u.state = "move";
      u.ox = clamp(x + offs[i][0], 20, WORLD_W - 20);
      u.oy = clamp(y + offs[i][1], 20, WORLD_H - 20);
      u.attackMove = !!attackMove;
      u.rx = attackMove ? u.ox : null;
      u.ry = attackMove ? u.oy : null;
      u.target = null; u.node = null; u.htimer = 0;
    });
  }
  function orderAttack(units, target) {
    units.forEach((u) => { u.state = "attack"; u.target = target; u.attackMove = false; u.rx = null; u.node = null; });
  }
  function orderHarvest(workers, node) {
    workers.forEach((u) => { u.node = node; u.htimer = 0; u.state = u.carry > 0 ? "return" : "harvest"; u.target = null; });
  }
  function orderClaim(units, node) {
    units.forEach((u) => {
      u.state = "claim";
      u.target = node;
      u.node = node;
      u.htimer = 0;
      u.attackMove = false;
      u.rx = null;
      u.ry = null;
    });
  }
  function orderRepair(workers, b) {
    workers.forEach((u) => { u.state = "repair"; u.target = b; u.node = null; });
  }
  function orderStop(units) {
    units.forEach((u) => { u.state = "idle"; u.target = null; u.attackMove = false; u.rx = null; u.htimer = 0; });
  }

  function isResourceNode(o) {
    return !!(o && state.nodes.includes(o));
  }
  function isFriendlyRepairTarget(o) {
    return !!(
      o &&
      (o.kind === "unit" || o.kind === "building") &&
      o.team === playerTeam() &&
      o.hp < o.maxHp &&
      (o.kind === "unit" || o.built)
    );
  }
  function commandPreviewAt(wx, wy) {
    if (state.phase !== "playing" || state.paused || state.placing) return null;
    const pt = playerTeam();
    const units = selUnits();
    const workers = units.filter((u) => u.def.worker);
    const combat = units.filter((u) => !u.def.worker);
    const hit = thingAt(wx, wy);
    if (state.armed === "attack" && combat.length) {
      if (hit && ((hit.kind === "unit" || hit.kind === "building") && hit.team !== pt || hit.kind === "rock")) {
        return { type: hit.kind === "rock" ? "breach" : "attack", x: hit.x, y: hit.y, target: hit };
      }
      return { type: "attackMove", x: wx, y: wy };
    }
    if (!units.length) {
      const sel = state.selection;
      if (sel.length === 1 && sel[0].kind === "building" && sel[0].team === pt && sel[0].def.trains && !hit) {
        return { type: "rally", x: wx, y: wy };
      }
      return null;
    }
    if (hit && hit.kind === "rock") {
      return { type: "breach", x: hit.x, y: hit.y, target: hit };
    }
    if (hit && (hit.kind === "unit" || hit.kind === "building")) {
      if (hit.team !== pt) return { type: "attack", x: hit.x, y: hit.y, target: hit };
      if (workers.length && isFriendlyRepairTarget(hit)) return { type: "repair", x: hit.x, y: hit.y, target: hit };
      return { type: "move", x: wx, y: wy };
    }
    if (isResourceNode(hit)) {
      if (isEnemyClaimedNode(hit, pt)) return { type: "attack", x: hit.x, y: hit.y, target: hit };
      if (!hit.team && units.length && nodeHasResources(hit)) return { type: "claim", x: hit.x, y: hit.y, target: hit };
      if (workers.length && isNodeClaimedBy(hit, pt) && hit.kind === "matter" && !hit.rig && hit.amount > 0) {
        return { type: "gather", x: hit.x, y: hit.y, target: hit };
      }
      return units.length ? { type: "move", x: wx, y: wy } : null;
    }
    return { type: "move", x: wx, y: wy };
  }
  function addCommandFx(type, x, y) {
    if (!COMMAND_HINTS[type]) return;
    state.commandFx.push({ type, x, y, ttl: 0.68, max: 0.68, seed: Math.random() * TAU });
    if (state.commandFx.length > 28) state.commandFx.shift();
  }

  /* ==================================================
     9. SIM — units
     ================================================== */
  function moveStraight(u, tx, ty, dt) {
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return true;
    const spd = u.def.speed * (u.slowT > 0 ? 0.7 : 1);
    const step = Math.min(spd * dt, d);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    u.face = Math.atan2(dy, dx);
    return d - step < 4;
  }

  function planPath(u, tx, ty) {
    const nav = { tx, ty, path: null, i: 0, age: 0, stuckT: 0, px: u.x, py: u.y, pending: false, noPathT: 0 };
    if (navLineFree(u.x, u.y, tx, ty)) return nav;      // straight shot — no search needed
    if (navQuota <= 0) { nav.pending = true; return nav; } // out of budget this tick, retry shortly
    navQuota--;
    const raw = findPath(u.x, u.y, tx, ty);
    if (raw) nav.path = smoothPath(raw, u.x, u.y);
    else nav.noPathT = 3; // unreachable — don't burn A* on it for a while
    return nav;
  }

  // path-aware movement: follows A* waypoints around mountains/rocks, replans
  // when the goal drifts, and self-recovers when physically stuck.
  function moveUnit(u, tx, ty, dt) {
    let nav = u.nav;
    if (nav) {
      nav.age += dt;
      if (nav.pending && nav.age > 0.15) nav = null;
      else if (nav.noPathT <= 0 && nav.age > 0.45 && d2(nav.tx, nav.ty, tx, ty) > 70 * 70) nav = null;
      else if (nav && nav.noPathT > 0) nav.noPathT -= dt;
    }
    if (!nav) nav = u.nav = planPath(u, tx, ty);

    let wx = tx, wy = ty, onPath = false;
    if (nav.path && nav.i < nav.path.length) {
      let w = nav.path[nav.i];
      if (d2(u.x, u.y, w.x, w.y) < 22 * 22) { nav.i++; w = nav.path[nav.i]; }
      if (w) { wx = w.x; wy = w.y; onPath = true; }
    }
    const arrived = moveStraight(u, wx, wy, dt);

    // stuck recovery: no real progress while trying to move → replan
    if (d2(u.x, u.y, nav.px, nav.py) < 4) {
      nav.stuckT += dt;
      if (nav.stuckT > 0.85 && nav.noPathT <= 0) {
        u.nav = planPath(u, tx, ty);
        u.nav.stuckT = -rand(0, 0.35);
      }
    } else {
      nav.stuckT = 0;
      nav.px = u.x; nav.py = u.y;
    }
    return !onPath && arrived;
  }

  function afterTarget(u) {
    u.target = null;
    if (u.rx != null) { u.state = "move"; u.ox = u.rx; u.oy = u.ry; u.attackMove = true; }
    else u.state = "idle";
  }

  function updateUnit(u, dt) {
    u.cool -= dt;
    if (u.slowT > 0) u.slowT -= dt;

    switch (u.state) {
      case "idle": {
        if (u.def.aggro > 0) {
          u.acqT -= dt;
          if (u.acqT <= 0) {
            u.acqT = 0.3;
            const e = nearestEnemyThing(u.team, u.x, u.y, u.def.aggro);
            if (e) { u.target = e; u.state = "attack"; }
          }
        }
        break;
      }
      case "move": {
        const arrived = moveUnit(u, u.ox, u.oy, dt);
        if (u.attackMove && u.def.aggro > 0) {
          u.acqT -= dt;
          if (u.acqT <= 0) {
            u.acqT = 0.25;
            const e = nearestEnemyThing(u.team, u.x, u.y, u.def.aggro);
            if (e) { u.target = e; u.state = "attack"; break; }
          }
        }
        if (arrived) { u.state = "idle"; u.attackMove = false; u.rx = null; }
        break;
      }
      case "attack": {
        const t = u.target;
        if (!t || t.dead) { afterTarget(u); break; }
        if (isResourceNode(t) && !isEnemyClaimedNode(t, u.team)) { afterTarget(u); break; }
        const range = u.def.range + (t.def ? t.def.r : t.r || 10);
        const d = dist(u.x, u.y, t.x, t.y);
        if (d > range) moveUnit(u, t.x, t.y, dt);
        else {
          u.face = Math.atan2(t.y - u.y, t.x - u.x);
          if (u.cool <= 0) { fire(u, t); u.cool = u.def.rate; }
        }
        break;
      }
      case "harvest": {
        let n = u.node;
        if (!n || n.amount <= 0 || (n.rig && n.rig !== null) || (n.team && n.team !== u.team)) {
          u.node = n = findMatterNode(u);
          if (!n) { u.state = "idle"; break; }
        }
        if (!isNodeClaimedBy(n, u.team)) {
          orderClaim([u], n);
          break;
        }
        const d = dist(u.x, u.y, n.x, n.y);
        if (d > n.r + u.def.r + 5) { moveUnit(u, n.x, n.y, dt); u.htimer = 0; }
        else {
          u.face = Math.atan2(n.y - u.y, n.x - u.x);
          u.htimer += dt;
          if (u.htimer >= u.def.htime) {
            u.htimer = 0;
            const take = Math.min(u.def.carry, n.amount);
            n.amount -= take;
            u.carry = take;
            u.state = "return";
          }
        }
        break;
      }
      case "return": {
        const hq = teamHQ(u.team);
        if (!hq) { u.state = "idle"; break; }
        if (dist(u.x, u.y, hq.x, hq.y) <= hq.def.r + u.def.r + 8) {
          u.team.res.m += u.carry * (u.team.income || 1);
          u.carry = 0;
          if (!u.node || u.node.amount <= 0 || u.node.rig) u.node = findMatterNode(u);
          u.state = u.node ? "harvest" : "idle";
        } else moveUnit(u, hq.x, hq.y, dt);
        break;
      }
      case "claim": {
        const n = u.node || u.target;
        if (!n || !nodeHasResources(n) || n.rig) { u.state = "idle"; u.target = null; u.node = null; break; }
        if (isNodeClaimedBy(n, u.team)) {
          if (u.def.worker && n.kind === "matter" && !n.rig && n.amount > 0) orderHarvest([u], n);
          else { u.state = "idle"; u.target = null; u.node = null; }
          break;
        }
        if (isEnemyClaimedNode(n, u.team)) {
          u.state = "attack";
          u.target = n;
          u.node = null;
          break;
        }
        const d = dist(u.x, u.y, n.x, n.y);
        if (d > n.r + u.def.r + 7) { moveUnit(u, n.x, n.y, dt); u.htimer = 0; }
        else {
          u.face = Math.atan2(n.y - u.y, n.x - u.x);
          if (n.claimTeam !== u.team) {
            n.claimTeam = u.team;
            n.claimProgress = 0;
          }
          n.claimProgress = Math.min(CLAIM_TIME, n.claimProgress + dt);
          if (Math.random() < dt * 7) spark(n.x + rand(-n.r, n.r) * 0.5, n.y + rand(-n.r, n.r) * 0.5, u.team.faction.color, 1);
          if (n.claimProgress >= CLAIM_TIME && claimNode(n, u.team)) {
            if (u.def.worker && n.kind === "matter" && !n.rig && n.amount > 0) orderHarvest([u], n);
            else { u.state = "idle"; u.target = null; u.node = null; }
          }
        }
        break;
      }
      case "repair": {
        const t = u.target;
        if (!t || t.dead || t.hp >= t.maxHp) { u.state = "idle"; u.target = null; break; }
        const d = dist(u.x, u.y, t.x, t.y);
        if (d > t.def.r + u.def.r + 10) moveUnit(u, t.x, t.y, dt);
        else {
          u.face = Math.atan2(t.y - u.y, t.x - u.x);
          t.hp = Math.min(t.maxHp, t.hp + u.def.repair * dt);
          if (Math.random() < dt * 8) spark(t.x + rand(-t.def.r, t.def.r) * 0.6, t.y + rand(-t.def.r, t.def.r) * 0.6, "#9fe8ff", 1);
        }
        break;
      }
    }
  }

  function resolveCollisions() {
    const us = state.units;
    // unit-unit separation
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (a.dead) continue;
      const aRemote = netTLS.active && a.team.isRemote;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (b.dead) continue;
        const bRemote = netTLS.active && b.team.isRemote;
        if (aRemote && bRemote) continue; // both puppets: their owner resolves this
        const rr = a.def.r + b.def.r;
        let dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
        let dd = dx * dx + dy * dy;
        if (dd >= rr * rr || dd === 0) continue;
        const d = Math.sqrt(dd), push = (rr - d) / 2;
        dx /= d; dy /= d;
        // a puppet's position is owned by its real client; only nudge it here
        // if it's not remote, so local physics never fights the network snapshot.
        if (!aRemote) { a.x -= dx * push; a.y -= dy * push; }
        if (!bRemote) { b.x += dx * push; b.y += dy * push; }
      }
      if (aRemote) continue;
      // static circles: obstacles + rock barriers + buildings
      for (const o of state.obstacles) pushOut(a, o.x, o.y, o.r);
      for (const rk of state.rocks) if (!rk.dead) pushOut(a, rk.x, rk.y, rk.r);
      for (const bldg of state.buildings) if (!bldg.dead) pushOut(a, bldg.x, bldg.y, bldg.def.r * 0.9);
      a.x = clamp(a.x, 12, WORLD_W - 12);
      a.y = clamp(a.y, 12, WORLD_H - 12);
    }
  }
  function pushOut(u, cx, cy, r) {
    const rr = r + u.def.r;
    let dx = u.x - cx, dy = u.y - cy;
    const dd = dx * dx + dy * dy;
    if (dd >= rr * rr) return;
    const d = Math.sqrt(dd) || 0.01;
    // radial push plus slight tangent so units slide around instead of sticking
    const nx = dx / d, ny = dy / d;
    u.x = cx + nx * rr + -ny * 0.6;
    u.y = cy + ny * rr + nx * 0.6;
  }

  /* ==================================================
     10. SIM — combat
     ================================================== */
  function fire(u, t) {
    const def = u.def;
    const c = u.team.faction;
    if (def.proj === "melee") {
      applyDamage(t, def.dmg, u);
      spark(t.x, t.y, c.color, 3);
      if (u.team === playerTeam() || t.team === playerTeam()) Sfx.shot("melee");
      return;
    }
    if (def.proj === "arc" || def.proj === "psi") {
      applyDamage(t, def.dmg, u);
      state.beams.push({ x1: u.x, y1: u.y, x2: t.x, y2: t.y, type: def.proj, color: def.proj === "arc" ? "#7df3ff" : "#d7b3ff", ttl: 0.14 });
      if (def.proj === "psi" && t.kind === "unit") t.slowT = 1.2;
      spark(t.x, t.y, c.color, 3);
      Sfx.shot(def.proj === "arc" ? "beam" : "psi");
      return;
    }
    // projectile
    const speed = def.proj === "rail" ? 900 : def.proj === "needle" ? 520 : 340;
    state.projectiles.push({
      x: u.x, y: u.y, target: t, tx: t.x, ty: t.y, src: u,
      speed, dmg: def.dmg, splash: def.splash, team: u.team,
      type: def.proj, color: def.proj === "rail" ? "#cfeaff" : def.proj === "spore" ? c.color2 : c.color,
    });
    Sfx.shot(def.proj === "rail" ? "rail" : "bullet");
  }

  function updateProjectiles(dt) {
    for (const p of state.projectiles) {
      if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 4) {
        p.dead = true;
        impact(p);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    state.projectiles = state.projectiles.filter((p) => !p.dead);
    for (const b of state.beams) b.ttl -= dt;
    state.beams = state.beams.filter((b) => b.ttl > 0);
  }

  function impact(p) {
    if (p.splash > 0) {
      for (const u of state.units) {
        if (u.dead || u.team === p.team) continue;
        if (d2(p.tx, p.ty, u.x, u.y) <= p.splash * p.splash) applyDamage(u, p.dmg, null, p.team);
      }
      for (const b of state.buildings) {
        if (b.dead || b.team === p.team) continue;
        if (d2(p.tx, p.ty, b.x, b.y) <= (p.splash + b.def.r * 0.6) * (p.splash + b.def.r * 0.6)) applyDamage(b, p.dmg, null, p.team);
      }
      for (const rk of state.rocks) {
        if (rk.dead) continue;
        if (d2(p.tx, p.ty, rk.x, rk.y) <= (p.splash + rk.r * 0.5) * (p.splash + rk.r * 0.5)) applyDamage(rk, p.dmg, null, p.team);
      }
      boomFx(p.tx, p.ty, p.color, p.splash);
      Sfx.boom(false);
    } else if (p.target && !p.target.dead) {
      applyDamage(p.target, p.dmg, p.src && !p.src.dead ? p.src : null, p.team);
      spark(p.tx, p.ty, p.color, 4);
    } else {
      spark(p.tx, p.ty, p.color, 2);
    }
  }

  function applyDamage(thing, dmg, attacker, attackerTeam) {
    if (thing.dead) return;
    const aTeam = attacker ? attacker.team : attackerTeam;
    if (thing.kind === "rock") {
      thing.lastHit = state.time;
      thing.hp -= dmg;
      spark(thing.x, thing.y, "#cdb489", 2);
      if (thing.hp <= 0) {
        thing.dead = true;
        boomFx(thing.x, thing.y, "#cdb489", thing.r + 10);
        Sfx.boom(true);
        buildNavGrid();
        log("Rockslide cleared — a new route is open");
        // online: rocks are per-client world state — replicate the breach
        if (netTLS.active) netTLS.send("rockdead", { x: Math.round(thing.x), y: Math.round(thing.y) });
      }
      return;
    }
    if (isResourceNode(thing)) {
      if (!thing.team || thing.hp <= 0 || aTeam === thing.team) return;
      // online: a rival's node claim is their authority — forward the damage
      if (netTLS.active && thing.team.isRemote) {
        thing.lastHit = state.time;
        netTLS.queueNodeHit(thing, dmg);
        return;
      }
      thing.lastHit = state.time;
      thing.hp -= dmg;
      if (thing.hp <= 0) {
        boomFx(thing.x, thing.y, thing.team.faction.color, thing.r + 8);
        releaseNode(thing, aTeam);
      }
      return;
    }
    // online: units/buildings owned by a remote peer are puppets here — I'm
    // not authoritative for their HP, so queue the hit for the owner instead.
    if (netTLS.active && thing.team && thing.team.isRemote) {
      netTLS.queueHit(thing.team, thing, dmg);
      return;
    }
    thing.lastHit = state.time;
    if (thing.shield > 0) {
      const absorbed = Math.min(thing.shield, dmg);
      thing.shield -= absorbed;
      dmg -= absorbed;
    }
    thing.hp -= dmg;
    // retaliation: idle military units fight back, and nearby allies join in
    if (attacker && !attacker.dead && attacker.kind === "unit") {
      if (thing.kind === "unit" && thing.def.aggro > 0 && thing.state === "idle") {
        thing.target = attacker; thing.state = "attack";
      }
      for (const ally of state.units) {
        if (ally.dead || ally.team !== thing.team || ally.def.aggro === 0 || ally.state !== "idle") continue;
        if (d2(thing.x, thing.y, ally.x, ally.y) < 140 * 140) { ally.target = attacker; ally.state = "attack"; }
      }
    }
    // player under-attack alarm
    const pt = playerTeam();
    if (thing.team === pt && (thing.kind === "building" || (thing.def && thing.def.worker)) && state.time - state.alarmT > 9) {
      state.alarmT = state.time;
      state.alarmPos = { x: thing.x, y: thing.y };
      log(`⚠ ${thing.def.name} under attack`);
      Sfx.alarm();
    }
    if (thing.hp <= 0) kill(thing, aTeam);
  }

  function kill(thing, attackerTeam) {
    thing.dead = true;
    if (netTLS.active && thing.team === state.teams[0]) netTLS.send("death", { id: thing.id });
    const pt = playerTeam();
    if (thing.kind === "unit") {
      boomFx(thing.x, thing.y, thing.team.faction.color, 14);
      Sfx.boom(false);
      if (thing.team === pt) state.stats.losses++;
      else if (attackerTeam === pt || !attackerTeam) state.stats.kills++;
    } else {
      boomFx(thing.x, thing.y, thing.team.faction.color, thing.def.r * 1.4);
      state.decals.push({ x: thing.x, y: thing.y, r: thing.def.r, ttl: 40 });
      if (state.decals.length > 30) state.decals.shift();
      Sfx.boom(true);
      if (thing.node) {
        thing.node.rig = null;
        releaseNode(thing.node, attackerTeam);
      }
      if (thing.team === pt) log(`${thing.def.name} destroyed`);
      else log(`Enemy ${thing.def.name} destroyed`);
      if (state.selection.includes(thing)) { state.selection = state.selection.filter((s) => s !== thing); state.selVersion++; }
      if (thing.def.kind === "hq" && state.phase === "playing") {
        eliminateTeam(thing.team, attackerTeam);
      }
    }
    if (state.selection.includes(thing)) { state.selection = state.selection.filter((s) => s !== thing); state.selVersion++; }
  }

  // a commander whose HQ falls is out: forces collapse, claims release
  function eliminateTeam(team, attackerTeam) {
    if (team.eliminated) return;
    team.eliminated = true;
    for (const n of state.nodes) {
      if (n.team === team) { n.team = null; n.hp = 0; n.rig = null; }
      if (n.claimTeam === team) { n.claimTeam = null; n.claimProgress = 0; }
    }
    for (const u of state.units) {
      if (u.team !== team || u.dead) continue;
      u.dead = true;
      boomFx(u.x, u.y, team.faction.color, 12);
    }
    for (const b of state.buildings) {
      if (b.team !== team || b.dead) continue;
      b.dead = true;
      boomFx(b.x, b.y, team.faction.color, b.def.r);
      state.decals.push({ x: b.x, y: b.y, r: b.def.r, ttl: 40 });
    }
    if (state.decals.length > 30) state.decals.splice(0, state.decals.length - 30);
    state.selection = state.selection.filter((s) => !s.dead);
    state.selVersion++;
    const pt = playerTeam();
    if (team === pt) {
      if (netTLS.active) netTLS.send("elim", {});
      endGame(attackerTeam && !attackerTeam.eliminated ? attackerTeam : enemyTeams()[0] || null);
      return;
    }
    log(`☠ ${team.faction.name} eliminated`);
    Sfx.boom(true);
    if (!enemyTeams().length) endGame(pt);
  }

  /* ==================================================
     11. SIM — buildings, economy, regen
     ================================================== */
  function countUnits(team) { return state.units.reduce((n, u) => n + (u.team === team && !u.dead ? 1 : 0), 0); }

  function canAfford(team, cost) {
    return team.res.m >= (cost.m || 0) && team.res.e >= (cost.e || 0) && team.res.s >= (cost.s || 0);
  }
  function pay(team, cost) {
    team.res.m -= cost.m || 0;
    team.res.e -= cost.e || 0;
    team.res.s -= cost.s || 0;
  }

  function hasBuilt(team, key) {
    return state.buildings.some((b) => b.team === team && !b.dead && b.built && b.def.key === key);
  }

  function enqueueTrain(b, unitKey) {
    const def = b.team.faction.units[unitKey];
    if (!def || b.queue.length >= QUEUE_CAP) return false;
    if (countUnits(b.team) >= UNIT_CAP) return false;
    if (!canAfford(b.team, def.cost)) return false;
    pay(b.team, def.cost);
    b.queue.push({ def, t: 0 });
    return true;
  }

  function spawnTrained(b, def) {
    const rally = b.rally || { x: b.x, y: b.y + b.def.r + 40 };
    const a = Math.atan2(rally.y - b.y, rally.x - b.x);
    const u = makeUnit(b.team, def, b.x + Math.cos(a) * (b.def.r + def.r + 4), b.y + Math.sin(a) * (b.def.r + def.r + 4));
    orderMove([u], rally.x + rand(-24, 24), rally.y + rand(-24, 24), false);
    if (def.worker && b.team.isAI === false) { /* leave to player */ }
    if (b.team === playerTeam()) Sfx.trainDone();
    if (b.team.isAI && b.team.ai) b.team.ai.onUnit(u);
    if (netTLS.active && b.team === state.teams[0]) {
      netTLS.send("spawn", { kind: "unit", id: u.id, key: def.key, x: Math.round(u.x), y: Math.round(u.y) });
    }
    return u;
  }

  function updateBuilding(b, dt) {
    if (!b.built) {
      b.progress += dt / b.def.time;
      b.hp = Math.min(b.maxHp, Math.max(b.hp, (0.1 + 0.9 * Math.min(1, b.progress)) * b.maxHp));
      if (Math.random() < dt * 6) spark(b.x + rand(-b.def.r, b.def.r) * 0.7, b.y + rand(-b.def.r, b.def.r) * 0.7, "#8b93ad", 1);
      if (b.progress >= 1) {
        b.built = true;
        if (b.team === playerTeam()) { log(`${b.def.name} online`); Sfx.complete(); }
        state.selVersion++;
      }
      return;
    }
    // extractor passive income
    if (b.def.kind === "extractor" && b.node && isNodeClaimedBy(b.node, b.team)) {
      const kind = b.node.kind, rk = NODE_RES[kind];
      const rate = BASE_RATES[kind] * (b.def.mult ? b.def.mult[rk] : 1);
      const inc = b.team.income || 1;
      if (b.node.amount === Infinity) {
        b.team.res[rk] += rate * inc * dt;
      } else if (b.node.amount > 0) {
        const take = Math.min(rate * dt, b.node.amount);
        b.node.amount -= take;
        b.team.res[rk] += take * inc;
        if (b.node.amount <= 0 && !b.dry) {
          b.dry = true;
          if (b.team === playerTeam()) log(`${b.def.name}: node depleted`);
        }
      }
    }
    // HQ trickle energy so no faction is ever hard-stuck
    if (b.def.kind === "hq") b.team.res.e += 0.25 * dt;
    // training
    if (b.queue.length) {
      const item = b.queue[0];
      item.t += dt;
      if (item.t >= item.def.time) {
        b.queue.shift();
        spawnTrained(b, item.def);
        state.selVersion++;
      }
    }
    // point defense (turrets + HQ)
    if (b.def.dmg > 0) {
      b.cool -= dt;
      b.acqT -= dt;
      if (!b.target || b.target.dead || d2(b.x, b.y, b.target.x, b.target.y) > b.def.range * b.def.range * 1.2) {
        if (b.acqT <= 0) {
          b.acqT = 0.25;
          b.target = nearestEnemyThing(b.team, b.x, b.y, b.def.range, true);
        }
      }
      if (b.target && !b.target.dead && b.cool <= 0) {
        const t = b.target;
        b.face = Math.atan2(t.y - b.y, t.x - b.x);
        b.cool = b.def.rate;
        if (b.def.proj === "arc" || b.def.proj === "psi") {
          applyDamage(t, b.def.dmg, null, b.team);
          state.beams.push({ x1: b.x, y1: b.y - 14, x2: t.x, y2: t.y, type: b.def.proj, color: b.def.proj === "arc" ? "#7df3ff" : "#d7b3ff", ttl: 0.13 });
          Sfx.shot("beam");
        } else {
          state.projectiles.push({ x: b.x, y: b.y - 14, target: t, tx: t.x, ty: t.y, speed: 480, dmg: b.def.dmg, splash: 0, team: b.team, type: "bullet", color: b.team.faction.color });
          Sfx.shot("bullet");
        }
      }
    }
  }

  function updateRegen(dt) {
    for (const team of state.teams) {
      if (netTLS.active && team.isRemote) continue; // owner's client regenerates their own team
      const f = team.faction;
      if (f.gridRepair) {
        // robots: self-repair near a friendly structure ("the grid")
        const blds = teamBuildings(team);
        for (const u of state.units) {
          if (u.team !== team || u.dead || u.hp >= u.maxHp || state.time - u.lastHit < 2.5) continue;
          for (const b of blds) {
            if (d2(u.x, u.y, b.x, b.y) < 240 * 240) { u.hp = Math.min(u.maxHp, u.hp + 2 * dt); break; }
          }
        }
        for (const b of blds) {
          if (b.built && b.hp < b.maxHp && state.time - b.lastHit > 4) b.hp = Math.min(b.maxHp, b.hp + 0.8 * dt);
        }
      }
      if (f.id === "aliens") {
        for (const u of state.units) {
          if (u.team !== team || u.dead || u.maxShield <= 0) continue;
          if (u.shield < u.maxShield && state.time - u.lastHit > 3) u.shield = Math.min(u.maxShield, u.shield + 7 * dt);
        }
      }
    }
  }

  /* ==================================================
     12. BUILDING PLACEMENT
     ================================================== */
  function nodeNear(x, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const n of state.nodes) {
      const dd = d2(x, y, n.x, n.y);
      if (dd < bd) { bd = dd; best = n; }
    }
    return best;
  }

  function canPlace(team, def, x, y, node) {
    if (x < 40 || y < 40 || x > WORLD_W - 40 || y > WORLD_H - 40) return false;
    if (def.kind === "extractor") {
      if (!canUseNodeForExtractor(team, node)) return false;
      x = node.x; y = node.y;
    } else {
      // must be inside uplink range of a friendly structure
      let linked = false;
      for (const b of state.buildings) {
        if (b.dead || b.team !== team) continue;
        if (d2(x, y, b.x, b.y) < BUILD_RADIUS * BUILD_RADIUS) { linked = true; break; }
      }
      if (!linked) return false;
      // keep clear of nodes
      for (const n of state.nodes) {
        const rr = n.r + def.r + 8;
        if (d2(x, y, n.x, n.y) < rr * rr) return false;
      }
    }
    for (const o of state.obstacles) {
      const rr = o.r + def.r + 4;
      if (d2(x, y, o.x, o.y) < rr * rr) return false;
    }
    for (const rk of state.rocks) {
      if (rk.dead) continue;
      const rr = rk.r + def.r + 4;
      if (d2(x, y, rk.x, rk.y) < rr * rr) return false;
    }
    for (const b of state.buildings) {
      if (b.dead) continue;
      const rr = b.def.r + def.r + 10;
      if (d2(x, y, b.x, b.y) < rr * rr) return false;
    }
    return true;
  }

  function placeBuilding(team, key, x, y) {
    const def = team.faction.buildings[key];
    if (!def) return null;
    if (def.kind === "turret" && !hasBuilt(team, "production")) return null;
    let node = null;
    if (def.kind === "extractor") {
      node = nodeNear(x, y, 60);
      if (!node) return null;
      x = node.x; y = node.y;
    }
    if (!canPlace(team, def, x, y, node)) return null;
    if (!canAfford(team, def.cost)) return null;
    pay(team, def.cost);
    const b = makeBuilding(team, def, x, y, node, false);
    if (team === playerTeam()) Sfx.place();
    if (netTLS.active && team === state.teams[0]) {
      netTLS.send("spawn", { kind: "building", id: b.id, key: def.key, x: Math.round(b.x), y: Math.round(b.y) });
    }
    return b;
  }

  /* ==================================================
     13. AI OPPONENT
     ================================================== */
  // difficulty knobs: how fast the AI thinks, how wide it expands, how hard it
  // scales its economy and waves, and its resource-income handicap/bonus.
  const OPTS_STORE = "tls-skirmish-opts";

  const AI_DIFFICULTY = {
    easy: {
      key: "easy", label: "Easy",
      think: 1.15, income: 0.8, startBonus: { m: 0, e: 0 },
      workerCap: 8, extractorCap: 4, prodCap: 1, turretCap: 2,
      queueDepth: 1, waveBase: 4, waveGrow: 1, waveCap: 9, waveDelay: 34,
      harass: false, playerBias: 1, scoreMult: 0.6,
    },
    normal: {
      key: "normal", label: "Normal",
      think: 0.8, income: 1, startBonus: { m: 60, e: 20 },
      workerCap: 12, extractorCap: 7, prodCap: 2, turretCap: 4,
      queueDepth: 2, waveBase: 5, waveGrow: 2, waveCap: 16, waveDelay: 26,
      harass: true, playerBias: 1.2, scoreMult: 1,
    },
    hard: {
      key: "hard", label: "Hard",
      think: 0.55, income: 1.2, startBonus: { m: 140, e: 60 },
      workerCap: 16, extractorCap: 10, prodCap: 3, turretCap: 6,
      queueDepth: 3, waveBase: 6, waveGrow: 3, waveCap: 26, waveDelay: 20,
      harass: true, playerBias: 1.6, scoreMult: 1.5,
    },
  };

  function makeAI(team, diff) {
    const ai = {
      team,
      diff,
      think: rand(0, 0.5),
      waveGoal: diff.waveBase,
      waveIdx: 0,
      lastWave: 0,
      wave: null, // staged push: {x, y, pushAt}
      defenseCool: 0,
      harassCool: 50,
      expandCool: 8,
      workerTarget: 6,
      onUnit(u) {
        if (!u.def.worker) u.aiRole = "defend";
      },
      update(dt) {
        this.think -= dt;
        this.defenseCool -= dt;
        this.harassCool -= dt;
        this.expandCool -= dt;
        if (this.think > 0) return;
        this.think = this.diff.think;
        const t = this.team;
        if (t.eliminated) return;
        const hq = teamHQ(t);
        if (!hq) return;
        const workers = teamUnits(t).filter((u) => u.def.worker);
        const army = teamMilitary(t);
        const blds = teamBuildings(t);

        // recycle stale roles so committed troops rejoin the muster pool
        for (const u of army) {
          if (u.aiRole === "harass" && u.state === "idle") u.aiRole = "defend";
          if (u.aiRole === "wave" && u.state === "idle" && state.time - this.lastWave > 14) u.aiRole = "defend";
        }

        // --- economy: worker count scales with rigs + game time
        this.workerTarget = Math.min(this.diff.workerCap, 6 + blds.filter((b) => b.def.kind === "extractor").length + Math.floor(state.time / 100));
        if (workers.length < this.workerTarget && hq.queue.length < 2 && canAfford(t, t.faction.units.worker.cost)) {
          enqueueTrain(hq, "worker");
        }
        for (const w of workers) {
          if (w.state === "idle") {
            const n = findMatterNode(w);
            if (n) orderHarvest([w], n);
          }
        }

        // --- structures: expand extractors outward, layer defense, add production
        const extractors = blds.filter((b) => b.def.kind === "extractor");
        const prodsAll = blds.filter((b) => b.def.kind === "production");
        const prods = prodsAll.filter((b) => b.built);
        const turrets = blds.filter((b) => b.def.kind === "turret");
        const energyRigs = extractors.filter((b) => b.node && b.node.kind === "energy").length;
        const signalRigs = extractors.filter((b) => b.node && b.node.kind === "signal").length;
        const wantEnergy = Math.min(3, 1 + Math.floor(this.waveIdx / 2));
        const wantSignal = Math.min(2, 1 + Math.floor(this.waveIdx / 3));

        if (energyRigs === 0) {
          this.buildExtractor(t, hq, "energy");
        } else if (!prodsAll.length) {
          this.buildNear(t, hq, "production");
        } else if (prods.length && signalRigs < wantSignal && t.res.m > 130) {
          this.buildExtractor(t, hq, "signal");
        } else if (prods.length && energyRigs < wantEnergy && t.res.m > 140) {
          this.buildExtractor(t, hq, "energy");
        } else if (prods.length && turrets.length < Math.min(this.diff.turretCap, 1 + this.waveIdx) && t.res.m > 160) {
          this.buildTurret(t);
        } else if (prods.length && extractors.length < this.diff.extractorCap && t.res.m > 200 && this.expandCool <= 0) {
          this.expandCool = 12;
          this.buildExtractor(t, hq, "matter") || this.buildExtractor(t, hq, "energy") || this.buildExtractor(t, hq, "signal");
        }
        // extra production lines are what let the AI field big late-game armies
        if (prods.length && prodsAll.length < Math.min(this.diff.prodCap, 1 + Math.floor(this.waveIdx / 2)) && t.res.m > 260) {
          this.buildNear(t, hq, "production");
        }

        // --- training composition across every production line
        const heavies = army.filter((u) => u.def.key === "heavy").length;
        const heavyDef = t.faction.units.heavy;
        const depth = Math.min(QUEUE_CAP, this.diff.queueDepth + (t.res.m > 400 ? 2 : 0));
        for (const p of prods) {
          if (p.queue.length >= depth) continue;
          if (this.waveIdx >= 1 && heavies < 1 + Math.floor(army.length / 5) && canAfford(t, heavyDef.cost)) {
            enqueueTrain(p, "heavy");
          } else if (Math.random() < 0.45 && canAfford(t, t.faction.units.ranged.cost)) {
            enqueueTrain(p, "ranged");
          } else if (canAfford(t, t.faction.units.basic.cost)) {
            enqueueTrain(p, "basic");
          }
        }

        // --- defense: respond to threats near structures
        if (this.defenseCool <= 0) {
          let threat = null;
          for (const b of blds) {
            const e = nearestEnemyThing(t, b.x, b.y, 340, true);
            if (e) { threat = e; break; }
          }
          if (threat) {
            this.defenseCool = 5;
            const defenders = army.filter((u) => u.aiRole !== "wave" || dist(u.x, u.y, threat.x, threat.y) < 700);
            if (defenders.length) orderMove(defenders, threat.x, threat.y, true);
          }
        }

        // --- harassment: small squads raid enemy expansions between waves
        if (this.diff.harass && this.harassCool <= 0 && army.length >= 6) {
          this.harassCool = this.diff.key === "hard" ? 42 : 65;
          const target = this.pickHarassTarget();
          const raiders = army.filter((u) => u.aiRole === "defend" && u.def.key !== "heavy").slice(0, 3);
          if (target && raiders.length >= 2) {
            raiders.forEach((u) => { u.aiRole = "harass"; });
            orderMove(raiders, target.x, target.y, true);
          }
        }

        // --- offense: muster fresh troops into escalating waves
        const sinceWave = state.time - this.lastWave;
        const fresh = army.filter((u) => u.aiRole !== "wave" && u.aiRole !== "harass");
        if (sinceWave > this.diff.waveDelay && (fresh.length >= this.waveGoal || (fresh.length >= 4 && sinceWave > 105))) {
          this.launchWave(fresh);
        }
        // staged push: gather at the staging point, then commit together
        if (this.wave && state.time >= this.wave.pushAt) {
          const squad = state.units.filter((u) => u.team === t && !u.dead && u.aiRole === "wave");
          if (squad.length) orderMove(squad, this.wave.x, this.wave.y, true);
          this.wave = null;
        }
      },
      launchWave(squad) {
        const target = this.pickWaveTarget();
        if (!target || !squad.length) return;
        let cx = 0, cy = 0;
        squad.forEach((u) => { u.aiRole = "wave"; cx += u.x; cy += u.y; });
        cx /= squad.length; cy /= squad.length;
        orderMove(squad, lerp(cx, target.x, 0.55), lerp(cy, target.y, 0.55), true);
        this.wave = { x: target.x, y: target.y, pushAt: state.time + 9 };
        this.waveIdx++;
        this.lastWave = state.time;
        this.waveGoal = Math.min(this.diff.waveCap, this.waveGoal + this.diff.waveGrow);
        if (target.team === playerTeam()) { log("⚠ Seismic sensors: enemy force moving"); Sfx.alarm(); }
      },
      pickWaveTarget() {
        const t = this.team;
        const hq = teamHQ(t);
        const foes = state.teams.filter((tt) => tt !== t && !tt.eliminated);
        if (!foes.length || !hq) return null;
        let best = null, bestW = -1;
        for (const foe of foes) {
          const fhq = teamHQ(foe);
          const pos = fhq || HQ_POS[foe.idx];
          let w = 1 / Math.max(1, dist(hq.x, hq.y, pos.x, pos.y));
          if (foe === playerTeam()) w *= this.diff.playerBias;
          w *= rand(0.7, 1.3);
          if (w > bestW) { bestW = w; best = { x: pos.x, y: pos.y, team: foe }; }
        }
        // sometimes strike the economy instead of the throat
        if (best && Math.random() < 0.35) {
          const ext = state.buildings.filter((b) => !b.dead && b.team === best.team && b.def.kind === "extractor");
          if (ext.length) { const e = pick(ext); return { x: e.x, y: e.y, team: best.team }; }
        }
        return best;
      },
      pickHarassTarget() {
        const foes = state.teams.filter((tt) => tt !== this.team && !tt.eliminated);
        if (!foes.length) return null;
        const foe = pick(foes);
        const fhq = teamHQ(foe);
        const targets = [];
        for (const b of state.buildings) if (!b.dead && b.team === foe && b.def.kind === "extractor") targets.push(b);
        for (const n of state.nodes) if (n.team === foe && !n.rig) targets.push(n);
        if (!targets.length) return fhq;
        // hit the expansion farthest from their HQ — least defended
        targets.sort((a, b) => (fhq ? d2(b.x, b.y, fhq.x, fhq.y) - d2(a.x, a.y, fhq.x, fhq.y) : 0));
        return targets[0];
      },
      buildExtractor(t, hq, kind) {
        let best = null, bd = Infinity;
        for (const n of state.nodes) {
          if (n.kind !== kind || !canUseNodeForExtractor(t, n)) continue;
          const dd = d2(hq.x, hq.y, n.x, n.y);
          if (dd < bd) { bd = dd; best = n; }
        }
        if (best && canAfford(t, t.faction.buildings.extractor.cost)) return placeBuilding(t, "extractor", best.x, best.y);

        let claim = null; bd = Infinity;
        for (const n of state.nodes) {
          if (n.kind !== kind || !nodeHasResources(n) || n.rig || n.team) continue;
          const dd = d2(hq.x, hq.y, n.x, n.y);
          if (dd < bd) { bd = dd; claim = n; }
        }
        if (claim) {
          const workers = teamUnits(t).filter((u) => u.def.worker);
          workers.sort((a, b) => d2(a.x, a.y, claim.x, claim.y) - d2(b.x, b.y, claim.x, claim.y));
          const worker = workers.find((u) => u.state !== "claim" || u.node !== claim) || workers[0];
          if (worker) {
            orderClaim([worker], claim);
            // escort distant expansion claims so they actually survive
            if (this.diff.harass && d2(hq.x, hq.y, claim.x, claim.y) > 800 * 800) {
              const guards = teamMilitary(t).filter((u) => u.aiRole === "defend").slice(0, 2);
              if (guards.length) orderMove(guards, claim.x, claim.y, true);
            }
          }
        }
        return null;
      },
      buildNear(t, hq, key) {
        const def = t.faction.buildings[key];
        if (!canAfford(t, def.cost)) return null;
        for (let i = 0; i < 24; i++) {
          const a = rand(0, TAU), d = rand(hq.def.r + def.r + 20, 250);
          const x = hq.x + Math.cos(a) * d, y = hq.y + Math.sin(a) * d;
          if (canPlace(t, def, x, y, null)) return placeBuilding(t, key, x, y);
        }
        return null;
      },
      buildTurret(t) {
        const def = t.faction.buildings.turret;
        if (!canAfford(t, def.cost)) return null;
        // anchor turrets across the base AND expansions so defense spreads out
        const anchors = teamBuildings(t).filter((b) => b.built && b.def.kind !== "turret");
        const hq = teamHQ(t);
        const anchor = (Math.random() < 0.5 ? hq : pick(anchors)) || hq;
        if (!anchor) return null;
        const toC = Math.atan2(CENTER.y - anchor.y, CENTER.x - anchor.x);
        for (let i = 0; i < 20; i++) {
          const a = toC + rand(-1.1, 1.1), d = rand(90, 230);
          const x = anchor.x + Math.cos(a) * d, y = anchor.y + Math.sin(a) * d;
          if (canPlace(t, def, x, y, null)) return placeBuilding(t, "turret", x, y);
        }
        return null;
      },
    };
    return ai;
  }

  /* ==================================================
     13b. VISION + SKIRMISH OPTIONS (fog when mapReveal is false)
     ================================================== */
  function fogActive() {
    return !state.opts.mapReveal && (state.phase === "playing" || state.phase === "over");
  }
  function menuMapHidden() {
    return state.phase === "select" && !state.opts.mapReveal;
  }
  function refreshVision() {
    const pt = playerTeam();
    state.vision = [];
    if (!fogActive() || !pt) return;
    for (const u of state.units) {
      if (u.dead || u.team !== pt) continue;
      const r = u.def.scout ? VISION.scout : u.def.worker ? VISION.worker : VISION.combat;
      state.vision.push({ x: u.x, y: u.y, r, kind: u.def.scout ? "scout" : "unit" });
    }
    for (const b of state.buildings) {
      if (b.dead || b.team !== pt) continue;
      state.vision.push({ x: b.x, y: b.y, r: b.def.kind === "hq" ? VISION.hq : VISION.building, kind: "building" });
    }
    for (const n of state.nodes) {
      if (isNodeClaimedBy(n, pt)) {
        state.vision.push({ x: n.x, y: n.y, r: VISION.claimedNode, kind: "node" });
      } else if (n.claimTeam === pt && n.claimProgress > 0) {
        state.vision.push({ x: n.x, y: n.y, r: VISION.claimingNode, kind: "claim" });
      }
    }
  }
  function isVisibleToPlayer(x, y, extra = 0) {
    if (!fogActive()) return true;
    if (!playerTeam()) return true;
    for (const s of state.vision) {
      const rr = s.r + extra;
      if (d2(x, y, s.x, s.y) <= rr * rr) return true;
    }
    return false;
  }
  function thingVisibleToPlayer(o) {
    if (!fogActive()) return true;
    if (o.team === playerTeam()) return true;
    const r = o.def ? o.def.r : (o.r || 12);
    return isVisibleToPlayer(o.x, o.y, r + 18);
  }

  function loadPersistedOpts() {
    try {
      const saved = JSON.parse(localStorage.getItem(OPTS_STORE) || "null");
      if (!saved || typeof saved !== "object") return;
      if (saved.enemies >= 1 && saved.enemies <= 3) state.opts.enemies = saved.enemies;
      if (AI_DIFFICULTY[saved.difficulty]) state.opts.difficulty = saved.difficulty;
      if (typeof saved.mapReveal === "boolean") state.opts.mapReveal = saved.mapReveal;
    } catch (_) {}
  }
  function persistOpts() {
    try { localStorage.setItem(OPTS_STORE, JSON.stringify(state.opts)); } catch (_) {}
  }
  function optSeg(opt, entries) {
    return entries.map(([v, label]) =>
      `<button type="button" data-v="${v}" class="${String(state.opts[opt]) === String(v) ? "is-on" : ""}">${label}</button>`).join("");
  }
  function bindOptSegs(root, onChange) {
    root.querySelectorAll(".tls-seg").forEach((segEl) => {
      segEl.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        Sfx.click();
        const opt = segEl.dataset.opt;
        state.opts[opt] = opt === "enemies" ? Number(b.dataset.v)
          : opt === "mapReveal" ? b.dataset.v === "true"
            : b.dataset.v;
        segEl.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
        persistOpts();
        if (onChange) onChange();
      });
    });
  }

  /* ==================================================
     14. MAIN UPDATE
     ================================================== */
  const keys = {};
  function update(dt) {
    state.time += dt;
    navQuota = 8;

    // camera: keyboard + edge scroll
    let cx = 0, cy = 0;
    if (keys.ArrowLeft || keys.a) cx -= 1;
    if (keys.ArrowRight || keys.d) cx += 1;
    if (keys.ArrowUp || keys.w) cy -= 1;
    if (keys.ArrowDown || keys.s) cy += 1;
    if (mouse.inside && !mouse.touch) {
      if (mouse.cx < 24) cx -= 1;
      if (mouse.cx > W - 24) cx += 1;
      if (mouse.cy < 24) cy -= 1;
      if (mouse.cy > H - 24) cy += 1;
    }
    if (cx || cy) {
      state.cam.x = clamp(state.cam.x + cx * EDGE_SCROLL * dt, 0, WORLD_W - W);
      state.cam.y = clamp(state.cam.y + cy * EDGE_SCROLL * dt, 0, WORLD_H - H);
    }

    // online: the remote team's units/buildings are puppets driven by network
    // snapshots — skip local behavior sim for them entirely.
    for (const u of state.units) if (!u.dead && !(netTLS.active && u.team.isRemote)) updateUnit(u, dt);
    resolveCollisions();
    for (const b of state.buildings) if (!b.dead && !(netTLS.active && b.team.isRemote)) updateBuilding(b, dt);
    updateProjectiles(dt);
    updateRegen(dt);
    for (const team of state.teams) if (team.ai) team.ai.update(dt);
    updateParticles(dt);
    netTLS.tick(dt);

    state.units = state.units.filter((u) => !u.dead);
    state.buildings = state.buildings.filter((b) => !b.dead);

    updateGhost();
  }

  function updateGhost() {
    if (!state.placing) return;
    const g = state.placing;
    g.x = mouse.wx; g.y = mouse.wy;
    g.node = g.def.kind === "extractor" ? nodeNear(g.x, g.y, 60) : null;
    if (g.node) { g.x = g.node.x; g.y = g.node.y; }
    g.valid = canPlace(playerTeam(), g.def, g.x, g.y, g.node);
  }

  /* ==================================================
     15. PARTICLES + FX
     ================================================== */
  function spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      if (state.particles.length > 380) return;
      const a = rand(0, TAU), s = rand(30, 130);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ttl: rand(0.15, 0.4), max: 0.4, color, size: rand(1, 2.4), type: "spark" });
    }
  }
  function boomFx(x, y, color, r) {
    spark(x, y, color, Math.min(18, Math.floor(r)));
    state.particles.push({ x, y, vx: 0, vy: 0, ttl: 0.45, max: 0.45, color, size: r, type: "ring" });
    state.particles.push({ x, y, vx: 0, vy: -14, ttl: 0.8, max: 0.8, color: "#3a3f52", size: r * 0.5, type: "puff" });
  }
  function updateParticles(dt) {
    for (const p of state.particles) {
      p.ttl -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    state.particles = state.particles.filter((p) => p.ttl > 0);
    for (const fx of state.commandFx) fx.ttl -= dt;
    state.commandFx = state.commandFx.filter((fx) => fx.ttl > 0);
    for (const d of state.decals) d.ttl -= dt;
    state.decals = state.decals.filter((d) => d.ttl > 0);
  }

  /* ==================================================
     16. INPUT — mouse / touch / keys
     ================================================== */
  const mouse = { x: 0, y: 0, cx: 0, cy: 0, wx: 0, wy: 0, inside: false, touch: false };
  let dragStart = null, dragging = false, mmDrag = false;
  let touchPan = null, touchMoved = false, touchT0 = 0;

  function toCanvas(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }
  function trackMouse(ev) {
    const p = toCanvas(ev);
    if (ev.pointerType) mouse.touch = ev.pointerType === "touch";
    mouse.cx = p.x; mouse.cy = p.y;
    mouse.wx = clamp(p.x + state.cam.x, 0, WORLD_W);
    mouse.wy = clamp(p.y + state.cam.y, 0, WORLD_H);
    mouse.inside = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
  }
  function inMinimap(p) { return p.x >= MM.x && p.x <= MM.x + MM.w && p.y >= MM.y && p.y <= MM.y + MM.h; }
  function camFromMinimap(p) {
    const fx = (p.x - MM.x) / MM.w, fy = (p.y - MM.y) / MM.h;
    state.cam.x = clamp(fx * WORLD_W - W / 2, 0, WORLD_W - W);
    state.cam.y = clamp(fy * WORLD_H - H / 2, 0, WORLD_H - H);
  }

  function setSelection(arr) {
    state.selection = arr;
    state.selVersion++;
  }

  function smartCommand(wx, wy) {
    const units = selUnits();
    const sel = state.selection;
    // rally point for a selected own production building
    if (!units.length && sel.length === 1 && sel[0].kind === "building" && sel[0].team === playerTeam() && sel[0].def.trains) {
      sel[0].rally = { x: wx, y: wy };
      log(`${sel[0].def.name}: rally point set`);
      addCommandFx("rally", wx, wy);
      return;
    }
    if (!units.length) return;
    const hit = thingAt(wx, wy);
    if (hit && hit.kind === "rock") {
      orderAttack(units, hit);
      addCommandFx("breach", hit.x, hit.y);
      return;
    }
    if (hit && (hit.kind === "unit" || hit.kind === "building")) {
      if (hit.team !== playerTeam()) {
        orderAttack(units, hit);
        addCommandFx("attack", hit.x, hit.y);
        return;
      }
      if (isFriendlyRepairTarget(hit)) {
        const workers = units.filter((u) => u.def.worker);
        if (workers.length) {
          orderRepair(workers, hit);
          const rest = units.filter((u) => !u.def.worker);
          if (rest.length) orderMove(rest, wx, wy, false);
          addCommandFx("repair", hit.x, hit.y);
          return;
        }
      }
      orderMove(units, wx, wy, false);
      addCommandFx("move", wx, wy);
      return;
    }
    if (hit && state.nodes.includes(hit)) { // resource node
      const workers = units.filter((u) => u.def.worker);
      const rest = units.filter((u) => !u.def.worker);
      if (isEnemyClaimedNode(hit, playerTeam())) {
        orderAttack(units, hit);
        addCommandFx("attack", hit.x, hit.y);
        return;
      }
      if (!hit.team && nodeHasResources(hit)) {
        orderClaim(units, hit);
        addCommandFx("claim", hit.x, hit.y);
        return;
      }
      if (workers.length && isNodeClaimedBy(hit, playerTeam())) {
        if (hit.rig) log("That node is occupied by an extractor");
        else if (hit.kind === "matter") {
          orderHarvest(workers, hit);
          addCommandFx("gather", hit.x, hit.y);
        }
        else log(`${RES_NAME[NODE_RES[hit.kind]]} claimed — build an extractor`);
        if (rest.length) {
          orderMove(rest, wx, wy, false);
          if (hit.kind !== "matter" || hit.rig) addCommandFx("move", wx, wy);
        }
        return;
      }
      orderMove(units, wx, wy, false);
      addCommandFx("move", wx, wy);
      return;
    }
    orderMove(units, wx, wy, false);
    addCommandFx("move", wx, wy);
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (ev) => {
    if (state.phase !== "playing" || state.paused) return;
    trackMouse(ev);
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic or stale pointer */ }
    const p = { x: mouse.cx, y: mouse.cy };

    if (ev.pointerType === "touch") {
      mouse.touch = true;
      touchT0 = performance.now();
      touchMoved = false;
      if (inMinimap(p)) { mmDrag = true; camFromMinimap(p); return; }
      touchPan = { sx: ev.clientX, sy: ev.clientY, camX: state.cam.x, camY: state.cam.y };
      return;
    }

    if (inMinimap(p)) { mmDrag = true; camFromMinimap(p); return; }

    if (ev.button === 2 || ((ev.ctrlKey || ev.metaKey) && ev.button === 0)) {
      if (state.placing) { state.placing = null; renderActionsPanel(); return; }
      smartCommand(mouse.wx, mouse.wy);
      return;
    }
    if (ev.button !== 0) return;

    if (state.placing) {
      updateGhost();
      const g = state.placing;
      if (g.valid) {
        const b = placeBuilding(playerTeam(), g.def.key, g.x, g.y);
        if (b) { log(`${g.def.name} constructing…`); if (!ev.shiftKey) state.placing = null; }
      } else {
        log("Cannot deploy there");
      }
      renderActionsPanel();
      return;
    }
    if (state.armed === "attack") {
      const units = selUnits().filter((u) => !u.def.worker);
      if (units.length) {
        const hit = thingAt(mouse.wx, mouse.wy);
        if (hit && ((hit.kind === "unit" || hit.kind === "building") && hit.team !== playerTeam() || hit.kind === "rock")) {
          orderAttack(units, hit);
          addCommandFx(hit.kind === "rock" ? "breach" : "attack", hit.x, hit.y);
        } else {
          orderMove(units, mouse.wx, mouse.wy, true);
          addCommandFx("attackMove", mouse.wx, mouse.wy);
        }
      }
      state.armed = null;
      syncCommandButtons();
      return;
    }
    dragStart = p;
    dragging = false;
  });

  canvas.addEventListener("pointermove", (ev) => {
    trackMouse(ev);
    if (mmDrag) { camFromMinimap({ x: mouse.cx, y: mouse.cy }); return; }
    if (touchPan) {
      const r = canvas.getBoundingClientRect();
      const dx = (ev.clientX - touchPan.sx) * (W / r.width);
      const dy = (ev.clientY - touchPan.sy) * (H / r.height);
      if (Math.abs(dx) + Math.abs(dy) > 14) touchMoved = true;
      if (touchMoved) {
        state.cam.x = clamp(touchPan.camX - dx, 0, WORLD_W - W);
        state.cam.y = clamp(touchPan.camY - dy, 0, WORLD_H - H);
      }
      return;
    }
    if (dragStart && !dragging && dist(dragStart.x, dragStart.y, mouse.cx, mouse.cy) > 7) dragging = true;
  });

  function finishPointer(ev) {
    trackMouse(ev);
    if (mmDrag) { mmDrag = false; return; }

    if (ev.pointerType === "touch") {
      const wasPan = touchMoved;
      touchPan = null;
      if (wasPan || performance.now() - touchT0 > 500) return;
      // tap
      if (state.phase !== "playing" || state.paused) return;
      if (state.placing) {
        updateGhost();
        const g = state.placing;
        if (g.valid) {
          const b = placeBuilding(playerTeam(), g.def.key, g.x, g.y);
          if (b) { log(`${g.def.name} constructing…`); state.placing = null; }
        } else log("Cannot deploy there");
        renderActionsPanel();
        return;
      }
      if (state.armed === "attack") {
        const units = selUnits().filter((u) => !u.def.worker);
        if (units.length) {
          const hit = thingAt(mouse.wx, mouse.wy);
          if (hit && (hit.kind === "unit" || hit.kind === "building") && hit.team !== playerTeam()) {
            orderAttack(units, hit);
            addCommandFx("attack", hit.x, hit.y);
          } else {
            orderMove(units, mouse.wx, mouse.wy, true);
            addCommandFx("attackMove", mouse.wx, mouse.wy);
          }
        }
        state.armed = null;
        syncCommandButtons();
        return;
      }
      tapCommand(mouse.wx, mouse.wy);
      return;
    }

    // mouse left-button release
    if (ev.button !== 0) return;
    if (!dragStart) return;
    if (dragging) {
      const x1 = Math.min(dragStart.x, mouse.cx) + state.cam.x;
      const y1 = Math.min(dragStart.y, mouse.cy) + state.cam.y;
      const x2 = Math.max(dragStart.x, mouse.cx) + state.cam.x;
      const y2 = Math.max(dragStart.y, mouse.cy) + state.cam.y;
      const pt = playerTeam();
      const picked = state.units.filter((u) => !u.dead && u.team === pt && u.x >= x1 && u.x <= x2 && u.y >= y1 && u.y <= y2);
      // prefer military if the box has both
      const mil = picked.filter((u) => !u.def.worker);
      setSelection(mil.length ? mil : picked);
    } else {
      const hit = thingAt(mouse.wx, mouse.wy);
      if (hit && (hit.kind === "unit" || hit.kind === "building")) setSelection([hit]);
      else setSelection([]);
    }
    dragStart = null;
    dragging = false;
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", () => { dragStart = null; dragging = false; mmDrag = false; touchPan = null; });
  canvas.addEventListener("pointerleave", () => { mouse.inside = false; });

  function tapCommand(wx, wy) {
    const hit = thingAt(wx, wy);
    const units = selUnits();
    if (hit && hit.kind === "rock") {
      if (units.length) {
        orderAttack(units, hit);
        addCommandFx("breach", hit.x, hit.y);
      }
      return;
    }
    if (hit && (hit.kind === "unit" || hit.kind === "building") && hit.team === playerTeam()) {
      const workers = units.filter((u) => u.def.worker);
      if (workers.length && isFriendlyRepairTarget(hit)) {
        orderRepair(workers, hit);
        addCommandFx("repair", hit.x, hit.y);
        return;
      }
      setSelection([hit]);
      return;
    }
    if (hit && (hit.kind === "unit" || hit.kind === "building")) {
      if (units.length) {
        orderAttack(units, hit);
        addCommandFx("attack", hit.x, hit.y);
        return;
      }
      setSelection([hit]);
      return;
    }
    if (hit && state.nodes.includes(hit)) {
      const workers = units.filter((u) => u.def.worker);
      if (isEnemyClaimedNode(hit, playerTeam()) && units.length) {
        orderAttack(units, hit);
        addCommandFx("attack", hit.x, hit.y);
        return;
      }
      if (!hit.team && units.length && nodeHasResources(hit)) {
        orderClaim(units, hit);
        addCommandFx("claim", hit.x, hit.y);
        return;
      }
      if (workers.length && isNodeClaimedBy(hit, playerTeam())) {
        if (hit.kind === "matter" && !hit.rig) {
          orderHarvest(workers, hit);
          addCommandFx("gather", hit.x, hit.y);
        }
        else log(hit.rig ? "Node occupied by an extractor" : "Claimed — build an extractor");
        return;
      }
    }
    if (units.length) { smartTapMove(units, wx, wy); return; }
    setSelection([]);
  }
  function smartTapMove(units, wx, wy) {
    orderMove(units, wx, wy, false);
    addCommandFx("move", wx, wy);
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)) { keys[e.key] = true; e.preventDefault(); return; }
    if (["w", "a", "s", "d"].includes(k) && state.phase === "playing") { keys[k] = true; return; }
    if (k === "p" && (state.phase === "playing")) { togglePause(); return; }
    if (k === "escape") {
      if (state.placing) { state.placing = null; renderActionsPanel(); }
      else if (state.armed) { state.armed = null; syncCommandButtons(); }
      else if (state.selection.length) setSelection([]);
      else if (state.phase === "playing" && state.paused) togglePause();
      return;
    }
    if (state.phase !== "playing" || state.paused) return;
    if (k === "t") armAttack();
    if (k === "h") { const u = selUnits(); if (u.length) orderStop(u); }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
    keys[e.key.toLowerCase()] = false;
  });

  /* ==================================================
     17. COMMAND BUTTONS (desktop panel + mobile dock)
     ================================================== */
  function armAttack() {
    if (state.phase !== "playing") return;
    const mil = selUnits().filter((u) => !u.def.worker);
    if (!mil.length) { log("Select combat units first"); return; }
    state.armed = state.armed === "attack" ? null : "attack";
    state.placing = null;
    syncCommandButtons();
  }
  function selectArmy() {
    if (state.phase !== "playing") return;
    const mil = teamMilitary(playerTeam());
    if (mil.length) setSelection(mil);
    else log("No combat units fielded");
  }
  function stopSel() { const u = selUnits(); if (u.length) orderStop(u); }
  function syncCommandButtons() {
    [btn.attack, btn.dockAttack].forEach((b) => b && b.classList.toggle("is-armed", state.armed === "attack"));
  }

  [btn.attack, btn.dockAttack].forEach((b) => b && b.addEventListener("click", () => { Sfx.click(); armAttack(); }));
  [btn.stop, btn.dockStop].forEach((b) => b && b.addEventListener("click", () => { Sfx.click(); stopSel(); }));
  [btn.army, btn.dockArmy].forEach((b) => b && b.addEventListener("click", () => { Sfx.click(); selectArmy(); }));
  if (btn.dockX) btn.dockX.addEventListener("click", () => { Sfx.click(); setSelection([]); state.armed = null; state.placing = null; syncCommandButtons(); renderActionsPanel(); });
  [btn.pause, btn.dockPause].forEach((b) => b && b.addEventListener("click", () => { Sfx.click(); togglePause(); }));

  if (btn.fullscreen) {
    btn.fullscreen.addEventListener("click", () => {
      const wrap = canvas.closest(".canvas-wrap");
      const isMaxed = wrap.classList.toggle("is-maxed");
      document.body.classList.toggle("rb-game-maxed", isMaxed);
      canvas.focus({ preventScroll: true });
    });
  }

  /* ==================================================
     18. HUD / SELECTION PANEL / ACTIONS
     ================================================== */
  const hudCache = {};
  function setText(node, key, val) {
    if (!node) return;
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    node.textContent = val;
  }

  function syncHud() {
    const pt = playerTeam();
    if (!pt) return;
    setText(el.matter, "m", String(Math.floor(pt.res.m)));
    setText(el.energy, "e", String(Math.floor(pt.res.e)));
    setText(el.signal, "s", String(Math.floor(pt.res.s)));
    setText(el.army, "army", `${countUnits(pt)}/${UNIT_CAP}`);
    setText(el.time, "time", fmtTime(state.time));
    setText(el.best, "best", String(state.best));
    if (el.dockRes) setText(el.dockRes, "dockres", `${RES_GLYPH.m}${Math.floor(pt.res.m)}  ${RES_GLYPH.e}${Math.floor(pt.res.e)}  ${RES_GLYPH.s}${Math.floor(pt.res.s)}`);
    if (el.dockSel) {
      const n = state.selection.length;
      const label = n === 0 ? "No selection" : n === 1 ? state.selection[0].def.name : `${n} units`;
      setText(el.dockSel, "docksel", label);
    }
  }

  let lastSelVersion = -1, panelTimer = 0;
  function syncPanels(dt) {
    panelTimer -= dt;
    if (state.selVersion !== lastSelVersion) {
      lastSelVersion = state.selVersion;
      renderSelPanel();
      renderActionsPanel();
      panelTimer = 0.3;
    } else if (panelTimer <= 0) {
      panelTimer = 0.3;
      renderSelPanel();
      updateActionStates();
    }
  }

  function hpLine(o) {
    const sh = o.maxShield > 0 ? ` · shield ${Math.ceil(o.shield)}/${o.maxShield}` : "";
    return `HP ${Math.ceil(o.hp)}/${o.maxHp}${sh}`;
  }

  function renderSelPanel() {
    if (!el.selTitle) return;
    const sel = state.selection.filter((o) => !o.dead);
    if (state.phase !== "playing" || sel.length === 0) {
      el.selTitle.textContent = state.phase === "playing" ? "No selection" : "Standing by";
      el.selFlavor.textContent = state.phase === "playing"
        ? "Drag to box-select units. Right-click (or tap) to command."
        : "Awaiting deployment.";
      el.selBody.innerHTML = "";
      return;
    }
    if (sel.length === 1) {
      const o = sel[0];
      const enemy = o.team !== playerTeam();
      el.selTitle.textContent = (enemy ? "Enemy — " : "") + o.def.name;
      el.selFlavor.textContent = o.def.flavor || "";
      let rows = `<div>${hpLine(o)}</div>`;
      if (o.kind === "unit" && o.def.dmg && !o.def.worker) rows += `<div>DMG ${o.def.dmg} · range ${o.def.range}</div>`;
      if (o.kind === "unit" && o.def.worker) rows += `<div>Carries ${o.def.carry} Matter · repairs ${o.def.repair}/s</div>`;
      if (o.kind === "building" && !o.built) rows += `<div>Constructing — ${Math.floor(o.progress * 100)}%</div>`;
      if (o.kind === "building" && o.built && o.def.kind === "extractor" && o.node) {
        const rk = NODE_RES[o.node.kind];
        const rate = BASE_RATES[o.node.kind] * (o.def.mult ? o.def.mult[rk] : 1);
        rows += o.node.amount !== Infinity && o.node.amount <= 0
          ? `<div>Node depleted</div>`
          : `<div>+${rate.toFixed(2)} ${RES_NAME[rk]}/s</div>`;
      }
      if (o.kind === "building" && o.queue && o.queue.length) {
        const it = o.queue[0];
        rows += `<div>Training ${it.def.name} — ${Math.floor((it.t / it.def.time) * 100)}%` +
          (o.queue.length > 1 ? ` (+${o.queue.length - 1} queued)` : "") + `</div>`;
      }
      if (o.kind === "building" && o.built && o.def.trains && !enemy) rows += `<div class="tls-dim">Right-click ground to set rally</div>`;
      el.selBody.innerHTML = rows;
    } else {
      const counts = {};
      sel.forEach((o) => { counts[o.def.name] = (counts[o.def.name] || 0) + 1; });
      el.selTitle.textContent = `${sel.length} units`;
      el.selFlavor.textContent = "";
      el.selBody.innerHTML = Object.entries(counts).map(([n, c]) => `<div>${c}× ${n}</div>`).join("");
    }
  }

  // ---- action buttons (build + train), rendered into desktop + mobile containers
  let currentActions = [];
  function actionSpecs() {
    const pt = playerTeam();
    if (!pt || state.phase !== "playing") return [];
    const specs = [];
    const sel = state.selection.filter((o) => !o.dead);
    const b = sel.length === 1 && sel[0].kind === "building" && sel[0].team === pt ? sel[0] : null;
    if (b && b.built && b.def.trains) {
      b.def.trains.forEach((key) => {
        const def = pt.faction.units[key];
        specs.push({
          id: `train-${key}`, label: def.name, cost: def.cost, kind: "train",
          run: () => { if (enqueueTrain(b, key)) { Sfx.click(); state.selVersion++; } },
          check: () => {
            if (countUnits(pt) >= UNIT_CAP) return "unit cap";
            if (b.queue.length >= QUEUE_CAP) return "queue full";
            if (!canAfford(pt, def.cost)) return "resources";
            return null;
          },
        });
      });
    }
    ["extractor", "production", "turret"].forEach((key) => {
      const def = pt.faction.buildings[key];
      specs.push({
        id: `build-${key}`, label: def.name, cost: def.cost, kind: "build",
        run: () => {
          Sfx.click();
          state.armed = null;
          state.placing = { def, x: mouse.wx, y: mouse.wy, node: null, valid: false };
          syncCommandButtons();
          updateActionStates();
        },
        check: () => {
          if (key === "turret" && !hasBuilt(pt, "production")) return "needs " + pt.faction.buildings.production.name;
          if (!canAfford(pt, def.cost)) return "resources";
          return null;
        },
      });
    });
    return specs;
  }

  function renderActionsPanel() {
    currentActions = actionSpecs();
    [el.actions, el.actionsM].forEach((host) => {
      if (!host) return;
      host.innerHTML = "";
      currentActions.forEach((spec) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tls-act" + (spec.kind === "train" ? " tls-act--train" : "");
        button.dataset.act = spec.id;
        button.innerHTML = `<strong>${spec.label}</strong><span>${costStr(spec.cost)}</span>`;
        host.appendChild(button);
      });
    });
    updateActionStates();
  }

  function updateActionStates() {
    [el.actions, el.actionsM].forEach((host) => {
      if (!host) return;
      currentActions.forEach((spec) => {
        const node = host.querySelector(`[data-act="${spec.id}"]`);
        if (!node) return;
        const why = spec.check();
        node.disabled = !!why;
        node.title = why || "";
        node.classList.toggle("is-placing", !!(state.placing && spec.id === `build-${state.placing.def.key}`));
      });
    });
  }

  function onActionClick(e) {
    const target = e.target.closest("[data-act]");
    if (!target || target.disabled) return;
    const spec = currentActions.find((s) => s.id === target.dataset.act);
    if (spec) spec.run();
  }
  if (el.actions) el.actions.addEventListener("click", onActionClick);
  if (el.actionsM) el.actionsM.addEventListener("click", onActionClick);

  function log(msg) {
    if (!el.log) return;
    const li = document.createElement("li");
    li.textContent = msg;
    el.log.prepend(li);
    while (el.log.children.length > 6) el.log.removeChild(el.log.lastChild);
  }

  /* ==================================================
     19. TERRAIN (pre-rendered) + RENDER
     ================================================== */
  let terrain = null;
  let fogCanvas = null;
  let fogCtx = null;
  function buildTerrain() {
    terrain = document.createElement("canvas");
    terrain.width = WORLD_W; terrain.height = WORLD_H;
    const t = terrain.getContext("2d");
    if (artReady(Art.terrain)) {
      t.drawImage(Art.terrain, 0, 0, WORLD_W, WORLD_H);
      t.fillStyle = "rgba(2, 4, 11, 0.24)";
      t.fillRect(0, 0, WORLD_W, WORLD_H);
    } else {
      t.fillStyle = "#0b0e18";
      t.fillRect(0, 0, WORLD_W, WORLD_H);
      // sediment patches
      for (let i = 0; i < 90; i++) {
        t.fillStyle = `rgba(${20 + Math.random() * 18}, ${22 + Math.random() * 16}, ${34 + Math.random() * 18}, 0.16)`;
        const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H, r = rand(40, 170);
        t.beginPath(); t.ellipse(x, y, r, r * rand(0.4, 0.9), rand(0, TAU), 0, TAU); t.fill();
      }
      // speckle
      for (let i = 0; i < 900; i++) {
        t.fillStyle = Math.random() < 0.5 ? "rgba(150,160,190,0.05)" : "rgba(0,0,0,0.16)";
        t.fillRect(Math.random() * WORLD_W, Math.random() * WORLD_H, rand(1, 3), rand(1, 3));
      }
      // survey grid
      t.strokeStyle = "rgba(120,140,190,0.045)";
      t.lineWidth = 1;
      for (let x = 0; x <= WORLD_W; x += 128) { t.beginPath(); t.moveTo(x, 0); t.lineTo(x, WORLD_H); t.stroke(); }
      for (let y = 0; y <= WORLD_H; y += 128) { t.beginPath(); t.moveTo(0, y); t.lineTo(WORLD_W, y); t.stroke(); }
      // craters
      for (let i = 0; i < 14; i++) {
        const x = Math.random() * WORLD_W, y = Math.random() * WORLD_H, r = rand(10, 30);
        t.strokeStyle = "rgba(0,0,0,0.35)";
        t.lineWidth = 3;
        t.beginPath(); t.arc(x, y, r, 0, TAU); t.stroke();
        t.strokeStyle = "rgba(160,170,200,0.08)";
        t.lineWidth = 1.5;
        t.beginPath(); t.arc(x, y - 2, r, Math.PI, TAU); t.stroke();
      }
      // the Scar — a glowing fault through the center
      const scar = scarPath();
      t.strokeStyle = "rgba(0,0,0,0.55)";
      t.lineWidth = 26;
      t.lineJoin = "round";
      t.beginPath();
      scar.forEach(([x, y], i) => (i ? t.lineTo(x, y) : t.moveTo(x, y)));
      t.stroke();
      t.strokeStyle = "rgba(96,60,160,0.5)";
      t.lineWidth = 5;
      t.stroke();
      t.strokeStyle = "rgba(216,190,255,0.75)";
      t.lineWidth = 1.6;
      t.stroke();
      // hairline veins off the scar
      t.strokeStyle = "rgba(140,100,220,0.22)";
      t.lineWidth = 1.4;
      [[905, 655, 700, 620, 540, 660], [1015, 640, 1210, 700, 1380, 660], [960, 640, 930, 860, 980, 1010], [960, 640, 1010, 430, 950, 300]].forEach((v) => {
        t.beginPath(); t.moveTo(v[0], v[1]); t.quadraticCurveTo(v[2], v[3], v[4], v[5]); t.stroke();
      });
    }
    // mountains — painted into the ground so they blend with the battlefield art
    const LX = -0.55, LY = -0.83; // light from the northwest
    const rockPoly = (o, scale, ox = 0, oy = 0) => {
      t.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + o.seed;
        const rr = o.r * scale * (0.84 + 0.2 * Math.sin(o.seed * 3 + i * 2.3));
        const px = o.x + ox + Math.cos(a) * rr, py = o.y + oy + Math.sin(a) * rr;
        i ? t.lineTo(px, py) : t.moveTo(px, py);
      }
      t.closePath();
    };
    for (const range of state.mountains) {
      // scree skirt first so overlapping peaks merge into one massif
      for (const o of range.circles) {
        const grd = t.createRadialGradient(o.x, o.y, o.r * 0.4, o.x, o.y, o.r * 1.65);
        grd.addColorStop(0, "rgba(7,9,16,0.5)");
        grd.addColorStop(1, "rgba(7,9,16,0)");
        t.fillStyle = grd;
        t.beginPath(); t.arc(o.x, o.y, o.r * 1.65, 0, TAU); t.fill();
      }
    }
    for (const range of state.mountains) {
      // dark rock mass
      for (const o of range.circles) {
        t.fillStyle = "#151b29";
        rockPoly(o, 1.04);
        t.fill();
        t.strokeStyle = "rgba(140,158,200,0.13)";
        t.lineWidth = 2;
        t.stroke();
      }
      // shaded SE face
      for (const o of range.circles) {
        t.fillStyle = "rgba(0,0,0,0.4)";
        t.beginPath();
        t.ellipse(o.x - LX * o.r * 0.36, o.y - LY * o.r * 0.36, o.r * 0.7, o.r * 0.5, 0.5, 0, TAU);
        t.fill();
      }
      // rising slopes toward each peak
      for (const o of range.circles) {
        t.fillStyle = "#242e42";
        rockPoly(o, 0.64, LX * o.r * 0.1, LY * o.r * 0.14);
        t.fill();
        t.fillStyle = "#38455f";
        rockPoly(o, 0.36, LX * o.r * 0.16, LY * o.r * 0.24);
        t.fill();
        // crevice lines running down from the peak
        t.strokeStyle = "rgba(0,0,0,0.38)";
        t.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const a = o.seed + i * 2.2;
          t.beginPath();
          t.moveTo(o.x + LX * o.r * 0.16, o.y + LY * o.r * 0.24);
          t.lineTo(o.x + Math.cos(a) * o.r * 0.92, o.y + Math.sin(a) * o.r * 0.92);
          t.stroke();
        }
        // snow cap on the tallest peaks
        if (o.r >= 50) {
          t.fillStyle = "rgba(176,192,214,0.85)";
          rockPoly(o, 0.18, LX * o.r * 0.18, LY * o.r * 0.28);
          t.fill();
        }
      }
      // crest line along the ridge spine
      if (range.circles.length > 1) {
        t.strokeStyle = "rgba(110,128,168,0.4)";
        t.lineWidth = 2.4;
        t.lineJoin = "round";
        t.beginPath();
        range.circles.forEach((o, i) => {
          const px = o.x + LX * o.r * 0.16, py = o.y + LY * o.r * 0.24;
          i ? t.lineTo(px, py) : t.moveTo(px, py);
        });
        t.stroke();
      }
    }
  }

  function renderMenuBackdrop() {
    ctx.fillStyle = "#070610";
    ctx.fillRect(0, 0, W, H);
    const pulse = (state.vt % 6) / 6;
    const grd = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, H * 0.72);
    grd.addColorStop(0, `rgba(176,108,255,${0.16 * (1 - pulse)})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }

  function renderFog(cam) {
    if (!fogActive()) return;
    if (!fogCanvas) {
      fogCanvas = document.createElement("canvas");
      fogCanvas.width = W;
      fogCanvas.height = H;
      fogCtx = fogCanvas.getContext("2d");
    }
    fogCtx.clearRect(0, 0, W, H);
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.fillStyle = "rgb(1,2,8)";
    fogCtx.fillRect(0, 0, W, H);
    fogCtx.globalCompositeOperation = "destination-out";
    for (const s of state.vision) {
      const x = s.x - cam.x, y = s.y - cam.y, r = s.r;
      if (x < -r || y < -r || x > W + r || y > H + r) continue;
      const grd = fogCtx.createRadialGradient(x, y, Math.max(12, r * 0.46), x, y, r);
      grd.addColorStop(0, "rgba(0,0,0,1)");
      grd.addColorStop(0.68, "rgba(0,0,0,0.9)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      fogCtx.fillStyle = grd;
      fogCtx.beginPath();
      fogCtx.arc(x, y, r, 0, TAU);
      fogCtx.fill();
    }
    fogCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(fogCanvas, 0, 0);
  }

  function render() {
    const cam = state.cam;
    ctx.clearRect(0, 0, W, H);
    refreshVision();
    if (menuMapHidden()) {
      renderMenuBackdrop();
      renderVignette();
      return;
    }
    if (terrain) ctx.drawImage(terrain, cam.x, cam.y, W, H, 0, 0, W, H);

    // signal pulse rings from the scar center
    const pulse = (state.vt % 5) / 5;
    ctx.strokeStyle = `rgba(176,108,255,${0.28 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER.x - cam.x, CENTER.y - cam.y, 30 + pulse * 420, 0, TAU);
    ctx.stroke();

    renderDecals(cam);
    renderNodes(cam);
    renderRocks(cam);
    if (state.placing) renderUplinkRadii(cam);
    renderSelectionRings(cam);
    renderEntities(cam);
    renderBeams(cam);
    renderProjectiles(cam);
    renderParticles(cam);
    renderBarsAndRanges(cam);
    renderCommandFeedback(cam);
    if (dragging && dragStart) {
      ctx.strokeStyle = "rgba(140,240,180,0.9)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(dragStart.x, dragStart.y, mouse.cx - dragStart.x, mouse.cy - dragStart.y);
      ctx.setLineDash([]);
    }
    if (state.placing) renderGhost(cam);
    renderFog(cam);
    renderVignette();
    if (state.phase === "playing" || state.phase === "over") renderMinimap();
  }

  function renderDecals(cam) {
    for (const d of state.decals) {
      ctx.fillStyle = `rgba(6,6,10,${Math.min(0.55, d.ttl / 20)})`;
      ctx.beginPath();
      ctx.ellipse(d.x - cam.x, d.y - cam.y, d.r * 1.1, d.r * 0.8, 0, 0, TAU);
      ctx.fill();
    }
  }

  function renderNodes(cam) {
    for (const n of state.nodes) {
      if (!isVisibleToPlayer(n.x, n.y, n.r + 8)) continue;
      const x = n.x - cam.x, y = n.y - cam.y;
      if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
      const dim = false;
      const c = NODE_COLORS[n.kind];
      const depleted = n.amount !== Infinity && n.amount <= 0;
      const glow = dim ? 0.04 : depleted ? 0.05 : 0.16 + 0.07 * Math.sin(state.vt * 2 + n.seed);
      if (dim) ctx.globalAlpha = 0.42;
      const grd = ctx.createRadialGradient(x, y, 2, x, y, n.r * 2.2);
      grd.addColorStop(0, c + Math.floor(glow * 255).toString(16).padStart(2, "0"));
      grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, n.r * 2.2, 0, TAU); ctx.fill();

      if (n.kind === "matter") {
        // crystal cluster
        ctx.save(); ctx.translate(x, y);
        for (let i = 0; i < 4; i++) {
          const a = n.seed + i * 1.7, rr = n.r * (0.5 + (i % 2) * 0.42);
          ctx.fillStyle = depleted ? "#26332f" : i % 2 ? "#3f8f74" : "#5fd6a7";
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr - 7);
          ctx.lineTo(Math.cos(a) * rr + 5, Math.sin(a) * rr + 5);
          ctx.lineTo(Math.cos(a) * rr - 5, Math.sin(a) * rr + 5);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      } else if (n.kind === "energy") {
        ctx.strokeStyle = "#8f7326";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, n.r * 0.85, 0, TAU); ctx.stroke();
        ctx.fillStyle = "#141018";
        ctx.beginPath(); ctx.arc(x, y, n.r * 0.7, 0, TAU); ctx.fill();
        const fl = 0.55 + 0.35 * Math.sin(state.vt * 5 + n.seed);
        ctx.fillStyle = `rgba(255,212,59,${fl})`;
        ctx.beginPath(); ctx.arc(x, y, n.r * 0.34, 0, TAU); ctx.fill();
      } else {
        // signal fracture: violet monolith shard
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = "#241436";
        ctx.beginPath();
        ctx.moveTo(0, -n.r - 6); ctx.lineTo(n.r * 0.62, n.r * 0.6); ctx.lineTo(-n.r * 0.62, n.r * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#b06cff";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const fl = 0.5 + 0.4 * Math.sin(state.vt * 3 + n.seed);
        ctx.strokeStyle = `rgba(216,190,255,${fl})`;
        ctx.beginPath(); ctx.moveTo(0, -n.r - 2); ctx.lineTo(0, n.r * 0.45); ctx.stroke();
        ctx.restore();
      }

      if (n.claimTeam && !n.team) {
        const p = clamp(n.claimProgress / CLAIM_TIME, 0, 1);
        ctx.strokeStyle = n.claimTeam.faction.color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x, y, n.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * p);
        ctx.stroke();
      }
      if (n.team) {
        const fc = n.team.faction.color;
        ctx.save();
        ctx.shadowColor = fc;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = fc;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, n.r + 8, 0, TAU);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(4,7,14,0.82)";
        ctx.beginPath();
        ctx.arc(x, y - n.r - 13, 6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = fc;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - n.r - 16);
        ctx.lineTo(x + 5, y - n.r - 13);
        ctx.lineTo(x - 3, y - n.r - 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (n.hp < n.maxHp || state.time - n.lastHit < 3) {
          const w = 28;
          const by = y + n.r + 11;
          ctx.fillStyle = "rgba(6,8,14,0.82)";
          ctx.fillRect(x - w / 2, by, w, 4);
          ctx.fillStyle = clamp(n.hp / n.maxHp, 0, 1) > 0.4 ? fc : "#ff5268";
          ctx.fillRect(x - w / 2, by, w * clamp(n.hp / n.maxHp, 0, 1), 4);
        }
      }
      if (dim) ctx.globalAlpha = 1;
    }
  }

  function renderRocks(cam) {
    for (const rk of state.rocks) {
      if (rk.dead) continue;
      const x = rk.x - cam.x, y = rk.y - cam.y;
      if (x < -80 || y < -80 || x > W + 80 || y > H + 80) continue;
      const frac = clamp(rk.hp / rk.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(x + 3, y + 5, rk.r * 1.05, rk.r * 0.72, 0, 0, TAU); ctx.fill();
      // warm sand-toned boulder cluster — visually distinct from cold mountains
      for (let i = 0; i < 4; i++) {
        const a = rk.seed + i * 1.9;
        const lx = x + Math.cos(a) * rk.r * 0.36;
        const ly = y + Math.sin(a) * rk.r * 0.32;
        const lr = rk.r * (0.52 + (i % 2) * 0.22);
        ctx.fillStyle = i % 2 ? "#3e372a" : "#514734";
        ctx.beginPath();
        for (let k = 0; k < 7; k++) {
          const b = (k / 7) * TAU + a;
          const rr = lr * (0.8 + 0.24 * Math.sin(a * 2 + k * 2.1));
          const px = lx + Math.cos(b) * rr, py = ly + Math.sin(b) * rr;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = "rgba(226,199,143,0.3)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x - rk.r * 0.18, y - rk.r * 0.22, rk.r * 0.55, Math.PI * 0.85, Math.PI * 1.7); ctx.stroke();
      // cracks spread as it takes damage
      if (frac < 0.98) {
        ctx.strokeStyle = "rgba(8,6,3,0.85)";
        ctx.lineWidth = 1.4;
        const cracks = frac < 0.34 ? 4 : frac < 0.67 ? 2 : 1;
        for (let i = 0; i < cracks; i++) {
          const a = rk.seed * 2 + i * 2.1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * rk.r * 0.7, y + Math.sin(a) * rk.r * 0.7);
          ctx.lineTo(x + Math.cos(a + 0.5) * rk.r * 0.98, y + Math.sin(a + 0.5) * rk.r * 0.98);
          ctx.stroke();
        }
      }
      if (state.time - rk.lastHit < 3) {
        const w = Math.max(26, rk.r * 1.6);
        ctx.fillStyle = "rgba(6,8,14,0.82)";
        ctx.fillRect(x - w / 2, y - rk.r - 12, w, 4);
        ctx.fillStyle = "#e8c37a";
        ctx.fillRect(x - w / 2, y - rk.r - 12, w * frac, 4);
      }
    }
  }

  function renderUplinkRadii(cam) {
    const pt = playerTeam();
    if (!pt || state.placing.def.kind === "extractor") return;
    for (const b of state.buildings) {
      if (b.dead || b.team !== pt) continue;
      ctx.strokeStyle = "rgba(140,240,180,0.14)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(b.x - cam.x, b.y - cam.y, BUILD_RADIUS, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function renderSelectionRings(cam) {
    for (const o of state.selection) {
      if (o.dead) continue;
      const r = o.def.r + 5;
      ctx.strokeStyle = o.team === playerTeam() ? "rgba(140,240,180,0.85)" : "rgba(255,120,120,0.8)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(o.x - cam.x, o.y - cam.y + (o.kind === "building" ? o.def.r * 0.35 : r * 0.55), r, r * 0.55, 0, 0, TAU);
      ctx.stroke();
    }
    // rally line for a single selected production building
    const sel = state.selection;
    if (sel.length === 1 && sel[0].kind === "building" && sel[0].rally && sel[0].team === playerTeam()) {
      const b = sel[0];
      ctx.strokeStyle = "rgba(140,240,180,0.4)";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(b.x - cam.x, b.y - cam.y);
      ctx.lineTo(b.rally.x - cam.x, b.rally.y - cam.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(b.rally.x - cam.x, b.rally.y - cam.y, 5, 0, TAU); ctx.stroke();
    }
  }

  function renderEntities(cam) {
    const drawables = [];
    for (const b of state.buildings) if (!b.dead) drawables.push(b);
    for (const u of state.units) if (!u.dead) drawables.push(u);
    drawables.sort((a, b2) => a.y - b2.y);
    for (const o of drawables) {
      if (!thingVisibleToPlayer(o)) continue;
      const x = o.x - cam.x, y = o.y - cam.y;
      const pad = o.kind === "building" ? o.def.r + 30 : 40;
      if (x < -pad || y < -pad || x > W + pad || y > H + pad) continue;
      ctx.save();
      ctx.translate(x, y);
      if (o.kind === "building") drawBuilding(o);
      else drawUnit(o);
      ctx.restore();
    }
  }

  function drawAtlasCell(img, map, key, size, yOffset = 0, bounds = null) {
    const cell = map[key];
    if (!cell || !artReady(img)) return false;
    const sw = img.naturalWidth / ATLAS_COLS;
    const sh = img.naturalHeight / ATLAS_ROWS;
    const src = bounds && bounds[key]
      ? bounds[key]
      : { x: cell[0] * sw, y: cell[1] * sh, w: sw, h: sh };
    const aspect = src.w / src.h;
    const dw = aspect >= 1 ? size : size * aspect;
    const dh = aspect >= 1 ? size / aspect : size;
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, src.x, src.y, src.w, src.h, -dw / 2, yOffset - dh / 2, dw, dh);
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.imageSmoothingQuality = prevQuality;
    return true;
  }

  function unitAtlasSize(u) {
    const k = u.def.key;
    const mult = k === "heavy" ? 7.1 : k === "ranged" ? 7.3 : k === "worker" ? 7.2 : 7.2;
    return u.def.r * mult;
  }

  function buildingAtlasSize(b) {
    const k = b.def.kind;
    const mult = k === "hq" ? 3.05 : k === "production" ? 3.35 : k === "extractor" ? 3.75 : 4.2;
    return b.def.r * mult;
  }

  function drawCarryBadge(r) {
    ctx.fillStyle = NODE_COLORS.matter;
    ctx.beginPath();
    ctx.arc(0, -r * 1.55, Math.max(3, r * 0.28), 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(230,255,244,0.75)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /* ---------- unit art ---------- */
  function drawUnit(u) {
    const f = u.team.faction;
    const hover = u.fid === "aliens";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.beginPath();
    ctx.ellipse(0, u.def.r * 0.7, u.def.r * 1.42, u.def.r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.strokeStyle = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 9;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.ellipse(0, u.def.r * 0.62, u.def.r * 1.48, u.def.r * 0.66, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    if (hover) ctx.translate(0, -4 + Math.sin(state.vt * 2.2 + u.bob) * 2.2);
    ctx.rotate(u.face + Math.PI / 2); // art drawn pointing up
    const r = u.def.r;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = u.def.key === "heavy" ? 16 : 12;
    const drewAtlas = drawAtlasCell(Art.units, UNIT_ATLAS, u.def.art, unitAtlasSize(u), 0, AtlasBounds.units);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    if (drewAtlas) {
      if (u.carry > 0) drawCarryBadge(r);
      return;
    }
    switch (u.def.art) {
      case "h-worker": {
        ctx.fillStyle = f.dark;
        ctx.fillRect(-r * 0.8, -r * 0.9, r * 1.6, r * 1.8);
        ctx.fillStyle = f.color;
        ctx.fillRect(-r * 0.8, -r * 0.9, r * 1.6, r * 0.65);
        ctx.fillStyle = f.color2;
        ctx.fillRect(-r * 0.8, r * 0.35, r * 1.6, r * 0.28);
        ctx.fillStyle = "#dfe8f6";
        ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.34, 0, TAU); ctx.fill();
        if (u.carry > 0) { ctx.fillStyle = NODE_COLORS.matter; ctx.fillRect(-r * 0.3, -r * 1.3, r * 0.6, r * 0.5); }
        break;
      }
      case "h-basic": {
        for (const side of [-1, 1]) {
          ctx.save(); ctx.translate(side * r * 0.52, side * r * 0.2);
          ctx.fillStyle = f.dark;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(0, -r * 0.08, r * 0.3, 0, TAU); ctx.fill();
          ctx.strokeStyle = "#d9e4f2";
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(0, -r * 0.2); ctx.lineTo(0, -r * 1.05); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "h-ranged": {
        ctx.fillStyle = f.dark;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.1); ctx.lineTo(r * 0.85, r * 0.9); ctx.lineTo(-r * 0.85, r * 0.9);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = f.color; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = "#20293d";
        ctx.fillRect(-r * 0.95, -r * 0.1, r * 0.35, r * 0.9);
        ctx.fillRect(r * 0.6, -r * 0.1, r * 0.35, r * 0.9);
        ctx.strokeStyle = "#cfeaff";
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.2); ctx.lineTo(0, -r * 1.7); ctx.stroke();
        ctx.fillStyle = f.color2;
        ctx.beginPath(); ctx.arc(0, r * 0.25, r * 0.28, 0, TAU); ctx.fill();
        break;
      }
      case "h-heavy": {
        // legs
        ctx.strokeStyle = "#233049";
        ctx.lineWidth = 3;
        for (const [lx, ly] of [[-1, -0.7], [1, -0.7], [-1, 0.8], [1, 0.8]]) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lx * r * 1.05, ly * r); ctx.stroke();
        }
        ctx.fillStyle = f.dark;
        ctx.fillRect(-r * 0.75, -r * 0.85, r * 1.5, r * 1.7);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-r * 0.75, -r * 0.85, r * 1.5, r * 1.7);
        ctx.strokeStyle = "#cfd9ea";
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.6); ctx.lineTo(-r * 0.3, -r * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.6); ctx.lineTo(r * 0.3, -r * 1.5); ctx.stroke();
        ctx.fillStyle = f.color2;
        ctx.fillRect(-r * 0.5, r * 0.3, r, r * 0.28);
        break;
      }
      case "r-worker": {
        ctx.fillStyle = f.dark;
        ctx.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
        ctx.strokeStyle = f.color2;
        ctx.beginPath(); ctx.moveTo(-r * 0.85, -r * 0.4); ctx.lineTo(-r * 1.3, -r * 0.9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.85, -r * 0.4); ctx.lineTo(r * 1.3, -r * 0.9); ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill();
        if (u.carry > 0) { ctx.fillStyle = NODE_COLORS.matter; ctx.fillRect(-r * 0.3, -r * 1.35, r * 0.6, r * 0.5); }
        break;
      }
      case "r-basic": {
        ctx.fillStyle = f.dark;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.15); ctx.lineTo(r * 0.9, r * 0.85); ctx.lineTo(0, r * 0.4); ctx.lineTo(-r * 0.9, r * 0.85);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = f.color; ctx.lineWidth = 1.7; ctx.stroke();
        // spinning shear disc at nose
        ctx.save();
        ctx.translate(0, -r * 0.95);
        ctx.rotate(state.vt * 14 + u.bob);
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.5); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case "r-ranged": {
        ctx.strokeStyle = "#3a2026";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.9); ctx.lineTo(-r * 0.3, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.5, r * 0.9); ctx.lineTo(r * 0.3, 0); ctx.stroke();
        ctx.fillStyle = f.dark;
        ctx.fillRect(-r * 0.55, -r * 1.1, r * 1.1, r * 1.3);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(-r * 0.55, -r * 1.1, r * 1.1, r * 1.3);
        const gl = 0.6 + 0.4 * Math.sin(state.vt * 6 + u.bob);
        ctx.fillStyle = `rgba(125,243,255,${gl})`;
        ctx.beginPath(); ctx.arc(0, -r * 0.55, r * 0.32, 0, TAU); ctx.fill();
        break;
      }
      case "r-heavy": {
        ctx.fillStyle = f.dark;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU - Math.PI / 2;
          const px = Math.cos(a) * r, py = Math.sin(a) * r;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#e8ecf4";
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.5); ctx.lineTo(-r * 0.4, -r * 1.4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.4, -r * 0.5); ctx.lineTo(r * 0.4, -r * 1.4); ctx.stroke();
        break;
      }
      case "a-worker": {
        ctx.fillStyle = f.dark;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.05);
        ctx.quadraticCurveTo(r, -r * 0.2, 0, r * 0.9);
        ctx.quadraticCurveTo(-r, -r * 0.2, 0, -r * 1.05);
        ctx.fill();
        ctx.strokeStyle = f.color; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 1.2;
        for (const s of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(s * r * 0.3, r * 0.6);
          ctx.quadraticCurveTo(s * r * 0.6, r * 1.2, s * r * 0.25, r * 1.5);
          ctx.stroke();
        }
        ctx.fillStyle = f.color2;
        ctx.beginPath(); ctx.arc(0, -r * 0.25, r * 0.24, 0, TAU); ctx.fill();
        if (u.carry > 0) { ctx.fillStyle = NODE_COLORS.matter; ctx.beginPath(); ctx.arc(0, -r * 1.2, r * 0.32, 0, TAU); ctx.fill(); }
        break;
      }
      case "a-basic": {
        ctx.fillStyle = f.dark;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.4);
        ctx.quadraticCurveTo(r * 0.95, 0, 0, r * 0.9);
        ctx.quadraticCurveTo(r * 0.28, -r * 0.2, 0, -r * 1.4);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.4);
        ctx.quadraticCurveTo(-r * 0.95, 0, 0, r * 0.9);
        ctx.quadraticCurveTo(-r * 0.28, -r * 0.2, 0, -r * 1.4);
        ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, -r * 1.4); ctx.lineTo(0, r * 0.9); ctx.stroke();
        ctx.fillStyle = f.color2;
        ctx.beginPath(); ctx.arc(0, -r * 0.35, r * 0.18, 0, TAU); ctx.fill();
        break;
      }
      case "a-ranged": {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.45, state.vt * 0.8 + u.bob, 0, TAU); ctx.stroke();
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.stroke();
        const gl = 0.55 + 0.4 * Math.sin(state.vt * 3.4 + u.bob);
        ctx.fillStyle = `rgba(216,190,255,${gl})`;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = "#1a1030";
        ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fill();
        break;
      }
      case "a-heavy": {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + state.vt * 0.4;
          ctx.fillStyle = i % 2 ? f.dark : "#2a1a48";
          ctx.beginPath();
          ctx.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.62, r * 0.3, a, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.stroke();
        const gl = 0.6 + 0.35 * Math.sin(state.vt * 2.6 + u.bob);
        ctx.fillStyle = `rgba(125,255,154,${gl})`;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, TAU); ctx.fill();
        break;
      }
    }
  }

  /* ---------- building art ---------- */
  function drawBuilding(b) {
    const f = b.team.faction;
    const r = b.def.r;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 1.15, r * 0.5, 0, 0, TAU);
    ctx.fill();
    if (!b.built) ctx.globalAlpha = 0.55;

    if (drawAtlasCell(Art.buildings, BUILDING_ATLAS, b.def.art, buildingAtlasSize(b), -r * 0.08)) {
      if (b.built && b.def.dmg > 0 && b.target && !b.target.dead) {
        ctx.save();
        ctx.rotate(b.face + Math.PI / 2);
        ctx.strokeStyle = b.def.proj === "psi" ? "rgba(216,190,255,0.9)" : b.def.proj === "arc" ? "rgba(125,243,255,0.9)" : "rgba(230,238,255,0.86)";
        ctx.lineWidth = Math.max(2, r * 0.06);
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.15);
        ctx.lineTo(0, -r * 1.25);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (!b.built) {
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, b.progress));
        ctx.stroke();
      }
      return;
    }

    switch (b.def.art) {
      case "h-hq": {
        ctx.fillStyle = "#182338";
        rrect(-r, -r * 0.66, r * 2, r * 1.35, 8);
        ctx.fillStyle = f.dark;
        rrect(-r * 0.7, -r * 0.95, r * 1.4, r * 0.7, 6);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        strokeRrect(-r, -r * 0.66, r * 2, r * 1.35, 8);
        ctx.strokeStyle = "#94a6c4";
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.95); ctx.lineTo(r * 0.55, -r * 1.6); ctx.stroke();
        const bl = 0.5 + 0.5 * Math.sin(state.vt * 2.6);
        ctx.fillStyle = `rgba(255,180,84,${bl})`;
        ctx.beginPath(); ctx.arc(r * 0.55, -r * 1.62, 3.4, 0, TAU); ctx.fill();
        ctx.fillStyle = f.color2;
        for (const s of [-0.55, -0.1, 0.35]) ctx.fillRect(-r * 0.82, r * s * 0.6 - 3, r * 0.34, 6);
        ctx.fillStyle = f.color;
        ctx.fillRect(-r * 0.25, r * 0.18, r * 0.5, r * 0.5);
        break;
      }
      case "h-ext": {
        ctx.fillStyle = f.dark;
        rrect(-r * 0.95, -r * 0.35, r * 1.9, r * 1.15, 5);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6;
        strokeRrect(-r * 0.95, -r * 0.35, r * 1.9, r * 1.15, 5);
        // derrick + pump piston
        ctx.strokeStyle = "#93a3bf";
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(0, -r * 1.35); ctx.lineTo(r * 0.55, 0); ctx.stroke();
        const p = b.built ? Math.abs(Math.sin(state.vt * 3)) : 0;
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -r * 1.35); ctx.lineTo(0, -r * 0.4 + p * r * 0.5); ctx.stroke();
        break;
      }
      case "h-prod": {
        ctx.fillStyle = "#182338";
        rrect(-r, -r * 0.55, r * 2, r * 1.15, 6);
        ctx.fillStyle = f.dark;
        rrect(-r, -r * 0.85, r * 2, r * 0.45, 6);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        strokeRrect(-r, -r * 0.55, r * 2, r * 1.15, 6);
        ctx.fillStyle = "#0c1220";
        rrect(-r * 0.3, -r * 0.1, r * 0.6, r * 0.7, 3);
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-r * 0.85, -r * 0.85); ctx.lineTo(-r * 0.85, -r * 1.45); ctx.stroke();
        ctx.fillStyle = f.color2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.85, -r * 1.45); ctx.lineTo(-r * 0.45, -r * 1.32); ctx.lineTo(-r * 0.85, -r * 1.2);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "h-tur": {
        ctx.fillStyle = "#182338";
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
        ctx.save();
        ctx.rotate(b.face + Math.PI / 2);
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#d9e4f2";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.5); ctx.stroke();
        ctx.restore();
        break;
      }
      case "r-hq": {
        hex(r * 1.05, f.dark);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.save();
        ctx.rotate(state.vt * 0.5);
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 1.6;
        hexPath(r * 0.62);
        ctx.stroke();
        ctx.restore();
        const bl = 0.55 + 0.45 * Math.sin(state.vt * 3);
        ctx.fillStyle = `rgba(255,74,87,${bl})`;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fill();
        break;
      }
      case "r-ext": {
        hex(r * 0.9, f.dark);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const a = state.vt * 1.6 + (i / 3) * TAU;
          ctx.fillStyle = f.color2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.1, Math.sin(a) * r * 0.55, 3, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = "#8b93ad";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.3); ctx.stroke();
        break;
      }
      case "r-prod": {
        ctx.fillStyle = f.dark;
        rrect(-r, -r * 0.6, r * 2, r * 1.2, 4);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        strokeRrect(-r, -r * 0.6, r * 2, r * 1.2, 4);
        ctx.strokeStyle = "#8b93ad";
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-r, -r * 0.6); ctx.lineTo(-r, -r * 1.25); ctx.lineTo(r, -r * 1.25); ctx.lineTo(r, -r * 0.6); ctx.stroke();
        if (b.built && b.queue.length) {
          const wl = 0.4 + 0.5 * Math.abs(Math.sin(state.vt * 9));
          ctx.fillStyle = `rgba(125,243,255,${wl})`;
          ctx.beginPath(); ctx.arc(rand(-r * 0.4, r * 0.4), -r * 0.4, 1.6, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = f.color2;
        ctx.fillRect(-r * 0.55, -r * 0.15, r * 1.1, r * 0.3);
        break;
      }
      case "r-tur": {
        hex(r, f.dark);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.strokeStyle = "#8b93ad";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.7); ctx.stroke();
        const bl = 0.5 + 0.5 * Math.sin(state.vt * 8);
        ctx.fillStyle = `rgba(125,243,255,${bl})`;
        ctx.beginPath(); ctx.arc(0, -r * 1.7, 4.4, 0, TAU); ctx.fill();
        break;
      }
      case "a-hq": {
        // organic heart with petals
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU + Math.sin(state.vt * 0.7) * 0.06;
          ctx.fillStyle = i % 2 ? "#241436" : f.dark;
          ctx.beginPath();
          ctx.ellipse(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.42, r * 0.72, r * 0.3, a, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 0.62, 0, 0, TAU); ctx.stroke();
        const pl = 0.5 + 0.45 * Math.sin(state.vt * 2);
        ctx.fillStyle = `rgba(176,108,255,${pl})`;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.4, r * 0.32, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(125,255,154,${pl * 0.9})`;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, TAU); ctx.fill();
        break;
      }
      case "a-ext": {
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.9, r * 0.66, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = f.color2;
        ctx.lineWidth = 1.6;
        for (const s of [-1, -0.3, 0.4, 1]) {
          ctx.beginPath();
          ctx.moveTo(s * r * 0.5, r * 0.3);
          ctx.quadraticCurveTo(s * r * 0.9, r * 0.9, s * r * 0.6, r * 1.25);
          ctx.stroke();
        }
        const pl = 0.5 + 0.4 * Math.sin(state.vt * 2.4);
        ctx.fillStyle = `rgba(176,108,255,${pl})`;
        ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.26, 0, TAU); ctx.fill();
        break;
      }
      case "a-prod": {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, r * 0.2, r, Math.PI, 0); ctx.stroke();
        const grd = ctx.createLinearGradient(0, -r, 0, r * 0.3);
        grd.addColorStop(0, "rgba(176,108,255,0.5)");
        grd.addColorStop(1, "rgba(26,16,48,0.85)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.92, Math.PI, 0); ctx.closePath(); ctx.fill();
        const sh = 0.4 + 0.3 * Math.sin(state.vt * 3.2);
        ctx.strokeStyle = `rgba(125,255,154,${sh})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.6, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = f.dark;
        ctx.fillRect(-r, r * 0.1, r * 2, r * 0.24);
        break;
      }
      case "a-tur": {
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.ellipse(0, r * 0.15, r * 0.85, r * 0.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#241436";
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.9); ctx.lineTo(r * 0.5, r * 0.1); ctx.lineTo(-r * 0.5, r * 0.1);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const gl = 0.5 + 0.45 * Math.sin(state.vt * 5);
        ctx.strokeStyle = `rgba(216,190,255,${gl})`;
        ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.lineTo(0, 0); ctx.stroke();
        break;
      }
    }
    ctx.globalAlpha = 1;
    if (!b.built) {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, b.progress));
      ctx.stroke();
    }
  }

  function rrect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fill();
  }
  function strokeRrect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.stroke();
  }
  function hexPath(r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function hex(r, fill) {
    hexPath(r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function renderBeams(cam) {
    for (const b of state.beams) {
      const a = b.ttl / 0.14;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      if (b.type === "arc") {
        const segs = 6;
        ctx.moveTo(b.x1 - cam.x, b.y1 - cam.y);
        for (let i = 1; i <= segs; i++) {
          const t = i / segs;
          const jx = i === segs ? 0 : rand(-7, 7), jy = i === segs ? 0 : rand(-7, 7);
          ctx.lineTo(lerp(b.x1, b.x2, t) - cam.x + jx, lerp(b.y1, b.y2, t) - cam.y + jy);
        }
      } else {
        ctx.moveTo(b.x1 - cam.x, b.y1 - cam.y);
        ctx.lineTo(b.x2 - cam.x, b.y2 - cam.y);
      }
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function renderProjectiles(cam) {
    for (const p of state.projectiles) {
      const x = p.x - cam.x, y = p.y - cam.y;
      if (p.type === "rail") {
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - (dx / d) * 16, y - (dy / d) * 16);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, p.type === "shell" || p.type === "plasma" || p.type === "spore" ? 4 : 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill();
      }
    }
  }

  function renderParticles(cam) {
    for (const p of state.particles) {
      const a = clamp(p.ttl / p.max, 0, 1);
      const x = p.x - cam.x, y = p.y - cam.y;
      if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = a * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, p.size * (1.4 - a * 0.9), 0, TAU); ctx.stroke();
      } else if (p.type === "puff") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.arc(x, y, p.size * (1.6 - a), 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function renderBarsAndRanges(cam) {
    const showAll = state.selection.length > 0;
    for (const o of [...state.units, ...state.buildings]) {
      if (o.dead) continue;
      const sel = state.selection.includes(o);
      const hurt = o.hp < o.maxHp || (o.maxShield > 0 && o.shield < o.maxShield);
      const recent = state.time - o.lastHit < 3;
      if (!sel && !(hurt && recent) && !(o.kind === "building" && !o.built) && !(hurt && o.kind === "building")) continue;
      const x = o.x - cam.x, y = o.y - cam.y;
      const r = o.def.r;
      const w = Math.max(20, r * 2.1);
      const by = y - r - (o.kind === "building" ? r * 0.5 + 8 : 12);
      ctx.fillStyle = "rgba(6,8,14,0.8)";
      ctx.fillRect(x - w / 2, by, w, 4);
      const pct = clamp(o.hp / o.maxHp, 0, 1);
      ctx.fillStyle = pct > 0.55 ? "#6bff7d" : pct > 0.25 ? "#ffd43b" : "#ff4f68";
      ctx.fillRect(x - w / 2, by, w * pct, 4);
      if (o.maxShield > 0) {
        ctx.fillStyle = "rgba(6,8,14,0.8)";
        ctx.fillRect(x - w / 2, by - 4, w, 3);
        ctx.fillStyle = "#9fd0ff";
        ctx.fillRect(x - w / 2, by - 4, w * clamp(o.shield / o.maxShield, 0, 1), 3);
      }
      // attack range ring for selected combat things
      if (sel && o.def.range > 40 && o.team === playerTeam()) {
        ctx.strokeStyle = "rgba(255,255,255,0.09)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, o.def.range, 0, TAU); ctx.stroke();
      }
    }
  }

  function renderGhost(cam) {
    const g = state.placing;
    const x = g.x - cam.x, y = g.y - cam.y;
    ctx.globalAlpha = 0.55;
    ctx.save();
    ctx.translate(x, y);
    const fake = { team: playerTeam(), def: g.def, built: true, progress: 1, queue: [], face: 0, node: g.node };
    drawBuilding(fake);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g.valid ? "rgba(120,255,160,0.85)" : "rgba(255,90,90,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(x, y, g.def.r + 10, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (g.def.kind === "extractor") {
      const msg = !g.node
        ? "PLACE ON A RESOURCE NODE"
        : !isNodeClaimedBy(g.node, playerTeam())
          ? "CLAIM NODE FIRST"
          : g.node.rig
            ? "NODE OCCUPIED"
            : "";
      if (!msg) return;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(msg, x, y - g.def.r - 18);
    }
  }

  function activeCommandPreview() {
    if (
      !mouse.inside ||
      mouse.touch ||
      dragging ||
      mmDrag ||
      touchPan ||
      state.phase !== "playing" ||
      state.paused ||
      state.placing ||
      inMinimap({ x: mouse.cx, y: mouse.cy })
    ) return null;
    return commandPreviewAt(mouse.wx, mouse.wy);
  }

  function renderCommandFeedback(cam) {
    for (const fx of state.commandFx) {
      const a = clamp(fx.ttl / fx.max, 0, 1);
      drawCommandGlyph(fx.type, fx.x - cam.x, fx.y - cam.y, {
        alpha: Math.min(1, a * 1.4),
        scale: 1 + (1 - a) * 0.62,
        pulse: 1 - a,
        label: false,
      });
    }
    const preview = activeCommandPreview();
    if (!preview) return;
    drawCommandGlyph(preview.type, preview.x - cam.x, preview.y - cam.y, {
      alpha: 0.96,
      scale: 1,
      pulse: (Math.sin(state.vt * 5.8) + 1) * 0.5,
      label: true,
    });
  }

  function drawCommandGlyph(type, x, y, opts) {
    const cfg = COMMAND_HINTS[type] || COMMAND_HINTS.move;
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const scale = opts.scale || 1;
    const pulse = opts.pulse || 0;
    const sx = clamp(x, 24, W - 24);
    const sy = clamp(y, 28, H - 28);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = cfg.shadow;
    ctx.shadowBlur = opts.label ? 14 : 10;

    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14 + pulse * 5, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(5,8,15,0.76)";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();

    if (type === "attack" || type === "attackMove" || type === "breach") {
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-14, 0); ctx.lineTo(-7, 0);
      ctx.moveTo(7, 0); ctx.lineTo(14, 0);
      ctx.moveTo(0, -14); ctx.lineTo(0, -7);
      ctx.moveTo(0, 7); ctx.lineTo(0, 14);
      ctx.stroke();
      if (type === "attackMove") {
        ctx.fillStyle = cfg.color;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(5, 3);
        ctx.lineTo(2, 3);
        ctx.lineTo(2, 9);
        ctx.lineTo(-2, 9);
        ctx.lineTo(-2, 3);
        ctx.lineTo(-5, 3);
        ctx.closePath();
        ctx.fill();
      }
    } else if (type === "claim") {
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-5, 10);
      ctx.lineTo(-5, -11);
      ctx.stroke();
      ctx.fillStyle = cfg.color;
      ctx.beginPath();
      ctx.moveTo(-3, -10);
      ctx.lineTo(9, -6);
      ctx.lineTo(9, 2);
      ctx.lineTo(-3, -2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(235,255,255,0.95)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(2, 5, 7, 0, TAU);
      ctx.stroke();
    } else if (type === "gather") {
      ctx.fillStyle = cfg.color;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(8, -1);
      ctx.lineTo(2, 11);
      ctx.lineTo(-8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(235,255,247,0.95)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 8);
      ctx.moveTo(-5, 2); ctx.lineTo(5, -2);
      ctx.stroke();
    } else if (type === "repair") {
      ctx.strokeStyle = cfg.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-8, 8);
      ctx.lineTo(2, -2);
      ctx.quadraticCurveTo(7, -10, 11, -5);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.strokeStyle = "rgba(235,255,255,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, 7); ctx.lineTo(13, 7);
      ctx.moveTo(9, 3); ctx.lineTo(9, 11);
      ctx.stroke();
    } else if (type === "rally") {
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.lineTo(-6, -11);
      ctx.stroke();
      ctx.fillStyle = cfg.color;
      ctx.beginPath();
      ctx.moveTo(-4, -10);
      ctx.lineTo(9, -6);
      ctx.lineTo(-4, -1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(0, 10, 8, 0, Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle = cfg.color;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(9, -1);
      ctx.lineTo(4, -1);
      ctx.lineTo(4, 10);
      ctx.lineTo(-4, 10);
      ctx.lineTo(-4, -1);
      ctx.lineTo(-9, -1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(235,255,250,0.92)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 12, 8, 0, Math.PI);
      ctx.stroke();
    }

    ctx.restore();
    if (opts.label) drawCommandLabel(cfg.label, cfg.color, sx, sy);
  }

  function drawCommandLabel(text, color, x, y) {
    ctx.save();
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    const bx = clamp(x - w / 2, 8, W - w - 8);
    const by = clamp(y - 34, 8, H - 26);
    ctx.fillStyle = "rgba(5,8,15,0.82)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f6fbff";
    ctx.fillText(text, bx + w / 2, by + 10);
    ctx.restore();
  }

  function renderVignette() {
    const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,5,0.42)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }

  function renderMinimap() {
    const sx = MM.w / WORLD_W, sy = MM.h / WORLD_H;
    ctx.fillStyle = "rgba(5,7,13,0.92)";
    ctx.fillRect(MM.x - 3, MM.y - 3, MM.w + 6, MM.h + 6);
    ctx.strokeStyle = "rgba(140,160,210,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(MM.x - 3, MM.y - 3, MM.w + 6, MM.h + 6);
    // scar hint
    ctx.strokeStyle = "rgba(176,108,255,0.5)";
    ctx.beginPath();
    scarPath().forEach(([x, y], i) => {
      const px = MM.x + x * sx, py = MM.y + y * sy;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    // terrain: mountains + destructible rock barriers
    ctx.fillStyle = "#2b3346";
    for (const o of state.obstacles) {
      const s = Math.max(2, o.r * sx * 2);
      ctx.fillRect(MM.x + o.x * sx - s / 2, MM.y + o.y * sy - s / 2, s, s);
    }
    ctx.fillStyle = "#5a4e37";
    for (const rk of state.rocks) {
      if (rk.dead) continue;
      const s = Math.max(2, rk.r * sx * 2);
      ctx.fillRect(MM.x + rk.x * sx - s / 2, MM.y + rk.y * sy - s / 2, s, s);
    }
    for (const n of state.nodes) {
      if (!isVisibleToPlayer(n.x, n.y, n.r + 8)) continue;
      const nx = MM.x + n.x * sx, ny = MM.y + n.y * sy;
      ctx.fillStyle = n.amount !== Infinity && n.amount <= 0 ? "#2c3440" : NODE_COLORS[n.kind];
      ctx.fillRect(nx - 1.5, ny - 1.5, 3, 3);
      if (n.team) {
        ctx.strokeStyle = n.team.faction.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(nx - 2.5, ny - 2.5, 5, 5);
      }
    }
    for (const b of state.buildings) {
      if (b.dead) continue;
      if (!thingVisibleToPlayer(b)) continue;
      ctx.fillStyle = b.team.faction.color;
      const s = b.def.kind === "hq" ? 6 : 4;
      ctx.fillRect(MM.x + b.x * sx - s / 2, MM.y + b.y * sy - s / 2, s, s);
    }
    for (const u of state.units) {
      if (u.dead) continue;
      if (!thingVisibleToPlayer(u)) continue;
      ctx.fillStyle = u.team.faction.color;
      ctx.fillRect(MM.x + u.x * sx - 1, MM.y + u.y * sy - 1, 2, 2);
    }
    // alarm ping
    if (state.time - state.alarmT < 3 && state.alarmPos) {
      const t = (state.time - state.alarmT) % 1;
      ctx.strokeStyle = `rgba(255,80,80,${1 - t})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(MM.x + state.alarmPos.x * sx, MM.y + state.alarmPos.y * sy, 3 + t * 10, 0, TAU);
      ctx.stroke();
    }
    // camera rect
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(MM.x + state.cam.x * sx, MM.y + state.cam.y * sy, W * sx, H * sy);
  }

  /* ==================================================
     20. OVERLAY SCREENS (menu / faction select / pause / end)
     ================================================== */
  function showOverlay(show) {
    overlayEl.classList.toggle("overlay--show", show);
  }

  function factionSigil(fid, size) {
    const f = FACTIONS[fid];
    if (fid === "humans") {
      return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true"><path d="M30 8 L52 26 L44 26 L44 50 L36 50 L36 34 L24 34 L24 50 L16 50 L16 26 L8 26 Z" fill="none" stroke="${f.color}" stroke-width="3" stroke-linejoin="round"/><circle cx="30" cy="22" r="3.4" fill="${f.color2}"/></svg>`;
    }
    if (fid === "robots") {
      return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true"><path d="M30 6 L51 18 L51 42 L30 54 L9 42 L9 18 Z" fill="none" stroke="${f.color}" stroke-width="3" stroke-linejoin="round"/><path d="M30 18 L41 24 L41 36 L30 42 L19 36 L19 24 Z" fill="none" stroke="${f.color2}" stroke-width="2"/><circle cx="30" cy="30" r="4" fill="${f.color}"/></svg>`;
    }
    return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true"><path d="M30 6 C44 18 46 34 30 52 C14 34 16 18 30 6 Z" fill="none" stroke="${f.color}" stroke-width="3" stroke-linejoin="round"/><path d="M30 20 C37 26 37 34 30 42 C23 34 23 26 30 20 Z" fill="${f.color2}" opacity="0.85"/></svg>`;
  }

  function showMenu() {
    netTLS.shutdown();
    state.phase = "menu";
    setSelection([]);
    screenEl.innerHTML = `
      <div class="tls-boot">
        <div class="tls-boot__tag">PRIORITY TRANSMISSION // RELAY 7</div>
        <h2 class="tls-boot__title">THE LAST SIGNAL</h2>
        <p class="tls-boot__body">Sixty-two hours ago, every deep array on Earth turned toward the same coordinates. Not the sky &mdash; the crust. Four kilometers beneath the excavation site they call <em>the Hollow</em>, something old finished counting. And began to speak.</p>
        <p class="tls-boot__body">Three powers now hold the excavation line. Each of them heard a different message. Each of them is certain.</p>
        <button class="btn btn--primary" id="tls-begin">Answer the Signal</button>
        <div class="tls-boot__foot">RTS-lite skirmish &middot; three factions &middot; 1&ndash;3 enemy commands &middot; 3 AI doctrines</div>
      </div>`;
    showOverlay(true);
    document.getElementById("tls-begin").addEventListener("click", () => { Sfx.click(); showSelect(); });
  }

  // enemy factions: the two rivals first (shuffled), a random third if needed
  function rollEnemyFactions(playerFid, count) {
    const shuffled = FACTION_IDS.filter((x) => x !== playerFid).sort(() => Math.random() - 0.5);
    const list = [];
    for (let i = 0; i < count; i++) list.push(i < 2 ? shuffled[i] : pick(FACTION_IDS));
    return list;
  }

  function showSelect() {
    state.phase = "select";
    state.pick = null;
    state.pendingEnemies = null;
    const cards = FACTION_IDS.map((fid) => {
      const f = FACTIONS[fid];
      return `
        <button class="tls-fcard" data-f="${fid}" style="--fc:${f.color};--fc2:${f.color2}">
          <span class="tls-fcard__sigil">${factionSigil(fid, 44)}</span>
          <strong>${f.name}</strong>
          <small>${f.short}</small>
          <em>&ldquo;${f.epithet}&rdquo;</em>
          <span class="tls-fcard__doc">${f.doctrine}</span>
          <span class="tls-fcard__list tls-fcard__list--plus">${f.strengths.map((s) => `+ ${s}`).join("<br/>")}</span>
          <span class="tls-fcard__list tls-fcard__list--minus">${f.weaknesses.map((s) => `&minus; ${s}`).join("<br/>")}</span>
        </button>`;
    }).join("");
    screenEl.innerHTML = `
      <div class="tls-select">
        <div class="tls-boot__tag">COMMAND ASSIGNMENT</div>
        <h2 class="tls-select__title">Choose your allegiance</h2>
        <div class="tls-fgrid">${cards}</div>
        <div class="tls-opts">
          <div class="tls-opt"><span class="tls-opt__label">OPPOSITION</span>
            <div class="tls-seg" data-opt="enemies">${optSeg("enemies", [[1, "1 enemy"], [2, "2 enemies"], [3, "3 enemies"]])}</div>
          </div>
          <div class="tls-opt"><span class="tls-opt__label">ENEMY AI</span>
            <div class="tls-seg" data-opt="difficulty">${optSeg("difficulty", [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]])}</div>
          </div>
          <div class="tls-opt"><span class="tls-opt__label">MAP</span>
            <div class="tls-seg" data-opt="mapReveal">${optSeg("mapReveal", [["true", "Full reveal"], ["false", "Fog of war"]])}</div>
          </div>
        </div>
        <div class="tls-brief" id="tls-brief" hidden>
          <div class="tls-brief__text" id="tls-brief-text"></div>
          <div class="tls-btnrow">
            <button class="btn btn--primary" id="tls-deploy">Deploy to the Hollow</button>
            <button class="btn btn--ghost" id="tls-deploy-online">🌐 Online skirmish (2-4)</button>
          </div>
        </div>
        <button class="btn btn--ghost tls-backbtn" id="tls-back">Back</button>
      </div>`;
    showOverlay(true);

    const refreshBrief = () => {
      if (!state.pick) return;
      state.pendingEnemies = rollEnemyFactions(state.pick, state.opts.enemies);
      const names = state.pendingEnemies.map((fid) => `<b style="color:${FACTIONS[fid].color}">${FACTIONS[fid].name}</b>`).join(", ");
      const diff = AI_DIFFICULTY[state.opts.difficulty] || AI_DIFFICULTY.normal;
      document.getElementById("tls-brief-text").innerHTML =
        `<strong>MISSION BRIEF &mdash; EXCAVATION SITE 9, &ldquo;THE HOLLOW&rdquo;</strong><br/>` +
        `Mountain walls carve the Hollow into lanes &mdash; go around them, or blast the rockslides open. ` +
        (state.opts.enemies > 1
          ? `${state.opts.enemies} rival commands hold the far ridges: ${names}. Every commander fights for themselves.`
          : `${names} forces hold the far ridge.`) +
        ` Enemy doctrine: <b>${diff.label}</b>. ` +
        (state.opts.mapReveal
          ? "Full map intel — every ridge and fracture is visible from the start."
          : "Fog of war — only your units and structures reveal the Hollow.") +
        ` Raise your economy, control the Signal fractures, and destroy every enemy command structure.`;
      document.getElementById("tls-brief").hidden = false;
    };

    screenEl.querySelectorAll(".tls-fcard").forEach((c) => {
      c.addEventListener("click", () => {
        Sfx.click();
        state.pick = c.dataset.f;
        screenEl.querySelectorAll(".tls-fcard").forEach((x) => x.classList.toggle("is-picked", x === c));
        refreshBrief();
      });
    });
    bindOptSegs(screenEl, refreshBrief);
    document.getElementById("tls-deploy").addEventListener("click", () => {
      if (!state.pick) return;
      Sfx.click();
      startGame(state.pick, state.pendingEnemies || rollEnemyFactions(state.pick, state.opts.enemies), state.opts.difficulty);
    });
    document.getElementById("tls-deploy-online").addEventListener("click", () => {
      if (!state.pick) return;
      Sfx.click();
      netTLS.openLobby();
    });
    document.getElementById("tls-back").addEventListener("click", () => { Sfx.click(); showMenu(); });
  }

  function showPause() {
    screenEl.innerHTML = `
      <div class="tls-boot">
        <div class="tls-boot__tag">TRANSMISSION HELD</div>
        <h2 class="tls-boot__title tls-boot__title--sm">Paused</h2>
        <p class="tls-boot__body">The Hollow waits. The Signal does not.</p>
        <div class="tls-btnrow">
          <button class="btn btn--primary" id="tls-resume">Resume</button>
          <button class="btn btn--ghost" id="tls-abandon">Abandon operation</button>
        </div>
      </div>`;
    showOverlay(true);
    document.getElementById("tls-resume").addEventListener("click", () => { Sfx.click(); togglePause(); });
    document.getElementById("tls-abandon").addEventListener("click", () => { Sfx.click(); state.paused = false; showMenu(); });
  }

  function togglePause() {
    if (state.phase !== "playing") return;
    if (netTLS.active) { log("No pausing in an online match."); return; }
    state.paused = !state.paused;
    if (state.paused) showPause();
    else showOverlay(false);
  }

  /* ==================================================
     ONLINE SKIRMISH 2-4P (RBNet over Supabase Realtime)
     ================================================== */
  // Model: each client fully simulates ONLY its own team (state.teams[0] here,
  // always). Every rival commander is a remote team (flagged isRemote) whose
  // units/buildings exist as real entries in state.units/state.buildings —
  // reusing makeUnit/makeBuilding so rendering, fog-of-war and targeting all
  // just work — but their position/hp are puppets driven by periodic
  // snapshots, never local physics. Puppet ids live in per-player namespaces:
  // trueId + NET_ID_OFFSET * (lobbySlot + 1), so up to 4 overlapping per-client
  // id counters can share the world without collisions.
  // Combat is victim-authoritative: my applyDamage() drops hits on puppets and
  // queues them (batched, 10Hz, sent only to the owner) so the owner applies
  // real damage on their side; hp/death flows back via snapshot/`death`.
  // Resource nodes use a claims-list protocol: each client broadcasts the set
  // of nodes ITS team holds at 1Hz; receivers reconcile only that team's
  // claims, so every claim has exactly one authority. Damage to a remote
  // team's node claim is likewise forwarded to its owner. Destroyed rock
  // barriers replicate by position so navigation stays consistent.
  const netTLS = {
    active: false,
    room: null,
    puppetsById: new Map(),  // namespaced id -> unit/building
    teamByPeer: new Map(),   // peerId -> remote team
    hitQueues: new Map(),    // peerId -> Map(trueId -> dmg)
    nodeHitQueues: new Map(),// peerId -> Map(nodeIdx -> dmg)
    snapAcc: 0,
    nodeAcc: 0,
    hitAcc: 0,

    offsetFor(team) {
      return NET_ID_OFFSET * ((team.physIdx || 0) + 1);
    },

    openLobby() {
      if (!state.pick) return;
      if (!window.RBNetUI || !window.RBNet || !RBNet.available()) {
        log("Online play isn't available right now.");
        return;
      }
      RBNetUI.open({
        game: GAME_ID,
        title: "THE LAST SIGNAL — ONLINE SKIRMISH",
        accent: FACTIONS[state.pick].color,
        minPlayers: 2,
        maxPlayers: 4,
        meta: { faction: state.pick, fname: FACTIONS[state.pick].short },
        playerTag: (p) => p.fname || "",
        getStartPayload: () => ({}),
        onStart: ({ room, players, slot, payload }) => netTLS.begin(room, players, slot, payload),
        onClose: () => {},
      });
    },

    begin(room, players, mySlot, payload) {
      netTLS.shutdown();
      netTLS.room = room;
      netTLS.active = true;
      netTLS.puppetsById = new Map();
      netTLS.teamByPeer = new Map();
      netTLS.hitQueues = new Map();
      netTLS.nodeHitQueues = new Map();
      netTLS.snapAcc = 0;
      netTLS.nodeAcc = 0;
      netTLS.hitAcc = 0;
      const me = players.find((p) => p.id === room.id);
      const myFid = me && FACTIONS[me.faction] ? me.faction : "humans";
      const rivals = players
        .map((p, i) => ({ id: p.id, slot: i, fid: FACTIONS[p.faction] ? p.faction : "robots" }))
        .filter((p) => p.id !== room.id);
      room.on("roster", (d, from) => netTLS.onRoster(d, from));
      room.on("spawn", (d, from) => netTLS.onSpawn(d, from));
      room.on("snapshot", (d, from) => netTLS.onSnapshot(d, from));
      room.on("nodes", (d, from) => netTLS.onNodes(d, from));
      room.on("hits", (d, from) => netTLS.onHits(d, from));
      room.on("death", (d, from) => netTLS.onDeath(d, from));
      room.on("elim", (d, from) => netTLS.onElim(from));
      room.on("rockdead", (d) => netTLS.onRockDead(d));
      room.on("peerleave", (pid) => netTLS.onPeerGone(pid));
      room.on("closed", () => netTLS.onClosed());
      startOnlineGame(myFid, rivals, mySlot, (payload.seed >>> 0) || 1);
      const pTeam = state.teams[0];
      netTLS.send("roster", {
        units: teamUnits(pTeam).map((u) => ({ id: u.id, key: u.def.key, x: Math.round(u.x), y: Math.round(u.y) })),
        buildings: teamBuildings(pTeam).map((b) => ({ id: b.id, key: b.def.key, x: Math.round(b.x), y: Math.round(b.y) })),
      });
    },

    shutdown() {
      if (netTLS.room) { try { netTLS.room.leave(); } catch (e) {} }
      netTLS.room = null;
      netTLS.active = false;
      netTLS.puppetsById.clear();
      netTLS.teamByPeer.clear();
      netTLS.hitQueues.clear();
      netTLS.nodeHitQueues.clear();
    },

    send(type, data) {
      if (netTLS.active && netTLS.room) netTLS.room.send(type, data);
    },

    // batched, owner-routed combat damage
    queueHit(team, thing, dmg) {
      if (!team.peerId) return;
      let q = netTLS.hitQueues.get(team.peerId);
      if (!q) { q = new Map(); netTLS.hitQueues.set(team.peerId, q); }
      const trueId = thing.id - netTLS.offsetFor(team);
      q.set(trueId, (q.get(trueId) || 0) + dmg);
    },
    queueNodeHit(node, dmg) {
      const team = node.team;
      if (!team || !team.peerId) return;
      const idx = state.nodes.indexOf(node);
      if (idx < 0) return;
      let q = netTLS.nodeHitQueues.get(team.peerId);
      if (!q) { q = new Map(); netTLS.nodeHitQueues.set(team.peerId, q); }
      q.set(idx, (q.get(idx) || 0) + dmg);
    },

    spawnPuppetUnit(team, key, id, x, y) {
      const def = team && team.faction.units[key];
      if (!def) return null;
      const u = makeUnit(team, def, x, y);
      u.id = id + netTLS.offsetFor(team);
      netTLS.puppetsById.set(u.id, u);
      return u;
    },
    spawnPuppetBuilding(team, key, id, x, y) {
      const def = team && team.faction.buildings[key];
      if (!def) return null;
      const b = makeBuilding(team, def, x, y, null, true);
      b.id = id + netTLS.offsetFor(team);
      netTLS.puppetsById.set(b.id, b);
      if (def.kind === "hq") team.hqId = b.id;
      return b;
    },

    onRoster(d, from) {
      const team = netTLS.teamByPeer.get(from);
      if (!d || !team) return;
      (d.units || []).forEach((u) => netTLS.spawnPuppetUnit(team, u.key, u.id, u.x, u.y));
      (d.buildings || []).forEach((b) => netTLS.spawnPuppetBuilding(team, b.key, b.id, b.x, b.y));
    },

    onSpawn(d, from) {
      const team = netTLS.teamByPeer.get(from);
      if (!d || !team) return;
      if (d.kind === "building") netTLS.spawnPuppetBuilding(team, d.key, d.id, d.x, d.y);
      else netTLS.spawnPuppetUnit(team, d.key, d.id, d.x, d.y);
    },

    onSnapshot(d, from) {
      const team = netTLS.teamByPeer.get(from);
      if (!d || !team) return;
      const off = netTLS.offsetFor(team);
      (d.u || []).forEach(([id, x, y, hp, shield]) => {
        const u = netTLS.puppetsById.get(id + off);
        if (!u || u.dead) return;
        u._nx = x; u._ny = y;
        u.hp = hp; u.shield = shield || 0;
      });
      (d.b || []).forEach(([id, x, y, hp]) => {
        const b = netTLS.puppetsById.get(id + off);
        if (!b || b.dead) return;
        b.x = x; b.y = y; b.hp = hp;
      });
    },

    // sender's full claims list: reconcile ONLY that team's node ownership
    onNodes(d, from) {
      const team = netTLS.teamByPeer.get(from);
      if (!d || !team || !Array.isArray(d.c)) return;
      const listed = new Map(d.c);
      state.nodes.forEach((n, idx) => {
        if (listed.has(idx)) {
          n.team = team;
          n.hp = listed.get(idx);
          if (n.claimTeam === team) { n.claimTeam = null; n.claimProgress = 0; }
        } else if (n.team === team) {
          n.team = null;
          n.hp = 0;
        }
      });
    },

    onHits(d, from) {
      const attacker = netTLS.teamByPeer.get(from);
      if (!d) return;
      (d.l || []).forEach(([id, dmg]) => {
        const target = state.units.find((u) => u.id === id) || state.buildings.find((b) => b.id === id);
        if (target && target.team === state.teams[0]) applyDamage(target, dmg, null, attacker || null);
      });
      (d.n || []).forEach(([idx, dmg]) => {
        const n = state.nodes[idx];
        if (n && n.team === state.teams[0]) applyDamage(n, dmg, null, attacker || null);
      });
    },

    onDeath(d, from) {
      const team = netTLS.teamByPeer.get(from);
      if (!d || !team) return;
      const thing = netTLS.puppetsById.get(d.id + netTLS.offsetFor(team));
      if (thing) netTLS.puppetDie(thing);
    },

    puppetDie(thing) {
      if (thing.dead) return;
      thing.dead = true;
      boomFx(thing.x, thing.y, thing.team.faction.color, (thing.def.r || 12) * (thing.kind === "unit" ? 1 : 1.4));
      Sfx.boom(thing.kind !== "unit");
      if (state.selection.includes(thing)) { state.selection = state.selection.filter((s) => s !== thing); state.selVersion++; }
    },

    onElim(from) {
      const team = netTLS.teamByPeer.get(from);
      if (team && !team.eliminated) eliminateTeam(team, null);
    },

    onRockDead(d) {
      if (!d) return;
      let best = null, bd = 36;
      for (const rk of state.rocks) {
        if (rk.dead) continue;
        const dd = d2(d.x, d.y, rk.x, rk.y);
        if (dd < bd) { bd = dd; best = rk; }
      }
      if (best) {
        best.dead = true;
        best.hp = 0;
        boomFx(best.x, best.y, "#cdb489", best.r + 10);
        buildNavGrid();
        log("Rockslide cleared — a new route is open");
      }
    },

    onPeerGone(pid) {
      if (!netTLS.active) return;
      const team = netTLS.teamByPeer.get(pid);
      if (team && !team.eliminated) {
        log(`${team.faction.name} command uplink lost`);
        if (state.phase === "playing") eliminateTeam(team, null);
      }
      netTLS.teamByPeer.delete(pid);
      netTLS.hitQueues.delete(pid);
      netTLS.nodeHitQueues.delete(pid);
    },

    onClosed() {
      if (!netTLS.active) return;
      log("Connection lost.");
      if (state.phase === "playing") {
        for (const team of state.teams) {
          if (team.isRemote && !team.eliminated) eliminateTeam(team, null);
        }
      }
    },

    tick(dt) {
      if (!netTLS.active || state.phase !== "playing") return;
      for (const thing of netTLS.puppetsById.values()) {
        if (thing.dead || thing.kind !== "unit" || thing._nx == null) continue;
        const k = Math.min(1, dt * 10);
        thing.x += (thing._nx - thing.x) * k;
        thing.y += (thing._ny - thing.y) * k;
      }
      netTLS.snapAcc += dt;
      netTLS.nodeAcc += dt;
      netTLS.hitAcc += dt;
      if (netTLS.hitAcc >= 0.1) {
        netTLS.hitAcc = 0;
        netTLS.hitQueues.forEach((q, pid) => {
          if (!q.size && !(netTLS.nodeHitQueues.get(pid) || { size: 0 }).size) return;
          const nq = netTLS.nodeHitQueues.get(pid);
          const msg = { l: [...q.entries()].map(([id, dmg]) => [id, Math.round(dmg * 10) / 10]) };
          if (nq && nq.size) {
            msg.n = [...nq.entries()].map(([idx, dmg]) => [idx, Math.round(dmg * 10) / 10]);
            nq.clear();
          }
          q.clear();
          if (netTLS.room) netTLS.room.sendTo(pid, "hits", msg);
        });
        netTLS.nodeHitQueues.forEach((nq, pid) => {
          if (!nq.size) return;
          if (netTLS.room) netTLS.room.sendTo(pid, "hits", { n: [...nq.entries()].map(([idx, dmg]) => [idx, Math.round(dmg * 10) / 10]) });
          nq.clear();
        });
      }
      if (netTLS.snapAcc >= 0.12) {
        netTLS.snapAcc = 0;
        const pTeam = state.teams[0];
        netTLS.send("snapshot", {
          u: teamUnits(pTeam).map((x) => [x.id, Math.round(x.x), Math.round(x.y), Math.round(x.hp), Math.round(x.shield || 0)]),
          b: teamBuildings(pTeam).map((x) => [x.id, Math.round(x.x), Math.round(x.y), Math.round(x.hp)]),
        });
      }
      if (netTLS.nodeAcc >= 1) {
        netTLS.nodeAcc = 0;
        const claims = [];
        state.nodes.forEach((node, idx) => {
          if (node.team === state.teams[0]) claims.push([idx, Math.round(node.hp)]);
        });
        netTLS.send("nodes", { c: claims });
      }
    },
  };

  function startOnlineGame(myFid, rivals, mySlot, seed) {
    state.units = [];
    state.buildings = [];
    state.projectiles = [];
    state.beams = [];
    state.particles = [];
    state.commandFx = [];
    state.decals = [];
    state.selection = [];
    state.selVersion++;
    state.placing = null;
    state.armed = null;
    state.time = 0;
    state.paused = false;
    state.result = null;
    state.stats = { kills: 0, losses: 0 };
    state.alarmT = -99;

    // shared seed so every client sees the same terrain/mountains/rocks
    const origRandom = Math.random;
    Math.random = mulberry32(seed);
    try { initWorld(); } finally { Math.random = origRandom; }

    state.setup = { difficulty: "normal", enemyCount: rivals.length, mapReveal: state.opts.mapReveal, online: true };

    const pTeam = makeTeam(0, myFid, false, null);
    pTeam.physIdx = mySlot;
    state.teams = [pTeam];
    rivals.forEach((r, i) => {
      const rTeam = makeTeam(i + 1, r.fid, false, null);
      rTeam.isRemote = true;
      rTeam.physIdx = r.slot;   // lobby slot -> HQ corner + puppet id namespace
      rTeam.peerId = r.id;
      state.teams.push(rTeam);
      netTLS.teamByPeer.set(r.id, rTeam);
    });

    const myPos = HQ_POS[pTeam.physIdx];
    const myHq = makeBuilding(pTeam, pTeam.faction.buildings.hq, myPos.x, myPos.y, null, true);
    pTeam.hqId = myHq.id;
    const toC = Math.atan2(CENTER.y - myPos.y, CENTER.x - myPos.x);
    for (let k = 0; k < 3; k++) {
      const a = toC + (k - 1) * 0.7;
      const u = makeUnit(pTeam, pTeam.faction.units.worker, myPos.x + Math.cos(a) * 78, myPos.y + Math.sin(a) * 78);
      const n = findMatterNode(u);
      if (n) orderHarvest([u], n);
    }
    for (let k = 0; k < 2; k++) {
      const a = toC + (k === 0 ? -0.25 : 0.25);
      makeUnit(pTeam, pTeam.faction.units.basic, myPos.x + Math.cos(a) * 110, myPos.y + Math.sin(a) * 110);
    }

    state.cam.x = clamp(myHq.x - W / 2, 0, WORLD_W - W);
    state.cam.y = clamp(myHq.y - H / 2, 0, WORLD_H - H);
    state.best = Number(api.getHighScore(GAME_ID) || 0);

    if (el.log) el.log.innerHTML = "";
    log("Uplink established. The Hollow is contested.");
    const rivalNames = rivals.map((r) => `<b style="color:${FACTIONS[r.fid].color}">${FACTIONS[r.fid].name}</b>`).join(", ");
    log(`Online skirmish vs ${rivals.map((r) => FACTIONS[r.fid].name).join(", ")}${netTLS.room ? " — room " + netTLS.room.code : ""}`);
    if (el.objective) {
      el.objective.innerHTML = `Destroy ${rivals.length > 1 ? "every rival command structure" : "the enemy command structure"}: ${rivalNames}. Protect your own. ${rivals.length > 1 ? "All rivals are human commanders." : "Opponent: human commander."}`;
    }
    const fchip = document.getElementById("tls-faction");
    if (fchip) {
      fchip.textContent = FACTIONS[myFid].short;
      fchip.style.color = FACTIONS[myFid].color;
    }

    refreshVision();
    state.phase = "playing";
    showOverlay(false);
    renderActionsPanel();
    renderSelPanel();
    canvas.focus();
  }

  function endGame(winnerTeam) {
    if (state.phase !== "playing") return;
    if (netTLS.active) netTLS.shutdown();
    state.phase = "over";
    state.result = { winner: winnerTeam };
    const pt = playerTeam();
    const won = winnerTeam === pt;
    const f = pt.faction;
    let scoreLine = "";
    if (won) {
      const diff = AI_DIFFICULTY[(state.setup && state.setup.difficulty) || "normal"];
      const mult = diff.scoreMult * (1 + 0.4 * (((state.setup && state.setup.enemyCount) || 1) - 1));
      const score = Math.max(600, Math.round((15000 - Math.floor(state.time) * 15 + state.stats.kills * 25) * mult));
      const high = api.recordScore(GAME_ID, score);
      state.best = Number(api.getHighScore(GAME_ID) || state.best || score);
      scoreLine = `<div class="tls-endstats">Score <strong>${score}</strong>${high ? " &middot; new personal best" : ""}</div>`;
      Sfx.win();
    } else {
      Sfx.lose();
    }
    screenEl.innerHTML = `
      <div class="tls-boot">
        <div class="tls-boot__tag">${won ? "OPERATION COMPLETE" : "OPERATION FAILED"}</div>
        <h2 class="tls-boot__title tls-boot__title--sm" style="color:${won ? f.color : "#ff4f68"}">${won ? "Victory" : "Defeat"}</h2>
        <p class="tls-boot__body">${won ? f.win : f.lose}</p>
        <div class="tls-endstats">${fmtTime(state.time)} elapsed &middot; ${state.stats.kills} enemies destroyed &middot; ${state.stats.losses} units lost</div>
        ${scoreLine}
        <div class="tls-btnrow">
          <button class="btn btn--primary" id="tls-again">New skirmish</button>
          <button class="btn btn--ghost" id="tls-tomenu">Command menu</button>
        </div>
      </div>`;
    showOverlay(true);
    document.getElementById("tls-again").addEventListener("click", () => { Sfx.click(); showSelect(); });
    document.getElementById("tls-tomenu").addEventListener("click", () => { Sfx.click(); showMenu(); });
  }

  /* ==================================================
     21. GAME FLOW
     ================================================== */
  function startGame(playerFid, enemyFids, diffKey) {
    const diff = AI_DIFFICULTY[diffKey] || AI_DIFFICULTY.normal;
    enemyFids = (Array.isArray(enemyFids) && enemyFids.length ? enemyFids : rollEnemyFactions(playerFid, 1)).slice(0, 3);
    // full reset
    state.units = [];
    state.buildings = [];
    state.projectiles = [];
    state.beams = [];
    state.particles = [];
    state.commandFx = [];
    state.decals = [];
    state.selection = [];
    state.selVersion++;
    state.placing = null;
    state.armed = null;
    state.time = 0;
    state.paused = false;
    state.result = null;
    state.stats = { kills: 0, losses: 0 };
    state.alarmT = -99;
    initWorld();
    state.setup = { difficulty: diff.key, enemyCount: enemyFids.length, mapReveal: state.opts.mapReveal };

    const pTeam = makeTeam(0, playerFid, false, diff);
    state.teams = [pTeam];
    enemyFids.forEach((fid, i) => {
      const et = makeTeam(i + 1, fid, true, diff);
      et.ai = makeAI(et, diff);
      state.teams.push(et);
    });

    state.teams.forEach((team) => {
      const pos = HQ_POS[team.idx];
      const hq = makeBuilding(team, team.faction.buildings.hq, pos.x, pos.y, null, true);
      team.hqId = hq.id;
      const toC = Math.atan2(CENTER.y - pos.y, CENTER.x - pos.x);
      for (let k = 0; k < 3; k++) {
        const a = toC + (k - 1) * 0.7;
        const u = makeUnit(team, team.faction.units.worker, pos.x + Math.cos(a) * 78, pos.y + Math.sin(a) * 78);
        const n = findMatterNode(u);
        if (n) orderHarvest([u], n);
      }
      for (let k = 0; k < 2; k++) {
        const a = toC + (k === 0 ? -0.25 : 0.25);
        makeUnit(team, team.faction.units.basic, pos.x + Math.cos(a) * 110, pos.y + Math.sin(a) * 110);
      }
    });

    state.cam.x = clamp(HQ_POS[0].x - W / 2, 0, WORLD_W - W);
    state.cam.y = clamp(HQ_POS[0].y - H / 2, 0, WORLD_H - H);
    state.best = Number(api.getHighScore(GAME_ID) || 0);

    if (el.log) el.log.innerHTML = "";
    log("Uplink established. The Hollow is contested.");
    if (!state.opts.mapReveal) log("Fog of war active — scout the ridges before you commit.");
    log("Claim resource nodes, rig vents, raise an army.");
    if (el.objective) {
      const names = enemyFids.map((fid) => `<b style="color:${FACTIONS[fid].color}">${FACTIONS[fid].name}</b>`).join(", ");
      el.objective.innerHTML = `Destroy ${enemyFids.length > 1 ? "every enemy command structure" : "the enemy command structure"}: ${names}. Protect your own. Enemy AI: ${diff.label}.`;
    }
    const fchip = document.getElementById("tls-faction");
    if (fchip) {
      fchip.textContent = FACTIONS[playerFid].short;
      fchip.style.color = FACTIONS[playerFid].color;
    }

    refreshVision();
    state.phase = "playing";
    showOverlay(false);
    renderActionsPanel();
    renderSelPanel();
    canvas.focus();
  }

  /* ==================================================
     22. MAIN LOOP + DEBUG HOOK
     ================================================== */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.vt += dt;
    if (state.phase === "playing" && !state.paused) {
      update(dt);
      syncHud();
      syncPanels(dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  initWorld();
  loadPersistedOpts();
  state.best = Number(api.getHighScore(GAME_ID) || 0);
  showMenu();
  requestAnimationFrame(frame);

  window.__TLS = {
    get state() { return state; },
    netTLS,
    startOnlineGame,
    start: (f = "humans", e, diffKey = "normal", count) => {
      const enemies = Array.isArray(e) ? e : e ? [e] : rollEnemyFactions(f, count || 1);
      startGame(f, enemies, diffKey);
    },
    step(n = 60, dt = 1 / 60) {
      for (let i = 0; i < n; i++) {
        if (state.phase !== "playing" || state.paused) break;
        state.vt += dt;
        update(dt);
      }
      syncHud(); syncPanels(1);
      render();
      return { time: state.time, phase: state.phase, units: state.units.length, buildings: state.buildings.length };
    },
    give(m = 0, e = 0, s = 0, teamIdx = 0) {
      const t = state.teams[teamIdx];
      if (t) { t.res.m += m; t.res.e += e; t.res.s += s; }
    },
    spawn(teamIdx, key, x, y) {
      const t = state.teams[teamIdx];
      if (!t) return null;
      return makeUnit(t, t.faction.units[key], x, y);
    },
    place(teamIdx, key, x, y) {
      const t = state.teams[teamIdx];
      return t ? placeBuilding(t, key, x, y) : null;
    },
    damage(id, amount = 9999, teamIdx = 1) {
      const target = state.units.find((u) => u.id === id)
        || state.buildings.find((b) => b.id === id)
        || state.nodes.find((n) => n.id === id)
        || state.rocks.find((r) => r.id === id);
      const t = state.teams[teamIdx] || state.teams[0];
      if (target) applyDamage(target, amount, null, t);
      return target ? { id: target.id, hp: target.hp || 0, dead: !!target.dead, team: target.team && target.team.idx } : null;
    },
    claim(teamIdx, nodeId, unitId) {
      const t = state.teams[teamIdx];
      const n = state.nodes.find((node) => node.id === nodeId);
      const units = state.units.filter((u) => u.team === t && !u.dead && (!unitId || u.id === unitId));
      if (n && units.length) orderClaim(units.slice(0, 1), n);
      return n ? { id: n.id, team: n.team && n.team.idx, claimTeam: n.claimTeam && n.claimTeam.idx, progress: n.claimProgress } : null;
    },
    select(ids) {
      const arr = Array.isArray(ids) ? ids : [ids];
      setSelection(state.units.filter((u) => arr.includes(u.id)).concat(state.buildings.filter((b) => arr.includes(b.id))));
    },
    selectAll() { setSelection(teamUnits(playerTeam())); },
    orderMove: (x, y, am) => orderMove(selUnits(), x, y, am),
    previewAt: (x, y) => {
      const p = commandPreviewAt(x, y);
      return p ? { type: p.type, x: p.x, y: p.y, targetId: p.target && p.target.id } : null;
    },
    visibleAt: (x, y, extra = 0) => isVisibleToPlayer(x, y, extra),
    vision: () => state.vision.map((s) => ({ x: s.x, y: s.y, r: s.r, kind: s.kind })),
    aiForPlayer(diffKey = "normal") { const t = playerTeam(); if (t && !t.ai) { t.ai = makeAI(t, AI_DIFFICULTY[diffKey] || AI_DIFFICULTY.normal); t.isAI = true; } },
    findPath: (x0, y0, x1, y1) => findPath(x0, y0, x1, y1),
    win: () => endGame(playerTeam()),
    lose: () => endGame(aiTeam()),
    cam: state.cam,
    render,
  };
})();
