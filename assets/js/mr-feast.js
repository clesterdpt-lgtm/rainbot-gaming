/* ============================================================
   Mr. Feast: Deadline Mansion
   3D horror parody game for Rainbot Gaming.
   Plain Three.js, no build step, procedural assets.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "mrfeast3d";
  const TASK_TOTAL = 6;
  const PLAYER_RADIUS = 0.62;
  const HOST_RADIUS = 0.86;
  const FINAL_ESCAPE_SECONDS = 62;
  const LOOK_SETTINGS_KEY = "mrfeast-look-settings";
  const DEFAULT_LOOK_SETTINGS = {
    lookSensitivity: 1,
    invertY: false,
  };
  const EYE_HEIGHT = 1.65;
  const UPPER_FLOOR_Y = 4.18;
  const STAIR_TRAVEL_SECONDS = 1.05;
  const STAIR_BOTTOM = { x: 4.8, z: 31.55, level: 0, yaw: 0.04 };
  const STAIR_TOP = { x: 8.2, z: 24.4, level: 1, yaw: 0.02 };
  const DETOUR_PANEL = {
    x: 0,
    z: 0.8,
    label: "Release",
    seconds: 3.4,
  };
  const THREE_SOURCES = [
    "../assets/vendor/three/three-r128.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  ];

  const TASK_DEFS = [
    {
      id: "lobby",
      title: "Disable the foyer camera",
      room: "Foyer",
      x: -2.4,
      z: 22.5,
      seconds: 2.1,
      score: 1100,
      type: "camera",
      line: "Camera one blinked. The mansion briefly remembered privacy.",
    },
    {
      id: "pizza",
      title: "Kill the kitchen oven feed",
      room: "Kitchen",
      x: -25.8,
      z: 17.4,
      seconds: 2.7,
      score: 1300,
      type: "pizza",
      line: "The pizza screamed only in mozzarella. Probably fine.",
    },
    {
      id: "cash",
      title: "Jam the dining room prize drop",
      room: "Dining Room",
      x: 31.4,
      z: 19.0,
      seconds: 2.5,
      score: 1450,
      type: "cash",
      line: "The cash cannon coughed up one coupon and retired.",
    },
    {
      id: "breaker",
      title: "Trip the bedroom vanity breaker",
      room: "Main Bedroom",
      x: -25.8,
      z: -15.5,
      seconds: 3.0,
      score: 1500,
      type: "breaker",
      line: "Half the ring lights died. Somewhere, a thumbnail lost contrast.",
    },
    {
      id: "sponsor",
      title: "Mute the utility room sponsor siren",
      room: "Utility Hall",
      x: 0.2,
      z: -7.8,
      seconds: 2.8,
      score: 1600,
      type: "siren",
      line: "The sponsor siren stopped chanting promo codes in Latin.",
    },
    {
      id: "contract",
      title: "Shred the office bonus contract",
      room: "Home Office",
      x: 30.8,
      z: -14.0,
      seconds: 3.2,
      score: 1900,
      type: "contract",
      line: "The contract shredded itself into several smaller lawsuits.",
    },
  ];

  const HOST_PATROL = [
    { x: 0, z: 25 },
    { x: -24, z: 17 },
    { x: 0, z: 10 },
    { x: 24, z: 15 },
    { x: 0, z: -3 },
    { x: -24, z: -15 },
    { x: 0, z: -25 },
    { x: 25, z: -17 },
    { x: 0, z: 25 },
  ];

  const NAV_POINTS = [
    { x: 0, z: 27 },
    { x: 0, z: 18 },
    { x: -8.8, z: 18 },
    { x: -24, z: 18 },
    { x: 8.8, z: 16 },
    { x: 24, z: 16 },
    { x: 0, z: 2 },
    { x: 0, z: -10 },
    { x: -8.8, z: -13 },
    { x: -24, z: -13 },
    { x: 8.8, z: -15 },
    { x: 24, z: -15 },
    { x: 0, z: -31 },
  ];

  const ANNOUNCEMENTS = [
    "Contestant #4 accepted a room-temperature steak and vanished from the waiver.",
    "Contestant #8 asked for a lawyer. The confessional booth laughed.",
    "Contestant #2 opened a sponsor box. It opened back.",
    "Contestant #6 tried to nap. The cameras considered that content.",
    "Contestant #9 took the mystery briefcase. It was full of more cameras.",
    "Contestant #3 left for a sandwich and became a cautionary B-roll package.",
    "Contestant #7 signed the extended cut. Nobody has seen the extended cut.",
  ];

  const ALERT_LINES = [
    "Mr. Feast: Smile bigger. The exits hate uncertainty.",
    "Producer: Contestant heartbeat trending well with advertisers.",
    "Mr. Feast: If you leave now, you win a smaller prison.",
    "PA system: Please do not feed the cash cannon after midnight.",
    "Mr. Feast: Final segment soon. Try to look surprised.",
    "Producer: The mansion has voted to keep you.",
  ];

  const POWERUPS = [
    {
      key: "shield",
      label: "Insurance",
      cost: "AD",
      apply: () => {
        state.safeTimer = Math.max(state.safeTimer, 9);
        state.nerve = clamp(state.nerve + 34, 0, 100);
        showAlert("Production insurance active. Fear is briefly billable.", "good");
      },
    },
    {
      key: "boost",
      label: "Energy Drink",
      cost: "AD",
      apply: () => {
        state.stamina = 100;
        state.boostTimer = Math.max(state.boostTimer, 10);
        showAlert("Energy drink loaded. It tastes like a lawsuit with fizz.", "good");
      },
    },
    {
      key: "nuke",
      label: "Union Lawyer",
      cost: "AD",
      apply: () => {
        state.host.stunTimer = Math.max(state.host.stunTimer, 8);
        state.cameraJamTimer = Math.max(state.cameraJamTimer, 8);
        showAlert("A union lawyer entered frame. The mansion needs a minute.", "good");
      },
    },
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  if (!canvas) return;

  const api = window.RB || {
    state: { powerups: {} },
    subscribe: (fn) => {
      fn({ powerups: {} });
      return () => {};
    },
    showRewarded: () => Promise.resolve(true),
    grantPowerup: () => {},
    consumePowerup: () => false,
    toast: () => {},
    recordScore: () => false,
    getHighScore: () => 0,
  };

  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    primary: $("btn-primary"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    recenter: $("btn-recenter"),
    recenterTouch: $("btn-recenter-touch"),
    touchMoveZone: $("touch-move-zone"),
    hudTasks: $("hud-tasks"),
    hudViewers: $("hud-viewers"),
    hudNerve: $("hud-nerve"),
    hudContestants: $("hud-contestants"),
    hudHigh: $("hud-high"),
    objective: $("objective-text"),
    prompt: $("feast-prompt"),
    promptText: $("feast-prompt-text"),
    alert: $("feast-alert"),
    alertText: $("feast-alert-text"),
    jumpscare: $("feast-jumpscare"),
    vignette: $("feast-vignette"),
    meterNerve: $("meter-nerve"),
    meterNerveText: $("meter-nerve-text"),
    meterStamina: $("meter-stamina"),
    meterStaminaText: $("meter-stamina-text"),
    meterSignal: $("meter-signal"),
    meterSignalText: $("meter-signal-text"),
    route: $("feast-route"),
    routeArrow: $("route-arrow"),
    routeText: $("route-text"),
    danger: $("feast-danger"),
    log: $("event-log"),
    objectiveList: $("objective-list"),
    powerups: $("powerups"),
    lookSensitivity: $("look-sensitivity"),
    lookSensitivityText: $("look-sensitivity-text"),
    invertY: $("invert-y"),
  };

  const state = {
    ready: false,
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    time: 0,
    lastTime: 0,
    viewers: 0,
    tasksDone: 0,
    contestants: 10,
    nerve: 100,
    stamina: 100,
    signal: 0,
    graceTimer: 0,
    safeTimer: 0,
    boostTimer: 0,
    cameraJamTimer: 0,
    blackoutTimer: 0,
    sponsorScareTimer: 0,
    announcementTimer: 34,
    alertTimer: 0,
    jumpscareTimer: 0,
    interactionProgress: 0,
    stairProgress: 0,
    activeTask: null,
    stairPromptActive: false,
    stairDirection: null,
    detourActive: false,
    detourComplete: false,
    detourPromptActive: false,
    sponsorScareDone: false,
    finalPromptActive: false,
    finalUnlocked: false,
    finalEscapeTimer: 0,
    finalWarning30: false,
    finalWarning15: false,
    logs: [],
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    settings: loadLookSettings(),
    player: {
      x: 0,
      z: 29,
      y: EYE_HEIGHT,
      level: 0,
      yaw: 0,
      pitch: 0,
      bob: 0,
      moving: false,
      sprinting: false,
    },
    host: {
      x: 0,
      z: 12,
      yaw: Math.PI,
      mode: "patrol",
      patrolIndex: 2,
      alertTimer: 0,
      lostTimer: 0,
      stunTimer: 0,
      targetX: 0,
      targetZ: 25,
      lastKnownX: 0,
      lastKnownZ: 29,
      justSawPlayer: false,
      stuckTimer: 0,
    },
    input: {
      forward: false,
      back: false,
      left: false,
      right: false,
      sprint: false,
      interact: false,
      turnLeft: false,
      turnRight: false,
    },
    mouseLook: {
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
      hoverX: null,
      hoverY: null,
      locked: false,
      softLocked: false,
      lastUnlockedAt: 0,
      suppressClickUntil: 0,
    },
    touchMove: {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      forward: 0,
      strafe: 0,
    },
    tasks: [],
    hazards: [],
  };

  const world = {
    renderer: null,
    scene: null,
    camera: null,
    clock: 0,
    materials: {},
    collisions: [],
    taskGroups: new Map(),
    taskLights: new Map(),
    hazardGroups: [],
    contestantGroups: [],
    props: [],
    finalGate: null,
    finalGateCollider: null,
    finalExitGlow: null,
    finalSirenLight: null,
    detourGate: null,
    detourGateCollider: null,
    detourStation: null,
    detourLight: null,
    sponsorGhost: null,
    sponsorGhostLight: null,
    guideBeacon: null,
    guideBeaconLight: null,
    hostGroup: null,
    hostLight: null,
    hostFaceLight: null,
    ambient: null,
    resizeObserver: null,
    audio: null,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, az, bx, bz) => {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
  };
  const distance = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
  const angleTo = (ax, az, bx, bz) => Math.atan2(bx - ax, az - bz);
  const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const randomChoice = (items) => items[Math.floor(Math.random() * items.length)];
  const formatScore = (value) => Math.max(0, Math.round(value)).toLocaleString();
  const percent = (value) => Math.round(clamp(value, 0, 100)) + "%";
  const floorYForLevel = (level) => (level === 1 ? UPPER_FLOOR_Y : 0);

  function loadLookSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOOK_SETTINGS_KEY) || "{}");
      const lookSensitivity = Number(saved.lookSensitivity);
      return {
        lookSensitivity: Number.isFinite(lookSensitivity) ? Math.max(0.6, Math.min(1.6, lookSensitivity)) : DEFAULT_LOOK_SETTINGS.lookSensitivity,
        invertY: Boolean(saved.invertY),
      };
    } catch (error) {
      return { ...DEFAULT_LOOK_SETTINGS };
    }
  }

  function saveLookSettings() {
    try {
      localStorage.setItem(LOOK_SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {}
  }

  function loadThree(index = 0) {
    if (window.THREE) {
      initThree();
      return;
    }
    if (index >= THREE_SOURCES.length) {
      fatal("The 3D engine did not load. The mansion is standing in the dark, which is thematic but not playable.");
      return;
    }
    const script = document.createElement("script");
    script.src = THREE_SOURCES[index];
    script.onload = () => (window.THREE ? initThree() : loadThree(index + 1));
    script.onerror = () => loadThree(index + 1);
    document.head.appendChild(script);
  }

  function fatal(message) {
    showOverlay("ENGINE MISSED CALL TIME", message, "Retry");
    if (el.primary) el.primary.onclick = () => location.reload();
  }

  function initThree() {
    const THREE = window.THREE;
    state.ready = true;

    world.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    world.renderer.setClearColor(0x050505, 1);
    world.renderer.outputEncoding = THREE.sRGBEncoding;
    world.renderer.shadowMap.enabled = true;
    world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    world.scene = new THREE.Scene();
    world.scene.fog = new THREE.FogExp2(0x080605, 0.028);

    world.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.08, 150);

    buildMaterials();
    buildScene();
    bindInputs();
    renderObjectiveList();
    renderPowerups(api.state || { powerups: {} });
    resize();
    updateHUD();
    pushLog("The red light turns on. The mansion starts counting.");
    installLocalDirector();

    world.resizeObserver = new ResizeObserver(resize);
    world.resizeObserver.observe(canvas.parentElement || canvas);
    window.addEventListener("resize", resize);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      showOverlay("CAMERA FEED LOST", "WebGL context was interrupted. Reload to rejoin the segment.", "Reload");
      if (el.primary) el.primary.onclick = () => location.reload();
    });

    requestAnimationFrame(loop);
  }

  function buildMaterials() {
    const THREE = window.THREE;
    world.materials = {
      floor: new THREE.MeshStandardMaterial({ color: 0x17100c, roughness: 0.88, metalness: 0.03 }),
      corridor: new THREE.MeshStandardMaterial({ color: 0x3a0f0d, roughness: 0.78, metalness: 0.02 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x5c1410, roughness: 0.85 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.9 }),
      wallDark: new THREE.MeshStandardMaterial({ color: 0x120d0b, roughness: 0.94 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x6b4a23, roughness: 0.72, metalness: 0.1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.64, metalness: 0.04 }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x2a160d, roughness: 0.76, metalness: 0.03 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x23110d, roughness: 0.58, metalness: 0.02 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x28384d, roughness: 0.92 }),
      fabricWarm: new THREE.MeshStandardMaterial({ color: 0x6a4f36, roughness: 0.9 }),
      hardwood: new THREE.MeshStandardMaterial({ color: 0x5a341d, roughness: 0.68, metalness: 0.03 }),
      tile: new THREE.MeshStandardMaterial({ color: 0x7f7566, roughness: 0.76, metalness: 0.02 }),
      porcelain: new THREE.MeshStandardMaterial({ color: 0xf3efe3, roughness: 0.38, metalness: 0.02 }),
      appliance: new THREE.MeshStandardMaterial({ color: 0xc6c1b2, roughness: 0.36, metalness: 0.36 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xd7b89b, roughness: 0.62 }),
      sickSkin: new THREE.MeshStandardMaterial({ color: 0xc9b7a7, emissive: 0x180606, roughness: 0.72 }),
      suit: new THREE.MeshStandardMaterial({ color: 0x161719, roughness: 0.68, metalness: 0.04 }),
      shirt: new THREE.MeshStandardMaterial({ color: 0xe7dfce, roughness: 0.58 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x17100c, roughness: 0.86 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0xfff1cf, roughness: 0.38 }),
      bruise: new THREE.MeshStandardMaterial({ color: 0x3a2027, roughness: 0.88 }),
      nail: new THREE.MeshStandardMaterial({ color: 0x080505, roughness: 0.42 }),
      paper: new THREE.MeshStandardMaterial({ color: 0xf6efd8, roughness: 0.72 }),
      black: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.82 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xf0c336, emissive: 0x221600, roughness: 0.48, metalness: 0.08 }),
      red: new THREE.MeshStandardMaterial({ color: 0x8b1818, emissive: 0x220202, roughness: 0.58, metalness: 0.08 }),
      green: new THREE.MeshStandardMaterial({ color: 0x6bff7d, emissive: 0x0b3a11, roughness: 0.42, metalness: 0.08 }),
      cyan: new THREE.MeshStandardMaterial({ color: 0x5fc8d6, emissive: 0x082d33, roughness: 0.38, metalness: 0.18 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf7f2dc, roughness: 0.55 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0x9a8f7b, roughness: 0.32, metalness: 0.62 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xa9f2ff, emissive: 0x0c2a31, roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.72 }),
      beam: new THREE.MeshBasicMaterial({ color: 0xf0c336, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
      beamAlert: new THREE.MeshBasicMaterial({ color: 0xff3d3d, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
      ghost: new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.38 }),
    };

    world.materials.floor.map = makePatternTexture("floor");
    world.materials.floor.needsUpdate = true;
    world.materials.corridor.map = makePatternTexture("runner");
    world.materials.corridor.needsUpdate = true;
    world.materials.wall.map = makePatternTexture("wall");
    world.materials.wall.needsUpdate = true;
    world.materials.hardwood.map = makePatternTexture("hardwood");
    world.materials.hardwood.needsUpdate = true;
    world.materials.tile.map = makePatternTexture("tile");
    world.materials.tile.needsUpdate = true;
    world.materials.carpet.map = makePatternTexture("carpet");
    world.materials.carpet.needsUpdate = true;
    world.materials.fabricWarm.map = makePatternTexture("fabric");
    world.materials.fabricWarm.needsUpdate = true;
    world.materials.suit.map = makePatternTexture("suit");
    world.materials.suit.needsUpdate = true;
    world.materials.sickSkin.map = makePatternTexture("skin");
    world.materials.sickSkin.needsUpdate = true;
  }

  function makePatternTexture(kind) {
    const THREE = window.THREE;
    const cnv = document.createElement("canvas");
    cnv.width = 256;
    cnv.height = 256;
    const ctx = cnv.getContext("2d");
    if (kind === "floor") {
      ctx.fillStyle = "#17100c";
      ctx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 32) {
        for (let x = 0; x < 256; x += 32) {
          ctx.fillStyle = (x / 32 + y / 32) % 2 ? "#1d1510" : "#110c09";
          ctx.fillRect(x, y, 32, 32);
        }
      }
      ctx.strokeStyle = "rgba(240,195,54,0.08)";
      for (let i = 0; i < 256; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
    } else if (kind === "runner") {
      ctx.fillStyle = "#3a0f0d";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#581914";
      for (let y = 0; y < 256; y += 28) ctx.fillRect(0, y, 256, 8);
      ctx.strokeStyle = "rgba(240,195,54,0.18)";
      ctx.lineWidth = 6;
      ctx.strokeRect(18, 18, 220, 220);
    } else if (kind === "hardwood") {
      ctx.fillStyle = "#4a2817";
      ctx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 32) {
        ctx.fillStyle = y % 64 ? "#5d351f" : "#3f2315";
        ctx.fillRect(0, y, 256, 30);
        ctx.strokeStyle = "rgba(18,9,5,0.55)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
        for (let x = (y % 64 ? 38 : 0); x < 256; x += 86) {
          ctx.strokeStyle = "rgba(18,9,5,0.45)";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 30);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(124,78,42,0.28)";
      for (let i = 0; i < 11; i++) ctx.fillRect((i * 47) % 256, 12 + ((i * 31) % 220), 28, 3);
    } else if (kind === "tile") {
      ctx.fillStyle = "#70685c";
      ctx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 42) {
        for (let x = 0; x < 256; x += 42) {
          ctx.fillStyle = (x / 42 + y / 42) % 2 ? "#7e7466" : "#665f55";
          ctx.fillRect(x + 2, y + 2, 38, 38);
        }
      }
      ctx.strokeStyle = "rgba(22,18,14,0.58)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 256; i += 42) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
    } else if (kind === "carpet" || kind === "fabric") {
      ctx.fillStyle = kind === "fabric" ? "#6a4f36" : "#5c1410";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 180; i++) {
        ctx.fillStyle = i % 3 ? "rgba(255,230,190,0.08)" : "rgba(0,0,0,0.1)";
        ctx.fillRect((i * 37) % 256, (i * 53) % 256, 2 + (i % 4), 1);
      }
    } else if (kind === "suit") {
      ctx.fillStyle = "#151619";
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = "rgba(210,210,190,0.08)";
      ctx.lineWidth = 2;
      for (let x = 18; x < 256; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.24)";
      for (let y = 0; y < 256; y += 22) ctx.fillRect(0, y, 256, 2);
    } else if (kind === "skin") {
      ctx.fillStyle = "#c9b7a7";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = i % 4 ? "rgba(76,30,32,0.09)" : "rgba(250,230,208,0.08)";
        ctx.fillRect((i * 61) % 256, (i * 29) % 256, 2 + (i % 5), 1 + (i % 3));
      }
      ctx.strokeStyle = "rgba(54,22,28,0.12)";
      for (let y = 24; y < 256; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(70, y + 14, 160, y - 18, 256, y + 8);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#2b2118";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgba(240,195,54,0.055)";
      for (let y = 18; y < 256; y += 44) {
        ctx.fillRect(0, y, 256, 5);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      for (let x = 0; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 22, 256);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(cnv);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const repeat = kind === "wall" ? 2 : kind === "carpet" || kind === "fabric" ? 4 : 7;
    texture.repeat.set(repeat, repeat);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = world.renderer ? Math.min(8, world.renderer.capabilities.getMaxAnisotropy()) : 4;
    return texture;
  }

  function buildScene() {
    const THREE = window.THREE;
    const scene = world.scene;

    world.ambient = new THREE.HemisphereLight(0x2c2016, 0x070505, 0.62);
    scene.add(world.ambient);

    const moon = new THREE.DirectionalLight(0xfff1c2, 0.58);
    moon.position.set(-18, 24, 16);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    scene.add(moon);

    addFloor(0, -3, 74, 80, world.materials.floor);
    addFloor(0, -3, 10.8, 76, world.materials.corridor, 0.035);
    addFloor(0, 26, 11.2, 18, world.materials.hardwood, 0.05);
    addFloor(-22, 18, 29, 24, world.materials.tile, 0.045);
    addFloor(22, 16, 29, 24, world.materials.hardwood, 0.045);
    addFloor(-22, -17, 29, 25, world.materials.fabric, 0.045);
    addFloor(22, -18, 29, 26, world.materials.hardwood, 0.045);
    addFloor(0, -7.4, 10.2, 9.4, world.materials.tile, 0.045);
    addFloor(0, -29.5, 10.4, 22, world.materials.corridor, 0.04);

    buildWalls();
    buildSecondStoryShell();
    buildSetDressing();
    buildTasks();
    buildGuideBeacon();
    buildHazards();
    buildContestants();
    buildHost();
    buildFinalExit();
    buildStorySetpieces();

    const ceilingGlow = new THREE.PointLight(0xf0c336, 0.7, 24);
    ceilingGlow.position.set(0, 5.4, 24);
    scene.add(ceilingGlow);
  }

  function buildWalls() {
    addWall(0, 36, 74, 1.4, 4.1);
    addWall(0, -42, 74, 1.4, 4.1);
    addWall(-37, -3, 1.4, 78, 4.1);
    addWall(37, -3, 1.4, 78, 4.1);

    addWall(-7, 31.2, 1.1, 9.6, 3.8);
    addWall(-7, 23.2, 1.1, 3.0, 3.8);
    addWall(-7, 8.8, 1.1, 10.5, 3.8);
    addWall(-7, -2.9, 1.1, 4.0, 3.8);
    addWall(-7, -8.9, 1.1, 4.0, 3.8);
    addWall(-7, -31.4, 1.1, 21.2, 3.8);

    addWall(7, 30.6, 1.1, 10.8, 3.8);
    addWall(7, 22.2, 1.1, 4.0, 3.8);
    addWall(7, 8.0, 1.1, 8.8, 3.8);
    addWall(7, -2.8, 1.1, 4.2, 3.8);
    addWall(7, -8.8, 1.1, 4.0, 3.8);
    addWall(7, -31.2, 1.1, 21.6, 3.8);

    addWall(-22, 5.4, 29, 1.1, 3.7);
    addWall(22, 3.4, 29, 1.1, 3.7);
    addWall(-22, -5.5, 29, 1.1, 3.7);
    addWall(22, -5.8, 29, 1.1, 3.7);

    addWall(-5.4, 5.4, 3.2, 1.1, 3.4);
    addWall(5.4, 5.4, 3.2, 1.1, 3.4);
    addWall(-5.4, -23.2, 3.2, 1.1, 3.4);
    addWall(5.4, -23.2, 3.2, 1.1, 3.4);

    addWall(-31.4, 17.8, 1.0, 13.0, 3.2, world.materials.wallDark);
    addWall(31.4, 16.0, 1.0, 13.0, 3.2, world.materials.wallDark);
    addWall(-31.4, -17.0, 1.0, 13.5, 3.2, world.materials.wallDark);
    addWall(31.4, -18.0, 1.0, 13.5, 3.2, world.materials.wallDark);
  }

  function buildSecondStoryShell() {
    addFloor(-22, 18, 29, 24, world.materials.hardwood, 4.16);
    addFloor(22, 16, 29, 24, world.materials.hardwood, 4.16);
    addFloor(-22, -17, 29, 25, world.materials.hardwood, 4.16);
    addFloor(22, -18, 29, 26, world.materials.hardwood, 4.16);
    addFloor(-10.0, 22.0, 5.2, 28, world.materials.hardwood, 4.22);
    addFloor(10.0, 21.0, 5.2, 30, world.materials.hardwood, 4.22);
    addFloor(0, 31.2, 14.5, 4.4, world.materials.hardwood, 4.22);
    addFloor(6.8, 24.4, 4.8, 5.8, world.materials.hardwood, 4.22);
    addFloor(0, -24.6, 14.5, 4.2, world.materials.hardwood, 4.22);

    addUpperWall(-37, -3, 1.0, 78, 2.6);
    addUpperWall(37, -3, 1.0, 78, 2.6);
    addUpperWall(0, 36, 74, 1.0, 2.6);
    addUpperWall(0, -42, 74, 1.0, 2.6);
    addUpperWall(-13.0, 22.0, 0.7, 28, 2.35, world.materials.wallDark);
    addUpperWall(13.0, 21.0, 0.7, 30, 2.35, world.materials.wallDark);
    addUpperWall(-13.0, -17.0, 0.7, 24, 2.35, world.materials.wallDark);
    addUpperWall(13.0, -18.0, 0.7, 24, 2.35, world.materials.wallDark);

    addUpperRailLine(-5.9, 18.0, 34, Math.PI / 2);
    addUpperRailLine(5.9, 8.6, 15.2, Math.PI / 2);
    addUpperRailLine(5.9, 32.1, 6.3, Math.PI / 2);
    addUpperRailLine(0, 31.0, 10.7, 0);
    addUpperRailLine(0, -24.4, 10.7, 0);

    addUpperDoorVisual(-13.35, 28.0, Math.PI / 2, "EDIT BAY");
    addUpperDoorVisual(-13.35, 15.8, Math.PI / 2, "PRIZE ROOM");
    addUpperDoorVisual(13.35, 26.6, -Math.PI / 2, "STREAM SUITE");
    addUpperDoorVisual(13.35, 12.4, -Math.PI / 2, "GUEST ROOM");
    addUpperDoorVisual(-13.35, -13.8, Math.PI / 2, "BUNK ROOM");
    addUpperDoorVisual(13.35, -14.6, -Math.PI / 2, "CONTROL");

    addUpperWindow(-36.45, 25.4, Math.PI / 2, 3.1, 1.05);
    addUpperWindow(-36.45, 14.0, Math.PI / 2, 2.8, 1.0);
    addUpperWindow(36.45, 24.4, -Math.PI / 2, 3.1, 1.05);
    addUpperWindow(36.45, 12.0, -Math.PI / 2, 2.8, 1.0);
    addUpperWindow(-36.45, -14.0, Math.PI / 2, 2.8, 1.0);
    addUpperWindow(36.45, -15.8, -Math.PI / 2, 2.8, 1.0);
    addUpperFloorDressing();

    const upperGlow = new window.THREE.PointLight(0xffd89a, 0.85, 24);
    upperGlow.position.set(0, 5.7, 27);
    world.scene.add(upperGlow);
  }

  function buildSetDressing() {
    addRoomLight(0, 24, 0xffdf9a, 1.8, 21);
    addRoomLight(-24, 18, 0xffc78a, 1.9, 18);
    addRoomLight(24, 15, 0xd8ffc0, 1.55, 18);
    addRoomLight(-24, -16, 0xb5cfff, 1.35, 17);
    addRoomLight(24, -17, 0xffd7c5, 1.45, 17);
    addRoomLight(0, -7, 0xffdf9a, 1.25, 14);

    addSign("DEADLINE HOUSE", 0, 1.9, 35.26, 0, 5.4, 1.25, "#070505", "#f0c336");
    addSign("BACK DOOR", 0, 2.1, -41.22, Math.PI, 4.6, 1.1, "#130707", "#ffdddd");

    addDoorFrame(-7.02, 18.3, Math.PI / 2, 5.7);
    addDoorFrame(7.02, 16.3, -Math.PI / 2, 5.7);
    addDoorFrame(-7.02, -15.6, Math.PI / 2, 6.2);
    addDoorFrame(7.02, -15.5, -Math.PI / 2, 6.2);
    addDoorFrame(0, 5.4, 0, 6.2);
    addDoorFrame(0, -23.2, Math.PI, 6.2);

    addWindow(-36.28, 22, Math.PI / 2, 3.4, 1.25);
    addWindow(-36.28, 12.5, Math.PI / 2, 3.0, 1.15);
    addWindow(36.28, 20.5, -Math.PI / 2, 3.4, 1.25);
    addWindow(36.28, 7.8, -Math.PI / 2, 2.7, 1.1);
    addWindow(-36.28, -12, Math.PI / 2, 3.0, 1.15);
    addWindow(-36.28, -23.5, Math.PI / 2, 2.6, 1.0);
    addWindow(36.28, -11.8, -Math.PI / 2, 3.0, 1.15);
    addWindow(36.28, -23.2, -Math.PI / 2, 2.6, 1.0);

    addInteriorArchitecture();
    addFoyerLivingRoom();
    addKitchenRoom();
    addDiningRoom();
    addBedroomRoom();
    addBathroomNook();
    addUtilityRoom();
    addHomeOffice();
    addProductionContamination();
    addNormalHouseClutter();
  }

  function buildTasks() {
    state.tasks = TASK_DEFS.map((def) => ({ ...def, done: false }));
    state.tasks.forEach((task) => {
      const group = makeTaskProp(task);
      group.position.set(task.x, 0, task.z);
      group.userData.taskId = task.id;
      world.scene.add(group);
      world.taskGroups.set(task.id, group);

      const light = new window.THREE.PointLight(0xf0c336, 1.5, 7);
      light.position.set(task.x, 1.7, task.z);
      world.scene.add(light);
      world.taskLights.set(task.id, light);
    });
  }

  function buildGuideBeacon() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 8, 46), world.materials.yellow);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.72, 4), world.materials.yellow);
    arrow.position.set(0, 0.52, -0.72);
    arrow.rotation.x = Math.PI / 2;
    arrow.rotation.y = Math.PI / 4;
    group.add(arrow);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), world.materials.yellow);
    stem.position.y = 0.58;
    group.add(stem);

    world.guideBeaconLight = new THREE.PointLight(0xf0c336, 1.4, 7);
    world.guideBeaconLight.position.y = 1.25;
    group.add(world.guideBeaconLight);

    group.visible = false;
    world.guideBeacon = group;
    world.scene.add(group);
  }

  function buildHazards() {
    const hazards = [
      { x: 0, z: 24, yaw: 0.25, speed: 0.28, range: 13, label: "lobby cam" },
      { x: -27, z: 26, yaw: Math.PI * 0.72, speed: -0.22, range: 12, label: "pizza cam" },
      { x: 28, z: 24, yaw: -Math.PI * 0.74, speed: 0.24, range: 12, label: "cash cam" },
      { x: -29, z: -6, yaw: Math.PI * 0.9, speed: 0.26, range: 11, label: "sleep cam" },
      { x: 29, z: -7, yaw: -Math.PI * 0.84, speed: -0.26, range: 11, label: "confessional cam" },
      { x: 0, z: -26, yaw: 0, speed: 0.22, range: 12, label: "exit cam" },
    ];
    state.hazards = hazards.map((hazard) => makeCameraHazard(hazard));
  }

  function buildContestants() {
    const spots = [
      [-5.0, 30.4, 2.35],
      [-5.2, 27.6, 2.0],
      [-4.8, 24.6, 1.65],
      [3.8, 22.5, -2.2],
      [5.2, 20.4, -1.95],
      [-28.8, -20.5, 1.9],
      [-25.5, -20.8, 1.9],
      [20.8, -23.2, -2.2],
      [24.2, -23.2, -2.0],
    ];
    spots.forEach((spot, index) => {
      const group = makeContestant(index + 1);
      group.position.set(spot[0], 0, spot[1]);
      group.rotation.y = spot[2];
      world.scene.add(group);
      world.contestantGroups.push(group);
    });
  }

  function buildHost() {
    const THREE = window.THREE;
    const host = new THREE.Group();

    const pelvis = addBox(host, 0.92, 0.42, 0.5, world.materials.suit, 0, 0.92, 0);
    pelvis.castShadow = true;

    [-0.28, 0.28].forEach((x) => {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.95, 12), world.materials.suit);
      thigh.position.set(x, 0.55, 0);
      thigh.castShadow = true;
      host.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.82, 12), world.materials.suit);
      shin.position.set(x, 0.12, -0.03);
      shin.castShadow = true;
      host.add(shin);
      addBox(host, 0.42, 0.14, 0.78, world.materials.black, x, 0.08, -0.2);
    });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.68, 1.55, 18), world.materials.suit);
    torso.position.y = 1.62;
    torso.scale.z = 0.72;
    torso.castShadow = true;
    host.add(torso);

    addBox(host, 0.34, 1.16, 0.075, world.materials.shirt, 0, 1.7, -0.47, false);
    addBox(host, 0.13, 0.9, 0.08, world.materials.red, 0, 1.58, -0.53, false);
    addBox(host, 1.28, 0.16, 0.34, world.materials.suit, 0, 2.36, -0.03);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.36, 16), world.materials.sickSkin);
    neck.position.y = 2.44;
    neck.castShadow = true;
    host.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.58, 34, 24), world.materials.sickSkin);
    head.position.y = 2.92;
    head.scale.set(0.82, 1.14, 0.76);
    head.castShadow = true;
    host.add(head);

    const jaw = addBox(host, 0.48, 0.2, 0.22, world.materials.sickSkin, 0, 2.48, -0.34);
    jaw.scale.x = 0.82;
    [-0.5, 0.5].forEach((x) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), world.materials.sickSkin);
      ear.position.set(x, 2.94, -0.04);
      ear.scale.set(0.46, 1.0, 0.3);
      ear.castShadow = true;
      host.add(ear);
      const innerEar = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), world.materials.bruise);
      innerEar.position.set(x * 1.01, 2.93, -0.055);
      innerEar.scale.set(0.3, 0.85, 0.24);
      host.add(innerEar);
    });

    const scalp = new THREE.Mesh(new THREE.SphereGeometry(0.59, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.53), world.materials.hair);
    scalp.position.set(0, 3.13, -0.02);
    scalp.scale.set(0.83, 0.5, 0.76);
    scalp.castShadow = true;
    host.add(scalp);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.32, 8), world.materials.skin);
    nose.position.set(0, 2.93, -0.48);
    nose.rotation.x = Math.PI / 2;
    nose.castShadow = true;
    host.add(nose);

    [-0.22, 0.22].forEach((x) => {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10), world.materials.bruise);
      socket.position.set(x, 3.035, -0.51);
      socket.scale.set(1.45, 0.9, 0.25);
      host.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 10), world.materials.white);
      eye.position.set(x, 3.04, -0.49);
      eye.scale.set(1.15, 0.7, 0.34);
      host.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), world.materials.black);
      pupil.position.set(x, 3.035, -0.57);
      pupil.scale.set(1.0, 0.85, 0.35);
      host.add(pupil);
      const brow = addBox(host, 0.27, 0.045, 0.045, world.materials.hair, x, 3.17, -0.55, false);
      brow.rotation.z = x < 0 ? -0.22 : 0.22;
    });
    for (let i = 0; i < 3; i++) {
      const wrinkle = addBox(host, 0.36 - i * 0.05, 0.024, 0.026, world.materials.bruise, 0, 3.23 - i * 0.065, -0.53, false);
      wrinkle.rotation.z = (i - 1) * 0.08;
    }

    const mouth = addBox(host, 0.48, 0.12, 0.06, world.materials.black, 0, 2.68, -0.53, false);
    mouth.rotation.x = -0.05;
    for (let i = 0; i < 6; i++) {
      addBox(host, 0.052, 0.12, 0.04, world.materials.tooth, -0.2 + i * 0.08, 2.74, -0.575, false);
    }
    addBox(host, 0.6, 0.035, 0.035, world.materials.black, 0, 2.55, -0.54, false);
    [-0.36, 0.36].forEach((x) => {
      const crease = addBox(host, 0.24, 0.035, 0.035, world.materials.black, x, 2.66, -0.54, false);
      crease.rotation.z = x < 0 ? -0.85 : 0.85;
      const cheek = addBox(host, 0.24, 0.032, 0.028, world.materials.bruise, x * 0.82, 2.79, -0.55, false);
      cheek.rotation.z = x < 0 ? 0.42 : -0.42;
    });
    [-0.16, 0.16].forEach((x) => {
      const lapel = addBox(host, 0.16, 0.98, 0.055, world.materials.black, x, 1.72, -0.54, false);
      lapel.rotation.z = x < 0 ? -0.22 : 0.22;
    });
    for (let i = 0; i < 4; i++) addBox(host, 0.055, 0.055, 0.035, world.materials.chrome, 0, 1.22 + i * 0.22, -0.58, false);

    const addHostLimb = (start, end, radiusTop, radiusBottom, material) => {
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 14), material);
      limb.position.copy(start).add(end).multiplyScalar(0.5);
      limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      limb.castShadow = true;
      host.add(limb);
      return limb;
    };

    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Vector3(side * 0.62, 2.22, -0.08);
      const elbow = new THREE.Vector3(side * 0.74, 1.58, -0.18);
      const wrist = new THREE.Vector3(side * 0.7, 1.03, -0.4);
      addHostLimb(shoulder, elbow, 0.14, 0.12, world.materials.suit);
      addHostLimb(elbow, wrist, 0.105, 0.085, world.materials.sickSkin);

      const shoulderPad = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), world.materials.suit);
      shoulderPad.position.copy(shoulder);
      shoulderPad.scale.set(1.2, 0.72, 0.82);
      shoulderPad.castShadow = true;
      host.add(shoulderPad);

      const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), world.materials.suit);
      elbowJoint.position.copy(elbow);
      elbowJoint.scale.set(0.9, 0.72, 0.82);
      elbowJoint.castShadow = true;
      host.add(elbowJoint);

      const cuff = addBox(host, 0.22, 0.1, 0.16, world.materials.shirt, wrist.x * 0.98, wrist.y + 0.05, wrist.z + 0.04, false);
      cuff.rotation.z = side * -0.18;
      cuff.rotation.x = 0.28;

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), world.materials.sickSkin);
      hand.position.set(wrist.x + side * 0.02, wrist.y - 0.12, wrist.z - 0.05);
      hand.scale.set(0.88, 0.74, 1.15);
      hand.rotation.z = side * -0.12;
      hand.castShadow = true;
      host.add(hand);

      for (let i = 0; i < 4; i++) {
        const fingerX = hand.position.x + side * (i - 1.5) * 0.038;
        const finger = addBox(host, 0.036, 0.23, 0.052, world.materials.sickSkin, fingerX, hand.position.y - 0.18, hand.position.z - 0.11 - i * 0.008, false);
        finger.rotation.x = 0.34;
        finger.rotation.z = side * 0.04;
        addBox(host, 0.04, 0.026, 0.038, world.materials.nail, fingerX, hand.position.y - 0.31, hand.position.z - 0.2 - i * 0.008, false);
      }
    });

    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.9, 12), world.materials.chrome);
    mic.position.set(0.84, 1.18, -0.48);
    mic.rotation.z = -0.35;
    mic.rotation.x = 0.18;
    host.add(mic);
    const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), world.materials.black);
    micHead.position.set(0.92, 1.55, -0.62);
    host.add(micHead);

    const cameraRig = new THREE.Group();
    addBox(cameraRig, 0.44, 0.26, 0.28, world.materials.black, 0, 0, 0);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.12, 14), world.materials.glass);
    lens.position.set(0, 0, -0.2);
    lens.rotation.x = Math.PI / 2;
    cameraRig.add(lens);
    cameraRig.position.set(-0.56, 2.32, -0.42);
    cameraRig.rotation.y = -0.15;
    host.add(cameraRig);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.026, 10, 48), world.materials.red);
    halo.position.set(0, 3.02, 0.08);
    halo.rotation.x = Math.PI / 2;
    host.add(halo);
    host.userData.head = head;
    host.userData.cameraRig = cameraRig;
    host.userData.halo = halo;

    world.hostLight = new THREE.PointLight(0xf0c336, 1.5, 10);
    world.hostLight.position.set(0, 3.15, -0.15);
    host.add(world.hostLight);
    world.hostFaceLight = new THREE.PointLight(0xff3333, 0, 8);
    world.hostFaceLight.position.set(0, 2.92, -0.72);
    host.add(world.hostFaceLight);

    host.position.set(state.host.x, 0, state.host.z);
    host.scale.setScalar(1.05);
    world.hostGroup = host;
    world.scene.add(host);
  }

  function buildFinalExit() {
    const THREE = window.THREE;
    world.finalGate = addWall(0, -36.5, 8.5, 1.2, 3.9, world.materials.red, { dynamic: true, label: "finalGate" });
    world.finalGateCollider = world.finalGate.userData.collider;

    const arch = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.2, 0.42), world.materials.yellow);
    left.position.set(-4.9, 2.1, -37.2);
    arch.add(left);
    const right = left.clone();
    right.position.x = 4.9;
    arch.add(right);
    const top = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.42, 0.42), world.materials.yellow);
    top.position.set(0, 4.1, -37.2);
    arch.add(top);
    world.scene.add(arch);

    world.finalExitGlow = new THREE.PointLight(0x6bff7d, 0, 18);
    world.finalExitGlow.position.set(0, 2.2, -38.5);
    world.scene.add(world.finalExitGlow);
  }

  function buildStorySetpieces() {
    const THREE = window.THREE;

    world.detourGate = addWall(0, -0.9, 5.4, 1.0, 3.9, world.materials.wallDark, { dynamic: true, label: "blackoutGate" });
    world.detourGate.visible = false;
    world.detourGateCollider = world.detourGate.userData.collider;
    if (world.detourGateCollider) world.detourGateCollider.active = false;

    const station = new THREE.Group();
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.72, 18), world.materials.black);
    pedestal.position.y = 0.36;
    station.add(pedestal);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.1, 0.22), world.materials.cyan);
    panel.position.set(0, 1.22, -0.08);
    panel.castShadow = true;
    station.add(panel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.12), world.materials.red);
    handle.position.set(0.36, 1.22, -0.24);
    station.add(handle);
    const sign = makeTextSign("RELEASE", 1.45, 0.44, "#050505", "#f0c336");
    sign.position.set(0, 2.02, -0.18);
    station.add(sign);
    station.position.set(DETOUR_PANEL.x, 0, DETOUR_PANEL.z);
    station.rotation.y = Math.PI;
    station.visible = false;
    world.detourStation = station;
    world.scene.add(station);

    world.detourLight = new THREE.PointLight(0xff4d4d, 0, 10);
    world.detourLight.position.set(DETOUR_PANEL.x, 2.0, DETOUR_PANEL.z - 0.3);
    world.scene.add(world.detourLight);

    const ghost = new THREE.Group();
    const ghostBody = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.68, 1.8, 18), world.materials.ghost);
    ghostBody.position.y = 1.2;
    ghost.add(ghostBody);
    const ghostHead = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 16), world.materials.ghost);
    ghostHead.position.y = 2.35;
    ghost.add(ghostHead);
    const ghostSmile = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 20, Math.PI), world.materials.black);
    ghostSmile.position.set(0, 2.18, -0.43);
    ghostSmile.rotation.z = Math.PI;
    ghost.add(ghostSmile);
    const ghostSign = makeTextSign("SMILE", 1.25, 0.42, "#110406", "#ffd9d9");
    ghostSign.position.set(0, 0.45, -0.6);
    ghost.add(ghostSign);
    ghost.visible = false;
    world.sponsorGhost = ghost;
    world.scene.add(ghost);

    world.sponsorGhostLight = new THREE.PointLight(0xff4d4d, 0, 9);
    world.scene.add(world.sponsorGhostLight);

    world.finalSirenLight = new THREE.PointLight(0xff3333, 0, 28);
    world.finalSirenLight.position.set(0, 3.1, -30);
    world.scene.add(world.finalSirenLight);
  }

  function addFloor(x, z, w, d, material, y = 0) {
    const THREE = window.THREE;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), material);
    mesh.position.set(x, y - 0.04, z);
    mesh.receiveShadow = true;
    world.scene.add(mesh);
    return mesh;
  }

  function addCeiling(x, z, w, d) {
    const THREE = window.THREE;
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), world.materials.wallDark);
    ceiling.position.set(x, 4.08, z);
    ceiling.receiveShadow = true;
    world.scene.add(ceiling);
    return ceiling;
  }

  function addWall(x, z, w, d, h, material = world.materials.wall, options = {}) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    wall.position.y = h / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const trimTop = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), world.materials.trim);
    trimTop.position.y = h - 0.2;
    group.add(trimTop);

    const trimBottom = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.11, d + 0.06), world.materials.trim);
    trimBottom.position.y = 0.15;
    group.add(trimBottom);

    group.position.set(x, 0, z);
    world.scene.add(group);

    const collider = addCollisionRect(x, z, w, d, true, options.label || "wall", options.level || 0);
    group.userData.collider = collider;
    if (options.dynamic) group.userData.dynamic = true;
    return group;
  }

  function addCollisionRect(x, z, w, d, blocksSight, label = "wall", level = 0) {
    const collider = {
      x1: x - w / 2,
      x2: x + w / 2,
      z1: z - d / 2,
      z2: z + d / 2,
      active: true,
      blocksSight: Boolean(blocksSight),
      label,
      level,
    };
    world.collisions.push(collider);
    return collider;
  }

  function addRoomLight(x, z, color, intensity, range) {
    const THREE = window.THREE;
    const light = new THREE.PointLight(color, intensity, range);
    light.position.set(x, 3.2, z);
    world.scene.add(light);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshBasicMaterial({ color }));
    bulb.position.copy(light.position);
    world.scene.add(bulb);
    return light;
  }

  function addBox(parent, w, h, d, material, x = 0, y = h / 2, z = 0, castShadow = true) {
    const THREE = window.THREE;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addRug(x, z, w, d, material = world.materials.carpet, yaw = 0) {
    const THREE = window.THREE;
    const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.055, d), material);
    rug.position.set(x, 0.055, z);
    rug.rotation.y = yaw;
    rug.receiveShadow = true;
    world.scene.add(rug);
    return rug;
  }

  function addDoorFrame(x, z, yaw, width) {
    const THREE = window.THREE;
    const frame = new THREE.Group();
    addBox(frame, 0.18, 3.25, 0.2, world.materials.darkWood, -width / 2, 1.62, 0);
    addBox(frame, 0.18, 3.25, 0.2, world.materials.darkWood, width / 2, 1.62, 0);
    addBox(frame, width + 0.36, 0.2, 0.22, world.materials.darkWood, 0, 3.18, 0);
    addBox(frame, width + 0.58, 0.08, 0.18, world.materials.trim, 0, 0.24, -0.02);
    frame.position.set(x, 0, z);
    frame.rotation.y = yaw;
    world.scene.add(frame);
    return frame;
  }

  function addWindow(x, z, yaw, w, h) {
    const THREE = window.THREE;
    const windowGroup = new THREE.Group();
    const pane = addBox(windowGroup, w, h, 0.05, world.materials.glass, 0, 2.08, 0, false);
    pane.material = world.materials.glass;
    addBox(windowGroup, w + 0.22, 0.14, 0.12, world.materials.trim, 0, 2.08 + h / 2 + 0.1, 0.02);
    addBox(windowGroup, w + 0.22, 0.14, 0.12, world.materials.trim, 0, 2.08 - h / 2 - 0.1, 0.02);
    addBox(windowGroup, 0.14, h + 0.28, 0.12, world.materials.trim, -w / 2 - 0.1, 2.08, 0.02);
    addBox(windowGroup, 0.14, h + 0.28, 0.12, world.materials.trim, w / 2 + 0.1, 2.08, 0.02);
    addBox(windowGroup, 0.1, h + 0.55, 0.08, world.materials.fabricWarm, -w / 2 - 0.35, 2.02, -0.04, false);
    addBox(windowGroup, 0.1, h + 0.55, 0.08, world.materials.fabricWarm, w / 2 + 0.35, 2.02, -0.04, false);
    windowGroup.position.set(x, 0, z);
    windowGroup.rotation.y = yaw;
    world.scene.add(windowGroup);
    return windowGroup;
  }

  function addInteriorArchitecture() {
    addWallPanel(-21.8, 4.85, 0, 24.8, 3.05, world.materials.wall);
    addWallPanel(21.8, 2.85, 0, 24.8, 3.05, world.materials.wall);
    addWallPanel(-21.8, -5.95, 0, 24.8, 3.05, world.materials.wall);
    addWallPanel(21.8, -6.25, 0, 24.8, 3.05, world.materials.wall);
    addWallPanel(-35.9, 18.0, Math.PI / 2, 22.0, 3.05, world.materials.wallDark);
    addWallPanel(35.9, 16.0, -Math.PI / 2, 22.0, 3.05, world.materials.wallDark);
    addWallPanel(-35.9, -17.0, Math.PI / 2, 25.0, 3.05, world.materials.wallDark);
    addWallPanel(35.9, -18.0, -Math.PI / 2, 25.0, 3.05, world.materials.wallDark);
    addWallPanel(-18.8, -7.6, Math.PI / 2, 5.0, 2.8, world.materials.wall);

    addDoorSlab(-7.24, 18.3, Math.PI / 2, -0.64, 0.95);
    addDoorSlab(7.24, 16.3, -Math.PI / 2, 0.64, 0.95);
    addDoorSlab(-7.24, -15.6, Math.PI / 2, 0.58, 0.98);
    addDoorSlab(7.24, -15.5, -Math.PI / 2, -0.58, 0.98);
    addDoorSlab(-18.85, -5.25, 0, 0.58, 0.82);

    addWallSconce(-6.88, 21.8, Math.PI / 2);
    addWallSconce(6.88, 20.5, -Math.PI / 2);
    addWallSconce(-18.85, -10.2, Math.PI / 2);
    addWallSconce(18.85, -10.4, -Math.PI / 2);
  }

  function addWallPanel(x, z, yaw, length, h = 3.25, material = world.materials.wallDark) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, length, h, 0.34, material, 0, h / 2, 0);
    addBox(group, length + 0.12, 0.09, 0.42, world.materials.trim, 0, 0.16, 0);
    addBox(group, length + 0.06, 0.07, 0.38, world.materials.trim, 0, h - 0.18, 0);
    for (let i = -1; i <= 1; i++) {
      addBox(group, 0.08, h - 0.55, 0.38, world.materials.trim, (length / 3) * i, h / 2, 0.01, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    return group;
  }

  function addDoorSlab(x, z, yaw, openAngle = 0.65, width = 1.05) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, width, 2.45, 0.1, world.materials.darkWood, width / 2, 1.25, 0);
    addBox(group, width * 0.72, 0.04, 0.055, world.materials.trim, width / 2, 1.92, -0.07, false);
    addBox(group, width * 0.72, 0.04, 0.055, world.materials.trim, width / 2, 0.74, -0.07, false);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), world.materials.chrome);
    knob.position.set(width * 0.82, 1.24, -0.11);
    group.add(knob);
    group.position.set(x, 0, z);
    group.rotation.y = yaw + openAngle;
    world.scene.add(group);
    return group;
  }

  function addUpperWall(x, z, w, d, h, material = world.materials.wall) {
    const group = new window.THREE.Group();
    addBox(group, w, h, d, material, 0, 4.18 + h / 2, 0);
    addBox(group, w + 0.06, 0.08, d + 0.06, world.materials.trim, 0, 4.36, 0, false);
    addBox(group, w + 0.06, 0.08, d + 0.06, world.materials.trim, 0, 4.18 + h - 0.22, 0, false);
    group.position.set(x, 0, z);
    world.scene.add(group);
    addCollisionRect(x, z, w, d, true, "upper wall", 1);
    return group;
  }

  function addUpperRailLine(x, z, length, yaw) {
    const group = new window.THREE.Group();
    addBox(group, length, 0.1, 0.09, world.materials.trim, 0, 4.88, 0, false);
    addBox(group, length, 0.08, 0.08, world.materials.darkWood, 0, 4.55, 0, false);
    const posts = Math.max(3, Math.ceil(length / 2.5));
    for (let i = 0; i <= posts; i++) {
      const offset = -length / 2 + (length / posts) * i;
      addBox(group, 0.1, 0.8, 0.1, world.materials.trim, offset, 4.48, 0, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    return group;
  }

  function addUpperDoorVisual(x, z, yaw, label) {
    const group = new window.THREE.Group();
    addBox(group, 0.95, 1.95, 0.1, world.materials.darkWood, 0, 5.16, 0, false);
    addBox(group, 0.72, 0.08, 0.055, world.materials.trim, 0, 5.66, -0.07, false);
    addBox(group, 0.72, 0.08, 0.055, world.materials.trim, 0, 4.82, -0.07, false);
    const knob = new window.THREE.Mesh(new window.THREE.SphereGeometry(0.055, 10, 8), world.materials.chrome);
    knob.position.set(0.31, 5.1, -0.12);
    group.add(knob);
    const sign = makeTextSign(label, 1.25, 0.34, "#120d0b", "#f0c336");
    sign.position.set(0, 6.32, -0.08);
    group.add(sign);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addUpperWindow(x, z, yaw, w, h) {
    const group = new window.THREE.Group();
    addBox(group, w, h, 0.05, world.materials.glass, 0, 5.58, 0, false);
    addBox(group, w + 0.2, 0.12, 0.1, world.materials.trim, 0, 5.58 + h / 2 + 0.08, 0.02, false);
    addBox(group, w + 0.2, 0.12, 0.1, world.materials.trim, 0, 5.58 - h / 2 - 0.08, 0.02, false);
    addBox(group, 0.12, h + 0.24, 0.1, world.materials.trim, -w / 2 - 0.08, 5.58, 0.02, false);
    addBox(group, 0.12, h + 0.24, 0.1, world.materials.trim, w / 2 + 0.08, 5.58, 0.02, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addUpperFloorDressing() {
    addUpperRug(-22, 24.0, 8.4, 5.2, world.materials.fabricWarm);
    addUpperDesk(-22.6, 27.6, Math.PI, "EDIT BAY");
    addUpperShelf(-31.6, 23.0, Math.PI / 2);
    addUpperRug(-22, 13.4, 8.2, 5.0, world.materials.green);
    addUpperPrizeTable(-22.2, 14.6);
    addUpperBench(-14.8, 12.0, Math.PI / 2);

    addUpperRug(22, 25.4, 8.5, 5.4, world.materials.fabric);
    addUpperDesk(22.4, 27.5, Math.PI, "STREAM");
    addUpperShelf(32.0, 23.8, -Math.PI / 2);
    addUpperRug(22, 12.4, 8.4, 5.4, world.materials.fabricWarm);
    addUpperBed(27.8, 12.6, -Math.PI / 2);
    addUpperBench(16.0, 11.8, -Math.PI / 2);

    addUpperRug(-22, -14.2, 8.4, 5.6, world.materials.fabric);
    addUpperBed(-30.0, -14.2, Math.PI / 2);
    addUpperShelf(-15.0, -18.8, 0);
    addUpperRug(22, -15.4, 8.4, 5.6, world.materials.corridor);
    addUpperControlBank(23.0, -15.2);
    addUpperShelf(32.0, -20.0, -Math.PI / 2);

    addUpperBench(0, 31.1, 0);
    addUpperBench(0, -24.2, Math.PI);
    addUpperSign("STAIRS", STAIR_TOP.x, UPPER_FLOOR_Y + 1.75, STAIR_TOP.z - 0.9, Math.PI, 1.6, 0.44);
  }

  function addUpperRug(x, z, w, d, material) {
    const THREE = window.THREE;
    const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.055, d), material);
    rug.position.set(x, UPPER_FLOOR_Y + 0.055, z);
    rug.receiveShadow = true;
    world.scene.add(rug);
  }

  function addUpperBench(x, z, yaw) {
    const group = new window.THREE.Group();
    addBox(group, 2.4, 0.24, 0.82, world.materials.darkWood, 0, UPPER_FLOOR_Y + 0.48, 0);
    addBox(group, 2.55, 0.85, 0.18, world.materials.fabricWarm, 0, UPPER_FLOOR_Y + 0.9, 0.38);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.8, 1.1, false, 1);
  }

  function addUpperDesk(x, z, yaw, label) {
    const group = new window.THREE.Group();
    addBox(group, 3.0, 0.18, 1.25, world.materials.wood, 0, UPPER_FLOOR_Y + 0.78, 0);
    addBox(group, 0.22, 0.78, 0.22, world.materials.darkWood, -1.18, UPPER_FLOOR_Y + 0.38, -0.42);
    addBox(group, 0.22, 0.78, 0.22, world.materials.darkWood, 1.18, UPPER_FLOOR_Y + 0.38, -0.42);
    addBox(group, 1.15, 0.68, 0.08, world.materials.black, 0.28, UPPER_FLOOR_Y + 1.2, -0.48);
    addBox(group, 0.82, 0.04, 0.5, world.materials.paper, -0.72, UPPER_FLOOR_Y + 0.91, 0.1, false);
    const sign = makeTextSign(label, 1.25, 0.34, "#050505", "#f0c336");
    sign.position.set(0, UPPER_FLOOR_Y + 1.7, -0.62);
    group.add(sign);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.35, 1.6, false, 1);
  }

  function addUpperShelf(x, z, yaw) {
    const group = new window.THREE.Group();
    addBox(group, 2.2, 2.1, 0.52, world.materials.darkWood, 0, UPPER_FLOOR_Y + 1.05, 0);
    for (let shelf = 0; shelf < 3; shelf++) {
      addBox(group, 1.9, 0.07, 0.42, world.materials.wood, 0, UPPER_FLOOR_Y + 0.48 + shelf * 0.5, -0.02, false);
      for (let i = 0; i < 4; i++) {
        addBox(group, 0.18, 0.3 + (i % 2) * 0.12, 0.18, i % 2 ? world.materials.red : world.materials.green, -0.66 + i * 0.42, UPPER_FLOOR_Y + 0.7 + shelf * 0.5, -0.22, false);
      }
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.5, 0.9, false, 1);
  }

  function addUpperPrizeTable(x, z) {
    const group = new window.THREE.Group();
    addBox(group, 3.1, 0.16, 1.3, world.materials.wood, 0, UPPER_FLOOR_Y + 0.78, 0);
    addBox(group, 0.18, 0.76, 0.18, world.materials.darkWood, -1.2, UPPER_FLOOR_Y + 0.38, -0.45);
    addBox(group, 0.18, 0.76, 0.18, world.materials.darkWood, 1.2, UPPER_FLOOR_Y + 0.38, -0.45);
    addBox(group, 0.18, 0.76, 0.18, world.materials.darkWood, -1.2, UPPER_FLOOR_Y + 0.38, 0.45);
    addBox(group, 0.18, 0.76, 0.18, world.materials.darkWood, 1.2, UPPER_FLOOR_Y + 0.38, 0.45);
    for (let i = 0; i < 5; i++) {
      addBox(group, 0.54, 0.22, 0.34, i % 2 ? world.materials.green : world.materials.yellow, -1.0 + i * 0.5, UPPER_FLOOR_Y + 1.0 + (i % 2) * 0.13, -0.08 + (i % 3) * 0.16, false);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 3.45, 1.65, false, 1);
  }

  function addUpperBed(x, z, yaw) {
    const group = new window.THREE.Group();
    addBox(group, 2.2, 0.32, 3.4, world.materials.darkWood, 0, UPPER_FLOOR_Y + 0.34, 0);
    addBox(group, 2.05, 0.22, 2.9, world.materials.fabricWarm, 0, UPPER_FLOOR_Y + 0.64, 0.2);
    addBox(group, 2.3, 1.05, 0.2, world.materials.darkWood, 0, UPPER_FLOOR_Y + 0.95, 1.52);
    addBox(group, 0.8, 0.18, 0.62, world.materials.white, -0.5, UPPER_FLOOR_Y + 0.87, 0.95, false);
    addBox(group, 0.8, 0.18, 0.62, world.materials.white, 0.5, UPPER_FLOOR_Y + 0.87, 0.95, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.6, 3.8, false, 1);
  }

  function addUpperControlBank(x, z) {
    const group = new window.THREE.Group();
    addBox(group, 4.2, 0.9, 1.1, world.materials.black, 0, UPPER_FLOOR_Y + 0.45, 0);
    for (let i = 0; i < 5; i++) {
      addBox(group, 0.42, 0.08, 0.42, i % 2 ? world.materials.cyan : world.materials.red, -1.6 + i * 0.8, UPPER_FLOOR_Y + 0.96, -0.18, false);
      addBox(group, 0.34, 0.04, 0.12, world.materials.yellow, -1.6 + i * 0.8, UPPER_FLOOR_Y + 1.05, 0.26, false);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 4.55, 1.45, false, 1);
  }

  function addUpperSign(text, x, y, z, yaw, w, h) {
    const sign = makeTextSign(text, w, h, "#050505", "#f0c336");
    sign.position.set(x, y, z);
    sign.rotation.y = yaw;
    world.scene.add(sign);
    return sign;
  }

  function addWallSconce(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.18, 0.46, 0.08, world.materials.chrome, 0, 1.82, 0);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.32, 12), world.materials.paper);
    shade.position.set(0, 2.06, -0.08);
    shade.rotation.x = Math.PI / 2;
    group.add(shade);
    const light = new THREE.PointLight(0xffd89a, 0.34, 4.2);
    light.position.set(0, 2.0, -0.26);
    group.add(light);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addFoyerLivingRoom() {
    addRug(0, 25.2, 6.8, 7.6, world.materials.carpet);
    addSofa(3.7, 25.8, -Math.PI / 2, world.materials.leather);
    addCoffeeTable(0.6, 25.3, 0);
    addMediaConsole(-4.8, 25.1, Math.PI / 2);
    addFireplace(-5.85, 30.3, Math.PI / 2);
    addStaircase(5.1, 30.2, 0);
    addFloorLamp(4.7, 21.2);
    addHousePlant(-4.7, 28.8);
    addPictureCluster(-6.35, 24.1, Math.PI / 2, ["before", "after", "waiver"]);
    addPictureCluster(6.35, 23.0, -Math.PI / 2, ["winner", "winner", "missing"]);
    addCoatRack(5.7, 20.1);
    addShoePile(-2.6, 19.6);
    addTripod(-3.8, 31.9, Math.PI + 0.12);
    addTripod(3.8, 31.9, Math.PI - 0.12);
  }

  function addKitchenRoom() {
    addRug(-24.2, 18.2, 7.0, 5.4, world.materials.fabricWarm);
    addKitchenCounter(-34.2, 18.2, 1.2, 16.8);
    addKitchenCounter(-24.2, 27.1, 15.2, 1.15);
    addKitchenIsland(-20.8, 18.0);
    addUpperCabinetRun(-34.9, 18.2, Math.PI / 2, 13.6);
    addUpperCabinetRun(-24.2, 27.75, 0, 12.4);
    addRangeHood(-34.7, 15.0, Math.PI / 2);
    addBreakfastNook(-15.2, 11.8);
    addRollingCart(-15.5, 23.4);
    addKitchenForegroundDetails(-16.7, 18.2);
    addKitchenClutter(-20.8, 18.0);
    addDishRack(-28.4, 26.7);
    addPendantLight(-20.8, 18.0);
    addAppliance(-34.1, 10.2, 1.35, 2.2, "fridge");
    addAppliance(-34.1, 15.0, 1.25, 1.4, "oven");
    addAppliance(-27.2, 27.0, 2.2, 1.1, "sink");
    addHousePlant(-12.2, 25.5);
    addPictureCluster(-23.8, 6.1, 0, ["family", "sponsor", "teeth"]);
  }

  function addDiningRoom() {
    addRug(24.0, 15.2, 10.8, 8.2, world.materials.green);
    addDiningSet(24.0, 15.2);
    addTableSettings(24.0, 15.2);
    addSideboard(32.0, 22.5, -Math.PI / 2);
    addChinaCabinet(33.2, 7.8, -Math.PI / 2);
    addPrizePile(28.2, 21.0, 3);
    addFloorLamp(13.0, 7.0);
  }

  function addBedroomRoom() {
    addRug(-25.6, -16.8, 9.8, 8.8, world.materials.fabric);
    addRealBed(-31.0, -18.0, Math.PI / 2, world.materials.fabric);
    addNightstand(-31.0, -13.4);
    addNightstand(-31.0, -22.6);
    addDresser(-13.0, -23.8, 0);
    addVanity(-25.8, -12.4, Math.PI);
    addWardrobe(-34.0, -8.0, Math.PI / 2);
    addFloorLamp(-13.0, -7.0);
    addLaundryBasket(-15.2, -10.4);
    addClothingPile(-22.0, -22.6);
    addPictureCluster(-36.2, -16.2, Math.PI / 2, ["smile", "sleep", "rules"]);
  }

  function addBathroomNook() {
    addRug(-15.7, -7.2, 3.4, 3.0, world.materials.tile);
    addTub(-13.7, -8.2, 0);
    addToilet(-17.2, -8.1, Math.PI / 2);
    addSink(-18.0, -5.4, Math.PI / 2);
    addTowelRack(-13.4, -5.4, Math.PI);
    addWall(-19.0, -7.4, 0.52, 5.2, 3.2, world.materials.wallDark);
  }

  function addUtilityRoom() {
    addRug(0.0, -7.5, 6.2, 6.6, world.materials.floor);
    addWasherPair(-4.6, -8.8, 0);
    addStorageShelves(4.6, -8.7, Math.PI);
    addStorageShelves(5.4, -2.2, -Math.PI / 2);
    addLaundryBasket(-2.0, -2.2);
    addSponsorStacks();
  }

  function addHomeOffice() {
    addRug(24.2, -17.6, 9.4, 8.0, world.materials.fabricWarm);
    addOfficeDesk(25.0, -17.2, Math.PI);
    addOfficeChair(25.0, -19.0, 0);
    addBookshelf(34.0, -14.0, -Math.PI / 2);
    addBookshelf(34.0, -22.0, -Math.PI / 2);
    addArmchair(14.0, -10.2, -0.7);
    addSideboard(14.0, -25.0, 0);
    addPaperMess(26.0, -16.4, 9, 2.8, 1.6);
    addCableSnake(23.9, -18.8);
    addPictureCluster(36.2, -17.6, -Math.PI / 2, ["contract", "contract", "contract"]);
  }

  function addProductionContamination() {
    addTripod(-3.8, 32.8, Math.PI + 0.1);
    addTripod(3.8, 32.8, Math.PI - 0.1);
    addTripod(-10.4, 20.8, -Math.PI / 2);
    addTripod(10.4, 17.8, Math.PI / 2);
    addPrizePile(21.2, 8.2, 3);
    addPrizePile(-29.6, 23.0, 2);
  }

  function addTable(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.16, 36), world.materials.wallDark);
    top.position.y = 0.84;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);
    const legGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.82, 10);
    [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, world.materials.trim);
      leg.position.set(lx, 0.42, lz);
      group.add(leg);
    });
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 3.2, 3.2, false);
    return group;
  }

  function addSofa(x, z, yaw, material = world.materials.leather) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 3.2, 0.46, 1.05, material, 0, 0.48, 0);
    addBox(group, 3.35, 1.1, 0.28, material, 0, 1.0, 0.5);
    addBox(group, 0.26, 0.82, 1.12, material, -1.78, 0.82, 0);
    addBox(group, 0.26, 0.82, 1.12, material, 1.78, 0.82, 0);
    for (let i = 0; i < 3; i++) {
      addBox(group, 0.9, 0.1, 0.82, world.materials.fabricWarm, -0.95 + i * 0.95, 0.75, -0.12, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.8, 1.7, false);
    return group;
  }

  function addCoffeeTable(x, z, yaw = 0) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.3, 0.14, 1.08, world.materials.wood, 0, 0.55, 0);
    addBox(group, 0.14, 0.48, 0.14, world.materials.darkWood, -0.9, 0.28, -0.38);
    addBox(group, 0.14, 0.48, 0.14, world.materials.darkWood, 0.9, 0.28, -0.38);
    addBox(group, 0.14, 0.48, 0.14, world.materials.darkWood, -0.9, 0.28, 0.38);
    addBox(group, 0.14, 0.48, 0.14, world.materials.darkWood, 0.9, 0.28, 0.38);
    addBox(group, 0.64, 0.04, 0.42, world.materials.paper, 0.35, 0.65, -0.1, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.6, 1.4, false);
    return group;
  }

  function addMediaConsole(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.7, 0.58, 0.56, world.materials.darkWood, 0, 0.38, 0);
    addBox(group, 2.35, 1.25, 0.08, world.materials.black, 0, 1.45, -0.34);
    addBox(group, 2.1, 0.96, 0.04, world.materials.glass, 0, 1.45, -0.39, false);
    addBox(group, 0.7, 0.08, 0.06, world.materials.red, 0, 1.45, -0.43, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.0, 1.0, false);
  }

  function addFireplace(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.2, 1.35, 0.38, world.materials.darkWood, 0, 0.68, 0);
    addBox(group, 1.35, 0.72, 0.08, world.materials.black, 0, 0.56, -0.23, false);
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12 + i * 0.02, 0.55, 5), i % 2 ? world.materials.yellow : world.materials.red);
      flame.position.set(-0.26 + i * 0.26, 0.68, -0.31);
      flame.rotation.y = i * 0.7;
      group.add(flame);
    }
    const light = new THREE.PointLight(0xff5f3d, 0.9, 6);
    light.position.set(0, 0.86, -0.42);
    group.add(light);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.6, 0.8, false);
  }

  function addStaircase(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      addBox(group, 2.65, 0.18, 0.46, world.materials.wood, 0, 0.09 + i * 0.19, -i * 0.29);
    }
    addBox(group, 3.15, 0.18, 1.25, world.materials.hardwood, 0, UPPER_FLOOR_Y - 0.08, -6.45);
    addBox(group, 0.1, 3.8, 6.8, world.materials.trim, -1.44, 2.1, -3.2);
    addBox(group, 0.1, 3.8, 6.8, world.materials.trim, 1.44, 2.1, -3.2);
    addBox(group, 3.2, 0.12, 0.16, world.materials.trim, 0, UPPER_FLOOR_Y + 0.14, -6.95);
    addBox(group, 0.16, 3.0, 0.16, world.materials.darkWood, -1.44, 1.52, 0.2);
    addBox(group, 0.16, 3.0, 0.16, world.materials.darkWood, 1.44, 1.52, 0.2);
    addBox(group, 0.16, 4.1, 0.16, world.materials.darkWood, -1.44, UPPER_FLOOR_Y - 0.1, -6.75);
    addBox(group, 0.16, 4.1, 0.16, world.materials.darkWood, 1.44, UPPER_FLOOR_Y - 0.1, -6.75);
    const stairSign = makeTextSign("UPSTAIRS", 1.7, 0.42, "#050505", "#f0c336");
    stairSign.position.set(0, 1.8, 0.64);
    stairSign.rotation.y = Math.PI;
    group.add(stairSign);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x - Math.sin(yaw) * 3.2, z - Math.cos(yaw) * 3.2, 3.3, 7.2, false);
  }

  function addKitchenClutter(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.38, 0.34, 0.38, world.materials.appliance, -1.22, 1.18, -0.2, false);
    addBox(group, 0.8, 0.06, 0.42, world.materials.paper, 0.25, 1.2, 0.28, false);
    addBox(group, 0.28, 0.18, 0.18, world.materials.red, 0.92, 1.25, -0.26, false);
    addBox(group, 0.28, 0.18, 0.18, world.materials.green, 1.22, 1.25, -0.12, false);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.18, 18), world.materials.porcelain);
    bowl.position.set(-0.38, 1.18, -0.16);
    group.add(bowl);
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addNormalHouseClutter() {
    addPaperMess(-0.4, 24.0, 5, 1.8, 1.1);
    addPaperMess(-32.0, 12.0, 4, 1.5, 1.0);
    addPaperMess(30.8, -19.0, 5, 1.7, 1.2);
    addWallClock(0, 35.1, 0);
    addWallClock(-36.2, 16.2, Math.PI / 2);
    addWasteBin(-31.6, 8.4);
    addWasteBin(31.6, -8.8);
  }

  function addCoatRack(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.9, 10), world.materials.darkWood);
    pole.position.y = 1.0;
    group.add(pole);
    addBox(group, 0.78, 0.08, 0.78, world.materials.darkWood, 0, 0.06, 0);
    for (let i = 0; i < 4; i++) {
      const hook = addBox(group, 0.46, 0.055, 0.055, world.materials.chrome, 0, 1.86, 0, false);
      hook.rotation.y = i * Math.PI / 2;
      addBox(group, 0.32, 0.7, 0.08, i % 2 ? world.materials.fabric : world.materials.fabricWarm, Math.sin(i) * 0.22, 1.34, Math.cos(i) * 0.22, false);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 0.95, 0.95, false);
  }

  function addShoePile(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const shoe = addBox(group, 0.42, 0.12, 0.22, i % 2 ? world.materials.leather : world.materials.black, -0.45 + (i % 3) * 0.42, 0.08, -0.2 + Math.floor(i / 3) * 0.32, false);
      shoe.rotation.y = -0.5 + i * 0.28;
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addUpperCabinetRun(x, z, yaw, length) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, length, 0.72, 0.42, world.materials.darkWood, 0, 2.18, 0);
    const doorCount = Math.max(2, Math.floor(length / 1.35));
    for (let i = 0; i <= doorCount; i++) {
      const offset = -length / 2 + (length / doorCount) * i;
      addBox(group, 0.035, 0.64, 0.055, world.materials.trim, offset, 2.18, -0.24, false);
    }
    for (let i = 0; i < doorCount; i++) {
      const offset = -length / 2 + (length / doorCount) * (i + 0.5);
      addBox(group, 0.08, 0.04, 0.06, world.materials.chrome, offset, 2.05, -0.27, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addRangeHood(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.25, 0.18, 0.62, world.materials.appliance, 0, 2.06, 0);
    addBox(group, 0.58, 0.65, 0.42, world.materials.appliance, 0, 2.42, 0.02);
    addBox(group, 0.86, 0.06, 0.05, world.materials.black, 0, 1.93, -0.35, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addBreakfastNook(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.55, 0.14, 1.05, world.materials.wood, 0, 0.74, 0);
    addBox(group, 0.14, 0.68, 0.14, world.materials.darkWood, -0.58, 0.36, -0.36);
    addBox(group, 0.14, 0.68, 0.14, world.materials.darkWood, 0.58, 0.36, -0.36);
    addBox(group, 0.14, 0.68, 0.14, world.materials.darkWood, -0.58, 0.36, 0.36);
    addBox(group, 0.14, 0.68, 0.14, world.materials.darkWood, 0.58, 0.36, 0.36);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 18), world.materials.porcelain);
    plate.position.set(-0.28, 0.84, 0.08);
    group.add(plate);
    addBox(group, 0.38, 0.16, 0.24, world.materials.paper, 0.34, 0.88, -0.18, false);
    group.position.set(x, 0, z);
    world.scene.add(group);
    addDiningChair(x - 1.05, z, Math.PI / 2);
    addDiningChair(x + 1.05, z, -Math.PI / 2);
    addPropCollision(x, z, 1.9, 1.35, false);
  }

  function addRollingCart(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.25, 0.1, 0.7, world.materials.chrome, 0, 0.5, 0);
    addBox(group, 1.25, 0.1, 0.7, world.materials.chrome, 0, 1.02, 0);
    for (let i = 0; i < 4; i++) {
      addBox(group, 0.06, 1.0, 0.06, world.materials.chrome, -0.52 + (i % 2) * 1.04, 0.55, -0.27 + Math.floor(i / 2) * 0.54);
    }
    addBox(group, 0.42, 0.28, 0.32, world.materials.red, -0.32, 1.21, 0.08, false);
    addBox(group, 0.36, 0.24, 0.3, world.materials.green, 0.24, 1.19, -0.12, false);
    group.position.set(x, 0, z);
    group.rotation.y = -0.18;
    world.scene.add(group);
    addPropCollision(x, z, 1.55, 1.0, false);
  }

  function addKitchenForegroundDetails(x, z) {
    addRug(x, z, 3.6, 4.2, world.materials.fabricWarm, 0);
    addPaperMess(x - 0.55, z + 0.25, 4, 1.0, 0.7);
    addBox(world.scene, 0.52, 0.24, 0.34, world.materials.paper, x + 0.72, 0.16, z - 0.72, false);
    addBox(world.scene, 0.36, 0.2, 0.28, world.materials.green, x + 0.36, 0.14, z - 0.42, false);
    addBox(world.scene, 0.34, 0.18, 0.26, world.materials.red, x + 1.0, 0.13, z - 0.18, false);
    addBox(world.scene, 0.76, 0.08, 0.18, world.materials.darkWood, x - 1.2, 0.08, z + 1.15, false);
  }

  function addDishRack(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.92, 0.06, 0.42, world.materials.chrome, 0, 1.12, 0, false);
    for (let i = 0; i < 5; i++) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.025, 18), world.materials.porcelain);
      plate.position.set(-0.34 + i * 0.17, 1.22, 0);
      plate.rotation.x = Math.PI / 2;
      group.add(plate);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addTableSettings(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const spots = [
      [-1.7, -0.72], [-0.55, -0.72], [0.55, -0.72], [1.7, -0.72],
      [-1.7, 0.72], [-0.55, 0.72], [0.55, 0.72], [1.7, 0.72],
    ];
    spots.forEach(([px, pz], index) => {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20), world.materials.porcelain);
      plate.position.set(px, 0.95, pz);
      group.add(plate);
      addBox(group, 0.04, 0.025, 0.36, index % 2 ? world.materials.chrome : world.materials.black, px + 0.34, 0.98, pz, false);
    });
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addLaundryBasket(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.62, 16), world.materials.paper);
    basket.position.y = 0.32;
    basket.castShadow = true;
    group.add(basket);
    for (let i = 0; i < 4; i++) {
      addBox(group, 0.32, 0.12, 0.26, i % 2 ? world.materials.fabric : world.materials.fabricWarm, -0.2 + (i % 2) * 0.4, 0.7 + i * 0.035, -0.1 + Math.floor(i / 2) * 0.24, false);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 0.9, 0.9, false);
  }

  function addClothingPile(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const cloth = addBox(group, 0.52, 0.08, 0.36, i % 3 ? world.materials.fabricWarm : world.materials.fabric, Math.sin(i * 1.2) * 0.55, 0.06 + i * 0.018, Math.cos(i * 0.9) * 0.42, false);
      cloth.rotation.y = i * 0.62;
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addTowelRack(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.05, 0.06, 0.08, world.materials.chrome, 0, 1.62, 0, false);
    addBox(group, 0.82, 0.72, 0.05, world.materials.fabricWarm, 0, 1.22, -0.04, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addPaperMess(x, z, count, spreadX, spreadZ) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.024, 0.3), world.materials.paper);
      paper.position.set(Math.sin(i * 1.91) * spreadX * 0.5, 0.035 + i * 0.004, Math.cos(i * 1.37) * spreadZ * 0.5);
      paper.rotation.y = i * 0.73;
      group.add(paper);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addCableSnake(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const segment = addBox(group, 0.42, 0.035, 0.055, world.materials.black, -0.92 + i * 0.34, 0.045, Math.sin(i) * 0.16, false);
      segment.rotation.y = Math.sin(i * 1.2) * 0.7;
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addWallClock(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.055, 28), world.materials.paper);
    face.rotation.x = Math.PI / 2;
    face.position.y = 2.35;
    group.add(face);
    addBox(group, 0.035, 0.28, 0.035, world.materials.black, 0, 2.37, -0.04, false);
    addBox(group, 0.2, 0.03, 0.035, world.materials.black, 0.08, 2.37, -0.045, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addWasteBin(x, z) {
    const THREE = window.THREE;
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.58, 14), world.materials.black);
    bin.position.set(x, 0.3, z);
    bin.castShadow = true;
    world.scene.add(bin);
    addPropCollision(x, z, 0.72, 0.72, false);
  }

  function addPendantLight(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), world.materials.black);
    cable.position.y = 3.4;
    group.add(cable);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.34, 18), world.materials.black);
    shade.position.y = 2.78;
    group.add(shade);
    const bulb = new THREE.PointLight(0xffdf9a, 0.48, 5);
    bulb.position.y = 2.62;
    group.add(bulb);
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addFloorLamp(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.42, 0.08, 0.42, world.materials.chrome, 0, 0.04, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.75, 10), world.materials.chrome);
    pole.position.y = 0.9;
    pole.castShadow = true;
    group.add(pole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.5, 18), world.materials.paper);
    shade.position.y = 1.92;
    shade.castShadow = true;
    group.add(shade);
    const light = new THREE.PointLight(0xffd89a, 0.58, 6);
    light.position.y = 1.9;
    group.add(light);
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addHousePlant(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.48, 14), world.materials.wallDark);
    pot.position.y = 0.24;
    pot.castShadow = true;
    group.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.82, 5), world.materials.green);
      leaf.position.set(Math.sin(i) * 0.18, 0.86, Math.cos(i * 1.7) * 0.18);
      leaf.rotation.set(0.55 + i * 0.04, i * 0.9, -0.3 + i * 0.1);
      group.add(leaf);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addPictureCluster(x, z, yaw, labels) {
    labels.forEach((label, index) => {
      const y = 1.55 + (index % 2) * 0.72;
      const offset = (index - 1) * 0.92;
      const sign = makeTextSign(label.toUpperCase(), 0.82, 0.42, "#22170f", index === 2 ? "#ffb9b9" : "#e5d3b4");
      sign.position.set(x, y, z + offset);
      sign.rotation.y = yaw;
      world.scene.add(sign);
    });
  }

  function addKitchenCounter(x, z, w, d) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, w, 0.9, d, world.materials.darkWood, 0, 0.45, 0);
    addBox(group, w + 0.08, 0.12, d + 0.08, world.materials.tile, 0, 0.98, 0);
    addBox(group, Math.max(0.25, w - 0.18), 0.08, Math.max(0.25, d - 0.18), world.materials.black, 0, 1.08, 0, false);
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, w + 0.25, d + 0.25, false);
    return group;
  }

  function addKitchenIsland(x, z) {
    const island = addKitchenCounter(x, z, 4.6, 1.65);
    addBox(island, 0.52, 0.06, 0.42, world.materials.paper, 0.6, 1.18, -0.28, false);
    for (let i = 0; i < 3; i++) addDiningChair(x - 1.4 + i * 1.4, z - 1.35, Math.PI);
  }

  function addAppliance(x, z, w, d, kind) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const h = kind === "fridge" ? 2.35 : kind === "oven" ? 1.1 : 0.82;
    addBox(group, w, h, d, world.materials.appliance, 0, h / 2, 0);
    if (kind === "fridge") {
      addBox(group, w * 0.78, 0.06, 0.05, world.materials.chrome, 0, 1.22, -d / 2 - 0.03, false);
      addBox(group, 0.06, 1.55, 0.06, world.materials.chrome, w / 2 - 0.18, 1.25, -d / 2 - 0.05, false);
    } else if (kind === "oven") {
      addBox(group, w * 0.72, 0.52, 0.06, world.materials.glass, 0, 0.62, -d / 2 - 0.04, false);
      addBox(group, w * 0.86, 0.08, 0.08, world.materials.black, 0, 1.16, -d / 2 - 0.04, false);
    } else {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.16, 18), world.materials.chrome);
      basin.position.set(0, 0.92, 0);
      basin.scale.x = 1.45;
      group.add(basin);
      const faucet = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 18, Math.PI), world.materials.chrome);
      faucet.position.set(0.22, 1.12, -0.15);
      faucet.rotation.y = Math.PI / 2;
      group.add(faucet);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, w + 0.25, d + 0.25, false);
  }

  function addDiningSet(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 4.9, 0.18, 2.15, world.materials.wood, 0, 0.82, 0);
    addBox(group, 0.18, 0.78, 0.18, world.materials.darkWood, -2.0, 0.4, -0.78);
    addBox(group, 0.18, 0.78, 0.18, world.materials.darkWood, 2.0, 0.4, -0.78);
    addBox(group, 0.18, 0.78, 0.18, world.materials.darkWood, -2.0, 0.4, 0.78);
    addBox(group, 0.18, 0.78, 0.18, world.materials.darkWood, 2.0, 0.4, 0.78);
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 5.4, 2.7, false);
    [-2, -0.7, 0.7, 2].forEach((offset) => {
      addDiningChair(x + offset, z - 1.75, 0);
      addDiningChair(x + offset, z + 1.75, Math.PI);
    });
  }

  function addSideboard(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 3.1, 0.86, 0.72, world.materials.darkWood, 0, 0.43, 0);
    addBox(group, 2.7, 0.08, 0.12, world.materials.chrome, 0, 0.86, -0.43, false);
    addBox(group, 0.42, 0.52, 0.36, world.materials.glass, -0.85, 1.16, 0, false);
    addBox(group, 0.42, 0.52, 0.36, world.materials.glass, 0.85, 1.16, 0, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.4, 1.1, false);
  }

  function addChinaCabinet(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.1, 2.35, 0.58, world.materials.darkWood, 0, 1.18, 0);
    addBox(group, 1.72, 1.65, 0.06, world.materials.glass, 0, 1.42, -0.34, false);
    for (let i = 0; i < 4; i++) addBox(group, 1.76, 0.06, 0.44, world.materials.wood, 0, 0.55 + i * 0.42, -0.04, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.4, 0.95, false);
  }

  function addRealBed(x, z, yaw, blanketMaterial = world.materials.fabric) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.45, 0.36, 4.1, world.materials.darkWood, 0, 0.35, 0);
    addBox(group, 2.28, 0.22, 3.6, blanketMaterial, 0, 0.69, 0.24);
    addBox(group, 2.62, 1.4, 0.22, world.materials.darkWood, 0, 1.02, 1.96);
    addBox(group, 0.86, 0.2, 0.72, world.materials.white, -0.55, 0.92, 1.16, false);
    addBox(group, 0.86, 0.2, 0.72, world.materials.white, 0.55, 0.92, 1.16, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.0, 4.6, false);
  }

  function addNightstand(x, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.82, 0.62, 0.72, world.materials.darkWood, 0, 0.31, 0);
    addBox(group, 0.26, 0.34, 0.26, world.materials.paper, 0, 0.86, 0, false);
    const light = new THREE.PointLight(0xffd89a, 0.4, 4);
    light.position.set(0, 1.05, 0);
    group.add(light);
    group.position.set(x, 0, z);
    world.scene.add(group);
    addPropCollision(x, z, 1.0, 0.9, false);
  }

  function addDresser(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 3.2, 0.92, 0.74, world.materials.darkWood, 0, 0.46, 0);
    for (let i = 0; i < 6; i++) {
      addBox(group, 0.92, 0.06, 0.05, world.materials.chrome, -0.95 + (i % 3) * 0.95, 0.35 + Math.floor(i / 3) * 0.32, -0.42, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.5, 1.1, false);
  }

  function addVanity(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.45, 0.78, 0.72, world.materials.wood, 0, 0.39, 0);
    addBox(group, 1.24, 1.08, 0.08, world.materials.glass, 0, 1.42, -0.42, false);
    for (let i = 0; i < 5; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffefb7 }));
      bulb.position.set(-0.62 + i * 0.31, 1.94, -0.49);
      group.add(bulb);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.7, 1.0, false);
  }

  function addWardrobe(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.25, 2.5, 0.86, world.materials.darkWood, 0, 1.25, 0);
    addBox(group, 0.06, 2.25, 0.08, world.materials.trim, 0, 1.25, -0.48, false);
    addBox(group, 0.08, 0.32, 0.08, world.materials.chrome, -0.18, 1.27, -0.55, false);
    addBox(group, 0.08, 0.32, 0.08, world.materials.chrome, 0.18, 1.27, -0.55, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.5, 1.2, false);
  }

  function addTub(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.2, 0.6, 0.92, world.materials.porcelain, 0, 0.38, 0);
    addBox(group, 1.72, 0.2, 0.58, world.materials.tile, 0, 0.7, 0, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.4, 1.2, false);
  }

  function addToilet(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.42, 18), world.materials.porcelain);
    bowl.position.y = 0.36;
    group.add(bowl);
    addBox(group, 0.72, 0.62, 0.22, world.materials.porcelain, 0, 0.78, 0.42);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 0.95, 1.0, false);
  }

  function addSink(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.0, 0.72, 0.62, world.materials.wood, 0, 0.36, 0);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.16, 18), world.materials.porcelain);
    basin.position.y = 0.82;
    basin.scale.x = 1.3;
    group.add(basin);
    addBox(group, 0.86, 0.82, 0.05, world.materials.glass, 0, 1.45, -0.35, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 1.25, 0.9, false);
  }

  function addWasherPair(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    [-0.62, 0.62].forEach((offset) => {
      addBox(group, 1.05, 1.15, 0.95, world.materials.appliance, offset, 0.58, 0);
      const door = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.055, 24), world.materials.glass);
      door.position.set(offset, 0.58, -0.51);
      door.rotation.x = Math.PI / 2;
      group.add(door);
    });
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.6, 1.25, false);
  }

  function addStorageShelves(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.8, 0.1, 0.62, world.materials.darkWood, 0, 0.65, 0);
    addBox(group, 2.8, 0.1, 0.62, world.materials.darkWood, 0, 1.35, 0);
    addBox(group, 2.8, 0.1, 0.62, world.materials.darkWood, 0, 2.05, 0);
    for (let i = 0; i < 7; i++) {
      addBox(group, 0.42, 0.34, 0.38, i % 2 ? world.materials.red : world.materials.paper, -1.05 + (i % 4) * 0.7, 0.92 + Math.floor(i / 4) * 0.72, -0.02, false);
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.1, 0.9, false);
  }

  function addOfficeDesk(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 3.3, 0.16, 1.45, world.materials.wood, 0, 0.82, 0);
    addBox(group, 0.26, 0.82, 0.26, world.materials.darkWood, -1.35, 0.42, -0.5);
    addBox(group, 0.26, 0.82, 0.26, world.materials.darkWood, 1.35, 0.42, -0.5);
    addBox(group, 0.26, 0.82, 0.26, world.materials.darkWood, -1.35, 0.42, 0.5);
    addBox(group, 0.26, 0.82, 0.26, world.materials.darkWood, 1.35, 0.42, 0.5);
    addBox(group, 1.2, 0.72, 0.08, world.materials.black, 0.35, 1.28, -0.52);
    addBox(group, 0.9, 0.04, 0.62, world.materials.paper, -0.75, 0.94, 0.16, false);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 3.7, 1.8, false);
  }

  function addOfficeChair(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 0.82, 0.22, 0.82, world.materials.leather, 0, 0.62, 0);
    addBox(group, 0.82, 1.0, 0.18, world.materials.leather, 0, 1.12, 0.38);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.52, 10), world.materials.chrome);
    stem.position.y = 0.31;
    group.add(stem);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 1.0, 1.0, false);
  }

  function addBookshelf(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 2.1, 2.45, 0.52, world.materials.darkWood, 0, 1.22, 0);
    for (let shelf = 0; shelf < 4; shelf++) {
      addBox(group, 1.82, 0.08, 0.44, world.materials.wood, 0, 0.55 + shelf * 0.48, -0.02, false);
      for (let i = 0; i < 5; i++) {
        addBox(group, 0.16, 0.34 + (i % 2) * 0.12, 0.2, i % 3 ? world.materials.red : world.materials.green, -0.72 + i * 0.34, 0.76 + shelf * 0.48, -0.22, false);
      }
    }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.4, 0.85, false);
  }

  function addArmchair(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    addBox(group, 1.1, 0.42, 1.0, world.materials.fabricWarm, 0, 0.48, 0);
    addBox(group, 1.22, 1.0, 0.2, world.materials.fabricWarm, 0, 0.98, 0.48);
    addBox(group, 0.2, 0.7, 1.0, world.materials.fabricWarm, -0.66, 0.74, 0);
    addBox(group, 0.2, 0.7, 1.0, world.materials.fabricWarm, 0.66, 0.74, 0);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 1.55, 1.35, false);
  }

  function addDiningChair(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.72), world.materials.black);
    seat.position.y = 0.52;
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.0, 0.14), world.materials.red);
    back.position.set(0, 1.04, 0.36);
    group.add(back);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 1.1, 1.1, false);
  }

  function addCubicleBed(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.32, 0.92), world.materials.wallDark);
    frame.position.y = 0.34;
    group.add(frame);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.7), world.materials.white);
    pillow.position.set(-0.72, 0.62, 0);
    group.add(pillow);
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.92), world.materials.cyan);
    monitor.position.set(1.05, 0.92, 0);
    group.add(monitor);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
    addPropCollision(x, z, 2.2, 1.2, false);
  }

  function addTripod(x, z, yaw) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.45, 8), world.materials.chrome);
    stem.position.y = 0.78;
    group.add(stem);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.32), world.materials.black);
    cam.position.set(0, 1.58, -0.12);
    group.add(cam);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 12), world.materials.glass);
    lens.position.set(0, 1.58, -0.34);
    lens.rotation.x = Math.PI / 2;
    group.add(lens);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    world.scene.add(group);
  }

  function addPrizePile(x, z, count) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.36, 0.48), i % 2 ? world.materials.green : world.materials.yellow);
      box.position.set((Math.random() - 0.5) * 2.3, 0.2 + i * 0.08, (Math.random() - 0.5) * 1.5);
      box.rotation.y = Math.random() * Math.PI;
      box.castShadow = true;
      group.add(box);
    }
    group.position.set(x, 0, z);
    world.scene.add(group);
  }

  function addSponsorStacks() {
    const signs = [
      ["FEAST WATER", -4.6, -9.3],
      ["SLEEP COINS", 4.6, -9.4],
      ["LEGAL SNACKS", -4.6, -3.5],
    ];
    signs.forEach(([text, x, z], index) => {
      const group = new window.THREE.Group();
      for (let i = 0; i < 5; i++) {
        const crate = new window.THREE.Mesh(new window.THREE.BoxGeometry(1.1, 0.52, 0.8), index % 2 ? world.materials.cyan : world.materials.red);
        crate.position.set((i % 2) * 0.6, 0.28 + i * 0.48, Math.floor(i / 2) * 0.42);
        crate.castShadow = true;
        group.add(crate);
      }
      group.position.set(x, 0, z);
      world.scene.add(group);
      const sign = makeTextSign(text, 2.2, 0.58, "#050505", "#f0c336");
      sign.position.set(x + 0.38, 2.9, z - 0.54);
      sign.rotation.y = 0;
      world.scene.add(sign);
      addPropCollision(x + 0.2, z + 0.2, 2.3, 1.7, false);
    });
  }

  function addSign(text, x, y, z, yaw, w, h, bg, fg) {
    const sign = makeTextSign(text, w, h, bg, fg);
    sign.position.set(x, y, z);
    sign.rotation.y = yaw;
    world.scene.add(sign);
    return sign;
  }

  function makeTextSign(text, w, h, bg, fg) {
    const THREE = window.THREE;
    const cnv = document.createElement("canvas");
    cnv.width = 512;
    cnv.height = 128;
    const ctx = cnv.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cnv.width, cnv.height);
    ctx.strokeStyle = "rgba(240,195,54,0.7)";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, cnv.width - 16, cnv.height - 16);
    ctx.fillStyle = fg;
    ctx.font = "900 42px Arial Black, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cnv.width / 2, cnv.height / 2 + 2, cnv.width - 52);
    const texture = new THREE.CanvasTexture(cnv);
    texture.encoding = THREE.sRGBEncoding;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  }

  function makeTaskProp(task) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.84, 0.2, 24), world.materials.black);
    base.position.y = 0.1;
    base.receiveShadow = true;
    group.add(base);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.035, 8, 42), world.materials.yellow);
    ring.position.y = 0.08;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.userData.ring = ring;

    if (task.type === "camera") {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.8, 10), world.materials.chrome);
      pole.position.y = 0.98;
      group.add(pole);
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.38, 0.48), world.materials.black);
      cam.position.set(0, 1.92, -0.05);
      cam.castShadow = true;
      group.add(cam);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 16), world.materials.glass);
      lens.position.set(0, 1.92, -0.34);
      lens.rotation.x = Math.PI / 2;
      group.add(lens);
    } else if (task.type === "pizza") {
      const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.92, 0.16, 32), world.materials.chrome);
      tray.position.y = 0.76;
      group.add(tray);
      const pizza = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.08, 32), world.materials.yellow);
      pizza.position.y = 0.91;
      group.add(pizza);
      const drip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.58, 4), world.materials.red);
      drip.position.set(0.28, 0.72, -0.12);
      drip.rotation.y = Math.PI / 4;
      group.add(drip);
      const flame = new THREE.PointLight(0xff5f3d, 2.8, 8);
      flame.position.set(0, 1.2, 0);
      group.add(flame);
    } else if (task.type === "cash") {
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.3, 18), world.materials.green);
      cannon.position.set(0, 1.12, 0);
      cannon.rotation.x = Math.PI / 2;
      cannon.castShadow = true;
      group.add(cannon);
      for (let i = 0; i < 7; i++) {
        const bill = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.03, 0.22), world.materials.green);
        bill.position.set((Math.random() - 0.5) * 1.4, 1.1 + Math.random() * 0.8, -0.55 + Math.random() * 0.8);
        bill.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
        group.add(bill);
      }
    } else if (task.type === "breaker") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.25, 0.22), world.materials.cyan);
      box.position.set(0, 1.18, -0.24);
      box.castShadow = true;
      group.add(box);
      for (let i = 0; i < 4; i++) {
        const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.08), i % 2 ? world.materials.red : world.materials.yellow);
        toggle.position.set(-0.27 + i * 0.18, 1.2, -0.4);
        toggle.rotation.z = i % 2 ? 0.22 : -0.22;
        group.add(toggle);
      }
    } else if (task.type === "siren") {
      const speaker = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.1, 24), world.materials.red);
      speaker.position.y = 1.08;
      speaker.rotation.x = -Math.PI / 2;
      group.add(speaker);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), world.materials.yellow);
      orb.position.set(0, 1.86, -0.42);
      group.add(orb);
    } else {
      const shredder = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.82, 0.68), world.materials.black);
      shredder.position.y = 0.82;
      shredder.castShadow = true;
      group.add(shredder);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.08), world.materials.red);
      slot.position.set(0, 1.16, -0.38);
      group.add(slot);
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 0.74), world.materials.white);
      paper.position.set(0, 1.44, -0.18);
      paper.rotation.x = 0.34;
      group.add(paper);
    }

    const label = makeTextSign(task.room.toUpperCase(), 2.35, 0.48, "#050505", "#f0c336");
    label.position.set(0, 2.5, 0);
    group.add(label);

    const doneMarker = new THREE.Group();
    const doneRing = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.045, 8, 42), world.materials.green);
    doneRing.rotation.x = Math.PI / 2;
    doneRing.position.y = 1.72;
    doneMarker.add(doneRing);
    const doneSign = makeTextSign("CLEARED", 1.55, 0.36, "#06120b", "#b8ffc0");
    doneSign.position.set(0, 2.08, 0);
    doneMarker.add(doneSign);
    doneMarker.visible = false;
    group.add(doneMarker);
    group.userData.doneMarker = doneMarker;
    return group;
  }

  function makeCameraHazard(def) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), world.materials.chrome);
    stand.position.y = 0.86;
    group.add(stand);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.42), world.materials.black);
    body.position.set(0, 1.75, 0);
    body.castShadow = true;
    group.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12), world.materials.glass);
    lens.position.set(0, 1.75, -0.29);
    lens.rotation.x = Math.PI / 2;
    group.add(lens);

    const geometry = new THREE.BufferGeometry();
    const half = Math.tan(0.34) * def.range;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0.055, 0,
      -half, 0.055, -def.range,
      half, 0.055, -def.range,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const beam = new THREE.Mesh(geometry, world.materials.beam);
    beam.position.y = 0.015;
    group.add(beam);

    const light = new THREE.SpotLight(0xf0c336, 0.85, def.range + 2, 0.38, 0.5, 1.4);
    light.position.set(0, 1.72, 0);
    light.target.position.set(0, 1.15, -def.range);
    group.add(light);
    group.add(light.target);

    group.position.set(def.x, 0, def.z);
    group.rotation.y = def.yaw;
    world.scene.add(group);

    const hazard = {
      ...def,
      yaw: def.yaw,
      baseYaw: def.yaw,
      fov: 0.38,
      group,
      beam,
      light,
      spotted: false,
    };
    world.hazardGroups.push(group);
    return hazard;
  }

  function makeContestant(id) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.2, 0.78), world.materials.black);
    chair.position.y = 0.5;
    group.add(chair);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.8, 14), id % 2 ? world.materials.cyan : world.materials.red);
    body.position.y = 1.0;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), world.materials.white);
    head.position.y = 1.55;
    group.add(head);
    const tag = makeTextSign("#" + id, 0.6, 0.28, "#050505", "#f0c336");
    tag.position.set(0, 1.85, -0.31);
    group.add(tag);
    return group;
  }

  function addPropCollision(x, z, w, d, blocksSight, level = 0) {
    addCollisionRect(x, z, w, d, blocksSight, "prop", level);
  }

  function bindInputs() {
    const keyMap = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "back",
      ArrowDown: "back",
      KeyA: "left",
      KeyD: "right",
      ShiftLeft: "sprint",
      ShiftRight: "sprint",
      KeyF: "interact",
      KeyE: "interact",
      Space: "interact",
      KeyQ: "turnLeft",
      ArrowLeft: "turnLeft",
      ArrowRight: "turnRight",
      KeyR: "turnRight",
    };

    document.addEventListener("pointerlockchange", syncPointerLock);
    document.addEventListener("pointerlockerror", () => {
      if (state.running && !state.paused && !state.gameOver) {
        activateSoftMouseLock();
      } else {
        state.mouseLook.locked = false;
        updateMouseLookClass();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.code === "Escape" && state.running && !state.gameOver) {
        const justUnlocked = performance.now() - state.mouseLook.lastUnlockedAt < 350;
        if (isMouseCaptured() || justUnlocked) {
          if (document.pointerLockElement === canvas) document.exitPointerLock();
          releaseSoftMouseLock();
          event.preventDefault();
          return;
        }
        setPaused(!state.paused);
        return;
      }
      const action = keyMap[event.code];
      if (!action) return;
      event.preventDefault();
      state.input[action] = true;
    });

    window.addEventListener("keyup", (event) => {
      const action = keyMap[event.code];
      if (!action) return;
      event.preventDefault();
      state.input[action] = false;
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (!state.running || state.paused || state.gameOver) return;
      canvas.focus({ preventScroll: true });
      if (event.pointerType === "mouse") {
        requestMouseLock();
        event.preventDefault();
        return;
      }

      state.mouseLook.suppressClickUntil = performance.now() + 650;
      state.mouseLook.dragging = true;
      state.mouseLook.pointerId = event.pointerId;
      state.mouseLook.lastX = event.clientX;
      state.mouseLook.lastY = event.clientY;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {}
    });

    canvas.addEventListener("click", (event) => {
      if (!state.running || state.paused || state.gameOver) return;
      if (event.button && event.button !== 0) return;
      if (performance.now() < state.mouseLook.suppressClickUntil) {
        event.preventDefault();
        return;
      }
      canvas.focus({ preventScroll: true });
      requestMouseLock();
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.running || state.paused || state.gameOver) return;
      if (document.pointerLockElement === canvas || state.mouseLook.softLocked) {
        applyMouseLook(event.movementX, event.movementY);
      }
    });

    window.addEventListener("pointermove", (event) => {
      if (!state.running || state.paused || state.gameOver) return;
      if (document.pointerLockElement === canvas) return;
      if (event.pointerType === "mouse") return;
      if (!state.mouseLook.dragging || state.mouseLook.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.mouseLook.lastX;
      const dy = event.clientY - state.mouseLook.lastY;
      state.mouseLook.lastX = event.clientX;
      state.mouseLook.lastY = event.clientY;
      applyMouseLook(dx, dy);
      event.preventDefault();
    });

    window.addEventListener("pointerup", stopMouseLook);
    window.addEventListener("pointercancel", stopMouseLook);

    document.querySelectorAll("[data-hold-action]").forEach((button) => {
      const action = button.dataset.holdAction;
      const set = (value) => {
        state.input[action] = value;
        button.classList.toggle("is-held", value);
        canvas.focus({ preventScroll: true });
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        set(true);
      });
      button.addEventListener("pointerup", (event) => {
        event.preventDefault();
        set(false);
      });
      button.addEventListener("pointerleave", () => set(false));
      button.addEventListener("pointercancel", () => set(false));
    });

    const recenterView = () => {
      state.player.yaw = 0;
      state.player.pitch = 0;
      canvas.focus({ preventScroll: true });
    };
    [el.recenter, el.recenterTouch].forEach((button) => {
      if (!button) return;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        recenterView();
      });
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        state.player.yaw = 0;
        state.player.pitch = 0;
        button.classList.add("is-held");
        canvas.focus({ preventScroll: true });
      });
      button.addEventListener("pointerup", () => button.classList.remove("is-held"));
      button.addEventListener("pointerleave", () => button.classList.remove("is-held"));
      button.addEventListener("pointercancel", () => button.classList.remove("is-held"));
    });

    bindTouchMoveZone();

    bindLookSettings();

    if (el.primary) el.primary.addEventListener("click", startGame);
    if (el.pause) el.pause.addEventListener("click", () => setPaused(!state.paused));
    if (el.restart) {
      el.restart.addEventListener("click", () => {
        showOverlay("RESTART THE SEGMENT", "The crew will pretend this never happened. They are professionals.", "Restart");
      });
    }

    api.subscribe(renderPowerups);
  }

  function bindLookSettings() {
    if (el.lookSensitivity) {
      el.lookSensitivity.value = String(Math.round(state.settings.lookSensitivity * 100));
      el.lookSensitivity.addEventListener("input", () => {
        const raw = Number(el.lookSensitivity.value) / 100;
        state.settings.lookSensitivity = clamp(raw, 0.6, 1.6);
        updateLookSettingsUI();
        saveLookSettings();
      });
    }
    if (el.invertY) {
      el.invertY.checked = state.settings.invertY;
      el.invertY.addEventListener("change", () => {
        state.settings.invertY = Boolean(el.invertY.checked);
        updateLookSettingsUI();
        saveLookSettings();
      });
    }
    updateLookSettingsUI();
  }

  function updateLookSettingsUI() {
    if (el.lookSensitivityText) el.lookSensitivityText.textContent = `${Math.round(state.settings.lookSensitivity * 100)}%`;
    if (el.lookSensitivity) el.lookSensitivity.value = String(Math.round(state.settings.lookSensitivity * 100));
    if (el.invertY) el.invertY.checked = state.settings.invertY;
  }

  function applyMouseLook(dx, dy) {
    const sensitivity = state.settings.lookSensitivity;
    const pitchDirection = state.settings.invertY ? 1 : -1;
    state.player.yaw += dx * 0.0032 * sensitivity;
    state.player.pitch = clamp(state.player.pitch + dy * 0.0022 * sensitivity * pitchDirection, -0.58, 0.52);
  }

  function stopMouseLook(event) {
    if (event && state.mouseLook.pointerId !== null && event.pointerId !== state.mouseLook.pointerId) return;
    if (state.mouseLook.pointerId !== null) {
      try {
        canvas.releasePointerCapture(state.mouseLook.pointerId);
      } catch (error) {}
    }
    state.mouseLook.dragging = false;
    state.mouseLook.pointerId = null;
    state.mouseLook.hoverX = null;
    state.mouseLook.hoverY = null;
  }

  function bindTouchMoveZone() {
    if (!el.touchMoveZone) return;

    const update = (event) => {
      const dx = event.clientX - state.touchMove.startX;
      const dy = event.clientY - state.touchMove.startY;
      const rawStrafe = clamp(dx / 58, -1, 1);
      const rawForward = clamp(-dy / 58, -1, 1);
      const amount = Math.hypot(rawStrafe, rawForward);
      if (amount < 0.16) {
        state.touchMove.forward = 0;
        state.touchMove.strafe = 0;
        return;
      }
      const scale = Math.min(1, amount);
      state.touchMove.forward = (rawForward / amount) * scale;
      state.touchMove.strafe = (rawStrafe / amount) * scale;
    };

    el.touchMoveZone.addEventListener("pointerdown", (event) => {
      if (!state.running || state.paused || state.gameOver) return;
      state.touchMove.active = true;
      state.touchMove.pointerId = event.pointerId;
      state.touchMove.startX = event.clientX;
      state.touchMove.startY = event.clientY;
      state.touchMove.forward = 0;
      state.touchMove.strafe = 0;
      canvas.focus({ preventScroll: true });
      try {
        el.touchMoveZone.setPointerCapture(event.pointerId);
      } catch (error) {}
      event.preventDefault();
      event.stopPropagation();
    });

    el.touchMoveZone.addEventListener("pointermove", (event) => {
      if (!state.touchMove.active || state.touchMove.pointerId !== event.pointerId) return;
      update(event);
      event.preventDefault();
      event.stopPropagation();
    });

    const stop = (event) => {
      if (event && state.touchMove.pointerId !== null && state.touchMove.pointerId !== event.pointerId) return;
      resetTouchMove();
      event.preventDefault();
      event.stopPropagation();
    };
    el.touchMoveZone.addEventListener("pointerup", stop);
    el.touchMoveZone.addEventListener("pointercancel", stop);
    el.touchMoveZone.addEventListener("lostpointercapture", resetTouchMove);
  }

  function resetTouchMove() {
    state.touchMove.active = false;
    state.touchMove.pointerId = null;
    state.touchMove.forward = 0;
    state.touchMove.strafe = 0;
  }

  function isMouseCaptured() {
    return document.pointerLockElement === canvas || state.mouseLook.locked || state.mouseLook.softLocked;
  }

  function activateSoftMouseLock() {
    state.mouseLook.softLocked = true;
    state.mouseLook.locked = true;
    state.mouseLook.dragging = false;
    state.mouseLook.pointerId = null;
    updateMouseLookClass();
    showAlert("Mouse capture active. Press Escape to release.", "");
  }

  function requestMouseLock() {
    if (document.pointerLockElement === canvas || state.mouseLook.softLocked) return;
    if (!canvas.requestPointerLock) {
      activateSoftMouseLock();
      return;
    }
    try {
      const lockRequest = canvas.requestPointerLock();
      if (lockRequest && typeof lockRequest.catch === "function") {
        lockRequest.catch(activateSoftMouseLock);
      }
    } catch (error) {
      activateSoftMouseLock();
    }
  }

  function releaseSoftMouseLock() {
    if (!state.mouseLook.softLocked) return;
    state.mouseLook.softLocked = false;
    state.mouseLook.locked = document.pointerLockElement === canvas;
    state.mouseLook.lastUnlockedAt = performance.now();
    updateMouseLookClass();
    if (state.running && !state.paused && !state.gameOver) showAlert("Mouse released.", "");
  }

  function syncPointerLock() {
    const locked = document.pointerLockElement === canvas;
    if (state.mouseLook.locked === locked) return;
    state.mouseLook.locked = locked;
    state.mouseLook.softLocked = false;
    state.mouseLook.dragging = false;
    state.mouseLook.pointerId = null;
    state.mouseLook.hoverX = null;
    state.mouseLook.hoverY = null;
    updateMouseLookClass();
    if (locked) {
      showAlert("Mouse locked. Press Escape to release.", "");
    } else {
      state.mouseLook.lastUnlockedAt = performance.now();
      if (state.running && !state.paused && !state.gameOver) showAlert("Mouse released.", "");
    }
  }

  function updateMouseLookClass() {
    const captured = isMouseCaptured();
    canvas.classList.toggle("mouse-look-locked", captured);
    document.documentElement.classList.toggle("mrfeast-mouse-look-locked", captured);
  }

  function installLocalDirector() {
    const host = window.location.hostname;
    const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (!isLocal) return;

    const inspectionViews = {
      foyer: { x: 0, z: 30.4, yaw: 0, pitch: 0.12, level: 0, label: "foyer and upper gallery" },
      kitchen: { x: -15.0, z: 18.6, yaw: -Math.PI / 2, pitch: -0.05, level: 0, label: "kitchen" },
      dining: { x: 16.6, z: 15.7, yaw: Math.PI / 2, pitch: -0.04, level: 0, label: "dining room prop placement" },
      bedroom: { x: -16.0, z: -16.2, yaw: -Math.PI / 2, pitch: -0.05, level: 0, label: "main bedroom" },
      bathroom: { x: -17.8, z: -7.0, yaw: Math.PI / 2, pitch: -0.03, level: 0, label: "bathroom nook" },
      utility: { x: 0.6, z: -3.2, yaw: Math.PI, pitch: -0.05, level: 0, label: "utility hall" },
      office: { x: 16.6, z: -17.2, yaw: Math.PI / 2, pitch: -0.05, level: 0, label: "home office" },
      stairs: { x: STAIR_BOTTOM.x - 0.85, z: STAIR_BOTTOM.z - 0.1, yaw: STAIR_BOTTOM.yaw, pitch: -0.02, level: 0, label: "working staircase" },
      upstairs: { x: STAIR_TOP.x, z: STAIR_TOP.z, yaw: STAIR_TOP.yaw, pitch: -0.04, level: 1, label: "second floor landing" },
      upstairsEast: { x: 14.2, z: 23.4, yaw: Math.PI / 2, pitch: -0.05, level: 1, label: "upstairs east rooms" },
      upstairsWest: { x: -14.2, z: 18.8, yaw: -Math.PI / 2, pitch: -0.05, level: 1, label: "upstairs west rooms" },
    };

    const applyInspectionView = (view) => {
      state.player.x = view.x;
      state.player.z = view.z;
      state.player.level = view.level || 0;
      state.player.y = floorYForLevel(state.player.level) + EYE_HEIGHT;
      state.player.yaw = view.yaw || 0;
      state.player.pitch = view.pitch || 0;
      state.player.bob = 0;
      state.host.x = 28;
      state.host.z = -23;
      state.host.yaw = Math.PI * 0.2;
      state.host.mode = "stunned";
      state.host.stunTimer = 999;
      state.safeTimer = Math.max(state.safeTimer, 999);
      showAlert(`Local check: ${view.label}.`, "");
    };

    const runPhase = (name) => {
      startDirectorRun();
      if (inspectionViews[name]) {
        applyInspectionView(inspectionViews[name]);
      } else if (name === "stairsUp") {
        applyInspectionView({ ...inspectionViews.stairs, x: STAIR_BOTTOM.x, z: STAIR_BOTTOM.z, yaw: STAIR_BOTTOM.yaw, label: "stair transfer up" });
        transferStairs("up");
      } else if (name === "stairsDown") {
        applyInspectionView({ ...inspectionViews.upstairs, x: STAIR_TOP.x, z: STAIR_TOP.z, yaw: STAIR_TOP.yaw, label: "stair transfer down" });
        transferStairs("down");
      } else if (name === "detour") {
        setDirectorTaskProgress(2);
        state.detourComplete = false;
        state.player.x = 2.4;
        state.player.z = 4.7;
        state.player.yaw = Math.PI;
        triggerBlackoutDetour();
      } else if (name === "sponsor") {
        setDirectorTaskProgress(4);
        state.detourActive = false;
        state.detourComplete = true;
        state.player.x = 0;
        state.player.z = -13.5;
        state.player.yaw = Math.PI;
        triggerSponsorBreach();
      } else if (name === "host") {
        state.player.x = 0;
        state.player.z = 2.65;
        state.player.yaw = Math.PI;
        state.player.pitch = -0.1;
        state.host.x = 0;
        state.host.z = 6.85;
        state.host.yaw = 0;
        state.host.mode = "search";
        state.host.stunTimer = 999;
        state.safeTimer = Math.max(state.safeTimer, 999);
        showAlert("Local check: host model inspection.", "");
      } else if (name === "house") {
        state.player.x = -13.6;
        state.player.z = 18.3;
        state.player.yaw = -Math.PI / 2;
        state.player.pitch = -0.05;
        state.host.x = 28;
        state.host.z = -23;
        state.host.yaw = Math.PI * 0.2;
        state.host.mode = "stunned";
        state.host.stunTimer = 999;
        state.safeTimer = Math.max(state.safeTimer, 999);
        showAlert("Local check: furnished house layout.", "");
      } else if (name === "foyer") {
        state.player.x = 0;
        state.player.z = 30.4;
        state.player.yaw = 0;
        state.player.pitch = 0.12;
        state.host.x = 28;
        state.host.z = -23;
        state.host.mode = "stunned";
        state.host.stunTimer = 999;
        state.safeTimer = Math.max(state.safeTimer, 999);
        showAlert("Local check: foyer and upper gallery.", "");
      } else if (name === "dining") {
        state.player.x = 16.6;
        state.player.z = 15.7;
        state.player.yaw = Math.PI / 2;
        state.player.pitch = -0.04;
        state.host.x = -28;
        state.host.z = -23;
        state.host.mode = "stunned";
        state.host.stunTimer = 999;
        state.safeTimer = Math.max(state.safeTimer, 999);
        showAlert("Local check: dining room prop placement.", "");
      } else if (name === "final" || name === "final30" || name === "final15") {
        setDirectorTaskProgress(TASK_TOTAL);
        state.detourActive = false;
        state.detourComplete = true;
        state.player.x = 0;
        state.player.z = -27;
        state.player.yaw = Math.PI;
        state.host.x = 0;
        state.host.z = -12;
        state.host.mode = "chase";
        state.host.lostTimer = 0;
        unlockFinalExit();
        if (name === "final30") state.finalEscapeTimer = 31;
        if (name === "final15") state.finalEscapeTimer = 16;
        if (name !== "final") {
          state.safeTimer = Math.max(state.safeTimer, 4);
          state.host.stunTimer = Math.max(state.host.stunTimer, 3);
        }
      }
      renderObjectiveList();
      updateHUD();
      return window.MrFeastDirector.snapshot();
    };

    window.MrFeastDirector = {
      phase(name) {
        return runPhase(name);
      },
      snapshot() {
        return {
          running: state.running,
          gameOver: state.gameOver,
          tasksDone: state.tasksDone,
          detourActive: state.detourActive,
          sponsorScareTimer: Number(state.sponsorScareTimer.toFixed(2)),
          finalUnlocked: state.finalUnlocked,
          finalEscapeTimer: Number(state.finalEscapeTimer.toFixed(2)),
          hostMode: state.host.mode,
          playerX: Number(state.player.x.toFixed(2)),
          playerZ: Number(state.player.z.toFixed(2)),
          playerY: Number(state.player.y.toFixed(2)),
          playerLevel: state.player.level,
          playerYaw: Number(state.player.yaw.toFixed(3)),
          touchForward: Number(state.touchMove.forward.toFixed(2)),
          touchStrafe: Number(state.touchMove.strafe.toFixed(2)),
          nerve: Number(state.nerve.toFixed(1)),
          signal: Number(state.signal.toFixed(1)),
        };
      },
    };

    const requestedPhase = new URLSearchParams(window.location.search).get("debugPhase");
    if (requestedPhase) window.setTimeout(() => runPhase(requestedPhase), 100);
  }

  function startDirectorRun() {
    resetGame();
    hideOverlay();
    canvas.focus({ preventScroll: true });
    state.graceTimer = 0;
    state.alertTimer = 0;
    state.jumpscareTimer = 0;
    state.viewers = 1200;
  }

  function setDirectorTaskProgress(count) {
    state.tasks.forEach((task, index) => {
      task.done = index < count;
      const group = world.taskGroups.get(task.id);
      if (group) {
        if (group.userData.doneMarker) group.userData.doneMarker.visible = task.done;
        if (group.userData.ring) group.userData.ring.visible = !task.done;
        group.scale.setScalar(1);
        group.scale.y = task.done ? 0.82 : 1;
      }
      const light = world.taskLights.get(task.id);
      if (light) {
        light.color.setHex(task.done ? 0x6bff7d : 0xf0c336);
        light.intensity = task.done ? 2.2 : 1.5;
      }
    });
    state.tasksDone = clamp(count, 0, TASK_TOTAL);
    state.signal = clamp(10 + count * 8, 0, 100);
    state.nerve = clamp(100 - count * 4, 0, 100);
    if (world.detourGate) {
      world.detourGate.visible = false;
      world.detourGate.position.y = 0;
    }
    if (world.detourGateCollider) world.detourGateCollider.active = false;
    if (world.detourStation) world.detourStation.visible = false;
    if (world.detourLight) world.detourLight.intensity = 0;
    if (world.finalGate) world.finalGate.visible = true;
    if (world.finalGateCollider) world.finalGateCollider.active = true;
  }

  function startGame() {
    if (!state.ready) return;
    resetGame();
    startAudio();
    hideOverlay();
    canvas.focus({ preventScroll: true });
    const stage = document.querySelector(".mrfeast-stage");
    if (stage && stage.scrollIntoView) stage.scrollIntoView({ block: "start", behavior: "auto" });
    showAlert("Segment one: do not become bonus content.", "");
  }

  function resetGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.time = 0;
    state.lastTime = 0;
    state.viewers = 0;
    state.tasksDone = 0;
    state.contestants = 10;
    state.nerve = 100;
    state.stamina = 100;
    state.signal = 0;
    state.graceTimer = 8.5;
    state.safeTimer = 0;
    state.boostTimer = 0;
    state.cameraJamTimer = 0;
    state.blackoutTimer = 0;
    state.sponsorScareTimer = 0;
    state.announcementTimer = 36;
    state.alertTimer = 0;
    state.jumpscareTimer = 0;
    state.interactionProgress = 0;
    state.stairProgress = 0;
    state.activeTask = null;
    state.stairPromptActive = false;
    state.stairDirection = null;
    state.detourActive = false;
    state.detourComplete = false;
    state.detourPromptActive = false;
    state.sponsorScareDone = false;
    state.finalPromptActive = false;
    state.finalUnlocked = false;
    state.finalEscapeTimer = 0;
    state.finalWarning30 = false;
    state.finalWarning15 = false;
    state.logs = [];
    state.player.x = 0;
    state.player.z = 29;
    state.player.level = 0;
    state.player.y = EYE_HEIGHT;
    state.player.yaw = 0;
    state.player.pitch = 0;
    state.player.bob = 0;
    state.host.x = 0;
    state.host.z = 8;
    state.host.yaw = Math.PI;
    state.host.mode = "patrol";
    state.host.patrolIndex = 2;
    state.host.alertTimer = 0;
    state.host.lostTimer = 0;
    state.host.stunTimer = 0;
    state.host.lastKnownX = 0;
    state.host.lastKnownZ = 29;
    state.host.justSawPlayer = false;
    state.host.stuckTimer = 0;
    state.tasks = TASK_DEFS.map((def) => ({ ...def, done: false }));
    Object.keys(state.input).forEach((key) => { state.input[key] = false; });
    state.mouseLook.dragging = false;
    state.mouseLook.pointerId = null;
    state.mouseLook.locked = document.pointerLockElement === canvas;
    state.mouseLook.softLocked = false;
    resetTouchMove();
    updateMouseLookClass();

    world.taskGroups.forEach((group, id) => {
      const task = state.tasks.find((item) => item.id === id);
      group.visible = true;
      group.traverse((child) => {
        if (child.material && child.material.opacity !== undefined && child.material.transparent) child.material.opacity = 1;
      });
      if (task && group.userData.ring) group.userData.ring.material = world.materials.yellow;
      if (group.userData.doneMarker) group.userData.doneMarker.visible = false;
      group.scale.setScalar(1);
    });
    world.taskLights.forEach((light) => {
      light.intensity = 1.5;
      light.color.setHex(0xf0c336);
    });
    world.contestantGroups.forEach((group) => { group.visible = true; });
    if (world.finalGate) world.finalGate.visible = true;
    if (world.finalGateCollider) world.finalGateCollider.active = true;
    if (world.finalExitGlow) world.finalExitGlow.intensity = 0;
    if (world.finalSirenLight) world.finalSirenLight.intensity = 0;
    if (world.detourGate) {
      world.detourGate.visible = false;
      world.detourGate.position.y = 0;
    }
    if (world.detourGateCollider) world.detourGateCollider.active = false;
    if (world.detourStation) world.detourStation.visible = false;
    if (world.detourLight) {
      world.detourLight.color.setHex(0xff4d4d);
      world.detourLight.intensity = 0;
    }
    if (world.sponsorGhost) world.sponsorGhost.visible = false;
    if (world.sponsorGhostLight) world.sponsorGhostLight.intensity = 0;
    if (world.materials.ghost) world.materials.ghost.opacity = 0.38;
    if (el.pause) el.pause.textContent = "Pause";
    pushLog("The mansion resets. The cameras pretend they are innocent.");
    updateHUD();
    renderObjectiveList();
  }

  function setPaused(value) {
    if (!state.running || state.gameOver) return;
    state.paused = value;
    if (el.pause) el.pause.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) {
      showAlert("Paused. The mansion waits politely, which is worse.", "");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      releaseSoftMouseLock();
      resetTouchMove();
    } else {
      showAlert("Rolling again.", "");
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    world.clock += dt;

    if (state.running && !state.paused && !state.gameOver) {
      state.time += dt;
      updateGame(dt);
    }
    renderWorld(dt);
  }

  function updateGame(dt) {
    if (state.alertTimer > 0) state.alertTimer = Math.max(0, state.alertTimer - dt);
    if (state.jumpscareTimer > 0) state.jumpscareTimer = Math.max(0, state.jumpscareTimer - dt);
    if (state.graceTimer > 0) state.graceTimer = Math.max(0, state.graceTimer - dt);
    if (state.safeTimer > 0) state.safeTimer = Math.max(0, state.safeTimer - dt);
    if (state.boostTimer > 0) state.boostTimer = Math.max(0, state.boostTimer - dt);
    if (state.cameraJamTimer > 0) state.cameraJamTimer = Math.max(0, state.cameraJamTimer - dt);
    updateStoryTimers(dt);

    updatePlayer(dt);
    updateStairTravel(dt);
    updateTasks(dt);
    updateHazards(dt);
    updateHost(dt);
    updateContestants(dt);
    updatePressure(dt);
    updateFinalEscape(dt);
    updateHUD();
  }

  function updatePlayer(dt) {
    const turnSpeed = state.input.sprint ? 1.5 : 1.85;
    if (state.input.turnLeft) state.player.yaw += turnSpeed * dt;
    if (state.input.turnRight) state.player.yaw -= turnSpeed * dt;

    const keyForward = (state.input.forward ? 1 : 0) - (state.input.back ? 1 : 0);
    const keyStrafe = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    const forward = clamp(keyForward + state.touchMove.forward, -1, 1);
    const strafe = clamp(keyStrafe + state.touchMove.strafe, -1, 1);
    const moving = Math.abs(forward) + Math.abs(strafe) > 0;
    state.player.moving = moving;

    let speed = 4.35;
    const canSprint = state.input.sprint && state.stamina > 2 && moving;
    state.player.sprinting = canSprint;
    if (canSprint) {
      speed = state.boostTimer > 0 ? 8.5 : 6.75;
      state.stamina = clamp(state.stamina - dt * (state.boostTimer > 0 ? 6 : 18), 0, 100);
      state.signal = clamp(state.signal + dt * 3.4, 0, 100);
    } else {
      state.stamina = clamp(state.stamina + dt * 12, 0, 100);
    }

    if (moving) {
      const len = Math.max(1, Math.hypot(forward, strafe));
      const f = forward / len;
      const s = strafe / len;
      const sin = Math.sin(state.player.yaw);
      const cos = Math.cos(state.player.yaw);
      const dx = (sin * f + cos * s) * speed * dt;
      const dz = (-cos * f + sin * s) * speed * dt;
      moveEntity(state.player, dx, dz, PLAYER_RADIUS);
      state.player.bob += dt * (canSprint ? 13 : 8);
      state.viewers += dt * (canSprint ? 5 : 2);
    } else {
      state.player.bob = lerp(state.player.bob, 0, Math.min(1, dt * 4));
    }

    state.player.x = clamp(state.player.x, -35.5, 35.5);
    state.player.z = clamp(state.player.z, -40.5, 34.5);
  }

  function updateTasks(dt) {
    if (state.stairPromptActive) {
      state.activeTask = null;
      state.interactionProgress = 0;
      updatePrompt();
      return;
    }

    if (state.player.level !== 0) {
      state.activeTask = null;
      state.finalPromptActive = false;
      state.interactionProgress = 0;
      updatePrompt();
      return;
    }

    if (updateDetour(dt)) {
      updatePrompt();
      return;
    }

    let nearest = null;
    let nearestD = Infinity;
    state.tasks.forEach((task) => {
      if (task.done) return;
      const d = distance(state.player.x, state.player.z, task.x, task.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = task;
      }
    });

    const finalD = distance(state.player.x, state.player.z, 0, -38.1);
    state.finalPromptActive = state.finalUnlocked && finalD < 3.1;

    if (nearest && nearestD < 2.7) {
      state.activeTask = nearest;
      if (state.input.interact) {
        state.interactionProgress += dt;
        state.signal = clamp(state.signal + dt * 4.5, 0, 100);
        if (state.interactionProgress >= nearest.seconds) completeTask(nearest);
      } else {
        state.interactionProgress = Math.max(0, state.interactionProgress - dt * 2.2);
      }
    } else if (state.finalPromptActive && state.input.interact) {
      state.activeTask = null;
      state.interactionProgress += dt;
      if (state.interactionProgress >= 2.2) winGame();
    } else {
      state.activeTask = null;
      state.interactionProgress = 0;
    }

    updatePrompt();
  }

  function updateStairTravel(dt) {
    const endpoint = state.player.level === 0 ? STAIR_BOTTOM : STAIR_TOP;
    const d = distance(state.player.x, state.player.z, endpoint.x, endpoint.z);
    state.stairPromptActive = d < 2.65;
    state.stairDirection = state.stairPromptActive ? (state.player.level === 0 ? "up" : "down") : null;

    if (!state.stairPromptActive) {
      state.stairProgress = 0;
      return;
    }

    if (state.input.interact) {
      state.stairProgress += dt;
      if (state.stairProgress >= STAIR_TRAVEL_SECONDS) {
        transferStairs(state.stairDirection);
      }
    } else {
      state.stairProgress = Math.max(0, state.stairProgress - dt * 2.4);
    }
  }

  function transferStairs(direction) {
    const destination = direction === "up" ? STAIR_TOP : STAIR_BOTTOM;
    state.player.level = destination.level;
    state.player.x = destination.x;
    state.player.z = destination.z;
    state.player.y = floorYForLevel(destination.level) + EYE_HEIGHT;
    state.player.yaw = destination.yaw;
    state.player.pitch = direction === "up" ? -0.04 : 0.02;
    state.player.bob = 0;
    state.stairProgress = 0;
    state.stairDirection = destination.level === 0 ? "up" : "down";
    state.safeTimer = Math.max(state.safeTimer, 1.2);
    showAlert(destination.level === 1 ? "Second floor reached. The balcony has cameras too." : "Back downstairs. The mansion resumes judging.", "");
  }

  function updateStoryTimers(dt) {
    if (state.blackoutTimer > 0) state.blackoutTimer = Math.max(0, state.blackoutTimer - dt);
    if (state.sponsorScareTimer > 0) {
      state.sponsorScareTimer = Math.max(0, state.sponsorScareTimer - dt);
      if (state.sponsorScareTimer <= 0 && world.sponsorGhost) {
        world.sponsorGhost.visible = false;
        if (world.sponsorGhostLight) world.sponsorGhostLight.intensity = 0;
      }
    }
  }

  function updateDetour(dt) {
    if (!state.detourActive || state.detourComplete) {
      state.detourPromptActive = false;
      return false;
    }

    const d = distance(state.player.x, state.player.z, DETOUR_PANEL.x, DETOUR_PANEL.z);
    state.activeTask = null;
    state.detourPromptActive = d < 2.9;
    if (state.detourPromptActive && state.input.interact) {
      state.interactionProgress += dt;
      state.signal = clamp(state.signal + dt * 5.5, 0, 100);
      if (state.interactionProgress >= DETOUR_PANEL.seconds) completeDetour();
    } else {
      state.interactionProgress = Math.max(0, state.interactionProgress - dt * 2);
    }
    return true;
  }

  function completeTask(task) {
    if (task.done) return;
    task.done = true;
    state.tasksDone += 1;
    state.viewers += task.score + Math.round(state.nerve * 12);
    state.signal = clamp(state.signal + 14, 0, 100);
    state.nerve = clamp(state.nerve - 2.5, 0, 100);
    state.interactionProgress = 0;
    state.host.mode = "search";
    state.host.alertTimer = Math.max(state.host.alertTimer, 6);
    state.host.lastKnownX = task.x;
    state.host.lastKnownZ = task.z;
    playStinger("task");
    pushLog(task.line);
    showAlert(task.line, "good");
    announcePhaseShift();

    const group = world.taskGroups.get(task.id);
    if (group) {
      group.userData.donePulse = 1.1;
      if (group.userData.doneMarker) group.userData.doneMarker.visible = true;
    }
    const light = world.taskLights.get(task.id);
    if (light) {
      light.color.setHex(0x6bff7d);
      light.intensity = 2.2;
    }

    if (state.tasksDone >= TASK_TOTAL) unlockFinalExit();
    renderObjectiveList();
    updateHUD();
  }

  function unlockFinalExit() {
    if (state.finalUnlocked) return;
    state.finalUnlocked = true;
    state.finalEscapeTimer = FINAL_ESCAPE_SECONDS;
    if (world.finalGate) world.finalGate.visible = false;
    if (world.finalGateCollider) world.finalGateCollider.active = false;
    if (world.finalExitGlow) world.finalExitGlow.intensity = 4;
    state.host.mode = "chase";
    state.host.alertTimer = 999;
    state.host.lastKnownX = state.player.x;
    state.host.lastKnownZ = state.player.z;
    pushLog("The exit opened. The final segment did too.");
    showAlert("Final segment: reach the exit before Mr. Feast reaches you.", "bad");
    triggerJumpscare(0.75);
  }

  function announcePhaseShift() {
    if (state.tasksDone === 2) {
      triggerBlackoutDetour();
    } else if (state.tasksDone === 4) {
      triggerSponsorBreach();
    }
  }

  function triggerBlackoutDetour() {
    if (state.detourActive || state.detourComplete) return;
    state.detourActive = true;
    state.detourPromptActive = false;
    state.interactionProgress = 0;
    state.blackoutTimer = 12;
    state.safeTimer = Math.max(state.safeTimer, 4.5);
    state.cameraJamTimer = Math.max(state.cameraJamTimer, 3.5);
    state.graceTimer = Math.max(state.graceTimer, 2.5);
    state.host.mode = "search";
    state.host.stunTimer = Math.max(state.host.stunTimer, 2.2);
    state.host.alertTimer = Math.max(state.host.alertTimer, 5.5);
    state.host.lastKnownX = DETOUR_PANEL.x;
    state.host.lastKnownZ = DETOUR_PANEL.z;
    state.host.lostTimer = 0;
    if (world.detourGate) world.detourGate.visible = true;
    if (world.detourGateCollider) world.detourGateCollider.active = true;
    if (world.detourStation) world.detourStation.visible = true;
    if (world.detourLight) world.detourLight.intensity = 2.8;
    const line = "Blackout clause triggered. The south hall locked itself for legal reasons.";
    pushLog(line);
    showAlert("Lockdown: override the release panel before the final tasks.", "bad");
    triggerJumpscare(0.55);
  }

  function completeDetour() {
    if (!state.detourActive || state.detourComplete) return;
    state.detourActive = false;
    state.detourComplete = true;
    state.detourPromptActive = false;
    state.interactionProgress = 0;
    state.blackoutTimer = Math.max(state.blackoutTimer, 2.5);
    state.signal = clamp(state.signal + 12, 0, 100);
    state.nerve = clamp(state.nerve - 4, 0, 100);
    if (world.detourGate) world.detourGate.visible = false;
    if (world.detourGateCollider) world.detourGateCollider.active = false;
    if (world.detourLight) {
      world.detourLight.color.setHex(0x6bff7d);
      world.detourLight.intensity = 2.2;
    }
    if (world.detourStation) {
      world.detourStation.visible = true;
      world.detourStation.scale.setScalar(0.92);
    }
    state.host.mode = "search";
    state.host.alertTimer = Math.max(state.host.alertTimer, 6);
    state.host.lastKnownX = DETOUR_PANEL.x;
    state.host.lastKnownZ = DETOUR_PANEL.z;
    playStinger("task");
    pushLog("Release accepted. The mansion apologized in 6-point font.");
    showAlert("South hall open. The apology was non-binding.", "good");
    renderObjectiveList();
  }

  function triggerSponsorBreach() {
    if (state.sponsorScareDone) return;
    state.sponsorScareDone = true;
    state.sponsorScareTimer = 5.2;
    state.blackoutTimer = Math.max(state.blackoutTimer, 4.8);
    state.signal = clamp(state.signal + 22, 0, 100);
    state.nerve = clamp(state.nerve - 7, 0, 100);

    const scareDistance = 8.2;
    const sideOffset = 1.8;
    const gx = clamp(state.player.x + Math.sin(state.player.yaw) * scareDistance + Math.cos(state.player.yaw) * sideOffset, -31, 31);
    const gz = clamp(state.player.z - Math.cos(state.player.yaw) * scareDistance + Math.sin(state.player.yaw) * sideOffset, -35, 32);
    if (world.sponsorGhost) {
      world.sponsorGhost.position.set(gx, 0, gz);
      world.sponsorGhost.rotation.y = angleTo(gx, gz, state.player.x, state.player.z);
      world.sponsorGhost.visible = true;
    }
    if (world.sponsorGhostLight) {
      world.sponsorGhostLight.position.set(gx, 2.2, gz);
      world.sponsorGhostLight.intensity = 4;
    }

    state.host.mode = "search";
    state.host.alertTimer = Math.max(state.host.alertTimer, 7);
    state.host.lastKnownX = state.player.x;
    state.host.lastKnownZ = state.player.z;
    const line = "Sponsor breach: the mascot found your unpaid attention.";
    pushLog(line);
    showAlert("Sponsor breach. Smile naturally or the algorithm gets weird.", "bad");
    triggerJumpscare(0.7);
  }

  function updateFinalEscape(dt) {
    if (!state.finalUnlocked || state.gameOver || state.won) return;
    state.finalEscapeTimer = Math.max(0, state.finalEscapeTimer - dt);
    state.signal = clamp(state.signal + dt * 1.6, 0, 100);
    if (state.finalEscapeTimer <= 30 && !state.finalWarning30) {
      state.finalWarning30 = true;
      pushLog("Thirty seconds until the final segment owns your face.");
      showAlert("Thirty seconds. Exit now.", "bad");
    }
    if (state.finalEscapeTimer <= 15 && !state.finalWarning15) {
      state.finalWarning15 = true;
      pushLog("Fifteen seconds. The mansion is already drafting the recap.");
      showAlert("Fifteen seconds. Sprint.", "bad");
      triggerJumpscare(0.35);
    }
    if (state.finalEscapeTimer <= 0) {
      endGame("THE FINAL SEGMENT AIRED", "You made great content, which is the worst possible outcome inside Deadline Mansion.");
    }
  }

  function updateHazards(dt) {
    let anySpot = false;
    state.hazards.forEach((hazard, index) => {
      const jammed = state.cameraJamTimer > 0;
      hazard.yaw = hazard.baseYaw + Math.sin(world.clock * hazard.speed + index * 0.7) * 0.78;
      hazard.group.rotation.y = hazard.yaw;
      hazard.light.intensity = jammed ? 0.08 : (hazard.spotted ? 1.7 : 0.85);
      hazard.beam.material = hazard.spotted ? world.materials.beamAlert : world.materials.beam;

      if (jammed) {
        hazard.spotted = false;
        return;
      }

      const dx = state.player.x - hazard.x;
      const dz = state.player.z - hazard.z;
      const d = Math.hypot(dx, dz);
      const a = wrapAngle(angleTo(hazard.x, hazard.z, state.player.x, state.player.z) - hazard.yaw);
      const visible = state.player.level === 0 && state.graceTimer <= 0 && d < hazard.range && Math.abs(a) < hazard.fov && !isLineBlocked(hazard.x, hazard.z, state.player.x, state.player.z, 0);
      hazard.spotted = visible;
      if (visible) {
        anySpot = true;
        state.signal = clamp(state.signal + dt * 22, 0, 100);
        state.viewers += dt * 9;
      }
    });

    if (!anySpot) state.signal = clamp(state.signal - dt * 7, 0, 100);
    if (state.signal >= 100) {
      state.signal = 42;
      state.host.mode = "chase";
      state.host.alertTimer = Math.max(state.host.alertTimer, 8);
      state.host.lastKnownX = state.player.x;
      state.host.lastKnownZ = state.player.z;
      showAlert("A camera found you. The host is monetizing your location.", "bad");
      triggerJumpscare(0.45);
    }
  }

  function updateHost(dt) {
    const host = state.host;
    const dPlayer = distance(host.x, host.z, state.player.x, state.player.z);
    if (host.stunTimer > 0) {
      host.stunTimer = Math.max(0, host.stunTimer - dt);
      host.mode = host.stunTimer > 0 ? "stunned" : "search";
      state.viewers += dt * 3;
      return;
    }

    const hostSees = canHostSeePlayer(dPlayer);
    if (hostSees) {
      host.mode = "chase";
      host.alertTimer = Math.max(host.alertTimer, 6.5);
      host.lostTimer = 0;
      host.lastKnownX = state.player.x;
      host.lastKnownZ = state.player.z;
      if (!host.justSawPlayer) {
        triggerJumpscare(0.5);
        showAlert(randomChoice(ALERT_LINES), "bad");
        playStinger("seen");
      }
      host.justSawPlayer = true;
    } else {
      host.justSawPlayer = false;
      if (host.mode === "chase") {
        host.lostTimer += dt;
        if (host.lostTimer > hostTuning().lostSeconds) {
          if (state.finalUnlocked) {
            host.lostTimer = 0;
            host.lastKnownX = state.player.x;
            host.lastKnownZ = state.player.z;
          } else {
            host.mode = "search";
          }
        }
      }
      if (host.mode === "search") {
        host.alertTimer -= dt;
        if (host.alertTimer <= 0 || distance(host.x, host.z, host.lastKnownX, host.lastKnownZ) < 1.2) {
          host.mode = "patrol";
          host.alertTimer = 0;
        }
      }
    }

    let target = chooseHostTarget();
    host.targetX = target.x;
    host.targetZ = target.z;
    const dx = target.x - host.x;
    const dz = target.z - host.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    const tuning = hostTuning();
    const speed = host.mode === "chase" ? tuning.chaseSpeed : host.mode === "search" ? tuning.searchSpeed : tuning.patrolSpeed;
    const mx = (dx / dist) * speed * dt;
    const mz = (dz / dist) * speed * dt;
    const beforeX = host.x;
    const beforeZ = host.z;
    moveEntity(host, mx, mz, HOST_RADIUS);
    const moved = distance(beforeX, beforeZ, host.x, host.z);
    host.stuckTimer = moved < 0.015 ? host.stuckTimer + dt : 0;
    if (host.stuckTimer > 1.4) {
      host.patrolIndex = (host.patrolIndex + 1) % HOST_PATROL.length;
      host.stuckTimer = 0;
    }

    if (dist > 0.1) host.yaw = lerpAngle(host.yaw, angleTo(host.x, host.z, target.x, target.z), Math.min(1, dt * 5));

    if (host.mode === "patrol" && dist < 1.2) {
      host.patrolIndex = (host.patrolIndex + 1) % HOST_PATROL.length;
    }

    const catchRadius = host.mode === "chase" ? 0.92 : 0.68;
    if (state.player.level === 0 && dPlayer < catchRadius && state.safeTimer <= 0) {
      endGame("YOU BECAME BONUS CONTENT", "Mr. Feast caught you before the final segment ended. The comments are calling it immersive.");
    } else if (state.player.level === 0 && dPlayer < 1.18 && state.safeTimer > 0) {
      host.stunTimer = 3.2;
      state.viewers += 650;
      showAlert("Insurance clause triggered. The host had to smile through it.", "good");
    }
  }

  function chooseHostTarget() {
    const host = state.host;
    if (host.mode === "chase") {
      if (state.player.level === 0 && !isLineBlocked(host.x, host.z, state.player.x, state.player.z, 0)) return { x: state.player.x, z: state.player.z };
      return nearestNavPointTo(state.player.x, state.player.z);
    }
    if (host.mode === "search") return { x: host.lastKnownX, z: host.lastKnownZ };
    return HOST_PATROL[host.patrolIndex] || HOST_PATROL[0];
  }

  function canHostSeePlayer(dPlayer) {
    const host = state.host;
    const tuning = hostTuning();
    if (state.player.level !== 0) return false;
    if (state.graceTimer > 0) return dPlayer < 2.6 && !isLineBlocked(host.x, host.z, state.player.x, state.player.z);
    if (dPlayer > (host.mode === "chase" ? tuning.chaseVision : tuning.patrolVision)) return false;
    if (isLineBlocked(host.x, host.z, state.player.x, state.player.z)) return false;
    const toward = angleTo(host.x, host.z, state.player.x, state.player.z);
    const fov = host.mode === "patrol" ? tuning.patrolFov : tuning.alertFov;
    if (Math.abs(wrapAngle(toward - host.yaw)) < fov) return true;
    return dPlayer < tuning.sprintHear && state.player.sprinting;
  }

  function hostTuning() {
    if (state.finalUnlocked) {
      return {
        patrolSpeed: 2.2,
        searchSpeed: 3.45,
        chaseSpeed: 4.65,
        patrolVision: 12,
        chaseVision: 15,
        patrolFov: 0.68,
        alertFov: 0.98,
        sprintHear: 3.8,
        lostSeconds: 4.1,
      };
    }

    if (state.tasksDone >= 4) {
      return {
        patrolSpeed: 2.05,
        searchSpeed: 3.05,
        chaseSpeed: 4.1,
        patrolVision: 10.8,
        chaseVision: 13.8,
        patrolFov: 0.62,
        alertFov: 0.9,
        sprintHear: 3.1,
        lostSeconds: 3.5,
      };
    }

    if (state.tasksDone >= 2) {
      return {
        patrolSpeed: 1.92,
        searchSpeed: 2.78,
        chaseSpeed: 3.8,
        patrolVision: 10.2,
        chaseVision: 13,
        patrolFov: 0.58,
        alertFov: 0.84,
        sprintHear: 2.8,
        lostSeconds: 3.2,
      };
    }

    return {
      patrolSpeed: 1.5,
      searchSpeed: 2.05,
      chaseSpeed: 3.05,
      patrolVision: 6.9,
      chaseVision: 9.2,
      patrolFov: 0.43,
      alertFov: 0.62,
      sprintHear: 1.9,
      lostSeconds: 2.3,
    };
  }

  function nearestNavPointTo(x, z) {
    let best = NAV_POINTS[0];
    let bestD = Infinity;
    NAV_POINTS.forEach((point) => {
      const d = dist2(x, z, point.x, point.z);
      if (d < bestD) {
        best = point;
        bestD = d;
      }
    });
    return best;
  }

  function updateContestants(dt) {
    state.announcementTimer -= dt;
    if (state.announcementTimer > 0 || state.contestants <= 2) return;
    state.announcementTimer = 42 + Math.random() * 22 - state.tasksDone * 2;
    state.contestants -= 1;
    const group = world.contestantGroups[state.contestants - 1];
    if (group) group.visible = false;
    const line = randomChoice(ANNOUNCEMENTS);
    pushLog(line);
    showAlert(line, "");
    state.viewers += 450 + state.tasksDone * 120;
  }

  function updatePressure(dt) {
    const dHost = distance(state.player.x, state.player.z, state.host.x, state.host.z);
    const threat = state.player.level === 0 ? clamp(1 - (dHost - 1.4) / 10, 0, 1) : 0;
    const chaseDrain = state.host.mode === "chase" ? 9.5 : state.host.mode === "search" ? 4.4 : 1.6;
    const signalDrain = state.signal > 65 ? 1.8 : 0;
    const safeScale = state.safeTimer > 0 ? 0.18 : state.graceTimer > 0 ? 0.2 : 1;
    state.nerve = clamp(state.nerve - dt * (threat * chaseDrain + signalDrain) * safeScale, 0, 100);
    state.nerve = clamp(state.nerve + dt * (threat < 0.08 && state.signal < 12 ? 1.5 : 0), 0, 100);
    state.viewers += dt * (3 + threat * 22 + state.tasksDone * 1.2);

    if (state.nerve <= 0) {
      endGame("NERVE BROKE ON CAMERA", "You froze under the mansion lights. A producer whispered, 'great thumbnail,' which did not help.");
    }
  }

  function moveEntity(entity, dx, dz, radius) {
    const level = entity.level || 0;
    const tryMove = (axis) => {
      const nx = axis === "x" ? entity.x + dx : entity.x;
      const nz = axis === "z" ? entity.z + dz : entity.z;
      if (!collides(nx, nz, radius, level)) {
        entity.x = nx;
        entity.z = nz;
      }
    };
    tryMove("x");
    tryMove("z");
  }

  function collides(x, z, radius, level = 0) {
    return world.collisions.some((rect) => {
      if (rect.active === false) return false;
      if (!colliderMatchesLevel(rect, level)) return false;
      return x + radius > rect.x1 && x - radius < rect.x2 && z + radius > rect.z1 && z - radius < rect.z2;
    });
  }

  function isLineBlocked(ax, az, bx, bz, level = 0) {
    return world.collisions.some((rect) => {
      if (rect.active === false || !rect.blocksSight) return false;
      if (!colliderMatchesLevel(rect, level)) return false;
      return segmentIntersectsRect(ax, az, bx, bz, rect, 0.08);
    });
  }

  function colliderMatchesLevel(rect, level) {
    if (Array.isArray(rect.level)) return rect.level.includes(level);
    return (rect.level || 0) === level;
  }

  function segmentIntersectsRect(x1, z1, x2, z2, rect, pad) {
    const minX = rect.x1 - pad;
    const maxX = rect.x2 + pad;
    const minZ = rect.z1 - pad;
    const maxZ = rect.z2 + pad;
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const checks = [
      [-dx, x1 - minX],
      [dx, maxX - x1],
      [-dz, z1 - minZ],
      [dz, maxZ - z1],
    ];
    for (const [p, q] of checks) {
      if (Math.abs(p) < 0.00001) {
        if (q < 0) return false;
      } else {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return true;
  }

  function lerpAngle(a, b, t) {
    return a + wrapAngle(b - a) * t;
  }

  function renderWorld(dt) {
    if (!world.renderer || !world.camera) return;
    const THREE = window.THREE;
    const player = state.player;
    const shake = state.jumpscareTimer > 0 && !state.reducedMotion ? state.jumpscareTimer : 0;
    const danger = player.level === 0 ? clamp(1 - distance(player.x, player.z, state.host.x, state.host.z) / 14, 0, 1) : 0;
    const bob = state.player.moving && !state.reducedMotion ? Math.sin(state.player.bob) * 0.045 : 0;
    const shakeX = shake ? Math.sin(world.clock * 58) * shake * 0.16 : 0;
    const shakeY = shake ? Math.cos(world.clock * 49) * shake * 0.1 : 0;
    const headY = player.y + bob + shakeY;
    const lookDistance = 8;
    const horizontalLook = Math.cos(player.pitch) * lookDistance;

    world.camera.position.set(player.x + shakeX, headY, player.z);
    const lookX = player.x + Math.sin(player.yaw) * horizontalLook;
    const lookY = headY + Math.sin(player.pitch) * lookDistance;
    const lookZ = player.z - Math.cos(player.yaw) * horizontalLook;
    world.camera.lookAt(lookX, lookY, lookZ);
    world.camera.fov = lerp(world.camera.fov, state.player.sprinting ? 73 : 68, Math.min(1, dt * 5));
    world.camera.updateProjectionMatrix();

    updateSceneAnimation(danger);
    world.renderer.render(world.scene, world.camera);
  }

  function updateSceneAnimation(danger) {
    const THREE = window.THREE;
    const t = world.clock;
    const blackout = clamp(state.blackoutTimer / 12, 0, 1);
    world.taskGroups.forEach((group, id) => {
      const task = state.tasks.find((item) => item.id === id);
      const ring = group.userData.ring;
      if (ring) {
        const pulse = 1 + Math.sin(t * 4 + group.position.x) * 0.06;
        ring.scale.setScalar(task && task.done ? 0.72 : pulse);
        ring.visible = !task || !task.done;
      }
      if (task && task.done) {
        group.scale.y = lerp(group.scale.y, 0.82, 0.04);
        if (group.userData.doneMarker) {
          group.userData.doneMarker.rotation.y += 0.018;
          const pulse = 1 + Math.sin(t * 5 + group.position.x) * 0.08;
          group.userData.doneMarker.scale.setScalar(pulse);
        }
      } else {
        group.rotation.y += 0.0025;
      }
      if (group.userData.donePulse) {
        group.userData.donePulse = Math.max(0, group.userData.donePulse - 0.025);
      }
    });
    updateGuideBeacon(t);

    if (world.hostGroup) {
      world.hostGroup.position.set(state.host.x, 0, state.host.z);
      world.hostGroup.rotation.y = state.host.yaw;
      world.hostGroup.position.y = Math.sin(t * (state.host.mode === "chase" ? 7 : 2.4)) * 0.045;
      if (world.hostGroup.userData.head) world.hostGroup.userData.head.rotation.z = Math.sin(t * 2.2) * 0.045 + danger * 0.08;
      if (world.hostGroup.userData.cameraRig) world.hostGroup.userData.cameraRig.rotation.y = -0.15 + Math.sin(t * 6) * 0.04;
      if (world.hostGroup.userData.halo) {
        world.hostGroup.userData.halo.rotation.z += state.host.mode === "chase" ? 0.045 : 0.012;
        world.hostGroup.userData.halo.scale.setScalar(1 + danger * 0.16 + Math.sin(t * 9) * 0.025);
      }
      if (world.hostLight) world.hostLight.intensity = state.host.mode === "chase" ? 3.5 + Math.sin(t * 16) * 0.5 : 1.7;
      if (world.hostFaceLight) world.hostFaceLight.intensity = state.host.mode === "chase" ? 2.5 + danger * 2.5 : 0.3;
    }

    if (world.ambient) {
      world.ambient.intensity = 0.56 + Math.sin(t * 0.7) * 0.04 - danger * 0.12 - blackout * 0.3;
    }

    if (world.scene && world.scene.fog) {
      world.scene.fog.density = 0.028 + blackout * 0.018 + (state.finalUnlocked ? 0.006 : 0);
    }

    if (world.finalExitGlow) {
      world.finalExitGlow.intensity = state.finalUnlocked ? 3.2 + Math.sin(t * 5) * 0.65 : 0;
    }

    if (world.finalSirenLight) {
      world.finalSirenLight.intensity = state.finalUnlocked ? 3.4 + Math.sin(t * 12) * 1.2 : 0;
    }

    if (world.detourGate && world.detourGate.visible) {
      world.detourGate.position.y = Math.sin(t * 18) * 0.025;
    }

    if (world.detourStation) {
      if (state.detourActive) {
        world.detourStation.visible = true;
        world.detourStation.scale.setScalar(1 + Math.sin(t * 7) * 0.035);
      } else if (state.detourComplete) {
        world.detourStation.scale.setScalar(0.92);
      }
    }

    if (world.detourLight) {
      if (state.detourActive) {
        world.detourLight.color.setHex(0xff4d4d);
        world.detourLight.intensity = 2.6 + Math.sin(t * 9) * 0.65;
      } else if (state.detourComplete) {
        world.detourLight.color.setHex(0x6bff7d);
        world.detourLight.intensity = 1.2 + Math.sin(t * 3) * 0.18;
      }
    }

    if (world.sponsorGhost) {
      const active = state.sponsorScareTimer > 0;
      world.sponsorGhost.visible = active;
      if (active) {
        world.sponsorGhost.rotation.y = angleTo(world.sponsorGhost.position.x, world.sponsorGhost.position.z, state.player.x, state.player.z);
        world.sponsorGhost.position.y = Math.sin(t * 10) * 0.08;
        world.sponsorGhost.scale.setScalar(0.78 + Math.sin(t * 13) * 0.05);
        world.materials.ghost.opacity = 0.2 + clamp(state.sponsorScareTimer / 5.2, 0, 1) * 0.28;
        if (world.sponsorGhostLight) world.sponsorGhostLight.intensity = 1.2 + state.sponsorScareTimer * 0.6 + Math.sin(t * 16) * 0.6;
      }
    }

    const red = state.host.mode === "chase" || danger > 0.45 || state.nerve < 35 || blackout > 0.3;
    if (red) {
      world.renderer.setClearColor(new THREE.Color(0.07 + danger * 0.08, 0.02, 0.015), 1);
    } else {
      world.renderer.setClearColor(0x050505, 1);
    }

    if (el.jumpscare) el.jumpscare.style.opacity = state.jumpscareTimer > 0 ? String(clamp(state.jumpscareTimer * 0.95, 0, 0.85)) : "0";
    if (el.vignette) {
      const nerveDark = clamp((48 - state.nerve) / 48, 0, 1);
      el.vignette.style.opacity = String(0.68 + nerveDark * 0.25 + danger * 0.14);
    }
  }

  function updateGuideBeacon(t) {
    if (!world.guideBeacon) return;
    const target = currentRouteTarget();
    world.guideBeacon.visible = state.running && !state.gameOver && Boolean(target);
    if (!target) return;

    world.guideBeacon.position.set(target.x, floorYForLevel(target.level || 0) + 0.12 + Math.sin(t * 3.2) * 0.08, target.z);
    world.guideBeacon.rotation.y = t * 1.6;
    const urgent = target.final || state.host.mode === "chase";
    if (world.guideBeaconLight) {
      world.guideBeaconLight.intensity = urgent ? 2.7 + Math.sin(t * 8) * 0.4 : 1.35 + Math.sin(t * 4) * 0.2;
      world.guideBeaconLight.color.setHex(target.final ? 0x6bff7d : urgent ? 0xff4d4d : 0xf0c336);
    }
  }

  function updatePrompt() {
    if (!el.prompt || !el.promptText) return;
    let text = "";
    if (state.detourPromptActive) {
      const pct = Math.round((state.interactionProgress / DETOUR_PANEL.seconds) * 100);
      text = state.input.interact
        ? `Overriding lockdown ${clamp(pct, 0, 100)}%`
        : "Hold F: override lockdown";
    } else if (state.activeTask) {
      const pct = Math.round((state.interactionProgress / state.activeTask.seconds) * 100);
      text = state.input.interact
        ? `${state.activeTask.title} ${clamp(pct, 0, 100)}%`
        : `Hold F: ${state.activeTask.title}`;
    } else if (state.stairPromptActive) {
      const pct = Math.round((state.stairProgress / STAIR_TRAVEL_SECONDS) * 100);
      const label = state.stairDirection === "up" ? "go upstairs" : "go downstairs";
      text = state.input.interact ? `Taking stairs ${clamp(pct, 0, 100)}%` : `Hold F: ${label}`;
    } else if (state.finalPromptActive) {
      const pct = Math.round((state.interactionProgress / 2.2) * 100);
      text = state.input.interact ? `Opening exit ${clamp(pct, 0, 100)}%` : "Hold F: leave the mansion";
    }
    el.promptText.textContent = text;
    el.prompt.classList.toggle("feast-prompt--show", Boolean(text));
  }

  function updateHUD() {
    canvas.dataset.playerX = state.player.x.toFixed(2);
    canvas.dataset.playerZ = state.player.z.toFixed(2);
    canvas.dataset.playerLevel = String(state.player.level || 0);
    canvas.dataset.playerYaw = state.player.yaw.toFixed(3);
    if (el.hudTasks) el.hudTasks.textContent = `${state.tasksDone}/${TASK_TOTAL}`;
    if (el.hudViewers) el.hudViewers.textContent = formatScore(state.viewers);
    if (el.hudNerve) el.hudNerve.textContent = percent(state.nerve);
    if (el.hudContestants) el.hudContestants.textContent = String(state.contestants);
    if (el.hudHigh) el.hudHigh.textContent = formatScore(api.getHighScore(GAME_ID));

    setMeter(el.meterNerve, el.meterNerveText, state.nerve, state.nerve > 42 ? "#f0c336" : "#ff4d4d");
    setMeter(el.meterStamina, el.meterStaminaText, state.stamina, state.stamina > 28 ? "#6bff7d" : "#ff4d4d");
    setMeter(el.meterSignal, el.meterSignalText, state.signal, state.signal < 65 ? "#5fc8d6" : "#ff4d4d");
    updateRouteGuide();
    updateDangerHud();

    if (el.objective) {
      if (state.detourActive && !state.detourComplete) {
        el.objective.textContent = "Lockdown: override the release panel";
      } else if (state.finalUnlocked) {
        el.objective.textContent = `Exit through the south gate · ${Math.ceil(state.finalEscapeTimer)}s`;
      } else if (state.player.level === 1) {
        el.objective.textContent = "Second floor: inspect the balcony or return downstairs";
      } else {
        const remaining = state.tasks.filter((task) => !task.done);
        const nearest = nearestTask();
        el.objective.textContent = nearest
          ? `${remaining.length} systems left: ${nearest.title}`
          : `${remaining.length} show systems left`;
      }
    }

    if (el.alert) el.alert.classList.toggle("feast-alert--show", state.alertTimer > 0);
  }

  function setMeter(fill, text, value, color) {
    if (fill) {
      fill.style.width = clamp(value, 0, 100).toFixed(1) + "%";
      fill.style.backgroundColor = color;
    }
    if (text) text.textContent = Math.round(clamp(value, 0, 100));
  }

  function updateRouteGuide() {
    if (!el.route || !el.routeArrow || !el.routeText) return;
    const target = currentRouteTarget();
    if (!target) {
      el.route.style.display = "none";
      return;
    }
    el.route.style.display = "inline-flex";
    const targetAngle = angleTo(state.player.x, state.player.z, target.x, target.z);
    const relative = wrapAngle(targetAngle - state.player.yaw);
    const dist = Math.round(distance(state.player.x, state.player.z, target.x, target.z));
    el.routeArrow.style.transform = `rotate(${relative}rad)`;
    el.routeText.textContent = `${target.label} · ${dist}m`;
    el.route.classList.toggle("feast-route--final", Boolean(target.final));
    el.route.classList.toggle("feast-route--detour", Boolean(target.detour));
  }

  function updateDangerHud() {
    if (!el.danger) return;
    const dHost = distance(state.player.x, state.player.z, state.host.x, state.host.z);
    let label = "Signal quiet";
    let kind = "";
    if (state.finalUnlocked) {
      label = `Final ${Math.ceil(state.finalEscapeTimer)}s`;
      kind = "final";
    } else if (state.player.level === 1) {
      label = "Second floor";
      kind = "search";
    } else if (state.detourActive && !state.detourComplete) {
      label = "Lockdown";
      kind = "search";
    } else if (state.host.mode === "chase") {
      label = dHost < 5 ? "Run" : "Spotted";
      kind = "chase";
    } else if (state.host.mode === "search") {
      label = "He is searching";
      kind = "search";
    } else if (state.signal > 70) {
      label = "Camera hot";
      kind = "camera";
    } else if (dHost < 7) {
      label = "Too close";
      kind = "search";
    }
    el.danger.textContent = label;
    el.danger.className = "feast-danger" + (kind ? ` feast-danger--${kind}` : "");
  }

  function nearestTask() {
    let best = null;
    let bestD = Infinity;
    state.tasks.forEach((task) => {
      if (task.done) return;
      const d = dist2(state.player.x, state.player.z, task.x, task.z);
      if (d < bestD) {
        best = task;
        bestD = d;
      }
    });
    return best;
  }

  function currentRouteTarget() {
    if (state.player.level === 1) {
      return { x: STAIR_TOP.x, z: STAIR_TOP.z, label: "Stairs down", final: false, level: 1 };
    }
    if (state.detourActive && !state.detourComplete) {
      return { x: DETOUR_PANEL.x, z: DETOUR_PANEL.z, label: DETOUR_PANEL.label, final: false, detour: true, level: 0 };
    }
    if (state.finalUnlocked) return { x: 0, z: -38.1, label: "Exit", final: true, level: 0 };
    const task = nearestTask();
    return task ? { x: task.x, z: task.z, label: task.room, final: false, level: 0 } : null;
  }

  function renderObjectiveList() {
    if (!el.objectiveList) return;
    const current = state.detourActive || state.finalUnlocked ? null : nearestTask();
    const storyItems = [];
    if (state.detourActive && !state.detourComplete) {
      storyItems.push(`
        <div class="feast-objectives__item feast-objectives__item--story feast-objectives__item--current">
          <span>LOCK</span>
          <span>Override backstage release</span>
        </div>
      `);
    } else if (state.finalUnlocked) {
      storyItems.push(`
        <div class="feast-objectives__item feast-objectives__item--story feast-objectives__item--current">
          <span>RUN</span>
          <span>Reach the south gate</span>
        </div>
      `);
    }
    el.objectiveList.innerHTML = storyItems.join("") + state.tasks.map((task) => `
      <div class="feast-objectives__item${task.done ? " feast-objectives__item--done" : ""}${current && current.id === task.id ? " feast-objectives__item--current" : ""}">
        <span>${task.done ? "DONE" : "LIVE"}</span>
        <span>${task.title}</span>
      </div>
    `).join("");
  }

  function pushLog(message) {
    state.logs.unshift(message);
    state.logs = state.logs.slice(0, 6);
    if (!el.log) return;
    el.log.innerHTML = state.logs.map((line, index) => {
      const prefix = index === 0 ? "<strong>Now</strong> " : "";
      return `<div class="feast-log__line">${prefix}${escapeHtml(line)}</div>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showAlert(message, kind) {
    if (el.alertText) el.alertText.textContent = message;
    state.alertTimer = 4.2;
    if (kind === "bad") playStinger("bad");
  }

  function triggerJumpscare(amount) {
    if (state.reducedMotion) {
      state.jumpscareTimer = Math.max(state.jumpscareTimer, amount * 0.35);
      return;
    }
    state.jumpscareTimer = Math.max(state.jumpscareTimer, amount);
  }

  function startAudio() {
    if (world.audio || state.reducedMotion) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.025;
      master.connect(ctx.destination);

      const hum = ctx.createOscillator();
      hum.type = "sawtooth";
      hum.frequency.value = 46;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.12;
      hum.connect(humGain);
      humGain.connect(master);
      hum.start();

      const tremolo = ctx.createOscillator();
      tremolo.type = "sine";
      tremolo.frequency.value = 0.8;
      const tremoloGain = ctx.createGain();
      tremoloGain.gain.value = 0.03;
      tremolo.connect(tremoloGain);
      tremoloGain.connect(humGain.gain);
      tremolo.start();

      world.audio = { ctx, master };
    } catch (error) {
      world.audio = null;
    }
  }

  function playStinger(kind) {
    if (!world.audio || state.reducedMotion) return;
    const { ctx, master } = world.audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === "task" ? "triangle" : "square";
    const now = ctx.currentTime;
    const start = kind === "task" ? 220 : kind === "seen" ? 95 : 70;
    const end = kind === "task" ? 440 : 38;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "task" ? 0.08 : 0.12, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  function renderPowerups(rbState) {
    if (!el.powerups) return;
    const counts = (rbState && rbState.powerups) || {};
    el.powerups.innerHTML = POWERUPS.map((item) => {
      const count = counts[item.key] || 0;
      return `
        <button class="powerup ${count > 0 ? "" : "powerup--locked"}" data-powerup="${item.key}" type="button">
          <span class="powerup__icon">${count > 0 ? count : "+"}</span>
          <span class="powerup__label">${item.label}</span>
          <span class="powerup__cost">${count > 0 ? "USE" : item.cost}</span>
        </button>
      `;
    }).join("");
    el.powerups.querySelectorAll("[data-powerup]").forEach((button) => {
      button.addEventListener("click", async () => {
        const key = button.dataset.powerup;
        const item = POWERUPS.find((entry) => entry.key === key);
        if (!item) return;
        if ((api.state.powerups[key] || 0) > 0) {
          if (api.consumePowerup(key)) item.apply();
          return;
        }
        button.disabled = true;
        const watched = await api.showRewarded();
        button.disabled = false;
        if (watched) {
          api.grantPowerup(key);
          api.toast(`+1 ${item.label} claimed`, "good");
        } else {
          api.toast("Ad not completed", "bad");
        }
      });
    });
  }

  function winGame() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    state.won = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    releaseSoftMouseLock();
    const finalScore = Math.round(state.viewers + state.nerve * 80 + state.contestants * 250 + state.tasksDone * 1000);
    state.viewers = finalScore;
    const high = api.recordScore(GAME_ID, finalScore);
    playStinger("task");
    updateHUD();
    showOverlay(
      high ? "NEW FINAL CUT RECORD" : "YOU ESCAPED DEADLINE MANSION",
      `You cut every show system and walked out before the final segment. The mansion kept your deposit because it has no soul.`,
      "Run it back",
      `Score: <strong>${formatScore(finalScore)}</strong> · Nerve: <strong>${percent(state.nerve)}</strong> · ${high ? "<strong>New high score</strong>" : "High: <strong>" + formatScore(api.getHighScore(GAME_ID)) + "</strong>"}`
    );
  }

  function endGame(title, sub) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    releaseSoftMouseLock();
    const finalScore = Math.round(state.viewers + state.tasksDone * 700 + state.nerve * 25);
    state.viewers = finalScore;
    const high = api.recordScore(GAME_ID, finalScore);
    triggerJumpscare(0.9);
    playStinger("bad");
    updateHUD();
    showOverlay(
      title,
      sub,
      "Try again",
      `Score: <strong>${formatScore(finalScore)}</strong> · Systems cut: <strong>${state.tasksDone}/${TASK_TOTAL}</strong> · ${high ? "<strong>New high score</strong>" : "High: <strong>" + formatScore(api.getHighScore(GAME_ID)) + "</strong>"}`
    );
  }

  function showOverlay(title, sub, button, extra = "") {
    if (!el.overlay) return;
    if (el.overlayTitle) el.overlayTitle.textContent = title;
    if (el.overlaySub) el.overlaySub.innerHTML = sub;
    if (el.overlayScore) {
      el.overlayScore.style.display = extra ? "block" : "none";
      el.overlayScore.innerHTML = extra;
    }
    if (el.primary) el.primary.textContent = button;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    if (el.overlay) el.overlay.classList.remove("overlay--show");
  }

  function resize() {
    if (!world.renderer || !world.camera) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || canvas.width || 960));
    const height = Math.max(180, Math.floor(rect.height || canvas.height || 540));
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  }

  loadThree();
})();
