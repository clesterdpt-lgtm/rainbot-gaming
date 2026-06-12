/* ============================================
   DON'T LOOK AT THE GYM GIRL — v3 (THE REMAKE)
   --------------------------------------------
   Premise: get from the FRONT DOOR (left) to the
   LOCKER ROOM (right) without getting accused of
   being a pervert.

   What's new in v3:
   - 8 hand-built LEVELS. Each level adds more
     equipment (real obstacles: they block movement
     AND line of sight) and more girls.
   - THE NECK™: your gaze is magnetically pulled
     toward the nearest girl. The pull gets stronger
     every level. Fight it with the mouse.
   - CAUGHT IN 4K: sus only builds while YOU look.
     If she's looking back at you while you look,
     her notice meter ("?" → "!") fills — hold the
     mutual stare too long and she accuses you on
     the spot.
   - EYES CLOSED (hold SPACE): zero sus, but the
     screen goes dark, you walk slower, and bumping
     into a girl blind is an instant bust.

   Girl types:
   - lifter:     stationary, periodically turns
                 around to scan behind her
   - walker:     patrols waypoints
   - stepper:    stair-stepper at the wall, faces
                 away, HUGE gaze pull, quick
                 over-shoulder checks
   - scanner:    stationary, cone rotates 360°
   - influencer: ring light, very wide cone,
                 2× sus, periodically flips 180°

   Debug hook: window.__GYM
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // =========================================================================
  // 1. TUNING
  // =========================================================================
  const PLAYER_SPEED       = 138;
  const PLAYER_SPEED_BLIND = 80;     // eyes closed
  const PLAYER_RADIUS      = 11;
  const GIRL_RADIUS        = 12;

  const GAZE_RANGE      = 230;
  const GAZE_HALF_ANGLE = 0.5;

  const SUS_MAX        = 100;
  const SUS_DECAY      = 13;     // %/sec when not looking
  const SUS_DECAY_SHUT = 17;     // %/sec eyes closed
  const SUS_GAIN_BASE  = 19;     // %/sec, one girl, point blank
  const SUS_MUTUAL_MULT = 2.4;   // she sees you seeing her
  const SUS_BUMP       = 14;     // walked into a girl (eyes open)

  const NOTICE_TIME   = 1.15;    // sustained mutual stare → accused
  const NOTICE_DECAY  = 0.8;     // /sec when stare breaks

  const PULL_RANGE   = 280;      // the neck activates inside this radius
  const DRIFT_BASE   = 4.2;      // rad/s at point blank × level pull
  const ASSIST_RATE  = 2.3;      // rad/s, gaze eases back to mouse
  const SNAP_RATE    = 9.0;      // rad/s, when no girl in pull range

  const DOOR_Y0 = 250, DOOR_Y1 = 390;   // door bands on both walls

  // =========================================================================
  // 2. GIRL ARCHETYPES
  // =========================================================================
  const TYPES = {
    lifter:     { coneW: 0.55, range: 190, susMult: 1.0, pullW: 1.0, checkEvery: [4.5, 7.0], checkDur: 1.2 },
    walker:     { coneW: 0.60, range: 200, susMult: 1.0, pullW: 1.0 },
    stepper:    { coneW: 0.50, range: 200, susMult: 1.0, pullW: 1.7, checkEvery: [3.5, 6.0], checkDur: 0.8 },
    scanner:    { coneW: 0.60, range: 210, susMult: 1.0, pullW: 1.0, rotate: 0.65 },
    influencer: { coneW: 0.95, range: 240, susMult: 2.0, pullW: 1.35, flipEvery: [4.0, 6.5], flipDur: 2.0 }
  };

  // =========================================================================
  // 3. LEVELS — more obstacles, more girls, stronger neck every level
  //    Obstacles block movement AND line of sight (both ways — use as cover).
  //    kinds: rack, bench, tread, plant, fountain, cable, desk, ring
  // =========================================================================
  const LEVELS = [
    {
      name: "6 AM. DEAD.", sub: "One girl. She's at the rack, facing the mirror. She checks behind her sometimes.",
      pull: 0.22, girlSpeed: 0, phoneChance: 0.3,
      obstacles: [
        { x: 200, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 310, y: 430, w: 70, h: 40, kind: "bench" },
        { x: 520, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 500, y: 540, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "lifter", x: 320, y: 160, facing: -Math.PI / 2 }
      ]
    },
    {
      name: "MORNING REGULARS", sub: "Two now. One of them walks laps.",
      pull: 0.30, girlSpeed: 36, phoneChance: 0.4,
      obstacles: [
        { x: 140, y: 140, w: 56, h: 72, kind: "rack" },
        { x: 490, y: 140, w: 56, h: 72, kind: "rack" },
        { x: 330, y: 250, w: 70, h: 40, kind: "bench" },
        { x: 220, y: 470, w: 70, h: 40, kind: "bench" },
        { x: 64, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 340, y: 565, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "lifter", x: 490, y: 190, facing: Math.PI },
        { type: "walker", path: [[150, 350], [330, 350], [330, 520], [150, 520]] }
      ]
    },
    {
      name: "LEG DAY", sub: "Stair-steppers at the back wall. They face away. Your neck knows.",
      pull: 0.38, girlSpeed: 40, phoneChance: 0.5,
      obstacles: [
        { x: 450, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 520, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 150, y: 140, w: 56, h: 72, kind: "rack" },
        { x: 290, y: 300, w: 70, h: 40, kind: "bench" },
        { x: 160, y: 480, w: 70, h: 40, kind: "bench" },
        { x: 400, y: 520, w: 38, h: 38, kind: "plant" },
        { x: 80, y: 565, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "stepper", x: 450, y: 118, facing: -Math.PI / 2 },
        { type: "stepper", x: 520, y: 118, facing: -Math.PI / 2 },
        { type: "walker", path: [[210, 220], [380, 220], [380, 430], [210, 430]] }
      ]
    },
    {
      name: "INFLUENCER HOURS", sub: "She set up a ring light in the middle of the floor. Wide lens. Do not enter the frame.",
      pull: 0.45, girlSpeed: 44, phoneChance: 0.5,
      obstacles: [
        { x: 140, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 140, y: 520, w: 56, h: 72, kind: "rack" },
        { x: 270, y: 210, w: 70, h: 40, kind: "bench" },
        { x: 270, y: 470, w: 70, h: 40, kind: "bench" },
        { x: 520, y: 116, w: 44, h: 80, kind: "tread" },
        { x: 560, y: 545, w: 38, h: 38, kind: "plant" },
        { x: 430, y: 570, w: 66, h: 36, kind: "fountain" },
        { x: 380, y: 320, w: 16, h: 16, kind: "ring" }
      ],
      girls: [
        { type: "influencer", x: 336, y: 320, facing: 0 },
        { type: "lifter", x: 140, y: 172, facing: Math.PI / 2 },
        { type: "stepper", x: 520, y: 122, facing: -Math.PI / 2 },
        { type: "walker", path: [[200, 580], [560, 580], [560, 460], [200, 460]] }
      ]
    },
    {
      name: "LUNCH RUSH", sub: "Five girls. One of them just… slowly scans the whole room. Forever.",
      pull: 0.52, girlSpeed: 48, phoneChance: 0.6,
      obstacles: [
        { x: 120, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 520, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 230, y: 260, w: 70, h: 40, kind: "bench" },
        { x: 420, y: 260, w: 70, h: 40, kind: "bench" },
        { x: 230, y: 440, w: 70, h: 40, kind: "bench" },
        { x: 420, y: 440, w: 70, h: 40, kind: "bench" },
        { x: 320, y: 120, w: 84, h: 44, kind: "cable" },
        { x: 64, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 580, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 580, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "scanner", x: 320, y: 350, facing: 0 },
        { type: "lifter", x: 120, y: 182, facing: 0 },
        { type: "lifter", x: 520, y: 182, facing: Math.PI },
        { type: "walker", path: [[140, 540], [500, 540], [500, 500], [140, 500]] },
        { type: "walker", path: [[160, 200], [480, 200], [480, 330], [160, 330]] }
      ]
    },
    {
      name: "THE SQUAD ARRIVES", sub: "Six of them came together. They cross the floor in pairs. The neck pull is getting serious.",
      pull: 0.60, girlSpeed: 52, phoneChance: 0.65,
      obstacles: [
        { x: 130, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 510, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 320, y: 200, w: 70, h: 40, kind: "bench" },
        { x: 180, y: 320, w: 70, h: 40, kind: "bench" },
        { x: 460, y: 320, w: 70, h: 40, kind: "bench" },
        { x: 320, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 250, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 390, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 64, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 576, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 580, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "influencer", x: 320, y: 560, facing: -Math.PI / 2 },
        { type: "scanner", x: 320, y: 330, facing: 0 },
        { type: "stepper", x: 250, y: 118, facing: -Math.PI / 2 },
        { type: "lifter", x: 510, y: 172, facing: Math.PI / 2 },
        { type: "walker", path: [[120, 240], [120, 540], [240, 540], [240, 240]] },
        { type: "walker", path: [[540, 240], [540, 540], [410, 540], [410, 240]] }
      ]
    },
    {
      name: "FULL FLOOR", sub: "Seven girls. Two scanners. You are one head-turn from the group chat.",
      pull: 0.68, girlSpeed: 56, phoneChance: 0.7,
      obstacles: [
        { x: 120, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 520, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 320, y: 110, w: 84, h: 44, kind: "cable" },
        { x: 210, y: 240, w: 70, h: 40, kind: "bench" },
        { x: 430, y: 240, w: 70, h: 40, kind: "bench" },
        { x: 320, y: 350, w: 70, h: 40, kind: "bench" },
        { x: 210, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 430, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 150, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 490, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 64, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 580, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 590, w: 66, h: 36, kind: "fountain" }
      ],
      girls: [
        { type: "scanner", x: 230, y: 330, facing: 0 },
        { type: "scanner", x: 410, y: 330, facing: Math.PI },
        { type: "influencer", x: 320, y: 180, facing: Math.PI / 2 },
        { type: "stepper", x: 150, y: 560, facing: Math.PI / 2 },
        { type: "stepper", x: 490, y: 560, facing: Math.PI / 2 },
        { type: "walker", path: [[110, 220], [110, 520], [550, 520], [550, 220]] },
        { type: "walker", path: [[270, 540], [370, 540], [370, 410], [270, 410]] }
      ]
    },
    {
      name: "PEAK HOURS. 6 PM.", sub: "Eight girls. Bench maze. Max neck. Godspeed, soldier.",
      pull: 0.78, girlSpeed: 62, phoneChance: 0.8,
      obstacles: [
        { x: 110, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 530, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 320, y: 100, w: 84, h: 44, kind: "cable" },
        { x: 160, y: 250, w: 70, h: 40, kind: "bench" },
        { x: 320, y: 220, w: 70, h: 40, kind: "bench" },
        { x: 480, y: 250, w: 70, h: 40, kind: "bench" },
        { x: 240, y: 350, w: 70, h: 40, kind: "bench" },
        { x: 400, y: 350, w: 70, h: 40, kind: "bench" },
        { x: 160, y: 450, w: 70, h: 40, kind: "bench" },
        { x: 480, y: 450, w: 70, h: 40, kind: "bench" },
        { x: 250, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 390, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 64, y: 580, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 480, w: 16, h: 16, kind: "ring" }
      ],
      girls: [
        { type: "influencer", x: 320, y: 524, facing: -Math.PI / 2 },
        { type: "scanner", x: 320, y: 300, facing: 0 },
        { type: "scanner", x: 130, y: 350, facing: 0 },
        { type: "stepper", x: 250, y: 560, facing: Math.PI / 2 },
        { type: "stepper", x: 390, y: 560, facing: Math.PI / 2 },
        { type: "walker", path: [[100, 200], [560, 200], [560, 160], [100, 160]] },
        { type: "walker", path: [[120, 520], [120, 280], [220, 280], [220, 520]] },
        { type: "walker", path: [[540, 520], [540, 280], [440, 280], [440, 520]] }
      ]
    }
  ];

  const LEVEL_TOASTS = [
    "👀 Level 1 · 6 AM. One girl. Tutorial neck.",
    "💪 Level 2 · Two girls. One walks laps.",
    "🦵 Level 3 · Stair-steppers. Your neck has opinions.",
    "💡 Level 4 · Ring light deployed. 2× sus in her frame.",
    "🥗 Level 5 · Lunch rush. One girl scans the room forever.",
    "👯 Level 6 · The squad. They patrol in pairs.",
    "🔥 Level 7 · Full floor. Two scanners. Stay behind iron.",
    "💀 Level 8 · Peak hours. Max neck. See you on the other side."
  ];

  const SHAME_CAPTIONS = [
    "POV: the whole gym saw that.",
    "You're trending #3 in your local gym's group chat.",
    "Her boyfriend has 47k followers. You're his next post.",
    "She posted the clip. Your mom commented 'omg is that you??'",
    "The squat rack will be remembered. You will be remembered.",
    "The leggings won. The leggings always win.",
    "Job interview next week is gonna be a vibe.",
    "Your Hinge matches just got pruned.",
    "She tagged the gym. The gym tagged you back.",
    "Insurance claim filed. Cause of loss: one (1) head turn.",
    "Group chat notification: 'is this him???' × 47",
    "Front desk just voided your membership. And your dignity.",
    "The ring light caught everything. In 4K. At 60fps.",
    "Your neck wrote a check your reputation couldn't cash."
  ];

  const BUMP_LINES = [
    "💢 You literally walked into her.",
    "💢 'Watch it, creep.'",
    "💢 Body check. Not the good kind.",
    "💢 She dropped her shaker bottle. Everyone heard it."
  ];

  // =========================================================================
  // 4. STATE
  // =========================================================================
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    started: false,

    level: 1,
    levelT: 0,
    levelPeakSus: 0,
    score: 0,

    player: {
      x: 36, y: 320,
      facing: 0,        // actual gaze (after neck pull)
      desired: 0,       // where the mouse points
      dirX: 0, dirY: 0,
      moving: false,
      eyesClosed: false
    },

    sus: 0,
    fighting: false,    // neck pull currently strong
    pullTarget: null,   // girl the neck wants

    girls: [],
    obstacles: [],

    airpodT: 0,
    boyfriendT: 0,
    decoy: null,

    bustReason: null,   // "sus" | "caught" | "blindbump"

    cam: { shake: 0, flash: 0 },
    t: 0,
    lastTime: 0
  };

  // =========================================================================
  // 5. UTILITIES
  // =========================================================================
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const lerp = (a, b, t) => a + (b - a) * t;

  function normalizeAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function pointInRect(x, y, r) {
    return x >= r.x - r.w / 2 && x <= r.x + r.w / 2 &&
           y >= r.y - r.h / 2 && y <= r.y + r.h / 2;
  }

  // Line of sight between two points — blocked by any obstacle
  function losBlocked(ax, ay, bx, by) {
    const steps = 14;
    for (let i = 1; i < steps; i++) {
      const px = lerp(ax, bx, i / steps);
      const py = lerp(ay, by, i / steps);
      for (const o of state.obstacles) {
        if (pointInRect(px, py, o)) return true;
      }
    }
    return false;
  }

  // Circle-vs-rect collision for player movement (axis-separated)
  function collidesCircleRect(cx, cy, cr, r) {
    const nx = clamp(cx, r.x - r.w / 2, r.x + r.w / 2);
    const ny = clamp(cy, r.y - r.h / 2, r.y + r.h / 2);
    return dist(cx, cy, nx, ny) < cr;
  }

  function collidesAny(cx, cy, cr) {
    for (const o of state.obstacles) {
      if (collidesCircleRect(cx, cy, cr, o)) return true;
    }
    return false;
  }

  // =========================================================================
  // 6. AUDIO — tiny synthesized blips, no files
  // =========================================================================
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
  }
  function beep(freq, dur, type, gain, when) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + (when || 0);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch (e) {}
  }
  const sfx = {
    notice: () => beep(880, 0.09, "square", 0.05),
    alert:  () => { beep(660, 0.1, "square", 0.06); beep(990, 0.1, "square", 0.06, 0.1); },
    bust:   () => { beep(220, 0.3, "sawtooth", 0.08); beep(140, 0.45, "sawtooth", 0.08, 0.12); },
    level:  () => { beep(523, 0.1, "square", 0.05); beep(784, 0.14, "square", 0.05, 0.1); },
    win:    () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, "square", 0.05, i * 0.11)); },
    bump:   () => beep(180, 0.12, "sawtooth", 0.07)
  };

  // =========================================================================
  // 7. GIRL FACTORY
  // =========================================================================
  function makeGirl(def, lv) {
    const t = TYPES[def.type];
    const g = {
      type: def.type,
      x: def.x !== undefined ? def.x : def.path[0][0],
      y: def.y !== undefined ? def.y : def.path[0][1],
      facing: def.facing !== undefined ? def.facing : 0,
      baseFacing: def.facing !== undefined ? def.facing : 0,
      coneW: t.coneW,
      range: t.range,
      susMult: t.susMult,
      pullW: t.pullW,
      notice: 0,            // 0..NOTICE_TIME — mutual stare meter
      bumpCooldown: 0,

      // phone
      phoneActive: false,
      phoneT: 0,
      phoneCycle: rand(6, 11),

      // lifter / stepper checks
      checkT: def.type === "lifter" || def.type === "stepper" ? rand(t.checkEvery[0], t.checkEvery[1]) : 0,
      checking: false,
      checkDur: t.checkDur || 0,

      // scanner
      rotate: t.rotate || 0,

      // influencer
      flipT: def.type === "influencer" ? rand(t.flipEvery[0], t.flipEvery[1]) : 0,
      flipping: 0,          // remaining flip time
      flipped: false,

      // walker
      path: def.path || null,
      pathIdx: 1,
      speed: lv.girlSpeed,

      leggings: choice(["#ff2e88", "#e91e63", "#ff4081", "#d81b60", "#c2185b"]),
      label: choice(["YOGA PANTS", "LULLEMON", "LIFTO", "GAINS", "FLEX", "CUT", "BOOTY", "PR QUEEN"])
    };
    if (g.type === "influencer") g.label = "RING LIGHT";
    if (g.type === "scanner") g.label = "THE WATCHER";
    if (g.type === "stepper") g.label = "STAIRMASTER";
    return g;
  }

  // =========================================================================
  // 8. INPUT
  // =========================================================================
  const keys = {};
  let mouseCanvasX = W / 2;
  let mouseCanvasY = H / 2;

  function setLookTarget(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouseCanvasX = (clientX - rect.left) * (canvas.width / rect.width);
    mouseCanvasY = (clientY - rect.top) * (canvas.height / rect.height);
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener("mousemove", (e) => setLookTarget(e.clientX, e.clientY));
  canvas.addEventListener("mousedown", () => {
    canvas.focus();
    ensureAudio();
    if (!state.running && !state.gameOver && !state.won) startGame();
  });
  canvas.addEventListener("touchstart", (e) => {
    if (!e.touches.length) return;
    e.preventDefault();
    const touch = e.touches[e.touches.length - 1];
    setLookTarget(touch.clientX, touch.clientY);
    canvas.focus();
    ensureAudio();
    if (!state.running && !state.gameOver && !state.won) startGame();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    if (!e.touches.length) return;
    e.preventDefault();
    const touch = e.touches[e.touches.length - 1];
    setLookTarget(touch.clientX, touch.clientY);
  }, { passive: false });

  function bindTouchControls() {
    const dirMap = {
      up: "arrowup",
      down: "arrowdown",
      left: "arrowleft",
      right: "arrowright",
    };
    const setKey = (key, down) => {
      keys[key] = down;
      if (down) {
        canvas.focus();
        ensureAudio();
        if (!state.running && !state.gameOver && !state.won) startGame();
      }
    };

    document.querySelectorAll("[data-gym-dir]").forEach((button) => {
      const key = dirMap[button.dataset.gymDir];
      if (!key) return;
      const press = (event) => { event.preventDefault(); setKey(key, true); };
      const release = (event) => { event.preventDefault(); setKey(key, false); };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    });

    document.querySelectorAll("[data-gym-hold=\"eyes\"]").forEach((button) => {
      const press = (event) => { event.preventDefault(); setKey(" ", true); };
      const release = (event) => { event.preventDefault(); setKey(" ", false); };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    });
  }

  function readInput() {
    const p = state.player;
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      p.moving = true;
    } else {
      p.moving = false;
    }
    p.dirX = dx;
    p.dirY = dy;
    p.eyesClosed = !!keys[" "];

    const mdx = mouseCanvasX - p.x;
    const mdy = mouseCanvasY - p.y;
    if (mdx !== 0 || mdy !== 0) p.desired = Math.atan2(mdy, mdx);
  }

  // =========================================================================
  // 9. THE NECK™ — gaze drift toward the nearest girl
  // =========================================================================
  function updateGaze(dt) {
    const p = state.player;
    const lv = LEVELS[state.level - 1];

    // Find the strongest temptation in pull range
    let best = null, bestWeight = 0;
    for (const g of state.girls) {
      const d = dist(p.x, p.y, g.x, g.y);
      if (d > PULL_RANGE) continue;
      const w = (1 - d / PULL_RANGE) * g.pullW;
      if (w > bestWeight) { bestWeight = w; best = g; }
    }
    state.pullTarget = best;

    if (p.eyesClosed || state.airpodT > 0) {
      // Eyes shut or AirPods in: the neck loses. Gaze snaps to the mouse.
      p.facing += normalizeAngle(p.desired - p.facing) * Math.min(1, SNAP_RATE * dt);
      state.fighting = false;
      return;
    }

    if (!best) {
      // Nobody around — gaze follows the mouse snappily
      p.facing += normalizeAngle(p.desired - p.facing) * Math.min(1, SNAP_RATE * dt);
      state.fighting = false;
      return;
    }

    // 1) Willpower: ease toward the mouse
    const toDesired = normalizeAngle(p.desired - p.facing);
    p.facing += Math.sign(toDesired) * Math.min(Math.abs(toDesired), ASSIST_RATE * dt);

    // 2) The neck: drift toward her
    const girlAngle = Math.atan2(best.y - p.y, best.x - p.x);
    const toGirl = normalizeAngle(girlAngle - p.facing);
    const driftRate = bestWeight * lv.pull * DRIFT_BASE;
    p.facing += Math.sign(toGirl) * Math.min(Math.abs(toGirl), driftRate * dt);

    p.facing = normalizeAngle(p.facing);
    state.fighting = driftRate > ASSIST_RATE * 0.8;
  }

  // =========================================================================
  // 10. GIRL UPDATE
  // =========================================================================
  function updateGirl(g, lv, dt) {
    g.bumpCooldown = Math.max(0, g.bumpCooldown - dt);

    // Decoy overrides everything: all eyes on the dropped deadlift
    if (state.decoy) {
      const targetFacing = Math.atan2(state.decoy.y - g.y, state.decoy.x - g.x);
      const diff = normalizeAngle(targetFacing - g.facing);
      g.facing += Math.sign(diff) * Math.min(Math.abs(diff), 4.0 * dt);
      g.notice = Math.max(0, g.notice - NOTICE_DECAY * dt);
      return;
    }

    // Phone check (not influencers — they ARE the phone)
    if (g.type !== "influencer" && g.type !== "scanner") {
      if (!g.phoneActive) {
        g.phoneT += dt;
        if (g.phoneT > g.phoneCycle && Math.random() < lv.phoneChance) {
          g.phoneActive = true;
          g.phoneT = 0;
        }
      } else {
        g.phoneT += dt;
        if (g.phoneT > 2.0) {
          g.phoneActive = false;
          g.phoneT = 0;
          g.phoneCycle = rand(5, 10);
        }
      }
    }

    switch (g.type) {
      case "lifter":
      case "stepper": {
        // Periodic over-the-shoulder check: facing flips 180°
        g.checkT -= dt;
        if (g.checkT <= 0) {
          if (!g.checking) {
            g.checking = true;
            g.checkT = g.checkDur;
            g.facing = normalizeAngle(g.baseFacing + Math.PI);
          } else {
            g.checking = false;
            const t = TYPES[g.type];
            g.checkT = rand(t.checkEvery[0], t.checkEvery[1]);
            g.facing = g.baseFacing;
          }
        }
        break;
      }
      case "scanner": {
        g.facing = normalizeAngle(g.facing + g.rotate * dt);
        break;
      }
      case "influencer": {
        if (g.flipping > 0) {
          g.flipping -= dt;
          if (g.flipping <= 0) {
            g.flipped = !g.flipped;
            g.facing = normalizeAngle(g.baseFacing + (g.flipped ? Math.PI : 0));
            const t = TYPES.influencer;
            g.flipT = rand(t.flipEvery[0], t.flipEvery[1]);
          }
        } else {
          g.flipT -= dt;
          if (g.flipT <= 0) g.flipping = 0.45;  // brief wind-up, then flip
        }
        break;
      }
      case "walker": {
        const target = g.path[g.pathIdx];
        const dx = target[0] - g.x;
        const dy = target[1] - g.y;
        const d = Math.hypot(dx, dy);
        if (d < 5) {
          g.pathIdx = (g.pathIdx + 1) % g.path.length;
        } else if (!g.phoneActive) {
          g.x += (dx / d) * g.speed * dt;
          g.y += (dy / d) * g.speed * dt;
          const targetFacing = Math.atan2(dy, dx);
          const diff = normalizeAngle(targetFacing - g.facing);
          g.facing += Math.sign(diff) * Math.min(Math.abs(diff), 3.0 * dt);
        }
        break;
      }
    }
  }

  // Is the player inside this girl's vision cone (and she can actually see)?
  function girlSeesPlayer(g) {
    if (g.phoneActive || state.decoy) return false;
    const p = state.player;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d > g.range) return false;
    const angle = Math.atan2(p.y - g.y, p.x - g.x);
    if (Math.abs(normalizeAngle(angle - g.facing)) > g.coneW) return false;
    return !losBlocked(g.x, g.y, p.x, p.y);
  }

  // Is this girl inside the player's gaze cone (and visible)?
  function playerSeesGirl(g) {
    const p = state.player;
    if (p.eyesClosed) return false;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d > GAZE_RANGE) return false;
    const angle = Math.atan2(g.y - p.y, g.x - p.x);
    if (Math.abs(normalizeAngle(angle - p.facing)) > GAZE_HALF_ANGLE) return false;
    return !losBlocked(p.x, p.y, g.x, g.y);
  }

  // =========================================================================
  // 11. SUS / NOTICE / BUST
  // =========================================================================
  function updateSus(dt) {
    const p = state.player;
    let gain = 0;
    let anyMutual = false;

    for (const g of state.girls) {
      const looking = playerSeesGirl(g);
      const seen = girlSeesPlayer(g);
      const mutual = looking && seen;

      if (looking) {
        const d = dist(p.x, p.y, g.x, g.y);
        const proximity = 0.35 + 0.65 * (1 - d / GAZE_RANGE);
        let mult = g.susMult * (g.phoneActive ? 0.5 : 1);
        if (mutual) mult *= SUS_MUTUAL_MULT;
        gain += SUS_GAIN_BASE * proximity * mult;
      }

      // Notice: she watches you watching her
      if (mutual && state.boyfriendT <= 0) {
        anyMutual = true;
        const before = g.notice;
        g.notice += dt;
        if (before < 0.15 && g.notice >= 0.15) sfx.notice();
        if (before < 0.65 && g.notice >= 0.65) { sfx.alert(); state.cam.shake = Math.max(state.cam.shake, 0.25); }
        if (g.notice >= NOTICE_TIME) {
          bust("caught");
          return;
        }
      } else {
        g.notice = Math.max(0, g.notice - NOTICE_DECAY * dt);
      }
    }

    if (state.boyfriendT > 0) {
      // Shield: sus frozen, slowly drains
      state.sus = Math.max(0, state.sus - SUS_DECAY * dt);
    } else if (gain > 0) {
      state.sus = Math.min(SUS_MAX, state.sus + gain * dt);
    } else {
      state.sus = Math.max(0, state.sus - (p.eyesClosed ? SUS_DECAY_SHUT : SUS_DECAY) * dt);
    }

    state.levelPeakSus = Math.max(state.levelPeakSus, state.sus);

    if (state.sus >= SUS_MAX && state.boyfriendT <= 0) {
      bust("sus");
    }
  }

  function updateBumps(dt) {
    const p = state.player;
    for (const g of state.girls) {
      const d = dist(p.x, p.y, g.x, g.y);
      const minD = PLAYER_RADIUS + GIRL_RADIUS;
      if (d < minD) {
        // Push the player out
        const ang = Math.atan2(p.y - g.y, p.x - g.x);
        p.x = g.x + Math.cos(ang) * minD;
        p.y = g.y + Math.sin(ang) * minD;

        if (g.bumpCooldown <= 0) {
          g.bumpCooldown = 1.2;
          if (p.eyesClosed) {
            bust("blindbump");
            return;
          }
          if (state.boyfriendT <= 0) {
            state.sus = Math.min(SUS_MAX, state.sus + SUS_BUMP);
            state.cam.shake = Math.max(state.cam.shake, 0.35);
            sfx.bump();
            RB.toast(choice(BUMP_LINES), "bad");
            if (state.sus >= SUS_MAX) { bust("sus"); return; }
          }
        }
      }
    }
  }

  // =========================================================================
  // 12. PLAYER MOVEMENT (real collision now)
  // =========================================================================
  function updatePlayer(dt) {
    const p = state.player;
    const speed = p.eyesClosed ? PLAYER_SPEED_BLIND : PLAYER_SPEED;

    // Axis-separated so you slide along equipment
    const nx = p.x + p.dirX * speed * dt;
    if (!collidesAny(nx, p.y, PLAYER_RADIUS)) p.x = nx;
    const ny = p.y + p.dirY * speed * dt;
    if (!collidesAny(p.x, ny, PLAYER_RADIUS)) p.y = ny;

    p.x = clamp(p.x, PLAYER_RADIUS, W - PLAYER_RADIUS);
    p.y = clamp(p.y, PLAYER_RADIUS, H - PLAYER_RADIUS);
  }

  function checkLevelProgress() {
    const p = state.player;
    // The locker room door: right wall, center band only
    if (p.x >= W - 22 && p.y >= DOOR_Y0 && p.y <= DOOR_Y1) {
      // Level score: speed + clean eyes
      const timeBonus = Math.max(0, Math.round(500 - state.levelT * 22));
      const cleanBonus = state.levelPeakSus < 30 ? 250 : state.levelPeakSus < 60 ? 100 : 0;
      const levelScore = 500 + timeBonus + cleanBonus;
      state.score += levelScore;

      if (state.level < LEVELS.length) {
        state.level++;
        loadLevel(state.level);
        sfx.level();
        showBanner("LEVEL " + state.level + " · " + LEVELS[state.level - 1].name, 2.0);
        RB.toast(LEVEL_TOASTS[state.level - 1] + "  (+" + levelScore + ")", "good");
        state.cam.flash = 0.25;
      } else {
        triggerWin();
      }
    }
  }

  // =========================================================================
  // 13. POWER-UPS (rewarded-ad economy, shared RB store)
  // =========================================================================
  function updatePowerTimers(dt) {
    if (state.airpodT > 0) state.airpodT -= dt;
    if (state.boyfriendT > 0) state.boyfriendT -= dt;
    if (state.decoy) {
      state.decoy.life -= dt;
      if (state.decoy.life <= 0) state.decoy = null;
    }
  }

  const DECOY_TARGETS = [
    { x: 320, y: 90 }, { x: 90, y: 320 }, { x: 550, y: 550 },
    { x: 90, y: 90 }, { x: 550, y: 90 }, { x: 320, y: 560 }
  ];

  let _rbPowerCache = { airpods: 0, boyfriend: 0, decoy: 0 };
  if (typeof RB !== "undefined" && RB.subscribe) {
    RB.subscribe((s) => { _rbPowerCache = s.powerups || _rbPowerCache; });
  }
  function readPowerCount(key) {
    if (_rbPowerCache[key] !== undefined) return _rbPowerCache[key];
    try {
      const raw = localStorage.getItem("ets_state_v1");
      if (raw) {
        const obj = JSON.parse(raw);
        return (obj.powerups && obj.powerups[key]) || 0;
      }
    } catch (e) {}
    return 0;
  }
  function updatePowerButtons() {
    document.querySelectorAll(".gym-power").forEach(btn => {
      const key = btn.dataset.power;
      const count = readPowerCount(key);
      const countEl = btn.querySelector(".gym-power__count");
      if (count > 0) {
        btn.dataset.empty = "false";
        countEl.textContent = "×" + count;
      } else {
        btn.dataset.empty = "true";
        countEl.textContent = "+AD";
      }
    });
  }
  function usePowerup(key) {
    const count = readPowerCount(key);
    if (count <= 0) { RB.toast("You don't have any of those. Watch an ad first.", "bad"); return; }
    if (!RB.consumePowerup(key)) { RB.toast("Couldn't use that. Try again.", "bad"); return; }
    if (key === "airpods") {
      state.airpodT = 8.0;
      RB.toast("🎧 Noise cancelling ON. The neck is silent for 8s.", "good");
    } else if (key === "boyfriend") {
      state.boyfriendT = 5.0;
      RB.toast("👔 'I'm her boyfriend.' Untouchable for 5s.", "good");
    } else if (key === "decoy") {
      const target = choice(DECOY_TARGETS);
      state.decoy = { x: target.x, y: target.y, life: 2.5, maxLife: 2.5 };
      RB.toast("🎭 Someone dropped a 405 deadlift. Everyone turns.", "good");
    }
    updatePowerButtons();
  }

  function renderPowerButtons() {
    const defs = [
      { key: "airpods",   icon: "🎧", label: "AirPods Max 2.0",   desc: "Neck disabled · 8s" },
      { key: "boyfriend", icon: "👔", label: "I'm Her Boyfriend", desc: "Sus frozen, can't get caught · 5s" },
      { key: "decoy",     icon: "🎭", label: "Dropped Deadlift",  desc: "Everyone turns · 2.5s" }
    ];
    document.getElementById("gym-powers").innerHTML = defs.map(d => `
      <button class="gym-power" data-power="${d.key}" data-empty="true" title="${d.desc} — watch a rewarded ad to earn one">
        <span>${d.icon}</span>
        <span>${d.label}</span>
        <span class="gym-power__count" data-count="${d.key}">+AD</span>
      </button>
    `).join("");
    document.querySelectorAll(".gym-power").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.power;
        if (btn.dataset.empty !== "true") { usePowerup(key); return; }
        const ok = await RB.showRewarded();
        if (ok) {
          RB.grantPowerup(key);
          RB.toast("Earned " + key + "!", "good");
          updatePowerButtons();
        } else {
          RB.toast("Watch the full ad to earn it", "bad");
        }
      });
    });
    updatePowerButtons();
    RB.subscribe(updatePowerButtons);
  }

  // =========================================================================
  // 14. GAME FLOW
  // =========================================================================
  function loadLevel(n) {
    const lv = LEVELS[n - 1];
    state.obstacles = lv.obstacles;
    state.girls = lv.girls.map(def => makeGirl(def, lv));
    state.player.x = 36;
    state.player.y = 320;
    state.levelT = 0;
    state.levelPeakSus = 0;
    state.sus = Math.max(0, state.sus - 40);  // partial mercy between levels
    state.decoy = null;
  }

  function startGame() {
    if (state.started) return;
    state.started = true;
    state.running = true;
    state.gameOver = false;
    state.won = false;
    state.level = 1;
    state.score = 0;
    state.sus = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.bustReason = null;
    loadLevel(1);
    state.t = 0;
    document.getElementById("overlay").classList.remove("overlay--show");
    showBanner("LEVEL 1 · " + LEVELS[0].name, 2.0);
    RB.toast(LEVEL_TOASTS[0], "");
  }

  function bust(reason) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    state.bustReason = reason;
    state.cam.shake = 0.8;
    state.cam.flash = 1.0;
    sfx.bust();
    showShameCard(reason);
  }

  function triggerWin() {
    state.won = true;
    state.running = false;
    state.cam.flash = 0.6;
    sfx.win();
    RB.recordScore("dont-look-gym-girl", state.score);
    showWinCard(state.score);
  }

  function restart() {
    document.getElementById("shame-mount").innerHTML = "";
    document.getElementById("gym-banner").style.display = "none";
    document.getElementById("overlay").classList.add("overlay--show");
    state.started = false;
    state.gameOver = false;
    state.won = false;
    state.running = false;
    state.level = 1;
    state.score = 0;
    state.sus = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.decoy = null;
    state.girls = [];
    state.obstacles = LEVELS[0].obstacles;
    state.player.x = 36;
    state.player.y = 320;
    state.t = 0;
  }

  // =========================================================================
  // 15. UI CARDS / BANNER
  // =========================================================================
  function showBanner(text, duration) {
    const b = document.getElementById("gym-banner");
    b.textContent = text;
    b.style.display = "block";
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "gymBannerFlash 0.5s steps(2) " + (duration || 1.2) + " forwards";
    setTimeout(() => { b.style.display = "none"; }, (duration || 1.2) * 1000);
  }

  const BUST_TITLES = {
    sus:       "📢 PUBLICLY SHAMED",
    caught:    "📸 CAUGHT IN 4K",
    blindbump: "💥 YOU WALKED INTO HER"
  };
  const BUST_SUBS = {
    sus:       "The vibes curdled. Security was called. There's a flyer with your face on it now.",
    caught:    "She watched you watch her. She narrated it to her phone. It's already posted.",
    blindbump: "You closed your eyes and walked directly into her. Incredible. Unprecedented."
  };

  function showShameCard(reason) {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const cap = choice(SHAME_CAPTIONS);
    document.getElementById("shame-mount").innerHTML = `
      <div class="shame-card">
        <h3 class="shame-card__title">${BUST_TITLES[reason] || BUST_TITLES.sus}</h3>
        <p class="shame-card__sub">${BUST_SUBS[reason] || BUST_SUBS.sus}</p>
        <div class="shame-card__stats">
          Level reached: <strong>${state.level}</strong>/${LEVELS.length} ·
          Run score: <strong>${state.score}</strong><br>
          High score: <strong>${Math.max(state.score, high)}</strong>
        </div>
        <div class="shame-card__caption">"${cap}"</div>
        <div class="shame-card__actions">
          <button class="btn btn--primary" id="shame-retry">Try again</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    document.getElementById("shame-retry").addEventListener("click", restart);
  }

  function showWinCard(score) {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const isNewHigh = score >= high;
    document.getElementById("shame-mount").innerHTML = `
      <div class="win-card">
        <h3 class="win-card__title">🚪 LOCKER ROOM. SANCTUARY.</h3>
        <p class="shame-card__sub">Eight levels. Peak hours. Ring lights, scanners, the stairmaster section — and not one accusation. Your neck fought. You won.</p>
        <div class="shame-card__stats">
          Levels cleared: <strong>${LEVELS.length}</strong>/${LEVELS.length}<br>
          Final score: <strong>${score}</strong> ${isNewHigh ? "🆕 NEW HIGH" : ""}
        </div>
        <div class="win-card__caption">"I was just here for the leg press. I saw nothing. I am nothing."</div>
        <div class="shame-card__actions">
          <button class="btn btn--primary" id="win-again">Run it back</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    document.getElementById("win-again").addEventListener("click", restart);
  }

  // =========================================================================
  // 16. RENDER
  // =========================================================================
  function drawGymFloor() {
    ctx.fillStyle = "#1a1a24";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const tile = 40;
    for (let x = 0; x <= W; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Front door (left, center band)
    ctx.fillStyle = "#2a3a2a";
    ctx.fillRect(0, DOOR_Y0, 16, DOOR_Y1 - DOOR_Y0);
    ctx.fillStyle = "#4dff7d";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText("FRONT", 4, DOOR_Y0 - 8);
    ctx.fillText("DOOR", 4, DOOR_Y1 + 16);

    // Locker room (right, center band) — pulsing arrow
    ctx.fillStyle = "#3a2a3a";
    ctx.fillRect(W - 16, DOOR_Y0, 16, DOOR_Y1 - DOOR_Y0);
    ctx.fillStyle = "#ff7ddf";
    ctx.textAlign = "right";
    ctx.fillText("LOCKER", W - 4, DOOR_Y0 - 8);
    ctx.fillText("ROOM", W - 4, DOOR_Y1 + 16);
    const pulse = 0.5 + 0.5 * Math.sin(state.t * 4);
    ctx.fillStyle = "rgba(255,125,223," + (0.3 + 0.4 * pulse) + ")";
    ctx.font = "18px Arial";
    ctx.fillText("→", W - 22, 326);
  }

  function drawObstacles() {
    for (const o of state.obstacles) {
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      ctx.save();
      switch (o.kind) {
        case "rack":
          ctx.fillStyle = "#3a2a3a";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#ff2e88";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          ctx.fillStyle = "#888";
          for (let i = 0; i < 3; i++) ctx.fillRect(x0 + 4, y0 + 12 + i * 16, o.w - 8, 3);
          break;
        case "bench":
          ctx.fillStyle = "#2a3a4a";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#2ee0ff";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          ctx.fillStyle = "#445";
          ctx.fillRect(x0 + 6, o.y - 4, o.w - 12, 8);
          break;
        case "tread": {
          ctx.fillStyle = "#22222e";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#888";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          // animated belt stripes
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          const off = (state.t * 40) % 14;
          for (let yy = y0 + 6 - off; yy < y0 + o.h - 4; yy += 14) {
            if (yy > y0 + 4) ctx.fillRect(x0 + 6, yy, o.w - 12, 3);
          }
          break;
        }
        case "plant":
          ctx.fillStyle = "#2a2418";
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.w / 2, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "#2e7d32";
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU + state.t * 0.2;
            ctx.beginPath();
            ctx.ellipse(o.x + Math.cos(a) * 7, o.y + Math.sin(a) * 7, 9, 4, a, 0, TAU);
            ctx.fill();
          }
          break;
        case "fountain":
          ctx.fillStyle = "#1a2a3a";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#4d9fff";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          ctx.fillStyle = "#4d9fff";
          ctx.font = "12px Arial";
          ctx.textAlign = "center";
          ctx.fillText("💧", o.x, o.y + 4);
          break;
        case "cable":
          ctx.fillStyle = "#2a2a3a";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#f7d716";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#666";
          ctx.beginPath();
          ctx.moveTo(x0 + 8, y0 + 6); ctx.lineTo(x0 + 8, y0 + o.h - 6);
          ctx.moveTo(x0 + o.w - 8, y0 + 6); ctx.lineTo(x0 + o.w - 8, y0 + o.h - 6);
          ctx.stroke();
          break;
        case "ring":
          // ring light — glowy
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 9, 0, TAU);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,200,0.25)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 12, 0, TAU);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  function drawGirlCone(g) {
    if (g.phoneActive || state.decoy) return;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.facing);
    const alarmed = g.notice > 0.15;
    const base = alarmed ? "255,60,60" : "255,46,136";
    const grad = ctx.createLinearGradient(0, 0, g.range, 0);
    grad.addColorStop(0, "rgba(" + base + ",0.30)");
    grad.addColorStop(1, "rgba(" + base + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, g.range, -g.coneW, g.coneW);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGirl(g) {
    ctx.save();
    ctx.translate(g.x, g.y);
    const legPulse = 1 + 0.08 * Math.sin(state.t * 3.2 + g.x);
    ctx.fillStyle = g.leggings;
    ctx.beginPath();
    ctx.ellipse(-6, 10 * legPulse, 5, 12 * legPulse, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 10 * legPulse, 5, 12 * legPulse, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -3, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, -14, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3a1a0a";
    ctx.beginPath();
    ctx.arc(0, -17, 6, Math.PI, 0);
    ctx.fill();

    if (g.phoneActive) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-5, -18, 10, 7);
      ctx.fillStyle = "#000";
      ctx.fillRect(-4, -17, 8, 5);
    }
    if (g.type === "influencer") {
      // phone on a stick, always
      ctx.fillStyle = "#fff";
      ctx.fillRect(10, -20, 7, 12);
      ctx.fillStyle = "#000";
      ctx.fillRect(11, -19, 5, 10);
    }

    // Notice indicator: "?" building, "!" about to accuse
    if (g.notice > 0.15) {
      const crit = g.notice > 0.65;
      ctx.fillStyle = crit ? "#ff3c3c" : "#f7d716";
      ctx.font = "bold " + (crit ? 20 : 15) + "px Arial";
      ctx.textAlign = "center";
      ctx.fillText(crit ? "!" : "?", 0, -28);
    }

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, 0, 30);
    ctx.restore();
  }

  function drawDecoy() {
    if (!state.decoy) return;
    const d = state.decoy;
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.6 * (d.life / d.maxLife);
    ctx.translate(d.x, d.y);
    ctx.fillStyle = "#2ee0ff";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0a0a14";
    ctx.font = "15px Arial";
    ctx.textAlign = "center";
    ctx.fillText("🏋️", 0, 5);
    ctx.restore();
  }

  function drawGazeCone() {
    const p = state.player;
    if (p.eyesClosed) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.facing);
    // Cone goes pink when the neck is winning
    const col = state.fighting ? "255,46,136" : "247,215,22";
    const grad = ctx.createLinearGradient(0, 0, GAZE_RANGE, 0);
    grad.addColorStop(0, "rgba(" + col + ",0.28)");
    grad.addColorStop(1, "rgba(" + col + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, GAZE_RANGE, -GAZE_HALF_ANGLE, GAZE_HALF_ANGLE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(" + col + ",0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(GAZE_RANGE, 0);
    ctx.stroke();
    ctx.restore();

    // Temptation tether: wobbly line from eyes to the girl the neck wants
    if (state.fighting && state.pullTarget && state.airpodT <= 0) {
      const g = state.pullTarget;
      ctx.save();
      ctx.strokeStyle = "rgba(255,46,136,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -state.t * 30;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const mx = (p.x + g.x) / 2 + Math.sin(state.t * 8) * 8;
      const my = (p.y + g.y) / 2 + Math.cos(state.t * 7) * 8;
      ctx.quadraticCurveTo(mx, my, g.x, g.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#2a1a0a";
    ctx.beginPath();
    ctx.arc(0, -3, PLAYER_RADIUS * 0.7, Math.PI, 0);
    ctx.fill();
    if (p.eyesClosed) {
      // closed eyes: little dashes
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      const ex = Math.cos(p.facing) * 4, ey = Math.sin(p.facing) * 4;
      ctx.beginPath();
      ctx.moveTo(ex - 3, ey); ctx.lineTo(ex + 3, ey);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#000";
      const ex = Math.cos(p.facing) * 4, ey = Math.sin(p.facing) * 4;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.5, 0, TAU);
      ctx.fill();
    }
    if (state.boyfriendT > 0) {
      ctx.strokeStyle = "rgba(46,224,255," + (0.5 + 0.5 * Math.sin(state.t * 10)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 5 + Math.sin(state.t * 10) * 2, 0, TAU);
      ctx.stroke();
    }
    if (state.airpodT > 0) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-PLAYER_RADIUS - 2, -4, 3, 7);
      ctx.fillRect(PLAYER_RADIUS - 1, -4, 3, 7);
    }
    ctx.restore();
  }

  function drawDarkness() {
    if (!state.player.eyesClosed) return;
    const p = state.player;
    ctx.save();
    const grad = ctx.createRadialGradient(p.x, p.y, 30, p.x, p.y, 110);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0.96)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "13px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("eyes closed. walking on vibes.", W / 2, 40);
    ctx.restore();
  }

  function drawHud() {
    // SUS bar
    const fill = document.getElementById("hud-sus-fill");
    const pct = document.getElementById("hud-sus-pct");
    if (fill) {
      fill.style.width = state.sus + "%";
      fill.dataset.zone = state.sus < 35 ? "ok" : state.sus < 70 ? "warn" : "crit";
    }
    if (pct) pct.textContent = Math.round(state.sus) + "%";

    // EYES state chip
    const eyes = document.getElementById("hud-eyes");
    if (eyes) {
      let label, zone;
      if (state.player.eyesClosed)      { label = "CLOSED";    zone = "shut"; }
      else if (state.airpodT > 0)       { label = "LOCKED 🎧"; zone = "ok"; }
      else if (state.fighting)          { label = "FIGHTING";  zone = "crit"; }
      else                              { label = "OPEN";      zone = "ok"; }
      eyes.textContent = label;
      eyes.dataset.zone = zone;
    }

    const lvEl = document.getElementById("hud-level");
    if (lvEl) lvEl.textContent = state.level + "/" + LEVELS.length;
    const distEl = document.getElementById("hud-dist");
    if (distEl) distEl.textContent = Math.floor((state.player.x / W) * 100) + "%";
    const scoreEl = document.getElementById("hud-score");
    if (scoreEl) scoreEl.textContent = state.score;
    const highEl = document.getElementById("hud-high");
    if (highEl) highEl.textContent = RB.getHighScore("dont-look-gym-girl") || 0;
  }

  function render() {
    let sx = 0, sy = 0;
    if (state.cam.shake > 0) {
      sx = (Math.random() - 0.5) * state.cam.shake * 14;
      sy = (Math.random() - 0.5) * state.cam.shake * 14;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawGymFloor();
    drawObstacles();
    for (const g of state.girls) drawGirlCone(g);
    drawDecoy();
    for (const g of state.girls) drawGirl(g);
    drawGazeCone();
    drawPlayer();
    drawDarkness();

    if (state.cam.flash > 0) {
      ctx.fillStyle = "rgba(255,46,136," + (state.cam.flash * 0.6) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();
    drawHud();
  }

  // =========================================================================
  // 17. MAIN LOOP
  // =========================================================================
  function loop(now) {
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.t += dt;

    if (state.running && !state.paused) {
      state.levelT += dt;
      readInput();
      updatePlayer(dt);
      updateGaze(dt);
      const lv = LEVELS[state.level - 1];
      for (const g of state.girls) updateGirl(g, lv, dt);
      updatePowerTimers(dt);
      if (!state.gameOver) updateSus(dt);
      if (!state.gameOver) updateBumps(dt);
      state.cam.shake = Math.max(0, state.cam.shake - dt * 2);
      state.cam.flash = Math.max(0, state.cam.flash - dt * 3);
      if (!state.gameOver && !state.won) checkLevelProgress();
    }

    render();
    requestAnimationFrame(loop);
  }

  // =========================================================================
  // 18. BOOT
  // =========================================================================
  function init() {
    state.obstacles = LEVELS[0].obstacles;
    requestAnimationFrame(loop);
    document.getElementById("btn-primary").addEventListener("click", () => { ensureAudio(); startGame(); });
    document.getElementById("btn-pause").addEventListener("click", () => {
      state.paused = !state.paused;
      document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
    });
    document.getElementById("btn-restart").addEventListener("click", restart);
    bindTouchControls();
    renderPowerButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Debug hook (same convention as window.__AGAIN)
  window.__GYM = { state, LEVELS, startGame, restart, bust, loadLevel };
})();
