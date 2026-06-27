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
  const canvasWrap = canvas.closest(".canvas-wrap") || canvas.parentElement;

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
  const WORLD_X = 768;
  const WORLD_Y = 320;
  const WORLD_Z = 768;
  const CHUNK = 16;
  const SEA_LEVEL = 48;
  const LAVA_LEVEL = 22;
  const EDGE_OCEAN = 118;
  const RENDER_RADIUS_CHUNKS = 8;
  const DECOR_RADIUS_CHUNKS = 7;
  const HOTBAR = 9;
  const BAG_SLOTS = 27;
  const MAX_HP = 100;
  // Food buff tuning
  const REGEN_RATE = 5;          // HP per second while regen is active
  const SPEED_BUFF_MULT = 1.4;   // movement multiplier while "speed" is active
  const STRENGTH_BUFF = 5;       // extra attack damage while "strength" is active
  const RESIST_MULT = 0.45;      // damage taken multiplier while "resist" is active
  const EAT_COOLDOWN = 0.55;     // seconds between bites
  const DAMAGE_GRACE = 1.1;
  const SPAWN_GRACE = 4;
  const OCEAN_FATIGUE_LIMIT = 8.5;
  const WATER_MOVE_MULT = 0.55;
  const WATER_GRAVITY_MULT = 0.22;
  const SWIM_UP_SPEED = 4.4;
  const WATER_FLOW_LIMIT = 4;
  const WATER_FLOW_BURST_LIMIT = 1;
  const WATER_FLOW_TICK_SECONDS = 0.12;
  const LAVA_MOVE_MULT = 0.34;
  const LAVA_GRAVITY_MULT = 0.12;
  const LAVA_SWIM_UP_SPEED = 2.2;
  const LAVA_FALL_SPEED = -1.15;
  const LAVA_FLOW_LIMIT = 4;
  const LAVA_FLOW_BURST_LIMIT = 1;
  const LAVA_FLOW_TICK_SECONDS = 0.45;
  const LAVA_LATERAL_RANGE = 3;
  const WATER_LATERAL_RANGE = 5;
  const ACTIVE_FLUID_QUEUE_LIMIT = 600;
  const FLUID_SCAN_MULTIPLIER = 3;
  const FLUID_CHUNK_REBUILDS_PER_FRAME = 2;
  const PLAYER_RADIUS = 0.32;
  const PLAYER_HEIGHT = 1.75;
  const EYE_HEIGHT = 1.55;
  const GRAVITY = 28;
  const MOVE_SPEED = 5.3;
  const SPRINT_SPEED = 7.2;
  const JUMP_SPEED = 8.6;
  const FLY_SPEED = 9.5;          // creative horizontal flight speed
  const FLY_VERTICAL_SPEED = 8.5; // creative ascend/descend speed
  const FLY_TOGGLE_WINDOW = 0.32; // double-tap jump within this to toggle flight
  const REACH = 6.1;
  const DAY_SECONDS = 420;
  const FRIENDLY_COUNT = 58;
  const CAVE_CREATURE_COUNT = 72;
  const FRIENDLY_SPAWN_RING = 12;
  const FRIENDLY_HURT_SECONDS = 0.24;
  const CAVE_CREATURE_HURT_SECONDS = 0.26;
  const CAVE_CREATURE_ATTACK_SECONDS = 0.36;
  const FRIENDLY_HIT_COOLDOWN = 0.5;
  const HELD_SWING_SECONDS = 0.32;
  const HELD_GATHER_SECONDS = 0.24;
  const HELD_TORCH_LIGHT_DISTANCE = 16;
  const TORCH_FIRE_DAMAGE = 3.8;
  const TORCH_BURN_SECONDS = 2.4;
  const TORCH_BURN_DPS = 2.2;
  const MOB_HURT_SECONDS = 0.28;
  const MOB_ATTACK_SECONDS = 0.42;
  const PLAYER_HURT_SECONDS = 0.46;
  const FX_GRAVITY = 10;
  const FISH_COUNT = 86;

  // --- Voxel lighting ---
  // Each cell stores skylight (high nibble) + block light (low nibble) in state.light.
  // Light bakes into vertex colours so caves darken with distance from any opening,
  // while lava, glow features and torches cast a local pool of light.
  const SKY_LIGHT = 15;            // light value of a cell open to the sky
  const CAVE_AMBIENT = 0.045;      // surface multiplier for a pitch-black cave face
  const BLOCK_LIGHT_GAIN = 1.55;   // how strongly block light brightens a surface
  const LIGHT_RADIUS = 15;         // max propagation distance (also relight box half-size)
  const TORCH_LIGHT = 14;          // torches: bright, warm
  const LAVA_LIGHT = 5;            // lava: faint, smouldering glow
  const GLOW_SHROOM_LIGHT = 12;    // glowcap mushrooms
  const CAVE_CRYSTAL_LIGHT = 9;    // crystal clusters
  const LIGHT_Y_STRIDE = WORLD_X * WORLD_Z;

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
  const GLOW_SHROOM = 19;
  const CAVE_CRYSTAL = 20;
  const DRIPSTONE_UP = 21;
  const DRIPSTONE_DOWN = 22;
  const CAVE_VINE = 23;
  // Craftable building blocks
  const STONE_BRICK = 24;
  const GLOWSTONE = 25;
  const SIGMA_LANTERN = 26;
  const CRYSTAL_GLASS = 27;
  const COAL_BLOCK = 28;
  const RIZZ_BLOCK = 29;
  const SIGMA_BLOCK = 30;
  // Base-building furniture
  const CHEST = 31;
  const BED = 32;
  const DOOR = 33;       // closed (solid)
  const DOOR_OPEN = 34;  // open (passable)
  const CHEST_SLOTS = 18;
  // Homestead: furnace + crop farming
  const FURNACE = 35;
  const FARMLAND = 36;
  const CROP_1 = 37;     // wheat seedling
  const CROP_2 = 38;     // wheat growing
  const CROP_3 = 39;     // wheat ripe (harvestable)

  // Light levels for craftable lamps
  const GLOWSTONE_LIGHT = 13;
  const SIGMA_LANTERN_LIGHT = 15;
  const SIGMA_BLOCK_LIGHT = 6;

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
  // Food + ingredients
  const WHEAT = 117;
  const BERRY = 118;
  const BREAD = 119;
  const SHROOM_STEW = 120;
  const SIGMA_BREW = 121;
  const GRIMACE_SHAKE = 122;
  const GOLDEN_APPLE = 123;
  const OHIO_BURGER = 124;
  const COOKED_SHROOM = 125;
  // Extra tools / weapons
  const AXE_STONE = 126;
  const PICK_RIZZ = 127;
  const AXE_RIZZ = 128;
  const SWORD_RIZZ = 129;
  const PICK_SIGMA = 130;
  const AXE_SIGMA = 131;
  // Homestead items
  const CHARCOAL = 132;     // renewable fuel from smelting logs
  const HOE_WOOD = 133;     // tills soil into farmland
  const WHEAT_SEEDS = 134;  // plantable on farmland
  const RAW_MEAT = 135;     // dropped by friendlies
  const COOKED_MEAT = 136;  // smelted raw meat
  // Combat items
  const SKIBIDI_GOO = 137;  // currency dropped by hostiles
  const CURSED_IDOL = 138;  // right-click to summon the boss
  const SIGMA_CROWN = 139;  // boss trophy

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
  def(TORCH, { name: "Rizz Torch", kind: "block", solid: false, hardness: 0.05, drop: TORCH, light: TORCH_LIGHT, color: "#ffd75a", decor: true, placeable: true });
  def(WATER, { name: "Rizzwater", kind: "block", solid: false, hardness: Infinity, drop: null, color: "#2f8fe8", transparent: true, liquid: true });
  def(TALL_GRASS, { name: "Tall Grass", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#48d83e", decor: true });
  def(FLOWER, { name: "Rizz Bloom", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#ff6fa8", decor: true });
  def(SAND, { name: "Ohio Sand", kind: "block", solid: true, hardness: 0.45, color: "#d8c073" });
  def(SNOW, { name: "Powder Snow", kind: "block", solid: true, hardness: 0.28, color: "#e9f6ff" });
  def(LAVA, { name: "Deep Lava", kind: "liquid", solid: false, hardness: Infinity, drop: null, color: "#ff6a1a", transparent: true, liquid: true, light: LAVA_LIGHT });
  def(GLOW_SHROOM, { name: "Glowcap Mushroom", kind: "block", solid: false, hardness: 0.05, drop: GLOW_SHROOM, color: "#65ffd7", decor: true, placeable: true, light: GLOW_SHROOM_LIGHT });
  def(CAVE_CRYSTAL, { name: "Cave Crystal Cluster", kind: "block", solid: false, hardness: 0.18, drop: RIZZ, color: "#58eaff", decor: true, light: CAVE_CRYSTAL_LIGHT });
  def(DRIPSTONE_UP, { name: "Dripstone Fang", kind: "block", solid: false, hardness: 0.22, drop: STONE, color: "#b19b7f", decor: true });
  def(DRIPSTONE_DOWN, { name: "Hanging Dripstone", kind: "block", solid: false, hardness: 0.22, drop: STONE, color: "#b19b7f", decor: true });
  def(CAVE_VINE, { name: "Hanging Cave Vine", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#3cff9e", decor: true });

  def(STONE_BRICK, { name: "Ohio Bricks", kind: "block", solid: true, hardness: 1.4, needTool: "pick", drop: STONE_BRICK, color: "#8a8d99" });
  def(GLOWSTONE, { name: "Rizz Lamp", kind: "block", solid: true, hardness: 0.55, drop: GLOWSTONE, color: "#ffd75a", light: GLOWSTONE_LIGHT });
  def(SIGMA_LANTERN, { name: "Sigma Lantern", kind: "block", solid: true, hardness: 0.6, drop: SIGMA_LANTERN, color: "#7ff2ff", light: SIGMA_LANTERN_LIGHT });
  def(CRYSTAL_GLASS, { name: "Rizz Glass", kind: "block", solid: true, hardness: 0.4, drop: CRYSTAL_GLASS, color: "#bfeaff", transparent: true });
  def(COAL_BLOCK, { name: "Gyatt Coal Block", kind: "block", solid: true, hardness: 1.6, needTool: "pick", drop: COAL_BLOCK, color: "#2a2b36" });
  def(RIZZ_BLOCK, { name: "Rizz Block", kind: "block", solid: true, hardness: 1.5, needTool: "pick", drop: RIZZ_BLOCK, color: "#ffcf3a" });
  def(SIGMA_BLOCK, { name: "Sigma Block", kind: "block", solid: true, hardness: 1.7, needTool: "pick", drop: SIGMA_BLOCK, color: "#4beaff", light: SIGMA_BLOCK_LIGHT });
  def(CHEST, { name: "Rizz Chest", kind: "block", solid: true, hardness: 0.7, best: "axe", drop: CHEST, color: "#9b6532", decor: true, placeable: true });
  def(BED, { name: "Sigma Bed", kind: "block", solid: false, hardness: 0.3, drop: BED, color: "#d94f6a", decor: true, placeable: true });
  def(DOOR, { name: "Toilet Door", kind: "block", solid: true, hardness: 0.6, best: "axe", drop: DOOR, color: "#b98245", decor: true, placeable: true });
  def(DOOR_OPEN, { name: "Toilet Door", kind: "block", solid: false, hardness: 0.6, best: "axe", drop: DOOR, color: "#b98245", decor: true });
  def(FURNACE, { name: "Ohio Furnace", kind: "block", solid: true, hardness: 1.5, needTool: "pick", drop: FURNACE, color: "#6e7078", decor: true, placeable: true });
  def(FARMLAND, { name: "Tilled Soil", kind: "block", solid: true, hardness: 0.5, drop: DIRT, color: "#5a3a1e" });
  def(CROP_1, { name: "Wheat Sprout", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#7bd24a", decor: true });
  def(CROP_2, { name: "Growing Wheat", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#aacb46", decor: true });
  def(CROP_3, { name: "Ripe Wheat", kind: "block", solid: false, hardness: 0.05, drop: null, color: "#e7c65a", decor: true });

  def(STICK, { name: "Ohio Stick", kind: "item", color: "#9a672f" });
  def(COAL, { name: "Gyatt Coal", kind: "item", color: "#252631" });
  def(RIZZ, { name: "Rizz Crystal", kind: "item", color: "#ffcf3a" });
  def(SIGMA, { name: "Sigma Gem", kind: "item", color: "#4beaff" });
  def(PICK_WOOD, { name: "Wood Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 1, mult: 3 }, color: "#b98245" });
  def(PICK_STONE, { name: "Stone Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 2, mult: 5 }, color: "#a6a9b5" });
  def(AXE_WOOD, { name: "Wood Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 1, mult: 3 }, color: "#b98245" });
  def(SWORD_WOOD, { name: "Wood Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 1, damage: 3 }, color: "#b98245" });
  def(SWORD_STONE, { name: "Stone Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 2, damage: 5 }, color: "#a6a9b5" });
  def(SWORD_SIGMA, { name: "Sigma Blade", kind: "item", stack: 1, tool: { type: "sword", tier: 4, damage: 12 }, color: "#4beaff" });
  def(FRIENDLY_FRUIT, { name: "Rizz Fruit", kind: "item", stack: 16, color: "#ff6fa8", food: { heal: 6, msg: "Ate a Rizz Fruit" } });

  // Food ingredients
  def(WHEAT, { name: "Ohio Wheat", kind: "item", stack: 64, color: "#e7c65a" });
  def(BERRY, { name: "Gyatt Berry", kind: "item", stack: 32, color: "#c8324f", food: { heal: 3, msg: "Snacked on Gyatt Berries" } });
  // Cooked / crafted foods
  def(BREAD, { name: "Rizzbread", kind: "item", stack: 16, color: "#d79a4e", food: { heal: 9, msg: "Ate fresh Rizzbread" } });
  def(COOKED_SHROOM, { name: "Toasted Glowcap", kind: "item", stack: 16, color: "#9bf0d4", food: { heal: 6, msg: "Ate a toasted glowcap" } });
  def(OHIO_BURGER, { name: "Ohio Burger", kind: "item", stack: 8, color: "#b8743a", food: { heal: 18, msg: "Demolished an Ohio Burger" } });
  def(SHROOM_STEW, { name: "Glowcap Stew", kind: "item", stack: 8, color: "#64e6b8", food: { heal: 12, effects: { regen: 6 }, msg: "Slurped Glowcap Stew" } });
  def(SIGMA_BREW, { name: "Sigma Energy Drink", kind: "item", stack: 8, color: "#46d6ff", food: { heal: 6, effects: { speed: 22, strength: 16 }, msg: "Chugged a Sigma Energy Drink" } });
  def(GRIMACE_SHAKE, { name: "Grimace Shake", kind: "item", stack: 8, color: "#8a4fd6", food: { heal: 30, msg: "Drank the Grimace Shake (you feel weird)" } });
  def(GOLDEN_APPLE, { name: "Gilded Rizz Apple", kind: "item", stack: 8, color: "#ffd75a", food: { heal: 100, effects: { regen: 8, resist: 14 }, msg: "Bit into a Gilded Rizz Apple" } });

  // Extra tools / weapons
  def(AXE_STONE, { name: "Stone Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 2, mult: 5 }, color: "#a6a9b5" });
  def(PICK_RIZZ, { name: "Rizz Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 3, mult: 7 }, color: "#ffcf3a" });
  def(AXE_RIZZ, { name: "Rizz Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 3, mult: 7 }, color: "#ffcf3a" });
  def(SWORD_RIZZ, { name: "Rizz Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 3, damage: 8 }, color: "#ffcf3a" });
  def(PICK_SIGMA, { name: "Sigma Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 4, mult: 9 }, color: "#4beaff" });
  def(AXE_SIGMA, { name: "Sigma Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 4, mult: 9 }, color: "#4beaff" });

  // Homestead items
  def(CHARCOAL, { name: "Charcoal", kind: "item", stack: 64, color: "#3a3b46" });
  def(HOE_WOOD, { name: "Ohio Hoe", kind: "item", stack: 1, tool: { type: "hoe", tier: 1, mult: 1 }, color: "#b98245" });
  def(WHEAT_SEEDS, { name: "Wheat Seeds", kind: "item", stack: 64, color: "#bcd66a" });
  def(RAW_MEAT, { name: "Raw Drumstick", kind: "item", stack: 16, color: "#e88a86", food: { heal: 2, msg: "Ate it raw (ugh)" } });
  def(COOKED_MEAT, { name: "Skibidi Drumstick", kind: "item", stack: 16, color: "#c4733a", food: { heal: 14, msg: "Ate a Skibidi Drumstick" } });

  // Combat items
  def(SKIBIDI_GOO, { name: "Skibidi Goo", kind: "item", stack: 64, color: "#7fd14a" });
  def(CURSED_IDOL, { name: "Cursed Idol", kind: "item", stack: 4, color: "#8a4fd6" });
  def(SIGMA_CROWN, { name: "Sigma Crown", kind: "item", stack: 8, color: "#ffd75a" });

  // Smelting recipes: input code -> { out, time, count }. Fuel is consumed separately.
  const SMELTING = {
    [SAND]: { out: CRYSTAL_GLASS, time: 2.2 },
    [GLOW_SHROOM]: { out: COOKED_SHROOM, time: 2.5 },
    [RAW_MEAT]: { out: COOKED_MEAT, time: 3.0 },
    [LOG]: { out: CHARCOAL, time: 3.4 },
    [STONE]: { out: STONE_BRICK, time: 2.6 },
    [COAL_ORE]: { out: COAL, time: 2.4 },
  };
  // Fuel item -> seconds of burn it provides.
  const FUELS = {
    [COAL]: 8, [CHARCOAL]: 8, [COAL_BLOCK]: 74, [LOG]: 2.6, [PLANKS]: 1.4, [STICK]: 0.6,
  };

  const RECIPES = [
    // --- Basics (no bench needed) ---
    { cat: "Basics", out: { code: PLANKS, n: 4 }, in: [[LOG, 1]], table: false },
    { cat: "Basics", out: { code: STICK, n: 4 }, in: [[PLANKS, 2]], table: false },
    { cat: "Basics", out: { code: TABLE, n: 1 }, in: [[PLANKS, 4]], table: false },
    { cat: "Basics", out: { code: TORCH, n: 4 }, in: [[COAL, 1], [STICK, 1]], table: false },
    { cat: "Basics", out: { code: TORCH, n: 4 }, in: [[CHARCOAL, 1], [STICK, 1]], table: false },

    // --- Tools & Weapons ---
    { cat: "Tools", out: { code: PICK_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: AXE_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: SWORD_WOOD, n: 1 }, in: [[PLANKS, 2], [STICK, 1]], table: true },
    { cat: "Tools", out: { code: HOE_WOOD, n: 1 }, in: [[PLANKS, 2], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: PICK_STONE, n: 1 }, in: [[STONE, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: AXE_STONE, n: 1 }, in: [[STONE, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: SWORD_STONE, n: 1 }, in: [[STONE, 2], [STICK, 1]], table: true },
    { cat: "Tools", out: { code: PICK_RIZZ, n: 1 }, in: [[RIZZ, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: AXE_RIZZ, n: 1 }, in: [[RIZZ, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: SWORD_RIZZ, n: 1 }, in: [[RIZZ, 2], [STICK, 1]], table: true },
    { cat: "Tools", out: { code: PICK_SIGMA, n: 1 }, in: [[SIGMA, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: AXE_SIGMA, n: 1 }, in: [[SIGMA, 3], [STICK, 2]], table: true },
    { cat: "Tools", out: { code: SWORD_SIGMA, n: 1 }, in: [[SIGMA, 2], [STICK, 1]], table: true },

    // --- Light & Build ---
    { cat: "Light & Build", out: { code: STONE_BRICK, n: 4 }, in: [[STONE, 4]], table: true },
    { cat: "Light & Build", out: { code: GLOWSTONE, n: 2 }, in: [[GLOW_SHROOM, 2], [RIZZ, 1]], table: true },
    { cat: "Light & Build", out: { code: SIGMA_LANTERN, n: 2 }, in: [[SIGMA, 1], [STICK, 2], [COAL, 1]], table: true },
    { cat: "Light & Build", out: { code: COAL_BLOCK, n: 1 }, in: [[COAL, 9]], table: true },
    { cat: "Light & Build", out: { code: RIZZ_BLOCK, n: 1 }, in: [[RIZZ, 9]], table: true },
    { cat: "Light & Build", out: { code: SIGMA_BLOCK, n: 1 }, in: [[SIGMA, 9]], table: true },

    // --- Food (cook at the Crafting Toilet) ---
    { cat: "Food", out: { code: BREAD, n: 1 }, in: [[WHEAT, 3]], table: true },
    { cat: "Food", out: { code: OHIO_BURGER, n: 1 }, in: [[BREAD, 2], [COOKED_MEAT, 1]], table: true },
    { cat: "Food", out: { code: SHROOM_STEW, n: 1 }, in: [[GLOW_SHROOM, 3], [COAL, 1]], table: true },
    { cat: "Food", out: { code: SIGMA_BREW, n: 1 }, in: [[SIGMA, 1], [BERRY, 2]], table: true },
    { cat: "Food", out: { code: GRIMACE_SHAKE, n: 1 }, in: [[BERRY, 4], [RIZZ, 1]], table: true },
    { cat: "Food", out: { code: GOLDEN_APPLE, n: 1 }, in: [[FRIENDLY_FRUIT, 1], [RIZZ, 4]], table: true },

    // --- Home (base-building) ---
    { cat: "Home", out: { code: FURNACE, n: 1 }, in: [[STONE, 8]], table: true },
    { cat: "Home", out: { code: CHEST, n: 1 }, in: [[PLANKS, 6]], table: true },
    { cat: "Home", out: { code: BED, n: 1 }, in: [[PLANKS, 3], [WHEAT, 3]], table: true },
    { cat: "Home", out: { code: DOOR, n: 1 }, in: [[PLANKS, 4]], table: true },

    // --- Combat ---
    { cat: "Combat", out: { code: CURSED_IDOL, n: 1 }, in: [[SKIBIDI_GOO, 12], [SIGMA, 3], [STICK, 2]], table: true },
  ];

  // Objectives that guide players through every system. done(s) reads game state;
  // reward grants score (+ optional items) on completion.
  const ACHIEVEMENTS = [
    { id: "wood", tier: "Start", name: "Timber!", desc: "Punch a tree for a Skibidi Log", icon: "#78502f", score: 20, done: (s) => s.everHad[LOG] },
    { id: "craft", tier: "Start", name: "Handy", desc: "Craft Toilet Planks", icon: "#b98245", score: 20, done: (s) => s.everHad[PLANKS] },
    { id: "bench", tier: "Start", name: "Workshop", desc: "Place a Crafting Toilet", icon: "#d7e1e8", score: 40, done: (s) => s.flags.placedTable },
    { id: "pick", tier: "Start", name: "Toolsmith", desc: "Craft any pickaxe", icon: "#a6a9b5", score: 40, item: [TORCH, 8], done: (s) => hasToolType("pick") },
    { id: "light", tier: "Start", name: "Let There Be Light", desc: "Place a torch or lamp", icon: "#ffd75a", score: 30, done: (s) => s.flags.placedLight },
    { id: "miner", tier: "Mine", name: "Miner 49er", desc: "Mine 100 blocks", icon: "#868894", score: 60, done: (s) => s.mined >= 100 },
    { id: "rizz", tier: "Mine", name: "Rizz Rush", desc: "Collect a Rizz Crystal", icon: "#ffcf3a", score: 40, done: (s) => s.everHad[RIZZ] },
    { id: "sigma", tier: "Mine", name: "Sigma Grindset", desc: "Collect a Sigma Gem", icon: "#4beaff", score: 70, done: (s) => s.everHad[SIGMA] },
    { id: "home", tier: "Build", name: "Home Sweet Home", desc: "Place a Rizz Chest", icon: "#9b6532", score: 50, done: (s) => s.flags.placedChest },
    { id: "sleep", tier: "Build", name: "Sweet Dreams", desc: "Sleep in a Sigma Bed", icon: "#d94f6a", score: 40, done: (s) => s.flags.slept },
    { id: "farm", tier: "Build", name: "Green Thumb", desc: "Harvest ripe Wheat", icon: "#e7c65a", score: 50, done: (s) => s.counters.crops >= 1 },
    { id: "smelt", tier: "Build", name: "Master Chef", desc: "Smelt something in a furnace", icon: "#6e7078", score: 50, done: (s) => s.counters.smelts >= 1 },
    { id: "eat", tier: "Survive", name: "Gourmand", desc: "Eat 10 helpings of food", icon: "#9be870", score: 50, done: (s) => s.counters.eaten >= 10 },
    { id: "hunter", tier: "Survive", name: "Monster Hunter", desc: "Defeat 25 night mobs", icon: "#b8233a", score: 80, item: [COOKED_MEAT, 3], done: (s) => s.counters.mobKills >= 25 },
    { id: "survive", tier: "Survive", name: "Survivor", desc: "Reach Day 5", icon: "#53cfff", score: 80, done: (s) => s.day >= 5 },
    { id: "loot", tier: "Explore", name: "Treasure Hunter", desc: "Loot a hidden chest", icon: "#caa24a", score: 70, done: (s) => s.counters.looted >= 1 },
    { id: "blade", tier: "Endgame", name: "Sigma Blade", desc: "Forge the Sigma Blade", icon: "#4beaff", score: 200, done: (s) => s.sigmaForged || s.everHad[SWORD_SIGMA] },
    { id: "boss", tier: "Endgame", name: "Titan Slayer", desc: "Defeat the Skibidi Titan", icon: "#8a4fd6", score: 500, item: [SIGMA_LANTERN, 2], done: (s) => s.counters.bossKills >= 1 },
  ];

  const BIOMES = [
    { id: 0, name: "Meadow", grass: "#34d63b", side: "#7d5a34", leaf: "#21b83a", tree: 0.12, treeSpacing: 12, flora: 0.18, flowers: 0.32, floraStyle: "clover", palette: ["#ff6fa8", "#ffe45c", "#e8fff3"] },
    { id: 1, name: "Open Forest", grass: "#1fb83a", side: "#6f5231", leaf: "#147f2f", tree: 0.62, treeSpacing: 10, flora: 0.13, flowers: 0.12, floraStyle: "fern", treeStyle: "oak", palette: ["#ff85bd", "#f5d85a"] },
    { id: 2, name: "Highland", grass: "#84c937", side: "#75613a", leaf: "#65b936", tree: 0.16, treeSpacing: 13, flora: 0.12, flowers: 0.14, floraStyle: "alpine", palette: ["#fff0a6", "#ccefff"] },
    { id: 3, name: "Marsh", grass: "#36ca6f", side: "#5f5134", leaf: "#27b05f", tree: 0.18, treeSpacing: 12, flora: 0.25, flowers: 0.22, floraStyle: "reeds", treeStyle: "willow", palette: ["#d6f7a6", "#b4f0ff"] },
    { id: 4, name: "Neon Grove", grass: "#25ee9a", side: "#4d6541", leaf: "#16eeb1", tree: 0.30, treeSpacing: 11, flora: 0.27, flowers: 0.42, floraStyle: "neon", treeStyle: "oak", palette: ["#43e6ff", "#ff4fd8", "#faff6a"] },
    { id: 5, name: "Prairie", grass: "#9ed647", side: "#8b7339", leaf: "#85bd3a", tree: 0.05, treeSpacing: 16, flora: 0.28, flowers: 0.34, floraStyle: "wheat", palette: ["#ffe45c", "#ffffff", "#ff9b5c"] },
    { id: 6, name: "Crystal Ridge", grass: "#5fd9ea", side: "#677f83", leaf: "#76f6ff", tree: 0.10, treeSpacing: 15, flora: 0.14, flowers: 0.30, floraStyle: "crystal", treeStyle: "crystal", palette: ["#8af7ff", "#d9fffb"] },
    { id: 7, name: "Ash Flats", grass: "#9dab88", side: "#6d6259", leaf: "#819f72", tree: 0.03, treeSpacing: 18, flora: 0.12, flowers: 0.08, floraStyle: "ash", palette: ["#c8b6a6", "#e7ddc8"] },
    { id: 8, name: "Pine Barrens", grass: "#38a94d", side: "#654b33", leaf: "#157c38", tree: 0.56, treeSpacing: 11, flora: 0.12, flowers: 0.08, floraStyle: "sapling", treeStyle: "pine", palette: ["#c9ffe0", "#fff1a8"] },
    { id: 9, name: "Birch Glade", grass: "#80e869", side: "#795d36", leaf: "#76d85c", tree: 0.28, treeSpacing: 12, flora: 0.20, flowers: 0.38, floraStyle: "daisy", treeStyle: "birch", palette: ["#ffffff", "#ffd1eb", "#ffe45c"] },
    { id: 10, name: "Sun-Baked Dunes", grass: "#d9c85e", side: "#b18a48", leaf: "#c3c64d", tree: 0.02, treeSpacing: 18, flora: 0.10, flowers: 0.05, floraStyle: "cactus", surface: "sand", palette: ["#fff0a0", "#f7a85a"] },
    { id: 11, name: "Frost Peaks", grass: "#e6fbff", side: "#91a7af", leaf: "#d7fbff", tree: 0.10, treeSpacing: 16, flora: 0.11, flowers: 0.12, floraStyle: "frost", surface: "snow", treeStyle: "pine", palette: ["#dfffff", "#bfe8ff"] },
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
  const fishGroup = new THREE.Group();
  const mobGroup = new THREE.Group();
  const caveCreatureGroup = new THREE.Group();
  const friendlyGroup = new THREE.Group();
  const effectGroup = new THREE.Group();
  const cloudGroup = new THREE.Group();
  scene.add(worldGroup, waterGroup, lavaGroup, decorGroup, fishGroup, friendlyGroup, mobGroup, caveCreatureGroup, effectGroup, cloudGroup);

  const ambient = new THREE.HemisphereLight(0xd9fbff, 0x3b2b22, 0.98);
  const sun = new THREE.DirectionalLight(0xfff7df, 1.26);
  sun.position.set(36, 70, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  // Bias keeps the low-res shadow map from self-shadowing flat surfaces (snow/water/
  // sand) into a dithered mess of dark speckles.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
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
  const waterTexture = buildWaterTexture();
  const blockMaterial = new THREE.MeshLambertMaterial({ map: blockTexture, vertexColors: true, side: THREE.DoubleSide });
  const plantMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, alphaTest: 0.2 });
  // Water is shaded purely from vertex colours (the ripple in faceColor) plus a phong
  // specular highlight. It deliberately has no texture map: the chunk mesher assigns
  // atlas UVs, so a standalone water texture sampled a tiny garbage sub-rect and looked
  // glitchy. A clean translucent gradient reads far better.
  const waterMaterial = new THREE.MeshPhongMaterial({
    color: 0x4fc1ff,
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    shininess: 60,
    specular: 0xa8eeff,
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
    lime: new THREE.MeshLambertMaterial({ color: 0xb7ff56 }),
    amber: new THREE.MeshLambertMaterial({ color: 0xffc34f }),
  };
  const caveMaterials = {
    glow: new THREE.MeshBasicMaterial({ color: 0x65ffd7 }),
    glowBlue: new THREE.MeshBasicMaterial({ color: 0x58eaff }),
    glowPink: new THREE.MeshBasicMaterial({ color: 0xff6fd6 }),
    stone: new THREE.MeshLambertMaterial({ color: 0x8d8790 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x151826 }),
    mite: new THREE.MeshLambertMaterial({ color: 0xcda66b }),
    crawler: new THREE.MeshLambertMaterial({ color: 0x34403d }),
    crystal: new THREE.MeshLambertMaterial({ color: 0x7defff }),
    vine: new THREE.MeshLambertMaterial({ color: 0x3cff9e }),
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
  const fishMaterials = [
    new THREE.MeshLambertMaterial({ color: 0xffbd3f }),
    new THREE.MeshLambertMaterial({ color: 0x43e6ff }),
    new THREE.MeshLambertMaterial({ color: 0xff6fa8 }),
    new THREE.MeshLambertMaterial({ color: 0xe8fff3 }),
  ];

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const sfx = {
    ctx: null,
    master: null,
    noise: null,
    last: Object.create(null),
    primed: false,
  };
  const SFX_COOLDOWNS = {
    mineSwing: 0.11,
    swing: 0.12,
    hitMob: 0.06,
    hurt: 0.2,
    select: 0.04,
    place: 0.06,
    break: 0.08,
    eat: 0.12,
  };

  function getSfxContext() {
    if (!AudioContextCtor) return null;
    if (!sfx.ctx) {
      try {
        sfx.ctx = new AudioContextCtor();
        sfx.master = sfx.ctx.createGain();
        sfx.master.gain.value = 0.18;
        sfx.master.connect(sfx.ctx.destination);
      } catch (error) {
        sfx.ctx = null;
        sfx.master = null;
        return null;
      }
    }
    if (sfx.ctx.state === "suspended") {
      const resume = sfx.ctx.resume();
      if (resume && resume.catch) resume.catch(() => {});
    }
    return sfx.ctx;
  }

  function primeAudio() {
    const ctx = getSfxContext();
    if (!ctx || !sfx.master || sfx.primed) return;
    sfx.primed = true;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.setValueAtTime(0.0001, t + 0.02);
    gain.connect(sfx.master);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  function sfxGain(ctx, t, volume, duration, attack = 0.006) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, duration));
    gain.connect(sfx.master);
    return gain;
  }

  function tone(ctx, t, freq, duration, volume = 0.28, type = "triangle", endFreq = freq) {
    const osc = ctx.createOscillator();
    const gain = sfxGain(ctx, t, volume, duration);
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  function noiseBuffer(ctx) {
    if (sfx.noise && sfx.noise.sampleRate === ctx.sampleRate) return sfx.noise;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length * 0.22);
    }
    sfx.noise = buffer;
    return buffer;
  }

  function noise(ctx, t, duration, volume = 0.2, frequency = 800, filterType = "bandpass") {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = sfxGain(ctx, t, volume, duration, 0.003);
    src.buffer = noiseBuffer(ctx);
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.55), t + duration);
    src.connect(filter);
    filter.connect(gain);
    src.start(t, Math.random() * 0.45, duration);
  }

  function arpeggio(ctx, t, notes, step = 0.055, volume = 0.2) {
    notes.forEach((freq, i) => tone(ctx, t + i * step, freq, 0.095, volume, "triangle", freq * 1.012));
  }

  function playSfx(name, options = {}) {
    const ctx = getSfxContext();
    if (!ctx || !sfx.master) return;
    const nowMs = performance.now();
    const key = options.key || name;
    const cooldown = options.cooldown == null ? (SFX_COOLDOWNS[key] || SFX_COOLDOWNS[name] || 0.035) : options.cooldown;
    if (sfx.last[key] && nowMs - sfx.last[key] < cooldown * 1000) return;
    sfx.last[key] = nowMs;
    const t = ctx.currentTime + 0.004;
    const pitch = options.pitch || 1;
    const volume = options.volume || 1;

    if (name === "mineSwing") {
      noise(ctx, t, 0.075, 0.1 * volume, 520 * pitch, "bandpass");
      tone(ctx, t, 135 * pitch, 0.065, 0.055 * volume, "sine", 92 * pitch);
    } else if (name === "swing") {
      noise(ctx, t, 0.11, 0.16 * volume, 980 * pitch, "highpass");
      tone(ctx, t, 210 * pitch, 0.08, 0.08 * volume, "triangle", 120 * pitch);
    } else if (name === "hitMob") {
      noise(ctx, t, 0.09, 0.2 * volume, 340 * pitch, "lowpass");
      tone(ctx, t, 155 * pitch, 0.095, 0.13 * volume, "square", 85 * pitch);
    } else if (name === "hitSoft") {
      noise(ctx, t, 0.07, 0.12 * volume, 480 * pitch, "bandpass");
      tone(ctx, t, 230 * pitch, 0.07, 0.07 * volume, "sine", 170 * pitch);
    } else if (name === "mobDown") {
      tone(ctx, t, 260 * pitch, 0.12, 0.11 * volume, "triangle", 92 * pitch);
      noise(ctx, t + 0.02, 0.16, 0.11 * volume, 260, "lowpass");
    } else if (name === "hurt") {
      noise(ctx, t, 0.13, 0.24 * volume, 220, "lowpass");
      tone(ctx, t, 140, 0.16, 0.18 * volume, "sawtooth", 62);
    } else if (name === "death") {
      arpeggio(ctx, t, [220, 165, 110, 72], 0.075, 0.14 * volume);
      noise(ctx, t + 0.16, 0.22, 0.18 * volume, 150, "lowpass");
    } else if (name === "eat") {
      noise(ctx, t, 0.045, 0.2 * volume, 1500, "bandpass");
      noise(ctx, t + 0.065, 0.05, 0.16 * volume, 1150, "bandpass");
      tone(ctx, t + 0.08, 360, 0.08, 0.055 * volume, "sine", 430);
    } else if (name === "buff") {
      arpeggio(ctx, t, [520, 780, 1040], 0.045, 0.13 * volume);
    } else if (name === "craft") {
      noise(ctx, t, 0.09, 0.1 * volume, 1200, "bandpass");
      arpeggio(ctx, t + 0.01, [392, 588, 784], 0.045, 0.16 * volume);
    } else if (name === "sigmaCraft") {
      arpeggio(ctx, t, [440, 660, 880, 1320], 0.05, 0.17 * volume);
      tone(ctx, t + 0.18, 1760, 0.18, 0.1 * volume, "sine", 2200);
    } else if (name === "craftOpen") {
      tone(ctx, t, 360, 0.08, 0.1 * volume, "triangle", 520);
      noise(ctx, t, 0.08, 0.05 * volume, 700, "bandpass");
    } else if (name === "craftClose") {
      tone(ctx, t, 430, 0.07, 0.085 * volume, "triangle", 250);
    } else if (name === "place") {
      noise(ctx, t, 0.07, 0.12 * volume, (options.freq || 360) * pitch, "lowpass");
      tone(ctx, t, (options.thump || 110) * pitch, 0.075, 0.075 * volume, "sine", 78 * pitch);
    } else if (name === "break") {
      noise(ctx, t, options.duration || 0.12, (options.noise || 0.2) * volume, (options.freq || 620) * pitch, options.filter || "bandpass");
      tone(ctx, t + 0.01, (options.thump || 150) * pitch, 0.1, (options.tone || 0.08) * volume, options.wave || "triangle", (options.end || 90) * pitch);
    } else if (name === "select") {
      tone(ctx, t, 520, 0.035, 0.07 * volume, "square", 650);
    } else if (name === "bagOpen") {
      arpeggio(ctx, t, [320, 420], 0.04, 0.09 * volume);
    } else if (name === "bagClose") {
      arpeggio(ctx, t, [420, 280], 0.04, 0.08 * volume);
    } else if (name === "pause") {
      tone(ctx, t, 260, 0.08, 0.095 * volume, "triangle", 190);
    } else if (name === "resume") {
      tone(ctx, t, 260, 0.08, 0.095 * volume, "triangle", 390);
    } else if (name === "flight") {
      tone(ctx, t, options.on ? 420 : 720, 0.16, 0.12 * volume, "sine", options.on ? 880 : 280);
    } else if (name === "reward") {
      arpeggio(ctx, t, [523, 784, 1046], 0.055, 0.15 * volume);
    } else if (name === "spawn") {
      arpeggio(ctx, t, [196, 294, 392, 588], 0.05, 0.11 * volume);
      noise(ctx, t + 0.02, 0.18, 0.055 * volume, 900, "bandpass");
    } else if (name === "nightfall") {
      tone(ctx, t, 360, 0.18, 0.1 * volume, "sine", 180);
      tone(ctx, t + 0.1, 146, 0.28, 0.12 * volume, "triangle", 98);
    } else if (name === "daybreak") {
      arpeggio(ctx, t, [330, 495, 660, 990], 0.075, 0.12 * volume);
    }
  }

  function blockSoundKind(code) {
    if (code === LOG || code === PLANKS || code === TABLE) return "wood";
    if (code === DIRT || code === SAND || code === SNOW || code === GRASS) return "dirt";
    if (code === LEAVES || code === TALL_GRASS || code === FLOWER || code === CAVE_VINE) return "leaf";
    if (code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE || code === RIZZ_BLOCK || code === SIGMA_BLOCK || code === CAVE_CRYSTAL) return "ore";
    if (code === TORCH || code === GLOW_SHROOM || code === GLOWSTONE || code === SIGMA_LANTERN || code === CRYSTAL_GLASS) return "glow";
    return "stone";
  }

  function playBreakSfx(code) {
    const kind = blockSoundKind(code);
    if (kind === "wood") playSfx("break", { key: "break", freq: 430, thump: 165, end: 86, noise: 0.18, tone: 0.09, filter: "bandpass" });
    else if (kind === "dirt") playSfx("break", { key: "break", freq: 230, thump: 105, end: 70, noise: 0.19, tone: 0.05, filter: "lowpass" });
    else if (kind === "leaf") playSfx("break", { key: "break", freq: 1280, thump: 240, end: 180, noise: 0.13, tone: 0.04, duration: 0.08, filter: "highpass" });
    else if (kind === "ore") playSfx("break", { key: "break", freq: 1180, thump: 220, end: 140, noise: 0.16, tone: 0.12, wave: "square" });
    else if (kind === "glow") playSfx("break", { key: "break", freq: 1600, thump: 420, end: 260, noise: 0.12, tone: 0.1, filter: "bandpass" });
    else playSfx("break", { key: "break", freq: 660, thump: 145, end: 80, noise: 0.22, tone: 0.07, filter: "bandpass" });
  }

  function playPlaceSfx(code) {
    const kind = blockSoundKind(code);
    const freq = kind === "wood" ? 420 : kind === "dirt" ? 210 : kind === "glow" ? 900 : kind === "leaf" ? 1200 : 340;
    const thump = kind === "glow" ? 180 : kind === "leaf" ? 210 : kind === "dirt" ? 86 : 115;
    playSfx("place", { freq, thump, pitch: kind === "ore" ? 1.18 : 1 });
  }

  const selectionBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxBufferGeometry(1.03, 1.03, 1.03)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  selectionBox.visible = false;
  scene.add(selectionBox);

  const heldGroup = new THREE.Group();
  camera.add(heldGroup);
  const heldTorchLight = new THREE.PointLight(0xffa23a, 0, HELD_TORCH_LIGHT_DISTANCE, 2.15);
  heldTorchLight.position.set(0.33, -0.08, -0.82);
  camera.add(heldTorchLight);
  scene.add(camera);

  const TARGET_HOLD_FRAMES = 1;
  let targetHoldFrames = 0;

  const state = {
    started: false,
    paused: false,
    crafting: false,
    world: new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z),
    baseWorld: new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z),
    light: new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z),
    surface: new Int16Array(WORLD_X * WORLD_Z),
    skyHeight: new Int16Array(WORLD_X * WORLD_Z),
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
    caveCreatures: [],
    friendlies: [],
    fish: [],
    activeWater: [],
    activeLava: [],
    waterFlowTimer: 0,
    lavaFlowTimer: 0,
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
    creative: false,
    flying: false,          // creative-only free flight
    survivalBackup: null,   // inventory snapshot taken when entering creative
    effects: { regen: 0, speed: 0, strength: 0, resist: 0 },
    toiletFacing: {}, // "x,y,z" -> quarter-turns (0-3) so furniture faces the placer
    chests: {},       // "x,y,z" -> array of CHEST_SLOTS item slots
    openChest: null,  // key of the chest currently open
    bedSpawn: null,   // {x,y,z} respawn point set by sleeping in a bed
    furnaces: {},     // "x,y,z" -> { input, fuel, output, cook, burn, burnMax }
    openFurnace: null,// key of the furnace currently open
    cropTick: 0,      // accumulator for the crop-growth tick
    achievements: {}, // id -> true once earned
    counters: { mobKills: 0, bossKills: 0, crops: 0, smelts: 0, looted: 0, eaten: 0, placed: 0 },
    everHad: {},      // item/block code -> true once obtained
    flags: {},        // one-off action flags (placedTable, slept, ...)
    goalsOpen: false,
    achvTick: 0,
  };

  const legacySaveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: SAVE_VERSION });
  const WORLD_INDEX_KEY = "rainbot_rizz_craft_worlds:v1";
  const WORLD_SAVE_PREFIX = "rainbot_rizz_craft_world:";
  const MAX_WORLDS = 12;
  const touchControlsQuery = window.matchMedia ? window.matchMedia("(hover: none) and (pointer: coarse)") : null;

  const ui = buildHud();
  const overlay = document.getElementById("overlay");
  const worldPanel = document.getElementById("world-panel");
  const worldLoading = document.getElementById("world-loading");
  const worldLoadingText = document.getElementById("world-loading-text");
  const craftPanel = document.getElementById("craft-panel");
  const craftList = document.getElementById("craft-list");
  const craftTabs = document.getElementById("craft-tabs");
  const craftStatus = document.getElementById("craft-status");
  let currentWorldId = "";
  let currentWorldName = "";
  let currentWorldSeed = 0;
  let worldAutosaveTimer = 0;
  let worldLoadingActive = false;
  let craftFilter = "All";
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
  let activeWaterHead = 0;
  let activeLavaHead = 0;
  let wasNight = false;
  const activeWaterKeys = new Set();
  const activeLavaKeys = new Set();
  const pendingFluidChunks = new Set();
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
  const touchMoveHeld = { forward: false, back: false, left: false, right: false };
  const touchLook = { pointerId: null, x: 0, y: 0 };
  let suppressMouseUntil = 0;
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

  function buildWaterTexture() {
    const size = 64;
    const texCanvas = document.createElement("canvas");
    texCanvas.width = size;
    texCanvas.height = size;
    const ctx = texCanvas.getContext("2d");
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const waveA = Math.sin(x * 0.16 + y * 0.06);
        const waveB = Math.sin(x * 0.05 - y * 0.18 + 1.7);
        const noise = hash32(x * 37 + y * 101 + 991) / 4294967295;
        const foam = 0.62 + waveA * 0.22 + waveB * 0.16 + (noise - 0.5) * 0.12;
        const i = (y * size + x) * 4;
        image.data[i] = 28 + Math.floor(clamp(foam, 0, 1) * 24);
        image.data[i + 1] = 128 + Math.floor(clamp(foam, 0, 1) * 42);
        image.data[i + 2] = 196 + Math.floor(clamp(foam, 0, 1) * 34);
        image.data[i + 3] = 232;
      }
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "rgba(195,245,255,0.28)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const y = 8 + i * 12 + (i % 2 ? 2 : -1);
      for (let x = -4; x <= size + 4; x += 4) {
        const yy = y + Math.sin((x + i * 11) * 0.12) * 1.4;
        if (x === -4) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(texCanvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.05, 1.05);
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
  function refreshTouchMovement() {
    moveSources.touch.forward = (touchMoveHeld.forward ? 1 : 0) - (touchMoveHeld.back ? 1 : 0);
    moveSources.touch.right = (touchMoveHeld.right ? 1 : 0) - (touchMoveHeld.left ? 1 : 0);
    applyDirectionalInput();
  }
  function setTouchMove(direction, down) {
    if (!Object.prototype.hasOwnProperty.call(touchMoveHeld, direction)) return;
    touchMoveHeld[direction] = down;
    refreshTouchMovement();
  }
  function canUseMobileAction() {
    return state.started && !state.paused && !state.crafting && !state.bagOpen;
  }
  function shouldShowTouchControls() {
    return !!(touchControlsQuery && touchControlsQuery.matches);
  }
  function setTouchControlsVisible(on) {
    if (canvasWrap) canvasWrap.classList.toggle("has-touch-controls", !!on);
    if (ui && ui.mobileControls) ui.mobileControls.setAttribute("aria-hidden", on ? "false" : "true");
  }
  function updateMobileControlState() {
    if (!ui || !ui.mobileControls) return;
    const playable = canUseMobileAction();
    const flying = state.creative && state.flying;
    ui.mobileControls.classList.toggle("is-playable", playable);
    ui.mobileControls.classList.toggle("is-creative", state.creative);
    ui.mobileControls.classList.toggle("is-flying", flying);
    const selected = selectedSlot();
    const placeButton = ui.mobileControls.querySelector('[data-mobile-action="place"]');
    if (placeButton) {
      const label = isFood(selected && selected.code) ? "Eat" : selected && isPlaceable(selected.code) ? "Place" : "Use";
      placeButton.textContent = label;
      placeButton.setAttribute("aria-label", `${label} selected item`);
    }
    const jumpButton = ui.mobileControls.querySelector('[data-mobile-action="jump"]');
    if (jumpButton) {
      jumpButton.textContent = flying ? "Up" : "Jump";
      jumpButton.setAttribute("aria-label", flying ? "Fly up" : "Jump");
    }
    const sprintButton = ui.mobileControls.querySelector('[data-mobile-action="sprint"]');
    if (sprintButton) {
      sprintButton.textContent = flying ? "Down" : "Run";
      sprintButton.setAttribute("aria-label", flying ? "Fly down" : "Run");
    }
    const flyButton = ui.mobileControls.querySelector('[data-mobile-action="fly"]');
    if (flyButton) {
      flyButton.disabled = !state.creative;
      flyButton.textContent = flying ? "Land" : "Fly";
      flyButton.classList.toggle("is-active", flying);
      flyButton.setAttribute("aria-label", flying ? "Turn flight off" : "Turn flight on");
    }
  }
  function setMobileMine(down) {
    if (!down) {
      state.input.mine = false;
      return;
    }
    if (!canUseMobileAction()) return;
    state.input.mine = true;
    triggerHeldSwing(selectedIsTorch() ? "attack" : "gather");
  }
  function queueMobilePlace() {
    if (!canUseMobileAction()) return;
    state.input.place = true;
    state.placeQueued = true;
  }
  function creativeItemCodes() {
    return Object.keys(DEF).map(Number).filter((code) => {
      const d = DEF[code];
      return d && code > AIR && (isPlaceable(code) || d.kind === "tool");
    });
  }
  function creativeStack(code) {
    return { code, n: Math.max(1, maxStack(code)) };
  }
  function applyCreativeLoadout() {
    const codes = creativeItemCodes();
    const blocks = codes.filter((code) => isPlaceable(code));
    const tools = codes.filter((code) => !isPlaceable(code));
    const ordered = blocks.concat(tools);
    state.hotbar = ordered.slice(0, HOTBAR).map(creativeStack);
    state.bag = ordered.slice(HOTBAR, HOTBAR + BAG_SLOTS).map(creativeStack);
    while (state.hotbar.length < HOTBAR) state.hotbar.push(null);
    while (state.bag.length < BAG_SLOTS) state.bag.push(null);
  }
  function refillCreativeInventory() {
    if (!state.creative) return;
    state.player.hp = MAX_HP;
    state.hotbar.forEach((slot) => { if (slot) slot.n = Math.max(1, maxStack(slot.code)); });
    state.bag.forEach((slot) => { if (slot) slot.n = Math.max(1, maxStack(slot.code)); });
  }
  function cloneSlots(slots) { return slots.map((slot) => (slot ? { ...slot } : null)); }
  function toggleCreativeMode(force) {
    const next = typeof force === "boolean" ? force : !state.creative;
    if (next === state.creative) return;
    if (next) {
      // Entering creative: stash the survival inventory so it can be handed back.
      state.survivalBackup = {
        hotbar: cloneSlots(state.hotbar),
        bag: cloneSlots(state.bag),
        selected: state.selected,
      };
      state.creative = true;
      applyCreativeLoadout();
    } else {
      // Leaving creative: restore exactly what the player had, and stop flying.
      state.creative = false;
      state.flying = false;
      if (state.survivalBackup) {
        state.hotbar = cloneSlots(state.survivalBackup.hotbar).slice(0, HOTBAR);
        state.bag = cloneSlots(state.survivalBackup.bag).slice(0, BAG_SLOTS);
        while (state.hotbar.length < HOTBAR) state.hotbar.push(null);
        while (state.bag.length < BAG_SLOTS) state.bag.push(null);
        state.selected = clamp(Number(state.survivalBackup.selected) || 0, 0, HOTBAR - 1);
        state.survivalBackup = null;
      }
      ensureStarterPick(false);
    }
    heldRenderCode = null;
    bagRenderKey = null;
    updateCreativeButtons();
    updateHud();
    playSfx(next ? "spawn" : "bagClose", { volume: 0.85 });
    api.toast(next ? "Creative mode on: fly (double-jump), unlimited blocks, no damage" : "Survival mode on - inventory restored", next ? "good" : "");
  }
  function updateCreativeButtons() {
    const button = document.getElementById("btn-creative");
    if (button) {
      button.textContent = state.creative ? "Creative: On" : "Creative: Off";
      button.classList.toggle("is-active", state.creative);
    }
    if (ui && ui.mobileControls) {
      ui.mobileControls.querySelectorAll('[data-mobile-action="creative"]').forEach((el) => {
        el.classList.toggle("is-active", state.creative);
      });
    }
    updateMobileControlState();
  }
  function clearDirectionalInput() {
    keyMove.forward = false;
    keyMove.back = false;
    keyMove.left = false;
    keyMove.right = false;
    touchMoveHeld.forward = false;
    touchMoveHeld.back = false;
    touchMoveHeld.left = false;
    touchMoveHeld.right = false;
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
  let lastJumpTap = 0;
  function setFlying(on) {
    on = !!on && state.creative;
    if (on === state.flying) return;
    state.flying = on;
    state.player.vy = 0;
    playSfx("flight", { on, volume: 0.9 });
    api.toast(on ? "Flight ON — Space ascend, Shift descend" : "Flight OFF", on ? "good" : "");
    updateHud();
  }
  // Double-tap Space (creative only) toggles free flight. Called on the *initial*
  // jump press, never on key autorepeat.
  function handleJumpTap() {
    if (!state.creative) return;
    const now = performance.now() / 1000;
    if (now - lastJumpTap < FLY_TOGGLE_WINDOW) {
      setFlying(!state.flying);
      lastJumpTap = 0;
    } else {
      lastJumpTap = now;
    }
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function index(x, y, z) { return (y * WORLD_Z + z) * WORLD_X + x; }
  function surfaceIndex(x, z) { return z * WORLD_X + x; }
  function inWorld(x, y, z) { return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z; }
  function isPlaceable(code) {
    const d = DEF[code];
    if (!d || code <= AIR || d.kind !== "block" || code === WATER) return false;
    if (d.placeable) return true;
    return !isReplaceableDecor(code);
  }
  function maxStack(code) { return (DEF[code] && DEF[code].stack) || 99; }
  function isReplaceableDecor(code) {
    const d = DEF[code];
    return !!(d && d.decor && !d.solid);
  }
  function canWaterFill(code) {
    return code === AIR || isReplaceableDecor(code);
  }
  function canLavaFill(code) {
    return code === AIR || isReplaceableDecor(code) || code === WATER;
  }
  function fluidKey(x, y, z) {
    return `${x | 0},${y | 0},${z | 0}`;
  }
  function resetActiveFluids() {
    state.activeWater.length = 0;
    state.activeLava.length = 0;
    activeWaterKeys.clear();
    activeLavaKeys.clear();
    activeWaterHead = 0;
    activeLavaHead = 0;
    pendingFluidChunks.clear();
    state.waterFlowTimer = 0;
    state.lavaFlowTimer = 0;
  }
  function trimActiveFluidQueue(code) {
    if (code === WATER && activeWaterHead > 256) {
      state.activeWater = state.activeWater.slice(activeWaterHead);
      activeWaterHead = 0;
    } else if (code === LAVA && activeLavaHead > 256) {
      state.activeLava = state.activeLava.slice(activeLavaHead);
      activeLavaHead = 0;
    }
  }
  function queueActiveFluid(code, x, y, z, flow = 0, ambient = false, falling = false) {
    x |= 0; y |= 0; z |= 0;
    if (!inWorld(x, y, z)) return false;
    trimActiveFluidQueue(code);
    const isWater = code === WATER;
    const queue = isWater ? state.activeWater : state.activeLava;
    const keys = isWater ? activeWaterKeys : activeLavaKeys;
    const head = isWater ? activeWaterHead : activeLavaHead;
    if (queue.length - head >= ACTIVE_FLUID_QUEUE_LIMIT) return false;
    const key = fluidKey(x, y, z);
    if (keys.has(key)) return false;
    keys.add(key);
    queue.push({ x, y, z, flow, ambient: !!ambient, falling: !!falling });
    return true;
  }
  function waterIsFallingAt(x, y, z) {
    const below = getBlock(x, y - 1, z);
    if (canWaterFill(below)) return true;
    if (below !== WATER) return false;
    const lower = getBlock(x, y - 2, z);
    return canWaterFill(lower);
  }
  function queueFluidNeighborhood(x, y, z) {
    let queued = 0;
    const dirs = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const dir of dirs) {
      const sx = x + dir[0];
      const sy = y + dir[1];
      const sz = z + dir[2];
      const code = getBlock(sx, sy, sz);
      if (code === WATER && queueActiveFluid(WATER, sx, sy, sz, 0, false, waterIsFallingAt(sx, sy, sz))) queued++;
      else if (code === LAVA && queueActiveFluid(LAVA, sx, sy, sz, 0)) queued++;
    }
    return queued;
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
    setWorldLoading(false);
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
  function setWorldLoading(on, message = "Loading world...") {
    worldLoadingActive = !!on;
    if (overlay) overlay.classList.toggle("is-loading", worldLoadingActive);
    if (worldLoading) {
      worldLoading.hidden = !worldLoadingActive;
      worldLoading.setAttribute("aria-busy", worldLoadingActive ? "true" : "false");
    }
    if (worldLoadingText) worldLoadingText.textContent = message;
    const primary = document.getElementById("btn-primary");
    if (primary) primary.disabled = worldLoadingActive;
  }
  function waitForWorldLoadingPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }
  async function createWorld(nameValue = "", seedValue = "") {
    if (worldLoadingActive) return;
    const seed = seedFromInput(seedValue);
    const name = cleanWorldName(nameValue);
    const id = worldId(seed);
    setWorldLoading(true, `Generating ${name}...`);
    await waitForWorldLoadingPaint();
    try {
      currentWorldId = id;
      currentWorldName = name;
      currentWorldSeed = seed >>> 0;
      initGame(seed);
      startGame();
      saveCurrentWorld();
      api.toast(`Created ${name}`, "good");
    } finally {
      setWorldLoading(false);
    }
  }
  async function loadWorld(id) {
    if (worldLoadingActive) return;
    const world = readWorldIndex().find((item) => item.id === id);
    const saved = readWorldSave(id);
    if (!world || !saved) {
      api.toast("World save missing", "bad");
      renderWorldPanel();
      return;
    }
    setWorldLoading(true, `Loading ${world.name || "World"}...`);
    await waitForWorldLoadingPaint();
    try {
      currentWorldId = world.id;
      currentWorldName = world.name || "World";
      currentWorldSeed = world.seed >>> 0;
      restoreGame(saved);
      playSfx("spawn", { volume: 0.75 });
      api.toast(`Loaded ${currentWorldName}`, "good");
    } finally {
      setWorldLoading(false);
    }
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
    if (biome.surface === "snow") return SNOW;   // real snow block, not a flat white overlay
    return DIRT;
  }
  function nearSurfaceBlockForBiome(biome, shoreline) {
    if (shoreline || biome.surface === "sand") return SAND;
    return DIRT;   // dirt sits beneath the snow cap
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
  function canPlaceTreeSeed(x, z, biome, spawnDist, forest = 0) {
    if (spawnDist < 26 || biome.tree <= 0) return false;
    // Dense forest regions pull trees closer together and raise their odds, so the map
    // grows real woodland patches instead of an even scatter everywhere.
    const dense = clamp((forest - 0.52) / 0.32, 0, 1);
    const spacing = Math.max(3, Math.round((biome.treeSpacing || 12) * (1 - dense * 0.62)));
    const prob = Math.min(0.96, biome.tree * (1 + dense * 2.6));
    const cellX = Math.floor(x / spacing);
    const cellZ = Math.floor(z / spacing);
    const margin = Math.min(3, Math.floor(spacing / 3));
    const usable = Math.max(1, spacing - margin * 2);
    const pickX = cellX * spacing + margin + Math.floor(hash2(cellX * 19 + 5, cellZ * 23 - 7) * usable);
    const pickZ = cellZ * spacing + margin + Math.floor(hash2(cellX * 29 - 11, cellZ * 31 + 13) * usable);
    return x === pickX && z === pickZ && hash2(cellX + 101, cellZ - 73) < prob;
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
    // Inlined lattice samples — avoids allocating a closure on every call, which
    // matters because world-gen evaluates this tens of millions of times.
    const c000 = hash3(x0, y0, z0);
    const c100 = hash3(x0 + 1, y0, z0);
    const c010 = hash3(x0, y0 + 1, z0);
    const c110 = hash3(x0 + 1, y0 + 1, z0);
    const c001 = hash3(x0, y0, z0 + 1);
    const c101 = hash3(x0 + 1, y0, z0 + 1);
    const c011 = hash3(x0, y0 + 1, z0 + 1);
    const c111 = hash3(x0 + 1, y0 + 1, z0 + 1);
    const x00 = lerp(c000, c100, tx);
    const x10 = lerp(c010, c110, tx);
    const x01 = lerp(c001, c101, tx);
    const x11 = lerp(c011, c111, tx);
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
  function setBlock(x, y, z, code, track = true, rebuild = true) {
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
    const lit = lightingAffected(prev, code);
    if (lit) {
      state.skyHeight[surfaceIndex(x, z)] = computeSkyHeight(x, z);
      relightAround(x, y, z);
    }
    if (rebuild) {
      if (lit) {
        // Rebuild only the chunks whose light moved, unioned with the edited block's
        // own cell (+1 ring) so its changed faces refresh even when light barely shifts.
        let bx0 = x - 1, bx1 = x + 1, bz0 = z - 1, bz1 = z + 1;
        if (lightDirtyX1 >= 0) {
          if (lightDirtyX0 < bx0) bx0 = lightDirtyX0;
          if (lightDirtyX1 > bx1) bx1 = lightDirtyX1;
          if (lightDirtyZ0 < bz0) bz0 = lightDirtyZ0;
          if (lightDirtyZ1 > bz1) bz1 = lightDirtyZ1;
        }
        rebuildChunksForLight(bx0, bz0, bx1, bz1);
      } else rebuildChunksNear(x, z);
    }
    // A door swapping open<->closed keeps its facing; any other furniture removal clears it.
    const facingFurniture = prev === TABLE || prev === CHEST || prev === BED || prev === DOOR || prev === DOOR_OPEN;
    const stillDoor = (prev === DOOR || prev === DOOR_OPEN) && (code === DOOR || code === DOOR_OPEN);
    if (facingFurniture && prev !== code && !stillDoor) delete state.toiletFacing[`${x},${y},${z}`];
    if (prev === CHEST && code !== CHEST) spillChest(x, y, z);
    if (prev === FURNACE && code !== FURNACE) spillFurnace(x, y, z);
    if (DEF[prev].decor || DEF[code].decor || prev === WATER || code === WATER || prev === LAVA || code === LAVA) decorDirty = true;
  }
  function setFluidBlock(x, y, z, code) {
    setBlock(x, y, z, code, false, false);
    queueFluidChunkRebuildsNear(x, z);
  }
  function flowWaterNear(x, y, z, limit = WATER_FLOW_BURST_LIMIT) {
    const seenSeeds = new Set();
    let queued = 0;
    const seedDirs = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const dir of seedDirs) {
      if (queued >= limit) break;
      const sx = x + dir[0];
      const sy = y + dir[1];
      const sz = z + dir[2];
      const key = `${sx},${sy},${sz}`;
      if (!inWorld(sx, sy, sz) || seenSeeds.has(key) || getBlock(sx, sy, sz) !== WATER) continue;
      seenSeeds.add(key);
      if (queueActiveFluid(WATER, sx, sy, sz, 0, false, waterIsFallingAt(sx, sy, sz))) queued++;
    }
    return queued;
  }
  function spreadWaterFrom(seeds, limit = WATER_FLOW_LIMIT) {
    const queue = seeds.slice();
    const queued = new Set(queue.map((p) => `${p.x},${p.y},${p.z}`));
    const scanLimit = Math.max(queue.length, limit * FLUID_SCAN_MULTIPLIER);
    let filled = 0;

    function pushIfWater(x, y, z, flow = 0, falling = false) {
      const key = `${x},${y},${z}`;
      if (queue.length >= scanLimit || !inWorld(x, y, z) || queued.has(key) || getBlock(x, y, z) !== WATER) return;
      queued.add(key);
      queue.push({ x, y, z, flow, falling });
      queueActiveFluid(WATER, x, y, z, flow, false, falling);
    }
    function fill(x, y, z, flow = 0, falling = false) {
      if (!inWorld(x, y, z) || !canWaterFill(getBlock(x, y, z)) || filled >= limit) return false;
      setFluidBlock(x, y, z, WATER);
      queueActiveFluid(WATER, x, y, z, flow, false, falling);
      filled++;
      return true;
    }

    for (let i = 0, scanned = 0; i < queue.length && filled < limit && scanned < scanLimit; i++, scanned++) {
      const p = queue[i];
      if (getBlock(p.x, p.y, p.z) !== WATER) continue;
      const flow = p.flow || 0;
      const falling = !!p.falling || waterIsFallingAt(p.x, p.y, p.z);
      const below = getBlock(p.x, p.y - 1, p.z);
      if (canWaterFill(below)) {
        fill(p.x, p.y - 1, p.z, 0, true);
        continue;
      }
      if (falling && below === WATER) {
        pushIfWater(p.x, p.y - 1, p.z, 0, true);
        continue;
      }
      if (below !== WATER && !isSolidBlock(below)) continue;
      if (flow >= WATER_LATERAL_RANGE) continue;
      for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dir[0];
        const nz = p.z + dir[1];
        if (fill(nx, p.y, nz, flow + 1, false)) continue;
        pushIfWater(nx, p.y, nz, flow + 1, false);
      }
    }
    return filled;
  }
  function flowLavaNear(x, y, z, limit = LAVA_FLOW_BURST_LIMIT) {
    const seenSeeds = new Set();
    let queued = 0;
    const seedDirs = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const dir of seedDirs) {
      if (queued >= limit) break;
      const sx = x + dir[0];
      const sy = y + dir[1];
      const sz = z + dir[2];
      const key = `${sx},${sy},${sz}`;
      if (!inWorld(sx, sy, sz) || seenSeeds.has(key) || getBlock(sx, sy, sz) !== LAVA) continue;
      seenSeeds.add(key);
      if (queueActiveFluid(LAVA, sx, sy, sz, 0)) queued++;
    }
    return queued;
  }
  function spreadLavaFrom(seeds, limit = LAVA_FLOW_LIMIT) {
    const queue = seeds.slice();
    const queued = new Set(queue.map((p) => `${p.x},${p.y},${p.z}`));
    const scanLimit = Math.max(queue.length, limit * FLUID_SCAN_MULTIPLIER);
    let filled = 0;

    function pushIfLava(x, y, z, flow) {
      const key = `${x},${y},${z}`;
      if (queue.length >= scanLimit || !inWorld(x, y, z) || queued.has(key) || getBlock(x, y, z) !== LAVA) return;
      queued.add(key);
      queue.push({ x, y, z, flow });
      queueActiveFluid(LAVA, x, y, z, flow);
    }
    function fill(x, y, z, flow) {
      if (!inWorld(x, y, z) || filled >= limit) return false;
      const code = getBlock(x, y, z);
      if (!canLavaFill(code)) return false;
      setFluidBlock(x, y, z, code === WATER ? STONE : LAVA);
      filled++;
      if (code !== WATER) {
        queueActiveFluid(LAVA, x, y, z, flow);
      }
      return true;
    }

    for (let i = 0, scanned = 0; i < queue.length && filled < limit && scanned < scanLimit; i++, scanned++) {
      const p = queue[i];
      if (getBlock(p.x, p.y, p.z) !== LAVA) continue;
      const below = getBlock(p.x, p.y - 1, p.z);
      if (canLavaFill(below)) {
        fill(p.x, p.y - 1, p.z, 0);
        continue;
      }
      if (below !== LAVA && !isSolidBlock(below)) continue;
      if (p.flow >= LAVA_LATERAL_RANGE) continue;
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
  function processActiveWater(limit = WATER_FLOW_LIMIT) {
    let filled = 0;
    let scanned = 0;
    const end = state.activeWater.length;
    const scanLimit = Math.max(limit + 1, limit * FLUID_SCAN_MULTIPLIER);
    while (activeWaterHead < end && filled < limit && scanned < scanLimit) {
      const p = state.activeWater[activeWaterHead++];
      scanned++;
      activeWaterKeys.delete(fluidKey(p.x, p.y, p.z));
      if (getBlock(p.x, p.y, p.z) !== WATER) continue;
      filled += spreadWaterFrom([{ x: p.x, y: p.y, z: p.z, flow: p.flow || 0, falling: !!p.falling }], limit - filled);
    }
    trimActiveFluidQueue(WATER);
    return filled;
  }
  function processActiveLava(limit = LAVA_FLOW_LIMIT) {
    let filled = 0;
    let scanned = 0;
    const end = state.activeLava.length;
    const scanLimit = Math.max(limit + 1, limit * FLUID_SCAN_MULTIPLIER);
    while (activeLavaHead < end && filled < limit && scanned < scanLimit) {
      const p = state.activeLava[activeLavaHead++];
      scanned++;
      activeLavaKeys.delete(fluidKey(p.x, p.y, p.z));
      const code = getBlock(p.x, p.y, p.z);
      if (code !== LAVA) continue;
      filled += spreadLavaFrom([{ x: p.x, y: p.y, z: p.z, flow: p.flow || 0 }], limit - filled);
    }
    trimActiveFluidQueue(LAVA);
    return filled;
  }
  function updateFluidSimulation(dt) {
    state.waterFlowTimer = Math.min(state.waterFlowTimer + dt, WATER_FLOW_TICK_SECONDS * 3);
    state.lavaFlowTimer = Math.min(state.lavaFlowTimer + dt, LAVA_FLOW_TICK_SECONDS * 2);
    let waterSteps = 0;
    while (state.waterFlowTimer >= WATER_FLOW_TICK_SECONDS && waterSteps < 1) {
      state.waterFlowTimer -= WATER_FLOW_TICK_SECONDS;
      processActiveWater(WATER_FLOW_BURST_LIMIT);
      waterSteps++;
    }
    let lavaSteps = 0;
    while (state.lavaFlowTimer >= LAVA_FLOW_TICK_SECONDS && lavaSteps < 1) {
      state.lavaFlowTimer -= LAVA_FLOW_TICK_SECONDS;
      processActiveLava(LAVA_FLOW_BURST_LIMIT);
      lavaSteps++;
    }
  }
  function settleGeneratedLava() {
    for (let z = 1; z < WORLD_Z - 1; z++) {
      for (let x = 1; x < WORLD_X - 1; x++) {
        for (let y = LAVA_LEVEL + 22; y >= 2; y--) {
          if (getBlock(x, y, z) !== LAVA) continue;
          const below = getBlock(x, y - 1, z);
          if (!canLavaFill(below)) continue;
          setBase(x, y, z, AIR);
          setBase(x, y - 1, z, below === WATER ? STONE : LAVA);
        }
      }
    }
  }
  function flowLiquidsNear(x, y, z) {
    return queueFluidNeighborhood(x, y, z);
  }
  function isSolidBlock(code) { return !!(DEF[code] && DEF[code].solid); }
  // Decor blocks (incl. the solid Crafting Toilet) are drawn as their own little models
  // in the decor group, never in the chunk mesh — so they must NOT occlude neighbour
  // faces, otherwise the ground/walls behind them get culled and you see through.
  function occludes(code) {
    if (code === AIR || code === WATER || code === LAVA) return false;
    const d = DEF[code];
    return !!d && !d.decor;
  }

  // --- Voxel lighting engine ---------------------------------------------------
  // blocksSky: casts a sky shadow (opaque solids + water, so depth darkens).
  function blocksSky(code) {
    if (code === AIR) return false;
    if (code === WATER) return true;
    const d = DEF[code];
    if (!d) return true;
    if (d.liquid) return false;        // lava lets light pass (and emits)
    if (d.decor) return false;         // torches, grass, glow, crystals, vines...
    if (d.transparent) return false;   // leaves
    return !!d.solid;                  // stone, dirt, sand, snow, logs, planks...
  }
  // lightTransmits: light can travel through this cell (and beyond it).
  function lightTransmits(code) {
    if (code === AIR) return true;
    const d = DEF[code];
    if (!d) return false;
    if (d.liquid) return true;         // water + lava
    if (d.decor) return true;
    if (d.transparent) return true;    // leaves
    return false;                      // opaque solids stop light
  }
  function blockEmission(code) {
    const d = DEF[code];
    return d && d.light ? d.light : 0;
  }
  // Whether a block swap actually changes the light field (skip relight otherwise).
  function lightingAffected(prev, code) {
    return blocksSky(prev) !== blocksSky(code)
      || lightTransmits(prev) !== lightTransmits(code)
      || blockEmission(prev) !== blockEmission(code);
  }
  // First sky-open y for a column (lowest cell with nothing opaque above it).
  // startY caps the downward scan: callers that know the column's top solid is at
  // most a few blocks above the recorded surface pass it to skip empty sky.
  function computeSkyHeight(x, z, startY) {
    let y = startY === undefined ? WORLD_Y - 1 : startY;
    while (y > 0 && !blocksSky(getBlock(x, y, z))) y--;
    return y + 1;
  }
  function skyOpen(x, y, z) {
    return y >= state.skyHeight[surfaceIndex(x, z)];
  }
  function getSkyLight(i) { return state.light[i] >> 4; }
  function getBlockLight(i) { return state.light[i] & 15; }

  function relaxLight(nx, ny, nz, ni, nl, sky, queue, x0, y0, z0, x1, y1, z1) {
    if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || nz < z0 || nz > z1) return;
    if (!lightTransmits(state.world[ni])) return;
    const light = state.light;
    if (sky) {
      if ((light[ni] >> 4) >= nl) return;
      light[ni] = (light[ni] & 0x0f) | (nl << 4);
    } else {
      if ((light[ni] & 15) >= nl) return;
      light[ni] = (light[ni] & 0xf0) | nl;
    }
    queue.push(ni);
  }
  // BFS flood fill of one channel, clamped to a box (full world for a global solve).
  function propagateLight(queue, sky, x0, y0, z0, x1, y1, z1) {
    const light = state.light;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const x = i % WORLD_X;
      const t = (i / WORLD_X) | 0;
      const z = t % WORLD_Z;
      const y = (t / WORLD_Z) | 0;
      const cur = sky ? (light[i] >> 4) : (light[i] & 15);
      if (cur <= 1) continue;
      const nl = cur - 1;
      relaxLight(x + 1, y, z, i + 1, nl, sky, queue, x0, y0, z0, x1, y1, z1);
      relaxLight(x - 1, y, z, i - 1, nl, sky, queue, x0, y0, z0, x1, y1, z1);
      relaxLight(x, y, z + 1, i + WORLD_X, nl, sky, queue, x0, y0, z0, x1, y1, z1);
      relaxLight(x, y, z - 1, i - WORLD_X, nl, sky, queue, x0, y0, z0, x1, y1, z1);
      relaxLight(x, y + 1, z, i + LIGHT_Y_STRIDE, nl, sky, queue, x0, y0, z0, x1, y1, z1);
      relaxLight(x, y - 1, z, i - LIGHT_Y_STRIDE, nl, sky, queue, x0, y0, z0, x1, y1, z1);
    }
  }
  // Full-world solve, run once after generation / load.
  function computeWorldLight() {
    const light = state.light;
    const world = state.world;
    light.fill(0);
    let maxSurface = 1;
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const si = surfaceIndex(x, z);
        // The top solid sits at most a few blocks above the recorded surface (trees,
        // or player builds already folded into surface), so cap the downward scan
        // instead of walking the whole empty sky on this much taller world.
        const sh = computeSkyHeight(x, z, Math.min(WORLD_Y - 1, state.surface[si] + 16));
        state.skyHeight[si] = sh;
        if (sh > maxSurface) maxSurface = sh;
      }
    }
    const yTop = Math.min(WORLD_Y - 1, maxSurface);
    const x1 = WORLD_X - 1;
    const y1 = WORLD_Y - 1;
    const z1 = WORLD_Z - 1;
    // Skylight: seed cells that are NOT sky-open but border an open cell, then flood.
    const skyQ = [];
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const sh = state.skyHeight[surfaceIndex(x, z)];
        const top = Math.min(sh - 1, yTop);
        for (let y = top; y >= 1; y--) {
          const i = index(x, y, z);
          if (!lightTransmits(world[i])) continue;
          // border with sky? (only need to test neighbours that could be open)
          if ((x > 0 && skyOpen(x - 1, y, z)) || (x < x1 && skyOpen(x + 1, y, z)) ||
              (z > 0 && skyOpen(x, y, z - 1)) || (z < z1 && skyOpen(x, y, z + 1)) ||
              (y < y1 && skyOpen(x, y + 1, z))) {
            if ((light[i] >> 4) < SKY_LIGHT - 1) {
              light[i] = (light[i] & 0x0f) | ((SKY_LIGHT - 1) << 4);
              skyQ.push(i);
            }
          }
        }
      }
    }
    propagateLight(skyQ, true, 0, 0, 0, x1, y1, z1);
    // Block light: seed every emitter, then flood.
    const blkQ = [];
    const emitTop = Math.min(WORLD_Y - 1, Math.max(maxSurface, SEA_LEVEL + 14));
    for (let y = 1; y <= emitTop; y++) {
      for (let z = 0; z < WORLD_Z; z++) {
        for (let x = 0; x < WORLD_X; x++) {
          const i = index(x, y, z);
          const e = blockEmission(world[i]);
          if (e > 0 && (light[i] & 15) < e) {
            light[i] = (light[i] & 0xf0) | e;
            blkQ.push(i);
          }
        }
      }
    }
    propagateLight(blkQ, false, 0, 0, 0, x1, y1, z1);
  }
  // Snapshot buffer + dirty x/z bounds so an edit only rebuilds the chunks whose
  // baked light actually changed (a tall mountain chunk is expensive to re-mesh).
  const _relightScratch = new Uint8Array((2 * LIGHT_RADIUS + 1) ** 3);
  let lightDirtyX0 = -1, lightDirtyX1 = -1, lightDirtyZ0 = -1, lightDirtyZ1 = -1;
  // Local relight of a box around an edit. Box half-size >= LIGHT_RADIUS keeps it correct.
  function relightAround(cx, cy, cz) {
    const R = LIGHT_RADIUS;
    const x0 = clamp(cx - R, 0, WORLD_X - 1), x1 = clamp(cx + R, 0, WORLD_X - 1);
    const y0 = clamp(cy - R, 0, WORLD_Y - 1), y1 = clamp(cy + R, 0, WORLD_Y - 1);
    const z0 = clamp(cz - R, 0, WORLD_Z - 1), z1 = clamp(cz + R, 0, WORLD_Z - 1);
    const light = state.light;
    const world = state.world;
    const bw = x1 - x0 + 1, bd = z1 - z0 + 1;
    const scratch = _relightScratch;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const base = (y * WORLD_Z + z) * WORLD_X;
        const sbase = (((y - y0) * bd) + (z - z0)) * bw - x0;
        for (let x = x0; x <= x1; x++) scratch[sbase + x] = light[base + x];
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const base = (y * WORLD_Z + z) * WORLD_X;
        for (let x = x0; x <= x1; x++) light[base + x] = 0;
      }
    }
    const skyQ = [];
    const blkQ = [];
    // Interior seeds: emitters + cells bordering a sky-open cell.
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * WORLD_Z + z) * WORLD_X + x;
          const code = world[i];
          const e = blockEmission(code);
          if (e > 0) { light[i] = (light[i] & 0xf0) | e; blkQ.push(i); }
          if (!lightTransmits(code) || skyOpen(x, y, z)) continue;
          if ((x > 0 && skyOpen(x - 1, y, z)) || (x < WORLD_X - 1 && skyOpen(x + 1, y, z)) ||
              (z > 0 && skyOpen(x, y, z - 1)) || (z < WORLD_Z - 1 && skyOpen(x, y, z + 1)) ||
              (y < WORLD_Y - 1 && skyOpen(x, y + 1, z))) {
            light[i] = (light[i] & 0x0f) | ((SKY_LIGHT - 1) << 4);
            skyQ.push(i);
          }
        }
      }
    }
    // Shell seeds: the layer just outside the box keeps its (correct) values and feeds inward.
    const shell = (x, y, z) => {
      if (x < 0 || x >= WORLD_X || y < 0 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) return;
      const i = index(x, y, z);
      if ((light[i] >> 4) > 0) skyQ.push(i);
      if ((light[i] & 15) > 0) blkQ.push(i);
    };
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) { shell(x0 - 1, y, z); shell(x1 + 1, y, z); }
      for (let x = x0; x <= x1; x++) { shell(x, y, z0 - 1); shell(x, y, z1 + 1); }
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) { shell(x, y0 - 1, z); shell(x, y1 + 1, z); }
    }
    propagateLight(skyQ, true, x0, y0, z0, x1, y1, z1);
    propagateLight(blkQ, false, x0, y0, z0, x1, y1, z1);
    // Record the x/z span of cells whose light value actually moved.
    let dx0 = WORLD_X, dx1 = -1, dz0 = WORLD_Z, dz1 = -1;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const base = (y * WORLD_Z + z) * WORLD_X;
        const sbase = (((y - y0) * bd) + (z - z0)) * bw - x0;
        for (let x = x0; x <= x1; x++) {
          if (light[base + x] !== scratch[sbase + x]) {
            if (x < dx0) dx0 = x; if (x > dx1) dx1 = x;
            if (z < dz0) dz0 = z; if (z > dz1) dz1 = z;
          }
        }
      }
    }
    lightDirtyX0 = dx0; lightDirtyX1 = dx1; lightDirtyZ0 = dz0; lightDirtyZ1 = dz1;
  }
  function rebuildChunksForLight(x0, z0, x1, z1) {
    const cx0 = clamp(Math.floor(x0 / CHUNK), 0, WORLD_X / CHUNK - 1);
    const cx1 = clamp(Math.floor(x1 / CHUNK), 0, WORLD_X / CHUNK - 1);
    const cz0 = clamp(Math.floor(z0 / CHUNK), 0, WORLD_Z / CHUNK - 1);
    const cz1 = clamp(Math.floor(z1 / CHUNK), 0, WORLD_Z / CHUNK - 1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (state.chunks.has(`${cx},${cz}`)) rebuildChunk(cx, cz);
      }
    }
  }
  // Light multiplier applied to a surface exposed to cell (x,y,z). Warm block glow + cool sky.
  const _faceLight = { r: 1, g: 1, b: 1 };
  function computeLight(x, y, z, out) {
    let sky;
    let blk;
    if (y >= WORLD_Y) { sky = SKY_LIGHT; blk = 0; }
    else if (x < 0 || x >= WORLD_X || y < 0 || z < 0 || z >= WORLD_Z) { sky = SKY_LIGHT; blk = 0; }
    else if (skyOpen(x, y, z)) { sky = SKY_LIGHT; blk = state.light[index(x, y, z)] & 15; }
    else { const v = state.light[index(x, y, z)]; sky = v >> 4; blk = v & 15; }
    const s = sky / SKY_LIGHT;
    const env = CAVE_AMBIENT + (1 - CAVE_AMBIENT) * (s * s * (3 - 2 * s));
    const b = blk / SKY_LIGHT;
    const glow = b * b * BLOCK_LIGHT_GAIN;
    out.r = env + glow;
    out.g = env + glow * 0.78;
    out.b = env + glow * 0.5;
    return out;
  }

  function generateWorld(seed = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)) {
    state.seed = seed >>> 0;
    state.edits.clear();
    // World-specific block metadata is regenerated below, so start clean.
    state.chests = {}; state.furnaces = {}; state.toiletFacing = {};
    state.openChest = null; state.openFurnace = null;
    resetActiveFluids();
    state.world.fill(AIR);
    state.surface.fill(SEA_LEVEL);
    state.biome.fill(0);

    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const dx = x - WORLD_X / 2;
        const dz = z - WORLD_Z / 2;
        const center = Math.sqrt(dx * dx + dz * dz);
        // Gentle rolling base — this is where MOST of the world lives: plains, hills,
        // and shallow valleys/lakes. Low amplitude keeps it from spiking everywhere.
        const continent = fbm2(x + 1200, z - 500, 0.0055, 5);
        const hills = fbm2(x - 900, z + 700, 0.022, 4);
        let h = SEA_LEVEL + 6 + (continent - 0.5) * 42 + (hills - 0.5) * 18;
        // Mountain ranges are confined to their own large, independent regions, so the
        // map reads as rolling country with the occasional range — not wall-to-wall peaks.
        const mountainness = fbm2(x + 4100, z - 3300, 0.0042, 4);
        const ridges = 1 - Math.abs(fbm2(x + 20, z + 20, 0.013, 5) * 2 - 1);
        const mtn = smooth(clamp((mountainness - 0.62) / 0.18, 0, 1));
        h += Math.pow(ridges, 2.0) * 150 * mtn;
        const ocean = edgeOceanStrength(x, z);
        if (ocean > 0) {
          const shelf = SEA_LEVEL - 8 - smooth(ocean) * 14 + noise2(x + 17, z - 23, 0.055) * 4 + fbm2(x - 160, z + 220, 0.018, 3) * 3;
          h = lerp(h, shelf, smooth(ocean));
        }
        const spawnBlend = clamp(1 - center / 20, 0, 1);
        h = lerp(h, SEA_LEVEL + 8 + Math.sin(x * 0.18) * 0.7 + Math.cos(z * 0.16) * 0.7, spawnBlend);
        const height = clamp(Math.round(h), 32, WORLD_Y - 9);
        const moisture = fbm2(x - 300, z + 300, 0.0048, 4);
        const weird = fbm2(x + 700, z + 80, 0.0056, 4);
        const temp = fbm2(x + 90, z - 840, 0.0046, 4);
        let biome = 0;
        if (height > SEA_LEVEL + 78) biome = 11;                       // snow-capped summits
        else if (height > SEA_LEVEL + 30 && mtn > 0.2) biome = 6;       // mountain rock (only in ranges)
        else if (temp < 0.36 && height > SEA_LEVEL + 3) biome = 11;     // cold highlands
        else if (temp > 0.66 && moisture < 0.42 && height <= SEA_LEVEL + 20) biome = 10;
        else if (weird < 0.30 && moisture < 0.54) biome = 7;
        else if (moisture > 0.68 && height <= SEA_LEVEL + 7) biome = 3;
        else if (weird > 0.72 && moisture > 0.38) biome = 4;
        else if (moisture < 0.28 && temp > 0.50) biome = 5;
        else if (moisture > 0.58 && temp < 0.48) biome = 8;
        else if (weird > 0.58 && moisture > 0.40) biome = 9;
        else if (height > SEA_LEVEL + 18) biome = 2;                    // highland hills
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
        // Everything above the surface (and above the waterline) is already AIR from
        // the initial fill — only iterate the solid/submerged span so the much taller
        // world does not pay for scanning empty sky on every column.
        const yMax = height > SEA_LEVEL ? height : SEA_LEVEL;
        // Cave/tunnel noise is low frequency (its vertical lattice spans ~9 blocks),
        // so sample it once per pair of levels and reuse — halves the dominant cost
        // of world-gen with no visible change to cave shape.
        let caveYc = -1, caveCarved = false;
        for (let y = 0; y <= yMax; y++) {
          let code = AIR;
          if (y === 0) code = BEDROCK;
          else if (y > height) code = WATER;
          else {
            const depth = height - y;
            const shoreline = height <= SEA_LEVEL + 1 || biome.id === 3;
            if (depth === 0) code = surfaceBlockForBiome(biome, shoreline);
            else if (depth < (biome.surface === "sand" ? 5 : 4)) code = nearSurfaceBlockForBiome(biome, shoreline);
            else code = STONE;

            if (code === STONE && y > 3 && y < height - 4) {
              const yc = y & ~1;
              if (yc !== caveYc) {
                caveYc = yc;
                // Short-circuit the tunnel field so the common (uncarved) cell only
                // pays for one 3D-noise sample instead of two.
                caveCarved = noise3(x + 400, yc * 1.35, z - 200, 0.08) > 0.72;
                if (!caveCarved && yc < WORLD_Y - 10) caveCarved = noise3(x - 700, yc * 1.8, z + 300, 0.045) > 0.63;
              }
              if (caveCarved) code = AIR;
              else {
                const r = hash3(x, y, z);
                if (y < height - 6 && r < 0.035) code = COAL_ORE;
                if (y < SEA_LEVEL + 10 && r >= 0.035 && r < 0.055) code = RIZZ_ORE;
                if (y < LAVA_LEVEL + 18 && r >= 0.055 && r < 0.064) code = SIGMA_ORE;
              }
            }
            if (y > 1 && y < LAVA_LEVEL && (code === AIR || code === STONE)) {
              const pocket = noise3(x - 1600, y * 2.6, z + 1800, 0.082);
              if (pocket > 0.46) {
                // vein only matters for the rarer stone-replacing case, so defer it.
                if (code === AIR) code = LAVA;
                else if (pocket > 0.72 && noise3(x + 230, y * 3.1, z - 510, 0.14) > 0.58) code = LAVA;
              }
            }
          }
          state.world[index(x, y, z)] = code;
        }
      }
    }

    settleGeneratedLava();
    growCaveFeatures();
    growTreesAndDetails();
    placeStructures();
    carveSpawnMeadow();
    state.baseWorld.set(state.world);
    computeWorldLight();
    rebuildAllChunks();
    rebuildDecorations();
    buildClouds();
    buildStars();
    buildCelestials();
    spawnCaveCreatures();
    spawnFriendlies();
    spawnFish();
  }

  function growCaveFeatures() {
    for (let z = 2; z < WORLD_Z - 2; z++) {
      for (let x = 2; x < WORLD_X - 2; x++) {
        const surface = state.surface[surfaceIndex(x, z)];
        const maxY = Math.min(surface - 4, WORLD_Y - 5);
        if (maxY < 8) continue;
        for (let y = 5; y <= maxY; y++) {
          if (getBlock(x, y, z) !== AIR) continue;
          if (getBlock(x, y, z + 1) === WATER || getBlock(x, y, z - 1) === WATER) continue;
          const floor = getBlock(x, y - 1, z);
          const ceiling = getBlock(x, y + 1, z);
          const floorSolid = isSolidBlock(floor) && floor !== BEDROCK;
          const ceilingSolid = isSolidBlock(ceiling) && ceiling !== BEDROCK;
          const openAbove = getBlock(x, y + 1, z) === AIR && getBlock(x, y + 2, z) === AIR;
          const openBelow = getBlock(x, y - 1, z) === AIR && getBlock(x, y - 2, z) === AIR;
          const roll = hash3(x * 17 + 11, y * 19 - 7, z * 23 + 5);
          if (floorSolid) {
            if (roll < 0.0042 && openAbove && y > LAVA_LEVEL + 4) setBase(x, y, z, GLOW_SHROOM);
            else if (roll >= 0.0042 && roll < 0.0066 && openAbove && y < SEA_LEVEL + 12) setBase(x, y, z, CAVE_CRYSTAL);
            else if (roll > 0.989 && openAbove) setBase(x, y, z, DRIPSTONE_UP);
          } else if (ceilingSolid) {
            if (roll > 0.995 && openBelow) setBase(x, y, z, DRIPSTONE_DOWN);
            else if (roll > 0.988 && openBelow && y > LAVA_LEVEL + 8) setBase(x, y, z, CAVE_VINE);
          }
        }
      }
    }
  }

  function growTreesAndDetails() {
    for (let z = 2; z < WORLD_Z - 2; z++) {
      for (let x = 2; x < WORLD_X - 2; x++) {
        const si = surfaceIndex(x, z);
        const y = state.surface[si];
        const top = getBlock(x, y, z);
        const biome = BIOMES[state.biome[si]];
        if (y <= SEA_LEVEL) continue;
        if (top !== DIRT && top !== GRASS && top !== SNOW && !(top === SAND && biome.surface === "sand")) continue;
        const spawnDist = Math.hypot(x - WORLD_X / 2, z - WORLD_Z / 2);
        const forest = fbm2(x + 5200, z - 6100, 0.0085, 4);
        if (canPlaceTreeSeed(x, z, biome, spawnDist, forest)) {
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

  // --- Structures & loot -------------------------------------------------------
  // Weighted loot tables: [code, minCount, maxCount, weight].
  const LOOT_COMMON = [
    [PLANKS, 4, 12, 4], [STICK, 2, 6, 3], [COAL, 1, 5, 3], [TORCH, 2, 6, 3],
    [STONE_BRICK, 4, 10, 3], [WHEAT_SEEDS, 1, 4, 2], [BREAD, 1, 3, 2], [CHARCOAL, 1, 4, 2],
    [RIZZ, 1, 2, 2], [PICK_STONE, 1, 1, 1], [SWORD_STONE, 1, 1, 1], [GLOW_SHROOM, 1, 3, 1],
  ];
  const LOOT_RARE = [
    [RIZZ, 2, 6, 4], [SIGMA, 1, 4, 3], [GLOWSTONE, 1, 3, 2], [CHARCOAL, 2, 6, 2],
    [SIGMA_LANTERN, 1, 2, 2], [COOKED_MEAT, 2, 4, 2], [PICK_RIZZ, 1, 1, 1], [SWORD_RIZZ, 1, 1, 1],
    [GOLDEN_APPLE, 1, 1, 1], [SIGMA_BLOCK, 1, 2, 1], [SIGMA_BREW, 1, 2, 1],
  ];
  function lootRng(x, y, z) {
    let s = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ state.seed) >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function fillLoot(x, y, z, table, rolls) {
    const slots = chestSlots(chestKey(x, y, z));
    const rng = lootRng(x, y, z);
    const total = table.reduce((a, e) => a + e[3], 0);
    const picks = rolls[0] + Math.floor(rng() * (rolls[1] - rolls[0] + 1));
    for (let i = 0; i < picks; i++) {
      let r = rng() * total, entry = table[0];
      for (const e of table) { r -= e[3]; if (r <= 0) { entry = e; break; } }
      const n = entry[1] + Math.floor(rng() * (entry[2] - entry[1] + 1));
      addToSlotArray(slots, entry[0], n);
    }
  }
  function flatEnough(x, z, r, maxDelta) {
    const h = state.surface[surfaceIndex(x, z)];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (!inWorld(x + dx, 1, z + dz)) return false;
      if (Math.abs(state.surface[surfaceIndex(x + dx, z + dz)] - h) > maxDelta) return false;
    }
    return h > SEA_LEVEL + 1 && h < WORLD_Y - 8;
  }
  function buildSurfaceRuin(cx, cz) {
    const sy = state.surface[surfaceIndex(cx, cz)];
    const r = 2;
    const wall = STONE_BRICK, floor = PLANKS;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        setBase(cx + dx, sy, cz + dz, floor);                 // floor
        for (let h = 1; h <= 3; h++) {
          const edge = Math.abs(dx) === r || Math.abs(dz) === r;
          if (edge) {
            // ruined walls: some blocks crumbled away, taller corners
            const keep = hash3(cx + dx * 5, sy + h * 3, cz + dz * 7) > (h === 3 ? 0.55 : 0.22);
            setBase(cx + dx, sy + h, cz + dz, keep ? wall : AIR);
          } else {
            setBase(cx + dx, sy + h, cz + dz, AIR);            // hollow interior
          }
        }
      }
    }
    setBase(cx, sy + 1, cz, CHEST);
    state.toiletFacing[chestKey(cx, sy + 1, cz)] = (hash2(cx, cz) * 4) | 0;
    fillLoot(cx, sy + 1, cz, LOOT_COMMON, [3, 6]);
    // a lantern beacon on a post so the ruin is visible from afar
    setBase(cx + r, sy + 1, cz + r, STONE_BRICK);
    setBase(cx + r, sy + 2, cz + r, STONE_BRICK);
    setBase(cx + r, sy + 3, cz + r, SIGMA_LANTERN);
    for (let dz = -r - 1; dz <= r + 1; dz++) for (let dx = -r - 1; dx <= r + 1; dx++) updateSurfaceColumn(cx + dx, cz + dz);
  }
  function buildDeepVault(cx, cy, cz) {
    const r = 2;
    // require mostly-solid stone so we're carving into rock, not open cave
    let solid = 0, n = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) for (let dy = 0; dy <= 3; dy++) {
      n++; if (isSolidBlock(getBlock(cx + dx, cy + dy, cz + dz))) solid++;
    }
    if (solid / n < 0.8) return false;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = 0; dy <= 3; dy++) {
          const shell = Math.abs(dx) === r || Math.abs(dz) === r || dy === 0 || dy === 3;
          setBase(cx + dx, cy + dy, cz + dz, shell ? STONE_BRICK : AIR);
        }
      }
    }
    setBase(cx, cy + 1, cz, CHEST);
    state.toiletFacing[chestKey(cx, cy + 1, cz)] = (hash2(cx + 3, cz - 3) * 4) | 0;
    fillLoot(cx, cy + 1, cz, LOOT_RARE, [4, 7]);
    setBase(cx + 1, cy + 2, cz + 1, GLOWSTONE); // lights the vault
    return true;
  }
  function placeStructures() {
    const ccx = WORLD_X >> 1, ccz = WORLD_Z >> 1;
    // Surface ruins on flat, dry ground (visible by their lantern beacon).
    for (let z = 30; z < WORLD_Z - 30; z += 13) {
      for (let x = 30; x < WORLD_X - 30; x += 13) {
        if (Math.hypot(x - ccx, z - ccz) < 40) continue;             // keep spawn clear
        if (hash2(x * 3 + 11, z * 3 - 7) > 0.06) continue;           // sparse
        if (!flatEnough(x, z, 3, 1)) continue;
        buildSurfaceRuin(x, z);
      }
    }
    // Deep vaults hidden in the rock — better loot the deeper you dig.
    for (let z = 24; z < WORLD_Z - 24; z += 14) {
      for (let x = 24; x < WORLD_X - 24; x += 14) {
        if (hash2(x * 7 - 5, z * 7 + 9) > 0.022) continue;
        const sy = state.surface[surfaceIndex(x, z)];
        const top = Math.min(sy - 14, SEA_LEVEL - 6);
        if (top < LAVA_LEVEL + 6) continue;
        const cy = LAVA_LEVEL + 4 + ((hash3(x, 1, z) * (top - LAVA_LEVEL - 4)) | 0);
        buildDeepVault(x, cy, z);
      }
    }
  }
  function setBase(x, y, z, code) {
    if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
  }
  function updateSurfaceColumn(x, z) {
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return;
    let y = WORLD_Y - 1;
    while (y > 0) {
      const code = getBlock(x, y, z);
      if (code !== AIR && code !== WATER && code !== LAVA && !isReplaceableDecor(code)) break;
      y--;
    }
    state.surface[surfaceIndex(x, z)] = y;
  }

  function rebuildAllChunks() {
    disposeGroup(worldGroup);
    disposeGroup(waterGroup);
    disposeGroup(lavaGroup);
    state.chunks.clear();
    pendingFluidChunks.clear();
    chunkCenterKey = "";
    updateVisibleChunks(true);
  }
  function queueChunkRebuild(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= WORLD_X / CHUNK || cz >= WORLD_Z / CHUNK) return;
    const key = `${cx},${cz}`;
    if (state.chunks.has(key)) pendingFluidChunks.add(key);
  }
  function queueFluidChunkRebuildsNear(x, z) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || x % CHUNK === 0 || x % CHUNK === CHUNK - 1 || z % CHUNK === 0 || z % CHUNK === CHUNK - 1) {
          queueChunkRebuild(cx + dx, cz + dz);
        }
      }
    }
  }
  function flushFluidChunkRebuilds(limit = FLUID_CHUNK_REBUILDS_PER_FRAME) {
    let rebuilt = 0;
    for (const key of pendingFluidChunks) {
      pendingFluidChunks.delete(key);
      const parts = key.split(",");
      const cx = Number(parts[0]);
      const cz = Number(parts[1]);
      if (Number.isFinite(cx) && Number.isFinite(cz) && state.chunks.has(key)) {
        rebuildChunk(cx, cz);
        rebuilt++;
      }
      if (rebuilt >= limit) break;
    }
    return rebuilt;
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
    // Cap the vertical scan to the tallest column in this chunk (plus headroom for
    // trees / builds the surface map already tracks) so the much taller world does
    // not mesh hundreds of empty sky cells per column on every rebuild.
    let chunkTop = SEA_LEVEL;
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const s = state.surface[surfaceIndex(x, z)];
        if (s > chunkTop) chunkTop = s;
      }
    }
    const yEnd = Math.min(WORLD_Y - 1, chunkTop + 16);
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y <= yEnd; y++) {
        for (let x = x0; x < x0 + CHUNK; x++) {
          const code = getBlock(x, y, z);
          if (code === AIR || DEF[code].decor) continue;
          const arr = code === WATER ? water : code === LAVA ? lava : solid;
          for (const face of FACES) {
            const nx = x + face.n[0];
            const ny = y + face.n[1];
            const nz = z + face.n[2];
            const neighbor = getBlock(nx, ny, nz);
            // Fluids only show faces that meet open air (or the other fluid). Rendering
            // faces against the solid seabed/shore puts a translucent face on the exact
            // same plane as the block beneath it, which z-fights into a shimmering mess.
            const visible = code === WATER ? (neighbor === AIR || neighbor === LAVA)
              : code === LAVA ? (neighbor === AIR || neighbor === WATER)
              : !occludes(neighbor);
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
  function waterOccupiesNeighbor(code) {
    return code === WATER || code === BEDROCK || isReplaceableDecor(code);
  }
  function makeGeometryArrays() {
    return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  }
  function pushFace(arr, x, y, z, code, face) {
    const start = arr.positions.length / 3;
    const tile = textureTileForFace(code, face, x, y, z);
    let u0, u1, v0, v1;
    if (code === WATER) {
      u0 = 0;
      u1 = 1;
      v0 = 0;
      v1 = 1;
    } else {
      const col = tile % TEX_COLS;
      const row = Math.floor(tile / TEX_COLS);
      u0 = (col + 0.015) / TEX_COLS;
      u1 = (col + 0.985) / TEX_COLS;
      v0 = 1 - (row + 0.985) / TEX_ROWS;
      v1 = 1 - (row + 0.015) / TEX_ROWS;
    }
    const localUv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    let lr, lg, lb;
    if (code === LAVA) {
      // Lava is its own light source — its faces still glow, but only faintly now.
      lr = 1.06; lg = 0.88; lb = 0.7;
    } else {
      computeLight(x + face.n[0], y + face.n[1], z + face.n[2], _faceLight);
      lr = _faceLight.r; lg = _faceLight.g; lb = _faceLight.b;
    }
    for (let i = 0; i < face.c.length; i++) {
      const c = face.c[i];
      const rgb = faceColor(code, face.shade, x, y, z, face, c);
      arr.positions.push(x + c[0], y + c[1], z + c[2]);
      arr.normals.push(face.n[0], face.n[1], face.n[2]);
      arr.colors.push(rgb[0] * lr, rgb[1] * lg, rgb[2] * lb);
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
    if (code === STONE_BRICK) return TEX.stone;
    if (code === COAL_BLOCK) return TEX.stone;
    if (code === FURNACE) return TEX.stone;
    if (code === FARMLAND) return TEX.dirt;
    if (code === GLOWSTONE || code === RIZZ_BLOCK || code === SIGMA_BLOCK) return TEX.ore;
    if (code === SIGMA_LANTERN || code === CRYSTAL_GLASS) return TEX.table;
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
      // Bright, faintly sparkling crown; cooler blue-shadowed sides give it real depth
      // instead of a flat white sheet.
      if (topFace) {
        const sparkle = grain > 0.92 ? 0.16 : grain > 0.82 ? 0.06 : 0;
        base = mixRgb(cachedRgb("#eef7ff"), cachedRgb("#ffffff"), clamp(grain * 0.55 + 0.25 + sparkle, 0, 1));
      } else if (bottomFace) {
        base = cachedRgb("#bcd2e8");
      } else {
        base = mixRgb(cachedRgb("#bcd2ea"), cachedRgb("#dcebf8"), grain * 0.5 + blockGrain * 0.2);
      }
    } else if (code === WATER) {
      // Smooth, large-scale swell (no per-vertex hash so it doesn't shimmer like static).
      // Bright sky-lit crown vs. deeper blue walls reads clearly as water.
      const ripple = clamp((Math.sin(x * 0.26 + z * 0.18) + Math.sin(x * 0.1 - z * 0.23)) * 0.25 + 0.5, 0, 1);
      base = topFace
        ? mixRgb(cachedRgb("#2a9fe6"), cachedRgb("#8ae8ff"), ripple * 0.7)
        : mixRgb(cachedRgb("#1668bd"), cachedRgb("#3fb2e6"), ripple * 0.4);
    } else if (code === LAVA) {
      const glow = Math.sin((x * 1.7 + y * 2.3 + z * 1.1 + blockGrain * 8) * 1.4) * 0.5 + 0.5;
      base = mixRgb(cachedRgb("#ff3b0d"), cachedRgb("#ffd34f"), glow * 0.78);
    } else if (code === STONE_BRICK) {
      // Mortar lines between bricks (offset rows) over a stony base.
      const rock = mixRgb(cachedRgb("#7d808c"), cachedRgb("#9da0ac"), grain * 0.5 + blockGrain * 0.3);
      const row = Math.floor((y + corner[1]) * 2);
      const mortar = ((y + corner[1]) * 2) % 1 < 0.12 || ((x + z + corner[0] + corner[2] + row) * 2) % 2 < 0.12;
      base = mortar ? cachedRgb("#54565f") : rock;
    } else if (code === COAL_BLOCK) {
      base = mixRgb(cachedRgb("#1c1d26"), cachedRgb("#34353f"), grain * 0.6 + blockGrain * 0.4);
    } else if (code === FARMLAND) {
      // Damp tilled soil: dark, with furrow rows raked across the top face.
      if (topFace) {
        const furrow = ((x + corner[0]) * 2) % 2 < 1 ? 0.12 : 0;
        base = mixRgb(cachedRgb("#4a2f17"), cachedRgb("#6a431f"), grain * 0.4 + furrow);
      } else {
        base = mixRgb(cachedRgb("#5e3c20"), cachedRgb("#80542f"), grain * 0.55 + blockGrain * 0.25);
      }
    } else if (code === GLOWSTONE) {
      const speck = grain < 0.4 ? 1 : 0.7;
      base = mixRgb(cachedRgb("#caa238"), cachedRgb("#fff0a8"), grain * 0.7);
      base = scaleRgb(base, speck);
    } else if (code === SIGMA_LANTERN) {
      base = grain < 0.28 ? cachedRgb("#163842") : mixRgb(cachedRgb("#7ff2ff"), cachedRgb("#e6ffff"), grain);
    } else if (code === CRYSTAL_GLASS) {
      base = mixRgb(cachedRgb("#a6def5"), cachedRgb("#eafbff"), grain * 0.6);
    } else if (code === RIZZ_BLOCK) {
      base = mixRgb(cachedRgb("#e8b62f"), cachedRgb("#ffe680"), grain * 0.55 + blockGrain * 0.25);
    } else if (code === SIGMA_BLOCK) {
      base = mixRgb(cachedRgb("#2fbfe0"), cachedRgb("#9bf6ff"), grain * 0.55 + blockGrain * 0.25);
    }
    if (code === LEAVES) {
      base = mixRgb(biomeRgb(biome, "leaf"), mixRgb(biomeRgb(biome, "grass"), cachedRgb("#18d43c"), 0.16), grain * 0.18);
      // Snow settles on the foliage in cold biomes — heavy on top, a dusting on the sides.
      if (biome.surface === "snow" || biome.id === 11) {
        if (topFace) base = mixRgb(base, cachedRgb("#f2f9ff"), 0.78);
        else if (!bottomFace && grain > 0.55) base = mixRgb(base, cachedRgb("#e6f1fb"), 0.5);
      }
    }
    const snowyLeaf = code === LEAVES && (biome.surface === "snow" || biome.id === 11) && topFace;
    const jitter = 0.9 + grain * 0.17 + blockGrain * 0.07;
    const f = shade * jitter;
    const greenSurface = (code === DIRT || code === GRASS) && topFace && dirtTopOverlay(x, y, z) === "grass";
    const saturation = code === BEDROCK ? 1.04 : code === STONE ? 1.08 : snowyLeaf ? 0.7 : code === LEAVES ? 1.68 : greenSurface ? 1.62 : 1.36;
    const brightness = code === BEDROCK ? 1.02 : code === STONE ? 1.06 : snowyLeaf ? 1.05 : code === LEAVES ? 1.0 : greenSurface ? 0.98 : 1.08;
    return vividRgb(scaleRgb(base, f), saturation, brightness);
  }
  function updateWaterTexture(dt) {
    if (!waterTexture) return;
    waterTexture.offset.x = (waterTexture.offset.x + dt * 0.0025) % 1;
    waterTexture.offset.y = (waterTexture.offset.y + dt * 0.0015) % 1;
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

  // Decor (grass, glow features, torches, toilets) is one merged mesh; bake light into
  // its vertex colours via these module globals that pushTinyBox/pushBlade multiply by.
  let dlR = 1, dlG = 1, dlB = 1;
  function setDecorLight(x, y, z) {
    computeLight(x, y, z, _faceLight);
    dlR = _faceLight.r; dlG = _faceLight.g; dlB = _faceLight.b;
  }
  function setDecorLightEmissive() {
    // Warm self-lit parts (torch flame) stay bright regardless of cave dark.
    dlR = 1.32; dlG = 1.16; dlB = 0.92;
  }
  function setDecorLightGlow() {
    // Neutral bright so glow features keep their own cyan/pink colour in the dark.
    dlR = 1.18; dlG = 1.18; dlB = 1.18;
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
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            // Decor (plants, glow features, torches) sits at or below each column's
            // solid surface, so cap the scan instead of walking the empty sky.
            const yTop = Math.min(WORLD_Y - 1, state.surface[surfaceIndex(x, z)] + 18);
            for (let y = 1; y <= yTop; y++) {
              const code = getBlock(x, y, z);
              if (code === TALL_GRASS || code === FLOWER) { setDecorLight(x, y, z); pushPlant(arr, x, y, z, code); }
              else if (code === GLOW_SHROOM || code === CAVE_CRYSTAL || code === DRIPSTONE_UP || code === DRIPSTONE_DOWN || code === CAVE_VINE) { setDecorLight(x, y, z); pushCaveFeature(arr, x, y, z, code); }
              if (code === TABLE) { setDecorLight(x, y, z); pushCraftingToilet(arr, x, y, z); }
              if (code === TORCH) { setDecorLight(x, y, z); pushTorch(arr, x, y, z); }
              if (code === CHEST) { setDecorLight(x, y, z); pushChest(arr, x, y, z); }
              if (code === BED) { setDecorLight(x, y, z); pushBed(arr, x, y, z); }
              if (code === DOOR || code === DOOR_OPEN) { setDecorLight(x, y, z); pushDoor(arr, x, y, z, code === DOOR_OPEN); }
              if (code === FURNACE) { setDecorLight(x, y, z); pushFurnace(arr, x, y, z); }
              if (code === CROP_1 || code === CROP_2 || code === CROP_3) { setDecorLight(x, y, z); pushCrop(arr, x, y, z, code); }
            }
            pushAquaticDecor(arr, x, z);
          }
        }
      }
    }
    if (arr.positions.length) decorGroup.add(buildMesh(arr, plantMaterial));
    dlR = dlG = dlB = 1;
    decorDirty = false;
  }
  function pushPlant(arr, x, y, z, code) {
    const biome = biomeAt(x, z);
    const grass = biomeRgb(biome, "grass");
    const seed = hash2(x * 53 + 7, z * 59 - 3);
    if (pushBiomePlant(arr, x, y, z, code, biome, seed)) return;
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
  function pushBiomePlant(arr, x, y, z, code, biome, seed) {
    const style = biome.floraStyle || "grass";
    if (style === "cactus") return pushCactusPlant(arr, x, y, z, seed);
    if (style === "frost") return pushFrostPlant(arr, x, y, z, seed, code);
    if (style === "reeds") return pushReedPlant(arr, x, y, z, seed, code);
    if (style === "neon") return pushNeonPlant(arr, x, y, z, seed, code);
    if (style === "crystal") return pushCrystalPlant(arr, x, y, z, seed, code);
    if (style === "ash") return pushAshBrush(arr, x, y, z, seed);
    if (style === "sapling") return pushPineSapling(arr, x, y, z, seed);
    if (style === "fern") return pushFernPlant(arr, x, y, z, seed);
    if (style === "wheat") return pushWheatPlant(arr, x, y, z, seed, code);
    if (style === "alpine") return pushAlpinePlant(arr, x, y, z, seed, code);
    if (style === "daisy" && code === FLOWER) return pushDaisyPlant(arr, x, y, z, seed);
    if (style === "clover" && code === FLOWER) return pushCloverPlant(arr, x, y, z, seed);
    return false;
  }
  function pushCactusPlant(arr, x, y, z, seed) {
    const cactus = vividRgb(cachedRgb("#5fa95a"), 1.12, 0.94);
    const cx = x + 0.4 + hash2(x + 13, z - 17) * 0.2;
    const cz = z + 0.4 + hash2(x - 19, z + 23) * 0.2;
    const h = 0.72 + seed * 0.72;
    pushTinyBox(arr, cx - 0.09, y, cz - 0.09, 0.18, h, 0.18, cactus);
    if (seed > 0.34) pushTinyBox(arr, cx + 0.05, y + h * 0.44, cz - 0.065, 0.26, 0.12, 0.13, cactus);
    if (seed > 0.68) pushTinyBox(arr, cx - 0.31, y + h * 0.58, cz - 0.06, 0.24, 0.12, 0.12, cactus);
    return true;
  }
  function pushFrostPlant(arr, x, y, z, seed, code) {
    const ice = vividRgb(cachedRgb(code === FLOWER ? "#dfffff" : "#bdeeff"), 1.08, 1.08);
    const cx = x + 0.5;
    const cz = z + 0.5;
    for (let i = 0; i < 4; i++) {
      const rot = seed * Math.PI * 2 + i * Math.PI / 4;
      pushBlade(arr, cx, y, cz, 0.1, 0.42 + seed * 0.34, ice, rot, (i % 2 ? 1 : -1) * 0.1);
    }
    if (code === FLOWER) pushTinyBox(arr, cx - 0.06, y + 0.48, cz - 0.06, 0.12, 0.1, 0.12, cachedRgb("#ffffff"));
    return true;
  }
  function pushReedPlant(arr, x, y, z, seed, code) {
    const reed = vividRgb(cachedRgb("#62d477"), 1.2, 0.98);
    const cattail = cachedRgb("#8a5a2f");
    const count = 3 + Math.floor(seed * 3);
    for (let i = 0; i < count; i++) {
      const ox = (hash2(x + i * 3, z - i * 5) - 0.5) * 0.46;
      const oz = (hash2(x - i * 7, z + i * 11) - 0.5) * 0.46;
      const h = 0.7 + hash2(x + i * 13, z - i * 17) * 0.85;
      pushBlade(arr, x + 0.5 + ox, y, z + 0.5 + oz, 0.07, h, reed, seed * Math.PI + i * 0.45, 0.04);
      if (code === FLOWER || i === 0) pushTinyBox(arr, x + 0.47 + ox, y + h * 0.72, z + 0.47 + oz, 0.06, 0.22, 0.06, cattail);
    }
    return true;
  }
  function pushNeonPlant(arr, x, y, z, seed, code) {
    const savedR = dlR, savedG = dlG, savedB = dlB;
    setDecorLightGlow();
    const colors = code === FLOWER ? ["#43e6ff", "#ff4fd8", "#faff6a"] : ["#34ffd2", "#8dff64"];
    const glow = vividRgb(cachedRgb(colors[Math.floor(seed * colors.length) % colors.length]), 1.35, 1.12);
    const cx = x + 0.5;
    const cz = z + 0.5;
    pushBlade(arr, cx, y, cz, 0.12, 0.5 + seed * 0.38, glow, seed * Math.PI * 2, 0.1);
    pushBlade(arr, cx, y, cz, 0.12, 0.44 + seed * 0.28, glow, seed * Math.PI * 2 + Math.PI / 2, -0.08);
    pushTinyBox(arr, cx - 0.08, y + 0.44, cz - 0.08, 0.16, 0.12, 0.16, glow);
    dlR = savedR; dlG = savedG; dlB = savedB;
    return true;
  }
  function pushCrystalPlant(arr, x, y, z, seed, code) {
    const crystal = vividRgb(cachedRgb(code === FLOWER ? "#d9fffb" : "#78ecff"), 1.28, 1.1);
    const count = 2 + Math.floor(seed * 4);
    for (let i = 0; i < count; i++) {
      const ox = 0.3 + hash2(x + i * 7, z - i * 11) * 0.4;
      const oz = 0.3 + hash2(x - i * 13, z + i * 17) * 0.4;
      const h = 0.28 + hash2(x + i * 19, z - i * 23) * 0.52;
      pushTinyBox(arr, x + ox - 0.05, y, z + oz - 0.05, 0.1, h, 0.1, crystal);
      pushTinyBox(arr, x + ox - 0.035, y + h, z + oz - 0.035, 0.07, 0.12, 0.07, vividRgb(crystal, 1.05, 1.14));
    }
    return true;
  }
  function pushAshBrush(arr, x, y, z, seed) {
    const twig = vividRgb(cachedRgb("#c9beb0"), 0.92, 0.88);
    for (let i = 0; i < 5; i++) {
      const rot = seed * Math.PI + i * 0.7;
      pushBlade(arr, x + 0.5, y, z + 0.5, 0.055, 0.32 + seed * 0.28, twig, rot, (i - 2) * 0.045);
    }
    return true;
  }
  function pushPineSapling(arr, x, y, z, seed) {
    const trunk = cachedRgb("#6f4624");
    const pine = vividRgb(cachedRgb("#1e9a45"), 1.2, 0.95);
    const cx = x + 0.5;
    const cz = z + 0.5;
    pushTinyBox(arr, cx - 0.035, y, cz - 0.035, 0.07, 0.42, 0.07, trunk);
    for (let i = 0; i < 3; i++) {
      const yy = y + 0.14 + i * 0.16;
      pushBlade(arr, cx, yy, cz, 0.48 - i * 0.09, 0.18, pine, seed * Math.PI + i, 0.02);
      pushBlade(arr, cx, yy, cz, 0.48 - i * 0.09, 0.18, pine, seed * Math.PI + Math.PI / 2 + i, -0.02);
    }
    return true;
  }
  function pushFernPlant(arr, x, y, z, seed) {
    const fern = vividRgb(cachedRgb("#35c55b"), 1.24, 0.96);
    const cx = x + 0.5;
    const cz = z + 0.5;
    for (let i = 0; i < 6; i++) {
      const rot = seed * Math.PI * 2 + i * Math.PI / 3;
      pushBlade(arr, cx, y + 0.04, cz, 0.11, 0.5, fern, rot, 0.18);
    }
    return true;
  }
  function pushWheatPlant(arr, x, y, z, seed, code) {
    const stem = vividRgb(cachedRgb("#d8c35f"), 1.05, 1.04);
    const head = cachedRgb(code === FLOWER ? "#fff0a6" : "#bfa442");
    const count = 4 + Math.floor(seed * 4);
    for (let i = 0; i < count; i++) {
      const ox = (hash2(x + i * 5, z - i * 3) - 0.5) * 0.5;
      const oz = (hash2(x - i * 7, z + i * 9) - 0.5) * 0.5;
      const h = 0.46 + hash2(x + i * 11, z - i * 13) * 0.44;
      pushBlade(arr, x + 0.5 + ox, y, z + 0.5 + oz, 0.055, h, stem, seed * Math.PI + i * 0.4, 0.08);
      pushTinyBox(arr, x + 0.47 + ox, y + h - 0.02, z + 0.47 + oz, 0.06, 0.13, 0.06, head);
    }
    return true;
  }
  function pushAlpinePlant(arr, x, y, z, seed, code) {
    const moss = vividRgb(cachedRgb("#b6e86b"), 1.16, 0.98);
    const bloom = cachedRgb(code === FLOWER ? "#fff0a6" : "#d9fff2");
    for (let i = 0; i < 4; i++) {
      const ox = (hash2(x + i * 17, z - i * 19) - 0.5) * 0.44;
      const oz = (hash2(x - i * 23, z + i * 29) - 0.5) * 0.44;
      pushBlade(arr, x + 0.5 + ox, y, z + 0.5 + oz, 0.1, 0.28 + seed * 0.2, moss, seed * Math.PI + i * 0.8, 0.05);
    }
    if (code === FLOWER) pushTinyBox(arr, x + 0.45, y + 0.24, z + 0.45, 0.1, 0.08, 0.1, bloom);
    return true;
  }
  function pushDaisyPlant(arr, x, y, z, seed) {
    const stem = vividRgb(cachedRgb("#57d66b"), 1.12, 0.98);
    const cx = x + 0.5;
    const cz = z + 0.5;
    pushBlade(arr, cx, y, cz, 0.08, 0.52, stem, seed * Math.PI, 0.04);
    for (let i = 0; i < 5; i++) pushBlade(arr, cx, y + 0.48, cz, 0.23, 0.13, cachedRgb("#ffffff"), i * 0.63, 0.01);
    pushTinyBox(arr, cx - 0.035, y + 0.53, cz - 0.035, 0.07, 0.06, 0.07, cachedRgb("#ffd75a"));
    return true;
  }
  function pushCloverPlant(arr, x, y, z, seed) {
    const leaf = vividRgb(cachedRgb("#3ee45a"), 1.24, 0.95);
    const bloom = cachedRgb("#ff6fa8");
    const cx = x + 0.5;
    const cz = z + 0.5;
    for (let i = 0; i < 4; i++) {
      const rot = seed * Math.PI + i * Math.PI / 2;
      pushBlade(arr, cx, y, cz, 0.22, 0.2, leaf, rot, 0.03);
    }
    pushTinyBox(arr, cx - 0.04, y + 0.2, cz - 0.04, 0.08, 0.08, 0.08, bloom);
    return true;
  }
  function pushAquaticDecor(arr, x, z) {
    if (x < 1 || z < 1 || x >= WORLD_X - 1 || z >= WORLD_Z - 1) return;
    const floorY = state.surface[surfaceIndex(x, z)];
    const depth = SEA_LEVEL - floorY;
    if (depth < 2 || getBlock(x, floorY + 1, z) !== WATER) return;
    const floor = getBlock(x, floorY, z);
    if (floor !== SAND && floor !== DIRT && floor !== STONE) return;
    setDecorLight(x, floorY + 1, z);
    const ocean = edgeOceanStrength(x, z);
    const roll = hash2(x * 97 + 13, z * 101 - 17);
    if (roll < 0.34 || (ocean > 0.32 && roll < 0.5)) pushSeaGrass(arr, x, floorY + 1, z, depth, roll);
    if (depth > 3 && roll > 0.58 && roll < 0.68) pushCoral(arr, x, floorY + 1, z, roll);
  }
  function pushSeaGrass(arr, x, y, z, depth, seed) {
    const clusters = 3 + Math.floor(hash2(x + 19, z - 23) * 4);
    const maxHeight = Math.min(depth - 0.45, 2.4);
    for (let i = 0; i < clusters; i++) {
      const ox = (hash2(x + i * 7, z - i * 11) - 0.5) * 0.62;
      const oz = (hash2(x - i * 13, z + i * 17) - 0.5) * 0.62;
      const h = clamp(0.45 + hash2(x + i * 23, z - i * 29) * 1.6, 0.3, maxHeight);
      const w = 0.09 + hash2(x - i * 31, z + i * 5) * 0.08;
      const color = vividRgb(mixRgb(cachedRgb("#1fbf7a"), cachedRgb("#83ff9b"), hash2(x + i, z - i) * 0.4), 1.22, 1.05);
      const rot = seed * Math.PI * 2 + i * 0.86;
      const lean = (hash2(x + i * 37, z - i * 41) - 0.5) * 0.22;
      pushBlade(arr, x + 0.5 + ox, y, z + 0.5 + oz, w, h, color, rot, lean);
      pushBlade(arr, x + 0.5 + ox * 0.7, y, z + 0.5 + oz * 0.7, w * 0.72, h * 0.82, color, rot + Math.PI / 2, -lean * 0.5);
    }
  }
  function pushCoral(arr, x, y, z, seed) {
    const palette = ["#ff6fa8", "#ffbd3f", "#43e6ff", "#9bff66"];
    const color = cachedRgb(palette[Math.floor(seed * palette.length) % palette.length]);
    const cx = x + 0.34 + hash2(x + 3, z - 5) * 0.32;
    const cz = z + 0.34 + hash2(x - 7, z + 11) * 0.32;
    pushTinyBox(arr, cx, y, cz, 0.22, 0.22, 0.22, vividRgb(color, 1.14, 1.04));
    pushTinyBox(arr, cx + 0.08, y + 0.16, cz + 0.05, 0.16, 0.34, 0.16, vividRgb(color, 1.18, 1.08));
    pushTinyBox(arr, cx - 0.08, y + 0.28, cz + 0.09, 0.14, 0.22, 0.14, vividRgb(color, 1.18, 1.1));
    pushTinyBox(arr, cx + 0.18, y + 0.38, cz - 0.05, 0.12, 0.18, 0.12, vividRgb(color, 1.22, 1.12));
  }
  function pushFish(arr, x, y, z, seed) {
    const palette = ["#ffbd3f", "#43e6ff", "#ff6fa8", "#e8fff3"];
    const color = cachedRgb(palette[Math.floor(seed * palette.length) % palette.length]);
    const cx = x + 0.3 + hash2(x + 41, z - 43) * 0.4;
    const cz = z + 0.3 + hash2(x - 47, z + 53) * 0.4;
    const body = vividRgb(color, 1.2, 1.12);
    pushTinyBox(arr, cx - 0.16, y, cz - 0.05, 0.32, 0.12, 0.1, body);
    pushTinyBox(arr, cx + 0.11, y + 0.02, cz - 0.035, 0.1, 0.08, 0.07, vividRgb(body, 1.05, 0.9));
    pushBlade(arr, cx - 0.2, y - 0.01, cz, 0.16, 0.18, body, seed * Math.PI * 2, 0.02);
  }
  function spawnFish() {
    disposeGroup(fishGroup);
    state.fish = [];
    for (let i = 0; i < FISH_COUNT; i++) {
      const spot = fishSpot(i);
      if (!spot) continue;
      const mesh = createFishMesh(i);
      const fish = {
        mesh,
        x: spot.x + 0.5,
        y: spot.y,
        z: spot.z + 0.5,
        homeX: spot.x + 0.5,
        homeZ: spot.z + 0.5,
        targetX: spot.x + 0.5,
        targetY: spot.y,
        targetZ: spot.z + 0.5,
        speed: 0.65 + hash2(i * 31 + 5, i * 37 - 7) * 0.55,
        phase: hash2(i * 41 - 3, i * 43 + 9) * Math.PI * 2,
        turn: hash2(i * 47 + 11, i * 53 - 13) * Math.PI * 2,
        targetTimer: 0,
      };
      chooseFishTarget(fish, i);
      fish.mesh.position.set(fish.x, fish.y, fish.z);
      fishGroup.add(fish.mesh);
      state.fish.push(fish);
    }
  }
  function fishSpot(i) {
    for (let tries = 0; tries < 180; tries++) {
      const x = 2 + Math.floor(hash2(i * 97 + tries * 11, i * 101 - tries * 13) * (WORLD_X - 4));
      const z = 2 + Math.floor(hash2(i * 103 - tries * 17, i * 107 + tries * 19) * (WORLD_Z - 4));
      const range = fishWaterRangeAt(x, z);
      if (!range || range.depth < 3) continue;
      const y = lerp(range.min, range.max, hash2(i * 109 + tries, i * 113 - tries));
      return { x, y, z };
    }
    return null;
  }
  function fishWaterRangeAt(x, z) {
    const ix = clamp(Math.floor(x), 1, WORLD_X - 2);
    const iz = clamp(Math.floor(z), 1, WORLD_Z - 2);
    const floorY = state.surface[surfaceIndex(ix, iz)];
    const depth = SEA_LEVEL - floorY;
    if (depth < 2 || getBlock(ix, floorY + 1, iz) !== WATER) return null;
    return {
      min: floorY + 1.25,
      max: Math.max(floorY + 1.45, SEA_LEVEL + 0.55),
      depth,
    };
  }
  function createFishMesh(seed) {
    const group = new THREE.Group();
    const bodyMat = fishMaterials[seed % fishMaterials.length];
    const finMat = fishMaterials[(seed + 1) % fishMaterials.length];
    addBox(group, [0, 0, 0], [0.44, 0.16, 0.22], bodyMat);
    addBox(group, [0, 0.01, -0.24], [0.2, 0.1, 0.16], finMat);
    addBox(group, [-0.18, 0.01, 0.03], [0.12, 0.04, 0.24], finMat);
    addBox(group, [0.18, 0.01, 0.03], [0.12, 0.04, 0.24], finMat);
    addBox(group, [-0.09, 0.045, 0.13], [0.045, 0.045, 0.03], enemyMaterials.black);
    addBox(group, [0.09, 0.045, 0.13], [0.045, 0.045, 0.03], enemyMaterials.black);
    group.scale.setScalar(1.05 + hash2(seed + 1, seed + 3) * 0.52);
    return group;
  }
  function chooseFishTarget(fish, salt) {
    const baseX = Math.floor(fish.homeX * 7 + salt * 23);
    const baseZ = Math.floor(fish.homeZ * 7 - salt * 29);
    for (let tries = 0; tries < 12; tries++) {
      const angle = hash2(baseX + tries * 5, baseZ - tries * 7) * Math.PI * 2;
      const dist = 2.5 + hash2(baseX - tries * 11, baseZ + tries * 13) * 9.5;
      const x = clamp(fish.homeX + Math.cos(angle) * dist, 1.5, WORLD_X - 1.5);
      const z = clamp(fish.homeZ + Math.sin(angle) * dist, 1.5, WORLD_Z - 1.5);
      const range = fishWaterRangeAt(x, z);
      if (!range) continue;
      fish.targetX = x;
      fish.targetZ = z;
      fish.targetY = lerp(range.min, range.max, hash2(baseX + tries * 17, baseZ - tries * 19));
      fish.targetTimer = 1.4 + hash2(baseX + tries * 31, baseZ - tries * 37) * 2.6;
      return true;
    }
    const range = fishWaterRangeAt(fish.homeX, fish.homeZ);
    if (range) {
      fish.targetX = fish.homeX;
      fish.targetZ = fish.homeZ;
      fish.targetY = lerp(range.min, range.max, 0.5);
      fish.targetTimer = 1.2;
      return true;
    }
    return false;
  }
  function updateFish(dt) {
    const now = performance.now() * 0.001;
    for (let i = 0; i < state.fish.length; i++) {
      const fish = state.fish[i];
      fish.targetTimer -= dt;
      const dx = fish.targetX - fish.x;
      const dy = fish.targetY - fish.y;
      const dz = fish.targetZ - fish.z;
      const dist = Math.hypot(dx, dy, dz);
      if (fish.targetTimer <= 0 || dist < 0.22 || !fishWaterRangeAt(fish.x, fish.z)) chooseFishTarget(fish, i + Math.floor(now * 5));
      const tx = fish.targetX - fish.x;
      const ty = fish.targetY - fish.y;
      const tz = fish.targetZ - fish.z;
      const len = Math.hypot(tx, ty, tz) || 1;
      const pulse = 0.82 + Math.sin(now * 2.8 + fish.phase) * 0.18;
      fish.x += (tx / len) * fish.speed * pulse * dt;
      fish.y += (ty / len) * fish.speed * 0.42 * dt;
      fish.z += (tz / len) * fish.speed * pulse * dt;
      const range = fishWaterRangeAt(fish.x, fish.z);
      if (range) fish.y = clamp(fish.y, range.min, range.max);
      if (Math.hypot(tx, tz) > 0.001) fish.turn = Math.atan2(tx, tz);
      fish.mesh.position.set(fish.x, fish.y + Math.sin(now * 5.2 + fish.phase) * 0.045, fish.z);
      fish.mesh.rotation.y = fish.turn;
      fish.mesh.rotation.x = Math.sin(now * 2 + fish.phase) * 0.08;
      fish.mesh.rotation.z = Math.sin(now * 5.8 + fish.phase) * 0.16;
      const tail = fish.mesh.children[1];
      if (tail) tail.rotation.y = Math.sin(now * 9.4 + fish.phase) * 0.65;
    }
  }
  function pushCaveFeature(arr, x, y, z, code) {
    const seed = hash3(x * 31 + 3, y * 37 - 5, z * 41 + 7);
    if (code === GLOW_SHROOM) {
      setDecorLightGlow();
      const stem = vividRgb(cachedRgb("#b7ffe8"), 1.12, 1.05);
      const cap = vividRgb(cachedRgb(seed > 0.5 ? "#65ffd7" : "#ff6fd6"), 1.35, 1.2);
      const cx = x + 0.38 + hash2(x + 5, z - 5) * 0.24;
      const cz = z + 0.38 + hash2(x - 7, z + 7) * 0.24;
      pushTinyBox(arr, cx, y, cz, 0.14, 0.34, 0.14, stem);
      pushTinyBox(arr, cx - 0.11, y + 0.28, cz - 0.11, 0.36, 0.13, 0.36, cap);
      if (seed > 0.62) {
        pushTinyBox(arr, cx + 0.22, y, cz + 0.16, 0.1, 0.22, 0.1, stem);
        pushTinyBox(arr, cx + 0.14, y + 0.18, cz + 0.08, 0.26, 0.1, 0.26, cap);
      }
      return;
    }
    if (code === CAVE_CRYSTAL) {
      setDecorLightGlow();
      const colors = ["#58eaff", "#9bff66", "#ffd75a", "#ff6fd6"];
      const crystal = vividRgb(cachedRgb(colors[Math.floor(seed * colors.length) % colors.length]), 1.3, 1.16);
      for (let i = 0; i < 4; i++) {
        const ox = 0.28 + hash2(x + i * 3, z - i * 5) * 0.36;
        const oz = 0.28 + hash2(x - i * 7, z + i * 11) * 0.36;
        const h = 0.28 + hash2(x + i * 13, z - i * 17) * 0.46;
        pushTinyBox(arr, x + ox, y, z + oz, 0.13, h, 0.13, crystal);
        pushTinyBox(arr, x + ox + 0.025, y + h, z + oz + 0.025, 0.08, 0.12, 0.08, vividRgb(crystal, 1.1, 1.14));
      }
      return;
    }
    if (code === CAVE_VINE) {
      const vine = vividRgb(cachedRgb("#3cff9e"), 1.28, 0.98);
      const strands = 2 + Math.floor(seed * 3);
      for (let i = 0; i < strands; i++) {
        const ox = 0.25 + hash2(x + i * 19, z - i * 23) * 0.5;
        const oz = 0.25 + hash2(x - i * 29, z + i * 31) * 0.5;
        const h = 0.55 + hash2(x + i * 37, z - i * 41) * 1.1;
        pushBlade(arr, x + ox, y + 1, z + oz, 0.08, -h, vine, seed * Math.PI + i * 0.6, 0.08);
      }
      return;
    }
    const drip = vividRgb(mixRgb(cachedRgb("#776657"), cachedRgb("#c4b092"), seed), 1.08, 1.02);
    const layers = code === DRIPSTONE_DOWN
      ? [[0.24, 0.78], [0.18, 0.48], [0.1, 0.22]]
      : [[0.3, 0.18], [0.2, 0.48], [0.1, 0.78]];
    for (let i = 0; i < layers.length; i++) {
      const w = layers[i][0];
      const off = layers[i][1];
      const yy = code === DRIPSTONE_DOWN ? y + 1 - off : y + off - 0.18;
      pushTinyBox(arr, x + 0.5 - w / 2, yy, z + 0.5 - w / 2, w, 0.22, w, drip);
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
      arr.colors.push(c[0] * dlR, c[1] * dlG, c[2] * dlB);
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
    const cx = x + 0.5;
    const cz = z + 0.5;
    // Centred wooden handle rising from the floor (lit by its surroundings).
    pushTinyBox(arr, cx - 0.07, y, cz - 0.07, 0.14, 0.46, 0.14, hexToRgb("#7c4a23"));
    pushTinyBox(arr, cx - 0.075, y + 0.42, cz - 0.075, 0.15, 0.14, 0.15, hexToRgb("#5a3a1e"));
    // Flame: glowing ember + tapering tongues that sit directly on the handle, no gap.
    const savedR = dlR, savedG = dlG, savedB = dlB;
    setDecorLightEmissive();
    pushTinyBox(arr, cx - 0.1, y + 0.5, cz - 0.1, 0.2, 0.12, 0.2, hexToRgb("#ff7a1a"));
    pushTinyBox(arr, cx - 0.105, y + 0.58, cz - 0.105, 0.21, 0.14, 0.21, hexToRgb("#ffb43a"));
    pushTinyBox(arr, cx - 0.08, y + 0.7, cz - 0.08, 0.16, 0.12, 0.16, hexToRgb("#ffe066"));
    pushTinyBox(arr, cx - 0.05, y + 0.8, cz - 0.05, 0.1, 0.1, 0.1, hexToRgb("#fff4b0"));
    dlR = savedR; dlG = savedG; dlB = savedB;
  }
  function pushCraftingToilet(arr, x, y, z) {
    const porcelain = cachedRgb("#ecf8ff");
    const shade = cachedRgb("#b8c6d2");
    const water = cachedRgb("#4ecaff");
    // The model is authored facing -Z (bowl toward -Z, tank at +Z). Rotate it in
    // 90° steps so the bowl faces whoever placed it.
    const turns = state.toiletFacing[`${x},${y},${z}`] | 0;
    const box = (lx, ly, lz, w, h, d, rgb) => pushRotatedBox(arr, x, y, z, lx, ly, lz, w, h, d, rgb, turns);
    box(0.18, 0, 0.18, 0.64, 0.32, 0.7, porcelain);   // base
    box(0.26, 0.26, 0.06, 0.48, 0.18, 0.34, shade);   // seat back lip
    box(0.32, 0.34, 0.18, 0.36, 0.05, 0.42, water);   // bowl water
    box(0.18, 0.42, 0.65, 0.64, 0.58, 0.22, porcelain); // tank
    box(0.24, 0.84, 0.59, 0.52, 0.16, 0.16, shade);   // tank lid
    box(0.69, 0.94, 0.66, 0.08, 0.05, 0.08, cachedRgb("#ffd75a")); // flush button
  }
  function pushChest(arr, x, y, z) {
    const wood = cachedRgb("#9b6532");
    const lid = cachedRgb("#7a4a23");
    const latch = cachedRgb("#caa24a");
    const turns = state.toiletFacing[`${x},${y},${z}`] | 0; // latch faces the placer (-Z)
    const box = (lx, ly, lz, w, h, d, rgb) => pushRotatedBox(arr, x, y, z, lx, ly, lz, w, h, d, rgb, turns);
    box(0.1, 0, 0.1, 0.8, 0.5, 0.8, wood);          // body
    box(0.08, 0.5, 0.08, 0.84, 0.22, 0.84, lid);    // lid
    box(0.42, 0.34, 0.05, 0.16, 0.22, 0.06, latch); // front latch
  }
  function pushBed(arr, x, y, z) {
    const frame = cachedRgb("#7c4e29");
    const sheet = cachedRgb("#d94f6a");
    const pillow = cachedRgb("#f3f4fb");
    const turns = state.toiletFacing[`${x},${y},${z}`] | 0; // pillow at the head (-Z)
    const box = (lx, ly, lz, w, h, d, rgb) => pushRotatedBox(arr, x, y, z, lx, ly, lz, w, h, d, rgb, turns);
    box(0.05, 0, 0.03, 0.9, 0.14, 0.94, frame);     // wooden base
    box(0.1, 0.14, 0.06, 0.8, 0.16, 0.88, sheet);   // blanket
    box(0.16, 0.3, 0.07, 0.68, 0.12, 0.24, pillow); // pillow
  }
  function pushDoor(arr, x, y, z, open) {
    const wood = cachedRgb("#b98245");
    const inset = cachedRgb("#7c4e29");
    const knob = cachedRgb("#caa24a");
    // The panel hangs on the -Z face; swinging open rotates it 90° onto the -X face,
    // which clears the cell so the (now non-solid) doorway is walkable.
    const turns = ((state.toiletFacing[`${x},${y},${z}`] | 0) + (open ? 1 : 0)) & 3;
    const box = (lx, ly, lz, w, h, d, rgb) => pushRotatedBox(arr, x, y, z, lx, ly, lz, w, h, d, rgb, turns);
    box(0.03, 0, 0.0, 0.94, 1.0, 0.16, wood);       // full-height panel
    box(0.12, 0.12, 0.015, 0.36, 0.3, 0.14, inset); // upper recessed panel
    box(0.12, 0.5, 0.015, 0.36, 0.36, 0.14, inset); // lower recessed panel
    box(0.82, 0.46, 0.0, 0.09, 0.12, 0.18, knob);   // handle
  }
  function pushFurnace(arr, x, y, z) {
    const stone = cachedRgb("#6e7078");
    const dark = cachedRgb("#3a3c44");
    const turns = state.toiletFacing[`${x},${y},${z}`] | 0; // opening faces the placer (-Z)
    const box = (lx, ly, lz, w, h, d, rgb) => pushRotatedBox(arr, x, y, z, lx, ly, lz, w, h, d, rgb, turns);
    box(0.04, 0, 0.04, 0.92, 0.98, 0.92, stone);      // stone body
    box(0.22, 0.1, 0.0, 0.56, 0.5, 0.06, dark);       // dark opening on the front
    const f = state.furnaces[`${x},${y},${z}`];
    if (f && f.burn > 0) {                              // glowing embers while lit
      const saved = [dlR, dlG, dlB]; setDecorLightEmissive();
      box(0.3, 0.12, 0.015, 0.4, 0.26, 0.05, cachedRgb("#ff7a1a"));
      dlR = saved[0]; dlG = saved[1]; dlB = saved[2];
    }
    box(0.16, 0.86, 0.16, 0.68, 0.12, 0.68, dark);    // chimney cap
  }
  function pushCrop(arr, x, y, z, code) {
    const stage = code === CROP_1 ? 0 : code === CROP_2 ? 1 : 2;
    const h = [0.26, 0.5, 0.78][stage];
    const col = code === CROP_1 ? cachedRgb("#7bd24a") : code === CROP_2 ? cachedRgb("#aacb46") : cachedRgb("#e7c65a");
    const tip = code === CROP_3 ? cachedRgb("#f6e08a") : col;
    // four little stalks in a row, taller and more golden as they ripen
    for (let i = 0; i < 4; i++) {
      const ox = 0.2 + (i % 2) * 0.42 + (hash2(x + i, z - i) - 0.5) * 0.08;
      const oz = 0.24 + Math.floor(i / 2) * 0.4 + (hash2(x - i, z + i) - 0.5) * 0.08;
      pushTinyBox(arr, x + ox, y, z + oz, 0.07, h, 0.07, col);
      if (code === CROP_3) pushTinyBox(arr, x + ox - 0.015, y + h - 0.12, z + oz - 0.015, 0.1, 0.14, 0.1, tip); // wheat head
    }
  }
  // Rotate a sub-box's footprint by `turns` quarter-turns (clockwise) around the
  // block centre, then emit it. lx/lz/w/d are local 0..1 coordinates.
  function pushRotatedBox(arr, bx, by, bz, lx, ly, lz, w, h, d, rgb, turns) {
    let nx = lx, nz = lz, nw = w, nd = d;
    for (let t = 0; t < (turns & 3); t++) {
      const px = nx, pz = nz, pw = nw, pd = nd;
      nx = pz; nz = 1 - px - pw; nw = pd; nd = pw;
    }
    pushTinyBox(arr, bx + nx, by + ly, bz + nz, nw, h, nd, rgb);
  }
  function pushTinyBox(arr, x, y, z, w, h, d, rgb) {
    const corners = [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z], [x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]];
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [1, 5, 6, 2], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0]];
    const r = rgb[0] * dlR, g = rgb[1] * dlG, b = rgb[2] * dlB;
    for (const f of faces) {
      const start = arr.positions.length / 3;
      for (const ci of f) {
        arr.positions.push(corners[ci][0], corners[ci][1], corners[ci][2]);
        arr.normals.push(0, 1, 0);
        arr.colors.push(r, g, b);
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
        stuckTimer: 0,
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
      updateBurningEntity(friendly, dt, 0.68);
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
    } else if (isNight() && roll < 0.12) {
      friendly.action = "sleep";
      friendly.actionTimer = 1.5 + roll * 3.2;
      friendly.buddy = -1;
    } else if (playerDist < 6.8 && roll < 0.24) {
      friendly.buddy = -1;
      if (playerDist > 3.3 && setFriendlyFollowTarget(friendly, salt)) {
        friendly.action = "follow";
        friendly.actionTimer = 1.1 + roll * 2.2;
      } else {
        friendly.action = "look";
        friendly.actionTimer = 0.9 + roll * 1.6;
        friendly.turn = Math.atan2(dxp, dzp) + Math.PI;
      }
    } else if (roll < 0.2 && chooseFriendlyBuddyAction(friendly, salt)) {
      return;
    } else if (friendly.type === 2 && roll < 0.44 && setFriendlyRoamTarget(friendly, salt, 1.4, 4.8, 0.15)) {
      friendly.action = "hop";
      friendly.actionTimer = 1.1 + roll * 2.1;
    } else if (roll < 0.9 && setFriendlyRoamTarget(friendly, salt, 1.4, 10.5, 0.28)) {
      friendly.action = "wander";
      friendly.actionTimer = 1.8 + roll * 3.2;
      friendly.buddy = -1;
    } else if (roll < 0.96) {
      friendly.action = friendly.type === 2 ? "peck" : "graze";
      friendly.actionTimer = 0.9 + roll * 1.35;
      friendly.buddy = -1;
    } else {
      friendly.action = "dance";
      friendly.actionTimer = 0.9 + roll * 1.5;
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
      friendly.stuckTimer = (friendly.stuckTimer || 0) + dt;
      if (friendly.stuckTimer > 0.16 && setFriendlyRoamTarget(friendly, salt + 137, 1.2, 5.5, 0.55)) {
        friendly.action = "wander";
        friendly.actionTimer = 1.2 + hash2(salt * 31 + 7, salt * 37 - 11) * 1.8;
        friendly.stuckTimer = 0;
        return false;
      }
      if (friendly.action === "flee") {
        const threat = nearestFriendlyThreat(friendly, 12);
        if (threat) chooseFriendlyFlee(friendly, threat, salt + 61);
      } else chooseFriendlyAction(friendly, salt + 61);
      return false;
    }
    const nextY = ground + 1;
    if (Math.abs(nextY - friendly.y) > 1.25) {
      friendly.stuckTimer = (friendly.stuckTimer || 0) + dt;
      chooseFriendlyAction(friendly, salt + 73);
      return false;
    }
    friendly.x = nx;
    friendly.z = nz;
    friendly.stuckTimer = 0;
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
    return setFriendlyFallbackStep(friendly, salt);
  }
  function setFriendlyFallbackStep(friendly, salt) {
    const baseGround = friendlyGroundAt(friendly.x, friendly.z);
    for (let ring = 0; ring < 3; ring++) {
      const dist = 1.15 + ring * 1.1;
      const start = hash2(salt * 59 + ring * 7, salt * 61 - ring * 11) * Math.PI * 2;
      for (let step = 0; step < 10; step++) {
        const angle = start + step * (Math.PI * 2 / 10);
        const tx = clamp(friendly.x + Math.cos(angle) * dist, 2.5, WORLD_X - 2.5);
        const tz = clamp(friendly.z + Math.sin(angle) * dist, 2.5, WORLD_Z - 2.5);
        const ground = friendlyGroundAt(tx, tz);
        if (ground === null) continue;
        if (baseGround !== null && Math.abs(ground - baseGround) > 1) continue;
        friendly.targetX = tx;
        friendly.targetZ = tz;
        return true;
      }
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
    const tx = clamp(buddy.x + dx / dist * 1.45, 2.5, WORLD_X - 2.5);
    const tz = clamp(buddy.z + dz / dist * 1.45, 2.5, WORLD_Z - 2.5);
    if (friendlyCanStandAt(tx, tz)) {
      friendly.targetX = tx;
      friendly.targetZ = tz;
    } else {
      setFriendlyRoamTarget(friendly, Math.floor((friendly.x + friendly.z) * 17), 1.2, 4.5, 0.45);
    }
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
    for (let i = 0; i < 720; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const elevation = 0.22 + hash2(i, 3) * 1.04;
      const r = 230 + hash2(i, 2) * 250;
      const flat = Math.cos(elevation) * r;
      const y = Math.sin(elevation) * r + 38;
      positions.push(Math.cos(a) * flat, y, Math.sin(a) * flat);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0, fog: false });
    const stars = new THREE.Points(geometry, material);
    stars.name = "stars";
    stars.frustumCulled = false;
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
    let x = WORLD_X / 2 + 0.5;
    let z = WORLD_Z / 2 + 0.5;
    let y = state.surface[surfaceIndex(Math.floor(x), Math.floor(z))] + 1.05;
    // Respawn at a slept-in bed when one is set and still there.
    const bed = state.bedSpawn;
    if (bed && inWorld(bed.x, bed.y, bed.z) && (getBlock(bed.x, bed.y - 1, bed.z) === BED || getBlock(bed.x, bed.y, bed.z) === BED)) {
      x = bed.x + 0.5; z = bed.z + 0.5; y = bed.y + 0.05;
    } else if (bed) {
      state.bedSpawn = null; // bed was removed
    }
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
    if (state.everHad) state.everHad[code] = true;
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
  function selectedCode() {
    const slot = selectedSlot();
    return slot ? slot.code : 0;
  }
  function selectedIsTorch() {
    return selectedCode() === TORCH;
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
    } else {
      state.openChest = null; // closing the bag also closes any open chest/furnace
      state.openFurnace = null;
    }
    bagRenderKey = null;
    playSfx(state.bagOpen ? "bagOpen" : "bagClose");
    renderBag();
  }
  function triggerHeldSwing(kind = "gather", sound = true) {
    state.swingKind = kind;
    state.swingTimer = kind === "attack" ? HELD_SWING_SECONDS : HELD_GATHER_SECONDS;
    if (sound && state.started && !state.paused && !state.crafting) {
      playSfx(kind === "attack" ? "swing" : "mineSwing");
    }
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
    const flying = state.creative && state.flying;
    const speedBuff = state.effects.speed > 0 ? SPEED_BUFF_MULT : 1;
    const baseSpeed = flying ? FLY_SPEED : (state.input.sprint ? SPRINT_SPEED : MOVE_SPEED);
    const speed = baseSpeed * (flying ? 1 : liquidMoveMult) * speedBuff;
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
    if (flying) {
      // Free flight: no gravity, Space rises and Shift descends.
      const vert = (state.input.jump ? 1 : 0) - (state.input.sprint ? 1 : 0);
      p.vy = vert * FLY_VERTICAL_SPEED;
      p.onGround = false;
    } else {
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
  // --- Food + temporary buffs -------------------------------------------------
  function isFood(code) { return !!(DEF[code] && DEF[code].food && DEF[code].kind !== "block"); }
  function tryEatSelected() {
    const slot = selectedSlot();
    if (!slot || !isFood(slot.code)) return false;
    const food = DEF[slot.code].food;
    const p = state.player;
    const wouldHeal = p.hp < MAX_HP && (food.heal || 0) > 0;
    if (!wouldHeal && !food.effects) {
      api.toast("Already at full HP", "");
      return true; // consumed the click, just no effect
    }
    if (food.heal) p.hp = clamp(p.hp + food.heal, 0, MAX_HP);
    if (food.effects) applyEffects(food.effects);
    state.counters.eaten++;
    if (!state.creative) decrementSelectedSlot();
    triggerHeldSwing("gather", false);
    playSfx("eat");
    if (food.effects) playSfx("buff", { key: "buff-food", volume: 0.9 });
    api.toast(food.msg || `Ate ${DEF[slot.code].name}`, "good");
    state.placeCd = EAT_COOLDOWN;
    return true;
  }
  function applyEffects(effects) {
    const e = state.effects;
    for (const key of ["regen", "speed", "strength", "resist"]) {
      if (effects[key]) e[key] = Math.max(e[key], effects[key]);
    }
  }
  function updateEffects(dt) {
    const e = state.effects;
    if (e.regen > 0) {
      e.regen = Math.max(0, e.regen - dt);
      if (!state.creative) state.player.hp = clamp(state.player.hp + REGEN_RATE * dt, 0, MAX_HP);
    }
    e.speed = Math.max(0, e.speed - dt);
    e.strength = Math.max(0, e.strength - dt);
    e.resist = Math.max(0, e.resist - dt);
  }

  // --- Base-building furniture --------------------------------------------------
  function chestKey(x, y, z) { return `${x},${y},${z}`; }
  function chestSlots(key) {
    if (!state.chests[key]) state.chests[key] = new Array(CHEST_SLOTS).fill(null);
    return state.chests[key];
  }
  function toggleChestAt(x, y, z) {
    const key = chestKey(x, y, z);
    if (state.openChest === key && state.bagOpen) { closeChest(); return; }
    state.openChest = key;
    chestSlots(key); // ensure it exists
    state.crafting = false;
    if (craftPanel) craftPanel.classList.remove("is-open");
    state.bagOpen = true;
    unlockPointer();
    bagRenderKey = null;
    renderBag();
    playSfx && playSfx("bagOpen");
  }
  function closeChest() {
    state.openChest = null;
    state.bagOpen = false;
    bagRenderKey = null;
    renderBag();
    playSfx && playSfx("bagClose");
  }
  // Move a whole stack from the player's inventory slot into the open chest.
  function depositToChest(area, idx) {
    if (!state.openChest) return;
    const list = area === "hotbar" ? state.hotbar : state.bag;
    const slot = list[idx];
    if (!slot) return;
    const left = addToSlotArray(chestSlots(state.openChest), slot.code, slot.n);
    if (left <= 0) list[idx] = null; else slot.n = left;
    bagRenderKey = null; updateHud();
  }
  // Move a whole stack from the open chest back into the player's inventory.
  function withdrawFromChest(idx) {
    if (!state.openChest) return;
    const slots = chestSlots(state.openChest);
    const slot = slots[idx];
    if (!slot) return;
    // Chests that aren't player-placed edits are structure loot — count the haul.
    if (!state.edits.has(state.openChest)) state.counters.looted++;
    giveItem(slot.code, slot.n);
    slots[idx] = null;
    bagRenderKey = null; updateHud();
  }
  // Generic "add as many as fit into this slot array" used by chest deposits.
  function addToSlotArray(slots, code, n, cap = maxStack(code)) {
    for (const s of slots) { if (s && s.code === code && s.n < cap) { const a = Math.min(n, cap - s.n); s.n += a; n -= a; if (n <= 0) return 0; } }
    for (let i = 0; i < slots.length && n > 0; i++) { if (!slots[i]) { const a = Math.min(n, cap); slots[i] = { code, n: a }; n -= a; } }
    return n;
  }
  // Drop a broken chest's contents at its position so nothing is lost.
  function spillChest(x, y, z) {
    const key = chestKey(x, y, z);
    const slots = state.chests[key];
    if (slots) { for (const s of slots) if (s) giveItem(s.code, s.n); delete state.chests[key]; }
    if (state.openChest === key) closeChest();
  }
  function sleepInBed(x, y, z) {
    state.bedSpawn = { x, y: y + 1, z };
    state.flags.slept = true;
    if (isNight()) {
      state.time = 0.0;            // jump to dawn
      state.spawnTimer = SPAWN_GRACE;
      state.mobs.slice().forEach(removeMob);
      state.mobs = [];
      state.player.hp = clamp(state.player.hp + 6, 0, MAX_HP);
      api.toast("You slept. Good morning! Respawn point set.", "good");
    } else {
      api.toast("Respawn point set. (Beds only skip the night.)", "");
    }
  }
  function toggleDoor(x, y, z) {
    const code = getBlock(x, y, z);
    if (code === DOOR) setBlock(x, y, z, DOOR_OPEN);
    else if (code === DOOR_OPEN) {
      // Don't slam a closed (solid) door shut on top of the player.
      if (boxContainsBlock(playerBox(), x, y, z)) { api.toast("Step back to close the door", ""); return; }
      setBlock(x, y, z, DOOR);
    }
    decorDirty = true;
    playSfx && playSfx("place");
  }

  // --- Furnace / smelting ------------------------------------------------------
  function furnaceState(key) {
    if (!state.furnaces[key]) state.furnaces[key] = { input: null, fuel: null, output: null, cook: 0, burn: 0, burnMax: 0 };
    return state.furnaces[key];
  }
  function toggleFurnaceAt(x, y, z) {
    const key = chestKey(x, y, z);
    if (state.openFurnace === key && state.bagOpen) { closeFurnace(); return; }
    state.openChest = null;
    state.openFurnace = key;
    furnaceState(key);
    state.crafting = false;
    if (craftPanel) craftPanel.classList.remove("is-open");
    state.bagOpen = true;
    unlockPointer();
    bagRenderKey = null;
    renderBag();
    playSfx("bagOpen");
  }
  function closeFurnace() {
    state.openFurnace = null;
    state.bagOpen = false;
    bagRenderKey = null;
    renderBag();
    playSfx("bagClose");
  }
  // Route a clicked inventory stack into the open furnace's fuel or input slot.
  function loadFurnace(area, idx) {
    if (!state.openFurnace) return;
    const f = furnaceState(state.openFurnace);
    const list = area === "hotbar" ? state.hotbar : state.bag;
    const slot = list[idx];
    if (!slot) return;
    // Smeltable items go to the input slot first (e.g. logs smelt to charcoal rather
    // than being burnt as fuel); pure fuels go to the fuel slot.
    const dest = SMELTING[slot.code] ? "input" : FUELS[slot.code] ? "fuel" : null;
    if (!dest) { api.toast("That can't be smelted or burned", ""); return; }
    if (f[dest] && f[dest].code !== slot.code) return; // slot occupied by another item
    const cap = maxStack(slot.code);
    if (!f[dest]) f[dest] = { code: slot.code, n: 0 };
    const add = Math.min(slot.n, cap - f[dest].n);
    f[dest].n += add; slot.n -= add;
    if (slot.n <= 0) list[idx] = null;
    bagRenderKey = null; updateHud();
  }
  function takeFurnace(which) {
    if (!state.openFurnace) return;
    const f = furnaceState(state.openFurnace);
    if (!f[which]) return;
    giveItem(f[which].code, f[which].n);
    f[which] = null;
    bagRenderKey = null; updateHud();
  }
  function spillFurnace(x, y, z) {
    const key = chestKey(x, y, z);
    const f = state.furnaces[key];
    if (f) { ["input", "fuel", "output"].forEach((s) => { if (f[s]) giveItem(f[s].code, f[s].n); }); delete state.furnaces[key]; }
    if (state.openFurnace === key) closeFurnace();
  }
  function updateFurnaces(dt) {
    let openChanged = false;
    for (const key in state.furnaces) {
      const f = state.furnaces[key];
      const recipe = f.input ? SMELTING[f.input.code] : null;
      const roomForOut = recipe && (!f.output || (f.output.code === recipe.out && f.output.n < maxStack(recipe.out)));
      if (f.burn > 0) f.burn = Math.max(0, f.burn - dt);
      // Ignite a fresh fuel only when there is something to smelt.
      if (f.burn <= 0 && recipe && roomForOut && f.fuel && FUELS[f.fuel.code]) {
        f.burnMax = FUELS[f.fuel.code];
        f.burn = f.burnMax;
        f.fuel.n -= 1; if (f.fuel.n <= 0) f.fuel = null;
      }
      if (f.burn > 0 && recipe && roomForOut) {
        f.cook += dt;
        if (f.cook >= recipe.time) {
          f.cook = 0;
          f.input.n -= 1; if (f.input.n <= 0) f.input = null;
          if (f.output) f.output.n += 1; else f.output = { code: recipe.out, n: 1 };
          state.counters.smelts++;
        }
        openChanged = true;
      } else if (f.cook > 0) {
        f.cook = Math.max(0, f.cook - dt * 2);
        openChanged = true;
      }
    }
    if (openChanged && state.openFurnace) bagRenderKey = null;
  }

  // --- Crop farming ------------------------------------------------------------
  function updateCrops(dt) {
    state.cropTick += dt;
    if (state.cropTick < 1.8) return;
    state.cropTick = 0;
    const px = Math.floor(state.player.x), pz = Math.floor(state.player.z), R = 30;
    const growChance = isNight() ? 0.12 : 0.28;
    const z0 = Math.max(1, pz - R), z1 = Math.min(WORLD_Z - 2, pz + R);
    const x0 = Math.max(1, px - R), x1 = Math.min(WORLD_X - 2, px + R);
    let grew = false;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const fy = state.surface[surfaceIndex(x, z)];
        const c = getBlock(x, fy + 1, z);
        if ((c !== CROP_1 && c !== CROP_2) || getBlock(x, fy, z) !== FARMLAND) continue;
        if (Math.random() < growChance) { setBlock(x, fy + 1, z, c === CROP_1 ? CROP_2 : CROP_3, true, false); grew = true; }
      }
    }
    if (grew) decorDirty = true;
  }
  function harvestCrop(x, y, z, code) {
    if (code === CROP_3) { giveItem(WHEAT, 1 + (hash3(x, y, z) < 0.5 ? 1 : 0)); giveItem(WHEAT_SEEDS, 1); state.counters.crops++; }
    else giveItem(WHEAT_SEEDS, 1); // immature crop just returns a seed
  }

  // --- Objectives / achievements ----------------------------------------------
  function completeAchievement(a) {
    if (state.achievements[a.id]) return;
    state.achievements[a.id] = true;
    if (a.score) addScore(a.score);
    if (a.item) giveItem(a.item[0], a.item[1]);
    api.toast(`🏆 ${a.name}${a.item ? " (+reward)" : ""} +${a.score}`, "good");
    playSfx("reward");
    if (state.goalsOpen) renderGoals();
  }
  function checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (state.achievements[a.id]) continue;
      try { if (a.done(state)) completeAchievement(a); } catch (e) { /* ignore bad probe */ }
    }
  }
  function achievementsEarned() { return ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length; }
  function toggleGoals(force) {
    state.goalsOpen = typeof force === "boolean" ? force : !state.goalsOpen;
    if (state.goalsOpen) { state.crafting = false; state.bagOpen = false; if (craftPanel) craftPanel.classList.remove("is-open"); unlockPointer(); checkAchievements(); }
    renderGoals();
    playSfx(state.goalsOpen ? "bagOpen" : "bagClose");
  }
  function progressText(a) {
    const c = state.counters;
    if (a.id === "miner") return `${Math.min(state.mined, 100)}/100`;
    if (a.id === "eat") return `${Math.min(c.eaten, 10)}/10`;
    if (a.id === "hunter") return `${Math.min(c.mobKills, 25)}/25`;
    if (a.id === "survive") return `Day ${state.day}/5`;
    return "";
  }
  function renderGoals() {
    if (!ui.goalsPanel) return;
    ui.goalsPanel.classList.toggle("is-open", state.goalsOpen);
    if (!state.goalsOpen) { ui.goalsPanel.innerHTML = ""; return; }
    const earned = achievementsEarned();
    const tiers = [];
    const seen = new Set();
    ACHIEVEMENTS.forEach((a) => { if (!seen.has(a.tier)) { seen.add(a.tier); tiers.push(a.tier); } });
    const body = tiers.map((tier) => {
      const rows = ACHIEVEMENTS.filter((a) => a.tier === tier).map((a) => {
        const done = !!state.achievements[a.id];
        const prog = !done ? progressText(a) : "";
        return `<div class="rizz3d-goal${done ? " is-done" : ""}">
          <span class="rizz3d-goal__icon" style="background:${a.icon}">${done ? "✓" : ""}</span>
          <span class="rizz3d-goal__text"><b>${a.name}</b><span>${a.desc}${prog ? ` · ${prog}` : ""}</span></span>
          <span class="rizz3d-goal__pts">+${a.score}</span>
        </div>`;
      }).join("");
      return `<div class="rizz3d-goal-tier">${tier}</div>${rows}`;
    }).join("");
    ui.goalsPanel.innerHTML = `
      <div class="rizz3d-goal-head">
        <strong>🏆 Objectives</strong>
        <span>${earned}/${ACHIEVEMENTS.length} complete — earn score &amp; rewards as you explore every system.</span>
      </div>
      <div class="rizz3d-goal-list">${body}</div>
      <button class="rizz3d-goal-close" data-goal-close type="button">Close (G)</button>`;
  }
  function hurtPlayer(dmg) {
    const p = state.player;
    if (state.creative) {
      p.hp = MAX_HP;
      p.hurtCd = 0;
      p.hurtAnim = 0;
      state.attackFlash = 0;
      return;
    }
    if (p.hurtCd > 0) return;
    if (state.effects.resist > 0) dmg *= RESIST_MULT;
    p.hp -= dmg;
    playSfx("hurt", { volume: clamp(dmg / 14, 0.55, 1.35) });
    p.hurtCd = DAMAGE_GRACE;
    p.hurtAnim = PLAYER_HURT_SECONDS;
    state.attackFlash = PLAYER_HURT_SECONDS;
    p.vy = Math.max(p.vy, 4);
    if (p.hp <= 0) {
      playSfx("death", { volume: 1.1 });
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
    hater: { hp: 10, speed: 2.35, roamSpeed: 0.58, damage: 7, score: 20, radius: 0.5, sight: 18, memory: 1.35, attackRange: 1.16 },
    clout: { hp: 16, speed: 1.9, roamSpeed: 0.48, damage: 11, score: 32, radius: 0.62, sight: 20, memory: 1.75, attackRange: 1.24 },
    phantom: { hp: 11, speed: 2.45, roamSpeed: 0.62, damage: 9, score: 34, radius: 0.52, sight: 24, memory: 1.5, attackRange: 1.2 },
    warden: { hp: 24, speed: 1.55, roamSpeed: 0.34, damage: 18, score: 56, radius: 0.74, sight: 17, memory: 2.4, attackRange: 1.38 },
    titan: { hp: 260, speed: 1.7, roamSpeed: 0.5, damage: 22, score: 600, radius: 1.45, sight: 40, memory: 6, attackRange: 2.0, boss: true },
  };
  // Loot dropped on death: [code, chance, min, max]. Every hostile drops Skibidi Goo.
  const MOB_LOOT = {
    toilet: [[SKIBIDI_GOO, 1, 1, 2], [COAL, 0.3, 1, 1]],
    skibidi: [[SKIBIDI_GOO, 1, 1, 2], [STICK, 0.3, 1, 2]],
    grimace: [[SKIBIDI_GOO, 1, 1, 3], [BERRY, 0.4, 1, 2]],
    rizzler: [[SKIBIDI_GOO, 1, 1, 2], [PLANKS, 0.25, 1, 2]],
    doomscroll: [[SKIBIDI_GOO, 1, 2, 3], [COAL, 0.35, 1, 2]],
    shadow: [[SKIBIDI_GOO, 1, 2, 3], [RIZZ, 0.3, 1, 1]],
    hater: [[SKIBIDI_GOO, 1, 1, 2], [STICK, 0.3, 1, 2]],
    clout: [[SKIBIDI_GOO, 1, 2, 3], [RIZZ, 0.25, 1, 1]],
    phantom: [[SKIBIDI_GOO, 1, 2, 3], [RIZZ, 0.35, 1, 1]],
    warden: [[SKIBIDI_GOO, 1, 3, 5], [SIGMA, 0.4, 1, 1], [RIZZ, 0.6, 1, 2]],
    titan: [[SIGMA_CROWN, 1, 1, 1], [SIGMA, 1, 8, 14], [RIZZ, 1, 10, 18], [SKIBIDI_GOO, 1, 12, 20], [GOLDEN_APPLE, 1, 1, 2], [SWORD_SIGMA, 1, 1, 1], [GLOWSTONE, 1, 4, 8]],
  };
  const CAVE_CREATURE = {
    glowbat: { name: "Glow Bat", hp: 5, speed: 2.0, roamSpeed: 0.78, damage: 0, score: 8, radius: 0.42, sight: 0, passive: true, flying: true, drop: RIZZ },
    oreMite: { name: "Ore Mite", hp: 7, speed: 1.45, roamSpeed: 0.5, damage: 2, score: 12, radius: 0.38, sight: 5.5, skittish: true, drop: COAL },
    caveCrawler: { name: "Cave Crawler", hp: 14, speed: 1.72, roamSpeed: 0.42, damage: 7, score: 28, radius: 0.58, sight: 10.5, memory: 1.7, attackRange: 1.18, drop: RIZZ },
    crystalMimic: { name: "Crystal Mimic", hp: 18, speed: 1.12, roamSpeed: 0.24, damage: 12, score: 42, radius: 0.64, sight: 8.5, memory: 2.2, attackRange: 1.25, drop: SIGMA },
  };
  const FRIENDLY_CONFIG = [
    { name: "Lilac", hp: 8, speed: 0.58, radius: 0.52, drops: 1 },
    { name: "Bunny", hp: 11, speed: 0.68, radius: 0.56, drops: 1 },
    { name: "Mog", hp: 16, speed: 0.74, radius: 0.6, drops: 2 },
  ];
  const FRIENDLY_DROP_MIN = 1;
  const FRIENDLY_DROP_VARIATION = 2;
  const NIGHT_SPAWN_QUICK_RETRY = 0.35;
  function getFriendlyConfig(type) {
    return FRIENDLY_CONFIG[type] || FRIENDLY_CONFIG[0];
  }
  function friendlyName(type) {
    return getFriendlyConfig(type).name || "friendly";
  }
  function spawnMob() {
    if (state.mobs.length >= Math.min(8 + state.day * 3, 28)) return false;
    const p = state.player;
    const serial = ++mobSpawnSerial;
    const tick = Math.floor(performance.now() * 0.017) + state.day * 997 + serial * 7919;
    for (let tries = 0; tries < 72; tries++) {
      let x;
      let z;
      if (tries < 54) {
        const angle = hash2(tick + tries * 31, state.day * 41 - tries * 13) * Math.PI * 2;
        const dist = 22 + hash2(state.day * 67 + tries * 19, tick - tries * 37) * 52;
        x = Math.round(p.x + Math.cos(angle) * dist);
        z = Math.round(p.z + Math.sin(angle) * dist);
      } else {
        x = 2 + Math.floor(hash2(tick + tries * 31, state.day * 41 - tries * 13) * (WORLD_X - 4));
        z = 2 + Math.floor(hash2(state.day * 67 + tries * 19, tick - tries * 37) * (WORLD_Z - 4));
      }
      x = clamp(x, 2, WORLD_X - 3);
      z = clamp(z, 2, WORLD_Z - 3);
      const dx = x + 0.5 - p.x;
      const dz = z + 0.5 - p.z;
      if (dx * dx + dz * dz < 20 * 20) continue;
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
        hp: Math.round(MOB[type].hp * (1 + Math.min(state.day - 1, 10) * 0.05)), // nights get tougher
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
      return true;
    }
    return false;
  }
  function chooseMobType(x, z, salt) {
    const roll = hash2(x + salt * 11, z - salt * 7);
    if (state.day >= 4 && roll > 0.82) return "warden";
    if (state.day >= 3 && roll > 0.72) return "phantom";
    if (state.day >= 3 && roll > 0.64) return "shadow";
    if (state.day >= 2 && roll > 0.54) return "clout";
    if (state.day >= 2 && roll > 0.46) return "doomscroll";
    if (roll > 0.36) return "hater";
    if (roll > 0.26) return "rizzler";
    if (roll > 0.14) return "skibidi";
    if (state.day >= 2 && roll > 0.06) return "grimace";
    return "toilet";
  }
  function mobDisplayName(type) {
    return {
      toilet: "Skibidi Toilet",
      grimace: "Grimace Shake",
      skibidi: "Skibidi Head",
      rizzler: "Rizzler",
      doomscroll: "Doomscroll",
      shadow: "Shadow Lurker",
      hater: "Hater Shade",
      clout: "Clout Chaser",
      phantom: "Cringe Phantom",
      warden: "Sigma Warden",
    }[type] || "Night Enemy";
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
    } else if (type === "hater") {
      addBox(group, [0, 0.45, 0], [0.58, 0.86, 0.5], enemyMaterials.shadow);
      addBox(group, [0, 0.98, -0.02], [0.48, 0.34, 0.42], enemyMaterials.black);
      addBox(group, [-0.13, 1.03, -0.26], [0.08, 0.08, 0.04], enemyMaterials.lime);
      addBox(group, [0.13, 1.03, -0.26], [0.08, 0.08, 0.04], enemyMaterials.lime);
      addBox(group, [0, 0.33, -0.3], [0.38, 0.08, 0.06], enemyMaterials.purple);
    } else if (type === "clout") {
      addBox(group, [0, 0.48, 0], [0.78, 0.9, 0.58], enemyMaterials.orange);
      addBox(group, [0, 1.02, -0.02], [0.62, 0.34, 0.5], enemyMaterials.pink);
      addBox(group, [-0.18, 1.08, -0.29], [0.09, 0.1, 0.04], enemyMaterials.cyan);
      addBox(group, [0.18, 1.08, -0.29], [0.09, 0.1, 0.04], enemyMaterials.cyan);
      addBox(group, [-0.46, 0.72, 0], [0.14, 0.52, 0.14], enemyMaterials.amber);
      addBox(group, [0.46, 0.72, 0], [0.14, 0.52, 0.14], enemyMaterials.amber);
      addBox(group, [0, 1.3, 0], [0.28, 0.16, 0.28], enemyMaterials.cyan);
    } else if (type === "phantom") {
      addBox(group, [0, 0.66, 0], [0.44, 1.05, 0.36], enemyMaterials.bone);
      addBox(group, [0, 1.28, -0.02], [0.42, 0.28, 0.34], enemyMaterials.porcelain);
      addBox(group, [-0.12, 1.32, -0.21], [0.07, 0.1, 0.04], enemyMaterials.cyan);
      addBox(group, [0.12, 1.32, -0.21], [0.07, 0.1, 0.04], enemyMaterials.cyan);
      addBox(group, [-0.36, 0.74, 0.02], [0.12, 0.72, 0.12], enemyMaterials.bone);
      addBox(group, [0.36, 0.74, 0.02], [0.12, 0.72, 0.12], enemyMaterials.bone);
      addBox(group, [0, 0.2, 0], [0.7, 0.18, 0.48], enemyMaterials.porcelainDark);
    } else if (type === "warden") {
      addBox(group, [0, 0.62, 0], [0.96, 1.18, 0.82], enemyMaterials.black);
      addBox(group, [0, 1.36, -0.02], [0.72, 0.44, 0.62], enemyMaterials.shadow);
      addBox(group, [-0.2, 1.44, -0.36], [0.1, 0.13, 0.05], enemyMaterials.red);
      addBox(group, [0.2, 1.44, -0.36], [0.1, 0.13, 0.05], enemyMaterials.red);
      addBox(group, [0, 0.82, -0.46], [0.52, 0.12, 0.08], enemyMaterials.cyan);
      addBox(group, [-0.58, 0.72, 0], [0.16, 0.74, 0.16], enemyMaterials.shadow);
      addBox(group, [0.58, 0.72, 0], [0.16, 0.74, 0.16], enemyMaterials.shadow);
    } else if (type === "titan") {
      // A towering Skibidi King — giant porcelain body, big head, gold crown.
      addBox(group, [0, 0.85, 0], [2.2, 1.7, 1.9], enemyMaterials.porcelain);
      addBox(group, [0, 1.5, -0.2], [1.7, 0.7, 0.7], enemyMaterials.porcelainDark);
      addBox(group, [0, 2.25, -0.1], [1.4, 0.95, 1.2], enemyMaterials.bone);
      addBox(group, [-0.34, 2.42, -0.62], [0.22, 0.22, 0.08], enemyMaterials.red);
      addBox(group, [0.34, 2.42, -0.62], [0.22, 0.22, 0.08], enemyMaterials.red);
      addBox(group, [0, 2.05, -0.66], [0.7, 0.12, 0.08], enemyMaterials.black);
      addBox(group, [0, 2.86, 0], [1.1, 0.3, 1.0], enemyMaterials.amber);   // crown band
      addBox(group, [-0.42, 3.08, 0], [0.18, 0.3, 0.18], enemyMaterials.amber);
      addBox(group, [0.42, 3.08, 0], [0.18, 0.3, 0.18], enemyMaterials.amber);
      addBox(group, [0, 3.08, 0], [0.18, 0.34, 0.18], enemyMaterials.amber);
      addBox(group, [-1.2, 0.9, 0], [0.34, 1.3, 0.34], enemyMaterials.porcelainDark); // arms
      addBox(group, [1.2, 0.9, 0], [0.34, 1.3, 0.34], enemyMaterials.porcelainDark);
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
  function spawnCaveCreatures() {
    disposeGroup(caveCreatureGroup);
    state.caveCreatures = [];
    for (let i = 0; i < CAVE_CREATURE_COUNT; i++) {
      const spot = caveCreatureSpot(i);
      if (!spot) continue;
      const type = chooseCaveCreatureType(spot, i);
      const cfg = CAVE_CREATURE[type] || CAVE_CREATURE.oreMite;
      const creature = {
        type,
        x: spot.x + 0.5,
        y: spot.y + (cfg.flying ? 1.75 + hash2(i * 17, i * 19) * 1.2 : 1),
        z: spot.z + 0.5,
        homeX: spot.x + 0.5,
        homeY: spot.y + 1,
        homeZ: spot.z + 0.5,
        targetX: spot.x + 0.5,
        targetY: spot.y + 1,
        targetZ: spot.z + 0.5,
        hp: cfg.hp,
        mode: cfg.passive ? "drift" : "wander",
        alertTimer: 0,
        wanderTimer: 0,
        hurtTimer: 0,
        attackTimer: 0,
        hitCd: 0,
        knockTimer: 0,
        knockX: 0,
        knockZ: 0,
        phase: hash2(i * 31 + 3, i * 37 - 5) * Math.PI * 2,
        turn: hash2(i * 41 - 7, i * 43 + 11) * Math.PI * 2,
        mesh: createCaveCreatureMesh(type),
      };
      creature.mesh.position.set(creature.x, creature.y, creature.z);
      caveCreatureGroup.add(creature.mesh);
      state.caveCreatures.push(creature);
    }
  }
  function caveCreatureSpot(i) {
    const cx = WORLD_X / 2;
    const cz = WORLD_Z / 2;
    for (let tries = 0; tries < 170; tries++) {
      const x = 3 + Math.floor(hash2(i * 101 + tries * 23, i * 103 - tries * 29) * (WORLD_X - 6));
      const z = 3 + Math.floor(hash2(i * 107 - tries * 31, i * 109 + tries * 37) * (WORLD_Z - 6));
      if (Math.hypot(x - cx, z - cz) < 24) continue;
      if (edgeOceanStrength(x, z) > 0.55) continue;
      const surface = state.surface[surfaceIndex(x, z)];
      const maxY = Math.min(surface - 5, SEA_LEVEL + 30);
      if (maxY < 8) continue;
      const y = 4 + Math.floor(hash3(x + tries * 3, i * 11 - tries, z - tries * 5) * (maxY - 4));
      const stand = caveStandYAt(x + 0.5, z + 0.5, y);
      if (stand === null) continue;
      if (getBlock(x, stand + 1, z) === WATER || getBlock(x, stand + 1, z) === LAVA) continue;
      if (torchLightAt(x, stand + 1, z) > 0.12) continue;
      return { x, y: stand, z };
    }
    return null;
  }
  function chooseCaveCreatureType(spot, salt) {
    const roll = hash3(spot.x + salt * 13, spot.y - salt * 17, spot.z + salt * 19);
    if (spot.y < LAVA_LEVEL + 14 && roll > 0.72) return "crystalMimic";
    if (roll > 0.58) return "caveCrawler";
    if (roll > 0.32) return "oreMite";
    return "glowbat";
  }
  function caveStandYAt(x, z, nearY) {
    const ix = clamp(Math.floor(x), 1, WORLD_X - 2);
    const iz = clamp(Math.floor(z), 1, WORLD_Z - 2);
    const surface = state.surface[surfaceIndex(ix, iz)];
    const start = clamp(Math.floor(nearY), 2, Math.max(2, surface - 4));
    for (let offset = 0; offset <= 3; offset++) {
      for (const y of [start - offset, start + offset]) {
        if (y < 2 || y >= surface - 3 || y >= WORLD_Y - 3) continue;
        const floor = getBlock(ix, y, iz);
        const feet = getBlock(ix, y + 1, iz);
        const head = getBlock(ix, y + 2, iz);
        if (!isSolidBlock(floor) || floor === BEDROCK) continue;
        if ((feet === AIR || isReplaceableDecor(feet)) && (head === AIR || isReplaceableDecor(head))) return y;
      }
    }
    return null;
  }
  function createCaveCreatureMesh(type) {
    const group = new THREE.Group();
    if (type === "glowbat") {
      addBox(group, [0, 0.28, 0], [0.42, 0.26, 0.28], caveMaterials.dark);
      addBox(group, [-0.48, 0.28, 0], [0.58, 0.08, 0.24], caveMaterials.glow);
      addBox(group, [0.48, 0.28, 0], [0.58, 0.08, 0.24], caveMaterials.glow);
      addBox(group, [-0.1, 0.34, -0.16], [0.07, 0.08, 0.04], caveMaterials.glowBlue);
      addBox(group, [0.1, 0.34, -0.16], [0.07, 0.08, 0.04], caveMaterials.glowBlue);
    } else if (type === "oreMite") {
      addBox(group, [0, 0.24, 0], [0.58, 0.32, 0.48], caveMaterials.mite);
      addBox(group, [0, 0.44, -0.02], [0.36, 0.22, 0.34], caveMaterials.stone);
      addBox(group, [-0.16, 0.5, -0.23], [0.07, 0.07, 0.04], enemyMaterials.black);
      addBox(group, [0.16, 0.5, -0.23], [0.07, 0.07, 0.04], enemyMaterials.black);
      for (let i = 0; i < 4; i++) addBox(group, [-0.32 + i * 0.21, 0.12, -0.26], [0.08, 0.08, 0.18], caveMaterials.mite);
    } else if (type === "caveCrawler") {
      addBox(group, [0, 0.34, 0], [0.78, 0.38, 0.66], caveMaterials.crawler);
      addBox(group, [0, 0.58, -0.08], [0.52, 0.34, 0.42], caveMaterials.dark);
      addBox(group, [-0.16, 0.64, -0.32], [0.09, 0.1, 0.04], caveMaterials.glowPink);
      addBox(group, [0.16, 0.64, -0.32], [0.09, 0.1, 0.04], caveMaterials.glowPink);
      for (let i = 0; i < 3; i++) {
        addBox(group, [-0.46, 0.24 + i * 0.06, -0.22 + i * 0.22], [0.12, 0.1, 0.36], caveMaterials.crawler);
        addBox(group, [0.46, 0.24 + i * 0.06, -0.22 + i * 0.22], [0.12, 0.1, 0.36], caveMaterials.crawler);
      }
    } else {
      addBox(group, [0, 0.34, 0], [0.72, 0.58, 0.68], caveMaterials.stone);
      addBox(group, [0, 0.84, 0], [0.46, 0.36, 0.46], caveMaterials.crystal);
      addBox(group, [-0.17, 0.54, -0.36], [0.09, 0.12, 0.04], caveMaterials.glowBlue);
      addBox(group, [0.17, 0.54, -0.36], [0.09, 0.12, 0.04], caveMaterials.glowBlue);
      addBox(group, [0, 0.26, -0.38], [0.34, 0.07, 0.04], enemyMaterials.red);
    }
    group.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
    return group;
  }
  function updateCaveCreatures(dt) {
    const p = state.player;
    const now = performance.now() * 0.001;
    for (let i = state.caveCreatures.length - 1; i >= 0; i--) {
      const creature = state.caveCreatures[i];
      const cfg = CAVE_CREATURE[creature.type] || CAVE_CREATURE.oreMite;
      const dx = p.x - creature.x;
      const dy = (p.y + 0.55) - creature.y;
      const dz = p.z - creature.z;
      const dist = Math.hypot(dx, dz) || 1;
      const seesPlayer = !cfg.passive && dist < (cfg.sight || 0) && Math.abs(dy) < 4.8 && !skyVisible(Math.floor(creature.x), Math.floor(creature.y), Math.floor(creature.z)) && clearMobSight(creature.x, creature.y + 0.35, creature.z, p.x, p.y + EYE_HEIGHT * 0.55, p.z);
      if (cfg.skittish && dist < 4.8) {
        creature.mode = "flee";
        creature.alertTimer = 1.2;
      } else if (seesPlayer) {
        creature.mode = "hunt";
        creature.alertTimer = cfg.memory || 1.2;
      } else if (creature.alertTimer > 0) {
        creature.alertTimer = Math.max(0, creature.alertTimer - dt);
      } else if (creature.mode === "hunt" || creature.mode === "flee") {
        creature.mode = cfg.passive || cfg.flying ? "drift" : "wander";
      }

      if (creature.knockTimer > 0) {
        creature.knockTimer -= dt;
        creature.x += creature.knockX * dt;
        creature.z += creature.knockZ * dt;
        creature.knockX *= 0.84;
        creature.knockZ *= 0.84;
      } else if (creature.mode === "hunt") {
        creature.x += (dx / dist) * cfg.speed * dt;
        creature.z += (dz / dist) * cfg.speed * dt;
      } else if (creature.mode === "flee") {
        creature.x -= (dx / dist) * cfg.speed * 1.25 * dt;
        creature.z -= (dz / dist) * cfg.speed * 1.25 * dt;
      } else {
        updateCaveCreatureWander(creature, cfg, dt, i);
      }
      creature.x = clamp(creature.x, 1, WORLD_X - 1);
      creature.z = clamp(creature.z, 1, WORLD_Z - 1);
      if (cfg.flying) {
        creature.y += Math.sin(now * 1.4 + creature.phase) * 0.01;
      } else {
        const ground = caveStandYAt(creature.x, creature.z, creature.y - 1);
        if (ground !== null) creature.y = ground + 1;
      }
      if (creature.hurtTimer > 0) creature.hurtTimer -= dt;
      if (creature.attackTimer > 0) creature.attackTimer -= dt;
      if (creature.hitCd > 0) creature.hitCd -= dt;
      if (creature.mode === "hunt" && dist < (cfg.attackRange || 1.1) && Math.abs(dy) < 1.9 && cfg.damage > 0 && creature.hitCd <= 0) {
        creature.attackTimer = CAVE_CREATURE_ATTACK_SECONDS;
        creature.hitCd = 1.05;
        hurtPlayer(cfg.damage);
      }
      updateBurningEntity(creature, dt, cfg.flying ? 0.28 : 0.55);
      if (creature.hp <= 0) {
        addScore(cfg.score || 5);
        playSfx("mobDown", { pitch: cfg.flying ? 1.35 : 1 });
        dropCaveCreatureLoot(creature, cfg);
        removeCaveCreature(creature, i);
        continue;
      }
      renderCaveCreature(creature, cfg, now, i);
    }
  }
  function updateCaveCreatureWander(creature, cfg, dt, salt) {
    creature.wanderTimer = Math.max(0, (creature.wanderTimer || 0) - dt);
    const tx = (creature.targetX || creature.x) - creature.x;
    const tz = (creature.targetZ || creature.z) - creature.z;
    const dist = Math.hypot(tx, tz);
    if (creature.wanderTimer <= 0 || dist < 0.35) chooseCaveCreatureTarget(creature, cfg, salt);
    const dx = (creature.targetX || creature.x) - creature.x;
    const dz = (creature.targetZ || creature.z) - creature.z;
    const len = Math.hypot(dx, dz) || 1;
    const speed = cfg.roamSpeed || 0.35;
    creature.x += (dx / len) * speed * dt;
    creature.z += (dz / len) * speed * dt;
    creature.turn = Math.atan2(dx, dz);
    if (cfg.flying) creature.y = lerp(creature.y, creature.targetY || creature.y, 0.025);
  }
  function chooseCaveCreatureTarget(creature, cfg, salt) {
    const baseX = Math.floor(creature.homeX * 9 + salt * 23);
    const baseZ = Math.floor(creature.homeZ * 9 - salt * 29);
    const baseY = Math.floor(creature.homeY);
    for (let tries = 0; tries < 10; tries++) {
      const angle = hash2(baseX + tries * 7, baseZ - tries * 11) * Math.PI * 2;
      const dist = 2.5 + hash2(baseX - tries * 13, baseZ + tries * 17) * 7.5;
      const tx = clamp(creature.homeX + Math.cos(angle) * dist, 2.5, WORLD_X - 2.5);
      const tz = clamp(creature.homeZ + Math.sin(angle) * dist, 2.5, WORLD_Z - 2.5);
      const ty = cfg.flying ? clamp(baseY + 1.4 + (hash2(baseX + tries, baseZ - tries) - 0.5) * 3.2, 4, WORLD_Y - 4) : baseY;
      if (cfg.flying) {
        if (getBlock(Math.floor(tx), Math.floor(ty), Math.floor(tz)) === AIR && !skyVisible(Math.floor(tx), Math.floor(ty), Math.floor(tz))) {
          creature.targetX = tx;
          creature.targetY = ty;
          creature.targetZ = tz;
          creature.wanderTimer = 1.2 + hash2(baseX + tries * 19, baseZ - tries * 23) * 2.8;
          return;
        }
      } else {
        const ground = caveStandYAt(tx, tz, baseY);
        if (ground !== null) {
          creature.targetX = tx;
          creature.targetY = ground + 1;
          creature.targetZ = tz;
          creature.wanderTimer = 1.2 + hash2(baseX + tries * 19, baseZ - tries * 23) * 2.8;
          return;
        }
      }
    }
    creature.targetX = creature.homeX;
    creature.targetY = creature.homeY + (cfg.flying ? 1.4 : 0);
    creature.targetZ = creature.homeZ;
    creature.wanderTimer = 1;
  }
  function renderCaveCreature(creature, cfg, now, salt) {
    const hurtPulse = creature.hurtTimer > 0 ? Math.sin((1 - creature.hurtTimer / CAVE_CREATURE_HURT_SECONDS) * Math.PI) : 0;
    const attackPulse = creature.attackTimer > 0 ? Math.sin((1 - creature.attackTimer / CAVE_CREATURE_ATTACK_SECONDS) * Math.PI) : 0;
    const bob = Math.sin(now * (cfg.flying ? 5.6 : 2.8) + creature.phase) * (cfg.flying ? 0.16 : 0.04);
    const faceX = creature.mode === "hunt" ? state.player.x - creature.x : Math.sin(creature.turn || 0);
    const faceZ = creature.mode === "hunt" ? state.player.z - creature.z : Math.cos(creature.turn || 0);
    creature.mesh.position.set(creature.x, creature.y + bob + hurtPulse * 0.09, creature.z);
    creature.mesh.rotation.y = Math.atan2(faceX, faceZ) + Math.PI;
    creature.mesh.rotation.x = creature.mode === "hunt" ? -attackPulse * 0.22 : Math.sin(now * 1.4 + salt) * 0.04;
    creature.mesh.rotation.z = cfg.flying ? Math.sin(now * 6 + creature.phase) * 0.18 : Math.sin(now * 2 + creature.phase) * 0.04;
    const base = creature.type === "glowbat" ? 1.0 : creature.type === "crystalMimic" ? 1.18 : 1.08;
    creature.mesh.scale.set(base + hurtPulse * 0.12, base - attackPulse * 0.06 + hurtPulse * 0.06, base + hurtPulse * 0.12);
    applyCreatureFlash(creature, hurtPulse, attackPulse);
  }
  function damageCaveCreature(creature, damage) {
    const cfg = CAVE_CREATURE[creature.type] || CAVE_CREATURE.oreMite;
    const dx = creature.x - state.player.x;
    const dz = creature.z - state.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    creature.hp -= damage;
    creature.hurtTimer = CAVE_CREATURE_HURT_SECONDS;
    creature.knockTimer = 0.16;
    creature.knockX = (dx / dist) * 3;
    creature.knockZ = (dz / dist) * 3;
    if (!cfg.passive && !cfg.skittish) creature.mode = "hunt";
    else creature.mode = "flee";
    creature.alertTimer = cfg.memory || 1.4;
    playSfx("hitMob", { pitch: creature.type === "glowbat" ? 1.45 : creature.type === "crystalMimic" ? 1.2 : 1 });
    spawnHitBurst(creature.x, creature.y + 0.45, creature.z, cachedRgb(creature.type === "crystalMimic" ? "#58eaff" : "#b7ffe8"));
  }
  function dropCaveCreatureLoot(creature, cfg) {
    if (!cfg.drop) return;
    const bonus = creature.type === "crystalMimic" && hash2(creature.x, creature.z) > 0.62 ? 1 : 0;
    giveItem(cfg.drop, 1 + bonus);
    spawnBurst(creature.x, creature.y + 0.4, creature.z, DEF[cfg.drop].rgb || cachedRgb("#ffffff"), 7 + bonus * 4, 2.4);
  }
  function applyCreatureFlash(creature, hurtPulse, attackPulse) {
    if (!creature.mesh) return;
    creature.mesh.traverse((child) => {
      if (!child.material || !child.material.color || !child.userData.baseColor) return;
      child.material.color.copy(child.userData.baseColor);
      if (attackPulse > 0) child.material.color.lerp(mobAttackColor, attackPulse * 0.24);
      if (hurtPulse > 0) child.material.color.lerp(mobHurtColor, hurtPulse * 0.78);
    });
  }
  function removeCaveCreature(creature, index) {
    if (index >= 0) removeAtIndex(state.caveCreatures, index);
    caveCreatureGroup.remove(creature.mesh);
    disposeMesh(creature.mesh);
  }
  function caveCreatureName(type) {
    const cfg = CAVE_CREATURE[type];
    return cfg ? cfg.name : "Cave Creature";
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
      if (!cfg.boss && !isNight() && skyVisible(Math.floor(mob.x), Math.floor(mob.y), Math.floor(mob.z))) {
        mob.hp -= dt * 5;
      }
      updateBurningEntity(mob, dt, 0.82);
      if (mob.hp <= 0) {
        addScore(cfg.score);
        if (cfg.boss) state.counters.bossKills++; else state.counters.mobKills++;
        playSfx("mobDown", { pitch: cfg.boss ? 0.6 : mob.type === "warden" ? 0.8 : 1 });
        dropMobLoot(mob);
        if (cfg.boss) {
          api.toast("The Skibidi Titan falls! Loot secured.", "good");
          spawnBurst(mob.x, mob.y + 1.4, mob.z, cachedRgb("#ffd75a"), 40, 4.2);
        }
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
      if (code !== AIR && code !== WATER && !isReplaceableDecor(code)) return false;
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
    playSfx("hitMob", { pitch: mob.type === "phantom" ? 1.24 : mob.type === "warden" ? 0.82 : 1 });
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
  function dropMobLoot(mob) {
    const table = MOB_LOOT[mob.type];
    if (!table) return;
    const seed = Math.floor((mob.x * 53 + mob.z * 131 + performance.now() * 0.03));
    table.forEach(([code, chance, min, max], k) => {
      if (hash2(seed + k * 17, seed - k * 31) > chance) return;
      const n = min + Math.floor(hash2(seed + k * 7, mob.z + k) * (max - min + 1));
      if (n > 0) giveItem(code, n);
    });
    spawnBurst(mob.x, mob.y + 0.6, mob.z, cachedRgb("#9be870"), 5, 1.8);
  }
  function bossActive() { return state.mobs.some((m) => MOB[m.type] && MOB[m.type].boss); }
  function summonBoss() {
    if (bossActive()) { api.toast("A Titan already stalks the land", "bad"); return false; }
    const p = state.player;
    // place it a short distance in front of the player on solid ground
    const yaw = p.yaw;
    let bx = Math.round(p.x - Math.sin(yaw) * 7);
    let bz = Math.round(p.z - Math.cos(yaw) * 7);
    bx = clamp(bx, 3, WORLD_X - 4); bz = clamp(bz, 3, WORLD_Z - 4);
    const by = state.surface[surfaceIndex(bx, bz)] + 1;
    const mob = {
      type: "titan", x: bx + 0.5, y: by, z: bz + 0.5, hp: MOB.titan.hp, maxHp: MOB.titan.hp,
      mode: "hunt", turn: yaw + Math.PI, alertTimer: 99, wanderTimer: 0, targetX: p.x, targetZ: p.z,
      hitCd: 0, hurtTimer: 0, attackTimer: 0, knockTimer: 0, knockX: 0, knockZ: 0, mesh: createMobMesh("titan"),
    };
    mob.mesh.position.set(mob.x, mob.y, mob.z);
    mobGroup.add(mob.mesh);
    state.mobs.push(mob);
    api.toast("☠️ The SKIBIDI TITAN rises! Defend yourself!", "bad");
    playSfx("nightfall");
    spawnBurst(mob.x, mob.y + 1.5, mob.z, cachedRgb("#8a4fd6"), 30, 3.6);
    return true;
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
    chooseFriendlyFlee(friendly, state.player, Math.floor((friendly.x + friendly.z) * 31));
    playSfx("hitSoft", { pitch: 1.1 });
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
    // Sometimes they also drop a raw drumstick to cook at the furnace.
    const meat = 1 + Math.floor(hash2(friendly.z, friendly.x) * 2);
    if (hash2(friendly.x + 7, friendly.z - 3) < 0.6) giveItem(RAW_MEAT, meat);
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
      else if (selectedIsBlock() && !state.creative) ui.target.textContent = `${DEF[code].name} - select a tool to mine`;
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
    const torchSelected = selectedIsTorch();
    if (selectedIsBlock() && !torchSelected && !state.creative) {
      state.mining = null;
      ui.progress.style.width = "0%";
      return;
    }
    if (tryAttack()) return;
    if (torchSelected) {
      state.mining = null;
      ui.progress.style.width = "0%";
      if (state.swingTimer <= 0.02) triggerHeldSwing("attack");
      return;
    }
    const t = state.target;
    if (!t || !t.hit) {
      state.mining = null;
      return;
    }
    const code = getBlock(t.x, t.y, t.z);
    if (code === BEDROCK || code === WATER || code === LAVA) return;
    const need = state.creative ? 0.04 : breakTimeFor(code);
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
    playBreakSfx(code);
    setBlock(x, y, z, AIR);
    flowLiquidsNear(x, y, z);
    state.mined++;
    addScore(1);
    if (d.drop !== null && canDrop(code)) giveItem(d.drop === undefined ? code : d.drop, 1);
    if (code === CROP_1 || code === CROP_2 || code === CROP_3) harvestCrop(x, y, z, code);
    // Foraging: greenery occasionally yields seeds/berries to kick off farming.
    const forage = hash3(x * 13 + 5, y * 17 - 3, z * 19 + 7);
    if (code === TALL_GRASS && forage < 0.4) giveItem(WHEAT_SEEDS, 1);
    else if (code === LEAVES && forage < 0.12) giveItem(BERRY, 1);
    api.toast(`Mined ${d.name}`, "");
  }
  function updatePlacing(dt) {
    if (state.placeCd > 0) state.placeCd -= dt;
    if ((!state.input.place && !state.placeQueued) || state.placeCd > 0 || state.crafting || state.paused) return;
    state.placeQueued = false;
    const t = state.target;
    const aimed = (t && t.hit) ? getBlock(t.x, t.y, t.z) : AIR;
    // Right-clicking an interactive block always takes priority over placing/eating.
    if (t && t.hit) {
      if (aimed === TABLE) { toggleCrafting(true); state.placeCd = 0.24; state.input.place = false; return; }
      if (aimed === CHEST) { toggleChestAt(t.x, t.y, t.z); state.placeCd = 0.24; state.input.place = false; return; }
      if (aimed === BED) { sleepInBed(t.x, t.y, t.z); state.placeCd = 0.3; state.input.place = false; return; }
      if (aimed === DOOR || aimed === DOOR_OPEN) { toggleDoor(t.x, t.y, t.z); state.placeCd = 0.22; state.input.place = false; return; }
      if (aimed === FURNACE) { toggleFurnaceAt(t.x, t.y, t.z); state.placeCd = 0.24; state.input.place = false; return; }
    }
    // Farming: a hoe tills soil, seeds plant on tilled soil.
    const held = selectedSlot();
    if (t && t.hit && held) {
      const heldDef = DEF[held.code];
      const above = getBlock(t.x, t.y + 1, t.z);
      if (heldDef.tool && heldDef.tool.type === "hoe" && (aimed === GRASS || aimed === DIRT) && above === AIR) {
        setBlock(t.x, t.y, t.z, FARMLAND); playSfx("place"); triggerHeldSwing("gather");
        state.placeCd = 0.25; state.input.place = false; return;
      }
      if (held.code === WHEAT_SEEDS && aimed === FARMLAND && above === AIR) {
        setBlock(t.x, t.y + 1, t.z, CROP_1); decorDirty = true;
        if (!state.creative) decrementSelectedSlot();
        playSfx("place"); state.placeCd = 0.2; state.input.place = false; return;
      }
    }
    // Cursed Idol: right-click to summon the boss.
    if (held && held.code === CURSED_IDOL) {
      if (summonBoss() && !state.creative) decrementSelectedSlot();
      state.placeCd = 0.5; state.input.place = false; return;
    }
    // Eating (when holding food and not aiming at an interactive block).
    if (isFood(selectedSlot() && selectedSlot().code)) {
      tryEatSelected();
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
    const facesPlacer = slot.code === TABLE || slot.code === CHEST || slot.code === BED || slot.code === DOOR;
    if (facesPlacer) state.toiletFacing[`${p.x},${p.y},${p.z}`] = toiletTurnsToward(p.x, p.z);
    setBlock(p.x, p.y, p.z, slot.code);
    playPlaceSfx(slot.code);
    if (facesPlacer) decorDirty = true;
    state.counters.placed++;
    if (slot.code === TABLE) state.flags.placedTable = true;
    else if (slot.code === CHEST) state.flags.placedChest = true;
    else if (slot.code === TORCH || slot.code === GLOWSTONE || slot.code === SIGMA_LANTERN) state.flags.placedLight = true;
    if (!state.creative) decrementSelectedSlot();
    state.placeCd = 0.18;
    state.input.place = false;
  }
  // Quarter-turns so the toilet's bowl faces the player who placed it.
  function toiletTurnsToward(cellX, cellZ) {
    const dx = state.player.x - (cellX + 0.5);
    const dz = state.player.z - (cellZ + 0.5);
    if (Math.abs(dx) >= Math.abs(dz)) return dx < 0 ? 1 : 3;
    return dz < 0 ? 0 : 2;
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
    for (const creature of state.caveCreatures) {
      const cfg = CAVE_CREATURE[creature.type] || CAVE_CREATURE.oreMite;
      allTargets.push({
        kind: "cave",
        type: creature.type,
        target: creature,
        radius: cfg.radius,
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
    const fireHit = selectedIsTorch();
    if (hit.kind === "friendly") {
      damageFriendly(hit.target, damage);
      if (fireHit) applyTorchBurn(hit.target, 0.68);
      api.toast(`Hit ${friendlyName(hit.type)} -${damage}${fireHit ? " fire" : ""}`, "");
    } else if (hit.kind === "cave") {
      damageCaveCreature(hit.target, damage);
      if (fireHit) applyTorchBurn(hit.target, 0.55);
      api.toast(`Hit ${caveCreatureName(hit.type)} -${damage}${fireHit ? " fire" : ""}`, "");
    } else {
      damageMob(hit.target, damage);
      if (fireHit) applyTorchBurn(hit.target, 0.82);
      api.toast(`Hit ${mobDisplayName(hit.type)} -${damage}${fireHit ? " fire" : ""}`, "");
    }
    state.attackCd = 0.32;
    return true;
  }
  function heldAttackDamage() {
    return Math.round((baseHeldAttackDamage() + (state.effects.strength > 0 ? STRENGTH_BUFF : 0)) * 10) / 10;
  }
  function baseHeldAttackDamage() {
    const slot = selectedSlot();
    if (!slot) return 1;
    const d = DEF[slot.code];
    if (!d) return 1;
    const tool = d.tool;
    if (slot.code === TORCH) return TORCH_FIRE_DAMAGE;
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
  function applyTorchBurn(target, yOffset) {
    if (!target) return;
    target.burnTimer = Math.max(target.burnTimer || 0, TORCH_BURN_SECONDS);
    target.burnDps = TORCH_BURN_DPS;
    target.burnFxTimer = 0;
    spawnFireBurst(target.x, target.y + yOffset, target.z, 8, 2.2);
  }
  function updateBurningEntity(entity, dt, yOffset) {
    if (!entity || !(entity.burnTimer > 0)) return;
    entity.burnTimer = Math.max(0, entity.burnTimer - dt);
    entity.hp -= (entity.burnDps || TORCH_BURN_DPS) * dt;
    entity.burnFxTimer = Math.max(0, (entity.burnFxTimer || 0) - dt);
    if (entity.burnFxTimer <= 0 && state.fx.length < 120) {
      spawnFireBurst(entity.x, entity.y + yOffset, entity.z, 3, 0.9);
      entity.burnFxTimer = 0.28;
    }
  }
  function spawnFireBurst(x, y, z, count = 6, power = 1.4) {
    for (let i = 0; i < count; i++) {
      const hot = i % 3 === 0 ? cachedRgb("#fff4b0") : i % 2 === 0 ? cachedRgb("#ffd75a") : cachedRgb("#ff6a1a");
      spawnBurst(
        x + (hash3(x + i, y, z) - 0.5) * 0.28,
        y + (hash3(x, y + i, z) - 0.5) * 0.18,
        z + (hash3(x, y, z + i) - 0.5) * 0.28,
        hot,
        1,
        power
      );
    }
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
    playSfx(recipe.out.code === SWORD_SIGMA ? "sigmaCraft" : "craft");
    api.toast(`Crafted ${DEF[recipe.out.code].name}`, "good");
    renderCrafting();
    return true;
  }
  function toggleCrafting(force) {
    if (!state.started) return;
    state.crafting = typeof force === "boolean" ? force : !state.crafting;
    if (craftPanel) craftPanel.classList.toggle("is-open", state.crafting);
    playSfx(state.crafting ? "craftOpen" : "craftClose");
    if (state.crafting) {
      state.bagOpen = false;
      if (state.goalsOpen) toggleGoals(false);
      renderBag();
      unlockPointer();
      renderCrafting();
    }
  }
  function renderCrafting() {
    if (!craftList) return;
    const near = nearTable();
    const recipes = RECIPES.map((r, i) => {
      const ok = canCraft(r);
      const tableLocked = !!(r.table && !near);
      const food = DEF[r.out.code] && DEF[r.out.code].food;
      const missing = r.in.reduce((sum, [code, n]) => sum + Math.max(0, n - countItem(code)), 0);
      return { r, i, ok, tableLocked, food, missing, cat: r.cat || "Other" };
    });
    const cats = [];
    const seen = new Set();
    RECIPES.forEach((r) => { const c = r.cat || "Other"; if (!seen.has(c)) { seen.add(c); cats.push(c); } });
    if (!["All", "Ready", ...cats].includes(craftFilter)) craftFilter = "All";
    const readyCount = recipes.filter((entry) => entry.ok).length;
    if (craftStatus) {
      craftStatus.textContent = near ? "Crafting Toilet nearby" : "Basics only - stand near a Crafting Toilet";
      craftStatus.classList.toggle("is-ready", near);
    }
    if (craftTabs) {
      const tabs = [
        { id: "All", label: "All", count: recipes.length },
        { id: "Ready", label: "Ready", count: readyCount },
        ...cats.map((cat) => ({ id: cat, label: cat, count: recipes.filter((entry) => entry.cat === cat).length })),
      ];
      craftTabs.innerHTML = tabs.map((tab) => `<button class="craft-tab${craftFilter === tab.id ? " is-active" : ""}" type="button" data-craft-filter="${escapeAttr(tab.id)}">${escapeWorldHtml(tab.label)}<b>${tab.count}</b></button>`).join("");
      craftTabs.querySelectorAll("[data-craft-filter]").forEach((button) => {
        button.addEventListener("click", () => {
          primeAudio();
          craftFilter = button.dataset.craftFilter || "All";
          renderCrafting();
        });
      });
    }
    const visibleCats = cats.filter((cat) => {
      if (craftFilter === "All") return true;
      if (craftFilter === "Ready") return recipes.some((entry) => entry.cat === cat && entry.ok);
      return craftFilter === cat;
    });
    craftList.innerHTML = cats.map((cat) => {
      if (!visibleCats.includes(cat)) return "";
      const entries = recipes
        .filter((entry) => entry.cat === cat)
        .filter((entry) => craftFilter !== "Ready" || entry.ok)
        .sort((a, b) => Number(b.ok) - Number(a.ok) || Number(a.tableLocked) - Number(b.tableLocked) || a.missing - b.missing || a.i - b.i);
      if (!entries.length) return "";
      const rows = entries.map(({ r, i, ok, tableLocked, food }) => {
        const outDef = DEF[r.out.code] || {};
        const tags = [
          r.table ? `<span class="craft-tag">Toilet</span>` : `<span class="craft-tag">Pocket</span>`,
          food ? `<span class="craft-tag craft-tag--food">+${food.heal} HP${food.effects ? " +buff" : ""}</span>` : "",
        ].filter(Boolean).join("");
        const needs = r.in.map(([c, n]) => {
          const def = DEF[c] || {};
          const have = countItem(c);
          const enough = have >= n;
          return `<span class="craft-need ${enough ? "ok" : "no"}"><span class="craft-need__dot">${itemIconHtml(c, "craft-need__icon")}</span><span>${escapeWorldHtml(def.name || "Item")}</span><b>${have}/${n}</b></span>`;
        }).join("");
        const statusClass = ok ? "is-ready" : tableLocked ? "is-locked" : "";
        const statusText = ok ? "Craft" : tableLocked ? "Toilet needed" : "Missing";
        const recipeClass = `craft-recipe${ok ? " is-ready" : ""}${tableLocked ? " is-locked" : ""}`;
        const quantity = r.out.n > 1 ? `Makes ${r.out.n}` : "Makes 1";
        return `<button class="${recipeClass}" data-recipe="${i}" aria-label="${escapeAttr(`${outDef.name || "Recipe"} - ${statusText}`)}" ${ok ? "" : "disabled"}>
          <span class="craft-out">
            <span class="craft-icon">${itemIconHtml(r.out.code, "craft-icon__art")}</span>
            <span class="craft-name"><b>${escapeWorldHtml(outDef.name || "Recipe")}</b><span>${quantity}</span></span>
            <span class="craft-status ${statusClass}">${statusText}</span>
          </span>
          <span class="craft-ins">
            <span class="craft-tags">${tags}</span>
            <span class="craft-ins__label">Needs</span>
            <span class="craft-needs">${needs}</span>
          </span>
        </button>`;
      }).join("");
      const catReady = entries.filter((entry) => entry.ok).length;
      return `<div class="craft-cat"><span>${escapeWorldHtml(cat)}</span><span class="craft-cat__count">${catReady}/${entries.length} ready</span></div>${rows}`;
    }).join("");
    if (!craftList.innerHTML) {
      craftList.innerHTML = `<div class="craft-empty">No ready recipes yet. Gather more materials or stand near a Crafting Toilet.</div>`;
    }
    craftList.querySelectorAll("[data-recipe]").forEach((button) => {
      button.addEventListener("click", () => { primeAudio(); doCraft(RECIPES[Number(button.dataset.recipe)]); });
    });
  }

  function updateTime(dt) {
    const prev = state.time;
    state.time = (state.time + dt / DAY_SECONDS) % 1;
    if (state.time < prev) {
      state.day++;
      addScore(70);
      playSfx("daybreak", { volume: 0.9 });
      api.toast(`Survived the night. Day ${state.day}`, "good");
      // Dawn clears the night horde, but a summoned boss fights on into the day.
      state.mobs.slice().forEach((m) => { if (!(MOB[m.type] && MOB[m.type].boss)) removeMob(m); });
      state.mobs = state.mobs.filter((m) => MOB[m.type] && MOB[m.type].boss);
    }
    const nightNow = isNight();
    if (nightNow && !wasNight) playSfx("nightfall", { volume: 0.85 });
    wasNight = nightNow;
    if (isNight() && state.started && !state.paused && !state.crafting) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const spawned = spawnMob();
        const hurry = state.mobs.length < 4;
        state.spawnTimer = spawned
          ? (hurry ? 0.55 : 0.9) + hash2(Math.floor(performance.now()), state.day) * (hurry ? 0.95 : 1.6)
          : NIGHT_SPAWN_QUICK_RETRY;
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
    if (stars) {
      stars.position.copy(camera.position);
      stars.material.opacity = clamp((0.38 - d) / 0.38, 0, 1);
    }
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
    refillCreativeInventory();
    setText("hud-hp", `${Math.max(0, Math.ceil(state.player.hp))}/${MAX_HP}`);
    updateHealthMeter();
    setText("hud-day", `${isNight() ? "Moon" : "Sun"} ${state.day}`);
    setText("hud-mode", state.creative ? (state.flying ? "Creative ✈" : "Creative") : "Survival");
    updateBuffHud();
    setText("hud-mined", state.mined.toLocaleString());
    setText("hud-score", state.score.toLocaleString());
    setText("hud-high", state.high.toLocaleString());
    ui.hotbar.innerHTML = state.hotbar.map((slot, i) => {
      const selected = i === state.selected ? " is-selected" : "";
      const label = slotName(slot, "");
      const count = state.creative && slot ? "<b>∞</b>" : slot && slot.n > 1 ? `<b>${slot.n}</b>` : "";
      const swatch = slotSwatch(slot);
      return `<button class="rizz3d-slot${selected}" data-slot="${i}" title="${escapeAttr(label || "Empty")}"><em>${i + 1}</em>${swatch}${count}</button>`;
    }).join("");
    if (ui.bagButton) {
      const used = state.bag.filter(Boolean).length;
      ui.bagButton.textContent = `Bag ${used}/${BAG_SLOTS}`;
      ui.bagButton.classList.toggle("is-open", state.bagOpen);
    }
    renderBag();
    updateCreativeButtons();
    updateMobileControlState();
    updateHeldItem();
  }
  function updateBuffHud() {
    const el = document.getElementById("hud-buffs");
    if (!el) return;
    const e = state.effects;
    const parts = [];
    if (e.regen > 0) parts.push(`❤️${Math.ceil(e.regen)}`);
    if (e.speed > 0) parts.push(`⚡${Math.ceil(e.speed)}`);
    if (e.strength > 0) parts.push(`💪${Math.ceil(e.strength)}`);
    if (e.resist > 0) parts.push(`🛡️${Math.ceil(e.resist)}`);
    const item = el.closest(".hud__item");
    if (parts.length) {
      el.textContent = parts.join(" ");
      if (item) item.style.display = "";
    } else if (item) {
      item.style.display = "none";
    }
  }
  function updateHealthMeter() {
    if (!ui.healthFill || !ui.healthValue) return;
    const hp = clamp(state.player.hp, 0, MAX_HP);
    const pct = hp / MAX_HP;
    ui.healthValue.textContent = `${Math.ceil(hp)}/${MAX_HP}`;
    ui.healthFill.style.width = `${pct * 100}%`;
    ui.healthFill.style.filter = pct < 0.32 ? "hue-rotate(120deg) saturate(1.25)" : pct < 0.6 ? "hue-rotate(45deg)" : "none";
    updateBossBar();
  }
  function updateBossBar() {
    if (!ui.bossBar) return;
    const boss = state.mobs.find((m) => MOB[m.type] && MOB[m.type].boss);
    if (!boss) { ui.bossBar.classList.remove("is-active"); return; }
    const max = boss.maxHp || MOB[boss.type].hp;
    const pct = clamp(boss.hp / max, 0, 1);
    ui.bossBar.classList.add("is-active");
    if (ui.bossFill) ui.bossFill.style.width = `${pct * 100}%`;
    if (ui.bossValue) ui.bossValue.textContent = `${Math.max(0, Math.ceil(boss.hp))}/${max}`;
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
    const previous = state.selected;
    state.selected = clamp(Number(index) || 0, 0, HOTBAR - 1);
    heldRenderCode = null;
    renderBag();
    if (announce) {
      showSelectionCue();
      if (previous !== state.selected) playSfx("select");
    }
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
  function heldFlameMaterial(color) {
    const mat = new THREE.MeshBasicMaterial({ color });
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
  function addHeldToolBoxRot(group, pos, scale, material, rot) {
    const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    group.add(mesh);
    return mesh;
  }
  // Lighten (f>1) or darken (f<1) a hex colour, returned as an rgb() string THREE accepts.
  function shadeHex(hex, f) {
    const c = hexToRgb(hex);
    const v = (x) => Math.round(clamp(x * f, 0, 1) * 255);
    return `rgb(${v(c[0])},${v(c[1])},${v(c[2])})`;
  }
  function buildHeldPick(color) {
    const handleMat = heldMaterial("#7c4e29");
    const gripMat = heldMaterial("#5a3218");
    const baseHead = (color || "#b98245").toLowerCase() === "#b98245" ? "#9b6532" : (color || "#b98245");
    const headMat = heldMaterial(baseHead);
    const tipMat = heldMaterial(shadeHex(baseHead, 0.72));
    const shineMat = heldMaterial(shadeHex(baseHead, 1.3));
    const tool = addHeldToolGroup([0.42, -0.46, -0.78], [0.1, 0.04, -0.55]);
    // wooden handle + leather grip
    addHeldToolBox(tool, [0, -0.03, 0], [0.075, 0.74, 0.075], handleMat);
    addHeldToolBox(tool, [0, -0.27, 0], [0.1, 0.22, 0.1], gripMat);
    // head collar + two prongs that curve down and out, with sharpened tips
    addHeldToolBox(tool, [0, 0.34, 0], [0.14, 0.13, 0.13], headMat);
    addHeldToolBoxRot(tool, [0.16, 0.33, 0], [0.27, 0.1, 0.1], headMat, [0, 0, -0.5]);
    addHeldToolBoxRot(tool, [-0.16, 0.33, 0], [0.27, 0.1, 0.1], headMat, [0, 0, 0.5]);
    addHeldToolBoxRot(tool, [0.33, 0.21, 0], [0.1, 0.16, 0.08], tipMat, [0, 0, -0.5]);
    addHeldToolBoxRot(tool, [-0.33, 0.21, 0], [0.1, 0.16, 0.08], tipMat, [0, 0, 0.5]);
    addHeldToolBox(tool, [0, 0.41, 0.02], [0.4, 0.03, 0.05], shineMat);
  }
  function buildHeldSword(color) {
    const baseBlade = (color || "#a6a9b5").toLowerCase() === "#b98245" ? "#9b6532" : (color || "#a6a9b5");
    const bladeMat = heldMaterial(baseBlade);
    const shineMat = heldMaterial(shadeHex(baseBlade, 1.38));
    const edgeMat = heldMaterial(shadeHex(baseBlade, 0.68));
    const guardMat = heldMaterial("#caa24a");
    const handleMat = heldMaterial("#5a3218");
    const tool = addHeldToolGroup([0.36, -0.4, -0.8], [0.08, 0.04, -0.58]);
    // tapered blade with a bright fuller and a darker edge
    addHeldToolBox(tool, [0, 0.27, 0], [0.085, 0.66, 0.04], bladeMat);
    addHeldToolBox(tool, [0, 0.63, 0], [0.05, 0.14, 0.035], bladeMat);
    addHeldToolBox(tool, [-0.02, 0.27, 0.006], [0.024, 0.62, 0.046], shineMat);
    addHeldToolBox(tool, [0.032, 0.25, -0.006], [0.018, 0.58, 0.046], edgeMat);
    // gold cross-guard, leather grip, gold pommel
    addHeldToolBox(tool, [0, -0.12, 0], [0.32, 0.075, 0.085], guardMat);
    addHeldToolBox(tool, [0, -0.29, 0], [0.07, 0.32, 0.07], handleMat);
    addHeldToolBox(tool, [0, -0.47, 0], [0.11, 0.09, 0.11], guardMat);
  }
  function buildHeldAxe(color) {
    const wood = heldMaterial("#7c4e29");
    const head = heldMaterial(color);
    addHeldBox([0.38, -0.34, -0.72], [0.07, 0.54, 0.07], wood, [0, 0, -0.54]);
    addHeldBox([0.21, -0.13, -0.82], [0.26, 0.24, 0.1], head, [0, 0, -0.54]);
    addHeldBox([0.11, -0.19, -0.82], [0.1, 0.18, 0.1], head, [0, 0, -0.18]);
  }
  function buildHeldTorch() {
    const tool = addHeldToolGroup([0.38, -0.38, -0.76], [0.06, 0.05, -0.55]);
    addHeldToolBox(tool, [0, 0, 0], [0.08, 0.55, 0.08], heldMaterial("#8a572d"));
    addHeldToolBox(tool, [0, 0.29, 0], [0.12, 0.14, 0.12], heldMaterial("#5a3218"));
    addHeldToolBox(tool, [0, 0.39, 0], [0.18, 0.14, 0.18], heldFlameMaterial("#ff6a1a"));
    addHeldToolBox(tool, [0, 0.49, 0], [0.14, 0.16, 0.14], heldFlameMaterial("#ffd75a"));
    addHeldToolBox(tool, [0, 0.61, 0], [0.08, 0.1, 0.08], heldFlameMaterial("#fff4b0"));
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
    updateHeldTorchLight();
  }
  function updateHeldTorchLight() {
    const active = selectedIsTorch() && state.started && !state.paused;
    if (!active) {
      heldTorchLight.intensity = 0;
      return;
    }
    const flicker = Math.sin(performance.now() * 0.018) * 0.12 + Math.sin(performance.now() * 0.047) * 0.06;
    const swingBoost = state.swingKind === "attack" ? clamp(state.swingTimer / HELD_SWING_SECONDS, 0, 1) * 0.42 : 0;
    heldTorchLight.intensity = 1.45 + flicker + swingBoost;
    heldTorchLight.distance = HELD_TORCH_LIGHT_DISTANCE;
    heldTorchLight.position.set(0.33, -0.08, -0.82);
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
    return itemIconHtml(slot.code, "rizz3d-swatch");
  }
  function itemIconHtml(code, extraClass = "") {
    const d = DEF[code] || {};
    const kind = itemIconKind(code, d);
    const baseRaw = d.color || "#ffffff";
    const accentRaw = itemIconAccent(code, d, kind);
    const base = escapeAttr(baseRaw);
    const accent = escapeAttr(accentRaw);
    const dark = escapeAttr(shadeHex(baseRaw, 0.58));
    const midDark = escapeAttr(shadeHex(baseRaw, 0.76));
    const light = escapeAttr(shadeHex(baseRaw, 1.34));
    const className = escapeAttr(`rizz3d-icon rizz3d-icon--${kind}${extraClass ? ` ${extraClass}` : ""}`);
    return `<svg class="${className}" viewBox="0 0 32 32" aria-hidden="true" focusable="false" style="--item-color:${base}" shape-rendering="geometricPrecision">${itemIconBody(kind, { base, accent, dark, midDark, light }, code)}</svg>`;
  }
  function itemIconKind(code, d) {
    const tool = d.tool && d.tool.type;
    if (tool) return tool;
    switch (code) {
      case GRASS: return "grass";
      case LOG: return "log";
      case LEAVES: return "leaves";
      case PLANKS: return "planks";
      case TABLE: return "toilet";
      case COAL_ORE:
      case RIZZ_ORE:
      case SIGMA_ORE: return "ore";
      case TORCH: return "torch";
      case WATER: return "water";
      case LAVA: return "lava";
      case TALL_GRASS:
      case CAVE_VINE: return "grass-blades";
      case FLOWER: return "flower";
      case GLOW_SHROOM:
      case COOKED_SHROOM: return "mushroom";
      case CAVE_CRYSTAL:
      case RIZZ:
      case SIGMA: return "gem";
      case DRIPSTONE_UP:
      case DRIPSTONE_DOWN: return "dripstone";
      case GLOWSTONE:
      case SIGMA_LANTERN: return "lamp";
      case CRYSTAL_GLASS: return "glass";
      case CHEST: return "chest";
      case BED: return "bed";
      case DOOR:
      case DOOR_OPEN: return "door";
      case FURNACE: return "furnace";
      case CROP_1:
      case CROP_2:
      case CROP_3:
      case WHEAT: return "wheat";
      case STICK: return "stick";
      case COAL:
      case CHARCOAL: return "coal";
      case FRIENDLY_FRUIT: return "apple";
      case BERRY: return "berries";
      case BREAD: return "bread";
      case RAW_MEAT:
      case COOKED_MEAT: return "meat";
      case OHIO_BURGER: return "burger";
      case SHROOM_STEW: return "stew";
      case SIGMA_BREW: return "drink";
      case GRIMACE_SHAKE: return "shake";
      case GOLDEN_APPLE: return "apple";
      case WHEAT_SEEDS: return "seeds";
      case SKIBIDI_GOO: return "goo";
      case CURSED_IDOL: return "idol";
      case SIGMA_CROWN: return "crown";
      default:
        if (d.kind === "block") return d.transparent ? "glass" : "block";
        return "item";
    }
  }
  function itemIconAccent(code, d, kind) {
    switch (code) {
      case GRASS: return d.side || "#7a5732";
      case LOG: return "#d09a58";
      case LEAVES: return "#8aff7c";
      case TABLE: return "#4ecaff";
      case COAL_ORE: return "#1c1d26";
      case RIZZ_ORE: return "#ffd75a";
      case SIGMA_ORE: return "#8af7ff";
      case WATER: return "#b8f7ff";
      case LAVA: return "#ffd75a";
      case GLOW_SHROOM: return "#ff6fd6";
      case CAVE_CRYSTAL: return "#d9fffb";
      case GLOWSTONE: return "#fff0a6";
      case SIGMA_LANTERN: return "#ffd75a";
      case CRYSTAL_GLASS: return "#ffffff";
      case COAL:
      case CHARCOAL: return "#666879";
      case RIZZ:
      case RIZZ_BLOCK: return "#fff0a6";
      case SIGMA:
      case SIGMA_BLOCK: return "#d9fffb";
      case BERRY: return "#ff91bd";
      case BREAD: return "#fff0a6";
      case OHIO_BURGER: return "#7bd24a";
      case SIGMA_BREW: return "#ff4fd8";
      case GRIMACE_SHAKE: return "#d29bff";
      case GOLDEN_APPLE: return "#fff4b0";
      case SKIBIDI_GOO: return "#c7ff5a";
      case CURSED_IDOL: return "#ffd75a";
      case SIGMA_CROWN: return "#4beaff";
      default: return d.ore || d.side || (kind === "tool" ? "#7c4e29" : shadeHex(d.color || "#ffffff", 1.22));
    }
  }
  function itemIconBody(kind, c, code) {
    const line = `stroke="#05070d" stroke-opacity=".76" stroke-width="1.45" stroke-linejoin="round"`;
    const roundLine = `${line} stroke-linecap="round"`;
    const shine = `stroke="#ffffff" stroke-opacity=".45" stroke-width="1.1" stroke-linecap="round"`;
    const cube = (topFill = c.light, leftFill = c.base, rightFill = c.dark) => `
      <path d="M6 10.5 16 5.5 26 10.5 26 22 16 27 6 22Z" fill="${c.midDark}" ${line}/>
      <path d="M6 10.5 16 15.4 16 27 6 22Z" fill="${leftFill}"/>
      <path d="M26 10.5 16 15.4 16 27 26 22Z" fill="${rightFill}"/>
      <path d="M6 10.5 16 5.5 26 10.5 16 15.4Z" fill="${topFill}"/>
      <path d="M16 15.4V27M6 10.5 16 15.4 26 10.5" fill="none" stroke="#05070d" stroke-opacity=".32" stroke-width="1"/>`;
    switch (kind) {
      case "grass": return `
        ${cube(c.base, c.accent, c.dark)}
        <path d="M8 10.2 16 6.1 24 10.2 16 14.2Z" fill="${c.base}"/>
        <path d="M8.4 11.2c2.6-1.4 4.7-1.2 7.1.2 2.2 1.2 4.9 1 8-1" fill="none" ${shine}/>`;
      case "ore": return `
        ${cube(shadeHex("#868894", 1.18), "#767987", "#565966")}
        <path d="m11 16 3-2 2 3-2 2-3-1Z" fill="${c.accent}" ${line}/>
        <path d="m19 20 2-2 2 1-1 3-3 1Z" fill="${c.accent}" ${line}/>
        <path d="m17 9 2-1 2 1.5-1.5 2-2.5-.4Z" fill="${c.accent}"/>`;
      case "log": return `
        <path d="M9 9.5h13.5c3 0 5 2.2 5 5.1v7.2c0 2.1-1.6 3.7-3.7 3.7H10.5c-3.1 0-5.5-2.4-5.5-5.5v-6c0-2.5 1.7-4.5 4-4.5Z" fill="${c.dark}" ${line}/>
        <path d="M8.2 10.2h13.7v13.9H8.2Z" fill="${c.base}"/>
        <ellipse cx="8.3" cy="17.2" rx="4.5" ry="7" fill="${c.accent}" ${line}/>
        <ellipse cx="8.3" cy="17.2" rx="2.3" ry="3.8" fill="none" stroke="#7c4e29" stroke-opacity=".6" stroke-width="1"/>
        <path d="M13 13h9M13 18h9M13 22h8" ${shine}/>`;
      case "leaves": return `
        <path d="M10 8h12v4h4v10h-4v4H10v-4H6V12h4Z" fill="${c.base}" ${line}/>
        <path d="M11 20c5-8 9-8 13-8-2 5-6 9-13 8Z" fill="${c.accent}" opacity=".5"/>
        <path d="M9 13c4 0 6 1 8 5" ${shine}/>`;
      case "planks": return `
        <path d="M6 8h20v17H6Z" fill="${c.dark}" ${line}/>
        <path d="M7.5 9.5h17v4.5h-17ZM7.5 15.2h17v4.5h-17ZM7.5 20.9h17v2.7h-17Z" fill="${c.base}"/>
        <path d="M11 10v4M18 15.4v4M13 21v2M8.5 13.8h15M8.5 19.5h15" stroke="#5a3218" stroke-opacity=".55" stroke-width="1"/>`;
      case "toilet": return `
        <path d="M9 8h13v7H9Z" fill="#e8f6ff" ${line}/>
        <path d="M12 15h12c1 5.5-1.4 10-7.1 10h-4.3c-2.6 0-4.6-2-4.6-4.5V19c0-2.2 1.8-4 4-4Z" fill="#d7e1e8" ${line}/>
        <path d="M12 17.2h8.8c.4 2.6-1 4.5-4 4.5H13c-1.4 0-2.5-1-2.5-2.3 0-1.2.6-2.2 1.5-2.2Z" fill="${c.accent}" opacity=".8"/>
        <path d="M19.5 9.8h2.2" ${shine}/>`;
      case "torch": return `
        <path d="M13 13 18.8 27" stroke="#05070d" stroke-opacity=".76" stroke-width="6" stroke-linecap="round"/>
        <path d="M13 13 18.8 27" stroke="#8a572d" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M13.5 13.5 18.2 25.8" stroke="#c27a36" stroke-width="2" stroke-linecap="round"/>
        <path d="M16 4c4 3.2 5.6 6.2 2.5 9.5-2.4 2.6-6.9 1.2-7.2-2.6C11.1 8.3 14.4 7.1 16 4Z" fill="#ff6a1a" ${line}/>
        <path d="M16.2 7.1c1.8 1.6 2.4 3.1 1 4.5-1.1 1.1-3.1.6-3.2-1 .1-1.1 1.4-1.8 2.2-3.5Z" fill="#fff2a8"/>`;
      case "water": return `
        <path d="M5.5 9h21v15h-21Z" fill="${c.dark}" ${line}/>
        <path d="M7 13c3.2-2.4 5.8 2.2 9 0s5.8 2.2 9 0v9H7Z" fill="${c.base}"/>
        <path d="M7 15c3.2-2.4 5.8 2.2 9 0s5.8 2.2 9 0M8 19c2.8-1.7 5.1 1.5 7.7 0s5.1 1.5 7.7 0" stroke="${c.accent}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`;
      case "lava": return `
        <path d="M5.5 9h21v15h-21Z" fill="${c.dark}" ${line}/>
        <path d="M7 22V12c3-2 4.2 2.2 6.5.3 2.4-2 4 2.7 6.1.5 2-2.1 3.3 1.1 5.4-.8v10Z" fill="#ff5a14"/>
        <path d="M9 21c1.2-4 3.5-3.6 4.4-7.8 1.7 3 4.6 3 4.8 7.8M19 21c1-2.3 3-2.1 3.8-5" stroke="${c.accent}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;
      case "grass-blades": return `
        <path d="M8 25c1.3-7.5 3.3-12.4 6.1-17-.5 7.1.2 12.5 2.1 17M15 25c1-6.3 4-11 8.4-14-2 6.3-2.7 10.7-2.2 14M6 25c2.8-3.9 5.4-5.3 8.6-6.7" fill="none" stroke="${c.base}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 26h18" stroke="#05070d" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>`;
      case "flower": return `
        <path d="M16 15v11M16 20c-3-1-5.2-.2-7 2.5M16 21c3.2-1.4 5.8-.7 8 2" stroke="#35c55b" stroke-width="2.4" stroke-linecap="round" fill="none"/>
        <circle cx="16" cy="11.5" r="3.2" fill="${c.accent}" ${line}/>
        <circle cx="11.8" cy="12.7" r="3.2" fill="${c.base}" ${line}/>
        <circle cx="20.2" cy="12.7" r="3.2" fill="${c.base}" ${line}/>
        <circle cx="16" cy="16" r="3.2" fill="${c.base}" ${line}/>
        <circle cx="16" cy="13.2" r="2" fill="#ffd75a"/>`;
      case "mushroom": return `
        <path d="M13 15h6l1 10h-8Z" fill="#f2ead2" ${line}/>
        <path d="M8 16c.5-5.2 4-8.6 8.2-8.6 4.4 0 7.3 3.2 7.8 8.6Z" fill="${c.base}" ${line}/>
        <circle cx="14" cy="12.2" r="1.4" fill="${c.accent}"/>
        <circle cx="19.8" cy="13.2" r="1.6" fill="${c.accent}"/>
        <path d="M12.5 19h7" ${shine}/>`;
      case "gem": return `
        <path d="M10.5 6h11L27 13.5 16 27 5 13.5Z" fill="${c.base}" ${line}/>
        <path d="M10.5 6 16 13.5 21.5 6M5 13.5h22M16 13.5V27" fill="none" stroke="#05070d" stroke-opacity=".28" stroke-width="1"/>
        <path d="M11.2 8.2h4.2M8.4 13.5l3-4.2" ${shine}/>`;
      case "dripstone": return `
        <path d="M16 5 23 25H9Z" fill="${c.base}" ${line}/>
        <path d="M16 5 17.8 25H9Z" fill="${c.light}" opacity=".55"/>
        <path d="M16 8v13M13 17h6" stroke="#6a5a4a" stroke-opacity=".55" stroke-width="1"/>`;
      case "lamp": return `
        <path d="M10 8h12l2 3v12l-2 3H10l-2-3V11Z" fill="${c.base}" ${line}/>
        <path d="M12 11h8v12h-8Z" fill="${c.accent}" opacity=".68"/>
        <path d="M8 6h16M8 27h16" stroke="#7c4e29" stroke-width="2" stroke-linecap="round"/>
        <path d="M13 13h6M13 21h6" ${shine}/>`;
      case "glass": return `
        <path d="M9 5.5h14v21H9Z" fill="${c.base}" fill-opacity=".52" ${line}/>
        <path d="M12 8h7M12 24h6M20 8 12 20" ${shine}/>
        <path d="M22 11v11" stroke="${c.accent}" stroke-opacity=".7" stroke-width="1.2"/>`;
      case "chest": return `
        <path d="M6 13h20v12H6Z" fill="${c.base}" ${line}/>
        <path d="M8 8h16l2 5H6Z" fill="${c.dark}" ${line}/>
        <path d="M16 8v17M6 16h20" stroke="#5a3218" stroke-opacity=".65" stroke-width="1.2"/>
        <path d="M13.5 15h5v5h-5Z" fill="#caa24a" ${line}/>`;
      case "bed": return `
        <path d="M6 14h20v9H6Z" fill="${c.base}" ${line}/>
        <path d="M6 10h9v7H6Z" fill="#f3f4fb" ${line}/>
        <path d="M15 11h11v6H15Z" fill="${c.dark}" ${line}/>
        <path d="M7 23v3M25 23v3" ${roundLine}/>`;
      case "door": return `
        <path d="M9 5h14v23H9Z" fill="${c.base}" ${line}/>
        <path d="M12 8h8v17h-8Z" fill="${c.dark}" opacity=".32"/>
        <circle cx="19.8" cy="16" r="1.5" fill="#ffd75a" ${line}/>
        <path d="M12 8h8M12 25h8" ${shine}/>`;
      case "furnace": return `
        <path d="M6.5 7h19v20h-19Z" fill="${c.base}" ${line}/>
        <path d="M10 10h12v5H10ZM9 17h14v7H9Z" fill="${c.dark}" ${line}/>
        <path d="M13 23c-.5-3 2.2-3.8 2.6-6 2 1.7 3.8 3.3 3.1 6Z" fill="#ff6a1a"/>
        <path d="M16 22c-.2-1.5.8-2.1 1-3.1 1 .8 1.7 1.8 1.3 3.1Z" fill="#ffd75a"/>`;
      case "wheat": return `
        <path d="M16 26V8M12 24V11M20 24V11" stroke="#9b7832" stroke-width="2" stroke-linecap="round"/>
        <path d="M16 10c-3 1-4 2.2-5 4 3-.3 4.4-1.4 5-4ZM16 14c-3 1-4 2.2-5 4 3-.3 4.4-1.4 5-4ZM16 18c-3 1-4 2.2-5 4 3-.3 4.4-1.4 5-4ZM16 10c3 1 4 2.2 5 4-3-.3-4.4-1.4-5-4ZM16 14c3 1 4 2.2 5 4-3-.3-4.4-1.4-5-4ZM16 18c3 1 4 2.2 5 4-3-.3-4.4-1.4-5-4Z" fill="${c.base}" ${line}/>`;
      case "stick": return `
        <path d="M10 25 22 7" stroke="#05070d" stroke-opacity=".76" stroke-width="6.5" stroke-linecap="round"/>
        <path d="M10 25 22 7" stroke="${c.base}" stroke-width="5" stroke-linecap="round"/>
        <path d="M13 20 22 7" ${shine}/>`;
      case "coal": return `
        <path d="M8 11 15 6 24 9 27 17 21 25 11 24 5 17Z" fill="${c.base}" ${line}/>
        <path d="M11 13 16 9 23 11M9 18l7-2 6 4" fill="none" stroke="${c.accent}" stroke-opacity=".48" stroke-width="1.5" stroke-linecap="round"/>`;
      case "pick": return `
        <path d="M12 27 20 9" stroke="#05070d" stroke-opacity=".76" stroke-width="5.8" stroke-linecap="round"/>
        <path d="M12 27 20 9" stroke="#7c4e29" stroke-width="4" stroke-linecap="round"/>
        <path d="M7 10c5-4.2 13-4.2 18 0l-3.2 3.5c-3.5-2-8.2-2-11.6 0Z" fill="${c.base}" ${line}/>
        <path d="M10 11c3-1.4 8-1.8 12 0" ${shine}/>`;
      case "axe": return `
        <path d="M12 27 20 8" stroke="#05070d" stroke-opacity=".76" stroke-width="5.8" stroke-linecap="round"/>
        <path d="M12 27 20 8" stroke="#7c4e29" stroke-width="4" stroke-linecap="round"/>
        <path d="M10 9h10c4.1 0 6.6 2.3 7.8 5.5-3.8.6-7 .2-9.3-1.9L15 18l-5-2.8Z" fill="${c.base}" ${line}/>
        <path d="M19 10c2.5.2 4.3 1.4 5.6 3.2" ${shine}/>`;
      case "sword": return `
        <path d="M17 4 23 10 17.8 21.4 14.2 17.8Z" fill="${c.base}" ${line}/>
        <path d="M17 4 17.8 21.4 14.2 17.8Z" fill="${c.light}" opacity=".62"/>
        <path d="m10.3 18 3.7-3.7 4.2 4.2-3.7 3.7Z" fill="#caa24a" ${line}/>
        <path d="M10 22 7.2 24.8M13.5 25.5 6.5 18.5" stroke="#05070d" stroke-opacity=".76" stroke-width="4.6" stroke-linecap="round"/>
        <path d="M10 22 7.2 24.8M13.5 25.5 6.5 18.5" stroke="#7c4e29" stroke-width="3" stroke-linecap="round"/>`;
      case "hoe": return `
        <path d="M12 27 20 8" stroke="#05070d" stroke-opacity=".76" stroke-width="5.8" stroke-linecap="round"/>
        <path d="M12 27 20 8" stroke="#7c4e29" stroke-width="4" stroke-linecap="round"/>
        <path d="M18 8h8v4h-8Z" fill="${c.base}" ${line}/>
        <path d="M21 12v5" stroke="#05070d" stroke-opacity=".76" stroke-width="5.6" stroke-linecap="round"/>
        <path d="M21 12v5" stroke="${c.base}" stroke-width="4" stroke-linecap="round"/>`;
      case "apple": return `
        <path d="M16 10c3.8-4 9.5-.4 9.5 5.8 0 6.6-4.3 10.9-8.2 9.2-.8-.4-1.8-.4-2.6 0-3.9 1.7-8.2-2.6-8.2-9.2C6.5 9.6 12.2 6 16 10Z" fill="${c.base}" ${line}/>
        <path d="M15.5 10c.1-3 1.6-4.8 4.7-5.2.1 3.1-1.8 4.7-4.7 5.2Z" fill="#55d86a" ${line}/>
        <path d="M12 13.5c1.8-1.4 3.4-1.7 4.7-.9" ${shine}/>`;
      case "berries": return `
        <circle cx="13" cy="13" r="5" fill="${c.base}" ${line}/>
        <circle cx="19.5" cy="14" r="5" fill="${c.dark}" ${line}/>
        <circle cx="16" cy="20" r="5" fill="${c.base}" ${line}/>
        <path d="M15.5 8c1-2.1 2.8-2.9 5.3-2.4" stroke="#55d86a" stroke-width="2" stroke-linecap="round"/>`;
      case "bread": return `
        <path d="M7 16c0-5 4.4-8.5 9.4-8.5 5.1 0 8.6 3.2 8.6 8.5v8H7Z" fill="${c.base}" ${line}/>
        <path d="M10 15c1.2-2.7 3.2-4 6-4M16 15c1.3-2.3 3.2-3.3 5.6-3" ${shine}/>
        <path d="M8 20h16" stroke="#8f5629" stroke-opacity=".42" stroke-width="1.4"/>`;
      case "meat": return `
        <path d="M10 20c-2.5-2.5-2.2-7.5 1.2-10.2 3.2-2.6 8.1-2.3 10.8.4 2.7 2.7 2.7 7.2 0 9.9-3.1 3.2-8.8 3-12-.1Z" fill="${c.base}" ${line}/>
        <path d="M21.5 20.2 26 24.7M24.7 21.8l2.4-2.4M24.7 24.7l-2.4 2.4" stroke="#05070d" stroke-opacity=".72" stroke-width="5.8" stroke-linecap="round"/>
        <path d="M21.5 20.2 26 24.7M24.7 21.8l2.4-2.4M24.7 24.7l-2.4 2.4" stroke="#f2ead2" stroke-width="4" stroke-linecap="round"/>
        <path d="M12.5 11.5c2-1.4 5.4-1.3 7.4.5" ${shine}/>`;
      case "burger": return `
        <path d="M7 14c1.2-4.7 5-7 9.2-7 4.5 0 8.3 2.3 9.8 7Z" fill="#d79a4e" ${line}/>
        <path d="M7 15h18v3H7Z" fill="${c.accent}" ${line}/>
        <path d="M8 18h17v4H8Z" fill="#7b3f20" ${line}/>
        <path d="M7 22h19v4H7Z" fill="#d79a4e" ${line}/>
        <path d="M12 11h1M17 10h1M21 12h1" stroke="#fff0a6" stroke-width="1.6" stroke-linecap="round"/>`;
      case "stew": return `
        <path d="M7 14h18l-2.2 10H9.2Z" fill="#7a5732" ${line}/>
        <path d="M8.5 14c1.5-3 5-4.4 7.7-2.4 2.5-1.8 6.3-.6 7.3 2.4Z" fill="${c.base}" ${line}/>
        <circle cx="14" cy="13.5" r="1.6" fill="${c.accent}"/>
        <circle cx="19.5" cy="13.6" r="1.2" fill="#fff0a6"/>`;
      case "drink": return `
        <path d="M11 7h11l-1.5 20h-8Z" fill="${c.base}" ${line}/>
        <path d="M12 10h9l-.4 4h-8.2Z" fill="${c.accent}" opacity=".75"/>
        <path d="M14 17h5M14 21h4" ${shine}/>`;
      case "shake": return `
        <path d="M10 10h13l-2 17h-9Z" fill="${c.base}" ${line}/>
        <path d="M11 8h11v4H11Z" fill="${c.accent}" ${line}/>
        <path d="M16 8 19 4" stroke="#05070d" stroke-opacity=".76" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M16 8 19 4" stroke="${c.accent}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M13 15c2 1.8 4.8-1.8 7 0" ${shine}/>`;
      case "seeds": return `
        <ellipse cx="11" cy="17" rx="3.2" ry="5" fill="${c.base}" ${line} transform="rotate(-35 11 17)"/>
        <ellipse cx="18" cy="12" rx="3" ry="4.8" fill="${c.accent}" ${line} transform="rotate(28 18 12)"/>
        <ellipse cx="20.5" cy="21" rx="3.2" ry="4.8" fill="${c.base}" ${line} transform="rotate(38 20.5 21)"/>`;
      case "goo": return `
        <path d="M9 16c-3-5.5 4.5-10.5 8-6.8 4-2.2 8.2 1.4 7.2 5.8 4 2.4 1.4 9.4-3.5 8.7-2.2 3.2-8.1 3.1-9.7-.6-4.6.2-6-5.2-2-7.1Z" fill="${c.base}" ${line}/>
        <circle cx="14" cy="14" r="1.3" fill="${c.accent}"/>
        <circle cx="20.5" cy="18.8" r="1.6" fill="${c.accent}"/>
        <path d="M11 20c2.6 1.8 5.5 2.1 8.6.6" ${shine}/>`;
      case "idol": return `
        <path d="M10 6h12l3 6-2 14H9L7 12Z" fill="${c.base}" ${line}/>
        <path d="M10 12h12M11 21h10" stroke="#05070d" stroke-opacity=".36" stroke-width="1.2"/>
        <circle cx="13" cy="16" r="1.5" fill="#05070d"/>
        <circle cx="19" cy="16" r="1.5" fill="#05070d"/>
        <path d="M13 22c2.2-2 4.3-2 6.2 0" stroke="${c.accent}" stroke-width="1.7" stroke-linecap="round" fill="none"/>`;
      case "crown": return `
        <path d="M7 23h18v4H7Z" fill="${c.base}" ${line}/>
        <path d="M8 23 10 9l6 7 6-7 2 14Z" fill="${c.base}" ${line}/>
        <path d="M10 9 16 16 22 9M11 22h10" ${shine}/>
        <circle cx="10" cy="9" r="2" fill="${c.accent}" ${line}/>
        <circle cx="22" cy="9" r="2" fill="${c.accent}" ${line}/>
        <circle cx="16" cy="16" r="2" fill="${c.accent}" ${line}/>`;
      case "item":
        return `
          <path d="M10 8h12l4 5-10 13L6 13Z" fill="${c.base}" ${line}/>
          <path d="M10 8 16 13l6-5M6 13h20M16 13v13" fill="none" stroke="#05070d" stroke-opacity=".25" stroke-width="1"/>
          <path d="M10.5 10.2h4" ${shine}/>`;
      case "block":
      default:
        return cube();
    }
  }
  function slotsKey(slots) { return slots.map((slot) => slot ? `${slot.code}:${slot.n}` : "-").join(","); }
  function furnaceKeyStr(f) { return f ? `${slotsKey([f.input, f.fuel, f.output])}|${(f.burn > 0 ? 1 : 0)}|${Math.round(f.cook * 4)}` : ""; }
  function renderBag() {
    if (!ui.bagPanel) return;
    const chest = state.openChest ? chestSlots(state.openChest) : null;
    const furnace = state.openFurnace ? furnaceState(state.openFurnace) : null;
    const key = state.bagOpen
      ? `${state.selected}|${state.openChest || ""}|${state.openFurnace || ""}|${slotsKey(state.hotbar)}|${slotsKey(state.bag)}|${chest ? slotsKey(chest) : ""}|${furnaceKeyStr(furnace)}`
      : "closed";
    ui.bagPanel.classList.toggle("is-open", state.bagOpen);
    ui.bagPanel.classList.toggle("is-chest", !!(chest || furnace));
    if (key === bagRenderKey) return;
    bagRenderKey = key;
    if (!state.bagOpen) {
      ui.bagPanel.innerHTML = "";
      return;
    }
    let stationHtml = "";
    let title = "Bag";
    let helpLine = "Click a bag item to swap it into the selected action slot.";
    if (chest) {
      title = "Rizz Chest";
      helpLine = "Click chest items to take them; click your items to store them.";
      stationHtml = `
        <div class="rizz3d-bag-label">Rizz Chest — click to take</div>
        <div class="rizz3d-bag-grid rizz3d-bag-chest">
          ${chest.map((slot, i) => bagSlotHtml(slot, i, `data-chest-slot="${i}"`, false, "Chest")).join("")}
        </div>`;
    } else if (furnace) {
      title = "Ohio Furnace";
      helpLine = "Click your items to add ore/food or fuel; click a furnace slot to take it out.";
      const recipe = furnace.input ? SMELTING[furnace.input.code] : null;
      const pct = recipe ? Math.round(clamp(furnace.cook / recipe.time, 0, 1) * 100) : 0;
      stationHtml = `
        <div class="rizz3d-furnace">
          <div class="rizz3d-furnace__col">
            <span class="rizz3d-furnace__lab">Smelt</span>
            ${bagSlotHtml(furnace.input, 0, `data-furnace-slot="input"`, false, "Input")}
            <span class="rizz3d-furnace__lab">Fuel ${furnace.burn > 0 ? "🔥" : ""}</span>
            ${bagSlotHtml(furnace.fuel, 0, `data-furnace-slot="fuel"`, false, "Fuel")}
          </div>
          <div class="rizz3d-furnace__arrow"><span style="width:${pct}%"></span></div>
          <div class="rizz3d-furnace__col">
            <span class="rizz3d-furnace__lab">Output</span>
            ${bagSlotHtml(furnace.output, 0, `data-furnace-slot="output"`, false, "Output")}
          </div>
        </div>`;
    }
    ui.bagPanel.innerHTML = `
      <div class="rizz3d-bag-head">
        <strong>${title}</strong>
        <span>${helpLine}</span>
      </div>
      <div class="rizz3d-bag-hover" data-bag-hover>Hover a slot to inspect it.</div>
      ${stationHtml}
      <div class="rizz3d-bag-label">Action bar${(chest || furnace) ? " — click to load" : ""}</div>
      <div class="rizz3d-bag-hotbar">
        ${state.hotbar.map((slot, i) => bagSlotHtml(slot, i, `data-bag-hotbar="${i}"`, i === state.selected, "Action")).join("")}
      </div>
      <div class="rizz3d-bag-label">Bag storage${(chest || furnace) ? " — click to load" : ""}</div>
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
      .canvas-wrap--rizzcraft #gameCanvas{touch-action:none}
      .rizz3d-crosshair:before,.rizz3d-crosshair:after{content:"";position:absolute;background:rgba(255,255,255,.9);box-shadow:0 0 6px rgba(0,0,0,.7)}
      .rizz3d-crosshair:before{left:8px;top:1px;width:2px;height:16px}.rizz3d-crosshair:after{left:1px;top:8px;width:16px;height:2px}
      .rizz3d-health{position:absolute;left:12px;top:12px;z-index:6;width:min(260px,44%);padding:7px 9px;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(5,7,13,.76);box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:none}
      .rizz3d-health__row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;color:#fff;font:900 10px var(--font-mono);text-transform:uppercase}.rizz3d-health__value{font-size:11px;color:#ffd75a}
      .rizz3d-health__track{height:10px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
      .rizz3d-health__fill{display:block;width:100%;height:100%;border-radius:5px;background:linear-gradient(90deg,#55f06c,#ffd75a 62%,#ff4c6d);box-shadow:0 0 16px rgba(85,240,108,.35);transition:width 120ms ease,filter 120ms ease}
      .rizz3d-boss{display:none;position:absolute;left:50%;top:46px;transform:translateX(-50%);z-index:6;width:min(440px,80%);padding:7px 10px;border:1px solid rgba(255,79,184,.5);border-radius:7px;background:rgba(14,5,18,.82);box-shadow:0 8px 28px rgba(0,0,0,.4);pointer-events:none}
      .rizz3d-boss.is-active{display:block}
      .rizz3d-boss__row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;color:#ff9be6;font:900 11px var(--font-mono);text-transform:uppercase;letter-spacing:.04em}.rizz3d-boss__value{color:#fff}
      .rizz3d-boss__track{height:12px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,79,184,.3)}
      .rizz3d-boss__fill{display:block;width:100%;height:100%;border-radius:6px;background:linear-gradient(90deg,#ff4f6d,#ffd75a);box-shadow:0 0 16px rgba(255,79,109,.45);transition:width 140ms ease}
      .rizz3d-target{display:none;position:absolute;left:50%;top:calc(50% + 24px);transform:translateX(-50%);z-index:5;color:#fff;background:rgba(5,7,13,.6);border-radius:5px;padding:4px 8px;font:700 11px var(--font-mono);pointer-events:none}
      .rizz3d-target.is-visible{display:block}
      .rizz3d-progress{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:5;width:min(340px,72%);height:5px;background:rgba(0,0,0,.55);border-radius:3px;overflow:hidden;pointer-events:none}.rizz3d-progress span{display:block;width:0;height:100%;background:#ffd43b}
      .rizz3d-selection-cue{position:absolute;left:50%;bottom:60px;transform:translate(-50%,8px);z-index:8;max-width:min(320px,72%);padding:6px 10px;border:1px solid rgba(255,212,59,.45);border-radius:6px;background:rgba(5,7,13,.86);color:#fff;font:900 11px var(--font-mono);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity 120ms ease,transform 120ms ease}.rizz3d-selection-cue.is-visible{opacity:1;transform:translate(-50%,0)}
      .rizz3d-hotbar{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:7;display:grid;grid-template-columns:repeat(9,40px);gap:4px;pointer-events:auto}
      .rizz3d-slot{position:relative;width:40px;height:40px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(8,10,18,.8);cursor:pointer}.rizz3d-slot.is-selected{border-color:#ffd43b;box-shadow:0 0 0 2px rgba(255,212,59,.28),0 0 18px rgba(255,212,59,.18)}.rizz3d-slot.is-selected:after{content:"";position:absolute;left:6px;right:6px;bottom:3px;height:2px;border-radius:2px;background:#ffd43b}
      .rizz3d-slot em{position:absolute;left:4px;top:2px;color:rgba(255,255,255,.55);font:700 9px var(--font-mono);font-style:normal}.rizz3d-slot b{position:absolute;right:4px;bottom:2px;color:#fff;font:800 11px var(--font-mono)}
      .rizz3d-icon{display:block;pointer-events:none;overflow:visible}
      .rizz3d-swatch{position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 2px rgba(0,0,0,.48))}
      .rizz3d-bag-slot .rizz3d-swatch{width:23px;height:23px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.46))}
      .rizz3d-bag-button{position:absolute;left:calc(50% + 204px);bottom:10px;z-index:7;height:40px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(8,10,18,.86);color:#fff;font:800 10px var(--font-mono);padding:0 10px;cursor:pointer}.rizz3d-bag-button.is-open{border-color:#43e6ff;box-shadow:0 0 0 2px rgba(67,230,255,.22)}
      .rizz3d-bag-panel{display:none;position:absolute;right:12px;bottom:62px;z-index:8;width:min(360px,calc(100% - 24px));max-height:min(420px,72%);overflow:auto;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(5,7,13,.91);box-shadow:0 18px 44px rgba(0,0,0,.38);padding:10px;pointer-events:auto}.rizz3d-bag-panel.is-open{display:block}
      .rizz3d-goals{display:none;position:absolute;inset:0;z-index:11;flex-direction:column;padding:16px 18px;background:linear-gradient(180deg,rgba(11,14,28,.96),rgba(4,6,13,.96));backdrop-filter:blur(4px);overflow:auto;pointer-events:auto}.rizz3d-goals.is-open{display:flex}
      .rizz3d-goal-head{display:grid;gap:3px;margin-bottom:12px}.rizz3d-goal-head strong{color:#fff;font:900 18px var(--font-display)}.rizz3d-goal-head span{color:rgba(255,255,255,.7);font:700 11px var(--font-mono)}
      .rizz3d-goal-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;align-content:start}
      .rizz3d-goal-tier{grid-column:1/-1;margin:8px 0 0;padding-bottom:3px;border-bottom:1px solid rgba(255,255,255,.14);color:var(--accent-2);font:900 10px var(--font-mono);text-transform:uppercase;letter-spacing:.08em}.rizz3d-goal-tier:first-child{margin-top:0}
      .rizz3d-goal{display:grid;grid-template-columns:30px 1fr auto;gap:9px;align-items:center;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(10,13,24,.8)}
      .rizz3d-goal.is-done{border-color:rgba(86,232,135,.42);background:linear-gradient(180deg,rgba(21,38,28,.85),rgba(9,14,22,.88))}
      .rizz3d-goal__icon{width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#06210f;font:900 16px var(--font-mono);box-shadow:inset 0 -7px 0 rgba(0,0,0,.2),0 0 0 1px rgba(255,255,255,.2)}
      .rizz3d-goal__text{display:grid;gap:1px;min-width:0}.rizz3d-goal__text b{color:#fff;font:900 12px var(--font-display)}.rizz3d-goal__text span{color:rgba(255,255,255,.62);font:700 9px var(--font-mono)}
      .rizz3d-goal.is-done .rizz3d-goal__text b{color:#9be870}
      .rizz3d-goal__pts{color:#ffd75a;font:900 11px var(--font-mono)}
      .rizz3d-goal-close{margin-top:14px;align-self:center;min-height:38px;padding:8px 20px;border:1px solid rgba(255,212,59,.5);border-radius:8px;background:rgba(255,212,59,.16);color:#fff;font:900 12px var(--font-mono);cursor:pointer}
      .rizz3d-bag-head{display:grid;gap:2px;margin-bottom:8px}.rizz3d-bag-head strong{color:#fff;font:900 13px var(--font-display)}.rizz3d-bag-head span,.rizz3d-bag-label{color:rgba(255,255,255,.68);font:700 10px var(--font-mono)}
      .rizz3d-bag-hover{min-height:24px;margin:6px 0 9px;padding:6px 8px;border:1px solid rgba(67,230,255,.22);border-radius:6px;background:rgba(67,230,255,.08);color:#fff;font:900 10px var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rizz3d-bag-hotbar,.rizz3d-bag-grid{display:grid;grid-template-columns:repeat(9,32px);gap:4px;margin:5px 0 9px}.rizz3d-bag-grid{grid-template-rows:repeat(3,32px)}.rizz3d-bag-chest{grid-template-rows:repeat(2,32px)}.rizz3d-bag-panel.is-chest{border-color:rgba(255,212,59,.4)}
      .rizz3d-furnace{display:flex;align-items:center;gap:10px;margin:6px 0 10px;padding:8px;border:1px solid rgba(255,212,59,.22);border-radius:8px;background:rgba(255,150,40,.08)}
      .rizz3d-furnace__col{display:grid;gap:3px;justify-items:center}
      .rizz3d-furnace__lab{color:rgba(255,255,255,.7);font:900 8px var(--font-mono);text-transform:uppercase}
      .rizz3d-furnace__arrow{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}.rizz3d-furnace__arrow span{display:block;height:100%;background:linear-gradient(90deg,#ff7a1a,#ffd75a)}
      .rizz3d-bag-slot{position:relative;width:32px;height:32px;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:rgba(12,15,26,.92);cursor:pointer}.rizz3d-bag-slot.is-selected{border-color:#ffd43b;box-shadow:0 0 0 2px rgba(255,212,59,.22)}.rizz3d-bag-slot em{position:absolute;left:3px;top:1px;color:rgba(255,255,255,.45);font:700 8px var(--font-mono);font-style:normal}.rizz3d-bag-slot b{position:absolute;right:3px;bottom:1px;color:#fff;font:800 9px var(--font-mono)}
      .rizz3d-damage{position:absolute;inset:-2%;z-index:4;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(255,54,54,0) 44%,rgba(255,40,40,.44) 100%);transition:opacity 80ms linear}
      .rizz3d-mobile-controls{display:none;position:absolute;inset:0;z-index:9;pointer-events:none;touch-action:none}
      .canvas-wrap--rizzcraft.has-touch-controls .rizz3d-mobile-controls.is-playable{display:block}
      .rizz3d-mobile-pad,.rizz3d-mobile-actions{position:absolute;display:grid;gap:6px;pointer-events:auto}
      .rizz3d-mobile-pad{left:max(10px,env(safe-area-inset-left));bottom:calc(58px + env(safe-area-inset-bottom));grid-template-columns:repeat(3,48px);grid-template-rows:repeat(3,48px)}
      .rizz3d-mobile-actions{right:max(10px,env(safe-area-inset-right));bottom:calc(58px + env(safe-area-inset-bottom));grid-template-columns:repeat(2,62px)}
      .rizz3d-mobile-look{position:absolute;left:50%;top:54px;transform:translateX(-50%);max-width:min(280px,62%);padding:5px 9px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(5,7,13,.5);color:rgba(255,255,255,.74);font:900 9px var(--font-mono);text-transform:uppercase;letter-spacing:.04em;pointer-events:none;text-align:center}
      .rizz3d-mobile-pad:before{content:"Move";grid-column:2;grid-row:2;align-self:center;justify-self:center;color:rgba(255,255,255,.46);font:900 9px var(--font-mono);text-transform:uppercase;pointer-events:none}
      .rizz3d-mobile-button{min-width:0;min-height:48px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(5,7,13,.66);box-shadow:0 10px 28px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.13);color:#fff;font:900 11px var(--font-mono);text-transform:uppercase;letter-spacing:0;touch-action:none;user-select:none;-webkit-user-select:none}
      .rizz3d-mobile-button:active,.rizz3d-mobile-button.is-active{border-color:#ffd43b;background:rgba(255,212,59,.24);box-shadow:0 0 0 2px rgba(255,212,59,.24),0 10px 28px rgba(0,0,0,.3)}
      .rizz3d-mobile-button:disabled{opacity:.45;filter:saturate(.7);cursor:not-allowed}
      .rizz3d-mobile-button--primary{background:rgba(255,212,59,.82);border-color:rgba(255,255,255,.32);color:#120d05}
      .rizz3d-mobile-button--danger{background:rgba(255,91,67,.78);border-color:rgba(255,255,255,.3);color:#fff}
      .rizz3d-mobile-button--flight{background:rgba(67,230,255,.2);border-color:rgba(67,230,255,.42);color:#c9fbff}
      .rizz3d-mobile-button--wide{grid-column:1 / -1}
      .rizz3d-mobile-button[data-mobile-move="forward"]{grid-column:2;grid-row:1}.rizz3d-mobile-button[data-mobile-move="left"]{grid-column:1;grid-row:2}.rizz3d-mobile-button[data-mobile-move="right"]{grid-column:3;grid-row:2}.rizz3d-mobile-button[data-mobile-move="back"]{grid-column:2;grid-row:3}
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-look{display:none}
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-pad{left:8px;bottom:42px;grid-template-columns:repeat(3,36px);grid-template-rows:repeat(3,36px);gap:4px}
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-actions{right:8px;bottom:44px;grid-template-columns:repeat(2,50px);gap:4px}
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-button{min-height:36px;border-radius:9px;font-size:8px}
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-actions [data-mobile-action="bag"],
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-actions [data-mobile-action="craft"],
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-actions [data-mobile-action="fly"],
      .canvas-wrap--rizzcraft.has-touch-controls:not(.is-maxed) .rizz3d-mobile-actions [data-mobile-action="creative"]{display:none}
      @media (hover:none) and (pointer:coarse){.rizz3d-hotbar{grid-template-columns:repeat(9,32px);gap:3px;bottom:calc(10px + env(safe-area-inset-bottom))}.rizz3d-slot{width:32px;height:32px}.rizz3d-slot .rizz3d-swatch{width:23px;height:23px}.rizz3d-bag-button{left:auto;right:8px;top:50px;bottom:auto;height:32px}.rizz3d-bag-panel{right:8px;top:88px;bottom:auto;max-height:calc(100% - 98px)}}
      @media (max-width:520px){.rizz3d-mobile-pad{left:8px;bottom:calc(50px + env(safe-area-inset-bottom));grid-template-columns:repeat(3,42px);grid-template-rows:repeat(3,42px);gap:5px}.rizz3d-mobile-actions{right:8px;bottom:calc(50px + env(safe-area-inset-bottom));grid-template-columns:repeat(2,54px);gap:5px}.rizz3d-mobile-button{min-height:42px;border-radius:10px;font-size:9px}.rizz3d-mobile-look{top:50px;max-width:54%;font-size:8px}.rizz3d-health{width:min(214px,56%)}}
      @media (max-height:560px){.rizz3d-mobile-look{display:none}.rizz3d-mobile-pad{bottom:calc(46px + env(safe-area-inset-bottom))}.rizz3d-mobile-actions{bottom:calc(46px + env(safe-area-inset-bottom))}.rizz3d-mobile-button{min-height:38px}}
    `;
    document.head.appendChild(style);
    const damage = document.createElement("div");
    damage.className = "rizz3d-damage";
    const health = document.createElement("div");
    health.className = "rizz3d-health";
    health.innerHTML = `<div class="rizz3d-health__row"><span>Health</span><b class="rizz3d-health__value">100/100</b></div><div class="rizz3d-health__track"><span class="rizz3d-health__fill"></span></div>`;
    const crosshair = document.createElement("div");
    crosshair.className = "rizz3d-crosshair";
    const bossBar = document.createElement("div");
    bossBar.className = "rizz3d-boss";
    bossBar.innerHTML = `<div class="rizz3d-boss__row"><span>☠️ SKIBIDI TITAN</span><b class="rizz3d-boss__value"></b></div><div class="rizz3d-boss__track"><span class="rizz3d-boss__fill"></span></div>`;
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
      primeAudio();
      const button = event.target.closest("[data-slot]");
      if (button) setSelectedSlot(Number(button.dataset.slot));
    });
    const bagButton = document.createElement("button");
    bagButton.className = "rizz3d-bag-button";
    bagButton.type = "button";
    bagButton.addEventListener("click", () => { primeAudio(); toggleBag(); });
    const bagPanel = document.createElement("div");
    bagPanel.className = "rizz3d-bag-panel";
    bagPanel.addEventListener("click", (event) => {
      primeAudio();
      const chestButton = event.target.closest("[data-chest-slot]");
      if (chestButton) { withdrawFromChest(Number(chestButton.dataset.chestSlot)); return; }
      const furnaceButton = event.target.closest("[data-furnace-slot]");
      if (furnaceButton) { takeFurnace(furnaceButton.dataset.furnaceSlot); return; }
      const hotbarButton = event.target.closest("[data-bag-hotbar]");
      if (hotbarButton) {
        const i = Number(hotbarButton.dataset.bagHotbar);
        if (state.openChest) depositToChest("hotbar", i);
        else if (state.openFurnace) loadFurnace("hotbar", i);
        else setSelectedSlot(i);
        return;
      }
      const bagButton = event.target.closest("[data-bag-slot]");
      if (bagButton) {
        const i = Number(bagButton.dataset.bagSlot);
        if (state.openChest) depositToChest("bag", i);
        else if (state.openFurnace) loadFurnace("bag", i);
        else swapBagSlotWithHotbar(i);
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
    const goalsPanel = document.createElement("div");
    goalsPanel.className = "rizz3d-goals";
    goalsPanel.addEventListener("click", (event) => {
      if (event.target.closest("[data-goal-close]")) { primeAudio(); toggleGoals(false); }
    });
    const mobileControls = document.createElement("div");
    mobileControls.className = "rizz3d-mobile-controls";
    mobileControls.setAttribute("aria-label", "Mobile controls");
    mobileControls.innerHTML = `
      <div class="rizz3d-mobile-look">Drag screen to look</div>
      <div class="rizz3d-mobile-pad" aria-label="Move">
        <button class="rizz3d-mobile-button" type="button" data-mobile-move="forward" aria-label="Move forward">▲</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-move="left" aria-label="Move left">◀</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-move="right" aria-label="Move right">▶</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-move="back" aria-label="Move backward">▼</button>
      </div>
      <div class="rizz3d-mobile-actions" aria-label="Actions">
        <button class="rizz3d-mobile-button rizz3d-mobile-button--danger" type="button" data-mobile-action="mine">Mine</button>
        <button class="rizz3d-mobile-button rizz3d-mobile-button--primary" type="button" data-mobile-action="place">Place</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-action="jump">Jump</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-action="sprint">Run</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-action="bag">Bag</button>
        <button class="rizz3d-mobile-button" type="button" data-mobile-action="craft">Craft</button>
        <button class="rizz3d-mobile-button rizz3d-mobile-button--flight" type="button" data-mobile-action="fly">Fly</button>
        <button class="rizz3d-mobile-button rizz3d-mobile-button--wide" type="button" data-mobile-action="creative">Creative</button>
      </div>
    `;
    if (wrap) wrap.classList.toggle("has-touch-controls", shouldShowTouchControls());
    mobileControls.setAttribute("aria-hidden", shouldShowTouchControls() ? "false" : "true");
    bindMobileHudControls(mobileControls);
    wrap.append(damage, health, bossBar, crosshair, target, progress, selectionCue, hotbar, bagButton, bagPanel, goalsPanel, mobileControls);
    return {
      damage,
      health,
      healthValue: health.querySelector(".rizz3d-health__value"),
      healthFill: health.querySelector(".rizz3d-health__fill"),
      bossBar,
      bossValue: bossBar.querySelector(".rizz3d-boss__value"),
      bossFill: bossBar.querySelector(".rizz3d-boss__fill"),
      crosshair,
      target,
      progress: progress.firstElementChild,
      selectionCue,
      hotbar,
      bagButton,
      bagPanel,
      goalsPanel,
      mobileControls,
    };
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
    disposeGroup(fishGroup);
    state.fx = [];
    state.fish = [];
    state.time = 0.21;
    wasNight = isNight();
    state.day = 1;
    state.spawnTimer = 2;
    state.mined = 0;
    state.score = 0;
    state.high = api.getHighScore(GAME_ID) || 0;
    state.selected = 0;
    heldRenderCode = null;
    state.sigmaForged = false;
    state.creative = false;
    state.flying = false;
    state.survivalBackup = null;
    state.swingTimer = 0;
    state.swingKind = "gather";
    state.attackFlash = 0;
    state.player.hurtAnim = 0;
    resetActiveFluids();
    state.effects.regen = state.effects.speed = state.effects.strength = state.effects.resist = 0;
    state.toiletFacing = {};
    state.chests = {};
    state.openChest = null;
    state.bedSpawn = null;
    state.furnaces = {};
    state.openFurnace = null;
    state.cropTick = 0;
    state.achievements = {};
    state.counters = { mobKills: 0, bossKills: 0, crops: 0, smelts: 0, looted: 0, eaten: 0, placed: 0 };
    state.everHad = {};
    state.flags = {};
    state.goalsOpen = false;
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
    playSfx("spawn", { volume: 0.8 });
  }
  function restart() {
    openWorldManager();
  }
  function togglePause() {
    if (!state.started) return;
    state.paused = !state.paused;
    playSfx(state.paused ? "pause" : "resume");
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
      creative: state.creative,
      survivalBackup: state.survivalBackup,
      toiletFacing: { ...state.toiletFacing },
      chests: state.chests,
      bedSpawn: state.bedSpawn,
      furnaces: state.furnaces,
      achievements: state.achievements,
      counters: state.counters,
      everHad: state.everHad,
      flags: state.flags,
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
    state.toiletFacing = (data.toiletFacing && typeof data.toiletFacing === "object") ? { ...data.toiletFacing } : {};
    state.chests = (data.chests && typeof data.chests === "object") ? data.chests : {};
    state.bedSpawn = (data.bedSpawn && typeof data.bedSpawn === "object") ? data.bedSpawn : null;
    state.furnaces = (data.furnaces && typeof data.furnaces === "object") ? data.furnaces : {};
    state.achievements = (data.achievements && typeof data.achievements === "object") ? data.achievements : {};
    state.counters = Object.assign({ mobKills: 0, bossKills: 0, crops: 0, smelts: 0, looted: 0, eaten: 0, placed: 0 }, data.counters || {});
    state.everHad = (data.everHad && typeof data.everHad === "object") ? data.everHad : {};
    state.flags = (data.flags && typeof data.flags === "object") ? data.flags : {};
    state.openChest = null;
    state.openFurnace = null;
    state.cropTick = 0;
    state.goalsOpen = false;
    for (const [key, code] of state.edits.entries()) {
      const [x, y, z] = key.split(",").map(Number);
      if (inWorld(x, y, z)) state.world[index(x, y, z)] = code;
    }
    for (let z = 0; z < WORLD_Z; z++) for (let x = 0; x < WORLD_X; x++) updateSurfaceColumn(x, z);
    computeWorldLight();
    if (data.player) {
      Object.assign(state.player, data.player);
      rescuePlayerFromSolid();
    }
    rebuildAllChunks();
    rebuildDecorations();
    spawnFish();
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
    state.creative = !!data.creative;
    state.flying = false;
    state.survivalBackup = (data.survivalBackup && typeof data.survivalBackup === "object") ? data.survivalBackup : null;
    if (state.creative) refillCreativeInventory();
    updateCreativeButtons();
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
    updateFish(dt);
    updateFx(dt);
    if (state.started && !state.paused && !state.crafting && !state.bagOpen) {
      updateTime(dt);
      updateEffects(dt);
      updatePlayer(dt);
      updateVisibleChunks();
      updateMobs(dt);
      updateCaveCreatures(dt);
      updateTarget();
      updateMining(dt);
      updatePlacing(dt);
      updateFurnaces(dt);
      updateCrops(dt);
      updateFluidSimulation(dt);
      flushFluidChunkRebuilds();
      if (state.attackCd > 0) state.attackCd -= dt;
      state.achvTick += dt;
      if (state.achvTick >= 1) { state.achvTick = 0; checkAchievements(); }
    }
    if (decorDirty) rebuildDecorations();
    updateWaterTexture(dt);
    updateLighting();
    updateHud();
    renderer.render(scene, camera);
  }

  function bindInput() {
    window.addEventListener("keydown", (event) => {
      primeAudio();
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      const movementHandled = setKeyboardMove(key, true);
      if (key === " " || key === "spacebar") {
        if (!event.repeat) handleJumpTap();
        state.input.jump = true;
      }
      if (key === "shift") state.input.sprint = true;
      if (key >= "1" && key <= "9") setSelectedSlot(Number(key) - 1);
      if (key === "e") toggleCrafting();
      if (key === "b") toggleBag();
      if (key === "g") toggleGoals();
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
    const refreshTouchControls = () => {
      setTouchControlsVisible(shouldShowTouchControls());
      updateMobileControlState();
    };
    refreshTouchControls();
    if (touchControlsQuery) {
      if (touchControlsQuery.addEventListener) touchControlsQuery.addEventListener("change", refreshTouchControls);
      else if (touchControlsQuery.addListener) touchControlsQuery.addListener(refreshTouchControls);
    }
    window.addEventListener("resize", refreshTouchControls);
    window.addEventListener("orientationchange", refreshTouchControls);
    canvas.addEventListener("click", () => {
      primeAudio();
      if (performance.now() < suppressMouseUntil) return;
      if (state.started && !state.paused && !state.crafting && !state.bagOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    canvas.addEventListener("mousedown", (event) => {
      primeAudio();
      if (performance.now() < suppressMouseUntil) return;
      if (!state.started || state.paused || state.crafting || state.bagOpen) return;
      canvas.focus();
      if (event.button === 2) {
        state.input.place = true;
        state.placeQueued = true;
      }
      else if (state.creative || !selectedIsBlock() || selectedIsTorch()) {
        // Creative breaks anything on left-click, even while holding a block to place.
        state.input.mine = true;
        triggerHeldSwing(selectedIsTorch() ? "attack" : "gather");
      }
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 2) state.input.place = false;
      else state.input.mine = false;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
      primeAudio();
      event.preventDefault();
      setSelectedSlot((state.selected + (event.deltaY > 0 ? 1 : -1) + HOTBAR) % HOTBAR);
    }, { passive: false });
    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== canvas || state.paused || state.crafting) return;
      state.player.yaw -= event.movementX * 0.0022;
      state.player.pitch = clamp(state.player.pitch - event.movementY * 0.0022, -1.45, 1.45);
    });
    canvas.addEventListener("pointerdown", (event) => {
      primeAudio();
      if (event.pointerType === "mouse" || !canUseMobileAction()) return;
      suppressMouseUntil = performance.now() + 700;
      touchLook.pointerId = event.pointerId;
      touchLook.x = event.clientX;
      touchLook.y = event.clientY;
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId); } catch (error) {}
      event.preventDefault();
    }, { passive: false });
    canvas.addEventListener("pointermove", (event) => {
      if (touchLook.pointerId !== event.pointerId) return;
      const dx = event.clientX - touchLook.x;
      const dy = event.clientY - touchLook.y;
      touchLook.x = event.clientX;
      touchLook.y = event.clientY;
      state.player.yaw -= dx * 0.006;
      state.player.pitch = clamp(state.player.pitch - dy * 0.006, -1.45, 1.45);
      event.preventDefault();
    }, { passive: false });
    const stopTouchLook = (event) => {
      if (touchLook.pointerId === event.pointerId) touchLook.pointerId = null;
    };
    canvas.addEventListener("pointerup", stopTouchLook);
    canvas.addEventListener("pointercancel", stopTouchLook);
    canvas.addEventListener("lostpointercapture", stopTouchLook);
  }
  function unlockPointer() {
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }
  function bindButtons() {
    const primary = document.getElementById("btn-primary");
    if (primary) primary.addEventListener("click", () => {
      primeAudio();
      if (state.paused) togglePause();
      else if (!state.started) createWorld("New World", "");
    });
    bind("btn-pause", togglePause);
    bind("btn-restart", restart);
    bind("btn-creative", () => toggleCreativeMode());
    bind("btn-craft", () => toggleCrafting());
    bind("btn-goals", () => toggleGoals());
    bind("btn-craft-close", () => toggleCrafting(false));
    bind("btn-mine", () => { state.mode = "mine"; updateModeButtons(); });
    bind("btn-place", () => { state.mode = "place"; updateModeButtons(); });
    bindHold("btn-left", () => { moveSources.touch.right = -1; applyDirectionalInput(); }, () => { if (moveSources.touch.right < 0) { moveSources.touch.right = 0; applyDirectionalInput(); } });
    bindHold("btn-right", () => { moveSources.touch.right = 1; applyDirectionalInput(); }, () => { if (moveSources.touch.right > 0) { moveSources.touch.right = 0; applyDirectionalInput(); } });
    bindHold("btn-jump", () => { handleJumpTap(); state.input.jump = true; }, () => { state.input.jump = false; });
    bind("btn-heal", async () => {
      if (!state.started) return api.toast("Start the game first", "");
      const ok = api.isAdFree() || await api.showRewarded();
      if (ok) {
        state.player.hp = MAX_HP;
        giveItem(TORCH, 16);
        playSfx("reward");
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
        playSfx("reward");
        api.toast("Stone kit + Crafting Toilet", "good");
      }
    });
    bindFullscreen();
  }
  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el && fn) el.addEventListener("click", (event) => {
      primeAudio();
      fn(event);
    });
  }
  function bindHold(id, down, up) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (event) => { event.preventDefault(); primeAudio(); down(); };
    const off = (event) => { event.preventDefault(); up(); };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  }
  function bindMobileHudControls(root) {
    if (!root) return;
    root.addEventListener("contextmenu", (event) => event.preventDefault());
    root.querySelectorAll("[data-mobile-move]").forEach((button) => {
      const direction = button.dataset.mobileMove;
      bindTouchButton(button, () => { if (canUseMobileAction()) setTouchMove(direction, true); }, () => setTouchMove(direction, false));
    });
    root.querySelectorAll("[data-mobile-action]").forEach((button) => {
      const action = button.dataset.mobileAction;
      if (action === "mine") bindTouchButton(button, () => setMobileMine(true), () => setMobileMine(false));
      else if (action === "place") bindTouchButton(button, () => queueMobilePlace(), () => { state.input.place = false; });
      else if (action === "jump") bindTouchButton(button, () => { handleJumpTap(); state.input.jump = true; }, () => { state.input.jump = false; });
      else if (action === "sprint") bindTouchButton(button, () => { state.input.sprint = true; }, () => { state.input.sprint = false; });
      else if (action === "bag") button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); primeAudio(); toggleBag(); });
      else if (action === "craft") button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); primeAudio(); toggleCrafting(); });
      else if (action === "fly") button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); primeAudio(); if (state.creative) setFlying(!state.flying); updateMobileControlState(); });
      else if (action === "creative") button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); primeAudio(); toggleCreativeMode(); });
    });
  }
  function bindTouchButton(el, down, up) {
    let active = false;
    const start = (event) => {
      event.preventDefault();
      event.stopPropagation();
      primeAudio();
      active = true;
      el.classList.add("is-active");
      try { if (event.pointerId !== undefined && el.setPointerCapture) el.setPointerCapture(event.pointerId); } catch (error) {}
      down();
    };
    const end = (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
      active = false;
      el.classList.remove("is-active");
      up();
    };
    el.addEventListener("pointerdown", start, { passive: false });
    el.addEventListener("pointerup", end, { passive: false });
    el.addEventListener("pointercancel", end, { passive: false });
    el.addEventListener("lostpointercapture", end);
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
      primeAudio();
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
  function teleportTo(x, y, z, yaw, pitch) {
    Object.assign(state.player, { x: x + 0.5, y: y + 1.05, z: z + 0.5, vx: 0, vy: 0, vz: 0, onGround: false, hurtCd: 0 });
    if (typeof yaw === "number") state.player.yaw = yaw;
    if (typeof pitch === "number") state.player.pitch = pitch;
    updateVisibleChunks(true);
    decorDirty = true;
    syncCamera();
  }
  function findBiomeSpot(biomeId) {
    let best = null;
    let bestScore = -1;
    for (let z = 14; z < WORLD_Z - 14; z += 4) {
      for (let x = 14; x < WORLD_X - 14; x += 4) {
        const si = surfaceIndex(x, z);
        if (state.biome[si] !== biomeId) continue;
        const y = state.surface[si];
        if (y <= SEA_LEVEL || getBlock(x, y + 1, z) === WATER) continue;
        let score = 0;
        for (let oz = -12; oz <= 12; oz += 4) {
          for (let ox = -12; ox <= 12; ox += 4) {
            if (state.biome[surfaceIndex(x + ox, z + oz)] === biomeId) score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, z, biome: BIOMES[biomeId] && BIOMES[biomeId].name, localScore: score };
        }
      }
    }
    if (best) return best;
    for (let z = 2; z < WORLD_Z - 2; z++) {
      for (let x = 2; x < WORLD_X - 2; x++) {
        const si = surfaceIndex(x, z);
        if (state.biome[si] !== biomeId) continue;
        const y = state.surface[si];
        if (y > SEA_LEVEL && getBlock(x, y + 1, z) !== WATER) return { x, y, z, biome: BIOMES[biomeId] && BIOMES[biomeId].name, localScore: 1 };
      }
    }
    return null;
  }
  function findWaterSpot() {
    for (let z = 2; z < WORLD_Z - 2; z += 2) {
      for (let x = 2; x < WORLD_X - 2; x += 2) {
        const range = fishWaterRangeAt(x, z);
        if (range && range.depth >= 5) return { x, y: Math.floor(range.min), z, depth: range.depth };
      }
    }
    return null;
  }
  function findValleySpot() {
    let best = null;
    let bestScore = -Infinity;
    for (let z = 12; z < WORLD_Z - 12; z += 4) {
      for (let x = 12; x < WORLD_X - 12; x += 4) {
        const y = state.surface[surfaceIndex(x, z)];
        if (y <= SEA_LEVEL + 1 || getBlock(x, y + 1, z) === WATER) continue;
        const n = state.surface[surfaceIndex(x, z - 10)];
        const s = state.surface[surfaceIndex(x, z + 10)];
        const e = state.surface[surfaceIndex(x + 10, z)];
        const w = state.surface[surfaceIndex(x - 10, z)];
        const rim = Math.max(n, s, e, w);
        const avg = (n + s + e + w) / 4;
        const score = (rim - y) * 1.3 + (avg - y);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, z, score: Math.round(score * 10) / 10 };
        }
      }
    }
    return best;
  }
  function selectInventoryCode(code) {
    for (let i = 0; i < state.hotbar.length; i++) {
      if (state.hotbar[i] && state.hotbar[i].code === code) {
        setSelectedSlot(i, false);
        return true;
      }
    }
    giveItem(code, 1);
    return selectInventoryCode(code);
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
    BIOMES,
    RECIPES,
    startGame,
    restart,
    giveItem,
    createWorld,
    loadWorld,
    readWorldIndex,
    saveCurrentWorld,
    spawnMob,
    spawnCaveCreatures,
    generateWorld,
    rebuildAllChunks,
    updateVisibleChunks,
    getBlock,
    setBlock,
    flowWaterNear,
    flowLavaNear,
    processActiveWater,
    processActiveLava,
    flushFluidChunkRebuilds,
    spreadLavaFrom,
    settleGeneratedLava,
    flowLiquidsNear,
    heldAttackDamage,
    triggerHeldSwing,
    damageMob,
    damageCaveCreature,
    damageFriendly,
    applyTorchBurn,
    spawnBlockBurst,
    spawnFriendlies,
    findBlock,
    teleportTo,
    findBiomeSpot,
    findWaterSpot,
    findValleySpot,
    selectInventoryCode,
    hurtPlayer,
    playSfx,
    primeAudio,
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
        pendingFluidChunks: pendingFluidChunks.size,
        caveCreatureCount: state.caveCreatures.length,
        activeWater: state.activeWater.length - activeWaterHead,
        activeLava: state.activeLava.length - activeLavaHead,
        caveCreatureTypes: state.caveCreatures.reduce((counts, creature) => {
          counts[creature.type] = (counts[creature.type] || 0) + 1;
          return counts;
        }, {}),
        friendlyCount: state.friendlies.length,
        fishCount: state.fish.length,
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
        heldTorchLight: heldTorchLight.intensity,
        playerHurtAnim: state.player.hurtAnim,
        sunVisible: !!(sunDisk && sunDisk.visible),
        sunOpacity: sunDisk ? sunDisk.material.opacity : 0,
        moonVisible: !!(moonDisk && moonDisk.visible),
        moonOpacity: moonDisk ? moonDisk.material.opacity : 0,
      };
    },
    setTime(t) { state.time = t; },
    teleportSpawn() { spawnPlayer(); },
    lightAt(x, y, z) {
      x |= 0; y |= 0; z |= 0;
      if (!inWorld(x, y, z)) return null;
      const i = index(x, y, z);
      return { sky: getSkyLight(i), block: getBlockLight(i), skyOpen: skyOpen(x, y, z), skyHeight: state.skyHeight[surfaceIndex(x, z)] };
    },
    recomputeLight() { computeWorldLight(); rebuildAllChunks(); decorDirty = true; },
    craftByOutput(code) { const r = RECIPES.find((x) => x.out.code === code); return r ? doCraft(r) : false; },
    canCraftByOutput(code) { const r = RECIPES.find((x) => x.out.code === code); return r ? canCraft(r) : false; },
    eatSelected() { return tryEatSelected(); },
    effects() { return { ...state.effects }; },
    openChest(x, y, z) { toggleChestAt(x | 0, y | 0, z | 0); },
    chestAt(x, y, z) { return state.chests[chestKey(x | 0, y | 0, z | 0)] || null; },
    depositSlot(area, i) { depositToChest(area, i); },
    withdrawSlot(i) { withdrawFromChest(i); },
    sleep(x, y, z) { sleepInBed(x | 0, y | 0, z | 0); },
    toggleDoorAt(x, y, z) { toggleDoor(x | 0, y | 0, z | 0); },
    snapshotData() { return snapshot(); },
    openFurnace(x, y, z) { toggleFurnaceAt(x | 0, y | 0, z | 0); },
    furnaceAt(x, y, z) { return state.furnaces[chestKey(x | 0, y | 0, z | 0)] || null; },
    furnaceLoad(area, i) { loadFurnace(area, i); },
    furnaceTake(which) { takeFurnace(which); },
    tickFurnaces(dt) { updateFurnaces(dt); },
    tickCrops(dt) { state.cropTick = 99; updateCrops(dt); },
    summonBoss() { return summonBoss(); },
    goalsState() { return { earned: achievementsEarned(), total: ACHIEVEMENTS.length, done: Object.keys(state.achievements), counters: { ...state.counters } }; },
    checkGoals() { checkAchievements(); },
    openGoals() { toggleGoals(true); },
    bossInfo() { const b = state.mobs.find((m) => MOB[m.type] && MOB[m.type].boss); return b ? { hp: b.hp, maxHp: b.maxHp, type: b.type } : null; },
    damageBoss(d) { const b = state.mobs.find((m) => MOB[m.type] && MOB[m.type].boss); if (b) damageMob(b, d); },
    mobLootFor(type) { return (MOB_LOOT[type] || []).map((e) => `${DEF[e[0]].name} ${Math.round(e[1] * 100)}% x${e[2]}-${e[3]}`); },
    structureStats() {
      let surfaceChests = 0, deepChests = 0, lootChests = 0;
      for (const key in state.chests) {
        const [x, y, z] = key.split(",").map(Number);
        if (getBlock(x, y, z) !== CHEST) continue;
        if (state.chests[key].some((s) => s)) lootChests++;
        if (y >= SEA_LEVEL) surfaceChests++; else deepChests++;
      }
      return { surfaceChests, deepChests, lootChests, totalChests: Object.keys(state.chests).length };
    },
    chestLootAt(x, y, z) { const s = state.chests[chestKey(x | 0, y | 0, z | 0)]; return s ? s.filter(Boolean).map((it) => `${DEF[it.code].name} x${it.n}`) : null; },
  };
})();
