/* ============================================
   ECHO LOOP — a time-loop echo puzzler
   - Small enclosed rooms. Press R to close the loop: the room rewinds
     and a translucent ECHO of your last run replays it forever.
   - Stand on your echoes, let them hold pressure plates, let them
     re-push crates every loop. A handful of past selves solve one puzzle.
   - Deterministic: fixed 60 Hz physics steps, echoes replay recorded
     position tracks exactly. No randomness in the simulation.
   - Canvas game. Debug hook: window.__ECHO
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "echo-loop";
  const W = 900;
  const H = 600;
  const TILE = 30;
  const COLS = 30;
  const ROWS = 20;

  // Physics (units are px per 60Hz step — the sim NEVER uses wall-clock time)
  const STEP_MS = 1000 / 60;
  const ECHO_FAST_FORWARD_MULT = 5;
  const MOVE = 3.0;       // player run speed
  const GRAV = 0.28;
  const JUMP_V = 7.8;     // jump height ≈ 108px ≈ 3.6 tiles
  const MAX_FALL = 9;
  const PUSH_SPEED = 1.6; // crate push speed (player)
  const ECHO_PUSH = 2.0;  // max px/step an echo can shove a crate
  const COYOTE = 5;       // steps of coyote time
  const JUMP_BUFFER = 6;  // steps of jump buffering

  const PW = 20, PH = 34; // player / echo AABB
  const CW = 28, CH = 28; // crate AABB

  // Brand palette (mirrors styles.css :root)
  const C = {
    ink: "#fbfaf4",
    dim: "#b6b3c9",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    purple: "#b06cff",
    good: "#6bff7d",
    bad: "#ff4f68",
    panel: "#131628",
    bg: "#080810",
  };
  // Echo tint: translucent, desaturated cyan so ghosts never read as "live"
  const ECHO_ALPHA = 0.42;
  const PAIR_COLORS = { 1: C.cyan, 2: C.yellow, 3: C.purple };

  const api =
    typeof RB !== "undefined"
      ? RB
      : {
          recordScore: () => false,
          getHighScore: () => 0,
          toast: () => {},
          showRewarded: () => Promise.resolve(true),
          isAdFree: () => false,
          grantPowerup: () => {},
          consumePowerup: () => false,
        };

  // ---------- Levels ----------
  // Grid legend: '#' solid  'S' spawn  'X' exit  'K' crate  '^' spikes
  //              '1','2','3' pressure plates → open doors 'A','B','C'
  const LEVELS = [
    {
      name: "FIRST CONTACT",
      sub: "One plate. One door. Two of you.",
      par: 2,
      maxLoops: 2,
      loopSec: 30,
      hint: { x: 150, y: 300, lines: ["Stand on the plate, then press R —", "the room rewinds and your ECHO", "replays that run forever."] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                 #          #",
        "#                 #          #",
        "#                 #          #",
        "#                 #          #",
        "#                 #          #",
        "#                 #          #",
        "#                 A          #",
        "#                 A          #",
        "#  1     S        A       X  #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "THE ASCENDING TOWER",
      sub: "No stairs. Your past selves ARE the stairs.",
      par: 3,
      maxLoops: 4,
      loopSec: 35,
      hint: { x: 320, y: 210, lines: ["Too high to jump. Stand somewhere useful,", "loop, then climb your own echoes.", "(The crate is a leg-up too...)"] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                         X  #",
        "#                      #######",
        "#                            #",
        "#                            #",
        "#                            #",
        "#  S       K                 #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "THE CREVASSE",
      sub: "Step from echo to echo across the void.",
      par: 3,
      maxLoops: 4,
      loopSec: 35,
      hint: { x: 260, y: 200, lines: ["The far ledge is too high from the pillars.", "Park an echo out there —", "then stack another on its shoulders."] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                         X  #",
        "#                    #########",
        "#  S                 #########",
        "#########            #########",
        "#########            #########",
        "#########            #########",
        "#########   ##  ##   #########",
        "#########   ##  ##   #########",
        "#########^^^##^^##^^^#########",
        "##############################",
      ],
    },
    {
      name: "HOLD THE LINE",
      sub: "Somebody has to stay behind. Luckily, it's you.",
      par: 3,
      maxLoops: 4,
      loopSec: 30,
      hint: { x: 300, y: 240, lines: ["Doors only stay open while their", "plate is held. Echoes make", "excellent doorstops."] },
      grid: [
        "##############################",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #         #        #",
        "#         #   2     #        #",
        "#         A   ##    B        #",
        "#         A         B        #",
        "#   1  S  A         B     X  #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "PARADOX ENGINE",
      sub: "Crates, plates, a tower and a deadline. All of you, together.",
      par: 3,
      maxLoops: 4,
      loopSec: 40,
      enemies: [{ type: "watcher", c: 20, r: 16, face: -1, range: 8, lockSteps: 52 }],
      hint: { x: 300, y: 210, lines: ["Crates rewind too — but your echo", "re-pushes them every single loop.", "Chain it all into one machine."] },
      grid: [
        "##############################",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #             #     #",
        "#        #   2         #     #",
        "#        #   #####     #     #",
        "#        #             #     #",
        "#        A             B     #",
        "#        A             B     #",
        "# S K    A  K          B   X #",
        "######1#######################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "COUNTERWEIGHT",
      sub: "Two doors, one corridor. Both plates. At the same time.",
      par: 3,
      maxLoops: 3,
      loopSec: 40,
      enemies: [{ type: "sweeper", c1: 8, c2: 21, floorRow: 17, period: 210 }],
      hint: { x: 420, y: 130, lines: ["The exit closet is double-gated.", "Take the high road to the far plate,", "leave a self on each one."] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                  2         #",
        "#                #######     #",
        "#                            #",
        "#          ###               #",
        "#                            #",
        "#                        #####",
        "#     ###                AB  #",
        "#                        AB  #",
        "# 1  S                   ABX #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "THE ELEVATOR",
      sub: "Nobody can climb that. But an echo makes an excellent trampoline.",
      par: 2,
      maxLoops: 2,
      loopSec: 40,
      enemies: [{ type: "watcher", c: 18, r: 16, face: -1, range: 8, lockSteps: 54 }],
      hint: { x: 420, y: 200, lines: ["Record yourself BOUNCING on the spot", "under the ledge. Then stand on your echo", "and jump off at the TOP of its arc."] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                        X   #",
        "#                   ##########",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#    S                       #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "FREIGHT CHAIN",
      sub: "Crates only fall. So make falling part of the plan.",
      par: 3,
      maxLoops: 3,
      loopSec: 45,
      enemies: [{ type: "sweeper", c1: 11, c2: 24, floorRow: 17, period: 220, phase: 45 }],
      hint: { x: 530, y: 200, lines: ["Shove the crate off its shelf,", "walk it to the far wall, and build", "a freight ramp: crate, echo, you."] },
      grid: [
        "##############################",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                    #",
        "#       #                 X  #",
        "#       #             ########",
        "#       #     K              #",
        "#       A   #####            #",
        "#       A                    #",
        "#  1 S  A                    #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "THE TURNSTILE",
      sub: "Three rooms deep. Each echo walks the doors the last one opened.",
      par: 4,
      maxLoops: 4,
      loopSec: 45,
      enemies: [
        { type: "watcher", c: 14, r: 16, face: -1, range: 4, lockSteps: 50 },
        { type: "watcher", c: 21, r: 16, face: -1, range: 4, lockSteps: 50, phase: 25 },
      ],
      hint: { x: 450, y: 200, lines: ["Plate 1 opens door 1. Plate 2 is", "BEHIND door 1. You see where", "this is going. Mind the spikes."] },
      grid: [
        "##############################",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        #      #      #     #",
        "#        A  2   B      C     #",
        "#        A  #   B      C     #",
        "#  1 S   A  #   B ^3^  C  X  #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "SCAFFOLD",
      sub: "Four selves, one scaffold. Commit each loop from the top of the last.",
      par: 4,
      maxLoops: 4,
      loopSec: 50,
      enemies: [
        { type: "watcher", c: 16, r: 16, face: -1, range: 8, lockSteps: 56 },
        { type: "sweeper", c1: 7, c2: 15, floorRow: 17, period: 240, phase: 80 },
      ],
      hint: { x: 330, y: 200, lines: ["Start on the pedestal.", "Stack an echo, stand on it, loop.", "Again. Again. Then climb your tower."] },
      grid: [
        "##############################",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                        X   #",
        "#                   ##########",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                            #",
        "#                ##          #",
        "#  S             ##          #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "RELAY LOCK",
      sub: "Two doors. Two holders. Build the handoff, then run the whole relay.",
      par: 3,
      maxLoops: 3,
      loopSec: 40,
      enemies: [{ type: "sweeper", c1: 14, c2: 20, floorRow: 17, period: 190, phase: 35 }],
      hint: { x: 330, y: 225, lines: ["Echo 1 holds plate 1.", "Echo 2 crosses door 1 and holds plate 2.", "Then your live self runs the relay."] },
      grid: [
        "##############################",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #       #",
        "#           #        #   X   #",
        "#           #        #~~~~~~~#",
        "#           A        B       #",
        "#           A        B       #",
        "#   S   1   A    2   B       #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "THE FERRY",
      sub: "The ferry departs on its own beat. Ride it twice.",
      par: 3,
      maxLoops: 3,
      loopSec: 45,
      enemies: [{ type: "watcher", c: 18, r: 16, face: -1, range: 5, lockSteps: 52 }],
      hint: { x: 320, y: 190, lines: ["Bounce beside the wall, loop, then ride:", "jump at the echo's apex to LAND ON TOP", "and hold the plate. Then ride again, and over."] },
      grid: [
        "##############################",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#                   #        #",
        "#              1    #        #",
        "#              #    #        #",
        "#              #    #        #",
        "#              #    #        #",
        "#              #    A        #",
        "#              #    A        #",
        "#   S          #    A     X  #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "TWO TOWERS",
      sub: "Exactly four loops. One step, one holder, one step, one climber.",
      par: 4,
      maxLoops: 4,
      loopSec: 50,
      enemies: [
        { type: "watcher", c: 15, r: 16, face: -1, range: 6, lockSteps: 50 },
        { type: "sweeper", c1: 10, c2: 15, floorRow: 17, period: 180, phase: 60 },
      ],
      hint: { x: 440, y: 220, lines: ["No spare loops this time.", "A stepping-stone at each tower,", "a plate-holder on the first. Go."] },
      grid: [
        "##############################",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#                #           #",
        "#      1         #    X      #",
        "#     ###        #   ###     #",
        "#     ###        A   ###     #",
        "#     ###        A   ###     #",
        "#  S  ###        A   ###     #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "CLOCKWORK",
      sub: "Crate, relay, stack, plate. Every door opens because a past self earns it.",
      par: 4,
      maxLoops: 4,
      loopSec: 55,
      enemies: [
        { type: "watcher", c: 13, r: 16, face: -1, range: 3, lockSteps: 54 },
        { type: "sweeper", c1: 16, c2: 23, floorRow: 17, period: 175, phase: 20 },
      ],
      hint: { x: 570, y: 235, lines: ["The crate holds plate 1.", "An echo crosses door 1 and holds plate 3.", "Stack another echo to reach plate 2, then exit."] },
      grid: [
        "##############################",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #          #   #",
        "#        #    #    2     #   #",
        "#        #    #   ####   #   #",
        "#        #    #          #   #",
        "#        A    C          B   #",
        "#        A    C          B   #",
        "# S K    A  3 C          B X #",
        "######1#######################",
        "##############################",
        "##############################",
      ],
    },
    {
      name: "BOOTSTRAP RELAY",
      sub: "Each echo is both a step and a key. Build the route, then climb your own solution.",
      par: 3,
      maxLoops: 3,
      loopSec: 40,
      enemies: [
        { type: "watcher", c: 15, r: 16, face: -1, range: 5, lockSteps: 48 },
        { type: "sweeper", c1: 19, c2: 24, floorRow: 17, period: 160, phase: 35 },
      ],
      hint: { x: 390, y: 225, lines: ["Park echo 1 at the first wall.", "Echo 2 stands on plate 3 at the second wall:", "it becomes your step AND holds the exit door."] },
      grid: [
        "##############################",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#                        #   #",
        "#        #       #       #   #",
        "#        #       #       C   #",
        "#        #       #       C   #",
        "# S      #      3#       C X #",
        "##############################",
        "##############################",
        "##############################",
      ],
    },
  ];

  // ---------- DOM ----------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnMainMenu = document.getElementById("btn-main-menu");
  const hudLevel = document.getElementById("hud-level");
  const hudTime = document.getElementById("hud-time");
  const hudLoops = document.getElementById("hud-loops");
  const hudScore = document.getElementById("hud-score");
  const hudBest = document.getElementById("hud-best");
  const btnLoop = document.getElementById("btn-loop");
  const btnRetry = document.getElementById("btn-retry");
  const btnUndo = document.getElementById("btn-undo");
  const btnRestart = document.getElementById("btn-restart");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");
  const btnFullscreen = document.getElementById("btn-fullscreen");

  // ---------- Sound (tiny synth bleeps) ----------
  const Sound = (() => {
    let ac = null;
    let muted = false;
    function ensure() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
      }
      if (ac && ac.state === "suspended") ac.resume();
    }
    function beep(freq, dur, type, vol, slide) {
      if (muted) return;
      ensure();
      if (!ac) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur + 0.02);
    }
    return {
      resume: ensure,
      jump: () => beep(300, 0.12, "square", 0.04, 260),
      commit: () => { beep(180, 0.3, "sawtooth", 0.05, -120); beep(520, 0.22, "sine", 0.04, 240); },
      retry: () => beep(240, 0.2, "sawtooth", 0.04, -160),
      plate: () => beep(660, 0.08, "square", 0.035),
      door: () => beep(140, 0.18, "square", 0.045, 60),
      death: () => beep(160, 0.35, "sawtooth", 0.06, -120),
      alert: () => beep(760, 0.09, "square", 0.032, 120),
      fire: () => beep(110, 0.12, "sawtooth", 0.045, -45),
      win: () => { beep(440, 0.12, "square", 0.05); setTimeout(() => beep(660, 0.12, "square", 0.05), 110); setTimeout(() => beep(880, 0.2, "square", 0.05), 220); },
      push: () => beep(90, 0.05, "triangle", 0.02),
      toggleMute() { muted = !muted; return muted; },
      get muted() { return muted; },
    };
  })();

  // ---------- State ----------
  let phase = "idle"; // idle | intro | play | paused | between | won
  let levelIdx = 0;
  let totalScore = 0;
  let bestAtStart = 0;

  // Parsed level (static per level)
  let grid = [];          // ROWS array of strings
  let spawn = { x: 0, y: 0 };
  let exitPos = { c: 0, r: 0 };
  let plates = [];        // {c, r, id}
  let doorCells = {};     // id -> [{c, r}]
  let cratesInit = [];    // {x, y}
  let maxLoops = 2;
  let loopSteps = 1800;

  // Per-loop world state
  const player = { x: 0, y: 0, vx: 0, vy: 0, face: 1, grounded: false, coyote: 0, jumpBuf: 0, standEcho: -1, walkDist: 0 };
  let crates = [];        // {x, y, vy}
  let enemies = [];       // deterministic Watchers and Sweepers
  let echoes = [];        // {xs:[], ys:[], fc:[], len}
  let rec = null;         // {xs:[], ys:[], fc:[]}
  let stepIdx = 0;        // steps since loop start
  let echoStepIdx = 0;    // independent playback cursor; F accelerates echoes only
  let platePressed = {};  // id -> bool
  let doorOpen = {};      // id -> bool
  let gateCells = [];     // 'T' timed-gate cells
  let gateWindow = null;  // [openSec, closeSec] or null
  let gateOpen = false;
  let levelTime = 0;      // seconds spent in level (all loops, for scoring)
  let renderTime = 0;     // cosmetic clock (not used by sim)
  let deathFlash = 0;
  let particles = [];     // cosmetic only

  // Input
  const keys = Object.create(null);
  const touch = Object.create(null);

  // ---------- Level parsing / loop reset ----------
  function loadLevel(idx) {
    levelIdx = idx;
    const L = LEVELS[idx];
    grid = L.grid;
    maxLoops = L.maxLoops;
    loopSteps = L.loopSec * 60;
    plates = [];
    doorCells = {};
    cratesInit = [];
    gateCells = [];
    gateWindow = L.gate || null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        if (ch === "S") spawn = { x: c * TILE + (TILE - PW) / 2, y: (r + 1) * TILE - PH };
        else if (ch === "X") exitPos = { c, r };
        else if (ch >= "1" && ch <= "3") plates.push({ c, r, id: Number(ch) });
        else if (ch >= "A" && ch <= "C") {
          const id = ch.charCodeAt(0) - 64;
          (doorCells[id] = doorCells[id] || []).push({ c, r });
        } else if (ch === "K") cratesInit.push({ x: c * TILE + (TILE - CW) / 2, y: (r + 1) * TILE - CH });
        else if (ch === "T") gateCells.push({ c, r });
      }
    }
    echoes = [];
    levelTime = 0;
    resetLoop();
  }

  function resetLoop() {
    player.x = spawn.x; player.y = spawn.y;
    player.vx = 0; player.vy = 0; player.face = 1;
    player.grounded = false; player.coyote = 0; player.jumpBuf = 0;
    player.standEcho = -1; player.walkDist = 0;
    crates = cratesInit.map((c) => ({ x: c.x, y: c.y, vy: 0 }));
    enemies = (LEVELS[levelIdx].enemies || []).map((def, index) => {
      if (def.type === "watcher") {
        return {
          ...def, index,
          x: (def.c + 0.5) * TILE,
          y: (def.r + 0.5) * TILE,
          rangePx: (def.range || 8) * TILE,
          lock: 0, cooldown: 0, targetKey: "", target: null,
          fireFlash: 0, fireTarget: null,
        };
      }
      return {
        ...def, index,
        x1: (def.c1 + 0.5) * TILE,
        x2: (def.c2 + 0.5) * TILE,
        y: def.floorRow * TILE - 11,
        x: (def.c1 + 0.5) * TILE,
      };
    });
    rec = { xs: [], ys: [], fc: [] };
    stepIdx = 0;
    echoStepIdx = 0;
    platePressed = {};
    doorOpen = {};
    gateOpen = computeGateOpen(0);
    particles = [];
    updatePlatesAndDoors();
  }

  function loopsUsed() { return echoes.length + 1; }
  function canCommit() { return echoes.length < maxLoops - 1; }

  function commitLoop() {
    if (phase !== "play") return;
    if (!canCommit()) {
      api.toast("No loop slots left — retry (Z) or undo an echo", "bad");
      return;
    }
    echoes.push({ xs: rec.xs, ys: rec.ys, fc: rec.fc, len: rec.xs.length });
    Sound.commit();
    spawnBurst(player.x + PW / 2, player.y + PH / 2, C.cyan, 18);
    api.toast(`Echo ${echoes.length} recorded — the room rewinds`, "good");
    resetLoop();
  }

  function retryLoop(silent) {
    if (phase !== "play" && phase !== "paused") return;
    const wasPaused = phase === "paused";
    Sound.retry();
    if (!silent) api.toast("Loop rewound — your echoes remember", "");
    resetLoop();
    if (wasPaused) resumeAfterPausedReset();
  }

  function restartLevel() {
    const wasPaused = phase === "paused";
    echoes = [];
    levelTime = 0;
    resetLoop();
    if (wasPaused) resumeAfterPausedReset();
    api.toast("Level restarted — all echoes cleared", "");
  }

  function resumeAfterPausedReset() {
    phase = "play";
    hideOverlay();
    btnPause.textContent = "Pause";
  }

  function doUndoEcho() {
    if (echoes.length === 0) return false;
    echoes.pop();
    resetLoop();
    api.toast(`Echo erased — ${echoes.length} left. Loop rewound.`, "good");
    return true;
  }

  function undoEcho() {
    if (phase !== "play") return;
    if (echoes.length === 0) {
      api.toast("No echoes to undo yet", "");
      return;
    }
    if (api.consumePowerup("echoloop-undo")) {
      doUndoEcho();
      return;
    }
    if (api.isAdFree()) {
      doUndoEcho();
      api.toast("Pro perk: free echo undo", "good");
      return;
    }
    // Rewarded ad grants a Chrono Shard, which we immediately spend
    const wasPlaying = phase === "play";
    if (wasPlaying) setPaused(true);
    api.showRewarded().then((ok) => {
      if (wasPlaying) setPaused(false);
      if (ok) {
        api.grantPowerup("echoloop-undo");
        api.consumePowerup("echoloop-undo");
        doUndoEcho();
      } else {
        api.toast("Ad skipped — echo stays", "bad");
      }
    });
  }

  // ---------- Collision helpers ----------
  function isSolidCell(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
    const ch = grid[r][c];
    if (ch === "#") return true;
    if (ch >= "A" && ch <= "C") return !doorOpen[ch.charCodeAt(0) - 64];
    if (ch === "T") return !gateOpen;
    return false;
  }

  // Timed gate: open only during its per-level [openSec, closeSec) window.
  // Pure function of the step index, so it rewinds with the loop.
  function computeGateOpen(step) {
    return !!(gateWindow && step >= gateWindow[0] * 60 && step < gateWindow[1] * 60);
  }

  // One-way platforms '~': land from above only, jump up through freely.
  // Returns the platform top the falling player should land on, or null.
  function oneWayLandY(x, prevBottom, newBottom) {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + PW - 0.01) / TILE);
    const r0 = Math.max(0, Math.floor((prevBottom - 4) / TILE));
    const r1 = Math.min(ROWS - 1, Math.floor(newBottom / TILE));
    for (let r = r0; r <= r1; r++) {
      const top = r * TILE;
      if (prevBottom <= top + 4 && newBottom >= top) {
        for (let c = c0; c <= c1; c++) {
          if (c >= 0 && c < COLS && grid[r][c] === "~") return top;
        }
      }
    }
    return null;
  }

  function rectHitsTiles(x, y, w, h) {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.01) / TILE);
    const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (isSolidCell(c, r)) return true;
    return false;
  }

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Move a crate horizontally, clamped by tiles and other crates. Returns actual dx.
  function crateMoveX(crate, dx) {
    if (dx === 0) return 0;
    let nx = crate.x + dx;
    // tiles
    if (rectHitsTiles(nx, crate.y, CW, CH)) {
      if (dx > 0) nx = Math.floor((nx + CW) / TILE) * TILE - CW;
      else nx = (Math.floor(nx / TILE) + 1) * TILE;
      // re-check in case of door cells (nx may still collide when clamped weirdly)
      if (rectHitsTiles(nx, crate.y, CW, CH)) nx = crate.x;
    }
    // other crates
    for (const other of crates) {
      if (other === crate) continue;
      if (overlap(nx, crate.y, CW, CH, other.x, other.y, CW, CH)) {
        nx = dx > 0 ? other.x - CW : other.x + CW;
      }
    }
    const moved = nx - crate.x;
    crate.x = nx;
    return moved;
  }

  function crateStep(crate) {
    crate.vy = Math.min(crate.vy + GRAV, MAX_FALL);
    let ny = crate.y + crate.vy;
    if (rectHitsTiles(crate.x, ny, CW, CH)) {
      if (crate.vy > 0) ny = Math.floor((ny + CH) / TILE) * TILE - CH;
      else ny = (Math.floor(ny / TILE) + 1) * TILE;
      crate.vy = 0;
    }
    for (const other of crates) {
      if (other === crate) continue;
      if (overlap(crate.x, ny, CW, CH, other.x, other.y, CW, CH)) {
        if (crate.vy >= 0) { ny = other.y - CH; crate.vy = 0; }
      }
    }
    crate.y = ny;
  }

  function echoPosAt(echo, step) {
    if (echo.len <= 0) return { x: spawn.x, y: spawn.y, f: 1 };
    const i = Math.max(0, Math.min(step, echo.len - 1));
    return { x: echo.xs[i], y: echo.ys[i], f: echo.fc[i] };
  }

  function maxEchoStep() {
    let max = 0;
    for (const echo of echoes) max = Math.max(max, Math.max(0, echo.len - 1));
    return max;
  }

  function isEchoFastForwarding() {
    return phase === "play" && !!(keys.ShiftLeft || keys.ShiftRight) && echoes.length > 0 && echoStepIdx < maxEchoStep();
  }

  function securityLineBlocked(x1, y1, x2, y2) {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const samples = Math.max(1, Math.ceil(distance / 8));
    for (let i = 2; i < samples; i++) {
      const t = i / samples;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      if (isSolidCell(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
      for (const crate of crates) {
        if (x >= crate.x && x <= crate.x + CW && y >= crate.y && y <= crate.y + CH) return true;
      }
    }
    return false;
  }

  function watcherTarget(enemy, echoNow) {
    const candidates = [];
    for (let i = 0; i < echoNow.length; i++) {
      const ep = echoNow[i];
      candidates.push({ key: `echo-${i}`, kind: "echo", x: ep.x + PW / 2, y: ep.y + PH / 2 });
    }
    candidates.push({ key: "live", kind: "live", x: player.x + PW / 2, y: player.y + PH / 2 });

    let best = null;
    let bestDistance = Infinity;
    const face = enemy.face || -1;
    const verticalBand = enemy.band || 48;
    for (const actor of candidates) {
      const dx = actor.x - enemy.x;
      const dy = actor.y - enemy.y;
      if (dx * face <= 6 || Math.abs(dx) > enemy.rangePx || Math.abs(dy) > verticalBand) continue;
      const distance = Math.hypot(dx, dy);
      if (distance >= bestDistance || securityLineBlocked(enemy.x, enemy.y, actor.x, actor.y)) continue;
      best = actor;
      bestDistance = distance;
    }
    return best;
  }

  function triangleWave(step, period, phaseOffset) {
    const p = Math.max(30, period || 180);
    const u = (((step + (phaseOffset || 0)) % p) + p) % p / p;
    return u < 0.5 ? u * 2 : 2 - u * 2;
  }

  // Returns true when security reset the current live run.
  function updateEnemies(echoNow) {
    for (const enemy of enemies) {
      if (enemy.type === "sweeper") {
        const t = triangleWave(stepIdx, enemy.period, enemy.phase);
        enemy.x = enemy.x1 + (enemy.x2 - enemy.x1) * t;
        if (overlap(player.x, player.y, PW, PH, enemy.x - 15, enemy.y - 5, 30, 10)) {
          die("⚠ Sweeper contact — live run rewound");
          return true;
        }
        continue;
      }

      if (enemy.fireFlash > 0) enemy.fireFlash--;
      if (enemy.cooldown > 0) {
        enemy.cooldown--;
        enemy.lock = 0;
        enemy.targetKey = "";
        enemy.target = null;
        continue;
      }

      const target = watcherTarget(enemy, echoNow);
      if (!target) {
        enemy.lock = Math.max(0, enemy.lock - 3);
        enemy.targetKey = "";
        enemy.target = null;
        continue;
      }

      if (enemy.targetKey !== target.key) {
        enemy.lock = 0;
        enemy.targetKey = target.key;
        Sound.alert();
      }
      enemy.target = target;
      enemy.lock++;

      if (enemy.lock >= (enemy.lockSteps || 48)) {
        enemy.fireFlash = 10;
        enemy.fireTarget = { x: target.x, y: target.y };
        enemy.cooldown = enemy.cooldownSteps || 84;
        enemy.lock = 0;
        enemy.targetKey = "";
        enemy.target = null;
        Sound.fire();
        if (target.kind === "live") {
          die("⚠ Watcher lock — use cover, jump, or bait it with an echo");
          return true;
        }
      }
    }
    return false;
  }

  // ---------- The deterministic physics step ----------
  function simStep() {
    stepIdx++;
    levelTime += 1 / 60;

    const echoPrevStep = echoStepIdx;
    const echoLimit = maxEchoStep();
    const echoAdvance = isEchoFastForwarding() ? ECHO_FAST_FORWARD_MULT : 1;
    echoStepIdx = Math.min(echoStepIdx + echoAdvance, echoLimit);

    // --- Timed gate (deterministic: driven purely by the loop clock) ---
    const wasGate = gateOpen;
    gateOpen = computeGateOpen(stepIdx);
    if (gateOpen !== wasGate && stepIdx > 1) Sound.door();

    // --- Echo playback positions (pure lookup — this is what makes replay exact) ---
    const echoNow = echoes.map((e) => echoPosAt(e, echoStepIdx));
    const echoPrev = echoes.map((e) => echoPosAt(e, echoPrevStep));

    // --- Echoes shove crates (deterministic: same tracks + same reset state) ---
    for (let i = 0; i < echoes.length; i++) {
      const echo = echoes[i];
      const last = Math.max(0, echo.len - 1);
      const from = Math.min(echoPrevStep, last);
      const to = Math.min(echoStepIdx, last);
      const samples = Math.max(1, to - from);
      for (let sample = 1; sample <= samples; sample++) {
        const echoStep = to > from ? from + sample : to;
        const ep = echoPosAt(echo, echoStep);
        for (const crate of crates) {
          if (overlap(ep.x + 2, ep.y + 4, PW - 4, PH - 4, crate.x, crate.y, CW, CH)) {
            const dir = crate.x + CW / 2 >= ep.x + PW / 2 ? 1 : -1;
            const want = dir > 0 ? ep.x + PW - crate.x : -(crate.x + CW - ep.x);
            const amt = Math.max(-ECHO_PUSH, Math.min(ECHO_PUSH, want));
            crateMoveX(crate, amt);
          }
        }
      }
    }

    // --- Riding an echo: follow its movement before input physics ---
    if (player.standEcho >= 0) {
      const i = player.standEcho;
      if (i >= echoes.length) {
        player.standEcho = -1;
      } else {
        const now = echoNow[i], prev = echoPrev[i];
        const stillOn =
          player.x + PW > prev.x + 3 && player.x < prev.x + PW - 3 &&
          Math.abs(player.y + PH - prev.y) < 12 && player.vy >= 0;
        if (stillOn) {
          player.x += now.x - prev.x;
          player.y = now.y - PH;
          player.vy = 0;
          player.grounded = true;
          player.coyote = COYOTE;
        } else {
          player.standEcho = -1;
        }
      }
    }

    // --- Input (sampled per step: deterministic w.r.t. step index) ---
    const left = keys.ArrowLeft || keys.KeyA || touch.left;
    const right = keys.ArrowRight || keys.KeyD || touch.right;
    const jumpHeld = keys.ArrowUp || keys.KeyW || keys.Space || touch.jump;

    player.vx = (right ? MOVE : 0) - (left ? MOVE : 0);
    if (player.vx !== 0) player.face = player.vx > 0 ? 1 : -1;

    if (jumpHeld && !player.jumpLatch) { player.jumpBuf = JUMP_BUFFER; player.jumpLatch = true; }
    if (!jumpHeld) player.jumpLatch = false;
    if (player.jumpBuf > 0) player.jumpBuf--;
    if (player.coyote > 0) player.coyote--;

    if (player.jumpBuf > 0 && (player.grounded || player.coyote > 0)) {
      player.vy = -JUMP_V;
      player.grounded = false;
      player.coyote = 0;
      player.jumpBuf = 0;
      player.standEcho = -1;
      Sound.jump();
    }

    // --- Horizontal move: tiles, then crates (with pushing) ---
    let nx = player.x + player.vx;
    if (rectHitsTiles(nx, player.y, PW, PH)) {
      if (player.vx > 0) nx = Math.floor((nx + PW) / TILE) * TILE - PW;
      else if (player.vx < 0) nx = (Math.floor(nx / TILE) + 1) * TILE;
      if (rectHitsTiles(nx, player.y, PW, PH)) nx = player.x;
    }
    for (const crate of crates) {
      if (overlap(nx, player.y, PW, PH, crate.x, crate.y, CW, CH)) {
        if (player.vx > 0) {
          const push = Math.min(PUSH_SPEED, nx + PW - crate.x);
          crateMoveX(crate, push);
          if (push > 0.2) Soundish();
          nx = Math.min(nx, crate.x - PW);
        } else if (player.vx < 0) {
          const push = Math.min(PUSH_SPEED, crate.x + CW - nx);
          crateMoveX(crate, -push);
          nx = Math.max(nx, crate.x + CW);
        } else {
          nx = player.x;
        }
      }
    }
    if (player.vx !== 0) player.walkDist += Math.abs(nx - player.x);
    player.x = nx;

    // --- Vertical move: gravity, tiles, crates, echo heads (one-way) ---
    player.vy = Math.min(player.vy + GRAV, MAX_FALL);
    const prevBottom = player.y + PH;
    let ny = player.y + player.vy;
    let landed = false;

    if (rectHitsTiles(player.x, ny, PW, PH)) {
      if (player.vy > 0) { ny = Math.floor((ny + PH) / TILE) * TILE - PH; landed = true; }
      else { ny = (Math.floor(ny / TILE) + 1) * TILE; }
      player.vy = 0;
    }
    for (const crate of crates) {
      if (overlap(player.x, ny, PW, PH, crate.x, crate.y, CW, CH)) {
        if (player.vy > 0 && prevBottom <= crate.y + 6) { ny = crate.y - PH; landed = true; player.vy = 0; }
        else if (player.vy < 0) { ny = crate.y + CH; player.vy = 0; }
      }
    }
    // One-way platforms '~': catch a falling player from above only
    if (player.vy > 0 && !landed) {
      const owTop = oneWayLandY(player.x, prevBottom, ny + PH);
      if (owTop !== null) { ny = owTop - PH; landed = true; player.vy = 0; }
    }
    // Echo heads: land from above only (never squeezed, never blocked sideways)
    if (player.vy >= 0 && player.standEcho < 0) {
      for (let i = 0; i < echoes.length; i++) {
        const ep = echoNow[i];
        const top = ep.y;
        if (
          player.x + PW > ep.x + 3 && player.x < ep.x + PW - 3 &&
          prevBottom <= top + 4 && ny + PH >= top
        ) {
          ny = top - PH;
          player.vy = 0;
          landed = true;
          player.standEcho = i;
          break;
        }
      }
    }
    player.y = ny;
    if (landed) { player.grounded = true; player.coyote = COYOTE; }
    else if (player.standEcho < 0) player.grounded = false;

    // --- Door squeeze: if a door closed on the player, shove them out ---
    if (rectHitsTiles(player.x, player.y, PW, PH)) {
      for (const off of [4, -4, 8, -8, 14, -14, 22, -22]) {
        if (!rectHitsTiles(player.x + off, player.y, PW, PH)) { player.x += off; break; }
      }
      if (rectHitsTiles(player.x, player.y, PW, PH)) { die(); return; }
    }

    // --- Crates fall ---
    for (const crate of crates) crateStep(crate);

    // --- Plates & doors ---
    updatePlatesAndDoors(echoNow);

    // --- Deterministic security hazards (only the live run can be reset) ---
    if (updateEnemies(echoNow)) return;

    // --- Record AFTER physics: echoes replay resolved positions exactly ---
    rec.xs.push(player.x);
    rec.ys.push(player.y);
    rec.fc.push(player.face);

    // --- Hazards ---
    if (player.y > H + 60) { die(); return; }
    const pc0 = Math.floor(player.x / TILE), pc1 = Math.floor((player.x + PW - 0.01) / TILE);
    const pr = Math.floor((player.y + PH - 6) / TILE);
    for (let c = pc0; c <= pc1; c++) {
      if (pr >= 0 && pr < ROWS && grid[pr][c] === "^") { die(); return; }
    }

    // --- Exit ---
    const ex = exitPos.c * TILE, ey = exitPos.r * TILE;
    if (overlap(player.x, player.y, PW, PH, ex + 4, ey - 18, TILE - 8, TILE + 16)) {
      levelComplete();
      return;
    }

    // --- Loop timer ---
    if (stepIdx >= loopSteps) {
      api.toast("⏳ Loop expired — press R to commit an echo before time runs out", "bad");
      retryLoop(true);
    }
  }

  function Soundish() { if (stepIdx % 12 === 0) Sound.push(); }

  function updatePlatesAndDoors(echoNow) {
    const pressed = {};
    for (const p of plates) {
      const px = p.c * TILE + 3, py = p.r * TILE + 16, pw = TILE - 6, ph = TILE - 16;
      let hit = overlap(player.x, player.y, PW, PH, px, py, pw, ph);
      if (!hit && echoNow) {
        for (const ep of echoNow) {
          if (overlap(ep.x, ep.y, PW, PH, px, py, pw, ph)) { hit = true; break; }
        }
      }
      if (!hit) {
        for (const crate of crates) {
          if (overlap(crate.x, crate.y, CW, CH, px, py, pw, ph)) { hit = true; break; }
        }
      }
      if (hit) pressed[p.id] = true;
    }
    for (const idStr of Object.keys(doorCells)) {
      const id = Number(idStr);
      const was = !!doorOpen[id];
      doorOpen[id] = !!pressed[id];
      if (doorOpen[id] !== was && stepIdx > 1) Sound.door();
    }
    for (const p of plates) {
      if (pressed[p.id] && !platePressed[p.id]) Sound.plate();
    }
    platePressed = pressed;
  }

  function die(reason) {
    Sound.death();
    deathFlash = 1;
    spawnBurst(player.x + PW / 2, player.y + PH / 2, C.bad, 22);
    api.toast(reason || "💥 Paradox! Loop rewound — echoes intact", "bad");
    resetLoop();
  }

  // ---------- Scoring / progression ----------
  function levelScoreFor(loops, seconds) {
    return Math.max(150, 1400 - loops * 150 - Math.floor(seconds) * 5);
  }

  function levelComplete() {
    Sound.win();
    const L = LEVELS[levelIdx];
    const loops = loopsUsed();
    const gained = levelScoreFor(loops, levelTime);
    totalScore += gained;
    const isHigh = api.recordScore(GAME_ID, totalScore);
    api.grantPowerup("echoloop-undo");
    api.toast(`Level cleared! +${gained} pts · Chrono Shard earned`, "good");

    const statLine =
      `<strong>${L.name}</strong> stabilized<br>` +
      `Loops used: <strong>${loops}</strong> (par ${L.par}) · Time: <strong>${levelTime.toFixed(1)}s</strong><br>` +
      `Level score: <strong>+${gained}</strong> · Total: <strong>${totalScore}</strong>` +
      (isHigh ? `<br>🏆 <strong style="color:${C.yellow}">NEW HIGH SCORE</strong>` : "");

    if (levelIdx >= LEVELS.length - 1) {
      phase = "won";
      showOverlay(
        "⭯ ALL TIMELINES STABLE",
        "Fifteen rooms, one timeline. The paradox settles. Somewhere, a crowd of you starts a slow clap that is also somehow a round of applause you started.",
        statLine + `<br><br>Final score: <strong style="color:${C.yellow}">${totalScore}</strong> · Best: <strong>${Math.max(totalScore, bestAtStart)}</strong>`,
        "Loop again from the top",
        () => { totalScore = 0; startLevel(0); }
      );
    } else {
      phase = "between";
      showOverlay(
        "✔ LOOP CLOSED",
        "The room accepts this timeline. A new one is already unfolding…",
        statLine,
        `Next: Level ${levelIdx + 2} — ${LEVELS[levelIdx + 1].name}`,
        () => startLevel(levelIdx + 1)
      );
    }
    updateHud();
  }

  function startLevel(idx) {
    loadLevel(idx);
    const L = LEVELS[idx];
    phase = "intro";
    const securityLine = L.enemies && L.enemies.length
      ? `<br><span style="color:#ff4f68">⚠ Security active:</span> Watchers lock onto the first temporal body they see; jump, use cover, or send an echo first. Sweepers must be jumped.`
      : "";
    const gateLine = L.gate ? `<br>⏱ Timed gate: open <strong>${L.gate[0]}s–${L.gate[1]}s</strong> of every loop` : "";
    showOverlay(
      `LEVEL ${idx + 1}: ${L.name}`,
      `${L.sub}<br><br><span style="opacity:.75">Loop budget: <strong>${L.maxLoops}</strong> · Par: <strong>${L.par}</strong> · Loop length: <strong>${L.loopSec}s</strong>${gateLine}${securityLine}</span>`,
      "",
      "Start the loop",
      () => { phase = "play"; hideOverlay(); Sound.resume(); }
    );
    updateHud();
  }

  // ---------- Overlay / HUD ----------
  let overlayAction = null;
  function showOverlay(title, sub, score, btnText, action, showMainMenu) {
    overlayTitle.innerHTML = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = score || "";
    overlayScore.style.display = score ? "" : "none";
    btnPrimary.textContent = btnText;
    btnMainMenu.hidden = !showMainMenu;
    overlayAction = action;
    overlayEl.classList.add("overlay--show");
  }
  function hideOverlay() {
    overlayEl.classList.remove("overlay--show");
  }

  function openMainMenu() {
    phase = "idle";
    totalScore = 0;
    loadLevel(0);
    Object.keys(keys).forEach((code) => { keys[code] = false; });
    Object.keys(touch).forEach((control) => { touch[control] = false; });
    btnPause.textContent = "Pause";
    showOverlay(
      "⭯ ECHO LOOP",
      "You're stuck in a looping room — and that's the good news. " +
        "<strong>Press R</strong> to close a loop: the room rewinds and a translucent <strong style=\"color:" + C.cyan + "\">echo</strong> replays your last run, forever. " +
        "Stand on your echoes. Make them hold doors open. Let them push crates for you. Hold <strong>Shift</strong> to fast-forward only your echoes. " +
        "<strong>A few past selves, one puzzle.</strong>",
      bestAtStart ? `Best score: <strong>${bestAtStart}</strong>` : "",
      "Start looping",
      () => { totalScore = 0; startLevel(0); }
    );
    updateHud();
  }

  function setPaused(p) {
    if (p && phase === "play") {
      phase = "paused";
      showOverlay("⏸ PAUSED", "The loop holds its breath.", "", "Resume", () => setPaused(false), true);
      btnPause.textContent = "Resume";
    } else if (!p && phase === "paused") {
      phase = "play";
      hideOverlay();
      btnPause.textContent = "Pause";
    }
  }

  function bindFullscreen() {
    const target = canvas.closest(".canvas-wrap");
    if (!btnFullscreen || !target || btnFullscreen.dataset.echoFullscreenBound === "true") return;
    btnFullscreen.dataset.echoFullscreenBound = "true";

    const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isMaxed = () => target.classList.contains("is-maxed");
    const fitCanvas = () => {
      if (!isMaxed()) {
        canvas.style.removeProperty("width");
        canvas.style.removeProperty("height");
        return;
      }
      const availableWidth = target.clientWidth;
      const availableHeight = target.clientHeight;
      const aspect = canvas.width / Math.max(1, canvas.height);
      const width = Math.min(availableWidth, availableHeight * aspect);
      canvas.style.width = `${Math.max(1, Math.floor(width))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(width / aspect))}px`;
    };
    const updateButton = () => {
      const active = isMaxed();
      btnFullscreen.textContent = active ? "✕" : "⛶";
      btnFullscreen.setAttribute("aria-label", active ? "Exit max screen" : "Max screen");
      btnFullscreen.setAttribute("title", active ? "Exit max screen" : "Max screen");
      btnFullscreen.setAttribute("aria-pressed", String(active));
    };
    const setMaxed = (active) => {
      target.classList.toggle("is-maxed", active);
      document.body.classList.toggle("rb-game-maxed", active);
      fitCanvas();
      updateButton();
      requestAnimationFrame(() => {
        fitCanvas();
        window.dispatchEvent(new Event("resize"));
      });
      if (active) canvas.focus({ preventScroll: true });
    };

    btnFullscreen.addEventListener("click", () => {
      const active = !isMaxed();
      setMaxed(active);
      try {
        if (active) {
          const request = target.requestFullscreen || target.webkitRequestFullscreen;
          const result = request && request.call(target);
          if (result && typeof result.catch === "function") result.catch(() => {});
        } else if (nativeElement()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          const result = exit && exit.call(document);
          if (result && typeof result.catch === "function") result.catch(() => {});
        }
      } catch (error) {}
    });

    const syncNativeState = () => {
      if (!nativeElement() && isMaxed()) setMaxed(false);
      else {
        fitCanvas();
        updateButton();
      }
    };
    document.addEventListener("fullscreenchange", syncNativeState);
    document.addEventListener("webkitfullscreenchange", syncNativeState);
    window.addEventListener("resize", fitCanvas);
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isMaxed() || nativeElement()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMaxed(false);
    }, true);
    updateButton();
  }

  function updateHud() {
    hudLevel.textContent = `${Math.min(levelIdx + 1, LEVELS.length)}/${LEVELS.length}`;
    const secsLeft = Math.max(0, (loopSteps - stepIdx) / 60);
    hudTime.textContent = secsLeft.toFixed(1) + "s";
    hudTime.style.color = secsLeft < 6 ? C.bad : "";
    hudLoops.textContent = `${loopsUsed()}/${maxLoops}`;
    hudScore.textContent = totalScore;
    hudBest.textContent = Math.max(bestAtStart, api.getHighScore(GAME_ID) || 0, totalScore);
  }

  // ---------- Cosmetic particles (render-only, never touch the sim) ----------
  function spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 1 + Math.random() * 2.5;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, color });
    }
  }

  function drawChamberBackdrop() {
    const horizon = H * 0.62;
    const wash = ctx.createRadialGradient(W * 0.5, horizon, 20, W * 0.5, horizon, W * 0.72);
    wash.addColorStop(0, "rgba(46,224,255,0.11)");
    wash.addColorStop(0.45, "rgba(176,108,255,0.045)");
    wash.addColorStop(1, "rgba(8,8,16,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    // Repeating laboratory wall panels, with a slow parallax shimmer.
    ctx.save();
    ctx.translate(Math.sin(renderTime * 0.18) * 2, 0);
    for (let x = -90; x < W + 90; x += 90) {
      ctx.fillStyle = "rgba(19,22,40,0.32)";
      ctx.fillRect(x + 5, 55, 80, horizon - 78);
      ctx.strokeStyle = "rgba(46,224,255,0.08)";
      ctx.strokeRect(x + 5.5, 55.5, 79, horizon - 79);
      ctx.fillStyle = "rgba(255,46,136,0.07)";
      ctx.fillRect(x + 14, 69, 3, horizon - 108);
      ctx.fillStyle = "rgba(46,224,255,0.05)";
      ctx.fillRect(x + 24, 72, 50, 2);
    }
    ctx.restore();

    // Perspective floor grid behind the collision tiles.
    ctx.strokeStyle = "rgba(46,224,255,0.055)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -W; x <= W * 2; x += 60) {
      ctx.moveTo(W / 2, horizon);
      ctx.lineTo(x, H);
    }
    for (let y = horizon; y < H; y += 25) {
      const t = (y - horizon) / (H - horizon);
      ctx.moveTo(0, horizon + t * t * (H - horizon));
      ctx.lineTo(W, horizon + t * t * (H - horizon));
    }
    ctx.stroke();

    // Floating dust/data motes. Deterministic and render-only.
    for (let i = 0; i < 34; i++) {
      const mx = (i * 137 + levelIdx * 43) % W;
      const my = 35 + ((i * 83 + levelIdx * 29) % 470);
      const twinkle = 0.12 + (Math.sin(renderTime * (0.8 + i % 4 * 0.17) + i) + 1) * 0.1;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = i % 5 === 0 ? C.pink : C.cyan;
      ctx.fillRect(mx, my, i % 3 === 0 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawSolidTile(c, r, x, y) {
    const topOpen = r > 0 && !isSolidCell(c, r - 1);
    const leftOpen = c > 0 && !isSolidCell(c - 1, r);
    const rightOpen = c < COLS - 1 && !isSolidCell(c + 1, r);
    const tileGrad = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    tileGrad.addColorStop(0, "#20284b");
    tileGrad.addColorStop(0.52, "#11162b");
    tileGrad.addColorStop(1, "#090d1b");
    ctx.fillStyle = tileGrad;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "rgba(115,136,190,0.16)";
    ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fillRect(x + 4, y + 4, TILE - 8, 2);
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    ctx.fillRect(x + TILE - 4, y + 4, 2, TILE - 8);
    if ((c + r) % 3 === 0) {
      ctx.fillStyle = "rgba(46,224,255,0.09)";
      ctx.fillRect(x + 6, y + TILE - 7, 3, 2);
      ctx.fillRect(x + 11, y + TILE - 7, 7, 2);
    }
    if (topOpen) {
      const rim = ctx.createLinearGradient(x, y, x + TILE, y);
      rim.addColorStop(0, C.cyan);
      rim.addColorStop(0.55, "rgba(255,255,255,0.9)");
      rim.addColorStop(1, C.pink);
      ctx.shadowColor = C.cyan;
      ctx.shadowBlur = 7;
      ctx.fillStyle = rim;
      ctx.fillRect(x, y, TILE, 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(46,224,255,0.08)";
      ctx.fillRect(x, y + 2, TILE, 5);
    }
    if (leftOpen) {
      ctx.fillStyle = "rgba(46,224,255,0.18)";
      ctx.fillRect(x, y + 2, 2, TILE - 4);
    }
    if (rightOpen) {
      ctx.fillStyle = "rgba(255,46,136,0.16)";
      ctx.fillRect(x + TILE - 2, y + 2, 2, TILE - 4);
    }
  }

  // ---------- Rendering ----------
  function draw() {
    renderTime += 1 / 60;
    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#080a18");
    bgGrad.addColorStop(0.58, "#0b0b19");
    bgGrad.addColorStop(1, "#160816");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    drawChamberBackdrop();

    // Tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r] ? grid[r][c] : "#";
        const x = c * TILE, y = r * TILE;
        if (ch === "#") {
          drawSolidTile(c, r, x, y);
        } else if (ch === "^") {
          const spikeGrad = ctx.createLinearGradient(x, y + 7, x, y + TILE);
          spikeGrad.addColorStop(0, "#fff2f4");
          spikeGrad.addColorStop(0.3, C.bad);
          spikeGrad.addColorStop(1, "#740f2d");
          ctx.fillStyle = spikeGrad;
          ctx.shadowColor = C.bad;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const sx = x + i * 10;
            ctx.moveTo(sx, y + TILE);
            ctx.lineTo(sx + 5, y + 8);
            ctx.lineTo(sx + 10, y + TILE);
          }
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(255,79,104,0.18)";
          ctx.fillRect(x, y + TILE - 4, TILE, 4);
        } else if (ch === "~") {
          // One-way platform: a thin bright deck you can land on from above
          ctx.fillStyle = "rgba(46,224,255,0.55)";
          ctx.fillRect(x + 1, y, TILE - 2, 4);
          ctx.strokeStyle = "rgba(46,224,255,0.25)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 8);
          ctx.lineTo(x + TILE - 3, y + 8);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(46,224,255,0.09)";
          ctx.fillRect(x + 4, y + 4, TILE - 8, 9);
        }
      }
    }

    // In-world hint text
    const L = LEVELS[levelIdx];
    if (L && L.hint) {
      ctx.font = "13px Inter, sans-serif";
      ctx.fillStyle = "rgba(182,179,201,0.5)";
      ctx.textAlign = "center";
      L.hint.lines.forEach((line, i) => ctx.fillText(line, L.hint.x, L.hint.y + i * 18));
    }

    // Plates
    for (const p of plates) {
      const x = p.c * TILE, y = p.r * TILE;
      const col = PAIR_COLORS[p.id] || C.cyan;
      const down = platePressed[p.id];
      ctx.fillStyle = "rgba(4,6,14,0.95)";
      roundRect(x + 1, y + 22, TILE - 2, 8, 3);
      ctx.fill();
      const plateGrad = ctx.createLinearGradient(x, y + 18, x, y + 30);
      plateGrad.addColorStop(0, down ? "#ffffff" : col);
      plateGrad.addColorStop(0.22, col);
      plateGrad.addColorStop(1, "rgba(8,8,16,0.9)");
      ctx.fillStyle = plateGrad;
      ctx.shadowColor = col;
      ctx.shadowBlur = down ? 18 : 6;
      roundRect(x + 4, down ? y + 24 : y + 18, TILE - 8, down ? 5 : 10, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (down) {
        const glow = ctx.createRadialGradient(x + TILE / 2, y + 24, 2, x + TILE / 2, y + 24, 28);
        glow.addColorStop(0, col + "55");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 14, y + 5, TILE + 28, 38);
      }
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = col;
      ctx.textAlign = "center";
      ctx.fillText(String(p.id), x + TILE / 2, y + 14);
    }

    // Doors
    for (const idStr of Object.keys(doorCells)) {
      const id = Number(idStr);
      const col = PAIR_COLORS[id] || C.pink;
      const open = doorOpen[id];
      for (const cell of doorCells[id]) {
        const x = cell.c * TILE, y = cell.r * TILE;
        if (open) {
          ctx.strokeStyle = col + "48";
          ctx.setLineDash([3, 5]);
          ctx.strokeRect(x + 10, y + 1, 10, TILE - 2);
          ctx.setLineDash([]);
        } else {
          ctx.shadowColor = col;
          ctx.shadowBlur = 13;
          const doorGrad = ctx.createLinearGradient(x + 8, y, x + 22, y);
          doorGrad.addColorStop(0, "rgba(8,8,16,0.9)");
          doorGrad.addColorStop(0.36, col);
          doorGrad.addColorStop(0.52, "#ffffff");
          doorGrad.addColorStop(0.68, col);
          doorGrad.addColorStop(1, "rgba(8,8,16,0.9)");
          ctx.fillStyle = doorGrad;
          ctx.fillRect(x + 9, y, 12, TILE);
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(8,8,16,0.76)";
          for (let s = 4; s < TILE; s += 8) ctx.fillRect(x + 9, y + s, 12, 2);
        }
      }
      // pair label on top cell
      const top = doorCells[id][0];
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = col;
      ctx.textAlign = "center";
      ctx.fillText(String(id), top.c * TILE + TILE / 2, top.r * TILE - 4);
    }

    // Timed gates: yellow bars on the loop's own schedule
    if (gateCells.length) {
      for (const cell of gateCells) {
        const x = cell.c * TILE, y = cell.r * TILE;
        if (gateOpen) {
          ctx.strokeStyle = "rgba(255,212,59,0.35)";
          ctx.setLineDash([3, 5]);
          ctx.strokeRect(x + 12, y, 6, TILE);
          ctx.setLineDash([]);
        } else {
          ctx.shadowColor = "#ffd43b";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "#ffd43b";
          ctx.fillRect(x + 12, y, 6, TILE);
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(8,8,16,0.6)";
          for (let s = 4; s < TILE; s += 8) ctx.fillRect(x + 12, y + s, 6, 3);
        }
      }
      // countdown above the topmost gate cell
      const top = gateCells[0];
      let label;
      if (gateOpen) label = "OPEN " + Math.ceil((gateWindow[1] * 60 - stepIdx) / 60) + "s";
      else if (stepIdx < gateWindow[0] * 60) label = "⏱ " + Math.ceil((gateWindow[0] * 60 - stepIdx) / 60) + "s";
      else label = "⏱ next loop";
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#ffd43b";
      ctx.textAlign = "center";
      ctx.fillText(label, top.c * TILE + TILE / 2, top.r * TILE - 4);
    }

    // Exit portal
    {
      const x = exitPos.c * TILE + TILE / 2, y = exitPos.r * TILE + TILE / 2 - 8;
      const pulse = 1 + Math.sin(renderTime * 4) * 0.12;
      ctx.save();
      ctx.translate(x, y);
      const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
      aura.addColorStop(0, "rgba(255,255,255,0.42)");
      aura.addColorStop(0.25, "rgba(255,212,59,0.23)");
      aura.addColorStop(1, "rgba(255,212,59,0)");
      ctx.fillStyle = aura;
      ctx.fillRect(-45, -45, 90, 90);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i === 1 ? C.pink : i === 2 ? C.cyan : C.yellow;
        ctx.globalAlpha = 0.42 - i * 0.09;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, (18 + i * 6) * pulse, (27 + i * 5) * pulse, renderTime * (i % 2 ? -0.45 : 0.35) + i, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.yellow;
      ctx.shadowColor = C.yellow;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -renderTime * 40;
      ctx.beginPath();
      ctx.ellipse(0, 0, 13 * pulse, 22 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,212,59,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, 0, 9 * pulse, 17 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5 * pulse, 12 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      ctx.fillStyle = C.yellow;
      ctx.textAlign = "center";
      ctx.fillText("EXIT", x, y + 36);
    }

    // Crates
    for (const crate of crates) {
      const cg = ctx.createLinearGradient(crate.x, crate.y, crate.x + CW, crate.y + CH);
      cg.addColorStop(0, "#6b5214");
      cg.addColorStop(0.42, "#2a210c");
      cg.addColorStop(1, "#100d07");
      ctx.fillStyle = cg;
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 4;
      roundRect(crate.x, crate.y, CW, CH, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 2;
      ctx.strokeRect(crate.x + 1, crate.y + 1, CW - 2, CH - 2);
      ctx.strokeStyle = "rgba(255,212,59,0.4)";
      ctx.beginPath();
      ctx.moveTo(crate.x + 2, crate.y + 2); ctx.lineTo(crate.x + CW - 2, crate.y + CH - 2);
      ctx.moveTo(crate.x + CW - 2, crate.y + 2); ctx.lineTo(crate.x + 2, crate.y + CH - 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,212,59,0.75)";
      ctx.fillRect(crate.x + 5, crate.y + 5, 4, 4);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(crate.x + 3, crate.y + 3, CW - 6, 2);
    }

    drawEnemies();

    // Live-run trail (recorded path, cosmetic)
    if (rec && rec.xs.length > 2) {
      ctx.strokeStyle = "rgba(255,46,136,0.22)";
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      const start = Math.max(0, rec.xs.length - 90);
      ctx.moveTo(rec.xs[start] + PW / 2, rec.ys[start] + PH / 2);
      for (let i = start + 3; i < rec.xs.length; i += 3) {
        ctx.lineTo(rec.xs[i] + PW / 2, rec.ys[i] + PH / 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Echoes (translucent cyan ghosts)
    for (let i = 0; i < echoes.length; i++) {
      const e = echoes[i];
      const p0 = echoPosAt(e, echoStepIdx);
      const pPrev = echoPosAt(e, Math.max(0, echoStepIdx - 1));
      const moving = Math.abs(p0.x - pPrev.x) > 0.1;
      // A pair of delayed silhouettes makes the replay read as temporal, not merely transparent.
      for (let lag = 2; lag >= 1; lag--) {
        const pp = echoPosAt(e, Math.max(0, echoStepIdx - lag * 4));
        drawFigure(pp.x, pp.y, pp.f, moving ? echoStepIdx * 0.35 : 0, {
          color: C.cyan, alpha: 0.06 * lag, ghost: true,
        });
      }
      drawFigure(p0.x, p0.y, p0.f, moving ? echoStepIdx * 0.35 : 0, {
        color: C.cyan, alpha: ECHO_ALPHA, ghost: true, label: "E" + (i + 1),
      });
    }

    // Live player (hot pink, full opacity — always reads as "you")
    drawFigure(player.x, player.y, player.face, player.vx !== 0 && player.grounded ? player.walkDist / 6 : 0, {
      color: C.pink, alpha: 1, ghost: false,
    });

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 0.03;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.globalAlpha = 1;
    }

    // Loop timer bar (top edge)
    {
      const frac = Math.max(0, 1 - stepIdx / loopSteps);
      const low = frac < 0.2;
      ctx.fillStyle = "rgba(8,8,16,0.8)";
      ctx.fillRect(0, 0, W, 7);
      ctx.fillStyle = low ? C.bad : C.cyan;
      if (low) ctx.globalAlpha = 0.6 + Math.sin(renderTime * 10) * 0.4;
      ctx.fillRect(0, 0, W * frac, 7);
      ctx.globalAlpha = 1;
      // REC indicator
      if (phase === "play") {
        ctx.fillStyle = C.bad;
        ctx.globalAlpha = 0.55 + Math.sin(renderTime * 6) * 0.45;
        ctx.beginPath();
        ctx.arc(W - 70, 22, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = "700 11px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("REC", W - 58, 26);
      }
    }

    // Death flash
    if (deathFlash > 0) {
      ctx.fillStyle = `rgba(255,79,104,${deathFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      deathFlash = Math.max(0, deathFlash - 0.06);
    }

    // Cinematic vignette and faint CRT scanlines hold the whole frame together.
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.23, W / 2, H / 2, W * 0.62);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.72, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.018)";
    for (let sy = 1; sy < H; sy += 4) ctx.fillRect(0, sy, W, 1);

    // Hold F to advance only unfinished echo tracks at 5x playback speed.
    if (isEchoFastForwarding()) {
      ctx.save();
      ctx.font = "400 14px 'Bungee', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(8,8,16,0.9)";
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.yellow;
      ctx.shadowBlur = 12;
      roundRectPath(W / 2 - 68, 15, 136, 30, 8);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.yellow;
      ctx.fillText(`» ECHOES ${ECHO_FAST_FORWARD_MULT}×`, W / 2, 31);
      ctx.restore();
    }
  }

  function drawEnemies() {
    if (!enemies.length) return;
    ctx.save();

    for (const enemy of enemies) {
      if (enemy.type === "sweeper") {
        ctx.strokeStyle = "rgba(255,79,104,0.18)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.moveTo(enemy.x1, enemy.y);
        ctx.lineTo(enemy.x2, enemy.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const pulse = 0.72 + Math.sin(renderTime * 16 + enemy.index) * 0.28;
        ctx.shadowColor = C.bad;
        ctx.shadowBlur = 16;
        ctx.fillStyle = `rgba(255,79,104,${0.72 + pulse * 0.2})`;
        roundRectPath(enemy.x - 15, enemy.y - 5, 30, 10, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(enemy.x - 8, enemy.y - 1, 16, 2);
        ctx.fillStyle = C.bad;
        ctx.font = "700 8px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("SWEEP", enemy.x, enemy.y - 11);
        continue;
      }

      const face = enemy.face || -1;
      const charge = Math.min(1, enemy.lock / (enemy.lockSteps || 48));
      const eyeX = enemy.x + face * 8;

      if (enemy.target) {
        ctx.strokeStyle = `rgba(255,79,104,${0.24 + charge * 0.7})`;
        ctx.lineWidth = 1 + charge * 3;
        ctx.shadowColor = C.bad;
        ctx.shadowBlur = 5 + charge * 15;
        ctx.beginPath();
        ctx.moveTo(eyeX, enemy.y);
        ctx.lineTo(enemy.target.x, enemy.target.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255,255,255,${0.2 + charge * 0.7})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(enemy.target.x, enemy.target.y, 6 + charge * 4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,79,104,0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(eyeX, enemy.y);
        ctx.lineTo(eyeX + face * 58, enemy.y);
        ctx.stroke();
      }

      if (enemy.fireFlash > 0 && enemy.fireTarget) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 5;
        ctx.shadowColor = C.bad;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.moveTo(eyeX, enemy.y);
        ctx.lineTo(enemy.fireTarget.x, enemy.fireTarget.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = "rgba(8,8,16,0.96)";
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.bad;
      ctx.shadowBlur = 10 + charge * 8;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = charge > 0.75 ? "#ffffff" : C.bad;
      ctx.beginPath();
      ctx.arc(eyeX, enemy.y, 4 + charge * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,79,104,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y - 12);
      ctx.lineTo(enemy.x, enemy.y - 18);
      ctx.stroke();
      ctx.fillStyle = C.bad;
      ctx.font = "700 8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("WATCH", enemy.x, enemy.y - 23);
    }

    ctx.font = "700 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,79,104,0.86)";
    ctx.fillText("⚠ SECURITY ACTIVE", 14, 25);
    ctx.restore();
  }

  function drawFigure(x, y, face, walkPhase, opts) {
    const col = opts.color;
    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.shadowColor = col;
    ctx.shadowBlur = opts.ghost ? 12 : 9;
    // Ground contact shadow separates the silhouette from bright platforms.
    ctx.fillStyle = opts.ghost ? "rgba(46,224,255,0.16)" : "rgba(255,46,136,0.22)";
    ctx.beginPath();
    ctx.ellipse(x + PW / 2, y + PH + 2, 11, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // legs
    const swing = walkPhase ? Math.sin(walkPhase) * 5 : 0;
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 25); ctx.lineTo(x + 7 + swing, y + PH);
    ctx.moveTo(x + 13, y + 25); ctx.lineTo(x + 13 - swing, y + PH);
    ctx.stroke();
    // body
    const suit = ctx.createLinearGradient(x + 2, y + 9, x + 18, y + 26);
    suit.addColorStop(0, opts.ghost ? "rgba(230,255,255,0.82)" : "#ff8abb");
    suit.addColorStop(0.3, col);
    suit.addColorStop(1, opts.ghost ? "rgba(46,224,255,0.45)" : "#99154f");
    ctx.fillStyle = suit;
    ctx.shadowColor = col;
    ctx.shadowBlur = opts.ghost ? 10 : 6;
    roundRect(x + 2, y + 9, 16, 17, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    // chest loop insignia
    ctx.strokeStyle = opts.ghost ? "rgba(255,255,255,0.65)" : C.yellow;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x + 10, y + 17, 3.3, -0.7, Math.PI * 1.55);
    ctx.stroke();
    ctx.fillStyle = opts.ghost ? col : C.yellow;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 14); ctx.lineTo(x + 10, y + 13); ctx.lineTo(x + 9, y + 16);
    ctx.fill();
    // head
    ctx.fillStyle = opts.ghost ? "rgba(170,244,255,0.72)" : "#db236e";
    roundRect(x + 3, y, 14, 11, 3);
    ctx.fill();
    // visor
    const visor = ctx.createLinearGradient(x + 4, y + 3, x + 16, y + 7);
    visor.addColorStop(0, opts.ghost ? "rgba(8,8,16,0.72)" : "#ffffff");
    visor.addColorStop(0.42, opts.ghost ? "rgba(46,224,255,0.45)" : "#bff7ff");
    visor.addColorStop(1, opts.ghost ? "rgba(8,8,16,0.82)" : C.cyan);
    ctx.fillStyle = visor;
    const vx = face > 0 ? x + 9 : x + 4;
    roundRect(vx, y + 3, 7, 4, 1.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(face > 0 ? vx + 1 : vx + 4, y + 3.5, 2, 1);
    // antenna
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y); ctx.lineTo(x + 10, y - 5);
    ctx.stroke();
    ctx.fillStyle = opts.ghost ? col : C.yellow;
    ctx.shadowColor = opts.ghost ? col : C.yellow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x + 10, y - 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // ghost scanlines
    if (opts.ghost) {
      ctx.globalAlpha = opts.alpha * 0.7;
      ctx.strokeStyle = "rgba(8,8,16,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let sy = y + 2; sy < y + PH; sy += 5) {
        ctx.moveTo(x, sy); ctx.lineTo(x + PW, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (opts.label) {
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.8;
      ctx.textAlign = "center";
      ctx.fillText(opts.label, x + PW / 2, y - 10);
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Main loop (fixed-step accumulator) ----------
  let lastT = 0;
  let acc = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = t - lastT;
    lastT = t;
    if (dt > 250) dt = 250; // tab-away: effectively pauses, no spiral of death
    if (phase === "play") {
      acc += dt;
      let guard = 0;
      while (acc >= STEP_MS && guard < 6) {
        simStep();
        acc -= STEP_MS;
        guard++;
        if (phase !== "play") { acc = 0; break; }
      }
    } else {
      acc = 0;
    }
    draw();
    updateHud();
  }

  // ---------- Input ----------
  function onKeyDown(e) {
    if (e.code === "Space" || e.code.startsWith("Arrow")) {
      if (phase === "play") e.preventDefault();
    }
    if (keys[e.code]) return;
    keys[e.code] = true;
    Sound.resume();
    if (e.code === "KeyR") commitLoop();
    else if (e.code === "KeyZ") retryLoop();
    else if (e.code === "KeyU") undoEcho();
    else if (e.code === "KeyP") setPaused(phase === "play");
    else if (e.code === "KeyM") { const m = Sound.toggleMute(); btnSound.textContent = m ? "Sound Off" : "Sound On"; }
  }
  function onKeyUp(e) { keys[e.code] = false; }

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

  // ---------- Init ----------
  function init() {
    bestAtStart = api.getHighScore(GAME_ID) || 0;
    bindFullscreen();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => { keys.ShiftLeft = false; keys.ShiftRight = false; });

    btnPrimary.addEventListener("click", () => { if (overlayAction) overlayAction(); });
    btnMainMenu.addEventListener("click", openMainMenu);
    btnLoop.addEventListener("click", () => { Sound.resume(); commitLoop(); });
    btnRetry.addEventListener("click", () => { Sound.resume(); retryLoop(); });
    btnUndo.addEventListener("click", () => undoEcho());
    btnRestart.addEventListener("click", () => { if (phase === "play" || phase === "paused") restartLevel(); });
    btnPause.addEventListener("click", () => setPaused(phase === "play"));
    btnSound.addEventListener("click", () => {
      const m = Sound.toggleMute();
      btnSound.textContent = m ? "Sound Off" : "Sound On";
      btnSound.setAttribute("aria-pressed", String(!m));
    });

    ["left", "right", "jump"].forEach((k) => bindTouch("el-touch-" + k, k));
    const tLoop = document.getElementById("el-touch-loop");
    if (tLoop) tLoop.addEventListener("touchstart", (e) => { e.preventDefault(); Sound.resume(); commitLoop(); }, { passive: false });
    const tRetry = document.getElementById("el-touch-retry");
    if (tRetry) tRetry.addEventListener("touchstart", (e) => { e.preventDefault(); retryLoop(); }, { passive: false });

    document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });

    // Starter Chrono Shard (one free echo-undo), first visit only
    try {
      if (!localStorage.getItem("rb_echoloop_starter")) {
        localStorage.setItem("rb_echoloop_starter", "1");
        api.grantPowerup("echoloop-undo");
      }
    } catch (e) { /* private mode */ }

    openMainMenu();
    requestAnimationFrame(frame);
  }

  // Debug hook
  window.__ECHO = {
    get state() {
      return {
        phase, levelIdx, echoes: echoes.length, stepIdx, echoStepIdx, totalScore, fastForwarding: isEchoFastForwarding(),
        player: { x: player.x, y: player.y, standEcho: player.standEcho },
        crates: crates.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) })),
        enemies: enemies.map((e) => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), lock: e.lock || 0, cooldown: e.cooldown || 0 })),
        echoPos: echoes.map((e) => { const p = echoPosAt(e, echoStepIdx); return { x: Math.round(p.x), y: Math.round(p.y) }; }),
      };
    },
    goto(n) { totalScore = 0; startLevel(Math.max(0, Math.min(LEVELS.length - 1, n))); },
    win() { if (phase === "play") levelComplete(); },
    commit: () => commitLoop(),
    // Deterministic test drivers (rAF-independent)
    key(code, down) { keys[code] = !!down; },
    step(n) { let i = 0; while (i++ < (n || 1) && phase === "play") simStep(); },
    doors: () => ({ ...doorOpen }),
    plates: () => ({ ...platePressed }),
    setPlayer(x, y) { player.x = x; player.y = y; player.vy = 0; },
    LEVELS,
  };

  init();
})();
