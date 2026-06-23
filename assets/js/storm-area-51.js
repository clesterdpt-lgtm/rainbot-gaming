/* ============================================
   STORM AREA 51: RAID THE BASE
   - Reverse tower defense arcade.
   - Deploy squads down lanes, overwhelm base defenses, breach the lab, escort the alien.
   - Canvas playfield, DOM HUD/menus. Debug hook: window.__STORM51
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "storm-area-51";
  const W = 960;
  const H = 540;
  const LANES = [
    { id: 0, name: "North Gate", y: 170, color: "#2ee0ff" },
    { id: 1, name: "Main Road", y: 284, color: "#ff2e88" },
    { id: 2, name: "South Fence", y: 398, color: "#ffd43b" },
  ];
  const SPAWN_X = 58;
  const EXIT_X = 902;
  const LAB_X = 804;
  const VAN_X = 900;
  const LAB_MAX_HP = 235;
  const LAB_SHIELDS_REQUIRED = 2;

  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const assets = {
    map: new URL("../img/storm-area-51/base-map.png", scriptUrl).href,
    sprites: new URL("../img/storm-area-51/sprites.png", scriptUrl).href,
  };

  const C = {
    ink: "#fbfaf4",
    dim: "#b6b3c9",
    cyan: "#2ee0ff",
    pink: "#ff2e88",
    yellow: "#ffd43b",
    green: "#6bff7d",
    red: "#ff4f68",
    purple: "#b06cff",
    orange: "#ff9d42",
    blue: "#78a8ff",
  };

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const wrap = canvas.closest(".canvas-wrap");
  const overlay = document.getElementById("storm-overlay");
  const overlayTitle = document.getElementById("storm-overlay-title");
  const overlaySub = document.getElementById("storm-overlay-sub");
  const overlayScore = document.getElementById("storm-overlay-score");
  const btnStart = document.getElementById("btn-start");
  const btnNew = document.getElementById("btn-new");
  const btnPause = document.getElementById("btn-pause");
  const btnAbility = document.getElementById("btn-ability");
  const btnRally = document.getElementById("btn-rally");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const squadList = document.getElementById("storm-squad-list");
  const mobileSquadList = document.getElementById("storm-mobile-squads");
  const mobileLaneList = document.getElementById("storm-mobile-lanes");
  const mobileSelected = document.getElementById("storm-mobile-selected");
  const mobileHype = document.getElementById("storm-mobile-hype");
  const mobileDeploy = document.getElementById("storm-mobile-deploy");
  const mobileRush = document.getElementById("storm-mobile-rush");
  const mobilePause = document.getElementById("storm-mobile-pause");
  const logEl = document.getElementById("storm-log");
  const el = {
    score: document.getElementById("storm-score"),
    phase: document.getElementById("storm-phase"),
    alertFill: document.getElementById("storm-alert-fill"),
    alertValue: document.getElementById("storm-alert-value"),
    hypeFill: document.getElementById("storm-hype-fill"),
    hypeValue: document.getElementById("storm-hype-value"),
    alien: document.getElementById("storm-alien"),
    best: document.getElementById("storm-best"),
    objective: document.getElementById("storm-objective"),
    tip: document.getElementById("storm-tip"),
  };

  const sheetMeta = { cols: 4, rows: 3 };
  const SPRITE = {
    runner: 0,
    streamer: 1,
    tinfoil: 2,
    sign: 3,
    alien: 4,
    van: 5,
    guard: 6,
    drone: 7,
    labDoor: 8,
    keycard: 9,
    boombox: 10,
    siren: 11,
  };

  const unitDefs = [
    {
      id: "runner",
      hotkey: "1",
      name: "Naruto Runner",
      short: "NR",
      color: C.cyan,
      sprite: SPRITE.runner,
      cost: 14,
      hp: 42,
      speed: 98,
      damage: 15,
      range: 28,
      attackRate: 0.62,
      desc: "Fast breach unit",
      role: "Slips past weak fire and shreds gates if protected.",
    },
    {
      id: "streamer",
      hotkey: "2",
      name: "Livestreamer",
      short: "LS",
      color: C.pink,
      sprite: SPRITE.streamer,
      cost: 17,
      hp: 76,
      speed: 62,
      damage: 9,
      range: 30,
      attackRate: 0.72,
      desc: "Decoy economy",
      role: "Pulls some targeting and generates Hype while alive.",
      hypeAura: 0.5,
      taunt: 1.35,
    },
    {
      id: "tinfoil",
      hotkey: "3",
      name: "Tinfoil Crew",
      short: "TF",
      color: C.yellow,
      sprite: SPRITE.tinfoil,
      cost: 22,
      hp: 68,
      speed: 52,
      damage: 6,
      range: 36,
      attackRate: 0.95,
      desc: "EMP support",
      role: "Jams towers, drones, and searchlights around the lane.",
      jamRadius: 158,
    },
    {
      id: "sign",
      hotkey: "4",
      name: "Sign Guy",
      short: "SG",
      color: C.green,
      sprite: SPRITE.sign,
      cost: 22,
      hp: 150,
      speed: 44,
      damage: 7,
      range: 26,
      attackRate: 0.82,
      desc: "Shield tank",
      role: "Soaks fire and gives nearby raiders cover.",
      shieldRadius: 108,
      taunt: 1.55,
    },
  ];

  const gateTemplates = [
    { x: 276, hp: 150, label: "Fence" },
    { x: 536, hp: 205, label: "Gate" },
    { x: 742, hp: 252, label: "Lab Shield" },
  ];

  const defenseTemplates = [
    { id: "n-guard-1", lane: 0, x: 358, y: 122, type: "guard", range: 146, fireRate: 1.08, damage: 15 },
    { id: "n-light-1", lane: 0, x: 624, y: 102, type: "light", range: 172, fireRate: 0.38, damage: 6.6 },
    { id: "n-siren-1", lane: 0, x: 842, y: 126, type: "siren", range: 154, fireRate: 0.84, damage: 10 },
    { id: "m-guard-1", lane: 1, x: 414, y: 242, type: "guard", range: 150, fireRate: 0.94, damage: 16 },
    { id: "m-drone-1", lane: 1, x: 608, y: 284, type: "drone", range: 166, fireRate: 0.66, damage: 12 },
    { id: "m-siren-1", lane: 1, x: 826, y: 248, type: "siren", range: 156, fireRate: 0.8, damage: 11 },
    { id: "s-light-1", lane: 2, x: 360, y: 450, type: "light", range: 162, fireRate: 0.38, damage: 6.2 },
    { id: "s-guard-1", lane: 2, x: 578, y: 436, type: "guard", range: 144, fireRate: 1.0, damage: 15 },
    { id: "s-drone-1", lane: 2, x: 770, y: 396, type: "drone", range: 158, fireRate: 0.72, damage: 11 },
  ];

  const images = {
    map: new Image(),
    sprites: new Image(),
  };

  const state = {
    mode: "intro",
    selected: "runner",
    selectedLane: 1,
    score: 0,
    best: 0,
    alert: 0,
    hype: 72,
    time: 0,
    labHp: LAB_MAX_HP,
    alienHp: 100,
    alien: null,
    units: [],
    gates: [],
    defenses: [],
    projectiles: [],
    effects: [],
    floats: [],
    sparks: [],
    spawnQueue: [],
    rushCd: 0,
    lanePulse: 0,
    guidancePulse: 0,
    nextUnitId: 1,
    banner: { text: "", ttl: 0, life: 0, color: C.ink },
    dirtyUi: true,
    hover: { active: false, x: 0, y: 0 },
  };

  let assetsReady = false;
  let running = false;
  let paused = false;
  let lastT = 0;
  let raf = 0;

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(a, b, c, d) { return Math.hypot(a - c, b - d); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function fmt(n) { return Math.max(0, Math.round(n)).toLocaleString(); }

  function loadImage(img, src) {
    return new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  function resetGame() {
    if (logEl) logEl.innerHTML = "";
    state.mode = "intro";
    state.selected = "runner";
    state.selectedLane = 1;
    state.score = 0;
    state.best = Number(api.getHighScore(GAME_ID) || 0);
    state.alert = 0;
    state.hype = 72;
    state.time = 0;
    state.labHp = LAB_MAX_HP;
    state.alienHp = 100;
    state.alien = null;
    state.units = [];
    state.gates = [];
    state.defenses = [];
    state.projectiles = [];
    state.effects = [];
    state.floats = [];
    state.sparks = [];
    state.spawnQueue = [];
    state.rushCd = 0;
    state.lanePulse = 0;
    state.guidancePulse = 0;
    state.nextUnitId = 1;
    state.banner = { text: "", ttl: 0, life: 0, color: C.ink };
    LANES.forEach((lane) => {
      gateTemplates.forEach((gate, i) => {
        state.gates.push({
          id: `${lane.id}-${i}`,
          lane: lane.id,
          x: gate.x,
          y: lane.y,
          hp: gate.hp,
          maxHp: gate.hp,
          label: gate.label,
          tier: i,
          breached: false,
          shake: 0,
        });
      });
    });
    state.defenses = defenseTemplates.map((d) => ({
      ...d,
      hp: d.type === "siren" ? 74 : d.type === "drone" ? 62 : 82,
      maxHp: d.type === "siren" ? 74 : d.type === "drone" ? 62 : 82,
      cd: 0.6 + Math.random() * 0.55,
      jammed: 0,
      sweep: Math.random() * Math.PI * 2,
    }));
    paused = false;
    running = false;
    setOverlay(
      "Raid The Base",
      "Reverse tower defense chaos. Spend Hype to send squads down three lanes, crack two lab shields, overwhelm the lab, then escort the alien to the van before lockdown.",
      "Start raid"
    );
    log("The raid formed up outside three very official-looking fences.");
    markDirty();
    updateUi();
  }

  function startGame() {
    if (!assetsReady) return;
    const preservedSelection = state.selected;
    const preservedLane = state.selectedLane;
    resetGame();
    state.selected = preservedSelection;
    state.selectedLane = preservedLane;
    state.mode = "playing";
    running = true;
    paused = false;
    hideOverlay();
    log("Raid started. Pick a lane, deploy squads, and bury the base in bad decisions.");
    markDirty();
  }

  function setOverlay(title, sub, button, scoreHtml) {
    overlayTitle.textContent = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnStart.textContent = button;
    overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    overlay.classList.remove("overlay--show");
    window.scrollTo(0, 0);
    canvas.focus({ preventScroll: true });
  }

  function endGame(won, reason) {
    if (state.mode === "won" || state.mode === "lost") return;
    state.mode = won ? "won" : "lost";
    running = false;
    paused = false;
    if (won) {
      const alertBonus = Math.round((100 - state.alert) * 92);
      const timeBonus = Math.max(0, Math.round(12000 - state.time * 82));
      const unitBonus = state.units.filter((u) => u.alive).length * 275;
      state.score += alertBonus + timeBonus + unitBonus + 5000;
      addFloat("ALIEN EXTRACTED", VAN_X - 24, LANES[1].y - 80, C.green);
      log("The alien reached the van. Everyone pretends this was always the plan.");
    } else {
      log(reason || "The base hit lockdown.");
    }
    const high = api.recordScore(GAME_ID, state.score);
    state.best = Math.max(state.best, state.score);
    updateUi();
    setOverlay(
      won ? "Alien Secured" : "Raid Crashed",
      won
        ? "The alien is in the van, the convoy escaped, and the base is still trying to understand the livestream."
        : (reason || "Lockdown hit 100%. The raid has become a cautionary slideshow."),
      "Run it back",
      `Score: <strong>${fmt(state.score)}</strong>${high ? " · New high score" : ""}<br>Lockdown: <strong>${Math.round(state.alert)}%</strong> · Hype: <strong>${Math.round(state.hype)}%</strong>`
    );
  }

  function togglePause() {
    if (state.mode !== "playing") return;
    paused = !paused;
    running = !paused;
    if (paused) {
      setOverlay("Paused", "Three lanes of nonsense are holding position.", "Resume");
    } else {
      hideOverlay();
      lastT = performance.now();
    }
    markDirty();
  }

  function selectedUnitDef() {
    return unitDefs.find((u) => u.id === state.selected) || unitDefs[0];
  }

  function selectSquad(id) {
    if (!unitDefs.some((u) => u.id === id)) return;
    state.selected = id;
    state.guidancePulse = 2.2;
    bumpBanner(`${selectedUnitDef().name}: click a lane`, selectedUnitDef().color, 1.35);
    markDirty();
    updateUi();
  }

  function setLane(laneId) {
    state.selectedLane = clamp(Number(laneId), 0, LANES.length - 1);
    state.lanePulse = 0.6;
    markDirty();
  }

  function laneFromY(y) {
    return LANES.reduce((best, lane) => {
      const bd = Math.abs(best.y - y);
      const ld = Math.abs(lane.y - y);
      return ld < bd ? lane : best;
    }, LANES[0]).id;
  }

  function deploySelected(laneId) {
    if (state.mode !== "playing" || paused) return false;
    const def = selectedUnitDef();
    const lane = laneId === undefined ? state.selectedLane : laneId;
    if (state.hype < def.cost) {
      bumpBanner(`Need ${def.cost} hype`, C.yellow);
      playBlip(150, 0.07, "sawtooth");
      return false;
    }
    state.hype = clamp(state.hype - def.cost, 0, 100);
    spawnUnit(def.id, lane, 0);
    addEffect("deploy", SPAWN_X + 18, LANES[lane].y, def.color);
    playBlip(440 + lane * 90, 0.08, "square");
    markDirty();
    return true;
  }

  function queueRush() {
    if (state.mode !== "playing" || paused) return;
    const total = unitDefs.reduce((sum, u) => sum + Math.max(8, u.cost - 5), 0);
    if (state.rushCd > 0) {
      bumpBanner("Rush wave cooling down", C.yellow);
      return;
    }
    if (state.hype < total) {
      bumpBanner(`Need ${total} hype for rush`, C.yellow);
      return;
    }
    state.hype = clamp(state.hype - total, 0, 100);
    state.rushCd = 14;
    unitDefs.forEach((u, i) => {
      state.spawnQueue.push({ unitId: u.id, lane: (state.selectedLane + i) % LANES.length, delay: i * 0.24 });
    });
    bumpBanner("Rush wave queued", C.green);
    log("A whole wave surged forward. The group chat briefly became useful.");
    playBlip(720, 0.12, "triangle");
    markDirty();
  }

  function spawnUnit(unitId, laneId, delay) {
    const def = unitDefs.find((u) => u.id === unitId);
    const lane = LANES[laneId] || LANES[1];
    if (!def) return null;
    const unit = {
      ...def,
      uid: state.nextUnitId++,
      lane: lane.id,
      x: SPAWN_X - 18 - Math.random() * 12,
      y: lane.y + (Math.random() * 18 - 9),
      laneY: lane.y,
      hp: def.hp,
      maxHp: def.hp,
      attackCd: 0.15 + Math.random() * 0.2,
      alive: true,
      entered: false,
      bob: Math.random() * Math.PI * 2,
      delay: delay || 0,
      shielded: false,
      jamPulse: 0,
      hitFlash: 0,
    };
    state.units.push(unit);
    return unit;
  }

  function log(text) {
    if (!logEl) return;
    const li = document.createElement("li");
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 6) logEl.removeChild(logEl.lastChild);
  }

  function bumpBanner(text, color, ttl) {
    state.banner = { text, color: color || C.ink, ttl: ttl || 1.35, life: ttl || 1.35 };
  }

  function addScore(pointsToAdd, label, x, y, color) {
    state.score = Math.max(0, state.score + pointsToAdd);
    addFloat(`${pointsToAdd >= 0 ? "+" : ""}${pointsToAdd} ${label || ""}`.trim(), x, y, color || C.yellow);
    markDirty();
  }

  function addFloat(text, x, y, color) {
    state.floats.push({ text, x, y, vy: -24, ttl: 1.2, life: 1.2, color: color || C.ink });
  }

  function addEffect(type, x, y, color, extra) {
    state.effects.push({ type, x, y, color: color || C.cyan, ttl: 0.72, life: 0.72, r: 8, ...extra });
  }

  function update(dt) {
    if (state.mode !== "playing" || paused) return;
    state.time += dt;
    state.rushCd = Math.max(0, state.rushCd - dt);
    state.lanePulse = Math.max(0, state.lanePulse - dt);
    state.guidancePulse = Math.max(0, state.guidancePulse - dt);
    if (state.banner.ttl > 0) state.banner.ttl -= dt;

    updateSpawnQueue(dt);
    updateEconomy(dt);
    updateAuras(dt);
    updateUnits(dt);
    updateDefenses(dt);
    updateProjectiles(dt);
    updateAlien(dt);
    updateEffects(dt);
    updateWinLoss();
    markDirty();
  }

  function updateSpawnQueue(dt) {
    state.spawnQueue.forEach((item) => {
      item.delay -= dt;
    });
    const ready = state.spawnQueue.filter((item) => item.delay <= 0);
    state.spawnQueue = state.spawnQueue.filter((item) => item.delay > 0);
    ready.forEach((item) => {
      spawnUnit(item.unitId, item.lane, 0);
      addEffect("deploy", SPAWN_X + 18, LANES[item.lane].y, unitDefs.find((u) => u.id === item.unitId).color);
    });
  }

  function updateEconomy(dt) {
    const streamerGain = state.units
      .filter((u) => u.alive && u.id === "streamer" && u.delay <= 0)
      .reduce((sum, u) => sum + (u.hypeAura || 0), 0);
    const pressureGain = state.labHp <= 0 ? 0.36 : (LAB_MAX_HP - state.labHp) * 0.0028;
    state.hype = clamp(state.hype + (4.45 + streamerGain + pressureGain) * dt, 0, 100);
    const sirenPressure = state.defenses.filter((d) => d.type === "siren" && d.hp > 0 && d.jammed <= 0).length * 0.05;
    const fieldPressure = Math.max(0, state.units.filter((u) => u.alive).length - 7) * 0.025;
    state.alert = clamp(state.alert + (0.78 + sirenPressure + fieldPressure) * dt, 0, 100);
  }

  function updateAuras(dt) {
    state.units.forEach((u) => {
      u.shielded = false;
      u.jamPulse = Math.max(0, u.jamPulse - dt);
      u.hitFlash = Math.max(0, u.hitFlash - dt);
    });

    const signs = state.units.filter((u) => u.alive && u.id === "sign" && u.delay <= 0);
    state.units.forEach((u) => {
      if (!u.alive || u.delay > 0) return;
      u.shielded = signs.some((s) => s.uid !== u.uid && s.lane === u.lane && Math.abs(s.x - u.x) < s.shieldRadius);
    });

    const jammers = state.units.filter((u) => u.alive && u.id === "tinfoil" && u.delay <= 0);
    state.defenses.forEach((d) => {
      if (d.hp <= 0) return;
      if (jammers.some((u) => dist(u.x, u.y, d.x, d.y) < u.jamRadius)) {
        d.jammed = Math.max(d.jammed, 0.28);
      } else {
        d.jammed = Math.max(0, d.jammed - dt);
      }
    });
  }

  function updateUnits(dt) {
    state.units.forEach((u) => {
      if (!u.alive) return;
      if (u.delay > 0) {
        u.delay -= dt;
        return;
      }
      u.bob += dt * (5 + u.speed * 0.015);
      u.y = lerp(u.y, u.laneY + Math.sin(u.bob) * 3.5, 0.12);
      u.attackCd = Math.max(0, u.attackCd - dt);

      const target = nearestLaneTarget(u);
      if (target && Math.abs(target.x - u.x) <= u.range + target.hitRadius) {
        attackTarget(u, target);
      } else {
        const speedBoost = state.alien && state.alien.escaped ? 0.8 : 1;
        u.x += u.speed * speedBoost * dt;
      }

      if (u.x > LAB_X - 30 && state.labHp > 0) {
        damageLab(u.damage * 0.32 * dt, u);
      }
    });
    state.units = state.units.filter((u) => u.alive || u.hitFlash > -0.4);
  }

  function nearestLaneTarget(u) {
    const gate = state.gates.find((g) => g.lane === u.lane && !g.breached && g.x > u.x - 12);
    if (gate) return { kind: "gate", ref: gate, x: gate.x, y: gate.y, hitRadius: 34 };
    if (state.labHp > 0) return { kind: "lab", ref: null, x: LAB_X, y: LANES[1].y, hitRadius: 62 };
    if (state.alien && !state.alien.escaped && u.x < state.alien.x - 26) return null;
    return null;
  }

  function attackTarget(u, target) {
    if (u.attackCd > 0) return;
    u.attackCd = u.attackRate;
    if (target.kind === "gate") {
      target.ref.hp = clamp(target.ref.hp - u.damage, 0, target.ref.maxHp);
      target.ref.shake = 0.22;
      addEffect("hit", target.ref.x, target.ref.y - 16, u.color, { r: 10 });
      if (target.ref.hp <= 0 && !target.ref.breached) {
        target.ref.breached = true;
        addScore(260 + target.ref.tier * 130, "BREACH", target.ref.x, target.ref.y - 48, C.yellow);
        if (target.ref.tier === 2) {
          const shields = labShieldBreaches();
          if (shields >= LAB_SHIELDS_REQUIRED) {
            bumpBanner("Lab core exposed", C.green, 1.55);
            log("Two lab shields are down. Now the lab core can take real damage.");
          } else {
            bumpBanner(`Lab shields ${shields}/${LAB_SHIELDS_REQUIRED}`, C.pink, 1.55);
            log("One lab shield is down. Push another lane to expose the lab core.");
          }
        } else {
          bumpBanner(`${target.ref.label} breached`, LANES[target.ref.lane].color);
        }
        if (state.gates.filter((g) => g.breached).length === 3) log("First lane cracked open. Keep the pressure rolling.");
        playBlip(620 + target.ref.tier * 90, 0.08, "square");
      }
    } else if (target.kind === "lab") {
      damageLab(u.damage * 0.9, u);
    }
  }

  function damageLab(amount, source) {
    if (state.labHp <= 0) return;
    if (!labCoreExposed()) {
      if (state.banner.ttl <= 0.05) bumpBanner(`Break ${LAB_SHIELDS_REQUIRED} lab shields first`, C.pink, 1.15);
      addEffect("lab-hit", LAB_X, LANES[1].y - 8, C.pink, { r: 12 });
      return;
    }
    state.labHp = clamp(state.labHp - amount, 0, LAB_MAX_HP);
    addEffect("lab-hit", LAB_X, LANES[1].y - 8, source ? source.color : C.cyan, { r: 14 });
    if (state.labHp <= 0) {
      state.labHp = 0;
      state.alert = clamp(state.alert - 6, 0, 100);
      addScore(1800, "LAB OPEN", LAB_X, LANES[1].y - 74, C.green);
      spawnAlien();
      log("The lab cracked open. Escort the alien to the van.");
      bumpBanner("Alien liberated", C.green, 1.8);
      playBlip(980, 0.16, "sine");
    }
  }

  function spawnAlien() {
    state.alien = {
      x: LAB_X - 10,
      y: LANES[1].y + 24,
      hp: 100,
      maxHp: 100,
      speed: 43,
      escaped: false,
      panic: 0,
      bob: 0,
      hitFlash: 0,
    };
  }

  function updateDefenses(dt) {
    state.defenses.forEach((d) => {
      if (d.hp <= 0) return;
      d.sweep += dt * (d.type === "light" ? 1.4 : 0.75);
      d.cd = Math.max(0, d.cd - dt);
      if (d.jammed > 0) {
        d.cd = Math.max(d.cd, 0.18);
        return;
      }
      const target = chooseDefenseTarget(d);
      if (target && d.cd <= 0) {
        fireDefense(d, target);
        d.cd = d.fireRate;
      }
    });
  }

  function chooseDefenseTarget(d) {
    const candidates = state.units.filter((u) => u.alive && u.delay <= 0 && Math.abs(u.y - d.y) < 96 && dist(u.x, u.y, d.x, d.y) < d.range);
    if (state.alien && !state.alien.escaped && dist(state.alien.x, state.alien.y, d.x, d.y) < d.range * 0.82) {
      candidates.push({ ...state.alien, isAlien: true, uid: "alien", taunt: 1.1, shielded: false });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ta = a.taunt || 1;
      const tb = b.taunt || 1;
      const scoreA = a.x + ta * 42 - (a.shielded ? 24 : 0);
      const scoreB = b.x + tb * 42 - (b.shielded ? 24 : 0);
      return scoreB - scoreA;
    });
    return candidates[0];
  }

  function fireDefense(d, target) {
    const color = d.type === "siren" ? C.red : d.type === "drone" ? C.pink : d.type === "light" ? C.yellow : C.blue;
    state.projectiles.push({
      x: d.x,
      y: d.y,
      tx: target.x,
      ty: target.y,
      targetUid: target.uid,
      alien: !!target.isAlien,
      damage: d.damage,
      color,
      ttl: d.type === "light" ? 0.12 : 0.36,
      life: d.type === "light" ? 0.12 : 0.36,
      beam: d.type === "light",
    });
    if (d.type === "siren") state.alert = clamp(state.alert + 0.25, 0, 100);
  }

  function updateProjectiles(dt) {
    state.projectiles.forEach((p) => {
      p.ttl -= dt;
      if (p.ttl <= 0 && !p.done) {
        p.done = true;
        applyProjectileHit(p);
      }
    });
    state.projectiles = state.projectiles.filter((p) => p.ttl > -0.05 && !p.done);
  }

  function applyProjectileHit(p) {
    if (p.alien && state.alien && !state.alien.escaped) {
      damageAlien(p.damage * 0.7);
      addEffect("hit", state.alien.x, state.alien.y - 20, p.color, { r: 9 });
      return;
    }
    const target = state.units.find((u) => u.uid === p.targetUid && u.alive);
    if (!target) return;
    let damage = p.damage;
    if (target.shielded) damage *= 0.58;
    if (target.id === "sign") damage *= 0.68;
    target.hp = clamp(target.hp - damage, 0, target.maxHp);
    target.hitFlash = 0.18;
    addEffect("hit", target.x, target.y - 22, p.color, { r: 8 });
    if (target.hp <= 0) {
      target.alive = false;
      target.hitFlash = -0.8;
      addFloat("DOWN", target.x, target.y - 44, C.red);
      state.alert = clamp(state.alert + 1.3, 0, 100);
    }
  }

  function damageAlien(amount) {
    if (!state.alien || state.alien.escaped) return;
    state.alien.hp = clamp(state.alien.hp - amount, 0, state.alien.maxHp);
    state.alien.hitFlash = 0.2;
    state.alien.panic = 0.65;
    if (state.alien.hp <= 0) {
      endGame(false, "The alien got pinned down before reaching the van.");
    }
  }

  function updateAlien(dt) {
    if (!state.alien || state.alien.escaped) return;
    state.alien.bob += dt * 5.8;
    state.alien.hitFlash = Math.max(0, state.alien.hitFlash - dt);
    state.alien.panic = Math.max(0, state.alien.panic - dt * 0.8);
    const escortCount = state.units.filter((u) => u.alive && dist(u.x, u.y, state.alien.x, state.alien.y) < 128).length;
    const speed = state.alien.speed + Math.min(32, escortCount * 7) - state.alien.panic * 16;
    state.alien.x += Math.max(22, speed) * dt;
    state.alien.y = lerp(state.alien.y, LANES[1].y + 20 + Math.sin(state.alien.bob) * 3, 0.1);
    if (state.alien.x >= VAN_X - 28) {
      state.alien.escaped = true;
      addScore(2600, "EXTRACT", VAN_X - 40, LANES[1].y - 84, C.green);
      endGame(true);
    }
  }

  function updateEffects(dt) {
    state.gates.forEach((g) => {
      g.shake = Math.max(0, g.shake - dt);
    });
    state.effects = state.effects
      .map((e) => ({ ...e, ttl: e.ttl - dt, r: e.r + dt * 76 }))
      .filter((e) => e.ttl > 0);
    state.floats = state.floats
      .map((f) => ({ ...f, ttl: f.ttl - dt, y: f.y + f.vy * dt }))
      .filter((f) => f.ttl > 0);
  }

  function updateWinLoss() {
    if (state.alert >= 100) {
      state.alert = 100;
      endGame(false, "Lockdown hit 100%. The base closed every gate at once.");
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawMap();
    drawLaneGrid();
    drawDefenses();
    drawGates();
    drawLab();
    drawVan();
    drawProjectiles();
    drawUnits();
    drawAlien();
    drawEffects();
    drawLanePicker();
    drawBanner();
    if (!assetsReady) drawLoading();
  }

  function drawMap() {
    ctx.fillStyle = "#030814";
    ctx.fillRect(0, 0, W, H);
    if (images.map.complete && images.map.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.filter = "saturate(0.62) contrast(0.82) brightness(0.74) blur(0.35px)";
      ctx.drawImage(images.map, 0, 0, W, H);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#07182c");
      g.addColorStop(1, "#09040f");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = "rgba(1, 4, 12, 0.46)";
    ctx.fillRect(0, 0, W, H);
    const vignette = ctx.createRadialGradient(W * 0.52, H * 0.5, 80, W * 0.52, H * 0.5, 560);
    vignette.addColorStop(0, "rgba(46, 224, 255, 0.03)");
    vignette.addColorStop(0.58, "rgba(3, 6, 17, 0.3)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.72)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawLaneGrid() {
    drawObjectiveGuide();
    LANES.forEach((lane, i) => {
      const selected = state.selectedLane === lane.id;
      ctx.save();
      ctx.globalAlpha = selected ? 0.64 : 0.3;
      const grad = ctx.createLinearGradient(SPAWN_X, lane.y, EXIT_X, lane.y);
      grad.addColorStop(0, `${lane.color}11`);
      grad.addColorStop(0.5, `${lane.color}2e`);
      grad.addColorStop(1, `${lane.color}10`);
      ctx.fillStyle = grad;
      roundRect(ctx, 38, lane.y - 42, 884, 84, 12);
      ctx.fill();
      ctx.strokeStyle = selected ? lane.color : "rgba(255,255,255,0.15)";
      ctx.lineWidth = selected ? 3 : 1;
      ctx.setLineDash(selected ? [16, 12] : []);
      ctx.lineDashOffset = -state.time * 22;
      ctx.beginPath();
      ctx.moveTo(SPAWN_X, lane.y);
      ctx.lineTo(EXIT_X, lane.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = selected ? lane.color : "rgba(251,250,244,0.72)";
      ctx.font = "900 11px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 8;
      ctx.fillText(`${i + 1} ${lane.name}`, 48, lane.y - 49);
      if (selected) {
        ctx.fillStyle = lane.color;
        ctx.font = "900 9px JetBrains Mono, monospace";
        ctx.fillText("CLICK LANE TO SEND SELECTED SQUAD", 70, lane.y + 33);
      }
      ctx.restore();
    });

    ctx.save();
    ctx.globalAlpha = 0.12 + Math.sin(state.time * 4) * 0.025;
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.arc(LAB_X + 24, LANES[1].y - 10, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawObjectiveGuide() {
    const objective = currentObjective();
    ctx.save();
    ctx.fillStyle = "rgba(3, 6, 17, 0.78)";
    ctx.strokeStyle = "rgba(46, 224, 255, 0.36)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 520, 22, 382, 42, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.green;
    ctx.font = "900 10px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(objective.title.toUpperCase(), 536, 40);
    ctx.fillStyle = C.dim;
    ctx.font = "700 9px JetBrains Mono, monospace";
    ctx.fillText(shortTip(objective.tip), 536, 55);

    const steps = [
      { x: 272, y: 88, text: "1 BREAK 2 LANES", color: C.yellow },
      { x: LAB_X + 38, y: 88, text: "2 CRACK LAB", color: C.pink },
      { x: VAN_X - 12, y: LANES[1].y + 166, text: "3 ESCAPE VAN", color: C.green },
    ];
    steps.forEach((step) => {
      ctx.fillStyle = "rgba(3, 6, 17, 0.72)";
      ctx.strokeStyle = step.color;
      roundRect(ctx, step.x - 58, step.y - 16, 116, 26, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = step.color;
      ctx.font = "900 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(step.text, step.x, step.y + 1);
    });
    ctx.restore();
  }

  function shortTip(text) {
    return text.length > 54 ? `${text.slice(0, 51)}...` : text;
  }

  function drawGates() {
    state.gates.forEach((g) => {
      if (g.breached) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 7]);
        ctx.beginPath();
        ctx.arc(g.x, g.y, 25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }
      const lane = LANES[g.lane];
      const shake = g.shake > 0 ? Math.sin(state.time * 70) * 3 : 0;
      ctx.save();
      ctx.translate(g.x + shake, g.y);
      ctx.fillStyle = "rgba(4, 8, 18, 0.88)";
      ctx.strokeStyle = g.tier === 2 ? C.pink : lane.color;
      ctx.lineWidth = 3;
      roundRect(ctx, -18, -40, 36, 80, 6);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = C.yellow;
      for (let y = -38; y < 40; y += 16) ctx.fillRect(-16, y, 32, 5);
      ctx.globalAlpha = 1;
      drawHealthBar(-25, -52, 50, 6, g.hp / g.maxHp, lane.color);
      ctx.fillStyle = C.ink;
      ctx.font = "800 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 6;
      ctx.fillText(g.label.toUpperCase(), 0, 55);
      ctx.restore();
    });
  }

  function drawDefenses() {
    state.defenses.forEach((d) => {
      if (d.hp <= 0) return;
      const color = d.jammed > 0 ? C.cyan : d.type === "siren" ? C.red : d.type === "drone" ? C.pink : d.type === "light" ? C.yellow : C.blue;
      ctx.save();
      if (d.type === "light") {
        ctx.translate(d.x, d.y);
        ctx.rotate(Math.sin(d.sweep) * 0.32 + (d.lane - 1) * 0.16 + Math.PI / 2);
        ctx.globalAlpha = d.jammed > 0 ? 0.08 : 0.13;
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, d.range);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "rgba(255, 212, 59, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, d.range, -0.25, 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.rotate(-Math.sin(d.sweep) * 0.32 - (d.lane - 1) * 0.16 - Math.PI / 2);
        ctx.translate(-d.x, -d.y);
      }
      drawDefenseRange(d, color);
      ctx.globalAlpha = 1;
      if (d.type === "drone") {
        drawSprite(SPRITE.drone, d.x, d.y + Math.sin(state.time * 4 + d.x) * 5, 66, 50);
      } else if (d.type === "siren") {
        drawSprite(SPRITE.siren, d.x, d.y, 58, 54);
      } else {
        drawSprite(SPRITE.guard, d.x, d.y, 58, 68);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = d.jammed > 0 ? 0.6 : 0.22;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.type === "light" ? 34 : 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (d.hp < d.maxHp || d.jammed > 0) drawHealthBar(d.x - 23, d.y - 42, 46, 5, d.hp / d.maxHp, color);
      drawDefenseTag(d, color);
      if (d.jammed > 0) {
        ctx.fillStyle = C.cyan;
        ctx.font = "900 9px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 5;
        ctx.fillText("JAM", d.x, d.y - 49);
      }
      ctx.restore();
    });
  }

  function drawDefenseRange(d, color) {
    if (d.jammed <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = color;
    ctx.lineWidth = d.type === "siren" ? 2 : 1.5;
    ctx.setLineDash(d.type === "drone" ? [4, 7] : [8, 9]);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.range * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDefenseTag(d, color) {
    const labels = {
      guard: "GUARD",
      drone: "DRONE",
      light: "LIGHT",
      siren: "SIREN",
    };
    ctx.save();
    ctx.fillStyle = "rgba(3, 6, 17, 0.64)";
    ctx.strokeStyle = `${color}cc`;
    ctx.lineWidth = 1.5;
    const label = labels[d.type] || "ENEMY";
    const w = d.type === "light" ? 48 : 54;
    roundRect(ctx, d.x - w / 2, d.y - 62, w, 18, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "900 8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 5;
    ctx.fillText(label, d.x, d.y - 50);
    ctx.restore();
  }

  function drawLab() {
    ctx.save();
    const broken = state.labHp <= 0;
    ctx.translate(LAB_X + 38, LANES[1].y - 4);
    ctx.fillStyle = broken ? "rgba(11, 31, 16, 0.72)" : "rgba(14, 10, 28, 0.86)";
    ctx.strokeStyle = broken ? C.green : C.pink;
    ctx.lineWidth = 3;
    roundRect(ctx, -54, -72, 108, 144, 10);
    ctx.fill();
    ctx.stroke();
    drawSprite(SPRITE.labDoor, 0, 6, 84, 108);
    ctx.globalAlpha = broken ? 0.35 : 0.62 + Math.sin(state.time * 4) * 0.08;
    ctx.strokeStyle = broken ? C.green : C.pink;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawHealthBar(-48, -88, 96, 7, state.labHp / LAB_MAX_HP, broken ? C.green : C.pink);
    ctx.fillStyle = broken ? C.green : C.pink;
    ctx.font = "900 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 7;
    const shields = labShieldBreaches();
    ctx.fillText(broken ? "LAB OPEN" : labCoreExposed() ? "LAB CORE EXPOSED" : `SHIELDS ${shields}/${LAB_SHIELDS_REQUIRED}`, 0, -98);
    ctx.restore();
  }

  function drawVan() {
    ctx.save();
    ctx.globalAlpha = state.alien ? 1 : 0.78;
    drawObjectiveGlow(VAN_X - 12, LANES[1].y + 90, state.alien ? C.green : C.cyan, 48);
    drawSprite(SPRITE.van, VAN_X - 12, LANES[1].y + 90, 112, 80);
    ctx.fillStyle = state.alien ? C.green : C.dim;
    ctx.font = "900 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 7;
    ctx.fillText("VAN", VAN_X - 12, LANES[1].y + 142);
    ctx.restore();
  }

  function drawUnits() {
    state.units
      .filter((u) => u.alive && u.delay <= 0)
      .slice()
      .sort((a, b) => a.y - b.y)
      .forEach((u) => {
        ctx.save();
        if (u.shielded) {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = C.green;
          ctx.beginPath();
          ctx.ellipse(u.x, u.y + 16, 40, 18, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (u.id === "tinfoil") {
          ctx.globalAlpha = 0.16 + Math.sin(state.time * 6 + u.uid) * 0.04;
          ctx.strokeStyle = C.yellow;
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.arc(u.x, u.y, u.jamRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = u.hitFlash > 0 ? "rgba(255, 79, 104, 0.26)" : "rgba(0, 0, 0, 0.26)";
        ctx.beginPath();
        ctx.ellipse(u.x, u.y + 25, 25, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        if (u.hitFlash > 0) {
          ctx.shadowColor = C.red;
          ctx.shadowBlur = 16;
        } else {
          ctx.shadowColor = u.color;
          ctx.shadowBlur = 10;
        }
        const scale = u.id === "sign" ? 1.08 : 1;
        drawSprite(u.sprite, u.x, u.y, 64 * scale, 78 * scale);
        ctx.shadowBlur = 0;
        drawHealthBar(u.x - 22, u.y - 42, 44, 5, u.hp / u.maxHp, u.color);
        ctx.fillStyle = u.color;
        ctx.font = "900 9px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 5;
        ctx.fillText(u.short, u.x, u.y - 49);
        ctx.restore();
      });
  }

  function drawAlien() {
    if (!state.alien) {
      if (state.labHp <= 0) return;
      ctx.save();
      ctx.globalAlpha = 0.45 + Math.sin(state.time * 5) * 0.08;
      drawSprite(SPRITE.alien, LAB_X + 36, LANES[1].y - 2, 54, 66);
      ctx.restore();
      return;
    }
    if (state.alien.escaped) return;
    ctx.save();
    drawObjectiveGlow(state.alien.x, state.alien.y, C.green, 48);
    if (state.alien.hitFlash > 0) {
      ctx.shadowColor = C.red;
      ctx.shadowBlur = 18;
    } else {
      ctx.shadowColor = C.green;
      ctx.shadowBlur = 16;
    }
    drawSprite(SPRITE.alien, state.alien.x, state.alien.y + Math.sin(state.alien.bob) * 2, 62, 76);
    drawHealthBar(state.alien.x - 27, state.alien.y - 43, 54, 6, state.alien.hp / state.alien.maxHp, C.green);
    ctx.restore();
  }

  function drawProjectiles() {
    state.projectiles.forEach((p) => {
      const t = clamp(p.ttl / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = p.beam ? 0.42 : 0.85 * easeOut(t);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.beam ? 5 : 3;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.tx, p.ty);
      ctx.stroke();
      if (!p.beam) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(lerp(p.tx, p.x, t), lerp(p.ty, p.y, t), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawEffects() {
    state.effects.forEach((e) => {
      const t = clamp(e.ttl / e.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = easeOut(t);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.type === "deploy" ? 4 : 3;
      if (e.type === "deploy") {
        ctx.setLineDash([6, 8]);
      }
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    state.floats.forEach((f) => {
      const t = clamp(f.ttl / f.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = easeOut(t);
      ctx.fillStyle = f.color;
      ctx.font = "900 14px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
  }

  function drawLanePicker() {
    ctx.save();
    LANES.forEach((lane, i) => {
      const selected = state.selectedLane === lane.id;
      const x = 48 + i * 58;
      const y = 42;
      ctx.fillStyle = selected ? "rgba(3, 6, 17, 0.92)" : "rgba(3, 6, 17, 0.56)";
      ctx.strokeStyle = selected ? lane.color : "rgba(255,255,255,0.2)";
      ctx.lineWidth = selected ? 2.5 : 1.5;
      roundRect(ctx, x, y, 44, 30, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = selected ? lane.color : C.dim;
      ctx.font = "900 13px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x + 22, y + 20);
    });
    const def = selectedUnitDef();
    ctx.fillStyle = "rgba(3, 6, 17, 0.74)";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 228, 42, 232, 30, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = "900 11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`DEPLOY: ${def.name.toUpperCase()} / ${LANES[state.selectedLane].name.toUpperCase()}`, 242, 61);
    ctx.restore();
  }

  function drawBanner() {
    if (state.banner.ttl <= 0 || !state.banner.text) return;
    const t = clamp(state.banner.ttl / state.banner.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = easeOut(t);
    ctx.fillStyle = "rgba(3, 6, 17, 0.78)";
    ctx.strokeStyle = state.banner.color;
    ctx.lineWidth = 2;
    roundRect(ctx, W / 2 - 176, 92, 352, 42, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = state.banner.color;
    ctx.font = "900 15px Bungee, system-ui";
    ctx.textAlign = "center";
    ctx.fillText(state.banner.text, W / 2, 119);
    ctx.restore();
  }

  function drawLoading() {
    ctx.save();
    ctx.fillStyle = "rgba(3, 6, 17, 0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.cyan;
    ctx.font = "900 18px Bungee, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Loading raid assets", W / 2, H / 2);
    ctx.restore();
  }

  function drawHealthBar(x, y, w, h, pct, color) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.42 ? color : pct > 0.18 ? C.yellow : C.red;
    ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawObjectiveGlow(x, y, color, r) {
    ctx.save();
    const grad = ctx.createRadialGradient(x, y, 4, x, y, r);
    grad.addColorStop(0, `${color}70`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSprite(index, x, y, w, h) {
    if (!images.sprites.complete || !images.sprites.naturalWidth) {
      drawFallbackSprite(index, x, y, w, h);
      return;
    }
    const sw = images.sprites.naturalWidth / sheetMeta.cols;
    const sh = images.sprites.naturalHeight / sheetMeta.rows;
    const col = index % sheetMeta.cols;
    const row = Math.floor(index / sheetMeta.cols);
    ctx.drawImage(images.sprites, col * sw, row * sh, sw, sh, x - w / 2, y - h / 2, w, h);
  }

  function drawFallbackSprite(index, x, y, w, h) {
    const colors = [C.cyan, C.pink, C.yellow, C.green, C.green, "#d7c49a", "#cfd6df", C.pink, "#7e879b", C.yellow, C.purple, C.red];
    ctx.save();
    ctx.fillStyle = colors[index] || C.ink;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.32, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function updateUi() {
    if (!state.dirtyUi) return;
    state.dirtyUi = false;
    el.score.textContent = fmt(state.score);
    el.best.textContent = fmt(state.best);
    el.alertFill.style.width = `${Math.round(state.alert)}%`;
    el.alertValue.textContent = `${Math.round(state.alert)}%`;
    el.hypeFill.style.width = `${Math.round(state.hype)}%`;
    el.hypeValue.textContent = `${Math.round(state.hype)}%`;
    el.phase.textContent = phaseLabel();
    el.alien.textContent = state.alien && state.alien.escaped ? "FREE" : state.alien ? "ESCORT" : state.labHp <= 0 ? "LOOSE" : "CAPTIVE";
    const obj = currentObjective();
    el.objective.textContent = obj.title;
    el.tip.textContent = obj.tip;
    renderSquadList();
    const def = selectedUnitDef();
    btnAbility.textContent = `Deploy (${def.cost})`;
    btnAbility.disabled = state.mode !== "playing" || paused || state.hype < def.cost;
    btnRally.textContent = state.rushCd > 0 ? `Rush ${Math.ceil(state.rushCd)}s` : "Rush wave";
    btnRally.disabled = state.mode !== "playing" || paused || state.rushCd > 0 || state.hype < rushCost();
    btnPause.textContent = paused ? "Resume" : "Pause";
    renderMobileControls(def);
  }

  function phaseLabel() {
    if (state.mode === "won") return "ESCAPE";
    if (state.mode === "lost") return "LOCKDOWN";
    if (state.alien) return state.alien.escaped ? "ESCAPE" : "ESCORT";
    if (state.labHp <= 0) return "ESCORT";
    if (state.labHp < LAB_MAX_HP) return "LAB";
    const breached = state.gates.filter((g) => g.breached).length;
    return state.mode === "playing" ? (breached ? "BREACH" : "RALLY") : "RALLY";
  }

  function currentObjective() {
    if (state.mode === "won") return { title: "Alien in the van", tip: "Perfectly normal road trip begins now." };
    if (state.mode === "lost") return { title: "Lockdown", tip: "The base hit full lockdown. Rebuild the wave mix." };
    if (state.alien && !state.alien.escaped) return { title: "Escort the alien", tip: "Deploy tanks and jammers so the alien can reach the van." };
    if (state.labHp <= 0) return { title: "Alien loose", tip: "Keep pressure up while the alien runs for the van." };
    if (!labCoreExposed() && labShieldBreaches() > 0) return { title: "Break a second lab shield", tip: "One lane is not enough. Push another lane through its pink Lab Shield gate." };
    if (!labCoreExposed() && state.gates.some((g) => g.breached)) return { title: "Break two lab shields", tip: "Crack the pink Lab Shield gate in two different lanes before the lab core opens." };
    if (labCoreExposed()) return { title: "Crack the lab", tip: "Two lab shields are down. Keep units alive long enough to damage the lab core." };
    if (state.labHp < LAB_MAX_HP) return { title: "Crack the lab", tip: "Keep units alive long enough to damage the lab core." };
    const firstGate = state.gates.filter((g) => g.breached).length;
    if (firstGate) return { title: "Break two lab shields", tip: "Push at least two lanes. Sign Guys tank, Tinfoil Crew jams defenses." };
    if (state.mode === "playing") return { title: "Deploy the first wave", tip: "Click a squad card, then click a lane. Push two lanes to open the lab." };
    return { title: "Rally outside the fence", tip: "Start the raid, then deploy squads down the three lanes." };
  }

  function rushCost() {
    return unitDefs.reduce((sum, u) => sum + Math.max(8, u.cost - 5), 0);
  }

  function labShieldBreaches() {
    return state.gates.filter((g) => g.tier === 2 && g.breached).length;
  }

  function labCoreExposed() {
    return labShieldBreaches() >= LAB_SHIELDS_REQUIRED;
  }

  function renderSquadList() {
    if (!squadList) return;
    const active = document.activeElement;
    squadList.innerHTML = unitDefs.map((u) => {
      const activeCls = u.id === state.selected ? " is-active" : "";
      const affordable = state.hype >= u.cost;
      const status = u.id === state.selected ? "SELECTED" : affordable ? "PICK" : "NEED HYPE";
      return `
        <button class="storm-squad${activeCls}" type="button" data-squad="${u.id}" style="--squad-color:${u.color}" aria-label="Select ${u.name}">
          <span class="storm-squad__chip">${u.short}</span>
          <span><strong>${u.name}</strong><span>${u.desc} · ${u.cost} hype</span></span>
          <span class="storm-squad__cooldown">${status}</span>
        </button>
      `;
    }).join("");
    if (active && active.dataset && active.dataset.squad) {
      const same = squadList.querySelector(`[data-squad="${active.dataset.squad}"]`);
      if (same) same.focus({ preventScroll: true });
    }
  }

  function renderMobileControls(def) {
    if (!mobileSquadList || !mobileLaneList) return;
    const selected = def || selectedUnitDef();
    const canDeploy = state.mode === "playing" && !paused && state.hype >= selected.cost;
    const canRush = state.mode === "playing" && !paused && state.rushCd <= 0 && state.hype >= rushCost();
    if (mobileSelected) mobileSelected.textContent = `${selected.short} · ${LANES[state.selectedLane].name}`;
    if (mobileHype) mobileHype.textContent = `Hype ${Math.round(state.hype)}%`;

    if (!mobileSquadList.children.length) {
      mobileSquadList.innerHTML = unitDefs.map((u) => `
        <button class="storm-mobile-unit" type="button" data-mobile-squad="${u.id}" style="--squad-color:${u.color}" aria-label="Select ${u.name}">
          <strong>${u.short}</strong>
          <span>${u.cost}</span>
        </button>
      `).join("");
    }
    unitDefs.forEach((u) => {
      const btn = mobileSquadList.querySelector(`[data-mobile-squad="${u.id}"]`);
      if (!btn) return;
      btn.classList.toggle("is-active", u.id === state.selected);
      btn.classList.toggle("is-low", state.hype < u.cost);
      btn.setAttribute("aria-pressed", String(u.id === state.selected));
    });

    if (!mobileLaneList.children.length) {
      const labels = ["NORTH", "MAIN", "SOUTH"];
      mobileLaneList.innerHTML = LANES.map((lane, i) => `
        <button class="storm-mobile-lane" type="button" data-mobile-lane="${lane.id}" style="--lane-color:${lane.color}">
          <strong>${i + 1}</strong>
          <span>${labels[i]}</span>
        </button>
      `).join("");
    }
    LANES.forEach((lane) => {
      const btn = mobileLaneList.querySelector(`[data-mobile-lane="${lane.id}"]`);
      if (!btn) return;
      btn.classList.toggle("is-active", lane.id === state.selectedLane);
      btn.disabled = !canDeploy;
      btn.setAttribute("aria-label", `Deploy ${selected.name} to ${lane.name}`);
      btn.setAttribute("aria-pressed", String(lane.id === state.selectedLane));
    });

    if (mobileDeploy) {
      mobileDeploy.textContent = `Deploy ${selected.cost}`;
      mobileDeploy.disabled = !canDeploy;
    }
    if (mobileRush) {
      mobileRush.textContent = state.rushCd > 0 ? `${Math.ceil(state.rushCd)}s` : "Rush";
      mobileRush.disabled = !canRush;
    }
    if (mobilePause) {
      mobilePause.textContent = paused ? "Resume" : "Pause";
      mobilePause.disabled = state.mode !== "playing";
    }
  }

  function markDirty() {
    state.dirtyUi = true;
  }

  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const touch = evt.touches && evt.touches[0] ? evt.touches[0] : evt.changedTouches && evt.changedTouches[0] ? evt.changedTouches[0] : evt;
    return {
      x: ((touch.clientX - rect.left) / rect.width) * W,
      y: ((touch.clientY - rect.top) / rect.height) * H,
    };
  }

  function onPointerMove(evt) {
    const p = canvasPoint(evt);
    state.hover = { x: p.x, y: p.y, active: true };
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    const p = canvasPoint(evt);
    const lane = laneFromY(p.y);
    setLane(lane);
    deploySelected(lane);
  }

  function handleKey(evt) {
    if (evt.key >= "1" && evt.key <= "4") {
      selectSquad(unitDefs[Number(evt.key) - 1].id);
      return;
    }
    if (evt.key.toLowerCase() === "z") {
      setLane(0);
      return;
    }
    if (evt.key.toLowerCase() === "x") {
      setLane(1);
      return;
    }
    if (evt.key.toLowerCase() === "c") {
      setLane(2);
      return;
    }
    if (evt.key.toLowerCase() === "q" || evt.key === " ") {
      if (overlay.classList.contains("overlay--show") && evt.key === " ") btnStart.click();
      else deploySelected();
      return;
    }
    if (evt.key.toLowerCase() === "e") {
      queueRush();
      return;
    }
    if (evt.key.toLowerCase() === "p" || evt.key === "Escape") {
      togglePause();
    }
  }

  function setupFullscreen() {
    if (!btnFullscreen || !wrap) return;
    let maxed = false;
    function setMaxed(on) {
      maxed = on;
      wrap.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      btnFullscreen.textContent = on ? "x" : "⛶";
      btnFullscreen.setAttribute("title", on ? "Exit" : "Max screen");
      btnFullscreen.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      setTimeout(() => canvas.focus({ preventScroll: true }), 0);
    }
    btnFullscreen.addEventListener("click", () => setMaxed(!maxed));
    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && maxed) setMaxed(false);
    });
  }

  function playBlip(freq, duration, type) {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      const ac = playBlip.ac || (playBlip.ac = new AudioContextCtor());
      if (ac.state === "suspended") ac.resume();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t = ac.currentTime;
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.72), t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch (_) {}
  }

  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000 || 0);
    lastT = t;
    if (running && !paused) update(dt);
    draw();
    updateUi();
    raf = requestAnimationFrame(loop);
  }

  function bindEvents() {
    btnStart.addEventListener("click", () => {
      if (state.mode === "playing" && paused) togglePause();
      else startGame();
    });
    btnNew.addEventListener("click", startGame);
    btnPause.addEventListener("click", togglePause);
    btnAbility.addEventListener("click", () => deploySelected());
    btnRally.addEventListener("click", queueRush);
    squadList.addEventListener("click", (evt) => {
      const btn = evt.target.closest("[data-squad]");
      if (btn) selectSquad(btn.dataset.squad);
    });
    if (mobileSquadList) {
      mobileSquadList.addEventListener("click", (evt) => {
        const btn = evt.target.closest("[data-mobile-squad]");
        if (btn) selectSquad(btn.dataset.mobileSquad);
      });
    }
    if (mobileLaneList) {
      mobileLaneList.addEventListener("click", (evt) => {
        const btn = evt.target.closest("[data-mobile-lane]");
        if (!btn) return;
        const lane = Number(btn.dataset.mobileLane);
        setLane(lane);
        deploySelected(lane);
      });
    }
    if (mobileDeploy) mobileDeploy.addEventListener("click", () => deploySelected());
    if (mobileRush) mobileRush.addEventListener("click", queueRush);
    if (mobilePause) mobilePause.addEventListener("click", togglePause);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", handleKey);
    setupFullscreen();
  }

  async function init() {
    bindEvents();
    resetGame();
    draw();
    const [mapOk, spritesOk] = await Promise.all([
      loadImage(images.map, assets.map),
      loadImage(images.sprites, assets.sprites),
    ]);
    assetsReady = mapOk && spritesOk;
    if (!assetsReady) log("Generated assets did not load; using fallback markers.");
    markDirty();
    draw();
  }

  window.__STORM51 = {
    state,
    startGame,
    selectSquad,
    setLane,
    deploySelected,
    queueRush,
    spawnUnit,
    win: () => endGame(true),
    lose: () => endGame(false),
  };

  init();
  raf = requestAnimationFrame(loop);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
})();
