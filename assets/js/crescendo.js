/* ============================================================
   CRESCENDO — a requiem in four movements
   Beat-synced vertical-scrolling shmup (Raiden with rhythm).
   The soundtrack is generated live in WebAudio; enemies attack
   on the beat; tapping ON the beat crescendos your weapon up
   the power ladder — going quiet (or getting hit) decays it.
   ============================================================ */
(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const canvasWrap = canvas.closest(".canvas-wrap");
  const W = canvas.width;   // 500
  const H = canvas.height;  // 640

  const STEP = 1 / 60;
  const GAME_ID = "crescendo";

  // Brand palette
  const PINK = "#ff2e88";
  const CYAN = "#2ee0ff";
  const YELLOW = "#ffd43b";
  const GREEN = "#6bff7d";
  const RED = "#ff5c5c";
  const PURPLE = "#b46bff";
  const ORANGE = "#ff9f43";
  const WHITE = "#f4f7ff";

  const TAU = Math.PI * 2;
  const UP = -Math.PI / 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const hash01 = (n) => { let x = Math.imul(n | 0, 2654435761); x ^= x >>> 13; x = Math.imul(x, 1274126177); return ((x >>> 0) % 100000) / 100000; };

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Keep the simulation in its original 500x640 coordinate space while the
  // backing buffer follows the display density. Fullscreen gets a 2x minimum
  // supersample, capped at 3x to keep dense bullet patterns performant.
  let renderScale = 1;
  let canvasResizeFrame = 0;
  function syncCanvasResolution() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nativeFullscreen = document.fullscreenElement === canvasWrap || document.webkitFullscreenElement === canvasWrap;
    const maxed = !!canvasWrap && (canvasWrap.classList.contains("is-maxed") || nativeFullscreen);
    const cssScale = Math.max(rect.width / W, rect.height / H);
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    const desiredScale = Math.max(cssScale * pixelRatio, maxed ? 2 : 1);
    const nextScale = Math.ceil(clamp(desiredScale, 1, 3) * 4) / 4;
    const pixelWidth = Math.round(W * nextScale);
    const pixelHeight = Math.round(H * nextScale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    renderScale = nextScale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    canvas.dataset.renderScale = renderScale.toFixed(2);
    canvas.dataset.renderResolution = `${pixelWidth}x${pixelHeight}`;
    document.querySelectorAll("[data-cres-side-render]").forEach((label) => {
      label.textContent = `${renderScale.toFixed(2)}× SUPERSAMPLE // ${pixelWidth}×${pixelHeight}`;
    });
  }

  function scheduleCanvasResolutionSync() {
    if (canvasResizeFrame) cancelAnimationFrame(canvasResizeFrame);
    canvasResizeFrame = requestAnimationFrame(() => {
      canvasResizeFrame = 0;
      syncCanvasResolution();
    });
  }

  function applyRenderTransform() {
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  }

  /* ============================================================
     MOVEMENTS — the four acts of the requiem
     ============================================================ */
  const MOVEMENTS = [
    {
      roman: "I", name: "MOVEMENT I — ADAGIO", sub: "The Silent District",
      story: "The Conductor raised his baton, and the city forgot how to sing.",
      bpm: 112, trans: 0, dur: 55, intensity: 2,
      patterns: [["swoopLine", 5], ["vForm", 3], ["dronePair", 3]],
      boss: "timpanist",
    },
    {
      roman: "II", name: "MOVEMENT II — ANDANTE", sub: "The Frozen Concert Hall",
      story: "The orchestra still sits in the dark. Hollow. Waiting for permission to breathe.",
      bpm: 122, trans: 3, dur: 65, intensity: 3,
      patterns: [["swoopLine", 4], ["vForm", 3], ["dronePair", 3], ["turretPair", 3], ["splitter", 2]],
      boss: "firstchair",
    },
    {
      roman: "III", name: "MOVEMENT III — ALLEGRO", sub: "The Metronome Works",
      story: "Beneath the city, a great machine keeps perfect, merciless time.",
      bpm: 132, trans: 5, dur: 75, intensity: 4,
      patterns: [["swoopLine", 3], ["vForm", 2], ["dronePair", 3], ["turretPair", 3], ["splitter", 2], ["tank", 3], ["diverPair", 3]],
      boss: "metronome",
    },
    {
      roman: "IV", name: "MOVEMENT IV — PRESTO", sub: "The Conductor's Podium",
      story: "He is waiting. He has always been waiting. Finish the requiem.",
      bpm: 142, trans: 7, dur: 40, intensity: 5,
      patterns: [["swoopLine", 3], ["vForm", 3], ["dronePair", 3], ["turretPair", 3], ["splitter", 2], ["tank", 3], ["diverPair", 4]],
      boss: "conductor",
    },
  ];

  /* ============================================================
     WEAPON LADDER — groove level 0..8 (Raiden-style power-ups,
     earned and kept by tapping on the beat)
     ============================================================ */
  const WEAPONS = [
    { name: "TACET",            cd: 0.30, angs: [0],                                    xoffs: [0],                      dmg: 5, homing: 0, pierce: false },
    { name: "SOLO",             cd: 0.22, angs: [0],                                    xoffs: [0],                      dmg: 6, homing: 0, pierce: false },
    { name: "DUET",             cd: 0.22, angs: [0, 0],                                 xoffs: [-8, 8],                  dmg: 6, homing: 0, pierce: false },
    { name: "TRIO",             cd: 0.21, angs: [0, -0.13, 0.13],                       xoffs: [0, -6, 6],               dmg: 6, homing: 0, pierce: false },
    { name: "QUARTET",          cd: 0.20, angs: [0, 0, -0.22, 0.22],                    xoffs: [-9, 9, -12, 12],         dmg: 6, homing: 0, pierce: false },
    { name: "QUINTET",          cd: 0.18, angs: [0, -0.14, 0.14, -0.3, 0.3],            xoffs: [0, -7, 7, -12, 12],      dmg: 6, homing: 0, pierce: false },
    { name: "SEXTET",           cd: 0.18, angs: [0, -0.14, 0.14, -0.3, 0.3],            xoffs: [0, -7, 7, -12, 12],      dmg: 6, homing: 1, pierce: false },
    { name: "SEPTET",           cd: 0.16, angs: [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42], xoffs: [0, -7, 7, -11, 11, -14, 14], dmg: 6, homing: 1, pierce: false },
    { name: "TUTTI FORTISSIMO", cd: 0.14, angs: [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42], xoffs: [0, -7, 7, -11, 11, -14, 14], dmg: 6, homing: 2, pierce: true },
  ];

  /* ============================================================
     REQUIEM HANGAR — four instruments, four ways to play
     ============================================================ */
  const SHIPS = {
    aria: {
      id: "aria", name: "ARIA", epithet: "THE LAST NOTE", role: "BALANCED INTERCEPTOR",
      color: CYAN, accent: PINK, tempo: 1, transpose: 0, music: "anthem",
      weapon: "HARMONIC ARRAY", mix: "Neon synthwave · 4/4 drive",
      description: "A wide, escalating spread backed by homing codas and a piercing fortissimo center voice.",
      unlock: "Commissioned from the start.", hp: 4, speed: 265, engineX: [-5.5, 5.5],
      levels: WEAPONS.map((w) => w.name),
    },
    vesper: {
      id: "vesper", name: "VESPER", epithet: "THE NIGHT CHOIR", role: "ARMORED LANCER",
      color: PURPLE, accent: CYAN, tempo: 0.875, transpose: -5, music: "nocturne",
      weapon: "PRISM LANCE", mix: "Minor-key nocturne · half-time pulse",
      description: "Slower, surgical fire. Every violet lance pierces; higher Groove adds tightly focused side rays.",
      unlock: "Earn First Applause — clear Movement I.", hp: 5, speed: 238, engineX: [-8, 8],
      levels: ["DARK", "GLINT", "NEEDLE", "PRISM I", "PRISM II", "LANCE", "TWIN LANCE", "NIGHT RAY", "UMBRA MAXIMA"],
    },
    counterpoint: {
      id: "counterpoint", name: "COUNTERPOINT", epithet: "THE TWIN VOICE", role: "AGILE CANON FIGHTER",
      color: PINK, accent: CYAN, tempo: 1.16, transpose: 2, music: "fugue",
      weapon: "CANON DRONES", mix: "Breakbeat fugue · rapid canon",
      description: "Twin oscillating streams interlock across the field; upper levels answer with seeking echo-notes.",
      unlock: "Earn Great Liberator — defeat 250 enemies across all runs.", hp: 3, speed: 305, engineX: [-10, 10],
      levels: ["REST", "VOICE I", "VOICE II", "IMITATION", "CANON", "DOUBLE CANON", "FUGUE", "STRETTO", "GRAND FUGUE"],
    },
    virtuoso: {
      id: "virtuoso", name: "VIRTUOSO", epithet: "THE GOLDEN BATON", role: "DOWNBEAT DUELIST",
      color: YELLOW, accent: WHITE, tempo: 1.075, transpose: 7, music: "brillante",
      weapon: "BATON RAIL", mix: "Brass electro · syncopated lead",
      description: "Fast staccato needles support a devastating piercing rail that accents every musical beat.",
      unlock: "Earn Clockwork Soul — land 12 consecutive PERFECT taps.", hp: 4, speed: 280, engineX: [0],
      levels: ["REST", "ACCENT", "STACCATO", "BATON I", "BATON II", "CADENCE", "RAIL", "BRILLIANTE", "APOTHEOSIS"],
    },
  };
  const SHIP_ORDER = ["aria", "vesper", "counterpoint", "virtuoso"];

  const ACHIEVEMENTS = [
    { id: "movement-1", title: "FIRST APPLAUSE", desc: "Clear Movement I.", reward: "UNLOCKS VESPER", unlockShip: "vesper", kind: "movement", goal: 1 },
    { id: "movement-2", title: "THE ORCHESTRA BREATHES", desc: "Clear Movement II.", reward: "MOVEMENT II SEALED", kind: "movement", goal: 2 },
    { id: "movement-3", title: "BREAK THE METRONOME", desc: "Clear Movement III.", reward: "MOVEMENT III SEALED", kind: "movement", goal: 3 },
    { id: "game-clear", title: "WORLD IN CRESCENDO", desc: "Complete all four movements.", reward: "FINALE SEALED", kind: "wins", goal: 1 },
    { id: "kills-100", title: "LIBERATOR", desc: "Defeat 100 enemies across all runs.", reward: "ACCOUNT MILESTONE", kind: "kills", goal: 100 },
    { id: "kills-250", title: "GREAT LIBERATOR", desc: "Defeat 250 enemies across all runs.", reward: "UNLOCKS COUNTERPOINT", unlockShip: "counterpoint", kind: "kills", goal: 250 },
    { id: "perfect-8", title: "UNBROKEN MEASURE", desc: "Land 8 consecutive PERFECT taps.", reward: "RHYTHM MILESTONE", kind: "perfect", goal: 8 },
    { id: "perfect-12", title: "CLOCKWORK SOUL", desc: "Land 12 consecutive PERFECT taps.", reward: "UNLOCKS VIRTUOSO", unlockShip: "virtuoso", kind: "perfect", goal: 12 },
    { id: "clear-aria", title: "ARIA ASCENDANT", desc: "Clear the game with Aria.", reward: "ARIA MASTERED", kind: "ship-clear", ship: "aria", goal: 1 },
    { id: "clear-vesper", title: "AFTER DARK", desc: "Clear the game with Vesper.", reward: "VESPER MASTERED", kind: "ship-clear", ship: "vesper", goal: 1 },
    { id: "clear-counterpoint", title: "TWO AS ONE", desc: "Clear the game with Counterpoint.", reward: "COUNTERPOINT MASTERED", kind: "ship-clear", ship: "counterpoint", goal: 1 },
    { id: "clear-virtuoso", title: "TAKE A BOW", desc: "Clear the game with Virtuoso.", reward: "VIRTUOSO MASTERED", kind: "ship-clear", ship: "virtuoso", goal: 1 },
  ];
  const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  const META_KEY = "rb_crescendo_meta_v1";

  function freshMeta() {
    return {
      version: 1,
      selectedShip: "aria",
      unlocked: { aria: true },
      achievements: {},
      lifetimeKills: 0,
      bestPerfectRun: 0,
      clearedMovements: 0,
      clears: {},
      runs: 0,
      wins: 0,
    };
  }

  function loadMeta() {
    const base = freshMeta();
    try {
      const parsed = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        Object.assign(base, parsed);
        base.unlocked = Object.assign({ aria: true }, parsed.unlocked || {});
        base.achievements = Object.assign({}, parsed.achievements || {});
        base.clears = Object.assign({}, parsed.clears || {});
      }
    } catch (err) {}
    base.lifetimeKills = Math.max(0, Number(base.lifetimeKills) || 0);
    base.bestPerfectRun = Math.max(0, Number(base.bestPerfectRun) || 0);
    base.clearedMovements = clamp(Number(base.clearedMovements) || 0, 0, 4);
    base.runs = Math.max(0, Number(base.runs) || 0);
    base.wins = Math.max(0, Number(base.wins) || 0);
    for (const a of ACHIEVEMENTS) {
      if (base.achievements[a.id] && a.unlockShip) base.unlocked[a.unlockShip] = true;
    }
    if (!SHIPS[base.selectedShip] || !base.unlocked[base.selectedShip]) base.selectedShip = "aria";
    return base;
  }

  let META = loadMeta();
  let metaUiDirty = false;

  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (err) {}
  }

  function currentShip() {
    return SHIPS[(G && G.shipId) || META.selectedShip] || SHIPS.aria;
  }

  function currentBpm() {
    const movement = G ? G.movement : 1;
    return MOVEMENTS[movement - 1].bpm * currentShip().tempo;
  }

  function weaponLevelName(level, ship) {
    const s = ship || currentShip();
    return s.levels[clamp(level | 0, 0, GROOVE_MAX)] || s.weapon;
  }

  function achievementProgress(a) {
    if (META.achievements[a.id]) return { value: a.goal || 1, goal: a.goal || 1 };
    if (a.kind === "kills") return { value: Math.min(META.lifetimeKills, a.goal), goal: a.goal };
    if (a.kind === "perfect") return { value: Math.min(META.bestPerfectRun, a.goal), goal: a.goal };
    if (a.kind === "movement") return { value: Math.min(META.clearedMovements, a.goal), goal: a.goal };
    if (a.kind === "wins") return { value: Math.min(META.wins, a.goal), goal: a.goal };
    if (a.kind === "ship-clear") return { value: Math.min(META.clears[a.ship] || 0, a.goal), goal: a.goal };
    return { value: 0, goal: a.goal || 1 };
  }

  function unlockAchievement(id, quiet) {
    const a = ACHIEVEMENT_BY_ID[id];
    if (!a || META.achievements[id]) return false;
    META.achievements[id] = Date.now();
    if (a.unlockShip) META.unlocked[a.unlockShip] = true;
    saveMeta();
    renderMetaUI();
    if (!quiet) showAchievementToast(a);
    return true;
  }

  function checkLifetimeAchievements() {
    if (META.lifetimeKills >= 100) unlockAchievement("kills-100");
    if (META.lifetimeKills >= 250) unlockAchievement("kills-250");
  }

  function checkPerfectAchievements() {
    if (META.bestPerfectRun >= 8) unlockAchievement("perfect-8");
    if (META.bestPerfectRun >= 12) unlockAchievement("perfect-12");
  }

  const GROOVE_MAX = 8;
  const GROOVE_DECAY = 3.4;   // seconds per level lost when you go quiet
  const TAP_WINDOW = 0.15;    // beat-phase window for an on-beat tap
  const PERFECT_WINDOW = 0.055;
  const CADENZA_PERFECTS = 4;
  const CADENZA_BEATS = 4;
  const STREAK_FOR_BOMB = 8;

  /* ============================================================
     AUDIO — synthesized soundtrack + SFX (no assets)
     ============================================================ */
  const Audio = (() => {
    let ac = null, master = null, musGain = null, sfxGain = null;
    let delayNode = null, delaySend = null;
    let noiseBuf = null;
    let lastShootSfx = 0;

    function ensure() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC(); } catch (e) { ac = null; return false; }
      master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
      musGain = ac.createGain(); musGain.gain.value = 0.5; musGain.connect(master);
      sfxGain = ac.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
      delayNode = ac.createDelay(1.0); delayNode.delayTime.value = 0.29;
      const fb = ac.createGain(); fb.gain.value = 0.34;
      delayNode.connect(fb); fb.connect(delayNode);
      delaySend = ac.createGain(); delaySend.gain.value = 1;
      delaySend.connect(delayNode);
      const wet = ac.createGain(); wet.gain.value = 0.28;
      delayNode.connect(wet); wet.connect(musGain);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }
    function resume() { if (ac && ac.state === "suspended") ac.resume(); }
    function ok() { return !!ac && !G.muted; }
    function now() { return ac ? ac.currentTime : 0; }
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

    function env(g, t, a, peak, dur) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    function osc(type, freq, t, dur, peak, dest, a = 0.004) {
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      const g = ac.createGain(); env(g, t, a, peak, dur);
      o.connect(g); g.connect(dest || musGain);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    }
    function noise(t, dur, peak, filterType, freq, q, dest) {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
      const g = ac.createGain(); env(g, t, 0.002, peak, dur);
      src.connect(f); f.connect(g); g.connect(dest || musGain);
      src.start(t); src.stop(t + dur + 0.05);
    }

    // --- drums ---
    function kick(t) {
      const o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(155, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      const g = ac.createGain(); env(g, t, 0.002, 0.9, 0.16);
      o.connect(g); g.connect(musGain); o.start(t); o.stop(t + 0.22);
    }
    function snare(t) {
      noise(t, 0.13, 0.34, "bandpass", 1900, 0.9);
      osc("triangle", 185, t, 0.08, 0.25, musGain);
    }
    function hat(t, open) {
      noise(t, open ? 0.16 : 0.035, open ? 0.16 : 0.13, "highpass", 7500, 0.7);
    }
    // --- tonal ---
    function bass(t, m, dur) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6;
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(180, t + dur);
      const g = ac.createGain(); env(g, t, 0.006, 0.34, dur);
      o.connect(f); f.connect(g); g.connect(musGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function arp(t, m, dur, bright) {
      const o = ac.createOscillator(); o.type = "square"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 3;
      f.frequency.value = 900 + bright * 900;
      const g = ac.createGain(); env(g, t, 0.004, 0.11, dur);
      o.connect(f); f.connect(g); g.connect(musGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function pad(t, midis, dur) {
      for (const m of midis) {
        for (const det of [-6, 6]) {
          const o = ac.createOscillator(); o.type = "sawtooth";
          o.frequency.value = midi(m); o.detune.value = det;
          const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 750;
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(f); f.connect(g); g.connect(musGain);
          o.start(t); o.stop(t + dur + 0.05);
        }
      }
    }
    function lead(t, m, dur) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600; f.Q.value = 2;
      const g = ac.createGain(); env(g, t, 0.01, 0.16, dur);
      o.connect(f); f.connect(g); g.connect(musGain); g.connect(delaySend);
      o.start(t); o.stop(t + dur + 0.1);
    }
    function bell(t, m, dur, peak = 0.1) {
      const fundamental = midi(m);
      osc("sine", fundamental, t, dur, peak, musGain, 0.003);
      osc("triangle", fundamental * 2.01, t, dur * 0.72, peak * 0.36, musGain, 0.002);
    }
    function pluck(t, m, dur, peak = 0.09) {
      const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1700; f.Q.value = 1.6;
      const g = ac.createGain(); env(g, t, 0.002, peak, dur);
      o.connect(f); f.connect(g); g.connect(musGain); g.connect(delaySend);
      o.start(t); o.stop(t + dur + 0.05);
    }

    // --- SFX (through sfxGain) ---
    const sfx = {
      shoot(shipId) {
        if (!ok()) return;
        const t = now();
        if (t - lastShootSfx < 0.05) return;
        lastShootSfx = t;
        const profile = shipId || "aria";
        const o = ac.createOscillator();
        o.type = profile === "counterpoint" ? "square" : profile === "virtuoso" ? "sawtooth" : "triangle";
        const f0 = profile === "vesper" ? 430 : profile === "counterpoint" ? 760 : profile === "virtuoso" ? 1280 : 920;
        const f1 = profile === "vesper" ? 820 : profile === "counterpoint" ? 510 : profile === "virtuoso" ? 680 : 590;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.055);
        const g = ac.createGain(); env(g, t, 0.002, profile === "vesper" ? 0.065 : 0.05, 0.06);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.095);
        if (profile === "counterpoint") osc("sine", 1080, t + 0.012, 0.05, 0.025, sfxGain, 0.002);
      },
      hit() { if (!ok()) return; noise(now(), 0.04, 0.09, "highpass", 2400, 1, sfxGain); },
      boom(big) {
        if (!ok()) return; const t = now();
        noise(t, big ? 0.5 : 0.22, big ? 0.5 : 0.3, "lowpass", big ? 900 : 1400, 0.8, sfxGain);
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(big ? 260 : 200, t);
        o.frequency.exponentialRampToValueAtTime(40, t + (big ? 0.4 : 0.2));
        const g = ac.createGain(); env(g, t, 0.004, big ? 0.5 : 0.32, big ? 0.45 : 0.24);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.6);
      },
      tapGood(level) {
        if (!ok()) return; const t = now();
        // pitch climbs with the groove level — the crescendo you can hear
        const base = 880 * Math.pow(2, Math.min(level, GROOVE_MAX) / 12);
        osc("sine", base, t, 0.22, 0.18, sfxGain, 0.004);
        osc("sine", base * 1.5, t + 0.03, 0.2, 0.1, sfxGain, 0.004);
      },
      tapBad() {
        if (!ok()) return; const t = now();
        const o = ac.createOscillator(); o.type = "square";
        o.frequency.setValueAtTime(196, t);
        o.frequency.linearRampToValueAtTime(158, t + 0.14);
        const g = ac.createGain(); env(g, t, 0.004, 0.14, 0.16);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.2);
      },
      bomb() {
        if (!ok()) return; const t = now();
        sfx.boom(true);
        noise(t, 0.9, 0.35, "lowpass", 500, 0.8, sfxGain);
        [0, 7, 12].forEach((s, i) => osc("sawtooth", midi(45 + s), t + i * 0.05, 0.8, 0.16, sfxGain, 0.02));
      },
      pickup(streak) {
        if (!ok()) return; const t = now();
        const f0 = 620 * Math.pow(2, Math.min(streak || 0, 12) / 14);
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.06);
        const g = ac.createGain(); env(g, t, 0.003, 0.09, 0.08);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.12);
      },
      hurt() {
        if (!ok()) return; const t = now();
        const o = ac.createOscillator(); o.type = "square";
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
        const g = ac.createGain(); env(g, t, 0.004, 0.3, 0.3);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.36);
        noise(t, 0.2, 0.2, "lowpass", 1200, 1, sfxGain);
      },
      fanfare() {
        if (!ok()) return; const t = now();
        [0, 4, 7, 12].forEach((s, i) => osc("triangle", midi(81 + s), t + i * 0.07, 0.22, 0.14, sfxGain, 0.005));
      },
      bossDown() {
        if (!ok()) return; const t = now();
        sfx.boom(true);
        [0, 7, 12, 19].forEach((s, i) => osc("sawtooth", midi(69 + s), t + 0.15 + i * 0.09, 0.5, 0.1, sfxGain, 0.01));
      },
    };

    /* --- sequencer ---------------------------------------------
       The sim owns the musical clock (G.songStep, in 16th notes).
       Every render frame we schedule any 16ths inside a small
       lookahead window, mapping sim-time offsets onto the audio
       clock. Deterministic gameplay stays intact when muted.  */
    const PROG = [{ r: 0, m: 1 }, { r: -4, m: 0 }, { r: 3, m: 0 }, { r: -2, m: 0 }];      // Am F C G
    const PROG_BOSS = [{ r: 0, m: 1 }, { r: 0, m: 1 }, { r: -4, m: 0 }, { r: -5, m: 0 }]; // Am Am F E
    const PROG_NIGHT = [{ r: 0, m: 1 }, { r: -2, m: 1 }, { r: -5, m: 0 }, { r: -7, m: 0 }];
    const PROG_FUGUE = [{ r: 0, m: 1 }, { r: 3, m: 0 }, { r: -2, m: 0 }, { r: 5, m: 1 }];
    const PROG_GOLD = [{ r: 0, m: 0 }, { r: -2, m: 0 }, { r: 5, m: 0 }, { r: 3, m: 0 }];
    const MELODY = {
      0: [12, 3], 4: [10, 1], 6: [8, 2], 8: [7, 3], 12: [3, 2],
      16: [5, 2], 20: [7, 1], 22: [8, 2], 24: [7, 3], 28: [3, 1], 30: [0, 2],
      32: [0, 2], 36: [3, 1], 38: [5, 2], 40: [7, 2], 44: [8, 1], 46: [10, 2],
      48: [12, 4], 54: [10, 1], 56: [8, 2], 60: [7, 4],
    };

    function playSixteenth(step, t, stepDur) {
      const I = G.intensity;
      const ship = currentShip();
      const trans = MOVEMENTS[G.movement - 1].trans + ship.transpose;
      let prog = G.bossActive ? PROG_BOSS : PROG;
      if (!G.bossActive && ship.music === "nocturne") prog = PROG_NIGHT;
      if (!G.bossActive && ship.music === "fugue") prog = PROG_FUGUE;
      if (!G.bossActive && ship.music === "brillante") prog = PROG_GOLD;
      const bar = Math.floor(step / 16);
      const s = step % 16;
      const chord = prog[bar % 4];
      const third = chord.m ? 3 : 4;

      if (ship.music === "nocturne") {
        if (I >= 1 && (s === 0 || s === 10)) kick(t);
        if (I >= 2 && s === 8) snare(t);
        if (I >= 2 && (s === 3 || s === 7 || s === 11 || s === 15)) hat(t, s === 15);
        if (I >= 4 && (s === 1 || s === 13)) hat(t, false);
        if (I >= 1 && (s === 0 || s === 6 || s === 10 || s === 14)) bass(t, 43 + trans + chord.r + (s === 14 ? 12 : 0), stepDur * 2.4);
        if (I >= 2 && s === 0) pad(t, [55 + trans + chord.r, 55 + trans + chord.r + third, 55 + trans + chord.r + 7], stepDur * 16);
        if (I >= 3 && s % 4 === 2) {
          const nightTones = [12, 7, third + 12, 10];
          bell(t, 72 + trans + chord.r + nightTones[Math.floor(s / 4)], stepDur * 3.2, 0.085);
        }
        if (I >= 5 && s === 12) lead(t, 72 + trans + chord.r + 12, stepDur * 3.5);
      } else if (ship.music === "fugue") {
        if (I >= 1 && (s === 0 || s === 3 || s === 8 || s === 11)) kick(t);
        if (I >= 2 && (s === 4 || s === 12)) snare(t);
        if (I >= 2 && s % 2 === 1) hat(t, s === 15);
        if (I >= 4 && s % 4 === 2) hat(t, false);
        if (I >= 1 && s % 2 === 0) bass(t, 44 + trans + chord.r + (s === 10 || s === 14 ? 12 : 0), stepDur * 1.3);
        if (I >= 2 && s === 0) pad(t, [57 + trans + chord.r, 57 + trans + chord.r + third, 57 + trans + chord.r + 7], stepDur * 12);
        if (I >= 3) {
          const subject = [0, 3, 7, 12, 10, 7, 3, 5];
          pluck(t, 69 + trans + chord.r + subject[step % 8], stepDur * 0.8, 0.078);
          if (I >= 4 && s % 2 === 1) pluck(t, 64 + trans + chord.r + subject[(step + 5) % 8], stepDur * 0.72, 0.052);
        }
      } else if (ship.music === "brillante") {
        if (I >= 1 && (s % 4 === 0 || s === 14)) kick(t);
        if (I >= 2 && (s === 4 || s === 12)) snare(t);
        if (I >= 2 && s % 2 === 1) hat(t, s === 15);
        if (I >= 4 && (s === 2 || s === 10)) hat(t, false);
        if (I >= 1 && s % 4 === 0) bass(t, 45 + trans + chord.r + (s === 12 ? 12 : 0), stepDur * 2.4);
        if (I >= 2 && s === 0) pad(t, [57 + trans + chord.r, 57 + trans + chord.r + third, 57 + trans + chord.r + 7], stepDur * 16);
        if (I >= 3 && [2, 6, 9, 14].includes(s)) {
          const brass = [12, 16, 19, 24];
          bell(t, 69 + trans + chord.r + brass[[2, 6, 9, 14].indexOf(s)], stepDur * 1.35, 0.075);
        }
        if (I >= 4) {
          const note = MELODY[step % 64];
          if (note) lead(t, 79 + trans + note[0], stepDur * note[1] * 0.72);
        }
      } else {
        if (I >= 1 && s % 4 === 0) kick(t);
        if (I >= 2 && (s === 4 || s === 12)) snare(t);
        if (I >= 2 && s % 2 === 1) hat(t, false);
        if (I >= 4 && s % 2 === 0 && s % 4 !== 0) hat(t, false);
        if (I >= 3 && s === 14) hat(t, true);
        if (I >= 1 && s % 2 === 0) bass(t, 45 + trans + chord.r + (s === 14 ? 12 : 0), stepDur * 1.7);
        if (I >= 2 && s === 0) pad(t, [57 + trans + chord.r, 57 + trans + chord.r + third, 57 + trans + chord.r + 7], stepDur * 16);
        if (I >= 3) {
          const tones = [0, 7, 12, third + 12];
          arp(t, 69 + trans + chord.r + tones[step % 4], stepDur * 0.92, (I - 2) / 3);
        }
        if (I >= 4 && Math.floor(step / 64) % 2 === 1) {
          const note = MELODY[step % 64];
          if (note) lead(t, 81 + trans + note[0], stepDur * note[1] * 0.95);
        }
      }
    }

    function schedule() {
      const musical = G.phase === "play" || G.phase === "interlude" || G.phase === "sectionclear";
      if (!musical || !ac || G.muted) { G.schedStep = Math.ceil(G.songStep); return; }
      if (ac.state === "suspended") { ac.resume(); return; }
      const stepDur = (60 / currentBpm()) / 4;
      const horizon = G.songStep + 0.16 / stepDur;
      let guard = 0;
      while (G.schedStep < horizon && guard++ < 32) {
        const t = ac.currentTime + Math.max(0.001, (G.schedStep - G.songStep) * stepDur);
        playSixteenth(G.schedStep, t, stepDur);
        G.schedStep++;
      }
    }

    function setMuted(m) {
      if (master) master.gain.value = m ? 0 : 0.8;
    }

    return { ensure, resume, schedule, sfx, setMuted };
  })();

  /* ============================================================
     ENEMY TYPES (vertical-scroller roster)
     ============================================================ */
  const ETYPES = {
    swooper:  { hp: 7,   r: 12, col: YELLOW, score: 10 },
    drone:    { hp: 16,  r: 15, col: PINK,   score: 16 },
    turret:   { hp: 22,  r: 14, col: PURPLE, score: 20 },
    tank:     { hp: 46,  r: 19, col: ORANGE, score: 34 },
    diver:    { hp: 10,  r: 13, col: RED,    score: 18 },
    splitter: { hp: 20,  r: 16, col: GREEN,  score: 16 },
    mini:     { hp: 5,   r: 8,  col: GREEN,  score: 6 },
  };
  const BOSSES = {
    timpanist:  { name: "THE TIMPANIST",   hp: 700,  r: 34, col: PINK,   score: 400 },
    firstchair: { name: "THE FIRST CHAIR", hp: 1100, r: 30, col: PURPLE, score: 650 },
    metronome:  { name: "THE METRONOME",   hp: 1600, r: 36, col: ORANGE, score: 1000 },
    conductor:  { name: "THE CONDUCTOR",   hp: 3200, r: 40, col: WHITE,  score: 2500 },
  };

  /* ============================================================
     GAME STATE
     ============================================================ */
  let G = null;

  function newPlayer(ship) {
    const craft = ship || SHIPS.aria;
    return {
      x: W / 2, y: H - 90,
      hp: craft.hp, maxHp: craft.hp,
      r: 7,               // small shmup hitbox; the ship is drawn larger
      speed: craft.speed,
      fireCd: 0,
      groove: 1, decayT: GROOVE_DECAY,
      streak: 0, bombs: 1, maxBombs: 2,
      perfectChain: 0, cadenzaT: 0, grazeGlow: 0,
      tapCd: 0,
      invulnT: 0,
      volleyCount: 0, lastRailBeat: -1,
      trail: [],
    };
  }

  function captureSectionStart(state) {
    return {
      score: state.score,
      taps: state.taps,
      tapsHit: state.tapsHit,
      perfectTaps: state.perfectTaps,
      grazes: state.grazes,
      hitsTaken: state.hitsTaken,
      kills: state.kills,
      combo: state.combo,
      bestCombo: state.bestCombo,
      bestStreak: state.bestStreak,
      perfectRun: state.perfectRun,
      bestPerfectRun: state.bestPerfectRun,
      spawnCd: state.spawnCd,
      player: { ...state.p, trail: [] },
    };
  }

  function newGame() {
    const shipId = META.unlocked[META.selectedShip] ? META.selectedShip : "aria";
    const ship = SHIPS[shipId] || SHIPS.aria;
    const game = {
      phase: "title", // title | interlude | play | sectionclear | paused | gameover | win
      time: 0, runTime: 0,
      shipId,
      movement: 1, intensity: 2,
      waveT: 0, spawnCd: 1.6, queue: [],
      songStep: 0, schedStep: 0, beatIndex: -1, beatPhase: 0, pulse: 0,
      scrollY: 0,
      bossActive: false, bossCue: 0,
      p: newPlayer(ship),
      enemies: [], bullets: [], shots: [], gems: [], particles: [],
      shocks: [], texts: [], beams: [],
      eid: 1,
      score: 0, best: 0, combo: 0, bestCombo: 0, taps: 0, tapsHit: 0,
      perfectTaps: 0, bestStreak: 0, kills: 0, grazes: 0,
      perfectRun: 0, bestPerfectRun: 0,
      hitsTaken: 0,
      sectionStart: null,
      sectionResult: null, sectionT: 0,
      shake: 0, flashW: 0, flashR: 0,
      ilT: 0,
      usedEncore: false, muted: false, pausedFrom: null,
      won: false,
    };
    game.sectionStart = captureSectionStart(game);
    return game;
  }

  /* ============================================================
     THE RHYTHM MECHANIC — tap on the beat to crescendo
     ============================================================ */
  function beatDur() { return 60 / currentBpm(); }

  function tapBeat() {
    if (G.phase !== "play") return;
    const p = G.p;
    if (p.tapCd > 0) return;
    p.tapCd = 0.18;
    G.taps++;
    const ph = G.beatPhase;
    const error = Math.min(ph, 1 - ph);
    const onBeat = error < TAP_WINDOW;
    const perfect = error < PERFECT_WINDOW;
    const timingMs = Math.round(error * beatDur() * 1000);
    if (onBeat) {
      G.tapsHit++;
      p.streak++;
      G.bestStreak = Math.max(G.bestStreak, p.streak);
      p.decayT = GROOVE_DECAY;
      const before = p.groove;
      p.groove = Math.min(GROOVE_MAX, p.groove + 1);
      G.score += Math.round((perfect ? 18 : 6) * multiplier());
      Audio.sfx.tapGood(p.groove);
      G.pulse = 1;
      G.shocks.push({
        x: p.x, y: p.y, r: 8,
        maxR: perfect ? 74 : 54,
        life: perfect ? 0.34 : 0.25,
        max: perfect ? 0.34 : 0.25,
        col: perfect ? YELLOW : CYAN,
      });
      if (perfect) {
        G.perfectTaps++;
        p.perfectChain++;
        G.perfectRun++;
        G.bestPerfectRun = Math.max(G.bestPerfectRun, G.perfectRun);
        if (G.perfectRun > META.bestPerfectRun) {
          META.bestPerfectRun = G.perfectRun;
          metaUiDirty = true;
          saveMeta();
          checkPerfectAchievements();
        }
        addText(p.x, p.y - 34, `PERFECT  ${timingMs}ms`, YELLOW, 0.72, 12);
        spark(p.x, p.y, YELLOW, 12, 180);
        if (p.perfectChain >= CADENZA_PERFECTS) beginCadenza();
      } else {
        p.perfectChain = 0;
        G.perfectRun = 0;
      }
      if (p.groove !== before && !perfect) {
        addText(p.x, p.y - 34, "♪ " + weaponLevelName(p.groove), currentShip().color, 1.1, 14);
        spark(p.x, p.y, CYAN, 8, 150);
      } else if (!perfect) {
        addText(p.x, p.y - 30, "ON BEAT", CYAN, 0.6, 11);
      }
      if (p.streak > 0 && p.streak % STREAK_FOR_BOMB === 0 && p.bombs < p.maxBombs) {
        p.bombs++;
        addText(p.x, p.y - 52, "𝄐 FERMATA READY", YELLOW, 1.6, 15);
        Audio.sfx.fanfare();
      }
    } else {
      p.streak = 0;
      p.perfectChain = 0;
      G.perfectRun = 0;
      const before = p.groove;
      p.groove = Math.max(0, p.groove - 1);
      Audio.sfx.tapBad();
      addText(p.x, p.y - 30, "OFF BEAT", RED, 0.8, 12);
      if (p.groove !== before) addText(p.x, p.y - 46, weaponLevelName(p.groove), "rgba(255,92,92,0.8)", 1, 12);
      G.flashR = Math.max(G.flashR, 0.14);
    }
  }

  function beginCadenza() {
    const p = G.p;
    p.perfectChain = 0;
    p.cadenzaT = Math.max(p.cadenzaT, beatDur() * CADENZA_BEATS);
    p.invulnT = Math.max(p.invulnT, 0.18);
    clearBullets(p.x, p.y, 92);
    G.shocks.push({ x: p.x, y: p.y, r: 14, maxR: 128, life: 0.55, max: 0.55, col: WHITE });
    G.flashW = Math.max(G.flashW, 0.2);
    G.shake = Math.max(G.shake, 4);
    addText(p.x, p.y - 58, "CADENZA // 4 BEATS", WHITE, 1.3, 16);
    Audio.sfx.fanfare();
  }

  function dropGroove(n) {
    const p = G.p;
    const before = p.groove;
    p.groove = Math.max(0, p.groove - n);
    p.streak = 0;
    p.perfectChain = 0;
    G.perfectRun = 0;
    p.decayT = GROOVE_DECAY;
    if (p.groove !== before) addText(p.x, p.y - 46, weaponLevelName(p.groove), "rgba(255,92,92,0.85)", 1, 12);
  }

  function fireBomb() {
    if (G.phase !== "play") return;
    const p = G.p;
    if (p.bombs <= 0) return;
    p.bombs--;
    p.invulnT = Math.max(p.invulnT, 1.4);
    G.shocks.push({ x: p.x, y: p.y, r: 20, maxR: 700, life: 0.7, max: 0.7, col: YELLOW });
    clearBullets();
    G.beams.length = 0;
    for (const e of [...G.enemies]) damageEnemy(e, e.boss ? 90 : 999);
    G.flashW = 0.6;
    G.shake = 16;
    addText(W / 2, H / 2 - 40, "𝄐 FERMATA", YELLOW, 1.6, 26);
    Audio.sfx.bomb();
  }

  /* ============================================================
     SPAWNING & COMBAT
     ============================================================ */
  function hpScale() {
    return 1 + (G.movement - 1) * 0.45 + Math.min(G.waveT, 90) * 0.004;
  }

  function spawnEnemy(type, x, y, opts) {
    const d = ETYPES[type];
    const e = {
      id: G.eid++, type, x, y,
      hp: d.hp * hpScale(), maxHp: d.hp * hpScale(),
      r: d.r, col: d.col,
      seed: randi(0, 999), t: 0,
      baseX: x, phase: rand(0, TAU),
      state: null, tele: 0, aimA: 0,
      spin: rand(0, TAU), active: true, alt: 0,
      fade: 0, flash: 0, muzzle: 0,
      boss: false,
    };
    if (opts) Object.assign(e, opts);
    G.enemies.push(e);
    return e;
  }

  function spawnBoss(key) {
    const b = BOSSES[key];
    const e = spawnEnemy("drone", W / 2, -70);
    e.type = "boss"; e.btype = key; e.boss = true;
    e.name = b.name; e.col = b.col; e.r = b.r;
    e.hp = e.maxHp = b.hp * (1 + (G.movement - 1) * 0.1);
    e.bphase = 1; e.beatCount = 0; e.spinCd = 0;
    G.bossActive = true;
    addText(W / 2, H / 2 - 60, b.name, b.col === WHITE ? PINK : b.col, 2.2, 22);
    return e;
  }

  /* --- formation patterns (queued spawns) --- */
  const PATTERNS = {
    swoopLine() {
      const x = rand(70, W - 70), amp = rand(40, 70) * (Math.random() < 0.5 ? 1 : -1);
      for (let i = 0; i < 5; i++) {
        queueSpawn(i * 0.28, "swooper", x, -24, { baseX: x, amp, phase: 0 });
      }
    },
    vForm() {
      const cx = rand(110, W - 110);
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        queueSpawn(Math.abs(k) * 0.16, "swooper", cx + k * 44, -24 - Math.abs(k) * 20, { baseX: cx + k * 44, amp: 24, phase: k });
      }
    },
    dronePair() {
      const n = G.movement >= 3 ? 3 : 2;
      for (let i = 0; i < n; i++) queueSpawn(i * 0.5, "drone", rand(50, W - 50), -26);
    },
    turretPair() {
      queueSpawn(0, "turret", rand(30, 90), -20);
      queueSpawn(0.2, "turret", rand(W - 90, W - 30), -20);
    },
    tank() {
      queueSpawn(0, "tank", rand(90, W - 90), -30);
    },
    diverPair() {
      queueSpawn(0, "diver", rand(40, W - 40), -22);
      queueSpawn(0.6, "diver", rand(40, W - 40), -22);
    },
    splitter() {
      queueSpawn(0, "splitter", rand(60, W - 60), -24);
    },
  };

  function queueSpawn(delay, type, x, y, opts) {
    G.queue.push({ t: G.time + delay, type, x, y, opts });
  }

  function pickPattern() {
    const list = MOVEMENTS[G.movement - 1].patterns;
    let total = 0;
    for (const [, w] of list) total += w;
    let roll = Math.random() * total;
    for (const [name, w] of list) { roll -= w; if (roll <= 0) return name; }
    return list[0][0];
  }

  function fireBullet(x, y, a, spd, col, r = 4.5) {
    if (G.bullets.length > 400) return;
    G.bullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r, col, life: 9, grazed: false });
  }
  function radial(e, n, spd, offset = 0) {
    e.muzzle = 0.16;
    for (let i = 0; i < n; i++) fireBullet(e.x, e.y, offset + (i / n) * TAU, spd, e.col);
  }
  function aimedFan(e, n, spd, spread) {
    e.muzzle = 0.16;
    const base = Math.atan2(G.p.y - e.y, G.p.x - e.x);
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
      fireBullet(e.x, e.y, a, spd, e.col);
    }
  }

  function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.09;
    if (e.hp <= 0) { e.dead = true; killEnemy(e); }
  }

  function multiplier() { return 1 + Math.min(G.combo, 80) / 20; }

  function killEnemy(e) {
    const idx = G.enemies.indexOf(e);
    if (idx >= 0) G.enemies.splice(idx, 1);
    G.kills++;
    META.lifetimeKills++;
    metaUiDirty = true;
    saveMeta();
    checkLifetimeAchievements();
    G.combo++;
    G.bestCombo = Math.max(G.bestCombo, G.combo);
    const base = e.boss ? BOSSES[e.btype].score : ETYPES[e.type].score;
    const gain = Math.round(base * multiplier());
    G.score += gain;
    burst(e.x, e.y, e.col, e.boss ? 46 : 12, e.boss ? 240 : 150);
    Audio.sfx.boom(e.boss);
    G.shake = Math.max(G.shake, e.boss ? 14 : 2.5);
    // note pickups (score) + rare hearts
    const drops = e.boss ? 8 : e.type === "tank" || e.type === "drone" ? 2 : Math.random() < 0.45 ? 1 : 0;
    for (let i = 0; i < drops; i++) {
      G.gems.push({ x: e.x + rand(-12, 12), y: e.y + rand(-8, 8), vx: rand(-30, 30), vy: rand(20, 60), t: 0, heart: false });
    }
    if (!e.boss && Math.random() < 0.03) {
      G.gems.push({ x: e.x, y: e.y, vx: 0, vy: 45, t: 0, heart: true });
    }
    if (e.type === "splitter") {
      for (const dir of [-1, 1]) {
        spawnEnemy("mini", e.x + dir * 12, e.y, { curve: dir });
      }
    }
    if (e.boss) bossDown(e);
    else addText(e.x, e.y - 12, "+" + gain, e.col, 0.7, 12);
  }

  function bossDown(e) {
    Audio.sfx.bossDown();
    clearBullets();
    G.beams.length = 0;
    G.flashW = 0.7;
    G.shake = 18;
    G.bossActive = false;
    addText(W / 2, H / 2 - 40, e.name + " SILENCED", YELLOW, 2.4, 20);
    if (e.btype === "conductor") { winGame(); return; }
    beginSectionClear();
  }

  function beginSectionClear() {
    const start = G.sectionStart;
    const taps = G.taps - start.taps;
    const hits = G.tapsHit - start.tapsHit;
    const perfects = G.perfectTaps - start.perfectTaps;
    const grazes = G.grazes - start.grazes;
    const damage = G.hitsTaken - start.hitsTaken;
    const accuracy = taps ? hits / taps : 0;
    const perfectRate = taps ? perfects / taps : 0;
    const noHit = damage === 0;
    const quality = accuracy * 0.55 + perfectRate * 0.25 + (noHit ? 0.2 : 0);
    const grade = quality >= 0.9 ? "S" : quality >= 0.78 ? "A" : quality >= 0.63 ? "B" : quality >= 0.46 ? "C" : "D";
    const bonus = Math.round((G.movement * 250 + accuracy * 500 + perfectRate * 650 + grazes * 4 + (noHit ? 750 : 0)) / 10) * 10;
    G.score += bonus;
    G.sectionResult = {
      movement: G.movement, grade, bonus, noHit, grazes,
      accuracy: Math.round(accuracy * 100), perfect: Math.round(perfectRate * 100),
    };
    G.sectionT = 3.1;
    G.phase = "sectionclear";
    G.queue.length = 0;
    G.enemies.length = 0;
    G.p.cadenzaT = 0;
    G.p.perfectChain = 0;
    G.perfectRun = 0;
    META.clearedMovements = Math.max(META.clearedMovements, G.movement);
    saveMeta();
    unlockAchievement(`movement-${G.movement}`);
    Audio.sfx.fanfare();
  }

  function advanceMovement() {
    G.movement++;
    const mv = MOVEMENTS[G.movement - 1];
    G.intensity = mv.intensity;
    G.waveT = 0; G.spawnCd = 2.5; G.bossCue = 0;
    G.queue.length = 0;
    G.p.hp = Math.min(G.p.maxHp, G.p.hp + 1);
    G.enemies.length = 0;
    G.sectionStart = captureSectionStart(G);
    G.sectionResult = null;
    startInterlude();
  }

  function clearBullets(cx, cy, rad) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (rad === undefined || dist2(b.x, b.y, cx, cy) < rad * rad) {
        spark(b.x, b.y, b.col, 2);
        G.bullets.splice(i, 1);
      }
    }
  }

  function playerHit() {
    const p = G.p;
    if (p.invulnT > 0) return;
    p.hp--;
    G.hitsTaken++;
    p.invulnT = 1.5;
    G.combo = 0;
    dropGroove(2);
    G.shake = Math.max(G.shake, 9);
    G.flashR = 0.5;
    Audio.sfx.hurt();
    clearBullets(p.x, p.y, 100);
    burst(p.x, p.y, RED, 16, 190);
    if (p.hp <= 0) die();
  }

  function die() {
    G.phase = "gameover";
    saveMeta();
    recordScore();
    const acc = G.taps ? Math.round((G.tapsHit / G.taps) * 100) : 0;
    const perfect = G.taps ? Math.round((G.perfectTaps / G.taps) * 100) : 0;
    const pro = window.RB && RB.isAdFree && RB.isAdFree();
    showOverlay(
      "THE SILENCE TAKES YOU",
      `The requiem stops in ${MOVEMENTS[G.movement - 1].name.toLowerCase()}. ` +
      `${G.kills} muted freed · ${acc}% on beat · ${perfect}% perfect · ${G.grazes} grazes · best streak ${G.bestStreak}.`,
      `SCORE ${G.score.toLocaleString()} — BEST ${G.best.toLocaleString()}`,
      "Play again",
      !G.usedEncore ? (pro ? "⭐ Encore (Pro — free)" : "🎬 Encore — watch an ad, keep playing") : null
    );
  }

  function winGame() {
    G.phase = "win";
    G.won = true;
    G.score += 1500 + Math.max(0, Math.round((600 - G.runTime) * 5));
    META.clearedMovements = 4;
    META.wins++;
    META.clears[G.shipId] = (META.clears[G.shipId] || 0) + 1;
    saveMeta();
    unlockAchievement("game-clear");
    unlockAchievement(`clear-${G.shipId}`);
    recordScore();
    const acc = G.taps ? Math.round((G.tapsHit / G.taps) * 100) : 0;
    const perfect = G.taps ? Math.round((G.perfectTaps / G.taps) * 100) : 0;
    showOverlay(
      "FINALE — THE WORLD SINGS AGAIN",
      `The baton falls. Four movements, ${G.kills} muted freed, ${acc}% on beat, ${perfect}% perfect, ${G.grazes} grazes, ` +
      `${fmtTime(G.runTime)} on the podium. Somewhere above the district, a window opens, and someone hums.`,
      `SCORE ${G.score.toLocaleString()} — BEST ${G.best.toLocaleString()}`,
      "Play the requiem again",
      null
    );
  }

  function recordScore() {
    G.best = Math.max(G.best, G.score);
    if (window.RB && RB.recordScore) RB.recordScore(GAME_ID, G.score);
  }

  /* ============================================================
     BEAT EVENTS — enemies attack on the beat
     ============================================================ */
  function onBeat(bi) {
    G.pulse = 1;
    const mv = G.movement;
    for (const e of G.enemies) {
      if (e.boss) { bossBeat(e, bi); continue; }
      if (e.y < 0 || e.y > H || e.x < -10 || e.x > W + 10) continue;
      const k = (bi + e.seed) % 4;
      switch (e.type) {
        case "swooper":
          if ((bi + e.seed) % 8 === 0) aimedFan(e, 1, 165 + mv * 8, 0);
          break;
        case "drone":
          if (k === 0) radial(e, mv >= 3 ? 9 : 7, 100 + mv * 8, e.spin);
          break;
        case "turret":
          if (k === 1) aimedFan(e, 2, 185 + mv * 10, 0.22);
          break;
        case "tank":
          if (k === 2) aimedFan(e, 5, 150 + mv * 8, 0.9);
          break;
        case "diver":
          if (e.state === null && (bi + e.seed) % 2 === 0 && e.y > 60) {
            e.state = "align"; e.tele = beatDur();
          }
          break;
      }
    }
  }

  function bossBeat(e, bi) {
    e.beatCount++;
    const bc = e.beatCount;
    switch (e.btype) {
      case "timpanist":
        if (bc % 2 === 0) { radial(e, 12, 120, e.alt ? TAU / 24 : 0); e.alt = !e.alt; }
        if (bc % 8 === 4) aimedFan(e, 3, 210, 0.5);
        break;
      case "firstchair":
        if (bc % 4 === 0) {
          e.fade = 0.6;
          e.tx = clamp(G.p.x + rand(-140, 140), 50, W - 50);
          e.ty = rand(70, 170);
        }
        if (bc % 4 === 2) aimedFan(e, 5, 235, 0.7);
        if (bc % 8 === 6) {
          spawnEnemy("swooper", e.x - 40, e.y, { baseX: e.x - 40, amp: 30, phase: 0 });
          spawnEnemy("swooper", e.x + 40, e.y, { baseX: e.x + 40, amp: 30, phase: 2 });
        }
        break;
      case "metronome":
        if (bc % 8 === 0) e.active = false;
        if (bc % 8 === 2) { e.active = true; radial(e, 16, 135); }
        if (bc % 4 === 1) aimedFan(e, 3, 195, 0.4);
        break;
      case "conductor":
        if (bc % 2 === 0) aimedFan(e, e.bphase >= 3 ? 5 : 3, 195 + e.bphase * 18, 0.42);
        if (e.bphase >= 2 && bc % 4 === 0) {
          G.beams.push({ x: clamp(G.p.x, 30, W - 30), tele: beatDur(), active: 0 });
          if (e.bphase >= 3) G.beams.push({ x: clamp(G.p.x + (G.p.x < W / 2 ? 120 : -120), 30, W - 30), tele: beatDur(), active: 0 });
        }
        if (e.bphase >= 3 && bc % 8 === 0) {
          spawnEnemy("drone", clamp(e.x - 70, 40, W - 40), e.y + 20);
          spawnEnemy("drone", clamp(e.x + 70, 40, W - 40), e.y + 20);
        }
        break;
    }
  }

  /* ============================================================
     SIMULATION STEP (fixed 60 Hz)
     ============================================================ */
  function scrollSpeed() { return 60 + currentBpm() * 0.5; }

  function simStep() {
    pollGamepad();
    const musical = G.phase === "play" || G.phase === "interlude" || G.phase === "sectionclear";
    if (musical) {
      const stepDur = beatDur() / 4;
      G.songStep += STEP / stepDur;
      G.beatPhase = (G.songStep / 4) % 1;
      const bi = Math.floor(G.songStep / 4);
      if (bi !== G.beatIndex) {
        G.beatIndex = bi;
        if (G.phase === "play") onBeat(bi);
        else G.pulse = 1;
      }
      G.scrollY += scrollSpeed() * STEP;
    }
    if (G.phase !== "paused" && G.phase !== "title") {
      updateParticles();
    }
    if (G.phase === "interlude") {
      G.ilT -= STEP;
      if (G.ilT <= 0) G.phase = "play";
      return;
    }
    if (G.phase === "sectionclear") {
      G.sectionT -= STEP;
      if (G.sectionT <= 0) advanceMovement();
      return;
    }
    if (G.phase !== "play") return;

    G.time += STEP;
    G.runTime += STEP;
    updatePlayer();
    updateShots();
    updateEnemies();
    updateBullets();
    updateBeams();
    updateGems();
    updateSpawner();
    updateHUD();
  }

  const padState = { dx: 0, dy: 0, connected: false, prev: {}, debug: null };

  function padPressed(gp, index) {
    const b = gp && gp.buttons && gp.buttons[index];
    return !!(b && (b.pressed || b.value > 0.55));
  }

  function pollGamepad(override) {
    let gp = override || padState.debug || null;
    if (!gp && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (const pad of pads) { if (pad) { gp = pad; break; } }
    }
    if (!gp) {
      padState.dx = 0; padState.dy = 0;
      padState.prev = {};
      padState.connected = false;
      return;
    }
    if (!padState.connected && !override && window.RB && RB.toast) RB.toast("Controller connected — A taps, B bombs, Start pauses.", "good");
    padState.connected = true;

    let dx = gp.axes && Number.isFinite(gp.axes[0]) ? gp.axes[0] : 0;
    let dy = gp.axes && Number.isFinite(gp.axes[1]) ? gp.axes[1] : 0;
    if (Math.abs(dx) < 0.18) dx = 0;
    if (Math.abs(dy) < 0.18) dy = 0;
    if (padPressed(gp, 14)) dx = -1;
    if (padPressed(gp, 15)) dx = 1;
    if (padPressed(gp, 12)) dy = -1;
    if (padPressed(gp, 13)) dy = 1;
    padState.dx = clamp(dx, -1, 1); padState.dy = clamp(dy, -1, 1);

    const now = {
      tap: padPressed(gp, 0),
      bomb: padPressed(gp, 1) || padPressed(gp, 5),
      pause: padPressed(gp, 9),
    };
    if (now.tap && !padState.prev.tap) {
      if (G.phase === "title" || G.phase === "gameover" || G.phase === "win") startGame();
      else tapBeat();
    }
    if (now.bomb && !padState.prev.bomb) fireBomb();
    if (now.pause && !padState.prev.pause) {
      if (G.phase === "title") startGame();
      else togglePause();
    }
    padState.prev = now;
  }

  function inputDir() {
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;
    if (keys.ArrowUp || keys.KeyW) dy -= 1;
    if (keys.ArrowDown || keys.KeyS) dy += 1;
    dx += padState.dx; dy += padState.dy;
    if (touch.active) { dx = touch.dx; dy = touch.dy; }
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    return [dx, dy];
  }

  function spawnPlayerShot(opts) {
    const o = opts || {};
    const angle = UP + (o.angle || 0);
    const speed = o.speed || 540;
    G.shots.push({
      x: o.x === undefined ? G.p.x : o.x,
      y: o.y === undefined ? G.p.y - 10 : o.y,
      vx: o.vx === undefined ? Math.cos(angle) * speed : o.vx,
      vy: o.vy === undefined ? Math.sin(angle) * speed : o.vy,
      dmg: o.dmg || 5,
      r: o.r || 4,
      life: o.life || 1.8,
      pierce: !!o.pierce,
      hit: {},
      missile: !!o.missile,
      cadenza: !!o.cadenza,
      kind: o.kind || "aria",
      col: o.col || currentShip().color,
      waveAmp: o.waveAmp || 0,
      wavePhase: o.wavePhase || 0,
      baseX: o.x === undefined ? G.p.x : o.x,
      age: 0,
    });
  }

  function fireShipWeapon(p) {
    const ship = currentShip();
    const groove = p.groove;
    const inCadenza = p.cadenzaT > 0;
    const cadence = inCadenza ? 0.62 : 1;
    const power = inCadenza ? 1.3 : 1;
    p.volleyCount++;

    if (ship.id === "vesper") {
      p.fireCd = Math.max(0.155, 0.29 - groove * 0.014) * cadence;
      const sidePairs = groove >= 7 ? 2 : groove >= 4 ? 1 : 0;
      spawnPlayerShot({
        x: p.x, y: p.y - 16, speed: 690, dmg: (9 + groove * 1.45) * power,
        r: groove >= 7 ? 5.5 : 4.7, life: 1.45, pierce: true,
        cadenza: inCadenza, kind: "lance", col: ship.color,
      });
      for (let pair = 0; pair < sidePairs; pair++) {
        const offset = 8 + pair * 7;
        const angle = 0.022 + pair * 0.026;
        for (const side of [-1, 1]) {
          spawnPlayerShot({
            x: p.x + side * offset, y: p.y - 9, angle: side * angle, speed: 650,
            dmg: (6.2 + groove * 0.82) * power, r: 3.8, life: 1.55, pierce: groove >= 8,
            cadenza: inCadenza, kind: "lance", col: ship.color,
          });
        }
      }
    } else if (ship.id === "counterpoint") {
      p.fireCd = Math.max(0.115, 0.235 - groove * 0.0125) * cadence;
      const amp = 8 + groove * 1.8;
      for (let voice = 0; voice < 2; voice++) {
        const side = voice ? 1 : -1;
        spawnPlayerShot({
          x: p.x + side * 10, y: p.y - 8, speed: 555 + groove * 8,
          dmg: (5.4 + groove * 0.32) * power, r: 4.2, life: 1.85,
          cadenza: inCadenza, kind: "canon", col: voice ? ship.accent : ship.color,
          waveAmp: amp, wavePhase: voice ? Math.PI : 0,
        });
      }
      if (groove >= 4) {
        spawnPlayerShot({
          x: p.x, y: p.y - 15, speed: 610, dmg: (5.8 + groove * 0.36) * power,
          r: 3.6, life: 1.65, pierce: groove >= 8,
          cadenza: inCadenza, kind: "canon", col: WHITE,
        });
      }
      if (groove >= 6 && p.volleyCount % (groove >= 8 ? 2 : 3) === 0) {
        for (const side of [-1, 1]) {
          spawnPlayerShot({
            x: p.x + side * 17, y: p.y + 1, vx: side * 68, vy: -330,
            dmg: 8.5 * power, r: 5, life: 2.35,
            missile: true, cadenza: inCadenza, kind: "canon-note", col: side < 0 ? ship.color : ship.accent,
          });
        }
      }
    } else if (ship.id === "virtuoso") {
      p.fireCd = Math.max(0.105, 0.205 - groove * 0.0095) * cadence;
      const needles = groove >= 6 ? 3 : groove >= 3 ? 2 : 1;
      for (let i = 0; i < needles; i++) {
        const offset = needles === 1 ? 0 : needles === 2 ? (i ? 7 : -7) : (i - 1) * 9;
        const angle = needles === 3 ? (i - 1) * 0.055 : 0;
        spawnPlayerShot({
          x: p.x + offset, y: p.y - 13, angle, speed: 640,
          dmg: (4.8 + groove * 0.28) * power, r: 3.4, life: 1.55,
          cadenza: inCadenza, kind: "baton", col: ship.color,
        });
      }
      // The rail is an audible/visual accent: exactly one shot per gameplay beat.
      if (p.lastRailBeat !== G.beatIndex) {
        p.lastRailBeat = G.beatIndex;
        spawnPlayerShot({
          x: p.x, y: p.y - 20, speed: 830,
          dmg: (12 + groove * 1.55) * power, r: 6, life: 1.2, pierce: true,
          cadenza: inCadenza, kind: "rail", col: ship.color,
        });
        if (inCadenza && groove >= 7) {
          for (const side of [-1, 1]) {
            spawnPlayerShot({
              x: p.x + side * 14, y: p.y - 12, angle: side * 0.035, speed: 760,
              dmg: (8 + groove) * power, r: 4.5, life: 1.3, pierce: true,
              cadenza: true, kind: "rail", col: ship.accent,
            });
          }
        }
      }
    } else {
      const wpn = WEAPONS[groove];
      p.fireCd = wpn.cd * cadence;
      for (let i = 0; i < wpn.angs.length; i++) {
        spawnPlayerShot({
          x: p.x + (wpn.xoffs[i] || 0), y: p.y - 10,
          angle: wpn.angs[i], speed: 540, dmg: wpn.dmg * power, r: 4, life: 1.6,
          pierce: wpn.pierce && i === 0, cadenza: inCadenza, kind: "aria", col: ship.color,
        });
      }
      for (let m = 0; m < wpn.homing; m++) {
        spawnPlayerShot({
          x: p.x + (m === 0 ? -16 : 16), y: p.y,
          vx: m === 0 ? -60 : 60, vy: -320,
          dmg: 9 * power, r: 5, life: 2.4,
          missile: true, cadenza: inCadenza, kind: "aria-missile", col: YELLOW,
        });
      }
    }
    Audio.sfx.shoot(ship.id);
  }

  function updatePlayer() {
    const p = G.p;
    const [dx, dy] = inputDir();
    p.x = clamp(p.x + dx * p.speed * STEP, 16, W - 16);
    p.y = clamp(p.y + dy * p.speed * STEP, 40, H - 24);
    if (p.invulnT > 0) p.invulnT -= STEP;
    if (p.tapCd > 0) p.tapCd -= STEP;
    if (p.cadenzaT > 0) p.cadenzaT = Math.max(0, p.cadenzaT - STEP);
    if (p.grazeGlow > 0) p.grazeGlow = Math.max(0, p.grazeGlow - STEP);

    // groove decays when you go quiet
    if (p.groove > 0) {
      p.decayT -= STEP;
      if (p.decayT <= 0) {
        p.decayT = GROOVE_DECAY;
        p.groove--;
        p.streak = 0;
        p.perfectChain = 0;
        G.perfectRun = 0;
        addText(p.x, p.y - 40, "diminuendo… " + weaponLevelName(p.groove), "rgba(220,230,255,0.7)", 1, 11);
      }
    }

    // engine trail
    p.trail.push({ x: p.x, y: p.y + 12 });
    if (p.trail.length > 10) p.trail.shift();

    // auto-fire straight up (Raiden style)
    p.fireCd -= STEP;
    if (p.fireCd <= 0) {
      fireShipWeapon(p);
    }
  }

  function updateShots() {
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const s = G.shots[i];
      s.life -= STEP;
      if (s.life <= 0) { G.shots.splice(i, 1); continue; }
      if (s.missile) {
        let tgt = null, td = 1e9;
        for (const e of G.enemies) {
          if (s.hit[e.id] || e.fade > 0 || e.y < -20) continue;
          const d = dist2(s.x, s.y, e.x, e.y);
          if (d < td) { td = d; tgt = e; }
        }
        if (tgt) {
          const want = Math.atan2(tgt.y - s.y, tgt.x - s.x);
          const cur = Math.atan2(s.vy, s.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          const turn = clamp(diff, -7 * STEP, 7 * STEP);
          const spd = Math.min(460, Math.hypot(s.vx, s.vy) + 640 * STEP);
          s.vx = Math.cos(cur + turn) * spd;
          s.vy = Math.sin(cur + turn) * spd;
        }
      }
      s.px = s.x; s.py = s.y;
      if (s.waveAmp) {
        s.age += STEP;
        s.baseX += s.vx * STEP;
        s.x = s.baseX + Math.sin(s.age * 11.5 + s.wavePhase) * s.waveAmp;
        s.y += s.vy * STEP;
      } else {
        s.x += s.vx * STEP;
        s.y += s.vy * STEP;
      }
      if (s.x < -30 || s.x > W + 30 || s.y < -40 || s.y > H + 30) { G.shots.splice(i, 1); continue; }
      for (const e of G.enemies) {
        if (e.fade > 0 || s.hit[e.id] || e.y < -20) continue;
        if (dist2(s.x, s.y, e.x, e.y) < (e.r + s.r) * (e.r + s.r)) {
          s.hit[e.id] = true;
          damageEnemy(e, s.dmg);
          spark(s.x, s.y, s.col || CYAN, 3);
          Audio.sfx.hit();
          if (!s.pierce) G.shots.splice(i, 1);
          break;
        }
      }
    }
  }

  function updateEnemies() {
    const p = G.p;
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      e.t += STEP;
      if (e.flash > 0) e.flash -= STEP;
      if (e.muzzle > 0) e.muzzle -= STEP;

      if (e.boss) { updateBoss(e); }
      else {
        switch (e.type) {
          case "swooper":
            e.y += 115 * STEP;
            e.x = e.baseX + Math.sin(e.t * 2.6 + e.phase) * (e.amp || 50);
            break;
          case "drone":
            e.y += 42 * STEP;
            e.x += Math.sin(e.t * 1.4 + e.phase) * 22 * STEP;
            break;
          case "turret":
            e.y += scrollSpeed() * STEP; // rides the terrain
            e.aimA = Math.atan2(p.y - e.y, p.x - e.x);
            break;
          case "tank":
            e.y += 34 * STEP;
            e.aimA = Math.atan2(p.y - e.y, p.x - e.x);
            break;
          case "diver":
            if (e.state === "align") {
              e.tele -= STEP;
              e.x += clamp(p.x - e.x, -220 * STEP, 220 * STEP);
              e.y += 30 * STEP;
              if (e.tele <= 0) e.state = "dive";
            } else if (e.state === "dive") {
              e.y += 460 * STEP;
              e.x += clamp(p.x - e.x, -90 * STEP, 90 * STEP);
            } else {
              e.y += 90 * STEP;
            }
            break;
          case "splitter":
            e.y += 58 * STEP;
            e.x = e.baseX + Math.sin(e.t * 1.8 + e.phase) * 34;
            break;
          case "mini":
            e.y += 150 * STEP;
            e.x += (e.curve || 1) * 130 * STEP * Math.cos(e.t * 3);
            break;
        }
        // gone past the bottom → despawn
        if (e.y > H + 40 || e.x < -60 || e.x > W + 60) { G.enemies.splice(i, 1); continue; }
      }

      // contact damage
      if (!e.dead && e.fade <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
        playerHit();
      }
    }
  }

  function updateBoss(e) {
    // entrance
    if (e.y < 110 && !e.entered) {
      e.y += 90 * STEP;
      if (e.y >= 110) e.entered = true;
      return;
    }
    if (e.fade > 0) {
      e.fade -= STEP;
      if (e.fade <= 0.3 && e.tx !== undefined) { e.x = e.tx; e.y = e.ty; e.tx = undefined; }
      return;
    }
    switch (e.btype) {
      case "timpanist":
        e.x = W / 2 + Math.sin(e.t * 0.6) * 150;
        e.y = 110 + Math.sin(e.t * 1.1) * 22;
        break;
      case "firstchair":
        // drifts; repositioning happens via teleport on the beat
        e.x = clamp(e.x + Math.sin(e.t * 0.8) * 40 * STEP, 40, W - 40);
        break;
      case "metronome": {
        // pendulum sweep
        e.x = W / 2 + Math.sin(e.t * 1.15) * (W / 2 - 70);
        e.y = 120 + Math.abs(Math.cos(e.t * 1.15)) * 26;
        if (e.active) {
          e.spin += 2.8 * STEP;
          e.spinCd -= STEP;
          if (e.spinCd <= 0) {
            e.spinCd = 0.13;
            e.muzzle = 0.12;
            fireBullet(e.x, e.y, e.spin, 112, e.col);
            fireBullet(e.x, e.y, e.spin + Math.PI, 112, e.col);
          }
        }
        break;
      }
      case "conductor": {
        const frac = e.hp / e.maxHp;
        const newPhase = frac < 1 / 3 ? 3 : frac < 2 / 3 ? 2 : 1;
        if (newPhase !== e.bphase) {
          e.bphase = newPhase;
          clearBullets();
          G.beams.length = 0;
          G.flashW = 0.5;
          G.shake = 12;
          addText(e.x, e.y + 70, newPhase === 2 ? "THE BATON RISES" : "FORTISSIMO", PINK, 1.8, 17);
          if (window.RB && RB.toast) RB.toast(newPhase === 2 ? "The Conductor draws his baton." : "The final measure. Survive it.", "");
        }
        e.x = W / 2 + Math.sin(e.t * 0.5) * 140;
        e.y = 105 + Math.sin(e.t * 0.9) * 24;
        const arms = e.bphase === 2 ? 3 : 4;
        e.spin += (0.9 + e.bphase * 0.25) * STEP;
        e.spinCd -= STEP;
        if (e.spinCd <= 0) {
          e.spinCd = e.bphase === 2 ? 0.17 : 0.13;
          e.muzzle = 0.12;
          for (let i = 0; i < arms; i++) {
            fireBullet(e.x, e.y, e.spin + (i / arms) * TAU, 105 + e.bphase * 13, PINK);
          }
        }
        break;
      }
    }
  }

  function updateBullets() {
    const p = G.p;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (!b) continue; // playerHit → clearBullets can shrink the array mid-loop
      b.life -= STEP;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
        G.bullets.splice(i, 1); continue;
      }
      if (dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) * (b.r + p.r)) {
        G.bullets.splice(i, 1);
        playerHit();
      } else if (!b.grazed && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r + 17) * (b.r + p.r + 17)) {
        b.grazed = true;
        G.grazes++;
        G.score += Math.round(2 * multiplier());
        p.decayT = Math.min(GROOVE_DECAY, p.decayT + 0.18);
        p.grazeGlow = 0.28;
        spark(p.x, p.y, b.col, 3, 75);
        if (G.grazes % 10 === 0) addText(p.x, p.y - 28, `GRAZE x${G.grazes}`, YELLOW, 0.65, 11);
      }
    }
  }

  function updateBeams() {
    const p = G.p;
    for (let i = G.beams.length - 1; i >= 0; i--) {
      const bm = G.beams[i];
      if (bm.tele > 0) {
        bm.tele -= STEP;
        if (bm.tele <= 0) { bm.active = 0.5; G.shake = Math.max(G.shake, 5); Audio.sfx.boom(false); }
        continue;
      }
      bm.active -= STEP;
      if (bm.active <= 0) { G.beams.splice(i, 1); continue; }
      if (Math.abs(p.x - bm.x) < 20 + p.r) playerHit();
    }
  }

  function updateGems() {
    const p = G.p;
    for (let i = G.gems.length - 1; i >= 0; i--) {
      const g = G.gems[i];
      g.t += STEP;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < 110) {
        const pull = (1 - d / 110) * 700 + 80;
        g.vx += ((p.x - g.x) / (d || 1)) * pull * STEP * 4;
        g.vy += ((p.y - g.y) / (d || 1)) * pull * STEP * 4;
        g.vx *= 0.9; g.vy *= 0.9;
      } else {
        g.vx *= 0.98;
        g.vy = Math.min(g.vy + 120 * STEP, 95);
      }
      g.x += g.vx * STEP; g.y += g.vy * STEP;
      if (d < 20) {
        G.gems.splice(i, 1);
        if (g.heart) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          addText(p.x, p.y - 24, "+1 ♥", GREEN, 0.9, 14);
          Audio.sfx.fanfare();
        } else {
          G.score += Math.round(4 * multiplier());
          Audio.sfx.pickup(G.combo);
        }
      } else if (g.y > H + 20) {
        G.gems.splice(i, 1);
      }
    }
  }

  function updateSpawner() {
    // flush queued formation spawns
    for (let i = G.queue.length - 1; i >= 0; i--) {
      const q = G.queue[i];
      if (G.time >= q.t) {
        spawnEnemy(q.type, q.x, q.y, q.opts);
        G.queue.splice(i, 1);
      }
    }
    if (G.bossActive) return;
    const mv = MOVEMENTS[G.movement - 1];
    if (G.bossCue > 0) {
      G.bossCue -= STEP;
      if (G.bossCue <= 0) {
        G.bossCue = 0;
        spawnBoss(mv.boss);
      }
      return;
    }
    G.waveT += STEP;
    if (G.waveT >= mv.dur) {
      G.bossCue = beatDur() * 4;
      G.queue.length = 0;
      G.shake = Math.max(G.shake, 3);
      Audio.sfx.fanfare();
      return;
    }
    G.spawnCd -= STEP;
    const cap = 10 + G.movement * 2;
    if (G.spawnCd <= 0 && G.enemies.length < cap) {
      PATTERNS[pickPattern()]();
      G.spawnCd = Math.max(1.0, 2.4 - G.waveT * 0.012 - (G.movement - 1) * 0.18);
    }
  }

  /* ============================================================
     PARTICLES / TEXT / COSMETICS
     ============================================================ */
  function burst(x, y, col, n, spd) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 380) return;
      const a = rand(0, TAU), v = rand(spd * 0.3, spd);
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.8), max: 0.8, col, r: rand(1.5, 3.5) });
    }
  }
  function spark(x, y, col, n, spd = 90) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 380) return;
      const a = rand(0, TAU), v = rand(20, spd);
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.4), max: 0.4, col, r: rand(1, 2.2) });
    }
  }
  function addText(x, y, txt, col, life, size) {
    G.texts.push({ x: clamp(x, 60, W - 60), y, txt, col, life, max: life, size });
  }
  function updateParticles() {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const q = G.particles[i];
      q.life -= STEP;
      if (q.life <= 0) { G.particles.splice(i, 1); continue; }
      q.x += q.vx * STEP; q.y += q.vy * STEP;
      q.vx *= 0.94; q.vy *= 0.94;
    }
    for (let i = G.texts.length - 1; i >= 0; i--) {
      const t = G.texts[i];
      t.life -= STEP;
      t.y -= 22 * STEP;
      if (t.life <= 0) G.texts.splice(i, 1);
    }
    for (let i = G.shocks.length - 1; i >= 0; i--) {
      const s = G.shocks[i];
      s.life -= STEP;
      s.r = lerp(s.r, s.maxR, 0.22);
      if (s.life <= 0) G.shocks.splice(i, 1);
    }
    if (G.pulse > 0) G.pulse = Math.max(0, G.pulse - 3.2 * STEP);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - 34 * STEP);
    if (G.flashW > 0) G.flashW = Math.max(0, G.flashW - 2.4 * STEP);
    if (G.flashR > 0) G.flashR = Math.max(0, G.flashR - 1.6 * STEP);
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  const glowCache = {};
  function glowSprite(col) {
    let c = glowCache[col];
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.28, hexToRgba(col, 0.6));
      grad.addColorStop(1, hexToRgba(col, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      glowCache[col] = c;
    }
    return c;
  }
  function drawGlow(x, y, r, col, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  let noteSprite = null;
  function getNoteSprite() {
    if (!noteSprite) {
      noteSprite = document.createElement("canvas");
      noteSprite.width = noteSprite.height = 30;
      const g = noteSprite.getContext("2d");
      const grad = g.createRadialGradient(15, 15, 0, 15, 15, 15);
      grad.addColorStop(0, hexToRgba(YELLOW, 0.7));
      grad.addColorStop(1, hexToRgba(YELLOW, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 30, 30);
      g.fillStyle = "#fff8dc";
      g.font = "700 15px 'JetBrains Mono', monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("♪", 15, 16);
    }
    return noteSprite;
  }

  let vignette = null;
  function getVignette() {
    if (!vignette) {
      vignette = document.createElement("canvas");
      vignette.width = W; vignette.height = H;
      const g = vignette.getContext("2d");
      const grad = g.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.8);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(2,3,10,0.55)");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    return vignette;
  }

  const stars = [];
  for (let i = 0; i < 55; i++) {
    stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.7), v: rand(14, 34) });
  }

  const STAGE_ART = [
    { top: "#050815", bottom: "#140716", haze: PINK, line: CYAN },
    { top: "#06101a", bottom: "#071526", haze: CYAN, line: "#9beeff" },
    { top: "#130b09", bottom: "#1d0c13", haze: ORANGE, line: YELLOW },
    { top: "#100510", bottom: "#05030b", haze: PINK, line: WHITE },
  ];

  function drawStageSilhouette() {
    const m = G.movement;
    const scroll = G.scrollY;

    if (m === 1) {
      // The Silent District: a drowned neon city framing an open flight lane.
      for (let layer = 0; layer < 2; layer++) {
        const alpha = layer ? 0.34 : 0.18;
        const sideW = layer ? 82 : 126;
        const step = layer ? 112 : 156;
        const off = (scroll * (layer ? 0.48 : 0.24)) % step;
        ctx.fillStyle = `rgba(${layer ? "12,18,34" : "8,11,24"},${alpha + 0.35})`;
        for (let y = -step + off; y < H + step; y += step) {
          const seed = Math.floor((y - off) / step) + layer * 71;
          const leftW = sideW - hash01(seed * 7 + 3) * 34;
          const rightW = sideW - hash01(seed * 11 + 5) * 32;
          ctx.fillRect(0, y, leftW, step - 7);
          ctx.fillRect(W - rightW, y + 16, rightW, step - 23);
          ctx.fillStyle = hexToRgba(layer ? CYAN : PINK, alpha);
          for (let wy = y + 18; wy < y + step - 16; wy += 22) {
            if (hash01(seed * 31 + wy) > 0.36) ctx.fillRect(leftW - 14, wy, 4, 9);
            if (hash01(seed * 43 + wy) > 0.43) ctx.fillRect(W - rightW + 10, wy + 5, 4, 9);
          }
          ctx.fillStyle = `rgba(${layer ? "12,18,34" : "8,11,24"},${alpha + 0.35})`;
        }
      }
      ctx.strokeStyle = hexToRgba(CYAN, 0.08 + G.pulse * 0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(118, H); ctx.lineTo(202, 0);
      ctx.moveTo(W - 118, H); ctx.lineTo(W - 202, 0);
      ctx.stroke();
    } else if (m === 2) {
      // The Frozen Concert Hall: marble columns, empty balconies and ice fractures.
      const off = (scroll * 0.42) % 150;
      ctx.fillStyle = "rgba(10,24,40,0.72)";
      ctx.fillRect(0, 0, 82, H); ctx.fillRect(W - 82, 0, 82, H);
      for (let y = -150 + off; y < H + 150; y += 150) {
        for (const sx of [38, W - 38]) {
          ctx.fillStyle = "rgba(140,220,255,0.08)";
          ctx.fillRect(sx - 17, y + 20, 34, 104);
          ctx.fillStyle = "rgba(210,245,255,0.13)";
          ctx.fillRect(sx - 23, y + 12, 46, 9);
          ctx.fillRect(sx - 23, y + 124, 46, 8);
          ctx.strokeStyle = hexToRgba(CYAN, 0.2);
          ctx.strokeRect(sx - 17, y + 20, 34, 104);
        }
        ctx.strokeStyle = "rgba(180,235,255,0.11)";
        ctx.beginPath();
        ctx.moveTo(82, y + 138); ctx.lineTo(W - 82, y + 138);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(190,240,255,0.13)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const x = 90 + hash01(i * 17 + 2) * (W - 180);
        const y = (hash01(i * 23 + 9) * H + scroll * 0.7) % H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 11, y + 18); ctx.lineTo(x + 3, y + 31); ctx.stroke();
      }
    } else if (m === 3) {
      // The Metronome Works: massive brass clockwork rotating beneath the score.
      ctx.fillStyle = "rgba(37,17,10,0.48)";
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 7; i++) {
        const side = i % 2;
        const x = side ? W - 35 - (i % 3) * 24 : 35 + (i % 3) * 24;
        const y = ((i * 137 + scroll * (0.28 + (i % 3) * 0.06)) % (H + 150)) - 75;
        const r = 34 + (i % 3) * 14;
        ctx.save(); ctx.translate(x, y); ctx.rotate((G.time * 0.08 + i) * (side ? -1 : 1));
        ctx.strokeStyle = hexToRgba(i % 2 ? ORANGE : YELLOW, 0.12);
        ctx.lineWidth = 4; gearOutline(r, 14); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = hexToRgba(ORANGE, 0.13);
      for (let x = 76; x < W; x += 58) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
    } else {
      // The Podium: cathedral curtains and hard theatrical spotlights.
      const beamAlpha = 0.045 + G.pulse * 0.045;
      ctx.fillStyle = `rgba(255,46,136,${beamAlpha})`;
      ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(220, H); ctx.lineTo(292, H); ctx.lineTo(118, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W - 44, 0); ctx.lineTo(W - 220, H); ctx.lineTo(W - 292, H); ctx.lineTo(W - 118, 0); ctx.fill();
      const fold = 34;
      for (let x = 0; x < 92; x += fold) {
        const grad = ctx.createLinearGradient(x, 0, x + fold, 0);
        grad.addColorStop(0, "rgba(58,5,38,0.88)");
        grad.addColorStop(0.5, "rgba(128,10,67,0.58)");
        grad.addColorStop(1, "rgba(31,3,24,0.9)");
        ctx.fillStyle = grad; ctx.fillRect(x, 0, fold, H);
        ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.fillRect(x, 0, fold, H); ctx.restore();
      }
      ctx.strokeStyle = hexToRgba(PINK, 0.12);
      ctx.beginPath(); ctx.arc(W / 2, 62, 118 + G.pulse * 10, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, 62, 82 + G.pulse * 6, 0, TAU); ctx.stroke();
    }
  }

  function gearOutline(r, teeth) {
    ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const rr = i % 2 ? r * 0.79 : r;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function roman(n) { return ["I", "II", "III", "IV"][n - 1] || "IV"; }
  function fmtTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${ss < 10 ? "0" : ""}${ss}`;
  }

  function drawBackground() {
    const art = STAGE_ART[G.movement - 1] || STAGE_ART[0];
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, art.top);
    sky.addColorStop(0.58, "#050710");
    sky.addColorStop(1, art.bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const haze = ctx.createRadialGradient(W / 2, H * 0.38, 10, W / 2, H * 0.38, H * 0.66);
    haze.addColorStop(0, hexToRgba(art.haze, 0.09 + G.pulse * 0.035));
    haze.addColorStop(1, hexToRgba(art.haze, 0));
    ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H);

    // far stars (slow parallax)
    const tw = 0.6 + 0.4 * G.pulse;
    ctx.fillStyle = `rgba(220,235,255,${0.3 * tw})`;
    for (const s of stars) {
      s.y += s.v * STEP;
      if (s.y > H) { s.y = -2; s.x = rand(0, W); }
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    drawStageSilhouette();

    // the scrolling score: staff groups every 170 world-px
    const SPACING = 170;
    const first = Math.floor((G.scrollY - H) / SPACING);
    for (let gi = first; gi * SPACING < G.scrollY + SPACING; gi++) {
      const sy = H - (G.scrollY - gi * SPACING); // screen y of the staff top
      if (sy < -60 || sy > H + 60) continue;
      ctx.strokeStyle = hexToRgba(art.line, 0.075 + G.pulse * 0.045);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let li = 0; li < 5; li++) {
        ctx.moveTo(0, sy + li * 9);
        ctx.lineTo(W, sy + li * 9);
      }
      ctx.stroke();
      // bar line + occasional faint glyph, deterministic per staff index
      const h1 = hash01(gi * 7 + 1);
      if (h1 > 0.4) {
        const gx = 40 + hash01(gi * 13 + 5) * (W - 80);
        ctx.fillStyle = `rgba(255,46,136,${0.1 + h1 * 0.08})`;
        ctx.font = "26px serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(["♩", "♪", "𝄞", "𝄢", "♫"][Math.floor(hash01(gi * 3 + 2) * 5)], gx, sy + 18);
      }
      ctx.strokeStyle = "rgba(46,224,255,0.08)";
      ctx.beginPath();
      const bx = hash01(gi * 17 + 9) * W;
      ctx.moveTo(bx, sy); ctx.lineTo(bx, sy + 36);
      ctx.stroke();
    }

    // Speed filaments sell forward motion without competing with bullets.
    ctx.strokeStyle = hexToRgba(art.line, 0.06);
    ctx.lineWidth = 1;
    const streakOff = (G.scrollY * 1.7) % 90;
    for (let i = 0; i < 12; i++) {
      const x = 34 + hash01(i * 91 + G.movement * 13) * (W - 68);
      const y = ((i * 73 + streakOff) % (H + 80)) - 40;
      const len = 12 + hash01(i * 41) * 38;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
    }
  }

  function draw() {
    applyRenderTransform();
    drawBackground();

    if (G.shake > 0.2) {
      ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
    }

    ctx.globalCompositeOperation = "lighter";

    // note pickups
    const noteImg = getNoteSprite();
    for (const g of G.gems) {
      if (g.heart) {
        drawGlow(g.x, g.y, 16, GREEN, 0.8);
        ctx.fillStyle = "rgba(4,13,10,0.85)"; ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(g.x, g.y, 9, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = GREEN; ctx.font = "700 12px 'JetBrains Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("+", g.x, g.y + 0.5);
      } else {
        const bob = Math.sin(g.t * 5) * 2;
        ctx.drawImage(noteImg, g.x - 15, g.y - 15 + bob);
        ctx.strokeStyle = hexToRgba(YELLOW, 0.45); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(g.x, g.y + bob, 9 + G.pulse * 2, 0, TAU); ctx.stroke();
      }
    }

    // shockwaves
    for (const s of G.shocks) {
      const shockCol = s.col || CYAN;
      const shockLife = s.max || 0.4;
      ctx.strokeStyle = hexToRgba(shockCol, Math.max(0, s.life / shockLife) * 0.9);
      ctx.lineWidth = shockCol === WHITE ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.stroke();
      if (shockCol === WHITE) {
        ctx.strokeStyle = hexToRgba(PINK, Math.max(0, s.life / shockLife) * 0.4);
        ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.82, 0, TAU); ctx.stroke();
      }
    }

    // player shots
    for (const s of G.shots) {
      if (s.kind === "lance") {
        const shotCol = s.cadenza ? WHITE : (s.col || PURPLE);
        ctx.strokeStyle = hexToRgba(shotCol, 0.96);
        ctx.lineWidth = s.pierce ? 5.5 : 3.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 18); ctx.lineTo(s.x, s.y - 12); ctx.stroke();
        ctx.strokeStyle = hexToRgba(CYAN, 0.48); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 22); ctx.lineTo(s.x, s.y - 15); ctx.stroke();
        drawGlow(s.x, s.y, s.pierce ? 15 : 10, shotCol, 0.82);
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(s.x, s.y - 12, 2.1, 0, TAU); ctx.fill();
      } else if (s.kind === "canon" || s.kind === "canon-note") {
        const shotCol = s.cadenza ? WHITE : (s.col || PINK);
        const px = s.px === undefined ? s.x : s.px;
        const py = s.py === undefined ? s.y + 8 : s.py;
        ctx.strokeStyle = hexToRgba(shotCol, 0.82); ctx.lineWidth = s.kind === "canon-note" ? 3 : 2.4;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(s.x, s.y); ctx.stroke();
        drawGlow(s.x, s.y, s.kind === "canon-note" ? 13 : 9, shotCol, 0.8);
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(s.x, s.y, s.kind === "canon-note" ? 3.2 : 2.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = hexToRgba(shotCol, 0.9); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.kind === "canon-note" ? 6 : 4.5, -0.4, Math.PI + 0.7); ctx.stroke();
      } else if (s.kind === "rail") {
        const shotCol = s.cadenza ? WHITE : (s.col || YELLOW);
        ctx.strokeStyle = hexToRgba(shotCol, 0.28); ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 34); ctx.lineTo(s.x, s.y - 25); ctx.stroke();
        ctx.strokeStyle = hexToRgba(shotCol, 0.98); ctx.lineWidth = 4.8;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 28); ctx.lineTo(s.x, s.y - 22); ctx.stroke();
        ctx.strokeStyle = WHITE; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 22); ctx.lineTo(s.x, s.y - 20); ctx.stroke();
        drawGlow(s.x, s.y, 16, shotCol, 0.88);
      } else if (s.kind === "baton") {
        const shotCol = s.cadenza ? WHITE : (s.col || YELLOW);
        ctx.strokeStyle = hexToRgba(shotCol, 0.9); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 10); ctx.lineTo(s.x, s.y - 7); ctx.stroke();
        ctx.save(); ctx.translate(s.x, s.y - 7); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = WHITE; ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
        drawGlow(s.x, s.y, 8, shotCol, 0.7);
      } else if (s.missile) {
        const shotCol = s.cadenza ? WHITE : YELLOW;
        ctx.strokeStyle = hexToRgba(shotCol, 0.9);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.px !== undefined ? s.px : s.x, s.py !== undefined ? s.py : s.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        drawGlow(s.x, s.y, s.cadenza ? 14 : 10, shotCol, 0.8);
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2);
        ctx.fillStyle = WHITE; ctx.strokeStyle = s.cadenza ? PINK : YELLOW; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      } else {
        const shotCol = s.cadenza ? WHITE : CYAN;
        ctx.strokeStyle = hexToRgba(shotCol, s.pierce ? 1 : 0.8);
        ctx.lineWidth = s.pierce ? 5 : s.cadenza ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 12);
        ctx.lineTo(s.x, s.y - 4);
        ctx.stroke();
        drawGlow(s.x, s.y, s.pierce ? 12 : s.cadenza ? 11 : 8, s.cadenza ? PINK : CYAN, 0.7);
        ctx.fillStyle = WHITE;
        ctx.beginPath(); ctx.arc(s.x, s.y - 4, s.pierce ? 2.4 : 1.6, 0, TAU); ctx.fill();
      }
    }

    ctx.globalCompositeOperation = "source-over";

    // enemies
    for (const e of G.enemies) drawEnemy(e);

    // diver telegraphs
    for (const e of G.enemies) {
      if (e.state === "align" && e.tele > 0) {
        ctx.strokeStyle = hexToRgba(RED, 0.2 + 0.3 * (1 - e.tele / beatDur()));
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x, H);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // conductor beams (vertical columns)
    for (const bm of G.beams) {
      if (bm.tele > 0) {
        ctx.strokeStyle = hexToRgba(PINK, 0.3 + 0.4 * (1 - bm.tele / beatDur()));
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hexToRgba(PINK, Math.min(1, bm.active * 3));
        ctx.lineWidth = 34;
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // enemy bullets
    ctx.globalCompositeOperation = "lighter";
    for (const b of G.bullets) {
      drawGlow(b.x, b.y, b.r * 3.2, b.col, 0.75);
      ctx.fillStyle = b.col;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(4,5,11,0.85)"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.2, b.y - b.r * 0.22, Math.max(1.3, b.r * 0.34), 0, TAU);
      ctx.fill();
    }

    // player
    drawPlayer();

    // particles
    for (const q of G.particles) {
      drawGlow(q.x, q.y, q.r * 3.4, q.col, (q.life / q.max) * 0.85);
    }
    ctx.globalCompositeOperation = "source-over";

    // floating texts
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of G.texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      ctx.font = `800 ${t.size}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = t.col;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    drawHUD();

    if (G.bossCue > 0) drawBossWarning();
    if (G.phase === "interlude") drawInterlude();
    if (G.phase === "sectionclear") drawSectionClear();
    if (G.phase === "paused") {
      ctx.fillStyle = "rgba(3,4,12,0.66)";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.fillStyle = WHITE;
      ctx.font = "800 28px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2 - 10);
      ctx.font = "600 13px 'JetBrains Mono', monospace";
      ctx.fillStyle = CYAN;
      ctx.fillText("press P to resume", W / 2, H / 2 + 22);
    }

    if (G.flashW > 0) {
      ctx.fillStyle = `rgba(235,245,255,${G.flashW * 0.5})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (G.flashR > 0) {
      ctx.fillStyle = `rgba(255,50,60,${G.flashR * 0.35})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    applyRenderTransform();
    ctx.drawImage(getVignette(), 0, 0);
  }

  function drawEnginePlumes(ship, p, flame) {
    ctx.globalCompositeOperation = "lighter";
    for (const ex of ship.engineX) {
      const width = ship.id === "virtuoso" ? 3.4 : 2.5;
      const plume = ctx.createLinearGradient(ex, 7, ex, 13 + flame);
      plume.addColorStop(0, "rgba(255,255,255,0.98)");
      plume.addColorStop(0.28, hexToRgba(ship.color, 0.94));
      plume.addColorStop(1, hexToRgba(ship.accent, 0));
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.moveTo(ex - width, 7); ctx.quadraticCurveTo(ex, 14 + flame, ex + width, 7); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawAriaShip(p) {
    ctx.fillStyle = "#091322"; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(0, -18); ctx.lineTo(5, -5); ctx.lineTo(19, 7); ctx.lineTo(18, 12);
    ctx.lineTo(7, 8); ctx.lineTo(4, 15); ctx.lineTo(-4, 15); ctx.lineTo(-7, 8);
    ctx.lineTo(-18, 12); ctx.lineTo(-19, 7); ctx.lineTo(-5, -5); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.fillStyle = WHITE; ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(5, -3); ctx.lineTo(3, 12); ctx.lineTo(-3, 12); ctx.lineTo(-5, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#b9d8e8";
    ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(-18, 8); ctx.lineTo(-7, 7); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(5, -2); ctx.lineTo(18, 8); ctx.lineTo(7, 7); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
    const podCol = p.groove >= 6 ? PINK : CYAN;
    ctx.fillStyle = podCol;
    for (const px of [-12, 12]) { ctx.fillRect(px - 2, 3, 4, 9); ctx.fillStyle = WHITE; ctx.fillRect(px - 1, 2, 2, 3); ctx.fillStyle = podCol; }
    const canopy = ctx.createLinearGradient(0, -10, 0, 5);
    canopy.addColorStop(0, "#e8ffff"); canopy.addColorStop(0.4, CYAN); canopy.addColorStop(1, "#075775");
    ctx.fillStyle = canopy; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(3.6, -3); ctx.lineTo(0, 3); ctx.lineTo(-3.6, -3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(0, 6.5, 1.6, 0, TAU); ctx.fill();
  }

  function drawVesperShip(p) {
    // A broad armored delta wrapped around one needle-like prism cannon.
    ctx.fillStyle = "#090916"; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -23); ctx.lineTo(8, -8); ctx.lineTo(24, 10); ctx.lineTo(13, 14);
    ctx.lineTo(5, 9); ctx.lineTo(0, 17); ctx.lineTo(-5, 9); ctx.lineTo(-13, 14); ctx.lineTo(-24, 10); ctx.lineTo(-8, -8); ctx.closePath(); ctx.stroke(); ctx.fill();
    const wing = ctx.createLinearGradient(-24, 0, 24, 0);
    wing.addColorStop(0, "#19112d"); wing.addColorStop(0.5, "#33205a"); wing.addColorStop(1, "#19112d");
    ctx.fillStyle = wing; ctx.strokeStyle = PURPLE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(22, 10); ctx.lineTo(8, 8); ctx.lineTo(0, 1); ctx.lineTo(-8, 8); ctx.lineTo(-22, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d9d6ff"; ctx.strokeStyle = CYAN;
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(5, -5); ctx.lineTo(3, 13); ctx.lineTo(-3, 13); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = PURPLE;
    for (const px of [-15, 15]) { roundRectPath(px - 3, 4, 6, 11, 2); ctx.fill(); ctx.strokeStyle = hexToRgba(CYAN, 0.7); ctx.stroke(); }
    const canopy = ctx.createLinearGradient(0, -14, 0, 4);
    canopy.addColorStop(0, WHITE); canopy.addColorStop(0.32, "#d8b8ff"); canopy.addColorStop(1, "#321c62");
    ctx.fillStyle = canopy; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(3.2, -4); ctx.lineTo(0, 3); ctx.lineTo(-3.2, -4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = hexToRgba(PURPLE, 0.45 + G.pulse * 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-20, 11); ctx.lineTo(-7, 3); ctx.moveTo(20, 11); ctx.lineTo(7, 3); ctx.stroke();
  }

  function drawCounterpointShip(p) {
    // Two independent fuselages exchange a luminous musical phrase across the bridge.
    ctx.strokeStyle = hexToRgba(WHITE, 0.42); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-11, 2); ctx.lineTo(11, 2); ctx.stroke();
    ctx.fillStyle = "#080b17"; ctx.strokeStyle = "rgba(0,0,0,0.82)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-11, -20); ctx.lineTo(-3, -3); ctx.lineTo(-3, 13); ctx.lineTo(-10, 16); ctx.lineTo(-18, 10); ctx.lineTo(-16, -5); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -20); ctx.lineTo(16, -5); ctx.lineTo(18, 10); ctx.lineTo(10, 16); ctx.lineTo(3, 13); ctx.lineTo(3, -3); ctx.closePath(); ctx.stroke(); ctx.fill();
    for (const side of [-1, 1]) {
      const col = side < 0 ? PINK : CYAN;
      ctx.fillStyle = side < 0 ? "#43152d" : "#0b4051"; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(side * 11, -19); ctx.lineTo(side * 15, -3); ctx.lineTo(side * 12, 13); ctx.lineTo(side * 6, 9); ctx.lineTo(side * 6, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = WHITE; ctx.beginPath(); ctx.ellipse(side * 11, -7, 2.2, 5.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(side * 16, 1); ctx.lineTo(side * 23, 10); ctx.lineTo(side * 15, 8); ctx.closePath(); ctx.fill();
    }
    drawGlow(0, 2, 9 + G.pulse * 4, p.groove >= 6 ? WHITE : PURPLE, 0.75);
    ctx.fillStyle = WHITE; ctx.strokeStyle = p.groove >= 6 ? YELLOW : PURPLE; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(0, 2, 3.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = hexToRgba(PINK, 0.45); ctx.beginPath(); ctx.arc(0, 2, 8 + G.pulse * 2, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.strokeStyle = hexToRgba(CYAN, 0.45); ctx.beginPath(); ctx.arc(0, 2, 8 + G.pulse * 2, Math.PI + 0.2, TAU - 0.2); ctx.stroke();
  }

  function drawVirtuosoShip(p) {
    // A ceremonial baton at the center of a gold, tuning-fork silhouette.
    ctx.save(); ctx.rotate(G.time * 0.35);
    ctx.strokeStyle = hexToRgba(YELLOW, 0.26 + G.pulse * 0.32); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 1, 22, 8, 0, 0, TAU); ctx.stroke(); ctx.restore();
    ctx.fillStyle = "#100e08"; ctx.strokeStyle = "rgba(0,0,0,0.86)"; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(0, -23); ctx.lineTo(6, -8); ctx.lineTo(20, 3); ctx.lineTo(16, 14); ctx.lineTo(7, 7); ctx.lineTo(4, 17); ctx.lineTo(-4, 17); ctx.lineTo(-7, 7); ctx.lineTo(-16, 14); ctx.lineTo(-20, 3); ctx.lineTo(-6, -8); ctx.closePath(); ctx.stroke(); ctx.fill();
    const gold = ctx.createLinearGradient(-18, 0, 18, 0);
    gold.addColorStop(0, "#6c4810"); gold.addColorStop(0.5, "#ffeaa1"); gold.addColorStop(1, "#6c4810");
    ctx.fillStyle = gold; ctx.strokeStyle = YELLOW; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(5, -5); ctx.lineTo(17, 4); ctx.lineTo(14, 10); ctx.lineTo(5, 4); ctx.lineTo(3, 15); ctx.lineTo(-3, 15); ctx.lineTo(-5, 4); ctx.lineTo(-14, 10); ctx.lineTo(-17, 4); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff8d7";
    ctx.beginPath(); ctx.moveTo(0, -23); ctx.lineTo(2.7, -7); ctx.lineTo(1.8, 11); ctx.lineTo(-1.8, 11); ctx.lineTo(-2.7, -7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#19160c"; ctx.strokeStyle = WHITE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, -4, 3.4, 6.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = YELLOW; ctx.beginPath(); ctx.arc(0, -5, 1.7 + G.pulse, 0, TAU); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.strokeStyle = hexToRgba(YELLOW, 0.68); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(side * 11, 2); ctx.lineTo(side * 18, -3); ctx.lineTo(side * 18, 7); ctx.stroke();
    }
  }

  function drawPlayer() {
    const p = G.p;
    const ship = currentShip();
    if (G.phase === "gameover") return;
    const blink = p.invulnT > 0 && Math.floor(p.invulnT * 12) % 2 === 0;
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      drawGlow(t.x, t.y + (p.trail.length - i) * 3, 4 + i * 0.6, ship.color, (i / p.trail.length) * 0.25);
    }
    if (blink) return;
    if (p.cadenzaT > 0) {
      const cadence = 0.5 + G.pulse * 0.5;
      ctx.globalCompositeOperation = "lighter";
      drawGlow(p.x, p.y, 48 + G.pulse * 10, WHITE, 0.34 + cadence * 0.16);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = hexToRgba(ship.accent, 0.48 + cadence * 0.24); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 27 + G.pulse * 4, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.cadenzaT / (beatDur() * CADENZA_BEATS), 0, 1)); ctx.stroke();
    } else if (p.grazeGlow > 0) {
      ctx.strokeStyle = hexToRgba(YELLOW, p.grazeGlow * 2.5); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 18 + (0.28 - p.grazeGlow) * 32, 0, TAU); ctx.stroke();
    }
    drawGlow(p.x, p.y, 29 + G.pulse * 9, ship.color, 0.72);
    ctx.save(); ctx.translate(p.x, p.y);
    const lean = p.trail.length > 2 ? clamp((p.x - p.trail[0].x) * 0.012, -0.2, 0.2) : 0;
    ctx.rotate(lean);
    const flame = 8 + Math.sin(G.time * 29) * 2 + p.groove * 0.45;
    drawEnginePlumes(ship, p, flame);
    if (ship.id === "vesper") drawVesperShip(p);
    else if (ship.id === "counterpoint") drawCounterpointShip(p);
    else if (ship.id === "virtuoso") drawVirtuosoShip(p);
    else drawAriaShip(p);
    if (p.groove >= 6) {
      ctx.strokeStyle = hexToRgba(ship.accent, 0.35 + G.pulse * 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 22 + G.pulse * 3, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.94)"; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill();
  }

  function drawEnemy(e) {
    const alpha = e.fade > 0 ? clamp(1 - e.fade, 0.15, 1) : 1;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(e.x, e.y, e.r * 2.1 + G.pulse * 5, e.col, 0.4 * alpha);
    if (e.muzzle > 0) {
      const ma = clamp(e.muzzle / 0.16, 0, 1);
      drawGlow(e.x, e.y, e.r * (2.3 + (1 - ma) * 1.6), WHITE, ma * 0.82);
      ctx.strokeStyle = hexToRgba(e.col === WHITE ? PINK : e.col, ma * 0.9);
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + (1 - ma) * 18, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = e.flash > 0 ? "#ffffff" : e.col;
    ctx.fillStyle = "#0a101c";

    if (e.boss) { drawBossBody(e); ctx.restore(); ctx.globalAlpha = 1; drawBossBar(e); return; }

    switch (e.type) {
      case "swooper": {
        ctx.rotate(Math.PI + Math.sin(e.t * 3 + e.phase) * 0.12);
        ctx.fillStyle = "#101728";
        ctx.beginPath();
        ctx.moveTo(0, -e.r * 1.25); ctx.lineTo(e.r * 0.36, -e.r * 0.05);
        ctx.lineTo(e.r * 1.15, e.r * 0.65); ctx.lineTo(e.r * 0.28, e.r * 0.42);
        ctx.lineTo(0, e.r * 0.85); ctx.lineTo(-e.r * 0.28, e.r * 0.42);
        ctx.lineTo(-e.r * 1.15, e.r * 0.65); ctx.lineTo(-e.r * 0.36, -e.r * 0.05);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = e.flash > 0 ? WHITE : e.col;
        ctx.beginPath(); ctx.moveTo(0, -e.r); ctx.lineTo(3.5, e.r * 0.28); ctx.lineTo(-3.5, e.r * 0.28); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#d9f8ff"; ctx.fillRect(-1.5, -e.r * 0.42, 3, 5);
        break;
      }
      case "drone": {
        ctx.rotate(e.spin * 0.2);
        ctx.fillStyle = "#111425";
        polygon(6, e.r, 0);
        ctx.strokeStyle = hexToRgba(e.col, 0.55); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-e.r * 1.25, 0); ctx.lineTo(e.r * 1.25, 0); ctx.stroke();
        for (const nx of [-e.r * 0.9, e.r * 0.9]) {
          ctx.fillStyle = "#060811"; ctx.beginPath(); ctx.arc(nx, 0, e.r * 0.38, 0, TAU); ctx.fill();
          ctx.strokeStyle = e.col; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.fillStyle = e.flash > 0 ? WHITE : e.col;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.34 + G.pulse * 1.5, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(-2, -2, e.r * 0.1, 0, TAU); ctx.fill();
        break;
      }
      case "turret":
        ctx.fillStyle = "#161329"; polygon(8, e.r, Math.PI / 8);
        ctx.fillStyle = hexToRgba(e.col, 0.32); polygon(4, e.r * 0.72, Math.PI / 4);
        ctx.fillStyle = "#080a12"; ctx.beginPath(); ctx.arc(0, 0, e.r * 0.48, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = e.flash > 0 ? "#fff" : hexToRgba(e.col, 0.9);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(e.aimA || 0) * (e.r + 7), Math.sin(e.aimA || 0) * (e.r + 7));
        ctx.stroke();
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.fill();
        break;
      case "tank":
        ctx.fillStyle = "#0b0d12";
        ctx.fillRect(-e.r * 1.05, -e.r * 0.76, e.r * 0.3, e.r * 1.52);
        ctx.fillRect(e.r * 0.75, -e.r * 0.76, e.r * 0.3, e.r * 1.52);
        ctx.fillStyle = "#20140f";
        roundRectPath(-e.r, -e.r * 0.7, e.r * 2, e.r * 1.4, 5);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = hexToRgba(e.col, 0.24);
        ctx.fillRect(-e.r * 0.55, -e.r * 0.5, e.r * 1.1, e.r);
        ctx.fillStyle = "#090b10";
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.5, 0, TAU);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = e.col; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, e.r * 1.25); ctx.stroke();
        ctx.fillStyle = WHITE; ctx.fillRect(-2, -2, 4, 4);
        break;
      case "diver": {
        ctx.rotate(Math.PI);
        ctx.fillStyle = "#1c0b16"; chevron(e.r);
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.moveTo(0, -e.r * 1.28); ctx.lineTo(3, e.r * 0.3); ctx.lineTo(-3, e.r * 0.3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = hexToRgba(e.col, 0.45); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-e.r * 0.75, e.r * 0.48); ctx.lineTo(-e.r * 1.15, e.r); ctx.moveTo(e.r * 0.75, e.r * 0.48); ctx.lineTo(e.r * 1.15, e.r); ctx.stroke();
        break;
      }
      case "splitter": {
        ctx.rotate(e.t * 0.65);
        ctx.fillStyle = "#07170f"; wobbleCircle(e.r, e.t);
        ctx.strokeStyle = hexToRgba(e.col, 0.6); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.58, 0, TAU); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4 + e.t;
          ctx.fillStyle = e.col; ctx.beginPath(); ctx.arc(Math.cos(a) * e.r * 0.62, Math.sin(a) * e.r * 0.62, 2.6, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
        break;
      }
      case "mini": {
        ctx.rotate(e.t * 1.4);
        ctx.fillStyle = "#07170f"; polygon(4, e.r, Math.PI / 4);
        ctx.fillStyle = e.col; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.fill();
        break;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (!e.boss && e.hp < e.maxHp && e.r >= 14) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x - 15, e.y - e.r - 10, 30, 4);
      ctx.fillStyle = e.col;
      ctx.fillRect(e.x - 15, e.y - e.r - 10, 30 * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  function polygon(n, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function wobbleCircle(r, t) {
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * TAU;
      const rr = r + Math.sin(a * 5 + t * 6) * 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function gearShape(r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = rot + (i / 16) * TAU;
      const rr = i % 2 ? r : r * 0.68;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function chevron(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(r * 0.9, r * 0.7);
    ctx.lineTo(0, r * 0.2);
    ctx.lineTo(-r * 0.9, r * 0.7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBossBody(e) {
    switch (e.btype) {
      case "timpanist": {
        // Armored flying drum kit: twin timpani, mallets and a beating core.
        ctx.rotate(Math.sin(e.t * 0.8) * 0.06);
        for (const sx of [-1, 1]) {
          ctx.save(); ctx.translate(sx * e.r * 0.82, 4);
          ctx.fillStyle = "#1c0b17";
          ctx.beginPath(); ctx.ellipse(0, 0, e.r * 0.5, e.r * 0.68, 0, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.fillStyle = hexToRgba(PINK, 0.28);
          ctx.beginPath(); ctx.ellipse(0, -e.r * 0.2, e.r * 0.42, e.r * 0.22, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = WHITE; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = "#090d18"; polygon(8, e.r * 0.72, Math.PI / 8);
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(0, 0, e.r * (0.25 + G.pulse * 0.05), 0, TAU); ctx.fill();
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(-4, -4, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#d5e8f5"; ctx.lineWidth = 4;
        const ma = 0.55 + Math.sin(e.t * 5) * 0.34;
        for (const sx of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(sx * 8, -12); ctx.lineTo(sx * Math.cos(ma) * e.r * 1.35, -Math.sin(ma) * e.r * 1.35); ctx.stroke();
          ctx.fillStyle = PINK; ctx.beginPath(); ctx.arc(sx * Math.cos(ma) * e.r * 1.35, -Math.sin(ma) * e.r * 1.35, 5, 0, TAU); ctx.fill();
        }
        break;
      }
      case "firstchair": {
        // A predatory violin-shaped interceptor, its bow tracking the player.
        const aim = Math.atan2(G.p.y - e.y, G.p.x - e.x) + Math.PI / 2;
        ctx.rotate(aim);
        ctx.fillStyle = "#120d20";
        ctx.beginPath();
        ctx.moveTo(0, -e.r * 1.35); ctx.bezierCurveTo(e.r * 0.25, -e.r * 0.65, e.r * 0.18, -e.r * 0.1, e.r * 0.6, e.r * 0.25);
        ctx.bezierCurveTo(e.r * 0.82, e.r * 0.55, e.r * 0.42, e.r, 0, e.r * 0.76);
        ctx.bezierCurveTo(-e.r * 0.42, e.r, -e.r * 0.82, e.r * 0.55, -e.r * 0.6, e.r * 0.25);
        ctx.bezierCurveTo(-e.r * 0.18, -e.r * 0.1, -e.r * 0.25, -e.r * 0.65, 0, -e.r * 1.35);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = hexToRgba(PURPLE, 0.36);
        ctx.beginPath(); ctx.ellipse(0, e.r * 0.24, e.r * 0.32, e.r * 0.5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = WHITE; ctx.lineWidth = 1;
        for (const x of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(x, -e.r); ctx.lineTo(x, e.r * 0.7); ctx.stroke(); }
        ctx.strokeStyle = PURPLE; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-e.r * 1.2, -e.r * 0.7); ctx.lineTo(e.r * 1.18, e.r * 0.82); ctx.stroke();
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(0, -e.r * 0.55, 3, 0, TAU); ctx.fill();
        break;
      }
      case "metronome": {
        // Cathedral clockwork with a pendulum that visibly marks the music.
        ctx.fillStyle = "#1b110a"; gearShape(e.r * 1.12, e.spin);
        ctx.strokeStyle = hexToRgba(ORANGE, 0.75); ctx.lineWidth = 2;
        ctx.fillStyle = "#0b0c12";
        ctx.beginPath(); ctx.moveTo(0, -e.r * 0.92); ctx.lineTo(e.r * 0.64, e.r * 0.82); ctx.lineTo(-e.r * 0.64, e.r * 0.82); ctx.closePath(); ctx.fill(); ctx.stroke();
        const pa = Math.sin(e.t * currentBpm() / 60 * Math.PI) * 0.68;
        ctx.save(); ctx.rotate(pa);
        ctx.strokeStyle = WHITE; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -e.r * 0.52); ctx.lineTo(0, e.r * 0.7); ctx.stroke();
        ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(0, e.r * 0.6, 7, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.fillStyle = YELLOW; ctx.beginPath(); ctx.arc(0, -e.r * 0.45, 5 + G.pulse * 2, 0, TAU); ctx.fill();
        for (const sx of [-1, 1]) { ctx.fillStyle = "#08090e"; ctx.beginPath(); ctx.arc(sx * e.r * 0.52, e.r * 0.55, 5, 0, TAU); ctx.fill(); ctx.stroke(); }
        break;
      }
      case "conductor": {
        // The figure from the poster: cloak, porcelain mask, crown and baton.
        ctx.strokeStyle = e.flash > 0 ? WHITE : PINK;
        ctx.lineWidth = 2;
        const wing = 0.18 + G.pulse * 0.08;
        ctx.fillStyle = "rgba(35,4,27,0.95)";
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sx * 8, -e.r * 0.15);
          ctx.quadraticCurveTo(sx * e.r * 1.45, -e.r * (0.95 + wing), sx * e.r * 1.7, e.r * 0.15);
          ctx.lineTo(sx * e.r * 0.62, e.r * 0.48);
          ctx.lineTo(sx * e.r * 1.28, e.r * 1.22);
          ctx.lineTo(sx * 5, e.r * 0.72);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = "#07060d";
        ctx.beginPath(); ctx.moveTo(0, -e.r * 0.78); ctx.lineTo(e.r * 0.68, e.r * 0.92); ctx.lineTo(0, e.r * 0.67); ctx.lineTo(-e.r * 0.68, e.r * 0.92); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e9eef2";
        ctx.beginPath(); ctx.ellipse(0, -e.r * 0.37, e.r * 0.34, e.r * 0.44, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.ellipse(-7, -e.r * 0.4, 3.3, 2.2, -0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(7, -e.r * 0.4, 3.3, 2.2, 0.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = PINK; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) { ctx.moveTo(i * 7, -e.r * 0.78); ctx.lineTo(i * 10, -e.r * (1.08 + (2 - Math.abs(i)) * 0.12)); }
        ctx.stroke();
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 3.5;
        const ba = e.spin * 2;
        ctx.beginPath();
        ctx.moveTo(10, -2);
        ctx.lineTo(10 + Math.cos(ba) * e.r * 1.65, -2 + Math.sin(ba) * e.r * 1.65);
        ctx.stroke();
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(10 + Math.cos(ba) * e.r * 1.65, -2 + Math.sin(ba) * e.r * 1.65, 3.5, 0, TAU); ctx.fill();
        break;
      }
    }
  }

  function drawBossBar(e) {
    const bw = W - 116, x = W / 2 - bw / 2;
    ctx.fillStyle = "rgba(2,3,9,0.82)";
    roundRectPath(x - 7, 7, bw + 14, 25, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.17)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRectPath(x, 13, bw, 8, 3); ctx.fill();
    const life = clamp(e.hp / e.maxHp, 0, 1);
    const bossCol = e.col === WHITE ? PINK : e.col;
    if (life > 0) {
      const bar = ctx.createLinearGradient(x, 0, x + bw, 0);
      bar.addColorStop(0, bossCol); bar.addColorStop(0.65, WHITE); bar.addColorStop(1, bossCol);
      ctx.fillStyle = bar; roundRectPath(x, 13, bw * life, 8, 3); ctx.fill();
    }
    for (let i = 1; i < 4; i++) {
      ctx.fillStyle = "rgba(0,0,0,0.48)"; ctx.fillRect(x + bw * i / 4 - 1, 13, 2, 8);
    }
    ctx.fillStyle = WHITE;
    ctx.font = "800 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${e.name}  //  ${Math.ceil(life * 100)}%`, W / 2, 38);
  }

  function drawHUD() {
    const p = G.p;
    if (G.phase === "title" || G.phase === "gameover" || G.phase === "win") return;

    // hearts + bombs, top-left
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "800 16px 'JetBrains Mono', monospace";
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? PINK : "rgba(255,255,255,0.14)";
      ctx.fillText("♥", 12 + i * 18, 18);
    }
    for (let i = 0; i < p.maxBombs; i++) {
      ctx.fillStyle = i < p.bombs ? YELLOW : "rgba(255,255,255,0.14)";
      ctx.fillText("𝄐", 12 + i * 18, 40);
    }

    // combo, top-right (below boss bar zone)
    if (G.combo > 1) {
      ctx.textAlign = "right";
      ctx.font = "800 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = YELLOW;
      ctx.fillText(`×${multiplier().toFixed(1)}`, W - 10, 56);
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(255,212,59,0.7)";
      ctx.fillText(`${G.combo} combo`, W - 10, 71);
    }
    if (G.grazes > 0) {
      ctx.textAlign = "right";
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(244,247,255,0.62)";
      ctx.fillText(`GRAZE ${G.grazes}`, W - 10, G.combo > 1 ? 86 : 58);
    }

    if (p.cadenzaT > 0) {
      const cadenzaFrac = clamp(p.cadenzaT / (beatDur() * CADENZA_BEATS), 0, 1);
      const cw = 120, cx0 = W / 2 - cw / 2;
      ctx.fillStyle = "rgba(2,4,10,0.76)"; roundRectPath(cx0 - 5, 48, cw + 10, 22, 6); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.11)"; roundRectPath(cx0, 62, cw, 3, 2); ctx.fill();
      const cg = ctx.createLinearGradient(cx0, 0, cx0 + cw, 0);
      cg.addColorStop(0, CYAN); cg.addColorStop(0.5, WHITE); cg.addColorStop(1, PINK);
      ctx.fillStyle = cg; roundRectPath(cx0, 62, cw * cadenzaFrac, 3, 2); ctx.fill();
      ctx.font = "800 10px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = WHITE; ctx.fillText("CADENZA", W / 2, 56);
    } else if (p.perfectChain > 0) {
      ctx.font = "800 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillStyle = YELLOW; ctx.fillText(`ACCENT ${p.perfectChain}/${CADENZA_PERFECTS}`, W / 2, 56);
    }

    // Movement progress: a quiet right-edge measure that becomes a warning rail.
    if (!G.bossActive) {
      const mv = MOVEMENTS[G.movement - 1];
      const progress = G.bossCue > 0 ? 1 : clamp(G.waveT / mv.dur, 0, 1);
      const px = W - 9, py = 112, pHeight = 228;
      ctx.fillStyle = "rgba(2,4,10,0.68)"; roundRectPath(px - 6, py - 7, 12, pHeight + 14, 5); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.09)"; ctx.fillRect(px - 2, py, 4, pHeight);
      const pcol = G.bossCue > 0 ? RED : progress > 0.78 ? YELLOW : CYAN;
      ctx.fillStyle = pcol; ctx.fillRect(px - 2, py + pHeight * (1 - progress), 4, pHeight * progress);
      ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(px, py - 1, 3, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(px - 10, py + pHeight / 2); ctx.rotate(-Math.PI / 2);
      ctx.font = "800 7px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = hexToRgba(pcol, 0.72);
      ctx.fillText(G.bossCue > 0 ? "LEADER INBOUND" : `MOVEMENT ${roman(G.movement)}`, 0, 0); ctx.restore();
    }

    // GROOVE METER — left edge, vertical pips + weapon name
    const gx = 14, gy0 = H - 60, ph = 16;
    ctx.fillStyle = "rgba(2,4,10,0.62)";
    roundRectPath(gx - 5, gy0 - (GROOVE_MAX - 1) * ph - 8, 20, GROOVE_MAX * ph + 12, 6); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < GROOVE_MAX; i++) {
      const lit = i < p.groove;
      const y = gy0 - i * ph;
      const pipCol = i >= 6 ? PINK : i >= 4 ? YELLOW : CYAN;
      ctx.fillStyle = lit ? pipCol : "rgba(255,255,255,0.075)";
      roundRectPath(gx, y, 10, ph - 4, 2); ctx.fill();
      if (lit) { ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(gx + 2, y + 2, 6, 2); }
    }
    // decay preview: top lit pip drains
    if (p.groove > 0) {
      const y = gy0 - (p.groove - 1) * ph;
      const frac = clamp(p.decayT / GROOVE_DECAY, 0, 1);
      ctx.fillStyle = "rgba(5,6,13,0.7)";
      ctx.fillRect(gx, y, 10, (ph - 4) * (1 - frac));
    }
    ctx.save();
    ctx.translate(gx + 22, gy0 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "800 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = p.groove >= 6 ? currentShip().accent : currentShip().color;
    ctx.fillText(weaponLevelName(p.groove), 0, 0);
    ctx.restore();

    // streak
    if (p.streak >= 2) {
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(46,224,255,0.75)";
      ctx.fillText(`streak ${p.streak}`, gx, gy0 + 26);
    }

    // METRONOME BAR — bottom center: ticks converge on the beat
    const mbW = 200, mbY = H - 16, cx = W / 2;
    ctx.fillStyle = "rgba(2,4,10,0.72)";
    roundRectPath(cx - mbW / 2 - 14, mbY - 13, mbW + 28, 26, 8); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - mbW / 2, mbY); ctx.lineTo(cx + mbW / 2, mbY);
    ctx.stroke();
    const beatDistance = Math.min(G.beatPhase, 1 - G.beatPhase);
    const off = clamp(beatDistance / 0.5, 0, 1) * (mbW / 2);
    const goodZone = TAP_WINDOW * mbW;
    const perfectZone = PERFECT_WINDOW * mbW;
    ctx.fillStyle = hexToRgba(CYAN, 0.1); ctx.fillRect(cx - goodZone, mbY - 8, goodZone * 2, 16);
    ctx.fillStyle = hexToRgba(YELLOW, 0.18); ctx.fillRect(cx - perfectZone, mbY - 9, perfectZone * 2, 18);
    ctx.fillStyle = CYAN;
    ctx.fillRect(cx - off - 1.5, mbY - 7, 3, 14);
    ctx.fillRect(cx + off - 1.5, mbY - 7, 3, 14);
    const on = beatDistance < TAP_WINDOW;
    const perfectNow = beatDistance < PERFECT_WINDOW;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(cx, mbY, perfectNow ? 21 : on ? 17 : 9, perfectNow ? YELLOW : on ? CYAN : "#3a4a66", on ? 0.95 : 0.45);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = WHITE;
    ctx.save();
    ctx.translate(cx, mbY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
    ctx.font = "800 8px 'JetBrains Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillStyle = perfectNow ? YELLOW : on ? CYAN : "rgba(255,255,255,0.32)";
    ctx.fillText(perfectNow ? "PERFECT" : on ? "HIT" : "BEAT", cx, mbY - 9);
  }

  function drawInterlude() {
    const mv = MOVEMENTS[G.movement - 1];
    const a = clamp(Math.min(G.ilT, 3.4 - G.ilT) * 1.4, 0, 1);
    ctx.fillStyle = "rgba(3,4,12,0.72)";
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = a;
    const art = STAGE_ART[G.movement - 1];
    ctx.strokeStyle = hexToRgba(art.line, 0.35 + G.pulse * 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(65, H / 2 - 92); ctx.lineTo(W - 65, H / 2 - 92); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(65, H / 2 + 83); ctx.lineTo(W - 65, H / 2 + 83); ctx.stroke();
    ctx.strokeStyle = hexToRgba(art.haze, 0.25);
    ctx.beginPath(); ctx.arc(W / 2, H / 2 - 14, 112 + G.pulse * 7, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2 - 14, 101 - G.pulse * 4, 0, TAU); ctx.stroke();
    ctx.fillStyle = hexToRgba(art.haze, 0.08);
    ctx.beginPath(); ctx.arc(W / 2, H / 2 - 14, 104, 0, TAU); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = art.haze;
    ctx.font = "800 13px 'JetBrains Mono', monospace";
    ctx.fillText(`REQUIEM // ${roman(G.movement)} OF IV`, W / 2, H / 2 - 68);
    ctx.fillStyle = WHITE;
    ctx.font = "800 21px 'JetBrains Mono', monospace";
    ctx.fillText(mv.name.replace(`MOVEMENT ${roman(G.movement)} — `, ""), W / 2, H / 2 - 35);
    ctx.fillStyle = art.line;
    ctx.font = "700 15px 'JetBrains Mono', monospace";
    ctx.fillText(mv.sub.toUpperCase(), W / 2, H / 2 - 8);
    ctx.fillStyle = "rgba(220,230,255,0.8)";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    wrapText(mv.story, W / 2, H / 2 + 27, W - 120, 16);
    const ship = currentShip();
    ctx.fillStyle = ship.color;
    ctx.font = "800 8px 'JetBrains Mono', monospace";
    ctx.fillText(`${ship.name} // ${ship.weapon} // ${Math.round(currentBpm())} BPM`, W / 2, H / 2 + 70);
    ctx.globalAlpha = 1;
  }

  function drawBossWarning() {
    const mv = MOVEMENTS[G.movement - 1];
    const boss = BOSSES[mv.boss];
    const beats = Math.max(1, Math.ceil(G.bossCue / beatDur()));
    const pulse = 0.68 + G.pulse * 0.32;
    const y = H * 0.37;
    ctx.fillStyle = "rgba(3,4,12,0.58)";
    ctx.fillRect(0, y - 64, W, 128);
    ctx.fillStyle = hexToRgba(RED, 0.1 + G.pulse * 0.08);
    ctx.fillRect(0, y - 62, W, 124);
    ctx.strokeStyle = hexToRgba(RED, pulse);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y - 62); ctx.lineTo(W, y - 62); ctx.moveTo(0, y + 62); ctx.lineTo(W, y + 62); ctx.stroke();
    for (let x = -30, stripe = 0; x < W + 30; x += 34, stripe++) {
      ctx.fillStyle = stripe % 2 ? "rgba(255,92,92,0.1)" : "rgba(255,255,255,0.045)";
      ctx.beginPath(); ctx.moveTo(x, y - 62); ctx.lineTo(x + 20, y - 62); ctx.lineTo(x - 8, y + 62); ctx.lineTo(x - 28, y + 62); ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = RED; ctx.font = "800 11px 'JetBrains Mono', monospace";
    ctx.fillText("SECTION LEADER APPROACHING", W / 2, y - 35);
    ctx.fillStyle = WHITE; ctx.font = "800 23px 'JetBrains Mono', monospace";
    ctx.fillText(boss.name, W / 2, y - 5);
    ctx.fillStyle = YELLOW; ctx.font = "800 12px 'JetBrains Mono', monospace";
    ctx.fillText(`${beats} ${beats === 1 ? "BEAT" : "BEATS"} TO DOWNBEAT`, W / 2, y + 31);
  }

  function drawSectionClear() {
    const r = G.sectionResult;
    if (!r) return;
    const a = clamp(Math.min(3.1 - G.sectionT, G.sectionT) * 2.2, 0, 1);
    const gradeCol = r.grade === "S" ? YELLOW : r.grade === "A" ? CYAN : r.grade === "B" ? GREEN : WHITE;
    ctx.fillStyle = "rgba(2,3,10,0.82)"; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = a;
    drawGlow(W / 2, H / 2 - 52, 122, gradeCol, 0.38);
    ctx.strokeStyle = hexToRgba(gradeCol, 0.42); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(W / 2, H / 2 - 52, 94 + G.pulse * 5, 0, TAU); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = CYAN; ctx.font = "800 10px 'JetBrains Mono', monospace";
    ctx.fillText(`MOVEMENT ${roman(r.movement)} // COMPLETE`, W / 2, H / 2 - 130);
    ctx.fillStyle = gradeCol; ctx.font = "800 82px 'Bungee', sans-serif";
    ctx.fillText(r.grade, W / 2, H / 2 - 52);
    ctx.fillStyle = WHITE; ctx.font = "800 13px 'JetBrains Mono', monospace";
    ctx.fillText(`SECTION BONUS  +${r.bonus.toLocaleString()}`, W / 2, H / 2 + 30);
    ctx.font = "700 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(225,235,248,0.76)";
    ctx.fillText(`${r.accuracy}% ON BEAT   //   ${r.perfect}% PERFECT   //   ${r.grazes} GRAZES`, W / 2, H / 2 + 58);
    ctx.fillStyle = r.noHit ? GREEN : "rgba(225,235,248,0.4)";
    ctx.fillText(r.noHit ? "NO-HIT CRESCENDO +750" : "SECTION DAMAGE RECORDED", W / 2, H / 2 + 79);
    ctx.globalAlpha = 1;
  }

  function wrapText(txt, x, y, maxW, lh) {
    const words = txt.split(" ");
    let line = "", yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w; yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  /* ============================================================
     HUD DOM
     ============================================================ */
  const $ = (id) => document.getElementById(id);
  const fullscreenShipLabels = document.querySelectorAll("[data-cres-side-ship]");
  const fullscreenWeaponLabels = document.querySelectorAll("[data-cres-side-weapon]");
  const fullscreenMovementLabels = document.querySelectorAll("[data-cres-side-movement]");
  const fullscreenTempoLabels = document.querySelectorAll("[data-cres-side-tempo]");
  let fullscreenArtKey = "";
  function syncFullscreenArt(shipOverride) {
    const ship = shipOverride || currentShip();
    const movement = MOVEMENTS[clamp((G && G.movement ? G.movement : 1) - 1, 0, MOVEMENTS.length - 1)];
    const bpm = Math.round(movement.bpm * ship.tempo);
    const key = `${ship.id}:${movement.roman}:${bpm}`;
    if (key === fullscreenArtKey) return;
    fullscreenArtKey = key;
    if (canvasWrap) {
      canvasWrap.dataset.cresShip = ship.id;
      canvasWrap.style.setProperty("--cres-ship-color", ship.color);
      canvasWrap.style.setProperty("--cres-ship-accent", ship.accent);
    }
    fullscreenShipLabels.forEach((label) => { label.textContent = ship.name; });
    fullscreenWeaponLabels.forEach((label) => { label.textContent = ship.weapon; });
    fullscreenMovementLabels.forEach((label) => { label.textContent = `MOVEMENT ${movement.roman}`; });
    fullscreenTempoLabels.forEach((label) => { label.textContent = `${bpm} BPM // RHYTHM LOCK`; });
  }
  const hudMove = $("hud-move"), hudTime = $("hud-time"), hudWeapon = $("hud-weapon"),
        hudScore = $("hud-score"), hudBest = $("hud-best");
  let hudTick = 0;
  function updateHUD(force) {
    if (!force && ++hudTick % 10 !== 0) return;
    if (hudMove) hudMove.textContent = `${roman(G.movement)}/IV · ${currentShip().name}`;
    if (hudTime) hudTime.textContent = fmtTime(G.runTime);
    if (hudWeapon) hudWeapon.textContent = G.p.cadenzaT > 0 ? `CADENZA · ${weaponLevelName(G.p.groove)}` : weaponLevelName(G.p.groove);
    if (hudScore) hudScore.textContent = G.score.toLocaleString();
    if (hudBest) hudBest.textContent = G.best.toLocaleString();
    syncFullscreenArt();
    if (metaUiDirty) {
      metaUiDirty = false;
      renderAchievements();
    }
  }

  /* ============================================================
     HANGAR + ACHIEVEMENT UI
     ============================================================ */
  const hangarCards = $("cres-hangar-cards"), hangarDetail = $("cres-hangar-detail"),
        achievementList = $("cres-achievements"), achievementSummary = $("cres-achievements-summary"),
        achievementToast = $("cres-achievement-toast"), achievementToastTitle = $("cres-achievement-toast-title"),
        achievementToastReward = $("cres-achievement-toast-reward");
  let hangarFocus = META.selectedShip;
  let achievementToastBusy = false;
  const achievementToastQueue = [];

  function shipIconSvg(ship) {
    const c = ship.color, a = ship.accent;
    if (ship.id === "vesper") return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 45 35 31 31 24 44 17 31 3 35Z" fill="#090916" stroke="${c}" stroke-width="2"/><path d="m24 4 5 27-5 10-5-10Z" fill="#f4f7ff" stroke="${a}"/><path d="m8 33 11-13 5 7-5 5Zm32 0L29 20l-5 7 5 5Z" fill="${c}" opacity=".55"/></svg>`;
    if (ship.id === "counterpoint") return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M11 7 20 20v19l-9 5-7-8 2-18Z" fill="#321326" stroke="${c}" stroke-width="2"/><path d="m37 7-9 13v19l9 5 7-8-2-18Z" fill="#083743" stroke="${a}" stroke-width="2"/><path d="M18 25h12" stroke="#f4f7ff" stroke-width="3"/><circle cx="24" cy="25" r="4" fill="#f4f7ff" stroke="#b46bff"/></svg>`;
    if (ship.id === "virtuoso") return `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="25" rx="20" ry="8" fill="none" stroke="${c}" opacity=".45"/><path d="M24 3 30 20 43 26 35 41 27 33 24 46 21 33 13 41 5 26l13-6Z" fill="#3a2a09" stroke="${c}" stroke-width="2"/><path d="m24 4 3 20-3 18-3-18Z" fill="#fff8d7"/><circle cx="24" cy="20" r="3" fill="${c}"/></svg>`;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 31 19 45 32 34 39 28 34 24 45 20 34 14 39 3 32l14-13Z" fill="#091322" stroke="${c}" stroke-width="2"/><path d="m24 5 5 18-5 16-5-16Z" fill="#f4f7ff" stroke="${c}"/><path d="m17 20-12 12 15-5m11-7 12 12-15-5" fill="#b9d8e8"/><circle cx="24" cy="19" r="3" fill="${c}"/></svg>`;
  }

  function renderHangar() {
    if (!hangarCards || !hangarDetail) return;
    if (!SHIPS[hangarFocus]) hangarFocus = META.selectedShip;
    hangarCards.innerHTML = SHIP_ORDER.map((id) => {
      const ship = SHIPS[id];
      const unlocked = !!META.unlocked[id];
      const selected = META.selectedShip === id;
      return `<button class="cres-ship-card${selected ? " is-selected" : ""}${unlocked ? "" : " is-locked"}" type="button" data-ship="${id}" aria-pressed="${selected}" aria-disabled="${!unlocked}" style="--ship-color:${ship.color}">
        <span class="cres-ship-card__icon">${shipIconSvg(ship)}</span>
        <span class="cres-ship-card__name">${ship.name}</span>
        <span class="cres-ship-card__state">${selected ? "SELECTED" : unlocked ? "READY" : "LOCKED"}</span>
      </button>`;
    }).join("");
    const ship = SHIPS[hangarFocus];
    const unlocked = !!META.unlocked[ship.id];
    const bpm = Math.round(MOVEMENTS[0].bpm * ship.tempo);
    hangarDetail.style.setProperty("--ship-color", ship.color);
    hangarDetail.innerHTML = `<strong>${ship.name} // ${ship.epithet}</strong><b>${bpm} BPM</b>
      <span>${ship.role}</span><b>${ship.weapon}</b>
      <p>${unlocked ? ship.description + " " + ship.mix + "." : "LOCKED — " + ship.unlock}</p>`;
  }

  function renderAchievements() {
    if (!achievementList || !achievementSummary) return;
    const earned = ACHIEVEMENTS.filter((a) => META.achievements[a.id]).length;
    const shipsReady = SHIP_ORDER.filter((id) => META.unlocked[id]).length;
    achievementSummary.textContent = `${earned}/${ACHIEVEMENTS.length} ovations · ${shipsReady}/${SHIP_ORDER.length} ships · ${META.lifetimeKills.toLocaleString()} lifetime kills · best PERFECT chain ${META.bestPerfectRun}`;
    achievementList.innerHTML = ACHIEVEMENTS.map((a) => {
      const done = !!META.achievements[a.id];
      const progress = achievementProgress(a);
      const pct = Math.round(clamp(progress.value / progress.goal, 0, 1) * 100);
      return `<article class="cres-achievement${done ? " is-earned" : ""}">
        <div class="cres-achievement__title">${a.title}</div>
        <div class="cres-achievement__desc">${a.desc}</div>
        <div class="cres-achievement__reward">${done ? "EARNED · " : ""}${a.reward}</div>
        <div class="cres-achievement__track"><div class="cres-achievement__fill" style="width:${pct}%"></div></div>
        <div class="cres-achievement__progress">${done ? "COMPLETE" : `${progress.value.toLocaleString()} / ${progress.goal.toLocaleString()}`}</div>
      </article>`;
    }).join("");
  }

  function renderMetaUI() {
    metaUiDirty = false;
    renderHangar();
    renderAchievements();
    syncFullscreenArt(SHIPS[META.selectedShip] || SHIPS.aria);
  }

  function selectShip(id) {
    const ship = SHIPS[id];
    if (!ship) return false;
    hangarFocus = id;
    if (!META.unlocked[id]) {
      renderHangar();
      if (window.RB && RB.toast) RB.toast(ship.unlock, "bad");
      return false;
    }
    META.selectedShip = id;
    saveMeta();
    if (G && G.phase === "title") {
      G.shipId = id;
      G.p = newPlayer(ship);
      updateHUD(true);
    }
    renderMetaUI();
    if (window.RB && RB.toast) RB.toast(`${ship.name} selected — ${ship.weapon}.`, "good");
    return true;
  }

  function showAchievementToast(a) {
    if (!a || !achievementToast) return;
    if (achievementToastBusy) { achievementToastQueue.push(a); return; }
    achievementToastBusy = true;
    achievementToastTitle.textContent = a.title;
    achievementToastReward.textContent = a.unlockShip ? `${a.reward} // available next run` : a.reward;
    achievementToast.classList.add("is-show");
    setTimeout(() => {
      achievementToast.classList.remove("is-show");
      setTimeout(() => {
        achievementToastBusy = false;
        const next = achievementToastQueue.shift();
        if (next) showAchievementToast(next);
      }, 240);
    }, 3200);
  }

  if (hangarCards) {
    hangarCards.addEventListener("click", (e) => {
      const card = e.target.closest("[data-ship]");
      if (card) selectShip(card.dataset.ship);
    });
  }

  /* ============================================================
     OVERLAY (DOM)
     ============================================================ */
  const overlay = $("overlay"), ovTitle = $("overlay-title"), ovSub = $("overlay-sub"),
        ovScore = $("overlay-score"), btnPrimary = $("btn-primary"), btnEncore = $("btn-encore");

  function showOverlay(title, sub, score, btnLabel, encoreLabel) {
    if (!overlay) return;
    ovTitle.textContent = title;
    ovSub.textContent = sub;
    ovScore.textContent = score || "";
    btnPrimary.textContent = btnLabel;
    if (btnEncore) {
      btnEncore.style.display = encoreLabel ? "" : "none";
      if (encoreLabel) btnEncore.textContent = encoreLabel;
    }
    hangarFocus = META.selectedShip;
    renderMetaUI();
    overlay.classList.add("overlay--show");
  }
  function hideOverlay() { if (overlay) overlay.classList.remove("overlay--show"); }

  function startInterlude() {
    G.phase = "interlude";
    G.ilT = 3.4;
  }

  function startGame() {
    const best = G ? G.best : 0;
    const muted = G ? G.muted : false;
    G = newGame();
    G.best = best;
    G.muted = muted;
    META.runs++;
    saveMeta();
    if (window.RB && RB.getHighScore) G.best = Math.max(G.best, RB.getHighScore(GAME_ID) || 0);
    hideOverlay();
    Audio.ensure();
    Audio.resume();
    Audio.setMuted(G.muted);
    G.intensity = MOVEMENTS[0].intensity;
    startInterlude();
    updateHUD(true);
  }

  function restartLevel() {
    if (!G || G.phase === "title") {
      startGame();
      return;
    }

    const checkpoint = G.sectionStart || captureSectionStart(G);
    const statKeys = [
      "score", "taps", "tapsHit", "perfectTaps", "grazes", "hitsTaken",
      "kills", "combo", "bestCombo", "bestStreak", "perfectRun", "bestPerfectRun",
    ];
    for (const key of statKeys) {
      if (Number.isFinite(checkpoint[key])) G[key] = checkpoint[key];
    }

    const playerStart = checkpoint.player || newPlayer(currentShip());
    G.p = {
      ...playerStart,
      fireCd: 0,
      tapCd: 0,
      invulnT: 1.25,
      cadenzaT: 0,
      perfectChain: 0,
      grazeGlow: 0,
      lastRailBeat: -1,
      trail: [],
    };
    G.waveT = 0;
    G.spawnCd = Number.isFinite(checkpoint.spawnCd) ? checkpoint.spawnCd : (G.movement === 1 ? 1.6 : 2.5);
    G.queue.length = 0;
    G.bossActive = false;
    G.bossCue = 0;
    G.enemies.length = 0;
    G.bullets.length = 0;
    G.shots.length = 0;
    G.gems.length = 0;
    G.particles.length = 0;
    G.shocks.length = 0;
    G.texts.length = 0;
    G.beams.length = 0;
    G.sectionStart = checkpoint;
    G.sectionResult = null;
    G.sectionT = 0;
    G.shake = 0;
    G.flashW = 0;
    G.flashR = 0;
    G.pulse = 0;
    G.pausedFrom = null;
    G.won = false;

    hideOverlay();
    Audio.ensure();
    Audio.resume();
    Audio.setMuted(G.muted);
    G.intensity = MOVEMENTS[G.movement - 1].intensity;
    startInterlude();
    updateHUD(true);
    requestAnimationFrame(() => canvas.focus({ preventScroll: true }));
    if (window.RB && RB.toast) RB.toast(`${MOVEMENTS[G.movement - 1].name} restarted.`, "good");
  }

  function returnToMainMenu() {
    const best = G ? G.best : 0;
    const muted = G ? G.muted : false;
    saveMeta();
    G = newGame();
    G.best = best;
    G.muted = muted;
    updateHUD(true);
    showOverlay(
      "𝄞 CRESCENDO",
      "Choose a Requiem craft. Move with WASD, auto-fire upward, and tap Space on the beat to raise its weapon.",
      "",
      "Begin the requiem",
      null
    );
    if (btnPrimary) btnPrimary.focus({ preventScroll: true });
  }

  function doEncore() {
    const finish = (granted) => {
      if (!granted) return;
      G.usedEncore = true;
      const p = G.p;
      p.hp = p.maxHp;
      p.invulnT = 2.5;
      p.bombs = Math.max(p.bombs, 1);
      clearBullets();
      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const e = G.enemies[i];
        if (!e.boss && dist2(e.x, e.y, p.x, p.y) < 220 * 220) {
          burst(e.x, e.y, e.col, 8, 140);
          G.enemies.splice(i, 1);
        }
      }
      hideOverlay();
      G.phase = "play";
      if (window.RB && RB.toast) RB.toast("Encore! The music swells back to life.", "good");
    };
    if (window.RB && RB.isAdFree && RB.isAdFree()) { finish(true); return; }
    if (window.RB && RB.showRewarded) RB.showRewarded().then(finish);
    else finish(true);
  }

  /* ============================================================
     INPUT
     ============================================================ */
  const keys = {};
  const touch = { active: false, id: null, lx: 0, ly: 0, dx: 0, dy: 0 };

  window.addEventListener("keydown", (e) => {
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "Space") tapBeat();
    if (e.code === "ShiftLeft" || e.code === "KeyB" || e.code === "KeyX") fireBomb();
    if (e.code === "KeyP") togglePause();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (W / rect.width),
      (e.clientY - rect.top) * (H / rect.height),
    ];
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (G.phase !== "play") return;
    if (e.pointerType === "touch") {
      // touch drags the ship 1:1 (relative), TAP button handles the beat
      if (!touch.active) {
        touch.active = true;
        touch.id = e.pointerId;
        const [x, y] = canvasPos(e);
        touch.lx = x; touch.ly = y;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    } else {
      tapBeat();
    }
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!touch.active || e.pointerId !== touch.id) return;
    const [x, y] = canvasPos(e);
    // relative 1:1 drag: move the ship by the finger delta
    G.p.x = clamp(G.p.x + (x - touch.lx) * 1.15, 16, W - 16);
    G.p.y = clamp(G.p.y + (y - touch.ly) * 1.15, 40, H - 24);
    touch.lx = x; touch.ly = y;
  });
  const endTouch = (e) => {
    if (touch.active && e.pointerId === touch.id) {
      touch.active = false; touch.dx = 0; touch.dy = 0;
    }
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  const tapBtn = $("cr-touch-tap");
  if (tapBtn) tapBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); tapBeat(); });
  const bombBtn = $("cr-touch-bomb");
  if (bombBtn) bombBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireBomb(); });

  function togglePause() {
    if (G.phase === "play") { G.pausedFrom = "play"; G.phase = "paused"; }
    else if (G.phase === "paused") { G.phase = G.pausedFrom || "play"; }
  }

  function bindFullscreen() {
    const fsBtn = $("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap");
    if (!fsBtn || !fsTarget || fsBtn.dataset.cresFullscreenBound === "true") return;
    fsBtn.dataset.cresFullscreenBound = "true";

    const nativeFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const updateButton = () => {
      const active = isMaxed();
      fsBtn.textContent = active ? "✕" : "⛶";
      fsBtn.setAttribute("aria-label", active ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", active ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("aria-pressed", String(active));
    };
    const setMaxed = (active) => {
      fsTarget.classList.toggle("is-maxed", active);
      document.body.classList.toggle("rb-game-maxed", active);
      updateButton();
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        if (active) canvas.focus({ preventScroll: true });
      });
    };

    fsBtn.addEventListener("click", () => {
      const active = !isMaxed();
      setMaxed(active);
      try {
        if (active) {
          const request = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
          const result = request && request.call(fsTarget);
          if (result && typeof result.catch === "function") result.catch(() => {});
        } else if (nativeFullscreenElement()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          const result = exit && exit.call(document);
          if (result && typeof result.catch === "function") result.catch(() => {});
        }
      } catch (_) {
        // The fixed-position max-screen mode remains available when native fullscreen is blocked.
      }
    });

    const syncNativeFullscreen = () => {
      if (!nativeFullscreenElement() && isMaxed()) setMaxed(false);
      else updateButton();
    };
    document.addEventListener("fullscreenchange", syncNativeFullscreen);
    document.addEventListener("webkitfullscreenchange", syncNativeFullscreen);
    updateButton();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G && G.phase === "play" && !window.__CRES_NO_AUTOPAUSE) {
      G.pausedFrom = "play";
      G.phase = "paused";
    }
  });

  // side-panel buttons
  if (btnPrimary) btnPrimary.addEventListener("click", () => startGame());
  if (btnEncore) btnEncore.addEventListener("click", () => doEncore());
  const btnPause = $("btn-pause");
  if (btnPause) btnPause.addEventListener("click", () => togglePause());
  const btnRestart = $("btn-restart");
  if (btnRestart) btnRestart.addEventListener("click", restartLevel);
  const btnMainMenu = $("btn-main-menu");
  if (btnMainMenu) btnMainMenu.addEventListener("click", returnToMainMenu);
  const btnSound = $("btn-sound");
  if (btnSound) {
    const saved = localStorage.getItem("rb_cres_sound");
    const applyLabel = () => {
      btnSound.textContent = G.muted ? "Sound Off" : "Sound On";
      btnSound.setAttribute("aria-pressed", String(!G.muted));
    };
    btnSound.addEventListener("click", () => {
      G.muted = !G.muted;
      localStorage.setItem("rb_cres_sound", G.muted ? "0" : "1");
      Audio.ensure();
      Audio.setMuted(G.muted);
      applyLabel();
    });
    setTimeout(() => { if (saved === "0") { G.muted = true; Audio.setMuted(true); } applyLabel(); }, 0);
  }
  bindFullscreen();
  window.addEventListener("resize", scheduleCanvasResolutionSync);
  scheduleCanvasResolutionSync();

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  G = newGame();
  if (window.RB && RB.getHighScore) G.best = RB.getHighScore(GAME_ID) || 0;
  updateHUD(true);
  renderMetaUI();
  window.addEventListener("beforeunload", saveMeta);

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 20) {
      simStep();
      acc -= STEP;
    }
    Audio.schedule();
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ============================================================
     DEBUG HOOK — drive the sim without rAF (see project notes)
     ============================================================ */
  window.__CRES = {
    get G() { return G; },
    step(n = 1) { for (let i = 0; i < n; i++) simStep(); },
    key(code, down) { keys[code] = !!down; },
    tap: tapBeat,
    bomb: fireBomb,
    start: startGame,
    restartLevel,
    menu: returnToMainMenu,
    render: draw,
    get resolution() { return { scale: renderScale, width: canvas.width, height: canvas.height }; },
    spawn: spawnEnemy,
    defeat(e) { if (e) damageEnemy(e, 999999); },
    pattern(name) { PATTERNS[name](); },
    boss(key) { return spawnBoss(key || MOVEMENTS[G.movement - 1].boss); },
    god() { G.p.hp = G.p.maxHp = 99; },
    skipWaves() { G.waveT = MOVEMENTS[G.movement - 1].dur; },
    groove(n) { G.p.groove = clamp(n, 0, GROOVE_MAX); },
    setPhase(ph) { G.phase = ph; },
    gamepad(gp) { padState.debug = gp || null; pollGamepad(gp || null); },
    sectionClear: beginSectionClear,
    alignBeat() { G.songStep = Math.floor(G.songStep / 4) * 4 + 0.1; G.beatPhase = (G.songStep / 4) % 1; },
    get meta() { return META; },
    ships: SHIPS,
    achievements: ACHIEVEMENTS,
    grantAchievement: unlockAchievement,
    selectShip,
    bpm: currentBpm,
    fireWeapon() { G.p.fireCd = 0; updatePlayer(); },
    win: winGame,
    hideOverlay, showOverlay,
    Audio,
  };
})();
