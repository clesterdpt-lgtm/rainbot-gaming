/* ============================================================
   Unhoused and Unhinged
   Low-poly 3D sandbox prototype for Rainbot Network.
   Plain Three.js, no build step.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "unhoused-and-unhinged";
  const QUERY = new URLSearchParams(window.location.search);
  const DEBUG_TIMERS = QUERY.has("debug");
  const VISUAL_TARGET = QUERY.get("visual") === "target" || QUERY.has("cinematic");
  const TOP_DOWN_VIEW = VISUAL_TARGET || QUERY.get("visual") === "topdown" || QUERY.get("view") === "topdown" || QUERY.has("topdown");
  const DAY_SECONDS = DEBUG_TIMERS ? 8 : 78;
  const NIGHT_SECONDS = DEBUG_TIMERS ? 14 : 58;
  const WORLD_LIMIT_X = 34;
  const WORLD_LIMIT_Z = 25;
  const HEAT_CHASE_AT = 66;
  const WAVE_TARGET = 14;
  const RUN_CYCLES = 3;
  const BOSS_CYCLE = RUN_CYCLES;
  const PLAYER_RADIUS = 0.85;
  const BASE_MAX_HEALTH = 100;
  const BASE_MAX_CONES = 4;
  const BASE_MAX_PEELS = 4;
  const SCRIPT_URL = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL("../assets/js/unhoused-and-unhinged.js", location.href).href;
  const RAPIER_URL = new URL("../vendor/rapier/rapier-0.19.3.mjs", SCRIPT_URL).href;

  const THREE = window.THREE;
  const canvas = document.getElementById("gameCanvas");
  const $ = (id) => document.getElementById(id);

  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    dawnChoiceGrid: $("dawn-choice-grid"),
    primary: $("btn-primary"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    actionGrid: $("action-grid"),
    upgradeGrid: $("upgrade-grid"),
    campUpgradeGrid: $("camp-upgrade-grid"),
    gearSummary: $("gear-summary"),
    campSummary: $("camp-summary"),
    statusChip: $("status-chip"),
    dawnPerkChip: $("dawn-perk-chip"),
    dawnPerkText: $("dawn-perk-text"),
    bossChip: $("haze-boss-chip"),
    bossText: $("haze-boss-text"),
    objectiveChip: $("objective-chip"),
    objectiveArrow: $("objective-arrow"),
    objectiveText: $("objective-text"),
    districtName: $("district-name"),
    districtTrait: $("district-trait"),
    directorReadout: $("director-readout"),
    favorTitle: $("favor-title"),
    favorDesc: $("favor-desc"),
    favorProgress: $("favor-progress"),
    favorProgressText: $("favor-progress-text"),
    favorReward: $("favor-reward"),
    cityLog: $("city-log"),
    hudPhase: $("hud-phase"),
    hudCash: $("hud-cash"),
    hudHeat: $("hud-heat"),
    hudEnergy: $("hud-energy"),
    hudHealth: $("hud-health"),
    hudHigh: $("hud-high"),
    hudClock: $("hud-clock"),
    hudTaskFood: $("hud-task-food"),
    hudTaskWater: $("hud-task-water"),
    hudTaskBusk: $("hud-task-busk"),
    hudTaskBuskLabel: $("hud-task-busk-label"),
    hudTaskHeat: $("hud-task-heat"),
    hudTaskHeatLabel: $("hud-task-heat-label"),
    hudNotorietyFill: $("hud-notoriety-fill"),
    hudNotorietyStars: $("hud-notoriety-stars"),
    hudMiniPlayer: $("hud-mini-player"),
    hudSurvivalHealth: $("hud-survival-health"),
    hudSurvivalHealthText: $("hud-survival-health-text"),
    hudSurvivalThirst: $("hud-survival-thirst"),
    hudSurvivalThirstText: $("hud-survival-thirst-text"),
    hudSurvivalHunger: $("hud-survival-hunger"),
    hudSurvivalHungerText: $("hud-survival-hunger-text"),
    hudSurvivalMorale: $("hud-survival-morale"),
    hudSurvivalMoraleText: $("hud-survival-morale-text"),
    hudCashLarge: $("hud-cash-large"),
    hudSlotAction: $("hud-slot-action"),
    hudSlotActionLabel: $("hud-slot-action-label"),
    hudSlotScrapCount: $("hud-slot-scrap-count"),
    hudSlotConeCount: $("hud-slot-cone-count"),
    hudSlotPeelCount: $("hud-slot-peel-count"),
    hudSlotTool: $("hud-slot-tool"),
    hudSlotToolLabel: $("hud-slot-tool-label"),
    hudPromptE: $("hud-prompt-e"),
    hudPromptSpace: $("hud-prompt-space"),
    hudPromptJ: $("hud-prompt-j"),
    hudPromptL: $("hud-prompt-l"),
    meterTime: $("meter-time"),
    meterTimeText: $("meter-time-text"),
    meterArrest: $("meter-arrest"),
    meterArrestText: $("meter-arrest-text"),
    meterWave: $("meter-wave"),
    meterWaveText: $("meter-wave-text"),
    meterHype: $("meter-hype"),
    meterHypeText: $("meter-hype-text"),
    meterTumble: $("meter-tumble"),
    meterTumbleText: $("meter-tumble-text"),
    meterPeel: $("meter-peel"),
    meterPeelText: $("meter-peel-text"),
    gigTitle: $("gig-title"),
    gigDesc: $("gig-desc"),
    gigProgress: $("gig-progress"),
    gigProgressText: $("gig-progress-text"),
    gigReward: $("gig-reward"),
    meterScrap: $("meter-scrap"),
    meterScrapText: $("meter-scrap-text"),
    jobTitle: $("job-title"),
    jobDesc: $("job-desc"),
    jobProgress: $("job-progress"),
    jobProgressText: $("job-progress-text"),
    jobReward: $("job-reward"),
    mobileUp: $("btn-up"),
    mobileDown: $("btn-down"),
    mobileLeft: $("btn-left"),
    mobileRight: $("btn-right"),
    mobileAct: $("btn-act"),
    mobileAttack: $("btn-attack"),
  };

  const api = window.RB || {
    toast: () => {},
    recordScore: () => false,
    getHighScore: () => 0,
  };

  if (!THREE || !canvas) {
    if (el.overlayTitle) el.overlayTitle.textContent = "3D RUNTIME FAILED";
    if (el.overlaySub) el.overlaySub.textContent = "Three.js did not load. Refresh the page or check the local vendor file.";
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(63, 960 / 600, 0.1, 240);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x07101c, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const clock = new THREE.Clock();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpVec3 = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const DEFAULT_CAMERA_YAW = TOP_DOWN_VIEW ? -0.78 : -1.5;
  const DEFAULT_CAMERA_PITCH = TOP_DOWN_VIEW ? 1.3 : 0.22;
  const DEFAULT_CAMERA_DISTANCE = TOP_DOWN_VIEW ? 20 : 6.65;
  const DEFAULT_CAMERA_SHOULDER = TOP_DOWN_VIEW ? 0 : 0.6;
  const cameraLook = {
    yaw: DEFAULT_CAMERA_YAW,
    pitch: DEFAULT_CAMERA_PITCH,
    distance: DEFAULT_CAMERA_DISTANCE,
    shoulder: DEFAULT_CAMERA_SHOULDER,
    minPitch: TOP_DOWN_VIEW ? 0.92 : 0.12,
    maxPitch: TOP_DOWN_VIEW ? 1.42 : 0.74,
    sensitivity: 0.0032,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    lockReleasedAt: 0,
  };
  const playerStart = new THREE.Vector3(2.1, 0, -8.55);

  const palette = {
    asphalt: 0x30363c,
    sidewalk: 0x77716a,
    curb: 0xf3c744,
    grass: 0x315b3e,
    player: 0xffd15f,
    playerCoat: 0x315f39,
    cop: 0x2ee0ff,
    zombie: 0x90ff62,
    cone: 0xff7b26,
    cash: 0x75ff92,
    danger: 0xff4b6d,
    night: 0x10122c,
  };

  const materials = {};
  const world = {
    root: new THREE.Group(),
    props: [],
    blockers: [],
    pedestrians: [],
    cops: [],
    zombies: [],
    projectiles: [],
    traps: [],
    floaters: [],
    interactables: [],
    carriedItem: null,
    objectiveBeacon: null,
    markers: {},
    lights: {},
    animatedVisuals: [],
    physics: null,
    pedSerial: 0,
  };

  const input = {
    keys: new Set(),
    virtual: new Set(),
    lastMove: new THREE.Vector3(0, 0, -1),
  };

  const state = {
    ready: false,
    running: false,
    paused: false,
    gameOver: false,
    overlayMode: "start",
    awaitingDawnChoice: false,
    phase: "day",
    cycle: 1,
    time: 0,
    cash: 0,
    scrap: 0,
    heat: 0,
    hype: 0,
    energy: 100,
    health: 100,
    maxHealth: BASE_MAX_HEALTH,
    score: 0,
    high: api.getHighScore(GAME_ID),
    arrest: 0,
    action: "dance",
    actionCooldown: 0,
    attackCooldown: 0,
    throwCooldown: 0,
    stuntCooldown: 0,
    trapCooldown: 0,
    gooSlowTime: 0,
    tumbleTime: 0,
    tumbleDuration: 0,
    tumbleCombo: 0,
    tumbleHits: 0,
    tumbleCash: 0,
    tumbleSpin: 1,
    tumbleDistance: 0,
    bestTumble: 0,
    messageTimer: 0,
    waveKills: 0,
    waveSpawned: 0,
    waveSpawnTimer: 0,
    nightBossSpawned: false,
    seenHazeVariants: {},
    chaseActive: false,
    chaseCooldown: 0,
    chaseEscalation: 0,
    backupCalled: false,
    physicsReady: false,
    physicsFallback: false,
    currentDistrictId: "",
    directorPressure: 0,
    directorTimer: 0,
    directorIncident: "openBlock",
    directorIncidentTimer: 0,
    activeFavor: null,
    favorProgress: {},
    completedFavors: new Set(),
    gigIndex: 0,
    activeGig: null,
    gigActions: new Set(),
    jobIndex: 0,
    activeJob: null,
    carriedRoute: null,
    dawnPerk: null,
    dawnChoiceHistory: [],
    interactionCooldown: 0,
    coneAmmo: BASE_MAX_CONES,
    maxCones: BASE_MAX_CONES,
    peelAmmo: 2,
    maxPeels: BASE_MAX_PEELS,
    meleeTool: "plunger",
    upgrades: {
      plungerTape: false,
      conePouch: false,
      cartPadding: false,
      mopSpear: false,
      rubberChicken: false,
    },
    campUpgrades: {
      tarpRoof: false,
      lanternRig: false,
      peelBucket: false,
    },
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const player = {
    group: null,
    velocity: new THREE.Vector3(),
    previous: playerStart.clone(),
    lastSafe: playerStart.clone(),
    attackArc: null,
    tools: {},
  };

  const dayActions = {
    dance: {
      label: "Dance Battle",
      cash: [5, 12],
      heat: 4,
      hype: 5,
      energy: 8,
      radius: 9,
      log: ["Crowd", "The sidewalk dance combo got tips and two confused thumbs-up."],
    },
    sign: {
      label: "Sign Bit",
      cash: [3, 8],
      heat: 2,
      hype: 3,
      energy: 4,
      radius: 7,
      log: ["Cardboard", "The sign landed. Someone paid extra for the punchline."],
    },
    drums: {
      label: "Trash Drums",
      cash: [8, 16],
      heat: 9,
      hype: 7,
      energy: 10,
      radius: 11,
      log: ["Percussion", "Trash-can rhythm pulled a crowd and one complaint."],
    },
    stunt: {
      label: "Pratfall",
      cash: [12, 24],
      heat: 14,
      hype: 9,
      energy: 18,
      radius: 10,
      log: ["Stunt", "A heroic wipeout. Excellent money, questionable spine."],
    },
  };

  const districtDefs = [
    {
      id: "busking",
      title: "Busking Strip",
      short: "tips + hype, nosy crowd",
      xMin: -8,
      xMax: 18,
      zMin: 5,
      zMax: 22,
      cashMult: 1.18,
      hypeMult: 1.18,
      heatMult: 1.12,
      scrapMult: 0.95,
      copSpeedMult: 1,
      pressure: 10,
      color: 0xffd43b,
    },
    {
      id: "camp",
      title: "Camp Row",
      short: "safer recovery, softer heat",
      xMin: -34,
      xMax: -15,
      zMin: 4,
      zMax: 18,
      cashMult: 0.92,
      hypeMult: 0.95,
      heatMult: 0.72,
      scrapMult: 1.22,
      copSpeedMult: 0.82,
      pressure: -10,
      color: 0x2ee0ff,
    },
    {
      id: "pawn",
      title: "Pawn Alley",
      short: "scrap pays, heat watches",
      xMin: 16,
      xMax: 34,
      zMin: -14,
      zMax: -2,
      cashMult: 1.12,
      hypeMult: 0.96,
      heatMult: 1.24,
      scrapMult: 1.32,
      copSpeedMult: 1.12,
      pressure: 16,
      color: 0xff2e88,
    },
    {
      id: "crosswalk",
      title: "Crosswalk Circus",
      short: "stunts pop, trouble echoes",
      xMin: 7,
      xMax: 20,
      zMin: -7,
      zMax: 7,
      cashMult: 1.05,
      hypeMult: 1.24,
      heatMult: 1.18,
      scrapMult: 1,
      copSpeedMult: 1.06,
      pressure: 12,
      color: 0xff7b26,
    },
    {
      id: "haze",
      title: "Haze Mouth",
      short: "night spawn danger",
      xMin: -34,
      xMax: 34,
      zMin: -25,
      zMax: -8,
      cashMult: 0.98,
      hypeMult: 1.04,
      heatMult: 1.08,
      scrapMult: 1.1,
      copSpeedMult: 1,
      pressure: 18,
      color: 0x75ff92,
    },
    {
      id: "street",
      title: "Open Block",
      short: "balanced risk",
      xMin: -34,
      xMax: 34,
      zMin: -25,
      zMax: 25,
      cashMult: 1,
      hypeMult: 1,
      heatMult: 1,
      scrapMult: 1,
      copSpeedMult: 1,
      pressure: 0,
      color: 0x2ee0ff,
    },
  ];

  const directorBeats = {
    crowdSwell: {
      title: "Crowd Swell",
      text: "A sidewalk crowd forms. Tips rise before security notices.",
      cashMult: 1.22,
      hypeMult: 1.18,
      heatMult: 1.08,
    },
    scrapGlint: {
      title: "Scrap Glint",
      text: "Useful junk glints from the curb. Caches are louder for a moment.",
      cashMult: 1.04,
      hypeMult: 1,
      heatMult: 0.96,
    },
    securitySweep: {
      title: "Security Sweep",
      text: "A clipboard patrol starts orbiting the block.",
      cashMult: 0.98,
      hypeMult: 1.08,
      heatMult: 1.24,
    },
    quietWindow: {
      title: "Quiet Window",
      text: "The block exhales. Catch a breath and make a plan.",
      cashMult: 1,
      hypeMult: 0.92,
      heatMult: 0.74,
    },
    hazeSurge: {
      title: "Haze Surge",
      text: "The alleys pulse green. The night wave tightens.",
      cashMult: 1,
      hypeMult: 1,
      heatMult: 1,
    },
  };

  const favorDefs = [
    {
      id: "buskingCrowd",
      districtId: "busking",
      title: "Pass the Hat",
      desc: "Earn 16 hype from antics on the Busking Strip.",
      event: "districtHype",
      target: 16,
      rewardCash: 16,
      rewardScrap: 0,
      rewardHype: 5,
      heatDelta: 2,
    },
    {
      id: "campRelief",
      districtId: "camp",
      title: "Patch the Row",
      desc: "Turn in 2 scrap at Camp Row or finish a camp deposit.",
      event: "campHelp",
      target: 2,
      rewardCash: 8,
      rewardScrap: 1,
      rewardHype: 4,
      heatDelta: -10,
    },
    {
      id: "pawnReceipts",
      districtId: "pawn",
      title: "Pawn Receipts",
      desc: "Move 3 scrap through Pawn Alley scavenging or trade-ins.",
      event: "pawnScrap",
      target: 3,
      rewardCash: 20,
      rewardScrap: 0,
      rewardHype: 5,
      heatDelta: 4,
    },
    {
      id: "crosswalkClip",
      districtId: "crosswalk",
      title: "Crosswalk Clip",
      desc: "Launch 2 props or land stunt chaos in Crosswalk Circus.",
      event: "crosswalkStunt",
      target: 2,
      rewardCash: 18,
      rewardScrap: 1,
      rewardHype: 7,
      heatDelta: 5,
    },
    {
      id: "hazeWatch",
      districtId: "haze",
      title: "Haze Watch",
      desc: "Bonk 3 Haze threats near the alley mouth at night.",
      event: "hazeDefense",
      target: 3,
      rewardCash: 14,
      rewardScrap: 2,
      rewardHype: 6,
      heatDelta: -4,
    },
    {
      id: "openRoute",
      districtId: "street",
      title: "Open Block Route",
      desc: "Complete 3 odd-job or getaway moments anywhere.",
      event: "openAssist",
      target: 3,
      rewardCash: 15,
      rewardScrap: 1,
      rewardHype: 5,
      heatDelta: -3,
    },
  ];

  const upgradeDefs = {
    plungerTape: {
      label: "Plunger Tape",
      cost: 30,
      repeat: false,
      ownedText: "plunger reach + damage",
    },
    conePouch: {
      label: "Cone Pouch",
      cost: 24,
      repeat: false,
      ownedText: "8 cone capacity",
    },
    cartPadding: {
      label: "Cart Padding",
      cost: 36,
      repeat: false,
      ownedText: "125 max health",
    },
    mopSpear: {
      label: "Mop Spear",
      cost: 34,
      repeat: false,
      ownedText: "mop spear reach",
    },
    rubberChicken: {
      label: "Rubber Chicken",
      cost: 28,
      repeat: false,
      ownedText: "confusion bonks",
    },
    mealTicket: {
      label: "Meal Ticket",
      cost: 12,
      repeat: true,
      ownedText: "repeatable recovery",
    },
  };

  const campUpgradeDefs = {
    tarpRoof: {
      label: "Tarp Roof",
      costScrap: 3,
      desc: "max health + recovery",
      ownedText: "tarp roof recovery",
    },
    lanternRig: {
      label: "Lantern Rig",
      costScrap: 4,
      desc: "softer Haze nights",
      ownedText: "lantern night safety",
    },
    peelBucket: {
      label: "Peel Bucket",
      costScrap: 4,
      desc: "+2 peel capacity",
      ownedText: "peel bucket traps",
    },
  };

  const dawnChoiceDefs = [
    {
      id: "soupLineIntel",
      title: "Soup Line Intel",
      desc: "Reset your feet, hear where the Haze is moving, and start the next day steadier.",
      effect: "+health +energy -heat · next cycle: safer recovery",
      perkTitle: "Intel Route",
      perkDesc: "Faster energy recovery, better heat cooldown, and softer Haze hits this cycle.",
      apply: () => {
        state.health = clamp(state.health + 32, 0, state.maxHealth);
        state.energy = clamp(state.energy + 34, 0, 100);
        state.heat = clamp(state.heat - 14, 0, 100);
        state.directorPressure = clamp(state.directorPressure - 10, 0, 100);
        return "Health and energy up. Heat cooled before the next hustle.";
      },
    },
    {
      id: "scrapCartSprint",
      title: "Scrap Cart Sprint",
      desc: "Race a wobbly cart through the morning crowd and cash in the useful bits.",
      effect: "+cash +scrap +cones · next cycle: better hauls",
      perkTitle: "Cart Haul",
      perkDesc: "Day antics pay more and scavenged caches cough up extra scrap this cycle.",
      apply: () => {
        const cashBonus = 16 + state.cycle * 5;
        state.cash += cashBonus;
        state.scrap += 2;
        state.coneAmmo = clamp(state.coneAmmo + 3, 0, state.maxCones);
        state.heat = clamp(state.heat + 4, 0, 100);
        state.score += cashBonus * 8;
        return money(cashBonus) + ", 2 scrap, and cone ammo. Heat ticked up.";
      },
    },
    {
      id: "quietBackstreets",
      title: "Quiet Backstreets",
      desc: "Take the long way around, plant peel traps, and shake the block pressure down.",
      effect: "-pressure -heat +peels · next cycle: quieter heat",
      perkTitle: "Quiet Route",
      perkDesc: "Lower heat spikes, softer block pressure, and slower arrest buildup this cycle.",
      apply: () => {
        state.directorPressure = clamp(state.directorPressure - 24, 0, 100);
        state.heat = clamp(state.heat - 22, 0, 100);
        state.hype = clamp(state.hype + 8, 0, 100);
        state.peelAmmo = clamp(state.peelAmmo + 2, 0, state.maxPeels);
        state.score += 150;
        return "Block pressure dropped. Peel traps and hype topped up.";
      },
    },
  ];

  const meleeDefs = {
    plunger: {
      label: "Plunger",
      upgradeId: "",
      reach: 2.6,
      damage: 34,
      knockback: 7.5,
      cooldown: 0.38,
      propRadius: 3.4,
      propForce: 5.8,
      floater: "BONK",
      hitStatus: "Bonk confirmed",
      emptyStatus: "Air bonk",
    },
    mopSpear: {
      label: "Mop Spear",
      upgradeId: "mopSpear",
      reach: 3.85,
      damage: 30,
      knockback: 11.5,
      cooldown: 0.48,
      propRadius: 4.2,
      propForce: 7.4,
      stun: 0.65,
      floater: "MOP",
      hitStatus: "Long poke landed",
      emptyStatus: "Mop whiff",
    },
    rubberChicken: {
      label: "Rubber Chicken",
      upgradeId: "rubberChicken",
      reach: 2.45,
      damage: 18,
      knockback: 6.2,
      cooldown: 0.32,
      propRadius: 3.05,
      propForce: 4.6,
      confuse: 2.2,
      hype: 3,
      floater: "SQUEAK",
      hitStatus: "Confusion squeak",
      emptyStatus: "Questionable squeak",
    },
  };

  const hazeVariantDefs = {
    shambler: {
      label: "Haze Shambler",
      intro: "",
      coats: [0x274b3b, 0x44622c, 0x315a61],
      head: palette.zombie,
      scale: [0.88, 1.16],
      speed: [1.45, 2.35],
      health: [45, 75],
      damage: [4, 5, 6],
    },
    runner: {
      label: "Haze Runner",
      intro: "A twitchy Haze Runner started sprinting through the crosswalk.",
      coats: [0x6aff72, 0x47d65e, 0x2fbf8c],
      head: 0xd8ff8b,
      scale: [0.74, 0.88],
      speed: [2.65, 3.35],
      health: [30, 44],
      damage: [3, 4, 5],
    },
    spitter: {
      label: "Goo Spitter",
      intro: "A Goo Spitter lurched into view and started lobbing neon gunk.",
      coats: [0x315a61, 0x244d56, 0x4b3d6e],
      head: 0xa9ff70,
      scale: [0.94, 1.08],
      speed: [1.05, 1.48],
      health: [38, 58],
      damage: [3, 4, 5],
    },
  };

  const gigDefs = [
    {
      id: "warmup",
      title: "Warm Up the Block",
      desc: "Build 14 hype from any daytime antics or prop chaos.",
      target: 14,
      rewardCash: 14,
      rewardHype: 6,
    },
    {
      id: "propTheater",
      title: "Prop Theater",
      desc: "Launch 3 loose props with Space, plunger swings, or cones.",
      target: 3,
      rewardCash: 18,
      rewardHype: 8,
    },
    {
      id: "mixedSet",
      title: "Four-Bit Set",
      desc: "Perform 3 different daytime antics before the city gets bored.",
      target: 3,
      rewardCash: 22,
      rewardHype: 10,
    },
    {
      id: "getaway",
      title: "Lose the Paperwork",
      desc: "Start a chase, then get clear until the cops drop it.",
      target: 1,
      rewardCash: 26,
      rewardHype: 12,
    },
  ];

  const jobDefs = [
    {
      id: "phoneRelay",
      title: "Phone Relay",
      desc: "Pick up the ringing phone, then drop it at the camp return marker.",
      target: 2,
      event: "delivery",
      routePickupId: "phone-pickup",
      routeDropoffId: "phone-dropoff",
      rewardCash: 18,
      rewardScrap: 1,
      rewardHype: 6,
    },
    {
      id: "ampRescue",
      title: "Amp Rescue",
      desc: "Haul the busted amp to the Busking Strip, then perform a finale to wake it up.",
      target: 3,
      event: "deliveryShow",
      routePickupId: "amp-pickup",
      routeDropoffId: "amp-dropoff",
      routeFinalLabel: "amp finale",
      routeFinalDistrictId: "busking",
      rewardCash: 24,
      rewardScrap: 1,
      rewardHype: 9,
    },
    {
      id: "recycleRoute",
      title: "Recycle Route",
      desc: "Scavenge 3 glowing caches before night.",
      target: 3,
      event: "scavenge",
      rewardCash: 16,
      rewardScrap: 2,
      rewardHype: 4,
    },
    {
      id: "kioskRun",
      title: "Kiosk Run",
      desc: "Bring 4 scrap to the pawn kiosk.",
      target: 1,
      event: "kioskTurnIn",
      costScrap: 4,
      rewardCash: 26,
      rewardScrap: 0,
      rewardHype: 7,
    },
    {
      id: "campPatch",
      title: "Camp Patch",
      desc: "Bank 5 scrap at camp for a recovery burst.",
      target: 1,
      event: "campDeposit",
      costScrap: 5,
      rewardCash: 10,
      rewardScrap: 0,
      rewardHype: 6,
      rewardHealth: 20,
      rewardEnergy: 18,
    },
  ];

  const logs = [
    ["Producer", "Earn cash by day. Survive the Haze at night."],
    ["Outreach", "Keep your energy up and the heat manageable."],
    ["Pawn Kiosk", "Plunger is free. Cones are everywhere."],
  ];

  function mat(name, color, roughness = 0.78, metalness = 0.02) {
    if (!materials[name]) {
      materials[name] = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        flatShading: true,
      });
    }
    return materials[name];
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function resetCameraLook() {
    cameraLook.yaw = DEFAULT_CAMERA_YAW;
    cameraLook.pitch = DEFAULT_CAMERA_PITCH;
    cameraLook.distance = DEFAULT_CAMERA_DISTANCE;
    cameraLook.shoulder = DEFAULT_CAMERA_SHOULDER;
    cameraLook.dragging = false;
    cameraLook.pointerId = null;
    canvas.classList.remove("is-mouselook");
  }

  function applyVisualTargetState() {
    if (!VISUAL_TARGET) return;
    state.time = DAY_SECONDS * 0.494;
    state.cash = 7.25;
    state.heat = 28;
    state.hype = 12;
    state.energy = 40;
    state.health = 60;
  }

  function setLastMoveFromCamera() {
    input.lastMove.set(-Math.sin(cameraLook.yaw), 0, -Math.cos(cameraLook.yaw)).normalize();
  }

  function canUseMouseLook() {
    return state.running && !state.paused && !state.gameOver && !state.awaitingDawnChoice;
  }

  function isPointerLocked() {
    return document.pointerLockElement === canvas;
  }

  function applyMouseLookDelta(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    cameraLook.yaw -= dx * cameraLook.sensitivity;
    cameraLook.pitch = clamp(cameraLook.pitch + dy * cameraLook.sensitivity, cameraLook.minPitch, cameraLook.maxPitch);
  }

  function releaseMouseLook() {
    cameraLook.dragging = false;
    cameraLook.pointerId = null;
    if (isPointerLocked() && document.exitPointerLock) {
      document.exitPointerLock();
    }
    if (!isPointerLocked()) {
      canvas.classList.remove("is-mouselook");
    }
  }

  function stopMouseLookDrag(event) {
    if (cameraLook.pointerId !== null && event && event.pointerId !== cameraLook.pointerId) return;
    if (
      cameraLook.pointerId !== null &&
      canvas.releasePointerCapture &&
      canvas.hasPointerCapture &&
      canvas.hasPointerCapture(cameraLook.pointerId)
    ) {
      try {
        canvas.releasePointerCapture(cameraLook.pointerId);
      } catch (error) {
        // Capture may already be gone after pointer lock changes.
      }
    }
    cameraLook.dragging = false;
    cameraLook.pointerId = null;
    if (!isPointerLocked()) {
      canvas.classList.remove("is-mouselook");
    }
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  }

  function distToSegment2(point, start, end) {
    const sx = start.x;
    const sz = start.z;
    const ex = end.x;
    const ez = end.z;
    const dx = ex - sx;
    const dz = ez - sz;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 0.0001) return dist2(point, start);
    const t = clamp(((point.x - sx) * dx + (point.z - sz) * dz) / lengthSq, 0, 1);
    const closest = tmpVec2.set(sx + dx * t, 0, sz + dz * t);
    return dist2(point, closest);
  }

  function isOpeningShotClearZone(x, z) {
    return x > -8.5 && x < 20.5 && z > -11.2 && z < -2.2;
  }

  function getRandomPedestrianPoint() {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const point = new THREE.Vector3(rand(-31, 31), 0, rand(-20, 20));
      if (!isOpeningShotClearZone(point.x, point.z) && dist2(point, playerStart) > 46) {
        return point;
      }
    }
    return new THREE.Vector3(pick([-26, 26, -18, 22]), 0, pick([-16, 13, 17]));
  }

  function percent(value) {
    return Math.round(clamp(value, 0, 100)) + "%";
  }

  function money(value) {
    return "$" + Math.max(0, Math.round(value));
  }

  function compactMoney(value) {
    const safe = Math.max(0, value);
    if (VISUAL_TARGET && Math.abs(safe - Math.round(safe)) > 0.001) {
      return "$" + safe.toFixed(2);
    }
    return "$" + Math.round(safe).toFixed(0);
  }

  function setHudBar(fill, text, value, max = 100) {
    const safeMax = Math.max(1, max);
    const current = clamp(value, 0, safeMax);
    if (fill) fill.style.width = percent((current / safeMax) * 100);
    if (text) text.textContent = Math.round(current) + "/" + Math.round(safeMax);
  }

  function formatClockTime() {
    const duration = state.phase === "day" ? DAY_SECONDS : NIGHT_SECONDS;
    const t = clamp(state.time / Math.max(1, duration), 0, 1);
    const start = state.phase === "day" ? 8 * 60 : 20 * 60;
    const span = state.phase === "day" ? 12 * 60 : 9 * 60;
    const minutes = Math.floor((start + t * span) % (24 * 60));
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return hour12 + ":" + String(minute).padStart(2, "0") + " " + suffix;
  }

  function getWaveTargetForCycle(cycle) {
    return WAVE_TARGET + (cycle - 1) * (DEBUG_TIMERS ? 2 : 4);
  }

  function getWaveTarget() {
    return getWaveTargetForCycle(state.cycle);
  }

  function getCycleLabel() {
    return state.cycle + "/" + RUN_CYCLES;
  }

  function shouldSpawnBossNight() {
    return state.cycle >= BOSS_CYCLE;
  }

  function getHazeBoss() {
    return world.zombies.find((actor) => actor.boss && !actor.dead) || null;
  }

  function getActiveDawnPerk() {
    return state.dawnPerk && state.dawnPerk.cycle === state.cycle ? state.dawnPerk : null;
  }

  function hasDawnPerk(id) {
    const perk = getActiveDawnPerk();
    return Boolean(perk && perk.id === id);
  }

  function setDawnPerk(choice) {
    state.dawnPerk = {
      id: choice.id,
      title: choice.perkTitle || choice.title,
      desc: choice.perkDesc || choice.desc,
      cycle: state.cycle,
    };
  }

  function clearExpiredDawnPerk(finishedCycle) {
    if (!state.dawnPerk) return;
    if (state.dawnPerk.cycle !== finishedCycle) return;
    pushLog("Dawn Perk", state.dawnPerk.title + " wrapped with Cycle " + finishedCycle + ".");
    state.dawnPerk = null;
  }

  function updateDawnPerkChip() {
    if (!el.dawnPerkChip || !el.dawnPerkText) return;
    const perk = getActiveDawnPerk();
    el.dawnPerkChip.hidden = !perk;
    if (perk) {
      el.dawnPerkText.textContent = perk.title + " · C" + getCycleLabel();
      el.dawnPerkChip.title = perk.desc;
    } else {
      el.dawnPerkText.textContent = "No route";
      el.dawnPerkChip.removeAttribute("title");
    }
  }

  function updateBossChip() {
    if (!el.bossChip || !el.bossText) return;
    const boss = getHazeBoss();
    el.bossChip.hidden = !boss;
    if (!boss) {
      el.bossText.textContent = "Haze Brute";
      return;
    }
    const pct = Math.max(0, Math.round((boss.health / boss.maxHealth) * 100));
    el.bossText.textContent = boss.label + " · " + pct + "%";
  }

  function getDayCashMultiplier() {
    return hasDawnPerk("scrapCartSprint") ? 1.14 : 1;
  }

  function getHeatGainMultiplier() {
    return hasDawnPerk("quietBackstreets") ? 0.82 : 1;
  }

  function getHeatDecayMultiplier() {
    return (hasDawnPerk("soupLineIntel") ? 1.35 : 1) * (hasCampUpgrade("tarpRoof") ? 1.08 : 1);
  }

  function getEnergyRegenMultiplier() {
    return (hasDawnPerk("soupLineIntel") ? 1.25 : 1) * (hasCampUpgrade("tarpRoof") ? 1.1 : 1);
  }

  function getDirectorPressureMultiplier() {
    return (hasDawnPerk("quietBackstreets") ? 0.8 : 1) * (hasCampUpgrade("lanternRig") && state.phase === "night" ? 0.9 : 1);
  }

  function getArrestGainMultiplier() {
    return hasDawnPerk("quietBackstreets") ? 0.78 : 1;
  }

  function getNightDamageMultiplier() {
    return (hasDawnPerk("soupLineIntel") ? 0.82 : 1) * (hasCampUpgrade("lanternRig") ? 0.88 : 1);
  }

  function hasCampUpgrade(id) {
    return Boolean(state.campUpgrades[id]);
  }

  function clearDawnChoices() {
    if (el.dawnChoiceGrid) {
      el.dawnChoiceGrid.innerHTML = "";
      el.dawnChoiceGrid.hidden = true;
    }
    if (el.overlay) el.overlay.classList.remove("overlay--choice");
    if (el.primary) el.primary.hidden = false;
  }

  function showDawnChoices(reason, finishedCycle, clearedKills) {
    if (!el.dawnChoiceGrid) return;
    releaseMouseLook();
    state.awaitingDawnChoice = true;
    state.paused = true;
    state.overlayMode = "dawn";
    input.keys.clear();
    input.virtual.clear();

    const priorTarget = getWaveTargetForCycle(finishedCycle);
    el.overlayTitle.textContent = "DAWN CHOICE";
    el.overlaySub.textContent = reason + " Pick how Cycle " + getCycleLabel() + " starts.";
    el.overlayScore.innerHTML = `<strong>Cycle ${finishedCycle} survived:</strong> ${clearedKills}/${priorTarget} Haze cleared`;
    el.primary.hidden = true;
    el.dawnChoiceGrid.innerHTML = "";
    el.dawnChoiceGrid.hidden = false;
    el.overlay.classList.add("overlay--choice");

    dawnChoiceDefs.forEach((choice) => {
      const button = document.createElement("button");
      button.className = "unhinged-dawn-choice";
      button.type = "button";
      button.dataset.dawnChoice = choice.id;

      const title = document.createElement("strong");
      title.textContent = choice.title;
      const desc = document.createElement("span");
      desc.textContent = choice.desc;
      const effect = document.createElement("small");
      effect.textContent = choice.effect;

      button.append(title, desc, effect);
      el.dawnChoiceGrid.append(button);
    });

    el.overlay.classList.add("overlay--show");
  }

  function applyDawnChoice(id) {
    if (!state.awaitingDawnChoice) return;
    const choice = dawnChoiceDefs.find((item) => item.id === id);
    if (!choice) return;

    const result = choice.apply();
    setDawnPerk(choice);
    state.awaitingDawnChoice = false;
    state.paused = false;
    state.overlayMode = "none";
    state.dawnChoiceHistory.push({ cycle: state.cycle, id: choice.id });
    state.score += 220 + state.cycle * 60;

    clearDawnChoices();
    hideOverlay();
    pushLog("Dawn Choice", choice.title + ": " + result + " Perk active: " + state.dawnPerk.title + ".");
    setStatus("Dawn Choice", choice.title);
    updateUpgradeButtons();
    updateHud();
    canvas.focus();
  }

  function handlePrimaryOverlayAction() {
    if (state.overlayMode === "pause") {
      state.paused = false;
      hideOverlay();
      canvas.focus();
      return;
    }
    if (state.overlayMode === "dawn") return;
    resetRun();
  }

  function init() {
    scene.add(world.root);
    scene.fog = new THREE.FogExp2(0x07101c, 0.014);

    buildLights();
    buildWorld();
    buildPlayer();
    initPhysics();
    spawnPedestrians();
    spawnCop();
    bindControls();
    renderLog();
    updateHud();
    updateUpgradeButtons();
    updateCampUpgradeButtons();
    selectNextGig(false);
    selectNextJob(false);
    updateDistrict(true);
    updateDirectorPanel();
    selectDistrictFavor(getCurrentDistrict(), false);
    showOverlay(
      "UNHOUSED AND UNHINGED",
      "Prototype block: build cash by day, survive escalating Haze nights, and make it through three cartoon city cycles.",
      "Start prototype",
      "start"
    );

    state.ready = true;
    requestAnimationFrame(loop);
  }

  function buildLights() {
    world.lights.hemi = new THREE.HemisphereLight(0xb7d7ef, 0x26311f, 1.16);
    scene.add(world.lights.hemi);

    world.lights.sun = new THREE.DirectionalLight(0xffefc4, 1.72);
    world.lights.sun.position.set(-18, 32, 16);
    world.lights.sun.castShadow = true;
    world.lights.sun.shadow.mapSize.width = 1024;
    world.lights.sun.shadow.mapSize.height = 1024;
    world.lights.sun.shadow.camera.near = 1;
    world.lights.sun.shadow.camera.far = 90;
    world.lights.sun.shadow.camera.left = -46;
    world.lights.sun.shadow.camera.right = 46;
    world.lights.sun.shadow.camera.top = 36;
    world.lights.sun.shadow.camera.bottom = -36;
    scene.add(world.lights.sun);

    world.lights.haze = new THREE.PointLight(0x70ff75, 0.1, 72, 1.7);
    world.lights.haze.position.set(0, 9, -18);
    scene.add(world.lights.haze);
  }

  function buildWorld() {
    addBox("ground", 86, 0.3, 62, 0, -0.22, 0, mat("ground", 0x20242b));
    addBox("road-main", 86, 0.08, 11.2, 0, 0, -1, mat("asphalt", palette.asphalt));
    addBox("road-cross", 12.4, 0.09, 62, 13, 0.02, 0, mat("asphalt2", 0x2e343b));

    addBox("sidewalk-north", 86, 0.14, 13, 0, 0.05, -18.4, mat("sidewalk", palette.sidewalk));
    addBox("sidewalk-south", 86, 0.14, 14, 0, 0.05, 15.6, mat("sidewalk2", 0x8a8b88));
    addBox("park", 20, 0.16, 12, -22, 0.08, 14.8, mat("grass", palette.grass));
    addBox("camp-rug", 8, 0.18, 5.4, -25, 0.11, 7.4, mat("rug", 0x7d3159));

    addCurb(-1);
    addCurb(1);
    addCrosswalk(13, -1);
    addGroundWear();
    if (TOP_DOWN_VIEW) {
      addTopDownDistrictMap();
    } else {
      addOpeningSurfaceDetail();
      addBuildings();
    }
    addStreetProps();
    if (!TOP_DOWN_VIEW) addStreetSetDressing();
    addCamp();
    addPawnKiosk();
    addAlleySpawns();
    addDistrictSigns();
    addObjectiveBeacon();
  }

  function addTopDownDistrictMap() {
    addFlatPatch("topdown-main-block", 22, 10, 0, 0.14, -1, 0x2f3740, 0);
    addFlatPatch("topdown-busk-zone", 11, 5.8, 2, 0.18, 10.4, 0x354a37, 0);
    addFlatPatch("topdown-camp-zone", 9.2, 6, -24.2, 0.19, 8.4, 0x5a3554, -0.03);
    addFlatPatch("topdown-kiosk-zone", 8.4, 5.2, 21.8, 0.19, -6.6, 0x304d58, 0.04);
    addFlatPatch("topdown-alley-zone", 9.6, 5.4, -21.5, 0.18, -8.2, 0x3c3d42, 0.02);

    [
      [-31.5, -17.6, 9.2, 4.4, 0x5f4b43],
      [-18, -17.6, 9.4, 4.4, 0x755b4d],
      [-4.4, -17.6, 9.8, 4.4, 0x80644f],
      [9.6, -17.6, 9.4, 4.4, 0x6d554a],
      [24.2, -17.6, 10.4, 4.4, 0x4a5360],
      [-34, 18.4, 7.4, 4.4, 0x5a4b42],
      [31.2, 16.9, 8.6, 5.2, 0x4b5661],
    ].forEach(([x, z, width, depth, color]) => {
      addBox("topdown-building-footprint", width, 0.34, depth, x, 0.21, z, mat("topdown-building-" + x + "-" + z, color, 0.82, 0.01), true);
    });

    [
      ["CAMP", -24.2, 8.4, 0xffd43b],
      ["PARK", 2, 10.4, 0x75ff92],
      ["KIOSK", 21.8, -6.6, 0x2ee0ff],
      ["ALLEY", -21.5, -8.2, 0xff7bdf],
      ["BUSK", 4.9, 11.25, 0xffffff],
    ].forEach(([label, x, z, color]) => addTopDownLabel(label, x, z, color));

    [
      [-12, -7.2, 6, 0.18],
      [-2.8, 5.7, 5.8, -0.28],
      [16.8, 4.7, 6.8, 0.22],
      [27.2, -1.5, 5.2, -0.18],
    ].forEach(([x, z, length, rotation]) => addFlatPatch("topdown-road-mark", 0.16, length, x, 0.18, z, 0xf1f6f4, rotation));

    [
      [-20.5, 8.3, 0.82],
      [-4.2, 12.8, 0.78],
      [15.2, -8.8, 0.72],
      [26.8, 6.9, 0.74],
    ].forEach(([x, z, scale]) => addLowPolyTree(x, z, scale));
  }

  function addTopDownLabel(text, x, z, color) {
    const sprite = makeTextSprite(text, color);
    sprite.position.set(x, 0.75, z);
    sprite.scale.set(2.4, 0.82, 1);
    world.root.add(sprite);
  }

  function addBox(name, width, height, depth, x, y, z, material, blocker = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = height > 0.4;
    mesh.receiveShadow = true;
    world.root.add(mesh);
    if (blocker) {
      world.blockers.push({ x, z, w: width, d: depth, name });
    }
    return mesh;
  }

  function addCurb(side) {
    const z = side > 0 ? 6 : -8;
    for (let x = -40; x <= 40; x += 8) {
      addBox("curb", 5.8, 0.18, 0.42, x, 0.18, z, mat("curb", 0xb9b1a1));
    }
  }

  function addCrosswalk(x, z) {
    for (let i = -4; i <= 4; i += 1) {
      addBox("crosswalk", 0.42, 0.12, 5.8, x + i * 1.35, 0.12, z, mat("paint", 0xf1f6f4));
    }
  }

  function addFlatPatch(name, width, depth, x, y, z, color, rotation = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, depth), mat(name, color, 0.88, 0.01));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.receiveShadow = true;
    world.root.add(mesh);
    return mesh;
  }

  function addGroundWear() {
    [
      ["road-patch", 7.4, 2.4, -18, 0.085, -1.7, 0x1c2228, 0.08],
      ["road-patch", 5.6, 1.8, 0.8, 0.086, 1.9, 0x383f46, -0.14],
      ["road-patch", 6.1, 2.1, 18.7, 0.087, -3.6, 0x20262d, 0.18],
      ["road-patch", 4.4, 1.2, 26.2, 0.088, 2.8, 0x40464b, -0.32],
      ["sidewalk-stain", 4.8, 2.2, -24.2, 0.155, 12.2, 0x77736d, 0.1],
      ["sidewalk-stain", 5.6, 1.7, 23.5, 0.155, -17.7, 0x77736d, -0.18],
    ].forEach(([name, width, depth, x, y, z, color, rotation]) => addFlatPatch(name, width, depth, x, y, z, color, rotation));

    [
      [-30, 10.4, 2.4, 0.08],
      [-14, 7.7, 2.9, -0.2],
      [5.8, -7.1, 3.4, 0.34],
      [17.5, 8.2, 2.2, -0.12],
      [29, -9.1, 2.8, 0.18],
    ].forEach(([x, z, length, rotation]) => addFlatPatch("street-crack", 0.08, length, x, 0.17, z, 0x3d3833, rotation));

    [
      [-10.5, 6.2],
      [-1.4, -8.1],
      [10.4, 6.2],
      [24.8, -8.1],
      [-29.6, 6.2],
    ].forEach(([x, z]) => {
      const grass = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 5), mat("curb-weed", 0x537b35, 0.72, 0.01));
      grass.position.set(x, 0.34, z);
      grass.scale.set(0.6, 1, 1.4);
      grass.rotation.y = rand(0, Math.PI);
      world.root.add(grass);
    });
  }

  function addOpeningSurfaceDetail() {
    [
      ["foreground-road-slab", 5.8, 2.1, 0.2, 0.106, -6.3, 0x454b50, -0.03],
      ["foreground-road-slab", 4.2, 1.7, 5.4, 0.107, -5.55, 0x373e44, 0.05],
      ["foreground-road-slab", 3.8, 1.4, 10.4, 0.108, -4.75, 0x4b5156, -0.08],
      ["foreground-road-slab", 3.2, 1.2, 14.8, 0.109, -3.8, 0x343a40, 0.08],
      ["curb-shadow", 7.4, 0.5, 2.4, 0.126, -7.62, 0x252b31, 0],
      ["curb-shadow", 5.5, 0.44, 10.8, 0.126, -7.62, 0x252b31, 0],
      ["sidewalk-panel", 3.1, 1.18, 5.4, 0.166, -9.2, 0xb0aaa0, 0.02],
      ["sidewalk-panel", 2.8, 1.08, 8.8, 0.167, -9.26, 0x8f8981, -0.04],
      ["sidewalk-panel", 3.4, 1.2, 12.6, 0.168, -9.18, 0xa7a39b, 0.03],
    ].forEach(([name, width, depth, x, y, z, color, rotation]) => {
      addFlatPatch(name, width, depth, x, y, z, color, rotation);
    });

    [
      [1.2, -6.45, 2.2, -0.88],
      [5.4, -6.88, 1.55, 0.4],
      [8.6, -5.25, 2.0, -0.22],
      [13.4, -4.34, 1.65, 0.7],
      [6.7, -9.15, 1.2, Math.PI / 2],
      [11.2, -9.05, 1.4, Math.PI / 2],
    ].forEach(([x, z, length, rotation]) => {
      addFlatPatch("opening-crack", 0.055, length, x, 0.181, z, 0x2e3032, rotation);
    });

    [
      [3.1, -6.1],
      [7.7, -8.0],
      [12.2, -5.9],
    ].forEach(([x, z]) => {
      const gum = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.018, 7), mat("street-gum", 0xd8d1be, 0.9, 0.01));
      gum.position.set(x, 0.2, z);
      gum.scale.y = 0.35;
      world.root.add(gum);
    });
  }

  function addBuildings() {
    const buildingColors = [0x46546f, 0x634d76, 0x3e5b61, 0x755345, 0x4e4b63];
    const data = [
      [-34, -17, 10, 12, 10],
      [-20, -18, 12, 12, 14],
      [-5, -19, 11, 11, 8],
      [29, -18, 12, 12, 12],
      [31, 16, 12, 14, 10],
      [14, 20, 9, 9, 7],
      [-7, 21, 13, 8, 9],
      [-36, 17, 10, 12, 7],
    ];

    data.forEach(([x, z, w, d, h], index) => {
      const color = buildingColors[index % buildingColors.length];
      const mesh = addBox("building", w, h, d, x, h / 2, z, mat("building-" + index, color), true);
      addWindows(mesh, w, h, d);
      addBuildingFacadeDetails(mesh, w, h, d, index);
    });

    addBox("bus-stop-back", 7, 2.8, 0.35, 2, 1.45, 11.5, mat("busstop", 0x2e4858));
    addBox("bus-stop-roof", 7.8, 0.28, 2.4, 2, 3.04, 10.8, mat("busroof", 0x2ee0ff));
    addBox("bus-stop-bench", 5.2, 0.35, 1, 2, 0.55, 10.7, mat("bench", 0xf7d43a), true);
  }

  function addWindows(building, width, height, depth) {
    const rows = Math.max(2, Math.floor(height / 2.4));
    const cols = Math.max(2, Math.floor(width / 2.8));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (Math.random() < 0.32) continue;
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.55, 0.05),
          mat("window", Math.random() > 0.45 ? 0xffd75c : 0x2ee0ff, 0.35, 0.05)
        );
        win.position.set(
          building.position.x - width / 2 + 1.35 + c * 2.2,
          1.6 + r * 1.75,
          building.position.z + depth / 2 + 0.04
        );
        world.root.add(win);
      }
    }
  }

  function addBuildingFacadeDetails(building, width, height, depth, index) {
    const frontZ = building.position.z + depth / 2 + 0.08;
    const baseY = 0.75;
    const doorX = building.position.x - width * 0.27;
    addBox("building-door", 1.35, 1.85, 0.14, doorX, baseY + 0.62, frontZ, mat("building-door-" + index, 0x25282d));
    addBox("building-awning", 2.8, 0.22, 0.8, doorX, 2.05, frontZ + 0.26, mat("awning-" + index, index % 2 ? 0xd14d86 : 0xc44c57));

    for (let level = 0; level < Math.max(1, Math.floor(height / 4)); level += 1) {
      const y = 2.6 + level * 2.15;
      if (y > height - 0.5) continue;
      addBox("window-ledge", width * 0.72, 0.08, 0.18, building.position.x, y, frontZ + 0.05, mat("ledge-" + index, 0x22272d));
      if (level % 2 === 0) {
        addBox("fire-rail", width * 0.42, 0.1, 0.1, building.position.x + width * 0.14, y + 0.55, frontZ + 0.18, mat("fire-escape", 0x14181d));
        addBox("fire-rail-v", 0.08, 0.7, 0.08, building.position.x - width * 0.09, y + 0.3, frontZ + 0.18, mat("fire-escape", 0x14181d));
        addBox("fire-rail-v", 0.08, 0.7, 0.08, building.position.x + width * 0.36, y + 0.3, frontZ + 0.18, mat("fire-escape", 0x14181d));
      }
    }

    if (index % 2 === 0) {
      addBox("ac-unit", 0.82, 0.42, 0.28, building.position.x + width * 0.22, Math.min(height - 0.9, 3.15), frontZ + 0.15, mat("ac-unit", 0xb9c0c4));
    }

    const tag = makeTextSprite(index % 2 ? "NO LOITER" : "STAY WEIRD", index % 2 ? 0xffd43b : 0x2ee0ff);
    tag.position.set(building.position.x + width * 0.18, 1.42, frontZ + 0.12);
    tag.scale.set(2.2, 0.64, 1);
    world.root.add(tag);
  }

  function addStreetProps() {
    if (TOP_DOWN_VIEW) {
      addTopDownStreetProps();
      return;
    }

    const coneCount = VISUAL_TARGET ? 3 : 18;
    const trashBagCount = VISUAL_TARGET ? 4 : 14;

    for (let i = 0; i < coneCount; i += 1) {
      let x = rand(-31, 31);
      let z = rand(-5.4, 4.4);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const inOpeningShot = isOpeningShotClearZone(x, z);
        if (!inOpeningShot && dist2({ x, z }, playerStart) > 42) break;
        x = rand(-31, 31);
        z = rand(-5.4, 4.4);
      }
      addCone(x, z);
    }

    for (let i = 0; i < trashBagCount; i += 1) {
      const x = rand(-32, 32);
      const z = pick([rand(7.5, 21), rand(-23, -10)]);
      addTrashBag(x, z);
    }

    [
      [-9.5, -4.8],
      [11.8, 3.2],
      [4.2, 10.1],
      [-22.2, 16.2],
      [24.2, -3.6],
    ].forEach(([x, z]) => addBananaPeel(x, z));

    for (let i = 0; i < 8; i += 1) {
      const northLampX = -36 + i * 10;
      if (!isOpeningShotClearZone(northLampX, -7.2)) addLamp(northLampX, -7.2);
      if (i % 2 === 0) addLamp(-32 + i * 9, 7.6);
    }

    addBox("hostile-bench", 5.5, 0.4, 1.1, -12, 0.55, 10.8, mat("bench-hot", 0xffd43b), true);
    addBox("newsbox", 1.4, 1.7, 1, -17, 0.9, 9.8, mat("newsbox", 0xff2e88), true);
    addBox("vending", 2.2, 3.1, 1.2, 20, 1.6, 10.4, mat("vending", 0x2ee0ff), true);

    addInteractable("curb-cache", "scavenge", "Curb Cache", 1.2, 7.35, 0x75ff92);
    addInteractable("park-cache", "scavenge", "Park Cache", -22.4, 10.7, 0x75ff92);
    addInteractable("news-cache", "scavenge", "Newsbox Stash", -17.2, 7.9, 0x75ff92);
    addInteractable("kiosk-cache", "scavenge", "Kiosk Crate", 20.5, -6.35, 0x75ff92);
    addInteractable("phone-pickup", "routePickup", "Ringing Phone", 1.35, 7.9, 0x2ee0ff, {
      dropoffId: "phone-dropoff",
      carryType: "phone",
    });
    addInteractable(
      "phone-dropoff",
      "routeDropoff",
      "Camp Return",
      DEBUG_TIMERS ? 2.25 : -24.2,
      DEBUG_TIMERS ? 7.25 : 10.35,
      0xffd43b
    );
    addInteractable("amp-pickup", "routePickup", "Busted Amp", DEBUG_TIMERS ? 3.7 : 22.2, DEBUG_TIMERS ? 7.65 : -5.65, 0xff2e88, {
      dropoffId: "amp-dropoff",
      carryType: "amp",
      heavy: true,
    });
    addInteractable(
      "amp-dropoff",
      "routeDropoff",
      "Busking Stage",
      DEBUG_TIMERS ? 5.7 : 4.9,
      DEBUG_TIMERS ? 7.9 : 11.25,
      0xffd43b
    );
  }

  function addTopDownStreetProps() {
    [
      [-8.2, -3.8],
      [10.8, -4.4],
      [22.4, -5.4],
    ].forEach(([x, z]) => addCone(x, z));

    [
      [-9.5, -4.8],
      [11.8, 3.2],
    ].forEach(([x, z]) => addBananaPeel(x, z));

    addBox("topdown-bench", 4.4, 0.38, 1.0, 2.4, 0.48, 12.8, mat("topdown-bench", 0x4c7b46), true);
    addBox("topdown-newsbox", 1.2, 1.25, 0.92, -17, 0.66, 8.9, mat("topdown-newsbox", 0xff2e88), true);
    addBox("topdown-vending", 1.6, 2.1, 1.0, 20.8, 1.08, -7.4, mat("topdown-vending", 0x2ee0ff), true);

    addInteractable("curb-cache", "scavenge", "Curb Cache", 1.2, 7.35, 0x75ff92);
    addInteractable("park-cache", "scavenge", "Park Cache", -22.4, 10.7, 0x75ff92);
    addInteractable("news-cache", "scavenge", "Newsbox Stash", -17.2, 7.9, 0x75ff92);
    addInteractable("kiosk-cache", "scavenge", "Kiosk Crate", 20.5, -6.35, 0x75ff92);
    addInteractable("phone-pickup", "routePickup", "Ringing Phone", 1.35, 7.9, 0x2ee0ff, {
      dropoffId: "phone-dropoff",
      carryType: "phone",
    });
    addInteractable(
      "phone-dropoff",
      "routeDropoff",
      "Camp Return",
      DEBUG_TIMERS ? 2.25 : -24.2,
      DEBUG_TIMERS ? 7.25 : 10.35,
      0xffd43b
    );
    addInteractable("amp-pickup", "routePickup", "Busted Amp", DEBUG_TIMERS ? 3.7 : 22.2, DEBUG_TIMERS ? 7.65 : -5.65, 0xff2e88, {
      dropoffId: "amp-dropoff",
      carryType: "amp",
      heavy: true,
    });
    addInteractable(
      "amp-dropoff",
      "routeDropoff",
      "Busking Stage",
      DEBUG_TIMERS ? 5.7 : 4.9,
      DEBUG_TIMERS ? 7.9 : 11.25,
      0xffd43b
    );
  }

  function addStreetSetDressing() {
    [
      [-29, 9.2, 1.05],
      [-18.5, -7.4, 0.86],
      [-4.8, 7.2, 1],
      [10.9, -7.55, 0.62],
      [19.4, 6.8, 1.08],
      [30.5, -6.8, 0.95],
    ].forEach(([x, z, scale]) => addLowPolyTree(x, z, scale));

    addPatrolCar(24.2, -4.95, -0.08);
    addDecorOfficer(18.9, -4.75, -1.18);
    addWallSign("STAY WASHED", 26.4, 6.2, 16.1, 0x2ee0ff);
    addWallSign("LIQUOR", -8.8, 5.4, -13.35, 0xffd43b);
    if (!VISUAL_TARGET) {
      addCardboardSign("PLEASE\\nHELP", -5.2, 9.1, -0.42);
      addCardboardSign("FUNNY\\nSIGN", 3.4, 7.3, 0.35);
    }
    addSeatedSidewalkScene(10.8, -6.05, -0.82);
    addOpeningShotDetails();
  }

  function addLowPolyTree(x, z, scale = 1) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, 2.2 * scale, 6), mat("tree-trunk", 0x5f3d2c));
    const topA = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05 * scale, 0), mat("tree-leaves", 0x2d6a36));
    const topB = new THREE.Mesh(new THREE.DodecahedronGeometry(0.78 * scale, 0), mat("tree-leaves-dark", 0x214f2b));
    trunk.position.y = 1.1 * scale;
    topA.position.set(0, 2.75 * scale, 0);
    topA.scale.set(1.08, 1.28, 0.96);
    topB.position.set(0.32 * scale, 3.38 * scale, -0.18 * scale);
    topB.scale.set(0.82, 1.1, 0.8);
    group.add(trunk, topA, topB);
    group.position.set(x, 0, z);
    world.root.add(group);
    return group;
  }

  function addOpeningShotDetails() {
    addLeftForegroundFacade(-6.85, -8.72);
    addOpeningBrickCorner(-5.9, -11.4);
    addNorthStorefrontDetails();
    addOpeningBuildingTexture();
    addRightOpeningFacadeDetails();
    addOpeningSkylineDepth();
    addRooftopSilhouettes();
    addOpeningGrassIsland();
    if (!VISUAL_TARGET) addOpeningSidewalkCracks();
    addOpeningPavementPatchwork();
    addParkBench(12.15, -6.95, -0.14);
    addHydrant(10.25, -6.75);
    addStreetCan(5.4, -7.25);
  }

  function addOpeningBrickCorner(x, z) {
    addBox("opening-brick-wall", 1.05, 7.6, 5.4, x, 3.72, z, mat("opening-brick-wall", 0x744531, 0.84, 0.01));
    addBox("opening-brick-trim", 0.16, 7.8, 5.65, x + 0.58, 3.84, z, mat("opening-brick-trim", 0x3a241f, 0.86, 0.01));

    for (let row = 0; row < 18; row += 1) {
      const y = 0.62 + row * 0.38;
      const offset = row % 2 ? 0.24 : 0;
      for (let col = 0; col < 7; col += 1) {
        addBox(
          "opening-brick",
          0.065,
          0.045,
          0.48,
          x + 0.61,
          y,
          z - 2.2 + col * 0.72 + offset,
          mat("opening-brick-edge", row % 3 ? 0x8a563b : 0x5f382c, 0.88, 0.01)
        );
      }
    }

    const poster = addBox("opening-poster", 0.075, 1.05, 1.2, x + 0.67, 2.6, z - 0.9, mat("opening-poster", 0xffd43b, 0.72, 0.01));
    poster.rotation.z = -0.04;
    const posterText = makeTextSprite("NO\\nLOITER", 0x2d1c12);
    posterText.position.set(x + 0.74, 2.62, z - 0.9);
    posterText.scale.set(1.05, 0.56, 1);
    world.root.add(posterText);
  }

  function addLeftForegroundFacade(x, z) {
    addBox("left-foreground-brick", 1.25, 8.4, 4.9, x, 4.05, z, mat("left-foreground-brick", 0x6d3f2f, 0.86, 0.01));
    addBox("left-foreground-shadow", 0.12, 8.6, 5.05, x + 0.7, 4.18, z, mat("left-foreground-shadow", 0x2b1b18, 0.88, 0.01));
    addBox("left-visible-brick-face", 5.7, 6.2, 0.16, -3.05, 3.18, -12.22, mat("left-visible-brick-face", 0x794a35, 0.86, 0.01));

    for (let row = 0; row < 20; row += 1) {
      const y = 0.46 + row * 0.38;
      for (let col = 0; col < 6; col += 1) {
        addBox(
          "left-foreground-brick-line",
          0.055,
          0.04,
          0.54,
          x + 0.72,
          y,
          z - 2.05 + col * 0.82 + (row % 2 ? 0.34 : 0),
          mat("left-foreground-brick-line", row % 3 ? 0x8a563c : 0x4e2d26, 0.9, 0.01)
        );
      }
    }

    for (let row = 0; row < 13; row += 1) {
      const y = 0.72 + row * 0.42;
      const shift = row % 2 ? 0.42 : 0;
      for (let col = 0; col < 6; col += 1) {
        addBox(
          "left-visible-brick-line",
          0.82,
          0.045,
          0.08,
          -5.18 + col * 0.92 + shift,
          y,
          -12.1,
          mat("left-visible-brick-line", row % 3 ? 0x9a6345 : 0x523026, 0.9, 0.01)
        );
      }
    }

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 6.2, 6), mat("left-wall-pipe", 0x2a3032, 0.62, 0.03));
    pipe.position.set(x + 0.78, 3.25, z + 1.65);
    pipe.rotation.x = 0;
    world.root.add(pipe);

    const sticker = makeTextSprite("STAY\\nWEIRD", 0xff7bdf);
    sticker.position.set(-3.85, 3.25, -12.0);
    sticker.scale.set(1.25, 0.58, 1);
    world.root.add(sticker);
  }

  function addNorthStorefrontDetails() {
    addBox("opening-shop-door", 1.35, 2.25, 0.14, 11.9, 1.22, -12.94, mat("opening-shop-door", 0x25282d, 0.78, 0.02));
    addBox("opening-shop-window", 2.35, 1.05, 0.12, 14.2, 1.88, -12.9, mat("opening-shop-window", 0x182d36, 0.44, 0.05));
    addBox("opening-awning", 5.8, 0.32, 1.05, 13.05, 3.0, -12.65, mat("opening-awning", 0xb83d74, 0.62, 0.02));
    addBox("opening-awning-lip", 6.05, 0.16, 0.16, 13.05, 2.82, -12.08, mat("opening-awning-lip", 0xffd43b, 0.5, 0.03));

    const liquor = makeTextSprite("LIQUOR", 0xffffff);
    liquor.position.set(13.05, 3.42, -12.03);
    liquor.scale.set(2.85, 0.78, 1);
    world.root.add(liquor);

    const washed = makeTextSprite("STAY\\nWASHED", 0x2ee0ff);
    washed.position.set(18.1, 3.0, -12.78);
    washed.scale.set(2.25, 0.92, 1);
    world.root.add(washed);

    const tag = makeTextSprite("NO\\nBAD\\nVIBES", 0xff7b26);
    tag.position.set(9.2, 1.62, -12.78);
    tag.scale.set(1.5, 0.78, 1);
    world.root.add(tag);
  }

  function addOpeningBuildingTexture() {
    [
      ["tan-wall-panel", 3.2, 1.15, -1.7, 3.0, -13.43, 0x9b755a],
      ["tan-wall-panel", 2.4, 1.0, 1.5, 4.6, -13.42, 0x805f4d],
      ["tan-wall-panel", 2.9, 0.82, 4.2, 2.15, -13.42, 0xb28768],
      ["tan-wall-base", 10.5, 0.34, -0.4, 0.62, -13.38, 0x5f4639],
    ].forEach(([name, width, height, x, y, z, color]) => {
      addBox(name, width, height, 0.08, x, y, z, mat(name, color, 0.86, 0.01));
    });

    for (let i = 0; i < 6; i += 1) {
      const x = -4.4 + i * 1.85;
      addBox("tan-brick-line", 1.15, 0.055, 0.075, x, 1.15, -13.34, mat("tan-brick-line", 0x6e4f40, 0.9, 0.01));
      addBox("tan-brick-line", 1.35, 0.055, 0.075, x + 0.35, 1.82, -13.34, mat("tan-brick-line", 0x6e4f40, 0.9, 0.01));
    }

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if ((row === 1 && col === 2) || (row === 2 && col === 0)) continue;
        const x = -4.35 + col * 2.08;
        const y = 3.7 + row * 1.3;
        const lit = (row + col) % 3 === 0;
        addBox("tan-upper-window", 0.72, 0.52, 0.075, x, y, -13.28, mat("tan-upper-window", lit ? 0xffd75c : 0x2ee0ff, 0.42, 0.05));
        addBox("tan-window-sill", 0.88, 0.08, 0.09, x, y - 0.36, -13.22, mat("tan-window-sill", 0x3b3030, 0.86, 0.01));
      }
    }

    addBox("tan-fire-platform", 2.7, 0.11, 0.22, 1.8, 4.16, -13.08, mat("tan-fire-escape", 0x15181c, 0.64, 0.03));
    addBox("tan-fire-rail", 2.7, 0.08, 0.1, 1.8, 4.55, -13.0, mat("tan-fire-escape", 0x15181c, 0.64, 0.03));
    [-1, 0, 1].forEach((offset) => {
      addBox("tan-fire-rail-v", 0.08, 0.48, 0.08, 1.8 + offset * 0.9, 4.34, -13.0, mat("tan-fire-escape", 0x15181c, 0.64, 0.03));
    });
    addBox("tan-roof-chimney", 0.62, 1.2, 0.62, -3.8, 8.58, -14.55, mat("tan-roof-chimney", 0x5f382c, 0.76, 0.01));
    addBox("tan-roof-vent", 1.0, 0.34, 0.74, 2.2, 8.16, -14.2, mat("tan-roof-vent", 0x2b343a, 0.58, 0.03));

    const mural = makeTextSprite("STAY\\nODD", 0x2ee0ff);
    mural.position.set(3.75, 3.08, -13.29);
    mural.scale.set(1.85, 0.78, 1);
    world.root.add(mural);
  }

  function addRightOpeningFacadeDetails() {
    const frontZ = -11.92;
    addBox("right-building-door", 1.45, 2.25, 0.12, 28.75, 1.22, frontZ, mat("right-building-door", 0x182530, 0.74, 0.02));
    addBox("right-building-awning", 2.4, 0.24, 0.78, 28.75, 2.62, frontZ + 0.24, mat("right-building-awning", 0x2ee0ff, 0.58, 0.03));
    addBox("right-building-base-panel", 8.4, 0.38, 0.08, 28.7, 0.62, frontZ, mat("right-building-base", 0x22282f, 0.84, 0.01));

    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x = 24.9 + col * 2.4;
        const y = 3.2 + row * 1.45;
        const lit = (row + col) % 3 === 1;
        addBox("right-building-window", 0.82, 0.58, 0.075, x, y, frontZ + 0.03, mat("right-building-window", lit ? 0xffd75c : 0x2ee0ff, 0.42, 0.05));
        addBox("right-building-window-sill", 1.0, 0.08, 0.09, x, y - 0.39, frontZ + 0.07, mat("right-building-window-sill", 0x151a20, 0.86, 0.01));
      }
    }

    const washed = makeTextSprite("STAY\\nWASHED", 0x2ee0ff);
    washed.position.set(31.9, 4.05, frontZ + 0.12);
    washed.scale.set(2.15, 0.92, 1);
    world.root.add(washed);

    addBox("right-roof-chimney-a", 0.5, 1.05, 0.5, 25.4, 12.55, -13.1, mat("right-roof-chimney", 0x352823, 0.78, 0.02));
    addBox("right-roof-vent-a", 1.1, 0.34, 0.7, 30.5, 12.2, -12.95, mat("right-roof-vent", 0x283036, 0.64, 0.03));
  }

  function addOpeningSkylineDepth() {
    [
      [7.8, -25.2, 6.8, 4.2, 8.8, 0x7b614f],
      [15.6, -25.6, 5.6, 4.6, 10.2, 0x5f4a44],
      [22.8, -25.4, 6.4, 4.4, 9.4, 0x6b5548],
    ].forEach(([x, z, width, depth, height, color], index) => {
      addBox("opening-skyline-building", width, height, depth, x, height / 2, z, mat("opening-skyline-" + index, color, 0.88, 0.01));
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if ((row + col + index) % 4 === 0) continue;
          addBox(
            "opening-skyline-window",
            0.54,
            0.42,
            0.055,
            x - width / 2 + 1.2 + col * 1.6,
            2.4 + row * 1.45,
            z + depth / 2 + 0.05,
            mat("opening-skyline-window", (row + col) % 2 ? 0x2ee0ff : 0xffd75c, 0.45, 0.04)
          );
        }
      }
    });
  }

  function addRooftopSilhouettes() {
    const darkRoof = mat("roof-silhouette-dark", 0x1a2025, 0.82, 0.02);
    const rustyRoof = mat("roof-silhouette-rust", 0x5f3d2c, 0.78, 0.02);
    const metalRoof = mat("roof-silhouette-metal", 0x303a3f, 0.62, 0.04);

    addBox("roof-ac-box", 1.2, 0.38, 0.78, 12.75, 5.65, -12.82, metalRoof);
    addBox("roof-ac-vent", 0.46, 0.28, 0.46, 13.25, 6.0, -12.82, darkRoof);
    addBox("roof-stack", 0.48, 1.25, 0.48, 18.9, 6.15, -12.95, rustyRoof);
    addBox("roof-ladder-side-a", 0.06, 1.35, 0.06, 15.92, 5.92, -12.88, darkRoof);
    addBox("roof-ladder-side-b", 0.06, 1.35, 0.06, 16.38, 5.92, -12.88, darkRoof);
    for (let rung = 0; rung < 4; rung += 1) {
      addBox("roof-ladder-rung", 0.54, 0.05, 0.06, 16.15, 5.35 + rung * 0.28, -12.84, darkRoof);
    }

    const tank = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 8), rustyRoof);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.1, 8), mat("roof-tank-cap", 0x3a2922, 0.78, 0.02));
    barrel.rotation.z = Math.PI / 2;
    cap.rotation.z = Math.PI / 2;
    barrel.position.y = 0.72;
    cap.position.y = 1.12;
    tank.add(barrel, cap);
    [-0.28, 0.28].forEach((legX) => {
      [-0.2, 0.2].forEach((legZ) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.56, 0.045), darkRoof);
        leg.position.set(legX, 0.28, legZ);
        tank.add(leg);
      });
    });
    tank.position.set(5.9, 7.85, -13.42);
    tank.rotation.y = 0.16;
    tank.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    world.root.add(tank);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), darkRoof);
    mast.position.set(4.85, 7.0, -12.92);
    const antennaA = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.035, 0.035), darkRoof);
    const antennaB = antennaA.clone();
    antennaA.position.set(4.85, 7.42, -12.92);
    antennaB.position.set(4.85, 7.12, -12.92);
    antennaA.rotation.z = 0.22;
    antennaB.rotation.z = -0.16;
    world.root.add(mast, antennaA, antennaB);
  }

  function addOpeningGrassIsland() {
    addFlatPatch("opening-grass-island", 4.6, 1.65, 12.45, 0.172, -6.55, 0x315b3e, -0.05);
    addBox("opening-island-curb-a", 4.9, 0.16, 0.16, 12.45, 0.25, -7.42, mat("opening-island-curb", 0xa59e92));
    addBox("opening-island-curb-b", 4.9, 0.16, 0.16, 12.45, 0.25, -5.7, mat("opening-island-curb", 0xa59e92));
    addBox("opening-island-curb-c", 0.16, 0.16, 1.72, 10.04, 0.25, -6.55, mat("opening-island-curb", 0xa59e92));
    addBox("opening-island-curb-d", 0.16, 0.16, 1.72, 14.86, 0.25, -6.55, mat("opening-island-curb", 0xa59e92));
  }

  function addOpeningSidewalkCracks() {
    [
      ["opening-crack", 2.15, 0.045, 10.2, 0.205, -5.0, 0x20262d, 0.35],
      ["opening-crack", 1.6, 0.04, 12.0, 0.206, -5.9, 0x20262d, -0.16],
      ["opening-crack", 1.85, 0.04, 6.7, 0.206, -6.75, 0x20262d, 0.08],
      ["opening-pavement-chip", 0.78, 0.22, 13.95, 0.207, -6.25, 0x6a6f70, 0.14],
      ["opening-pavement-chip", 0.54, 0.2, 5.55, 0.208, -6.2, 0x4c5356, -0.34],
    ].forEach(([name, width, depth, x, y, z, color, rotation]) => {
      addFlatPatch(name, width, depth, x, y, z, color, rotation);
    });
  }

  function addOpeningPavementPatchwork() {
    [
      ["opening-sidewalk-large-slab", 2.7, 1.35, 9.9, 0.218, -5.1, 0x9ea49f, 0.02],
      ["opening-sidewalk-large-slab", 2.25, 1.12, 12.55, 0.219, -5.0, 0x858d8b, -0.04],
      ["opening-sidewalk-large-slab", 2.8, 1.18, 15.3, 0.22, -4.85, 0xa7aaa5, 0.03],
      ["opening-sidewalk-large-slab", 1.75, 0.92, 7.35, 0.221, -4.95, 0x70797a, -0.08],
      ["opening-road-chip", 0.74, 0.28, 19.45, 0.126, -2.95, 0x1e252b, 0.12],
      ["opening-road-chip", 0.55, 0.18, 22.8, 0.127, -2.2, 0x464b50, -0.28],
      ["opening-road-chip", 0.48, 0.16, 24.7, 0.128, -3.1, 0x22282f, 0.38],
      ["opening-road-oil", 1.55, 0.56, 21.55, 0.129, -3.1, 0x171d23, -0.08],
    ].forEach(([name, width, depth, x, y, z, color, rotation]) => {
      addFlatPatch(name, width, depth, x, y, z, color, rotation);
    });
  }

  function addOpeningStreetRubble() {
    [
      ["opening-paper-flake", 0.48, 0.22, 18.2, 0.218, -4.55, 0xe5d8bd, -0.42],
      ["opening-paper-flake", 0.36, 0.18, 20.35, 0.219, -5.92, 0xf0dfbc, 0.24],
      ["opening-paper-flake", 0.42, 0.2, 23.15, 0.22, -4.55, 0xcac1af, -0.18],
      ["opening-cardboard-scrap", 0.82, 0.42, 18.85, 0.221, -6.2, 0x9f6b37, 0.18],
      ["opening-cardboard-scrap", 0.68, 0.34, 22.5, 0.222, -6.48, 0xb98242, -0.26],
    ].forEach(([name, width, depth, x, y, z, color, rotation]) => {
      addFlatPatch(name, width, depth, x, y, z, color, rotation);
    });

    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.26, 8), mat("opening-paper-cup", 0xd9e1dc, 0.72, 0.01));
    cup.position.set(19.62, 0.32, -5.45);
    cup.rotation.z = 0.12;
    world.root.add(cup);

    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 8), mat("opening-soda-can", 0x2ee0ff, 0.48, 0.06));
    can.rotation.z = Math.PI / 2;
    can.position.set(21.3, 0.28, -4.25);
    world.root.add(can);
  }

  function addOpeningPoliceSceneDetails(x, z) {
    const redFlare = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3355, transparent: true, opacity: 0.42, depthWrite: false }));
    const blueFlare = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.42, depthWrite: false }));
    const sideLabel = makeTextSprite("POLICE", 0x111111);
    redFlare.position.set(x - 0.56, 2.42, z - 0.42);
    blueFlare.position.set(x + 0.56, 2.42, z - 0.42);
    redFlare.scale.set(2.45, 1.0, 1);
    blueFlare.scale.set(2.45, 1.0, 1);
    sideLabel.position.set(x - 0.35, 1.28, z - 1.58);
    sideLabel.scale.set(2.3, 0.56, 1);
    world.root.add(redFlare, blueFlare, sideLabel);

    addFlatPatch("police-red-reflection", 1.65, 0.8, x - 0.9, 0.132, z - 1.8, 0x5e1d2b, -0.06);
    addFlatPatch("police-blue-reflection", 1.65, 0.8, x + 0.9, 0.133, z - 1.78, 0x124b66, 0.08);
    addFlatPatch("police-car-shadow", 5.7, 2.2, x, 0.131, z, 0x171d22, 0.02);

    world.animatedVisuals.push({
      type: "openingPoliceGlow",
      redFlare,
      blueFlare,
      time: rand(0, Math.PI),
    });
  }

  function addHydrant(x, z) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.62, 8), mat("hydrant-body", 0xffd43b, 0.5, 0.04));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5), mat("hydrant-cap", 0xffed85, 0.42, 0.06));
    const side = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.56, 8), mat("hydrant-side", 0xffd43b, 0.5, 0.04));
    body.position.y = 0.44;
    cap.position.y = 0.82;
    side.position.y = 0.5;
    side.rotation.z = Math.PI / 2;
    group.add(body, cap, side);
    group.position.set(x, 0, z);
    group.rotation.y = -0.18;
    world.root.add(group);
    return group;
  }

  function addStreetCan(x, z) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.82, 10), mat("street-can", 0x1b2228, 0.7, 0.03));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.08, 10), mat("street-can-rim", 0x2c363d, 0.6, 0.04));
    body.position.y = 0.45;
    rim.position.y = 0.9;
    group.add(body, rim);
    group.position.set(x, 0, z);
    world.root.add(group);
    return group;
  }

  function addParkBench(x, z, rotation = 0) {
    const group = new THREE.Group();
    const benchMat = mat("park-bench-green", 0x315b3e, 0.72, 0.02);
    const legMat = mat("park-bench-leg", 0x1c2425, 0.68, 0.03);
    const seatA = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.18), benchMat);
    const seatB = seatA.clone();
    const backA = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.16, 0.18), benchMat);
    const backB = backA.clone();
    seatA.position.set(0, 0.54, -0.18);
    seatB.position.set(0, 0.54, 0.16);
    backA.position.set(0, 1.03, 0.44);
    backB.position.set(0, 1.34, 0.47);
    backA.rotation.x = -0.18;
    backB.rotation.x = -0.18;
    group.add(seatA, seatB, backA, backB);

    [-0.95, 0.95].forEach((legX) => {
      [-0.26, 0.26].forEach((legZ) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.14), legMat);
        leg.position.set(legX, 0.28, legZ);
        group.add(leg);
      });
    });

    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    world.root.add(group);
    return group;
  }

  function addDecorOfficer(x, z, rotation = 0) {
    const officer = createHuman({
      coat: palette.cop,
      head: 0xf2bc8c,
      pants: 0x10202a,
      scale: 0.98,
      label: "decor-officer",
    });
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.58), mat("decor-officer-hat", 0x07131b));
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), mat("decor-officer-badge", 0xffd43b, 0.32, 0.08));
    const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.88, 6), mat("decor-officer-baton", 0x1a1f24, 0.64, 0.03));
    hat.position.y = 2.42;
    badge.position.set(0.18, 1.55, -0.35);
    baton.position.set(0.62, 1.0, -0.06);
    baton.rotation.z = -0.45;
    officer.add(hat, badge, baton);
    officer.position.set(x, 0, z);
    officer.rotation.y = rotation;
    world.root.add(officer);
    world.animatedVisuals.push({
      type: "decorOfficer",
      group: officer,
      parts: officer.userData.parts,
      baton,
      baseY: 0,
      time: rand(0, Math.PI),
    });
    return officer;
  }

  function addOpeningWalker(x, z, rotation = 0, options = {}) {
    const walker = createHuman({
      coat: options.coat || 0x77513b,
      head: options.head || 0xc2875b,
      pants: options.pants || 0x243044,
      scale: options.scale || 0.98,
      label: options.label || "opening-walker",
    });
    const parts = walker.userData.parts || {};
    if (options.beanie) {
      const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.39, 0.22, 8), mat((options.label || "opening") + "-beanie", options.beanie));
      beanie.position.y = 2.4;
      walker.add(beanie);
    }
    if (options.hat) {
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.58), mat((options.label || "opening") + "-hat", 0x07131b));
      hat.position.y = 2.42;
      walker.add(hat);
    }
    if (parts.armL) parts.armL.rotation.z = 0.28;
    if (parts.armR) parts.armR.rotation.z = -0.28;
    if (parts.legL) parts.legL.rotation.x = 0.12;
    if (parts.legR) parts.legR.rotation.x = -0.12;
    walker.position.set(x, 0, z);
    walker.rotation.y = rotation;
    world.root.add(walker);
    world.animatedVisuals.push({
      type: "openingWalker",
      group: walker,
      parts,
      baseY: 0,
      speed: options.speed || 3.2,
      time: rand(0, Math.PI),
    });
    return walker;
  }

  function addPatrolCar(x, z, rotation = 0) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.78, 2.05), mat("patrol-white", 0xf2f4f2, 0.5, 0.03));
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 2.08), mat("patrol-black", 0x15191e, 0.52, 0.04));
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.92, 1.72), mat("patrol-cabin", 0x26313d, 0.42, 0.05));
    const bumperA = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 2.2), mat("patrol-bumper", 0x0c0f14, 0.6, 0.04));
    const bumperB = bumperA.clone();
    body.position.y = 0.62;
    hood.position.set(1.2, 0.98, 0);
    cabin.position.set(-0.7, 1.18, 0);
    bumperA.position.set(2.54, 0.56, 0);
    bumperB.position.set(-2.54, 0.56, 0);
    group.add(body, hood, cabin, bumperA, bumperB);

    [-1.65, 1.65].forEach((wheelX) => {
      [-1.08, 1.08].forEach((wheelZ) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10), mat("patrol-wheel", 0x0b0d10));
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wheelX, 0.35, wheelZ);
        group.add(wheel);
      });
    });

    const red = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.3), mat("patrol-red", 0xff3355, 0.35, 0.08));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.3), mat("patrol-blue", 0x2ee0ff, 0.35, 0.08));
    const policePanel = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 0.07), mat("patrol-door-panel", 0xf7f7ef, 0.54, 0.03));
    const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.18, 0.075), mat("patrol-side-stripe", 0x171b20, 0.52, 0.03));
    const rearPanel = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.45, 0.075), mat("patrol-rear-panel", 0x15191e, 0.52, 0.03));
    const policeText = makeTextSprite("POLICE", 0x111111);
    const headlightL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.44), mat("patrol-headlight", 0xfff0a8, 0.32, 0.08));
    const headlightR = headlightL.clone();
    const tailRedL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.32), mat("patrol-tail", 0xff3355, 0.3, 0.08));
    const tailRedR = tailRedL.clone();
    const glowRed = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3355, transparent: true, opacity: 0.52, depthWrite: false }));
    const glowBlue = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.52, depthWrite: false }));
    const redBeam = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3355, transparent: true, opacity: 0.32, depthWrite: false }));
    const blueBeam = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.32, depthWrite: false }));
    const washMaterialRed = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.22, depthWrite: false });
    const washMaterialBlue = new THREE.MeshBasicMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.22, depthWrite: false });
    const redWash = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.024, 1.2), washMaterialRed);
    const blueWash = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.024, 1.2), washMaterialBlue);
    const sideGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xf6f8ff, transparent: true, opacity: 0.22, depthWrite: false }));
    const redLight = new THREE.PointLight(0xff3355, 0.9, 9, 2);
    const blueLight = new THREE.PointLight(0x2ee0ff, 0.9, 9, 2);
    policePanel.position.set(-0.2, 0.82, -1.08);
    sideStripe.position.set(-0.34, 0.84, -1.125);
    rearPanel.position.set(-1.58, 0.82, -1.13);
    policeText.position.set(-0.2, 0.88, -1.16);
    policeText.scale.set(1.55, 0.42, 1);
    headlightL.position.set(2.62, 0.74, -0.48);
    headlightR.position.set(2.62, 0.74, 0.48);
    tailRedL.position.set(-2.62, 0.72, -0.48);
    tailRedR.position.set(-2.62, 0.72, 0.48);
    red.position.set(-0.28, 1.76, -0.18);
    blue.position.set(0.28, 1.76, -0.18);
    glowRed.position.set(-0.36, 1.86, -0.24);
    glowBlue.position.set(0.36, 1.86, -0.24);
    glowRed.scale.set(1.6, 1.0, 1);
    glowBlue.scale.set(1.6, 1.0, 1);
    redBeam.position.set(-0.68, 2.22, -0.34);
    blueBeam.position.set(0.68, 2.22, -0.34);
    redBeam.scale.set(3.1, 1.32, 1);
    blueBeam.scale.set(3.1, 1.32, 1);
    redWash.position.set(-0.64, 0.075, -1.45);
    blueWash.position.set(0.64, 0.078, -1.45);
    redWash.rotation.y = -0.1;
    blueWash.rotation.y = 0.1;
    sideGlow.position.set(0.0, 0.98, -1.26);
    sideGlow.scale.set(4.6, 1.0, 1);
    redLight.position.copy(red.position);
    blueLight.position.copy(blue.position);
    group.add(
      sideStripe,
      rearPanel,
      policePanel,
      policeText,
      headlightL,
      headlightR,
      tailRedL,
      tailRedR,
      red,
      blue,
      glowRed,
      glowBlue,
      redBeam,
      blueBeam,
      redWash,
      blueWash,
      sideGlow,
      redLight,
      blueLight
    );
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.scale.set(1.14, 1.14, 1.14);
    world.root.add(group);
    world.animatedVisuals.push({
      type: "patrolLights",
      red,
      blue,
      redLight,
      blueLight,
      glowRed,
      glowBlue,
      redBeam,
      blueBeam,
      redWash,
      blueWash,
      sideGlow,
      time: rand(0, Math.PI),
    });
    return group;
  }

  function addSeatedSidewalkScene(x, z, rotation = 0) {
    const group = new THREE.Group();
    const matBase = mat("seated-hoodie", 0x1f2a34, 0.76, 0.02);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.86, 0.54), matBase);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 9, 7), mat("seated-head", 0xc2875b, 0.62, 0.02));
    const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.39, 0.22, 8), mat("seated-beanie", 0x9b2e2e, 0.74, 0.02));
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.9), mat("seated-pants", 0x243044, 0.76, 0.02));
    const legR = legL.clone();
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.22), matBase);
    const armR = armL.clone();
    const matCardboard = mat("seated-cardboard", 0xb98242, 0.84, 0.01);
    const matDarkCardboard = mat("seated-cardboard-dark", 0x76502e, 0.84, 0.01);
    const matCup = mat("seated-cup", 0xbcc9c9, 0.55, 0.03);
    const cardboardMat = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 1.5), matDarkCardboard);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.52, 1.22, 0.08), matCardboard);
    const signText = makeTextSprite("PLEASE\\nHELP\\nANYTHING\\nHELPS", 0x2d1c12);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.34, 9), matCup);

    cardboardMat.position.set(0, 0.05, 0.12);
    body.position.set(-0.26, 0.74, 0);
    body.rotation.x = -0.1;
    head.position.set(-0.28, 1.36, 0.03);
    beanie.position.set(-0.28, 1.62, 0.03);
    beanie.scale.set(1, 0.7, 0.92);
    legL.position.set(-0.54, 0.22, 0.34);
    legR.position.set(0.08, 0.22, 0.36);
    legL.rotation.x = Math.PI / 2.9;
    legR.rotation.x = Math.PI / 3.2;
    legR.rotation.z = -0.2;
    armL.position.set(-0.78, 0.72, 0.16);
    armR.position.set(0.24, 0.72, 0.16);
    armL.rotation.z = 0.45;
    armR.rotation.z = -0.35;
    signBoard.position.set(0.94, 0.72, 0.24);
    signBoard.rotation.x = -0.2;
    signText.position.set(0.94, 0.75, 0.31);
    signText.scale.set(1.25, 0.86, 1);
    cup.position.set(1.64, 0.25, 0.28);

    group.add(cardboardMat, body, head, beanie, legL, legR, armL, armR, signBoard, signText, cup);
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    world.root.add(group);
    world.animatedVisuals.push({
      type: "seatedScene",
      group,
      signBoard,
      signText,
      time: rand(0, Math.PI),
    });
    return group;
  }

  function addWallSign(text, x, y, z, color) {
    const board = addBox("wall-sign", 4.8, 1.05, 0.16, x, y, z, mat("wall-sign-" + text, color, 0.4, 0.04));
    const label = makeTextSprite(text, 0xffffff);
    label.position.set(x, y + 0.02, z + 0.16);
    label.scale.set(3.2, 0.9, 1);
    world.root.add(label);
    return board;
  }

  function addCardboardSign(text, x, z, rotation = 0) {
    const group = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 0.12), mat("cardboard-sign", 0xb98242, 0.82, 0.01));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 0.24), mat("cardboard-foot", 0x7e542e, 0.84, 0.01));
    const label = makeTextSprite(text, 0x2d1c12);
    board.position.set(0, 0.72, 0);
    board.rotation.x = -0.16;
    foot.position.set(0, 0.12, 0.14);
    label.position.set(0, 0.78, 0.13);
    label.scale.set(1.35, 0.72, 1);
    group.add(board, foot, label);
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    world.root.add(group);
    return group;
  }

  function addInteractable(id, type, label, x, z, color, options = {}) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.08, 10), mat(id + "-base", color, 0.42, 0.05));
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), mat(id + "-marker", color, 0.32, 0.08));
    base.position.y = 0.09;
    marker.position.y = 1.15;
    group.add(base, marker);
    group.position.set(x, 0, z);
    world.root.add(group);
    world.interactables.push({
      id,
      type,
      label,
      group,
      marker,
      position: new THREE.Vector3(x, 0, z),
      radius: type === "scavenge" ? 2.25 : 2.8,
      dropoffId: options.dropoffId || "",
      carryType: options.carryType || "phone",
      heavy: Boolean(options.heavy),
      available: true,
      cooldown: 0,
    });
    return group;
  }

  function addObjectiveBeacon() {
    const group = new THREE.Group();
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd43b,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x2ee0ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.72, 4.2, 10, 1, true), beamMaterial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.055, 8, 24), ringMaterial);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 4), mat("objective-arrow", 0xffd43b));
    beam.position.y = 2.15;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    arrow.position.y = 4.62;
    arrow.rotation.y = Math.PI / 4;
    group.add(beam, ring, arrow);
    group.visible = false;
    world.root.add(group);
    world.objectiveBeacon = group;
  }

  async function initPhysics() {
    try {
      const module = await import(RAPIER_URL);
      const RAPIER = module.default || module;
      if (typeof RAPIER.init === "function") await RAPIER.init();

      const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.physics = {
        RAPIER,
        rapierWorld,
        props: [],
        ready: true,
      };
      state.physicsReady = true;

      addPhysicsFloor();
      world.blockers.forEach((blocker) => addPhysicsBlocker(blocker));
      addPhysicsProps();
      pushLog("Physics", "Stunt props are live. Kick boxes, barrels, and cans for extra chaos.");
      setStatus("Physics", "Stunt props armed");
    } catch (error) {
      state.physicsFallback = true;
      pushLog("Physics", "Stunt props are in fallback mode. The sandbox still runs.");
    }
  }

  function addPhysicsFloor() {
    const physics = world.physics;
    if (!physics) return;
    const RAPIER = physics.RAPIER;
    const body = physics.rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0)
    );
    physics.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(43, 0.18, 31), body);
  }

  function addPhysicsBlocker(blocker) {
    const physics = world.physics;
    if (!physics) return;
    const RAPIER = physics.RAPIER;
    const height = blocker.name === "trash" ? 1.1 : 3.8;
    const y = height / 2;
    const body = physics.rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(blocker.x, y, blocker.z)
    );
    physics.rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(blocker.w / 2, height / 2, blocker.d / 2),
      body
    );
  }

  function addPhysicsProps() {
    if (TOP_DOWN_VIEW) {
      [
        ["crate", -12.2, 5.6],
        ["barrel", 7.5, 5.1],
        ["box", 20.5, -6.9],
      ].forEach(([type, x, z]) => addPhysicsProp(type, x, z));
      return;
    }

    [
      ["crate", -14, 5.8],
      ["crate", -9.5, 4.2],
      ["barrel", 7.5, 5.1],
      ["barrel", 16.8, -6.3],
      ["can", -20.5, -7.3],
      ["can", 25.5, 6.2],
      ["box", 4.5, 8.8],
      ["box", -29.2, 1.4],
    ].forEach(([type, x, z]) => addPhysicsProp(type, x, z));
  }

  function addPhysicsProp(type, x, z) {
    const physics = world.physics;
    if (!physics) return;
    const RAPIER = physics.RAPIER;
    const settings = {
      crate: { size: [1.25, 1.05, 1.25], color: 0xb67842, shape: "box", y: 0.65, mass: 0.7 },
      box: { size: [1.5, 0.8, 1.1], color: 0xffd43b, shape: "box", y: 0.55, mass: 0.55 },
      barrel: { size: [0.62, 1.18, 0.62], color: 0x2ee0ff, shape: "cylinder", y: 0.82, mass: 0.85 },
      can: { size: [0.48, 0.68, 0.48], color: 0xff2e88, shape: "cylinder", y: 0.52, mass: 0.35 },
    }[type];

    const mesh = settings.shape === "cylinder"
      ? new THREE.Mesh(new THREE.CylinderGeometry(settings.size[0], settings.size[0], settings.size[1], 8), mat("phys-" + type, settings.color))
      : new THREE.Mesh(new THREE.BoxGeometry(settings.size[0], settings.size[1], settings.size[2]), mat("phys-" + type, settings.color));
    mesh.position.set(x, settings.y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.root.add(mesh);

    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, settings.y, z);
    if (typeof desc.setLinearDamping === "function") desc.setLinearDamping(0.75);
    if (typeof desc.setAngularDamping === "function") desc.setAngularDamping(0.38);
    const body = physics.rapierWorld.createRigidBody(desc);
    if (typeof body.setAdditionalMass === "function") body.setAdditionalMass(settings.mass, true);

    const colliderDesc = settings.shape === "cylinder"
      ? RAPIER.ColliderDesc.cylinder(settings.size[1] / 2, settings.size[0])
      : RAPIER.ColliderDesc.cuboid(settings.size[0] / 2, settings.size[1] / 2, settings.size[2] / 2);
    if (typeof colliderDesc.setRestitution === "function") colliderDesc.setRestitution(0.45);
    if (typeof colliderDesc.setFriction === "function") colliderDesc.setFriction(0.82);
    physics.rapierWorld.createCollider(colliderDesc, body);

    physics.props.push({
      type,
      mesh,
      body,
      home: new THREE.Vector3(x, settings.y, z),
      radius: Math.max(settings.size[0], settings.size[2]) * 0.9,
      cooldown: 0,
    });
  }

  function addCone(x, z) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 5), mat("cone", palette.cone));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.1, 0.75), mat("cone-stripe", 0xf9f4dc));
    body.position.y = 0.72;
    stripe.position.y = 0.32;
    group.add(body, stripe);
    group.position.set(x, 0, z);
    world.root.add(group);
    world.props.push({ type: "cone", group, radius: 0.7, available: true });
    return group;
  }

  function addTrashBag(x, z) {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.45, 0.8), 0), mat("trash", 0x15191e));
    mesh.scale.y = rand(0.65, 1.1);
    mesh.position.set(x, 0.45, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.root.add(mesh);
    world.blockers.push({ x, z, w: 1.1, d: 1.1, name: "trash" });
  }

  function addBananaPeel(x, z, dynamic = false, ownerSafeTime = 0) {
    const group = new THREE.Group();
    const peel = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.045, 5, 14, Math.PI * 1.35),
      mat("banana-peel", 0xffe45f, 0.62, 0.01)
    );
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.22), mat("banana-stem", 0x6e4a20, 0.7, 0.01));
    const shine = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.05), mat("banana-shine", 0xfff5a8, 0.45, 0.01));
    peel.rotation.x = Math.PI / 2;
    peel.rotation.z = rand(-0.45, 0.45);
    stem.position.set(0.18, 0.03, -0.2);
    stem.rotation.y = 0.8;
    shine.position.set(-0.04, 0.06, 0.1);
    shine.rotation.y = -0.5;
    group.add(peel, stem, shine);
    group.position.set(x, 0.08, z);
    group.rotation.y = rand(0, Math.PI * 2);
    world.root.add(group);

    const trap = {
      type: "banana",
      group,
      position: new THREE.Vector3(x, 0, z),
      home: new THREE.Vector3(x, 0, z),
      radius: dynamic ? 1.8 : 1.35,
      active: true,
      cooldown: 0,
      dynamic,
      ownerSafeTime,
      pulse: rand(0, Math.PI * 2),
    };
    world.traps.push(trap);
    return trap;
  }

  function addLamp(x, z) {
    addBox("lamp-post", 0.18, 4.2, 0.18, x, 2.1, z, mat("lamp-post", 0x222c36));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat("lamp-bulb", 0xffe187, 0.25, 0.1));
    bulb.position.set(x, 4.35, z);
    world.root.add(bulb);

    const light = new THREE.PointLight(0xffc469, 0.55, 9, 1.9);
    light.position.set(x, 4.4, z);
    light.visible = false;
    scene.add(light);
    world.lights["lamp-" + x + "-" + z] = light;
  }

  function addCamp() {
    const tent = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.1, 4), mat("tent", 0x2ee0ff));
    cover.rotation.y = Math.PI / 4;
    cover.scale.z = 1.45;
    cover.position.y = 1.05;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 0.08), mat("tent-flap", 0x0d1821));
    flap.position.set(0, 0.72, 1.72);
    tent.add(cover, flap);
    tent.position.set(-25, 0, 7.4);
    world.root.add(tent);
    world.markers.camp = tent;

    addBox("cart", 2.4, 1.1, 1.3, -28.8, 0.65, 8.2, mat("cart", 0xb9c0c4), true);
    addInteractable("camp-service", "camp", "Camp Stash", -24.6, 9.95, 0x2ee0ff);
  }

  function addPawnKiosk() {
    addBox("pawn-kiosk", 4.8, 3.4, 3.3, 23.5, 1.7, -9.4, mat("kiosk", 0x7d3159), true);
    addBox("pawn-sign", 4.2, 0.55, 0.18, 23.5, 3.72, -7.65, mat("sign", 0xffd43b));
    world.markers.kiosk = new THREE.Vector3(23.5, 0, -7.2);
    addInteractable("kiosk-service", "kiosk", "Pawn Kiosk", 22.1, -6.75, 0xffd43b);
  }

  function addAlleySpawns() {
    const spawnMat = mat("haze-grate", 0x67ff62, 0.35, 0.05);
    [
      [-29, -9.5],
      [-8, -10.5],
      [29, -9.5],
      [29, 8.8],
      [-31, 8.4],
    ].forEach(([x, z], index) => {
      const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.08, 8), spawnMat);
      grate.position.set(x, 0.15, z);
      grate.name = "haze-spawn";
      world.root.add(grate);
      world.markers["spawn-" + index] = new THREE.Vector3(x, 0, z);
    });
  }

  function addDistrictSigns() {
    [
      ["Busking Strip", 2.5, 13.8, 0xffd43b],
      ["Camp Row", -25.2, 13.4, 0x2ee0ff],
      ["Pawn Alley", 25.6, -4.8, 0xff2e88],
      ["Crosswalk Circus", 14.2, 3.2, 0xff7b26],
      ["Haze Mouth", -9.5, -9.2, 0x75ff92],
    ].forEach(([label, x, z, color]) => {
      addBox("district-post", 0.18, 2.1, 0.18, x - 1.65, 1.05, z, mat("district-post", 0x18202a));
      addBox("district-board", 3.7, 1.05, 0.18, x, 2.15, z, mat("district-board-" + label, color, 0.38, 0.04));
      const sprite = makeTextSprite(label.toUpperCase(), 0xffffff);
      sprite.position.set(x, 2.22, z + 0.16);
      sprite.scale.set(2.6, 0.82, 1);
      world.root.add(sprite);
    });
  }

  function buildPlayer() {
    player.group = createHuman({
      coat: palette.playerCoat,
      head: palette.player,
      pants: 0x263045,
      scale: 1.08,
      label: "player",
    });
    player.group.position.copy(playerStart);
    world.root.add(player.group);
    addPlayerStreetDetails();

    const plunger = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), mat("plunger-handle", 0x8b5531));
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.2, 0.35, 12), mat("plunger-cup", 0xb83348));
    handle.rotation.z = Math.PI / 2.8;
    handle.position.set(0.58, 1.25, -0.16);
    cup.rotation.z = Math.PI / 2.8;
    cup.position.set(1.12, 0.92, -0.36);
    plunger.add(handle, cup);
    player.group.add(plunger);
    player.tools.plunger = plunger;

    const mop = new THREE.Group();
    const mopHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.45, 6), mat("mop-handle", 0xd6b178));
    const mopHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.42), mat("mop-head", 0xeaf7ff, 0.72, 0.01));
    const mopBand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 6), mat("mop-band", 0x2ee0ff, 0.45, 0.05));
    mopHandle.rotation.z = Math.PI / 2.45;
    mopHandle.position.set(0.66, 1.34, -0.18);
    mopHead.position.set(1.34, 0.88, -0.36);
    mopBand.rotation.z = Math.PI / 2.45;
    mopBand.position.set(1.14, 1.02, -0.31);
    mop.add(mopHandle, mopHead, mopBand);
    mop.visible = false;
    player.group.add(mop);
    player.tools.mopSpear = mop;

    const chicken = new THREE.Group();
    const chickenBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.74, 8), mat("rubber-chicken", 0xffd43b, 0.55, 0.02));
    const chickenHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat("rubber-chicken-head", 0xffd43b, 0.55, 0.02));
    const chickenBeak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 5), mat("rubber-chicken-beak", 0xff7b26, 0.55, 0.02));
    const chickenComb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.06), mat("rubber-chicken-comb", 0xff4b6d, 0.5, 0.02));
    chickenBody.rotation.z = Math.PI / 2.7;
    chickenBody.position.set(0.74, 1.16, -0.21);
    chickenHead.position.set(1.18, 0.86, -0.28);
    chickenBeak.rotation.z = -Math.PI / 2;
    chickenBeak.position.set(1.38, 0.86, -0.28);
    chickenComb.position.set(1.18, 1.08, -0.28);
    chicken.add(chickenBody, chickenHead, chickenBeak, chickenComb);
    chicken.visible = false;
    player.group.add(chicken);
    player.tools.rubberChicken = chicken;

    player.attackArc = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.045, 6, 18, Math.PI * 1.15),
      mat("attack-arc", 0xfff08a, 0.25, 0.05)
    );
    player.attackArc.rotation.x = Math.PI / 2;
    player.attackArc.position.y = 0.22;
    player.attackArc.visible = false;
    player.group.add(player.attackArc);
  }

  function addPlayerStreetDetails() {
    const parts = player.group.userData.parts || {};
    const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.47, 0.32, 8), mat("player-beanie", 0x12191d, 0.78, 0.02));
    const beanieLip = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.24), mat("player-beanie-lip", 0x0a1013, 0.78, 0.02));
    const beanieRear = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.46, 0.28), mat("player-beanie-rear", 0x0e1519, 0.78, 0.02));
    const beanieBackFold = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.32), mat("player-beanie-back-fold", 0x090f12, 0.78, 0.02));
    const hairA = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.18), mat("player-hair", 0x6d4829, 0.84, 0.01));
    const hairB = hairA.clone();
    const hairC = hairA.clone();
    const hairD = hairA.clone();
    const hairE = hairA.clone();
    const backPatch = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.78, 0.055), mat("player-back-patch", 0xa97943, 0.84, 0.01));
    const backPatchLineA = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.045, 0.065), mat("player-back-patch-line", 0x5d3d25, 0.84, 0.01));
    const backPatchLineB = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.8, 0.066), mat("player-back-patch-line", 0x5d3d25, 0.84, 0.01));
    const backPatchLineC = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.64, 0.066), mat("player-back-patch-line", 0x5d3d25, 0.84, 0.01));
    const sleevePatch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.045), mat("player-sleeve-patch", 0x9f6939, 0.82, 0.01));
    const kneePatch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.055), mat("player-knee-patch", 0x8a603d, 0.82, 0.01));
    const gloveL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.24), mat("player-gloves", 0x11161b, 0.72, 0.02));
    const gloveR = gloveL.clone();
    const wristSign = new THREE.Group();
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.06), mat("player-sign-board", 0xb98242, 0.82, 0.01));
    const signLabel = makeTextSprite("FUNNY\\nSIGN", 0x2d1c12);
    const signLabelBack = makeTextSprite("FUNNY\\nSIGN", 0x2d1c12);

    beanie.position.y = 2.22;
    beanie.scale.set(1.16, 0.9, 1.06);
    beanieLip.position.set(0, 2.14, 0.22);
    beanieRear.position.set(0, 2.06, -0.36);
    beanieBackFold.position.set(0, 2.25, -0.38);
    hairA.position.set(-0.38, 1.78, -0.42);
    hairA.rotation.z = 0.2;
    hairB.position.set(0.38, 1.77, -0.42);
    hairB.rotation.z = -0.2;
    hairC.position.set(0, 1.7, -0.47);
    hairC.scale.set(1.28, 1.18, 1.12);
    hairD.position.set(-0.13, 1.66, -0.5);
    hairD.scale.set(0.82, 1.08, 1);
    hairE.position.set(0.14, 1.66, -0.5);
    hairE.scale.set(0.82, 1.08, 1);
    backPatch.position.set(0, 1.24, -0.52);
    backPatch.rotation.x = -0.05;
    backPatchLineA.position.set(0, 1.32, -0.555);
    backPatchLineA.rotation.x = -0.05;
    backPatchLineB.position.set(0.26, 1.24, -0.558);
    backPatchLineB.rotation.x = -0.05;
    backPatchLineC.position.set(-0.26, 1.18, -0.558);
    backPatchLineC.rotation.x = -0.05;
    sleevePatch.position.set(-0.1, 0.04, -0.14);
    kneePatch.position.set(-0.02, -0.1, -0.16);
    gloveL.position.set(0, -0.46, 0);
    gloveR.position.set(0, -0.46, 0);

    signBoard.position.set(0, 0, 0);
    signLabel.position.set(0, 0.02, 0.055);
    signLabel.scale.set(0.58, 0.32, 1);
    signLabelBack.position.set(0, 0.02, -0.055);
    signLabelBack.scale.set(0.58, 0.32, 1);
    wristSign.add(signBoard, signLabel, signLabelBack);
    wristSign.position.set(0.76, 0.55, -0.14);
    wristSign.rotation.set(-0.1, -0.24, -0.26);

    if (parts.armL) parts.armL.add(sleevePatch);
    if (parts.legR) parts.legR.add(kneePatch);
    if (parts.armL) parts.armL.add(gloveL);
    if (parts.armR) parts.armR.add(gloveR);
    player.group.add(beanie, beanieLip, beanieRear, beanieBackFold, hairA, hairB, hairC, hairD, hairE, backPatch, backPatchLineA, backPatchLineB, backPatchLineC, wristSign);
  }

  function createHuman(options) {
    const group = new THREE.Group();
    const scale = options.scale || 1;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * scale, 0.54 * scale, 1.18 * scale, 8), mat(options.label + "-coat", options.coat));
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.47 * scale, 8, 6), mat(options.label + "-coat", options.coat));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38 * scale, 10, 8), mat(options.label + "-head", options.head));
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25 * scale, 0.7 * scale, 0.25 * scale), mat(options.label + "-pants", options.pants));
    const legR = legL.clone();
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22 * scale, 0.72 * scale, 0.22 * scale), mat(options.label + "-sleeves", options.coat));
    const armR = armL.clone();

    body.position.y = 1.15 * scale;
    shoulders.position.y = 1.72 * scale;
    shoulders.scale.y = 0.46;
    head.position.y = 2.05 * scale;
    legL.position.set(-0.23 * scale, 0.38 * scale, 0);
    legR.position.set(0.23 * scale, 0.38 * scale, 0);
    armL.position.set(-0.64 * scale, 1.16 * scale, 0);
    armR.position.set(0.64 * scale, 1.16 * scale, 0);
    armL.rotation.z = 0.18;
    armR.rotation.z = -0.18;

    group.add(body, shoulders, head, legL, legR, armL, armR);
    group.userData.parts = { body, shoulders, head, legL, legR, armL, armR };
    group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return group;
  }

  function resetPlayerParts() {
    if (!player.group || !player.group.userData.parts) return;
    const parts = player.group.userData.parts;
    parts.body.rotation.set(0, 0, 0);
    parts.shoulders.rotation.set(0, 0, 0);
    parts.head.rotation.set(0, 0, 0);
    parts.legL.rotation.set(0, 0, 0);
    parts.legR.rotation.set(0, 0, 0);
    parts.armL.rotation.set(0, 0, 0.18);
    parts.armR.rotation.set(0, 0, -0.18);
  }

  function spawnPedestrians() {
    clearActors(world.pedestrians);
    world.pedSerial = 0;
    const pedestrianCount = VISUAL_TARGET ? 3 : 18;
    for (let i = 0; i < pedestrianCount; i += 1) {
      const point = getRandomPedestrianPoint();
      spawnPedestrian(point.x, point.z);
    }
  }

  function spawnPedestrian(x, z, mood) {
    const index = world.pedSerial;
    world.pedSerial += 1;
    const actor = {
      group: createHuman({
        coat: pick([0x2ee0ff, 0xffd43b, 0xff7b26, 0x9b70ff, 0x67d49f]),
        head: pick([0xffd1a6, 0x8b5734, 0x5d3b2a, 0xf0b58a]),
        pants: 0x202333,
        scale: rand(0.86, 1.05),
        label: "ped-" + index,
      }),
      speed: rand(1.1, 2.2),
      target: getRandomPedestrianPoint(),
      wait: rand(0, 2),
      mood: mood || pick(["tip", "film", "ignore", "complain"]),
    };
    actor.group.position.set(clamp(x, -31, 31), 0, clamp(z, -20, 20));
    world.root.add(actor.group);
    world.pedestrians.push(actor);
    return actor;
  }

  function spawnCop() {
    clearActors(world.cops);
    world.cops.push(createCop("cop-primary", 31, -3, 5.2, "Officer Overreact"));
    world.cops.push(createCop("cop-backup", -31, -4, 5.65, "Backup Unit"));
  }

  function createCop(label, x, z, speed, name) {
    const cop = {
      group: createHuman({
        coat: palette.cop,
        head: 0xf2bc8c,
        pants: 0x10202a,
        scale: 1.05,
        label,
      }),
      name,
      speed,
      active: false,
      kind: "cop",
      health: 999,
      velocity: new THREE.Vector3(),
      previous: new THREE.Vector3(x, 0, z),
    };
    cop.group.position.set(x, 0, z);
    world.root.add(cop.group);

    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 0.58), mat("cop-hat", 0x07131b));
    hat.position.y = 2.42;
    cop.group.add(hat);

    const redBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.2), mat(label + "-red", 0xff3355, 0.25, 0.2));
    const blueBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.2), mat(label + "-blue", 0x2ee0ff, 0.25, 0.2));
    redBeacon.position.set(-0.18, 2.56, 0);
    blueBeacon.position.set(0.18, 2.56, 0);
    cop.group.add(redBeacon, blueBeacon);

    cop.sirenRed = new THREE.PointLight(0xff3355, 0, 7, 2);
    cop.sirenBlue = new THREE.PointLight(0x2ee0ff, 0, 7, 2);
    cop.sirenRed.position.set(-0.25, 2.7, 0);
    cop.sirenBlue.position.set(0.25, 2.7, 0);
    cop.group.add(cop.sirenRed, cop.sirenBlue);
    cop.redBeacon = redBeacon;
    cop.blueBeacon = blueBeacon;
    updateCopSiren(cop, 0);
    return cop;
  }

  function clearActors(list) {
    list.forEach((actor) => {
      if (actor.group && actor.group.parent) actor.group.parent.remove(actor.group);
    });
    list.length = 0;
  }

  function resetRun() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.overlayMode = "none";
    state.awaitingDawnChoice = false;
    state.phase = "day";
    state.cycle = 1;
    state.time = 0;
    state.cash = 0;
    state.scrap = 0;
    state.heat = 0;
    state.hype = 0;
    state.energy = 100;
    state.health = 100;
    state.maxHealth = BASE_MAX_HEALTH;
    state.score = 0;
    state.high = api.getHighScore(GAME_ID);
    state.arrest = 0;
    state.action = "dance";
    state.actionCooldown = 0;
    state.attackCooldown = 0;
    state.throwCooldown = 0;
    state.stuntCooldown = 0;
    state.trapCooldown = 0;
    state.gooSlowTime = 0;
    state.tumbleTime = 0;
    state.tumbleDuration = 0;
    state.tumbleCombo = 0;
    state.tumbleHits = 0;
    state.tumbleCash = 0;
    state.tumbleSpin = 1;
    state.tumbleDistance = 0;
    state.bestTumble = 0;
    state.messageTimer = 0;
    state.waveKills = 0;
    state.waveSpawned = 0;
    state.waveSpawnTimer = 0;
    state.nightBossSpawned = false;
    state.seenHazeVariants = {};
    state.chaseActive = false;
    state.chaseCooldown = 0;
    state.chaseEscalation = 0;
    state.backupCalled = false;
    state.currentDistrictId = "";
    state.directorPressure = 0;
    state.directorTimer = DEBUG_TIMERS ? 1.8 : 5.2;
    state.directorIncident = "openBlock";
    state.directorIncidentTimer = 0;
    state.activeFavor = null;
    state.favorProgress = {};
    state.completedFavors.clear();
    state.gigIndex = 0;
    state.activeGig = null;
    state.gigActions.clear();
    state.jobIndex = 0;
    state.activeJob = null;
    state.carriedRoute = null;
    state.dawnPerk = null;
    state.dawnChoiceHistory = [];
    state.interactionCooldown = 0;
    state.coneAmmo = BASE_MAX_CONES;
    state.maxCones = BASE_MAX_CONES;
    state.peelAmmo = 2;
    state.maxPeels = BASE_MAX_PEELS;
    state.meleeTool = "plunger";
    Object.keys(state.upgrades).forEach((key) => {
      state.upgrades[key] = false;
    });
    Object.keys(state.campUpgrades).forEach((key) => {
      state.campUpgrades[key] = false;
    });

    player.group.position.copy(playerStart);
    player.group.rotation.set(0, 0, 0);
    resetPlayerParts();
    updatePlayerToolVisibility();
    player.previous.copy(playerStart);
    player.lastSafe.copy(playerStart);
    player.velocity.set(0, 0, 0);
    resetCameraLook();
    setLastMoveFromCamera();
    player.group.rotation.y = Math.atan2(input.lastMove.x, input.lastMove.z);

    clearActors(world.zombies);
    world.projectiles.forEach((item) => world.root.remove(item.group));
    world.projectiles.length = 0;
    world.floaters.forEach((item) => world.root.remove(item.mesh));
    world.floaters.length = 0;
    spawnPedestrians();
    spawnCop();
    updateActionButtons();
    updateUpgradeButtons();
    updateCampUpgradeButtons();
    selectNextGig(false);
    selectNextJob(false);
    clearCarriedRouteMesh();
    resetInteractables();
    resetTraps();
    resetPhysicsProps();
    applyVisualTargetState();
    pushLog("Goal", "Survive " + RUN_CYCLES + " day/night cycles. Keep heat under control.");
    setStatus("Goal", "Cycle " + getCycleLabel() + " · earn before night");
    hideOverlay();
    updateDayNightVisuals();
    updateDistrict(true);
    updateDirectorPanel();
    selectDistrictFavor(getCurrentDistrict(), false);
    updateHud();
    canvas.focus();
  }

  function bindControls() {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }
      if (event.key === "Escape" && (isPointerLocked() || performance.now() - cameraLook.lockReleasedAt < 220)) {
        event.preventDefault();
        releaseMouseLook();
        return;
      }
      input.keys.add(event.key.toLowerCase());
      if (event.key === "1") selectAction("dance");
      if (event.key === "2") selectAction("sign");
      if (event.key === "3") selectAction("drums");
      if (event.key === "4") selectAction("stunt");
      if (event.key === "5") selectMeleeTool("plunger");
      if (event.key === "6") selectMeleeTool("mopSpear");
      if (event.key === "7") selectMeleeTool("rubberChicken");
      if (event.key.toLowerCase() === "e") performSelectedAction();
      if (event.key === " ") doStunt();
      if (event.key.toLowerCase() === "j") plungerAttack();
      if (event.key.toLowerCase() === "k") throwCone();
      if (event.key.toLowerCase() === "l") dropBananaPeel();
      if (event.key.toLowerCase() === "p" || event.key === "Escape") togglePause();
    });

    window.addEventListener("keyup", (event) => {
      input.keys.delete(event.key.toLowerCase());
    });

    el.primary.addEventListener("click", handlePrimaryOverlayAction);
    el.pause.addEventListener("click", () => togglePause());
    el.restart.addEventListener("click", () => resetRun());
    el.actionGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button) selectAction(button.dataset.action);
    });
    el.upgradeGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-upgrade]");
      if (button) buyUpgrade(button.dataset.upgrade);
    });
    if (el.campUpgradeGrid) {
      el.campUpgradeGrid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-camp-upgrade]");
        if (button) buyCampUpgrade(button.dataset.campUpgrade);
      });
    }
    if (el.dawnChoiceGrid) {
      el.dawnChoiceGrid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-dawn-choice]");
        if (button) applyDawnChoice(button.dataset.dawnChoice);
      });
    }

    bindHold(el.mobileUp, "w");
    bindHold(el.mobileDown, "s");
    bindHold(el.mobileLeft, "a");
    bindHold(el.mobileRight, "d");
    bindTap(el.mobileAct, () => performSelectedAction());
    bindTap(el.mobileAttack, () => plungerAttack());

    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      if (event.button !== 0 || !canUseMouseLook()) return;
      event.preventDefault();
      cameraLook.dragging = true;
      cameraLook.pointerId = event.pointerId;
      cameraLook.lastX = event.clientX;
      cameraLook.lastY = event.clientY;
      canvas.classList.add("is-mouselook");
      if (canvas.requestPointerLock && event.pointerType === "mouse") {
        try {
          const lockRequest = canvas.requestPointerLock();
          if (lockRequest && typeof lockRequest.catch === "function") {
            lockRequest.catch(() => {
              // Pointer capture below keeps click-drag camera control working.
            });
          }
        } catch (error) {
          // Pointer capture below keeps click-drag camera control working.
        }
      }
      if (!isPointerLocked() && canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (error) {
          // Some browsers reject capture while pointer lock is pending.
        }
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (isPointerLocked() || !cameraLook.dragging || cameraLook.pointerId !== event.pointerId) return;
      applyMouseLookDelta(event.clientX - cameraLook.lastX, event.clientY - cameraLook.lastY);
      cameraLook.lastX = event.clientX;
      cameraLook.lastY = event.clientY;
    });
    canvas.addEventListener("pointerup", stopMouseLookDrag);
    canvas.addEventListener("pointercancel", stopMouseLookDrag);
    canvas.addEventListener("lostpointercapture", stopMouseLookDrag);
    window.addEventListener("mousemove", (event) => {
      if (!isPointerLocked() || !canUseMouseLook()) return;
      applyMouseLookDelta(event.movementX, event.movementY);
    });
    window.addEventListener("blur", releaseMouseLook);
    document.addEventListener("pointerlockchange", () => {
      const locked = isPointerLocked();
      if (!locked) {
        cameraLook.lockReleasedAt = performance.now();
        stopMouseLookDrag();
      }
      canvas.classList.toggle("is-mouselook", locked || cameraLook.dragging);
    });
    document.addEventListener("pointerlockerror", stopMouseLookDrag);
    window.addEventListener("resize", resizeRenderer);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.running && !state.gameOver && !state.awaitingDawnChoice) {
        state.paused = true;
        showOverlay("PAUSED", "The city is holding its breath.", "Resume", "pause");
      }
    });
  }

  function bindHold(button, key) {
    if (!button) return;
    const down = (event) => {
      event.preventDefault();
      input.virtual.add(key);
    };
    const up = (event) => {
      event.preventDefault();
      input.virtual.delete(key);
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointerleave", up);
    button.addEventListener("pointercancel", up);
  }

  function bindTap(button, handler) {
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handler();
    });
  }

  function selectAction(action) {
    if (!dayActions[action]) return;
    state.action = action;
    updateActionButtons();
    setStatus("Selected", dayActions[action].label);
  }

  function updateActionButtons() {
    document.querySelectorAll(".unhinged-action").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.action === state.action);
    });
  }

  function isMeleeToolOwned(tool) {
    const def = meleeDefs[tool];
    if (!def) return false;
    return !def.upgradeId || Boolean(state.upgrades[def.upgradeId]);
  }

  function toolForUpgrade(id) {
    return Object.keys(meleeDefs).find((tool) => meleeDefs[tool].upgradeId === id) || "";
  }

  function selectMeleeTool(tool, quiet = false) {
    const def = meleeDefs[tool];
    if (!def) return false;
    if (!isMeleeToolOwned(tool)) {
      setStatus("Locked", def.label + " is not owned");
      return false;
    }
    state.meleeTool = tool;
    updatePlayerToolVisibility();
    updateUpgradeButtons();
    if (!quiet) setStatus("Equipped", def.label);
    canvas.focus();
    return true;
  }

  function updatePlayerToolVisibility() {
    if (!player.tools) return;
    Object.entries(player.tools).forEach(([tool, mesh]) => {
      if (mesh) mesh.visible = tool === state.meleeTool && isMeleeToolOwned(tool);
    });
  }

  function getMeleeSpec() {
    if (!isMeleeToolOwned(state.meleeTool)) state.meleeTool = "plunger";
    const base = meleeDefs[state.meleeTool] || meleeDefs.plunger;
    const spec = Object.assign({}, base);
    if (state.meleeTool === "plunger" && state.upgrades.plungerTape) {
      spec.reach = 3.15;
      spec.damage = 52;
      spec.knockback = 9.5;
      spec.propRadius = 3.95;
      spec.propForce = 7.6;
      spec.hitStatus = "Tape bonk confirmed";
    }
    return spec;
  }

  function buyUpgrade(id) {
    if (!state.running || state.paused || state.gameOver) return;
    const def = upgradeDefs[id];
    if (!def) return;
    if (!def.repeat && state.upgrades[id]) {
      const tool = toolForUpgrade(id);
      if (tool) {
        selectMeleeTool(tool);
      } else {
        setStatus("Owned", def.label);
      }
      return;
    }
    if (state.cash < def.cost) {
      setStatus("Need Cash", def.label + " costs " + money(def.cost));
      return;
    }

    state.cash -= def.cost;
    state.score += Math.round(def.cost * 2.5);

    if (id === "plungerTape") {
      state.upgrades.plungerTape = true;
      pushLog("Pawn Kiosk", "The plunger got duct-taped into a proper night-shift bonker.");
      setStatus("Upgrade", "Plunger hits harder");
    } else if (id === "conePouch") {
      state.upgrades.conePouch = true;
      state.maxCones = 8;
      state.coneAmmo = clamp(state.coneAmmo + 4, 0, state.maxCones);
      pushLog("Pawn Kiosk", "Cone pouch installed. Completely legal, probably.");
      setStatus("Upgrade", "Cone capacity doubled");
    } else if (id === "cartPadding") {
      state.upgrades.cartPadding = true;
      state.maxHealth = 125;
      state.health = clamp(state.health + 25, 0, state.maxHealth);
      pushLog("Camp", "Cart padding added. Slapstick impacts now have upholstery.");
      setStatus("Upgrade", "+25 max health");
    } else if (id === "mopSpear") {
      state.upgrades.mopSpear = true;
      pushLog("Pawn Kiosk", "Mop spear unlocked. Reach improved, dignity unresolved.");
      selectMeleeTool("mopSpear", true);
      setStatus("Equipped", "Mop Spear");
    } else if (id === "rubberChicken") {
      state.upgrades.rubberChicken = true;
      pushLog("Pawn Kiosk", "Rubber chicken unlocked. The Haze hates squeaky comedy.");
      selectMeleeTool("rubberChicken", true);
      setStatus("Equipped", "Rubber Chicken");
    } else if (id === "mealTicket") {
      state.energy = clamp(state.energy + 50, 0, 100);
      state.health = clamp(state.health + 14, 0, state.maxHealth);
      state.heat = clamp(state.heat - 5, 0, 100);
      pushLog("Outreach", "Meal ticket cashed in. Energy up, heat down.");
      setStatus("Recovery", "Energy and health up");
    }

    updateUpgradeButtons();
    updateHud();
    canvas.focus();
  }

  function buyCampUpgrade(id) {
    if (!state.running || state.paused || state.gameOver || state.phase !== "day") return;
    const def = campUpgradeDefs[id];
    if (!def) return;
    if (state.campUpgrades[id]) {
      setStatus("Camp", def.label + " already built");
      return;
    }
    if (state.scrap < def.costScrap) {
      setStatus("Need Scrap", def.label + " needs " + def.costScrap + " scrap");
      return;
    }

    state.scrap -= def.costScrap;
    state.campUpgrades[id] = true;
    state.score += def.costScrap * 85;

    if (id === "tarpRoof") {
      state.maxHealth += 10;
      state.health = clamp(state.health + 16, 0, state.maxHealth);
      state.energy = clamp(state.energy + 12, 0, 100);
      pushLog("Camp Upgrade", "Tarp roof rigged. Recovery is steadier and max health rose.");
      setStatus("Camp Built", "+10 max health");
    } else if (id === "lanternRig") {
      state.directorPressure = clamp(state.directorPressure - 8, 0, 100);
      state.health = clamp(state.health + 8, 0, state.maxHealth);
      pushLog("Camp Upgrade", "Lantern rig lit the safe corner. Night Haze hits a little softer.");
      setStatus("Camp Built", "Night safety up");
    } else if (id === "peelBucket") {
      state.maxPeels += 2;
      state.peelAmmo = clamp(state.peelAmmo + 2, 0, state.maxPeels);
      pushLog("Camp Upgrade", "Peel bucket stocked. Slapstick trap capacity improved.");
      setStatus("Camp Built", "+2 peel capacity");
    }

    progressFavor("campHelp", 1, getCurrentDistrict());
    updateCampUpgradeButtons();
    updateUpgradeButtons();
    updateJobPanel();
    updateHud();
    canvas.focus();
  }

  function updateUpgradeButtons() {
    if (!el.upgradeGrid) return;
    el.upgradeGrid.querySelectorAll("[data-upgrade]").forEach((button) => {
      const id = button.dataset.upgrade;
      const def = upgradeDefs[id];
      const owned = Boolean(state.upgrades[id]) && !def.repeat;
      const tool = toolForUpgrade(id);
      const equipped = tool && state.meleeTool === tool;
      button.classList.toggle("is-owned", owned);
      button.classList.toggle("is-equipped", Boolean(equipped));
      button.disabled = !state.running || state.paused || state.gameOver || (!owned && state.cash < def.cost) || (owned && !tool);
      const price = button.querySelector("small");
      if (price) price.textContent = equipped ? "Equipped" : owned ? "Owned" : money(def.cost);
    });

    const activeTool = meleeDefs[state.meleeTool] || meleeDefs.plunger;
    const ownedLabels = Object.entries(upgradeDefs)
      .filter(([id, def]) => state.upgrades[id] && !def.repeat)
      .map(([, def]) => def.ownedText);
    el.gearSummary.textContent = "Tool: " + activeTool.label + (ownedLabels.length
      ? " · " + ownedLabels.join(" · ")
      : " · No upgrades yet.");
  }

  function updateCampUpgradeButtons() {
    if (!el.campUpgradeGrid) return;
    el.campUpgradeGrid.querySelectorAll("[data-camp-upgrade]").forEach((button) => {
      const id = button.dataset.campUpgrade;
      const def = campUpgradeDefs[id];
      const owned = Boolean(state.campUpgrades[id]);
      button.classList.toggle("is-owned", owned);
      button.disabled = !state.running || state.paused || state.gameOver || state.phase !== "day" || owned || state.scrap < def.costScrap;
      const price = button.querySelector("small");
      if (price) price.textContent = owned ? "Built" : def.costScrap + " scrap";
    });

    if (el.campSummary) {
      const ownedLabels = Object.entries(campUpgradeDefs)
        .filter(([id]) => state.campUpgrades[id])
        .map(([, def]) => def.ownedText);
      el.campSummary.textContent = ownedLabels.length
        ? ownedLabels.join(" · ")
        : "Spend scrap at camp for run-long shelter perks.";
    }
  }

  function selectNextGig(announce = true) {
    const def = gigDefs[state.gigIndex % gigDefs.length];
    state.activeGig = {
      id: def.id,
      title: def.title,
      desc: def.desc,
      target: def.target,
      rewardCash: def.rewardCash,
      rewardHype: def.rewardHype,
      progress: 0,
    };
    state.gigActions.clear();
    if (announce && state.running) {
      pushLog("Street Gig", def.title + ": " + def.desc);
    }
    updateGigPanel();
  }

  function addHype(amount) {
    if (!amount) return 0;
    const before = state.hype;
    state.hype = clamp(state.hype + amount, 0, 100);
    return state.hype - before;
  }

  function progressGig(event, amount = 1, actionKey = "") {
    const gig = state.activeGig;
    if (!state.running || !gig || state.phase !== "day") return;

    let nextProgress = gig.progress;
    if (gig.id === "warmup" && (event === "dayAction" || event === "propLaunch")) {
      nextProgress += amount;
    } else if (gig.id === "propTheater" && event === "propLaunch") {
      nextProgress += amount;
    } else if (gig.id === "mixedSet" && event === "dayAction") {
      state.gigActions.add(actionKey);
      nextProgress = state.gigActions.size;
    } else if (gig.id === "getaway" && event === "chaseLost") {
      nextProgress = 1;
    } else {
      return;
    }

    gig.progress = clamp(nextProgress, 0, gig.target);
    if (gig.progress >= gig.target) {
      completeGig(gig);
    } else {
      updateGigPanel();
    }
  }

  function completeGig(gig) {
    const rewardCash = Math.round(gig.rewardCash * (1 + state.hype * 0.004));
    state.cash += rewardCash;
    state.score += rewardCash * 12 + gig.rewardHype * 20;
    addHype(gig.rewardHype);
    addFloater("GIG +" + money(rewardCash), player.group.position, palette.cash);
    pushLog("Street Gig", gig.title + " complete. Bonus paid, hype up.");
    setStatus("Gig Done", "+" + money(rewardCash) + " hype +" + gig.rewardHype);
    state.gigIndex += 1;
    selectNextGig(true);
    updateUpgradeButtons();
  }

  function updateGigPanel() {
    const gig = state.activeGig;
    if (!gig || !el.gigTitle) return;
    const progress = clamp((gig.progress / gig.target) * 100, 0, 100);
    el.gigTitle.textContent = gig.title;
    el.gigDesc.textContent = gig.desc;
    el.gigProgress.style.width = percent(progress);
    el.gigProgress.style.backgroundColor = progress >= 100 ? "#75ff92" : "var(--accent-3)";
    el.gigProgressText.textContent = `${Math.round(gig.progress)}/${gig.target}`;
    el.gigReward.textContent = "Reward: " + money(gig.rewardCash) + " + " + gig.rewardHype + " hype";
  }

  function selectNextJob(announce = true) {
    const def = jobDefs[state.jobIndex % jobDefs.length];
    state.activeJob = {
      id: def.id,
      title: def.title,
      desc: def.desc,
      target: def.target,
      event: def.event,
      costScrap: def.costScrap || 0,
      routePickupId: def.routePickupId || "",
      routeDropoffId: def.routeDropoffId || "",
      routeFinalLabel: def.routeFinalLabel || "",
      routeFinalDistrictId: def.routeFinalDistrictId || "",
      rewardCash: def.rewardCash || 0,
      rewardScrap: def.rewardScrap || 0,
      rewardHype: def.rewardHype || 0,
      rewardHealth: def.rewardHealth || 0,
      rewardEnergy: def.rewardEnergy || 0,
      progress: 0,
      awaitingPerformance: false,
    };
    if (announce && state.running) {
      pushLog("Odd Job", def.title + ": " + def.desc);
    }
    prepareRouteJob();
    updateJobPanel();
  }

  function prepareRouteJob() {
    world.interactables.forEach((item) => {
      if (item.type !== "routePickup" && item.type !== "routeDropoff") return;
      if (isRouteJob(state.activeJob)) {
        const isActivePickup = item.id === state.activeJob.routePickupId;
        if (item.type === "routePickup") item.available = isActivePickup;
        item.group.visible = isActivePickup;
      } else {
        if (item.type === "routePickup") item.available = false;
        item.group.visible = false;
      }
    });
  }

  function progressJob(event, amount = 1) {
    const job = state.activeJob;
    if (!state.running || !job || state.phase !== "day" || job.event !== event) return;
    if (job.costScrap && state.scrap < job.costScrap) {
      setStatus("Need Scrap", job.costScrap + " scrap required");
      updateJobPanel();
      return;
    }
    job.progress = clamp(job.progress + amount, 0, job.target);
    if (job.progress >= job.target) {
      completeJob(job);
    } else {
      updateJobPanel();
    }
  }

  function isRouteJob(job) {
    return Boolean(job && job.routePickupId && job.routeDropoffId);
  }

  function completeJob(job) {
    if (job.costScrap && state.scrap < job.costScrap) {
      setStatus("Need Scrap", job.costScrap + " scrap required");
      updateJobPanel();
      return false;
    }

    state.scrap = Math.max(0, state.scrap - job.costScrap);
    state.cash += job.rewardCash;
    state.scrap += job.rewardScrap;
    state.health = clamp(state.health + job.rewardHealth, 0, state.maxHealth);
    state.energy = clamp(state.energy + job.rewardEnergy, 0, 100);
    addHype(job.rewardHype);
    state.score += job.rewardCash * 10 + job.rewardScrap * 35 + job.rewardHype * 18;
    addFloater("JOB +" + money(job.rewardCash), player.group.position, palette.cash);
    pushLog("Odd Job", job.title + " finished. Useful junk became useful money.");
    setStatus("Odd Job", "+" + money(job.rewardCash) + " scrap " + state.scrap);
    state.jobIndex += 1;
    clearCarriedRoute();
    selectNextJob(true);
    updateUpgradeButtons();
    updateJobPanel();
    return true;
  }

  function updateJobPanel() {
    const job = state.activeJob;
    if (!job || !el.jobTitle) return;
    const progress = clamp((job.progress / job.target) * 100, 0, 100);
    el.jobTitle.textContent = job.title;
    el.jobDesc.textContent = job.desc;
    el.jobProgress.style.width = percent(progress);
    el.jobProgress.style.backgroundColor = progress >= 100 ? "#75ff92" : "var(--accent-2)";
    el.jobProgressText.textContent = `${Math.round(job.progress)}/${job.target}`;
    el.jobReward.textContent = job.costScrap
      ? "Needs " + job.costScrap + " scrap · Reward: " + money(job.rewardCash)
      : isRouteJob(job)
        ? (job.event === "deliveryShow" ? "Carry prop + finale · Reward: " : "Carry item · Reward: ") + money(job.rewardCash) + " + " + job.rewardScrap + " scrap"
        : "Reward: " + money(job.rewardCash) + " + " + job.rewardScrap + " scrap";
    el.meterScrap.style.width = percent(Math.min(100, state.scrap * 12.5));
    el.meterScrap.style.backgroundColor = state.scrap >= (job.costScrap || 3) ? "#75ff92" : "var(--accent-3)";
    el.meterScrapText.textContent = state.scrap.toString();
  }

  function getNearbyInteractable() {
    if (!state.running || state.paused || state.gameOver) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    world.interactables.forEach((item) => {
      if (!isInteractableEnabled(item)) return;
      const distance = Math.sqrt(dist2(item.position, player.group.position));
      const priority = item.type === "routePickup" || item.type === "routeDropoff" ? 2.5 : 0;
      const score = distance - priority;
      if (distance < item.radius && score < nearestDistance) {
        nearest = item;
        nearestDistance = score;
      }
    });
    return nearest;
  }

  function isInteractableEnabled(item) {
    if (!item) return false;
    if (item.type === "scavenge") return state.phase === "day" && item.available && item.cooldown <= 0;
    if (item.type === "routePickup") {
      return state.phase === "day" &&
        item.available &&
        !state.carriedRoute &&
        state.activeJob &&
        isRouteJob(state.activeJob) &&
        item.id === state.activeJob.routePickupId;
    }
    if (item.type === "routeDropoff") {
      return state.phase === "day" &&
        state.carriedRoute &&
        state.carriedRoute.dropoffId === item.id;
    }
    return state.phase === "day";
  }

  function performInteraction(item) {
    if (!item || state.interactionCooldown > 0) return false;
    state.interactionCooldown = 0.45;
    if (item.type === "scavenge") {
      scavengeCache(item);
      return true;
    }
    if (item.type === "routePickup") {
      pickupRouteItem(item);
      return true;
    }
    if (item.type === "routeDropoff") {
      dropoffRouteItem(item);
      return true;
    }
    if (item.type === "kiosk") {
      interactKiosk();
      return true;
    }
    if (item.type === "camp") {
      interactCamp();
      return true;
    }
    return false;
  }

  function scavengeCache(item) {
    const district = getCurrentDistrict();
    const director = getDirectorMultipliers();
    const scrapFound = Math.max(1, Math.round(
      rand(1, 3) * district.scrapMult + (state.directorIncident === "scrapGlint" && state.directorIncidentTimer > 0 ? 1 : 0)
    )) + (hasDawnPerk("scrapCartSprint") ? 1 : 0);
    const cashFound = Math.round(rand(1, 5) * (1 + state.hype * 0.003) * district.cashMult * director.cash);
    const peelFound = state.peelAmmo < state.maxPeels ? 1 : 0;
    state.scrap += scrapFound;
    state.cash += cashFound;
    state.peelAmmo = clamp(state.peelAmmo + peelFound, 0, state.maxPeels);
    state.energy = clamp(state.energy + rand(2, 6), 0, 100);
    state.heat = clamp(state.heat + rand(0.5, 2.2) * district.heatMult * director.heat * getHeatGainMultiplier(), 0, 100);
    addHype(Math.max(1, Math.round(2 * district.hypeMult * director.hype)));
    item.available = false;
    item.cooldown = DEBUG_TIMERS ? 5.5 : 24;
    item.group.scale.set(0.72, 0.72, 0.72);
    item.group.traverse((child) => {
      if (child.isMesh) child.visible = child === item.marker;
    });
    addFloater("+" + scrapFound + " scrap", item.position, palette.cash);
    pushLog("Scavenge", item.label + " had " + scrapFound + " scrap, " + money(cashFound) + (peelFound ? ", and a suspicious banana peel." : "."));
    setStatus("Scavenge", "+" + scrapFound + " scrap +" + money(cashFound) + (peelFound ? " +peel" : ""));
    progressJob("scavenge", 1);
    progressGig("dayAction", 2, "scavenge");
    progressFavor("pawnScrap", scrapFound, district);
    progressFavor("openAssist", 1, district);
    updateUpgradeButtons();
    updateJobPanel();
  }

  function pickupRouteItem(item) {
    if (!isRouteJob(state.activeJob)) {
      setStatus("Odd Job", "No delivery active");
      return;
    }
    state.carriedRoute = {
      pickupId: item.id,
      dropoffId: item.dropoffId,
      label: item.label,
      carryType: item.carryType || "phone",
      heavy: item.heavy,
    };
    item.available = false;
    item.group.visible = false;
    createCarriedRouteMesh();
    progressJob(state.activeJob.event, 1);
    pushLog("Odd Job", item.label + " picked up. Get it to the return marker.");
    setStatus("Picked Up", item.label);
    updateJobPanel();
  }

  function dropoffRouteItem(item) {
    if (!state.carriedRoute) {
      setStatus("Odd Job", "Nothing carried");
      return;
    }
    const label = state.carriedRoute.label;
    clearCarriedRoute();
    addFloater("DELIVERED", item.position, palette.cash);
    pushLog("Odd Job", label + " delivered without becoming street confetti.");
    const job = state.activeJob;
    progressJob(job ? job.event : "delivery", 1);
    if (job && job.event === "deliveryShow" && job.progress < job.target) {
      job.awaitingPerformance = true;
      pushLog("Odd Job", "Amp is plugged in. Perform nearby to finish the bit.");
      setStatus("Finale", "Perform at " + item.label);
      updateJobPanel();
    }
    progressFavor("openAssist", 1, getCurrentDistrict());
    updateHud();
  }

  function createCarriedRouteMesh() {
    clearCarriedRouteMesh();
    const group = new THREE.Group();
    const carryType = state.carriedRoute ? state.carriedRoute.carryType : "phone";
    if (carryType === "amp") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.68, 0.46), mat("route-amp", 0x151723, 0.62, 0.05));
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.48, 0.05), mat("route-amp-face", 0xff2e88, 0.38, 0.08));
      const speakerL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12), mat("route-amp-speaker", 0x2ee0ff, 0.35, 0.08));
      const speakerR = speakerL.clone();
      face.position.z = -0.26;
      speakerL.rotation.x = Math.PI / 2;
      speakerR.rotation.x = Math.PI / 2;
      speakerL.position.set(-0.22, 0.08, -0.31);
      speakerR.position.set(0.22, 0.08, -0.31);
      group.add(box, face, speakerL, speakerR);
      group.position.set(0.02, 1.45, -0.72);
      group.rotation.set(-0.12, 0, 0);
    } else {
      const phone = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.72), mat("route-phone", 0x101723, 0.35, 0.08));
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.54), mat("route-phone-screen", 0x2ee0ff, 0.2, 0.12));
      screen.position.y = 0.06;
      group.add(phone, screen);
      group.position.set(0.08, 2.45, -0.55);
      group.rotation.set(-0.35, 0.45, 0.1);
    }
    player.group.add(group);
    world.carriedItem = group;
  }

  function clearCarriedRoute() {
    state.carriedRoute = null;
    clearCarriedRouteMesh();
  }

  function clearCarriedRouteMesh() {
    if (world.carriedItem && world.carriedItem.parent) {
      world.carriedItem.parent.remove(world.carriedItem);
    }
    world.carriedItem = null;
  }

  function interactKiosk() {
    if (state.activeJob && state.activeJob.event === "kioskTurnIn") {
      if (state.scrap >= state.activeJob.costScrap) {
        progressFavor("pawnScrap", state.activeJob.costScrap || 1, getCurrentDistrict());
        progressFavor("openAssist", 1, getCurrentDistrict());
      }
      progressJob("kioskTurnIn", 1);
      updateHud();
      return;
    }
    if (state.scrap <= 0) {
      setStatus("Pawn Kiosk", "Bring scrap");
      return;
    }
    const sold = Math.min(2, state.scrap);
    const earned = sold * 5;
    state.scrap -= sold;
    state.cash += earned;
    state.heat = clamp(state.heat + 1.5, 0, 100);
    addHype(1);
    addFloater("+" + money(earned), player.group.position, palette.cash);
    pushLog("Pawn Kiosk", "Traded " + sold + " scrap for quick cash.");
    setStatus("Pawn", "+" + money(earned));
    progressFavor("pawnScrap", sold, getCurrentDistrict());
    updateUpgradeButtons();
    updateJobPanel();
  }

  function interactCamp() {
    if (state.activeJob && state.activeJob.event === "campDeposit") {
      if (state.scrap >= state.activeJob.costScrap) {
        progressFavor("campHelp", state.activeJob.costScrap || 1, getCurrentDistrict());
        progressFavor("openAssist", 1, getCurrentDistrict());
      }
      progressJob("campDeposit", 1);
      updateHud();
      return;
    }
    const patchCost = hasCampUpgrade("tarpRoof") ? 1 : 2;
    if (state.scrap < patchCost) {
      setStatus("Camp", "Need " + patchCost + " scrap");
      return;
    }
    const healthGain = hasCampUpgrade("tarpRoof") ? 18 : 10;
    const energyGain = hasCampUpgrade("tarpRoof") ? 20 : 12;
    const peelGain = hasCampUpgrade("peelBucket") && state.peelAmmo < state.maxPeels ? 1 : 0;
    state.scrap -= patchCost;
    state.health = clamp(state.health + healthGain, 0, state.maxHealth);
    state.energy = clamp(state.energy + energyGain, 0, 100);
    state.peelAmmo = clamp(state.peelAmmo + peelGain, 0, state.maxPeels);
    state.heat = clamp(state.heat - (hasCampUpgrade("tarpRoof") ? 3 : 0), 0, 100);
    state.score += 70 + patchCost * 20;
    pushLog("Camp", "A quick patch job turned scrap into a little comfort.");
    setStatus("Camp Patch", "+health +energy" + (peelGain ? " +peel" : ""));
    progressFavor("campHelp", patchCost, getCurrentDistrict());
    updateJobPanel();
    updateHud();
  }

  function performSelectedAction() {
    if (!state.running || state.paused || state.gameOver) return;
    const nearby = getNearbyInteractable();
    if (nearby && performInteraction(nearby)) return;
    if (state.phase !== "day") {
      setStatus("Night", "Use plunger or cones");
      return;
    }
    if (state.actionCooldown > 0) return;
    const action = dayActions[state.action];
    const district = getCurrentDistrict();
    const director = getDirectorMultipliers();
    const nearCrowd = countNearPedestrians(action.radius);
    const crowdBonus = Math.min(nearCrowd, 5);
    const baseEarned = rand(action.cash[0], action.cash[1]) + crowdBonus * rand(1.5, 3.2);
    const districtActionBonus = district.id === "crosswalk" && state.action === "stunt" ? 1.18 : 1;
    const earned = Math.round(baseEarned * (1 + state.hype * 0.004) * district.cashMult * director.cash * districtActionBonus * getDayCashMultiplier());
    const hypeGain = Math.max(1, Math.round((action.hype + crowdBonus) * district.hypeMult * director.hype * districtActionBonus));
    const heatGain = Math.max(1, Math.round((action.heat + Math.max(0, crowdBonus - 2) + (state.hype > 62 ? 2 : 0)) * district.heatMult * director.heat * getHeatGainMultiplier()));
    const energyCost = action.energy;

    if (state.energy < energyCost * 0.45) {
      setStatus("Tired", "Catch your breath first");
      pushLog("Energy", "The bit fizzled. Too tired to sell the chaos.");
      state.actionCooldown = 1.1;
      return;
    }

    state.cash += earned;
    state.heat = clamp(state.heat + heatGain, 0, 100);
    state.energy = clamp(state.energy - energyCost, 0, 100);
    addHype(hypeGain);
    state.actionCooldown = 1.2;
    state.score += earned * 4 + crowdBonus * 10;
    pulsePlayer(state.action === "stunt" ? 1.6 : 1);
    addFloater("+" + money(earned), player.group.position, palette.cash);
    spawnTipCoins(earned, crowdBonus);
    pushLog(action.log[0], action.log[1]);
    setStatus(action.label, "+" + money(earned) + " hype +" + hypeGain);
    progressGig("dayAction", hypeGain, state.action);
    progressFavor("districtHype", hypeGain, district);
    progressRouteFinale(action.label);

    if (state.action === "stunt") {
      player.velocity.add(input.lastMove.clone().multiplyScalar(4.2));
      state.health = clamp(state.health - rand(0, 6), 0, state.maxHealth);
      progressFavor("crosswalkStunt", 1, district);
    }

    if (state.heat >= HEAT_CHASE_AT) startChase();
    updateUpgradeButtons();
    updateHud();
  }

  function countNearPedestrians(radius) {
    const p = player.group.position;
    const r2 = radius * radius;
    return world.pedestrians.reduce((count, actor) => count + (dist2(actor.group.position, p) <= r2 ? 1 : 0), 0);
  }

  function progressRouteFinale(actionLabel) {
    const job = state.activeJob;
    if (!job || job.event !== "deliveryShow" || !job.awaitingPerformance) return;
    const dropoff = getInteractableById(job.routeDropoffId);
    const nearDropoff = dropoff && Math.sqrt(dist2(dropoff.position, player.group.position)) < 7;
    const districtOk = !job.routeFinalDistrictId || getCurrentDistrict().id === job.routeFinalDistrictId;
    if (!nearDropoff && !districtOk) return;

    job.awaitingPerformance = false;
    pushLog("Odd Job", actionLabel + " powered the amp. The whole strip heard it.");
    addFloater("AMP LIVE", player.group.position, palette.curb);
    progressJob(job.event, 1);
    progressFavor("openAssist", 1, getCurrentDistrict());
  }

  function spawnTipCoins(earned, count) {
    const coinCount = Math.min(8, Math.max(2, Math.ceil(earned / 5) + count));
    for (let i = 0; i < coinCount; i += 1) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 10), mat("coin", palette.cash, 0.3, 0.2));
      coin.rotation.x = Math.PI / 2;
      coin.position.copy(player.group.position);
      coin.position.x += rand(-1.7, 1.7);
      coin.position.y = rand(1.1, 2.5);
      coin.position.z += rand(-1.7, 1.7);
      world.root.add(coin);
      world.floaters.push({
        mesh: coin,
        velocity: new THREE.Vector3(rand(-0.8, 0.8), rand(1.2, 2.2), rand(-0.8, 0.8)),
        life: rand(0.7, 1.25),
        spin: rand(3, 8),
      });
    }
  }

  function doStunt() {
    if (!state.running || state.paused || state.gameOver || state.stuntCooldown > 0) return;
    if (state.energy < 9) {
      setStatus("Tired", "No stunt juice");
      return;
    }
    const direction = input.lastMove.clone();
    if (direction.lengthSq() <= 0.01) direction.set(0, 0, -1);
    direction.normalize();

    state.energy = clamp(state.energy - 9, 0, 100);
    state.stuntCooldown = 0.7;
    state.tumbleDuration = 1.35;
    state.tumbleTime = state.tumbleDuration;
    state.tumbleCombo = 1;
    state.tumbleHits = 0;
    state.tumbleCash = 2;
    state.tumbleDistance = 0;
    state.tumbleSpin = rand(0, 1) > 0.5 ? 1 : -1;
    player.velocity.add(direction.multiplyScalar(8.8));
    pulsePlayer(1.4);
    addFloater("TUMBLE x1", player.group.position, palette.curb);
    const propHits = kickPhysicsProps(player.group.position, 4.5, 9.5, "PROP LAUNCH");
    if (state.phase === "day") {
      const district = getCurrentDistrict();
      const director = getDirectorMultipliers();
      state.heat = clamp(state.heat + 4 * district.heatMult * director.heat * getHeatGainMultiplier(), 0, 100);
      if (propHits <= 0) progressFavor("crosswalkStunt", 1, district);
      updateUpgradeButtons();
    }
    if (propHits > 0) {
      pushLog("Tumble", "Loose props went flying. The crowd respected the terrible physics.");
      setStatus("Tumble Chain", "combo x" + state.tumbleCombo);
    } else {
      setStatus("Tumble", "Find a prop for combo");
    }
  }

  function extendTumbleChain(hits) {
    if (hits <= 0 || state.tumbleTime <= 0) return;
    state.tumbleHits += hits;
    state.tumbleCombo += hits;
    state.tumbleCash += hits * 3;
    state.tumbleTime = Math.min(state.tumbleDuration + 0.45, state.tumbleTime + hits * 0.2);
    state.tumbleDuration = Math.max(state.tumbleDuration, state.tumbleTime);
    state.bestTumble = Math.max(state.bestTumble, state.tumbleCombo);
    pulsePlayer(1.25);
  }

  function finishTumbleChain() {
    if (state.tumbleCombo <= 0) return;
    const combo = state.tumbleCombo;
    const distanceBonus = Math.min(8, Math.floor(state.tumbleDistance / 3.5));
    const district = getCurrentDistrict();
    const director = getDirectorMultipliers();
    const earned = state.phase === "day"
      ? Math.max(3, Math.round((state.tumbleCash + combo + distanceBonus) * district.cashMult * director.cash))
      : 0;
    const hypeGain = state.phase === "day" ? Math.min(14, combo + state.tumbleHits * 2) : 0;

    state.bestTumble = Math.max(state.bestTumble, combo);
    if (state.phase === "day") {
      state.cash += earned;
      state.heat = clamp(state.heat + Math.max(1, combo - 1) * 0.75 * district.heatMult * director.heat * getHeatGainMultiplier(), 0, 100);
      state.score += earned * 10 + combo * 55 + Math.round(state.tumbleDistance * 4);
      addHype(hypeGain);
      progressGig("dayAction", Math.max(1, Math.ceil(combo / 2)), "stunt");
      progressFavor("districtHype", Math.max(1, Math.ceil(hypeGain / 4)), district);
      updateUpgradeButtons();
    } else {
      state.score += combo * 35 + Math.round(state.tumbleDistance * 3);
    }

    addFloater("TUMBLE x" + combo + (earned ? " +" + money(earned) : ""), player.group.position, palette.curb);
    setStatus("Tumble Chain", "x" + combo + (earned ? " · " + money(earned) : ""));
    if (combo >= 4) {
      pushLog("Tumble", "A sidewalk tumble chain somehow became a performance piece.");
    }

    state.tumbleTime = 0;
    state.tumbleDuration = 0;
    state.tumbleCombo = 0;
    state.tumbleHits = 0;
    state.tumbleCash = 0;
    state.tumbleDistance = 0;
  }

  function plungerAttack() {
    if (!state.running || state.paused || state.gameOver || state.attackCooldown > 0) return;
    const spec = getMeleeSpec();
    state.attackCooldown = spec.cooldown;
    player.attackArc.visible = true;
    player.attackArc.scale.setScalar(Math.max(0.85, spec.reach / 2.6));
    setTimeout(() => {
      if (player.attackArc) {
        player.attackArc.visible = false;
        player.attackArc.scale.setScalar(1);
      }
    }, spec.cooldown > 0.4 ? 150 : 120);

    const origin = player.group.position;
    let hits = 0;
    const targets = state.phase === "night" ? world.zombies : world.cops.filter((cop) => cop.active);
    const propHits = kickPhysicsProps(origin, spec.propRadius, spec.propForce, spec.floater + " CLATTER");
    targets.forEach((target) => {
      const targetPos = target.group.position;
      const distance = Math.sqrt(dist2(origin, targetPos));
      if (distance > spec.reach) return;
      tmpVec.copy(targetPos).sub(origin).setY(0).normalize();
      if (tmpVec.dot(input.lastMove) < -0.15) return;
      hitActor(target, spec.damage, spec.knockback, spec);
      hits += 1;
    });

    if (hits > 0) {
      state.score += hits * 80;
      if (spec.hype && state.phase === "day") addHype(spec.hype * hits);
      addFloater(spec.floater + " x" + hits, origin, palette.curb);
      setStatus(spec.label, spec.hitStatus);
    } else if (propHits > 0) {
      setStatus(spec.label, "Prop clatter x" + propHits);
    } else {
      setStatus(spec.label, spec.emptyStatus);
    }
  }

  function throwCone() {
    if (!state.running || state.paused || state.gameOver || state.throwCooldown > 0) return;
    if (state.coneAmmo <= 0) {
      setStatus("Cones", "Find more cones");
      return;
    }
    state.throwCooldown = 0.75;
    state.coneAmmo -= 1;
    const group = addCone(0, 0);
    world.props.pop();
    group.position.copy(player.group.position);
    group.position.y = 0.35;
    const velocity = input.lastMove.clone().multiplyScalar(15);
    velocity.y = 5;
    world.projectiles.push({ type: "cone", group, velocity, life: 1.35, damage: state.upgrades.conePouch ? 48 : 42 });
    setStatus("Cone", state.coneAmmo + " left");
  }

  function hitActor(actor, damage, knockback, spec = meleeDefs.plunger) {
    actor.health -= damage;
    const away = actor.group.position.clone().sub(player.group.position).setY(0).normalize();
    actor.velocity.add(away.multiplyScalar(knockback));
    if (spec.stun) actor.stunTime = Math.max(actor.stunTime || 0, spec.stun);
    if (spec.confuse) {
      actor.confuseTime = Math.max(actor.confuseTime || 0, spec.confuse);
      actor.confuseSpin = rand(-1, 1);
      if (actor.kind === "cop") {
        state.arrest = clamp(state.arrest - 5, 0, 100);
        state.heat = clamp(state.heat - 2, 0, 100);
      }
    }
    addFloater(spec.floater || "BONK", actor.group.position, spec.confuse ? palette.cash : palette.curb);
    if (actor.health <= 0) {
      defeatActor(actor);
    }
  }

  function defeatActor(actor) {
    if (actor.kind === "zombie") {
      progressFavor("hazeDefense", 1, getCurrentDistrict());
      const bossKill = Boolean(actor.boss);
      const variantBonus = actor.variant === "spitter" ? 2 : actor.variant === "runner" ? 1 : 0;
      const cashReward = bossKill ? 14 : 2 + variantBonus;
      const scoreReward = bossKill ? 900 : 120 + variantBonus * 45;
      state.waveKills += bossKill ? 4 : 1;
      state.cash += cashReward;
      state.score += scoreReward;
      actor.dead = true;
      addFloater(bossKill ? "BRUTE DOWN +$14" : "+" + money(cashReward), actor.group.position, palette.cash);
      world.root.remove(actor.group);
      const index = world.zombies.indexOf(actor);
      if (index >= 0) world.zombies.splice(index, 1);
      if (bossKill) {
        pushLog("Haze Brute", "The brute folded after one too many ridiculous bonks.");
        setStatus("Boss Down", "+$14");
      } else if (actor.variant === "runner" || actor.variant === "spitter") {
        setStatus(actor.label + " Down", "+" + money(cashReward));
      }
      updateUpgradeButtons();
      updateHud();
      if (state.waveKills >= getWaveTarget()) completeNight("Morning broke through. You cleared the Haze wave.");
    } else if (actor.kind === "cop") {
      state.heat = clamp(state.heat + 12, 0, 100);
      state.arrest = clamp(state.arrest + 8, 0, 100);
    }
  }

  function pulsePlayer(amount) {
    if (state.reducedMotion) return;
    player.group.scale.set(1.05 * amount, 0.88, 1.05 * amount);
  }

  function startChase() {
    if (state.chaseActive) return;
    state.chaseActive = true;
    state.chaseCooldown = 0;
    state.chaseEscalation = 1;
    setCopActive(world.cops[0], true);
    pushLog("Heat", "A cop noticed the sidewalk spectacle. Time to move.");
    setStatus("Chase", "Lose the cop");
  }

  function stopChase() {
    state.chaseActive = false;
    state.backupCalled = false;
    state.chaseEscalation = 0;
    state.arrest = clamp(state.arrest - 12, 0, 100);
    state.heat = clamp(state.heat - 20, 0, 100);
    setCopActive(world.cops[0], false, new THREE.Vector3(31, 0, -3));
    setCopActive(world.cops[1], false, new THREE.Vector3(-31, 0, -4));
    pushLog("Chase", "The cop lost interest in the paperwork.");
    setStatus("Clear", "Heat cooling");
    progressGig("chaseLost", 1);
    progressFavor("openAssist", 1, getCurrentDistrict());
  }

  function setCopActive(cop, active, resetPosition) {
    if (!cop) return;
    cop.active = active;
    cop.health = 999;
    cop.stunTime = 0;
    cop.confuseTime = 0;
    cop.confuseSpin = 1;
    cop.velocity.set(0, 0, 0);
    if (resetPosition) cop.group.position.copy(resetPosition);
    cop.previous.copy(cop.group.position);
    updateCopSiren(cop, 0);
  }

  function updateCopSiren(cop, time) {
    if (!cop.sirenRed || !cop.sirenBlue) return;
    const blink = cop.active && Math.sin(time * 12) > 0;
    cop.sirenRed.intensity = cop.active && blink ? 2.3 : 0;
    cop.sirenBlue.intensity = cop.active && !blink ? 2.3 : 0;
    cop.redBeacon.visible = cop.active;
    cop.blueBeacon.visible = cop.active;
  }

  function startNight() {
    state.phase = "night";
    state.time = 0;
    state.heat = clamp(state.heat - 24, 0, 100);
    state.hype = clamp(state.hype - 18, 0, 100);
    state.energy = clamp(state.energy + 30 + (hasCampUpgrade("tarpRoof") ? 6 : 0), 0, 100);
    state.waveKills = 0;
    state.waveSpawned = 0;
    state.waveSpawnTimer = 0.1;
    state.nightBossSpawned = false;
    state.chaseActive = false;
    state.chaseEscalation = 0;
    state.backupCalled = false;
    state.arrest = 0;
    setCopActive(world.cops[0], false, new THREE.Vector3(31, 0, -3));
    setCopActive(world.cops[1], false, new THREE.Vector3(-31, 0, -4));
    pushLog("Night Haze", "Cycle " + getCycleLabel() + " went green. Clear " + getWaveTarget() + " Haze threats.");
    setStatus("Night " + getCycleLabel(), "Survive the Haze");
    updateDayNightVisuals();
    if (shouldSpawnBossNight()) {
      spawnHazeBrute();
    }
  }

  function completeNight(reason) {
    if (state.gameOver || state.phase !== "night") return;
    if (state.cycle >= RUN_CYCLES) {
      endRun(true, reason || "Three mornings survived. The block made it weird and you made it through.");
      return;
    }
    startNextDay(reason || "Dawn cracked through the Haze.");
  }

  function startNextDay(reason) {
    const finishedCycle = state.cycle;
    const clearedKills = state.waveKills;
    clearExpiredDawnPerk(finishedCycle);
    state.cycle += 1;
    state.phase = "day";
    state.time = 0;
    state.waveKills = 0;
    state.waveSpawned = 0;
    state.waveSpawnTimer = 0;
    state.nightBossSpawned = false;
    state.chaseActive = false;
    state.chaseEscalation = 0;
    state.backupCalled = false;
    state.arrest = 0;
    state.directorTimer = DEBUG_TIMERS ? 1.2 : 4.2;
    state.directorIncident = "openBlock";
    state.directorIncidentTimer = 0;
    state.heat = clamp(state.heat - 28, 0, 100);
    state.hype = clamp(state.hype * 0.62 + 8, 0, 100);
    state.energy = clamp(state.energy + 45 + (hasCampUpgrade("tarpRoof") ? 8 : 0), 0, 100);
    state.health = clamp(state.health + 24 + (hasCampUpgrade("tarpRoof") ? 8 : 0), 0, state.maxHealth);
    state.coneAmmo = clamp(state.coneAmmo + 2, 0, state.maxCones);
    state.peelAmmo = clamp(state.peelAmmo + 1 + (hasCampUpgrade("peelBucket") ? 1 : 0), 0, state.maxPeels);
    state.score += 450 + finishedCycle * 160 + clearedKills * 70;

    clearActors(world.zombies);
    world.projectiles.forEach((item) => world.root.remove(item.group));
    world.projectiles.length = 0;
    setCopActive(world.cops[0], false, new THREE.Vector3(31, 0, -3));
    setCopActive(world.cops[1], false, new THREE.Vector3(-31, 0, -4));
    spawnPedestrians();
    resetInteractables();
    prepareRouteJob();
    resetTraps();
    resetPhysicsProps();
    updateDayNightVisuals();
    updateDistrict(true);
    updateDirectorPanel();
    selectDistrictFavor(getCurrentDistrict(), false);
    pushLog("Dawn", reason + " Cycle " + state.cycle + " starts with tougher nights ahead.");
    setStatus("Dawn", "Cycle " + getCycleLabel() + " begins");
    updateUpgradeButtons();
    updateHud();
    showDawnChoices(reason, finishedCycle, clearedKills);
  }

  function endRun(won, reason) {
    if (state.gameOver) return;
    state.running = false;
    state.gameOver = true;
    state.score = Math.round(state.score + state.cash * 10 + state.health * 4 + state.energy * 2);
    const high = api.recordScore(GAME_ID, state.score);
    state.high = api.getHighScore(GAME_ID);
    showOverlay(
      won ? "MORNING SURVIVED" : "RUN ENDED",
      reason,
      "Run it back",
      "end"
    );
    el.overlayScore.innerHTML = `<strong>Score:</strong> ${state.score} ${high ? "<br><strong>New high score</strong>" : ""}`;
    updateUpgradeButtons();
    updateHud();
  }

  function update(dt) {
    if (!state.running || state.paused || state.gameOver) return;

    state.time += dt;
    state.actionCooldown = Math.max(0, state.actionCooldown - dt);
    state.attackCooldown = Math.max(0, state.attackCooldown - dt);
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.stuntCooldown = Math.max(0, state.stuntCooldown - dt);
    state.trapCooldown = Math.max(0, state.trapCooldown - dt);
    state.gooSlowTime = Math.max(0, state.gooSlowTime - dt);
    state.interactionCooldown = Math.max(0, state.interactionCooldown - dt);
    state.messageTimer = Math.max(0, state.messageTimer - dt);

    updatePlayer(dt);
    updateTumbleState(dt);
    updateTraps(dt);
    updateDistrict();
    updateChaosDirector(dt);
    updateInteractables(dt);
    updatePedestrians(dt);
    updateChase(dt);
    updateNight(dt);
    updateProjectiles(dt);
    updatePhysics(dt);
    updateFloaters(dt);
    updateAmbientVisuals(dt);
    updateObjectiveGuide(dt);
    updateCamera(dt);
    updateDayNightVisuals();

    if (state.phase === "day") {
      state.energy = clamp(state.energy + dt * 3.6 * getEnergyRegenMultiplier(), 0, 100);
      state.heat = clamp(state.heat - dt * (state.chaseActive ? 0.8 : 1.8) * getHeatDecayMultiplier(), 0, 100);
      state.hype = clamp(state.hype - dt * (state.chaseActive ? 1.1 : 0.35), 0, 100);
      if (state.time >= DAY_SECONDS) startNight();
    } else if (state.time >= NIGHT_SECONDS) {
      completeNight("Dawn arrived before the Haze could take the block.");
    }

    if (state.health <= 0) endRun(false, "The night got too weird. The plunger was brave.");
    if (state.arrest >= 100) endRun(false, "Arrest meter filled. The paperwork won.");

    updateHud();
  }

  function updatePlayer(dt) {
    const move = getMoveVector();
    const tumbling = state.tumbleTime > 0;
    const sprinting = !tumbling && isDown("shift") && state.energy > 2 && move.lengthSq() > 0;
    const baseSpeed = state.phase === "night" ? 7.2 : 6.4;
    const carryMult = state.carriedRoute && state.carriedRoute.heavy ? 0.72 : 1;
    const gooMult = state.gooSlowTime > 0 ? 0.72 : 1;
    const speed = (sprinting ? baseSpeed * 1.55 : baseSpeed) * carryMult * gooMult;

    if (sprinting) state.energy = clamp(state.energy - dt * 12, 0, 100);

    if (tumbling) {
      if (move.lengthSq() > 0) {
        input.lastMove.copy(move).normalize();
        player.velocity.x = lerp(player.velocity.x, move.x * speed * 1.2, 0.08);
        player.velocity.z = lerp(player.velocity.z, move.z * speed * 1.2, 0.08);
      } else {
        player.velocity.x = lerp(player.velocity.x, input.lastMove.x * speed * 0.85, 0.035);
        player.velocity.z = lerp(player.velocity.z, input.lastMove.z * speed * 0.85, 0.035);
      }
      player.group.rotation.y += state.tumbleSpin * dt * 8.6;
    } else if (move.lengthSq() > 0) {
      input.lastMove.copy(move).normalize();
      player.velocity.x = lerp(player.velocity.x, move.x * speed, 0.22);
      player.velocity.z = lerp(player.velocity.z, move.z * speed, 0.22);
      player.group.rotation.y = Math.atan2(input.lastMove.x, input.lastMove.z);
    } else {
      player.velocity.x = lerp(player.velocity.x, 0, 0.16);
      player.velocity.z = lerp(player.velocity.z, 0, 0.16);
    }

    player.previous.copy(player.group.position);
    const next = player.group.position.clone().addScaledVector(player.velocity, dt);
    next.x = clamp(next.x, -WORLD_LIMIT_X, WORLD_LIMIT_X);
    next.z = clamp(next.z, -WORLD_LIMIT_Z, WORLD_LIMIT_Z);
    if (!hitsBlocker(next, PLAYER_RADIUS)) {
      player.group.position.copy(next);
      player.lastSafe.copy(next);
    } else {
      player.group.position.copy(player.lastSafe);
      player.velocity.multiplyScalar(-0.12);
    }

    const bob = Math.sin(performance.now() * 0.011) * (move.lengthSq() > 0 ? 0.07 : 0.025);
    player.group.position.y = Math.max(0, bob);
    if (!tumbling) {
      player.group.rotation.x = lerp(player.group.rotation.x, 0, 0.18);
      player.group.rotation.z = lerp(player.group.rotation.z, 0, 0.18);
      settlePlayerParts(0.16);
    }
    player.group.scale.x = lerp(player.group.scale.x, 1, 0.12);
    player.group.scale.y = lerp(player.group.scale.y, 1, 0.12);
    player.group.scale.z = lerp(player.group.scale.z, 1, 0.12);

    collectNearbyCone();
  }

  function updateTumbleState(dt) {
    if (state.tumbleTime <= 0) return;
    state.tumbleDistance += Math.max(0, player.velocity.length()) * dt;
    state.tumbleTime = Math.max(0, state.tumbleTime - dt);
    animateTumblePose(dt);
    if (state.tumbleTime <= 0) finishTumbleChain();
  }

  function animateTumblePose(dt) {
    if (!player.group || !player.group.userData.parts) return;
    const phase = state.tumbleDuration > 0 ? 1 - state.tumbleTime / state.tumbleDuration : 1;
    const wobble = performance.now() * 0.017;
    player.group.rotation.x = Math.sin(wobble * 0.7) * 0.28 + 0.18;
    player.group.rotation.z = state.tumbleSpin * (0.48 + Math.sin(wobble) * 0.2);

    const parts = player.group.userData.parts;
    parts.head.rotation.x = Math.sin(wobble * 1.4) * 0.25;
    parts.head.rotation.z = state.tumbleSpin * (0.16 + Math.sin(wobble * 1.2) * 0.12);
    parts.shoulders.rotation.z = state.tumbleSpin * (0.25 + phase * 0.22);
    parts.armL.rotation.x = Math.sin(wobble * 1.8) * 1.1;
    parts.armR.rotation.x = Math.cos(wobble * 1.7) * 1.1;
    parts.armL.rotation.z = 0.95 + Math.sin(wobble) * 0.34;
    parts.armR.rotation.z = -0.95 + Math.cos(wobble) * 0.34;
    parts.legL.rotation.x = Math.cos(wobble * 1.5) * 0.85;
    parts.legR.rotation.x = Math.sin(wobble * 1.6) * 0.85;

    if (state.reducedMotion) {
      player.group.rotation.x = lerp(player.group.rotation.x, 0.12, 0.3);
      player.group.rotation.z = lerp(player.group.rotation.z, state.tumbleSpin * 0.22, 0.3);
      settlePlayerParts(0.3);
    }
  }

  function settlePlayerParts(t) {
    if (!player.group || !player.group.userData.parts) return;
    const parts = player.group.userData.parts;
    parts.body.rotation.x = lerp(parts.body.rotation.x, 0, t);
    parts.body.rotation.y = lerp(parts.body.rotation.y, 0, t);
    parts.body.rotation.z = lerp(parts.body.rotation.z, 0, t);
    parts.shoulders.rotation.x = lerp(parts.shoulders.rotation.x, 0, t);
    parts.shoulders.rotation.y = lerp(parts.shoulders.rotation.y, 0, t);
    parts.shoulders.rotation.z = lerp(parts.shoulders.rotation.z, 0, t);
    parts.head.rotation.x = lerp(parts.head.rotation.x, 0, t);
    parts.head.rotation.y = lerp(parts.head.rotation.y, 0, t);
    parts.head.rotation.z = lerp(parts.head.rotation.z, 0, t);
    parts.legL.rotation.x = lerp(parts.legL.rotation.x, 0, t);
    parts.legL.rotation.z = lerp(parts.legL.rotation.z, 0, t);
    parts.legR.rotation.x = lerp(parts.legR.rotation.x, 0, t);
    parts.legR.rotation.z = lerp(parts.legR.rotation.z, 0, t);
    parts.armL.rotation.x = lerp(parts.armL.rotation.x, 0, t);
    parts.armL.rotation.y = lerp(parts.armL.rotation.y, 0, t);
    parts.armL.rotation.z = lerp(parts.armL.rotation.z, 0.18, t);
    parts.armR.rotation.x = lerp(parts.armR.rotation.x, 0, t);
    parts.armR.rotation.y = lerp(parts.armR.rotation.y, 0, t);
    parts.armR.rotation.z = lerp(parts.armR.rotation.z, -0.18, t);
  }

  function getMoveVector() {
    const x = (isDown("d") || isDown("arrowright") ? 1 : 0) - (isDown("a") || isDown("arrowleft") ? 1 : 0);
    const z = (isDown("s") || isDown("arrowdown") ? 1 : 0) - (isDown("w") || isDown("arrowup") ? 1 : 0);
    tmpVec.set(x, 0, z);
    if (tmpVec.lengthSq() > 0) {
      tmpVec.normalize();
      const cos = Math.cos(cameraLook.yaw);
      const sin = Math.sin(cameraLook.yaw);
      const worldX = tmpVec.x * cos + tmpVec.z * sin;
      const worldZ = tmpVec.z * cos - tmpVec.x * sin;
      tmpVec.set(worldX, 0, worldZ).normalize();
    }
    return tmpVec;
  }

  function isDown(key) {
    return input.keys.has(key) || input.virtual.has(key);
  }

  function hitsBlocker(position, radius) {
    return world.blockers.some((blocker) => {
      const halfW = blocker.w / 2 + radius;
      const halfD = blocker.d / 2 + radius;
      return Math.abs(position.x - blocker.x) < halfW && Math.abs(position.z - blocker.z) < halfD;
    });
  }

  function collectNearbyCone() {
    for (const prop of world.props) {
      if (!prop.available || prop.type !== "cone") continue;
      if (dist2(prop.group.position, player.group.position) > 2.6) continue;
      prop.available = false;
      prop.group.visible = false;
      state.coneAmmo = clamp(state.coneAmmo + 1, 0, state.maxCones);
      setStatus("Cone", state.coneAmmo + " carried");
      break;
    }
  }

  function dropBananaPeel() {
    if (!state.running || state.paused || state.gameOver || state.trapCooldown > 0) return;
    if (state.peelAmmo <= 0) {
      setStatus("Peels", "Scavenge for more");
      return;
    }

    state.peelAmmo -= 1;
    state.trapCooldown = 0.55;
    const offset = input.lastMove.clone();
    if (offset.lengthSq() <= 0.01) offset.set(0, 0, -1);
    offset.normalize().multiplyScalar(-0.45);
    const x = clamp(player.group.position.x + offset.x, -WORLD_LIMIT_X, WORLD_LIMIT_X);
    const z = clamp(player.group.position.z + offset.z, -WORLD_LIMIT_Z, WORLD_LIMIT_Z);
    const trap = addBananaPeel(x, z, true, 1.15);
    trap.group.scale.set(0.35, 0.35, 0.35);
    addFloater("PEEL DROP", trap.position, palette.curb);
    setStatus("Banana Peel", state.peelAmmo + " left");
    updateHud();
  }

  function resetTraps() {
    world.traps.slice().forEach((trap) => {
      if (trap.dynamic) {
        if (trap.group && trap.group.parent) trap.group.parent.remove(trap.group);
        const index = world.traps.indexOf(trap);
        if (index >= 0) world.traps.splice(index, 1);
        return;
      }
      trap.active = true;
      trap.cooldown = 0;
      trap.ownerSafeTime = 0;
      trap.position.copy(trap.home);
      trap.group.position.set(trap.home.x, 0.08, trap.home.z);
      trap.group.visible = true;
      trap.group.scale.set(1, 1, 1);
    });
  }

  function updateTraps(dt) {
    world.traps.forEach((trap) => {
      trap.cooldown = Math.max(0, trap.cooldown - dt);
      trap.ownerSafeTime = Math.max(0, (trap.ownerSafeTime || 0) - dt);
      if (!trap.active && !trap.dynamic && trap.cooldown <= 0) {
        trap.active = true;
        trap.group.visible = true;
        trap.group.scale.set(0.4, 0.4, 0.4);
      }
      if (!trap.active) return;
      const targetScale = trap.ownerSafeTime > 0 ? 0.78 : 1;
      trap.group.scale.lerp(tmpVec2.set(targetScale, targetScale, targetScale), 0.12);
      trap.group.rotation.y += dt * 0.8;
      trap.group.position.y = 0.08 + Math.sin(performance.now() * 0.004 + trap.pulse) * 0.025;
    });

    if (player.velocity.lengthSq() < 0.75) return;
    for (const trap of world.traps) {
      if (!trap.active || trap.ownerSafeTime > 0) continue;
      if (distToSegment2(trap.position, player.previous, player.group.position) > trap.radius * trap.radius) continue;
      triggerBananaTrap(trap, player, "player");
      break;
    }
  }

  function maybeTriggerBananaTrapForActor(actor, label) {
    for (const trap of world.traps) {
      if (!trap.active) continue;
      const previous = actor.previous || actor.group.position;
      if (distToSegment2(trap.position, previous, actor.group.position) > trap.radius * trap.radius) continue;
      return triggerBananaTrap(trap, actor, label);
    }
    return false;
  }

  function triggerBananaTrap(trap, target, label) {
    if (!trap || !trap.active) return false;
    trap.active = false;
    trap.group.visible = false;
    trap.cooldown = trap.dynamic ? 0 : DEBUG_TIMERS ? 5.5 : 18;
    state.score += label === "player" ? 35 : 90;

    if (label === "player") {
      const slip = player.velocity.clone().setY(0);
      if (slip.lengthSq() <= 0.01) slip.copy(input.lastMove);
      slip.normalize();
      player.velocity.add(slip.multiplyScalar(7.2));
      state.energy = clamp(state.energy - 5, 0, 100);
      state.tumbleDuration = Math.max(state.tumbleDuration, 0.85);
      state.tumbleTime = Math.max(state.tumbleTime, 0.85);
      state.tumbleCombo = Math.max(1, state.tumbleCombo);
      state.tumbleSpin = rand(0, 1) > 0.5 ? 1 : -1;
      progressFavor("crosswalkStunt", 1, getCurrentDistrict());
      addFloater("SLIP!", player.group.position, palette.curb);
      setStatus("Banana Peel", "Comedy tax");
      return true;
    }

    const away = target.group.position.clone().sub(trap.position).setY(0);
    if (away.lengthSq() <= 0.01) away.set(rand(-1, 1), 0, rand(-1, 1));
    away.normalize();
    target.velocity.add(away.multiplyScalar(label === "cop" ? 9.5 : 7.6));
    target.stunTime = Math.max(target.stunTime || 0, label === "cop" ? 1.2 : 0.9);
    target.confuseTime = Math.max(target.confuseTime || 0, label === "cop" ? 1.2 : 0.55);
    target.confuseSpin = rand(-1, 1) || 1;
    if (label === "cop") {
      state.arrest = clamp(state.arrest - 12, 0, 100);
      state.heat = clamp(state.heat - 5, 0, 100);
      addHype(4);
      progressGig("propLaunch", 1);
      progressFavor("openAssist", 1, getCurrentDistrict());
      pushLog("Trap", "A peel turned the chase into paperwork with skids.");
    } else if (label === "zombie") {
      target.health -= target.boss ? 28 : 14;
      if (target.boss) target.stunTime = Math.max(target.stunTime || 0, 1.1);
      progressGig("propLaunch", 1);
      if (target.health <= 0) defeatActor(target);
    }
    addFloater("WIPEOUT", target.group.position, palette.curb);
    setStatus("Banana Peel", label === "cop" ? "Chase slipped" : "Haze slipped");
    updateHud();
    return true;
  }

  function resetInteractables() {
    world.interactables.forEach((item) => {
      item.available = true;
      item.cooldown = 0;
      item.group.scale.set(1, 1, 1);
      item.group.visible = !["routePickup", "routeDropoff"].includes(item.type);
      item.group.traverse((child) => {
        if (child.isMesh) child.visible = true;
      });
    });
  }

  function updateInteractables(dt) {
    world.interactables.forEach((item) => {
      const enabled = isInteractableEnabled(item);
      if (item.type === "routePickup" || item.type === "routeDropoff") {
        item.group.visible = Boolean(enabled);
      }
      if (item.type === "scavenge" && item.cooldown > 0) {
        item.cooldown = Math.max(0, item.cooldown - dt);
        if (item.cooldown <= 0) {
          item.available = true;
          item.group.traverse((child) => {
            if (child.isMesh) child.visible = true;
          });
        }
      }
      item.marker.rotation.y += dt * 2.4;
      item.marker.position.y = 1.15 + Math.sin(performance.now() * 0.004 + item.position.x) * 0.1;
    });

    const nearby = getNearbyInteractable();
    world.interactables.forEach((item) => {
      const visibleAndEnabled = item.group.visible && isInteractableEnabled(item);
      const targetScale = item === nearby ? 1.15 : visibleAndEnabled ? 1 : 0.72;
      item.group.scale.lerp(tmpVec2.set(targetScale, targetScale, targetScale), 0.14);
    });

    if (nearby) {
      setPassiveStatus("E " + interactionVerb(nearby), nearby.label);
    } else if (state.phase === "day") {
      setPassiveStatus("Goal", "Earn cash, scrap, and hype");
    }
  }

  function interactionVerb(item) {
    if (item.type === "scavenge") return "Scavenge";
    if (item.type === "routePickup") return "Pick Up";
    if (item.type === "routeDropoff") return "Drop Off";
    if (item.type === "kiosk") return state.activeJob && state.activeJob.event === "kioskTurnIn" ? "Turn In" : "Pawn";
    if (item.type === "camp") return state.activeJob && state.activeJob.event === "campDeposit" ? "Deposit" : "Patch";
    return "Interact";
  }

  function getDistrictAtPosition(position) {
    return districtDefs.find((district) =>
      district.id !== "street" &&
      position.x >= district.xMin &&
      position.x <= district.xMax &&
      position.z >= district.zMin &&
      position.z <= district.zMax
    ) || districtDefs.find((district) => district.id === "street");
  }

  function getCurrentDistrict() {
    if (!player.group) return districtDefs.find((district) => district.id === "street");
    return getDistrictAtPosition(player.group.position);
  }

  function updateDistrict(force = false) {
    const district = getCurrentDistrict();
    if (!district) return;
    if (force || state.currentDistrictId !== district.id) {
      state.currentDistrictId = district.id;
      selectDistrictFavor(district, state.running);
      if (state.running) {
        pushLog("District", district.title + ": " + district.short + ".");
        setStatus("District", district.title);
      }
    }
    updateDistrictPanel(district);
  }

  function updateDistrictPanel(district = getCurrentDistrict()) {
    if (!district) return;
    if (el.districtName) el.districtName.textContent = district.title;
    if (el.districtTrait) el.districtTrait.textContent = district.short;
  }

  function selectDistrictFavor(district = getCurrentDistrict(), announce = true) {
    if (!district) return;
    const local = favorDefs.find((favor) =>
      favor.districtId === district.id && !state.completedFavors.has(favor.id)
    );
    const fallback = favorDefs.find((favor) =>
      favor.districtId === "street" && !state.completedFavors.has(favor.id)
    );
    const def = local || fallback || null;
    if (!def) {
      state.activeFavor = null;
      updateFavorPanel();
      return;
    }

    if (state.activeFavor && state.activeFavor.id === def.id) {
      updateFavorPanel();
      return;
    }

    state.activeFavor = {
      ...def,
      progress: state.favorProgress[def.id] || 0,
    };
    if (announce && state.running) {
      pushLog("Block Favor", def.title + ": " + def.desc);
    }
    updateFavorPanel();
  }

  function updateFavorPanel() {
    const favor = state.activeFavor;
    if (!el.favorTitle) return;
    if (!favor) {
      el.favorTitle.textContent = "All Clear";
      el.favorDesc.textContent = "Every district favor is handled for this run.";
      if (el.favorProgress) el.favorProgress.style.width = "100%";
      if (el.favorProgressText) el.favorProgressText.textContent = "Done";
      if (el.favorReward) el.favorReward.textContent = "Route complete";
      return;
    }

    favor.progress = state.favorProgress[favor.id] || favor.progress || 0;
    const progress = clamp((favor.progress / favor.target) * 100, 0, 100);
    el.favorTitle.textContent = favor.title;
    el.favorDesc.textContent = favor.desc;
    if (el.favorProgress) {
      el.favorProgress.style.width = percent(progress);
      el.favorProgress.style.backgroundColor = progress >= 100 ? "#75ff92" : "var(--accent-2)";
    }
    if (el.favorProgressText) el.favorProgressText.textContent = `${Math.round(favor.progress)}/${favor.target}`;
    if (el.favorReward) {
      const scrapText = favor.rewardScrap ? " + " + favor.rewardScrap + " scrap" : "";
      const heatText = favor.heatDelta < 0 ? " · heat down" : favor.heatDelta > 0 ? " · heat +" + favor.heatDelta : "";
      el.favorReward.textContent = "Reward: " + money(favor.rewardCash) + scrapText + " + " + favor.rewardHype + " hype" + heatText;
    }
  }

  function progressFavor(event, amount = 1, district = getCurrentDistrict()) {
    const favor = state.activeFavor;
    if (!state.running || !favor || state.completedFavors.has(favor.id)) return;
    if (!doesFavorAcceptEvent(favor, event, district)) return;

    const next = clamp((state.favorProgress[favor.id] || favor.progress || 0) + amount, 0, favor.target);
    state.favorProgress[favor.id] = next;
    favor.progress = next;
    if (next >= favor.target) {
      completeFavor(favor);
    } else {
      updateFavorPanel();
    }
  }

  function doesFavorAcceptEvent(favor, event, district) {
    if (favor.event !== event) return false;
    if (favor.districtId === "street") return true;
    return district && district.id === favor.districtId;
  }

  function completeFavor(favor) {
    if (!favor || state.completedFavors.has(favor.id)) return;
    state.completedFavors.add(favor.id);
    state.favorProgress[favor.id] = favor.target;
    state.cash += favor.rewardCash;
    state.scrap += favor.rewardScrap;
    state.heat = clamp(state.heat + favor.heatDelta, 0, 100);
    addHype(favor.rewardHype);
    state.score += favor.rewardCash * 9 + favor.rewardScrap * 40 + favor.rewardHype * 22;
    addFloater("FAVOR +" + money(favor.rewardCash), player.group.position, palette.cash);
    pushLog("Block Favor", favor.title + " complete. The block owes you one.");
    setStatus("Favor Done", "+" + money(favor.rewardCash) + " hype +" + favor.rewardHype);
    updateUpgradeButtons();
    selectDistrictFavor(getCurrentDistrict(), false);
    updateHud();
  }

  function getDirectorBeat() {
    return directorBeats[state.directorIncident] || null;
  }

  function getDirectorMultipliers() {
    const beat = getDirectorBeat();
    const active = beat && state.directorIncidentTimer > 0;
    return {
      cash: active ? beat.cashMult : 1,
      hype: active ? beat.hypeMult : 1,
      heat: active ? beat.heatMult : 1,
    };
  }

  function updateDirectorPanel() {
    if (!el.directorReadout) return;
    const beat = getDirectorBeat();
    const pressure = Math.round(state.directorPressure);
    const label = beat && state.directorIncidentTimer > 0 ? beat.title : "Block Mood";
    el.directorReadout.textContent = label + " · pressure " + pressure + "%";
  }

  function updateChaosDirector(dt) {
    const district = getCurrentDistrict();
    const heatWeight = state.heat * 0.44;
    const hypeWeight = state.hype * 0.24;
    const chaseWeight = state.chaseActive ? 24 : 0;
    const nightWeight = state.phase === "night" ? 26 : 0;
    const targetPressure = clamp((10 + heatWeight + hypeWeight + chaseWeight + nightWeight + district.pressure) * getDirectorPressureMultiplier(), 0, 100);
    state.directorPressure = lerp(state.directorPressure, targetPressure, 1 - Math.pow(0.08, dt));
    state.directorTimer -= dt;
    state.directorIncidentTimer = Math.max(0, state.directorIncidentTimer - dt);

    if (state.directorTimer <= 0) {
      triggerDirectorBeat(district);
      const pace = state.phase === "night"
        ? rand(4.6, 7.2)
        : rand(7.5, 12.5);
      state.directorTimer = Math.max(DEBUG_TIMERS ? 1.8 : 4.5, pace - state.directorPressure * 0.045);
    }
    updateDirectorPanel(district);
  }

  function triggerDirectorBeat(district) {
    if (state.phase === "night") {
      state.directorIncident = "hazeSurge";
      state.directorIncidentTimer = 5.5;
      state.waveSpawnTimer = Math.min(state.waveSpawnTimer, 0.3);
      if (state.waveSpawned < getWaveTarget()) {
        spawnZombie();
        state.waveSpawned += 1;
      }
      pushLog("Director", directorBeats.hazeSurge.text);
      setStatus("Haze Surge", "Watch the alleys");
      return;
    }

    if (state.directorPressure > 72 || district.id === "pawn") {
      state.directorIncident = "securitySweep";
      state.directorIncidentTimer = 6.5;
      state.heat = clamp(state.heat + rand(3, 7), 0, 100);
      pushLog("Director", directorBeats.securitySweep.text);
      setStatus("Security", "Sweep incoming");
      if (state.heat >= HEAT_CHASE_AT) startChase();
      return;
    }

    if (state.hype > 28 || district.id === "busking" || district.id === "crosswalk") {
      state.directorIncident = "crowdSwell";
      state.directorIncidentTimer = 6.5;
      spawnCrowdSwell();
      pushLog("Director", directorBeats.crowdSwell.text);
      setStatus("Crowd", "Tips boosted");
      return;
    }

    if (state.scrap < 4 || (state.activeJob && state.activeJob.event === "scavenge")) {
      state.directorIncident = "scrapGlint";
      state.directorIncidentTimer = 6.5;
      refreshOneCache();
      pushLog("Director", directorBeats.scrapGlint.text);
      setStatus("Scrap Glint", "Caches refreshed");
      return;
    }

    state.directorIncident = "quietWindow";
    state.directorIncidentTimer = 5.5;
    state.energy = clamp(state.energy + 8, 0, 100);
    state.heat = clamp(state.heat - 5, 0, 100);
    pushLog("Director", directorBeats.quietWindow.text);
    setStatus("Quiet", "+energy heat down");
  }

  function spawnCrowdSwell() {
    const base = player.group.position;
    const count = world.pedestrians.length > 26 ? 2 : 4;
    for (let i = 0; i < count; i += 1) {
      const actor = spawnPedestrian(base.x + rand(-5.5, 5.5), base.z + rand(-5.5, 5.5), pick(["tip", "film"]));
      actor.wait = rand(0.25, 1);
      actor.target.copy(base).add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
    }
  }

  function refreshOneCache() {
    const cache = getNearestInteractableTarget((item) => item.type === "scavenge" && !item.available);
    if (!cache) return;
    cache.available = true;
    cache.cooldown = 0;
    cache.group.scale.set(1, 1, 1);
    cache.group.traverse((child) => {
      if (child.isMesh) child.visible = true;
    });
  }

  function getInteractableById(id) {
    return world.interactables.find((item) => item.id === id) || null;
  }

  function getNearestInteractableTarget(predicate) {
    let nearest = null;
    let nearestDistance = Infinity;
    world.interactables.forEach((item) => {
      if (!predicate(item)) return;
      const distance = dist2(item.position, player.group.position);
      if (distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function getObjectiveTarget() {
    if (!state.running || state.gameOver || !player.group) return null;

    if (state.phase === "night") {
      const boss = getHazeBoss();
      if (boss) {
        return { label: "Haze Brute", position: boss.group.position, danger: true };
      }
      const nearestZombie = getNearestActor(world.zombies);
      if (nearestZombie) {
        return { label: "Haze threat", position: nearestZombie.group.position, danger: true };
      }
      return null;
    }

    if (state.activeJob) {
      if (isRouteJob(state.activeJob)) {
        if (state.activeJob.awaitingPerformance) {
          const final = getInteractableById(state.activeJob.routeDropoffId);
          if (final) return { label: "Perform " + (state.activeJob.routeFinalLabel || "finale"), position: final.position };
        }
        if (state.carriedRoute) {
          const dropoff = getInteractableById(state.carriedRoute.dropoffId);
          if (dropoff) return { label: "Drop off " + state.carriedRoute.label, position: dropoff.position };
        }
        const pickup = getInteractableById(state.activeJob.routePickupId);
        if (pickup && isInteractableEnabled(pickup)) return { label: "Pick up " + pickup.label, position: pickup.position };
      }
      if (state.activeJob.event === "scavenge") {
        const cache = getNearestInteractableTarget((item) => item.type === "scavenge" && isInteractableEnabled(item));
        if (cache) return { label: "Scavenge " + cache.label, position: cache.position };
      }
      if (state.activeJob.event === "kioskTurnIn") {
        const kiosk = getInteractableById("kiosk-service");
        if (kiosk) return { label: "Pawn kiosk", position: kiosk.position };
      }
      if (state.activeJob.event === "campDeposit") {
        const camp = getInteractableById("camp-service");
        if (camp) return { label: "Camp stash", position: camp.position };
      }
    }

    const nearby = getNearbyInteractable();
    if (nearby) return { label: interactionVerb(nearby) + " " + nearby.label, position: nearby.position };
    return null;
  }

  function getNearestActor(list) {
    let nearest = null;
    let nearestDistance = Infinity;
    list.forEach((actor) => {
      if (!actor.group || actor.dead) return;
      const distance = dist2(actor.group.position, player.group.position);
      if (distance < nearestDistance) {
        nearest = actor;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function updateObjectiveGuide(dt) {
    const target = getObjectiveTarget();
    if (!target) {
      if (el.objectiveChip) el.objectiveChip.style.display = state.running ? "none" : "";
      if (world.objectiveBeacon) world.objectiveBeacon.visible = false;
      return;
    }

    const toTarget = tmpVec.copy(target.position).sub(player.group.position).setY(0);
    const distance = Math.max(0, toTarget.length());
    const angle = Math.atan2(toTarget.x, toTarget.z) - player.group.rotation.y;
    if (el.objectiveChip) el.objectiveChip.style.display = "";
    if (el.objectiveArrow) el.objectiveArrow.style.transform = "rotate(" + angle + "rad)";
    if (el.objectiveText) {
      el.objectiveText.textContent = target.label + " · " + Math.round(distance) + "m";
    }

    if (world.objectiveBeacon) {
      world.objectiveBeacon.visible = true;
      world.objectiveBeacon.position.set(target.position.x, 0, target.position.z);
      world.objectiveBeacon.rotation.y += dt * 1.4;
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.08;
      world.objectiveBeacon.scale.set(pulse, 1, pulse);
      world.objectiveBeacon.children.forEach((child) => {
        if (child.material && child.material.color) {
          child.material.color.setHex(target.danger ? 0xff4b6d : 0xffd43b);
        }
      });
    }
  }

  function updatePedestrians(dt) {
    const p = player.group.position;
    world.pedestrians.forEach((actor) => {
      actor.wait = Math.max(0, actor.wait - dt);
      const dToPlayer = Math.sqrt(dist2(actor.group.position, p));
      if (dToPlayer < 3.2 && state.phase === "day") {
        actor.group.lookAt(p.x, actor.group.position.y, p.z);
        return;
      }
      if (actor.wait > 0) return;

      tmpVec.copy(actor.target).sub(actor.group.position).setY(0);
      if (tmpVec.lengthSq() < 1) {
        actor.target.copy(getRandomPedestrianPoint());
        actor.wait = rand(0.4, 1.8);
        return;
      }
      tmpVec.normalize();
      actor.group.position.addScaledVector(tmpVec, actor.speed * dt);
      actor.group.rotation.y = Math.atan2(tmpVec.x, tmpVec.z);
    });
  }

  function updateChase(dt) {
    if (!state.chaseActive && state.heat >= HEAT_CHASE_AT && state.phase === "day") startChase();
    world.cops.forEach((cop) => updateCopSiren(cop, performance.now() * 0.001));
    if (!state.chaseActive) return;

    if (!state.backupCalled && (state.heat >= 86 || state.arrest >= 45)) {
      state.backupCalled = true;
      state.chaseEscalation = 2;
      setCopActive(world.cops[1], true);
      pushLog("Dispatch", "Backup joined the chase. The sidewalk has become a whole incident.");
      setStatus("Backup", "Second cop active");
    }

    let nearest = Infinity;
    const district = getCurrentDistrict();
    world.cops.filter((cop) => cop.active).forEach((cop) => {
      cop.stunTime = Math.max(0, (cop.stunTime || 0) - dt);
      cop.confuseTime = Math.max(0, (cop.confuseTime || 0) - dt);
      cop.previous.copy(cop.group.position);
      if (cop.stunTime > 0) {
        cop.velocity.multiplyScalar(0.82);
        cop.group.position.addScaledVector(cop.velocity, dt);
        maybeTriggerBananaTrapForActor(cop, "cop");
        return;
      }
      if (cop.confuseTime > 0) {
        const wobble = new THREE.Vector3(Math.sin(performance.now() * 0.006 + cop.speed), 0, Math.cos(performance.now() * 0.005 + cop.speed));
        wobble.normalize();
        cop.velocity.lerp(wobble.multiplyScalar(2.2 + Math.abs(cop.confuseSpin || 0)), 0.08);
        cop.group.position.addScaledVector(cop.velocity, dt);
        cop.group.rotation.y += dt * 3.6 * (cop.confuseSpin || 1);
        maybeTriggerBananaTrapForActor(cop, "cop");
        return;
      }
      const toPlayer = player.group.position.clone().sub(cop.group.position).setY(0);
      const distance = Math.max(0.001, toPlayer.length());
      nearest = Math.min(nearest, distance);
      toPlayer.normalize();
      const escalationBoost = state.chaseEscalation > 1 ? 0.45 : 0;
      const pressureBoost = state.directorPressure > 78 ? 0.35 : 0;
      cop.velocity.lerp(
        toPlayer.multiplyScalar((cop.speed + escalationBoost + pressureBoost + state.heat * 0.018) * district.copSpeedMult),
        0.08
      );
      cop.group.position.addScaledVector(cop.velocity, dt);
      cop.group.rotation.y = Math.atan2(cop.velocity.x, cop.velocity.z);
      maybeTriggerBananaTrapForActor(cop, "cop");
    });

    if (nearest < 2.1) {
      state.arrest = clamp(state.arrest + dt * (state.chaseEscalation > 1 ? 42 : 32) * getArrestGainMultiplier(), 0, 100);
      state.health = clamp(state.health - dt * 3, 0, state.maxHealth);
      setStatus("Arrest", "Break contact");
    } else {
      state.arrest = clamp(state.arrest - dt * (state.upgrades.cartPadding ? 15 : 12), 0, 100);
    }

    if (nearest > 17 && state.heat < 48) {
      state.chaseCooldown += dt;
      if (state.chaseCooldown > 3.2) stopChase();
    } else {
      state.chaseCooldown = 0;
    }
  }

  function updateNight(dt) {
    if (state.phase !== "night") return;

    state.waveSpawnTimer -= dt;
    if (state.waveSpawnTimer <= 0 && state.waveSpawned < getWaveTarget()) {
      spawnZombie();
      state.waveSpawned += 1;
      const lanternDelay = hasCampUpgrade("lanternRig") ? 0.2 : 0;
      state.waveSpawnTimer = Math.max(0.7 + lanternDelay, rand(1.45, 2.8) + lanternDelay - (state.cycle - 1) * 0.18);
    }

    world.zombies.slice().forEach((zombie) => {
      if (zombie.boss) {
        updateHazeBrute(zombie, dt);
        return;
      }
      if (zombie.variant === "runner") {
        updateHazeRunner(zombie, dt);
      } else if (zombie.variant === "spitter") {
        updateGooSpitter(zombie, dt);
      } else {
        updateHazeShambler(zombie, dt);
      }
    });
  }

  function spawnZombie() {
    const keys = Object.keys(world.markers).filter((key) => key.startsWith("spawn-"));
    const spawn = world.markers[pick(keys)];
    const pressureBonus = state.directorPressure * 0.006;
    const hazeDistrict = getCurrentDistrict().id === "haze";
    const cycleBoost = Math.max(0, state.cycle - 1);
    const variant = chooseHazeVariant();
    const def = hazeVariantDefs[variant] || hazeVariantDefs.shambler;
    const zombie = {
      kind: "zombie",
      variant,
      label: def.label,
      group: createHuman({
        coat: pick(def.coats),
        head: def.head,
        pants: 0x171b24,
        scale: rand(def.scale[0], def.scale[1]) + cycleBoost * 0.035,
        label: variant + "-" + state.waveSpawned,
      }),
      speed: rand(def.speed[0], def.speed[1]) + state.waveSpawned * 0.025 + pressureBonus + cycleBoost * 0.24,
      health: rand(def.health[0], def.health[1]) + state.directorPressure * 0.12 + cycleBoost * (variant === "runner" ? 7 : 12),
      damage: pick(def.damage) + (hazeDistrict ? 1 : 0) + cycleBoost,
      velocity: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      stunTime: 0,
      confuseTime: 0,
      confuseSpin: 1,
      hitCooldown: rand(0, 0.6),
      dashCooldown: variant === "runner" ? rand(0.3, 1.2) : 0,
      dashTime: 0,
      dashVector: new THREE.Vector3(),
      spitCooldown: variant === "spitter" ? rand(0.6, 1.6) : 0,
      wobble: rand(0, Math.PI * 2),
    };
    zombie.group.position.copy(spawn);
    zombie.group.position.x += rand(-1.1, 1.1);
    zombie.group.position.z += rand(-1.1, 1.1);
    zombie.previous.copy(zombie.group.position);
    decorateHazeVariant(zombie);
    world.root.add(zombie.group);
    world.zombies.push(zombie);

    if (variant !== "shambler" && !state.seenHazeVariants[variant]) {
      state.seenHazeVariants[variant] = true;
      pushLog(def.label, def.intro);
      setStatus(def.label, variant === "spitter" ? "Dodge the goo" : "Fast threat");
    }
  }

  function chooseHazeVariant() {
    const waveIndex = state.waveSpawned;
    if (DEBUG_TIMERS) {
      if (waveIndex === 0) return "runner";
      if (waveIndex === 1) return "spitter";
    }
    if (state.cycle >= 2 && waveIndex % 6 === 3) return "spitter";
    if (state.cycle >= 2 && waveIndex % 5 === 1) return "runner";
    if (waveIndex % 7 === 4) return "runner";
    if (state.directorPressure > 72 && waveIndex % 4 === 2) return pick(["runner", "spitter"]);
    return "shambler";
  }

  function decorateHazeVariant(zombie) {
    const group = zombie.group;
    const parts = group.userData.parts || {};
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(zombie.variant + "-eye", 0xc8ff69, 0.2, 0.1));
    glow.position.set(0, 2.13, -0.32);
    group.add(glow);

    if (zombie.variant === "runner") {
      const shoeMat = mat("runner-shoes", 0xffd43b, 0.45, 0.02);
      const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.54), shoeMat);
      const rightShoe = leftShoe.clone();
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.72, 0.24), mat("runner-pack", 0xff2e88, 0.5, 0.03));
      leftShoe.position.set(-0.24, 0.08, -0.08);
      rightShoe.position.set(0.24, 0.08, -0.08);
      pack.position.set(0, 1.34, 0.42);
      group.add(leftShoe, rightShoe, pack);
      if (parts.legL) parts.legL.scale.y = 1.22;
      if (parts.legR) parts.legR.scale.y = 1.22;
    } else if (zombie.variant === "spitter") {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 8), mat("spitter-tank", 0x75ff92, 0.38, 0.08));
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.62, 7), mat("spitter-tube", 0x2ee0ff, 0.42, 0.04));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat("spitter-bulb", 0xb7ff68, 0.32, 0.08));
      const glowLight = new THREE.PointLight(0x75ff92, 0.72, 5, 2);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 1.45, 0.48);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 1.96, -0.48);
      bulb.position.set(0, 2.22, 0.05);
      glowLight.position.set(0, 2.1, 0);
      group.add(tank, tube, bulb, glowLight);
      if (parts.head) parts.head.scale.set(1.08, 0.92, 1.08);
    }
  }

  function updateHazeShambler(zombie, dt) {
    const toPlayer = player.group.position.clone().sub(zombie.group.position).setY(0);
    const distance = Math.max(0.001, toPlayer.length());
    const desired = getHazeDesiredVector(zombie, toPlayer, zombie.speed);
    moveHazeActor(zombie, desired, dt, 0.075);
    applyHazeContact(zombie, distance, 1.45, "Hit", "Shake them off", 4);
  }

  function updateHazeRunner(zombie, dt) {
    const toPlayer = player.group.position.clone().sub(zombie.group.position).setY(0);
    const distance = Math.max(0.001, toPlayer.length());
    zombie.dashCooldown = Math.max(0, (zombie.dashCooldown || 0) - dt);
    zombie.dashTime = Math.max(0, (zombie.dashTime || 0) - dt);

    let desired = getHazeDesiredVector(zombie, toPlayer, zombie.speed);
    if (zombie.stunTime <= 0 && zombie.confuseTime <= 0 && zombie.dashTime <= 0 && distance < 8.5 && zombie.dashCooldown <= 0) {
      zombie.dashVector.copy(toPlayer).normalize();
      zombie.dashTime = 0.42;
      zombie.dashCooldown = rand(2.2, 3.4);
      addFloater("SKITTER", zombie.group.position, palette.curb);
    }
    if (zombie.dashTime > 0 && zombie.stunTime <= 0 && zombie.confuseTime <= 0) {
      const tangent = tmpVec2.set(-zombie.dashVector.z, 0, zombie.dashVector.x).multiplyScalar(Math.sin(performance.now() * 0.025 + zombie.wobble) * 0.45);
      desired = zombie.dashVector.clone().add(tangent).normalize().multiplyScalar(zombie.speed * 2.05);
    }

    moveHazeActor(zombie, desired, dt, zombie.dashTime > 0 ? 0.18 : 0.1);
    applyHazeContact(zombie, distance, zombie.dashTime > 0 ? 1.78 : 1.35, "Runner Hit", "Runner clipped you", 5);
  }

  function updateGooSpitter(zombie, dt) {
    const toPlayer = player.group.position.clone().sub(zombie.group.position).setY(0);
    const distance = Math.max(0.001, toPlayer.length());
    zombie.spitCooldown = Math.max(0, (zombie.spitCooldown || 0) - dt);

    let desired;
    if (zombie.stunTime > 0 || zombie.confuseTime > 0) {
      desired = getHazeDesiredVector(zombie, toPlayer, zombie.speed);
    } else if (distance < 5.2) {
      desired = zombie.group.position.clone().sub(player.group.position).setY(0).normalize().multiplyScalar(zombie.speed * 0.95);
    } else if (distance > 10.5) {
      desired = toPlayer.clone().normalize().multiplyScalar(zombie.speed * 0.82);
    } else {
      const tangent = tmpVec2.set(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(Math.sin(performance.now() * 0.004 + zombie.wobble) * zombie.speed * 0.72);
      desired = tangent;
      if (zombie.spitCooldown <= 0) {
        spawnGooProjectile(zombie, toPlayer);
        zombie.spitCooldown = rand(2.4, 3.6) * (hasCampUpgrade("lanternRig") ? 1.14 : 1);
      }
    }

    moveHazeActor(zombie, desired, dt, 0.065);
    applyHazeContact(zombie, distance, 1.35, "Spitter Hit", "Too close to goo", 5);
  }

  function getHazeDesiredVector(zombie, toPlayer, speed) {
    if (zombie.stunTime > 0) return tmpVec2.set(0, 0, 0);
    if (zombie.confuseTime > 0) {
      const away = zombie.group.position.clone().sub(player.group.position).setY(0);
      if (away.lengthSq() <= 0.01) away.set(1, 0, 0);
      away.normalize();
      const tangent = tmpVec2.set(-away.z, 0, away.x).multiplyScalar(zombie.confuseSpin || 1);
      return away.multiplyScalar(speed * 0.75).add(tangent.multiplyScalar(speed * 0.5));
    }
    return toPlayer.clone().normalize().multiplyScalar(speed);
  }

  function moveHazeActor(zombie, desired, dt, lerpAmount) {
    zombie.stunTime = Math.max(0, (zombie.stunTime || 0) - dt);
    zombie.confuseTime = Math.max(0, (zombie.confuseTime || 0) - dt);
    zombie.hitCooldown = Math.max(0, (zombie.hitCooldown || 0) - dt);
    zombie.previous.copy(zombie.group.position);
    zombie.velocity.lerp(desired, lerpAmount);
    zombie.group.position.addScaledVector(zombie.velocity, dt);
    zombie.group.rotation.y = Math.atan2(zombie.velocity.x, zombie.velocity.z);
    const bobRate = zombie.variant === "runner" ? 0.009 : 0.004;
    const bobHeight = zombie.variant === "spitter" ? 0.05 : 0.08;
    zombie.group.position.y = Math.sin(performance.now() * bobRate + zombie.wobble) * bobHeight;
    maybeTriggerBananaTrapForActor(zombie, "zombie");
  }

  function applyHazeContact(zombie, distance, range, title, text, energyLoss) {
    if (zombie.dead) return;
    if (distance < range && zombie.hitCooldown <= 0 && zombie.stunTime <= 0 && zombie.confuseTime <= 0) {
      zombie.hitCooldown = zombie.variant === "runner" ? 0.82 : 1.25;
      const incomingDamage = Math.max(2, Math.round(zombie.damage * (state.upgrades.cartPadding ? 0.72 : 1) * getNightDamageMultiplier()));
      state.health = clamp(state.health - incomingDamage, 0, state.maxHealth);
      state.energy = clamp(state.energy - energyLoss, 0, 100);
      addFloater("-" + incomingDamage, player.group.position, palette.danger);
      setStatus(title, text);
    }
  }

  function spawnGooProjectile(zombie, toPlayer) {
    const direction = toPlayer.clone();
    if (direction.lengthSq() <= 0.01) direction.set(0, 0, 1);
    direction.normalize();

    const group = new THREE.Group();
    const goo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mat("haze-goo", 0x75ff92, 0.34, 0.06));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat("haze-goo-core", 0xdfff7a, 0.24, 0.08));
    goo.scale.set(1.25, 0.82, 1.25);
    core.position.set(0.02, 0.02, 0);
    group.add(goo, core);
    group.position.copy(zombie.group.position);
    group.position.y = 1.42;
    world.root.add(group);

    const velocity = direction.multiplyScalar(8.5 + state.cycle * 0.45);
    velocity.y = 1.15;
    world.projectiles.push({
      type: "goo",
      group,
      velocity,
      life: 1.55,
      gravity: 1.2,
      damage: 7 + state.cycle,
      hitRadius: 1.25,
    });
    addFloater("GLOP", zombie.group.position, palette.danger);
  }

  function spawnHazeBrute() {
    if (state.nightBossSpawned || getHazeBoss()) return;
    state.nightBossSpawned = true;
    const spawn = world.markers["spawn-1"] || world.markers["spawn-0"] || new THREE.Vector3(-9.5, 0, -9.2);
    const maxHealth = DEBUG_TIMERS ? 190 : 320;
    const boss = {
      kind: "zombie",
      boss: true,
      label: "Haze Brute",
      group: createHuman({
        coat: 0x33451f,
        head: 0xb7ff68,
        pants: 0x151b1e,
        scale: 1.58,
        label: "haze-brute",
      }),
      speed: DEBUG_TIMERS ? 1.45 : 1.62,
      health: maxHealth,
      maxHealth,
      damage: 13 + state.cycle,
      velocity: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      stunTime: 0,
      confuseTime: 0,
      confuseSpin: 1,
      hitCooldown: 0.5,
      wobble: rand(0, Math.PI * 2),
      chargeCooldown: 2.2,
      chargeWindup: 0,
      chargeTime: 0,
      chargeVector: new THREE.Vector3(),
    };

    boss.group.position.copy(spawn);
    boss.group.position.x += 1.4;
    boss.previous.copy(boss.group.position);
    decorateHazeBrute(boss);
    world.root.add(boss.group);
    world.zombies.push(boss);
    pushLog("Haze Brute", "A traffic-cone-crowned brute stomped out of the alley.");
    setStatus("Boss", "Haze Brute incoming");
    addFloater("BRUTE!", boss.group.position, palette.danger);
  }

  function decorateHazeBrute(boss) {
    const group = boss.group;
    const parts = group.userData.parts || {};
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.82, 5), mat("brute-cone-crown", palette.cone));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.64), mat("brute-cone-stripe", 0xf9f4dc));
    crown.position.set(0, 2.95, 0);
    stripe.position.set(0, 2.66, 0);
    group.add(crown, stripe);

    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.72), mat("brute-sign", 0xffd43b, 0.4, 0.04));
    sign.position.set(0, 1.55, -0.42);
    group.add(sign);

    const hazeGlow = new THREE.PointLight(0x75ff92, 1.2, 8, 2);
    hazeGlow.position.set(0, 2.2, 0);
    group.add(hazeGlow);

    if (parts.body) parts.body.scale.set(1.25, 1.08, 1.18);
    if (parts.armL) parts.armL.scale.set(1.18, 1.28, 1.18);
    if (parts.armR) parts.armR.scale.set(1.18, 1.28, 1.18);
  }

  function updateHazeBrute(boss, dt) {
    const toPlayer = player.group.position.clone().sub(boss.group.position).setY(0);
    const distance = Math.max(0.001, toPlayer.length());
    boss.stunTime = Math.max(0, (boss.stunTime || 0) - dt);
    boss.confuseTime = Math.max(0, (boss.confuseTime || 0) - dt);
    boss.hitCooldown = Math.max(0, boss.hitCooldown - dt);
    boss.chargeCooldown = Math.max(0, boss.chargeCooldown - dt);
    boss.previous.copy(boss.group.position);

    let desired = tmpVec2.set(0, 0, 0);
    if (boss.stunTime > 0) {
      desired.set(0, 0, 0);
    } else if (boss.chargeWindup > 0) {
      boss.chargeWindup = Math.max(0, boss.chargeWindup - dt);
      boss.group.scale.setScalar(1 + Math.sin(performance.now() * 0.03) * 0.035);
      desired.set(0, 0, 0);
      if (boss.chargeWindup <= 0) {
        boss.chargeTime = 0.52;
        boss.chargeVector.copy(toPlayer.lengthSq() > 0.01 ? toPlayer.normalize() : input.lastMove).setY(0);
      }
    } else if (boss.chargeTime > 0) {
      boss.chargeTime = Math.max(0, boss.chargeTime - dt);
      desired.copy(boss.chargeVector).multiplyScalar(boss.speed * 3.4);
      if (boss.chargeTime <= 0) {
        kickPhysicsProps(boss.group.position, 4.6, 11.5, "BRUTE CLATTER");
        addFloater("SLAM", boss.group.position, palette.danger);
      }
    } else if (boss.confuseTime > 0) {
      const away = boss.group.position.clone().sub(player.group.position).setY(0);
      if (away.lengthSq() <= 0.01) away.set(1, 0, 0);
      away.normalize();
      const tangent = tmpVec2.set(-away.z, 0, away.x).multiplyScalar(boss.confuseSpin || 1);
      desired = away.multiplyScalar(boss.speed * 0.55).add(tangent.multiplyScalar(boss.speed * 0.75));
    } else {
      desired = toPlayer.normalize().multiplyScalar(boss.speed);
      if (distance < 7.5 && boss.chargeCooldown <= 0) {
        boss.chargeWindup = 0.58;
        boss.chargeCooldown = 4.4;
        setStatus("Boss", "Charge windup");
        addFloater("CHARGE?", boss.group.position, palette.danger);
      }
    }

    boss.velocity.lerp(desired, boss.chargeTime > 0 ? 0.18 : 0.075);
    boss.group.position.addScaledVector(boss.velocity, dt);
    boss.group.rotation.y = Math.atan2(boss.velocity.x || toPlayer.x, boss.velocity.z || toPlayer.z);
    boss.group.position.y = Math.sin(performance.now() * 0.005 + boss.wobble) * 0.06;
    if (boss.chargeWindup <= 0) boss.group.scale.lerp(tmpVec.set(1, 1, 1), 0.12);
    maybeTriggerBananaTrapForActor(boss, "zombie");
    if (boss.dead) return;

    const contactRange = boss.chargeTime > 0 ? 2.25 : 1.85;
    if (distance < contactRange && boss.hitCooldown <= 0 && boss.stunTime <= 0 && boss.confuseTime <= 0) {
      boss.hitCooldown = boss.chargeTime > 0 ? 1.0 : 1.35;
      const incomingDamage = Math.max(4, Math.round(boss.damage * (boss.chargeTime > 0 ? 1.25 : 1) * getNightDamageMultiplier()));
      state.health = clamp(state.health - incomingDamage, 0, state.maxHealth);
      state.energy = clamp(state.energy - 7, 0, 100);
      player.velocity.add(boss.group.position.clone().sub(player.group.position).setY(0).normalize().multiplyScalar(-5.5));
      addFloater("-" + incomingDamage, player.group.position, palette.danger);
      setStatus("Boss Hit", "Keep moving");
    }
  }

  function updateProjectiles(dt) {
    world.projectiles.slice().forEach((projectile) => {
      projectile.life -= dt;
      projectile.velocity.y -= dt * (projectile.gravity ?? 10.5);
      projectile.group.position.addScaledVector(projectile.velocity, dt);
      projectile.group.rotation.x += dt * 9;
      projectile.group.rotation.z += dt * 6;

      if (projectile.type === "goo") {
        if (dist2(projectile.group.position, player.group.position) <= Math.pow(projectile.hitRadius || 1.2, 2)) {
          const incomingDamage = Math.max(2, Math.round(projectile.damage * getNightDamageMultiplier()));
          state.health = clamp(state.health - incomingDamage, 0, state.maxHealth);
          state.energy = clamp(state.energy - 8, 0, 100);
          state.gooSlowTime = Math.max(state.gooSlowTime, 1.55);
          player.velocity.add(projectile.velocity.clone().setY(0).normalize().multiplyScalar(1.8));
          addFloater("GOO -" + incomingDamage, player.group.position, palette.danger);
          setStatus("Goo Hit", "Move speed down");
          projectile.life = -1;
        }
      } else {
        const propHits = kickPhysicsProps(projectile.group.position, 1.65, 7.2, "CONE CLANG");
        if (propHits > 0) projectile.life = -1;

        const targets = state.phase === "night" ? world.zombies : world.cops.filter((cop) => cop.active);
        for (const target of targets) {
          if (dist2(projectile.group.position, target.group.position) > 2.2) continue;
          hitActor(target, projectile.damage, 10);
          projectile.life = -1;
          break;
        }
      }

      if (projectile.life <= 0 || projectile.group.position.y < -0.2) {
        world.root.remove(projectile.group);
        const index = world.projectiles.indexOf(projectile);
        if (index >= 0) world.projectiles.splice(index, 1);
      }
    });
  }

  function updatePhysics(dt) {
    const physics = world.physics;
    if (!physics || !physics.ready) return;
    physics.rapierWorld.timestep = clamp(dt, 1 / 120, 1 / 30);
    physics.rapierWorld.step();

    physics.props.forEach((prop) => {
      prop.cooldown = Math.max(0, prop.cooldown - dt);
      const translation = prop.body.translation();
      if (
        !Number.isFinite(translation.x) ||
        !Number.isFinite(translation.y) ||
        !Number.isFinite(translation.z) ||
        translation.y < -5 ||
        Math.abs(translation.x) > WORLD_LIMIT_X + 8 ||
        Math.abs(translation.z) > WORLD_LIMIT_Z + 8
      ) {
        resetPhysicsProp(prop);
        return;
      }

      prop.mesh.position.set(translation.x, translation.y, translation.z);
      const rotation = prop.body.rotation();
      prop.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });
  }

  function kickPhysicsProps(origin, radius, force, label) {
    const physics = world.physics;
    if (!physics || !physics.ready) return 0;
    let hits = 0;
    physics.props.forEach((prop) => {
      if (prop.cooldown > 0) return;
      const translation = prop.body.translation();
      tmpVec.set(translation.x - origin.x, 0, translation.z - origin.z);
      const distance = tmpVec.length();
      if (distance > radius + prop.radius) return;
      if (distance > 0.01) {
        tmpVec.normalize();
      } else {
        tmpVec.copy(input.lastMove).normalize();
      }
      const closeness = 1 - clamp(distance / (radius + prop.radius), 0, 1);
      const impulse = force * (0.55 + closeness);
      prop.body.applyImpulse(
        { x: tmpVec.x * impulse, y: 2.4 + impulse * 0.18, z: tmpVec.z * impulse },
        true
      );
      prop.body.applyTorqueImpulse(
        { x: rand(-2.4, 2.4) * impulse, y: rand(-3.2, 3.2) * impulse, z: rand(-2.4, 2.4) * impulse },
        true
      );
      prop.cooldown = 0.28;
      hits += 1;
    });

    if (hits > 0) {
      state.score += hits * 45;
      if (state.phase === "day") {
        const district = getCurrentDistrict();
        state.heat = clamp(state.heat + hits * 1.2, 0, 100);
        addHype(hits * 2);
        progressGig("propLaunch", hits);
        progressFavor("crosswalkStunt", hits, district);
      }
      extendTumbleChain(hits);
      addFloater(label + (hits > 1 ? " x" + hits : ""), origin, palette.curb);
    }
    return hits;
  }

  function resetPhysicsProps() {
    const physics = world.physics;
    if (!physics || !physics.ready) return;
    physics.props.forEach((prop) => resetPhysicsProp(prop));
  }

  function resetPhysicsProp(prop) {
    if (!prop || !prop.body) return;
    const jitterX = rand(-0.08, 0.08);
    const jitterZ = rand(-0.08, 0.08);
    prop.body.setTranslation({ x: prop.home.x + jitterX, y: prop.home.y, z: prop.home.z + jitterZ }, true);
    prop.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    prop.mesh.position.copy(prop.home);
    prop.mesh.quaternion.identity();
    prop.cooldown = 0;
  }

  function updateFloaters(dt) {
    world.floaters.slice().forEach((floater) => {
      floater.life -= dt;
      if (floater.velocity) {
        floater.velocity.y -= dt * 3.2;
        floater.mesh.position.addScaledVector(floater.velocity, dt);
      } else {
        floater.mesh.position.y += dt * 1.1;
      }
      floater.mesh.rotation.y += dt * (floater.spin || 1);
      floater.mesh.scale.multiplyScalar(1 + dt * 0.12);
      if (floater.life <= 0) {
        world.root.remove(floater.mesh);
        const index = world.floaters.indexOf(floater);
        if (index >= 0) world.floaters.splice(index, 1);
      }
    });
  }

  function updateAmbientVisuals(dt) {
    world.animatedVisuals.forEach((visual) => {
      visual.time += dt;
      if (visual.type === "patrolLights") {
        const blink = Math.sin(visual.time * 9.5) > 0;
        const activeBoost = state.chaseActive ? 1.8 : 1;
        visual.red.visible = blink;
        visual.blue.visible = !blink;
        visual.redLight.intensity = blink ? 1.8 * activeBoost : 0.18;
        visual.blueLight.intensity = !blink ? 1.8 * activeBoost : 0.18;
        if (visual.glowRed && visual.glowBlue) {
          visual.glowRed.visible = blink;
          visual.glowBlue.visible = !blink;
          visual.glowRed.material.opacity = 0.34 + 0.2 * activeBoost;
          visual.glowBlue.material.opacity = 0.34 + 0.2 * activeBoost;
          visual.glowRed.scale.set(blink ? 2.1 : 1.1, blink ? 1.32 : 0.72, 1);
          visual.glowBlue.scale.set(!blink ? 2.1 : 1.1, !blink ? 1.32 : 0.72, 1);
        }
        if (visual.redBeam && visual.blueBeam) {
          visual.redBeam.visible = blink;
          visual.blueBeam.visible = !blink;
          visual.redBeam.material.opacity = blink ? 0.22 + activeBoost * 0.07 : 0.04;
          visual.blueBeam.material.opacity = !blink ? 0.22 + activeBoost * 0.07 : 0.04;
          visual.redBeam.scale.set(blink ? 3.65 : 1.5, blink ? 1.52 : 0.72, 1);
          visual.blueBeam.scale.set(!blink ? 3.65 : 1.5, !blink ? 1.52 : 0.72, 1);
        }
        if (visual.sideGlow) {
          visual.sideGlow.material.opacity = 0.13 + Math.abs(Math.sin(visual.time * 9.5)) * 0.18 * activeBoost;
          visual.sideGlow.scale.set(4.35 + activeBoost * 0.35, 0.85 + activeBoost * 0.2, 1);
        }
        if (visual.redWash && visual.blueWash) {
          visual.redWash.visible = blink;
          visual.blueWash.visible = !blink;
          visual.redWash.material.opacity = blink ? 0.16 + activeBoost * 0.08 : 0.04;
          visual.blueWash.material.opacity = !blink ? 0.16 + activeBoost * 0.08 : 0.04;
        }
      } else if (visual.type === "decorOfficer") {
        const stride = Math.sin(visual.time * 4.4);
        visual.group.position.y = visual.baseY + Math.abs(stride) * 0.035;
        if (visual.parts) {
          visual.parts.body.rotation.z = stride * 0.025;
          visual.parts.shoulders.rotation.z = stride * 0.04;
          visual.parts.head.rotation.y = Math.sin(visual.time * 1.35) * 0.16;
          visual.parts.armL.rotation.z = 0.18 + stride * 0.14;
          visual.parts.armR.rotation.z = -0.18 - stride * 0.2;
          visual.parts.legL.rotation.x = stride * 0.13;
          visual.parts.legR.rotation.x = -stride * 0.13;
        }
        if (visual.baton) {
          visual.baton.rotation.z = -0.45 + stride * 0.1;
        }
      } else if (visual.type === "openingWalker") {
        const stride = Math.sin(visual.time * visual.speed);
        visual.group.position.y = visual.baseY + Math.abs(stride) * 0.028;
        if (visual.parts) {
          visual.parts.body.rotation.z = stride * 0.018;
          visual.parts.shoulders.rotation.z = stride * 0.035;
          visual.parts.head.rotation.y = Math.sin(visual.time * 1.15) * 0.1;
          visual.parts.armL.rotation.z = 0.22 + stride * 0.2;
          visual.parts.armR.rotation.z = -0.22 - stride * 0.2;
          visual.parts.legL.rotation.x = stride * 0.18;
          visual.parts.legR.rotation.x = -stride * 0.18;
        }
      } else if (visual.type === "openingPoliceGlow") {
        const blink = Math.sin(visual.time * 9.5) > 0;
        visual.redFlare.visible = blink;
        visual.blueFlare.visible = !blink;
        visual.redFlare.material.opacity = blink ? 0.42 : 0.08;
        visual.blueFlare.material.opacity = !blink ? 0.42 : 0.08;
        visual.redFlare.scale.set(blink ? 2.75 : 1.25, blink ? 1.12 : 0.58, 1);
        visual.blueFlare.scale.set(!blink ? 2.75 : 1.25, !blink ? 1.12 : 0.58, 1);
      } else if (visual.type === "seatedScene") {
        const breathe = Math.sin(visual.time * 1.3) * 0.018;
        visual.group.position.y = breathe;
        visual.signBoard.rotation.z = Math.sin(visual.time * 0.9) * 0.018;
        visual.signText.rotation.z = visual.signBoard.rotation.z;
      }
    });
  }

  function addFloater(text, position, color) {
    const sprite = makeTextSprite(text, color);
    sprite.position.copy(position);
    sprite.position.y += 2.8;
    world.root.add(sprite);
    world.floaters.push({ mesh: sprite, life: 0.92, spin: 0 });
  }

  function makeTextSprite(text, color) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext("2d");
    const lines = String(text).split(/\\n|\n/).slice(0, 4);
    const fontSize = lines.length > 2 ? 22 : (lines.length > 1 ? 27 : 34);
    const lineStep = lines.length > 2 ? 22 : (lines.length > 1 ? 29 : 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = "800 " + fontSize + "px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const darkText = color < 0x555555;
    ctx.lineWidth = darkText ? 3 : 8;
    ctx.strokeStyle = darkText ? "rgba(255,226,164,0.34)" : "rgba(0,0,0,0.85)";
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    lines.forEach((line, index) => {
      const y = c.height / 2 + (index - (lines.length - 1) / 2) * lineStep;
      ctx.strokeText(line, c.width / 2, y);
      ctx.fillText(line, c.width / 2, y);
    });
    const texture = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.scale.set(3.1, 1.16, 1);
    return sprite;
  }

  function segmentRectEntryT(start, end, blocker, pad = 0.45) {
    const minX = blocker.x - blocker.w / 2 - pad;
    const maxX = blocker.x + blocker.w / 2 + pad;
    const minZ = blocker.z - blocker.d / 2 - pad;
    const maxZ = blocker.z + blocker.d / 2 + pad;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    let tMin = 0;
    let tMax = 1;

    if (Math.abs(dx) < 0.0001) {
      if (start.x < minX || start.x > maxX) return null;
    } else {
      const tx1 = (minX - start.x) / dx;
      const tx2 = (maxX - start.x) / dx;
      tMin = Math.max(tMin, Math.min(tx1, tx2));
      tMax = Math.min(tMax, Math.max(tx1, tx2));
    }

    if (Math.abs(dz) < 0.0001) {
      if (start.z < minZ || start.z > maxZ) return null;
    } else {
      const tz1 = (minZ - start.z) / dz;
      const tz2 = (maxZ - start.z) / dz;
      tMin = Math.max(tMin, Math.min(tz1, tz2));
      tMax = Math.min(tMax, Math.max(tz1, tz2));
    }

    if (tMax < tMin || tMax < 0 || tMin > 1) return null;
    return clamp(tMin, 0, 1);
  }

  function getCameraOcclusionT(start, end) {
    let best = 1;
    world.blockers.forEach((blocker) => {
      if (blocker.name === "trash" || blocker.name === "hostile-bench") return;
      const t = segmentRectEntryT(start, end, blocker, blocker.name === "building" ? 0.75 : 0.42);
      if (t !== null && t > 0.08 && t < best) best = t;
    });
    return best;
  }

  function updateCamera(dt) {
    const target = player.group.position;
    const horizontal = Math.cos(cameraLook.pitch) * cameraLook.distance;
    const rightX = Math.cos(cameraLook.yaw);
    const rightZ = -Math.sin(cameraLook.yaw);
    const desired = tmpVec.set(
      target.x + Math.sin(cameraLook.yaw) * horizontal + rightX * cameraLook.shoulder,
      target.y + Math.sin(cameraLook.pitch) * cameraLook.distance + 0.82,
      target.z + Math.cos(cameraLook.yaw) * horizontal + rightZ * cameraLook.shoulder
    );
    const lookTarget = tmpVec2.set(
      target.x + rightX * 0.32,
      target.y + 1.42,
      target.z + rightZ * 0.32
    );
    const occlusionT = getCameraOcclusionT(lookTarget, desired);
    if (occlusionT < 1) {
      const safeT = clamp(occlusionT - 0.08, 0.22, 1);
      tmpVec3.copy(lookTarget).lerp(desired, safeT);
      tmpVec3.y += (1 - safeT) * 1.1;
      desired.copy(tmpVec3);
    }
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
  }

  function updateDayNightVisuals() {
    const isNight = state.phase === "night";
    const t = isNight ? clamp(state.time / 7, 0, 1) : clamp(1 - state.time / 6, 0, 1);
    const nightStrength = isNight ? t : 0;

    renderer.setClearColor(isNight ? 0x08091b : 0x719fbd, 1);
    scene.fog.color.setHex(isNight ? 0x0d1028 : 0x719fbd);
    scene.fog.density = lerp(0.012, 0.026, nightStrength);
    world.lights.hemi.intensity = lerp(1.16, 0.62, nightStrength);
    world.lights.sun.intensity = lerp(1.72, 0.28, nightStrength);
    world.lights.haze.intensity = lerp(0.1, 2.4, nightStrength);
    Object.keys(world.lights).forEach((key) => {
      if (key.startsWith("lamp-")) world.lights[key].visible = isNight;
    });
  }

  function resizeRenderer() {
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    resizeRenderer();
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  function setStatus(title, text) {
    if (!el.statusChip || state.messageTimer > 0.05 && title === "Goal") return;
    el.statusChip.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
    state.messageTimer = 0.8;
  }

  function setPassiveStatus(title, text) {
    if (!el.statusChip || state.messageTimer > 0.05) return;
    el.statusChip.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  }

  function pushLog(title, text) {
    logs.unshift([title, text]);
    while (logs.length > 4) logs.pop();
    renderLog();
  }

  function renderLog() {
    el.cityLog.innerHTML = logs
      .map(([title, text]) => `<div class="unhinged-log__item"><strong>${title}</strong>${text}</div>`)
      .join("");
  }

  function updateTargetVisualHud(progress, waveTarget) {
    if (el.hudClock) el.hudClock.textContent = formatClockTime();
    if (el.hudCashLarge) el.hudCashLarge.textContent = compactMoney(state.cash);

    const foodDone = state.health >= Math.min(state.maxHealth, 82) || state.cash >= 28;
    const waterDone = state.energy >= 82;
    const buskTarget = 20 + (state.cycle - 1) * 8;
    const buskDone = state.cash >= buskTarget || (state.activeGig && state.activeGig.progress >= state.activeGig.target);
    const heatDone = state.chaseActive ? false : state.heat < HEAT_CHASE_AT * 0.62;

    if (el.hudTaskFood) el.hudTaskFood.textContent = foodDone ? "1/1" : "0/1";
    if (el.hudTaskWater) el.hudTaskWater.textContent = waterDone ? "1/1" : "0/1";
    if (el.hudTaskBusk) el.hudTaskBusk.textContent = buskDone ? "1/1" : "0/1";
    if (el.hudTaskBuskLabel) {
      el.hudTaskBuskLabel.textContent = state.activeGig
        ? state.activeGig.title
        : "Busk for cash in the park";
    }
    if (el.hudTaskHeat) el.hudTaskHeat.textContent = heatDone ? "1/1" : "0/1";
    if (el.hudTaskHeatLabel) {
      el.hudTaskHeatLabel.textContent = state.chaseActive ? "Lose the cops" : "Keep heat under control";
    }

    if (el.hudNotorietyFill) el.hudNotorietyFill.style.width = percent(state.heat);
    if (el.hudNotorietyStars) {
      const stars = Math.min(5, state.chaseActive ? Math.max(3, Math.ceil(state.heat / 20)) : Math.ceil(state.heat / 20));
      Array.from(el.hudNotorietyStars.children).forEach((star, index) => {
        star.classList.toggle("is-lit", index < stars);
      });
    }

    setHudBar(el.hudSurvivalHealth, el.hudSurvivalHealthText, state.health, state.maxHealth);
    setHudBar(el.hudSurvivalThirst, el.hudSurvivalThirstText, VISUAL_TARGET ? 40 : state.energy, 100);
    const hunger = VISUAL_TARGET
      ? 55
      : clamp(62 - progress * 0.28 + state.energy * 0.1 + (state.phase === "night" ? -14 : 0), 0, 100);
    const morale = VISUAL_TARGET
      ? 30
      : clamp(48 + state.hype * 0.36 - state.heat * 0.32 - (state.chaseActive ? 18 : 0) + (state.phase === "night" ? -10 : 0), 0, 100);
    setHudBar(el.hudSurvivalHunger, el.hudSurvivalHungerText, hunger, 100);
    setHudBar(el.hudSurvivalMorale, el.hudSurvivalMoraleText, morale, 100);

    if (el.hudMiniPlayer && player.group) {
      const x = clamp(((player.group.position.x + WORLD_LIMIT_X) / (WORLD_LIMIT_X * 2)) * 100, 8, 92);
      const y = clamp(((player.group.position.z + WORLD_LIMIT_Z) / (WORLD_LIMIT_Z * 2)) * 100, 8, 92);
      el.hudMiniPlayer.style.left = x + "%";
      el.hudMiniPlayer.style.top = y + "%";
      el.hudMiniPlayer.style.rotate = (-cameraLook.yaw) + "rad";
    }

    const action = dayActions[state.action] || dayActions.dance;
    const tool = meleeDefs[state.meleeTool] || meleeDefs.plunger;
    if (el.hudSlotActionLabel) el.hudSlotActionLabel.textContent = action.label.replace(" Battle", "").replace(" Bit", "");
    if (el.hudSlotScrapCount) el.hudSlotScrapCount.textContent = state.scrap.toString();
    if (el.hudSlotConeCount) el.hudSlotConeCount.textContent = state.coneAmmo + "/" + state.maxCones;
    if (el.hudSlotPeelCount) el.hudSlotPeelCount.textContent = state.peelAmmo + "/" + state.maxPeels;
    if (el.hudSlotToolLabel) el.hudSlotToolLabel.textContent = tool.label;
    if (el.hudSlotAction) el.hudSlotAction.classList.toggle("is-active", state.phase === "day");
    if (el.hudSlotTool) el.hudSlotTool.classList.toggle("is-active", state.phase === "night" || state.chaseActive);

    const nearby = getNearbyInteractable();
    if (el.hudPromptE) {
      el.hudPromptE.textContent = nearby
        ? interactionVerb(nearby)
        : (state.phase === "day" ? action.label : "Recover");
    }
    if (el.hudPromptSpace) el.hudPromptSpace.textContent = state.tumbleTime > 0 ? "Tumbling" : "Stunt";
    if (el.hudPromptJ) el.hudPromptJ.textContent = tool.label;
    if (el.hudPromptL) el.hudPromptL.textContent = state.peelAmmo > 0 ? "Drop Peel" : "No Peels";

    if (state.phase === "night" && el.hudTaskBuskLabel && el.hudTaskBusk) {
      el.hudTaskBuskLabel.textContent = "Clear Haze threats";
      el.hudTaskBusk.textContent = Math.round(state.waveKills) + "/" + waveTarget;
    }
  }

  function updateHud() {
    const duration = state.phase === "day" ? DAY_SECONDS : NIGHT_SECONDS;
    const progress = clamp((state.time / duration) * 100, 0, 100);
    const waveTarget = getWaveTarget();
    el.hudPhase.textContent = (state.phase === "day" ? "Day " : "Night ") + getCycleLabel();
    el.hudCash.textContent = money(state.cash);
    el.hudHeat.textContent = percent(state.heat);
    el.hudEnergy.textContent = percent(state.energy);
    el.hudHealth.textContent = Math.round(state.health) + "/" + state.maxHealth;
    el.hudHigh.textContent = state.high.toString();
    updateTargetVisualHud(progress, waveTarget);
    el.meterTime.style.width = percent(progress);
    el.meterTime.style.backgroundColor = state.phase === "day" ? "var(--accent-3)" : "#67ff62";
    el.meterTimeText.textContent = percent(progress);
    el.meterArrest.style.width = percent(state.arrest);
    el.meterArrest.style.backgroundColor = state.arrest > 65 ? "#ff4b6d" : "var(--accent-2)";
    el.meterArrestText.textContent = percent(state.arrest);
    const waveProgress = state.phase === "night" ? (state.waveKills / waveTarget) * 100 : 0;
    el.meterWave.style.width = percent(waveProgress);
    el.meterWave.style.backgroundColor = "#67ff62";
    el.meterWaveText.textContent = state.phase === "night" ? `${state.waveKills}/${waveTarget}` : `C${getCycleLabel()}`;
    el.meterHype.style.width = percent(state.hype);
    el.meterHype.style.backgroundColor = state.hype > 70 ? "#ff4b6d" : "var(--accent-3)";
    el.meterHypeText.textContent = percent(state.hype);
    if (el.meterTumble && el.meterTumbleText) {
      const tumbleActive = state.tumbleTime > 0 && state.tumbleDuration > 0;
      const tumbleProgress = tumbleActive ? (state.tumbleTime / state.tumbleDuration) * 100 : 0;
      el.meterTumble.style.width = percent(tumbleProgress);
      el.meterTumble.style.backgroundColor = tumbleActive ? "var(--accent-2)" : "rgba(255, 255, 255, 0.22)";
      el.meterTumbleText.textContent = tumbleActive
        ? "x" + Math.max(1, state.tumbleCombo)
        : (state.bestTumble > 1 ? "best x" + state.bestTumble : "ready");
    }
    if (el.meterPeel && el.meterPeelText) {
      const peelProgress = state.maxPeels > 0 ? (state.peelAmmo / state.maxPeels) * 100 : 0;
      el.meterPeel.style.width = percent(peelProgress);
      el.meterPeel.style.backgroundColor = state.peelAmmo > 0 ? "var(--accent-3)" : "#ff4b6d";
      el.meterPeelText.textContent = `${state.peelAmmo}/${state.maxPeels}`;
    }
    updateDawnPerkChip();
    updateBossChip();
    updateGigPanel();
    updateJobPanel();
    updateFavorPanel();
    updateCampUpgradeButtons();
  }

  function showOverlay(title, sub, button, mode = "start") {
    releaseMouseLook();
    clearDawnChoices();
    state.overlayMode = mode;
    if (mode !== "dawn") state.awaitingDawnChoice = false;
    el.overlayTitle.textContent = title;
    el.overlaySub.textContent = sub;
    el.primary.textContent = button;
    if (!state.gameOver) el.overlayScore.textContent = "";
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    clearDawnChoices();
    if (state.overlayMode !== "dawn") state.overlayMode = "none";
    el.overlay.classList.remove("overlay--show");
  }

  function togglePause() {
    if (!state.running || state.gameOver || state.awaitingDawnChoice) return;
    state.paused = !state.paused;
    if (state.paused) {
      showOverlay("PAUSED", "The block is paused. Resume when ready.", "Resume", "pause");
    } else {
      hideOverlay();
      canvas.focus();
    }
  }

  init();
})();
