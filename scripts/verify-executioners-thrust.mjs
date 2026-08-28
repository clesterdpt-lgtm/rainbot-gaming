import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log("--- 1. Testing Talent Config & Naming ---");
const progConfig = await import("../assets/js/saintfall/progression-config.js");
const allTalents = progConfig.DOCTRINE_ORDERS.flatMap((o) => o.talents);
const measure = allTalents.find((t) => t.id === "procession_executioners_measure");
const furnace = allTalents.find((t) => t.id === "censer_furnace_reprieve");

assert(!!measure, "procession_executioners_measure found in TALENTS");
assert(measure.name === "Executioner's Thrust", `Name is 'Executioner's Thrust' (got '${measure.name}')`);
assert(measure.summary.includes("piercing thrust"), `Summary describes piercing thrust (got '${measure.summary}')`);
assert(measure.ranks[0].description.includes("15 charge"), "Rank 1 description mentions charge consumption");
assert(measure.ranks[0].description.includes("240%"), "Rank 1 description mentions 240% damage");
assert(measure.ranks[1].description.includes("340%"), "Rank 2 description mentions 340% damage");
assert(measure.ranks[1].description.includes("exposes heavy enemies"), "Rank 2 description mentions exposing heavy enemies");
assert(!!furnace, "censer_furnace_reprieve found in TALENTS");
assert(progConfig.FURNACE_LANCE_RULES.ranks[1].chargeSeconds === 1.2,
  "Furnace Lance rank 1 requires a 1.2-second charge");
assert(progConfig.FURNACE_LANCE_RULES.ranks[2].damage === 160,
  "Furnace Lance rank 2 damage is capped at 160");
assert(furnace.summary.includes("alternate fire"), "Furnace Lance copy names alternate fire");

console.log("\n--- 2. Testing Keybinds ---");
const keybindsModule = await import("../assets/js/saintfall/keybinds.js");
const meleeAction = keybindsModule.KEYBIND_ACTIONS.find((a) => a.id === "melee");
const wheelAction = keybindsModule.KEYBIND_ACTIONS.find((a) => a.id === "wheel");
const furnaceAction = keybindsModule.KEYBIND_ACTIONS.find((a) => a.id === "furnace");
assert(meleeAction.defaults.includes("KeyF"), "melee default includes KeyF");
assert(furnaceAction.defaults.includes("KeyZ"), "Furnace Lance has a distinct Z default");
assert(wheelAction.defaults.includes("KeyQ"), "command wheel retains Q");

console.log("\n--- 3. Testing Icon Asset ---");
const iconPath = path.join(root, "assets", "img", "saintfall", "talents", "procession_executioners_measure.jpg");
assert(existsSync(iconPath), "procession_executioners_measure.jpg exists");
const stat = statSync(iconPath);
assert(stat.size > 1000, `procession_executioners_measure.jpg is valid size (${stat.size} bytes)`);

console.log("\n--- 4. Testing File Syntax & Exports ---");
const playerCode = readFileSync(path.join(root, "assets", "js", "saintfall", "player.js"), "utf-8");
assert(playerCode.includes("MELEE_PIERCE_SPEED = 34.0"), "player.js defines MELEE_PIERCE_SPEED");
assert(playerCode.includes("meleePierce: {"), "player.js defines ACTIONS.meleePierce");
assert(playerCode.includes("function meleePierce("), "player.js defines meleePierce method");
assert(playerCode.includes("meleePierce,"), "player.js exports meleePierce");
assert(playerCode.includes('ctx.progression?.rank?.("procession_executioners_measure")'),
  "player.js reads Executioner's Thrust through the live progression API");

const combatCode = readFileSync(path.join(root, "assets", "js", "saintfall", "combat.js"), "utf-8");
assert(combatCode.includes("const isPierce = Math.abs(sweepId) === 6 || comboStep === 6;"), "combat.js identifies piercing melee attacks");
assert(combatCode.includes("isPierce,"), "combat.js emits isPierce in meleeEvent");
assert(combatCode.includes("const damage = opts.damage ?? rule.damage;"),
  "Furnace beam damage reads the shared balance contract");
assert(!combatCode.includes("rank >= 2 ? 320 : 180"),
  "the old 180/320 Furnace damage path is gone");

const mainCode = readFileSync(path.join(root, "assets", "js", "saintfall", "main.js"), "utf-8");
assert(mainCode.includes("function meleePierce("), "main.js defines meleePierce");
assert(mainCode.includes("meleeCharging"), "main.js tracks meleeCharging state");
assert(mainCode.includes("MELEE_HOLD_GATE"), "main.js defines MELEE_HOLD_GATE for tap vs hold separation");
assert(mainCode.includes("chargeRatio"), "main.js passes variable chargeRatio based on hold time");

const vfxCode = readFileSync(path.join(root, "assets", "js", "saintfall", "vfx.js"), "utf-8");
assert(vfxCode.includes("6: Object.freeze({"), "vfx.js has MELEE_SWEEPS[6]");
assert(vfxCode.includes("case \"thrust\":"), "vfx.js handles thrust doctrineCue");
assert(vfxCode.includes("meleePierceCharge,"), "vfx.js exports meleePierceCharge");
assert(vfxCode.includes("sweepReach"), "vfx.js scales sweepReach with variable thrust reach");

const audioCode = readFileSync(path.join(root, "assets", "js", "saintfall", "audio.js"), "utf-8");
assert(audioCode.includes("meleePierceCharge,"), "audio.js exports meleePierceCharge");
assert(audioCode.includes("meleePierceLaunch,"), "audio.js exports meleePierceLaunch");

console.log("\n🎉 ALL UNIT CHECKS PASSED!");
