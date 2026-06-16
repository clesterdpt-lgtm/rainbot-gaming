(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const THREE = window.THREE;

  if (!canvas || !THREE) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const DEBUG = params.has("debug");
  const VISUAL_TARGET = params.get("visual") === "target" || params.has("cinematic");
  const WORLD = { width: 260, height: 196 };
  const ROAD_X = [-106, -63, -18, 36, 93];
  const ROAD_Z = [-78, -41, 7, 52, 84];
  const ROAD_WIDTH = 8.2;
  const ROAD_HALF = ROAD_WIDTH / 2;
  const SIDEWALK_WIDTH = 2.25;
  const SIDEWALK_HALF = SIDEWALK_WIDTH / 2;
  const GAME_ID = "unhoused-and-unhinged";
  const SAVE_KEY = "rainbot-unhoused-topdown-high";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const choose = (items) => items[Math.floor(Math.random() * items.length)];
  const distSq = (a, b) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  };
  const len2 = (x, z) => Math.sqrt(x * x + z * z);
  const safeText = (text) => String(text).replace(/[^\w .,$:+!?/-]/g, "");

  const els = {
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlaySub: document.getElementById("overlay-sub"),
    overlayScore: document.getElementById("overlay-score"),
    primary: document.getElementById("btn-primary"),
    pause: document.getElementById("btn-pause"),
    restart: document.getElementById("btn-restart"),
    healthFill: document.getElementById("hud-health-fill"),
    healthText: document.getElementById("hud-health-text"),
    cashLarge: document.getElementById("hud-cash-large"),
    stars: document.getElementById("hud-stars"),
    wantedFill: document.getElementById("hud-wanted-fill"),
    chase: document.getElementById("hud-chase"),
    clock: document.getElementById("hud-clock"),
    phasePill: document.getElementById("hud-phase-pill"),
    objectiveText: document.getElementById("hud-objective-text"),
    objectiveArrow: document.getElementById("hud-objective-arrow"),
    miniPlayer: document.getElementById("hud-mini-player"),
    hotbar: document.getElementById("hud-hotbar"),
    hotbarSlots: null,
    bagOverlay: document.getElementById("bag-overlay"),
    bagGrid: document.getElementById("bag-grid"),
    bagActiveSlot: document.getElementById("bag-active-slot"),
    cityLog: document.getElementById("city-log"),
  };

  const ui = {
    setText(el, text) {
      if (el) {
        el.textContent = text;
      }
    },
    setHtml(el, html) {
      if (el) {
        el.innerHTML = html;
      }
    },
    setWidth(el, percent) {
      if (el) {
        el.style.width = `${clamp(percent, 0, 100).toFixed(1)}%`;
      }
    },
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x6ab1d0, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x78abc1, 145, 290);

  const camera = new THREE.OrthographicCamera(-40, 40, 25, -25, 0.1, 220);
  camera.up.set(0, 0, -1);

  const staticGroup = new THREE.Group();
  const actorGroup = new THREE.Group();
  const fxGroup = new THREE.Group();
  scene.add(staticGroup, actorGroup, fxGroup);

  const sun = new THREE.DirectionalLight(0xfff0cb, 1.18);
  sun.position.set(-40, 80, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  scene.add(sun);

  const ambient = new THREE.HemisphereLight(0xb8e2ef, 0x50412f, 0.62);
  scene.add(ambient);

  const nightLight = new THREE.PointLight(0x76ff85, 0, 75, 2);
  nightLight.position.set(0, 18, 0);
  scene.add(nightLight);

  const mats = {};
  function mat(name, color, roughness = 0.9, metalness = 0.02) {
    if (!mats[name]) {
      mats[name] = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
      });
    }
    return mats[name];
  }

  const materials = {
    asphalt: mat("asphalt", 0x2b3b46),
    asphaltDark: mat("asphaltDark", 0x2b3b46),
    lane: mat("lane", 0xf1cf59),
    curb: mat("curb", 0xb5b9aa),
    crosswalk: mat("crosswalk", 0x75868d),
    concrete: mat("concrete", 0x7e9aa1),
    concreteLight: mat("concreteLight", 0x848d92),
    sidewalk: mat("sidewalk", 0x9ea8a6),
    sidewalkWarm: mat("sidewalkWarm", 0x9f8569),
    sidewalkCool: mat("sidewalkCool", 0x6da4b4),
    sidewalkRose: mat("sidewalkRose", 0xae718f),
    sidewalkMint: mat("sidewalkMint", 0x6fa873),
    plazaGold: mat("plazaGold", 0xb99a35),
    park: mat("park", 0x43a65d),
    parkDark: mat("parkDark", 0x1f7449),
    dirt: mat("dirt", 0xbb7543),
    brick: mat("brick", 0xa84e44),
    tanWall: mat("tanWall", 0xc6804e),
    blueWall: mat("blueWall", 0x2e78a5),
    purpleWall: mat("purpleWall", 0x8351a1),
    roof: mat("roof", 0x353247),
    roofWarm: mat("roofWarm", 0x724553),
    roofCool: mat("roofCool", 0x2d5b78),
    roofGold: mat("roofGold", 0x8a6432),
    glass: mat("glass", 0x76d4e0, 0.45, 0.05),
    player: mat("player", 0x315f36),
    playerHead: mat("playerHead", 0xc28f65),
    playerCap: mat("playerCap", 0x1a1d21),
    playerPants: mat("playerPants", 0x1f405b),
    cardboard: mat("cardboard", 0xbf8f54),
    civilian: mat("civilian", 0xd1a856),
    civilian2: mat("civilian2", 0x7a84bb),
    cop: mat("cop", 0x1f365a),
    copBlue: mat("copBlue", 0x1b7cff),
    copRed: mat("copRed", 0xff3131),
    zombie: mat("zombie", 0x8aff6a),
    zombieDark: mat("zombieDark", 0x425d40),
    haze: mat("haze", 0x6dff83, 0.5, 0),
    yellow: mat("yellow", 0xf3c447),
    orange: mat("orange", 0xe77732),
    red: mat("red", 0xba3434),
    white: mat("white", 0xf5efe3),
    black: mat("black", 0x161719),
    pole: mat("pole", 0x49545b, 0.58, 0.1),
    trash: mat("trash", 0x2c3334),
    binBlue: mat("binBlue", 0x2b6985),
    binGreen: mat("binGreen", 0x377b50),
    newsRed: mat("newsRed", 0xb9413b),
    newsBlue: mat("newsBlue", 0x3973aa),
    water: mat("water", 0x35a7df, 0.45, 0.04),
    food: mat("food", 0xd78936),
    cash: mat("cash", 0x49c968),
    scrap: mat("scrap", 0xaab0b4, 0.35, 0.15),
    peel: mat("peel", 0xf5d431),
    cone: mat("cone", 0xff6d28),
    plunger: mat("plunger", 0x863333),
    safe: mat("safe", 0x65d77b),
  };

  const blockerRects = [];
  const staticMeshes = [];
  function buildTrafficLanes() {
    const horizontalSpeeds = [10, -8.4, 9.6, -10.2, 8.2];
    const verticalSpeeds = [-8.8, 9.4, -7.8, 10.4, -9.6];
    const xMin = -WORLD.width / 2 + 7;
    const xMax = WORLD.width / 2 - 7;
    const zMin = -WORLD.height / 2 + 7;
    const zMax = WORLD.height / 2 - 7;
    return ROAD_Z.map((z, index) => ({
      axis: "x",
      z,
      min: xMin,
      max: xMax,
      speed: horizontalSpeeds[index % horizontalSpeeds.length],
    })).concat(ROAD_X.map((x, index) => ({
      axis: "z",
      x,
      min: zMin,
      max: zMax,
      speed: verticalSpeeds[index % verticalSpeeds.length],
    })));
  }

  const lanes = buildTrafficLanes();
  const vehicleTypes = [
    {
      id: "compact",
      color: 0x4f8a64,
      length: 3.8,
      width: 2.0,
      bodyHeight: 0.78,
      cabinLength: 1.55,
      cabinWidth: 1.35,
      cabinHeight: 0.55,
      speedScale: 1.16,
      accel: 5.2,
      brake: 12,
      stopDistance: 7.4,
      priority: 1,
    },
    {
      id: "sedan",
      color: 0x385f8f,
      length: 4.7,
      width: 2.25,
      bodyHeight: 0.9,
      cabinLength: 2.35,
      cabinWidth: 1.55,
      cabinHeight: 0.68,
      speedScale: 1.02,
      accel: 4.4,
      brake: 10.5,
      stopDistance: 8.2,
      priority: 2,
    },
    {
      id: "taxi",
      color: 0xe2c052,
      length: 4.55,
      width: 2.2,
      bodyHeight: 0.88,
      cabinLength: 2.15,
      cabinWidth: 1.5,
      cabinHeight: 0.65,
      roofSign: true,
      speedScale: 1.05,
      accel: 4.6,
      brake: 10.8,
      stopDistance: 8,
      priority: 2,
    },
    {
      id: "pickup",
      color: 0xb7443f,
      length: 5.25,
      width: 2.35,
      bodyHeight: 0.95,
      cabinLength: 1.85,
      cabinWidth: 1.6,
      cabinHeight: 0.72,
      bed: true,
      speedScale: 0.94,
      accel: 3.8,
      brake: 9.5,
      stopDistance: 9,
      priority: 3,
    },
    {
      id: "van",
      color: 0xdcd6c7,
      length: 5.65,
      width: 2.45,
      bodyHeight: 1.15,
      cabinLength: 3.65,
      cabinWidth: 1.9,
      cabinHeight: 0.82,
      speedScale: 0.84,
      accel: 3.2,
      brake: 8.6,
      stopDistance: 9.8,
      priority: 3,
    },
    {
      id: "box-truck",
      color: 0x9b7a55,
      length: 6.65,
      width: 2.6,
      bodyHeight: 1.05,
      cabinLength: 1.65,
      cabinWidth: 1.8,
      cabinHeight: 0.76,
      cargoLength: 3.85,
      cargoHeight: 1.25,
      cargo: true,
      speedScale: 0.68,
      accel: 2.5,
      brake: 7.6,
      stopDistance: 11.2,
      priority: 4,
    },
  ];
  const sidewalkStrips = buildSidewalkStrips();

  const districts = [
    {
      name: "Busk Park",
      trait: "tips up, heat up",
      x: -84,
      z: -60,
      w: 34,
      h: 28,
      color: 0x69bf5f,
      tip: 1.35,
      heat: 1.18,
    },
    {
      name: "Camp Row",
      trait: "recover and craft",
      x: -118,
      z: 68,
      w: 22,
      h: 29,
      color: 0xd08a53,
      tip: 0.75,
      heat: 0.72,
    },
    {
      name: "Pawn Alley",
      trait: "scrap and tools",
      x: 64,
      z: -18,
      w: 39,
      h: 27,
      color: 0x9d63c7,
      tip: 0.95,
      heat: 1.05,
    },
    {
      name: "Tweeker Alley",
      trait: "night spawns",
      x: 112,
      z: 68,
      w: 25,
      h: 27,
      color: 0x497e68,
      tip: 0.8,
      heat: 1.0,
    },
    {
      name: "Crosswalk Circus",
      trait: "stunts pay",
      x: 9,
      z: 30,
      w: 40,
      h: 30,
      color: 0xe0bc5b,
      tip: 1.15,
      heat: 1.25,
    },
    {
      name: "Coupon Canyon",
      trait: "cheap supplies",
      x: 112,
      z: -60,
      w: 25,
      h: 28,
      color: 0x5ea1be,
      tip: 1.05,
      heat: 0.92,
    },
    {
      name: "Underpass Loop",
      trait: "low heat",
      x: -40,
      z: 68,
      w: 36,
      h: 27,
      color: 0x658276,
      tip: 0.85,
      heat: 0.65,
    },
  ];

  const points = {
    start: { x: 2, z: 40 },
    camp: { x: -118, z: 68 },
    kiosk: { x: 101, z: -48 },
    park: { x: -84, z: -60 },
    busk: { x: 9, z: 30 },
    alley: { x: 112, z: 68 },
    fountain: { x: -84, z: -89 },
    cache: { x: 80, z: -8 },
  };

  const keys = Object.create(null);
  const mobileMove = { x: 0, z: 0 };
  const clock = new THREE.Clock();

  // ----------------------------------------------------------------------------
  // Items: collectible props that flavor the two action buttons. The hotbar's
  // active item drives BOTH buttons — ACT (earn money) runs its `earn` behavior,
  // ATTACK runs its `attack` behavior. A missing behavior falls back to the
  // bare-hands default (`fists`). Consumables (cone, peel) track a count in
  // state.inventory; everything else is owned once you pick it up.
  // ----------------------------------------------------------------------------
  const ITEMS = {
    fists: {
      id: "fists", name: "Street Moves", short: "Dance", starter: true,
      earn: { cash: [1.4, 2.6], cool: 0.5, wanted: 1.2, label: "dance" },
      attack: { kind: "melee", dmg: 1.2, range: 3.6, cool: 0.42, label: "slap" },
    },
    cone: {
      id: "cone", name: "Traffic Cone", short: "Cone", count: "cone", cap: 9, start: 5, refill: 3, starter: true,
      earn: { cash: [2.4, 4.0], cool: 0.6, wanted: 1.8, label: "cone hat" },
      attack: { kind: "throw", dmg: 2, range: 27, cool: 0.6, label: "cone toss" },
    },
    plunger: {
      id: "plunger", name: "Trusty Plunger", short: "Plunger", starter: true,
      earn: { cash: [1.0, 1.8], cool: 0.55, wanted: 1.0, label: "plunger gag" },
      attack: { kind: "melee", dmg: 2.4, range: 4.6, cool: 0.4, label: "plunger bonk" },
    },
    peel: {
      id: "peel", name: "Banana Peels", short: "Peel", count: "peel", cap: 6, start: 2, refill: 2, starter: true,
      earn: { cash: [1.6, 2.6], cool: 0.6, wanted: 1.4, label: "juggle" },
      attack: { kind: "trap", cool: 0.45, label: "peel drop" },
    },
    boombox: {
      id: "boombox", name: "Trash Boombox", short: "Boombox",
      earn: { cash: [3.2, 5.2], cool: 0.72, wanted: 3.4, crowd: 2.0, label: "block party" },
      attack: { kind: "melee", dmg: 1.0, range: 5.4, cool: 0.5, stun: 0.8, label: "bass blast" },
    },
    sign: {
      id: "sign", name: "Cardboard Sign", short: "Sign",
      earn: { cash: [1.8, 2.8], cool: 0.5, wanted: 0.7, label: "beg" },
      attack: { kind: "melee", dmg: 0.9, range: 3.4, cool: 0.5, label: "sign smack" },
    },
    chicken: {
      id: "chicken", name: "Rubber Chicken", short: "Chicken",
      earn: { cash: [2.2, 3.8], cool: 0.6, wanted: 2.2, label: "comedy bit" },
      attack: { kind: "melee", dmg: 1.0, range: 3.8, cool: 0.4, confuse: true, label: "squeak" },
    },
  };
  const STARTER_HOTBAR = ["fists", "cone", "plunger", "peel"];
  let cameraTarget = new THREE.Vector3(0, 0, 0);
  let labelCounter = 0;

  const state = {
    running: false,
    paused: false,
    ended: false,
    phase: "day",
    cycle: 1,
    phaseTime: 0,
    dayLength: DEBUG ? 24 : 96,
    nightLength: DEBUG ? 26 : 74,
    cash: 7.25,
    wanted: 8,
    arrest: 0,
    health: 100,
    maxHealth: 100,
    score: 0,
    high: Number(localStorage.getItem(SAVE_KEY) || 0),
    bag: {},
    hotbar: STARTER_HOTBAR.slice(),
    activeSlot: 0,
    actStreak: 0,
    actStreakTime: 0,
    bagOpen: false,
    inventory: {
      cone: 5,
      peel: 2,
    },
    tasks: {
      buskCash: 0,
    },
    cooldowns: {
      act: 0,
      attack: 0,
      hurt: 0,
      log: 0,
    },
    district: districts[4],
    waveTarget: 8,
    waveKills: 0,
    objective: "Earn $20 before nightfall",
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  const player = {
    x: points.start.x,
    z: points.start.z,
    y: 0,
    radius: 1.1,
    speed: 12,
    facing: { x: 0, z: -1 },
    mesh: null,
    stun: 0,
  };

  const civilians = [];
  const cops = [];
  const zombies = [];
  const cars = [];
  const pickups = [];
  const projectiles = [];
  const peels = [];
  const floaters = [];
  const pulses = [];

  function makeMesh(geo, material, x = 0, y = 0, z = 0, cast = true, receive = true) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  function addBox(parent, w, h, d, x, y, z, material, blocker = false) {
    const mesh = makeMesh(new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z);
    parent.add(mesh);
    staticMeshes.push(mesh);
    if (blocker) {
      blockerRects.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        pad: 0.35,
      });
    }
    return mesh;
  }

  function addFlat(parent, w, d, x, z, material, y = 0.012) {
    const mesh = makeMesh(new THREE.BoxGeometry(w, 0.04, d), material, x, y, z, false, true);
    parent.add(mesh);
    return mesh;
  }

  function addFlatRotated(parent, w, d, x, z, material, y = 0.012, rotation = 0) {
    const mesh = addFlat(parent, w, d, x, z, material, y);
    mesh.rotation.y = rotation;
    return mesh;
  }

  function getRoadRects() {
    const vertical = ROAD_X.map((x) => ({
      minX: x - ROAD_HALF,
      maxX: x + ROAD_HALF,
      minZ: -WORLD.height / 2,
      maxZ: WORLD.height / 2,
    }));
    const horizontal = ROAD_Z.map((z) => ({
      minX: -WORLD.width / 2,
      maxX: WORLD.width / 2,
      minZ: z - ROAD_HALF,
      maxZ: z + ROAD_HALF,
    }));
    return vertical.concat(horizontal);
  }

  function rectsOverlap(a, b) {
    return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ);
  }

  function rectOverlapsRoads(x, z, w, d, pad = 0) {
    const rect = {
      minX: x - w / 2 - pad,
      maxX: x + w / 2 + pad,
      minZ: z - d / 2 - pad,
      maxZ: z + d / 2 + pad,
    };
    return getRoadRects().some((road) => rectsOverlap(rect, road));
  }

  function pointNearRoad(x, z, pad = 0) {
    return getRoadRects().some((road) => (
      x >= road.minX - pad &&
      x <= road.maxX + pad &&
      z >= road.minZ - pad &&
      z <= road.maxZ + pad
    ));
  }

  function axisSidewalkSegments(crossings, min, max) {
    const gapHalf = ROAD_HALF + 1.2;
    const segments = [];
    let start = min;
    crossings.forEach((crossing) => {
      const end = crossing - gapHalf;
      if (end - start > 3.2) {
        segments.push({ min: start, max: end });
      }
      start = crossing + gapHalf;
    });
    if (max - start > 3.2) {
      segments.push({ min: start, max });
    }
    return segments;
  }

  function buildSidewalkStrips() {
    const strips = [];
    const offset = ROAD_HALF + SIDEWALK_HALF + 0.42;
    const xSegments = axisSidewalkSegments(ROAD_X, -WORLD.width / 2 + 4, WORLD.width / 2 - 4);
    const zSegments = axisSidewalkSegments(ROAD_Z, -WORLD.height / 2 + 4, WORLD.height / 2 - 4);
    ROAD_X.forEach((roadX, roadIndex) => {
      [-1, 1].forEach((side) => {
        strips.push({
          kind: "vertical",
          axis: "z",
          roadIndex,
          side,
          fixed: roadX + side * offset,
          segments: zSegments,
        });
      });
    });
    ROAD_Z.forEach((roadZ, roadIndex) => {
      [-1, 1].forEach((side) => {
        strips.push({
          kind: "horizontal",
          axis: "x",
          roadIndex,
          side,
          fixed: roadZ + side * offset,
          segments: xSegments,
        });
      });
    });
    return strips;
  }

  function sidewalkValue(strip, x, z) {
    return strip.axis === "z" ? z : x;
  }

  function sidewalkPoint(strip, segment, value) {
    const v = clamp(value, segment.min + 0.8, segment.max - 0.8);
    const jitter = rand(-0.28, 0.28);
    if (strip.axis === "z") {
      return { x: strip.fixed + jitter, z: v };
    }
    return { x: v, z: strip.fixed + jitter };
  }

  function sidewalkSegmentForValue(strip, value) {
    return strip.segments.reduce((best, segment) => {
      const distance = value < segment.min ? segment.min - value : value > segment.max ? value - segment.max : 0;
      return !best || distance < best.distance ? { segment, distance } : best;
    }, null)?.segment || strip.segments[0];
  }

  function nearestSidewalk(x, z) {
    return sidewalkStrips.reduce((best, strip) => {
      const value = sidewalkValue(strip, x, z);
      const segment = sidewalkSegmentForValue(strip, value);
      const lateral = strip.axis === "z" ? Math.abs(x - strip.fixed) : Math.abs(z - strip.fixed);
      const clipped = clamp(value, segment.min, segment.max);
      const along = Math.abs(value - clipped);
      const score = lateral * 1.8 + along;
      return !best || score < best.score ? { strip, segment, value: clipped, score } : best;
    }, null);
  }

  function oppositeSidewalk(strip) {
    return sidewalkStrips.find((candidate) => (
      candidate.kind === strip.kind &&
      candidate.roadIndex === strip.roadIndex &&
      candidate.side === -strip.side
    )) || strip;
  }

  function randomSidewalkPoint(radius = 0.85) {
    for (let i = 0; i < 80; i += 1) {
      const strip = choose(sidewalkStrips);
      const segment = choose(strip.segments);
      const point = sidewalkPoint(strip, segment, rand(segment.min + 1, segment.max - 1));
      if (isWalkable(point.x, point.z, radius)) {
        return { ...point, strip, segment };
      }
    }
    const fallback = getOpenPoint();
    const nearest = nearestSidewalk(fallback.x, fallback.z);
    return { ...fallback, strip: nearest.strip, segment: nearest.segment };
  }

  function assignCivilianTarget(civilian, forceCross = false) {
    const current = civilian.sidewalk ? {
      strip: civilian.sidewalk,
      segment: sidewalkSegmentForValue(civilian.sidewalk, sidewalkValue(civilian.sidewalk, civilian.x, civilian.z)),
      value: sidewalkValue(civilian.sidewalk, civilian.x, civilian.z),
    } : nearestSidewalk(civilian.x, civilian.z);
    const crossing = forceCross || Math.random() < 0.04;
    for (let i = 0; i < 18; i += 1) {
      const targetStrip = crossing ? oppositeSidewalk(current.strip) : current.strip;
      const targetSegment = current.segment;
      const currentValue = clamp(current.value, targetSegment.min + 1, targetSegment.max - 1);
      const targetValue = crossing
        ? currentValue + rand(-2.1, 2.1)
        : currentValue + choose([-1, 1]) * rand(5, 17);
      const value = crossing ? targetValue : clamp(targetValue, targetSegment.min + 1, targetSegment.max - 1);
      const point = sidewalkPoint(targetStrip, targetSegment, value);
      if (isWalkable(point.x, point.z, civilian.radius)) {
        civilian.target = point;
        civilian.sidewalkTarget = targetStrip;
        civilian.sidewalkTargetSegment = targetSegment;
        civilian.crossing = crossing;
        civilian.timer = crossing ? rand(2.2, 3.6) : rand(2.8, 6.4);
        return;
      }
    }
    const fallback = randomSidewalkPoint(civilian.radius);
    civilian.target = fallback;
    civilian.sidewalkTarget = fallback.strip;
    civilian.sidewalkTargetSegment = fallback.segment;
    civilian.crossing = false;
        civilian.timer = rand(2.8, 6.4);
  }

  function nearIntersection(value, crossings, margin = ROAD_HALF + 4.2) {
    return crossings.some((crossing) => Math.abs(value - crossing) <= margin);
  }

  function addSidewalkGrid() {
    ROAD_X.forEach((x) => {
      addFlat(staticGroup, SIDEWALK_WIDTH, WORLD.height, x - ROAD_HALF - SIDEWALK_HALF - 0.42, 0, materials.sidewalk, 0.055);
      addFlat(staticGroup, SIDEWALK_WIDTH, WORLD.height, x + ROAD_HALF + SIDEWALK_HALF + 0.42, 0, materials.sidewalk, 0.055);
    });
    ROAD_Z.forEach((z) => {
      addFlat(staticGroup, WORLD.width, SIDEWALK_WIDTH, 0, z - ROAD_HALF - SIDEWALK_HALF - 0.42, materials.sidewalk, 0.056);
      addFlat(staticGroup, WORLD.width, SIDEWALK_WIDTH, 0, z + ROAD_HALF + SIDEWALK_HALF + 0.42, materials.sidewalk, 0.056);
    });
  }

  function addLaneDashes() {
    const dashLength = 4.8;
    const gap = 5.4;
    const startZ = -WORLD.height / 2 + 5.4;
    const endZ = WORLD.height / 2 - 5.4;
    const startX = -WORLD.width / 2 + 6;
    const endX = WORLD.width / 2 - 6;

    ROAD_X.forEach((x) => {
      for (let z = startZ; z <= endZ; z += dashLength + gap) {
        if (!nearIntersection(z, ROAD_Z)) {
          addFlat(staticGroup, 0.22, dashLength, x, z, materials.lane, 0.185);
        }
      }
    });

    ROAD_Z.forEach((z) => {
      for (let x = startX; x <= endX; x += dashLength + gap) {
        if (!nearIntersection(x, ROAD_X)) {
          addFlat(staticGroup, dashLength, 0.22, x, z, materials.lane, 0.19);
        }
      }
    });
  }

  function addVerticalSegments(x, width, material, y, gapHalf = ROAD_HALF + 0.9) {
    let start = -WORLD.height / 2;
    ROAD_Z.forEach((z) => {
      const end = z - gapHalf;
      if (end > start) {
        addFlat(staticGroup, width, end - start, x, (start + end) / 2, material, y);
      }
      start = z + gapHalf;
    });
    const end = WORLD.height / 2;
    if (end > start) {
      addFlat(staticGroup, width, end - start, x, (start + end) / 2, material, y);
    }
  }

  function addHorizontalSegments(z, height, material, y, gapHalf = ROAD_HALF + 0.9) {
    let start = -WORLD.width / 2;
    ROAD_X.forEach((x) => {
      const end = x - gapHalf;
      if (end > start) {
        addFlat(staticGroup, end - start, height, (start + end) / 2, z, material, y);
      }
      start = x + gapHalf;
    });
    const end = WORLD.width / 2;
    if (end > start) {
      addFlat(staticGroup, end - start, height, (start + end) / 2, z, material, y);
    }
  }

  function addRoadGrid() {
    ROAD_X.forEach((x) => {
      addFlat(staticGroup, ROAD_WIDTH, WORLD.height, x, 0, materials.asphalt, 0.08);
      addVerticalSegments(x - ROAD_HALF - 0.2, 0.32, materials.curb, 0.16);
      addVerticalSegments(x + ROAD_HALF + 0.2, 0.32, materials.curb, 0.16);
    });
    ROAD_Z.forEach((z) => {
      addFlat(staticGroup, WORLD.width, ROAD_WIDTH, 0, z, materials.asphaltDark, 0.09);
      addHorizontalSegments(z - ROAD_HALF - 0.2, 0.32, materials.curb, 0.16);
      addHorizontalSegments(z + ROAD_HALF + 0.2, 0.32, materials.curb, 0.16);
    });
    addLaneDashes();
    ROAD_X.forEach((x) => {
      ROAD_Z.forEach((z) => addCrosswalk(x, z));
    });
  }

  function addCrosswalk(x, z) {
    [-1, 1].forEach((dir) => {
      addFlat(staticGroup, ROAD_WIDTH - 1.2, 0.14, x, z + dir * (ROAD_HALF + 1.05), materials.crosswalk, 0.195);
      addFlat(staticGroup, 0.14, ROAD_WIDTH - 1.2, x + dir * (ROAD_HALF + 1.05), z, materials.crosswalk, 0.195);
    });
  }

  function addConeProp(x, z) {
    if (pointNearRoad(x, z, 1.1)) {
      return false;
    }
    addCylinder(staticGroup, 0.26, 0.6, x, 0, z, materials.cone, 8);
    return true;
  }

  function addCityBuilding({ w, h, d, x, z, wall, roof = materials.roof, label = "", labelColor = "#ffe07a" }) {
    if (rectOverlapsRoads(x, z, w, d, 0.35)) {
      return null;
    }
    const building = addBox(staticGroup, w, h, d, x, 0, z, wall, true);
    addBox(staticGroup, w + 0.65, 0.32, d + 0.65, x, h, z, roof, false);
    addBox(staticGroup, Math.max(2, w * 0.3), 0.26, Math.max(1.6, d * 0.28), x - w * 0.18, h + 0.32, z - d * 0.12, materials.glass, false);
    if (label) {
      addWindowRows(x, z, w, d, 4, 2);
      addBuildingRoofSign(label, x, z, w, d, h, labelColor);
    }
    return building;
  }

  function addLotPatch({ w, d, x, z, material, y = 0.038, rotation = 0 }) {
    if (rectOverlapsRoads(x, z, w, d, 0.45)) {
      return null;
    }
    return addFlatRotated(staticGroup, w, d, x, z, material, y, rotation);
  }

  function addServiceLane({ w, d, x, z, rotation = 0 }) {
    return addLotPatch({ w, d, x, z, material: materials.asphaltDark, y: 0.052, rotation });
  }

  function addCylinder(parent, radius, height, x, y, z, material, sides = 10) {
    const mesh = makeMesh(new THREE.CylinderGeometry(radius, radius, height, sides), material, x, y + height / 2, z);
    parent.add(mesh);
    return mesh;
  }

  function addCone(parent, radius, height, x, y, z, material, sides = 10) {
    const mesh = makeMesh(new THREE.ConeGeometry(radius, height, sides), material, x, y + height / 2, z);
    parent.add(mesh);
    return mesh;
  }

  function makeTextTexture(text, color = "#ffffff", bg = "rgba(0,0,0,0.6)") {
    const canvas2 = document.createElement("canvas");
    canvas2.width = 512;
    canvas2.height = 128;
    const ctx = canvas2.getContext("2d");
    ctx.clearRect(0, 0, canvas2.width, canvas2.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas2.width, canvas2.height);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, canvas2.width - 6, canvas2.height - 6);
    ctx.font = "700 42px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 6;
    ctx.fillText(safeText(text), canvas2.width / 2, canvas2.height / 2 + 3);
    const texture = new THREE.CanvasTexture(canvas2);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function makeRoofSignTexture(text, color = "#ffe07a") {
    const canvas2 = document.createElement("canvas");
    canvas2.width = 768;
    canvas2.height = 192;
    const ctx = canvas2.getContext("2d");
    ctx.clearRect(0, 0, canvas2.width, canvas2.height);
    ctx.fillStyle = "rgba(24,22,20,0.9)";
    ctx.fillRect(0, 0, canvas2.width, canvas2.height);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, canvas2.width - 12, canvas2.height - 12);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(20, 20, canvas2.width - 40, canvas2.height - 40);
    ctx.font = "800 48px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 8;
    ctx.fillText(safeText(text), canvas2.width / 2, canvas2.height / 2 + 3, canvas2.width - 72);
    const texture = new THREE.CanvasTexture(canvas2);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function addBuildingRoofSign(text, x, z, w, d, h, color = "#ffe07a") {
    const signW = clamp(w * 0.68, 7.2, Math.max(8, w - 2.4));
    const signD = clamp(d * 0.26, 2.2, 3.6);
    const material = new THREE.MeshBasicMaterial({
      map: makeRoofSignTexture(text, color),
      transparent: true,
      depthWrite: false,
    });
    const sign = makeMesh(new THREE.PlaneGeometry(signW, signD), material, x, h + 0.5, z - d * 0.08, false, false);
    sign.rotation.x = -Math.PI / 2;
    staticGroup.add(sign);
    return sign;
  }

  function addLabel(text, x, z, color = "#ffffff", bg = "rgba(0,0,0,0.55)", scale = 7.5) {
    const material = new THREE.SpriteMaterial({
      map: makeTextTexture(text, color, bg),
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, 5.2 + labelCounter * 0.005, z);
    sprite.scale.set(scale, scale * 0.25, 1);
    labelCounter += 1;
    staticGroup.add(sprite);
    return sprite;
  }

  function addFloater(text, x, z, color = "#ffffff") {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeTextTexture(text, color, "rgba(25,24,22,0.72)"),
        transparent: true,
        depthWrite: false,
      })
    );
    sprite.position.set(x, 4.8, z);
    sprite.scale.set(7, 1.75, 1);
    fxGroup.add(sprite);
    floaters.push({ mesh: sprite, life: 1.1, maxLife: 1.1 });
  }

  function addPulse(x, z, color, radius, life) {
    const mesh = makeMesh(
      new THREE.RingGeometry(radius * 0.45, radius, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      x,
      0.12,
      z,
      false,
      false
    );
    mesh.rotation.x = -Math.PI / 2;
    fxGroup.add(mesh);
    pulses.push({ mesh, life, maxLife: life });
  }

  function addWindowRows(x, z, w, d, cols, rows) {
    const matGlass = materials.glass;
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const px = x - w / 2 + 1.2 + i * ((w - 2.4) / Math.max(1, cols - 1));
        const pz = z - d / 2 - 0.035;
        const pane = makeMesh(new THREE.BoxGeometry(1.1, 0.7, 0.08), matGlass, px, 1.8 + j * 1.2, pz, false, false);
        staticGroup.add(pane);
      }
    }
  }

  function buildWorld() {
    staticGroup.clear();
    blockerRects.length = 0;
    staticMeshes.length = 0;
    labelCounter = 0;

    addFlat(staticGroup, WORLD.width, WORLD.height, 0, 0, materials.concreteLight, 0);

    addSidewalkGrid();
    addRoadGrid();

    addFlat(staticGroup, WORLD.width, 1.2, 0, -WORLD.height / 2 + 0.6, materials.curb, 0.18);
    addFlat(staticGroup, WORLD.width, 1.2, 0, WORLD.height / 2 - 0.6, materials.curb, 0.18);
    addFlat(staticGroup, 1.2, WORLD.height, -WORLD.width / 2 + 0.6, 0, materials.curb, 0.18);
    addFlat(staticGroup, 1.2, WORLD.height, WORLD.width / 2 - 0.6, 0, materials.curb, 0.18);

    [
      { w: 15, h: 6.2, d: 9, x: -119, z: -89, wall: materials.brick, roof: materials.roofWarm, label: "HOT PLATE" },
      { w: 25, h: 7.5, d: 8, x: -40, z: -90, wall: materials.tanWall, roof: materials.roofGold, label: "ODD JOBS" },
      { w: 25, h: 6.5, d: 9, x: 9, z: -89, wall: materials.blueWall, roof: materials.roofCool, label: "DONUT-ish", labelColor: "#ffe0a8" },
      { w: 30, h: 7.8, d: 8, x: 64, z: -89, wall: materials.purpleWall, roof: materials.roofWarm, label: "LAUNDRO-MATIC", labelColor: "#d4f6ff" },
      { w: 20, h: 6.8, d: 8, x: 112, z: -90, wall: materials.tanWall, roof: materials.roofGold, label: "MINI MART" },
      { w: 22, h: 6.8, d: 16, x: -40, z: -60, wall: materials.blueWall, roof: materials.roofCool, label: "RECYCLE 4 CASH", labelColor: "#bfffd0" },
      { w: 24, h: 7, d: 16, x: 9, z: -60, wall: materials.tanWall, roof: materials.roofGold },
      { w: 28, h: 7.5, d: 15, x: 64, z: -60, wall: materials.brick, roof: materials.roofWarm, label: "TACO MAYBE" },
      { w: 20, h: 6.5, d: 16, x: 112, z: -60, wall: materials.blueWall, roof: materials.roofCool, label: "COUPON CANYON", labelColor: "#d4f6ff" },
      { w: 15, h: 7.5, d: 20, x: -119, z: -18, wall: materials.purpleWall, roof: materials.roofWarm, label: "HOTEL NOPE", labelColor: "#ffd1ff" },
      { w: 22, h: 5.8, d: 18, x: -84, z: -18, wall: materials.tanWall, roof: materials.roofGold },
      { w: 24, h: 7.2, d: 17, x: -40, z: -18, wall: materials.brick, roof: materials.roofWarm },
      { w: 30, h: 7.2, d: 17, x: 64, z: -18, wall: materials.purpleWall, roof: materials.roofWarm, label: "PAWN & PLUNGERS", labelColor: "#ffd1ff" },
      { w: 20, h: 6.6, d: 18, x: 112, z: -18, wall: materials.tanWall, roof: materials.roofGold, label: "STAY WASHED", labelColor: "#8de9ff" },
      { w: 16, h: 6.1, d: 18, x: -119, z: 30, wall: materials.blueWall, roof: materials.roofCool, label: "SOUP WINDOW", labelColor: "#d4f6ff" },
      { w: 23, h: 6.7, d: 18, x: -40, z: 30, wall: materials.tanWall, roof: materials.roofGold },
      { w: 30, h: 7.7, d: 18, x: 64, z: 30, wall: materials.brick, roof: materials.roofWarm, label: "BUS DEPOT" },
      { w: 20, h: 6.8, d: 18, x: 112, z: 30, wall: materials.purpleWall, roof: materials.roofWarm, label: "BODEGA++", labelColor: "#ffd1ff" },
      { w: 20, h: 6.6, d: 14, x: -84, z: 68, wall: materials.blueWall, roof: materials.roofCool, label: "SHELTER HQ", labelColor: "#d4f6ff" },
      { w: 25, h: 6.4, d: 14, x: 9, z: 68, wall: materials.tanWall, roof: materials.roofGold, label: "SIGN COURT" },
      { w: 28, h: 6.9, d: 14, x: 64, z: 68, wall: materials.brick, roof: materials.roofWarm, label: "CASH 4 CONES" },
      { w: 16, h: 5.6, d: 7, x: -119, z: 92, wall: materials.tanWall, roof: materials.roofGold },
      { w: 20, h: 5.9, d: 7, x: -40, z: 92, wall: materials.brick, roof: materials.roofWarm },
      { w: 22, h: 6.1, d: 7, x: 64, z: 92, wall: materials.blueWall, roof: materials.roofCool },
      { w: 17, h: 5.8, d: 7, x: 112, z: 92, wall: materials.purpleWall, roof: materials.roofWarm },
    ].forEach((building) => addCityBuilding(building));

    [
      { w: 15, d: 10, x: points.park.x - 5, z: points.park.z - 3, material: materials.park },
      { w: 10, d: 9, x: points.park.x + 8, z: points.park.z + 5, material: materials.parkDark },
      { w: 16, d: 12, x: points.camp.x, z: points.camp.z, material: materials.dirt },
      { w: 5.5, d: 3.2, x: points.busk.x, z: points.busk.z, material: materials.sidewalkWarm },
      { w: 12, d: 9, x: points.alley.x, z: points.alley.z, material: materials.parkDark },
      { w: 11, d: 8, x: points.cache.x, z: points.cache.z + 8, material: materials.sidewalkWarm },
      { w: 8, d: 7, x: points.fountain.x, z: points.fountain.z, material: materials.sidewalkCool },
    ].forEach((patch) => addLotPatch(patch));

    [
      { w: 3, d: 22, x: -119, z: -60 },
      { w: 3, d: 22, x: 84, z: -60 },
      { w: 24, d: 3, x: -84, z: 30 },
      { w: 1.35, d: 18, x: 6, z: 31, rotation: 0.72 },
      { w: 2.8, d: 28, x: 9, z: -18, rotation: 0.54 },
      { w: 2.8, d: 24, x: -40, z: 68, rotation: -0.42 },
    ].forEach((lane) => addServiceLane(lane));

    addLabel("BUSK PARK", points.park.x + 3.5, points.park.z - 6.8, "#f6ff90", "rgba(19,57,24,0.72)");
    addLabel("CAMP ROW", points.camp.x + 3, points.camp.z - 6.3, "#ffe0a8", "rgba(75,45,26,0.72)");
    addLabel("PAWN ALLEY", points.cache.x - 1, points.cache.z - 8.2, "#ffd1ff", "rgba(51,28,67,0.75)");
    addLabel("CROSSWALK CIRCUS", points.busk.x, points.busk.z - 8.6, "#fff0a0", "rgba(96,62,17,0.76)", 8.8);
    addLabel("HAZE MOUTH", points.alley.x - 1, points.alley.z + 7.3, "#aaffad", "rgba(19,53,27,0.75)");
    addLabel("UNDERPASS LOOP", -40, 79, "#c6ffe9", "rgba(32,47,44,0.75)", 8.2);

    addCylinder(staticGroup, 2.4, 0.4, points.fountain.x, 0, points.fountain.z, materials.water, 20);
    addCylinder(staticGroup, 1.4, 0.6, points.fountain.x, 0.4, points.fountain.z, materials.concrete, 20);
    addCylinder(staticGroup, 1.2, 0.25, points.busk.x, 0, points.busk.z, materials.yellow, 16);

    [
      [-94, -65], [-88, -54], [-77, -63], [-78, -49], [-91, -88], [-78, -90],
      [-123, 61], [-113, 76], [-38, 79], [-29, 65], [106, 63], [117, 73],
      [55, 23], [74, 39], [103, -73], [119, -53], [-119, -31], [-111, 36],
    ].forEach(([x, z]) => {
      if (!pointNearRoad(x, z, 1.2)) addTree(x, z);
    });

    [
      [-123, 64],
      [-115, 73],
      [-122, 77],
      [-112, 61],
      [-109, 70],
    ].forEach(([x, z], index) => addTent(x, z, index));

    [
      [-74, -58], [-96, -55], [-52, -24], [56, -28], [71, -10], [109, -73],
      [104, -11], [55, 37], [73, 72], [115, 61], [-112, 26], [-33, 57],
      [13, 57], [119, 89], [-121, -82],
    ].forEach(([x, z]) => addTrashSet(x, z));

    [
      [-96, -60], [-78, -69], [-8, 30], [24, 39], [56, -30], [103, -63],
      [-115, 54], [-52, 75], [74, 59], [115, 76],
    ].forEach(([x, z]) => addBench(x, z));

    addStreetFurniture();

    for (let i = 0; i < 32; i += 1) {
      const x = rand(-WORLD.width / 2 + 9, WORLD.width / 2 - 9);
      const z = rand(-WORLD.height / 2 + 9, WORLD.height / 2 - 9);
      if (pointNearRoad(x, z, 1.5) || blockerRects.some((rect) => circleRectHit(x, z, 1.1 + rect.pad, rect))) {
        continue;
      }
      addConeProp(x, z);
    }
  }

  function addTree(x, z) {
    addCylinder(staticGroup, 0.45, 2.5, x, 0, z, mat("treeTrunk", 0x6d4427), 7);
    const crown = makeMesh(new THREE.IcosahedronGeometry(2.4, 0), materials.parkDark, x, 3.4, z, true, false);
    crown.scale.y = 1.25;
    staticGroup.add(crown);
  }

  function addTent(x, z, index) {
    const color = index % 2 ? 0x4d8b8a : 0xa17942;
    const mesh = addCone(staticGroup, 3, 2.4, x, 0, z, mat(`tent-${index}`, color), 4);
    mesh.rotation.y = Math.PI / 4;
    blockerRects.push({ minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2, pad: 0.25 });
  }

  function addTrashSet(x, z) {
    addCylinder(staticGroup, 0.75, 1.1, x, 0, z, materials.trash, 10);
    addBox(staticGroup, 1.2, 0.55, 1.2, x + 1.4, 0, z + 0.6, materials.scrap, false);
    addBox(staticGroup, 1.1, 0.5, 0.8, x - 1.2, 0, z - 0.5, materials.cardboard, false);
  }

  function addBench(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.add(makeMesh(new THREE.BoxGeometry(3.2, 0.25, 0.8), mat("benchWood", 0x735538), 0, 0.65, 0, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), materials.black, -1.2, 0.32, -0.25, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), materials.black, 1.2, 0.32, -0.25, true, true));
    staticGroup.add(group);
  }

  function canPlaceDetail(x, z, radius = 0.9, roadPad = -0.2) {
    const halfW = WORLD.width / 2 - 3;
    const halfH = WORLD.height / 2 - 3;
    if (x < -halfW || x > halfW || z < -halfH || z > halfH) {
      return false;
    }
    if (pointNearRoad(x, z, roadPad)) {
      return false;
    }
    return !blockerRects.some((rect) => circleRectHit(x, z, radius + rect.pad, rect));
  }

  function placeDetail(x, z, radius, add, roadPad = -0.2) {
    if (!canPlaceDetail(x, z, radius, roadPad)) {
      return false;
    }
    add();
    return true;
  }

  function addTrashCan(x, z, variant = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const bodyMat = variant % 3 === 0 ? materials.trash : variant % 3 === 1 ? materials.binBlue : materials.binGreen;
    const body = makeMesh(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 10), bodyMat, 0, 0.45, 0, true, true);
    const lid = makeMesh(new THREE.CylinderGeometry(0.52, 0.52, 0.12, 10), materials.scrap, 0, 0.96, 0, true, false);
    const label = makeMesh(new THREE.BoxGeometry(0.5, 0.28, 0.04), materials.white, 0, 0.58, -0.47, true, false);
    group.add(body, lid, label);
    staticGroup.add(group);
  }

  function addStreetLight(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.add(makeMesh(new THREE.CylinderGeometry(0.12, 0.16, 3.7, 8), materials.pole, 0, 1.85, 0, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(1.0, 0.12, 0.14), materials.pole, 0.44, 3.55, 0, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.38, 0.18, 0.34), materials.yellow, 0.98, 3.46, 0, true, false));
    staticGroup.add(group);
  }

  function addNewsBox(x, z, variant = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const boxMat = variant % 2 ? materials.newsBlue : materials.newsRed;
    group.add(makeMesh(new THREE.BoxGeometry(0.9, 0.85, 0.7), boxMat, 0, 0.42, 0, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(0.72, 0.34, 0.05), materials.white, 0, 0.53, -0.38, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.92, 0.12, 0.75), materials.black, 0, 0.93, 0, true, false));
    staticGroup.add(group);
  }

  function addPlanter(x, z, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.add(makeMesh(new THREE.BoxGeometry(1.8 * scale, 0.55 * scale, 0.9 * scale), materials.sidewalkWarm, 0, 0.28 * scale, 0, true, true));
    const shrub = makeMesh(new THREE.IcosahedronGeometry(0.72 * scale, 0), materials.parkDark, 0, 0.95 * scale, 0, true, false);
    shrub.scale.set(1.35, 0.72, 0.8);
    group.add(shrub);
    staticGroup.add(group);
  }

  function addCardboardStack(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.add(makeMesh(new THREE.BoxGeometry(1.5, 0.22, 1.0), materials.cardboard, 0, 0.16, 0, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(1.05, 0.22, 0.85), materials.cardboard, 0.12, 0.4, -0.06, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(0.7, 0.22, 0.55), materials.cardboard, -0.16, 0.64, 0.06, true, true));
    staticGroup.add(group);
  }

  function addPalletStack(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    for (let i = 0; i < 3; i += 1) {
      group.add(makeMesh(new THREE.BoxGeometry(1.8, 0.12, 0.22), mat("palletWood", 0x8a6845), 0, 0.15 + i * 0.18, -0.38, true, true));
      group.add(makeMesh(new THREE.BoxGeometry(1.8, 0.12, 0.22), mat("palletWood", 0x8a6845), 0, 0.15 + i * 0.18, 0.38, true, true));
      group.add(makeMesh(new THREE.BoxGeometry(0.18, 0.1, 0.9), materials.black, -0.58, 0.08 + i * 0.18, 0, true, true));
      group.add(makeMesh(new THREE.BoxGeometry(0.18, 0.1, 0.9), materials.black, 0.58, 0.08 + i * 0.18, 0, true, true));
    }
    staticGroup.add(group);
  }

  function addHydrant(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.add(makeMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.65, 10), materials.red, 0, 0.34, 0, true, true));
    group.add(makeMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.22, 10), materials.yellow, 0, 0.78, 0, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.7, 0.16, 0.16), materials.red, 0, 0.55, 0, true, false));
    staticGroup.add(group);
  }

  function addBusStop(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.add(makeMesh(new THREE.BoxGeometry(3.4, 0.18, 0.95), materials.roofCool, 0, 2.35, 0, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), materials.pole, -1.45, 1.1, -0.35, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), materials.pole, 1.45, 1.1, -0.35, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(2.8, 0.22, 0.62), mat("busStopSeat", 0x735538), 0, 0.74, 0.18, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(2.6, 1.45, 0.08), materials.glass, 0, 1.45, -0.42, true, false));
    staticGroup.add(group);
  }

  function addVendingMachine(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.add(makeMesh(new THREE.BoxGeometry(1.1, 2.0, 0.72), materials.newsBlue, 0, 1, 0, true, true));
    group.add(makeMesh(new THREE.BoxGeometry(0.68, 0.92, 0.05), materials.glass, -0.12, 1.18, -0.39, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.22, 0.48, 0.05), materials.black, 0.42, 1.1, -0.4, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.72, 0.24, 0.05), materials.yellow, -0.1, 1.78, -0.4, true, false));
    staticGroup.add(group);
  }

  function addBikeRack(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    [-0.55, 0, 0.55].forEach((offset) => {
      const hoop = makeMesh(new THREE.TorusGeometry(0.32, 0.04, 6, 16), materials.pole, offset, 0.46, 0, true, false);
      hoop.scale.z = 0.45;
      hoop.rotation.x = Math.PI / 2;
      group.add(hoop);
    });
    staticGroup.add(group);
  }

  function addGroundPoster(x, z, color = materials.cardboard, rotation = 0) {
    const poster = addFlatRotated(staticGroup, 1.25, 0.8, x, z, color, 0.205, rotation);
    poster.scale.y = 0.92;
    return poster;
  }

  function addDetailCluster(x, z, rotation = 0) {
    addTrashCan(x, z, 1);
    addCardboardStack(x + Math.cos(rotation) * 1.15, z + Math.sin(rotation) * 1.15, rotation);
    addGroundPoster(x - Math.sin(rotation) * 1.05, z + Math.cos(rotation) * 1.05, materials.cardboard, rotation + 0.35);
  }

  function addStreetFurniture() {
    [
      [-101, -71], [-94, -51], [-73, -76], [-72, -45], [-55, -70], [-31, -83],
      [-6, -72], [26, -72], [52, -79], [84, -72], [105, -48], [121, -72],
      [-120, -7], [-98, -28], [-72, -9], [-52, -31], [-29, -8], [19, -24],
      [51, -35], [83, -30], [103, -8], [120, -32], [-123, 45], [-92, 52],
      [-60, 45], [-31, 52], [28, 47], [51, 55], [84, 48], [104, 55], [121, 46],
      [-124, 82], [-102, 88], [-72, 75], [-52, 88], [-29, 78], [27, 82],
      [52, 87], [84, 78], [104, 88], [121, 82],
    ].forEach(([x, z]) => placeDetail(x, z, 1.6, () => addTree(x, z), 0.35));

    [
      [-10, 23], [22, 32], [48, 41], [-52, 41], [-95, -62], [-79, -54],
      [-37, -49], [58, -49], [101, -56], [114, -48], [-116, 58], [-109, 82],
      [-43, 80], [8, 61], [61, 61], [111, 61], [-120, -87], [-42, -82],
      [8, -82], [62, -81], [112, -82],
    ].forEach(([x, z], index) => placeDetail(x, z, 0.65, () => addTrashCan(x, z, index)));

    [
      [-15, 34, 0.3], [18, 25, -0.4], [-88, -70, 0.15], [-76, -55, -0.2],
      [-119, 70, 0.1], [-109, 66, -0.1], [106, 69, 0.2], [116, 64, -0.15],
      [75, -7, 0.4], [56, -9, -0.35], [-40, 62, 0.2], [-33, 74, -0.25],
      [105, -50, 0.15], [119, -60, -0.2],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 0.85, () => addCardboardStack(x, z, rotation)));

    [
      [-2, 27], [16, 36], [-88, -51], [-97, -70], [-116, 64], [-113, 80],
      [107, 76], [119, 70], [75, -18], [56, -19], [-43, 73], [103, -67],
    ].forEach(([x, z], index) => placeDetail(x, z, 1.1, () => addPlanter(x, z, index % 3 === 0 ? 1.15 : 0.9)));

    [
      [-5, 16, 0], [33, 18, Math.PI], [-54, 15, Math.PI / 2], [52, 12, -Math.PI / 2],
      [-113, -35, Math.PI / 2], [-73, -35, -Math.PI / 2], [-31, -35, Math.PI / 2],
      [26, -35, -Math.PI / 2], [74, -35, Math.PI / 2], [112, -35, -Math.PI / 2],
      [-113, 62, Math.PI / 2], [-73, 62, -Math.PI / 2], [-31, 62, Math.PI / 2],
      [26, 62, -Math.PI / 2], [74, 62, Math.PI / 2], [112, 62, -Math.PI / 2],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 0.5, () => addStreetLight(x, z, rotation)));

    [
      [-7, 40], [23, 22], [-83, -49], [104, -72], [116, -55], [-121, 55],
      [-41, 58], [65, -7], [115, 83], [-120, -81],
    ].forEach(([x, z], index) => placeDetail(x, z, 0.7, () => addNewsBox(x, z, index)));

    [
      [-51, -78, 0.1], [53, -70, -0.2], [84, -14, 0.25], [-98, 42, -0.35],
      [-37, 82, 0.2], [72, 76, -0.25], [111, 43, 0.2],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 1.0, () => addPalletStack(x, z, rotation)));

    addStreetFurnitureSecondPass();
  }

  function addStreetFurnitureSecondPass() {
    [
      [-48, -89], [-23, -88], [24, -89], [84, -88], [120, -86],
      [-119, -46], [-101, -43], [-52, -42], [-4, -38], [51, -42], [87, -41],
      [-118, 8], [-83, 12], [-50, 11], [-2, 13], [52, 10], [84, 12], [120, 8],
      [-102, 38], [-74, 39], [13, 45], [87, 39], [119, 38],
      [-82, 91], [-7, 90], [28, 91], [86, 91],
    ].forEach(([x, z]) => placeDetail(x, z, 1.35, () => addTree(x, z), 0.3));

    [
      [-88, -36], [-64, -30], [-18, -32], [36, -31], [94, -31],
      [-106, 20], [-63, 21], [-18, 21], [36, 22], [93, 21],
      [-106, 72], [-63, 72], [-18, 73], [36, 73], [93, 72],
      [-30, -74], [20, -74], [72, -75], [-94, 88], [11, 87], [103, 87],
    ].forEach(([x, z], index) => {
      const hz = z + (index % 2 ? 1.7 : -1.7);
      placeDetail(x, hz, 0.45, () => addHydrant(x, hz), 0.2);
    });

    [
      [-85, -82, 0], [9, -82, 0], [64, -82, 0], [111, -83, 0],
      [-119, -12, Math.PI / 2], [-40, -10, Math.PI / 2], [64, -10, Math.PI / 2],
      [-84, 46, Math.PI], [9, 45, Math.PI], [64, 46, Math.PI], [112, 45, Math.PI],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 1.0, () => addVendingMachine(x, z, rotation)));

    [
      [-73, -86, 0], [-30, -44, Math.PI / 2], [27, -44, Math.PI / 2],
      [83, -86, 0], [-118, 15, Math.PI / 2], [-51, 16, Math.PI / 2],
      [51, 16, Math.PI / 2], [118, 15, Math.PI / 2], [-73, 58, 0],
      [27, 58, 0], [84, 58, 0],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 1.45, () => addBusStop(x, z, rotation), 0.15));

    [
      [-14, 39, 0.1], [30, 31, -0.3], [-91, -81, 0.5], [-61, -54, -0.2],
      [-20, -58, 0.4], [37, -70, -0.5], [83, -55, 0.35], [122, -53, -0.25],
      [-123, 72, 0.1], [-96, 77, -0.4], [-61, 80, 0.2], [-24, 61, -0.35],
      [53, 82, 0.25], [88, 61, -0.2], [121, 78, 0.3],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 1.4, () => addDetailCluster(x, z, rotation)));

    [
      [-20, 32, 0], [20, 38, 0], [-89, -46, 0], [-102, -64, 0],
      [-43, -46, 0], [56, -47, 0], [102, -45, 0], [-116, 86, 0],
      [-38, 88, 0], [8, 80, 0], [62, 88, 0], [118, 87, 0],
    ].forEach(([x, z, rotation]) => placeDetail(x, z, 0.85, () => addBikeRack(x, z, rotation)));

    [
      [-5, 41], [13, 24], [25, 39], [-90, -68], [-72, -52], [-45, -75],
      [58, -73], [100, -52], [116, -70], [-119, 61], [-110, 78],
      [-40, 70], [64, 77], [111, 68],
    ].forEach(([x, z], index) => {
      const material = index % 3 === 0 ? materials.cardboard : index % 3 === 1 ? materials.newsRed : materials.newsBlue;
      placeDetail(x, z, 0.45, () => addGroundPoster(x, z, material, rand(-0.6, 0.6)));
    });
  }

  function makeActor(kind, x, z, options = {}) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const baseColor = options.color || materials.civilian;
    const body = addCylinder(group, 0.72, 1.5, 0, 0, 0, baseColor, 10);
    body.scale.x = 0.85;
    const head = makeMesh(new THREE.SphereGeometry(0.48, 10, 8), options.headMat || materials.playerHead, 0, 2.08, -0.02, true, false);
    group.add(head);

    if (kind === "player") {
      const pants = makeMesh(new THREE.BoxGeometry(0.9, 0.7, 0.55), materials.playerPants, 0, 0.42, 0.04, true, false);
      const cap = makeMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.22, 10), materials.playerCap, 0, 2.55, -0.03, true, false);
      const bill = makeMesh(new THREE.BoxGeometry(0.62, 0.08, 0.3), materials.playerCap, 0, 2.49, -0.48, true, false);
      const sign = makeMesh(new THREE.BoxGeometry(0.82, 0.72, 0.08), materials.cardboard, 0, 0.95, 0.55, true, false);
      group.add(pants, cap, bill, sign);
    }

    if (kind === "cop") {
      const badge = makeMesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), materials.yellow, 0.01, 1.55, -0.62, true, false);
      const lightA = makeMesh(new THREE.BoxGeometry(0.35, 0.18, 0.2), materials.copRed, -0.22, 2.62, 0, true, false);
      const lightB = makeMesh(new THREE.BoxGeometry(0.35, 0.18, 0.2), materials.copBlue, 0.22, 2.62, 0, true, false);
      group.add(badge, lightA, lightB);
    }

    if (kind === "zombie") {
      head.material = materials.zombie;
      const glow = makeMesh(
        new THREE.TorusGeometry(0.85, 0.05, 6, 20),
        new THREE.MeshBasicMaterial({ color: 0x8aff6a, transparent: true, opacity: 0.55 }),
        0,
        0.12,
        0,
        false,
        false
      );
      glow.rotation.x = Math.PI / 2;
      group.add(glow);
    }

    actorGroup.add(group);
    return group;
  }

  function makePickup(type, x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    let ringColor = 0xffe07a;
    if (type === "cash") {
      group.add(makeMesh(new THREE.BoxGeometry(1.0, 0.12, 0.55), materials.cash, 0, 0.28, 0, true, false));
      ringColor = 0x61e776;
    } else if (type === "snack") {
      group.add(makeMesh(new THREE.BoxGeometry(1.0, 0.35, 0.62), materials.food, 0, 0.42, 0, true, false));
      ringColor = 0xffb34a;
    } else if (type === "cone") {
      addCone(group, 0.5, 1.0, 0, 0.04, 0, materials.cone, 10);
      ringColor = 0xff7a3a;
    } else if (type === "peel") {
      const peel = makeMesh(new THREE.TorusGeometry(0.5, 0.13, 6, 12), materials.peel, 0, 0.16, 0, true, false);
      peel.scale.z = 0.45;
      group.add(peel);
      ringColor = 0xf5d431;
    } else if (type === "plunger") {
      addCylinder(group, 0.12, 1.1, 0, 0.55, 0, materials.pole, 8);
      group.add(makeMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.4, 12), materials.plunger, 0, 0.2, 0, true, false));
      ringColor = 0xc05555;
    } else if (type === "boombox") {
      group.add(makeMesh(new THREE.BoxGeometry(1.2, 0.7, 0.5), materials.black, 0, 0.4, 0, true, false));
      group.add(makeMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12), materials.yellow, -0.3, 0.4, 0.27, true, false));
      group.add(makeMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12), materials.yellow, 0.3, 0.4, 0.27, true, false));
      ringColor = 0x49c9ff;
    } else if (type === "sign") {
      addCylinder(group, 0.08, 0.9, 0, 0.45, 0, materials.pole, 6);
      group.add(makeMesh(new THREE.BoxGeometry(0.9, 0.6, 0.08), materials.cardboard, 0, 0.9, 0, true, false));
      ringColor = 0xc79a5a;
    } else if (type === "chicken") {
      group.add(makeMesh(new THREE.SphereGeometry(0.34, 10, 8), materials.yellow, 0, 0.5, 0, true, false));
      group.add(makeMesh(new THREE.BoxGeometry(0.16, 0.16, 0.4), materials.yellow, 0, 0.5, 0.32, true, false));
      ringColor = 0xffd83a;
    } else {
      addCylinder(group, 0.42, 0.45, 0, 0, 0, materials.scrap, 8);
      ringColor = 0xd7dde2;
    }
    const ring = makeMesh(
      new THREE.RingGeometry(0.8, 1.05, 20),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
      0,
      0.06,
      0,
      false,
      false
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    actorGroup.add(group);
    const pickup = { type, x, z, mesh: group, active: true, spin: rand(0, Math.PI * 2) };
    pickups.push(pickup);
    return pickup;
  }

  function makeCar(lane, offset, type, id) {
    const group = new THREE.Group();
    const vehicleMat = mat(`vehicle-${type.id}-${type.color.toString(16)}`, type.color);
    const body = makeMesh(new THREE.BoxGeometry(type.length, type.bodyHeight, type.width), vehicleMat, 0, type.bodyHeight / 2, 0, true, true);
    const cabinX = type.cargo ? type.length * 0.28 : 0;
    const cabin = makeMesh(
      new THREE.BoxGeometry(type.cabinLength, type.cabinHeight, type.cabinWidth),
      materials.glass,
      cabinX,
      type.bodyHeight + type.cabinHeight / 2 - 0.04,
      0,
      true,
      false
    );
    const headA = makeMesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), materials.lane, type.length / 2 + 0.03, type.bodyHeight * 0.7, -type.width * 0.27, false, false);
    const headB = makeMesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), materials.lane, type.length / 2 + 0.03, type.bodyHeight * 0.7, type.width * 0.27, false, false);
    const tailA = makeMesh(new THREE.BoxGeometry(0.2, 0.16, 0.38), materials.red, -type.length / 2 - 0.02, type.bodyHeight * 0.68, -type.width * 0.28, false, false);
    const tailB = makeMesh(new THREE.BoxGeometry(0.2, 0.16, 0.38), materials.red, -type.length / 2 - 0.02, type.bodyHeight * 0.68, type.width * 0.28, false, false);
    const wheelGeo = new THREE.BoxGeometry(0.62, 0.24, 0.32);
    const wheelXs = [-type.length * 0.32, type.length * 0.32];
    const wheelZs = [-type.width / 2 - 0.02, type.width / 2 + 0.02];
    const wheels = [];
    wheelXs.forEach((x) => {
      wheelZs.forEach((z) => {
        wheels.push(makeMesh(wheelGeo, materials.black, x, 0.23, z, true, false));
      });
    });
    group.add(body, cabin, headA, headB, tailA, tailB, ...wheels);

    if (type.bed) {
      const bed = makeMesh(new THREE.BoxGeometry(type.length * 0.42, 0.22, type.width * 0.78), materials.trash, -type.length * 0.18, type.bodyHeight + 0.08, 0, true, false);
      group.add(bed);
    }
    if (type.cargo) {
      const cargo = makeMesh(new THREE.BoxGeometry(type.cargoLength, type.cargoHeight, type.width * 0.92), mat("deliveryCargo", 0xc3b091), -type.length * 0.16, type.bodyHeight + type.cargoHeight / 2 - 0.02, 0, true, false);
      group.add(cargo);
    }
    if (type.roofSign) {
      const sign = makeMesh(new THREE.BoxGeometry(0.75, 0.18, 0.45), materials.white, 0, type.bodyHeight + type.cabinHeight + 0.1, 0, true, false);
      group.add(sign);
    }

    actorGroup.add(group);
    const cruise = lane.speed * type.speedScale * (0.94 + (id % 3) * 0.04);
    const car = {
      id,
      lane,
      type,
      mesh: group,
      offset: wrapLaneOffset(lane, offset),
      currentSpeed: cruise,
      targetSpeed: cruise,
      hitCooldown: 0,
      brakeLights: [tailA, tailB],
      braking: false,
      waitReason: "",
      waitHard: false,
      waitTime: 0,
    };
    cars.push(car);
    updateCarPosition(car, 0);
    return car;
  }

  function resetDynamic() {
    actorGroup.clear();
    fxGroup.clear();
    civilians.length = 0;
    cops.length = 0;
    zombies.length = 0;
    cars.length = 0;
    pickups.length = 0;
    projectiles.length = 0;
    peels.length = 0;
    floaters.length = 0;
    pulses.length = 0;
  }

  function spawnActors() {
    player.x = points.start.x;
    player.z = points.start.z;
    player.facing.x = 0;
    player.facing.z = -1;
    player.mesh = makeActor("player", player.x, player.z, { color: materials.player });

    for (let i = 0; i < (VISUAL_TARGET ? 20 : 30); i += 1) {
      const pos = randomSidewalkPoint(0.85);
      const mesh = makeActor("civilian", pos.x, pos.z, {
        color: i % 3 === 0 ? materials.civilian2 : materials.civilian,
      });
      const civilian = {
        x: pos.x,
        z: pos.z,
        radius: 0.85,
        mesh,
        dir: rand(0, Math.PI * 2),
        speed: rand(1.8, 3.2),
        timer: rand(0.6, 2.4),
        tipped: 0,
        panic: 0,
        sidewalk: pos.strip,
        sidewalkSegment: pos.segment,
        sidewalkTarget: pos.strip,
        sidewalkTargetSegment: pos.segment,
        target: null,
        crossing: false,
      };
      assignCivilianTarget(civilian);
      civilians.push(civilian);
    }

    [
      { x: -28, z: -31 },
      { x: 75, z: 18 },
      { x: -83, z: 64 },
    ].forEach((pos, index) => {
      const mesh = makeActor("cop", pos.x, pos.z, { color: materials.cop });
      cops.push({
        x: pos.x,
        z: pos.z,
        homeX: pos.x,
        homeZ: pos.z,
        radius: 0.95,
        mesh,
        speed: 7.1 + index * 0.35,
        stun: 0,
        slip: 0,
      });
    });

    [
      ["water", points.fountain.x, points.fountain.z],
      ["food", points.park.x + 9, points.park.z + 2],
      ["cash", points.busk.x + 5, points.busk.z + 2],
      ["scrap", points.cache.x, points.cache.z + 8],
      ["scrap", points.alley.x - 5, points.alley.z - 6],
      ["water", points.camp.x + 5, points.camp.z - 4],
      ["food", points.kiosk.x, points.kiosk.z - 12],
      ["cash", -40, 73],
    ].forEach(([type, x, z]) => makePickup(type, x, z));

    let vehicleId = 0;
    lanes.forEach((lane, laneIndex) => {
      const span = laneSpan(lane);
      const laneTraffic = VISUAL_TARGET ? 1 : 2;
      for (let i = 0; i < laneTraffic; i += 1) {
        const type = vehicleTypes[(laneIndex + i * lanes.length) % vehicleTypes.length];
        const offset = ((i + 0.34) * span) / laneTraffic + laneIndex * 5.5;
        makeCar(lane, offset, type, vehicleId);
        vehicleId += 1;
      }
    });
  }

  function getOpenPoint(radius = 1.4, avoidRoad = false) {
    for (let i = 0; i < 120; i += 1) {
      const point = {
        x: rand(-WORLD.width / 2 + 9, WORLD.width / 2 - 9),
        z: rand(-WORLD.height / 2 + 9, WORLD.height / 2 - 9),
      };
      if (isWalkable(point.x, point.z, radius) && (!avoidRoad || !pointNearRoad(point.x, point.z, 1.3))) {
        return point;
      }
    }
    return { x: points.start.x + rand(-6, 6), z: points.start.z + rand(-6, 6) };
  }

  function resetGame(autoStart = false) {
    resetDynamic();
    spawnActors();
    state.running = autoStart;
    state.paused = false;
    state.ended = false;
    state.phase = "day";
    state.cycle = 1;
    state.phaseTime = 0;
    state.cash = 7.25;
    state.wanted = 8;
    state.arrest = 0;
    state.health = state.maxHealth;
    state.score = 0;
    state.actStreak = 0;
    state.actStreakTime = 0;
    state._god = false;
    initBag();
    state.tasks.buskCash = 0;
    state.waveTarget = 8;
    state.waveKills = 0;
    state.objective = "Earn $20 before nightfall";
    Object.keys(state.cooldowns).forEach((key) => {
      state.cooldowns[key] = 0;
    });
    toggleBag(false);
    if (els.overlay) {
      els.overlay.classList.toggle("overlay--show", !autoStart);
    }
    ui.setText(els.primary, "Start run");
    ui.setText(els.overlayTitle, "UNHOUSED AND UNHINGED");
    ui.setText(
      els.overlaySub,
      "Earn cash by day, keep your wanted stars down, then survive the Tweeker Zombie night. Move, tap ACT to earn, tap ATTACK to fight. Collect props and equip them to slots 1-4."
    );
    ui.setText(els.overlayScore, "");
    refreshHotbar();
    logLine("New top-down block loaded.");
    updateHUD();
  }

  function startGame() {
    if (saveSlot && !state.running) saveSlot.clear();
    if (state.ended) {
      resetGame(true);
      return;
    }
    state.running = true;
    state.paused = false;
    state.ended = false;
    if (els.overlay) {
      els.overlay.classList.remove("overlay--show");
    }
    canvas.focus({ preventScroll: true });
    logLine("Run started. Make cash before the Tweeker Zombies roll in.");
  }

  function setPaused(nextPaused) {
    if (!state.running || state.ended) {
      return;
    }
    state.paused = nextPaused;
    if (els.overlay) {
      els.overlay.classList.toggle("overlay--show", state.paused);
    }
    ui.setText(els.overlayTitle, "PAUSED");
    ui.setText(els.overlaySub, "Top-down run is paused.");
    ui.setText(els.primary, "Resume");
  }

  function endGame(title, sub) {
    state.running = false;
    state.ended = true;
    if (saveSlot) saveSlot.clear();
    state.score = Math.round(state.cash * 7 + state.waveKills * 30 + state.cycle * 20 - state.wanted * 0.5);
    state.high = Math.max(state.high, state.score);
    localStorage.setItem(SAVE_KEY, String(state.high));
    if (els.overlay) {
      els.overlay.classList.add("overlay--show");
    }
    ui.setText(els.overlayTitle, title);
    ui.setText(els.overlaySub, sub);
    ui.setText(els.overlayScore, `Score ${state.score} | Best ${state.high} | Cash $${state.cash.toFixed(2)}`);
    ui.setText(els.primary, "Restart run");
  }

  // ---- Items / bag / hotbar -------------------------------------------------
  function initBag() {
    state.bag = {};
    STARTER_HOTBAR.forEach((id) => {
      if (id) state.bag[id] = true;
    });
    state.hotbar = STARTER_HOTBAR.slice();
    state.activeSlot = 0;
    state.inventory.cone = ITEMS.cone.start;
    state.inventory.peel = ITEMS.peel.start;
  }

  function activeItem() {
    return ITEMS[state.hotbar[state.activeSlot]] || ITEMS.fists;
  }

  function ownsItem(id) {
    return !!state.bag[id];
  }

  // Add an item to the bag. Consumables also gain `n` to their count. A brand
  // new item auto-fills the first empty hotbar slot; otherwise it waits in the
  // bag for the player to equip it. Returns true if it was new.
  function addToBag(id, n = 1) {
    const item = ITEMS[id];
    if (!item) return false;
    const isNew = !state.bag[id];
    state.bag[id] = true;
    if (item.count) {
      state.inventory[item.count] = clamp((state.inventory[item.count] || 0) + n, 0, item.cap || 9);
    }
    if (isNew) {
      const empty = state.hotbar.findIndex((slot) => !slot);
      if (empty !== -1) state.hotbar[empty] = id;
    }
    return isNew;
  }

  function selectSlot(index) {
    if (index < 0 || index >= state.hotbar.length) return;
    state.activeSlot = index;
    refreshHotbar();
    if (state.bagOpen) renderBag();
  }

  function equipToSlot(id, slot) {
    if (!ITEMS[id] || !ownsItem(id)) return;
    if (slot < 0 || slot >= state.hotbar.length) return;
    // Avoid duplicates: if the item already sits in another slot, swap them.
    const existing = state.hotbar.indexOf(id);
    if (existing !== -1 && existing !== slot) state.hotbar[existing] = state.hotbar[slot];
    state.hotbar[slot] = id;
    state.activeSlot = slot;
    refreshHotbar();
  }

  // ---- Wanted / police ------------------------------------------------------
  function starLevel() {
    return clamp(Math.ceil(state.wanted / 20), 0, 5);
  }

  function addWanted(amount) {
    state.wanted = clamp(state.wanted + amount, 0, 100);
  }

  function copsChasing() {
    return state.wanted >= 40 || state.arrest > 4;
  }

  function bumpActStreak() {
    state.actStreak = Math.min(6, state.actStreak + 1);
    state.actStreakTime = 2.4;
  }

  function logLine(text) {
    if (!els.cityLog) {
      return;
    }
    const div = document.createElement("div");
    div.textContent = text;
    els.cityLog.prepend(div);
    while (els.cityLog.children.length > 7) {
      els.cityLog.lastElementChild.remove();
    }
  }

  // ---- Hotbar + bag UI ------------------------------------------------------
  function buildHotbar() {
    const host = els.hotbar;
    if (!host) return;
    host.innerHTML = "";
    els.hotbarSlots = state.hotbar.map((id, index) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "uh-slot";
      slot.dataset.slot = String(index);
      slot.innerHTML =
        `<span class="uh-slot__key">${index + 1}</span>` +
        `<span class="uh-slot__icon"></span>` +
        `<span class="uh-slot__count"></span>`;
      host.appendChild(slot);
      return slot;
    });
    refreshHotbar();
  }

  function refreshHotbar() {
    if (!els.hotbarSlots) return;
    state.hotbar.forEach((id, index) => {
      const slot = els.hotbarSlots[index];
      if (!slot) return;
      const item = ITEMS[id];
      slot.classList.toggle("is-active", index === state.activeSlot);
      slot.classList.toggle("is-empty", !item);
      slot.querySelector(".uh-slot__icon").textContent = item ? item.short : "—";
      const countEl = slot.querySelector(".uh-slot__count");
      countEl.textContent = item && item.count ? String(state.inventory[item.count] || 0) : "";
    });
  }

  function itemSummary(item) {
    const parts = [];
    if (item.earn) parts.push(`ACT: ${item.earn.label || "earn"}`);
    if (item.attack) parts.push(`HIT: ${item.attack.label || item.attack.kind}`);
    return parts.join(" · ");
  }

  function renderBag() {
    const grid = els.bagGrid;
    if (!grid) return;
    grid.innerHTML = "";
    Object.keys(ITEMS)
      .filter((id) => state.bag[id])
      .forEach((id) => {
        const item = ITEMS[id];
        const slot = state.hotbar.indexOf(id);
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "uh-bag__item" +
          (slot === state.activeSlot ? " is-active" : "") +
          (slot !== -1 ? " is-equipped" : "");
        button.dataset.item = id;
        const count = item.count ? ` ×${state.inventory[item.count] || 0}` : "";
        const where = slot !== -1 ? `Slot ${slot + 1}` : "In bag";
        button.innerHTML =
          `<strong>${safeText(item.name)}</strong>` +
          `<span>${safeText(itemSummary(item))}</span>` +
          `<small>${where}${count}</small>`;
        grid.appendChild(button);
      });
    ui.setText(els.bagActiveSlot, String(state.activeSlot + 1));
  }

  function toggleBag(open) {
    state.bagOpen = open === undefined ? !state.bagOpen : open;
    if (els.bagOverlay) els.bagOverlay.hidden = !state.bagOpen;
    if (state.bagOpen) renderBag();
  }

  function isWalkable(x, z, radius) {
    return isStaticWalkable(x, z, radius) && !vehicleBlocksPoint(x, z, radius);
  }

  function isStaticWalkable(x, z, radius) {
    const halfW = WORLD.width / 2 - 2;
    const halfH = WORLD.height / 2 - 2;
    if (x < -halfW + radius || x > halfW - radius || z < -halfH + radius || z > halfH - radius) {
      return false;
    }
    if (blockerRects.some((rect) => circleRectHit(x, z, radius + rect.pad, rect))) {
      return false;
    }
    return true;
  }

  function circleRectHit(x, z, radius, rect) {
    const closestX = clamp(x, rect.minX, rect.maxX);
    const closestZ = clamp(z, rect.minZ, rect.maxZ);
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  function rectsOverlap(a, b) {
    return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ);
  }

  function laneDirection(lane) {
    return lane.speed >= 0 ? 1 : -1;
  }

  function laneSpan(lane) {
    return lane.max - lane.min;
  }

  function wrapLaneOffset(lane, offset) {
    const span = laneSpan(lane);
    let value = offset;
    while (value > span) value -= span;
    while (value < 0) value += span;
    return value;
  }

  function vehiclePositionAt(car, offset = car.offset) {
    const lane = car.lane;
    const value = lane.min + wrapLaneOffset(lane, offset);
    const side = laneDirection(lane) * 1.8;
    if (lane.axis === "x") {
      return { x: value, z: lane.z + side };
    }
    return { x: lane.x + side, z: value };
  }

  function vehicleFootprintAt(car, offset = car.offset, extraFront = 0, pad = 0) {
    const pos = vehiclePositionAt(car, offset);
    const direction = laneDirection(car.lane);
    const halfLength = car.type.length / 2 + pad;
    const halfWidth = car.type.width / 2 + pad;
    if (car.lane.axis === "x") {
      const minX = pos.x - halfLength - (direction < 0 ? extraFront : 0);
      const maxX = pos.x + halfLength + (direction > 0 ? extraFront : 0);
      return {
        minX,
        maxX,
        minZ: pos.z - halfWidth,
        maxZ: pos.z + halfWidth,
      };
    }
    const minZ = pos.z - halfLength - (direction < 0 ? extraFront : 0);
    const maxZ = pos.z + halfLength + (direction > 0 ? extraFront : 0);
    return {
      minX: pos.x - halfWidth,
      maxX: pos.x + halfWidth,
      minZ,
      maxZ,
    };
  }

  function vehicleBlocksPoint(x, z, radius) {
    return cars.some((car) => circleRectHit(x, z, radius + 0.18, vehicleFootprintAt(car, car.offset, 0, 0.15)));
  }

  function trafficActors() {
    return [player, ...civilians, ...cops, ...zombies].filter((actor) => actor.mesh);
  }

  function laneAheadDistance(car, other) {
    if (car.lane !== other.lane) {
      return Infinity;
    }
    const span = laneSpan(car.lane);
    let distance = laneDirection(car.lane) > 0 ? other.offset - car.offset : car.offset - other.offset;
    while (distance < 0) distance += span;
    while (distance > span) distance -= span;
    return distance;
  }

  function distanceToNextIntersection(car) {
    const lane = car.lane;
    const span = laneSpan(lane);
    const value = lane.min + car.offset;
    const direction = laneDirection(lane);
    const crossings = lane.axis === "x" ? ROAD_X : ROAD_Z;
    return crossings.reduce((best, crossing) => {
      let distance = direction > 0 ? crossing - value : value - crossing;
      while (distance < -ROAD_HALF) {
        distance += span;
      }
      return distance > car.type.length * 0.5 ? Math.min(best, distance) : best;
    }, Infinity);
  }

  function trafficAxisHasGreen(axis) {
    const phase = Math.floor(state.phaseTime / 5.2) % 2;
    return phase === 0 ? axis === "x" : axis === "z";
  }

  function vehicleTrafficHazard(car) {
    const speed = Math.abs(car.currentSpeed || car.targetSpeed || car.lane.speed);
    const peopleScan = vehicleFootprintAt(car, car.offset, car.type.stopDistance + speed * 0.38, 0.25);
    if (trafficActors().some((actor) => circleRectHit(actor.x, actor.z, actor.radius + 0.15, peopleScan))) {
      return { reason: "person", hard: true };
    }

    const ownFootprint = vehicleFootprintAt(car, car.offset, 0, 0.12);
    for (const other of cars) {
      if (other === car) {
        continue;
      }
      const otherBody = vehicleFootprintAt(other, other.offset, 0, 0.12);
      if (rectsOverlap(ownFootprint, otherBody)) {
        return { reason: "vehicle", hard: true };
      }
      if (car.lane === other.lane && laneAheadDistance(car, other) < car.type.stopDistance + other.type.length * 0.5) {
        return { reason: "vehicle", hard: true };
      }
    }

    const nextIntersection = distanceToNextIntersection(car);
    if (!trafficAxisHasGreen(car.lane.axis) && nextIntersection < car.type.stopDistance + speed * 0.45) {
      return { reason: "signal", hard: true };
    }
    return { reason: "", hard: false };
  }

  function moveCircle(actor, dx, dz) {
    if (!actor || (dx === 0 && dz === 0)) {
      return;
    }
    const nextX = actor.x + dx;
    if (isWalkable(nextX, actor.z, actor.radius)) {
      actor.x = nextX;
    }
    const nextZ = actor.z + dz;
    if (isWalkable(actor.x, nextZ, actor.radius)) {
      actor.z = nextZ;
    }
    if (actor.mesh) {
      actor.mesh.position.x = actor.x;
      actor.mesh.position.z = actor.z;
    }
  }

  function pointInDistrict(point, district) {
    return Math.abs(point.x - district.x) <= district.w / 2 && Math.abs(point.z - district.z) <= district.h / 2;
  }

  function updateDistrict() {
    const point = { x: player.x, z: player.z };
    state.district = districts.find((district) => pointInDistrict(point, district)) || {
      name: "Open Block",
      trait: "balanced risk",
      tip: 1,
      heat: 1,
    };
  }

  function update(dt) {
    if (!state.running || state.paused || state.ended) {
      updateCamera(dt);
      animateIdle(dt);
      return;
    }

    Object.keys(state.cooldowns).forEach((key) => {
      state.cooldowns[key] = Math.max(0, state.cooldowns[key] - dt);
    });

    updateTime(dt);
    updateDistrict();
    updatePlayer(dt);
    updateCivilians(dt);
    updateCops(dt);
    updateCars(dt);
    updatePickups(dt);
    updateProjectiles(dt);
    updatePeels(dt);
    updateZombies(dt);
    updateFX(dt);
    updateCamera(dt);
    updateHUD();

    if (state._god) state.health = state.maxHealth;
    if (state.health <= 0) {
      endGame("WIPED OUT", "The block got too rough. Rest at camp and pick safer fights next run.");
    } else if (state.arrest >= 100) {
      endGame("BUSTED", "The cops caught up. Keep your wanted stars down — don't bonk regular folks or beg nonstop.");
    }
  }

  function updateTime(dt) {
    state.phaseTime += dt;
    const limit = state.phase === "day" ? state.dayLength : state.nightLength;
    if (state.phaseTime < limit) {
      return;
    }

    if (state.phase === "day") {
      beginNight();
    } else {
      beginDay();
    }
  }

  function beginNight() {
    state.phase = "night";
    state.phaseTime = 0;
    state.waveKills = 0;
    state.waveTarget = 7 + state.cycle * 4;
    state.objective = "Survive the Tweeker Zombie wave";
    state.wanted = clamp(state.wanted * 0.5, 8, 45);
    state.arrest = 0;
    spawnNightWave();
    logLine("Tweeker Zombies rolling in. Bonk clean, keep moving.");
    addPulse(player.x, player.z, 0x6dff83, 8, 1.25);
  }

  function beginDay() {
    state.cycle += 1;
    state.phase = "day";
    state.phaseTime = 0;
    state.objective = state.cycle >= 4 ? "Make it to the final payday" : "Earn $20 before nightfall";
    state.wanted = clamp(state.wanted * 0.4, 0, 45);
    state.arrest = 0;
    state.health = clamp(state.health + 22, 1, state.maxHealth);
    zombies.splice(0).forEach((zombie) => actorGroup.remove(zombie.mesh));
    spawnDayPickups();
    logLine(`Dawn cycle ${state.cycle}. The block resets, mostly.`);
    if (state.cycle > 3) {
      endGame("BLOCK LEGEND", "Three cycles survived. This is the new top-down baseline.");
    }
  }

  function spawnDayPickups() {
    const drops = ["cash", "snack", "cone", "peel", "cash", choose(["boombox", "sign", "chicken"])];
    drops.forEach((type) => {
      const point = getOpenPoint(1.4, true);
      makePickup(type, point.x, point.z);
    });
  }

  function randomEdgePoint(radius = 1.1) {
    for (let i = 0; i < 60; i += 1) {
      const side = Math.floor(rand(0, 4));
      const point = side === 0
        ? { x: -WORLD.width / 2 + 8, z: rand(-WORLD.height / 2 + 10, WORLD.height / 2 - 10) }
        : side === 1
          ? { x: WORLD.width / 2 - 8, z: rand(-WORLD.height / 2 + 10, WORLD.height / 2 - 10) }
          : side === 2
            ? { x: rand(-WORLD.width / 2 + 10, WORLD.width / 2 - 10), z: -WORLD.height / 2 + 8 }
            : { x: rand(-WORLD.width / 2 + 10, WORLD.width / 2 - 10), z: WORLD.height / 2 - 8 };
      if (isStaticWalkable(point.x, point.z, radius) && !pointNearRoad(point.x, point.z, 1.2)) {
        return point;
      }
    }
    return getOpenPoint(radius, true);
  }

  function spawnNightWave() {
    const count = Math.min(15, state.waveTarget + 3);
    for (let i = 0; i < count; i += 1) {
      const spawn = randomEdgePoint(1.1);
      spawnZombie(spawn.x + rand(-2.5, 2.5), spawn.z + rand(-2.5, 2.5), i % 5 === 0 ? "runner" : "shambler");
    }
  }

  function spawnZombie(x, z, kind = "shambler") {
    const mesh = makeActor("zombie", x, z, {
      color: kind === "runner" ? materials.zombie : materials.zombieDark,
    });
    const zombie = {
      kind,
      x,
      z,
      radius: kind === "runner" ? 0.82 : 1.0,
      mesh,
      health: kind === "runner" ? 2 : 3,
      speed: kind === "runner" ? rand(6.4, 7.5) : rand(3.8, 5.1),
      attack: 0,
      stun: 0,
      wobble: rand(0, Math.PI * 2),
    };
    zombies.push(zombie);
    return zombie;
  }

  function updatePlayer(dt) {
    let ix = 0;
    let iz = 0;
    if (keys.w || keys.arrowup) iz -= 1;
    if (keys.s || keys.arrowdown) iz += 1;
    if (keys.a || keys.arrowleft) ix -= 1;
    if (keys.d || keys.arrowright) ix += 1;
    ix += mobileMove.x;
    iz += mobileMove.z;

    const mag = len2(ix, iz);
    const moving = mag > 0.01;
    if (moving) {
      ix /= mag;
      iz /= mag;
      moveCircle(player, ix * player.speed * dt, iz * player.speed * dt);
      player.facing.x = ix;
      player.facing.z = iz;
    }
    if (player.mesh) {
      player.mesh.rotation.y = Math.atan2(player.facing.x, player.facing.z);
    }

    // "Acting too much" window: each ACT bumps the streak; it cools off here.
    if (state.actStreakTime > 0) {
      state.actStreakTime -= dt;
      if (state.actStreakTime <= 0) state.actStreak = 0;
    }

    // Wanted stars cool down — faster when you lay low and faster still at camp.
    const layingLow = state.cooldowns.act <= 0 && state.cooldowns.attack <= 0;
    const atCamp = distSq(player, points.camp) < 200;
    let cool = state.phase === "day" ? 1.4 : 0.6;
    if (layingLow) cool += 0.9;
    if (atCamp) cool += 3.4;
    state.wanted = clamp(state.wanted - cool * dt, 0, 100);

    // Camp is a passive safe zone: rest here to heal up between fights.
    if (atCamp && state.health < state.maxHealth) {
      state.health = clamp(state.health + 7 * dt, 0, state.maxHealth);
    }
  }

  function updateCivilians(dt) {
    civilians.forEach((civilian) => {
      civilian.tipped = Math.max(0, civilian.tipped - dt);
      civilian.panic = Math.max(0, civilian.panic - dt);
      civilian.timer -= dt;

      let speed = civilian.speed;
      let dx = 0;
      let dz = 0;
      if (civilian.panic > 0) {
        dx = civilian.x - player.x;
        dz = civilian.z - player.z;
        const mag = len2(dx, dz) || 1;
        dx /= mag;
        dz /= mag;
        speed *= 1.8;
      } else {
        const reached = !civilian.target || distSq(civilian, civilian.target) < 1.2;
        if (reached && civilian.sidewalkTarget) {
          civilian.sidewalk = civilian.sidewalkTarget;
          civilian.sidewalkSegment = civilian.sidewalkTargetSegment;
        }
        if (reached || civilian.timer <= 0) {
          assignCivilianTarget(civilian);
        }
        dx = civilian.target.x - civilian.x;
        dz = civilian.target.z - civilian.z;
        const mag = len2(dx, dz) || 1;
        dx /= mag;
        dz /= mag;
        speed *= civilian.crossing ? 1.25 : 0.82;
      }
      moveCircle(civilian, dx * speed * dt, dz * speed * dt);
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        civilian.mesh.rotation.y = Math.atan2(dx, dz);
      }

      const d = Math.sqrt(distSq(civilian, player));
      if (d < 3.4 && state.phase === "day" && activeItem().id === "boombox" && civilian.tipped <= 0) {
        civilian.tipped = 5;
      }
    });
  }

  function updateCops(dt) {
    const chase = copsChasing();
    cops.forEach((cop) => {
      cop.stun = Math.max(0, cop.stun - dt);
      cop.slip = Math.max(0, cop.slip - dt);
      if (cop.stun > 0 || cop.slip > 0) {
        cop.mesh.rotation.y += dt * 8;
        return;
      }

      let tx = cop.homeX;
      let tz = cop.homeZ;
      let speed = cop.speed * 0.44;
      if (chase) {
        tx = player.x;
        tz = player.z;
        speed = cop.speed + state.wanted * 0.02;
      }

      let dx = tx - cop.x;
      let dz = tz - cop.z;
      const mag = len2(dx, dz);
      if (mag > 0.2) {
        dx /= mag;
        dz /= mag;
        moveCircle(cop, dx * speed * dt, dz * speed * dt);
        cop.mesh.rotation.y = Math.atan2(dx, dz);
      }

      const d = Math.sqrt(distSq(cop, player));
      if (chase && d < 2.2) {
        state.arrest = clamp(state.arrest + 30 * dt, 0, 100);
        state.health = clamp(state.health - 4 * dt, 0, state.maxHealth);
      } else if (state.arrest > 0 && d > 10) {
        state.arrest = clamp(state.arrest - 18 * dt, 0, 100);
      }
    });
  }

  function updateCars(dt) {
    cars.forEach((car) => {
      car.hitCooldown = Math.max(0, car.hitCooldown - dt);
      const hazard = vehicleTrafficHazard(car);
      if (hazard.reason && hazard.reason === car.waitReason) {
        car.waitTime += dt;
      } else {
        car.waitTime = hazard.reason ? dt : 0;
      }
      car.waitReason = hazard.reason;
      car.waitHard = hazard.hard;
      if (car.waitReason === "person" && car.waitTime > 2.4) {
        clearNonPlayerActorsFromLane(car);
      }
      const desiredSpeed = car.waitReason ? 0 : car.targetSpeed;
      const response = desiredSpeed === 0 ? car.type.brake : car.type.accel;
      car.currentSpeed = lerp(car.currentSpeed, desiredSpeed, 1 - Math.pow(0.001, dt * response));
      if (Math.abs(car.currentSpeed) < 0.08) {
        car.currentSpeed = 0;
      }
      car.braking = Boolean(car.waitReason) || Math.abs(car.currentSpeed) < Math.abs(car.targetSpeed) * 0.72;
      updateBrakeLights(car);
      updateCarPosition(car, dt);
      const footprint = vehicleFootprintAt(car, car.offset, 0, 0.2);
      if (car.hitCooldown <= 0 && circleRectHit(player.x, player.z, player.radius, footprint)) {
        const pos = car.mesh.position;
        const dx = player.x - pos.x;
        const dz = player.z - pos.z;
        car.hitCooldown = 1.5;
        state.health = clamp(state.health - (Math.abs(car.currentSpeed) > 2 ? 8 : 3), 0, state.maxHealth);
        moveCircle(player, Math.sign(dx || 1) * 2.5, Math.sign(dz || 1) * 2.5);
        addFloater(car.waitReason ? "move!" : "watch it!", player.x, player.z, "#ffd45c");
        addPulse(player.x, player.z, 0xffd45c, 3.5, 0.45);
      }
    });
    resolveVehicleOverlaps();
    resolveActorVehicleOverlaps();
    writeTrafficDebugSnapshot();
  }

  function resolveVehicleOverlaps() {
    for (let pass = 0; pass < 8; pass += 1) {
      let fixed = false;
      for (let i = 0; i < cars.length; i += 1) {
        const car = cars[i];
        const footprint = vehicleFootprintAt(car, car.offset, 0, 0.12);
        for (let j = i + 1; j < cars.length; j += 1) {
          const other = cars[j];
          const otherFootprint = vehicleFootprintAt(other, other.offset, 0, 0.12);
          if (!rectsOverlap(footprint, otherFootprint)) {
            continue;
          }
          const mover = car.waitReason && !other.waitReason ? car : other.waitReason && !car.waitReason ? other : (car.id > other.id ? car : other);
          const backStep = Math.max(1.1, mover.type.length * 0.28);
          mover.offset = wrapLaneOffset(mover.lane, mover.offset - laneDirection(mover.lane) * backStep);
          mover.currentSpeed = 0;
          mover.waitReason = "vehicle";
          mover.waitHard = true;
          mover.waitTime = 0;
          updateCarPosition(mover, 0);
          fixed = true;
        }
      }
      if (!fixed) {
        return;
      }
    }
  }

  function resolveActorVehicleOverlaps() {
    trafficActors().forEach((actor) => {
      cars.forEach((car) => {
        const rect = vehicleFootprintAt(car, car.offset, 0, 0.08);
        if (!circleRectHit(actor.x, actor.z, actor.radius, rect)) {
          return;
        }
        const candidates = [
          { x: rect.minX - actor.radius - 0.42, z: actor.z, d: Math.abs(actor.x - rect.minX) },
          { x: rect.maxX + actor.radius + 0.42, z: actor.z, d: Math.abs(rect.maxX - actor.x) },
          { x: actor.x, z: rect.minZ - actor.radius - 0.42, d: Math.abs(actor.z - rect.minZ) },
          { x: actor.x, z: rect.maxZ + actor.radius + 0.42, d: Math.abs(rect.maxZ - actor.z) },
        ].sort((a, b) => a.d - b.d);
        const exit = candidates.find((point) => isStaticWalkable(point.x, point.z, actor.radius) && !vehicleBlocksPoint(point.x, point.z, actor.radius));
        if (!exit) {
          return;
        }
        actor.x = exit.x;
        actor.z = exit.z;
        if (actor.mesh) {
          actor.mesh.position.x = actor.x;
          actor.mesh.position.z = actor.z;
        }
      });
    });
  }

  function clearNonPlayerActorsFromLane(car) {
    const scan = vehicleFootprintAt(car, car.offset, car.type.stopDistance + 2, 0.35);
    trafficActors().forEach((actor) => {
      if (actor === player || !circleRectHit(actor.x, actor.z, actor.radius + 0.2, scan)) {
        return;
      }
      const nearest = nearestSidewalk(actor.x, actor.z);
      const point = sidewalkPoint(nearest.strip, nearest.segment, nearest.value);
      if (!isStaticWalkable(point.x, point.z, actor.radius) || vehicleBlocksPoint(point.x, point.z, actor.radius)) {
        return;
      }
      actor.x = point.x;
      actor.z = point.z;
      if (actor.mesh) {
        actor.mesh.position.x = actor.x;
        actor.mesh.position.z = actor.z;
      }
      if (civilians.includes(actor)) {
        actor.sidewalk = nearest.strip;
        actor.sidewalkSegment = nearest.segment;
        actor.sidewalkTarget = nearest.strip;
        actor.sidewalkTargetSegment = nearest.segment;
        actor.target = point;
        actor.crossing = false;
        actor.timer = rand(2.8, 6.4);
      }
    });
  }

  function updateBrakeLights(car) {
    car.brakeLights.forEach((light) => {
      light.scale.x = car.braking ? 1.65 : 1;
      light.scale.z = car.braking ? 1.22 : 1;
    });
  }

  function updateCarPosition(car, dt) {
    const lane = car.lane;
    car.offset = wrapLaneOffset(lane, car.offset + car.currentSpeed * dt);
    const pos = vehiclePositionAt(car, car.offset);
    if (lane.axis === "x") {
      car.mesh.position.set(pos.x, 0, pos.z);
      car.mesh.rotation.y = laneDirection(lane) > 0 ? 0 : Math.PI;
    } else {
      car.mesh.position.set(pos.x, 0, pos.z);
      car.mesh.rotation.y = laneDirection(lane) > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
  }

  function updatePickups(dt) {
    pickups.forEach((pickup) => {
      if (!pickup.active) {
        return;
      }
      pickup.spin += dt * 2;
      pickup.mesh.rotation.y = pickup.spin;
      pickup.mesh.position.y = Math.sin(pickup.spin * 1.7) * 0.15;
      if (distSq(pickup, player) < 2.4) {
        collectPickup(pickup);
      }
    });
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      projectile.life -= dt;
      projectile.x += projectile.vx * dt;
      projectile.z += projectile.vz * dt;
      projectile.mesh.position.x = projectile.x;
      projectile.mesh.position.z = projectile.z;
      projectile.mesh.rotation.y += dt * 11;
      const hit = zombies.find((zombie) => distSq(projectile, zombie) < 3.4);
      const copHit = cops.find((cop) => distSq(projectile, cop) < 3.0);
      const civHit = state.phase === "day" ? civilians.find((civ) => distSq(projectile, civ) < 3.0) : null;
      if (hit) {
        damageZombie(hit, projectile.dmg || 2, projectile.vx * 0.12, projectile.vz * 0.12);
        removeProjectile(i);
      } else if (copHit) {
        copHit.stun = 1.2;
        addWanted(4);
        addFloater("cone check", copHit.x, copHit.z, "#9ed4ff");
        removeProjectile(i);
      } else if (civHit) {
        civHit.panic = 2.2;
        addWanted(12);
        addFloater("hey! +wanted", civHit.x, civHit.z, "#ff7a6c");
        removeProjectile(i);
      } else if (projectile.life <= 0 || !isWalkable(projectile.x, projectile.z, 0.5)) {
        removeProjectile(i);
      }
    }
  }

  function removeProjectile(index) {
    const [projectile] = projectiles.splice(index, 1);
    if (projectile) {
      actorGroup.remove(projectile.mesh);
    }
  }

  function updatePeels(dt) {
    for (let i = peels.length - 1; i >= 0; i -= 1) {
      const peel = peels[i];
      peel.life -= dt;
      peel.mesh.rotation.y += dt * 1.5;
      if (peel.life <= 0) {
        actorGroup.remove(peel.mesh);
        peels.splice(i, 1);
        continue;
      }
      cops.forEach((cop) => {
        if (cop.slip <= 0 && distSq(peel, cop) < 2.2) {
          cop.slip = 1.8;
          addWanted(-5);
          addFloater("slip!", cop.x, cop.z, "#ffe56f");
        }
      });
      zombies.forEach((zombie) => {
        if (zombie.stun <= 0 && distSq(peel, zombie) < 2.2) {
          zombie.stun = 1.2;
          damageZombie(zombie, 1, zombie.x - peel.x, zombie.z - peel.z);
          addFloater("peel!", zombie.x, zombie.z, "#f7ff8d");
        }
      });
    }
  }

  function updateZombies(dt) {
    if (state.phase !== "night") {
      return;
    }
    if (zombies.length < state.waveTarget + 2 && Math.random() < dt * 0.18 * state.cycle) {
      const side = randomEdgePoint(1.1);
      spawnZombie(side.x, side.z, Math.random() < 0.18 ? "runner" : "shambler");
    }

    zombies.forEach((zombie) => {
      zombie.stun = Math.max(0, zombie.stun - dt);
      zombie.attack = Math.max(0, zombie.attack - dt);
      zombie.wobble += dt * 4;
      zombie.mesh.position.y = Math.sin(zombie.wobble) * 0.12;

      if (zombie.stun > 0) {
        zombie.mesh.rotation.y += dt * 5;
        return;
      }

      let dx = player.x - zombie.x;
      let dz = player.z - zombie.z;
      const mag = len2(dx, dz) || 1;
      dx /= mag;
      dz /= mag;
      const drift = Math.sin(zombie.wobble * 0.7) * 0.25;
      moveCircle(zombie, (dx + dz * drift) * zombie.speed * dt, (dz - dx * drift) * zombie.speed * dt);
      zombie.mesh.rotation.y = Math.atan2(dx, dz);

      if (mag < 2.1 && zombie.attack <= 0) {
        zombie.attack = zombie.kind === "runner" ? 0.72 : 1.1;
        state.health = clamp(state.health - (zombie.kind === "runner" ? 6 : 9), 0, state.maxHealth);
        addPulse(player.x, player.z, 0x90ff76, 2.6, 0.4);
      }
    });
  }

  function updateFX(dt) {
    for (let i = floaters.length - 1; i >= 0; i -= 1) {
      const floater = floaters[i];
      floater.life -= dt;
      floater.mesh.position.y += dt * 1.2;
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      floater.mesh.material.opacity = alpha;
      if (floater.life <= 0) {
        fxGroup.remove(floater.mesh);
        floaters.splice(i, 1);
      }
    }
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const pulse = pulses[i];
      pulse.life -= dt;
      const t = 1 - pulse.life / pulse.maxLife;
      pulse.mesh.scale.setScalar(1 + t * 1.9);
      pulse.mesh.material.opacity = clamp(0.55 * (1 - t), 0, 0.55);
      if (pulse.life <= 0) {
        fxGroup.remove(pulse.mesh);
        pulses.splice(i, 1);
      }
    }
  }

  function animateIdle(dt) {
    pickups.forEach((pickup) => {
      if (pickup.active) {
        pickup.spin += dt * 1.2;
        pickup.mesh.rotation.y = pickup.spin;
      }
    });
    updateFX(dt);
  }

  function collectPickup(pickup) {
    if (!pickup.active) {
      return;
    }
    pickup.active = false;
    actorGroup.remove(pickup.mesh);
    if (pickup.type === "cash") {
      const gain = rand(1.5, 4.2);
      state.cash += gain;
      state.tasks.buskCash += gain;
      addFloater(`+$${gain.toFixed(0)}`, pickup.x, pickup.z, "#79ff9a");
    } else if (pickup.type === "snack") {
      state.health = clamp(state.health + 16, 0, state.maxHealth);
      addFloater("+health", pickup.x, pickup.z, "#ffd080");
    } else if (ITEMS[pickup.type]) {
      const item = ITEMS[pickup.type];
      const isNew = addToBag(pickup.type, item.refill || 1);
      if (isNew) {
        logLine(`Found ${item.name}! Open the Bag (B) to equip it to slots 1-4.`);
        addFloater(`+${item.short}!`, pickup.x, pickup.z, "#ffe07a");
      } else {
        addFloater(`+${item.short}`, pickup.x, pickup.z, "#dde6ef");
      }
      refreshHotbar();
      if (state.bagOpen) renderBag();
    }
    addPulse(pickup.x, pickup.z, 0xffffff, 2.5, 0.35);
  }

  // Nearest zombie/cop within range, for auto-aim (no mouse needed).
  function nearestEnemy(maxDist) {
    let best = null;
    const scan = (list) => {
      list.forEach((thing) => {
        const d = distSq(thing, player);
        if (d <= maxDist * maxDist && (!best || d < best.d)) best = { thing, d };
      });
    };
    scan(zombies);
    scan(cops);
    return best ? best.thing : null;
  }

  function faceTarget(target) {
    if (!target) return;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const mag = len2(dx, dz) || 1;
    player.facing.x = dx / mag;
    player.facing.z = dz / mag;
    if (player.mesh) player.mesh.rotation.y = Math.atan2(player.facing.x, player.facing.z);
  }

  // ACT button: earn money with the active item's bit. Earning near a crowd or
  // the busk plaza pays more. Doing it over and over ("acting/begging too much")
  // escalates your wanted stars.
  function act() {
    if (!state.running || state.paused || state.cooldowns.act > 0) {
      return;
    }
    const earn = activeItem().earn || ITEMS.fists.earn;
    state.cooldowns.act = earn.cool || 0.5;
    const buskZone = distSq(player, points.busk) < 170;
    const nearCivs = civilians.filter((civilian) => distSq(civilian, player) < (buskZone ? 150 : 80));
    const crowd = Math.max(1, nearCivs.length) * (earn.crowd || 1);
    const tip = state.district.tip || 1;
    const [lo, hi] = earn.cash;
    const gain = (rand(lo, hi) + crowd * 0.42) * tip * (buskZone ? 1.25 : 1);
    state.cash += gain;
    state.tasks.buskCash += gain;
    bumpActStreak();
    addWanted((earn.wanted || 1) * (1 + (state.actStreak - 1) * 0.45));
    nearCivs.forEach((civilian) => {
      civilian.tipped = 4;
    });
    addFloater(`+$${gain.toFixed(0)} ${earn.label || ""}`.trim(), player.x, player.z, "#73ff91");
    addPulse(player.x, player.z, earn.crowd ? 0xffbf47 : 0x74fff0, earn.crowd ? 6.4 : 4.4, 0.55);
  }

  // ATTACK button: dispatches on the active item's attack type. Hitting regular
  // people spikes wanted hard — that's the "don't be too aggressive" rule.
  function attack() {
    if (!state.running || state.paused || state.cooldowns.attack > 0) {
      return;
    }
    const item = activeItem();
    const a = item.attack || ITEMS.fists.attack;
    if (a.kind === "throw") {
      throwItem(item, a);
    } else if (a.kind === "trap") {
      dropTrap(item, a);
    } else {
      meleeAttack(item, a);
    }
  }

  function meleeAttack(item, a) {
    state.cooldowns.attack = a.cool || 0.45;
    const reach = a.range || 3.8;
    faceTarget(nearestEnemy(reach * 1.6));
    let hits = 0;
    zombies.slice().forEach((zombie) => {
      if (distSq(zombie, player) <= reach * reach) {
        damageZombie(zombie, a.dmg || 1.2, zombie.x - player.x, zombie.z - player.z);
        if (a.stun) zombie.stun = Math.max(zombie.stun, a.stun);
        hits += 1;
      }
    });
    cops.forEach((cop) => {
      if (distSq(cop, player) <= (reach + 1.4) * (reach + 1.4)) {
        cop.stun = 0.55;
        addWanted(2.5);
      }
    });
    let hitCivilian = false;
    civilians.forEach((civilian) => {
      if (distSq(civilian, player) <= reach * reach) {
        civilian.panic = a.confuse ? 2.8 : 1.9;
        hitCivilian = true;
      }
    });
    if (hitCivilian) {
      addWanted(16);
      addFloater("assault! +wanted", player.x, player.z, "#ff7a6c");
    } else {
      addFloater(hits ? a.label || "bonk!" : "swing", player.x, player.z, hits ? "#f5ff9d" : "#d4d7dd");
    }
    addPulse(player.x + player.facing.x * 1.8, player.z + player.facing.z * 1.8, 0xffffff, 3.2, 0.25);
  }

  function throwItem(item, a) {
    if (item.count && (state.inventory[item.count] || 0) <= 0) {
      addFloater(`no ${item.short.toLowerCase()}s`, player.x, player.z, "#ffb3a7");
      return;
    }
    state.cooldowns.attack = a.cool || 0.6;
    faceTarget(nearestEnemy(a.range || 27));
    if (item.count) state.inventory[item.count] -= 1;
    const group = new THREE.Group();
    const cone = addCone(group, 0.52, 1.1, 0, 0, 0, materials.cone, 8);
    cone.rotation.x = Math.PI / 2;
    group.position.set(player.x + player.facing.x * 1.6, 0.7, player.z + player.facing.z * 1.6);
    actorGroup.add(group);
    projectiles.push({
      x: group.position.x,
      z: group.position.z,
      vx: player.facing.x * 27,
      vz: player.facing.z * 27,
      life: 1.1,
      dmg: a.dmg || 2,
      mesh: group,
    });
    addFloater(a.label || "throw", player.x, player.z, "#ffb878");
    refreshHotbar();
  }

  function dropTrap(item, a) {
    if (item.count && (state.inventory[item.count] || 0) <= 0) {
      addFloater(`no ${item.short.toLowerCase()}s`, player.x, player.z, "#ffb3a7");
      return;
    }
    state.cooldowns.attack = a.cool || 0.45;
    if (item.count) state.inventory[item.count] -= 1;
    const x = player.x - player.facing.x * 1.1;
    const z = player.z - player.facing.z * 1.1;
    const mesh = makeMesh(new THREE.TorusGeometry(0.55, 0.12, 6, 12), materials.peel, x, 0.12, z, true, false);
    mesh.scale.z = 0.45;
    actorGroup.add(mesh);
    peels.push({ x, z, life: 12, mesh });
    addFloater(a.label || "trap set", x, z, "#ffe96d");
    refreshHotbar();
  }

  function damageZombie(zombie, amount, kx = 0, kz = 0) {
    zombie.health -= amount;
    const mag = len2(kx, kz) || 1;
    moveCircle(zombie, (kx / mag) * 1.7, (kz / mag) * 1.7);
    addPulse(zombie.x, zombie.z, 0x8aff6a, 2.1, 0.25);
    if (zombie.health <= 0) {
      const index = zombies.indexOf(zombie);
      if (index !== -1) {
        zombies.splice(index, 1);
      }
      actorGroup.remove(zombie.mesh);
      state.waveKills += 1;
      state.cash += 0.75;
      addFloater("+tweeker clear", zombie.x, zombie.z, "#adff94");
      if (state.phase === "night" && state.waveKills >= state.waveTarget) {
        beginDay();
      }
    }
  }

  function updateCamera(dt) {
    cameraTarget.x = lerp(cameraTarget.x, player.x, 1 - Math.pow(0.001, dt));
    cameraTarget.z = lerp(cameraTarget.z, player.z, 1 - Math.pow(0.001, dt));
    const viewHalfW = Math.max(1, (camera.right - camera.left) / 2);
    const viewHalfH = Math.max(1, (camera.top - camera.bottom) / 2);
    const x = clamp(cameraTarget.x, -WORLD.width / 2 + viewHalfW, WORLD.width / 2 - viewHalfW);
    const z = clamp(cameraTarget.z, -WORLD.height / 2 + viewHalfH, WORLD.height / 2 - viewHalfH);
    camera.position.set(x, 76, z + 9);
    camera.lookAt(x, 0, z);
  }

  function updateLighting() {
    const night = state.phase === "night" ? 1 : 0;
    const wantedTint = clamp(state.wanted / 100, 0, 1);
    sun.intensity = lerp(1.18, 0.42, night);
    ambient.intensity = lerp(0.62, 0.34, night);
    nightLight.intensity = lerp(0, 1.7 + wantedTint, night);
    renderer.setClearColor(new THREE.Color(lerp(0x6a, 0x18, night) / 255, lerp(0xb1, 0x24, night) / 255, lerp(0xd0, 0x2e, night) / 255), 1);
    scene.fog.color.setHex(night ? 0x1b2532 : 0x78abc1);
    scene.fog.near = night ? 45 : 145;
    scene.fog.far = night ? 135 : 290;
  }

  function updateHUD() {
    updateLighting();
    ui.setWidth(els.healthFill, (state.health / state.maxHealth) * 100);
    ui.setText(els.healthText, `${Math.round(state.health)}`);
    ui.setText(els.cashLarge, `$${state.cash.toFixed(2)}`);

    // Wanted stars + fill.
    const stars = starLevel();
    if (els.stars) {
      [...els.stars.children].forEach((star, index) => {
        star.classList.toggle("is-lit", index < stars);
      });
    }
    ui.setWidth(els.wantedFill, state.wanted);
    if (els.chase) els.chase.hidden = !copsChasing();

    // Clock + phase pill.
    const phaseLimit = state.phase === "day" ? state.dayLength : state.nightLength;
    const minutes = Math.floor((state.phaseTime / phaseLimit) * 720);
    const baseHour = state.phase === "day" ? 8 : 20;
    const hour24 = (baseHour + Math.floor(minutes / 60)) % 24;
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    ui.setText(els.clock, `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`);
    ui.setText(els.phasePill, `${state.phase === "day" ? "Day" : "Night"} ${state.cycle}`);

    // Objective line with live progress.
    const objective =
      state.phase === "day"
        ? `Earn $${Math.min(20, Math.floor(state.tasks.buskCash))}/20 before dusk`
        : `Survive — ${Math.max(0, state.waveTarget - state.waveKills)} zombies left`;
    ui.setText(els.objectiveText, objective);
    if (els.objectiveArrow) {
      const target = objectivePoint();
      const angle = Math.atan2(target.x - player.x, target.z - player.z);
      els.objectiveArrow.style.transform = `rotate(${angle}rad)`;
    }

    if (els.miniPlayer) {
      const left = ((player.x + WORLD.width / 2) / WORLD.width) * 100;
      const top = ((player.z + WORLD.height / 2) / WORLD.height) * 100;
      els.miniPlayer.style.left = `${clamp(left, 4, 96)}%`;
      els.miniPlayer.style.top = `${clamp(top, 4, 96)}%`;
    }

    refreshHotbar();
  }

  function objectivePoint() {
    if (state.phase === "night") {
      const nearest = zombies.reduce((best, zombie) => {
        const d = distSq(zombie, player);
        return !best || d < best.d ? { zombie, d } : best;
      }, null);
      return nearest ? nearest.zombie : points.alley;
    }
    if (copsChasing()) return points.camp;
    // Point at the nearest cash/item pickup, else the busk plaza.
    let target = null;
    pickups.forEach((pickup) => {
      if (!pickup.active) return;
      const d = distSq(pickup, player);
      if (!target || d < target.d) target = { x: pickup.x, z: pickup.z, d };
    });
    return target || points.busk;
  }

  function resize() {
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || canvas.clientWidth || 960);
    const height = Math.max(240, rect.height || canvas.clientHeight || 600);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = VISUAL_TARGET ? 58 : 52;
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    update(dt);
    render();
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    keys[key] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
    }
    if (key === "tab" || key === "b") {
      event.preventDefault();
    }
    if (key === "escape") {
      const wrap = canvas.closest(".canvas-wrap");
      if (wrap && wrap.classList.contains("is-maxed")) {
        return; // let the max-screen handler exit; don't also pause
      }
      if (state.bagOpen) {
        toggleBag(false);
        return;
      }
      setPaused(!state.paused);
      return;
    }
    if (!state.running && key !== "tab" && key !== "b") {
      startGame();
    }
    if (key === "e" || key === " ") act();
    if (key === "f" || key === "j") attack();
    if (key === "1") selectSlot(0);
    if (key === "2") selectSlot(1);
    if (key === "3") selectSlot(2);
    if (key === "4") selectSlot(3);
    if (key === "b" || key === "tab") toggleBag();
    if (key === "p") setPaused(!state.paused);
  }

  function onKeyUp(event) {
    keys[event.key.toLowerCase()] = false;
  }

  function bindButtons() {
    els.primary?.addEventListener("click", () => {
      if (state.paused) {
        state.paused = false;
        els.overlay?.classList.remove("overlay--show");
        return;
      }
      startGame();
    });
    els.pause?.addEventListener("click", () => setPaused(!state.paused));
    els.restart?.addEventListener("click", () => {
      if (saveSlot) saveSlot.clear();
      resetGame(true);
    });
    // Hotbar slot selection (works for click and tap).
    els.hotbar?.addEventListener("click", (event) => {
      const slot = event.target.closest("[data-slot]");
      if (slot) {
        selectSlot(Number(slot.dataset.slot));
        canvas.focus({ preventScroll: true });
      }
    });
    // Bag: tap an item to equip it into the active slot.
    els.bagGrid?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-item]");
      if (item) {
        equipToSlot(item.dataset.item, state.activeSlot);
        renderBag();
      }
    });
    document.getElementById("bag-close")?.addEventListener("click", () => toggleBag(false));
    document.getElementById("btn-bag")?.addEventListener("click", () => toggleBag());

    bindActionTouch("touch-act", act);
    bindActionTouch("touch-attack", attack);
    bindActionTouch("touch-bag", () => toggleBag());
    bindTouchStick();
    bindFullscreen();
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: els.primary,
        scoreEl: els.overlayScore,
        continueLabel: "Continue run",
        newLabel: "New run",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Cycle <strong>${Number(data.cycle || 1)}</strong> · Cash <strong>$${Number(data.cash || 0).toFixed(2)}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.running && !state.ended);
    }
  }

  function snapshot() {
    return {
      phase: state.phase,
      cycle: state.cycle,
      phaseTime: state.phaseTime,
      cash: state.cash,
      wanted: state.wanted,
      health: state.health,
      score: state.score,
      bag: { ...state.bag },
      hotbar: state.hotbar.slice(),
      activeSlot: state.activeSlot,
      inventory: { ...state.inventory },
      tasks: { ...state.tasks },
      waveTarget: state.waveTarget,
      waveKills: state.waveKills,
      objective: state.objective,
      player: {
        x: player.x,
        z: player.z,
        y: player.y,
        facing: { ...player.facing },
        stun: player.stun,
      },
    };
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data) return;
    resetGame(false);
    Object.assign(state, {
      running: true,
      paused: false,
      ended: false,
      phase: data.phase === "night" ? "night" : "day",
      cycle: Math.max(1, Number(data.cycle) || 1),
      phaseTime: Math.max(0, Number(data.phaseTime) || 0),
      cash: Number(data.cash) || 0,
      wanted: clamp(Number(data.wanted) || 0, 0, 100),
      arrest: 0,
      health: clamp(Number(data.health) || state.maxHealth, 0, state.maxHealth),
      score: Number(data.score) || 0,
      bag: data.bag && typeof data.bag === "object" ? { ...data.bag } : state.bag,
      hotbar: Array.isArray(data.hotbar) ? data.hotbar.slice(0, 4) : state.hotbar,
      activeSlot: clamp(Number(data.activeSlot) || 0, 0, 3),
      inventory: { ...state.inventory, ...(data.inventory || {}) },
      tasks: { ...state.tasks, ...(data.tasks || {}) },
      waveTarget: Number(data.waveTarget) || 8,
      waveKills: Number(data.waveKills) || 0,
      objective: data.objective || "Earn $20 before nightfall",
    });
    // Always own whatever sits on the hotbar (guards against corrupt saves).
    state.hotbar.forEach((id) => {
      if (id) state.bag[id] = true;
    });
    state.bag.fists = true;
    Object.assign(player, {
      x: Number(data.player && data.player.x) || points.start.x,
      z: Number(data.player && data.player.z) || points.start.z,
      y: Number(data.player && data.player.y) || 0,
      stun: Number(data.player && data.player.stun) || 0,
    });
    if (data.player && data.player.facing) {
      player.facing.x = Number(data.player.facing.x) || 0;
      player.facing.z = Number(data.player.facing.z) || -1;
    }
    refreshHotbar();
    updateHUD();
    els.overlay?.classList.remove("overlay--show");
    canvas.focus({ preventScroll: true });
    logLine("Saved block restored.");
  }

  // On-canvas touch action buttons (shown on touch devices and in max screen).
  function bindActionTouch(id, action) {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("is-held");
      if (!state.running && !state.ended) {
        startGame();
        return;
      }
      action();
      canvas.focus({ preventScroll: true });
    });
    const clear = () => button.classList.remove("is-held");
    button.addEventListener("pointerup", clear);
    button.addEventListener("pointercancel", clear);
    button.addEventListener("pointerleave", clear);
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap") || canvas.parentElement;
    if (!fsTarget) return;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const updateBtn = () => {
      if (!fsBtn) return;
      const on = isMaxed();
      fsBtn.textContent = on ? "✕" : "⛶";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", on ? "Exit" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateBtn();
      // Let the renderer re-fit to the new wrap size.
      window.dispatchEvent(new Event("resize"));
      resize();
      if (on) canvas.focus({ preventScroll: true });
    };
    const toggle = () => {
      const on = !isMaxed();
      setMaxed(on);
      // Pair with the native Fullscreen API where supported (hides browser
      // chrome). The .is-maxed class drives layout, so this is best-effort.
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
    if (fsBtn) fsBtn.addEventListener("click", toggle);
    const onNativeFsChange = () => {
      if (!nativeFsEl() && isMaxed()) setMaxed(false);
    };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
    });
    updateBtn();
  }


  function bindTouchStick() {
    const stick = document.getElementById("unhinged-touch-stick");
    if (!stick) return;
    let pointerId = null;
    let origin = null;
    const update = (event) => {
      if (!origin) return;
      const radius = Math.max(32, Math.min(stick.clientWidth, stick.clientHeight) * 0.42);
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 8) {
        mobileMove.x = 0;
        mobileMove.z = 0;
        return;
      }
      const scale = Math.min(1, distance / radius);
      mobileMove.x = (dx / distance) * scale;
      mobileMove.z = (dy / distance) * scale;
      canvas.focus({ preventScroll: true });
    };
    const release = () => {
      pointerId = null;
      origin = null;
      mobileMove.x = 0;
      mobileMove.z = 0;
      stick.classList.remove("is-held");
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      pointerId = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      stick.classList.add("is-held");
      if (stick.setPointerCapture) {
        try { stick.setPointerCapture(event.pointerId); } catch (_) {}
      }
      update(event);
    });
    stick.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      update(event);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      stick.addEventListener(eventName, (event) => {
        if (eventName !== "lostpointercapture" && event.pointerId !== pointerId) return;
        release();
      });
    });
    window.addEventListener("blur", release);
  }

  function trafficDebugSnapshot() {
    const vehicles = cars.map((car) => ({
      id: car.id,
      type: car.type.id,
      lane: car.lane.axis,
      offset: Number(car.offset.toFixed(2)),
      speed: Number(car.currentSpeed.toFixed(2)),
      targetSpeed: Number(car.targetSpeed.toFixed(2)),
      braking: car.braking,
      waitReason: car.waitReason,
      waitHard: car.waitHard,
      waitTime: Number(car.waitTime.toFixed(2)),
      footprint: vehicleFootprintAt(car, car.offset, 0, 0.2),
    }));
    const vehicleOverlaps = [];
    const actorOverlaps = [];
    cars.forEach((car, index) => {
      const footprint = vehicleFootprintAt(car, car.offset, 0, 0.2);
      cars.slice(index + 1).forEach((other) => {
        const otherFootprint = vehicleFootprintAt(other, other.offset, 0, 0.2);
        if (rectsOverlap(footprint, otherFootprint)) {
          vehicleOverlaps.push([car.id, other.id]);
        }
      });
      trafficActors().forEach((actor) => {
        if (circleRectHit(actor.x, actor.z, actor.radius, footprint)) {
          actorOverlaps.push({ vehicle: car.id, actorX: Number(actor.x.toFixed(1)), actorZ: Number(actor.z.toFixed(1)) });
        }
      });
    });
    const waitCounts = vehicles.reduce((acc, vehicle) => {
      const key = vehicle.waitReason || "moving";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      map: {
        width: WORLD.width,
        height: WORLD.height,
        areaScale: Number(((WORLD.width * WORLD.height) / (118 * 86)).toFixed(2)),
        roadX: ROAD_X,
        roadZ: ROAD_Z,
        lanes: lanes.length,
      },
      vehicleCount: vehicles.length,
      types: Array.from(new Set(vehicles.map((vehicle) => vehicle.type))).sort(),
      braking: vehicles.filter((vehicle) => vehicle.braking || Math.abs(vehicle.speed) < Math.abs(vehicle.targetSpeed) * 0.65).length,
      longStops: vehicles.filter((vehicle) => vehicle.waitReason === "vehicle" && Math.abs(vehicle.speed) < 0.1 && vehicle.waitTime > 2.8).length,
      maxWait: vehicles.reduce((max, vehicle) => Math.max(max, vehicle.waitTime || 0), 0),
      pedestriansCrossing: civilians.filter((civilian) => civilian.crossing).length,
      pedestriansOnRoad: civilians.filter((civilian) => pointNearRoad(civilian.x, civilian.z, -0.2)).length,
      waitCounts,
      vehicles: vehicles.map(({ footprint, ...vehicle }) => vehicle),
      overlaps: { vehicleOverlaps, actorOverlaps },
    };
  }

  function writeTrafficDebugSnapshot() {
    if (DEBUG) {
      document.documentElement.dataset.unhousedTraffic = JSON.stringify(trafficDebugSnapshot());
    }
  }

  function installDebugHooks() {
    const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
    if (DEBUG) {
      window.__unhousedTrafficDebug = {
        state,
        snapshot: trafficDebugSnapshot,
      };
      writeTrafficDebugSnapshot();
    }
    if (DEBUG || local) {
      window.__UNHINGED = {
        state,
        player,
        start: () => startGame(),
        setCash: (n) => {
          state.cash = Number(n) || 0;
          updateHUD();
        },
        setStars: (n) => {
          state.wanted = clamp((Number(n) || 0) * 20, 0, 100);
          updateHUD();
        },
        giveItem: (id, n) => {
          addToBag(id, n || (ITEMS[id] && ITEMS[id].refill) || 2);
          refreshHotbar();
          if (state.bagOpen) renderBag();
        },
        equip: (id, slot) => equipToSlot(id, slot == null ? state.activeSlot : slot),
        skipToNight: () => {
          if (state.phase === "day") {
            state.phaseTime = 0;
            beginNight();
          }
        },
        skipToDay: () => {
          if (state.phase === "night") {
            state.phaseTime = 0;
            beginDay();
          }
        },
        god: (on) => {
          state._god = on !== false;
          state.health = state.maxHealth;
        },
        activeItem: () => activeItem().id,
      };
    }
  }

  function init() {
    buildWorld();
    resetGame(false);
    installDebugHooks();
    resize();
    updateCamera(1);
    updateHUD();
    render();
    bindButtons();
    buildHotbar();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // Mouse users get one-tap combat with auto-aim — left-click anywhere on the
    // canvas attacks the nearest enemy. No cursor aiming required.
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") return;
      canvas.focus({ preventScroll: true });
      if (!state.running && !state.ended) {
        startGame();
        return;
      }
      if (event.button === 0) attack();
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    loop();
  }

  init();
})();
