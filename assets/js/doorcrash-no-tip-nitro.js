/* ============================================================
   DoorCrash: No Tip Nitro
   3D food-delivery lane runner for Rainbot Gaming.
   Plain Three.js, no build step.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "doorcrash";
  const DELIVERIES_TO_WIN = 3;
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
    hitFlash: 0,
    cameraShake: 0,
    lastTime: 0,
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const world = {
    renderer: null,
    scene: null,
    camera: null,
    clock: 0,
    car: null,
    carWheels: [],
    roadLines: [],
    buildings: [],
    neonRails: [],
    obstacles: [],
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

    for (let i = 0; i < 18; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 7), i % 2 ? world.materials.pink : world.materials.cyan);
      rail.position.set(i % 2 ? -6.35 : 6.35, 0.18, -i * 9 + 9);
      scene.add(rail);
      world.neonRails.push(rail);
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
    for (let r = 0; r < rows; r++) {
      if (Math.random() < 0.24) continue;
      const win = new THREE.Mesh(new THREE.BoxGeometry(width * 0.56, 0.11, 0.035), windowMaterial);
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
    }

    return group;
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

    bindTap(el.left, () => changeLane(-1));
    bindTap(el.right, () => changeLane(1));
    bindTap(el.jump, jump);
    bindHold(el.boost, () => { state.boostHeld = true; }, () => { state.boostHeld = false; });
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
    clearObstacles();
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
      hitFlash: 0,
      cameraShake: 0,
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
    state.targetLane = clamp(state.targetLane + delta, 0, LANES.length - 1);
  }

  function jump() {
    if (!state.running || state.paused || state.gameOver) return;
    if (state.carY <= 0.04) {
      state.carVY = 8.6;
      state.carY = 0.03;
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
    updateSpawning(dt, difficulty);
    updateObstacles(dt);
    updateEvents(dt);
    updateDestination();
    updateHUD();

    if (state.heat <= 0) endGame("COLD FRIES INCIDENT", "The order achieved room temperature and became evidence.");
    else if (state.bag <= 0) endGame("BAG INTEGRITY FAILURE", "The soup saw freedom and took it.");
    else if (state.patience <= 0) endGame("CUSTOMER RAGE-QUIT", "They texted “nvm” with courtroom energy.");
    else if (state.distance >= route.length) finishDelivery();
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
    world.car.position.set(state.carX, state.carY, PLAYER_Z);
    world.car.rotation.z = lerp(world.car.rotation.z, -steer, Math.min(1, dt * 10));
    world.car.rotation.x = lerp(world.car.rotation.x, state.carY > 0 ? -0.16 : 0, Math.min(1, dt * 8));
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
    world.buildings.forEach((building) => {
      building.position.z += movement * 0.72;
      if (building.position.z > 24) {
        building.position.z -= 190;
        building.position.x = Math.sign(building.userData.baseX || building.position.x || 1) * rand(9.6, 15.5);
      }
    });
  }

  function updateSpawning(dt, difficulty) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = rand(0.92, 1.32) / difficulty;

    const safeLane = Math.floor(rand(0, LANES.length));
    const lanes = [0, 1, 2].filter((lane) => lane !== safeLane);
    const obstacleCount = Math.random() > 0.78 ? 2 : 1;
    lanes.sort(() => Math.random() - 0.5).slice(0, obstacleCount).forEach((lane, index) => {
      const type = pick(["cone", "pothole", "scooter", "sedan", "soda"]);
      spawnObstacle(type, lane, OBSTACLE_START_Z - index * rand(8, 13));
    });

    if (Math.random() > 0.48) {
      spawnObstacle("cash", safeLane, OBSTACLE_START_Z - rand(5, 14));
    }
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
      }

    if (!obstacle.userData.hit && Math.abs(obstacle.position.z - PLAYER_Z) < 1.2) {
        checkCollision(obstacle);
      }

      if (!obstacle.userData.passed && obstacle.position.z > PLAYER_Z + 2.2) {
        obstacle.userData.passed = true;
        if (!obstacle.userData.hit && obstacle.userData.type !== "cash") rewardNearMiss();
      }

      if (obstacle.position.z > OBSTACLE_END_Z) {
        world.scene.remove(obstacle);
        disposeObject(obstacle);
        world.obstacles.splice(i, 1);
      }
    }
  }

  function checkCollision(obstacle) {
    const laneDistance = Math.abs(obstacle.position.x - state.carX);
    if (laneDistance > 1.05) return;

    const type = obstacle.userData.type;
    if (type === "cash") {
      obstacle.userData.hit = true;
      collectCash(obstacle);
      return;
    }

    const config = OBSTACLE_TYPES[type];
    const jumped = config.jump && state.carY > 0.72;
    if (jumped) {
      rewardNearMiss(2);
      return;
    }

    obstacle.userData.hit = true;
    state.bag = clamp(state.bag - config.bag, 0, 100);
    state.heat = clamp(state.heat - config.heat, 0, 100);
    state.tip = Math.max(0, state.tip - config.tip);
    state.score = Math.max(0, state.score - config.score);
    state.streak = 0;
    state.comboTimer = 0;
    state.hitFlash = 0.38;
    state.cameraShake = 0.45;
    showEvent(config.label, "Bag damage. Tip confidence has left the chat.", "bad");
  }

  function collectCash(obstacle) {
    state.tip += 0.65 + state.streak * 0.04;
    state.nitro = clamp(state.nitro + 12, 0, 100);
    state.score += 280 + state.streak * 22;
    state.streak += 1;
    state.comboTimer = 3.5;
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
    const visible = progress > 0.72;
    world.destination.visible = visible;
    if (!visible) return;
    const t = (progress - 0.72) / 0.28;
    world.destination.position.set(0, 0.05, lerp(-96, -18, t));
    world.destination.rotation.y += 0.015 + (state.boostActive ? 0.02 : 0);
    world.destination.scale.setScalar(1 + Math.sin(world.clock * 4) * 0.035);
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
    clearObstacles();
    updateRouteChip();
    showEvent("Delivery complete", `+$${(legBonus / 100).toFixed(2)} imaginary value. Next order loaded.`, "good");
  }

  function winGame() {
    state.gameOver = true;
    state.running = false;
    const finalScore = Math.round(state.score + state.heat * 13 + state.bag * 17 + state.tip * 155);
    state.score = finalScore;
    const high = api.recordScore(GAME_ID, finalScore);
    updateHUD();
    showOverlay(
      high ? "NO TIP NITRO LEGEND" : "DELIVERIES COMPLETE",
      "Three deliveries survived. The fries are warm enough to testify.",
      "Run it back",
      `Score: <strong>${finalScore.toLocaleString()}</strong> · Tip: <strong>${money(state.tip)}</strong> · ${high ? "<strong>New high score</strong>" : "High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>"}`
    );
  }

  function endGame(title, sub) {
    state.gameOver = true;
    state.running = false;
    const finalScore = Math.round(state.score);
    const high = api.recordScore(GAME_ID, finalScore);
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
    if (el.routeChip) el.routeChip.textContent = route.text;
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

    world.renderer.render(world.scene, world.camera);
  }

  function clearObstacles() {
    world.obstacles.forEach((obstacle) => {
      world.scene.remove(obstacle);
      disposeObject(obstacle);
    });
    world.obstacles = [];
  }

  function disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
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
