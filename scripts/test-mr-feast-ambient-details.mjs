import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Milestone 53 — Mansion Ambient Detail Pass. Static acceptance for the
// estate planting, dining service, kitchen dressing, suite dressing, and
// basement vignette decor added across the existing rooms.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const mansion = fs.readFileSync(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
const page = fs.readFileSync(path.join(root, "games/mr-feast-mansion.html"), "utf8");

const failures = [];

function check(requirement, condition, detail) {
  let passed = false;
  try {
    passed = typeof condition === "function" ? Boolean(condition()) : Boolean(condition);
  } catch (error) {
    detail = `${detail} (${error.message})`;
  }
  if (!passed) failures.push({ requirement, detail });
}

function section(startMarker, endMarker, text = mansion) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  return text.slice(start, end < 0 ? text.length : end);
}

function count(text, pattern) {
  return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))).length;
}

// ---------------------------------------------------------------------------
// 1. Estate planting layout is a named constant table, not inline magic.
const plantingLayout = section("const ESTATE_PLANTING_LAYOUT", "});");
check("1 planting constant table", plantingLayout.length > 0, "ESTATE_PLANTING_LAYOUT constant table is missing");
check("1 planting constant table", /facadeBedSpans/.test(plantingLayout) && /drivewayShrubZs/.test(plantingLayout), "planting table must declare facade bed spans and driveway shrub stations");

// Facade beds stay clear of the portico aisle: every span keeps |x| >= 4.2.
const facadeSpans = Array.from(plantingLayout.matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g))
  .map((match) => [Number(match[1]), Number(match[2])])
  .filter(([a, b]) => Math.abs(a) > 3 && Math.abs(b) > 3);
check("1 portico aisle clear", facadeSpans.length >= 2 && facadeSpans.every(([a, b]) => Math.min(Math.abs(a), Math.abs(b)) >= 4.2), "foundation beds must flank the portico without crossing the entry aisle");

// Driveway shrubs never occupy the host's gate response spot (z≈29.5) and sit
// beyond the paved edge at |x| >= 3.5.
const shrubZs = (plantingLayout.match(/drivewayShrubZs:[^\]]*\]/) || [""])[0].match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
check("1 driveway shrub stations", shrubZs.length >= 5, "driveway lining needs at least five shrub stations per side");
check("1 host response spot clear", shrubZs.every((z) => z < 28.6 || z > 30.4), "a driveway shrub occupies Mr. Feast's gate response spot near z=29.5");
const edgeX = Number(plantingLayout.match(/drivewayEdgeX:\s*([\d.]+)/)?.[1]);
check("1 shrubs off the pavers", edgeX >= 3.5, "driveway shrubs must stand outside the limestone edging");

