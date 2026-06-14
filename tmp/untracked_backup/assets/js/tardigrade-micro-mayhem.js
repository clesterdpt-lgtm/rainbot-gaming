/* ============================================================
   Tardigrade: Micro Mayhem
   Low-poly 3D sandbox prototype for Rainbot Gaming.
   Plain Three.js, no build step.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "tardigrade-micro-mayhem";
  const MAP_AREA_SCALE = 5;
  const MAP_LINEAR_SCALE = Math.sqrt(MAP_AREA_SCALE);
  const SCENIC_RADIUS_SCALE = 1.45;
  const MAP_POPULATION_SCALE = 1.7;
  const mapCoord = (value) => value * MAP_LINEAR_SCALE;
  const mapRadius = (value) => value * MAP_LINEAR_SCALE;
  const scenicRadius = (value) => value * SCENIC_RADIUS_SCALE;
  const populationCount = (value) => Math.max(1, Math.round(value * MAP_POPULATION_SCALE));
  const WORLD_RADIUS = mapRadius(108);
  const PLAYER_RADIUS = 1.55;
  const GRAVITY = 22;
  const GROUND_Y = 0.42;
  const TERRAIN_VISUAL_OFFSET = 0.24;
  const CAMERA_YAW_SENSITIVITY = 0.0048;
  const CAMERA_PITCH_SENSITIVITY = 0.0032;
  const RING_TARGET = { x: mapCoord(-42), z: mapCoord(-34), radius: scenicRadius(5.8) };
  const SANDBOX_SECONDS = 300;
  const GOAL_TARGETS = {
    algae: 2,
    bacteria: 1,
    water: 1,
    ring: 1,
    chaos: 5200,
    time: SANDBOX_SECONDS,
  };
  const SANDBOX_ZONES = [
    {
      id: "forest",
      name: "Algae Forest",
      x: mapCoord(-62),
      z: mapCoord(45),
      radius: mapRadius(25),
      color: 0x6bff7d,
      material: "zoneForest",
    },
    {
      id: "flats",
      name: "Droplet Flats",
      x: mapCoord(62),
      z: mapCoord(38),
      radius: mapRadius(24),
      color: 0x37b8ff,
      material: "zoneFlats",
    },
    {
      id: "reef",
      name: "Bacteria Reef",
      x: mapCoord(57),
      z: mapCoord(-64),
      radius: mapRadius(24),
      color: 0xff9d2e,
      material: "zoneReef",
    },
    {
      id: "ridge",
      name: "Spore Ridge",
      x: mapCoord(-58),
      z: mapCoord(-62),
      radius: mapRadius(23),
      color: 0xa5ff4f,
      material: "zoneRidge",
    },
  ];
  const HIDDEN_LANDMARKS = [
    { id: "algae-crown", name: "Algae Crown", zone: "forest", x: mapCoord(-80), z: mapCoord(59), radius: scenicRadius(7.0), color: 0x6bff7d },
    { id: "glass-moonpool", name: "Glass Moonpool", zone: "flats", x: mapCoord(78), z: mapCoord(48), radius: scenicRadius(7.2), color: 0x37b8ff },
    { id: "orange-spire", name: "Orange Spire", zone: "reef", x: mapCoord(70), z: mapCoord(-74), radius: scenicRadius(7.0), color: 0xff9d2e },
    { id: "spore-crown", name: "Spore Crown", zone: "ridge", x: mapCoord(-76), z: mapCoord(-76), radius: scenicRadius(7.0), color: 0xa5ff4f },
  ];
  const TRAVERSAL_TOYS = [
    { id: "starter-ramp", type: "ramp", name: "Cellulose Ramp", x: -10, z: 23, yaw: -0.54, radius: 5.6, boost: 17, lift: 6.8 },
    { id: "forest-ramp", type: "ramp", name: "Algae Launch Ramp", x: mapCoord(-54), z: mapCoord(28), yaw: -0.9, radius: scenicRadius(6.8), boost: 22, lift: 9.8 },
    { id: "flats-pad", type: "jumpPad", name: "Droplet Spring", x: mapCoord(38), z: mapCoord(20), yaw: 0.2, radius: scenicRadius(5.7), boost: 7.2, lift: 18.6 },
    { id: "ridge-pad", type: "jumpPad", name: "Spore Popper", x: mapCoord(-42), z: mapCoord(-42), yaw: -0.38, radius: scenicRadius(5.7), boost: 8.6, lift: 19.8 },
    { id: "reef-geyser", type: "geyser", name: "Hydro Geyser", x: mapCoord(63), z: mapCoord(-50), yaw: 0.6, radius: scenicRadius(6.2), boost: 10.5, lift: 22.4 },
    { id: "forest-geyser", type: "geyser", name: "Bubble Vent", x: mapCoord(-71), z: mapCoord(20), yaw: -0.35, radius: scenicRadius(5.9), boost: 9.2, lift: 19.5 },
    { id: "spore-ridge", type: "ridge", name: "Spore Stair", x: mapCoord(-58), z: mapCoord(-62), yaw: -0.2, radius: scenicRadius(8.4), boost: 10.2, lift: 5.0 },
    { id: "reef-ridge", type: "ridge", name: "Reef Scramble", x: mapCoord(45), z: mapCoord(-71), yaw: 0.55, radius: scenicRadius(8.0), boost: 9.4, lift: 4.6 },
    { id: "crown-pad", type: "jumpPad", name: "Crown Popper", x: mapCoord(2), z: mapCoord(-70), yaw: 0.05, radius: scenicRadius(6.0), boost: 9.2, lift: 23.0 },
  ];
  const CREATURE_ROUTES = [
    { id: "rotifer-forest", type: "rotifer", centerX: mapCoord(-58), centerZ: mapCoord(34), radiusX: mapRadius(22), radiusZ: mapRadius(12), speed: 0.26, hover: 2.1, phase: 0.1 },
    { id: "rotifer-flats", type: "rotifer", centerX: mapCoord(58), centerZ: mapCoord(34), radiusX: mapRadius(20), radiusZ: mapRadius(11), speed: 0.22, hover: 2.4, phase: 2.4 },
    { id: "ciliate-canal", type: "ciliate", centerX: mapCoord(6), centerZ: mapCoord(-15), radiusX: mapRadius(42), radiusZ: mapRadius(20), speed: 0.18, hover: 4.4, phase: 1.1 },
    { id: "ciliate-ridge", type: "ciliate", centerX: mapCoord(-51), centerZ: mapCoord(-59), radiusX: mapRadius(18), radiusZ: mapRadius(10), speed: 0.25, hover: 3.2, phase: 4.1 },
    { id: "waterbearling", type: "waterbearling", centerX: mapCoord(40), centerZ: mapCoord(-58), radiusX: mapRadius(17), radiusZ: mapRadius(12), speed: 0.3, hover: 1.1, phase: 3.0 },
    { id: "spore-ray", type: "sporeRay", centerX: mapCoord(0), centerZ: mapCoord(50), radiusX: mapRadius(38), radiusZ: mapRadius(16), speed: 0.16, hover: 8.2, phase: 5.2 },
  ];
  const STARTER_PROPS = [
    ["algae", { x: -2.4, z: 4.4 }],
    ["algae", { x: 1.8, z: 3.1 }],
    ["algae", { x: -4.9, z: 1.0 }],
    ["bacteria", { x: -7.4, z: -4.8 }],
    ["droplet", { x: 6.8, z: -7.2 }],
    ["pollen", { x: -10.8, z: -11.6 }],
    ["pollen", { x: -37.5, z: -31.8 }],
  ];
  const SCRIPT_URL = document.currentScript
    ? document.currentScript.src
    : new URL("../assets/js/tardigrade-micro-mayhem.js", window.location.href).href;
  const ASSET_ROOT = new URL("../", SCRIPT_URL).href;
  const RAPIER_URL = new URL("vendor/rapier/rapier-0.19.3.mjs", ASSET_ROOT).href;
  const TEXTURE_ASSETS = {
    floor: new URL("img/tardigrade/micro-floor-speckles.svg", ASSET_ROOT).href,
    algae: new URL("img/tardigrade/algae-cell-tile.svg", ASSET_ROOT).href,
    membrane: new URL("img/tardigrade/membrane-strands.svg", ASSET_ROOT).href,
  };
  const THREE_CDNS = [
    "../assets/vendor/three/three-r128.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  ];

  const GOALS = [
    {
      title: "Eat some algae",
      text: "Scuttle into two green algae chunks. They heal hydration and teach movement.",
      target: GOAL_TARGETS.algae,
      progress: () => state.snacks,
      hint: "Follow the yellow target tag. Move with WASD, aim with the mouse, and munch two glowing algae.",
      mobileHint: "Left stick moves. Drag the dish to look. Follow the target tag and munch two glowing algae.",
    },
    {
      title: "Bash bacteria",
      text: "Use Shift to bonk the spiky orange bacteria in the dash lane.",
      target: GOAL_TARGETS.bacteria,
      progress: () => state.bacteriaBashed,
      hint: "Face the target bacteria, build a little speed, then tap Shift for a hydro bonk.",
      mobileHint: "Aim at the target bacteria, scuttle forward, then tap Bonk.",
    },
    {
      title: "Move water",
      text: "Shove one blue droplet far enough for the lab to notice.",
      target: GOAL_TARGETS.water,
      progress: () => state.waterMoved,
      hint: "Droplets are heavy. Hit one with a run-up or a dash to push it.",
      mobileHint: "Push the blue droplet with the stick. Bonk gives it extra shove.",
    },
    {
      title: "Feed the ring",
      text: "Push one golden pollen chunk into the glowing nutrient ring.",
      target: GOAL_TARGETS.ring,
      progress: () => state.ringFed,
      hint: "Follow the beacon to the ring, then bully a gold chunk into the glow.",
      mobileHint: "Follow the target tag. Push the gold pollen into the glowing ring.",
    },
    {
      title: "Become the incident",
      text: "Build enough chaos to earn a questionable microscope report.",
      target: GOAL_TARGETS.chaos,
      progress: () => Math.floor(state.chaos),
      hint: "Freestyle mayhem. Mix bonks, snacks, ring feeds, and zone visits to grow the combo.",
    },
    {
      title: "Rule the dish",
      text: "Keep the sandbox alive for five minutes of microscopic trouble.",
      target: GOAL_TARGETS.time,
      progress: () => Math.floor(state.sessionTime),
      hint: "Five-minute sandbox run. Chase mini-missions, hold combos, and stay hydrated.",
      kind: "time",
    },
  ];

  const MINI_MISSIONS = [
    { id: "algae", title: "Graze Algae", target: 8, progress: () => state.snacks },
    { id: "bacteria", title: "Bash Bacteria", target: 6, progress: () => state.bacteriaBashed },
    { id: "water", title: "Move Water", target: 3, progress: () => state.waterMoved },
    { id: "ring", title: "Feed Ring", target: 3, progress: () => state.ringFed },
    { id: "combo", title: "Chain 8x Combo", target: 8, progress: () => state.maxCombo },
    { id: "toys", title: "Use Traversal Toys", target: 5, progress: () => state.toysUsed.size },
    { id: "landmarks", title: "Find Landmarks", target: HIDDEN_LANDMARKS.length, progress: () => state.landmarksFound.size },
    { id: "zones", title: "Tour Zones", target: SANDBOX_ZONES.length, progress: () => state.zonesVisited.size },
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    primary: $("btn-primary"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    forward: $("btn-forward"),
    back: $("btn-back"),
    left: $("btn-left"),
    right: $("btn-right"),
    jump: $("btn-jump"),
    dash: $("btn-dash"),
    curl: $("btn-curl"),
    touchStick: $("touch-stick"),
    touchStickKnob: $("touch-stick-knob"),
    sound: $("btn-sound"),
    chaos: $("hud-chaos"),
    snacks: $("hud-snacks"),
    hydrate: $("hud-hydrate"),
    combo: $("hud-combo"),
    time: $("hud-time"),
    goal: $("hud-goal"),
    high: $("hud-high"),
    objectiveTitle: $("objective-title"),
    objectiveText: $("objective-text"),
    prompt: $("micro-prompt"),
    dashStatus: $("status-dash"),
    ringStatus: $("status-ring"),
    zoneStatus: $("status-zone"),
    goalCardTitle: $("goal-card-title"),
    goalCardText: $("goal-card-text"),
    goalCardProgress: $("goal-card-progress"),
    labLog: $("lab-log"),
    meterHydrate: $("meter-hydrate"),
    meterHydrateText: $("meter-hydrate-text"),
    meterDash: $("meter-dash"),
    meterDashText: $("meter-dash-text"),
    meterGoal: $("meter-goal"),
    meterGoalText: $("meter-goal-text"),
    arcadeScore: $("arcade-score"),
    arcadeDelta: $("arcade-delta"),
    arcadeLevel: $("arcade-level"),
    arcadeXp: $("arcade-xp"),
    arcadeXpText: $("arcade-xp-text"),
    arcadePhysics: $("arcade-physics"),
    playMeterHydrate: $("play-meter-hydrate"),
    playMeterHydrateText: $("play-meter-hydrate-text"),
    playMeterDash: $("play-meter-dash"),
    playMeterDashText: $("play-meter-dash-text"),
    playMeterGoal: $("play-meter-goal"),
    playMeterGoalText: $("play-meter-goal-text"),
    radar: $("micro-radar"),
    radarPlayer: $("radar-player"),
    radarRing: $("radar-ring"),
    radarGoal: $("radar-goal"),
    radarToy: $("radar-toy"),
    radarLandmark: $("radar-landmark"),
    radarDistance: $("radar-distance"),
    targetMarker: $("micro-target-marker"),
    targetMarkerTitle: $("target-marker-title"),
    targetMarkerDistance: $("target-marker-distance"),
    missionAlgae: $("mission-algae"),
    missionBacteria: $("mission-bacteria"),
    missionWater: $("mission-water"),
    missionRing: $("mission-ring"),
    missionCombo: $("mission-combo"),
    missionZones: $("mission-zones"),
    missionElements: document.querySelectorAll("[data-mission]"),
    callout: $("micro-callout"),
    calloutTitle: $("micro-callout-title"),
    calloutSub: $("micro-callout-sub"),
  };

  const api = typeof RB !== "undefined"
    ? RB
    : {
        toast: () => {},
        recordScore: () => false,
        getHighScore: () => 0,
      };

  const state = {
    ready: false,
    running: false,
    paused: false,
    gameOver: false,
    lastTime: 0,
    clock: 0,
    sessionTime: 0,
    chaos: 0,
    snacks: 0,
    bonks: 0,
    ringFed: 0,
    bacteriaBashed: 0,
    waterMoved: 0,
    propsBroken: 0,
    combo: 0,
    comboTimer: 0,
    lastComboAction: "",
    scoreDelta: 0,
    scoreDeltaTimer: 0,
    calloutTimer: 0,
    tipTimer: 0,
    hydrate: 100,
    level: 1,
    xp: 0,
    goalIndex: 0,
    promptTimer: 5,
    dashCooldown: 0,
    dashPulse: 0,
    maxCombo: 0,
    goalsCleared: 0,
    zoneId: "",
    zoneName: "Open Dish",
    zonesVisited: new Set(),
    miniComplete: new Set(),
    toysUsed: new Set(),
    landmarksFound: new Set(),
    qaToyIndex: 0,
    qaLandmarkIndex: 0,
    desiccationActive: false,
    curlHeld: false,
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    player: {
      x: 0,
      y: GROUND_Y,
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      targetYaw: 0,
      grounded: true,
      wobble: 0,
    },
    camera: {
      yaw: 0.45,
      pitch: 0.48,
      targetYaw: 0.45,
      targetPitch: 0.48,
      mouseLook: false,
    },
    input: {
      forward: 0,
      right: 0,
      virtualForward: 0,
      virtualRight: 0,
      keyboardCurl: false,
      virtualCurl: false,
    },
  };

  const world = {
    renderer: null,
    scene: null,
    camera: null,
    resizeObserver: null,
    materials: {},
    tardigrade: null,
    bodySegments: [],
    legs: [],
    feelers: [],
    props: [],
    creatures: [],
    drift: [],
    effects: [],
    atmosphere: [],
    zones: [],
    traversalToys: [],
    landmarks: [],
    plateauObstacles: [],
    ring: null,
    ringCore: null,
    guide: null,
    boundary: null,
    petri: null,
    terrain: null,
    physics: {
      RAPIER: null,
      world: null,
      ready: false,
      failed: false,
      accumulator: 0,
      fixedStep: 1 / 60,
      boundaryBodies: [],
    },
  };

  const audio = {
    ctx: null,
    enabled: true,
    unlocked: false,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(Math.random() * items.length)];
  const percent = (value) => Math.round(clamp(value, 0, 100)) + "%";
  const format = (value) => Math.floor(value).toLocaleString();
  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  function terrainBump(x, z, cx, cz, radius, height) {
    const distance = Math.hypot(x - cx, z - cz);
    if (distance >= radius) return 0;
    const t = 1 - distance / radius;
    return height * t * t * (3 - 2 * t);
  }

  function terrainOffsetAt(x, z) {
    const distance = Math.hypot(x, z);
    const edgeFade = clamp((WORLD_RADIUS - 5 - distance) / mapRadius(24), 0, 1);
    const rolling =
      Math.sin(x * 0.058) * 0.54 +
      Math.cos(z * 0.052) * 0.46 +
      Math.sin((x + z) * 0.031) * 0.58 +
      Math.cos((x - z) * 0.026) * 0.36;
    const features =
      terrainBump(x, z, mapCoord(-64), mapCoord(47), mapRadius(36), 3.95) +
      terrainBump(x, z, mapCoord(64), mapCoord(38), mapRadius(34), 3.25) +
      terrainBump(x, z, mapCoord(58), mapCoord(-64), mapRadius(35), 4.25) +
      terrainBump(x, z, mapCoord(-58), mapCoord(-62), mapRadius(32), 4.85) +
      terrainBump(x, z, mapCoord(2), mapCoord(-72), mapRadius(24), 3.65) +
      terrainBump(x, z, mapCoord(-6), mapCoord(46), mapRadius(30), 1.65) -
      terrainBump(x, z, 3, 4, 28, 0.42) -
      terrainBump(x, z, mapCoord(18), mapCoord(-18), mapRadius(44), 0.78) -
      terrainBump(x, z, mapCoord(31), mapCoord(56), mapRadius(22), 0.64);
    return clamp((rolling * 0.72 + features) * edgeFade, -1.15, 6.2);
  }

  function groundYAt(x, z) {
    return GROUND_Y + terrainOffsetAt(x, z);
  }

  function terrainVisualYAt(x, z) {
    return groundYAt(x, z) - TERRAIN_VISUAL_OFFSET;
  }

  function toPlateauLocal(obstacle, x, z) {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const cos = Math.cos(obstacle.rotation);
    const sin = Math.sin(obstacle.rotation);
    return {
      x: dx * cos + dz * sin,
      z: -dx * sin + dz * cos,
      cos,
      sin,
    };
  }

  function fromPlateauLocal(localX, localZ, obstacle) {
    const cos = Math.cos(obstacle.rotation);
    const sin = Math.sin(obstacle.rotation);
    return {
      x: obstacle.x + localX * cos - localZ * sin,
      z: obstacle.z + localX * sin + localZ * cos,
    };
  }

  function registerPlateauObstacle(x, z, radius, scaleZ, rotation, kind) {
    world.plateauObstacles.push({
      x,
      z,
      radiusX: radius * 0.94,
      radiusZ: radius * scaleZ * 0.94,
      rotation,
      kind,
    });
  }

  function pointOverlapsPlateau(x, z, margin = 0) {
    return world.plateauObstacles.some((obstacle) => {
      const local = toPlateauLocal(obstacle, x, z);
      const radiusX = obstacle.radiusX + margin;
      const radiusZ = obstacle.radiusZ + margin;
      return (local.x * local.x) / (radiusX * radiusX) + (local.z * local.z) / (radiusZ * radiusZ) < 1;
    });
  }

  function resolvePlateauCollisions(previousX, previousZ) {
    const player = state.player;
    world.plateauObstacles.forEach((obstacle) => {
      let local = toPlateauLocal(obstacle, player.x, player.z);
      const radiusX = obstacle.radiusX + PLAYER_RADIUS * 0.9;
      const radiusZ = obstacle.radiusZ + PLAYER_RADIUS * 0.9;
      let amount = (local.x * local.x) / (radiusX * radiusX) + (local.z * local.z) / (radiusZ * radiusZ);
      if (amount >= 1) return;

      if (amount < 0.0001) {
        const previousLocal = toPlateauLocal(obstacle, previousX, previousZ);
        local.x = Math.abs(previousLocal.x) + Math.abs(previousLocal.z) > 0.001 ? previousLocal.x : 1;
        local.z = Math.abs(previousLocal.x) + Math.abs(previousLocal.z) > 0.001 ? previousLocal.z : 0;
        amount = (local.x * local.x) / (radiusX * radiusX) + (local.z * local.z) / (radiusZ * radiusZ);
      }

      const scale = 1 / Math.sqrt(Math.max(0.0001, amount));
      const targetLocalX = local.x * scale;
      const targetLocalZ = local.z * scale;
      const targetWorld = fromPlateauLocal(targetLocalX, targetLocalZ, obstacle);
      const pushX = targetWorld.x - player.x;
      const pushZ = targetWorld.z - player.z;
      const pushLength = Math.hypot(pushX, pushZ);
      if (pushLength <= 0.0001) return;

      const normalX = pushX / pushLength;
      const normalZ = pushZ / pushLength;
      player.x = targetWorld.x + normalX * 0.045;
      player.z = targetWorld.z + normalZ * 0.045;
      const incoming = player.vx * normalX + player.vz * normalZ;
      if (incoming < 0) {
        player.vx -= incoming * normalX * 1.08;
        player.vz -= incoming * normalZ * 1.08;
      }
      player.wobble = Math.max(player.wobble, 0.24);
    });
  }

  function bootThree() {
    initThree().catch((error) => {
      console.error(error);
      fatal("The microscope failed to boot. Reload to reseat the slide.");
    });
  }

  function loadThree(index = 0) {
    if (window.THREE) {
      bootThree();
      return;
    }
    if (index >= THREE_CDNS.length) {
      fatal("Three.js could not load. The microscope stayed dark.");
      return;
    }
    const script = document.createElement("script");
    script.src = THREE_CDNS[index];
    script.onload = () => (window.THREE ? bootThree() : loadThree(index + 1));
    script.onerror = () => loadThree(index + 1);
    document.head.appendChild(script);
  }

  function fatal(message) {
    showOverlay("MICROSCOPE OFFLINE", message, "Retry");
    el.primary.onclick = () => location.reload();
  }

  async function initThree() {
    const THREE = window.THREE;
    state.ready = true;

    world.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    world.renderer.setClearColor(0x057eb7, 1);
    world.renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) {
      world.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      world.renderer.toneMappingExposure = 0.62;
    }
    world.renderer.shadowMap.enabled = true;
    world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    world.scene = new THREE.Scene();
    world.scene.fog = new THREE.FogExp2(0x078ec8, 0.00155);
    world.camera = new THREE.PerspectiveCamera(64, 960 / 620, 0.1, Math.max(430, WORLD_RADIUS * 2.35));

    buildMaterials();
    applyAssetTextures();
    buildScene();
    await initPhysics();
    bindInputs();
    resetGame(false);
    resize();
    updateHUD();

    world.resizeObserver = new ResizeObserver(resize);
    world.resizeObserver.observe(canvas.parentElement || canvas);
    window.addEventListener("resize", resize);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      showOverlay("MICROSCOPE LOST FOCUS", "The WebGL context dropped. Reload to restore the dish.", "Reload");
      el.primary.onclick = () => location.reload();
    });
    requestAnimationFrame(loop);
  }

  function buildMaterials() {
    const THREE = window.THREE;
    const mat = (color, options = {}) => new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.72,
      metalness: options.metalness ?? 0.06,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0.45,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite ?? true,
      flatShading: true,
    });
    const basic = (color, options = {}) => new THREE.MeshBasicMaterial({
      color,
      transparent: options.transparent ?? true,
      opacity: options.opacity ?? 0.55,
      depthWrite: options.depthWrite ?? false,
      fog: options.fog ?? true,
      side: options.side ?? THREE.DoubleSide,
    });

    world.materials = {
      dish: mat(0x63bf1f, { roughness: 0.9, metalness: 0.01, emissive: 0x092402, emissiveIntensity: 0.05 }),
      dishDark: mat(0x046f9d, { roughness: 0.74, metalness: 0.02, emissive: 0x011e31, emissiveIntensity: 0.14 }),
      cliff: mat(0x65553e, { roughness: 0.94, metalness: 0.02, emissive: 0x0e0903, emissiveIntensity: 0.03 }),
      grassLight: mat(0x8ed927, { roughness: 0.86, metalness: 0.01, emissive: 0x123b00, emissiveIntensity: 0.08 }),
      terrain: new THREE.MeshStandardMaterial({
        color: 0x5fbd1f,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.01,
        emissive: 0x041301,
        emissiveIntensity: 0.04,
        fog: true,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
      water: mat(0x28b9ee, { roughness: 0.34, metalness: 0.02, emissive: 0x043957, emissiveIntensity: 0.32, transparent: true, opacity: 0.56, depthWrite: false }),
      ring: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.8 }),
      ringCore: mat(0x6bff7d, { emissive: 0x164f20, transparent: true, opacity: 0.48 }),
      guide: mat(0xfff05a, { emissive: 0xff5c9f, emissiveIntensity: 1.1, transparent: true, opacity: 0.78 }),
      guideCore: mat(0xd883ff, { emissive: 0x8c1aff, emissiveIntensity: 1.25, transparent: true, opacity: 0.62 }),
      ramp: mat(0xd5b267, { roughness: 0.8, metalness: 0.02, emissive: 0x4f3509, emissiveIntensity: 0.18 }),
      rampStripe: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.6 }),
      jumpPad: mat(0x37c8ff, { emissive: 0x0b5d8f, emissiveIntensity: 0.7 }),
      jumpPadCore: mat(0xd883ff, { emissive: 0x7a24b8, emissiveIntensity: 0.92 }),
      geyser: mat(0xb9f4ff, { emissive: 0x15769b, emissiveIntensity: 0.72, transparent: true, opacity: 0.62, depthWrite: false }),
      ridgeStep: mat(0x8ec34a, { roughness: 0.86, metalness: 0.02, emissive: 0x243d08, emissiveIntensity: 0.22 }),
      landmark: mat(0xf8fbff, { emissive: 0x4b9bd9, emissiveIntensity: 0.6 }),
      landmarkGlow: mat(0xffd43b, { emissive: 0xff9d2e, emissiveIntensity: 1.1, transparent: true, opacity: 0.72 }),
      zoneForest: mat(0x5fbe27, { emissive: 0x1b5a0b, emissiveIntensity: 0.32, transparent: true, opacity: 0.58 }),
      zoneFlats: mat(0x36c8f4, { emissive: 0x0a668d, emissiveIntensity: 0.38, transparent: true, opacity: 0.52 }),
      zoneReef: mat(0xffa83d, { emissive: 0x803005, emissiveIntensity: 0.36, transparent: true, opacity: 0.54 }),
      zoneRidge: mat(0xb9e34a, { emissive: 0x425608, emissiveIntensity: 0.32, transparent: true, opacity: 0.52 }),
      tardigradeA: mat(0xcaa36f, { roughness: 0.64 }),
      tardigradeB: mat(0xa8784d, { roughness: 0.7 }),
      tardigradeBelly: mat(0xe6c89d, { roughness: 0.68 }),
      tardigradePlate: mat(0xd9b983, { roughness: 0.58, emissive: 0x261704, emissiveIntensity: 0.08 }),
      tardigradeStripe: mat(0x8c603e, { roughness: 0.74, emissive: 0x140905, emissiveIntensity: 0.04 }),
      tardigradeMuzzle: mat(0xe8c592, { roughness: 0.66, emissive: 0x261704, emissiveIntensity: 0.05 }),
      oralRing: mat(0xb98658, { roughness: 0.72, emissive: 0x241004, emissiveIntensity: 0.08 }),
      mouthDark: mat(0x432312, { roughness: 0.68, emissive: 0x150704, emissiveIntensity: 0.08 }),
      claw: mat(0xf7fbff, { roughness: 0.52 }),
      eye: mat(0x05070d, { roughness: 0.4 }),
      eyeGlint: mat(0xf8fbff, { roughness: 0.25, emissive: 0x90eaff, emissiveIntensity: 0.45 }),
      algae: mat(0x5bd924, { emissive: 0x123e08, emissiveIntensity: 0.38 }),
      pollen: mat(0xffd43b, { emissive: 0x4e3700, emissiveIntensity: 0.58 }),
      cell: mat(0xff5c9f, { emissive: 0x56152f, emissiveIntensity: 0.45 }),
      bubble: mat(0xc8f8ff, { emissive: 0x075f86, emissiveIntensity: 0.42, transparent: true, opacity: 0.38, depthWrite: false }),
      crystal: mat(0x9f8cff, { emissive: 0x2c186b, emissiveIntensity: 0.48 }),
      bacteria: mat(0xff9d2e, { emissive: 0x642600, emissiveIntensity: 0.72 }),
      bacteriaDark: mat(0x8f3a1f, { roughness: 0.78 }),
      droplet: mat(0x37c8ff, { emissive: 0x0b5d8f, emissiveIntensity: 0.5, transparent: true, opacity: 0.72, depthWrite: false }),
      capsulePink: mat(0xff5c9f, { emissive: 0x5c1433, emissiveIntensity: 0.55 }),
      capsuleBlue: mat(0x53ead1, { emissive: 0x0f4c44, emissiveIntensity: 0.45 }),
      enzyme: mat(0xd883ff, { emissive: 0x4d1978, emissiveIntensity: 0.64 }),
      platelet: mat(0xff6b5a, { emissive: 0x4f150f, emissiveIntensity: 0.42 }),
      spore: mat(0xa5ff4f, { emissive: 0x285609, emissiveIntensity: 0.58 }),
      shard: mat(0xf8fbff, { emissive: 0x6a4a10, emissiveIntensity: 0.32 }),
      fiberA: mat(0x2f9710, { emissive: 0x0b2d03, emissiveIntensity: 0.24 }),
      fiberB: mat(0xf136a8, { emissive: 0x4c0d31, emissiveIntensity: 0.25 }),
      coralPink: mat(0xf035ad, { emissive: 0x5c0d3d, emissiveIntensity: 0.3 }),
      coralPurple: mat(0x9465ff, { emissive: 0x291268, emissiveIntensity: 0.26 }),
      coralGreen: mat(0x61bf1f, { emissive: 0x143c05, emissiveIntensity: 0.22 }),
      coralOrange: mat(0xff9a2f, { emissive: 0x6b2600, emissiveIntensity: 0.3 }),
      coralYellow: mat(0xffe34d, { emissive: 0x5c4900, emissiveIntensity: 0.34 }),
      coralTeal: mat(0x27d9b3, { emissive: 0x064c41, emissiveIntensity: 0.3 }),
      flowerPetal: mat(0xff8fd5, { emissive: 0x561236, emissiveIntensity: 0.22 }),
      shadow: mat(0x041014, { roughness: 1 }),
      white: mat(0xf7fbff, { roughness: 0.5 }),
      caustic: basic(0xf1ffb7, { opacity: 0.12, fog: false }),
      mist: basic(0xbdf4ff, { opacity: 0.12, fog: false }),
      backdropBlue: mat(0x1779b9, { roughness: 0.86, metalness: 0.01, emissive: 0x06395a, emissiveIntensity: 0.18 }),
      backdropGreen: mat(0x4da52c, { roughness: 0.88, metalness: 0.01, emissive: 0x143807, emissiveIntensity: 0.14 }),
      backdropPurple: mat(0x8d78d9, { roughness: 0.84, metalness: 0.02, emissive: 0x26184f, emissiveIntensity: 0.18 }),
      creatureA: mat(0xffd19a, { roughness: 0.6, emissive: 0x4d2408, emissiveIntensity: 0.16 }),
      creatureB: mat(0x53ead1, { roughness: 0.5, emissive: 0x0b4d45, emissiveIntensity: 0.36 }),
      creatureC: mat(0xd883ff, { roughness: 0.55, emissive: 0x411260, emissiveIntensity: 0.32 }),
      creatureFin: mat(0xf8fbff, { roughness: 0.36, transparent: true, opacity: 0.66, depthWrite: false }),
    };
  }

  function applyAssetTextures() {
    const THREE = window.THREE;
    const loader = new THREE.TextureLoader();
    const applyTexture = (materialName, url, repeatX, repeatY) => {
      const material = world.materials[materialName];
      if (!material) return;
      loader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeatX, repeatY);
          texture.encoding = THREE.sRGBEncoding;
          material.map = texture;
          material.needsUpdate = true;
        },
        undefined,
        () => {}
      );
    };

    applyTexture("dish", TEXTURE_ASSETS.floor, 8, 8);
    applyTexture("algae", TEXTURE_ASSETS.algae, 1.8, 1.8);
    applyTexture("fiberA", TEXTURE_ASSETS.membrane, 2, 6);
  }

  async function initPhysics() {
    if (world.physics.ready || world.physics.failed) return;
    try {
      const rapierModule = await import(RAPIER_URL);
      const RAPIER = rapierModule.default && rapierModule.default.World ? rapierModule.default : rapierModule;
      await (RAPIER.init ? RAPIER.init() : rapierModule.init());
      const physicsWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
      physicsWorld.timestep = world.physics.fixedStep;
      world.physics.RAPIER = RAPIER;
      world.physics.world = physicsWorld;
      world.physics.ready = true;
      buildPhysicsBoundary();
      updatePhysicsStatus();
    } catch (error) {
      console.warn("Rapier physics unavailable; using fallback prop motion.", error);
      world.physics.failed = true;
      updatePhysicsStatus();
    }
  }

  function updatePhysicsStatus() {
    if (!el.arcadePhysics) return;
    el.arcadePhysics.textContent = world.physics.ready ? "Rapier physics" : "Fallback physics";
  }

  function buildPhysicsBoundary() {
    if (!world.physics.ready || world.physics.boundaryBodies.length) return;
    const RAPIER = world.physics.RAPIER;
    const bodyCount = Math.ceil(88 * MAP_LINEAR_SCALE);
    const radius = WORLD_RADIUS - 0.25;
    const tangentHalf = (Math.PI * radius * 2) / bodyCount / 2;
    for (let i = 0; i < bodyCount; i++) {
      const angle = (i / bodyCount) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const yaw = -angle;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, 0, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      const body = world.physics.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(tangentHalf, 1.2, 0.52)
        .setRestitution(0.86)
        .setFriction(0.52);
      world.physics.world.createCollider(colliderDesc, body);
      world.physics.boundaryBodies.push(body);
    }
  }

  function attachPhysicsBody(prop, config) {
    if (!world.physics.ready) return;
    const RAPIER = world.physics.RAPIER;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(prop.position.x, 0, prop.position.z)
      .setGravityScale(0)
      .setLinearDamping(config.damping ?? 2.2)
      .setAngularDamping(config.angularDamping ?? 2.6)
      .setCanSleep(false)
      .enabledTranslations(true, false, true)
      .enabledRotations(false, true, false);
    const body = world.physics.world.createRigidBody(bodyDesc);
    let colliderDesc;
    if (config.collider === "cuboid") {
      colliderDesc = RAPIER.ColliderDesc.cuboid(config.radius * 0.95, 0.62, config.radius * 0.42);
    } else if (config.collider === "capsule") {
      colliderDesc = RAPIER.ColliderDesc.capsule(config.radius * 0.65, config.radius * 0.45);
    } else {
      colliderDesc = RAPIER.ColliderDesc.ball(config.physicsRadius || config.radius * 0.82);
    }
    colliderDesc = colliderDesc
      .setMass(config.mass || 1)
      .setRestitution(config.restitution ?? 0.58)
      .setFriction(config.friction ?? 0.62);
    if (config.collect) colliderDesc.setSensor(true);
    prop.userData.body = body;
    prop.userData.collider = world.physics.world.createCollider(colliderDesc, body);
  }

  function removePhysicsBody(prop) {
    if (!world.physics.ready || !prop || !prop.userData || !prop.userData.body) return;
    world.physics.world.removeRigidBody(prop.userData.body);
    prop.userData.body = null;
    prop.userData.collider = null;
  }

  function stepPhysics(dt) {
    if (!world.physics.ready) return;
    world.physics.accumulator += dt;
    let steps = 0;
    while (world.physics.accumulator >= world.physics.fixedStep && steps < 4) {
      world.physics.world.step();
      world.physics.accumulator -= world.physics.fixedStep;
      steps += 1;
    }
    if (steps >= 4) world.physics.accumulator = 0;
  }

  function buildScene() {
    const THREE = window.THREE;
    const scene = world.scene;
    scene.background = makeSkyTexture();

    scene.add(new THREE.HemisphereLight(0xd8fcff, 0x245f20, 0.78));
    scene.add(new THREE.AmbientLight(0x73eaff, 0.08));

    const key = new THREE.DirectionalLight(0xffe1a0, 1.05);
    key.position.set(-28, 46, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = Math.max(180, WORLD_RADIUS * 1.4);
    key.shadow.camera.left = -WORLD_RADIUS * 0.62;
    key.shadow.camera.right = WORLD_RADIUS * 0.62;
    key.shadow.camera.top = WORLD_RADIUS * 0.62;
    key.shadow.camera.bottom = -WORLD_RADIUS * 0.62;
    scene.add(key);

    const rim = new THREE.PointLight(0xff8cd8, 1.05, 82);
    rim.position.set(24, 13, -25);
    scene.add(rim);

    const cool = new THREE.PointLight(0x58e5ff, 1.05, 78);
    cool.position.set(-30, 14, 24);
    scene.add(cool);

    const gardenFill = new THREE.PointLight(0xa5ff4f, 0.62, 70);
    gardenFill.position.set(-10, 9, 12);
    scene.add(gardenFill);

    buildDish();
    buildScenicDepth();
    buildEnvironment();
    buildSandboxZones();
    buildTraversalToys();
    buildHiddenLandmarks();
    buildRoamingCreatures();
    world.ring = makeNutrientRing();
    scene.add(world.ring);
    world.tardigrade = makeTardigrade();
    scene.add(world.tardigrade);
    world.guide = makeGuideBeacon();
    scene.add(world.guide);
  }

  function makeSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 96;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#0069a9");
    gradient.addColorStop(0.34, "#0baee0");
    gradient.addColorStop(0.72, "#48d8f7");
    gradient.addColorStop(1, "#b7fbff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    const reefGradient = ctx.createLinearGradient(0, sky.height * 0.45, 0, sky.height);
    reefGradient.addColorStop(0, "rgba(0,70,104,0)");
    reefGradient.addColorStop(0.62, "rgba(5,91,110,0.32)");
    reefGradient.addColorStop(1, "rgba(3,78,62,0.46)");
    ctx.fillStyle = reefGradient;
    ctx.beginPath();
    ctx.moveTo(0, sky.height);
    for (let i = 0; i <= 14; i++) {
      const x = (i / 14) * sky.width;
      const y = sky.height * (0.58 + Math.sin(i * 1.37) * 0.06 + (i % 3) * 0.025);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(sky.width, sky.height);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const x = 4 + i * 15;
      const shaft = ctx.createLinearGradient(x, 0, x + 16, sky.height);
      shaft.addColorStop(0, "rgba(255,255,220,0.35)");
      shaft.addColorStop(0.58, "rgba(190,255,246,0.11)");
      shaft.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 13, 0);
      ctx.lineTo(x + 2, sky.height);
      ctx.lineTo(x - 18, sky.height);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 150; i++) {
      const size = Math.random() * 2.1 + 0.35;
      ctx.fillStyle = i % 5 === 0 ? "rgba(255,255,255,0.62)" : "rgba(198,252,255,0.38)";
      ctx.beginPath();
      ctx.arc(Math.random() * sky.width, Math.random() * sky.height * 0.82, size, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function buildDish() {
    const THREE = window.THREE;
    const waterBase = new THREE.Mesh(
      new THREE.CylinderGeometry(WORLD_RADIUS, WORLD_RADIUS, 0.36, 72),
      world.materials.dishDark
    );
    waterBase.position.y = -1.12;
    waterBase.receiveShadow = true;
    world.scene.add(waterBase);
    world.petri = waterBase;

    world.plateauObstacles = [];
    makeRollingTerrain();
    makeTerrainIsland(mapCoord(-68), mapCoord(52), scenicRadius(16.8), 2.5, 0.68, world.materials.grassLight);
    makeTerrainIsland(mapCoord(66), mapCoord(-68), scenicRadius(17.5), 2.2, 0.72, world.materials.dish);
    makeTerrainIsland(mapCoord(-62), mapCoord(-66), scenicRadius(14.6), 2.65, 0.78, world.materials.grassLight);
    makeTerrainIsland(mapCoord(66), mapCoord(42), scenicRadius(15.8), 1.95, 0.7, world.materials.dish);
    makeTerrainIsland(mapCoord(2), mapCoord(-76), scenicRadius(14.4), 1.9, 0.66, world.materials.dish);
    makeVerticalMesa(mapCoord(-92), mapCoord(10), scenicRadius(13), 11.5, 0.58, world.materials.backdropPurple);
    makeVerticalMesa(mapCoord(92), mapCoord(-14), scenicRadius(15), 13.2, 0.64, world.materials.backdropBlue);
    makeVerticalMesa(mapCoord(-12), mapCoord(88), scenicRadius(18), 12.6, 0.52, world.materials.backdropGreen);

    [
      [mapCoord(-18), mapCoord(22), scenicRadius(7.6), 0.42, 0.15],
      [mapCoord(25), mapCoord(18), scenicRadius(7.2), 0.5, -0.55],
      [mapCoord(-22), mapCoord(-8), scenicRadius(6.2), 0.38, 0.8],
      [mapCoord(43), mapCoord(-20), scenicRadius(8.4), 0.5, 0.4],
      [mapCoord(-62), mapCoord(11), scenicRadius(7.2), 0.52, -0.2],
      [mapCoord(6), mapCoord(-43), scenicRadius(8.4), 0.46, 0.7],
      [mapCoord(74), mapCoord(42), scenicRadius(10.6), 0.42, 0.1],
      [mapCoord(-78), mapCoord(-43), scenicRadius(9.2), 0.48, -0.35],
      [mapCoord(4), mapCoord(60), scenicRadius(10.2), 0.5, 0.55],
      [mapCoord(66), mapCoord(-72), scenicRadius(7.4), 0.44, -0.85],
      [mapCoord(-12), mapCoord(-76), scenicRadius(9.8), 0.4, 0.2],
    ].forEach(([x, z, radius, scaleZ, rotation]) => makeWaterPatch(x, z, radius, scaleZ, rotation));

    const boundary = new THREE.Mesh(
      new THREE.TorusGeometry(WORLD_RADIUS, 0.34, 10, 96),
      world.materials.water
    );
    boundary.rotation.x = Math.PI / 2;
    boundary.position.y = 0.08;
    boundary.receiveShadow = true;
    world.scene.add(boundary);
    world.boundary = boundary;

    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(WORLD_RADIUS - 5.2, 0.035, 6, 96),
      world.materials.ring
    );
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.05;
    world.scene.add(inner);
  }

  function makeRollingTerrain() {
    const THREE = window.THREE;
    const rings = 42;
    const segments = 144;
    const positions = [];
    const colors = [];
    const indices = [];
    for (let ring = 0; ring <= rings; ring++) {
      const radius = (ring / rings) * (WORLD_RADIUS - 4.8);
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const y = terrainVisualYAt(x, z);
        positions.push(x, y, z);
        const color = terrainColorAt(x, z);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = ring * (segments + 1) + segment;
        const b = a + 1;
        const c = (ring + 1) * (segments + 1) + segment;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(geometry, world.materials.terrain);
    terrain.receiveShadow = true;
    world.scene.add(terrain);
    world.terrain = terrain;
    return terrain;
  }

  function terrainColorAt(x, z) {
    const THREE = window.THREE;
    const elevation = terrainOffsetAt(x, z);
    const color = new THREE.Color(elevation > 1.2 ? 0x82d22a : 0x55b61f);
    if (elevation < -0.18) color.set(0x31a65a);
    SANDBOX_ZONES.forEach((zone) => {
      const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.05), 0, 1);
      if (influence <= 0) return;
      const zoneColor = new THREE.Color(zone.color);
      color.lerp(zoneColor, influence * 0.24);
    });
    const edge = Math.hypot(x, z) / WORLD_RADIUS;
    if (edge > 0.82) color.lerp(new THREE.Color(0x257f31), (edge - 0.82) / 0.18);
    return color;
  }

  function makeTerrainIsland(x, z, radius, height, scaleZ, topMaterial) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const sides = Math.max(10, Math.round(radius * 0.9));
    const cliff = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.98, radius * 0.82, height, sides),
      world.materials.cliff
    );
    cliff.position.y = 0.08 - height / 2;
    cliff.receiveShadow = true;
    group.add(cliff);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.94, 0.16, sides),
      topMaterial
    );
    cap.position.y = 0.12;
    cap.receiveShadow = true;
    group.add(cap);

    const rotation = rand(-0.18, 0.18);
    group.position.set(x, terrainOffsetAt(x, z), z);
    group.scale.z = scaleZ;
    group.rotation.y = rotation;
    registerPlateauObstacle(x, z, radius, scaleZ, rotation, "island");
    world.scene.add(group);
    return group;
  }

  function makeVerticalMesa(x, z, radius, height, scaleZ, topMaterial) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const sides = Math.max(10, Math.round(radius * 0.8));
    const cliff = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.72, radius, height, sides),
      world.materials.cliff
    );
    cliff.position.y = height / 2;
    cliff.receiveShadow = true;
    group.add(cliff);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.98, radius * 0.86, 0.32, sides),
      topMaterial
    );
    cap.position.y = height + 0.16;
    cap.receiveShadow = true;
    group.add(cap);

    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2 + rand(-0.18, 0.18);
      const distance = rand(radius * 0.28, radius * 0.76);
      const spireHeight = rand(2.6, 6.8);
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(rand(0.28, 0.62), spireHeight, 5),
        pick([world.materials.coralGreen, world.materials.coralTeal, world.materials.coralPink, world.materials.spore])
      );
      spire.position.set(Math.cos(angle) * distance, height + 0.42 + spireHeight / 2, Math.sin(angle) * distance * scaleZ);
      spire.rotation.x = rand(-0.14, 0.14);
      spire.rotation.z = rand(-0.14, 0.14);
      group.add(spire);
    }

    const rotation = rand(-0.16, 0.16);
    group.position.set(x, terrainOffsetAt(x, z) - 0.15, z);
    group.scale.z = scaleZ;
    group.rotation.y = rotation;
    registerPlateauObstacle(x, z, radius, scaleZ, rotation, "mesa");
    world.scene.add(group);
    return group;
  }

  function makeWaterPatch(x, z, radius, scaleZ, rotation) {
    const THREE = window.THREE;
    const patch = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.94, 0.035, 18),
      world.materials.water
    );
    patch.position.set(x, terrainVisualYAt(x, z) + 0.08, z);
    patch.scale.z = scaleZ;
    patch.rotation.y = rotation;
    world.scene.add(patch);
    return patch;
  }

  function buildScenicDepth() {
    const shelves = [
      [mapCoord(-86), mapCoord(-78), scenicRadius(17.5), 4.8, 0.64, world.materials.backdropGreen],
      [mapCoord(-34), mapCoord(-92), scenicRadius(20.2), 5.4, 0.52, world.materials.dish],
      [mapCoord(25), mapCoord(-94), scenicRadius(18.4), 4.8, 0.58, world.materials.grassLight],
      [mapCoord(86), mapCoord(-70), scenicRadius(16.2), 4.4, 0.7, world.materials.backdropGreen],
      [mapCoord(-94), mapCoord(-26), scenicRadius(13.6), 4.1, 0.66, world.materials.backdropPurple],
      [mapCoord(94), mapCoord(18), scenicRadius(14.8), 4.5, 0.72, world.materials.backdropBlue],
      [mapCoord(-74), mapCoord(84), scenicRadius(17.2), 4.6, 0.58, world.materials.backdropGreen],
      [mapCoord(75), mapCoord(76), scenicRadius(18.6), 5.0, 0.62, world.materials.backdropBlue],
    ];
    shelves.forEach(([x, z, radius, height, scaleZ, material]) => {
      makeBackdropShelf(x, z, radius, height, scaleZ, material);
    });

    [
      [mapCoord(-88), mapCoord(58), 18.4, 1.04, world.materials.coralPink],
      [mapCoord(-94), mapCoord(7), 16.8, 0.82, world.materials.coralPurple],
      [mapCoord(-78), mapCoord(-86), 20.8, 0.92, world.materials.coralTeal],
      [mapCoord(-45), mapCoord(-91), 22.4, 1.0, world.materials.coralGreen],
      [mapCoord(3), mapCoord(-98), 19.6, 0.92, world.materials.coralOrange],
      [mapCoord(48), mapCoord(-89), 18.8, 0.86, world.materials.coralPink],
      [mapCoord(90), mapCoord(-52), 21.4, 0.92, world.materials.coralYellow],
      [mapCoord(96), mapCoord(39), 17.6, 0.82, world.materials.coralTeal],
      [mapCoord(-8), mapCoord(92), 20.2, 0.9, world.materials.coralGreen],
    ].forEach(([x, z, height, radius, material]) => makeTallCoralPillar(x, z, height, radius, material));

    [
      [mapCoord(-78), mapCoord(-73), scenicRadius(8.6), 16, [world.materials.coralTeal, world.materials.coralPink, world.materials.coralGreen]],
      [mapCoord(-16), mapCoord(-88), scenicRadius(9.4), 18, [world.materials.coralYellow, world.materials.coralGreen, world.materials.algae]],
      [mapCoord(55), mapCoord(-82), scenicRadius(8.8), 16, [world.materials.coralOrange, world.materials.coralPink, world.materials.bacteria]],
      [mapCoord(82), mapCoord(43), scenicRadius(7.6), 15, [world.materials.coralPurple, world.materials.coralTeal, world.materials.crystal]],
      [mapCoord(-82), mapCoord(62), scenicRadius(8.0), 14, [world.materials.coralGreen, world.materials.algae, world.materials.spore]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));

    for (let i = 0; i < populationCount(18); i++) {
      const pos = randomPoint(WORLD_RADIUS - 8);
      makeCausticGlint(pos.x, pos.z, rand(1.0, 3.1), rand(0, Math.PI));
    }

    for (let i = 0; i < populationCount(26); i++) {
      const pos = randomPoint(WORLD_RADIUS - 4);
      makeSuspendedDroplet(pos.x, pos.z, rand(0.55, 1.65), rand(7.5, 32));
    }

    [
      [mapCoord(-70), mapCoord(-60), 6.4, 44, -0.25],
      [mapCoord(-28), mapCoord(-70), 5.2, 48, 0.12],
      [mapCoord(10), mapCoord(-68), 6.8, 52, -0.05],
      [mapCoord(52), mapCoord(-55), 5.8, 46, 0.25],
      [mapCoord(74), mapCoord(-24), 4.8, 42, -0.2],
      [mapCoord(-78), mapCoord(23), 4.5, 40, 0.3],
    ].forEach(([x, z, width, height, yaw]) => makeLightShaft(x, z, width, height, yaw));
  }

  function makeBackdropShelf(x, z, radius, height, scaleZ, topMaterial) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const sides = Math.max(8, Math.round(radius * 0.7));
    const cliff = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.92, radius * 0.68, height, sides),
      world.materials.backdropBlue
    );
    cliff.position.y = -height / 2;
    cliff.receiveShadow = true;
    group.add(cliff);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.88, 0.18, sides),
      topMaterial
    );
    cap.position.y = 0.08;
    cap.receiveShadow = true;
    group.add(cap);

    for (let i = 0; i < 10; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * radius * 0.78;
      const heightScale = rand(1.1, 2.8);
      const frond = new THREE.Mesh(
        new THREE.ConeGeometry(rand(0.12, 0.32), heightScale, 5),
        pick([world.materials.coralGreen, world.materials.coralPink, world.materials.coralTeal, world.materials.spore])
      );
      frond.position.set(Math.cos(angle) * distance, 0.2 + heightScale / 2, Math.sin(angle) * distance * scaleZ);
      frond.rotation.x = rand(-0.18, 0.18);
      frond.rotation.z = rand(-0.18, 0.18);
      group.add(frond);
    }

    const rotation = rand(-0.18, 0.18);
    group.position.set(x, terrainOffsetAt(x, z) + 0.05, z);
    group.scale.z = scaleZ;
    group.rotation.y = rotation;
    registerPlateauObstacle(x, z, radius, scaleZ, rotation, "shelf");
    world.scene.add(group);
    return group;
  }

  function makeTallCoralPillar(x, z, height, radius, material) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.55, radius, height, 6),
      material
    );
    trunk.position.y = height / 2;
    trunk.rotation.x = rand(-0.08, 0.08);
    trunk.rotation.z = rand(-0.08, 0.08);
    trunk.castShadow = false;
    group.add(trunk);

    for (let i = 0; i < 4; i++) {
      const branchHeight = rand(1.5, 3.8);
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.28, radius * 0.42, branchHeight, 5),
        pick([world.materials.coralPink, world.materials.coralPurple, world.materials.coralTeal, world.materials.coralYellow])
      );
      const angle = (i / 4) * Math.PI * 2 + rand(-0.35, 0.35);
      branch.position.set(Math.cos(angle) * radius * 0.75, height * rand(0.36, 0.78), Math.sin(angle) * radius * 0.75);
      branch.rotation.z = Math.cos(angle) * 0.55;
      branch.rotation.x = Math.sin(angle) * 0.55;
      group.add(branch);
    }

    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.95, 0), pick([material, world.materials.crystal, world.materials.spore]));
    cap.position.y = height + radius * 0.5;
    group.add(cap);

    group.position.set(x, terrainOffsetAt(x, z) + 0.14, z);
    group.userData.phase = rand(0, Math.PI * 2);
    world.scene.add(group);
    world.drift.push(group);
    return group;
  }

  function makeCausticGlint(x, z, radius, rotation) {
    const THREE = window.THREE;
    const material = world.materials.caustic.clone();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.035, 4, 28),
      material
    );
    ring.position.set(x, terrainVisualYAt(x, z) + 0.075, z);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = rotation;
    ring.scale.z = rand(0.34, 0.78);
    ring.userData.phase = rand(0, Math.PI * 2);
    ring.userData.baseOpacity = rand(0.045, 0.11);
    ring.userData.baseScale = ring.scale.clone();
    world.scene.add(ring);
    world.atmosphere.push(ring);
    return ring;
  }

  function makeSuspendedDroplet(x, z, radius, y) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 9, 7),
      radius > 1.05 ? world.materials.droplet : world.materials.bubble
    );
    bubble.scale.set(1, rand(0.82, 1.18), rand(0.86, 1.12));
    group.add(bubble);

    const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.16, 0), world.materials.white);
    shine.position.set(-radius * 0.34, radius * 0.32, -radius * 0.38);
    group.add(shine);

    group.position.set(x, y, z);
    group.userData.baseY = y;
    group.userData.speed = rand(0.25, 0.8);
    group.userData.phase = rand(0, Math.PI * 2);
    world.scene.add(group);
    world.drift.push(group);
    return group;
  }

  function makeLightShaft(x, z, width, height, yaw) {
    const THREE = window.THREE;
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(width, height), world.materials.mist.clone());
    shaft.position.set(x, height * 0.35, z);
    shaft.rotation.y = yaw;
    shaft.rotation.z = rand(-0.08, 0.08);
    shaft.userData.phase = rand(0, Math.PI * 2);
    shaft.userData.baseOpacity = rand(0.045, 0.12);
    shaft.userData.baseScale = shaft.scale.clone();
    world.scene.add(shaft);
    world.atmosphere.push(shaft);
    return shaft;
  }

  function buildEnvironment() {
    const THREE = window.THREE;
    const tubeClusters = [
      [-18, 18, 4.2, 8, [world.materials.fiberA, world.materials.coralGreen, world.materials.coralPink]],
      [20, 18, 4.2, 8, [world.materials.fiberA, world.materials.coralPink, world.materials.coralPurple]],
      [mapCoord(-64), mapCoord(45), scenicRadius(11.8), 14, [world.materials.fiberA, world.materials.coralGreen, world.materials.algae]],
      [mapCoord(-76), mapCoord(19), scenicRadius(9.8), 10, [world.materials.coralPink, world.materials.coralPurple]],
      [mapCoord(63), mapCoord(38), scenicRadius(11.6), 14, [world.materials.fiberA, world.materials.algae, world.materials.coralGreen]],
      [mapCoord(72), mapCoord(-27), scenicRadius(10.0), 11, [world.materials.coralPink, world.materials.bacteria]],
      [mapCoord(58), mapCoord(-64), scenicRadius(12.4), 15, [world.materials.coralPink, world.materials.bacteria, world.materials.coralPurple]],
      [mapCoord(-58), mapCoord(-62), scenicRadius(11.2), 13, [world.materials.coralPurple, world.materials.spore, world.materials.capsulePink]],
      [mapCoord(-22), mapCoord(-78), scenicRadius(8.6), 9, [world.materials.fiberA, world.materials.algae]],
      [mapCoord(8), mapCoord(66), scenicRadius(9.4), 16, [world.materials.coralGreen, world.materials.flowerPetal]],
      [mapCoord(83), mapCoord(54), scenicRadius(8.2), 14, [world.materials.fiberA, world.materials.coralPink]],
      [mapCoord(-83), mapCoord(-46), scenicRadius(8.4), 14, [world.materials.coralPurple, world.materials.spore]],
    ];
    tubeClusters.forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));

    for (let i = 0; i < populationCount(78); i++) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.12, 0.62), 9, 7),
        world.materials.bubble
      );
      const pos = randomPoint(WORLD_RADIUS - 4);
      bubble.position.set(pos.x, rand(3.4, 28), pos.z);
      bubble.userData.baseY = bubble.position.y;
      bubble.userData.speed = rand(0.35, 1.15);
      bubble.userData.phase = rand(0, Math.PI * 2);
      world.scene.add(bubble);
      world.drift.push(bubble);
    }

    for (let i = 0; i < populationCount(42); i++) {
      const cell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.2, 0.58), 0),
        pick([world.materials.cell, world.materials.algae, world.materials.crystal, world.materials.spore])
      );
      const pos = randomPoint(WORLD_RADIUS - 5);
      cell.position.set(pos.x, rand(2.6, 18.5), pos.z);
      cell.userData.baseY = cell.position.y;
      cell.userData.speed = rand(0.55, 1.55);
      cell.userData.phase = rand(0, Math.PI * 2);
      world.scene.add(cell);
      world.drift.push(cell);
    }

    for (let i = 0; i < populationCount(44); i++) {
      const pos = randomPoint(WORLD_RADIUS - 5);
      makePebblePatch(pos.x, pos.z, rand(0.55, 1.4));
    }

    for (let i = 0; i < populationCount(34); i++) {
      const pos = randomPoint(WORLD_RADIUS - 6);
      makeMicroFlower(pos.x, pos.z, rand(0.55, 1.1));
    }

    for (let i = 0; i < populationCount(26); i++) {
      const cilia = new THREE.Group();
      const pos = randomPoint(WORLD_RADIUS - 7);
      const height = rand(2.6, 5.2);
      const stem = new THREE.Mesh(
        new THREE.ConeGeometry(rand(0.18, 0.34), height, 5),
        i % 3 ? world.materials.fiberA : world.materials.cell
      );
      stem.position.y = height / 2;
      stem.rotation.x = rand(-0.16, 0.16);
      stem.rotation.z = rand(-0.16, 0.16);
      stem.castShadow = i % 2 === 0;
      cilia.add(stem);
      cilia.position.set(pos.x, terrainOffsetAt(pos.x, pos.z) + 0.12, pos.z);
      cilia.userData.phase = rand(0, Math.PI * 2);
      world.scene.add(cilia);
      world.drift.push(cilia);
    }

    makeMicroDebris();
  }

  function makeTubeCluster(x, z, radius, count, materials) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * radius;
      const height = rand(2.6, 8.4) * (i % 5 === 0 ? 1.26 : 1);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(rand(0.16, 0.36), rand(0.22, 0.48), height, 6),
        pick(materials)
      );
      tube.position.set(Math.cos(angle) * distance, height / 2 + 0.12, Math.sin(angle) * distance);
      tube.rotation.x = rand(-0.18, 0.18);
      tube.rotation.z = rand(-0.18, 0.18);
      tube.castShadow = i % 4 === 0;
      group.add(tube);

      if (i % 3 === 0) {
        const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.28, 0.58), 0), pick(materials));
        cap.position.set(tube.position.x, height + rand(0.32, 0.74), tube.position.z);
        cap.castShadow = false;
        group.add(cap);
      }
    }
    group.position.set(x, terrainOffsetAt(x, z), z);
    group.userData.phase = rand(0, Math.PI * 2);
    world.scene.add(group);
    return group;
  }

  function makePebblePatch(x, z, scale) {
    const THREE = window.THREE;
    const count = Math.floor(rand(3, 7));
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const pebble = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rand(0.18, 0.44) * scale, 0),
        pick([world.materials.cliff, world.materials.crystal, world.materials.pollen, world.materials.algae])
      );
      const angle = rand(0, Math.PI * 2);
      const distance = rand(0.15, 1.2) * scale;
      pebble.position.set(Math.cos(angle) * distance, rand(0.16, 0.38) * scale, Math.sin(angle) * distance);
      pebble.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      pebble.receiveShadow = true;
      group.add(pebble);
    }
    group.position.set(x, terrainOffsetAt(x, z) + 0.12, z);
    world.scene.add(group);
  }

  function makeMicroFlower(x, z, scale) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * scale, 0.08 * scale, 0.55 * scale, 5), world.materials.fiberA);
    stem.position.y = 0.42 * scale;
    group.add(stem);
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 * scale, 0), world.materials.flowerPetal);
      const angle = (i / 5) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.22 * scale, 0.74 * scale, Math.sin(angle) * 0.22 * scale);
      petal.scale.set(1.1, 0.55, 0.72);
      group.add(petal);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * scale, 0), world.materials.pollen);
    core.position.y = 0.74 * scale;
    group.add(core);
    group.position.set(x, terrainOffsetAt(x, z) + 0.14, z);
    group.rotation.y = rand(0, Math.PI * 2);
    world.scene.add(group);
  }

  function makeMicroDebris() {
    const THREE = window.THREE;
    const log = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 7.2), world.materials.cliff);
      slat.position.x = (i - 2) * 0.52;
      slat.rotation.z = rand(-0.03, 0.03);
      slat.castShadow = true;
      log.add(slat);
    }
    log.position.set(mapCoord(2), terrainOffsetAt(mapCoord(2), mapCoord(23)) + 5.3, mapCoord(23));
    log.rotation.set(-0.6, -0.72, 0.18);
    world.scene.add(log);

    const crater = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 0), world.materials.pollen);
    crater.position.set(mapCoord(58), terrainOffsetAt(mapCoord(58), mapCoord(-10)) + 2.6, mapCoord(-10));
    crater.scale.set(1.1, 0.82, 0.95);
    crater.rotation.set(0.4, -0.2, 0.12);
    crater.castShadow = true;
    world.scene.add(crater);
    for (let i = 0; i < 16; i++) {
      const pit = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.18, 0.42), 0), world.materials.cliff);
      const angle = rand(0, Math.PI * 2);
      const px = mapCoord(58) + Math.cos(angle) * rand(0.8, 2.8);
      const pz = mapCoord(-10) + Math.sin(angle) * rand(0.8, 2.3);
      pit.position.set(px, terrainOffsetAt(px, pz) + 3.05, pz);
      pit.scale.y = 0.2;
      world.scene.add(pit);
    }
  }

  function toyForward(toy) {
    const yaw = toy.yaw || 0;
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  }

  function buildTraversalToys() {
    world.traversalToys = [];
    TRAVERSAL_TOYS.forEach((toy) => {
      const group = makeTraversalToy(toy);
      group.userData.cooldown = 0;
      group.userData.pulse = rand(0, Math.PI * 2);
      world.scene.add(group);
      world.traversalToys.push(group);
    });
  }

  function makeTraversalToy(toy) {
    if (toy.type === "ramp") return makeRampToy(toy);
    if (toy.type === "jumpPad") return makeJumpPadToy(toy);
    if (toy.type === "geyser") return makeGeyserToy(toy);
    return makeRidgeToy(toy);
  }

  function makeRampToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.22, toy.z);
    group.rotation.y = toy.yaw;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.46, 9.2), world.materials.ramp);
    deck.position.y = 0.65;
    deck.rotation.x = -0.28;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    [-1.6, 0, 1.6].forEach((x, index) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 5.8), world.materials.rampStripe);
      stripe.position.set(x, 0.96 + index * 0.02, -0.2);
      stripe.rotation.x = -0.28;
      group.add(stripe);
    });

    const lip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 5), world.materials.jumpPadCore);
    lip.position.set(0, 1.65, -4.35);
    lip.rotation.x = -Math.PI / 2;
    group.add(lip);
    return group;
  }

  function makeJumpPadToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.18, toy.z);
    group.rotation.y = toy.yaw;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.2, 0.36, 10), world.materials.jumpPad);
    pad.position.y = 0.2;
    pad.receiveShadow = true;
    group.add(pad);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.12, 6, 32), world.materials.jumpPadCore);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.46;
    group.add(ring);

    const spring = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 6), world.materials.rampStripe);
    spring.position.y = 1.05;
    group.add(spring);
    group.userData.ring = ring;
    group.userData.spring = spring;
    return group;
  }

  function makeGeyserToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.1, toy.z);

    const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 2.8, 0.18, 14), world.materials.water);
    pool.position.y = 0.08;
    pool.scale.z = 0.72;
    pool.rotation.y = toy.yaw;
    group.add(pool);

    const plume = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, rand(2.8, 5.8), 6), world.materials.geyser);
      const angle = (i / 6) * Math.PI * 2;
      jet.position.set(Math.cos(angle) * rand(0.15, 0.8), jet.geometry.parameters.height / 2 + 0.24, Math.sin(angle) * rand(0.15, 0.8));
      jet.rotation.x = Math.sin(angle) * 0.14;
      jet.rotation.z = Math.cos(angle) * 0.14;
      plume.add(jet);
    }
    group.add(plume);
    group.userData.plume = plume;
    return group;
  }

  function makeRidgeToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    const forward = toyForward(toy);
    const baseOffset = terrainOffsetAt(toy.x, toy.z);
    group.position.set(toy.x, baseOffset + 0.06, toy.z);
    for (let i = 0; i < 9; i++) {
      const offset = (i - 4) * 2.15;
      const px = toy.x + forward.x * offset;
      const pz = toy.z + forward.z * offset;
      const step = new THREE.Mesh(new THREE.BoxGeometry(4.8 - Math.abs(i - 4) * 0.18, 0.38, 1.72), world.materials.ridgeStep);
      step.position.set(forward.x * offset, terrainOffsetAt(px, pz) - baseOffset + 0.18 + i * 0.055, forward.z * offset);
      step.rotation.y = toy.yaw;
      step.castShadow = i % 2 === 0;
      step.receiveShadow = true;
      group.add(step);
    }
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.3, 5), world.materials.spore);
    marker.position.y = 2.0;
    group.add(marker);
    group.userData.marker = marker;
    return group;
  }

  function buildHiddenLandmarks() {
    world.landmarks = [];
    HIDDEN_LANDMARKS.forEach((landmark) => {
      const group = makeHiddenLandmark(landmark);
      group.userData.pulse = rand(0, Math.PI * 2);
      world.scene.add(group);
      world.landmarks.push(group);
    });
  }

  function makeHiddenLandmark(landmark) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...landmark, found: false };
    group.position.set(landmark.x, terrainOffsetAt(landmark.x, landmark.z) + 0.18, landmark.z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.6, 0.52, 8), world.materials.cliff);
    base.position.y = 0.25;
    base.receiveShadow = true;
    group.add(base);

    const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.86, 0), world.materials.landmark);
    core.position.y = 1.35;
    core.castShadow = true;
    group.add(core);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.055, 6, 28), world.materials.landmarkGlow);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.42;
    group.add(halo);

    for (let i = 0; i < 5; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.12, rand(1.1, 2.0), 5), i % 2 ? world.materials.fiberA : world.materials.coralPink);
      const angle = (i / 5) * Math.PI * 2;
      frond.position.set(Math.cos(angle) * 1.45, 0.82, Math.sin(angle) * 1.45);
      frond.rotation.z = Math.cos(angle) * 0.42;
      frond.rotation.x = Math.sin(angle) * 0.42;
      group.add(frond);
    }

    group.userData.core = core;
    group.userData.halo = halo;
    return group;
  }

  function buildSandboxZones() {
    const THREE = window.THREE;
    world.zones = [];
    SANDBOX_ZONES.forEach((zone) => {
      const group = new THREE.Group();
      const zoneOffset = terrainOffsetAt(zone.x, zone.z);
      const floor = new THREE.Mesh(
        new THREE.CylinderGeometry(zone.radius, zone.radius * 0.92, 0.045, 18),
        world.materials[zone.material]
      );
      floor.position.y = 0.035;
      floor.rotation.y = rand(0, Math.PI);
      floor.receiveShadow = true;
      group.add(floor);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(zone.radius * 0.93, 0.055, 6, 36),
        world.materials[zone.material]
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.12;
      group.add(rim);

      if (zone.id === "forest") {
        for (let i = 0; i < populationCount(15); i++) {
          const blade = new THREE.Mesh(
            new THREE.ConeGeometry(rand(0.2, 0.52), rand(2.8, 7.4), 5),
            i % 5 === 0 ? world.materials.coralGreen : i % 3 ? world.materials.algae : world.materials.fiberA
          );
          const pos = randomPointNear(zone, zone.radius * 0.82);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          blade.position.set(pos.x - zone.x, localY + blade.geometry.parameters.height / 2, pos.z - zone.z);
          blade.rotation.x = rand(-0.22, 0.22);
          blade.rotation.z = rand(-0.22, 0.22);
          blade.castShadow = true;
          group.add(blade);
        }
      } else if (zone.id === "flats") {
        for (let i = 0; i < populationCount(12); i++) {
          const puddle = new THREE.Mesh(
            new THREE.CylinderGeometry(rand(1.2, 2.4), rand(1.1, 2.2), 0.035, 14),
            i % 3 === 0 ? world.materials.water : world.materials.droplet
          );
          const pos = randomPointNear(zone, zone.radius * 0.75);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          puddle.position.set(pos.x - zone.x, localY + 0.08, pos.z - zone.z);
          puddle.scale.z = rand(0.55, 0.9);
          puddle.rotation.y = rand(0, Math.PI);
          group.add(puddle);
        }
      } else if (zone.id === "ridge") {
        for (let i = 0; i < populationCount(13); i++) {
          const spire = new THREE.Group();
          const height = rand(2.4, 7.2);
          const core = new THREE.Mesh(
            new THREE.ConeGeometry(rand(0.26, 0.64), height, 5),
            i % 2 ? world.materials.spore : world.materials.coralPurple
          );
          core.position.y = height / 2;
          core.castShadow = i % 3 === 0;
          spire.add(core);
          const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.22, 0.46), 0), world.materials.crystal);
          cap.position.y = height + 0.24;
          spire.add(cap);
          const pos = randomPointNear(zone, zone.radius * 0.82);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          spire.position.set(pos.x - zone.x, localY + 0.1, pos.z - zone.z);
          spire.rotation.z = rand(-0.16, 0.16);
          group.add(spire);
        }
      } else {
        for (let i = 0; i < populationCount(16); i++) {
          const coral = new THREE.Group();
          const core = new THREE.Mesh(
            new THREE.DodecahedronGeometry(rand(0.38, 0.82), 0),
            pick([world.materials.bacteria, world.materials.bacteriaDark, world.materials.coralPink, world.materials.coralPurple])
          );
          core.castShadow = true;
          coral.add(core);
          for (let j = 0; j < 5; j++) {
            const spike = new THREE.Mesh(
              new THREE.ConeGeometry(0.08, rand(0.45, 0.98), 5),
              j % 2 ? world.materials.bacteriaDark : world.materials.coralPink
            );
            const angle = (j / 5) * Math.PI * 2;
            spike.position.set(Math.cos(angle) * 0.55, 0.1, Math.sin(angle) * 0.55);
            spike.rotation.z = Math.cos(angle) * 0.8;
            spike.rotation.x = Math.sin(angle) * 0.8;
            coral.add(spike);
          }
          const pos = randomPointNear(zone, zone.radius * 0.78);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          coral.position.set(pos.x - zone.x, localY + 0.7, pos.z - zone.z);
          group.add(coral);
        }
      }

      group.position.set(zone.x, zoneOffset, zone.z);
      group.userData.zone = zone;
      world.scene.add(group);
      world.zones.push(group);
    });
  }

  function makeNutrientRing() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_TARGET.radius, 0.16, 10, 54),
      world.materials.ring
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    group.add(ring);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_TARGET.radius * 0.8, RING_TARGET.radius * 0.8, 0.05, 36),
      world.materials.ringCore
    );
    core.position.y = 0.04;
    group.add(core);
    world.ringCore = core;

    const beacon = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.8, 5),
      world.materials.ring
    );
    beacon.position.set(0, 2.1, 0);
    group.add(beacon);

    const light = new THREE.PointLight(0xffd43b, 2.8, 22);
    light.position.set(0, 2.4, 0);
    group.add(light);

    group.position.set(RING_TARGET.x, terrainOffsetAt(RING_TARGET.x, RING_TARGET.z) + 0.04, RING_TARGET.z);
    return group;
  }

  function makeGuideBeacon() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.055, 6, 28),
      world.materials.guide
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);

    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.2, 5),
      world.materials.guideCore
    );
    pointer.position.y = 2.2;
    pointer.rotation.x = Math.PI;
    group.add(pointer);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.55, 5),
      world.materials.guide
    );
    stem.position.y = 1.15;
    group.add(stem);

    const light = new THREE.PointLight(0xffd43b, 1.6, 10);
    light.position.y = 1.9;
    group.add(light);

    group.visible = false;
    group.userData.ring = ring;
    group.userData.pointer = pointer;
    return group;
  }

  function makeTardigrade() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    world.bodySegments = [];
    world.legs = [];
    world.feelers = [];

    const segmentPositions = [
      [0, 1.28, -2.32, 1.12, 0.88, 0.86, world.materials.tardigradeBelly],
      [0, 1.2, -1.34, 1.45, 1.03, 1.04, world.materials.tardigradeA],
      [0, 1.16, -0.34, 1.66, 1.12, 1.14, world.materials.tardigradeA],
      [0, 1.14, 0.72, 1.68, 1.1, 1.16, world.materials.tardigradeA],
      [0, 1.18, 1.72, 1.46, 1.0, 1.02, world.materials.tardigradeB],
      [0, 1.22, 2.48, 1.02, 0.78, 0.78, world.materials.tardigradeB],
    ];

    segmentPositions.forEach(([x, y, z, sx, sy, sz, material], index) => {
      const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
      segment.scale.set(sx, sy, sz);
      segment.position.set(x, y, z);
      segment.castShadow = true;
      segment.receiveShadow = true;
      segment.userData.base = { x, y, z };
      segment.userData.phase = index * 0.65;
      group.add(segment);
      world.bodySegments.push(segment);

      if (index > 0) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.045, 5, 18), world.materials.tardigradeStripe);
        band.position.set(x, y + 0.02, z - 0.42);
        band.scale.set(sx * 0.92, sy * 0.72, 1);
        band.castShadow = true;
        group.add(band);
      }

      if (index > 0 && index < segmentPositions.length - 1) {
        const plate = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + index * 0.015, 0), world.materials.tardigradePlate);
        plate.position.set(0, y + sy * 0.78, z - 0.08);
        plate.scale.set(1.35, 0.34, 0.86);
        plate.rotation.y = index * 0.28;
        plate.castShadow = true;
        group.add(plate);
      }
    });

    const headMask = new THREE.Mesh(new THREE.SphereGeometry(0.72, 9, 6), world.materials.tardigradeMuzzle);
    headMask.position.set(0, 1.2, -3.0);
    headMask.scale.set(0.95, 0.76, 0.52);
    headMask.castShadow = true;
    group.add(headMask);

    const oralTube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.22, 8), world.materials.oralRing);
    oralTube.position.set(0, 1.16, -3.47);
    oralTube.rotation.x = Math.PI / 2;
    oralTube.castShadow = true;
    group.add(oralTube);

    const oralRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 12), world.materials.tardigradePlate);
    oralRim.position.set(0, 1.16, -3.59);
    oralRim.scale.set(0.95, 0.78, 1);
    group.add(oralRim);

    const oralOpening = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.026, 8), world.materials.mouthDark);
    oralOpening.position.set(0, 1.16, -3.62);
    oralOpening.rotation.x = Math.PI / 2;
    group.add(oralOpening);

    [-0.16, 0.16].forEach((x) => {
      const stylet = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 5), world.materials.claw);
      stylet.position.set(x, 1.15, -3.69);
      stylet.rotation.x = Math.PI / 2;
      stylet.rotation.z = x < 0 ? -0.12 : 0.12;
      group.add(stylet);
    });

    [-0.42, 0.42].forEach((x) => {
      const eyePad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), world.materials.tardigradePlate);
      eyePad.position.set(x, 1.56, -3.0);
      eyePad.scale.set(1.0, 0.88, 0.38);
      eyePad.castShadow = true;
      group.add(eyePad);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), world.materials.eye);
      eye.position.set(x, 1.58, -3.17);
      eye.scale.set(0.86, 1.02, 0.52);
      group.add(eye);

      const glint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 0), world.materials.eyeGlint);
      glint.position.set(x - 0.055 * Math.sign(x), 1.66, -3.3);
      group.add(glint);
    });

    const legPairs = [
      [-1.1, -1.55],
      [-1.34, -0.58],
      [-1.32, 0.54],
      [-1.02, 1.58],
      [1.1, -1.55],
      [1.34, -0.58],
      [1.32, 0.54],
      [1.02, 1.58],
    ];
    legPairs.forEach(([x, z], index) => {
      const leg = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.92, 5), world.materials.tardigradeB);
      upper.position.set(x, 0.77, z);
      upper.rotation.z = x < 0 ? -0.52 : 0.52;
      upper.castShadow = true;
      leg.add(upper);

      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), world.materials.tardigradeBelly);
      foot.position.set(x * 1.12, 0.28, z + (index % 2 ? 0.14 : -0.08));
      foot.scale.set(1.1, 0.58, 0.72);
      foot.castShadow = true;
      leg.add(foot);

      [-0.16, 0.16].forEach((offset) => {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.26, 5), world.materials.claw);
        claw.position.set(x * 1.18, 0.18, z + offset);
        claw.rotation.x = Math.PI;
        claw.rotation.z = x < 0 ? -0.28 : 0.28;
        leg.add(claw);
      });

      const toe = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 5), world.materials.claw);
      toe.position.set(x * 1.18, 0.22, z + (index % 2 ? 0.3 : -0.24));
      foot.rotation.x = Math.PI;
      toe.rotation.x = Math.PI;
      leg.add(toe);

      leg.userData.side = x < 0 ? -1 : 1;
      leg.userData.baseZ = z;
      leg.userData.phase = index * 0.75;
      group.add(leg);
      world.legs.push(leg);
    });

    [-0.42, 0.42].forEach((x) => {
      const feeler = new THREE.Mesh(new THREE.ConeGeometry(0.052, 1.06, 5), world.materials.fiberA);
      feeler.position.set(x, 1.82, -2.88);
      feeler.rotation.x = -0.9;
      feeler.rotation.z = x * 0.45;
      group.add(feeler);
      world.feelers.push(feeler);
    });

    const tailNub = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.48, 6), world.materials.tardigradeStripe);
    tailNub.position.set(0, 1.16, 3.06);
    tailNub.rotation.x = Math.PI / 2;
    group.add(tailNub);

    group.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    group.scale.setScalar(1.14);
    return group;
  }

  function buildRoamingCreatures() {
    world.creatures = CREATURE_ROUTES.map((route) => {
      const creature = makeRoamingCreature(route);
      creature.userData.angle = route.phase || 0;
      creature.userData.baseScale = creatureBaseScale(route.type);
      creature.userData.bonkCooldown = 0;
      const start = creatureRoutePosition(creature.userData, 0);
      creature.position.set(start.x, start.y, start.z);
      creature.userData.prevX = start.x;
      creature.userData.prevZ = start.z;
      world.scene.add(creature);
      return creature;
    });
  }

  function makeRoamingCreature(route) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...route };

    if (route.type === "rotifer") {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), world.materials.creatureA);
      body.scale.set(1.05, 0.58, 1.9);
      body.castShadow = true;
      group.add(body);

      const crown = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2;
        const cilium = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.72, 5), world.materials.creatureFin);
        cilium.position.set(Math.cos(angle) * 0.48, 0.08 + Math.sin(angle) * 0.12, -1.64 + Math.sin(angle) * 0.2);
        cilium.rotation.x = -0.8 + Math.sin(angle) * 0.22;
        cilium.rotation.z = Math.cos(angle) * 0.55;
        crown.add(cilium);
      }
      crown.userData.kind = "crown";
      group.add(crown);

      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 5), world.materials.creatureB);
      tail.position.z = 1.8;
      tail.rotation.x = Math.PI / 2;
      tail.userData.kind = "tail";
      group.add(tail);
    } else if (route.type === "waterbearling") {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), world.materials.tardigradeBelly);
      body.scale.set(0.78, 0.58, 1.06);
      group.add(body);
      for (let i = 0; i < 4; i++) {
        const z = -0.58 + i * 0.38;
        [-0.58, 0.58].forEach((x) => {
          const leg = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 5), world.materials.claw);
          leg.position.set(x, -0.36, z);
          leg.rotation.z = x < 0 ? -0.7 : 0.7;
          group.add(leg);
        });
      }
      const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), world.materials.eye);
      eye.position.set(0.34, 0.28, -0.88);
      group.add(eye);
    } else if (route.type === "sporeRay") {
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(1.12, 0), world.materials.creatureC);
      body.scale.set(1.35, 0.32, 1.1);
      body.rotation.y = Math.PI / 4;
      group.add(body);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.8, 5), world.materials.creatureFin);
      fin.position.z = 0.92;
      fin.rotation.x = Math.PI / 2;
      fin.userData.kind = "fin";
      group.add(fin);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), world.materials.creatureB);
      body.scale.set(0.72, 0.46, 2.05);
      group.add(body);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 5, 16), world.materials.creatureC);
      stripe.position.z = -0.45;
      stripe.scale.y = 0.58;
      group.add(stripe);
      for (let i = 0; i < 8; i++) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.56, 5), world.materials.creatureFin);
        const side = i % 2 ? 1 : -1;
        fin.position.set(side * 0.58, 0.02, -0.9 + i * 0.26);
        fin.rotation.z = side * 0.95;
        fin.userData.kind = "fin";
        group.add(fin);
      }
    }

    group.scale.setScalar(creatureBaseScale(route.type));
    return group;
  }

  function creatureBaseScale(type) {
    if (type === "sporeRay") return 2.0;
    if (type === "rotifer") return 1.65;
    if (type === "ciliate") return 1.5;
    if (type === "waterbearling") return 1.35;
    return 1.25;
  }

  function creatureRoutePosition(data, clockOffset) {
    const angle = data.angle + clockOffset;
    const wobble = Math.sin(angle * 1.7 + data.phase) * 2.6;
    const x = data.centerX + Math.cos(angle) * data.radiusX + Math.sin(angle * 0.5 + 1.3) * wobble;
    const z = data.centerZ + Math.sin(angle * 0.92) * data.radiusZ + Math.cos(angle * 0.62) * wobble;
    return {
      x,
      z,
      y: groundYAt(x, z) + data.hover + Math.sin(state.clock * 1.8 + data.phase) * 0.38,
    };
  }

  function updateCreatures(dt, active) {
    const THREE = window.THREE;
    const player = state.player;
    world.creatures.forEach((creature, index) => {
      const data = creature.userData;
      data.angle += dt * data.speed * (active ? 1 : 0.58);
      data.bonkCooldown = Math.max(0, data.bonkCooldown - dt);
      const next = creatureRoutePosition(data, index * 0.21);
      const dx = next.x - (data.prevX ?? creature.position.x);
      const dz = next.z - (data.prevZ ?? creature.position.z);
      creature.position.set(next.x, next.y, next.z);
      if (Math.hypot(dx, dz) > 0.001) {
        creature.rotation.y = Math.atan2(-dx, -dz);
      }
      creature.rotation.x = Math.sin(state.clock * 1.4 + data.phase) * 0.05;
      creature.rotation.z = Math.cos(state.clock * 1.7 + data.phase) * 0.08;
      creature.children.forEach((child, childIndex) => {
        if (child.userData.kind === "crown") child.rotation.z += dt * 4.2;
        if (child.userData.kind === "fin") child.rotation.y = Math.sin(state.clock * 6 + childIndex) * 0.26;
        if (child.userData.kind === "tail") child.rotation.z = Math.sin(state.clock * 5 + data.phase) * 0.32;
      });
      data.prevX = next.x;
      data.prevZ = next.z;
      const baseScale = data.baseScale || creatureBaseScale(data.type);
      creature.scale.lerp(new THREE.Vector3(baseScale, baseScale, baseScale), Math.min(1, dt * 4));

      if (!active || data.bonkCooldown > 0) return;
      const distance = Math.hypot(creature.position.x - player.x, creature.position.z - player.z);
      const playerSpeed = Math.hypot(player.vx, player.vz);
      if (distance < 3.2 && playerSpeed > 8) {
        data.bonkCooldown = 2.5;
        creature.scale.setScalar(baseScale * 1.22);
        const comboInfo = extendCombo("creature", 1, 3.2);
        const score = scoreWithCombo(210);
        addChaos(score, "Roaming microbe startled");
        showCallout("SQUIRM!", `+${score.toLocaleString()} roaming microbe startled${comboTag(comboInfo)}`);
        playTone("bonk", 0.9);
      }
    });
  }

  function zoneById(id) {
    return SANDBOX_ZONES.find((zone) => zone.id === id);
  }

  function randomPointNear(zone, spread = zone.radius) {
    let point = { x: zone.x, z: zone.z };
    for (let i = 0; i < 16; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * spread;
      const x = zone.x + Math.cos(angle) * distance;
      const z = zone.z + Math.sin(angle) * distance;
      if (Math.hypot(x, z) < WORLD_RADIUS - 5 && !pointOverlapsPlateau(x, z, PLAYER_RADIUS + 1.2)) {
        point = { x, z };
        break;
      }
    }
    return point;
  }

  function addZoneProps(zoneId, entries) {
    const zone = zoneById(zoneId);
    if (!zone) return;
    entries.forEach(([type, count, spread]) => {
      for (let i = 0; i < populationCount(count); i++) addProp(type, randomPointNear(zone, spread || zone.radius * 0.82));
    });
  }

  function populateProps() {
    clearProps();
    clearEffects();
    STARTER_PROPS.forEach(([type, point]) => addProp(type, point));

    addZoneProps("forest", [
      ["algae", 14],
      ["spore", 5],
      ["cell", 5],
      ["bacteria", 2],
    ]);
    addZoneProps("flats", [
      ["droplet", 6],
      ["bubble", 7],
      ["platelet", 5],
      ["capsule", 3],
    ]);
    addZoneProps("reef", [
      ["bacteria", 8],
      ["enzyme", 4],
      ["crystal", 4],
      ["capsule", 3],
    ]);
    addZoneProps("ridge", [
      ["spore", 7],
      ["crystal", 5],
      ["enzyme", 3],
      ["pollen", 4],
    ]);

    for (let i = 0; i < populationCount(5); i++) addProp("pollen", randomPointNear(zoneById("reef"), scenicRadius(13)));
    for (let i = 0; i < populationCount(16); i++) addProp("algae", randomPoint(WORLD_RADIUS - 8));
    for (let i = 0; i < populationCount(13); i++) addProp(i < populationCount(6) ? "pollen" : "cell", randomPoint(WORLD_RADIUS - 9));
    for (let i = 0; i < populationCount(8); i++) addProp("bubble", randomPoint(WORLD_RADIUS - 9));
    for (let i = 0; i < populationCount(7); i++) addProp("crystal", randomPoint(WORLD_RADIUS - 10));
    for (let i = 0; i < populationCount(7); i++) addProp("capsule", randomPoint(WORLD_RADIUS - 9));
    for (let i = 0; i < populationCount(4); i++) addProp("droplet", randomPoint(WORLD_RADIUS - 10));
  }

  function addProp(type, point) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const config = {
      algae: { radius: 0.78, y: 0.72, score: 120, collect: true, mass: 0.18, material: world.materials.algae, damping: 4.2 },
      pollen: { radius: 1.35, y: 1.18, score: 180, mass: 1.4, material: world.materials.pollen, restitution: 0.74 },
      cell: { radius: 1.18, y: 0.98, score: 130, mass: 1.1, material: world.materials.cell, restitution: 0.65 },
      bubble: { radius: 1.0, y: 1.05, score: 90, mass: 0.65, material: world.materials.bubble, restitution: 0.95, friction: 0.2 },
      crystal: { radius: 1.05, y: 0.98, score: 150, mass: 1.8, material: world.materials.crystal, restitution: 0.55 },
      bacteria: { radius: 1.18, y: 1.05, score: 260, mass: 1.2, material: world.materials.bacteria, health: 2, restitution: 0.62 },
      droplet: { radius: 2.05, y: 1.46, score: 420, mass: 5.4, material: world.materials.droplet, restitution: 0.32, damping: 1.25, physicsRadius: 1.55 },
      capsule: { radius: 1.25, y: 1.08, score: 160, mass: 0.9, material: world.materials.capsulePink, collider: "cuboid", restitution: 0.82, friction: 0.36 },
      enzyme: { radius: 1.1, y: 1.06, score: 310, mass: 1.35, material: world.materials.enzyme, health: 2, restitution: 0.72 },
      platelet: { radius: 1.28, y: 0.72, score: 170, mass: 1.25, material: world.materials.platelet, collider: "cuboid", restitution: 0.78, friction: 0.42 },
      spore: { radius: 0.92, y: 0.82, score: 145, mass: 0.55, material: world.materials.spore, restitution: 0.96, friction: 0.22 },
    }[type];

    let mesh;
    if (type === "algae") {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(config.radius, 0), config.material);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), world.materials.fiberA);
      leaf.position.set(0.28, 0.42, 0.1);
      leaf.rotation.z = -0.7;
      group.add(leaf);
    } else if (type === "pollen") {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 10; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), config.material);
        const angle = (i / 10) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 1.08, 0.1 + (i % 2) * 0.45, Math.sin(angle) * 1.08);
        spike.rotation.z = Math.cos(angle) * 0.8;
        spike.rotation.x = Math.sin(angle) * 0.8;
        group.add(spike);
      }
    } else if (type === "cell") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(config.radius, config.radius, 0.36, 14), config.material);
      mesh.scale.z = 0.72;
      mesh.rotation.x = Math.PI / 2;
    } else if (type === "bubble") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 10, 7), config.material);
      const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), world.materials.white);
      shine.position.set(-0.32, 0.32, -0.42);
      group.add(shine);
    } else if (type === "bacteria") {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 14; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.62, 5), world.materials.bacteriaDark);
        const angle = (i / 14) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 1.06, 0.12 + (i % 3) * 0.26, Math.sin(angle) * 1.06);
        spike.rotation.z = Math.cos(angle) * 0.95;
        spike.rotation.x = Math.sin(angle) * 0.95;
        spike.castShadow = true;
        group.add(spike);
      }
    } else if (type === "droplet") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 12, 8), config.material);
      mesh.scale.set(1.05, 0.74, 0.92);
      const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), world.materials.white);
      shine.position.set(-0.72, 0.58, -0.55);
      group.add(shine);
    } else if (type === "capsule") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 2.4, 8), config.material);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      group.add(body);
      const capA = new THREE.Mesh(new THREE.SphereGeometry(0.47, 8, 6), world.materials.capsuleBlue);
      const capB = new THREE.Mesh(new THREE.SphereGeometry(0.47, 8, 6), config.material);
      capA.position.x = -1.2;
      capB.position.x = 1.2;
      capA.castShadow = true;
      capB.castShadow = true;
      group.add(capA, capB);
      mesh = new THREE.Object3D();
    } else if (type === "enzyme") {
      mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 5; i++) {
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.28, 0), i % 2 ? world.materials.crystal : config.material);
        const angle = (i / 5) * Math.PI * 2;
        shard.position.set(Math.cos(angle) * 0.82, 0.16 + (i % 2) * 0.34, Math.sin(angle) * 0.82);
        shard.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
        shard.castShadow = true;
        group.add(shard);
      }
    } else if (type === "platelet") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(config.radius, config.radius * 0.92, 0.34, 9), config.material);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.z = 0.52;
    } else if (type === "spore") {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 6; i++) {
        const nub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), config.material);
        const angle = (i / 6) * Math.PI * 2;
        nub.position.set(Math.cos(angle) * 0.78, 0.12 + (i % 2) * 0.35, Math.sin(angle) * 0.78);
        group.add(nub);
      }
    } else {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(config.radius, 0), config.material);
      mesh.scale.y = 1.35;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const baseY = config.y + terrainOffsetAt(point.x, point.z);
    group.position.set(point.x, baseY, point.z);
    group.rotation.y = rand(0, Math.PI * 2);
    group.userData = {
      type,
      radius: config.radius,
      mass: config.mass || 1,
      collect: !!config.collect,
      score: config.score,
      velocity: new THREE.Vector3(0, 0, 0),
      spin: new THREE.Vector3(rand(-0.5, 0.5), rand(-0.8, 0.8), rand(-0.5, 0.5)),
      hitCooldown: 0,
      delivered: false,
      moved: false,
      spawnX: point.x,
      spawnZ: point.z,
      destructible: type === "bacteria" || type === "capsule" || type === "enzyme",
      health: config.health || (type === "capsule" ? 1 : 0),
      baseHeight: config.y,
      baseY,
    };
    attachPhysicsBody(group, config);
    world.scene.add(group);
    world.props.push(group);
  }

  function randomPoint(radius) {
    let x = 0;
    let z = 0;
    let tries = 0;
    do {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * radius;
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
      tries += 1;
    } while (
      tries < 18 &&
      (Math.hypot(x - state.player.x, z - state.player.z) < 7 || pointOverlapsPlateau(x, z, PLAYER_RADIUS + 1.2))
    );
    return { x, z };
  }

  function clearProps() {
    world.props.forEach((prop) => {
      removePhysicsBody(prop);
      world.scene.remove(prop);
      disposeObject(prop);
    });
    world.props = [];
  }

  function clearEffects() {
    world.effects.forEach((effect) => {
      world.scene.remove(effect);
      disposeObject(effect);
    });
    world.effects = [];
  }

  function disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
  }

  function bindInputs() {
    window.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowUp" || key === "w" || key === "W") {
        state.input.forward = 1;
        event.preventDefault();
      } else if (key === "ArrowDown" || key === "s" || key === "S") {
        state.input.forward = -1;
        event.preventDefault();
      } else if (key === "ArrowLeft" || key === "a" || key === "A") {
        state.input.right = -1;
        event.preventDefault();
      } else if (key === "ArrowRight" || key === "d" || key === "D") {
        state.input.right = 1;
        event.preventDefault();
      } else if (key === " " && !event.repeat) {
        jump();
        event.preventDefault();
      } else if (key === "Shift" && !event.repeat) {
        dash();
        event.preventDefault();
      } else if (key === "e" || key === "E") {
        setCurlSource("keyboard", true);
        event.preventDefault();
      } else if (key === "q" || key === "Q") {
        state.camera.targetYaw -= 0.22;
      } else if (key === "r" || key === "R") {
        state.camera.targetYaw += 0.22;
      } else if (key === "p" || key === "P" || key === "Escape") {
        togglePause();
      } else if (isLocalQA() && key === "F9") {
        forceIncidentReport();
        event.preventDefault();
      } else if (isLocalQA() && key === "F8") {
        forceFailureReport();
        event.preventDefault();
      } else if (isLocalQA() && key === "F7") {
        qaTeleportToLandmark();
        event.preventDefault();
      } else if (isLocalQA() && key === "F6") {
        qaTeleportToTraversalToy();
        event.preventDefault();
      } else if ((key === "Enter" || key === "Return") && !state.running) {
        startGame();
      }
    });

    window.addEventListener("keyup", (event) => {
      const key = event.key;
      if ((key === "ArrowUp" || key === "w" || key === "W") && state.input.forward > 0) state.input.forward = 0;
      if ((key === "ArrowDown" || key === "s" || key === "S") && state.input.forward < 0) state.input.forward = 0;
      if ((key === "ArrowLeft" || key === "a" || key === "A") && state.input.right < 0) state.input.right = 0;
      if ((key === "ArrowRight" || key === "d" || key === "D") && state.input.right > 0) state.input.right = 0;
      if (key === "e" || key === "E") setCurlSource("keyboard", false);
    });

    let pointer = null;
    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== canvas) return;
      if (!state.running || state.paused || state.gameOver) return;
      applyCameraLook(event.movementX || 0, event.movementY || 0);
    });
    document.addEventListener("pointerlockchange", () => {
      state.camera.mouseLook = document.pointerLockElement === canvas;
      if (state.camera.mouseLook) showPrompt("Mouse look active. WASD moves, Space jumps, Shift bonks.");
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      if (!state.running) {
        startGame();
        return;
      }
      if (event.pointerType === "mouse") {
        requestMouseLook();
      }
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        type: event.pointerType,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Some automated or synthesized pointer events cannot be captured.
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (document.pointerLockElement === canvas) return;
      if (!pointer || pointer.id !== event.pointerId) {
        if (event.pointerType === "mouse" && state.running && !state.paused && !state.gameOver) {
          applyCameraLook(event.movementX || 0, event.movementY || 0);
        }
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      applyCameraLook(dx, dy);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (pointer && pointer.id === event.pointerId && pointer.type !== "mouse" && !pointer.moved) jump();
      pointer = null;
    });
    canvas.addEventListener("pointercancel", () => { pointer = null; });

    el.primary.addEventListener("click", () => {
      if (state.paused) togglePause();
      else if (state.gameOver) startGame();
      else startGame();
    });
    el.pause.addEventListener("click", togglePause);
    el.restart.addEventListener("click", startGame);
    if (el.sound) el.sound.addEventListener("click", toggleSound);

    bindHold(el.forward, () => { state.input.virtualForward = 1; }, () => { if (state.input.virtualForward > 0) state.input.virtualForward = 0; });
    bindHold(el.back, () => { state.input.virtualForward = -1; }, () => { if (state.input.virtualForward < 0) state.input.virtualForward = 0; });
    bindHold(el.left, () => { state.input.virtualRight = -1; }, () => { if (state.input.virtualRight < 0) state.input.virtualRight = 0; });
    bindHold(el.right, () => { state.input.virtualRight = 1; }, () => { if (state.input.virtualRight > 0) state.input.virtualRight = 0; });
    bindTouchStick(el.touchStick, el.touchStickKnob);
    bindTap(el.jump, jump);
    bindTap(el.dash, dash);
    bindHold(el.curl, () => setCurlSource("touch", true), () => setCurlSource("touch", false));
  }

  function requestMouseLook() {
    if (!canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    try {
      const request = canvas.requestPointerLock();
      if (request && request.catch) request.catch(() => {});
    } catch (_) {}
  }

  function applyCameraLook(dx, dy) {
    state.camera.targetYaw -= dx * CAMERA_YAW_SENSITIVITY;
    state.camera.targetPitch = clamp(state.camera.targetPitch + dy * CAMERA_PITCH_SENSITIVITY, 0.24, 0.82);
  }

  function setCurlSource(source, held) {
    if (source === "keyboard") state.input.keyboardCurl = held;
    else state.input.virtualCurl = held;
    state.curlHeld = !!(state.input.keyboardCurl || state.input.virtualCurl);
  }

  function resetVirtualControls() {
    state.input.virtualForward = 0;
    state.input.virtualRight = 0;
    state.input.virtualCurl = false;
    state.curlHeld = !!state.input.keyboardCurl;
    if (el.touchStick) el.touchStick.classList.remove("is-active");
    if (el.touchStickKnob) el.touchStickKnob.style.transform = "";
    [el.jump, el.dash, el.curl, el.forward, el.back, el.left, el.right].forEach((button) => {
      if (button) button.classList.remove("is-held");
    });
  }

  function bindTouchStick(stick, knob) {
    if (!stick || !knob) return;
    let pointerId = null;
    const deadZone = 0.13;
    const update = (event) => {
      const rect = stick.getBoundingClientRect();
      const max = Math.max(32, Math.min(rect.width, rect.height) * 0.34);
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance > max) {
        const scale = max / distance;
        dx *= scale;
        dy *= scale;
      }
      const inputX = Math.abs(dx / max) < deadZone ? 0 : dx / max;
      const inputY = Math.abs(dy / max) < deadZone ? 0 : dy / max;
      state.input.virtualRight = clamp(inputX, -1, 1);
      state.input.virtualForward = clamp(-inputY, -1, 1);
      knob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    };
    const release = () => {
      pointerId = null;
      state.input.virtualForward = 0;
      state.input.virtualRight = 0;
      stick.classList.remove("is-active");
      knob.style.transform = "";
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!state.running) startGame();
      pointerId = event.pointerId;
      stick.classList.add("is-active");
      try {
        stick.setPointerCapture(event.pointerId);
      } catch (_) {}
      update(event);
    });
    stick.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      update(event);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      stick.addEventListener(eventName, (event) => {
        if (event.pointerId !== pointerId && eventName !== "lostpointercapture") return;
        event.preventDefault();
        release();
      });
    });
    window.addEventListener("pointerup", (event) => {
      if (event.pointerId === pointerId) release();
    });
    window.addEventListener("pointercancel", (event) => {
      if (event.pointerId === pointerId) release();
    });
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release, { passive: true });
    window.addEventListener("touchcancel", release, { passive: true });
    window.addEventListener("blur", release);
  }

  function bindTap(button, action) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("is-held");
      action();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, () => {
        button.classList.remove("is-held");
      });
    });
  }

  function bindHold(button, down, up) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("is-held");
      down();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        event.preventDefault();
        button.classList.remove("is-held");
        up();
      });
    });
  }

  function ensureAudio() {
    if (!audio.enabled || audio.ctx) return audio.ctx;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audio.ctx = new AudioContext();
    audio.unlocked = true;
    return audio.ctx;
  }

  function toggleSound() {
    audio.enabled = !audio.enabled;
    if (audio.enabled) {
      ensureAudio();
      playTone("level");
    }
    if (el.sound) el.sound.textContent = audio.enabled ? "Sound On" : "Muted";
  }

  function playTone(kind, intensity = 1) {
    if (!audio.enabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const settings = {
      jump: [220, 420, "triangle", 0.08],
      dash: [95, 180, "sawtooth", 0.1],
      munch: [520, 740, "square", 0.09],
      bonk: [140, 78, "triangle", 0.13],
      break: [260, 95, "sawtooth", 0.16],
      level: [460, 920, "triangle", 0.18],
      water: [180, 260, "sine", 0.16],
    }[kind] || [260, 340, "triangle", 0.1];
    const [startFrequency, endFrequency, type, duration] = settings;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800 + intensity * 700, now);
    osc.type = type;
    osc.frequency.setValueAtTime(startFrequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.min(0.18, 0.055 * intensity), now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(master);
    master.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function startGame() {
    if (!state.ready) return;
    ensureAudio();
    resetGame(true);
    hideOverlay();
    syncPlayMode();
    anchorGameViewport();
    canvas.focus();
    announceGoal();
  }

  function syncPlayMode() {
    const active = state.running && !state.gameOver;
    document.body.classList.toggle("micro-play-active", active);
    document.body.classList.toggle("micro-play-paused", active && state.paused);
    if (!active || state.paused) resetVirtualControls();
    requestAnimationFrame(resize);
  }

  function isLocalQA() {
    return location.hostname === "127.0.0.1" || location.hostname === "localhost";
  }

  function forceIncidentReport() {
    if (!state.ready) return;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.snacks = Math.max(state.snacks, GOAL_TARGETS.algae);
    state.bacteriaBashed = Math.max(state.bacteriaBashed, GOAL_TARGETS.bacteria);
    state.waterMoved = Math.max(state.waterMoved, GOAL_TARGETS.water);
    state.ringFed = Math.max(state.ringFed, missionById("ring").target);
    state.maxCombo = Math.max(state.maxCombo, missionById("combo").target);
    state.toysUsed = new Set(TRAVERSAL_TOYS.map((toy) => toy.id));
    state.landmarksFound = new Set(HIDDEN_LANDMARKS.map((landmark) => landmark.id));
    state.propsBroken = Math.max(state.propsBroken, 5);
    state.sessionTime = SANDBOX_SECONDS;
    state.zonesVisited = new Set(SANDBOX_ZONES.map((zone) => zone.id));
    state.miniComplete = new Set(MINI_MISSIONS.map((mission) => mission.id));
    state.goalsCleared = Math.max(state.goalsCleared, GOALS.length);
    state.goalIndex = GOALS.length - 1;
    state.chaos = Math.max(state.chaos, GOAL_TARGETS.chaos);
    updateHUD();
    winGame();
  }

  function forceFailureReport() {
    if (!state.ready) return;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.sessionTime = Math.max(state.sessionTime, 42);
    state.hydrate = 0;
    updateHUD();
    endGame("ANHYDROBIOSIS MODE", "Forced QA dry-out. The report screen should stay readable.");
  }

  function qaTeleportToTraversalToy() {
    if (!isLocalQA() || !state.ready) return;
    if (!state.running) startGame();
    const toy = TRAVERSAL_TOYS[state.qaToyIndex % TRAVERSAL_TOYS.length];
    state.qaToyIndex += 1;
    teleportPlayerTo(toy.x, toy.z, `QA: ${toy.name}`);
  }

  function qaTeleportToLandmark() {
    if (!isLocalQA() || !state.ready) return;
    if (!state.running) startGame();
    const landmark = HIDDEN_LANDMARKS[state.qaLandmarkIndex % HIDDEN_LANDMARKS.length];
    state.qaLandmarkIndex += 1;
    teleportPlayerTo(landmark.x, landmark.z, `QA: ${landmark.name}`);
  }

  function teleportPlayerTo(x, z, label) {
    Object.assign(state.player, {
      x,
      y: groundYAt(x, z) + 0.1,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      wobble: 0.2,
    });
    if (world.camera && world.camera.userData) world.camera.userData.ready = false;
    updatePlayerTransform(0);
    showPrompt(label);
  }

  function resetGame(run) {
    Object.assign(state, {
      running: run,
      paused: false,
      gameOver: false,
      lastTime: performance.now(),
      clock: 0,
      sessionTime: 0,
      chaos: 0,
      snacks: 0,
      bonks: 0,
      ringFed: 0,
      bacteriaBashed: 0,
      waterMoved: 0,
      propsBroken: 0,
      combo: 0,
      comboTimer: 0,
      lastComboAction: "",
      scoreDelta: 0,
      scoreDeltaTimer: 0,
      calloutTimer: 0,
      tipTimer: run ? 8 : 0,
      hydrate: 100,
      level: 1,
      xp: 0,
      goalIndex: 0,
      promptTimer: run ? 5 : 8,
      dashCooldown: 0,
      dashPulse: 0,
      maxCombo: 0,
      goalsCleared: 0,
      zoneId: "",
      zoneName: "Open Dish",
      zonesVisited: new Set(),
      miniComplete: new Set(),
      toysUsed: new Set(),
      landmarksFound: new Set(),
      qaToyIndex: 0,
      qaLandmarkIndex: 0,
      desiccationActive: false,
      curlHeld: false,
    });
    Object.assign(state.player, {
      x: 0,
      y: groundYAt(0, 8),
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      targetYaw: 0,
      grounded: true,
      wobble: 0,
    });
    Object.assign(state.camera, {
      yaw: 0.35,
      pitch: 0.42,
      targetYaw: 0.35,
      targetPitch: 0.42,
    });
    Object.assign(state.input, {
      forward: 0,
      right: 0,
      virtualForward: 0,
      virtualRight: 0,
      keyboardCurl: false,
      virtualCurl: false,
    });
    world.traversalToys.forEach((toy) => {
      toy.userData.cooldown = 0;
      toy.userData.justTriggered = 0;
    });
    world.landmarks.forEach((landmark) => {
      landmark.userData.found = false;
      landmark.scale.setScalar(1);
    });
    populateProps();
    updatePlayerTransform(0);
    updateGoalText();
    updateHUD();
    syncPlayMode();
    if (el.pause) el.pause.textContent = "Pause";
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    syncPlayMode();
    if (state.paused) {
      showOverlay("SPECIMEN PAUSED", "The tardigrade is briefly no longer anyone's problem.", "Resume");
    } else {
      hideOverlay();
      anchorGameViewport();
      state.lastTime = performance.now();
    }
  }

  function anchorGameViewport() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }

  function jump() {
    if (!state.running || state.paused || state.gameOver) return;
    if (!state.player.grounded) return;
    state.player.vy = state.curlHeld ? 10.8 : 9.1;
    state.player.grounded = false;
    state.player.wobble = 0.4;
    playTone("jump");
  }

  function dash() {
    if (!state.running || state.paused || state.gameOver || state.dashCooldown > 0) return;
    const player = state.player;
    const yaw = state.camera.targetYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    player.targetYaw = yaw;
    player.vx += forwardX * 25;
    player.vz += forwardZ * 25;
    state.dashCooldown = 1.1;
    state.dashPulse = 0.44;
    addChaos(45, "Hydro bonk armed");
    showPrompt("Bonk velocity online.");
    playTone("dash");
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    state.clock += dt;

    if (state.ready && state.running && !state.paused && !state.gameOver) {
      updateGame(dt);
    } else {
      updateIdle(dt);
    }
    renderWorld(dt);
  }

  function updateGame(dt) {
    state.sessionTime = Math.min(SANDBOX_SECONDS, state.sessionTime + dt);
    updateInputMovement(dt);
    updateTraversalToys(dt, true);
    updateHiddenLandmarks(dt, true);
    updateCreatures(dt, true);
    updateProps(dt);
    updateZoneAwareness(dt);
    updateGoals();
    updateMiniMissions();
    updateDirector(dt);
    updatePrompt(dt);
    updateCallout(dt);
    const drain = (state.curlHeld ? 0.36 : 0.2) + state.goalIndex * 0.028 + (state.desiccationActive ? 0.34 : 0);
    state.hydrate = clamp(state.hydrate - dt * drain, 0, 100);
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer <= 0) {
      state.combo = 0;
      state.lastComboAction = "";
    }
    state.scoreDeltaTimer = Math.max(0, state.scoreDeltaTimer - dt);
    if (state.scoreDeltaTimer <= 0) state.scoreDelta = 0;
    state.dashCooldown = Math.max(0, state.dashCooldown - dt);
    state.dashPulse = Math.max(0, state.dashPulse - dt);
    updateHUD();

    if (state.hydrate <= 0) {
      endGame("ANHYDROBIOSIS MODE", "You dried out heroically. The lab labeled it a feature.");
    }
  }

  function updateIdle(dt) {
    const player = state.player;
    player.vx *= Math.pow(0.001, dt);
    player.vz *= Math.pow(0.001, dt);
    player.wobble = Math.max(0, player.wobble - dt);
    updatePlayerTransform(dt);
    updateTraversalToys(dt, false);
    updateHiddenLandmarks(dt, false);
    updateCreatures(dt, false);
    updateDrift(dt);
    updateEffects(dt);
    updateCallout(dt);
  }

  function updateInputMovement(dt) {
    const player = state.player;
    const forwardInput = clamp(state.input.forward + state.input.virtualForward, -1, 1);
    const rightInput = clamp(state.input.right + state.input.virtualRight, -1, 1);
    const yaw = state.camera.targetYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let moveX = forwardX * forwardInput + rightX * rightInput;
    let moveZ = forwardZ * forwardInput + rightZ * rightInput;
    const length = Math.hypot(moveX, moveZ);
    if (length > 0.001) {
      moveX /= length;
      moveZ /= length;
      player.targetYaw = yaw;
    }

    const curl = state.curlHeld ? 0.76 : 1;
    const dashBoost = state.dashPulse > 0 ? 1.45 : 1;
    const maxSpeed = (state.player.grounded ? 12.4 : 8.6) * curl * dashBoost;
    const accel = state.player.grounded ? 34 : 14;
    const targetVX = moveX * maxSpeed;
    const targetVZ = moveZ * maxSpeed;
    const control = Math.min(1, dt * accel);
    const stopControl = Math.min(1, dt * 10.5);
    player.vx = lerp(player.vx, targetVX, length > 0.001 ? control : stopControl);
    player.vz = lerp(player.vz, targetVZ, length > 0.001 ? control : stopControl);
    if (state.curlHeld) {
      player.vx += Math.sin(state.clock * 12) * dt * 2;
      player.vz += Math.cos(state.clock * 10) * dt * 2;
    }

    const previousX = player.x;
    const previousZ = player.z;
    player.vy -= GRAVITY * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;
    resolvePlateauCollisions(previousX, previousZ);
    const groundY = groundYAt(player.x, player.z);
    if (player.y <= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    const dist = Math.hypot(player.x, player.z);
    const limit = WORLD_RADIUS - PLAYER_RADIUS - 0.8;
    if (dist > limit) {
      const nx = player.x / dist;
      const nz = player.z / dist;
      player.x = nx * limit;
      player.z = nz * limit;
      const dot = player.vx * nx + player.vz * nz;
      if (dot > 0) {
        player.vx -= dot * nx * 1.55;
        player.vz -= dot * nz * 1.55;
        addChaos(18, "Petri wall rebound");
      }
    }

    player.yaw = lerpAngle(player.yaw, player.targetYaw, Math.min(1, dt * 8));
    player.wobble = Math.max(0, player.wobble - dt * 1.6);
    if (length > 0.001 && player.grounded) player.wobble = Math.max(player.wobble, 0.16);
    updatePlayerTransform(dt);
  }

  function updateProps(dt) {
    const player = state.player;
    const playerSpeed = Math.hypot(player.vx, player.vz);
    stepPhysics(dt);

    for (let i = world.props.length - 1; i >= 0; i--) {
      const prop = world.props[i];
      const data = prop.userData;
      data.hitCooldown = Math.max(0, data.hitCooldown - dt);
      if (world.physics.ready && data.body) {
        const translation = data.body.translation();
        const linvel = data.body.linvel();
        prop.position.x = translation.x;
        prop.position.z = translation.z;
        data.velocity.set(linvel.x, 0, linvel.z);
      } else {
        prop.position.x += data.velocity.x * dt;
        prop.position.z += data.velocity.z * dt;
        data.velocity.multiplyScalar(Math.pow(0.06, dt));
      }

      data.baseY = data.baseHeight + terrainOffsetAt(prop.position.x, prop.position.z);
      prop.position.y = data.baseY + Math.sin(state.clock * 2.3 + i) * (data.type === "algae" ? 0.16 : 0.05);
      prop.scale.setScalar(isCurrentTargetProp(prop) ? 1.1 + Math.sin(state.clock * 8) * 0.12 : 1);
      prop.rotation.x += data.spin.x * dt + data.velocity.z * dt * 0.18;
      prop.rotation.y += data.spin.y * dt;
      prop.rotation.z += data.spin.z * dt - data.velocity.x * dt * 0.18;
      clampPropToDish(prop);

      const dx = prop.position.x - player.x;
      const dz = prop.position.z - player.z;
      const hitDistance = data.radius + PLAYER_RADIUS;
      const separation = Math.hypot(dx, dz);
      if (separation < hitDistance) {
        if (data.collect) {
          collectProp(prop, i);
          continue;
        }
        const nx = separation > 0.001 ? dx / separation : Math.cos(state.clock);
        const nz = separation > 0.001 ? dz / separation : Math.sin(state.clock);
        const impact = Math.max(5, playerSpeed * (state.dashPulse > 0 ? 2.35 : 1.1));
        if (handleSolidHit(prop, i, nx, nz, impact, playerSpeed)) continue;
        player.vx -= nx * 1.8;
        player.vz -= nz * 1.8;
        player.wobble = 0.45;
      }

      if (data.type === "droplet" && !data.moved) {
        const moved = Math.hypot(prop.position.x - data.spawnX, prop.position.z - data.spawnZ);
        if (moved > 3.2) {
          data.moved = true;
          state.waterMoved += 1;
          const comboInfo = extendCombo("water", 2, 4);
          const score = scoreWithCombo(360);
          addChaos(score, "Water droplet moved");
          showCallout("PUSHIN!", `+${score.toLocaleString()} water droplet moved${comboTag(comboInfo)}`);
          playTone("water", 1.3);
        }
      }

      if (state.goalIndex >= 3 && data.type === "pollen" && !data.delivered && handleRingDelivery(prop, i)) continue;
    }

    updateDrift(dt);
    updateEffects(dt);
  }

  function updateTraversalToys(dt, active) {
    const player = state.player;
    world.traversalToys.forEach((toy) => {
      const data = toy.userData;
      data.cooldown = Math.max(0, (data.cooldown || 0) - dt);
      data.justTriggered = Math.max(0, (data.justTriggered || 0) - dt);
      animateTraversalToy(toy, dt);
      if (!active || state.paused || state.gameOver) return;

      const dx = player.x - data.x;
      const dz = player.z - data.z;
      const distance = Math.hypot(dx, dz);
      if (distance > data.radius) return;

      if (data.type === "ridge") {
        assistRidgeToy(toy, dt);
        return;
      }
      if (data.cooldown > 0) return;
      if (data.type === "ramp") triggerRampToy(toy);
      if (data.type === "jumpPad") triggerJumpPadToy(toy);
      if (data.type === "geyser") triggerGeyserToy(toy, dx, dz, distance);
    });
  }

  function animateTraversalToy(toy, dt) {
    const data = toy.userData;
    const pulse = 1 + Math.sin(state.clock * 4.2 + data.pulse) * 0.035 + (data.justTriggered || 0) * 0.12;
    if (data.type === "jumpPad") {
      if (data.ring) data.ring.rotation.z += dt * 2.6;
      if (data.spring) data.spring.scale.y = pulse;
    } else if (data.type === "geyser") {
      if (data.plume) {
        data.plume.scale.y = 0.86 + Math.sin(state.clock * 3.1 + data.pulse) * 0.18 + (data.justTriggered || 0) * 0.28;
        data.plume.rotation.y += dt * 0.4;
      }
    } else if (data.type === "ridge") {
      if (data.marker) data.marker.rotation.y += dt * 1.2;
    }
  }

  function triggerRampToy(toy) {
    const data = toy.userData;
    const player = state.player;
    const forward = toyForward(data);
    player.vx = player.vx * 0.45 + forward.x * data.boost;
    player.vz = player.vz * 0.45 + forward.z * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.28);
    player.grounded = false;
    player.targetYaw = data.yaw;
    data.cooldown = 1.45;
    data.justTriggered = 0.42;
    awardTraversalToy(data, "RAMP YEET!", `${data.name} launched`, 280);
    playTone("jump", 1.35);
  }

  function triggerJumpPadToy(toy) {
    const data = toy.userData;
    const player = state.player;
    const speed = Math.hypot(player.vx, player.vz);
    const forward = speed > 1.2
      ? { x: player.vx / speed, z: player.vz / speed }
      : { x: -Math.sin(state.camera.targetYaw), z: -Math.cos(state.camera.targetYaw) };
    player.vx += forward.x * data.boost;
    player.vz += forward.z * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.36);
    player.grounded = false;
    data.cooldown = 1.2;
    data.justTriggered = 0.5;
    awardTraversalToy(data, "SPRING!", `${data.name} popped`, 320);
    playTone("level", 1.08);
  }

  function triggerGeyserToy(toy, dx, dz, distance) {
    const data = toy.userData;
    const player = state.player;
    const nx = distance > 0.01 ? dx / distance : Math.cos(state.clock);
    const nz = distance > 0.01 ? dz / distance : Math.sin(state.clock);
    player.vx += nx * data.boost;
    player.vz += nz * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.42);
    player.grounded = false;
    data.cooldown = 1.65;
    data.justTriggered = 0.6;
    awardTraversalToy(data, "GEYSER!", `${data.name} launched`, 360);
    spawnShards({ x: data.x, y: groundYAt(data.x, data.z) + 1.2, z: data.z }, world.materials.geyser, 5);
    playTone("water", 1.45);
  }

  function assistRidgeToy(toy, dt) {
    const data = toy.userData;
    const player = state.player;
    const forward = toyForward(data);
    player.vx = lerp(player.vx, forward.x * data.boost, Math.min(1, dt * 2.3));
    player.vz = lerp(player.vz, forward.z * data.boost, Math.min(1, dt * 2.3));
    if (player.grounded) player.vy = Math.max(player.vy, data.lift);
    player.grounded = false;
    data.justTriggered = Math.max(data.justTriggered || 0, 0.14);
    if (data.cooldown <= 0) {
      data.cooldown = 1.2;
      awardTraversalToy(data, "RIDGE CLIMB!", `${data.name} climbed`, 260);
      playTone("bonk", 1.2);
    }
  }

  function awardTraversalToy(data, title, message, baseScore) {
    const firstUse = !state.toysUsed.has(data.id);
    if (firstUse) {
      state.toysUsed.add(data.id);
      const comboInfo = extendCombo("traversal", 1, 4);
      const score = scoreWithCombo(baseScore);
      addChaos(score, message);
      showCallout(title, `+${score.toLocaleString()} ${message.toLowerCase()}${comboTag(comboInfo)}`);
    } else {
      showPrompt(`${data.name}: launch reset.`);
    }
  }

  function updateHiddenLandmarks(dt, active) {
    const player = state.player;
    world.landmarks.forEach((landmark) => {
      const data = landmark.userData;
      if (data.halo) data.halo.rotation.z += dt * (data.found ? 2.1 : 0.72);
      if (data.core) data.core.position.y = 1.35 + Math.sin(state.clock * 2.6 + data.pulse) * 0.08;
      if (!active || data.found) return;
      const distance = Math.hypot(player.x - data.x, player.z - data.z);
      if (distance > data.radius) return;
      data.found = true;
      state.landmarksFound.add(data.id);
      landmark.scale.setScalar(1.18);
      const comboInfo = extendCombo("landmark", 2, 4.5);
      const score = scoreWithCombo(480);
      addChaos(score, `${data.name} landmark found`);
      showCallout("LANDMARK FOUND!", `+${score.toLocaleString()} ${data.name}${comboTag(comboInfo)}`);
      showPrompt(`${data.name} discovered. ${state.landmarksFound.size}/${HIDDEN_LANDMARKS.length} hidden landmarks found.`);
      playTone("level", 1.2);
    });
  }

  function clampPropToDish(prop) {
    const data = prop.userData;
    const dist = Math.hypot(prop.position.x, prop.position.z);
    const limit = WORLD_RADIUS - data.radius - 0.9;
    if (dist <= limit) return;
    const nx = prop.position.x / dist;
    const nz = prop.position.z / dist;
    prop.position.x = nx * limit;
    prop.position.z = nz * limit;
    const dot = data.velocity.x * nx + data.velocity.z * nz;
    if (dot > 0) {
      data.velocity.x -= dot * nx * 1.65;
      data.velocity.z -= dot * nz * 1.65;
    }
    if (world.physics.ready && data.body) {
      data.body.setTranslation({ x: prop.position.x, y: 0, z: prop.position.z }, true);
      data.body.setLinvel({ x: data.velocity.x, y: 0, z: data.velocity.z }, true);
    }
  }

  function comboMultiplier() {
    return 1 + Math.min(2.4, Math.max(0, state.combo - 1) * 0.08);
  }

  function extendCombo(action, amount = 1, timer = 3.2) {
    const varied = !!state.lastComboAction && state.lastComboAction !== action;
    const gain = amount + (varied ? 1 : 0);
    state.combo += gain;
    state.lastComboAction = action;
    state.comboTimer = Math.max(state.comboTimer, timer + Math.min(1.3, state.combo * 0.045));
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    return { gain, varied, multiplier: comboMultiplier() };
  }

  function scoreWithCombo(base) {
    return Math.round(base * comboMultiplier());
  }

  function comboTag(comboInfo) {
    if (!comboInfo) return "";
    if (comboInfo.varied) return " variety chain";
    if (state.combo >= 8) return ` ${comboMultiplier().toFixed(1)}x chain`;
    return "";
  }

  function handleSolidHit(prop, index, nx, nz, impact, playerSpeed) {
    const data = prop.userData;
    const impulse = impact * Math.max(0.75, data.mass * 0.48);
    if (world.physics.ready && data.body) {
      data.body.applyImpulse({ x: nx * impulse, y: 0, z: nz * impulse }, true);
      data.body.applyTorqueImpulse({ x: nz * impulse * 0.09, y: impulse * 0.12, z: -nx * impulse * 0.09 }, true);
    } else {
      data.velocity.x += nx * impact / data.mass;
      data.velocity.z += nz * impact / data.mass;
    }

    if (data.hitCooldown > 0) return false;
    data.hitCooldown = 0.55;
    state.bonks += 1;

    const smashy = state.dashPulse > 0 || playerSpeed > 10.5;
    const comboInfo = extendCombo(data.type, data.type === "droplet" ? 2 : 1, smashy ? 3.9 : 3.25);
    const title = data.type === "bacteria"
      ? "BACTERIA BASHED!"
      : data.type === "droplet"
        ? "PUSHIN!"
        : data.type === "capsule"
          ? "YEET!"
          : data.type === "enzyme"
            ? "ENZYME CRACK!"
          : "BONK!";
    const message = {
      bacteria: "Bacteria bashed",
      droplet: "Hydro shove",
      capsule: "Capsule launched",
      enzyme: "Enzyme cracked",
      platelet: "Platelet skidded",
      spore: "Spore bounced",
      pollen: "Pollen bonked",
      cell: "Cell bumped",
      bubble: "Bubble booped",
      crystal: "Crystal clattered",
    }[data.type] || "Prop bonked";
    const score = scoreWithCombo(data.score + (smashy ? 90 : 0));
    if (data.type === "bacteria") state.bacteriaBashed += 1;
    addChaos(score, message);
    showCallout(title, `+${score.toLocaleString()} ${message.toLowerCase()}${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, rewardMaterialForType(data.type), smashy ? 9 : 5, smashy ? 1.18 : 0.82);
    playTone(smashy ? "break" : "bonk", smashy ? 1.45 : 1);

    if (data.destructible && smashy) {
      data.health -= 1;
      if (data.health <= 0) {
        state.propsBroken += 1;
        spawnShards(prop.position, data.type === "bacteria" ? world.materials.bacteria : data.type === "enzyme" ? world.materials.enzyme : world.materials.capsuleBlue, 7);
        removeProp(prop, index);
        return true;
      }
    }
    return false;
  }

  function handleRingDelivery(prop, index) {
    const ringDistance = Math.hypot(prop.position.x - RING_TARGET.x, prop.position.z - RING_TARGET.z);
    if (ringDistance >= RING_TARGET.radius * 0.94) return false;
    const data = prop.userData;
    data.delivered = true;
    state.ringFed += 1;
    const comboInfo = extendCombo("ring", 2, 4.4);
    const score = scoreWithCombo(520);
    addChaos(score, "Nutrient ring fed");
    showPrompt("Ring fed. Keep bullying the pollen.");
    showCallout("FED!", `+${score.toLocaleString()} nutrient ring fed${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, world.materials.ring, 12, 1.15);
    spawnRewardBurst({ x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) + 0.7, z: RING_TARGET.z }, world.materials.ringCore, 8, 0.9);
    playTone("level", 0.8);
    removeProp(prop, index);
    return true;
  }

  function removeProp(prop, index) {
    removePhysicsBody(prop);
    prop.visible = false;
    world.scene.remove(prop);
    disposeObject(prop);
    world.props.splice(index, 1);
  }

  function collectProp(prop, index) {
    state.snacks += 1;
    state.hydrate = clamp(state.hydrate + 13, 0, 100);
    const comboInfo = extendCombo("algae", 1, 3.7);
    const score = scoreWithCombo(160);
    addChaos(score, "Algae snack");
    const remaining = Math.max(0, GOAL_TARGETS.algae - state.snacks);
    showPrompt(state.goalIndex === 0 && remaining > 0 ? `${remaining} algae snack left. Follow the next yellow target.` : "Algae absorbed. Hydration restored.");
    showCallout("MUNCH!", `+${score.toLocaleString()} algae delicious${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, world.materials.algae, 10, 0.88);
    playTone("munch", 1.1);
    removeProp(prop, index);
    addProp("algae", randomPoint(WORLD_RADIUS - 5));
  }

  function addChaos(amount, message) {
    const rounded = Math.round(amount);
    state.chaos += amount;
    state.scoreDelta += rounded;
    state.scoreDeltaTimer = 1.15;
    addXp(Math.max(12, Math.round(rounded * 0.42)));
    if (message) el.labLog.textContent = `Lab log: ${message}. Chaos +${rounded}.`;
  }

  function xpTarget() {
    return 300 + (state.level - 1) * 220;
  }

  function addXp(amount) {
    state.xp += amount;
    let target = xpTarget();
    while (state.xp >= target) {
      state.xp -= target;
      state.level += 1;
      state.hydrate = clamp(state.hydrate + 15, 0, 100);
      target = xpTarget();
      showCallout("LEVEL UP!", `Tardigrade level ${state.level}`);
      playTone("level", 1.4);
    }
  }

  function showCallout(title, sub) {
    if (!el.callout || !el.calloutTitle || !el.calloutSub) return;
    el.calloutTitle.textContent = title;
    el.calloutSub.textContent = sub;
    el.callout.classList.add("micro-callout--show");
    state.calloutTimer = 1.35;
  }

  function updateCallout(dt) {
    state.calloutTimer = Math.max(0, state.calloutTimer - dt);
    if (state.calloutTimer <= 0 && el.callout) el.callout.classList.remove("micro-callout--show");
  }

  function spawnShards(position, material, count) {
    const THREE = window.THREE;
    for (let i = 0; i < count; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(rand(0.16, 0.42), 0), material || world.materials.shard);
      shard.position.set(position.x + rand(-0.35, 0.35), position.y + rand(0.1, 0.8), position.z + rand(-0.35, 0.35));
      shard.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      shard.castShadow = true;
      shard.userData.life = rand(0.75, 1.2);
      shard.userData.maxLife = shard.userData.life;
      shard.userData.velocity = new THREE.Vector3(rand(-4.4, 4.4), rand(3.8, 7.4), rand(-4.4, 4.4));
      shard.userData.spin = new THREE.Vector3(rand(-5, 5), rand(-7, 7), rand(-5, 5));
      world.scene.add(shard);
      world.effects.push(shard);
    }
  }

  function rewardMaterialForType(type) {
    return {
      algae: world.materials.algae,
      bacteria: world.materials.bacteria,
      droplet: world.materials.droplet,
      pollen: world.materials.pollen,
      capsule: world.materials.capsuleBlue,
      enzyme: world.materials.enzyme,
      platelet: world.materials.platelet,
      spore: world.materials.spore,
      crystal: world.materials.crystal,
      bubble: world.materials.bubble,
      cell: world.materials.cell,
    }[type] || world.materials.shard;
  }

  function spawnRewardBurst(position, material, count, power = 1) {
    const THREE = window.THREE;
    if (!position || !material) return;
    for (let i = 0; i < count; i++) {
      const mote = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.08, 0.24), 0), material);
      mote.position.set(
        position.x + rand(-0.4, 0.4),
        (position.y || 0.8) + rand(0.18, 0.84),
        position.z + rand(-0.4, 0.4)
      );
      mote.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      mote.userData.life = rand(0.42, 0.82);
      mote.userData.maxLife = mote.userData.life;
      mote.userData.velocity = new THREE.Vector3(rand(-3.2, 3.2) * power, rand(2.8, 6.4) * power, rand(-3.2, 3.2) * power);
      mote.userData.spin = new THREE.Vector3(rand(-7, 7), rand(-8, 8), rand(-7, 7));
      world.scene.add(mote);
      world.effects.push(mote);
    }
  }

  function updateEffects(dt) {
    for (let i = world.effects.length - 1; i >= 0; i--) {
      const effect = world.effects[i];
      const data = effect.userData;
      data.life -= dt;
      data.velocity.y -= 9.5 * dt;
      effect.position.addScaledVector(data.velocity, dt);
      effect.rotation.x += data.spin.x * dt;
      effect.rotation.y += data.spin.y * dt;
      effect.rotation.z += data.spin.z * dt;
      const scale = clamp(data.life / data.maxLife, 0, 1);
      effect.scale.setScalar(scale);
      if (data.life <= 0 || effect.position.y < -0.1) {
        world.scene.remove(effect);
        disposeObject(effect);
        world.effects.splice(i, 1);
      }
    }
  }

  function getCurrentZone() {
    let active = null;
    let bestDistance = Infinity;
    SANDBOX_ZONES.forEach((zone) => {
      const distance = Math.hypot(state.player.x - zone.x, state.player.z - zone.z);
      if (distance < zone.radius && distance < bestDistance) {
        active = zone;
        bestDistance = distance;
      }
    });
    return active;
  }

  function updateZoneAwareness() {
    const zone = getCurrentZone();
    const nextId = zone ? zone.id : "";
    const nextName = zone ? zone.name : "Open Dish";
    if (state.zoneId === nextId) return;

    state.zoneId = nextId;
    state.zoneName = nextName;
    if (!zone) return;

    const firstVisit = !state.zonesVisited.has(zone.id);
    state.zonesVisited.add(zone.id);
    showPrompt(`${zone.name}: ${zoneHint(zone.id)}`);
    if (firstVisit) {
      addChaos(180 + state.zonesVisited.size * 60, `${zone.name} discovered`);
      showCallout("ZONE FOUND!", zone.name);
      playTone("level", 0.72);
    }
  }

  function zoneHint(zoneId) {
    return {
      forest: "chain algae snacks through the green thicket.",
      flats: "shove droplets and skid platelets across the blue flats.",
      reef: "dash into bacteria, enzymes, and capsules for big bonks.",
      ridge: "climb the spore ridge for crystals, spores, and pollen.",
    }[zoneId] || "free-roam the dish.";
  }

  function updateMiniMissions() {
    if (!state.running || state.paused || state.gameOver) return;
    MINI_MISSIONS.forEach((mission) => {
      if (state.miniComplete.has(mission.id)) return;
      if (mission.progress() < mission.target) return;
      state.miniComplete.add(mission.id);
      const bonus = 420 + state.miniComplete.size * 90;
      addChaos(bonus, `${mission.title} mini-mission`);
      showCallout("MISSION CLEAR!", `${mission.title} +${bonus.toLocaleString()}`);
      showPrompt(`${mission.title} complete. Keep the five-minute chaos run rolling.`);
      playTone("level", 1.05);
    });
  }

  function miniMissionsComplete() {
    return state.miniComplete.size >= MINI_MISSIONS.length;
  }

  function updateGoals() {
    const goal = GOALS[state.goalIndex];
    if (!goal) return;
    if (goal.progress() >= goal.target) {
      const completed = goal;
      state.goalIndex += 1;
      state.goalsCleared += 1;
      addChaos(250 + state.goalsCleared * 75, `${completed.title} complete`);
      if (state.goalIndex >= GOALS.length) {
        winGame();
        return;
      }
      updateGoalText();
      showCallout("GOAL CLEAR!", completed.title);
      announceGoal("Next specimen task:");
      if (!isTouchLayout()) api.toast("Goal complete", "good");
    }
  }

  function updateDirector(dt) {
    if (!state.running || state.paused || state.gameOver) return;
    state.tipTimer = Math.max(0, state.tipTimer - dt);
    if (!state.desiccationActive && state.clock > 52 && state.goalIndex >= 2) {
      state.desiccationActive = true;
      showCallout("DRY FRONT!", "hydrate drain rising");
      showPrompt("Desiccation front incoming. Munch algae or finish the incident.");
      playTone("break", 0.8);
    }
    if (state.tipTimer <= 0) {
      announceGoal();
      state.tipTimer = state.desiccationActive ? 7 : 9;
    }
  }

  function announceGoal(prefix = "") {
    const goal = GOALS[state.goalIndex] || GOALS[GOALS.length - 1];
    const hint = getGoalHint(goal);
    const message = prefix ? `${prefix} ${hint}` : hint;
    showPrompt(message);
  }

  function getGoalHint(goal) {
    if (!goal) return "";
    return isTouchLayout() && goal.mobileHint ? goal.mobileHint : goal.hint;
  }

  function isTouchLayout() {
    return !!(window.matchMedia && (
      window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
      window.matchMedia("(max-width: 900px)").matches
    ));
  }

  function updateGoalText() {
    const goal = GOALS[state.goalIndex] || GOALS[GOALS.length - 1];
    el.objectiveTitle.textContent = goal.title;
    el.objectiveText.textContent = goal.text;
    el.goalCardTitle.textContent = goal.title;
    el.goalCardText.textContent = goal.text;
  }

  function formatGoalProgress(goal, value) {
    if (goal && goal.kind === "time") return `${formatTime(value)} / ${formatTime(goal.target)}`;
    return `${Math.floor(value).toLocaleString()} / ${goal.target.toLocaleString()}`;
  }

  function missionById(id) {
    return MINI_MISSIONS.find((mission) => mission.id === id);
  }

  function updateMissionHUD() {
    el.missionElements.forEach((node) => {
      const mission = missionById(node.dataset.mission);
      if (!mission) return;
      const progress = Math.min(mission.progress(), mission.target);
      node.textContent = `${Math.floor(progress).toLocaleString()}/${mission.target.toLocaleString()}`;
      node.classList.toggle("is-complete", progress >= mission.target);
    });
  }

  function updatePrompt(dt) {
    state.promptTimer = Math.max(0, state.promptTimer - dt);
    if (state.promptTimer <= 0) el.prompt.classList.remove("micro-prompt--show");
  }

  function showPrompt(message) {
    el.prompt.textContent = message;
    el.prompt.classList.add("micro-prompt--show");
    state.promptTimer = 3.2;
  }

  function updatePlayerTransform(dt) {
    const p = state.player;
    if (!world.tardigrade) return;
    world.tardigrade.position.set(p.x, p.y, p.z);
    world.tardigrade.rotation.y = p.yaw;
    const speed = Math.hypot(p.vx, p.vz);
    const curl = state.curlHeld ? 0.55 : 0;
    world.tardigrade.rotation.x = lerp(world.tardigrade.rotation.x, curl + (p.grounded ? 0 : -0.26), Math.min(1, dt * 8));
    world.tardigrade.rotation.z = lerp(world.tardigrade.rotation.z, Math.sin(state.clock * 12) * p.wobble * 0.28, Math.min(1, dt * 8));

    const bob = state.reducedMotion ? 0 : Math.sin(state.clock * (speed * 0.5 + 5)) * Math.min(0.16, speed * 0.015);
    world.bodySegments.forEach((segment, index) => {
      const base = segment.userData.base;
      segment.position.y = base.y + bob + Math.sin(state.clock * 4.2 + segment.userData.phase) * 0.035;
      segment.scale.y = (index === 0 ? 0.9 : 1.02) + Math.sin(state.clock * 5 + index) * 0.015;
    });

    world.legs.forEach((leg) => {
      const phase = state.clock * (speed * 1.2 + 4.2) + leg.userData.phase;
      const swing = Math.sin(phase) * Math.min(0.45, 0.12 + speed * 0.025);
      leg.rotation.x = state.curlHeld ? 0.8 : swing;
      leg.rotation.z = leg.userData.side * (state.curlHeld ? 0.34 : 0.08);
    });

    world.feelers.forEach((feeler, index) => {
      feeler.rotation.z = (index ? 0.22 : -0.22) + Math.sin(state.clock * 4 + index) * 0.16;
    });

  }

  function updateDrift(dt) {
    world.drift.forEach((item, index) => {
      const phase = item.userData.phase || 0;
      if (item.children && item.children.length && !item.geometry) {
        if (typeof item.userData.baseY === "number") {
          item.position.y = item.userData.baseY + Math.sin(state.clock * (item.userData.speed || 0.6) + phase) * 0.56;
        }
        item.rotation.x = Math.sin(state.clock * 1.2 + phase) * 0.08;
        item.rotation.z = Math.cos(state.clock * 1.1 + phase) * 0.08;
      } else {
        item.position.y = item.userData.baseY + Math.sin(state.clock * item.userData.speed + phase) * 0.48;
        item.rotation.x += dt * 0.25;
        item.rotation.y += dt * (0.18 + index * 0.003);
      }
    });
  }

  function updateAtmosphere(dt) {
    world.atmosphere.forEach((item, index) => {
      const phase = item.userData.phase || 0;
      const pulse = 0.5 + Math.sin(state.clock * 0.85 + phase) * 0.5;
      if (item.material && item.material.transparent) {
        item.material.opacity = (item.userData.baseOpacity || 0.16) * (0.55 + pulse * 0.7);
      }
      if (item.userData.baseScale) {
        const scale = 1 + Math.sin(state.clock * 0.55 + phase) * 0.035;
        item.scale.set(
          item.userData.baseScale.x * scale,
          item.userData.baseScale.y * (1 + Math.sin(state.clock * 0.48 + phase + 1.2) * 0.025),
          item.userData.baseScale.z * scale
        );
      }
      if (item.geometry && item.geometry.type === "TorusGeometry") {
        item.rotation.z += dt * (0.02 + index * 0.0008);
      }
    });
  }

  function renderWorld(dt) {
    if (!world.renderer || !world.camera) return;
    updateCamera(dt);
    if (world.ring) {
      world.ring.rotation.y += dt * 0.6;
      world.ring.scale.setScalar(1 + Math.sin(state.clock * 3) * 0.025);
    }
    updateGuideBeacon(dt);
    updateTargetMarker();
    updateAtmosphere(dt);
    if (world.boundary) world.boundary.rotation.z += dt * 0.035;
    world.renderer.render(world.scene, world.camera);
  }

  function isCurrentTargetProp(prop) {
    const type = prop && prop.userData && prop.userData.type;
    if (state.goalIndex === 0) return type === "algae";
    if (state.goalIndex === 1) return type === "bacteria";
    if (state.goalIndex === 2) return type === "droplet";
    if (state.goalIndex === 3) return type === "pollen";
    return type === "bacteria" || type === "droplet" || type === "capsule" || type === "enzyme" || type === "platelet" || type === "spore";
  }

  function updateGuideBeacon(dt) {
    if (!world.guide) return;
    const target = getGuideTarget();
    world.guide.visible = !!target && state.running && !state.paused && !state.gameOver;
    if (!target) return;
    world.guide.position.set(target.x, target.y || 0.12, target.z);
    world.guide.rotation.y += dt * 2.4;
    world.guide.scale.setScalar(1 + Math.sin(state.clock * 5.5) * 0.08);
    if (world.guide.userData.pointer) {
      world.guide.userData.pointer.position.y = 2.1 + Math.sin(state.clock * 5.2) * 0.22;
    }
  }

  function updateTargetMarker() {
    if (!el.targetMarker || !world.camera || !state.running || state.paused || state.gameOver) {
      hideTargetMarker();
      return;
    }

    const target = getGuideTarget();
    if (!target) {
      hideTargetMarker();
      return;
    }

    const THREE = window.THREE;
    const markerPoint = new THREE.Vector3(target.x, (target.y || 0) + 3.0, target.z);
    markerPoint.project(world.camera);
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement.getBoundingClientRect();
    const projectedX = (markerPoint.x * 0.5 + 0.5) * canvasRect.width + (canvasRect.left - parentRect.left);
    const projectedY = (-markerPoint.y * 0.5 + 0.5) * canvasRect.height + (canvasRect.top - parentRect.top);
    const marginX = isTouchLayout() ? 58 : 70;
    const marginTop = isTouchLayout() ? 84 : 74;
    const marginBottom = isTouchLayout() ? 178 : 92;
    const x = clamp(projectedX, marginX, parentRect.width - marginX);
    const y = clamp(projectedY, marginTop, parentRect.height - marginBottom);
    const distance = Math.hypot(target.x - state.player.x, target.z - state.player.z);

    el.targetMarker.style.left = `${x.toFixed(1)}px`;
    el.targetMarker.style.top = `${y.toFixed(1)}px`;
    if (el.targetMarkerTitle) el.targetMarkerTitle.textContent = targetMarkerTitle();
    if (el.targetMarkerDistance) el.targetMarkerDistance.textContent = `${Math.max(1, Math.round(distance))} um`;
    el.targetMarker.classList.add("is-visible");
  }

  function hideTargetMarker() {
    if (el.targetMarker) el.targetMarker.classList.remove("is-visible");
  }

  function targetMarkerTitle() {
    if (state.goalIndex === 0) return "Eat algae";
    if (state.goalIndex === 1) return "Bonk bacteria";
    if (state.goalIndex === 2) return "Push water";
    if (state.goalIndex === 3) return "Feed ring";
    if (state.goalIndex === 4) return "Make chaos";
    return "Stay hydrated";
  }

  function getGuideTarget() {
    if (!state.running) return null;
    if (state.goalIndex === 3) {
      const pollen = findProp("pollen", "ring");
      if (pollen) return { x: pollen.position.x, y: pollen.userData.baseY + 0.1, z: pollen.position.z };
      return { x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) - 0.2, z: RING_TARGET.z };
    }
    const type = state.goalIndex === 0
      ? "algae"
      : state.goalIndex === 1
        ? "bacteria"
        : state.goalIndex === 2
          ? "droplet"
          : null;
    const prop = type
      ? findProp(type, "player")
      : findProp("bacteria", "player") || findProp("droplet", "player") || findProp("capsule", "player") || findProp("enzyme", "player") || findProp("platelet", "player");
    if (!prop) return state.goalIndex >= 3 ? { x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) - 0.2, z: RING_TARGET.z } : null;
    return { x: prop.position.x, y: prop.userData.baseY + 0.1, z: prop.position.z };
  }

  function findProp(type, mode) {
    let best = null;
    let bestDistance = Infinity;
    world.props.forEach((prop) => {
      if (!prop.visible || prop.userData.type !== type) return;
      const dx = mode === "ring" ? prop.position.x - RING_TARGET.x : prop.position.x - state.player.x;
      const dz = mode === "ring" ? prop.position.z - RING_TARGET.z : prop.position.z - state.player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = prop;
      }
    });
    return best;
  }

  function updateCamera(dt) {
    const THREE = window.THREE;
    const p = state.player;
    state.camera.yaw = lerpAngle(state.camera.yaw, state.camera.targetYaw, Math.min(1, dt * 6));
    state.camera.pitch = lerp(state.camera.pitch, state.camera.targetPitch, Math.min(1, dt * 6));
    const distance = 20.8;
    const height = 6.8 + state.camera.pitch * 10.6;
    const yaw = state.camera.yaw;
    const desired = new THREE.Vector3(
      p.x + Math.sin(yaw) * distance,
      p.y + height,
      p.z + Math.cos(yaw) * distance
    );
    const lookAhead = new THREE.Vector3(-Math.sin(p.targetYaw || yaw) * 2.4, 0, -Math.cos(p.targetYaw || yaw) * 2.4);
    const lookAt = new THREE.Vector3(p.x + lookAhead.x, p.y + 1.48, p.z + lookAhead.z);
    if (!world.camera.userData.ready) {
      world.camera.position.copy(desired);
      world.camera.userData.ready = true;
    } else {
      world.camera.position.lerp(desired, Math.min(1, dt * 4.4));
    }
    world.camera.lookAt(lookAt);
  }

  function updateHUD() {
    const goal = GOALS[state.goalIndex] || GOALS[GOALS.length - 1];
    const progress = clamp(goal.progress(), 0, goal.target);
    const goalPercent = goal.target > 0 ? progress / goal.target : 1;
    const dashPercent = state.dashCooldown <= 0 ? 100 : (1 - state.dashCooldown / 1.1) * 100;

    el.chaos.textContent = format(state.chaos);
    el.snacks.textContent = state.snacks.toLocaleString();
    el.hydrate.textContent = percent(state.hydrate);
    el.combo.textContent = `${state.combo}x`;
    if (el.time) el.time.textContent = formatTime(SANDBOX_SECONDS - state.sessionTime);
    el.goal.textContent = `${Math.min(state.goalIndex + 1, GOALS.length)}/${GOALS.length}`;
    el.high.textContent = api.getHighScore(GAME_ID).toLocaleString();
    el.goalCardProgress.textContent = formatGoalProgress(goal, progress);
    el.dashStatus.textContent = state.dashCooldown <= 0 ? "Ready" : `${Math.ceil(state.dashCooldown * 10) / 10}s`;
    el.ringStatus.textContent = `${Math.min(state.ringFed, missionById("ring").target)}/${missionById("ring").target}`;
    if (el.zoneStatus) el.zoneStatus.textContent = state.zoneName;
    if (el.arcadeScore) el.arcadeScore.textContent = format(state.chaos);
    if (el.arcadeDelta) {
      el.arcadeDelta.textContent = state.scoreDeltaTimer > 0 && state.scoreDelta > 0 ? `+${state.scoreDelta.toLocaleString()}` : "";
    }
    if (el.arcadeLevel) el.arcadeLevel.textContent = state.level.toLocaleString();
    if (el.arcadeXp) el.arcadeXp.style.width = percent((state.xp / xpTarget()) * 100);
    if (el.arcadeXpText) el.arcadeXpText.textContent = `${Math.floor(state.xp).toLocaleString()} / ${xpTarget().toLocaleString()}`;
    updateMissionHUD();
    updatePhysicsStatus();

    el.meterHydrate.style.width = percent(state.hydrate);
    el.meterHydrate.style.background = state.hydrate < 28 ? "var(--bad)" : "#53ead1";
    el.meterHydrateText.textContent = percent(state.hydrate);
    el.meterDash.style.width = percent(dashPercent);
    el.meterDash.style.background = state.dashCooldown <= 0 ? "#ffd43b" : "#8c6bff";
    el.meterDashText.textContent = percent(dashPercent);
    el.meterGoal.style.width = percent(goalPercent * 100);
    el.meterGoal.style.background = "#6bff7d";
    el.meterGoalText.textContent = percent(goalPercent * 100);
    updatePlayMeters(dashPercent, goalPercent);
    updateRadar();
  }

  function updatePlayMeters(dashPercent, goalPercent) {
    if (el.playMeterHydrate) {
      el.playMeterHydrate.style.width = percent(state.hydrate);
      el.playMeterHydrate.style.background = state.hydrate < 28 ? "var(--bad)" : "#53ead1";
    }
    if (el.playMeterHydrateText) el.playMeterHydrateText.textContent = percent(state.hydrate);
    if (el.playMeterDash) {
      el.playMeterDash.style.width = percent(dashPercent);
      el.playMeterDash.style.background = state.dashCooldown <= 0 ? "#ffd43b" : "#8c6bff";
    }
    if (el.playMeterDashText) el.playMeterDashText.textContent = percent(dashPercent);
    if (el.playMeterGoal) {
      el.playMeterGoal.style.width = percent(goalPercent * 100);
      el.playMeterGoal.style.background = "#6bff7d";
    }
    if (el.playMeterGoalText) el.playMeterGoalText.textContent = percent(goalPercent * 100);
  }

  function updateRadar() {
    if (!el.radar) return;
    const active = state.running && !state.gameOver;
    el.radar.classList.toggle("is-active", active);
    if (!active) {
      [el.radarRing, el.radarGoal, el.radarToy, el.radarLandmark].forEach((node) => {
        if (node) node.style.opacity = "0";
      });
      return;
    }

    const guideTarget = getGuideTarget();
    const nearestToy = nearestRadarTarget(world.traversalToys, (toy) => !state.toysUsed.has(toy.userData.id));
    const nearestLandmark = nearestRadarTarget(world.landmarks, (landmark) => !landmark.userData.found);
    const ringTarget = { x: RING_TARGET.x, z: RING_TARGET.z };

    placeRadarBlip(el.radarRing, ringTarget);
    placeRadarBlip(el.radarGoal, guideTarget);
    placeRadarBlip(el.radarToy, nearestToy);
    placeRadarBlip(el.radarLandmark, nearestLandmark);

    if (el.radarPlayer) {
      const turn = lerpAngle(state.camera.yaw, state.player.yaw, 1);
      el.radarPlayer.style.transform = `translate(-50%, -50%) rotate(${turn - state.camera.yaw}rad)`;
    }

    if (el.radarDistance) {
      const target = guideTarget || nearestToy || nearestLandmark || ringTarget;
      const distance = Math.hypot(target.x - state.player.x, target.z - state.player.z);
      el.radarDistance.textContent = `${Math.round(distance)} um`;
    }
  }

  function nearestRadarTarget(items, predicate) {
    let nearest = null;
    let best = Infinity;
    items.forEach((item) => {
      if (!item || !item.userData || (predicate && !predicate(item))) return;
      const x = item.userData.x ?? item.position.x;
      const z = item.userData.z ?? item.position.z;
      const distance = Math.hypot(x - state.player.x, z - state.player.z);
      if (distance < best) {
        best = distance;
        nearest = { x, z };
      }
    });
    return nearest;
  }

  function placeRadarBlip(node, target) {
    if (!node) return;
    if (!target) {
      node.style.opacity = "0";
      return;
    }
    const player = state.player;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const yaw = state.camera.yaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const localX = dx * rightX + dz * rightZ;
    const localY = dx * forwardX + dz * forwardZ;
    const radarRadius = 52;
    const visibleWorldRadius = WORLD_RADIUS * 0.7;
    const rawX = localX * (radarRadius / visibleWorldRadius);
    const rawY = -localY * (radarRadius / visibleWorldRadius);
    const distance = Math.hypot(rawX, rawY);
    const clamped = distance > radarRadius;
    const scale = clamped ? radarRadius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    node.style.opacity = "1";
    node.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${clamped ? 0.82 : 1})`;
  }

  function showOverlay(title, sub, buttonText, scoreHtml = "") {
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.style.display = scoreHtml ? "block" : "none";
    el.overlayScore.innerHTML = scoreHtml;
    el.primary.textContent = buttonText;
    el.overlay.classList.toggle("overlay--report", !!scoreHtml);
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
    el.overlay.classList.remove("overlay--report");
  }

  function endGame(title, reason) {
    state.gameOver = true;
    state.running = false;
    syncPlayMode();
    const finalScore = Math.floor(state.chaos + state.snacks * 80 + state.ringFed * 500 + state.miniComplete.size * 300 + state.zonesVisited.size * 150 + state.toysUsed.size * 160 + state.landmarksFound.size * 420 + state.maxCombo * 35);
    const high = api.recordScore(GAME_ID, finalScore);
    showOverlay(
      title,
      reason,
      "Restart specimen",
      buildIncidentReport("Desiccated", finalScore, high)
    );
  }

  function winGame() {
    state.gameOver = true;
    state.running = false;
    state.goalsCleared = Math.max(state.goalsCleared, GOALS.length);
    syncPlayMode();
    const finalScore = Math.floor(state.chaos + state.snacks * 120 + state.ringFed * 650 + state.hydrate * 8 + state.miniComplete.size * 420 + state.zonesVisited.size * 220 + state.toysUsed.size * 220 + state.landmarksFound.size * 520 + state.maxCombo * 45);
    const high = api.recordScore(GAME_ID, finalScore);
    showOverlay(
      "LAB INCIDENT REPORT",
      "The dish is ruined, the tardigrade is thriving, and the lab notebook has stopped making eye contact.",
      "Cause more mayhem",
      buildIncidentReport("Contained chaos", finalScore, high)
    );
  }

  function buildIncidentReport(outcome, finalScore, high) {
    const rows = [
      ["Outcome", outcome],
      ["Goals cleared", `${Math.min(state.goalsCleared, GOALS.length)} / ${GOALS.length}`],
      ["Run time", `${formatTime(state.sessionTime)} / ${formatTime(SANDBOX_SECONDS)}`],
      ["Mini-missions", `${state.miniComplete.size} / ${MINI_MISSIONS.length}`],
      ["Zones visited", `${state.zonesVisited.size} / ${SANDBOX_ZONES.length}`],
      ["Traversal toys", `${state.toysUsed.size} / ${TRAVERSAL_TOYS.length}`],
      ["Landmarks found", `${state.landmarksFound.size} / ${HIDDEN_LANDMARKS.length}`],
      ["Algae eaten", state.snacks.toLocaleString()],
      ["Bacteria bashed", state.bacteriaBashed.toLocaleString()],
      ["Droplets moved", state.waterMoved.toLocaleString()],
      ["Ring feeds", state.ringFed.toLocaleString()],
      ["Props broken", state.propsBroken.toLocaleString()],
      ["Peak combo", `${state.maxCombo}x`],
      ["Level", state.level.toLocaleString()],
    ];
    return `
      <div class="micro-report">
        <div class="micro-report__score">
          <span>Final score</span>
          <strong>${finalScore.toLocaleString()}</strong>
          <em>${high ? "New high score" : "High " + api.getHighScore(GAME_ID).toLocaleString()}</em>
        </div>
        <div class="micro-report__grid">
          ${rows.map(([label, value]) => `<span>${label}</span><b>${value}</b>`).join("")}
        </div>
      </div>
    `;
  }

  function resize() {
    if (!world.renderer || !world.camera) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || canvas.width));
    const height = Math.max(220, Math.round(rect.height || canvas.height));
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  }

  function lerpAngle(a, b, t) {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
  }

  window.__MICRO_MAYHEM_DEBUG = { state, world };
  loadThree();
})();
