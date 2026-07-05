/* ============================================================
   SCRAP CIRCUIT: LAST CHASSIS STANDING — main runtime
   ------------------------------------------------------------
   Simulation, combat, AI, HUD, input, and match flow. Rendering
   goes through SCRAP.Ps1Renderer (ps1.js); content comes from
   SCRAP.vehicles / SCRAP.arenas; materials from SCRAP.textures.
   URL params: ?arena=<id>&vehicle=<id>&autostart=1&debug=1
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = window.SCRAP || {};
  const canvas = document.getElementById("gameCanvas");
  if (!canvas || !window.THREE || !SCRAP.Ps1Renderer) return;

  const GAME_ID = "scrap-circuit";
  const PARAMS = new URLSearchParams(location.search);
  const DEBUG = PARAMS.get("debug") === "1";

  const api = window.RB || {
    toast: () => {},
    recordScore: () => false,
    getHighScore: () => 0,
    showRewarded: () => Promise.resolve(true),
    isAdFree: () => true,
  };

  // ---------- tuning ----------
  const STEP = 1.3;            // ground step tolerance
  const GRAV = 26;
  const CAR_HEIGHT_EPS = 0.06;
  const RAM_COOLDOWN = 0.45;
  const PICKUP_RESPAWN = 12;
  const SPECIAL_RATE = 5.5;    // charge per second
  const BOT_SPECIAL_RATE = 7.5;
  const FALL_DAMAGE = 35;
  const STARTING_LIVES = 3;
  const LIFE_RESPAWN_SHIELD = 2.5;
  const RAM_DAMAGE_SCALE = 0.58;
  const RAM_SELF_DAMAGE_SCALE = 0.25;
  const RAM_TARGET_DAMAGE_MAX = 24;
  const RAM_SELF_DAMAGE_MAX = 14;

  // machinegun is the always-available baseline (infinite ammo); every other
  // weapon is an upgrade you pick up with finite ammo and revert from when spent.
  const WEAPONS = {
    machinegun: { name: "SCRAP SPITTER", icon: "🔫", ammo: Infinity, rate: 0.11, kind: "gun", base: true },
    missile: { name: "GRUDGE MISSILE", icon: "🚀", ammo: 4, rate: 0.55, kind: "missile" },
    freeze: { name: "COLD CALL", icon: "❄️", ammo: 3, rate: 0.6, kind: "freeze" },
    fire: { name: "TAILGATER", icon: "🔥", ammo: 1, rate: 0.8, kind: "fire" },
    remote: { name: "SEVERANCE PKG", icon: "💣", ammo: 2, rate: 0.4, kind: "remote" },
    mine: { name: "POTHOLE MINE", icon: "🧨", ammo: 4, rate: 0.3, kind: "mine" },
    ricochet: { name: "REBOUND CLAUSE", icon: "🎱", ammo: 3, rate: 0.5, kind: "ricochet" },
  };
  const BASE_WEAPON = "machinegun";
  // Pickup weights — machinegun omitted (it's the baseline). Upgrades + support.
  const PICKUP_TABLE = [
    ["missile", 16], ["freeze", 11], ["fire", 9],
    ["remote", 9], ["mine", 12], ["ricochet", 10],
    ["shield", 8], ["turbo", 8], ["wrench", 5], ["battery", 4],
  ];
  const PICKUP_ICONS = {
    missile: "🚀", freeze: "❄️", fire: "🔥", remote: "💣", mine: "🧨", ricochet: "🎱",
    shield: "🛡️", turbo: "⚡", wrench: "🔧", battery: "🔋",
  };
  const PICKUP_COLORS = {
    machinegun: 0xffd23b, missile: 0xff5e3b, freeze: 0x63d8ff, fire: 0xff8a2e,
    remote: 0xd23f6e, mine: 0xb0b6bd, ricochet: 0x9e63ff,
    shield: 0x63f2c8, turbo: 0x2ee0ff, wrench: 0x75ff92, battery: 0xf7d716,
  };

  // ---------- circuit mode ----------
  // All six arenas in sequence; HP carries over and repairs cost Salvage,
  // which is also the score — the economy IS the difficulty curve.
  const CIRCUIT_ORDER = ["suburb", "junkyard", "interchange", "boardwalk", "rooftop", "cemetery"];
  const CIRCUIT_PLACE_BONUS = [0, 250, 150, 100, 60, 30, 0]; // by placement, no extra win bonus
  const REPAIR_RATE = 3;            // salvage per HP of full repair
  const PATCH_HP = 30;              // budget option
  const PATCH_COST = 60;
  const PREMIUM_COST = 120;         // start next round with a 6s shield
  const WRITEOFF_BASE = 300;        // continue-after-wreck fee...
  const WRITEOFF_STEP = 200;        // ...grows per prior write-off
  const WRITEOFF_REVIVE = 0.55;     // revive at 55% max HP
  const CIRCUIT_FINISH_BONUS = 750;
  const CIRCUIT_SCORE_ID = "scrap-circuit-full";
  const BOT_ROUND_HP_SCALE = 0.06;  // bots toughen each round
  const BOT_ROUND_SPECIAL_SCALE = 0.1;

  const ESTIMATE_LINES = [
    "ESTIMATE: PAINFUL. LABOR NOT INCLUDED. NEITHER IS SYMPATHY.",
    "YOUR RATE WENT UP FOR ASKING.",
    "WE VALUE YOU AS A SOURCE OF PREMIUMS.",
    "PARTS ARE OEM*. (*ORIGINALLY EQUIPPED ON MAILBOXES.)",
    "THIS ESTIMATE EXPIRES WHILE YOU READ IT.",
  ];
  const WRITEOFF_LINES = [
    "TOTAL LOSS. PAY THE WRITE-OFF OR WALK HOME.",
    "YOUR CHASSIS HAS BEEN DEEMED 'A SITUATION.'",
    "WE'D CALL IT A MIRACLE YOU'RE ALIVE, BUT MIRACLES AREN'T COVERED.",
  ];

  // ---------- announcer: The Adjuster ----------
  const BARKS = {
    start: ["POLICIES ARE ACTIVE. DRIVE ANGRY!", "THE PREMIUMS ARE LIVE. GO!", "SIGN NOTHING. HIT EVERYTHING!"],
    firstblood: ["FIRST CLAIM OF THE NIGHT!", "SOMEBODY'S RATE JUST TRIPLED!"],
    wreck: ["TOTAL LOSS!", "CLAIM DENIED!", "THAT'S NOT COVERED!", "DEPRECIATED... TO ZERO!", "SALVAGE TITLE ISSUED!"],
    playerwreck: ["YOUR POLICY HAS LAPSED.", "REJECTED. LIKE YOUR PAPERWORK."],
    doublewreck: ["DOUBLE INDEMNITY!!"],
    lowhp: ["YOUR DEDUCTIBLE IS SHOWING!", "PRE-EXISTING DAMAGE DETECTED!"],
    special: ["ACT OF GOD! NOT COVERED!", "FILE THAT UNDER 'INCIDENT'!", "UNINSURABLE BEHAVIOR!"],
    shield: ["FULL COVERAGE! TEMPORARILY!"],
    turbo: ["PREMIUM ACCELERATION PACKAGE!"],
    crusher: ["CRUSHED! READ THE FINE PRINT!"],
    traffic: ["FREIGHT HAPPENS!"],
    coaster: ["STRUCK BY FUN! NOT COVERED!"],
    grave: ["PRE-NEED PLOT! OCCUPIED!"],
    fall: ["GRAVITY IS AN EXCLUSION!"],
    sponsor: ["A WORD FROM OUR SPONSOR. YOU'RE WELCOME."],
    win: ["LAST CHASSIS STANDING! PREMIUMS ARE GOING UP ANYWAY!"],
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    wrap: canvas.closest(".canvas-wrap"),
    hpFill: $("hud-hp-fill"), hpText: $("hud-hp-text"),
    lives: $("hud-lives"),
    weaponIcon: $("hud-weapon-icon"), weaponName: $("hud-weapon-name"), weaponAmmo: $("hud-weapon-ammo"),
    specialFill: $("hud-special-fill"), specialName: $("hud-special-name"),
    salvage: $("hud-salvage"), alive: $("hud-alive"),
    bark: $("hud-bark"), arenaName: $("hud-arena"),
    minimap: $("hud-minimap"),
    sponsor: $("hud-sponsor"),
    countdown: $("hud-countdown"),
    statusChips: $("hud-status"),
    flash: $("hud-flash"),
    overlay: $("overlay"), overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"), overlayScore: $("overlay-score"),
    btnPrimary: $("btn-primary"),
    menu: $("menu-panel"),
    modeRow: $("mode-row"),
    summaryPanel: $("summary-panel"),
    circuitPanel: $("circuit-panel"),
    vehName: $("veh-name"), vehArch: $("veh-archetype"), vehFlavor: $("veh-flavor"),
    vehSpecial: $("veh-special"), vehStats: $("veh-stats"),
    menuVehiclePreview: $("menu-vehicle-preview"),
    menuMapPreview: $("menu-map-preview"),
    menuMapName: $("menu-map-name"),
    menuMapTag: $("menu-map-tag"),
    vehPrev: $("veh-prev"), vehNext: $("veh-next"),
    arenaRow: $("arena-row"),
    log: $("adjuster-log"),
    btnPause: $("btn-pause"), btnRestart: $("btn-restart"),
  };
  const miniCtx = el.minimap ? el.minimap.getContext("2d") : null;
  const menuMapCtx = el.menuMapPreview ? el.menuMapPreview.getContext("2d") : null;

  // ---------- audio: 100% synthesized ----------
  const sfx = (() => {
    let ac = null, engineOsc = null, engineGain = null, master = null;
    function ctx() {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    function blip(freq, dur, type = "square", vol = 0.2, slide = 0) {
      try {
        const a = ctx();
        const osc = a.createOscillator(), g = a.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, a.currentTime);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
        g.gain.setValueAtTime(vol, a.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
        osc.connect(g).connect(master);
        osc.start();
        osc.stop(a.currentTime + dur + 0.02);
      } catch (_) {}
    }
    function noise(dur, vol = 0.3, low = false) {
      try {
        const a = ctx();
        const len = Math.floor(a.sampleRate * dur);
        const buf = a.createBuffer(1, len, a.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = a.createBufferSource();
        src.buffer = buf;
        const g = a.createGain();
        g.gain.value = vol;
        const filter = a.createBiquadFilter();
        filter.type = low ? "lowpass" : "highpass";
        filter.frequency.value = low ? 380 : 900;
        src.connect(filter).connect(g).connect(master);
        src.start();
      } catch (_) {}
    }
    return {
      unlock() { try { ctx(); } catch (_) {} },
      shot() { noise(0.08, 0.12); },
      boom(big) {
        noise(big ? 0.5 : 0.3, big ? 0.5 : 0.3, true);
        blip(70, big ? 0.5 : 0.3, "sine", big ? 0.5 : 0.3, -40);
      },
      pickup() { blip(660, 0.12, "square", 0.16, 320); },
      freeze() { blip(1200, 0.4, "sine", 0.2, -700); },
      horn() { blip(220, 0.16, "square", 0.24, 60); setTimeout(() => blip(330, 0.22, "square", 0.22, 40), 90); },
      hit() { noise(0.06, 0.16); blip(140, 0.08, "triangle", 0.2, -60); },
      special() { blip(160, 0.5, "sawtooth", 0.28, 240); noise(0.35, 0.2, true); },
      win() { [392, 494, 587, 784].forEach((f, i) => setTimeout(() => blip(f, 0.28, "square", 0.2), i * 140)); },
      lose() { [330, 262, 196, 131].forEach((f, i) => setTimeout(() => blip(f, 0.3, "sawtooth", 0.18), i * 160)); },
      engine(speedRatio, running) {
        try {
          const a = ctx();
          if (!engineOsc) {
            engineOsc = a.createOscillator();
            engineOsc.type = "sawtooth";
            engineGain = a.createGain();
            engineGain.gain.value = 0;
            const filt = a.createBiquadFilter();
            filt.type = "lowpass";
            filt.frequency.value = 420;
            engineOsc.connect(filt).connect(engineGain).connect(master);
            engineOsc.start();
          }
          engineOsc.frequency.setTargetAtTime(38 + speedRatio * 120, a.currentTime, 0.08);
          engineGain.gain.setTargetAtTime(running ? 0.05 + speedRatio * 0.075 : 0, a.currentTime, 0.12);
        } catch (_) {}
      },
    };
  })();

  // ---------- state ----------
  const state = {
    phase: "menu", // menu | countdown | running | over
    mode: "single", // single | circuit
    circuit: null,  // { round, writeOffs, premium, hpCarry, results[] }
    paused: false,
    time: 0,
    countdownT: 0,
    arenaId: PARAMS.get("arena") || "suburb",
    vehicleIndex: 0,
    cars: [],
    player: null,
    projectiles: [],
    mines: [],
    firePatches: [],
    smokes: [],
    pickups: [],
    salvage: 0,
    wrecksByPlayer: 0,
    playerLives: STARTING_LIVES,
    firstBloodDone: false,
    sponsorUsed: false,
    barkCooldown: 0,
    shake: 0,
    lookBack: false,
  };
  const vParam = PARAMS.get("vehicle");
  if (vParam) {
    const idx = SCRAP.vehicles.list.findIndex((v) => v.id === vParam);
    if (idx >= 0) state.vehicleIndex = idx;
  }

  // ---------- three.js core ----------
  const ps1 = new SCRAP.Ps1Renderer(canvas, { height: 270, dither: 1 });
  if (SCRAP.textures && SCRAP.textures.configureRenderer) SCRAP.textures.configureRenderer(ps1.renderer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 420);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(hemi, sun);

  // Menu preview stage
  const previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color(0x0a0c14);
  previewScene.fog = new THREE.Fog(0x0a0c14, 18, 46);
  const pHemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a2030, 1.0);
  const pSun = new THREE.DirectionalLight(0xfff0d0, 0.9);
  pSun.position.set(6, 10, 8);
  previewScene.add(pHemi, pSun);
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(5.5, 6.2, 0.8, 14),
    SCRAP.textures ? SCRAP.textures.mat("ui.podium", { color: 0x2a3040 }) : new THREE.MeshLambertMaterial({ color: 0x2a3040 })
  );
  podium.position.y = -0.4;
  previewScene.add(podium);
  const previewCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 100);
  previewCam.position.set(0, 3.4, 11.5);
  previewCam.lookAt(0, 1.6, 0);
  const menuPreviewCam = new THREE.PerspectiveCamera(45, 16 / 10, 0.2, 100);
  menuPreviewCam.position.set(0, 3.0, 9.1);
  menuPreviewCam.lookAt(0, 1.35, 0);
  let menuPreviewRenderer = null;
  if (el.menuVehiclePreview) {
    try {
      menuPreviewRenderer = new THREE.WebGLRenderer({
        canvas: el.menuVehiclePreview,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      menuPreviewRenderer.setClearColor(0x080b12, 1);
      menuPreviewRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      if (SCRAP.textures && SCRAP.textures.configureRenderer) SCRAP.textures.configureRenderer(menuPreviewRenderer);
    } catch (_) {
      menuPreviewRenderer = null;
    }
  }
  let previewMesh = null;

  let arena = null;

  // ---------- FX ----------
  const fxGroup = new THREE.Group();
  scene.add(fxGroup);
  const particlePool = [];
  const PARTICLE_MAX = 140;
  const particleGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const particleMats = {};
  function particleMat(color) {
    if (!particleMats[color]) {
      particleMats[color] = new THREE.MeshBasicMaterial({ color });
      if (SCRAP.ps1ify) SCRAP.ps1ify(particleMats[color]);
    }
    return particleMats[color];
  }
  function burst(x, y, z, color, count = 10, power = 8, up = 6) {
    for (let i = 0; i < count; i += 1) {
      let p = particlePool.find((q) => !q.alive);
      if (!p) {
        if (particlePool.length >= PARTICLE_MAX) break;
        p = { mesh: new THREE.Mesh(particleGeo, particleMat(color)), alive: false };
        fxGroup.add(p.mesh);
        particlePool.push(p);
      }
      p.alive = true;
      p.mesh.visible = true;
      p.mesh.material = particleMat(color);
      p.mesh.position.set(x, y, z);
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * power;
      p.vx = Math.cos(ang) * sp;
      p.vz = Math.sin(ang) * sp;
      p.vy = Math.random() * up;
      p.ttl = 0.5 + Math.random() * 0.6;
      const s = 0.6 + Math.random() * 1.2;
      p.mesh.scale.set(s, s, s);
    }
  }
  function updateParticles(dt) {
    particlePool.forEach((p) => {
      if (!p.alive) return;
      p.ttl -= dt;
      if (p.ttl <= 0) { p.alive = false; p.mesh.visible = false; return; }
      p.vy -= GRAV * 0.6 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.1, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 7;
      p.mesh.rotation.z += dt * 5;
    });
  }
  function flash(color = "rgba(255,240,200,0.5)", ms = 90) {
    if (!el.flash) return;
    el.flash.style.background = color;
    el.flash.style.opacity = "1";
    setTimeout(() => { el.flash.style.opacity = "0"; }, ms);
  }

  // ---------- announcer ----------
  function announce(key, force = false) {
    const lines = BARKS[key];
    if (!lines) return;
    if (!force && state.barkCooldown > 0) return;
    state.barkCooldown = 3.5;
    const line = lines[Math.floor(Math.random() * lines.length)];
    if (el.bark) {
      el.bark.textContent = `📋 ${line}`;
      el.bark.classList.remove("is-pop");
      void el.bark.offsetWidth;
      el.bark.classList.add("is-pop");
    }
    if (el.log) {
      const item = document.createElement("div");
      item.className = "scrap-log__item";
      item.textContent = line;
      el.log.prepend(item);
      while (el.log.children.length > 6) el.log.removeChild(el.log.lastChild);
    }
    sfx.horn();
  }

  // ---------- ground / collision ----------
  function sampleGround(x, z, carY) {
    let best = 0;
    if (!arena) return best;
    const hs = arena.heights;
    for (let i = 0; i < hs.length; i += 1) {
      const h = hs[i];
      if (Math.abs(x - h.x) > h.hw || Math.abs(z - h.z) > h.hd) continue;
      let y;
      if (h.type === "rect") y = h.y;
      else if (h.axis === "z") y = h.y0 + ((z - (h.z - h.hd)) / (h.hd * 2)) * (h.y1 - h.y0);
      else y = h.y0 + ((x - (h.x - h.hw)) / (h.hw * 2)) * (h.y1 - h.y0);
      if (y <= carY + STEP && y > best) best = y;
    }
    return best;
  }

  // Lowest elevated deck/roof above refY at (x,z). Used to duck the chase cam
  // under overpasses instead of snapping up onto the surface overhead.
  function sampleOverhead(x, z, refY) {
    let minY = Infinity;
    if (!arena) return minY;
    const hs = arena.heights;
    for (let i = 0; i < hs.length; i += 1) {
      const h = hs[i];
      if (h.type !== "rect") continue;
      if (Math.abs(x - h.x) > h.hw || Math.abs(z - h.z) > h.hd) continue;
      if (h.y > refY + 1.8) minY = Math.min(minY, h.y);
    }
    return minY;
  }

  function circleRectPush(car, r, box) {
    // Returns push vector or null.
    const dx = car.x - box.x, dz = car.z - box.z;
    const px = box.hw + r - Math.abs(dx);
    const pz = box.hd + r - Math.abs(dz);
    if (px <= 0 || pz <= 0) return null;
    if (px < pz) return { x: Math.sign(dx || 1) * px, z: 0 };
    return { x: 0, z: Math.sign(dz || 1) * pz };
  }

  function collideStatics(car) {
    if (!arena) return;
    for (let i = 0; i < arena.colliders.length; i += 1) {
      const c = arena.colliders[i];
      // Crest tolerance (STEP): a car whose height is within a step of the
      // collider top drives over it — so a car climbing a ramp mounts the deck
      // it leads to, while a ground-level car still bounces off taller walls.
      if (c.base >= car.y + 1.6 || c.top <= car.y + STEP) continue;
      const push = circleRectPush(car, car.def.stats.radius * 0.8, c);
      if (push) {
        car.x += push.x;
        car.z += push.z;
        // kill velocity into the wall
        if (push.x) car.vx *= 0.3;
        if (push.z) car.vz *= 0.3;
      }
    }
    // destructibles: soft collide + break on speed
    for (let i = 0; i < arena.destructibles.length; i += 1) {
      const d = arena.destructibles[i];
      if (!d.alive) continue;
      const push = circleRectPush(car, car.def.stats.radius * 0.7, d);
      if (push) {
        const speed = Math.hypot(car.vx, car.vz);
        damageDestructible(d, Math.max(4, speed * 1.2), car);
        car.x += push.x * 0.5;
        car.z += push.z * 0.5;
        car.vx *= 0.82;
        car.vz *= 0.82;
      }
    }
  }

  function damageDestructible(d, dmg, byCar) {
    if (!d.alive) return;
    d.hp -= dmg;
    if (d.hp <= 0) {
      d.alive = false;
      d.mesh.visible = false;
      burst(d.x, 1.2, d.z, 0xb0a488, 10, 7);
      sfx.hit();
      if (d.explosive) boom(d.x, 0.8, d.z, 7, 30, byCar || null);
      if (byCar && byCar.isPlayer) addSalvage(d.score);
    }
  }

  // ---------- cars ----------
  const iceGeo = new THREE.BoxGeometry(1, 1, 1);
  function makeCar(defId, isPlayer, spawn) {
    const def = SCRAP.vehicles.get(defId);
    const mesh = SCRAP.vehicles.build(defId);
    scene.add(mesh);
    const car = {
      def, isPlayer,
      mesh,
      x: spawn.x, z: spawn.z, y: 0, vy: 0,
      heading: spawn.h,
      vx: 0, vz: 0,
      wheelSpin: 0,
      hp: def.stats.hp, maxHp: def.stats.hp,
      weapon: BASE_WEAPON, ammo: Infinity, fireCooldown: 0, gunCooldown: 0,
      special: isPlayer ? 30 : 20,
      specialRate: isPlayer ? SPECIAL_RATE : BOT_SPECIAL_RATE,
      wrecked: false, wreckT: 0,
      frozen: 0, stunned: 0, burning: 0, burnTick: 0, slowed: 0,
      shield: 0, boost: 0,
      throttle: 0, steer: 0, drift: false, wantFire: false, wantPickupFire: false, wantSpecial: false,
      ramTimers: new Map(),
      remoteBomb: null,
      fx: {},
      ai: isPlayer ? null : { archetype: null, stuck: 0, reverseT: 0, retarget: 0, target: null, wander: Math.random() * Math.PI * 2 },
      lastDamageBy: null,
    };
    // status meshes
    const iceMat = new THREE.MeshLambertMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55 });
    if (SCRAP.ps1ify) SCRAP.ps1ify(iceMat);
    car.fx.ice = new THREE.Mesh(iceGeo, iceMat);
    car.fx.ice.scale.set(def.stats.radius * 2.2, 4, def.stats.radius * 2.6);
    car.fx.ice.position.y = 2;
    car.fx.ice.visible = false;
    mesh.add(car.fx.ice);
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x63f2c8, transparent: true, opacity: 0.26, side: THREE.DoubleSide });
    if (SCRAP.ps1ify) SCRAP.ps1ify(shieldMat);
    car.fx.shield = new THREE.Mesh(new THREE.SphereGeometry(def.stats.radius * 1.9, 10, 8), shieldMat);
    car.fx.shield.position.y = 1.6;
    car.fx.shield.visible = false;
    mesh.add(car.fx.shield);
    return car;
  }

  function forward(car) {
    return { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  }

  function applyDamage(car, dmg, opts = {}) {
    if (car.wrecked || state.phase !== "running") return;
    // Online: every client is the only authority on its own car's HP. Damage
    // my sim computes against a remote puppet is dropped — the same hazard
    // exists in the owner's sim and hurts them there.
    if (car.remote) return;
    if (car.shield > 0 && !opts.pierce) {
      burst(car.x, car.y + 1.6, car.z, 0x63f2c8, 5, 5);
      return;
    }
    car.hp -= dmg;
    car.lastDamageBy = opts.by || null;
    if (opts.by && opts.by.isPlayer && !car.isPlayer) addSalvage(Math.round(dmg));
    if (car.isPlayer) {
      state.shake = Math.min(1.2, state.shake + dmg / 60);
      if (car.hp > 0 && car.hp < car.maxHp * 0.28) announce("lowhp");
    }
    if (car.hp <= 0) wreck(car, opts);
  }

  function impulse(car, dx, dz, up = 0) {
    if (car.remote) return; // knockback on puppets is the owner's business
    const len = Math.hypot(dx, dz) || 1;
    const power = Math.min(26, Math.hypot(dx, dz) * 2 + 6);
    car.vx += (dx / len) * power;
    car.vz += (dz / len) * power;
    if (up) car.vy += up;
  }

  function wreck(car, opts = {}) {
    if (car.wrecked) return;
    if (car.remote && !opts.net) return; // puppets only wreck via their owner's snapshot
    car.wrecked = true;
    car.wreckT = 0;
    car.hp = 0;
    car.frozen = 0;
    car.fx.ice.visible = false;
    car.fx.shield.visible = false;
    burst(car.x, car.y + 1.4, car.z, 0xff8a2e, 22, 12, 9);
    burst(car.x, car.y + 1.4, car.z, 0x3a3a44, 14, 6, 8);
    boomVisual(car.x, car.y + 1, car.z, 4);
    sfx.boom(true);
    state.shake = Math.min(1.6, state.shake + 0.7);
    // Cartoon totaled pose: flip the shell, pop the wheels.
    car.mesh.rotation.z = Math.PI * (0.86 + Math.random() * 0.2);
    car.mesh.position.y = car.y + 1.2;
    const killer = opts.by;
    if (killer && killer.isPlayer && !car.isPlayer) {
      addSalvage(150);
      state.wrecksByPlayer += 1;
      if (state.wrecksByPlayer >= 2 && car.hp <= 0) announce("doublewreck");
    }
    if (car.isPlayer) {
      state.playerLives = Math.max(0, state.playerLives - 1);
      if (net.active) {
        const by = opts.by && opts.by.remote ? opts.by.remote : null;
        net.send("wrecked", { by });
      }
    }
    if (!state.firstBloodDone) {
      state.firstBloodDone = true;
      announce("firstblood", true);
    } else if (car.isPlayer) {
      announce("playerwreck", true);
    } else {
      announce("wreck");
    }
    checkMatchEnd();
  }

  function addSalvage(points) {
    state.salvage += Math.max(0, Math.round(points));
  }

  // ---------- explosions ----------
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xffc23b, transparent: true, opacity: 0.85 });
  if (SCRAP.ps1ify) SCRAP.ps1ify(boomMat);
  const boomGeo = new THREE.SphereGeometry(1, 9, 7);
  const boomPool = [];
  function boomVisual(x, y, z, r) {
    let b = boomPool.find((q) => !q.alive);
    if (!b) {
      b = { mesh: new THREE.Mesh(boomGeo, boomMat.clone()), alive: false };
      fxGroup.add(b.mesh);
      boomPool.push(b);
    }
    b.alive = true;
    b.t = 0;
    b.r = r;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
  }
  function updateBooms(dt) {
    boomPool.forEach((b) => {
      if (!b.alive) return;
      b.t += dt * 3.4;
      if (b.t >= 1) { b.alive = false; b.mesh.visible = false; return; }
      const s = 0.3 + b.t * b.r;
      b.mesh.scale.set(s, s, s);
      b.mesh.material.opacity = 0.85 * (1 - b.t);
    });
  }

  function boom(x, y, z, radius, dmg, by) {
    boomVisual(x, y, z, radius);
    burst(x, y, z, 0xff8a2e, 12, 9, 8);
    sfx.boom(radius > 7);
    state.cars.forEach((car) => {
      if (car.wrecked) return;
      const dx = car.x - x, dz = car.z - z, dy = car.y - y;
      const dist = Math.hypot(dx, dz);
      if (dist < radius && Math.abs(dy) < 6) {
        const fall = 1 - (dist / radius) * 0.6;
        applyDamage(car, dmg * fall, { by, type: "boom" });
        impulse(car, dx, dz, 5);
      }
    });
    if (arena) {
      arena.destructibles.forEach((d) => {
        if (!d.alive) return;
        if (Math.hypot(d.x - x, d.z - z) < radius + 1) damageDestructible(d, dmg, by);
      });
    }
  }

  // ---------- pickups (distinct 3D model per type) ----------
  const pickupMatCache = {};
  function pickupMat(color) {
    if (!pickupMatCache[color]) {
      const m = new THREE.MeshBasicMaterial({ color });
      if (SCRAP.ps1ify) SCRAP.ps1ify(m);
      pickupMatCache[color] = m;
    }
    return pickupMatCache[color];
  }
  function pgeo(group, geo, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, pickupMat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  }
  const PK_WHITE = 0xf4f8ff, PK_DARK = 0x14141c;
  // Each pickup is a bold, unlit, instantly-readable little model on a glowing
  // ring so you can tell freeze from fire from missile at a glance.
  function makePickupModel(type) {
    const g = new THREE.Group();
    const col = PICKUP_COLORS[type];
    // glowing halo ring under the model
    pgeo(g, new THREE.TorusGeometry(1.0, 0.1, 5, 14), col, 0, -0.85, 0, Math.PI / 2, 0, 0);
    const spin = new THREE.Group(); // model spins; ring stays level
    g.add(spin);
    g.userData.spin = spin;
    switch (type) {
      case "missile": { // homing rocket: body + nose + fins
        pgeo(spin, new THREE.CylinderGeometry(0.3, 0.3, 1.1, 8), col, 0, 0, 0);
        pgeo(spin, new THREE.ConeGeometry(0.3, 0.55, 8), PK_WHITE, 0, 0.8, 0);
        [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((a) =>
          pgeo(spin, new THREE.BoxGeometry(0.09, 0.42, 0.42), PK_DARK, Math.cos(a) * 0.3, -0.5, Math.sin(a) * 0.3, 0, a, 0));
        break;
      }
      case "freeze": { // ice crystal: stacked octahedra
        pgeo(spin, new THREE.OctahedronGeometry(0.62), col, 0, 0.1, 0);
        pgeo(spin, new THREE.OctahedronGeometry(0.3), PK_WHITE, 0, 0.7, 0);
        [0, 2.1, 4.2].forEach((a) =>
          pgeo(spin, new THREE.ConeGeometry(0.12, 0.6, 4), col, Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, Math.PI / 2, a, 0));
        break;
      }
      case "fire": { // flame: layered cones
        pgeo(spin, new THREE.ConeGeometry(0.6, 1.3, 7), 0xd23b1a, 0, 0.1, 0);
        pgeo(spin, new THREE.ConeGeometry(0.4, 1.0, 7), col, 0, 0.25, 0);
        pgeo(spin, new THREE.ConeGeometry(0.2, 0.6, 6), 0xffe27a, 0, 0.4, 0);
        break;
      }
      case "remote": { // detonator bomb: sphere + antenna
        pgeo(spin, new THREE.SphereGeometry(0.6, 8, 6), col, 0, 0, 0);
        pgeo(spin, new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), PK_DARK, 0, 0.7, 0);
        pgeo(spin, new THREE.SphereGeometry(0.14, 6, 5), PK_WHITE, 0, 1.05, 0);
        break;
      }
      case "mine": { // spiky sea-mine: sphere + spikes
        pgeo(spin, new THREE.SphereGeometry(0.55, 8, 6), col, 0, 0, 0);
        for (let i = 0; i < 8; i += 1) {
          const a = (i / 8) * Math.PI * 2, up = (i % 2) ? 0.4 : -0.4;
          pgeo(spin, new THREE.ConeGeometry(0.13, 0.4, 4), PK_DARK, Math.cos(a) * 0.55, up, Math.sin(a) * 0.55, Math.PI / 2, -a, 0);
        }
        break;
      }
      case "ricochet": { // faceted bouncing orb
        pgeo(spin, new THREE.IcosahedronGeometry(0.62), col, 0, 0, 0);
        pgeo(spin, new THREE.IcosahedronGeometry(0.3), PK_WHITE, 0.2, 0.3, 0.2);
        break;
      }
      case "shield": { // dome shield
        const dome = pgeo(spin, new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), col, 0, -0.2, 0);
        dome.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
        if (SCRAP.ps1ify) SCRAP.ps1ify(dome.material);
        pgeo(spin, new THREE.BoxGeometry(0.9, 0.12, 0.9), col, 0, -0.2, 0);
        pgeo(spin, new THREE.SphereGeometry(0.16, 6, 5), PK_WHITE, 0, 0.35, 0);
        break;
      }
      case "turbo": { // boost: stacked chevrons
        [-0.35, 0, 0.35].forEach((y, i) => {
          pgeo(spin, new THREE.ConeGeometry(0.5 - i * 0.08, 0.4, 4), col, 0, y + 0.1, 0, 0, Math.PI / 4, 0);
        });
        break;
      }
      case "wrench": { // wrench: plus/tool cross
        pgeo(spin, new THREE.BoxGeometry(0.28, 1.2, 0.28), col, 0, 0, 0);
        pgeo(spin, new THREE.TorusGeometry(0.32, 0.12, 5, 8), col, 0, 0.6, 0, Math.PI / 2, 0, 0);
        pgeo(spin, new THREE.BoxGeometry(0.9, 0.24, 0.24), PK_DARK, 0, -0.2, 0);
        break;
      }
      case "battery": { // battery cell
        pgeo(spin, new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), col, 0, 0, 0);
        pgeo(spin, new THREE.CylinderGeometry(0.2, 0.2, 0.2, 8), PK_WHITE, 0, 0.62, 0);
        pgeo(spin, new THREE.BoxGeometry(0.5, 0.18, 0.14), PK_DARK, 0, 0.15, 0.46);
        break;
      }
      default:
        pgeo(spin, new THREE.BoxGeometry(1, 1, 1), col, 0, 0, 0);
        break;
    }
    return g;
  }
  function rollPickupType(p) {
    const total = PICKUP_TABLE.reduce((s, [, w]) => s + w, 0);
    // Online: pickup types must match on every client, so the roll is a pure
    // function of (shared seed, pad index, respawn count) instead of Math.random.
    let roll;
    if (net.active && p) {
      p.rolls = (p.rolls || 0) + 1;
      roll = net.rand(p.idx * 2654435761 + p.rolls * 97531) * total;
    } else {
      roll = Math.random() * total;
    }
    for (const [type, w] of PICKUP_TABLE) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return PICKUP_TABLE[0][0];
  }
  function buildPickupMesh(p) {
    if (p.mesh) scene.remove(p.mesh);
    p.mesh = makePickupModel(p.type);
    p.mesh.position.set(p.x, p.gy + 1.4, p.z);
    scene.add(p.mesh);
  }
  function setupPickups() {
    state.pickups = arena.pickupSpots.map(({ x, z }, idx) => {
      const gy = sampleGround(x, z, 99);
      const p = { x, z, idx, rolls: 0, type: null, mesh: null, active: true, timer: 0, gy };
      p.type = rollPickupType(p);
      buildPickupMesh(p);
      return p;
    });
  }
  function updatePickups(dt) {
    state.pickups.forEach((p) => {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.active = true;
          p.type = rollPickupType(p);
          buildPickupMesh(p); // swap in the new type's model
        }
        return;
      }
      if (p.mesh.userData.spin) p.mesh.userData.spin.rotation.y += dt * 2.4;
      p.mesh.position.y = p.gy + 1.4 + Math.sin(state.time * 3 + p.x) * 0.25;
      state.cars.forEach((car) => {
        if (car.wrecked || !p.active) return;
        if (car.remote) return; // online: each client only grabs with its own car
        if (Math.abs(car.y - p.gy) > 3) return;
        const r = car.def.stats.radius + 1.4;
        if ((car.x - p.x) ** 2 + (car.z - p.z) ** 2 < r * r) takePickup(car, p);
      });
    });
  }
  function takePickup(car, p, fromNet) {
    p.active = false;
    p.timer = PICKUP_RESPAWN;
    p.mesh.visible = false;
    if (net.active && !fromNet && car === state.player) net.send("ptake", { i: p.idx, ty: p.type });
    if (car.isPlayer) sfx.pickup();
    switch (p.type) {
      case "shield":
        car.shield = 5;
        if (car.isPlayer) announce("shield");
        break;
      case "turbo":
        car.boost = 3.5;
        if (car.isPlayer) announce("turbo");
        break;
      case "wrench":
        car.hp = Math.min(car.maxHp, car.hp + 30);
        if (car.isPlayer) api.toast("🔧 Patched +30 HP");
        break;
      case "battery":
        car.special = Math.min(100, car.special + 35);
        if (car.isPlayer) api.toast("🔋 Special charged");
        break;
      default:
        car.weapon = p.type;
        car.ammo = WEAPONS[p.type].ammo;
        car.remoteBomb = null;
        if (car.isPlayer) api.toast(`${WEAPONS[p.type].icon} ${WEAPONS[p.type].name} x${WEAPONS[p.type].ammo}`);
        break;
    }
  }

  // ---------- projectiles / mines / fire ----------
  const projGeo = new THREE.BoxGeometry(0.35, 0.35, 1.1);
  const missileGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6);
  const junkGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  function spawnProjectile(opts) {
    const kind = opts.kind;
    let geo = projGeo;
    if (kind === "missile" || kind === "freeze" || kind === "surge") geo = missileGeo;
    if (kind === "junk") geo = junkGeo;
    const material = new THREE.MeshBasicMaterial({ color: opts.color });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    const mesh = new THREE.Mesh(geo, material);
    if (geo === missileGeo) mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    state.projectiles.push({
      kind, mesh,
      x: opts.x, y: opts.y, z: opts.z,
      vx: opts.vx, vy: opts.vy || 0, vz: opts.vz,
      ttl: opts.ttl || 3,
      dmg: opts.dmg, radius: opts.radius || 0,
      owner: opts.owner, target: opts.target || null,
      bounces: opts.bounces || 0,
      gravity: !!opts.gravity,
      turn: opts.turn || 0,
    });
  }

  function nearestEnemy(car, maxDist, coneDot = -1) {
    let best = null, bestD = maxDist;
    const f = forward(car);
    state.cars.forEach((other) => {
      if (other === car || other.wrecked) return;
      const dx = other.x - car.x, dz = other.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD) return;
      if (coneDot > -1) {
        const dot = (dx / (d || 1)) * f.x + (dz / (d || 1)) * f.z;
        if (dot < coneDot) return;
      }
      best = other;
      bestD = d;
    });
    return best;
  }

  function fireMachineGun(car) {
    const w = WEAPONS[BASE_WEAPON];
    if (car.gunCooldown > 0 || car.frozen > 0 || car.stunned > 0) return;
    car.gunCooldown = w.rate;
    const f = forward(car);
    const px = car.x + f.x * (car.def.stats.radius + 1);
    const pz = car.z + f.z * (car.def.stats.radius + 1);
    const py = car.y + 1.3;
    if (car.isPlayer) sfx.shot();
    const spread = (Math.random() - 0.5) * 0.06;
    const sx = Math.sin(car.heading + spread), sz = Math.cos(car.heading + spread);
    spawnProjectile({ kind: "tracer", color: 0xffe08a, x: px, y: py, z: pz, vx: sx * 90 + car.vx, vz: sz * 90 + car.vz, ttl: 0.8, dmg: 4, owner: car });
  }

  function fireWeapon(car) {
    if (!car.weapon || car.ammo <= 0 || car.fireCooldown > 0 || car.frozen > 0 || car.stunned > 0) return;
    const w = WEAPONS[car.weapon];
    if (!w || (car.isPlayer && w.base)) return;
    car.fireCooldown = w.rate;
    if (net.active && car === state.player) net.send("act", { k: "weapon", w: car.weapon });
    const f = forward(car);
    const px = car.x + f.x * (car.def.stats.radius + 1);
    const pz = car.z + f.z * (car.def.stats.radius + 1);
    const py = car.y + 1.3;
    if (car.isPlayer) sfx.shot();
    switch (w.kind) {
      case "gun": {
        const spread = (Math.random() - 0.5) * 0.06;
        const sx = Math.sin(car.heading + spread), sz = Math.cos(car.heading + spread);
        spawnProjectile({ kind: "tracer", color: 0xffe08a, x: px, y: py, z: pz, vx: sx * 90 + car.vx, vz: sz * 90 + car.vz, ttl: 0.8, dmg: 4, owner: car });
        car.ammo -= 1;
        break;
      }
      case "missile":
      case "freeze": {
        const target = nearestEnemy(car, 70, 0.2);
        spawnProjectile({
          kind: w.kind, color: w.kind === "freeze" ? 0x63d8ff : 0xff5e3b,
          x: px, y: py, z: pz, vx: f.x * 44, vz: f.z * 44,
          ttl: 3.4, dmg: w.kind === "freeze" ? 8 : 22, radius: 6,
          owner: car, target, turn: 2.6,
        });
        car.ammo -= 1;
        break;
      }
      case "fire":
        car.fireTrail = 4;
        car.ammo -= 1;
        break;
      case "remote":
        if (car.remoteBomb) {
          boom(car.remoteBomb.x, car.remoteBomb.y, car.remoteBomb.z, 9, 35, car);
          scene.remove(car.remoteBomb.mesh);
          car.remoteBomb = null;
          car.ammo -= 1;
        } else {
          const material = new THREE.MeshBasicMaterial({ color: 0xd23f6e });
          if (SCRAP.ps1ify) SCRAP.ps1ify(material);
          const mesh = new THREE.Mesh(junkGeo, material);
          mesh.position.set(car.x, car.y + 0.5, car.z);
          scene.add(mesh);
          car.remoteBomb = { x: car.x, y: car.y + 0.5, z: car.z, mesh };
        }
        break;
      case "mine":
        dropMine(car, car.x - f.x * (car.def.stats.radius + 1.6), car.z - f.z * (car.def.stats.radius + 1.6), 25, 0xb0b6bd);
        car.ammo -= 1;
        break;
      case "ricochet":
        spawnProjectile({
          kind: "ricochet", color: 0x9e63ff,
          x: px, y: py, z: pz, vx: f.x * 55, vz: f.z * 55,
          ttl: 4, dmg: 26, radius: 6, owner: car, bounces: 5,
        });
        car.ammo -= 1;
        break;
      default:
        break;
    }
    if (car.ammo <= 0 && !w.base) {
      if (w.kind === "fire") {
        // kept until the trail burns out (cleared in updateSpecialStates)
      } else if (w.kind === "remote") {
        if (!car.remoteBomb) revertToBase(car);
      } else {
        revertToBase(car);
      }
    }
  }

  // Spent upgrade -> fall back to the infinite baseline machine gun.
  function revertToBase(car) {
    car.weapon = BASE_WEAPON;
    car.ammo = Infinity;
  }

  function dropMine(car, x, z, dmg, color, opts = {}) {
    const material = new THREE.MeshBasicMaterial({ color });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    const mesh = new THREE.Mesh(opts.casket ? new THREE.BoxGeometry(1.2, 0.6, 2) : new THREE.CylinderGeometry(0.7, 0.9, 0.5, 7), material);
    const gy = sampleGround(x, z, car.y + 1);
    mesh.position.set(x, gy + 0.3, z);
    scene.add(mesh);
    state.mines.push({ x, z, y: gy, dmg, owner: car, mesh, armTime: 0.7, slow: !!opts.slow });
  }

  function updateMines(dt) {
    for (let i = state.mines.length - 1; i >= 0; i -= 1) {
      const m = state.mines[i];
      if (m.armTime > 0) { m.armTime -= dt; continue; }
      let hit = false;
      state.cars.forEach((car) => {
        if (hit || car.wrecked || car === m.owner) return;
        if (car.remote) return; // online: mines only trigger on the local car; owner reports it
        if (Math.abs(car.y - m.y) > 2.5) return;
        const r = car.def.stats.radius + 1.2;
        if ((car.x - m.x) ** 2 + (car.z - m.z) ** 2 < r * r) {
          hit = true;
          if (m.slow) {
            applyDamage(car, m.dmg, { by: m.owner, type: "spike" });
            car.slowed = Math.max(car.slowed, 1.6);
            burst(m.x, m.y + 0.5, m.z, 0xb0b6bd, 6, 5);
            sfx.hit();
          } else {
            boom(m.x, m.y + 0.5, m.z, 6, m.dmg, m.owner);
          }
        }
      });
      if (hit) {
        if (net.active) net.send("mineboom", { x: m.x, z: m.z });
        scene.remove(m.mesh);
        state.mines.splice(i, 1);
      }
    }
  }

  function updateFirePatches(dt) {
    for (let i = state.firePatches.length - 1; i >= 0; i -= 1) {
      const f = state.firePatches[i];
      f.ttl -= dt;
      f.mesh.material.opacity = Math.min(0.8, f.ttl);
      f.mesh.scale.setScalar(1 + Math.sin(state.time * 9 + i) * 0.15);
      if (f.ttl <= 0) {
        scene.remove(f.mesh);
        state.firePatches.splice(i, 1);
        continue;
      }
      state.cars.forEach((car) => {
        if (car.wrecked || car === f.owner || Math.abs(car.y - f.y) > 2) return;
        const r = car.def.stats.radius + 1.6;
        if ((car.x - f.x) ** 2 + (car.z - f.z) ** 2 < r * r && car.burning <= 0) {
          car.burning = 2;
          car.burnBy = f.owner;
          applyDamage(car, 4, { by: f.owner, type: "fire" });
        }
      });
    }
  }

  const fireGeo = new THREE.ConeGeometry(1.4, 2, 6);
  function dropFirePatch(car) {
    const material = new THREE.MeshBasicMaterial({ color: 0xff8a2e, transparent: true, opacity: 0.8 });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    const mesh = new THREE.Mesh(fireGeo, material);
    mesh.position.set(car.x, car.y + 0.9, car.z);
    scene.add(mesh);
    state.firePatches.push({ x: car.x, y: car.y, z: car.z, ttl: 3, owner: car, mesh });
  }

  function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const p = state.projectiles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { scene.remove(p.mesh); state.projectiles.splice(i, 1); continue; }
      // homing
      if (p.target && !p.target.wrecked && p.turn) {
        const desired = Math.atan2(p.target.x - p.x, p.target.z - p.z);
        const current = Math.atan2(p.vx, p.vz);
        let diff = desired - current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const speed = Math.hypot(p.vx, p.vz);
        const na = current + Math.max(-p.turn * dt, Math.min(p.turn * dt, diff));
        p.vx = Math.sin(na) * speed;
        p.vz = Math.cos(na) * speed;
      }
      if (p.gravity) p.vy -= GRAV * 0.8 * dt;
      p.x += p.vx * dt;
      p.y += (p.vy || 0) * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + (p.vy || 0), p.z + p.vz);
      let dead = false;
      // ground / bounds
      const gy = sampleGround(p.x, p.z, p.y + 2);
      if (p.y < gy + 0.2) {
        if (p.kind === "junk") { boom(p.x, gy + 0.5, p.z, 4.5, p.dmg, p.owner); dead = true; }
        else if (p.kind === "ricochet" && p.bounces > 0) { p.vy = Math.abs(p.vy || 4) * 0.6; p.y = gy + 0.25; p.bounces -= 1; }
        else if (p.radius) { boom(p.x, gy + 0.5, p.z, p.radius, p.dmg, p.owner); dead = true; }
        else dead = true;
      }
      if (!dead && arena && (Math.abs(p.x) > arena.bounds.hw || Math.abs(p.z) > arena.bounds.hd)) {
        if (p.kind === "ricochet" && p.bounces > 0) {
          if (Math.abs(p.x) > arena.bounds.hw) p.vx *= -1;
          else p.vz *= -1;
          p.bounces -= 1;
          sfx.hit();
        } else dead = true;
      }
      // static colliders
      if (!dead && arena) {
        for (let c = 0; c < arena.colliders.length; c += 1) {
          const col = arena.colliders[c];
          if (p.y < col.base || p.y > col.top) continue;
          if (Math.abs(p.x - col.x) < col.hw && Math.abs(p.z - col.z) < col.hd) {
            if (p.kind === "ricochet" && p.bounces > 0) {
              const penX = col.hw - Math.abs(p.x - col.x);
              const penZ = col.hd - Math.abs(p.z - col.z);
              if (penX < penZ) p.vx *= -1; else p.vz *= -1;
              p.bounces -= 1;
              sfx.hit();
            } else if (p.radius) {
              boom(p.x, p.y, p.z, p.radius, p.dmg, p.owner);
              dead = true;
            } else dead = true;
            break;
          }
        }
      }
      // cars
      if (!dead) {
        for (let c = 0; c < state.cars.length; c += 1) {
          const car = state.cars[c];
          if (car === p.owner || car.wrecked) continue;
          const r = car.def.stats.radius + 0.6;
          if (Math.abs(car.y + 1.2 - p.y) > 3) continue;
          if ((car.x - p.x) ** 2 + (car.z - p.z) ** 2 < r * r) {
            if (p.kind === "freeze") {
              applyDamage(car, p.dmg, { by: p.owner, type: "freeze" });
              car.frozen = Math.max(car.frozen, 2.6);
              sfx.freeze();
              burst(car.x, car.y + 2, car.z, 0x9fe8ff, 12, 6);
            } else if (p.radius) {
              boom(p.x, p.y, p.z, p.radius, p.dmg, p.owner);
            } else {
              applyDamage(car, p.dmg, { by: p.owner, type: "shot" });
              burst(p.x, p.y, p.z, 0xffe08a, 3, 4);
            }
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        scene.remove(p.mesh);
        state.projectiles.splice(i, 1);
      }
    }
  }

  // ---------- specials ----------
  function fireSpecial(car) {
    if (car.special < 100 || car.wrecked || car.frozen > 0 || car.stunned > 0) return;
    car.special = 0;
    if (net.active && car === state.player) net.send("act", { k: "special" });
    if (car.isPlayer) {
      sfx.special();
      flash("rgba(255,220,120,0.35)", 130);
    }
    announce("special");
    const id = car.def.special.id;
    const f = forward(car);
    switch (id) {
      case "freeze_nova": {
        boomVisual(car.x, car.y + 1.5, car.z, 16);
        burst(car.x, car.y + 1.5, car.z, 0x9fe8ff, 26, 14, 4);
        sfx.freeze();
        state.cars.forEach((other) => {
          if (other === car || other.wrecked) return;
          if (Math.hypot(other.x - car.x, other.z - car.z) < 18) {
            applyDamage(other, 10, { by: car, type: "special" });
            other.frozen = Math.max(other.frozen, 3);
          }
        });
        break;
      }
      case "drain_beam": {
        const target = nearestEnemy(car, 32);
        if (target) car.drain = { target, t: 3 };
        break;
      }
      case "spike_burst": {
        for (let i = -3; i <= 3; i += 1) {
          const a = car.heading + Math.PI + i * 0.22;
          dropMine(car, car.x + Math.sin(a) * 4.5, car.z + Math.cos(a) * 4.5, 12, 0xb0b6bd, { slow: true });
        }
        break;
      }
      case "ground_slam":
        car.vy = 9;
        car.slamming = true;
        break;
      case "casket_bombs":
        car.casketDrop = { t: 2.5, tick: 0 };
        break;
      case "tractor_shock": {
        const target = nearestEnemy(car, 28);
        if (target) car.tractor = { target, t: 1.0 };
        break;
      }
      case "surge_volley":
        car.volley = { t: 1.4, tick: 0, count: 0 };
        break;
      case "mower_smoke":
        car.mower = 2.6;
        car.smokeTick = 0;
        break;
      case "chain_hook": {
        const target = nearestEnemy(car, 32, 0.1);
        if (target) {
          car.hook = { target, t: 0.8 };
          applyDamage(target, 15, { by: car, type: "special" });
        }
        break;
      }
      case "junk_barrage": {
        car.barrage = { t: 1.6, tick: 0 };
        // compactor crush burst up front
        state.cars.forEach((other) => {
          if (other === car || other.wrecked) return;
          const dx = other.x - car.x, dz = other.z - car.z;
          const d = Math.hypot(dx, dz);
          const dot = (dx / (d || 1)) * f.x + (dz / (d || 1)) * f.z;
          if (d < 8 && dot > 0.4) {
            applyDamage(other, 20, { by: car, type: "special" });
            impulse(other, dx, dz, 6);
          }
        });
        break;
      }
      default:
        break;
    }
  }

  const beamGeo = new THREE.BoxGeometry(0.4, 0.4, 1);
  let beamMesh = null, hookMesh = null;
  function ensureBeam() {
    if (!beamMesh) {
      const material = new THREE.MeshBasicMaterial({ color: 0xc95eff });
      if (SCRAP.ps1ify) SCRAP.ps1ify(material);
      beamMesh = new THREE.Mesh(beamGeo, material);
      scene.add(beamMesh);
    }
    return beamMesh;
  }
  function ensureHook() {
    if (!hookMesh) {
      const material = new THREE.MeshBasicMaterial({ color: 0xc9cdd4 });
      if (SCRAP.ps1ify) SCRAP.ps1ify(material);
      hookMesh = new THREE.Mesh(beamGeo, material);
      scene.add(hookMesh);
    }
    return hookMesh;
  }
  function stretchBeam(mesh, ax, ay, az, bx, by, bz, thick) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    mesh.scale.set(thick, thick, len);
    mesh.lookAt(bx, by, bz);
    mesh.visible = true;
  }

  function updateSpecialStates(car, dt) {
    // drain beam
    if (car.drain) {
      const d = car.drain;
      d.t -= dt;
      const target = d.target;
      if (d.t <= 0 || target.wrecked || Math.hypot(target.x - car.x, target.z - car.z) > 38) {
        car.drain = null;
        if (beamMesh) beamMesh.visible = false;
      } else {
        const steal = 13 * dt;
        applyDamage(target, steal, { by: car, type: "drain", pierce: false });
        car.hp = Math.min(car.maxHp, car.hp + steal * 0.8);
        stretchBeam(ensureBeam(), car.x, car.y + 2, car.z, target.x, target.y + 1.5, target.z, 1);
      }
    }
    // ground slam
    if (car.slamming && car.y <= sampleGround(car.x, car.z, car.y) + 0.1 && car.vy <= 0) {
      car.slamming = false;
      boom(car.x, car.y + 0.5, car.z, 15, 25, car);
      state.shake = Math.min(1.6, state.shake + 0.8);
    }
    // caskets
    if (car.casketDrop) {
      car.casketDrop.t -= dt;
      car.casketDrop.tick -= dt;
      if (car.casketDrop.tick <= 0) {
        car.casketDrop.tick = 0.5;
        const f = forward(car);
        dropMine(car, car.x - f.x * (car.def.stats.radius + 2), car.z - f.z * (car.def.stats.radius + 2), 20, 0x7a4a2b, { casket: true });
      }
      if (car.casketDrop.t <= 0) car.casketDrop = null;
    }
    // tractor beam
    if (car.tractor) {
      const t = car.tractor;
      t.t -= dt;
      const target = t.target;
      if (t.t <= 0 || target.wrecked) {
        if (!target.wrecked) {
          applyDamage(target, 25, { by: car, type: "shock" });
          target.stunned = Math.max(target.stunned, 1.2);
          burst(target.x, target.y + 1.8, target.z, 0xffe63b, 14, 7);
        }
        car.tractor = null;
        if (beamMesh) beamMesh.visible = false;
      } else {
        const pull = 34 * dt;
        const dx = car.x - target.x, dz = car.z - target.z;
        const len = Math.hypot(dx, dz) || 1;
        target.x += (dx / len) * pull;
        target.z += (dz / len) * pull;
        stretchBeam(ensureBeam(), car.x, car.y + 2.2, car.z, target.x, target.y + 1.5, target.z, 1.4);
      }
    }
    // surge volley
    if (car.volley) {
      car.volley.t -= dt;
      car.volley.tick -= dt;
      if (car.volley.tick <= 0 && car.volley.count < 6) {
        car.volley.tick = 0.22;
        car.volley.count += 1;
        car.hp = Math.max(1, car.hp - 2); // he pays for his own stars
        const target = nearestEnemy(car, 80);
        const a = car.heading + (Math.random() - 0.5) * 0.8;
        spawnProjectile({
          kind: "surge", color: 0xffd23b,
          x: car.x, y: car.y + 2, z: car.z,
          vx: Math.sin(a) * 40, vz: Math.cos(a) * 40, vy: 6,
          ttl: 3, dmg: 14, radius: 5, owner: car, target, turn: 3.2, gravity: false,
        });
      }
      if (car.volley.t <= 0) car.volley = null;
    }
    // mower + smoke
    if (car.mower > 0) {
      car.mower -= dt;
      car.smokeTick -= dt;
      if (car.smokeTick <= 0) {
        car.smokeTick = 0.3;
        const f = forward(car);
        spawnSmoke(car.x - f.x * 4, car.y + 1.5, car.z - f.z * 4);
      }
      state.cars.forEach((other) => {
        if (other === car || other.wrecked) return;
        const d = Math.hypot(other.x - car.x, other.z - car.z);
        if (d < car.def.stats.radius + 3 && (other.mowerHit || 0) <= state.time) {
          other.mowerHit = state.time + 0.5;
          applyDamage(other, 16, { by: car, type: "mower" });
          impulse(other, other.x - car.x, other.z - car.z, 4);
          burst(other.x, other.y + 1, other.z, 0x9be063, 8, 6);
        }
      });
    }
    // chain hook
    if (car.hook) {
      const h = car.hook;
      h.t -= dt;
      const target = h.target;
      if (h.t <= 0 || target.wrecked) {
        car.hook = null;
        if (hookMesh) hookMesh.visible = false;
      } else {
        const pull = 46 * dt;
        const dx = car.x - target.x, dz = car.z - target.z;
        const len = Math.hypot(dx, dz) || 1;
        target.x += (dx / len) * pull;
        target.z += (dz / len) * pull;
        target.vx += (dx / len) * 6 * dt;
        target.vz += (dz / len) * 6 * dt;
        stretchBeam(ensureHook(), car.x, car.y + 2, car.z, target.x, target.y + 1.4, target.z, 0.7);
      }
    }
    // junk barrage
    if (car.barrage) {
      car.barrage.t -= dt;
      car.barrage.tick -= dt;
      if (car.barrage.tick <= 0) {
        car.barrage.tick = 0.2;
        const target = nearestEnemy(car, 60);
        if (target) {
          const dx = target.x - car.x, dz = target.z - car.z;
          const d = Math.hypot(dx, dz) || 1;
          spawnProjectile({
            kind: "junk", color: 0x9a8a5a,
            x: car.x, y: car.y + 3, z: car.z,
            vx: (dx / d) * 26 + (Math.random() - 0.5) * 8,
            vz: (dz / d) * 26 + (Math.random() - 0.5) * 8,
            vy: 10 + Math.random() * 4,
            ttl: 4, dmg: 10, owner: car, gravity: true,
          });
        }
      }
      if (car.barrage.t <= 0) car.barrage = null;
    }
    // fire trail weapon
    if (car.fireTrail > 0) {
      car.fireTrail -= dt;
      car.fireTick = (car.fireTick || 0) - dt;
      if (car.fireTick <= 0) {
        car.fireTick = 0.16;
        dropFirePatch(car);
      }
      if (car.fireTrail <= 0 && car.weapon === "fire") revertToBase(car);
    }
  }

  const smokeGeo = new THREE.SphereGeometry(2.4, 7, 6);
  function spawnSmoke(x, y, z) {
    const material = new THREE.MeshBasicMaterial({ color: 0x555b60, transparent: true, opacity: 0.55 });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    const mesh = new THREE.Mesh(smokeGeo, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    state.smokes.push({ x, z, mesh, ttl: 5 });
  }
  function updateSmokes(dt) {
    for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
      const s = state.smokes[i];
      s.ttl -= dt;
      s.mesh.material.opacity = Math.min(0.55, s.ttl * 0.2);
      s.mesh.scale.setScalar(1 + (5 - s.ttl) * 0.12);
      if (s.ttl <= 0) {
        scene.remove(s.mesh);
        state.smokes.splice(i, 1);
      }
    }
  }
  function inSmoke(car) {
    return state.smokes.some((s) => (car.x - s.x) ** 2 + (car.z - s.z) ** 2 < 26);
  }

  // ---------- driving ----------
  function updateCar(car, dt) {
    if (car.wrecked) {
      car.wreckT += dt;
      // wrecks can still be shoved around; keep the shell where the hulk is
      car.mesh.position.set(car.x, car.y + 1.2, car.z);
      if (Math.random() < dt * 3) burst(car.x, car.y + 1.6, car.z, 0x3a3a44, 2, 2, 5);
      return;
    }
    // status timers
    if (car.frozen > 0) car.frozen -= dt;
    if (car.stunned > 0) car.stunned -= dt;
    if (car.slowed > 0) car.slowed -= dt;
    if (car.shield > 0) car.shield -= dt;
    if (car.boost > 0) car.boost -= dt;
    if (car.burning > 0) {
      car.burning -= dt;
      car.burnTick -= dt;
      if (car.burnTick <= 0) {
        car.burnTick = 0.5;
        applyDamage(car, 2.5, { by: car.burnBy, type: "burn" });
        burst(car.x, car.y + 1.6, car.z, 0xff8a2e, 3, 3, 5);
      }
    }
    car.fx.ice.visible = car.frozen > 0;
    car.fx.shield.visible = car.shield > 0;
    if (car.gunCooldown > 0) car.gunCooldown -= dt;
    if (car.fireCooldown > 0) car.fireCooldown -= dt;
    car.special = Math.min(100, car.special + (car.specialRate || SPECIAL_RATE) * dt);

    const disabled = car.frozen > 0 || car.stunned > 0;
    const stats = car.def.stats;
    const f = forward(car);
    const speedAlong = car.vx * f.x + car.vz * f.z;

    // steering (speed-sensitive, reversed in reverse)
    if (!disabled && Math.abs(speedAlong) > 0.6) {
      const grip = Math.min(1, Math.abs(speedAlong) / 9);
      const dir = speedAlong >= 0 ? 1 : -1;
      car.heading += car.steer * stats.turn * grip * dt * dir;
    }
    // throttle
    const topSpeed = stats.top * (car.boost > 0 ? 1.45 : 1) * (car.slowed > 0 ? 0.55 : 1);
    const accel = stats.accel * (car.boost > 0 ? 1.6 : 1);
    if (!disabled && car.throttle) {
      const targetDir = car.throttle > 0 ? 1 : -1;
      const cap = targetDir > 0 ? topSpeed : topSpeed * 0.45;
      if (Math.abs(speedAlong) < cap || Math.sign(speedAlong) !== targetDir) {
        car.vx += f.x * accel * car.throttle * dt;
        car.vz += f.z * accel * car.throttle * dt;
      }
    }
    // slow zone drag
    let zoneFactor = 1;
    if (arena) {
      for (const zn of arena.slowZones) {
        if (Math.abs(car.x - zn.x) < zn.hw && Math.abs(car.z - zn.z) < zn.hd && car.y < 1.5) {
          zoneFactor = zn.factor;
          break;
        }
      }
    }
    // friction: split velocity into forward/lateral
    const f2 = forward(car);
    const fwdV = car.vx * f2.x + car.vz * f2.z;
    let latX = car.vx - f2.x * fwdV;
    let latZ = car.vz - f2.z * fwdV;
    const latDamp = Math.exp(-dt * (car.drift ? 1.8 : 6.5));
    const fwdDamp = Math.exp(-dt * (car.throttle && !disabled ? 0.35 : 1.6));
    latX *= latDamp;
    latZ *= latDamp;
    const newFwd = fwdV * fwdDamp * (zoneFactor < 1 ? Math.exp(-dt * (1 - zoneFactor) * 4) : 1);
    car.vx = f2.x * newFwd + latX;
    car.vz = f2.z * newFwd + latZ;

    // integrate
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    // bounds clamp
    if (arena) {
      car.x = Math.max(-arena.bounds.hw + 1, Math.min(arena.bounds.hw - 1, car.x));
      car.z = Math.max(-arena.bounds.hd + 1, Math.min(arena.bounds.hd - 1, car.z));
    }
    // vertical
    const gy = sampleGround(car.x, car.z, car.y);
    if (car.y > gy + CAR_HEIGHT_EPS) {
      car.vy -= GRAV * dt;
      car.y += car.vy * dt;
      if (car.y <= gy) {
        if (car.vy < -16) {
          applyDamage(car, Math.min(30, (-car.vy - 16) * 2.2), { type: "impact" });
          burst(car.x, gy + 0.4, car.z, 0x8a8d92, 8, 6);
          if (car.isPlayer) state.shake = Math.min(1.4, state.shake + 0.5);
        }
        car.y = gy;
        car.vy = 0;
      }
    } else {
      // Track the ground tightly when climbing/descending ramps. A slow lerp
      // left the car sunk below the ramp surface, so it never reached deck
      // height (and got walled by colliders whose top == deck height).
      car.y = gy;
      car.vy = 0;
    }
    // fall zones (abyss) — exempt only if the surface the car is actually
    // on (its own step range) is real; a platform overhead doesn't count
    if (arena && car.y < 2.2) {
      for (const fz of arena.fallZones) {
        if (Math.abs(car.x - fz.x) < fz.hw && Math.abs(car.z - fz.z) < fz.hd && sampleGround(car.x, car.z, car.y) < 0.5) {
          applyDamage(car, FALL_DAMAGE, { type: "fall" });
          if (car.isPlayer) announce("fall");
          respawnCar(car);
          break;
        }
      }
    }

    collideStatics(car);

    // weapons + specials
    if (!disabled && car.wantFire) {
      if (car.isPlayer) fireMachineGun(car);
      else fireWeapon(car);
    }
    if (car.isPlayer && car.wantPickupFire) {
      if (!disabled) fireWeapon(car);
      car.wantPickupFire = false;
    }
    if (!disabled && car.wantSpecial) { fireSpecial(car); car.wantSpecial = false; }
    updateSpecialStates(car, dt);

    // mesh sync
    car.mesh.position.set(car.x, car.y, car.z);
    car.mesh.rotation.set(0, car.heading, 0);
    const speed = Math.hypot(car.vx, car.vz);
    car.wheelSpin += (speedAlong >= 0 ? 1 : -1) * speed * dt * 1.6;
    car.mesh.userData.wheels.forEach((w) => { w.rotation.x = car.wheelSpin; });
    if (car.mesh.userData.spinner) car.mesh.userData.spinner.rotation.y += dt * 6;
    if (car.mesh.userData.boom) car.mesh.userData.boom.rotation.x = 0.35 + Math.sin(state.time * 2) * 0.1;
    // boost flames
    if (car.boost > 0 && Math.random() < dt * 30) {
      const b = forward(car);
      burst(car.x - b.x * stats.radius, car.y + 0.7, car.z - b.z * stats.radius, 0x2ee0ff, 2, 3, 2);
    }
  }

  function safestSpawnFor(car) {
    if (!arena) return null;
    let best = arena.spawns[0], bestD = -1;
    arena.spawns.forEach((s) => {
      let minD = 1e9;
      state.cars.forEach((other) => {
        if (other === car || other.wrecked) return;
        minD = Math.min(minD, Math.hypot(other.x - s.x, other.z - s.z));
      });
      if (minD > bestD) { bestD = minD; best = s; }
    });
    return best;
  }

  function respawnCar(car) {
    if (!arena || car.wrecked) return;
    const best = safestSpawnFor(car);
    if (!best) return;
    car.x = best.x;
    car.z = best.z;
    car.heading = best.h;
    car.vx = 0; car.vz = 0; car.vy = 0;
    car.y = sampleGround(best.x, best.z, 99);
    burst(car.x, car.y + 1, car.z, 0x63f2c8, 12, 8);
  }

  function respawnPlayerLife() {
    const car = state.player;
    const best = safestSpawnFor(car);
    if (!car || !best) return;
    car.wrecked = false;
    car.wreckT = 0;
    car.hp = car.maxHp;
    car.x = best.x;
    car.z = best.z;
    car.heading = best.h;
    car.vx = 0; car.vz = 0; car.vy = 0;
    car.y = sampleGround(best.x, best.z, 99);
    car.frozen = 0; car.stunned = 0; car.burning = 0; car.burnTick = 0; car.slowed = 0;
    car.shield = Math.max(car.shield, LIFE_RESPAWN_SHIELD);
    car.boost = 0;
    car.throttle = 0; car.steer = 0; car.drift = false; car.wantFire = false; car.wantPickupFire = false; car.wantSpecial = false;
    car.fx.ice.visible = false;
    car.fx.shield.visible = true;
    car.mesh.rotation.set(0, car.heading, 0);
    car.mesh.position.set(car.x, car.y, car.z);
    burst(car.x, car.y + 1, car.z, 0x63f2c8, 18, 10);
    flash("rgba(99,242,200,0.32)", 260);
    api.toast(`LIFE USED — ${state.playerLives} LEFT`);
    updateCamera(0, true);
    updateHUD();
  }

  function collideCars(dt) {
    for (let i = 0; i < state.cars.length; i += 1) {
      for (let j = i + 1; j < state.cars.length; j += 1) {
        const a = state.cars[i], b = state.cars[j];
        if (a.wrecked && b.wrecked) continue;
        if (Math.abs(a.y - b.y) > 2.4) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.def.stats.radius + b.def.stats.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const overlap = rr - d;
        const ma = a.def.stats.mass, mb = b.def.stats.mass;
        const total = ma + mb;
        a.x -= nx * overlap * (mb / total);
        a.z -= nz * overlap * (mb / total);
        b.x += nx * overlap * (ma / total);
        b.z += nz * overlap * (ma / total);
        // relative speed along normal -> ram damage
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel > 6) {
          const key = i * 100 + j;
          const last = a.ramTimers.get(key) || -9;
          if (state.time - last > RAM_COOLDOWN) {
            a.ramTimers.set(key, state.time);
            const dmg = (rel - 5) * RAM_DAMAGE_SCALE;
            // mass ratio rewards the heavier rammer, capped so a garbage
            // truck can't one-shot the bike
            if (!b.wrecked) applyDamage(b, Math.min(RAM_TARGET_DAMAGE_MAX, dmg * (ma / mb)), { by: a, type: "ram" });
            if (!a.wrecked) applyDamage(a, Math.min(RAM_SELF_DAMAGE_MAX, dmg * RAM_SELF_DAMAGE_SCALE * (mb / ma)), { by: b, type: "ram" });
            burst((a.x + b.x) / 2, a.y + 1.2, (a.z + b.z) / 2, 0xffd23b, 7, 6);
            sfx.hit();
          }
        }
        // momentum exchange
        const impulseAmt = rel * 0.8;
        if (rel > 0) {
          a.vx -= nx * impulseAmt * (mb / total);
          a.vz -= nz * impulseAmt * (mb / total);
          b.vx += nx * impulseAmt * (ma / total);
          b.vz += nz * impulseAmt * (ma / total);
        }
      }
    }
  }

  // ---------- AI ----------
  const ARCHETYPES = ["rammer", "camper", "hoarder", "coward"];
  function updateAI(car, dt) {
    const ai = car.ai;
    if (!ai || car.wrecked) return;
    ai.retarget -= dt;
    if (ai.retarget <= 0 || !ai.target || ai.target.wrecked) {
      ai.retarget = 1.2 + Math.random();
      ai.target = nearestEnemy(car, 1e9);
    }
    const target = ai.target;
    if (!target) { car.throttle = 0; return; }
    if (inSmoke(car)) {
      // blinded: wander
      car.throttle = 0.5;
      car.steer = Math.sin(state.time * 2 + ai.wander);
      return;
    }
    let destX = target.x, destZ = target.z;
    const distToTarget = Math.hypot(target.x - car.x, target.z - car.z);
    const lowHp = car.hp < car.maxHp * 0.4;
    let wantRange = 0;
    if (ai.archetype === "camper") wantRange = 24;
    if (ai.archetype === "coward") wantRange = lowHp ? 48 : 26;
    if (ai.archetype === "hoarder" && (!car.weapon || car.ammo <= 0)) {
      let bestP = null, bestD = 1e9;
      state.pickups.forEach((p) => {
        if (!p.active) return;
        const d = Math.hypot(p.x - car.x, p.z - car.z);
        if (d < bestD) { bestD = d; bestP = p; }
      });
      if (bestP) { destX = bestP.x; destZ = bestP.z; wantRange = 0; }
    } else if (wantRange > 0 && distToTarget < wantRange) {
      // back off / strafe around target
      const away = Math.atan2(car.x - target.x, car.z - target.z) + 0.7;
      destX = target.x + Math.sin(away) * (wantRange + 6);
      destZ = target.z + Math.cos(away) * (wantRange + 6);
    }
    // steer toward dest
    const desired = Math.atan2(destX - car.x, destZ - car.z);
    let diff = desired - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.steer = Math.max(-1, Math.min(1, diff * 2.2));
    car.throttle = Math.abs(diff) > 2.2 ? 0.25 : 1;
    car.drift = Math.abs(diff) > 1.4;

    // edge probe when elevated: don't drive into the void
    if (car.y > 3) {
      const f = forward(car);
      const px = car.x + f.x * 7, pz = car.z + f.z * 7;
      const pg = sampleGround(px, pz, car.y);
      if (pg < car.y - 3.5) {
        car.throttle = -0.6;
        car.steer = 1;
      }
    }
    // stuck recovery
    const speed = Math.hypot(car.vx, car.vz);
    if (speed < 1.6 && car.throttle > 0.4) ai.stuck += dt;
    else ai.stuck = Math.max(0, ai.stuck - dt * 2);
    if (ai.stuck > 1.1) { ai.reverseT = 0.9; ai.stuck = 0; }
    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      car.throttle = -1;
      car.steer = -Math.sign(car.steer || 1);
    }
    // firing
    car.wantFire = false;
    if (car.weapon && car.ammo > 0) {
      const w = WEAPONS[car.weapon];
      if (w.kind === "mine" || w.kind === "remote" || w.kind === "fire") {
        if (distToTarget < 16 && Math.random() < dt * 2) car.wantFire = true;
        if (w.kind === "remote" && car.remoteBomb) {
          const bd = Math.hypot(target.x - car.remoteBomb.x, target.z - car.remoteBomb.z);
          car.wantFire = bd < 8;
        }
      } else if (w.base) {
        // baseline machine gun: shorter engagement range so 5 bots don't
        // hose the player from across the arena
        if (distToTarget < 34 && Math.abs(diff) < 0.32) car.wantFire = true;
      } else if (distToTarget < 52 && Math.abs(diff) < 0.4) {
        car.wantFire = true;
      }
    }
    // special usage
    if (car.special >= 100) {
      const id = car.def.special.id;
      const close = distToTarget < 14;
      const mid = distToTarget < 30;
      if (
        ((id === "freeze_nova" || id === "ground_slam" || id === "mower_smoke" || id === "junk_barrage") && close) ||
        ((id === "drain_beam" || id === "tractor_shock" || id === "chain_hook") && mid) ||
        ((id === "surge_volley" || id === "spike_burst" || id === "casket_bombs") && Math.random() < dt * 0.6)
      ) {
        car.wantSpecial = true;
      }
    }
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3();
  function updateCamera(dt, snap = false) {
    const car = state.player;
    if (!car) return;
    const back = state.lookBack ? -1 : 1;
    const f = forward(car);
    const dist = 10.5, height = 4.6;
    const tx = car.x - f.x * dist * back;
    const tz = car.z - f.z * dist * back;
    const ty = car.y + height;
    if (snap) camPos.set(tx, ty, tz);
    else camPos.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 5.5));
    // Sample ground in the player's elevation band so overhead decks (Mixing
    // Bowl overpass, etc.) don't yank the chase cam above the car.
    const cg = sampleGround(camPos.x, camPos.z, car.y + STEP);
    let cy = Math.max(camPos.y, cg + 2.2);
    const overhead = sampleOverhead(camPos.x, camPos.z, car.y);
    if (overhead < Infinity) cy = Math.min(cy, overhead - 1.5);
    cy = Math.max(cy, car.y + 1.5);
    let sx = 0, sy = 0;
    if (state.shake > 0.01) {
      sx = (Math.random() - 0.5) * state.shake * 0.7;
      sy = (Math.random() - 0.5) * state.shake * 0.5;
    }
    camera.position.set(camPos.x + sx, cy + sy, camPos.z + sx);
    camera.lookAt(car.x + f.x * 5 * back, car.y + 1.6, car.z + f.z * 5 * back);
  }

  // ---------- input ----------
  const keys = {};
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (state.phase === "running") {
      if (e.code === "Space") { e.preventDefault(); }
      if (e.code === "KeyF") { e.preventDefault(); if (state.player) state.player.wantPickupFire = true; }
      if (e.code === "KeyE") { if (state.player) state.player.wantSpecial = true; }
      if (e.code === "KeyT") sponsorDrop();
      if (e.code === "KeyR") state.lookBack = true;
      if (e.code === "KeyP") togglePause();
      // Escape exits max screen first (handled in bindFullscreen), then pauses.
      if (e.code === "Escape" && !document.fullscreenElement && !(el.wrap && el.wrap.classList.contains("is-maxed"))) togglePause();
    } else if (state.phase === "menu") {
      if (e.code === "ArrowLeft") cycleVehicle(-1);
      if (e.code === "ArrowRight") cycleVehicle(1);
      if (e.code === "Enter") startSelectedMode();
    } else if (state.phase === "over") {
      if (e.code === "Enter") firePrimary();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    if (e.code === "KeyR") state.lookBack = false;
  });
  let mouseHeld = false;
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouseHeld = true;
    if (e.button === 2 && state.phase === "running" && state.player) state.player.wantSpecial = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouseHeld = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const touchMove = { x: 0, z: 0 };
  let touchFireHeld = false;
  function bindTouch() {
    const stick = $("touch-stick");
    if (stick) {
      let pointerId = null, origin = null;
      const update = (event) => {
        if (!origin) return;
        const radius = Math.max(30, Math.min(stick.clientWidth, stick.clientHeight) * 0.4);
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 8) { touchMove.x = 0; touchMove.z = 0; return; }
        const scale = Math.min(1, dist / radius);
        touchMove.x = (dx / dist) * scale;
        touchMove.z = (dy / dist) * scale;
      };
      const release = () => {
        pointerId = null;
        origin = null;
        touchMove.x = 0;
        touchMove.z = 0;
        stick.classList.remove("is-held");
      };
      stick.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        pointerId = event.pointerId;
        origin = { x: event.clientX, y: event.clientY };
        stick.classList.add("is-held");
        if (stick.setPointerCapture) { try { stick.setPointerCapture(event.pointerId); } catch (_) {} }
        update(event);
      });
      stick.addEventListener("pointermove", (event) => {
        if (event.pointerId !== pointerId) return;
        event.preventDefault();
        update(event);
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => {
        stick.addEventListener(name, (event) => {
          if (name !== "lostpointercapture" && event.pointerId !== pointerId) return;
          release();
        });
      });
      window.addEventListener("blur", release);
    }
    const hold = (id, onDown, onUp) => {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener("pointerdown", (e) => { e.preventDefault(); onDown(); btn.classList.add("is-held"); });
      ["pointerup", "pointercancel", "pointerleave"].forEach((name) => {
        btn.addEventListener(name, () => { if (onUp) onUp(); btn.classList.remove("is-held"); });
      });
    };
    hold("touch-fire", () => { touchFireHeld = true; if (state.player) state.player.wantFire = true; }, () => {
      touchFireHeld = false;
      if (state.player) state.player.wantFire = false;
    });
    hold("touch-special", () => { if (state.player) state.player.wantSpecial = true; });
    hold("touch-drift", () => { touchMove.drift = true; }, () => { touchMove.drift = false; });
  }

  function readPlayerInput() {
    const car = state.player;
    if (!car || car.wrecked) return;
    let throttle = 0, steer = 0;
    if (keys.KeyW || keys.ArrowUp) throttle += 1;
    if (keys.KeyS || keys.ArrowDown) throttle -= 1;
    if (keys.KeyA || keys.ArrowLeft) steer -= 1;
    if (keys.KeyD || keys.ArrowRight) steer += 1;
    if (Math.abs(touchMove.x) > 0.05 || Math.abs(touchMove.z) > 0.05) {
      throttle = -touchMove.z;
      steer = touchMove.x;
    }
    car.throttle = Math.max(-1, Math.min(1, throttle));
    car.steer = Math.max(-1, Math.min(1, -steer));
    car.drift = !!(keys.ShiftLeft || keys.ShiftRight || touchMove.drift);
    car.wantFire = !!(keys.Space || mouseHeld || touchFireHeld);
  }

  // ---------- HUD ----------
  function bar(elm, pct) {
    if (elm) elm.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  }
  function updateHUD() {
    const car = state.player;
    if (!car) return;
    bar(el.hpFill, (car.hp / car.maxHp) * 100);
    if (el.hpText) el.hpText.textContent = Math.max(0, Math.ceil(car.hp));
    if (el.lives) el.lives.textContent = String(state.playerLives);
    const w = car.weapon ? WEAPONS[car.weapon] : null;
    if (el.weaponIcon) {
      el.weaponIcon.textContent = w ? w.icon : "";
      el.weaponIcon.classList.toggle("is-upgrade", !!w && !w.base);
    }
    if (el.weaponName) el.weaponName.textContent = w ? w.name : "RAM ONLY";
    if (el.weaponAmmo) {
      el.weaponAmmo.textContent = !w
        ? ""
        : w.base ? "∞"
        : car.weapon === "remote" && car.remoteBomb ? "DET"
        : `x${car.ammo}`;
    }
    bar(el.specialFill, car.special);
    if (el.specialName) {
      el.specialName.textContent = car.def.special.name + (car.special >= 100 ? " — READY (E)" : "");
      el.specialName.classList.toggle("is-ready", car.special >= 100);
    }
    if (el.salvage) el.salvage.textContent = state.salvage.toLocaleString();
    const alive = state.cars.filter((c) => !c.wrecked).length;
    if (el.alive) el.alive.textContent = `${alive}/6`;
    if (el.statusChips) {
      const chips = [];
      if (car.frozen > 0) chips.push("🧊 FROZEN");
      if (car.burning > 0) chips.push("🔥 BURNING");
      if (car.shield > 0) chips.push(`🛡 ${car.shield.toFixed(0)}s`);
      if (car.boost > 0) chips.push("⚡ TURBO");
      if (car.stunned > 0) chips.push("💫 STUNNED");
      el.statusChips.textContent = chips.join("  ");
    }
    drawMinimap();
  }

  function drawMinimap() {
    if (!miniCtx || !arena) return;
    const w = el.minimap.width, h = el.minimap.height;
    miniCtx.fillStyle = "rgba(6,8,14,0.92)";
    miniCtx.fillRect(0, 0, w, h);
    const sx = w / (arena.bounds.hw * 2), sz = h / (arena.bounds.hd * 2);
    const mapX = (x) => (x + arena.bounds.hw) * sx;
    const mapZ = (z) => (z + arena.bounds.hd) * sz;
    arena.minimap.forEach((r) => {
      miniCtx.fillStyle = r.color;
      miniCtx.globalAlpha = 0.55;
      miniCtx.fillRect(mapX(r.x - r.hw), mapZ(r.z - r.hd), r.hw * 2 * sx, r.hd * 2 * sz);
    });
    miniCtx.globalAlpha = 1;
    state.pickups.forEach((p) => {
      if (!p.active) return;
      miniCtx.fillStyle = "#f7d716";
      miniCtx.fillRect(mapX(p.x) - 1, mapZ(p.z) - 1, 2, 2);
    });
    state.cars.forEach((car) => {
      if (car.wrecked) {
        miniCtx.fillStyle = "#555";
        miniCtx.fillRect(mapX(car.x) - 1.5, mapZ(car.z) - 1.5, 3, 3);
        return;
      }
      if (car.isPlayer) {
        miniCtx.save();
        miniCtx.translate(mapX(car.x), mapZ(car.z));
        miniCtx.rotate(Math.atan2(Math.sin(car.heading), Math.cos(car.heading)) * -1 + Math.PI);
        miniCtx.fillStyle = "#2ee0ff";
        miniCtx.beginPath();
        miniCtx.moveTo(0, -4.4);
        miniCtx.lineTo(3, 3.4);
        miniCtx.lineTo(-3, 3.4);
        miniCtx.closePath();
        miniCtx.fill();
        miniCtx.restore();
      } else {
        miniCtx.fillStyle = "#ff4b6d";
        miniCtx.beginPath();
        miniCtx.arc(mapX(car.x), mapZ(car.z), 2.4, 0, Math.PI * 2);
        miniCtx.fill();
      }
    });
  }

  // ---------- sponsor drop (rewarded ad loop) ----------
  function sponsorDrop() {
    if (state.phase !== "running" || state.sponsorUsed || !state.player || state.player.wrecked) return;
    state.sponsorUsed = true;
    if (el.sponsor) el.sponsor.hidden = true;
    const grant = () => {
      const car = state.player;
      if (!car || car.wrecked) return;
      car.shield = Math.max(car.shield, 6);
      car.special = 100;
      car.hp = Math.min(car.maxHp, car.hp + 25);
      announce("sponsor", true);
      flash("rgba(99,242,200,0.35)", 160);
      api.toast("Sponsor Drop: shield + full special + repairs");
    };
    if (api.isAdFree && api.isAdFree()) {
      grant();
      return;
    }
    const wasPaused = state.paused;
    state.paused = true;
    api.showRewarded().then((ok) => {
      state.paused = wasPaused;
      if (ok) grant();
      else {
        state.sponsorUsed = false;
        if (el.sponsor) el.sponsor.hidden = false;
      }
    });
  }
  if (el.sponsor) el.sponsor.addEventListener("click", sponsorDrop);

  // ---------- menu ----------
  function cycleVehicle(dir) {
    const n = SCRAP.vehicles.list.length;
    state.vehicleIndex = (state.vehicleIndex + dir + n) % n;
    renderVehicleMenu();
  }
  function statBar(v, max) {
    const n = Math.round((v / max) * 5);
    return "▰".repeat(n) + "▱".repeat(5 - n);
  }
  function resizeMenuVehiclePreview() {
    if (!menuPreviewRenderer || !el.menuVehiclePreview) return;
    const rect = el.menuVehiclePreview.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 360));
    const h = Math.max(1, Math.round(rect.height || 220));
    menuPreviewRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    menuPreviewRenderer.setSize(w, h, false);
    menuPreviewCam.aspect = w / h;
    menuPreviewCam.updateProjectionMatrix();
  }
  function renderMenuVehiclePreview() {
    if (!menuPreviewRenderer || !previewMesh) return;
    if (!el.menu || el.menu.hidden) return;
    resizeMenuVehiclePreview();
    menuPreviewRenderer.render(previewScene, menuPreviewCam);
  }
  function resizeMenuMapCanvas() {
    if (!el.menuMapPreview) return { w: 0, h: 0 };
    const rect = el.menuMapPreview.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((rect.width || 480) * ratio));
    const h = Math.max(1, Math.round((rect.height || 260) * ratio));
    if (el.menuMapPreview.width !== w) el.menuMapPreview.width = w;
    if (el.menuMapPreview.height !== h) el.menuMapPreview.height = h;
    return { w, h };
  }
  const arenaPreviewCache = new Map();
  function getArenaPreview(id) {
    if (arenaPreviewCache.has(id)) return arenaPreviewCache.get(id);
    const entry = (SCRAP.arenas.list || []).find((item) => item.id === id) || (SCRAP.arenas.list || [])[0] || {};
    let built = null;
    try { built = SCRAP.arenas.build(id); } catch (_) {}
    const source = built || entry;
    const data = {
      id: source.id || entry.id || id,
      name: source.name || entry.name || "Unknown Arena",
      tagline: source.tagline || entry.tagline || "",
      bounds: source.bounds || { hw: 100, hd: 100 },
      minimap: (source.minimap || []).map((r) => ({ x: r.x, z: r.z, hw: r.hw, hd: r.hd, color: r.color })),
      pickupSpots: (source.pickupSpots || []).map((p) => ({ x: p.x, z: p.z })),
      spawns: (source.spawns || []).map((s) => ({ x: s.x, z: s.z, h: s.h || 0 })),
    };
    arenaPreviewCache.set(id, data);
    return data;
  }
  function drawSpawn(ctx, x, y, angle, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-angle);
    ctx.fillStyle = "#2ee0ff";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, size * 0.78);
    ctx.lineTo(-size * 0.72, size * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function drawArenaPicture(ctx, w, h, id) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const yGround = h * 0.42;
    const rect = (x, y, rw, rh, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, rw, rh);
    };
    const stripe = (x, y, rw, rh, color, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      rect(x, y, rw, rh, color);
      ctx.restore();
    };
    sky.addColorStop(0, id === "cemetery" ? "#101427" : id === "boardwalk" ? "#102947" : "#121827");
    sky.addColorStop(1, id === "rooftop" ? "#222842" : "#293040");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (let i = 0; i < 10; i += 1) {
      const sx = ((i * 47) % 97) / 100 * w;
      const sy = (0.08 + ((i * 19) % 27) / 100) * h;
      ctx.fillRect(sx, sy, Math.max(1, w * 0.012), Math.max(1, h * 0.018));
    }
    if (id === "suburb") {
      rect(0, yGround, w, h - yGround, "#263f24");
      rect(0, h * 0.63, w, h * 0.18, "#3b3e45");
      rect(w * 0.42, yGround, w * 0.16, h - yGround, "#4b4d52");
      rect(w * 0.08, h * 0.48, w * 0.18, h * 0.16, "#8a6f57");
      rect(w * 0.7, h * 0.5, w * 0.18, h * 0.15, "#735d4c");
      rect(w * 0.11, h * 0.43, w * 0.12, h * 0.05, "#9b3342");
      rect(w * 0.73, h * 0.45, w * 0.12, h * 0.05, "#315f82");
      rect(w * 0.69, h * 0.69, w * 0.17, h * 0.08, "#226a87");
    } else if (id === "junkyard") {
      rect(0, yGround, w, h - yGround, "#443827");
      rect(w * 0.08, h * 0.52, w * 0.3, h * 0.12, "#8c5132");
      rect(w * 0.12, h * 0.4, w * 0.26, h * 0.1, "#2f6072");
      rect(w * 0.56, h * 0.45, w * 0.27, h * 0.12, "#854030");
      rect(w * 0.63, h * 0.32, w * 0.11, h * 0.13, "#a3842b");
      rect(w * 0.48, h * 0.62, w * 0.18, h * 0.08, "#57544b");
      stripe(w * 0.05, h * 0.77, w * 0.85, h * 0.05, "#7f8288", 0.5);
    } else if (id === "interchange") {
      rect(0, yGround, w, h - yGround, "#353942");
      rect(w * 0.08, h * 0.55, w * 0.84, h * 0.16, "#4a4a52");
      rect(w * 0.43, h * 0.35, w * 0.14, h * 0.58, "#56565d");
      stripe(0, h * 0.62, w, h * 0.02, "#d8d2c8", 0.55);
      stripe(w * 0.49, h * 0.35, w * 0.02, h * 0.58, "#d8d2c8", 0.55);
      rect(w * 0.68, h * 0.5, w * 0.18, h * 0.08, "#894a33");
      rect(w * 0.2, h * 0.73, w * 0.04, h * 0.06, "#e8b52e");
      rect(w * 0.3, h * 0.76, w * 0.04, h * 0.06, "#e8b52e");
    } else if (id === "boardwalk") {
      rect(0, yGround, w, h - yGround, "#264a6e");
      rect(0, h * 0.51, w, h * 0.24, "#8a5b32");
      for (let i = 0; i < 8; i += 1) stripe(0, h * (0.54 + i * 0.026), w, h * 0.006, "#c28c4c", 0.45);
      ctx.strokeStyle = "#c98a2e";
      ctx.lineWidth = Math.max(2, h * 0.035);
      ctx.beginPath();
      ctx.arc(w * 0.54, h * 0.5, w * 0.23, Math.PI, Math.PI * 1.94);
      ctx.stroke();
      rect(w * 0.12, h * 0.42, w * 0.18, h * 0.13, "#d33d58");
      rect(w * 0.7, h * 0.44, w * 0.16, h * 0.12, "#2fa5c9");
    } else if (id === "rooftop") {
      rect(0, yGround, w, h - yGround, "#4e5866");
      for (let i = 0; i < 7; i += 1) {
        const bx = i * w * 0.16;
        rect(bx, h * (0.18 + (i % 3) * 0.05), w * 0.11, h * 0.28, "#20293a");
      }
      rect(w * 0.08, h * 0.52, w * 0.34, h * 0.16, "#6e7a86");
      rect(w * 0.55, h * 0.5, w * 0.32, h * 0.18, "#5b6674");
      ctx.strokeStyle = "#e8b52e";
      ctx.lineWidth = Math.max(2, h * 0.025);
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.59, w * 0.08, 0, Math.PI * 2);
      ctx.moveTo(w * 0.64, h * 0.59);
      ctx.lineTo(w * 0.8, h * 0.59);
      ctx.stroke();
      rect(w * 0.2, h * 0.36, w * 0.24, h * 0.03, "#c98a2e");
    } else {
      rect(0, yGround, w, h - yGround, "#26352d");
      ctx.fillStyle = "rgba(245,238,184,0.82)";
      ctx.beginPath();
      ctx.arc(w * 0.82, h * 0.18, h * 0.11, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 10; i += 1) {
        const gx = ((i * 29) % 91) / 100 * w;
        const gy = h * (0.48 + ((i * 17) % 35) / 100);
        rect(gx, gy, w * 0.035, h * 0.12, i % 2 ? "#5b5b62" : "#77777d");
      }
      stripe(0, h * 0.66, w, h * 0.08, "#1d2425", 0.5);
    }
    const haze = ctx.createLinearGradient(0, 0, 0, h);
    haze.addColorStop(0, "rgba(255,255,255,0.05)");
    haze.addColorStop(0.55, "rgba(0,0,0,0)");
    haze.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);
  }
  function drawTacticalMap(ctx, data, x, y, w, h) {
    const bounds = data.bounds || { hw: 100, hd: 100 };
    const pad = Math.max(6, Math.min(w, h) * 0.09);
    const sx = (w - pad * 2) / Math.max(1, bounds.hw * 2);
    const sz = (h - pad * 2) / Math.max(1, bounds.hd * 2);
    const mapX = (px) => x + pad + (px + bounds.hw) * sx;
    const mapZ = (pz) => y + pad + (pz + bounds.hd) * sz;
    ctx.save();
    ctx.fillStyle = "rgba(5,7,13,0.82)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = Math.max(1, Math.floor(Math.min(w, h) / 86));
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = "rgba(46,224,255,0.13)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i += 1) {
      const gx = x + pad + ((w - pad * 2) / 3) * i;
      const gy = y + pad + ((h - pad * 2) / 3) * i;
      ctx.beginPath();
      ctx.moveTo(gx, y + pad);
      ctx.lineTo(gx, y + h - pad);
      ctx.moveTo(x + pad, gy);
      ctx.lineTo(x + w - pad, gy);
      ctx.stroke();
    }
    data.minimap.forEach((r) => {
      ctx.fillStyle = r.color || "#6d7480";
      ctx.globalAlpha = 0.72;
      ctx.fillRect(mapX(r.x - r.hw), mapZ(r.z - r.hd), Math.max(1, r.hw * 2 * sx), Math.max(1, r.hd * 2 * sz));
    });
    ctx.globalAlpha = 1;
    data.pickupSpots.forEach((p) => {
      const r = Math.max(2, Math.min(w, h) * 0.025);
      ctx.fillStyle = "#ffd23b";
      ctx.fillRect(mapX(p.x) - r, mapZ(p.z) - r, r * 2, r * 2);
    });
    data.spawns.slice(0, 6).forEach((s) => {
      drawSpawn(ctx, mapX(s.x), mapZ(s.z), s.h || 0, Math.max(4, Math.min(w, h) * 0.055));
    });
    ctx.restore();
  }
  function drawMenuMapPreview() {
    if (!menuMapCtx || !el.menuMapPreview) return;
    const id = state.mode === "circuit" ? CIRCUIT_ORDER[0] : state.arenaId;
    const data = getArenaPreview(id);
    if (el.menuMapName) el.menuMapName.textContent = state.mode === "circuit" ? "Circuit opener: " + data.name : data.name;
    if (el.menuMapTag) {
      el.menuMapTag.textContent = state.mode === "circuit"
        ? `${CIRCUIT_ORDER.length} arenas queued.`
        : data.tagline;
    }
    const size = resizeMenuMapCanvas();
    const w = size.w, h = size.h;
    if (!w || !h) return;
    drawArenaPicture(menuMapCtx, w, h, data.id);
    const insetPad = Math.max(8, Math.min(w, h) * 0.075);
    const insetW = Math.min(w - insetPad * 2, Math.max(150, w * 0.52));
    const insetH = Math.min(h - insetPad * 2, Math.max(58, h * 0.63));
    drawTacticalMap(menuMapCtx, data, w - insetW - insetPad, h - insetH - insetPad, insetW, insetH);
  }
  function renderVehicleMenu() {
    const def = SCRAP.vehicles.list[state.vehicleIndex];
    if (el.vehName) el.vehName.textContent = def.name;
    if (el.vehArch) el.vehArch.textContent = def.archetype;
    if (el.vehFlavor) el.vehFlavor.textContent = `“${def.flavor}”`;
    if (el.vehSpecial) el.vehSpecial.textContent = `SPECIAL: ${def.special.name} — ${def.special.desc}`;
    if (el.vehStats) {
      el.vehStats.innerHTML = [
        `<span>SPEED <b>${statBar(def.stats.top, 40)}</b></span>`,
        `<span>ARMOR <b>${statBar(def.stats.hp, 200)}</b></span>`,
        `<span>GRIP&nbsp; <b>${statBar(def.stats.turn, 2.7)}</b></span>`,
      ].join("");
    }
    if (previewMesh) previewScene.remove(previewMesh);
    previewMesh = SCRAP.vehicles.build(def.id);
    previewMesh.position.set(0, 0.08, 0);
    previewMesh.rotation.set(0, -0.35, 0);
    previewScene.add(previewMesh);
    renderMenuVehiclePreview();
  }
  function renderArenaRow() {
    if (!el.arenaRow) return;
    el.arenaRow.innerHTML = "";
    SCRAP.arenas.list.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scrap-arena-chip" + (entry.id === state.arenaId ? " is-active" : "");
      btn.innerHTML = `<strong>${entry.name}</strong><span>${entry.tagline}</span>`;
      btn.addEventListener("click", () => {
        state.arenaId = entry.id;
        renderArenaRow();
        drawMenuMapPreview();
      });
      el.arenaRow.appendChild(btn);
    });
    drawMenuMapPreview();
  }
  if (el.vehPrev) el.vehPrev.addEventListener("click", () => cycleVehicle(-1));
  if (el.vehNext) el.vehNext.addEventListener("click", () => cycleVehicle(1));

  // ---------- match flow ----------
  function clearWorld() {
    if (arena) scene.remove(arena.group);
    state.cars.forEach((c) => scene.remove(c.mesh));
    state.projectiles.forEach((p) => scene.remove(p.mesh));
    state.mines.forEach((m) => scene.remove(m.mesh));
    state.firePatches.forEach((f) => scene.remove(f.mesh));
    state.smokes.forEach((s) => scene.remove(s.mesh));
    state.pickups.forEach((p) => scene.remove(p.mesh));
    if (beamMesh) beamMesh.visible = false;
    if (hookMesh) hookMesh.visible = false;
    state.cars = [];
    state.projectiles = [];
    state.mines = [];
    state.firePatches = [];
    state.smokes = [];
    state.pickups = [];
    arena = null;
  }

  function startMatch() {
    // single-match entry
    state.mode = "single";
    state.circuit = null;
    state.salvage = 0;
    beginRound(state.arenaId, 0);
  }

  function startCircuit() {
    state.mode = "circuit";
    state.circuit = { round: 0, writeOffs: 0, premium: false, hpCarry: null, results: [] };
    state.salvage = 0;
    beginRound(CIRCUIT_ORDER[0], 0);
  }

  function startSelectedMode() {
    if (state.mode === "online") net.openLobby();
    else if (state.mode === "circuit") startCircuit();
    else startMatch();
  }

  function beginRound(arenaId, roundIndex, onlineRoster) {
    sfx.unlock();
    clearWorld();
    arena = SCRAP.arenas.build(arenaId);
    scene.add(arena.group);
    scene.background = new THREE.Color(arena.sky);
    scene.fog = new THREE.Fog(arena.fog.color, arena.fog.near, arena.fog.far);
    ps1.renderer.setClearColor(arena.sky, 1);
    hemi.color.set(arena.hemi.sky);
    hemi.groundColor.set(arena.hemi.ground);
    hemi.intensity = arena.hemi.intensity;
    sun.color.set(arena.sun.color);
    sun.intensity = arena.sun.intensity;
    sun.position.set(arena.sun.x, arena.sun.y, arena.sun.z);

    const spawns = arena.spawns.slice();
    if (onlineRoster) {
      // online: one car per lobby player, spawn order = lobby order, no bots
      state.cars = [];
      net.carsById.clear();
      onlineRoster.forEach((r, i) => {
        const isMe = r.id === net.myId;
        const car = makeCar(r.vehicle, isMe, spawns[i % spawns.length]);
        if (isMe) {
          state.player = car;
        } else {
          car.remote = r.id;
          car.ai = null;
        }
        net.carsById.set(r.id, car);
        state.cars.push(car);
      });
    } else {
      // cars: player + 5 distinct bots
      const playerDef = SCRAP.vehicles.list[state.vehicleIndex];
      const others = SCRAP.vehicles.list.filter((v) => v.id !== playerDef.id);
      for (let i = others.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
      }
      state.player = makeCar(playerDef.id, true, spawns[0]);
      state.cars = [state.player];
      for (let i = 0; i < 5; i += 1) {
        const bot = makeCar(others[i].id, false, spawns[(i + 1) % spawns.length]);
        bot.ai.archetype = ARCHETYPES[i % ARCHETYPES.length];
        // circuit escalation: later rounds field tougher, special-happier bots
        if (roundIndex > 0) {
          const hpScale = 1 + BOT_ROUND_HP_SCALE * roundIndex;
          bot.maxHp = Math.round(bot.maxHp * hpScale);
          bot.hp = bot.maxHp;
          bot.specialRate = BOT_SPECIAL_RATE * (1 + BOT_ROUND_SPECIAL_SCALE * roundIndex);
        }
        state.cars.push(bot);
      }
    }
    state.cars.forEach((car) => { car.y = sampleGround(car.x, car.z, 99); });
    // circuit: chassis damage carries between rounds; premium coverage cashes in
    if (state.mode === "circuit" && state.circuit) {
      const c = state.circuit;
      if (c.round > 0 && c.hpCarry != null) {
        state.player.hp = Math.min(state.player.maxHp, Math.max(1, c.hpCarry));
      }
      if (c.premium) {
        state.player.shield = 6;
        c.premium = false;
      }
    }
    setupPickups();

    state.wrecksByPlayer = 0;
    state.playerLives = STARTING_LIVES;
    state.firstBloodDone = false;
    state.sponsorUsed = false;
    state.time = 0;
    state.shake = 0;
    state.phase = "countdown";
    state.countdownT = 3.4;
    state.paused = false;
    if (el.overlay) el.overlay.classList.remove("overlay--show");
    if (el.menu) el.menu.hidden = true;
    if (el.circuitPanel) el.circuitPanel.hidden = true;
    if (el.summaryPanel) el.summaryPanel.hidden = true;
    if (el.sponsor) el.sponsor.hidden = false;
    if (el.arenaName) {
      let prefix = state.mode === "circuit" ? `R${roundIndex + 1}/${CIRCUIT_ORDER.length} · ` : "";
      if (onlineRoster && net.room) prefix = `⚡${net.room.code} · `;
      el.arenaName.textContent = prefix + arena.name.toUpperCase();
    }
    if (el.log) el.log.innerHTML = "";
    updateCamera(0, true);
  }

  function checkMatchEnd() {
    if (state.phase !== "running") return;
    if (net.active) {
      net.checkEnd();
      return;
    }
    const alive = state.cars.filter((c) => !c.wrecked);
    if (state.player.wrecked) {
      if (state.playerLives > 0) {
        respawnPlayerLife();
        return;
      }
      endMatch(false, alive.length + 1);
    } else if (alive.length === 1 && alive[0] === state.player) {
      endMatch(true, 1);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function formatNumber(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, "0");
    return `${min}:${sec}`;
  }

  function placeLabel(placement) {
    const n = Math.max(1, Math.round(Number(placement) || 1));
    const teen = n % 100 >= 11 && n % 100 <= 13;
    const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
    return `${n}${suffix}`;
  }

  function currentVehicleName() {
    const selected = SCRAP.vehicles.list[state.vehicleIndex];
    return (state.player && state.player.def && state.player.def.name) || (selected && selected.name) || "Selected chassis";
  }

  function currentArenaName() {
    const selected = SCRAP.arenas.list.find((a) => a.id === state.arenaId);
    return (arena && arena.name) || (selected && selected.name) || "Unknown arena";
  }

  function currentHpLabel() {
    const car = state.player;
    if (!car) return "0/0";
    return `${Math.max(0, Math.ceil(car.hp))}/${Math.max(1, Math.round(car.maxHp || 0))}`;
  }

  function summaryStat(label, value, accent = false) {
    const mod = accent ? " scrap-summary__stat--accent" : "";
    return `<div class="scrap-summary__stat${mod}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  }

  function renderSummaryPanel(summary) {
    if (!el.summaryPanel) return false;
    const variant = summary.variant === "loss" ? "loss" : "win";
    const stats = summary.stats.map((stat) => summaryStat(stat.label, stat.value, stat.accent)).join("");
    const route = summary.route && summary.route.length
      ? `<div class="scrap-summary__route">${summary.route.map((item) => {
        const statusClass = item.won ? "is-win" : "is-loss";
        return `<div class="scrap-summary__route-chip ${statusClass}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.meta)}</span></div>`;
      }).join("")}</div>`
      : "";
    const note = summary.note ? `<p class="scrap-summary__note">${escapeHtml(summary.note)}</p>` : "";

    el.summaryPanel.innerHTML =
      `<div class="scrap-summary__hero scrap-summary__hero--${variant}">` +
        `<span class="scrap-summary__eyebrow">${escapeHtml(summary.eyebrow)}</span>` +
        `<strong class="scrap-summary__result">${escapeHtml(summary.result)}</strong>` +
        `<span class="scrap-summary__score">${escapeHtml(summary.scoreLabel)} <b>${escapeHtml(summary.scoreValue)}</b></span>` +
      `</div>` +
      `<div class="scrap-summary__grid">${stats}</div>` +
      route +
      note;
    el.summaryPanel.hidden = false;
    return true;
  }

  function renderEndSummary(summary) {
    if (summary.kind === "circuit") {
      const c = state.circuit || { round: 0, writeOffs: 0, results: [] };
      const results = c.results || [];
      const totalTime = results.reduce((sum, r) => sum + (Number(r.elapsed) || 0), 0);
      const totalWrecks = results.reduce((sum, r) => sum + (Number(r.wrecks) || 0), 0);
      const wins = results.filter((r) => r.won).length;
      const best = api.getHighScore(CIRCUIT_SCORE_ID);
      const roundCount = `${results.length}/${CIRCUIT_ORDER.length}`;
      const roundNow = Math.min(CIRCUIT_ORDER.length, Math.max(1, (Number(c.round) || 0) + 1));
      return renderSummaryPanel({
        variant: summary.finished ? "win" : "loss",
        eyebrow: summary.finished ? "Circuit complete" : "Circuit closed",
        result: summary.finished ? "Circuit Champion" : `Ended Round ${roundNow}`,
        scoreLabel: "Final salvage",
        scoreValue: formatNumber(state.salvage),
        stats: [
          { label: "Salvage", value: formatNumber(state.salvage), accent: true },
          { label: "Rounds", value: roundCount },
          { label: "Wins", value: wins },
          { label: "Wrecks", value: totalWrecks },
          { label: "Write-offs", value: c.writeOffs || 0 },
          { label: "Total Time", value: formatTime(totalTime) },
          { label: "Vehicle", value: currentVehicleName() },
          { label: "Best", value: summary.isHigh ? "New record" : formatNumber(best) },
        ],
        route: results.map((r, i) => ({
          name: `R${i + 1} ${r.name || "Arena"}`,
          meta: `${r.won ? "WIN" : "P" + r.placement} - ${formatTime(r.elapsed)} - ${r.wrecks || 0} wrecks`,
          won: !!r.won,
        })),
        note: summary.isHigh
          ? "New circuit record filed before The Adjuster could lose the paperwork."
          : `Best circuit remains ${formatNumber(best)} Salvage.`,
      });
    }

    const totalCars = state.cars.length || 6;
    const best = api.getHighScore(GAME_ID);
    return renderSummaryPanel({
      variant: summary.won ? "win" : "loss",
      eyebrow: summary.won ? "Claim approved-ish" : "Claim denied",
      result: summary.won ? "Last Chassis Standing" : `Totaled - ${placeLabel(summary.placement)}`,
      scoreLabel: "Salvage",
      scoreValue: formatNumber(state.salvage),
      stats: [
        { label: "Salvage", value: formatNumber(state.salvage), accent: true },
        { label: "Placement", value: `${placeLabel(summary.placement)} of ${totalCars}` },
        { label: "Wrecks", value: state.wrecksByPlayer },
        { label: "Lives", value: `${state.playerLives}/${STARTING_LIVES}` },
        { label: "Chassis HP", value: currentHpLabel() },
        { label: "Time", value: formatTime(state.time) },
        { label: "Vehicle", value: currentVehicleName() },
        { label: "Arena", value: currentArenaName() },
      ],
      note: summary.isHigh
        ? "New high score logged in Salvage, which is legally not taxable advice."
        : `High salvage remains ${formatNumber(best)}.`,
    });
  }

  function endMatch(won, placement) {
    if (state.mode === "circuit") {
      endCircuitRound(won, placement);
      return;
    }
    state.phase = "over";
    const placeBonus = [0, 500, 300, 200, 120, 60, 0][placement] || 0;
    addSalvage(placeBonus);
    if (won) {
      addSalvage(500);
      announce("win", true);
      sfx.win();
      flash("rgba(255,220,120,0.4)", 300);
    } else {
      sfx.lose();
    }
    const isHigh = api.recordScore(GAME_ID, state.salvage);
    setTimeout(() => {
      if (el.overlayTitle) el.overlayTitle.textContent = won ? "LAST CHASSIS STANDING" : `TOTALED — P${placement}`;
      if (el.overlaySub) {
        el.overlaySub.textContent = won
          ? "The Adjuster denies your victory claim, but the salvage is yours."
          : "Your claim has been reviewed and aggressively denied.";
      }
      if (el.overlayScore) {
        el.overlayScore.textContent = "";
      }
      if (el.circuitPanel) el.circuitPanel.hidden = true;
      if (el.menu) el.menu.hidden = true;
      renderEndSummary({ kind: "single", won, placement, isHigh });
      setPrimary("start", "Run it back");
      if (el.overlay) el.overlay.classList.add("overlay--show");
    }, won ? 1400 : 1600);
  }

  // ---------- circuit mode flow ----------
  function pick(lines) {
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function endCircuitRound(won, placement) {
    state.phase = "over";
    const c = state.circuit;
    addSalvage((CIRCUIT_PLACE_BONUS[placement] || 0) + (won ? 250 : 0));
    c.results.push({
      name: arena ? arena.name : "Arena",
      placement,
      won,
      elapsed: state.time,
      wrecks: state.wrecksByPlayer,
    });
    c.hpCarry = won ? Math.max(1, Math.round(state.player.hp)) : 0;
    if (won) {
      announce("win", true);
      sfx.win();
      flash("rgba(255,220,120,0.4)", 300);
    } else {
      sfx.lose();
    }
    const lastRound = c.round >= CIRCUIT_ORDER.length - 1;
    setTimeout(() => {
      if (lastRound) circuitComplete(won);
      else showIntermission(won);
    }, won ? 1400 : 1600);
  }

  function showIntermission(won) {
    const c = state.circuit;
    if (el.overlayTitle) el.overlayTitle.textContent = won ? `ROUND ${c.round + 1}/${CIRCUIT_ORDER.length} CLEARED` : "TOTAL LOSS";
    if (el.overlaySub) el.overlaySub.textContent = pick(won ? ESTIMATE_LINES : WRITEOFF_LINES);
    if (el.overlayScore) el.overlayScore.textContent = "";
    if (el.menu) el.menu.hidden = true;
    if (el.summaryPanel) el.summaryPanel.hidden = true;
    if (el.circuitPanel) el.circuitPanel.hidden = false;
    renderIntermission(won ? "repair" : "writeoff");
    if (el.overlay) el.overlay.classList.add("overlay--show");
  }

  function cirButton(label, sub, cost, enabled, onBuy) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scrap-cir-opt";
    btn.disabled = !enabled;
    btn.innerHTML = `<strong>${label}</strong><span>${sub}</span><small>${cost > 0 ? `${cost} SALVAGE` : "FREE"}</small>`;
    btn.addEventListener("click", onBuy);
    return btn;
  }

  function renderIntermission(view) {
    const c = state.circuit;
    const panel = el.circuitPanel;
    if (!panel) return;
    const maxHp = state.player.maxHp;
    const missing = Math.max(0, maxHp - c.hpCarry);
    panel.innerHTML = "";

    // header: wallet + route progress + chassis bar
    const stats = document.createElement("div");
    stats.className = "scrap-cir-stats";
    const route = c.results.map((r, i) => `R${i + 1}:${r.won ? "WIN" : "P" + r.placement}`).join(" ");
    stats.innerHTML =
      `<span class="scrap-cir-wallet">SALVAGE <b>${state.salvage.toLocaleString()}</b></span>` +
      `<span class="scrap-cir-route">${route}</span>`;
    panel.appendChild(stats);

    const hpRow = document.createElement("div");
    hpRow.className = "scrap-cir-hp";
    const pct = Math.round((c.hpCarry / maxHp) * 100);
    hpRow.innerHTML = `<span>CHASSIS</span><i><b style="width:${pct}%"></b></i><em>${c.hpCarry}/${maxHp}</em>`;
    panel.appendChild(hpRow);

    const opts = document.createElement("div");
    opts.className = "scrap-cir-opts";
    panel.appendChild(opts);

    if (view === "writeoff") {
      const cost = WRITEOFF_BASE + WRITEOFF_STEP * c.writeOffs;
      if (state.salvage >= cost) {
        opts.appendChild(cirButton(
          "PAY THE WRITE-OFF", "Un-total the chassis. Revive at 55% HP.", cost, true,
          () => {
            state.salvage -= cost;
            c.writeOffs += 1;
            c.hpCarry = Math.round(maxHp * WRITEOFF_REVIVE);
            renderIntermission("repair");
          }
        ));
        // ...or bank the salvage now and end the run on your own terms
        setPrimary("end-circuit", "Cash out & retire");
      } else {
        const broke = document.createElement("p");
        broke.className = "scrap-cir-broke";
        broke.textContent = `The write-off costs ${cost} Salvage. You have ${state.salvage}. The Adjuster is already towing your chassis away.`;
        opts.appendChild(broke);
        setPrimary("end-circuit", "File final claim");
      }
      return;
    }

    // repair view
    const fullCost = Math.ceil(missing * REPAIR_RATE);
    opts.appendChild(cirButton(
      "FULL REPAIR", `Restore all ${missing} missing HP.`, fullCost,
      missing > 0 && state.salvage >= fullCost,
      () => {
        state.salvage -= fullCost;
        c.hpCarry = maxHp;
        renderIntermission("repair");
      }
    ));
    opts.appendChild(cirButton(
      "PATCH JOB", `Duct tape ${PATCH_HP} HP back on.`, PATCH_COST,
      missing >= 5 && state.salvage >= PATCH_COST,
      () => {
        state.salvage -= PATCH_COST;
        c.hpCarry = Math.min(maxHp, c.hpCarry + PATCH_HP);
        renderIntermission("repair");
      }
    ));
    opts.appendChild(cirButton(
      c.premium ? "PREMIUM COVERAGE ✓" : "PREMIUM COVERAGE", "Start the next round with a 6s shield.", PREMIUM_COST,
      !c.premium && state.salvage >= PREMIUM_COST,
      () => {
        state.salvage -= PREMIUM_COST;
        c.premium = true;
        renderIntermission("repair");
      }
    ));

    const nextName = (SCRAP.arenas.list.find((a2) => a2.id === CIRCUIT_ORDER[c.round + 1]) || {}).name || "???";
    setPrimary("next-round", `Next: ${nextName} →`);
  }

  function startNextRound() {
    const c = state.circuit;
    c.round += 1;
    beginRound(CIRCUIT_ORDER[c.round], c.round);
  }

  function circuitComplete(finished) {
    state.phase = "over";
    const c = state.circuit;
    if (finished) addSalvage(CIRCUIT_FINISH_BONUS);
    const isHigh = api.recordScore(CIRCUIT_SCORE_ID, state.salvage);
    if (finished) sfx.win();
    if (el.overlayTitle) {
      el.overlayTitle.textContent = finished ? "CIRCUIT CHAMPION" : `CIRCUIT OVER — ROUND ${c.round + 1}`;
    }
    if (el.overlaySub) {
      el.overlaySub.textContent = finished
        ? "Six arenas, one chassis. The Adjuster denies your championship claim but the salvage clears."
        : "Your circuit has been closed due to a total and extremely permanent loss.";
    }
    if (el.overlayScore) {
      el.overlayScore.textContent = "";
    }
    if (el.circuitPanel) el.circuitPanel.hidden = true;
    if (el.menu) el.menu.hidden = true;
    renderEndSummary({ kind: "circuit", finished, isHigh });
    renderVehicleMenu();
    renderModeRow();
    renderArenaRow();
    applyModeToMenu();
    setPrimary("start", finished ? "Run the circuit again" : "Back to the circuit");
    if (el.overlay) el.overlay.classList.add("overlay--show");
  }

  function togglePause() {
    if (state.phase !== "running") return;
    if (net.active) {
      api.toast("No pausing in an online derby.");
      return;
    }
    state.paused = !state.paused;
    if (el.btnPause) el.btnPause.textContent = state.paused ? "Resume" : "Pause";
    api.toast(state.paused ? "Paused" : "Back to the derby");
  }
  if (el.btnPause) el.btnPause.addEventListener("click", togglePause);
  if (el.btnRestart) {
    el.btnRestart.addEventListener("click", () => {
      net.reset();
      state.phase = "menu";
      state.paused = false;
      clearWorld();
      showMenu();
    });
  }

  // Primary button is a small dispatcher: label + intent set by whoever
  // shows the overlay (menu / intermission / results).
  function setPrimary(action, label) {
    state.primaryAction = action;
    if (!el.btnPrimary) return;
    if (action === "none") {
      el.btnPrimary.hidden = true;
      return;
    }
    el.btnPrimary.hidden = false;
    if (label) el.btnPrimary.textContent = label;
  }
  function firePrimary() {
    switch (state.primaryAction) {
      case "next-round": startNextRound(); break;
      case "end-circuit": circuitComplete(false); break;
      case "menu": showMenu(); break;
      case "start": default: startSelectedMode(); break;
    }
  }
  if (el.btnPrimary) el.btnPrimary.addEventListener("click", firePrimary);

  function renderModeRow() {
    if (!el.modeRow) return;
    el.modeRow.innerHTML = "";
    [
      { id: "single", label: "Single Match", sub: "One arena. Pick your fight." },
      { id: "circuit", label: "Full Circuit", sub: "All 6 arenas. Repairs cost Salvage." },
      { id: "online", label: "Online Derby", sub: "Room codes. Wreck your friends." },
    ].forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scrap-mode-chip" + (m.id === state.mode ? " is-active" : "");
      btn.innerHTML = `<strong>${m.label}</strong><span>${m.sub}</span>`;
      btn.addEventListener("click", () => {
        state.mode = m.id;
        renderModeRow();
        applyModeToMenu();
      });
      el.modeRow.appendChild(btn);
    });
  }
  function applyModeToMenu() {
    // circuit runs the fixed six-arena order, so hide the arena picker
    if (el.arenaRow) el.arenaRow.style.display = state.mode === "circuit" ? "none" : "";
    if (state.mode === "online") setPrimary("start", "Open online lobby");
    else setPrimary("start", state.mode === "circuit" ? "Enter the circuit" : "Start your engine");
    drawMenuMapPreview();
  }

  function showMenu() {
    net.reset();
    state.phase = "menu";
    state.circuit = null;
    if (el.overlayTitle) el.overlayTitle.textContent = "SCRAP CIRCUIT";
    if (el.overlaySub) el.overlaySub.textContent = "Last Chassis Standing. Ten unhinged service vehicles, six arenas, one very hostile insurance adjuster.";
    if (el.overlayScore) {
      const high = api.getHighScore(GAME_ID);
      const circuitHigh = api.getHighScore(CIRCUIT_SCORE_ID);
      const parts = [];
      if (high) parts.push(`High salvage: ${high.toLocaleString()}`);
      if (circuitHigh) parts.push(`Best circuit: ${circuitHigh.toLocaleString()}`);
      el.overlayScore.textContent = parts.join(" · ");
    }
    if (el.menu) el.menu.hidden = false;
    if (el.circuitPanel) el.circuitPanel.hidden = true;
    if (el.summaryPanel) el.summaryPanel.hidden = true;
    if (el.overlay) el.overlay.classList.add("overlay--show");
    renderVehicleMenu();
    renderModeRow();
    renderArenaRow();
    applyModeToMenu();
  }

  // ---------- fullscreen (site max-screen pattern) ----------
  function bindFullscreen() {
    const fsBtn = $("btn-fullscreen");
    const fsTarget = canvas.closest(".canvas-wrap") || canvas.parentElement;
    if (!fsTarget) return;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const updateBtn = () => {
      if (!fsBtn) return;
      const on = isMaxed();
      fsBtn.textContent = on ? "✕" : "⛶";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
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
        if (req) { try { const r = req.call(fsTarget); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
      } else if (nativeFsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { try { exit.call(document); } catch (_) {} }
      }
    };
    if (fsBtn) fsBtn.addEventListener("click", toggle);
    const onNativeChange = () => { if (!nativeFsEl() && isMaxed()) setMaxed(false); };
    document.addEventListener("fullscreenchange", onNativeChange);
    document.addEventListener("webkitfullscreenchange", onNativeChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
    });
    updateBtn();
  }

  // ---------- resize / loop ----------
  function resize() {
    const wrap = el.wrap;
    if (!wrap) return;
    const w = wrap.clientWidth || canvas.clientWidth || 960;
    const h = wrap.clientHeight || canvas.clientHeight || 540;
    const aspect = ps1.resize(w, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    previewCam.aspect = aspect;
    previewCam.updateProjectionMatrix();
    resizeMenuVehiclePreview();
    drawMenuMapPreview();
  }

  let lastT = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(1 / 30, (now - lastT) / 1000);
    lastT = now;

    if (state.phase === "menu" || (state.phase === "over" && el.overlay && el.overlay.classList.contains("overlay--show"))) {
      if (previewMesh) previewMesh.rotation.y += dt * 0.7;
      renderMenuVehiclePreview();
      ps1.render(previewScene, previewCam);
      sfx.engine(0, false);
      return;
    }
    if (state.paused) {
      ps1.render(scene, camera);
      sfx.engine(0, false);
      return;
    }

    state.time += dt;
    if (state.barkCooldown > 0) state.barkCooldown -= dt;
    state.shake = Math.max(0, state.shake - dt * 2.2);

    if (state.phase === "countdown") {
      state.countdownT -= dt;
      const n = Math.min(3, Math.max(1, Math.ceil(state.countdownT)));
      if (el.countdown) {
        el.countdown.hidden = false;
        el.countdown.textContent = state.countdownT > 0.4 ? String(n) : "SCRAP!";
      }
      if (state.countdownT <= 0) {
        state.phase = "running";
        if (el.countdown) el.countdown.hidden = true;
        announce("start", true);
      }
      updateCamera(dt);
      updateHUD();
      ps1.render(scene, camera);
      return;
    }

    if (state.phase === "running" || state.phase === "over") {
      advanceSim(dt);
      const pl = state.player;
      sfx.engine(pl && !pl.wrecked ? Math.min(1, Math.hypot(pl.vx, pl.vz) / pl.def.stats.top) : 0, state.phase === "running");
    }
    ps1.render(scene, camera);
  }

  function advanceSim(dt) {
    readPlayerInput();
    state.cars.forEach((car) => { if (!car.isPlayer && !car.remote) updateAI(car, dt); });
    state.cars.forEach((car) => { if (car.remote) net.updatePuppet(car, dt); else updateCar(car, dt); });
    if (net.active) net.tick(dt);
    collideCars(dt);
    updatePickups(dt);
    updateProjectiles(dt);
    updateMines(dt);
    updateFirePatches(dt);
    updateSmokes(dt);
    updateParticles(dt);
    updateBooms(dt);
    if (arena) arena.update(dt, { time: state.time, cars: state.cars, applyDamage, impulse, boom, announce });
    updateCamera(dt);
    updateHUD();
  }

  // ---------- online derby (RBNet) ----------
  // Serverless p2p model over Supabase Realtime:
  //  - each client simulates ONLY its own car; remote cars are interpolated puppets
  //  - damage is victim-authoritative: applyDamage/impulse/wreck drop anything
  //    aimed at a puppet, and every client reports its own HP via snapshots
  //  - discrete actions (pickup weapons, specials, pickups, mine hits) replicate
  //    as events and replay against the puppet; the machine gun rides a snapshot flag
  //  - pickup types come from a seeded roll, so no host authority is needed at all
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  const net = {
    active: false,
    room: null,
    myId: null,
    seed: 1,
    roster: [],
    carsById: new Map(),
    out: new Set(),
    myOut: false,
    ended: false,
    sendAcc: 0,

    rand(n) {
      let t = (net.seed ^ n) >>> 0;
      t += 0x6d2b79f5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    reset() {
      if (net.room) { try { net.room.leave(); } catch (_) {} }
      net.room = null;
      net.active = false;
      net.ended = false;
      net.myOut = false;
      net.out = new Set();
      net.carsById.clear();
      net.roster = [];
      net.sendAcc = 0;
    },

    openLobby() {
      if (!window.RBNetUI || !window.RBNet || !RBNet.available()) {
        api.toast("Online play isn't available right now.");
        return;
      }
      const def = SCRAP.vehicles.list[state.vehicleIndex];
      RBNetUI.open({
        game: GAME_ID,
        title: "SCRAP CIRCUIT — ONLINE DERBY",
        accent: "#ffd23b",
        minPlayers: 2,
        maxPlayers: 6,
        meta: { vehicle: def.id, vname: def.name },
        playerTag: (p) => p.vname || "",
        getStartPayload: () => ({ arena: state.arenaId }),
        onStart: ({ room, players, payload }) => net.start(room, players, payload),
        onClose: () => {},
      });
    },

    start(room, players, payload) {
      net.reset();
      net.room = room;
      net.myId = room.id;
      net.seed = (payload.seed >>> 0) || 1;
      net.roster = players.map((p) => ({
        id: p.id,
        name: p.name || "SCRAPPER",
        vehicle: SCRAP.vehicles.get(p.vehicle) ? p.vehicle : SCRAP.vehicles.list[0].id,
      }));
      net.active = true;
      state.mode = "online";
      if (payload.arena) state.arenaId = payload.arena;
      room.on("state", (d, from) => net.onSnap(from, d));
      room.on("act", (d, from) => net.onAct(from, d));
      room.on("ptake", (d, from) => net.onPtake(d, from));
      room.on("mineboom", (d) => net.onMineBoom(d));
      room.on("wrecked", (d, from) => net.onWrecked(from, d));
      room.on("peerleave", (pid) => net.onLeave(pid));
      room.on("closed", () => net.onClosed());
      beginRound(state.arenaId, 0, net.roster);
    },

    send(type, data) {
      if (net.active && net.room) net.room.send(type, data);
    },

    tick(dt) {
      if (!net.active || !net.room) return;
      net.sendAcc += dt;
      if (net.sendAcc >= 1 / 12) {
        net.sendAcc = 0;
        net.pushSnap();
        net.checkEnd();
      }
    },

    pushSnap() {
      const p = state.player;
      if (!p || !net.room) return;
      const disabled = p.frozen > 0 || p.stunned > 0;
      net.send("state", {
        x: r2(p.x), y: r2(p.y), z: r2(p.z), h: r3(p.heading),
        vx: r2(p.vx), vz: r2(p.vz),
        hp: Math.round(p.hp), mh: p.maxHp,
        sp: r2(Math.max(0, p.shield)), fz: r2(Math.max(0, p.frozen)),
        bn: r2(Math.max(0, p.burning)), bo: r2(Math.max(0, p.boost)),
        st: r2(Math.max(0, p.stunned)),
        wp: p.weapon,
        fi: p.wantFire && !disabled && !p.wrecked ? 1 : 0,
        w: p.wrecked ? 1 : 0,
        o: net.myOut ? 1 : 0,
      });
    },

    onSnap(from, d) {
      const car = net.carsById.get(from);
      if (!car || !d) return;
      car.netSnap = { x: d.x, y: d.y, z: d.z, h: d.h, vx: d.vx || 0, vz: d.vz || 0 };
      car.hp = d.hp;
      if (d.mh) car.maxHp = d.mh;
      car.shield = d.sp || 0;
      car.frozen = d.fz || 0;
      car.burning = d.bn || 0;
      car.boost = d.bo || 0;
      car.stunned = d.st || 0;
      car.netFi = !!d.fi;
      if (d.wp && car.weapon !== d.wp) {
        car.weapon = d.wp;
        car.ammo = d.wp === BASE_WEAPON ? Infinity : Math.max(1, WEAPONS[d.wp] ? WEAPONS[d.wp].ammo : 1);
      }
      if (d.o && !net.out.has(from)) {
        net.out.add(from);
        net.checkEnd();
      }
      if (d.w && !car.wrecked) wreck(car, { net: true });
      else if (!d.w && car.wrecked) net.reviveCar(car, d);
    },

    reviveCar(car, d) {
      car.wrecked = false;
      car.wreckT = 0;
      car.x = d.x; car.z = d.z; car.y = d.y;
      car.heading = d.h;
      car.vx = 0; car.vz = 0; car.vy = 0;
      car.frozen = 0; car.stunned = 0; car.burning = 0;
      car.mesh.rotation.set(0, car.heading, 0);
      car.mesh.position.set(car.x, car.y, car.z);
      burst(car.x, car.y + 1, car.z, 0x63f2c8, 12, 8);
    },

    onAct(from, d) {
      const car = net.carsById.get(from);
      if (!car || car.wrecked || !d) return;
      if (d.k === "weapon") {
        car.weapon = WEAPONS[d.w] ? d.w : BASE_WEAPON;
        if (car.ammo !== Infinity && !(car.ammo >= 1)) car.ammo = WEAPONS[car.weapon].ammo || 1;
        car.fireCooldown = 0;
        fireWeapon(car);
      } else if (d.k === "special") {
        car.special = 100;
        fireSpecial(car);
      }
    },

    onPtake(d, from) {
      if (!d) return;
      const p = state.pickups[d.i];
      if (!p) return;
      if (d.ty) p.type = d.ty;
      const car = net.carsById.get(from) || state.player;
      takePickup(car, p, true);
    },

    onMineBoom(d) {
      if (!d) return;
      let best = null, bestD = 16;
      state.mines.forEach((m) => {
        const dd = (m.x - d.x) ** 2 + (m.z - d.z) ** 2;
        if (dd < bestD) { bestD = dd; best = m; }
      });
      if (best) {
        boomVisual(best.x, best.y + 0.5, best.z, 6);
        sfx.hit();
        scene.remove(best.mesh);
        state.mines.splice(state.mines.indexOf(best), 1);
      }
    },

    onWrecked(from, d) {
      if (d && d.by === net.myId) {
        addSalvage(150);
        state.wrecksByPlayer += 1;
      }
    },

    onLeave(pid) {
      if (!net.active) return;
      const fresh = !net.out.has(pid);
      net.out.add(pid);
      if (fresh) {
        const r = net.roster.find((x) => x.id === pid);
        api.toast(`${r ? r.name : "A rival"} rage-quit the derby.`);
      }
      const car = net.carsById.get(pid);
      if (car && !car.wrecked) wreck(car, { net: true });
      net.checkEnd();
    },

    onClosed() {
      if (!net.active || net.ended) return;
      api.toast("Connection lost.");
      net.finish(false, 0);
    },

    aliveOpponents() {
      return net.roster.filter((r) => r.id !== net.myId && !net.out.has(r.id));
    },

    checkEnd() {
      if (!net.active || net.ended || state.phase !== "running") return;
      const p = state.player;
      if (p.wrecked && !net.myOut) {
        if (state.playerLives > 0) {
          respawnPlayerLife();
          net.pushSnap();
          return;
        }
        net.myOut = true;
        net.pushSnap();
        net.finish(false, net.aliveOpponents().length + 1);
        return;
      }
      if (!net.myOut && net.roster.length > 1 && net.aliveOpponents().length === 0) {
        net.finish(true, 1);
      }
    },

    finish(won, placement) {
      net.ended = true;
      net.myOut = net.myOut || !won;
      state.phase = "over";
      const code = net.room ? net.room.code : "";
      if (won) {
        announce("win", true);
        sfx.win();
        flash("rgba(255,220,120,0.4)", 300);
      } else {
        sfx.lose();
      }
      // let the final snapshot land before we hang up
      setTimeout(() => {
        if (net.room) { try { net.room.leave(); } catch (_) {} net.room = null; }
        net.active = false;
      }, 1200);
      setTimeout(() => {
        if (el.overlayTitle) {
          el.overlayTitle.textContent = won
            ? "LAST CHASSIS ONLINE"
            : placement > 0 ? `TOTALED — P${placement}` : "CONNECTION LOST";
        }
        if (el.overlaySub) {
          el.overlaySub.textContent = won
            ? `Room ${code} has been liquidated. You keep the paperwork.`
            : placement > 0
              ? "Your online claim was denied with prejudice."
              : "The insurance servers have ghosted you.";
        }
        if (el.overlayScore) el.overlayScore.textContent = "";
        if (el.menu) el.menu.hidden = true;
        if (el.circuitPanel) el.circuitPanel.hidden = true;
        if (el.summaryPanel) el.summaryPanel.hidden = true;
        setPrimary("menu", "Back to the garage");
        if (el.overlay) el.overlay.classList.add("overlay--show");
      }, won ? 1400 : 1600);
    },

    updatePuppet(car, dt) {
      if (car.wrecked) {
        car.wreckT += dt;
        car.mesh.position.set(car.x, car.y + 1.2, car.z);
        if (Math.random() < dt * 3) burst(car.x, car.y + 1.6, car.z, 0x3a3a44, 2, 2, 5);
        return;
      }
      if (car.frozen > 0) car.frozen -= dt;
      if (car.stunned > 0) car.stunned -= dt;
      if (car.slowed > 0) car.slowed -= dt;
      if (car.shield > 0) car.shield -= dt;
      if (car.boost > 0) car.boost -= dt;
      if (car.burning > 0) car.burning -= dt;
      if (car.gunCooldown > 0) car.gunCooldown -= dt;
      if (car.fireCooldown > 0) car.fireCooldown -= dt;
      const s = car.netSnap;
      if (s) {
        // dead-reckon the last snapshot forward, then chase it
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        const dx = s.x - car.x, dz = s.z - car.z;
        if (dx * dx + dz * dz > 900) {
          car.x = s.x; car.z = s.z; car.y = s.y;
        } else {
          const k = Math.min(1, dt * 9);
          car.x += dx * k;
          car.z += dz * k;
          car.y += (s.y - car.y) * k;
        }
        let dh = s.h - car.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        car.heading += dh * Math.min(1, dt * 10);
        car.vx = s.vx;
        car.vz = s.vz;
      }
      if (car.netFi && car.frozen <= 0 && car.stunned <= 0) fireMachineGun(car);
      updateSpecialStates(car, dt);
      car.fx.ice.visible = car.frozen > 0;
      car.fx.shield.visible = car.shield > 0;
      car.mesh.position.set(car.x, car.y, car.z);
      car.mesh.rotation.set(0, car.heading, 0);
      const speed = Math.hypot(car.vx, car.vz);
      car.wheelSpin += speed * dt * 1.6;
      car.mesh.userData.wheels.forEach((w) => { w.rotation.x = car.wheelSpin; });
      if (car.mesh.userData.spinner) car.mesh.userData.spinner.rotation.y += dt * 6;
      if (car.burning > 0 && Math.random() < dt * 2) burst(car.x, car.y + 1.6, car.z, 0xff8a2e, 3, 3, 5);
    },
  };

  // ---------- debug hooks ----------
  if (DEBUG) {
    window.__scrapDebug = {
      state, net, sampleGround, get arena() { return arena; },
      startMatch, startCircuit, startNextRound, circuitComplete, endMatch,
      get player() { return state.player; },
      makePickupModel, scene, applyDamage, respawnPlayerLife, collideCars,
      // deterministic sim stepper (rAF is paused when the tab is hidden)
      step(n = 60, dt = 1 / 60) {
        if (state.phase === "countdown") { state.phase = "running"; state.countdownT = 0; }
        for (let i = 0; i < n; i += 1) { state.time += dt; advanceSim(dt); }
      },
      // drive the player: throttle -1..1, steer -1..1, for n steps
      drive(throttle, steer, n = 60, dt = 1 / 60) {
        const p = state.player;
        for (let i = 0; i < n; i += 1) {
          p.throttle = throttle; p.steer = steer;
          state.time += dt;
          state.cars.forEach((c) => updateCar(c, dt));
          collideCars(dt);
          if (arena) arena.update(dt, { time: state.time, cars: state.cars, applyDamage, impulse, boom, announce });
        }
        return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), heading: +p.heading.toFixed(2), speed: +Math.hypot(p.vx, p.vz).toFixed(2) };
      },
    };
  }

  // ---------- boot ----------
  bindTouch();
  bindFullscreen();
  if (SCRAP.textures) SCRAP.textures.load();
  resize();
  window.addEventListener("resize", resize);
  showMenu();
  if (PARAMS.get("autostart") === "1") startMatch();
  requestAnimationFrame(loop);
})();
