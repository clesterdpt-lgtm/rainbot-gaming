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
  const SAVE_VERSION = 3;
  const WORLD_X = 96;
  const WORLD_Y = 48;
  const WORLD_Z = 96;
  const CHUNK = 16;
  const SEA_LEVEL = 12;
  const HOTBAR = 9;
  const MAX_HP = 20;
  const PLAYER_RADIUS = 0.32;
  const PLAYER_HEIGHT = 1.75;
  const EYE_HEIGHT = 1.55;
  const GRAVITY = 28;
  const MOVE_SPEED = 5.3;
  const SPRINT_SPEED = 7.2;
  const JUMP_SPEED = 8.6;
  const REACH = 6.1;
  const DAY_SECONDS = 150;

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

  const DEF = {};
  function def(code, d) {
    d.code = code;
    d.rgb = hexToRgb(d.color || "#ffffff");
    DEF[code] = d;
  }

  def(AIR, { name: "Air", kind: "air", solid: false, color: "#000000" });
  def(GRASS, { name: "Grass", kind: "block", solid: true, hardness: 0.45, drop: DIRT, color: "#5fcf58", side: "#7a5732" });
  def(DIRT, { name: "Dirt", kind: "block", solid: true, hardness: 0.45, color: "#80542f" });
  def(STONE, { name: "Ohio Stone", kind: "block", solid: true, hardness: 1.25, needTool: "pick", drop: STONE, color: "#868894" });
  def(BEDROCK, { name: "Bedrock", kind: "block", solid: true, hardness: Infinity, color: "#262630" });
  def(LOG, { name: "Skibidi Log", kind: "block", solid: true, hardness: 0.85, best: "axe", color: "#78502f" });
  def(LEAVES, { name: "Brainrot Leaves", kind: "block", solid: true, hardness: 0.2, drop: null, color: "#3da34a", transparent: true });
  def(PLANKS, { name: "Toilet Planks", kind: "block", solid: true, hardness: 0.55, best: "axe", color: "#b98245" });
  def(TABLE, { name: "Crafting Toilet", kind: "block", solid: true, hardness: 0.75, best: "axe", color: "#d7e1e8" });
  def(COAL_ORE, { name: "Gyatt Coal Ore", kind: "block", solid: true, hardness: 1.55, needTool: "pick", drop: COAL, color: "#6f707b", ore: "#22232b" });
  def(RIZZ_ORE, { name: "Rizz Ore", kind: "block", solid: true, hardness: 1.8, needTool: "pick", drop: RIZZ, color: "#777985", ore: "#ffcf3a" });
  def(SIGMA_ORE, { name: "Sigma Ore", kind: "block", solid: true, hardness: 2.45, needTool: "pick", needTier: 2, drop: SIGMA, color: "#767987", ore: "#4beaff" });
  def(TORCH, { name: "Rizz Torch", kind: "block", solid: false, hardness: 0.05, drop: TORCH, light: 1, color: "#ffd75a", decor: true });
  def(WATER, { name: "Rizzwater", kind: "block", solid: false, hardness: Infinity, drop: null, color: "#2f8fe8", transparent: true, liquid: true });
  def(TALL_GRASS, { name: "Tall Grass", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#76d06a", decor: true });
  def(FLOWER, { name: "Rizz Bloom", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#ff6fa8", decor: true });
  def(SAND, { name: "Ohio Sand", kind: "block", solid: true, hardness: 0.45, color: "#d8c073" });

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
    { id: 0, name: "Meadow", grass: "#63d45d", tree: 0.12, flowers: 0.08 },
    { id: 1, name: "Forest", grass: "#3fae46", tree: 0.31, flowers: 0.03 },
    { id: 2, name: "Highland", grass: "#84bd56", tree: 0.07, flowers: 0.02 },
    { id: 3, name: "Marsh", grass: "#4fa866", tree: 0.15, flowers: 0.05 },
    { id: 4, name: "Neon Grove", grass: "#42d998", tree: 0.22, flowers: 0.16 },
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
  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 420);
  camera.rotation.order = "YXZ";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const worldGroup = new THREE.Group();
  const waterGroup = new THREE.Group();
  const decorGroup = new THREE.Group();
  const mobGroup = new THREE.Group();
  const cloudGroup = new THREE.Group();
  scene.add(worldGroup, waterGroup, decorGroup, mobGroup, cloudGroup);

  const ambient = new THREE.HemisphereLight(0xbfe5ff, 0x2f271d, 0.85);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(36, 70, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(ambient, sun);

  const blockMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const plantMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, alphaTest: 0.2 });
  const waterMaterial = new THREE.MeshPhongMaterial({
    color: 0x2f8fe8,
    transparent: true,
    opacity: 0.58,
    shininess: 70,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const enemyMaterials = {
    porcelain: new THREE.MeshLambertMaterial({ color: 0xe8edf1 }),
    porcelainDark: new THREE.MeshLambertMaterial({ color: 0xaeb8c3 }),
    black: new THREE.MeshLambertMaterial({ color: 0x070913 }),
    red: new THREE.MeshLambertMaterial({ color: 0xb8233a }),
    purple: new THREE.MeshLambertMaterial({ color: 0x7842a1 }),
    cyan: new THREE.MeshLambertMaterial({ color: 0x43e6ff }),
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
    },
    input: { forward: 0, right: 0, jump: false, mine: false, place: false, sprint: false },
    mobs: [],
    hotbar: [],
    selected: 0,
    target: null,
    mining: null,
    attackCd: 0,
    placeCd: 0,
    day: 1,
    time: 0.21,
    spawnTimer: 2,
    mined: 0,
    score: 0,
    high: 0,
    sigmaForged: false,
    mode: "mine",
  };

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: SAVE_VERSION });

  const ui = buildHud();
  const overlay = document.getElementById("overlay");
  const craftPanel = document.getElementById("craft-panel");
  const craftList = document.getElementById("craft-list");
  let last = 0;
  let raf = 0;
  let decorDirty = true;
  let cloudsBuilt = false;
  const reusableVector = new THREE.Vector3();

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function index(x, y, z) { return (y * WORLD_Z + z) * WORLD_X + x; }
  function surfaceIndex(x, z) { return z * WORLD_X + x; }
  function inWorld(x, y, z) { return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z; }
  function isPlaceable(code) { return code > AIR && DEF[code] && DEF[code].kind === "block" && code !== WATER && code !== TALL_GRASS && code !== FLOWER; }
  function maxStack(code) { return (DEF[code] && DEF[code].stack) || 99; }

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
    if (DEF[prev].decor || DEF[code].decor || prev === WATER || code === WATER) decorDirty = true;
  }
  function isSolidBlock(code) { return !!(DEF[code] && DEF[code].solid); }
  function occludes(code) { return code !== AIR && code !== WATER && code !== TORCH && code !== TALL_GRASS && code !== FLOWER; }

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
        const continent = fbm2(x + 1200, z - 500, 0.019, 5);
        const detail = fbm2(x - 900, z + 700, 0.075, 4);
        const ridges = Math.abs(fbm2(x + 20, z + 20, 0.035, 3) - 0.5) * 2;
        let h = SEA_LEVEL + 8 + (continent - 0.48) * 25 + (detail - 0.5) * 8 + ridges * 5;
        const spawnBlend = clamp(1 - center / 14, 0, 1);
        h = lerp(h, SEA_LEVEL + 7 + Math.sin(x * 0.22) * 0.7 + Math.cos(z * 0.19) * 0.7, spawnBlend);
        const height = clamp(Math.round(h), 4, WORLD_Y - 8);
        const moisture = fbm2(x - 300, z + 300, 0.027, 3);
        const weird = fbm2(x + 700, z + 80, 0.02, 4);
        let biome = 0;
        if (height > SEA_LEVEL + 15) biome = 2;
        else if (moisture > 0.62 && height <= SEA_LEVEL + 5) biome = 3;
        else if (weird > 0.68) biome = 4;
        else if (moisture > 0.52) biome = 1;
        state.biome[surfaceIndex(x, z)] = biome;
        state.surface[surfaceIndex(x, z)] = height;
      }
    }

    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const height = state.surface[surfaceIndex(x, z)];
        const biome = state.biome[surfaceIndex(x, z)];
        for (let y = 0; y < WORLD_Y; y++) {
          let code = AIR;
          if (y === 0) code = BEDROCK;
          else if (y > height) code = y <= SEA_LEVEL ? WATER : AIR;
          else {
            const depth = height - y;
            const shoreline = height <= SEA_LEVEL + 1 || biome === 3;
            if (depth === 0) code = shoreline ? SAND : GRASS;
            else if (depth < 4) code = shoreline ? SAND : DIRT;
            else code = STONE;

            if (code === STONE && y > 3 && y < height - 4) {
              const cave = noise3(x + 400, y * 1.35, z - 200, 0.08);
              const tunnel = noise3(x - 700, y * 1.8, z + 300, 0.045);
              if (cave > 0.72 || (tunnel > 0.63 && y < WORLD_Y - 10)) code = AIR;
              else {
                const r = hash3(x, y, z);
                if (y < height - 6 && r < 0.035) code = COAL_ORE;
                if (y < 25 && r >= 0.035 && r < 0.055) code = RIZZ_ORE;
                if (y < 15 && r >= 0.055 && r < 0.064) code = SIGMA_ORE;
              }
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
  }

  function growTreesAndDetails() {
    for (let z = 2; z < WORLD_Z - 2; z++) {
      for (let x = 2; x < WORLD_X - 2; x++) {
        const si = surfaceIndex(x, z);
        const y = state.surface[si];
        const top = getBlock(x, y, z);
        if (top !== GRASS) continue;
        const biome = BIOMES[state.biome[si]];
        const spawnDist = Math.hypot(x - WORLD_X / 2, z - WORLD_Z / 2);
        const r = hash2(x * 17 + 3, z * 19 - 5);
        if (spawnDist > 8 && r < biome.tree) {
          placeTree(x, y + 1, z, state.biome[si]);
        } else if (r < biome.tree + 0.17) {
          setBase(x, y + 1, z, r < biome.tree + biome.flowers ? FLOWER : TALL_GRASS);
        }
      }
    }
  }
  function placeTree(x, y, z, biomeId) {
    const trunkH = 4 + Math.floor(hash2(x + 41, z - 83) * 3);
    for (let i = 0; i < trunkH && y + i < WORLD_Y - 1; i++) setBase(x, y + i, z, LOG);
    const top = y + trunkH;
    const radius = biomeId === 4 ? 3 : 2;
    for (let oy = -2; oy <= 2; oy++) {
      for (let oz = -radius; oz <= radius; oz++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const d = Math.abs(ox) + Math.abs(oz) + Math.max(0, oy);
          if (d > radius + 1 || hash3(x + ox, top + oy, z + oz) < 0.08) continue;
          const lx = x + ox;
          const ly = top + oy;
          const lz = z + oz;
          if (inWorld(lx, ly, lz) && getBlock(lx, ly, lz) === AIR) setBase(lx, ly, lz, LEAVES);
        }
      }
    }
  }
  function carveSpawnMeadow() {
    const cx = WORLD_X >> 1;
    const cz = WORLD_Z >> 1;
    for (let z = cz - 5; z <= cz + 5; z++) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        if (!inWorld(x, 1, z)) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (d > 5.5) continue;
        const h = SEA_LEVEL + 7 + Math.round(Math.sin(x * 0.3) * 0.4 + Math.cos(z * 0.3) * 0.4);
        for (let y = 1; y < WORLD_Y; y++) {
          let code = AIR;
          if (y < h - 3) code = STONE;
          else if (y < h) code = DIRT;
          else if (y === h) code = GRASS;
          setBase(x, y, z, code);
        }
        state.surface[surfaceIndex(x, z)] = h;
      }
    }
    placeTree(cx + 5, state.surface[surfaceIndex(cx + 5, cz + 3)] + 1, cz + 3, 1);
  }
  function setBase(x, y, z, code) {
    if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
  }
  function updateSurfaceColumn(x, z) {
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return;
    let y = WORLD_Y - 1;
    while (y > 0) {
      const code = getBlock(x, y, z);
      if (code !== AIR && code !== WATER && code !== TALL_GRASS && code !== FLOWER && code !== TORCH) break;
      y--;
    }
    state.surface[surfaceIndex(x, z)] = y;
  }

  function rebuildAllChunks() {
    disposeGroup(worldGroup);
    disposeGroup(waterGroup);
    state.chunks.clear();
    for (let cz = 0; cz < WORLD_Z / CHUNK; cz++) {
      for (let cx = 0; cx < WORLD_X / CHUNK; cx++) rebuildChunk(cx, cz);
    }
  }
  function rebuildChunksNear(x, z) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || x % CHUNK === 0 || x % CHUNK === CHUNK - 1 || z % CHUNK === 0 || z % CHUNK === CHUNK - 1) {
          rebuildChunk(cx + dx, cz + dz);
        }
      }
    }
  }
  function rebuildChunk(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= WORLD_X / CHUNK || cz >= WORLD_Z / CHUNK) return;
    const key = `${cx},${cz}`;
    const old = state.chunks.get(key);
    if (old) {
      if (old.mesh) { worldGroup.remove(old.mesh); disposeMesh(old.mesh); }
      if (old.water) { waterGroup.remove(old.water); disposeMesh(old.water); }
    }
    const solid = makeGeometryArrays();
    const water = makeGeometryArrays();
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < WORLD_Y; y++) {
        for (let x = x0; x < x0 + CHUNK; x++) {
          const code = getBlock(x, y, z);
          if (code === AIR || DEF[code].decor) continue;
          const arr = code === WATER ? water : solid;
          for (const face of FACES) {
            const nx = x + face.n[0];
            const ny = y + face.n[1];
            const nz = z + face.n[2];
            const neighbor = getBlock(nx, ny, nz);
            const visible = code === WATER ? neighbor !== WATER && neighbor !== BEDROCK : !occludes(neighbor);
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
    state.chunks.set(key, entry);
  }
  function makeGeometryArrays() {
    return { positions: [], normals: [], colors: [], indices: [] };
  }
  function pushFace(arr, x, y, z, code, face) {
    const start = arr.positions.length / 3;
    const rgb = faceColor(code, face.shade, x, y, z, face.n[1] > 0);
    for (const c of face.c) {
      arr.positions.push(x + c[0], y + c[1], z + c[2]);
      arr.normals.push(face.n[0], face.n[1], face.n[2]);
      arr.colors.push(rgb[0], rgb[1], rgb[2]);
    }
    arr.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function faceColor(code, shade, x, y, z, topFace) {
    const d = DEF[code];
    let base = d.rgb;
    if (code === GRASS && !topFace) base = hexToRgb(d.side);
    if ((code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE) && hash3(x, y, z) < 0.36) base = hexToRgb(d.ore);
    if (code === LEAVES) {
      const b = BIOMES[state.biome[surfaceIndex(clamp(x, 0, WORLD_X - 1), clamp(z, 0, WORLD_Z - 1))]];
      base = hexToRgb(b.id === 4 ? "#33dda4" : b.grass);
    }
    const jitter = 0.89 + hash3(x + 11, y - 7, z + 3) * 0.18;
    const f = shade * jitter;
    return [base[0] * f, base[1] * f, base[2] * f];
  }
  function buildMesh(arr, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(arr.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(arr.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(arr.colors, 3));
    geometry.setIndex(arr.indices);
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  function rebuildDecorations() {
    disposeGroup(decorGroup);
    const arr = makeGeometryArrays();
    for (let z = 0; z < WORLD_Z; z++) {
      for (let y = 1; y < WORLD_Y; y++) {
        for (let x = 0; x < WORLD_X; x++) {
          const code = getBlock(x, y, z);
          if (code === TALL_GRASS || code === FLOWER) pushPlant(arr, x, y, z, code);
          if (code === TORCH) pushTorch(arr, x, y, z);
        }
      }
    }
    if (arr.positions.length) decorGroup.add(buildMesh(arr, plantMaterial));
    decorDirty = false;
  }
  function pushPlant(arr, x, y, z, code) {
    const h = code === FLOWER ? 0.64 : 0.78;
    const w = code === FLOWER ? 0.33 : 0.42;
    const color = code === FLOWER ? hexToRgb(hash2(x, z) > 0.5 ? "#ff6fa8" : "#ffe45c") : hexToRgb("#72d168");
    pushBillboard(arr, x + 0.5, y, z + 0.5, w, h, color, 0);
    pushBillboard(arr, x + 0.5, y, z + 0.5, w, h, color, Math.PI / 2);
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

  function buildClouds() {
    if (cloudsBuilt) return;
    cloudsBuilt = true;
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.76 });
    const box = new THREE.BoxBufferGeometry(1, 1, 1);
    for (let i = 0; i < 14; i++) {
      const group = new THREE.Group();
      const count = 4 + Math.floor(hash2(i, 3) * 5);
      for (let j = 0; j < count; j++) {
        const puff = new THREE.Mesh(box, material);
        puff.scale.set(3 + hash2(i, j) * 5, 0.45 + hash2(j, i) * 0.7, 2 + hash2(i + 7, j) * 3);
        puff.position.set(j * 3.2, hash2(i, j + 9) * 0.5, hash2(j + 10, i) * 4);
        group.add(puff);
      }
      group.position.set(hash2(i, 1) * WORLD_X, 36 + hash2(i, 2) * 7, hash2(i, 4) * WORLD_Z);
      cloudGroup.add(group);
    }
  }
  function buildStars() {
    const positions = [];
    for (let i = 0; i < 420; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const r = 95 + hash2(i, 2) * 80;
      const y = 55 + hash2(i, 3) * 85;
      positions.push(Math.cos(a) * r + WORLD_X / 2, y, Math.sin(a) * r + WORLD_Z / 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0 });
    const stars = new THREE.Points(geometry, material);
    stars.name = "stars";
    scene.add(stars);
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
    });
  }

  function spawnPlayer() {
    const x = WORLD_X / 2 + 0.5;
    const z = WORLD_Z / 2 + 0.5;
    const y = state.surface[surfaceIndex(Math.floor(x), Math.floor(z))] + 1.05;
    Object.assign(state.player, { x, y, z, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 4, pitch: -0.12, onGround: false, hp: MAX_HP, hurtCd: 0 });
    syncCamera();
  }
  function syncCamera() {
    const p = state.player;
    camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
  }

  function initHotbar() {
    state.hotbar = Array.from({ length: HOTBAR }, () => null);
  }
  function giveItem(code, n = 1) {
    if (!code || n <= 0) return;
    const cap = maxStack(code);
    for (const slot of state.hotbar) {
      if (slot && slot.code === code && slot.n < cap) {
        const add = Math.min(n, cap - slot.n);
        slot.n += add;
        n -= add;
        if (n <= 0) return;
      }
    }
    for (let i = 0; i < state.hotbar.length && n > 0; i++) {
      if (!state.hotbar[i]) {
        const add = Math.min(n, cap);
        state.hotbar[i] = { code, n: add };
        n -= add;
      }
    }
  }
  function countItem(code) {
    return state.hotbar.reduce((sum, slot) => sum + (slot && slot.code === code ? slot.n : 0), 0);
  }
  function takeItem(code, n) {
    for (let i = 0; i < state.hotbar.length && n > 0; i++) {
      const slot = state.hotbar[i];
      if (!slot || slot.code !== code) continue;
      const take = Math.min(n, slot.n);
      slot.n -= take;
      n -= take;
      if (slot.n <= 0) state.hotbar[i] = null;
    }
  }
  function selectedSlot() { return state.hotbar[state.selected]; }
  function selectedTool() {
    const slot = selectedSlot();
    return slot && DEF[slot.code] && DEF[slot.code].tool ? DEF[slot.code].tool : null;
  }

  function updatePlayer(dt) {
    const p = state.player;
    const forward = state.input.forward;
    const right = state.input.right;
    const speed = state.input.sprint ? SPRINT_SPEED : MOVE_SPEED;
    const move = movementVectorForYaw(p.yaw, forward, right);
    let mx = move.x;
    let mz = move.z;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    p.vx = mx * speed;
    p.vz = mz * speed;
    if (state.input.jump && p.onGround) {
      p.vy = JUMP_SPEED;
      p.onGround = false;
    }
    p.vy -= GRAVITY * dt;
    p.vy = Math.max(p.vy, -32);
    movePlayerAxis("x", p.vx * dt);
    movePlayerAxis("z", p.vz * dt);
    movePlayerAxis("y", p.vy * dt);
    p.x = clamp(p.x, 1.5, WORLD_X - 1.5);
    p.z = clamp(p.z, 1.5, WORLD_Z - 1.5);
    if (p.y < 1) hurtPlayer(4);
    if (p.hurtCd > 0) p.hurtCd -= dt;
    syncCamera();
  }
  function movementVectorForYaw(yaw, forward, right) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return {
      x: forward * -sin + right * cos,
      z: forward * -cos + right * -sin,
    };
  }
  function movePlayerAxis(axis, amount) {
    if (amount === 0) return;
    const p = state.player;
    p[axis] += amount;
    const box = playerBox();
    if (boxCollides(box)) {
      const dir = Math.sign(amount);
      if (axis === "y") {
        if (dir < 0) p.onGround = true;
        p.vy = 0;
      }
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
  function hurtPlayer(dmg) {
    const p = state.player;
    if (p.hurtCd > 0) return;
    p.hp -= dmg;
    p.hurtCd = 0.75;
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
    toilet: { hp: 9, speed: 2.3, damage: 3, score: 15, radius: 0.55 },
    grimace: { hp: 17, speed: 1.55, damage: 5, score: 30, radius: 0.7 },
  };
  function spawnMob() {
    if (state.mobs.length >= Math.min(6 + state.day * 2, 18)) return;
    const p = state.player;
    for (let tries = 0; tries < 20; tries++) {
      const angle = hash2(tries, state.day * 11) * Math.PI * 2;
      const dist = 14 + hash2(tries, state.day * 7) * 18;
      const x = clamp(Math.round(p.x + Math.cos(angle) * dist), 2, WORLD_X - 3);
      const z = clamp(Math.round(p.z + Math.sin(angle) * dist), 2, WORLD_Z - 3);
      const y = state.surface[surfaceIndex(x, z)] + 1;
      if (y <= SEA_LEVEL || torchLightAt(x, y, z) > 0.2) continue;
      const type = state.day > 1 && hash2(x + 8, z - 6) > 0.7 ? "grimace" : "toilet";
      const mob = { type, x: x + 0.5, y, z: z + 0.5, hp: MOB[type].hp, hitCd: 0, mesh: createMobMesh(type) };
      mob.mesh.position.set(mob.x, mob.y, mob.z);
      mobGroup.add(mob.mesh);
      state.mobs.push(mob);
      return;
    }
  }
  function createMobMesh(type) {
    const group = new THREE.Group();
    if (type === "toilet") {
      addBox(group, [0, 0.35, 0], [0.9, 0.7, 0.75], enemyMaterials.porcelain);
      addBox(group, [0, 0.88, -0.1], [0.74, 0.38, 0.24], enemyMaterials.porcelainDark);
      addBox(group, [-0.18, 0.95, -0.24], [0.09, 0.09, 0.04], enemyMaterials.black);
      addBox(group, [0.18, 0.95, -0.24], [0.09, 0.09, 0.04], enemyMaterials.black);
      addBox(group, [0, 0.74, -0.38], [0.34, 0.06, 0.05], enemyMaterials.red);
    } else {
      addBox(group, [0, 0.5, 0], [1.05, 1.05, 0.92], enemyMaterials.purple);
      addBox(group, [-0.22, 0.74, -0.45], [0.16, 0.16, 0.04], enemyMaterials.cyan);
      addBox(group, [0.22, 0.74, -0.45], [0.16, 0.16, 0.04], enemyMaterials.cyan);
      addBox(group, [0, 0.42, -0.48], [0.34, 0.07, 0.05], enemyMaterials.black);
    }
    group.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
    return group;
  }
  function addBox(group, pos, scale, material) {
    const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    group.add(mesh);
  }
  function updateMobs(dt) {
    const p = state.player;
    for (let i = state.mobs.length - 1; i >= 0; i--) {
      const mob = state.mobs[i];
      const cfg = MOB[mob.type];
      const dx = p.x - mob.x;
      const dz = p.z - mob.z;
      const dist = Math.hypot(dx, dz) || 1;
      mob.x += (dx / dist) * cfg.speed * dt;
      mob.z += (dz / dist) * cfg.speed * dt;
      mob.x = clamp(mob.x, 1, WORLD_X - 1);
      mob.z = clamp(mob.z, 1, WORLD_Z - 1);
      mob.y = groundYAt(mob.x, mob.z) + 1;
      mob.mesh.position.set(mob.x, mob.y, mob.z);
      mob.mesh.rotation.y = Math.atan2(dx, dz);
      mob.mesh.position.y += Math.sin(performance.now() / 160 + i) * 0.04;
      if (mob.hitCd > 0) mob.hitCd -= dt;
      if (dist < 1.25 && Math.abs((p.y + 0.5) - mob.y) < 1.8 && mob.hitCd <= 0) {
        hurtPlayer(cfg.damage);
        mob.hitCd = 1;
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
  function removeMob(mob) {
    mobGroup.remove(mob.mesh);
    disposeMesh(mob.mesh);
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
    state.target = raycastBlocks(REACH);
    selectionBox.visible = !!(state.target && state.target.hit);
    if (selectionBox.visible) {
      selectionBox.position.set(state.target.x + 0.5, state.target.y + 0.5, state.target.z + 0.5);
      ui.target.textContent = `${DEF[getBlock(state.target.x, state.target.y, state.target.z)].name}`;
    } else {
      ui.target.textContent = "";
    }
  }
  function raycastBlocks(maxDist) {
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let prev = null;
    for (let t = 0; t <= maxDist; t += 0.045) {
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
    if (tryAttack()) return;
    const t = state.target;
    if (!t || !t.hit) {
      state.mining = null;
      return;
    }
    const code = getBlock(t.x, t.y, t.z);
    if (code === BEDROCK || code === WATER) return;
    const need = breakTimeFor(code);
    if (!state.mining || state.mining.x !== t.x || state.mining.y !== t.y || state.mining.z !== t.z) {
      state.mining = { x: t.x, y: t.y, z: t.z, progress: 0, need };
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
    setBlock(x, y, z, AIR);
    state.mined++;
    addScore(1);
    if (d.drop !== null && canDrop(code)) giveItem(d.drop === undefined ? code : d.drop, 1);
    api.toast(`Mined ${d.name}`, "");
  }
  function updatePlacing(dt) {
    if (state.placeCd > 0) state.placeCd -= dt;
    if (!state.input.place || state.placeCd > 0 || state.crafting || state.paused) return;
    const t = state.target;
    const slot = selectedSlot();
    if (!t || !t.hit || !t.prev || !slot || !isPlaceable(slot.code)) return;
    const p = t.prev;
    if (getBlock(p.x, p.y, p.z) !== AIR && getBlock(p.x, p.y, p.z) !== WATER) return;
    if (boxContainsBlock(playerBox(), p.x, p.y, p.z)) return;
    setBlock(p.x, p.y, p.z, slot.code);
    slot.n--;
    if (slot.n <= 0) state.hotbar[state.selected] = null;
    state.placeCd = 0.18;
    state.input.place = false;
  }
  function boxContainsBlock(b, x, y, z) {
    return x + 1 > b.minX && x < b.maxX && y + 1 > b.minY && y < b.maxY && z + 1 > b.minZ && z < b.maxZ;
  }
  function tryAttack() {
    if (state.attackCd > 0) return false;
    const dir = reusableVector;
    camera.getWorldDirection(dir);
    const origin = camera.position;
    let hit = null;
    let best = 5.4;
    for (const mob of state.mobs) {
      const cx = mob.x;
      const cy = mob.y + 0.6;
      const cz = mob.z;
      const vx = cx - origin.x;
      const vy = cy - origin.y;
      const vz = cz - origin.z;
      const along = vx * dir.x + vy * dir.y + vz * dir.z;
      if (along < 0 || along > 5.4) continue;
      const px = origin.x + dir.x * along;
      const py = origin.y + dir.y * along;
      const pz = origin.z + dir.z * along;
      const off = Math.hypot(cx - px, cy - py, cz - pz);
      if (off < MOB[mob.type].radius && along < best) {
        best = along;
        hit = mob;
      }
    }
    if (!hit) return false;
    const tool = selectedTool();
    hit.hp -= tool && tool.type === "sword" ? tool.damage : 1;
    state.attackCd = 0.32;
    api.toast(`Hit ${hit.type === "toilet" ? "Skibidi Toilet" : "Grimace Shake"}`, "");
    return true;
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
    const sky = new THREE.Color(0x10152d).lerp(new THREE.Color(0x79c7ff), d);
    const fog = new THREE.Color(0x14172f).lerp(new THREE.Color(0x9fd5ff), d);
    scene.background = sky;
    scene.fog = new THREE.FogExp2(fog, lerp(0.029, 0.0065, d));
    ambient.intensity = lerp(0.18, 0.9, d);
    sun.intensity = lerp(0.1, 1.2, d);
    const a = state.time * Math.PI * 2;
    sun.position.set(Math.cos(a) * 65, Math.sin(a) * 70 + 18, Math.sin(a * 0.7) * 46);
    const stars = scene.getObjectByName("stars");
    if (stars) stars.material.opacity = clamp((0.38 - d) / 0.38, 0, 1);
    cloudGroup.children.forEach((cloud, i) => {
      cloud.position.x += 0.006 + i * 0.0002;
      if (cloud.position.x > WORLD_X + 20) cloud.position.x = -20;
    });
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
    ui.objective.textContent = `${BIOMES[state.biome[surfaceIndex(Math.floor(state.player.x), Math.floor(state.player.z))]].name} - ${WORLD_X}x${WORLD_Z} procedural world - ${state.mobs.length} enemies`;
    ui.hotbar.innerHTML = state.hotbar.map((slot, i) => {
      const selected = i === state.selected ? " is-selected" : "";
      const label = slot ? DEF[slot.code].name : "";
      const count = slot && slot.n > 1 ? `<b>${slot.n}</b>` : "";
      const swatch = slot ? `<span class="rizz3d-swatch" style="background:${DEF[slot.code].color}"></span>` : "";
      return `<button class="rizz3d-slot${selected}" data-slot="${i}" title="${label || "Empty"}"><em>${i + 1}</em>${swatch}${count}</button>`;
    }).join("");
    updateHeldItem();
  }
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function updateHeldItem() {
    heldGroup.clear();
    const slot = selectedSlot();
    if (!slot) return;
    const mat = new THREE.MeshLambertMaterial({ color: DEF[slot.code].color || "#ffffff" });
    const handle = new THREE.Mesh(new THREE.BoxBufferGeometry(0.08, 0.48, 0.08), mat);
    handle.position.set(0.38, -0.33, -0.72);
    handle.rotation.z = -0.55;
    heldGroup.add(handle);
    const head = new THREE.Mesh(new THREE.BoxBufferGeometry(0.28, 0.16, 0.12), mat);
    head.position.set(0.25, -0.15, -0.82);
    head.rotation.z = -0.55;
    heldGroup.add(head);
  }

  function buildHud() {
    const wrap = canvas.closest(".canvas-wrap") || canvas.parentElement;
    const style = document.createElement("style");
    style.textContent = `
      .rizz3d-crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);pointer-events:none;z-index:5}
      .rizz3d-crosshair:before,.rizz3d-crosshair:after{content:"";position:absolute;background:rgba(255,255,255,.9);box-shadow:0 0 6px rgba(0,0,0,.7)}
      .rizz3d-crosshair:before{left:8px;top:1px;width:2px;height:16px}.rizz3d-crosshair:after{left:1px;top:8px;width:16px;height:2px}
      .rizz3d-chip{position:absolute;left:12px;bottom:62px;z-index:5;padding:7px 10px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(5,7,13,.72);color:#fff;font:700 11px var(--font-mono);pointer-events:none}
      .rizz3d-target{position:absolute;left:50%;top:calc(50% + 24px);transform:translateX(-50%);z-index:5;color:#fff;background:rgba(5,7,13,.6);border-radius:5px;padding:4px 8px;font:700 11px var(--font-mono);pointer-events:none;min-height:14px}
      .rizz3d-progress{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:5;width:min(340px,72%);height:5px;background:rgba(0,0,0,.55);border-radius:3px;overflow:hidden;pointer-events:none}.rizz3d-progress span{display:block;width:0;height:100%;background:#ffd43b}
      .rizz3d-hotbar{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:7;display:grid;grid-template-columns:repeat(9,40px);gap:4px;pointer-events:auto}
      .rizz3d-slot{position:relative;width:40px;height:40px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(8,10,18,.8);cursor:pointer}.rizz3d-slot.is-selected{border-color:#ffd43b;box-shadow:0 0 0 2px rgba(255,212,59,.28)}
      .rizz3d-slot em{position:absolute;left:4px;top:2px;color:rgba(255,255,255,.55);font:700 9px var(--font-mono);font-style:normal}.rizz3d-slot b{position:absolute;right:4px;bottom:2px;color:#fff;font:800 11px var(--font-mono)}
      .rizz3d-swatch{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);border-radius:4px;box-shadow:inset 0 -4px 0 rgba(0,0,0,.22),0 0 0 1px rgba(255,255,255,.22)}
      @media (max-width:760px){.rizz3d-hotbar{grid-template-columns:repeat(9,32px);gap:3px}.rizz3d-slot{width:32px;height:32px}.rizz3d-chip{bottom:50px;font-size:9px;max-width:70%}}
    `;
    document.head.appendChild(style);
    const crosshair = document.createElement("div");
    crosshair.className = "rizz3d-crosshair";
    const objective = document.createElement("div");
    objective.className = "rizz3d-chip";
    const target = document.createElement("div");
    target.className = "rizz3d-target";
    const progress = document.createElement("div");
    progress.className = "rizz3d-progress";
    progress.innerHTML = "<span></span>";
    const hotbar = document.createElement("div");
    hotbar.className = "rizz3d-hotbar";
    hotbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-slot]");
      if (button) state.selected = Number(button.dataset.slot);
    });
    wrap.append(crosshair, objective, target, progress, hotbar);
    return { crosshair, objective, target, progress: progress.firstElementChild, hotbar };
  }

  function resizeRenderer() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || canvas.width));
    const height = Math.max(220, Math.floor(rect.height || canvas.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function initGame(seed) {
    state.started = false;
    state.paused = false;
    state.crafting = false;
    state.mining = null;
    state.mobs.forEach(removeMob);
    state.mobs = [];
    state.time = 0.21;
    state.day = 1;
    state.spawnTimer = 2;
    state.mined = 0;
    state.score = 0;
    state.high = api.getHighScore(GAME_ID) || 0;
    state.selected = 0;
    state.sigmaForged = false;
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
    if (saveSlot) saveSlot.clear();
    state.started = true;
    state.paused = false;
    if (overlay) overlay.classList.remove("overlay--show");
    canvas.focus();
  }
  function restart() {
    if (saveSlot) saveSlot.clear();
    initGame();
    startGame();
  }
  function togglePause() {
    if (!state.started) return;
    state.paused = !state.paused;
    unlockPointer();
    if (overlay) {
      overlay.classList.toggle("overlay--show", state.paused);
      if (state.paused) {
        document.getElementById("overlay-title").textContent = "Paused";
        document.getElementById("overlay-sub").innerHTML = "Press <b>P</b> or Resume to keep mining.";
        document.getElementById("overlay-score").innerHTML = "";
        document.getElementById("btn-primary").textContent = "Resume";
      }
    }
  }

  function snapshot() {
    return {
      seed: state.seed,
      edits: Array.from(state.edits.entries()).slice(0, 15000),
      player: { ...state.player },
      hotbar: state.hotbar.map((slot) => slot ? { ...slot } : null),
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
    initGame(data.seed);
    state.edits = new Map(Array.isArray(data.edits) ? data.edits : []);
    for (const [key, code] of state.edits.entries()) {
      const [x, y, z] = key.split(",").map(Number);
      if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
    }
    for (let z = 0; z < WORLD_Z; z++) for (let x = 0; x < WORLD_X; x++) updateSurfaceColumn(x, z);
    rebuildAllChunks();
    rebuildDecorations();
    if (data.player) Object.assign(state.player, data.player);
    if (Array.isArray(data.hotbar)) state.hotbar = data.hotbar.map((slot) => slot ? { ...slot } : null).slice(0, HOTBAR);
    while (state.hotbar.length < HOTBAR) state.hotbar.push(null);
    state.selected = Number(data.selected) || 0;
    state.day = Number(data.day) || 1;
    state.time = Number(data.time) || 0.21;
    state.mined = Number(data.mined) || 0;
    state.score = Number(data.score) || 0;
    state.sigmaForged = !!data.sigmaForged;
    state.started = true;
    state.paused = false;
    if (overlay) overlay.classList.remove("overlay--show");
    syncCamera();
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = Math.min((ts - last) / 1000, 1 / 30);
    last = ts;
    resizeRenderer();
    if (state.started && !state.paused && !state.crafting) {
      updateTime(dt);
      updatePlayer(dt);
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
      if (key === "w" || key === "arrowup") state.input.forward = 1;
      if (key === "s" || key === "arrowdown") state.input.forward = -1;
      if (key === "a" || key === "arrowleft") state.input.right = -1;
      if (key === "d" || key === "arrowright") state.input.right = 1;
      if (key === " " || key === "spacebar") state.input.jump = true;
      if (key === "shift") state.input.sprint = true;
      if (key >= "1" && key <= "9") state.selected = Number(key) - 1;
      if (key === "e") toggleCrafting();
      if (key === "p") togglePause();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(event.key)) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      if ((key === "w" || key === "arrowup") && state.input.forward > 0) state.input.forward = 0;
      if ((key === "s" || key === "arrowdown") && state.input.forward < 0) state.input.forward = 0;
      if ((key === "a" || key === "arrowleft") && state.input.right < 0) state.input.right = 0;
      if ((key === "d" || key === "arrowright") && state.input.right > 0) state.input.right = 0;
      if (key === " " || key === "spacebar") state.input.jump = false;
      if (key === "shift") state.input.sprint = false;
    });
    canvas.addEventListener("click", () => {
      if (state.started && !state.paused && !state.crafting && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    canvas.addEventListener("mousedown", (event) => {
      if (!state.started || state.paused || state.crafting) return;
      canvas.focus();
      if (event.button === 2) state.input.place = true;
      else state.input.mine = true;
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 2) state.input.place = false;
      else state.input.mine = false;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.selected = (state.selected + (event.deltaY > 0 ? 1 : -1) + HOTBAR) % HOTBAR;
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
      else if (!state.started) startGame();
    });
    bind("btn-pause", togglePause);
    bind("btn-restart", restart);
    bind("btn-craft", () => toggleCrafting());
    bind("btn-craft-close", () => toggleCrafting(false));
    bind("btn-mine", () => { state.mode = "mine"; updateModeButtons(); });
    bind("btn-place", () => { state.mode = "place"; updateModeButtons(); });
    bindHold("btn-left", () => { state.input.right = -1; }, () => { if (state.input.right < 0) state.input.right = 0; });
    bindHold("btn-right", () => { state.input.right = 1; }, () => { if (state.input.right > 0) state.input.right = 0; });
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

  initGame();
  bindInput();
  bindButtons();
  updateModeButtons();
  resizeRenderer();
  raf = requestAnimationFrame(loop);

  if (saveSlot) {
    saveSlot.attachButtons({
      primary: document.getElementById("btn-primary"),
      scoreEl: document.getElementById("overlay-score"),
      continueLabel: "Continue world",
      newLabel: "New world",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} - Day <strong>${Number(data.day || 1)}</strong> - Score <strong>${Number(data.score || 0).toLocaleString()}</strong>`;
      },
    });
    saveSlot.startAutosave(snapshot, () => state.started && !state.paused);
  }

  window.addEventListener("resize", resizeRenderer);
  window.__RIZZ = {
    state,
    DEF,
    RECIPES,
    startGame,
    restart,
    giveItem,
    spawnMob,
    generateWorld,
    rebuildAllChunks,
    getBlock,
    setBlock,
    movementVectorForYaw,
    daylight,
    isNight,
    setTime(t) { state.time = t; },
    teleportSpawn() { spawnPlayer(); },
  };
})();