// 2. The planting builder exists, is wired into the yard build, and keeps the
// culling-friendly estate/driveway/portico name prefixes.
const yardBuild = section("function buildEstateYard()", "function buildExteriorScene()");
check("2 planting builder wired", /buildFoundationPlantings\(\);/.test(yardBuild), "buildEstateYard does not invoke buildFoundationPlantings");
const plantingBuilder = section("function buildFoundationPlantings()", "\n  function ", yardBuild);
check("2 planting builder", plantingBuilder.length > 0, "buildFoundationPlantings is missing from the yard build region");
check("2 culling-safe names", /estate-foundation/.test(plantingBuilder) && /driveway-lining-shrubs/.test(plantingBuilder) && /portico-planter/.test(plantingBuilder), "planting meshes need estate-/driveway-/portico- names so facade culling keeps them");
check("2 urn colliders", /portico-planter[\s\S]*?physics\.addFixedBox\(/.test(plantingBuilder), "the portico planter urns need fixed colliders");
check("2 shrubs stay soft", !/drivewayShrubZs[\s\S]*?physics\.addFixedBox/.test(section("const drivewayShrubClumps", "yardState", plantingBuilder) || ""), "low driveway shrubs must not add invisible-wall colliders");
check("2 feature diagnostics", /yardState\.featureCounts\.foundationPlantings\s*=/.test(plantingBuilder), "yard diagnostics do not count the new foundation plantings");

// ---------------------------------------------------------------------------
// 3. Dining table service: tabletop-only decor in the dining section.
const mainFurnishings = section("function furnishMainFloor()", "function furnishUpperFloor()");
const diningSection = section("// Dining room", "// Ballroom", mainFurnishings);
check("3 dining service wired", /addDiningTableService\(\);/.test(diningSection), "furnishMainFloor's dining section does not invoke addDiningTableService");
const diningBuilder = section("function addDiningTableService()", "\n  function ");
check("3 dining service builder", diningBuilder.length > 0, "addDiningTableService is missing");
const seatTable = section("const DINING_SERVICE_SEATS", "]);");
check("3 ten place settings", count(seatTable, /\(\[-?\d/g) >= 10, "the dining service needs a place setting for all ten chairs");
check("3 candelabra pair", count(diningBuilder, /dining-candelabrum/g) >= 2, "the long table needs a pair of brass candelabra");
check("3 table runner", /dining-table-runner/.test(diningBuilder), "the dining table needs a fabric runner");
check("3 centerpiece", /dining-centerpiece/.test(diningBuilder), "the dining table needs a centerpiece bowl");
check("3 tabletop only", !/physics\.addFixedBox/.test(diningBuilder), "dining decor is tabletop-only and must not add colliders");

// 4. Kitchen counter dressing: called from the remodel, keeps the sink span
// clear, and adds no tables or chairs to the work aisle.
const kitchenBuilder = section("function addKitchenBaseCabinet(", "function addWineRack(");
check("4 kitchen dressing wired", /addKitchenCounterDressing\(\);/.test(kitchenBuilder), "addRemodeledKitchen does not invoke addKitchenCounterDressing");
const kitchenDressing = section("function addKitchenCounterDressing()", "\n  function ");
check("4 kitchen dressing builder", kitchenDressing.length > 0, "addKitchenCounterDressing is missing");
check("4 no aisle furniture", !/addTable\(|addChair\(/.test(kitchenDressing), "kitchen dressing must not reintroduce work-aisle furniture");
const rearCounterItems = Array.from(kitchenDressing.matchAll(/x:\s*(-?[\d.]+)[^}]*z:\s*(-11\.[\d]+)/g)).map((match) => Number(match[1]));
check("4 sink span clear", rearCounterItems.length >= 3 && rearCounterItems.every((x) => x < 8.7 || x > 10.6), "rear-counter dressing intrudes on the working sink span (x 8.7–10.6)");
check("4 range kettle", /kitchen-copper-kettle/.test(kitchenDressing), "the range deserves its copper kettle");

// 5. Suite dressing: all four upper bedrooms, nightstand colliders, and
// placements that stay off Mr. Feast's suite patrol lanes (|z| >= 8).
const upperFurnishings = section("function furnishUpperFloor()", "function furnishBasement()");
check("5 four suites dressed", count(upperFurnishings, /addBedroomSuiteDressing\(/g) >= 4, "all four upper suites must receive bedside dressing");
const suiteBuilder = section("function addBedroomSuiteDressing(", "\n  function ");
check("5 suite builder", suiteBuilder.length > 0, "addBedroomSuiteDressing is missing");
check("5 nightstand colliders", /physics\.addFixedBox/.test(suiteBuilder), "nightstands and trunks need fixed colliders");
const suiteCalls = Array.from(upperFurnishings.matchAll(/addBedroomSuiteDressing\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)).map((match) => Number(match[2]));
check("5 off patrol lanes", suiteCalls.length >= 4 && suiteCalls.every((z) => Math.abs(z) >= 8), "suite dressing anchors must hug the beds, clear of the z≈±6 patrol lanes");
check("5 travel trunks", /suite-travel-trunk/.test(suiteBuilder), "each suite needs a contestant travel trunk at the bed foot");

// 6. Basement vignettes: laundry, wine cellar, and bulk storage.
const basementFurnishings = section("function furnishBasement()", "function buildLighting()");
check("6 laundry details wired", /addLaundryDetails\(\);/.test(basementFurnishings), "furnishBasement does not invoke addLaundryDetails");
const laundryBuilder = section("function addLaundryDetails()", "\n  function ");
check("6 drying lines", /laundry-drying-line/.test(laundryBuilder) && /laundry-hanging-linen/.test(laundryBuilder), "the laundry needs strung drying lines with hanging linens");
check("6 washtub", /laundry-washtub/.test(laundryBuilder) && /physics\.addFixedBox/.test(laundryBuilder), "the laundry needs a solid washtub");
check("6 wine tasting set", /addWineCellarDetails\(\);/.test(basementFurnishings) && /wine-tasting/.test(section("function addWineCellarDetails()", "\n  function ")), "the wine cellar tasting table is still bare");
check("6 cellar barrels", count(section("function addWineCellarDetails()", "\n  function "), /wine-cellar-barrel(?:-hoop)?"/g) >= 2, "the wine cellar needs aging barrels");
check("6 bulk storage filled", /addBulkStorageDetails\(\);/.test(basementFurnishings), "furnishBasement does not invoke addBulkStorageDetails");
const bulkBuilder = section("function addBulkStorageDetails()", "\n  function ");
check("6 stacked crates and tarp", /storage-crate-stacked/.test(bulkBuilder) && /storage-tarp-covered/.test(bulkBuilder) && /storage-barrel/.test(bulkBuilder), "bulk storage needs stacked crates, barrels, and a tarp-covered pile");

// 7. Main-floor vignettes: music stand, library writing set, lounge tea set,
// and the boiler-room coal scuttle.
check("7 music room details", /addMusicRoomDetails\(\);/.test(mainFurnishings) && /music-sheet-stand/.test(section("function addMusicRoomDetails()", "\n  function ")), "the music room needs its sheet stand vignette");
check("7 library writing set", /addLibraryWritingSet\(\);/.test(mainFurnishings) && /library-open-book/.test(section("function addLibraryWritingSet()", "\n  function ")), "the library writing table is still bare");
check("7 lounge tea service", /addRearLoungeTeaService\(\);/.test(upperFurnishings) && /lounge-teapot/.test(section("function addRearLoungeTeaService()", "\n  function ")), "the rear lounge table needs its tea service");
check("7 boiler scuttle", /boiler-coal-scuttle/.test(basementFurnishings) || /boiler-coal-scuttle/.test(section("function addBoilerRoomDetails()", "\n  function ")), "the boiler room needs its coal scuttle");

// 8. Contestant-safe placements: nothing sits on Mara's library route stops or
// the Feast Says ballroom marks.
const libraryWritingSet = section("function addLibraryWritingSet()", "\n  function ");
check("8 library floor clear", !/physics\.addFixedBox/.test(libraryWritingSet), "the library writing set is tabletop decor and must not block Mara's seat approach");

// 10. Second detail pass. Basement corridor fixtures drop their chandelier
// rings for the shared utility cage-and-bulb look while keeping the authored
// cone emitters (check 29 of the renovation suite still forbids corridor
// omnis), and the mantels, vanities, foyer consoles, rear corridor ceiling,
// pool deck, and rear terrace each gain one dressed vignette.
const fixtureBuilder = section("addFixture(x, z, style, floorYOverride)", "addCeilingResponseGlow");
check("10 uniform basement fixtures", /const utilityLook = style === "basement" \|\| \(style === "corridor" && fixtureFloorY === FLOOR\.BASEMENT\)/.test(fixtureBuilder), "basement corridor fixtures still hang formal chandelier rings");
check("10 uniform basement fixtures", /if \(utilityLook\) \{/.test(fixtureBuilder) && /ring\.castShadow\s*=\s*style\s*===\s*"atrium"/.test(fixtureBuilder), "the utility look must swap only the visible geometry, leaving ring shadows and emitters authored");
check("10 mantel decor", count(mainFurnishings + upperFurnishings, /addMantelDecor\(/g) >= 3, "all three fireplaces should carry mantel decor");
check("10 vanity sets", count(mansion, /addVanityCounterSet\(/g) >= 3, "both bathroom vanities need counter sets");
check("10 foyer consoles", /addFoyerConsoleDecor\(\);/.test(mainFurnishings) && /foyer-console-vase/.test(section("function addFoyerConsoleDecor()", "\n  function ")), "the foyer console tables are still bare");
const pipeBuilder = section("function addRearCorridorServicePipes()", "\n  function ");
check("10 rear corridor pipes", /addRearCorridorServicePipes\(\);/.test(basementFurnishings) && /rear-corridor-pipe-bracket/.test(pipeBuilder) && !/physics\.addFixedBox/.test(pipeBuilder), "the rear cross-corridor ceiling line is missing or blocks the chase lane");
check("10 rear terrace urns", /rear-terrace-planter-urn/.test(plantingBuilder) && /portico-entry-mat/.test(plantingBuilder), "the rear terrace urns or portico entry mat are missing (names must keep culling-safe prefixes)");
check("10 pool deck table", /pool-side-table-top/.test(section("function buildEstatePool()", "\n  function ")), "the pool deck lacks its lounger-side drinks table");

// 9. Cache-busting: the page key and the runtime version stay in sync and
// moved past the pre-ambient-details value. The exact key is deliberately not
// pinned so parallel milestones can bump it again without editing this suite.
const cacheKey = page.match(/mr-feast-mansion\.js\?v=([^"']+)/)?.[1] || "";
const runtimeVersion = mansion.match(/const MANSION_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
check("9 cache key bumped", cacheKey === runtimeVersion && Boolean(cacheKey) && cacheKey !== "20260718-feast-says-1", `page cache key (${cacheKey}) and runtime version (${runtimeVersion}) must move together past the pre-ambient-details value`);

if (failures.length) {
  console.error(`Mr. Feast ambient detail static acceptance failed (${failures.length}):`);
  for (const failure of failures) console.error(`  [${failure.requirement}] ${failure.detail}`);
  process.exitCode = 1;
} else {
  console.log("Mr. Feast ambient detail static acceptance passed: estate plantings, dining service, kitchen dressing, suite dressing, and room vignettes verified");
}
