/* ============================================
   STORM AREA 51: RAID THE BASE
   - Isometric 2.5D real-time strategy siege.
   - Deploy raider squads from the outer perimeter, breach the fences/gates,
     crack the central Laboratory, free the alien, escort it to the getaway van.
   - Canvas-drawn vector art (no sprite sheet), depth-sorted isometric grid,
     weighted flow-field pathfinding. DOM HUD/menus.
   - Debug hook: window.__STORM51
   ============================================ */
(function () {
  "use strict";

  /* ---------- core constants ---------- */
  const GAME_ID = "storm-area-51";
  const W = 1280;                  // 16:9 internal resolution (CSS scales to fit)
  const H = 720;

  const GRID = 30;                 // 30 x 30 tiles — a big, sprawling desert base
  const TILE_W = 40;               // iso tile width (px) — 2:1 iso
  const TILE_H = 20;               // iso tile height (px)
  const ORIGIN_X = W / 2;          // diamond apex x
  const ORIGIN_Y = 70;             // top padding so wall heights + HUD ribbon have room

  const LAB_C = 13, LAB_R = 13, LAB_SPAN = 4;     // lab footprint cols/rows 13..16, centre (15,15)
  const LAB_MAX_HP = 820;
  const VAN_TILE = { c: 1, r: 14 };               // alien escort goal (west, outside the perimeter)
  const VAN_DRAW = { c: 0.4, r: 14.5 };           // van art sits just outside the west gate

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
    sand: "#b89360",
    sandDk: "#a07a48",
    road: "#8a6d44",
    metal: "#5b6678",
  };

  const TROOP_ASSET_VERSION = "20260629-troop-art-1";
  const TROOP_ASSET_BASE = "../assets/img/storm-area-51/troops/";
  function troopAsset(file) {
    return `${TROOP_ASSET_BASE}${file}?v=${TROOP_ASSET_VERSION}`;
  }

  const NB8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  /* ---------- DOM ---------- */
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

  /* ---------- squad roster ---------- */
  // speed is in tiles/second; range/radius in tiles.
  const unitDefs = [
    {
      id: "runner", hotkey: "1", name: "Naruto Runner", short: "NR", color: C.cyan,
      icon: troopAsset("runner-icon.png"), model: troopAsset("runner-model.png"), modelHeight: 72,
      cost: 16, hp: 46, speed: 2.75, damage: 15, wallBonus: 1.4, range: 0.85,
      attackRate: 0.55, desc: "Fast breacher",
      role: "Fast, zig-zags past fire, shreds fences and gates.",
    },
    {
      id: "streamer", hotkey: "2", name: "Livestreamer", short: "LS", color: C.pink,
      icon: troopAsset("streamer-icon.png"), model: troopAsset("streamer-model.png"), modelHeight: 68,
      cost: 19, hp: 84, speed: 1.75, damage: 8, wallBonus: 1, range: 0.9,
      attackRate: 0.72, desc: "Hype economy", hypeAura: 0.6, taunt: 1.5,
      role: "Generates Hype while alive and taunts guard fire.",
    },
    {
      id: "tinfoil", hotkey: "3", name: "Tinfoil Crew", short: "TF", color: C.yellow,
      icon: troopAsset("tinfoil-icon.png"), model: troopAsset("tinfoil-model.png"), modelHeight: 70,
      cost: 24, hp: 74, speed: 1.55, damage: 6, wallBonus: 1, range: 0.95,
      attackRate: 0.95, desc: "EMP jammer", jamRadius: 3.0,
      role: "Projects an EMP field that disables towers and searchlights.",
    },
    {
      id: "sign", hotkey: "4", name: "Sign Guy", short: "SG", color: C.green,
      icon: troopAsset("sign-icon.png"), model: troopAsset("sign-model.png"), modelHeight: 72,
      cost: 24, hp: 168, speed: 1.3, damage: 8, wallBonus: 1.1, range: 0.85,
      attackRate: 0.82, desc: "Shield tank", shieldRadius: 2.7, taunt: 1.7,
      role: "Soaks projectiles and gives nearby raiders damage cover.",
    },
  ];

  /* ---------- spawn sectors (outer perimeter) ---------- */
  const ZONES = [
    { id: "N", name: "North", color: C.cyan, c: 14.5, r: 1.8 },
    { id: "E", name: "East", color: C.pink, c: 27.5, r: 14.5 },
    { id: "S", name: "South", color: C.yellow, c: 14.5, r: 27.5 },
  ];
  function zoneAt(c, r) {
    if (r >= 0 && r <= 3 && c >= 4 && c <= 25) return 0;       // North band
    if (c >= 26 && c <= 29 && r >= 4 && r <= 25) return 1;     // East band
    if (r >= 26 && r <= 29 && c >= 4 && c <= 25) return 2;     // South band
    return -1;
  }

  /* ---------- runtime state ---------- */
  const state = {
    mode: "intro",          // intro | playing | won | lost
    selected: "runner",
    zone: 0,
    score: 0,
    best: 0,
    alert: 0,
    hype: 68,
    time: 0,
    labHp: LAB_MAX_HP,
    alien: null,
    units: [],
    guards: [],
    structures: [],
    projectiles: [],
    effects: [],
    floats: [],
    spawnQueue: [],
    rushCd: 0,
    reinforceCd: 16,
    nextId: 1,
    banner: { text: "", ttl: 0, life: 0, color: C.ink },
    dirtyUi: true,
    hover: { active: false, col: 0, row: 0, zone: -1 },
  };

  // tile occupancy + flow fields (module level, rebuilt as structures fall)
  let occ = new Array(GRID * GRID).fill(null);
  let costGrid = new Float64Array(GRID * GRID).fill(1);
  let labField = new Float64Array(GRID * GRID).fill(Infinity);
  let vanField = new Float64Array(GRID * GRID).fill(Infinity);

  let running = false;
  let paused = false;
  let lastT = 0;
  let raf = 0;
  const troopModels = {};

  function loadTroopAssets() {
    unitDefs.forEach((u) => {
      if (troopModels[u.id]) return;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => markDirty();
      img.src = u.model;
      troopModels[u.id] = img;
    });
  }

  /* ---------- small math helpers ---------- */
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(a, b, c, d) { return Math.hypot(a - c, b - d); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function fmt(n) { return Math.max(0, Math.round(n)).toLocaleString(); }
  function idx(c, r) { return r * GRID + c; }
  function inGrid(c, r) { return c >= 0 && r >= 0 && c < GRID && r < GRID; }

  /* ---------- isometric projection ---------- */
  function scr(col, row) {
    return {
      x: ORIGIN_X + (col - row) * (TILE_W / 2),
      y: ORIGIN_Y + (col + row) * (TILE_H / 2),
    };
  }
  function screenToTile(px, py) {
    const dx = (px - ORIGIN_X) / (TILE_W / 2);
    const dy = (py - ORIGIN_Y) / (TILE_H / 2);
    return { col: (dx + dy) / 2, row: (dy - dx) / 2 };
  }

  /* ============================================================
     MAP CONSTRUCTION
     ============================================================ */
  function makeStruct(type, c, r, w, h, hp, height) {
    const s = {
      id: state.nextId++,
      type, c, r, w, h,
      c1: c + w, r1: r + h,
      cx: c + w / 2, cy: r + h / 2,    // footprint centre (tile coords)
      hp, maxHp: hp, height,
      alive: true, shake: 0, jam: 0, hit: 0,
      // defense fields
      cd: 0.4 + Math.random() * 0.6,
      sweep: Math.random() * Math.PI * 2,
      fireRate: type === "tower" ? 1.0 : 0,
      range: type === "tower" ? 5.0 : type === "light" ? 7.0 : 0,
      damage: type === "tower" ? 13 : 0,
    };
    for (let rr = r; rr < r + h; rr++)
      for (let cc = c; cc < c + w; cc++)
        if (inGrid(cc, rr)) occ[idx(cc, rr)] = s;
    state.structures.push(s);
    return s;
  }

  // deduped tile list for a square ring between indices a..b
  function ringSquare(a, b) {
    const tiles = [], seen = new Set();
    for (let k = a; k <= b; k++) {
      [[k, a], [k, b], [a, k], [b, k]].forEach(([c, r]) => {
        const key = c + "," + r;
        if (!seen.has(key)) { seen.add(key); tiles.push([c, r]); }
      });
    }
    return tiles;
  }

  function buildMap() {
    state.structures = [];
    occ = new Array(GRID * GRID).fill(null);

    // ---- outer perimeter fence ring (square 4..25) with a gate on each side ----
    const OA = 4, OB = 25;
    const outerGate = (c, r) => (
      ((r === OA || r === OB) && (c === 14 || c === 15)) ||
      ((c === OA || c === OB) && (r === 14 || r === 15))
    );
    ringSquare(OA, OB).forEach(([c, r]) => {
      if (outerGate(c, r)) makeStruct("gate", c, r, 1, 1, 160, 24);
      else makeStruct("fence", c, r, 1, 1, 70, 15);
    });

    // ---- inner keep wall ring (square 10..19): tougher walls + keep gates on
    //      N/E/S, with a permanent OPEN gap on the west as the escape corridor ----
    const KA = 10, KB = 19;
    const keepGate = (c, r) => (
      ((r === KA || r === KB) && (c === 14 || c === 15)) ||  // north & south keep gates
      (c === KB && (r === 14 || r === 15))                   // east keep gate
    );
    const keepOpen = (c, r) => (c === KA && (r === 14 || r === 15)); // west escape gap
    ringSquare(KA, KB).forEach(([c, r]) => {
      if (keepOpen(c, r)) return;
      if (keepGate(c, r)) makeStruct("gate", c, r, 1, 1, 220, 30);
      else makeStruct("wall", c, r, 1, 1, 150, 26);
    });

    // ---- hangars (big, permanent — sit in the open courtyard corners) ----
    [[5, 5], [22, 5], [5, 22], [22, 22]].forEach(([c, r]) =>
      makeStruct("hangar", c, r, 3, 3, 9999, 32)
    );

    // ---- guard towers: courtyard gate-flankers + a pair of keep turrets east of
    //      the lab. The west keep interior stays clear as the escape back-door ----
    [[11, 7], [18, 7], [11, 22], [18, 22], [22, 11], [22, 18],
     [16, 12], [16, 17]].forEach(([c, r]) =>
      makeStruct("tower", c, r, 1, 1, 95, 40)
    );

    // ---- searchlights (sweeping) spread through the courtyard ----
    [[8, 8], [21, 8], [8, 21], [21, 21]].forEach(([c, r]) =>
      makeStruct("light", c, r, 1, 1, 70, 48)
    );

    // ---- central laboratory dome ----
    makeStruct("lab", LAB_C, LAB_R, LAB_SPAN, LAB_SPAN, LAB_MAX_HP, 60);

    // ---- patrolling guards covering the corridors and the escape mouth ----
    state.guards = [];
    spawnGuard(14.5, 8, [[13, 8], [16, 8]]);
    spawnGuard(14.5, 21, [[13, 21], [16, 21]]);
    spawnGuard(22, 14.5, [[22, 13], [22, 16]]);
    spawnGuard(11, 14.5, [[11, 13], [11, 16]]);
    spawnGuard(14.5, 12, [[13, 12], [16, 12]]);
    spawnGuard(14.5, 17, [[13, 17], [16, 17]]);

    state.reinforceCd = 16;
    rebuildFields();
  }

  function spawnGuard(c, r, route) {
    state.guards.push({
      id: state.nextId++, col: c, row: r,
      hp: 64, maxHp: 64, speed: 1.85, damage: 9, range: 1.0,
      attackRate: 0.8, attackCd: 0, aggro: 3.6,
      route, wp: 0, target: null, alive: true, hit: 0, bob: Math.random() * 6,
    });
  }

  function labStruct() {
    return state.structures.find((s) => s.type === "lab");
  }

  /* ============================================================
     PATHFINDING (weighted flow field / Dijkstra)
     ============================================================ */
  function tileEntryCost(c, r) {
    const s = occ[idx(c, r)];
    if (!s || !s.alive) return 1;            // open sand / breached rubble
    switch (s.type) {
      case "hangar": return Infinity;        // permanent, must route around
      case "fence": return 14;
      case "wall": return 18;                 // inner keep wall — tougher to smash
      case "gate": return 7;                  // gates are the intended way in
      case "tower": return 24;
      case "light": return 24;
      case "lab": return 5;                   // raiders flow in and smash it
      default: return 1;
    }
  }

  function buildCostGrid() {
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++)
        costGrid[idx(c, r)] = tileEntryCost(c, r);
  }

  function computeField(goals) {
    const field = new Float64Array(GRID * GRID).fill(Infinity);
    const open = [];
    const inOpen = new Uint8Array(GRID * GRID);
    goals.forEach((g) => {
      if (!inGrid(g.c, g.r)) return;
      if (costGrid[idx(g.c, g.r)] === Infinity) return;
      field[idx(g.c, g.r)] = 0;
      open.push(idx(g.c, g.r));
      inOpen[idx(g.c, g.r)] = 1;
    });
    while (open.length) {
      // linear extract-min (grid is tiny, rebuilt rarely)
      let bi = 0;
      for (let k = 1; k < open.length; k++)
        if (field[open[k]] < field[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1);
      inOpen[cur] = 0;
      const cc = cur % GRID;
      const cr = (cur - cc) / GRID;
      for (const [dc, dr] of NB8) {
        const nc = cc + dc, nr = cr + dr;
        if (!inGrid(nc, nr)) continue;
        const ec = costGrid[idx(nc, nr)];
        if (ec === Infinity) continue;
        if (dc !== 0 && dr !== 0) {
          // do not cut diagonally between two permanent obstacles
          if (costGrid[idx(cc + dc, cr)] === Infinity &&
              costGrid[idx(cc, cr + dr)] === Infinity) continue;
        }
        const nd = field[cur] + ec * (dc && dr ? 1.41421 : 1);
        if (nd < field[idx(nc, nr)]) {
          field[idx(nc, nr)] = nd;
          if (!inOpen[idx(nc, nr)]) { open.push(idx(nc, nr)); inOpen[idx(nc, nr)] = 1; }
        }
      }
    }
    return field;
  }

  function rebuildFields() {
    buildCostGrid();
    const labGoals = [];
    for (let r = LAB_R + 1; r < LAB_R + LAB_SPAN - 1; r++)
      for (let c = LAB_C + 1; c < LAB_C + LAB_SPAN - 1; c++)
        labGoals.push({ c, r });
    labField = computeField(labGoals);
    // goals are all on col 1 so the gradient keeps pulling the alien past the win line
    vanField = computeField([VAN_TILE, { c: 1, r: 15 }, { c: 1, r: 13 }, { c: 1, r: 16 }]);
  }

  // pick the downhill neighbour tile from a continuous position
  function bestStep(col, row, field) {
    const ci = clamp(Math.floor(col), 0, GRID - 1);
    const ri = clamp(Math.floor(row), 0, GRID - 1);
    let best = null;
    let bestD = field[idx(ci, ri)];
    for (const [dc, dr] of NB8) {
      const nc = ci + dc, nr = ri + dr;
      if (!inGrid(nc, nr)) continue;
      if (dc && dr) {
        if (costGrid[idx(ci + dc, ri)] === Infinity &&
            costGrid[idx(ci, ri + dr)] === Infinity) continue;
      }
      const d = field[idx(nc, nr)] + (dc && dr ? 0.001 : 0);
      if (d < bestD) { bestD = d; best = { nc, nr }; }
    }
    return best;
  }

  /* ============================================================
     GAME LIFECYCLE
     ============================================================ */
  function resetGame() {
    if (logEl) logEl.innerHTML = "";
    state.mode = "intro";
    state.score = 0;
    state.best = Number(api.getHighScore(GAME_ID) || 0);
    state.alert = 0;
    state.hype = 68;
    state.time = 0;
    state.labHp = LAB_MAX_HP;
    state.alien = null;
    state.units = [];
    state.guards = [];
    state.structures = [];
    state.projectiles = [];
    state.effects = [];
    state.floats = [];
    state.spawnQueue = [];
    state.rushCd = 0;
    state.reinforceCd = 16;
    state.nextId = 1;
    state.banner = { text: "", ttl: 0, life: 0, color: C.ink };
    paused = false;
    running = false;
    buildMap();
    setOverlay(
      "Raid The Base",
      "Isometric siege. Pick a squad, then click a glowing deployment sector to send raiders in. Breach the perimeter, crack the central Laboratory, free the alien, and escort it west to the van before lockdown hits 100%.",
      "Start raid"
    );
    log("The convoy fanned out around three sectors of a very official-looking fence.");
    markDirty();
    updateUi();
  }

  function startGame() {
    const sel = state.selected, z = state.zone;
    resetGame();
    state.selected = sel;
    state.zone = z;
    state.mode = "playing";
    running = true;
    paused = false;
    hideOverlay();
    log("Raid started. Deploy squads on the perimeter and bury the base in bad decisions.");
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
      const alertBonus = Math.round((100 - state.alert) * 90);
      const timeBonus = Math.max(0, Math.round(14000 - state.time * 70));
      const unitBonus = state.units.filter((u) => u.alive).length * 240;
      state.score += alertBonus + timeBonus + unitBonus + 5000;
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
        ? "The alien is in the van, the convoy peeled out, and the base is still trying to understand the livestream."
        : (reason || "Lockdown hit 100%. The perimeter doors slammed shut for good."),
      "Run it back",
      `Score: <strong>${fmt(state.score)}</strong>${high ? " · New high score" : ""}<br>Lockdown: <strong>${Math.round(state.alert)}%</strong> · Hype: <strong>${Math.round(state.hype)}%</strong>`
    );
  }

  function togglePause() {
    if (state.mode !== "playing") return;
    paused = !paused;
    running = !paused;
    if (paused) setOverlay("Paused", "The raid is holding position around the perimeter.", "Resume");
    else { hideOverlay(); lastT = performance.now(); }
    markDirty();
  }

  /* ============================================================
     INPUT-DRIVEN ACTIONS
     ============================================================ */
  function selectedDef() {
    return unitDefs.find((u) => u.id === state.selected) || unitDefs[0];
  }
  function selectSquad(id) {
    if (!unitDefs.some((u) => u.id === id)) return;
    state.selected = id;
    bumpBanner(`${selectedDef().name}: click a sector`, selectedDef().color, 1.2);
    markDirty();
    updateUi();
  }
  function setZone(i) {
    state.zone = clamp(Number(i), 0, ZONES.length - 1);
    markDirty();
  }

  // deploy at an explicit tile position, else at the selected zone centre
  function deploy(pos) {
    if (state.mode !== "playing" || paused) return false;
    const def = selectedDef();
    if (state.units.filter((u) => u.alive).length >= 64) {
      bumpBanner("Field is full", C.yellow);
      return false;
    }
    if (state.hype < def.cost) {
      bumpBanner(`Need ${def.cost} hype`, C.yellow);
      playBlip(150, 0.07, "sawtooth");
      return false;
    }
    let col, row;
    if (pos) { col = pos.col; row = pos.row; }
    else {
      const z = ZONES[state.zone];
      col = z.c + (Math.random() * 1.4 - 0.7);
      row = z.r + (Math.random() * 1.4 - 0.7);
    }
    state.hype = clamp(state.hype - def.cost, 0, 100);
    spawnUnit(def.id, col, row);
    const p = scr(col, row);
    addEffect("deploy", p.x, p.y, def.color);
    playBlip(440 + state.zone * 80, 0.08, "square");
    markDirty();
    return true;
  }

  function spawnUnit(unitId, col, row) {
    const def = unitDefs.find((u) => u.id === unitId);
    if (!def) return null;
    const u = {
      ...def,
      uid: state.nextId++,
      col: clamp(col, 0.2, GRID - 0.2),
      row: clamp(row, 0.2, GRID - 0.2),
      hp: def.hp, maxHp: def.hp,
      attackCd: 0.1 + Math.random() * 0.25,
      alive: true, dying: 0,
      bob: Math.random() * Math.PI * 2,
      zig: Math.random() * Math.PI * 2,
      shielded: false, jamPulse: 0, lit: 0, hit: 0,
      face: 1,
    };
    state.units.push(u);
    return u;
  }

  function queueRush() {
    if (state.mode !== "playing" || paused) return;
    if (state.rushCd > 0) { bumpBanner("Rush wave cooling down", C.yellow); return; }
    const total = rushCost();
    if (state.hype < total) { bumpBanner(`Need ${total} hype for rush`, C.yellow); return; }
    state.hype = clamp(state.hype - total, 0, 100);
    state.rushCd = 15;
    unitDefs.forEach((u, i) => {
      const z = ZONES[i % ZONES.length];
      state.spawnQueue.push({ unitId: u.id, col: z.c, row: z.r, delay: i * 0.22 });
    });
    bumpBanner("Rush wave queued", C.green);
    log("A whole wave surged in from every sector. The group chat briefly became useful.");
    playBlip(720, 0.12, "triangle");
    markDirty();
  }
  function rushCost() {
    return unitDefs.reduce((s, u) => s + Math.max(8, u.cost - 5), 0);
  }

  /* ---------- log / banner / score ---------- */
  function log(text) {
    if (!logEl) return;
    const li = document.createElement("li");
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 6) logEl.removeChild(logEl.lastChild);
  }
  function bumpBanner(text, color, ttl) {
    state.banner = { text, color: color || C.ink, ttl: ttl || 1.3, life: ttl || 1.3 };
  }
  function addScore(pts, label, col, row, color) {
    state.score = Math.max(0, state.score + pts);
    const p = scr(col, row);
    addFloat(`${pts >= 0 ? "+" : ""}${pts} ${label || ""}`.trim(), p.x, p.y, color || C.yellow);
    markDirty();
  }
  function addFloat(text, x, y, color) {
    state.floats.push({ text, x, y, vy: -26, ttl: 1.2, life: 1.2, color: color || C.ink });
  }
  function addEffect(type, x, y, color, extra) {
    state.effects.push({ type, x, y, color: color || C.cyan, ttl: 0.6, life: 0.6, r: 7, ...extra });
  }

  /* ============================================================
     UPDATE
     ============================================================ */
  function update(dt) {
    if (state.mode !== "playing" || paused) return;
    state.time += dt;
    state.rushCd = Math.max(0, state.rushCd - dt);
    if (state.banner.ttl > 0) state.banner.ttl -= dt;

    updateSpawnQueue(dt);
    updateEconomy(dt);
    updateAuras(dt);
    updateSearchlights(dt);
    updateUnits(dt);
    updateGuards(dt);
    reinforceGuards(dt);
    updateTowers(dt);
    updateProjectiles(dt);
    updateAlien(dt);
    updateEffects(dt);
    updateWinLoss();
    markDirty();
  }

  function updateSpawnQueue(dt) {
    state.spawnQueue.forEach((q) => (q.delay -= dt));
    const ready = state.spawnQueue.filter((q) => q.delay <= 0);
    state.spawnQueue = state.spawnQueue.filter((q) => q.delay > 0);
    ready.forEach((q) => {
      spawnUnit(q.unitId, q.col, q.row);
      const p = scr(q.col, q.row);
      addEffect("deploy", p.x, p.y, unitDefs.find((u) => u.id === q.unitId).color);
    });
  }

  function escorting() {
    return !!(state.alien && !state.alien.escaped);
  }

  function updateEconomy(dt) {
    const streamerGain = state.units
      .filter((u) => u.alive && u.id === "streamer")
      .reduce((s, u) => s + (u.hypeAura || 0), 0);
    const pressure = state.labHp <= 0 ? 0.3 : (LAB_MAX_HP - state.labHp) * 0.0018;
    state.hype = clamp(state.hype + (4.8 + streamerGain + pressure) * dt, 0, 100);

    const litCount = state.units.filter((u) => u.alive && u.lit > 0).length;
    const crowd = Math.max(0, state.units.filter((u) => u.alive).length - 10) * 0.02;
    // lockdown pressure eases once the base is in escort-phase chaos
    const escortEase = state.labHp <= 0 ? 0.55 : 1;
    state.alert = clamp(state.alert + (0.45 + litCount * 0.7 + crowd) * escortEase * dt, 0, 100);
  }

  function updateAuras(dt) {
    state.units.forEach((u) => {
      u.shielded = false;
      u.jamPulse = Math.max(0, u.jamPulse - dt);
      u.hit = Math.max(0, u.hit - dt);
      u.lit = Math.max(0, u.lit - dt * 3);
    });
    const signs = state.units.filter((u) => u.alive && u.id === "sign");
    state.units.forEach((u) => {
      if (!u.alive) return;
      u.shielded = signs.some((s) => s.uid !== u.uid && dist(s.col, s.row, u.col, u.row) < s.shieldRadius);
    });
    const jammers = state.units.filter((u) => u.alive && u.id === "tinfoil");
    state.structures.forEach((s) => {
      if (!s.alive || (s.type !== "tower" && s.type !== "light")) return;
      if (jammers.some((u) => dist(u.col, u.row, s.cx, s.cy) < u.jamRadius)) s.jam = Math.max(s.jam, 0.3);
      else s.jam = Math.max(0, s.jam - dt);
    });
  }

  function updateSearchlights(dt) {
    state.structures.forEach((s) => {
      if (s.type !== "light" || !s.alive) return;
      s.sweep += dt * (s.jam > 0 ? 0.05 : 0.9);
      if (s.jam > 0) return;
      const dir = Math.sin(s.sweep) * 1.5;     // tile-space sweep angle
      const half = 0.5;
      state.units.forEach((u) => {
        if (!u.alive) return;
        const d = dist(u.col, u.row, s.cx, s.cy);
        if (d > s.range || d < 0.3) return;
        let a = Math.atan2(u.row - s.cy, u.col - s.cx) - dir;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        if (Math.abs(a) < half) {
          u.lit = 0.6;
          if (!s.caught) { state.alert = clamp(state.alert + 0.3, 0, 100); s.caught = 0.5; }
        }
      });
      s.caught = Math.max(0, (s.caught || 0) - dt);
    });
  }

  function updateUnits(dt) {
    const field = escorting() || state.labHp <= 0 ? vanField : labField;
    state.units.forEach((u) => {
      if (!u.alive) { u.dying -= dt; return; }
      u.bob += dt * (5 + u.speed * 2);
      u.zig += dt * 7;
      u.attackCd = Math.max(0, u.attackCd - dt);

      // 1) opportunistically attack an adjacent guard
      const guard = nearestGuard(u, u.range + 0.35);
      if (guard) { attackGuard(u, guard); return; }

      // 2) follow the flow field; smash blocking structures
      const step = bestStep(u.col, u.row, field);
      if (!step) return;
      const s = occ[idx(step.nc, step.nr)];
      if (s && s.alive && s.type !== "hangar") {
        attackStructure(u, s);
        return;
      }
      // move toward the chosen tile centre
      let tx = step.nc + 0.5, ty = step.nr + 0.5;
      let dx = tx - u.col, dy = ty - u.row;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      // Naruto Runner zig-zags to throw off snipers
      if (u.id === "runner") {
        const px = -dy, py = dx;
        const wob = Math.sin(u.zig) * 0.45;
        dx += px * wob; dy += py * wob;
        const l2 = Math.hypot(dx, dy) || 1; dx /= l2; dy /= l2;
      }
      u.face = dx >= 0 ? 1 : -1;
      u.col = clamp(u.col + dx * u.speed * dt, 0.15, GRID - 0.15);
      u.row = clamp(u.row + dy * u.speed * dt, 0.15, GRID - 0.15);
    });
    state.units = state.units.filter((u) => u.alive || u.dying > -0.4);
  }

  function nearestGuard(u, range) {
    let best = null, bd = range;
    state.guards.forEach((g) => {
      if (!g.alive) return;
      const d = dist(u.col, u.row, g.col, g.row);
      if (d < bd) { bd = d; best = g; }
    });
    return best;
  }

  function attackGuard(u, g) {
    if (u.attackCd > 0) return;
    u.attackCd = u.attackRate;
    g.hp -= u.damage;
    g.hit = 0.2;
    const p = scr(g.col, g.row);
    addEffect("hit", p.x, p.y - 14, u.color, { r: 8 });
    if (g.hp <= 0 && g.alive) {
      g.alive = false;
      addScore(120, "GUARD", g.col, g.row, C.cyan);
      state.alert = clamp(state.alert - 1, 0, 100);
    }
  }

  function attackStructure(u, s) {
    if (u.attackCd > 0) return;
    u.attackCd = u.attackRate;
    let dmg = u.damage;
    if ((s.type === "fence" || s.type === "gate") && u.wallBonus) dmg *= u.wallBonus;
    s.hp -= dmg;
    s.shake = 0.2;
    s.hit = 0.18;
    const cp = scr(s.cx, s.cy);
    addEffect("hit", cp.x, cp.y - s.height * 0.5, u.color, { r: 9 });
    if (s.type === "lab") state.labHp = s.hp;
    if (s.hp <= 0 && s.alive) { s.alive = false; onStructureDown(s); }
  }

  function onStructureDown(s) {
    // free the occupancy so the field can route through, then recompute
    rebuildFields();
    const cp = scr(s.cx, s.cy);
    if (s.type === "fence") {
      addScore(60, "FENCE", s.cx, s.cy, C.cyan);
    } else if (s.type === "gate") {
      addScore(220, "GATE BREACH", s.cx, s.cy, C.yellow);
      bumpBanner("Gate breached", C.yellow, 1.4);
      playBlip(620, 0.09, "square");
    } else if (s.type === "tower") {
      addScore(320, "TOWER DOWN", s.cx, s.cy, C.pink);
      bumpBanner("Guard tower destroyed", C.pink, 1.3);
      addEffect("hit", cp.x, cp.y - 20, C.orange, { r: 16 });
    } else if (s.type === "light") {
      addScore(200, "LIGHT OUT", s.cx, s.cy, C.yellow);
    } else if (s.type === "lab") {
      state.labHp = 0;
      addScore(1800, "LAB OPEN", s.cx, s.cy, C.green);
      bumpBanner("Alien liberated — escort it to the van", C.green, 2);
      state.alert = clamp(state.alert - 6, 0, 100);
      spawnAlien();
      // the alien's escape blows the western service gate, opening a clear exit lane
      state.structures.forEach((g) => {
        if (g.type === "gate" && g.alive && g.c === 3 && (g.r === 10 || g.r === 11)) {
          g.alive = false; g.hp = 0;
          const gp = scr(g.cx, g.cy);
          addEffect("hit", gp.x, gp.y - 18, C.green, { r: 18 });
        }
      });
      rebuildFields();
      log("The Laboratory cracked open and the western gate blew. Escort the alien to the van.");
      playBlip(980, 0.16, "sine");
    }
  }

  function spawnAlien() {
    state.alien = {
      col: LAB_C + LAB_SPAN / 2, row: LAB_R + LAB_SPAN / 2,
      hp: 185, maxHp: 185, speed: 1.6,
      escaped: false, panic: 0, bob: 0, hit: 0, attackCd: 0,
    };
  }

  /* ---------- guards ---------- */
  function updateGuards(dt) {
    state.guards.forEach((g) => {
      if (!g.alive) return;
      g.bob += dt * 6;
      g.attackCd = Math.max(0, g.attackCd - dt);
      g.hit = Math.max(0, g.hit - dt);

      // acquire nearest raider (or the alien) within aggro
      let tgt = null, bd = g.aggro;
      state.units.forEach((u) => {
        if (!u.alive) return;
        const d = dist(u.col, u.row, g.col, g.row);
        const w = d - (u.taunt ? (u.taunt - 1) * 1.4 : 0);
        if (w < bd) { bd = w; tgt = u; }
      });
      if (escorting()) {
        const d = dist(state.alien.col, state.alien.row, g.col, g.row);
        if (d < g.aggro + 1) tgt = state.alien;
      }

      if (tgt) {
        const d = dist(tgt.col, tgt.row, g.col, g.row);
        if (d <= g.range) {
          if (g.attackCd <= 0) {
            g.attackCd = g.attackRate;
            damageRaiderOrAlien(tgt, tgt === state.alien ? g.damage * 0.7 : g.damage);
            const p = scr(tgt.col, tgt.row);
            addEffect("hit", p.x, p.y - 18, C.red, { r: 7 });
          }
        } else {
          moveGuard(g, tgt.col, tgt.row, dt);
        }
      } else {
        // patrol
        const wp = g.route[g.wp];
        if (dist(g.col, g.row, wp[0], wp[1]) < 0.25) g.wp = (g.wp + 1) % g.route.length;
        moveGuard(g, wp[0], wp[1], dt);
      }
    });
    state.guards = state.guards.filter((g) => g.alive);
  }

  // muster fresh defenders out of the keep while the lab still stands
  function reinforceGuards(dt) {
    if (state.labHp <= 0) return;
    state.reinforceCd -= dt;
    if (state.reinforceCd <= 0 && state.guards.length < 7) {
      state.reinforceCd = 22;
      // muster at the inner mouth of a random keep gate (walkable) and push to the gate
      const spots = [[14.5, 11, 14.5, 10.5], [14.5, 18, 14.5, 19.5], [18, 14.5, 19.5, 14.5]];
      const s = spots[Math.floor(Math.random() * spots.length)];
      spawnGuard(s[0], s[1], [[s[0], s[1]], [s[2], s[3]]]);
      const p = scr(s[0], s[1]);
      addEffect("deploy", p.x, p.y, C.red);
    }
  }

  function moveGuard(g, tx, ty, dt) {
    let dx = tx - g.col, dy = ty - g.row;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const stepX = g.col + dx * g.speed * dt;
    const stepY = g.row + dy * g.speed * dt;
    // avoid walking into permanent obstacles
    if (!solidForGuard(stepX, g.row)) g.col = clamp(stepX, 0.3, GRID - 0.3);
    if (!solidForGuard(g.col, stepY)) g.row = clamp(stepY, 0.3, GRID - 0.3);
  }
  function solidForGuard(c, r) {
    const s = occ[idx(clamp(Math.floor(c), 0, GRID - 1), clamp(Math.floor(r), 0, GRID - 1))];
    return s && s.alive && (s.type === "hangar" || s.type === "lab" || s.type === "tower");
  }

  function damageRaiderOrAlien(t, amount) {
    if (t === state.alien) { damageAlien(amount); return; }
    let dmg = amount;
    if (t.shielded) dmg *= 0.58;
    if (t.id === "sign") dmg *= 0.7;
    t.hp -= dmg;
    t.hit = 0.18;
    if (t.hp <= 0 && t.alive) killRaider(t);
  }

  function killRaider(u) {
    u.alive = false;
    u.dying = 0.35;
    addFloat("DOWN", scr(u.col, u.row).x, scr(u.col, u.row).y - 30, C.red);
    state.alert = clamp(state.alert + 1.1, 0, 100);
  }

  /* ---------- towers ---------- */
  function updateTowers(dt) {
    state.structures.forEach((s) => {
      if (s.type !== "tower" || !s.alive) return;
      s.shake = Math.max(0, s.shake - dt);
      s.cd = Math.max(0, s.cd - dt);
      if (s.jam > 0) { s.cd = Math.max(s.cd, 0.2); return; }  // EMP silences this tower
      const tgt = chooseTowerTarget(s);
      if (tgt && s.cd <= 0) {
        fireTower(s, tgt);
        s.cd = tgt.lit > 0 ? s.fireRate * 0.55 : s.fireRate;  // searchlight rate buff
      }
    });
  }

  function chooseTowerTarget(s) {
    const list = state.units.filter(
      (u) => u.alive && dist(u.col, u.row, s.cx, s.cy) < s.range
    );
    if (escorting() && dist(state.alien.col, state.alien.row, s.cx, s.cy) < s.range)
      list.push(Object.assign({ isAlien: true, uid: "alien", taunt: 1.1, lit: 0 }, state.alien));
    if (!list.length) return null;
    list.sort((a, b) => {
      const sa = (a.lit > 0 ? 100 : 0) + (a.taunt || 1) * 30 - (a.shielded ? 18 : 0)
        - dist(a.col, a.row, s.cx, s.cy);
      const sb = (b.lit > 0 ? 100 : 0) + (b.taunt || 1) * 30 - (b.shielded ? 18 : 0)
        - dist(b.col, b.row, s.cx, s.cy);
      return sb - sa;
    });
    return list[0];
  }

  function fireTower(s, tgt) {
    const top = scr(s.cx, s.cy);
    const tp = scr(tgt.col, tgt.row);
    state.projectiles.push({
      x: top.x, y: top.y - s.height,
      tx: tp.x, ty: tp.y - 16,
      targetUid: tgt.uid, alien: !!tgt.isAlien,
      damage: s.damage, color: C.blue,
      splash: 0.75,                 // light splash so over-massing a single tile still hurts
      ttl: 0.22, life: 0.22,
    });
    s.shake = 0.12;
    state.alert = clamp(state.alert + 0.025, 0, 100);
  }

  function updateProjectiles(dt) {
    state.projectiles.forEach((p) => {
      p.ttl -= dt;
      if (p.ttl <= 0 && !p.done) { p.done = true; applyProjectile(p); }
    });
    state.projectiles = state.projectiles.filter((p) => p.ttl > -0.04 && !p.done);
  }

  function applyProjectile(p) {
    if (p.alien) { if (state.alien) damageAlien(p.damage * 0.6); return; }
    const t = state.units.find((u) => u.uid === p.targetUid && u.alive);
    if (!t) return;
    damageRaiderOrAlien(t, p.damage);
    addEffect("hit", scr(t.col, t.row).x, scr(t.col, t.row).y - 18, p.color, { r: 8 });
    // splash damage to clustered raiders around the impact
    if (p.splash) {
      const px = scr(t.col, t.row);
      state.units.forEach((u) => {
        if (u.alive && u.uid !== t.uid && dist(u.col, u.row, t.col, t.row) < p.splash) {
          damageRaiderOrAlien(u, p.damage * 0.25);
        }
      });
      addEffect("hit", px.x, px.y - 14, C.orange, { r: 14 });
    }
  }

  /* ---------- alien ---------- */
  function damageAlien(amount) {
    const a = state.alien;
    if (!a || a.escaped) return;
    let dmg = amount;
    // a Sign Guy escorting the alien provides damage cover
    if (state.units.some((u) => u.alive && u.id === "sign" && dist(u.col, u.row, a.col, a.row) < u.shieldRadius)) dmg *= 0.6;
    a.hp = clamp(a.hp - dmg, 0, a.maxHp);
    a.hit = 0.2;
    a.panic = 0.6;
    if (a.hp <= 0) endGame(false, "The alien was pinned down before reaching the van.");
  }

  function updateAlien(dt) {
    const a = state.alien;
    if (!a || a.escaped) return;
    a.bob += dt * 6;
    a.hit = Math.max(0, a.hit - dt);
    a.panic = Math.max(0, a.panic - dt * 0.8);
    a.attackCd = Math.max(0, a.attackCd - dt);

    // win once it slips past the western perimeter toward the van
    if (a.col <= 2.7) { a.escaped = true; addScore(2600, "EXTRACT", VAN_DRAW.c + 1, VAN_DRAW.r, C.green); endGame(true); return; }

    const step = bestStep(a.col, a.row, vanField);
    if (!step) {
      // at the field minimum — make a straight run for the van
      let dx = VAN_DRAW.c - a.col, dy = VAN_DRAW.r - a.row;
      const l = Math.hypot(dx, dy) || 1;
      a.col = clamp(a.col + (dx / l) * a.speed * dt, 0.1, GRID - 0.2);
      a.row = clamp(a.row + (dy / l) * a.speed * dt, 0.2, GRID - 0.2);
      return;
    }
    const s = occ[idx(step.nc, step.nr)];
    if (s && s.alive && s.type !== "hangar") {
      // the alien blasts blockers with its powers; raiders clear them faster
      if (a.attackCd <= 0) {
        a.attackCd = 0.45;
        s.hp -= 18; s.shake = 0.18;
        if (s.type === "lab") state.labHp = s.hp;
        addEffect("hit", scr(s.cx, s.cy).x, scr(s.cx, s.cy).y - s.height * 0.5, C.green, { r: 10 });
        if (s.hp <= 0 && s.alive) { s.alive = false; onStructureDown(s); }
      }
      return;
    }
    const escort = state.units.filter((u) => u.alive && dist(u.col, u.row, a.col, a.row) < 3).length;
    const speed = a.speed + Math.min(0.8, escort * 0.18) - a.panic * 0.5;
    let dx = step.nc + 0.5 - a.col, dy = step.nr + 0.5 - a.row;
    const len = Math.hypot(dx, dy) || 1;
    a.col = clamp(a.col + (dx / len) * Math.max(0.5, speed) * dt, 0.1, GRID - 0.2);
    a.row = clamp(a.row + (dy / len) * Math.max(0.5, speed) * dt, 0.2, GRID - 0.2);
  }

  function updateEffects(dt) {
    state.structures.forEach((s) => (s.shake = Math.max(0, s.shake - dt)));
    state.effects = state.effects
      .map((e) => ({ ...e, ttl: e.ttl - dt, r: e.r + dt * 78 }))
      .filter((e) => e.ttl > 0);
    state.floats = state.floats
      .map((f) => ({ ...f, ttl: f.ttl - dt, y: f.y + f.vy * dt }))
      .filter((f) => f.ttl > 0);
  }

  function updateWinLoss() {
    if (state.alert >= 100) { state.alert = 100; endGame(false, "Lockdown hit 100%. The base closed every gate at once."); }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackdrop();
    drawGround();
    drawSpawnZones();
    drawSearchCones();

    // depth-sorted pass: structures, units, guards, alien, van
    const items = [];
    state.structures.forEach((s) => {
      items.push({ key: s.c1 + s.r1, z: s.height, fn: () => drawStructure(s) });
    });
    state.units.forEach((u) => {
      items.push({ key: u.col + u.row, z: 30, fn: () => drawRaider(u) });
    });
    state.guards.forEach((g) => {
      items.push({ key: g.col + g.row, z: 28, fn: () => drawGuard(g) });
    });
    if (state.alien && !state.alien.escaped) {
      items.push({ key: state.alien.col + state.alien.row, z: 34, fn: drawAlien });
    }
    items.push({ key: VAN_DRAW.c + VAN_DRAW.r, z: 26, fn: drawVan });
    items.sort((a, b) => (a.key - b.key) || (a.z - b.z));
    items.forEach((i) => i.fn());

    drawProjectiles();
    drawEffects();
    drawFloats();
    drawHud();
    drawBanner();
  }

  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1422");
    g.addColorStop(1, "#04060d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function isCorridor(c, r) {
    const inside = c >= 4 && c <= 25 && r >= 4 && r <= 25;
    return inside && (c === 14 || c === 15 || r === 14 || r === 15);
  }

  function drawGround() {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const a = scr(c, r), b = scr(c + 1, r), d = scr(c + 1, r + 1), e = scr(c, r + 1);
        const road = isCorridor(c, r);
        const base = road ? C.road : (c + r) % 2 ? C.sand : C.sandDk;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y);
        ctx.closePath();
        ctx.fillStyle = base;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.16)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // soft vignette to seat the desert into the dark stage
    const vg = ctx.createRadialGradient(W / 2, H * 0.52, 120, W / 2, H * 0.52, 560);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(2,4,10,0.6)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSpawnZones() {
    if (state.mode !== "playing") return;
    ZONES.forEach((z, i) => {
      const active = state.zone === i || (state.hover.active && state.hover.zone === i);
      ctx.save();
      ctx.globalAlpha = active ? 0.32 + Math.sin(state.time * 4) * 0.06 : 0.14;
      ctx.fillStyle = z.color;
      forEachZoneTile(i, (c, r) => {
        const a = scr(c, r), b = scr(c + 1, r), d = scr(c + 1, r + 1), e = scr(c, r + 1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
      // sector label
      const cp = scr(z.c, z.r);
      ctx.save();
      ctx.fillStyle = active ? z.color : "rgba(251,250,244,0.7)";
      ctx.font = "900 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.shadowColor = "#000"; ctx.shadowBlur = 6;
      ctx.fillText(`${i + 1} ${z.name.toUpperCase()}`, cp.x, cp.y);
      ctx.restore();
    });
  }
  function forEachZoneTile(i, fn) {
    if (i === 0) { for (let r = 0; r <= 2; r++) for (let c = 3; c <= 16; c++) fn(c, r); }
    else if (i === 1) { for (let c = 17; c <= 19; c++) for (let r = 3; r <= 16; r++) fn(c, r); }
    else { for (let r = 17; r <= 19; r++) for (let c = 3; c <= 16; c++) fn(c, r); }
  }

  function drawSearchCones() {
    state.structures.forEach((s) => {
      if (s.type !== "light" || !s.alive || s.jam > 0) return;
      const dir = Math.sin(s.sweep) * 1.5;
      const base = scr(s.cx, s.cy);
      const oy = base.y - s.height;
      // project the tile-space cone direction into screen space
      const ux = (Math.cos(dir) - Math.sin(dir)) * (TILE_W / 2);
      const uy = (Math.cos(dir) + Math.sin(dir)) * (TILE_H / 2);
      const ang = Math.atan2(uy, ux);
      const reach = s.range * TILE_W * 0.62;
      ctx.save();
      ctx.translate(base.x, oy);
      ctx.rotate(ang);
      const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, reach);
      grad.addColorStop(0, "rgba(255,236,150,0.34)");
      grad.addColorStop(1, "rgba(255,212,59,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, reach, -0.42, 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  // generic 3D-ish iso block for a footprint with pixel height ph
  function drawBox(c0, r0, c1, r1, ph, top, left, right, stroke, shakeX) {
    const sx = shakeX || 0;
    const top0 = scr(c0, r0), rgt = scr(c1, r0), bot = scr(c1, r1), lft = scr(c0, r1);
    const up = (p) => ({ x: p.x + sx, y: p.y - ph });
    // right face
    ctx.beginPath();
    ctx.moveTo(rgt.x + sx, rgt.y); ctx.lineTo(bot.x + sx, bot.y);
    ctx.lineTo(up(bot).x, up(bot).y); ctx.lineTo(up(rgt).x, up(rgt).y); ctx.closePath();
    ctx.fillStyle = right; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    // left face
    ctx.beginPath();
    ctx.moveTo(lft.x + sx, lft.y); ctx.lineTo(bot.x + sx, bot.y);
    ctx.lineTo(up(bot).x, up(bot).y); ctx.lineTo(up(lft).x, up(lft).y); ctx.closePath();
    ctx.fillStyle = left; ctx.fill();
    if (stroke) ctx.stroke();
    // top face
    ctx.beginPath();
    ctx.moveTo(up(top0).x, up(top0).y); ctx.lineTo(up(rgt).x, up(rgt).y);
    ctx.lineTo(up(bot).x, up(bot).y); ctx.lineTo(up(lft).x, up(lft).y); ctx.closePath();
    ctx.fillStyle = top; ctx.fill();
    if (stroke) ctx.stroke();
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let R = (n >> 16) & 255, G = (n >> 8) & 255, B = n & 255;
    R = clamp(Math.round(R * f), 0, 255); G = clamp(Math.round(G * f), 0, 255); B = clamp(Math.round(B * f), 0, 255);
    return `rgb(${R},${G},${B})`;
  }

  function drawStructure(s) {
    const shk = s.shake > 0 ? Math.sin(state.time * 70) * 2.5 : 0;
    if (!s.alive) { drawRubble(s); return; }
    if (s.type === "lab") { drawLab(s, shk); return; }
    if (s.type === "light") { drawLight(s, shk); return; }
    if (s.type === "tower") { drawTower(s, shk); return; }
    if (s.type === "hangar") {
      drawBox(s.c, s.r, s.c1, s.r1, s.height, shade(C.metal, 1.25), shade(C.metal, 0.7), shade(C.metal, 0.9), "rgba(0,0,0,0.4)", shk);
      // roof ribs
      const t = scr(s.cx, s.r), b2 = scr(s.cx, s.r1);
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      for (let i = 1; i < s.w * 2; i++) {
        const f = i / (s.w * 2);
        const p1 = scr(lerp(s.c, s.c1, f), s.r), p2 = scr(lerp(s.c, s.c1, f), s.r1);
        ctx.beginPath(); ctx.moveTo(p1.x + shk, p1.y - s.height); ctx.lineTo(p2.x + shk, p2.y - s.height); ctx.stroke();
      }
      return;
    }
    if (s.type === "wall") {
      // inner keep — solid concrete rampart
      const col = "#7d8492";
      drawBox(s.c, s.r, s.c1, s.r1, s.height, shade(col, 1.16), shade(col, 0.52), shade(col, 0.74), "rgba(0,0,0,0.5)", shk);
      // crenellation notches along the top edge
      const a = scr(s.c, s.r1), b = scr(s.c1, s.r1);
      ctx.save();
      ctx.fillStyle = shade(col, 1.3);
      for (let i = 0; i < 2; i++) {
        const f = 0.28 + i * 0.44;
        const x = lerp(a.x, b.x, f) + shk;
        const y = lerp(a.y, b.y, f) - s.height;
        ctx.fillRect(x - 3, y - 4, 6, 4);
      }
      ctx.restore();
      if (s.hp < s.maxHp) structHealthBar(s);
      return;
    }
    // fence / gate
    const isGate = s.type === "gate";
    const col = isGate ? C.yellow : "#9aa6b8";
    drawBox(s.c, s.r, s.c1, s.r1, s.height, shade(col, 1.2), shade(col, 0.55), shade(col, 0.78), "rgba(0,0,0,0.42)", shk);
    if (isGate) {
      // hazard chevrons on the front face
      const lft = scr(s.c, s.r1), bot = scr(s.c1, s.r1);
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#1a1407"; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const f = (i + 0.5) / 3;
        const x = lerp(lft.x, bot.x, f) + shk;
        const y = lerp(lft.y, bot.y, f) - s.height * 0.5;
        ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x, y); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      }
      ctx.restore();
    } else {
      // chain-link mesh on the top edge
      const a = scr(s.c, s.r1), b = scr(s.c1, s.r1);
      ctx.save(); ctx.globalAlpha = 0.4; ctx.strokeStyle = "#cdd6e2"; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const x = lerp(a.x, b.x, i / 4) + shk;
        ctx.beginPath(); ctx.moveTo(x, lerp(a.y, b.y, i / 4)); ctx.lineTo(x, lerp(a.y, b.y, i / 4) - s.height); ctx.stroke();
      }
      ctx.restore();
    }
    if (s.hp < s.maxHp) structHealthBar(s);
  }

  function drawRubble(s) {
    const p = scr(s.cx, s.cy);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(40,30,20,0.7)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, TILE_W * 0.32 * s.w, TILE_H * 0.4 * s.h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(90,80,70,0.6)";
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(p.x - 12 + i * 7 + (i % 2) * 3, p.y - 4 - (i % 3) * 3, 6, 5);
    }
    ctx.restore();
  }

  function drawTower(s, shk) {
    drawBox(s.c + 0.12, s.r + 0.12, s.c1 - 0.12, s.r1 - 0.12, s.height * 0.7, shade("#3a4252", 1.2), shade("#3a4252", 0.6), shade("#3a4252", 0.85), "rgba(0,0,0,0.5)", shk);
    // turret cab on top
    const top = scr(s.cx, s.cy);
    const oy = top.y - s.height * 0.7;
    ctx.save();
    ctx.translate(top.x + shk, oy);
    ctx.fillStyle = s.jam > 0 ? shade(C.cyan, 0.7) : "#2b313e";
    roundRect(-14, -16, 28, 16, 4); ctx.fill();
    ctx.strokeStyle = s.jam > 0 ? C.cyan : C.red; ctx.lineWidth = 1.5; ctx.stroke();
    // muzzle glow
    ctx.fillStyle = s.jam > 0 ? C.cyan : (s.cd < 0.2 ? C.yellow : C.red);
    ctx.beginPath(); ctx.arc(0, -8, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (s.jam > 0) jamTag(top.x + shk, oy - 22);
    if (s.hp < s.maxHp) structHealthBar(s);
  }

  function drawLight(s, shk) {
    // pole
    const base = scr(s.cx, s.cy);
    ctx.save();
    ctx.strokeStyle = "#4a5161"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(base.x + shk, base.y); ctx.lineTo(base.x + shk, base.y - s.height); ctx.stroke();
    // lamp head
    const ly = base.y - s.height;
    ctx.fillStyle = s.jam > 0 ? shade(C.cyan, 0.8) : "#2b313e";
    roundRect(base.x + shk - 9, ly - 9, 18, 12, 3); ctx.fill();
    ctx.fillStyle = s.jam > 0 ? C.cyan : "#fff2bd";
    ctx.beginPath(); ctx.arc(base.x + shk, ly - 3, 4, 0, Math.PI * 2); ctx.fill();
    if (s.jam > 0) jamTag(base.x + shk, ly - 22);
    ctx.restore();
    if (s.hp < s.maxHp) structHealthBar(s);
  }

  function drawLab(s, shk) {
    const broken = state.labHp <= 0;
    const base = shade(broken ? "#16321d" : "#241638", 1);
    drawBox(s.c + 0.2, s.r + 0.2, s.c1 - 0.2, s.r1 - 0.2, s.height * 0.55,
      shade(base, 1.3), shade(base, 0.6), shade(base, 0.85), "rgba(0,0,0,0.5)", shk);
    // dome
    const top = scr(s.cx, s.cy);
    const oy = top.y - s.height * 0.55;
    ctx.save();
    ctx.translate(top.x + shk, oy);
    const domeCol = broken ? C.green : C.pink;
    const grd = ctx.createLinearGradient(0, -46, 0, 4);
    grd.addColorStop(0, shade(domeCol, broken ? 0.9 : 0.8));
    grd.addColorStop(1, shade(domeCol, 0.35));
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.ellipse(0, 0, 50, 30, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 50, 14, 0, 0, Math.PI * 2); ctx.fillStyle = shade(domeCol, 0.5); ctx.fill();
    // energy shield ring (intact only)
    if (!broken) {
      ctx.globalAlpha = 0.5 + Math.sin(state.time * 4) * 0.12;
      ctx.strokeStyle = C.pink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -18, 54, 34, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      // freed-alien glow
      ctx.globalAlpha = 0.25 + Math.sin(state.time * 5) * 0.08;
      ctx.fillStyle = C.green;
      ctx.beginPath(); ctx.arc(0, -18, 40, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // label + core HP
    ctx.save();
    ctx.fillStyle = broken ? C.green : C.pink;
    ctx.font = "900 11px JetBrains Mono, monospace";
    ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 7;
    ctx.fillText(broken ? "LAB OPEN" : "LABORATORY", top.x + shk, oy - 54);
    ctx.restore();
    if (!broken) healthBar(top.x + shk - 40, oy - 50, 80, 6, state.labHp / LAB_MAX_HP, C.pink);
  }

  function jamTag(x, y) {
    ctx.save();
    ctx.fillStyle = C.cyan;
    ctx.font = "900 9px JetBrains Mono, monospace";
    ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 5;
    ctx.fillText("JAM", x, y);
    ctx.restore();
  }

  function structHealthBar(s) {
    const p = scr(s.cx, s.r);
    healthBar(p.x - 22, p.y - s.height - 12, 44, 5, s.hp / s.maxHp, s.type === "gate" ? C.yellow : C.cyan);
  }

  /* ---------- figures ---------- */
  function drawRaider(u) {
    const p = scr(u.col, u.row);
    const dy = Math.sin(u.bob) * 1.8;
    ctx.save();
    // shield aura under foot
    if (u.shielded) {
      ctx.globalAlpha = 0.2; ctx.fillStyle = C.green;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // EMP ring
    if (u.id === "tinfoil") {
      ctx.globalAlpha = 0.14 + Math.sin(state.time * 6 + u.uid) * 0.04;
      ctx.strokeStyle = C.yellow; ctx.lineWidth = 2; ctx.setLineDash([7, 7]);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, u.jamRadius * TILE_W * 0.5, u.jamRadius * TILE_H * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (u.dying > 0) ctx.globalAlpha = clamp(u.dying / 0.35, 0, 1);

    const flash = u.hit > 0;
    const litRing = u.lit > 0;
    if (litRing) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = C.red; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 13, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = u.dying > 0 ? clamp(u.dying / 0.35, 0, 1) : 1;
    }
    const art = drawTroopModel(u, p, dy, flash);
    if (art) {
      healthBar(p.x - 14, p.y + dy - art.h - 7, 28, 3.5, u.hp / u.maxHp, u.color);
      ctx.restore();
      return;
    }
    const body = flash ? "#ffb3c0" : u.color;
    ctx.shadowColor = u.color; ctx.shadowBlur = 8;
    const bx = p.x, by = p.y - 10 + dy;
    // body
    ctx.fillStyle = body;
    roundRect(bx - 6 * u.face, by - 16, 12, 18, 4); ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(bx, by - 20, 5.5, 0, Math.PI * 2); ctx.fillStyle = "#f3d9b0"; ctx.fill();
    ctx.shadowBlur = 0;
    // role props
    if (u.id === "runner") { // headband + lean
      ctx.strokeStyle = body; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - 5, by - 21); ctx.lineTo(bx + 5, by - 22); ctx.stroke();
    } else if (u.id === "streamer") { // phone
      ctx.fillStyle = "#101522"; ctx.fillRect(bx + 6 * u.face - 2, by - 14, 4, 7);
    } else if (u.id === "tinfoil") { // foil hat
      ctx.fillStyle = "#d7dbe2"; ctx.beginPath();
      ctx.moveTo(bx - 6, by - 23); ctx.lineTo(bx + 6, by - 23); ctx.lineTo(bx, by - 31); ctx.closePath(); ctx.fill();
    } else if (u.id === "sign") { // big sign
      ctx.fillStyle = "#f4ead2"; roundRect(bx - 9, by - 34, 18, 11, 2); ctx.fill();
      ctx.fillStyle = body; ctx.fillRect(bx - 7, by - 32, 14, 2); ctx.fillRect(bx - 7, by - 28, 10, 2);
    }
    // short id + health
    healthBar(bx - 12, by - 30, 24, 3.5, u.hp / u.maxHp, u.color);
    ctx.restore();
  }

  function drawTroopModel(u, p, dy, flash) {
    const img = troopModels[u.id];
    if (!img || !img.complete || !img.naturalWidth) return null;
    const h = u.modelHeight || 54;
    const w = h * (img.naturalWidth / img.naturalHeight);
    ctx.save();
    ctx.translate(p.x, p.y + dy + (u.modelLift || 0));
    if (u.face < 0) ctx.scale(-1, 1);
    ctx.shadowColor = flash ? "#fbfaf4" : u.color;
    ctx.shadowBlur = flash ? 12 : 8;
    ctx.filter = flash ? "brightness(1.65) saturate(1.25)" : "none";
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    return { w, h };
  }

  function drawGuard(g) {
    const p = scr(g.col, g.row);
    const dy = Math.sin(g.bob) * 1.5;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    const by = p.y - 10 + dy;
    ctx.fillStyle = g.hit > 0 ? "#ff9aa8" : "#39414f";
    roundRect(p.x - 6, by - 16, 12, 18, 4); ctx.fill();
    ctx.fillStyle = "#e9c79c";
    ctx.beginPath(); ctx.arc(p.x, by - 20, 5, 0, Math.PI * 2); ctx.fill();
    // cap + red visor
    ctx.fillStyle = "#23272f"; roundRect(p.x - 6, by - 25, 12, 4, 2); ctx.fill();
    ctx.fillStyle = C.red; ctx.fillRect(p.x - 4, by - 21, 8, 1.8);
    // rifle
    ctx.strokeStyle = "#11151d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x + 2, by - 10); ctx.lineTo(p.x + 11, by - 12); ctx.stroke();
    healthBar(p.x - 11, by - 30, 22, 3, g.hp / g.maxHp, C.red);
    ctx.restore();
  }

  function drawAlien() {
    const a = state.alien;
    const p = scr(a.col, a.row);
    const dy = Math.sin(a.bob) * 2;
    ctx.save();
    // glow
    const gr = ctx.createRadialGradient(p.x, p.y - 12, 4, p.x, p.y - 12, 34);
    gr.addColorStop(0, "rgba(107,255,125,0.5)"); gr.addColorStop(1, "rgba(107,255,125,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y - 12, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = C.green; ctx.shadowBlur = 14;
    const by = p.y - 12 + dy;
    ctx.fillStyle = a.hit > 0 ? "#d8ffe0" : "#9cf7a8";
    // body
    roundRect(p.x - 6, by - 10, 12, 16, 5); ctx.fill();
    // big head
    ctx.beginPath(); ctx.ellipse(p.x, by - 14, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // eyes
    ctx.fillStyle = "#0b1410";
    ctx.beginPath(); ctx.ellipse(p.x - 3.4, by - 14, 2.2, 3.4, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x + 3.4, by - 14, 2.2, 3.4, -0.4, 0, Math.PI * 2); ctx.fill();
    healthBar(p.x - 16, by - 30, 32, 4, a.hp / a.maxHp, C.green);
    ctx.restore();
  }

  function drawVan() {
    const p = scr(VAN_DRAW.c, VAN_DRAW.r);
    const ready = !!state.alien;
    ctx.save();
    // glow when it's the active objective
    const gr = ctx.createRadialGradient(p.x, p.y - 10, 6, p.x, p.y - 10, 46);
    gr.addColorStop(0, ready ? "rgba(107,255,125,0.4)" : "rgba(46,224,255,0.22)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y - 10, 46, 0, Math.PI * 2); ctx.fill();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = ready ? "#3bd06a" : "#2f6f48";
    roundRect(p.x - 28, p.y - 22, 56, 26, 6); ctx.fill();
    ctx.fillStyle = "#1b2330"; roundRect(p.x - 4, p.y - 20, 26, 14, 4); ctx.fill();
    ctx.fillStyle = "#9fd9ff"; roundRect(p.x - 0, p.y - 18, 10, 10, 2); ctx.fill();
    roundRect(p.x + 12, p.y - 18, 8, 10, 2); ctx.fill();
    // wheels
    ctx.fillStyle = "#0c0f16";
    ctx.beginPath(); ctx.arc(p.x - 16, p.y + 5, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x + 16, p.y + 5, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ready ? C.green : C.dim;
    ctx.font = "900 10px JetBrains Mono, monospace"; ctx.textAlign = "center";
    ctx.shadowColor = "#000"; ctx.shadowBlur = 6;
    ctx.fillText("GETAWAY VAN", p.x, p.y - 30);
    ctx.restore();
  }

  function drawProjectiles() {
    state.projectiles.forEach((p) => {
      const t = clamp(p.ttl / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.85 * easeOut(t);
      ctx.strokeStyle = p.color; ctx.lineWidth = 2.4;
      ctx.shadowColor = p.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.tx, p.ty); ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(lerp(p.tx, p.x, t), lerp(p.ty, p.y, t), 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  function drawEffects() {
    state.effects.forEach((e) => {
      const t = clamp(e.ttl / e.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = easeOut(t);
      ctx.strokeStyle = e.color; ctx.lineWidth = e.type === "deploy" ? 3.5 : 2.5;
      if (e.type === "deploy") ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }

  function drawFloats() {
    state.floats.forEach((f) => {
      const t = clamp(f.ttl / f.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = easeOut(t);
      ctx.fillStyle = f.color;
      ctx.font = "900 13px JetBrains Mono, monospace"; ctx.textAlign = "center";
      ctx.shadowColor = "#000"; ctx.shadowBlur = 7;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
  }

  function drawHud() {
    // on-canvas objective ribbon
    const obj = currentObjective();
    ctx.save();
    ctx.fillStyle = "rgba(3, 6, 17, 0.72)";
    ctx.strokeStyle = "rgba(46, 224, 255, 0.34)"; ctx.lineWidth = 1.4;
    roundRect(W / 2 - 190, 10, 380, 36, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.green; ctx.font = "900 11px JetBrains Mono, monospace"; ctx.textAlign = "center";
    ctx.fillText(obj.title.toUpperCase(), W / 2, 26);
    ctx.fillStyle = C.dim; ctx.font = "700 9px JetBrains Mono, monospace";
    ctx.fillText(shortTip(obj.tip), W / 2, 39);
    ctx.restore();
  }
  function shortTip(t) { return t.length > 62 ? t.slice(0, 59) + "..." : t; }

  function drawBanner() {
    if (state.banner.ttl <= 0 || !state.banner.text) return;
    const t = clamp(state.banner.ttl / state.banner.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = easeOut(t);
    ctx.fillStyle = "rgba(3, 6, 17, 0.8)";
    ctx.strokeStyle = state.banner.color; ctx.lineWidth = 2;
    roundRect(W / 2 - 170, 54, 340, 38, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = state.banner.color;
    ctx.font = "900 14px Bungee, system-ui"; ctx.textAlign = "center";
    ctx.fillText(state.banner.text, W / 2, 79);
    ctx.restore();
  }

  function healthBar(x, y, w, h, pct, color) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.42 ? color : pct > 0.18 ? C.yellow : C.red;
    ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ============================================================
     DOM HUD
     ============================================================ */
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
    el.alien.textContent = state.alien
      ? (state.alien.escaped ? "FREE" : "ESCORT")
      : (state.labHp <= 0 ? "LOOSE" : "CAPTIVE");
    const obj = currentObjective();
    el.objective.textContent = obj.title;
    el.tip.textContent = obj.tip;
    renderSquadList();
    const def = selectedDef();
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
    const breached = state.structures.some((s) => s.type === "gate" && !s.alive);
    return state.mode === "playing" ? (breached ? "BREACH" : "RAID") : "RALLY";
  }

  function currentObjective() {
    if (state.mode === "won") return { title: "Alien in the van", tip: "Perfectly normal road trip begins now." };
    if (state.mode === "lost") return { title: "Lockdown", tip: "The base sealed itself. Rebuild the wave and try again." };
    if (state.alien && !state.alien.escaped) return { title: "Escort the alien west", tip: "Shield the alien from towers and guards on the way to the van." };
    if (state.labHp <= 0) return { title: "Alien is loose", tip: "Keep raiders alive and clear the path to the van." };
    if (state.labHp < LAB_MAX_HP) return { title: "Crack the Laboratory", tip: "Keep raiders on the lab dome until the core fails." };
    const gateDown = state.structures.some((s) => s.type === "gate" && !s.alive);
    if (gateDown) return { title: "Push to the Laboratory", tip: "You're inside. Drive raiders to the central dome and smash it." };
    if (state.mode === "playing") return { title: "Breach the perimeter", tip: "Send raiders at a sector — they'll smash the nearest fence or gate to get in." };
    return { title: "Rally on the perimeter", tip: "Start the raid, then pick a squad and click a deployment sector." };
  }

  function renderSquadList() {
    if (!squadList) return;
    const active = document.activeElement;
    squadList.innerHTML = unitDefs.map((u) => {
      const cls = u.id === state.selected ? " is-active" : "";
      const afford = state.hype >= u.cost;
      const status = u.id === state.selected ? "SELECTED" : afford ? "PICK" : "NEED HYPE";
      return `
        <button class="storm-squad${cls}" type="button" data-squad="${u.id}" style="--squad-color:${u.color}" aria-label="Select ${u.name}">
          <span class="storm-squad__chip" aria-hidden="true"><img src="${u.icon}" alt="" loading="lazy" /></span>
          <span class="storm-squad__copy"><strong>${u.name}</strong><span>${u.desc} · ${u.cost} hype</span></span>
          <span class="storm-squad__cooldown">${status}</span>
        </button>`;
    }).join("");
    if (active && active.dataset && active.dataset.squad) {
      const same = squadList.querySelector(`[data-squad="${active.dataset.squad}"]`);
      if (same) same.focus({ preventScroll: true });
    }
  }

  function renderMobileControls(def) {
    if (!mobileSquadList || !mobileLaneList) return;
    const sel = def || selectedDef();
    const canDeploy = state.mode === "playing" && !paused && state.hype >= sel.cost;
    const canRush = state.mode === "playing" && !paused && state.rushCd <= 0 && state.hype >= rushCost();
    if (mobileSelected) mobileSelected.textContent = `${sel.short} · ${ZONES[state.zone].name}`;
    if (mobileHype) mobileHype.textContent = `Hype ${Math.round(state.hype)}%`;

    if (!mobileSquadList.children.length) {
      mobileSquadList.innerHTML = unitDefs.map((u) => `
        <button class="storm-mobile-unit" type="button" data-mobile-squad="${u.id}" style="--squad-color:${u.color}" aria-label="Select ${u.name}">
          <img class="storm-mobile-unit__icon" src="${u.icon}" alt="" aria-hidden="true" loading="lazy" />
          <strong>${u.short}</strong><span>${u.cost}</span>
        </button>`).join("");
    }
    unitDefs.forEach((u) => {
      const btn = mobileSquadList.querySelector(`[data-mobile-squad="${u.id}"]`);
      if (!btn) return;
      btn.classList.toggle("is-active", u.id === state.selected);
      btn.classList.toggle("is-low", state.hype < u.cost);
      btn.setAttribute("aria-pressed", String(u.id === state.selected));
    });

    if (!mobileLaneList.children.length) {
      mobileLaneList.innerHTML = ZONES.map((z, i) => `
        <button class="storm-mobile-lane" type="button" data-mobile-lane="${i}" style="--lane-color:${z.color}">
          <strong>${i + 1}</strong><span>${z.name.toUpperCase()}</span>
        </button>`).join("");
    }
    ZONES.forEach((z, i) => {
      const btn = mobileLaneList.querySelector(`[data-mobile-lane="${i}"]`);
      if (!btn) return;
      btn.classList.toggle("is-active", i === state.zone);
      btn.disabled = !canDeploy;
      btn.setAttribute("aria-label", `Deploy ${sel.name} from ${z.name}`);
    });

    if (mobileDeploy) { mobileDeploy.textContent = `Deploy ${sel.cost}`; mobileDeploy.disabled = !canDeploy; }
    if (mobileRush) { mobileRush.textContent = state.rushCd > 0 ? `${Math.ceil(state.rushCd)}s` : "Rush"; mobileRush.disabled = !canRush; }
    if (mobilePause) { mobilePause.textContent = paused ? "Resume" : "Pause"; mobilePause.disabled = state.mode !== "playing"; }
  }

  function markDirty() { state.dirtyUi = true; }

  /* ============================================================
     INPUT
     ============================================================ */
  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const t = evt.touches && evt.touches[0] ? evt.touches[0]
      : evt.changedTouches && evt.changedTouches[0] ? evt.changedTouches[0] : evt;
    return { x: ((t.clientX - rect.left) / rect.width) * W, y: ((t.clientY - rect.top) / rect.height) * H };
  }

  function onPointerMove(evt) {
    const p = canvasPoint(evt);
    const t = screenToTile(p.x, p.y);
    state.hover = { active: true, col: t.col, row: t.row, zone: zoneAt(Math.floor(t.col), Math.floor(t.row)) };
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    if (state.mode !== "playing" || paused) return;
    const p = canvasPoint(evt);
    const t = screenToTile(p.x, p.y);
    const z = zoneAt(Math.floor(t.col), Math.floor(t.row));
    if (z >= 0) {
      setZone(z);
      deploy({ col: t.col, row: t.row });
    } else {
      bumpBanner("Deploy on a glowing sector", C.yellow, 1.1);
    }
  }

  function handleKey(evt) {
    if (evt.key >= "1" && evt.key <= "4") { selectSquad(unitDefs[Number(evt.key) - 1].id); return; }
    const k = evt.key.toLowerCase();
    if (k === "z") return setZone(0);
    if (k === "x") return setZone(1);
    if (k === "c") return setZone(2);
    if (k === "q" || evt.key === " ") {
      if (overlay.classList.contains("overlay--show") && evt.key === " ") btnStart.click();
      else deploy();
      return;
    }
    if (k === "e") return queueRush();
    if (k === "p" || evt.key === "Escape") togglePause();
  }

  function setupFullscreen() {
    if (!btnFullscreen || !wrap) return;
    let maxed = false;
    function setMaxed(on) {
      maxed = on;
      wrap.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      btnFullscreen.textContent = on ? "✕" : "⛶";
      btnFullscreen.setAttribute("title", on ? "Exit" : "Max screen");
      btnFullscreen.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      setTimeout(() => canvas.focus({ preventScroll: true }), 0);
    }
    btnFullscreen.addEventListener("click", () => setMaxed(!maxed));
    document.addEventListener("keydown", (evt) => { if (evt.key === "Escape" && maxed) setMaxed(false); });
  }

  function playBlip(freq, duration, type) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = playBlip.ac || (playBlip.ac = new AC());
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
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(t); osc.stop(t + duration + 0.02);
    } catch (_) {}
  }

  /* ============================================================
     LOOP + BOOT
     ============================================================ */
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
    btnAbility.addEventListener("click", () => deploy());
    btnRally.addEventListener("click", queueRush);
    squadList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-squad]");
      if (b) selectSquad(b.dataset.squad);
    });
    if (mobileSquadList) mobileSquadList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mobile-squad]");
      if (b) selectSquad(b.dataset.mobileSquad);
    });
    if (mobileLaneList) mobileLaneList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mobile-lane]");
      if (!b) return;
      setZone(Number(b.dataset.mobileLane));
      deploy();
    });
    if (mobileDeploy) mobileDeploy.addEventListener("click", () => deploy());
    if (mobileRush) mobileRush.addEventListener("click", queueRush);
    if (mobilePause) mobilePause.addEventListener("click", togglePause);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerleave", () => (state.hover.active = false));
    window.addEventListener("keydown", handleKey);
    setupFullscreen();
  }

  function init() {
    loadTroopAssets();
    bindEvents();
    resetGame();
    draw();
  }

  // debug hook — drive flow, force spawns, win/lose during testing
  window.__STORM51 = {
    state,
    startGame,
    selectSquad,
    setZone,
    deploy,
    spawnUnit: (id, c, r) => spawnUnit(id, c == null ? ZONES[state.zone].c : c, r == null ? ZONES[state.zone].r : r),
    queueRush,
    freeAlien: () => { const l = labStruct(); if (l) { l.alive = false; l.hp = 0; state.labHp = 0; onStructureDown(l); } },
    addHype: (n) => { state.hype = clamp(state.hype + (n || 50), 0, 100); markDirty(); },
    setAlert: (n) => { state.alert = clamp(n, 0, 100); markDirty(); },
    troopModels,
    // deterministic stepper so balance can be verified without the hidden-tab rAF throttle
    step: (n, dt) => { n = n || 60; dt = dt || 1 / 60; for (let i = 0; i < n; i++) update(dt); draw(); updateUi(); },
    fields: () => ({ labField, vanField, costGrid }),
    scr, screenToTile,
    win: () => endGame(true),
    lose: () => endGame(false),
  };

  init();
  raf = requestAnimationFrame(loop);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
})();
