/* ============================================================
   ESCAPE THE POOP CRUISE - low-poly horror FPS
   ------------------------------------------------------------
   A static Three.js game page for Rainbot Network. The cruise
   crud is fictional parody; cure weapons are absurd game props.
   Debug hook: window.__POOP_CRUISE
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "escape-poop-cruise";
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;

  const canvasWrap = canvas.closest(".canvas-wrap") || canvas.parentElement;
  const api = window.RB || {
    recordScore() { return false; },
    getHighScore() { return 0; },
    showRewarded() { return Promise.resolve(true); },
    isAdFree() { return false; },
    toast(message) { console.log(message); },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    primary: $("btn-primary"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    sound: $("btn-sound"),
    lock: $("btn-lock"),
    fullscreen: $("btn-fullscreen"),
    freshAir: $("btn-fresh-air"),
    shells: $("btn-shells"),
    deck: $("hud-deck"),
    cures: $("hud-cures"),
    weapon: $("hud-weapon"),
    ammo: $("hud-ammo"),
    score: $("hud-score"),
    high: $("hud-high"),
    infection: $("hud-infection"),
    infectionFill: $("infection-fill"),
    status: $("hud-status"),
    vignette: $("crud-vignette"),
    mobileControls: $("mobile-controls"),
  };

  if (!window.THREE) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px sans-serif";
    ctx.fillText("Three.js failed to load.", 30, 60);
    ctx.font = "14px sans-serif";
    ctx.fillText("Refresh the page or check the vendored runtime.", 30, 88);
    return;
  }

  const THREE = window.THREE;
  const TILE = 4;
  const WALL_H = 3.2;
  const EYE_Y = 1.62;
  const PLAYER_RADIUS = 0.45;
  const PLAYER_SPEED = 4.15;
  const SPRINT_SPEED = 6.1;
  const MOUSE_SENS = 0.00215;
  const MAX_PITCH = Math.PI * 0.46;
  const DART_RANGE = 22;
  const SHOTGUN_RANGE = 15;
  const FLOW_REFRESH = 0.36;
  const WALKABLE = new Set([0, 2, 3, 4]);

  const Tile = {
    WALL: 1,
    FLOOR: 0,
    EXIT: 2,
    FRESH: 3,
    HAZARD: 4,
  };

  const state = {
    mode: "menu",
    level: 1,
    score: 0,
    infection: 0,
    cures: 0,
    neededCures: 0,
    totalShots: 0,
    totalHits: 0,
    deckStart: 0,
    statusTimer: 0,
    high: api.getHighScore(GAME_ID) || 0,
    sound: true,
    weapon: "dart",
    shotgunUnlocked: false,
    shotgunAmmo: 0,
    dartCooldown: 0,
    shotgunCooldown: 0,
    lurchTimer: 0,
    flowTimer: 0,
    flow: [],
    map: null,
    enemies: [],
    pickups: [],
    clouds: [],
    beams: [],
    particles: [],
  };

  const player = {
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
  };

  const input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  };

  const touchLook = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x071018, 0.037);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 95);
  camera.rotation.order = "YXZ";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false;

  const world = new THREE.Group();
  const enemyRoot = new THREE.Group();
  const pickupRoot = new THREE.Group();
  const fxRoot = new THREE.Group();
  scene.add(world, enemyRoot, pickupRoot, fxRoot);

  const ambient = new THREE.AmbientLight(0x708090, 0.34);
  const shipLight = new THREE.DirectionalLight(0x88dfff, 0.35);
  shipLight.position.set(-6, 10, 5);
  const flashlight = new THREE.SpotLight(0xcffcff, 1.9, 34, Math.PI / 5, 0.55, 1.2);
  const flashlightTarget = new THREE.Object3D();
  scene.add(ambient, shipLight, flashlight, flashlightTarget);
  flashlight.target = flashlightTarget;

  const mats = {
    wall: new THREE.MeshLambertMaterial({ color: 0x17253a }),
    wallDark: new THREE.MeshLambertMaterial({ color: 0x0b1424 }),
    floor: new THREE.MeshLambertMaterial({ color: 0x2b1631 }),
    carpet: new THREE.MeshLambertMaterial({ color: 0x451a37 }),
    ceiling: new THREE.MeshLambertMaterial({ color: 0x0c1220 }),
    exitLocked: new THREE.MeshLambertMaterial({ color: 0x922746, emissive: 0x240711 }),
    exitOpen: new THREE.MeshLambertMaterial({ color: 0x42f2ff, emissive: 0x104a4f }),
    fresh: new THREE.MeshLambertMaterial({ color: 0x16435f, emissive: 0x061e28 }),
    hazard: new THREE.MeshLambertMaterial({ color: 0x4c3211, emissive: 0x211303 }),
    trim: new THREE.MeshLambertMaterial({ color: 0xffd43b }),
    skin: new THREE.MeshLambertMaterial({ color: 0xb7ff54, emissive: 0x1b3b0a }),
    passenger: new THREE.MeshLambertMaterial({ color: 0x3f5456 }),
    cougher: new THREE.MeshLambertMaterial({ color: 0x5e4d70 }),
    sprinter: new THREE.MeshLambertMaterial({ color: 0x5d6145 }),
    dart: new THREE.MeshBasicMaterial({ color: 0x2ee0ff }),
    heal: new THREE.MeshBasicMaterial({ color: 0xb7ff54 }),
    pickup: new THREE.MeshLambertMaterial({ color: 0xffd43b, emissive: 0x4d3500 }),
    shotgun: new THREE.MeshLambertMaterial({ color: 0xff2e88, emissive: 0x3a071d }),
    porthole: new THREE.MeshLambertMaterial({ color: 0x163b54, emissive: 0x071a29 }),
  };

  const geoms = {
    wall: new THREE.BoxGeometry(TILE, WALL_H, TILE),
    floor: new THREE.BoxGeometry(TILE, 0.08, TILE),
    ceiling: new THREE.BoxGeometry(TILE, 0.08, TILE),
    door: new THREE.BoxGeometry(TILE * 0.82, WALL_H * 0.78, 0.22),
    trim: new THREE.BoxGeometry(TILE * 0.9, 0.08, TILE * 0.12),
    body: new THREE.CylinderGeometry(0.38, 0.48, 1.1, 7),
    head: new THREE.SphereGeometry(0.34, 8, 6),
    arm: new THREE.BoxGeometry(0.18, 0.78, 0.18),
    leg: new THREE.BoxGeometry(0.2, 0.68, 0.2),
    pickup: new THREE.BoxGeometry(0.64, 0.64, 0.64),
    tube: new THREE.CylinderGeometry(0.06, 0.06, 0.75, 8),
    sphere: new THREE.SphereGeometry(1, 12, 8),
  };

  let exitDoor = null;
  let lastTime = performance.now();
  let raf = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function random() {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedForLevel(level) {
    return (0xC0FFEE ^ Math.imul(level, 0x45d9f3b)) >>> 0;
  }

  function tileToWorld(gx, gy, map = state.map) {
    return {
      x: (gx - map.w / 2 + 0.5) * TILE,
      z: (gy - map.h / 2 + 0.5) * TILE,
    };
  }

  function worldToTile(x, z, map = state.map) {
    return {
      gx: Math.floor(x / TILE + map.w / 2),
      gy: Math.floor(z / TILE + map.h / 2),
    };
  }

  function inBounds(gx, gy, map = state.map) {
    return Boolean(map && gx >= 0 && gy >= 0 && gx < map.w && gy < map.h);
  }

  function tileAt(gx, gy, map = state.map) {
    if (!inBounds(gx, gy, map)) return Tile.WALL;
    return map.grid[gy][gx];
  }

  function isWalkableTile(gx, gy, map = state.map) {
    return WALKABLE.has(tileAt(gx, gy, map));
  }

  function isWalkableWorld(x, z, radius = PLAYER_RADIUS) {
    const checks = [
      [x - radius, z - radius],
      [x + radius, z - radius],
      [x - radius, z + radius],
      [x + radius, z + radius],
      [x, z],
    ];
    return checks.every(([cx, cz]) => {
      const t = worldToTile(cx, cz);
      return isWalkableTile(t.gx, t.gy);
    });
  }

  function carveRoom(grid, room) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) grid[y][x] = Tile.FLOOR;
    }
  }

  function carveCorridor(grid, ax, ay, bx, by, rng) {
    const horizontalFirst = rng() > 0.5;
    const carveH = (y, x1, x2) => {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
        grid[y][x] = Tile.FLOOR;
        if (grid[y + 1]) grid[y + 1][x] = Tile.FLOOR;
      }
    };
    const carveV = (x, y1, y2) => {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
        grid[y][x] = Tile.FLOOR;
        if (grid[y][x + 1] !== undefined) grid[y][x + 1] = Tile.FLOOR;
      }
    };
    if (horizontalFirst) {
      carveH(ay, ax, bx);
      carveV(bx, ay, by);
    } else {
      carveV(ax, ay, by);
      carveH(by, ax, bx);
    }
  }

  function roomsOverlap(a, b) {
    return !(
      a.x + a.w + 1 < b.x ||
      b.x + b.w + 1 < a.x ||
      a.y + a.h + 1 < b.y ||
      b.y + b.h + 1 < a.y
    );
  }

  function makeFallbackMap(w, h) {
    const grid = Array.from({ length: h }, () => Array(w).fill(Tile.WALL));
    const roomA = { x: 2, y: 2, w: 7, h: 7 };
    const roomB = { x: w - 9, y: h - 9, w: 7, h: 7 };
    const roomC = { x: Math.floor(w / 2) - 3, y: Math.floor(h / 2) - 3, w: 7, h: 7 };
    [roomA, roomB, roomC].forEach((room) => carveRoom(grid, room));
    carveCorridor(grid, roomA.x + 3, roomA.y + 3, roomC.x + 3, roomC.y + 3, () => 1);
    carveCorridor(grid, roomC.x + 3, roomC.y + 3, roomB.x + 3, roomB.y + 3, () => 0);
    return { grid, rooms: [roomA, roomC, roomB] };
  }

  function generateMap(level) {
    const rng = mulberry32(seedForLevel(level));
    const w = Math.min(35, 19 + level * 2);
    const h = Math.min(35, 19 + level * 2);
    let grid = Array.from({ length: h }, () => Array(w).fill(Tile.WALL));
    let rooms = [];
    const targetRooms = clamp(6 + Math.floor(level * 0.8), 6, 13);

    for (let attempt = 0; attempt < 180 && rooms.length < targetRooms; attempt += 1) {
      const rw = randInt(rng, 4, Math.min(8, w - 4));
      const rh = randInt(rng, 4, Math.min(8, h - 4));
      const room = {
        x: randInt(rng, 1, w - rw - 2),
        y: randInt(rng, 1, h - rh - 2),
        w: rw,
        h: rh,
      };
      room.cx = Math.floor(room.x + room.w / 2);
      room.cy = Math.floor(room.y + room.h / 2);
      if (rooms.some((other) => roomsOverlap(room, other))) continue;
      rooms.push(room);
      carveRoom(grid, room);
    }

    if (rooms.length < 4) {
      const fallback = makeFallbackMap(w, h);
      grid = fallback.grid;
      rooms = fallback.rooms;
      rooms.forEach((room) => {
        room.cx = Math.floor(room.x + room.w / 2);
        room.cy = Math.floor(room.y + room.h / 2);
      });
    }

    rooms.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    for (let i = 1; i < rooms.length; i += 1) {
      carveCorridor(grid, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, rng);
    }

    const start = { gx: rooms[0].cx, gy: rooms[0].cy };
    const exit = { gx: rooms[rooms.length - 1].cx, gy: rooms[rooms.length - 1].cy };
    grid[exit.gy][exit.gx] = Tile.EXIT;

    const floors = [];
    for (let gy = 1; gy < h - 1; gy += 1) {
      for (let gx = 1; gx < w - 1; gx += 1) {
        if (WALKABLE.has(grid[gy][gx])) floors.push({ gx, gy });
      }
    }

    function farFromStart(tile, dist = 6) {
      return Math.abs(tile.gx - start.gx) + Math.abs(tile.gy - start.gy) >= dist;
    }

    const freshCount = clamp(2 + Math.floor(level / 2), 2, 7);
    for (let i = 0; i < freshCount; i += 1) {
      const candidates = floors.filter((tile) => farFromStart(tile, 5) && grid[tile.gy][tile.gx] === Tile.FLOOR);
      const tile = candidates[Math.floor(rng() * candidates.length)];
      if (tile) grid[tile.gy][tile.gx] = Tile.FRESH;
    }

    const hazardCount = clamp(1 + Math.floor(level * 0.75), 1, 9);
    for (let i = 0; i < hazardCount; i += 1) {
      const candidates = floors.filter((tile) => farFromStart(tile, 4) && grid[tile.gy][tile.gx] === Tile.FLOOR);
      const tile = candidates[Math.floor(rng() * candidates.length)];
      if (tile) grid[tile.gy][tile.gx] = Tile.HAZARD;
    }

    return { w, h, grid, rooms, floors, start, exit, rng };
  }

  function clearGroup(group) {
    while (group.children.length) group.remove(group.children[0]);
  }

  function addBox(group, geom, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
    return mesh;
  }

  function buildWorld() {
    clearGroup(world);
    clearGroup(enemyRoot);
    clearGroup(pickupRoot);
    clearGroup(fxRoot);
    exitDoor = null;

    const map = state.map;
    for (let gy = 0; gy < map.h; gy += 1) {
      for (let gx = 0; gx < map.w; gx += 1) {
        const tile = map.grid[gy][gx];
        const pos = tileToWorld(gx, gy, map);

        if (tile === Tile.WALL) {
          const mat = (gx + gy) % 3 === 0 ? mats.wallDark : mats.wall;
          addBox(world, geoms.wall, mat, pos.x, WALL_H / 2, pos.z);
          if ((gx === 0 || gy === 0 || gx === map.w - 1 || gy === map.h - 1) && (gx + gy) % 4 === 0) {
            addBox(world, geoms.trim, mats.porthole, pos.x, 1.75, pos.z, 0.72, 1, 1);
          }
          continue;
        }

        const floorMat = tile === Tile.FRESH ? mats.fresh : tile === Tile.HAZARD ? mats.hazard : ((gx + gy) % 2 ? mats.floor : mats.carpet);
        addBox(world, geoms.floor, floorMat, pos.x, -0.04, pos.z);
        addBox(world, geoms.ceiling, mats.ceiling, pos.x, WALL_H + 0.05, pos.z);

        if (tile === Tile.FRESH) {
          addBox(world, geoms.trim, mats.heal, pos.x, 0.06, pos.z, 0.95, 1, 0.95);
        }

        if (tile === Tile.HAZARD) {
          addBox(world, geoms.trim, mats.trim, pos.x, 0.22, pos.z, 0.85, 1.8, 0.52);
          addBox(world, geoms.pickup, mats.hazard, pos.x, 0.58, pos.z, 1.6, 0.24, 0.72);
        }

        if (tile === Tile.EXIT) {
          exitDoor = addBox(world, geoms.door, mats.exitLocked, pos.x, 1.36, pos.z, 1, 1, 1);
          addBox(world, geoms.trim, mats.heal, pos.x, 2.95, pos.z, 1.05, 1.25, 0.35);
        }
      }
    }

    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(map.w * TILE * 1.35, map.h * TILE * 1.35, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x061726, transparent: true, opacity: 0.5 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.18;
    world.add(ocean);
  }

  function createEnemyMesh(type) {
    const group = new THREE.Group();
    const bodyMat = type === "cougher" ? mats.cougher : type === "sprinter" ? mats.sprinter : mats.passenger;
    const body = new THREE.Mesh(geoms.body, bodyMat);
    body.position.y = 0.92;
    const head = new THREE.Mesh(geoms.head, mats.skin);
    head.position.y = 1.62;
    const armA = new THREE.Mesh(geoms.arm, mats.skin);
    armA.position.set(-0.45, 0.95, 0.05);
    armA.rotation.z = 0.45;
    const armB = new THREE.Mesh(geoms.arm, mats.skin);
    armB.position.set(0.45, 0.95, 0.05);
    armB.rotation.z = -0.45;
    const legA = new THREE.Mesh(geoms.leg, bodyMat);
    legA.position.set(-0.22, 0.22, 0);
    const legB = new THREE.Mesh(geoms.leg, bodyMat);
    legB.position.set(0.22, 0.22, 0);
    group.add(body, head, armA, armB, legA, legB);

    const glow = new THREE.Mesh(
      geoms.sphere,
      new THREE.MeshBasicMaterial({ color: 0xb7ff54, transparent: true, opacity: type === "cougher" ? 0.18 : 0.1 })
    );
    glow.scale.set(0.82, 1.2, 0.82);
    glow.position.y = 0.95;
    group.add(glow);
    group.userData.glow = glow;
    return group;
  }

  function spawnEnemies() {
    const map = state.map;
    const rng = map.rng;
    const count = clamp(4 + state.level * 2, 4, 24);
    const floors = map.floors.filter((tile) => {
      const startDistance = Math.abs(tile.gx - map.start.gx) + Math.abs(tile.gy - map.start.gy);
      const exitDistance = Math.abs(tile.gx - map.exit.gx) + Math.abs(tile.gy - map.exit.gy);
      return startDistance > 5 && exitDistance > 2 && map.grid[tile.gy][tile.gx] !== Tile.HAZARD;
    });
    state.enemies = [];

    for (let i = 0; i < count && floors.length; i += 1) {
      const tile = floors.splice(Math.floor(rng() * floors.length), 1)[0];
      const pos = tileToWorld(tile.gx, tile.gy, map);
      let type = "passenger";
      if (state.level >= 3 && rng() < 0.22 + state.level * 0.01) type = "cougher";
      if (state.level >= 5 && rng() < 0.12 + state.level * 0.006) type = "sprinter";
      const enemy = {
        id: `e${state.level}-${i}`,
        type,
        x: pos.x,
        z: pos.z,
        vx: 0,
        vz: 0,
        cured: false,
        inoculation: 0,
        resistance: type === "cougher" ? 1.65 : type === "sprinter" ? 1.25 : 1,
        speed: (type === "sprinter" ? 2.35 : type === "cougher" ? 1.35 : 1.6) + Math.min(0.7, state.level * 0.06),
        coughTimer: 1 + rng() * 2,
        stagger: 0,
        mesh: createEnemyMesh(type),
      };
      enemy.mesh.position.set(enemy.x, 0, enemy.z);
      enemyRoot.add(enemy.mesh);
      state.enemies.push(enemy);
    }

    state.neededCures = Math.max(2, Math.ceil(state.enemies.length * 0.64));
  }

  function createPickupMesh(type) {
    const group = new THREE.Group();
    const mat = type === "shotgun" ? mats.shotgun : type === "fresh-air" ? mats.heal : mats.pickup;
    const body = new THREE.Mesh(geoms.pickup, mat);
    body.position.y = 0.55;
    group.add(body);
    if (type === "shotgun") {
      const barrel = new THREE.Mesh(geoms.tube, mats.dart);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.45, 0.75, 0);
      group.add(barrel);
    }
    return group;
  }

  function spawnPickups() {
    const map = state.map;
    const rng = map.rng;
    const floors = map.floors.filter((tile) => {
      const startDistance = Math.abs(tile.gx - map.start.gx) + Math.abs(tile.gy - map.start.gy);
      return startDistance > 4 && map.grid[tile.gy][tile.gx] === Tile.FLOOR;
    });
    state.pickups = [];

    function addPickup(type, tile) {
      if (!tile) return;
      const pos = tileToWorld(tile.gx, tile.gy, map);
      const pickup = { type, x: pos.x, z: pos.z, taken: false, mesh: createPickupMesh(type) };
      pickup.mesh.position.set(pickup.x, 0, pickup.z);
      pickupRoot.add(pickup.mesh);
      state.pickups.push(pickup);
    }

    const count = clamp(3 + Math.floor(state.level * 0.75), 3, 9);
    for (let i = 0; i < count && floors.length; i += 1) {
      const tile = floors.splice(Math.floor(rng() * floors.length), 1)[0];
      const type = rng() < 0.45 ? "fresh-air" : "shells";
      addPickup(type, tile);
    }
    if (state.level >= 2 && !state.shotgunUnlocked && floors.length) {
      addPickup("shotgun", floors.splice(Math.floor(rng() * floors.length), 1)[0]);
    }
  }

  function loadLevel(level) {
    state.level = level;
    state.mode = "playing";
    state.cures = 0;
    state.dartCooldown = 0;
    state.shotgunCooldown = 0;
    state.clouds = [];
    state.beams = [];
    state.particles = [];
    state.flowTimer = 0;
    state.deckStart = performance.now();
    state.map = generateMap(level);

    const start = tileToWorld(state.map.start.gx, state.map.start.gy, state.map);
    player.x = start.x;
    player.z = start.z;
    player.yaw = 0;
    player.pitch = 0;
    player.vx = 0;
    player.vz = 0;

    buildWorld();
    spawnEnemies();
    spawnPickups();
    rebuildFlow();
    setStatus(`Deck ${level}: cure ${state.neededCures} passengers, then reach the lifeboats.`);
    updateExitDoor();
    updateHud();
    hideOverlay();
    lockPointer();
  }

  function startRun() {
    state.score = 0;
    state.infection = 0;
    state.level = 1;
    state.totalShots = 0;
    state.totalHits = 0;
    state.weapon = "dart";
    state.shotgunUnlocked = false;
    state.shotgunAmmo = 0;
    loadLevel(1);
  }

  function completeLevel() {
    state.mode = "complete";
    resetMobileInput();
    const elapsed = Math.max(1, Math.floor((performance.now() - state.deckStart) / 1000));
    const accuracy = state.totalShots > 0 ? state.totalHits / state.totalShots : 1;
    const timeBonus = Math.max(0, 420 - elapsed * 5);
    const levelBonus = state.level * 700;
    const infectionBonus = Math.max(0, Math.floor((100 - state.infection) * 8));
    const scoreGain = levelBonus + timeBonus + infectionBonus + Math.floor(accuracy * 350);
    state.score += scoreGain;
    state.infection = Math.max(0, state.infection - 18);
    const high = api.recordScore(GAME_ID, state.score);
    state.high = api.getHighScore(GAME_ID) || state.high;
    unlockPointer();
    showOverlay(
      `DECK ${state.level} CLEARED`,
      `The lifeboat door coughed open. Infection dropped during the fresh-air shuffle. Next deck adds more rooms, faster passengers, and worse buffet decisions.`,
      `Score: <strong>${state.score.toLocaleString()}</strong> · Deck bonus: <strong>${scoreGain.toLocaleString()}</strong>${high ? " · <strong>New high score</strong>" : ""}`,
      `Enter deck ${state.level + 1}`
    );
  }

  function gameOver(reason) {
    if (state.mode === "gameover") return;
    state.mode = "gameover";
    resetMobileInput();
    const survivalBonus = Math.floor((performance.now() - state.deckStart) / 1000) * 8;
    state.score += survivalBonus;
    const high = api.recordScore(GAME_ID, state.score);
    state.high = api.getHighScore(GAME_ID) || state.high;
    unlockPointer();
    showOverlay(
      "CRUISE CRUD MAXED",
      reason || "The infection meter hit the red zone. Roe Jogan did not make it to the lifeboats.",
      `Final score: <strong>${state.score.toLocaleString()}</strong> · Deck reached: <strong>${state.level}</strong>${high ? " · <strong>New high score</strong>" : " · High: <strong>" + state.high.toLocaleString() + "</strong>"}`,
      "Restart cruise"
    );
  }

  function showOverlay(title, sub, score, button) {
    if (!el.overlay) return;
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.innerHTML = score || "";
    el.primary.textContent = button || "Start";
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    if (el.overlay) el.overlay.classList.remove("overlay--show");
  }

  function setStatus(message, seconds = 3.2) {
    if (el.status) el.status.textContent = message;
    state.statusTimer = seconds;
  }

  function formatAmmo() {
    if (state.weapon === "shotgun") return `${state.shotgunAmmo}`;
    return state.dartCooldown > 0 ? "Reloading" : "Ready";
  }

  function updateHud() {
    syncPlayStateClass();
    if (el.deck) el.deck.textContent = String(state.level);
    if (el.cures) el.cures.textContent = `${state.cures}/${state.neededCures}`;
    if (el.weapon) el.weapon.textContent = state.weapon === "shotgun" ? "Shotgun" : "Dart";
    if (el.ammo) el.ammo.textContent = formatAmmo();
    if (el.score) el.score.textContent = Math.floor(state.score).toLocaleString();
    if (el.high) el.high.textContent = Math.floor(state.high).toLocaleString();
    if (el.infection) el.infection.textContent = `${Math.round(state.infection)}%`;
    if (el.infectionFill) el.infectionFill.style.width = `${clamp(state.infection, 0, 100)}%`;
    if (el.vignette) {
      const flash = state.infection > 80 ? 0.22 : state.infection > 60 ? 0.12 : state.infection > 42 ? 0.06 : 0;
      el.vignette.style.setProperty("--crud-flash", String(flash + Math.max(0, state.lurchTimer) * 0.12));
    }
  }

  function updateExitDoor() {
    if (!exitDoor) return;
    exitDoor.material = state.cures >= state.neededCures ? mats.exitOpen : mats.exitLocked;
    exitDoor.scale.y = state.cures >= state.neededCures ? 0.72 : 1;
  }

  function syncPlayStateClass() {
    if (!canvasWrap) return;
    canvasWrap.classList.toggle("is-playing", state.mode === "playing");
    canvasWrap.dataset.playerYaw = player.yaw.toFixed(4);
    canvasWrap.dataset.playerPitch = player.pitch.toFixed(4);
    canvasWrap.dataset.playerX = player.x.toFixed(3);
    canvasWrap.dataset.playerZ = player.z.toFixed(3);
  }

  function tryUseExit() {
    if (state.mode !== "playing" || !state.map) return;
    const exitPos = tileToWorld(state.map.exit.gx, state.map.exit.gy, state.map);
    if (Math.hypot(player.x - exitPos.x, player.z - exitPos.z) >= 2.2) {
      setStatus("Find the glowing lifeboat door first.");
      return;
    }
    if (state.cures >= state.neededCures) completeLevel();
    else setStatus(`Lifeboat locked. Cure ${state.neededCures - state.cures} more.`);
  }

  function switchWeapon() {
    if (state.weapon === "shotgun") {
      state.weapon = "dart";
      setStatus("Dart gun ready.");
      return;
    }
    if (state.shotgunUnlocked) {
      state.weapon = "shotgun";
      setStatus("Ivermectin Shotgun ready.");
    } else {
      setStatus("Shotgun is still somewhere on the ship.");
    }
  }

  function lockPointer() {
    if (!canvas || document.pointerLockElement === canvas) return;
    if (canvas.requestPointerLock) {
      try {
        const ret = canvas.requestPointerLock();
        if (ret && ret.catch) ret.catch(() => {});
      } catch (error) { /* user gesture may be required */ }
    }
  }

  function unlockPointer() {
    if (document.pointerLockElement === canvas && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (error) { /* ignore */ }
    }
  }

  function isPointerLocked() {
    return document.pointerLockElement === canvas;
  }

  function setPaused(paused) {
    if (paused && state.mode === "playing") {
      state.mode = "paused";
      resetMobileInput();
      unlockPointer();
      showOverlay("PAUSED", "The cruise is still getting worse behind the menu.", "", "Resume deck");
      return;
    }
    if (!paused && state.mode === "paused") {
      state.mode = "playing";
      hideOverlay();
      lockPointer();
    }
  }

  function currentTileType() {
    const tile = worldToTile(player.x, player.z);
    return tileAt(tile.gx, tile.gy);
  }

  function hasLineOfSight(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(dist / 0.45));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const tile = worldToTile(ax + dx * t, az + dz * t);
      if (!isWalkableTile(tile.gx, tile.gy)) return false;
    }
    return true;
  }

  function rayBlocked(origin, dir, maxDistance) {
    for (let d = 0.45; d < maxDistance; d += 0.42) {
      const x = origin.x + dir.x * d;
      const z = origin.z + dir.z * d;
      const tile = worldToTile(x, z);
      if (!isWalkableTile(tile.gx, tile.gy)) return true;
    }
    return false;
  }

  function traceEnemy(dir, range, radiusBoost = 0) {
    const origin = camera.position.clone();
    let best = null;
    for (const enemy of state.enemies) {
      if (enemy.cured) continue;
      const center = new THREE.Vector3(enemy.x, 1.18, enemy.z);
      const toEnemy = center.clone().sub(origin);
      const projected = toEnemy.dot(dir);
      if (projected <= 0.2 || projected > range) continue;
      const closest = origin.clone().addScaledVector(dir, projected);
      const radius = (enemy.type === "cougher" ? 0.72 : 0.62) + radiusBoost;
      const miss = closest.distanceTo(center);
      if (miss > radius) continue;
      if (rayBlocked(origin, dir, projected)) continue;
      if (!best || projected < best.distance) {
        best = { enemy, distance: projected, point: closest };
      }
    }
    return best;
  }

  function addBeam(targetPoint, color = 0x2ee0ff) {
    const origin = camera.position.clone();
    const points = [origin, targetPoint.clone()];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geom, mat);
    fxRoot.add(line);
    state.beams.push({ mesh: line, life: 0.08 });
  }

  function addParticles(x, z, color = 0xb7ff54, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 6, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
      );
      mesh.position.set(x, 1.2 + Math.random() * 0.7, z);
      fxRoot.add(mesh);
      state.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 2.4,
        vz: (Math.random() - 0.5) * 3,
        life: 0.65,
      });
    }
  }

  function playBeep(kind) {
    if (!state.sound) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!playBeep.ctx) playBeep.ctx = new Ctx();
    const ctx = playBeep.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const freq = kind === "hit" ? 740 : kind === "shotgun" ? 180 : kind === "bad" ? 92 : 420;
    osc.type = kind === "shotgun" ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.54), now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "shotgun" ? 0.075 : 0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  function cureEnemy(enemy, dose) {
    enemy.inoculation += dose;
    enemy.stagger = 0.22;
    state.totalHits += 1;
    addParticles(enemy.x, enemy.z, 0xb7ff54, 9);
    playBeep("hit");
    if (enemy.inoculation < enemy.resistance) {
      setStatus("Partial cure. Hit them again before they crowd you.");
      return;
    }
    enemy.cured = true;
    enemy.mesh.visible = false;
    state.cures += 1;
    const typeBonus = enemy.type === "cougher" ? 175 : enemy.type === "sprinter" ? 150 : 100;
    state.score += typeBonus + state.level * 12;
    setStatus(enemy.type === "cougher" ? "Cougher cured. The air is less terrible." : "Passenger cured.");
    updateExitDoor();
  }

  function fireDart() {
    if (state.dartCooldown > 0) return;
    state.dartCooldown = 0.55;
    state.totalShots += 1;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hit = traceEnemy(dir, DART_RANGE, 0.06);
    if (hit) {
      cureEnemy(hit.enemy, 1);
      addBeam(hit.point, 0x2ee0ff);
    } else {
      const miss = camera.position.clone().addScaledVector(dir, DART_RANGE);
      addBeam(miss, 0x2ee0ff);
      setStatus("Cure dart fired.");
      playBeep("miss");
    }
  }

  function fireShotgun() {
    if (!state.shotgunUnlocked) {
      setStatus("Find the Ivermectin Shotgun pickup first.");
      return;
    }
    if (state.shotgunAmmo <= 0) {
      setStatus("Shotgun empty. Switch to darts or find a shell kit.");
      state.weapon = "dart";
      return;
    }
    if (state.shotgunCooldown > 0) return;
    state.shotgunCooldown = 0.85;
    state.shotgunAmmo -= 1;
    state.totalShots += 1;
    playBeep("shotgun");

    const base = new THREE.Vector3();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.getWorldDirection(base);

    const hitSet = new Set();
    for (let i = 0; i < 7; i += 1) {
      const spreadX = (Math.random() - 0.5) * 0.18;
      const spreadY = (Math.random() - 0.5) * 0.12;
      const dir = base.clone().addScaledVector(right, spreadX).addScaledVector(up, spreadY).normalize();
      const hit = traceEnemy(dir, SHOTGUN_RANGE, 0.22);
      if (hit) {
        hitSet.add(hit.enemy);
        addBeam(hit.point, 0xff2e88);
      } else {
        addBeam(camera.position.clone().addScaledVector(dir, SHOTGUN_RANGE), 0xff2e88);
      }
    }
    hitSet.forEach((enemy) => cureEnemy(enemy, 0.95));
    if (!hitSet.size) {
      state.totalHits = Math.max(0, state.totalHits);
      setStatus("Shotgun blast fired.");
    }
  }

  function fireWeapon() {
    if (state.mode !== "playing") return;
    if (state.weapon === "shotgun") fireShotgun();
    else fireDart();
  }

  function rebuildFlow() {
    const map = state.map;
    if (!map) return;
    const total = map.w * map.h;
    const dist = Array(total).fill(Infinity);
    const start = worldToTile(player.x, player.z, map);
    if (!isWalkableTile(start.gx, start.gy, map)) return;
    const queue = [{ gx: start.gx, gy: start.gy }];
    dist[start.gy * map.w + start.gx] = 0;
    for (let qi = 0; qi < queue.length; qi += 1) {
      const cur = queue[qi];
      const base = dist[cur.gy * map.w + cur.gx];
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].forEach(([dx, dy]) => {
        const nx = cur.gx + dx;
        const ny = cur.gy + dy;
        const idx = ny * map.w + nx;
        if (!isWalkableTile(nx, ny, map) || dist[idx] <= base + 1) return;
        dist[idx] = base + 1;
        queue.push({ gx: nx, gy: ny });
      });
    }
    state.flow = dist;
  }

  function bestEnemyTarget(enemy) {
    const map = state.map;
    const tile = worldToTile(enemy.x, enemy.z, map);
    if (hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) return { x: player.x, z: player.z };
    const here = state.flow[tile.gy * map.w + tile.gx];
    let best = null;
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].forEach(([dx, dy]) => {
      const gx = tile.gx + dx;
      const gy = tile.gy + dy;
      if (!isWalkableTile(gx, gy, map)) return;
      const score = state.flow[gy * map.w + gx];
      if (score < here && (!best || score < best.score)) best = { gx, gy, score };
    });
    if (!best) return { x: player.x, z: player.z };
    return tileToWorld(best.gx, best.gy, map);
  }

  function moveEntity(entity, dx, dz, radius) {
    const nx = entity.x + dx;
    const nz = entity.z + dz;
    if (isWalkableWorld(nx, entity.z, radius)) entity.x = nx;
    if (isWalkableWorld(entity.x, nz, radius)) entity.z = nz;
  }

  function spawnCloud(x, z, radius = 1.8) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb7ff54, transparent: true, opacity: 0.22, depthWrite: false });
    const mesh = new THREE.Mesh(geoms.sphere, mat);
    mesh.position.set(x, 0.98, z);
    mesh.scale.set(radius, radius * 0.42, radius);
    fxRoot.add(mesh);
    state.clouds.push({ x, z, radius, life: 4.2, mesh });
  }

  function updateEnemies(dt) {
    state.flowTimer -= dt;
    if (state.flowTimer <= 0) {
      state.flowTimer = FLOW_REFRESH;
      rebuildFlow();
    }

    let closest = Infinity;
    for (const enemy of state.enemies) {
      if (enemy.cured) continue;
      enemy.stagger = Math.max(0, enemy.stagger - dt);
      const dxp = player.x - enemy.x;
      const dzp = player.z - enemy.z;
      const dist = Math.hypot(dxp, dzp);
      closest = Math.min(closest, dist);

      if (enemy.stagger <= 0) {
        const target = bestEnemyTarget(enemy);
        const dx = target.x - enemy.x;
        const dz = target.z - enemy.z;
        const len = Math.hypot(dx, dz) || 1;
        const speed = enemy.speed * (dist < 2.2 ? 0.72 : 1);
        moveEntity(enemy, (dx / len) * speed * dt, (dz / len) * speed * dt, 0.38);
      }

      if (dist < 1.25) {
        state.infection += (enemy.type === "sprinter" ? 10.5 : 8.2) * dt;
        state.lurchTimer = Math.max(state.lurchTimer, 0.18);
      } else if (dist < 6.5) {
        state.infection += (6.5 - dist) * (0.5 + state.level * 0.035) * dt;
      }

      if (enemy.type === "cougher") {
        enemy.coughTimer -= dt;
        if (enemy.coughTimer <= 0 && dist < 12) {
          enemy.coughTimer = 2.4 + Math.random() * 2.4;
          spawnCloud(enemy.x, enemy.z, 1.65 + Math.random() * 0.65);
        }
      }

      enemy.mesh.position.set(enemy.x, 0, enemy.z);
      enemy.mesh.lookAt(player.x, 0.7, player.z);
      if (enemy.mesh.userData.glow) {
        enemy.mesh.userData.glow.material.opacity = enemy.stagger > 0 ? 0.28 : enemy.type === "cougher" ? 0.18 : 0.1;
      }
    }

    return closest;
  }

  function updateClouds(dt) {
    for (let i = state.clouds.length - 1; i >= 0; i -= 1) {
      const cloud = state.clouds[i];
      cloud.life -= dt;
      const dist = Math.hypot(player.x - cloud.x, player.z - cloud.z);
      if (dist < cloud.radius) {
        state.infection += (cloud.radius - dist + 0.6) * 5.2 * dt;
        state.lurchTimer = Math.max(state.lurchTimer, 0.12);
      }
      cloud.mesh.material.opacity = clamp(cloud.life / 4.2, 0, 1) * 0.22;
      cloud.mesh.rotation.y += dt * 0.55;
      if (cloud.life <= 0) {
        fxRoot.remove(cloud.mesh);
        state.clouds.splice(i, 1);
      }
    }
  }

  function updateFx(dt) {
    for (let i = state.beams.length - 1; i >= 0; i -= 1) {
      const beam = state.beams[i];
      beam.life -= dt;
      beam.mesh.material.opacity = clamp(beam.life / 0.08, 0, 1);
      if (beam.life <= 0) {
        fxRoot.remove(beam.mesh);
        state.beams.splice(i, 1);
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= dt;
      particle.vy -= 6 * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.mesh.material.opacity = clamp(particle.life / 0.65, 0, 1);
      if (particle.life <= 0) {
        fxRoot.remove(particle.mesh);
        state.particles.splice(i, 1);
      }
    }
  }

  function updatePickups(dt) {
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      pickup.mesh.rotation.y += dt * 1.8;
      pickup.mesh.position.y = 0.12 + Math.sin(performance.now() * 0.004 + pickup.x) * 0.08;
      const dist = Math.hypot(player.x - pickup.x, player.z - pickup.z);
      if (dist > 1.2) continue;
      pickup.taken = true;
      pickup.mesh.visible = false;
      if (pickup.type === "shotgun") {
        state.shotgunUnlocked = true;
        state.shotgunAmmo += 10;
        state.weapon = "shotgun";
        setStatus("Ivermectin Shotgun acquired. Press 1/2 to switch weapons.");
      } else if (pickup.type === "shells") {
        state.shotgunAmmo += 6;
        setStatus("Shotgun shells recovered.");
      } else {
        state.infection = Math.max(0, state.infection - 24);
        setStatus("Fresh-air canister used. Infection dropping.");
      }
      playBeep("hit");
    }
  }

  function updateInfection(dt, closestEnemy) {
    const tile = currentTileType();
    if (tile === Tile.HAZARD) {
      state.infection += (6.2 + state.level * 0.25) * dt;
      state.lurchTimer = Math.max(state.lurchTimer, 0.1);
    }

    const safeDistance = closestEnemy > 7.2;
    if (tile === Tile.FRESH) {
      state.infection -= 10.5 * dt;
    } else if (safeDistance) {
      state.infection -= 3.25 * dt;
    } else if (closestEnemy > 4.5) {
      state.infection -= 1.25 * dt;
    }

    state.infection = clamp(state.infection, 0, 100);
    if (state.infection >= 100) {
      gameOver("The infection meter maxed out. Too much cough cloud, too little lifeboat.");
    }
  }

  function movePlayer(dt) {
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    let mx = 0;
    let mz = 0;
    if (input.forward) { mx += forwardX; mz += forwardZ; }
    if (input.back) { mx -= forwardX; mz -= forwardZ; }
    if (input.right) { mx += rightX; mz += rightZ; }
    if (input.left) { mx -= rightX; mz -= rightZ; }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    const infectionSlow = state.infection > 84 ? 0.72 : state.infection > 66 ? 0.84 : 1;
    const speed = (input.sprint ? SPRINT_SPEED : PLAYER_SPEED) * infectionSlow;
    const dx = mx * speed * dt;
    const dz = mz * speed * dt;
    const nx = player.x + dx;
    const nz = player.z + dz;
    if (isWalkableWorld(nx, player.z)) player.x = nx;
    if (isWalkableWorld(player.x, nz)) player.z = nz;

    const bob = Math.sin(performance.now() * 0.006) * (len > 0 ? 0.025 : 0.006);
    const sickBob = state.infection > 70 ? Math.sin(performance.now() * 0.015) * 0.045 : 0;
    camera.position.set(player.x, EYE_Y + bob + sickBob, player.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch + (state.lurchTimer > 0 ? Math.sin(performance.now() * 0.04) * 0.02 : 0);

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    flashlight.position.copy(camera.position);
    flashlightTarget.position.copy(camera.position).addScaledVector(dir, 8);

    const exitPos = tileToWorld(state.map.exit.gx, state.map.exit.gy, state.map);
    const exitDist = Math.hypot(player.x - exitPos.x, player.z - exitPos.z);
    if (exitDist < 1.6) {
      if (state.cures >= state.neededCures) {
        completeLevel();
      } else {
        setStatus(`Lifeboat locked. Cure ${state.neededCures - state.cures} more passenger${state.neededCures - state.cures === 1 ? "" : "s"}.`, 1);
      }
    }
  }

  function updateTimers(dt) {
    state.dartCooldown = Math.max(0, state.dartCooldown - dt);
    state.shotgunCooldown = Math.max(0, state.shotgunCooldown - dt);
    state.lurchTimer = Math.max(0, state.lurchTimer - dt);
    if (state.statusTimer > 0) {
      state.statusTimer -= dt;
      if (state.statusTimer <= 0 && el.status) {
        el.status.textContent = state.cures >= state.neededCures ? "Find the glowing lifeboat exit." : "Cure passengers and keep your distance.";
      }
    }
  }

  function update(dt) {
    updateTimers(dt);
    if (state.mode !== "playing") {
      updateFx(dt);
      updateHud();
      return;
    }
    movePlayer(dt);
    const closest = updateEnemies(dt);
    updateClouds(dt);
    updatePickups(dt);
    updateFx(dt);
    updateInfection(dt, closest);
    state.score += dt * (state.level * 2);
    updateHud();
  }

  function renderLoop(now) {
    raf = requestAnimationFrame(renderLoop);
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    renderer.render(scene, camera);
  }

  function resize() {
    const rect = canvasWrap.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 960));
    const height = Math.max(220, Math.floor(rect.height || canvas.clientHeight || 540));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setMobileDirection(direction, on) {
    if (direction === "forward") input.forward = on;
    if (direction === "back") input.back = on;
    if (direction === "left") input.left = on;
    if (direction === "right") input.right = on;
  }

  function resetMobileInput() {
    input.forward = false;
    input.back = false;
    input.left = false;
    input.right = false;
    input.sprint = false;
    if (el.mobileControls) {
      el.mobileControls.querySelectorAll(".is-held").forEach((button) => button.classList.remove("is-held"));
    }
  }

  function isTouchLikePointer(event) {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }

  function applyLookDelta(dx, dy, scale = 1) {
    player.yaw -= dx * MOUSE_SENS * scale;
    if (player.yaw > Math.PI) player.yaw -= Math.PI * 2;
    if (player.yaw < -Math.PI) player.yaw += Math.PI * 2;
    player.pitch = clamp(player.pitch - dy * MOUSE_SENS * scale, -MAX_PITCH, MAX_PITCH);
  }

  function isLookBlockedTarget(target) {
    return Boolean(target && target.closest && target.closest(
      "button, a, input, select, textarea, .poop-mobile-pad, .poop-mobile-actions, .overlay--show"
    ));
  }

  function beginTouchLook(clientX, clientY, pointerId = "touch") {
    touchLook.active = true;
    touchLook.pointerId = pointerId;
    touchLook.lastX = clientX;
    touchLook.lastY = clientY;
  }

  function moveTouchLook(clientX, clientY) {
    if (!touchLook.active || state.mode !== "playing") return;
    const dx = clientX - touchLook.lastX;
    const dy = clientY - touchLook.lastY;
    touchLook.lastX = clientX;
    touchLook.lastY = clientY;
    applyLookDelta(dx, dy, 1.45);
  }

  function endTouchLook(pointerId) {
    if (!touchLook.active || touchLook.pointerId !== pointerId) return;
    touchLook.active = false;
    touchLook.pointerId = null;
  }

  function bindHoldButton(button, onPress, onRelease) {
    const release = (event) => {
      if (event && event.cancelable) event.preventDefault();
      button.classList.remove("is-held");
      onRelease();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add("is-held");
      if (button.setPointerCapture) {
        try { button.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      }
      onPress();
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }

  function bindTapButton(button, action) {
    let handledPointer = false;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add("is-held");
      handledPointer = true;
      action();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (handledPointer) {
        handledPointer = false;
        return;
      }
      button.classList.add("is-held");
      action();
      window.setTimeout(() => button.classList.remove("is-held"), 80);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
      button.addEventListener(type, (event) => {
        if (event && event.cancelable) event.preventDefault();
        button.classList.remove("is-held");
      });
    });
  }

  function bindMobileControls() {
    if (el.mobileControls && window.PointerEvent) {
      el.mobileControls.querySelectorAll("[data-mobile-dir]").forEach((button) => {
        const direction = button.dataset.mobileDir;
        bindHoldButton(button, () => setMobileDirection(direction, true), () => setMobileDirection(direction, false));
      });

      const fireButton = el.mobileControls.querySelector("[data-mobile-action='fire']");
      const sprintButton = el.mobileControls.querySelector("[data-mobile-action='sprint']");
      const switchButton = el.mobileControls.querySelector("[data-mobile-action='switch']");
      const useButton = el.mobileControls.querySelector("[data-mobile-action='use']");
      if (fireButton) bindTapButton(fireButton, fireWeapon);
      if (sprintButton) bindHoldButton(sprintButton, () => { input.sprint = true; }, () => { input.sprint = false; });
      if (switchButton) bindTapButton(switchButton, switchWeapon);
      if (useButton) bindTapButton(useButton, tryUseExit);
    }

    if (window.PointerEvent) {
      canvasWrap.addEventListener("pointerdown", (event) => {
        if (state.mode !== "playing" || isLookBlockedTarget(event.target)) return;
        if (event.pointerType === "mouse" && isPointerLocked()) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (isTouchLikePointer(event) && event.cancelable) event.preventDefault();
        beginTouchLook(event.clientX, event.clientY, event.pointerId);
        if (canvasWrap.setPointerCapture) {
          try { canvasWrap.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        }
      });

      canvasWrap.addEventListener("pointermove", (event) => {
        if (!touchLook.active || touchLook.pointerId !== event.pointerId || state.mode !== "playing") return;
        if (isTouchLikePointer(event) && event.cancelable) event.preventDefault();
        moveTouchLook(event.clientX, event.clientY);
      });

      const endPointerLook = (event) => endTouchLook(event.pointerId);
      canvasWrap.addEventListener("pointerup", endPointerLook);
      canvasWrap.addEventListener("pointercancel", endPointerLook);
      window.addEventListener("pointerup", endPointerLook);
      window.addEventListener("pointercancel", endPointerLook);
    } else {
      canvasWrap.addEventListener("touchstart", (event) => {
        if (state.mode !== "playing" || isLookBlockedTarget(event.target)) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        event.preventDefault();
        beginTouchLook(touch.clientX, touch.clientY, touch.identifier);
      }, { passive: false });

      canvasWrap.addEventListener("touchmove", (event) => {
        if (!touchLook.active || state.mode !== "playing") return;
        const touch = [...event.changedTouches].find((item) => item.identifier === touchLook.pointerId);
        if (!touch) return;
        event.preventDefault();
        moveTouchLook(touch.clientX, touch.clientY);
      }, { passive: false });

      const endTouch = (event) => {
        const touch = [...event.changedTouches].find((item) => item.identifier === touchLook.pointerId);
        if (touch) endTouchLook(touch.identifier);
      };
      canvasWrap.addEventListener("touchend", endTouch);
      canvasWrap.addEventListener("touchcancel", endTouch);
    }

    window.addEventListener("blur", resetMobileInput);
  }

  function bindControls() {
    document.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") input.forward = true;
      if (key === "s" || key === "arrowdown") input.back = true;
      if (key === "a" || key === "arrowleft") input.left = true;
      if (key === "d" || key === "arrowright") input.right = true;
      if (key === "shift") input.sprint = true;
      if (key === "1") state.weapon = "dart";
      if (key === "2") switchWeapon();
      if (key === "e" && state.mode === "playing") tryUseExit();
      if (key === "p") setPaused(state.mode === "playing");
      if (key === "escape" && state.mode === "playing") setPaused(true);
    });

    document.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") input.forward = false;
      if (key === "s" || key === "arrowdown") input.back = false;
      if (key === "a" || key === "arrowleft") input.left = false;
      if (key === "d" || key === "arrowright") input.right = false;
      if (key === "shift") input.sprint = false;
    });

    document.addEventListener("mousemove", (event) => {
      if (!isPointerLocked() || state.mode !== "playing") return;
      applyLookDelta(event.movementX, event.movementY);
    });

    document.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (state.mode === "playing" && isPointerLocked()) {
        event.preventDefault();
        fireWeapon();
      } else if (event.target === canvas) {
        lockPointer();
      }
    });

    canvas.addEventListener("click", () => {
      if (state.mode === "playing" && !isPointerLocked()) lockPointer();
    });

    window.addEventListener("resize", resize);
  }

  function bindButtons() {
    if (el.primary) {
      el.primary.addEventListener("click", () => {
        if (state.mode === "paused") setPaused(false);
        else if (state.mode === "complete") loadLevel(state.level + 1);
        else startRun();
      });
    }
    if (el.pause) el.pause.addEventListener("click", () => setPaused(state.mode === "playing"));
    if (el.restart) el.restart.addEventListener("click", startRun);
    if (el.lock) el.lock.addEventListener("click", lockPointer);
    if (el.sound) {
      el.sound.addEventListener("click", () => {
        state.sound = !state.sound;
        el.sound.textContent = state.sound ? "Sound on" : "Sound off";
        el.sound.setAttribute("aria-pressed", state.sound ? "true" : "false");
      });
    }
    if (el.freshAir) {
      el.freshAir.addEventListener("click", async () => {
        const ok = api.isAdFree && api.isAdFree() ? true : await api.showRewarded("fresh-air-purge");
        if (!ok) return;
        state.infection = Math.max(0, state.infection - 45);
        setStatus("Fresh-air purge activated.");
      });
    }
    if (el.shells) {
      el.shells.addEventListener("click", async () => {
        const ok = api.isAdFree && api.isAdFree() ? true : await api.showRewarded("shotgun-kit");
        if (!ok) return;
        state.shotgunUnlocked = true;
        state.shotgunAmmo += 12;
        state.weapon = "shotgun";
        setStatus("Shotgun kit unlocked.");
      });
    }
  }

  function initFullscreen() {
    const btn = el.fullscreen;
    if (!btn || !canvasWrap) return;
    const target = canvasWrap;
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isMaxed = () => target.classList.contains("is-maxed");
    function setMaxed(on) {
      target.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      btn.textContent = on ? "x" : "+";
      btn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      setTimeout(resize, 60);
    }
    function toggle() {
      const next = !isMaxed();
      setMaxed(next);
      if (next && target.requestFullscreen) {
        try {
          const ret = target.requestFullscreen();
          if (ret && ret.catch) ret.catch(() => {});
        } catch (error) { /* pseudo fullscreen is enough */ }
      } else if (!next && nativeFsEl() && document.exitFullscreen) {
        try { document.exitFullscreen(); } catch (error) { /* ignore */ }
      }
    }
    btn.addEventListener("click", toggle);
    document.addEventListener("fullscreenchange", () => {
      if (!nativeFsEl() && isMaxed()) setMaxed(false);
    });
  }

  function init() {
    state.map = generateMap(1);
    buildWorld();
    spawnEnemies();
    spawnPickups();
    const start = tileToWorld(state.map.start.gx, state.map.start.gy, state.map);
    player.x = start.x;
    player.z = start.z;
    camera.position.set(player.x, EYE_Y, player.z);
    updateExitDoor();
    updateHud();
    bindControls();
    bindMobileControls();
    bindButtons();
    initFullscreen();
    resize();
    lastTime = performance.now();
    raf = requestAnimationFrame(renderLoop);
  }

  window.__POOP_CRUISE = {
    state,
    player,
    startRun,
    loadLevel,
    fireWeapon,
    setInfection(value) {
      state.infection = clamp(Number(value) || 0, 0, 100);
      updateHud();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
    },
  };

  init();
})();
