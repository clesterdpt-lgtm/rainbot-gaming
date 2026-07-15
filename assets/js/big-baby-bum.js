/* ============================================
   BIG BABY BUM 3D — a katamari snack odyssey
   - You are a baby in a backyard. You are hungry.
   - Eat anything smaller than you. Grow rounder until you
     are a ball, then ROLL. Keep going until entire buildings
     are finger food.
   - Green stink lines mean PUKE FOOD: eating it shrinks you.
   - ONE constant city (~900 m, street grid, districts):
     buildings/trees/fixtures are permanent (eaten stays eaten
     in the save); toys/snacks/people/animals/cars respawn
     around you so there is always something to eat. Cars
     drive the roads. People regret their walks.
   - Three.js r128 (vendored). Debug hook: window.__BBB
     (includes a deterministic step(n, dt) for headless tests)
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "big-baby-bum";

  // ---------- Tunables ----------
  const W = 960;
  const H = 624;
  const START_SIZE = 0.35;    // baby "diameter", meters
  const EAT_RATIO = 0.7;      // can eat obj if obj.s <= size * EAT_RATIO
  const GROWTH_K = 0.22;      // area-based growth factor (small = long game)
  const PUKE_SLOW = 2.5;      // seconds of queasy slow-down after a bad snack
  const PUKE_MIN_RATIO = 0.12; // hazards below this fraction of your size are squashed harmlessly
  const FENCE_FREE = 1.1 / 0.7; // ≈1.57 m — fence becomes edible, yard unseals
  const WIN_SIZE = 30;        // meters — TOWN EATER
  const ROUND_START = 0.55;   // roundness ramps from here...
  const ROUND_FULL = 1.35;    // ...to full sphere here (rolls at ~1 m)
  const ROLL_AT = 0.6;        // roundness where crawling becomes rolling
  const COMBO_WINDOW = 3.0;
  const COMBO_MAX = 8;
  const BURP_DURATION = 1.0;
  const BURP_COOLDOWN = 7;
  const SAVE_KEY = "rb_bbb3d_save";
  const LS_HIGH = "rb_bbb_high";
  const LS_SOUND = "rb_bbb_sound";

  // ---- The city plan (constant for everyone, forever) ----
  const BLOCK = 60;           // block pitch: 52 m lots + 8 m roads
  const ROAD_HALF = 4;        // residential road half-width
  const AVE_Z = -150;         // Main Street (east-west avenue)
  const AVE_HALF = 7;
  const CITY_LINES = 8;       // road lines at ±(30 + 60k), k = 0..7 → out to ±450
  const CITY_EDGE = 450;      // last road line
  const CITY_BOUND = 460;     // hedge just past it
  const WORLD_SEED = 20260710; // fixed: the city never changes

  const PHASES = [
    { s: 0.0, n: "CRUMB GOBLIN", e: "🥣" },
    { s: 0.7, n: "TOY DESTROYER", e: "🧸" },
    { s: 1.05, n: "ROUND MODE", e: "🔵" },
    { s: 3.5, n: "YARD LEGEND", e: "🌻" },
    { s: 7.0, n: "STREET MENACE", e: "🚗" },
    { s: 13.0, n: "HOUSE MUNCHER", e: "🏠" },
    { s: 20.0, n: "BLOCK BUSTER", e: "🏢" },
    { s: WIN_SIZE, n: "TOWN EATER", e: "👑" },
  ];

  const PUKE_LINES = [
    "BLEEEGH!",
    "That was broccoli. WHY.",
    "Regret has a flavor.",
    "Tastes like bath time.",
    "That was NOT food.",
    "Baby has made a mistake.",
    "The stink lines were a warning.",
  ];

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  // ---------- DOM ----------
  const canvas = document.getElementById("gameCanvas");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnContinue = document.getElementById("btn-continue");
  const btnPause = document.getElementById("btn-pause");
  const btnRestart = document.getElementById("btn-restart");
  const btnSound = document.getElementById("btn-sound");
  const btnBurp = document.getElementById("btn-burp");
  const hudSize = document.getElementById("hud-size");
  const hudPhase = document.getElementById("hud-phase");
  const hudScore = document.getElementById("hud-score");
  const hudNoms = document.getElementById("hud-noms");
  const hudHigh = document.getElementById("hud-high");
  const menuListEl = document.getElementById("menu-list");
  const unlockFillEl = document.getElementById("unlock-fill");
  const unlockLabelEl = document.getElementById("unlock-label");
  const logEl = document.getElementById("bbb-log");
  const floatLayer = document.getElementById("float-layer");
  const bannerEl = document.getElementById("bbb-banner");
  const bannerEmoji = document.getElementById("banner-emoji");
  const bannerSmall = document.getElementById("banner-small");
  const bannerBig = document.getElementById("banner-big");
  const pukeFlash = document.getElementById("puke-flash");

  if (!window.THREE) {
    overlayTitle.textContent = "😢 3D UNAVAILABLE";
    overlaySub.textContent = "Three.js failed to load, so the baby cannot manifest. Refresh to try again.";
    btnPrimary.style.display = "none";
    return;
  }
  const T = window.THREE;

  // ---------- Utility ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Deterministic PRNG — buildCity() always uses WORLD_SEED, so the city
  // layout is identical for every player and every session.
  function mulberry32(seedNum) {
    let a = seedNum >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtSize(m) {
    if (m < 1) return `${Math.round(m * 100)} cm`;
    if (m < 10) return `${m.toFixed(2)} m`;
    return `${m.toFixed(1)} m`;
  }

  function phaseFor(size) {
    let p = PHASES[0];
    for (const ph of PHASES) if (size >= ph.s) p = ph;
    return p;
  }

  // ---- Road geometry helpers (grid lines at ±(30+60k)) ----
  function distToLine(v) {
    const av = Math.abs(v);
    if (av > CITY_EDGE + ROAD_HALF) return 1e9;
    const m = (((av - 30) % BLOCK) + BLOCK) % BLOCK;
    return Math.min(m, BLOCK - m);
  }
  function nearestLine(v) {
    const av = Math.abs(v);
    const k = clamp(Math.round((av - 30) / BLOCK), 0, CITY_LINES - 1);
    return Math.sign(v || 1) * (30 + k * BLOCK);
  }
  function onRoad(x, z) {
    if (Math.abs(z - AVE_Z) < AVE_HALF) return true;
    return distToLine(x) < ROAD_HALF || distToLine(z) < ROAD_HALF;
  }
  function onSidewalk(x, z) {
    const dx = distToLine(x);
    const dz = distToLine(z);
    const dAve = Math.abs(z - AVE_Z);
    return (
      (dx >= ROAD_HALF && dx < ROAD_HALF + 2.6) ||
      (dz >= ROAD_HALF && dz < ROAD_HALF + 2.6) ||
      (dAve >= AVE_HALF && dAve < AVE_HALF + 2.6)
    );
  }

  // ---------- Audio (all synthesized) ----------
  const AudioKit = (() => {
    let ac = null;
    let master = null;
    let musicGain = null;
    let musicTimer = null;
    let musicStep = 0;
    let enabled = localStorage.getItem(LS_SOUND) !== "off";

    function ensure() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.6;
      master.connect(ac.destination);
      musicGain = ac.createGain();
      musicGain.gain.value = 0.15;
      musicGain.connect(master);
      return true;
    }
    function resume() {
      if (ensure() && ac.state === "suspended") ac.resume();
    }
    function tone({ f = 440, t = 0.12, type = "sine", v = 0.2, slide = 0, delay = 0, dest = null }) {
      if (!enabled || !ensure()) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(24, f + slide), t0 + t);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
      osc.connect(g).connect(dest || master);
      osc.start(t0);
      osc.stop(t0 + t + 0.05);
    }
    function noise({ t = 0.15, v = 0.2, f = 1200, q = 1, slide = 0, delay = 0 }) {
      if (!enabled || !ensure()) return;
      const t0 = ac.currentTime + delay;
      const len = Math.ceil(ac.sampleRate * t);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filt = ac.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(f, t0);
      if (slide) filt.frequency.exponentialRampToValueAtTime(Math.max(50, f + slide), t0 + t);
      filt.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
      src.connect(filt).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + t + 0.02);
    }

    const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0];
    const PATTERN = [0, 2, 4, 2, 3, -1, 1, 2, 0, 2, 4, 3, 1, -1, 2, 0];
    function musicTick() {
      if (!enabled || !ac) return;
      const idx = PATTERN[musicStep % PATTERN.length];
      musicStep++;
      if (idx >= 0) {
        const f = NOTES[idx];
        tone({ f, t: 0.5, type: "triangle", v: 0.09, dest: musicGain });
        tone({ f: f * 1.003, t: 0.45, type: "sine", v: 0.04, dest: musicGain });
        if (musicStep % 4 === 1) tone({ f: f / 4, t: 0.6, type: "sine", v: 0.05, dest: musicGain });
      }
    }

    return {
      get enabled() {
        return enabled;
      },
      setEnabled(on) {
        enabled = on;
        localStorage.setItem(LS_SOUND, on ? "on" : "off");
        if (!on) this.stopMusic();
      },
      unlock() {
        resume();
      },
      startMusic() {
        if (!enabled || !ensure()) return;
        resume();
        if (!musicTimer) musicTimer = setInterval(musicTick, 326);
      },
      stopMusic() {
        if (musicTimer) {
          clearInterval(musicTimer);
          musicTimer = null;
        }
      },
      chomp(size) {
        const base = clamp(520 - size * 14, 80, 520);
        noise({ t: 0.09, v: 0.3, f: base * 4, q: 0.8, slide: -base * 2 });
        tone({ f: base, t: 0.11, type: "square", v: 0.15, slide: -base * 0.5 });
      },
      bonk() {
        tone({ f: 110, t: 0.14, type: "square", v: 0.16, slide: -60 });
        noise({ t: 0.08, v: 0.1, f: 300, q: 1.2 });
      },
      burp() {
        tone({ f: 150, t: 0.55, type: "sawtooth", v: 0.22, slide: -100 });
        noise({ t: 0.45, v: 0.15, f: 420, q: 0.6, slide: -260 });
      },
      puke() {
        tone({ f: 340, t: 0.6, type: "sawtooth", v: 0.2, slide: -270 });
        noise({ t: 0.5, v: 0.22, f: 500, q: 0.5, slide: -380, delay: 0.08 });
        noise({ t: 0.25, v: 0.18, f: 180, q: 0.8, delay: 0.34 });
      },
      fart() {
        [110, 90, 74].forEach((f, i) => tone({ f, t: 0.13, type: "sawtooth", v: 0.2, slide: -36, delay: i * 0.09 }));
        noise({ t: 0.38, v: 0.18, f: 220, q: 0.7, slide: -130 });
      },
      bark() {
        noise({ t: 0.08, v: 0.26, f: 620, q: 1.4, slide: -260 });
        tone({ f: 210, t: 0.09, type: "square", v: 0.2, slide: -90 });
      },
      siren() {
        tone({ f: 660, t: 0.26, type: "triangle", v: 0.13 });
        tone({ f: 495, t: 0.26, type: "triangle", v: 0.13, delay: 0.28 });
      },
      boom(v) {
        noise({ t: 0.5, v: 0.28 * (v || 1), f: 150, q: 0.5, slide: -90 });
        tone({ f: 70, t: 0.5, type: "sine", v: 0.24 * (v || 1), slide: -30 });
      },
      gassed() {
        tone({ f: 280, t: 0.32, type: "triangle", v: 0.13, slide: 140 });
      },
      giggle() {
        [660, 880, 740].forEach((f, i) => tone({ f, t: 0.1, type: "sine", v: 0.12, slide: 90, delay: i * 0.085 }));
      },
      fanfare() {
        [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: 0.16, type: "triangle", v: 0.16, delay: i * 0.08 }));
      },
      bigFanfare() {
        [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, t: 0.22, type: "triangle", v: 0.16, delay: i * 0.1 }));
      },
    };
  })();

  // ---------- Three.js scene ----------
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setSize(W, H, false);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const SKY = 0x9fd8f2;
  renderer.setClearColor(SKY);
  const scene = new T.Scene();
  scene.background = new T.Color(SKY);
  scene.fog = new T.Fog(SKY, 52, 175);
  const camera = new T.PerspectiveCamera(60, W / H, 0.05, 1600);

  // Warm animation-film lighting: a readable sky/ground fill, a soft key,
  // and a cool rim. Only the hero and large nearby anchors cast shadows.
  scene.add(new T.HemisphereLight(0xeaf8ff, 0x527c4c, 0.94));
  scene.add(new T.AmbientLight(0xffeee0, 0.22));
  const sun = new T.DirectionalLight(0xffddb0, 1.15);
  sun.position.set(42, 68, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const rim = new T.DirectionalLight(0xa9dfff, 0.3);
  rim.position.set(-35, 24, -45);
  scene.add(rim);

  function makeGableRoofGeometry() {
    const geo = new T.BufferGeometry();
    geo.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [
          -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0.5, -0.5,
          -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 0.5, 0.5,
        ],
        3
      )
    );
    geo.setIndex([
      // Exterior faces only. The old roof was wound inside-out and included
      // a bottom cap exactly on the building top, so faces vanished and
      // shimmered as the camera moved.
      0, 2, 1,
      3, 4, 5,
      0, 5, 2, 0, 3, 5,
      1, 5, 4, 1, 2, 5,
    ]);
    const hardEdged = geo.toNonIndexed();
    geo.dispose();
    hardEdged.computeVertexNormals();
    hardEdged.name = "bbb_gable_roof_geometry_v3";
    return hardEdged;
  }

  function makePicketGeometry() {
    const shape = new T.Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, 0.72);
    shape.lineTo(0, 1);
    shape.lineTo(-0.5, 0.72);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    geo.translate(0, 0, -0.09);
    return geo;
  }

  // ---------- Shared geometry & materials ----------
  const GEO = {
    box: new T.BoxGeometry(1, 1, 1),
    sph: new T.SphereGeometry(1, 18, 13),
    sphLo: new T.SphereGeometry(1, 8, 6),
    cyl: new T.CylinderGeometry(1, 1, 1, 10),
    cone: new T.ConeGeometry(1, 1, 9),
    torus: new T.TorusGeometry(1, 0.28, 8, 14),
    torusThin: new T.TorusGeometry(1, 0.11, 7, 18),
    dodec: new T.DodecahedronGeometry(1, 0),
    oct: new T.OctahedronGeometry(1, 1),
    roof: makeGableRoofGeometry(),
    picket: makePicketGeometry(),
    plane: new T.PlaneGeometry(1, 1),
    circle: new T.CircleGeometry(1, 22),
  };
  const MATS = new Map();
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!MATS.has(key)) {
      MATS.set(
        key,
        new T.MeshStandardMaterial(
          Object.assign({ color, roughness: 0.72, metalness: 0.015 }, opts || {})
        )
      );
    }
    return MATS.get(key);
  }

  function mesh(geo, material, sx, sy, sz, x, y, z, ry) {
    const m = new T.Mesh(geo, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    return m;
  }

  const instanceDummy = new T.Object3D();
  function instanced(geo, material, transforms, name) {
    const batch = new T.InstancedMesh(geo, material, transforms.length);
    batch.name = name || "detail_batch";
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      instanceDummy.position.fromArray(t.p || [0, 0, 0]);
      instanceDummy.rotation.set(...(t.r || [0, 0, 0]));
      instanceDummy.scale.fromArray(t.s || [1, 1, 1]);
      instanceDummy.updateMatrix();
      batch.setMatrixAt(i, instanceDummy.matrix);
    }
    batch.instanceMatrix.needsUpdate = true;
    return batch;
  }

  // ---------- Canvas textures ----------
  function makeTex(size, draw, repeatX, repeatY) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const tex = new T.CanvasTexture(c);
    tex.encoding = T.sRGBEncoding;
    if (repeatX) {
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY || repeatX);
    }
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  const skyTex = makeTex(512, (g, s) => {
    const sky = g.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, "#61b7ec");
    sky.addColorStop(0.52, "#a8def4");
    sky.addColorStop(0.82, "#f7d9b0");
    sky.addColorStop(1, "#d8e6b7");
    g.fillStyle = sky;
    g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,255,255,0.64)";
    for (const cloud of [
      [68, 108, 54], [208, 72, 42], [358, 122, 64], [470, 78, 38],
    ]) {
      const [x, y, r] = cloud;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.24, 0, 0, Math.PI * 2);
      g.ellipse(x - r * 0.24, y - r * 0.1, r * 0.34, r * 0.26, 0, 0, Math.PI * 2);
      g.ellipse(x + r * 0.2, y - r * 0.12, r * 0.42, r * 0.31, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  skyTex.name = "bbb_storybook_sky";
  scene.background = skyTex;

  function loadGeneratedTexture(name, url, fallback, repeatX, repeatY) {
    const tex = new T.TextureLoader().load(
      url,
      () => {
        tex.needsUpdate = true;
      },
      undefined,
      () => {
        tex.image = fallback.image;
        tex.needsUpdate = true;
      }
    );
    tex.name = name;
    tex.userData = { role: "generated-game-texture", source: url };
    tex.encoding = T.sRGBEncoding;
    tex.wrapS = tex.wrapT = T.MirroredRepeatWrapping;
    tex.repeat.set(repeatX || 1, repeatY || repeatX || 1);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  const fallbackGrassTex = makeTex(256, (g, s) => {
    g.fillStyle = "#6db85f";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      g.fillStyle = Math.random() < 0.5 ? "#63ad57" : "#79c46a";
      g.fillRect(x, y, 2.5, 2.5);
    }
  }, 130);

  const grassTex = loadGeneratedTexture(
    "bbb_generated_clover_grass",
    "../assets/textures/big-baby-bum/grass-clover-generated-v2.png",
    fallbackGrassTex,
    220,
    220
  );

  const fallbackGinghamTex = makeTex(256, (g, s) => {
    g.fillStyle = "#f6ead2";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(226,87,76,0.6)";
    const c = s / 8;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) if ((i + j) % 2) g.fillRect(i * c, j * c, c, c);
  }, 4);

  const ginghamTex = loadGeneratedTexture(
    "bbb_generated_picnic_gingham",
    "../assets/textures/big-baby-bum/gingham-generated-v2.png",
    fallbackGinghamTex,
    3,
    2
  );

  const fallbackWoodTex = makeTex(128, (g, s) => {
    g.fillStyle = "#a96632";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(76,39,18,0.25)";
    g.lineWidth = 3;
    for (let x = 0; x < s; x += 24) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 4, s);
      g.stroke();
    }
  }, 2);

  const woodTex = loadGeneratedTexture(
    "bbb_generated_cedar",
    "../assets/textures/big-baby-bum/cedar-generated-v1.png",
    fallbackWoodTex,
    2,
    2
  );
  const woodMat = new T.MeshStandardMaterial({ map: woodTex, bumpMap: woodTex, bumpScale: 0.055, color: 0xfff1dd, roughness: 0.86, metalness: 0 });
  woodMat.name = "bbb_cedar_wood";
  woodMat.userData.role = "generated-wood";

  // Road strip: concrete sidewalks at the edges, asphalt center, dashed line.
  // Dash runs along the texture's V axis; strips repeat along their length.
  const fallbackRoadTex = makeTex(128, (g, s) => {
    g.fillStyle = "#b9bcc4";
    g.fillRect(0, 0, s, s); // sidewalk
    g.fillStyle = "#565a66";
    g.fillRect(s * 0.16, 0, s * 0.68, s); // asphalt
    g.fillStyle = "#ffd43b";
    g.fillRect(s * 0.485, s * 0.1, s * 0.03, s * 0.42); // dash
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
  });
  const roadTextures = (() => {
    const s = 512;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    const intersectionCanvas = document.createElement("canvas");
    intersectionCanvas.width = intersectionCanvas.height = s;
    const intersectionG = intersectionCanvas.getContext("2d");
    function paintRoad(img) {
      if (img) g.drawImage(img, 0, 0, s, s);
      else {
        g.fillStyle = "#50545d";
        g.fillRect(0, 0, s, s);
      }
      const sidewalk = g.createLinearGradient(0, 0, s, 0);
      sidewalk.addColorStop(0, "#c9c5b8");
      sidewalk.addColorStop(0.12, "#e3dfd0");
      sidewalk.addColorStop(0.15, "#a9a89f");
      sidewalk.addColorStop(0.151, "rgba(0,0,0,0)");
      sidewalk.addColorStop(0.849, "rgba(0,0,0,0)");
      sidewalk.addColorStop(0.85, "#a9a89f");
      sidewalk.addColorStop(0.88, "#e3dfd0");
      sidewalk.addColorStop(1, "#c9c5b8");
      g.fillStyle = sidewalk;
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#f5c84c";
      g.fillRect(s * 0.49, s * 0.08, s * 0.02, s * 0.5);
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(s * 0.16, 0, 2, s);
      g.fillRect(s * 0.84, 0, 2, s);
    }
    function paintIntersection(img) {
      intersectionG.clearRect(0, 0, s, s);
      if (img) intersectionG.drawImage(img, 0, 0, s, s);
      else {
        intersectionG.fillStyle = "#50545d";
        intersectionG.fillRect(0, 0, s, s);
        intersectionG.fillStyle = "rgba(255,255,255,0.035)";
        for (let y = 6; y < s; y += 23) intersectionG.fillRect(0, y, s, 2);
      }
    }
    paintRoad(null);
    paintIntersection(null);
    const road = new T.CanvasTexture(c);
    road.name = "bbb_generated_asphalt_hybrid";
    road.userData = { role: "generated-game-texture", source: "../assets/textures/big-baby-bum/asphalt-generated-v1.png" };
    const intersection = new T.CanvasTexture(intersectionCanvas);
    intersection.name = "bbb_generated_asphalt_intersection";
    intersection.userData = { role: "generated-game-texture", source: "../assets/textures/big-baby-bum/asphalt-generated-v1.png" };
    for (const tex of [road, intersection]) {
      tex.encoding = T.sRGBEncoding;
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    const img = new Image();
    img.onload = () => {
      paintRoad(img);
      paintIntersection(img);
      road.needsUpdate = true;
      intersection.needsUpdate = true;
    };
    img.onerror = () => {
      g.clearRect(0, 0, s, s);
      g.drawImage(fallbackRoadTex.image, 0, 0, s, s);
      road.needsUpdate = true;
      intersection.needsUpdate = true;
    };
    img.src = "../assets/textures/big-baby-bum/asphalt-generated-v1.png";
    return { road, intersection };
  })();
  const roadTex = roadTextures.road;
  const roadIntersectionTex = roadTextures.intersection;

  const windowTexes = [0x9a5b41, 0xd9c8a8, 0x7f8fa6, 0xc46a4f, 0x8aa17c].map((wall) =>
    makeTex(128, (g, s) => {
      g.fillStyle = "#" + wall.toString(16).padStart(6, "0");
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          g.fillStyle = Math.random() < 0.25 ? "#2c3440" : "#ffe9a8";
          g.fillRect(14 + i * 38, 14 + j * 38, 22, 26);
        }
    }, 1)
  );
  windowTexes.forEach((tex, i) => {
    tex.name = `bbb_facade_${i}`;
  });
  const buildingWallMats = windowTexes.map((map, i) => {
    const material = new T.MeshStandardMaterial({ map, roughness: i < 2 ? 0.86 : 0.7, metalness: 0.01 });
    material.name = `bbb_shared_facade_${i}`;
    material.userData.role = "shared-building-facade";
    return material;
  });

  const stinkTex = makeTex(64, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = "#7edb4f";
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.95);
    g.bezierCurveTo(s * 0.15, s * 0.7, s * 0.85, s * 0.45, s * 0.5, s * 0.1);
    g.stroke();
  });
  const stinkMat = new T.MeshBasicMaterial({ map: stinkTex, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false });
  const pukeRingMat = new T.MeshBasicMaterial({ color: 0x6ede3e, transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false });

  // Floating warning sign for puke food: yellow hazard triangle with "!".
  const hazardTex = makeTex(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.lineJoin = "round";
    g.fillStyle = "#ffdf3b";
    g.strokeStyle = "#141024";
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.06);
    g.lineTo(s * 0.95, s * 0.88);
    g.lineTo(s * 0.05, s * 0.88);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#141024";
    g.fillRect(s * 0.45, s * 0.32, s * 0.1, s * 0.32);
    g.fillRect(s * 0.45, s * 0.7, s * 0.1, s * 0.1);
  });
  const hazardMat = new T.MeshBasicMaterial({ map: hazardTex, transparent: true, side: T.DoubleSide, depthWrite: false });
  const gasMat = new T.MeshStandardMaterial({ color: 0x8fdc4f, emissive: 0x244d19, roughness: 0.55, transparent: true, opacity: 0.42, depthWrite: false });
  const shellMat = new T.MeshStandardMaterial({ color: 0x2c3226, roughness: 0.7, metalness: 0.25 });
  // Red flash for enemy hits (green stays for puke).
  const hitFlash = document.createElement("div");
  hitFlash.className = "bbb-puke-flash";
  hitFlash.style.background = "radial-gradient(ellipse at center, transparent 40%, rgba(224,64,64,0.55) 100%)";
  pukeFlash.parentElement.appendChild(hitFlash);

  // Baby face states, as textures on a plane in front of the head.
  function faceTex(state) {
    return makeTex(256, (g, s) => {
      g.clearRect(0, 0, s, s);
      const cx = s / 2;
      g.fillStyle = state === "sick" ? "rgba(140,220,90,0.75)" : "rgba(255,130,150,0.65)";
      g.beginPath();
      g.ellipse(cx - 74, 150, 26, 17, 0, 0, 7);
      g.ellipse(cx + 74, 150, 26, 17, 0, 0, 7);
      g.fill();
      g.fillStyle = "#221a14";
      g.strokeStyle = "#221a14";
      g.lineWidth = 9;
      g.lineCap = "round";
      if (state === "sick") {
        g.beginPath();
        g.moveTo(cx - 58, 92); g.lineTo(cx - 26, 122);
        g.moveTo(cx - 26, 92); g.lineTo(cx - 58, 122);
        g.moveTo(cx + 26, 92); g.lineTo(cx + 58, 122);
        g.moveTo(cx + 58, 92); g.lineTo(cx + 26, 122);
        g.stroke();
      } else if (state === "bliss") {
        g.beginPath();
        g.arc(cx - 42, 108, 20, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        g.beginPath();
        g.arc(cx + 42, 108, 20, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(cx - 42, 104, 15, 0, 7);
        g.arc(cx + 42, 104, 15, 0, 7);
        g.fill();
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(cx - 47, 98, 5, 0, 7);
        g.arc(cx + 37, 98, 5, 0, 7);
        g.fill();
      }
      if (state === "open" || state === "bliss") {
        g.fillStyle = "#8c2f39";
        g.beginPath();
        g.ellipse(cx, 168, 34, 30, 0, 0, 7);
        g.fill();
        g.fillStyle = "#ff96a3";
        g.beginPath();
        g.ellipse(cx, 182, 18, 11, 0, 0, 7);
        g.fill();
        g.fillStyle = "#fff";
        g.fillRect(cx - 22, 140, 16, 15);
        g.fillRect(cx + 6, 140, 16, 15);
      } else if (state === "sick") {
        g.strokeStyle = "#5f7a2c";
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(cx - 34, 172);
        g.quadraticCurveTo(cx - 10, 158, cx, 172);
        g.quadraticCurveTo(cx + 14, 186, cx + 34, 168);
        g.stroke();
      } else {
        g.fillStyle = "#8c2f39";
        g.beginPath();
        g.ellipse(cx, 166, 20, 13, 0, 0, 7);
        g.fill();
      }
    });
  }
  const FACES = {
    normal: faceTex("normal"),
    open: faceTex("open"),
    bliss: faceTex("bliss"),
    sick: faceTex("sick"),
  };
  const faceMat = new T.MeshBasicMaterial({ map: FACES.open, transparent: true, depthWrite: false });

  // ---------- Static world dressing (ground, roads, hedge) ----------
  const dressing = new T.Group();
  scene.add(dressing);
  function buildDressing() {
    const span = CITY_BOUND * 2 + 80;
    const groundMaterial = new T.MeshStandardMaterial({ map: grassTex, bumpMap: grassTex, bumpScale: 0.025, color: 0xcadbb8, roughness: 0.96, metalness: 0 });
    groundMaterial.name = "bbb_clover_ground";
    const ground = new T.Mesh(new T.PlaneGeometry(span, span), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    dressing.add(ground);

    // Picnic blanket at spawn (home backyard).
    const blanketMaterial = new T.MeshStandardMaterial({ map: ginghamTex, bumpMap: ginghamTex, bumpScale: 0.012, color: 0xf5e8dc, roughness: 0.82, metalness: 0 });
    blanketMaterial.name = "bbb_picnic_gingham";
    const blanket = new T.Mesh(new T.PlaneGeometry(4.4, 3.4), blanketMaterial);
    blanket.rotation.x = -Math.PI / 2;
    blanket.rotation.z = 0.12;
    blanket.position.set(-5, 0.03, 1);
    blanket.receiveShadow = true;
    dressing.add(blanket);

    // Street grid: north-south roads (x = ±(30+60k)) and east-west roads.
    // The strips deliberately share one elevation; asphalt-only intersection
    // caps own the crossing pixels so rotated curbs can never overlap or fight.
    const len = CITY_BOUND * 2 + 12;
    const roadMaterial = new T.MeshStandardMaterial({
      map: roadTex,
      color: 0xe8e8e2,
      roughness: 0.93,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    roadMaterial.name = "bbb_generated_asphalt_road";
    function roadStrip(width, alongZ, linePos) {
      const geo = new T.PlaneGeometry(width, len);
      const r = new T.Mesh(geo, roadMaterial);
      r.name = `bbb_road_${alongZ ? "ns" : "ew"}_${linePos}`;
      r.rotation.x = -Math.PI / 2;
      if (alongZ) {
        r.position.set(linePos, 0.016, 0);
      } else {
        r.rotation.z = Math.PI / 2;
        r.position.set(0, 0.016, linePos);
      }
      r.renderOrder = 1;
      r.receiveShadow = true;
      dressing.add(r);
    }
    // Shared repeating texture: many strips reuse one material fine because
    // repeat is set on the texture (length/128px feel).
    roadTex.repeat.set(1, 42);
    const roadX = [];
    const roadZ = [];
    for (let k = 0; k < CITY_LINES; k++) {
      const line = 30 + k * BLOCK;
      roadX.push(line, -line);
      roadZ.push({ z: line, width: ROAD_HALF * 2 });
      roadZ.push({ z: -line, width: -line === AVE_Z ? AVE_HALF * 2 : ROAD_HALF * 2 });
    }
    for (const x of roadX) roadStrip(ROAD_HALF * 2, true, x);
    for (const line of roadZ) roadStrip(line.width, false, line.z);

    const intersectionMaterial = new T.MeshStandardMaterial({
      map: roadIntersectionTex,
      color: 0xe8e8e2,
      roughness: 0.96,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    intersectionMaterial.name = "bbb_generated_asphalt_intersections";
    const intersectionTransforms = [];
    for (const x of roadX)
      for (const line of roadZ)
        intersectionTransforms.push({
          p: [x, 0.02, line.z],
          r: [-Math.PI / 2, 0, 0],
          s: [ROAD_HALF * 2, line.width, 1],
        });
    const intersections = instanced(GEO.plane, intersectionMaterial, intersectionTransforms, "bbb_road_intersections_v3");
    intersections.renderOrder = 2;
    intersections.receiveShadow = true;
    intersections.userData.crossingCount = intersectionTransforms.length;
    dressing.add(intersections);

    // Hedge wall around the city.
    const hm = mat(0x2e6b34);
    for (let v = -CITY_BOUND; v <= CITY_BOUND; v += 40) {
      dressing.add(mesh(GEO.box, hm, 41, 12, 7, v, 6, -CITY_BOUND - 8));
      dressing.add(mesh(GEO.box, hm, 41, 12, 7, v, 6, CITY_BOUND + 8));
      dressing.add(mesh(GEO.box, hm, 7, 12, 41, -CITY_BOUND - 8, 6, v));
      dressing.add(mesh(GEO.box, hm, 7, 12, 41, CITY_BOUND + 8, 6, v));
    }
  }
  buildDressing();

  // ---------- Builders (shared low-poly construction kit) ----------
  function bBox(c, w, h, d) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), w, h, d, 0, h / 2, 0));
      return g;
    };
  }
  function bSphere(c, r) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.sphLo, mat(c), r, r, r, 0, r, 0));
      return g;
    };
  }
  function bCyl(c, r, h) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(c), r, h, r, 0, h / 2, 0));
      return g;
    };
  }
  function bDonut(c, r) {
    return () => {
      const g = new T.Group();
      const m = mesh(GEO.torus, mat(c), r, r, r, 0, r * 0.36, 0);
      m.rotation.x = -Math.PI / 2;
      g.add(m);
      return g;
    };
  }
  function bCritter(bodyC, headC, r, tall, fancy) {
    return () => {
      const g = new T.Group();
      g.name = "bbb_critter_v2";
      const fur = mat(bodyC, { roughness: 0.9, flatShading: true });
      const head = mat(headC, { roughness: 0.88, flatShading: true });
      g.add(mesh(GEO.dodec, fur, r, r * 0.78, r * 1.22, 0, r * 0.78, 0));
      const hy = r * (tall ? 1.5 : 1.2);
      g.add(mesh(GEO.dodec, head, r * 0.6, r * 0.58, r * 0.62, 0, hy, r * 1.03));
      const tail = mesh(GEO.cone, fur, r * 0.22, r * 0.55, r * 0.22, 0, r * 0.95, -r * 1.25);
      tail.rotation.x = -0.7;
      g.add(tail);
      if (tall) {
        const beak = mesh(GEO.cone, mat(0xf39a32, { roughness: 0.78 }), r * 0.18, r * 0.42, r * 0.15, 0, hy - r * 0.05, r * 1.62);
        beak.rotation.x = Math.PI / 2;
        g.add(beak);
      }
      if (fancy) {
        g.add(
          instanced(
            GEO.cone,
            fur,
            [-1, 1].map((side) => ({
              p: [side * r * 0.28, hy + r * 0.48, r * 1.02],
              r: [0.18, 0, side * -0.14],
              s: [r * 0.15, r * 0.34, r * 0.13],
            })),
            "critter_ears"
          )
        );
        g.add(
          instanced(
            GEO.cyl,
            fur,
            [[-0.5, 0.55], [0.5, 0.55], [-0.5, -0.45], [0.5, -0.45]].map((lp) => ({
              p: [r * lp[0], r * 0.24, r * lp[1]],
              s: [r * 0.12, r * 0.48, r * 0.12],
            })),
            "critter_legs"
          )
        );
      }
      g.userData.modelVersion = 2;
      return g;
    };
  }
  function bPerson(shirtC, r) {
    return () => {
      const g = new T.Group();
      g.name = "bbb_person_v2";
      const pants = mat(0x3a4a6b);
      const shirt = mat(shirtC, { roughness: 0.86 });
      const skin = mat(0xffd9b8, { roughness: 0.9 });
      g.add(
        instanced(
          GEO.cyl,
          pants,
          [-1, 1].map((side) => ({ p: [side * r * 0.11, r * 0.18, 0], s: [r * 0.1, r * 0.36, r * 0.1] })),
          "person_legs"
        )
      );
      g.add(mesh(GEO.dodec, shirt, r * 0.31, r * 0.34, r * 0.24, 0, r * 0.65, 0));
      g.add(
        instanced(
          GEO.cyl,
          shirt,
          [-1, 1].map((side) => ({
            p: [side * r * 0.35, r * 0.69, 0],
            r: [0, 0, side * -0.42],
            s: [r * 0.075, r * 0.44, r * 0.075],
          })),
          "person_arms"
        )
      );
      g.add(mesh(GEO.dodec, skin, r * 0.22, r * 0.24, r * 0.22, 0, r * 1.08, 0));
      g.add(mesh(GEO.cyl, mat(0x30364a, { roughness: 0.88 }), r * 0.29, r * 0.09, r * 0.29, 0, r * 1.26, 0));
      g.userData.modelVersion = 2;
      return g;
    };
  }
  function bCar(bodyC, len) {
    // Length runs along +Z so yaw = atan2(vx, vz) points the nose at the
    // direction of travel (cars used to drive sideways).
    return () => {
      const g = new T.Group();
      g.name = "bbb_vehicle_v2";
      const paint = mat(bodyC, { roughness: 0.42, metalness: 0.12 });
      const glass = mat(0x9ddcf4, { roughness: 0.16, metalness: 0.08 });
      g.add(mesh(GEO.box, paint, len * 0.48, len * 0.2, len * 0.9, 0, len * 0.22, -len * 0.02));
      g.add(mesh(GEO.box, paint, len * 0.44, len * 0.12, len * 0.32, 0, len * 0.36, len * 0.31));
      g.add(mesh(GEO.dodec, glass, len * 0.36, len * 0.2, len * 0.34, 0, len * 0.44, -len * 0.12));
      const wheelTransforms = [];
      for (const x of [-len * 0.27, len * 0.27])
        for (const z of [-len * 0.29, len * 0.29])
          wheelTransforms.push({ p: [x, len * 0.13, z], r: [0, 0, Math.PI / 2], s: [len * 0.12, len * 0.09, len * 0.12] });
      g.add(instanced(GEO.cyl, mat(0x20242d, { roughness: 0.95 }), wheelTransforms, "vehicle_wheels"));
      g.add(
        instanced(
          GEO.sphLo,
          mat(0xffed9a, { roughness: 0.35, emissive: 0x4c3500, emissiveIntensity: 0.35 }),
          [-1, 1].map((side) => ({ p: [side * len * 0.16, len * 0.28, len * 0.49], s: [len * 0.05, len * 0.045, len * 0.035] })),
          "vehicle_headlights"
        )
      );
      g.userData.modelVersion = 2;
      return g;
    };
  }
  function bTree(leafC, trunkH, blob) {
    return () => {
      const g = new T.Group();
      g.name = blob ? "bbb_broadleaf_tree_v2" : "bbb_pine_tree_v2";
      g.add(mesh(GEO.cyl, woodMat, 0.12, trunkH, 0.12, 0, trunkH / 2, 0));
      const foliage = mat(leafC, { roughness: 0.94, flatShading: true });
      if (blob) {
        g.add(
          instanced(
            GEO.dodec,
            foliage,
            [
              { p: [-0.22, trunkH + 0.3, 0], s: [0.5, 0.46, 0.48] },
              { p: [0.24, trunkH + 0.28, 0.08], s: [0.45, 0.42, 0.44] },
              { p: [0.02, trunkH + 0.62, -0.04], s: [0.46, 0.44, 0.45] },
            ],
            "tree_canopy_clusters"
          )
        );
      } else {
        g.add(
          instanced(
            GEO.cone,
            foliage,
            [
              { p: [0, trunkH + 0.3, 0], s: [0.56, 0.86, 0.56] },
              { p: [0, trunkH + 0.72, 0], s: [0.43, 0.72, 0.43] },
              { p: [0, trunkH + 1.06, 0], s: [0.3, 0.55, 0.3] },
            ],
            "pine_canopy_tiers"
          )
        );
      }
      g.userData.modelVersion = 2;
      return g;
    };
  }
  function bBuilding(wallIdx, w, h, d, roofC, flat, style) {
    return () => {
      const g = new T.Group();
      const kind = style || (flat ? (h > 0.78 ? "tower" : "storefront") : "suburban");
      g.name = `bbb_building_${kind}_v2`;
      const wallMat = buildingWallMats[wallIdx % buildingWallMats.length];
      const walls = mesh(GEO.box, wallMat, w, h, d, 0, h / 2, 0);
      walls.name = `bbb_building_walls_${kind}`;
      walls.userData.wallTop = h;
      g.add(walls);
      const roofGap = 0.006;
      if (flat) {
        const roofH = h * 0.09;
        const roof = mesh(GEO.box, mat(roofC, { roughness: 0.64, metalness: 0.04 }), w * 1.06, roofH, d * 1.06, 0, h + roofGap + roofH / 2, 0);
        roof.name = "bbb_roof_flat_v3";
        roof.userData.baseAboveWall = roofGap;
        g.add(roof);
      } else {
        const roof = mesh(GEO.roof, mat(roofC, { roughness: 0.76, flatShading: true }), w * 1.12, h * 0.68, d * 1.12, 0, h + roofGap, 0);
        roof.name = "bbb_roof_gable_v3";
        roof.userData.baseAboveWall = roofGap;
        g.add(roof);
      }
      g.add(mesh(GEO.box, woodMat, w * 0.16, h * 0.32, 0.05, 0, h * 0.16, d / 2 + 0.03));
      if (kind === "storefront") {
        g.add(mesh(GEO.box, mat(roofC, { roughness: 0.52 }), w * 0.72, h * 0.1, d * 0.18, 0, h * 0.68, d / 2 + d * 0.09));
      } else if (kind === "industrial") {
        g.add(
          instanced(
            GEO.cyl,
            mat(0x6f7880, { roughness: 0.42, metalness: 0.45 }),
            [-0.22, 0.22].map((x) => ({ p: [x * w, h + h * 0.13, 0], s: [w * 0.07, h * 0.2, w * 0.07] })),
            "building_rooftop_vents"
          )
        );
      } else if (kind === "civic") {
        g.add(mesh(GEO.cone, mat(0xe8e0c9, { roughness: 0.7 }), w * 0.12, h * 0.48, w * 0.12, 0, h * 1.28, 0));
      } else if (kind === "tower") {
        g.add(mesh(GEO.box, mat(0x65727e, { roughness: 0.55, metalness: 0.12 }), w * 0.38, h * 0.16, d * 0.38, 0, h + h * 0.13, 0));
      } else {
        g.add(mesh(GEO.box, mat(0xffeed0, { roughness: 0.8 }), w * 0.46, h * 0.07, d * 0.2, 0, h * 0.36, d / 2 + d * 0.1));
      }
      g.userData.modelVersion = 2;
      g.userData.buildingStyle = kind;
      return g;
    };
  }

  function bGummy(c) {
    return () => {
      const g = new T.Group();
      const m = mat(c);
      g.add(mesh(GEO.sphLo, m, 0.42, 0.5, 0.3, 0, 0.5, 0));
      g.add(mesh(GEO.sphLo, m, 0.28, 0.28, 0.24, 0, 1.0, 0.02));
      g.add(mesh(GEO.sphLo, m, 0.1, 0.1, 0.08, -0.2, 1.24, 0));
      g.add(mesh(GEO.sphLo, m, 0.1, 0.1, 0.08, 0.2, 1.24, 0));
      g.add(mesh(GEO.sphLo, m, 0.13, 0.2, 0.12, -0.46, 0.6, 0));
      g.add(mesh(GEO.sphLo, m, 0.13, 0.2, 0.12, 0.46, 0.6, 0));
      return g;
    };
  }
  function bGoldfish(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.sphLo, mat(c), 0.32, 0.36, 0.55, 0, 0.36, 0.1));
      const tail = mesh(GEO.cone, mat(c), 0.22, 0.4, 0.06, 0, 0.36, -0.6);
      tail.rotation.x = Math.PI / 2;
      g.add(tail);
      return g;
    };
  }
  function bCrayon(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(c), 0.14, 0.7, 0.14, 0, 0.35, 0));
      g.add(mesh(GEO.cone, mat(c), 0.14, 0.24, 0.14, 0, 0.82, 0));
      g.add(mesh(GEO.cyl, mat(0xf3e6c8), 0.155, 0.26, 0.155, 0, 0.38, 0));
      return g;
    };
  }
  function bLego(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), 0.8, 0.45, 0.5, 0, 0.225, 0));
      for (const sp of [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12]]) {
        g.add(mesh(GEO.cyl, mat(c), 0.09, 0.1, 0.09, sp[0], 0.5, sp[1]));
      }
      return g;
    };
  }
  function bBinky() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x7ac9ff), 0.45, 0.1, 0.36, 0, 0.05, 0));
      g.add(mesh(GEO.sphLo, mat(0xffb26b), 0.17, 0.16, 0.17, 0, 0.18, 0));
      g.add(mesh(GEO.torus, mat(0x2ee0ff), 0.2, 0.2, 0.2, 0, 0.16, 0.32));
      return g;
    };
  }
  function bJuiceBox(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), 0.55, 0.9, 0.38, 0, 0.45, 0));
      g.add(mesh(GEO.box, mat(0xffffff), 0.34, 0.32, 0.02, 0, 0.5, 0.2));
      const straw = mesh(GEO.cyl, mat(0xffffff), 0.03, 0.4, 0.03, 0.16, 1.0, 0);
      straw.rotation.z = -0.25;
      g.add(straw);
      return g;
    };
  }
  function bSandwich() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0xe8c87a), 0.9, 0.16, 0.9, 0, 0.08, 0));
      g.add(mesh(GEO.box, mat(0x6fbf4a), 0.98, 0.08, 0.98, 0, 0.2, 0));
      g.add(mesh(GEO.box, mat(0xd96a5a), 0.94, 0.07, 0.94, 0, 0.27, 0));
      g.add(mesh(GEO.box, mat(0xe8c87a), 0.9, 0.16, 0.9, 0, 0.39, 0));
      return g;
    };
  }
  function bBroccoli() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x9fce7a), 0.12, 0.4, 0.12, 0, 0.2, 0));
      const fl = mat(0x1f6b26);
      g.add(mesh(GEO.sphLo, fl, 0.3, 0.26, 0.3, 0, 0.52, 0));
      g.add(mesh(GEO.sphLo, fl, 0.2, 0.18, 0.2, -0.22, 0.44, 0.06));
      g.add(mesh(GEO.sphLo, fl, 0.2, 0.18, 0.2, 0.2, 0.42, -0.1));
      return g;
    };
  }
  function bSoap() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0xbfe9ff), 0.85, 0.3, 0.55, 0, 0.15, 0));
      const bub = mat(0xffffff);
      g.add(mesh(GEO.sphLo, bub, 0.08, 0.08, 0.08, -0.15, 0.45, 0.1));
      g.add(mesh(GEO.sphLo, bub, 0.05, 0.05, 0.05, 0.12, 0.55, -0.05));
      return g;
    };
  }
  function bSippy(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(c), 0.3, 0.55, 0.3, 0, 0.275, 0));
      g.add(mesh(GEO.cyl, mat(0xffffff), 0.32, 0.14, 0.32, 0, 0.62, 0));
      g.add(mesh(GEO.box, mat(0xffffff), 0.12, 0.08, 0.2, 0, 0.72, 0.16));
      return g;
    };
  }
  function bPizza() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0xf0b24a), 0.55, 0.08, 0.55, 0, 0.04, 0));
      const pep = mat(0xc23b2e);
      g.add(mesh(GEO.cyl, pep, 0.12, 0.03, 0.12, -0.2, 0.09, 0.12));
      g.add(mesh(GEO.cyl, pep, 0.12, 0.03, 0.12, 0.18, 0.09, -0.15));
      g.add(mesh(GEO.cyl, pep, 0.12, 0.03, 0.12, 0.05, 0.09, 0.25));
      return g;
    };
  }
  function bFootball(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.sphLo, mat(c), 0.3, 0.3, 0.55, 0, 0.3, 0));
      g.add(mesh(GEO.box, mat(0xffffff), 0.04, 0.02, 0.3, 0, 0.6, 0));
      return g;
    };
  }
  function bBoombox() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x30364a), 1.0, 0.55, 0.35, 0, 0.3, 0));
      const sp = mat(0x9aa2b5);
      for (const sx of [-0.3, 0.3]) {
        const s1 = mesh(GEO.cyl, sp, 0.17, 0.06, 0.17, sx, 0.3, 0.19);
        s1.rotation.x = Math.PI / 2;
        g.add(s1);
      }
      g.add(mesh(GEO.box, mat(0x30364a), 0.5, 0.06, 0.08, 0, 0.65, 0));
      return g;
    };
  }
  function bTrike(c) {
    return () => {
      const g = new T.Group();
      const wm = mat(0x22242c);
      const fw = mesh(GEO.cyl, wm, 0.22, 0.08, 0.22, 0, 0.22, 0.3);
      fw.rotation.z = Math.PI / 2;
      g.add(fw);
      for (const bx of [-0.18, 0.18]) {
        const bw = mesh(GEO.cyl, wm, 0.13, 0.06, 0.13, bx, 0.13, -0.28);
        bw.rotation.z = Math.PI / 2;
        g.add(bw);
      }
      const frame = mesh(GEO.cyl, mat(c), 0.05, 0.62, 0.05, 0, 0.3, 0.02);
      frame.rotation.x = Math.PI / 2 - 0.3;
      g.add(frame);
      g.add(mesh(GEO.box, mat(c), 0.24, 0.06, 0.2, 0, 0.36, -0.22));
      g.add(mesh(GEO.box, mat(c), 0.38, 0.05, 0.05, 0, 0.56, 0.32));
      return g;
    };
  }
  function bTrashCan(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(c), 0.4, 0.85, 0.4, 0, 0.425, 0));
      g.add(mesh(GEO.cyl, mat(0x565a66), 0.45, 0.1, 0.45, 0, 0.9, 0));
      g.add(mesh(GEO.box, mat(0x565a66), 0.2, 0.05, 0.06, 0, 0.98, 0));
      return g;
    };
  }
  function bCart() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x9aa2b5), 0.8, 0.45, 0.55, 0, 0.55, 0.05));
      g.add(mesh(GEO.box, mat(0xd93f3f), 0.55, 0.05, 0.05, 0, 0.85, -0.32));
      const wm = mat(0x22242c);
      for (const wp of [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.2], [0.3, -0.2]]) {
        g.add(mesh(GEO.sphLo, wm, 0.08, 0.08, 0.08, wp[0], 0.1, wp[1]));
      }
      return g;
    };
  }
  function bScooter(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), 0.16, 0.05, 0.75, 0, 0.1, -0.05));
      const stem = mesh(GEO.cyl, mat(0x9aa2b5), 0.035, 0.7, 0.035, 0, 0.45, 0.32);
      stem.rotation.x = -0.15;
      g.add(stem);
      g.add(mesh(GEO.box, mat(c), 0.4, 0.05, 0.05, 0, 0.8, 0.37));
      const wm = mat(0x22242c);
      for (const wz of [0.35, -0.4]) {
        const w = mesh(GEO.cyl, wm, 0.09, 0.05, 0.09, 0, 0.09, wz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      return g;
    };
  }
  function bToolbox(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), 1.0, 0.4, 0.5, 0, 0.2, 0));
      g.add(mesh(GEO.box, mat(c), 1.02, 0.1, 0.52, 0, 0.45, 0));
      g.add(mesh(GEO.box, mat(0x22242c), 0.4, 0.06, 0.1, 0, 0.55, 0));
      return g;
    };
  }
  function bGnome() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cone, mat(0x2e6b8f), 0.3, 0.55, 0.3, 0, 0.275, 0));
      g.add(mesh(GEO.sphLo, mat(0xffffff), 0.16, 0.2, 0.14, 0, 0.48, 0.12));
      g.add(mesh(GEO.sphLo, mat(0xffd9b8), 0.15, 0.15, 0.15, 0, 0.62, 0.04));
      g.add(mesh(GEO.cone, mat(0xd93f3f), 0.17, 0.42, 0.17, 0, 0.9, 0));
      return g;
    };
  }
  function bFlamingo() {
    return () => {
      const g = new T.Group();
      const pink = mat(0xff7eb6);
      g.add(mesh(GEO.sphLo, pink, 0.3, 0.26, 0.38, 0, 0.6, 0));
      const neck = mesh(GEO.cyl, pink, 0.05, 0.45, 0.05, 0, 0.85, 0.3);
      neck.rotation.x = -0.3;
      g.add(neck);
      g.add(mesh(GEO.sphLo, pink, 0.11, 0.11, 0.13, 0, 1.06, 0.42));
      const beak = mesh(GEO.cone, mat(0x30364a), 0.05, 0.16, 0.05, 0, 1.04, 0.55);
      beak.rotation.x = Math.PI / 2;
      g.add(beak);
      g.add(mesh(GEO.cyl, mat(0x30364a), 0.025, 0.6, 0.025, 0.02, 0.3, 0));
      return g;
    };
  }
  function bStatue() {
    return () => {
      const g = bPerson(0x9aa2b5, 1)();
      for (const c2 of g.children) c2.position.y += 0.35;
      g.add(mesh(GEO.box, mat(0x7f8fa6), 0.9, 0.35, 0.9, 0, 0.175, 0));
      return g;
    };
  }
  function bKiddiePool() {
    return () => {
      const g = new T.Group();
      const rim = mesh(GEO.torus, mat(0xff7eb6), 0.5, 0.5, 0.5, 0, 0.14, 0);
      rim.rotation.x = -Math.PI / 2;
      g.add(rim);
      g.add(mesh(GEO.cyl, mat(0x2ee0ff), 0.44, 0.12, 0.44, 0, 0.08, 0));
      return g;
    };
  }
  function bTrampolinePro() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x22242c), 0.52, 0.05, 0.52, 0, 0.42, 0));
      const rim = mesh(GEO.torus, mat(0x2e6b8f), 0.52, 0.52, 0.52, 0, 0.45, 0);
      rim.rotation.x = -Math.PI / 2;
      g.add(rim);
      for (const lp of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
        g.add(mesh(GEO.cyl, mat(0x9aa2b5), 0.03, 0.42, 0.03, lp[0], 0.21, lp[1]));
      }
      return g;
    };
  }
  function bDumpsterPro(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(c), 1.0, 0.6, 0.7, 0, 0.32, 0));
      const lid = mesh(GEO.box, mat(0x2e5a33), 1.04, 0.05, 0.74, 0, 0.66, -0.06);
      lid.rotation.x = -0.28;
      g.add(lid);
      return g;
    };
  }
  function bFencePicket() {
    return () => {
      const g = new T.Group();
      g.name = "bbb_cedar_fence_v2";
      g.add(
        instanced(
          GEO.picket,
          woodMat,
          [-0.36, 0, 0.36].map((x) => ({ p: [x, 0, 0], s: [0.18, 0.82, 0.32] })),
          "fence_pickets"
        )
      );
      g.add(
        instanced(
          GEO.box,
          woodMat,
          [0.28, 0.58].map((y) => ({ p: [0, y, 0.035], s: [1.05, 0.075, 0.055] })),
          "fence_rails"
        )
      );
      g.userData.modelVersion = 2;
      return g;
    };
  }
  function bKale() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0xe8e4da), 0.3, 0.6, 0.3, 0, 0.3, 0));
      g.add(mesh(GEO.sphLo, mat(0x5fae3f), 0.28, 0.2, 0.28, 0, 0.66, 0));
      const straw = mesh(GEO.cyl, mat(0xd93f3f), 0.03, 0.35, 0.03, 0.1, 0.86, 0);
      straw.rotation.z = -0.2;
      g.add(straw);
      return g;
    };
  }
  function bRoomba() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x30364a), 0.5, 0.16, 0.5, 0, 0.08, 0));
      g.add(mesh(GEO.cyl, mat(0x9aa2b5), 0.12, 0.06, 0.12, 0, 0.19, 0.1));
      return g;
    };
  }

  function bSock() {
    return () => {
      const g = new T.Group();
      const w = mat(0xd9d9e8);
      g.add(mesh(GEO.box, w, 0.3, 0.2, 0.62, 0, 0.1, 0.06));   // foot
      g.add(mesh(GEO.box, w, 0.3, 0.34, 0.26, 0, 0.24, -0.22)); // ankle
      g.add(mesh(GEO.box, mat(0x9aa2b5), 0.32, 0.21, 0.12, 0, 0.105, 0.32)); // toe stripe
      return g;
    };
  }
  function bDiaper() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.sphLo, mat(0xe8e4da), 0.5, 0.34, 0.44, 0, 0.3, 0));
      g.add(mesh(GEO.box, mat(0xffd43b), 0.16, 0.1, 0.05, -0.4, 0.42, 0.3));
      g.add(mesh(GEO.box, mat(0xffd43b), 0.16, 0.1, 0.05, 0.4, 0.42, 0.3));
      g.add(mesh(GEO.sphLo, mat(0x8a5a34), 0.1, 0.07, 0.1, 0.05, 0.6, -0.05)); // do not ask
      return g;
    };
  }
  function bLitterBox() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x9aa2b5), 1.0, 0.32, 0.7, 0, 0.16, 0));
      g.add(mesh(GEO.box, mat(0xe8d9b0), 0.9, 0.08, 0.6, 0, 0.32, 0));
      g.add(mesh(GEO.sphLo, mat(0x8a5a34), 0.12, 0.09, 0.12, 0.18, 0.4, 0.08)); // the surprise
      return g;
    };
  }
  function bSproutCrate() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x8a6a3a), 1.0, 0.5, 0.8, 0, 0.25, 0));
      const sp = mat(0x4f8f3a);
      g.add(mesh(GEO.sphLo, sp, 0.16, 0.16, 0.16, -0.25, 0.58, 0.1));
      g.add(mesh(GEO.sphLo, sp, 0.16, 0.16, 0.16, 0.15, 0.58, -0.15));
      g.add(mesh(GEO.sphLo, sp, 0.16, 0.16, 0.16, 0.25, 0.58, 0.18));
      return g;
    };
  }
  function bCheese() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0xc9d17a), 0.5, 0.36, 0.5, 0, 0.18, 0));
      const mold = mat(0x5a7ab5);
      g.add(mesh(GEO.sphLo, mold, 0.07, 0.05, 0.07, -0.2, 0.37, 0.12));
      g.add(mesh(GEO.sphLo, mold, 0.05, 0.04, 0.05, 0.15, 0.37, -0.2));
      g.add(mesh(GEO.sphLo, mold, 0.06, 0.05, 0.06, 0.3, 0.2, 0.35));
      g.add(mesh(GEO.box, mat(0xc9d17a), 0.3, 0.22, 0.22, 0.62, 0.11, 0.2)); // the wedge someone regretted
      return g;
    };
  }
  function bSandbox() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x8a6a3a), 1.0, 0.25, 1.0, 0, 0.125, 0));
      g.add(mesh(GEO.box, mat(0xf3c34e), 0.86, 0.1, 0.86, 0, 0.24, 0));
      g.add(mesh(GEO.cyl, mat(0xd93f3f), 0.1, 0.14, 0.1, 0.22, 0.36, -0.15)); // bucket
      return g;
    };
  }
  function bVat() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x7a8f3a), 0.5, 0.7, 0.5, 0, 0.35, 0));
      g.add(mesh(GEO.cyl, mat(0x565a66), 0.53, 0.06, 0.53, 0, 0.72, 0));
      g.add(mesh(GEO.cyl, mat(0x9fdb4f), 0.44, 0.05, 0.44, 0, 0.76, 0)); // the goo
      const pipe = mesh(GEO.cyl, mat(0x565a66), 0.05, 0.6, 0.05, 0.52, 0.4, 0);
      g.add(pipe);
      return g;
    };
  }
  function bSewage() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mat(0x6b7a2f), 0.5, 0.55, 0.5, 0, 0.275, 0));
      g.add(mesh(GEO.cyl, mat(0x9fdb4f), 0.44, 0.04, 0.44, 0, 0.57, 0));
      g.add(mesh(GEO.cyl, mat(0x6b7a2f), 0.2, 0.4, 0.2, 0.62, 0.2, 0.2));
      g.add(mesh(GEO.cyl, mat(0x6b7a2f), 0.2, 0.4, 0.2, -0.6, 0.2, -0.22));
      const pipe = mesh(GEO.cyl, mat(0x565a66), 0.05, 0.5, 0.05, 0.3, 0.5, 0.1);
      pipe.rotation.z = Math.PI / 2;
      g.add(pipe);
      return g;
    };
  }
  // Vehicles (forward = +Z like bCar).
  function bTruck(boxC, cabC) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(boxC), 0.5, 0.52, 0.6, 0, 0.42, -0.16));
      g.add(mesh(GEO.box, mat(cabC), 0.44, 0.3, 0.28, 0, 0.28, 0.32));
      g.add(mesh(GEO.box, mat(0xbfe9ff), 0.4, 0.14, 0.02, 0, 0.36, 0.46));
      const wm = mat(0x22242c);
      for (const wz of [0.3, -0.3]) {
        const w = mesh(GEO.cyl, wm, 0.11, 0.48, 0.11, 0, 0.11, wz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      const lm = mat(0xfff3b0);
      g.add(mesh(GEO.sphLo, lm, 0.05, 0.05, 0.04, -0.15, 0.2, 0.46));
      g.add(mesh(GEO.sphLo, lm, 0.05, 0.05, 0.04, 0.15, 0.2, 0.46));
      return g;
    };
  }
  function bTanker(c) {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0x9aa2b5), 0.44, 0.3, 0.28, 0, 0.28, 0.34));
      g.add(mesh(GEO.box, mat(0xbfe9ff), 0.4, 0.14, 0.02, 0, 0.36, 0.48));
      const tank = mesh(GEO.cyl, mat(c), 0.24, 0.62, 0.24, 0, 0.42, -0.14);
      tank.rotation.x = Math.PI / 2;
      g.add(tank);
      g.add(mesh(GEO.cyl, mat(0x9fdb4f), 0.1, 0.06, 0.1, 0, 0.68, -0.14)); // sloshing hatch
      const wm = mat(0x22242c);
      for (const wz of [0.3, -0.3]) {
        const w = mesh(GEO.cyl, wm, 0.11, 0.48, 0.11, 0, 0.11, wz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      return g;
    };
  }
  function bBus() {
    return () => {
      const g = new T.Group();
      g.add(mesh(GEO.box, mat(0xffd43b), 0.42, 0.42, 1.0, 0, 0.34, 0));
      g.add(mesh(GEO.box, mat(0xbfe9ff), 0.44, 0.13, 0.84, 0, 0.44, 0));
      g.add(mesh(GEO.box, mat(0x22242c), 0.445, 0.05, 0.9, 0, 0.24, 0));
      const wm = mat(0x22242c);
      for (const wz of [0.32, -0.32]) {
        const w = mesh(GEO.cyl, wm, 0.11, 0.46, 0.11, 0, 0.11, wz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      const lm = mat(0xfff3b0);
      g.add(mesh(GEO.sphLo, lm, 0.05, 0.05, 0.04, -0.13, 0.24, 0.5));
      g.add(mesh(GEO.sphLo, lm, 0.05, 0.05, 0.04, 0.13, 0.24, 0.5));
      return g;
    };
  }

  // ---------- Dynamic templates (respawn around the baby, never saved) ----
  // surface: grass | walk | road. w = spawn weight within its size band.
  const DYN_TPLS = [
    // snacks & toys
    { e: "🥣", n: "Soggy Cheerio", s: 0.05, w: 3, surface: "grass", build: bDonut(0xd9a45b, 0.5) },
    { e: "🐻", n: "Gummy Bear", s: 0.06, w: 2, surface: "grass", build: bGummy(0xff5f7e) },
    { e: "🐠", n: "Goldfish Cracker", s: 0.05, w: 2, surface: "grass", build: bGoldfish(0xe8923a) },
    { e: "🍇", n: "Rogue Raisin", s: 0.045, w: 1, surface: "grass", build: bSphere(0x5b3a5e, 0.42) },
    { e: "🍟", n: "Dropped Fry", s: 0.08, w: 2, surface: "walk", build: bBox(0xf3c34e, 0.28, 0.22, 1.0) },
    { e: "🐜", n: "Ant With Big Dreams", s: 0.05, w: 1, surface: "grass", mover: true, spd: 0.4, build: bCritter(0x38222c, 0x38222c, 0.3, false, true) },
    { e: "🖍️", n: "Crayon (Eaten Flavor)", s: 0.11, w: 2, surface: "grass", build: bCrayon(0xff5f2e) },
    { e: "🧱", n: "LEGO of Pain", s: 0.1, w: 2, surface: "grass", build: bLego(0xff2e5e) },
    { e: "🍼", n: "Emergency Binky", s: 0.12, w: 1, surface: "grass", build: bBinky() },
    { e: "🏎️", n: "Hot Wheels", s: 0.14, w: 2, surface: "walk", build: bCar(0xffd43b, 1) },
    { e: "🧃", n: "Juice Box", s: 0.16, w: 2, surface: "grass", build: bJuiceBox(0x35c76a) },
    { e: "🥪", n: "Half A Sandwich", s: 0.18, w: 1, surface: "walk", build: bSandwich() },
    { e: "🧦", n: "Sock (Clean-ish)", s: 0.17, w: 1, surface: "grass", build: bSock() },
    { e: "🥦", n: "Broccoli Floret", s: 0.12, w: 1.2, surface: "grass", puke: true, build: bBroccoli() },
    { e: "🧼", n: "Bar of Soap", s: 0.14, w: 0.6, surface: "walk", puke: true, build: bSoap() },
    { e: "🦆", n: "Rubber Ducky", s: 0.24, w: 2, surface: "grass", build: bCritter(0xffd43b, 0xffd43b, 0.5, true) },
    { e: "🦸", n: "Action Figure Greg", s: 0.25, w: 1.5, surface: "grass", build: bPerson(0x2ee0ff, 1) },
    { e: "🥤", n: "Sippy Cup of Power", s: 0.22, w: 1, surface: "walk", build: bSippy(0xb06cff) },
    { e: "🍕", n: "Floor Pizza (Bold Choice)", s: 0.28, w: 1.5, surface: "walk", build: bPizza() },
    { e: "🏈", n: "Football", s: 0.3, w: 1, surface: "grass", build: bFootball(0x8a4b2d) },
    { e: "🪴", n: "Fern-ando the House Plant", s: 0.32, w: 1, surface: "grass", build: bTree(0x3f9c46, 0.4, true) },
    { e: "🤖", n: "Escaped Roomba", s: 0.4, w: 0.7, surface: "walk", mover: true, spd: 0.9, build: bRoomba() },
    { e: "🚼", n: "Dirty Diaper (Occupied)", s: 0.26, w: 1, surface: "grass", puke: true, build: bDiaper() },
    { e: "🐱", n: "Litter Box Surprise", s: 0.4, w: 0.6, surface: "grass", puke: true, build: bLitterBox() },
    // critters & people
    { e: "🐕", n: "Beans the Chihuahua", s: 0.5, w: 1, surface: "grass", mover: true, spd: 2.4, flees: true, build: bCritter(0xc98f5e, 0xc98f5e, 0.5, false, true) },
    { e: "🐈", n: "Chairman Meow", s: 0.55, w: 1, surface: "grass", mover: true, spd: 2.2, flees: true, build: bCritter(0x8a6bff, 0x8a6bff, 0.5, false, true) },
    { e: "🦨", n: "Sir Stinks-A-Lot", s: 0.5, w: 0.8, surface: "grass", mover: true, spd: 1.2, puke: true, build: bCritter(0x24242c, 0xffffff, 0.5, false, true) },
    { e: "🛴", n: "Scooter (Abandoned Lawfully)", s: 0.8, w: 1, surface: "walk", build: bScooter(0x2ee0ff) },
    { e: "📻", n: "Boombox (Mid Guitar Solo)", s: 0.6, w: 0.7, surface: "grass", build: bBoombox() },
    { e: "🦄", n: "Pool Floatie", s: 0.9, w: 0.8, surface: "grass", build: bDonut(0xff7eb6, 0.5) },
    { e: "🚲", n: "Tricycle of Destiny", s: 0.7, w: 1, surface: "walk", build: bTrike(0xd93f3f) },
    { e: "🧰", n: "Dad's Toolbox", s: 0.55, w: 0.7, surface: "grass", build: bToolbox(0xd93f3f) },
    { e: "🥬", n: "Kale Smoothie (Large)", s: 0.55, w: 0.7, surface: "walk", puke: true, build: bKale() },
    { e: "🫑", n: "Brussels Sprout Crate", s: 0.7, w: 0.5, surface: "grass", puke: true, build: bSproutCrate() },
    { e: "🚧", n: "Street Candy (Cone)", s: 1.05, w: 1.5, surface: "road", build: () => { const g = new T.Group(); g.add(mesh(GEO.cone, mat(0xff7a2e), 0.4, 1.0, 0.4, 0, 0.5, 0)); g.add(mesh(GEO.cyl, mat(0xffffff), 0.28, 0.08, 0.28, 0, 0.55, 0)); return g; } },
    { e: "🗑️", n: "Trash Can (Regular)", s: 1.2, w: 1.5, surface: "walk", build: bTrashCan(0x6a7284) },
    { e: "🛒", n: "Feral Shopping Cart", s: 1.5, w: 1, surface: "walk", build: bCart() },
    { e: "🏃", n: "Jogger Kevin (5K PB)", s: 1.7, w: 1.2, surface: "walk", mover: true, spd: 3.4, flees: true, build: bPerson(0x2ee0ff, 1) },
    { e: "👵", n: "Grandma Doris (Deceptively Fast)", s: 1.6, w: 1, surface: "walk", mover: true, spd: 2.6, flees: true, build: bPerson(0xb06cff, 1) },
    { e: "🧑‍🚒", n: "Mailman (Has Seen Things)", s: 1.7, w: 0.8, surface: "walk", mover: true, spd: 2.8, flees: true, build: bPerson(0xd9d9e8, 1) },
    { e: "🧀", n: "Blue Cheese Wheel", s: 1.0, w: 0.5, surface: "walk", puke: true, build: bCheese() },
    { e: "🌭", n: "Hot Dog Cart (Unattended)", s: 2.2, w: 0.6, surface: "walk", build: () => { const g = new T.Group(); g.add(mesh(GEO.box, mat(0xe8e4da), 0.9, 0.6, 0.5, 0, 0.5, 0)); g.add(mesh(GEO.cyl, mat(0xd93f3f), 0.35, 0.1, 0.35, 0, 0.9, 0)); g.add(mesh(GEO.cyl, mat(0x9aa2b5), 0.03, 0.6, 0.03, 0.2, 1.2, 0)); g.add(mesh(GEO.cone, mat(0xd93f3f), 0.5, 0.22, 0.5, 0.2, 1.55, 0)); return g; } },
    // traffic (drives: spawns on a road lane and actually drives it)
    { e: "🚗", n: "Sedan (Running Errands)", s: 2.4, w: 2, surface: "road", drives: true, spd: 8, build: bCar(0xd93f3f, 1) },
    { e: "🚐", n: "Minivan of Destiny", s: 2.8, w: 1.5, surface: "road", drives: true, spd: 7, build: bCar(0x4f8fd9, 1) },
    { e: "⛳", n: "HOA Patrol Golf Cart", s: 2.3, w: 0.7, surface: "road", drives: true, spd: 4, build: bCar(0xe8e4da, 1) },
    { e: "📦", n: "Mail Truck (Full of Secrets)", s: 3.2, w: 1, surface: "road", drives: true, spd: 6, build: bTruck(0xe8e4da, 0x4f8fd9) },
    { e: "🌮", n: "Food Truck 'Taco Tuesdaze'", s: 4.2, w: 0.6, surface: "road", drives: true, spd: 5, build: bTruck(0xffd43b, 0xd93f3f) },
    { e: "🚌", n: "School Bus (Empty, Phew)", s: 6.2, w: 0.7, surface: "road", drives: true, spd: 7, build: bBus() },
    { e: "🚛", n: "Garbage Truck (Full)", s: 5.8, w: 0.7, surface: "road", drives: true, spd: 5, puke: true, build: bTruck(0x3f7a44, 0x565a66) },
    { e: "🛢️", n: "Sewage Tanker (Sloshing)", s: 6.3, w: 0.5, surface: "road", drives: true, spd: 5, puke: true, build: bTanker(0x8a7a3a) },
  ];

  // ---------- Permanent templates (the constant city; eaten stays eaten) ----
  const PERM = {
    fence: { e: "🪵", n: "Fence Bit (Picket Flavor)", s: 1.1, build: bFencePicket() },
    mailbox: { e: "📬", n: "Passive-Aggressive Mailbox", s: 1.0, build: () => { const g = new T.Group(); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.06, 0.7, 0.06, 0, 0.35, 0)); g.add(mesh(GEO.box, mat(0xd93f3f), 0.45, 0.3, 0.3, 0, 0.8, 0)); return g; } },
    hydrant: { e: "🧯", n: "Fire Hydrant Franklin", s: 1.15, build: () => { const g = new T.Group(); g.add(mesh(GEO.cyl, mat(0xd93f3f), 0.3, 0.9, 0.3, 0, 0.45, 0)); g.add(mesh(GEO.sphLo, mat(0xd93f3f), 0.32, 0.25, 0.32, 0, 0.95, 0)); return g; } },
    bush: { e: "🌿", n: "Suspicious Shrubbery", s: 1.4, build: bTree(0x3f9c46, 0.55, true) },
    hedge: { e: "🪴", n: "HOA-Approved Hedge", s: 1.8, build: bBox(0x3f9c46, 1.0, 0.55, 0.35) },
    bench: { e: "🪑", n: "Park Bench (Gum Underneath)", s: 1.5, build: () => { const g = new T.Group(); g.add(mesh(GEO.box, mat(0x8a4b2d), 1.0, 0.12, 0.35, 0, 0.35, 0)); g.add(mesh(GEO.box, mat(0x8a4b2d), 1.0, 0.35, 0.08, 0, 0.55, -0.12)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.06, 0.35, 0.06, -0.4, 0.17, 0.1)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.06, 0.35, 0.06, 0.4, 0.17, 0.1)); return g; } },
    lamp: { e: "💡", n: "Street Lamp (Moth Condo)", s: 2.2, build: () => { const g = new T.Group(); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.08, 1.0, 0.08, 0, 0.5, 0)); g.add(mesh(GEO.sphLo, mat(0xffe9a8), 0.22, 0.18, 0.22, 0, 1.05, 0)); return g; } },
    trashCan: { e: "🗑️", n: "Curbside Trash Can", s: 1.1, build: bTrashCan(0x6a7284) },
    parkedCar: { e: "🚙", n: "Parked Car (Still Warm)", s: 2.6, build: bCar(0x4f8fd9, 1) },
    garden: { e: "🌻", n: "Flower Bed (Bee Drama)", s: 1.6, build: () => { const g = new T.Group(); g.add(mesh(GEO.box, mat(0x6b4a2a), 1.0, 0.2, 0.55, 0, 0.1, 0)); g.add(mesh(GEO.sphLo, mat(0xffd43b), 0.2, 0.2, 0.2, -0.25, 0.35, 0)); g.add(mesh(GEO.sphLo, mat(0xff7eb6), 0.18, 0.18, 0.18, 0.1, 0.32, 0.05)); g.add(mesh(GEO.sphLo, mat(0xb06cff), 0.16, 0.16, 0.16, 0.3, 0.3, -0.05)); return g; } },
    gnome: { e: "🧙", n: "Gnorman (Do Not Trust)", s: 0.42, build: bGnome() },
    flamingo: { e: "🦩", n: "Lawn Flamingo", s: 0.6, build: bFlamingo() },
    grill: { e: "🔥", n: "Dad's Sacred Grill", s: 1.2, build: () => { const g = new T.Group(); g.add(mesh(GEO.sphLo, mat(0x30364a), 0.55, 0.4, 0.55, 0, 0.75, 0)); g.add(mesh(GEO.box, mat(0x9aa2b5), 0.24, 0.05, 0.06, 0, 1.02, 0)); for (const la of [0.5, 2.6, 4.7]) { const leg = mesh(GEO.cyl, mat(0x22242c), 0.04, 0.72, 0.04, Math.sin(la) * 0.26, 0.36, Math.cos(la) * 0.26); leg.rotation.z = Math.sin(la) * 0.18; leg.rotation.x = -Math.cos(la) * 0.18; g.add(leg); } g.add(mesh(GEO.box, mat(0x9aa2b5), 0.38, 0.04, 0.3, 0.6, 0.72, 0)); return g; } },
    doghouse: { e: "🛖", n: "Beans' Crib (Doghouse)", s: 1.5, build: bBuilding(0, 1, 0.7, 0.9, 0xd93f3f, false, "suburban") },
    sandbox: { e: "🏖️", n: "Sandbox (Beach at Home)", s: 1.4, build: bSandbox() },
    pool: { e: "🏊", n: "Kiddie Pool (Shark Included)", s: 1.9, build: bKiddiePool() },
    trampoline: { e: "🤸", n: "Trampoline (Liability)", s: 2.6, build: bTrampolinePro() },
    swing: { e: "🎠", n: "Swing Set (Haunted?)", s: 2.9, build: () => { const g = new T.Group(); g.add(mesh(GEO.box, mat(0xd93f3f), 1.0, 0.08, 0.08, 0, 0.8, 0)); g.add(mesh(GEO.cyl, mat(0xd93f3f), 0.05, 0.85, 0.05, -0.5, 0.42, 0)); g.add(mesh(GEO.cyl, mat(0xd93f3f), 0.05, 0.85, 0.05, 0.5, 0.42, 0)); g.add(mesh(GEO.box, mat(0xffd43b), 0.25, 0.05, 0.12, 0, 0.3, 0)); return g; } },
    cow: { e: "🐄", n: "Decorative Cow (Why)", s: 2.5, build: bCritter(0xe8e4da, 0xe8e4da, 0.5, false, true) },
    busStop: { e: "🚏", n: "Bus Stop (One Guy Waiting)", s: 2.6, build: bBuilding(2, 1, 0.8, 0.4, 0x2ee0ff, true, "storefront") },
    fountain: { e: "⛲", n: "Fountain of Loose Change", s: 3.3, build: () => { const g = new T.Group(); g.add(mesh(GEO.cyl, mat(0x9aa2b5), 0.55, 0.25, 0.55, 0, 0.12, 0)); g.add(mesh(GEO.cyl, mat(0x2ee0ff), 0.4, 0.3, 0.4, 0, 0.3, 0)); g.add(mesh(GEO.cyl, mat(0x9aa2b5), 0.1, 0.5, 0.1, 0, 0.5, 0)); return g; } },
    shed: { e: "🛠️", n: "Tool Shed of Mystery", s: 3.4, build: bBuilding(1, 0.9, 0.8, 0.8, 0x6a7284, false) },
    dumpster: { e: "♻️", n: "Dumpster (Enchanted)", s: 2.4, puke: true, build: bDumpsterPro(0x3f7a44) },
    portaPotty: { e: "🚽", n: "Porta-Potty (DO NOT)", s: 1.6, puke: true, build: bBuilding(2, 0.7, 1, 0.7, 0x2e6b8f, true, "utility") },
    oak: { e: "🌳", n: "Oak Tree (Wise)", s: 4.5, build: bTree(0x3f9c46, 0.55, true) },
    pine: { e: "🌲", n: "Pine Tree (Pointy)", s: 5.5, build: bTree(0x2f7a4f, 0.5, false) },
    statue: { e: "🗿", n: "Statue of Mayor Bumsworth", s: 5.0, build: bStatue() },
    billboard: { e: "🪧", n: "Billboard: 'NAPS. ASK YOUR BABY.'", s: 6.0, build: () => { const g = new T.Group(); g.add(mesh(GEO.box, mat(0xe8e4da), 1.0, 0.5, 0.06, 0, 0.7, 0)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.05, 0.5, 0.05, 0, 0.25, 0)); return g; } },
    rv: { e: "🏕️", n: "Uncle's RV (Home Since 2019)", s: 5.5, build: bTruck(0xe8e4da, 0xc46a4f) },
    tinyHouse: { e: "🏚️", n: "Influencer's Tiny House", s: 6.4, building: true, build: bBuilding(3, 0.8, 0.9, 0.7, 0x30364a, false) },
    garage: { e: "🏠", n: "Garage (No Cars, All Boxes)", s: 7.2, building: true, build: bBuilding(1, 1, 0.65, 0.8, 0x6a7284, true) },
    bungalow: { e: "🏡", n: "Bungalow (Good Bones)", s: 8.0, building: true, build: bBuilding(0, 1, 0.75, 0.9, 0x8f4a3a, false) },
    home: { e: "🏡", n: "YOUR House (Sorry, Mom)", s: 9, building: true, build: bBuilding(0, 1, 0.8, 0.9, 0xd93f3f, false) },
    cornerStore: { e: "🏪", n: "Corner Store (Open 25/7)", s: 9.5, building: true, build: bBuilding(2, 1, 0.7, 0.9, 0x2ee0ff, true, "storefront") },
    tacoPalace: { e: "🌯", n: "Taco Palace (Est. Tuesday)", s: 10.0, building: true, build: bBuilding(4, 1, 0.7, 0.9, 0xffd43b, true, "storefront") },
    gasStation: { e: "⛽", n: "Gas Station (Sushi Also)", s: 10.5, building: true, build: bBuilding(3, 1, 0.55, 0.9, 0xd93f3f, true, "storefront") },
    waterVat: { e: "☣️", n: "Water Treatment Vat", s: 9.0, puke: true, build: bVat() },
    warehouse: { e: "🏭", n: "Warehouse (Definitely Not Haunted)", s: 12, building: true, build: bBuilding(3, 1, 0.55, 0.95, 0x6a7284, true, "industrial") },
    duplex: { e: "🏘️", n: "Duplex (Shared Mail Drama)", s: 10.5, building: true, build: bBuilding(1, 1.1, 0.7, 0.85, 0x8f4a3a, false) },
    mcmansion: { e: "🏰", n: "McMansion (3 Garages, 0 Books)", s: 13, building: true, build: bBuilding(1, 1, 0.8, 0.9, 0x8f4a3a, false) },
    gym: { e: "🏋️", n: "Gym (Ironically)", s: 14, building: true, build: bBuilding(2, 1, 0.6, 0.9, 0x30364a, true, "industrial") },
    grocery: { e: "🏬", n: "Grocery Store (Samples!)", s: 16, building: true, build: bBuilding(4, 1, 0.55, 0.95, 0x2e6b8f, true, "storefront") },
    hoa: { e: "🏢", n: "HOA Headquarters (Finally)", s: 15, building: true, build: bBuilding(2, 0.9, 1, 0.9, 0x22242c, true, "tower") },
    church: { e: "⛪", n: "Church of the Sacred Snack", s: 16.5, building: true, build: bBuilding(0, 0.8, 1, 1, 0x6a7284, false, "civic") },
    sewagePlant: { e: "☢️", n: "Sewage Plant (The Big One)", s: 15, puke: true, build: bSewage() },
    apartment: { e: "🏨", n: "Apartment Block (Thin Walls)", s: 18, building: true, build: bBuilding(2, 0.75, 1, 0.75, 0x9aa2b5, true, "tower") },
    waterTower: { e: "🗼", n: "Water Tower (Town Juice Box)", s: 20, building: true, build: () => { const g = new T.Group(); g.add(mesh(GEO.sphLo, mat(0x9fdcff), 0.4, 0.32, 0.4, 0, 0.75, 0)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.05, 0.6, 0.05, 0.22, 0.3, 0.22)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.05, 0.6, 0.05, -0.22, 0.3, 0.22)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.05, 0.6, 0.05, 0.22, 0.3, -0.22)); g.add(mesh(GEO.cyl, mat(0x6a7284), 0.05, 0.6, 0.05, -0.22, 0.3, -0.22)); return g; } },
    office: { e: "🏦", n: "Office Block (Synergy Inside)", s: 24, building: true, build: bBuilding(2, 0.7, 1, 0.7, 0x30364a, true, "tower") },
    mall: { e: "🛍️", n: "The Mall (Dying Since 2009)", s: 26, building: true, build: bBuilding(4, 1, 0.5, 0.95, 0xb06cff, true, "storefront") },
  };
  const PERM_LIST = Object.values(PERM);
  const ALL_TPLS = DYN_TPLS.concat(PERM_LIST);

  // ---------- Game state ----------
  let phase = "menu"; // menu | play | paused | over
  let freePlay = false;
  let objects = [];      // permanents (stable ids 0..N) + live dynamics (id -1)
  let permCount = 0;
  let dynCount = 0;
  let baby = null;
  let score = 0;
  let noms = 0;
  let combo = 0;
  let comboTimer = 0;
  let burpTimer = 0;
  let burpCooldown = 0;
  let slowTimer = 0;
  let sickTimer = 0;
  let pukeImmune = 0;
  let hitImmune = 0;   // grace period after an enemy hit
  let gasEmitT = 0;    // fart gas trail emitter
  let gasPuffT = 0;
  let shake = 0;
  let playSeconds = 0;
  let biggestNom = null;
  let bonkCooldown = 0;
  let saveTimer = 0;
  let spawnTimer = 0;
  let recordedPhases = new Set();
  let high = Math.max(Number(api.getHighScore ? api.getHighScore(GAME_ID) : 0) || 0, Number(localStorage.getItem(LS_HIGH)) || 0);
  let camYaw = Math.PI;
  let camDist = 3;
  let lastPhaseName = "";

  // ---------- Spatial hash ----------
  const CELL = 16;
  const grid = new Map();
  const cellKey = (cx, cz) => cx * 100000 + cz;
  function gridAdd(o) {
    const k = cellKey(Math.floor(o.x / CELL), Math.floor(o.z / CELL));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(o);
    o.cell = k;
  }
  function gridRemove(o) {
    const arr = grid.get(o.cell);
    if (arr) {
      const i = arr.indexOf(o);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  function gridMove(o) {
    const k = cellKey(Math.floor(o.x / CELL), Math.floor(o.z / CELL));
    if (k === o.cell) return;
    gridRemove(o);
    gridAdd(o);
  }
  function forNear(x, z, r, fn) {
    const c0x = Math.floor((x - r) / CELL);
    const c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL);
    const c1z = Math.floor((z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = grid.get(cellKey(cx, cz));
        if (arr) for (let i = arr.length - 1; i >= 0; i--) fn(arr[i]);
      }
    }
  }

  // ---------- Object plumbing ----------
  const activeObjs = new Set();
  function makeObj(tpl, x, z, szMul, dyn, rngFn) {
    const rnd = rngFn || Math.random;
    return {
      id: dyn ? -1 : permCount++,
      tpl,
      x,
      z,
      s: tpl.s * (szMul || 1),
      yaw: rnd() * Math.PI * 2,
      dead: false,
      dyn: !!dyn,
      g: null,
      stink: null,
      wispScale: 0,
      mvx: 0,
      mvz: 0,
      wanderT: rnd() * 2,
      panic: 0,
      driveAxis: null, // 'x' | 'z' for traffic
      bob: rnd() * Math.PI * 2,
      cell: null,
    };
  }
  function addObj(o) {
    objects.push(o);
    gridAdd(o);
    if (o.dyn) dynCount++;
    return o;
  }
  // Fully delete a dynamic object (despawn/eaten cleanup).
  function removeObj(o) {
    gridRemove(o);
    if (o.g) dropObjGroup(o);
    const i = objects.indexOf(o);
    if (i >= 0) {
      objects[i] = objects[objects.length - 1];
      objects.pop();
    }
    if (o.dyn) dynCount--;
  }

  // ---------- The constant city ----------
  const YARD = { x0: -16, x1: 16, z0: -11, z1: 11 }; // home backyard at block (0,0)

  function districtFor(bx, bz) {
    if (bx === 0 && bz === 0) return "home";
    if (bz <= -4 && bz >= -7 && Math.abs(bx) <= 3) return "downtown";
    if ((bz === -2 || bz === -3) && Math.abs(bx) <= 5) return "commercial";
    if (bx >= 2 && bx <= 5 && bz >= 0 && bz <= 3) return "park";
    if (bx >= -6 && bx <= -3 && bz >= 2 && bz <= 5) return "industrial";
    if (Math.max(Math.abs(bx), Math.abs(bz)) >= 6) return "outskirts";
    return "residential";
  }

  // Unique landmarks: exactly one of each, at fixed blocks.
  const LANDMARKS = [
    { tpl: PERM.mall, bx: 0, bz: -6 },
    { tpl: PERM.hoa, bx: 1, bz: -5 },
    { tpl: PERM.church, bx: -2, bz: -5 },
    { tpl: PERM.office, bx: -1, bz: -6 },
    { tpl: PERM.grocery, bx: 2, bz: -4 },
    { tpl: PERM.gym, bx: -3, bz: -4 },
    { tpl: PERM.statue, bx: 0, bz: -4 },
    { tpl: PERM.waterTower, bx: -5, bz: 2 },
    { tpl: PERM.sewagePlant, bx: -4, bz: 3 },
  ];

  function buildCity() {
    for (const o of objects) if (o.g) scene.remove(o.g);
    activeObjs.clear();
    objects = [];
    grid.clear();
    permCount = 0;
    dynCount = 0;
    const rng = mulberry32(WORLD_SEED);
    const keepouts = [];

    function tryPlace(tpl, x, z, szMul, yaw) {
      // Never on a road; keep buildings off each other.
      if (onRoad(x, z)) return null;
      // Slightly tighter keepouts so blocks can pack fuller without overlapping.
      const need = tpl.s * (tpl.building ? 0.48 : 0.4);
      for (const k of keepouts) {
        const dx = x - k.x;
        const dz = z - k.z;
        const r = k.r + (tpl.s > 2.5 ? need : 0.25);
        if (dx * dx + dz * dz < r * r) return null;
      }
      const o = makeObj(tpl, x, z, szMul || 0.94 + rng() * 0.12, false, rng);
      if (typeof yaw === "number") o.yaw = yaw;
      addObj(o);
      if (tpl.s > 2.2) keepouts.push({ x, z, r: tpl.s * (tpl.building ? 0.5 : 0.42) });
      return o;
    }
    // Face the nearest road like a house should.
    function faceRoad(x, z) {
      const rx = nearestLine(x);
      const rz = nearestLine(z);
      if (Math.abs(x - rx) < Math.abs(z - rz)) {
        return x - rx > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      return z - rz > 0 ? Math.PI : 0;
    }
    function jitter(range) {
      return (rng() - 0.5) * 2 * range;
    }
    // Structured lot anchors so each block gets buildings in corners instead
    // of a handful of random pokes that leave big empty lawns.
    function lotSlots(cx, cz, n, spread) {
      const base = [
        [-1, -1], [1, -1], [-1, 1], [1, 1],
        [0, -1], [0, 1], [-1, 0], [1, 0],
        [0, 0],
      ];
      const out = [];
      for (let i = 0; i < Math.min(n, base.length); i++) {
        out.push({
          x: cx + base[i][0] * spread + jitter(spread * 0.22),
          z: cz + base[i][1] * spread + jitter(spread * 0.22),
        });
      }
      // Shuffle so which slots fill first varies by block.
      for (let i = out.length - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    }
    function fillFiller(cx, cz, lot, count, pool) {
      for (let i = 0; i < count; i++) {
        const tpl = pool[(rng() * pool.length) | 0];
        tryPlace(tpl, cx + jitter(lot), cz + jitter(lot));
      }
    }

    // --- Home block: fenced backyard + the family house ---
    addObj(Object.assign(makeObj(PERM.home, 0, -22, 1, false, rng), { yaw: Math.PI }));
    keepouts.push({ x: 0, z: -22, r: 6 });
    const fenceT = PERM.fence;
    // Segments every 1.0 m so pickets visually connect — no gaps hiding the wall.
    for (let x = YARD.x0; x <= YARD.x1; x += 1.0) {
      addObj(Object.assign(makeObj(fenceT, x, YARD.z0, 1, false, rng), { yaw: 0 }));
      addObj(Object.assign(makeObj(fenceT, x, YARD.z1, 1, false, rng), { yaw: 0 })); // sealed: no gate until you can EAT your way out
    }
    for (let z = YARD.z0 + 1.0; z <= YARD.z1 - 1; z += 1.0) {
      addObj(Object.assign(makeObj(fenceT, YARD.x0, z, 1, false, rng), { yaw: Math.PI / 2 }));
      addObj(Object.assign(makeObj(fenceT, YARD.x1, z, 1, false, rng), { yaw: Math.PI / 2 }));
    }
    tryPlace(PERM.grill, 12, -7, 1);
    tryPlace(PERM.doghouse, -12, -7, 1);
    tryPlace(PERM.sandbox, 10, 6, 1);
    tryPlace(PERM.gnome, -10, 6, 1);
    tryPlace(PERM.garden, 6, 4, 1);
    tryPlace(PERM.bush, -8, 3, 1);
    tryPlace(PERM.bush, 14, 2, 1);
    tryPlace(PERM.flamingo, -6, 8, 1);
    tryPlace(PERM.oak, 22, 14, 1);
    tryPlace(PERM.oak, -22, -16, 1);
    tryPlace(PERM.pine, 26, -8, 1);
    tryPlace(PERM.hedge, -18, 8, 1);
    tryPlace(PERM.hedge, 18, 8, 1);

    // --- Landmarks (unique) ---
    for (const L of LANDMARKS) {
      tryPlace(L.tpl, L.bx * BLOCK + jitter(6), L.bz * BLOCK + jitter(6), 1, rng() * Math.PI * 2);
    }

    // --- Every other block, by district ---
    const N = 7; // blocks -7..7
    for (let bx = -N; bx <= N; bx++) {
      for (let bz = -N; bz <= N; bz++) {
        const d = districtFor(bx, bz);
        if (d === "home") continue;
        const cx = bx * BLOCK;
        const cz = bz * BLOCK;
        const lot = 20; // usable half-extent inside the block

        if (d === "residential" || d === "outskirts") {
          const houses = d === "residential" ? 4 + ((rng() * 2) | 0) : 1 + ((rng() * 3) | 0);
          const slots = lotSlots(cx, cz, houses, 11);
          for (let i = 0; i < slots.length; i++) {
            const pool =
              rng() < 0.08 ? PERM.mcmansion
                : rng() < 0.18 ? PERM.duplex
                  : rng() < 0.35 ? PERM.garage
                    : rng() < 0.55 ? PERM.tinyHouse
                      : PERM.bungalow;
            const hx = slots[i].x;
            const hz = slots[i].z;
            tryPlace(pool, hx, hz, null, faceRoad(hx, hz));
          }
          const trees = d === "residential" ? 5 + ((rng() * 4) | 0) : 4 + ((rng() * 4) | 0);
          fillFiller(cx, cz, lot, trees, [PERM.oak, PERM.oak, PERM.pine, PERM.bush, PERM.bush]);
          // Street edge furniture so curbs aren't empty green strips.
          if (rng() < 0.85) tryPlace(PERM.mailbox, cx + jitter(lot * 0.6), cz + (rng() < 0.5 ? -1 : 1) * (lot + 2.5), 1);
          if (rng() < 0.55) tryPlace(PERM.hydrant, cx + (rng() < 0.5 ? -1 : 1) * (lot + 2.5), cz + jitter(lot * 0.6), 1);
          if (rng() < 0.45) tryPlace(PERM.lamp, cx + (rng() < 0.5 ? -1 : 1) * (lot + 2.2), cz + jitter(lot * 0.5), 1);
          if (rng() < 0.4) tryPlace(PERM.trashCan, cx + jitter(lot * 0.5), cz + (rng() < 0.5 ? -1 : 1) * (lot + 2.2), 1);
          if (rng() < 0.35) tryPlace(PERM.parkedCar, cx + jitter(lot - 6), cz + (rng() < 0.5 ? -1 : 1) * (lot + 1.5), null, faceRoad(cx, cz));
          if (d === "residential") {
            // Multiple yard props per block (was often one or none).
            const yardProps = 2 + ((rng() * 3) | 0);
            const yardPool = [
              PERM.trampoline, PERM.swing, PERM.pool, PERM.flamingo, PERM.gnome,
              PERM.cow, PERM.garden, PERM.bush, PERM.hedge, PERM.grill, PERM.doghouse,
            ];
            for (let i = 0; i < yardProps; i++) {
              tryPlace(yardPool[(rng() * yardPool.length) | 0], cx + jitter(lot - 3), cz + jitter(lot - 3));
            }
            if (rng() < 0.35) tryPlace(PERM.shed, cx + jitter(lot - 5), cz + jitter(lot - 5));
            if (rng() < 0.18) tryPlace(PERM.rv, cx + jitter(lot - 5), cz + jitter(lot - 5), null, faceRoad(cx, cz));
          } else {
            // Outskirts still get scattered props so they don't feel barren.
            fillFiller(cx, cz, lot, 2 + ((rng() * 3) | 0), [PERM.bush, PERM.pine, PERM.garden, PERM.shed, PERM.cow]);
            if (rng() < 0.25) tryPlace(PERM.rv, cx + jitter(lot - 5), cz + jitter(lot - 5), null, faceRoad(cx, cz));
          }
        } else if (d === "downtown") {
          const bigs = 2 + ((rng() * 2) | 0);
          const pool = [PERM.office, PERM.apartment, PERM.cornerStore, PERM.tacoPalace, PERM.gym, PERM.grocery, PERM.duplex];
          const slots = lotSlots(cx, cz, bigs, 10);
          for (let i = 0; i < slots.length; i++) {
            const tpl = pool[(rng() * pool.length) | 0];
            tryPlace(tpl, slots[i].x, slots[i].z, null, faceRoad(slots[i].x, slots[i].z));
          }
          if (rng() < 0.75) tryPlace(PERM.hydrant, cx + (lot + 2.5), cz + jitter(lot * 0.6), 1);
          if (rng() < 0.65) tryPlace(PERM.busStop, cx + jitter(lot * 0.5), cz - (lot + 2.5), 1, 0);
          if (rng() < 0.7) tryPlace(PERM.dumpster, cx + jitter(lot - 2), cz + jitter(lot - 2));
          if (rng() < 0.55) tryPlace(PERM.lamp, cx + (lot + 2.2), cz + jitter(lot * 0.5), 1);
          if (rng() < 0.5) tryPlace(PERM.bench, cx + jitter(lot - 4), cz + jitter(lot - 4));
          if (rng() < 0.45) tryPlace(PERM.parkedCar, cx + jitter(lot - 4), cz + (lot + 1.5), null, faceRoad(cx, cz));
          fillFiller(cx, cz, lot - 2, 2 + ((rng() * 2) | 0), [PERM.bush, PERM.trashCan, PERM.dumpster]);
        } else if (d === "commercial") {
          const shops = [PERM.cornerStore, PERM.tacoPalace, PERM.gasStation, PERM.grocery, PERM.gym];
          const nShops = 1 + (rng() < 0.65 ? 1 : 0);
          const slots = lotSlots(cx, cz, nShops, 9);
          for (let i = 0; i < slots.length; i++) {
            const tpl = shops[(rng() * shops.length) | 0];
            tryPlace(tpl, slots[i].x, slots[i].z, null, faceRoad(slots[i].x, slots[i].z));
          }
          if (rng() < 0.7) tryPlace(PERM.billboard, cx + jitter(lot), cz + jitter(lot), null, faceRoad(cx, cz));
          if (rng() < 0.75) tryPlace(PERM.busStop, cx + jitter(lot * 0.5), cz + (rng() < 0.5 ? -1 : 1) * (lot + 2.5), 1, 0);
          if (rng() < 0.7) tryPlace(PERM.dumpster, cx + jitter(lot - 2), cz + jitter(lot - 2));
          if (rng() < 0.55) tryPlace(PERM.hydrant, cx + jitter(lot), cz + jitter(lot), 1);
          if (rng() < 0.5) tryPlace(PERM.lamp, cx + (lot + 2.2), cz + jitter(lot * 0.5), 1);
          if (rng() < 0.55) tryPlace(PERM.parkedCar, cx + jitter(lot - 5), cz + jitter(lot - 5), null, faceRoad(cx, cz));
          if (rng() < 0.4) tryPlace(PERM.parkedCar, cx + jitter(lot - 5), cz + jitter(lot - 5), null, faceRoad(cx, cz));
          fillFiller(cx, cz, lot, 2, [PERM.bush, PERM.trashCan, PERM.bench]);
        } else if (d === "park") {
          // Dense tree cover + guaranteed amenities.
          const trees = 12 + ((rng() * 8) | 0);
          fillFiller(cx, cz, lot + 2, trees, [PERM.oak, PERM.oak, PERM.pine, PERM.bush, PERM.bush, PERM.hedge]);
          tryPlace(PERM.fountain, cx + jitter(4), cz + jitter(4));
          tryPlace(PERM.bench, cx + jitter(lot - 6), cz + jitter(lot - 6));
          if (rng() < 0.7) tryPlace(PERM.bench, cx + jitter(lot - 6), cz + jitter(lot - 6));
          if (rng() < 0.65) tryPlace(PERM.swing, cx + jitter(lot - 4), cz + jitter(lot - 4));
          if (rng() < 0.55) tryPlace(PERM.trampoline, cx + jitter(lot - 4), cz + jitter(lot - 4));
          if (rng() < 0.6) tryPlace(PERM.portaPotty, cx + (lot - 2), cz + (lot - 2), 1);
          if (rng() < 0.5) tryPlace(PERM.flamingo, cx + jitter(lot), cz + jitter(lot));
          if (rng() < 0.55) tryPlace(PERM.lamp, cx + jitter(lot), cz + jitter(lot));
          if (rng() < 0.4) tryPlace(PERM.statue, cx + jitter(8), cz + jitter(8));
          fillFiller(cx, cz, lot, 3, [PERM.garden, PERM.bush, PERM.gnome]);
        } else if (d === "industrial") {
          const slots = lotSlots(cx, cz, 2 + ((rng() * 2) | 0), 10);
          for (let i = 0; i < slots.length; i++) {
            const tpl = rng() < 0.45 ? PERM.warehouse : rng() < 0.7 ? PERM.shed : PERM.waterVat;
            tryPlace(tpl, slots[i].x, slots[i].z, null, faceRoad(slots[i].x, slots[i].z));
          }
          fillFiller(cx, cz, lot - 2, 3 + ((rng() * 3) | 0), [PERM.dumpster, PERM.dumpster, PERM.portaPotty, PERM.waterVat, PERM.pine]);
          if (rng() < 0.55) tryPlace(PERM.billboard, cx + jitter(lot), cz + jitter(lot), null, faceRoad(cx, cz));
          if (rng() < 0.45) tryPlace(PERM.parkedCar, cx + jitter(lot - 4), cz + jitter(lot - 4), null, faceRoad(cx, cz));
          if (rng() < 0.4) tryPlace(PERM.lamp, cx + (lot + 2.2), cz + jitter(lot * 0.5), 1);
        }
      }
    }

    // --- Street furniture along the grid (sidewalks) so long roads aren't empty ---
    for (let k = 0; k < CITY_LINES; k++) {
      const line = 30 + k * BLOCK;
      for (const sign of [1, -1]) {
        const axis = sign * line;
        // Lamps / hydrants / trash along NS roads (constant x)
        for (let z = -CITY_EDGE + 20; z <= CITY_EDGE - 20; z += 36 + ((rng() * 18) | 0)) {
          if (onRoad(axis + 6.2, z)) continue;
          const side = rng() < 0.5 ? 6.2 : -6.2;
          const roll = rng();
          if (roll < 0.4) tryPlace(PERM.lamp, axis + side, z + jitter(2), 1);
          else if (roll < 0.65) tryPlace(PERM.hydrant, axis + side, z + jitter(2), 1);
          else if (roll < 0.85) tryPlace(PERM.trashCan, axis + side, z + jitter(2), 1);
          else tryPlace(PERM.bush, axis + side * 1.1, z + jitter(3));
        }
        // Same along EW roads (constant z)
        for (let x = -CITY_EDGE + 20; x <= CITY_EDGE - 20; x += 36 + ((rng() * 18) | 0)) {
          if (onRoad(x, axis + 6.2)) continue;
          const side = rng() < 0.5 ? 6.2 : -6.2;
          const roll = rng();
          if (roll < 0.4) tryPlace(PERM.lamp, x + jitter(2), axis + side, 1);
          else if (roll < 0.65) tryPlace(PERM.mailbox, x + jitter(2), axis + side, 1);
          else if (roll < 0.85) tryPlace(PERM.bench, x + jitter(2), axis + side, 1);
          else tryPlace(PERM.hedge, x + jitter(3), axis + side * 1.1);
        }
      }
    }
  }

  // ---------- Dynamic spawner (there is ALWAYS something to eat) ----------
  function activationRadius() {
    return clamp(26 + baby.size * 13, 30, 330);
  }
  function spawnTargetCount() {
    // Small babies need MANY items: dynamics are the whole food supply until
    // the permanent city (fences, mailboxes, houses…) becomes edible. Density
    // requirements fall as reach grows, so the count tapers with size.
    // Bumped so lawns stay busy instead of sparse between buildings.
    return clamp(Math.round(420 - baby.size * 90), 160, 420);
  }
  // Food lives in a disc proportional to the BABY, not the camera — a 35 cm
  // baby needs crumbs every couple of meters, not scattered over 30 m.
  function spawnRadius() {
    return clamp(baby.size * 20 + 4, 9, activationRadius() * 0.95);
  }
  function trafficTarget() {
    return baby.size < 1.2 ? 0 : Math.round(clamp(3 + baby.size * 0.65, 3, 16));
  }
  function countTraffic() {
    let n = 0;
    for (const o of objects) if (o.dyn && o.driveAxis && !o.dead) n++;
    return n;
  }
  function yardSealed() {
    return baby.size < FENCE_FREE && baby.x > YARD.x0 && baby.x < YARD.x1 && baby.z > YARD.z0 && baby.z < YARD.z1;
  }
  function pickDynTpl(size) {
    const sMin = size * 0.035;
    const sMax = size * 2.4;
    const sealed = yardSealed();
    // Don't waste spawn budget on sidewalk/road items when no road is in
    // range (e.g. a tiny baby deep in the backyard).
    const spawnR = spawnRadius();
    const roadNear =
      distToLine(baby.x) < spawnR + 6 ||
      distToLine(baby.z) < spawnR + 6 ||
      Math.abs(baby.z - AVE_Z) < spawnR + 8;
    let total = 0;
    const pool = [];
    for (const t of DYN_TPLS) {
      if (t.s < sMin || t.s > sMax) continue;
      if ((sealed || !roadNear) && (t.surface === "road" || t.surface === "walk")) continue;
      // Prefer things in the eatable band.
      const w = t.w * (t.s <= size * EAT_RATIO ? 1.5 : 0.6);
      pool.push([t, w]);
      total += w;
    }
    if (!pool.length) return DYN_TPLS[0];
    let roll = Math.random() * total;
    for (const [t, w] of pool) {
      roll -= w;
      if (roll <= 0) return t;
    }
    return pool[pool.length - 1][0];
  }
  function surfaceOk(tpl, x, z) {
    if (Math.abs(x) > CITY_BOUND - 4 || Math.abs(z) > CITY_BOUND - 4) return false;
    if (tpl.surface === "road") return onRoad(x, z);
    if (tpl.surface === "walk") return onSidewalk(x, z);
    return !onRoad(x, z); // grass (sidewalk is fine too — toys get dropped everywhere)
  }
  function blockedByPermanent(tpl, x, z) {
    let blocked = false;
    forNear(x, z, 16, (o) => {
      if (blocked || o.dyn || o.dead) return;
      const minD = o.s * 0.45 + tpl.s * 0.4;
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < minD * minD) blocked = true;
    });
    return blocked;
  }
  function spawnOne(anywhere, forceTpl) {
    const tpl = forceTpl || pickDynTpl(baby.size);
    const actR = activationRadius();
    const spawnR = spawnRadius();
    for (let tries = 0; tries < 8; tries++) {
      let x;
      let z;
      if (tpl.drives) {
        // Traffic spawns ON a road lane near the baby (inside the activation
        // window so it's simulated) and drives along it.
        const trafficR = Math.min(actR * 0.9, Math.max(spawnR * 2.2, 60));
        const alongX = Math.random() < 0.5;
        const line = nearestLine(alongX ? baby.z + (Math.random() - 0.5) * trafficR * 2 : baby.x + (Math.random() - 0.5) * trafficR * 2);
        if (Math.abs(line) > CITY_EDGE) continue;
        const off = (Math.random() - 0.5) * trafficR * 1.8;
        if (alongX) {
          x = clamp(baby.x + off, -CITY_EDGE, CITY_EDGE);
          z = line + (Math.random() < 0.5 ? -2 : 2);
        } else {
          x = line + (Math.random() < 0.5 ? -2 : 2);
          z = clamp(baby.z + off, -CITY_EDGE, CITY_EDGE);
        }
        const dd = Math.hypot(x - baby.x, z - baby.z);
        if (dd > trafficR) continue;
        if (!anywhere && dd < trafficR * 0.3) continue; // not right on top of the player
        if (blockedByPermanent(tpl, x, z)) continue;
        const o = addObj(makeObj(tpl, x, z, 0.94 + Math.random() * 0.12, true));
        o.driveAxis = alongX ? "x" : "z";
        const dir = Math.random() < 0.5 ? 1 : -1;
        o.mvx = alongX ? tpl.spd * dir : 0;
        o.mvz = alongX ? 0 : tpl.spd * dir;
        o.yaw = Math.atan2(o.mvx, o.mvz);
        return o;
      }
      // Everything else: a baby-scaled annulus. While the baby is moving,
      // bias spawns into a forward wedge along its heading so the direction
      // of travel is always seeded ("aim the hose where the baby is going").
      const moving = Math.hypot(baby.vx, baby.vz) > 0.4;
      const a = !anywhere && moving && tries < 6
        ? baby.heading + (Math.random() - 0.5) * (Math.PI / 1.4)
        : Math.random() * Math.PI * 2;
      // sqrt() keeps the spread area-uniform; the 0.15 floor means the disc
      // right around an idle baby refills too instead of going permanently bare.
      const r = anywhere ? Math.sqrt(Math.random()) * spawnR : lerp(spawnR * 0.15, spawnR * 0.95, Math.sqrt(Math.random()));
      x = baby.x + Math.cos(a) * r;
      z = baby.z + Math.sin(a) * r;
      // Never inside the mouth: spawning within eat reach hands out free noms.
      if (Math.hypot(x - baby.x, z - baby.z) < baby.size * 0.6 + tpl.s) continue;
      // While the yard is sealed, every snack must land INSIDE the fence.
      if (yardSealed() && (x < YARD.x0 + 0.6 || x > YARD.x1 - 0.6 || z < YARD.z0 + 0.6 || z > YARD.z1 - 0.6)) continue;
      if (!anywhere && tries < 5 && tpl.s > r * 0.02) {
        // Things big enough to SEE popping in prefer to spawn outside the
        // camera's forward wedge. Crumb-sized stuff is subpixel at spawn
        // distance and may appear anywhere — this keeps the direction of
        // travel fed instead of starving it.
        const toward = Math.atan2(x - baby.x, z - baby.z);
        const camFwd = Math.atan2(baby.x - camera.position.x, baby.z - camera.position.z);
        let dAng = toward - camFwd;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        if (Math.abs(dAng) < 1.1) continue;
      }
      if (!surfaceOk(tpl, x, z)) continue;
      if (blockedByPermanent(tpl, x, z)) continue;
      return addObj(makeObj(tpl, x, z, 0.9 + Math.random() * 0.2, true));
    }
    return null;
  }
  function spawnTick(initial) {
    const target = spawnTargetCount();
    let budget = initial ? target : 22;
    while (dynCount < target && budget > 0) {
      spawnOne(initial);
      budget--;
    }
    // Traffic gets its own budget so the streets stay alive regardless of
    // how much snack clutter is on the lawns.
    const wantCars = trafficTarget();
    if (wantCars > 0) {
      const drivePool = DYN_TPLS.filter((t) => t.drives && t.s >= baby.size * 0.035 && t.s <= baby.size * 2.4);
      if (drivePool.length) {
        let cars = countTraffic();
        let carBudget = initial ? wantCars : 3;
        while (cars < wantCars && carBudget > 0) {
          if (spawnOne(initial, drivePool[(Math.random() * drivePool.length) | 0])) cars++;
          carBudget--;
        }
      }
    }
  }
  function despawnSweep() {
    const actR = activationRadius();
    // Generous keep radius: front-biased spawning feeds the corridor ahead,
    // so trailing items can linger instead of being churned through the
    // spawn budget.
    const keepFood = Math.max(spawnRadius() * 2.5, 30);
    const keepCar = actR * 1.5;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (!o.dyn) continue;
      if (o.dead) {
        removeObj(o);
        continue;
      }
      const dx = o.x - baby.x;
      const dz = o.z - baby.z;
      const keep = o.driveAxis ? keepCar : keepFood;
      if (dx * dx + dz * dz > keep * keep) removeObj(o);
      else if (o.driveAxis && (Math.abs(o.x) > CITY_EDGE + 6 || Math.abs(o.z) > CITY_EDGE + 6)) removeObj(o);
    }
  }

  // ---------- Hunters (they want the baby smaller) ----------
  // Overlapping size bands create mixed packs. Every active hunter is still
  // too big to eat; crossing its max band turns it into a revenge snack.
  function bAngryDog() {
    const g = new T.Group();
    g.name = "bbb_enemy_guard_dog_v2";
    const fur = mat(0x4a3826);
    g.add(mesh(GEO.sphLo, fur, 0.5, 0.42, 0.66, 0, 0.45, 0));
    g.add(mesh(GEO.sphLo, fur, 0.3, 0.28, 0.3, 0, 0.62, 0.6));
    g.add(mesh(GEO.box, fur, 0.16, 0.13, 0.22, 0, 0.55, 0.85));
    g.add(mesh(GEO.cone, fur, 0.09, 0.2, 0.09, -0.15, 0.86, 0.55));
    g.add(mesh(GEO.cone, fur, 0.09, 0.2, 0.09, 0.15, 0.86, 0.55));
    const eye = mat(0xd93f3f);
    g.add(mesh(GEO.sphLo, eye, 0.045, 0.045, 0.045, -0.11, 0.7, 0.83));
    g.add(mesh(GEO.sphLo, eye, 0.045, 0.045, 0.045, 0.11, 0.7, 0.83));
    const collar = mesh(GEO.torus, mat(0xd93f3f), 0.2, 0.2, 0.2, 0, 0.58, 0.42);
    collar.rotation.x = Math.PI / 2 - 0.4;
    g.add(collar);
    for (const lp of [[-0.3, 0.35], [0.3, 0.35], [-0.3, -0.35], [0.3, -0.35]]) {
      g.add(mesh(GEO.cyl, fur, 0.09, 0.4, 0.09, lp[0], 0.2, lp[1]));
    }
    const tail = mesh(GEO.cone, fur, 0.08, 0.34, 0.08, 0, 0.68, -0.7);
    tail.rotation.x = -0.7;
    g.add(tail);
    return g;
  }
  function bAngryAdult() {
    const g = new T.Group();
    g.name = "bbb_enemy_angry_dad_v2";
    const pants = mat(0x3a4a6b);
    const shirt = mat(0xd93f3f);
    g.add(mesh(GEO.cyl, pants, 0.1, 0.36, 0.1, -0.1, 0.18, 0));
    g.add(mesh(GEO.cyl, pants, 0.1, 0.36, 0.1, 0.1, 0.18, 0));
    g.add(mesh(GEO.cyl, shirt, 0.3, 0.56, 0.3, 0, 0.62, 0));
    const a1 = mesh(GEO.cyl, shirt, 0.07, 0.44, 0.07, -0.34, 0.92, 0);
    a1.rotation.z = 2.5;
    const a2 = mesh(GEO.cyl, shirt, 0.07, 0.44, 0.07, 0.34, 0.92, 0);
    a2.rotation.z = -2.5;
    g.add(a1, a2);
    g.add(mesh(GEO.sphLo, mat(0xffd9b8), 0.09, 0.09, 0.09, -0.5, 1.08, 0));
    g.add(mesh(GEO.sphLo, mat(0xffd9b8), 0.09, 0.09, 0.09, 0.5, 1.08, 0));
    g.add(mesh(GEO.sphLo, mat(0xffd9b8), 0.22, 0.24, 0.22, 0, 1.08, 0));
    const brow = mat(0x5b3b22);
    g.add(mesh(GEO.box, brow, 0.1, 0.03, 0.02, -0.08, 1.16, 0.2));
    g.add(mesh(GEO.box, brow, 0.1, 0.03, 0.02, 0.08, 1.16, 0.2));
    return g;
  }
  function bPolice() {
    const g = bCar(0xf2f2f2, 1)();
    g.name = "bbb_enemy_police_cruiser_v2";
    g.add(mesh(GEO.box, mat(0x22242c), 0.47, 0.1, 0.34, 0, 0.2, 0.02));
    const bar = mesh(GEO.box, mat(0x30364a), 0.3, 0.05, 0.1, 0, 0.56, -0.05);
    g.add(bar);
    const rl = mesh(GEO.box, new T.MeshBasicMaterial({ color: 0xff3b3b }), 0.12, 0.07, 0.09, -0.08, 0.62, -0.05);
    const bl = mesh(GEO.box, new T.MeshBasicMaterial({ color: 0x3b8cff }), 0.12, 0.07, 0.09, 0.08, 0.62, -0.05);
    g.add(rl, bl);
    g.userData.lights = [rl, bl];
    return g;
  }
  function bTank() {
    const g = new T.Group();
    g.name = "bbb_enemy_hoa_tank_v2";
    const olive = mat(0x5a6b3a);
    const dark = mat(0x2c3226);
    g.add(mesh(GEO.box, olive, 0.56, 0.2, 0.9, 0, 0.28, 0));
    g.add(mesh(GEO.box, dark, 0.16, 0.18, 1.0, -0.34, 0.12, 0));
    g.add(mesh(GEO.box, dark, 0.16, 0.18, 1.0, 0.34, 0.12, 0));
    const turret = new T.Group();
    turret.position.set(0, 0.46, -0.05);
    turret.add(mesh(GEO.cyl, olive, 0.2, 0.14, 0.2, 0, 0, 0));
    const barrel = mesh(GEO.cyl, dark, 0.045, 0.62, 0.045, 0, 0.02, 0.36);
    barrel.rotation.x = Math.PI / 2;
    turret.add(barrel);
    g.add(turret);
    g.userData.turret = turret;
    return g;
  }
  function bAngryGoose() {
    const g = new T.Group();
    g.name = "bbb_enemy_territorial_goose_v1";
    const feather = mat(0xf3f1e8, { roughness: 0.92 });
    const wing = mat(0xc9c8c2, { roughness: 0.94 });
    const orange = mat(0xf28c28, { roughness: 0.8 });
    g.add(mesh(GEO.sphLo, feather, 0.42, 0.34, 0.58, 0, 0.48, -0.08));
    const neck = mesh(GEO.cyl, feather, 0.11, 0.62, 0.11, 0, 0.82, 0.3);
    neck.rotation.x = -0.2;
    g.add(neck);
    g.add(mesh(GEO.sphLo, feather, 0.22, 0.2, 0.22, 0, 1.12, 0.42));
    const beak = mesh(GEO.cone, orange, 0.1, 0.3, 0.1, 0, 1.08, 0.67);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
    g.add(
      instanced(
        GEO.dodec,
        wing,
        [-1, 1].map((side) => ({ p: [side * 0.36, 0.52, -0.08], r: [0, 0, side * 0.22], s: [0.15, 0.28, 0.46] })),
        "goose_wings"
      )
    );
    g.add(
      instanced(
        GEO.cyl,
        orange,
        [-1, 1].map((side) => ({ p: [side * 0.14, 0.16, 0], s: [0.035, 0.32, 0.035] })),
        "goose_legs"
      )
    );
    const angryEye = mat(0xc62828, { emissive: 0x3a0505, emissiveIntensity: 0.3 });
    g.add(mesh(GEO.sphLo, angryEye, 0.035, 0.035, 0.035, -0.11, 1.15, 0.6));
    g.add(mesh(GEO.sphLo, angryEye, 0.035, 0.035, 0.035, 0.11, 1.15, 0.6));
    return g;
  }
  function bBabysitter() {
    const g = bAngryAdult();
    g.name = "bbb_enemy_furious_babysitter_v1";
    const apron = mat(0xffd15c, { roughness: 0.86 });
    g.add(mesh(GEO.box, apron, 0.46, 0.52, 0.08, 0, 0.64, 0.29));
    g.add(mesh(GEO.box, mat(0xeff8ff, { roughness: 0.72 }), 0.15, 0.3, 0.12, 0.48, 0.84, 0.18));
    g.add(mesh(GEO.cone, mat(0xff7eb6, { roughness: 0.72 }), 0.09, 0.13, 0.09, 0.48, 1.03, 0.18));
    g.add(mesh(GEO.box, mat(0x32384a, { roughness: 0.74 }), 0.34, 0.42, 0.05, -0.47, 0.85, 0.16));
    return g;
  }
  function bRunawayMower() {
    const g = new T.Group();
    g.name = "bbb_enemy_runaway_mower_v1";
    const deck = mat(0xd94a3d, { roughness: 0.56, metalness: 0.12 });
    const engine = mat(0x30343c, { roughness: 0.5, metalness: 0.28 });
    g.add(mesh(GEO.box, deck, 0.72, 0.18, 0.86, 0, 0.2, 0.1));
    g.add(mesh(GEO.cyl, engine, 0.28, 0.3, 0.28, 0, 0.38, 0.05));
    g.add(
      instanced(
        GEO.cyl,
        mat(0x1d2026, { roughness: 0.96 }),
        [-1, 1].flatMap((side) => [-0.24, 0.36].map((z) => ({ p: [side * 0.42, 0.16, z], r: [0, 0, Math.PI / 2], s: [0.16, 0.1, 0.16] }))),
        "mower_wheels"
      )
    );
    const handle = mesh(GEO.torusThin, mat(0x555d68, { roughness: 0.48, metalness: 0.35 }), 0.56, 0.74, 0.36, 0, 0.75, -0.42);
    handle.rotation.x = -0.45;
    g.add(handle);
    const eye = mat(0xff3d3d, { emissive: 0x6e0909, emissiveIntensity: 0.8 });
    g.add(mesh(GEO.sphLo, eye, 0.06, 0.05, 0.04, -0.19, 0.34, 0.55));
    g.add(mesh(GEO.sphLo, eye, 0.06, 0.05, 0.04, 0.19, 0.34, 0.55));
    return g;
  }
  function bDiaperDrone() {
    const g = new T.Group();
    g.name = "bbb_enemy_diaper_drone_v1";
    const shell = mat(0xe8edf5, { roughness: 0.38, metalness: 0.24 });
    const dark = mat(0x30364a, { roughness: 0.5, metalness: 0.34 });
    g.add(mesh(GEO.dodec, shell, 0.38, 0.22, 0.38, 0, 0.72, 0));
    g.add(
      instanced(
        GEO.box,
        dark,
        [Math.PI / 4, -Math.PI / 4].map((ry) => ({ p: [0, 0.72, 0], r: [0, ry, 0], s: [1.2, 0.07, 0.09] })),
        "drone_arms"
      )
    );
    const rotorPoints = [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]];
    g.add(
      instanced(
        GEO.cyl,
        dark,
        rotorPoints.map(([x, z]) => ({ p: [x, 0.78, z], s: [0.25, 0.035, 0.25] })),
        "drone_rotors"
      )
    );
    g.add(mesh(GEO.sphLo, mat(0xff3d3d, { emissive: 0x7a0808, emissiveIntensity: 1 }), 0.08, 0.07, 0.05, 0, 0.7, 0.38));
    g.add(mesh(GEO.box, mat(0xbfdff1, { roughness: 0.82 }), 0.5, 0.18, 0.4, 0, 0.48, -0.02));
    return g;
  }
  function bDemolitionDozer() {
    const g = new T.Group();
    g.name = "bbb_enemy_demolition_dozer_v1";
    const yellow = mat(0xe7a928, { roughness: 0.5, metalness: 0.16 });
    const track = mat(0x282b2f, { roughness: 0.9, metalness: 0.18 });
    g.add(mesh(GEO.box, yellow, 0.72, 0.4, 0.9, 0, 0.45, -0.08));
    g.add(mesh(GEO.box, mat(0x94cde4, { roughness: 0.22, metalness: 0.1 }), 0.58, 0.34, 0.42, 0, 0.78, -0.18));
    g.add(
      instanced(
        GEO.box,
        track,
        [-1, 1].map((side) => ({ p: [side * 0.48, 0.22, 0], s: [0.22, 0.34, 1.08] })),
        "dozer_tracks"
      )
    );
    const blade = mesh(GEO.box, yellow, 1.2, 0.5, 0.12, 0, 0.34, 0.62);
    blade.rotation.x = -0.18;
    g.add(blade);
    g.add(mesh(GEO.cyl, track, 0.06, 0.52, 0.06, -0.36, 0.38, 0.34));
    g.add(mesh(GEO.cyl, track, 0.06, 0.52, 0.06, 0.36, 0.38, 0.34));
    const beacon = mesh(GEO.cyl, mat(0xff7d2d, { emissive: 0x5a1900, emissiveIntensity: 0.75 }), 0.08, 0.12, 0.08, 0, 1.02, -0.2);
    g.add(beacon);
    return g;
  }
  const ENEMY_TPLS = [
    { key: "dog", e: "🐕‍🦺", n: "Guard Dog (Radicalized)", s: 2.6, min: FENCE_FREE, max: 3.75, count: 1, spd: 3.8, aggro: 18, sfx: "bark", build: bAngryDog, hits: ["BAD DOG!", "THE DOG OBJECTS", "MAILMAN'S REVENGE"] },
    { key: "goose", e: "🪿", n: "Territorial Goose (No Crumbs)", s: 2.2, min: FENCE_FREE, max: 3.2, count: 1, spd: 4.8, aggro: 19, sfx: "bark", build: bAngryGoose, hits: ["HONKED!", "GOOSE CHOSE VIOLENCE", "NO CRUMBS FOR YOU"] },
    { key: "adult", e: "🧔", n: "Angry Dad (You Ate The Grill)", s: 3.4, min: 2.4, max: 4.9, count: 1, spd: 4.8, aggro: 22, sfx: "bark", build: bAngryAdult, hits: ["GROUNDED!", "NO DESSERT!", "1-STAR PARENTING"] },
    { key: "babysitter", e: "🍼", n: "Furious Babysitter (Overtime)", s: 4.2, min: 2.8, max: 6.1, count: 1, spd: 5.6, aggro: 24, sfx: "bark", build: bBabysitter, hits: ["TIME OUT!", "NAP ENFORCED!", "THAT IS NOT A SNACK"] },
    { key: "mower", e: "🏎️", n: "Runaway Lawn Mower", s: 5.5, min: 3.8, max: 7.9, count: 1, spd: 7.2, aggro: 28, sfx: "boom", build: bRunawayMower, hits: ["MOWED!", "GRASS REVENGE", "WATCH THE CLIPPINGS"] },
    { key: "police", e: "🚓", n: "Police Cruiser (Baby Division)", s: 6, min: 4.5, max: 8.6, count: 1, spd: 7.4, aggro: 31, sfx: "siren", build: bPolice, hits: ["CITED!", "RESISTING A NAP", "BABY, PULL OVER"] },
    { key: "drone", e: "🚁", n: "Diaper Drone (Air Support)", s: 8.5, min: 6.2, max: 12.2, count: 1, spd: 9.5, aggro: 40, sfx: "siren", build: bDiaperDrone, shells: true, shellSpd: 13, shellScale: 0.34, fireEvery: 1.8, fireRange: 46, holdRange: 23, hits: ["AIR TAGGED!", "DIAPER DRONE STRIKE", "NAP FROM ABOVE"] },
    { key: "tank", e: "🪖", n: "HOA Tank (Final Notice)", s: 9, min: 9, max: 13, count: 1, spd: 7.5, aggro: 42, sfx: "boom", build: bTank, shells: true, shellSpd: 10, shellScale: 0.5, fireEvery: 2.5, fireRange: 44, holdRange: 20, hits: ["SHELLED!", "ARTICLE 7 VIOLATION", "LAWN ENFORCEMENT"] },
    { key: "dozer", e: "🚜", n: "Demolition Dozer (Bedtime Crew)", s: 22, min: 13, max: 1e9, count: 2, spd: 10.5, aggro: 55, sfx: "boom", build: bDemolitionDozer, hits: ["BULLDOZED!", "PERMIT DENIED", "BEDTIME MEANS BEDTIME"] },
  ];
  const ENEMY_MAX_ACTIVE = 4;
  let enemies = [];
  let shells = [];
  let gasClouds = [];
  let enemySpawnCursor = 0;
  let enemyHitsTaken = 0;
  let enemyShotsFired = 0;
  const enemyAnnounced = new Set();

  function activeEnemyTpls() {
    if (yardSealed()) return []; // the yard is a safe nursery
    return ENEMY_TPLS.filter((t) => baby.size >= t.min && baby.size < t.max);
  }
  function spawnEnemy(tpl, nearDist) {
    const actR = activationRadius();
    const spawnNear = Math.max(tpl.s * 1.45 + 3, Math.min(actR * 0.28, tpl.aggro * 0.62));
    const spawnFar = Math.max(spawnNear + 3, Math.min(actR * 0.62, tpl.aggro * 0.92));
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = typeof nearDist === "number" ? nearDist : lerp(spawnNear, spawnFar, Math.random());
      const x = clamp(baby.x + Math.cos(a) * d, -CITY_BOUND + 10, CITY_BOUND - 10);
      const z = clamp(baby.z + Math.sin(a) * d, -CITY_BOUND + 10, CITY_BOUND - 10);
      if (x > YARD.x0 - 3 && x < YARD.x1 + 3 && z > YARD.z0 - 3 && z < YARD.z1 + 3) continue;
      if (blockedByPermanent(tpl, x, z)) continue;
      const g = tpl.build();
      g.scale.setScalar(tpl.s);
      g.position.set(x, 0, z);
      scene.add(g);
      const e = {
        tpl, x, z, s: tpl.s, g,
        mvx: 0, mvz: 0, state: "patrol", stun: 0, reCd: 0, fireCd: Math.min(1.5, tpl.fireEvery || 2),
        wanderT: 0, retireT: 6, gassedShown: false, sirenT: 0,
        lights: g.userData.lights || null, turret: g.userData.turret || null,
      };
      enemies.push(e);
      if (!enemyAnnounced.has(tpl.key)) {
        enemyAnnounced.add(tpl.key);
        showBanner(tpl.e, "INCOMING", tpl.n.toUpperCase());
        if (tpl.sfx === "siren") AudioKit.siren();
        else if (tpl.sfx === "boom") AudioKit.boom(0.8);
        else AudioKit.bark();
      }
      return e;
    }
    return null;
  }
  function enemyTick() {
    if (phase !== "play") return;
    const roster = activeEnemyTpls();
    const allowed = new Set(roster.map((tpl) => tpl.key));
    for (const e of enemies) if (!allowed.has(e.tpl.key) && e.state !== "retire") e.state = "retire";
    const active = enemies.filter((e) => e.state !== "retire");
    if (!roster.length || active.length >= ENEMY_MAX_ACTIVE) return;
    const start = enemySpawnCursor % roster.length;
    for (let offset = 0; offset < roster.length; offset++) {
      const tpl = roster[(start + offset) % roster.length];
      const have = active.filter((e) => e.tpl === tpl).length;
      if (have >= tpl.count) continue;
      if (spawnEnemy(tpl)) {
        enemySpawnCursor = (start + offset + 1) % roster.length;
        break; // one clear INCOMING banner per replenishment tick
      }
    }
  }
  function removeEnemy(i, keepMesh) {
    const e = enemies[i];
    if (!keepMesh && e.g) scene.remove(e.g);
    enemies.splice(i, 1);
  }
  function hitBaby(srcX, srcZ, tpl) {
    hitImmune = 2.0;
    enemyHitsTaken++;
    const old = baby.size;
    baby.size = Math.max(START_SIZE * 0.8, baby.size * 0.96);
    const dx = baby.x - srcX;
    const dz = baby.z - srcZ;
    const d = Math.hypot(dx, dz) || 1;
    const kb = (1.5 + baby.size * 1.05) * 1.6;
    baby.vx += (dx / d) * kb;
    baby.vz += (dz / d) * kb;
    shake = 0.7;
    AudioKit.bonk();
    if (tpl.sfx === "bark") AudioKit.bark();
    hitFlash.classList.add("is-on");
    setTimeout(() => hitFlash.classList.remove("is-on"), 600);
    addFloater(baby.x, baby.size * 1.1, baby.z, tpl.hits[(Math.random() * tpl.hits.length) | 0], "#ff6b6b", true);
    addFloater(baby.x, baby.size * 0.7, baby.z, `-${fmtSize(old - baby.size)} of baby`, "#ff6b6b", false);
    setLog(`${tpl.n} got you. Fart gas is a legal defense.`);
    refreshMenuList();
  }
  function fireShell(e) {
    const dx = baby.x - e.x;
    const dz = baby.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    const spd = e.tpl.shellSpd || 8;
    const lead = dist / spd * 0.7;
    const tx = baby.x + baby.vx * lead;
    const tz = baby.z + baby.vz * lead;
    const ddx = tx - e.x;
    const ddz = tz - e.z;
    const dd = Math.hypot(ddx, ddz) || 1;
    const m = new T.Mesh(GEO.sphLo, shellMat);
    m.name = `bbb_enemy_projectile_${e.tpl.key}`;
    m.scale.setScalar(e.tpl.shellScale || 0.5);
    scene.add(m);
    shells.push({ x: e.x, z: e.z, vx: (ddx / dd) * spd, vz: (ddz / dd) * spd, t: 0, ft: dd / spd, m, tpl: e.tpl });
    enemyShotsFired++;
    AudioKit.boom(0.55);
    spawnBurst(poolM, e.x, e.s * 0.6, e.z, 4, 0x9aa2b5, 0.8, 0.6);
  }
  function updateShells(dt) {
    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i];
      sh.t += dt;
      sh.x += sh.vx * dt;
      sh.z += sh.vz * dt;
      const k = sh.t / sh.ft;
      sh.m.position.set(sh.x, Math.max(0.3, 3 * 4 * k * (1 - k)), sh.z);
      if (k >= 1) {
        spawnBurst(poolL, sh.x, 0.5, sh.z, 12, 0xff8c42, 2.2, 1.4);
        AudioKit.boom(1);
        if (hitImmune <= 0 && Math.hypot(baby.x - sh.x, baby.z - sh.z) < baby.size * 0.5 + 2.4) {
          hitBaby(sh.x, sh.z, sh.tpl);
        }
        scene.remove(sh.m);
        shells.splice(i, 1);
      }
    }
  }
  function updateGas(dt) {
    if (gasEmitT > 0) {
      gasEmitT -= dt;
      gasPuffT -= dt;
      if (gasPuffT <= 0) {
        gasPuffT = 0.13;
        const gx = baby.x - Math.sin(baby.heading) * baby.size * 0.45;
        const gz = baby.z - Math.cos(baby.heading) * baby.size * 0.45;
        const r = baby.size * 0.55 + 0.5;
        const m = new T.Mesh(GEO.sphLo, gasMat);
        m.scale.setScalar(0.1);
        m.position.set(gx, r * 0.45, gz);
        scene.add(m);
        gasClouds.push({ x: gx, z: gz, r, t: 0, life: 4.5, m });
        if (gasClouds.length > 16) {
          scene.remove(gasClouds[0].m);
          gasClouds.shift();
        }
      }
    }
    for (let i = gasClouds.length - 1; i >= 0; i--) {
      const c = gasClouds[i];
      c.t += dt;
      if (c.t >= c.life) {
        scene.remove(c.m);
        gasClouds.splice(i, 1);
        continue;
      }
      const k = c.t < 0.35 ? c.t / 0.35 : Math.max(0.12, 1 - Math.max(0, c.t - 3.2) / 1.3);
      c.m.scale.setScalar(c.r * k);
      c.m.position.y = c.r * 0.42 + c.t * 0.12;
    }
  }
  function updateEnemies(dt, now) {
    const thr = eatThreshold();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dx = baby.x - e.x;
      const dz = baby.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      // Fart gas: pursuers that touch a cloud are stunned dizzy.
      if (e.stun <= 0) {
        for (const c of gasClouds) {
          if (Math.hypot(e.x - c.x, e.z - c.z) < c.r + e.s * 0.35) {
            e.stun = 5;
            if (!e.gassedShown) {
              e.gassedShown = true;
              addFloater(e.x, e.s, e.z, "GASSED!", "#8fdc4f", true);
            }
            AudioKit.gassed();
            break;
          }
        }
      }
      if (e.stun > 0) {
        e.stun -= dt;
        e.mvx = 0;
        e.mvz = 0;
        if (e.g) {
          e.g.rotation.y += dt * 5; // dizzy spin
          e.g.position.set(e.x, Math.abs(Math.sin(now * 0.02)) * e.s * 0.04, e.z);
        }
        continue;
      }
      if (e.state === "retire") {
        e.mvx = (-dx / d) * e.tpl.spd * 0.6;
        e.mvz = (-dz / d) * e.tpl.spd * 0.6;
        e.retireT -= dt;
        if (d > 70 || e.retireT <= 0) {
          removeEnemy(i);
          continue;
        }
      } else {
        e.reCd = Math.max(0, (e.reCd || 0) - dt);
        if (e.state !== "chase" && d < e.tpl.aggro && e.reCd <= 0) {
          e.state = "chase";
          if (e.tpl.sfx === "bark") AudioKit.bark();
        } else if (e.state === "chase" && d > e.tpl.aggro * 2.2) {
          e.state = "patrol";
          e.reCd = 8; // give the baby real downtime after a getaway
          addFloater(e.x, e.s, e.z, "LOST IT", "#b6b3c9", false);
        }
        if (e.state === "chase") {
          const hold = e.tpl.shells && d < (e.tpl.holdRange || 18); // ranged hunters bombard from outside bite range
          e.mvx = hold ? 0 : (dx / d) * e.tpl.spd;
          e.mvz = hold ? 0 : (dz / d) * e.tpl.spd;
          if (e.tpl.sfx === "siren") {
            e.sirenT -= dt;
            if (e.sirenT <= 0 && d < 45) {
              e.sirenT = 1.2;
              AudioKit.siren();
            }
          }
          if (e.tpl.shells) {
            e.fireCd -= dt;
            if (e.fireCd <= 0 && d < (e.tpl.fireRange || 38)) {
              e.fireCd = e.tpl.fireEvery || 2.6;
              fireShell(e);
            }
          }
        } else {
          e.wanderT -= dt;
          if (e.wanderT <= 0) {
            e.wanderT = 1 + Math.random() * 2.5;
            const a = Math.random() * Math.PI * 2;
            const go = Math.random() < 0.7 ? 1 : 0;
            e.mvx = Math.cos(a) * e.tpl.spd * 0.35 * go;
            e.mvz = Math.sin(a) * e.tpl.spd * 0.35 * go;
          }
        }
      }
      e.x += e.mvx * dt;
      e.z += e.mvz * dt;
      e.x = clamp(e.x, -CITY_BOUND + 8, CITY_BOUND - 8);
      e.z = clamp(e.z, -CITY_BOUND + 8, CITY_BOUND - 8);
      // Don't ghost through buildings.
      forNear(e.x, e.z, e.s + 10, (o) => {
        if (o.dyn || o.dead || o.s < 3) return;
        const ex = e.x - o.x;
        const ez = e.z - o.z;
        const minD = e.s * 0.3 + o.s * 0.33;
        const dd = Math.hypot(ex, ez);
        if (dd > 0.001 && dd < minD) {
          e.x = o.x + (ex / dd) * minD;
          e.z = o.z + (ez / dd) * minD;
        }
      });
      // Contact: eat it if you finally can, otherwise it bites.
      const contactR = e.s * 0.38 + baby.size * 0.4;
      if (d < contactR) {
        if (e.s <= thr) {
          const pseudo = { id: -3, tpl: { e: e.tpl.e, n: e.tpl.n }, s: e.s, x: e.x, z: e.z, dead: false, dyn: true, g: e.g, stink: null, cell: undefined };
          removeEnemy(i, true); // eat() tweens the mesh into the mouth
          eat(pseudo);
          score += Math.round(e.s * e.s * 12); // revenge bonus
          addFloater(baby.x, baby.size * 1.2, baby.z, "REVENGE!", "#ffd43b", true);
          continue;
        }
        if (hitImmune <= 0) hitBaby(e.x, e.z, e.tpl);
      }
      // Mesh sync.
      if (e.g) {
        e.g.position.set(e.x, 0, e.z);
        if (Math.abs(e.mvx) + Math.abs(e.mvz) > 0.01) e.g.rotation.y = Math.atan2(e.mvx, e.mvz);
        if (e.lights) {
          const on = Math.floor(now / 220) % 2 === 0;
          e.lights[0].visible = on;
          e.lights[1].visible = !on;
        }
        if (e.turret) e.turret.rotation.y = Math.atan2(dx, dz) - e.g.rotation.y;
      }
    }
  }

  // ---------- Object activation (build/tear down 3D groups near the baby) ----------
  function buildObjGroup(o) {
    const g = o.tpl.build();
    g.scale.setScalar(o.s);
    g.position.set(o.x, 0, o.z);
    g.rotation.y = o.yaw;
    const anchorShadow = !o.dyn && o.s >= 4 && o.s <= 15 && Math.hypot(o.x - baby.x, o.z - baby.z) < 24;
    if (anchorShadow) {
      g.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
      });
    }
    if (o.tpl.puke) {
      // Warning markers get a world-size floor so a 12 cm broccoli's stink
      // is as loud as a dumpster's — hazards must read at every scale.
      const ringScale = Math.max(1.2, 0.28 / o.s);
      const wispScale = Math.max(0.5, 0.3 / o.s);
      const ring = new T.Mesh(GEO.circle, pukeRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.scale.setScalar(ringScale);
      g.add(ring);
      const wisps = [];
      for (let i = 0; i < 2; i++) {
        const w = new T.Mesh(GEO.plane, stinkMat);
        w.scale.setScalar(wispScale);
        w.position.set((i === 0 ? -0.4 : 0.44) * wispScale, 0.9, 0);
        g.add(w);
        wisps.push(w);
      }
      o.stink = wisps;
      o.wispScale = wispScale;
      const sign = new T.Mesh(GEO.plane, hazardMat);
      sign.scale.setScalar(wispScale * 0.9);
      sign.position.set(0, wispScale * 1.85, 0);
      g.add(sign);
      o.warnSign = sign;
      o.warnRing = ring;
      o.ringScale = ringScale;
    }
    o.g = g;
    scene.add(g);
    activeObjs.add(o);
  }
  function dropObjGroup(o) {
    if (o.g) scene.remove(o.g);
    o.g = null;
    o.stink = null;
    o.warnSign = null;
    o.warnRing = null;
    activeObjs.delete(o);
  }

  let activateTimer = 0;
  function refreshActivation(force) {
    const size = baby.size;
    const actR = activationRadius();
    for (const o of Array.from(activeObjs)) {
      const dx = o.x - baby.x;
      const dz = o.z - baby.z;
      const d2 = dx * dx + dz * dz;
      const objR = Math.min(actR, 26 + o.s * 40 + size * 7);
      if (o.dead || d2 > objR * objR * 1.35 || o.s < size * 0.008) dropObjGroup(o);
    }
    let budget = force ? 6000 : 100;
    forNear(baby.x, baby.z, actR, (o) => {
      if (budget <= 0 || o.dead || o.g) return;
      if (o.s < size * 0.008) return; // specks invisible to a giant
      const dx = o.x - baby.x;
      const dz = o.z - baby.z;
      const objR = Math.min(actR, 26 + o.s * 40 + size * 7);
      if (dx * dx + dz * dz < objR * objR) {
        buildObjGroup(o);
        budget--;
      }
    });
  }

  // ---------- The baby ----------
  const babyG = new T.Group();
  babyG.name = "bbb_hero_baby_v2";
  babyG.userData.modelVersion = 2;
  const roller = new T.Group();
  roller.name = "baby_morph_rig";
  babyG.add(roller);
  scene.add(babyG);
  const shadowTex = makeTex(128, (g, s) => {
    const fade = g.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s * 0.5);
    fade.addColorStop(0, "rgba(18,42,23,0.68)");
    fade.addColorStop(0.55, "rgba(18,42,23,0.34)");
    fade.addColorStop(1, "rgba(18,42,23,0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, s, s);
  });
  shadowTex.name = "bbb_soft_contact_shadow";
  const shadow = new T.Mesh(GEO.circle, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.78, depthWrite: false }));
  shadow.name = "baby_contact_shadow";
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const SKIN = 0xffd9b8;
  const parts = {};
  function buildBaby() {
    const skin = mat(SKIN, { roughness: 0.72 });
    const romper = mat(0x55a9e6, { roughness: 0.76 });
    const diaper = mat(0xf4fbff, { roughness: 0.94 });
    parts.body = mesh(GEO.sph, romper, 1, 1, 1, 0, 0, 0);
    parts.body.name = "baby_romper_body";
    parts.body.add(
      instanced(
        GEO.box,
        mat(0xe7f5ff, { roughness: 0.88 }),
        [-1, 1].map((side) => ({ p: [side * 0.42, 0.48, 0.73], r: [0, 0, side * -0.18], s: [0.13, 0.45, 0.08] })),
        "baby_romper_straps"
      )
    );

    parts.head = mesh(GEO.sph, skin, 1, 1, 1, 0, 0, 0);
    parts.head.name = "baby_head";
    parts.face = new T.Mesh(GEO.plane, faceMat);
    parts.face.name = "baby_expression_decal";
    parts.face.position.set(0, -0.02, 0.995);
    parts.face.scale.setScalar(1.28);
    parts.head.add(parts.face);
    parts.head.add(
      instanced(
        GEO.dodec,
        skin,
        [-1, 1].map((side) => ({ p: [side * 0.93, -0.02, 0.02], s: [0.24, 0.34, 0.16] })),
        "baby_ears"
      )
    );
    parts.head.add(mesh(GEO.dodec, mat(0xf2b48f, { roughness: 0.8 }), 0.1, 0.08, 0.1, 0, -0.08, 1.01));
    const curl = mesh(GEO.torusThin, mat(0xb77745, { roughness: 0.72 }), 0.3, 0.3, 0.3, 0.02, 0.98, 0.08);
    curl.name = "baby_hair_curl";
    curl.rotation.x = 0.62;
    curl.rotation.z = -0.42;
    parts.head.add(curl);

    parts.diaperBack = mesh(GEO.sph, diaper, 1, 1, 1, 0, 0, 0);
    parts.diaperBack.name = "baby_diaper_back";
    parts.band = mesh(GEO.cyl, diaper, 1, 1, 1, 0, 0, 0);
    parts.band.name = "baby_diaper_waist";
    parts.band.add(
      instanced(
        GEO.box,
        mat(0xbfdff1, { roughness: 0.82 }),
        [-1, 1].map((side) => ({ p: [side * 0.86, 0.08, 0.04], s: [0.22, 0.3, 0.08] })),
        "baby_diaper_tabs"
      )
    );
    parts.limbs = [];
    for (let i = 0; i < 4; i++) {
      const l = new T.Group();
      l.name = i < 2 ? `baby_arm_${i}` : `baby_leg_${i - 2}`;
      l.add(mesh(GEO.dodec, skin, 0.92, 0.72, 1.12, 0, 0, 0));
      l.add(mesh(GEO.sph, skin, 0.58, 0.46, 0.7, 0, -0.06, 0.74));
      parts.limbs.push(l);
      roller.add(l);
    }
    roller.add(parts.body, parts.head, parts.diaperBack, parts.band);
    babyG.traverse((child) => {
      if (child.isMesh && child !== parts.face) child.castShadow = true;
    });
  }
  buildBaby();

  function applyMorph(r, wiggle, bob) {
    babyG.scale.setScalar(baby.size);
    roller.position.y = lerp(0.42, 0.5, r) + bob * (1 - r) * 0.03;

    parts.body.position.set(0, lerp(-0.04, 0, r), lerp(-0.06, 0, r));
    parts.body.scale.set(lerp(0.36, 0.5, r), lerp(0.29, 0.5, r), lerp(0.42, 0.5, r));
    parts.head.position.set(0, lerp(0.17, 0.26, r), lerp(0.35, 0.3, r));
    parts.head.scale.setScalar(lerp(0.27, 0.18, r));
    parts.diaperBack.position.set(0, lerp(-0.06, -0.1, r), lerp(-0.3, -0.28, r));
    parts.diaperBack.scale.set(lerp(0.27, 0.3, r), lerp(0.2, 0.26, r), lerp(0.23, 0.28, r));
    parts.band.position.set(0, 0, 0);
    parts.band.scale.set(lerp(0.001, 0.505, r), lerp(0.001, 0.2, r), lerp(0.001, 0.505, r));
    const lp = [
      [-0.26, -0.2, 0.26],
      [0.26, -0.2, 0.26],
      [-0.24, -0.24, -0.22],
      [0.24, -0.24, -0.22],
    ];
    for (let i = 0; i < 4; i++) {
      const l = parts.limbs[i];
      const w = Math.sin(baby.crawl * Math.PI * 2 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * wiggle * (1 - r);
      l.position.set(lerp(lp[i][0], lp[i][0] * 1.5, r), lerp(lp[i][1], lp[i][1] * 1.55, r), lerp(lp[i][2], lp[i][2] * 1.5, r) + w * 0.12 * (1 - r));
      l.scale.setScalar(lerp(0.105, 0.065, r));
    }
  }

  function setFace(state) {
    if (baby.faceState === state) return;
    baby.faceState = state;
    faceMat.map = FACES[state];
    faceMat.needsUpdate = true;
  }

  function roundness() {
    return clamp((baby.size - ROUND_START) / (ROUND_FULL - ROUND_START), 0, 1);
  }

  // ---------- Particles ----------
  function makePool(count, pointSize) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos[i * 3 + 1] = -999;
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.setAttribute("color", new T.BufferAttribute(col, 3));
    const m = new T.PointsMaterial({ size: pointSize, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false });
    const points = new T.Points(geo, m);
    points.frustumCulled = false;
    scene.add(points);
    return { geo, pos, col, count, next: 0, live: [] };
  }
  const poolS = makePool(160, 0.09);
  const poolM = makePool(160, 0.55);
  const poolL = makePool(120, 2.6);
  const tmpColor = new T.Color();

  function spawnBurst(pool, x, y, z, n, colorHex, spread, up) {
    for (let i = 0; i < n; i++) {
      const idx = pool.next;
      pool.next = (pool.next + 1) % pool.count;
      tmpColor.set(colorHex);
      pool.col[idx * 3] = tmpColor.r;
      pool.col[idx * 3 + 1] = tmpColor.g;
      pool.col[idx * 3 + 2] = tmpColor.b;
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.4 + Math.random());
      pool.live.push({
        idx, x, y, z,
        vx: Math.cos(a) * sp,
        vy: up * (0.6 + Math.random()),
        vz: Math.sin(a) * sp,
        t: 0,
        life: 0.5 + Math.random() * 0.5,
      });
    }
    pool.geo.attributes.color.needsUpdate = true;
  }
  function poolFor(objSize) {
    if (objSize < 0.5) return poolS;
    if (objSize < 4) return poolM;
    return poolL;
  }
  function updatePools(dt) {
    for (const pool of [poolS, poolM, poolL]) {
      const dirty = pool.live.length > 0;
      for (let i = pool.live.length - 1; i >= 0; i--) {
        const p = pool.live[i];
        p.t += dt;
        if (p.t >= p.life) {
          pool.pos[p.idx * 3 + 1] = -999;
          pool.live.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 2.2 * dt;
        if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; }
        pool.pos[p.idx * 3] = p.x;
        pool.pos[p.idx * 3 + 1] = p.y;
        pool.pos[p.idx * 3 + 2] = p.z;
      }
      if (dirty) pool.geo.attributes.position.needsUpdate = true;
    }
  }

  // ---------- DOM floaters & banner ----------
  const floaters = [];
  const v3 = new T.Vector3();
  function addFloater(wx, wy, wz, text, color, big) {
    if (floaters.length > 18) {
      const old = floaters.shift();
      old.el.remove();
    }
    const el = document.createElement("div");
    el.className = "bbb-float" + (big ? " bbb-float--big" : "");
    el.textContent = text;
    el.style.color = color || "#fbfaf4";
    floatLayer.appendChild(el);
    floaters.push({ el, wx, wy, wz, t: 0, life: big ? 1.6 : 1.15 });
  }
  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t >= f.life) {
        f.el.remove();
        floaters.splice(i, 1);
        continue;
      }
      f.wy += dt * (0.4 + baby.size * 0.25);
      v3.set(f.wx, f.wy, f.wz).project(camera);
      if (v3.z > 1) {
        f.el.style.opacity = "0";
        continue;
      }
      f.el.style.left = `${((v3.x + 1) / 2) * 100}%`;
      f.el.style.top = `${((1 - v3.y) / 2) * 100}%`;
      f.el.style.opacity = String(f.t < 0.12 ? f.t / 0.12 : 1 - (f.t - 0.12) / (f.life - 0.12));
    }
  }
  let bannerTimer = null;
  function showBanner(emoji, small, big) {
    bannerEmoji.textContent = emoji;
    bannerSmall.textContent = small;
    bannerBig.textContent = big;
    bannerEl.classList.remove("is-show");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("is-show");
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove("is-show"), 2600);
  }

  // ---------- Save / load (v2: only permanents are recorded) ----------
  function saveGame() {
    if (!baby || phase === "menu") return;
    const eaten = [];
    for (const o of objects) if (!o.dyn && o.dead) eaten.push(o.id);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 2,
        size: baby.size,
        x: baby.x,
        z: baby.z,
        score,
        noms,
        playSeconds: Math.round(playSeconds),
        freePlay,
        biggestNom,
        recorded: Array.from(recordedPhases),
        eaten,
      }));
    } catch (err) { /* storage full — shrug */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 2) return null;
      return s;
    } catch (err) {
      return null;
    }
  }
  function wipeSave() {
    localStorage.removeItem(SAVE_KEY);
  }

  // ---------- Flow ----------
  function resetBaby(size, x, z) {
    baby = {
      x: typeof x === "number" ? x : -5,
      z: typeof z === "number" ? z : 1,
      vx: 0,
      vz: 0,
      size: size || START_SIZE,
      heading: 0,
      crawl: 0,
      chew: 0,
      faceState: "",
    };
    camYaw = Math.PI;
    setFace("open");
  }

  function startGame(save) {
    AudioKit.unlock();
    freePlay = false;
    recordedPhases = new Set();
    biggestNom = null;
    buildCity(); // the SAME city, every time
    if (save) {
      const eatenSet = new Set(save.eaten);
      for (const o of objects) {
        if (!o.dyn && eatenSet.has(o.id)) {
          o.dead = true;
          gridRemove(o);
        }
      }
      resetBaby(save.size, save.x, save.z);
      score = save.score || 0;
      noms = save.noms || 0;
      playSeconds = save.playSeconds || 0;
      freePlay = !!save.freePlay;
      biggestNom = save.biggestNom || null;
      recordedPhases = new Set(save.recorded || []);
      setLog("Save loaded. The city did not miss you.");
    } else {
      resetBaby();
      score = 0;
      noms = 0;
      playSeconds = 0;
      wipeSave();
      setLog("Baby deployed. The fence is a wall until you can eat it.");
    }
    combo = 0;
    comboTimer = 0;
    burpTimer = 0;
    burpCooldown = 0;
    slowTimer = 0;
    sickTimer = 0;
    pukeImmune = 0;
    hitImmune = 0;
    gasEmitT = 0;
    for (const e of enemies) if (e.g) scene.remove(e.g);
    enemies = [];
    for (const sh of shells) scene.remove(sh.m);
    shells = [];
    for (const c of gasClouds) scene.remove(c.m);
    gasClouds = [];
    enemySpawnCursor = 0;
    enemyHitsTaken = 0;
    enemyShotsFired = 0;
    enemyAnnounced.clear();
    shake = 0;
    saveTimer = 0;
    spawnTimer = 0;
    lastPhaseName = phaseFor(baby.size).n;
    spawnTick(true); // fill the streets before the first frame
    refreshActivation(true);
    phase = "play";
    overlayEl.classList.remove("overlay--show");
    setPauseLabel();
    AudioKit.startMusic();
    refreshMenuList();
    updateHud(true);
    showBanner("🍼", save ? "WELCOME BACK" : "BREAKFAST TIME", save ? "STILL HUNGRY" : "EAT WHAT FITS IN YOUR MOUTH");
    canvas.focus({ preventScroll: true });
  }

  function togglePause(force) {
    if (phase === "play" || force === true) {
      phase = "paused";
      AudioKit.stopMusic();
      saveGame();
      overlayTitle.textContent = "⏸️ MILK BREAK";
      overlaySub.textContent = "Progress saved. The baby dreams of buildings.";
      overlayScore.innerHTML = statLines();
      btnPrimary.textContent = "Resume the feast";
      btnContinue.style.display = "none";
      overlayEl.classList.add("overlay--show");
    } else if (phase === "paused") {
      phase = "play";
      overlayEl.classList.remove("overlay--show");
      AudioKit.startMusic();
    }
    setPauseLabel();
  }
  function setPauseLabel() {
    if (btnPause) btnPause.textContent = phase === "paused" ? "Resume" : "Pause";
  }

  function statLines() {
    return (
      `<div class="score-line">SIZE <b>${fmtSize(baby.size)}</b></div>` +
      `<div class="score-line">THINGS EATEN <b>${noms}</b></div>` +
      (biggestNom ? `<div class="score-line">BIGGEST NOM <b>${biggestNom.e} ${biggestNom.n}</b></div>` : "") +
      `<div class="score-line">SCORE <b>${score.toLocaleString()}</b></div>` +
      `<div class="score-line">TIME PLAYED <b>${Math.floor(playSeconds / 60)}m ${Math.floor(playSeconds % 60)}s</b></div>`
    );
  }

  function winGame() {
    phase = "over";
    AudioKit.stopMusic();
    AudioKit.bigFanfare();
    const isHigh = score > high;
    if (isHigh) {
      high = score;
      localStorage.setItem(LS_HIGH, String(high));
    }
    try {
      api.recordScore(GAME_ID, score, { size: Math.round(baby.size * 10) / 10, noms });
    } catch (err) { /* fine */ }
    saveGame();
    overlayTitle.textContent = "👑 TOWN EATER";
    overlaySub.textContent = "The town is inside the baby now. The HOA has no jurisdiction over you anymore. Keep rolling — there's always dessert.";
    overlayScore.innerHTML = statLines() + (isHigh ? `<div class="score-line score-line--new">NEW HIGH SCORE!</div>` : "");
    btnPrimary.textContent = "Keep rolling (free play)";
    btnContinue.style.display = "";
    btnContinue.textContent = "Start a fresh baby";
    overlayEl.classList.add("overlay--show");
    updateHud(true);
  }

  // ---------- Eating, puking, growing ----------
  function eatThreshold() {
    return baby.size * EAT_RATIO;
  }
  function nextUnlock() {
    let best = null;
    for (const t of ALL_TPLS) {
      if (t.puke) continue; // never advertise The Mistake Foods
      if (t.s > eatThreshold() && (!best || t.s < best.s)) best = t;
    }
    return best;
  }

  const eatTweens = [];
  function killObject(o) {
    o.dead = true;
    gridRemove(o);
    if (o.g) {
      eatTweens.push({ g: o.g, t: 0, sx: o.x, sz: o.z, s: o.s });
      activeObjs.delete(o);
      o.g = null;
      o.stink = null;
      o.warnSign = null;
      o.warnRing = null;
    }
    // Dead dynamics get compacted out of the array by despawnSweep.
  }
  function updateEatTweens(dt) {
    for (let i = eatTweens.length - 1; i >= 0; i--) {
      const tw = eatTweens[i];
      tw.t += dt * 4.5;
      if (tw.t >= 1) {
        scene.remove(tw.g);
        eatTweens.splice(i, 1);
        continue;
      }
      const k = tw.t;
      tw.g.position.set(lerp(tw.sx, baby.x, k), lerp(0, baby.size * 0.4, k), lerp(tw.sz, baby.z, k));
      tw.g.scale.setScalar(tw.s * (1 - k) + 0.0001);
    }
  }

  function eat(o) {
    const before = eatThreshold();
    killObject(o);
    noms++;
    const growBonus = combo >= 6 ? 1.25 : 1;
    baby.size = Math.min(Math.sqrt(baby.size * baby.size + GROWTH_K * growBonus * o.s * o.s), 60);
    baby.chew = 0.35;

    comboTimer = COMBO_WINDOW;
    combo = Math.min(COMBO_MAX, combo + 1);
    const pts = Math.max(1, Math.round(o.s * o.s * 12)) * combo;
    score += pts;
    if (!biggestNom || o.s > biggestNom.s) biggestNom = { e: o.tpl.e, n: o.tpl.n, s: o.s };

    AudioKit.chomp(baby.size);
    if (combo >= 4 && combo % 2 === 0) AudioKit.giggle();
    spawnBurst(poolFor(o.s), o.x, o.s * 0.5 + 0.05, o.z, clamp(Math.round(o.s * 4) + 6, 6, 16), [0xffd43b, 0xff7eb6, 0x7ac9ff, 0xffb26b][(Math.random() * 4) | 0], o.s * 1.2 + 0.2, o.s * 0.8 + 0.3);
    const notable = o.s >= baby.size * 0.3;
    addFloater(o.x, o.s + baby.size * 0.15, o.z, notable ? `+${pts.toLocaleString()} ${o.tpl.e} ${o.tpl.n}` : `+${pts.toLocaleString()}`, combo >= 5 ? "#ffd43b" : "#fbfaf4", notable);
    shake = Math.min(0.5, shake + clamp(o.s / baby.size, 0.03, 0.4) * 0.35);

    const after = eatThreshold();
    let star = null;
    for (const t of ALL_TPLS) {
      if (t.s > before && t.s <= after && (!star || t.s > star.s)) star = t;
    }
    if (star) {
      showBanner(star.e, "NEW ON THE MENU", star.n.toUpperCase());
      AudioKit.fanfare();
      score += 400;
      refreshMenuList();
    }

    const ph = phaseFor(baby.size);
    if (ph.n !== lastPhaseName) {
      lastPhaseName = ph.n;
      showBanner(ph.e, "PHASE UP", ph.n);
      AudioKit.bigFanfare();
      setLog(phaseLog(ph.n));
      if (!recordedPhases.has(ph.n)) {
        recordedPhases.add(ph.n);
        try {
          api.recordScore(GAME_ID, score, { size: Math.round(baby.size * 10) / 10, phase: ph.n });
        } catch (err) { /* fine */ }
      }
      if (ph.n === "TOWN EATER" && !freePlay) {
        freePlay = true;
        winGame();
        return;
      }
    }
    if (score > high) {
      high = score;
      localStorage.setItem(LS_HIGH, String(high));
    }
  }

  function phaseLog(name) {
    switch (name) {
      case "TOY DESTROYER": return "The toys have unionized. It won't help them.";
      case "ROUND MODE": return "The baby is now legally a sphere. Physics has opinions.";
      case "YARD LEGEND": return "Neighbors are pointing. Keep eating.";
      case "STREET MENACE": return "Cars are snack-shaped now. Mind the traffic. Or don't.";
      case "HOUSE MUNCHER": return "Real estate: edible. Mom's house counts. Sorry, Mom.";
      case "BLOCK BUSTER": return "The block. You are busting it.";
      case "TOWN EATER": return "There is no town. There is only baby.";
      default: return "Crumbs tremble at your approach.";
    }
  }

  // Beneath your notice: hazards far smaller than you get flattened, no penalty.
  function squash(o) {
    killObject(o);
    spawnBurst(poolFor(o.s), o.x, o.s * 0.5, o.z, 5, 0x6ede3e, o.s + 0.1, 0.4);
  }
  function puke(o) {
    if (o.s < baby.size * PUKE_MIN_RATIO) {
      squash(o);
      return;
    }
    if (pukeImmune > 0) return; // already mid-regret; the object is left alone
    killObject(o);
    const oldSize = baby.size;
    // Penalty scales with how big the mistake was relative to the baby:
    // a floret barely registers on a giant, a porta-potty at eye level hurts.
    const shrinkFrac = clamp(0.03 + (o.s / baby.size) * 0.1, 0.03, 0.12);
    pukeImmune = 2.4;
    baby.size = Math.max(START_SIZE * 0.8, baby.size * (1 - shrinkFrac));
    slowTimer = PUKE_SLOW;
    sickTimer = 3.0;
    combo = 0;
    comboTimer = 0;
    setFace("sick");
    AudioKit.puke();
    for (let i = 0; i < 3; i++) {
      spawnBurst(poolFor(baby.size), baby.x + Math.sin(baby.heading) * baby.size * 0.4, baby.size * 0.5, baby.z + Math.cos(baby.heading) * baby.size * 0.4, 10, i % 2 ? 0x6ede3e : 0x9fdb4f, baby.size * 0.8 + 0.3, baby.size * 0.6 + 0.4);
    }
    addFloater(baby.x, baby.size * 1.1, baby.z, PUKE_LINES[(Math.random() * PUKE_LINES.length) | 0], "#7edb4f", true);
    addFloater(baby.x, baby.size * 0.7, baby.z, `-${fmtSize(oldSize - baby.size)} of baby`, "#7edb4f", false);
    shake = 0.6;
    pukeFlash.classList.add("is-on");
    setTimeout(() => pukeFlash.classList.remove("is-on"), 700);
    setLog(`Ate ${o.tpl.n}. ${PUKE_LINES[(Math.random() * PUKE_LINES.length) | 0]}`);
    refreshMenuList(); // shrinking can re-lock menu items
  }

  function tryFart() {
    if (phase !== "play" || burpCooldown > 0) return;
    burpCooldown = BURP_COOLDOWN;
    burpTimer = BURP_DURATION;
    gasEmitT = BURP_DURATION + 1.1; // the trail lingers past the boost
    gasPuffT = 0;
    AudioKit.fart();
    spawnBurst(poolFor(baby.size), baby.x, baby.size * 0.6, baby.z, 10, 0x8fdc4f, baby.size * 0.8, baby.size * 0.5);
    addFloater(baby.x, baby.size * 1.05, baby.z, "TURBO FART!", "#8fdc4f", true);
  }
  const tryBurp = tryFart; // old name kept for wiring/debug compat

  // ---------- Input ----------
  const keys = new Set();
  let pointerActive = false;
  const pointerNDC = { x: 0, y: 0 };
  const raycaster = new T.Raycaster();
  const groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const rayPoint = new T.Vector3();

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && phase === "play") e.preventDefault();
    if (k === "p" || k === "escape") {
      if (phase === "play" || phase === "paused") togglePause();
      return;
    }
    if (k === "m") {
      setSound(!AudioKit.enabled);
      return;
    }
    if (k === " ") {
      if (phase === "play") tryBurp();
      return;
    }
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  function updatePointer(e) {
    const r = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (phase !== "play") return;
    pointerActive = true;
    updatePointer(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerActive) updatePointer(e);
  });
  const endPointer = () => {
    pointerActive = false;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "play") togglePause(true);
  });
  window.addEventListener("beforeunload", saveGame);

  // ---------- Update ----------
  const rollAxis = new T.Vector3();
  const rollQ = new T.Quaternion();
  const identityQ = new T.Quaternion();

  function update(dt) {
    playSeconds += dt;
    const size = baby.size;
    const r = roundness();
    const rolling = r >= ROLL_AT;

    // --- input direction (camera-relative) ---
    let ix = 0;
    let iz = 0;
    {
      let fx = 0;
      let fz = 0;
      if (keys.has("w") || keys.has("arrowup")) fz += 1;
      if (keys.has("s") || keys.has("arrowdown")) fz -= 1;
      if (keys.has("a") || keys.has("arrowleft")) fx -= 1;
      if (keys.has("d") || keys.has("arrowright")) fx += 1;
      if (fx || fz) {
        const cfx = baby.x - camera.position.x;
        const cfz = baby.z - camera.position.z;
        const cl = Math.hypot(cfx, cfz) || 1;
        const fwx = cfx / cl;
        const fwz = cfz / cl;
        // Strafe axis is (-fwz, fwx): screen-right when looking along (fwx, fwz).
        ix = fwx * fz - fwz * fx;
        iz = fwz * fz + fwx * fx;
      }
      if (pointerActive) {
        raycaster.setFromCamera(pointerNDC, camera);
        if (raycaster.ray.intersectPlane(groundPlane, rayPoint)) {
          const dx = rayPoint.x - baby.x;
          const dz = rayPoint.z - baby.z;
          const d = Math.hypot(dx, dz);
          if (d > size * 0.5) {
            ix = dx / d;
            iz = dz / d;
          }
        }
      }
      const il = Math.hypot(ix, iz);
      if (il > 1) {
        ix /= il;
        iz /= il;
      }
    }

    // --- physics (rolling = more inertia) ---
    const boost = burpTimer > 0 ? 1.8 : 1;
    const queasy = slowTimer > 0 ? 0.35 : 1; // puke slows, never stops
    const maxSpd = (1.5 + size * 1.05) * boost * queasy;
    const accel = maxSpd * (rolling ? 2.2 : 5.0);
    const frBase = rolling ? 0.3 : 0.012;
    baby.vx += ix * accel * dt;
    baby.vz += iz * accel * dt;
    const fr = Math.pow(frBase, dt);
    baby.vx *= fr;
    baby.vz *= fr;
    const spd = Math.hypot(baby.vx, baby.vz);
    if (spd > maxSpd) {
      baby.vx = (baby.vx / spd) * maxSpd;
      baby.vz = (baby.vz / spd) * maxSpd;
    }
    baby.x += baby.vx * dt;
    baby.z += baby.vz * dt;

    // Rectangular city bounds (the hedge).
    const bound = CITY_BOUND - 6 - size * 0.5;
    baby.x = clamp(baby.x, -bound, bound);
    baby.z = clamp(baby.z, -bound, bound);

    // The backyard fence is a solid wall until the baby can eat it (~1.57 m).
    if (size < FENCE_FREE && baby.x > YARD.x0 - 0.8 && baby.x < YARD.x1 + 0.8 && baby.z > YARD.z0 - 0.8 && baby.z < YARD.z1 + 0.8) {
      const fm = size * 0.35 + 0.2;
      const cx = clamp(baby.x, YARD.x0 + fm, YARD.x1 - fm);
      const cz = clamp(baby.z, YARD.z0 + fm, YARD.z1 - fm);
      if ((cx !== baby.x || cz !== baby.z) && bonkCooldown <= 0 && spd > maxSpd * 0.45) {
        bonkCooldown = 1.6;
        AudioKit.bonk();
        addFloater(baby.x, size * 0.9, baby.z, `FENCE SAYS NO. GROW TO ${fmtSize(FENCE_FREE)}.`, "#b6b3c9", false);
      }
      baby.x = cx;
      baby.z = cz;
    }

    if (spd > maxSpd * 0.1) {
      baby.heading = Math.atan2(baby.vx, baby.vz);
      baby.crawl += dt * clamp(spd / Math.max(size, 0.2), 1.5, 8) * 1.4;
    }
    baby.chew = Math.max(0, baby.chew - dt);
    slowTimer = Math.max(0, slowTimer - dt);
    sickTimer = Math.max(0, sickTimer - dt);
    pukeImmune = Math.max(0, pukeImmune - dt);
    hitImmune = Math.max(0, hitImmune - dt);
    burpTimer = Math.max(0, burpTimer - dt);
    burpCooldown = Math.max(0, burpCooldown - dt);
    bonkCooldown = Math.max(0, bonkCooldown - dt);
    if (btnBurp) {
      btnBurp.disabled = burpCooldown > 0;
      btnBurp.textContent = burpCooldown > 0 ? `💨 ${Math.ceil(burpCooldown)}s` : "💨 FART";
    }
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }

    if (sickTimer > 0) setFace("sick");
    else if (baby.chew > 0) setFace("bliss");
    else setFace(spd > maxSpd * 0.3 ? "open" : "normal");

    // --- baby visuals ---
    babyG.position.set(baby.x, 0, baby.z);
    const wiggle = clamp(spd / Math.max(maxSpd, 0.01), 0, 1);
    applyMorph(r, wiggle, Math.sin(baby.crawl * Math.PI * 2));
    if (rolling) {
      babyG.rotation.y = 0;
      if (spd > 0.01) {
        rollAxis.set(baby.vz, 0, -baby.vx).normalize();
        rollQ.setFromAxisAngle(rollAxis, (spd * dt) / (size * 0.5));
        roller.quaternion.premultiply(rollQ);
      }
    } else {
      babyG.rotation.y = baby.heading;
      roller.quaternion.slerp(identityQ, 1 - Math.pow(0.01, dt));
    }
    babyG.rotation.z = slowTimer > 0 ? Math.sin(slowTimer * 14) * 0.05 : 0;
    shadow.position.set(baby.x, 0.025, baby.z);
    shadow.scale.setScalar(size * 0.62);

    // --- activation window & dynamic population ---
    activateTimer -= dt;
    if (activateTimer <= 0) {
      activateTimer = 0.14;
      refreshActivation(false);
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 0.9;
      despawnSweep();
      spawnTick(false);
      enemyTick();
    }

    // --- movers, traffic & stink anim (active objects only) ---
    const thr = eatThreshold();
    const now = performance.now();
    for (const o of activeObjs) {
      if (o.driveAxis) {
        // Traffic: drives its road in a straight line. It has places to be.
        o.x += o.mvx * dt;
        o.z += o.mvz * dt;
        gridMove(o);
        if (o.g) {
          o.g.position.set(o.x, 0, o.z);
          o.g.rotation.y = Math.atan2(o.mvx, o.mvz);
        }
      } else if (o.tpl.mover) {
        const dx = o.x - baby.x;
        const dz = o.z - baby.z;
        const d = Math.hypot(dx, dz);
        if (o.tpl.flees && o.s <= thr && d < size * 7 + 4) {
          const inv = 1 / (d || 1);
          o.mvx = dx * inv * o.tpl.spd * 2.0;
          o.mvz = dz * inv * o.tpl.spd * 2.0;
          if (o.panic <= 0) {
            o.panic = 2 + Math.random() * 2;
            if (Math.random() < 0.4 && d < size * 5) addFloater(o.x, o.s + 0.3, o.z, ["AAAAH!", "NOT LIKE THIS", "MY HIP!", "BAD BABY!"][(Math.random() * 4) | 0], "#ffb26b", false);
          }
        } else {
          o.wanderT -= dt;
          if (o.wanderT <= 0) {
            o.wanderT = 0.8 + Math.random() * 2.4;
            if (Math.random() < 0.4) {
              o.mvx = 0;
              o.mvz = 0;
            } else if (o.tpl.surface === "walk") {
              // Pedestrians stroll along their sidewalk, not across lawns:
              // heading 0/π beside north-south roads, ±π/2 beside east-west.
              const besideNS = distToLine(o.x) < distToLine(o.z);
              const along = besideNS ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
              o.mvx = Math.sin(along) * o.tpl.spd * 0.5;
              o.mvz = Math.cos(along) * o.tpl.spd * 0.5;
            } else {
              const a = Math.random() * Math.PI * 2;
              o.mvx = Math.cos(a) * o.tpl.spd * 0.4;
              o.mvz = Math.sin(a) * o.tpl.spd * 0.4;
            }
          }
        }
        o.panic = Math.max(0, o.panic - dt);
        o.x += o.mvx * dt;
        o.z += o.mvz * dt;
        o.x = clamp(o.x, -CITY_BOUND + 6, CITY_BOUND - 6);
        o.z = clamp(o.z, -CITY_BOUND + 6, CITY_BOUND - 6);
        gridMove(o);
        if (o.g) {
          o.g.position.set(o.x, Math.abs(Math.sin(now * 0.012 + o.bob)) * (o.panic > 0 ? o.s * 0.18 : 0), o.z);
          if (o.mvx || o.mvz) o.g.rotation.y = Math.atan2(o.mvx, o.mvz);
        }
      } else if (o.g && o.s <= thr && o.s > size * 0.05) {
        o.g.position.y = Math.abs(Math.sin(now * 0.003 + o.bob)) * o.s * 0.04;
      }
      if (o.stink) {
        const ws = o.wispScale || 0.5;
        const face = camYaw - o.yaw; // billboard inside a yawed parent
        // No crying wolf: hazards you'd merely squash lose their warnings.
        const harmless = o.s < size * PUKE_MIN_RATIO;
        if (o.warnSign) o.warnSign.visible = !harmless;
        if (o.warnRing) o.warnRing.visible = !harmless;
        for (let i = 0; i < o.stink.length; i++) {
          const w = o.stink[i];
          w.visible = !harmless;
          const ph2 = now * 0.0012 + i * 2.2 + o.bob;
          w.position.y = (0.75 + ((ph2 % 1.4) / 1.4) * 0.7) * ws;
          w.rotation.y = face;
          w.position.x = (i === 0 ? -0.4 : 0.44) * ws + Math.sin(ph2 * 2) * 0.05 * ws;
        }
        if (o.warnSign) {
          o.warnSign.rotation.y = face;
          o.warnSign.position.y = ws * (1.85 + Math.sin(now * 0.004 + o.bob) * 0.12);
        }
        if (o.warnRing) {
          o.warnRing.scale.setScalar(o.ringScale * (1 + 0.22 * Math.sin(now * 0.006 + o.bob)));
        }
      }
    }

    // --- burp vacuum (politely skips puke food) ---
    if (burpTimer > 0) {
      forNear(baby.x, baby.z, size * 2.8, (o) => {
        if (o.dead || o.s > thr || o.tpl.puke) return;
        const dx = baby.x - o.x;
        const dz = baby.z - o.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < size * 2.8) {
          const pull = (1 - d / (size * 2.8)) * size * 6 * dt;
          o.x += (dx / d) * pull;
          o.z += (dz / d) * pull;
          gridMove(o);
          if (o.g) o.g.position.set(o.x, o.g.position.y, o.z);
        }
      });
    }

    // --- eat & collide ---
    const queryR = size * 0.8 + 3;
    forNear(baby.x, baby.z, queryR, (o) => {
      if (o.dead) return;
      const dx = baby.x - o.x;
      const dz = baby.z - o.z;
      const d2 = dx * dx + dz * dz;
      if (o.s <= thr) {
        const reach = size * 0.5 + o.s * 0.45;
        if (d2 < reach * reach) {
          if (o.tpl.puke) {
            if (o.s < size * PUKE_MIN_RATIO) {
              squash(o); // too small to matter at this scale
            } else if (pukeImmune <= 0) {
              puke(o);
            }
            // While queasy (pukeImmune > 0) sizable puke food is left alone.
          } else {
            eat(o);
          }
        }
      } else {
        const solid = size * 0.34 + o.s * 0.36;
        if (d2 < solid * solid) {
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d;
          const nz = dz / d;
          baby.x = o.x + nx * solid;
          baby.z = o.z + nz * solid;
          const vn = baby.vx * nx + baby.vz * nz;
          if (vn < 0) {
            baby.vx -= nx * vn * 1.6;
            baby.vz -= nz * vn * 1.6;
            if (-vn > maxSpd * 0.55 && bonkCooldown <= 0) {
              bonkCooldown = 0.9;
              AudioKit.bonk();
              addFloater(baby.x, size * 0.9, baby.z, "TOO BIG. FOR NOW.", "#b6b3c9", false);
              shake = Math.min(0.6, shake + 0.25);
            }
          }
        }
      }
    });

    // --- hunters, shells, stink gas ---
    updateEnemies(dt, now);
    updateShells(dt);
    updateGas(dt);

    // --- camera ---
    if (spd > maxSpd * 0.15) {
      const targetYaw = Math.atan2(-baby.vx, -baby.vz);
      let dy = targetYaw - camYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      camYaw += dy * (1 - Math.pow(0.35, dt));
    }
    let targetDist = size * 2.62 + 1.35;
    // Don't park the camera inside a building: shrink the boom until the
    // view line clears anything tall between the baby and the camera.
    {
      const camH = size * 1.72 + 1.02;
      const dirX = Math.sin(camYaw);
      const dirZ = Math.cos(camYaw);
      const midX = baby.x + dirX * targetDist * 0.5;
      const midZ = baby.z + dirZ * targetDist * 0.5;
      forNear(midX, midZ, targetDist * 0.6 + 14, (o) => {
        if (o.dyn || o.dead || o.s < 2.5) return;
        const relX = o.x - baby.x;
        const relZ = o.z - baby.z;
        const t = relX * dirX + relZ * dirZ;
        if (t < size * 0.6 || t > targetDist) return;
        const perp = Math.abs(relX * dirZ - relZ * dirX);
        // 0.62 covers box corners — buildings are boxes, not cylinders, and a
        // box's half-diagonal pokes ~0.7·s past a 0.5·s cylinder.
        const rad = o.s * 0.62;
        if (perp < rad && camH < o.s * 0.85) {
          targetDist = Math.max(size * 1.2 + 0.8, t - rad - 0.4);
        }
      });
    }
    // Snap in quickly when blocked; relax back out slowly.
    camDist = lerp(camDist, targetDist, 1 - Math.pow(targetDist < camDist ? 0.0001 : 0.02, dt));
    const camH = size * 1.72 + 1.02;
    const shk = shake > 0.01 ? shake : 0;
    camera.position.set(
      baby.x + Math.sin(camYaw) * camDist + (Math.random() - 0.5) * shk,
      camH + (Math.random() - 0.5) * shk * 0.5,
      baby.z + Math.cos(camYaw) * camDist + (Math.random() - 0.5) * shk
    );
    camera.lookAt(baby.x, size * 0.55, baby.z);
    shake = Math.max(0, shake - dt * 1.8);
    scene.fog.near = Math.max(7.5, camDist * 2.45);
    scene.fog.far = clamp(camDist * 12, 68, 1400);

    updatePools(dt);
    updateEatTweens(dt);
    updateFloaters(dt);

    saveTimer += dt;
    if (saveTimer > 8) {
      saveTimer = 0;
      saveGame();
    }

    updateHud(false);
  }

  // ---------- HUD ----------
  let hudTick = 0;
  function updateHud(force) {
    hudTick--;
    if (!force && hudTick > 0) return;
    hudTick = 8;
    hudSize.textContent = fmtSize(baby.size);
    hudPhase.textContent = phaseFor(baby.size).n;
    hudScore.textContent = score.toLocaleString();
    hudNoms.textContent = String(noms);
    hudHigh.textContent = high.toLocaleString();
    const nu = nextUnlock();
    if (nu) {
      const prog = clamp(eatThreshold() / nu.s, 0, 1);
      if (unlockFillEl) unlockFillEl.style.width = `${(prog * 100).toFixed(1)}%`;
      if (unlockLabelEl) unlockLabelEl.textContent = `${nu.e} ${nu.n} — grow to ${fmtSize(nu.s / EAT_RATIO)}`;
    } else {
      if (unlockFillEl) unlockFillEl.style.width = "100%";
      if (unlockLabelEl) unlockLabelEl.textContent = "Everything is food. You did it.";
    }
  }

  function refreshMenuList() {
    if (!menuListEl) return;
    const thr = baby ? eatThreshold() : START_SIZE * EAT_RATIO;
    const seen = new Set();
    const items = [];
    for (const t of ALL_TPLS) {
      if (t.s <= thr && !t.puke && !seen.has(t.e)) {
        seen.add(t.e);
        items.push(t);
      }
    }
    items.sort((a, b) => b.s - a.s);
    menuListEl.textContent = items.slice(0, 16).map((t) => t.e).join(" ") || "🫧";
  }

  function setLog(text) {
    if (logEl) logEl.textContent = text;
  }

  // ---------- Main loop ----------
  let lastFrame = performance.now();
  let menuOrbit = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    if (phase === "play") {
      update(dt);
    } else if (phase === "menu") {
      menuOrbit += dt * 0.12;
      camYaw = menuOrbit;
      camera.position.set(baby.x + Math.sin(menuOrbit) * 9, 4.4, baby.z + Math.cos(menuOrbit) * 9);
      camera.lookAt(baby.x, 0.6, baby.z);
      applyMorph(roundness(), 0.15, Math.sin(now * 0.004));
      babyG.position.set(baby.x, 0, baby.z);
      shadow.position.set(baby.x, 0.025, baby.z);
      shadow.scale.setScalar(baby.size * 0.62);
      activateTimer -= dt;
      if (activateTimer <= 0) {
        activateTimer = 0.2;
        refreshActivation(false);
      }
      updatePools(dt);
      updateFloaters(dt);
    }
    renderer.render(scene, camera);
  }

  // ---------- Wiring ----------
  btnPrimary.addEventListener("click", () => {
    if (phase === "paused") {
      togglePause();
    } else if (phase === "over") {
      phase = "play";
      overlayEl.classList.remove("overlay--show");
      AudioKit.startMusic();
      setPauseLabel();
    } else {
      startGame(null);
    }
  });
  btnContinue.addEventListener("click", () => {
    if (phase === "over") {
      wipeSave();
      startGame(null);
      return;
    }
    const save = loadSave();
    startGame(save || null);
  });
  if (btnPause)
    btnPause.addEventListener("click", () => {
      if (phase === "play" || phase === "paused") togglePause();
    });
  if (btnRestart)
    btnRestart.addEventListener("click", () => {
      if (phase === "menu") return;
      wipeSave();
      startGame(null);
    });
  if (btnBurp)
    btnBurp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      tryBurp();
    });

  function setSound(on) {
    AudioKit.setEnabled(on);
    if (btnSound) {
      btnSound.textContent = on ? "Sound On" : "Sound Off";
      btnSound.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (on && phase === "play") AudioKit.startMusic();
  }
  if (btnSound) btnSound.addEventListener("click", () => setSound(!AudioKit.enabled));
  setSound(AudioKit.enabled);

  // ---------- Debug hook ----------
  window.__BBB = {
    get state() {
      return {
        phase,
        size: baby ? baby.size : 0,
        x: baby ? baby.x : 0,
        z: baby ? baby.z : 0,
        roundness: baby ? roundness() : 0,
        rolling: baby ? roundness() >= ROLL_AT : false,
        score,
        noms,
        combo,
        slowed: slowTimer > 0,
        hitImmune: hitImmune > 0,
        enemies: enemies.length,
        activeEnemies: enemies.filter((enemy) => enemy.state !== "retire").length,
        enemyHitsTaken,
        enemyShotsFired,
        shells: shells.length,
        gas: gasClouds.length,
        permanents: permCount,
        permanentsLeft: objects.filter((o) => !o.dyn && !o.dead).length,
        dynamics: dynCount,
        active: activeObjs.size,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        heroModel: babyG.userData.modelVersion,
        hasSave: !!loadSave(),
      };
    },
    start(fresh) {
      startGame(fresh ? null : loadSave());
    },
    grow(m) {
      if (baby) baby.size = clamp(baby.size + (m || 0.5), 0.1, 60);
      refreshMenuList();
    },
    setSize(m) {
      if (baby) baby.size = clamp(m, 0.1, 60);
      refreshMenuList();
    },
    teleport(x, z) {
      if (baby) {
        baby.x = x;
        baby.z = z;
        refreshActivation(true);
        despawnSweep();
        spawnTick(true);
      }
    },
    pukeNow(sz) {
      if (baby) puke({ id: -2, dead: false, dyn: true, tpl: { e: "🥦", n: "Debug Broccoli", puke: true }, s: typeof sz === "number" ? sz : baby.size * 0.5, x: baby.x, z: baby.z, g: null, cell: cellKey(9999, 9999) });
    },
    burp: tryBurp,
    fart: tryFart,
    enemies() {
      return enemies;
    },
    enemyRoster() {
      return ENEMY_TPLS.map((tpl) => ({
        key: tpl.key,
        name: tpl.n,
        size: tpl.s,
        min: tpl.min,
        max: tpl.max,
        count: tpl.count,
        speed: tpl.spd,
        aggro: tpl.aggro,
        ranged: !!tpl.shells,
      }));
    },
    enemyStatus() {
      return enemies.map((enemy) => ({
        key: enemy.tpl.key,
        state: enemy.state,
        x: enemy.x,
        z: enemy.z,
        distance: Math.hypot(enemy.x - baby.x, enemy.z - baby.z),
        stunned: enemy.stun > 0,
      }));
    },
    spawnEnemy(key, dist) {
      const tpl = ENEMY_TPLS.find((t) => t.key === key);
      if (tpl && baby) return spawnEnemy(tpl, dist || 10);
      return null;
    },
    win() {
      if (baby && phase === "play") {
        baby.size = WIN_SIZE;
        eat({ id: -1, dyn: true, tpl: { e: "🍰", n: "Victory Crumb" }, s: 0.4, x: baby.x, z: baby.z, dead: false, g: null, cell: cellKey(9999, 9999) });
      }
    },
    save: saveGame,
    wipe: wipeSave,
    three: { scene, camera, renderer, hero: babyG },
    objects() {
      return objects;
    },
    road: { onRoad, onSidewalk, districtFor },
    step(n, dt) {
      const steps = n || 1;
      const d = dt || 1 / 60;
      for (let i = 0; i < steps; i++) if (phase === "play") update(d);
      renderer.render(scene, camera);
      return this.state;
    },
  };
  window.__THREE_GAME_DIAGNOSTICS__ = {
    renderer: renderer.info,
    get state() {
      return window.__BBB.state;
    },
  };

  // ---------- Boot ----------
  hudHigh.textContent = high.toLocaleString();
  const bootSave = loadSave();
  if (bootSave) {
    btnContinue.style.display = "";
    overlaySub.textContent = `A ${fmtSize(bootSave.size)} baby is mid-rampage in the city (${bootSave.noms} things eaten). Continue, or start over — same city, fresh appetite.`;
  }
  buildCity();
  if (bootSave) {
    const eatenSet = new Set(bootSave.eaten);
    for (const o of objects)
      if (!o.dyn && eatenSet.has(o.id)) {
        o.dead = true;
        gridRemove(o);
      }
    resetBaby(bootSave.size, bootSave.x, bootSave.z);
  } else {
    resetBaby();
  }
  spawnTick(true); // dress the menu backdrop with snacks
  refreshMenuList();
  updateHud(true);
  refreshActivation(true);
  requestAnimationFrame(frame);
})();
