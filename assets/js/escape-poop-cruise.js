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
    centerReload: $("hud-reload"),
    centerReloadTime: $("hud-reload-time"),
    centerLowAmmo: $("hud-low-ammo"),
    vignette: $("crud-vignette"),
    mobileControls: $("mobile-controls"),
    minimap: $("minimap"),
  };
  const minimapCtx = el.minimap && el.minimap.getContext ? el.minimap.getContext("2d") : null;

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
  const DART_RANGE = 13;
  const SHOTGUN_RANGE = 18;
  const SHOTGUN_PELLETS = 10;
  const SHOTGUN_RADIUS_BOOST = 0.34;
  const SHOTGUN_DOSE = 1.9;
  const SHOTGUN_COOLDOWN = 0.62;
  const DART_MAG_SIZE = 6;
  const DART_RELOAD_TIME = 1.18;
  const DART_START_RESERVE = 36;
  const SHOTGUN_TUBE_SIZE = 3;
  const SHOTGUN_RELOAD_TIME = 1.55;
  const MELEE_RANGE = 2.35;
  const MELEE_DOSE = 1.3;
  const MELEE_COOLDOWN = 0.55;
  const BOMB_START_AMMO = 2;
  const BOMB_MAX_AMMO = 9;
  const BOMB_RADIUS = 3.4;
  const BOMB_DOSE = 2.6;
  const BOMB_COOLDOWN = 0.9;
  const BOMB_THROW_RANGE = 9.5;
  const FRESH_VENT_HEAL_RATE = 4.6;
  const PROJECTILE_LIFE = 0.22;
  const WEAPON_LABELS = {
    dart: "Ivermectin Pistol",
    shotgun: "Silver Pumper",
    melee: "Support Plunger",
    bomb: "Stink Bomb",
  };
  const SHOTGUN_DISPLAY_NAME = "Colloidal Silver Pumper";
  const MELEE_DISPLAY_NAME = "Emotional Support Plunger";
  const BOMB_DISPLAY_NAME = "Probiotic Stink Bomb";
  const BOSS_NAMES = ["Buffet Baron", "Norovirus Admiral", "Poop Deck Leviathan", "Cruise Director of Doom"];
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
    runSeed: 0,
    score: 0,
    infection: 0,
    cures: 0,
    neededCures: 0,
    totalShots: 0,
    totalHits: 0,
    deckStart: 0,
    statusTimer: 0,
    lowAmmoFlashTimer: 0,
    lowAmmoCooldown: 0,
    lastAmmoSig: "",
    high: api.getHighScore(GAME_ID) || 0,
    sound: true,
    weapon: "melee",
    bossName: null,
    dartUnlocked: false,
    shotgunUnlocked: false,
    bombUnlocked: false,
    dartAmmo: DART_MAG_SIZE,
    dartReserve: DART_START_RESERVE,
    shotgunLoaded: 0,
    shotgunAmmo: 0,
    bombAmmo: BOMB_START_AMMO,
    dartCooldown: 0,
    shotgunCooldown: 0,
    meleeCooldown: 0,
    meleeSwing: 0,
    bombCooldown: 0,
    ambientTimer: 3.5,
    reloadTimer: 0,
    reloadDuration: 0,
    reloadWeapon: null,
    recoil: 0,
    muzzleFlash: 0,
    lurchTimer: 0,
    stuckTimer: 0,
    flowTimer: 0,
    flow: [],
    map: null,
    enemies: [],
    pickups: [],
    clouds: [],
    speeches: [],
    beams: [],
    particles: [],
    slimeBolts: [],
    props: [],
    bombs: [],
    discovered: null,
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

  const scriptUrl = document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href;
  const textureAssetBase = new URL("../img/escape-poop-cruise/", scriptUrl).href;
  const textureAssets = {
    wall: new URL("wall-atlas-ai-v1.png", textureAssetBase).href,
    floor: new URL("floor-atlas-ai-v1.png", textureAssetBase).href,
    ceiling: new URL("ceiling-atlas-ai-v1.png", textureAssetBase).href,
    details: new URL("detail-decal-atlas-ai-v1.png", textureAssetBase).href,
    objects: new URL("object-atlas-ai-v1.png", textureAssetBase).href,
    // Scatter-prop skins: drop a 4x4 atlas at this path (cells per PropTex
    // below) and every prop re-skins automatically — no code changes needed.
    // Until the atlas ships, keep this null so the flat fallback colours render
    // without a noisy 404 request in every player session.
    props: null,
    infection: new URL("infection-hazard-atlas-ai-v1.png", textureAssetBase).href,
    exitDoor: new URL("exit-door-ai-v2.png", textureAssetBase).href,
  };
  const soundAssetBase = new URL("../Sounds/escape-poop-cruise/", scriptUrl).href;
  const audioSamples = {
    dart: [{ file: "dart.mp3", volume: 0.36 }],
    shotgun: [{ file: "shotgun.mp3", volume: 0.72 }],
    hit: [{ file: "hit.mp3", volume: 0.36 }],
    cure: [{ file: "cure.mp3", volume: 0.46 }],
    pickup: [{ file: "pickup.mp3", volume: 0.42 }],
    damage: [{ file: "damage.mp3", volume: 0.46 }],
    spit: [{ file: "spit.mp3", volume: 0.34 }],
    level: [{ file: "level.mp3", volume: 0.5 }],
    gameover: [{ file: "gameover.mp3", volume: 0.58 }],
    step: [
      { file: "footstep-1.mp3", volume: 0.18 },
      { file: "footstep-2.mp3", volume: 0.18 },
      { file: "footstep-3.mp3", volume: 0.18 },
    ],
    // NOISE ALCHEMY horror pack: "dread" drones rotate as the ambient bed
    // while playing; "doom" hits are stingers for detections/bosses/deaths.
    dread: [
      { file: "dread-1.mp3", volume: 0.2 },
      { file: "dread-2.mp3", volume: 0.2 },
      { file: "dread-3.mp3", volume: 0.18 },
      { file: "dread-4.mp3", volume: 0.18 },
      { file: "dread-5.mp3", volume: 0.2 },
      { file: "dread-6.mp3", volume: 0.2 },
      { file: "dread-7.mp3", volume: 0.2 },
    ],
    doom: [
      { file: "doom-1.mp3", volume: 0.5 },
      { file: "doom-2.mp3", volume: 0.5 },
    ],
  };
  const audioStatus = {
    supported: Boolean(window.AudioContext || window.webkitAudioContext),
    unlocked: false,
    loading: 0,
    loaded: 0,
    failed: 0,
    played: 0,
    fallback: 0,
  };
  let audioCtx = null;
  let audioMaster = null;
  const audioBuffers = new Map();
  const audioLoads = new Map();
  const audioCooldowns = new Map();
  const stepAudio = { timer: 0, index: 0 };

  const textureAnisotropy = Math.min(
    4,
    renderer.capabilities && renderer.capabilities.getMaxAnisotropy
      ? renderer.capabilities.getMaxAnisotropy()
      : 1
  );

  function rgb(hex, shift = 0) {
    return {
      r: clamp(((hex >> 16) & 255) + shift, 0, 255),
      g: clamp(((hex >> 8) & 255) + shift, 0, 255),
      b: clamp((hex & 255) + shift, 0, 255),
    };
  }

  function rgba(hex, alpha, shift = 0) {
    const color = rgb(hex, shift);
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }

  function setupTexture(texture, options = {}) {
    texture.wrapS = options.wrapS || THREE.RepeatWrapping;
    texture.wrapT = options.wrapT || THREE.RepeatWrapping;
    texture.anisotropy = textureAnisotropy;
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = options.minFilter || THREE.LinearMipmapLinearFilter || THREE.LinearMipMapLinearFilter || THREE.LinearFilter;
    texture.magFilter = options.magFilter || THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function drawGrimeNoise(ctx, rng, size, density = 420) {
    for (let i = 0; i < density; i += 1) {
      const shade = randInt(rng, 0, 52);
      const alpha = 0.025 + rng() * 0.12;
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
      ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 5, 1 + rng() * 5);
    }
  }

  function drawBlot(ctx, rng, x, y, rx, ry, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rng() - 0.5) * Math.PI);
    ctx.fillStyle = rgba(color, alpha, randInt(rng, -12, 8));
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(
        (rng() - 0.5) * rx * 1.5,
        (rng() - 0.5) * ry * 1.4,
        rx * (0.12 + rng() * 0.36),
        ry * (0.1 + rng() * 0.32),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  function makeSurfaceTexture(kind, seed) {
    const size = 128;
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");
    const rng = mulberry32(seed);

    const palette = {
      wall: { base: 0x111927, deep: 0x05090f, grime: 0x5b4422, accent: 0x28384a },
      floor: { base: 0x1f1420, deep: 0x060507, grime: 0x43300f, accent: 0x473744 },
      ceiling: { base: 0x0d121c, deep: 0x020409, grime: 0x2c2b19, accent: 0x1e2a37 },
      hazard: { base: 0x261609, deep: 0x050301, grime: 0x5d4213, accent: 0x6b5f1e },
      fresh: { base: 0x10293a, deep: 0x031019, grime: 0x154851, accent: 0x2ee0ff },
    }[kind];

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, rgba(palette.base, 1, randInt(rng, -6, 6)));
    gradient.addColorStop(0.58, rgba(palette.deep, 1, randInt(rng, -2, 5)));
    gradient.addColorStop(1, rgba(palette.base, 1, randInt(rng, -24, -8)));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    drawGrimeNoise(ctx, rng, size, kind === "wall" ? 540 : 620);

    if (kind === "wall") {
      const seamX = 18 + rng() * 34;
      ctx.strokeStyle = rgba(0x000000, 0.45);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(seamX, 0);
      ctx.lineTo(seamX + (rng() - 0.5) * 8, size);
      ctx.stroke();
      ctx.strokeStyle = rgba(palette.accent, 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(5 + rng() * 12, 6 + rng() * 8, size - 18 - rng() * 18, size - 16 - rng() * 16);
      for (let i = 0; i < 5; i += 1) {
        const x = rng() * size;
        ctx.fillStyle = rgba(palette.grime, 0.25 + rng() * 0.18);
        ctx.fillRect(x, rng() * 32, 2 + rng() * 8, 24 + rng() * 78);
      }
    }

    if (kind === "floor" || kind === "hazard" || kind === "fresh") {
      ctx.strokeStyle = rgba(0x000000, 0.36);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, size * 0.5 + (rng() - 0.5) * 14);
      ctx.lineTo(size, size * 0.5 + (rng() - 0.5) * 14);
      ctx.moveTo(size * 0.5 + (rng() - 0.5) * 14, 0);
      ctx.lineTo(size * 0.5 + (rng() - 0.5) * 14, size);
      ctx.stroke();
      for (let i = 0; i < (kind === "hazard" ? 6 : 3); i += 1) {
        drawBlot(
          ctx,
          rng,
          rng() * size,
          rng() * size,
          10 + rng() * 30,
          7 + rng() * 24,
          kind === "fresh" ? 0x0d4c5b : palette.grime,
          kind === "hazard" ? 0.5 : 0.26
        );
      }
      if (kind === "fresh") {
        ctx.strokeStyle = rgba(palette.accent, 0.32);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12, 20 + rng() * 24);
        ctx.lineTo(size - 14, 16 + rng() * 30);
        ctx.stroke();
      }
    }

    if (kind === "ceiling") {
      ctx.strokeStyle = rgba(0x000000, 0.48);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        const y = 18 + i * 26 + (rng() - 0.5) * 6;
        ctx.beginPath();
        ctx.moveTo(4, y);
        ctx.lineTo(size - 4, y + (rng() - 0.5) * 5);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i += 1) {
        drawBlot(ctx, rng, rng() * size, rng() * size, 8 + rng() * 22, 18 + rng() * 30, palette.grime, 0.25);
      }
    }

    ctx.fillStyle = rgba(0x000000, 0.24);
    ctx.fillRect(0, 0, size, 4);
    ctx.fillRect(0, size - 4, size, 4);
    ctx.fillRect(0, 0, 4, size);
    ctx.fillRect(size - 4, 0, 4, size);

    return setupTexture(new THREE.CanvasTexture(canvasTexture));
  }

  function makeDecalTexture(seed, kind) {
    const size = 128;
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");
    const rng = mulberry32(seed);
    const base = kind === "puddle" ? 0x231707 : kind === "ceiling" ? 0x252315 : 0x4b3514;
    for (let i = 0; i < 7; i += 1) {
      drawBlot(
        ctx,
        rng,
        size * (0.22 + rng() * 0.56),
        size * (0.22 + rng() * 0.56),
        12 + rng() * 34,
        8 + rng() * 32,
        base,
        kind === "wall" ? 0.42 : 0.5
      );
    }
    if (kind === "puddle") {
      ctx.strokeStyle = "rgba(143, 122, 53, 0.34)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.ellipse(size / 2, size / 2, 20 + rng() * 36, 7 + rng() * 18, rng() * Math.PI, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    return setupTexture(new THREE.CanvasTexture(canvasTexture));
  }

  function makeInfectionCueTexture(kind) {
    const size = 128;
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");

    if (kind === "vapor") {
      const haze = ctx.createLinearGradient(0, size, 0, 0);
      haze.addColorStop(0, "rgba(138, 255, 46, 0)");
      haze.addColorStop(0.38, "rgba(138, 255, 46, 0.18)");
      haze.addColorStop(0.76, "rgba(198, 255, 56, 0.08)");
      haze.addColorStop(1, "rgba(138, 255, 46, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, size, size);

      ctx.lineCap = "round";
      for (let i = 0; i < 5; i += 1) {
        const x = 26 + i * 19;
        ctx.strokeStyle = `rgba(198, 255, 56, ${0.11 + i * 0.018})`;
        ctx.lineWidth = 5 - i * 0.35;
        ctx.beginPath();
        ctx.moveTo(x, size - 10);
        ctx.bezierCurveTo(x - 20, 86, x + 24, 58, x - 4, 18);
        ctx.stroke();
      }
    } else {
      const glow = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size * 0.54);
      glow.addColorStop(0, "rgba(198, 255, 56, 0.62)");
      glow.addColorStop(0.32, "rgba(138, 255, 46, 0.34)");
      glow.addColorStop(0.72, "rgba(92, 128, 19, 0.13)");
      glow.addColorStop(1, "rgba(92, 128, 19, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(210, 255, 93, 0.3)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.ellipse(size / 2, size / 2, 17 + i * 11, 7 + i * 7, i * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    return setupTexture(new THREE.CanvasTexture(canvasTexture), {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  function makeFreshAirCueTexture(kind) {
    const size = 128;
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");

    if (kind === "flow") {
      const haze = ctx.createLinearGradient(0, size, 0, 0);
      haze.addColorStop(0, "rgba(46, 224, 255, 0)");
      haze.addColorStop(0.32, "rgba(46, 224, 255, 0.22)");
      haze.addColorStop(0.72, "rgba(183, 255, 84, 0.15)");
      haze.addColorStop(1, "rgba(46, 224, 255, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, size, size);

      ctx.lineCap = "round";
      for (let i = 0; i < 6; i += 1) {
        const x = 18 + i * 18;
        ctx.strokeStyle = `rgba(181, 255, 245, ${0.13 + i * 0.012})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, size - 8);
        ctx.bezierCurveTo(x + 16, 92, x - 18, 58, x + 6, 16);
        ctx.stroke();
      }
    } else {
      const glow = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size * 0.55);
      glow.addColorStop(0, "rgba(181, 255, 245, 0.68)");
      glow.addColorStop(0.32, "rgba(46, 224, 255, 0.35)");
      glow.addColorStop(0.7, "rgba(183, 255, 84, 0.16)");
      glow.addColorStop(1, "rgba(46, 224, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(181, 255, 245, 0.36)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.ellipse(size / 2, size / 2, 18 + i * 10, 10 + i * 8, i * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    return setupTexture(new THREE.CanvasTexture(canvasTexture), {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  function keyBlackToAlpha(ctx, size, threshold = 12) {
    const imageData = ctx.getImageData(0, 0, size, size);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (max <= threshold) {
        pixels[i + 3] = 0;
      } else if (max < threshold + 62) {
        pixels[i + 3] = Math.min(pixels[i + 3], Math.round((max - threshold) * 4.1));
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function isFileProtocol() {
    return window.location && window.location.protocol === "file:";
  }

  function atlasCellBounds(image, index, options = {}) {
    const grid = options.grid || 4;
    const inset = options.cropInset ?? 0.026;
    const cellW = image.naturalWidth / grid;
    const cellH = image.naturalHeight / grid;
    const col = index % grid;
    const row = Math.floor(index / grid);
    const sx = col * cellW + cellW * inset;
    const sy = row * cellH + cellH * inset;
    const sw = cellW * (1 - inset * 2);
    const sh = cellH * (1 - inset * 2);
    return { sx, sy, sw, sh };
  }

  function makeAtlasCellTextureDirect(image, index, options = {}) {
    const { sx, sy, sw, sh } = atlasCellBounds(image, index, options);
    const texture = setupTexture(new THREE.Texture(image), {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    texture.repeat.set(sw / image.naturalWidth, sh / image.naturalHeight);
    texture.offset.set(sx / image.naturalWidth, 1 - (sy + sh) / image.naturalHeight);
    texture.needsUpdate = true;
    return texture;
  }

  function makeAtlasCellTexture(image, index, options = {}) {
    if (isFileProtocol() && !options.blackKey) {
      return makeAtlasCellTextureDirect(image, index, options);
    }
    const grid = options.grid || 4;
    const size = options.size || 256;
    const { sx, sy, sw, sh } = atlasCellBounds(image, index, options);
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
    if (options.blackKey) keyBlackToAlpha(ctx, size, options.blackKeyThreshold || 12);
    return setupTexture(new THREE.CanvasTexture(canvasTexture), {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  const textureLoadStatus = { pending: 0, loaded: 0, failed: 0, skipped: 0 };
  const textureReadyPromises = [];
  const warnedTextureUrls = new Set();

  function trackTextureLoad(url, label, applyImage) {
    textureLoadStatus.pending += 1;
    const image = new Image();
    image.decoding = "async";
    const promise = new Promise((resolve) => {
      image.onload = () => {
        try {
          applyImage(image);
          textureLoadStatus.loaded += 1;
        } catch (error) {
          textureLoadStatus.failed += 1;
          console.warn(`${label} failed to apply: ${url}`, error);
        } finally {
          textureLoadStatus.pending = Math.max(0, textureLoadStatus.pending - 1);
          resolve(image);
        }
      };
      image.onerror = () => {
        textureLoadStatus.failed += 1;
        textureLoadStatus.pending = Math.max(0, textureLoadStatus.pending - 1);
        // Optional atlases (e.g. the drop-in AI prop atlas) 404 by design
        // until generated — warn once per URL instead of spamming.
        if (!warnedTextureUrls.has(url)) {
          warnedTextureUrls.add(url);
          console.warn(`${label} failed to load (fallback art in use): ${url}`);
        }
        resolve(null);
      };
    });
    textureReadyPromises.push(promise);
    image.src = url;
    return image;
  }

  function skipExternalTextureForFileProtocol() {
    if (!isFileProtocol()) return false;
    textureLoadStatus.skipped += 1;
    return true;
  }

  function waitForTextureLoads() {
    return Promise.all(textureReadyPromises).then(() => textureLoadStatus);
  }

  function loadAtlasIntoMaterials(url, materials, options = {}) {
    if (skipExternalTextureForFileProtocol()) return;
    trackTextureLoad(url, "Texture atlas", (image) => {
      const grid = options.grid || 4;
      const maxCells = grid * grid;
      materials.forEach((mat, index) => {
        mat.map = makeAtlasCellTexture(image, index % maxCells, options);
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });
    });
  }

  function makeMaterialVariants(kind, count, atlasUrl) {
    const materials = Array.from({ length: count }, (_, index) => {
      const texture = makeSurfaceTexture(kind, 0x9E3779B9 ^ Math.imul(index + 1, 0x85ebca6b));
      return new THREE.MeshLambertMaterial({ color: 0xffffff, map: texture });
    });
    if (atlasUrl) loadAtlasIntoMaterials(atlasUrl, materials, { grid: 4, size: 256, cropInset: 0.032 });
    return materials;
  }

  function makeGeneratedDetailMaterials(count, atlasUrl) {
    const materials = Array.from({ length: count }, (_, index) => new THREE.MeshBasicMaterial({
      map: makeDecalTexture(0xD37A11 ^ Math.imul(index + 11, 0x45d9f3b), index % 3 === 0 ? "puddle" : "wall"),
      transparent: true,
      opacity: 0.86,
      alphaTest: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    if (atlasUrl) {
      loadAtlasIntoMaterials(atlasUrl, materials, {
        grid: 4,
        size: 256,
        cropInset: 0.045,
        blackKey: true,
        blackKeyThreshold: 10,
      });
    }
    return materials;
  }

  function makeObjectMaterials(atlasUrl) {
    const fallbacks = [
      { color: 0x6d1f1b, emissive: 0x180505 },
      { color: 0x123d46, emissive: 0x0d363a },
      { color: 0x8c6c1a, emissive: 0x171004 },
      { color: 0x2f2d29, emissive: 0x030303 },
      { color: 0x15586a, emissive: 0x08232b },
      { color: 0x6b5630, emissive: 0x120d06 },
      { color: 0x8f1d56, emissive: 0x210716 },
      { color: 0x5f5a52, emissive: 0x050505 },
      { color: 0x35522a, emissive: 0x071407 },
      { color: 0xa5621e, emissive: 0x170b02 },
      { color: 0x5f543e, emissive: 0x060504 },
      { color: 0x5b3617, emissive: 0x0b0502 },
      { color: 0x46352b, emissive: 0x050303 },
      { color: 0x4a4a3a, emissive: 0x050504 },
      { color: 0x735a25, emissive: 0x0d0902 },
      { color: 0x222a2c, emissive: 0x050808 },
    ];
    const materials = fallbacks.map((fallback) => new THREE.MeshLambertMaterial({
      color: fallback.color,
      emissive: fallback.emissive,
      side: THREE.DoubleSide,
    }));
    if (atlasUrl) loadAtlasIntoMaterials(atlasUrl, materials, { grid: 4, size: 256, cropInset: 0.034 });
    return materials;
  }

  const materialSets = {
    wall: makeMaterialVariants("wall", 16, textureAssets.wall),
    floor: makeMaterialVariants("floor", 16, textureAssets.floor),
    ceiling: makeMaterialVariants("ceiling", 16, textureAssets.ceiling),
    hazard: makeMaterialVariants("hazard", 16, textureAssets.infection),
    fresh: makeMaterialVariants("fresh", 16, textureAssets.floor),
  };

  const decalMats = {
    floor: Array.from({ length: 10 }, (_, index) => new THREE.MeshBasicMaterial({
      map: makeDecalTexture(0xA511E9 ^ Math.imul(index + 3, 0x27d4eb2d), "puddle"),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
    wall: Array.from({ length: 8 }, (_, index) => new THREE.MeshBasicMaterial({
      map: makeDecalTexture(0xBADC0DE ^ Math.imul(index + 5, 0x165667b1), "wall"),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
    ceiling: Array.from({ length: 6 }, (_, index) => new THREE.MeshBasicMaterial({
      map: makeDecalTexture(0xCE11A9 ^ Math.imul(index + 7, 0x1b873593), "ceiling"),
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
  };

  const detailMats = makeGeneratedDetailMaterials(16, textureAssets.details);
  const objectMats = makeObjectMaterials(textureAssets.objects);

  // ---- Scatter props (cruise clutter) ----
  // Texture manifest for prop-atlas-ai-v1.png: a 4x4 grid where each cell
  // skins one surface below. Generate the atlas with AI later, drop it in
  // assets/img/escape-poop-cruise/, and loadAtlasIntoMaterials re-skins every
  // prop; until then the fallback colours keep everything readable.
  const PropTex = {
    TRASH_CAN: 0,
    TRASH_LID: 1,
    DECK_CHAIR: 2,
    LOUNGER: 3,
    TABLE: 4,
    PLANT_POT: 5,
    PLANT_LEAVES: 6,
    SUITCASE: 7,
    LIFE_RING: 8,
    BAR_STOOL: 9,
    CART: 10,
    BARREL: 11,
    CRATE: 12,
    TOWELS: 13,
    UMBRELLA: 14,
    METAL: 15,
  };

  function makePropMaterials(atlasUrl) {
    const fallbacks = [
      { color: 0x46545c, emissive: 0x060a0c }, // trash can
      { color: 0x2b363c, emissive: 0x040606 }, // trash lid
      { color: 0x8a6b3a, emissive: 0x0d0a05 }, // deck chair wood
      { color: 0x2e6f8a, emissive: 0x06121a }, // lounger canvas
      { color: 0x6b4a2a, emissive: 0x0a0704 }, // table top
      { color: 0x7a4a30, emissive: 0x0b0704 }, // plant pot
      { color: 0x2e6b2a, emissive: 0x061206 }, // plant leaves
      { color: 0x8a2f4f, emissive: 0x12060b }, // suitcase
      { color: 0xd8d0c2, emissive: 0x111008 }, // life ring
      { color: 0x5a3a20, emissive: 0x080503 }, // bar stool
      { color: 0x8d949b, emissive: 0x0b0d0f }, // service cart
      { color: 0x6b3320, emissive: 0x0a0503 }, // barrel
      { color: 0x7a5c33, emissive: 0x0b0805 }, // crate
      { color: 0xcac4b2, emissive: 0x100f0a }, // towels
      { color: 0xc7452e, emissive: 0x140604 }, // umbrella
      { color: 0x77828b, emissive: 0x090b0d }, // metal frames/poles
    ];
    const materials = fallbacks.map((fallback) => new THREE.MeshLambertMaterial({
      color: fallback.color,
      emissive: fallback.emissive,
      side: THREE.DoubleSide,
    }));
    if (atlasUrl) loadAtlasIntoMaterials(atlasUrl, materials, { grid: 4, size: 256, cropInset: 0.034 });
    return materials;
  }

  const propMats = makePropMaterials(textureAssets.props);

  // Shared prop geometry so 40+ props per deck don't allocate per-instance.
  const propGeo = {
    trashBody: new THREE.CylinderGeometry(0.3, 0.26, 0.78, 10),
    trashLid: new THREE.CylinderGeometry(0.33, 0.33, 0.07, 10),
    box: new THREE.BoxGeometry(1, 1, 1),
    tableTop: new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12),
    pole: new THREE.CylinderGeometry(0.05, 0.07, 1, 8),
    diskBase: new THREE.CylinderGeometry(0.3, 0.32, 0.05, 10),
    pot: new THREE.CylinderGeometry(0.22, 0.3, 0.42, 10),
    leaf: new THREE.SphereGeometry(0.24, 7, 6),
    ring: new THREE.TorusGeometry(0.3, 0.09, 8, 14),
    stoolSeat: new THREE.CylinderGeometry(0.24, 0.24, 0.07, 10),
    wheel: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8),
    barrel: new THREE.CylinderGeometry(0.32, 0.34, 0.85, 12),
    barrelRing: new THREE.CylinderGeometry(0.35, 0.35, 0.04, 12),
  };

  function propBox(group, mat, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
    const mesh = new THREE.Mesh(propGeo.box, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  }

  function propMesh(group, geom, mat, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.setScalar(s);
    group.add(mesh);
    return mesh;
  }

  // Each entry builds one clutter piece into `group` and returns its
  // collision radius. Every visible surface pulls from propMats so the AI
  // atlas can re-skin it without touching this code.
  const PROP_BUILDERS = {
    trash(group) {
      propMesh(group, propGeo.trashBody, propMats[PropTex.TRASH_CAN], 0, 0.39, 0);
      const lid = propMesh(group, propGeo.trashLid, propMats[PropTex.TRASH_LID], 0.07, 0.82, 0);
      lid.rotation.z = 0.14;
      return 0.44;
    },
    chair(group) {
      const wood = propMats[PropTex.DECK_CHAIR];
      const metal = propMats[PropTex.METAL];
      propBox(group, wood, 0, 0.44, 0, 0.52, 0.06, 0.5);
      propBox(group, wood, 0, 0.74, -0.26, 0.52, 0.62, 0.06, 0, -0.18);
      propBox(group, metal, -0.22, 0.21, 0.2, 0.05, 0.42, 0.05);
      propBox(group, metal, 0.22, 0.21, 0.2, 0.05, 0.42, 0.05);
      propBox(group, metal, -0.22, 0.21, -0.2, 0.05, 0.42, 0.05);
      propBox(group, metal, 0.22, 0.21, -0.2, 0.05, 0.42, 0.05);
      return 0.46;
    },
    lounger(group) {
      const canvas = propMats[PropTex.LOUNGER];
      const metal = propMats[PropTex.METAL];
      propBox(group, canvas, 0, 0.26, 0.18, 0.6, 0.11, 1.06);
      propBox(group, canvas, 0, 0.5, -0.6, 0.6, 0.09, 0.62, 0, -0.72);
      propBox(group, metal, -0.26, 0.1, 0.5, 0.05, 0.2, 0.05);
      propBox(group, metal, 0.26, 0.1, 0.5, 0.05, 0.2, 0.05);
      propBox(group, metal, -0.26, 0.1, -0.35, 0.05, 0.2, 0.05);
      propBox(group, metal, 0.26, 0.1, -0.35, 0.05, 0.2, 0.05);
      return 0.62;
    },
    table(group) {
      propMesh(group, propGeo.tableTop, propMats[PropTex.TABLE], 0, 0.74, 0);
      const pole = propMesh(group, propGeo.pole, propMats[PropTex.METAL], 0, 0.37, 0);
      pole.scale.y = 0.72;
      propMesh(group, propGeo.diskBase, propMats[PropTex.METAL], 0, 0.03, 0);
      return 0.6;
    },
    plant(group) {
      propMesh(group, propGeo.pot, propMats[PropTex.PLANT_POT], 0, 0.21, 0);
      propMesh(group, propGeo.leaf, propMats[PropTex.PLANT_LEAVES], 0, 0.66, 0, 0, 0, 0, 1.15);
      propMesh(group, propGeo.leaf, propMats[PropTex.PLANT_LEAVES], 0.14, 0.86, 0.05, 0, 0, 0, 0.85);
      propMesh(group, propGeo.leaf, propMats[PropTex.PLANT_LEAVES], -0.13, 0.82, -0.08, 0, 0, 0, 0.72);
      return 0.36;
    },
    suitcase(group) {
      propBox(group, propMats[PropTex.SUITCASE], 0, 0.36, 0, 0.52, 0.72, 0.24);
      propBox(group, propMats[PropTex.METAL], 0, 0.76, 0, 0.2, 0.06, 0.06);
      return 0.4;
    },
    ring(group) {
      const mesh = propMesh(group, propGeo.ring, propMats[PropTex.LIFE_RING], 0, 0.33, 0);
      mesh.rotation.z = 0.18;
      return 0.34;
    },
    stool(group) {
      propMesh(group, propGeo.stoolSeat, propMats[PropTex.BAR_STOOL], 0, 0.6, 0);
      const pole = propMesh(group, propGeo.pole, propMats[PropTex.METAL], 0, 0.3, 0);
      pole.scale.y = 0.58;
      propMesh(group, propGeo.diskBase, propMats[PropTex.METAL], 0, 0.03, 0, 0, 0, 0, 0.8);
      return 0.3;
    },
    cart(group) {
      const body = propMats[PropTex.CART];
      const metal = propMats[PropTex.METAL];
      propBox(group, body, 0, 0.52, 0, 0.68, 0.6, 1.02);
      propBox(group, metal, 0, 0.92, 0.54, 0.6, 0.05, 0.06);
      [-0.26, 0.26].forEach((x) => [-0.4, 0.4].forEach((z) => {
        const wheel = propMesh(group, propGeo.wheel, metal, x, 0.1, z);
        wheel.rotation.z = Math.PI / 2;
      }));
      return 0.64;
    },
    barrel(group) {
      propMesh(group, propGeo.barrel, propMats[PropTex.BARREL], 0, 0.43, 0);
      propMesh(group, propGeo.barrelRing, propMats[PropTex.METAL], 0, 0.2, 0);
      propMesh(group, propGeo.barrelRing, propMats[PropTex.METAL], 0, 0.66, 0);
      return 0.44;
    },
    crate(group) {
      propBox(group, propMats[PropTex.CRATE], 0, 0.36, 0, 0.72, 0.72, 0.72);
      propBox(group, propMats[PropTex.CRATE], 0.12, 0.86, 0.05, 0.4, 0.28, 0.4, 0.5);
      return 0.52;
    },
    towels(group) {
      const mat = propMats[PropTex.TOWELS];
      propBox(group, mat, 0, 0.09, 0, 0.5, 0.18, 0.36);
      propBox(group, mat, 0.03, 0.26, -0.02, 0.44, 0.16, 0.32, 0.2);
      propBox(group, mat, -0.02, 0.4, 0.02, 0.36, 0.12, 0.28, -0.28);
      return 0.32;
    },
    umbrella(group) {
      const pole = propMesh(group, propGeo.pole, propMats[PropTex.METAL], 0, 0.85, 0);
      pole.scale.y = 1.7;
      const top = propMesh(group, propGeo.pot, propMats[PropTex.UMBRELLA], 0, 1.72, 0, Math.PI, 0, 0, 2.4);
      top.scale.y = 0.9;
      propMesh(group, propGeo.diskBase, propMats[PropTex.METAL], 0, 0.03, 0, 0, 0, 0, 1.2);
      return 0.4;
    },
    vending(group) {
      propBox(group, propMats[PropTex.CART], 0, 0.95, 0, 0.92, 1.9, 0.68);
      propBox(group, propMats[PropTex.TOWELS], -0.08, 1.05, -0.36, 0.56, 1.3, 0.05);
      propBox(group, propMats[PropTex.METAL], 0.3, 0.85, -0.36, 0.16, 0.9, 0.04);
      propBox(group, propMats[PropTex.METAL], 0, 0.06, 0, 0.94, 0.12, 0.7);
      return 0.72;
    },
    sofa(group) {
      const cushion = propMats[PropTex.LOUNGER];
      propBox(group, cushion, 0, 0.28, 0, 1.5, 0.42, 0.62);
      propBox(group, cushion, 0, 0.62, -0.24, 1.5, 0.5, 0.18, 0, -0.1);
      propBox(group, cushion, -0.72, 0.5, 0, 0.18, 0.5, 0.6);
      propBox(group, cushion, 0.72, 0.5, 0, 0.18, 0.5, 0.6);
      return 0.9;
    },
    buffet(group) {
      propBox(group, propMats[PropTex.TOWELS], 0, 0.42, 0, 1.9, 0.8, 0.75);
      propBox(group, propMats[PropTex.TABLE], 0, 0.85, 0, 2.0, 0.07, 0.85);
      propBox(group, propMats[PropTex.METAL], -0.55, 0.94, 0, 0.5, 0.1, 0.34);
      propBox(group, propMats[PropTex.METAL], 0.15, 0.93, 0.1, 0.4, 0.08, 0.3, 0.4);
      propBox(group, propMats[PropTex.BARREL], 0.7, 0.99, -0.12, 0.22, 0.22, 0.22, 0.2);
      return 1.05;
    },
    luggagePile(group) {
      propBox(group, propMats[PropTex.SUITCASE], -0.15, 0.28, 0, 0.55, 0.56, 0.8, 0.12);
      propBox(group, propMats[PropTex.CRATE], 0.32, 0.22, 0.1, 0.5, 0.44, 0.5, -0.4);
      propBox(group, propMats[PropTex.SUITCASE], 0.08, 0.72, -0.05, 0.48, 0.32, 0.62, 0.5, 0, 0.06);
      propBox(group, propMats[PropTex.METAL], -0.15, 0.6, 0, 0.1, 0.08, 0.82);
      return 0.75;
    },
  };
  const PROP_KINDS = Object.keys(PROP_BUILDERS);

  // Rooms only (corridors stay clear so enemy pathing never bottlenecks),
  // interiors only (never up against walls or doorways), deterministic per
  // level seed via tileHash.
  function scatterProps() {
    state.props = [];
    const map = state.map;
    if (!map || !map.rooms) return;
    map.rooms.forEach((room, roomIndex) => {
      if (room.w < 4 || room.h < 4) return;
      const target = clamp(Math.round(room.w * room.h * 0.2), 2, 8);
      let placed = 0;
      for (let attempt = 0; attempt < target * 4 && placed < target; attempt += 1) {
        const salt = 700 + roomIndex * 37 + attempt * 13;
        const gx = room.x + 1 + Math.floor(tileHash(room.x, room.y, salt) * (room.w - 2));
        const gy = room.y + 1 + Math.floor(tileHash(room.x, room.y, salt + 1) * (room.h - 2));
        if (tileAt(gx, gy, map) !== Tile.FLOOR) continue;
        const startDist = Math.abs(gx - map.start.gx) + Math.abs(gy - map.start.gy);
        const exitDist = Math.abs(gx - map.exit.gx) + Math.abs(gy - map.exit.gy);
        if (startDist < 3 || exitDist < 2) continue;
        const pos = tileToWorld(gx, gy, map);
        const x = pos.x + tileRange(gx, gy, salt + 2, -0.9, 0.9);
        const z = pos.z + tileRange(gx, gy, salt + 3, -0.9, 0.9);
        if (state.props.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 1.35)) continue;
        const kind = PROP_KINDS[Math.floor(tileHash(gx, gy, salt + 4) * PROP_KINDS.length) % PROP_KINDS.length];
        const group = new THREE.Group();
        const radius = PROP_BUILDERS[kind](group);
        group.position.set(x, 0, z);
        group.rotation.y = tileRange(gx, gy, salt + 5, -Math.PI, Math.PI);
        const scale = tileRange(gx, gy, salt + 6, 1.02, 1.38);
        group.scale.setScalar(scale);
        world.add(group);
        state.props.push({ kind, x, z, radius: radius * scale });
        placed += 1;
      }
    });
  }

  // Circle-vs-props check used by player + enemy movement. Only blocks moves
  // that get CLOSER to an overlapped prop, so anything that spawns clipped
  // can always walk itself free instead of being stuck forever.
  function collidesWithProps(nx, nz, radius, curX, curZ) {
    for (const prop of state.props) {
      const minDist = radius + prop.radius;
      const dx = nx - prop.x;
      const dz = nz - prop.z;
      if (Math.abs(dx) > minDist || Math.abs(dz) > minDist) continue;
      const nextSq = dx * dx + dz * dz;
      if (nextSq >= minDist * minDist) continue;
      const curDx = curX - prop.x;
      const curDz = curZ - prop.z;
      if (curDx * curDx + curDz * curDz <= nextSq) continue;
      return true;
    }
    return false;
  }

  const ObjectTex = {
    EXIT_LOCKED: 0,
    EXIT_OPEN: 1,
    CAUTION: 2,
    VENT: 3,
    MEDKIT: 4,
    SHELLS: 5,
    WEAPON_CRATE: 6,
    PASSENGER_SHIRT: 7,
    COUGHER_JACKET: 8,
    LIFE_VEST: 9,
    LUGGAGE_TAG: 10,
    BUFFET_TRAY: 11,
    PIPE: 12,
    MAP_POSTER: 13,
    BRASS_SIGN: 14,
    CONTROL_PANEL: 15,
  };

  function makeObjectCellMaterial(index, fallback, tintColor = 0xffffff) {
    const mat = new THREE.MeshLambertMaterial({
      color: fallback.color,
      emissive: fallback.emissive || 0x000000,
      transparent: Boolean(fallback.transparent),
      opacity: fallback.opacity ?? 1,
      depthWrite: fallback.depthWrite ?? true,
      side: THREE.DoubleSide,
    });
    if (skipExternalTextureForFileProtocol()) return mat;
    trackTextureLoad(textureAssets.objects, "Object texture atlas", (image) => {
      mat.map = makeAtlasCellTexture(image, index, { grid: 4, size: 256, cropInset: 0.034 });
      mat.color.set(tintColor);
      mat.needsUpdate = true;
    });
    return mat;
  }

  function makeTextureMaterial(url, fallback, options = {}) {
    const mat = new THREE.MeshLambertMaterial({
      color: fallback.color,
      emissive: fallback.emissive || 0x000000,
      transparent: Boolean(fallback.transparent),
      opacity: fallback.opacity ?? 1,
      depthWrite: fallback.depthWrite ?? true,
      side: options.side || THREE.DoubleSide,
    });
    if (skipExternalTextureForFileProtocol()) return mat;
    trackTextureLoad(url, "Texture", (image) => {
      mat.map = setupTexture(new THREE.Texture(image), {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
      mat.color.set(options.tintColor || 0xffffff);
      mat.needsUpdate = true;
    });
    return mat;
  }

  const exitDoorMat = makeTextureMaterial(
    textureAssets.exitDoor,
    { color: 0x263039, emissive: 0x020405 },
    { tintColor: 0xffffff }
  );

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
    wall: materialSets.wall[0],
    wallDark: materialSets.wall[3],
    floor: materialSets.floor[0],
    carpet: materialSets.floor[4],
    ceiling: materialSets.ceiling[0],
    exitLocked: exitDoorMat,
    exitOpen: exitDoorMat,
    fresh: materialSets.fresh[0],
    hazard: materialSets.hazard[0],
    trim: new THREE.MeshLambertMaterial({ color: 0x8d6f23, emissive: 0x1f1604 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xb7ff54, emissive: 0x1b3b0a }),
    maw: new THREE.MeshBasicMaterial({ color: 0x07090a }),
    shoe: new THREE.MeshLambertMaterial({ color: 0x1a1712, emissive: 0x050403 }),
    passenger: objectMats[ObjectTex.PASSENGER_SHIRT],
    cougher: objectMats[ObjectTex.COUGHER_JACKET],
    sprinter: objectMats[ObjectTex.LIFE_VEST],
    dart: new THREE.MeshBasicMaterial({ color: 0x2ee0ff }),
    freshVent: objectMats[ObjectTex.VENT],
    freshAirGlow: new THREE.MeshBasicMaterial({
      map: makeFreshAirCueTexture("glow"),
      transparent: true,
      opacity: 0.78,
      alphaTest: 0.025,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    freshAirFlow: new THREE.MeshBasicMaterial({
      map: makeFreshAirCueTexture("flow"),
      transparent: true,
      opacity: 0.58,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    freshAirCore: new THREE.MeshBasicMaterial({ color: 0xb5fff5, transparent: true, opacity: 0.62, depthWrite: false }),
    pickup: objectMats[ObjectTex.SHELLS],
    freshPickup: makeObjectCellMaterial(ObjectTex.MEDKIT, { color: 0x6d7b72, emissive: 0x060909 }, 0xdfe6dc),
    shotgun: objectMats[ObjectTex.WEAPON_CRATE],
    hazardProp: objectMats[ObjectTex.BUFFET_TRAY],
    porthole: new THREE.MeshLambertMaterial({ color: 0x163b54, emissive: 0x071a29 }),
    sickLight: new THREE.MeshBasicMaterial({ color: 0xb7ff54, transparent: true, opacity: 0.58 }),
    infectionGlow: new THREE.MeshBasicMaterial({
      map: makeInfectionCueTexture("glow"),
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.025,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    infectionBubble: new THREE.MeshBasicMaterial({ color: 0xc8ff36, transparent: true, opacity: 0.62, depthWrite: false }),
    infectionVapor: new THREE.MeshBasicMaterial({
      map: makeInfectionCueTexture("vapor"),
      transparent: true,
      opacity: 0.46,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    debrisDark: new THREE.MeshLambertMaterial({ color: 0x14120e }),
    debrisPaper: objectMats[ObjectTex.MAP_POSTER],
    debrisRust: objectMats[ObjectTex.PIPE],
    luggage: objectMats[ObjectTex.LUGGAGE_TAG],
    exitLightBack: new THREE.MeshLambertMaterial({ color: 0x171a18, emissive: 0x010101 }),
    exitLightLocked: new THREE.MeshBasicMaterial({ color: 0xff2b36 }),
    exitLightOpen: new THREE.MeshBasicMaterial({ color: 0x68ff72 }),
    exitLightHaloLocked: new THREE.MeshBasicMaterial({ color: 0xff2b36, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    exitLightHaloOpen: new THREE.MeshBasicMaterial({ color: 0x68ff72, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  };

  const geoms = {
    wall: new THREE.BoxGeometry(TILE, WALL_H, TILE),
    floor: new THREE.BoxGeometry(TILE, 0.08, TILE),
    ceiling: new THREE.BoxGeometry(TILE, 0.08, TILE),
    door: new THREE.BoxGeometry(TILE * 0.82, WALL_H * 0.78, 0.22),
    doorPost: new THREE.BoxGeometry(0.16, WALL_H * 0.82, 0.28),
    doorHeader: new THREE.BoxGeometry(TILE * 1.02, 0.18, 0.3),
    stairStep: new THREE.BoxGeometry(TILE * 0.68, 0.13, 0.42),
    trim: new THREE.BoxGeometry(TILE * 0.9, 0.08, TILE * 0.12),
    body: new THREE.CylinderGeometry(0.38, 0.48, 1.1, 7),
    head: new THREE.SphereGeometry(0.34, 8, 6),
    arm: new THREE.BoxGeometry(0.18, 0.78, 0.18),
    leg: new THREE.BoxGeometry(0.2, 0.68, 0.2),
    hand: new THREE.BoxGeometry(0.22, 0.2, 0.22),
    foot: new THREE.BoxGeometry(0.26, 0.16, 0.36),
    eye: new THREE.SphereGeometry(0.062, 6, 5),
    maw: new THREE.BoxGeometry(0.3, 0.14, 0.18),
    belly: new THREE.SphereGeometry(0.42, 8, 6),
    pickup: new THREE.BoxGeometry(0.64, 0.64, 0.64),
    tube: new THREE.CylinderGeometry(0.06, 0.06, 0.75, 8),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    floorDecal: new THREE.PlaneGeometry(1, 1),
    wallDecal: new THREE.PlaneGeometry(1, 1),
    debrisSmall: new THREE.BoxGeometry(0.32, 0.08, 0.22),
    debrisLong: new THREE.BoxGeometry(0.68, 0.07, 0.16),
    debrisFlat: new THREE.BoxGeometry(0.55, 0.035, 0.42),
  };

  let exitDoor = null;
  let lastTime = performance.now();
  let raf = 0;

  // ---- First-person weapon viewmodel ----
  // The camera is added to the scene graph so meshes parented to it render as
  // a held viewmodel (bottom-right of the view), swapped by the active weapon.
  scene.add(camera);
  const weaponGroup = new THREE.Group();
  weaponGroup.position.set(0.2, -0.18, -0.5);
  camera.add(weaponGroup);

  function makeWeaponTexture(kind, seed = 0x51c0ffee) {
    const size = 128;
    const canvasTexture = document.createElement("canvas");
    canvasTexture.width = size;
    canvasTexture.height = size;
    const ctx = canvasTexture.getContext("2d");
    const rng = mulberry32(seed ^ kind.length);
    const profile = {
      pistolMetal: { base: 0x516371, deep: 0x1a222c, accent: 0x2ee0ff, scratches: 90 },
      pistolGrip: { base: 0x171a1f, deep: 0x070809, accent: 0xb7ff54, scratches: 50 },
      barrel: { base: 0x24282e, deep: 0x05070d, accent: 0x6f7782, scratches: 74 },
      vialGlass: { base: 0x2ee0ff, deep: 0x0b4c53, accent: 0xb7ff54, scratches: 36 },
      shotgunBody: { base: 0x544a58, deep: 0x15111a, accent: 0xff2e88, scratches: 86 },
      shotgunPump: { base: 0xdad2a1, deep: 0x4f4022, accent: 0xb7ff54, scratches: 60 },
      silverTube: { base: 0xcde9f5, deep: 0x37586b, accent: 0x2ee0ff, scratches: 46 },
      plungerWood: { base: 0xa9814f, deep: 0x4a331c, accent: 0xd9b98a, scratches: 70 },
      plungerRubber: { base: 0x8a2a26, deep: 0x2e0c0a, accent: 0xc75b52, scratches: 40 },
      bombJar: { base: 0x9fd45a, deep: 0x2c4d16, accent: 0xe4ffb0, scratches: 30 },
    }[kind] || { base: 0x343b44, deep: 0x0c0f14, accent: 0x2ee0ff, scratches: 64 };

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, rgba(profile.base, 1, 18));
    gradient.addColorStop(0.48, rgba(profile.base, 1, -4));
    gradient.addColorStop(1, rgba(profile.deep, 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.34;
    ctx.fillStyle = rgba(profile.accent, 0.55);
    for (let y = -size; y < size * 2; y += kind === "shotgunPump" ? 28 : 42) {
      ctx.save();
      ctx.translate(size * 0.5, y);
      ctx.rotate(-0.45);
      ctx.fillRect(-size, -4, size * 2, kind === "silverTube" ? 10 : 6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = rgba(0x000000, 0.48);
    ctx.lineWidth = 2;
    for (let x = 18; x < size; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x + rng() * 6, 0);
      ctx.lineTo(x - 10 + rng() * 10, size);
      ctx.stroke();
    }

    for (let i = 0; i < profile.scratches; i += 1) {
      const x = rng() * size;
      const y = rng() * size;
      const len = 4 + rng() * 24;
      const alpha = 0.08 + rng() * 0.24;
      ctx.strokeStyle = rng() > 0.52 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.lineWidth = rng() > 0.72 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (rng() - 0.5) * 8);
      ctx.stroke();
    }

    if (kind === "pistolGrip") {
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      for (let y = 12; y < size; y += 14) {
        ctx.fillRect(0, y, size, 5);
      }
    }

    if (kind === "vialGlass" || kind === "silverTube") {
      ctx.fillStyle = "rgba(255,255,255,0.34)";
      ctx.fillRect(10, 8, 12, size - 16);
      ctx.fillStyle = rgba(profile.accent, 0.62);
      ctx.fillRect(28, 20, size - 48, size - 40);
    }

    const texture = setupTexture(new THREE.CanvasTexture(canvasTexture), {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
    });
    texture.repeat.set(1.5, 1.5);
    return texture;
  }

  const weaponMats = {
    metal: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0b1014, map: makeWeaponTexture("pistolMetal", 0x1) }),
    dark: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x050607, map: makeWeaponTexture("barrel", 0x2) }),
    grip: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x030405, map: makeWeaponTexture("pistolGrip", 0x3) }),
    vial: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x06343c, map: makeWeaponTexture("vialGlass", 0x4), transparent: true, opacity: 0.82 }),
    shotgunBody: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x130812, map: makeWeaponTexture("shotgunBody", 0x5) }),
    shotgunPump: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1f1808, map: makeWeaponTexture("shotgunPump", 0x6) }),
    silverTube: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0e2630, map: makeWeaponTexture("silverTube", 0x7) }),
    plungerWood: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x120b04, map: makeWeaponTexture("plungerWood", 0x8) }),
    plungerRubber: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1c0605, map: makeWeaponTexture("plungerRubber", 0x9) }),
    bombJar: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x16300a, map: makeWeaponTexture("bombJar", 0xa), transparent: true, opacity: 0.92 }),
    dartGlow: new THREE.MeshBasicMaterial({ color: 0x2ee0ff }),
    shotGlow: new THREE.MeshBasicMaterial({ color: 0xff2e88 }),
    bombGlow: new THREE.MeshBasicMaterial({ color: 0xb7ff54 }),
    muzzle: new THREE.MeshBasicMaterial({ color: 0xfff4c2, transparent: true, opacity: 0 }),
  };

  function buildDartGun() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.34), weaponMats.metal);
    body.position.set(0, 0, -0.04);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.24), weaponMats.dark);
    slide.position.set(0, 0.08, -0.08);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.28, 12), weaponMats.dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.27);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.038, 12), weaponMats.dartGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.02, -0.37);
    const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.18, 12), weaponMats.vial);
    vial.rotation.z = Math.PI / 2;
    vial.position.set(0, -0.058, 0.04);
    const vialCapL = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.018, 10), weaponMats.dark);
    vialCapL.rotation.z = Math.PI / 2;
    vialCapL.position.set(-0.102, -0.058, 0.04);
    const vialCapR = vialCapL.clone();
    vialCapR.position.x = 0.102;
    const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.18, 8), weaponMats.dartGlow);
    plunger.rotation.z = Math.PI / 2;
    plunger.position.set(0, -0.02, 0.15);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.095), weaponMats.grip);
    handle.position.set(0, -0.14, 0.08);
    handle.rotation.x = 0.25;
    const ribGeom = new THREE.BoxGeometry(0.078, 0.009, 0.1);
    const rib1 = new THREE.Mesh(ribGeom, weaponMats.dark);
    rib1.position.set(0, -0.1, 0.03);
    rib1.rotation.x = 0.25;
    const rib2 = rib1.clone();
    rib2.position.y = -0.14;
    const rib3 = rib1.clone();
    rib3.position.y = -0.18;
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), weaponMats.muzzle);
    muzzle.position.set(0, 0.02, -0.42);
    g.add(body, slide, barrel, ring, vial, vialCapL, vialCapR, plunger, handle, rib1, rib2, rib3, muzzle);
    return { group: g, muzzle };
  }

  function buildShotgun() {
    const g = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.36), weaponMats.shotgunBody);
    receiver.position.set(0, 0, -0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.2), weaponMats.grip);
    stock.position.set(0, -0.03, 0.2);
    stock.rotation.x = 0.12;
    const barrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.52, 12), weaponMats.dark);
    barrelL.rotation.x = Math.PI / 2;
    barrelL.position.set(-0.036, 0.035, -0.35);
    const barrelR = barrelL.clone();
    barrelR.position.x = 0.036;
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.068, 0.16), weaponMats.shotgunPump);
    pump.position.set(0, -0.06, -0.18);
    const silverTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.42, 12), weaponMats.silverTube);
    silverTube.rotation.x = Math.PI / 2;
    silverTube.position.set(0, -0.005, -0.35);
    const barrelBandA = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.034), weaponMats.shotGlow);
    barrelBandA.position.set(0, 0.034, -0.18);
    const barrelBandB = barrelBandA.clone();
    barrelBandB.position.z = -0.48;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.17, 0.094), weaponMats.grip);
    handle.position.set(0, -0.13, 0.06);
    handle.rotation.x = 0.22;
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), weaponMats.muzzle);
    muzzle.position.set(0, 0.035, -0.62);
    g.add(receiver, stock, barrelL, barrelR, pump, silverTube, barrelBandA, barrelBandB, handle, muzzle);
    return { group: g, muzzle };
  }

  function buildPlunger() {
    // Held like a torch: fist around the handle low in frame, rubber cup at
    // the TOP with its mouth tilted outward at the world, ready to boop.
    const g = new THREE.Group();
    const tilt = -0.42; // top leans away from the camera
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.42, 10), weaponMats.plungerWood);
    handle.rotation.x = tilt;
    handle.position.set(0, -0.02, -0.06);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), weaponMats.plungerWood);
    knob.position.set(0, -0.21, 0.025);
    // Cone widens toward the top so the wide mouth faces up-and-out.
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.03, 0.13, 12), weaponMats.plungerRubber);
    cup.rotation.x = tilt;
    cup.position.set(0, 0.175, -0.145);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 14), weaponMats.plungerRubber);
    lip.rotation.x = tilt - Math.PI / 2;
    lip.position.set(0, 0.235, -0.172);
    // A tiny heart badge sells the "emotional support" part of the joke.
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), weaponMats.shotGlow);
    heart.scale.set(1, 0.85, 0.6);
    heart.position.set(0, -0.08, -0.055);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), weaponMats.muzzle);
    muzzle.position.set(0, 0.22, -0.17);
    g.add(handle, knob, cup, lip, heart, muzzle);
    return { group: g, muzzle };
  }

  function buildBombHand() {
    const g = new THREE.Group();
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.15, 12), weaponMats.bombJar);
    jar.position.set(0, -0.02, -0.08);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.03, 12), weaponMats.dark);
    lid.position.set(0, 0.07, -0.08);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.081, 0.083, 0.045, 12), weaponMats.silverTube);
    band.position.set(0, -0.02, -0.08);
    // Live-culture glow leaking out of the lid seam.
    const ooze = new THREE.Mesh(new THREE.SphereGeometry(0.028, 7, 5), weaponMats.bombGlow);
    ooze.scale.set(1.4, 0.5, 1.1);
    ooze.position.set(0.045, 0.058, -0.05);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), weaponMats.muzzle);
    muzzle.position.set(0, 0.05, -0.14);
    g.add(jar, lid, band, ooze, muzzle);
    // Held low and slightly away so the jar reads as palm-sized, not keg-sized.
    g.position.set(0.05, -0.06, -0.16);
    g.scale.setScalar(0.82);
    return { group: g, muzzle };
  }

  const dartGun = buildDartGun();
  const shotgun = buildShotgun();
  const plunger = buildPlunger();
  const bombHand = buildBombHand();
  weaponGroup.add(dartGun.group, shotgun.group, plunger.group, bombHand.group);

  function triggerRecoil(kind) {
    state.recoil = kind === "shotgun" ? 1 : 0.55;
    state.muzzleFlash = 1;
  }

  function updateWeapon(dt) {
    weaponGroup.visible = state.mode === "playing";
    if (!weaponGroup.visible) return;
    dartGun.group.visible = state.weapon === "dart";
    shotgun.group.visible = state.weapon === "shotgun";
    plunger.group.visible = state.weapon === "melee";
    bombHand.group.visible = state.weapon === "bomb" && state.bombCooldown < BOMB_COOLDOWN * 0.55;
    state.recoil = Math.max(0, state.recoil - dt * 6);
    state.muzzleFlash = Math.max(0, state.muzzleFlash - dt * 9);
    state.meleeSwing = Math.max(0, state.meleeSwing - dt * 3.4);
    // Plunger arcs down-and-across while the swing timer decays.
    const swingT = state.meleeSwing;
    plunger.group.rotation.set(-swingT * 1.35, swingT * 0.5, swingT * 0.4);
    plunger.group.position.z = -swingT * 0.22;
    const t = performance.now() * 0.004;
    const moving = input.forward || input.back || input.left || input.right;
    const bob = Math.sin(t * 2) * (moving ? 0.012 : 0.004);
    const sway = Math.cos(t) * 0.006;
    const portraitView = camera.aspect < 1.05;
    weaponGroup.scale.setScalar(portraitView ? 0.72 : 1);
    weaponGroup.position.set(
      (portraitView ? -0.02 : 0.2) + sway,
      (portraitView ? -0.145 : -0.18) + bob,
      (portraitView ? -0.62 : -0.5) + state.recoil * 0.14
    );
    weaponGroup.rotation.x = -state.recoil * 0.4;
    weaponMats.muzzle.opacity = state.muzzleFlash;
    const mscale = 0.5 + state.muzzleFlash * 1.4;
    dartGun.muzzle.scale.setScalar(mscale);
    shotgun.muzzle.scale.setScalar(mscale);
  }

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
    // Mixes in the per-run seed so layouts vary between runs but stay fixed
    // for a given level within the same run (e.g. if that level reloads).
    return (0xC0FFEE ^ Math.imul(level, 0x45d9f3b) ^ Math.imul(state.runSeed, 0x2545f491)) >>> 0;
  }

  function levelMapSize(level) {
    const base = 19 + Math.min(level, 8) * 2; // unchanged through level 8 (was the old hard cap)
    const extra = level > 8 ? Math.floor(Math.sqrt(level - 8) * 4) : 0;
    return Math.min(47, base + extra);
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

  function chooseExitPlacement(room, start, grid) {
    const candidates = [
      { gx: room.x + room.w - 1, gy: room.cy, face: { dx: 1, dy: 0 } },
      { gx: room.x, gy: room.cy, face: { dx: -1, dy: 0 } },
      { gx: room.cx, gy: room.y + room.h - 1, face: { dx: 0, dy: 1 } },
      { gx: room.cx, gy: room.y, face: { dx: 0, dy: -1 } },
    ];
    candidates.sort((a, b) => {
      const aWall = grid[a.gy + a.face.dy] && grid[a.gy + a.face.dy][a.gx + a.face.dx] === Tile.WALL ? 1000 : 0;
      const bWall = grid[b.gy + b.face.dy] && grid[b.gy + b.face.dy][b.gx + b.face.dx] === Tile.WALL ? 1000 : 0;
      const aDist = Math.abs(a.gx - start.gx) + Math.abs(a.gy - start.gy);
      const bDist = Math.abs(b.gx - start.gx) + Math.abs(b.gy - start.gy);
      return (bWall + bDist) - (aWall + aDist);
    });
    return candidates[0];
  }

  function generateMap(level) {
    const rng = mulberry32(seedForLevel(level));
    // Grows linearly (same curve as before) through level 8, then keeps
    // growing at a decelerating rate instead of flatlining, so decks keep
    // getting longer well past where the old hard cap used to kick in.
    const size = levelMapSize(level);
    const w = size;
    const h = size;
    let grid = Array.from({ length: h }, () => Array(w).fill(Tile.WALL));
    let rooms = [];
    const targetRooms = clamp(6 + Math.floor(level * 0.8), 6, 26);

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
    const exitPlacement = chooseExitPlacement(rooms[rooms.length - 1], start, grid);
    const exit = { gx: exitPlacement.gx, gy: exitPlacement.gy };
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

    return { w, h, grid, rooms, floors, start, exit, exitFace: exitPlacement.face, rng };
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

  function tileHash(gx, gy, salt = 0) {
    let h = Math.imul(gx + 0x9E3779B1, 0x85ebca6b);
    h ^= Math.imul(gy + 0xC2B2AE35, 0x27d4eb2d);
    h ^= Math.imul(salt + state.level * 131, 0x165667b1);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function pickVariant(list, gx, gy, salt = 0) {
    return list[Math.floor(tileHash(gx, gy, salt) * list.length) % list.length];
  }

  function pickVariantFromIndices(list, indices, gx, gy, salt = 0) {
    const index = indices[Math.floor(tileHash(gx, gy, salt) * indices.length) % indices.length];
    return list[index % list.length];
  }

  function tileRange(gx, gy, salt, min, max) {
    return lerp(min, max, tileHash(gx, gy, salt));
  }

  const wallVariantPools = {
    cleaner: [0, 2, 4, 5, 8, 10, 12, 14],
    detailed: [1, 2, 4, 6, 8, 9, 10, 11, 15],
    dirty: [3, 5, 7, 12, 13, 15],
  };

  const floorVariantPools = {
    cleaner: [0, 1, 5, 6, 9, 10, 13, 14],
    mixed: [0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 13, 14],
    dirty: [3, 7, 12, 15, 4, 5],
    hazard: [3, 7, 12, 15],
  };

  const ceilingVariantPools = {
    cleaner: [0, 3, 5, 7, 11, 12, 15],
    detailed: [1, 3, 5, 6, 8, 10, 12, 14],
    dirty: [2, 4, 9, 11, 13],
  };

  const Detail = {
    PORTHOLE: 0,
    VENT: 1,
    PEEL: 2,
    PUDDLE: 3,
    DRAIN: 4,
    FOOTPRINTS: 5,
    DRIPS: 6,
    HANDRAIL: 7,
    BROKEN_TILE: 8,
    STRIPES: 9,
    CABLE: 10,
    LIFE_VEST: 11,
    SMEAR: 12,
    PAPER: 13,
    HATCH: 14,
    WIRES: 15,
  };

  function pickDetail(indices, gx, gy, salt = 0) {
    return detailMats[indices[Math.floor(tileHash(gx, gy, salt) * indices.length) % indices.length]];
  }

  function addPlane(group, geom, mat, x, y, z, sx, sy, rx, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, 1);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  }

  function exitFaceRotation(face) {
    if (face && face.dx === 1) return Math.PI / 2;
    if (face && face.dx === -1) return -Math.PI / 2;
    if (face && face.dy === -1) return Math.PI;
    return 0;
  }

  function addExitStairwell(gx, gy, pos, map) {
    const face = map.exitFace || { dx: 1, dy: 0 };
    const group = new THREE.Group();
    group.position.set(
      pos.x + face.dx * (TILE / 2 - 0.08),
      0,
      pos.z + face.dy * (TILE / 2 - 0.08)
    );
    group.rotation.y = exitFaceRotation(face);
    world.add(group);

    const door = addPlane(group, geoms.wallDecal, mats.exitLocked, 0, WALL_H / 2, -0.045, TILE, WALL_H, 0, 0, 0);
    const indicatorHalo = addPlane(group, geoms.wallDecal, mats.exitLightHaloLocked, 0, WALL_H - 0.28, -0.062, 0.32, 0.32, 0, 0, 0);
    const indicator = addBox(group, geoms.sphere, mats.exitLightLocked, 0, WALL_H - 0.28, -0.12, 0.09, 0.09, 0.045);

    exitDoor = door;
    exitDoor.userData.lockedMat = mats.exitLocked;
    exitDoor.userData.openMat = mats.exitOpen;
    exitDoor.userData.indicator = indicator;
    exitDoor.userData.indicatorHalo = indicatorHalo;
  }

  function addFloorGrime(gx, gy, tile, pos) {
    if (tile === Tile.EXIT || tile === Tile.HAZARD) return;
    const chaos = tileHash(gx, gy, 41);
    const count = tile === Tile.HAZARD ? 3 : tile === Tile.FRESH ? (chaos > 0.72 ? 1 : 0) : chaos > 0.72 ? 2 : chaos > 0.34 ? 1 : 0;
    for (let i = 0; i < count; i += 1) {
      const salt = 53 + i * 11;
      const scaleBoost = tile === Tile.HAZARD ? 1.25 : 1;
      const sx = tileRange(gx, gy, salt, 1.1, 2.9) * scaleBoost;
      const sy = tileRange(gx, gy, salt + 1, 0.75, 2.45) * scaleBoost;
      const ox = tileRange(gx, gy, salt + 2, -TILE * 0.28, TILE * 0.28);
      const oz = tileRange(gx, gy, salt + 3, -TILE * 0.28, TILE * 0.28);
      const angle = tileRange(gx, gy, salt + 4, -Math.PI, Math.PI);
      addPlane(
        world,
        geoms.floorDecal,
        pickVariant(decalMats.floor, gx, gy, salt + 5),
        pos.x + ox,
        0.018 + i * 0.006,
        pos.z + oz,
        sx,
        sy,
        -Math.PI / 2,
        0,
        angle
      );
    }
  }

  function addCeilingGrime(gx, gy, tile, pos) {
    if (tile === Tile.EXIT || tileHash(gx, gy, 87) < 0.33) return;
    const sx = tileRange(gx, gy, 89, 0.85, 2.4);
    const sy = tileRange(gx, gy, 90, 0.9, 2.8);
    const angle = tileRange(gx, gy, 91, -Math.PI, Math.PI);
    addPlane(
      world,
      geoms.wallDecal,
      pickVariant(decalMats.ceiling, gx, gy, 92),
      pos.x + tileRange(gx, gy, 93, -0.45, 0.45),
      WALL_H + 0.006,
      pos.z + tileRange(gx, gy, 94, -0.45, 0.45),
      sx,
      sy,
      Math.PI / 2,
      0,
      angle
    );
  }

  function addFloorDebris(gx, gy, tile, pos) {
    if (tile === Tile.EXIT || tile === Tile.FRESH) return;
    const roll = tileHash(gx, gy, 111);
    const count = tile === Tile.HAZARD ? (roll > 0.25 ? 2 : 1) : roll > 0.82 ? 2 : roll > 0.58 ? 1 : 0;
    const matsByKind = [mats.debrisDark, mats.debrisPaper, mats.debrisRust, mats.luggage];
    const geomsByKind = [geoms.debrisSmall, geoms.debrisLong, geoms.debrisFlat];
    for (let i = 0; i < count; i += 1) {
      const salt = 119 + i * 17;
      const mesh = addBox(
        world,
        geomsByKind[Math.floor(tileHash(gx, gy, salt) * geomsByKind.length) % geomsByKind.length],
        matsByKind[Math.floor(tileHash(gx, gy, salt + 1) * matsByKind.length) % matsByKind.length],
        pos.x + tileRange(gx, gy, salt + 2, -TILE * 0.34, TILE * 0.34),
        0.055 + i * 0.015,
        pos.z + tileRange(gx, gy, salt + 3, -TILE * 0.34, TILE * 0.34),
        tileRange(gx, gy, salt + 4, 0.65, 1.55),
        tileRange(gx, gy, salt + 5, 0.65, 1.25),
        tileRange(gx, gy, salt + 6, 0.65, 1.55)
      );
      mesh.rotation.y = tileRange(gx, gy, salt + 7, -Math.PI, Math.PI);
      mesh.rotation.z = tileRange(gx, gy, salt + 8, -0.18, 0.18);
    }
  }

  function addInfectionHazardCues(gx, gy, pos) {
    addPlane(
      world,
      geoms.floorDecal,
      mats.infectionGlow,
      pos.x + tileRange(gx, gy, 501, -0.22, 0.22),
      0.068,
      pos.z + tileRange(gx, gy, 502, -0.22, 0.22),
      tileRange(gx, gy, 503, 1.4, 2.35),
      tileRange(gx, gy, 504, 1.05, 2.05),
      -Math.PI / 2,
      0,
      tileRange(gx, gy, 505, -Math.PI, Math.PI)
    );

    if (tileHash(gx, gy, 506) > 0.28) {
      addPlane(
        world,
        geoms.floorDecal,
        objectMats[ObjectTex.CAUTION],
        pos.x + tileRange(gx, gy, 507, -TILE * 0.28, TILE * 0.28),
        0.074,
        pos.z + tileRange(gx, gy, 508, -TILE * 0.28, TILE * 0.28),
        tileRange(gx, gy, 509, 0.58, 1.15),
        tileRange(gx, gy, 510, 0.16, 0.34),
        -Math.PI / 2,
        0,
        tileRange(gx, gy, 511, -Math.PI, Math.PI)
      );
    }

    const bubbleCount = 2 + Math.floor(tileHash(gx, gy, 512) * 3);
    for (let i = 0; i < bubbleCount; i += 1) {
      const salt = 520 + i * 7;
      const bubble = addBox(
        world,
        geoms.sphere,
        mats.infectionBubble,
        pos.x + tileRange(gx, gy, salt, -TILE * 0.28, TILE * 0.28),
        tileRange(gx, gy, salt + 1, 0.08, 0.18),
        pos.z + tileRange(gx, gy, salt + 2, -TILE * 0.28, TILE * 0.28),
        tileRange(gx, gy, salt + 3, 0.06, 0.16),
        tileRange(gx, gy, salt + 4, 0.025, 0.075),
        tileRange(gx, gy, salt + 5, 0.06, 0.16)
      );
      bubble.userData.baseY = bubble.position.y;
    }

    if (tileHash(gx, gy, 548) > 0.52) {
      addPlane(
        world,
        geoms.wallDecal,
        mats.infectionVapor,
        pos.x + tileRange(gx, gy, 549, -0.36, 0.36),
        tileRange(gx, gy, 550, 0.34, 0.62),
        pos.z + tileRange(gx, gy, 551, -0.36, 0.36),
        tileRange(gx, gy, 552, 0.35, 0.72),
        tileRange(gx, gy, 553, 0.55, 1.05),
        0,
        tileRange(gx, gy, 554, -Math.PI, Math.PI),
        tileRange(gx, gy, 555, -0.1, 0.1)
      );
    }
  }

  function addFreshAirVentCues(gx, gy, pos) {
    addPlane(
      world,
      geoms.floorDecal,
      mats.freshAirGlow,
      pos.x,
      0.071,
      pos.z,
      2.55,
      2.15,
      -Math.PI / 2,
      0,
      tileRange(gx, gy, 460, -0.34, 0.34)
    );

    const vent = addBox(world, geoms.debrisFlat, mats.freshVent, pos.x, 0.084, pos.z, 4.5, 1, 3.45);
    vent.rotation.y = tileHash(gx, gy, 461) > 0.5 ? Math.PI / 2 : 0;

    for (let i = -2; i <= 2; i += 1) {
      const slat = addBox(
        world,
        geoms.debrisLong,
        mats.debrisDark,
        pos.x + (vent.rotation.y ? i * 0.24 : 0),
        0.122,
        pos.z + (vent.rotation.y ? 0 : i * 0.24),
        vent.rotation.y ? 0.5 : 2.7,
        0.62,
        vent.rotation.y ? 2.7 : 0.5
      );
      slat.rotation.y = vent.rotation.y;
    }

    for (let i = 0; i < 3; i += 1) {
      const salt = 470 + i * 9;
      addPlane(
        world,
        geoms.wallDecal,
        mats.freshAirFlow,
        pos.x + tileRange(gx, gy, salt, -0.62, 0.62),
        tileRange(gx, gy, salt + 1, 0.36, 0.88),
        pos.z + tileRange(gx, gy, salt + 2, -0.52, 0.52),
        tileRange(gx, gy, salt + 3, 0.32, 0.58),
        tileRange(gx, gy, salt + 4, 0.8, 1.42),
        0,
        tileRange(gx, gy, salt + 5, -Math.PI, Math.PI),
        tileRange(gx, gy, salt + 6, -0.12, 0.12)
      );
    }

    addBox(world, geoms.tube, mats.freshAirCore, pos.x, 0.22, pos.z, 5.2, 0.08, 5.2);
  }

  function addCeilingFixture(gx, gy, tile, pos) {
    return;
  }

  function addWallGrime(gx, gy, pos, map) {
    [
      { dx: 1, dy: 0, x: pos.x + TILE / 2 + 0.012, z: pos.z, ry: Math.PI / 2, salt: 201 },
      { dx: -1, dy: 0, x: pos.x - TILE / 2 - 0.012, z: pos.z, ry: -Math.PI / 2, salt: 211 },
      { dx: 0, dy: 1, x: pos.x, z: pos.z + TILE / 2 + 0.012, ry: 0, salt: 221 },
      { dx: 0, dy: -1, x: pos.x, z: pos.z - TILE / 2 - 0.012, ry: Math.PI, salt: 231 },
    ].forEach((face) => {
      if (!isWalkableTile(gx + face.dx, gy + face.dy, map) || tileHash(gx, gy, face.salt) < 0.43) return;
      addPlane(
        world,
        geoms.wallDecal,
        pickVariant(decalMats.wall, gx, gy, face.salt + 1),
        face.x,
        tileRange(gx, gy, face.salt + 2, 0.85, 2.18),
        face.z,
        tileRange(gx, gy, face.salt + 3, 1.05, 2.85),
        tileRange(gx, gy, face.salt + 4, 0.8, 2.05),
        0,
        face.ry,
        tileRange(gx, gy, face.salt + 5, -0.08, 0.08)
      );
    });
  }

  function addWallCruiseDetails(gx, gy, pos, map) {
    [
      { dx: 1, dy: 0, x: pos.x + TILE / 2 + 0.019, z: pos.z, ry: Math.PI / 2, salt: 301 },
      { dx: -1, dy: 0, x: pos.x - TILE / 2 - 0.019, z: pos.z, ry: -Math.PI / 2, salt: 311 },
      { dx: 0, dy: 1, x: pos.x, z: pos.z + TILE / 2 + 0.019, ry: 0, salt: 321 },
      { dx: 0, dy: -1, x: pos.x, z: pos.z - TILE / 2 - 0.019, ry: Math.PI, salt: 331 },
    ].forEach((face) => {
      if (!isWalkableTile(gx + face.dx, gy + face.dy, map) || tileHash(gx, gy, face.salt) < 0.78) return;
      const detail = pickDetail(
        [Detail.PORTHOLE, Detail.VENT, Detail.PEEL, Detail.DRIPS, Detail.HANDRAIL, Detail.STRIPES, Detail.HATCH],
        gx,
        gy,
        face.salt + 1
      );
      const longDetail = detail === detailMats[Detail.HANDRAIL] || detail === detailMats[Detail.STRIPES];
      addPlane(
        world,
        geoms.wallDecal,
        detail,
        face.x,
        tileRange(gx, gy, face.salt + 2, 1.05, 2.35),
        face.z,
        longDetail ? tileRange(gx, gy, face.salt + 3, 1.4, 2.4) : tileRange(gx, gy, face.salt + 3, 0.62, 1.35),
        longDetail ? tileRange(gx, gy, face.salt + 4, 0.35, 0.82) : tileRange(gx, gy, face.salt + 4, 0.62, 1.35),
        0,
        face.ry,
        tileRange(gx, gy, face.salt + 5, -0.05, 0.05)
      );
    });
  }

  function addFloorCruiseDetails(gx, gy, tile, pos) {
    if (tile === Tile.EXIT) return;
    const threshold = tile === Tile.HAZARD ? 0.45 : tile === Tile.FRESH ? 0.91 : 0.76;
    if (tileHash(gx, gy, 371) < threshold) return;
    const detail = pickDetail(
      tile === Tile.HAZARD
        ? [Detail.PUDDLE, Detail.FOOTPRINTS, Detail.SMEAR, Detail.DRAIN]
        : [Detail.PUDDLE, Detail.DRAIN, Detail.FOOTPRINTS, Detail.BROKEN_TILE, Detail.CABLE, Detail.LIFE_VEST, Detail.SMEAR, Detail.PAPER],
      gx,
      gy,
      373
    );
    const large = detail === detailMats[Detail.PUDDLE] || detail === detailMats[Detail.SMEAR] || detail === detailMats[Detail.CABLE];
    addPlane(
      world,
      geoms.floorDecal,
      detail,
      pos.x + tileRange(gx, gy, 374, -TILE * 0.24, TILE * 0.24),
      0.05,
      pos.z + tileRange(gx, gy, 375, -TILE * 0.24, TILE * 0.24),
      large ? tileRange(gx, gy, 376, 1.1, 2.25) : tileRange(gx, gy, 376, 0.55, 1.15),
      large ? tileRange(gx, gy, 377, 0.85, 1.9) : tileRange(gx, gy, 377, 0.55, 1.15),
      -Math.PI / 2,
      0,
      tileRange(gx, gy, 378, -Math.PI, Math.PI)
    );
  }

  function addCeilingCruiseDetails(gx, gy, tile, pos) {
    if (tile === Tile.EXIT || tileHash(gx, gy, 401) < 0.82) return;
    const detail = pickDetail([Detail.VENT, Detail.DRIPS, Detail.CABLE, Detail.HATCH, Detail.WIRES], gx, gy, 403);
    const cable = detail === detailMats[Detail.CABLE] || detail === detailMats[Detail.WIRES];
    addPlane(
      world,
      geoms.wallDecal,
      detail,
      pos.x + tileRange(gx, gy, 404, -0.34, 0.34),
      WALL_H + 0.014,
      pos.z + tileRange(gx, gy, 405, -0.34, 0.34),
      cable ? tileRange(gx, gy, 406, 1.15, 2.25) : tileRange(gx, gy, 406, 0.7, 1.35),
      cable ? tileRange(gx, gy, 407, 0.85, 1.85) : tileRange(gx, gy, 407, 0.7, 1.35),
      Math.PI / 2,
      0,
      tileRange(gx, gy, 408, -Math.PI, Math.PI)
    );
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
          const wallRoll = tileHash(gx, gy, 12);
          const wallPool = wallRoll > 0.78 ? wallVariantPools.dirty : wallRoll > 0.34 ? wallVariantPools.detailed : wallVariantPools.cleaner;
          const mat = pickVariantFromIndices(materialSets.wall, wallPool, gx, gy, 13);
          addBox(world, geoms.wall, mat, pos.x, WALL_H / 2, pos.z);
          if ((gx === 0 || gy === 0 || gx === map.w - 1 || gy === map.h - 1) && (gx + gy) % 4 === 0) {
            addBox(world, geoms.trim, mats.porthole, pos.x, 1.75, pos.z, 0.72, 1, 1);
          }
          addWallGrime(gx, gy, pos, map);
          addWallCruiseDetails(gx, gy, pos, map);
          continue;
        }

        const floorRoll = tileHash(gx, gy, 28);
        const floorPool = tile === Tile.FRESH
          ? floorVariantPools.cleaner
          : tile === Tile.HAZARD
            ? floorVariantPools.hazard
            : floorRoll > 0.82
              ? floorVariantPools.dirty
              : floorRoll < 0.24
                ? floorVariantPools.cleaner
                : floorVariantPools.mixed;
        const ceilingRoll = tileHash(gx, gy, 42);
        const ceilingPool = ceilingRoll > 0.78 ? ceilingVariantPools.dirty : ceilingRoll < 0.22 ? ceilingVariantPools.cleaner : ceilingVariantPools.detailed;
        const floorSet = tile === Tile.HAZARD ? materialSets.hazard : tile === Tile.FRESH ? materialSets.fresh : materialSets.floor;
        const floorMat = pickVariantFromIndices(floorSet, floorPool, gx, gy, 37);
        const ceilingMat = pickVariantFromIndices(materialSets.ceiling, ceilingPool, gx, gy, 43);
        addBox(world, geoms.floor, floorMat, pos.x, -0.04, pos.z);
        addBox(world, geoms.ceiling, ceilingMat, pos.x, WALL_H + 0.05, pos.z);

        if (tile === Tile.FRESH) {
          addFreshAirVentCues(gx, gy, pos);
        }

        if (tile === Tile.HAZARD) {
          addInfectionHazardCues(gx, gy, pos);
        }

        if (tile === Tile.EXIT) {
          addExitStairwell(gx, gy, pos, map);
        }

        addFloorGrime(gx, gy, tile, pos);
        addCeilingGrime(gx, gy, tile, pos);
        addFloorDebris(gx, gy, tile, pos);
        addCeilingFixture(gx, gy, tile, pos);
        addFloorCruiseDetails(gx, gy, tile, pos);
        addCeilingCruiseDetails(gx, gy, tile, pos);
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

  // Per-type silhouette + palette. scale/lean/head shape the body so each
  // threat reads at a glance in the dark; eye/glow set the infected tint.
  const ENEMY_LOOK = {
    passenger: { scale: 1.0, lean: 0.07, head: 1.0, armRaise: 0.0, swing: 1.0, gut: false, eye: 0xb7ff54, glow: 0x6cff3a },
    cougher: { scale: 1.05, lean: 0.34, head: 1.2, armRaise: 0.95, swing: 0.45, gut: true, eye: 0xe6ff45, glow: 0x9bff2e },
    sprinter: { scale: 0.94, lean: 0.55, head: 0.9, armRaise: -0.48, swing: 1.7, gut: false, eye: 0xff5a35, glow: 0xff6a2e },
    bloater: { scale: 1.28, lean: 0.2, head: 1.08, armRaise: 0.45, swing: 0.32, gut: true, eye: 0x78ff1f, glow: 0x45ff1f },
    // Small, hunched forward hard enough to read as quadrupedal; arms angle
    // steeply down to act as "front legs". Rendered upside-down near the
    // ceiling — see the crawler branch in updateEnemies.
    crawler: { scale: 0.6, lean: 1.05, head: 1.4, armRaise: 1.15, swing: 1.9, gut: false, eye: 0xccff33, glow: 0x9dff2e },
    // Deck boss: a hulking ex-captain gone full buffet. Scale is capped so the
    // hat clears the 3.2m ceiling — the bulk comes from a forced-wide girth in
    // createEnemyMesh plus red eyes and a heavy rim glow.
    boss: { scale: 1.32, lean: 0.24, head: 1.06, armRaise: 0.55, swing: 0.4, gut: true, eye: 0xff3226, glow: 0xff5a1f },
  };

  // ---- Voxel enemy construction ----
  // Each body part is a grid of small cubes (voxels) merged into ONE geometry
  // with interior faces culled, so the figures keep a chunky voxel look without
  // exploding the draw-call/triangle count. Geometry is cached per type.
  const VOX = 0.055;
  const eyeVoxGeo = new THREE.BoxGeometry(0.13, 0.11, 0.07);
  const mawVoxGeo = new THREE.BoxGeometry(0.22, 0.09, 0.06);
  const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x080a0c });

  // Healthy (cured) skin tones — one is picked per enemy and swaps in over the
  // infected green when cured.
  const HEALTHY_SKIN = 0xe3b083;
  const HEALTHY_SKIN_TONES = [0xe3b083, 0xc98a5e, 0x8d5a3b, 0xf0c8a0, 0x6b4530, 0xd9a878];
  const NORMAL_EYE_COLORS = [0x5a3a22, 0x355a78, 0x3a6b30, 0x6b4f30, 0x55555f];
  const HAIR_COLORS = [0x1a1310, 0x4a3422, 0x7a5230, 0xb89060, 0x2a2a2a, 0xd6c9a8, 0x8a3a2a];
  const HAT_COLORS = [0xcf3b3b, 0xe0c14a, 0x3b6fcf, 0xdedede, 0x4f8a4f, 0x8a4fae];
  // Hue-shifting tints multiplied onto the shared per-type baked clothing
  // colour, so a crowd gets visibly different outfit colours from the same
  // cached geometry instead of just brightness jitter.
  const CLOTH_TINTS = [
    { r: 1, g: 1, b: 1 },
    { r: 1.35, g: 0.55, b: 0.5 },
    { r: 0.55, g: 0.65, b: 1.35 },
    { r: 1.3, g: 1.1, b: 0.45 },
    { r: 0.55, g: 1.25, b: 0.6 },
    { r: 1.2, g: 0.6, b: 1.15 },
    { r: 0.7, g: 0.7, b: 0.72 },
    { r: 1.25, g: 0.85, b: 0.5 },
  ];
  const FUNNY_LINES = [
    "Refund. I want a refund.",
    "Never trust a midnight buffet.",
    "Where the heck are my pants?",
    "Is the wifi back yet?",
    "I feel 40% less gassy.",
    "Worth it for the pool, honestly.",
    "Tell no one about this.",
    "Back to the lido deck!",
    "Was that... a cruise?",
    "Five stars. No notes.",
  ];

  // Soft radial contact-shadow texture so enemies read as grounded on the deck.
  const shadowTex = (function () {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.26)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.Texture(c);
    t.needsUpdate = true;
    return t;
  })();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 });

  const VOX_FACES = [
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];
  const VOX_NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const VOX_TRIS = [0, 1, 2, 0, 2, 3];

  const ENEMY_PAL = {
    passenger: { skin: 0x8fce3a, shirt: 0x2f6f7a, pants: 0x222d36, shoe: 0x14110d },
    cougher: { skin: 0x7cc23a, shirt: 0x243349, pants: 0x1a2330, shoe: 0x141009 },
    sprinter: { skin: 0x9bd84a, shirt: 0xdd6a22, pants: 0x202a33, shoe: 0x14110d },
    bloater: { skin: 0x76c83a, shirt: 0x596225, pants: 0x252817, shoe: 0x151309 },
    // Faded onesie palette — pants/shoe match the shirt so it reads as one
    // sleeper suit instead of separate clothing pieces.
    crawler: { skin: 0x9be066, shirt: 0xc9d6a0, pants: 0xc9d6a0, shoe: 0xb7c590 },
    boss: { skin: 0x6fbf35, shirt: 0xf2f0e6, pants: 0x1c2430, shoe: 0x101010 },
  };

  const ENEMY_RESISTANCE = {
    passenger: 1.15,
    cougher: 1.65,
    sprinter: 1.35,
    crawler: 1.2,
    bloater: 3.45,
    boss: 14,
  };
  const ENEMY_BASE_SPEED = {
    passenger: 1.6,
    cougher: 1.35,
    sprinter: 2.9,
    crawler: 2.55,
    bloater: 0.84,
    boss: 1.05,
  };
  const ENEMY_COLLISION_RADIUS = {
    passenger: 0.38,
    cougher: 0.42,
    sprinter: 0.36,
    crawler: 0.34,
    bloater: 0.54,
    boss: 0.82,
  };
  const ENEMY_HIT_RADIUS = {
    passenger: 0.62,
    cougher: 0.72,
    sprinter: 0.6,
    crawler: 0.5,
    bloater: 0.95,
    boss: 1.55,
  };
  const ENEMY_TOUCH_INFECTION = {
    passenger: 8.2,
    cougher: 8.8,
    sprinter: 11.2,
    crawler: 4.5,
    bloater: 9.8,
    boss: 17,
  };
  const ENEMY_PROXIMITY_MULTIPLIER = {
    passenger: 1,
    cougher: 1.05,
    sprinter: 1.12,
    crawler: 0.4,
    bloater: 1.16,
    boss: 1.5,
  };
  const ENEMY_CURE_SCORE = {
    passenger: 100,
    cougher: 175,
    sprinter: 165,
    crawler: 160,
    bloater: 260,
    boss: 1200,
  };
  // How far each type can SEE the player (line of sight required). Snifferized
  // spawns override this with a huge no-LOS "smell" radius instead.
  const ENEMY_SIGHT_RANGE = {
    passenger: 10,
    cougher: 10.5,
    sprinter: 13,
    crawler: 12,
    bloater: 9.5,
    boss: 999,
  };

  // Signed-distance of a rounded box (Inigo Quilez): negative inside. Used to
  // carve rounded corners/edges so the figures read less boxy.
  function sdRoundBox(px, py, pz, bx, by, bz, r) {
    const qx = Math.abs(px) - bx + r;
    const qy = Math.abs(py) - by + r;
    const qz = Math.abs(pz) - bz + r;
    const mx = Math.max(qx, 0);
    const my = Math.max(qy, 0);
    const mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
  }

  // Fill voxels inside an arbitrary shape `inside(px,py,pz)` over a bounding box
  // centered at (cx,cy,cz) with voxel-unit radii (rx,ry,rz). Dedupes via `seen`
  // so later shapes can extend earlier ones without overlapping faces.
  function voxShape(list, seen, cx, cy, cz, rx, ry, rz, hex, jitter, inside, colorFn) {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    const z0 = Math.floor(cz - rz), z1 = Math.ceil(cz + rz);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const key = `${x}|${y}|${z}`;
          if (seen.has(key)) continue;
          const px = (x + 0.5) - cx, py = (y + 0.5) - cy, pz = (z + 0.5) - cz;
          if (inside(px, py, pz)) {
            seen.add(key);
            const c = colorFn ? colorFn(px, py, pz) : null;
            list.push({ x, y, z, hex: c == null ? hex : c, jitter: jitter || 0.08 });
          }
        }
      }
    }
  }

  function buildVoxelGeometry(voxels) {
    const occ = new Set();
    for (const v of voxels) occ.add(`${v.x}|${v.y}|${v.z}`);
    const pos = [];
    const nor = [];
    const col = [];
    const base = new THREE.Color();
    for (const v of voxels) {
      base.setHex(v.hex);
      const hash = ((v.x * 73856093) ^ (v.y * 19349663) ^ (v.z * 83492791)) >>> 0;
      const shade = 1 + (((hash % 1000) / 1000) - 0.5) * 2 * v.jitter;
      const r = clamp(base.r * shade, 0, 1);
      const g = clamp(base.g * shade, 0, 1);
      const b = clamp(base.b * shade, 0, 1);
      for (let f = 0; f < 6; f += 1) {
        const nb = VOX_NB[f];
        if (occ.has(`${v.x + nb[0]}|${v.y + nb[1]}|${v.z + nb[2]}`)) continue;
        const face = VOX_FACES[f];
        const n = face.n;
        for (const idx of VOX_TRIS) {
          const corner = face.c[idx];
          pos.push((v.x + corner[0]) * VOX, (v.y + corner[1]) * VOX, (v.z + corner[2]) * VOX);
          nor.push(n[0], n[1], n[2]);
          col.push(r, g, b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }

  const voxelCache = {};
  function getVoxelSet(type) {
    if (voxelCache[type]) return voxelCache[type];
    const pal = ENEMY_PAL[type] || ENEMY_PAL.passenger;
    const isSprint = type === "sprinter";
    const isCough = type === "cougher";
    const isCrawler = type === "crawler";
    const isBloater = type === "bloater";
    const u = (m) => m / VOX; // metres -> voxel units

    // Body sizes in METRES (converted to voxel units below). With the fine voxel
    // grid plus near-maximal corner radii, the SDF carves smoothly rounded edges:
    // a near-spherical head, capsule limbs, and slim legs. The crawler is built
    // with toddler proportions: oversized head, short stubby torso and limbs.
    const headR = isBloater ? 0.305 : isCough ? 0.295 : isSprint ? 0.235 : isCrawler ? 0.24 : 0.255;
    const hA = u(headR), hB = u(headR * 1.06), hC = u(headR);
    const tHX = u(isBloater ? 0.38 : isSprint ? 0.205 : isCough ? 0.275 : isCrawler ? 0.195 : 0.25);
    const tHY = u(isCrawler ? 0.205 : isBloater ? 0.38 : 0.335);
    const tHZ = u(isCrawler ? 0.175 : isBloater ? 0.22 : 0.155);
    const tR = u(isBloater ? 0.18 : 0.14);
    const aR = u(isBloater ? 0.135 : isCrawler ? 0.1 : 0.11), aHY = u(isCrawler ? 0.21 : isBloater ? 0.34 : 0.36);
    const lR = u(isBloater ? 0.13 : isCrawler ? 0.095 : 0.1), lHY = u(isCrawler ? 0.19 : isBloater ? 0.36 : 0.42); // slim legs (crawler's are stubby)
    const handR = u(isBloater ? 0.16 : 0.125), gutR = u(isBloater ? 0.31 : 0.155);
    const footHX = u(isBloater ? 0.19 : 0.14), footHY = u(isBloater ? 0.075 : 0.065), footHZ = u(isBloater ? 0.22 : 0.19), footR = u(0.05), footZ = u(0.11);

    const torso = [];
    let seen = new Set();
    voxShape(torso, seen, 0, tHY, 0, tHX + 2, tHY + 2, tHZ + 2, pal.shirt, 0.07,
      (x, y, z) => sdRoundBox(x, y, z, tHX, tHY, tHZ, tR) <= 0.05);
    if (isCough || isBloater) {
      const gutY = isBloater ? tHY * 0.42 : tHY * 0.55;
      const gutZ = tHZ + gutR * (isBloater ? 0.58 : 0.45);
      voxShape(torso, seen, 0, gutY, gutZ, gutR + 2, gutR + 2, gutR + 2, pal.shirt, 0.07,
        (x, y, z) => {
          const rx = gutR * (isBloater ? 1.22 : 1);
          const ry = gutR * (isBloater ? 0.9 : 1);
          const rz = gutR * (isBloater ? 1.05 : 1);
          return (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz) <= 1;
        }); // sick gut bulge
    }

    const head = [];
    seen = new Set();
    // Dark recessed eye sockets so the glowing eyes read against the green skin.
    const eyeOX = 0.11 / VOX, eyeOY = hB * 0.18;
    const socket = (px, py, pz) => {
      if (pz < hC * 0.4) return false; // front of the face only
      const dy = py - eyeOY;
      return (Math.abs(py - eyeOY) < 1.6) &&
        (Math.abs(px - eyeOX) < 1.9 || Math.abs(px + eyeOX) < 1.9) && dy < 1.6;
    };
    voxShape(head, seen, 0, hB, 0, hA + 2, hB + 2, hC + 2, pal.skin, 0.1,
      (x, y, z) => (x * x) / (hA * hA) + (y * y) / (hB * hB) + (z * z) / (hC * hC) <= 1.0,
      (px, py, pz) => (socket(px, py, pz) ? 0x0a1305 : null));

    const arm = [];
    seen = new Set();
    voxShape(arm, seen, 0, -aHY, 0, aR + 2, aHY + 2, aR + 2, pal.skin, 0.1,
      (x, y, z) => sdRoundBox(x, y, z, aR, aHY, aR, aR * 0.97) <= 0.05);
    voxShape(arm, seen, 0, -2 * aHY + u(0.03), 0, handR + 2, handR + 2, handR + 2, pal.skin, 0.12,
      (x, y, z) => x * x + y * y + z * z <= handR * handR); // hand

    const leg = [];
    seen = new Set();
    voxShape(leg, seen, 0, -lHY, 0, lR + 2, lHY + 2, lR + 2, pal.pants, 0.07,
      (x, y, z) => sdRoundBox(x, y, z, lR, lHY, lR, lR * 0.97) <= 0.05);
    voxShape(leg, seen, 0, -2 * lHY, footZ, footHX + 2, footHY + 2, footHZ + 2, pal.shoe, 0.05,
      (x, y, z) => sdRoundBox(x, y, z, footHX, footHY, footHZ, footR) <= 0.05); // foot, toes forward (+Z)

    const dims = {
      hipY: (2 * lHY + footHY) * VOX,
      legX: 0.14,
      shoulderX: tHX * VOX + 0.02,
      shoulderY: (2 * tHY) * VOX * 0.85,
      headY: (2 * tHY) * VOX - 0.05,
      eyeX: 0.11,
      eyeY: hB * VOX * 1.15,
      eyeZ: hC * VOX + 0.03,
      mawY: hB * VOX * 0.55,
      mawZ: hC * VOX + 0.005,
    };

    voxelCache[type] = {
      torso: buildVoxelGeometry(torso),
      head: buildVoxelGeometry(head),
      arm: buildVoxelGeometry(arm),
      leg: buildVoxelGeometry(leg),
      dims,
    };
    return voxelCache[type];
  }

  function createEnemyMesh(type) {
    const look = ENEMY_LOOK[type] || ENEMY_LOOK.passenger;
    const vox = getVoxelSet(type);
    const d = vox.dims;
    const group = new THREE.Group();

    // Per-enemy tint + size jitter so a crowd doesn't look like clones. The
    // material colour multiplies the baked vertex colours (shared geometry).
    // Skin and clothes get separate materials so curing can fade ONLY the
    // infected-green skin over to a healthy tone without recolouring clothes.
    // Clothes get a bold hue-shift pick (different colour outfits); skin keeps
    // a subtle jitter only, so the "infected" identity stays readable.
    const clothTint = CLOTH_TINTS[Math.floor(Math.random() * CLOTH_TINTS.length)];
    const clothMat = voxelMat.clone();
    clothMat.color.setRGB(
      clothTint.r * (0.92 + Math.random() * 0.16),
      clothTint.g * (0.92 + Math.random() * 0.16),
      clothTint.b * (0.92 + Math.random() * 0.16)
    );
    const skinTint = 0.92 + Math.random() * 0.14;
    const skinMat = voxelMat.clone();
    skinMat.color.setRGB(skinTint, 0.94 + Math.random() * 0.12, skinTint);
    // Infected skin stays OPAQUE so it renders in the solid pass and fully
    // occludes additive eye glow through the back of the skull. Transparency
    // is only enabled during the cure crossfade (see updateCuredEnemy).
    skinMat.transparent = false;
    skinMat.opacity = 1;
    skinMat.depthWrite = true;
    // Healthy overlay shares the same geometry but ignores baked vertex colour,
    // so it renders as a flat normal skin tone. Crossfades in as skinMat fades out.
    const healthyMat = new THREE.MeshLambertMaterial({
      color: HEALTHY_SKIN_TONES[Math.floor(Math.random() * HEALTHY_SKIN_TONES.length)],
      emissive: 0x0a0703, transparent: true, opacity: 0, depthWrite: false,
    });
    // Widened per-instance size + posture jitter so instances of the same
    // type read as individuals, not clones. Bosses skip the height jitter
    // (hat must clear the ceiling) and go wide instead.
    const girth = type === "boss" ? 1.34 + Math.random() * 0.12 : 0.86 + Math.random() * 0.28;
    const height = type === "boss" ? 1 : 0.88 + Math.random() * 0.22;
    const leanJitter = (Math.random() - 0.5) * 0.14;

    // Legs hang from the hips and stay planted; the upper body leans/bobs.
    const legL = new THREE.Group();
    legL.position.set(-d.legX, d.hipY, 0);
    legL.add(new THREE.Mesh(vox.leg, clothMat));
    const legR = new THREE.Group();
    legR.position.set(d.legX, d.hipY, 0);
    legR.add(new THREE.Mesh(vox.leg, clothMat));

    const upper = new THREE.Group();
    upper.position.y = d.hipY;
    upper.rotation.x = look.lean + leanJitter;
    upper.add(new THREE.Mesh(vox.torso, clothMat));

    const headPivot = new THREE.Group();
    headPivot.position.y = d.headY;
    const headSkin = new THREE.Mesh(vox.head, skinMat);
    headSkin.renderOrder = 0;
    const headHealthy = new THREE.Mesh(vox.head, healthyMat);
    headHealthy.renderOrder = 1;
    headPivot.add(headSkin, headHealthy);

    // Sickly rim-light: an additive back-face shell that haloes the silhouette.
    const rimMat = new THREE.MeshBasicMaterial({ color: look.glow, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const torsoRim = new THREE.Mesh(vox.torso, rimMat);
    torsoRim.scale.setScalar(1.12);
    upper.add(torsoRim);
    const headRim = new THREE.Mesh(vox.head, rimMat);
    headRim.scale.setScalar(1.14);
    headPivot.add(headRim);

    // Glowing eyes use a per-enemy material so each can pulse, blink and fade.
    // depthTest stays on so the opaque head hides eyes from behind.
    const eyeMat = new THREE.MeshBasicMaterial({
      color: look.eye,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    });
    // Seat eyes inside the skull (not floating past the face surface). Large
    // scaled enemies (bloater/boss) amplify any outward offset, so sit deep.
    const eyeZ = Math.max(0.03, d.eyeZ - 0.1);
    const eyeL = new THREE.Mesh(eyeVoxGeo, eyeMat);
    eyeL.position.set(-d.eyeX, d.eyeY, eyeZ);
    eyeL.scale.set(0.92, 0.92, 0.7);
    const eyeR = new THREE.Mesh(eyeVoxGeo, eyeMat);
    eyeR.position.set(d.eyeX, d.eyeY, eyeZ);
    eyeR.scale.set(0.92, 0.92, 0.7);
    // Depth-only skull plate behind both eyes: writes depth with no color so
    // additive glow cannot show through the back of the head from any angle
    // (transparent head shells / rim light still can't leak past this).
    const eyeOccluderMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
    });
    const eyeOccluder = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.26), eyeOccluderMat);
    eyeOccluder.position.set(0, d.eyeY, eyeZ - 0.14);
    // Visible dark socket cups (cosmetic) in front of the occluder.
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x050805, depthWrite: true });
    const socketGeo = new THREE.BoxGeometry(0.15, 0.13, 0.05);
    const socketL = new THREE.Mesh(socketGeo, socketMat);
    socketL.position.set(-d.eyeX, d.eyeY, eyeZ - 0.03);
    const socketR = new THREE.Mesh(socketGeo, socketMat);
    socketR.position.set(d.eyeX, d.eyeY, eyeZ - 0.03);
    // Normal (non-glowing) eyes crossfade in as the infected glow fades out,
    // so cured passengers end up with calm eyes instead of a blank face.
    const normalEyeMat = new THREE.MeshLambertMaterial({
      color: NORMAL_EYE_COLORS[Math.floor(Math.random() * NORMAL_EYE_COLORS.length)],
      emissive: 0x100c08, transparent: true, opacity: 0, depthWrite: true, depthTest: true,
    });
    const eyeLNormal = new THREE.Mesh(eyeVoxGeo, normalEyeMat);
    eyeLNormal.position.copy(eyeL.position);
    eyeLNormal.position.z += 0.008;
    eyeLNormal.scale.set(0.75, 0.75, 0.55);
    eyeLNormal.renderOrder = 2;
    const eyeRNormal = new THREE.Mesh(eyeVoxGeo, normalEyeMat);
    eyeRNormal.position.copy(eyeR.position);
    eyeRNormal.position.z += 0.008;
    eyeRNormal.scale.set(0.75, 0.75, 0.55);
    eyeRNormal.renderOrder = 2;
    const maw = new THREE.Mesh(mawVoxGeo, mats.maw);
    maw.position.set(0, d.mawY, d.mawZ);
    headPivot.add(eyeOccluder, socketL, socketR, eyeL, eyeR, eyeLNormal, eyeRNormal, maw);
    upper.add(headPivot);

    const armBase = 0.2 + look.armRaise;
    const armL = new THREE.Group();
    armL.position.set(-d.shoulderX, d.shoulderY, 0);
    armL.rotation.z = -0.12;
    armL.rotation.x = armBase;
    const armLSkin = new THREE.Mesh(vox.arm, skinMat);
    armLSkin.renderOrder = 0;
    const armLHealthy = new THREE.Mesh(vox.arm, healthyMat);
    armLHealthy.renderOrder = 1;
    armL.add(armLSkin, armLHealthy);
    const armR = new THREE.Group();
    armR.position.set(d.shoulderX, d.shoulderY, 0);
    armR.rotation.z = 0.12;
    armR.rotation.x = armBase;
    const armRSkin = new THREE.Mesh(vox.arm, skinMat);
    armRSkin.renderOrder = 0;
    const armRHealthy = new THREE.Mesh(vox.arm, healthyMat);
    armRHealthy.renderOrder = 1;
    armR.add(armRSkin, armRHealthy);
    upper.add(armL, armR);

    // Occasional cruise hat, otherwise hair — crowd variety up top. Bosses
    // always get the captain's hat: white crown, black brim, gold band.
    if (type === "boss") {
      const crownMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e6, emissive: 0x0c0c0a });
      const brimMat = new THREE.MeshLambertMaterial({ color: 0x14161a, emissive: 0x020203 });
      const bandMat = new THREE.MeshLambertMaterial({ color: 0xd8ae4a, emissive: 0x1c1406 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.035, 12), brimMat);
      brim.position.y = d.eyeY + 0.16;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.07, 12), bandMat);
      band.position.y = d.eyeY + 0.21;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.13, 12), crownMat);
      crown.position.y = d.eyeY + 0.3;
      headPivot.add(brim, band, crown);
    } else if (Math.random() < 0.4) {
      const hatHex = HAT_COLORS[Math.floor(Math.random() * HAT_COLORS.length)];
      const hatMat = new THREE.MeshLambertMaterial({ color: hatHex, emissive: 0x070707 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 12), hatMat);
      brim.position.y = d.eyeY + 0.17;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 12), hatMat);
      crown.position.y = d.eyeY + 0.25;
      headPivot.add(brim, crown);
    } else if (Math.random() < 0.8) {
      const hairHex = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
      const hairMat = new THREE.MeshLambertMaterial({ color: hairHex, emissive: 0x040302 });
      const hair = new THREE.Mesh(geoms.sphere, hairMat);
      hair.scale.set(0.31, 0.21, 0.31);
      hair.position.y = d.eyeY + 0.13;
      headPivot.add(hair);
    }

    group.add(legL, legR, upper);
    group.scale.set(look.scale * girth, look.scale * height, look.scale * girth);

    // Soft contact shadow grounds the figure on the deck — skipped for the
    // ceiling-crawler, which isn't standing on the floor.
    if (type !== "crawler") {
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.05;
      shadow.scale.set(0.95, 0.95, 0.95);
      group.add(shadow);
    }

    group.userData.baseScale = look.scale;
    group.userData.parts = {
      upper, legL, legR, armL, armR, headPivot, eyeMat, normalEyeMat, maw, rimMat, skinMat, healthyMat,
      leanBase: look.lean + leanJitter, upperBaseY: d.hipY, armBase, swing: look.swing,
    };
    return group;
  }

  // Boss decks: every 5th deck from 10 on (10, 15, 20...). Tier scales the
  // stats each time, and every 10 decks past the first boss another one joins
  // the fight, so the curve keeps steepening instead of plateauing.
  function isBossLevel(level) {
    return level >= 10 && level % 5 === 0;
  }

  function bossTier(level) {
    return Math.max(1, Math.floor((level - 5) / 5));
  }

  function bossCount(level) {
    return Math.min(4, 1 + Math.floor((level - 10) / 10));
  }

  function bossNameFor(level) {
    return BOSS_NAMES[Math.min(BOSS_NAMES.length - 1, bossTier(level) - 1)];
  }

  function makeEnemy(type, pos, rng, index) {
    // Speed jitter is per-instance (seeded, so it's reproducible within a
    // run) on top of the per-type/level formula, so a pack of the same type
    // doesn't move in perfect lockstep.
    const speedJitter = 0.88 + rng() * 0.28;
    const levelSpeed = type === "bloater" || type === "boss"
      ? Math.min(0.55, state.level * 0.035)
      : Math.min(1.0, state.level * 0.06);
    // A slice of the crowd are "sniffers": they smell you from across the
    // deck (no line of sight needed) — the long-range detectors. Their eyes
    // burn orange as the tell. Bosses always know where you are.
    const sniffer = type !== "boss" && rng() < 0.16;
    const enemy = {
      id: `e${state.level}-${index}`,
      type,
      x: pos.x,
      z: pos.z,
      vx: 0,
      vz: 0,
      cured: false,
      inoculation: 0,
      resistance: ENEMY_RESISTANCE[type] || ENEMY_RESISTANCE.passenger,
      speed: ((ENEMY_BASE_SPEED[type] || ENEMY_BASE_SPEED.passenger) + levelSpeed) * speedJitter,
      radius: ENEMY_COLLISION_RADIUS[type] || ENEMY_COLLISION_RADIUS.passenger,
      crawlY: WALL_H - 0.4,
      alert: type === "boss",
      sniffer,
      sightRange: sniffer ? 24 + rng() * 8 : (ENEMY_SIGHT_RANGE[type] || 10) + Math.min(4, state.level * 0.25),
      stuckT: 0,
      sidestepUntil: 0,
      spitTimer: type === "bloater" || type === "boss" ? 1 + rng() * 1.6 : 1.5 + rng() * 2,
      coughTimer: 1 + rng() * 2,
      stagger: 0,
      walkPhase: rng() * Math.PI * 2,
      coughAnim: 0,
      lunge: 0,
      lungeWindup: 0,
      lungeTime: 0,
      lungeCooldown: type === "sprinter" ? 0.9 + rng() * 1.4 : 0,
      lungeVx: 0,
      lungeVz: 0,
      hitTimer: 0,
      blink: rng() * 3,
      healing: false,
      healT: 0,
      talkTimer: 0,
      wanderTarget: null,
      wanderTimer: rng() * 2,
      mesh: createEnemyMesh(type),
    };
    if (sniffer && enemy.mesh.userData.parts) {
      enemy.mesh.userData.parts.eyeMat.color.setHex(0xffb020);
    }
    enemy.mesh.position.set(enemy.x, type === "crawler" ? enemy.crawlY : 0, enemy.z);
    enemyRoot.add(enemy.mesh);
    state.enemies.push(enemy);
    return enemy;
  }

  function spawnEnemies() {
    const map = state.map;
    const rng = map.rng;
    const count = clamp(4 + state.level * 2, 4, 30);
    const guaranteedBloaterIndex = state.level >= 4 ? Math.floor(rng() * count) : -1;
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
      if (state.level >= 4 && rng() < 0.14 + state.level * 0.006) type = "crawler";
      if (state.level >= 3 && rng() < 0.09 + state.level * 0.007) type = "bloater";
      if (i === guaranteedBloaterIndex) type = "bloater";
      makeEnemy(type, pos, rng, i);
    }

    state.neededCures = Math.max(2, Math.ceil(state.enemies.length * 0.64));

    if (isBossLevel(state.level)) {
      const tier = bossTier(state.level);
      // Bosses hold the far end of the deck, guarding the stairwell.
      const lastRoom = map.rooms[map.rooms.length - 1];
      for (let b = 0; b < bossCount(state.level); b += 1) {
        let bgx = clamp(lastRoom.cx + (b % 2 === 0 ? -b : b), 1, map.w - 2);
        let bgy = clamp(lastRoom.cy + Math.floor(b / 2), 1, map.h - 2);
        if (!isWalkableTile(bgx, bgy, map)) { bgx = lastRoom.cx; bgy = lastRoom.cy; }
        const pos = tileToWorld(bgx, bgy, map);
        const boss = makeEnemy("boss", pos, rng, `boss-${b}`);
        boss.resistance = 10 + tier * 4.5;
        boss.speed = Math.min(1.75, (1.0 + tier * 0.09) * (0.94 + rng() * 0.12));
        // Higher tiers bulk out sideways only — never taller than the ceiling.
        const bulk = Math.min(1.18, 1 + (tier - 1) * 0.05);
        boss.mesh.scale.x *= bulk;
        boss.mesh.scale.z *= bulk;
      }
    }
  }

  function createPickupMesh(type) {
    const group = new THREE.Group();
    if (type === "shotgun") {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.19, 0.86), weaponMats.shotgunBody);
      receiver.position.set(0, 0.6, -0.02);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.44), weaponMats.grip);
      stock.position.set(0, 0.54, 0.56);
      stock.rotation.x = 0.12;
      const barrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.18, 10), weaponMats.dark);
      barrelL.rotation.x = Math.PI / 2;
      barrelL.position.set(-0.07, 0.67, -0.78);
      const barrelR = barrelL.clone();
      barrelR.position.x = 0.07;
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.36), weaponMats.shotgunPump);
      pump.position.set(0, 0.5, -0.42);
      const silverTube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.78, 12), weaponMats.silverTube);
      silverTube.rotation.x = Math.PI / 2;
      silverTube.position.set(0, 0.52, -0.82);
      const barrelBandA = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.08), weaponMats.shotGlow);
      barrelBandA.position.set(0, 0.68, -0.48);
      const barrelBandB = barrelBandA.clone();
      barrelBandB.position.z = -1.05;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.18), weaponMats.grip);
      handle.position.set(0, 0.36, 0.22);
      handle.rotation.x = 0.22;
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.055, 12), weaponMats.shotGlow);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0.67, -1.39);
      group.add(receiver, stock, barrelL, barrelR, pump, silverTube, barrelBandA, barrelBandB, handle, muzzle);
      group.scale.setScalar(0.9);
      group.rotation.z = -0.08;
      return group;
    }

    if (type === "pistol") {
      // Oversized dart gun on a pedestal so the unlock reads from a distance.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.8), weaponMats.metal);
      body.position.set(0, 0.72, 0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.62, 10), weaponMats.dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.76, -0.62);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), weaponMats.dartGlow);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.76, -0.9);
      const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.4, 10), weaponMats.vial);
      vial.rotation.z = Math.PI / 2;
      vial.position.set(0, 0.5, 0.1);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.22), weaponMats.grip);
      grip.position.set(0, 0.4, 0.28);
      grip.rotation.x = 0.25;
      group.add(body, barrel, ring, vial, grip);
      group.scale.setScalar(0.9);
      return group;
    }

    if (type === "bombkit") {
      // Crate of glowing culture jars — the bomb unlock.
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.55), weaponMats.dark);
      crate.position.y = 0.4;
      group.add(crate);
      for (let i = 0; i < 3; i += 1) {
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.26, 10), weaponMats.bombJar);
        jar.position.set(-0.2 + i * 0.2, 0.66, (i % 2 === 0 ? 0.06 : -0.06));
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), weaponMats.dark);
        lid.position.set(jar.position.x, 0.8, jar.position.z);
        group.add(jar, lid);
      }
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), weaponMats.bombGlow);
      glow.position.y = 0.92;
      group.add(glow);
      return group;
    }

    if (type === "darts") {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.4), weaponMats.metal);
      crate.position.y = 0.5;
      for (let i = 0; i < 3; i += 1) {
        const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), weaponMats.vial);
        vial.rotation.z = Math.PI / 2;
        vial.position.set(0, 0.73, -0.1 + i * 0.1);
        group.add(vial);
      }
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.42), weaponMats.dartGlow);
      glow.position.y = 0.35;
      group.add(crate, glow);
      return group;
    }

    if (type === "bombs") {
      for (let i = 0; i < 2; i += 1) {
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 10), weaponMats.bombJar);
        jar.position.set(i === 0 ? -0.16 : 0.16, 0.5, i === 0 ? 0.05 : -0.06);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), weaponMats.dark);
        lid.position.set(jar.position.x, 0.67, jar.position.z);
        group.add(jar, lid);
      }
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), weaponMats.bombGlow);
      glow.position.y = 0.78;
      group.add(glow);
      return group;
    }

    const mat = type === "shotgun" ? mats.shotgun : type === "fresh-air" ? mats.freshPickup : mats.pickup;
    const body = new THREE.Mesh(geoms.pickup, mat);
    body.position.y = 0.55;
    group.add(body);
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

    function pickNearSpawnTile(skip = 0) {
      const candidates = map.floors
        .filter((tile) => map.grid[tile.gy][tile.gx] === Tile.FLOOR)
        .map((tile) => ({
          tile,
          distance: Math.abs(tile.gx - map.start.gx) + Math.abs(tile.gy - map.start.gy),
        }))
        .filter((item) => item.distance > 0)
        .sort((a, b) => a.distance - b.distance || a.tile.gy - b.tile.gy || a.tile.gx - b.tile.gx);
      if (!candidates.length) return map.start;
      return candidates[Math.min(skip, candidates.length - 1)].tile;
    }

    function addPickup(type, tile) {
      if (!tile) return;
      const pos = tileToWorld(tile.gx, tile.gy, map);
      const pickup = { type, x: pos.x, z: pos.z, taken: false, mesh: createPickupMesh(type) };
      pickup.mesh.position.set(pickup.x, 0, pickup.z);
      pickupRoot.add(pickup.mesh);
      state.pickups.push(pickup);
    }

    // Ammo drops only for gear the player can already (or will this deck) use.
    const ammoOptions = ["fresh-air"];
    if (state.level >= 2) ammoOptions.push("darts", "darts");
    if (state.level >= 3) ammoOptions.push("shells", "shells");
    if (state.level >= 4) ammoOptions.push("bombs");
    const count = clamp(4 + Math.floor(state.level * 0.85), 4, 11);
    for (let i = 0; i < count && floors.length; i += 1) {
      const tile = floors.splice(Math.floor(rng() * floors.length), 1)[0];
      addPickup(ammoOptions[Math.floor(rng() * ammoOptions.length)], tile);
    }

    // Weapon progression: each new toy is staged near spawn on its deck (and
    // keeps re-staging on later decks until the player actually grabs it).
    let staged = 0;
    if (state.level >= 2 && !state.dartUnlocked) addPickup("pistol", pickNearSpawnTile(staged++));
    if (state.level >= 3 && !state.shotgunUnlocked) addPickup("shotgun", pickNearSpawnTile(staged++));
    if (state.level >= 4 && !state.bombUnlocked) addPickup("bombkit", pickNearSpawnTile(staged++));
  }

  function loadLevel(level) {
    state.level = level;
    state.mode = "playing";
    state.cures = 0;
    state.dartCooldown = 0;
    state.shotgunCooldown = 0;
    state.meleeCooldown = 0;
    state.meleeSwing = 0;
    state.bombCooldown = 0;
    state.ambientTimer = 2.5 + Math.random() * 3;
    state.reloadTimer = 0;
    state.reloadDuration = 0;
    state.reloadWeapon = null;
    state.clouds = [];
    state.speeches = [];
    state.beams = [];
    state.particles = [];
    state.slimeBolts = [];
    state.bombs = [];
    state.stuckTimer = 0;
    state.flowTimer = 0;
    stepAudio.timer = 0;
    state.lowAmmoFlashTimer = 0;
    state.lowAmmoCooldown = 0;
    state.lastAmmoSig = ammoSignature();
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
    scatterProps();
    spawnEnemies();
    spawnPickups();
    rebuildFlow();
    resetDiscovery();
    state.bossName = isBossLevel(level) ? bossNameFor(level) : null;
    if (isBossLevel(level)) {
      const bosses = bossCount(level);
      setStatus(
        bosses > 1
          ? `Deck ${level}: ${bosses}x ${state.bossName} guard the stairwell. Cure ${state.neededCures} passengers AND the bosses.`
          : `Deck ${level}: the ${state.bossName} guards the stairwell. Cure ${state.neededCures} passengers AND the boss.`,
        6
      );
      playSound("doom", { cooldown: 0.5, cooldownKey: "boss-intro", fallback: false, rate: 0.9, volume: 0.6 });
    } else {
      const stagedGear = [];
      if (level >= 2 && !state.dartUnlocked) stagedGear.push("Ivermectin Pistol");
      if (level >= 3 && !state.shotgunUnlocked) stagedGear.push(SHOTGUN_DISPLAY_NAME);
      if (level >= 4 && !state.bombUnlocked) stagedGear.push(`${BOMB_DISPLAY_NAME}s`);
      if (stagedGear.length) {
        setStatus(`Deck ${level}: ${stagedGear.join(" + ")} staged near spawn. Cure ${state.neededCures} passengers, then find the stairwell door.`, 4.5);
      } else {
        setStatus(`Deck ${level}: cure ${state.neededCures} passengers, then find the stairwell door.`);
      }
    }
    updateExitDoor();
    updateHud();
    hideOverlay();
    lockPointer();
    playSound("level", { cooldown: 0.75, fallbackKind: "hit", volume: 0.42 });
  }

  function startRun() {
    state.runSeed = (Math.random() * 0xffffffff) >>> 0;
    state.score = 0;
    state.infection = 0;
    state.level = 1;
    state.totalShots = 0;
    state.totalHits = 0;
    state.weapon = "melee";
    state.dartUnlocked = false;
    state.shotgunUnlocked = false;
    state.bombUnlocked = false;
    state.dartAmmo = DART_MAG_SIZE;
    state.dartReserve = DART_START_RESERVE;
    state.shotgunLoaded = 0;
    state.shotgunAmmo = 0;
    state.bombAmmo = BOMB_START_AMMO;
    state.reloadTimer = 0;
    state.reloadDuration = 0;
    state.reloadWeapon = null;
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
    const high = api.recordScore(GAME_ID, state.score);
    state.high = api.getHighScore(GAME_ID) || state.high;
    unlockPointer();
    playSound("level", { cooldown: 0.85, fallbackKind: "hit", volume: 0.5 });
    showOverlay(
      `DECK ${state.level} CLEARED`,
      `The stairwell door clanked open. Infection now carries into the next deck, so every bad cough matters. Next deck adds more rooms, faster passengers, and worse buffet decisions.`,
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
    playSound("gameover", { cooldown: 1, fallbackKind: "bad", volume: 0.58 });
    playSound("doom", { cooldown: 1, cooldownKey: "gameover-doom", fallback: false, rate: 0.82, volume: 0.55 });
    showOverlay(
      "CRUISE CRUD MAXED",
      reason || "The infection meter hit the red zone. Roe Jogan did not make it to the stairwell.",
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

  function hideStatus() {
    if (!el.status) return;
    el.status.textContent = "";
    el.status.classList.remove("is-visible");
    state.statusTimer = 0;
  }

  function setStatus(message, seconds = 3.2) {
    if (!message) {
      hideStatus();
      return;
    }
    if (el.status) {
      el.status.textContent = message;
      el.status.classList.add("is-visible");
    }
    state.statusTimer = seconds;
  }

  function ammoSignature() {
    return [
      state.weapon,
      state.dartAmmo,
      state.dartReserve,
      state.shotgunLoaded,
      state.shotgunAmmo,
      state.bombAmmo,
    ].join(":");
  }

  function isLowAmmo(weapon = state.weapon) {
    if (weapon === "dart") {
      if (state.dartAmmo > 0) return state.dartAmmo <= 2;
      return state.dartReserve > 0 && state.dartReserve <= 8;
    }
    if (weapon === "shotgun") {
      if (state.shotgunLoaded > 0) return state.shotgunLoaded <= 1;
      return state.shotgunAmmo > 0 && state.shotgunAmmo <= 2;
    }
    if (weapon === "bomb") return state.bombAmmo > 0 && state.bombAmmo <= 1;
    return false;
  }

  function lowAmmoMessage(weapon = state.weapon) {
    if (weapon === "dart") {
      return state.dartAmmo > 0 ? "Low ammo" : "Mag empty — reload";
    }
    if (weapon === "shotgun") {
      return state.shotgunLoaded > 0 ? "Low ammo" : "Tube empty — reload";
    }
    if (weapon === "bomb") return "Last bomb";
    return "Low ammo";
  }

  function flashLowAmmoWarning() {
    if (state.mode !== "playing" || !isLowAmmo()) return;
    if (state.lowAmmoCooldown > 0 || state.lowAmmoFlashTimer > 0) return;
    state.lowAmmoFlashTimer = 1.35;
    state.lowAmmoCooldown = 8;
    if (el.centerLowAmmo) {
      el.centerLowAmmo.textContent = lowAmmoMessage();
      el.centerLowAmmo.hidden = false;
    }
  }

  function updateCenterAlerts(dt = 0) {
    if (el.centerReload) {
      const reloading = state.mode === "playing" && state.reloadTimer > 0;
      el.centerReload.hidden = !reloading;
      if (reloading && el.centerReloadTime) {
        el.centerReloadTime.textContent = `${Math.max(0.1, state.reloadTimer).toFixed(1)}s`;
      }
    }

    if (state.lowAmmoFlashTimer > 0) {
      state.lowAmmoFlashTimer = Math.max(0, state.lowAmmoFlashTimer - dt);
      if (state.lowAmmoFlashTimer <= 0 && el.centerLowAmmo) el.centerLowAmmo.hidden = true;
    }
    if (state.lowAmmoCooldown > 0) state.lowAmmoCooldown = Math.max(0, state.lowAmmoCooldown - dt);

    if (state.mode === "playing") {
      const sig = ammoSignature();
      if (sig !== state.lastAmmoSig) {
        state.lastAmmoSig = sig;
        if (isLowAmmo()) flashLowAmmoWarning();
      }
    } else if (el.centerLowAmmo) {
      el.centerLowAmmo.hidden = true;
      state.lowAmmoFlashTimer = 0;
      state.lastAmmoSig = "";
    }
  }

  function formatAmmo() {
    if (state.reloadTimer > 0) return `Reload ${Math.max(0.1, state.reloadTimer).toFixed(1)}s`;
    if (state.weapon === "shotgun") return `${state.shotgunLoaded}/${state.shotgunAmmo}`;
    if (state.weapon === "melee") return "∞";
    if (state.weapon === "bomb") return `${state.bombAmmo}`;
    return `${state.dartAmmo}/${state.dartReserve}`;
  }

  function updateHud(dt = 0) {
    syncPlayStateClass();
    updateCenterAlerts(dt);
    if (el.deck) el.deck.textContent = String(state.level);
    if (el.cures) el.cures.textContent = `${state.cures}/${state.neededCures}`;
    if (el.weapon) el.weapon.textContent = WEAPON_LABELS[state.weapon] || WEAPON_LABELS.dart;
    if (el.ammo) el.ammo.textContent = formatAmmo();
    if (el.score) el.score.textContent = Math.floor(state.score).toLocaleString();
    if (el.high) el.high.textContent = Math.floor(state.high).toLocaleString();
    if (el.infection) el.infection.textContent = `${Math.round(state.infection)}%`;
    if (el.infectionFill) el.infectionFill.style.width = `${clamp(state.infection, 0, 100)}%`;
    if (el.vignette) {
      const flash = state.infection > 80 ? 0.22 : state.infection > 60 ? 0.12 : state.infection > 42 ? 0.06 : 0;
      el.vignette.style.setProperty("--crud-flash", String(flash + Math.max(0, state.lurchTimer) * 0.12 + (state.stuckTimer > 0 ? 0.08 : 0)));
    }
  }

  function bossesRemaining() {
    return state.enemies.reduce((count, enemy) => count + (enemy.type === "boss" && !enemy.cured ? 1 : 0), 0);
  }

  function exitUnlocked() {
    return state.cures >= state.neededCures && bossesRemaining() === 0;
  }

  function updateExitDoor() {
    if (!exitDoor) return;
    const open = exitUnlocked();
    exitDoor.material = open ? exitDoor.userData.openMat : exitDoor.userData.lockedMat;
    if (exitDoor.userData.indicator) {
      exitDoor.userData.indicator.material = open ? mats.exitLightOpen : mats.exitLightLocked;
    }
    if (exitDoor.userData.indicatorHalo) {
      exitDoor.userData.indicatorHalo.material = open ? mats.exitLightHaloOpen : mats.exitLightHaloLocked;
    }
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
      setStatus("Find the stairwell door at the end of the deck.");
      return;
    }
    if (exitUnlocked()) completeLevel();
    else {
      playSound("damage", { cooldown: 0.45, fallbackKind: "bad", volume: 0.28 });
      const bosses = bossesRemaining();
      setStatus(bosses > 0 && state.cures >= state.neededCures
        ? `Stairwell locked. ${state.bossName || "The boss"} still stalks this deck.`
        : `Stairwell locked. Cure ${state.neededCures - state.cures} more.`);
    }
  }

  const WEAPON_READY_STATUS = {
    dart: "Ivermectin Pistol ready.",
    shotgun: `${SHOTGUN_DISPLAY_NAME} ready.`,
    melee: `${MELEE_DISPLAY_NAME} ready. It believes in you.`,
    bomb: `${BOMB_DISPLAY_NAME} in hand. Shake well before throwing.`,
  };

  // Arsenal order matches the 1-4 keys: plunger from the start, pistol staged
  // on deck 2, pumper on deck 3, stink bombs on deck 4.
  const WEAPON_ORDER = ["melee", "dart", "shotgun", "bomb"];

  function isWeaponUnlocked(weapon) {
    if (weapon === "dart") return state.dartUnlocked;
    if (weapon === "shotgun") return state.shotgunUnlocked;
    if (weapon === "bomb") return state.bombUnlocked;
    return true; // the plunger is a lifestyle, not an unlock
  }

  const WEAPON_LOCKED_STATUS = {
    dart: "Ivermectin Pistol not found yet. It's staged somewhere on deck 2.",
    shotgun: `${SHOTGUN_DISPLAY_NAME} not found yet. It's staged somewhere on deck 3.`,
    bomb: `${BOMB_DISPLAY_NAME}s not found yet. The jars appear on deck 4.`,
  };

  function setWeapon(weapon, options = {}) {
    if (state.reloadTimer > 0) {
      setStatus("Finish the reload first.");
      return false;
    }
    if (!isWeaponUnlocked(weapon)) {
      if (!options.silent) {
        playSound("damage", { cooldown: 0.35, fallbackKind: "bad", volume: 0.22 });
        setStatus(WEAPON_LOCKED_STATUS[weapon] || "Not found yet.");
      }
      return false;
    }
    if (state.weapon === weapon) return true;
    state.weapon = weapon;
    if (!options.silent) {
      playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.18 });
      setStatus(WEAPON_READY_STATUS[weapon] || WEAPON_READY_STATUS.melee);
    }
    return true;
  }

  function cycleWeapon(direction = 1) {
    const cycle = WEAPON_ORDER.filter(isWeaponUnlocked);
    if (cycle.length < 2) return;
    const index = cycle.indexOf(state.weapon);
    const next = cycle[(index + direction + cycle.length) % cycle.length];
    setWeapon(next);
  }

  function switchWeapon() {
    cycleWeapon(1);
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
      // Crawlers are hit where they're actually rendered (near the ceiling),
      // not at the usual standing-height centre.
      const hitY = enemy.type === "crawler" ? enemy.crawlY : enemy.type === "boss" ? 1.7 : enemy.type === "bloater" ? 1.35 : 1.18;
      const center = new THREE.Vector3(enemy.x, hitY, enemy.z);
      const toEnemy = center.clone().sub(origin);
      const projected = toEnemy.dot(dir);
      if (projected <= 0.2 || projected > range) continue;
      const closest = origin.clone().addScaledVector(dir, projected);
      const radius = (ENEMY_HIT_RADIUS[enemy.type] || ENEMY_HIT_RADIUS.passenger) + radiusBoost;
      const miss = closest.distanceTo(center);
      if (miss > radius) continue;
      if (rayBlocked(origin, dir, projected)) continue;
      if (!best || projected < best.distance) {
        best = { enemy, distance: projected, point: closest };
      }
    }
    return best;
  }

  function getMuzzleWorldPosition(kind = state.weapon) {
    camera.updateMatrixWorld(true);
    weaponGroup.updateMatrixWorld(true);
    const muzzle = kind === "shotgun" ? shotgun.muzzle : dartGun.muzzle;
    const origin = muzzle.getWorldPosition(new THREE.Vector3());
    if (!Number.isFinite(origin.x)) return camera.position.clone();
    return origin;
  }

  function makeTracerMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function addBeam(targetPoint, color = 0x2ee0ff, kind = state.weapon) {
    const origin = getMuzzleWorldPosition(kind);
    const target = targetPoint.clone();
    const shot = target.clone().sub(origin);
    const length = shot.length();
    if (length < 0.1) return;

    const group = new THREE.Group();
    const dir = shot.clone().normalize();
    const mid = origin.clone().addScaledVector(dir, length * 0.5);
    const radius = kind === "shotgun" ? 0.036 : 0.046;
    const glowRadius = kind === "shotgun" ? 0.12 : 0.14;
    const coreMat = makeTracerMaterial(color, kind === "shotgun" ? 0.9 : 0.96);
    const glowMat = makeTracerMaterial(kind === "shotgun" ? 0xc8f7ff : 0xb7ff54, 0.48);
    const sparkMat = makeTracerMaterial(0xfff4c2, 0.9);

    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.42, length, 8), coreMat);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(glowRadius, glowRadius * 0.25, length, 10), glowMat);
    core.position.copy(mid);
    glow.position.copy(mid);
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    glow.quaternion.copy(core.quaternion);

    const spark = new THREE.Mesh(new THREE.SphereGeometry(kind === "shotgun" ? 0.105 : 0.075, 8, 6), sparkMat);
    spark.position.copy(origin);
    const impact = new THREE.Mesh(new THREE.SphereGeometry(kind === "shotgun" ? 0.085 : 0.07, 8, 6), coreMat.clone());
    impact.position.copy(target);

    group.add(glow, core, spark, impact);
    fxRoot.add(group);
    state.beams.push({
      mesh: group,
      materials: [
        { mat: coreMat, opacity: coreMat.opacity },
        { mat: glowMat, opacity: glowMat.opacity },
        { mat: sparkMat, opacity: sparkMat.opacity },
        { mat: impact.material, opacity: impact.material.opacity },
      ],
      life: PROJECTILE_LIFE,
      maxLife: PROJECTILE_LIFE,
    });
  }

  function addParticles(x, z, color = 0xb7ff54, count = 8, baseY = 1.2) {
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 6, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
      );
      mesh.position.set(x, baseY + Math.random() * 0.7, z);
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

  function spawnCurePuddle(x, z) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb7ff54, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geoms.floorDecal, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.scale.set(1.1, 1.1, 1);
    fxRoot.add(mesh);
    state.particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0.6, puddle: true });
  }

  function ensureAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
      audioMaster = audioCtx.createGain();
      audioMaster.gain.value = 0.82;
      audioMaster.connect(audioCtx.destination);
    }
    audioStatus.unlocked = audioCtx.state === "running";
    return audioCtx;
  }

  function sampleUrl(sample) {
    if (!sample.url) sample.url = new URL(sample.file, soundAssetBase).href;
    return sample.url;
  }

  function decodeAudio(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    });
  }

  function loadAudioSample(sample) {
    const ctx = ensureAudioContext();
    if (!ctx) return Promise.resolve(null);
    const url = sampleUrl(sample);
    if (audioBuffers.has(url)) return Promise.resolve(audioBuffers.get(url));
    if (audioLoads.has(url)) return audioLoads.get(url);

    audioStatus.loading += 1;
    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => decodeAudio(ctx, arrayBuffer))
      .then((buffer) => {
        audioBuffers.set(url, buffer);
        audioStatus.loaded += 1;
        return buffer;
      })
      .catch((error) => {
        audioStatus.failed += 1;
        console.warn(`SFX failed to load: ${url}`, error);
        return null;
      })
      .finally(() => {
        audioStatus.loading = Math.max(0, audioStatus.loading - 1);
      });
    audioLoads.set(url, promise);
    return promise;
  }

  function preloadAudio() {
    Object.values(audioSamples).forEach((samples) => {
      samples.forEach(loadAudioSample);
    });
  }

  function unlockAudio() {
    const ctx = ensureAudioContext();
    if (!ctx) return null;
    if (ctx.state === "suspended" && ctx.resume) {
      ctx.resume()
        .then(() => { audioStatus.unlocked = ctx.state === "running"; })
        .catch(() => {});
    }
    preloadAudio();
    audioStatus.unlocked = ctx.state === "running";
    return ctx;
  }

  function pickAudioSample(kind) {
    const samples = audioSamples[kind];
    if (!samples || !samples.length) return null;
    if (kind === "step") {
      const sample = samples[stepAudio.index % samples.length];
      stepAudio.index += 1;
      return sample;
    }
    return samples[Math.floor(Math.random() * samples.length)];
  }

  function playBeep(kind, volume = 1) {
    if (!state.sound) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const freq = kind === "hit" || kind === "cure" ? 740 : kind === "shotgun" ? 180 : kind === "bad" || kind === "damage" || kind === "gameover" ? 92 : 420;
    osc.type = kind === "shotgun" ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.54), now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime((kind === "shotgun" ? 0.075 : 0.045) * volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(audioMaster || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
    audioStatus.fallback += 1;
  }

  function playSound(kind, options = {}) {
    if (!state.sound) return false;
    const ctx = unlockAudio();
    if (!ctx) {
      if (options.fallback !== false) playBeep(options.fallbackKind || kind, options.volume || 1);
      return false;
    }

    const now = ctx.currentTime || performance.now() / 1000;
    const cooldown = options.cooldown || 0;
    const cooldownKey = options.cooldownKey || kind;
    if (cooldown > 0 && (audioCooldowns.get(cooldownKey) || 0) > now) return false;
    if (cooldown > 0) audioCooldowns.set(cooldownKey, now + cooldown);

    const sample = pickAudioSample(kind);
    if (!sample) {
      if (options.fallback !== false) playBeep(options.fallbackKind || kind, options.volume || 1);
      return false;
    }

    const url = sampleUrl(sample);
    const buffer = audioBuffers.get(url);
    if (!buffer) {
      loadAudioSample(sample);
      if (options.fallback !== false) playBeep(options.fallbackKind || kind, options.volume || 1);
      return false;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const volume = options.volume ?? sample.volume ?? 0.5;
    const rate = options.rate ?? sample.rate ?? 1;
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, now);
    gain.gain.setValueAtTime(clamp(volume, 0, 1), now);
    source.connect(gain).connect(audioMaster || ctx.destination);
    try {
      if (options.duration) source.start(now, options.offset || 0, options.duration);
      else source.start(now, options.offset || 0);
      audioStatus.played += 1;
      return true;
    } catch (error) {
      if (options.fallback !== false) playBeep(options.fallbackKind || kind, options.volume || 1);
      return false;
    }
  }

  function updateFootstepAudio(dt, moving) {
    if (!moving || state.mode !== "playing") {
      stepAudio.timer = 0;
      return;
    }
    stepAudio.timer -= dt;
    if (stepAudio.timer > 0) return;
    const onHazard = currentTileType() === Tile.HAZARD;
    playSound("step", {
      cooldown: 0.05,
      cooldownKey: "step",
      fallback: false,
      rate: 0.94 + Math.random() * 0.12,
      volume: onHazard ? 0.26 : 0.18,
    });
    stepAudio.timer = input.sprint ? 0.28 : 0.41;
  }

  function canReloadWeapon(weapon = state.weapon) {
    if (state.reloadTimer > 0) return false;
    if (weapon === "melee" || weapon === "bomb") return false;
    if (weapon === "shotgun") {
      return state.shotgunUnlocked && state.shotgunLoaded < SHOTGUN_TUBE_SIZE && state.shotgunAmmo > 0;
    }
    return state.dartAmmo < DART_MAG_SIZE && state.dartReserve > 0;
  }

  function startReload(weapon = state.weapon, options = {}) {
    if (state.mode !== "playing" || state.reloadTimer > 0) return false;
    if (!canReloadWeapon(weapon)) {
      if (!options.silent) {
        if (weapon === "melee") {
          setStatus(`${MELEE_DISPLAY_NAME} never runs out. That is the point of it.`);
        } else if (weapon === "bomb") {
          setStatus(`${BOMB_DISPLAY_NAME}s are single-serve. Find more jars.`);
        } else if (weapon === "shotgun") {
          setStatus(state.shotgunAmmo > 0 ? `${SHOTGUN_DISPLAY_NAME} is already topped off.` : `${SHOTGUN_DISPLAY_NAME} has no silver ampoules left.`);
        } else {
          setStatus(state.dartReserve > 0 ? "Ivermectin Pistol is already loaded." : "No ivermectin darts left. Scavenge for more.");
        }
      }
      return false;
    }

    state.reloadWeapon = weapon;
    state.reloadDuration = weapon === "shotgun" ? SHOTGUN_RELOAD_TIME : DART_RELOAD_TIME;
    state.reloadTimer = state.reloadDuration;
    playSound("pickup", { cooldown: 0.25, fallbackKind: "hit", volume: weapon === "shotgun" ? 0.28 : 0.2 });
    return true;
  }

  function finishReload() {
    const weapon = state.reloadWeapon;
    state.reloadTimer = 0;
    state.reloadDuration = 0;
    state.reloadWeapon = null;

    if (weapon === "shotgun") {
      const need = Math.max(0, SHOTGUN_TUBE_SIZE - state.shotgunLoaded);
      const loaded = Math.min(need, state.shotgunAmmo);
      state.shotgunLoaded += loaded;
      state.shotgunAmmo -= loaded;
      playSound("pickup", { cooldown: 0.25, fallbackKind: "hit", volume: 0.3 });
      setStatus(loaded > 0 ? `${SHOTGUN_DISPLAY_NAME} reloaded.` : `${SHOTGUN_DISPLAY_NAME} has no silver ampoules left.`, 1.25);
      return;
    }

    const take = Math.min(DART_MAG_SIZE - state.dartAmmo, state.dartReserve);
    state.dartAmmo += take;
    state.dartReserve -= take;
    playSound("pickup", { cooldown: 0.25, fallbackKind: "hit", volume: 0.24 });
    setStatus(state.dartReserve > 0
      ? "Ivermectin Pistol reloaded."
      : "Ivermectin Pistol reloaded. That was the last of the darts.", 1.25);
  }

  function cureEnemy(enemy, dose) {
    const hitBaseY = enemy.type === "crawler" ? enemy.crawlY - 0.3 : enemy.type === "boss" ? 1.7 : enemy.type === "bloater" ? 1.35 : 1.2;
    enemy.inoculation += dose;
    enemy.stagger = enemy.type === "boss" ? 0.12 : 0.22;
    enemy.lungeWindup = 0;
    enemy.lungeTime = 0;
    setEnemyAlert(enemy, { stinger: false });
    state.totalHits += 1;
    addParticles(enemy.x, enemy.z, 0xb7ff54, 9, hitBaseY);
    if (enemy.inoculation < enemy.resistance) {
      playSound("hit", { cooldown: 0.06, fallbackKind: "hit" });
      if (enemy.type === "boss") {
        const left = Math.max(0, Math.ceil(enemy.resistance - enemy.inoculation));
        setStatus(`${state.bossName || "The boss"} shrugs it off. Roughly ${left} more doses.`);
      } else {
        setStatus("Partial cure. Hit them again before they crowd you.");
      }
      return;
    }
    enemy.cured = true;
    enemy.healing = true;
    enemy.healT = 0;
    enemy.talkTimer = 1.3;
    enemy.wanderTimer = 0;
    addParticles(enemy.x, enemy.z, 0xb7ff54, 14, hitBaseY);
    spawnCurePuddle(enemy.x, enemy.z);
    spawnSpeech(enemy.x, enemy.z, FUNNY_LINES[Math.floor(Math.random() * FUNNY_LINES.length)]);
    playSound("cure", { cooldown: 0.12, fallbackKind: "hit" });
    state.cures += 1;
    const typeBonus = ENEMY_CURE_SCORE[enemy.type] || ENEMY_CURE_SCORE.passenger;
    state.score += typeBonus + state.level * 12;
    if (enemy.type === "boss") {
      playSound("doom", { cooldown: 0.5, cooldownKey: "boss-down", fallback: false, rate: 1.15, volume: 0.5 });
      addParticles(enemy.x, enemy.z, 0xffd43b, 26, hitBaseY);
      const left = bossesRemaining();
      setStatus(left > 0
        ? `${state.bossName || "Boss"} cured! ${left} more still stalking the deck.`
        : `${state.bossName || "Boss"} cured! It asks for a comment card.`, 2.4);
    } else {
      setStatus(
        enemy.type === "cougher" ? "Cougher cured. The air is less terrible."
          : enemy.type === "bloater" ? "Bloater cured. That took a suspicious amount of serum."
          : enemy.type === "crawler" ? "Crawler cured. It toddles off the ceiling."
            : enemy.type === "sprinter" ? "Sprinter cured. Your ankles are safer."
          : "Passenger cured."
      );
    }
    updateExitDoor();
  }

  function fireDart() {
    if (state.reloadTimer > 0) return;
    if (state.dartCooldown > 0) return;
    if (state.dartAmmo <= 0) {
      if (state.dartReserve <= 0) {
        playSound("damage", { cooldown: 0.4, fallbackKind: "bad", volume: 0.22 });
        setStatus("Ivermectin is gone. The plunger never leaves you (press 3).");
        return;
      }
      startReload("dart");
      return;
    }
    state.dartCooldown = 0.78;
    state.dartAmmo -= 1;
    state.totalShots += 1;
    triggerRecoil("dart");
    playSound("dart", { cooldown: 0.05, fallbackKind: "miss", volume: 0.3 });
    alertEnemiesInRadius(player.x, player.z, 9);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hit = traceEnemy(dir, DART_RANGE, 0.06);
    if (hit) {
      cureEnemy(hit.enemy, 1);
      addBeam(hit.point, 0x2ee0ff, "dart");
    } else {
      const miss = camera.position.clone().addScaledVector(dir, DART_RANGE);
      addBeam(miss, 0x2ee0ff, "dart");
      setStatus(state.dartAmmo <= 0 ? "Pistol empty. Press R to reload." : "Ivermectin cure shot fired.");
    }
  }

  function fireShotgun() {
    if (state.reloadTimer > 0) return;
    if (!state.shotgunUnlocked) {
      playSound("damage", { cooldown: 0.35, fallbackKind: "bad", volume: 0.22 });
      setStatus(`Find the ${SHOTGUN_DISPLAY_NAME} pickup first.`);
      return;
    }
    if (state.shotgunLoaded <= 0) {
      if (state.shotgunAmmo > 0) {
        startReload("shotgun");
        return;
      }
      playSound("damage", { cooldown: 0.35, fallbackKind: "bad", volume: 0.24 });
      setStatus(`${SHOTGUN_DISPLAY_NAME} empty. Switch to the Ivermectin Pistol or find a silver kit.`);
      state.weapon = "dart";
      return;
    }
    if (state.shotgunCooldown > 0) return;
    state.shotgunCooldown = SHOTGUN_COOLDOWN;
    state.shotgunLoaded -= 1;
    state.totalShots += 1;
    triggerRecoil("shotgun");
    playSound("shotgun", { cooldown: SHOTGUN_COOLDOWN * 0.8, fallbackKind: "shotgun" });
    alertEnemiesInRadius(player.x, player.z, 16);

    const base = new THREE.Vector3();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.getWorldDirection(base);

    const hitSet = new Set();
    for (let i = 0; i < SHOTGUN_PELLETS; i += 1) {
      const spreadX = (Math.random() - 0.5) * 0.24;
      const spreadY = (Math.random() - 0.5) * 0.16;
      const dir = base.clone().addScaledVector(right, spreadX).addScaledVector(up, spreadY).normalize();
      const hit = traceEnemy(dir, SHOTGUN_RANGE, SHOTGUN_RADIUS_BOOST);
      if (hit) {
        hitSet.add(hit.enemy);
        addBeam(hit.point, 0xff2e88, "shotgun");
      } else {
        addBeam(camera.position.clone().addScaledVector(dir, SHOTGUN_RANGE), 0xff2e88, "shotgun");
      }
    }
    hitSet.forEach((enemy) => cureEnemy(enemy, SHOTGUN_DOSE));
    if (!hitSet.size) {
      state.totalHits = Math.max(0, state.totalHits);
      setStatus(state.shotgunLoaded <= 0 ? `${SHOTGUN_DISPLAY_NAME} empty. Press R to reload.` : `${SHOTGUN_DISPLAY_NAME} blast fired.`);
    }
  }

  function fireMelee() {
    if (state.meleeCooldown > 0) return;
    state.meleeCooldown = MELEE_COOLDOWN;
    state.meleeSwing = 1;
    state.totalShots += 1;
    playSound("dart", { cooldown: 0.1, cooldownKey: "melee-whoosh", fallbackKind: "miss", rate: 0.62, volume: 0.26 });
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let landed = 0;
    for (const enemy of state.enemies) {
      if (enemy.cured) continue;
      const dx = enemy.x - player.x;
      const dz = enemy.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MELEE_RANGE + (ENEMY_HIT_RADIUS[enemy.type] || 0.6) * 0.5) continue;
      // Point-blank always connects — the cone only matters at arm's length,
      // and direction-to-enemy is pure noise when they're standing inside you.
      const dot = dist < 0.75 ? 1 : (dx / dist) * dir.x + (dz / dist) * dir.z;
      if (dot < 0.42) continue;
      landed += 1;
      // Percussive wellness: the plunger shoves them back before it doses.
      const push = enemy.type === "boss" ? 0.45 : 1.25;
      moveEntity(enemy, (dx / (dist || 1)) * push, (dz / (dist || 1)) * push, enemy.radius || 0.4);
      cureEnemy(enemy, MELEE_DOSE);
      enemy.stagger = Math.max(enemy.stagger, 0.4);
    }
    alertEnemiesInRadius(player.x, player.z, 4.5);
    if (landed > 0) {
      playSound("hit", { cooldown: 0.08, fallbackKind: "hit", rate: 0.82, volume: 0.42 });
    } else {
      setStatus("The plunger whiffs. Emotionally, it still supports you.", 1.1);
    }
  }

  function fireBomb() {
    if (state.bombCooldown > 0) return;
    if (!state.bombUnlocked) {
      playSound("damage", { cooldown: 0.35, fallbackKind: "bad", volume: 0.22 });
      setStatus(WEAPON_LOCKED_STATUS.bomb);
      return;
    }
    if (state.bombAmmo <= 0) {
      playSound("damage", { cooldown: 0.35, fallbackKind: "bad", volume: 0.22 });
      setStatus(`No ${BOMB_DISPLAY_NAME}s left. The gut flora supply ran dry.`);
      return;
    }
    state.bombCooldown = BOMB_COOLDOWN;
    state.bombAmmo -= 1;
    state.totalShots += 1;
    triggerRecoil("dart");
    playSound("spit", { cooldown: 0.2, cooldownKey: "bomb-throw", fallback: false, rate: 1.3, volume: 0.34 });

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const horiz = Math.hypot(dir.x, dir.z) || 0.0001;
    const hx = dir.x / horiz;
    const hz = dir.z / horiz;
    // Land where the crosshair meets the floor: aim at someone's feet and the
    // jar drops there. Level (or upward) aim lobs it out to max range.
    let range = BOMB_THROW_RANGE;
    if (dir.y < -0.04) {
      range = clamp((EYE_Y / -dir.y) * horiz, 1.2, BOMB_THROW_RANGE);
    }
    // Walk the aim ray out to the first wall so the jar never lands inside one.
    for (let d = 1; d < range; d += 0.4) {
      const tile = worldToTile(player.x + hx * d, player.z + hz * d);
      if (!isWalkableTile(tile.gx, tile.gy)) { range = Math.max(1.2, d - 0.5); break; }
    }
    const toX = player.x + hx * range;
    const toZ = player.z + hz * range;

    const jar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.19, 10), weaponMats.bombJar);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 10), weaponMats.dark);
    lid.position.y = 0.11;
    jar.add(body, lid);
    jar.position.set(player.x + dir.x * 0.5, EYE_Y - 0.2, player.z + dir.z * 0.5);
    fxRoot.add(jar);
    state.bombs.push({
      mesh: jar,
      fromX: jar.position.x,
      fromY: jar.position.y,
      fromZ: jar.position.z,
      toX,
      toZ,
      t: 0,
      travel: clamp(range / 11, 0.32, 0.95),
    });
  }

  function explodeBomb(bomb) {
    const { toX, toZ } = bomb;
    playSound("shotgun", { cooldown: 0.15, cooldownKey: "bomb-boom", fallbackKind: "shotgun", rate: 0.6, volume: 0.55 });
    playSound("cure", { cooldown: 0.15, cooldownKey: "bomb-cure", fallbackKind: "hit", volume: 0.4 });
    addParticles(toX, toZ, 0xb7ff54, 22, 0.5);
    addParticles(toX, toZ, 0x8aff2e, 14, 1.1);
    spawnCurePuddle(toX, toZ);
    let cured = 0;
    for (const enemy of state.enemies) {
      if (enemy.cured) continue;
      const dist = Math.hypot(enemy.x - toX, enemy.z - toZ);
      if (dist > BOMB_RADIUS) continue;
      cureEnemy(enemy, BOMB_DOSE * (dist < BOMB_RADIUS * 0.5 ? 1 : 0.72));
      cured += 1;
    }
    // Friendly bacteria also scrub nearby cough clouds out of the air.
    state.clouds.forEach((cloud) => {
      if (Math.hypot(cloud.x - toX, cloud.z - toZ) < BOMB_RADIUS + 1) cloud.life = Math.min(cloud.life, 0.3);
    });
    alertEnemiesInRadius(toX, toZ, 15);
    setStatus(cured > 0
      ? `Probiotic detonation. ${cured} gut biome${cured === 1 ? "" : "s"} forcibly rebalanced.`
      : "Probiotic detonation. The hallway smells aggressively healthy.", 1.6);
  }

  function updateBombs(dt) {
    for (let i = state.bombs.length - 1; i >= 0; i -= 1) {
      const b = state.bombs[i];
      b.t += dt;
      const p = clamp(b.t / b.travel, 0, 1);
      const arc = Math.sin(p * Math.PI) * 1.1;
      b.mesh.position.set(
        lerp(b.fromX, b.toX, p),
        lerp(b.fromY, 0.12, p) + arc,
        lerp(b.fromZ, b.toZ, p)
      );
      b.mesh.rotation.x += dt * 8;
      b.mesh.rotation.z += dt * 5;
      if (p >= 1) {
        fxRoot.remove(b.mesh);
        state.bombs.splice(i, 1);
        explodeBomb(b);
      }
    }
  }

  function fireWeapon() {
    if (state.mode !== "playing") return;
    if (state.weapon === "shotgun") fireShotgun();
    else if (state.weapon === "melee") fireMelee();
    else if (state.weapon === "bomb") fireBomb();
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

  // LOS with body width: the centre ray plus two rays offset perpendicular
  // by ~the mover's radius. Prevents the classic "I can see you through this
  // diagonal gap my shoulders don't fit through" wall-humping.
  function hasClearPath(ax, az, bx, bz, radius = 0.4) {
    if (!hasLineOfSight(ax, az, bx, bz)) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return true;
    const px = (-dz / len) * radius;
    const pz = (dx / len) * radius;
    return hasLineOfSight(ax + px, az + pz, bx + px, bz + pz)
      && hasLineOfSight(ax - px, az - pz, bx - px, bz - pz);
  }

  function bestEnemyTarget(enemy) {
    const map = state.map;
    const tile = worldToTile(enemy.x, enemy.z, map);
    // Straight-line pursuit only when the whole body fits down the line.
    if (hasClearPath(enemy.x, enemy.z, player.x, player.z, (enemy.radius || 0.4) + 0.05)) {
      return { x: player.x, z: player.z };
    }
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
    // No flow progress and no clear line: report "no path" so the caller can
    // mill around instead of grinding face-first into the nearest wall.
    if (!best) return null;
    return tileToWorld(best.gx, best.gy, map);
  }

  function setEnemyAlert(enemy, options = {}) {
    if (enemy.alert || enemy.cured) return;
    enemy.alert = true;
    enemy.coughAnim = 1;
    enemy.wanderTarget = null;
    if (options.stinger !== false) {
      const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
      playSound("doom", {
        cooldown: 6,
        cooldownKey: "detect-stinger",
        fallback: false,
        rate: 0.96 + Math.random() * 0.1,
        volume: clamp(0.44 - dist * 0.012, 0.16, 0.44),
      });
    }
  }

  // Loud actions (gunshots, detonations) wake everything nearby, walls or not.
  function alertEnemiesInRadius(x, z, radius) {
    for (const enemy of state.enemies) {
      if (enemy.cured || enemy.alert) continue;
      if (Math.hypot(enemy.x - x, enemy.z - z) <= radius) setEnemyAlert(enemy, { stinger: false });
    }
  }

  // Undetected enemies drift between random walkable points at half speed.
  function updateEnemyWander(enemy, dt) {
    enemy.wanderTimer -= dt;
    let needsTarget = !enemy.wanderTarget;
    if (enemy.wanderTarget) {
      const toTarget = Math.hypot(enemy.wanderTarget.x - enemy.x, enemy.wanderTarget.z - enemy.z);
      if (toTarget < 0.4) needsTarget = true;
    }
    if (enemy.wanderTimer <= 0 || needsTarget) {
      enemy.wanderTimer = 2.2 + Math.random() * 3.4;
      enemy.wanderTarget = pickWanderTarget(enemy);
    }
    if (!enemy.wanderTarget) return false;
    const dx = enemy.wanderTarget.x - enemy.x;
    const dz = enemy.wanderTarget.z - enemy.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.12) return false;
    const speed = enemy.speed * 0.42;
    const beforeX = enemy.x;
    const beforeZ = enemy.z;
    moveEntity(enemy, (dx / len) * speed * dt, (dz / len) * speed * dt, enemy.radius || 0.4);
    if (Math.hypot(enemy.x - beforeX, enemy.z - beforeZ) < speed * dt * 0.3) {
      // Bumped into something — try a different destination next frame.
      enemy.wanderTarget = null;
    }
    enemy.faceX = enemy.x + dx;
    enemy.faceZ = enemy.z + dz;
    return true;
  }

  function moveEntity(entity, dx, dz, radius) {
    const nx = entity.x + dx;
    const nz = entity.z + dz;
    if (isWalkableWorld(nx, entity.z, radius) && !collidesWithProps(nx, entity.z, radius * 0.9, entity.x, entity.z)) entity.x = nx;
    if (isWalkableWorld(entity.x, nz, radius) && !collidesWithProps(entity.x, nz, radius * 0.9, entity.x, entity.z)) entity.z = nz;
  }

  function spawnCloud(x, z, radius = 1.8) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb7ff54, transparent: true, opacity: 0.22, depthWrite: false });
    const mesh = new THREE.Mesh(geoms.sphere, mat);
    mesh.position.set(x, 0.98, z);
    mesh.scale.set(radius, radius * 0.42, radius);
    fxRoot.add(mesh);
    state.clouds.push({ x, z, radius, life: 4.2, mesh });
  }

  const slimeBoltGeo = new THREE.SphereGeometry(0.1, 6, 5);
  const slimeBoltMat = new THREE.MeshBasicMaterial({ color: 0x8aff2e, transparent: true, opacity: 0.92 });

  // A spit projectile: lerps toward where the player was standing when it
  // fired, with a little upward arc, then splats into a lingering hazard puddle.
  // Bloaters fire the larger snaring version; crawlers keep the lighter spit.
  function spawnSlimeBolt(fromX, fromY, fromZ, toX, toY, toZ, options = {}) {
    const dist = Math.hypot(toX - fromX, toY - fromY, toZ - fromZ);
    const travel = clamp(dist / (options.speed || 9), options.minTravel || 0.3, options.maxTravel || 1.2);
    const mesh = new THREE.Mesh(slimeBoltGeo, slimeBoltMat);
    mesh.scale.setScalar(options.scale || 1);
    mesh.position.set(fromX, fromY, fromZ);
    fxRoot.add(mesh);
    state.slimeBolts.push({
      mesh,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      t: 0,
      travel,
      impactRadius: options.impactRadius || 1.6,
      infection: options.infection || 9,
      stuckTime: options.stuckTime || 0,
      cloudRadius: options.cloudRadius || 1.1,
      status: options.status || "Slime hit! Infection spiked.",
      particleCount: options.particleCount || 10,
    });
  }

  function updateSlimeBolts(dt) {
    for (let i = state.slimeBolts.length - 1; i >= 0; i -= 1) {
      const b = state.slimeBolts[i];
      b.t += dt;
      const p = clamp(b.t / b.travel, 0, 1);
      const arc = Math.sin(p * Math.PI) * 0.6;
      b.mesh.position.set(
        lerp(b.fromX, b.toX, p),
        lerp(b.fromY, b.toY, p) + arc,
        lerp(b.fromZ, b.toZ, p)
      );
      b.mesh.rotation.x += dt * 9;
      b.mesh.rotation.y += dt * 7;
      if (p >= 1) {
        const dist = Math.hypot(player.x - b.toX, player.z - b.toZ);
        if (dist < b.impactRadius) {
          state.infection = clamp(state.infection + b.infection, 0, 100);
          state.lurchTimer = Math.max(state.lurchTimer, b.stuckTime > 0 ? 0.34 : 0.2);
          if (b.stuckTime > 0) state.stuckTimer = Math.max(state.stuckTimer, b.stuckTime);
          playSound("damage", { cooldown: 0.38, fallbackKind: "bad" });
          setStatus(b.status, b.stuckTime > 0 ? b.stuckTime : 1.4);
        }
        addParticles(b.toX, b.toZ, 0x8aff2e, b.particleCount, 0.25);
        spawnCloud(b.toX, b.toZ, b.cloudRadius);
        fxRoot.remove(b.mesh);
        state.slimeBolts.splice(i, 1);
      }
    }
  }

  function updateSprinterLunge(enemy, dt, dist) {
    if (enemy.type !== "sprinter") return false;

    enemy.lungeCooldown = Math.max(0, enemy.lungeCooldown - dt);

    if (enemy.lungeTime > 0) {
      enemy.lungeTime = Math.max(0, enemy.lungeTime - dt);
      moveEntity(enemy, enemy.lungeVx * dt, enemy.lungeVz * dt, enemy.radius || ENEMY_COLLISION_RADIUS.sprinter);
      enemy.coughAnim = Math.max(enemy.coughAnim, 0.35);
      return true;
    }

    if (enemy.lungeWindup > 0) {
      enemy.lungeWindup = Math.max(0, enemy.lungeWindup - dt);
      enemy.coughAnim = Math.max(enemy.coughAnim, 0.75);
      if (enemy.lungeWindup <= 0) {
        const dx = player.x - enemy.x;
        const dz = player.z - enemy.z;
        const len = Math.hypot(dx, dz) || 1;
        const burst = enemy.speed * 3.25;
        enemy.lungeVx = (dx / len) * burst;
        enemy.lungeVz = (dz / len) * burst;
        enemy.lungeTime = 0.28;
        addParticles(enemy.x, enemy.z, 0xff6a2e, 5, 1.1);
      }
      return true;
    }

    if (enemy.lungeCooldown <= 0 && dist > 2.05 && dist < 7.2 && hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) {
      enemy.lungeWindup = 0.24;
      enemy.lungeCooldown = 1.65 + Math.random() * 1.3;
      enemy.coughAnim = 1;
      return true;
    }

    return false;
  }

  function updateEnemies(dt) {
    state.flowTimer -= dt;
    if (state.flowTimer <= 0) {
      state.flowTimer = FLOW_REFRESH;
      rebuildFlow();
    }

    let closest = Infinity;
    for (const enemy of state.enemies) {
      if (enemy.cured) { updateCuredEnemy(enemy, dt); continue; }
      enemy.stagger = Math.max(0, enemy.stagger - dt);
      enemy.hitTimer = Math.max(0, (enemy.hitTimer || 0) - dt);
      const dxp = player.x - enemy.x;
      const dzp = player.z - enemy.z;
      const dist = Math.hypot(dxp, dzp);
      closest = Math.min(closest, dist);

      // ---- Detection ----
      // Sniffers smell through walls; everyone else needs actual line of
      // sight (or you brushing right past them) before they engage.
      if (!enemy.alert) {
        const seen = enemy.sniffer
          ? dist < enemy.sightRange
          : dist < enemy.sightRange && hasLineOfSight(enemy.x, enemy.z, player.x, player.z);
        if (seen || dist < 2.4) setEnemyAlert(enemy);
      }

      let moving = false;
      if (!enemy.alert) {
        // ---- Wander state: shuffle the halls, oblivious ----
        if (enemy.stagger <= 0) moving = updateEnemyWander(enemy, dt);
      } else if (enemy.stagger <= 0) {
        // ---- Alert state: hunt the player ----
        const lunging = updateSprinterLunge(enemy, dt, dist);
        if (!lunging) {
          const now = performance.now() / 1000;
          let target = now < enemy.sidestepUntil && enemy.wanderTarget ? enemy.wanderTarget : bestEnemyTarget(enemy);
          if (!target) {
            // No route to the player right now: mill around instead of
            // grinding into a wall until the flow field catches up.
            moving = updateEnemyWander(enemy, dt);
          } else {
            const dx = target.x - enemy.x;
            const dz = target.z - enemy.z;
            const len = Math.hypot(dx, dz) || 1;
            const slowNearPlayer = enemy.type === "bloater" || enemy.type === "boss" ? 0.58 : 0.72;
            const speed = enemy.speed * (dist < 2.2 ? slowNearPlayer : 1);
            const beforeX = enemy.x;
            const beforeZ = enemy.z;
            moveEntity(enemy, (dx / len) * speed * dt, (dz / len) * speed * dt, enemy.radius || ENEMY_COLLISION_RADIUS.passenger);
            moving = true;
            enemy.faceX = player.x;
            enemy.faceZ = player.z;
            // Stuck watchdog: barely moving while trying to chase means a
            // wall/prop/crowd pin — sidestep somewhere walkable for a beat.
            const actual = Math.hypot(enemy.x - beforeX, enemy.z - beforeZ);
            if (actual < speed * dt * 0.25) {
              enemy.stuckT += dt;
              if (enemy.stuckT > 0.55) {
                enemy.stuckT = 0;
                enemy.wanderTarget = pickWanderTarget(enemy);
                enemy.sidestepUntil = now + 0.7;
              }
            } else {
              enemy.stuckT = Math.max(0, enemy.stuckT - dt * 2);
            }
          }
        } else {
          moving = true;
          enemy.faceX = player.x;
          enemy.faceZ = player.z;
        }
      } else {
        enemy.lungeWindup = 0;
        enemy.lungeTime = 0;
      }

      const touchRange = enemy.type === "bloater" ? 1.55 : enemy.type === "boss" ? 2.1 : 1.25;
      if (dist < touchRange) {
        // Crawlers barely infect by touch — their threat is the ranged spit below.
        setEnemyAlert(enemy, { stinger: false });
        state.infection += (ENEMY_TOUCH_INFECTION[enemy.type] || ENEMY_TOUCH_INFECTION.passenger) * dt;
        state.lurchTimer = Math.max(state.lurchTimer, 0.18);
        playSound("damage", { cooldown: 0.72, fallbackKind: "bad", volume: 0.28 });
        if (enemy.type === "sprinter" && enemy.lungeTime > 0 && enemy.hitTimer <= 0) {
          enemy.hitTimer = 0.75;
          state.infection = clamp(state.infection + 4, 0, 100);
          state.lurchTimer = Math.max(state.lurchTimer, 0.32);
          playSound("damage", { cooldown: 0.25, fallbackKind: "bad", volume: 0.42 });
          setStatus("Sprinter lunge clipped you.", 0.9);
        }
      } else if (dist < 6.5) {
        // Oblivious wanderers leak far less ambient crud than active hunters,
        // so sneaking past them is a real option.
        const awareness = enemy.alert ? 1 : 0.35;
        state.infection += (6.5 - dist) * (0.5 + state.level * 0.035) * dt * (ENEMY_PROXIMITY_MULTIPLIER[enemy.type] || 1) * awareness;
      }

      if (enemy.type === "cougher" && enemy.alert) {
        enemy.coughTimer -= dt;
        if (enemy.coughTimer <= 0 && dist < 12) {
          enemy.coughTimer = 2.4 + Math.random() * 2.4;
          enemy.coughAnim = 1;
          playSound("spit", { cooldown: 0.7, fallback: false, volume: 0.22 });
          spawnCloud(enemy.x, enemy.z, 1.65 + Math.random() * 0.65);
        }
      }

      if (enemy.type === "crawler" && enemy.alert) {
        enemy.spitTimer -= dt;
        if (enemy.spitTimer <= 0 && dist < 11 && hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) {
          enemy.spitTimer = 2.2 + Math.random() * 1.8;
          enemy.coughAnim = 1; // reuses the head-dip/maw-open telegraph
          playSound("spit", { cooldown: 0.38, fallback: false });
          spawnSlimeBolt(enemy.x, enemy.crawlY, enemy.z, player.x, EYE_Y, player.z);
        }
      }

      if (enemy.type === "bloater" && enemy.alert) {
        enemy.spitTimer -= dt;
        if (enemy.spitTimer <= 0 && dist < 12.5 && hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) {
          enemy.spitTimer = 3.3 + Math.random() * 1.8;
          enemy.coughAnim = 1;
          playSound("spit", { cooldown: 0.38, fallback: false, volume: 0.42 });
          spawnSlimeBolt(enemy.x, 1.45, enemy.z, player.x, EYE_Y, player.z, {
            speed: 7,
            scale: 1.65,
            maxTravel: 1.45,
            impactRadius: 1.9,
            infection: 7,
            stuckTime: 2.55,
            cloudRadius: 1.35,
            particleCount: 16,
            status: "Bloater slime stuck your shoes. Hold them off.",
          });
        }
      }

      if (enemy.type === "boss") {
        enemy.spitTimer -= dt;
        if (enemy.spitTimer <= 0 && dist < 16 && hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) {
          enemy.spitTimer = 2.5 + Math.random() * 1.4;
          enemy.coughAnim = 1;
          playSound("spit", { cooldown: 0.3, fallback: false, volume: 0.5, rate: 0.7 });
          // Triple volley: one dead-on, two flanking where you might dodge to.
          for (let v = -1; v <= 1; v += 1) {
            const px = -dzp / (dist || 1);
            const pz = dxp / (dist || 1);
            spawnSlimeBolt(enemy.x, 2.2, enemy.z, player.x + px * v * 1.7, EYE_Y, player.z + pz * v * 1.7, {
              speed: 8,
              scale: 1.9,
              maxTravel: 1.6,
              impactRadius: 2.0,
              infection: 8,
              stuckTime: v === 0 ? 2.2 : 0,
              cloudRadius: 1.5,
              particleCount: 18,
              status: "Boss slime barrage! Keep moving.",
            });
          }
        }
      }

      if (enemy.type === "crawler") {
        // Rendered upside-down near the ceiling: same XZ pathing/collision as
        // every other enemy (the flow-field doesn't know about height), just
        // repositioned and flipped for the ceiling-crawl illusion.
        const faceX = enemy.alert ? player.x : (enemy.faceX ?? player.x);
        const faceZ = enemy.alert ? player.z : (enemy.faceZ ?? player.z);
        enemy.mesh.position.set(enemy.x, enemy.crawlY, enemy.z);
        if (Math.hypot(faceX - enemy.x, faceZ - enemy.z) > 0.05) {
          enemy.mesh.lookAt(faceX, enemy.crawlY, faceZ);
          enemy.mesh.rotateZ(Math.PI);
        }
      } else {
        enemy.mesh.position.set(enemy.x, 0, enemy.z);
        // Face the player when hunting, the direction of travel when idly
        // wandering. Target stays at pivot height so the figure only yaws.
        const faceX = enemy.alert ? player.x : (enemy.faceX ?? player.x);
        const faceZ = enemy.alert ? player.z : (enemy.faceZ ?? player.z);
        if (Math.hypot(faceX - enemy.x, faceZ - enemy.z) > 0.05) enemy.mesh.lookAt(faceX, 0, faceZ);
      }
      animateEnemy(enemy, dt, dist, moving && enemy.stagger <= 0);
    }

    // ---- Crowd separation ----
    // Gentle pairwise push so packs fan out around corners and props instead
    // of compressing into a single wall-grinding blob.
    for (let i = 0; i < state.enemies.length; i += 1) {
      const a = state.enemies[i];
      if (a.cured || a.type === "crawler") continue;
      for (let j = i + 1; j < state.enemies.length; j += 1) {
        const b = state.enemies[j];
        if (b.cured || b.type === "crawler") continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minDist = (a.radius || 0.4) + (b.radius || 0.4) + 0.08;
        const d = Math.hypot(dx, dz);
        if (d >= minDist || d < 0.001) continue;
        const push = (minDist - d) * 0.5;
        const ux = dx / d;
        const uz = dz / d;
        if (isWalkableWorld(a.x - ux * push, a.z - uz * push, a.radius || 0.4)) {
          a.x -= ux * push;
          a.z -= uz * push;
        }
        if (isWalkableWorld(b.x + ux * push, b.z + uz * push, b.radius || 0.4)) {
          b.x += ux * push;
          b.z += uz * push;
        }
      }
    }

    return closest;
  }

  // Drives the limb rig each frame: a lurching walk cycle, cough hunch, flinch,
  // idle breathing, an attack-lunge telegraph when close, and an eye glow that
  // pulses and occasionally blinks.
  function animateEnemy(enemy, dt, dist, moving) {
    const parts = enemy.mesh.userData.parts;
    if (!parts) return;
    enemy.coughAnim = Math.max(0, enemy.coughAnim - dt * 2.4);

    const stride = moving ? 0.55 + enemy.speed * 0.12 : 0.1;
    enemy.walkPhase += dt * (moving ? 5 + enemy.speed * 1.6 : 2);
    const swing = Math.sin(enemy.walkPhase) * stride * parts.swing;
    parts.legL.rotation.x = swing;
    parts.legR.rotation.x = -swing;

    const armSwing = swing * 0.7;
    parts.armL.rotation.x = parts.armBase - armSwing + enemy.coughAnim * 0.4;
    parts.armR.rotation.x = parts.armBase + armSwing + enemy.coughAnim * 0.4;

    // Attack-lunge telegraph: when crowding the player, surge forward, maw agape.
    let lunge = 0;
    if (enemy.lungeTime > 0) {
      lunge = 1;
    } else if (enemy.lungeWindup > 0) {
      lunge = 0.45 + (1 - enemy.lungeWindup / 0.24) * 0.35;
    } else if (dist < 2.1 && enemy.stagger <= 0) {
      enemy.lunge += dt * (5 + enemy.speed);
      lunge = Math.max(0, Math.sin(enemy.lunge));
    } else {
      enemy.lunge = 0;
    }

    const flinch = enemy.stagger > 0 ? Math.sin((enemy.stagger / 0.22) * Math.PI) * 0.5 : 0;
    const breath = moving ? 0 : Math.sin(performance.now() * 0.0024 + enemy.walkPhase) * 0.05;
    parts.upper.rotation.x = parts.leanBase + enemy.coughAnim * 0.45 + lunge * 0.4 - flinch + breath * 0.18;
    parts.upper.position.y = parts.upperBaseY + Math.abs(Math.cos(enemy.walkPhase)) * (moving ? 0.05 : 0.012) + (moving ? 0 : breath * 0.02);
    parts.headPivot.rotation.x = enemy.coughAnim * 0.7 - lunge * 0.25;
    parts.maw.scale.y = 1 + (enemy.coughAnim + lunge) * 1.6;

    enemy.blink -= dt;
    if (enemy.blink <= 0) enemy.blink = 2.4 + Math.random() * 3;
    const blinkClose = enemy.blink < 0.12 ? 1 - Math.abs(enemy.blink - 0.06) / 0.06 : 0;
    const pulse = 0.78 + Math.sin(performance.now() * 0.005 + enemy.walkPhase * 2) * 0.22;
    // Face-camera factor: eyes (and only eyes) fade out when viewing the back
    // of the head so glow can never read on the skull from behind — especially
    // noticeable on large scaled enemies (bloater / boss).
    // Non-camera Object3D.lookAt faces +Z toward the target.
    const faceCam = eyeFaceCameraFactor(enemy);
    parts.eyeMat.opacity = Math.max(0, (pulse + lunge * 0.4) * (1 - blinkClose) * faceCam);
    if (parts.normalEyeMat.opacity > 0.01) {
      parts.normalEyeMat.opacity = Math.min(parts.normalEyeMat.opacity, faceCam);
    }
    parts.rimMat.opacity = (enemy.stagger > 0 ? 0.42 : enemy.type === "cougher" ? 0.28 : 0.2) + lunge * 0.15;
  }

  // 1 when the face points at the camera, 0 when the camera is behind the head.
  function eyeFaceCameraFactor(enemy) {
    const mesh = enemy.mesh;
    if (!mesh) return 1;
    // Ceiling crawlers are rotated upside-down; depth occluder is enough for them.
    if (enemy.type === "crawler") return 1;
    // Non-camera Object3D.lookAt faces local +Z at the target. Rotate (0,0,1)
    // by the mesh quaternion to get world facing on XZ.
    const q = mesh.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    let tx = camera.position.x - enemy.x;
    let tz = camera.position.z - enemy.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const fl = Math.hypot(fx, fz) || 1;
    const dot = (fx / fl) * tx + (fz / fl) * tz;
    // Soft falloff around the silhouette edge so eyes don't pop.
    return clamp((dot - 0.08) / 0.42, 0, 1);
  }

  const HEAL_DURATION = 0.9;

  // Tries a handful of random nearby points and returns the first walkable
  // one, so cured passengers wander instead of beelining through walls.
  function pickWanderTarget(enemy) {
    for (let i = 0; i < 8; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.5 + Math.random() * 4;
      const x = enemy.x + Math.cos(angle) * dist;
      const z = enemy.z + Math.sin(angle) * dist;
      if (!isWalkableWorld(x, z, 0.34)) continue;
      if (state.props.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 0.4)) continue;
      return { x, z };
    }
    return null;
  }

  // Cured enemies stop being a threat: skin crossfades from infected green to
  // a healthy tone, the eye-glow/rim fade out, they flap their mouth while the
  // speech bubble is up, and they amble off to wander the halls harmlessly.
  function updateCuredEnemy(enemy, dt) {
    const parts = enemy.mesh.userData.parts;
    if (!parts) return;

    if (enemy.healing) {
      enemy.healT = Math.min(1, enemy.healT + dt / HEAL_DURATION);
      const t = enemy.healT;
      // Enable transparency only while crossfading infected → healthy skin.
      parts.skinMat.transparent = true;
      parts.skinMat.opacity = 1 - t;
      parts.healthyMat.opacity = t;
      // Prefer depth writes on the dominant skin layer so eyes stay occluded.
      parts.skinMat.depthWrite = t < 0.55;
      parts.healthyMat.depthWrite = t >= 0.45;
      parts.rimMat.opacity = Math.max(0, parts.rimMat.opacity - dt * 1.8);
      const faceCam = eyeFaceCameraFactor(enemy);
      parts.eyeMat.opacity = Math.max(0, parts.eyeMat.opacity - dt * 1.6) * faceCam;
      parts.normalEyeMat.opacity = Math.min(1, t) * faceCam;
      parts.armL.rotation.x = lerp(parts.armL.rotation.x, 0.08, dt * 3);
      parts.armR.rotation.x = lerp(parts.armR.rotation.x, 0.08, dt * 3);
      parts.upper.rotation.x = lerp(parts.upper.rotation.x, 0.02, dt * 3);
      if (t >= 1) {
        enemy.healing = false;
        parts.skinMat.opacity = 0;
        parts.skinMat.depthWrite = false;
        parts.healthyMat.opacity = 1;
        parts.healthyMat.transparent = false;
        parts.healthyMat.depthWrite = true;
        parts.rimMat.opacity = 0;
        parts.eyeMat.opacity = 0;
        parts.normalEyeMat.opacity = faceCam;
      }
    } else if (parts.normalEyeMat.opacity > 0.01) {
      parts.normalEyeMat.opacity = eyeFaceCameraFactor(enemy);
    }

    if (enemy.talkTimer > 0) {
      enemy.talkTimer -= dt;
      parts.maw.scale.y = 1 + Math.abs(Math.sin(performance.now() * 0.02)) * 1.1;
    } else {
      parts.maw.scale.y = 1;
    }

    enemy.wanderTimer -= dt;
    let needsTarget = !enemy.wanderTarget;
    if (enemy.wanderTarget) {
      const dToTarget = Math.hypot(enemy.wanderTarget.x - enemy.x, enemy.wanderTarget.z - enemy.z);
      if (dToTarget < 0.35) needsTarget = true;
    }
    if (enemy.wanderTimer <= 0 || needsTarget) {
      enemy.wanderTimer = 2.5 + Math.random() * 3;
      enemy.wanderTarget = pickWanderTarget(enemy);
    }

    let moving = false;
    if (enemy.wanderTarget) {
      const dx = enemy.wanderTarget.x - enemy.x;
      const dz = enemy.wanderTarget.z - enemy.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.1) {
        moving = true;
        const speed = 0.85;
        moveEntity(enemy, (dx / len) * speed * dt, (dz / len) * speed * dt, Math.min(enemy.radius || 0.34, 0.5));
        enemy.mesh.position.set(enemy.x, 0, enemy.z);
        // Same-height target as the mesh's own pivot: yaw only, never pitch.
        // (A raised target made the figure lean back hard as it neared the
        // target and the horizontal distance shrank toward zero.)
        enemy.mesh.lookAt(enemy.x + dx, 0, enemy.z + dz);
      }
    }
    enemy.mesh.position.set(enemy.x, 0, enemy.z);

    enemy.walkPhase += dt * (moving ? 3.6 : 1.6);
    const stride = moving ? 0.4 : 0.06;
    const swing = Math.sin(enemy.walkPhase) * stride;
    parts.legL.rotation.x = swing;
    parts.legR.rotation.x = -swing;
    if (!enemy.healing) {
      parts.armL.rotation.x = 0.08 - swing * 0.5;
      parts.armR.rotation.x = 0.08 + swing * 0.5;
    }
    parts.upper.position.y = parts.upperBaseY + Math.abs(Math.cos(enemy.walkPhase)) * (moving ? 0.035 : 0.01);
  }

  // Floating speech-bubble billboards for the cured one-liners.
  function makeSpeechTexture(text) {
    const w = 256, h = 96;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const bw = w - 14, bh = h - 28, bx = 7, by = 6, r = 16;
    g.fillStyle = "rgba(248,248,244,0.96)";
    g.strokeStyle = "rgba(18,18,22,0.9)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(bx + r, by);
    g.arcTo(bx + bw, by, bx + bw, by + bh, r);
    g.arcTo(bx + bw, by + bh, bx, by + bh, r);
    g.arcTo(bx, by + bh, bx, by, r);
    g.arcTo(bx, by, bx + bw, by, r);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(w / 2 - 12, by + bh - 2);
    g.lineTo(w / 2 + 6, by + bh - 2);
    g.lineTo(w / 2 - 4, by + bh + 16);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#181818";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let fontSize = 21;
    do {
      g.font = `700 ${fontSize}px sans-serif`;
      fontSize -= 1;
    } while (g.measureText(text).width > bw - 22 && fontSize > 11);
    g.fillText(text, w / 2, by + bh / 2 - 2);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function spawnSpeech(x, z, text) {
    const tex = makeSpeechTexture(text);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.15, 1.15 * (96 / 256), 1);
    sprite.position.set(x, 2.05, z);
    fxRoot.add(sprite);
    state.speeches.push({ mesh: sprite, life: 2.1, maxLife: 2.1 });
  }

  function updateSpeeches(dt) {
    for (let i = state.speeches.length - 1; i >= 0; i -= 1) {
      const s = state.speeches[i];
      s.life -= dt;
      s.mesh.position.y += dt * 0.3;
      s.mesh.material.opacity = s.life < 0.5 ? clamp(s.life / 0.5, 0, 1) : clamp((s.maxLife - s.life) / 0.2, 0, 1);
      if (s.life <= 0) { fxRoot.remove(s.mesh); state.speeches.splice(i, 1); }
    }
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
      const fade = clamp(beam.life / beam.maxLife, 0, 1);
      beam.materials.forEach(({ mat, opacity }) => {
        mat.opacity = opacity * fade;
      });
      if (beam.life <= 0) {
        fxRoot.remove(beam.mesh);
        state.beams.splice(i, 1);
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= dt;
      if (particle.puddle) {
        particle.mesh.material.opacity = clamp(particle.life / 0.6, 0, 1) * 0.5;
        const s = 1.0 + (0.6 - particle.life) * 1.6;
        particle.mesh.scale.set(s, s, 1);
      } else {
        particle.vy -= 6 * dt;
        particle.mesh.position.x += particle.vx * dt;
        particle.mesh.position.y += particle.vy * dt;
        particle.mesh.position.z += particle.vz * dt;
        particle.mesh.material.opacity = clamp(particle.life / 0.65, 0, 1);
      }
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
        if (state.shotgunLoaded <= 0) {
          const loaded = Math.min(SHOTGUN_TUBE_SIZE, state.shotgunAmmo);
          state.shotgunLoaded += loaded;
          state.shotgunAmmo -= loaded;
        }
        state.weapon = "shotgun";
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.5 });
        setStatus(`${SHOTGUN_DISPLAY_NAME} acquired. Press R to reload when empty.`);
      } else if (pickup.type === "pistol") {
        state.dartUnlocked = true;
        state.dartAmmo = DART_MAG_SIZE;
        state.dartReserve += 18;
        state.weapon = "dart";
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.5 });
        setStatus("Ivermectin Pistol acquired. Press R to reload, 1 for the trusty plunger.");
      } else if (pickup.type === "bombkit") {
        state.bombUnlocked = true;
        state.bombAmmo = Math.min(BOMB_MAX_AMMO, state.bombAmmo + 2);
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.5 });
        setStatus(`${BOMB_DISPLAY_NAME}s unlocked. Press 4 (or G to quick-throw).`);
      } else if (pickup.type === "shells") {
        state.shotgunAmmo += 6;
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.42 });
        setStatus("Silver ampoules recovered. Press R to reload.");
      } else if (pickup.type === "darts") {
        state.dartReserve += 12;
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.42 });
        setStatus("Ivermectin darts restocked (+12).");
      } else if (pickup.type === "bombs") {
        const gained = Math.min(2, BOMB_MAX_AMMO - state.bombAmmo);
        state.bombAmmo = Math.min(BOMB_MAX_AMMO, state.bombAmmo + 2);
        playSound("pickup", { cooldown: 0.2, fallbackKind: "hit", volume: 0.42 });
        setStatus(gained > 0 ? `${BOMB_DISPLAY_NAME}s acquired (+${gained}).` : "Bomb bag full. The yogurt stays behind.");
      } else {
        state.infection = Math.max(0, state.infection - 24);
        playSound("cure", { cooldown: 0.25, fallbackKind: "hit", volume: 0.32 });
        setStatus("Fresh-air canister used. Infection reduced.");
      }
    }
  }

  function updateInfection(dt) {
    const tile = currentTileType();
    if (tile === Tile.HAZARD) {
      state.infection += (6.2 + state.level * 0.25) * dt;
      state.lurchTimer = Math.max(state.lurchTimer, 0.1);
    }

    if (tile === Tile.FRESH) {
      state.infection -= FRESH_VENT_HEAL_RATE * dt;
      if (state.statusTimer <= 0) setStatus("Fresh-air vent easing the infection down.", 0.85);
    }

    state.infection = clamp(state.infection, 0, 100);
    if (state.infection >= 100) {
      gameOver("The infection meter maxed out. Too much cough cloud, not enough stairwell.");
    }
  }

  function movePlayer(dt) {
    const prevX = player.x;
    const prevZ = player.z;
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
    const slimeSlow = state.stuckTimer > 0 ? 0.08 : 1;
    const speed = (input.sprint ? SPRINT_SPEED : PLAYER_SPEED) * infectionSlow * slimeSlow;
    const dx = mx * speed * dt;
    const dz = mz * speed * dt;
    const nx = player.x + dx;
    const nz = player.z + dz;
    if (isWalkableWorld(nx, player.z) && !collidesWithProps(nx, player.z, PLAYER_RADIUS * 0.85, player.x, player.z)) player.x = nx;
    if (isWalkableWorld(player.x, nz) && !collidesWithProps(player.x, nz, PLAYER_RADIUS * 0.85, player.x, player.z)) player.z = nz;
    updateFootstepAudio(dt, len > 0 && Math.hypot(player.x - prevX, player.z - prevZ) > 0.002);

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
      if (exitUnlocked()) {
        completeLevel();
      } else if (bossesRemaining() > 0 && state.cures >= state.neededCures) {
        setStatus(`Lifeboat locked. ${state.bossName || "The boss"} must be cured first.`, 1);
      } else {
        setStatus(`Lifeboat locked. Cure ${state.neededCures - state.cures} more passenger${state.neededCures - state.cures === 1 ? "" : "s"}.`, 1);
      }
    }
  }

  function updateTimers(dt) {
    state.dartCooldown = Math.max(0, state.dartCooldown - dt);
    state.shotgunCooldown = Math.max(0, state.shotgunCooldown - dt);
    state.meleeCooldown = Math.max(0, state.meleeCooldown - dt);
    state.bombCooldown = Math.max(0, state.bombCooldown - dt);
    if (state.reloadTimer > 0) {
      state.reloadTimer = Math.max(0, state.reloadTimer - dt);
      if (state.reloadTimer <= 0) finishReload();
    }
    state.lurchTimer = Math.max(0, state.lurchTimer - dt);
    const wasStuck = state.stuckTimer > 0;
    state.stuckTimer = Math.max(0, state.stuckTimer - dt);
    if (wasStuck && state.stuckTimer <= 0 && state.mode === "playing") {
      setStatus("Slime broke loose. Move.", 1.1);
    }
    if (state.statusTimer > 0) {
      state.statusTimer -= dt;
      if (state.statusTimer <= 0) hideStatus();
    }
  }

  // ---- Discovery minimap ----
  // Fog-of-war: tiles within a few metres of the player get flagged as
  // discovered and stay on the map. The stairwell exit gets a pulsing marker
  // once (and only once) the player has actually laid eyes on it.
  const MINIMAP_REVEAL_TILES = 4;
  let minimapDrawTimer = 0;

  function resetDiscovery() {
    state.discovered = state.map ? new Uint8Array(state.map.w * state.map.h) : null;
    minimapDrawTimer = 0;
  }

  function revealAroundPlayer() {
    const map = state.map;
    if (!map || !state.discovered) return;
    const t = worldToTile(player.x, player.z, map);
    for (let dy = -MINIMAP_REVEAL_TILES; dy <= MINIMAP_REVEAL_TILES; dy += 1) {
      for (let dx = -MINIMAP_REVEAL_TILES; dx <= MINIMAP_REVEAL_TILES; dx += 1) {
        if (dx * dx + dy * dy > MINIMAP_REVEAL_TILES * MINIMAP_REVEAL_TILES + 2) continue;
        const gx = t.gx + dx;
        const gy = t.gy + dy;
        if (!inBounds(gx, gy, map)) continue;
        state.discovered[gy * map.w + gx] = 1;
      }
    }
  }

  function drawMinimap() {
    if (!minimapCtx || !state.map || !state.discovered) return;
    const map = state.map;
    const ctx = minimapCtx;
    const size = el.minimap.width;
    ctx.clearRect(0, 0, size, size);
    const s = (size - 10) / Math.max(map.w, map.h);
    const ox = (size - map.w * s) / 2;
    const oy = (size - map.h * s) / 2;
    for (let gy = 0; gy < map.h; gy += 1) {
      for (let gx = 0; gx < map.w; gx += 1) {
        if (!state.discovered[gy * map.w + gx]) continue;
        const tile = map.grid[gy][gx];
        ctx.fillStyle = tile === Tile.WALL ? "rgba(82, 104, 128, 0.8)"
          : tile === Tile.HAZARD ? "rgba(166, 136, 34, 0.85)"
          : tile === Tile.FRESH ? "rgba(40, 158, 186, 0.85)"
          : tile === Tile.EXIT ? "#68ff72"
          : "rgba(14, 32, 46, 0.85)";
        ctx.fillRect(ox + gx * s, oy + gy * s, s + 0.5, s + 0.5);
      }
    }

    if (state.discovered[map.exit.gy * map.w + map.exit.gx]) {
      const pulse = 0.55 + Math.sin(performance.now() * 0.006) * 0.35;
      ctx.strokeStyle = `rgba(104, 255, 114, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + map.exit.gx * s - 2.5, oy + map.exit.gy * s - 2.5, s + 5, s + 5);
    }

    // Player arrow: canvas up = -gy, forward in world is (-sin yaw, -cos yaw),
    // so the arrow simply rotates by -yaw.
    const px = ox + (player.x / TILE + map.w / 2) * s;
    const py = oy + (player.z / TILE + map.h / 2) * s;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = "#2ee0ff";
    ctx.strokeStyle = "rgba(2, 5, 10, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.6, 4);
    ctx.lineTo(-3.6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function updateMinimap(dt) {
    if (!minimapCtx) return;
    revealAroundPlayer();
    minimapDrawTimer -= dt;
    if (minimapDrawTimer > 0) return;
    minimapDrawTimer = 0.12;
    drawMinimap();
  }

  // Rotating NOISE ALCHEMY dread bed: a random low drone every dozen-ish
  // seconds, pitched slightly differently each time so the deck never sounds
  // like a loop. Creeps a little louder/denser as the infection climbs.
  function updateAmbience(dt) {
    state.ambientTimer -= dt;
    if (state.ambientTimer > 0) return;
    const dreadVolume = 0.13 + Math.random() * 0.07 + (state.infection / 100) * 0.1;
    playSound("dread", {
      cooldown: 7,
      cooldownKey: "dread-bed",
      fallback: false,
      rate: 0.92 + Math.random() * 0.14,
      volume: clamp(dreadVolume, 0, 0.32),
    });
    state.ambientTimer = 10 + Math.random() * 9 - Math.min(5, state.level * 0.3);
  }

  function update(dt) {
    updateTimers(dt);
    if (state.mode !== "playing") {
      updateWeapon(dt);
      updateSpeeches(dt);
      updateFx(dt);
      updateHud(dt);
      return;
    }
    movePlayer(dt);
    updateWeapon(dt);
    updateEnemies(dt);
    updateClouds(dt);
    updateSlimeBolts(dt);
    updateBombs(dt);
    updateSpeeches(dt);
    updatePickups(dt);
    updateFx(dt);
    updateInfection(dt);
    updateAmbience(dt);
    updateMinimap(dt);
    state.score += dt * (state.level * 2);
    updateHud(dt);
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

  function beginTouchLook(clientX, clientY, pointerId = "touch", force = false) {
    if (touchLook.active && !force) return;
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
      const reloadButton = el.mobileControls.querySelector("[data-mobile-action='reload']");
      const bombButton = el.mobileControls.querySelector("[data-mobile-action='bomb']");
      const useButton = el.mobileControls.querySelector("[data-mobile-action='use']");
      if (fireButton) bindTapButton(fireButton, fireWeapon);
      if (sprintButton) bindHoldButton(sprintButton, () => { input.sprint = true; }, () => { input.sprint = false; });
      if (switchButton) bindTapButton(switchButton, switchWeapon);
      if (reloadButton) bindTapButton(reloadButton, () => startReload(state.weapon));
      if (bombButton) bindTapButton(bombButton, () => { if (state.mode === "playing") fireBomb(); });
      if (useButton) bindTapButton(useButton, tryUseExit);
    }

    const lookSurface = canvas || canvasWrap;

    if (window.PointerEvent) {
      lookSurface.addEventListener("pointerdown", (event) => {
        if (state.mode !== "playing" || isLookBlockedTarget(event.target)) return;
        if (touchLook.active) return;
        if (event.pointerType === "mouse" && isPointerLocked()) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        beginTouchLook(event.clientX, event.clientY, `pointer-${event.pointerId}`);
        if (lookSurface.setPointerCapture) {
          try { lookSurface.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        }
      }, { passive: false });

      lookSurface.addEventListener("pointermove", (event) => {
        if (!touchLook.active || touchLook.pointerId !== `pointer-${event.pointerId}` || state.mode !== "playing") return;
        if (event.cancelable) event.preventDefault();
        moveTouchLook(event.clientX, event.clientY);
      });

      const endPointerLook = (event) => endTouchLook(`pointer-${event.pointerId}`);
      lookSurface.addEventListener("pointerup", endPointerLook);
      lookSurface.addEventListener("pointercancel", endPointerLook);
      window.addEventListener("pointerup", endPointerLook);
      window.addEventListener("pointercancel", endPointerLook);
    }

    const supportsRawTouch = typeof TouchEvent !== "undefined" || "ontouchstart" in window || (navigator && navigator.maxTouchPoints > 0);

    if (supportsRawTouch) {
      lookSurface.addEventListener("touchstart", (event) => {
        if (state.mode !== "playing" || isLookBlockedTarget(event.target)) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        if (event.cancelable) event.preventDefault();
        beginTouchLook(touch.clientX, touch.clientY, `touch-${touch.identifier}`, true);
      }, { passive: false });

      lookSurface.addEventListener("touchmove", (event) => {
        if (!touchLook.active || state.mode !== "playing") return;
        const touch = [...event.changedTouches].find((item) => `touch-${item.identifier}` === touchLook.pointerId);
        if (!touch) return;
        if (event.cancelable) event.preventDefault();
        moveTouchLook(touch.clientX, touch.clientY);
      }, { passive: false });

      const endTouch = (event) => {
        const touch = [...event.changedTouches].find((item) => `touch-${item.identifier}` === touchLook.pointerId);
        if (touch) endTouchLook(`touch-${touch.identifier}`);
      };
      lookSurface.addEventListener("touchend", endTouch);
      lookSurface.addEventListener("touchcancel", endTouch);
      window.addEventListener("touchend", endTouch);
      window.addEventListener("touchcancel", endTouch);
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
      if (key === "1") setWeapon("melee");
      if (key === "2") setWeapon("dart");
      if (key === "3") setWeapon("shotgun");
      if (key === "4") setWeapon("bomb");
      if (key === "q") switchWeapon();
      if (key === "g" && state.mode === "playing") fireBomb();
      if (key === "r" && state.mode === "playing") {
        event.preventDefault();
        startReload(state.weapon);
      }
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

    // Scroll wheel cycles the arsenal (throttled so a single trackpad flick
    // doesn't spin through every weapon at once).
    let lastWheelSwitch = 0;
    document.addEventListener("wheel", (event) => {
      if (state.mode !== "playing") return;
      const overGame = isPointerLocked() || (event.target && canvasWrap && canvasWrap.contains(event.target));
      if (!overGame) return;
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      if (now - lastWheelSwitch < 180 || Math.abs(event.deltaY) < 4) return;
      lastWheelSwitch = now;
      cycleWeapon(event.deltaY > 0 ? 1 : -1);
    }, { passive: false });

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
        unlockAudio();
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
        if (state.sound) playSound("pickup", { fallbackKind: "hit", volume: 0.24 });
      });
    }
    if (el.freshAir) {
      el.freshAir.addEventListener("click", async () => {
        const ok = api.isAdFree && api.isAdFree() ? true : await api.showRewarded("fresh-air-purge");
        if (!ok) return;
        state.infection = Math.max(0, state.infection - 45);
        playSound("cure", { fallbackKind: "hit", volume: 0.38 });
        setStatus("Fresh-air purge activated.");
      });
    }
    if (el.shells) {
      el.shells.addEventListener("click", async () => {
        const ok = api.isAdFree && api.isAdFree() ? true : await api.showRewarded("shotgun-kit");
        if (!ok) return;
        state.shotgunUnlocked = true;
        state.shotgunAmmo += 12;
        if (state.shotgunLoaded <= 0) {
          const loaded = Math.min(SHOTGUN_TUBE_SIZE, state.shotgunAmmo);
          state.shotgunLoaded += loaded;
          state.shotgunAmmo -= loaded;
        }
        state.weapon = "shotgun";
        playSound("pickup", { fallbackKind: "hit", volume: 0.46 });
        setStatus(`${SHOTGUN_DISPLAY_NAME} kit unlocked. Press R to reload.`);
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
      btn.textContent = on ? "✕" : "⛶";
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

  function bootGame() {
    state.map = generateMap(1);
    buildWorld();
    scatterProps();
    spawnEnemies();
    spawnPickups();
    const start = tileToWorld(state.map.start.gx, state.map.start.gy, state.map);
    player.x = start.x;
    player.z = start.z;
    camera.position.set(player.x, EYE_Y, player.z);
    updateExitDoor();
    updateHud();
    setStatus("Click start, then click the canvas for mouse look.", 0);
    bindControls();
    bindMobileControls();
    bindButtons();
    initFullscreen();
    resize();
    lastTime = performance.now();
    raf = requestAnimationFrame(renderLoop);
  }

  async function init() {
    setStatus("Loading cruise textures...", 0);
    await waitForTextureLoads();
    bootGame();
  }

  window.__POOP_CRUISE = {
    state,
    player,
    startRun,
    loadLevel,
    fireWeapon,
    getTextureStatus() {
      return { ...textureLoadStatus };
    },
    getAudioStatus() {
      return {
        ...audioStatus,
        contextState: audioCtx ? audioCtx.state : "idle",
        buffered: audioBuffers.size,
        queued: audioLoads.size,
      };
    },
    playSound(kind) {
      return playSound(kind, { fallbackKind: kind });
    },
    reload(weapon = state.weapon) {
      return startReload(weapon);
    },
    getAmmoStatus() {
      return {
        weapon: state.weapon,
        unlocked: WEAPON_ORDER.filter(isWeaponUnlocked),
        dartAmmo: state.dartAmmo,
        dartMagSize: DART_MAG_SIZE,
        dartReserve: state.dartReserve,
        shotgunLoaded: state.shotgunLoaded,
        shotgunTubeSize: SHOTGUN_TUBE_SIZE,
        shotgunReserve: state.shotgunAmmo,
        bombAmmo: state.bombAmmo,
        reloadTimer: state.reloadTimer,
        reloadWeapon: state.reloadWeapon,
      };
    },
    getWorldStatus() {
      return {
        level: state.level,
        props: state.props.length,
        propKinds: state.props.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}),
        enemies: state.enemies.length,
        alert: state.enemies.filter((e) => !e.cured && e.alert).length,
        wandering: state.enemies.filter((e) => !e.cured && !e.alert).length,
        sniffers: state.enemies.filter((e) => e.sniffer).length,
        bosses: state.enemies.filter((e) => e.type === "boss").length,
        bossesRemaining: bossesRemaining(),
        bossName: state.bossName,
        neededCures: state.neededCures,
        exitUnlocked: exitUnlocked(),
      };
    },
    setWeapon,
    fireBomb,
    fireMelee,
    setInfection(value) {
      state.infection = clamp(Number(value) || 0, 0, 100);
      updateHud();
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
    },
  };

  init().catch((error) => {
    console.warn("Cruise init failed after texture preload; starting with fallbacks.", error);
    bootGame();
  });
})();
