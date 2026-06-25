/* ============================================================
   RIZZ-CRAFT 3D - Rainbot procedural voxel sandbox
   ------------------------------------------------------------
   Original Three.js voxel world: mine, place, craft, save, and
   survive the night against Rainbot enemies. Debug hook:
   window.__RIZZ
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "rizz-craft";
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;

  const api = window.RB || {
    recordScore() { return false; },
    getHighScore() { return 0; },
    showRewarded() { return Promise.resolve(true); },
    isAdFree() { return false; },
    toast(message) { console.log(message); },
  };

  if (!window.THREE) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#070913";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px sans-serif";
    ctx.fillText("Three.js failed to load.", 28, 58);
    ctx.font = "14px sans-serif";
    ctx.fillText("Refresh the page or check the vendored runtime.", 28, 86);
    return;
  }

  const THREE = window.THREE;
  const SAVE_VERSION = 7;
  const WORLD_X = 640;
  const WORLD_Y = 160;
  const WORLD_Z = 640;
  const CHUNK = 16;
  const SEA_LEVEL = 48;
  const LAVA_LEVEL = 18;
  const EDGE_OCEAN = 56;
  const RENDER_RADIUS_CHUNKS = 6;
  const DECOR_RADIUS_CHUNKS = 6;
  const HOTBAR = 9;
  const BAG_SLOTS = 27;
  const MAX_HP = 100;
  const DAMAGE_GRACE = 1.1;
  const SPAWN_GRACE = 4;
  const OCEAN_FATIGUE_LIMIT = 8.5;
  const WATER_MOVE_MULT = 0.55;
  const WATER_GRAVITY_MULT = 0.22;
  const SWIM_UP_SPEED = 4.4;
  const WATER_FLOW_LIMIT = 96;
  const LAVA_MOVE_MULT = 0.34;
  const LAVA_GRAVITY_MULT = 0.12;
  const LAVA_SWIM_UP_SPEED = 2.2;
  const LAVA_FALL_SPEED = -1.15;
  const LAVA_FLOW_LIMIT = 18;
  const PLAYER_RADIUS = 0.32;
  const PLAYER_HEIGHT = 1.75;
  const EYE_HEIGHT = 1.55;
  const GRAVITY = 28;
  const MOVE_SPEED = 5.3;
  const SPRINT_SPEED = 7.2;
  const JUMP_SPEED = 8.6;
  const REACH = 6.1;
  const DAY_SECONDS = 420;
  const FRIENDLY_COUNT = 58;
  const FRIENDLY_SPAWN_RING = 12;
  const FRIENDLY_HURT_SECONDS = 0.24;
  const FRIENDLY_HIT_COOLDOWN = 0.5;
  const HELD_SWING_SECONDS = 0.32;
  const HELD_GATHER_SECONDS = 0.24;
  const MOB_HURT_SECONDS = 0.28;
  const MOB_ATTACK_SECONDS = 0.42;
  const PLAYER_HURT_SECONDS = 0.46;
  const FX_GRAVITY = 10;

  const AIR = 0;
  const GRASS = 1;
  const DIRT = 2;
  const STONE = 3;
  const BEDROCK = 4;
  const LOG = 5;
  const LEAVES = 6;
  const PLANKS = 7;
  const TABLE = 8;
  const COAL_ORE = 9;
  const RIZZ_ORE = 10;
  const SIGMA_ORE = 11;
  const TORCH = 12;
  const WATER = 13;
  const TALL_GRASS = 14;
  const FLOWER = 15;
  const SAND = 16;
  const SNOW = 17;
  const LAVA = 18;

  const STICK = 100;
  const COAL = 101;
  const RIZZ = 102;
  const SIGMA = 103;
  const PICK_WOOD = 110;
  const PICK_STONE = 111;
  const AXE_WOOD = 112;
  const SWORD_WOOD = 113;
  const SWORD_STONE = 114;
  const SWORD_SIGMA = 115;
  const FRIENDLY_FRUIT = 116;

  const DEF = {};
  function def(code, d) {
    d.code = code;
    d.rgb = hexToRgb(d.color || "#ffffff");
    DEF[code] = d;
  }

  def(AIR, { name: "Air", kind: "air", solid: false, color: "#000000" });
  def(GRASS, { name: "Legacy Grass Top", kind: "block", solid: true, hardness: 0.45, drop: DIRT, color: "#34d63b", side: "#7a5732" });
  def(DIRT, { name: "Dirt", kind: "block", solid: true, hardness: 0.45, color: "#80542f" });
  def(STONE, { name: "Ohio Stone", kind: "block", solid: true, hardness: 1.25, needTool: "pick", drop: STONE, color: "#868894" });
  def(BEDROCK, { name: "Bedrock", kind: "block", solid: true, hardness: Infinity, color: "#262630" });
  def(LOG, { name: "Skibidi Log", kind: "block", solid: true, hardness: 0.85, best: "axe", color: "#78502f" });
  def(LEAVES, { name: "Brainrot Leaves", kind: "block", solid: true, hardness: 0.2, drop: null, color: "#21b83a", transparent: true });
  def(PLANKS, { name: "Toilet Planks", kind: "block", solid: true, hardness: 0.55, best: "axe", color: "#b98245" });
  def(TABLE, { name: "Crafting Toilet", kind: "block", solid: true, hardness: 0.75, best: "axe", color: "#d7e1e8", decor: true });
  def(COAL_ORE, { name: "Gyatt Coal Ore", kind: "block", solid: true, hardness: 1.55, needTool: "pick", drop: COAL, color: "#6f707b", ore: "#22232b" });
  def(RIZZ_ORE, { name: "Rizz Ore", kind: "block", solid: true, hardness: 1.8, needTool: "pick", drop: RIZZ, color: "#777985", ore: "#ffcf3a" });
  def(SIGMA_ORE, { name: "Sigma Ore", kind: "block", solid: true, hardness: 2.45, needTool: "pick", needTier: 2, drop: SIGMA, color: "#767987", ore: "#4beaff" });
  def(TORCH, { name: "Rizz Torch", kind: "block", solid: false, hardness: 0.05, drop: TORCH, light: 1, color: "#ffd75a", decor: true });
  def(WATER, { name: "Rizzwater", kind: "block", solid: false, hardness: Infinity, drop: null, color: "#2f8fe8", transparent: true, liquid: true });
  def(TALL_GRASS, { name: "Tall Grass", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#48d83e", decor: true });
  def(FLOWER, { name: "Rizz Bloom", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#ff6fa8", decor: true });
  def(SAND, { name: "Ohio Sand", kind: "block", solid: true, hardness: 0.45, color: "#d8c073" });
  def(SNOW, { name: "Powder Snow", kind: "block", solid: true, hardness: 0.28, color: "#e9f6ff" });
  def(LAVA, { name: "Deep Lava", kind: "liquid", solid: false, hardness: Infinity, drop: null, color: "#ff6a1a", transparent: true, liquid: true });

  def(STICK, { name: "Ohio Stick", kind: "item", color: "#9a672f" });
  def(COAL, { name: "Gyatt Coal", kind: "item", color: "#252631" });
  def(RIZZ, { name: "Rizz Crystal", kind: "item", color: "#ffcf3a" });
  def(SIGMA, { name: "Sigma Gem", kind: "item", color: "#4beaff" });
  def(PICK_WOOD, { name: "Wood Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 1, mult: 3 }, color: "#b98245" });
  def(PICK_STONE, { name: "Stone Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 2, mult: 5 }, color: "#a6a9b5" });
  def(AXE_WOOD, { name: "Wood Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 1, mult: 3 }, color: "#b98245" });
  def(SWORD_WOOD, { name: "Wood Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 1, damage: 3 }, color: "#b98245" });
  def(SWORD_STONE, { name: "Stone Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 2, damage: 5 }, color: "#a6a9b5" });
  def(SWORD_SIGMA, { name: "Sigma Blade", kind: "item", stack: 1, tool: { type: "sword", tier: 3, damage: 11 }, color: "#4beaff" });
  def(FRIENDLY_FRUIT, { name: "Rizz Fruit", kind: "item", stack: 12, color: "#ff6fa8" });

  const RECIPES = [
    { out: { code: PLANKS, n: 4 }, in: [[LOG, 1]], table: false },
    { out: { code: STICK, n: 4 }, in: [[PLANKS, 2]], table: false },
    { out: { code: TABLE, n: 1 }, in: [[PLANKS, 4]], table: false },
    { out: { code: TORCH, n: 4 }, in: [[COAL, 1], [STICK, 1]], table: false },
    { out: { code: PICK_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { out: { code: AXE_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { out: { code: SWORD_WOOD, n: 1 }, in: [[PLANKS, 2], [STICK, 1]], table: true },
    { out: { code: PICK_STONE, n: 1 }, in: [[STONE, 3], [STICK, 2]], table: true },
    { out: { code: SWORD_STONE, n: 1 }, in: [[STONE, 2], [STICK, 1]], table: true },
    { out: { code: SWORD_SIGMA, n: 1 }, in: [[SIGMA, 2], [STICK, 1]], table: true },
  ];

  const BIOMES = [
    { id: 0, name: "Meadow", grass: "#34d63b", side: "#7d5a34", leaf: "#21b83a", tree: 0.12, treeSpacing: 12, flora: 0.16, flowers: 0.28, palette: ["#ff6fa8", "#ffe45c", "#e8fff3"] },
    { id: 1, name: "Open Forest", grass: "#1fb83a", side: "#6f5231", leaf: "#147f2f", tree: 0.62, treeSpacing: 10, flora: 0.10, flowers: 0.12, treeStyle: "oak", palette: ["#ff85bd", "#f5d85a"] },
    { id: 2, name: "Highland", grass: "#84c937", side: "#75613a", leaf: "#65b936", tree: 0.16, treeSpacing: 13, flora: 0.08, flowers: 0.10, palette: ["#fff0a6", "#ccefff"] },
    { id: 3, name: "Marsh", grass: "#36ca6f", side: "#5f5134", leaf: "#27b05f", tree: 0.18, treeSpacing: 12, flora: 0.22, flowers: 0.22, treeStyle: "willow", palette: ["#d6f7a6", "#b4f0ff"] },
    { id: 4, name: "Neon Grove", grass: "#25ee9a", side: "#4d6541", leaf: "#16eeb1", tree: 0.30, treeSpacing: 11, flora: 0.24, flowers: 0.40, treeStyle: "oak", palette: ["#43e6ff", "#ff4fd8", "#faff6a"] },
    { id: 5, name: "Prairie", grass: "#9ed647", side: "#8b7339", leaf: "#85bd3a", tree: 0.05, treeSpacing: 16, flora: 0.26, flowers: 0.34, palette: ["#ffe45c", "#ffffff", "#ff9b5c"] },
    { id: 6, name: "Crystal Ridge", grass: "#5fd9ea", side: "#677f83", leaf: "#76f6ff", tree: 0.10, treeSpacing: 15, flora: 0.10, flowers: 0.26, treeStyle: "crystal", palette: ["#8af7ff", "#d9fffb"] },
    { id: 7, name: "Ash Flats", grass: "#9dab88", side: "#6d6259", leaf: "#819f72", tree: 0.03, treeSpacing: 18, flora: 0.06, flowers: 0.08, palette: ["#c8b6a6", "#e7ddc8"] },
    { id: 8, name: "Pine Barrens", grass: "#38a94d", side: "#654b33", leaf: "#157c38", tree: 0.56, treeSpacing: 11, flora: 0.08, flowers: 0.08, treeStyle: "pine", palette: ["#c9ffe0", "#fff1a8"] },
    { id: 9, name: "Birch Glade", grass: "#80e869", side: "#795d36", leaf: "#76d85c", tree: 0.28, treeSpacing: 12, flora: 0.18, flowers: 0.36, treeStyle: "birch", palette: ["#ffffff", "#ffd1eb", "#ffe45c"] },
    { id: 10, name: "Sun-Baked Dunes", grass: "#d9c85e", side: "#b18a48", leaf: "#c3c64d", tree: 0.02, treeSpacing: 18, flora: 0.05, flowers: 0.10, surface: "sand", palette: ["#fff0a0", "#f7a85a"] },
    { id: 11, name: "Frost Peaks", grass: "#e6fbff", side: "#91a7af", leaf: "#d7fbff", tree: 0.08, treeSpacing: 16, flora: 0.05, flowers: 0.16, surface: "snow", treeStyle: "pine", palette: ["#dfffff", "#bfe8ff"] },
  ];

  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.72 },
    { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.58 },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.48 },
    { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.82 },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.66 },
  ];

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 560);
  camera.rotation.order = "YXZ";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const worldGroup = new THREE.Group();
  const waterGroup = new THREE.Group();
  const lavaGroup = new THREE.Group();
  const decorGroup = new THREE.Group();
  const mobGroup = new THREE.Group();
  const friendlyGroup = new THREE.Group();
  const effectGroup = new THREE.Group();
  const cloudGroup = new THREE.Group();
  scene.add(worldGroup, waterGroup, lavaGroup, decorGroup, friendlyGroup, mobGroup, effectGroup, cloudGroup);

  const ambient = new THREE.HemisphereLight(0xd9fbff, 0x3b2b22, 0.98);
  const sun = new THREE.DirectionalLight(0xfff7df, 1.26);
  sun.position.set(36, 70, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(ambient, sun);

  const TEX = {
    grassTop: 0,
    grassSide: 1,
    dirt: 2,
    stone: 3,
    bedrock: 4,
    logSide: 5,
    logTop: 6,
    leaves: 7,
    planks: 8,
    table: 9,
    ore: 10,
    sand: 11,
    snow: 12,
  };
  const TEX_COLS = 8;
  const TEX_ROWS = 2;
  const blockTexture = buildBlockTextureAtlas();
  const blockMaterial = new THREE.MeshLambertMaterial({ map: blockTexture, vertexColors: true, side: THREE.DoubleSide });
  const plantMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, alphaTest: 0.2 });
  const waterMaterial = new THREE.MeshPhongMaterial({
    color: 0x1aa9ff,
    transparent: true,
    opacity: 0.64,
    shininess: 92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const lavaMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5a14,
    vertexColors: true,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const enemyMaterials = {
    porcelain: new THREE.MeshLambertMaterial({ color: 0xe8edf1 }),
    porcelainDark: new THREE.MeshLambertMaterial({ color: 0xaeb8c3 }),
    black: new THREE.MeshLambertMaterial({ color: 0x070913 }),
    red: new THREE.MeshLambertMaterial({ color: 0xb8233a }),
    purple: new THREE.MeshLambertMaterial({ color: 0x7842a1 }),
    cyan: new THREE.MeshLambertMaterial({ color: 0x43e6ff }),
    toxic: new THREE.MeshLambertMaterial({ color: 0x73ff45 }),
    orange: new THREE.MeshLambertMaterial({ color: 0xff8d2a }),
    pink: new THREE.MeshLambertMaterial({ color: 0xff4fb8 }),
    shadow: new THREE.MeshLambertMaterial({ color: 0x191a2b }),
    bone: new THREE.MeshLambertMaterial({ color: 0xffefc7 }),
  };
  const friendlyMaterials = {
    lime: new THREE.MeshLambertMaterial({ color: 0x7dff66 }),
    mango: new THREE.MeshLambertMaterial({ color: 0xffbd3f }),
    berry: new THREE.MeshLambertMaterial({ color: 0xff5ac8 }),
    sky: new THREE.MeshLambertMaterial({ color: 0x49d8ff }),
    cream: new THREE.MeshLambertMaterial({ color: 0xfff2c9 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080912 }),
    blush: new THREE.MeshLambertMaterial({ color: 0xff7aa8 }),
    white: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };

  const selectionBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxBufferGeometry(1.03, 1.03, 1.03)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  selectionBox.visible = false;
  scene.add(selectionBox);

  const heldGroup = new THREE.Group();
  camera.add(heldGroup);
  scene.add(camera);

  const TARGET_HOLD_FRAMES = 1;
  let targetHoldFrames = 0;

  const state = {
    started: false,
    paused: false,
    crafting: false,
    world: new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z),
    baseWorld: new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z),
    surface: new Int16Array(WORLD_X * WORLD_Z),
    biome: new Uint8Array(WORLD_X * WORLD_Z),
    edits: new Map(),
    chunks: new Map(),
    seed: 0,
    player: {
      x: WORLD_X / 2,
      y: 26,
      z: WORLD_Z / 2,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      onGround: false,
      hp: MAX_HP,
      hurtCd: 0,
      inWater: false,
      inLava: false,
      hurtAnim: 0,
    },
    input: { forward: 0, right: 0, jump: false, mine: false, place: false, sprint: false },
    mobs: [],
    friendlies: [],
    fx: [],
    hotbar: [],
    bag: [],
    bagOpen: false,
    selected: 0,
    target: null,
    mining: null,
    attackCd: 0,
    swingTimer: 0,
    swingKind: "gather",
    gatherPhase: 0,
    attackFlash: 0,
    placeQueued: false,
    placeCd: 0,
    day: 1,
    time: 0.21,
    spawnTimer: 2,
    mined: 0,
    score: 0,
    high: 0,
    sigmaForged: false,
    oceanFatigue: 0,
    visibleChunkCount: 0,
    mode: "mine",
  };

  const legacySaveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: SAVE_VERSION });
  const WORLD_INDEX_KEY = "rainbot_rizz_craft_worlds:v1";
  const WORLD_SAVE_PREFIX = "rainbot_rizz_craft_world:";
  const MAX_WORLDS = 12;

  const ui = buildHud();
  const overlay = document.getElementById("overlay");
  const worldPanel = document.getElementById("world-panel");
  const craftPanel = document.getElementById("craft-panel");
  const craftList = document.getElementById("craft-list");
  let currentWorldId = "";
  let currentWorldName = "";
  let currentWorldSeed = 0;
  let worldAutosaveTimer = 0;
  let last = 0;
  let raf = 0;
  let decorDirty = true;
  let cloudsBuilt = false;
  let rendererWidth = 0;
  let rendererHeight = 0;
  let rendererPixelRatio = 0;
  let heldRenderCode = null;
  let bagRenderKey = "";
  let selectionCueTimer = 0;
  let chunkCenterKey = "";
  let decorCenterKey = "";
  let mobSpawnSerial = 0;
  let sunDisk = null;
  let moonDisk = null;
  const reusableVector = new THREE.Vector3();
  const moveForwardVector = new THREE.Vector3();
  const moveRightVector = new THREE.Vector3();
  const worldUpVector = new THREE.Vector3(0, 1, 0);
  const sunOrbitVector = new THREE.Vector3();
  const moonOrbitVector = new THREE.Vector3();
  const mobHurtColor = new THREE.Color(0xfff0f0);
  const mobAttackColor = new THREE.Color(0xffd45a);
  const keyMove = { forward: false, back: false, left: false, right: false };
  const moveSources = {
    keyboard: { forward: 0, right: 0 },
    touch: { forward: 0, right: 0 },
  };
  const friendlyHurtColor = new THREE.Color(0xffc5f0);

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const rgbCache = new Map();
  function cachedRgb(hex) {
    if (!rgbCache.has(hex)) rgbCache.set(hex, hexToRgb(hex));
    return rgbCache.get(hex);
  }

  function buildBlockTextureAtlas() {
    const tile = 16;
    const canvasTex = document.createElement("canvas");
    canvasTex.width = TEX_COLS * tile;
    canvasTex.height = TEX_ROWS * tile;
    const ctx = canvasTex.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    function px(tileId, x, y, v) {
      const tx = (tileId % TEX_COLS) * tile;
      const ty = Math.floor(tileId / TEX_COLS) * tile;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(tx + x, ty + y, 1, 1);
    }
    function noise(tileId, base, spread, salt = 0) {
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          const h = hash32(tileId * 901 + x * 37 + y * 101);
          let v = base + ((h & 255) / 255 - 0.5) * spread;
          if (salt && (h >>> 8) % salt === 0) v += spread * 0.6;
          px(tileId, x, y, Math.max(35, Math.min(255, Math.round(v))));
        }
      }
    }
    function stripes(tileId, base, spread, vertical = true) {
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          const band = vertical ? x : y;
          const h = hash32(tileId * 701 + x * 19 + y * 53);
          const wave = Math.sin((band + (h & 3)) * 0.9) * 0.5 + 0.5;
          px(tileId, x, y, Math.round(base + wave * spread + ((h & 255) / 255 - 0.5) * 18));
        }
      }
    }
    noise(TEX.grassTop, 186, 42, 13);
    noise(TEX.grassSide, 158, 30, 0);
    for (let x = 0; x < tile; x++) for (let y = 0; y < 4; y++) px(TEX.grassSide, x, y, 198 - y * 8);
    noise(TEX.dirt, 165, 62, 9);
    noise(TEX.stone, 182, 52, 11);
    noise(TEX.bedrock, 116, 72, 7);
    stripes(TEX.logSide, 164, 58, true);
    noise(TEX.logTop, 190, 42, 0);
    for (let r = 3; r < 8; r += 2) {
      ctx.strokeStyle = `rgb(${135 + r * 8},${135 + r * 8},${135 + r * 8})`;
      ctx.strokeRect((TEX.logTop % TEX_COLS) * tile + 8 - r, Math.floor(TEX.logTop / TEX_COLS) * tile + 8 - r, r * 2, r * 2);
    }
    noise(TEX.leaves, 172, 48, 6);
    stripes(TEX.planks, 182, 54, false);
    noise(TEX.table, 218, 28, 0);
    noise(TEX.ore, 170, 56, 5);
    noise(TEX.sand, 214, 32, 17);
    noise(TEX.snow, 236, 24, 23);

    const texture = new THREE.CanvasTexture(canvasTex);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function applyDirectionalInput() {
    state.input.forward = clamp(moveSources.keyboard.forward + moveSources.touch.forward, -1, 1);
    state.input.right = clamp(moveSources.keyboard.right + moveSources.touch.right, -1, 1);
  }
  function refreshKeyboardMovement() {
    moveSources.keyboard.forward = (keyMove.forward ? 1 : 0) - (keyMove.back ? 1 : 0);
    moveSources.keyboard.right = (keyMove.right ? 1 : 0) - (keyMove.left ? 1 : 0);
    applyDirectionalInput();
  }
  function clearDirectionalInput() {
    keyMove.forward = false;
    keyMove.back = false;
    keyMove.left = false;
    keyMove.right = false;
    moveSources.keyboard.forward = 0;
    moveSources.keyboard.right = 0;
    moveSources.touch.forward = 0;
    moveSources.touch.right = 0;
    applyDirectionalInput();
    state.input.jump = false;
    state.input.mine = false;
    state.input.place = false;
    state.placeQueued = false;
    state.input.sprint = false;
  }
  function setKeyboardMove(key, down) {
    if (key === "w" || key === "arrowup") keyMove.forward = down;
    else if (key === "s" || key === "arrowdown") keyMove.back = down;
    else if (key === "a" || key === "arrowleft") keyMove.left = down;
    else if (key === "d" || key === "arrowright") keyMove.right = down;
    else return false;
    refreshKeyboardMovement();
    return true;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function index(x, y, z) { return (y * WORLD_Z + z) * WORLD_X + x; }
  function surfaceIndex(x, z) { return z * WORLD_X + x; }
  function inWorld(x, y, z) { return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z; }
  function isPlaceable(code) { return code > AIR && DEF[code] && DEF[code].kind === "block" && code !== WATER && code !== TALL_GRASS && code !== FLOWER; }
  function maxStack(code) { return (DEF[code] && DEF[code].stack) || 99; }
  function canWaterFill(code) {
    return code === AIR || code === TALL_GRASS || code === FLOWER || code === TORCH;
  }
  function canLavaFill(code) {
    return code === AIR || code === TALL_GRASS || code === FLOWER || code === TORCH || code === WATER;
  }

  function hash32(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = Math.imul(n, 9);
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    n = n ^ (n >>> 15);
    return n >>> 0;
  }
  function hash2(x, z, seed = state.seed) {
    return hash32(Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed) / 4294967295;
  }
  function hash3(x, y, z, seed = state.seed) {
    return hash32(Math.imul(x | 0, 1597334677) ^ Math.imul(y | 0, 3812015801) ^ Math.imul(z | 0, 958682123) ^ seed) / 4294967295;
  }
  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      api.toast("Could not save world list", "bad");
      return false;
    }
  }
  function removeJson(key) {
    try { localStorage.removeItem(key); } catch (error) {}
  }
  function escapeWorldHtml(value) {
    return String(value == null ? "" : value).replace(/[&"<>]/g, (ch) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[ch]));
  }
  function cleanWorldName(value) {
    const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return name || `World ${readWorldIndex().length + 1}`;
  }
  function randomSeed() {
    return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  }
  function seedFromInput(value) {
    const text = String(value || "").trim();
    if (!text) return randomSeed();
    if (/^-?\d+$/.test(text)) return Number(text) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return hash32(h) >>> 0;
  }
  function worldSaveKey(id) {
    return WORLD_SAVE_PREFIX + id;
  }
  function worldId(seed) {
    return `world-${(Date.now()).toString(36)}-${(seed >>> 0).toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
  }
  function readWorldIndex() {
    const worlds = readJson(WORLD_INDEX_KEY, []);
    if (!Array.isArray(worlds)) return [];
    return worlds
      .filter((world) => world && world.id && typeof world.seed === "number")
      .slice(0, MAX_WORLDS)
      .sort((a, b) => Number(b.savedAt || b.createdAt || 0) - Number(a.savedAt || a.createdAt || 0));
  }
  function writeWorldIndex(worlds) {
    const clean = (Array.isArray(worlds) ? worlds : [])
      .filter((world) => world && world.id && typeof world.seed === "number")
      .slice(0, MAX_WORLDS);
    return writeJson(WORLD_INDEX_KEY, clean);
  }
  function readWorldSave(id) {
    const saved = readJson(worldSaveKey(id), null);
    if (!saved || saved.version !== SAVE_VERSION || !saved.data) return null;
    return saved;
  }
  function writeWorldSave(id, data, meta = {}) {
    if (!id || !data) return false;
    const saved = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      meta,
      data,
    };
    return writeJson(worldSaveKey(id), saved);
  }
  function deleteWorldSave(id) {
    removeJson(worldSaveKey(id));
  }
  function formatWorldSavedAt(value) {
    if (window.RBGameSaves && window.RBGameSaves.formatSavedAt) return window.RBGameSaves.formatSavedAt(value);
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "Saved progress";
    return "Saved " + date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function upsertWorldSummary(id, summary) {
    const worlds = readWorldIndex().filter((world) => world.id !== id);
    worlds.unshift({ ...summary, id });
    writeWorldIndex(worlds);
  }
  function migrateLegacyWorld() {
    if (!legacySaveSlot || !legacySaveSlot.read) return;
    const legacy = legacySaveSlot.read();
    if (!legacy || !legacy.data || typeof legacy.data.seed !== "number") return;
    const worlds = readWorldIndex();
    if (worlds.some((world) => world.legacy)) return;
    const id = worldId(legacy.data.seed);
    const name = "Legacy World";
    const savedAt = Number(legacy.savedAt || Date.now());
    const copied = writeWorldSave(id, legacy.data, { id, name, seed: legacy.data.seed >>> 0 });
    if (!copied) return;
    worlds.unshift({
      id,
      name,
      seed: legacy.data.seed >>> 0,
      createdAt: savedAt,
      savedAt,
      day: Number(legacy.data.day || 1),
      score: Number(legacy.data.score || 0),
      legacy: true,
    });
    writeWorldIndex(worlds);
    legacySaveSlot.clear();
  }
  function saveCurrentWorld() {
    if (!currentWorldId || !state.started) return false;
    const data = snapshot();
    const savedAt = Date.now();
    const name = currentWorldName || "World";
    const seed = currentWorldSeed >>> 0;
    const existing = readWorldIndex().find((world) => world.id === currentWorldId);
    const ok = writeWorldSave(currentWorldId, data, { id: currentWorldId, name, seed });
    if (ok) {
      upsertWorldSummary(currentWorldId, {
        name,
        seed,
        createdAt: Number(existing && existing.createdAt) || savedAt,
        savedAt,
        day: Number(data.day || 1),
        score: Number(data.score || 0),
      });
      renderWorldPanel();
    }
    return ok;
  }
  function renderWorldPanel() {
    if (!worldPanel) return;
    const worlds = readWorldIndex();
    const cards = worlds.map((world) => {
      const active = world.id === currentWorldId ? " - active" : "";
      return `<div class="world-card" data-world-id="${escapeWorldHtml(world.id)}">
        <div>
          <div class="world-card__name">${escapeWorldHtml(world.name || "World")}${active}</div>
          <div class="world-card__meta">Seed ${escapeWorldHtml(world.seed >>> 0)} - Day ${Number(world.day || 1)} - Score ${Number(world.score || 0).toLocaleString()} - ${escapeWorldHtml(formatWorldSavedAt(world.savedAt || world.createdAt))}</div>
        </div>
        <div class="world-card__actions">
          <button class="btn btn--secondary" type="button" data-world-load="${escapeWorldHtml(world.id)}">Play</button>
          <button class="btn btn--ghost" type="button" data-world-delete="${escapeWorldHtml(world.id)}">Delete</button>
        </div>
      </div>`;
    }).join("");
    worldPanel.hidden = false;
    worldPanel.innerHTML = `<div class="world-create">
      <label class="world-field">World name<input id="world-name-input" maxlength="28" value="New World" autocomplete="off" /></label>
      <label class="world-field">Seed<input id="world-seed-input" placeholder="random" autocomplete="off" /></label>
      <button class="btn btn--primary" type="button" id="world-create-btn">Create</button>
    </div>
    <div class="world-list">${cards || `<div class="world-empty">No saved worlds yet.</div>`}</div>`;
    const createButton = document.getElementById("world-create-btn");
    if (createButton) createButton.addEventListener("click", () => {
      const name = document.getElementById("world-name-input");
      const seed = document.getElementById("world-seed-input");
      createWorld(name && name.value, seed && seed.value);
    });
    worldPanel.querySelectorAll("[data-world-load]").forEach((button) => {
      button.addEventListener("click", () => loadWorld(button.dataset.worldLoad));
    });
    worldPanel.querySelectorAll("[data-world-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteWorld(button.dataset.worldDelete));
    });
  }
  function setWorldOverlay() {
    if (!overlay) return;
    document.getElementById("overlay-title").textContent = "RIZZ-CRAFT WORLDS";
    document.getElementById("overlay-sub").innerHTML = "Choose a saved world or enter a seed to generate a new one.";
    document.getElementById("overlay-score").innerHTML = "";
    document.getElementById("btn-primary").textContent = state.started ? "Resume" : "Random World";
    overlay.classList.add("overlay--show");
    renderWorldPanel();
  }
  function openWorldManager() {
    clearDirectionalInput();
    unlockPointer();
    if (state.started) state.paused = true;
    state.crafting = false;
    state.bagOpen = false;
    if (craftPanel) craftPanel.classList.remove("is-open");
    renderBag();
    setWorldOverlay();
  }
  function hideWorldPanel() {
    if (worldPanel) {
      worldPanel.hidden = true;
      worldPanel.innerHTML = "";
    }
  }
  function createWorld(nameValue = "", seedValue = "") {
    const seed = seedFromInput(seedValue);
    const name = cleanWorldName(nameValue);
    const id = worldId(seed);
    currentWorldId = id;
    currentWorldName = name;
    currentWorldSeed = seed >>> 0;
    initGame(seed);
    startGame();
    saveCurrentWorld();
    api.toast(`Created ${name}`, "good");
  }
  function loadWorld(id) {
    const world = readWorldIndex().find((item) => item.id === id);
    const saved = readWorldSave(id);
    if (!world || !saved) {
      api.toast("World save missing", "bad");
      renderWorldPanel();
      return;
    }
    currentWorldId = world.id;
    currentWorldName = world.name || "World";
    currentWorldSeed = world.seed >>> 0;
    restoreGame(saved);
    api.toast(`Loaded ${currentWorldName}`, "good");
  }
  function deleteWorld(id) {
    const world = readWorldIndex().find((item) => item.id === id);
    if (!world) return;
    if (!window.confirm(`Delete ${world.name || "this world"}?`)) return;
    deleteWorldSave(id);
    writeWorldIndex(readWorldIndex().filter((item) => item.id !== id));
    if (currentWorldId === id) {
      currentWorldId = "";
      currentWorldName = "";
      currentWorldSeed = 0;
      state.started = false;
      state.paused = false;
      initGame();
    }
    renderWorldPanel();
  }
  function biomeAt(x, z) {
    const bx = clamp(Math.floor(x), 0, WORLD_X - 1);
    const bz = clamp(Math.floor(z), 0, WORLD_Z - 1);
    return BIOMES[state.biome[surfaceIndex(bx, bz)]] || BIOMES[0];
  }
  function biomeRgb(biome, key, fallback = "grass") {
    const rgbKey = `${key}Rgb`;
    if (!biome[rgbKey]) biome[rgbKey] = hexToRgb(biome[key] || biome[fallback] || "#ffffff");
    return biome[rgbKey];
  }
  function mixRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  function scaleRgb(rgb, f) {
    return [rgb[0] * f, rgb[1] * f, rgb[2] * f];
  }
  function vividRgb(rgb, saturation = 1.22, brightness = 1.08) {
    const luma = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    return [
      clamp((luma + (rgb[0] - luma) * saturation) * brightness, 0, 1),
      clamp((luma + (rgb[1] - luma) * saturation) * brightness, 0, 1),
      clamp((luma + (rgb[2] - luma) * saturation) * brightness, 0, 1),
    ];
  }
  function surfaceBlockForBiome(biome, shoreline) {
    if (shoreline || biome.surface === "sand") return SAND;
    return DIRT;
  }
  function nearSurfaceBlockForBiome(biome, shoreline) {
    if (shoreline || biome.surface === "sand") return SAND;
    return DIRT;
  }
  function dirtTopOverlay(x, y, z) {
    const ix = clamp(x | 0, 0, WORLD_X - 1);
    const iz = clamp(z | 0, 0, WORLD_Z - 1);
    if (y !== state.surface[surfaceIndex(ix, iz)]) return null;
    const biome = biomeAt(ix, iz);
    if (biome.surface === "snow" || biome.id === 11) return "snow";
    if (biome.surface === "sand") return null;
    return "grass";
  }
  function canPlaceTreeSeed(x, z, biome, spawnDist) {
    if (spawnDist < 26 || biome.tree <= 0) return false;
    const spacing = biome.treeSpacing || 12;
    const cellX = Math.floor(x / spacing);
    const cellZ = Math.floor(z / spacing);
    const margin = Math.min(3, Math.floor(spacing / 3));
    const usable = Math.max(1, spacing - margin * 2);
    const pickX = cellX * spacing + margin + Math.floor(hash2(cellX * 19 + 5, cellZ * 23 - 7) * usable);
    const pickZ = cellZ * spacing + margin + Math.floor(hash2(cellX * 29 - 11, cellZ * 31 + 13) * usable);
    return x === pickX && z === pickZ && hash2(cellX + 101, cellZ - 73) < biome.tree;
  }
  function edgeOceanStrength(x, z) {
    const edge = Math.min(x, z, WORLD_X - 1 - x, WORLD_Z - 1 - z);
    return clamp((EDGE_OCEAN - edge) / EDGE_OCEAN, 0, 1);
  }
  function noise2(x, z, scale) {
    const sx = x * scale;
    const sz = z * scale;
    const x0 = Math.floor(sx);
    const z0 = Math.floor(sz);
    const tx = smooth(sx - x0);
    const tz = smooth(sz - z0);
    const a = hash2(x0, z0);
    const b = hash2(x0 + 1, z0);
    const c = hash2(x0, z0 + 1);
    const d = hash2(x0 + 1, z0 + 1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  function noise3(x, y, z, scale) {
    const sx = x * scale;
    const sy = y * scale;
    const sz = z * scale;
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const z0 = Math.floor(sz);
    const tx = smooth(sx - x0);
    const ty = smooth(sy - y0);
    const tz = smooth(sz - z0);
    function n(dx, dy, dz) { return hash3(x0 + dx, y0 + dy, z0 + dz); }
    const x00 = lerp(n(0, 0, 0), n(1, 0, 0), tx);
    const x10 = lerp(n(0, 1, 0), n(1, 1, 0), tx);
    const x01 = lerp(n(0, 0, 1), n(1, 0, 1), tx);
    const x11 = lerp(n(0, 1, 1), n(1, 1, 1), tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
  }
  function fbm2(x, z, scale, octaves) {
    let amp = 0.5;
    let freq = scale;
    let total = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      total += noise2(x, z, freq) * amp;
      norm += amp;
      amp *= 0.52;
      freq *= 2.03;
    }
    return total / norm;
  }

  function getBlock(x, y, z) {
    x = x | 0; y = y | 0; z = z | 0;
    if (y < 0) return BEDROCK;
    if (y >= WORLD_Y) return AIR;
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return BEDROCK;
    return state.world[index(x, y, z)];
  }
  function setBlock(x, y, z, code, track = true) {
    if (!inWorld(x, y, z)) return;
    const i = index(x, y, z);
    const prev = state.world[i];
    if (prev === code) return;
    state.world[i] = code;
    if (track) {
      const key = `${x},${y},${z}`;
      if (state.baseWorld[i] === code) state.edits.delete(key);
      else state.edits.set(key, code);
    }
    updateSurfaceColumn(x, z);
    rebuildChunksNear(x, z);
    if (DEF[prev].decor || DEF[code].decor || prev === WATER || code === WATER || prev === LAVA || code === LAVA) decorDirty = true;
  }
  function flowWaterNear(x, y, z, limit = WATER_FLOW_LIMIT) {
    const seeds = [];
    const seenSeeds = new Set();
    const seedDirs = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const dir of seedDirs) {
      const sx = x + dir[0];
      const sy = y + dir[1];
      const sz = z + dir[2];
      const key = `${sx},${sy},${sz}`;
      if (!inWorld(sx, sy, sz) || seenSeeds.has(key) || getBlock(sx, sy, sz) !== WATER) continue;
      seenSeeds.add(key);
      seeds.push({ x: sx, y: sy, z: sz });
    }
    if (!seeds.length) return 0;
    return spreadWaterFrom(seeds, limit);
  }
  function spreadWaterFrom(seeds, limit = WATER_FLOW_LIMIT) {
    const queue = seeds.slice();
    const queued = new Set(queue.map((p) => `${p.x},${p.y},${p.z}`));
    let filled = 0;

    function pushIfWater(x, y, z) {
      const key = `${x},${y},${z}`;
      if (!inWorld(x, y, z) || queued.has(key) || getBlock(x, y, z) !== WATER) return;
      queued.add(key);
      queue.push({ x, y, z });
    }
    function fill(x, y, z) {
      if (!inWorld(x, y, z) || !canWaterFill(getBlock(x, y, z)) || filled >= limit) return false;
      setBlock(x, y, z, WATER);
      filled++;
      const key = `${x},${y},${z}`;
      if (!queued.has(key)) {
        queued.add(key);
        queue.push({ x, y, z });
      }
      return true;
    }

    for (let i = 0; i < queue.length && filled < limit; i++) {
      const p = queue[i];
      if (getBlock(p.x, p.y, p.z) !== WATER) continue;
      const below = getBlock(p.x, p.y - 1, p.z);
      if (canWaterFill(below)) {
        fill(p.x, p.y - 1, p.z);
        continue;
      }
      if (below !== WATER && !isSolidBlock(below)) continue;
      for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dir[0];
        const nz = p.z + dir[1];
        if (fill(nx, p.y, nz)) continue;
        pushIfWater(nx, p.y, nz);
      }
    }
    return filled;
  }
  function flowLavaNear(x, y, z, limit = LAVA_FLOW_LIMIT) {
    const seeds = [];
    const seenSeeds = new Set();
    const seedDirs = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const dir of seedDirs) {
      const sx = x + dir[0];
      const sy = y + dir[1];
      const sz = z + dir[2];
      const key = `${sx},${sy},${sz}`;
      if (!inWorld(sx, sy, sz) || seenSeeds.has(key) || getBlock(sx, sy, sz) !== LAVA) continue;
      seenSeeds.add(key);
      seeds.push({ x: sx, y: sy, z: sz, flow: 0 });
    }
    if (!seeds.length) return 0;
    return spreadLavaFrom(seeds, limit);
  }
  function spreadLavaFrom(seeds, limit = LAVA_FLOW_LIMIT) {
    const queue = seeds.slice();
    const queued = new Set(queue.map((p) => `${p.x},${p.y},${p.z}`));
    let filled = 0;

    function pushIfLava(x, y, z, flow) {
      const key = `${x},${y},${z}`;
      if (!inWorld(x, y, z) || queued.has(key) || getBlock(x, y, z) !== LAVA) return;
      queued.add(key);
      queue.push({ x, y, z, flow });
    }
    function fill(x, y, z, flow) {
      if (!inWorld(x, y, z) || filled >= limit) return false;
      const code = getBlock(x, y, z);
      if (!canLavaFill(code)) return false;
      setBlock(x, y, z, code === WATER ? STONE : LAVA);
      filled++;
      if (code !== WATER) {
        const key = `${x},${y},${z}`;
        if (!queued.has(key)) {
          queued.add(key);
          queue.push({ x, y, z, flow });
        }
      }
      return true;
    }

    for (let i = 0; i < queue.length && filled < limit; i++) {
      const p = queue[i];
      if (getBlock(p.x, p.y, p.z) !== LAVA) continue;
      const below = getBlock(p.x, p.y - 1, p.z);
      if (canLavaFill(below)) {
        fill(p.x, p.y - 1, p.z, 0);
        continue;
      }
      if (below !== LAVA && !isSolidBlock(below)) continue;
      if (p.flow >= 3) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const offset = Math.floor(hash3(p.x, p.y, p.z) * dirs.length);
      for (let step = 0; step < dirs.length && filled < limit; step++) {
        const dir = dirs[(step + offset) % dirs.length];
        const nx = p.x + dir[0];
        const nz = p.z + dir[1];
        if (fill(nx, p.y, nz, p.flow + 1)) continue;
        pushIfLava(nx, p.y, nz, p.flow + 1);
      }
    }
    return filled;
  }
  function flowLiquidsNear(x, y, z) {
    const water = flowWaterNear(x, y, z);
    const lava = flowLavaNear(x, y, z);
    return water + lava;
  }
  function isSolidBlock(code) { return !!(DEF[code] && DEF[code].solid); }
  function occludes(code) { return code !== AIR && code !== WATER && code !== LAVA && code !== TORCH && code !== TALL_GRASS && code !== FLOWER && code !== TABLE; }

  function generateWorld(seed = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)) {
    state.seed = seed >>> 0;
    state.edits.clear();
    state.world.fill(AIR);
    state.surface.fill(SEA_LEVEL);
    state.biome.fill(0);

    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const dx = x - WORLD_X / 2;
        const dz = z - WORLD_Z / 2;
        const center = Math.sqrt(dx * dx + dz * dz);
        const continent = fbm2(x + 1200, z - 500, 0.011, 5);
        const detail = fbm2(x - 900, z + 700, 0.052, 4);
        const ridges = Math.abs(fbm2(x + 20, z + 20, 0.024, 4) - 0.5) * 2;
        let h = SEA_LEVEL + 12 + (continent - 0.48) * 38 + (detail - 0.5) * 9 + Math.pow(ridges, 1.7) * 12;
        const ocean = edgeOceanStrength(x, z);
        if (ocean > 0) {
          const shelf = SEA_LEVEL - 9 + noise2(x + 17, z - 23, 0.09) * 2;
          h = lerp(h, shelf, smooth(ocean));
        }
        const spawnBlend = clamp(1 - center / 20, 0, 1);
        h = lerp(h, SEA_LEVEL + 8 + Math.sin(x * 0.18) * 0.7 + Math.cos(z * 0.16) * 0.7, spawnBlend);
        const height = clamp(Math.round(h), 4, WORLD_Y - 9);
        const moisture = fbm2(x - 300, z + 300, 0.016, 4);
        const weird = fbm2(x + 700, z + 80, 0.014, 4);
        const temp = fbm2(x + 90, z - 840, 0.012, 4);
        let biome = 0;
        if (temp < 0.34 && height > SEA_LEVEL + 10) biome = 11;
        else if (height > SEA_LEVEL + 21 || ridges > 0.64) biome = 6;
        else if (temp > 0.72 && moisture < 0.34 && height <= SEA_LEVEL + 12) biome = 10;
        else if (weird < 0.30 && moisture < 0.54) biome = 7;
        else if (moisture > 0.68 && height <= SEA_LEVEL + 7) biome = 3;
        else if (weird > 0.72 && moisture > 0.38) biome = 4;
        else if (moisture < 0.28 && temp > 0.50) biome = 5;
        else if (moisture > 0.58 && temp < 0.48) biome = 8;
        else if (weird > 0.58 && moisture > 0.40) biome = 9;
        else if (height > SEA_LEVEL + 16) biome = 2;
        else if (moisture > 0.52) biome = 1;
        if (ocean > 0.62) biome = 10;
        state.biome[surfaceIndex(x, z)] = biome;
        state.surface[surfaceIndex(x, z)] = height;
      }
    }

    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const height = state.surface[surfaceIndex(x, z)];
        const biome = BIOMES[state.biome[surfaceIndex(x, z)]];
        for (let y = 0; y < WORLD_Y; y++) {
          let code = AIR;
          if (y === 0) code = BEDROCK;
          else if (y > height) code = y <= SEA_LEVEL ? WATER : AIR;
          else {
            const depth = height - y;
            const shoreline = height <= SEA_LEVEL + 1 || biome.id === 3;
            if (depth === 0) code = surfaceBlockForBiome(biome, shoreline);
            else if (depth < (biome.surface === "sand" ? 5 : 4)) code = nearSurfaceBlockForBiome(biome, shoreline);
            else code = STONE;

            if (code === STONE && y > 3 && y < height - 4) {
              const cave = noise3(x + 400, y * 1.35, z - 200, 0.08);
              const tunnel = noise3(x - 700, y * 1.8, z + 300, 0.045);
              if (cave > 0.72 || (tunnel > 0.63 && y < WORLD_Y - 10)) code = AIR;
              else {
                const r = hash3(x, y, z);
                if (y < height - 6 && r < 0.035) code = COAL_ORE;
                if (y < SEA_LEVEL + 10 && r >= 0.035 && r < 0.055) code = RIZZ_ORE;
                if (y < LAVA_LEVEL + 18 && r >= 0.055 && r < 0.064) code = SIGMA_ORE;
              }
            }
            if (y > 1 && y < LAVA_LEVEL) {
              const pocket = noise3(x - 1600, y * 2.6, z + 1800, 0.082);
              const vein = noise3(x + 230, y * 3.1, z - 510, 0.14);
              if (code === AIR && pocket > 0.46) code = LAVA;
              else if (code === STONE && pocket > 0.72 && vein > 0.58) code = LAVA;
            }
          }
          state.world[index(x, y, z)] = code;
        }
      }
    }

    growTreesAndDetails();
    carveSpawnMeadow();
    state.baseWorld.set(state.world);
    rebuildAllChunks();
    rebuildDecorations();
    buildClouds();
    buildStars();
    buildCelestials();
    spawnFriendlies();
  }

  function growTreesAndDetails() {
    for (let z = 2; z < WORLD_Z - 2; z++) {
      for (let x = 2; x < WORLD_X - 2; x++) {
        const si = surfaceIndex(x, z);
        const y = state.surface[si];
        const top = getBlock(x, y, z);
        const biome = BIOMES[state.biome[si]];
        if (top !== DIRT && top !== GRASS && top !== SNOW && !(top === SAND && biome.surface === "sand")) continue;
        const spawnDist = Math.hypot(x - WORLD_X / 2, z - WORLD_Z / 2);
        if (canPlaceTreeSeed(x, z, biome, spawnDist)) {
          placeTree(x, y + 1, z, state.biome[si]);
        } else if (spawnDist > 10) {
          const r = hash2(x * 37 + 3, z * 41 - 5);
          if (r < biome.flora) {
            const flowerRoll = hash2(x * 43 - 9, z * 47 + 17);
            setBase(x, y + 1, z, flowerRoll < biome.flowers ? FLOWER : TALL_GRASS);
          }
        }
      }
    }
  }
  function placeTree(x, y, z, biomeId) {
    const biome = BIOMES[biomeId] || BIOMES[0];
    const style = biome.treeStyle || "oak";
    const trunkH = (style === "pine" ? 6 : 4) + Math.floor(hash2(x + 41, z - 83) * (style === "pine" ? 4 : 3));
    for (let i = 0; i < trunkH && y + i < WORLD_Y - 1; i++) setBase(x, y + i, z, LOG);
    const top = y + trunkH;

    if (style === "pine") {
      for (let layer = -3; layer <= 2; layer++) {
        const radius = layer < -1 ? 2 : layer < 2 ? 1 : 0;
        placeLeafLayer(x, top + layer, z, radius, 0.11);
      }
      return;
    }

    if (style === "willow") {
      placeLeafLayer(x, top - 1, z, 2, 0.08);
      placeLeafLayer(x, top, z, 2, 0.12);
      placeLeafLayer(x, top + 1, z, 1, 0.08);
      for (let i = 0; i < 5; i++) {
        const ox = Math.round(hash2(x + i, z - i) * 4) - 2;
        const oz = Math.round(hash2(x - i, z + i) * 4) - 2;
        for (let oy = -2; oy <= 0; oy++) setLeaf(x + ox, top + oy, z + oz);
      }
      return;
    }

    if (style === "crystal") {
      placeLeafLayer(x, top - 1, z, 1, 0.03);
      placeLeafLayer(x, top, z, 1, 0.03);
      setLeaf(x, top + 1, z);
      setLeaf(x + 1, top, z);
      setLeaf(x - 1, top, z);
      setLeaf(x, top, z + 1);
      setLeaf(x, top, z - 1);
      return;
    }

    const radius = style === "birch" ? 1 : 2;
    for (let oy = -2; oy <= 2; oy++) {
      for (let oz = -radius; oz <= radius; oz++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const d = Math.abs(ox) + Math.abs(oz) + Math.max(0, oy);
          if (d > radius + 1 || hash3(x + ox, top + oy, z + oz) < 0.12) continue;
          setLeaf(x + ox, top + oy, z + oz);
        }
      }
    }
  }
  function placeLeafLayer(x, y, z, radius, skip) {
    for (let oz = -radius; oz <= radius; oz++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (Math.abs(ox) + Math.abs(oz) > radius + 1 || hash3(x + ox, y, z + oz) < skip) continue;
        setLeaf(x + ox, y, z + oz);
      }
    }
  }
  function setLeaf(x, y, z) {
    if (inWorld(x, y, z) && getBlock(x, y, z) === AIR) setBase(x, y, z, LEAVES);
  }
  function carveSpawnMeadow() {
    const cx = WORLD_X >> 1;
    const cz = WORLD_Z >> 1;
    for (let z = cz - 12; z <= cz + 12; z++) {
      for (let x = cx - 12; x <= cx + 12; x++) {
        if (!inWorld(x, 1, z)) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (d > 12.5) continue;
        const h = SEA_LEVEL + 7 + Math.round(Math.sin(x * 0.3) * 0.4 + Math.cos(z * 0.3) * 0.4);
        for (let y = 1; y < WORLD_Y; y++) {
          let code = AIR;
          if (y < h - 3) code = STONE;
          else if (y < h) code = DIRT;
          else if (y === h) code = DIRT;
          setBase(x, y, z, code);
        }
        state.surface[surfaceIndex(x, z)] = h;
      }
    }
    placeTree(cx + 16, state.surface[surfaceIndex(cx + 16, cz + 11)] + 1, cz + 11, 1);
  }
  function setBase(x, y, z, code) {
    if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
  }
  function updateSurfaceColumn(x, z) {
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return;
    let y = WORLD_Y - 1;
    while (y > 0) {
      const code = getBlock(x, y, z);
      if (code !== AIR && code !== WATER && code !== LAVA && code !== TALL_GRASS && code !== FLOWER && code !== TORCH) break;
      y--;
    }
    state.surface[surfaceIndex(x, z)] = y;
  }

  function rebuildAllChunks() {
    disposeGroup(worldGroup);
    disposeGroup(waterGroup);
    disposeGroup(lavaGroup);
    state.chunks.clear();
    chunkCenterKey = "";
    updateVisibleChunks(true);
  }
  function rebuildChunksNear(x, z) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || x % CHUNK === 0 || x % CHUNK === CHUNK - 1 || z % CHUNK === 0 || z % CHUNK === CHUNK - 1) {
          const key = `${cx + dx},${cz + dz}`;
          if (state.chunks.has(key)) rebuildChunk(cx + dx, cz + dz);
        }
      }
    }
  }
  function updateVisibleChunks(force = false) {
    const p = state.player;
    const pcx = clamp(Math.floor((p && Number.isFinite(p.x) ? p.x : WORLD_X / 2) / CHUNK), 0, WORLD_X / CHUNK - 1);
    const pcz = clamp(Math.floor((p && Number.isFinite(p.z) ? p.z : WORLD_Z / 2) / CHUNK), 0, WORLD_Z / CHUNK - 1);
    const key = `${pcx},${pcz}`;
    if (!force && key === chunkCenterKey) return;
    chunkCenterKey = key;
    const wanted = new Set();
    for (let dz = -RENDER_RADIUS_CHUNKS; dz <= RENDER_RADIUS_CHUNKS; dz++) {
      for (let dx = -RENDER_RADIUS_CHUNKS; dx <= RENDER_RADIUS_CHUNKS; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (cx < 0 || cz < 0 || cx >= WORLD_X / CHUNK || cz >= WORLD_Z / CHUNK) continue;
        if (Math.hypot(dx, dz) > RENDER_RADIUS_CHUNKS + 0.45) continue;
        const ckey = `${cx},${cz}`;
        wanted.add(ckey);
        if (!state.chunks.has(ckey)) rebuildChunk(cx, cz);
      }
    }
    for (const [ckey, entry] of state.chunks.entries()) {
      if (!wanted.has(ckey)) disposeChunkEntry(ckey, entry);
    }
    state.visibleChunkCount = state.chunks.size;
    decorDirty = true;
  }
  function disposeChunkEntry(key, entry) {
    if (entry.mesh) { worldGroup.remove(entry.mesh); disposeMesh(entry.mesh); }
    if (entry.water) { waterGroup.remove(entry.water); disposeMesh(entry.water); }
    if (entry.lava) { lavaGroup.remove(entry.lava); disposeMesh(entry.lava); }
    state.chunks.delete(key);
  }
  function rebuildChunk(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= WORLD_X / CHUNK || cz >= WORLD_Z / CHUNK) return;
    const key = `${cx},${cz}`;
    const old = state.chunks.get(key);
    if (old) disposeChunkEntry(key, old);
    const solid = makeGeometryArrays();
    const water = makeGeometryArrays();
    const lava = makeGeometryArrays();
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < WORLD_Y; y++) {
        for (let x = x0; x < x0 + CHUNK; x++) {
          const code = getBlock(x, y, z);
          if (code === AIR || DEF[code].decor) continue;
          const arr = code === WATER ? water : code === LAVA ? lava : solid;
          for (const face of FACES) {
            const nx = x + face.n[0];
            const ny = y + face.n[1];
            const nz = z + face.n[2];
            const neighbor = getBlock(nx, ny, nz);
            const visible = code === WATER ? neighbor !== WATER && neighbor !== BEDROCK : code === LAVA ? neighbor !== LAVA && neighbor !== BEDROCK : !occludes(neighbor);
            if (visible) pushFace(arr, x, y, z, code, face);
          }
        }
      }
    }
    const entry = {};
    if (solid.positions.length) {
      entry.mesh = buildMesh(solid, blockMaterial);
      entry.mesh.castShadow = true;
      entry.mesh.receiveShadow = true;
      worldGroup.add(entry.mesh);
    }
    if (water.positions.length) {
      entry.water = buildMesh(water, waterMaterial);
      waterGroup.add(entry.water);
    }
    if (lava.positions.length) {
      entry.lava = buildMesh(lava, lavaMaterial);
      lavaGroup.add(entry.lava);
    }
    state.chunks.set(key, entry);
  }
  function makeGeometryArrays() {
    return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  }
  function pushFace(arr, x, y, z, code, face) {
    const start = arr.positions.length / 3;
    const tile = textureTileForFace(code, face, x, y, z);
    const col = tile % TEX_COLS;
    const row = Math.floor(tile / TEX_COLS);
    const u0 = (col + 0.015) / TEX_COLS;
    const u1 = (col + 0.985) / TEX_COLS;
    const v0 = 1 - (row + 0.985) / TEX_ROWS;
    const v1 = 1 - (row + 0.015) / TEX_ROWS;
    const localUv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < face.c.length; i++) {
      const c = face.c[i];
      const rgb = faceColor(code, face.shade, x, y, z, face, c);
      arr.positions.push(x + c[0], y + c[1], z + c[2]);
      arr.normals.push(face.n[0], face.n[1], face.n[2]);
      arr.colors.push(rgb[0], rgb[1], rgb[2]);
      arr.uvs.push(lerp(u0, u1, localUv[i][0]), lerp(v0, v1, localUv[i][1]));
    }
    arr.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function textureTileForFace(code, face, x, y, z) {
    const topFace = face.n[1] > 0;
    const bottomFace = face.n[1] < 0;
    if ((code === DIRT || code === GRASS) && topFace) {
      const overlay = dirtTopOverlay(x, y, z);
      if (overlay === "snow") return TEX.snow;
      if (overlay === "grass") return TEX.grassTop;
    }
    if (code === GRASS) return TEX.dirt;
    if (code === DIRT) return TEX.dirt;
    if (code === STONE) return TEX.stone;
    if (code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE) return TEX.ore;
    if (code === BEDROCK) return TEX.bedrock;
    if (code === LOG) return topFace || bottomFace ? TEX.logTop : TEX.logSide;
    if (code === LEAVES) return TEX.leaves;
    if (code === PLANKS) return TEX.planks;
    if (code === TABLE) return TEX.table;
    if (code === SAND) return TEX.sand;
    if (code === SNOW) return TEX.snow;
    if (code === LAVA) return TEX.ore;
    return TEX.stone;
  }
  function faceColor(code, shade, x, y, z, face, corner) {
    const d = DEF[code];
    let base = d.rgb;
    const biome = biomeAt(x, z);
    const topFace = face.n[1] > 0;
    const bottomFace = face.n[1] < 0;
    const grain = hash3(x * 2 + corner[0], y * 2 + corner[1], z * 2 + corner[2]);
    const blockGrain = hash3(x + 17, y - 19, z + 23);

    if (code === GRASS || code === DIRT) {
      const overlay = topFace ? dirtTopOverlay(x, y, z) : null;
      if (overlay === "grass") {
        base = mixRgb(biomeRgb(biome, "grass"), cachedRgb("#20d63a"), 0.18);
      } else if (overlay === "snow") {
        base = mixRgb(cachedRgb("#d9eef8"), cachedRgb("#ffffff"), grain * 0.7);
      } else {
        base = mixRgb(cachedRgb("#684126"), cachedRgb("#9b6638"), grain * 0.75 + blockGrain * 0.25);
      }
    } else if (code === STONE || code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE) {
      const rock = mixRgb(cachedRgb("#6b6f7b"), cachedRgb("#acafbb"), grain * 0.6 + blockGrain * 0.4);
      base = mixRgb(rock, biomeRgb(biome, "grass"), code === STONE ? 0.02 : 0.01);
      if ((code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE) && grain < 0.34) {
        if (!d.oreRgb) d.oreRgb = hexToRgb(d.ore);
        base = mixRgb(base, d.oreRgb, code === COAL_ORE ? 0.62 : 0.78);
      }
    } else if (code === BEDROCK) {
      base = mixRgb(cachedRgb("#17171e"), cachedRgb("#383844"), grain);
    } else if (code === LOG) {
      if (biome.treeStyle === "birch" && !topFace && !bottomFace) {
        base = grain < 0.22 ? cachedRgb("#2c2a28") : mixRgb(cachedRgb("#d7d1bd"), cachedRgb("#f1ead2"), blockGrain);
      } else if (topFace || bottomFace) {
        base = mixRgb(cachedRgb("#c49354"), cachedRgb("#70451f"), Math.abs(corner[0] - 0.5) + Math.abs(corner[2] - 0.5));
      } else {
        const stripe = (Math.floor((y + corner[1]) * 2 + blockGrain * 4) % 2) ? 0.22 : 0;
        base = mixRgb(cachedRgb("#6f4624"), cachedRgb("#a36b38"), grain * 0.45 + stripe);
      }
    } else if (code === PLANKS) {
      const stripe = (Math.floor((x + z + corner[0] + corner[2]) * 2) % 2) ? 0.18 : 0;
      base = mixRgb(cachedRgb("#9f6730"), cachedRgb("#d59a55"), grain * 0.45 + stripe);
    } else if (code === TABLE) {
      base = mixRgb(cachedRgb("#cbd8df"), cachedRgb("#f4fbff"), grain);
    } else if (code === SAND) {
      const dune = biome.surface === "sand" ? cachedRgb("#d9bd6d") : biome.id === 7 ? cachedRgb("#9f9588") : cachedRgb("#d9c579");
      base = mixRgb(dune, cachedRgb("#f2df9a"), grain * 0.45);
    } else if (code === SNOW) {
      base = mixRgb(cachedRgb("#d9eef8"), cachedRgb("#ffffff"), grain * 0.7);
    } else if (code === LAVA) {
      const glow = Math.sin((x * 1.7 + y * 2.3 + z * 1.1 + blockGrain * 8) * 1.4) * 0.5 + 0.5;
      base = mixRgb(cachedRgb("#ff3b0d"), cachedRgb("#ffd34f"), glow * 0.78);
    }
    if (code === LEAVES) {
      base = mixRgb(biomeRgb(biome, "leaf"), mixRgb(biomeRgb(biome, "grass"), cachedRgb("#18d43c"), 0.16), grain * 0.18);
    }
    const jitter = 0.9 + grain * 0.17 + blockGrain * 0.07;
    const f = shade * jitter;
    const greenSurface = (code === DIRT || code === GRASS) && topFace && dirtTopOverlay(x, y, z) === "grass";
    const saturation = code === BEDROCK ? 1.04 : code === STONE ? 1.08 : code === LEAVES ? 1.68 : greenSurface ? 1.62 : 1.36;
    const brightness = code === BEDROCK ? 1.02 : code === STONE ? 1.06 : code === LEAVES ? 1.0 : greenSurface ? 0.98 : 1.08;
    return vividRgb(scaleRgb(base, f), saturation, brightness);
  }
  function buildMesh(arr, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(arr.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(arr.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(arr.colors, 3));
    if (arr.uvs.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(arr.uvs, 2));
    geometry.setIndex(arr.indices);
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  function rebuildDecorations() {
    disposeGroup(decorGroup);
    const arr = makeGeometryArrays();
    const pcx = clamp(Math.floor(state.player.x / CHUNK), 0, WORLD_X / CHUNK - 1);
    const pcz = clamp(Math.floor(state.player.z / CHUNK), 0, WORLD_Z / CHUNK - 1);
    decorCenterKey = `${pcx},${pcz}`;
    for (let cz = pcz - DECOR_RADIUS_CHUNKS; cz <= pcz + DECOR_RADIUS_CHUNKS; cz++) {
      for (let cx = pcx - DECOR_RADIUS_CHUNKS; cx <= pcx + DECOR_RADIUS_CHUNKS; cx++) {
        if (cx < 0 || cz < 0 || cx >= WORLD_X / CHUNK || cz >= WORLD_Z / CHUNK) continue;
        if (Math.hypot(cx - pcx, cz - pcz) > DECOR_RADIUS_CHUNKS + 0.45) continue;
        for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) {
          for (let y = 1; y < WORLD_Y; y++) {
            for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
              const code = getBlock(x, y, z);
              if (code === TALL_GRASS || code === FLOWER) pushPlant(arr, x, y, z, code);
              if (code === TABLE) pushCraftingToilet(arr, x, y, z);
              if (code === TORCH) pushTorch(arr, x, y, z);
            }
          }
        }
      }
    }
    if (arr.positions.length) decorGroup.add(buildMesh(arr, plantMaterial));
    decorDirty = false;
  }
  function pushPlant(arr, x, y, z, code) {
    const biome = biomeAt(x, z);
    const grass = biomeRgb(biome, "grass");
    const seed = hash2(x * 53 + 7, z * 59 - 3);
    if (code === FLOWER) {
      const palette = biome.palette || ["#ff6fa8", "#ffe45c"];
      const bloom = cachedRgb(palette[Math.floor(seed * palette.length) % palette.length]);
      const stem = vividRgb(mixRgb(grass, cachedRgb("#2f6f3a"), 0.38), 1.22, 1.06);
      const cx = x + 0.44 + hash2(x + 2, z - 4) * 0.12;
      const cz = z + 0.44 + hash2(x - 4, z + 2) * 0.12;
      const h = 0.58 + seed * 0.18;
      pushBlade(arr, cx, y, cz, 0.11, h, stem, seed * Math.PI, 0.04);
      pushBlade(arr, cx, y, cz, 0.09, h * 0.86, stem, seed * Math.PI + Math.PI / 2, -0.03);
      pushBlade(arr, cx - 0.08, y + 0.16, cz + 0.02, 0.12, 0.22, stem, seed * 4.3, 0.09);
      pushBlade(arr, cx + 0.09, y + 0.19, cz - 0.03, 0.11, 0.2, stem, seed * 5.1 + 1.4, -0.08);
      const bloomY = y + h - 0.02;
      const petal = vividRgb(bloom, 1.28, 1.12);
      for (let i = 0; i < 4; i++) {
        pushBlade(arr, cx, bloomY, cz, 0.3, 0.22, petal, seed * Math.PI + i * Math.PI / 4, 0.015);
      }
      pushTinyBox(arr, cx - 0.035, bloomY + 0.065, cz - 0.035, 0.07, 0.07, 0.07, cachedRgb("#ffe46b"));
      return;
    }

    const clusters = 5 + Math.floor(seed * 4);
    for (let i = 0; i < clusters; i++) {
      const ox = (hash2(x + i * 11, z - i * 7) - 0.5) * 0.52;
      const oz = (hash2(x - i * 5, z + i * 13) - 0.5) * 0.52;
      const h = 0.34 + hash2(x + i * 17, z + i * 19) * 0.58;
      const w = 0.08 + hash2(x - i * 23, z + i * 3) * 0.11;
      const straw = biome.id === 5 || biome.id === 7 ? 0.22 : 0.06;
      const color = vividRgb(mixRgb(grass, cachedRgb("#f0e89a"), straw + hash2(x + i, z - i) * 0.12), 1.18, 1.06);
      const rot = seed * Math.PI + i * 0.72;
      const lean = (hash2(x + i * 31, z - i * 29) - 0.5) * 0.16;
      pushBlade(arr, x + 0.5 + ox, y, z + 0.5 + oz, w, h, color, rot, lean);
      if (i % 2 === 0) pushBlade(arr, x + 0.5 + ox * 0.7, y, z + 0.5 + oz * 0.7, w * 0.75, h * 0.78, color, rot + Math.PI / 2, -lean * 0.6);
    }
  }
  function pushBlade(arr, cx, y, cz, w, h, rgb, rot, lean) {
    const start = arr.positions.length / 3;
    const sideX = Math.cos(rot) * w / 2;
    const sideZ = Math.sin(rot) * w / 2;
    const leanX = Math.cos(rot + Math.PI / 2) * lean;
    const leanZ = Math.sin(rot + Math.PI / 2) * lean;
    arr.positions.push(
      cx - sideX, y, cz - sideZ,
      cx + sideX, y, cz + sideZ,
      cx + sideX * 0.3 + leanX, y + h, cz + sideZ * 0.3 + leanZ,
      cx - sideX * 0.3 + leanX, y + h, cz - sideZ * 0.3 + leanZ
    );
    const tip = vividRgb(rgb, 1.08, 1.13);
    for (let i = 0; i < 4; i++) {
      arr.normals.push(0, 1, 0);
      const c = i < 2 ? rgb : tip;
      arr.colors.push(c[0], c[1], c[2]);
    }
    arr.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function pushBillboard(arr, cx, y, cz, w, h, rgb, rot) {
    const start = arr.positions.length / 3;
    const dx = Math.cos(rot) * w / 2;
    const dz = Math.sin(rot) * w / 2;
    arr.positions.push(cx - dx, y, cz - dz, cx + dx, y, cz + dz, cx + dx, y + h, cz + dz, cx - dx, y + h, cz - dz);
    for (let i = 0; i < 4; i++) {
      arr.normals.push(0, 1, 0);
      arr.colors.push(rgb[0], rgb[1], rgb[2]);
    }
    arr.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function pushTorch(arr, x, y, z) {
    pushTinyBox(arr, x + 0.42, y, z + 0.42, 0.16, 0.56, 0.16, hexToRgb("#8a572d"));
    pushTinyBox(arr, x + 0.34, y + 0.52, z + 0.34, 0.32, 0.28, 0.32, hexToRgb("#ffd75a"));
  }
  function pushCraftingToilet(arr, x, y, z) {
    const porcelain = cachedRgb("#ecf8ff");
    const shade = cachedRgb("#b8c6d2");
    const water = cachedRgb("#4ecaff");
    pushTinyBox(arr, x + 0.18, y, z + 0.18, 0.64, 0.32, 0.7, porcelain);
    pushTinyBox(arr, x + 0.26, y + 0.26, z + 0.06, 0.48, 0.18, 0.34, shade);
    pushTinyBox(arr, x + 0.32, y + 0.34, z + 0.18, 0.36, 0.05, 0.42, water);
    pushTinyBox(arr, x + 0.18, y + 0.42, z + 0.65, 0.64, 0.58, 0.22, porcelain);
    pushTinyBox(arr, x + 0.24, y + 0.84, z + 0.59, 0.52, 0.16, 0.16, shade);
    pushTinyBox(arr, x + 0.69, y + 0.94, z + 0.66, 0.08, 0.05, 0.08, cachedRgb("#ffd75a"));
  }
  function pushTinyBox(arr, x, y, z, w, h, d, rgb) {
    const corners = [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z], [x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]];
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [1, 5, 6, 2], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0]];
    for (const f of faces) {
      const start = arr.positions.length / 3;
      for (const ci of f) {
        arr.positions.push(corners[ci][0], corners[ci][1], corners[ci][2]);
        arr.normals.push(0, 1, 0);
        arr.colors.push(rgb[0], rgb[1], rgb[2]);
      }
      arr.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }

  function spawnFriendlies() {
    disposeGroup(friendlyGroup);
    state.friendlies = [];
    for (let i = 0; i < FRIENDLY_COUNT; i++) {
      const spot = friendlySpot(i);
      if (!spot) continue;
      const type = i % 3;
      const mesh = createFriendlyMesh(type, i);
      const cfg = FRIENDLY_CONFIG[type] || FRIENDLY_CONFIG[0];
      const friendly = {
        type,
        mesh,
        x: spot.x + 0.5,
        y: spot.y + 1,
        z: spot.z + 0.5,
        homeX: spot.x + 0.5,
        homeZ: spot.z + 0.5,
        targetX: spot.x + 0.5,
        targetZ: spot.z + 0.5,
        speed: 0.58 + hash2(i * 67 + 1, i * 71 - 2) * 0.16 + cfg.speed * 0.6,
        action: "idle",
        actionTimer: 0.4 + hash2(i * 73 - 6, i * 79 + 8) * 2,
        hp: cfg.hp + Math.floor(hash2(i + 11, i + 19) * 2.2),
        maxHp: cfg.hp,
        radius: cfg.radius,
        hitCd: 0,
        hurtTimer: 0,
        knockTimer: 0,
        knockX: 0,
        knockZ: 0,
        buddy: -1,
        walkPhase: hash2(i * 37 + 2, i * 41 - 4) * Math.PI * 2,
        stepTimer: 0.2 + hash2(i * 59 + 6, i * 43 - 7) * 0.5,
        hopTimer: 0,
        fxTimer: 1 + hash2(i * 89 - 3, i * 97 + 5) * 2.5,
        phase: hash2(i * 43 + 9, i * 61 - 5) * Math.PI * 2,
        turn: hash2(i * 47 - 3, i * 53 + 7) * Math.PI * 2,
      };
      mesh.position.set(friendly.x, friendly.y, friendly.z);
      mesh.rotation.y = friendly.turn;
      friendlyGroup.add(mesh);
      state.friendlies.push(friendly);
      chooseFriendlyAction(friendly, i);
    }
  }
  function friendlySpot(i) {
    const cx = WORLD_X / 2;
    const cz = WORLD_Z / 2;
    for (let tries = 0; tries < 80; tries++) {
      let x;
      let z;
      if (i < FRIENDLY_SPAWN_RING) {
        const angle = hash2(i * 17 + tries, i * 23 - tries) * Math.PI * 2;
        const dist = 8 + hash2(i * 29 - tries, i * 31 + tries) * 24;
        x = Math.round(cx + Math.cos(angle) * dist);
        z = Math.round(cz + Math.sin(angle) * dist);
      } else {
        x = 2 + Math.floor(hash2(i * 71 + tries * 11, i * 97 - tries * 13) * (WORLD_X - 4));
        z = 2 + Math.floor(hash2(i * 101 - tries * 7, i * 83 + tries * 17) * (WORLD_Z - 4));
      }
      x = clamp(x, 2, WORLD_X - 3);
      z = clamp(z, 2, WORLD_Z - 3);
      if (edgeOceanStrength(x, z) > 0.45) continue;
      const y = state.surface[surfaceIndex(x, z)];
      if (y <= SEA_LEVEL) continue;
      const top = getBlock(x, y, z);
      if (top === DIRT || top === GRASS || top === SAND || top === SNOW) return { x, y, z };
    }
    return null;
  }
  function createFriendlyMesh(type, seed) {
    const group = new THREE.Group();
    const parts = {};
    if (type === 0) {
      addBox(group, [0, 0.34, 0], [0.72, 0.68, 0.72], friendlyMaterials.lime);
      parts.left = addBox(group, [-0.48, 0.38, -0.02], [0.14, 0.32, 0.16], friendlyMaterials.lime);
      parts.right = addBox(group, [0.48, 0.38, -0.02], [0.14, 0.32, 0.16], friendlyMaterials.lime);
      addBox(group, [-0.18, 0.62, -0.37], [0.11, 0.13, 0.04], friendlyMaterials.black);
      addBox(group, [0.18, 0.62, -0.37], [0.11, 0.13, 0.04], friendlyMaterials.black);
      addBox(group, [0, 0.45, -0.39], [0.28, 0.06, 0.04], friendlyMaterials.blush);
      parts.top = addBox(group, [0, 0.86, 0], [0.46, 0.18, 0.46], friendlyMaterials.mango);
    } else if (type === 1) {
      addBox(group, [0, 0.36, 0], [0.58, 0.72, 0.58], friendlyMaterials.cream);
      parts.left = addBox(group, [-0.43, 0.38, -0.02], [0.12, 0.28, 0.14], friendlyMaterials.cream);
      parts.right = addBox(group, [0.43, 0.38, -0.02], [0.12, 0.28, 0.14], friendlyMaterials.cream);
      parts.top = addBox(group, [0, 0.86, 0], [0.88, 0.28, 0.88], friendlyMaterials.berry);
      addBox(group, [-0.16, 0.6, -0.31], [0.09, 0.11, 0.04], friendlyMaterials.black);
      addBox(group, [0.16, 0.6, -0.31], [0.09, 0.11, 0.04], friendlyMaterials.black);
      addBox(group, [0, 0.43, -0.33], [0.22, 0.05, 0.04], friendlyMaterials.blush);
      for (let i = 0; i < 4; i++) {
        const ox = (hash2(seed + i, seed - i) - 0.5) * 0.44;
        const oz = (hash2(seed - i * 2, seed + i * 3) - 0.5) * 0.44;
        addBox(group, [ox, 1.03, oz], [0.12, 0.08, 0.12], friendlyMaterials.white);
      }
    } else {
      addBox(group, [0, 0.4, 0], [0.62, 0.5, 0.62], friendlyMaterials.sky);
      parts.left = addBox(group, [-0.36, 0.42, 0], [0.18, 0.24, 0.5], friendlyMaterials.mango);
      parts.right = addBox(group, [0.36, 0.42, 0], [0.18, 0.24, 0.5], friendlyMaterials.mango);
      addBox(group, [-0.16, 0.58, -0.33], [0.09, 0.11, 0.04], friendlyMaterials.black);
      addBox(group, [0.16, 0.58, -0.33], [0.09, 0.11, 0.04], friendlyMaterials.black);
      addBox(group, [0, 0.38, -0.35], [0.24, 0.06, 0.04], friendlyMaterials.blush);
      parts.top = addBox(group, [0, 0.78, 0], [0.28, 0.38, 0.28], friendlyMaterials.berry);
    }
    group.userData.parts = parts;
    group.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
    return group;
  }
  function updateFriendlies(dt) {
    const now = performance.now() * 0.001;
    for (let i = 0; i < state.friendlies.length; i++) {
      const friendly = state.friendlies[i];
      if (friendly.hitCd > 0) friendly.hitCd -= dt;
      if (friendly.hurtTimer > 0) friendly.hurtTimer -= dt;
      friendly.actionTimer -= dt;
      friendly.stepTimer = Math.max(0, (friendly.stepTimer || 0) - dt);
      friendly.hopTimer = Math.max(0, (friendly.hopTimer || 0) - dt);
      friendly.fxTimer = Math.max(0, (friendly.fxTimer || 0) - dt);
      const threat = nearestFriendlyThreat(friendly, 9);
      if (threat && friendly.action !== "flee") chooseFriendlyFlee(friendly, threat, i);
      else if (friendly.action === "flee" && !threat && friendly.actionTimer < 0.35) chooseFriendlyAction(friendly, i + 17);
      else if (friendly.actionTimer <= 0) chooseFriendlyAction(friendly, i);
      const moved = updateFriendlyMovement(friendly, dt, i);
      if (friendly.hurtTimer > 0 && friendly.mesh) {
        applyFriendlyFlash(friendly, Math.sin((1 - friendly.hurtTimer / FRIENDLY_HURT_SECONDS) * Math.PI));
      } else if (friendly.mesh && friendly.hurtTimer <= 0) {
        applyFriendlyFlash(friendly, 0);
      }
      if (friendly.hp <= 0) {
        dropFriendlyFood(friendly);
        removeFriendly(friendly, i);
        i--;
        continue;
      }
      maybeEmitFriendlyMood(friendly, i);
      renderFriendly(friendly, now, moved);
    }
  }
  function chooseFriendlyAction(friendly, salt) {
    const roll = hash2(Math.floor(friendly.x * 11) + salt, Math.floor(friendly.z * 13) - salt);
    const dxp = state.player.x - friendly.x;
    const dzp = state.player.z - friendly.z;
    const playerDist = Math.hypot(dxp, dzp);
    const threat = nearestFriendlyThreat(friendly, 9);
    if (threat) {
      chooseFriendlyFlee(friendly, threat, salt);
    } else if (isNight() && roll < 0.26) {
      friendly.action = "sleep";
      friendly.actionTimer = 2.4 + roll * 5.5;
      friendly.buddy = -1;
    } else if (playerDist < 6.8 && roll < 0.35) {
      friendly.buddy = -1;
      if (playerDist > 3.3 && setFriendlyFollowTarget(friendly, salt)) {
        friendly.action = "follow";
        friendly.actionTimer = 1.1 + roll * 2.2;
      } else {
        friendly.action = "look";
        friendly.actionTimer = 0.9 + roll * 1.6;
        friendly.turn = Math.atan2(dxp, dzp) + Math.PI;
      }
    } else if (roll < 0.3 && chooseFriendlyBuddyAction(friendly, salt)) {
      return;
    } else if (friendly.type === 2 && roll < 0.58 && setFriendlyRoamTarget(friendly, salt, 1.4, 4.2, 0.15)) {
      friendly.action = "hop";
      friendly.actionTimer = 1.1 + roll * 2.1;
    } else if (roll < 0.78) {
      friendly.action = "wander";
      friendly.actionTimer = 2.2 + roll * 3.6;
      friendly.buddy = -1;
      setFriendlyRoamTarget(friendly, salt, 2, 8.5, 0.32);
    } else if (roll < 0.9) {
      friendly.action = friendly.type === 2 ? "peck" : "graze";
      friendly.actionTimer = 1.4 + roll * 2;
      friendly.buddy = -1;
    } else if (roll < 0.98) {
      friendly.action = "dance";
      friendly.actionTimer = 1.1 + roll * 1.8;
      friendly.buddy = -1;
    } else {
      friendly.action = "idle";
      friendly.actionTimer = 1.2 + roll * 2.4;
      friendly.buddy = -1;
    }
  }
  function updateFriendlyMovement(friendly, dt, salt) {
    if (friendly.knockTimer > 0) {
      friendly.knockTimer -= dt;
      friendly.x += (friendly.knockX || 0) * dt;
      friendly.z += (friendly.knockZ || 0) * dt;
      friendly.knockX *= 0.84;
      friendly.knockZ *= 0.84;
      friendly.walkPhase += dt * 9;
      return true;
    }
    if (!friendlyMovingAction(friendly.action)) return false;
    if (friendly.action === "follow") setFriendlyFollowTarget(friendly, salt);
    if (friendly.action === "herd") refreshFriendlyHerdTarget(friendly);
    const dx = friendly.targetX - friendly.x;
    const dz = friendly.targetZ - friendly.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (friendly.action === "flee" ? 0.55 : 0.22)) {
      chooseFriendlyAction(friendly, salt + 31);
      return false;
    }
    const sep = friendlySeparation(friendly, 1.25);
    let dirX = dx / dist + sep.x * 0.85;
    let dirZ = dz / dist + sep.z * 0.85;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;
    const speed = friendlySpeedForAction(friendly);
    const step = Math.min(dist, speed * dt);
    const nx = friendly.x + dirX * step;
    const nz = friendly.z + dirZ * step;
    const ground = friendlyGroundAt(nx, nz);
    if (ground === null) {
      if (friendly.action === "flee") {
        const threat = nearestFriendlyThreat(friendly, 12);
        if (threat) chooseFriendlyFlee(friendly, threat, salt + 61);
      } else chooseFriendlyAction(friendly, salt + 61);
      return false;
    }
    const nextY = ground + 1;
    if (Math.abs(nextY - friendly.y) > 1.25) {
      chooseFriendlyAction(friendly, salt + 73);
      return false;
    }
    friendly.x = nx;
    friendly.z = nz;
    if (Math.abs(nextY - friendly.y) > 0.28 || friendly.action === "hop") friendly.hopTimer = Math.max(friendly.hopTimer || 0, 0.32);
    friendly.y = nextY;
    friendly.turn = Math.atan2(dirX, dirZ) + Math.PI;
    friendly.walkPhase = (friendly.walkPhase || 0) + step * (friendly.action === "flee" ? 13 : friendly.action === "hop" ? 10 : 7);
    if (friendly.stepTimer <= 0) {
      friendly.stepTimer = 0.24 + hash2(Math.floor(friendly.x * 19) + salt, Math.floor(friendly.z * 23) - salt) * 0.34;
      if (friendly.action === "flee" || friendly.action === "hop" || friendly.type === 2) friendly.hopTimer = Math.max(friendly.hopTimer || 0, 0.28);
    }
    return true;
  }
  function friendlyMovingAction(action) {
    return action === "wander" || action === "flee" || action === "follow" || action === "herd" || action === "hop";
  }
  function friendlySpeedForAction(friendly) {
    if (friendly.action === "flee") return friendly.speed * 2.45;
    if (friendly.action === "follow") return friendly.speed * 1.22;
    if (friendly.action === "herd") return friendly.speed * 0.92;
    if (friendly.action === "hop") return friendly.speed * 1.1;
    return friendly.speed;
  }
  function friendlyGroundAt(x, z) {
    const ix = clamp(Math.floor(x), 1, WORLD_X - 2);
    const iz = clamp(Math.floor(z), 1, WORLD_Z - 2);
    if (edgeOceanStrength(ix, iz) > 0.48) return null;
    const y = state.surface[surfaceIndex(ix, iz)];
    if (y <= SEA_LEVEL) return null;
    const top = getBlock(ix, y, iz);
    if (top !== DIRT && top !== GRASS && top !== SAND && top !== SNOW) return null;
    if (getBlock(ix, y + 1, iz) === WATER || getBlock(ix, y + 1, iz) === LAVA) return null;
    return y;
  }
  function friendlyCanStandAt(x, z) {
    return friendlyGroundAt(x, z) !== null;
  }
  function setFriendlyRoamTarget(friendly, salt, minDist, maxDist, homePull = 0.25) {
    const homeDist = Math.hypot(friendly.homeX - friendly.x, friendly.homeZ - friendly.z);
    const anchorX = homeDist > 16 ? friendly.homeX : lerp(friendly.x, friendly.homeX, homePull);
    const anchorZ = homeDist > 16 ? friendly.homeZ : lerp(friendly.z, friendly.homeZ, homePull);
    for (let tries = 0; tries < 10; tries++) {
      const angle = hash2(salt * 17 + tries * 13 + 3, salt * 19 - tries * 7 - 5) * Math.PI * 2;
      const dist = minDist + hash2(salt * 23 - tries * 11 - 7, salt * 29 + tries * 5 + 11) * (maxDist - minDist);
      const tx = clamp(anchorX + Math.cos(angle) * dist, 2.5, WORLD_X - 2.5);
      const tz = clamp(anchorZ + Math.sin(angle) * dist, 2.5, WORLD_Z - 2.5);
      if (friendlyCanStandAt(tx, tz)) {
        friendly.targetX = tx;
        friendly.targetZ = tz;
        return true;
      }
    }
    if (friendlyCanStandAt(friendly.homeX, friendly.homeZ)) {
      friendly.targetX = friendly.homeX;
      friendly.targetZ = friendly.homeZ;
      return true;
    }
    return false;
  }
  function setFriendlyFollowTarget(friendly, salt) {
    const dx = friendly.x - state.player.x;
    const dz = friendly.z - state.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    const keepAway = 2.5 + friendly.type * 0.28;
    const orbit = (hash2(salt * 31 + friendly.type, salt * 37 - friendly.type) - 0.5) * 1.35;
    const tx = state.player.x + dx / dist * keepAway + Math.cos(orbit) * 0.55;
    const tz = state.player.z + dz / dist * keepAway + Math.sin(orbit) * 0.55;
    if (!friendlyCanStandAt(tx, tz)) return setFriendlyRoamTarget(friendly, salt + 101, 1.6, 4.5, 0.1);
    friendly.targetX = clamp(tx, 2.5, WORLD_X - 2.5);
    friendly.targetZ = clamp(tz, 2.5, WORLD_Z - 2.5);
    return true;
  }
  function chooseFriendlyBuddyAction(friendly, salt) {
    const buddyIndex = findFriendlyBuddy(friendly, 5.6, salt);
    if (buddyIndex < 0) return false;
    const buddy = state.friendlies[buddyIndex];
    friendly.buddy = buddyIndex;
    const dist = Math.hypot(buddy.x - friendly.x, buddy.z - friendly.z);
    if (dist > 2.1) {
      friendly.action = "herd";
      friendly.actionTimer = 1.2 + hash2(salt * 13, salt * 17) * 2.2;
      refreshFriendlyHerdTarget(friendly);
    } else {
      friendly.action = "social";
      friendly.actionTimer = 1.1 + hash2(salt * 19, salt * 23) * 2.4;
    }
    return true;
  }
  function refreshFriendlyHerdTarget(friendly) {
    const buddy = state.friendlies[friendly.buddy];
    if (!buddy) return;
    const dx = friendly.x - buddy.x;
    const dz = friendly.z - buddy.z;
    const dist = Math.hypot(dx, dz) || 1;
    friendly.targetX = clamp(buddy.x + dx / dist * 1.45, 2.5, WORLD_X - 2.5);
    friendly.targetZ = clamp(buddy.z + dz / dist * 1.45, 2.5, WORLD_Z - 2.5);
  }
  function findFriendlyBuddy(friendly, radius, salt) {
    let best = -1;
    let bestD = radius * radius;
    const start = Math.floor(hash2(salt * 7 + 1, salt * 11 - 3) * state.friendlies.length);
    for (let n = 0; n < state.friendlies.length; n++) {
      const i = (start + n) % state.friendlies.length;
      const other = state.friendlies[i];
      if (!other || other === friendly || other.action === "sleep" || other.action === "flee") continue;
      const dx = other.x - friendly.x;
      const dz = other.z - friendly.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function nearestFriendlyThreat(friendly, radius) {
    let best = null;
    let bestD = radius * radius;
    for (const mob of state.mobs) {
      const dx = mob.x - friendly.x;
      const dz = mob.z - friendly.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = mob;
      }
    }
    return best;
  }
  function chooseFriendlyFlee(friendly, threat, salt) {
    friendly.action = "flee";
    friendly.actionTimer = 0.9 + hash2(salt * 41 + 5, salt * 43 - 9) * 1.3;
    friendly.buddy = -1;
    const away = Math.atan2(friendly.z - threat.z, friendly.x - threat.x);
    for (let tries = 0; tries < 8; tries++) {
      const bend = (tries % 2 ? 1 : -1) * tries * 0.34;
      const dist = 5.5 + hash2(salt * 47 + tries, salt * 53 - tries) * 6;
      const tx = clamp(friendly.x + Math.cos(away + bend) * dist, 2.5, WORLD_X - 2.5);
      const tz = clamp(friendly.z + Math.sin(away + bend) * dist, 2.5, WORLD_Z - 2.5);
      if (friendlyCanStandAt(tx, tz)) {
        friendly.targetX = tx;
        friendly.targetZ = tz;
        return;
      }
    }
    setFriendlyRoamTarget(friendly, salt + 211, 3, 7, 0.6);
  }
  function friendlySeparation(friendly, radius) {
    const out = { x: 0, z: 0 };
    const r2 = radius * radius;
    for (const other of state.friendlies) {
      if (!other || other === friendly) continue;
      const dx = friendly.x - other.x;
      const dz = friendly.z - other.z;
      const d = dx * dx + dz * dz;
      if (d > 0.0001 && d < r2) {
        const pull = (radius - Math.sqrt(d)) / radius;
        out.x += dx * pull / d;
        out.z += dz * pull / d;
      }
    }
    return out;
  }
  function maybeEmitFriendlyMood(friendly, salt) {
    if (!state.started || friendly.fxTimer > 0 || state.fx.length > 90) return;
    let rgb = null;
    let count = 2;
    if (friendly.action === "dance") {
      rgb = cachedRgb("#ffbd3f");
      count = 3;
    } else if (friendly.action === "social" || friendly.action === "look") {
      rgb = cachedRgb("#ff7aa8");
    } else if (friendly.action === "graze" || friendly.action === "peck") {
      rgb = cachedRgb("#7dff66");
    }
    if (!rgb) return;
    spawnBurst(friendly.x, friendly.y + 0.78, friendly.z, rgb, count, 0.42);
    friendly.fxTimer = 2.2 + hash2(Math.floor(friendly.x * 13) + salt, Math.floor(friendly.z * 17) - salt) * 3.2;
  }
  function renderFriendly(friendly, now) {
    const phase = now * (1.8 + (friendly.type + 1) * 0.16) + friendly.phase;
    const moving = friendlyMovingAction(friendly.action);
    const graze = friendly.action === "graze" || friendly.action === "peck";
    const sleeping = friendly.action === "sleep";
    const stridePhase = moving ? (friendly.walkPhase || phase) : phase;
    const busy = friendly.action === "dance" ? 1.1 : friendly.action === "flee" ? 1.25 : moving ? 0.65 : graze ? 0.46 : 0.18;
    const bounce = sleeping ? 0 : Math.abs(Math.sin(stridePhase * (moving ? 1.25 : 1))) * (0.035 + busy * 0.095);
    const hop = friendly.hopTimer > 0 ? Math.sin((1 - friendly.hopTimer / 0.32) * Math.PI) * 0.2 : 0;
    const sway = sleeping ? 0 : Math.sin(phase * 0.58) * (0.055 + busy * 0.075);
    const face = friendlyFaceAngle(friendly);
    const wiggle = sleeping ? 0 : 0.035;
    friendly.mesh.position.set(
      friendly.x + Math.sin(phase * 0.37) * wiggle,
      friendly.y + bounce + hop,
      friendly.z + Math.cos(phase * 0.41) * wiggle
    );
    friendly.mesh.rotation.y = face + sway;
    friendly.mesh.rotation.x = sleeping ? 0.5 : graze ? 0.3 + Math.sin(phase * (friendly.action === "peck" ? 3.4 : 1.4)) * 0.08 : friendly.action === "flee" ? -0.08 : 0;
    friendly.mesh.rotation.z = sleeping ? 0.22 : Math.sin(phase) * (friendly.action === "dance" ? 0.18 : friendly.action === "flee" ? 0.1 : 0.055);
    const base = 1.28;
    if (sleeping) friendly.mesh.scale.set(base * 1.08, base * 0.62, base * 1.02);
    else friendly.mesh.scale.set(base + bounce * 0.18, base - bounce * 0.1, base + bounce * 0.18);
    animateFriendlyParts(friendly, phase);
  }
  function friendlyFaceAngle(friendly) {
    if ((friendly.action === "idle" || friendly.action === "look" || friendly.action === "follow") && Math.hypot(state.player.x - friendly.x, state.player.z - friendly.z) < 9) {
      return Math.atan2(state.player.x - friendly.x, state.player.z - friendly.z) + Math.PI;
    }
    if (friendly.action === "social") {
      const buddy = state.friendlies[friendly.buddy];
      if (buddy) return Math.atan2(buddy.x - friendly.x, buddy.z - friendly.z) + Math.PI;
    }
    return friendly.turn;
  }
  function animateFriendlyParts(friendly, phase) {
    const parts = friendly.mesh.userData.parts || {};
    const wave = Math.sin(phase * (friendly.action === "dance" ? 2.4 : friendly.action === "flee" ? 2.8 : 1.2));
    const graze = friendly.action === "graze" || friendly.action === "peck";
    if (parts.left) {
      parts.left.rotation.z = friendly.action === "sleep" ? 0.12 : graze ? 0.25 : wave * (friendly.action === "social" ? 0.22 : 0.45);
      parts.left.rotation.x = friendlyMovingAction(friendly.action) ? Math.sin(phase * 2.2) * 0.32 : friendly.action === "look" ? -0.14 : 0;
    }
    if (parts.right) {
      parts.right.rotation.z = friendly.action === "sleep" ? -0.12 : graze ? -0.25 : -wave * (friendly.action === "social" ? 0.22 : 0.45);
      parts.right.rotation.x = friendlyMovingAction(friendly.action) ? -Math.sin(phase * 2.2) * 0.32 : friendly.action === "look" ? -0.14 : 0;
    }
    if (parts.top) {
      parts.top.rotation.x = graze ? Math.sin(phase * 1.6) * 0.12 : friendly.action === "sleep" ? -0.18 : 0;
      parts.top.rotation.z = friendly.action === "dance" ? Math.sin(phase * 2.1) * 0.16 : friendly.action === "flee" ? Math.sin(phase * 3.1) * 0.08 : 0;
    }
  }

  function spawnBlockBurst(x, y, z, code) {
    const d = DEF[code] || DEF[DIRT];
    const rgb = vividRgb(d.rgb || cachedRgb("#ffffff"), 1.28, 1.16);
    spawnBurst(x + 0.5, y + 0.5, z + 0.5, rgb, 14, 2.8);
  }
  function spawnHitBurst(x, y, z, rgb) {
    spawnBurst(x, y, z, rgb, 10, 3.5);
  }
  function spawnBurst(x, y, z, rgb, count, power) {
    for (let i = 0; i < count; i++) {
      const size = 0.08 + hash3(x + i, y - i, z + i) * 0.08;
      const mesh = new THREE.Mesh(
        new THREE.BoxBufferGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), transparent: true, opacity: 0.88 })
      );
      const a = hash3(x * 17 + i, y * 19 - i, z * 23 + i) * Math.PI * 2;
      const lift = 1.5 + hash3(x - i, y + i, z * 3) * 2.5;
      const speed = 0.8 + hash3(x * 5 - i, y * 7 + i, z * 11) * power;
      mesh.position.set(x, y, z);
      mesh.rotation.set(hash3(x + i, y, z) * Math.PI, hash3(x, y + i, z) * Math.PI, hash3(x, y, z + i) * Math.PI);
      effectGroup.add(mesh);
      state.fx.push({
        mesh,
        vx: Math.cos(a) * speed,
        vy: lift,
        vz: Math.sin(a) * speed,
        spin: 2 + hash3(x - i, y + i, z - i) * 5,
        life: 0.55 + hash3(x + i * 3, y - i * 5, z + i * 7) * 0.35,
        maxLife: 0,
      });
      state.fx[state.fx.length - 1].maxLife = state.fx[state.fx.length - 1].life;
    }
  }
  function updateFx(dt) {
    for (let i = state.fx.length - 1; i >= 0; i--) {
      const fx = state.fx[i];
      fx.life -= dt;
      if (fx.life <= 0) {
        effectGroup.remove(fx.mesh);
        if (fx.mesh.geometry) fx.mesh.geometry.dispose();
        if (fx.mesh.material) fx.mesh.material.dispose();
        state.fx.splice(i, 1);
        continue;
      }
      fx.vy -= FX_GRAVITY * dt;
      fx.mesh.position.x += fx.vx * dt;
      fx.mesh.position.y += fx.vy * dt;
      fx.mesh.position.z += fx.vz * dt;
      fx.mesh.rotation.x += fx.spin * dt;
      fx.mesh.rotation.y += fx.spin * 0.7 * dt;
      fx.mesh.material.opacity = clamp(fx.life / fx.maxLife, 0, 1) * 0.88;
    }
  }

  function buildClouds() {
    if (cloudsBuilt) return;
    cloudsBuilt = true;
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
    const box = new THREE.BoxBufferGeometry(1, 1, 1);
    for (let i = 0; i < 64; i++) {
      const group = new THREE.Group();
      const count = 6 + Math.floor(hash2(i, 3) * 8);
      for (let j = 0; j < count; j++) {
        const puff = new THREE.Mesh(box, material);
        puff.scale.set(6 + hash2(i, j) * 10, 0.7 + hash2(j, i) * 1.0, 3.2 + hash2(i + 7, j) * 6.2);
        puff.position.set(j * 5.4, hash2(i, j + 9) * 0.9, hash2(j + 10, i) * 7.4);
        group.add(puff);
      }
      group.position.set(hash2(i, 1) * WORLD_X, WORLD_Y + 24 + hash2(i, 2) * 32, hash2(i, 4) * WORLD_Z);
      cloudGroup.add(group);
    }
  }
  function buildStars() {
    if (scene.getObjectByName("stars")) return;
    const positions = [];
    for (let i = 0; i < 420; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const r = 95 + hash2(i, 2) * 80;
      const y = WORLD_Y + 64 + hash2(i, 3) * 140;
      positions.push(Math.cos(a) * r + WORLD_X / 2, y, Math.sin(a) * r + WORLD_Z / 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0, fog: false });
    const stars = new THREE.Points(geometry, material);
    stars.name = "stars";
    scene.add(stars);
  }
  function buildCelestials() {
    if (sunDisk && moonDisk) return;
    const sunGeo = new THREE.CircleBufferGeometry(7.8, 48);
    const moonGeo = new THREE.CircleBufferGeometry(6.8, 40);
    sunDisk = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({
      color: 0xffdc67,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    }));
    moonDisk = new THREE.Mesh(moonGeo, new THREE.MeshBasicMaterial({
      color: 0xf2f7ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    }));
    sunDisk.name = "sun-disk";
    moonDisk.name = "moon-disk";
    scene.add(sunDisk, moonDisk);
  }

  function disposeGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      disposeMesh(child);
    }
  }
  function disposeMesh(obj) {
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material && child.material.userData && child.material.userData.disposeWithMesh) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }

  function spawnPlayer() {
    const x = WORLD_X / 2 + 0.5;
    const z = WORLD_Z / 2 + 0.5;
    const y = state.surface[surfaceIndex(Math.floor(x), Math.floor(z))] + 1.05;
    Object.assign(state.player, { x, y, z, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 4, pitch: -0.12, onGround: false, hp: MAX_HP, hurtCd: SPAWN_GRACE, inWater: false, inLava: false, hurtAnim: 0 });
    state.oceanFatigue = 0;
    updateVisibleChunks(true);
    decorDirty = true;
    syncCamera();
  }
  function syncCamera() {
    const p = state.player;
    camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
    camera.rotation.z = 0;
  }

  function initHotbar() {
    state.hotbar = Array.from({ length: HOTBAR }, () => null);
    state.bag = Array.from({ length: BAG_SLOTS }, () => null);
    state.bagOpen = false;
  }
  function giveItem(code, n = 1) {
    if (!code || n <= 0) return;
    const cap = maxStack(code);
    n = addToExistingSlots(state.hotbar, code, n, cap);
    n = addToExistingSlots(state.bag, code, n, cap);
    n = addToEmptySlots(state.hotbar, code, n, cap);
    n = addToEmptySlots(state.bag, code, n, cap);
    if (n > 0) api.toast("Bag full", "bad");
  }
  function addToExistingSlots(slots, code, n, cap) {
    for (const slot of slots) {
      if (slot && slot.code === code && slot.n < cap) {
        const add = Math.min(n, cap - slot.n);
        slot.n += add;
        n -= add;
        if (n <= 0) return 0;
      }
    }
    return n;
  }
  function addToEmptySlots(slots, code, n, cap) {
    for (let i = 0; i < slots.length && n > 0; i++) {
      if (!slots[i]) {
        const add = Math.min(n, cap);
        slots[i] = { code, n: add };
        n -= add;
      }
    }
    return n;
  }
  function countItem(code) {
    return inventorySlots().reduce((sum, slot) => sum + (slot && slot.code === code ? slot.n : 0), 0);
  }
  function takeItem(code, n) {
    n = takeFromSlots(state.hotbar, code, n);
    takeFromSlots(state.bag, code, n);
  }
  function takeFromSlots(slots, code, n) {
    for (let i = 0; i < slots.length && n > 0; i++) {
      const slot = slots[i];
      if (!slot || slot.code !== code) continue;
      const take = Math.min(n, slot.n);
      slot.n -= take;
      n -= take;
      if (slot.n <= 0) slots[i] = null;
    }
    return n;
  }
  function inventorySlots() { return state.hotbar.concat(state.bag); }
  function selectedSlot() { return state.hotbar[state.selected]; }
  function hasToolType(type) {
    return inventorySlots().some((slot) => slot && DEF[slot.code] && DEF[slot.code].tool && DEF[slot.code].tool.type === type);
  }
  function ensureStarterPick(selectPick = false) {
    if (hasToolType("pick")) return false;
    const pickSlot = { code: PICK_WOOD, n: 1 };
    let pickIndex = state.hotbar.findIndex((slot) => !slot);
    if (pickIndex >= 0) {
      state.hotbar[pickIndex] = pickSlot;
    } else {
      const selectedIndex = state.selected >= 0 && state.selected < HOTBAR ? state.selected : 0;
      const bagIndex = state.bag.findIndex((slot) => !slot);
      if (bagIndex >= 0) state.bag[bagIndex] = state.hotbar[selectedIndex];
      state.hotbar[selectedIndex] = pickSlot;
      pickIndex = selectedIndex;
    }
    if (selectPick) state.selected = pickIndex;
    heldRenderCode = null;
    bagRenderKey = null;
    return true;
  }
  function selectedDef() {
    const slot = selectedSlot();
    return slot && DEF[slot.code] ? DEF[slot.code] : null;
  }
  function selectedIsBlock() {
    const d = selectedDef();
    return !!(d && d.kind === "block");
  }
  function selectedTool() {
    const slot = selectedSlot();
    return slot && DEF[slot.code] && DEF[slot.code].tool ? DEF[slot.code].tool : null;
  }
  function decrementSelectedSlot() {
    const slot = selectedSlot();
    if (!slot) return;
    slot.n--;
    if (slot.n <= 0) state.hotbar[state.selected] = null;
  }
  function swapBagSlotWithHotbar(bagIndex, hotbarIndex = state.selected) {
    if (bagIndex < 0 || bagIndex >= state.bag.length || hotbarIndex < 0 || hotbarIndex >= state.hotbar.length) return;
    const tmp = state.hotbar[hotbarIndex];
    state.hotbar[hotbarIndex] = state.bag[bagIndex];
    state.bag[bagIndex] = tmp;
    state.selected = hotbarIndex;
    heldRenderCode = null;
    showSelectionCue();
  }
  function toggleBag(force) {
    if (!state.started) return;
    state.bagOpen = typeof force === "boolean" ? force : !state.bagOpen;
    if (state.bagOpen) {
      state.crafting = false;
      if (craftPanel) craftPanel.classList.remove("is-open");
      unlockPointer();
    }
    renderBag();
  }
  function triggerHeldSwing(kind = "gather") {
    state.swingKind = kind;
    state.swingTimer = kind === "attack" ? HELD_SWING_SECONDS : HELD_GATHER_SECONDS;
  }
  function updateActionAnimations(dt) {
    if (state.swingTimer > 0) state.swingTimer = Math.max(0, state.swingTimer - dt);
    if (state.player.hurtAnim > 0) state.player.hurtAnim = Math.max(0, state.player.hurtAnim - dt);
    if (state.attackFlash > 0) state.attackFlash = Math.max(0, state.attackFlash - dt);
    if (state.input.mine && state.target && state.target.hit && !state.paused && !state.crafting) {
      state.gatherPhase += dt * 10.5;
    } else {
      state.gatherPhase += dt * 2.5;
    }
    updateDamageOverlay();
  }
  function updateDamageOverlay() {
    if (!ui.damage) return;
    const t = clamp(state.attackFlash / PLAYER_HURT_SECONDS, 0, 1);
    ui.damage.style.opacity = `${t * 0.62}`;
    ui.damage.style.transform = `scale(${1 + t * 0.035})`;
  }

  function updatePlayer(dt) {
    const p = state.player;
    const forward = state.input.forward;
    const right = state.input.right;
    const inWater = playerInWater();
    const inLava = playerInLava();
    p.inWater = inWater;
    p.inLava = inLava;
    const liquidMoveMult = inLava ? LAVA_MOVE_MULT : inWater ? WATER_MOVE_MULT : 1;
    const liquidGravityMult = inLava ? LAVA_GRAVITY_MULT : inWater ? WATER_GRAVITY_MULT : 1;
    const speed = (state.input.sprint ? SPRINT_SPEED : MOVE_SPEED) * liquidMoveMult;
    syncCamera();
    const move = movementVectorForCamera(forward, right);
    let mx = move.x;
    let mz = move.z;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    p.vx = mx * speed;
    p.vz = mz * speed;
    if ((inWater || inLava) && state.input.jump) {
      p.vy = Math.max(p.vy, inLava ? LAVA_SWIM_UP_SPEED : SWIM_UP_SPEED);
      p.onGround = false;
    } else if (state.input.jump && p.onGround) {
      p.vy = JUMP_SPEED;
      p.onGround = false;
    }
    p.vy -= GRAVITY * liquidGravityMult * dt;
    if (inWater || inLava) {
      p.vy = Math.max(p.vy, inLava ? LAVA_FALL_SPEED : -2.2);
      if (!state.input.jump && p.vy < 0) p.vy *= 0.92;
    } else {
      p.vy = Math.max(p.vy, -32);
    }
    movePlayerAxis("x", p.vx * dt);
    movePlayerAxis("z", p.vz * dt);
    movePlayerAxis("y", p.vy * dt);
    p.x = clamp(p.x, 1.5, WORLD_X - 1.5);
    p.z = clamp(p.z, 1.5, WORLD_Z - 1.5);
    if (playerInLava()) hurtPlayer(18);
    if (p.y < 1) hurtPlayer(4);
    if (p.hurtCd > 0) p.hurtCd -= dt;
    updateOceanFatigue(dt);
    syncCamera();
  }
  function playerInWater() {
    const p = state.player;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return getBlock(x, Math.floor(p.y + 0.15), z) === WATER || getBlock(x, Math.floor(p.y + EYE_HEIGHT * 0.72), z) === WATER;
  }
  function playerInLava() {
    const p = state.player;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return getBlock(x, Math.floor(p.y + 0.15), z) === LAVA || getBlock(x, Math.floor(p.y + EYE_HEIGHT * 0.72), z) === LAVA;
  }
  function updateOceanFatigue(dt) {
    const p = state.player;
    const inBorderOcean = p.inWater && edgeOceanStrength(p.x, p.z) > 0.55;
    if (inBorderOcean) {
      state.oceanFatigue += dt;
      if (state.oceanFatigue > OCEAN_FATIGUE_LIMIT) {
        api.toast("You got exhausted in the border ocean. Respawning...", "bad");
        p.hp = MAX_HP;
        state.oceanFatigue = 0;
        spawnPlayer();
      }
    } else {
      state.oceanFatigue = Math.max(0, state.oceanFatigue - dt * 1.6);
    }
  }
  function movementVectorForYaw(yaw, forward, right) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return {
      x: forward * -sin + right * cos,
      z: forward * -cos + right * -sin,
    };
  }
  function movementVectorForCamera(forward, right) {
    camera.getWorldDirection(moveForwardVector);
    moveForwardVector.y = 0;
    if (moveForwardVector.lengthSq() < 0.00001) return movementVectorForYaw(state.player.yaw, forward, right);
    moveForwardVector.normalize();
    moveRightVector.crossVectors(moveForwardVector, worldUpVector).normalize();
    return {
      x: forward * moveForwardVector.x + right * moveRightVector.x,
      z: forward * moveForwardVector.z + right * moveRightVector.z,
    };
  }
  function movePlayerAxis(axis, amount) {
    if (amount === 0) return;
    const p = state.player;
    const start = p[axis];
    p[axis] += amount;
    const box = playerBox();
    if (boxCollides(box)) {
      const collidedPos = p[axis];
      p[axis] = start;
      if (axis === "y") {
        if (amount < 0) {
          p.onGround = true;
          p.y = Math.floor(collidedPos - 0.0001) + 1;
        }
        p.vy = 0;
        return;
      }
      const dir = Math.sign(amount);
      let guard = 0;
      while (boxCollides(playerBox()) && guard < 20) {
        p[axis] -= dir * 0.02;
        guard++;
      }
    } else if (axis === "y" && amount !== 0) {
      p.onGround = false;
    }
  }
  function playerBox() {
    const p = state.player;
    return {
      minX: p.x - PLAYER_RADIUS,
      maxX: p.x + PLAYER_RADIUS,
      minY: p.y,
      maxY: p.y + PLAYER_HEIGHT,
      minZ: p.z - PLAYER_RADIUS,
      maxZ: p.z + PLAYER_RADIUS,
    };
  }
  function boxCollides(b) {
    const x0 = Math.floor(b.minX), x1 = Math.floor(b.maxX);
    const y0 = Math.floor(b.minY), y1 = Math.floor(b.maxY);
    const z0 = Math.floor(b.minZ), z1 = Math.floor(b.maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (isSolidBlock(getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }
  function rescuePlayerFromSolid() {
    const p = state.player;
    p.x = clamp(p.x, 1.5, WORLD_X - 1.5);
    p.z = clamp(p.z, 1.5, WORLD_Z - 1.5);
    p.y = clamp(p.y, 2, WORLD_Y - PLAYER_HEIGHT - 2);
    if (!boxCollides(playerBox())) return false;
    const x = clamp(Math.floor(p.x), 0, WORLD_X - 1);
    const z = clamp(Math.floor(p.z), 0, WORLD_Z - 1);
    p.y = clamp(state.surface[surfaceIndex(x, z)] + 1.05, 2, WORLD_Y - PLAYER_HEIGHT - 2);
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = false;
    return true;
  }
  function hurtPlayer(dmg) {
    const p = state.player;
    if (p.hurtCd > 0) return;
    p.hp -= dmg;
    p.hurtCd = DAMAGE_GRACE;
    p.hurtAnim = PLAYER_HURT_SECONDS;
    state.attackFlash = PLAYER_HURT_SECONDS;
    p.vy = Math.max(p.vy, 4);
    if (p.hp <= 0) {
      api.toast("You got flushed. Respawning...", "bad");
      state.mobs.forEach((m) => removeMob(m));
      state.mobs = [];
      p.hp = MAX_HP;
      state.time = 0.18;
      spawnPlayer();
    }
  }

  const MOB = {
    toilet: { hp: 9, speed: 2.15, roamSpeed: 0.48, damage: 8, score: 15, radius: 0.55, sight: 16, memory: 1.45, attackRange: 1.25 },
    grimace: { hp: 17, speed: 1.45, roamSpeed: 0.36, damage: 14, score: 30, radius: 0.7, sight: 14, memory: 1.75, attackRange: 1.3 },
    skibidi: { hp: 12, speed: 1.95, roamSpeed: 0.5, damage: 10, score: 24, radius: 0.62, sight: 17, memory: 1.55, attackRange: 1.25 },
    rizzler: { hp: 7, speed: 2.65, roamSpeed: 0.72, damage: 6, score: 18, radius: 0.48, sight: 18, memory: 1.25, attackRange: 1.15 },
    doomscroll: { hp: 14, speed: 1.7, roamSpeed: 0.42, damage: 12, score: 28, radius: 0.62, sight: 19, memory: 1.9, attackRange: 1.28 },
    shadow: { hp: 20, speed: 1.85, roamSpeed: 0.4, damage: 16, score: 38, radius: 0.66, sight: 22, memory: 2.2, attackRange: 1.35 },
  };
  const FRIENDLY_CONFIG = [
    { name: "Lilac", hp: 8, speed: 0.58, radius: 0.52, drops: 1 },
    { name: "Bunny", hp: 11, speed: 0.68, radius: 0.56, drops: 1 },
    { name: "Mog", hp: 16, speed: 0.74, radius: 0.6, drops: 2 },
  ];
  const FRIENDLY_DROP_MIN = 1;
  const FRIENDLY_DROP_VARIATION = 2;
  function getFriendlyConfig(type) {
    return FRIENDLY_CONFIG[type] || FRIENDLY_CONFIG[0];
  }
  function friendlyName(type) {
    return getFriendlyConfig(type).name || "friendly";
  }
  function spawnMob() {
    if (state.mobs.length >= Math.min(8 + state.day * 3, 28)) return;
    const p = state.player;
    const serial = ++mobSpawnSerial;
    const tick = Math.floor(performance.now() * 0.017) + state.day * 997 + serial * 7919;
    for (let tries = 0; tries < 56; tries++) {
      const x = 2 + Math.floor(hash2(tick + tries * 31, state.day * 41 - tries * 13) * (WORLD_X - 4));
      const z = 2 + Math.floor(hash2(state.day * 67 + tries * 19, tick - tries * 37) * (WORLD_Z - 4));
      const dx = x + 0.5 - p.x;
      const dz = z + 0.5 - p.z;
      if (dx * dx + dz * dz < 34 * 34) continue;
      if (state.mobs.some((other) => Math.hypot(other.x - (x + 0.5), other.z - (z + 0.5)) < 5)) continue;
      const y = state.surface[surfaceIndex(x, z)] + 1;
      if (y <= SEA_LEVEL || !skyVisible(x, y, z) || torchLightAt(x, y, z) > 0.2) continue;
      const type = chooseMobType(x, z, serial + tries);
      const turn = hash2(x + tries, z - tries) * Math.PI * 2;
      const mob = {
        type,
        x: x + 0.5,
        y,
        z: z + 0.5,
        hp: MOB[type].hp,
        mode: "wander",
        turn,
        alertTimer: 0,
        wanderTimer: 0,
        targetX: x + 0.5,
        targetZ: z + 0.5,
        hitCd: 0,
        hurtTimer: 0,
        attackTimer: 0,
        knockTimer: 0,
        knockX: 0,
        knockZ: 0,
        mesh: createMobMesh(type),
      };
      mob.mesh.position.set(mob.x, mob.y, mob.z);
      mobGroup.add(mob.mesh);
      state.mobs.push(mob);
      return;
    }
  }
  function chooseMobType(x, z, salt) {
    const roll = hash2(x + salt * 11, z - salt * 7);
    if (state.day >= 3 && roll > 0.86) return "shadow";
    if (state.day >= 2 && roll > 0.7) return "doomscroll";
    if (roll > 0.52) return "rizzler";
    if (roll > 0.32) return "skibidi";
    if (state.day >= 2 && roll > 0.18) return "grimace";
    return "toilet";
  }
  function createMobMesh(type) {
    const group = new THREE.Group();
    if (type === "toilet") {
      addBox(group, [0, 0.35, 0], [0.9, 0.7, 0.75], enemyMaterials.porcelain);
      addBox(group, [0, 0.88, -0.1], [0.74, 0.38, 0.24], enemyMaterials.porcelainDark);
      addBox(group, [-0.18, 0.95, -0.24], [0.09, 0.09, 0.04], enemyMaterials.black);
      addBox(group, [0.18, 0.95, -0.24], [0.09, 0.09, 0.04], enemyMaterials.black);
      addBox(group, [0, 0.74, -0.38], [0.34, 0.06, 0.05], enemyMaterials.red);
    } else if (type === "grimace") {
      addBox(group, [0, 0.5, 0], [1.05, 1.05, 0.92], enemyMaterials.purple);
      addBox(group, [-0.22, 0.74, -0.45], [0.16, 0.16, 0.04], enemyMaterials.cyan);
      addBox(group, [0.22, 0.74, -0.45], [0.16, 0.16, 0.04], enemyMaterials.cyan);
      addBox(group, [0, 0.42, -0.48], [0.34, 0.07, 0.05], enemyMaterials.black);
    } else if (type === "skibidi") {
      addBox(group, [0, 0.35, 0], [0.84, 0.62, 0.74], enemyMaterials.porcelain);
      addBox(group, [0, 0.9, -0.04], [0.7, 0.34, 0.42], enemyMaterials.bone);
      addBox(group, [0, 1.18, -0.04], [0.36, 0.28, 0.34], enemyMaterials.orange);
      addBox(group, [-0.11, 1.23, -0.23], [0.07, 0.07, 0.04], enemyMaterials.black);
      addBox(group, [0.11, 1.23, -0.23], [0.07, 0.07, 0.04], enemyMaterials.black);
      addBox(group, [0, 1.1, -0.25], [0.2, 0.05, 0.04], enemyMaterials.red);
    } else if (type === "rizzler") {
      addBox(group, [0, 0.42, 0], [0.68, 0.76, 0.58], enemyMaterials.toxic);
      addBox(group, [0, 0.92, -0.04], [0.52, 0.34, 0.48], enemyMaterials.orange);
      addBox(group, [-0.15, 0.98, -0.28], [0.09, 0.09, 0.04], enemyMaterials.cyan);
      addBox(group, [0.15, 0.98, -0.28], [0.09, 0.09, 0.04], enemyMaterials.cyan);
      addBox(group, [0, 0.28, -0.36], [0.44, 0.12, 0.09], enemyMaterials.pink);
    } else if (type === "doomscroll") {
      addBox(group, [0, 0.55, 0], [0.92, 1.0, 0.32], enemyMaterials.black);
      addBox(group, [0, 0.58, -0.18], [0.76, 0.72, 0.05], enemyMaterials.purple);
      addBox(group, [0, 0.88, -0.23], [0.5, 0.08, 0.04], enemyMaterials.cyan);
      addBox(group, [0, 0.58, -0.23], [0.48, 0.08, 0.04], enemyMaterials.pink);
      addBox(group, [0, 0.28, -0.23], [0.34, 0.08, 0.04], enemyMaterials.red);
    } else {
      addBox(group, [0, 0.6, 0], [0.54, 1.2, 0.5], enemyMaterials.shadow);
      addBox(group, [0, 1.28, -0.02], [0.52, 0.38, 0.46], enemyMaterials.black);
      addBox(group, [-0.13, 1.34, -0.27], [0.08, 0.12, 0.04], enemyMaterials.red);
      addBox(group, [0.13, 1.34, -0.27], [0.08, 0.12, 0.04], enemyMaterials.red);
      addBox(group, [-0.36, 0.64, 0], [0.12, 0.68, 0.12], enemyMaterials.shadow);
      addBox(group, [0.36, 0.64, 0], [0.12, 0.68, 0.12], enemyMaterials.shadow);
    }
    group.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
    return group;
  }
  function addBox(group, pos, scale, material) {
    const meshMaterial = material && material.clone ? material.clone() : material;
    const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), meshMaterial);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    if (mesh.material && mesh.material.color) mesh.userData.baseColor = mesh.material.color.clone();
    group.add(mesh);
    return mesh;
  }
  function updateMobs(dt) {
    const p = state.player;
    for (let i = state.mobs.length - 1; i >= 0; i--) {
      const mob = state.mobs[i];
      const cfg = MOB[mob.type] || MOB.toilet;
      const dx = p.x - mob.x;
      const dz = p.z - mob.z;
      const dist = Math.hypot(dx, dz) || 1;
      const seesPlayer = canMobSeePlayer(mob, cfg, dist);
      if (seesPlayer) {
        mob.mode = "hunt";
        mob.alertTimer = cfg.memory;
      } else if (mob.alertTimer > 0) {
        mob.alertTimer = Math.max(0, mob.alertTimer - dt);
      } else {
        mob.mode = "wander";
      }
      if (mob.knockTimer > 0) {
        mob.knockTimer -= dt;
        mob.x += mob.knockX * dt;
        mob.z += mob.knockZ * dt;
        mob.knockX *= 0.84;
        mob.knockZ *= 0.84;
      } else if (mob.mode === "hunt") {
        mob.x += (dx / dist) * cfg.speed * dt;
        mob.z += (dz / dist) * cfg.speed * dt;
      } else {
        updateMobWander(mob, cfg, dt, i);
      }
      mob.x = clamp(mob.x, 1, WORLD_X - 1);
      mob.z = clamp(mob.z, 1, WORLD_Z - 1);
      mob.y = groundYAt(mob.x, mob.z) + 1;
      if (mob.hurtTimer > 0) mob.hurtTimer -= dt;
      if (mob.attackTimer > 0) mob.attackTimer -= dt;
      const attackPulse = mob.attackTimer > 0 ? Math.sin((1 - mob.attackTimer / MOB_ATTACK_SECONDS) * Math.PI) : 0;
      const hurtPulse = mob.hurtTimer > 0 ? Math.sin((1 - mob.hurtTimer / MOB_HURT_SECONDS) * Math.PI) : 0;
      const bob = Math.sin(performance.now() / 160 + i) * 0.04;
      const faceX = mob.mode === "hunt" ? dx : Math.sin(mob.turn || 0);
      const faceZ = mob.mode === "hunt" ? dz : Math.cos(mob.turn || 0);
      mob.mesh.position.set(mob.x + (dx / dist) * attackPulse * 0.38, mob.y + bob + hurtPulse * 0.12, mob.z + (dz / dist) * attackPulse * 0.38);
      mob.mesh.rotation.y = Math.atan2(faceX, faceZ) + Math.PI;
      mob.mesh.rotation.x = -attackPulse * 0.22 + hurtPulse * 0.08;
      mob.mesh.scale.set(1 + hurtPulse * 0.16, 1 - attackPulse * 0.08 + hurtPulse * 0.08, 1 + hurtPulse * 0.16);
      applyMobFlash(mob, hurtPulse, attackPulse);
      if (mob.hitCd > 0) mob.hitCd -= dt;
      if (mob.mode === "hunt" && dist < cfg.attackRange && Math.abs((p.y + 0.5) - mob.y) < 1.8 && mob.hitCd <= 0) {
        mob.attackTimer = MOB_ATTACK_SECONDS;
        hurtPlayer(cfg.damage);
        mob.hitCd = 1.25;
      }
      if (!isNight() && skyVisible(Math.floor(mob.x), Math.floor(mob.y), Math.floor(mob.z))) {
        mob.hp -= dt * 5;
      }
      if (mob.hp <= 0) {
        addScore(cfg.score);
        removeMob(mob);
        state.mobs.splice(i, 1);
      }
    }
  }
  function canMobSeePlayer(mob, cfg, dist) {
    if (!isNight() || dist > cfg.sight || Math.abs((state.player.y + EYE_HEIGHT * 0.65) - (mob.y + 0.75)) > 5) return false;
    if (dist > 4 && mob.mode !== "hunt") {
      const facingX = Math.sin(mob.turn || 0);
      const facingZ = Math.cos(mob.turn || 0);
      const toPlayerX = (state.player.x - mob.x) / dist;
      const toPlayerZ = (state.player.z - mob.z) / dist;
      if (facingX * toPlayerX + facingZ * toPlayerZ < -0.18) return false;
    }
    return clearMobSight(mob.x, mob.y + 0.82, mob.z, state.player.x, state.player.y + EYE_HEIGHT * 0.72, state.player.z);
  }
  function clearMobSight(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const steps = Math.max(8, Math.ceil(Math.hypot(dx, dy, dz) * 2.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor(x0 + dx * t);
      const y = Math.floor(y0 + dy * t);
      const z = Math.floor(z0 + dz * t);
      const code = getBlock(x, y, z);
      if (code !== AIR && code !== WATER && code !== TALL_GRASS && code !== FLOWER && code !== TORCH) return false;
    }
    return true;
  }
  function updateMobWander(mob, cfg, dt, salt) {
    mob.wanderTimer = Math.max(0, (mob.wanderTimer || 0) - dt);
    const ddx = (mob.targetX || mob.x) - mob.x;
    const ddz = (mob.targetZ || mob.z) - mob.z;
    const dist = Math.hypot(ddx, ddz);
    if (mob.wanderTimer <= 0 || dist < 0.45) chooseMobWanderTarget(mob, salt);
    const tx = (mob.targetX || mob.x) - mob.x;
    const tz = (mob.targetZ || mob.z) - mob.z;
    const targetDist = Math.hypot(tx, tz) || 1;
    const speed = cfg.roamSpeed || 0.4;
    mob.x += (tx / targetDist) * speed * dt;
    mob.z += (tz / targetDist) * speed * dt;
    mob.turn = Math.atan2(tx, tz);
  }
  function chooseMobWanderTarget(mob, salt) {
    const baseX = Math.floor(mob.x * 7 + salt * 17 + state.day * 13);
    const baseZ = Math.floor(mob.z * 7 - salt * 19 + state.day * 11);
    for (let tries = 0; tries < 8; tries++) {
      const angle = hash2(baseX + tries * 5, baseZ - tries * 3) * Math.PI * 2;
      const dist = 4 + hash2(baseX - tries * 11, baseZ + tries * 7) * 11;
      const tx = clamp(mob.x + Math.cos(angle) * dist, 2.5, WORLD_X - 2.5);
      const tz = clamp(mob.z + Math.sin(angle) * dist, 2.5, WORLD_Z - 2.5);
      const y = groundYAt(tx, tz);
      if (y <= SEA_LEVEL || torchLightAt(Math.floor(tx), y + 1, Math.floor(tz)) > 0.25) continue;
      mob.targetX = tx;
      mob.targetZ = tz;
      mob.wanderTimer = 1.4 + hash2(baseX + tries * 23, baseZ - tries * 29) * 3.4;
      return;
    }
    mob.targetX = mob.x;
    mob.targetZ = mob.z;
    mob.wanderTimer = 1.1;
  }
  function damageMob(mob, damage) {
    const dx = mob.x - state.player.x;
    const dz = mob.z - state.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    mob.hp -= damage;
    mob.hurtTimer = MOB_HURT_SECONDS;
    mob.knockTimer = 0.16;
    mob.knockX = (dx / dist) * 3.2;
    mob.knockZ = (dz / dist) * 3.2;
    spawnHitBurst(mob.x, mob.y + 0.72, mob.z, cachedRgb("#fff0f0"));
  }
  function applyMobFlash(mob, hurtPulse, attackPulse) {
    if (!mob.mesh) return;
    mob.mesh.traverse((child) => {
      if (!child.material || !child.material.color || !child.userData.baseColor) return;
      child.material.color.copy(child.userData.baseColor);
      if (attackPulse > 0) child.material.color.lerp(mobAttackColor, attackPulse * 0.24);
      if (hurtPulse > 0) child.material.color.lerp(mobHurtColor, hurtPulse * 0.82);
    });
  }
  function removeMob(mob) {
    mobGroup.remove(mob.mesh);
    disposeMesh(mob.mesh);
  }
  function applyFriendlyFlash(friendly, hurtPulse) {
    if (!friendly.mesh) return;
    friendly.mesh.traverse((child) => {
      if (!child.material || !child.material.color || !child.userData.baseColor) return;
      child.material.color.copy(child.userData.baseColor);
      if (hurtPulse > 0) child.material.color.lerp(friendlyHurtColor, hurtPulse * 0.82);
    });
  }
  function damageFriendly(friendly, damage) {
    if (friendly.hitCd > 0) return;
    const cfg = getFriendlyConfig(friendly.type);
    const dx = friendly.x - state.player.x;
    const dz = friendly.z - state.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    friendly.hp -= damage;
    friendly.hurtTimer = FRIENDLY_HURT_SECONDS;
    friendly.hitCd = FRIENDLY_HIT_COOLDOWN;
    friendly.knockTimer = 0.18;
    friendly.knockX = (dx / dist) * 2.8;
    friendly.knockZ = (dz / dist) * 2.8;
    spawnHitBurst(friendly.x, friendly.y + 0.72, friendly.z, cachedRgb("#ffd3ef"));
    if (friendly.hp <= 0) {
      addScore(cfg.drops * 6);
      friendly.deathPulse = 0.2;
    }
  }
  function dropFriendlyFood(friendly) {
    const cfg = getFriendlyConfig(friendly.type);
    const count = cfg.drops + Math.floor(hash2(friendly.x, friendly.z) * FRIENDLY_DROP_VARIATION);
    const drop = clamp(count, FRIENDLY_DROP_MIN, 5);
    if (drop <= 0) return;
    giveItem(FRIENDLY_FRUIT, drop);
    spawnBurst(friendly.x + 0.1, friendly.y + 0.55, friendly.z + 0.1, cachedRgb("#ff6fa8"), 6 + drop * 2, 2.2);
    api.toast(`Rizz Fruit x${drop} dropped`, "good");
  }
  function removeFriendly(friendly, index) {
    removeAtIndex(state.friendlies, index);
    friendlyGroup.remove(friendly.mesh);
    disposeMesh(friendly.mesh);
  }
  function removeAtIndex(arr, index) {
    if (index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
  }
  function groundYAt(x, z) {
    const ix = clamp(Math.floor(x), 0, WORLD_X - 1);
    const iz = clamp(Math.floor(z), 0, WORLD_Z - 1);
    return state.surface[surfaceIndex(ix, iz)];
  }
  function skyVisible(x, y, z) {
    return y >= state.surface[surfaceIndex(clamp(x, 0, WORLD_X - 1), clamp(z, 0, WORLD_Z - 1))];
  }
  function torchLightAt(x, y, z) {
    let light = 0;
    for (let dz = -6; dz <= 6; dz++) {
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (getBlock(x + dx, y + dy, z + dz) !== TORCH) continue;
          const d = Math.hypot(dx, dy, dz);
          if (d < 7) light = Math.max(light, 1 - d / 7);
        }
      }
    }
    return light;
  }

  function updateTarget() {
    const rawTarget = raycastBlocks(REACH);
    const prevTarget = state.target;
    if (rawTarget && rawTarget.hit) {
      if (prevTarget && prevTarget.x === rawTarget.x && prevTarget.y === rawTarget.y && prevTarget.z === rawTarget.z) {
        targetHoldFrames = 0;
        state.target = rawTarget;
      } else if (targetHoldFrames < TARGET_HOLD_FRAMES && prevTarget) {
        targetHoldFrames++;
      } else {
        targetHoldFrames = 0;
        state.target = rawTarget;
      }
    } else {
      targetHoldFrames = 0;
      state.target = null;
    }

    selectionBox.visible = !!(state.target && state.target.hit);
    ui.target.classList.toggle("is-visible", selectionBox.visible);
    if (selectionBox.visible) {
      selectionBox.position.set(state.target.x + 0.5, state.target.y + 0.5, state.target.z + 0.5);
      const miningThis = state.mining && state.mining.x === state.target.x && state.mining.y === state.target.y && state.mining.z === state.target.z;
      const pulse = miningThis ? Math.sin(state.gatherPhase * 2.1) * 0.045 + 0.055 : 0;
      selectionBox.scale.setScalar(1 + pulse);
      selectionBox.material.opacity = miningThis ? 0.72 + Math.abs(Math.sin(state.gatherPhase * 1.6)) * 0.28 : 0.9;
      selectionBox.material.color.setHex(miningThis ? 0xffdf55 : 0xffffff);
      const code = getBlock(state.target.x, state.target.y, state.target.z);
      if (code === TABLE) ui.target.textContent = "Crafting Toilet - right-click to craft";
      else if (selectedIsBlock()) ui.target.textContent = `${DEF[code].name} - select a tool to mine`;
      else ui.target.textContent = `${DEF[code].name}`;
    } else {
      selectionBox.scale.setScalar(1);
      ui.target.textContent = "";
    }
  }
  function raycastBlocks(maxDist) {
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const step = 0.03;
    let prev = null;
    for (let t = 0; t <= maxDist; t += step) {
      const x = Math.floor(origin.x + dir.x * t);
      const y = Math.floor(origin.y + dir.y * t);
      const z = Math.floor(origin.z + dir.z * t);
      if (!inWorld(x, y, z)) continue;
      const code = getBlock(x, y, z);
      if (code !== AIR && code !== WATER) return { hit: true, x, y, z, prev };
      prev = { x, y, z };
    }
    return null;
  }
  function updateMining(dt) {
    if (!state.input.mine || state.crafting || state.paused) {
      state.mining = null;
      ui.progress.style.width = "0%";
      return;
    }
    if (selectedIsBlock()) {
      state.mining = null;
      ui.progress.style.width = "0%";
      return;
    }
    if (tryAttack()) return;
    const t = state.target;
    if (!t || !t.hit) {
      state.mining = null;
      return;
    }
    const code = getBlock(t.x, t.y, t.z);
    if (code === BEDROCK || code === WATER || code === LAVA) return;
    const need = breakTimeFor(code);
    if (!state.mining || state.mining.x !== t.x || state.mining.y !== t.y || state.mining.z !== t.z) {
      state.mining = { x: t.x, y: t.y, z: t.z, progress: 0, need };
      triggerHeldSwing("gather");
    } else if (state.swingTimer <= 0.02) {
      triggerHeldSwing("gather");
    }
    state.mining.progress += dt;
    ui.progress.style.width = `${clamp(state.mining.progress / need, 0, 1) * 100}%`;
    if (state.mining.progress >= need) {
      finishMine(t.x, t.y, t.z, code);
      state.mining = null;
      ui.progress.style.width = "0%";
    }
  }
  function breakTimeFor(code) {
    const d = DEF[code];
    const tool = selectedTool();
    let time = d.hardness || 0.2;
    if (d.best && tool && tool.type === d.best) time /= tool.mult;
    if (d.needTool && tool && tool.type === d.needTool) time /= tool.mult;
    else if (d.needTool) time *= 1.6;
    return Math.max(0.08, time);
  }
  function canDrop(code) {
    const d = DEF[code];
    if (!d.needTool) return true;
    const tool = selectedTool();
    if (!tool || tool.type !== d.needTool) return false;
    return !d.needTier || tool.tier >= d.needTier;
  }
  function finishMine(x, y, z, code) {
    const d = DEF[code];
    spawnBlockBurst(x, y, z, code);
    setBlock(x, y, z, AIR);
    flowLiquidsNear(x, y, z);
    state.mined++;
    addScore(1);
    if (d.drop !== null && canDrop(code)) giveItem(d.drop === undefined ? code : d.drop, 1);
    api.toast(`Mined ${d.name}`, "");
  }
  function updatePlacing(dt) {
    if (state.placeCd > 0) state.placeCd -= dt;
    if ((!state.input.place && !state.placeQueued) || state.placeCd > 0 || state.crafting || state.paused) return;
    state.placeQueued = false;
    const t = state.target;
    if (t && t.hit && getBlock(t.x, t.y, t.z) === TABLE) {
      toggleCrafting(true);
      state.placeCd = 0.24;
      state.input.place = false;
      return;
    }
    const slot = selectedSlot();
    if ((!slot || !isPlaceable(slot.code)) && nearTable()) {
      toggleCrafting(true);
      state.placeCd = 0.24;
      state.input.place = false;
      return;
    }
    if (!t || !t.hit || !t.prev || !slot || !isPlaceable(slot.code)) return;
    const p = t.prev;
    if (getBlock(p.x, p.y, p.z) !== AIR && getBlock(p.x, p.y, p.z) !== WATER) return;
    if (boxContainsBlock(playerBox(), p.x, p.y, p.z)) return;
    setBlock(p.x, p.y, p.z, slot.code);
    flowLiquidsNear(p.x, p.y, p.z);
    decrementSelectedSlot();
    state.placeCd = 0.18;
    state.input.place = false;
  }
  function boxContainsBlock(b, x, y, z) {
    return x + 1 > b.minX && x < b.maxX && y + 1 > b.minY && y < b.maxY && z + 1 > b.minZ && z < b.maxZ;
  }
  function tryAttack() {
    if (selectedIsBlock()) return false;
    if (state.attackCd > 0) return false;
    const dir = reusableVector;
    camera.getWorldDirection(dir);
    const origin = camera.position;
    let hit = null;
    let best = 5.4;
    const allTargets = [];
    for (const mob of state.mobs) {
      allTargets.push({
        kind: "mob",
        type: mob.type,
        target: mob,
        radius: MOB[mob.type].radius,
      });
    }
    for (const friendly of state.friendlies) {
      allTargets.push({
        kind: "friendly",
        type: friendly.type,
        target: friendly,
        radius: friendly.radius || getFriendlyConfig(friendly.type).radius,
      });
    }
    for (const item of allTargets) {
      const t = item.target;
      const cx = t.x;
      const cy = t.y + 0.6;
      const cz = t.z;
      const vx = cx - origin.x;
      const vy = cy - origin.y;
      const vz = cz - origin.z;
      const along = vx * dir.x + vy * dir.y + vz * dir.z;
      if (along < 0 || along > 5.4) continue;
      const px = origin.x + dir.x * along;
      const py = origin.y + dir.y * along;
      const pz = origin.z + dir.z * along;
      const off = Math.hypot(cx - px, cy - py, cz - pz);
      if (off < item.radius && along < best) {
        best = along;
        hit = item;
      }
    }
    if (!hit) return false;
    const damage = heldAttackDamage();
    triggerHeldSwing("attack");
    if (hit.kind === "friendly") {
      damageFriendly(hit.target, damage);
      api.toast(`Hit ${friendlyName(hit.type)} -${damage}`, "");
    } else {
      damageMob(hit.target, damage);
      api.toast(`Hit ${hit.type === "toilet" ? "Skibidi Toilet" : "Grimace Shake"} -${damage}`, "");
    }
    state.attackCd = 0.32;
    return true;
  }
  function heldAttackDamage() {
    const slot = selectedSlot();
    if (!slot) return 1;
    const d = DEF[slot.code];
    if (!d) return 1;
    const tool = d.tool;
    if (tool) {
      if (tool.type === "sword") return tool.damage;
      const typeBonus = tool.type === "axe" ? 1.1 : 0.55;
      return Math.round((1.5 + tool.tier * 1.35 + tool.mult * 0.32 + typeBonus) * 10) / 10;
    }
    if (slot.code === SIGMA) return 4.8;
    if (slot.code === RIZZ) return 3.2;
    if (slot.code === COAL) return 1.6;
    if (slot.code === STICK) return 1.3;
    if (d.kind === "block") {
      const hardness = Number.isFinite(d.hardness) ? d.hardness : 0.35;
      const blockBonus = d.solid ? 0.65 : 0.15;
      return Math.round((1 + clamp(hardness, 0.05, 3) * 1.55 + blockBonus) * 10) / 10;
    }
    return 1;
  }

  function nearTable() {
    const px = Math.floor(state.player.x);
    const py = Math.floor(state.player.y);
    const pz = Math.floor(state.player.z);
    for (let z = pz - 3; z <= pz + 3; z++) {
      for (let y = py - 2; y <= py + 2; y++) {
        for (let x = px - 3; x <= px + 3; x++) {
          if (getBlock(x, y, z) === TABLE) return true;
        }
      }
    }
    return false;
  }
  function canCraft(recipe) {
    if (recipe.table && !nearTable()) return false;
    return recipe.in.every(([code, n]) => countItem(code) >= n);
  }
  function doCraft(recipe) {
    if (!canCraft(recipe)) return false;
    recipe.in.forEach(([code, n]) => takeItem(code, n));
    giveItem(recipe.out.code, recipe.out.n);
    if (recipe.out.code === SWORD_SIGMA && !state.sigmaForged) {
      state.sigmaForged = true;
      addScore(500);
    }
    api.toast(`Crafted ${DEF[recipe.out.code].name}`, "good");
    renderCrafting();
    return true;
  }
  function toggleCrafting(force) {
    if (!state.started) return;
    state.crafting = typeof force === "boolean" ? force : !state.crafting;
    if (craftPanel) craftPanel.classList.toggle("is-open", state.crafting);
    if (state.crafting) {
      state.bagOpen = false;
      renderBag();
      unlockPointer();
      renderCrafting();
    }
  }
  function renderCrafting() {
    if (!craftList) return;
    const near = nearTable();
    craftList.innerHTML = RECIPES.map((r, i) => {
      const ok = canCraft(r);
      const needs = r.in.map(([c, n]) => {
        const have = countItem(c);
        return `<span class="craft-need ${have >= n ? "ok" : "no"}">${DEF[c].name} ${have}/${n}</span>`;
      }).join("");
      const lock = r.table && !near ? `<span class="craft-lock">needs Crafting Toilet</span>` : "";
      return `<button class="craft-recipe" data-recipe="${i}" ${ok ? "" : "disabled"}>
        <span class="craft-out"><b>${DEF[r.out.code].name}</b>${r.out.n > 1 ? " x" + r.out.n : ""}</span>
        <span class="craft-ins">${needs}${lock}</span>
      </button>`;
    }).join("");
    craftList.querySelectorAll("[data-recipe]").forEach((button) => {
      button.addEventListener("click", () => doCraft(RECIPES[Number(button.dataset.recipe)]));
    });
  }

  function updateTime(dt) {
    const prev = state.time;
    state.time = (state.time + dt / DAY_SECONDS) % 1;
    if (state.time < prev) {
      state.day++;
      addScore(70);
      api.toast(`Survived the night. Day ${state.day}`, "good");
      state.mobs.slice().forEach(removeMob);
      state.mobs = [];
    }
    if (isNight() && state.started && !state.paused && !state.crafting) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnMob();
        state.spawnTimer = 1.6 + hash2(Math.floor(performance.now()), state.day) * 2.4;
      }
    }
  }
  function daylight() {
    return clamp(Math.cos((state.time - 0.25) * Math.PI * 2) * 1.25 + 0.28, 0, 1);
  }
  function isNight() { return daylight() < 0.22; }
  function updateLighting() {
    const d = daylight();
    const sky = new THREE.Color(0x101a46).lerp(new THREE.Color(0x53cfff), d);
    const fog = new THREE.Color(0x131d48).lerp(new THREE.Color(0x8edfff), d);
    scene.background = sky;
    scene.fog = new THREE.FogExp2(fog, lerp(0.027, 0.0054, d));
    ambient.intensity = lerp(0.22, 1.0, d);
    sun.intensity = lerp(0.12, 1.34, d);
    const a = state.time * Math.PI * 2;
    sunOrbitVector.set(Math.cos(a) * 65, Math.sin(a) * 70 + 18, Math.sin(a * 0.7) * 46);
    moonOrbitVector.set(-sunOrbitVector.x, -sunOrbitVector.y + 8, -sunOrbitVector.z);
    sun.position.copy(sunOrbitVector);
    if (sunDisk && moonDisk) {
      positionCelestial(sunDisk, sunOrbitVector, 185, clamp((sunOrbitVector.y + 8) / 72, 0, 1) * lerp(0.5, 1, d));
      positionCelestial(moonDisk, moonOrbitVector, 175, clamp((moonOrbitVector.y + 8) / 74, 0, 1) * clamp((0.72 - d) / 0.72, 0.2, 1));
    }
    const stars = scene.getObjectByName("stars");
    if (stars) stars.material.opacity = clamp((0.38 - d) / 0.38, 0, 1);
    cloudGroup.children.forEach((cloud, i) => {
      cloud.position.x += 0.006 + i * 0.0002;
      if (cloud.position.x > WORLD_X + 20) cloud.position.x = -20;
    });
  }
  function positionCelestial(mesh, orbit, distance, opacity) {
    if (orbit.lengthSq() < 0.001) orbit.set(0, 1, 0);
    orbit.normalize();
    mesh.position.set(
      camera.position.x + orbit.x * distance,
      camera.position.y + orbit.y * distance,
      camera.position.z + orbit.z * distance
    );
    mesh.lookAt(camera.position);
    mesh.material.opacity = opacity;
    mesh.visible = opacity > 0.025;
  }

  function addScore(n) {
    state.score += n;
    if (state.score > state.high) {
      state.high = state.score;
      api.recordScore(GAME_ID, state.high);
    }
  }
  function updateHud() {
    setText("hud-hp", `${Math.max(0, Math.ceil(state.player.hp))}/${MAX_HP}`);
    setText("hud-day", `${isNight() ? "Moon" : "Sun"} ${state.day}`);
    setText("hud-mined", state.mined.toLocaleString());
    setText("hud-score", state.score.toLocaleString());
    setText("hud-high", state.high.toLocaleString());
    ui.objective.textContent = `${BIOMES[state.biome[surfaceIndex(Math.floor(state.player.x), Math.floor(state.player.z))]].name} - ${WORLD_X}x${WORLD_Z}x${WORLD_Y} world - lava below ${LAVA_LEVEL} - ${state.mobs.length} enemies - ${state.friendlies.length} pals`;
    ui.hotbar.innerHTML = state.hotbar.map((slot, i) => {
      const selected = i === state.selected ? " is-selected" : "";
      const label = slotName(slot, "");
      const count = slot && slot.n > 1 ? `<b>${slot.n}</b>` : "";
      const swatch = slotSwatch(slot);
      return `<button class="rizz3d-slot${selected}" data-slot="${i}" title="${escapeAttr(label || "Empty")}"><em>${i + 1}</em>${swatch}${count}</button>`;
    }).join("");
    if (ui.bagButton) {
      const used = state.bag.filter(Boolean).length;
      ui.bagButton.textContent = `Bag ${used}/${BAG_SLOTS}`;
      ui.bagButton.classList.toggle("is-open", state.bagOpen);
    }
    renderBag();
    updateHeldItem();
  }
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function slotName(slot, empty = "Empty") {
    return slot && DEF[slot.code] ? DEF[slot.code].name : empty;
  }
  function slotDetail(slot, empty = "Empty") {
    if (!slot || !DEF[slot.code]) return empty;
    return slot.n > 1 ? `${DEF[slot.code].name} x${slot.n}` : DEF[slot.code].name;
  }
  function escapeAttr(value) {
    return String(value).replace(/[&"<>]/g, (ch) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[ch]));
  }
  function setSelectedSlot(index, announce = true) {
    state.selected = clamp(Number(index) || 0, 0, HOTBAR - 1);
    heldRenderCode = null;
    renderBag();
    if (announce) showSelectionCue();
  }
  function showSelectionCue(prefix = "Selected") {
    if (!ui.selectionCue) return;
    ui.selectionCue.textContent = `${prefix}: ${slotDetail(selectedSlot())}`;
    ui.selectionCue.classList.add("is-visible");
    window.clearTimeout(selectionCueTimer);
    selectionCueTimer = window.setTimeout(() => {
      if (ui.selectionCue) ui.selectionCue.classList.remove("is-visible");
    }, 1350);
  }
  function setBagHoverText(text = "") {
    if (!ui.bagPanel) return;
    const hover = ui.bagPanel.querySelector("[data-bag-hover]");
    if (hover) hover.textContent = text || "Hover a slot to inspect it.";
  }
  function updateHeldItem() {
    const slot = selectedSlot();
    const code = slot ? slot.code : 0;
    if (heldRenderCode === code) {
      applyHeldAnimation();
      return;
    }
    heldRenderCode = code;
    disposeGroup(heldGroup);
    if (!slot) {
      applyHeldAnimation();
      return;
    }
    buildHeldModel(slot.code);
    applyHeldAnimation();
  }
  function buildHeldModel(code) {
    const d = DEF[code] || DEF[DIRT];
    const tool = d.tool;
    if (tool && tool.type === "pick") return buildHeldPick(d.color || "#b98245");
    if (tool && tool.type === "sword") return buildHeldSword(d.color || "#a6a9b5");
    if (tool && tool.type === "axe") return buildHeldAxe(d.color || "#b98245");
    if (code === TORCH) return buildHeldTorch();
    if (d.kind === "block") return buildHeldBlock(code);
    return buildHeldItem(code);
  }
  function heldMaterial(color) {
    const mat = new THREE.MeshLambertMaterial({ color });
    mat.userData.disposeWithMesh = true;
    return mat;
  }
  function addHeldBox(pos, scale, material, rot = [0, 0, 0]) {
    const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    heldGroup.add(mesh);
    return mesh;
  }
  function addHeldToolGroup(pos, rot) {
    const group = new THREE.Group();
    group.position.set(pos[0], pos[1], pos[2]);
    group.rotation.set(rot[0], rot[1], rot[2]);
    heldGroup.add(group);
    return group;
  }
  function addHeldToolBox(group, pos, scale, material) {
    const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    group.add(mesh);
    return mesh;
  }
  function buildHeldPick(color) {
    const handle = heldMaterial("#7c4e29");
    const headColor = (color || "#b98245").toLowerCase() === "#b98245" ? "#9b6532" : color || "#b98245";
    const head = heldMaterial(headColor);
    const tool = addHeldToolGroup([0.42, -0.42, -0.78], [0.08, 0.04, -0.58]);
    addHeldToolBox(tool, [0, 0, 0], [0.07, 0.62, 0.07], handle);
    addHeldToolBox(tool, [0, 0.29, 0], [0.36, 0.075, 0.08], head);
  }
  function buildHeldSword(color) {
    const bladeColor = (color || "#a6a9b5").toLowerCase() === "#b98245" ? "#9b6532" : color || "#a6a9b5";
    const blade = heldMaterial(bladeColor);
    const guard = heldMaterial("#8a572d");
    const handle = heldMaterial("#5a3218");
    const tool = addHeldToolGroup([0.36, -0.34, -0.8], [0.08, 0.04, -0.58]);
    addHeldToolBox(tool, [0, 0.2, 0], [0.06, 0.62, 0.06], blade);
    addHeldToolBox(tool, [0, -0.1, 0], [0.28, 0.07, 0.08], guard);
    addHeldToolBox(tool, [0, -0.27, 0], [0.075, 0.3, 0.075], handle);
  }
  function buildHeldAxe(color) {
    const wood = heldMaterial("#7c4e29");
    const head = heldMaterial(color);
    addHeldBox([0.38, -0.34, -0.72], [0.07, 0.54, 0.07], wood, [0, 0, -0.54]);
    addHeldBox([0.21, -0.13, -0.82], [0.26, 0.24, 0.1], head, [0, 0, -0.54]);
    addHeldBox([0.11, -0.19, -0.82], [0.1, 0.18, 0.1], head, [0, 0, -0.18]);
  }
  function buildHeldTorch() {
    addHeldBox([0.38, -0.33, -0.72], [0.08, 0.46, 0.08], heldMaterial("#8a572d"), [0, 0, -0.42]);
    addHeldBox([0.28, -0.11, -0.78], [0.18, 0.18, 0.18], heldMaterial("#ffd75a"), [0, 0, -0.42]);
    addHeldBox([0.28, -0.07, -0.78], [0.11, 0.11, 0.11], heldMaterial("#ff6a1a"), [0, 0, -0.42]);
  }
  function buildHeldBlock(code) {
    addHeldBox([0.32, -0.24, -0.78], [0.3, 0.3, 0.3], heldMaterial(DEF[code].color || "#ffffff"), [0.2, 0.42, -0.18]);
  }
  function buildHeldItem(code) {
    const color = DEF[code].color || "#ffffff";
    if (code === STICK) {
      addHeldBox([0.36, -0.32, -0.74], [0.06, 0.44, 0.06], heldMaterial(color), [0, 0, -0.62]);
      return;
    }
    addHeldBox([0.32, -0.22, -0.78], [0.2, 0.2, 0.2], heldMaterial(color), [0.42, 0.25, -0.18]);
    addHeldBox([0.32, -0.22, -0.78], [0.28, 0.07, 0.28], heldMaterial("#ffffff"), [0.42, 0.25, -0.18]);
  }
  function applyHeldAnimation() {
    const idle = Math.sin(performance.now() * 0.0022) * 0.004;
    heldGroup.position.set(0, idle, 0);
    heldGroup.rotation.set(0, 0, 0);
    if (state.mining) {
      const chop = (Math.sin(state.gatherPhase * 2.4) + 1) * 0.5;
      heldGroup.position.y -= chop * 0.045;
      heldGroup.position.z -= chop * 0.055;
      heldGroup.rotation.x -= chop * 0.34;
      heldGroup.rotation.y += chop * 0.08;
    }
    if (state.swingTimer > 0) {
      const dur = state.swingKind === "attack" ? HELD_SWING_SECONDS : HELD_GATHER_SECONDS;
      const t = clamp(1 - state.swingTimer / dur, 0, 1);
      const swing = Math.sin(t * Math.PI);
      const attack = state.swingKind === "attack" ? 1 : 0.62;
      heldGroup.position.x += swing * 0.05 * attack;
      heldGroup.position.y -= swing * 0.11 * attack;
      heldGroup.position.z -= swing * 0.16 * attack;
      heldGroup.rotation.x -= swing * 0.72 * attack;
      heldGroup.rotation.y += swing * 0.28 * attack;
      heldGroup.rotation.z -= swing * 0.18;
    }
  }
  function bagSlotHtml(slot, i, attr, selected = false, scope = "Slot") {
    const label = slotName(slot);
    const detail = `${scope} ${i + 1}: ${slotDetail(slot)}`;
    const count = slot && slot.n > 1 ? `<b>${slot.n}</b>` : "";
    const swatch = slotSwatch(slot);
    return `<button class="rizz3d-bag-slot${selected ? " is-selected" : ""}" ${attr} data-item-name="${escapeAttr(detail)}" title="${escapeAttr(detail)}"><em>${i + 1}</em>${swatch}${count}</button>`;
  }
  function slotSwatch(slot) {
    if (!slot || !DEF[slot.code]) return "";
    const d = DEF[slot.code];
    const tool = d.tool && d.tool.type;
    const kind = tool ? ` is-${tool}` : codeSwatchClass(slot.code, d);
    const color = d.color || "#ffffff";
    return `<span class="rizz3d-swatch${kind}" style="--item-color:${color};background:${color}"></span>`;
  }
  function codeSwatchClass(code, d) {
    if (code === TORCH) return " is-torch";
    if (d.kind === "block") return " is-block";
    return " is-item";
  }
  function renderBag() {
    if (!ui.bagPanel) return;
    const key = state.bagOpen
      ? `${state.selected}|${state.hotbar.map((slot) => slot ? `${slot.code}:${slot.n}` : "-").join(",")}|${state.bag.map((slot) => slot ? `${slot.code}:${slot.n}` : "-").join(",")}`
      : "closed";
    ui.bagPanel.classList.toggle("is-open", state.bagOpen);
    if (key === bagRenderKey) return;
    bagRenderKey = key;
    if (!state.bagOpen) {
      ui.bagPanel.innerHTML = "";
      return;
    }
    ui.bagPanel.innerHTML = `
      <div class="rizz3d-bag-head">
        <strong>Bag</strong>
        <span>Click a bag item to swap it into the selected action slot.</span>
      </div>
      <div class="rizz3d-bag-hover" data-bag-hover>Hover a slot to inspect it.</div>
      <div class="rizz3d-bag-label">Action bar</div>
      <div class="rizz3d-bag-hotbar">
        ${state.hotbar.map((slot, i) => bagSlotHtml(slot, i, `data-bag-hotbar="${i}"`, i === state.selected, "Action")).join("")}
      </div>
      <div class="rizz3d-bag-label">Bag storage</div>
      <div class="rizz3d-bag-grid">
        ${state.bag.map((slot, i) => bagSlotHtml(slot, i, `data-bag-slot="${i}"`, false, "Bag")).join("")}
      </div>
    `;
  }

  function buildHud() {
    const wrap = canvas.closest(".canvas-wrap") || canvas.parentElement;
    const style = document.createElement("style");
    style.textContent = `
      .rizz3d-crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);pointer-events:none;z-index:5}
      .rizz3d-crosshair:before,.rizz3d-crosshair:after{content:"";position:absolute;background:rgba(255,255,255,.9);box-shadow:0 0 6px rgba(0,0,0,.7)}
      .rizz3d-crosshair:before{left:8px;top:1px;width:2px;height:16px}.rizz3d-crosshair:after{left:1px;top:8px;width:16px;height:2px}
      .rizz3d-chip{position:absolute;left:12px;bottom:62px;z-index:5;padding:7px 10px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(5,7,13,.72);color:#fff;font:700 11px var(--font-mono);pointer-events:none}
      .rizz3d-target{display:none;position:absolute;left:50%;top:calc(50% + 24px);transform:translateX(-50%);z-index:5;color:#fff;background:rgba(5,7,13,.6);border-radius:5px;padding:4px 8px;font:700 11px var(--font-mono);pointer-events:none}
      .rizz3d-target.is-visible{display:block}
      .rizz3d-progress{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:5;width:min(340px,72%);height:5px;background:rgba(0,0,0,.55);border-radius:3px;overflow:hidden;pointer-events:none}.rizz3d-progress span{display:block;width:0;height:100%;background:#ffd43b}
      .rizz3d-selection-cue{position:absolute;left:50%;bottom:60px;transform:translate(-50%,8px);z-index:8;max-width:min(320px,72%);padding:6px 10px;border:1px solid rgba(255,212,59,.45);border-radius:6px;background:rgba(5,7,13,.86);color:#fff;font:900 11px var(--font-mono);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity 120ms ease,transform 120ms ease}.rizz3d-selection-cue.is-visible{opacity:1;transform:translate(-50%,0)}
      .rizz3d-hotbar{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:7;display:grid;grid-template-columns:repeat(9,40px);gap:4px;pointer-events:auto}
      .rizz3d-slot{position:relative;width:40px;height:40px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(8,10,18,.8);cursor:pointer}.rizz3d-slot.is-selected{border-color:#ffd43b;box-shadow:0 0 0 2px rgba(255,212,59,.28),0 0 18px rgba(255,212,59,.18)}.rizz3d-slot.is-selected:after{content:"";position:absolute;left:6px;right:6px;bottom:3px;height:2px;border-radius:2px;background:#ffd43b}
      .rizz3d-slot em{position:absolute;left:4px;top:2px;color:rgba(255,255,255,.55);font:700 9px var(--font-mono);font-style:normal}.rizz3d-slot b{position:absolute;right:4px;bottom:2px;color:#fff;font:800 11px var(--font-mono)}
      .rizz3d-swatch{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);border-radius:4px;box-shadow:inset 0 -4px 0 rgba(0,0,0,.22),0 0 0 1px rgba(255,255,255,.22)}
      .rizz3d-swatch.is-pick,.rizz3d-swatch.is-sword,.rizz3d-swatch.is-axe,.rizz3d-swatch.is-torch{width:26px;height:26px;background:transparent!important;border-radius:0;box-shadow:none}
      .rizz3d-swatch.is-pick:before{content:"";position:absolute;left:11px;top:5px;width:4px;height:21px;border-radius:3px;background:#6f4624;box-shadow:0 0 0 1px rgba(255,255,255,.16);transform:rotate(34deg)}
      .rizz3d-swatch.is-pick:after{content:"";position:absolute;left:2px;top:5px;width:23px;height:6px;border-radius:5px 5px 3px 3px;background:linear-gradient(90deg,rgba(0,0,0,.12),var(--item-color) 24%,var(--item-color) 76%,rgba(255,255,255,.22));box-shadow:inset 0 -2px 0 rgba(0,0,0,.25),0 0 0 1px rgba(255,255,255,.22);transform:rotate(-15deg)}
      .rizz3d-swatch.is-sword:before{content:"";position:absolute;left:12px;top:2px;width:4px;height:20px;border-radius:2px;background:var(--item-color);box-shadow:inset 0 -5px 0 rgba(255,255,255,.24),0 0 0 1px rgba(255,255,255,.18);transform:rotate(42deg)}
      .rizz3d-swatch.is-sword:after{content:"";position:absolute;left:7px;top:16px;width:15px;height:4px;border-radius:3px;background:#7c4e29;box-shadow:0 0 0 1px rgba(255,255,255,.16);transform:rotate(42deg)}
      .rizz3d-swatch.is-axe:before{content:"";position:absolute;left:11px;top:4px;width:4px;height:21px;border-radius:3px;background:#7c4e29;box-shadow:0 0 0 1px rgba(255,255,255,.16);transform:rotate(35deg)}
      .rizz3d-swatch.is-axe:after{content:"";position:absolute;left:5px;top:4px;width:15px;height:14px;border-radius:3px 7px 7px 3px;background:var(--item-color);box-shadow:inset -4px -3px 0 rgba(0,0,0,.2),0 0 0 1px rgba(255,255,255,.2);transform:rotate(18deg)}
      .rizz3d-swatch.is-torch:before{content:"";position:absolute;left:11px;top:7px;width:5px;height:18px;border-radius:2px;background:#8a572d;box-shadow:0 0 0 1px rgba(255,255,255,.14);transform:rotate(24deg)}
      .rizz3d-swatch.is-torch:after{content:"";position:absolute;left:7px;top:1px;width:13px;height:13px;border-radius:50% 50% 46% 46%;background:radial-gradient(circle at 50% 34%,#fff2a8 0 22%,#ffd75a 23% 55%,#ff6a1a 56% 100%);box-shadow:0 0 10px rgba(255,163,45,.75)}
      .rizz3d-bag-button{position:absolute;left:calc(50% + 204px);bottom:10px;z-index:7;height:40px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(8,10,18,.86);color:#fff;font:800 10px var(--font-mono);padding:0 10px;cursor:pointer}.rizz3d-bag-button.is-open{border-color:#43e6ff;box-shadow:0 0 0 2px rgba(67,230,255,.22)}
      .rizz3d-bag-panel{display:none;position:absolute;right:12px;bottom:62px;z-index:8;width:min(360px,calc(100% - 24px));max-height:min(420px,72%);overflow:auto;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(5,7,13,.91);box-shadow:0 18px 44px rgba(0,0,0,.38);padding:10px;pointer-events:auto}.rizz3d-bag-panel.is-open{display:block}
      .rizz3d-bag-head{display:grid;gap:2px;margin-bottom:8px}.rizz3d-bag-head strong{color:#fff;font:900 13px var(--font-display)}.rizz3d-bag-head span,.rizz3d-bag-label{color:rgba(255,255,255,.68);font:700 10px var(--font-mono)}
      .rizz3d-bag-hover{min-height:24px;margin:6px 0 9px;padding:6px 8px;border:1px solid rgba(67,230,255,.22);border-radius:6px;background:rgba(67,230,255,.08);color:#fff;font:900 10px var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rizz3d-bag-hotbar,.rizz3d-bag-grid{display:grid;grid-template-columns:repeat(9,32px);gap:4px;margin:5px 0 9px}.rizz3d-bag-grid{grid-template-rows:repeat(3,32px)}
      .rizz3d-bag-slot{position:relative;width:32px;height:32px;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:rgba(12,15,26,.92);cursor:pointer}.rizz3d-bag-slot.is-selected{border-color:#ffd43b;box-shadow:0 0 0 2px rgba(255,212,59,.22)}.rizz3d-bag-slot em{position:absolute;left:3px;top:1px;color:rgba(255,255,255,.45);font:700 8px var(--font-mono);font-style:normal}.rizz3d-bag-slot b{position:absolute;right:3px;bottom:1px;color:#fff;font:800 9px var(--font-mono)}
      .rizz3d-damage{position:absolute;inset:-2%;z-index:4;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(255,54,54,0) 44%,rgba(255,40,40,.44) 100%);transition:opacity 80ms linear}
      @media (max-width:760px){.rizz3d-hotbar{grid-template-columns:repeat(9,32px);gap:3px}.rizz3d-slot{width:32px;height:32px}.rizz3d-chip{bottom:50px;font-size:9px;max-width:70%}.rizz3d-bag-button{left:auto;right:8px;height:32px}.rizz3d-bag-panel{right:8px;bottom:48px}}
    `;
    document.head.appendChild(style);
    const damage = document.createElement("div");
    damage.className = "rizz3d-damage";
    const crosshair = document.createElement("div");
    crosshair.className = "rizz3d-crosshair";
    const objective = document.createElement("div");
    objective.className = "rizz3d-chip";
    const target = document.createElement("div");
    target.className = "rizz3d-target";
    const progress = document.createElement("div");
    progress.className = "rizz3d-progress";
    progress.innerHTML = "<span></span>";
    const selectionCue = document.createElement("div");
    selectionCue.className = "rizz3d-selection-cue";
    const hotbar = document.createElement("div");
    hotbar.className = "rizz3d-hotbar";
    hotbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-slot]");
      if (button) setSelectedSlot(Number(button.dataset.slot));
    });
    const bagButton = document.createElement("button");
    bagButton.className = "rizz3d-bag-button";
    bagButton.type = "button";
    bagButton.addEventListener("click", () => toggleBag());
    const bagPanel = document.createElement("div");
    bagPanel.className = "rizz3d-bag-panel";
    bagPanel.addEventListener("click", (event) => {
      const hotbarButton = event.target.closest("[data-bag-hotbar]");
      if (hotbarButton) {
        setSelectedSlot(Number(hotbarButton.dataset.bagHotbar));
        return;
      }
      const bagButton = event.target.closest("[data-bag-slot]");
      if (bagButton) {
        swapBagSlotWithHotbar(Number(bagButton.dataset.bagSlot));
        updateHud();
      }
    });
    bagPanel.addEventListener("pointerover", (event) => {
      const button = event.target.closest("[data-item-name]");
      if (button) setBagHoverText(button.dataset.itemName);
    });
    bagPanel.addEventListener("focusin", (event) => {
      const button = event.target.closest("[data-item-name]");
      if (button) setBagHoverText(button.dataset.itemName);
    });
    bagPanel.addEventListener("pointerleave", () => setBagHoverText());
    wrap.append(damage, crosshair, objective, target, progress, selectionCue, hotbar, bagButton, bagPanel);
    return { damage, crosshair, objective, target, progress: progress.firstElementChild, selectionCue, hotbar, bagButton, bagPanel };
  }

  function resizeRenderer(force = false) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || canvas.width));
    const height = Math.max(220, Math.floor(rect.height || canvas.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && width === rendererWidth && height === rendererHeight && pixelRatio === rendererPixelRatio) return;
    rendererWidth = width;
    rendererHeight = height;
    rendererPixelRatio = pixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function initGame(seed) {
    state.started = false;
    state.paused = false;
    state.crafting = false;
    state.bagOpen = false;
    clearDirectionalInput();
    state.mining = null;
    state.mobs.forEach(removeMob);
    state.mobs = [];
    disposeGroup(effectGroup);
    state.fx = [];
    state.time = 0.21;
    state.day = 1;
    state.spawnTimer = 2;
    state.mined = 0;
    state.score = 0;
    state.high = api.getHighScore(GAME_ID) || 0;
    state.selected = 0;
    heldRenderCode = null;
    state.sigmaForged = false;
    state.swingTimer = 0;
    state.swingKind = "gather";
    state.attackFlash = 0;
    state.player.hurtAnim = 0;
    initHotbar();
    generateWorld(seed);
    spawnPlayer();
    giveItem(PICK_WOOD, 1);
    giveItem(SWORD_WOOD, 1);
    giveItem(TORCH, 8);
    if (craftPanel) craftPanel.classList.remove("is-open");
    updateHud();
  }
  function startGame() {
    if (state.started) return;
    state.started = true;
    state.paused = false;
    hideWorldPanel();
    if (overlay) overlay.classList.remove("overlay--show");
    state.bagOpen = false;
    renderBag();
    canvas.focus();
  }
  function restart() {
    openWorldManager();
  }
  function togglePause() {
    if (!state.started) return;
    state.paused = !state.paused;
    if (state.paused) {
      state.bagOpen = false;
      renderBag();
    }
    unlockPointer();
    if (overlay) {
      overlay.classList.toggle("overlay--show", state.paused);
      if (state.paused) {
        hideWorldPanel();
        document.getElementById("overlay-title").textContent = "Paused";
        document.getElementById("overlay-sub").innerHTML = "Press <b>P</b> or Resume to keep mining.";
        document.getElementById("overlay-score").innerHTML = "";
        document.getElementById("btn-primary").textContent = "Resume";
      } else {
        hideWorldPanel();
      }
    }
  }

  function snapshot() {
    return {
      seed: state.seed,
      worldId: currentWorldId,
      worldName: currentWorldName,
      edits: Array.from(state.edits.entries()).slice(0, 15000),
      player: { ...state.player },
      hotbar: state.hotbar.map((slot) => slot ? { ...slot } : null),
      bag: state.bag.map((slot) => slot ? { ...slot } : null),
      selected: state.selected,
      day: state.day,
      time: state.time,
      mined: state.mined,
      score: state.score,
      sigmaForged: state.sigmaForged,
    };
  }
  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || typeof data.seed !== "number") return;
    currentWorldId = currentWorldId || data.worldId || (saved.meta && saved.meta.id) || "";
    currentWorldName = currentWorldName || data.worldName || (saved.meta && saved.meta.name) || "World";
    currentWorldSeed = data.seed >>> 0;
    initGame(data.seed);
    state.edits = new Map(Array.isArray(data.edits) ? data.edits : []);
    for (const [key, code] of state.edits.entries()) {
      const [x, y, z] = key.split(",").map(Number);
      if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
    }
    for (let z = 0; z < WORLD_Z; z++) for (let x = 0; x < WORLD_X; x++) updateSurfaceColumn(x, z);
    if (data.player) {
      Object.assign(state.player, data.player);
      rescuePlayerFromSolid();
    }
    rebuildAllChunks();
    rebuildDecorations();
    if (Array.isArray(data.hotbar)) state.hotbar = data.hotbar.map((slot) => slot ? { ...slot } : null).slice(0, HOTBAR);
    while (state.hotbar.length < HOTBAR) state.hotbar.push(null);
    state.bag = Array.isArray(data.bag) ? data.bag.map((slot) => slot ? { ...slot } : null).slice(0, BAG_SLOTS) : Array.from({ length: BAG_SLOTS }, () => null);
    while (state.bag.length < BAG_SLOTS) state.bag.push(null);
    state.selected = Number(data.selected) || 0;
    state.day = Number(data.day) || 1;
    state.time = Number(data.time) || 0.21;
    state.mined = Number(data.mined) || 0;
    state.score = Number(data.score) || 0;
    state.sigmaForged = !!data.sigmaForged;
    if (ensureStarterPick(true)) api.toast("Wood Pickaxe added", "good");
    state.started = true;
    state.paused = false;
    state.bagOpen = false;
    heldRenderCode = null;
    hideWorldPanel();
    if (overlay) overlay.classList.remove("overlay--show");
    renderBag();
    syncCamera();
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = Math.min((ts - last) / 1000, 1 / 30);
    last = ts;
    resizeRenderer();
    updateActionAnimations(dt);
    updateFriendlies(dt);
    updateFx(dt);
    if (state.started && !state.paused && !state.crafting && !state.bagOpen) {
      updateTime(dt);
      updatePlayer(dt);
      updateVisibleChunks();
      updateMobs(dt);
      updateTarget();
      updateMining(dt);
      updatePlacing(dt);
      if (state.attackCd > 0) state.attackCd -= dt;
    }
    if (decorDirty) rebuildDecorations();
    updateLighting();
    updateHud();
    renderer.render(scene, camera);
  }

  function bindInput() {
    window.addEventListener("keydown", (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      const movementHandled = setKeyboardMove(key, true);
      if (key === " " || key === "spacebar") state.input.jump = true;
      if (key === "shift") state.input.sprint = true;
      if (key >= "1" && key <= "9") setSelectedSlot(Number(key) - 1);
      if (key === "e") toggleCrafting();
      if (key === "b") toggleBag();
      if (key === "p") togglePause();
      if (movementHandled || [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      setKeyboardMove(key, false);
      if (key === " " || key === "spacebar") state.input.jump = false;
      if (key === "shift") state.input.sprint = false;
    });
    window.addEventListener("blur", clearDirectionalInput);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearDirectionalInput(); });
    canvas.addEventListener("click", () => {
      if (state.started && !state.paused && !state.crafting && !state.bagOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    canvas.addEventListener("mousedown", (event) => {
      if (!state.started || state.paused || state.crafting || state.bagOpen) return;
      canvas.focus();
      if (event.button === 2) {
        state.input.place = true;
        state.placeQueued = true;
      }
      else if (!selectedIsBlock()) {
        state.input.mine = true;
        triggerHeldSwing("gather");
      }
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 2) state.input.place = false;
      else state.input.mine = false;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      setSelectedSlot((state.selected + (event.deltaY > 0 ? 1 : -1) + HOTBAR) % HOTBAR);
    }, { passive: false });
    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== canvas || state.paused || state.crafting) return;
      state.player.yaw -= event.movementX * 0.0022;
      state.player.pitch = clamp(state.player.pitch - event.movementY * 0.0022, -1.45, 1.45);
    });
  }
  function unlockPointer() {
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }
  function bindButtons() {
    const primary = document.getElementById("btn-primary");
    if (primary) primary.addEventListener("click", () => {
      if (state.paused) togglePause();
      else if (!state.started) createWorld("New World", "");
    });
    bind("btn-pause", togglePause);
    bind("btn-restart", restart);
    bind("btn-craft", () => toggleCrafting());
    bind("btn-craft-close", () => toggleCrafting(false));
    bind("btn-mine", () => { state.mode = "mine"; updateModeButtons(); });
    bind("btn-place", () => { state.mode = "place"; updateModeButtons(); });
    bindHold("btn-left", () => { moveSources.touch.right = -1; applyDirectionalInput(); }, () => { if (moveSources.touch.right < 0) { moveSources.touch.right = 0; applyDirectionalInput(); } });
    bindHold("btn-right", () => { moveSources.touch.right = 1; applyDirectionalInput(); }, () => { if (moveSources.touch.right > 0) { moveSources.touch.right = 0; applyDirectionalInput(); } });
    bindHold("btn-jump", () => { state.input.jump = true; }, () => { state.input.jump = false; });
    bind("btn-heal", async () => {
      if (!state.started) return api.toast("Start the game first", "");
      const ok = api.isAdFree() || await api.showRewarded();
      if (ok) {
        state.player.hp = MAX_HP;
        giveItem(TORCH, 16);
        api.toast("Full heal + 16 torches", "good");
      }
    });
    bind("btn-kit", async () => {
      if (!state.started) return api.toast("Start the game first", "");
      const ok = api.isAdFree() || await api.showRewarded();
      if (ok) {
        giveItem(PICK_STONE, 1);
        giveItem(SWORD_STONE, 1);
        giveItem(TABLE, 1);
        api.toast("Stone kit + Crafting Toilet", "good");
      }
    });
    bindFullscreen();
  }
  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el && fn) el.addEventListener("click", fn);
  }
  function bindHold(id, down, up) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (event) => { event.preventDefault(); down(); };
    const off = (event) => { event.preventDefault(); up(); };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  }
  function updateModeButtons() {
    const mine = document.getElementById("btn-mine");
    const place = document.getElementById("btn-place");
    if (mine) mine.classList.toggle("is-active", state.mode === "mine");
    if (place) place.classList.toggle("is-active", state.mode === "place");
    state.input.mine = state.mode === "mine" && state.input.mine;
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap");
    if (!fsBtn || !fsTarget) return;
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const updateButton = () => {
      const on = isMaxed();
      fsBtn.textContent = on ? "×" : "⛶";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", on ? "Exit" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateButton();
      requestAnimationFrame(() => {
        resizeRenderer(true);
        if (on) canvas.focus();
      });
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
    fsBtn.addEventListener("click", toggle);
    const onNativeFsChange = () => { if (!nativeFsEl() && isMaxed()) setMaxed(false); };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
    });
    updateButton();
  }
  function findBlock(code, minY = 0, maxY = WORLD_Y - 1) {
    for (let y = clamp(minY, 0, WORLD_Y - 1); y <= clamp(maxY, 0, WORLD_Y - 1); y++) {
      for (let z = 1; z < WORLD_Z - 1; z++) {
        for (let x = 1; x < WORLD_X - 1; x++) {
          if (getBlock(x, y, z) === code) return { x, y, z };
        }
      }
    }
    return null;
  }
  function teleportTo(x, y, z) {
    Object.assign(state.player, { x: x + 0.5, y: y + 1.05, z: z + 0.5, vx: 0, vy: 0, vz: 0, onGround: false, hurtCd: 0 });
    updateVisibleChunks(true);
    decorDirty = true;
    syncCamera();
  }

  initGame();
  migrateLegacyWorld();
  bindInput();
  bindButtons();
  updateModeButtons();
  resizeRenderer();
  raf = requestAnimationFrame(loop);
  setWorldOverlay();
  worldAutosaveTimer = setInterval(() => {
    if (state.started && !state.paused) saveCurrentWorld();
  }, 2500);
  window.addEventListener("beforeunload", () => {
    if (state.started) saveCurrentWorld();
    if (worldAutosaveTimer) clearInterval(worldAutosaveTimer);
  });

  window.addEventListener("resize", resizeRenderer);
  window.__RIZZ = {
    state,
    DEF,
    RECIPES,
    startGame,
    restart,
    giveItem,
    createWorld,
    loadWorld,
    readWorldIndex,
    saveCurrentWorld,
    spawnMob,
    generateWorld,
    rebuildAllChunks,
    updateVisibleChunks,
    getBlock,
    setBlock,
    flowWaterNear,
    flowLavaNear,
    spreadLavaFrom,
    flowLiquidsNear,
    heldAttackDamage,
    triggerHeldSwing,
    damageMob,
    spawnBlockBurst,
    spawnFriendlies,
    findBlock,
    teleportTo,
    edgeOceanStrength,
    movementVectorForYaw,
    movementVectorForCamera,
    resizeRenderer,
    daylight,
    isNight,
    debugInfo() {
      return {
        worldX: WORLD_X,
        worldY: WORLD_Y,
        worldZ: WORLD_Z,
        seaLevel: SEA_LEVEL,
        lavaLevel: LAVA_LEVEL,
        daySeconds: DAY_SECONDS,
        edgeOcean: EDGE_OCEAN,
        renderRadiusChunks: RENDER_RADIUS_CHUNKS,
        visibleChunkCount: state.visibleChunkCount,
        friendlyCount: state.friendlies.length,
        movingFriendlies: state.friendlies.filter((friendly) => friendlyMovingAction(friendly.action)).length,
        worldId: currentWorldId,
        worldName: currentWorldName,
        worldSeed: currentWorldSeed >>> 0,
        worldCount: readWorldIndex().length,
        friendlyActions: state.friendlies.reduce((counts, friendly) => {
          counts[friendly.action] = (counts[friendly.action] || 0) + 1;
          return counts;
        }, {}),
        bagSlots: state.bag.length,
        bagUsed: state.bag.filter(Boolean).length,
        fxCount: state.fx.length,
        swingTimer: state.swingTimer,
        playerHurtAnim: state.player.hurtAnim,
        sunVisible: !!(sunDisk && sunDisk.visible),
        sunOpacity: sunDisk ? sunDisk.material.opacity : 0,
        moonVisible: !!(moonDisk && moonDisk.visible),
        moonOpacity: moonDisk ? moonDisk.material.opacity : 0,
      };
    },
    setTime(t) { state.time = t; },
    teleportSpawn() { spawnPlayer(); },
  };
})();
