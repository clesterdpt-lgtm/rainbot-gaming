/* ============================================
   ECHO LOOP 3D — the time-loop echo puzzler, remade in first person
   - Three.js r128 (vendored, same build The Weight uses).
   - Deterministic sim: fixed 60 Hz steps, custom 3-axis AABB physics.
     Echoes replay recorded POSITION tracks (x,y,z,yaw) exactly — replay
     never depends on wall-clock time or randomness.
   - Real-time lighting: shadow-casting directional light, hemisphere fill,
     fog, and dynamic point lights on plates, doors, echoes, the exit
     portal and a camera torch.
   - Arcade physics on purpose: jump height (1.9m) beats body height
     (1.7m) so you can climb a staircase of your own past selves.
   - Debug hook: window.__ECHO3D (key/look/step/state — rAF-independent)
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "echo-loop-3d";
  const CELL = 2;            // meters per grid cell
  const DT = 1 / 60;
  const STEP_MS = 1000 / 60;

  // Player / echo body
  const P_HALF = 0.35;       // half-width of the AABB (x and z)
  const P_H = 1.7;           // body height (feet -> head)
  const EYE = 1.55;

  // Movement (deterministic, per-second units applied per fixed step)
  const SPEED = 5.0;
  const GRAV = 22;
  const JUMP_V = 9.5;        // jump apex ~1.97m > body height (1.7) -> echo stacking works,
                             // but still under the 2m ledges that must stay out of reach
  const MAX_FALL = 22;
  const PUSH_SPEED = 2.2;    // player pushing a crate
  const ECHO_PUSH = 3.0;     // echo shoving a crate (replay must win fights)
  const COYOTE = 6;          // steps
  const JUMP_BUFFER = 7;     // steps

  const CRATE = 1.5;         // crate edge length
  const KILL_Y = -6;

  const C = {
    ink: "#fbfaf4",
    pink: 0xff2e88,
    cyan: 0x2ee0ff,
    yellow: 0xffd43b,
    purple: 0xb06cff,
    bad: 0xff4f68,
    bg: 0x080810,
  };
  const PAIR = { 1: C.cyan, 2: C.yellow, 3: C.purple };
  const GATE_COLOR = 0xffd43b;

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
  // heights: '#' wall (7m) · '0'-'9' platform top height in meters ·
  //          'v' pit (top -1) · 'u' deep pillar (top -1.5) · '_' void (fall!)
  // items:   'S' spawn · 'X' exit · 'K' crate · 'p','q' plates -> doors 'P','Q'
  const LEVELS = [
    {
      name: "FIRST CONTACT",
      sub: "One plate. One door. Two of you. Now with depth perception.",
      par: 2, maxLoops: 2, loopSec: 35,
      heights: [
        "############",
        "#0000#00000#",
        "#0000#00000#",
        "#0000#00000#",
        "#0000000000#",
        "#0000#00000#",
        "#0000#00000#",
        "#0000#00000#",
        "############",
      ],
      items: [
        "............",
        "............",
        ".p..........",
        "............",
        ".....P......",
        "..S.........",
        ".........X..",
        "............",
        "............",
      ],
    },
    {
      name: "THE ASCENDING TOWER",
      sub: "A five-meter cliff. Your past selves ARE the scaffolding.",
      par: 3, maxLoops: 4, loopSec: 45,
      heights: [
        "##############",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "#000000000555#",
        "##############",
      ],
      items: [
        "..............",
        "..............",
        "...........X..",
        "..............",
        "....K.........",
        "..............",
        "..............",
        "..S...........",
        "..............",
        "..............",
      ],
    },
    {
      name: "THE CREVASSE",
      sub: "A void too wide to jump. Step across on your own shoulders.",
      par: 3, maxLoops: 4, loopSec: 45,
      heights: [
        "################",
        "#00000___333333#",
        "#00000___333333#",
        "#00000_u_333333#",
        "#00000_u_333333#",
        "#00000_u_333333#",
        "#00000___333333#",
        "#00000___333333#",
        "################",
      ],
      items: [
        "................",
        "................",
        "................",
        "................",
        "..S.........X...",
        "................",
        "................",
        "................",
        "................",
      ],
    },
    {
      name: "HOLD THE LINE",
      sub: "Two doors. Two plates. Somebody stays behind — twice.",
      par: 3, maxLoops: 4, loopSec: 40,
      heights: [
        "################",
        "#0000#0000#0000#",
        "#0000#0000#0000#",
        "#0000#0000#0000#",
        "#00000000000000#",
        "#0000#0000#0000#",
        "#0000#0000#0000#",
        "#0000#0000#0000#",
        "################",
      ],
      items: [
        "................",
        "................",
        "..p....q........",
        "................",
        ".....P....Q..X..",
        "................",
        "..S.............",
        "................",
        "................",
      ],
    },
    {
      name: "PARADOX ENGINE",
      sub: "Crates, plates, a tower and two doors. All of you, in 3D.",
      par: 3, maxLoops: 5, loopSec: 50,
      heights: [
        "##################",
        "#000000#000000#00#",
        "#000000#004400#00#",
        "#000000#004400#00#",
        "#000000#000000#00#",
        "#0000v00000000000#",
        "#000000#000000#00#",
        "#000000#000000#00#",
        "#000000#000000#00#",
        "#000000#000000#00#",
        "##################",
      ],
      items: [
        "..................",
        "..................",
        "..........q.......",
        "..................",
        "..................",
        "..SK.p.P......Q.X.",
        ".........K........",
        "..................",
        "..................",
        "..................",
        "..................",
      ],
    },
    {
      name: "COUNTERWEIGHT",
      sub: "Two doors in series, one exit closet. Both plates. At the same time.",
      par: 3, maxLoops: 4, loopSec: 45,
      heights: [
        "##################",
        "#00000000000#0#00#",
        "#00000000000#0#00#",
        "#00000000000#0#00#",
        "#0000000000000000#",
        "#00000000000#0#00#",
        "#01230000000#0#00#",
        "#00000000000#0#00#",
        "##################",
      ],
      items: [
        "..................",
        "..................",
        "..q...............",
        "..................",
        "..S.........P.Q.X.",
        "..................",
        "....p.............",
        "..................",
        "..................",
      ],
    },
    {
      name: "THE ELEVATOR",
      sub: "One echo. One five-meter ledge. Record a bounce, ride it, jump at the top.",
      par: 2, maxLoops: 2, loopSec: 45,
      heights: [
        "################",
        "#00000000005555#",
        "#00000000005555#",
        "#00000000005555#",
        "#00000000000000#",
        "#00000000000000#",
        "#00000000000000#",
        "#00000000000000#",
        "################",
      ],
      items: [
        "................",
        "................",
        ".............X..",
        "................",
        "................",
        "................",
        "..S.............",
        "................",
        "................",
      ],
    },
    {
      name: "FREIGHT CHAIN",
      sub: "Crates only fall. Shove one off its shelf and build a freight ramp.",
      par: 3, maxLoops: 4, loopSec: 50,
      heights: [
        "##################",
        "#00000#0122000555#",
        "#00000#0000000555#",
        "#00000#0000000555#",
        "#0000000000000000#",
        "#00000#0000000000#",
        "#00000#0000000000#",
        "#00000#0000000000#",
        "#00000#0000000000#",
        "##################",
      ],
      items: [
        "..................",
        "..........K.......",
        "..p............X..",
        "..................",
        "......P...........",
        "..................",
        "..S...............",
        "..................",
        "..................",
        "..................",
      ],
    },
    {
      name: "THE TURNSTILE",
      sub: "Three rooms deep. Each echo walks the doors the last one opened.",
      par: 4, maxLoops: 5, loopSec: 50,
      heights: [
        "####################",
        "#0000#0000#0000#000#",
        "#0000#0100#0000#000#",
        "#0000#0000#0000#000#",
        "#000000000000000000#",
        "#0000#0000#0000#000#",
        "#0000#0000#0000#000#",
        "#0000#0000#0000#000#",
        "####################",
      ],
      items: [
        "....................",
        "....................",
        "..p....q............",
        "....................",
        ".....P....Q....R.X..",
        "....................",
        "..S.........r.......",
        "....................",
        "....................",
      ],
    },
    {
      name: "SCAFFOLD",
      sub: "Four selves, one seven-meter tower. Commit each loop from the top of the last.",
      par: 4, maxLoops: 5, loopSec: 55,
      heights: [
        "################",
        "#00000000000077#",
        "#00000000000077#",
        "#00000000000077#",
        "#00000000001077#",
        "#00000000000077#",
        "#00000000000077#",
        "#00000000000077#",
        "################",
      ],
      items: [
        "................",
        "................",
        "................",
        "................",
        "..S..........X..",
        "................",
        "................",
        "................",
        "................",
      ],
    },
    {
      name: "LATE ARRIVAL",
      sub: "The gate keeps its own schedule. Waiting around IS a recorded move.",
      par: 2, maxLoops: 3, loopSec: 50,
      gate: [28, 40],
      heights: [
        "#################",
        "#0000000#0000000#",
        "#0000000#0000000#",
        "#0000000#0000330#",
        "#000000000000330#",
        "#0000000#0000330#",
        "#0000000#0000000#",
        "#0000000#0000000#",
        "#################",
      ],
      items: [
        ".................",
        ".................",
        ".................",
        ".................",
        "..S.....G....X...",
        ".................",
        ".................",
        ".................",
        ".................",
      ],
    },
    {
      name: "THE FERRY",
      sub: "Ride your bouncing echo onto the wall top, leave yourself holding the plate, ride again.",
      par: 3, maxLoops: 4, loopSec: 50,
      heights: [
        "##################",
        "#0000000050000#00#",
        "#0000000050000#00#",
        "#0000000050000#00#",
        "#0000000050000000#",
        "#0000000050000#00#",
        "#0000000050000#00#",
        "#0000000050000#00#",
        "##################",
      ],
      items: [
        "..................",
        "..................",
        "..................",
        "..................",
        "..S......q....Q.X.",
        "..................",
        "..................",
        "..................",
        "..................",
      ],
    },
    {
      name: "TWO TOWERS",
      sub: "Exactly four loops. One step, one plate-holder, one step, one climber.",
      par: 4, maxLoops: 4, loopSec: 55,
      heights: [
        "##################",
        "#00000000#0000000#",
        "#00000000#0000000#",
        "#00033000#0003300#",
        "#0003300000003300#",
        "#00033000#0003300#",
        "#00000000#0000000#",
        "#00000000#0000000#",
        "##################",
      ],
      items: [
        "..................",
        "..................",
        "..................",
        "..................",
        "..S.p....P...X....",
        "..................",
        "..................",
        "..................",
        "..................",
      ],
    },
    {
      name: "CLOCKWORK",
      sub: "Crate, gate, stack, plate. The machine runs on schedule — you're the last cog.",
      par: 3, maxLoops: 5, loopSec: 60,
      gate: [20, 32],
      heights: [
        "####################",
        "#000000#000#00000#0#",
        "#000000#000#00440#0#",
        "#000000#000#00440#0#",
        "#000000#000#00000#0#",
        "#0000v0000000000000#",
        "#000000#000#00000#0#",
        "#000000#000#00000#0#",
        "#000000#000#00000#0#",
        "#000000#000#00000#0#",
        "####################",
      ],
      items: [
        "....................",
        "....................",
        "..............q.....",
        "....................",
        "....................",
        "..SK.p.P...G.....QX.",
        "..............K.....",
        "....................",
        "....................",
        "....................",
        "....................",
      ],
    },
    {
      name: "BOOTSTRAP PARADOX",
      sub: "The exit gate is open for 15 seconds — at loop START. Build the road, then run it while it builds itself.",
      par: 3, maxLoops: 4, loopSec: 45,
      gate: [0, 15],
      heights: [
        "####################",
        "#000000300003000#00#",
        "#000000300003000#00#",
        "#000000300003000#00#",
        "#000000300003000000#",
        "#000000300003000#00#",
        "#000000300003000#00#",
        "#000000300003000#00#",
        "####################",
      ],
      items: [
        "....................",
        "....................",
        "....................",
        "....................",
        "..S.............G.X.",
        "....................",
        "....................",
        "....................",
        "....................",
      ],
    },
  ];

  // ---------- DOM ----------
  const canvas = document.getElementById("gameCanvas");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
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
  const crosshair = document.getElementById("el3d-crosshair");
  const flashEl = document.getElementById("el3d-flash");
  const timerBar = document.getElementById("el3d-timerbar");

  // ---------- Sound (tiny synth, same voice as the 2D game) ----------
  const Sound = (() => {
    let ac = null, muted = false;
    function ensure() {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
      if (ac && ac.state === "suspended") ac.resume();
    }
    function beep(freq, dur, type, vol, slide) {
      if (muted) return;
      ensure();
      if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur + 0.02);
    }
    return {
      resume: ensure,
      jump: () => beep(300, 0.12, "square", 0.04, 260),
      commit: () => { beep(180, 0.3, "sawtooth", 0.05, -120); beep(520, 0.22, "sine", 0.04, 240); },
      retry: () => beep(240, 0.2, "sawtooth", 0.04, -160),
      plate: () => beep(660, 0.08, "square", 0.035),
      door: () => beep(140, 0.18, "square", 0.045, 60),
      death: () => beep(160, 0.35, "sawtooth", 0.06, -120),
      win: () => { beep(440, 0.12, "square", 0.05); setTimeout(() => beep(660, 0.12, "square", 0.05), 110); setTimeout(() => beep(880, 0.2, "square", 0.05), 220); },
      step: () => beep(70, 0.04, "triangle", 0.012),
      toggleMute() { muted = !muted; return muted; },
    };
  })();

  // ---------- Three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(1280, 720, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.Fog(C.bg, 9, 55);

  const camera = new THREE.PerspectiveCamera(75, 1280 / 720, 0.1, 120);

  // --- Real-time lighting rig ---
  const hemi = new THREE.HemisphereLight(0x2a3350, 0x080810, 0.75);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x8fb8ff, 0.65);
  moon.position.set(18, 32, 12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -34; moon.shadow.camera.right = 34;
  moon.shadow.camera.top = 34; moon.shadow.camera.bottom = -34;
  moon.shadow.camera.near = 1; moon.shadow.camera.far = 90;
  moon.shadow.bias = -0.0015;
  scene.add(moon);
  scene.add(moon.target);
  const torch = new THREE.PointLight(0xfff2e0, 0.75, 14, 2);
  scene.add(torch);

  const MAT = {
    floor: new THREE.MeshStandardMaterial({ color: 0x151a34, roughness: 0.92, metalness: 0.06 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x0f1327, roughness: 0.95, metalness: 0.05 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x181d3d, roughness: 0.9, metalness: 0.08 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x241c08, roughness: 0.8, emissive: C.yellow, emissiveIntensity: 0.08 }),
  };
  const edgeMatCyan = new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.22 });
  const edgeMatPink = new THREE.LineBasicMaterial({ color: C.pink, transparent: true, opacity: 0.1 });

  // ---------- Level state ----------
  let phase = "idle"; // idle | intro | play | paused | between | won
  let levelIdx = 0;
  let totalScore = 0;
  let bestAtStart = 0;

  let solids = [];          // static AABBs {minx,miny,minz,maxx,maxy,maxz}
  let spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  let exitPos = { x: 0, y: 0, z: 0 };
  let plates = [];          // {id, box, mesh, light, pressed}
  let doors = [];           // {id, box, mesh, light, open, meshY}
  let gates = [];           // timed gates: {box, mesh, light, closedY, openY}
  let gateWindow = null;    // [openSec, closeSec] or null
  let gateOpen = false;
  let cratesInit = [];      // {x,y,z}
  let crates = [];          // {x,y,z,vy,mesh}
  let maxLoops = 2, loopSteps = 2100;

  // Timed gate: pure function of the loop clock, rewinds with everything else.
  function computeGateOpen(step) {
    return !!(gateWindow && step >= gateWindow[0] * 60 && step < gateWindow[1] * 60);
  }

  const player = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    grounded: false, coyote: 0, jumpBuf: 0, jumpLatch: false,
    standEcho: -1,
  };
  let echoes = [];          // {xs,ys,zs,yw,len, group, light}
  let rec = null;
  let stepIdx = 0;
  let levelTime = 0;
  let renderTime = 0;
  let levelGroup = null;    // all level meshes
  let exitRing = null, exitLight = null;

  const keys = Object.create(null);
  const touch = { f: 0, s: 0, jump: false };

  // ---------- Helpers ----------
  function aabb(minx, miny, minz, maxx, maxy, maxz) { return { minx, miny, minz, maxx, maxy, maxz }; }
  function boxesOverlap(a, b) {
    return a.minx < b.maxx && a.maxx > b.minx && a.miny < b.maxy && a.maxy > b.miny && a.minz < b.maxz && a.maxz > b.minz;
  }
  function entBox(x, y, z, half, h) { return aabb(x - half, y, z - half, x + half, y + h, z + half); }
  function crateBox(c) { return aabb(c.x - CRATE / 2, c.y, c.z - CRATE / 2, c.x + CRATE / 2, c.y + CRATE, c.z + CRATE / 2); }

  function addBoxMesh(group, minx, miny, minz, maxx, maxy, maxz, mat, edges) {
    const w = maxx - minx, h = maxy - miny, d = maxz - minz;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (edges) {
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edges);
      line.position.copy(mesh.position);
      group.add(line);
    }
    return mesh;
  }

  function makeLabelSprite(text, colorHex) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 64;
    const c2 = cv.getContext("2d");
    c2.font = "700 40px 'JetBrains Mono', monospace";
    c2.textAlign = "center";
    c2.fillStyle = colorHex;
    c2.fillText(text, 64, 46);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false }));
    spr.scale.set(1.1, 0.55, 1);
    return spr;
  }

  function makeEchoFigure(index) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: C.cyan, emissive: C.cyan, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.34, depthWrite: false,
    });
    const add = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      return m;
    };
    add(0.26, 0.55, 0.3, -0.16, 0.275, 0);   // legs
    add(0.26, 0.55, 0.3, 0.16, 0.275, 0);
    add(0.68, 0.62, 0.42, 0, 0.86, 0);       // torso
    add(0.5, 0.42, 0.44, 0, 1.42, 0);        // head
    add(0.3, 0.1, 0.06, 0, 1.44, -0.23);     // visor
    add(0.05, 0.22, 0.05, 0, 1.74, 0);       // antenna
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({ color: C.cyan, emissive: C.cyan, emissiveIntensity: 1.2 })
    );
    tip.position.set(0, 1.88, 0);
    group.add(tip);
    const label = makeLabelSprite("E" + index, "#2ee0ff");
    label.position.set(0, 2.25, 0);
    group.add(label);
    const light = new THREE.PointLight(C.cyan, 0.55, 5.5, 2);
    light.position.set(0, 1.2, 0);
    group.add(light);
    return group;
  }

  // ---------- Level build ----------
  function loadLevel(idx) {
    levelIdx = idx;
    const L = LEVELS[idx];
    maxLoops = L.maxLoops;
    loopSteps = L.loopSec * 60;

    if (levelGroup) { scene.remove(levelGroup); }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);

    solids = [];
    plates = [];
    doors = [];
    gates = [];
    gateWindow = L.gate || null;
    cratesInit = [];

    const H = L.heights, IT = L.items;
    const rows = H.length, cols = H[0].length;

    const cellFloor = (cx, cz) => {
      const ch = H[cz][cx];
      if (ch >= "0" && ch <= "9") return Number(ch);
      if (ch === "v") return -1;
      if (ch === "u") return -1.5;
      return 0;
    };

    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const ch = H[cz][cx];
        const x0 = cx * CELL, z0 = cz * CELL;
        if (ch === "#") {
          solids.push(aabb(x0, -1, z0, x0 + CELL, 7, z0 + CELL));
          addBoxMesh(levelGroup, x0, -1, z0, x0 + CELL, 7, z0 + CELL, MAT.wall, edgeMatPink);
        } else if (ch >= "0" && ch <= "9") {
          const h = Number(ch);
          solids.push(aabb(x0, -1.5, z0, x0 + CELL, h, z0 + CELL));
          addBoxMesh(levelGroup, x0, -1.5, z0, x0 + CELL, h, z0 + CELL, h > 0 ? MAT.pillar : MAT.floor, h > 0 ? edgeMatCyan : null);
        } else if (ch === "v") {
          solids.push(aabb(x0, -2.5, z0, x0 + CELL, -1, z0 + CELL));
          addBoxMesh(levelGroup, x0, -2.5, z0, x0 + CELL, -1, z0 + CELL, MAT.floor, edgeMatCyan);
        } else if (ch === "u") {
          solids.push(aabb(x0, -5.5, z0, x0 + CELL, -1.5, z0 + CELL));
          addBoxMesh(levelGroup, x0, -5.5, z0, x0 + CELL, -1.5, z0 + CELL, MAT.pillar, edgeMatCyan);
        }
        // '_' void: nothing

        const it = IT[cz][cx];
        const cxm = x0 + CELL / 2, czm = z0 + CELL / 2;
        if (it === "S") {
          spawn = { x: cxm, y: cellFloor(cx, cz), z: czm, yaw: 0 };
        } else if (it === "X") {
          const fy = cellFloor(cx, cz);
          exitPos = { x: cxm, y: fy, z: czm };
        } else if (it === "K") {
          cratesInit.push({ x: cxm, y: cellFloor(cx, cz), z: czm });
        } else if (it === "p" || it === "q" || it === "r") {
          const id = it === "p" ? 1 : it === "q" ? 2 : 3;
          const fy = cellFloor(cx, cz);
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 0.12, 1.7),
            new THREE.MeshStandardMaterial({ color: 0x0c1020, emissive: PAIR[id], emissiveIntensity: 0.25, roughness: 0.6 })
          );
          mesh.position.set(cxm, fy + 0.06, czm);
          mesh.receiveShadow = true;
          levelGroup.add(mesh);
          const light = new THREE.PointLight(PAIR[id], 0, 6, 2);
          light.position.set(cxm, fy + 0.8, czm);
          levelGroup.add(light);
          const lbl = makeLabelSprite(String(id), id === 1 ? "#2ee0ff" : id === 2 ? "#ffd43b" : "#b06cff");
          lbl.position.set(cxm, fy + 1.5, czm);
          levelGroup.add(lbl);
          plates.push({
            id, mesh, light, pressed: false,
            box: aabb(x0 + 0.2, fy - 0.2, z0 + 0.2, x0 + CELL - 0.2, fy + 0.55, z0 + CELL - 0.2),
          });
        } else if (it === "P" || it === "Q" || it === "R" || it === "G") {
          const isGate = it === "G";
          const id = it === "P" ? 1 : it === "Q" ? 2 : 3;
          const color = isGate ? GATE_COLOR : PAIR[id];
          // Orientation: if the cells north/south are walls, the wall line runs
          // along z, so the slab must also span z (and be thin in x).
          const wallAlongZ = H[cz - 1] && H[cz - 1][cx] === "#" && H[cz + 1] && H[cz + 1][cx] === "#";
          const bx = wallAlongZ
            ? aabb(x0 + CELL / 2 - 0.25, -0.5, z0, x0 + CELL / 2 + 0.25, 5, z0 + CELL)
            : aabb(x0, -0.5, z0 + CELL / 2 - 0.25, x0 + CELL, 5, z0 + CELL / 2 + 0.25);
          const mat = new THREE.MeshStandardMaterial({
            color: isGate ? 0x1a1405 : 0x1a0510, emissive: color, emissiveIntensity: 0.7,
            transparent: true, opacity: 0.85,
          });
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(bx.maxx - bx.minx, 5.5, bx.maxz - bx.minz),
            mat
          );
          mesh.position.set((bx.minx + bx.maxx) / 2, 2.25, (bx.minz + bx.maxz) / 2);
          mesh.castShadow = true;
          levelGroup.add(mesh);
          const light = new THREE.PointLight(color, 0.9, 7, 2);
          light.position.set(cxm, 2.6, czm);
          levelGroup.add(light);
          const lbl = makeLabelSprite(isGate ? "⏱" : String(id), isGate ? "#ffd43b" : id === 1 ? "#2ee0ff" : id === 2 ? "#ffd43b" : "#b06cff");
          lbl.position.set(cxm, 5.6, czm);
          levelGroup.add(lbl);
          if (isGate) gates.push({ box: bx, mesh, light, closedY: 2.25, openY: -3.6 });
          else doors.push({ id, box: bx, mesh, light, open: false, closedY: 2.25, openY: -3.6 });
        }
      }
    }

    // Exit portal
    exitRing = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.09, 12, 40),
      new THREE.MeshStandardMaterial({ color: C.yellow, emissive: C.yellow, emissiveIntensity: 1.1 })
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 32),
      new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    exitRing.add(ring); exitRing.add(disc);
    exitRing.position.set(exitPos.x, exitPos.y + 1.35, exitPos.z);
    levelGroup.add(exitRing);
    exitLight = new THREE.PointLight(C.yellow, 1.1, 9, 2);
    exitLight.position.set(exitPos.x, exitPos.y + 1.6, exitPos.z);
    levelGroup.add(exitLight);

    echoes.forEach((e) => { if (e.group) scene.remove(e.group); });
    echoes = [];
    levelTime = 0;
    resetLoop();
  }

  function resetLoop() {
    player.x = spawn.x; player.y = spawn.y; player.z = spawn.z;
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.yaw = spawn.yaw; player.pitch = 0;
    player.grounded = false; player.coyote = 0; player.jumpBuf = 0; player.standEcho = -1;
    crates.forEach((c) => { if (c.mesh) levelGroup.remove(c.mesh); });
    crates = cratesInit.map((ci) => {
      const mesh = addBoxMesh(levelGroup, -CRATE / 2, 0, -CRATE / 2, CRATE / 2, CRATE, CRATE / 2, MAT.crate, edgeMatCyan);
      // addBoxMesh centered the mesh at origin box; reposition to crate location
      mesh.position.set(ci.x, ci.y + CRATE / 2, ci.z);
      return { x: ci.x, y: ci.y, z: ci.z, vy: 0, mesh };
    });
    rec = { xs: [], ys: [], zs: [], yw: [] };
    stepIdx = 0;
    gateOpen = computeGateOpen(0);
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
    const group = makeEchoFigure(echoes.length + 1);
    scene.add(group);
    echoes.push({ xs: rec.xs, ys: rec.ys, zs: rec.zs, yw: rec.yw, len: rec.xs.length, group });
    Sound.commit();
    api.toast(`Echo ${echoes.length} recorded — the room rewinds`, "good");
    resetLoop();
  }

  function retryLoop(silent) {
    if (phase !== "play") return;
    Sound.retry();
    if (!silent) api.toast("Loop rewound — your echoes remember", "");
    resetLoop();
  }

  function restartLevel() {
    echoes.forEach((e) => scene.remove(e.group));
    echoes = [];
    levelTime = 0;
    resetLoop();
    api.toast("Level restarted — all echoes cleared", "");
  }

  function doUndoEcho() {
    if (echoes.length === 0) return;
    const e = echoes.pop();
    scene.remove(e.group);
    resetLoop();
    api.toast(`Echo erased — ${echoes.length} left. Loop rewound.`, "good");
  }

  function undoEcho() {
    if (phase !== "play") return;
    if (echoes.length === 0) { api.toast("No echoes to undo yet", ""); return; }
    if (api.consumePowerup("echoloop-undo")) { doUndoEcho(); return; }
    if (api.isAdFree()) { doUndoEcho(); api.toast("Pro perk: free echo undo", "good"); return; }
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

  // ---------- Physics ----------
  function collideStatics(box) {
    for (const s of solids) if (boxesOverlap(box, s)) return s;
    for (const d of doors) if (!d.open && boxesOverlap(box, d.box)) return d.box;
    for (const g of gates) if (!gateOpen && boxesOverlap(box, g.box)) return g.box;
    return null;
  }

  function crateTryMove(crate, dx, dz) {
    // Move a crate horizontally, blocked by statics, closed doors and other crates.
    let nx = crate.x + dx, nz = crate.z + dz;
    let box = aabb(nx - CRATE / 2, crate.y + 0.05, nz - CRATE / 2, nx + CRATE / 2, crate.y + CRATE, nz + CRATE / 2);
    if (collideStatics(box)) return false;
    for (const other of crates) {
      if (other === crate) continue;
      if (boxesOverlap(box, crateBox(other))) return false;
    }
    crate.x = nx; crate.z = nz;
    return true;
  }

  function crateStep(crate) {
    crate.vy = Math.max(crate.vy - GRAV * DT, -MAX_FALL);
    let ny = crate.y + crate.vy * DT;
    let box = aabb(crate.x - CRATE / 2, ny, crate.z - CRATE / 2, crate.x + CRATE / 2, ny + CRATE, crate.z + CRATE / 2);
    const hit = collideStatics(box);
    if (hit && crate.vy < 0) { ny = hit.maxy; crate.vy = 0; }
    for (const other of crates) {
      if (other === crate) continue;
      const ob = crateBox(other);
      if (boxesOverlap(aabb(crate.x - CRATE / 2, ny, crate.z - CRATE / 2, crate.x + CRATE / 2, ny + CRATE, crate.z + CRATE / 2), ob) && crate.vy <= 0) {
        ny = ob.maxy; crate.vy = 0;
      }
    }
    crate.y = ny;
    if (crate.y < KILL_Y - 4) crate.y = KILL_Y - 4; // rest at abyss floor; loop reset will restore
  }

  function echoPosAt(e, step) {
    const i = Math.min(step, e.len - 1);
    return { x: e.xs[i], y: e.ys[i], z: e.zs[i], yaw: e.yw[i] };
  }

  function moveAxis(axis, amount) {
    // Sweep the player along one horizontal axis vs statics, doors and crates (with pushing).
    if (amount === 0) return;
    const p = player;
    let n = (axis === "x" ? p.x : p.z) + amount;
    const mk = () =>
      axis === "x"
        ? entBox(n, p.y + 0.05, p.z, P_HALF, P_H - 0.1)
        : entBox(p.x, p.y + 0.05, n, P_HALF, P_H - 0.1);
    const hit = collideStatics(mk());
    if (hit) {
      n = amount > 0
        ? (axis === "x" ? hit.minx : hit.minz) - P_HALF - 0.001
        : (axis === "x" ? hit.maxx : hit.maxz) + P_HALF + 0.001;
      if (collideStatics(mk())) n = axis === "x" ? p.x : p.z;
    }
    for (const crate of crates) {
      const cb = crateBox(crate);
      if (boxesOverlap(mk(), cb)) {
        // push if the crate is at foot level (not standing on top of it)
        const standing = p.y >= cb.maxy - 0.2;
        if (!standing) {
          const pushAmt = Math.sign(amount) * Math.min(Math.abs(amount), PUSH_SPEED * DT);
          crateTryMove(crate, axis === "x" ? pushAmt : 0, axis === "z" ? pushAmt : 0);
          const cb2 = crateBox(crate);
          n = amount > 0
            ? (axis === "x" ? cb2.minx : cb2.minz) - P_HALF - 0.001
            : (axis === "x" ? cb2.maxx : cb2.maxz) + P_HALF + 0.001;
          if (collideStatics(mk())) n = axis === "x" ? p.x : p.z;
        }
      }
    }
    if (axis === "x") p.x = n; else p.z = n;
  }

  function simStep() {
    stepIdx++;
    levelTime += DT;
    const p = player;

    // Timed gate: driven purely by the loop clock
    const wasGate = gateOpen;
    gateOpen = computeGateOpen(stepIdx);
    if (gateOpen !== wasGate && stepIdx > 1) Sound.door();

    // Echo playback positions
    const echoNow = echoes.map((e) => echoPosAt(e, stepIdx));
    const echoPrev = echoes.map((e) => echoPosAt(e, Math.max(0, stepIdx - 1)));

    // Echoes shove crates (XZ overlap resolution, capped)
    for (let i = 0; i < echoes.length; i++) {
      const ep = echoNow[i];
      const eb = entBox(ep.x, ep.y + 0.1, ep.z, P_HALF, P_H - 0.2);
      for (const crate of crates) {
        const cb = crateBox(crate);
        if (boxesOverlap(eb, cb) && ep.y < cb.maxy - 0.2) {
          const ddx = crate.x - ep.x, ddz = crate.z - ep.z;
          const cap = ECHO_PUSH * DT;
          if (Math.abs(ddx) > Math.abs(ddz)) crateTryMove(crate, Math.sign(ddx) * cap, 0);
          else crateTryMove(crate, 0, Math.sign(ddz) * cap);
        }
      }
    }

    // Riding an echo: follow its motion, feet pinned to its head, vy MUST be zeroed
    if (p.standEcho >= 0) {
      if (p.standEcho >= echoes.length) p.standEcho = -1;
      else {
        const now = echoNow[p.standEcho], prev = echoPrev[p.standEcho];
        const top = now.y + P_H;
        const on =
          Math.abs(p.x - now.x) < P_HALF * 2 - 0.05 &&
          Math.abs(p.z - now.z) < P_HALF * 2 - 0.05 &&
          Math.abs(p.y - top) < 0.35 && p.vy <= 0.01;
        if (on) {
          p.x += now.x - prev.x;
          p.z += now.z - prev.z;
          p.y = top;
          p.vy = 0;
          p.grounded = true;
          p.coyote = COYOTE;
        } else p.standEcho = -1;
      }
    }

    // Input -> horizontal velocity (yaw-relative, deterministic per step)
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    f += touch.f; s += touch.s;
    const mag = Math.hypot(f, s);
    if (mag > 1) { f /= mag; s /= mag; }
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const vx = (-sin * f + cos * s) * SPEED;
    const vz = (-cos * f - sin * s) * SPEED;

    // Jump (buffered + coyote)
    const jumpHeld = keys.Space || touch.jump;
    if (jumpHeld && !p.jumpLatch) { p.jumpBuf = JUMP_BUFFER; p.jumpLatch = true; }
    if (!jumpHeld) p.jumpLatch = false;
    if (p.jumpBuf > 0) p.jumpBuf--;
    if (p.coyote > 0) p.coyote--;
    if (p.jumpBuf > 0 && (p.grounded || p.coyote > 0)) {
      p.vy = JUMP_V;
      p.grounded = false; p.coyote = 0; p.jumpBuf = 0; p.standEcho = -1;
      Sound.jump();
    }

    // Horizontal sweeps
    moveAxis("x", vx * DT);
    moveAxis("z", vz * DT);

    // Vertical
    p.vy = Math.max(p.vy - GRAV * DT, -MAX_FALL);
    const prevFeet = p.y;
    let ny = p.y + p.vy * DT;
    let landed = false;
    // Vertical resolution rules (bug lesson: a side graze while RISING must
    // never trigger the ceiling clamp, or the player gets teleported under
    // the obstacle and buried):
    //  - falling with feet near the top      -> land on it
    //  - rising with head below the bottom   -> genuine head bonk
    //  - anything else is a side graze       -> leave y alone, the horizontal
    //    sweeps keep resolving it
    const vbox = () => entBox(p.x, ny, p.z, P_HALF - 0.02, P_H);
    const hit = collideStatics(vbox());
    if (hit) {
      if (p.vy <= 0 && prevFeet >= hit.maxy - 0.45) { ny = hit.maxy; landed = true; p.vy = 0; }
      else if (p.vy > 0 && prevFeet + P_H <= hit.miny + 0.3) { ny = hit.miny - P_H - 0.001; p.vy = 0; }
    }
    for (const crate of crates) {
      const cb = crateBox(crate);
      if (boxesOverlap(entBox(p.x, ny, p.z, P_HALF - 0.02, P_H), cb)) {
        if (p.vy <= 0 && prevFeet >= cb.maxy - 0.45) { ny = cb.maxy; landed = true; p.vy = 0; }
        else if (p.vy > 0 && prevFeet + P_H <= cb.miny + 0.3) { ny = cb.miny - P_H - 0.001; p.vy = 0; }
      }
    }
    // Echo heads: land from above only
    if (p.vy <= 0 && p.standEcho < 0) {
      for (let i = 0; i < echoes.length; i++) {
        const ep = echoNow[i];
        const top = ep.y + P_H;
        if (
          Math.abs(p.x - ep.x) < P_HALF * 2 - 0.05 &&
          Math.abs(p.z - ep.z) < P_HALF * 2 - 0.05 &&
          prevFeet >= top - 0.12 && ny <= top
        ) {
          ny = top; p.vy = 0; landed = true; p.standEcho = i;
          break;
        }
      }
    }
    p.y = ny;
    if (landed) { p.grounded = true; p.coyote = COYOTE; }
    else if (p.standEcho < 0) p.grounded = false;

    // Squeezed by a closing door: shove out sideways
    if (collideStatics(entBox(p.x, p.y + 0.05, p.z, P_HALF - 0.02, P_H - 0.1))) {
      let freed = false;
      for (const off of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
        if (!collideStatics(entBox(p.x + off[0], p.y + 0.05, p.z + off[1], P_HALF - 0.02, P_H - 0.1))) {
          p.x += off[0]; p.z += off[1]; freed = true; break;
        }
      }
      if (!freed) { die(); return; }
    }

    // Crates fall
    for (const crate of crates) crateStep(crate);

    // Plates & doors
    updatePlatesAndDoors(echoNow);

    // Record AFTER physics (echoes replay resolved positions exactly)
    rec.xs.push(p.x); rec.ys.push(p.y); rec.zs.push(p.z); rec.yw.push(p.yaw);

    // Hazards
    if (p.y < KILL_Y) { die(); return; }

    // Exit
    const eb = entBox(p.x, p.y, p.z, P_HALF, P_H);
    const xb = aabb(exitPos.x - 0.9, exitPos.y - 0.3, exitPos.z - 0.9, exitPos.x + 0.9, exitPos.y + 2.4, exitPos.z + 0.9);
    if (boxesOverlap(eb, xb)) { levelComplete(); return; }

    // Loop timer
    if (stepIdx >= loopSteps) {
      api.toast("⏳ Loop expired — press R to commit an echo before time runs out", "bad");
      retryLoop(true);
    }
  }

  function updatePlatesAndDoors(echoNow) {
    const pressed = {};
    const pb = entBox(player.x, player.y, player.z, P_HALF, P_H);
    for (const pl of plates) {
      let hit = boxesOverlap(pb, pl.box);
      if (!hit && echoNow) {
        for (const ep of echoNow) {
          if (boxesOverlap(entBox(ep.x, ep.y, ep.z, P_HALF, P_H), pl.box)) { hit = true; break; }
        }
      }
      if (!hit) {
        for (const crate of crates) {
          if (boxesOverlap(crateBox(crate), pl.box)) { hit = true; break; }
        }
      }
      if (hit) pressed[pl.id] = true;
      if (hit && !pl.pressed) Sound.plate();
      pl.pressed = !!hit;
    }
    for (const d of doors) {
      const was = d.open;
      d.open = !!pressed[d.id];
      if (d.open !== was && stepIdx > 1) Sound.door();
    }
  }

  function die() {
    Sound.death();
    if (flashEl) {
      flashEl.style.opacity = "0.5";
      setTimeout(() => { flashEl.style.opacity = "0"; }, 180);
    }
    api.toast("💥 Paradox! Loop rewound — echoes intact", "bad");
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
      (isHigh ? `<br>🏆 <strong style="color:#ffd43b">NEW HIGH SCORE</strong>` : "");

    unlockPointer();
    if (levelIdx >= LEVELS.length - 1) {
      phase = "won";
      showOverlay(
        "⭯ ALL TIMELINES STABLE",
        "Fifteen rooms, one timeline — and you were <em>inside</em> the loop for all of it. Somewhere, a crowd of you takes off their headsets in perfect sync.",
        statLine + `<br><br>Final score: <strong style="color:#ffd43b">${totalScore}</strong> · Best: <strong>${Math.max(totalScore, bestAtStart)}</strong>`,
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
    const gateLine = L.gate ? `<br>⏱ Timed gate: open <strong>${L.gate[0]}s–${L.gate[1]}s</strong> of every loop` : "";
    showOverlay(
      `LEVEL ${idx + 1}: ${L.name}`,
      `${L.sub}<br><br><span style="opacity:.75">Loop budget: <strong>${L.maxLoops}</strong> · Par: <strong>${L.par}</strong> · Loop length: <strong>${L.loopSec}s</strong>${gateLine}</span>`,
      "",
      "Enter the loop",
      () => { phase = "play"; hideOverlay(); Sound.resume(); lockPointer(); }
    );
    updateHud();
  }

  // ---------- Pointer lock ----------
  let pointerLocked = false;
  function lockPointer() {
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }
  function unlockPointer() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (crosshair) crosshair.style.opacity = pointerLocked ? "1" : "0.25";
    if (!pointerLocked && phase === "play") setPaused(true);
  });
  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked || phase !== "play") return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch -= e.movementY * 0.0022;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  });
  canvas.addEventListener("click", () => {
    if (phase === "play" && !pointerLocked) lockPointer();
  });

  // ---------- Overlay / HUD ----------
  let overlayAction = null;
  function showOverlay(title, sub, score, btnText, action) {
    overlayTitle.innerHTML = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = score || "";
    overlayScore.style.display = score ? "" : "none";
    btnPrimary.textContent = btnText;
    overlayAction = action;
    overlayEl.classList.add("overlay--show");
  }
  function hideOverlay() { overlayEl.classList.remove("overlay--show"); }

  function setPaused(pz) {
    if (pz && phase === "play") {
      phase = "paused";
      unlockPointer();
      showOverlay("⏸ PAUSED", "The loop holds its breath. (Click Resume to re-capture the mouse.)", "", "Resume", () => { phase = "play"; hideOverlay(); lockPointer(); });
      btnPause.textContent = "Resume";
    } else if (!pz && phase === "paused") {
      phase = "play";
      hideOverlay();
      btnPause.textContent = "Pause";
    }
  }

  function updateHud() {
    hudLevel.textContent = `${Math.min(levelIdx + 1, LEVELS.length)}/${LEVELS.length}`;
    const secsLeft = Math.max(0, (loopSteps - stepIdx) / 60);
    hudTime.textContent = secsLeft.toFixed(1) + "s";
    hudTime.style.color = secsLeft < 6 ? "#ff4f68" : "";
    hudLoops.textContent = `${loopsUsed()}/${maxLoops}`;
    hudScore.textContent = totalScore;
    hudBest.textContent = Math.max(bestAtStart, api.getHighScore(GAME_ID) || 0, totalScore);
    if (timerBar) {
      const frac = Math.max(0, 1 - stepIdx / loopSteps);
      timerBar.style.width = (frac * 100).toFixed(1) + "%";
      timerBar.style.background = frac < 0.2 ? "#ff4f68" : "#2ee0ff";
    }
  }

  // ---------- Render ----------
  function render() {
    renderTime += 1 / 60;

    // Camera follows the player (first person)
    camera.position.set(player.x, player.y + EYE, player.z);
    camera.rotation.order = "YXZ";
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    torch.position.set(player.x, player.y + EYE, player.z);
    moon.target.position.set(player.x, 0, player.z);

    // Echo figures
    for (let i = 0; i < echoes.length; i++) {
      const e = echoes[i];
      const pNow = echoPosAt(e, stepIdx);
      e.group.position.set(pNow.x, pNow.y, pNow.z);
      e.group.rotation.y = pNow.yaw;
    }

    // Crates
    for (const crate of crates) crate.mesh.position.set(crate.x, crate.y + CRATE / 2, crate.z);

    // Plates: light + emissive respond in real time
    for (const pl of plates) {
      pl.light.intensity += ((pl.pressed ? 1.3 : 0) - pl.light.intensity) * 0.25;
      pl.mesh.material.emissiveIntensity = pl.pressed ? 1.1 : 0.25;
    }
    // Doors: slide + light
    for (const d of doors) {
      const ty = d.open ? d.openY : d.closedY;
      d.mesh.position.y += (ty - d.mesh.position.y) * 0.12;
      d.light.intensity += ((d.open ? 0.15 : 0.95) - d.light.intensity) * 0.2;
      d.mesh.material.opacity = d.open ? 0.25 : 0.85;
    }
    // Timed gates: slide on the loop's schedule, pulse when about to change
    for (const g of gates) {
      const ty = gateOpen ? g.openY : g.closedY;
      g.mesh.position.y += (ty - g.mesh.position.y) * 0.12;
      const pulse = gateWindow && Math.abs(stepIdx - gateWindow[0] * 60) < 120 ? Math.sin(renderTime * 10) * 0.4 : 0;
      g.light.intensity += ((gateOpen ? 0.2 : 1.0 + pulse) - g.light.intensity) * 0.2;
      g.mesh.material.opacity = gateOpen ? 0.25 : 0.85;
    }
    // Exit portal pulse + spin
    if (exitRing) {
      exitRing.rotation.y = renderTime * 0.9;
      const pulse = 1 + Math.sin(renderTime * 4) * 0.08;
      exitRing.scale.set(pulse, pulse, pulse);
      exitLight.intensity = 1.0 + Math.sin(renderTime * 4) * 0.35;
    }
    // Low-timer mood: the moonlight goes red when the loop is dying
    const frac = Math.max(0, 1 - stepIdx / loopSteps);
    if (phase === "play" && frac < 0.18) {
      const t = 0.5 + Math.sin(renderTime * 9) * 0.5;
      moon.color.setHex(0xff4f68);
      moon.intensity = 0.5 + t * 0.35;
    } else {
      moon.color.setHex(0x8fb8ff);
      moon.intensity = 0.65;
    }

    renderer.render(scene, camera);
  }

  // ---------- Main loop ----------
  let lastT = 0, acc = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = t - lastT;
    lastT = t;
    if (dt > 250) dt = 250;
    if (phase === "play") {
      acc += dt;
      let guard = 0;
      while (acc >= STEP_MS && guard < 6) {
        simStep();
        acc -= STEP_MS;
        guard++;
        if (phase !== "play") { acc = 0; break; }
      }
    } else acc = 0;
    render();
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

  // Touch: left half of the canvas = move stick, right half = look drag.
  function setupTouch() {
    let moveId = -1, lookId = -1;
    let moveStart = null, lookLast = null;
    const rectOf = () => canvas.getBoundingClientRect();
    canvas.addEventListener("touchstart", (e) => {
      Sound.resume();
      const r = rectOf();
      for (const t of e.changedTouches) {
        if (t.clientX - r.left < r.width / 2 && moveId < 0) {
          moveId = t.identifier;
          moveStart = { x: t.clientX, y: t.clientY };
        } else if (lookId < 0) {
          lookId = t.identifier;
          lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      if (phase === "play") e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId && moveStart) {
          const dx = (t.clientX - moveStart.x) / 46;
          const dy = (t.clientY - moveStart.y) / 46;
          touch.s = Math.max(-1, Math.min(1, dx));
          touch.f = Math.max(-1, Math.min(1, -dy));
        } else if (t.identifier === lookId && lookLast) {
          player.yaw -= (t.clientX - lookLast.x) * 0.006;
          player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - (t.clientY - lookLast.y) * 0.005));
          lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      if (phase === "play") e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { moveId = -1; touch.f = 0; touch.s = 0; }
        if (t.identifier === lookId) lookId = -1;
      }
    };
    canvas.addEventListener("touchend", endTouch);
    canvas.addEventListener("touchcancel", endTouch);

    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("touchstart", (e) => { e.preventDefault(); Sound.resume(); fn(true); }, { passive: false });
      if (el && fn.length) {
        el.addEventListener("touchend", (e) => { e.preventDefault(); fn(false); }, { passive: false });
        el.addEventListener("touchcancel", (e) => { e.preventDefault(); fn(false); }, { passive: false });
      }
    };
    bind("el-touch-jump", (v) => { touch.jump = v; });
    const tl = document.getElementById("el-touch-loop");
    if (tl) tl.addEventListener("touchstart", (e) => { e.preventDefault(); commitLoop(); }, { passive: false });
    const tr = document.getElementById("el-touch-retry");
    if (tr) tr.addEventListener("touchstart", (e) => { e.preventDefault(); retryLoop(); }, { passive: false });
  }

  // ---------- Init ----------
  function init() {
    bestAtStart = api.getHighScore(GAME_ID) || 0;

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    btnPrimary.addEventListener("click", () => { if (overlayAction) overlayAction(); });
    btnLoop.addEventListener("click", () => { Sound.resume(); commitLoop(); });
    btnRetry.addEventListener("click", () => { Sound.resume(); retryLoop(); });
    btnUndo.addEventListener("click", () => undoEcho());
    btnRestart.addEventListener("click", () => { if (phase === "play") restartLevel(); });
    btnPause.addEventListener("click", () => setPaused(phase === "play"));
    btnSound.addEventListener("click", () => {
      const m = Sound.toggleMute();
      btnSound.textContent = m ? "Sound Off" : "Sound On";
      btnSound.setAttribute("aria-pressed", String(!m));
    });
    setupTouch();

    document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });

    try {
      if (!localStorage.getItem("rb_echoloop3d_starter")) {
        localStorage.setItem("rb_echoloop3d_starter", "1");
        api.grantPowerup("echoloop-undo");
      }
    } catch (e) {}

    loadLevel(0);
    phase = "idle";
    showOverlay(
      "⭯ ECHO LOOP 3D",
      "The looping room, from the inside. <strong>WASD</strong> to move, <strong>mouse</strong> to look, <strong>Space</strong> jumps. " +
      "<strong>Press R</strong> to close a loop: the room rewinds and a translucent <strong style=\"color:#2ee0ff\">echo</strong> replays your last run, forever. " +
      "Climb your own shoulders. Leave yourself holding the door. <strong>A few past selves, one puzzle.</strong>",
      bestAtStart ? `Best score: <strong>${bestAtStart}</strong>` : "",
      "Start looping",
      () => { totalScore = 0; startLevel(0); }
    );
    updateHud();
    requestAnimationFrame(frame);
  }

  // Debug hook (rAF-independent test drivers, same pattern as __ECHO)
  window.__ECHO3D = {
    get state() {
      return {
        phase, levelIdx, echoes: echoes.length, stepIdx, totalScore,
        player: { x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), standEcho: player.standEcho },
        crates: crates.map((c) => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) })),
        echoPos: echoes.map((e) => { const q = echoPosAt(e, stepIdx); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }; }),
        doors: doors.map((d) => ({ id: d.id, open: d.open })),
        plates: plates.map((pl) => ({ id: pl.id, pressed: pl.pressed })),
        gateOpen,
      };
    },
    key(code, down) { keys[code] = !!down; },
    look(yaw, pitch) { player.yaw = yaw; if (pitch !== undefined) player.pitch = pitch; },
    step(n) { let i = 0; while (i++ < (n || 1) && phase === "play") simStep(); },
    goto(n) { totalScore = 0; startLevel(Math.max(0, Math.min(LEVELS.length - 1, n))); },
    win() { if (phase === "play") levelComplete(); },
    commit: () => commitLoop(),
    LEVELS,
  };

  init();
})();
