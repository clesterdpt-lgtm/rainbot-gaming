/* ============================================================
   DoorCrash: No Tip Nitro
   3D food-delivery lane runner for Rainbot Gaming.
   Plain Three.js, no build step.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "doorcrash";
  const DELIVERIES_TO_WIN = 5;
  const LANES = [-3.25, 0, 3.25];
  const PLAYER_Z = 0;
  const OBSTACLE_START_Z = -118;
  const OBSTACLE_END_Z = 18;
  const ROUTES = [
    {
      title: "Apartment 9B",
      text: "Customer says “leave at door” but is already outside.",
      length: 1650,
    },
    {
      title: "The Leasing Office Maze",
      text: "There are six buildings named The Oaks. None contain oak trees.",
      length: 1980,
    },
    {
      title: "Penthouse? Basement? Same PIN",
      text: "The elevator is broken and the fries have entered their villain era.",
      length: 2320,
    },
    {
      title: "Campus Quad Detour",
      text: "Scooters, delivery bots, and exactly one useful ramp stand between you and dorm justice.",
      length: 2700,
      airDrop: true,
      airLane: 1,
      airHeight: 2.35,
    },
    {
      title: "Algorithmic Suburb Spiral",
      text: "Every cul-de-sac looks identical and the app insists this is efficient.",
      length: 3100,
      airDrop: true,
      airLane: 2,
      airHeight: 2.75,
    },
  ];

  const EVENTS = [
    { title: "Gate code expired", text: "Customer sent “try 1234 maybe.”", patience: -10, heat: -3 },
    { title: "Soup order detected", text: "The cupholder is praying.", bag: -7, heat: -4 },
    { title: "No parking zone", text: "A tow truck has spawned emotionally.", patience: -8, tip: -0.4 },
    { title: "Cash tip promised", text: "The prophecy is powerful, suspicious, and probably false.", tip: 0.85 },
    { title: "Apartment behind apartment", text: "Navigation says you arrived. Reality disagrees.", patience: -9 },
    { title: "Extra sauce request", text: "The bag gained mass and lost structural integrity.", bag: -5, tip: 0.45 },
    { title: "Wrong pin drop", text: "The marker moved three blocks. Very normal.", patience: -11, heat: -2 },
    { title: "Customer watching the map", text: "Every lane change has been perceived.", patience: -6, tip: -0.25 },
  ];

  const OBSTACLE_TYPES = {
    cone: { label: "Cone stack", bag: 5, heat: 1, tip: 0.35, score: 80 },
    pothole: { label: "Pothole", bag: 9, heat: 2, tip: 0.7, score: 120, jump: true },
    scooter: { label: "Sidewalk scooter", bag: 10, heat: 2, tip: 0.65, score: 150 },
    sedan: { label: "Parked sedan", bag: 12, heat: 3, tip: 0.85, score: 180 },
    soda: { label: "Spilled soda", bag: 4, heat: 1, tip: 0.3, score: 60 },
    bot: { label: "Delivery bot", bag: 8, heat: 1, tip: 0.55, score: 130, jump: true },
    barricade: { label: "Road barricade", bag: 16, heat: 4, tip: 1.1, score: 230, jump: true, jumpHeight: 1.08 },
    drone: { label: "Low-flying drone", bag: 13, heat: 2, tip: 0.9, score: 210, airborne: true, duckHeight: 0.52 },
  };

  const THREE_CDNS = [
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  ];
  const GLTF_LOADER_CDNS = [
    "https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
  ];
  const TEXTURE_ASSET_BASE = "../assets/img/doorcrash";
  const MODEL_ASSET_BASE = "../assets/models/doorcrash";

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
    sound: $("btn-sound"),
    fullscreen: $("btn-fullscreen"),
    left: $("btn-left"),
    right: $("btn-right"),
    jump: $("btn-jump"),
    boost: $("btn-boost"),
    routeTitle: $("route-title"),
    delivery: $("hud-delivery"),
    heat: $("hud-heat"),
    bag: $("hud-bag"),
    tip: $("hud-tip"),
    streak: $("hud-streak"),
    high: $("hud-high"),
    routeChip: $("route-chip"),
    eventChip: $("event-chip"),
    meterRoute: $("meter-route"),
    meterRouteText: $("meter-route-text"),
    meterNitro: $("meter-nitro"),
    meterNitroText: $("meter-nitro-text"),
    meterPatience: $("meter-patience"),
    meterPatienceText: $("meter-patience-text"),
    eventLog: $("event-log"),
  };

  const api = window.RB || {
    toast: () => {},
    recordScore: () => false,
    getHighScore: () => 0,
  };

  const state = {
    ready: false,
    running: false,
    paused: false,
    gameOver: false,
    delivery: 1,
    distance: 0,
    score: 0,
    speed: 0,
    targetLane: 1,
    lane: 1,
    carX: 0,
    carY: 0,
    carVY: 0,
    nitro: 100,
    boostHeld: false,
    boostActive: false,
    heat: 100,
    bag: 100,
    patience: 100,
    tip: 6,
    streak: 0,
    comboTimer: 0,
    spawnTimer: 0,
    eventTimer: 0,
    eventMessageTimer: 0,
    airRampSpawned: false,
    airRampTimer: 0,
    hitFlash: 0,
    cameraShake: 0,
    impactTimer: 0,
    impactDuration: 0.5,
    impactSide: 1,
    lastTime: 0,
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 3 });
  let saveMenu = null;

  const audio = {
    enabled: readSoundPreference(),
    ctx: null,
    master: null,
    engine: null,
    engineFilter: null,
    engineGain: null,
    noiseBuffer: null,
    lastBoost: false,
  };

  const world = {
    renderer: null,
    scene: null,
    camera: null,
    clock: 0,
    car: null,
    carWheels: [],
    roadLines: [],
    roadDetails: [],
    buildings: [],
    neonRails: [],
    streetProps: [],
    obstacles: [],
    effects: [],
    destination: null,
    materials: {},
    textures: {},
    models: {},
    assetLoader: null,
    resizeObserver: null,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(Math.random() * items.length)];
  const percent = (value) => Math.round(clamp(value, 0, 100)) + "%";
  const money = (value) => "$" + Math.max(0, value).toFixed(2);

  function readSoundPreference() {
    try {
      return localStorage.getItem(`${GAME_ID}:sound`) !== "off";
    } catch (error) {
      return true;
    }
  }

  function writeSoundPreference() {
    try {
      localStorage.setItem(`${GAME_ID}:sound`, audio.enabled ? "on" : "off");
    } catch (error) {}
  }

  function updateSoundButton() {
    if (!el.sound) return;
    el.sound.textContent = audio.enabled ? "Sound on" : "Sound off";
    el.sound.setAttribute("aria-pressed", audio.enabled ? "true" : "false");
  }

  function ensureAudio() {
    if (!audio.enabled) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;

    if (!audio.ctx) {
      audio.ctx = new AudioContext();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.32;
      audio.master.connect(audio.ctx.destination);

      audio.engine = audio.ctx.createOscillator();
      audio.engine.type = "sawtooth";
      audio.engine.frequency.value = 72;
      audio.engineFilter = audio.ctx.createBiquadFilter();
      audio.engineFilter.type = "lowpass";
      audio.engineFilter.frequency.value = 180;
      audio.engineGain = audio.ctx.createGain();
      audio.engineGain.gain.value = 0;
      audio.engine.connect(audio.engineFilter);
      audio.engineFilter.connect(audio.engineGain);
      audio.engineGain.connect(audio.master);
      audio.engine.start();
      audio.noiseBuffer = makeNoiseBuffer(audio.ctx);
    }

    if (audio.ctx.state === "suspended") {
      audio.ctx.resume().catch(() => {});
    }
    return true;
  }

  function makeNoiseBuffer(ctx) {
    const length = Math.floor(ctx.sampleRate * 0.45);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }

  function playTone(frequency, type, duration, gainValue, slideTo = frequency, delay = 0) {
    if (!ensureAudio()) return;
    const ctx = audio.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(now);
    osc.stop(now + duration + 0.04);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  function playNoiseBurst(duration, gainValue, filterFrequency, delay = 0) {
    if (!ensureAudio() || !audio.noiseBuffer) return;
    const ctx = audio.ctx;
    const now = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = audio.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.master);
    source.start(now);
    source.stop(now + duration + 0.05);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function playStartSound() {
    playTone(196, "triangle", 0.09, 0.045, 294);
    playTone(392, "triangle", 0.12, 0.045, 523, 0.07);
  }

  function playJumpSound() {
    playTone(340, "triangle", 0.16, 0.045, 620);
  }

  function playLaneSound() {
    playTone(220, "sine", 0.055, 0.024, 260);
  }

  function playBoostSound() {
    playNoiseBurst(0.24, 0.07, 1500);
    playTone(170, "sawtooth", 0.2, 0.04, 260);
  }

  function playPickupSound() {
    playTone(523, "triangle", 0.08, 0.05, 784);
    playTone(1046, "sine", 0.11, 0.035, 1318, 0.055);
  }

  function playRampSound() {
    playNoiseBurst(0.18, 0.06, 1850);
    playTone(260, "triangle", 0.12, 0.045, 520);
    playTone(680, "sine", 0.18, 0.035, 980, 0.08);
  }

  function playCrashSound(type) {
    const heavy = type === "sedan";
    playNoiseBurst(heavy ? 0.34 : 0.22, heavy ? 0.2 : 0.13, heavy ? 520 : 920);
    playTone(heavy ? 118 : 150, "sawtooth", heavy ? 0.28 : 0.18, heavy ? 0.1 : 0.07, heavy ? 44 : 70);
    if (heavy) {
      playTone(360, "square", 0.13, 0.045, 160, 0.03);
    }
  }

  function playDeliverySound() {
    playTone(330, "triangle", 0.09, 0.044, 440);
    playTone(494, "triangle", 0.11, 0.044, 660, 0.08);
    playTone(740, "sine", 0.16, 0.036, 988, 0.16);
  }

  function playGameOverSound() {
    playTone(196, "sawtooth", 0.18, 0.055, 128);
    playTone(128, "sawtooth", 0.24, 0.045, 72, 0.12);
  }

  function updateAudio() {
    if (!audio.ctx || !audio.engineGain) return;
    const now = audio.ctx.currentTime;
    const active = audio.enabled && state.running && !state.paused && !state.gameOver;
    const engineGain = active ? (state.boostActive ? 0.068 : 0.034) : 0.0001;
    const engineFrequency = clamp((state.boostActive ? 98 : 58) + state.speed * (state.boostActive ? 1.1 : 0.72), 42, 160);
    audio.engine.frequency.setTargetAtTime(engineFrequency, now, 0.045);
    audio.engineFilter.frequency.setTargetAtTime(state.boostActive ? 420 : 190, now, 0.08);
    audio.engineGain.gain.setTargetAtTime(engineGain, now, 0.08);

    if (active && state.boostActive && !audio.lastBoost) playBoostSound();
    audio.lastBoost = active && state.boostActive;
  }

  function loadThree(index = 0) {
    if (window.THREE) {
      loadGltfLoader(0, initThree);
      return;
    }
    if (index >= THREE_CDNS.length) {
      fatal("Three.js could not load. The delivery car is parked until the 3D runtime is reachable.");
      return;
    }
    const script = document.createElement("script");
    script.src = THREE_CDNS[index];
    script.onload = () => (window.THREE ? loadGltfLoader(0, initThree) : loadThree(index + 1));
    script.onerror = () => loadThree(index + 1);
    document.head.appendChild(script);
  }

  function loadGltfLoader(index, done) {
    if (window.THREE && window.THREE.GLTFLoader) {
      done();
      return;
    }
    if (index >= GLTF_LOADER_CDNS.length) {
      done();
      return;
    }
    const script = document.createElement("script");
    script.src = GLTF_LOADER_CDNS[index];
    script.onload = () => (window.THREE.GLTFLoader ? done() : loadGltfLoader(index + 1, done));
    script.onerror = () => loadGltfLoader(index + 1, done);
    document.head.appendChild(script);
  }

  function fatal(message) {
    showOverlay("3D ENGINE MISSED THE DELIVERY", message, "Retry");
    el.primary.onclick = () => location.reload();
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
    world.renderer.setClearColor(0x05070d, 1);
    world.renderer.outputEncoding = THREE.sRGBEncoding;
    world.renderer.shadowMap.enabled = true;
    world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    world.scene = new THREE.Scene();
    world.scene.fog = new THREE.FogExp2(0x081322, 0.017);

    world.camera = new THREE.PerspectiveCamera(62, 920 / 600, 0.1, 260);
    world.camera.position.set(0, 5.9, 12.2);
    world.camera.lookAt(0, 1.2, -18);

    buildMaterials();
    buildScene();
    bindInputs();
    resize();
    updateRouteChip();
    updateHUD();

    world.resizeObserver = new ResizeObserver(resize);
    world.resizeObserver.observe(canvas.parentElement || canvas);
    window.addEventListener("resize", resize);
    requestAnimationFrame(loop);
  }

  function buildMaterials() {
    const THREE = window.THREE;
    world.materials = {
      road: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.12 }),
      roadEdge: new THREE.MeshStandardMaterial({ color: 0x5f6a66, roughness: 0.78, metalness: 0.04 }),
      lane: new THREE.MeshBasicMaterial({ color: 0xf8f2b0 }),
      cyan: new THREE.MeshStandardMaterial({ color: 0x2ee0ff, emissive: 0x0b6a88, roughness: 0.35, metalness: 0.25 }),
      pink: new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0x64103a, roughness: 0.4, metalness: 0.2 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xffd43b, emissive: 0x6b4d00, roughness: 0.38, metalness: 0.16 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.08 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf8f7ef, roughness: 0.45 }),
      black: new THREE.MeshStandardMaterial({ color: 0x06070b, roughness: 0.9 }),
      asphaltDark: new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 0.95 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x92e9ff, emissive: 0x0b4560, roughness: 0.18, metalness: 0.25 }),
      bag: new THREE.MeshStandardMaterial({ color: 0xc98e4f, roughness: 0.75 }),
      sauce: new THREE.MeshStandardMaterial({ color: 0x7a2cff, emissive: 0x27094d, roughness: 0.28, metalness: 0.08 }),
      cash: new THREE.MeshStandardMaterial({ color: 0x6bff7d, emissive: 0x156a22, roughness: 0.4, metalness: 0.16 }),
      buildingA: new THREE.MeshStandardMaterial({ color: 0x11192a, roughness: 0.72, metalness: 0.2 }),
      buildingB: new THREE.MeshStandardMaterial({ color: 0x1c1430, roughness: 0.72, metalness: 0.2 }),
      storefront: new THREE.MeshStandardMaterial({ color: 0x123046, emissive: 0x071c2b, roughness: 0.3, metalness: 0.18 }),
      awningCyan: new THREE.MeshStandardMaterial({ color: 0x2ee0ff, emissive: 0x0b5c76, roughness: 0.45, metalness: 0.1 }),
      awningPink: new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0x5b1038, roughness: 0.45, metalness: 0.1 }),
      curbPaint: new THREE.MeshBasicMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.7 }),
      crosswalk: new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.68 }),
      lampPole: new THREE.MeshStandardMaterial({ color: 0x2a3342, roughness: 0.72, metalness: 0.38 }),
      lampGlow: new THREE.MeshBasicMaterial({ color: 0xffe6a6 }),
      lightPoolCyan: new THREE.MeshBasicMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.14, depthWrite: false }),
      lightPoolWarm: new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.16, depthWrite: false }),
      roadPatch: new THREE.MeshStandardMaterial({ color: 0x0c1119, roughness: 0.98, metalness: 0.02 }),
      trashGreen: new THREE.MeshStandardMaterial({ color: 0x284d3b, roughness: 0.74, metalness: 0.08 }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 1 }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x9aa7ba, transparent: true, opacity: 0.22, depthWrite: false }),
      impactRing: new THREE.MeshBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.58, depthWrite: false }),
      skid: new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.72, depthWrite: false }),
      windowCyan: new THREE.MeshBasicMaterial({ color: 0x2ee0ff }),
      windowPink: new THREE.MeshBasicMaterial({ color: 0xff2e88 }),
      windowWarm: new THREE.MeshBasicMaterial({ color: 0xffd43b }),
    };
    applySurfaceTextures();
  }

  function applySurfaceTextures() {
    const roadTexture = loadTexture(`${TEXTURE_ASSET_BASE}/kenney-road-lane.png`, 1, 54);
    const sidewalkTexture = loadTexture(`${TEXTURE_ASSET_BASE}/kenney-sidewalk.png`, 8, 54);
    world.textures.road = roadTexture;
    world.textures.sidewalk = sidewalkTexture;
    world.materials.road.map = roadTexture;
    world.materials.road.needsUpdate = true;
    world.materials.roadEdge.map = sidewalkTexture;
    world.materials.roadEdge.needsUpdate = true;
  }

  function loadTexture(path, repeatX, repeatY) {
    const THREE = window.THREE;
    const texture = new THREE.TextureLoader().load(path);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = world.renderer ? Math.min(8, world.renderer.capabilities.getMaxAnisotropy()) : 4;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeSkyTexture() {
    const THREE = window.THREE;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#101b38");
    gradient.addColorStop(0.46, "#081322");
    gradient.addColorStop(1, "#03060b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(46, 224, 255, 0.18)";
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height * 0.48;
      ctx.fillRect(x, y, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function buildScene() {
    const THREE = window.THREE;
    const scene = world.scene;
    scene.background = makeSkyTexture();

    scene.add(new THREE.HemisphereLight(0x9ccfff, 0x170b27, 1.8));

    const moon = new THREE.DirectionalLight(0xffffff, 1.45);
    moon.position.set(-5, 10, 6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    scene.add(moon);

    const carGlow = new THREE.PointLight(0xff2e88, 3.2, 30);
    carGlow.position.set(0, 3, 4);
    scene.add(carGlow);

    const road = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.24, 180), world.materials.road);
    road.position.set(0, -0.15, -58);
    road.receiveShadow = true;
    scene.add(road);

    const leftSidewalk = new THREE.Mesh(new THREE.BoxGeometry(8, 0.28, 180), world.materials.roadEdge);
    leftSidewalk.position.set(-10.4, -0.08, -58);
    leftSidewalk.receiveShadow = true;
    scene.add(leftSidewalk);

    const rightSidewalk = leftSidewalk.clone();
    rightSidewalk.position.x = 10.4;
    scene.add(rightSidewalk);

    const leftCurb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 180), world.materials.curbPaint);
    leftCurb.position.set(-6.36, 0.06, -58);
    scene.add(leftCurb);

    const rightCurb = leftCurb.clone();
    rightCurb.position.x = 6.36;
    scene.add(rightCurb);

    for (let i = 0; i < 34; i++) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 2.5), world.materials.lane);
      marker.position.set(-1.65, 0.035, -i * 5.8 + 8);
      scene.add(marker);
      world.roadLines.push(marker);

      const marker2 = marker.clone();
      marker2.position.x = 1.65;
      scene.add(marker2);
      world.roadLines.push(marker2);
    }

    for (let i = 0; i < 7; i++) {
      const detail = makeRoadDetail(i);
      detail.position.z = -i * 30 + 6;
      scene.add(detail);
      world.roadDetails.push(detail);
    }

    for (let i = 0; i < 18; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 7), i % 2 ? world.materials.pink : world.materials.cyan);
      rail.position.set(i % 2 ? -6.35 : 6.35, 0.18, -i * 9 + 9);
      scene.add(rail);
      world.neonRails.push(rail);
    }

    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? -1 : 1;
      const prop = makeStreetProp(side, -i * 11 + rand(-2.5, 3.5), i);
      scene.add(prop);
      world.streetProps.push(prop);
    }

    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? -1 : 1;
      const building = makeBuilding(side, -i * 8 + rand(-5, 4));
      scene.add(building);
      world.buildings.push(building);
    }

    world.destination = makeDestination();
    scene.add(world.destination);

    world.car = makePlayerCar();
    scene.add(world.car);
    loadModelAssets();
  }

  function makeRoadDetail(index) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData.kind = index % 3 === 1 ? "stop" : "crosswalk";

    if (group.userData.kind === "crosswalk") {
      for (let i = 0; i < 8; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.035, 0.42), world.materials.crosswalk);
        stripe.position.set(-4.8 + i * 1.37, 0.075, 0);
        group.add(stripe);
      }
      const stopBar = new THREE.Mesh(new THREE.BoxGeometry(10.3, 0.032, 0.16), world.materials.crosswalk);
      stopBar.position.set(0, 0.073, 1.05);
      group.add(stopBar);
    } else {
      [-3.25, 0, 3.25].forEach((x) => {
        const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.032, 0.18), world.materials.crosswalk);
        arrow.position.set(x, 0.074, 0);
        group.add(arrow);

        const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 3), world.materials.crosswalk);
        arrowHead.position.set(x, 0.076, -0.42);
        arrowHead.rotation.x = Math.PI / 2;
        arrowHead.rotation.z = Math.PI / 2;
        group.add(arrowHead);
      });
    }

    if (index % 2 === 0) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(rand(1.4, 2.4), 0.028, rand(1.5, 2.8)), world.materials.roadPatch);
      patch.position.set(rand(-4.6, 4.6), 0.064, rand(-7.5, -4.2));
      patch.rotation.y = rand(-0.08, 0.08);
      group.add(patch);
    }

    return group;
  }

  function makeStreetProp(side, z, index) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.position.set(rand(-0.25, 0.25), 0, z);
    group.userData.side = side;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.2, 10), world.materials.lampPole);
    pole.position.set(side * 7.05, 1.62, 0);
    pole.castShadow = true;
    group.add(pole);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.07, 0.07), world.materials.lampPole);
    arm.position.set(side * 6.56, 3.12, 0);
    group.add(arm);

    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), world.materials.lampGlow);
    lamp.position.set(side * 6.05, 3.08, 0);
    group.add(lamp);

    const poolMaterial = index % 2 ? world.materials.lightPoolWarm : world.materials.lightPoolCyan;
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.55, 0.018, 32), poolMaterial);
    pool.position.set(side * 4.3, 0.068, 0);
    pool.scale.z = 0.42;
    group.add(pool);

    if (index % 3 === 0) {
      const glow = new THREE.PointLight(index % 2 ? 0xffd43b : 0x2ee0ff, 1.35, 14);
      glow.position.set(side * 6.05, 2.9, 0);
      group.add(glow);
    }

    if (index % 4 !== 1) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), world.materials.lampPole);
      post.position.set(side * 7.48, 0.62, rand(-1.6, 1.6));
      group.add(post);

      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.055), pick([world.materials.cyan, world.materials.pink, world.materials.yellow]));
      sign.position.set(side * 7.48, 1.26, post.position.z);
      sign.rotation.y = side > 0 ? -0.18 : 0.18;
      group.add(sign);
    } else {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.46), world.materials.trashGreen);
      bin.position.set(side * 7.5, 0.38, rand(-1.2, 1.2));
      bin.castShadow = true;
      group.add(bin);

      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.52), world.materials.black);
      lid.position.set(bin.position.x, 0.77, bin.position.z);
      group.add(lid);
    }

    return group;
  }

  function makeBuilding(side, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const height = rand(5.5, 14);
    const width = rand(2.4, 4.2);
    const depth = rand(2.2, 4.4);
    const material = Math.random() > 0.5 ? world.materials.buildingA : world.materials.buildingB;
    const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    block.position.y = height / 2 - 0.08;
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);

    const windowMaterial = pick([world.materials.windowCyan, world.materials.windowPink, world.materials.windowWarm]);
    const rows = Math.max(3, Math.floor(height / 1.3));
    const facadeZ = depth / 2 + 0.022;
    const groundFloor = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.82, 0.04), world.materials.storefront);
    groundFloor.position.set(0, 0.55, facadeZ + 0.025);
    group.add(groundFloor);

    const door = new THREE.Mesh(new THREE.BoxGeometry(width * 0.18, 0.72, 0.05), world.materials.black);
    door.position.set(width * 0.22, 0.45, facadeZ + 0.052);
    group.add(door);

    const awningMaterial = Math.random() > 0.5 ? world.materials.awningCyan : world.materials.awningPink;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, 0.16, 0.36), awningMaterial);
    awning.position.set(0, 1.08, facadeZ + 0.16);
    awning.castShadow = true;
    group.add(awning);

    for (let r = 0; r < rows; r++) {
      if (Math.random() < 0.24) continue;
      const win = new THREE.Mesh(new THREE.BoxGeometry(width * rand(0.34, 0.58), 0.11, 0.035), windowMaterial);
      win.position.set(0, 0.8 + r * 1.05, facadeZ);
      group.add(win);
    }

    if (Math.random() > 0.28) {
      const signMaterial = pick([world.materials.cyan, world.materials.pink, world.materials.yellow]);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.42, 0.055), signMaterial);
      sign.position.set(0, Math.min(height - 0.8, rand(1.55, height - 0.75)), depth / 2 + 0.05);
      group.add(sign);

      const signStripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.46, 0.055, 0.065), world.materials.white);
      signStripe.position.set(0, sign.position.y, depth / 2 + 0.09);
      group.add(signStripe);
    }

    if (height > 8 && Math.random() > 0.42) {
      const rooftop = new THREE.Mesh(new THREE.BoxGeometry(width * 0.38, rand(0.38, 0.74), depth * 0.42), material);
      rooftop.position.set(rand(-width * 0.16, width * 0.16), height + rooftop.geometry.parameters.height / 2 - 0.05, rand(-depth * 0.08, depth * 0.08));
      rooftop.castShadow = true;
      group.add(rooftop);
    }

    if (Math.random() > 0.55) {
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.08, Math.min(height - 1.2, rand(3.2, 5.8)), 0.04), pick([world.materials.windowCyan, world.materials.windowPink, world.materials.windowWarm]));
      vertical.position.set(-width * 0.48, vertical.geometry.parameters.height / 2 + 1.0, facadeZ + 0.045);
      group.add(vertical);
    }

    group.position.set(side * rand(9.6, 15.5), 0, z);
    group.rotation.y = side > 0 ? -0.07 : 0.07;
    group.userData.baseX = group.position.x;
    return group;
  }

  function loadModelAssets() {
    const THREE = window.THREE;
    if (!THREE.GLTFLoader) return;

    const loader = new THREE.GLTFLoader();
    world.assetLoader = loader;
    [
      ["delivery", "delivery.glb"],
      ["sedan", "sedan.glb"],
      ["cone", "cone.glb"],
      ["box", "box.glb"],
    ].forEach(([key, file]) => {
      loader.load(
        `${MODEL_ASSET_BASE}/${file}`,
        (gltf) => {
          const model = gltf.scene;
          prepareModel(model);
          world.models[key] = model;
          if (key === "delivery") installPlayerModel();
        },
        undefined,
        () => {}
      );
    });
  }

  function prepareModel(model) {
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        if ("roughness" in material) material.roughness = Math.min(0.82, material.roughness ?? 0.58);
        if ("metalness" in material) material.metalness = Math.max(0.04, material.metalness ?? 0.04);
      });
    });
  }

  function cloneModel(key) {
    const source = world.models[key];
    if (!source) return null;
    const clone = source.clone(true);
    prepareModel(clone);
    return clone;
  }

  function normalizeModel(model, targetFootprint) {
    const THREE = window.THREE;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = targetFootprint / Math.max(size.x, size.z, 0.001);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  function installPlayerModel() {
    if (!world.car || world.car.userData.assetModel) return;
    const model = cloneModel("delivery");
    if (!model) return;
    if (world.car.userData.fallback) world.car.userData.fallback.visible = false;
    model.rotation.y = Math.PI;
    normalizeModel(model, 3.35);
    model.position.y += 0.04;
    model.position.z += 0.1;
    world.car.userData.assetModel = model;
    world.car.add(model);
  }

  function addObstacleModel(group, type) {
    const modelKey = type === "cone" ? "cone" : type === "sedan" ? "sedan" : type === "cash" ? "box" : "";
    if (!modelKey) return false;

    const model = cloneModel(modelKey);
    if (!model) return false;

    if (type === "cone") {
      normalizeModel(model, 1.15);
      model.position.y += 0.02;
    } else if (type === "sedan") {
      model.rotation.y = Math.PI;
      normalizeModel(model, 3.0);
      model.position.y += 0.04;
    } else if (type === "cash") {
      model.rotation.y = Math.PI / 4;
      normalizeModel(model, 1.15);
      model.position.y += 0.68;
      const glow = new window.THREE.PointLight(0x6bff7d, 2.7, 9);
      glow.position.set(0, 1.1, 0);
      group.add(glow);
    }

    group.add(model);
    return true;
  }

  function makePlayerCar() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const fallback = new THREE.Group();
    group.userData.fallback = fallback;
    group.add(fallback);

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 3.25), world.materials.cyan);
    body.position.y = 0.58;
    body.castShadow = true;
    fallback.add(body);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.24, 1.0), world.materials.pink);
    hood.position.set(0, 0.98, 0.72);
    hood.castShadow = true;
    fallback.add(hood);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.82, 1.28), world.materials.glass);
    cab.position.set(0, 1.12, -0.42);
    cab.castShadow = true;
    fallback.add(cab);

    const bag = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.98, 1.18), world.materials.bag);
    bag.position.set(0, 1.95, -0.42);
    bag.castShadow = true;
    fallback.add(bag);

    const bagFold = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.6, 4), world.materials.bag);
    bagFold.position.set(0, 2.68, -0.42);
    bagFold.rotation.y = Math.PI / 4;
    fallback.add(bagFold);

    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.34), world.materials.yellow);
    sign.position.set(0, 2.25, 0.2);
    fallback.add(sign);

    const wheelGeometry = new THREE.TorusGeometry(0.28, 0.095, 12, 18);
    const wheelPositions = [
      [-1.14, 0.32, -1.1],
      [1.14, 0.32, -1.1],
      [-1.14, 0.32, 1.08],
      [1.14, 0.32, 1.08],
    ];
    wheelPositions.forEach((pos) => {
      const wheel = new THREE.Mesh(wheelGeometry, world.materials.black);
      wheel.position.set(pos[0], pos[1], pos[2]);
      wheel.rotation.y = Math.PI / 2;
      wheel.castShadow = true;
      fallback.add(wheel);
      world.carWheels.push(wheel);
    });

    const headlightL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.06), world.materials.yellow);
    headlightL.position.set(-0.58, 0.62, 1.66);
    fallback.add(headlightL);
    const headlightR = headlightL.clone();
    headlightR.position.x = 0.58;
    fallback.add(headlightR);

    const lightL = new THREE.PointLight(0xffe48c, 1.8, 28);
    lightL.position.set(-0.7, 0.75, 2.6);
    group.add(lightL);
    const lightR = lightL.clone();
    lightR.position.x = 0.7;
    group.add(lightR);

    group.position.set(0, 0, PLAYER_Z);
    return group;
  }

  function makeDestination() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.09, 12, 50), world.materials.yellow);
    ring.position.y = 0.08;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 32), world.materials.yellow);
    pin.position.set(0, 2.0, 0);
    pin.rotation.x = Math.PI;
    group.add(pin);

    const glow = new THREE.PointLight(0xffd43b, 5, 28);
    glow.position.set(0, 2.2, 0);
    group.add(glow);

    for (let i = 0; i < 3; i++) {
      const chevron = new THREE.Mesh(new THREE.BoxGeometry(1.6 - i * 0.18, 0.08, 0.34), world.materials.yellow);
      chevron.position.set(0, 0.06, -1.2 - i * 1.2);
      group.add(chevron);
    }

    group.visible = false;
    return group;
  }

  function makeObstacle(type, lane, z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.position.set(LANES[lane], 0, z);
    group.userData.type = type;
    group.userData.lane = lane;
    group.userData.hit = false;
    group.userData.cleared = false;
    group.userData.passed = false;
    group.userData.spin = rand(-1, 1);

    if (addObstacleModel(group, type)) return group;

    if (type === "cone") {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.25, 18), world.materials.orange);
      cone.position.y = 0.62;
      cone.castShadow = true;
      group.add(cone);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.12, 0.68), world.materials.white);
      stripe.position.y = 0.56;
      group.add(stripe);
    } else if (type === "pothole") {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.68, 0.05, 32), world.materials.asphaltDark);
      hole.position.y = 0.04;
      group.add(hole);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.055, 8, 32), world.materials.black);
      rim.position.y = 0.085;
      rim.rotation.x = Math.PI / 2;
      group.add(rim);
    } else if (type === "scooter") {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.16, 0.36), world.materials.pink);
      deck.position.y = 0.32;
      deck.castShadow = true;
      group.add(deck);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), world.materials.white);
      stem.position.set(0.45, 0.86, 0);
      group.add(stem);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.08), world.materials.white);
      bar.position.set(0.45, 1.38, 0);
      group.add(bar);
      [-0.55, 0.55].forEach((x) => {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 12), world.materials.black);
        wheel.position.set(x, 0.2, 0);
        wheel.rotation.y = Math.PI / 2;
        group.add(wheel);
      });
    } else if (type === "sedan") {
      const car = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 2.9), world.materials.orange);
      car.position.y = 0.48;
      car.castShadow = true;
      group.add(car);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.55, 1.2), world.materials.glass);
      top.position.y = 1.05;
      group.add(top);
      const brake = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.08), world.materials.pink);
      brake.position.set(0, 0.55, 1.48);
      group.add(brake);
    } else if (type === "soda") {
      const puddle = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.58, 0.045, 32), world.materials.sauce);
      puddle.position.y = 0.045;
      group.add(puddle);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.5, 14), world.materials.white);
      cup.position.set(0.45, 0.27, 0.1);
      cup.rotation.z = 0.8;
      group.add(cup);
    } else if (type === "cash") {
      const bill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.56), world.materials.cash);
      bill.position.y = 0.72;
      bill.castShadow = true;
      group.add(bill);
      const glow = new THREE.PointLight(0x6bff7d, 2.6, 9);
      glow.position.set(0, 1.1, 0);
      group.add(glow);
    } else if (type === "ramp") {
      group.userData.spin = 0;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 2.75), world.materials.yellow);
      deck.position.set(0, 0.38, 0);
      deck.rotation.x = 0.34;
      deck.castShadow = true;
      deck.receiveShadow = true;
      group.add(deck);

      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.14, 0.2), world.materials.cyan);
      lip.position.set(0, 0.73, -1.12);
      lip.castShadow = true;
      group.add(lip);

      [-0.78, 0.78].forEach((x) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.45), world.materials.pink);
        rail.position.set(x, 0.54, 0);
        rail.rotation.x = 0.34;
        group.add(rail);
      });

      for (let i = 0; i < 3; i++) {
        const chevron = new THREE.Mesh(new THREE.BoxGeometry(1.08 - i * 0.14, 0.055, 0.12), world.materials.black);
        chevron.position.set(0, 0.57 + i * 0.08, 0.64 - i * 0.58);
        chevron.rotation.x = 0.34;
        group.add(chevron);
      }

      const glow = new THREE.PointLight(0xffd43b, 2.8, 10);
      glow.position.set(0, 1.0, 0);
      group.add(glow);
    } else if (type === "bot") {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.58, 1.35), world.materials.white);
      shell.position.y = 0.52;
      shell.castShadow = true;
      group.add(shell);

      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.26, 0.06), world.materials.cyan);
      screen.position.set(0, 0.62, 0.71);
      group.add(screen);

      [-0.42, 0.42].forEach((x) => {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 14), world.materials.black);
        wheel.position.set(x, 0.22, 0.42);
        wheel.rotation.y = Math.PI / 2;
        group.add(wheel);
      });
    } else if (type === "barricade") {
      [-0.82, 0.82].forEach((x) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.04, 0.18), world.materials.orange);
        post.position.set(x, 0.52, 0);
        post.castShadow = true;
        group.add(post);
      });

      const board = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.34, 0.16), world.materials.white);
      board.position.set(0, 0.76, 0);
      board.castShadow = true;
      group.add(board);

      [-0.52, 0.02, 0.56].forEach((x) => {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.18), world.materials.pink);
        stripe.position.set(x, 0.76, 0.02);
        stripe.rotation.z = -0.45;
        group.add(stripe);
      });
    } else if (type === "drone") {
      group.userData.spin = 0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.28, 0.72), world.materials.glass);
      body.position.y = 1.82;
      body.castShadow = true;
      group.add(body);

      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.05), world.materials.pink);
      eye.position.set(0, 1.82, 0.39);
      group.add(eye);

      [
        [-0.68, 0.22],
        [0.68, 0.22],
        [-0.68, -0.22],
        [0.68, -0.22],
      ].forEach(([x, z]) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), world.materials.black);
        arm.position.set(x * 0.5, 1.84, z);
        arm.rotation.y = x > 0 ? 0.25 : -0.25;
        group.add(arm);

        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 20), world.materials.cyan);
        rotor.userData.rotor = true;
        rotor.position.set(x, 1.9, z);
        rotor.scale.z = 0.28;
        group.add(rotor);
      });

      const glow = new THREE.PointLight(0xff2e88, 2.4, 9);
      glow.position.set(0, 1.82, 0);
      group.add(glow);
    }

    return group;
  }

  function makeImpactEffect(position, type, severity) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const heavy = type === "sedan";
    group.position.set(position.x, 0.08, position.z + 0.25);
    group.userData.age = 0;
    group.userData.lifetime = heavy ? 0.9 : 0.64;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 8, 34), world.materials.impactRing.clone());
    ring.userData.effectKind = "ring";
    ring.userData.disposeMaterial = true;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);

    const skidCount = heavy ? 4 : 2;
    for (let i = 0; i < skidCount; i++) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, rand(1.2, 2.5)), world.materials.skid.clone());
      skid.userData.effectKind = "skid";
      skid.userData.disposeMaterial = true;
      skid.position.set(rand(-0.8, 0.8), 0.025, rand(-0.8, 0.9));
      skid.rotation.y = rand(-0.28, 0.28);
      group.add(skid);
    }

    const sparkCount = Math.round((heavy ? 20 : 12) * severity);
    for (let i = 0; i < sparkCount; i++) {
      const sparkMaterial = world.materials.spark.clone();
      if (Math.random() > 0.64) sparkMaterial.color.setHex(0xfff4bf);
      if (Math.random() > 0.82) sparkMaterial.color.setHex(0xff2e88);
      const spark = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, rand(0.18, 0.34)), sparkMaterial);
      spark.userData.effectKind = "spark";
      spark.userData.disposeMaterial = true;
      spark.userData.velocity = new THREE.Vector3(rand(-4.4, 4.4), rand(2.0, heavy ? 6.2 : 4.7), rand(-5.2, 2.6));
      spark.userData.spin = new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      spark.position.set(rand(-0.36, 0.36), rand(0.35, 0.9), rand(-0.26, 0.32));
      spark.castShadow = true;
      group.add(spark);
    }

    const smokeCount = heavy ? 7 : 4;
    for (let i = 0; i < smokeCount; i++) {
      const smoke = new THREE.Mesh(new THREE.SphereGeometry(rand(0.12, 0.24), 10, 8), world.materials.smoke.clone());
      smoke.userData.effectKind = "smoke";
      smoke.userData.disposeMaterial = true;
      smoke.userData.velocity = new THREE.Vector3(rand(-0.65, 0.65), rand(0.7, 1.55), rand(-1.4, 0.45));
      smoke.position.set(rand(-0.46, 0.46), rand(0.28, 0.9), rand(-0.3, 0.38));
      group.add(smoke);
    }

    const flash = new THREE.PointLight(heavy ? 0xffd43b : 0xff2e88, heavy ? 5.6 : 3.4, heavy ? 18 : 11);
    flash.userData.effectKind = "flash";
    flash.position.set(0, 1.05, 0);
    group.add(flash);

    world.scene.add(group);
    world.effects.push(group);
  }

  function kickObstacle(obstacle, type, severity) {
    const heavy = type === "sedan";
    const side = Math.sign(obstacle.position.x - state.carX) || (Math.random() > 0.5 ? 1 : -1);
    obstacle.userData.hitTimer = heavy ? 0.68 : 0.46;
    obstacle.userData.hitDuration = obstacle.userData.hitTimer;
    obstacle.userData.hitVX = side * rand(1.3, heavy ? 3.1 : 2.2) * severity;
    obstacle.userData.hitVY = rand(1.6, heavy ? 3.2 : 2.5) * severity;
    obstacle.userData.hitSpinX = rand(-2.6, 2.6) * severity;
    obstacle.userData.hitSpinZ = -side * rand(2.0, heavy ? 4.8 : 3.2) * severity;
  }

  function makePickupEffect(position) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.position.set(position.x, 0.28, position.z);
    group.userData.age = 0;
    group.userData.lifetime = 0.52;

    for (let i = 0; i < 10; i++) {
      const material = world.materials.cash.clone();
      material.transparent = true;
      material.opacity = 0.9;
      const coin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.16), material);
      coin.userData.effectKind = "spark";
      coin.userData.disposeMaterial = true;
      coin.userData.velocity = new THREE.Vector3(rand(-2.0, 2.0), rand(1.4, 3.8), rand(-2.0, 1.0));
      coin.userData.spin = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      coin.position.set(rand(-0.25, 0.25), rand(0.28, 0.8), rand(-0.25, 0.25));
      group.add(coin);
    }

    const flash = new THREE.PointLight(0x6bff7d, 3.6, 10);
    flash.userData.effectKind = "flash";
    flash.position.set(0, 1, 0);
    group.add(flash);

    world.scene.add(group);
    world.effects.push(group);
  }

  function makeRampLaunchEffect(position) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.position.set(position.x, 0.2, position.z - 0.25);
    group.userData.age = 0;
    group.userData.lifetime = 0.72;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 10, 36), world.materials.cyan.clone());
    ring.material.transparent = true;
    ring.material.opacity = 0.72;
    ring.userData.effectKind = "ring";
    ring.userData.disposeMaterial = true;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);

    for (let i = 0; i < 14; i++) {
      const material = (i % 2 ? world.materials.yellow : world.materials.cyan).clone();
      material.transparent = true;
      material.opacity = 0.94;
      const spark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, rand(0.22, 0.42)), material);
      spark.userData.effectKind = "spark";
      spark.userData.disposeMaterial = true;
      spark.userData.velocity = new THREE.Vector3(rand(-2.4, 2.4), rand(2.2, 5.2), rand(-3.7, -0.2));
      spark.userData.spin = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      spark.position.set(rand(-0.45, 0.45), rand(0.32, 0.85), rand(-0.2, 0.36));
      group.add(spark);
    }

    const flash = new THREE.PointLight(0x2ee0ff, 4.2, 14);
    flash.userData.effectKind = "flash";
    flash.position.set(0, 1.15, 0);
    group.add(flash);

    world.scene.add(group);
    world.effects.push(group);
  }

  function resize() {
    if (!world.renderer || !world.camera) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || canvas.width));
    const height = Math.max(220, Math.round(rect.height || canvas.height));
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  }

  function bindFullscreen() {
    const fsTarget = canvas.closest(".canvas-wrap") || canvas.parentElement;
    if (!fsTarget) return;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const updateBtn = () => {
      if (!el.fullscreen) return;
      const on = isMaxed();
      el.fullscreen.textContent = on ? "✕" : "⛶";
      el.fullscreen.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      el.fullscreen.setAttribute("title", on ? "Exit" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateBtn();
      window.dispatchEvent(new Event("resize"));
      resize();
      if (on) canvas.focus({ preventScroll: true });
    };
    const toggle = () => {
      const on = !isMaxed();
      setMaxed(on);
      if (on) {
        const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
        if (req) {
          try {
            const ret = req.call(fsTarget);
            if (ret && ret.catch) ret.catch(() => {});
          } catch (_) {}
        }
      } else if (nativeFsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          try { exit.call(document); } catch (_) {}
        }
      }
    };
    if (el.fullscreen) el.fullscreen.addEventListener("click", toggle);
    const onNativeFsChange = () => {
      if (!nativeFsEl() && isMaxed()) setMaxed(false);
    };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) {
        event.preventDefault();
        event.stopPropagation();
        setMaxed(false);
      }
    });
    updateBtn();
  }

  function bindInputs() {
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        changeLane(-1);
      } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
        event.preventDefault();
        changeLane(1);
      } else if (event.key === "ArrowUp" || event.key === "w" || event.key === "W" || event.key === " ") {
        event.preventDefault();
        jump();
      } else if (event.key === "Shift") {
        state.boostHeld = true;
      } else if (event.key === "p" || event.key === "P" || event.key === "Escape") {
        togglePause();
      } else if ((event.key === "Enter" || event.key === "Return") && !state.running) {
        startGame();
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") state.boostHeld = false;
    });

    let pointerStart = null;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!pointerStart) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      pointerStart = null;
      if (Math.max(ax, ay) < 18) {
        if (!state.running) startGame();
        else jump();
        return;
      }
      if (ax > ay) changeLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump();
      else state.boostHeld = false;
    });
    canvas.addEventListener("pointercancel", () => { pointerStart = null; state.boostHeld = false; });

    el.primary.addEventListener("click", startGame);
    el.pause.addEventListener("click", togglePause);
    el.restart.addEventListener("click", () => {
      state.running = false;
      state.paused = false;
      startGame();
    });
    if (el.sound) {
      updateSoundButton();
      el.sound.addEventListener("click", () => {
        audio.enabled = !audio.enabled;
        writeSoundPreference();
        updateSoundButton();
        if (audio.enabled) {
          ensureAudio();
          playTone(440, "triangle", 0.08, 0.04, 660);
        } else if (audio.engineGain && audio.ctx) {
          audio.engineGain.gain.setTargetAtTime(0.0001, audio.ctx.currentTime, 0.04);
        }
      });
    }
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: el.primary,
        scoreEl: el.overlayScore,
        continueLabel: "Continue delivery",
        newLabel: "New delivery",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Delivery <strong>${Number(data.delivery || 1)}/${DELIVERIES_TO_WIN}</strong> · Score <strong>${Math.round(Number(data.score || 0)).toLocaleString()}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.ready && state.running && !state.gameOver);
    }

    bindTap(el.left, () => changeLane(-1));
    bindTap(el.right, () => changeLane(1));
    bindTap(el.jump, jump);
    bindHold(el.boost, () => { state.boostHeld = true; }, () => { state.boostHeld = false; });
    bindFullscreen();
  }

  function bindTap(button, action) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      action();
    });
  }

  function bindHold(button, down, up) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      down();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        event.preventDefault();
        up();
      });
    });
  }

  function startGame() {
    if (!state.ready) return;
    ensureAudio();
    playStartSound();
    audio.lastBoost = false;
    if (saveSlot) saveSlot.clear();
    clearObstacles();
    clearEffects();
    Object.assign(state, {
      running: true,
      paused: false,
      gameOver: false,
      delivery: 1,
      distance: 0,
      score: 0,
      speed: 26,
      targetLane: 1,
      lane: 1,
      carX: 0,
      carY: 0,
      carVY: 0,
      nitro: 100,
      boostHeld: false,
      boostActive: false,
      heat: 100,
      bag: 100,
      patience: 100,
      tip: 6,
      streak: 0,
      comboTimer: 0,
      spawnTimer: 0.65,
      eventTimer: 5.5,
      eventMessageTimer: 0,
      airRampSpawned: false,
      airRampTimer: 0,
      hitFlash: 0,
      cameraShake: 0,
      impactTimer: 0,
      impactDuration: 0.5,
      impactSide: 1,
      lastTime: performance.now(),
    });
    updateRouteChip();
    hideOverlay();
    updateHUD();
    canvas.focus();
  }

  function snapshot() {
    return {
      delivery: state.delivery,
      distance: state.distance,
      score: state.score,
      speed: state.speed,
      targetLane: state.targetLane,
      lane: state.lane,
      carX: state.carX,
      carY: state.carY,
      carVY: state.carVY,
      nitro: state.nitro,
      heat: state.heat,
      bag: state.bag,
      patience: state.patience,
      tip: state.tip,
      streak: state.streak,
      comboTimer: state.comboTimer,
      spawnTimer: state.spawnTimer,
      eventTimer: state.eventTimer,
      airRampSpawned: state.airRampSpawned,
      airRampTimer: state.airRampTimer,
    };
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!state.ready || !data) return;
    ensureAudio();
    playStartSound();
    audio.lastBoost = false;
    clearObstacles();
    clearEffects();
    Object.assign(state, {
      running: true,
      paused: false,
      gameOver: false,
      delivery: clamp(Number(data.delivery) || 1, 1, DELIVERIES_TO_WIN),
      distance: Math.max(0, Number(data.distance) || 0),
      score: Number(data.score) || 0,
      speed: Number(data.speed) || 26,
      targetLane: clamp(Number(data.targetLane) || 1, 0, LANES.length - 1),
      lane: clamp(Number(data.lane) || 1, 0, LANES.length - 1),
      carX: Number(data.carX) || 0,
      carY: Number(data.carY) || 0,
      carVY: Number(data.carVY) || 0,
      nitro: clamp(Number(data.nitro) || 100, 0, 100),
      boostHeld: false,
      boostActive: false,
      heat: clamp(Number(data.heat) || 100, 0, 100),
      bag: clamp(Number(data.bag) || 100, 0, 100),
      patience: clamp(Number(data.patience) || 100, 0, 100),
      tip: Math.max(0, Number(data.tip) || 6),
      streak: Number(data.streak) || 0,
      comboTimer: Number(data.comboTimer) || 0,
      spawnTimer: Math.max(0.25, Number(data.spawnTimer) || 0.65),
      eventTimer: Math.max(1, Number(data.eventTimer) || 5.5),
      eventMessageTimer: 0,
      airRampSpawned: Boolean(data.airRampSpawned),
      airRampTimer: Math.max(0, Number(data.airRampTimer) || 0),
      hitFlash: 0,
      cameraShake: 0,
      impactTimer: 0,
      impactDuration: 0.5,
      impactSide: 1,
      lastTime: performance.now(),
    });
    updateRouteChip();
    hideOverlay();
    updateHUD();
    canvas.focus();
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) {
      showOverlay("DELIVERY PAUSED", "The fries are suspended in time. Economists are confused.", "Resume");
    } else {
      hideOverlay();
      state.lastTime = performance.now();
    }
  }

  function showOverlay(title, sub, buttonText, scoreHtml = "") {
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.style.display = scoreHtml ? "block" : "none";
    el.overlayScore.innerHTML = scoreHtml;
    el.primary.textContent = buttonText;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
  }

  function changeLane(delta) {
    if (!state.running || state.paused || state.gameOver) return;
    const nextLane = clamp(state.targetLane + delta, 0, LANES.length - 1);
    if (nextLane !== state.targetLane) playLaneSound();
    state.targetLane = nextLane;
  }

  function jump() {
    if (!state.running || state.paused || state.gameOver) return;
    if (state.carY <= 0.04) {
      state.carVY = 8.6;
      state.carY = 0.03;
      playJumpSound();
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    world.clock += dt;

    if (state.ready && state.running && !state.paused && !state.gameOver) {
      updateGame(dt);
    } else {
      updateIdle(dt);
    }
    updateAudio();
    renderWorld(dt);
  }

  function updateIdle(dt) {
    state.carX = lerp(state.carX, LANES[state.targetLane], Math.min(1, dt * 3));
    state.carY = Math.max(0, state.carY + state.carVY * dt);
    state.carVY = Math.max(-9, state.carVY - 18 * dt);
    if (state.carY <= 0) {
      state.carY = 0;
      state.carVY = 0;
    }
  }

  function updateGame(dt) {
    const route = currentRoute();
    const difficulty = 1 + (state.delivery - 1) * 0.16 + clamp(state.distance / route.length, 0, 1) * 0.2;
    state.boostActive = state.boostHeld && state.nitro > 1;
    const targetSpeed = (24 + state.delivery * 2.1 + state.distance / route.length * 9) * (state.boostActive ? 1.42 : 1);
    state.speed = lerp(state.speed, targetSpeed, Math.min(1, dt * 2.2));

    state.distance += state.speed * dt * 4.0;
    state.score += state.speed * dt * (state.boostActive ? 5.4 : 3.7) + state.streak * dt * 3.2;

    state.heat = clamp(state.heat - dt * (0.88 + state.delivery * 0.14 + (state.boostActive ? 1.4 : 0)), 0, 100);
    state.patience = clamp(state.patience - dt * (0.58 + state.delivery * 0.11 + (state.boostActive ? 0.1 : 0)), 0, 100);
    state.nitro = clamp(state.nitro + dt * (state.boostActive ? -29 : 13.5), 0, 100);
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer <= 0) state.streak = 0;

    updateCar(dt);
    updateRoad(dt);
    updateAirDropRamp(dt);
    updateSpawning(dt, difficulty);
    updateObstacles(dt);
    updateEffects(dt);
    updateEvents(dt);
    updateDestination();
    updateHUD();

    if (state.heat <= 0) endGame("COLD FRIES INCIDENT", "The order achieved room temperature and became evidence.");
    else if (state.bag <= 0) endGame("BAG INTEGRITY FAILURE", "The soup saw freedom and took it.");
    else if (state.patience <= 0) endGame("CUSTOMER RAGE-QUIT", "They texted “nvm” with courtroom energy.");
    else if (state.distance >= route.length) {
      if (canFinishDelivery(route)) {
        finishDelivery();
      } else if (route.airDrop) {
        state.distance = route.length * 0.985;
        state.patience = clamp(state.patience - dt * 6.5, 0, 100);
        if (state.eventMessageTimer <= 0.05) {
          showEvent("Air drop missed", "Hit a ramp and fly through the marker.", "bad");
        }
      }
    }
  }

  function updateCar(dt) {
    const targetX = LANES[state.targetLane];
    const previousX = state.carX;
    state.carX = lerp(state.carX, targetX, Math.min(1, dt * (state.boostActive ? 8.8 : 7.1)));
    state.lane = closestLane(state.carX);

    if (state.carY > 0 || state.carVY > 0) {
      state.carVY -= 20.5 * dt;
      state.carY += state.carVY * dt;
      if (state.carY <= 0) {
        state.carY = 0;
        state.carVY = 0;
      }
    }

    const steer = clamp((state.carX - previousX) * 3.2, -0.55, 0.55);
    const impact = state.impactDuration ? clamp(state.impactTimer / state.impactDuration, 0, 1) : 0;
    const impactMotion = state.reducedMotion ? 0 : impact;
    const impactWobble = Math.sin(world.clock * 42) * impactMotion;
    const impactHop = Math.max(0, Math.sin((1 - impact) * Math.PI * 2.2)) * impactMotion * 0.16;
    world.car.position.set(state.carX, state.carY + impactHop, PLAYER_Z + impactMotion * 0.42);
    world.car.rotation.z = lerp(world.car.rotation.z, -steer + state.impactSide * impactMotion * 0.28 + impactWobble * 0.07, Math.min(1, dt * 10));
    world.car.rotation.x = lerp(world.car.rotation.x, (state.carY > 0 ? -0.16 : 0) - impactMotion * 0.22 + impactWobble * 0.035, Math.min(1, dt * 8));
    world.carWheels.forEach((wheel) => { wheel.rotation.x -= dt * state.speed * 1.8; });
  }

  function updateRoad(dt) {
    const movement = state.speed * dt;
    if (world.textures.road) world.textures.road.offset.y -= movement * 0.018;
    if (world.textures.sidewalk) world.textures.sidewalk.offset.y -= movement * 0.014;
    world.roadLines.forEach((line) => {
      line.position.z += movement;
      if (line.position.z > 12) line.position.z -= 197;
    });
    world.neonRails.forEach((rail) => {
      rail.position.z += movement;
      if (rail.position.z > 18) rail.position.z -= 164;
    });
    world.roadDetails.forEach((detail) => {
      detail.position.z += movement;
      if (detail.position.z > 18) detail.position.z -= 210;
    });
    world.streetProps.forEach((prop) => {
      prop.position.z += movement * 0.94;
      if (prop.position.z > 24) {
        prop.position.z -= 188;
        prop.position.x = rand(-0.25, 0.25);
      }
    });
    world.buildings.forEach((building) => {
      building.position.z += movement * 0.72;
      if (building.position.z > 24) {
        building.position.z -= 190;
        building.position.x = Math.sign(building.userData.baseX || building.position.x || 1) * rand(9.6, 15.5);
      }
    });
  }

  function updateAirDropRamp(dt) {
    const route = currentRoute();
    if (!route.airDrop || !state.running || state.paused || state.gameOver) return;
    const progress = clamp(state.distance / route.length, 0, 1);
    state.airRampTimer = Math.max(0, state.airRampTimer - dt);

    if (!state.airRampSpawned && progress > 0.74) {
      spawnAirDropRamp(route, OBSTACLE_START_Z + 18);
      state.airRampSpawned = true;
      state.airRampTimer = 4.8;
    } else if (progress > 0.94 && state.carY < route.airHeight * 0.45 && state.airRampTimer <= 0) {
      spawnAirDropRamp(route, OBSTACLE_START_Z + 26);
      state.airRampTimer = 4.8;
    }
  }

  function spawnAirDropRamp(route, z) {
    const lane = clamp(Number(route.airLane) || 1, 0, LANES.length - 1);
    spawnObstacle("ramp", lane, z);
    showEvent("Air drop ramp", "Line up and launch into the marker.", "good");
  }

  function updateSpawning(dt, difficulty) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = rand(0.92, 1.32) / difficulty;

    const safeLane = Math.floor(rand(0, LANES.length));
    const lanes = [0, 1, 2].filter((lane) => lane !== safeLane);
    const obstacleCount = Math.random() > Math.max(0.48, 0.84 - state.delivery * 0.06) ? 2 : 1;
    const obstaclePool = obstaclePoolForDelivery();
    lanes.sort(() => Math.random() - 0.5).slice(0, obstacleCount).forEach((lane, index) => {
      const type = pick(obstaclePool);
      spawnObstacle(type, lane, OBSTACLE_START_Z - index * rand(8, 13));
    });

    const rampChance = state.delivery >= 2 ? 0.14 + state.delivery * 0.035 : 0.05;
    if (Math.random() < rampChance) {
      spawnObstacle("ramp", safeLane, OBSTACLE_START_Z + rand(8, 15));
      if (state.delivery >= 3 && Math.random() > 0.28) {
        spawnObstacle(pick(["pothole", "bot", "barricade"]), safeLane, OBSTACLE_START_Z - rand(4, 11));
      }
    } else if (Math.random() > 0.48) {
      spawnObstacle("cash", safeLane, OBSTACLE_START_Z - rand(5, 14));
    }
  }

  function obstaclePoolForDelivery() {
    const pool = ["cone", "pothole", "scooter", "sedan", "soda"];
    if (state.delivery >= 2) pool.push("bot", "bot", "barricade");
    if (state.delivery >= 3) pool.push("drone", "barricade", "pothole");
    if (state.delivery >= 4) pool.push("drone", "sedan", "bot", "barricade");
    if (state.delivery >= 5) pool.push("drone", "drone", "barricade", "sedan");
    return pool;
  }

  function spawnObstacle(type, lane, z) {
    const group = makeObstacle(type, lane, z);
    world.scene.add(group);
    world.obstacles.push(group);
  }

  function updateObstacles(dt) {
    const movement = state.speed * dt;
    for (let i = world.obstacles.length - 1; i >= 0; i--) {
      const obstacle = world.obstacles[i];
      obstacle.position.z += movement;
      obstacle.rotation.y += obstacle.userData.spin * dt * 0.45;
      if (obstacle.userData.type === "cash") {
        obstacle.position.y = 0.25 + Math.sin(world.clock * 5 + i) * 0.12;
        obstacle.rotation.y += dt * 2.8;
      } else if (obstacle.userData.type === "drone") {
        obstacle.position.y = Math.sin(world.clock * 4.4 + i) * 0.08;
        obstacle.children.forEach((child) => {
          if (child.userData && child.userData.rotor) child.rotation.y += dt * 18;
        });
      }

      if (obstacle.userData.hitTimer > 0) {
        obstacle.userData.hitTimer = Math.max(0, obstacle.userData.hitTimer - dt);
        obstacle.position.x += (obstacle.userData.hitVX || 0) * dt;
        obstacle.position.y = Math.max(0, obstacle.position.y + (obstacle.userData.hitVY || 0) * dt);
        obstacle.userData.hitVY = (obstacle.userData.hitVY || 0) - 9.5 * dt;
        obstacle.rotation.x += (obstacle.userData.hitSpinX || 0) * dt;
        obstacle.rotation.z += (obstacle.userData.hitSpinZ || 0) * dt;
        const hitProgress = obstacle.userData.hitDuration ? obstacle.userData.hitTimer / obstacle.userData.hitDuration : 0;
        const squash = 1 + Math.sin((1 - hitProgress) * Math.PI * 2) * 0.035;
        obstacle.scale.setScalar(squash);
      } else if (obstacle.userData.hit) {
        obstacle.scale.setScalar(1);
      }

      if (!obstacle.userData.hit && !obstacle.userData.cleared && Math.abs(obstacle.position.z - PLAYER_Z) < 1.2) {
        checkCollision(obstacle);
      }

      if (!obstacle.userData.passed && obstacle.position.z > PLAYER_Z + 2.2) {
        obstacle.userData.passed = true;
        if (!obstacle.userData.hit && !obstacle.userData.cleared && obstacle.userData.type !== "cash" && obstacle.userData.type !== "ramp") rewardNearMiss();
      }

      if (obstacle.position.z > OBSTACLE_END_Z) {
        world.scene.remove(obstacle);
        disposeObject(obstacle);
        world.obstacles.splice(i, 1);
      }
    }
  }

  function updateEffects(dt) {
    const THREE = window.THREE;
    const movement = state.speed * dt * 0.82;
    for (let i = world.effects.length - 1; i >= 0; i--) {
      const effect = world.effects[i];
      effect.userData.age += dt;
      effect.position.z += movement;
      const progress = clamp(effect.userData.age / effect.userData.lifetime, 0, 1);

      effect.children.forEach((child) => {
        if (child.userData.effectKind === "spark") {
          child.position.addScaledVector(child.userData.velocity, dt);
          child.userData.velocity.y -= 7.6 * dt;
          child.rotation.x += child.userData.spin.x * dt;
          child.rotation.y += child.userData.spin.y * dt;
          child.rotation.z += child.userData.spin.z * dt;
          if (child.material) child.material.opacity = Math.max(0, 1 - progress);
        } else if (child.userData.effectKind === "smoke") {
          child.position.addScaledVector(child.userData.velocity, dt);
          child.scale.setScalar(1 + progress * 1.7);
          if (child.material) child.material.opacity = Math.max(0, 0.24 * (1 - progress));
        } else if (child.userData.effectKind === "ring") {
          child.scale.setScalar(1 + progress * 3.1);
          if (child.material) child.material.opacity = Math.max(0, 0.58 * (1 - progress));
        } else if (child.userData.effectKind === "skid") {
          if (child.material) child.material.opacity = Math.max(0, 0.72 * (1 - progress * 1.2));
        } else if (child.userData.effectKind === "flash" && child.isLight) {
          child.intensity = THREE.MathUtils ? THREE.MathUtils.lerp(child.intensity, 0, progress) : child.intensity * (1 - progress);
        }
      });

      if (effect.userData.age >= effect.userData.lifetime) {
        world.scene.remove(effect);
        disposeObject(effect);
        world.effects.splice(i, 1);
      }
    }
  }

  function checkCollision(obstacle) {
    const laneDistance = Math.abs(obstacle.position.x - state.carX);
    if (laneDistance > 1.05) return;

    const type = obstacle.userData.type;
    if (type === "ramp") {
      hitRamp(obstacle);
      return;
    }

    if (type === "cash") {
      obstacle.userData.hit = true;
      collectCash(obstacle);
      return;
    }

    const config = OBSTACLE_TYPES[type];
    const jumped = config.jump && state.carY > (config.jumpHeight || 0.72);
    if (jumped) {
      obstacle.userData.cleared = true;
      rewardNearMiss(2);
      showEvent("Clean air", `Cleared ${config.label.toLowerCase()}.`, "good");
      return;
    }

    const ducked = config.airborne && state.carY < (config.duckHeight || 0.5);
    if (ducked) {
      obstacle.userData.cleared = true;
      rewardNearMiss(2);
      showEvent("Stayed low", "Drone missed the bag. Barely.", "good");
      return;
    }

    obstacle.userData.hit = true;
    state.bag = clamp(state.bag - config.bag, 0, 100);
    state.heat = clamp(state.heat - config.heat, 0, 100);
    state.tip = Math.max(0, state.tip - config.tip);
    state.score = Math.max(0, state.score - config.score);
    state.streak = 0;
    state.comboTimer = 0;
    const severity = type === "sedan" ? 1.35 : type === "pothole" ? 1.12 : 1;
    state.hitFlash = 0.34 * severity;
    state.cameraShake = 0.42 * severity;
    state.impactTimer = type === "sedan" ? 0.68 : 0.48;
    state.impactDuration = state.impactTimer;
    state.impactSide = Math.sign(state.carX - obstacle.position.x) || (Math.random() > 0.5 ? 1 : -1);
    kickObstacle(obstacle, type, severity);
    makeImpactEffect(obstacle.position, type, severity);
    playCrashSound(type);
    showEvent(config.label, "Bag damage. Tip confidence has left the chat.", "bad");
  }

  function hitRamp(obstacle) {
    obstacle.userData.hit = true;
    state.carVY = Math.max(state.carVY, 13.2);
    state.carY = Math.max(state.carY, 0.08);
    state.nitro = clamp(state.nitro + 10, 0, 100);
    state.score += 220 + state.streak * 20;
    state.streak += 1;
    state.comboTimer = 3.4;
    state.cameraShake = Math.max(state.cameraShake, 0.18);
    state.impactTimer = Math.max(state.impactTimer, 0.22);
    state.impactDuration = Math.max(state.impactDuration, 0.38);
    state.impactSide = Math.random() > 0.5 ? 1 : -1;
    makeRampLaunchEffect(obstacle.position);
    playRampSound();
    showEvent("Ramp launch", "Airborne shortcut. Watch for drones.", "good");
  }

  function collectCash(obstacle) {
    state.tip += 0.65 + state.streak * 0.04;
    state.nitro = clamp(state.nitro + 12, 0, 100);
    state.score += 280 + state.streak * 22;
    state.streak += 1;
    state.comboTimer = 3.5;
    makePickupEffect(obstacle.position);
    playPickupSound();
    showEvent("Mystery cash tip", "+nitro, +tip, +delusion.", "good");
    obstacle.visible = false;
  }

  function rewardNearMiss(multiplier = 1) {
    state.streak += multiplier;
    state.comboTimer = 2.8;
    state.score += 90 * multiplier + state.streak * 18;
    if (state.streak % 5 === 0) {
      state.tip += 0.2;
      state.nitro = clamp(state.nitro + 8, 0, 100);
      showEvent("Clean driving streak", "The algorithm briefly respected you.", "good");
    }
  }

  function updateEvents(dt) {
    state.eventTimer -= dt;
    state.eventMessageTimer = Math.max(0, state.eventMessageTimer - dt);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 1.9);
    state.cameraShake = Math.max(0, state.cameraShake - dt * 2.2);
    state.impactTimer = Math.max(0, state.impactTimer - dt);

    if (state.eventMessageTimer <= 0) {
      el.eventChip.classList.remove("doorcrash-event--show");
    }

    if (state.eventTimer <= 0) {
      state.eventTimer = rand(7.0, 10.0);
      const event = pick(EVENTS);
      state.heat = clamp(state.heat + (event.heat || 0), 0, 100);
      state.bag = clamp(state.bag + (event.bag || 0), 0, 100);
      state.patience = clamp(state.patience + (event.patience || 0), 0, 100);
      state.tip = Math.max(0, state.tip + (event.tip || 0));
      showEvent(event.title, event.text, event.tip && event.tip > 0 ? "good" : "bad");
    }
  }

  function showEvent(title, text, tone = "") {
    el.eventChip.innerHTML = `<strong>${title}</strong><span>${shortCue(text)}</span>`;
    el.eventChip.classList.add("doorcrash-event--show");
    el.eventChip.style.borderColor = tone === "good" ? "rgba(107, 255, 125, 0.42)" : "rgba(255, 46, 136, 0.5)";
    if (el.eventLog) el.eventLog.textContent = `${title}: ${text}`;
    state.eventMessageTimer = 2.7;
  }

  function updateDestination() {
    const route = currentRoute();
    const progress = clamp(state.distance / route.length, 0, 1);
    const visible = progress > (route.airDrop ? 0.66 : 0.72);
    world.destination.visible = visible;
    if (!visible) return;
    const t = route.airDrop ? (progress - 0.66) / 0.34 : (progress - 0.72) / 0.28;
    const laneX = route.airDrop ? LANES[clamp(Number(route.airLane) || 1, 0, LANES.length - 1)] : 0;
    const targetY = route.airDrop ? route.airHeight : 0.05;
    world.destination.position.set(laneX, targetY, lerp(-96, -18, clamp(t, 0, 1)));
    world.destination.rotation.y += (route.airDrop ? 0.035 : 0.015) + (state.boostActive ? 0.02 : 0);
    const pulse = 1 + Math.sin(world.clock * (route.airDrop ? 6 : 4)) * (route.airDrop ? 0.06 : 0.035);
    world.destination.scale.setScalar((route.airDrop ? 1.12 : 1) * pulse);
  }

  function canFinishDelivery(route) {
    if (!route.airDrop) return true;
    const laneX = LANES[clamp(Number(route.airLane) || 1, 0, LANES.length - 1)];
    return state.carY >= route.airHeight && Math.abs(state.carX - laneX) <= 1.45;
  }

  function finishDelivery() {
    const legBonus = Math.round(state.heat * 8 + state.bag * 9 + state.patience * 5 + state.tip * 120 + state.streak * 35);
    state.score += legBonus;

    if (state.delivery >= DELIVERIES_TO_WIN) {
      winGame();
      return;
    }

    state.delivery += 1;
    state.distance = 0;
    state.heat = clamp(state.heat + 30, 0, 100);
    state.bag = clamp(state.bag + 18, 0, 100);
    state.patience = 100;
    state.tip += 1.35;
    state.spawnTimer = 1.2;
    state.eventTimer = 4.5;
    state.airRampSpawned = false;
    state.airRampTimer = 0;
    clearObstacles();
    clearEffects();
    updateRouteChip();
    playDeliverySound();
    showEvent("Delivery complete", `+$${(legBonus / 100).toFixed(2)} imaginary value. Next order loaded.`, "good");
  }

  function winGame() {
    state.gameOver = true;
    state.running = false;
    if (saveSlot) saveSlot.clear();
    const finalScore = Math.round(state.score + state.heat * 13 + state.bag * 17 + state.tip * 155);
    state.score = finalScore;
    const high = api.recordScore(GAME_ID, finalScore);
    playDeliverySound();
    updateHUD();
    showOverlay(
      high ? "NO TIP NITRO LEGEND" : "DELIVERIES COMPLETE",
      "Five deliveries survived. The fries are warm enough to testify.",
      "Run it back",
      `Score: <strong>${finalScore.toLocaleString()}</strong> · Tip: <strong>${money(state.tip)}</strong> · ${high ? "<strong>New high score</strong>" : "High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>"}`
    );
  }

  function endGame(title, sub) {
    state.gameOver = true;
    state.running = false;
    if (saveSlot) saveSlot.clear();
    const finalScore = Math.round(state.score);
    const high = api.recordScore(GAME_ID, finalScore);
    playGameOverSound();
    updateHUD();
    showOverlay(
      title,
      sub,
      "Try again",
      `Score: <strong>${finalScore.toLocaleString()}</strong> · Tip: <strong>${money(state.tip)}</strong> · ${high ? "<strong>New high score</strong>" : "High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>"}`
    );
  }

  function currentRoute() {
    return ROUTES[state.delivery - 1] || ROUTES[ROUTES.length - 1];
  }

  function updateRouteChip() {
    const route = currentRoute();
    if (el.routeTitle) el.routeTitle.textContent = route.title;
    if (el.routeChip) {
      el.routeChip.textContent = route.airDrop ? `${route.text} Ramp into the floating marker to finish.` : route.text;
    }
  }

  function shortCue(text) {
    if (text.includes("nitro")) return "Nitro";
    if (text.includes("Tip") || text.includes("tip")) return "Tip";
    if (text.includes("Bag") || text.includes("bag")) return "Bag";
    if (text.includes("Customer") || text.includes("customer")) return "Patience";
    if (text.includes("Next")) return "Next drop";
    return "Watch it";
  }

  function updateHUD() {
    const route = currentRoute();
    const progress = clamp((state.distance / route.length) * 100, 0, 100);
    el.delivery.textContent = `${state.delivery}/${DELIVERIES_TO_WIN}`;
    el.heat.textContent = percent(state.heat);
    el.bag.textContent = percent(state.bag);
    el.tip.textContent = money(state.tip);
    el.streak.textContent = state.streak + "x";
    el.high.textContent = api.getHighScore(GAME_ID).toLocaleString();

    setMeter(el.meterRoute, el.meterRouteText, progress, "#2ee0ff");
    setMeter(el.meterNitro, el.meterNitroText, state.nitro, state.nitro > 32 ? "#ffd43b" : "#ff5c5c");
    setMeter(el.meterPatience, el.meterPatienceText, state.patience, state.patience > 35 ? "#6bff7d" : "#ff5c5c");

    el.heat.style.color = state.heat > 35 ? "var(--accent-3)" : "var(--bad)";
    el.bag.style.color = state.bag > 35 ? "var(--accent-2)" : "var(--bad)";
    el.tip.style.color = state.tip >= 5 ? "var(--good)" : "var(--accent-3)";
  }

  function setMeter(fill, text, value, color) {
    fill.style.width = clamp(value, 0, 100).toFixed(1) + "%";
    fill.style.backgroundColor = color;
    text.textContent = Math.round(clamp(value, 0, 100)) + "%";
  }

  function renderWorld(dt) {
    if (!world.renderer) return;
    const THREE = window.THREE;
    const shake = state.cameraShake > 0 && !state.reducedMotion ? state.cameraShake : 0;
    const boostLift = state.boostActive ? 0.55 : 0;
    const shakeX = shake ? Math.sin(world.clock * 48) * shake * 0.18 : 0;
    const shakeY = shake ? Math.cos(world.clock * 41) * shake * 0.12 : 0;

    world.camera.position.x = lerp(world.camera.position.x, state.carX * 0.32 + shakeX, Math.min(1, dt * 5));
    world.camera.position.y = lerp(world.camera.position.y, 5.9 + boostLift + shakeY, Math.min(1, dt * 4));
    world.camera.position.z = lerp(world.camera.position.z, state.boostActive ? 13.3 : 12.2, Math.min(1, dt * 4));
    world.camera.lookAt(state.carX * 0.18, 1.25 + state.carY * 0.25, -17);

    if (state.hitFlash > 0) {
      world.renderer.setClearColor(new THREE.Color().setRGB(0.12 + state.hitFlash * 0.28, 0.02, 0.05), 1);
    } else {
      world.renderer.setClearColor(0x05070d, 1);
    }

    const cyanPulse = state.reducedMotion ? 1 : 0.9 + Math.sin(world.clock * 2.4) * 0.1;
    const pinkPulse = state.reducedMotion ? 0.86 : 0.86 + Math.sin(world.clock * 2.8 + 1.2) * 0.08;
    const storefrontPulse = state.reducedMotion ? 0.72 : 0.72 + Math.sin(world.clock * 1.6) * 0.06;
    world.materials.awningCyan.emissiveIntensity = cyanPulse;
    world.materials.awningPink.emissiveIntensity = pinkPulse;
    world.materials.storefront.emissiveIntensity = storefrontPulse;

    world.renderer.render(world.scene, world.camera);
  }

  function clearObstacles() {
    world.obstacles.forEach((obstacle) => {
      world.scene.remove(obstacle);
      disposeObject(obstacle);
    });
    world.obstacles = [];
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
      if (child.userData && child.userData.disposeMaterial && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose && material.dispose());
      }
    });
  }

  function closestLane(x) {
    let best = 0;
    let bestDistance = Infinity;
    LANES.forEach((laneX, index) => {
      const distance = Math.abs(laneX - x);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  loadThree();
})();
