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
  const ECHO_FAST_FORWARD_MULT = 5;

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
      par: 3, maxLoops: 4, loopSec: 50,
      enemies: [{ type: "watcher", c: 13, r: 5, dx: -1, dz: 0, range: 10, lockSteps: 56 }],
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
      par: 3, maxLoops: 3, loopSec: 45,
      enemies: [{ type: "sweeper", c1: 5, r1: 4, c2: 10, r2: 4, period: 210, width: 3.2 }],
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
      enemies: [{ type: "watcher", c: 9, r: 6, dx: -1, dz: 0, range: 9, lockSteps: 56 }],
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
      par: 3, maxLoops: 3, loopSec: 50,
      enemies: [{ type: "sweeper", c1: 7, r1: 4, c2: 13, r2: 4, period: 220, phase: 45, width: 3.2 }],
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
      par: 4, maxLoops: 4, loopSec: 50,
      enemies: [
        { type: "watcher", c: 8, r: 4, dx: -1, dz: 0, range: 5, lockSteps: 54 },
        { type: "watcher", c: 13, r: 4, dx: -1, dz: 0, range: 5, lockSteps: 54 },
      ],
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
      par: 4, maxLoops: 4, loopSec: 55,
      enemies: [
        { type: "watcher", c: 10, r: 4, dx: -1, dz: 0, range: 9, lockSteps: 58 },
        { type: "sweeper", c1: 5, r1: 4, c2: 9, r2: 4, period: 240, phase: 80, width: 3.1 },
      ],
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
      name: "RELAY LOCK",
      sub: "Two doors. Two holders. Build the handoff, then run the whole relay.",
      par: 3, maxLoops: 3, loopSec: 45,
      enemies: [{ type: "sweeper", c1: 9, r1: 4, c2: 11, r2: 4, period: 190, phase: 35, width: 2.8 }],
      heights: [
        "#################",
        "#0000000#000#000#",
        "#0000000#000#000#",
        "#0000000#000#330#",
        "#000000000000330#",
        "#0000000#000#330#",
        "#0000000#000#000#",
        "#0000000#000#000#",
        "#################",
      ],
      items: [
        ".................",
        ".................",
        ".................",
        ".................",
        "..S...p.P..qQX...",
        ".................",
        ".................",
        ".................",
        ".................",
      ],
    },
    {
      name: "THE FERRY",
      sub: "Ride your bouncing echo onto the wall top, leave yourself holding the plate, ride again.",
      par: 3, maxLoops: 3, loopSec: 50,
      enemies: [{ type: "watcher", c: 12, r: 4, dx: -1, dz: 0, range: 7, lockSteps: 54 }],
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
      enemies: [
        { type: "watcher", c: 12, r: 4, dx: -1, dz: 0, range: 7, lockSteps: 54 },
        { type: "sweeper", c1: 5, r1: 4, c2: 8, r2: 4, period: 180, phase: 60, width: 3.0 },
      ],
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
      sub: "Crate, relay, stack, plate. Every door opens because a past self earns it.",
      par: 4, maxLoops: 4, loopSec: 60,
      enemies: [
        { type: "watcher", c: 10, r: 5, dx: -1, dz: 0, range: 6, lockSteps: 56 },
        { type: "sweeper", c1: 12, r1: 5, c2: 16, r2: 5, period: 175, phase: 20, width: 3.1 },
      ],
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
        "..SK.p.P.r.R.....QX.",
        "..............K.....",
        "....................",
        "....................",
        "....................",
        "....................",
      ],
    },
    {
      name: "BOOTSTRAP RELAY",
      sub: "Each echo is both a step and a key. Build the route, then climb your own solution.",
      par: 3, maxLoops: 3, loopSec: 45,
      enemies: [
        { type: "watcher", c: 10, r: 4, dx: -1, dz: 0, range: 7, lockSteps: 52 },
        { type: "sweeper", c1: 13, r1: 4, c2: 15, r2: 4, period: 160, phase: 35, width: 3.0 },
      ],
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
        "..S........r....R.X.",
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
  const btnPauseMenu = document.getElementById("btn-pause-menu");
  const btnSound = document.getElementById("btn-sound");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const crosshair = document.getElementById("el3d-crosshair");
  const flashEl = document.getElementById("el3d-flash");
  const timerBar = document.getElementById("el3d-timerbar");
  const fastEl = document.getElementById("el3d-fast");
  const securityEl = document.getElementById("el3d-security");

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
      alert: () => beep(760, 0.09, "square", 0.032, 120),
      fire: () => beep(110, 0.12, "sawtooth", 0.045, -45),
      win: () => { beep(440, 0.12, "square", 0.05); setTimeout(() => beep(660, 0.12, "square", 0.05), 110); setTimeout(() => beep(880, 0.2, "square", 0.05), 220); },
      step: () => beep(70, 0.04, "triangle", 0.012),
      toggleMute() { muted = !muted; return muted; },
    };
  })();

  // ---------- Three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setSize(1280, 720, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.FogExp2(C.bg, 0.027);

  const camera = new THREE.PerspectiveCamera(75, 1280 / 720, 0.1, 120);

  // An open, procedural timeline sky replaces the old seven-meter ceiling.
  // It follows the camera so it reads as infinitely distant and can never
  // intersect tower geometry, doors, labels, or echoes.
  const timelineSkyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uDeep: { value: new THREE.Color(C.bg) },
      uCyan: { value: new THREE.Color(C.cyan) },
      uPink: { value: new THREE.Color(C.pink) },
      uYellow: { value: new THREE.Color(C.yellow) },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uPhase;
      uniform vec3 uDeep;
      uniform vec3 uCyan;
      uniform vec3 uPink;
      uniform vec3 uYellow;
      varying vec3 vSkyDirection;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 d = normalize(vSkyDirection);
        float height = d.y * 0.5 + 0.5;
        float azimuth = atan(d.z, d.x);

        vec3 zenith = mix(vec3(0.012, 0.020, 0.075), vec3(0.055, 0.010, 0.080), uPhase);
        vec3 horizon = mix(vec3(0.020, 0.105, 0.145), vec3(0.155, 0.025, 0.090), uPhase);
        vec3 color = mix(horizon, zenith, smoothstep(0.34, 0.92, height));
        color = mix(uDeep, color, 0.78);

        // Two flowing temporal seams wrap the whole horizon.
        float seamCenter = 0.08
          + sin(azimuth * 2.4 + uTime * 0.035) * 0.075
          + sin(azimuth * 6.5 - uTime * 0.022) * 0.028;
        float seam = exp(-pow((d.y - seamCenter) * 12.0, 2.0));
        float seamCore = exp(-pow((d.y - seamCenter - 0.035) * 38.0, 2.0));
        float colorCycle = 0.5 + 0.5 * sin(azimuth * 2.0 + uTime * 0.08);
        vec3 seamColor = mix(uCyan, uPink, colorCycle);
        color += seamColor * seam * (0.12 + uPhase * 0.08);
        color += mix(uCyan, uPink, uPhase) * seamCore * 0.16;

        // A distant broken time-loop hangs above the arena.
        vec3 haloAxis = normalize(vec3(-0.48, 0.30, -0.82));
        float haloAngle = acos(clamp(dot(d, haloAxis), -1.0, 1.0));
        float halo = exp(-pow((haloAngle - 0.34) * 48.0, 2.0));
        float haloEcho = exp(-pow((haloAngle - 0.39) * 74.0, 2.0));
        color += mix(uCyan, uYellow, uPhase) * halo * (0.42 + 0.08 * sin(uTime * 0.7));
        color += uPink * haloEcho * 0.16;

        // Deterministic star cells with a very slow temporal shimmer.
        const float PI = 3.14159265359;
        vec2 starCell = floor(vec2((azimuth + PI) / (2.0 * PI) * 420.0, height * 210.0));
        float starSeed = hash21(starCell);
        float star = step(0.9925, starSeed) * smoothstep(0.22, 0.62, height);
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.35 + starSeed) + starSeed * 31.0);
        color += mix(vec3(0.72, 0.92, 1.0), vec3(1.0, 0.66, 0.86), step(0.997, starSeed)) * star * twinkle;

        float horizonGlow = exp(-abs(d.y) * 8.0);
        color += mix(uCyan, uPink, uPhase) * horizonGlow * 0.035;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const timelineSky = new THREE.Mesh(new THREE.SphereGeometry(95, 48, 28), timelineSkyMaterial);
  timelineSky.frustumCulled = false;
  timelineSky.renderOrder = -1000;
  scene.add(timelineSky);

  // --- Real-time lighting rig ---
  const hemi = new THREE.HemisphereLight(0x334272, 0x070711, 0.82);
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
  const rim = new THREE.DirectionalLight(C.pink, 0.22);
  rim.position.set(-22, 11, -18);
  scene.add(rim);
  const torch = new THREE.PointLight(0xdffaff, 0.82, 15, 2);
  scene.add(torch);

  function makePanelTexture(kind) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const c = cv.getContext("2d");
    const isFloor = kind === "floor";
    const g = c.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, isFloor ? "#202a4a" : "#18203b");
    g.addColorStop(0.5, isFloor ? "#11172d" : "#0d1327");
    g.addColorStop(1, "#080b18");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = isFloor ? "rgba(46,224,255,.22)" : "rgba(255,46,136,.16)";
    c.lineWidth = 3;
    c.strokeRect(5, 5, 246, 246);
    c.strokeStyle = "rgba(130,165,220,.11)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(128, 7); c.lineTo(128, 249);
    c.moveTo(7, 128); c.lineTo(249, 128);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,.08)";
    c.fillRect(12, 12, 96, 3);
    c.fillStyle = isFloor ? "rgba(46,224,255,.48)" : "rgba(255,46,136,.38)";
    for (const [x, y] of [[18,18],[238,18],[18,238],[238,238]]) {
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    }
    if (!isFloor) {
      c.fillStyle = "rgba(46,224,255,.13)";
      c.fillRect(18, 182, 78, 10);
      c.fillStyle = "rgba(255,212,59,.14)";
      c.fillRect(102, 182, 22, 10);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(isFloor ? 1.6 : 1, isFloor ? 1.6 : 1);
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  const floorTex = makePanelTexture("floor");
  const wallTex = makePanelTexture("wall");

  const MAT = {
    floor: new THREE.MeshStandardMaterial({ color: 0x27325a, map: floorTex, roughness: 0.72, metalness: 0.3 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x1a2342, map: wallTex, roughness: 0.76, metalness: 0.24 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x22305b, map: floorTex, roughness: 0.68, metalness: 0.34 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x6c5114, roughness: 0.58, metalness: 0.42, emissive: C.yellow, emissiveIntensity: 0.12 }),
  };
  const edgeMatCyan = new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.34 });
  const edgeMatPink = new THREE.LineBasicMaterial({ color: C.pink, transparent: true, opacity: 0.2 });

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
  let enemies = [];         // deterministic Watchers and Sweepers
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
  let echoStepIdx = 0;      // independent playback cursor; F accelerates echoes only
  let levelTime = 0;
  let renderTime = 0;
  let levelGroup = null;    // all level meshes
  let exitRing = null, exitLight = null;
  let roomMotes = null;
  let skyPulseLights = [];

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

  function addRoomArt(group, cols, rows) {
    const roomW = cols * CELL, roomD = rows * CELL;
    // Invisible temporal light pools retain readable real-time lighting without
    // placing any geometry above the level's tallest towers.
    skyPulseLights = [];
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(i ? C.pink : C.cyan, 0.46, 24, 2);
      light.position.set(roomW * (i ? 0.72 : 0.28), 11.5, roomD * (i ? 0.68 : 0.32));
      group.add(light);
      skyPulseLights.push(light);
    }

    // Deterministic volumetric-looking data dust.
    let seed = (levelIdx + 1) * 1777;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const positions = [];
    const colors = [];
    for (let i = 0; i < 240; i++) {
      positions.push(rand() * roomW, 0.3 + rand() * 10, rand() * roomD);
      const pink = i % 9 === 0;
      colors.push(pink ? 1 : 0.18, pink ? 0.18 : 0.88, pink ? 0.54 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending });
    roomMotes = new THREE.Points(geo, mat);
    group.add(roomMotes);
  }

  function makeCrateMesh() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(CRATE, CRATE, CRATE), MAT.crate);
    core.position.y = CRATE / 2;
    core.castShadow = true;
    core.receiveShadow = true;
    group.add(core);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(core.geometry),
      new THREE.LineBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.78 })
    );
    edges.position.copy(core.position);
    group.add(edges);
    const insetMat = new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), insetMat);
      plate.position.set(0, CRATE * 0.55, side * (CRATE / 2 + 0.006));
      if (side > 0) plate.rotation.y = Math.PI;
      group.add(plate);
    }
    const beacon = new THREE.PointLight(C.yellow, 0.32, 4.2, 2);
    beacon.position.set(0, CRATE + 0.2, 0);
    group.add(beacon);
    group.userData.beacon = beacon;
    return group;
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
      color: 0x8df3ff, emissive: C.cyan, emissiveIntensity: 0.72,
      transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const addBox = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };
    const addLimb = (x) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.58, 10), mat);
      m.position.set(x, 0.29, 0);
      group.add(m);
      return m;
    };
    addLimb(-0.17); addLimb(0.17);
    addBox(0.72, 0.62, 0.44, 0, 0.87, 0);
    addBox(0.82, 0.12, 0.48, 0, 1.12, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 10), mat);
    head.scale.set(1, 0.78, 0.78);
    head.position.set(0, 1.43, 0);
    group.add(head);
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.105, 0.035), visorMat);
    visor.position.set(0, 1.45, -0.245);
    group.add(visor);
    addBox(0.045, 0.22, 0.045, 0, 1.76, 0);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({ color: C.cyan, emissive: C.cyan, emissiveIntensity: 1.2 })
    );
    tip.position.set(0, 1.88, 0);
    group.add(tip);
    const core = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.025, 8, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending })
    );
    core.position.set(0, 0.88, -0.235);
    group.add(core);
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.78, 0.025, 28),
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    aura.position.y = 0.025;
    group.add(aura);
    const label = makeLabelSprite("E" + index, "#2ee0ff");
    label.position.set(0, 2.25, 0);
    group.add(label);
    const light = new THREE.PointLight(C.cyan, 0.55, 5.5, 2);
    light.position.set(0, 1.2, 0);
    group.add(light);
    group.userData.core = core;
    group.userData.aura = aura;
    group.userData.light = light;
    group.userData.index = index;
    return group;
  }

  function floorFromGrid(H, c, r) {
    const ch = H[r] && H[r][c];
    if (ch >= "0" && ch <= "9") return Number(ch);
    if (ch === "v") return -1;
    if (ch === "u") return -1.5;
    return 0;
  }

  function buildSecurity(L, H) {
    enemies = [];
    const defs = L.enemies || [];
    for (let index = 0; index < defs.length; index++) {
      const def = defs[index];
      if (def.type === "watcher") {
        const rawDx = def.dx === undefined ? -1 : def.dx;
        const rawDz = def.dz === undefined ? 0 : def.dz;
        const dirLen = Math.hypot(rawDx, rawDz) || 1;
        const dirX = rawDx / dirLen;
        const dirZ = rawDz / dirLen;
        const x = (def.c + 0.5) * CELL;
        const z = (def.r + 0.5) * CELL;
        const y = floorFromGrid(H, def.c, def.r) + 1.15;
        const group = new THREE.Group();
        group.position.set(x, y, z);

        const shellMat = new THREE.MeshStandardMaterial({
          color: 0x19070d, emissive: C.bad, emissiveIntensity: 0.36,
          roughness: 0.28, metalness: 0.72,
        });
        const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), shellMat);
        shell.scale.set(1.1, 0.82, 1.1);
        shell.castShadow = true;
        group.add(shell);

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.52, 0.035, 8, 28),
          new THREE.MeshBasicMaterial({ color: C.bad, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending })
        );
        ring.rotation.x = Math.PI / 2;
        group.add(ring);

        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 12, 8),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: C.bad, emissiveIntensity: 1.5 })
        );
        eye.position.set(dirX * 0.42, 0, dirZ * 0.42);
        group.add(eye);

        const beamPositions = new Float32Array([
          eye.position.x, eye.position.y, eye.position.z,
          eye.position.x + dirX, eye.position.y, eye.position.z + dirZ,
        ]);
        const beamGeo = new THREE.BufferGeometry();
        beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPositions, 3));
        const beamMat = new THREE.LineBasicMaterial({
          color: C.bad, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const beam = new THREE.Line(beamGeo, beamMat);
        group.add(beam);

        const light = new THREE.PointLight(C.bad, 0.55, 7, 2);
        group.add(light);
        const label = makeLabelSprite("WATCH", "#ff4f68");
        label.position.set(0, 1.05, 0);
        label.scale.multiplyScalar(0.72);
        group.add(label);
        levelGroup.add(group);

        enemies.push({
          ...def, index, type: "watcher", x, y, z, dirX, dirZ,
          rangeM: def.range || 10, group, shell, eye, ring, beam, beamGeo, beamMat, light,
          lock: 0, cooldown: 0, targetKey: "", target: null, fireFlash: 0, fireTarget: null,
        });
        continue;
      }

      const ax = (def.c1 + 0.5) * CELL, az = (def.r1 + 0.5) * CELL;
      const bx = (def.c2 + 0.5) * CELL, bz = (def.r2 + 0.5) * CELL;
      const pathLen = Math.hypot(bx - ax, bz - az) || 1;
      const dirX = (bx - ax) / pathLen, dirZ = (bz - az) / pathLen;
      const perpX = -dirZ, perpZ = dirX;
      const width = def.width || 3.2;
      const y = floorFromGrid(H, def.c1, def.r1) + 0.62;
      const group = new THREE.Group();
      const beamMat = new THREE.MeshStandardMaterial({
        color: 0xffd9df, emissive: C.bad, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.88, roughness: 0.18, metalness: 0.32, blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, width), beamMat);
      beam.rotation.y = Math.atan2(perpX, perpZ);
      group.add(beam);
      const aura = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.32, width + 0.2),
        new THREE.MeshBasicMaterial({ color: C.bad, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      aura.rotation.y = beam.rotation.y;
      group.add(aura);
      const light = new THREE.PointLight(C.bad, 0.9, 6, 2);
      group.add(light);
      const label = makeLabelSprite("SWEEP", "#ff4f68");
      label.position.set(0, 0.7, 0);
      label.scale.multiplyScalar(0.65);
      group.add(label);
      group.position.set(ax, y, az);
      levelGroup.add(group);

      const railGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax, y - 0.28, az), new THREE.Vector3(bx, y - 0.28, bz),
      ]);
      const rail = new THREE.Line(railGeo, new THREE.LineBasicMaterial({ color: C.bad, transparent: true, opacity: 0.2 }));
      levelGroup.add(rail);

      enemies.push({
        ...def, index, type: "sweeper", ax, az, bx, bz, x: ax, y, z: az,
        dirX, dirZ, perpX, perpZ, width, group, beam, aura, light,
      });
    }
  }

  function resetSecurity() {
    for (const enemy of enemies) {
      if (enemy.type === "watcher") {
        enemy.lock = 0;
        enemy.cooldown = 0;
        enemy.targetKey = "";
        enemy.target = null;
        enemy.fireFlash = 0;
        enemy.fireTarget = null;
        enemy.group.position.set(enemy.x, enemy.y, enemy.z);
        enemy.beamMat.opacity = 0.18;
      } else {
        enemy.x = enemy.ax;
        enemy.z = enemy.az;
        enemy.group.position.set(enemy.x, enemy.y, enemy.z);
      }
    }
  }

  // ---------- Level build ----------
  function loadLevel(idx) {
    levelIdx = idx;
    const L = LEVELS[idx];
    timelineSkyMaterial.uniforms.uPhase.value = LEVELS.length > 1 ? idx / (LEVELS.length - 1) : 0;
    maxLoops = L.maxLoops;
    loopSteps = L.loopSec * 60;

    if (levelGroup) { scene.remove(levelGroup); }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);

    solids = [];
    plates = [];
    doors = [];
    gates = [];
    enemies = [];
    gateWindow = L.gate || null;
    cratesInit = [];

    const H = L.heights, IT = L.items;
    const rows = H.length, cols = H[0].length;
    addRoomArt(levelGroup, cols, rows);

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
            new THREE.CylinderGeometry(0.82, 0.9, 0.13, 32),
            new THREE.MeshStandardMaterial({ color: 0x10172c, emissive: PAIR[id], emissiveIntensity: 0.25, roughness: 0.38, metalness: 0.62 })
          );
          mesh.position.set(cxm, fy + 0.06, czm);
          mesh.receiveShadow = true;
          levelGroup.add(mesh);
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.69, 0.035, 8, 28),
            new THREE.MeshBasicMaterial({ color: PAIR[id], transparent: true, opacity: 0.74 })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.set(cxm, fy + 0.135, czm);
          levelGroup.add(ring);
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
            color: isGate ? 0x2d2108 : 0x160a22, emissive: color, emissiveIntensity: 0.86,
            transparent: true, opacity: 0.82, roughness: 0.3, metalness: 0.58,
          });
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(bx.maxx - bx.minx, 5.5, bx.maxz - bx.minz),
            mat
          );
          mesh.position.set((bx.minx + bx.maxx) / 2, 2.25, (bx.minz + bx.maxz) / 2);
          mesh.castShadow = true;
          levelGroup.add(mesh);
          // Heavy portal frame gives the energy slab a believable machine housing.
          const frameMat = new THREE.MeshStandardMaterial({ color: 0x202a46, emissive: color, emissiveIntensity: 0.13, roughness: 0.5, metalness: 0.68 });
          if (wallAlongZ) {
            addBoxMesh(levelGroup, bx.minx - 0.18, -0.5, bx.minz, bx.minx + 0.1, 5.25, bx.minz + 0.25, frameMat);
            addBoxMesh(levelGroup, bx.minx - 0.18, -0.5, bx.maxz - 0.25, bx.minx + 0.1, 5.25, bx.maxz, frameMat);
            addBoxMesh(levelGroup, bx.minx - 0.18, 4.95, bx.minz, bx.maxx + 0.18, 5.25, bx.maxz, frameMat);
          } else {
            addBoxMesh(levelGroup, bx.minx, -0.5, bx.minz - 0.18, bx.minx + 0.25, 5.25, bx.minz + 0.1, frameMat);
            addBoxMesh(levelGroup, bx.maxx - 0.25, -0.5, bx.minz - 0.18, bx.maxx, 5.25, bx.minz + 0.1, frameMat);
            addBoxMesh(levelGroup, bx.minx, 4.95, bx.minz - 0.18, bx.maxx, 5.25, bx.maxz + 0.18, frameMat);
          }
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

    buildSecurity(L, H);

    // Exit portal
    exitRing = new THREE.Group();
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffec85, emissive: C.yellow, emissiveIntensity: 1.35, roughness: 0.2, metalness: 0.45 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.09, 12, 48), ringMat);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 32),
      new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    exitRing.add(ring); exitRing.add(disc);
    const ringPink = new THREE.Mesh(
      new THREE.TorusGeometry(1.28, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: C.pink, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending })
    );
    ringPink.rotation.x = 0.42;
    const ringCyan = new THREE.Mesh(
      new THREE.TorusGeometry(1.46, 0.018, 8, 48),
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending })
    );
    ringCyan.rotation.y = 0.5;
    exitRing.add(ringPink, ringCyan);
    exitRing.userData.ringPink = ringPink;
    exitRing.userData.ringCyan = ringCyan;
    exitRing.position.set(exitPos.x, exitPos.y + 1.35, exitPos.z);
    levelGroup.add(exitRing);
    exitLight = new THREE.PointLight(C.yellow, 1.45, 11, 2);
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
      const mesh = makeCrateMesh();
      levelGroup.add(mesh);
      mesh.position.set(ci.x, ci.y, ci.z);
      return { x: ci.x, y: ci.y, z: ci.z, vy: 0, mesh };
    });
    rec = { xs: [], ys: [], zs: [], yw: [] };
    stepIdx = 0;
    echoStepIdx = 0;
    gateOpen = computeGateOpen(0);
    resetSecurity();
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
    if (phase !== "play" && phase !== "paused") return;
    const wasPaused = phase === "paused";
    Sound.retry();
    if (!silent) api.toast("Loop rewound — your echoes remember", "");
    resetLoop();
    if (wasPaused) resumeAfterPausedReset();
  }

  function restartLevel() {
    const wasPaused = phase === "paused";
    echoes.forEach((e) => scene.remove(e.group));
    echoes = [];
    levelTime = 0;
    resetLoop();
    if (wasPaused) resumeAfterPausedReset();
    api.toast("Level restarted — all echoes cleared", "");
  }

  function resumeAfterPausedReset() {
    lockPointer();
    phase = "play";
    hideOverlay();
    btnPause.textContent = "Pause";
    Sound.resume();
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
    if (e.len <= 0) return { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw };
    const i = Math.max(0, Math.min(step, e.len - 1));
    return { x: e.xs[i], y: e.ys[i], z: e.zs[i], yaw: e.yw[i] };
  }

  function maxEchoStep() {
    let max = 0;
    for (const echo of echoes) max = Math.max(max, Math.max(0, echo.len - 1));
    return max;
  }

  function isEchoFastForwarding() {
    return phase === "play" && !!(keys.ShiftLeft || keys.ShiftRight) && echoes.length > 0 && echoStepIdx < maxEchoStep();
  }

  function securityLineBlocked(x1, y1, z1, x2, y2, z2) {
    const distance = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    const samples = Math.max(1, Math.ceil(distance / 0.35));
    for (let i = 2; i < samples; i++) {
      const t = i / samples;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const z = z1 + (z2 - z1) * t;
      if (collideStatics(aabb(x - 0.025, y - 0.025, z - 0.025, x + 0.025, y + 0.025, z + 0.025))) return true;
      for (const crate of crates) {
        const cb = crateBox(crate);
        if (x >= cb.minx && x <= cb.maxx && y >= cb.miny && y <= cb.maxy && z >= cb.minz && z <= cb.maxz) return true;
      }
    }
    return false;
  }

  function watcherTarget(enemy, echoNow) {
    const candidates = [];
    for (let i = 0; i < echoNow.length; i++) {
      const ep = echoNow[i];
      candidates.push({ key: `echo-${i}`, kind: "echo", x: ep.x, y: ep.y + P_H * 0.5, z: ep.z });
    }
    candidates.push({ key: "live", kind: "live", x: player.x, y: player.y + P_H * 0.5, z: player.z });

    const tanHalfFov = Math.tan(((enemy.fov || 56) * Math.PI / 180) / 2);
    const verticalBand = enemy.band || 0.95;
    let best = null;
    let bestDistance = Infinity;
    for (const actor of candidates) {
      const dx = actor.x - enemy.x;
      const dz = actor.z - enemy.z;
      const dy = actor.y - enemy.y;
      const forward = dx * enemy.dirX + dz * enemy.dirZ;
      const side = Math.abs(dx * enemy.dirZ - dz * enemy.dirX);
      if (forward <= 0.35 || forward > enemy.rangeM || side > forward * tanHalfFov || Math.abs(dy) > verticalBand) continue;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= bestDistance || securityLineBlocked(enemy.x, enemy.y, enemy.z, actor.x, actor.y, actor.z)) continue;
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

  function sweeperBox(enemy) {
    const halfAlong = 0.16;
    const halfCross = enemy.width / 2;
    const halfX = Math.abs(enemy.dirX) * halfAlong + Math.abs(enemy.perpX) * halfCross;
    const halfZ = Math.abs(enemy.dirZ) * halfAlong + Math.abs(enemy.perpZ) * halfCross;
    return aabb(enemy.x - halfX, enemy.y - 0.1, enemy.z - halfZ, enemy.x + halfX, enemy.y + 0.12, enemy.z + halfZ);
  }

  // Returns true when security reset the current live run.
  function updateEnemies(echoNow) {
    for (const enemy of enemies) {
      if (enemy.type === "sweeper") {
        const t = triangleWave(stepIdx, enemy.period, enemy.phase);
        enemy.x = enemy.ax + (enemy.bx - enemy.ax) * t;
        enemy.z = enemy.az + (enemy.bz - enemy.az) * t;
        enemy.group.position.set(enemy.x, enemy.y, enemy.z);
        if (boxesOverlap(entBox(player.x, player.y, player.z, P_HALF, P_H), sweeperBox(enemy))) {
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

      if (enemy.lock >= (enemy.lockSteps || 52)) {
        enemy.fireFlash = 10;
        enemy.fireTarget = { x: target.x, y: target.y, z: target.z };
        enemy.cooldown = enemy.cooldownSteps || 88;
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

    const echoPrevStep = echoStepIdx;
    const echoLimit = maxEchoStep();
    const echoAdvance = isEchoFastForwarding() ? ECHO_FAST_FORWARD_MULT : 1;
    echoStepIdx = Math.min(echoStepIdx + echoAdvance, echoLimit);

    // Timed gate: driven purely by the loop clock
    const wasGate = gateOpen;
    gateOpen = computeGateOpen(stepIdx);
    if (gateOpen !== wasGate && stepIdx > 1) Sound.door();

    // Echo playback positions
    const echoNow = echoes.map((e) => echoPosAt(e, echoStepIdx));
    const echoPrev = echoes.map((e) => echoPosAt(e, echoPrevStep));

    // Echoes shove crates (XZ overlap resolution, capped)
    for (let i = 0; i < echoes.length; i++) {
      const echo = echoes[i];
      const last = Math.max(0, echo.len - 1);
      const from = Math.min(echoPrevStep, last);
      const to = Math.min(echoStepIdx, last);
      const samples = Math.max(1, to - from);
      for (let sample = 1; sample <= samples; sample++) {
        const echoStep = to > from ? from + sample : to;
        const ep = echoPosAt(echo, echoStep);
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
    }

    // Riding an echo: follow its motion, feet pinned to its head, vy MUST be zeroed
    if (p.standEcho >= 0) {
      if (p.standEcho >= echoes.length) p.standEcho = -1;
      else {
        const now = echoNow[p.standEcho], prev = echoPrev[p.standEcho];
        const top = now.y + P_H;
        const prevTop = prev.y + P_H;
        const on =
          Math.abs(p.x - prev.x) < P_HALF * 2 - 0.05 &&
          Math.abs(p.z - prev.z) < P_HALF * 2 - 0.05 &&
          Math.abs(p.y - prevTop) < 0.35 && p.vy <= 0.01;
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

    // Deterministic security hazards; echoes can bait Watchers but cannot be erased.
    if (updateEnemies(echoNow)) return;

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

  function die(reason) {
    Sound.death();
    if (flashEl) {
      flashEl.style.opacity = "0.5";
      setTimeout(() => { flashEl.style.opacity = "0"; }, 180);
    }
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
    const securityLine = L.enemies && L.enemies.length
      ? `<br><span style="color:#ff4f68">⚠ Security active:</span> Watchers lock onto the first temporal body they see; jump, use cover, or send an echo first. Sweepers must be jumped.`
      : "";
    const gateLine = L.gate ? `<br>⏱ Timed gate: open <strong>${L.gate[0]}s–${L.gate[1]}s</strong> of every loop` : "";
    showOverlay(
      `LEVEL ${idx + 1}: ${L.name}`,
      `${L.sub}<br><br><span style="opacity:.75">Loop budget: <strong>${L.maxLoops}</strong> · Par: <strong>${L.par}</strong> · Loop length: <strong>${L.loopSec}s</strong>${gateLine}${securityLine}</span>`,
      "",
      "Enter the loop",
      () => { lockPointer(); phase = "play"; hideOverlay(); Sound.resume(); }
    );
    updateHud();
  }

  // ---------- Pointer lock ----------
  let pointerLocked = false;
  function lockPointer() {
    canvas.focus({ preventScroll: true });
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      try {
        const lock = canvas.requestPointerLock();
        if (lock && typeof lock.catch === "function") lock.catch(() => {});
      } catch (e) { /* pointer lock can be unavailable in embedded previews */ }
    }
  }
  function unlockPointer() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (crosshair) crosshair.style.opacity = pointerLocked ? "1" : "0.25";
    if (!pointerLocked && phase === "play") {
      setPaused(true);
      window.setTimeout(openPauseMenu, 0);
    }
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

  function openMainMenu() {
    phase = "idle";
    unlockPointer();
    totalScore = 0;
    loadLevel(0);
    Object.keys(keys).forEach((code) => { keys[code] = false; });
    touch.f = 0;
    touch.s = 0;
    touch.jump = false;
    btnPause.textContent = "Pause";
    showOverlay(
      "⭯ ECHO LOOP 3D",
      "The looping room, from the inside. <strong>WASD</strong> to move, <strong>mouse</strong> to look, <strong>Space</strong> jumps. " +
        "<strong>Press R</strong> to close a loop: the room rewinds and a translucent <strong style=\"color:#2ee0ff\">echo</strong> replays your last run, forever. " +
        "Climb your own shoulders. Leave yourself holding the door. Hold <strong>Shift</strong> to fast-forward only your echoes. <strong>A few past selves, one puzzle.</strong>",
      bestAtStart ? `Best score: <strong>${bestAtStart}</strong>` : "",
      "Start looping",
      () => { totalScore = 0; startLevel(0); }
    );
    updateHud();
  }

  function openPauseMenu() {
    const menu = document.getElementById("rb-escape-menu");
    if (menu && !menu.hidden) return;
    const menuButton = document.querySelector(".rb-escape-btn");
    if (menuButton) menuButton.click();
    else setPaused(true);
  }

  function setPaused(pz) {
    if (pz && phase === "play") {
      phase = "paused";
      unlockPointer();
      Object.keys(keys).forEach((code) => { keys[code] = false; });
      touch.f = 0;
      touch.s = 0;
      touch.jump = false;
      btnPause.textContent = "Resume";
    } else if (!pz && phase === "paused") {
      lockPointer();
      phase = "play";
      hideOverlay();
      btnPause.textContent = "Pause";
      Sound.resume();
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
    hudTime.style.color = secsLeft < 6 ? "#ff4f68" : "";
    hudLoops.textContent = `${loopsUsed()}/${maxLoops}`;
    hudScore.textContent = totalScore;
    hudBest.textContent = Math.max(bestAtStart, api.getHighScore(GAME_ID) || 0, totalScore);
    if (timerBar) {
      const frac = Math.max(0, 1 - stepIdx / loopSteps);
      timerBar.style.width = (frac * 100).toFixed(1) + "%";
      timerBar.style.background = frac < 0.2 ? "#ff4f68" : "#2ee0ff";
    }
    if (fastEl) fastEl.classList.toggle("is-active", isEchoFastForwarding());
    if (securityEl) securityEl.classList.toggle("is-active", phase === "play" && enemies.length > 0);
  }

  function updateEnemyVisuals() {
    for (const enemy of enemies) {
      if (enemy.type === "sweeper") {
        const pulse = 0.72 + Math.sin(renderTime * 15 + enemy.index) * 0.28;
        enemy.beam.material.emissiveIntensity = 1.2 + pulse * 1.2;
        enemy.aura.material.opacity = 0.1 + pulse * 0.12;
        enemy.light.intensity = 0.65 + pulse * 0.8;
        continue;
      }

      const charge = Math.min(1, enemy.lock / (enemy.lockSteps || 52));
      const target = enemy.fireFlash > 0 && enemy.fireTarget ? enemy.fireTarget : enemy.target;
      const attr = enemy.beamGeo.attributes.position;
      const sx = enemy.eye.position.x, sy = enemy.eye.position.y, sz = enemy.eye.position.z;
      const ex = target ? target.x - enemy.x : sx + enemy.dirX * 1.5;
      const ey = target ? target.y - enemy.y : sy;
      const ez = target ? target.z - enemy.z : sz + enemy.dirZ * 1.5;
      attr.setXYZ(0, sx, sy, sz);
      attr.setXYZ(1, ex, ey, ez);
      attr.needsUpdate = true;
      enemy.beamMat.color.setHex(enemy.fireFlash > 0 ? 0xffffff : C.bad);
      enemy.beamMat.opacity = enemy.fireFlash > 0 ? 1 : target ? 0.22 + charge * 0.68 : 0.16;
      enemy.shell.material.emissiveIntensity = 0.32 + charge * 1.1;
      enemy.eye.material.emissiveIntensity = 1.2 + charge * 2.6;
      enemy.light.intensity = 0.42 + charge * 1.7 + (enemy.fireFlash > 0 ? 1.8 : 0);
      enemy.ring.rotation.z = renderTime * (0.8 + charge * 2.5);
      const ringScale = 1 + charge * 0.22;
      enemy.ring.scale.set(ringScale, ringScale, ringScale);
    }
  }

  // ---------- Render ----------
  function render() {
    renderTime += 1 / 60;

    // Camera follows the player (first person)
    const moveAmt = Math.min(1, Math.hypot(player.vx, player.vz) / SPEED);
    const bob = player.grounded ? Math.sin(renderTime * 11) * 0.035 * moveAmt : 0;
    const sway = player.grounded ? Math.cos(renderTime * 5.5) * 0.018 * moveAmt : 0;
    camera.position.set(player.x + Math.cos(player.yaw) * sway, player.y + EYE + bob, player.z - Math.sin(player.yaw) * sway);
    camera.rotation.order = "YXZ";
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    torch.position.set(camera.position.x, camera.position.y, camera.position.z);
    moon.target.position.set(player.x, 0, player.z);
    timelineSky.position.copy(camera.position);
    timelineSkyMaterial.uniforms.uTime.value = renderTime;

    if (roomMotes) {
      roomMotes.rotation.y = Math.sin(renderTime * 0.08) * 0.025;
      roomMotes.material.opacity = 0.34 + Math.sin(renderTime * 0.7) * 0.08;
    }
    for (let i = 0; i < skyPulseLights.length; i++) {
      skyPulseLights[i].intensity = 0.40 + Math.sin(renderTime * 1.5 + i * 2.1) * 0.10;
    }
    updateEnemyVisuals();

    // Echo figures
    for (let i = 0; i < echoes.length; i++) {
      const e = echoes[i];
      const pNow = echoPosAt(e, echoStepIdx);
      e.group.position.set(pNow.x, pNow.y, pNow.z);
      e.group.rotation.y = pNow.yaw;
      if (e.group.userData.core) {
        e.group.userData.core.rotation.z = renderTime * (1.2 + i * 0.15);
        const ep = 1 + Math.sin(renderTime * 5 + i) * 0.08;
        e.group.userData.core.scale.set(ep, ep, ep);
      }
      if (e.group.userData.aura) {
        const ap = 1 + Math.sin(renderTime * 3.2 + i) * 0.12;
        e.group.userData.aura.scale.set(ap, 1, ap);
        e.group.userData.aura.rotation.y = renderTime * 0.4;
      }
      if (e.group.userData.light) e.group.userData.light.intensity = 0.48 + Math.sin(renderTime * 4 + i) * 0.16;
    }

    // Crates
    for (let i = 0; i < crates.length; i++) {
      const crate = crates[i];
      crate.mesh.position.set(crate.x, crate.y, crate.z);
      if (crate.mesh.userData.beacon) crate.mesh.userData.beacon.intensity = 0.22 + Math.sin(renderTime * 2.7 + i) * 0.08;
    }

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
      if (exitRing.userData.ringPink) exitRing.userData.ringPink.rotation.z = renderTime * 0.7;
      if (exitRing.userData.ringCyan) exitRing.userData.ringCyan.rotation.x = renderTime * -0.46;
      exitLight.intensity = 1.3 + Math.sin(renderTime * 4) * 0.45;
    }
    // Low-timer mood: the moonlight goes red when the loop is dying
    const frac = Math.max(0, 1 - stepIdx / loopSteps);
    if (phase === "play" && frac < 0.18) {
      const t = 0.5 + Math.sin(renderTime * 9) * 0.5;
      moon.color.setHex(0xff4f68);
      moon.intensity = 0.5 + t * 0.35;
      renderer.toneMappingExposure = 1.03 + t * 0.08;
    } else {
      moon.color.setHex(0x8fb8ff);
      moon.intensity = 0.65;
      renderer.toneMappingExposure = 1.12;
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
    else if (e.code === "KeyP") openPauseMenu();
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
    btnPauseMenu.addEventListener("click", openPauseMenu);
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

    openMainMenu();
    requestAnimationFrame(frame);
  }

  // Debug hook (rAF-independent test drivers, same pattern as __ECHO)
  window.__ECHO3D = {
    get state() {
      return {
        phase, levelIdx, echoes: echoes.length, stepIdx, echoStepIdx, totalScore, fastForwarding: isEchoFastForwarding(),
        player: { x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), standEcho: player.standEcho },
        crates: crates.map((c) => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) })),
        enemies: enemies.map((e) => ({ type: e.type, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), lock: e.lock || 0, cooldown: e.cooldown || 0 })),
        echoPos: echoes.map((e) => { const q = echoPosAt(e, echoStepIdx); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }; }),
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
