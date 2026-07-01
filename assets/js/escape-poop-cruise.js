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
  const DART_RANGE = 13;
  const SHOTGUN_RANGE = 18;
  const SHOTGUN_PELLETS = 10;
  const SHOTGUN_RADIUS_BOOST = 0.34;
  const SHOTGUN_DOSE = 1.9;
  const SHOTGUN_COOLDOWN = 0.62;
  const PROJECTILE_LIFE = 0.22;
  const WEAPON_LABELS = {
    dart: "Ivermectin Pistol",
    shotgun: "Silver Pumper",
  };
  const SHOTGUN_DISPLAY_NAME = "Colloidal Silver Pumper";
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
    high: api.getHighScore(GAME_ID) || 0,
    sound: true,
    weapon: "dart",
    shotgunUnlocked: false,
    shotgunAmmo: 0,
    dartCooldown: 0,
    shotgunCooldown: 0,
    recoil: 0,
    muzzleFlash: 0,
    lurchTimer: 0,
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
    infection: new URL("infection-hazard-atlas-ai-v1.png", textureAssetBase).href,
    exitDoor: new URL("exit-door-ai-v2.png", textureAssetBase).href,
  };

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

  function makeAtlasCellTexture(image, index, options = {}) {
    const grid = options.grid || 4;
    const size = options.size || 256;
    const inset = options.cropInset ?? 0.026;
    const cellW = image.naturalWidth / grid;
    const cellH = image.naturalHeight / grid;
    const col = index % grid;
    const row = Math.floor(index / grid);
    const sx = col * cellW + cellW * inset;
    const sy = row * cellH + cellH * inset;
    const sw = cellW * (1 - inset * 2);
    const sh = cellH * (1 - inset * 2);
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

  function loadAtlasIntoMaterials(url, materials, options = {}) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const grid = options.grid || 4;
      const maxCells = grid * grid;
      materials.forEach((mat, index) => {
        mat.map = makeAtlasCellTexture(image, index % maxCells, options);
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });
    };
    image.onerror = () => console.warn(`Texture atlas failed to load: ${url}`);
    image.src = url;
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
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      mat.map = makeAtlasCellTexture(image, index, { grid: 4, size: 256, cropInset: 0.034 });
      mat.color.set(tintColor);
      mat.needsUpdate = true;
    };
    image.onerror = () => console.warn(`Texture atlas failed to load: ${textureAssets.objects}`);
    image.src = textureAssets.objects;
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
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      mat.map = setupTexture(new THREE.Texture(image), {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
      mat.color.set(options.tintColor || 0xffffff);
      mat.needsUpdate = true;
    };
    image.onerror = () => console.warn(`Texture failed to load: ${url}`);
    image.src = url;
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
    dartGlow: new THREE.MeshBasicMaterial({ color: 0x2ee0ff }),
    shotGlow: new THREE.MeshBasicMaterial({ color: 0xff2e88 }),
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

  const dartGun = buildDartGun();
  const shotgun = buildShotgun();
  weaponGroup.add(dartGun.group, shotgun.group);

  function triggerRecoil(kind) {
    state.recoil = kind === "shotgun" ? 1 : 0.55;
    state.muzzleFlash = 1;
  }

  function updateWeapon(dt) {
    weaponGroup.visible = state.mode === "playing";
    if (!weaponGroup.visible) return;
    const isShotgun = state.weapon === "shotgun";
    dartGun.group.visible = !isShotgun;
    shotgun.group.visible = isShotgun;
    state.recoil = Math.max(0, state.recoil - dt * 6);
    state.muzzleFlash = Math.max(0, state.muzzleFlash - dt * 9);
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
    sprinter: { scale: 0.94, lean: 0.5, head: 0.9, armRaise: -0.4, swing: 1.5, gut: false, eye: 0xff5a35, glow: 0xff6a2e },
    // Small, hunched forward hard enough to read as quadrupedal; arms angle
    // steeply down to act as "front legs". Rendered upside-down near the
    // ceiling — see the crawler branch in updateEnemies.
    crawler: { scale: 0.6, lean: 1.05, head: 1.4, armRaise: 1.15, swing: 1.9, gut: false, eye: 0xccff33, glow: 0x9dff2e },
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
    // Faded onesie palette — pants/shoe match the shirt so it reads as one
    // sleeper suit instead of separate clothing pieces.
    crawler: { skin: 0x9be066, shirt: 0xc9d6a0, pants: 0xc9d6a0, shoe: 0xb7c590 },
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
    const u = (m) => m / VOX; // metres -> voxel units

    // Body sizes in METRES (converted to voxel units below). With the fine voxel
    // grid plus near-maximal corner radii, the SDF carves smoothly rounded edges:
    // a near-spherical head, capsule limbs, and slim legs. The crawler is built
    // with toddler proportions: oversized head, short stubby torso and limbs.
    const headR = isCough ? 0.295 : isSprint ? 0.235 : isCrawler ? 0.24 : 0.255;
    const hA = u(headR), hB = u(headR * 1.06), hC = u(headR);
    const tHX = u(isSprint ? 0.205 : isCough ? 0.275 : isCrawler ? 0.195 : 0.25);
    const tHY = u(isCrawler ? 0.205 : 0.335), tHZ = u(isCrawler ? 0.175 : 0.155), tR = u(0.14);
    const aR = u(isCrawler ? 0.1 : 0.11), aHY = u(isCrawler ? 0.21 : 0.36);
    const lR = u(isCrawler ? 0.095 : 0.1), lHY = u(isCrawler ? 0.19 : 0.42); // slim legs (crawler's are stubby)
    const handR = u(0.125), gutR = u(0.155);
    const footHX = u(0.14), footHY = u(0.065), footHZ = u(0.19), footR = u(0.05), footZ = u(0.11);

    const torso = [];
    let seen = new Set();
    voxShape(torso, seen, 0, tHY, 0, tHX + 2, tHY + 2, tHZ + 2, pal.shirt, 0.07,
      (x, y, z) => sdRoundBox(x, y, z, tHX, tHY, tHZ, tR) <= 0.05);
    if (isCough) {
      voxShape(torso, seen, 0, tHY * 0.55, tHZ + gutR * 0.45, gutR + 2, gutR + 2, gutR + 2, pal.shirt, 0.07,
        (x, y, z) => x * x + y * y + z * z <= gutR * gutR); // sick gut bulge
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
    skinMat.transparent = true;
    skinMat.depthWrite = false;
    // Healthy overlay shares the same geometry but ignores baked vertex colour,
    // so it renders as a flat normal skin tone. Crossfades in as skinMat fades out.
    const healthyMat = new THREE.MeshLambertMaterial({
      color: HEALTHY_SKIN_TONES[Math.floor(Math.random() * HEALTHY_SKIN_TONES.length)],
      emissive: 0x0a0703, transparent: true, opacity: 0, depthWrite: false,
    });
    // Widened per-instance size + posture jitter so instances of the same
    // type read as individuals, not clones.
    const girth = 0.86 + Math.random() * 0.28;
    const height = 0.88 + Math.random() * 0.22;
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
    const eyeMat = new THREE.MeshBasicMaterial({ color: look.eye, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const eyeL = new THREE.Mesh(eyeVoxGeo, eyeMat);
    eyeL.position.set(-d.eyeX, d.eyeY, d.eyeZ);
    const eyeR = new THREE.Mesh(eyeVoxGeo, eyeMat);
    eyeR.position.set(d.eyeX, d.eyeY, d.eyeZ);
    // Normal (non-glowing) eyes crossfade in as the infected glow fades out,
    // so cured passengers end up with calm eyes instead of a blank face.
    // renderOrder must be ABOVE the healthy-head overlay (1): both are
    // transparent + depthWrite:false, so paint order (not real depth) decides
    // what's on top — without this the opaque-looking head paints over them.
    const normalEyeMat = new THREE.MeshLambertMaterial({
      color: NORMAL_EYE_COLORS[Math.floor(Math.random() * NORMAL_EYE_COLORS.length)],
      emissive: 0x100c08, transparent: true, opacity: 0, depthWrite: false,
    });
    const eyeLNormal = new THREE.Mesh(eyeVoxGeo, normalEyeMat);
    eyeLNormal.position.copy(eyeL.position);
    eyeLNormal.position.z += 0.012;
    eyeLNormal.scale.setScalar(0.82);
    eyeLNormal.renderOrder = 2;
    const eyeRNormal = new THREE.Mesh(eyeVoxGeo, normalEyeMat);
    eyeRNormal.position.copy(eyeR.position);
    eyeRNormal.position.z += 0.012;
    eyeRNormal.scale.setScalar(0.82);
    eyeRNormal.renderOrder = 2;
    const maw = new THREE.Mesh(mawVoxGeo, mats.maw);
    maw.position.set(0, d.mawY, d.mawZ);
    headPivot.add(eyeL, eyeR, eyeLNormal, eyeRNormal, maw);
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

    // Occasional cruise hat, otherwise hair — crowd variety up top.
    if (Math.random() < 0.4) {
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
      if (state.level >= 4 && rng() < 0.14 + state.level * 0.006) type = "crawler";
      // Speed jitter is per-instance (seeded, so it's reproducible within a
      // run) on top of the per-type/level formula, so a pack of the same type
      // doesn't move in perfect lockstep.
      const speedJitter = 0.88 + rng() * 0.28;
      const enemy = {
        id: `e${state.level}-${i}`,
        type,
        x: pos.x,
        z: pos.z,
        vx: 0,
        vz: 0,
        cured: false,
        inoculation: 0,
        resistance: type === "cougher" ? 1.65 : type === "sprinter" ? 1.25 : type === "crawler" ? 1.2 : 1.15,
        speed: ((type === "sprinter" ? 2.35 : type === "cougher" ? 1.35 : type === "crawler" ? 2.55 : 1.6) + Math.min(0.7, state.level * 0.06)) * speedJitter,
        crawlY: WALL_H - 0.4,
        spitTimer: 1.5 + rng() * 2,
        coughTimer: 1 + rng() * 2,
        stagger: 0,
        walkPhase: rng() * Math.PI * 2,
        coughAnim: 0,
        lunge: 0,
        blink: rng() * 3,
        healing: false,
        healT: 0,
        talkTimer: 0,
        wanderTarget: null,
        wanderTimer: 0,
        mesh: createEnemyMesh(type),
      };
      enemy.mesh.position.set(enemy.x, type === "crawler" ? enemy.crawlY : 0, enemy.z);
      enemyRoot.add(enemy.mesh);
      state.enemies.push(enemy);
    }

    state.neededCures = Math.max(2, Math.ceil(state.enemies.length * 0.64));
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
    state.speeches = [];
    state.beams = [];
    state.particles = [];
    state.slimeBolts = [];
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
    setStatus(`Deck ${level}: cure ${state.neededCures} passengers, then find the stairwell door.`);
    updateExitDoor();
    updateHud();
    hideOverlay();
    lockPointer();
  }

  function startRun() {
    state.runSeed = (Math.random() * 0xffffffff) >>> 0;
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
      `The stairwell door clanked open. Infection dropped during the fresh-air shuffle. Next deck adds more rooms, faster passengers, and worse buffet decisions.`,
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
    if (el.weapon) el.weapon.textContent = WEAPON_LABELS[state.weapon] || WEAPON_LABELS.dart;
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
    const open = state.cures >= state.neededCures;
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
    if (state.cures >= state.neededCures) completeLevel();
    else setStatus(`Stairwell locked. Cure ${state.neededCures - state.cures} more.`);
  }

  function switchWeapon() {
    if (state.weapon === "shotgun") {
      state.weapon = "dart";
      setStatus("Ivermectin Pistol ready.");
      return;
    }
    if (state.shotgunUnlocked) {
      state.weapon = "shotgun";
      setStatus(`${SHOTGUN_DISPLAY_NAME} ready.`);
    } else {
      setStatus(`${SHOTGUN_DISPLAY_NAME} is still somewhere on the ship.`);
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
      // Crawlers are hit where they're actually rendered (near the ceiling),
      // not at the usual standing-height centre.
      const hitY = enemy.type === "crawler" ? enemy.crawlY : 1.18;
      const center = new THREE.Vector3(enemy.x, hitY, enemy.z);
      const toEnemy = center.clone().sub(origin);
      const projected = toEnemy.dot(dir);
      if (projected <= 0.2 || projected > range) continue;
      const closest = origin.clone().addScaledVector(dir, projected);
      const radius = (enemy.type === "cougher" ? 0.72 : enemy.type === "crawler" ? 0.5 : 0.62) + radiusBoost;
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
    const hitBaseY = enemy.type === "crawler" ? enemy.crawlY - 0.3 : 1.2;
    enemy.inoculation += dose;
    enemy.stagger = 0.22;
    state.totalHits += 1;
    addParticles(enemy.x, enemy.z, 0xb7ff54, 9, hitBaseY);
    playBeep("hit");
    if (enemy.inoculation < enemy.resistance) {
      setStatus("Partial cure. Hit them again before they crowd you.");
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
    state.cures += 1;
    const typeBonus = enemy.type === "cougher" ? 175 : enemy.type === "sprinter" ? 150 : enemy.type === "crawler" ? 160 : 100;
    state.score += typeBonus + state.level * 12;
    setStatus(
      enemy.type === "cougher" ? "Cougher cured. The air is less terrible."
        : enemy.type === "crawler" ? "Crawler cured. It toddles off the ceiling."
        : "Passenger cured."
    );
    updateExitDoor();
  }

  function fireDart() {
    if (state.dartCooldown > 0) return;
    state.dartCooldown = 0.78;
    state.totalShots += 1;
    triggerRecoil("dart");
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hit = traceEnemy(dir, DART_RANGE, 0.06);
    if (hit) {
      cureEnemy(hit.enemy, 1);
      addBeam(hit.point, 0x2ee0ff, "dart");
    } else {
      const miss = camera.position.clone().addScaledVector(dir, DART_RANGE);
      addBeam(miss, 0x2ee0ff, "dart");
      setStatus("Ivermectin cure shot fired.");
      playBeep("miss");
    }
  }

  function fireShotgun() {
    if (!state.shotgunUnlocked) {
      setStatus(`Find the ${SHOTGUN_DISPLAY_NAME} pickup first.`);
      return;
    }
    if (state.shotgunAmmo <= 0) {
      setStatus(`${SHOTGUN_DISPLAY_NAME} empty. Switch to the Ivermectin Pistol or find a silver kit.`);
      state.weapon = "dart";
      return;
    }
    if (state.shotgunCooldown > 0) return;
    state.shotgunCooldown = SHOTGUN_COOLDOWN;
    state.shotgunAmmo -= 1;
    state.totalShots += 1;
    triggerRecoil("shotgun");
    playBeep("shotgun");

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
      setStatus(`${SHOTGUN_DISPLAY_NAME} blast fired.`);
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

  const slimeBoltGeo = new THREE.SphereGeometry(0.1, 6, 5);
  const slimeBoltMat = new THREE.MeshBasicMaterial({ color: 0x8aff2e, transparent: true, opacity: 0.92 });

  // A spit projectile: lerps from the crawler toward where the player was
  // standing when it fired, with a little upward arc, then splats into a
  // lingering hazard puddle (reusing the cougher's cloud system) and spikes
  // infection if the player is still standing in the impact zone.
  function spawnSlimeBolt(fromX, fromY, fromZ, toX, toY, toZ) {
    const dist = Math.hypot(toX - fromX, toY - fromY, toZ - fromZ);
    const travel = clamp(dist / 9, 0.3, 1.2);
    const mesh = new THREE.Mesh(slimeBoltGeo, slimeBoltMat);
    mesh.position.set(fromX, fromY, fromZ);
    fxRoot.add(mesh);
    state.slimeBolts.push({ mesh, fromX, fromY, fromZ, toX, toY, toZ, t: 0, travel });
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
        if (dist < 1.6) {
          state.infection = clamp(state.infection + 9, 0, 100);
          state.lurchTimer = Math.max(state.lurchTimer, 0.2);
          setStatus("Slime hit! Infection spiked.", 1.4);
        }
        addParticles(b.toX, b.toZ, 0x8aff2e, 10, 0.25);
        spawnCloud(b.toX, b.toZ, 1.1);
        fxRoot.remove(b.mesh);
        state.slimeBolts.splice(i, 1);
      }
    }
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
        // Crawlers barely infect by touch — their threat is the ranged spit below.
        state.infection += (enemy.type === "sprinter" ? 10.5 : enemy.type === "crawler" ? 4.5 : 8.2) * dt;
        state.lurchTimer = Math.max(state.lurchTimer, 0.18);
      } else if (dist < 6.5) {
        state.infection += (6.5 - dist) * (0.5 + state.level * 0.035) * dt * (enemy.type === "crawler" ? 0.4 : 1);
      }

      if (enemy.type === "cougher") {
        enemy.coughTimer -= dt;
        if (enemy.coughTimer <= 0 && dist < 12) {
          enemy.coughTimer = 2.4 + Math.random() * 2.4;
          enemy.coughAnim = 1;
          spawnCloud(enemy.x, enemy.z, 1.65 + Math.random() * 0.65);
        }
      }

      if (enemy.type === "crawler") {
        enemy.spitTimer -= dt;
        if (enemy.spitTimer <= 0 && dist < 11 && hasLineOfSight(enemy.x, enemy.z, player.x, player.z)) {
          enemy.spitTimer = 2.2 + Math.random() * 1.8;
          enemy.coughAnim = 1; // reuses the head-dip/maw-open telegraph
          spawnSlimeBolt(enemy.x, enemy.crawlY, enemy.z, player.x, EYE_Y, player.z);
        }
      }

      if (enemy.type === "crawler") {
        // Rendered upside-down near the ceiling: same XZ pathing/collision as
        // every other enemy (the flow-field doesn't know about height), just
        // repositioned and flipped for the ceiling-crawl illusion.
        enemy.mesh.position.set(enemy.x, enemy.crawlY, enemy.z);
        if (dist > 0.05) {
          enemy.mesh.lookAt(player.x, enemy.crawlY, player.z);
          enemy.mesh.rotateZ(Math.PI);
        }
      } else {
        enemy.mesh.position.set(enemy.x, 0, enemy.z);
        // Target the same height as the mesh's own pivot (ground level) so this
        // only ever yaws the figure — targeting a raised point pitches the whole
        // body backward as the horizontal distance shrinks (e.g. up close).
        if (dist > 0.05) enemy.mesh.lookAt(player.x, 0, player.z);
      }
      animateEnemy(enemy, dt, dist, enemy.stagger <= 0);
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
    if (dist < 2.1 && enemy.stagger <= 0) {
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
    parts.eyeMat.opacity = Math.max(0, (pulse + lunge * 0.4) * (1 - blinkClose));
    parts.rimMat.opacity = (enemy.stagger > 0 ? 0.42 : enemy.type === "cougher" ? 0.28 : 0.2) + lunge * 0.15;
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
      if (isWalkableWorld(x, z, 0.34)) return { x, z };
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
      parts.skinMat.opacity = 1 - t;
      parts.healthyMat.opacity = t;
      parts.rimMat.opacity = Math.max(0, parts.rimMat.opacity - dt * 1.8);
      parts.eyeMat.opacity = Math.max(0, parts.eyeMat.opacity - dt * 1.6);
      parts.normalEyeMat.opacity = Math.min(1, parts.normalEyeMat.opacity + dt * 1.6);
      parts.armL.rotation.x = lerp(parts.armL.rotation.x, 0.08, dt * 3);
      parts.armR.rotation.x = lerp(parts.armR.rotation.x, 0.08, dt * 3);
      parts.upper.rotation.x = lerp(parts.upper.rotation.x, 0.02, dt * 3);
      if (t >= 1) {
        enemy.healing = false;
        parts.skinMat.opacity = 0;
        parts.healthyMat.opacity = 1;
        parts.rimMat.opacity = 0;
        parts.eyeMat.opacity = 0;
        parts.normalEyeMat.opacity = 1;
      }
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
        moveEntity(enemy, (dx / len) * speed * dt, (dz / len) * speed * dt, 0.34);
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
        state.weapon = "shotgun";
        setStatus(`${SHOTGUN_DISPLAY_NAME} acquired. Press 1/2 to switch weapons.`);
      } else if (pickup.type === "shells") {
        state.shotgunAmmo += 6;
        setStatus("Silver ampoules recovered.");
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

    // Safe distance is pushed out past the proximity-damage falloff (6.5) so
    // the passive-drain and proximity-gain zones no longer overlap — standing
    // at mid-range used to net-heal even with an enemy nearby, since the old
    // drain band (>4.5) started well inside the gain band (<6.5).
    const safeDistance = closestEnemy > 9;
    if (tile === Tile.FRESH) {
      state.infection -= 10.5 * dt;
      if (state.statusTimer <= 0) setStatus("Fresh-air vent active. Infection dropping fast.", 0.85);
    } else if (safeDistance) {
      state.infection -= 2.1 * dt;
    } else if (closestEnemy > 6.5) {
      state.infection -= 0.9 * dt;
    }

    state.infection = clamp(state.infection, 0, 100);
    if (state.infection >= 100) {
      gameOver("The infection meter maxed out. Too much cough cloud, not enough stairwell.");
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
        el.status.textContent = state.cures >= state.neededCures ? "Find the stairwell door." : "Cure passengers and keep your distance.";
      }
    }
  }

  function update(dt) {
    updateTimers(dt);
    if (state.mode !== "playing") {
      updateWeapon(dt);
      updateSpeeches(dt);
      updateFx(dt);
      updateHud();
      return;
    }
    movePlayer(dt);
    updateWeapon(dt);
    const closest = updateEnemies(dt);
    updateClouds(dt);
    updateSlimeBolts(dt);
    updateSpeeches(dt);
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
      const useButton = el.mobileControls.querySelector("[data-mobile-action='use']");
      if (fireButton) bindTapButton(fireButton, fireWeapon);
      if (sprintButton) bindHoldButton(sprintButton, () => { input.sprint = true; }, () => { input.sprint = false; });
      if (switchButton) bindTapButton(switchButton, switchWeapon);
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
        setStatus(`${SHOTGUN_DISPLAY_NAME} kit unlocked.`);
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
