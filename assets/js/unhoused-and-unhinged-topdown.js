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
  const BUSTED_CAPTIONS = [
    "The judge didn't appreciate your cardboard acoustic performance.",
    "You tried to bribe the officer with a soggy banana peel. It didn't work.",
    "Sentence: 30 days of community service cleaning up public parks. The irony.",
    "Your bail has been set to 500 aluminum cans. Start scavenging.",
    "The precinct cells are surprisingly warmer than the subway grate. Silver linings.",
    "Charged with public disturbance, illegal busking, and excessive swagger.",
    "Locked up for being unhoused and too unhinged.",
    "You argued that public benches are a natural resource. The judge disagreed.",
    "Charged with resisting arrest by cartwheels. That's a new record."
  ];
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
    bustedOverlay: document.getElementById("busted-overlay"),
    bustedCaption: document.getElementById("busted-caption"),
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
    miniMapCanvas: document.getElementById("mini-map-canvas"),
    districtName: document.getElementById("hud-district-name"),
    hotbar: document.getElementById("hud-hotbar"),
    hotbarSlots: null,
    bagOverlay: document.getElementById("bag-overlay"),
    bagGrid: document.getElementById("bag-grid"),
    bagSlotPicker: document.getElementById("bag-slot-picker"),
    bagHint: document.getElementById("bag-hint"),
    mapOverlay: document.getElementById("map-overlay"),
    mapCanvas: document.getElementById("map-canvas"),
    mapLegend: document.getElementById("map-legend"),
    mapHint: document.getElementById("map-hint"),
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
    zombieSpit: mat("zombieSpit", 0xc7e04a),
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
    mopHead: mat("mopHead", 0xe8e2c8),
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
    {
      id: "police",
      color: 0x161719, // Black body base
      length: 4.7,
      width: 2.25,
      bodyHeight: 0.9,
      cabinLength: 2.35,
      cabinWidth: 1.55,
      cabinHeight: 0.68,
      speedScale: 1.25, // Police cars are faster
      accel: 5.8,
      brake: 14,
      stopDistance: 8.2,
      priority: 5, // High priority
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
    policeStation: { x: -40, z: -6.5 },
  };

  const MAP_LANDMARKS = [
    { id: "camp", name: "Camp Row", x: points.camp.x, z: points.camp.z, kind: "safe", blurb: "Lie low and recover." },
    { id: "kiosk", name: "Pawn Cart", x: points.kiosk.x, z: points.kiosk.z, kind: "shop", blurb: "Buy weapons and restocks by day." },
    { id: "park", name: "Busk Park", x: points.park.x, z: points.park.z, kind: "earn", blurb: "Big crowds, higher tips and heat." },
    { id: "busk", name: "Crosswalk Circus", x: points.busk.x, z: points.busk.z, kind: "earn", blurb: "Stunt bits and sidewalk tips." },
    { id: "alley", name: "Tweeker Alley", x: points.alley.x, z: points.alley.z, kind: "danger", blurb: "Night zombie pressure zone." },
    { id: "fountain", name: "Fountain Plaza", x: points.fountain.x, z: points.fountain.z, kind: "loot", blurb: "Snacks and pickups." },
    { id: "cache", name: "Pawn Alley", x: points.cache.x, z: points.cache.z, kind: "loot", blurb: "Scrap, props, and finds." },
    { id: "police", name: "Police Station", x: points.policeStation.x, z: points.policeStation.z, kind: "danger", blurb: "Heat magnet — avoid when wanted." },
  ];

  const MAP_KIND_COLORS = {
    safe: "#75ff92",
    shop: "#c77dff",
    earn: "#ffd43b",
    danger: "#ff6c6c",
    loot: "#2ee0ff",
    objective: "#ff9d5c",
    you: "#2ee0ff",
  };

  const FAVORS = [
    {
      id: "busk-park-crowd",
      name: "Pack Busk Park",
      district: "Busk Park",
      target: points.park,
      kind: "act",
      goal: 3,
      minAudience: 4,
      hud: "Busk Park crowd",
      intro: "District Favor: draw three real crowds in Busk Park.",
      reward: "Busk Park tipped heavy. +$8, heat cooled.",
    },
    {
      id: "camp-row-supplies",
      name: "Camp Supply Run",
      district: "Camp Row",
      target: points.camp,
      kind: "pickup",
      types: ["snack", "scrap"],
      goal: 2,
      hud: "Camp supplies",
      intro: "District Favor: grab two snacks or scrap piles around Camp Row.",
      reward: "Camp Row patched you up. Max health up.",
    },
    {
      id: "tweeker-alley-traps",
      name: "Alley Trap Prep",
      district: "Tweeker Alley",
      target: points.alley,
      kind: "trap",
      goal: 3,
      hud: "Alley traps",
      intro: "District Favor: drop three banana peels in Tweeker Alley before night.",
      reward: "Alley traps armed. Tonight's wave thins out.",
    },
    {
      id: "pawn-alley-tools",
      name: "Pawn Alley Finds",
      district: "Pawn Alley",
      target: points.cache,
      kind: "pickup",
      types: ["scrap", "boombox", "sign", "chicken"],
      goal: 2,
      hud: "Pawn finds",
      intro: "District Favor: scavenge two useful finds in Pawn Alley.",
      reward: "Pawn Alley kicked loose spare props.",
    },
    {
      id: "crosswalk-circus-bit",
      name: "Crosswalk Circus",
      district: "Crosswalk Circus",
      target: points.busk,
      kind: "act",
      goal: 3,
      minAudience: 2,
      hud: "Crosswalk bits",
      intro: "District Favor: land three sidewalk bits at Crosswalk Circus.",
      reward: "Crosswalk Circus loved it. Cash up, heat down.",
    },
    {
      id: "coupon-canyon-restock",
      name: "Coupon Canyon Restock",
      district: "Coupon Canyon",
      target: points.kiosk,
      kind: "pickup",
      types: ["snack", "cone", "peel"],
      goal: 3,
      hud: "Coupon restock",
      intro: "District Favor: restock three supplies in Coupon Canyon.",
      reward: "Coupon Canyon doubled the coupons.",
    },
  ];

  const keys = Object.create(null);
  const mobileMove = { x: 0, z: 0 };
  const clock = new THREE.Clock();
  const AUDIENCE_RADIUS = 13.5;
  const BUSK_AUDIENCE_RADIUS = 17;
  const AGGRESSION_RADIUS = 11.5;
  const WATCH_EMOJIS = ["👀", "😂", "👏", "💸", "🔥"];
  const PANIC_EMOJIS = ["😱", "🏃", "🚨", "❗"];
  const emojiTextureCache = Object.create(null);

  // ----------------------------------------------------------------------------
  // Items: collectible props that flavor the two action buttons. The hotbar's
  // active item drives BOTH buttons — ACT (perform for tips) runs its `earn` behavior,
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
      earn: { cash: [1.8, 2.8], cool: 0.5, wanted: 0.7, label: "sign bit" },
      attack: { kind: "melee", dmg: 0.9, range: 3.4, cool: 0.5, label: "sign smack" },
    },
    chicken: {
      id: "chicken", name: "Rubber Chicken", short: "Chicken",
      earn: { cash: [2.2, 3.8], cool: 0.6, wanted: 2.2, label: "comedy bit" },
      attack: { kind: "melee", dmg: 1.0, range: 3.8, cool: 0.4, confuse: true, label: "squeak" },
    },
    mop: {
      id: "mop", name: "Mop Spear", short: "Mop",
      earn: { cash: [1.6, 2.8], cool: 0.55, wanted: 1.2, label: "mop twirl" },
      attack: { kind: "melee", dmg: 2.2, range: 6.6, cool: 0.52, stun: 0.55, label: "mop poke" },
    },
  };
  const STARTER_HOTBAR = ["fists", "cone", "plunger", "peel"];
  // Pawn Cart stock at the kiosk. Weapons are one-time unlocks; restocks refill
  // consumables up to their cap. The cart offers the first unowned weapon, then
  // falls back to restocks, so ACT near the kiosk always has a sensible buy.
  const SHOP_RADIUS = 7.5;
  const SHOP_STOCK = [
    { id: "mop", price: 14, kind: "weapon", label: "Mop Spear" },
    { id: "chicken", price: 9, kind: "weapon", label: "Rubber Chicken" },
    { id: "cone", price: 3, kind: "restock", qty: 3, label: "Cones x3" },
    { id: "peel", price: 3, kind: "restock", qty: 2, label: "Peels x2" },
  ];
  let kioskPromptSprite = null;
  let kioskPromptText = "";
  let cameraTarget = new THREE.Vector3(0, 0, 0);
  let labelCounter = 0;
  let arrestTimeout = null;

  const state = {
    running: false,
    drivingCar: null,
    paused: false,
    ended: false,
    arrestTransition: false,
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
    slow: 0,
    score: 0,
    high: Number(localStorage.getItem(SAVE_KEY) || 0),
    bag: {},
    hotbar: STARTER_HOTBAR.slice(),
    activeSlot: 0,
    actStreak: 0,
    actStreakTime: 0,
    bagOpen: false,
    bagPickItem: null,
    bagSlotPrimed: false,
    mapOpen: false,
    inventory: {
      cone: 5,
      peel: 2,
    },
    tasks: {
      buskCash: 0,
      nightRelief: 0,
    },
    cooldowns: {
      act: 0,
      attack: 0,
      hurt: 0,
      log: 0,
      copWitness: 0,
    },
    district: districts[4],
    waveTarget: 8,
    waveKills: 0,
    objective: "Earn $20 before nightfall",
    favor: null,
    lastAudience: {
      watching: 0,
      panicked: 0,
      cash: 0,
      wanted: 0,
    },
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
  const gooBlobs = [];
  const peels = [];
  const floaters = [];
  const pulses = [];
  const actionFX = [];
  let hijackPromptSprite = null;

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

  function randomSidewalkPointNear(anchor, spread = 14, radius = 0.85) {
    for (let i = 0; i < 80; i += 1) {
      const raw = {
        x: anchor.x + rand(-spread, spread),
        z: anchor.z + rand(-spread, spread),
      };
      const nearest = nearestSidewalk(raw.x, raw.z);
      const point = sidewalkPoint(nearest.strip, nearest.segment, nearest.value);
      if (isWalkable(point.x, point.z, radius)) {
        return { ...point, strip: nearest.strip, segment: nearest.segment };
      }
    }
    return randomSidewalkPoint(radius);
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
    
    // 1. Determine Building Style for visual variety
    let style = "classic";
    if (label) {
      if (label.includes("HOTEL") || label.includes("POLICE") || label.includes("SHELTER") || label.includes("DEPOT")) {
        if (h > 7.0) {
          style = "tiered";
        } else if (label.includes("DEPOT")) {
          style = "industrial";
        }
      } else if (label.includes("RECYCLE") || label.includes("DEPOT")) {
        style = "industrial";
      } else {
        style = "storefront";
      }
    } else {
      // Unlabeled buildings: alternate between classic and pyramid roof for variety
      const seed = Math.floor(Math.abs(x + z));
      style = (seed % 2 === 0) ? "pyramid" : "classic";
    }

    // Determine Corner Accent Pillars Material
    let accentMat = materials.curb;
    if (wall === materials.brick) {
      accentMat = materials.concreteLight;
    } else if (wall === materials.blueWall) {
      accentMat = materials.sidewalkWarm;
    } else if (wall === materials.purpleWall) {
      accentMat = materials.sidewalkMint;
    }

    let building;

    if (style === "tiered") {
      // TIERED STYLE: Skyscraper/Office setback tower shape
      const hBase = h * 0.55;
      const hTower = h * 0.45;
      const wSub = w * 0.76;
      const dSub = d * 0.76;

      // Base Section
      building = addBox(staticGroup, w, hBase, d, x, 0, z, wall, true);
      
      // Base pillars
      addBox(staticGroup, 0.45, hBase, 0.45, x - w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x + w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x - w / 2, 0, z + d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x + w / 2, 0, z + d / 2, accentMat, false);
      
      // Base roof trim
      addBox(staticGroup, w + 0.4, 0.22, d + 0.4, x, hBase, z, roof, false);

      // Tower Section
      addBox(staticGroup, wSub, hTower, dSub, x, hBase, z, wall, false);
      
      // Tower pillars
      addBox(staticGroup, 0.38, hTower, 0.38, x - wSub / 2, hBase, z - dSub / 2, accentMat, false);
      addBox(staticGroup, 0.38, hTower, 0.38, x + wSub / 2, hBase, z - dSub / 2, accentMat, false);
      addBox(staticGroup, 0.38, hTower, 0.38, x - wSub / 2, hBase, z + dSub / 2, accentMat, false);
      addBox(staticGroup, 0.38, hTower, 0.38, x + wSub / 2, hBase, z + dSub / 2, accentMat, false);
      
      // Tower roof trim
      addBox(staticGroup, wSub + 0.5, 0.26, dSub + 0.5, x, h, z, roof, false);
      
      // Tower skylight
      addBox(staticGroup, Math.max(1.5, wSub * 0.3), 0.24, Math.max(1.2, dSub * 0.28), x - wSub * 0.18, h + 0.26, z - dSub * 0.12, materials.glass, false);

      // Windows
      addWindowRows(x, z, w, d, hBase, 0);
      addWindowRows(x, z, wSub, dSub, hTower, hBase);

    } else if (style === "pyramid") {
      // PYRAMID STYLE: Residential houses with pitched gabled roofs
      const hBase = h * 0.82;
      building = addBox(staticGroup, w, hBase, d, x, 0, z, wall, true);
      
      // Pillars
      addBox(staticGroup, 0.45, hBase, 0.45, x - w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x + w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x - w / 2, 0, z + d / 2, accentMat, false);
      addBox(staticGroup, 0.45, hBase, 0.45, x + w / 2, 0, z + d / 2, accentMat, false);

      // Pitch Roof (Cone with 4 sides, scaled to fit building footprint)
      const pyrH = Math.min(w, d) * 0.42;
      const pyrGeom = new THREE.ConeGeometry(0.7071, pyrH, 4);
      pyrGeom.rotateY(Math.PI / 4);
      const pyr = makeMesh(pyrGeom, roof, x, hBase + pyrH / 2, z);
      pyr.scale.set(w, 1, d);
      staticGroup.add(pyr);

      // Windows
      addWindowRows(x, z, w, d, hBase, 0);

    } else if (style === "industrial") {
      // INDUSTRIAL STYLE: Warehouses with large garage shutter doors
      building = addBox(staticGroup, w, h, d, x, 0, z, wall, true);

      // Pillars
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z + d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z + d / 2, accentMat, false);

      // Roof trim & skylight
      addBox(staticGroup, w + 0.65, 0.32, d + 0.65, x, h, z, roof, false);
      addBox(staticGroup, Math.max(2, w * 0.3), 0.26, Math.max(1.6, d * 0.28), x - w * 0.18, h + 0.32, z - d * 0.12, materials.glass, false);

      // Large metal roller garage door (in +Z direction)
      const doorW = w * 0.45;
      const doorX = x + w * 0.12;
      addBox(staticGroup, doorW, 3.0, 0.1, doorX, 0, z + d / 2 + 0.02, materials.asphaltDark, false);
      // Garage door vertical tracks
      addBox(staticGroup, 0.18, 3.0, 0.18, doorX - doorW / 2, 0, z + d / 2 + 0.03, materials.curb, false);
      addBox(staticGroup, 0.18, 3.0, 0.18, doorX + doorW / 2, 0, z + d / 2 + 0.03, materials.curb, false);

      // Smaller side pedestrian door
      addBox(staticGroup, 1.2, 2.0, 0.1, x - w * 0.28, 0, z + d / 2 + 0.02, materials.black, false);

      // Windows
      addWindowRows(x, z, w, d, h, 0);

    } else if (style === "storefront") {
      // STOREFRONT STYLE: Retail storefronts with large glass display windows
      building = addBox(staticGroup, w, h, d, x, 0, z, wall, true);

      // Pillars
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z + d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z + d / 2, accentMat, false);

      // Roof trim & skylight
      addBox(staticGroup, w + 0.65, 0.32, d + 0.65, x, h, z, roof, false);
      addBox(staticGroup, Math.max(2, w * 0.3), 0.26, Math.max(1.6, d * 0.28), x - w * 0.18, h + 0.32, z - d * 0.12, materials.glass, false);

      // Center Door
      addBox(staticGroup, 1.8, 2.2, 0.1, x, 0, z + d / 2 + 0.02, materials.black, false);
      
      // Large ground-floor glass show-windows
      addBox(staticGroup, w * 0.26, 1.8, 0.12, x - w * 0.24, 0.2, z + d / 2 + 0.02, materials.glass, false);
      addBox(staticGroup, w * 0.26, 1.8, 0.12, x + w * 0.24, 0.2, z + d / 2 + 0.02, materials.glass, false);

      // Storefront Awning
      let awningMat = materials.red;
      if (label.includes("DONUT") || label.includes("RECYCLE") || label.includes("LAUNDRO")) {
        awningMat = materials.orange;
      } else if (label.includes("PAWN") || label.includes("ODD") || label.includes("MART")) {
        awningMat = materials.yellow;
      }
      addBox(staticGroup, w * 0.88, 0.24, 1.0, x, 2.2, z + d / 2 + 0.45, awningMat, false);

      // Windows
      addWindowRows(x, z, w, d, h, 0);

    } else {
      // CLASSIC STYLE: Normal flat-roof trim building
      building = addBox(staticGroup, w, h, d, x, 0, z, wall, true);

      // Pillars
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z - d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x - w / 2, 0, z + d / 2, accentMat, false);
      addBox(staticGroup, 0.45, h, 0.45, x + w / 2, 0, z + d / 2, accentMat, false);

      // Roof trim & skylight
      addBox(staticGroup, w + 0.65, 0.32, d + 0.65, x, h, z, roof, false);
      addBox(staticGroup, Math.max(2, w * 0.3), 0.26, Math.max(1.6, d * 0.28), x - w * 0.18, h + 0.32, z - d * 0.12, materials.glass, false);

      // Front doorway
      addBox(staticGroup, 1.8, 2.2, 0.1, x, 0, z + d / 2 + 0.02, materials.black, false);

      // Windows
      addWindowRows(x, z, w, d, h, 0);
    }

    // Front Wall A/C units (all styles except tiered which is already detailed)
    const seed = Math.sin(x) * Math.cos(z);
    if (style !== "tiered") {
      if (seed > 0.2) {
        addBox(staticGroup, 0.9, 0.6, 0.75, x + w * 0.25, h * 0.65, z + d / 2 + 0.35, materials.curb, false);
      }
      if (seed < -0.3) {
        addBox(staticGroup, 0.75, 0.6, 0.9, x + w / 2 + 0.35, h * 0.7, z - d * 0.15, materials.curb, false);
      }
    }

    // Roof Billboard Sign (if Labeled)
    if (label) {
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
    ctx.font = "800 96px Arial, sans-serif";
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
    const signH = clamp(d * 0.26, 2.2, 3.6);

    const postHeight = 1.35;
    const postY = h + 0.32;
    const signZ = z - d * 0.08;

    // Draw left and right post
    addBox(staticGroup, 0.22, postHeight, 0.22, x - signW * 0.3, postY, signZ, materials.curb, false);
    addBox(staticGroup, 0.22, postHeight, 0.22, x + signW * 0.3, postY, signZ, materials.curb, false);

    // Draw backing frame (tilted by -0.55 rad around X-axis to face camera)
    const frameDepth = 0.3;
    const centerY = postY + postHeight + signH / 2;
    const backing = makeMesh(new THREE.BoxGeometry(signW + 0.3, signH + 0.3, frameDepth), materials.asphaltDark, x, centerY, signZ, false, false);
    backing.rotation.x = -0.55;
    staticGroup.add(backing);
    staticMeshes.push(backing);

    // Draw texture plane in front of the backing frame (tilted by -0.55 rad around X-axis)
    const material = new THREE.MeshBasicMaterial({
      map: makeRoofSignTexture(text, color),
      transparent: true,
      side: THREE.DoubleSide,
    });
    // Offset by +0.084 in Y, and +0.136 in Z to align perfectly in front of the tilted face
    const sign = makeMesh(new THREE.PlaneGeometry(signW, signH), material, x, centerY + 0.084, signZ + 0.136, false, false);
    sign.rotation.x = -0.55;
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
    // Offset by z - 1.6 to move the wide label north of the character's head on screen
    sprite.position.set(x, 4.8, z - 1.6);
    sprite.scale.set(7, 1.75, 1);
    fxGroup.add(sprite);
    floaters.push({ mesh: sprite, life: 1.1, maxLife: 1.1 });
  }

  function makeEmojiTexture(emoji) {
    const canvas2 = document.createElement("canvas");
    canvas2.width = 160;
    canvas2.height = 160;
    const ctx = canvas2.getContext("2d");
    ctx.clearRect(0, 0, canvas2.width, canvas2.height);
    ctx.fillStyle = "rgba(22,24,28,0.76)";
    ctx.beginPath();
    ctx.arc(80, 80, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.font = "96px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, 80, 86);
    const texture = new THREE.CanvasTexture(canvas2);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function emojiTexture(emoji) {
    if (!emojiTextureCache[emoji]) {
      emojiTextureCache[emoji] = makeEmojiTexture(emoji);
    }
    return emojiTextureCache[emoji];
  }

  function setCivilianEmoji(civilian, emoji, life = 1.25) {
    if (!civilian || !civilian.mesh) return;
    if (!civilian.emojiSprite) {
      civilian.emojiSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: emojiTexture(emoji),
          transparent: true,
          depthWrite: false,
          opacity: 1,
        })
      );
      civilian.emojiSprite.position.set(0, 3.35, 0);
      civilian.emojiSprite.scale.set(2.4, 2.4, 1);
      civilian.mesh.add(civilian.emojiSprite);
    } else {
      civilian.emojiSprite.material.map = emojiTexture(emoji);
      civilian.emojiSprite.material.opacity = 1;
      civilian.emojiSprite.material.needsUpdate = true;
      civilian.emojiSprite.visible = true;
    }
    civilian.emojiLife = Math.max(civilian.emojiLife || 0, life);
    civilian.emojiMaxLife = Math.max(civilian.emojiMaxLife || life, life);
    civilian.emojiBob = civilian.emojiBob || rand(0, Math.PI * 2);
  }

  function tickCivilianEmoji(civilian, dt) {
    if (!civilian.emojiSprite) return;
    civilian.emojiLife = Math.max(0, (civilian.emojiLife || 0) - dt);
    if (civilian.emojiLife <= 0) {
      civilian.emojiSprite.visible = false;
      return;
    }
    civilian.emojiSprite.visible = true;
    civilian.emojiSprite.position.y = 3.35 + Math.sin(state.phaseTime * 7 + (civilian.emojiBob || 0)) * 0.12;
    civilian.emojiSprite.material.opacity = clamp(civilian.emojiLife / Math.max(0.35, civilian.emojiMaxLife || 1), 0.34, 1);
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

  function spawnSmokeParticle(x, z) {
    const size = rand(0.22, 0.44);
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x484848,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + rand(-0.25, 0.25), 0.7 + rand(0, 0.15), z + rand(-0.25, 0.25));
    
    addActionFX(mesh, rand(0.6, 0.95), (mesh, t, dt) => {
      mesh.position.y += dt * 1.6;
      mesh.position.x += rand(-0.15, 0.15) * dt;
      mesh.position.z += rand(-0.15, 0.15) * dt;
      mesh.scale.setScalar(1 - t);
      mesh.material.opacity = 0.72 * (1 - t);
    });
  }

  function spawnFireParticle(x, z) {
    const size = rand(0.28, 0.52);
    const geo = new THREE.BoxGeometry(size, size, size);
    const colors = [0xff3a00, 0xff9a00, 0xffda00];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + rand(-0.35, 0.35), 0.7 + rand(0, 0.2), z + rand(-0.35, 0.35));
    
    addActionFX(mesh, rand(0.45, 0.75), (mesh, t, dt) => {
      mesh.position.y += dt * 2.0;
      mesh.position.x += rand(-0.22, 0.22) * dt;
      mesh.position.z += rand(-0.22, 0.22) * dt;
      mesh.scale.setScalar(1 - t);
      mesh.material.opacity = 0.9 * (1 - t);
    });
  }

  function explodeVehicle(car) {
    addPulse(car.x, car.z, 0xff4f00, 7.8, 0.62);
    addPulse(car.x, car.z, 0xffcc00, 4.8, 0.48);
    
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(4.5, 9.5);
      const size = rand(0.45, 0.78);
      const geo = new THREE.BoxGeometry(size, size, size);
      const colors = [0xff2c00, 0xff8c00, 0xffcc00, 0x3c3c3c];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(car.x, 0.45, car.z);
      
      const vx = Math.cos(angle) * speed;
      const vz = -Math.sin(angle) * speed;
      
      addActionFX(mesh, rand(0.65, 1.15), (mesh, t, dt) => {
        mesh.position.x += vx * dt;
        mesh.position.z += vz * dt;
        mesh.position.y += (3.8 - t * 4.4) * dt;
        mesh.scale.setScalar(1 - t);
        mesh.material.opacity = 0.92 * (1 - t);
      });
    }

    addFloater("BOOM!", car.x, car.z, "#ff1a1a");
    
    const radius = 6.4;
    const radiusSq = radius * radius;
    
    if (state.drivingCar === car) {
      exitVehicle();
      state.health = Math.max(0, state.health - 65);
      player.stun = 1.6;
      const pushAngle = Math.random() * Math.PI * 2;
      moveCircle(player, Math.cos(pushAngle) * 3, -Math.sin(pushAngle) * 3);
    } else {
      const dx = player.x - car.x;
      const dz = player.z - car.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < radiusSq) {
        const falloff = 1 - Math.sqrt(dSq) / radius;
        state.health = Math.max(0, state.health - 45 * falloff);
        player.stun = 1.0;
        moveCircle(player, (dx / (Math.sqrt(dSq) || 1)) * 3 * falloff, (dz / (Math.sqrt(dSq) || 1)) * 3 * falloff);
      }
    }
    
    civilians.forEach((civ) => {
      const dx = civ.x - car.x;
      const dz = civ.z - car.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < radiusSq) {
        const falloff = 1 - Math.sqrt(dSq) / radius;
        setCivilianPanic(civ, 6.0);
        civ.x += (dx / (Math.sqrt(dSq) || 1)) * 4 * falloff;
        civ.z += (dz / (Math.sqrt(dSq) || 1)) * 4 * falloff;
        if (civ.mesh) civ.mesh.position.set(civ.x, 0, civ.z);
      }
    });

    cops.forEach((cop) => {
      const dx = cop.x - car.x;
      const dz = cop.z - car.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < radiusSq) {
        const falloff = 1 - Math.sqrt(dSq) / radius;
        cop.stun = 3.0;
        cop.x += (dx / (Math.sqrt(dSq) || 1)) * 4 * falloff;
        cop.z += (dz / (Math.sqrt(dSq) || 1)) * 4 * falloff;
        if (cop.mesh) cop.mesh.position.set(cop.x, 0, cop.z);
      }
    });

    zombies.slice().forEach((zombie) => {
      const dx = zombie.x - car.x;
      const dz = zombie.z - car.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < radiusSq) {
        const falloff = 1 - Math.sqrt(dSq) / radius;
        const dmg = 4 * falloff;
        const knockX = (dx / (Math.sqrt(dSq) || 1)) * 5 * falloff;
        const knockZ = (dz / (Math.sqrt(dSq) || 1)) * 5 * falloff;
        damageZombie(zombie, dmg, knockX, knockZ);
      }
    });

    car.mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = materials.black;
      }
    });
    
    car.exploded = true;
    car.health = 0;
    car.currentSpeed = 0;
    car.targetSpeed = 0;
    
    addWanted(25);
  }

  function fxBasic(color, opacity = 0.86, side = THREE.DoubleSide) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side,
    });
  }

  function rememberFXOpacity(root) {
    root.traverse((obj) => {
      if (obj.material && typeof obj.material.opacity === "number") {
        obj.userData.baseOpacity = obj.material.opacity;
      }
    });
  }

  function setFXOpacity(root, opacity) {
    root.traverse((obj) => {
      if (obj.material && typeof obj.material.opacity === "number") {
        obj.material.opacity = clamp(opacity, 0, 1) * (obj.userData.baseOpacity || 1);
      }
    });
  }

  function addActionFX(group, life, onUpdate) {
    rememberFXOpacity(group);
    fxGroup.add(group);
    actionFX.push({ mesh: group, life, maxLife: life, onUpdate });
    return group;
  }

  function playerForwardPoint(distance = 0, side = 0) {
    return {
      x: player.x + player.facing.x * distance + player.facing.z * side,
      z: player.z + player.facing.z * distance - player.facing.x * side,
    };
  }

  function faceFXGroup(group) {
    group.rotation.y = Math.atan2(player.facing.x, player.facing.z);
  }

  function makeGroundArc(inner, outer, start, length, color, opacity = 0.7) {
    const mesh = makeMesh(
      new THREE.RingGeometry(inner, outer, 36, 1, start, length),
      fxBasic(color, opacity),
      0,
      0.12,
      0,
      false,
      false
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  function makeTextSprite(text, color = "#ffffff", bg = "rgba(25,24,22,0.72)", scale = 3.4) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeTextTexture(text, color, bg),
        transparent: true,
        depthWrite: false,
        opacity: 0.92,
      })
    );
    sprite.scale.set(scale, scale * 0.25, 1);
    return sprite;
  }

  function makeEmojiSprite(emoji, scale = 2.0) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: emojiTexture(emoji),
        transparent: true,
        depthWrite: false,
        opacity: 0.95,
      })
    );
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  function makeCashBill(x, y, z, rotation = 0) {
    const bill = makeMesh(new THREE.BoxGeometry(0.9, 0.04, 0.42), fxBasic(0x49c968, 0.9), x, y, z, false, false);
    const stripe = makeMesh(new THREE.BoxGeometry(0.16, 0.05, 0.46), fxBasic(0xdfffe7, 0.85), 0, 0.02, 0, false, false);
    bill.rotation.y = rotation;
    bill.add(stripe);
    return bill;
  }

  function makeTinyStar(color = 0xffe56f, scale = 1) {
    const star = new THREE.Group();
    const a = makeMesh(new THREE.BoxGeometry(0.12 * scale, 0.12 * scale, 1.0 * scale), fxBasic(color, 0.9), 0, 0, 0, false, false);
    const b = makeMesh(new THREE.BoxGeometry(1.0 * scale, 0.12 * scale, 0.12 * scale), fxBasic(color, 0.9), 0, 0, 0, false, false);
    const c = makeMesh(new THREE.BoxGeometry(0.12 * scale, 0.12 * scale, 0.8 * scale), fxBasic(color, 0.78), 0, 0, 0, false, false);
    c.rotation.y = Math.PI / 4;
    star.add(a, b, c);
    return star;
  }

  function makePlungerProp(scale = 1) {
    const prop = new THREE.Group();
    addCylinder(prop, 0.08 * scale, 1.45 * scale, 0, 0, 0, fxBasic(0x6b422e, 0.92), 8);
    const cup = makeMesh(new THREE.CylinderGeometry(0.34 * scale, 0.23 * scale, 0.32 * scale, 12), fxBasic(0x9b3434, 0.92), 0, 0.05 * scale, 0, false, false);
    cup.rotation.x = Math.PI / 2;
    prop.add(cup);
    return prop;
  }

  function makeConePropFX(scale = 1) {
    const prop = new THREE.Group();
    addCone(prop, 0.42 * scale, 0.9 * scale, 0, 0, 0, fxBasic(0xff6d28, 0.92), 10);
    const stripe = makeMesh(new THREE.BoxGeometry(0.72 * scale, 0.07 * scale, 0.14 * scale), fxBasic(0xf5efe3, 0.9), 0, 0.45 * scale, -0.02, false, false);
    prop.add(stripe);
    return prop;
  }

  function makePeelPropFX(scale = 1) {
    const peel = makeMesh(new THREE.TorusGeometry(0.42 * scale, 0.11 * scale, 6, 12), fxBasic(0xf5d431, 0.92), 0, 0, 0, false, false);
    peel.scale.z = 0.42;
    return peel;
  }

  function makeChickenPropFX(scale = 1) {
    const prop = new THREE.Group();
    prop.add(makeMesh(new THREE.SphereGeometry(0.36 * scale, 10, 8), fxBasic(0xffdc4f, 0.94), 0, 0, 0, false, false));
    prop.add(makeMesh(new THREE.BoxGeometry(0.18 * scale, 0.16 * scale, 0.5 * scale), fxBasic(0xffdc4f, 0.94), 0, 0, 0.4 * scale, false, false));
    prop.add(makeMesh(new THREE.ConeGeometry(0.13 * scale, 0.28 * scale, 8), fxBasic(0xff7a35, 0.94), 0, 0, 0.73 * scale, false, false));
    return prop;
  }

  function makeBoomboxPropFX(scale = 1) {
    const box = new THREE.Group();
    box.add(makeMesh(new THREE.BoxGeometry(1.45 * scale, 0.72 * scale, 0.52 * scale), fxBasic(0x161719, 0.9), 0, 0, 0, false, false));
    [-0.38, 0.38].forEach((x) => {
      const speaker = makeMesh(new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, 0.08 * scale, 16), fxBasic(0xf3c447, 0.92), x * scale, 0, -0.29 * scale, false, false);
      speaker.rotation.x = Math.PI / 2;
      box.add(speaker);
    });
    return box;
  }

  function makeSignPropFX(scale = 1) {
    const sign = new THREE.Group();
    addCylinder(sign, 0.055 * scale, 1.1 * scale, 0, 0, 0, fxBasic(0x6b422e, 0.9), 6);
    sign.add(makeMesh(new THREE.BoxGeometry(1.35 * scale, 0.72 * scale, 0.09 * scale), fxBasic(0xbf8f54, 0.92), 0, 1.05 * scale, -0.02, false, false));
    const label = makeTextSprite("TIPS", "#2b1d12", "rgba(245,224,160,0.92)", 1.4 * scale);
    label.position.set(0, 1.06 * scale, -0.09 * scale);
    sign.add(label);
    return sign;
  }

  function spawnActFX(itemId, audienceCount = 0, missed = false) {
    const group = new THREE.Group();
    group.position.set(player.x, 0, player.z);
    faceFXGroup(group);
    const crowd = clamp(audienceCount || 0, 0, 10);
    const intensity = missed ? 0.62 : 1 + crowd * 0.05;

    if (itemId === "cone") {
      const cone = makeConePropFX(1.05);
      cone.position.set(0, 2.8, 0);
      group.add(cone, makeGroundArc(1.1, 1.45, 0, Math.PI * 2, 0xff8b42, 0.45));
      [-1, 1].forEach((side) => {
        const sparkle = makeTinyStar(0xfff0a0, 0.7);
        sparkle.position.set(side * 0.95, 1.8, -0.15);
        group.add(sparkle);
      });
      addActionFX(group, 0.72, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        mesh.rotation.y = Math.atan2(player.facing.x, player.facing.z) + Math.sin(t * Math.PI * 2) * 0.22;
        cone.position.y = 2.55 + Math.sin(t * Math.PI * 2) * 0.42;
        cone.rotation.y = t * Math.PI * 4;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "plunger") {
      const prop = makePlungerProp(1);
      prop.position.set(0, 1.12, -0.95);
      prop.rotation.x = Math.PI / 2;
      group.add(prop);
      for (let i = 0; i < 4; i += 1) {
        const bubble = makeMesh(new THREE.SphereGeometry(0.16 + i * 0.03, 8, 6), fxBasic(0x9ed4ff, 0.75), -0.6 + i * 0.42, 1.55 + i * 0.12, -1.25 - i * 0.1, false, false);
        group.add(bubble);
      }
      addActionFX(group, 0.66, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        faceFXGroup(mesh);
        prop.position.z = -0.65 - Math.sin(t * Math.PI * 3) * 0.55;
        prop.scale.setScalar(1 + Math.sin(t * Math.PI * 4) * 0.08);
        setFXOpacity(mesh, 1 - t * 0.9);
      });
      return;
    }

    if (itemId === "peel") {
      for (let i = 0; i < 3; i += 1) {
        const peel = makePeelPropFX(0.75);
        peel.position.set(Math.cos((i / 3) * Math.PI * 2) * 1.0, 2.2 + i * 0.18, Math.sin((i / 3) * Math.PI * 2) * 0.7);
        group.add(peel);
      }
      group.add(makeGroundArc(0.8, 1.2, 0, Math.PI * 2, 0xf5d431, 0.42));
      addActionFX(group, 0.75, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        faceFXGroup(mesh);
        mesh.children.forEach((child, index) => {
          child.rotation.y += 0.18 + index * 0.04;
          child.position.y += Math.sin(t * Math.PI * 2 + index) * 0.015;
        });
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "boombox") {
      const box = makeBoomboxPropFX(1);
      box.position.set(0, 0.92, -1.0);
      group.add(box);
      [1.1, 1.8, 2.5].forEach((radius, index) => {
        group.add(makeGroundArc(radius, radius + 0.12, 0, Math.PI * 2, index % 2 ? 0x49c9ff : 0xffbf47, 0.52));
      });
      ["BEAT", "BASS", "$"].forEach((text, index) => {
        const note = text === "$"
          ? makeEmojiSprite("💸", 1.4)
          : makeTextSprite(text, index === 1 ? "#49c9ff" : "#ffe07a", "rgba(0,0,0,0.45)", 2.2);
        note.position.set(-1.1 + index * 1.1, 2.25 + index * 0.2, -1.35);
        group.add(note);
      });
      addActionFX(group, 0.82, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        faceFXGroup(mesh);
        box.scale.set(1 + Math.sin(t * Math.PI * 8) * 0.08, 1, 1 + Math.sin(t * Math.PI * 8) * 0.08);
        mesh.children.forEach((child, index) => {
          if (child.isSprite) child.position.y += 0.025 + index * 0.002;
          if (child.geometry && child.geometry.type === "RingGeometry") child.scale.setScalar(1 + t * (1.4 + index * 0.08));
        });
        setFXOpacity(mesh, 1 - t * 0.92);
      });
      return;
    }

    if (itemId === "sign") {
      const sign = makeSignPropFX(1);
      sign.position.set(0, 0.4, -1.05);
      group.add(sign);
      [-0.9, 0, 0.9].forEach((x, index) => {
        group.add(makeCashBill(x, 1.95 + index * 0.12, -1.55, index * 0.4));
      });
      addActionFX(group, 0.75, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        faceFXGroup(mesh);
        sign.rotation.z = Math.sin(t * Math.PI * 4) * 0.22;
        mesh.children.forEach((child, index) => {
          if (index > 0) child.position.y += 0.025 + index * 0.004;
        });
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "chicken") {
      const chicken = makeChickenPropFX(1.2);
      chicken.position.set(0, 1.55, -1.0);
      group.add(chicken, makeTextSprite("SQUEAK", "#ffe07a", "rgba(82,38,12,0.72)", 3.2));
      group.children[1].position.set(0, 2.8, -1.25);
      for (let i = 0; i < 4; i += 1) {
        const star = makeTinyStar(0xffe56f, 0.55);
        star.position.set(Math.cos(i * Math.PI / 2) * 1.1, 1.85, -1 + Math.sin(i * Math.PI / 2) * 0.6);
        group.add(star);
      }
      addActionFX(group, 0.72, (mesh, t) => {
        mesh.position.set(player.x, 0, player.z);
        faceFXGroup(mesh);
        chicken.position.y = 1.3 + Math.abs(Math.sin(t * Math.PI * 3)) * 0.65;
        chicken.rotation.z = Math.sin(t * Math.PI * 5) * 0.35;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    for (let i = 0; i < 5; i += 1) {
      const foot = makeMesh(new THREE.BoxGeometry(0.42, 0.06, 0.78), fxBasic(i % 2 ? 0x74fff0 : 0xffbf47, missed ? 0.42 : 0.72), 0, 0.11, 0, false, false);
      const angle = (i / 5) * Math.PI * 2;
      foot.position.set(Math.cos(angle) * (1.0 + intensity * 0.2), 0.11, Math.sin(angle) * (0.72 + intensity * 0.12));
      foot.rotation.y = angle;
      group.add(foot);
    }
    group.add(makeGroundArc(1.0, 1.32, 0, Math.PI * 2, missed ? 0xdde6ef : 0x74fff0, missed ? 0.34 : 0.52));
    addActionFX(group, missed ? 0.45 : 0.66, (mesh, t) => {
      mesh.position.set(player.x, 0, player.z);
      mesh.rotation.y += 0.12;
      mesh.children.forEach((child, index) => {
        child.scale.setScalar(1 + Math.sin(t * Math.PI * 2 + index) * 0.18);
      });
      setFXOpacity(mesh, 1 - t);
    });
  }

  function spawnAttackFX(itemId, options = {}) {
    const group = new THREE.Group();
    const anchor = options.trapX == null ? playerForwardPoint((options.reach || 3.6) * 0.45) : { x: options.trapX, z: options.trapZ };
    group.position.set(anchor.x, 0, anchor.z);
    faceFXGroup(group);

    if (itemId === "cone") {
      const start = playerForwardPoint(1.2);
      group.position.set(start.x, 0, start.z);
      [-0.42, 0, 0.42].forEach((side, index) => {
        const streak = makeMesh(new THREE.BoxGeometry(0.18, 0.08, 2.4 + index * 0.35), fxBasic(index === 1 ? 0xfff0a0 : 0xff8b42, 0.68), side, 0.42 + index * 0.06, -0.8 - index * 0.22, false, false);
        group.add(streak);
      });
      group.add(makeGroundArc(0.6, 1.1, Math.PI * 0.08, Math.PI * 0.84, 0xff6d28, 0.5));
      addActionFX(group, 0.42, (mesh, t) => {
        faceFXGroup(mesh);
        mesh.scale.setScalar(1 + t * 0.55);
        mesh.position.x = playerForwardPoint(1.2 + t * 1.2).x;
        mesh.position.z = playerForwardPoint(1.2 + t * 1.2).z;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "peel") {
      const splat = makeGroundArc(0.45, 1.35, 0, Math.PI * 2, 0xf5d431, 0.62);
      group.add(splat);
      for (let i = 0; i < 5; i += 1) {
        const peel = makePeelPropFX(0.45);
        const angle = (i / 5) * Math.PI * 2;
        peel.position.set(Math.cos(angle) * 0.8, 0.18, Math.sin(angle) * 0.8);
        peel.rotation.y = angle;
        group.add(peel);
      }
      addActionFX(group, 0.5, (mesh, t) => {
        mesh.scale.setScalar(1 + t * 0.55);
        mesh.rotation.y += 0.08;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "plunger") {
      const prop = makePlungerProp(1.15);
      prop.position.set(0, 1.0, -0.4);
      prop.rotation.x = Math.PI / 2;
      group.add(prop, makeGroundArc(0.7, 1.65, Math.PI * 0.12, Math.PI * 0.76, 0xff7a6c, 0.58));
      addActionFX(group, 0.42, (mesh, t) => {
        faceFXGroup(mesh);
        const p = playerForwardPoint(1.2 + Math.sin(t * Math.PI) * 1.4);
        mesh.position.set(p.x, 0, p.z);
        prop.scale.z = 1 + Math.sin(t * Math.PI) * 0.35;
        prop.rotation.z = Math.sin(t * Math.PI * 2) * 0.16;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "boombox") {
      [1.1, 1.8, 2.5].forEach((radius, index) => {
        const wave = makeGroundArc(radius, radius + 0.14, -Math.PI * 0.34, Math.PI * 0.68, index % 2 ? 0x49c9ff : 0xffbf47, 0.68);
        wave.position.z = -0.4 - index * 0.55;
        group.add(wave);
      });
      group.add(makeTextSprite("BASS BLAST", "#49c9ff", "rgba(0,0,0,0.62)", 4.4));
      group.children[group.children.length - 1].position.set(0, 2.2, -1.6);
      addActionFX(group, 0.58, (mesh, t) => {
        faceFXGroup(mesh);
        const p = playerForwardPoint(1.4);
        mesh.position.set(p.x, 0, p.z);
        mesh.scale.z = 1 + t * 0.55;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "sign") {
      const sign = makeSignPropFX(0.9);
      sign.position.set(0, 0.4, -0.55);
      sign.rotation.z = -0.45;
      group.add(sign, makeGroundArc(0.65, 1.75, -Math.PI * 0.5, Math.PI, 0xbf8f54, 0.6));
      addActionFX(group, 0.44, (mesh, t) => {
        faceFXGroup(mesh);
        mesh.position.set(playerForwardPoint(1.3 + t * 1.5).x, 0, playerForwardPoint(1.3 + t * 1.5).z);
        sign.rotation.z = -0.75 + t * 1.55;
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "mop") {
      const pole = makeMesh(new THREE.CylinderGeometry(0.09, 0.09, 3.1, 8), materials.pole, 0, 1.0, -1.2, false, false);
      pole.rotation.x = Math.PI / 2;
      const head = makeMesh(new THREE.CylinderGeometry(0.26, 0.34, 0.6, 10), materials.mopHead, 0, 1.0, -2.6, false, false);
      head.rotation.x = Math.PI / 2;
      group.add(pole, head, makeGroundArc(0.8, 2.4, Math.PI * 0.42, Math.PI * 0.58, 0xe8e2c8, 0.5));
      addActionFX(group, 0.44, (mesh, t) => {
        faceFXGroup(mesh);
        const reach = Math.sin(t * Math.PI) * 1.6;
        const p = playerForwardPoint(1.0 + reach);
        mesh.position.set(p.x, 0, p.z);
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    if (itemId === "chicken") {
      const chicken = makeChickenPropFX(1.0);
      chicken.position.set(0, 1.35, -0.55);
      group.add(chicken, makeTextSprite("BONK-SQUEAK", "#ffe07a", "rgba(82,38,12,0.72)", 4.3));
      group.children[1].position.set(0, 2.5, -1.2);
      for (let i = 0; i < 5; i += 1) {
        const star = makeTinyStar(i % 2 ? 0xffe56f : 0xff7a6c, 0.7);
        star.position.set(Math.cos(i * 1.25) * 1.1, 1.4, -0.6 + Math.sin(i * 1.25) * 0.75);
        group.add(star);
      }
      addActionFX(group, 0.46, (mesh, t) => {
        faceFXGroup(mesh);
        mesh.position.set(playerForwardPoint(1.25 + t * 1.2).x, 0, playerForwardPoint(1.25 + t * 1.2).z);
        chicken.rotation.z = Math.sin(t * Math.PI * 4) * 0.55;
        chicken.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.28);
        setFXOpacity(mesh, 1 - t);
      });
      return;
    }

    [-0.34, 0.34].forEach((side, index) => {
      const slash = makeMesh(new THREE.BoxGeometry(0.24, 0.1, 2.35), fxBasic(index ? 0xff7a6c : 0xf5ff9d, 0.75), side, 1.05 + index * 0.12, -0.8, false, false);
      slash.rotation.y = side * 0.45;
      group.add(slash);
    });
    group.add(makeGroundArc(0.65, 1.75, -Math.PI * 0.45, Math.PI * 0.9, 0xffffff, 0.58));
    addActionFX(group, 0.4, (mesh, t) => {
      faceFXGroup(mesh);
      const p = playerForwardPoint(1 + t * 1.3);
      mesh.position.set(p.x, 0, p.z);
      mesh.scale.setScalar(1 + t * 0.28);
      setFXOpacity(mesh, 1 - t);
    });
  }

  function addWindowRows(x, z, w, d, h, yOffset = 0) {
    const matGlass = materials.glass;
    
    // 1. South Wall (Front, facing camera/south)
    const southCols = Math.max(2, Math.floor((w - 2.4) / 3.2));
    const southRows = Math.max(1, Math.floor((h - 2.0) / 1.6));
    for (let i = 0; i < southCols; i += 1) {
      for (let j = 0; j < southRows; j += 1) {
        const px = x - w / 2 + 1.2 + i * ((w - 2.4) / Math.max(1, southCols - 1));
        const py = yOffset + 1.8 + j * 1.5;
        const pz = z + d / 2 + 0.035;

        // Skip windows on ground floor overlapping with doorway
        if (py < 2.3 && Math.abs(px - x) < 1.4) {
          continue;
        }

        const pane = makeMesh(new THREE.BoxGeometry(1.1, 0.7, 0.08), matGlass, px, py, pz, false, false);
        staticGroup.add(pane);
      }
    }

    // 2. North Wall (Back, facing north)
    const northCols = Math.max(2, Math.floor((w - 2.4) / 3.2));
    const northRows = Math.max(1, Math.floor((h - 2.0) / 1.6));
    for (let i = 0; i < northCols; i += 1) {
      for (let j = 0; j < northRows; j += 1) {
        const px = x - w / 2 + 1.2 + i * ((w - 2.4) / Math.max(1, northCols - 1));
        const py = yOffset + 1.8 + j * 1.5;
        const pz = z - d / 2 - 0.035;
        const pane = makeMesh(new THREE.BoxGeometry(1.1, 0.7, 0.08), matGlass, px, py, pz, false, false);
        staticGroup.add(pane);
      }
    }

    // 3. Side Walls (East & West) - only if deep enough
    if (d >= 10) {
      const sideCols = Math.max(1, Math.floor((d - 2.4) / 3.2));
      const sideRows = Math.max(1, Math.floor((h - 2.0) / 1.6));
      for (let i = 0; i < sideCols; i += 1) {
        for (let j = 0; j < sideRows; j += 1) {
          const pz = z - d / 2 + 1.2 + i * ((d - 2.4) / Math.max(1, sideCols - 1));
          const py = yOffset + 1.8 + j * 1.5;
          
          // East wall
          const pxEast = x + w / 2 + 0.035;
          const paneEast = makeMesh(new THREE.BoxGeometry(0.08, 0.7, 1.1), matGlass, pxEast, py, pz, false, false);
          staticGroup.add(paneEast);

          // West wall
          const pxWest = x - w / 2 - 0.035;
          const paneWest = makeMesh(new THREE.BoxGeometry(0.08, 0.7, 1.1), matGlass, pxWest, py, pz, false, false);
          staticGroup.add(paneWest);
        }
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
      { w: 24, h: 7.2, d: 17, x: -40, z: -18, wall: materials.blueWall, roof: materials.roofCool, label: "POLICE DEPT", labelColor: "#8de9ff" },
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

    addCylinder(staticGroup, 2.4, 0.4, points.fountain.x, 0, points.fountain.z, materials.water, 20);
    addCylinder(staticGroup, 1.4, 0.6, points.fountain.x, 0.4, points.fountain.z, materials.concrete, 20);
    addCylinder(staticGroup, 1.2, 0.25, points.busk.x, 0, points.busk.z, materials.yellow, 16);

    [
      [-94, -65], [-88, -54], [-77, -63], [-78, -49], [-91, -88], [-78, -90],
      [-123, 61], [-113, 76], [-38, 79], [-29, 65], [106, 63], [117, 73],
      [55, 23], [74, 39], [103, -73], [119, -53], [-119, -31], [-111, 36],
    ].forEach(([x, z]) => {
      if (!pointNearRoad(x, z, 1.2) && canPlaceDetail(x, z, 2.0, 1.2)) addTree(x, z);
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

    if (kind === "civilian") {
      // 1. Shirts / Body colors
      const shirtColors = [
        0xd1a856, // mustard (original civilian)
        0x7a84bb, // gray-blue (original civilian2)
        0xa93226, // brick red
        0x1f618d, // dark blue
        0x229954, // forest green
        0xd68910, // dark orange
        0x7d3c98, // purple
        0x138d75, // teal
        0xa04000, // brown
        0x2c3e50, // charcoal
        0xebf5fb, // off-white
        0xf5b041, // light gold
        0xec7063  // coral/salmon pink
      ];
      const shirtColor = shirtColors[Math.floor(Math.random() * shirtColors.length)];
      const shirtMat = mat("civilian_shirt_" + shirtColor.toString(16), shirtColor);
      body.material = shirtMat;

      // 2. Skin tone
      const skinColors = [
        0xffdbac, // light peach
        0xf1c27d, // warm sand
        0xe0ac69, // tan
        0xc68642, // medium brown
        0x8d5524, // deep brown
        0x5c3823  // dark espresso
      ];
      const skinColor = skinColors[Math.floor(Math.random() * skinColors.length)];
      const skinMat = mat("civilian_skin_" + skinColor.toString(16), skinColor);
      head.material = skinMat;

      // 3. Pants style
      const style = Math.floor(Math.random() * 4);
      const pantsColors = [
        0x1b2631, // dark navy
        0x1f405b, // blue jeans
        0x2c3e50, // charcoal slate
        0x212f3d, // dark gray
        0x8d6e63, // khaki/brown
        0xe5e7e9, // light gray/white
        0x707b7c  // medium gray
      ];
      const pantsColor = pantsColors[Math.floor(Math.random() * pantsColors.length)];
      const pantsMat = mat("civilian_pants_" + pantsColor.toString(16), pantsColor);

      if (style === 0) {
        // Long Pants
        const pants = makeMesh(new THREE.BoxGeometry(0.9, 0.7, 0.55), pantsMat, 0, 0.42, 0.04, true, false);
        group.add(pants);
      } else if (style === 1) {
        // Shorts & Bare legs
        const legL = addCylinder(group, 0.14, 0.4, -0.22, 0, 0.04, skinMat, 6);
        const legR = addCylinder(group, 0.14, 0.4, 0.22, 0, 0.04, skinMat, 6);
        const pants = makeMesh(new THREE.BoxGeometry(0.9, 0.4, 0.55), pantsMat, 0, 0.57, 0.04, true, false);
        group.add(pants);
      } else if (style === 2) {
        // Skirt (cylinder flare)
        const skirt = makeMesh(new THREE.CylinderGeometry(0.54, 0.62, 0.6, 10), pantsMat, 0, 0.3, 0.04, true, false);
        skirt.scale.x = 0.85;
        const legL = addCylinder(group, 0.14, 0.3, -0.2, 0, 0.04, skinMat, 6);
        const legR = addCylinder(group, 0.14, 0.3, 0.2, 0, 0.04, skinMat, 6);
        group.add(skirt);
      } else if (style === 3) {
        // Dress / Tunic with belt
        const belt = makeMesh(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 10), materials.black, 0, 0.75, 0, true, false);
        belt.scale.x = 0.86;
        group.add(belt);
      }

      // 4. Hair / Hats
      const hairColors = [
        0x1a1a1a, // black
        0x3e2723, // dark brown
        0x5c4033, // brown
        0xd7ccc8, // gray/silver
        0xe6c280, // blonde
        0xb25e2e, // orange/red
        0x8e44ad, // dyed purple
        0x2e86c1  // dyed blue
      ];
      const hairColor = hairColors[Math.floor(Math.random() * hairColors.length)];
      const hairMat = mat("civilian_hair_" + hairColor.toString(16), hairColor);

      const headAccessory = Math.floor(Math.random() * 8); // 8 options: 0 (bald) to 7
      if (headAccessory === 1) {
        // Short hair
        const hair = makeMesh(new THREE.BoxGeometry(0.74, 0.5, 0.65), hairMat, 0, 2.3, 0.08, true, false);
        group.add(hair);
      } else if (headAccessory === 2) {
        // Long hair
        const hairTop = makeMesh(new THREE.BoxGeometry(0.74, 0.45, 0.65), hairMat, 0, 2.32, 0.06, true, false);
        const hairBack = makeMesh(new THREE.BoxGeometry(0.7, 0.8, 0.25), hairMat, 0, 1.85, 0.38, true, false);
        group.add(hairTop, hairBack);
      } else if (headAccessory === 3) {
        // Afro
        const afro = makeMesh(new THREE.SphereGeometry(0.56, 8, 8), hairMat, 0, 2.22, 0.02, true, false);
        afro.scale.set(1.08, 1.05, 1.08);
        group.add(afro);
      } else if (headAccessory === 4) {
        // Baseball cap
        const capColors = [0xa93226, 0x1f618d, 0x229954, 0x2c3e50, 0xf5b041, 0x161719];
        const capColor = capColors[Math.floor(Math.random() * capColors.length)];
        const capMat = mat("civilian_cap_" + capColor.toString(16), capColor);
        const cap = makeMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.22, 8), capMat, 0, 2.55, -0.03, true, false);
        const bill = makeMesh(new THREE.BoxGeometry(0.62, 0.08, 0.3), capMat, 0, 2.49, -0.48, true, false);
        const peekHair = makeMesh(new THREE.BoxGeometry(0.68, 0.25, 0.25), hairMat, 0, 2.22, 0.25, true, false);
        group.add(cap, bill, peekHair);
      } else if (headAccessory === 5) {
        // Beanie
        const beanieColors = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xd35400, 0x7f8c8d];
        const beanieColor = beanieColors[Math.floor(Math.random() * beanieColors.length)];
        const beanieMat = mat("civilian_beanie_" + beanieColor.toString(16), beanieColor);
        const beanie = makeMesh(new THREE.CylinderGeometry(0.44, 0.5, 0.38, 8), beanieMat, 0, 2.44, -0.02, true, false);
        const pompom = makeMesh(new THREE.SphereGeometry(0.12, 6, 6), materials.white, 0, 2.66, -0.02, true, false);
        group.add(beanie, pompom);
      } else if (headAccessory === 6) {
        // Fedora
        const hatColors = [0x5d4037, 0x3e2723, 0x1a1a1a, 0xf5f5f5, 0xd7ccc8];
        const hatColor = hatColors[Math.floor(Math.random() * hatColors.length)];
        const hatMat = mat("civilian_hat_" + hatColor.toString(16), hatColor);
        const brim = makeMesh(new THREE.CylinderGeometry(0.78, 0.78, 0.04, 10), hatMat, 0, 2.38, -0.02, true, false);
        brim.scale.z = 0.88;
        const crown = makeMesh(new THREE.CylinderGeometry(0.38, 0.44, 0.32, 10), hatMat, 0, 2.54, -0.02, true, false);
        const band = makeMesh(new THREE.CylinderGeometry(0.42, 0.45, 0.08, 10), materials.black, 0, 2.42, -0.02, true, false);
        group.add(brim, crown, band);
      } else if (headAccessory === 7) {
        // Spiky / messy hair
        const hairBase = makeMesh(new THREE.BoxGeometry(0.74, 0.45, 0.65), hairMat, 0, 2.3, 0.06, true, false);
        const spike1 = makeMesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), hairMat, -0.2, 2.55, -0.1, true, false);
        const spike2 = makeMesh(new THREE.BoxGeometry(0.15, 0.25, 0.15), hairMat, 0.1, 2.58, 0.05, true, false);
        const spike3 = makeMesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), hairMat, -0.05, 2.55, 0.2, true, false);
        group.add(hairBase, spike1, spike2, spike3);
      }

      // 5. Glasses / Sunglasses
      if (Math.random() < 0.38) {
        const isSunglasses = Math.random() < 0.65;
        const frameColors = isSunglasses ? [0x161719] : [0xc0392b, 0x1a1a1a, 0x2e86c1, 0x7f8c8d];
        const frameColor = frameColors[Math.floor(Math.random() * frameColors.length)];
        const frameMat = mat("glasses_frame_" + frameColor.toString(16), frameColor);
        const lensMat = isSunglasses ? materials.black : materials.glass;

        const lensL = makeMesh(new THREE.BoxGeometry(0.22, 0.16, 0.05), lensMat, -0.18, 2.18, -0.46, true, false);
        const lensR = makeMesh(new THREE.BoxGeometry(0.22, 0.16, 0.05), lensMat, 0.18, 2.18, -0.46, true, false);
        const bridge = makeMesh(new THREE.BoxGeometry(0.14, 0.06, 0.06), frameMat, 0, 2.2, -0.46, true, false);
        const outerL = makeMesh(new THREE.BoxGeometry(0.26, 0.2, 0.04), frameMat, -0.18, 2.18, -0.47, true, false);
        const outerR = makeMesh(new THREE.BoxGeometry(0.26, 0.2, 0.04), frameMat, 0.18, 2.18, -0.47, true, false);
        group.add(lensL, lensR, bridge, outerL, outerR);
      }

      // 6. Backpack
      if (Math.random() < 0.28) {
        const packColors = [0xa93226, 0x1f618d, 0x229954, 0xd35400, 0x7d3c98, 0x7f8c8d];
        const packColor = packColors[Math.floor(Math.random() * packColors.length)];
        const packMat = mat("civilian_pack_" + packColor.toString(16), packColor);
        const pack = makeMesh(new THREE.BoxGeometry(0.55, 0.8, 0.32), packMat, 0, 1.15, 0.76, true, false);
        const pocket = makeMesh(new THREE.BoxGeometry(0.42, 0.42, 0.14), packMat, 0, 0.95, 0.93, true, false);
        group.add(pack, pocket);
      }
    }

    if (kind === "cop") {
      const badge = makeMesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), materials.yellow, 0.01, 1.55, -0.62, true, false);
      const lightA = makeMesh(new THREE.BoxGeometry(0.35, 0.18, 0.2), materials.copRed, -0.22, 2.62, 0, true, false);
      const lightB = makeMesh(new THREE.BoxGeometry(0.35, 0.18, 0.2), materials.copBlue, 0.22, 2.62, 0, true, false);
      group.add(badge, lightA, lightB);

      // Add random skin tone to cop head
      const skinColors = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3823];
      const skinColor = skinColors[Math.floor(Math.random() * skinColors.length)];
      head.material = mat("civilian_skin_" + skinColor.toString(16), skinColor);
    }

    if (kind === "zombie") {
      const spitter = options.variant === "spitter";
      head.material = spitter ? materials.zombieSpit : materials.zombie;
      if (spitter) {
        body.material = materials.zombieSpit;
      }
      const glowColor = spitter ? 0xe9ff4a : 0x8aff6a;
      const glow = makeMesh(
        new THREE.TorusGeometry(0.85, 0.05, 6, 20),
        new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.55 }),
        0,
        0.12,
        0,
        false,
        false
      );
      glow.rotation.x = Math.PI / 2;
      group.add(glow);
      if (spitter) {
        // A drippy spout on the head telegraphs the ranged goo attacker.
        const spout = makeMesh(new THREE.ConeGeometry(0.26, 0.6, 8), materials.zombieSpit, 0, 2.1, -0.5, true, false);
        spout.rotation.x = -Math.PI / 2.3;
        const gob = makeMesh(
          new THREE.SphereGeometry(0.2, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xd9ff5a, transparent: true, opacity: 0.85 }),
          0,
          2.02,
          -0.85,
          false,
          false
        );
        group.add(spout, gob);
      }
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
      // 3D low-poly banana peel model
      const stem = makeMesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), materials.peel, 0, 0.2, 0, true, false);
      stem.rotation.z = 0.3;
      group.add(stem);
      for (let i = 0; i < 3; i++) {
        const flap = makeMesh(new THREE.BoxGeometry(0.5, 0.08, 0.2), materials.peel, 0, 0.04, 0, true, false);
        flap.rotation.y = (i * Math.PI * 2) / 3;
        flap.position.set(Math.cos(flap.rotation.y) * 0.25, 0.04, Math.sin(flap.rotation.y) * 0.25);
        flap.rotation.z = 0.2;
        group.add(flap);
      }
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
    } else if (type === "mop") {
      const pole = addCylinder(group, 0.1, 1.5, 0, 0.75, 0, materials.pole, 8);
      pole.rotation.z = 0.32;
      group.add(makeMesh(new THREE.CylinderGeometry(0.26, 0.34, 0.5, 10), materials.mopHead, 0.24, 0.28, 0, true, false));
      ringColor = 0xe8e2c8;
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

    // Glowing floating indicator diamond
    const indicator = makeMesh(
      new THREE.OctahedronGeometry(0.18),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.85 }),
      0,
      1.7,
      0,
      false,
      false
    );
    group.add(indicator);

    actorGroup.add(group);
    const pickup = { type, x, z, mesh: group, indicator, active: true, spin: rand(0, Math.PI * 2) };
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

    let sirenL = null;
    let sirenR = null;
    if (type.id === "police") {
      const doorL = makeMesh(new THREE.BoxGeometry(type.cabinLength, type.bodyHeight * 0.8, 0.04), materials.white, 0, type.bodyHeight / 2, type.width / 2 + 0.01, false, false);
      const doorR = makeMesh(new THREE.BoxGeometry(type.cabinLength, type.bodyHeight * 0.8, 0.04), materials.white, 0, type.bodyHeight / 2, -type.width / 2 - 0.01, false, false);
      const barY = type.bodyHeight + type.cabinHeight + 0.08;
      const sirenBar = makeMesh(new THREE.BoxGeometry(0.35, 0.15, type.cabinWidth * 0.85), materials.black, 0, barY, 0, true, false);
      sirenL = makeMesh(new THREE.BoxGeometry(0.32, 0.12, type.cabinWidth * 0.4), materials.copBlue, 0, barY + 0.04, type.cabinWidth * 0.2, true, false);
      sirenR = makeMesh(new THREE.BoxGeometry(0.32, 0.12, type.cabinWidth * 0.4), materials.copRed, 0, barY + 0.04, -type.cabinWidth * 0.2, true, false);
      group.add(doorL, doorR, sirenBar, sirenL, sirenR);
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
      sirenL,
      sirenR,
      health: 100,
      smokeTimer: 0,
      fireTimer: 0,
      exploded: false,
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
    gooBlobs.length = 0;
    peels.length = 0;
    floaters.length = 0;
    pulses.length = 0;
    actionFX.length = 0;
    state.drivingCar = null;
    state.slow = 0;
    hijackPromptSprite = null;
    kioskPromptSprite = null;
    kioskPromptText = "";
    if (player.mesh) {
      player.mesh.visible = true;
    }
  }

  // A little wheeled Pawn Cart landmark at the kiosk so the shop reads at a
  // glance. Purely decorative — buying is handled by ACT proximity, not collision.
  function buildPawnCart() {
    const group = new THREE.Group();
    group.position.set(points.kiosk.x, 0, points.kiosk.z);
    const body = makeMesh(new THREE.BoxGeometry(3.2, 1.4, 1.9), materials.purpleWall || materials.plunger, 0, 0.95, 0, true, false);
    const counter = makeMesh(new THREE.BoxGeometry(3.4, 0.24, 2.1), materials.cardboard, 0, 1.72, 0, true, false);
    group.add(body, counter);
    // Striped awning.
    [-1.0, 0, 1.0].forEach((sx, i) => {
      const stripe = makeMesh(new THREE.BoxGeometry(1.05, 0.14, 2.2), i % 2 ? materials.red : materials.white, sx, 2.7, 0, true, false);
      stripe.rotation.x = -0.32;
      group.add(stripe);
    });
    group.add(makeMesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), materials.pole, -1.5, 2.2, -0.9, true, false));
    group.add(makeMesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), materials.pole, 1.5, 2.2, -0.9, true, false));
    // Wheels.
    [-1.3, 1.3].forEach((wx) => {
      const wheel = makeMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.24, 12), materials.black, wx, 0.5, 1.0, true, false);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
    });
    // Wares on the counter so it looks stocked.
    addCone(group, 0.34, 0.7, -1.0, 1.9, 0, materials.cone, 8);
    group.add(makeMesh(new THREE.SphereGeometry(0.26, 8, 6), materials.yellow, 0.9, 2.05, 0, true, false));
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTextTexture("PAWN CART", "#ffd1ff", "rgba(40,20,44,0.9)"),
      transparent: true,
      depthWrite: false,
    }));
    sign.scale.set(5.4, 1.35, 1);
    sign.position.set(0, 3.7, 0);
    group.add(sign);
    actorGroup.add(group);
  }

  function spawnActors() {
    player.x = points.start.x;
    player.z = points.start.z;
    player.facing.x = 0;
    player.facing.z = -1;
    player.mesh = makeActor("player", player.x, player.z, { color: materials.player });
    buildPawnCart();

    const audienceAnchors = [
      points.busk,
      { x: points.busk.x - 12, z: points.busk.z + 5 },
      { x: points.busk.x + 13, z: points.busk.z - 7 },
      points.park,
      points.cache,
    ];
    for (let i = 0; i < (VISUAL_TARGET ? 20 : 30); i += 1) {
      const pos = i < 10
        ? randomSidewalkPointNear(audienceAnchors[i % audienceAnchors.length], 12, 0.85)
        : randomSidewalkPoint(0.85);
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
        watching: 0,
        emojiSprite: null,
        emojiLife: 0,
        emojiMaxLife: 0,
        emojiBob: rand(0, Math.PI * 2),
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
      const nearest = nearestSidewalk(pos.x, pos.z);
      const copObj = {
        x: pos.x,
        z: pos.z,
        homeX: pos.x,
        homeZ: pos.z,
        radius: 0.95,
        mesh,
        speed: 7.1 + index * 0.35,
        stun: 0,
        slip: 0,
        timer: rand(4.0, 8.0),
        sidewalk: nearest ? nearest.strip : null,
        sidewalkSegment: nearest ? nearest.segment : null,
        sidewalkTarget: nearest ? nearest.strip : null,
        sidewalkTargetSegment: nearest ? nearest.segment : null,
        target: null,
        crossing: false,
      };
      assignCivilianTarget(copObj);
      cops.push(copObj);
    });

    [
      ["snack", points.fountain.x, points.fountain.z],
      ["snack", points.park.x + 9, points.park.z + 2],
      ["boombox", points.busk.x + 5, points.busk.z + 2],
      ["scrap", points.cache.x, points.cache.z + 8],
      ["scrap", points.alley.x - 5, points.alley.z - 6],
      ["snack", points.camp.x + 5, points.camp.z - 4],
      ["snack", points.kiosk.x, points.kiosk.z - 12],
      ["sign", -40, 73],
      // Extra cones and peels near key locations
      ["cone", points.camp.x + 8, points.camp.z - 3],
      ["peel", points.camp.x - 4, points.camp.z + 5],
      ["cone", points.park.x - 8, points.park.z + 8],
      ["peel", points.park.x + 4, points.park.z - 6],
      ["cone", points.busk.x - 6, points.busk.z - 5],
      ["peel", points.busk.x + 6, points.busk.z - 4],
      ["cone", points.alley.x - 12, points.alley.z + 2],
      ["peel", points.alley.x - 8, points.alley.z - 3],
      ["cone", points.fountain.x - 6, points.fountain.z + 12],
      ["peel", points.fountain.x + 10, points.fountain.z - 6],
      ["cone", points.kiosk.x - 10, points.kiosk.z + 6],
      ["peel", points.kiosk.x + 8, points.kiosk.z - 8],
      ["cone", points.cache.x + 12, points.cache.z - 4],
      ["peel", points.cache.x - 10, points.cache.z + 8],
      // One rubber chicken to scavenge in the park
      ["chicken", points.park.x - 12, points.park.z - 2],
      // Extra food/snacks scattered throughout the map
      ["snack", points.camp.x - 8, points.camp.z - 6],
      ["snack", points.park.x + 15, points.park.z - 8],
      ["snack", points.busk.x + 12, points.busk.z - 12],
      ["snack", points.alley.x + 8, points.alley.z - 8],
      ["snack", points.fountain.x - 12, points.fountain.z - 8],
      ["snack", points.kiosk.x - 12, points.kiosk.z + 8],
      ["snack", points.cache.x - 6, points.cache.z - 12],
      ["snack", 0, 0],
      // Extra cones and peels scattered around
      ["cone", -50, -20],
      ["peel", -40, -10],
      ["cone", 30, 20],
      ["peel", 45, 10],
      ["cone", -20, 60],
      ["peel", -10, 50],
      ["cone", 80, 50],
      ["peel", 90, 45],
      ["cone", -90, 10],
      ["peel", -80, 20],
      ["cone", 10, -70],
      ["peel", 20, -60],
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
    if (arrestTimeout) {
      clearTimeout(arrestTimeout);
      arrestTimeout = null;
    }
    state.arrestTransition = false;
    if (els.bustedOverlay) {
      els.bustedOverlay.setAttribute("hidden", "");
    }

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
    state.lastAudience = { watching: 0, panicked: 0, cash: 0, wanted: 0 };
    initBag();
    state.tasks.buskCash = 0;
    state.tasks.nightRelief = 0;
    state.waveTarget = 8;
    state.waveKills = 0;
    state.objective = "Earn $20 before nightfall";
    startFavorForCycle();
    Object.keys(state.cooldowns).forEach((key) => {
      state.cooldowns[key] = 0;
    });
    toggleBag(false);
    toggleMap(false);
    if (els.overlay) {
      els.overlay.classList.toggle("overlay--show", !autoStart);
    }
    ui.setText(els.primary, "Start run");
    ui.setText(els.overlayTitle, "UNHOUSED AND UNHINGED");
    ui.setText(
      els.overlaySub,
      "Earn tips by doing funny bits near NPCs, keep your wanted stars down, then survive the Tweeker Zombie night. Move, tap ACT to perform, tap ATTACK to fight. Collect props and equip them to slots 1-4."
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
    logLine("Run started. Find an audience before the Tweeker Zombies roll in.");
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

  function arrestPlayer() {
    if (state.arrestTransition) {
      return;
    }
    state.arrestTransition = true;
    logLine("BUSTED! The police are processing your arrest...");

    if (state.drivingCar) {
      exitVehicle();
    }

    const caption = choose(BUSTED_CAPTIONS);
    ui.setText(els.bustedCaption, caption);
    if (els.bustedOverlay) {
      els.bustedOverlay.removeAttribute("hidden");
    }

    if (arrestTimeout) {
      clearTimeout(arrestTimeout);
    }

    arrestTimeout = setTimeout(() => {
      state.wanted = 0;
      state.arrest = 0;
      state.cash = 0;
      state.health = state.maxHealth;

      player.x = points.policeStation.x;
      player.z = points.policeStation.z;
      if (player.mesh) {
        player.mesh.position.set(player.x, 0, player.z);
      }

      // Snap camera target instantly to new position
      cameraTarget.x = player.x;
      cameraTarget.z = player.z;

      if (els.bustedOverlay) {
        els.bustedOverlay.setAttribute("hidden", "");
      }

      state.arrestTransition = false;
      arrestTimeout = null;

      logLine("Bailed out! The police confiscated all your cash.");
      addPulse(player.x, player.z, 0xff1a1a, 6.0, 0.6);
      addFloater("Bailed out! -$ cash", player.x, player.z, "#ff1a1a");
    }, 5000);
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

  function favorById(id) {
    return FAVORS.find((favor) => favor.id === id) || null;
  }

  function activeFavor() {
    if (!state.favor || state.favor.completed) return null;
    return favorById(state.favor.id);
  }

  function startFavorForCycle(id = null) {
    const favor = id ? favorById(id) : FAVORS[(Math.max(1, state.cycle) - 1) % FAVORS.length];
    if (!favor || state.cycle > 3) {
      state.favor = null;
      return null;
    }
    state.favor = {
      id: favor.id,
      cycle: state.cycle,
      progress: 0,
      goal: favor.goal,
      completed: false,
    };
    logLine(favor.intro);
    return favor;
  }

  function favorProgressText() {
    const favor = activeFavor();
    if (!favor || !state.favor) return "";
    return `Favor: ${favor.hud} ${state.favor.progress}/${favor.goal}`;
  }

  function grantFavorReward(favor) {
    if (!favor) return;
    if (favor.id === "busk-park-crowd") {
      state.cash += 8;
      state.wanted = clamp(state.wanted - 8, 0, 100);
    } else if (favor.id === "camp-row-supplies") {
      state.maxHealth = Math.min(130, state.maxHealth + 8);
      state.health = clamp(state.health + 34, 0, state.maxHealth);
    } else if (favor.id === "tweeker-alley-traps") {
      state.tasks.nightRelief = Math.max(state.tasks.nightRelief || 0, 3);
      addToBag("peel", 2);
    } else if (favor.id === "pawn-alley-tools") {
      state.cash += 4;
      addToBag(choose(["boombox", "sign", "chicken"]), 1);
    } else if (favor.id === "crosswalk-circus-bit") {
      state.cash += 6;
      state.wanted = clamp(state.wanted - 12, 0, 100);
    } else if (favor.id === "coupon-canyon-restock") {
      addToBag("cone", 3);
      addToBag("peel", 2);
      state.health = clamp(state.health + 12, 0, state.maxHealth);
    }
    refreshHotbar();
    if (state.bagOpen) renderBag();
  }

  function completeFavor(favor) {
    if (!favor || !state.favor || state.favor.completed) return;
    state.favor.completed = true;
    state.favor.progress = favor.goal;
    grantFavorReward(favor);
    logLine(`Favor complete: ${favor.reward}`);
    addFloater("Favor complete!", player.x, player.z, "#ffd43b");
    addPulse(player.x, player.z, 0xffd43b, 6.2, 0.7);
  }

  function progressFavor(kind, amount = 1, context = {}) {
    const favor = activeFavor();
    if (!favor || !state.favor) return false;
    if (state.phase !== "day") return false;
    if (favor.kind !== kind) return false;
    const currentDistrict = districts.find((district) => pointInDistrict(player, district)) || state.district;
    if (favor.district && currentDistrict.name !== favor.district) return false;
    if (favor.types && !favor.types.includes(context.type)) return false;
    if (favor.minAudience && (context.audienceCount || 0) < favor.minAudience) return false;
    if (favor.kind === "trap" && context.itemId !== "peel") return false;

    state.favor.progress = clamp(state.favor.progress + amount, 0, favor.goal);
    addFloater(`${favor.hud} ${state.favor.progress}/${favor.goal}`, player.x, player.z, "#ffd43b");
    if (state.favor.progress >= favor.goal) {
      completeFavor(favor);
    }
    return true;
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

  function selectSlot(index, fromBag) {
    if (index < 0 || index >= state.hotbar.length) return;
    state.activeSlot = index;
    if (fromBag) state.bagSlotPrimed = true;
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
    state.bagPickItem = null;
    state.bagSlotPrimed = true;
    refreshHotbar();
    if (state.bagOpen) renderBag();
  }

  function bagHintText() {
    if (state.bagPickItem) {
      const item = ITEMS[state.bagPickItem];
      return item
        ? `Tap a slot below to equip <b>${safeText(item.short)}</b>.`
        : "Tap an item, then tap a slot.";
    }
    if (state.bagSlotPrimed) {
      return `Tap an item to equip it to <b>Slot ${state.activeSlot + 1}</b>.`;
    }
    return "Tap an item, then tap a slot — or pick a slot first.";
  }

  function handleBagSlotPick(index) {
    if (state.bagPickItem) {
      equipToSlot(state.bagPickItem, index);
      return;
    }
    selectSlot(index, true);
  }

  function handleBagItemPick(id) {
    if (!ITEMS[id] || !ownsItem(id)) return;
    if (state.bagSlotPrimed) {
      equipToSlot(id, state.activeSlot);
      return;
    }
    state.bagPickItem = state.bagPickItem === id ? null : id;
    renderBag();
  }

  // ---- Audience / wanted ----------------------------------------------------
  function nearbyCivilians(radius, origin = player) {
    const r2 = radius * radius;
    return civilians
      .filter((civilian) => distSq(civilian, origin) <= r2)
      .sort((a, b) => distSq(a, origin) - distSq(b, origin));
  }

  function setActorPosition(actor, x, z) {
    actor.x = x;
    actor.z = z;
    if (actor.mesh) {
      actor.mesh.position.x = x;
      actor.mesh.position.z = z;
    }
  }

  function syncCivilianSidewalk(civilian) {
    const nearest = nearestSidewalk(civilian.x, civilian.z);
    civilian.sidewalk = nearest.strip;
    civilian.sidewalkSegment = nearest.segment;
    civilian.sidewalkTarget = nearest.strip;
    civilian.sidewalkTargetSegment = nearest.segment;
    civilian.target = sidewalkPoint(nearest.strip, nearest.segment, nearest.value);
    civilian.crossing = false;
    civilian.timer = rand(2.8, 6.4);
  }

  function placeCivilian(civilian, x, z) {
    setActorPosition(civilian, x, z);
    civilian.panic = 0;
    civilian.watching = 0;
    civilian.tipped = 0;
    civilian.emojiLife = 0;
    if (civilian.emojiSprite) civilian.emojiSprite.visible = false;
    syncCivilianSidewalk(civilian);
  }

  function setCivilianWatching(civilian, emoji = choose(WATCH_EMOJIS), duration = 2.2) {
    if (!civilian || civilian.panic > 0) return;
    civilian.watching = Math.max(civilian.watching || 0, duration);
    civilian.tipped = Math.max(civilian.tipped || 0, duration);
    setCivilianEmoji(civilian, emoji, Math.min(1.7, duration));
  }

  function setCivilianPanic(civilian, duration = 2.4) {
    if (!civilian) return;
    civilian.panic = Math.max(civilian.panic || 0, duration);
    civilian.watching = 0;
    setCivilianEmoji(civilian, choose(PANIC_EMOJIS), Math.min(1.55, duration));
  }

  function emojiForAct(itemId) {
    if (itemId === "boombox") return choose(["🎵", "🔥", "👏", "💸"]);
    if (itemId === "chicken") return choose(["😂", "👏", "💸"]);
    if (itemId === "cone") return choose(["🤔", "😂", "👀"]);
    if (itemId === "peel") return choose(["👏", "😂", "👀"]);
    if (itemId === "plunger") return choose(["😆", "👏", "👀"]);
    if (itemId === "sign") return choose(["💬", "👀", "💸"]);
    return choose(WATCH_EMOJIS);
  }

  function audienceForAct(earn, itemId) {
    const buskZone = distSq(player, points.busk) < 170;
    const radius = (buskZone ? BUSK_AUDIENCE_RADIUS : AUDIENCE_RADIUS) + (earn.crowd ? 2.8 : 0);
    const audience = nearbyCivilians(radius).filter((civilian) => civilian.panic <= 0);
    audience.forEach((civilian) => setCivilianWatching(civilian, emojiForAct(itemId), 2.4 + Math.min(1.2, (earn.crowd || 1) * 0.25)));
    return { audience, buskZone };
  }

  function alertCivilianWitnesses(radius, baseWanted, origin = player, panicDuration = 2.5) {
    const witnesses = nearbyCivilians(radius, origin);
    witnesses.forEach((civilian) => setCivilianPanic(civilian, panicDuration + Math.min(1.1, witnesses.length * 0.08)));
    if (!witnesses.length || baseWanted <= 0) {
      state.lastAudience = { watching: 0, panicked: witnesses.length, cash: 0, wanted: 0 };
      return { witnesses, wanted: 0 };
    }
    const crowdScale = 1 + Math.max(0, witnesses.length - 1) * 0.36;
    const districtScale = state.district.heat || 1;
    const wanted = baseWanted * crowdScale * districtScale;
    addWanted(wanted);
    state.lastAudience = { watching: 0, panicked: witnesses.length, cash: 0, wanted };
    return { witnesses, wanted };
  }

  // ---- Wanted / police ------------------------------------------------------
  function starLevel() {
    return clamp(Math.ceil(state.wanted / 20), 0, 5);
  }

  function addWanted(amount) {
    if (amount > 0) {
      const copNearby = cops.some((cop) => distSq(cop, player) < 22 * 22);
      const policeCarNearby = cars.some(
        (car) => car.type.id === "police" && distSq({ x: car.mesh.position.x, z: car.mesh.position.z }, player) < 25 * 25
      );
      if (copNearby || policeCarNearby) {
        amount *= 2.0;
        if (state.cooldowns.copWitness <= 0) {
          logLine("Cops witnessed your antics! Heat increase doubled.");
          addFloater("HEAT x2 (COPS NEARBY)", player.x, player.z, "#ff4b4b");
          state.cooldowns.copWitness = 3.0; // 3-second spam protection cooldown
        }
      }
    }
    state.wanted = clamp(state.wanted + amount, 0, 100);
  }

  function copsChasing() {
    return state.wanted >= 20 || state.arrest > 4;
  }

  function findClosestCar(maxDist) {
    let closest = null;
    let closestDistSq = maxDist * maxDist;
    cars.forEach((car) => {
      if (car.exploded) return;
      const carPos = car.userDriven ? { x: car.x, z: car.z } : vehiclePositionAt(car, car.offset);
      const dSq = distSq(carPos, player);
      if (dSq < closestDistSq) {
        closestDistSq = dSq;
        closest = car;
      }
    });
    return closest;
  }

  function enterVehicle(car) {
    if (car.exploded) return;
    state.drivingCar = car;
    car.userDriven = true;
    car.speed = car.currentSpeed || 0;
    car.angle = car.mesh.rotation.y;
    car.x = car.mesh.position.x;
    car.z = car.mesh.position.z;
    car.lastSafeX = car.x;
    car.lastSafeZ = car.z;

    if (player.mesh) {
      player.mesh.visible = false;
    }
    
    spawnSpookedDriverNPC(car.x, car.z);
    
    addFloater("HIJACKED!", car.x, car.z, "#ffbf00");
    logLine("Vehicle hijacked! WASD/Arrows to drive, F to exit.");
    addWanted(10);
  }

  function exitVehicle() {
    const car = state.drivingCar;
    if (!car) return;
    
    car.userDriven = false;
    car.currentSpeed = 0;
    
    const sideAngle = car.angle + Math.PI / 2;
    const exitX = car.x + Math.sin(sideAngle) * (car.type.width * 0.8 + 0.5);
    const exitZ = car.z + Math.cos(sideAngle) * (car.type.width * 0.8 + 0.5);
    
    if (isWalkable(exitX, exitZ, player.radius)) {
      player.x = exitX;
      player.z = exitZ;
    } else {
      player.x = car.x;
      player.z = car.z;
    }
    
    if (player.mesh) {
      player.mesh.position.set(player.x, 0, player.z);
      player.mesh.visible = true;
    }
    
    const nearest = nearestLaneForPosition(car.x, car.z);
    if (nearest) {
      car.lane = nearest.lane;
      car.offset = nearest.offset;
      updateCarPosition(car, 0);
    }
    
    state.drivingCar = null;
    logLine("Exited vehicle.");
  }

  function nearestLaneForPosition(x, z) {
    let best = null;
    let bestDistSq = Infinity;
    lanes.forEach((lane) => {
      const side = laneDirection(lane) * 1.8;
      let lx, lz;
      if (lane.axis === "x") {
        lz = lane.z + side;
        lx = clamp(x, lane.min, lane.max);
      } else {
        lx = lane.x + side;
        lz = clamp(z, lane.min, lane.max);
      }
      
      const dx = x - lx;
      const dz = z - lz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        const offsetVal = (lane.axis === "x") ? (lx - lane.min) : (lz - lane.min);
        best = { lane, offset: wrapLaneOffset(lane, offsetVal) };
      }
    });
    return best;
  }

  function updateHijackPrompt() {
    if (!state.running || state.paused || state.ended || state.drivingCar) {
      if (hijackPromptSprite) {
        hijackPromptSprite.visible = false;
      }
      return;
    }
    const closestCar = findClosestCar(3.8);
    if (closestCar) {
      if (!hijackPromptSprite) {
        hijackPromptSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: makeTextTexture("[F] Steal Car", "#ffdd33", "rgba(18,18,18,0.82)"),
            transparent: true,
            depthWrite: false,
          })
        );
        hijackPromptSprite.scale.set(6, 1.5, 1);
        fxGroup.add(hijackPromptSprite);
      }
      const carPos = closestCar.userDriven ? { x: closestCar.x, z: closestCar.z } : vehiclePositionAt(closestCar, closestCar.offset);
      hijackPromptSprite.position.set(carPos.x, 3.8, carPos.z - 1.2);
      hijackPromptSprite.visible = true;
    } else {
      if (hijackPromptSprite) {
        hijackPromptSprite.visible = false;
      }
    }
  }

  function spawnSpookedDriverNPC(x, z) {
    const mesh = makeActor("civilian", x, z);
    const pos = nearestSidewalk(x, z);
    const civilian = {
      x,
      z,
      radius: 0.85,
      mesh,
      dir: rand(0, Math.PI * 2),
      speed: rand(2.8, 4.2),
      timer: rand(3.0, 6.0),
      tipped: 0,
      panic: 6.0,
      watching: 0,
      emojiSprite: null,
      emojiLife: 0,
      emojiMaxLife: 0,
      emojiBob: rand(0, Math.PI * 2),
      sidewalk: pos ? pos.strip : null,
      sidewalkSegment: pos ? pos.segment : null,
      sidewalkTarget: pos ? pos.strip : null,
      sidewalkTargetSegment: pos ? pos.segment : null,
      target: null,
      crossing: false,
    };
    assignCivilianTarget(civilian);
    civilians.push(civilian);
    
    addFloater("AAAH!", x, z, "#ff4b4b");
    setCivilianPanic(civilian, 6.0);
  }

  function playerCarHit(actor, car) {
    const dx = actor.x - car.x;
    const dz = actor.z - car.z;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    
    const halfLen = car.type.length / 2;
    const halfWidth = car.type.width / 2;
    const closestX = clamp(localX, -halfLen, halfLen);
    const closestZ = clamp(localZ, -halfWidth, halfWidth);
    const dSq = (localX - closestX) * (localX - closestX) + (localZ - closestZ) * (localZ - closestZ);
    return dSq < actor.radius * actor.radius;
  }

  function checkPlayerCarCollisions(car, dt) {
    if (Math.abs(car.speed) < 1.0) return;
    
    zombies.slice().forEach((zombie) => {
      if (playerCarHit(zombie, car)) {
        const knockX = Math.cos(car.angle) * 4;
        const knockZ = -Math.sin(car.angle) * 4;
        const dmg = Math.abs(car.speed) * 1.5;
        damageZombie(zombie, dmg, knockX, knockZ);
        addFloater("crunch", zombie.x, zombie.z, "#a0ffa0");
        addPulse(zombie.x, zombie.z, 0x8aff6a, 3.0, 0.3);
      }
    });

    civilians.forEach((civilian) => {
      if (civilian.panic <= 0 && playerCarHit(civilian, car)) {
        setCivilianPanic(civilian, 4);
        alertCivilianWitnesses(25, 12, civilian, 4);
        addWanted(8.0);
        addFloater("HIT & RUN +wanted", civilian.x, civilian.z, "#ff3333");
        const knockX = Math.cos(car.angle) * 2;
        const knockZ = -Math.sin(car.angle) * 2;
        civilian.x += knockX;
        civilian.z += knockZ;
        if (civilian.mesh) {
          civilian.mesh.position.set(civilian.x, 0, civilian.z);
        }
      }
    });

    cops.forEach((cop) => {
      if (playerCarHit(cop, car)) {
        cop.stun = 2.0;
        addWanted(15);
        addFloater("COP HIT! +wanted", cop.x, cop.z, "#ff1a1a");
        const knockX = Math.cos(car.angle) * 2;
        const knockZ = -Math.sin(car.angle) * 2;
        cop.x += knockX;
        cop.z += knockZ;
        if (cop.mesh) {
          cop.mesh.position.set(cop.x, 0, cop.z);
        }
      }
    });
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

  function renderBagSlotPicker() {
    const host = els.bagSlotPicker;
    if (!host) return;
    host.innerHTML = "";
    state.hotbar.forEach((id, index) => {
      const item = id ? ITEMS[id] : null;
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "uh-bag__slot" +
        (index === state.activeSlot && state.bagSlotPrimed ? " is-target" : "") +
        (!item ? " is-empty" : "");
      button.dataset.bagSlot = String(index);
      button.setAttribute("aria-label", `Action bar slot ${index + 1}`);
      button.innerHTML =
        `<span class="uh-bag__slot-key">${index + 1}</span>` +
        `<span class="uh-bag__slot-name">${item ? safeText(item.short) : "Empty"}</span>` +
        (index === state.activeSlot && state.bagSlotPrimed
          ? `<span class="uh-bag__slot-tag">Equip here</span>`
          : "");
      host.appendChild(button);
    });
  }

  function renderBag() {
    const grid = els.bagGrid;
    if (!grid) return;
    renderBagSlotPicker();
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
          (state.bagPickItem === id ? " is-picked" : "") +
          (slot !== -1 ? " is-equipped" : "");
        button.dataset.item = id;
        button.draggable = true;
        const count = item.count ? ` ×${state.inventory[item.count] || 0}` : "";
        const where = slot !== -1 ? `On bar: Slot ${slot + 1}` : "Not on bar";
        button.innerHTML =
          `<strong>${safeText(item.name)}</strong>` +
          `<span>${safeText(itemSummary(item))}</span>` +
          `<small>${where}${count}</small>`;
        button.addEventListener("dragstart", (event) => {
          state.bagPickItem = id;
          event.dataTransfer.setData("text/plain", id);
          event.dataTransfer.effectAllowed = "move";
          renderBag();
        });
        button.addEventListener("dragend", () => {
          if (state.bagPickItem === id && !state.bagSlotPrimed) renderBag();
        });
        grid.appendChild(button);
      });
    ui.setHtml(els.bagHint, bagHintText());
  }

  function toggleBag(open) {
    state.bagOpen = open === undefined ? !state.bagOpen : open;
    if (els.bagOverlay) els.bagOverlay.hidden = !state.bagOpen;
    if (state.bagOpen) {
      state.bagPickItem = null;
      state.bagSlotPrimed = false;
      renderBag();
    }
  }

  function worldToMap(x, z, width, height) {
    return {
      mx: ((x + WORLD.width / 2) / WORLD.width) * width,
      my: ((z + WORLD.height / 2) / WORLD.height) * height,
    };
  }

  function mapObjectiveText() {
    const favorText = state.phase === "day" ? favorProgressText() : "";
    if (favorText) return favorText;
    if (state.phase === "day") {
      return `Earn $${Math.min(20, Math.floor(state.tasks.buskCash))}/20 before dusk`;
    }
    return `Survive — ${Math.max(0, state.waveTarget - state.waveKills)} zombies left`;
  }

  function renderMapLegend(objectiveLabel) {
    const host = els.mapLegend;
    if (!host) return;
    const favor = activeFavor();
    const rows = [
      `<li><span class="uh-map__swatch" style="background:${MAP_KIND_COLORS.you}"></span><div><b>You</b> Cyan arrow — current position.</div></li>`,
      `<li><span class="uh-map__swatch" style="background:${MAP_KIND_COLORS.objective}"></span><div><b>Objective</b> <i>${safeText(objectiveLabel)}</i></div></li>`,
    ];
    if (favor) {
      rows.push(
        `<li><span class="uh-map__swatch" style="background:${MAP_KIND_COLORS.objective}"></span><div><b>District favor</b> ${safeText(favor.name)} — ${safeText(favor.intro)}</div></li>`
      );
    }
    MAP_LANDMARKS.forEach((landmark) => {
      rows.push(
        `<li><span class="uh-map__swatch" style="background:${MAP_KIND_COLORS[landmark.kind] || "#fff"}"></span><div><b>${safeText(landmark.name)}</b> ${safeText(landmark.blurb)}</div></li>`
      );
    });
    host.innerHTML = rows.join("");
  }

  function districtColorHex(color, suffix = "") {
    return `#${color.toString(16).padStart(6, "0")}${suffix}`;
  }

  function drawCityMap(ctx, width, height, opts = {}) {
    const mini = !!opts.mini;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0a1018";
    ctx.fillRect(0, 0, width, height);

    districts.forEach((district) => {
      const x0 = district.x - district.w / 2;
      const z0 = district.z - district.h / 2;
      const p0 = worldToMap(x0, z0, width, height);
      const p1 = worldToMap(x0 + district.w, z0 + district.h, width, height);
      ctx.fillStyle = districtColorHex(district.color, mini ? "66" : "55");
      ctx.fillRect(p0.mx, p0.my, p1.mx - p0.mx, p1.my - p0.my);
      ctx.strokeStyle = districtColorHex(district.color, mini ? "99" : "aa");
      ctx.lineWidth = mini ? 0.6 : 1;
      ctx.strokeRect(p0.mx, p0.my, p1.mx - p0.mx, p1.my - p0.my);
      if (!mini) {
        const label = worldToMap(district.x, district.z, width, height);
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(district.name, label.mx, label.my + 3);
      }
    });

    ctx.strokeStyle = mini ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = mini ? 1 : 3;
    ROAD_X.forEach((roadX) => {
      const p0 = worldToMap(roadX, -WORLD.height / 2, width, height);
      const p1 = worldToMap(roadX, WORLD.height / 2, width, height);
      ctx.beginPath();
      ctx.moveTo(p0.mx, p0.my);
      ctx.lineTo(p1.mx, p1.my);
      ctx.stroke();
    });
    ROAD_Z.forEach((roadZ) => {
      const p0 = worldToMap(-WORLD.width / 2, roadZ, width, height);
      const p1 = worldToMap(WORLD.width / 2, roadZ, width, height);
      ctx.beginPath();
      ctx.moveTo(p0.mx, p0.my);
      ctx.lineTo(p1.mx, p1.my);
      ctx.stroke();
    });

    MAP_LANDMARKS.forEach((landmark) => {
      const p = worldToMap(landmark.x, landmark.z, width, height);
      const color = MAP_KIND_COLORS[landmark.kind] || "#fff";
      const r = mini ? 2.2 : 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.mx, p.my, r, 0, Math.PI * 2);
      ctx.fill();
      if (!mini) {
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    const objective = objectivePoint();
    if (objective) {
      const p = worldToMap(objective.x, objective.z, width, height);
      ctx.strokeStyle = MAP_KIND_COLORS.objective;
      ctx.lineWidth = mini ? 1.2 : 2;
      const ring = mini ? 4.5 : 10;
      const arm = mini ? 5.5 : 14;
      ctx.beginPath();
      ctx.arc(p.mx, p.my, ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.mx, p.my - arm);
      ctx.lineTo(p.mx, p.my + arm);
      ctx.moveTo(p.mx - arm, p.my);
      ctx.lineTo(p.mx + arm, p.my);
      ctx.stroke();
    }

    const you = worldToMap(player.x, player.z, width, height);
    ctx.fillStyle = MAP_KIND_COLORS.you;
    const tip = mini ? 4 : 8;
    const wing = mini ? 3 : 6;
    const base = mini ? 3 : 6;
    ctx.beginPath();
    ctx.moveTo(you.mx, you.my - tip);
    ctx.lineTo(you.mx + wing, you.my + base);
    ctx.lineTo(you.mx - wing, you.my + base);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#031018";
    ctx.lineWidth = mini ? 0.8 : 1.5;
    ctx.stroke();
  }

  function renderMinimap() {
    const canvas = els.miniMapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCityMap(ctx, canvas.width, canvas.height, { mini: true });
  }

  function renderMap() {
    const canvas = els.mapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCityMap(ctx, canvas.width, canvas.height, { mini: false });
    const objectiveLabel = mapObjectiveText();
    ui.setText(els.mapHint, `Game paused — ${objectiveLabel}`);
    renderMapLegend(objectiveLabel);
  }

  function toggleMap(open) {
    if (!state.running || state.ended) return;
    state.mapOpen = open === undefined ? !state.mapOpen : open;
    if (els.mapOverlay) els.mapOverlay.hidden = !state.mapOpen;
    if (state.mapOpen) {
      if (state.bagOpen) toggleBag(false);
      renderMap();
    }
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

  function getCarCollisionCircles(car) {
    const isChasingOrUser = car.userDriven || car.chasingPlayer;
    const x = car.userDriven ? car.x : car.mesh.position.x;
    const z = car.userDriven ? car.z : car.mesh.position.z;
    const angle = isChasingOrUser ? (car.angle || 0) : car.mesh.rotation.y;
    
    const offset = car.type.length * 0.22;
    const radius = car.type.width * 0.5;
    
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    return [
      { x: x + cos * offset, z: z - sin * offset, r: radius },
      { x: x - cos * offset, z: z + sin * offset, r: radius }
    ];
  }

  function checkCarOverlap(carA, carB) {
    const circlesA = getCarCollisionCircles(carA);
    const circlesB = getCarCollisionCircles(carB);
    
    for (let i = 0; i < circlesA.length; i++) {
      const cA = circlesA[i];
      for (let j = 0; j < circlesB.length; j++) {
        const cB = circlesB[j];
        const dx = cA.x - cB.x;
        const dz = cA.z - cB.z;
        const distSq = dx * dx + dz * dz;
        const minDist = cA.r + cB.r;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          return {
            overlap,
            nx: dist > 0.001 ? dx / dist : 1,
            nz: dist > 0.001 ? dz / dist : 0
          };
        }
      }
    }
    return null;
  }

  function pushVehicleWalkable(car, px, pz) {
    const radius = car.type.width * 0.42;
    const isUser = car.userDriven;
    const curX = isUser ? car.x : car.mesh.position.x;
    const curZ = isUser ? car.z : car.mesh.position.z;
    
    let nextX = curX;
    let nextZ = curZ;
    
    if (isStaticWalkable(curX + px, curZ, radius)) {
      nextX = curX + px;
    }
    if (isStaticWalkable(curX, curZ + pz, radius)) {
      nextZ = curZ + pz;
    }
    
    if (isUser) {
      car.x = nextX;
      car.z = nextZ;
      car.mesh.position.set(car.x, 0, car.z);
    } else {
      car.mesh.position.set(nextX, 0, nextZ);
    }
  }

  function resolveDynamicVehicleCollisions() {
    for (let pass = 0; pass < 4; pass++) {
      let fixed = false;
      for (let i = 0; i < cars.length; i++) {
        const carA = cars[i];
        const isDynamicA = carA.userDriven || carA.chasingPlayer;
        if (!isDynamicA) continue;

        for (let j = 0; j < cars.length; j++) {
          if (i === j) continue;
          const carB = cars[j];
          
          const hit = checkCarOverlap(carA, carB);
          if (hit) {
            const isDynamicB = carB.userDriven || carB.chasingPlayer;
            if (isDynamicB) {
              const px = hit.nx * hit.overlap * 0.5;
              const pz = hit.nz * hit.overlap * 0.5;
              
              pushVehicleWalkable(carA, px, pz);
              pushVehicleWalkable(carB, -px, -pz);
            } else {
              const px = hit.nx * hit.overlap;
              const pz = hit.nz * hit.overlap;
              
              pushVehicleWalkable(carA, px, pz);
            }
            fixed = true;
          }
        }
      }
      if (!fixed) break;
    }
    
    const playerCar = state.drivingCar;
    if (playerCar) {
      player.x = playerCar.x;
      player.z = playerCar.z;
      if (player.mesh) {
        player.mesh.position.set(player.x, 0, player.z);
      }
    }
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
    const isChasingOrUser = car.userDriven || car.chasingPlayer;
    const pos = car.userDriven
      ? { x: car.x, z: car.z }
      : (car.chasingPlayer
         ? { x: car.mesh.position.x, z: car.mesh.position.z }
         : vehiclePositionAt(car, offset));
    const halfLength = car.type.length / 2 + pad;
    const halfWidth = car.type.width / 2 + pad;
    const isX = isChasingOrUser ? (Math.abs(Math.sin(car.angle)) > 0.707) : (car.lane.axis === "x");
    const direction = isChasingOrUser ? 1 : laneDirection(car.lane);

    if (isX) {
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
    if (state.arrestTransition) {
      updateCamera(dt);
      animateIdle(dt);
      return;
    }

    if (!state.running || state.paused || state.mapOpen || state.ended) {
      updateCamera(dt);
      animateIdle(dt);
      if (state.mapOpen) renderMap();
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
    updateGoo(dt);
    updatePeels(dt);
    updateZombies(dt);
    updateFX(dt);
    updateCamera(dt);
    updateHUD();
    updateHijackPrompt();
    updateKioskPrompt();

    if (state._god) state.health = state.maxHealth;
    if (state.health <= 0) {
      endGame("WIPED OUT", "The block got too rough. Rest at camp and pick safer fights next run.");
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
    state.waveTarget = Math.max(5, 7 + state.cycle * 4 - (state.tasks.nightRelief || 0));
    state.tasks.nightRelief = 0;
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
    startFavorForCycle();
    if (state.cycle > 3) {
      endGame("BLOCK LEGEND", "Three cycles survived. This is the new top-down baseline.");
    }
  }

  function spawnDayPickups() {
    // Random day drops focused heavily on depleted items, with double the food/snacks
    const drops = [
      "snack", "snack", "snack", "snack",
      "cone", "cone", "cone", "cone",
      "peel", "peel", "peel", "peel",
      "scrap", "scrap",
      choose(["cone", "peel", "scrap", "snack"]),
      choose(["cone", "peel", "scrap", "snack"]),
      choose(["cone", "peel", "scrap", "snack"]),
      // Very small 25% chance of a tool drop, otherwise a consumable
      Math.random() < 0.25 ? choose(["boombox", "sign", "chicken"]) : choose(["cone", "peel", "scrap", "snack"])
    ];
    drops.forEach((type) => {
      const point = getOpenPoint(1.4, true);
      if (point) {
        makePickup(type, point.x, point.z);
      }
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
      spawnZombie(spawn.x + rand(-2.5, 2.5), spawn.z + rand(-2.5, 2.5), rollZombieKind());
    }
  }

  function spawnZombie(x, z, kind = "shambler") {
    const color = kind === "runner"
      ? materials.zombie
      : kind === "spitter"
        ? materials.zombieSpit
        : materials.zombieDark;
    const mesh = makeActor("zombie", x, z, { color, variant: kind });
    const zombie = {
      kind,
      x,
      z,
      radius: kind === "runner" ? 0.82 : 1.0,
      mesh,
      health: kind === "runner" ? 2 : kind === "spitter" ? 3 : 3,
      speed: kind === "runner"
        ? rand(6.4, 7.5)
        : kind === "spitter"
          ? rand(2.6, 3.4)
          : rand(3.8, 5.1),
      attack: 0,
      stun: 0,
      confused: 0,
      spitCd: kind === "spitter" ? rand(1.2, 2.6) : 0,
      wobble: rand(0, Math.PI * 2),
    };
    zombies.push(zombie);
    return zombie;
  }

  // Wave composition by cycle: runners appear throughout; Goo Spitters join from
  // cycle 2 onward to force the player to close distance or dodge arcs.
  function rollZombieKind() {
    const r = Math.random();
    if (state.cycle >= 2 && r < 0.2) return "spitter";
    if (r < (state.cycle >= 2 ? 0.4 : 0.2)) return "runner";
    return "shambler";
  }

  function updatePlayerDriving(dt) {
    const car = state.drivingCar;
    if (!car) return;

    let accelInput = 0;
    if (keys.w || keys.arrowup) accelInput += 1;
    if (keys.s || keys.arrowdown) accelInput -= 1;
    if (Math.abs(mobileMove.z) > 0.05) {
      accelInput -= mobileMove.z;
    }

    let steerInput = 0;
    if (keys.a || keys.arrowleft) steerInput += 1;
    if (keys.d || keys.arrowright) steerInput -= 1;
    if (Math.abs(mobileMove.x) > 0.05) {
      steerInput -= mobileMove.x;
    }

    const maxSpeed = car.type.speedScale * 14.5;
    const accelRate = car.type.accel * 1.8;
    const brakeRate = car.type.brake * 1.8;
    const drag = 1.6;

    if (accelInput > 0) {
      car.speed = Math.min(maxSpeed, car.speed + accelRate * dt);
    } else if (accelInput < 0) {
      car.speed = Math.max(-maxSpeed * 0.4, car.speed - brakeRate * dt);
    } else {
      if (car.speed > 0) car.speed = Math.max(0, car.speed - drag * dt);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag * dt);
    }

    if (Math.abs(car.speed) > 0.5) {
      const turnDir = car.speed > 0 ? 1 : -1;
      const turnPct = Math.min(1.0, Math.abs(car.speed) / 5.0);
      car.angle += steerInput * 2.2 * turnDir * turnPct * dt;
    }

    function getCollidingVehicle(x, z, playerCar) {
      const oldX = playerCar.x;
      const oldZ = playerCar.z;
      playerCar.x = x;
      playerCar.z = z;
      const myFootprint = vehicleFootprintAt(playerCar, playerCar.offset, 0, 0.1);
      playerCar.x = oldX;
      playerCar.z = oldZ;

      for (let i = 0; i < cars.length; i++) {
        const other = cars[i];
        if (other === playerCar) continue;
        const otherFootprint = vehicleFootprintAt(other, other.offset, 0, 0.1);
        if (rectsOverlap(myFootprint, otherFootprint)) {
          return other;
        }
      }
      return null;
    }

    const dx = Math.cos(car.angle) * car.speed * dt;
    const dz = -Math.sin(car.angle) * car.speed * dt;

    const nextX = car.x + dx;
    const nextZ = car.z + dz;

    let hitObstacle = false;
    let movedX = false;
    let movedZ = false;
    let collidedCar = null;

    let isBlockedX = false;
    if (!isStaticWalkable(nextX, car.z, car.type.width * 0.42)) {
      isBlockedX = true;
    } else {
      const hit = getCollidingVehicle(nextX, car.z, car);
      if (hit) {
        isBlockedX = true;
        collidedCar = hit;
      }
    }

    if (!isBlockedX) {
      car.x = nextX;
      car.lastSafeX = nextX;
      movedX = true;
    } else {
      car.x = car.lastSafeX || car.x;
      hitObstacle = true;
    }

    let isBlockedZ = false;
    if (!isStaticWalkable(car.x, nextZ, car.type.width * 0.42)) {
      isBlockedZ = true;
    } else {
      const hit = getCollidingVehicle(car.x, nextZ, car);
      if (hit) {
        isBlockedZ = true;
        collidedCar = hit;
      }
    }

    if (!isBlockedZ) {
      car.z = nextZ;
      car.lastSafeZ = nextZ;
      movedZ = true;
    } else {
      car.z = car.lastSafeZ || car.z;
      hitObstacle = true;
    }

    if (collidedCar) {
      const dmg = Math.min(45, Math.abs(car.speed) * 1.8);
      car.health = Math.max(0, car.health - dmg);
      collidedCar.health = Math.max(0, (collidedCar.health || 100) - dmg);
      
      car.speed = -car.speed * 0.35;
      if (Math.abs(car.speed) < 0.8) car.speed = 0;
      
      if (collidedCar.type.id === "police" && state.wanted >= 20) {
        collidedCar.speed = -collidedCar.speed * 0.5;
        addFloater("RAMMED!", car.x, car.z, "#ff3333");
      } else {
        collidedCar.currentSpeed = 0;
        collidedCar.waitTime = 0.5;
        addFloater("COLLISION +wanted", car.x, car.z, "#ff9933");
      }
      
      if (dmg > 1) {
        addFloater(`CAR HEALTH: ${Math.round(car.health)}%`, car.x, car.z, "#ff9999");
      }
      addWanted(2.5);
      addPulse(car.x, car.z, 0xffcc33, 4.0, 0.3);
    } else if (hitObstacle && !movedX && !movedZ) {
      const dmg = Math.min(35, Math.abs(car.speed) * 1.5);
      car.health = Math.max(0, car.health - dmg);
      
      car.speed = -car.speed * 0.28;
      if (Math.abs(car.speed) < 0.8) car.speed = 0;
      
      if (dmg > 1) {
        addFloater(`CAR HEALTH: ${Math.round(car.health)}%`, car.x, car.z, "#ff9999");
      }
      addPulse(car.x, car.z, 0xff5555, 3.2, 0.25);
    }

    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.angle;

    player.x = car.x;
    player.z = car.z;
    if (player.mesh) {
      player.mesh.position.set(player.x, 0, player.z);
      player.mesh.rotation.y = car.angle;
    }

    checkPlayerCarCollisions(car, dt);

    if (state.actStreakTime > 0) {
      state.actStreakTime -= dt;
      if (state.actStreakTime <= 0) state.actStreak = 0;
    }
    const layingLow = state.cooldowns.act <= 0 && state.cooldowns.attack <= 0;
    const atCamp = distSq(player, points.camp) < 200;
    let cool = state.phase === "day" ? 1.4 : 0.6;
    if (layingLow) cool += 0.9;
    if (atCamp) cool += 3.4;
    state.wanted = clamp(state.wanted - cool * dt, 0, 100);
  }

  function updatePlayer(dt) {
    if (state.drivingCar) {
      updatePlayerDriving(dt);
      return;
    }
    let ix = 0;
    let iz = 0;
    if (keys.w || keys.arrowup) iz -= 1;
    if (keys.s || keys.arrowdown) iz += 1;
    if (keys.a || keys.arrowleft) ix -= 1;
    if (keys.d || keys.arrowright) ix += 1;
    ix += mobileMove.x;
    iz += mobileMove.z;

    // Goo Spitter slime slows the player down for a couple of seconds.
    state.slow = Math.max(0, state.slow - dt);
    const effSpeed = player.speed * (state.slow > 0 ? 0.55 : 1);

    const mag = len2(ix, iz);
    const moving = mag > 0.01;
    if (moving) {
      ix /= mag;
      iz /= mag;
      moveCircle(player, ix * effSpeed * dt, iz * effSpeed * dt);
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
      civilian.watching = Math.max(0, (civilian.watching || 0) - dt);
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
      } else if (civilian.watching > 0) {
        dx = player.x - civilian.x;
        dz = player.z - civilian.z;
        const mag = len2(dx, dz) || 1;
        dx /= mag;
        dz /= mag;
        speed = 0;
        civilian.timer = Math.max(civilian.timer, 0.45);
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
      if (speed > 0) {
        moveCircle(civilian, dx * speed * dt, dz * speed * dt);
      }
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        civilian.mesh.rotation.y = Math.atan2(dx, dz);
      }
      civilian.mesh.position.y = civilian.watching > 0 ? Math.sin(state.phaseTime * 10 + civilian.emojiBob) * 0.05 : 0;

      const d = Math.sqrt(distSq(civilian, player));
      if (d < 4.5 && state.phase === "day" && activeItem().id === "boombox" && civilian.tipped <= 0) {
        setCivilianWatching(civilian, choose(["🎵", "👀", "👏"]), 1.3);
      }
      tickCivilianEmoji(civilian, dt);
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
      } else {
        cop.timer -= dt;
        const reached = !cop.target || distSq(cop, cop.target) < 1.2;
        if (reached && cop.sidewalkTarget) {
          cop.sidewalk = cop.sidewalkTarget;
          cop.sidewalkSegment = cop.sidewalkTargetSegment;
        }
        if (reached || cop.timer <= 0) {
          assignCivilianTarget(cop);
        }
        if (cop.target) {
          tx = cop.target.x;
          tz = cop.target.z;
        }
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
      const isTouchingCar = state.drivingCar && playerCarHit(cop, state.drivingCar);
      const isTouchingPlayer = !state.drivingCar && d < 2.2;
      if (chase && (isTouchingPlayer || isTouchingCar)) {
        if (state.drivingCar) {
          if (Math.abs(state.drivingCar.speed) < 3.0) {
            arrestPlayer();
          } else {
            // Speeding: run over cop instead
            cop.stun = 2.0;
            addWanted(15);
            addFloater("COP HIT! +wanted", cop.x, cop.z, "#ff1a1a");
            const knockX = Math.cos(state.drivingCar.angle) * 2;
            const knockZ = -Math.sin(state.drivingCar.angle) * 2;
            cop.x += knockX;
            cop.z += knockZ;
            if (cop.mesh) {
              cop.mesh.position.set(cop.x, 0, cop.z);
            }
          }
        } else {
          arrestPlayer();
        }
      } else if (state.arrest > 0 && d > 10) {
        state.arrest = clamp(state.arrest - 18 * dt, 0, 100);
      }
    });
  }

  function updateCars(dt) {
    cars.forEach((car) => {
      if (car.exploded) {
        car.currentSpeed = 0;
        car.targetSpeed = 0;
        return;
      }

      if (car.health <= 0) {
        explodeVehicle(car);
        return;
      }

      if (car.health < 50) {
        car.smokeTimer -= dt;
        if (car.smokeTimer <= 0) {
          car.smokeTimer = rand(0.08, 0.16);
          const isChasingOrUser = car.userDriven || car.chasingPlayer;
          const x = car.userDriven ? car.x : car.mesh.position.x;
          const z = car.userDriven ? car.z : car.mesh.position.z;
          const angle = isChasingOrUser ? (car.angle || 0) : car.mesh.rotation.y;
          const ex = x + Math.cos(angle) * car.type.length * 0.35;
          const ez = z - Math.sin(angle) * car.type.length * 0.35;
          spawnSmokeParticle(ex, ez);
        }
      }

      if (car.health < 25) {
        car.fireTimer -= dt;
        if (car.fireTimer <= 0) {
          car.fireTimer = rand(0.05, 0.12);
          const isChasingOrUser = car.userDriven || car.chasingPlayer;
          const x = car.userDriven ? car.x : car.mesh.position.x;
          const z = car.userDriven ? car.z : car.mesh.position.z;
          const angle = isChasingOrUser ? (car.angle || 0) : car.mesh.rotation.y;
          const ex = x + Math.cos(angle) * car.type.length * 0.35;
          const ez = z - Math.sin(angle) * car.type.length * 0.35;
          spawnFireParticle(ex, ez);
        }
      }

      if (car.userDriven) {
        if (car.type.id === "police") {
          updatePoliceSiren(car, dt);
        }
        return;
      }

      const shouldChase = car.type.id === "police" && state.wanted >= 20;
      if (shouldChase) {
        car.chasingPlayer = true;
        updatePoliceSiren(car, dt);
        updatePoliceCarChase(car, dt);
        return;
      } else if (car.chasingPlayer) {
        car.chasingPlayer = false;
        const nearest = nearestLaneForPosition(car.mesh.position.x, car.mesh.position.z);
        if (nearest) {
          car.lane = nearest.lane;
          car.offset = nearest.offset;
          updateCarPosition(car, 0);
        }
      }

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
      if (car.type.id === "police") {
        updatePoliceSiren(car, dt);
      }
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
    resolveDynamicVehicleCollisions();
    writeTrafficDebugSnapshot();
  }

  function resolveVehicleOverlaps() {
    for (let pass = 0; pass < 8; pass += 1) {
      let fixed = false;
      for (let i = 0; i < cars.length; i += 1) {
        const car = cars[i];
        if (car.userDriven || car.chasingPlayer) continue;
        const footprint = vehicleFootprintAt(car, car.offset, 0, 0.12);
        for (let j = i + 1; j < cars.length; j += 1) {
          const other = cars[j];
          if (other.userDriven || other.chasingPlayer) continue;
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
      if (state.drivingCar && actor === player) return;
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

  function updatePoliceSiren(car, dt) {
    if (!car.sirenL || !car.sirenR) return;
    const flashSpeed = state.wanted > 0 ? 12 : 6;
    const flash = Math.floor(state.phaseTime * flashSpeed) % 2 === 0;
    car.sirenL.visible = flash;
    car.sirenR.visible = !flash;
  }

  function updatePoliceCarChase(car, dt) {
    const dx = player.x - car.mesh.position.x;
    const dz = player.z - car.mesh.position.z;
    const targetAngle = Math.atan2(dx, dz);
    
    let currentAngle = car.angle;
    if (currentAngle === undefined) {
      currentAngle = car.mesh.rotation.y;
    }
    
    let diff = targetAngle - currentAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    car.angle = currentAngle + clamp(diff, -2.8 * dt, 2.8 * dt);
    
    car.speed = lerp(car.speed || 0, car.type.speedScale * 11.5, dt * 1.5);
    const dxMove = Math.cos(car.angle) * car.speed * dt;
    const dzMove = -Math.sin(car.angle) * car.speed * dt;
    
    const nextX = car.mesh.position.x + dxMove;
    const nextZ = car.mesh.position.z + dzMove;
    
    function policeCarCollidesWithPlayer(policeCar, tx, tz) {
      if (!state.drivingCar) return false;
      const oldMeshX = policeCar.mesh.position.x;
      const oldMeshZ = policeCar.mesh.position.z;
      policeCar.mesh.position.x = tx;
      policeCar.mesh.position.z = tz;
      const copFootprint = vehicleFootprintAt(policeCar, policeCar.offset, 0, 0.1);
      policeCar.mesh.position.x = oldMeshX;
      policeCar.mesh.position.z = oldMeshZ;

      const playerFootprint = vehicleFootprintAt(state.drivingCar, state.drivingCar.offset, 0, 0.1);
      return rectsOverlap(copFootprint, playerFootprint);
    }

    let isBlocked = false;
    if (!isStaticWalkable(nextX, nextZ, car.type.width * 0.6)) {
      isBlocked = true;
    }
    
    let hitPlayerCar = false;
    if (state.drivingCar && policeCarCollidesWithPlayer(car, nextX, nextZ)) {
      isBlocked = true;
      hitPlayerCar = true;
    }

    if (!isBlocked) {
      car.mesh.position.set(nextX, 0, nextZ);
    } else {
      if (hitPlayerCar) {
        const dmg = Math.min(45, Math.abs(car.speed) * 1.8);
        state.drivingCar.health = Math.max(0, state.drivingCar.health - dmg);
        car.health = Math.max(0, car.health - dmg);
        
        state.drivingCar.speed = -state.drivingCar.speed * 0.4;
        addPulse(player.x, player.z, 0xff5555, 4.0, 0.3);
        addFloater("RAMMED!", player.x, player.z, "#ff3333");
        if (dmg > 1) {
          addFloater(`CAR HEALTH: ${Math.round(state.drivingCar.health)}%`, player.x, player.z, "#ff9999");
        }
        car.speed = -car.speed * 0.5;
      } else {
        const dmg = Math.min(35, Math.abs(car.speed) * 1.5);
        car.health = Math.max(0, car.health - dmg);
        
        car.angle += diff > 0 ? -Math.PI * 0.25 : Math.PI * 0.25;
        car.speed = -car.speed * 0.35;
        if (Math.abs(car.speed) < 0.8) car.speed = 0;
      }
    }
    car.mesh.rotation.y = car.angle;
    
    const distSqPlayer = distSq(car.mesh.position, player);
    if (!state.drivingCar && distSqPlayer < 5.0) {
      state.health = clamp(state.health - 8.0 * dt, 0, state.maxHealth);
      const knockX = Math.cos(car.angle) * 3;
      const knockZ = -Math.sin(car.angle) * 3;
      moveCircle(player, knockX, knockZ);
      addFloater("WATCH OUT!", player.x, player.z, "#ff3333");
    }
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

  function isPointOffScreen(x, z) {
    const dx = x - player.x;
    const dz = z - player.z;
    return dx * dx + dz * dz > 46 * 46;
  }

  function updatePickups(dt) {
    pickups.forEach((pickup) => {
      if (!pickup.active) {
        return;
      }
      pickup.spin += dt * 2;
      pickup.mesh.rotation.y = pickup.spin;
      pickup.mesh.position.y = Math.sin(pickup.spin * 1.7) * 0.15;

      // Animate the floating indicator
      if (pickup.indicator) {
        pickup.indicator.rotation.y = -pickup.spin * 1.5;
        pickup.indicator.position.y = 1.7 + Math.sin(pickup.spin * 2.8) * 0.12;
      }

      if (distSq(pickup, player) < 2.4) {
        collectPickup(pickup);
      }
    });

    // Periodically spawn random new items slowly over time when off-screen during the day phase
    if (state.phase === "day" && Math.random() < dt * 0.07) {
      const activeCount = pickups.filter((p) => p.active).length;
      if (activeCount < 28) {
        // Bias choice heavily towards consumable items (especially snacks for healing) and make tools very rare
        const type = Math.random() < 0.08
          ? choose(["boombox", "sign", "chicken", "plunger"])
          : choose(["cone", "peel", "cone", "peel", "snack", "snack", "scrap"]);
        let spawnPoint = null;
        for (let attempt = 0; attempt < 50; attempt++) {
          const point = getOpenPoint(1.4, true);
          if (point && isPointOffScreen(point.x, point.z)) {
            spawnPoint = point;
            break;
          }
        }
        if (spawnPoint) {
          makePickup(type, spawnPoint.x, spawnPoint.z);
          logLine(`A new ${type} has been spotted nearby.`);
        }
      }
    }
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
        setCivilianPanic(civHit, 3);
        const witnessReaction = alertCivilianWitnesses(AGGRESSION_RADIUS, 9, civHit, 3);
        addFloater(`panic x${Math.max(1, witnessReaction.witnesses.length)} +wanted`, civHit.x, civHit.z, "#ff7a6c");
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
      spawnZombie(side.x, side.z, rollZombieKind());
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

      // Chicken-confused zombies stagger away from the player, dazed and harmless.
      zombie.confused = Math.max(0, zombie.confused - dt);

      let dx = player.x - zombie.x;
      let dz = player.z - zombie.z;
      const mag = len2(dx, dz) || 1;
      dx /= mag;
      dz /= mag;

      if (zombie.confused > 0) {
        const wander = Math.sin(zombie.wobble * 1.6) * 0.6;
        moveCircle(zombie, (-dx + dz * wander) * zombie.speed * 0.55 * dt, (-dz - dx * wander) * zombie.speed * 0.55 * dt);
        zombie.mesh.rotation.y += dt * 6;
        return; // no attacks while confused
      }

      if (zombie.kind === "spitter") {
        updateSpitter(zombie, dx, dz, mag, dt);
        return;
      }

      const drift = Math.sin(zombie.wobble * 0.7) * 0.25;
      moveCircle(zombie, (dx + dz * drift) * zombie.speed * dt, (dz - dx * drift) * zombie.speed * dt);
      zombie.mesh.rotation.y = Math.atan2(dx, dz);

      let isTouchingPlayer = false;
      if (state.drivingCar) {
        isTouchingPlayer = playerCarHit(zombie, state.drivingCar);
      } else {
        isTouchingPlayer = (mag < 2.1);
      }

      if (isTouchingPlayer && zombie.attack <= 0) {
        zombie.attack = zombie.kind === "runner" ? 0.72 : 1.1;
        if (state.drivingCar) {
          const dmg = zombie.kind === "runner" ? 10 : 15;
          state.drivingCar.health = Math.max(0, state.drivingCar.health - dmg);
          addFloater(`CAR HEALTH: ${Math.round(state.drivingCar.health)}%`, state.drivingCar.x, state.drivingCar.z, "#ff5555");
          addPulse(state.drivingCar.x, state.drivingCar.z, 0xff5555, 3.0, 0.3);
        } else {
          state.health = clamp(state.health - (zombie.kind === "runner" ? 6 : 9), 0, state.maxHealth);
          addPulse(player.x, player.z, 0x90ff76, 2.6, 0.4);
        }
      }
    });
  }

  // Goo Spitter: keeps its distance and lobs slowing goo arcs. It closes only
  // when too far, retreats when crowded, and bites weakly if cornered.
  function updateSpitter(zombie, dx, dz, dist, dt) {
    const preferred = 15;
    if (dist > preferred + 3) {
      moveCircle(zombie, dx * zombie.speed * dt, dz * zombie.speed * dt);
    } else if (dist < preferred - 3) {
      moveCircle(zombie, -dx * zombie.speed * 0.9 * dt, -dz * zombie.speed * 0.9 * dt);
    } else {
      const strafe = Math.sin(zombie.wobble * 0.9);
      moveCircle(zombie, -dz * zombie.speed * 0.5 * strafe * dt, dx * zombie.speed * 0.5 * strafe * dt);
    }
    zombie.mesh.rotation.y = Math.atan2(dx, dz);

    zombie.spitCd -= dt;
    if (zombie.spitCd <= 0 && dist < 27) {
      zombie.spitCd = rand(2.2, 3.2);
      spawnGoo(zombie, dx, dz);
    }

    // Weak bite if the player closes the gap.
    if (!state.drivingCar && dist < 2.1 && zombie.attack <= 0) {
      zombie.attack = 1.1;
      state.health = clamp(state.health - 5, 0, state.maxHealth);
      addPulse(player.x, player.z, 0xc7e04a, 2.4, 0.35);
    }
  }

  function spawnGoo(zombie, dx, dz) {
    const group = new THREE.Group();
    group.add(makeMesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xc7e04a, transparent: true, opacity: 0.9 }),
      0, 0, 0, false, false
    ));
    group.add(makeMesh(
      new THREE.SphereGeometry(0.2, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xe9ff6a, transparent: true, opacity: 0.7 }),
      0, 0, 0.32, false, false
    ));
    group.position.set(zombie.x + dx * 1.2, 1.3, zombie.z + dz * 1.2);
    actorGroup.add(group);
    const speed = 17;
    gooBlobs.push({
      x: group.position.x,
      z: group.position.z,
      vx: dx * speed,
      vz: dz * speed,
      life: 2.4,
      mesh: group,
    });
    addPulse(zombie.x, zombie.z, 0xd9ff5a, 2.2, 0.25);
  }

  function updateGoo(dt) {
    for (let i = gooBlobs.length - 1; i >= 0; i -= 1) {
      const goo = gooBlobs[i];
      goo.life -= dt;
      goo.x += goo.vx * dt;
      goo.z += goo.vz * dt;
      goo.mesh.position.x = goo.x;
      goo.mesh.position.z = goo.z;
      goo.mesh.rotation.y += dt * 6;
      if (distSq(goo, player) < 2.4) {
        state.health = clamp(state.health - 6, 0, state.maxHealth);
        state.slow = Math.min(3.2, state.slow + 2.2);
        addFloater("slimed! slowed", player.x, player.z, "#d9ff5a");
        addPulse(player.x, player.z, 0xc7e04a, 3.2, 0.4);
        removeGoo(i);
      } else if (goo.life <= 0 || !isWalkable(goo.x, goo.z, 0.4)) {
        addPulse(goo.x, goo.z, 0xaad24a, 2.0, 0.25);
        removeGoo(i);
      }
    }
  }

  function removeGoo(index) {
    const [goo] = gooBlobs.splice(index, 1);
    if (goo) actorGroup.remove(goo.mesh);
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
    for (let i = actionFX.length - 1; i >= 0; i -= 1) {
      const fx = actionFX[i];
      fx.life -= dt;
      const t = 1 - fx.life / fx.maxLife;
      if (fx.onUpdate) {
        fx.onUpdate(fx.mesh, clamp(t, 0, 1), dt, fx);
      } else {
        setFXOpacity(fx.mesh, 1 - t);
      }
      if (fx.life <= 0) {
        fxGroup.remove(fx.mesh);
        actionFX.splice(i, 1);
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
      state.cash += 1.50;
      addFloater("+$1.50 Cash", pickup.x, pickup.z, "#75ff92");
      logLine("Picked up $1.50 cash.");
    } else if (pickup.type === "snack") {
      state.health = clamp(state.health + 16, 0, state.maxHealth);
      addFloater("+16 HP (Snack)", pickup.x, pickup.z, "#ffd080");
      logLine("Collected snack. Restored 16 HP.");
    } else if (pickup.type === "scrap") {
      state.cash += 2.50;
      addFloater("+$2.50 Scrap", pickup.x, pickup.z, "#aab0b4");
      logLine("Scrap collected. Sold automatically for $2.50.");
    } else if (ITEMS[pickup.type]) {
      const item = ITEMS[pickup.type];
      const qty = item.refill || 1;
      const isNew = addToBag(pickup.type, qty);
      
      const qtyText = qty > 1 ? `+${qty} ` : "+";
      const nameText = qty > 1 ? `${item.short}s` : item.short;
      
      if (isNew) {
        logLine(`Found ${item.name}! Open the Bag (B), tap the item, then tap a slot.`);
        addFloater(`${qtyText}${nameText}!`, pickup.x, pickup.z, "#ffe07a");
      } else {
        addFloater(`${qtyText}${nameText}`, pickup.x, pickup.z, "#dde6ef");
      }
      refreshHotbar();
      if (state.bagOpen) renderBag();
    }
    progressFavor("pickup", 1, { type: pickup.type, pickup });
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

  // ACT button: earn tips with the active item's bit only when NPCs are close
  // enough to watch. Bigger watching crowds pay better.
  // What the Pawn Cart is currently selling: the first unowned weapon, then any
  // consumable that isn't at cap. Returns null when there's nothing left to buy.
  function currentKioskOffer() {
    for (const stock of SHOP_STOCK) {
      if (stock.kind === "weapon" && !ownsItem(stock.id)) return stock;
    }
    for (const stock of SHOP_STOCK) {
      if (stock.kind === "restock") {
        const item = ITEMS[stock.id];
        const cur = state.inventory[item.count] || 0;
        if (cur < (item.cap || 9)) return stock;
      }
    }
    return null;
  }

  function nearKiosk() {
    return distSq(player, points.kiosk) <= SHOP_RADIUS * SHOP_RADIUS;
  }

  // ACT near the Pawn Cart buys instead of performing. Returns true when the
  // interaction was handled (bought, or blocked on cash) so ACT stops there.
  function tryKioskPurchase() {
    if (state.phase !== "day" || state.drivingCar || !nearKiosk()) return false;
    const offer = currentKioskOffer();
    if (!offer) return false; // sold out — let ACT perform normally
    state.cooldowns.act = 0.5;
    if (state.cash < offer.price) {
      addFloater(`Need $${offer.price} — ${offer.label}`, player.x, player.z, "#ffb3a7");
      addPulse(player.x, player.z, 0xffb3a7, 3.0, 0.3);
      return true;
    }
    state.cash -= offer.price;
    if (offer.kind === "weapon") {
      addToBag(offer.id, ITEMS[offer.id].refill || 1);
      logLine(`Bought the ${offer.label} at the Pawn Cart for $${offer.price}.`);
      addFloater(`Bought ${offer.label}!`, player.x, player.z, "#ffe07a");
    } else {
      addToBag(offer.id, offer.qty);
      logLine(`Restocked ${offer.label} for $${offer.price}.`);
      addFloater(`+${offer.label}`, player.x, player.z, "#ffe07a");
    }
    addPulse(player.x, player.z, 0xffd43b, 5.0, 0.5);
    refreshHotbar();
    if (state.bagOpen) renderBag();
    return true;
  }

  // Floating price tag over the cart, shown only when you're in range by day.
  function updateKioskPrompt() {
    const active = state.running && !state.paused && !state.ended && state.phase === "day"
      && !state.drivingCar && distSq(player, points.kiosk) <= 15 * 15;
    if (!active) {
      if (kioskPromptSprite) kioskPromptSprite.visible = false;
      return;
    }
    const offer = currentKioskOffer();
    const text = offer ? `[E] ${offer.label} — $${offer.price}` : "Pawn Cart — sold out";
    if (!kioskPromptSprite) {
      kioskPromptSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeTextTexture(text, "#ffe07a", "rgba(18,18,18,0.82)"), transparent: true, depthWrite: false })
      );
      kioskPromptSprite.scale.set(7, 1.75, 1);
      fxGroup.add(kioskPromptSprite);
      kioskPromptText = text;
    } else if (text !== kioskPromptText) {
      kioskPromptSprite.material.map = makeTextTexture(text, "#ffe07a", "rgba(18,18,18,0.82)");
      kioskPromptSprite.material.needsUpdate = true;
      kioskPromptText = text;
    }
    kioskPromptSprite.position.set(points.kiosk.x, 4.4, points.kiosk.z - 1.0);
    kioskPromptSprite.visible = true;
  }

  function act() {
    if (!state.running || state.paused || state.mapOpen || state.cooldowns.act > 0) {
      return;
    }
    if (state.drivingCar) return;
    if (tryKioskPurchase()) return;
    const item = activeItem();
    const earn = item.earn || ITEMS.fists.earn;
    state.cooldowns.act = earn.cool || 0.5;
    const { audience, buskZone } = audienceForAct(earn, item.id);
    if (!audience.length) {
      state.actStreak = 0;
      state.actStreakTime = 0;
      state.lastAudience = { watching: 0, panicked: 0, cash: 0, wanted: 0 };
      spawnActFX(item.id, 0, true);
      addFloater("need audience", player.x, player.z, "#dde6ef");
      addPulse(player.x, player.z, 0xdde6ef, 2.8, 0.28);
      return;
    }
    const crowd = Math.min(audience.length, 12);
    const tip = state.district.tip || 1;
    const [lo, hi] = earn.cash;
    const crowdFlavor = earn.crowd || 1;
    const audienceScale = 1 + Math.max(0, crowd - 1) * 0.18 + Math.max(0, crowdFlavor - 1) * 0.2;
    const gain = (rand(lo, hi) * audienceScale + crowd * 0.32 * crowdFlavor) * tip * (buskZone ? 1.25 : 1);
    state.cash += gain;
    state.tasks.buskCash += gain;
    bumpActStreak();
    const wanted = (earn.wanted || 1) *
      (1 + (state.actStreak - 1) * 0.32) *
      (1 + Math.max(0, audience.length - 1) * 0.06) *
      (state.district.heat || 1);
    addWanted(wanted);
    state.lastAudience = { watching: audience.length, panicked: 0, cash: gain, wanted };
    spawnActFX(item.id, audience.length, false);
    addFloater(`+$${gain.toFixed(0)} ${earn.label || ""} x${audience.length}`.trim(), player.x, player.z, "#73ff91");
    addPulse(player.x, player.z, earn.crowd ? 0xffbf47 : 0x74fff0, earn.crowd ? 7.2 : 4.8 + crowd * 0.28, 0.55);
    progressFavor("act", 1, { audienceCount: audience.length, itemId: item.id, gain });
  }

  // ATTACK button: dispatches on the active item's attack type. Aggression near
  // regular people spikes wanted harder as more witnesses panic.
  function attack() {
    if (!state.running || state.paused || state.mapOpen || state.cooldowns.attack > 0) {
      return;
    }
    if (state.drivingCar) {
      exitVehicle();
      return;
    }
    const closestCar = findClosestCar(3.8);
    if (closestCar) {
      enterVehicle(closestCar);
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
        if (a.confuse && zombie.health > 0) {
          zombie.confused = Math.max(zombie.confused || 0, 3.0);
          addFloater("confused!", zombie.x, zombie.z, "#ffe07a");
        }
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
        setCivilianPanic(civilian, a.confuse ? 2.8 : 2.2);
        hitCivilian = true;
      }
    });
    const witnessReaction = alertCivilianWitnesses(
      hitCivilian ? reach + AGGRESSION_RADIUS : Math.max(AGGRESSION_RADIUS, reach + 4),
      hitCivilian ? 10.5 : 4.4,
      player,
      hitCivilian ? 3.1 : 2.4
    );
    spawnAttackFX(item.id, { reach, hits, hitCivilian });
    if (hitCivilian) {
      addFloater(`panic x${Math.max(1, witnessReaction.witnesses.length)} +wanted`, player.x, player.z, "#ff7a6c");
    } else if (witnessReaction.witnesses.length) {
      addFloater(`witnesses x${witnessReaction.witnesses.length} +wanted`, player.x, player.z, "#ffb36f");
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
    const witnessReaction = alertCivilianWitnesses(AGGRESSION_RADIUS + 2, 3.2, player, 2.3);
    spawnAttackFX(item.id, { reach: a.range || 27 });
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
    addFloater(
      witnessReaction.witnesses.length ? `${a.label || "throw"} x${witnessReaction.witnesses.length}` : a.label || "throw",
      player.x,
      player.z,
      witnessReaction.witnesses.length ? "#ffb36f" : "#ffb878"
    );
    refreshHotbar();
  }

  function dropTrap(item, a) {
    if (item.count && (state.inventory[item.count] || 0) <= 0) {
      addFloater(`no ${item.short.toLowerCase()}s`, player.x, player.z, "#ffb3a7");
      return;
    }
    state.cooldowns.attack = a.cool || 0.45;
    if (item.count) state.inventory[item.count] -= 1;
    const witnessReaction = alertCivilianWitnesses(AGGRESSION_RADIUS, 2.1, player, 2.1);
    const x = player.x - player.facing.x * 1.1;
    const z = player.z - player.facing.z * 1.1;
    spawnAttackFX(item.id, { trapX: x, trapZ: z });
    const mesh = makeMesh(new THREE.TorusGeometry(0.55, 0.12, 6, 12), materials.peel, x, 0.12, z, true, false);
    mesh.scale.z = 0.45;
    actorGroup.add(mesh);
    peels.push({ x, z, life: 12, mesh });
    addFloater(
      witnessReaction.witnesses.length ? `${a.label || "trap"} x${witnessReaction.witnesses.length}` : a.label || "trap set",
      x,
      z,
      witnessReaction.witnesses.length ? "#ffcc73" : "#ffe96d"
    );
    progressFavor("trap", 1, { itemId: item.id, x, z });
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
    ui.setText(els.districtName, state.district.name);

    // Objective line with live progress.
    const favorText = state.phase === "day" ? favorProgressText() : "";
    const objective = favorText || (
      state.phase === "day"
        ? `Earn $${Math.min(20, Math.floor(state.tasks.buskCash))}/20 before dusk`
        : `Survive - ${Math.max(0, state.waveTarget - state.waveKills)} zombies left`
    );
    ui.setText(els.objectiveText, objective);
    if (els.objectiveArrow) {
      const target = objectivePoint();
      const angle = Math.atan2(target.x - player.x, target.z - player.z);
      els.objectiveArrow.style.transform = `rotate(${angle}rad)`;
    }

    renderMinimap();

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
    const favor = activeFavor();
    if (favor && favor.target) return favor.target;
    // Point at the nearest prop pickup, else the busk plaza.
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
    if (state.arrestTransition) {
      event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    keys[key] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
    }
    if (key === "tab" || key === "b") {
      event.preventDefault();
    }
    if (state.drivingCar) {
      if (key === "f" || key === "j") {
        attack();
      }
      if (["1", "2", "3", "4", "e", " ", "b", "tab"].includes(key)) {
        event.preventDefault();
      }
      return;
    }
    if (key === "escape") {
      const wrap = canvas.closest(".canvas-wrap");
      if (wrap && wrap.classList.contains("is-maxed")) {
        return; // let the max-screen handler exit; don't also pause
      }
      if (state.mapOpen) {
        toggleMap(false);
        return;
      }
      if (state.bagOpen) {
        toggleBag(false);
        return;
      }
      setPaused(!state.paused);
      return;
    }
    if (state.mapOpen) {
      if (key === "m") toggleMap(false);
      return;
    }
    if (!state.running && key !== "tab" && key !== "b") {
      startGame();
    }
    if (key === "e" || key === " ") act();
    if (key === "f" || key === "j") attack();
    if (key === "1") {
      if (state.bagOpen && state.bagPickItem) equipToSlot(state.bagPickItem, 0);
      else selectSlot(0, state.bagOpen);
    }
    if (key === "2") {
      if (state.bagOpen && state.bagPickItem) equipToSlot(state.bagPickItem, 1);
      else selectSlot(1, state.bagOpen);
    }
    if (key === "3") {
      if (state.bagOpen && state.bagPickItem) equipToSlot(state.bagPickItem, 2);
      else selectSlot(2, state.bagOpen);
    }
    if (key === "4") {
      if (state.bagOpen && state.bagPickItem) equipToSlot(state.bagPickItem, 3);
      else selectSlot(3, state.bagOpen);
    }
    if (key === "b" || key === "tab") toggleBag();
    if (key === "m") toggleMap();
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
        selectSlot(Number(slot.dataset.slot), state.bagOpen);
        canvas.focus({ preventScroll: true });
      }
    });
    els.bagSlotPicker?.addEventListener("click", (event) => {
      const slot = event.target.closest("[data-bag-slot]");
      if (slot) handleBagSlotPick(Number(slot.dataset.bagSlot));
    });
    els.bagSlotPicker?.addEventListener("dragover", (event) => {
      if (event.target.closest("[data-bag-slot]")) event.preventDefault();
    });
    els.bagSlotPicker?.addEventListener("drop", (event) => {
      const slot = event.target.closest("[data-bag-slot]");
      if (!slot) return;
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain") || state.bagPickItem;
      if (id) equipToSlot(id, Number(slot.dataset.bagSlot));
    });
    els.bagGrid?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-item]");
      if (item) handleBagItemPick(item.dataset.item);
    });
    document.getElementById("bag-close")?.addEventListener("click", () => toggleBag(false));
    document.getElementById("btn-bag")?.addEventListener("click", () => toggleBag());
    document.getElementById("map-close")?.addEventListener("click", () => toggleMap(false));
    document.getElementById("btn-map")?.addEventListener("click", () => toggleMap());

    bindActionTouch("touch-act", act);
    bindActionTouch("touch-attack", attack);
    bindActionTouch("touch-bag", () => toggleBag());
    bindActionTouch("touch-map", () => toggleMap());
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
      favor: state.favor ? { ...state.favor } : null,
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
      favor: data.favor && favorById(data.favor.id)
        ? {
            id: data.favor.id,
            cycle: Math.max(1, Number(data.favor.cycle) || 1),
            progress: clamp(Number(data.favor.progress) || 0, 0, Number(data.favor.goal) || 99),
            goal: Number(data.favor.goal) || favorById(data.favor.id).goal,
            completed: !!data.favor.completed,
          }
        : null,
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
      pedestriansWatching: civilians.filter((civilian) => civilian.watching > 0).length,
      pedestriansPanicked: civilians.filter((civilian) => civilian.panic > 0).length,
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
      const audienceSnapshot = () => ({
        nearby: nearbyCivilians(AUDIENCE_RADIUS).length,
        watching: civilians.filter((civilian) => civilian.watching > 0).length,
        panicked: civilians.filter((civilian) => civilian.panic > 0).length,
        cash: Number(state.cash.toFixed(2)),
        wanted: Number(state.wanted.toFixed(2)),
        lastAudience: { ...state.lastAudience },
      });
      window.__UNHINGED = {
        state,
        player,
        civilians,
        start: () => startGame(),
        act: () => {
          act();
          updateHUD();
          return audienceSnapshot();
        },
        attack: () => {
          attack();
          updateHUD();
          return audienceSnapshot();
        },
        audience: audienceSnapshot,
        fxCounts: () => ({
          actionFX: actionFX.length,
          pulses: pulses.length,
          projectiles: projectiles.length,
          peels: peels.length,
        }),
        zombieCounts: () => zombies.reduce((acc, z) => {
          acc[z.kind] = (acc[z.kind] || 0) + 1;
          acc.confused = (acc.confused || 0) + (z.confused > 0 ? 1 : 0);
          return acc;
        }, { total: zombies.length, goo: gooBlobs.length }),
        spawnSpitterNear: (dist = 12) => {
          const z = spawnZombie(player.x + dist, player.z, "spitter");
          z.spitCd = 0.2;
          return { x: z.x, z: z.z, kind: z.kind };
        },
        placeAudience: (count = 6, radius = 7) => {
          const total = clamp(Math.floor(Number(count) || 0), 0, civilians.length);
          for (let i = 0; i < total; i += 1) {
            const angle = (i / Math.max(1, total)) * Math.PI * 2;
            const distance = Math.max(3.2, Number(radius) || 7) + (i % 3) * 0.45;
            let point = {
              x: player.x + Math.cos(angle) * distance,
              z: player.z + Math.sin(angle) * distance,
            };
            if (!isWalkable(point.x, point.z, civilians[i].radius)) {
              point = randomSidewalkPointNear(player, Math.max(7, distance + 2), civilians[i].radius);
            }
            placeCivilian(civilians[i], point.x, point.z);
          }
          return audienceSnapshot();
        },
        scatterAudience: (minDistance = 45) => {
          const minD = Math.max(10, Number(minDistance) || 45);
          civilians.forEach((civilian) => {
            for (let i = 0; i < 80; i += 1) {
              const point = randomSidewalkPoint(civilian.radius);
              if (distSq(point, player) > minD * minD) {
                placeCivilian(civilian, point.x, point.z);
                return;
              }
            }
          });
          return audienceSnapshot();
        },
        setPlayer: (x, z) => {
          setActorPosition(player, Number(x) || points.start.x, Number(z) || points.start.z);
          updateDistrict();
          updateCamera(1);
          updateHUD();
          return { x: player.x, z: player.z };
        },
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
        favor: () => ({
          active: state.favor ? { ...state.favor } : null,
          definition: state.favor ? favorById(state.favor.id) : null,
        }),
        setFavor: (id, place = true) => {
          const favor = startFavorForCycle(id);
          if (favor && place && favor.target) {
            setActorPosition(player, favor.target.x, favor.target.z);
            updateDistrict();
            updateCamera(1);
          }
          updateHUD();
          return window.__UNHINGED.favor();
        },
        tickFavor: () => {
          const favor = activeFavor();
          if (!favor || !state.favor) return window.__UNHINGED.favor();
          state.favor.progress = Math.max(0, favor.goal - 1);
          progressFavor(favor.kind, 1, {
            type: favor.types ? favor.types[0] : null,
            audienceCount: favor.minAudience || 99,
            itemId: favor.kind === "trap" ? "peel" : activeItem().id,
          });
          updateHUD();
          return window.__UNHINGED.favor();
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
