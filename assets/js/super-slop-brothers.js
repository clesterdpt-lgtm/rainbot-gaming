/* ============================================================
   SUPER SLOP BROTHERS
   ------------------------------------------------------------
   A vanilla-canvas platform fighter for Rainbot Gaming.
   Percent-based knockback, blast-zone KOs, stocks, ledges,
   shields/dodges/grabs, 6 original fighters and 4 stages with
   environmental hazards. CPU opponents, local single-screen.

   Parody / satire — original "slop" characters, Smash-style
   *mechanics* only (game rules aren't copyrightable). No
   Nintendo assets, names, or characters are used.
   ============================================================ */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 1280
  const H = canvas.height;  // 720
  const GAME_ID = "super-slop-brothers";

  const api =
    (typeof RB !== "undefined" && RB) ||
    window.RB || {
      recordScore() { return false; },
      getHighScore() { return 0; },
      toast() {},
    };

  // ---------- DOM ----------
  const overlay = document.getElementById("ssb-overlay");
  const overlayTitle = document.getElementById("ssb-overlay-title");
  const overlaySub = document.getElementById("ssb-overlay-sub");
  const overlayBody = document.getElementById("ssb-overlay-body");
  const hudStage = document.getElementById("ssb-hud-stage");
  const hudMode = document.getElementById("ssb-hud-mode");
  const hudKos = document.getElementById("ssb-hud-kos");
  const hudHigh = document.getElementById("ssb-hud-high");
  const btnMenu = document.getElementById("ssb-btn-menu");
  const btnPause = document.getElementById("ssb-btn-pause");
  const btnSound = document.getElementById("ssb-btn-sound");

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const TAU = Math.PI * 2;
  const rad = (deg) => (deg * Math.PI) / 180;

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ---------- palette ----------
  const C = {
    bg0: "#0c0c16",
    bg1: "#161628",
    cyan: "#2ee0ff",
    pink: "#ff2e88",
    yellow: "#f7d716",
    green: "#58ff8a",
    red: "#ff4b5f",
    blue: "#4b7cff",
    purple: "#b07bff",
    ink: "#f4f7fb",
    dim: "#95a0b8",
    grey: "#cdd5e2",
    orange: "#ff8a3d",
  };

  // ============================================================
  //  FIGHTERS  (original slop roster)
  // ============================================================
  // weight: knockback resistance (higher = harder to launch)
  // power : damage multiplier for the templated normals
  // reach : hitbox size multiplier
  const FIGHTERS = [
    {
      id: "rainbot", name: "Rainbot", short: "RAIN", glyph: "🌈",
      blurb: "The mascot. Balanced all-rounder with a reflector.",
      color: C.cyan, accent: C.pink,
      weight: 1.0, power: 1.0, reach: 1.0,
      walk: 230, run: 360, air: 300, jump: 800, hop: 470, doubleJump: 760, fall: 920, fastFall: 1500,
      specials: {
        neutral: { type: "projectile", proj: { kind: "laser", color: C.cyan, vx: 640, vy: -30, gravity: 0, r: 10, life: 1.5, dmg: 6, base: 150, scale: 3.4, angle: 28, bounce: 0 }, cd: 0.5, sound: "laser" },
        side: { type: "melee", dur: 0.42, lunge: 540, lungeTime: 0.2, hits: [{ s: 0.1, e: 0.3, dx: 40, dy: -30, w: 64, h: 50, dmg: 9, base: 260, scale: 6, angle: 32 }], sound: "swing" },
        up: { type: "recovery", vy: -900, vx: 200, dur: 0.5, hits: [{ s: 0.02, e: 0.34, dx: 0, dy: -54, w: 70, h: 80, dmg: 8, base: 300, scale: 5, angle: 82 }], sound: "rocket" },
        down: { type: "reflect", dur: 0.5, hits: [{ s: 0.05, e: 0.3, dx: 30, dy: -34, w: 56, h: 56, dmg: 5, base: 220, scale: 3, angle: 60 }], sound: "shield" },
      },
    },
    {
      id: "gigachad", name: "Gigachad", short: "CHAD", glyph: "🗿",
      blurb: "Heavy brawler. Slow, but lands sledgehammer counters.",
      color: C.grey, accent: C.dim,
      weight: 1.28, power: 1.18, reach: 1.05,
      walk: 200, run: 320, air: 250, jump: 780, hop: 460, doubleJump: 720, fall: 1000, fastFall: 1650,
      specials: {
        neutral: { type: "melee", dur: 0.5, hits: [{ s: 0.12, e: 0.34, dx: 36, dy: -34, w: 86, h: 70, dmg: 12, base: 300, scale: 6.5, angle: 42 }], sound: "heavy" },
        side: { type: "melee", dur: 0.5, lunge: 660, lungeTime: 0.3, hits: [{ s: 0.14, e: 0.42, dx: 44, dy: -32, w: 72, h: 64, dmg: 13, base: 320, scale: 6.5, angle: 26 }], sound: "heavy" },
        up: { type: "recovery", vy: -920, vx: 160, dur: 0.5, hits: [{ s: 0.02, e: 0.3, dx: 22, dy: -60, w: 64, h: 92, dmg: 13, base: 360, scale: 6, angle: 84 }], sound: "rocket" },
        down: { type: "counter", dur: 0.5, mult: 1.5, sound: "shield" },
      },
    },
    {
      id: "mrfeast", name: "Mr. Feast", short: "FEAST", glyph: "🤑",
      blurb: "Explosive zoner. Lobs burger bombs and drops safes.",
      color: C.red, accent: C.yellow,
      weight: 1.18, power: 1.05, reach: 1.0,
      walk: 215, run: 330, air: 280, jump: 770, hop: 450, doubleJump: 730, fall: 940, fastFall: 1520,
      specials: {
        neutral: { type: "projectile", proj: { kind: "burger", color: C.yellow, vx: 430, vy: -340, gravity: 1150, r: 15, life: 2.2, dmg: 12, base: 320, scale: 6, angle: 46, bounce: 1, explode: 56 }, cd: 0.8, sound: "throw" },
        side: { type: "projectile-burst", count: 3, spread: 70, proj: { kind: "cash", color: C.green, vx: 480, vy: -120, gravity: 700, r: 8, life: 1.2, dmg: 4, base: 150, scale: 2.6, angle: 30, bounce: 0 }, cd: 0.7, sound: "throw" },
        up: { type: "recovery", vy: -960, vx: 130, dur: 0.55, hits: [{ s: 0.04, e: 0.4, dx: 0, dy: -56, w: 60, h: 96, dmg: 12, base: 340, scale: 6, angle: 85 }], sound: "rocket" },
        down: { type: "fallobject", color: "#8a93a3", w: 50, h: 50, dmg: 16, base: 360, scale: 5, angle: 270, cd: 1.0, sound: "throw" },
      },
    },
    {
      id: "skibidi", name: "Skibidi", short: "SKIB", glyph: "🚽",
      blurb: "Fast lightweight. Flush sprays and floor traps.",
      color: C.purple, accent: C.cyan,
      weight: 0.86, power: 0.92, reach: 0.95,
      walk: 255, run: 400, air: 330, jump: 830, hop: 480, doubleJump: 800, fall: 880, fastFall: 1450,
      specials: {
        neutral: { type: "projectile-burst", count: 3, spread: 40, proj: { kind: "spray", color: C.cyan, vx: 560, vy: 0, gravity: 120, r: 7, life: 0.7, dmg: 3, base: 120, scale: 2.2, angle: 18, bounce: 0 }, cd: 0.45, sound: "spray" },
        side: { type: "melee", dur: 0.4, lunge: 600, lungeTime: 0.22, hits: [{ s: 0.08, e: 0.3, dx: 38, dy: -34, w: 60, h: 56, dmg: 8, base: 250, scale: 5.5, angle: 35 }], sound: "swing" },
        up: { type: "recovery", vy: -950, vx: 220, dur: 0.5, hits: [{ s: 0.02, e: 0.3, dx: 0, dy: -52, w: 56, h: 78, dmg: 7, base: 290, scale: 5, angle: 80 }], sound: "rocket" },
        down: { type: "trap", color: C.purple, dmg: 8, base: 300, scale: 5, angle: 90, cd: 0.8, sound: "throw" },
      },
    },
    {
      id: "sigma", name: "Sigma", short: "SIGMA", glyph: "🐺",
      blurb: "Agile grindset combo machine with a hard counter.",
      color: C.blue, accent: C.ink,
      weight: 0.96, power: 0.98, reach: 1.0,
      walk: 245, run: 385, air: 320, jump: 820, hop: 475, doubleJump: 780, fall: 900, fastFall: 1480,
      specials: {
        neutral: { type: "projectile", proj: { kind: "ice", color: C.ink, vx: 720, vy: 0, gravity: 0, r: 8, life: 1.1, dmg: 5, base: 140, scale: 3, angle: 18, bounce: 0 }, cd: 0.42, sound: "laser" },
        side: { type: "melee", dur: 0.4, lunge: 640, lungeTime: 0.22, hits: [{ s: 0.08, e: 0.3, dx: 40, dy: -32, w: 64, h: 56, dmg: 10, base: 280, scale: 6, angle: 34 }], sound: "swing" },
        up: { type: "recovery", vy: -930, vx: 280, dur: 0.5, hits: [{ s: 0.02, e: 0.3, dx: 18, dy: -50, w: 56, h: 74, dmg: 6, base: 260, scale: 5, angle: 72 }], sound: "rocket" },
        down: { type: "counter", dur: 0.5, mult: 1.55, sound: "shield" },
      },
    },
    {
      id: "slopbot", name: "AI Slop Bot", short: "SLOP", glyph: "🤖",
      blurb: "Glitch summoner. Teleports and unleashes a glitch dog.",
      color: C.green, accent: C.pink,
      weight: 0.92, power: 0.95, reach: 1.0,
      walk: 235, run: 365, air: 305, jump: 800, hop: 470, doubleJump: 770, fall: 910, fastFall: 1500,
      specials: {
        neutral: { type: "projectile-burst", count: 3, spread: 90, proj: { kind: "thumb", color: C.green, vx: 470, vy: -60, gravity: 220, r: 9, life: 1.3, dmg: 4, base: 150, scale: 2.8, angle: 22, bounce: 0 }, cd: 0.6, sound: "glitch" },
        side: { type: "melee", dur: 0.4, lunge: 600, lungeTime: 0.22, hits: [{ s: 0.08, e: 0.3, dx: 40, dy: -32, w: 62, h: 56, dmg: 9, base: 270, scale: 6, angle: 30 }], sound: "swing" },
        up: { type: "teleport", dist: 230, dur: 0.34, sound: "glitch" },
        down: { type: "summon", kind: "dog", color: C.green, dmg: 8, base: 290, scale: 5, angle: 30, cd: 1.1, sound: "glitch" },
      },
    },
  ];
  const FIGHTER_BY_ID = {};
  FIGHTERS.forEach((f) => (FIGHTER_BY_ID[f.id] = f));

  // ============================================================
  //  TEMPLATED NORMAL MOVES  (scaled per fighter)
  // ============================================================
  // Each move: { dur, type:'ground'|'air', lunge?, lungeTime?, hits:[ {s,e,dx,dy,w,h,dmg,base,scale,angle} ] }
  function buildMoves(def) {
    const p = def.power, r = def.reach;
    const dmg = (v) => Math.round(v * p);
    const sz = (v) => Math.round(v * r);
    return {
      // --- ground ---
      jab: { dur: 0.26, type: "ground", hits: [{ s: 0.04, e: 0.14, dx: 34, dy: -36, w: sz(46), h: sz(40), dmg: dmg(4), base: 150, scale: 2.2, angle: 30 }] },
      ftilt: { dur: 0.34, type: "ground", hits: [{ s: 0.08, e: 0.2, dx: 42, dy: -34, w: sz(58), h: sz(48), dmg: dmg(8), base: 240, scale: 4.6, angle: 32 }] },
      utilt: { dur: 0.32, type: "ground", hits: [{ s: 0.07, e: 0.2, dx: 8, dy: -78, w: sz(56), h: sz(58), dmg: dmg(7), base: 230, scale: 4.6, angle: 95 }] },
      dtilt: { dur: 0.3, type: "ground", hits: [{ s: 0.06, e: 0.18, dx: 38, dy: -14, w: sz(58), h: sz(28), dmg: dmg(6), base: 180, scale: 3.4, angle: 18 }] },
      dash: { dur: 0.38, type: "ground", lunge: 360, lungeTime: 0.2, hits: [{ s: 0.08, e: 0.24, dx: 36, dy: -34, w: sz(58), h: sz(52), dmg: dmg(9), base: 250, scale: 5, angle: 40 }] },
      // --- smashes (stronger, charge optional) ---
      fsmash: { dur: 0.46, type: "ground", charge: true, hits: [{ s: 0.14, e: 0.28, dx: 48, dy: -36, w: sz(66), h: sz(56), dmg: dmg(15), base: 300, scale: 8.2, angle: 30 }] },
      usmash: { dur: 0.44, type: "ground", charge: true, hits: [{ s: 0.12, e: 0.26, dx: 6, dy: -88, w: sz(60), h: sz(72), dmg: dmg(14), base: 300, scale: 8, angle: 88 }] },
      dsmash: { dur: 0.44, type: "ground", charge: true, hits: [
        { s: 0.1, e: 0.2, dx: 44, dy: -16, w: sz(60), h: sz(30), dmg: dmg(13), base: 280, scale: 7.6, angle: 22 },
        { s: 0.22, e: 0.32, dx: -44, dy: -16, w: sz(60), h: sz(30), dmg: dmg(13), base: 280, scale: 7.6, angle: 158 },
      ] },
      // --- aerials ---
      nair: { dur: 0.36, type: "air", hits: [{ s: 0.06, e: 0.26, dx: 18, dy: -40, w: sz(64), h: sz(64), dmg: dmg(7), base: 200, scale: 4, angle: 45 }] },
      fair: { dur: 0.38, type: "air", hits: [{ s: 0.1, e: 0.24, dx: 44, dy: -40, w: sz(58), h: sz(52), dmg: dmg(10), base: 230, scale: 5.2, angle: 38 }] },
      bair: { dur: 0.38, type: "air", back: true, hits: [{ s: 0.09, e: 0.22, dx: -44, dy: -40, w: sz(58), h: sz(52), dmg: dmg(11), base: 250, scale: 5.6, angle: 142 }] },
      uair: { dur: 0.34, type: "air", hits: [{ s: 0.08, e: 0.22, dx: 6, dy: -82, w: sz(58), h: sz(58), dmg: dmg(9), base: 220, scale: 5, angle: 90 }] },
      dair: { dur: 0.4, type: "air", spike: true, hits: [{ s: 0.12, e: 0.28, dx: 8, dy: 18, w: sz(54), h: sz(54), dmg: dmg(11), base: 260, scale: 5, angle: 270 }] },
    };
  }

  // ============================================================
  //  STAGES  (each has platforms/obstacles + a hazard)
  // ============================================================
  // platform: { x, y, w, h, solid }  (y is the TOP of the platform)
  //   solid:true  = main stage, landable from above, has grabbable ledges
  //   solid:false = floating pass-through (land from above, drop with down)
  const STAGE_FLOOR = 548;
  const STAGE_MOVE_SCALE = 1.28; // wider stages need snappier traversal
  const BLAST = { left: -220, right: W + 220, top: -320, bottom: H + 220 };

  const STAGES = [
    {
      id: "rooftop", name: "Slop HQ Rooftop", short: "Rooftop",
      hazardName: "Ad-drone fly-by",
      platforms: [
        { x: 120, y: STAGE_FLOOR, w: 1040, h: 76, solid: true },
        { x: 140, y: 410, w: 210, h: 22, solid: false },
        { x: 930, y: 410, w: 210, h: 22, solid: false },
        { x: 510, y: 290, w: 210, h: 22, solid: false },
      ],
      spawns: [{ x: 420, y: 410 }, { x: 860, y: 410 }, { x: 640, y: 290 }, { x: 640, y: 470 }],
      blast: BLAST,
      sky: ["#10243a", "#1b1030"],
      hazard: makeDroneHazard,
    },
    {
      id: "hormuz", name: "Strait of Hormuz", short: "Hormuz",
      hazardName: "Oil slicks + missile strike",
      platforms: [
        { x: 100, y: 562, w: 1080, h: 82, solid: true },
        { x: 150, y: 420, w: 210, h: 20, solid: false, move: { axis: "x", amp: 85, speed: 0.5, phase: 0 } },
        { x: 750, y: 360, w: 210, h: 20, solid: false, move: { axis: "x", amp: 92, speed: 0.42, phase: 2.4 } },
      ],
      oil: [{ x: 280, y: 562, w: 180 }, { x: 720, y: 562, w: 180 }],
      spawns: [{ x: 420, y: 420 }, { x: 860, y: 360 }, { x: 640, y: 490 }, { x: 560, y: 490 }],
      blast: BLAST,
      sky: ["#1a2a3a", "#2a1622"],
      hazard: makeMissileHazard,
    },
    {
      id: "subway", name: "Brainrot Subway", short: "Subway",
      hazardName: "Express train rush",
      platforms: [
        { x: 100, y: 552, w: 1080, h: 76, solid: true },
        { x: 200, y: 430, w: 180, h: 20, solid: false },
        { x: 900, y: 430, w: 180, h: 20, solid: false },
        { x: 530, y: 330, w: 200, h: 20, solid: false },
      ],
      spawns: [{ x: 420, y: 430 }, { x: 860, y: 430 }, { x: 640, y: 330 }, { x: 640, y: 490 }],
      blast: BLAST,
      sky: ["#161226", "#241526"],
      hazard: makeTrainHazard,
    },
    {
      id: "mansion", name: "Feast Mansion Lawn", short: "Mansion",
      hazardName: "Bounce fountain + falling chandelier",
      platforms: [
        { x: 100, y: 558, w: 1080, h: 78, solid: true },
        { x: 180, y: 430, w: 190, h: 20, solid: false },
        { x: 910, y: 405, w: 190, h: 20, solid: false },
      ],
      bounce: [{ x: 580, y: 544, w: 130, power: 1050 }],
      spawns: [{ x: 420, y: 430 }, { x: 860, y: 405 }, { x: 640, y: 490 }, { x: 560, y: 490 }],
      blast: BLAST,
      sky: ["#13261c", "#241a12"],
      hazard: makeChandelierHazard,
    },
  ];
  const STAGE_BY_ID = {};
  STAGES.forEach((s) => (STAGE_BY_ID[s.id] = s));

  // ============================================================
  //  GAME STATE
  // ============================================================
  const settings = {
    p1: "rainbot",
    stage: "rooftop",
    rivals: 1,
    stocks: 3,
    difficulty: "normal",
  };

  // CPU behaviour per difficulty. Lower = slower reactions, fewer attacks,
  // weaker recovery, less DI — so the player gets real openings.
  const AI_LEVELS = {
    chill:  { label: "Chill",  think: [0.5, 0.95], atkCd: [0.55, 1.1], atk: 0.5,  range: 66, smash: 0.08, special: 0.18, recover: 0.55, shield: 0.0,  di: 0.35, approach: 0.78 },
    normal: { label: "Normal", think: [0.32, 0.6], atkCd: [0.35, 0.7], atk: 0.72, range: 74, smash: 0.28, special: 0.32, recover: 0.82, shield: 0.02, di: 0.7,  approach: 0.92 },
    sweat:  { label: "Sweat",  think: [0.14, 0.3], atkCd: [0.16, 0.34], atk: 0.95, range: 82, smash: 0.6,  special: 0.5,  recover: 0.96, shield: 0.06, di: 1.0,  approach: 1.0 },
  };
  function aiLevel() { return AI_LEVELS[settings.difficulty] || AI_LEVELS.normal; }

  const camera = { x: W / 2, y: H * 0.44, zoom: 1.12 };

  const state = {
    screen: "menu", // menu | fight | results
    paused: false,
    fighters: [],
    entities: [],
    particles: [],
    floaters: [],
    hazard: null,
    time: 0,
    lastTime: 0,
    frame: 0,
    shake: 0,
    koFlash: 0,
    koLabel: "",
    p1Kos: 0,
    best: 0,
    sound: true,
    debug: false,
  };

  // ============================================================
  //  AUDIO  (synthesized — no files)
  // ============================================================
  const Sound = (() => {
    let ac = null;
    function ctxx() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
      }
      return ac;
    }
    function tone(freq, dur, type = "square", vol = 0.16, slideTo = null) {
      if (!state.sound) return;
      const a = ctxx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), a.currentTime + dur);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g); g.connect(a.destination);
      o.start(); o.stop(a.currentTime + dur + 0.02);
    }
    function noise(dur, vol = 0.18) {
      if (!state.sound) return;
      const a = ctxx(); if (!a) return;
      const n = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, n, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain(); g.gain.value = vol;
      src.connect(g); g.connect(a.destination); src.start();
    }
    const map = {
      jump: () => tone(420, 0.12, "square", 0.12, 720),
      hit: () => { tone(180, 0.09, "square", 0.16, 90); noise(0.06, 0.12); },
      smash: () => { tone(140, 0.18, "sawtooth", 0.2, 70); noise(0.12, 0.2); },
      ko: () => { tone(700, 0.5, "sawtooth", 0.2, 120); noise(0.3, 0.18); },
      shield: () => tone(300, 0.16, "sine", 0.12, 380),
      laser: () => tone(880, 0.14, "square", 0.12, 420),
      rocket: () => { tone(220, 0.3, "sawtooth", 0.14, 540); noise(0.2, 0.1); },
      throw: () => tone(360, 0.12, "triangle", 0.12, 220),
      swing: () => tone(520, 0.09, "triangle", 0.1, 300),
      heavy: () => { tone(120, 0.16, "sawtooth", 0.18, 70); },
      spray: () => noise(0.14, 0.12),
      glitch: () => { tone(660, 0.08, "square", 0.12, 110); noise(0.06, 0.12); },
      select: () => tone(560, 0.08, "square", 0.1, 720),
      start: () => { tone(440, 0.1, "square", 0.12, 660); setTimeout(() => tone(660, 0.14, "square", 0.12, 880), 90); },
      dodge: () => tone(240, 0.1, "sine", 0.08, 360),
      bounce: () => tone(330, 0.16, "sine", 0.14, 760),
    };
    return {
      play(name) { (map[name] || (() => {}))(); },
      resume() { const a = ctxx(); if (a && a.state === "suspended") a.resume(); },
    };
  })();

  // ============================================================
  //  FIGHTER CREATION
  // ============================================================
  function blankControl() {
    return {
      x: 0, up: false, down: false,
      jump: false, jumpHeld: false,
      attack: false, special: false,
      shield: false, grab: false,
      smashX: 0, smashY: 0,
    };
  }

  function makeFighter(id, slot, isCpu) {
    const def = FIGHTER_BY_ID[id] || FIGHTERS[0];
    const spawn = getStage().spawns[slot % getStage().spawns.length];
    const f = {
      def, id: def.id, slot, isCpu,
      name: def.name, glyph: def.glyph, color: def.color, accent: def.accent,
      moves: buildMoves(def),
      w: 48, h: 70,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      facing: spawn.x < W / 2 ? 1 : -1,
      onGround: false,
      jumps: 2,
      damage: 0,
      stocks: settings.stocks,
      state: "fall", // idle|walk|run|jump|fall|attack|hit|shield|dodge|ledge|dead|respawn
      attack: null,
      attackKind: null,
      hitstun: 0,
      hitlag: 0,
      shieldHealth: 1,
      shielding: false,
      dodgeTimer: 0,
      invuln: 0.5,
      specialCd: 0,
      counterTimer: 0,
      counterMult: 1,
      reflectTimer: 0,
      chargeTimer: 0,
      chargingMove: null,
      ledge: null,
      ledgeTimer: 0,
      respawnTimer: 0,
      grabbing: null,
      grabbedBy: null,
      grabTimer: 0,
      lastHitBy: -1,
      lastHitTime: 0,
      kos: 0,
      falls: 0,
      facingFlash: 0,
      slipping: 0,
      control: blankControl(),
      prevControl: blankControl(),
      hidden: false,
      onPlatform: null,
      dropTimer: 0,
      animTime: 0,
    };
    return f;
  }

  function getStage() { return STAGE_BY_ID[settings.stage] || STAGES[0]; }

  function mainPlatform(stage = getStage()) {
    return stage.platforms.find((p) => p.solid) || stage.platforms[0];
  }

  function resetCamera() {
    const main = mainPlatform();
    camera.x = main.x + main.w / 2;
    camera.y = main.y + main.h / 2 - 52;
    camera.zoom = clamp(
      Math.min(W / (main.w + 120), (H - 96) / (main.y + 96)),
      1.04,
      1.34,
    );
  }

  function updateCamera(dt) {
    const stage = getStage();
    const main = mainPlatform(stage);
    let minX = main.x - 48;
    let maxX = main.x + main.w + 48;
    let minY = main.y - 260;
    let maxY = main.y + main.h + 72;

    for (const f of state.fighters) {
      if (f.hidden || f.respawnTimer > 0) continue;
      const top = f.y - f.h;
      minX = Math.min(minX, f.x - f.w * 0.7);
      maxX = Math.max(maxX, f.x + f.w * 0.7);
      minY = Math.min(minY, top - 36);
      maxY = Math.max(maxY, f.y + 48);
    }

    const spanX = maxX - minX + 180;
    const spanY = maxY - minY + 150;
    const actionZoom = Math.min(W / spanX, H / spanY);
    const stageZoom = Math.min(W / (main.w + 110), (H - 92) / (main.y + 88));
    const targetZoom = clamp(Math.max(actionZoom, stageZoom * 0.98), 0.94, 1.38);
    const targetX = (minX + maxX) / 2;
    const targetY = (minY + maxY) / 2 - 28;
    const ease = 1 - Math.pow(0.00025, Math.max(dt, 0.001));

    camera.x = lerp(camera.x, targetX, ease);
    camera.y = lerp(camera.y, targetY, ease);
    camera.zoom = lerp(camera.zoom, targetZoom, ease);
  }

  function applyCameraTransform() {
    ctx.translate(W / 2, H / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  function fighterRect(f) {
    return { x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h };
  }
  function fighterCenter(f) { return { x: f.x, y: f.y - f.h / 2 }; }

  function aliveFighters() { return state.fighters.filter((f) => !f.hidden); }
  function opponentsOf(f) { return state.fighters.filter((o) => o !== f && !o.hidden && o.respawnTimer <= 0); }
  function nearestOpponent(f) {
    let best = null, bd = Infinity;
    opponentsOf(f).forEach((o) => {
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }

  // ============================================================
  //  INPUT
  // ============================================================
  const touch = Object.create(null);
  const CODE_MAP = {
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    jump: ["Space"],
    attack: ["KeyJ"],
    special: ["KeyK"],
    shield: ["KeyL"],
    grab: ["KeyI", "KeyU"],
    pause: ["KeyP", "Escape"],
  };
  const keysDown = new Set();

  function actionFromCode(code) {
    for (const [action, codes] of Object.entries(CODE_MAP)) {
      if (codes.includes(code)) return action;
    }
    return null;
  }

  function isActionDown(action) {
    const codes = CODE_MAP[action];
    return codes ? codes.some((code) => keysDown.has(code)) : false;
  }

  // edge / flick tracking for the human
  const flick = { x: 0, xTime: -1, y: 0, yTime: -1 };
  const human = blankControl();
  const humanPrev = blankControl();

  // Capture on document so A/D keep working after focus moves to pause/menu buttons.
  // Repeat keydown events re-affirm held keys if the browser drops a keyup.
  document.addEventListener("keydown", (e) => {
    const action = actionFromCode(e.code);
    if (!action) return;
    if (action === "pause") {
      if (!e.repeat) togglePause();
      e.preventDefault();
      return;
    }
    keysDown.add(e.code);
    if (!e.repeat) noteActionPress(action);
    e.preventDefault();
    Sound.resume();
  }, true);

  document.addEventListener("keyup", (e) => {
    const action = actionFromCode(e.code);
    if (!action || action === "pause") return;
    keysDown.delete(e.code);
  }, true);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearHumanInput();
  });

  function noteActionPress(action) {
    if (action !== "attack" && action !== "special") return;
    if (isActionDown("left") || touch.left) { flick.x = -1; flick.xTime = state.time; }
    else if (isActionDown("right") || touch.right) { flick.x = 1; flick.xTime = state.time; }
    if (isActionDown("up") || touch.up) { flick.y = -1; flick.yTime = state.time; }
    else if (isActionDown("down") || touch.down) { flick.y = 1; flick.yTime = state.time; }
  }

  function clearHumanInput() {
    keysDown.clear();
    for (const k of Object.keys(touch)) touch[k] = false;
    flick.x = 0; flick.xTime = -1; flick.y = 0; flick.yTime = -1;
  }

  function readHuman() {
    Object.assign(humanPrev, human);
    const left = isActionDown("left") || touch.left;
    const right = isActionDown("right") || touch.right;
    human.x = (right ? 1 : 0) - (left ? 1 : 0);
    human.up = isActionDown("up") || touch.up;
    human.down = isActionDown("down") || touch.down;
    // Tap-jump: Up / W also jumps (matches the on-screen hint and Smash convention).
    human.jumpHeld = isActionDown("jump") || isActionDown("up") || touch.jump;
    human.jump = human.jumpHeld;
    human.attack = isActionDown("attack") || touch.attack;
    human.special = isActionDown("special") || touch.special;
    human.shield = isActionDown("shield") || touch.shield;
    human.grab = isActionDown("grab") || touch.grab;
    // flick window for smash inputs (~150ms after attack/special + direction)
    const fresh = (t) => t >= 0 && state.time - t < 0.15;
    human.smashX = fresh(flick.xTime) ? flick.x : 0;
    human.smashY = fresh(flick.yTime) ? flick.y : 0;
    // edges
    human.pAttack = human.attack && !humanPrev.attack;
    human.pSpecial = human.special && !humanPrev.special;
    if (human.pAttack || human.pSpecial) {
      if (left) { flick.x = -1; flick.xTime = state.time; }
      else if (right) { flick.x = 1; flick.xTime = state.time; }
      if (human.up) { flick.y = -1; flick.yTime = state.time; }
      else if (human.down) { flick.y = 1; flick.yTime = state.time; }
      human.smashX = fresh(flick.xTime) ? flick.x : 0;
      human.smashY = fresh(flick.yTime) ? flick.y : 0;
    }
    human.pJump = human.jump && !humanPrev.jump;
    human.pShield = human.shield && !humanPrev.shield;
    human.pGrab = human.grab && !humanPrev.grab;
    return human;
  }

  // ============================================================
  //  CPU AI
  // ============================================================
  function cpuControl(f, dt) {
    const c = f.control;
    Object.assign(f.prevControl, c);
    c.x = 0; c.up = false; c.down = false; c.jump = false; c.jumpHeld = false;
    c.attack = false; c.special = false; c.shield = false; c.grab = false;
    c.smashX = 0; c.smashY = 0;
    c.pAttack = false; c.pSpecial = false; c.pJump = false; c.pShield = false; c.pGrab = false;

    const L = aiLevel();
    f.ai = f.ai || { think: 0, action: "approach", atkCd: 0, jitter: Math.random() * 1000 };

    if (f.hitstun > 0) {
      // DI toward stage center, scaled by skill (weaker CPUs barely DI)
      c.x = sign((W / 2) - f.x) * L.di;
      if (f.vy < -200 && Math.random() < L.di) c.up = true;
      return c;
    }
    if (f.respawnTimer > 0) return c;

    if (f.ai.atkCd > 0) f.ai.atkCd -= dt;
    f.ai.think -= dt;

    const target = nearestOpponent(f);

    // ---- recovery: off the stage, get back ----
    const stage = getStage();
    const main = stage.platforms.find((p) => p.solid);
    const offStage = f.x < main.x - 30 || f.x > main.x + main.w + 30;
    const belowStage = f.y > main.y + 40;
    if (!f.onGround && (offStage || belowStage) && f.y > 160) {
      // Always recover — a CPU that SDs is broken, not "easy". Beeline for the stage.
      c.x = sign((main.x + main.w / 2) - f.x);
      if (f.vy > 30 && f.jumps > 0) { c.jump = true; c.jumpHeld = true; c.pJump = true; } // burn the double-jump first
      if ((f.vy > 140 || f.jumps <= 0) && f.specialCd <= 0) { c.up = true; c.special = true; c.pSpecial = true; } // then up-B
      return c;
    }

    if (!target) return c;
    const dx = target.x - f.x;
    const dy = target.y - f.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    f.facingWant = sign(dx);

    // occasionally shield an incoming attack
    if (target.attack && adx < 86 && ady < 70 && Math.random() < L.shield) {
      c.shield = true;
      if (Math.random() < 0.35) { c.smashX = -sign(dx); c.pShield = true; } // roll away
      return c;
    }

    if (f.ai.think <= 0) {
      f.ai.think = rand(L.think[0], L.think[1]);
      if (adx < L.range && ady < 80) f.ai.action = "attack";
      else if (adx < 220 && f.specialCd <= 0 && Math.random() < L.special) f.ai.action = "special";
      else f.ai.action = "approach";
    }

    // Edge-awareness: never step off the main stage chasing a launched target.
    const safeL = main.x + 38, safeR = main.x + main.w - 38;
    const targetOnStage = target.x > main.x - 10 && target.x < main.x + main.w + 10;
    let mv = sign(dx);
    if (f.onGround) {
      if (mv < 0 && f.x <= safeL) mv = 0;
      if (mv > 0 && f.x >= safeR) mv = 0;
    }
    // approach (sometimes hang back so the player isn't smothered)
    if (adx > 44 && mv !== 0 && Math.random() < L.approach) c.x = mv;
    // jump toward a higher on-stage target / hop (don't leap after an off-stage target)
    if (dy < -70 && f.onGround && targetOnStage && Math.random() < 0.35 * L.approach) { c.jump = true; c.jumpHeld = true; c.pJump = true; }
    // drop through a platform to chase down
    if (dy > 90 && f.onPlatform && !f.onPlatform.solid && Math.random() < 0.25) c.down = true;

    if (f.ai.action === "attack" && adx < L.range && ady < 84 && f.ai.atkCd <= 0) {
      if (Math.random() < L.atk) {
        c.attack = true; c.pAttack = true;
        f.ai.atkCd = rand(L.atkCd[0], L.atkCd[1]); // can't spam attacks
        if (target.damage > 85 && Math.random() < L.smash) { c.smashX = sign(dx); c.x = sign(dx); } // go for kill
        else if (dy < -40 && Math.random() < L.smash + 0.2) { c.smashY = -1; c.up = true; }
      }
    } else if (f.ai.action === "special" && f.specialCd <= 0 && adx < 260) {
      c.special = true; c.pSpecial = true;
      c.x = sign(dx);
    }
    return c;
  }

  // ============================================================
  //  ATTACK DISPATCH
  // ============================================================
  function startAttack(f, c) {
    if (f.attack || f.hitstun > 0 || f.shielding || f.dodgeTimer > 0 || f.grabbedBy || f.grabbing) return;
    let moveName;
    if (f.onGround) {
      if (c.smashX) { moveName = "fsmash"; f.facing = c.smashX; }
      else if (c.smashY < 0) moveName = "usmash";
      else if (c.smashY > 0) moveName = "dsmash";
      else if (c.up) moveName = "utilt";
      else if (c.down) moveName = "dtilt";
      else if (c.x !== 0) { f.facing = sign(c.x); moveName = Math.abs(f.vx) > f.def.run * 0.6 ? "dash" : "ftilt"; }
      else moveName = "jab";
    } else {
      if (c.up) moveName = "uair";
      else if (c.down) moveName = "dair";
      else if (c.x === f.facing && c.x !== 0) moveName = "fair";
      else if (c.x === -f.facing && c.x !== 0) moveName = "bair";
      else moveName = "nair";
    }
    setAttack(f, moveName);
  }

  function setAttack(f, moveName) {
    const move = f.moves[moveName];
    if (!move) return;
    f.attack = instantiateMove(move, moveName);
    f.attackKind = moveName;
    f.state = "attack";
    if (move.lunge) { f.vx = f.facing * move.lunge; }
    if (moveName.endsWith("smash")) Sound.play("smash");
    else Sound.play("swing");
  }

  function instantiateMove(move, name) {
    return {
      name, t: 0, dur: move.dur, type: move.type, back: !!move.back, spike: !!move.spike,
      lunge: move.lunge || 0, lungeTime: move.lungeTime || 0,
      charge: !!move.charge,
      hits: move.hits.map((h) => ({ ...h })),
      used: new Set(),
      chargeMult: 1,
    };
  }

  function performSpecial(f, c) {
    if (f.attack || f.hitstun > 0 || f.shielding || f.specialCd > 0 || f.grabbedBy || f.grabbing) return;
    const sp = f.def.specials;
    let dir;
    if (c.up) dir = "up";
    else if (c.down) dir = "down";
    else if (c.x !== 0) { dir = "side"; f.facing = sign(c.x); }
    else dir = "neutral";
    const desc = sp[dir];
    if (!desc) return;
    f.specialCd = desc.cd || 0.4;
    runSpecial(f, desc, dir);
  }

  function runSpecial(f, desc, dir) {
    if (desc.sound) Sound.play(desc.sound);
    switch (desc.type) {
      case "projectile": spawnProjectile(f, desc.proj); break;
      case "projectile-burst": {
        const n = desc.count, spread = desc.spread;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : i / (n - 1) - 0.5;
          spawnProjectile(f, desc.proj, t * spread);
        }
        break;
      }
      case "melee": {
        f.attack = instantiateMove({ dur: desc.dur, type: "ground", hits: desc.hits, lunge: desc.lunge, lungeTime: desc.lungeTime }, "special-" + dir);
        f.attackKind = "special";
        f.state = "attack";
        if (desc.lunge) f.vx = f.facing * desc.lunge;
        break;
      }
      case "recovery": {
        f.vy = desc.vy;
        f.vx = f.facing * (desc.vx || 0);
        f.jumps = Math.max(f.jumps, 1); // can still act after
        f.attack = instantiateMove({ dur: desc.dur, type: "air", hits: desc.hits || [] }, "recover-" + dir);
        f.attackKind = "special";
        f.state = "attack";
        f.specialFloat = 0.2;
        break;
      }
      case "counter": {
        f.counterTimer = desc.dur;
        f.counterMult = desc.mult;
        f.state = "attack";
        f.attack = instantiateMove({ dur: desc.dur, type: "ground", hits: [] }, "counter");
        f.attackKind = "counter";
        break;
      }
      case "reflect": {
        f.reflectTimer = desc.dur;
        f.attack = instantiateMove({ dur: desc.dur, type: "ground", hits: desc.hits || [] }, "reflect");
        f.attackKind = "reflect";
        f.state = "attack";
        break;
      }
      case "teleport": {
        const dx = f.control.x || f.facing;
        const dy = f.control.up ? -1 : f.control.down ? 0.4 : -0.5;
        burst(f.x, f.y - f.h / 2, f.color, 16);
        f.x = clamp(f.x + dx * desc.dist, 40, W - 40);
        f.y = clamp(f.y + dy * desc.dist, 80, H);
        f.vx = dx * 160; f.vy = dy < 0 ? -260 : 80;
        f.invuln = Math.max(f.invuln, 0.25);
        f.jumps = Math.max(f.jumps, 1);
        burst(f.x, f.y - f.h / 2, f.color, 16);
        break;
      }
      case "fallobject": spawnFallObject(f, desc); break;
      case "trap": spawnTrap(f, desc); break;
      case "summon": spawnDog(f, desc); break;
    }
  }

  // ============================================================
  //  ENTITIES  (projectiles, summons, traps, hazards)
  // ============================================================
  function spawnProjectile(f, p, angleOffset = 0) {
    let vx = p.vx, vy = p.vy;
    if (angleOffset) {
      const a = rad(angleOffset);
      const nvx = vx * Math.cos(a) - vy * Math.sin(a);
      const nvy = vx * Math.sin(a) + vy * Math.cos(a);
      vx = nvx; vy = nvy;
    }
    state.entities.push({
      type: "projectile", kind: p.kind, owner: f.slot, color: p.color,
      x: f.x + f.facing * 32, y: f.y - 40,
      vx: f.facing * Math.abs(vx) + (f.facing < 0 ? 0 : 0), vy: vy,
      vxBase: vx, dir: f.facing,
      gravity: p.gravity || 0, r: p.r, life: p.life,
      dmg: p.dmg, base: p.base, scale: p.scale, angle: p.angle,
      bounce: p.bounce || 0, explode: p.explode || 0,
      used: new Set(),
    });
    // correct vx sign with facing for rotated bursts
    const e = state.entities[state.entities.length - 1];
    e.vx = f.facing * Math.abs(p.vx) * (vx < 0 ? -1 : 1);
    if (angleOffset) { e.vx = f.facing * vx; e.vy = vy; }
  }

  function spawnFallObject(f, desc) {
    const tx = clamp(f.x + f.facing * 110, 60, W - 60);
    state.entities.push({
      type: "fallobject", owner: f.slot, color: desc.color,
      x: tx, y: -40, vy: 0, w: desc.w, h: desc.h,
      dmg: desc.dmg, base: desc.base, scale: desc.scale, angle: desc.angle,
      life: 3, used: new Set(), warn: tx,
    });
  }

  function spawnTrap(f, desc) {
    const gy = groundYAt(f.x);
    state.entities.push({
      type: "trap", owner: f.slot, color: desc.color,
      x: f.x, y: gy, life: 8, armed: 0.3,
      dmg: desc.dmg, base: desc.base, scale: desc.scale, angle: desc.angle,
    });
  }

  function spawnDog(f, desc) {
    state.entities.push({
      type: "dog", owner: f.slot, color: desc.color,
      x: f.x + f.facing * 36, y: groundYAt(f.x), vx: f.facing * 360, dir: f.facing,
      life: 2, w: 56, h: 32,
      dmg: desc.dmg, base: desc.base, scale: desc.scale, angle: desc.angle,
      used: new Set(),
    });
  }

  function groundYAt(x) {
    // top of the main solid platform if x within it, else stage floor
    const stage = getStage();
    for (const p of stage.platforms) {
      if (p.solid && x >= p.x && x <= p.x + p.w) return p.y;
    }
    return STAGE_FLOOR;
  }

  function updateEntities(dt) {
    for (let i = state.entities.length - 1; i >= 0; i--) {
      const e = state.entities[i];
      e.life -= dt;
      if (e.type === "projectile") {
        e.vy += e.gravity * dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        // bounce off solid ground
        const gy = groundYAt(e.x);
        if (e.y > gy - e.r && e.vy > 0) {
          if (e.bounce > 0) { e.vy = -e.vy * 0.6; e.bounce--; e.y = gy - e.r; }
          else { if (e.explode) explode(e.x, e.y, e.explode, e); e.life = 0; }
        }
        if (e.x < -40 || e.x > W + 40 || e.y > H + 60) e.life = 0;
      } else if (e.type === "fallobject") {
        e.vy += 1600 * dt; e.y += e.vy * dt;
        const gy = groundYAt(e.x);
        if (e.y + e.h / 2 >= gy) { explode(e.x, gy - 10, 50, e); e.life = 0; }
      } else if (e.type === "trap") {
        if (e.armed > 0) e.armed -= dt;
      } else if (e.type === "dog") {
        e.x += e.vx * dt;
        // follow ground
        e.y = groundYAt(e.x);
        if (e.x < -40 || e.x > W + 40) e.life = 0;
      }
      if (e.life <= 0) state.entities.splice(i, 1);
    }
  }

  function explode(x, y, r, src) {
    burst(x, y, src.color || C.yellow, 22, r * 6);
    state.shake = Math.max(state.shake, 8);
    Sound.play("smash");
    state.fighters.forEach((f) => {
      if (f.hidden || f.respawnTimer > 0 || f.slot === src.owner) return;
      const ce = fighterCenter(f);
      if (Math.hypot(ce.x - x, ce.y - y) < r + f.w / 2) {
        applyHit(src.owner, f, { x, y, dmg: src.dmg, base: src.base + 60, scale: src.scale, angle: Math.atan2(-(ce.y - y), ce.x - x) * 180 / Math.PI });
      }
    });
  }

  // ============================================================
  //  STAGE HAZARDS
  // ============================================================
  function makeDroneHazard() {
    return {
      timer: 6, active: null,
      update(dt) {
        if (this.active) {
          const d = this.active;
          d.x += d.vx * dt;
          d.warn = Math.max(0, d.warn - dt);
          if (d.warn <= 0) {
            state.fighters.forEach((f) => {
              if (f.hidden || f.respawnTimer > 0) return;
              const c = fighterCenter(f);
              if (Math.abs(c.x - d.x) < 60 && Math.abs(c.y - d.y) < 40 && !d.used.has(f.slot)) {
                d.used.add(f.slot);
                applyHit(-1, f, { x: d.x, y: d.y, dmg: 10, base: 320, scale: 5, angle: d.vx > 0 ? 35 : 145 });
              }
            });
          }
          if (d.x < -120 || d.x > W + 120) this.active = null;
        } else {
          this.timer -= dt;
          if (this.timer <= 0) {
            this.timer = rand(7, 11);
            const fromLeft = Math.random() < 0.5;
            this.active = { x: fromLeft ? -100 : W + 100, y: rand(210, 390), vx: (fromLeft ? 1 : -1) * 360, warn: 1.0, used: new Set() };
          }
        }
      },
      draw(g) {
        const d = this.active; if (!d) return;
        g.save();
        if (d.warn > 0) {
          g.globalAlpha = 0.5 + 0.3 * Math.sin(state.time * 18);
          g.fillStyle = C.red;
          g.font = "28px sans-serif";
          g.textAlign = "center";
          g.fillText("⚠", d.x, d.y);
        } else {
          g.font = "44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText("📡", d.x, d.y);
          g.strokeStyle = C.cyan; g.lineWidth = 2; g.globalAlpha = 0.5;
          g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.vx * 0.06, d.y); g.stroke();
        }
        g.restore();
      },
    };
  }

  function makeMissileHazard() {
    return {
      timer: 7, phase: "idle", t: 0, side: 1, tx: 0,
      update(dt) {
        this.t -= dt;
        if (this.phase === "idle") {
          this.timer -= dt;
          if (this.timer <= 0) { this.phase = "warn"; this.t = 1.3; this.side = Math.random() < 0.5 ? -1 : 1; const main = getStage().platforms[0]; this.tx = this.side < 0 ? main.x + 40 : main.x + main.w - 40; }
        } else if (this.phase === "warn") {
          if (this.t <= 0) { this.phase = "boom"; this.t = 0.3; explode(this.tx, STAGE_FLOOR - 30, 70, { owner: -1, dmg: 14, base: 360, scale: 6, color: C.orange }); }
        } else if (this.phase === "boom") {
          if (this.t <= 0) { this.phase = "idle"; this.timer = rand(8, 12); }
        }
      },
      draw(g) {
        if (this.phase === "warn") {
          g.save();
          g.globalAlpha = 0.4 + 0.4 * Math.sin(state.time * 20);
          g.fillStyle = C.red; g.textAlign = "center";
          g.font = "30px sans-serif";
          g.fillText("🎯", this.tx, STAGE_FLOOR - 50);
          g.restore();
        }
      },
    };
  }

  function makeTrainHazard() {
    return {
      timer: 8, phase: "idle", t: 0, x: 0, dir: 1,
      update(dt) {
        if (this.phase === "idle") {
          this.timer -= dt;
          if (this.timer <= 0) { this.phase = "warn"; this.t = 1.4; this.dir = Math.random() < 0.5 ? 1 : -1; }
        } else if (this.phase === "warn") {
          this.t -= dt;
          if (this.t <= 0) { this.phase = "run"; this.x = this.dir > 0 ? -260 : W + 260; this.used = new Set(); }
        } else if (this.phase === "run") {
          this.x += this.dir * 1080 * dt;
          state.fighters.forEach((f) => {
            if (f.hidden || f.respawnTimer > 0) return;
            const c = fighterCenter(f);
            if (c.y > 500 && Math.abs(c.x - this.x) < 130 && !this.used.has(f.slot)) {
              this.used.add(f.slot);
              applyHit(-1, f, { x: this.x, y: c.y, dmg: 16, base: 380, scale: 5, angle: this.dir > 0 ? 20 : 160 });
            }
          });
          if (this.x < -300 || this.x > W + 300) { this.phase = "idle"; this.timer = rand(9, 13); }
        }
      },
      draw(g) {
        if (this.phase === "warn") {
          g.save();
          g.globalAlpha = 0.5 + 0.4 * Math.sin(state.time * 16);
          g.fillStyle = C.yellow; g.textAlign = "center"; g.font = "bold 22px sans-serif";
          g.fillText(this.dir > 0 ? "🚇 TRAIN ▶" : "◀ TRAIN 🚇", W / 2, 170);
          g.restore();
        } else if (this.phase === "run") {
          g.save();
          g.translate(this.x, 530);
          g.fillStyle = "#2a2f44"; g.strokeStyle = C.cyan; g.lineWidth = 3;
          g.fillRect(-120, -70, 240, 84); g.strokeRect(-120, -70, 240, 84);
          g.fillStyle = C.yellow;
          for (let i = -90; i < 110; i += 50) g.fillRect(i, -52, 30, 26);
          g.fillStyle = this.dir > 0 ? C.yellow : C.cyan;
          g.beginPath(); g.arc(this.dir > 0 ? 120 : -120, -10, 10, 0, TAU); g.fill();
          g.restore();
        }
      },
    };
  }

  function makeChandelierHazard() {
    return {
      timer: 9, phase: "idle", t: 0, x: 0,
      update(dt) {
        if (this.phase === "idle") {
          this.timer -= dt;
          if (this.timer <= 0) { this.phase = "warn"; this.t = 1.1; const main = getStage().platforms[0]; this.x = rand(main.x + 60, main.x + main.w - 60); }
        } else if (this.phase === "warn") {
          this.t -= dt;
          if (this.t <= 0) { this.phase = "drop"; this.y = -40; this.vy = 0; this.used = new Set(); }
        } else if (this.phase === "drop") {
          this.vy += 1700 * dt; this.y += this.vy * dt;
          const gy = groundYAt(this.x);
          if (this.y >= gy - 20) { explode(this.x, gy - 14, 60, { owner: -1, dmg: 15, base: 360, scale: 5.5, color: C.yellow }); this.phase = "idle"; this.timer = rand(9, 13); }
        }
      },
      draw(g) {
        if (this.phase === "warn") {
          g.save();
          g.globalAlpha = 0.4 + 0.4 * Math.sin(state.time * 18);
          g.strokeStyle = C.red; g.lineWidth = 3; g.setLineDash([6, 6]);
          g.beginPath(); g.moveTo(this.x, 40); g.lineTo(this.x, groundYAt(this.x)); g.stroke();
          g.restore();
        } else if (this.phase === "drop") {
          g.save(); g.font = "40px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText("🪩", this.x, this.y); g.restore();
        }
      },
    };
  }

  // ============================================================
  //  FIGHTER UPDATE / PHYSICS
  // ============================================================
  const GRAV = 1.0; // multiplier already baked into per-fighter fall

  function updateFighter(f, dt) {
    if (f.hidden) return;
    f.animTime += dt;
    if (f.facingFlash > 0) f.facingFlash -= dt;

    // hitlag freeze
    if (f.hitlag > 0) { f.hitlag -= dt; return; }

    // timers
    if (f.invuln > 0) f.invuln -= dt;
    if (f.specialCd > 0) f.specialCd -= dt;
    if (f.dodgeTimer > 0) f.dodgeTimer -= dt;
    if (f.reflectTimer > 0) f.reflectTimer -= dt;
    if (f.counterTimer > 0) f.counterTimer -= dt;
    if (f.slipping > 0) f.slipping -= dt;

    // respawn handling
    if (f.respawnTimer > 0) {
      f.respawnTimer -= dt;
      f.invuln = Math.max(f.invuln, 0.05);
      if (f.respawnTimer <= 0) {
        f.x = W / 2 + (f.slot - 1.5) * 48; f.y = 96; f.vx = 0; f.vy = 0;
        f.damage = 0; f.state = "fall"; f.invuln = 1.4; f.hitstun = 0;
      } else {
        return;
      }
    }

    // grabbed: locked
    if (f.grabbedBy) {
      const g = f.grabbedBy;
      f.x = g.x + g.facing * 38; f.y = g.y; f.vx = 0; f.vy = 0;
      return;
    }

    const c = f.control;

    // ---- ledge hang ----
    if (f.state === "ledge") {
      f.vx = 0; f.vy = 0;
      f.ledgeTimer -= dt;
      f.invuln = Math.max(f.invuln, 0);
      // climb up
      if (c.up || c.pJump || (c.x === f.ledge.dir)) {
        f.state = "fall"; f.onGround = false;
        f.y = f.ledge.y - 6; f.x += f.ledge.dir * 30; f.vy = -560; f.vx = f.ledge.dir * 120;
        f.jumps = 2; f.invuln = 0.4; f.ledge = null;
      } else if (c.down || c.x === -f.ledge.dir) {
        f.state = "fall"; f.ledge = null; f.vy = 60; f.jumps = 1; f.dropTimer = 0.25;
      }
      return;
    }

    // ---- counter / reflect / attack states tick ----
    if (f.attack) {
      f.attack.t += dt;
      if (f.attack.lunge && f.attack.t < f.attack.lungeTime) {
        // keep lunge momentum (decays via friction below)
      }
      if (f.attack.t >= f.attack.dur) {
        f.attack = null; f.attackKind = null;
        f.state = f.onGround ? "idle" : "fall";
        f.counterTimer = 0; f.reflectTimer = 0;
      }
    }

    const acting = !!f.attack || f.hitstun > 0;
    const canMove = !acting && f.dodgeTimer <= 0;

    // ---- shield / dodge / grab (ground, idle) ----
    if (f.onGround && !f.attack && f.hitstun <= 0 && f.dodgeTimer <= 0) {
      if (c.shield) {
        if (!f.shielding && c.pShield) { /* entering */ }
        // dodge inputs while shielding
        if (c.pShield === false && f.shielding) {}
        // spot dodge / roll on flick while holding shield
        if (c.smashY > 0 || (c.down && c.pShield)) { f.dodgeTimer = 0.32; f.invuln = 0.28; f.state = "dodge"; f.dodgeKind = "spot"; f.shielding = false; Sound.play("dodge"); }
        else if (c.smashX !== 0) { f.dodgeTimer = 0.36; f.invuln = 0.26; f.state = "dodge"; f.dodgeKind = "roll"; f.dodgeDir = c.smashX; f.shielding = false; Sound.play("dodge"); }
        else if (c.pGrab || (c.pAttack)) { tryGrab(f); f.shielding = false; }
        else { f.shielding = true; f.state = "shield"; f.vx *= 0.6; f.shieldHealth = Math.max(0, f.shieldHealth - dt * 0.18); if (f.shieldHealth <= 0) shieldBreak(f); }
      } else {
        if (f.shielding) { f.shielding = false; f.state = "idle"; }
        f.shieldHealth = Math.min(1, f.shieldHealth + dt * 0.1);
      }
    } else if (f.shielding) {
      f.shielding = false;
    }

    // roll movement
    if (f.dodgeTimer > 0 && f.dodgeKind === "roll") {
      f.vx = f.dodgeDir * f.def.run * 1.3;
    }

    // ---- action inputs ----
    if (canMove && !f.shielding) {
      if (c.pGrab && f.onGround) tryGrab(f);
      else if (c.pAttack) startAttack(f, c);
      else if (c.pSpecial) performSpecial(f, c);
    }
    if (!f.onGround && !f.attack && f.hitstun <= 0) {
      if (c.pAttack) startAttack(f, c);
      else if (c.pSpecial) performSpecial(f, c);
    }

    // ---- jumping ----
    if (canMove && !f.shielding && c.pJump) {
      if (f.onGround) { f.vy = c.jumpHeld ? -f.def.jump : -f.def.hop; f.onGround = false; f.jumps = 1; f.state = "jump"; Sound.play("jump"); }
      else if (f.jumps > 0) { f.vy = -f.def.doubleJump; f.jumps--; f.state = "jump"; Sound.play("jump"); burst(f.x, f.y - 8, f.accent, 8); }
    }

    // ---- horizontal movement ----
    if (canMove && !f.shielding && f.dodgeKind !== "roll") {
      const moveRate = (rate) => 1 - Math.pow(1 - rate, dt * 60);
      if (f.onGround) {
        if (c.x !== 0) {
          f.facing = sign(c.x);
          // Snappy ground accel so input feels immediate (slippery on oil slicks).
          const accel = f.slipping > 0 ? moveRate(0.08) : moveRate(0.72);
          f.vx = lerp(f.vx, c.x * f.def.run * STAGE_MOVE_SCALE, accel);
          f.state = Math.abs(f.vx) > f.def.walk * STAGE_MOVE_SCALE ? "run" : "walk";
        } else {
          const fric = f.slipping > 0 ? moveRate(0.06) : moveRate(0.62);
          f.vx = lerp(f.vx, 0, fric);
          if (Math.abs(f.vx) < 10) { f.vx = 0; if (f.state === "walk" || f.state === "run") f.state = "idle"; }
        }
      } else {
        if (c.x !== 0) {
          f.facing = f.attack ? f.facing : sign(c.x);
          // Responsive air drift.
          const airCap = f.def.air * STAGE_MOVE_SCALE;
          f.vx = clamp(f.vx + c.x * airCap * 0.42 * dt * 60, -airCap, airCap);
        } else {
          f.vx = lerp(f.vx, 0, moveRate(0.06));
        }
      }
    }

    // ---- gravity ----
    if (!f.onGround) {
      let fall = f.def.fall;
      if (c.down && f.vy > 0 && !f.attack) fall = f.def.fastFall;
      f.vy += 2600 * dt;
      const cap = c.down && f.vy > 0 ? f.def.fastFall : f.def.fall;
      if (f.vy > cap) f.vy = cap;
      if (f.specialFloat > 0) { f.specialFloat -= dt; }
    }

    // ---- hitstun ----
    if (f.hitstun > 0) {
      f.hitstun -= dt;
      // DI
      f.vx += c.x * 16;
      if (c.up) f.vy -= 10;
      f.vx *= 0.992;
      if (f.hitstun <= 0 && f.state === "hit") f.state = f.onGround ? "idle" : "fall";
    }

    // ---- integrate ----
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    // ---- collisions ----
    handlePlatformCollisions(f, dt);

    // bounce pads
    const stage = getStage();
    if (f.onGround && stage.bounce) {
      for (const b of stage.bounce) {
        if (f.x > b.x - b.w / 2 && f.x < b.x + b.w / 2 && Math.abs(f.y - b.y) < 30) {
          f.vy = -b.power; f.onGround = false; f.jumps = 1; f.state = "jump"; Sound.play("bounce");
        }
      }
    }

    // oil slick -> slippery
    if (f.onGround && stage.oil) {
      for (const o of stage.oil) {
        if (f.x > o.x && f.x < o.x + o.w && Math.abs(f.y - o.y) < 18) f.slipping = 0.2;
      }
    }

    // trap trigger
    state.entities.forEach((e) => {
      if (e.type === "trap" && e.armed <= 0 && e.owner !== f.slot && f.onGround) {
        if (Math.abs(f.x - e.x) < 30 && Math.abs(f.y - e.y) < 20) {
          applyHit(e.owner, f, { x: e.x, y: e.y, dmg: e.dmg, base: e.base, scale: e.scale, angle: e.angle });
          e.life = 0;
        }
      }
    });

    // ledge grab attempt
    if (!f.onGround && f.vy > 0 && f.hitstun <= 0 && f.state !== "ledge") tryLedgeGrab(f);

    // facing want for cpu
    if (f.isCpu && f.facingWant && !f.attack) f.facing = f.facingWant;
  }

  function handlePlatformCollisions(f, dt) {
    const stage = getStage();
    const prevBottom = f.y - f.vy * dt;
    f.onGround = false;
    f.onPlatform = null;
    if (f.dropTimer > 0) f.dropTimer -= dt;

    for (const p of stage.platforms) {
      const px = p.curX !== undefined ? p.curX : p.x;
      const py = p.curY !== undefined ? p.curY : p.y;
      const withinX = f.x > px - 8 && f.x < px + p.w + 8;
      if (!withinX) continue;
      const wantsDrop = !p.solid && (f.control.down || f.dropTimer > 0);
      // land on top when crossing the top going down
      const landing = f.vy >= 0 && prevBottom <= py + 3 && f.y >= py - 1;
      // keep grounded while walking — prevents micro-bounce jitter on wide stages
      const standing = !wantsDrop && f.vy <= 40 && Math.abs(f.y - py) <= 6;
      if (landing || standing) {
        if (wantsDrop) continue; // drop through pass-through platforms
        f.y = py; f.vy = 0; f.onGround = true; f.onPlatform = p; f.jumps = 2;
        if (f.state === "fall" || f.state === "jump" || f.state === "hit") {
          f.state = Math.abs(f.vx) > 12 ? "walk" : "idle";
        }
        // carry with moving platforms
        if (p.move && p.lastDX) f.x += p.lastDX;
        break;
      }
    }
  }

  function tryLedgeGrab(f) {
    const stage = getStage();
    const main = stage.platforms.find((p) => p.solid);
    if (!main) return;
    if (f.ledgeCooldown > 0) return;
    const lipY = main.y;
    // must be below the lip and just outside the platform horizontally
    for (const dir of [-1, 1]) {
      const edgeX = dir < 0 ? main.x : main.x + main.w;
      const nearX = Math.abs(f.x - edgeX) < 26;
      const belowLip = f.y - f.h > lipY - 6 && f.y - f.h < lipY + 70;
      const outside = dir < 0 ? f.x < edgeX + 8 : f.x > edgeX - 8;
      if (nearX && belowLip && outside && f.vy > 0) {
        f.state = "ledge"; f.ledge = { x: edgeX, y: lipY, dir };
        f.x = edgeX - dir * 14; f.y = lipY + Math.round(f.h * 0.55);
        f.vx = 0; f.vy = 0; f.jumps = 2; f.invuln = Math.max(f.invuln, 0.5);
        f.ledgeTimer = 6;
        return;
      }
    }
  }

  // ============================================================
  //  GRAB / THROW
  // ============================================================
  function tryGrab(f) {
    if (f.attack || f.grabbing) return;
    f.attack = instantiateMove({ dur: 0.3, type: "ground", hits: [] }, "grab");
    f.attackKind = "grab";
    f.state = "attack";
    const range = 46;
    for (const o of opponentsOf(f)) {
      if (o.invuln > 0 || o.shielding) continue;
      if (sign(o.x - f.x) === f.facing && Math.abs(o.x - f.x) < range && Math.abs(o.y - f.y) < 50) {
        f.grabbing = o; o.grabbedBy = f; o.state = "hit"; o.vx = 0; o.vy = 0;
        f.grabTimer = 0.9; f.attack.dur = 1.2;
        Sound.play("shield");
        return;
      }
    }
  }

  function updateGrab(f, dt) {
    if (!f.grabbing) return;
    const o = f.grabbing;
    if (o.hidden) { releaseGrab(f); return; }
    f.grabTimer -= dt;
    const c = f.control;
    // pummel
    if (c.pAttack) { o.damage += 2; o.hitlag = 0.06; f.hitlag = 0.06; burst(o.x, o.y - o.h / 2, C.yellow, 5); Sound.play("hit"); }
    // throw
    let dir = null;
    if (c.smashX || (c.x !== 0 && c.pSpecial === false && (c.pAttack === false))) {
      if (c.x > 0) dir = "f"; else if (c.x < 0) dir = "b";
    }
    if (c.up || c.smashY < 0) dir = "u";
    else if (c.down || c.smashY > 0) dir = "d";
    if ((c.x !== 0) && dir === null) dir = sign(c.x) === f.facing ? "f" : "b";
    if (dir || f.grabTimer <= 0) {
      doThrow(f, o, dir || "f");
      releaseGrab(f);
    }
  }

  function doThrow(f, o, dir) {
    let angle, base = 300, scale = 5, dmg = 9;
    const face = f.facing;
    if (dir === "f") { angle = face > 0 ? 35 : 145; }
    else if (dir === "b") { f.facing = -face; angle = face > 0 ? 145 : 35; }
    else if (dir === "u") { angle = 90; base = 280; }
    else { angle = face > 0 ? 12 : 168; base = 240; dmg = 6; }
    o.grabbedBy = null;
    applyHit(f.slot, o, { x: o.x, y: o.y - o.h / 2, dmg, base, scale, angle, forceThrow: true });
    Sound.play("smash");
  }

  function releaseGrab(f) {
    if (f.grabbing) { if (f.grabbing.grabbedBy === f) f.grabbing.grabbedBy = null; f.grabbing = null; }
  }

  function shieldBreak(f) {
    f.shielding = false;
    f.state = "hit";
    f.hitstun = 2.0;
    f.shieldHealth = 0.4;
    f.vy = -200;
    Sound.play("ko");
    pushFloater(f.x, f.y - f.h - 10, "SHIELD BREAK!", C.red);
  }

  // ============================================================
  //  HIT RESOLUTION
  // ============================================================
  function resolveHits() {
    // fighter attack hitboxes
    for (const atk of state.fighters) {
      if (atk.hidden || !atk.attack || atk.hitlag > 0) continue;
      const boxes = activeHitboxes(atk);
      if (!boxes.length) continue;
      for (const target of state.fighters) {
        if (target === atk || target.hidden || target.respawnTimer > 0) continue;
        if (target.invuln > 0) continue;
        if (atk.attack.used.has(target.slot)) continue;
        const tr = fighterRect(target);
        for (const b of boxes) {
          if (rectsOverlap(b.x, b.y, b.w, b.h, tr.x, tr.y, tr.w, tr.h)) {
            atk.attack.used.add(target.slot);
            onHitConnect(atk, target, b);
            break;
          }
        }
      }
    }
    // projectiles / dogs / fallobjects vs fighters
    for (const e of state.entities) {
      if (e.type === "projectile" || e.type === "dog") {
        for (const f of state.fighters) {
          if (f.hidden || f.respawnTimer > 0 || f.slot === e.owner || f.invuln > 0) continue;
          if (e.used && e.used.has(f.slot)) continue;
          const tr = fighterRect(f);
          const ew = e.r ? e.r * 2 : e.w, eh = e.r ? e.r * 2 : e.h;
          const ex = e.x - ew / 2, ey = e.y - eh / 2;
          if (rectsOverlap(ex, ey, ew, eh, tr.x, tr.y, tr.w, tr.h)) {
            // reflect?
            if (e.type === "projectile" && f.reflectTimer > 0 && sign(e.vx) === -f.facing) {
              e.vx = -e.vx * 1.4; e.owner = f.slot; e.dmg = Math.round(e.dmg * 1.3); e.base += 40;
              burst(e.x, e.y, f.color, 8); Sound.play("shield"); continue;
            }
            if (f.shielding) { hitShield(f, { dmg: e.dmg, x: e.x }); if (e.type === "projectile" && !e.explode) e.life = 0; continue; }
            if (f.counterTimer > 0) { triggerCounter(f, e.owner, e.dmg); if (e.type === "projectile") e.life = 0; continue; }
            applyHit(e.owner, f, { x: e.x, y: e.y, dmg: e.dmg, base: e.base, scale: e.scale, angle: e.dir < 0 ? 180 - e.angle : e.angle });
            if (e.type === "projectile") { if (e.explode) explode(e.x, e.y, e.explode, e); e.life = 0; }
            else if (e.used) e.used.add(f.slot);
          }
        }
      }
    }
  }

  function activeHitboxes(f) {
    if (!f.attack) return [];
    const t = f.attack.t;
    const out = [];
    for (const h of f.attack.hits) {
      if (t >= h.s && t <= h.e) {
        const dx = (f.attack.back ? -f.facing : f.facing) * h.dx;
        out.push({ x: f.x + dx - h.w / 2, y: f.y + h.dy - h.h / 2, w: h.w, h: h.h, raw: h });
      }
    }
    return out;
  }

  function onHitConnect(atk, target, box) {
    const h = box.raw;
    // shield
    if (target.shielding) { hitShield(target, { dmg: h.dmg, x: atk.x }); atk.hitlag = 0.06; return; }
    // counter
    if (target.counterTimer > 0) { triggerCounter(target, atk.slot, h.dmg); return; }
    let angle = h.angle;
    if ((atk.attack.back ? -atk.facing : atk.facing) < 0) angle = 180 - angle;
    let mult = 1;
    if (atk.attack.charge) mult = atk.attack.chargeMult || 1;
    applyHit(atk.slot, target, { x: target.x, y: target.y - target.h / 2, dmg: h.dmg, base: h.base, scale: h.scale, angle, spike: atk.attack.spike });
  }

  function hitShield(f, info) {
    f.shieldHealth = Math.max(0, f.shieldHealth - (info.dmg * 0.045 + 0.05));
    f.vx += sign(f.x - info.x) * 40;
    Sound.play("shield");
    if (f.shieldHealth <= 0) shieldBreak(f);
  }

  function triggerCounter(counterer, attackerSlot, incomingDmg) {
    const attacker = state.fighters.find((o) => o.slot === attackerSlot);
    counterer.counterTimer = 0;
    counterer.attack = null;
    pushFloater(counterer.x, counterer.y - counterer.h - 8, "COUNTER!", C.yellow);
    Sound.play("smash");
    if (attacker && !attacker.hidden) {
      const dmg = Math.round((incomingDmg + 4) * counterer.counterMult);
      const angle = counterer.x < attacker.x ? 35 : 145;
      applyHit(counterer.slot, attacker, { x: attacker.x, y: attacker.y - attacker.h / 2, dmg, base: 340, scale: 6, angle });
    }
  }

  function applyHit(attackerSlot, target, hit) {
    if (target.invuln > 0 && !hit.forceThrow) return;
    target.damage = Math.min(999, target.damage + hit.dmg);
    const weight = target.def.weight;
    const launch = (hit.base + target.damage * hit.scale) * (1.55 / weight);
    const a = rad(hit.angle);
    target.vx = Math.cos(a) * launch;
    target.vy = -Math.sin(a) * launch;
    if (hit.spike) target.vy = Math.abs(launch) * 0.7; // drive downward
    target.hitstun = clamp(launch * 0.00045, 0.08, 1.4);
    target.hitlag = clamp(0.04 + hit.dmg * 0.004, 0.04, 0.14);
    target.state = "hit";
    target.onGround = false;
    target.shielding = false;
    target.attack = null;
    target.lastHitBy = attackerSlot;
    target.lastHitTime = state.time;
    if (attackerSlot >= 0) { const a2 = state.fighters.find((o) => o.slot === attackerSlot); if (a2) a2.hitlag = Math.max(a2.hitlag, target.hitlag * 0.7); }
    // fx
    burst(hit.x, hit.y, launch > 1100 ? C.red : C.yellow, launch > 1100 ? 16 : 9, launch);
    pushFloater(target.x, target.y - target.h - 6, Math.round(target.damage) + "%", launch > 1100 ? C.red : C.ink);
    state.shake = Math.max(state.shake, clamp(launch / 250, 2, 12));
    Sound.play(launch > 1100 ? "smash" : "hit");
  }

  // ============================================================
  //  KO / BLAST ZONES
  // ============================================================
  function checkBlastZones() {
    const b = getStage().blast;
    for (const f of state.fighters) {
      if (f.hidden || f.respawnTimer > 0) continue;
      const c = fighterCenter(f);
      if (c.x < b.left || c.x > b.right || c.y < b.top || (f.y) > b.bottom) {
        koFighter(f);
      }
    }
  }

  function koFighter(f) {
    if (f.respawnTimer > 0 || f.hidden) return;
    f.stocks--;
    f.falls++;
    state.koFlash = 0.4;
    state.koLabel = f.name + " KO'd!";
    state.shake = 12;
    Sound.play("ko");
    burst(clamp(f.x, 20, W - 20), clamp(f.y - 20, 20, H - 20), f.color, 26, 600);
    // credit
    const killer = state.fighters.find((o) => o.slot === f.lastHitBy);
    if (killer && killer !== f && state.time - f.lastHitTime < 4) {
      killer.kos++;
      if (!killer.isCpu) { state.p1Kos++; }
    }
    releaseGrab(f);
    if (f.grabbedBy) { f.grabbedBy.grabbing = null; f.grabbedBy = null; }

    if (f.stocks <= 0) {
      f.hidden = true; f.state = "dead";
      checkMatchEnd();
    } else {
      f.respawnTimer = 1.0;
      f.damage = 0; f.vx = 0; f.vy = 0; f.attack = null; f.hitstun = 0;
      f.x = W / 2 + (f.slot - 1.5) * 44; f.y = -36;
    }
  }

  function checkMatchEnd() {
    const alive = state.fighters.filter((f) => f.stocks > 0);
    if (alive.length <= 1 && state.screen === "fight") {
      const winner = alive[0] || null;
      endMatch(winner);
    }
  }

  // ============================================================
  //  PARTICLES / FLOATERS
  // ============================================================
  function burst(x, y, color, n, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = rand(0.3, 1) * Math.min(360, speed * 0.5 + 60);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: rand(0.3, 0.7), max: 0.7, color, r: rand(2, 5) });
    }
  }
  function pushFloater(x, y, text, color) {
    state.floaters.push({ x, y, text, color, life: 0.8, vy: -40 });
  }
  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const fl = state.floaters[i];
      fl.y += fl.vy * dt; fl.vy *= 0.94; fl.life -= dt;
      if (fl.life <= 0) state.floaters.splice(i, 1);
    }
  }

  // ============================================================
  //  MOVING PLATFORMS
  // ============================================================
  function updateMovingPlatforms(dt) {
    const stage = getStage();
    for (const p of stage.platforms) {
      if (!p.move) continue;
      const m = p.move;
      const prev = p.curX !== undefined ? p.curX : p.x;
      const off = Math.sin(state.time * m.speed * TAU * 0.25 + m.phase) * m.amp;
      if (m.axis === "x") { p.curX = p.x + off; p.curY = p.y; p.lastDX = p.curX - prev; }
      else { p.curY = p.y + off; p.curX = p.x; p.lastDX = 0; }
    }
  }

  // ============================================================
  //  MAIN UPDATE
  // ============================================================
  function update(dt) {
    state.time += dt;
    state.frame++;
    if (state.koFlash > 0) state.koFlash -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);

    if (state.screen !== "fight" || state.paused) {
      resetCamera();
      updateParticles(dt);
      return;
    }

    updateCamera(dt);

    readHuman();
    updateMovingPlatforms(dt);

    // assign controls
    for (const f of state.fighters) {
      if (f.hidden) continue;
      f.control = f.isCpu ? cpuControl(f, dt) : human;
    }

    for (const f of state.fighters) updateFighter(f, dt);
    for (const f of state.fighters) updateGrab(f, dt);

    updateEntities(dt);
    if (state.hazard) state.hazard.update(dt);
    resolveHits();
    checkBlastZones();
    updateParticles(dt);

    updateHud();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function draw() {
    ctx.save();
    applyCameraTransform();

    // camera shake
    let sx = 0, sy = 0;
    if (state.shake > 0) { sx = rand(-state.shake, state.shake); sy = rand(-state.shake, state.shake); }
    ctx.translate(sx, sy);

    drawBackground();
    drawStage();
    if (state.hazard && state.hazard.draw) state.hazard.draw(ctx);
    drawEntities();
    for (const f of state.fighters) if (!f.hidden && f.respawnTimer <= 0) drawFighter(f);
    drawParticles();
    drawFloaters();
    ctx.restore();

    if (state.screen === "fight") drawHud();
    if (state.koFlash > 0) {
      ctx.save();
      ctx.globalAlpha = state.koFlash * 1.6;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawBackground() {
    const stage = getStage();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stage.sky[0]); g.addColorStop(1, stage.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    // parallax shapes per stage
    ctx.save();
    if (stage.id === "rooftop") {
      ctx.fillStyle = "rgba(46,224,255,0.06)";
      for (let i = 0; i < 8; i++) { const bx = 40 + i * 160; ctx.fillRect(bx, 120 + (i % 3) * 44, 100, 430); }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 36; i++) ctx.fillRect((i * 137) % W, (i * 53) % 240, 2, 2);
    } else if (stage.id === "hormuz") {
      ctx.fillStyle = "rgba(43,80,110,0.5)";
      ctx.fillRect(-20, 430, W + 40, H);
      ctx.fillStyle = "rgba(120,160,200,0.12)";
      for (let i = 0; i < 10; i++) ctx.fillRect(i * 130, 450 + (i % 2) * 16, 90, 6);
    } else if (stage.id === "subway") {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      for (let i = 0; i < 12; i++) ctx.fillRect(i * 110, 90, 70, 500);
      ctx.fillStyle = "rgba(176,123,255,0.10)";
      ctx.fillRect(-20, 500, W + 40, 190);
    } else if (stage.id === "mansion") {
      ctx.fillStyle = "rgba(20,40,28,0.5)";
      for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(30 + i * 90, 230, 44, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 20; i++) ctx.fillRect((i * 211) % W, (i * 71) % 160, 2, 2);
    }
    ctx.restore();
  }

  function drawStage() {
    const stage = getStage();
    for (const p of stage.platforms) {
      const px = p.curX !== undefined ? p.curX : p.x;
      const py = p.curY !== undefined ? p.curY : p.y;
      drawPlatform(stage, p, px, py);
    }
    // oil slicks
    if (stage.oil) {
      ctx.save();
      for (const o of stage.oil) {
        ctx.fillStyle = "rgba(20,18,30,0.85)";
        ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + 3, o.w / 2, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(120,90,200,0.3)";
        ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + 3, o.w / 2.4, 4, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // bounce pads
    if (stage.bounce) {
      for (const b of stage.bounce) {
        ctx.save();
        ctx.fillStyle = C.cyan; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, b.w / 2, 12, 0, 0, Math.PI, true); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = "#0c2a32";
        ctx.fillText("⛲", b.x - 8, b.y + 6);
        ctx.restore();
      }
    }
  }

  function drawPlatform(stage, p, px, py) {
    ctx.save();
    let top = p.solid ? "#3a3f5a" : "#2c3150";
    let face = p.solid ? "#22253a" : "#1c2036";
    let edge = stage.id === "rooftop" ? C.cyan : stage.id === "hormuz" ? C.orange : stage.id === "subway" ? C.purple : C.green;
    if (stage.id === "hormuz" && p.solid) { top = "#4a4030"; face = "#2a2418"; }
    if (stage.id === "mansion" && p.solid) { top = "#2c5a36"; face = "#1c3a24"; }
    ctx.fillStyle = face;
    ctx.fillRect(px, py, p.w, p.h);
    ctx.fillStyle = top;
    ctx.fillRect(px, py, p.w, p.solid ? 8 : 6);
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
    ctx.strokeRect(px + 0.5, py + 0.5, p.w - 1, (p.solid ? p.h : p.h) - 1);
    // ledge nubs on solid
    if (p.solid) {
      ctx.globalAlpha = 0.9; ctx.fillStyle = edge;
      ctx.fillRect(px - 3, py, 4, 18); ctx.fillRect(px + p.w - 1, py, 4, 18);
    }
    ctx.restore();
  }

  function drawEntities() {
    for (const e of state.entities) {
      ctx.save();
      if (e.type === "projectile") {
        ctx.fillStyle = e.color;
        ctx.shadowColor = e.color; ctx.shadowBlur = 10;
        if (e.kind === "thumb") { ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("👍", e.x, e.y); }
        else if (e.kind === "burger") { ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🍔", e.x, e.y); }
        else if (e.kind === "cash") { ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("💵", e.x, e.y); }
        else { ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); }
      } else if (e.type === "fallobject") {
        ctx.font = "34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🧰", e.x, e.y);
      } else if (e.type === "trap") {
        ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.globalAlpha = e.armed > 0 ? 0.5 : 1; ctx.fillText("🪤", e.x, e.y - 8);
      } else if (e.type === "dog") {
        ctx.font = "28px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.save(); ctx.scale(e.dir, 1); ctx.fillText("🐕", e.x * e.dir, e.y - 14); ctx.restore();
      }
      ctx.restore();
    }
  }

  function drawFighter(f) {
    const r = fighterRect(f);
    const cx = f.x, top = r.y;
    ctx.save();

    // invuln blink
    if (f.invuln > 0 && Math.floor(state.time * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(cx, f.y + 2, f.w * 0.5, 6, 0, 0, TAU); ctx.fill();

    // body
    const bob = Math.sin(f.animTime * (f.state === "run" ? 18 : 6)) * (f.onGround ? 2 : 0);
    ctx.translate(cx, top + f.h / 2 + bob);
    ctx.scale(f.facing, 1);

    // legs
    ctx.strokeStyle = f.accent; ctx.lineWidth = 6; ctx.lineCap = "round";
    const legSwing = f.onGround ? Math.sin(f.animTime * 16) * 6 : 5;
    ctx.beginPath(); ctx.moveTo(-6, 12); ctx.lineTo(-10 - legSwing * 0.4, f.h / 2 - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(10 + legSwing * 0.4, f.h / 2 - 2); ctx.stroke();

    // torso
    ctx.fillStyle = f.color;
    roundRect(ctx, -f.w / 2 + 4, -f.h / 2 + 14, f.w - 8, f.h - 22, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2; ctx.stroke();

    // arm (attack pose)
    ctx.strokeStyle = f.color; ctx.lineWidth = 7; ctx.lineCap = "round";
    let armX = 12, armY = -2;
    if (f.attack && f.attackKind !== "grab" && f.attackKind !== "counter") { armX = 26; armY = -10; }
    ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(armX, armY); ctx.stroke();

    // head
    ctx.scale(f.facing, 1); // unflip for glyph
    ctx.font = "30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(f.glyph, f.facing * 2, -f.h / 2 + 2);

    ctx.restore();

    // attack arc
    if (f.attack && activeHitboxes(f).length) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = f.attackKind && f.attackKind.includes("smash") ? C.red : C.yellow;
      for (const b of activeHitboxes(f)) {
        ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // shield bubble
    if (f.shielding) {
      ctx.save();
      ctx.globalAlpha = 0.3 + f.shieldHealth * 0.3;
      ctx.fillStyle = f.shieldHealth < 0.3 ? C.red : C.cyan;
      ctx.beginPath(); ctx.arc(cx, top + f.h / 2, (f.w * 0.7) * (0.5 + f.shieldHealth * 0.6), 0, TAU); ctx.fill();
      ctx.restore();
    }
    // counter glow
    if (f.counterTimer > 0) {
      ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = C.yellow; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, top + f.h / 2, f.w * 0.8, 0, TAU); ctx.stroke(); ctx.restore();
    }
    if (f.reflectTimer > 0) {
      ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = C.cyan;
      ctx.fillRect(cx + f.facing * 10, top - 4, f.facing * 8, f.h + 4); ctx.restore();
    }
    // ledge hands
    if (f.state === "ledge" && f.ledge) {
      ctx.save(); ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(f.ledge.x, f.ledge.y + 4, 5, 0, TAU); ctx.fill(); ctx.restore();
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  function drawFloaters() {
    for (const fl of state.floaters) {
      ctx.save();
      ctx.globalAlpha = clamp(fl.life / 0.8, 0, 1);
      ctx.fillStyle = fl.color; ctx.font = "bold 16px 'Bungee', sans-serif"; ctx.textAlign = "center";
      ctx.fillText(fl.text, fl.x, fl.y);
      ctx.restore();
    }
  }

  // ---- on-canvas damage HUD (the iconic part) ----
  function drawHud() {
    const fighters = state.fighters;
    const n = fighters.length;
    const panelW = 150, gap = 16;
    const totalW = n * panelW + (n - 1) * gap;
    let x0 = (W - totalW) / 2;
    const y0 = H - 78;
    for (let i = 0; i < n; i++) {
      const f = fighters[i];
      const x = x0 + i * (panelW + gap);
      ctx.save();
      ctx.globalAlpha = f.stocks > 0 ? 1 : 0.35;
      // panel
      ctx.fillStyle = "rgba(12,12,22,0.82)";
      roundRect(ctx, x, y0, panelW, 66, 10); ctx.fill();
      ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.stroke();
      // glyph + name
      ctx.font = "22px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(f.glyph, x + 10, y0 + 18);
      ctx.fillStyle = f.color; ctx.font = "bold 11px 'Bungee', sans-serif";
      ctx.fillText(f.def.short + (f.isCpu ? "" : " (YOU)"), x + 38, y0 + 16);
      // damage %
      const pct = Math.round(f.damage);
      const dcol = pct < 60 ? C.ink : pct < 110 ? C.yellow : pct < 160 ? C.orange : C.red;
      ctx.fillStyle = dcol; ctx.font = "900 28px 'Bungee', sans-serif"; ctx.textAlign = "center";
      ctx.fillText(pct + "%", x + panelW / 2, y0 + 44);
      // stock icons
      ctx.font = "13px sans-serif"; ctx.textAlign = "left";
      let sx = x + 10;
      for (let s = 0; s < Math.min(f.stocks, 6); s++) { ctx.fillText(f.glyph, sx, y0 + 56); sx += 16; }
      ctx.restore();
    }
    // pause hint
    if (state.paused) {
      ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.ink; ctx.font = "900 40px 'Bungee', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2); ctx.font = "16px sans-serif";
      ctx.fillText("Press P to resume", W / 2, H / 2 + 36); ctx.restore();
    }
  }

  // ============================================================
  //  HUD (page)
  // ============================================================
  function updateHud() {
    if (hudKos) hudKos.textContent = state.p1Kos;
  }
  function refreshMeta() {
    if (hudStage) hudStage.textContent = getStage().short;
    const rivalCount = state.screen === "fight" ? state.fighters.length - 1 : settings.rivals;
    if (hudMode) hudMode.textContent = rivalCount + " CPU";
    if (hudKos) hudKos.textContent = state.p1Kos;
    if (hudHigh) hudHigh.textContent = state.best;
  }

  // ============================================================
  //  GAME FLOW  (menu / start / results)
  // ============================================================
  function showMenu() {
    clearHumanInput();
    state.screen = "menu";
    state.paused = false;
    overlay.classList.add("overlay--show");
    overlayTitle.innerHTML = "🥊 SUPER SLOP BROTHERS";
    overlaySub.innerHTML = "Knock rivals off the stage. The higher their <b>%</b>, the farther they fly. Last slop standing wins.";
    renderSelect();
  }

  function renderSelect() {
    state.best = api.getHighScore(GAME_ID) || 0;
    const charCards = FIGHTERS.map((f) => `
      <button class="ssb-pick ssb-pick--char${settings.p1 === f.id ? " is-sel" : ""}" data-char="${f.id}" type="button" title="${f.blurb}">
        <span class="ssb-pick__glyph" style="--c:${f.color}">${f.glyph}</span>
        <span class="ssb-pick__name">${f.name}</span>
        <span class="ssb-pick__role">${f.blurb}</span>
      </button>`).join("");
    const stageCards = STAGES.map((s) => `
      <button class="ssb-pick ssb-pick--stage${settings.stage === s.id ? " is-sel" : ""}" data-stage="${s.id}" type="button">
        <span class="ssb-pick__name">${s.name}</span>
        <span class="ssb-pick__role">⚠ ${s.hazardName}</span>
      </button>`).join("");
    const rivalBtns = [1, 2, 3].map((n) => `<button class="ssb-chip${settings.rivals === n ? " is-sel" : ""}" data-rivals="${n}" type="button">${n} CPU</button>`).join("");
    const stockBtns = [2, 3, 5].map((n) => `<button class="ssb-chip${settings.stocks === n ? " is-sel" : ""}" data-stocks="${n}" type="button">${n} stock</button>`).join("");
    const diffBtns = ["chill", "normal", "sweat"].map((d) => `<button class="ssb-chip${settings.difficulty === d ? " is-sel" : ""}" data-diff="${d}" type="button">${AI_LEVELS[d].label}</button>`).join("");

    overlayBody.innerHTML = `
      <div class="ssb-select">
        <div class="ssb-select__main">
          <div class="ssb-select__group">
            <h3 class="ssb-select__title">Your fighter</h3>
            <div class="ssb-grid ssb-grid--char">${charCards}</div>
          </div>
          <div class="ssb-select__group">
            <h3 class="ssb-select__title">Stage</h3>
            <div class="ssb-grid ssb-grid--stage">${stageCards}</div>
          </div>
          <div class="ssb-select__group">
            <div class="ssb-row">
              <div><span class="ssb-select__title">Rivals</span><div class="ssb-chips">${rivalBtns}</div></div>
              <div><span class="ssb-select__title">Stocks</span><div class="ssb-chips">${stockBtns}</div></div>
              <div><span class="ssb-select__title">CPU skill</span><div class="ssb-chips">${diffBtns}</div></div>
            </div>
          </div>
        </div>
        <div class="ssb-select__footer">
          <button class="btn btn--primary ssb-start" id="ssb-start" type="button">FIGHT! ⚔️</button>
          <p class="ssb-controls-hint">
            <b>Move</b> ←→ / A D &nbsp;·&nbsp; <b>Jump</b> ↑ / W / Space (double-jump) &nbsp;·&nbsp; <b>Drop/Fast-fall</b> ↓ / S<br>
            <b>Attack</b> J &nbsp;·&nbsp; <b>Special</b> K &nbsp;·&nbsp; <b>Shield</b> L (hold) &nbsp;·&nbsp; <b>Grab</b> I &nbsp;·&nbsp; <b>Pause</b> P<br>
            <span class="ssb-controls-hint__tip">Flick a direction + Attack = a launching <b>smash</b>. Shield + a direction = roll/dodge.</span>
          </p>
        </div>
      </div>`;

    overlayBody.querySelectorAll("[data-char]").forEach((b) => b.addEventListener("click", () => { settings.p1 = b.dataset.char; Sound.play("select"); renderSelect(); }));
    overlayBody.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => { settings.stage = b.dataset.stage; Sound.play("select"); renderSelect(); }));
    overlayBody.querySelectorAll("[data-rivals]").forEach((b) => b.addEventListener("click", () => { settings.rivals = +b.dataset.rivals; Sound.play("select"); renderSelect(); }));
    overlayBody.querySelectorAll("[data-stocks]").forEach((b) => b.addEventListener("click", () => { settings.stocks = +b.dataset.stocks; Sound.play("select"); renderSelect(); }));
    overlayBody.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => { settings.difficulty = b.dataset.diff; Sound.play("select"); renderSelect(); }));
    const startBtn = document.getElementById("ssb-start");
    if (startBtn) startBtn.addEventListener("click", startMatch);
    refreshMeta();
  }

  function startMatch() {
    clearHumanInput();
    Sound.resume();
    Sound.play("start");
    state.screen = "fight";
    state.paused = false;
    state.entities = [];
    state.particles = [];
    state.floaters = [];
    state.p1Kos = 0;
    state.time = 0;
    overlay.classList.remove("overlay--show");

    // reset moving platforms
    getStage().platforms.forEach((p) => { delete p.curX; delete p.curY; delete p.lastDX; });

    // build roster: human + N distinct CPU rivals
    const used = new Set([settings.p1]);
    const pool = FIGHTERS.map((f) => f.id).filter((id) => id !== settings.p1);
    // shuffle
    for (let i = pool.length - 1; i > 0; i--) { const j = randInt(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const ids = [settings.p1];
    for (let i = 0; i < settings.rivals; i++) ids.push(pool[i % pool.length]);

    state.fighters = ids.map((id, i) => makeFighter(id, i, i !== 0));
    state.hazard = getStage().hazard ? getStage().hazard() : null;
    resetCamera();
    refreshMeta();
    canvas.focus();
  }

  function endMatch(winner) {
    state.screen = "results";
    const human = state.fighters.find((f) => !f.isCpu);
    const won = winner && !winner.isCpu;
    const bonus = won ? 200 : 0;
    const score = state.p1Kos * 100 + bonus + (human ? human.kos * 25 : 0);
    const prevBest = api.getHighScore(GAME_ID) || 0;
    api.recordScore(GAME_ID, score);
    const isBest = score > prevBest;
    state.best = Math.max(prevBest, score);

    overlay.classList.add("overlay--show");
    overlayTitle.innerHTML = won ? "🏆 GAME!" : "💀 KO'd!";
    overlaySub.innerHTML = won
      ? `<b style="color:${winner.color}">${winner.name}</b> is the last slop standing!`
      : (winner ? `<b style="color:${winner.color}">${winner.name}</b> wins. You got bodied.` : "Everyone fell. Draw!");

    const rows = state.fighters.slice().sort((a, b) => b.stocks - a.stocks || b.kos - a.kos).map((f) => `
      <div class="ssb-result-row${f === winner ? " is-win" : ""}">
        <span class="ssb-result-row__who"><span style="font-size:20px">${f.glyph}</span> ${f.name}${f.isCpu ? "" : " (you)"}</span>
        <span class="ssb-result-row__stat">${f.kos} KO${f.kos === 1 ? "" : "s"}</span>
        <span class="ssb-result-row__stat">${Math.max(0, f.stocks)} left</span>
      </div>`).join("");

    overlayBody.innerHTML = `
      <div class="ssb-results">
        <div class="ssb-result-table">${rows}</div>
        <div class="ssb-score">Score <b>${score.toLocaleString()}</b>${isBest ? ' <span class="ssb-best">NEW BEST!</span>' : ` · Best ${state.best.toLocaleString()}`}</div>
        <div class="ssb-result-actions">
          <button class="btn btn--primary" id="ssb-rematch" type="button">Rematch ⚔️</button>
          <button class="btn btn--ghost" id="ssb-tomenu" type="button">Change setup</button>
        </div>
      </div>`;
    document.getElementById("ssb-rematch").addEventListener("click", startMatch);
    document.getElementById("ssb-tomenu").addEventListener("click", showMenu);
    if (isBest && score > 0) setTimeout(() => api.toast("🏆 New high score!", "good"), 250);
    refreshMeta();
  }

  function togglePause() {
    if (state.screen !== "fight") return;
    state.paused = !state.paused;
    if (btnPause) btnPause.textContent = state.paused ? "Resume" : "Pause";
  }

  // ============================================================
  //  BUTTONS / TOUCH
  // ============================================================
  if (btnMenu) btnMenu.addEventListener("click", showMenu);
  if (btnPause) btnPause.addEventListener("click", togglePause);
  if (btnSound) btnSound.addEventListener("click", () => {
    state.sound = !state.sound;
    btnSound.textContent = state.sound ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", String(state.sound));
  });

  // touch controls
  function bindTouch(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const set = (v) => (e) => { e.preventDefault(); touch[key] = v; if (v) Sound.resume(); };
    el.addEventListener("touchstart", set(true), { passive: false });
    el.addEventListener("touchend", set(false), { passive: false });
    el.addEventListener("touchcancel", set(false), { passive: false });
    el.addEventListener("mousedown", set(true));
    window.addEventListener("mouseup", () => (touch[key] = false));
  }
  ["left", "right", "up", "down", "jump", "attack", "special", "shield", "grab"].forEach((k) => bindTouch("ssb-touch-" + k, k));

  // fullscreen / max-screen toggle (best-effort native + .is-maxed fallback)
  (function setupFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const target = canvas.closest(".canvas-wrap");
    if (!fsBtn || !target) return;
    const isMaxed = () => target.classList.contains("is-maxed");
    const nativeEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    function setMaxed(on) {
      target.classList.toggle("is-maxed", on);
      fsBtn.textContent = on ? "✕" : "⛶";
    }
    fsBtn.addEventListener("click", () => {
      const on = !isMaxed();
      setMaxed(on);
      try {
        if (on && target.requestFullscreen) target.requestFullscreen().catch(() => {});
        else if (on && target.webkitRequestFullscreen) target.webkitRequestFullscreen();
        else if (!on && document.exitFullscreen && nativeEl()) document.exitFullscreen().catch(() => {});
      } catch (e) {}
      canvas.focus();
    });
    const onChange = () => { if (!nativeEl() && isMaxed()) setMaxed(false); };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
  })();

  // ============================================================
  //  LOOP
  // ============================================================
  function frame(ts) {
    const now = ts / 1000;
    let dt = state.lastTime ? now - state.lastTime : 0;
    state.lastTime = now;
    if (dt > 0.05) dt = 0.05; // clamp
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ============================================================
  //  DEBUG HOOK
  // ============================================================
  window.__SLOP = {
    state, settings, FIGHTERS, STAGES,
    start: startMatch, menu: showMenu, results: endMatch,
    setStage(id) { settings.stage = id; },
    setChar(id) { settings.p1 = id; },
    setRivals(n) { settings.rivals = n; },
    p1() { return state.fighters.find((f) => !f.isCpu); },
    cpu(i = 1) { return state.fighters[i]; },
    damage(slot, v) { const f = state.fighters[slot]; if (f) f.damage = v; },
    setAll(v) { state.fighters.forEach((f) => (f.damage = v)); },
    launch(slot, vx, vy) { const f = state.fighters[slot]; if (f) { f.vx = vx; f.vy = vy; f.hitstun = 0.6; f.onGround = false; f.state = "hit"; } },
    ko(slot) { const f = state.fighters[slot]; if (f) koFighter(f); },
    god() { state.fighters.forEach((f) => { if (!f.isCpu) f.invuln = 9999; }); },
    hazardNow() { const h = state.hazard; if (h) { h.timer = 0; if (h.phase) h.phase = "idle"; } },
    // deterministic fixed-step simulator for headless testing (bypasses rAF throttling)
    step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) update(dt); return state.fighters.map((f) => ({ id: f.id, dmg: Math.round(f.damage), stocks: f.stocks, x: Math.round(f.x), y: Math.round(f.y), state: f.state })); },
  };

  // ============================================================
  //  BOOT
  // ============================================================
  state.best = api.getHighScore(GAME_ID) || 0;
  showMenu();
  refreshMeta();
  requestAnimationFrame(frame);
})();
