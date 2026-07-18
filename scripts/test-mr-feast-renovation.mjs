import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const mansionPath = path.join(root, "assets/js/mr-feast-mansion.js");
const pagePath = path.join(root, "games/mr-feast-mansion.html");
const localLauncherPath = path.join(root, "Open Mr Feast Mansion.command");
const mrFeastAssetRoot = path.join(root, "assets/models/mr-feast");
const mrFeastManifestPath = path.join(mrFeastAssetRoot, "mr-feast-asset-manifest.json");
const mrFeastTuningReportPath = path.join(mrFeastAssetRoot, "animations/mr-feast-tuning-report.json");
const mrFeastTuningScriptPath = path.join(root, "scripts/tune-mr-feast-animations.mjs");
const mrFeastFacialReportPath = path.join(mrFeastAssetRoot, "processed/mr-feast-facial-report.json");
const mrFeastRetopologyReportPath = path.join(mrFeastAssetRoot, "processed/mr-feast-retopology-report.json");
const estateStatueManifestPath = path.join(mrFeastAssetRoot, "statues/manifest.json");
const mansion = fs.readFileSync(mansionPath, "utf8");
const page = fs.readFileSync(pagePath, "utf8");
const localLauncher = fs.existsSync(localLauncherPath) ? fs.readFileSync(localLauncherPath, "utf8") : "";
const mrFeastManifest = JSON.parse(fs.readFileSync(mrFeastManifestPath, "utf8"));
const mrFeastTuningReport = JSON.parse(fs.readFileSync(mrFeastTuningReportPath, "utf8"));
const mrFeastTuningScript = fs.readFileSync(mrFeastTuningScriptPath, "utf8");
const mrFeastFacialReport = JSON.parse(fs.readFileSync(mrFeastFacialReportPath, "utf8"));
const mrFeastRetopologyReport = fs.existsSync(mrFeastRetopologyReportPath)
  ? JSON.parse(fs.readFileSync(mrFeastRetopologyReportPath, "utf8"))
  : null;
const estateStatueManifest = JSON.parse(fs.readFileSync(estateStatueManifestPath, "utf8"));
const requiredMrFeastFacialTargets = [
  "blink_left",
  "blink_right",
  "brow_raise",
  "brow_compress",
  "smile",
  "smile_wide",
  "sneer_left",
  "sneer_right",
  "mouth_open",
  "jaw_shift",
];
const requiredMrFeastRetopologyObjects = [
  "MrFeast_RetopoFace",
  "MrFeast_Eyelid_L",
  "MrFeast_Eyelid_R",
  "MrFeast_Eye_L",
  "MrFeast_Eye_R",
  "MrFeast_OralCavity",
  "MrFeast_Teeth",
  "MrFeast_LipRim",
];

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

function sourceCalls(name, text = mansion) {
  const calls = [];
  const pattern = new RegExp(`\\b${name}\\(([^\\n;]*)\\);`, "g");
  for (const match of text.matchAll(pattern)) {
    calls.push({ raw: match[0], args: match[1].split(",").map((arg) => arg.trim()) });
  }
  return calls;
}

function numeric(expression) {
  const normalized = expression.replaceAll("Math.PI", String(Math.PI));
  if (!/^[\d.eE+\-*/()\s]+$/.test(normalized)) return Number.NaN;
  // The expression has been reduced to numeric literals and arithmetic only.
  return Function(`"use strict"; return (${normalized});`)();
}

function near(value, expected, epsilon = 0.06) {
  return Number.isFinite(value) && Math.abs(value - expected) <= epsilon;
}

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && offset + 8 < bytes.length) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return null;
}

function glbJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF" || bytes.readUInt32LE(4) !== 2) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.length) return null;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(chunkStart, chunkEnd).toString("utf8").replaceAll("\0", "").trim());
    }
    offset = chunkEnd;
  }
  return null;
}

function fixtureProfile(style) {
  const body = lightCircuitClass.match(new RegExp(`${style}:\\s*\\{([^}]+)\\}`))?.[1] || "";
  const value = (key) => Number(body.match(new RegExp(`${key}:\\s*([\\d.]+)`))?.[1]);
  return {
    intensity: value("intensity"),
    distance: value("distance"),
    angle: value("angle"),
    penumbra: value("penumbra"),
    radius: value("radius"),
    pointFillIntensity: value("pointFillIntensity"),
    pointFillDistance: value("pointFillDistance"),
    pointFillHeight: value("pointFillHeight"),
  };
}

function parsedCalls(name, text = mansion) {
  return sourceCalls(name, text).map((call) => ({
    ...call,
    values: call.args.map(numeric),
  }));
}

function methodCalls(owner, method, text = mansion) {
  const calls = [];
  const pattern = new RegExp(`\\b${owner}\\.${method}\\(([^\\n;]*)\\);`, "g");
  for (const match of text.matchAll(pattern)) {
    const args = match[1].split(",").map((arg) => arg.trim());
    calls.push({ raw: match[0], args, values: args.map(numeric) });
  }
  return calls;
}

function namedWallRun(name, text = mansion) {
  const marker = `name: "${name}"`;
  const nameIndex = text.indexOf(marker);
  if (nameIndex < 0) return "";
  const start = text.lastIndexOf("buildWallRun(", nameIndex);
  const next = text.indexOf("buildWallRun(", nameIndex + marker.length);
  if (start < 0) return "";
  return text.slice(start, next < 0 ? text.length : next);
}

const lightingMap = section("const ROOM_LIGHTING", "const PLAYER");
const roomZones = section("function registerRoomZones()", "function buildMansion()");
const mainPartitions = section("function buildMainPartitions()", "function buildUpperPartitions()");
const upperPartitions = section("function buildUpperPartitions()", "function buildBasementPartitions()");
const basementPartitions = section("function buildBasementPartitions()", "function furnishMainFloor()");
const upperFurnishings = section("function furnishUpperFloor()", "function furnishBasement()");
const mainFurnishings = section("function furnishMainFloor()", "function furnishUpperFloor()");
const ballroomFurnishings = section("// Ballroom", "// Kitchen", mainFurnishings);
const kitchenFurnishings = section("// Kitchen", "// Foyer and gallery detail", mainFurnishings);
const basementFurnishings = section("function furnishBasement()", "function buildLighting()");
const slabs = section("function buildSlabsAndCeilings()", "function buildExteriorWalls()");
const grandStairConfig = section("const GRAND_STAIR", "const YARD_LAYOUT");
const coatClosetConfig = section("const COAT_CLOSET", "const GRAND_STAIR");
const grandStair = section("function buildGrandStaircase()", "function buildRearUpperWalkwayGuard()");
const exteriorWalls = section("function buildExteriorWalls()", "function buildMainPartitions()");
const serviceStair = section("function buildServiceStaircase()", "function addRug(");
const rearGuard = section("function buildRearUpperWalkwayGuard()", "function buildServiceStaircase()");
const lightCircuitClass = section("class LightCircuit", "function wallSegment(");
const fixtureBuilder = section("addFixture(x, z, style", "// The response glows below", lightCircuitClass);
const signatureChandelierBuilders = section("function addFoyerGrandChandelier", "function wallSegment(");
const wallSegmentBuilder = section("function wallSegment(", "function addWindow(");
const wallTrimSpanBuilder = section("function wallTrimSpans(", "function addContinuousWallTrim(");
const wallRunBuilder = section("function buildWallRun(", "function floorSlab(");
const cabinetClass = section("class Cabinet", "function addLocalInstanceBatch(");
const hidingSpotClass = section("class HidingSpot", "function addLocalInstanceBatch(");
const coatClosetFurnishings = section("function addHangingCoat(", "function addTowelRail(");
const stockedStorageBuilder = section("function addStockedStorageContents", "class Refrigerator");
const toiletClass = section("class FlushableToilet", "function addToilet");
const vanityBuilder = section("function addDoubleVanityBase", "function addWalkInShower");
const fireplaceClass = section("class Fireplace", "function addFireplace");
const updateLocation = section("function updateLocation()", "function findInteraction()");
const interactionLookup = section("function findInteraction()", "function inspectInteractionRay()");
const contextLighting = section("function getContextLightingTargets(", "function selectBudgetedCircuitLights(");
const budgetedLightSelection = section("function selectBudgetedCircuitLights(", "function syncLightRendering(");
const lightRendering = section("function syncLightRendering(", "function updatePlayer(");
const mobileShaderPadding = section("function ensureMobileShaderPadding()", "function updatePlayer(");
const lightingBuild = section("function buildLighting()", "function registerRoomZones()");
const serviceStairLighting = section('const serviceStair = new LightCircuit("service stair lights"', "const basementHall", lightingBuild);
const yardLayout = section("const YARD_LAYOUT", "const HEDGE_MAZE_LAYOUT");
const mazeLayout = section("const HEDGE_MAZE_LAYOUT", "const QA_ROOM_VIEWS");
const qaRoomViews = section("const QA_ROOM_VIEWS", "const state");
const yardBuild = section("function buildEstateYard()", "function buildExteriorScene()");
const exteriorBuild = section("function buildExteriorScene()", "function buildMansion()");
const diagnostics = section("function getDiagnostics()", "function teleport(");
const qaHooks = section("function installDiagnostics()", "async function init()");
const initSequence = section("async function init()", "if (dom.enter) dom.enter.addEventListener");
const physicsClass = section("class PhysicsWorld", "window.MrFeastFresh");
const playerUpdate = section("function updatePlayer", "function syncCamera");
const animationLoop = section("function getTargetFrameInterval()", "function getDiagnostics(");
const exteriorCulling = section("function registerExteriorDetailCulling()", "function setMoveIntent(");
const stormSystem = section("class StormSystem", "class MansionAudio");
const resizeSystem = section("function resize()", "function requestPointerLock()");
const portraitManifest = section("const PORTRAIT_ARTWORKS", "const PLAYER");
const playerConfig = section("const PLAYER", "const MR_FEAST_LEVEL");
const portraitBuilder = section("function loadArtworkTexture", "function addBeamBetween");
const exoticRugTextureBuilder = section("function makeExoticRugTexture", "function loadTexture");
const foyerRugTextureBuilder = section("function makeFoyerRugTexture", "function loadTexture");
const salonRugTextureBuilder = section("function makeSalonRugTexture", "function loadTexture");
const fireTextureBuilder = section("function makeFireFlameTexture", "function makeExoticRugTexture");
const materialFactory = section("async function createMaterials()", "class PhysicsWorld");
const portraitFurnishings = `${mainFurnishings}\n${upperFurnishings}`;
const mainGalleryPortraits = section("// Foyer and gallery detail", null, mainFurnishings);
const upperGalleryPortraits = upperFurnishings;
const musicRoomFurnishings = section("// Music room", "// Painting room", mainFurnishings);
const paintingRoomFurnishings = section("// Painting room", "// Dining room", mainFurnishings);
const paintingStudioBuilder = section("function addPaintingStudio(", "function addKitchenRange(");
const bookshelfBuilder = section("function addBookshelf(", "function addArchiveCurio(");
const boxBuilder = section("function box(", "function cylinder(");
const tableBuilder = section("function addTable(", "function addChair(");
const sofaBuilder = section("function addSofa(", "function faceTargetYaw(");
const foyerPanelwork = section("function addFoyerPanelwork()", "function buildSlabsAndCeilings()");
const localBootstrap = section("const LOCAL_SERVER_URL", "const FLOOR");
const mainEastFrontSpine = namedWallRun("main-east-front-spine", mainPartitions);
const serviceShaftWall = namedWallRun("main-service-shaft-wall", mainPartitions);
const kitchenServiceStairWall = namedWallRun("main-kitchen-service-stair-wall", mainPartitions);
const pantryFurnishings = section("// Pantry storage", "addBoiler", basementFurnishings);
const kitchenBallroomPartialWall = namedWallRun("main-kitchen-ballroom-partial-wall", mainPartitions);
const mainRearWall = namedWallRun("main-rear-wall", exteriorWalls);
const mainWestExteriorWall = namedWallRun("main-west-wall", exteriorWalls);
const mainEastWall = namedWallRun("main-east-wall", exteriorWalls);
const kitchenRangeBuilder = section("function addKitchenRange(", "function addKitchenBaseCabinet(");
const kitchenBuilder = section("function addKitchenBaseCabinet(", "function addWineRack(");
const kitchenLighting = section('const kitchen = new LightCircuit("kitchen lights"', "const coatCloset", lightingBuild);
const primaryFrontWall = namedWallRun("upper-primary-front-wall", upperPartitions);
const eastRearFrontWall = namedWallRun("upper-east-rear-front-wall", upperPartitions);
const westRearSpine = namedWallRun("upper-west-rear-spine", upperPartitions);
const eastRearSpine = namedWallRun("upper-east-rear-spine", upperPartitions);
const cabinetSetOpen = section("setOpen(open, silent)", "makeDoor(", cabinetClass);
const hingedDoorClass = section("class HingedDoor", "class LightCircuit");
const contestant13Config = section("const CONTESTANT_13", "const GRAND_STAIR");
const contestant13Quest = section("class ContestantThirteenQuest", "function kitchenShelfHeights");
const readableBookSystem = section("class ReadableBookSystem", "function kitchenShelfHeights");
const contestant13Build = section("function buildContestantThirteenQuest", "function buildLighting()");
const contestant13BookBuild = section("function createContestantThirteenScratchTexture", "function addContestantThirteenGardenShovel");
const contestant13ShovelBuild = section("function addContestantThirteenGardenShovel", "function addContestantThirteenDigSite");
const contestant13DigSiteBuild = section("function addContestantThirteenDigSite", "function addContestantThirteenArchiveCage");
const mrFeastPatrolRoute = section("const MR_FEAST_PATROL_ROUTE", "const MR_FEAST_NPC");
const mrFeastNpcConfig = section("const MR_FEAST_NPC", "const TOILET_FLUSH_DURATION");
const mrFeastWanderer = section("class MrFeastWanderer", "window.MrFeastFresh");
const cameraSecurityConfig = section("const CAMERA_SECURITY_MODE", "const MR_FEAST_LEVEL");
const cameraSecuritySystem = section("class CameraSecuritySystem", "class WorkroomMonitorWallSystem");
const workroomMonitorWallSystem = section("class WorkroomMonitorWallSystem", "function kitchenShelfHeights");
const patronFeedSecurityHandler = section("handlePatronFeedSabotage()", "beginIllegalAction(id)", cameraSecuritySystem);

// 29. Crown trim remains continuous over the entire authored wall run, while
// baseboards continue below windows but stop at doors, arches, and open
// walkways so every traversable threshold stays visually and physically clear.
let wallTrimSpanProbe = null;
try {
  const spansFor = new Function(`${wallTrimSpanBuilder}\nreturn wallTrimSpans;`)();
  wallTrimSpanProbe = {
    windowOnly: spansFor(-10, 10, [{ kind: "window", center: 0, width: 6 }]),
    passages: spansFor(-10, 10, [
      { kind: "window", center: -7, width: 2 },
      { kind: "door", center: -3, width: 2 },
      { kind: "arch", center: 2, width: 2 },
      { kind: "open", center: 7, width: 2 },
    ]),
  };
} catch (_) {
  wallTrimSpanProbe = null;
}
check("29 threshold-safe wall trim", /function wallTrimSpans\(/.test(wallSegmentBuilder), "missing passage-aware baseboard span helper");
check("29 threshold-safe wall trim", JSON.stringify(wallTrimSpanProbe?.windowOnly) === JSON.stringify([[-10, 10]]), "windows must not interrupt the baseboard");
check("29 threshold-safe wall trim", JSON.stringify(wallTrimSpanProbe?.passages) === JSON.stringify([[-10, -4], [-2, 1], [3, 6], [8, 10]]), "doors, arches, and open walkways must cut the baseboard span");
check("29 threshold-safe wall trim", !/baseboard|crown/.test(section("function wallSegment(", "function wallTrimSpans(")), "solid wall fragments still own trim instead of the authored wall run");
check("29 threshold-safe wall trim", /wallTrimSpans\(start, end, openings\)/.test(wallSegmentBuilder), "baseboards do not use the passage-aware spans");
check("29 threshold-safe wall trim", /addContinuousWallTrim\(axis, fixed, start, end, floorY, height, material, openings, name\);/.test(wallRunBuilder), "buildWallRun does not pass its openings to the trim builder");
check("29 threshold-safe wall trim", wallRunBuilder.indexOf("addContinuousWallTrim(") >= 0 && wallRunBuilder.indexOf("addContinuousWallTrim(") < wallRunBuilder.indexOf("const sorted = openings"), "trim must be authored before openings split the wall geometry");
check("29 threshold-safe wall trim", /addWallTrimSpan\([^;]+start, end,[^;]+crown/s.test(wallSegmentBuilder), "crown trim no longer spans the full authored wall run");

const foyerLowerRail = Number(foyerPanelwork.match(/const lowerRailY\s*=\s*FLOOR\.MAIN\s*\+\s*([\d.]+)/)?.[1]);
const foyerUpperRail = Number(foyerPanelwork.match(/const upperRailY\s*=\s*FLOOR\.MAIN\s*\+\s*([\d.]+)/)?.[1]);
check("30 aligned foyer panelwork", foyerLowerRail >= 0.28 && foyerLowerRail <= 0.45, "foyer panelwork lower rail must sit clearly above the baseboard");
check("30 aligned foyer panelwork", foyerUpperRail >= 1.42 && foyerUpperRail <= 1.65, "foyer panelwork upper rail is outside the intended lower-wall datum");
check("30 aligned foyer panelwork", foyerUpperRail - foyerLowerRail >= 1.0, "foyer panel frames are vertically cramped after raising the lower rail");
check("30 aligned foyer panelwork", /const panelCenterY\s*=\s*\(lowerRailY \+ upperRailY\) \/ 2/.test(foyerPanelwork) && /const panelHeight\s*=\s*upperRailY - lowerRailY/.test(foyerPanelwork), "foyer panel frame center and height are not derived from shared rail datums");
check("30 aligned foyer panelwork", /h:\s*panelHeight[^;]+y:\s*panelCenterY/.test(foyerPanelwork) && /for \(const y of \[lowerRailY, upperRailY\]\)/.test(foyerPanelwork), "foyer vertical and horizontal trim pieces do not align to the same frame edges");

// 1. The rear upper-floor opening needs a complete visual guard and matching
// invisible collision, kept in a dedicated helper so both parts stay aligned.
check("1 rear upper walkway railing", rearGuard.length > 0, "missing buildRearUpperWalkwayGuard() helper");
check(
  "1 rear upper walkway railing",
  ["upper-rear-landing-guard", "upper-rear-west-guard", "upper-rear-east-guard"].every((name) => rearGuard.includes(name)),
  "rear landing and both side guard runs must have stable scene names",
);
check("1 rear upper walkway railing", /addBalusterInstanceBatch\(/.test(rearGuard) && count(rearGuard, /guard-rail/g) >= 3, "rear walkway needs one instanced baluster batch and three connected top rails");
check("1 rear upper walkway railing", count(rearGuard, /physics\.addFixedBox\(/g) >= 3, "each rear railing run needs a matching physics guard");
check("1 rear upper walkway railing", /\bbuildRearUpperWalkwayGuard\(\);/.test(mansion), "rear walkway guard helper is not invoked during mansion construction");

// 2 and 6. Both converted rooms must be full bathrooms and every water source
// must be explicitly interactive (never proximity-activated).
check("2 upper grand bathroom", lightingMap.includes('"UPPER GRAND BATHROOM"'), "UPPER GRAND BATHROOM is missing from ROOM_LIGHTING");
check("2 upper grand bathroom", roomZones.includes('"UPPER GRAND BATHROOM"'), "Portrait Lounge room zone was not converted to UPPER GRAND BATHROOM");
check("2 upper grand bathroom", !roomZones.includes('"PORTRAIT LOUNGE"') && !lightingMap.includes('"PORTRAIT LOUNGE"'), "legacy PORTRAIT LOUNGE mapping still exists");
check("2 upper grand bathroom", !upperPartitions.includes('name: "upper-bath-east-wall"') && !upperPartitions.includes('name: "upper-bath-north-wall"'), "old upper-bath divider walls still split the large bathroom");
check("6 main hall bathroom", lightingMap.includes('"MAIN HALL BATHROOM"'), "MAIN HALL BATHROOM is missing from ROOM_LIGHTING");
check("6 main hall bathroom", roomZones.includes('"MAIN HALL BATHROOM"'), "Study room zone was not converted to MAIN HALL BATHROOM");
check("6 main hall bathroom", !roomZones.includes('"STUDY"') && !lightingMap.includes('"STUDY"'), "legacy STUDY mapping still exists");
check("6 main hall bathroom naming", !/label:\s*"[^"]*study/i.test(mainPartitions), "converted bathroom still exposes a study door prompt");
check("6 main hall bathroom naming", !/\bstudy\b/i.test(section('<dl class="mansion-floors">', "</dl>", page)), "floor description still advertises the removed study");
check("2/6 bathroom fixtures", mansion.includes("function furnishMainHallBathroom(") && mansion.includes("function furnishUpperGrandBathroom("), "dedicated furnishing functions are required for both full bathrooms");
const mainBath = section("function furnishMainHallBathroom(", "function furnishUpperGrandBathroom(");
const upperBath = section("function furnishUpperGrandBathroom(", "function addBookshelf(");
for (const [label, text] of [["main hall", mainBath], ["upper grand", upperBath]]) {
  check(`2/6 ${label} bathroom fixtures`, /addToilet\(/.test(text), `${label} bathroom has no toilet`);
  check(`2/6 ${label} bathroom fixtures`, /addBathtub\(/.test(text), `${label} bathroom has no bathtub`);
  check(`2/6 ${label} bathroom plumbing`, /new WaterFixture\(/.test(text), `${label} bathroom has no interactive water fixture`);
}
check("2/6 working water", mansion.includes("class WaterFixture"), "interactive WaterFixture class is missing");
const waterClass = section("class WaterFixture", "class LightCircuit");
check("2/6 working water", /addInteractionTarget\(/.test(waterClass) && /Turn on|Turn off/.test(waterClass), "water must change only through an explicit interaction target");
check("2/6 working water", /water-stream|waterStream|streamMesh/.test(waterClass), "WaterFixture has no visible running-water stream");
check("2/6 working water", /setWater\(/.test(mansion), "MansionAudio has no continuous water-audio control");

// The dining-room washroom is now a full room-sized coat closet. It must read
// as stocked storage, retain a clear aisle, and provide a real hide/exit state
// that future pursuer AI can consume through render_game_to_text().
check("coat closet naming", lightingMap.includes('"COAT CLOSET": ["coat closet lights"]'), "COAT CLOSET is missing from ROOM_LIGHTING");
check("coat closet naming", roomZones.includes('"COAT CLOSET"'), "dining-side room zone was not renamed COAT CLOSET");
check("coat closet naming", !/POWDER ROOM|powder-room|powder room/i.test(`${mansion}\n${page}`), "legacy powder-room naming or fixtures remain");
check("coat closet bounds", /minX:\s*-15[^}]*maxX:\s*-11\.5[^}]*minZ:\s*-3\.2[^}]*maxZ:\s*1\.6/s.test(coatClosetConfig), "coat closet no longer retains the large 3.5m by 4.8m authored footprint");
check("coat closet dining door", /center:\s*-13\.2,\s*width:\s*1\.05,\s*label:\s*"coat closet door",\s*direction:\s*1/.test(mainPartitions), "dining-side coat closet door is missing or swings into the closet aisle");
check("coat closet solid exterior", /mainWindows\(\[-9\.4,\s*-6\.7,\s*6\.4,\s*9\.4\]\)/.test(mainWestExteriorWall), "old bathroom window remains open behind the hanging coats");
check("coat closet page copy", /furnished coat closet with a hiding place/i.test(page) && /Coat closet<small>Hide<\/small>/i.test(page), "page does not advertise the furnished hiding closet");
check("coat closet furnishing hook", /function furnishCoatCloset\(\)/.test(mansion) && /\bfurnishCoatCloset\(\);/.test(mansion), "dedicated coat closet furnishing function is missing or not invoked");
check("coat closet plumbing removal", !/WaterFixture|addToilet|addBathroomTilework|vanity|basin|faucet|towel/i.test(coatClosetFurnishings), "bathroom plumbing remains in the coat closet furnishing pass");
for (const [feature, pattern] of [
  ["rails", /coat-closet-hanging-rail/],
  ["hangers", /hanger-shoulder|hanger-crossbar/],
  ["coats", /hanging-garment/],
  ["shelves", /coat-closet-(?:upper|shoe|north-storage)-shelf/],
  ["hat boxes", /coat-closet-hat-box/],
  ["shoes", /coat-closet-shoe/],
  ["luggage", /coat-closet-luggage/],
  ["umbrellas", /coat-closet-umbrella/],
  ["bench", /coat-closet-dressing-bench/],
]) check(`coat closet ${feature}`, pattern.test(coatClosetFurnishings), `coat closet is missing visible ${feature}`);
check("coat closet stocked density", /westCoatPositions\s*=\s*Array\.from\(\{\s*length:\s*16\s*\}/.test(coatClosetFurnishings) && /eastCoatPositions\s*=\s*Array\.from\(\{\s*length:\s*15\s*\}/.test(coatClosetFurnishings), "closet does not densely populate both hanging banks with at least thirty-one garments");
check("coat closet garment orientation", /perpendicular-hanger-group/.test(coatClosetFurnishings) && /coat\.rotation\.y\s*=\s*angle/.test(coatClosetFurnishings) && /w:\s*0\.54,\s*h:\s*length,\s*d:\s*0\.055/.test(coatClosetFurnishings), "hanging clothes are not broadside-perpendicular to the north/south closet rods");
check("coat closet realistic fabric depth", /w:\s*0\.54,\s*h:\s*length,\s*d:\s*0\.055/.test(coatClosetFurnishings) && /w:\s*0\.15,\s*h:\s*length \* 0\.72,\s*d:\s*0\.05/.test(coatClosetFurnishings) && /hanging-garment-bag[^\n]*d:\s*0\.05/.test(coatClosetFurnishings), "coat bodies, sleeves, or garment bag have become implausibly thick again");
check("coat closet garment angle", /const hangingAngles\s*=\s*\[-0\.11,\s*-0\.055,\s*0\.035,\s*0\.09,\s*-0\.075,\s*0\.055,\s*0\.115,\s*-0\.025\]/.test(coatClosetFurnishings), "hanging clothes lost their subtle varied yaw angles");
check("coat closet clear aisle", /const clearAisle\s*=\s*\{\s*minX:\s*-13\.72,\s*maxX:\s*-12\.68,\s*minZ:\s*-2\.82,\s*maxZ:\s*0\.62\s*\}/.test(coatClosetFurnishings), "player-sized center aisle is no longer explicitly preserved");
check("coat closet hiding spot", /new HidingSpot\(\{[\s\S]*?name:\s*"coat closet"[\s\S]*?targets:\s*\[westCoats\[8\],\s*westCoats\[9\],\s*westCoats\[10\],\s*westCoats\[11\],\s*garmentBag\]/.test(coatClosetFurnishings), "hiding interaction is not attached to visible hanging garments");
check("functional hiding state", /state\.isHidden\s*=\s*true/.test(hidingSpotClass) && /state\.isHidden\s*=\s*false/.test(hidingSpotClass), "entering and leaving do not set a stable hidden gameplay state");
check("functional hiding exit", /getLabel:[^\n]*Leave/.test(hidingSpotClass) && /activate:[^\n]*this\.exit/.test(hidingSpotClass), "second keyboard or touch interaction cannot always leave the hiding spot");
check("hidden movement lock", /if \(state\.isHidden\)[\s\S]*?physics\.movePlayer\(0, 0\);[\s\S]*?return;/.test(playerUpdate), "movement can carry the player away while hidden");
check("hidden interaction lock", /if \(state\.activeHideSpot\) return state\.activeHideSpot\.interaction;/.test(interactionLookup), "prompt refresh can lose the leave-hiding interaction");
check("hidden HUD", /id="mansion-hidden"[^>]*hidden/.test(page) && /#mansion-stage\.is-hiding::after/.test(page) && /dom\.hiddenStatus\.hidden\s*=\s*(?:false|true)/.test(hidingSpotClass), "hiding state lacks persistent player feedback");
check("hidden diagnostics", /hiding:\s*\{[\s\S]*?active:\s*state\.isHidden[\s\S]*?spot:\s*state\.activeHideSpot[\s\S]*?movementLocked:\s*state\.isHidden/.test(diagnostics) && /isPlayerHidden/.test(qaHooks), "render_game_to_text does not expose the hiding contract for future AI");
check("coat closet QA views", ["coatClosetDoor", "coatClosetA", "coatClosetB", "coatClosetHide"].every((name) => qaRoomViews.includes(`${name}:`)), "coat closet lacks doorway, interior, and hide-interaction QA views");
check("coat closet physical route", /coatClosetDoorEntry:[\s\S]*?start:\s*"coatClosetDoor"[\s\S]*?openDoors:\s*true[\s\S]*?room:\s*"COAT CLOSET"[\s\S]*?visitedRooms:\s*\["DINING ROOM",\s*"COAT CLOSET"\]/.test(qaHooks), "dining-to-closet traversal is not covered by a physical QA route");

check("35 flushable toilets", toiletClass.length > 0 && /type:\s*"toilet"/.test(toiletClass) && /Flush \$\{name\}/.test(toiletClass), "toilets do not expose an explicit flush interaction");
check("35 flushable toilets", /toilets\.push\(this\)/.test(toiletClass) && /animatedObjects\.push\(this\)/.test(toiletClass) && /if \(this\.flushing\) return false/.test(toiletClass), "toilet state is not registered or repeat flushing is unguarded");
check("35 flush animation", /bowl-water/.test(toiletClass) && /flush-swirl/.test(toiletClass) && /this\.flushTime \/ this\.flushDuration/.test(toiletClass) && /lerp\(1, 0\.22/.test(toiletClass), "toilet water does not visibly drain, swirl, and refill over a finite cycle");
check("35 flush animation", /flush-handle-mount/.test(toiletClass) && /flush-handle-knob/.test(toiletClass) && /x:\s*-0\.205/.test(toiletClass) && /handlePivot\.rotation\.z/.test(toiletClass) && /audioSystem\.toiletFlush/.test(toiletClass) && /TOILET_FLUSH_DURATION\s*=\s*2\.7/.test(mansion), "toilet flush lacks a visibly offset lever, finite timing, or its flush sound hook");
const toiletSeatY = Number(toiletClass.match(/seat\.position\.set\(0,\s*([\d.]+)/)?.[1]);
const toiletWaterY = Number(toiletClass.match(/this\.waterFullY\s*=\s*([\d.]+)/)?.[1]);
const toiletSwirlY = Number(toiletClass.match(/this\.swirl\.position\.set\(0,\s*([\d.]+)/)?.[1]);
check("40 recognizable hollow toilets", /toiletBowlShell/.test(toiletClass) && /new THREE\.LatheGeometry/.test(toiletClass) && /hollow-porcelain-bowl/.test(toiletClass) && /bowl-drain/.test(toiletClass), "toilet bowl is still a sealed sphere instead of a hollow shared shell");
check("40 recessed toilet water", Number.isFinite(toiletSeatY) && Number.isFinite(toiletWaterY) && Number.isFinite(toiletSwirlY) && toiletSeatY - toiletWaterY >= 0.1 && toiletSwirlY > toiletWaterY && toiletSwirlY < toiletSeatY && /blending:\s*THREE\.AdditiveBlending/.test(toiletClass), "toilet water and swirl are not visibly recessed below the seat");
check("35 flush handle placement", /handlePivot\.position\.set\(0\.2,\s*0\.77,\s*0\.15\)/.test(toiletClass) && /x:\s*0\.2,\s*y:\s*0\.77,\s*z:\s*0\.15/.test(toiletClass), "toilet handle or its interaction hitbox is not mounted on the room-facing cistern surface");
check("35 flushable toilets", count(mansion, /addToilet\("(?:main hall bathroom toilet|upper grand bathroom toilet)"/g) === 2, "both remaining bathrooms must use uniquely named flushable toilets");
for (const view of ["mainHallToiletInteract", "upperGrandToiletInteract"]) {
  check("35 toilet QA views", qaRoomViews.includes(`${view}:`), `missing interaction view ${view}`);
}
check("35 toilet diagnostics", /toiletsTotal:\s*toilets\.length/.test(diagnostics) && /flushCount:\s*toilet\.flushCount/.test(diagnostics) && /MrFeastFresh\.flushToilet/.test(qaHooks), "flush state is not observable and controllable through QA diagnostics");

// 3. Validate the geometry relationship, not merely a comment: the east-front
// desk is close to the west wall, with its chair east of it and facing west.
const upperTables = parsedCalls("addTable", upperFurnishings).filter((call) => call.args[4] === "FLOOR.UPPER");
const eastDesk = upperTables.find((call) => call.values[0] > 5 && call.values[0] < 7.5 && call.values[1] > 8 && call.values[1] < 11);
const upperChairs = parsedCalls("addChair", upperFurnishings).filter((call) => call.args[2] === "FLOOR.UPPER");
const eastDeskChair = eastDesk && upperChairs.find((call) => call.values[0] > 5 && call.values[0] < 8 && call.values[1] > 8 && call.values[1] < 11);
check("3 east-front desk placement", eastDesk && eastDesk.values[0] <= 6.1, "east-front desk is not set against the west wall");
check(
  "3 east-front chair orientation",
  eastDesk && eastDeskChair
    && eastDeskChair.values[0] > eastDesk.values[0] + 0.35
    && Math.abs(eastDeskChair.values[1] - eastDesk.values[1]) <= 0.3
    && near(eastDeskChair.values[3], Math.PI / 2),
  "east-front chair must sit east of the desk, share its z position, and face west",
);

// 4 and 5. Sofas use local -z as their facing direction.
const readingSofa = parsedCalls("addSofa", upperFurnishings).find((call) => call.args[2] === "FLOOR.UPPER" && call.values[0] > 5 && Math.abs(call.values[1]) < 3.2);
check("4 reading-room sofa", readingSofa && near(readingSofa.values[3], -Math.PI / 2), "reading-room sofa does not face the east-wall bookshelves");
const librarySofa = parsedCalls("addSofa", mainFurnishings).find((call) => call.args[2] === "FLOOR.MAIN" && call.values[0] < -5 && call.values[1] > 3.2);
check("5 library sofa", librarySofa && near(Math.abs(librarySofa.values[3]), Math.PI), "library sofa does not face the front windows at z=12");

// 7. The ballroom has a named thin marble insert using the existing generated
// antique-marble texture and no lounge seating or green rug remains.
check("7 ballroom seating", !/addSofa\(/.test(ballroomFurnishings), "ballroom couches were not removed");
check("7 ballroom marble", /name:\s*["']ballroom-(?:ai-)?marble-floor["'][^;]*material:\s*M\.marble/s.test(slabs), "named ballroom AI-marble floor insert is missing");
check("7 ballroom marble", !/addRug\(\s*0\s*,\s*-8\.2[^;]*M\.greenRug/.test(slabs), "legacy green ballroom rug still exists");
check("7 ballroom marble", mansion.includes('textureUrl("antique-marble-ai.jpg")'), "ballroom marble must retain the generated antique-marble texture source");

// 8. Every dining chair faces the table center.
const diningChairs = parsedCalls("addChair", section("// Dining room", "// Ballroom", mainFurnishings));
check("dining room wall clearance", !/addWallPortrait|artId:\s*"feast-of-merit"/.test(section("// Dining room", "// Ballroom", mainFurnishings)), "the dining-room portrait still overlaps the window composition");
const diningAt = (x, z) => diningChairs.find((call) => near(call.values[0], x, 0.08) && near(call.values[1], z, 0.08));
for (const x of [-12, -10.45, -8.95, -7.4]) {
  check("8 dining-chair orientation", near(diningAt(x, -7.25)?.values[3], 0), `north dining chair at x=${x} must face south toward the table`);
  check("8 dining-chair orientation", near(Math.abs(diningAt(x, -9.55)?.values[3]), Math.PI), `south dining chair at x=${x} must face north toward the table`);
}
check("8 dining-chair orientation", near(diningAt(-12.7, -8.4)?.values[3], -Math.PI / 2), "west head chair must face east toward the table");
check("8 dining-chair orientation", near(diningAt(-6.7, -8.4)?.values[3], Math.PI / 2), "east head chair must face west toward the table");

// 9. Rear dining/ballroom/kitchen hinged doors stay gone. The kitchen now has
// a short rear-anchored partition shielding the pantry, but it ends far enough
// forward to preserve a generous uncased opening into the ballroom.
for (const label of ["dining room door", "kitchen door", "dining gallery door", "ballroom gallery door", "kitchen gallery door"]) {
  check("9 open-concept rear", !mainPartitions.includes(`label: "${label}"`), `interior ${label} still exists`);
}
check("9 open-concept rear", /axis:\s*"z",\s*fixed:\s*-5,\s*start:\s*-4\.9,\s*end:\s*12[^;]*name:\s*"main-west-(?:front-)?spine"/s.test(mainPartitions), "west spine still divides the dining room from the ballroom");
check("9 open-concept rear", /axis:\s*"z",\s*fixed:\s*5,\s*start:\s*-4\.9,\s*end:\s*12[^;]*name:\s*"main-east-(?:front-)?spine"/s.test(mainPartitions), "east spine still divides the kitchen from the ballroom");
check("9 kitchen-ballroom partial wall", kitchenBallroomPartialWall.length > 0, "missing short partition between the kitchen pantry and ballroom");
check("9 kitchen-ballroom partial wall", /axis:\s*"z",\s*fixed:\s*5,\s*start:\s*-12,\s*end:\s*-8\.2/.test(kitchenBallroomPartialWall), "kitchen partition must run from the rear wall to five feet past the pantry");
check("9 kitchen-ballroom partial wall", /openings:\s*\[\s*\]/s.test(kitchenBallroomPartialWall) && !/kind:\s*"(?:door|arch|open)"/.test(kitchenBallroomPartialWall), "kitchen-ballroom partition must end freely without a door or framed opening");
const kitchenPartitionEnd = Number(kitchenBallroomPartialWall.match(/end:\s*(-?[\d.]+)/)?.[1]);
const kitchenBallroomOpeningWidth = -4.9 - kitchenPartitionEnd;
const innerCounterEnd = Number(kitchenBuilder.match(/innerCounterEnd:\s*(-?[\d.]+)/)?.[1]);
const partitionPastCabinet = kitchenPartitionEnd - innerCounterEnd;
check("9 kitchen-ballroom partial wall", kitchenBallroomOpeningWidth >= 3.0, "kitchen-ballroom opening is narrower than three metres");
check("9 kitchen-ballroom partial wall", partitionPastCabinet >= 1.2 && partitionPastCabinet <= 1.8, "partition does not extend a few feet past the inner counter cabinets");
check("9 open-concept rear", /name:\s*"main-stair-gallery"[^;]*kind:\s*"arch"/s.test(mainPartitions), "grand stair does not retain an open arch directly toward the ballroom");

// 10. The remodeled kitchen is one aligned U-shaped system: integrated base
// cabinets, real appliances, a working sink, counter-height windows, and two
// visible pendants backed by one shader-budget-neutral room light.
check("10 kitchen remodel", /\baddRemodeledKitchen\(\);/.test(kitchenFurnishings), "main-floor furnishings do not invoke the dedicated kitchen remodel");
check("10 kitchen remodel", !/addTable\(|addChair\(/.test(kitchenFurnishings), "the old oversized kitchen table or chairs still occupy the work aisle");
for (const name of ["kitchen-countertop-inner", "kitchen-countertop-rear", "kitchen-countertop-east"]) {
  check("10 kitchen countertops", kitchenBuilder.includes(name), `missing aligned countertop run ${name}`);
}
check("10 kitchen base cabinets", /const cabinetHeight\s*=\s*0\.88/.test(kitchenBuilder) && count(kitchenBuilder, /addKitchenBaseCabinet\(\{/g) >= 7, "counter runs do not share at least seven integrated 0.88m base cabinets");
check("10 kitchen base cabinets", /function kitchenShelfHeights\(/.test(cabinetClass) && /height\s*<\s*1\.2/.test(cabinetClass), "short base cabinets still collapse multiple shelves onto one height");
check("10 kitchen base cabinets", /openAngle:\s*88/.test(kitchenBuilder) && /this\.openAngle\s*=\s*openAngle/.test(cabinetClass), "base-cabinet leaves do not use the intersection-safe opening angle");
check("10 kitchen refrigerator", mansion.includes("class Refrigerator"), "interactive Refrigerator class is missing");
check("10 kitchen refrigerator", count(kitchenBuilder, /new Refrigerator\s*\(/g) === 1, "kitchen must contain exactly one integrated refrigerator");
check("10 kitchen oven", count(kitchenBuilder, /addKitchenRange\s*\(/g) === 1 && /kitchen-oven-door/.test(kitchenRangeBuilder), "kitchen lacks one recognizable oven/range");
check("10 kitchen sink", /kitchen-sink-basin/.test(kitchenBuilder) && /kitchen-sink-faucet-(?:deck-collar|riser|spout)/.test(kitchenBuilder), "kitchen sink basin and connected faucet are incomplete");
check("10 kitchen sink", /new WaterFixture\(\{\s*name:\s*"kitchen sink",\s*kind:\s*"sink"/s.test(kitchenBuilder), "kitchen sink is not connected to the water interaction system");
check("10 stocked kitchen", /stock(?:Type|Kind):\s*["']food["']/.test(kitchenBuilder), "kitchen has no stocked food base cabinet");
check("10 stocked kitchen", /stock(?:Type|Kind):\s*["']dishes["']/.test(kitchenBuilder), "kitchen has no stocked dish base cabinet");
check("10 stocked kitchen", /addStocked(?:Storage)?Contents|addStorageStock/.test(mansion), "shared stocked-storage builder is missing");
check("10 stocked kitchen", /foodItems/.test(mansion) && /dishItems/.test(mansion) && /refrigerators/.test(mansion), "stock and refrigerator counts are absent from diagnostics");
check("10 kitchen lighting", /addKitchenLightingFixtures\(kitchen\)/.test(kitchenLighting) && !/kitchen\.addFixture\(/.test(kitchenLighting), "kitchen circuit does not use the budget-safe paired pendant builder");
check("10 kitchen lighting", /\[7\.9,\s*12\.1\]/.test(kitchenBuilder) && /kitchen-pendant-\$\{index \+ 1\}-bulb/.test(kitchenBuilder) && count(kitchenBuilder, /addRoomOmniLight\(/g) === 1, "two visible pendants must share exactly one bounded real light");
check("10 kitchen lighting", /fixtureRole\s*=\s*"primary"/.test(kitchenBuilder) && /visibleFixtureEmitter\s*=\s*true/.test(kitchenBuilder), "shared kitchen emitter is not retained as the circuit's primary visible source");
const kitchenWindowProfile = exteriorWalls.match(/const kitchenWindows\s*=\s*\(centers\)[^\n]*bottom:\s*([\d.]+),\s*top:\s*([\d.]+)/);
const kitchenWindowBottom = Number(kitchenWindowProfile?.[1]);
const kitchenWindowTop = Number(kitchenWindowProfile?.[2]);
check("10 kitchen windows", kitchenWindowBottom >= 1.18 && kitchenWindowTop - kitchenWindowBottom <= 1.65, "kitchen windows are not short counter-height openings");
check("10 kitchen windows", /kitchenWindows\(\[6\.4,\s*9\.4,\s*12\.4\]\)/.test(mainRearWall), "rear kitchen wall lacks three aligned counter windows including the former door bay");
check("10 kitchen windows", /kitchenWindows\(\[-9\.4,\s*-6\.7\]\)/.test(mainEastWall), "east kitchen wall lacks two aligned counter windows");
check("10 sealed kitchen exterior", !mainRearWall.includes("kitchen service door") && !mansion.includes("kitchen-service-threshold"), "retired kitchen exterior door or threshold still exists");
for (const retired of ["yardServiceDoorInside", "yardServiceReentry", "serviceDoorOut:", "serviceDoorRoundTrip:"]) {
  check("10 sealed kitchen exterior", !qaHooks.includes(retired) && !qaRoomViews.includes(retired), `retired kitchen exterior QA target remains: ${retired}`);
}
for (const view of ["kitchenBallroomReveal", "kitchenInnerCounter", "kitchenSinkInteract", "kitchenRange", "kitchenRefrigerator", "kitchenExteriorWindows"]) {
  check("10 kitchen QA views", qaRoomViews.includes(`${view}:`), `missing kitchen QA view ${view}`);
}

// 11. The service stair runs from +z in the basement to -z on the main floor,
// exactly across the 5.4 m opening, with architectural treads and sloped rails.
check("11 service-stair orientation", /(?:bottom|lower)Z\s*=\s*2\.7\b/.test(serviceStair) && /(?:top|upper)Z\s*=\s*-2\.7\b/.test(serviceStair), "service-stair endpoint constants are not aligned to z=+2.7 and z=-2.7");
check("11 service-stair alignment", /(?:const|let)\s+run\s*=\s*5\.4\b/.test(serviceStair), "service-stair run is not aligned to the 5.4 m slab opening");
check("11 service-stair finish", /service-(?:stair-)?tread/.test(serviceStair) && /service-(?:stair-)?riser/.test(serviceStair), "service stair lacks separate thin treads and risers");
check("11 service-stair finish", !/stairStep\(/.test(serviceStair), "service stair still uses full-height stacked stairStep boxes");
check("11 service-stair rails", /service-stair-handrail/.test(serviceStair) && /service-stair-guard/.test(serviceStair), "service stair lacks aligned sloped handrails and physics guards");
check("11 service-stair rails", !serviceStair.includes('"service-main-rail"'), "old floating horizontal service-main-rail still exists");
check("11 service-stair separation", serviceShaftWall.length > 0 && /openings:\s*\[\s*\]/s.test(serviceShaftWall), "main-floor service stair is not separated from the painting room by a solid wall");
check("11 kitchen/service-stair door", kitchenServiceStairWall.length > 0, "missing wall between the kitchen and basement stair landing");
check("11 kitchen/service-stair door", /axis:\s*"x",\s*fixed:\s*-3\.2,\s*start:\s*11\.3,\s*end:\s*15/.test(kitchenServiceStairWall), "kitchen/service-stair wall does not close the remaining boundary gap");
check("11 kitchen/service-stair door", /kind:\s*"door",\s*center:\s*12\.55,\s*width:\s*1\.35,\s*label:\s*"basement stair door",\s*direction:\s*1,\s*hingeSide:\s*-1/.test(kitchenServiceStairWall), "basement stair door is missing, misaligned, or swings toward the flight");
check("11 service-stair doors", !basementPartitions.includes('name: "basement-service-shaft"'), "basement service-stair still has a redundant divider wall");
check("11 service-stair sightline", !/name:\s*"rain-soaked-grounds"\s*,\s*w:\s*92[^;]*d:\s*92/.test(mansion), "a single outdoor ground slab still passes visually through the mansion");
check("11 service-stair sightline", ["front", "rear", "west", "east"].every((side) => mansion.includes(`rain-soaked-grounds-${side}`)), "exterior ground must be cut into four slabs around the foundation footprint");

// 12. The deliberately split main slab must be closed beneath the grand stair.
check("12 floor under grand stair", /floorSlab\(\s*["']main-floor-under-grand-stair["']/.test(slabs), "walkable/collidable floor slab under the grand staircase is missing");

// The first grand-stair landing sits over the only direct foyer-to-ballroom
// circulation lanes. Its finished fascia must clear the player comfortably,
// and both flights must calculate independently so they still meet the raised
// landing and the fixed upper-floor datum without gaps or overshoot.
const grandMidLandingRise = Number(grandStairConfig.match(/MID_LANDING_RISE:\s*([\d.]+)/)?.[1]);
const grandLowerStepCount = Number(grandStairConfig.match(/LOWER_STEP_COUNT:\s*(\d+)/)?.[1]);
const grandUpperStepCount = Number(grandStairConfig.match(/UPPER_STEP_COUNT:\s*(\d+)/)?.[1]);
const grandLandingFasciaUnderside = grandMidLandingRise - 0.245;
check("12 grand-stair head clearance", near(grandMidLandingRise, 2.5, 0.001) && grandLandingFasciaUnderside >= 2.25, "grand mid-landing does not preserve at least 2.25m of finished foyer-to-ballroom clearance");
check("12 grand-stair flight cadence", grandLowerStepCount === 14 && grandUpperStepCount === 12, "raised grand stair no longer uses the balanced 14-step lower and 12-step upper flights");
check("12 grand-stair flight alignment", /const lowerRise\s*=\s*\(midY - FLOOR\.MAIN\) \/ lowerCount/.test(grandStair) && /const upperRise\s*=\s*\(FLOOR\.UPPER - midY\) \/ upperCount/.test(grandStair), "grand stair flights do not calculate independently from the shared landing datum");
check("12 grand-stair collision alignment", /addInvisibleRamp\(0, lowerCenterZ, FLOOR\.MAIN, midY, lowerRampRun/.test(grandStair) && /addInvisibleRamp\(side \* branchCenter, branchCenterZ, midY, FLOOR\.UPPER, branchRun/.test(grandStair), "grand stair collision ramps do not meet the raised landing and upper floor");
check("12 grand-stair QA anchors", /upperFlight:\s*\[-2\.65, FLOOR\.MAIN \+ GRAND_STAIR\.MID_LANDING_RISE/.test(qaHooks) && /midlandingSplit:\s*\[0, FLOOR\.MAIN \+ GRAND_STAIR\.MID_LANDING_RISE/.test(qaHooks), "grand stair QA views are no longer tied to the raised landing datum");

// Prior lighting requirements remain part of the renovation contract: every
// circuit starts on, room entry never mutates a circuit, closets have a real
// contained light, and the global lights-out control reaches every circuit.
check("lighting default state", /this\.on\s*=\s*initiallyOn\s*!==\s*false/.test(lightCircuitClass), "LightCircuit no longer defaults to on");
check("lighting default state", !/new LightCircuit\([^;\n]*,\s*false\s*\)/.test(mansion), "one or more mansion circuits start off");
check("lighting switch-only state", !/\.toggle\s*\(|\.setState\s*\(|\.on\s*=/.test(updateLocation), "entering a room or floor changes a circuit state");
check("lighting switch-only state", !/circuit\.on\s*=/.test(lightRendering), "render synchronization mutates the remembered switch state");
check("lighting switch-only state", /activate:\s*\(\)\s*=>\s*this\.toggle\(\)/.test(lightCircuitClass), "physical light controls are not wired to the circuit toggle");
check("lighting closet coverage", /new THREE\.SpotLight\(0xffb873/.test(cabinetClass) && /requiresOpenCabinet/.test(cabinetClass) && /lightCircuit\.lights\.push\(/.test(cabinetClass), "walk-in closets lack a door-gated, circuit-controlled contained spotlight");
check("25 closet shadow budget", /closetLight\.castShadow\s*=\s*supportsFullRoomShadowSet/.test(cabinetClass), "walk-in closet lights still allocate cube-map or low-sampler shadows");
check("lighting full blackout", /turnOffAllLights[\s\S]*for \(const circuit of circuits\) circuit\.setState\(false, true\)/.test(mansion), "global lights-out does not disable every circuit");
check("basement fixture floor containment", /const wireHeight\s*=\s*0\.32[\s\S]*y:\s*ceilingY - wireHeight \/ 2/.test(fixtureBuilder), "basement suspension wires can protrude through the main floor");
check("painting-room switch placement", /painting\.addSwitch\(7\.25,\s*1\.15,\s*3\.039,\s*Math\.PI\)/.test(lightingBuild), "north painting-room switch is not shifted clear of the casing or facing into the room");
check("painting-room switch placement", /painting\.addSwitch\(7\.25,\s*1\.15,\s*-3\.039,\s*0\)/.test(lightingBuild), "south painting-room switch is not shifted clear of the casing or facing into the room");

// The main landing is enclosed from the kitchen by a hinged door while the
// former painting-room portals remain sealed.
check("13 kitchen/service-stair enclosure", kitchenServiceStairWall.length > 0 && /basement stair door/.test(kitchenServiceStairWall), "kitchen and service stair are not separated by the requested door");
check("14 painting/service-stair separation", /openings:\s*\[\s*\]/s.test(serviceShaftWall), "east painting-room wall still has an opening into the service stair");
check("14 painting/service-stair separation", !/kind:\s*"(?:arch|door|open)"/.test(serviceShaftWall), "an arch or hinged opening remains between the painting room and service stair");
check("15 basement stair walls", !basementPartitions.includes('name: "basement-service-shaft"'), "basement service-shaft divider wall still exists");
check("15 basement stair walls", !serviceStair.includes('name: "service-stair-west-wall"') && !serviceStair.includes('name: "service-stair-east-wall"'), "parallel service-stair side walls still exist");
check("15 basement stair walls", !/\[3\.1,\s*6\.2,\s*9\.3,\s*12\.4\][^\n]*addBookshelf/.test(basementFurnishings), "three archive bookcase backs still read as walls beside the stair");
const archiveFurnishings = section("// Archive", "// Laundry & linen", basementFurnishings);
const archiveShelfBuilder = section("function addArchiveCurio", "function addFireplace");
const archiveRowXs = (archiveFurnishings.match(/const archiveRowXs\s*=\s*\[([^\]]+)\]/)?.[1] || "").split(",").map(Number);
const archiveShelfDepth = Number(archiveFurnishings.match(/depth:\s*([\d.]+)/)?.[1]);
const archiveSouthBank = archiveFurnishings.match(/\{ id: "south", z: ([\d.]+), width: ([\d.]+) \}/)?.slice(1).map(Number) || [];
const archiveNorthBank = archiveFurnishings.match(/\{ id: "north", z: ([\d.]+), width: ([\d.]+) \}/)?.slice(1).map(Number) || [];
check("15 freestanding archive rows", !/addBookshelf\(|new Cabinet\(/.test(archiveFurnishings), "archive still places a bookcase or cabinet against a perimeter wall");
check("15 freestanding archive rows", archiveRowXs.length === 3 && archiveRowXs.every((x, index) => near(x, [3.4, 7.3, 11.2][index], 0.001)), "archive does not have three aligned freestanding shelf rows");
check("15 freestanding archive rows", /archiveRowXs\.forEach[\s\S]*archiveShelfBanks\.forEach[\s\S]*addArchiveShelfBank\(\{/.test(archiveFurnishings) && /height:\s*3\.05/.test(archiveFurnishings) && near(archiveShelfDepth, 0.72, 0.001), "archive rows are not six tall freestanding shelf banks");
check("15 archive wall and end clearance", near(archiveSouthBank[0], 5.25, 0.001) && near(archiveSouthBank[1], 2.1, 0.001) && near(archiveNorthBank[0], 9.4, 0.001) && near(archiveNorthBank[1], 2.6, 0.001), "archive shelf-bank dimensions no longer preserve the perimeter and doorway-aligned cross aisle");
check("15 archive wall and end clearance", archiveSouthBank[0] - archiveSouthBank[1] / 2 - 3.2 >= 1 && 11.86 - (archiveNorthBank[0] + archiveNorthBank[1] / 2) >= 1 && archiveNorthBank[0] - archiveNorthBank[1] / 2 - (archiveSouthBank[0] + archiveSouthBank[1] / 2) >= 1.7, "archive shelves leave less than one metre around an end or pinch the central cross aisle");
check("15 double-sided archive stock", /doubleSided:\s*true/.test(archiveShelfBuilder) && /for \(const \[faceIndex, face\] of \[-1, 1\]\.entries\(\)\)/.test(archiveShelfBuilder), "archive shelf stock is not accessible and visible from both sides");
for (const category of ["archive-books", "archive-documents", "archive-tapes"]) {
  check("15 mixed archive stock", archiveShelfBuilder.includes(category), `archive shelving is missing ${category.replace("archive-", "")}`);
}
for (const curio of ["skull", "sealed-ledger", "reel-to-reel", "specimen-jar"]) {
  check("15 archive curios", archiveFurnishings.includes(`"${curio}"`) && archiveShelfBuilder.includes(curio), `archive is missing its ${curio} curio`);
}
check("15 archive circulation", /archiveDoorEntry:[\s\S]*?openDoors:\s*true[\s\S]*?room:\s*"ARCHIVE"/.test(qaHooks), "archive doorway lacks a physical traversal QA route");
check("15 archive circulation", /archiveCenterAisle:[\s\S]*?room:\s*"ARCHIVE"/.test(qaHooks) && /archiveCrossAisle:[\s\S]*?room:\s*"ARCHIVE"/.test(qaHooks), "archive center and cross aisles lack physical traversal QA routes");
check("15 archive QA views", /archiveRows:/.test(qaRoomViews) && /archiveSkull:/.test(qaRoomViews), "archive rows or skull lack a dedicated visual inspection view");

// 35. Pantry storage is a deliberate five-cabinet system: the two original
// cabinets have role-specific stock, three new south-wall cabinets add dry,
// baking, and tinned goods, and all five reuse the room light so opening them
// cannot expand the fixed shader layout.
check("35 stocked pantry", /name:\s*"pantry cupboard"[^;]+stockKind:\s*"pantry-staples"[^;]+interiorLight:\s*false/.test(pantryFurnishings), "the original pantry cupboard lacks pantry-staple stock or still creates an auxiliary light");
check("35 stocked pantry", /name:\s*"preserves cabinet"[^;]+stockKind:\s*"preserves"[^;]+interiorLight:\s*false/.test(pantryFurnishings), "the preserves cabinet lacks jar stock or still creates an auxiliary light");
for (const [name, x, kind] of [
  ["pantry dry-goods cabinet", "4.0", "dry-goods"],
  ["pantry baking cabinet", "6.15", "baking"],
  ["pantry tinned-goods cabinet", "8.3", "tinned-goods"],
]) {
  check("35 stocked pantry", pantryFurnishings.includes(`{ name: "${name}", x: ${x}, stockKind: "${kind}" }`), `pantry is missing its ${kind} cabinet`);
}
check("35 pantry circulation", /z:\s*-2\.72[\s\S]*?width:\s*1\.8[\s\S]*?height:\s*2\.25[\s\S]*?depth:\s*0\.56[\s\S]*?rotationY:\s*0[\s\S]*?openAngle:\s*88/.test(pantryFurnishings), "south pantry cabinet run no longer preserves the center aisle and safe door swing");
check("35 pantry light budget", count(pantryFurnishings, /interiorLight:\s*false/g) === 3 && /interiorLight\s*=\s*true/.test(cabinetClass) && /this\.hasInteriorLight\s*=\s*Boolean\(interiorLight\)/.test(cabinetClass) && /if \(this\.hasInteriorLight\)/.test(cabinetClass), "pantry cabinets can still mint door-operated spotlights or the cabinet opt-out is missing");
for (const batch of ["pantry-flour-sacks", "pantry-preserve-jars", "pantry-jar-lids"]) {
  check("35 semantic pantry stock", stockedStorageBuilder.includes(batch), `pantry stock builder is missing ${batch}`);
}
check("35 semantic pantry stock", /kind === "preserves"/.test(stockedStorageBuilder) && /kind === "tinned-goods"/.test(stockedStorageBuilder) && /\["pantry-staples", "dry-goods", "baking"\]\.includes\(kind\)/.test(stockedStorageBuilder), "pantry cabinets do not receive role-specific contents");
check("35 pantry diagnostics", /FOOD_STORAGE_KINDS\.has\(storage\.stockKind\)/.test(diagnostics) && /interiorLight:\s*Boolean\(storage\.interiorLight\)/.test(diagnostics), "pantry item totals or auxiliary-light state are absent from diagnostics");
check("35 pantry culling roundtrip", /for \(const storage of stockedStorages\)[\s\S]*?mesh\.visible = !shouldHide && Boolean\(storage\.open\)/.test(exteriorCulling) && count(mansion, /mesh\.visible = this\.open && !interiorDetailsHidden/g) === 2, "open pantry or refrigerator stock can disappear after an exterior-culling roundtrip");
check("35 pantry QA views", /pantryStorageNorth:/.test(qaRoomViews) && /pantryStorageSouth:/.test(qaRoomViews), "pantry cabinet banks lack dedicated visual inspection views");

// 35. Fireplaces use additive procedural sprites and an ember bed rather than
// real scene lights, preserving the shader budget. Each hearth starts lit,
// animates only on its floor, and exposes a reversible interaction.
check("35 animated fireplaces", /createRadialGradient/.test(fireTextureBuilder) && /bezierCurveTo/.test(fireTextureBuilder) && /new THREE\.CanvasTexture/.test(fireTextureBuilder), "procedural flame texture is missing its tapered alpha shape");
check("35 animated fireplaces", /fireOuter:\s*new THREE\.SpriteMaterial/.test(materialFactory) && /fireInner:\s*new THREE\.SpriteMaterial/.test(materialFactory) && /fireGlow:\s*new THREE\.MeshBasicMaterial/.test(materialFactory) && /fireEmber:\s*new THREE\.MeshBasicMaterial/.test(materialFactory) && count(materialFactory, /blending:\s*THREE\.AdditiveBlending/g) >= 4, "fire materials lack layered additive flames, glow, or embers");
check("35 functional fireplaces", /type:\s*"fireplace"/.test(fireplaceClass) && /\$\{this\.on \? "Extinguish" : "Light"\}/.test(fireplaceClass) && /activate:\s*\(\) => this\.setOn\(!this\.on\)/.test(fireplaceClass), "fireplaces do not expose a reversible light/extinguish interaction");
check("35 functional fireplaces", /fireplaces\.push\(this\)/.test(fireplaceClass) && /animatedObjects\.push\(this\)/.test(fireplaceClass) && /state\.currentFloor === this\.floorLabel/.test(fireplaceClass) && /!interiorDetailsHidden/.test(fireplaceClass), "fireplace animation is not registered or floor-aware");
check("35 fireplace shader budget", !/new THREE\.(?:PointLight|SpotLight)/.test(fireplaceClass) && /object\.userData\.fireplaceEffect/.test(exteriorCulling), "fireplace effects create real lights or are not protected from generic culling");
check("35 functional fireplaces", count(mansion, /addFireplace\("(?:library fireplace|music room fireplace|rear lounge fireplace)"/g) === 3, "all three mansion fireplaces must use uniquely named functional hearths");
check("35 fireplace diagnostics", /fireplacesTotal:\s*fireplaces\.length/.test(diagnostics) && /flameCount:\s*fireplace\.flames\.length/.test(diagnostics) && /MrFeastFresh\.setFireplace/.test(qaHooks), "fireplace state is not observable and controllable through QA diagnostics");
for (const view of ["libraryFireplace", "musicRoomFireplace", "rearLoungeFireplace"]) {
  check("35 fireplace QA views", qaRoomViews.includes(`${view}:`), `missing fireplace inspection view ${view}`);
}

check("16 shared service-stair lights", /"SERVICE STAIR"\s*:\s*\["service stair lights"\]/.test(lightingMap), "service stair room does not map to one shared lighting circuit");
check("16 shared service-stair lights", !/service stair (?:upper|lower) light/.test(lightingMap) && !/const service(?:Upper|Lower)\s*=/.test(lightingBuild), "legacy independent service-stair circuits still exist");
check("16 shared service-stair lights", serviceStairLighting.length > 0 && /serviceStair\.addLevel\("BASEMENT"\)/.test(serviceStairLighting), "shared service-stair circuit does not span the main and basement floors");
check("16 shared service-stair lights", count(serviceStairLighting, /serviceStair\.addFixture\(/g) === 2, "shared service-stair circuit must own exactly two visible fixtures");
check("16 shared service-stair lights", /serviceStair\.addFixture\(12\.55,\s*-2\.25,\s*"corridor",\s*FLOOR\.MAIN\)/.test(serviceStairLighting), "visible overhead light is not positioned at the top of the stairs");
check("16 shared service-stair lights", /serviceStair\.addFixture\(12\.55,\s*4\.4,\s*"corridor",\s*FLOOR\.BASEMENT\)/.test(serviceStairLighting), "lower stair light is not a few steps beyond the bottom landing");
check("16 shared service-stair lights", /serviceStair\.addSwitch\(13\.72,\s*FLOOR\.MAIN \+ 1\.15,\s*-3\.039,\s*0\)/.test(serviceStairLighting), "top switch is not mounted beside the new stair wall");
check("16 shared service-stair lights", /serviceStair\.addSwitch\(14\.839,\s*FLOOR\.BASEMENT \+ 1\.15,\s*2\.4,\s*-Math\.PI \/ 2\)/.test(serviceStairLighting), "bottom switch is missing from the shared circuit");
check("16 shared service-stair lights", count(serviceStairLighting, /serviceStair\.addSwitch\(/g) === 2, "both stair switches must control the same two-light circuit");
check("16 floor-aware fixture builder", /const fixtureFloorY\s*=\s*floorYOverride == null \? this\.floorY : floorYOverride/.test(fixtureBuilder) && /const ceilingY\s*=\s*fixtureFloorY \+/.test(fixtureBuilder), "fixture builder cannot place shared-circuit lights on two floors");
check("16 floor-aware fixture builder", /Array\.from\(this\.levels\),\s*fixtureFloorY \+ 0\.04/.test(fixtureBuilder), "corridor light target still uses the circuit's original floor instead of the fixture floor");
for (const view of ["kitchenServiceStairDoor", "serviceStairTopLight", "serviceStairTopSwitch", "serviceStairBottomLight", "serviceStairBottomSwitch"]) {
  check("16 service-stair QA views", qaRoomViews.includes(`${view}:`), `missing service-stair inspection view ${view}`);
}
check("16 service-stair door route", /kitchenServiceStairDoorEntry:[\s\S]*?openDoors:\s*true[\s\S]*?visitedRooms:\s*\["KITCHEN",\s*"SERVICE STAIR"\]/.test(qaHooks), "new basement stair door lacks a physical kitchen-to-landing traversal route");
check("17 main-stair lights", !/upperLanding\.addFixture\(/.test(lightingBuild), "small upper-landing chandelier still hangs above the main stair");
check("17 main-stair lights", !/\[-9\.7,\s*0,\s*9\.7\][^\n]*bedroomCorridor\.addFixture/.test(lightingBuild), "second small center chandelier still hangs above the main stair");
check("17 signature foyer chandelier", /addFoyerGrandChandelier\(foyer,\s*0,\s*7\.7\)/.test(lightingBuild) && !/foyer\.addFixture\(0,\s*7\.7,\s*"atrium"\)/.test(lightingBuild), "generic foyer ring was not replaced by the signature grand chandelier");
check("17 signature foyer chandelier", /foyer-grand-chandelier-crown/.test(signatureChandelierBuilders) && /\{\s*radius:\s*1\.05,\s*y:\s*ceilingY - 1\.28,\s*bulbs:\s*8\s*\}/.test(signatureChandelierBuilders) && /\{\s*radius:\s*1\.62,\s*y:\s*ceilingY - 2\.08,\s*bulbs:\s*12\s*\}/.test(signatureChandelierBuilders), "foyer chandelier does not have the requested twenty-light two-tier silhouette");
check("17 signature foyer chandelier", /foyer-grand-chandelier-crystal-drop/.test(signatureChandelierBuilders) && /foyer-grand-chandelier-central-finial/.test(signatureChandelierBuilders), "foyer chandelier lacks its crystal drops or central finial");
check("17 connected foyer chandelier", /foyer-grand-chandelier-tier-inner-hub/.test(signatureChandelierBuilders) && /const innerHubRadius\s*=\s*tier\.radius \* 0\.35/.test(signatureChandelierBuilders), "foyer chandelier scroll arms do not terminate on a solid inner hub");
check("17 connected foyer chandelier", /foyer-grand-chandelier-tier-bridge/.test(signatureChandelierBuilders), "foyer chandelier tiers are not visibly tied together");
check("17 connected foyer chandelier", /foyer-grand-chandelier-crystal-hanger/.test(signatureChandelierBuilders), "foyer chandelier crystal drops are still floating below their ring");
check("17 signature front chandelier", /addFrontPorticoChandelier\(estateExteriorLights\)/.test(yardBuild) && !/front-portico-downlight/.test(yardBuild), "front entrance still uses a source-less downlight instead of the portico chandelier");
check("17 signature front chandelier", /front-portico-chandelier-rain-glass/.test(signatureChandelierBuilders) && /front-portico-chandelier-cage-rib/.test(signatureChandelierBuilders) && /front-portico-chandelier-lower-rib/.test(signatureChandelierBuilders), "front portico chandelier lacks its weathered cage or rain-glass body");
check("17 signature front chandelier", /front-portico-chandelier-spotlight/.test(signatureChandelierBuilders) && /exteriorBudgetPriority\s*=\s*4/.test(signatureChandelierBuilders), "front portico chandelier is not connected to the controlled exterior light budget");
check("18 attached faucets", /faucet-deck-collar/.test(mansion) && /water-valve-mount/.test(waterClass), "sink and tub controls lack visible mounting hardware");
check("40 hollow vanity basins", /vanity-marble-countertop/.test(vanityBuilder) && /bathroomVesselBasinShell/.test(vanityBuilder) && /new THREE\.LatheGeometry/.test(vanityBuilder) && /new THREE\.Vector2\(0, 0\.025\)/.test(vanityBuilder) && /hollow-porcelain-basin/.test(vanityBuilder) && /bathroomVesselBasinFloor/.test(vanityBuilder) && /porcelain-basin-floor/.test(vanityBuilder) && /basin-drain/.test(vanityBuilder), "bathroom sinks are still capped pucks or have an open floor around the drain");
check("40 coherent bathroom faucets", /faucet-nozzle/.test(vanityBuilder) && /kind === "sink" \? 0\.2/.test(waterClass) && /water-valve-collar`, radius: 0\.052, height: 0\.025/.test(waterClass) && /water-valve-mount`, radius: 0\.018, height: 0\.13/.test(waterClass) && /kind === "shower" \? 0\.065 : 0\.038/.test(waterClass), "bathroom faucets do not use compact, deck-mounted sink controls");
check("18 attached shower", /shower-wall-backplate/.test(mansion) && /shower-arm/.test(mansion), "shower head lacks a wall backplate and connecting arm");
check("40 visible shower downlights", /addShowerDownlight\(label, x, z\)/.test(lightCircuitClass) && count(lightingBuild, /\.addShowerDownlight\(/g) === 2 && /shower-downlight-diffuser/.test(lightCircuitClass) && /ceilingY - 0\.16,\s*z,\s*48,[\s\S]*?0\.58,/.test(lightCircuitClass), "both showers need visible circuit-bound ceiling downlights with a useful pool of light");
check("40 selected shower downlights", /fixtureRole\s*=\s*"shower-downlight"/.test(lightCircuitClass) && budgetedLightSelection.indexOf('fixtureRole === "shower-downlight"') > -1 && budgetedLightSelection.indexOf('fixtureRole === "shower-downlight"') < budgetedLightSelection.indexOf("const openVolumeQueues"), "shower spots are still dropped before optional open-volume lights fill the fixed shader budget");

// 19. The estate yard is a contained, fully authored level rather than an
// unbounded plane. Its driveway, garden, pool, maze, interactions, lighting,
// diagnostics, and physical walkthroughs are all part of the acceptance
// contract because each is visible and reachable from a mansion exterior door.
check("19 estate yard layout", yardLayout.length > 0, "YARD_LAYOUT is missing");
check("19 estate yard layout", /bounds\s*:\s*Object\.freeze\(/.test(yardLayout) && /driveway\s*:\s*Object\.freeze\(/.test(yardLayout), "estate bounds and driveway alignment are not centralized");
check("19 estate yard build", yardBuild.length > 0 && /\bbuildEstateYard\(\);/.test(exteriorBuild), "buildEstateYard() is missing or not invoked by buildExteriorScene()");

for (const name of [
  "estate-perimeter-hedge-north-west",
  "estate-perimeter-hedge-north-east",
  "estate-perimeter-hedge-south",
  "estate-perimeter-hedge-west",
  "estate-perimeter-hedge-east",
]) {
  check("19 contained hedge perimeter", yardBuild.includes(name), `missing visible perimeter run ${name}`);
}
check("19 contained hedge perimeter", count(yardBuild, /physics\.addFixedBox\(/g) >= 6, "yard perimeter/features lack independent Rapier collision proxies");
check("19 contained hedge perimeter", /function derivePerimeterCoverage\(/.test(yardBuild) && /perimeterClosed\s*=\s*gaps\.length\s*===\s*0/.test(yardBuild), "yard perimeter closure is asserted instead of derived from built hedge and gate intervals");
check("19 contained hedge perimeter", /perimeterUncoveredIntervals\.map/.test(yardBuild), "yard diagnostics do not report derived perimeter coverage gaps");

check("19 locked driveway gate", /function addLockedDrivewayGate\(/.test(yardBuild), "locked driveway gate factory is missing");
check("19 locked driveway gate", /locked driveway gate/i.test(yardBuild) && /deniedAttempts\s*\+=\s*1/.test(yardBuild), "gate interaction does not report and count denied attempts");
check("19 locked driveway gate", /locked:\s*true/.test(yardBuild) && /colliderEnabled:\s*true/.test(yardBuild), "gate state is not permanently locked and collidable");
check("19 locked driveway gate", /addInteractionTarget\(/.test(yardBuild), "driveway gate has no interaction target");

check("19 formal garden", /function buildFormalGarden\(/.test(yardBuild), "formal garden factory is missing");
check("44 west garden placement", /garden:\s*Object\.freeze\(\{ centerX:\s*-25, centerZ:\s*-2\.2, width:\s*15, depth:\s*23\.6, pathWidth:\s*2\.1, frontJunctionZ:\s*16\.3, rearJunctionZ:\s*-14\.0 \}\)/.test(yardLayout), "west-lawn garden is not shifted rearward onto the authored terrace endpoint");
check("45 continuous garden walkway network", /const GARDEN_WALKWAY_LAYOUT\s*=\s*Object\.freeze/.test(yardLayout) && /function addGardenWalkwayNetwork\(/.test(yardBuild) && /new THREE\.ShapeGeometry\(shape\)/.test(yardBuild) && /west-lawn-garden-walkway-network/.test(yardBuild), "front, formal-garden, and rear walkways are not authored as one seamless paved surface");
check("45 no overlapping garden slabs", !/box\(\{ name:\s*"(?:west-lawn-front-garden-connector|formal-garden-front-approach|garden-approach-path|formal-garden-path-long|formal-garden-path-cross)"/.test(yardBuild), "legacy overlapping walkway slabs still create visible seams at the front or rear junction");
check("45 measured walkway endpoints", /frontCarriageWestEdgeX:\s*-13\.5/.test(yardLayout) && /rearTerraceWestEdgeX:\s*-14\.5/.test(yardLayout) && /crossHalfWidth:\s*7\.3/.test(yardLayout) && /garden\.frontJunctionZ \+ halfWidth/.test(yardBuild) && /garden\.rearJunctionZ - halfWidth/.test(yardBuild), "walkway outline no longer derives from the exact carriage, terrace, and garden edges");
check("45 garden lamps off paths", /front:\s*Object\.freeze\(\{ x:\s*-19\.0, z:\s*18\.65 \}\)/.test(yardLayout) && /rear:\s*Object\.freeze\(\{ x:\s*-19\.5, z:\s*-16\.35 \}\)/.test(yardLayout) && /GARDEN_WALKWAY_LAYOUT\.lamps\.(?:front|rear)/.test(yardBuild), "west-lawn lamps are not placed on the grass-side offsets clear of both walkways");
check("45 layout-driven garden", /const garden = YARD_LAYOUT\.garden;[\s\S]*?const gardenX = garden\.centerX;[\s\S]*?const gardenZ = garden\.centerZ;/.test(yardBuild), "formal garden geometry can drift away from its shared layout datum");
check("19 formal garden", /const beds\s*=\s*\[[\s\S]*?\{ x:[\s\S]*?\{ x:[\s\S]*?\{ x:[\s\S]*?\{ x:/.test(yardBuild) && /yardState\.featureCounts\.gardenBeds\s*=\s*beds\.length/.test(yardBuild), "formal garden needs four data-driven named parterre beds");
check("19 formal garden", /garden-fountain-basin/.test(yardBuild) && /west-lawn-garden-walkway-network/.test(yardBuild), "formal garden lacks its focal fountain or connected paths");
check("19 formal garden", /garden-fountain-crown-lantern-bulb/.test(yardBuild) && /garden-fountain-crown-lantern-light/.test(yardBuild) && /visibleFixtureEmitter\s*=\s*true/.test(yardBuild), "fountain glow is not tied to a visible crown-lantern source");
check("19 formal garden", /garden-rose-(?:blooms|stems)/.test(yardBuild), "formal garden lacks batched planted detail");

check("19 swimming pool", /function buildEstatePool\(/.test(yardBuild), "pool factory is missing");
for (const name of ["estate-pool-water", "estate-pool-bottom", "estate-pool-coping", "estate-pool-step", "pool-terrace-pavers"]) {
  check("19 swimming pool", yardBuild.includes(name), `pool component ${name} is missing`);
}
check("19 swimming pool", ["north", "south", "west-middle", "east-middle"].every((part) => exteriorBuild.includes(`rain-soaked-grounds-rear-${part}`)), "rear ground/collider is not carved around the pool cavity");
check("19 swimming pool", !/rain-soaked-grounds-rear["']\s*,\s*w:\s*92[^;]*d:\s*36/.test(exteriorBuild), "legacy solid rear collider still runs beneath the pool");
check("19 swimming pool", /physics\.addFixedRamp\(pool\.centerX/.test(yardBuild), "pool entry stairs lack a continuous Rapier walking surface");
for (const support of [
  "pool-north-terrace-support-left",
  "pool-north-terrace-support-right",
  "pool-west-terrace-support",
  "pool-east-terrace-support",
  "pool-south-terrace-support",
]) {
  check("19 swimming pool", yardBuild.includes(support), `pool deck support ${support} is missing`);
}
check("19 swimming pool", /for \(const support of poolDeckSupports\) physics\.addFixedBox/.test(yardBuild), "visual pool pavers are not backed by physical deck supports");
check("19 fall recovery", /updateSafety\(\)/.test(physicsClass) && /fallRecoveries\s*\+=\s*1/.test(physicsClass), "physics has no last-safe-position recovery for an unexpected yard fall");
check("19 fall recovery", count(playerUpdate, /physics\.updateSafety\(\)/g) >= 2, "fall safety is not called after both fixed-step paths");
check("19 fall recovery", /fallRecoveries:\s*physics\.fallRecoveries/.test(diagnostics), "fall recovery count is absent from diagnostics");
check("19 fall recovery", /fallRecoveriesAtStart\s*=\s*physics\.fallRecoveries/.test(qaHooks) && /fallRecoveryDelta\s*===\s*0/.test(qaHooks), "yard circulation routes can pass after a hidden fall recovery");

check("19 hedge maze", mazeLayout.length > 0 && /function buildHedgeMaze\(/.test(yardBuild), "grid-driven hedge maze is missing");
const mazeRows = Array.from(mazeLayout.matchAll(/["']([#SE.]{5,})["']/g), (match) => match[1]);
check("19 hedge maze", mazeRows.length === 31, "full-length east-lawn maze must contain exactly 31 authored rows");
if (mazeRows.length) {
  const width = mazeRows[0].length;
  check("19 hedge maze", mazeRows.every((row) => row.length === width) && width === 9, "long maze is not a rectangular 31x9 layout");
  const cells = mazeRows.join("");
  check("19 hedge maze", (cells.match(/S/g) || []).length === 1 && (cells.match(/E/g) || []).length === 1, "maze needs one entrance and one internal traversal goal");
  check("33 closed south maze wall", mazeRows.at(-1) === "#########" && mazeRows.at(-2).includes("E"), "maze still has a visible exit cut through its south boundary");
  const start = cells.indexOf("S");
  const exit = cells.indexOf("E");
  const queue = start >= 0 ? [start] : [];
  const seen = new Set(queue);
  while (queue.length) {
    const index = queue.shift();
    const row = Math.floor(index / width);
    const col = index % width;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow >= mazeRows.length || nextCol < 0 || nextCol >= width) continue;
      const next = nextRow * width + nextCol;
      if (mazeRows[nextRow][nextCol] === "#" || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  check("19 hedge maze", exit >= 0 && seen.has(exit), "hedge maze entrance has no walkable route to its internal south goal");
  const openCells = Array.from(cells, (cell, index) => cell === "#" ? null : index).filter((index) => index != null);
  const openDegree = (index) => {
    const row = Math.floor(index / width);
    const col = index % width;
    return [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      return nextRow >= 0 && nextRow < mazeRows.length && nextCol >= 0 && nextCol < width && mazeRows[nextRow][nextCol] !== "#";
    }).length;
  };
  const junctions = openCells.filter((index) => openDegree(index) >= 3);
  const edgeCount = openCells.reduce((total, index) => total + openDegree(index), 0) / 2;
  const routeChoices = edgeCount - openCells.length + 1;
  const northOpenCells = openCells.filter((index) => Math.floor(index / width) < Math.floor(mazeRows.length / 2));
  check("32 hedge maze choices", junctions.length >= 18 && routeChoices >= 8, `maze offers only ${junctions.length} junction cells and ${routeChoices} alternate loops`);
  check("32 north maze access", mazeRows[5][0] === "." && northOpenCells.every((index) => seen.has(index)), "north maze lacks a visible west-side entrance or contains unreachable passages");
  check("36 rear maze alignment", mazeRows[18][0] === "S" && mazeRows[19][0] === "#", "rear maze opening is not shifted onto the terrace centerline row");
}
check("19 hedge maze", /cellSize\s*:\s*1\.[4-9]/.test(mazeLayout), "maze corridors are not comfortably wider than the player capsule");
check("19 hedge maze", /cellSize:\s*1\.5/.test(mazeLayout) && /centerX:\s*26\.5/.test(mazeLayout) && /centerZ:\s*-9\.25/.test(mazeLayout), "long maze no longer spans the authored rear-to-front east-lawn footprint");
check("19 hedge maze", mazeRows.join("").split("#").length - 1 >= 150, "long maze lacks enough hedge mass to fill the east lawn");
check("33 aligned east-lawn walkway", /east-lawn-house-walkway[^;]*w:\s*2\.5[^;]*d:\s*31\.05[^;]*x:\s*17\.35[^;]*z:\s*0\.775/.test(yardBuild), "east-lawn walkway does not terminate on the front carriage centerline");
check("33 aligned east-lawn walkway", /east-lawn-front-yard-connector[^;]*w:\s*5\.1[^;]*d:\s*2\.4[^;]*x:\s*16\.05[^;]*z:\s*16\.3/.test(yardBuild), "east-lawn/front-yard connector is not aligned with the front carriage path");
check("36 rear maze alignment", /const HEDGE_MAZE_REAR_ENTRANCE\s*=\s*Object\.freeze\(mazeCellCenter\(HEDGE_MAZE_REAR_PORTAL\.row, HEDGE_MAZE_REAR_PORTAL\.col\)\)/.test(mazeLayout) && /maze-approach-path[^;]*z:\s*HEDGE_MAZE_REAR_ENTRANCE\.z/.test(yardBuild), "rear maze path does not derive its centerline from the shifted portal");
check("32 north maze access", /maze-north-access-spur/.test(yardBuild), "north maze entrance has no legible paved spur from the east-lawn walkway");
const mazePortalBuilder = section("function addMazeEntrancePortal", "function buildHedgeMaze", yardBuild);
check("35 matching maze portals", /const HEDGE_MAZE_PORTALS\s*=/.test(mazeLayout) && /id:\s*"rear"[^\n]*row:\s*18[^\n]*col:\s*0/.test(mazeLayout) && /id:\s*"north"[^\n]*row:\s*5[^\n]*col:\s*0/.test(mazeLayout), "rear and north maze portals do not share authored grid definitions");
check("35 matching maze portals", /function addMazeEntrancePortal\(/.test(yardBuild) && /for \(const portal of HEDGE_MAZE_PORTALS\)/.test(yardBuild) && /addMazeEntrancePortal\(portal/.test(yardBuild), "both maze openings are not built through the same portal helper");
for (const component of ["entrance-urn", "entrance-topiary", "entrance-arch-post", "entrance-arch", "entrance-crest"]) {
  check("35 matching maze portals", mazePortalBuilder.includes(component), `shared maze portal is missing ${component}`);
}
check("19 hedge maze", /hedge-maze-walls/.test(yardBuild) && /physics\.addFixedBox\(/.test(yardBuild), "maze hedges lack aligned visible and physical walls");
check("19 hedge maze", /addBoxInstanceBatch\("hedge-maze-walls"/.test(yardBuild) && /addOutdoorInstanceBatch\("hedge-maze-clipped-foliage"/.test(yardBuild), "expanded hedge geometry is no longer kept in two instanced draw batches");
check("34 natural hedge silhouette", /function makeClippedHedgeGeometry\(\)/.test(yardBuild) && /new THREE\.BoxGeometry\(1,\s*1,\s*1,\s*2,\s*3,\s*2\)/.test(yardBuild) && /position\.setXYZ\(/.test(yardBuild), "maze hedges lack a continuous top-chamfered foliage shell");
check("34 natural hedge silhouette", !/new THREE\.ExtrudeGeometry\(/.test(section("function makeClippedHedgeGeometry", "function buildHedgeMaze", yardBuild)), "maze foliage still bevels every cell edge and exposes repeated vertical seams");
check("34 hedge draw-call budget", /clipped\.clearGroups\(\)/.test(yardBuild) && /clipped\.addGroup\(0,\s*clipped\.index\.count,\s*0\)/.test(yardBuild), "clipped hedge geometry still renders one draw group per box face");
check("34 natural hedge silhouette", !/hedge-maze-leaf-clumps/.test(yardBuild) && !/IcosahedronGeometry\(1,\s*1\)/.test(section("function buildHedgeMaze", "function buildEstateTrees", yardBuild)), "half-sphere foliage clumps still protrude from the maze hedges");

check("19 exterior lighting", lightingMap.includes('"FRONT DRIVE"') && lightingMap.includes('"FORMAL GARDEN"') && lightingMap.includes('"POOL TERRACE"') && lightingMap.includes('"HEDGE MAZE"'), "yard zones are not mapped to controlled exterior lighting");
check("19 exterior lighting", /new LightCircuit\("estate exterior lights"[^;]*true\)/.test(yardBuild), "estate exterior light circuit is missing or does not start on");
check("19 exterior lighting", /estateExteriorLights\.addSwitch\(/.test(yardBuild) && count(yardBuild, /addEstateLantern\(/g) >= 6, "yard lacks a physical switch or sufficient practical lanterns");
check("19 exterior lighting", /physics\.addFixedBox\(x, YARD_LAYOUT\.groundY \+ height \/ 2, z, 0\.22, height, 0\.22/.test(yardBuild), "exterior lantern posts have no height-matched physical proxy");
check("19 exterior lighting", /function addRearFacadeWallLantern\(/.test(yardBuild) && count(yardBuild, /addRearFacadeWallLantern\(estateExteriorLights/g) === 2, "rear entrance does not have exactly two visible wall lanterns");
check("19 exterior lighting", !/addPracticalLight\(0,\s*2\.45,\s*-14\.2/.test(yardBuild), "source-less rear entrance spotlight remains");

check("19 yard diagnostics", /yard\s*:\s*getYardDiagnostics\(/.test(diagnostics), "render_game_to_text diagnostics do not include yard state");
check("19 yard diagnostics", /gate:\s*\{/.test(yardBuild) && /maze:\s*\{/.test(yardBuild) && /featureCounts:\s*\{/.test(yardBuild), "yard diagnostics omit gate, maze, or feature counts");
for (const view of ["yardGateA", "yardGateInteract", "yardGardenA", "yardGardenB", "yardGardenFrontJunction", "yardGardenFrontApproach", "yardGardenRearJunction", "yardPoolA", "yardPoolB", "yardMazeA", "yardMazeB", "yardMazeEntranceCell", "yardMazeNorthEntrance", "yardMazeNorthEntranceCell", "yardMazeSouthWallExterior", "yardEastFrontConnector", "yardPoolNorthGuard", "yardPoolEastEntry", "yardGardenApproach", "yardExteriorSwitch"]) {
  check("19 yard QA views", mansion.includes(`${view}:`), `missing QA view ${view}`);
}
for (const route of ["yardGateBlock", "yardGateWestSeam", "yardGateEastSeam", "yardBoundarySouth", "yardBoundaryWest", "yardBoundaryEast", "yardMazeSolution", "yardMazeApproach", "yardMazeSouthWallBlock", "yardMazeNorthAccess", "yardEastFrontConnection", "yardPoolNorthGuard", "yardPoolEastEntry", "yardGardenWalk", "yardGardenFrontWalk", "frontDoorOut", "terraceDoorOut"]) {
  check("19 yard QA routes", qaHooks.includes(`${route}:`) || qaHooks.includes(`case \"${route}\"`), `missing physical QA route ${route}`);
}
check("19 yard QA routes", count(qaHooks, /openDoors:\s*true/g) >= 2 && /if \(route\.openDoors\)/.test(qaHooks), "exterior-door routes do not open their own doors");
check("19 yard QA routes", /route\.expected/.test(qaHooks) && /route expectation not met/.test(qaHooks), "QA routes report complete without checking their expected endpoint");
check("36 aligned maze approach route", /yardMazeApproach:[\s\S]*?expected:\s*\{[^}]*room:\s*"HEDGE MAZE"[^}]*visitedRooms:\s*\["REAR LAWN",\s*"HEDGE MAZE"\]/.test(qaHooks), "rear approach QA does not prove the shifted entrance is physically traversable");
check("44 garden connection routes", /yardGardenWalk:[\s\S]*?visitedRooms:\s*\["REAR LAWN",\s*"FORMAL GARDEN"\]/.test(qaHooks) && /yardGardenFrontWalk:[\s\S]*?visitedRooms:\s*\["FRONT DRIVE",\s*"WEST LAWN",\s*"FORMAL GARDEN"\]/.test(qaHooks), "front and rear garden connections lack physical traversal coverage");
check("19 yard QA routes", /dataset\.qaRouteStatus\s*=\s*state\.qaRoute\.status/.test(qaHooks) && /dataset\.qaRouteX\s*=\s*p\.x\.toFixed\(2\)/.test(qaHooks) && /dataset\.qaRouteZ\s*=\s*p\.z\.toFixed\(2\)/.test(qaHooks), "QA routes do not expose their final status and endpoint for browser verification");
check("19 yard QA routes", /yardPoolNorthGuard:[\s\S]*?yaw:\s*-Math\.PI\s*\/\s*2[\s\S]*?seconds:\s*1\.25/.test(qaHooks), "north pool-deck support route still steps over the coping into the pool");

check("19 locked driveway gate copy", !/The gates are open/i.test(page), "intro copy contradicts the locked driveway gate");

// 20. Exterior traversal and lighting containment. Approaching an exterior
// door must restore the real interior before the capsule reaches the threshold,
// and fixtures must illuminate authored, visible sources instead of hidden
// floor-wide PointLights that pass through walls.
for (const side of ["front", "rear", "west", "east"]) {
  check("20 continuous exterior facade", exteriorWalls.includes(`facade-interstory-infill-${side}`), `missing ${side} interstory facade infill`);
}
check("20 continuous exterior facade", /const interstoryHeight\s*=\s*FLOOR\.UPPER\s*-\s*\(FLOOR\.MAIN \+ WALL_HEIGHT\) \+ 0\.08/.test(exteriorWalls), "interstory infill no longer overlaps both authored floor elevations");
check("20 continuous exterior facade", count(exteriorWalls, /w:\s*30\.34,\s*h:\s*interstoryHeight/g) === 2 && count(exteriorWalls, /h:\s*interstoryHeight,\s*d:\s*24\.34/g) === 2, "facade infill does not span both full-width and full-depth elevations");
check("20 exterior re-entry rendering", /distanceFromHouse/.test(exteriorCulling) && /nearHouse/.test(exteriorCulling), "exterior culling does not restore the interior before a player reaches the house");
check("20 exterior re-entry diagnostics", /interiorDetailsHidden:\s*Boolean\(interiorDetailsHidden\)/.test(diagnostics), "diagnostics cannot prove whether the interior render set is restored");
check("20 rear re-entry thresholds", /ballroom-rear-threshold/.test(exteriorBuild) && !/kitchen-service-threshold/.test(exteriorBuild) && count(exteriorBuild, /physics\.addFixedRamp\(threshold\.x/g) === 0, "sealed kitchen wall still owns an exterior threshold or ramp");
check("20 outer entry ramps", /front-portico-outer-entry-ramp/.test(exteriorBuild) && /ballroom-rear-outer-entry-ramp/.test(exteriorBuild) && count(exteriorBuild, /addExteriorEntryRamp\(/g) === 2, "front and rear slab edges do not both have visible walkable approach ramps");
for (const route of ["frontDoorRoundTrip", "terraceDoorRoundTrip"]) {
  check("20 exterior re-entry routes", qaHooks.includes(`${route}:`), `missing exterior round-trip route ${route}`);
}
for (const route of ["frontStepReentry", "rearStepReentry"]) {
  check("20 outer entry routes", qaHooks.includes(`${route}:`), `missing outer-step re-entry route ${route}`);
}
for (const [route, nextRoute, finalRoom, outdoorRoom] of [
  ["frontDoorRoundTrip", "terraceDoorRoundTrip", "FRONT FOYER", "FRONT DRIVE"],
  ["terraceDoorRoundTrip", "yardPoolWalk", "BALLROOM", "REAR LAWN"],
]) {
  const routeBlock = section(`${route}: {`, `${nextRoute}:`, qaHooks);
  check("20 exterior re-entry routes", routeBlock.includes(`room: "${finalRoom}"`) && routeBlock.includes(`"${outdoorRoom}"`) && /interiorRendered:\s*true/.test(routeBlock) && /nearExteriorRendered:\s*true/.test(routeBlock), `${route} does not assert its outdoor visit, near-threshold render set, and final interior room`);
}
check("20 exterior re-entry routes", /visitedRooms/.test(qaHooks) && /circuitStatesUnchanged/.test(qaHooks) && /fallRecoveryDelta/.test(qaHooks) && /visibleInteriorMeshes/.test(qaHooks), "round-trip routes do not prove room visitation, near-threshold interior visibility, manual light state, and fall safety");

check("20 room-local lighting", /addContainedSpotLight\(/.test(lightCircuitClass) && /new THREE\.SpotLight\(/.test(lightCircuitClass), "interior fixtures are not using bounded downward spotlights");
check("20 room-local lighting", /this\.addContainedSpotLight\(/.test(section("addFixture(x, z, style", "addPracticalLight(", lightCircuitClass)), "ceiling fixtures still use wall-penetrating point lights");
check("20 room-local lighting", /if \(style === "atrium"\) \{[\s\S]*?this\.addContainedSpotLight\([\s\S]*?\btrue,\s*\n\s*\);/.test(section("addFixture(x, z, style", "addRoomOmniLight(x, y, z", lightCircuitClass)) && !/sharedWallShadow/.test(lightCircuitClass), "the atrium cone lost its shadow map, or retired per-room shadow special cases have returned");
check("20 room-local lighting", /shadow\.mapSize\.set\(256, 256\)/.test(lightCircuitClass) && /shadow\.bias/.test(lightCircuitClass) && /shadow\.normalBias/.test(lightCircuitClass), "contained shadow lights exceed the local map budget or omit bias tuning");
check("20 room-local lighting", /settings\.contained == null[\s\S]*?this\.name !== "estate exterior lights"/.test(lightCircuitClass), "interior practical lights do not default to bounded downward cones");
check("20 room-local lighting", /corridor:\s*\{[\s\S]*?intensity:\s*225,[\s\S]*?distance:\s*8\.6,[\s\S]*?angle:\s*0\.5/.test(lightCircuitClass), "narrow corridors do not use the brighter contained cone profile");
check("20 fixture-scaled light reach", /atrium:\s*\{\s*intensity:\s*380,\s*distance:\s*14\.5,\s*angle:\s*0\.85/.test(lightCircuitClass) && /grand:\s*\{[\s\S]*?intensity:\s*95,[\s\S]*?distance:\s*12\.5,[\s\S]*?angle:\s*1\.04/.test(lightCircuitClass) && /small:\s*\{\s*intensity:\s*48,\s*distance:\s*9\.2,\s*angle:\s*1\.02/.test(lightCircuitClass), "fixture reach no longer scales from atrium to formal chandelier to compact ceiling light");
check("20 fixture-scaled light reach", /fixtureStyle\s*=\s*style/.test(lightCircuitClass) && /authoredReach\s*=\s*containedDistance/.test(lightCircuitClass) && /light\.penumbra\s*=\s*profile\.penumbra/.test(lightCircuitClass), "runtime light diagnostics do not retain fixture scale and soft-falloff metadata");
check("20 fixture-scaled light reach", /containedDistance\s*=\s*profile\.distance/.test(lightCircuitClass) && /this\.addRoomOmniLight\(x, omniY, z, profile\.intensity, profile\.radius/.test(lightCircuitClass), "room fixtures no longer emit from an authored radius-bounded omni source");

// 22. A lit room must be legible beyond a single bright pool. Large formal
// Chandeliers need a primary cone plus one restrained distributed-bulb fill.
// Compact fixtures remain single-emitter sources so stable full-floor lighting
// does not multiply the forward-renderer light loop for every pixel.
const grandProfile = fixtureProfile("grand");
const smallProfile = fixtureProfile("small");
const bathroomProfile = fixtureProfile("bathroom");
const corridorProfile = fixtureProfile("corridor");
check("22 lit-room chandelier coverage", grandProfile.intensity >= 85 && grandProfile.distance >= 5.6 && grandProfile.penumbra <= 0.62, "grand chandelier still lacks useful direct intensity, reach, or core width");
check("22 lit-room chandelier coverage", grandProfile.radius >= 6.4 && grandProfile.radius <= 7.4, `grand chandelier omni radius (${grandProfile.radius}m) no longer washes the formal room without spilling far beyond it`);
check("22 lit-room compact coverage", smallProfile.intensity >= 40 && smallProfile.distance >= 5.3 && smallProfile.penumbra <= 0.68, "compact room fixture remains too dim or feathered to reveal nearby furniture");
check("22 lit-room compact coverage", smallProfile.radius >= 5.8 && smallProfile.radius <= 6.8, `compact fixture omni radius (${smallProfile.radius}m) no longer covers its room wall to wall`);
check("25 stable-light performance budget", [smallProfile, bathroomProfile, corridorProfile, grandProfile].every((profile) => !Number.isFinite(profile.pointFillIntensity)), "a ceiling fixture still creates a redundant second emitter");
check("22 chandelier primary reach", grandProfile.intensity >= 85 && grandProfile.radius >= 6.4 && grandProfile.distance < fixtureProfile("atrium").distance, "grand chandelier primary emitter does not carry the former fill brightness and reach");
check("25 stable-light performance budget", !/addChandelierPointFill/.test(lightCircuitClass) && !/fixtureRole\s*=\s*"chandelier-fill"/.test(lightCircuitClass), "chandeliers still allocate a redundant cube-shadow point light");
check("22 chandelier ceiling realism", /ring\.castShadow\s*=\s*style\s*===\s*"atrium"/.test(lightCircuitClass), "single-floor chandelier ring still projects an oversized ceiling shadow from its point fill");
check("22 full blackout auxiliary lights", /allCircuitsOff\s*=\s*circuits\.length\s*>\s*0\s*&&\s*circuits\.every\(\(circuit\)\s*=>\s*!circuit\.on\)/.test(lightRendering) && /light\.intensity = light\.visible && !allCircuitsOff && interactionVisible \? light\.userData\.baseIntensity : 0/.test(lightRendering), "open cabinet or refrigerator lamps can survive a full circuit blackout");
check("22 basement corridor coverage", corridorProfile.intensity >= 110 && corridorProfile.distance >= 4.6 && corridorProfile.angle >= 0.45 && corridorProfile.penumbra <= 0.65, "basement corridor direct cones remain too narrow or weak");
check("22 basement corridor coverage", /for \(const z of \[-0\.6,\s*4\.45,\s*9\.5\]\) basementHall\.addFixture\(0,\s*z,\s*"corridor"\)/.test(lightingBuild), "the long basement corridor does not have three evenly spaced controlled fixtures");
const basementProfile = fixtureProfile("basement");
check("22 basement room readability", basementProfile.intensity >= 40 && basementProfile.radius >= 6.0 && basementProfile.angle >= 0.92 && basementProfile.penumbra <= 0.62, "basement room fixtures remain too weak, short, or narrow for readable creepy illumination");
check("22 every fixture emits real light", !/addFixture\(x, z, style, castsLight/.test(lightCircuitClass) && !/switch-owned-light-pool/.test(lightCircuitClass), "some visible ceiling fixtures still substitute a painted glow pool for real light emission");
check("22 every fixture emits real light", !/\.addFixture\([^\n;]*,\s*(?:false|x ===|z ===)/.test(lightingBuild), "one or more authored basement fixtures are still configured as a non-emitting prop");
check("22 fixture scale ordering", fixtureProfile("atrium").distance > grandProfile.distance && grandProfile.distance > smallProfile.distance && grandProfile.intensity > smallProfile.intensity, "fixture size no longer correlates with primary intensity and reach");

// 29. Omnidirectional room light. A physical chandelier or bulb radiates in
// every direction: each room fixture is a single bounded PointLight whose
// authored radius washes the room's own walls and ceiling but extinguishes
// shortly past a shared wall (near-wall bathrooms use a tighter clamp).
// Sconce pools scale up to keep parity, and the double-height foyer, stair,
// and landing volumes carry omnidirectional fills instead of downward cones.
check("29 omni fixtures", /addRoomOmniLight\(x, y, z, intensity, radius, levels\)/.test(lightCircuitClass) && /new THREE\.PointLight\(this\.color, this\.on \? intensity : 0, radius, 2\)/.test(lightCircuitClass) && /authoredReach = radius/.test(lightCircuitClass), "room fixtures are not single bounded omnidirectional emitters");
check("29 omni containment", bathroomProfile.radius <= 5.0 && [grandProfile, smallProfile, basementProfile].every((profile) => profile.radius >= 6.0 && profile.radius <= 7.0), "an omni fixture radius is unauthored or reaches deep into neighbouring rooms");
check("29 omni containment", !Number.isFinite(fixtureProfile("atrium").radius) && !Number.isFinite(corridorProfile.radius), "the atrium chandelier and narrow corridors must stay cones: an omni floods the void or the metre-wide corridor walls");
check("29 sconce parity", /intensity \* 1\.5/.test(section("addWallSconce(x, y, z", "addFixtureSupportFill", lightCircuitClass)), "sconce pools no longer keep up with omnidirectional room fixtures");
check("29 volume fills", /foyer\.addPracticalLight\(0, FLOOR\.UPPER \+ 1\.9, 7\.7, 20, 7\.8[^;\n]*contained: false/.test(lightingBuild) && /stair\.addPracticalLight\(0, FLOOR\.MAIN \+ 4\.1, -0\.35, 26, 7\.2[^;\n]*contained: false/.test(lightingBuild) && /upperLanding\.addPracticalLight\(0, FLOOR\.UPPER \+ 2\.72, -2\.15, 22, 6\.5[^;\n]*contained: false/.test(lightingBuild), "the foyer, stair, or landing volume lost its omnidirectional fill");
check("29 volume fills", /Math\.min\(distance, 7\.8\)/.test(lightCircuitClass), "interior omnidirectional practicals are no longer clamped to a room-scale bound");

// 30. Storm rain audio. The rain bed is a real CC0 recording (with license
// provenance) behind an exposure model: outdoors is full volume, a nearby
// window or open exterior door is loud, and the interior tails off to a
// muffled roof wash — driven by both gain and a lowpass so walls read as
// walls. A shaped procedural fallback keeps the storm audible when the
// recording cannot be fetched.
const mansionAudio = section("class MansionAudio", "function updateAudioButton");
check("30 recorded rain bed", fs.existsSync(path.join(root, "assets/Sounds/shared/ambience/rain-heavy-loop.mp3")) && fs.existsSync(path.join(root, "assets/Sounds/shared/licenses/rain-loopable-license.txt")), "the CC0 rain recording or its license provenance file is missing");
check("30 recorded rain bed", /Sounds\/shared\/ambience\/rain-heavy-loop\.mp3/.test(mansionAudio) && /source\.loopStart\s*=\s*0\.06/.test(mansionAudio) && /source\.loop = true/.test(mansionAudio), "the rain bed does not loop the recorded asset with encoder-padding trim");
check("30 rain fallback", /startProceduralRain/.test(mansionAudio) && /bandpass/.test(mansionAudio) && !/high\.frequency\.value = 520/.test(mansionAudio), "the offline rain fallback is missing or regressed to the old wideband static loop");
check("30 rain exposure model", /function computeRainExposure\(\)/.test(mansion) && /if \(outdoorRoomNames\.has\(state\.currentRoom\)\) return 1/.test(mansion) && /openness: 0\.6/.test(mansion) && /0\.26 \+ 0\.74 \* swing/.test(mansion), "rain exposure no longer models outdoors, glassed windows, and door swing");
check("30 rain exposure model", /audioSystem\.setRainExposure\(computeRainExposure\(\)\)/.test(updateLocation), "player movement no longer drives rain exposure");
check("30 rain occlusion", /setRainExposure\(exposure\)/.test(mansionAudio) && /muffle\.frequency\.setTargetAtTime/.test(mansionAudio) && /gain\.gain\.setTargetAtTime/.test(mansionAudio), "rain exposure does not drive both loudness and a muffle filter smoothly");
check("30 rain diagnostics", /rainDiagnostics/.test(mansionAudio) && /rain: audioSystem \? audioSystem\.rainDiagnostics\(\) : null/.test(diagnostics) && /rainApertures: rainApertures\.length/.test(diagnostics), "rain audio state is not observable in QA diagnostics");
check("35 toilet audio", /toiletFlush\(\)/.test(mansionAudio) && /high\.type\s*=\s*"highpass"/.test(mansionAudio) && /low\.type\s*=\s*"lowpass"/.test(mansionAudio) && /source\.stop\(now \+ 2\.55\)/.test(mansionAudio), "toilet flush lacks a finite filtered rush sound");
check("35 fireplace audio", /fireplace\(on\)/.test(mansionAudio) && /this\.ping\(on \? 145 : 82/.test(mansionAudio), "fireplace toggles lack a short light/extinguish sound cue");

// 31. Runtime smoothness. Static decorative meshes merge into a handful of
// draw calls per material and culling class; indoor main-floor and grounds
// lighting use separate stable shader layouts; enclosure lights occupy stable
// slots so no interaction can mint a novel count; every reachable layout is
// drawn once during boot; and the cross-floor fade retires unions promptly.
check("31 merged static decor", /function mergeStaticDecor\(\)/.test(mansion) && /buildMansion\(\);[\s\S]*?await loadEstateStatues\(\);\s*\n\s*mergeStaticDecor\(\);\s*\n\s*registerExteriorDetailCulling\(\)/.test(initSequence), "static decor is not merged between mansion build and culling registration");
check("31 merged static decor", /const skip = new Set\(\[\.\.\.occluderMeshes, \.\.\.interactableMeshes\]\)/.test(mansion) && /for \(const object of \[\.\.\.scene\.children\]\)/.test(mansion) && /object\.userData\.interaction\) continue/.test(mansion), "the decor merge can swallow occluders, interactive meshes, or animated subtrees");
check("31 merged static decor", /exteriorCullingClass/.test(mansion) && /mergedDecor: state\.mergedDecor/.test(diagnostics), "merged decor loses its exterior-culling class or QA observability");
check("31 stable light layouts", /const preclassified = object\.userData\.exteriorCullingClass/.test(mansion), "culling registration ignores pre-classified merged meshes");
check("31 fade budget", /LIGHT_FADE_OUT_RATE = 1\.35/.test(mansion), "the cross-floor fade union lingers longer than the frame budget allows");
check("31 split indoor and grounds lighting", /function getLightRenderContext\(/.test(mansion) && /outdoorRoomNames\.has\(roomLabel\) \? "grounds" : "main-interior"/.test(mansion), "main-floor lighting does not distinguish the indoor mansion from the grounds");
check("31 split indoor and grounds lighting", /function circuitRendersInContext\(/.test(mansion) && /renderContext === "grounds"\) return isExteriorCircuit/.test(mansion) && /return !isExteriorCircuit && rendersOnFloor/.test(mansion), "exterior emitters can still occupy the indoor main-floor shader layout");
check("31 startup shader safety", !/function prewarmLightingPrograms\(\)/.test(mansion) && !/prewarmLightingPrograms\(\)/.test(initSequence) && !/Warming the lamps/.test(initSequence), "startup still compiles every floor's lighting program before releasing the loading screen");
check("31 mobile startup GPU budget", /startupSafeGpuProfile/.test(mansion) && /antialias:\s*!startupSafeGpuProfile/.test(mansion) && /renderer\.shadowMap\.enabled\s*=\s*!startupSafeGpuProfile/.test(mansion) && /moonLight\.castShadow\s*=\s*renderer\.shadowMap\.enabled/.test(initSequence), "phone startup still allocates desktop antialias and shadow buffers");
check("31 WebGL context-loss recovery", /webglcontextlost/.test(mansion) && /event\.preventDefault\(\)/.test(mansion) && /showLoadFailure\("The mansion ran out of graphics memory/.test(mansion) && /if \(state\.contextLost\) return/.test(animationLoop) && /rendererContextAttributes/.test(diagnostics), "a WebGL memory loss does not stop rendering cleanly or can leave the loading screen stuck without an actionable retry");
check("31 startup diagnostics", /startupPhase:/.test(diagnostics) && /startupReadyMs:/.test(diagnostics) && /startupSafeGpuProfile:/.test(diagnostics), "startup phase, time, and safe-GPU selection are not visible to runtime QA");
check("31 global constant shader budget", /MOBILE_SHADER_SPOT_BUDGET = 6/.test(mansion) && /MOBILE_SHADER_POINT_BUDGET = 11/.test(mansion) && /const boundedCircuitBudget = true/.test(mansion), "desktop and mobile floors do not share the compact spot/point shader shape");
check("31 mobile shader padding lights", /new THREE\.SpotLight\(0x000000,\s*0,\s*0/.test(mobileShaderPadding) && /new THREE\.PointLight\(0x000000,\s*0,\s*0/.test(mobileShaderPadding) && /castShadow = false/.test(mobileShaderPadding), "zero-energy mobile padding lights are not available to stabilize the shader program");
check("31 global shader padding sync", /function syncMobileShaderPadding\(\)/.test(mobileShaderPadding) && /MOBILE_SHADER_SPOT_BUDGET - visibleSpotLights/.test(mobileShaderPadding) && /MOBILE_SHADER_POINT_BUDGET - visiblePointLights/.test(mobileShaderPadding) && /syncMobileShaderPadding\(\)/.test(lightRendering) && !/if \(!state\.mobileRenderProfile\)/.test(mobileShaderPadding), "desktop or mobile floor handoff does not pad spot and point slots to constant counts");
check("31 global shader padding diagnostics", /boundedLightProfile:\s*true/.test(diagnostics) && /shaderPaddingLights:/.test(diagnostics) && /shaderSpotBudget:\s*MOBILE_SHADER_SPOT_BUDGET/.test(diagnostics) && /shaderPointBudget:\s*MOBILE_SHADER_POINT_BUDGET/.test(diagnostics), "QA cannot observe the shared constant shader padding budget");
check("34 useful fixed light slots", /function selectBudgetedCircuitLights\(floors, renderContext\)/.test(mansion) && /MOBILE_SHADER_SPOT_BUDGET - auxiliarySpotReserve/.test(budgetedLightSelection) && /MOBILE_SHADER_POINT_BUDGET/.test(budgetedLightSelection) && /selectedLights\.add\(light\)/.test(budgetedLightSelection), "real emitters do not explicitly fill the already-paid fixed spot and point shader slots");
check("34 grounds light coverage", /renderContext === "grounds"/.test(budgetedLightSelection) && /exteriorBudgetPriority/.test(budgetedLightSelection) && /budgetPriority:\s*[0-5]/.test(yardBuild), "the grounds budget is not distributed across curated facade, garden, pool, and maze emitters");
check("34 front facade lighting", /function addFrontFacadeWallLantern\(/.test(yardBuild) && count(yardBuild, /addFrontFacadeWallLantern\(/g) === 3 && /front-facade-\$\{side\}-lantern-spotlight/.test(yardBuild), "the front facade has no fixed-budget wall lantern pools, leaving the outdoor entry elevation black");
const frontFacadeLanternBuilder = section("function addFrontFacadeWallLantern", "function buildEstateLighting", yardBuild);
check("36 softer entry lighting", /addWallSconce\(\s*x,\s*2\.12,\s*12\.19,\s*0,\s*40,\s*7\.5/.test(frontFacadeLanternBuilder) && /addPracticalLight\(0,\s*3\.05,\s*13\.35,\s*52,\s*7\.5/.test(signatureChandelierBuilders) && /onEmissiveIntensity = 0\.85/.test(signatureChandelierBuilders), "front sconces or portico chandelier do not use the softer entrance profile");
check("36 exterior glow handoff", /setGlowRenderState\(lit\)/.test(lightCircuitClass) && /material\.userData\.renderLit = renderLit/.test(lightCircuitClass) && /circuit\.setGlowRenderState\(circuit\.on && rendersInContext\)/.test(lightRendering), "decorative entrance glows do not follow the switched indoor-to-grounds handoff");
check("36 glow diagnostics", /activeLightPools:\s*circuits\.reduce[\s\S]*?material\.userData\.renderLit/.test(diagnostics) && /activeLightPools:\s*c\.glowMaterials\.filter\(\(material\) => material\.userData\.renderLit\)/.test(diagnostics), "QA cannot observe context-gated light pools");
check("34 open-volume light coverage", /OPEN_VOLUME_BUDGET_CIRCUITS/.test(mansion) && /for \(const circuitName of OPEN_VOLUME_BUDGET_CIRCUITS\)/.test(budgetedLightSelection), "unused main-floor shader slots are not reassigned to the foyer, grand stair, and upper landing");
check("34 energized slot preference", /const enclosureAvailable = \(light\)/.test(budgetedLightSelection) && /!enclosure \|\| enclosure\.open \|\| enclosure\.angle > 0\.025/.test(budgetedLightSelection) && /filter\(\(light\) => rendersOnLevel\(light\) && enclosureAvailable\(light\)\)/.test(budgetedLightSelection), "closed closet emitters can consume every useful upper-floor spot slot while zero-energy padding already stabilizes the shader type count");
check("34 grounds auxiliary slots", /light\.visible = renderContext !== "grounds"/.test(lightRendering), "inactive indoor cabinet lamps still displace useful exterior spotlights on the grounds");
check("34 low-cost context lighting", /OPEN_VOLUME_HEMISPHERE_INTENSITY/.test(mansion) && /GROUNDS_HEMISPHERE_INTENSITY/.test(mansion) && /GROUNDS_MOON_INTENSITY/.test(mansion) && /GROUNDS_EXPOSURE/.test(mansion) && /function updateContextLighting\(dt\)/.test(contextLighting) && /Math\.exp\(-CONTEXT_LIGHTING_RESPONSE \* dt\)/.test(contextLighting) && /updateContextLighting\(dt\)/.test(animationLoop) && /state\.mazeLightingContext[\s\S]*?MAZE_EXPOSURE[\s\S]*?outdoors \? GROUNDS_EXPOSURE : NIGHT_LIGHTING\.exposure/.test(stormSystem), "foyer and grounds readability is not restored with smooth, shader-count-neutral hemisphere, moon, and exposure energy");
check("35 maze fixed-budget lighting", /MAZE_LIGHT_BUDGET_FIXTURES = Object\.freeze\(\[[\s\S]*?maze-north-entrance-lamp-north[\s\S]*?maze-wayfinding-lamp-11[\s\S]*?maze-center-tall-lamp[\s\S]*?maze-rear-entrance-lamp-north[\s\S]*?maze-wayfinding-lamp-23[\s\S]*?maze-wayfinding-lamp-27[\s\S]*?\]\)/.test(mazeLayout) && /mazeBudgetPriority:\s*mazeBudgetPriority >= 0 \? mazeBudgetPriority : null/.test(yardBuild) && /sourceLight\.userData\.mazeBudgetPriority/.test(yardBuild), "maze lights are not distributed from both entrances through the full route inside the existing six-spot budget");
check("35 maze fixed-budget lighting", /if \(state\.mazeLightingContext\)/.test(budgetedLightSelection) && /filter\(\(light\) => Number\.isFinite\(light\.userData\.mazeBudgetPriority\)\)/.test(budgetedLightSelection) && /for \(const light of mazeCandidates\) trySelect\(light, groundsSpotLimit, groundsPointLimit\)/.test(budgetedLightSelection), "maze context does not reassign the six already-paid grounds spot slots to maze lamps");
check("35 maze shader-neutral lift", /MAZE_HEMISPHERE_INTENSITY = 0\.41/.test(mansion) && /MAZE_MOON_INTENSITY = 0\.60/.test(mansion) && /MAZE_EXPOSURE = 1\.0/.test(mansion) && /mazeContext \? MAZE_HEMISPHERE_INTENSITY : GROUNDS_HEMISPHERE_INTENSITY/.test(contextLighting) && /mazeContext \? MAZE_MOON_INTENSITY : GROUNDS_MOON_INTENSITY/.test(contextLighting), "maze readability does not use the existing ambient uniforms and exposure path");
check("35 maze boundary sync", /function isMazeLightingContext\(/.test(mansion) && /roomLabel !== "EAST LAWN" && roomLabel !== "REAR LAWN"/.test(mansion) && /previousMazeLightingContext/.test(updateLocation) && /mazeLightingContextChanged/.test(updateLocation) && /else if \(mazeLightingContextChanged\) syncLightRendering\(\)/.test(updateLocation), "entering or leaving either maze approach does not refresh the fixed light selection once at the boundary");
check("35 maze diagnostics", /mazeLightingContext:\s*state\.mazeLightingContext/.test(diagnostics), "QA cannot confirm whether the maze-specific fixed-budget selection is active");
check("34 lighting balance diagnostics", /shaderRealSpotLights:/.test(diagnostics) && /shaderRealPointLights:/.test(diagnostics) && /hemisphereTarget:/.test(diagnostics) && /moonTarget:/.test(diagnostics), "QA cannot prove that real emitters replaced padding or that context lighting settled to its target");
check("31 stable shadow shader", /boundedCircuitBudget && light\.castShadow/.test(lightRendering) && /light\.userData\.authoredCastShadow = true/.test(lightRendering) && /light\.castShadow = false/.test(lightRendering), "floor-local shadow spots can still change the shader shape at the upper stair");
check("31 raw frame diagnostics", /const rawDt = clock\.getDelta\(\)/.test(mansion) && /state\.frameTime = rawDt \* 1000/.test(mansion) && /fpsElapsed \+= rawDt/.test(mansion), "FPS diagnostics still hide slow frames behind the simulation delta clamp");
check("31 inactive preview budget", /const PRE_ENTRY_FRAME_INTERVAL_MS = 250/.test(mansion) && /!state\.started && !state\.qa/.test(animationLoop) && /frameNow - lastAnimationFrameAt < targetFrameInterval/.test(animationLoop), "the unopened mansion still renders at full refresh and can monopolize the surrounding website");
check("31 balanced frame budget", /const BALANCED_FRAME_INTERVAL_MS = 1000 \/ 30/.test(mansion) && /state\.mobileRenderProfile \|\| state\.renderQuality === "reduced"/.test(animationLoop), "mobile and reduced-quality sessions do not cap the expensive render loop at 30 FPS");
check("31 hidden tab pause", /document\.hidden/.test(animationLoop) && /clock\.getDelta\(\)/.test(animationLoop) && /return;/.test(animationLoop), "the mansion keeps updating and rendering while its tab is hidden");
check("31 render schedule diagnostics", /frameSchedule:/.test(diagnostics) && /targetFps:/.test(diagnostics), "QA cannot observe whether the runtime is idle-throttled, balanced, or full-refresh");
check("31 hidden diagnostics budget", /dom\.debug\s*&&\s*!dom\.debug\.hidden/.test(animationLoop), "normal play still serializes the full diagnostic payload into a hidden DOM node every half second");

check("20 shadow sampler fallback", /supportsFullRoomShadowSet\s*=\s*renderer\.shadowMap\.enabled\s*&&\s*renderer\.capabilities\.maxTextures\s*>=\s*16/.test(mansion) && /maxTextureUnits/.test(diagnostics) && /activeSceneShadowLights/.test(diagnostics), "low-sampler or safe-GPU contexts have no bounded-cone fallback or total-scene shadow diagnostics");
check("20 stable light rendering", !/portalCircuitNames|getExteriorPortalCircuitNames/.test(mansion), "proximity-selected portal circuits can still make manually switched lights pop while crossing the yard threshold");
check("20 stable light rendering", /circuitRendersInContext\(circuit, floors, renderContext\)/.test(lightRendering) && /manual-circuits-context-stable/.test(lightRendering), "authored light contexts do not use the stable split render policy");
check("20 movement-stable light rendering", !/lightWithinStableResidency|lightResidencyPosition|residencyPadding|residencyHysteresis/.test(mansion) && !/physics\.playerPosition\(\)/.test(lightRendering), "player position can still hide real light energy while a circuit remains on");
check("20 movement-stable light rendering", /nextVisible\s*=\s*rendersInContext\s*&&\s*rendersOnLevel/.test(lightRendering) && /circuit\.on && enclosureOpen/.test(lightRendering), "normal circuit lights are not kept stable for the complete authored floor context with enclosure-gated energy");
check("20 auxiliary interior lighting", /for \(const light of auxiliaryInteriorLights\)/.test(lightRendering) && /interactionVisible/.test(lightRendering) && /light\.visible = renderContext !== "grounds"/.test(lightRendering), "door-operated cabinet lights are not stable indoors or still displace useful grounds emitters");
check("20 stable light rendering", !/ownerRoom|rendersInOwnerRoom/.test(lightRendering), "room-name proximity gating can still hide a lit closet or room light while the player moves");
check("20 exterior light containment", /addPracticalLight\(0,\s*3\.05,\s*13\.35,[\s\S]*?contained:\s*true,[\s\S]*?angle:\s*0\.62/.test(signatureChandelierBuilders) && /addRearFacadeWallLantern\([\s\S]*?addWallSconce\([\s\S]*?-14\.15/.test(yardBuild), "front or rear facade fixtures can project through the mansion shell");
check("20 manual light state", !/\.setState\(|\.toggle\(/.test(updateLocation + exteriorCulling + lightRendering), "room or exterior transitions mutate a light circuit without a switch interaction");
check("20 lightning containment", /outdoorRoomNames\.has\(state\.currentRoom\)/.test(stormSystem) && /this\.light\.intensity\s*=\s*outdoors\s*\?\s*lightning \* 11\s*:\s*0/.test(stormSystem), "the unshadowed lightning key can still pass through interior walls");
check("20 real fixture emission", /this\.addContainedSpotLight\(/.test(section("addFixture(x, z, style", "addContainedSpotLight(x, y", lightCircuitClass)), "visible fixtures are not backed by real contained lights");
check("20 maze lamp sources", /maze-center-tall-lamp/.test(yardBuild), "hedge maze has no visible tall center lamp");
check("20 maze lamp sources", /mazeLampSources/.test(yardBuild) && /mazeWayfindingCells/.test(yardBuild) && /mazeCornerCells/.test(yardBuild), "maze boundary, corner, or mapped wayfinding lamps are missing real light sources");
check("32 maze lamp coverage", count(section("const mazeWayfindingCells", "const mazeLampSources", yardBuild), /role:\s*"wayfinding"/g) === 6 && count(section("const mazeWayfindingCells", "const mazeLampSources", yardBuild), /role:\s*"center"/g) === 1, "maze lacks seven evenly distributed interior wayfinding fixtures");
const mazeFixtureCells = Array.from(section("const mazeWayfindingCells", "const mazeLampSources", yardBuild).matchAll(/\{ row:\s*(\d+),\s*col:\s*(\d+),\s*targetRow:\s*(\d+),\s*targetCol:\s*(\d+)/g), (match) => match.slice(1).map(Number));
check("32 maze lamp clearance", mazeFixtureCells.length === 7 && mazeFixtureCells.every(([row, col, targetRow, targetCol]) => mazeRows[row]?.[col] === "#" && mazeRows[targetRow]?.[targetCol] !== "#"), "one or more interior lamp posts still occupy a walkable maze cell");
check("32 maze lamp clearance", !/lampRow|lampColumn/.test(section("function solveHedgeMaze", "function buildMazeRouteActions", yardBuild)), "maze solver still needs a special-case detour around path-blocking lamp furniture");
const cornerLampBlock = section("const mazeCornerCells", "const mazeLampSources", yardBuild);
for (const name of ["maze-north-west-corner-lamp", "maze-north-east-corner-lamp", "maze-south-west-corner-lamp", "maze-south-east-corner-lamp"]) {
  check("33 maze corner lamps", cornerLampBlock.includes(name), `missing ${name}`);
}
check("33 maze corner lamps", count(cornerLampBlock, /role:\s*"corner"/g) === 4 && /\{ row:\s*0,\s*col:\s*0/.test(cornerLampBlock) && /\{ row:\s*0,\s*col:\s*8/.test(cornerLampBlock) && /\{ row:\s*30,\s*col:\s*0/.test(cornerLampBlock) && /\{ row:\s*30,\s*col:\s*8/.test(cornerLampBlock), "all four outer maze corners do not own a lamp");
check("33 maze corner lamps", !/role:\s*"exit"/.test(yardBuild) && !/mazeExitCell/.test(yardBuild), "former south-exit lamps still exist");
check("20 maze lamp sources", /role:\s*"entrance"/.test(yardBuild) && /role:\s*"center"/.test(yardBuild) && /role:\s*"wayfinding"/.test(yardBuild) && /role:\s*"corner"/.test(yardBuild), "maze sources do not identify entrance, wayfinding, center, and corner fixtures");
check("20 maze lamp sources", /contained:\s*true,[\s\S]*?castsLight:\s*true/.test(section("mazeWayfindingCells\.map", "}\),", yardBuild)), "maze fixtures do not use bounded downward light cones");
check("20 maze lamp sources", /sourceLight\.userData\.mazeSource/.test(yardBuild) && /renderedLightSources:\s*renderedMazeSources/.test(yardBuild), "diagnostics do not enumerate the seventeen actual rendered maze lights");
check("32 maze lamp aiming", /Number\.isFinite\(settings\.targetX\)/.test(yardBuild) && /circuit\.addAimedSpotLight\(/.test(yardBuild) && count(section("const mazeWayfindingCells", "const mazeLampSources", yardBuild), /targetRow:/g) === 7, "maze lamps do not retain authored targets across all seven interior route sections");
check("32 maze lamp coverage", /settings\.downward[\s\S]*?circuit\.addContainedSpotLight\(/.test(yardBuild) && /downward:\s*true/.test(section("mazeWayfindingCells\.map", "}\),", yardBuild)), "interior maze lamps do not cast overlapping broad downward pools");
const mazeEntranceLampBlock = section("const mazeEntranceLampSources", "const mazeOuterPathCells", yardBuild);
check("35 matching entrance lamps", /for \(const portal of HEDGE_MAZE_PORTALS\)/.test(mazeEntranceLampBlock) && /for \(const offsetZ of \[-1\.3, 1\.3\]\)/.test(mazeEntranceLampBlock), "both portals do not receive the same paired lamp layout");
check("35 brighter entrance lamps", /height:\s*3\.75,[\s\S]*?intensity:\s*300,[\s\S]*?distance:\s*12\.8,[\s\S]*?angle:\s*1\.08,[\s\S]*?downward:\s*true/.test(mazeEntranceLampBlock), "maze entrance lamps are not using the brighter broad-pool profile");
const outerPathLampBlock = section("const mazeOuterPathCells", "const mazeLampSources", yardBuild);
check("35 outer-path lighting", count(outerPathLampBlock, /role:\s*"outer-path"/g) === 2 && /row:\s*11,\s*col:\s*0/.test(outerPathLampBlock) && /row:\s*15,\s*col:\s*0/.test(outerPathLampBlock), "west outer pathway lacks two evenly spaced real lamp sources");
check("35 outer-path lighting", /height:\s*3\.75,[\s\S]*?intensity:\s*285,[\s\S]*?distance:\s*12\.5,[\s\S]*?angle:\s*1\.08/.test(outerPathLampBlock), "outer-path lamps are too weak or narrow to bridge the entrance pools");
check("35 brighter maze lights", /source\.role === "center" \? 4\.35 : 3\.75/.test(yardBuild) && /source\.role === "center" \? 420 : 300/.test(yardBuild) && /source\.role === "center" \? 13\.2 : 12\.6/.test(yardBuild), "interior maze lamps did not receive the brighter center/wayfinding hierarchy");
check("33 maze corner lamp match", /height:\s*4\.35,[\s\S]*?intensity:\s*420,[\s\S]*?distance:\s*13\.2,[\s\S]*?angle:\s*1\.1,[\s\S]*?downward:\s*true/.test(section("mazeCornerCells\.map", "}\),", yardBuild)), "corner lamps do not match the center lamp height, brightness, reach, and cone");
check("20 maze light budget", count(section("const mazeWayfindingCells", "const mazeLampSources", yardBuild), /castsShadow:\s*true/g) === 1, "only the tall center maze lamp may spend a shadow map");
check("20 maze light occlusion", /hedge-maze-walls[\s\S]*?true,\s*true\)/.test(yardBuild), "maze hedge walls do not cast shadows from the authored lamps");
check("20 maze light occlusion", !/addPracticalLight\(25,\s*2\.(?:05|15),\s*-2(?:5|31)/.test(yardBuild), "source-less hidden PointLights remain in the hedge maze");
check("20 maze route cold-start", /yardMazeSolution:[\s\S]*?startDelayMs:\s*1400/.test(qaHooks) && /route\.startDelayMs == null/.test(qaHooks), "maze QA route does not wait for cold outdoor shader compilation before movement");
check("20 maze route timing", /HEDGE_MAZE_LAYOUT\.cellSize \/ PLAYER\.speed\) \* 1\.06/.test(mansion), "expanded maze route lacks the measured fixed-step allowance needed to center its turns");

// 21. The mansion's cryptic art collection must be real generated textures,
// assigned deterministically to every existing frame, with the old primitive
// ancestor preserved only as a resilient missing-file fallback.
const expectedPortraitFiles = [
  "portrait-patron-empty-plates-v1-ai.jpg",
  "portrait-generosity-engine-v1-ai.jpg",
  "portrait-infinite-giveaway-diptych-v1-ai.jpg",
  "portrait-feast-of-merit-v1-ai.jpg",
  "portrait-garden-good-deeds-v1-ai.jpg",
  "portrait-audit-of-souls-v1-ai.jpg",
  "portrait-banquet-forgot-guests-v1-ai.jpg",
  "portrait-last-applause-v1-ai.jpg",
  "portrait-orchard-porcelain-teeth-v1-ai.jpg",
  "portrait-house-dreams-back-v1-ai.jpg",
];
const expectedPaintingFiles = [
  "painting-work-in-progress-dreaming-v1-ai.jpg",
  "painting-choir-floorboards-v1-ai.jpg",
  "painting-polite-eclipse-v1-ai.jpg",
  "painting-five-doors-v1-ai.jpg",
  "painting-garden-knees-v1-ai.jpg",
  "painting-moths-guests-v1-ai.jpg",
  "painting-arrived-early-v1-ai.jpg",
];
const expectedArtworkFiles = [
  ...expectedPortraitFiles.map((filename) => `portraits/${filename}`),
  ...expectedPaintingFiles.map((filename) => `paintings/${filename}`),
];
const newPortraitIds = ["banquet-forgot-guests", "last-applause", "orchard-porcelain-teeth", "house-dreams-back"];
const paintingRoomWallArtIds = ["choir-floorboards", "polite-eclipse", "five-doors", "garden-knees", "moths-guests", "arrived-early"];
const paintingRoomArtworkIds = ["work-in-progress-dreaming", ...paintingRoomWallArtIds];
check("21 generated portrait collection", count(portraitManifest, /file:\s*"(?:portraits\/portrait|paintings\/painting)-[^"]+-v1-ai\.jpg"/g) === 17, "artwork manifest does not expose all seventeen immutable generated artwork files");
check("21 generated portrait collection", count(portraitFurnishings, /artId:\s*"[^"]+"/g) === 19, "all nineteen mansion picture frames are not assigned a stable generated art ID");
for (const artId of newPortraitIds) {
  check("23 non-host painting collection", portraitManifest.includes(`"${artId}"`) && portraitFurnishings.includes(`artId: "${artId}"`), `${artId} is not registered and placed in the mansion`);
}
check("23 non-host painting collection", newPortraitIds.every((artId) => upperGalleryPortraits.includes(`artId: "${artId}"`)), "all four new non-host paintings are not visible in the upper gallery");
check("23 non-host painting collection", !/artId:\s*"(?:patron-empty-plates|feast-of-merit)"/.test(upperGalleryPortraits), "the upper gallery still repeats a Mr. Feast or host-centered portrait");
check("23 non-host painting collection", mainGalleryPortraits.includes('artId: "last-applause"') && !mainGalleryPortraits.includes('artId: "patron-empty-plates"'), "the main gallery still repeats the drawing-room Mr. Feast portrait");
for (const view of ["mainGalleryLastApplause", "upperArtHouseDreams", "upperArtBanquet", "upperArtOrchard", "upperArtLastApplause"]) {
  check("23 painting QA views", mansion.includes(`${view}:`), `missing head-on painting inspection view ${view}`);
}
check("21 generated portrait loader", /function loadArtworkTexture/.test(mansion) && /ClampToEdgeWrapping/.test(portraitBuilder) && /THREE\.sRGBEncoding/.test(portraitBuilder) && !/RepeatWrapping/.test(portraitBuilder), "artwork textures are not loaded as clamped sRGB paintings");
check("21 generated portrait loader", /portrait-art-\$\{artId\}/.test(portraitBuilder) && /if \(!artTexture\)/.test(portraitBuilder), "generated art lacks stable scene names or procedural fallback gating");
check("21 generated portrait diptych", /repeatX:\s*0\.5,\s*offsetX:\s*0/.test(portraitFurnishings) && /repeatX:\s*0\.5,\s*offsetX:\s*0\.5/.test(portraitFurnishings), "ballroom diptych halves are not mapped to complementary frames");
check("21 switch-owned portrait visibility", count(portraitFurnishings, /circuitName:\s*"[^"]+"/g) === 19 && /function bindPortraitMaterialsToLighting/.test(mansion) && /circuit\.glowMaterials\.push\(placement\.material\)/.test(mansion), "portrait readability is not owned by the same manual light switches as its room");
check("23 painting readability", /onEmissiveIntensity\s*=\s*0\.48/.test(portraitBuilder) && /offEmissiveIntensity\s*=\s*0/.test(portraitBuilder) && /circuit\.on\s*\?\s*0\.48\s*:\s*0/.test(portraitBuilder), "lit paintings are not gently readable while preserving a true zero-emissive lights-off state");
for (const relativeFile of expectedArtworkFiles) {
  const fullPath = path.join(root, "assets/textures/mr-feast/generated", relativeFile);
  const filename = path.basename(relativeFile);
  check("21 generated portrait assets", fs.existsSync(fullPath), `missing generated artwork ${relativeFile}`);
  if (fs.existsSync(fullPath)) {
    const bytes = fs.readFileSync(fullPath);
    check("21 generated portrait assets", bytes[0] === 0xff && bytes[1] === 0xd8, `${relativeFile} is not a JPEG runtime texture`);
    check("21 generated portrait assets", bytes.length <= 550 * 1024, `${relativeFile} exceeds the 550 KB artwork texture budget`);
    if (newPortraitIds.some((artId) => filename.includes(artId))) {
      const dimensions = jpegDimensions(bytes);
      check("23 non-host painting assets", dimensions?.width === 768 && dimensions?.height === 1152, `${filename} must be a 768x1152 portrait texture`);
    }
    if (expectedPaintingFiles.includes(filename)) {
      const dimensions = jpegDimensions(bytes);
      const landscape = filename === "painting-five-doors-v1-ai.jpg";
      check("33 painting-room generated art", dimensions?.width === (landscape ? 1152 : 768) && dimensions?.height === (landscape ? 768 : 1152), `${filename} has the wrong authored dimensions`);
    }
  }
}

// 24. The July layout/lighting pass removes two misleading transitional
// spaces, makes every renamed room internally consistent, and keeps manually
// switched light state visually stable while crossing room and yard zones.
check("24 room naming", !lightingMap.includes('"DRAWING ROOM"') && !roomZones.includes('"DRAWING ROOM"') && !/new LightCircuit\(\s*"drawing room lights"/.test(lightingBuild), "legacy DRAWING ROOM mapping, zone, or circuit remains");
check("24 room naming", !lightingMap.includes('"BEDROOM CORRIDOR"') && !roomZones.includes('"BEDROOM CORRIDOR"') && !/new LightCircuit\(\s*"bedroom corridor lights"/.test(lightingBuild), "legacy BEDROOM CORRIDOR mapping, zone, or circuit remains");
check("24 room naming", /"MUSIC ROOM"\s*:\s*\[\s*"music room lights"\s*\]/.test(lightingMap) && roomZones.includes('"MUSIC ROOM"') && /new LightCircuit\(\s*"music room lights"/.test(lightingBuild) && /music\.addSwitch\(/.test(lightingBuild), "renamed MUSIC ROOM is not fully mapped to a manually controlled circuit");
check("24 room naming", /"PAINTING ROOM"\s*:\s*\[\s*"painting room lights"\s*\]/.test(lightingMap) && roomZones.includes('"PAINTING ROOM"') && /new LightCircuit\(\s*"painting room lights"/.test(lightingBuild) && /painting\.addSwitch\(/.test(lightingBuild), "PAINTING ROOM is not fully mapped to a manually controlled circuit");

check("24 painting-room stair door", mainEastFrontSpine.length > 0 && /center:\s*0,\s*width:\s*1\.35,\s*label:\s*"stair painting door"/.test(mainEastFrontSpine) && /center:\s*7\.3\b/.test(mainEastFrontSpine), "painting room lost its direct grand-stair door, or the music-room doorway was lost");
check("24 sealed painting-room stair walls", serviceShaftWall.length > 0 && /openings:\s*\[\s*\]/s.test(serviceShaftWall) && !/kind:\s*"(?:arch|door|open)"/.test(serviceShaftWall), "painting room still opens through its east wall into the service stair");

for (const [label, pattern] of [
  ["primary", /\[-15,\s*-5,\s*-12,\s*-3\.2,\s*"PRIMARY SUITE"\]/],
  ["rear lounge", /\[-5,\s*5,\s*-12,\s*-3\.2,\s*"REAR LOUNGE"\]/],
  ["east rear", /\[5,\s*15,\s*-12,\s*-3\.2,\s*"EAST REAR SUITE"\]/],
]) {
  check("24 rear lounge zoning", pattern.test(roomZones), `${label} does not own the intended upper-rear zone`);
}
check("24 rear lounge naming", !lightingMap.includes('"WEST REAR SUITE"') && !roomZones.includes('"WEST REAR SUITE"') && !/west rear suite lights/.test(lightingBuild), "the former west-rear naming remains after its promotion to Primary Suite");
check("24 rear lounge naming", /"PRIMARY SUITE"\s*:\s*\["primary suite lights",\s*"primary walk-in closet light"\]/.test(lightingMap) && /"REAR LOUNGE"\s*:\s*\["rear lounge lights"\]/.test(lightingMap), "Primary Suite or Rear Lounge is not mapped to its renamed lighting");
check("24 open rear lounge", !/fixed:\s*-3\.2,\s*start:\s*-5,\s*end:\s*5/.test(upperPartitions), "a wall still closes the rear lounge off from the stair landing");
check("24 private rear suites", /label:\s*"primary bathroom door"/.test(primaryFrontWall) && /openings:\s*\[\s*\]/s.test(eastRearFrontWall), "primary suite lost its en-suite bathroom door, or the east rear suite front wall is no longer sealed");
check("24 lounge suite doors", /center:\s*-6\.4[^\n]*primary suite lounge door/.test(westRearSpine) && /center:\s*-6\.4[^\n]*east rear suite lounge door/.test(eastRearSpine), "both rear suites do not have direct doors into the lounge");
check("24 lounge picture windows", /const rearLoungeWindows\s*=\s*\[[\s\S]*?center:\s*-2\.3,\s*width:\s*3\.7,\s*bottom:\s*0\.38,\s*top:\s*2\.92[\s\S]*?center:\s*2\.3,\s*width:\s*3\.7,\s*bottom:\s*0\.38,\s*top:\s*2\.92/.test(exteriorWalls), "rear lounge does not have the two enlarged backyard picture windows");
check("24 rear lounge furnishings", /addRug\(0,\s*-8\.35[^;]*M\.exoticRug[\s\S]*?addSofa\(0,\s*-6\.45[\s\S]*?addTable\(0,\s*-8\.25/.test(upperFurnishings) && !/addBed\(0\.3,\s*-10\.1/.test(upperFurnishings), "rear lounge is not furnished with its exotic rug and open sitting area, or still contains the former bed");
check("24 rear lounge rug overlap", !/addRug\(0,\s*-8\.1,\s*4\.1,\s*4\.6,\s*FLOOR\.UPPER/.test(slabs), "legacy red lounge rug still overlaps the furnished rug and causes z-fighting");
check("24 rear lounge rug overlap", count(`${slabs}\n${upperFurnishings}`, /addRug\(0,\s*-8\.(?:1|35)/g) === 1, "rear lounge must have exactly one rug surface");
check("24 exotic lounge rug", /createLinearGradient|createRadialGradient/.test(exoticRugTextureBuilder) && /medallion|arabesque|ornament/.test(exoticRugTextureBuilder), "exotic lounge rug lacks a layered woven ornamental pattern");
check("24 exotic lounge rug", /const exoticRugMap\s*=\s*makeExoticRugTexture\(512\)/.test(materialFactory) && /exoticRug:\s*new THREE\.MeshStandardMaterial\(\{\s*map:\s*exoticRugMap/.test(materialFactory), "exotic lounge rug material is missing or does not use the procedural textile map");
check("32 ornate foyer rug", /createLinearGradient|createRadialGradient/.test(foyerRugTextureBuilder) && /rosette|palmette|medallion|ornament/.test(foyerRugTextureBuilder), "foyer rug lacks a layered ceremonial textile pattern");
check("32 ornate foyer rug", /const foyerRugMap\s*=\s*makeFoyerRugTexture\(512\)/.test(materialFactory) && /foyerRug:\s*new THREE\.MeshStandardMaterial\(\{\s*map:\s*foyerRugMap/.test(materialFactory), "foyer rug material is missing or does not use its procedural textile map");
check("32 ornate foyer rug", /addRug\(0,\s*8\.0,\s*4\.4,\s*5\.2,\s*FLOOR\.MAIN,\s*M\.foyerRug,\s*0\)/.test(slabs), "main foyer still uses a flat rug material instead of the ornate foyer carpet");
check("37 ominous foyer rug", /drawEclipsedMedallion/.test(foyerRugTextureBuilder) && /i < 17/.test(foyerRugTextureBuilder) && /i < 7/.test(foyerRugTextureBuilder) && /#050307/.test(foyerRugTextureBuilder) && /ceremonial trap/.test(foyerRugTextureBuilder), "foyer rug lost its eccentric eclipsed-eye motif or near-black mourning palette");
check("37 centered foyer eye", /drawEye\(x,\s*y,\s*radius \* 0\.92,\s*radius \* 0\.34,\s*0,\s*"#235c54"\)/.test(foyerRugTextureBuilder), "the dominant foyer eye is offset from the rug medallion center");
check("34 patterned salon rugs", /createLinearGradient|createRadialGradient/.test(salonRugTextureBuilder) && /medallion|ornament|botanical/.test(salonRugTextureBuilder), "library and music-room carpets lack a layered ornamental textile pattern");
check("34 patterned salon rugs", /const libraryRugMap\s*=\s*makeSalonRugTexture\(512,\s*"library"\)/.test(materialFactory) && /const musicRugMap\s*=\s*makeSalonRugTexture\(512,\s*"music"\)/.test(materialFactory), "library and music-room procedural carpet maps are missing");
check("34 patterned salon rugs", /libraryRug:\s*new THREE\.MeshStandardMaterial\(\{\s*map:\s*libraryRugMap/.test(materialFactory) && /musicRug:\s*new THREE\.MeshStandardMaterial\(\{\s*map:\s*musicRugMap/.test(materialFactory), "library or music-room patterned carpet material is missing");
check("34 patterned salon rugs", /addRug\(-9\.5,\s*7\.6,\s*6\.4,\s*4\.8,\s*FLOOR\.MAIN,\s*M\.libraryRug,\s*0\)/.test(slabs) && /addRug\(9\.4,\s*7\.7,\s*6\.2,\s*4\.6,\s*FLOOR\.MAIN,\s*M\.musicRug,\s*0\)/.test(slabs), "library or music room still uses a flat-color carpet");

const upperPortraitCount = count(upperGalleryPortraits, /artId:\s*"[^"]+"/g);
const portraitsUseNewWall = /addWallPortrait\(\{\s*axis:\s*"x",\s*fixed:\s*-3\.2/.test(upperGalleryPortraits)
  && count(upperGalleryPortraits, /addWallPortrait\(\{\s*axis:\s*"z"/g) === 2;
check("24 upper-suite paintings", upperPortraitCount === 6 && portraitsUseNewWall && !/fixed:\s*-4\.9\b/.test(upperFurnishings), "six upper paintings were not redistributed across the private-suite and lounge walls");
for (const circuitName of ["primary suite lights", "rear lounge lights", "east rear suite lights"]) {
  check("24 upper-suite paintings", count(upperGalleryPortraits, new RegExp(`circuitName:\\s*"${circuitName}"`, "g")) === 2, `${circuitName} does not own exactly two upper-suite portraits`);
}
check("24 upper-suite paintings", !/bedroom corridor lights/.test(upperGalleryPortraits), "upper paintings still depend on the removed corridor circuit");

check("24 painting room furnishings", /\baddPaintingStudio\(/.test(paintingRoomFurnishings), "Painting Room does not invoke a dedicated studio furnishing builder");
for (const stableName of ["painting-room-easel", "painting-room-chair", "painting-room-palette", "painting-room-brush", "painting-room-paint"]) {
  check("24 painting room furnishings", mansion.includes(stableName), `Painting Room is missing stable scene object ${stableName}`);
}
check("24 painting room furnishings", !/\badd(?:Piano|Sofa)\(/.test(paintingRoomFurnishings), "Painting Room still contains its former piano or sofa");

// 33. The Painting Room becomes a believable working atelier. The easel is a
// connected, tilted A/H-frame; its unfinished canvas and six-wall collection
// use real generated art; and the three-door circulation aisle stays open.
for (const artId of paintingRoomArtworkIds) {
  check("33 painting-room generated art", portraitManifest.includes(`"${artId}"`), `Painting Room artwork ${artId} is missing from the immutable manifest`);
}
check("33 easel rotation support", /rotationX\s*=\s*0/.test(boxBuilder) && /rotationZ\s*=\s*0/.test(boxBuilder) && /mesh\.rotation\.set\(rotationX,\s*rotationY,\s*rotationZ\)/.test(boxBuilder), "box geometry still ignores the easel's X/Z support angles");
for (const stableName of [
  "painting-room-easel-front-leg", "painting-room-easel-rear-leg", "painting-room-easel-mast",
  "painting-room-easel-tray", "painting-room-easel-upper-clamp", "painting-room-easel-canvas-back",
  "painting-room-easel-stretcher-horizontal", "painting-room-easel-stretcher-vertical", "painting-room-easel-art",
]) {
  check("33 connected realistic easel", paintingStudioBuilder.includes(stableName), `realistic easel is missing ${stableName}`);
}
check("33 connected realistic easel", /canvasMount\.rotation\.x\s*=\s*-0\.07/.test(paintingStudioBuilder) && /z:\s*0\.04[0-9]/.test(paintingStudioBuilder), "canvas assembly is not gently tilted with a non-z-fighting artwork face");
check("33 connected realistic easel", /painting-room-easel-rear-leg[\s\S]*?z:\s*-0\.32[\s\S]*?rotationX:\s*0\.32/.test(paintingStudioBuilder), "rear kickstand is not behind and angled away from the painted face");
check("33 unfinished easel canvas", /const artId\s*=\s*"work-in-progress-dreaming"/.test(paintingStudioBuilder) && /painting-room-unfinished-linen/.test(paintingStudioBuilder) && !/painting-room-canvas-paint-daub/.test(paintingStudioBuilder), "easel does not use the generated unfinished artwork with restrained dimensional paint detail");
for (const artId of paintingRoomWallArtIds) {
  check("33 painting-room wall collection", paintingRoomFurnishings.includes(`artId: "${artId}"`), `Painting Room does not hang ${artId}`);
}
check("33 painting-room wall collection", count(paintingRoomFurnishings, /artId:\s*"(?:choir-floorboards|polite-eclipse|five-doors|garden-knees|moths-guests|arrived-early)"/g) === 6 && count(paintingRoomFurnishings, /circuitName:\s*"painting room lights"/g) === 6 && count(paintingRoomFurnishings, /addWallPortrait\(/g) === 1, "Painting Room must hang exactly six switch-owned wall artworks");
check("33 painting-room clear aisle", /const chairX\s*=\s*x\s*-\s*0\.35/.test(paintingStudioBuilder) && /const chairZ\s*=\s*z\s*-\s*1\.25/.test(paintingStudioBuilder) && /addChair\(chairX,\s*chairZ[\s\S]*?faceTargetYaw/.test(paintingStudioBuilder) && /addTable\(x\s*\+\s*0\.2,\s*z\s*-\s*2\.85/.test(paintingStudioBuilder), "chair or paint cart remains in the three-door circulation aisle");
for (const view of ["paintingRoomOverview", "paintingRoomEaselFront", "paintingRoomEaselRear", "paintingRoomWestArt", "paintingRoomEastArt", "paintingRoomNorthArt", "paintingRoomSouthArt"]) {
  check("33 painting-room QA views", mansion.includes(`${view}:`), `missing Painting Room inspection view ${view}`);
}
for (const route of ["paintingSouthToMusic", "paintingWestEntry", "paintingEaselCollision"]) {
  check("33 painting-room QA routes", qaHooks.includes(`${route}:`), `missing Painting Room physical QA route ${route}`);
}
check("24 music room furnishings", /\baddPiano\(/.test(musicRoomFurnishings) && /\baddSofa\(/.test(musicRoomFurnishings), "Music Room does not retain both its piano and couch");
check("24 music room furnishings", /musicPiano/i.test(musicRoomFurnishings) && /musicSofa/i.test(musicRoomFurnishings) && /(?:faceTargetYaw|yawToward|Math\.atan2)\s*\(/.test(musicRoomFurnishings), "Music Room couch lacks an explicit face-target relationship to the piano");
check("47 music-room piano clearance", /const musicPiano\s*=\s*\{\s*x:\s*11\.2,\s*z:\s*5\.85\s*\}/.test(musicRoomFurnishings), "Music Room piano has not been pulled slightly north from the south wall");
check("47 rotated table collider", /physics\.addFixedBox\(x,\s*floorY \+ 0\.42,\s*z,\s*width,\s*0\.84,\s*depth,\s*rotationY \|\| 0\)/.test(tableBuilder), "rotated tables still use an oversized axis-aligned collider");
check("47 music-room table clearance route", /musicTableWestClearance:\s*\[8\.05,\s*FLOOR\.MAIN,\s*6\.15,\s*Math\.PI\]/.test(qaRoomViews) && /musicTableWestClearance:\s*\{[\s\S]*?start:\s*"musicTableWestClearance"/.test(qaHooks), "Music Room lacks deterministic physical QA through the table collider's former invisible corner");
check("48 rotated sofa collider", /physics\.addFixedBox\(x,\s*floorY \+ colliderHeight \/ 2,\s*z,\s*w,\s*colliderHeight,\s*0\.9,\s*rotationY \|\| 0\)/.test(sofaBuilder), "rotated sofas still use an oversized axis-aligned collider");
check("48 music-room couch-table aisle", /musicTableWestClearance:\s*\{[\s\S]*?actions:\s*\[\{\s*yaw:\s*Math\.PI,\s*seconds:\s*3\.0\s*\}\][\s\S]*?minZ:\s*8\.0[\s\S]*?maxZ:\s*9\.3/.test(qaHooks), "Music Room route does not prove the full aisle between the couch and table is clear");
check("49 dossier Tab binding", /event\.code === "Tab"[\s\S]*?contestant13Quest\.toggleJournal\(\)/.test(mansion) && !/event\.code === "KeyI"|event\.code === "KeyJ"/.test(mansion), "inventory dossier is not exclusively bound to Tab");
check("49 discovery-first HUD", !/Search the Library shelves for a book that does not quite belong\./i.test(page) && /dom\.caseFile\.hidden\s*=\s*!state\.started\s*\|\|\s*!this\.story\.bookRead/.test(contestant13Quest), "fresh play still exposes the left-side Library direction");
check("50 illustrated dossier", /itemIcons:\s*Object\.freeze/.test(contestant13Config) && /function itemIconSvg\(/.test(mansion) && /mansion-inventory-card__icon/.test(contestant13Quest), "carried objects lack distinct scalable dossier illustrations");
check("50 illustrated dossier", /id="mansion-clue-notepad"/.test(page) && /\.mansion-clue-notepad/.test(page) && /\.mansion-clue-note/.test(page) && /linear-gradient/.test(page), "recovered clues are not presented on a ruled notepad");

check("24 closet interior materials", /const closetInterior\s*=\s*new THREE\.MeshStandardMaterial\(/.test(cabinetClass) && !/const closetInterior\s*=\s*new THREE\.MeshBasicMaterial\(/.test(cabinetClass), "walk-in closet liners still ignore real scene lighting");
check("24 closet interior materials", !/lightCircuit\.glowMaterials\.push\(closetInterior\)/.test(cabinetClass), "closet liner is still a circuit-tinted glow surface");
check("24 closet manual control", /pull-hitbox/.test(cabinetClass) && /addControlTarget\([^;]*pull[^;]*hitbox/i.test(cabinetClass), "closet pull chain lacks a generous explicit interaction hitbox");
check("24 closet closed-door gate", /walkInInteriorMeshes/.test(cabinetClass) && /walkInInteriorMeshes\.visible\s*=\s*this\.open\s*\|\|\s*this\.angle\s*>\s*0\.025/.test(cabinetClass), "walk-in closet interior visuals do not remain through the closing animation and hide once the doors seal");
check("24 closet switch independence", !/lightCircuit\.(?:setState|toggle)\(|lightCircuit\.on\s*=/.test(cabinetSetOpen), "opening or closing a closet mutates its manually controlled light circuit");
check("24 closet diagnostics", /walkInClosets\s*:/.test(diagnostics) && /interiorVisible/.test(diagnostics) && /lightOn/.test(diagnostics), "diagnostics do not expose each walk-in closet's door, interior-render, and manual light state");

check("24 stable render policy", !/portalCircuitNames|getExteriorPortalCircuitNames/.test(mansion) && !/ownerRoom|rendersInOwnerRoom/.test(lightRendering), "proximity-based portal or owner-room light gating remains");
check("24 stable render policy", /renderContext === "grounds"\) return isExteriorCircuit/.test(mansion) && /return !isExteriorCircuit && rendersOnFloor/.test(mansion), "indoor main-floor and grounds lights are not isolated into stable contexts");
check("24 fixture mesh stability", /keepForFacade[\s\S]*?sconce[\s\S]*?chandelier[\s\S]*?bulb/.test(exteriorCulling), "lit fixture meshes can still disappear when the player walks away from the facade");

const sconceBuilder = section("addWallSconce(x, y, z", "addFixtureSupportFill", lightCircuitClass);
const aimedSpotBuilder = section("addAimedSpotLight(x, y, z", "addWallSconce", lightCircuitClass);
check("24 architectural wall sconces", /wall-sconce-cup/.test(sconceBuilder) && /wall-sconce-frosted-shade/.test(sconceBuilder) && /wall-sconce-bulb/.test(sconceBuilder), "wall sconces still read as exposed glowing orbs instead of complete fixtures");
check("25 stable-light performance budget", count(sconceBuilder, /addAimedSpotLight\(/g) === 1 && !/wall-wash/.test(sconceBuilder), "each wall sconce still allocates more than one real emitter");
check("27 aimed sconce containment", /targetDistance\s*=\s*Math\.hypot\(/.test(aimedSpotBuilder) && /boundedDistance\s*=\s*Math\.min\(distance,\s*targetDistance\s*\+\s*1\.35\)/.test(aimedSpotBuilder) && /new THREE\.SpotLight\([^;]*boundedDistance/.test(aimedSpotBuilder) && /shadow\.camera\.far\s*=\s*boundedDistance/.test(aimedSpotBuilder), "a wall sconce cone can continue beyond its authored in-room target");
check("25 stable-light performance budget", /mobile\s*\?\s*1(?:\.0)?\s*:\s*1\.25/.test(resizeSystem) && /pixelRatio:\s*Number\(renderer\.getPixelRatio\(\)\.toFixed\(2\)\)/.test(diagnostics), "renderer does not cap Retina pixel workload or expose the active DPR");
check("26 mobile portrait composition", /camera\.fov\s*=\s*clamp\(portraitExpansion,\s*70,\s*96\)/.test(resizeSystem), "portrait canvases need an expanded, capped field of view so rooms are not cropped to a narrow desktop slice");
check("26 responsive render target", /new ResizeObserver\(\(\)\s*=>\s*resize\(\)\)/.test(mansion) && /visualViewport\.addEventListener\("resize",\s*resize\)/.test(mansion), "canvas sizing must follow stage and visual viewport changes on mobile");
check("26 all-device light budget", /function selectBudgetedCircuitLights\(/.test(mansion) && /budgetedLights = selectBudgetedCircuitLights\(floors, renderContext\)/.test(lightRendering) && /budgetedLights\.has\(light\)/.test(lightRendering) && !/physics\.playerPosition\(\)/.test(budgetedLightSelection), "desktop and mobile must select a context-stable real-emitter set inside the fixed type budget");
check("26 all-device floor handover", /if \(floorContextChanged\) syncLightRendering\(\)/.test(mansion) && !/syncLightRendering\([^)]*"fade"/.test(updateLocation) && !/prewarmLightingPrograms/.test(mansion), "floor changes must snap to the bounded layout without compiling a temporary crossfade union");
check("26 mobile stable upper lighting", /MOBILE_UPPER_AMBIENT_CIRCUITS\.has\(circuit\.name\)/.test(lightRendering) && /light\.isPointLight/.test(lightRendering) && /mobileUpperStableLighting/.test(diagnostics), "mobile upper floor must keep its complete reduced circuit set stable and use broad fills in the open stair volumes");
check("26 mobile retained-light brightness", /MOBILE_CIRCUIT_INTENSITY_SCALE = 2/.test(mansion) && /state\.mobileRenderProfile && budgetedLights\.has\(light\)[\s\S]*?MOBILE_CIRCUIT_INTENSITY_SCALE/.test(lightRendering), "the selected mobile emitter set is not scaled to keep rooms readable");
check("26 mobile stair brightness", /MOBILE_UPPER_AMBIENT_SCALE = 2\.2/.test(mansion) && /renderIntensityScale/.test(lightRendering) && /mobileUpperAmbientScale/.test(diagnostics), "mobile stair, foyer, and landing fills are not boosted enough to keep the top flight readable");
check("26 no automatic room lighting", !/mobileUpperCircuitNames/.test(mansion) && !/roomChanged && state\.mobileRenderProfile/.test(updateLocation), "crossing an upstairs room boundary can still visibly switch mobile lights on or off");
check("26 explicit mobile stage height", /#mansion-stage\s*\{\s*height:\s*clamp\(520px,\s*72dvh,\s*700px\);\s*min-height:\s*0;/s.test(page), "phone layout needs a definite stage height for reliable canvas measurement");
check("25 adaptive performance floor", /renderQuality:\s*"high"/.test(mansion) && /lowFpsSeconds/.test(mansion) && /lowFpsThreshold\s*=\s*state\.mobileRenderProfile\s*\?\s*24\s*:\s*40/.test(mansion) && /state\.fps\s*<\s*lowFpsThreshold/.test(mansion) && /state\.renderQuality\s*=\s*"reduced"/.test(mansion) && /renderQuality:\s*state\.renderQuality/.test(diagnostics), "sustained low FPS cannot trigger a one-way DPR safety reduction without treating the intentional mobile 30 FPS cap as a failure");
check("24 every estate lantern emits", !/addEstateLantern\(estateExteriorLights,[^\n;]*lanterns\);/.test(yardBuild), "one or more visibly glowing estate lanterns still lacks a real light source");

// 28. Lighting realism and cross-floor continuity. Every fixture paints the
// response a physical source would throw onto its own ceiling, wall, and the
// surrounding air (decorative surfaces only — never extra emitters), and a
// floor-context change hands fixtures over through a slow fade so lights can
// never read as switching on approach or off on departure. Fixtures hanging
// in the open stair volumes render on both adjacent floor contexts, and every
// reachable light-count layout is compiled during boot so the fade itself
// cannot hitch on shader compilation.
const responseGlowBuilder = section("addCeilingResponseGlow(x, y, z", "addRoomOmniLight(x, y, z", lightCircuitClass);
check("28 fixture response glow", /addCeilingResponseGlow/.test(responseGlowBuilder) && /addSourceHalo/.test(responseGlowBuilder) && /this\.addCeilingResponseGlow\(/.test(lightCircuitClass) && /this\.addSourceHalo\(/.test(lightCircuitClass), "ceiling fixtures no longer paint a ceiling response and source halo around their real emitters");
check("28 fixture response glow", /wall-sconce-updraft-glow/.test(sconceBuilder) && /this\.addSourceHalo\(/.test(sconceBuilder), "wall sconces no longer paint an updraft wash and scattered halo");
check("28 response glow is decorative", !/new THREE\.(?:SpotLight|PointLight)/.test(responseGlowBuilder) && /AdditiveBlending/.test(responseGlowBuilder) && /glowMaterials\.push/.test(responseGlowBuilder), "response glows must stay switch-owned painted surfaces, never extra emitters");
check("28 cross-floor snap", /if \(floorContextChanged\) syncLightRendering\(\)/.test(updateLocation) && !/syncLightRendering\([^)]*"fade"/.test(updateLocation), "floor changes can still create an expensive temporary union of both light layouts");
check("28 transition bookkeeping", /transition === "fade" && !state\.qa/.test(lightRendering) && /updateLightTransitions\(dt\)/.test(mansion) && /LIGHT_FADE_OUT_RATE/.test(mansion), "the generic light transition system was removed instead of keeping non-floor transition support intact");
check("28 stairwell continuity", count(lightingBuild, /\["MAIN LEVEL", "SECOND FLOOR"\]/g) >= 6 && count(lightingBuild, /\["SECOND FLOOR", "MAIN LEVEL"\]/g) >= 3 && /upperLanding\.addLevel\("MAIN LEVEL"\)/.test(lightingBuild) && /serviceStair\.addLevel\("BASEMENT"\)/.test(lightingBuild), "fixtures in the open stair volumes can still hand over mid-climb");
check("28 shader compilation is on demand", !/renderer\.compile\(scene, camera\)/.test(lightRendering) && /state\.ready\s*=\s*true[\s\S]*?requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame\(animate\)\)/.test(initSequence), "startup does not yield a browser paint before the one stable mobile shader compiles on demand");
check("28 switch-stable light loop", /light\.visible = placed \|\| data\.renderFactor > 0\.004/.test(mansion), "a wall switch can restructure the shader light loop instead of only zeroing intensity");

const hasPracticalFill = (owner, minIntensity, minDistance) => methodCalls(owner, "addPracticalLight", lightingBuild)
  .some((call) => call.values[3] >= minIntensity && call.values[4] >= minDistance);
check("24 brighter switch-owned fills", hasPracticalFill("foyer", 20, 5.2) && /foyer\.addSwitch\(/.test(lightingBuild), "front foyer lacks a brighter switch-owned fill");
check("24 brighter switch-owned fills", hasPracticalFill("stair", 26, 6.2) && /stair\.addSwitch\(/.test(lightingBuild), "grand stair lacks a brighter switch-owned fill");
check("24 brighter switch-owned fills", hasPracticalFill("upperLanding", 22, 5.2) && /upperLanding\.addSwitch\(/.test(lightingBuild), "upper landing lacks a brighter switch-owned fill");
check("24 brighter switch-owned fills", hasPracticalFill("westFront", 18, 5.0) && hasPracticalFill("eastFront", 18, 5.0) && /westFront\.addSwitch\(/.test(lightingBuild) && /eastFront\.addSwitch\(/.test(lightingBuild), "front suites lack balanced switch-owned fill lights");
for (const view of ["paintingRoomWestWall", "paintingRoomEastWall", "rearLoungeEntry", "primarySuiteLoungeDoor", "eastRearSuiteLoungeDoor"]) {
  check("24 renovation QA views", mansion.includes(`${view}:`), `missing renovation inspection view ${view}`);
}
for (const view of ["foyerGrandChandelier", "frontPorticoChandelier"]) {
  check("24 signature chandelier QA views", mansion.includes(`${view}:`), `missing inspection view ${view}`);
}
for (const route of ["paintingWestWallBlock", "paintingEastWallBlock", "rearLoungeEntry", "primarySuiteLoungeEntry", "eastRearSuiteLoungeEntry"]) {
  check("24 renovation QA routes", qaHooks.includes(`${route}:`), `missing physical renovation route ${route}`);
}

// 41. The first real gameplay slice connects distant authored rooms through
// ordinary interactions. Rewards are idempotent, early interactions remain
// gated, and sabotage changes story state without mutating the light budget.
check("41 Contestant 13 configuration", /objectives:\s*Object\.freeze/.test(contestant13Config) && /transcript:/.test(contestant13Config), "Contestant 13 objectives and recording transcript are not centralized");
check("41 Contestant 13 interaction registry", /this\.interactions\s*=\s*new Map\(\)/.test(contestant13Quest) && /addInteractionTarget\(/.test(contestant13Quest), "story objects do not share the mansion interaction contract");
check("41 Contestant 13 idempotency", /if \(this\.story\.bookRead\)/.test(contestant13Quest) && /if \(this\.story\.shovelTaken\)/.test(contestant13Quest) && /if \(this\.story\.digSiteExcavated \|\| this\.story\.digging\)/.test(contestant13Quest), "repeat clue, pickup, or dig interactions can duplicate progression rewards");
check("41 Contestant 13 dig gate", /if \(!this\.story\.bookRead\)/.test(contestant13Quest) && /if \(!this\.hasItem\("garden-shovel"\)\)/.test(contestant13Quest) && /basement-key-b13/.test(contestant13Quest), "digging can grant the basement key without the book clue or shovel");
check("41 Contestant 13 Archive gate", /if \(!this\.story\.basementUnlocked\)/.test(contestant13Quest) && /if \(!this\.hasItem\("basement-key-b13"\)\)/.test(contestant13Quest) && /archiveCageUnlocked\s*=\s*true/.test(contestant13Quest), "evidence cage does not require the basement threshold and recovered service key");
check("41 Contestant 13 recording gate", /if \(!this\.story\.archiveCageUnlocked \|\| !this\.story\.tapeFound\)/.test(contestant13Quest) && /recordingPlayed\s*=\s*true/.test(contestant13Quest), "Contestant 13's recording can play before the cage and tape are available");
check("41 Contestant 13 sabotage gate", /if \(!this\.story\.recordingPlayed\)/.test(contestant13Quest) && /relaySabotaged\s*=\s*true/.test(contestant13Quest) && /threatEscalated\s*=\s*true/.test(contestant13Quest), "camera relay sabotage lacks recording knowledge or a persistent threat consequence");
for (const helper of ["addContestantThirteenLibraryBook", "addContestantThirteenGardenShovel", "addContestantThirteenDigSite", "addContestantThirteenArchiveCage", "addContestantThirteenCameraRelay"]) {
  check("41 Contestant 13 physical story", contestant13Build.includes(`${helper}(`), `missing story furnishing helper ${helper}`);
}
for (const objectName of ["contestant-13-library-shelf-book", "contestant-13-garden-shovel", "contestant-13-dig-site", "contestant-13-archive-cage", "contestant-13-camera-relay"]) {
  check("41 Contestant 13 physical story", mansion.includes(objectName), `missing stable scene name ${objectName}`);
}
check("41 Contestant 13 physical state", /recorderIndicatorActive:/.test(contestant13Quest) && /relayOnlineBulbVisible:/.test(contestant13Quest) && /relayAlarmBulbVisible:/.test(contestant13Quest) && /archiveCageOpen:\s*state\.contestant13\.archiveCageUnlocked/.test(contestant13Quest) && /preExteriorVisibility\s*=\s*false/.test(contestant13Quest) && /preExteriorVisibility\s*=\s*true/.test(contestant13Quest), "diagnostics or exterior-culling state do not preserve recorder, cage, and relay visuals");
check("41 Contestant 13 warning pulse", /warningPulse/.test(mansion) && /relayAlarmMaterial\.emissiveIntensity/.test(mansion), "sabotage warning lamp does not visibly pulse");
check("41 Contestant 13 diagnostics", /inventory:\s*contestant13Quest\?\.getInventoryDiagnostics/.test(diagnostics) && /journal:\s*contestant13Quest\?\.getJournalDiagnostics/.test(diagnostics) && /contestant13:\s*contestant13Quest\?\.getDiagnostics/.test(diagnostics), "objective, inventory, journal, and story state are missing from render_game_to_text");
for (const view of ["contestant13LibraryBook", "contestant13GardenShovel", "contestant13DigSite", "contestant13BasementDoor", "contestant13ArchiveCage", "contestant13WorkshopRelay"]) {
  check("41 Contestant 13 QA views", qaRoomViews.includes(`${view}:`), `missing Contestant 13 QA view ${view}`);
}
check("41 Contestant 13 accessible UI", /id="mansion-casefile"/.test(page) && /id="mansion-objective"/.test(page) && /id="mansion-inventory"/.test(page) && /id="mansion-journal"[^>]+role="dialog"[^>]+aria-modal="true"/.test(page) && /aria-live="polite"/.test(page) && /journalReturnFocus/.test(contestant13Quest), "page lacks accessible objective, inventory, discovery, or modal journal feedback");
check("41 Contestant 13 page copy", !/There are no objectives/i.test(page) && /Contestant 13/i.test(page) && /Sabotage/i.test(page), "page still describes the mansion as an objective-free architectural demo");

// 42. Discovery tuning makes the physical clues less obvious without making
// them unreliable: the shovel sits low inside a rose row, the cache is at the
// maze's maximum-depth dead end, and excavation removes every authored mark.
check("42 Contestant 13 rose-hidden shovel", /shovel:\s*Object\.freeze\(\{ x:\s*-22\.35, z:\s*-5\.50, yOffset:\s*0\.16, scale:\s*0\.56 \}\)/.test(contestant13Config) && /group\.position\.set\(shovelLayout\.x, YARD_LAYOUT\.groundY \+ shovelLayout\.yOffset, shovelLayout\.z\)/.test(contestant13ShovelBuild) && /group\.scale\.setScalar\(shovelLayout\.scale\)/.test(contestant13ShovelBuild) && /group\.rotation\.z\s*=\s*-1\.42/.test(contestant13ShovelBuild), "shovel is not reduced and placed low inside the shifted southeast rose bed");
check("42 Contestant 13 shovel target", /contestant-13-garden-shovel-hitbox/.test(contestant13ShovelBuild) && /hitbox\.visible\s*=\s*false/.test(contestant13ShovelBuild) && /\[hitbox\]/.test(contestant13ShovelBuild), "hidden shovel lacks a dedicated forgiving interaction target");
check("42 Contestant 13 deeper cache", /const goal\s*=\s*mazeCellCenter\(19, 3\)/.test(contestant13DigSiteBuild) && /pathStepsFromRear:\s*82/.test(contestant13Config), "cache is not at the maze's deepest reachable dead end");
check("42 Contestant 13 subtle mark", /contestant-13-dig-site-marker/.test(contestant13DigSiteBuild) && /w:\s*0\.025[^;]+h:\s*0\.012[^;]+d:\s*0\.18/.test(contestant13DigSiteBuild) && /material:\s*M\.darkFloor/.test(contestant13DigSiteBuild), "XIII marker remains too large, bright, or raised");
check("42 Contestant 13 clean hole", /digMound\.visible\s*=\s*false/.test(contestant13Quest) && /digMarker\.visible\s*=\s*false/.test(contestant13Quest) && /digHole\.visible\s*=\s*true/.test(contestant13Quest) && /contestant-13-dig-site-open-hole[^;]+height:\s*0\.02[^;]+y:\s*0\.045/.test(contestant13DigSiteBuild) && /Inspect empty hole/.test(contestant13DigSiteBuild), "excavation does not remove the mound and XIII mark while preserving a visible inspectable hole above the maze path surface");
check("42 Contestant 13 discovery diagnostics", /shovelScale:/.test(contestant13Quest) && /pathStepsFromRear:/.test(contestant13Quest) && /digMoundVisible:/.test(contestant13Quest) && /digMarkerVisible:/.test(contestant13Quest) && /digHoleVisible:/.test(contestant13Quest), "runtime diagnostics do not expose the tuned clue geometry and post-dig state");
check("42 Contestant 13 tuned QA views", /contestant13GardenShovel:\s*\[-22\.28,\s*YARD_LAYOUT\.groundY,\s*-4\.05,\s*0,\s*-0\.75\]/.test(qaRoomViews) && /contestant13DigSite:\s*\[25,\s*YARD_LAYOUT\.groundY,\s*-13\.90,\s*0,\s*-0\.93\]/.test(qaRoomViews), "QA views do not frame the concealed shovel and deeper cache");
check("44 garden quest placement", /const shovelLayout = CONTESTANT_13\.world\.shovel;/.test(contestant13ShovelBuild) && /group\.position\.set\(shovelLayout\.x, YARD_LAYOUT\.groundY \+ shovelLayout\.yOffset, shovelLayout\.z\)/.test(contestant13ShovelBuild), "the garden shovel does not move with its authored garden placement");

// 47. The revised trail starts with a subtle shelf volume, separates the
// garden-tool and maze-key hints, and makes the basement a real quest gate.
check("47 basement key trail physical story", /book:\s*Object\.freeze\(\{[\s\S]*?x:\s*-14\.5, z:\s*7\.9,[\s\S]*?localZ:\s*-0\.075/.test(contestant13Config) && /contestant-13-library-shelf-book/.test(contestant13BookBuild) && /group\.position\.set\(bookLayout\.x, FLOOR\.MAIN, bookLayout\.z\)/.test(contestant13BookBuild) && /group\.rotation\.y\s*=\s*-Math\.PI \/ 2/.test(contestant13BookBuild), "Contestant 13's clue is not embedded in the middle Library bookcase");
check("47 basement key trail physical story", /shelfIndex:\s*2, reservedSlot:\s*5/.test(contestant13Config) && /localX:\s*0\.215, localZ:\s*-0\.075/.test(contestant13Config) && /reservedBookSlots/.test(bookshelfBuilder) && /reservedSlots\.has\(`\$\{shelf\}:\$\{i\}`\)/.test(bookshelfBuilder) && /reservedBookSlots:\s*\[\{ shelf:\s*clueBookLayout\.shelfIndex, slot:\s*clueBookLayout\.reservedSlot \}\]/.test(mainFurnishings), "the clue book does not own a clean reserved gap between neighboring instanced volumes");
check("47 basement key trail physical story", /width:\s*0\.12, height:\s*0\.43, depth:\s*0\.3/.test(contestant13Config) && /w:\s*bookLayout\.width, h:\s*bookLayout\.height, d:\s*bookLayout\.depth/.test(contestant13BookBuild) && /createContestantThirteenScratchTexture\(\)/.test(contestant13BookBuild) && /new THREE\.PlaneGeometry\(bookLayout\.scratchWidth, bookLayout\.scratchHeight\)/.test(contestant13BookBuild) && /surfaceTreatment\s*=\s*"etched-decal"/.test(contestant13BookBuild) && /raisedDepth\s*=\s*0/.test(contestant13BookBuild), "the clue volume lacks a flat etched XIII decal");
check("47 organic XIII scratches", /const scratchPaths\s*=\s*\[/.test(contestant13BookBuild) && /ctx\.setLineDash\(\[13, 4, 8, 3\]\)/.test(contestant13BookBuild) && /rgba\(14, 10, 7, 0\.68\)/.test(contestant13BookBuild) && /rgba\(190, 170, 126, 0\.72\)/.test(contestant13BookBuild) && !/contestant-13-library-book-scratch-x-left/.test(contestant13BookBuild) && !/material:\s*M\.agedTrim, parent:\s*scratch/.test(contestant13BookBuild), "the spine XIII is still built from clean raised geometry instead of broken layered scratch marks");
check("47 unmistakable crossed X", /\[\[32, 24\][\s\S]*?\[88, 164\]\]/.test(contestant13BookBuild) && /\[\[88, 27\][\s\S]*?\[31, 162\]\]/.test(contestant13BookBuild) && /const crossIntersection\s*=\s*\[/.test(contestant13BookBuild) && /crossIntersection\.forEach\(trace\)/.test(contestant13BookBuild), "the first XIII character can collapse into a V instead of a fully crossed X");
check("47 printed book with handwritten marginalia", /annotation:\s*"The basement key is buried/.test(contestant13Config) && !/title:\s*"The Hollow Estate Garden Ledger"/.test(contestant13Config) && /selectCluePrintBook\(\)/.test(readableBookSystem) && /registerSpecialBook\(CONTESTANT_13\.clueBook/.test(contestant13BookBuild) && /readableBookSystem\?\.open\(contestant13Scene\.libraryBookPlacement\)/.test(contestant13Quest) && /id="mansion-book-annotation"/.test(page) && /data-annotation-slot/.test(page) && /Bradley Hand/.test(page), "the XIII clue is not separate handwritten marginalia inside a seeded ordinary printed book");
check("47 batched physical spine titles", /registerSpineTitle\(/.test(readableBookSystem) && /finalizeSpineTitles\(\)/.test(readableBookSystem) && /new THREE\.InstancedMesh\(new THREE\.PlaneGeometry\(1, 1\)/.test(readableBookSystem) && /readableBookSystem\.finalizeSpineTitles\(\)/.test(mansion), "ordinary book titles are not rendered through bounded instanced spine-label batches");
check("47 subtle book typography", /spineTitleInk:\s*"#14110e"/.test(mansion) && /ctx\.fillStyle\s*=\s*READABLE_BOOKS\.spineTitleInk/.test(readableBookSystem) && !/ctx\.shadowColor/.test(readableBookSystem), "physical spine titles are not using a shadow-free matte-black ink treatment");
check("47 rushed XIII marginalia", /font-style:\s*italic/.test(page) && /letter-spacing:\s*-0\.025em/.test(page) && /rotate\(-2\.4deg\)\s*skewX\(-1\.6deg\)/.test(page) && /Hurry\./.test(contestant13Config), "the XIII note does not read as hurried, angled handwriting");
check("47 basement key trail copy", /garden[^\n"]*shovel/i.test(contestant13Config) && /hedge maze[^\n"]*(?:key|brass)|(?:key|brass)[^\n"]*hedge maze/i.test(contestant13Config), "the shelf-book clue does not independently point to the garden shovel and hedge-maze key");
check("47 basement key trail copy", /"basement-key-b13":\s*"Basement key"/.test(contestant13Config) && /basement:\s*"Use the recovered key on the locked basement stair door/.test(contestant13Config), "the recovered item and objective do not identify the locked basement threshold");
check("47 basement key trail state machine", /bookRead:\s*false/.test(mansion) && /basementKeyFound:\s*false/.test(mansion) && /basementUnlocked:\s*false/.test(mansion), "central quest state lacks book, basement-key, or basement-unlock flags");
check("47 basement key trail state machine", /locked:\s*true[\s\S]*?onCreate:\s*\(door\)\s*=>\s*\{\s*contestant13Scene\.basementDoor\s*=\s*door;\s*\}/.test(kitchenServiceStairWall), "the Kitchen service-stair door is not authored as the captured locked basement door");
check("47 basement key trail state machine", /getLockedLabel/.test(hingedDoorClass) && /onLockedActivate/.test(hingedDoorClass) && /unlockBasement\(door/.test(contestant13Quest) && /door\.locked\s*=\s*false/.test(contestant13Quest), "the shared door contract cannot explain or resolve the basement lock through the quest");
check("47 basement key trail state machine", /this\.story\.basementKeyFound\s*=\s*true/.test(contestant13Quest) && /this\.addItem\("basement-key-b13"\)/.test(contestant13Quest) && /if \(!this\.story\.basementUnlocked\)/.test(contestant13Quest), "the maze reward does not gate the Archive chain behind basement unlock");
check("47 basement key trail diagnostics", /bookVisible:/.test(contestant13Quest) && /bookScratch:\s*"XIII"/.test(contestant13Quest) && /bookSlotReserved:\s*true/.test(contestant13Quest) && /basementDoorLocked:/.test(contestant13Quest) && /basementDoorOpen:/.test(contestant13Quest) && /basementUnlocked:\s*this\.story\.basementUnlocked/.test(contestant13Quest), "diagnostics do not expose the separated XIII-marked shelf book and persistent basement-door state");
check("47 basement key trail QA views", /contestant13LibraryBook:\s*\[-12\.75,\s*FLOOR\.MAIN,\s*8\.1,\s*Math\.PI \/ 2,\s*-0\.08\]/.test(qaRoomViews) && /contestant13BasementDoor:\s*\[12\.55,\s*FLOOR\.MAIN,\s*-4\.65,\s*Math\.PI,\s*-0\.08\]/.test(qaRoomViews), "QA views do not frame the subtle book and basement lock from the player's Kitchen approach");
check("47 basement key trail patrol gate", /door\.name === "basement stair door" && target\.id === "main-service-door"/.test(mrFeastWanderer) && /point\.id === "main-service-exit"/.test(mrFeastWanderer) && /lockedRouteDoors/.test(mrFeastWanderer) && /door\.locked = true/.test(mrFeastWanderer), "Mr. Feast can walk through the locked basement threshold or full-route QA can corrupt story-door state");

// 48. Player mobility and testing controls share one authoritative state
// contract so future detection can consume crouch stealth without redefining it.
check("48 player movement controls", /walkSpeed:\s*2\.2/.test(playerConfig) && /sprintSpeed:/.test(playerConfig) && /crouchSpeed:/.test(playerConfig) && /energyMax:\s*100/.test(playerConfig) && /energyDrainPerSecond:/.test(playerConfig) && /energyRechargePerSecond:/.test(playerConfig), "player tuning lacks named walk, sprint, crouch, and energy values");
check("48 player movement controls", /ShiftLeft/.test(mansion) && /ShiftRight/.test(mansion) && /KeyC/.test(mansion) && /crouched/.test(playerUpdate) && /stealthVisibilityMultiplier/.test(playerUpdate) && /stealthNoiseMultiplier/.test(playerUpdate), "keyboard movement does not implement sprint energy and crouch stealth");
check("48 energy HUD", /id="mansion-energy"/.test(page) && /id="mansion-energy-fill"/.test(page) && /aria-valuemax="100"/.test(page) && /energyPercent/.test(mansion), "stamina reserve is not exposed through an accessible HUD bar and diagnostics");
check("48 inventory dossier", /event\.code === "Tab"/.test(mansion) && /id="mansion-inventory-dialog-items"/.test(page) && /Inventory &amp; Clues/.test(page) && /mansion-journal-entries/.test(page), "Tab does not open a combined carried-object and recovered-clue dossier");
check("48 escape menu", /id="mansion-menu"/.test(page) && /id="mansion-menu-music"/.test(page) && /id="mansion-menu-maximize"/.test(page) && /id="mansion-menu-save"/.test(page) && /id="mansion-menu-load"/.test(page) && /id="mansion-menu-dev"/.test(page) && /event\.code === "Escape"/.test(mansion), "Escape menu lacks music, maximize, save/load, or Dev Mode controls");
check("48 escape menu", !/id="mansion-audio"/.test(page) && !/id="mansion-fullscreen"/.test(page) && /function releasePointerLock\(/.test(mansion) && /ignoreEscapeMenuToggleUntil/.test(mansion) && /intentionalPointerUnlockUntil/.test(mansion) && /setMenuOpen\(true\)/.test(mansion), "music/maximize still live in the HUD toolbar or Escape does not open the menu on pointer-unlock");
check("48 escape menu", /function toggleGameAudio\(/.test(mansion) && /dom\.menuMusic\.addEventListener\("click"/.test(mansion) && /Sound: On/.test(mansion) && /Sound: Off/.test(mansion), "Escape menu sound control is not wired to the audio system");
check("48 resume reclaims look", /function reclaimLookControl\(/.test(mansion) && /armLookReclaimFollowUps/.test(mansion) && /armFollowUps:\s*true/.test(mansion) && /pointerdown/.test(mansion), "closing the Escape menu does not re-request pointer lock for camera look");
check("48 book keeps cursor hidden", /keepCanvasInteractive/.test(mansion) && /is-book-open/.test(mansion) && /mr-feast-book-open/.test(mansion) && /cursor:\s*none/.test(page) && /do NOT inert the canvas/.test(mansion), "opening a book still inerts the canvas or shows the system cursor");
check("48 true fullscreen", /requestFullscreen/.test(mansion) && /Exit fullscreen/.test(mansion) && /syncFullscreenStateFromDocument/.test(mansion) && /navigationUI:\s*"hide"/.test(mansion), "Maximize still uses CSS-only browser chrome instead of the Fullscreen API");
check("48 save contract", /RBGameSaves\?\.create\("mr-feast-mansion",\s*\{ version:\s*1 \}\)/.test(mansion) && /serializeMansionSave/.test(mansion) && /restoreMansionSave/.test(mansion) && /playerPosition/.test(mansion), "mansion progress and player transform are not versioned through RBGameSaves");
check("48 reversible dev mode", /devModeSnapshot/.test(mansion) && /setDevMode\(enabled/.test(mansion) && /recordingPlayed\s*=\s*true/.test(mansion) && /relaySabotaged\s*=\s*false/.test(mansion) && /restoreQuestSnapshot/.test(mansion), "Dev Mode does not grant the current trail while preserving a reversible pre-dev snapshot and unfinished sabotage");

// 43. Mr. Feast is an optional, animated test layer. He follows a safe
// authored main-floor loop, never blocks mansion boot, and exposes enough
// deterministic state to prove locomotion without adding pursuit gameplay.
const threeIndex = page.indexOf("three-r128.min.js");
const gltfLoaderIndex = page.indexOf("GLTFLoader-r128.js");
const skeletonUtilsIndex = page.indexOf("SkeletonUtils-r128.js");
const mansionRuntimeIndex = page.indexOf("mr-feast-mansion.js?v=");
check("43 Mr Feast loaders", threeIndex >= 0 && threeIndex < gltfLoaderIndex && gltfLoaderIndex < skeletonUtilsIndex && skeletonUtilsIndex < mansionRuntimeIndex, "Three, GLTFLoader, and SkeletonUtils are not loaded in dependency order before the mansion runtime");
const expectedMrFeastAssets = [
  mrFeastManifest.model,
  mrFeastManifest.animations?.idle?.file,
  mrFeastManifest.animations?.stalk?.file,
  mrFeastManifest.animations?.alert?.file,
  mrFeastManifest.animations?.run?.file,
];
check("43 Mr Feast manifest", mrFeastManifest.heightMeters === 2.01 && mrFeastManifest.sourceHeightMeters === 1.92 && mrFeastManifest.forwardAxis === "+Z" && mrFeastManifest.animations?.stalk?.playbackRate === 0.37 && expectedMrFeastAssets.every(Boolean), "runtime manifest is missing the eye-level fit, forward axis, stride-calibrated stalk rate, or motion assets");
for (const asset of expectedMrFeastAssets) {
  const assetPath = path.join(mrFeastAssetRoot, asset);
  check("43 Mr Feast runtime assets", fs.existsSync(assetPath), `missing runtime character asset ${asset}`);
  check("43 Mr Feast runtime assets", () => fs.readFileSync(assetPath).subarray(0, 4).toString("ascii") === "glTF", `${asset} is not a binary glTF file`);
}
for (const asset of expectedMrFeastAssets.slice(1)) {
  const json = glbJson(path.join(mrFeastAssetRoot, asset));
  const animation = json?.animations?.[0];
  const channels = animation?.channels || [];
  const paths = channels.map((channel) => channel.target?.path);
  const translatedNodes = channels
    .filter((channel) => channel.target?.path === "translation")
    .map((channel) => json.nodes?.[channel.target.node]?.name);
  check("43 Mr Feast stable motion assets", Boolean(json) && (json.meshes?.length || 0) === 0 && (json.skins?.length || 0) === 0, `${asset} is not a mesh-free animation GLB`);
  check("43 Mr Feast stable motion assets", paths.filter((value) => value === "rotation").length === 24 && paths.filter((value) => value === "translation").length === 1 && !paths.includes("scale") && translatedNodes[0] === "Hips", `${asset} can still scale bones or change limb lengths`);
}
const mrFeastModelPath = path.join(mrFeastAssetRoot, mrFeastManifest.model);
const mrFeastModelJson = glbJson(mrFeastModelPath);
const mrFeastFaceNode = (mrFeastModelJson?.nodes || []).find((node) => node.name === "MrFeast_RetopoFace");
const mrFeastModelMesh = Number.isInteger(mrFeastFaceNode?.mesh)
  ? mrFeastModelJson?.meshes?.[mrFeastFaceNode.mesh]
  : (mrFeastModelJson?.meshes || []).find((mesh) => mesh.name === "MrFeast_RetopoFace");
const mrFeastModelPrimitives = mrFeastModelMesh?.primitives || [];
const mrFeastModelTargets = mrFeastModelPrimitives.flatMap((primitive) => primitive.targets || []);
const mrFeastFacialTargetNames = mrFeastModelMesh?.extras?.targetNames || [];
const mrFeastFacialMappings = Object.values(mrFeastManifest.face?.morphTargets || {});
const mrFeastRetopologyNodeNames = (mrFeastModelJson?.nodes || []).map((node) => node.name).filter(Boolean);
const mrFeastRetopologyMeshNames = (mrFeastModelJson?.meshes || []).map((mesh) => mesh.name).filter(Boolean);
const mrFeastSceneRootNodes = new Set(mrFeastModelJson?.scenes?.[mrFeastModelJson?.scene || 0]?.nodes || []);
const mrFeastRetopologyNodeIndexes = requiredMrFeastRetopologyObjects.map((name) =>
  (mrFeastModelJson?.nodes || []).findIndex((node) => node.name === name),
);
const mrFeastFacePositionAccessor = mrFeastModelJson?.accessors?.[
  mrFeastModelPrimitives[0]?.attributes?.POSITION
];
const mrFeastFaceAccessorSize = mrFeastFacePositionAccessor?.min?.map(
  (minimum, index) => mrFeastFacePositionAccessor.max[index] - minimum,
) || [];
check("45 Mr Feast facial asset", mrFeastModelJson?.meshes?.length >= 7 && mrFeastModelJson?.skins?.length === 1 && mrFeastModelJson.skins[0].joints?.length === 24, "retopologized model must expose its modular face parts while retaining one shared skin and the 24-bone body rig");
check("45 Mr Feast facial asset", mrFeastModelTargets.length === requiredMrFeastFacialTargets.length && mrFeastModelTargets.every((target) => Number.isInteger(target.POSITION) && Object.keys(target).length === 1), "facialized model must contain ten POSITION-only morph targets without morph normals or tangents");
check("45 Mr Feast facial asset", requiredMrFeastFacialTargets.every((name) => mrFeastFacialTargetNames.includes(name)), `facialized model is missing approved targets: ${requiredMrFeastFacialTargets.filter((name) => !mrFeastFacialTargetNames.includes(name)).join(", ")}`);
check("46 Mr Feast retopology transforms", mrFeastRetopologyNodeIndexes.every((index) => index >= 0 && mrFeastSceneRootNodes.has(index)) && mrFeastFaceAccessorSize[0] >= 0.14 && mrFeastFaceAccessorSize[1] >= 0.20 && mrFeastFaceAccessorSize[2] >= 0.16, "retopologized face parts are parented beneath the 0.01-scale armature or their exported face bounds collapsed below head scale");
check("45 Mr Feast facial manifest", mrFeastManifest.version === 3 && mrFeastManifest.face?.rigVersion === 3 && mrFeastManifest.face?.presetVersion === 3 && requiredMrFeastFacialTargets.every((name) => mrFeastFacialMappings.includes(name)) && new Set(mrFeastFacialMappings).size === requiredMrFeastFacialTargets.length, "manifest does not expose the version-three retopologized facial contract");
check("45 Mr Feast facial size", fs.statSync(mrFeastModelPath).size <= 15 * 1024 * 1024, "retopologized runtime GLB exceeds the 15 MiB mobile budget");
check("45 Mr Feast facial report", mrFeastFacialReport.trianglesBefore === 65000 && mrFeastFacialReport.trianglesAfter === 65000 && mrFeastFacialReport.vertexCountBefore === mrFeastFacialReport.vertexCountAfter && requiredMrFeastFacialTargets.every((name) => mrFeastFacialReport.targets?.includes(name) && mrFeastFacialReport.targetStats?.[name]?.changedVertices > 0), "facial authoring report does not prove stable topology and non-empty sparse targets");
check("46 Mr Feast retopology structure", Boolean(mrFeastRetopologyReport) && mrFeastRetopologyReport?.pipelineVersion === 1 && mrFeastRetopologyReport?.face?.components === 1 && mrFeastRetopologyReport?.face?.vertices >= 2000 && mrFeastRetopologyReport?.morphMeshes === 4 && mrFeastRetopologyReport?.morphBindings === 18 && mrFeastRetopologyReport?.albedoBake?.completed === true && requiredMrFeastRetopologyObjects.every((name) => mrFeastRetopologyNodeNames.includes(name) || mrFeastRetopologyMeshNames.includes(name)), "runtime asset does not contain the one-piece textured face, separate eyes, eyelids, oral cavity, teeth, and smooth textured lip-rim binding contract");
check("46 Mr Feast retopology budget", Boolean(mrFeastRetopologyReport) && mrFeastRetopologyReport?.rig?.bones === 24 && mrFeastRetopologyReport?.rig?.skinnedMeshes >= 2 && mrFeastRetopologyReport?.asset?.triangles <= 90000 && mrFeastRetopologyReport?.asset?.sizeBytes <= 15 * 1024 * 1024, "retopologized character exceeds the browser budget or no longer preserves the 24-bone body rig");
check("46 Mr Feast retopology deformation", Boolean(mrFeastRetopologyReport) && requiredMrFeastFacialTargets.every((name) => mrFeastRetopologyReport?.targets?.includes(name) && mrFeastRetopologyReport?.targetStats?.[name]?.changedVertices > 0) && mrFeastRetopologyReport?.morphNormalExported === false && mrFeastRetopologyReport?.blinkClosureGapMillimeters?.left <= 1 && mrFeastRetopologyReport?.blinkClosureGapMillimeters?.right <= 1 && mrFeastRetopologyReport?.mouthOpenGapMillimeters >= 8, "retopology report does not prove ten non-empty POSITION-only targets, true independent eyelid closure, and a visible mouth opening");
const readableFacialDisplacementMillimeters = {
  blink_left: 5,
  blink_right: 5,
  brow_raise: 7,
  brow_compress: 4,
  smile: 5,
  smile_wide: 10,
  sneer_left: 7,
  sneer_right: 7,
  mouth_open: 4.5,
  jaw_shift: 6,
};
check("45 Mr Feast readable facial displacement", Object.entries(readableFacialDisplacementMillimeters).every(([name, minimum]) => mrFeastFacialReport.targetStats?.[name]?.maxDeltaMillimeters >= minimum), `facial targets remain below readable displacement thresholds: ${Object.entries(readableFacialDisplacementMillimeters).filter(([name, minimum]) => (mrFeastFacialReport.targetStats?.[name]?.maxDeltaMillimeters || 0) < minimum).map(([name]) => name).join(", ")}`);
check("43 Mr Feast tuning report", mrFeastTuningReport.policy === "no-scale; hips-translation-only; restrained-idle-and-stalk" && mrFeastTuningReport.clips?.length === 4 && mrFeastTuningReport.clips.every((clip) => clip.channelsAfter?.scale === 0 && clip.channelsAfter?.translation === 1), "motion tuning report does not prove the scale and translation cleanup");
const mrFeastPatrolIds = [...mrFeastPatrolRoute.matchAll(/mrFeastPatrolPoint\("([^"]+)"/g)].map((match) => match[1]);
check("43 Mr Feast whole-home route", mrFeastPatrolIds.length >= 220 && new Set(mrFeastPatrolIds).size === mrFeastPatrolIds.length && /speed:\s*0\.62/.test(mrFeastNpcConfig) && /arrivalRadius:\s*0\.06/.test(mrFeastNpcConfig), "whole-home patrol is too short, contains duplicate waypoint IDs, or lost the restrained walk speed");
check("43 Mr Feast floor coverage", /FLOOR\.MAIN/.test(mrFeastPatrolRoute) && /FLOOR\.UPPER/.test(mrFeastPatrolRoute) && /FLOOR\.BASEMENT/.test(mrFeastPatrolRoute) && /"UPPER GRAND BATHROOM"/.test(mrFeastPatrolRoute) && /"REAR LOUNGE"/.test(mrFeastPatrolRoute) && /"WINE CELLAR"/.test(mrFeastPatrolRoute) && /"BULK STORAGE"/.test(mrFeastPatrolRoute), "patrol does not cover all three interior levels and their major rooms");
check("43 Mr Feast stair geometry", /"grand-lower-bottom", 0, FLOOR\.MAIN, 2\.8/.test(mrFeastPatrolRoute) && /"grand-lower-top", 0, 2\.5, -0\.98/.test(mrFeastPatrolRoute) && /"grand-mid-west", -2\.48, 2\.5, -1\.55/.test(mrFeastPatrolRoute) && /"grand-west-top", -2\.48, FLOOR\.UPPER, 3\.1/.test(mrFeastPatrolRoute) && /"grand-east-top", 2\.48, FLOOR\.UPPER, 3\.1/.test(mrFeastPatrolRoute) && /"service-main-top", 12\.55, FLOOR\.MAIN, -2\.7/.test(mrFeastPatrolRoute) && /"service-basement-bottom", 12\.55, FLOOR\.BASEMENT, 2\.7/.test(mrFeastPatrolRoute), "patrol stair endpoints or rail-clearing mid-landing turn are missing");
check("43 Mr Feast door route", /doorOpenDistance:\s*1\.8/.test(mrFeastNpcConfig) && /doorWaitDistance:\s*0\.88/.test(mrFeastNpcConfig) && /doorCloseDistance:\s*2\.5/.test(mrFeastNpcConfig) && /basement stair door/.test(mrFeastPatrolRoute) && /archive door/.test(mrFeastPatrolRoute), "patrol does not author door approaches for the service stair and basement");
check("43 Mr Feast doorway clearance", count(basementPartitions, /width:\s*1\.35/g) >= 7 && count(upperPartitions, /width:\s*1\.35/g) >= 6 && /width: 1\.35[^\n]+bathroom gallery door/.test(mainPartitions) && /width: 1\.35[^\n]+painting gallery door/.test(mainPartitions), "route doors remain narrower than the fitted character");
check("43 Mr Feast animation", /THREE\.SkeletonUtils\.clone/.test(mrFeastWanderer) && /new THREE\.AnimationMixer/.test(mrFeastWanderer) && /fadeToAction\("idle"/.test(mrFeastWanderer) && /fadeToAction\("stalk"/.test(mrFeastWanderer), "rigged clone, mixer, or idle/stalk cross-fades are missing");
check("43 Mr Feast animation hardening", /sanitizeAnimationClip/.test(mrFeastWanderer) && /propertyName === "scale"/.test(mrFeastWanderer) && /propertyName === "position" && !targetsHips/.test(mrFeastWanderer), "runtime does not defensively reject scale and limb-translation tracks");
check("43 Mr Feast eye-level fit", /heightMeters:\s*2\.01/.test(mrFeastNpcConfig) && /MR_FEAST_NPC\.heightMeters \|\| Number\(manifest\.heightMeters\)/.test(mrFeastWanderer), "runtime cannot keep Mr. Feast at the authored 2.01m eye-level fit");
check("43 Mr Feast grounded gait", /const STALK_LOCOMOTION_BONES\s*=\s*new Set/.test(mrFeastTuningScript) && /profile === "stalk" && STALK_LOCOMOTION_BONES\.has\(boneName\)/.test(mrFeastTuningScript) && /stalkPlaybackRateForSpeed\(speed\)/.test(mrFeastWanderer), "stalk tuning can still twist the lower-body gait plane or desynchronize cadence from travel speed");
check("43 Mr Feast cornering", /movementAlignment:\s*0\.985/.test(mrFeastNpcConfig) && count(mrFeastWanderer, /facingAlignment < MR_FEAST_NPC\.movementAlignment/g) === 2 && /Math\.atan2\(Math\.sin\(nextYaw\), Math\.cos\(nextYaw\)\)/.test(mrFeastWanderer), "sharp turns can still produce visible strafing or unbounded long-session yaw");
check("43 Mr Feast 3D navigation", /const distance = Math\.hypot\(dx, dy, dz\)/.test(mrFeastWanderer) && /const horizontalDistance = Math\.hypot\(dx, dz\)/.test(mrFeastWanderer) && count(mrFeastWanderer, /moveWithCollision\(dx \/ distance \* step, dy \/ distance \* step, dz \/ distance \* step\)/g) === 2 && /this\.root\.position\.y \+= movement\.y/.test(mrFeastWanderer) && !/this\.root\.position\.y = FLOOR\.MAIN/.test(mrFeastWanderer), "wanderer cannot continuously interpolate elevation while keeping yaw horizontal");
check("43 Mr Feast door behavior", /prepareRouteDoor\(target, distance\)/.test(mrFeastWanderer) && /door\.setOpen\(true\)/.test(mrFeastWanderer) && /closeClearedRouteDoors/.test(mrFeastWanderer) && /door\.playerInSwingPath\(\)/.test(mrFeastWanderer), "wanderer does not open, wait for, and safely close route doors");
check("43 Mr Feast contact shadow", /mr-feast-contact-shadow/.test(mrFeastWanderer) && /new THREE\.CircleGeometry\(1, 24\)/.test(mrFeastWanderer) && /depthWrite:\s*false/.test(mrFeastWanderer), "the moving character lacks a cheap floor contact shadow");
check("43 Mr Feast stair shadow", /this\.onStairs = target\?\.segmentKind === "stairs"/.test(mrFeastWanderer) && /this\.contactShadow\.visible = !this\.onStairs && !interiorDetailsHidden/.test(mrFeastWanderer), "flat contact shadow can still cut through staircase treads");
check("43 Mr Feast lifecycle", /mrFeastNpc\s*=\s*new MrFeastWanderer\(\)/.test(initSequence) && /void mrFeastNpc\.load\(\)/.test(initSequence) && /animatedObjects\.push\(this\)/.test(mrFeastWanderer), "Mr. Feast is not constructed non-blockingly and registered with the update loop");
check("43 Mr Feast start gate", /if \(!state\.started \|\| !this\.wanderingEnabled\)/.test(mrFeastWanderer), "Mr. Feast can start patrolling before the player enters the mansion");
check("43 Mr Feast nonfatal load", /catch \(error\)/.test(mrFeastWanderer) && /this\.loadStatus\s*=\s*"error"/.test(mrFeastWanderer) && /this\.root\.visible\s*=\s*false/.test(mrFeastWanderer), "character asset failure does not settle into an isolated error state");
check("43 Mr Feast moving shadows", /object\.castShadow\s*=\s*false/.test(mrFeastWanderer) && /object\.receiveShadow\s*=\s*true/.test(mrFeastWanderer), "moving character is incompatible with the mansion's cached shadow policy");
check("43 Mr Feast culling", /interiorDetailMeshes\.push\(object\)/.test(mrFeastWanderer) && /object\.visible\s*=\s*!interiorDetailsHidden/.test(mrFeastWanderer), "asynchronously loaded meshes do not join exterior detail culling");
check("43 Mr Feast diagnostics", /mrFeast:\s*mrFeastNpc\?\.getDiagnostics/.test(diagnostics) && /resetMrFeastWandererForQA/.test(qaHooks) && /setMrFeastPoseForQA/.test(qaHooks) && /transitionMrFeastForQA/.test(qaHooks) && /advanceMrFeastAnimationForQA/.test(qaHooks) && /setMrFeastRouteSegmentForQA/.test(qaHooks) && /runMrFeastLocomotionProbeForQA/.test(qaHooks) && /runMrFeastWholeHomeRouteForQA/.test(qaHooks) && /visitedRouteFloors/.test(mrFeastWanderer) && /visitedRouteDoors/.test(mrFeastWanderer) && /routeDoorOpenEvents/.test(mrFeastWanderer) && /routeSummary:/.test(mrFeastWanderer) && /leftToe:/.test(mrFeastWanderer) && /rightToe:/.test(mrFeastWanderer) && /liveBones/.test(mrFeastWanderer) && /animationTracks:/.test(mrFeastWanderer) && /castShadowMeshes:/.test(mrFeastWanderer), "wanderer diagnostics or deterministic locomotion/whole-home QA controls are missing");
check("45 Mr Feast facial controller", /updateFace\(/.test(mrFeastWanderer) && /resolveAutomaticExpression\(/.test(mrFeastWanderer) && /state\.contestant13\.(?:relaySabotaged|threatEscalated)/.test(mrFeastWanderer) && /blink_left/.test(mrFeastWanderer) && /blink_right/.test(mrFeastWanderer), "wanderer lacks autonomous expression blending, threat escalation, or asymmetric blink control");
check("45 Mr Feast facial material readability", /tuneCharacterMaterial\(/.test(mrFeastWanderer) && /material\.emissiveIntensity\s*=\s*0\.08/.test(mrFeastWanderer) && /material\.roughness\s*=\s*Math\.max\(Number\(material\.roughness\) \|\| 0, 0\.68\)/.test(mrFeastWanderer), "Meshy material can still self-illuminate the face strongly enough to erase expression contours");
check("45 Mr Feast facial diagnostics", /face:\s*this\.getFaceDiagnostics\(\)/.test(mrFeastWanderer) && /targetWeights:/.test(mrFeastWanderer) && /phase:\s*blinkPhase/.test(mrFeastWanderer) && /attention:/.test(mrFeastWanderer) && /setMrFeastFaceForQA/.test(qaHooks) && /triggerMrFeastBlinkForQA/.test(qaHooks) && /advanceMrFeastFaceForQA/.test(qaHooks), "facial weights, blink phase, attention diagnostics, or deterministic QA controls are missing");
check("45 Mr Feast facial interaction order", /qaExpressionCycle:\s*Object\.freeze\(\["neutral",\s*"friendly",\s*"watching",\s*"close",\s*"threatened"\]\)/.test(mrFeastNpcConfig) && /cycleFaceExpressionForQA\(/.test(mrFeastWanderer), "QA interaction does not cycle the five facial presets in the approved inspection order");
check("45 Mr Feast QA-only interaction", /if \(state\.qa\) this\.registerFaceQaInteraction\(model\)/.test(mrFeastWanderer) && /addInteractionTarget\(model, this\.faceQaInteraction\)/.test(mrFeastWanderer) && /Cycle expression/.test(mrFeastWanderer), "loaded Mr. Feast model does not expose a QA-only look-at interaction and expression prompt");
check("43 Mr Feast deterministic framing", /mrFeastSideProfile:\s*\[-3\.2,\s*FLOOR\.MAIN,\s*-9\.0,\s*-Math\.PI \/ 2,\s*0\]/.test(qaRoomViews) && /mrFeastGaitSide:/.test(qaRoomViews) && /mrFeastGaitTurnSide:/.test(qaRoomViews) && /clipDurations:/.test(mrFeastWanderer), "side-profile gait framing or clip duration diagnostics are missing");
check("45 Mr Feast facial framing", /mrFeastFaceClose:\s*\[0,\s*FLOOR\.MAIN,\s*-8\.45,\s*0,\s*-0\.02\]/.test(qaRoomViews), "close facial QA framing is missing");
check("51 Mr Feast bounded camera response", !/attack|damage/i.test(mrFeastWanderer), "camera investigation must not silently expand into attack or damage behavior");
// Milestone 46 sanctions capture and failure, but only along one documented
// path: the witnessed/recorded pursuit, whose speed is clamped below the
// player's walk speed and whose game-over fires solely on a basement catch.
check("51 Mr Feast explicit capture boundary", /Math\.min\(MR_FEAST_PURSUIT\.speed,\s*PLAYER\.walkSpeed\s*-\s*0\.05\)/.test(mrFeastWanderer) && /feetY <= MR_FEAST_PURSUIT\.basementFeetY/.test(mrFeastWanderer) && count(mrFeastWanderer, /triggerMansionGameOver\(/g) === 1, "capture and failure must exist only through the speed-capped pursuit's basement catch");

// 51. Physical public-show cameras create a performance-safe stealth layer.
// They scan through one data-driven system, preserve intentional blind spots,
// and escalate only through the documented policy and investigation states.
const securityPlacementMatches = [...cameraSecurityConfig.matchAll(/securityCameraPlacement\("([^"]+)",\s*"([^"]+)"/g)];
const securityPlacementIds = securityPlacementMatches.map((match) => match[1]);
const securityPlacementZones = securityPlacementMatches.map((match) => match[2]);
check("51 camera surveillance source invariants", /SHOW:\s*"show"/.test(cameraSecurityConfig) && /RESTRICTED:\s*"restricted"/.test(cameraSecurityConfig) && /LOCKDOWN:\s*"lockdown"/.test(cameraSecurityConfig) && /CAMERA_POLICY_TRANSITIONS/.test(cameraSecurityConfig), "camera policy is not an explicit show/restricted/lockdown transition table");
check("51 camera surveillance source invariants", securityPlacementMatches.length === 32 && new Set(securityPlacementIds).size === securityPlacementIds.length, `camera placement table needs exactly 32 unique units after removing the two Workroom cameras; found ${securityPlacementMatches.length}`);
for (const zone of ["FRONT FOYER", "BALLROOM", "FRONT DRIVE", "FORMAL GARDEN", "REAR LAWN"]) {
  check("51 camera surveillance source invariants", securityPlacementZones.includes(zone), `camera placement table does not cover ${zone}`);
}
for (const zone of ["MAIN HALL BATHROOM", "UPPER GRAND BATHROOM", "COAT CLOSET", "WORKROOM"]) {
  check("51 camera surveillance source invariants", !securityPlacementZones.includes(zone) && cameraSecurityConfig.includes(`"${zone}"`), `${zone} is not preserved as an explicit camera-free zone`);
}
check("51 camera surveillance source invariants", /new THREE\.InstancedMesh/.test(cameraSecuritySystem) && /security-camera-housings/.test(cameraSecuritySystem) && /security-camera-lenses/.test(cameraSecuritySystem), "camera bodies do not use shared instanced presentation meshes");
check("51 camera surveillance source invariants", !/new THREE\.(?:PerspectiveCamera|SpotLight|PointLight|DirectionalLight)/.test(cameraSecuritySystem) && !/castShadow\s*=\s*true/.test(cameraSecuritySystem), "surveillance units add a render camera, shader light, or shadow caster");
check("51 camera surveillance detection", /new THREE\.Raycaster/.test(cameraSecuritySystem) && /dot\(/.test(cameraSecuritySystem) && /stealthVisibilityMultiplier/.test(cameraSecuritySystem) && /state\.isHidden/.test(cameraSecuritySystem), "camera detection lacks cone/range, line-of-sight, crouch visibility, or hiding contracts");
check("51 camera surveillance detection", /intersectObjects\(occluderMeshes, false\)/.test(cameraSecuritySystem) && /occluderMeshes\.push\(this\.panel\)/.test(hingedDoorClass) && /occluderMeshes\.push\(hedgeMazeWalls\)/.test(mansion), "camera LOS does not use the explicit wall, live-door, and hedge blocker registry");
check("51 camera surveillance detection", /illegalAction/.test(cameraSecuritySystem) && /observed-sabotage/.test(cameraSecuritySystem) && /restricted-trespass/.test(cameraSecuritySystem) && /lockdown-sighting/.test(cameraSecuritySystem), "camera policy does not distinguish observed sabotage, restricted trespass, and lockdown sightings");
check("51 camera surveillance detection", !/raiseAlarm\(/.test(patronFeedSecurityHandler) && /patronFeedSabotaged/.test(patronFeedSecurityHandler), "blind patron-feed sabotage should start lockdown without summoning Mr. Feast until a camera actually sees the player");
check("51 camera surveillance response", /MR_FEAST_RESPONSE_STATE/.test(mrFeastWanderer) && /respondToCameraAlarm/.test(mrFeastWanderer) && /updateSecurityResponse/.test(mrFeastWanderer) && /responding/.test(mrFeastWanderer) && /searching/.test(mrFeastWanderer) && /returning/.test(mrFeastWanderer), "Mr. Feast lacks the bounded patrol/responding/searching/returning alarm lifecycle");
check("51 camera surveillance diagnostics", /security:\s*cameraSecurity\?\.getDiagnostics/.test(diagnostics) && /resetCameraSecurityForQA/.test(qaHooks) && /setCameraSweepForQA/.test(qaHooks) && /advanceCameraSecurityForQA/.test(qaHooks) && /runMrFeastCameraResponseForQA/.test(qaHooks), "camera diagnostics or deterministic QA controls are missing");
check("51 camera surveillance HUD", /id="mansion-security"\s+role="status"/.test(page) && /id="mansion-security-status">Spotted</.test(page) && /Being recorded/.test(cameraSecuritySystem), "transient Spotted/Being recorded camera feedback is missing from the mansion HUD");
check("51 camera surveillance HUD", !/id="mansion-security-(?:mode|value|fill)"/.test(page) && !/\.mansion-security__track/.test(page), "camera feedback still exposes a persistent policy, percentage, or suspicion track");

// 52. The former Workshop and Cold Room are one access-controlled security
// hub. One low-rate render-target feed is refreshed per normal frame so the
// physical monitor bank can show the authoritative scanning camera poses.
const workroomBasementPartitions = section("function buildBasementPartitions()", "function furnishMainFloor()");
const basementZones = section("const basementZones", "basementZones.forEach");
const workroomFurnishings = section("function addWorkroomKeypadHardware()", "function furnishBasement()");
check("52 merged Workroom", /\[-6, 7\.6, -12, -4\.9, "WORKROOM"\]/.test(basementZones) && !/"COLD ROOM"/.test(basementZones), "Workshop and Cold Room are not one canonical WORKROOM zone");
check("52 single Workroom entrance", /label: "workroom door"/.test(workroomBasementPartitions) && !/label: "cold room door"/.test(workroomBasementPartitions) && /locked: true/.test(workroomBasementPartitions) && /onLockedActivate: \(\) => openWorkroomKeypad\(\)/.test(workroomBasementPartitions), "the Workroom does not have one keypad-locked entrance with the former Cold Room door filled");
check("52 camera-free Workroom", !securityPlacementZones.includes("WORKROOM") && /exemptZones:[^\n]+"WORKROOM"/.test(cameraSecurityConfig) && /basementCameraId: "cam-basement-archive"/.test(cameraSecuritySystem), "the Workroom still contains a public camera or owns the restricted-basement QA anchor");
check("52 balanced Workroom lighting", /"WORKROOM": \["workroom lights"\]/.test(lightingMap) && /const workroom = new LightCircuit\("workroom lights"/.test(lightingBuild) && count(lightingBuild, /workroom\.addFixture/g) === 2 && /serverLighting:[\s\S]*?intensityScale: 1\.55/.test(cameraSecurityConfig) && /lightBudgetFixtureRoles:[\s\S]*?"server-side"[\s\S]*?"operator-side"/.test(cameraSecurityConfig) && /for \(const role of WORKROOM_SECURITY\.lightBudgetFixtureRoles\)/.test(budgetedLightSelection) && /serverFixture\.userData\.workroomRole = "server-side"/.test(lightingBuild) && /operatorFixture\.userData\.workroomRole = "operator-side"/.test(lightingBuild) && /workroom-server-task-light/.test(lightingBuild) && !/cold room lights/.test(lightingBuild), "the fixed light budget does not keep both Workroom fixtures active while preserving the east task practicals");
check("52 physical keypad", /workroom-pin-pad-lock/.test(workroomFurnishings) && /workroom-keypad-physical-key/.test(workroomFurnishings) && /id="mansion-workroom-keypad"/.test(page) && count(page, /data-workroom-key/g) >= 12, "the Workroom PIN lock lacks matching in-world and touch-safe modal controls");
check("52 live monitor bank", /monitorCount: 8/.test(cameraSecurityConfig) && /workroom-live-monitor-wall/.test(workroomFurnishings) && /new THREE\.WebGLRenderTarget/.test(workroomMonitorWallSystem) && /copyViewPoseTo/.test(workroomMonitorWallSystem), "the Workroom does not have an eight-screen render-target wall driven by security-camera poses");
check("52 monitor performance", /monitorDesktopSize:[\s\S]*?width: 256, height: 144/.test(cameraSecurityConfig) && /normalFrameRenderCount = 1/.test(workroomMonitorWallSystem) && /this\.root\.visible = false/.test(workroomMonitorWallSystem) && /renderer\.setRenderTarget\(previousTarget\)/.test(workroomMonitorWallSystem), "monitor feeds are not low-resolution, time-sliced, recursion-safe, and render-state-restored");
check("52 Workroom diagnostics", /workroom: getWorkroomDiagnostics\(\)/.test(diagnostics) && /refreshMonitorWallForQA/.test(qaHooks) && /submitWorkroomCodeForQA/.test(qaHooks), "Workroom access and live feeds are not exposed to deterministic diagnostics");

// 53. Three authored Meshy masters, prepared as static browser GLBs in
// Blender, replace the primitive foyer and fountain sculpture while preserving
// the established navigation, fountain effects, and interior culling contract.
const estateStatueConfig = section("const ESTATE_STATUES", "function securityCameraPlacement");
const estateStatueLoader = section("function loadEstateStatueGltf", "function furnishMainFloor");
const estateStatueManifestEntries = Array.isArray(estateStatueManifest.statues) ? estateStatueManifest.statues : [];
const estateStatueManifestIds = estateStatueManifestEntries.map((entry) => entry.id);
const estateStatueManifestFiles = estateStatueManifestEntries.map((entry) => entry.runtimeFile);
const estateStatueConfigMatches = [...estateStatueConfig.matchAll(/id:\s*"([^"]+)"[\s\S]*?file:\s*"\.\.\/models\/mr-feast\/statues\/([^"]+)"/g)];
check("53 estate statue manifest", estateStatueManifestEntries.length === 3 && new Set(estateStatueManifestIds).size === 3, `estate statue provenance manifest needs three unique entries; found ${estateStatueManifestEntries.length}`);
check("53 estate statue manifest", estateStatueManifest.runtimeContract?.engine === "Three.js r128 GLTFLoader" && estateStatueManifest.runtimeContract?.compression === "none" && estateStatueManifest.runtimeContract?.animations === false, "estate statue manifest does not preserve the plain static Three.js r128 runtime contract");
check("53 estate statue config", estateStatueConfigMatches.length === 3, `estate statue runtime config needs three placements; found ${estateStatueConfigMatches.length}`);
check("53 estate statue config", estateStatueConfigMatches.every((match) => estateStatueManifestIds.includes(match[1]) && estateStatueManifestFiles.includes(match[2])), "estate statue runtime IDs/files drifted from the Blender provenance manifest");
check("53 estate statue placement", count(estateStatueConfig, /location:\s*"FRONT FOYER"/g) === 2 && count(estateStatueConfig, /location:\s*"FORMAL GARDEN"/g) === 1 && /centralAisleHalfWidth:\s*2\.75/.test(estateStatueConfig), "the trio is not split between two wall-side foyer placements and one garden centerpiece");
check("53 estate statue fitting", /new THREE\.Box3\(\)\.setFromObject\(model\)/.test(estateStatueLoader) && /placement\.targetHeight \/ fitSize\.y/.test(estateStatueLoader) && /model\.position\.y -= fitBounds\.min\.y/.test(estateStatueLoader), "runtime statue fitting does not derive scale and grounding from actual GLB bounds");
check("53 estate statue integration", /physics\.addFixedBox\(/.test(estateStatueLoader) && /colliderEnabled = true/.test(estateStatueLoader) && /receiveShadow = true/.test(estateStatueLoader), "estate statues lack fixed colliders or static shadow presentation");
check("53 estate statue integration", initSequence.indexOf("await loadEstateStatues()") < initSequence.indexOf("mergeStaticDecor()") && initSequence.indexOf("await loadEstateStatues()") < initSequence.indexOf("registerExteriorDetailCulling()"), "foyer statue meshes must load before static-decor merging and interior detail culling registration");
check("53 estate statue cleanup", !/function addBust\(/.test(mansion) && !/garden-fountain-(?:faceless-figure|carved-torso)/.test(mansion), "primitive foyer bust or fountain figure geometry remains in the authored statue scene");
check("53 estate statue fountain continuity", /garden-fountain-basin/.test(yardBuild) && /garden-fountain-water/.test(yardBuild) && /garden-fountain-upper-bowl/.test(yardBuild) && /garden-fountain-crown-lantern-bulb/.test(yardBuild) && /garden-fountain-crown-lantern-light/.test(yardBuild), "the new centerpiece displaced required fountain water, bowls, or crown glow");
check("53 estate statue diagnostics", /estateStatues:\s*getEstateStatueDiagnostics\(\)/.test(diagnostics) && /getEstateStatueDiagnostics/.test(qaHooks) && /legacyFountainFigureCount/.test(estateStatueLoader) && /legacyFoyerBustCount/.test(estateStatueLoader), "statue load/cost/cleanup diagnostics are not exposed to deterministic QA");
check("53 estate statue views", /foyerStatues:/.test(qaRoomViews) && /gardenFountainStatue:/.test(qaRoomViews), "focused foyer and garden statue QA framing is missing");

// 54. The front-window crosswalk is a finished upper gallery rather than a
// narrow exposed slab: it has passable depth, a continuous physical guard,
// and one shared centerline for Mr. Feast's three front patrol points.
const upperWindowGalleryConfig = section("const UPPER_WINDOW_GALLERY", "const YARD_LAYOUT");
const upperWindowGalleryStairBuild = section("function buildGrandStaircase()", "function buildRearUpperWalkwayGuard()");
check("54 upper window gallery dimensions", /depth:\s*1\.7\b/.test(upperWindowGalleryConfig) && /usableDepth:\s*1\.5\b/.test(upperWindowGalleryConfig) && /floorSlab\("upper-floor-front-crosswalk",\s*0,\s*UPPER_WINDOW_GALLERY\.centerZ,\s*UPPER_WINDOW_GALLERY\.width,\s*UPPER_WINDOW_GALLERY\.depth/.test(mansion), "front-window gallery is not at least 1.7 m deep with 1.5 m of named usable clearance");
check("54 upper window gallery guard", /addRailingRun\("x",\s*-UPPER_WINDOW_GALLERY\.guardSpan \/ 2,\s*UPPER_WINDOW_GALLERY\.guardSpan \/ 2,\s*UPPER_WINDOW_GALLERY\.guardZ/.test(upperWindowGalleryStairBuild) && /upper-window-gallery-guard/.test(upperWindowGalleryStairBuild) && /physics\.addFixedBox\(0,\s*FLOOR\.UPPER \+ 0\.5,\s*UPPER_WINDOW_GALLERY\.guardZ/.test(upperWindowGalleryStairBuild), "front-window gallery lacks a full matching railing and Rapier edge guard");
check("54 upper window gallery patrol", count(mrFeastPatrolRoute, /UPPER_WINDOW_GALLERY\.patrolZ/g) === 3, "Mr. Feast's east, center, and west front-gallery patrol points do not share the widened deck centerline");
check("54 upper window gallery diagnostics", /upperWindowGallery:\s*getUpperWindowGalleryDiagnostics\(\)/.test(diagnostics) && /upperWindowGalleryFoyer:/.test(qaRoomViews), "upper-window gallery diagnostics or focused foyer framing are missing");

// The page must request a new asset URL or browsers can keep the pre-renovation
// script despite all source fixes.
const grandStairBuild = section("function buildGrandStaircase()", "function buildRearUpperWalkwayGuard()");
check("29 connected grand stair balusters", /const grandRailHeight = 0\.97;/.test(grandStairBuild) && count(grandStairBuild, /topY \+ grandRailHeight \/ 2/g) === 2 && /addBalusterInstanceBatch\("grand-stair-balusters", stairBatches\.balusters, grandRailHeight\)/.test(grandStairBuild), "grand-stair balusters must extend from each tread to the sloped handrail");
check("29 lounge artwork clearance", /upperArtBanquet: \[-2\.0, FLOOR\.UPPER, -9\.4, Math\.PI \/ 2\]/.test(mansion) && /center: -8\.25[^\n]+artId: "banquet-forgot-guests"/.test(mansion), "rear-lounge banquet painting still intersects the fireplace mantle or its QA view is stale");
check("34 library sconce clearance", /library\.addWallSconce\(-7\.05, FLOOR\.MAIN \+ 2\.0, 3\.361, 0, 32, 5\.8,[^\n]+-9\.45, FLOOR\.MAIN \+ 1\.05, 7\.55\);/.test(mansion), "library wall sconce is not mounted on the clear south-wall panel");
check("29 music-room sconce clearance", /music\.addWallSconce\(14\.839, FLOOR\.MAIN \+ 2\.0, 10\.75,[^\n]+FLOOR\.MAIN \+ 1\.05, 9\.6\);/.test(mansion), "music-room wall sconce still overlaps its portrait");
check("38 reading-room sconce clearance", /readingRoom\.addWallSconce\(10\.0, FLOOR\.UPPER \+ 1\.9, -3\.039, 0, 28, 5\.4,[^\n]+9\.0, FLOOR\.UPPER \+ 1\.0, 0\);/.test(mansion), "reading-room wall sconce still overlaps the east-wall window or bookcases");
check("38 upper bathroom switch orientation", /upperGrandBathroom\.addSwitch\(-8\.7, FLOOR\.UPPER \+ 1\.15, 3\.039, Math\.PI\);/.test(mansion), "upper bathroom north-wall switch still faces through the wall");
check("39 front threshold material seam", /front-portico-floor", w: 6\.6, h: 0\.2, d: 2\.9, x: 0, y: -0\.1, z: 13\.45/.test(mansion), "front portico stone still overlaps the foyer hardwood at the door threshold");
check("40 main bathroom switch orientation", /mainHallBathroom\.addSwitch\(-8\.75, 1\.15, -3\.039, 0\);/.test(mansion) && /mainHallBathroom\.addSwitch\(-8\.5, 1\.15, 3\.039, Math\.PI\);/.test(mansion), "main bathroom doorway switches are not mounted on the bathroom-facing sides of their walls");
for (const view of ["mainHallBathroomShowerLight", "upperGrandBathroomShowerLight", "mainHallSinkInteract", "mainHallBathroomSouthSwitch", "mainHallBathroomNorthSwitch"]) {
  check("40 bathroom fixture QA views", qaRoomViews.includes(`${view}:`), `missing bathroom inspection view ${view}`);
}
const cacheKey = page.match(/mr-feast-mansion\.js\?v=([^"']+)/)?.[1] || "";
const runtimeCacheVersion = mansion.match(/const MANSION_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
check("closed door lintel fit", /height:\s*doorH\s*-\s*0\.02/.test(mansion), "hinged door leaves still leave a visible gap beneath the lintel");
check("cache key", Boolean(runtimeCacheVersion) && cacheKey === runtimeCacheVersion, `mansion page cache key (${cacheKey || "missing"}) does not match the runtime cache version (${runtimeCacheVersion || "missing"})`);
check("26 page-owned boot watchdog", /window\.__MR_FEAST_BOOT__\s*=/.test(page) && /const BOOT_STALL_TIMEOUT_MS\s*=\s*60000/.test(page) && /progress\(phase, percent\)[\s\S]*?armTimer\(\)/.test(page), "the page shell does not use a progress-aware cold-start watchdog");
check("26 page-owned boot watchdog", /aria-busy/.test(page) && /Retry loading/.test(page) && /mansion-enter/.test(page), "the page-owned watchdog does not restore an actionable entry button");
check("26 runtime script error recovery", /mr-feast-mansion\.js[^>]+onerror=["'][^"']*__MR_FEAST_BOOT__[^"']*\.fail/.test(page), "a network error on the core mansion script leaves the page disabled");
check("26 runtime boot handshake", /const boot\s*=\s*window\.__MR_FEAST_BOOT__/.test(mansion) && /boot\?\.progress\(/.test(mansion) && /boot\?\.settle\(\)/.test(mansion) && /boot\?\.ready\(\)/.test(mansion), "the runtime does not refresh and settle the independent page watchdog across progress, failure, and success");
let pageBootProbe = null;
try {
  const bootSource = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source.includes("window.__MR_FEAST_BOOT__"));
  const attributes = {};
  const stage = { setAttribute: (name, value) => { attributes[`stage:${name}`] = value; } };
  const loading = { hidden: true, textContent: "", setAttribute: (name, value) => { attributes[`loading:${name}`] = value; } };
  const enter = { disabled: true, textContent: "", dataset: {}, onclick: null, removeAttribute: (name) => { attributes[`enter:${name}`] = "removed"; } };
  const introLead = { textContent: "" };
  const elements = { "mansion-stage": stage, "mansion-loading": loading, "mansion-enter": enter };
  let timeoutCallback = null;
  let reloaded = false;
  const locationProbe = { protocol: "http:", href: "", reload: () => { reloaded = true; } };
  const windowProbe = { setTimeout: (callback) => { timeoutCallback = callback; return 1; } };
  const documentProbe = {
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => selector === ".mansion-intro__lead" ? introLead : null,
  };
  new Function("window", "document", "location", "clearTimeout", bootSource)(windowProbe, documentProbe, locationProbe, () => {});
  timeoutCallback();
  enter.onclick();
  pageBootProbe = {
    status: windowProbe.__MR_FEAST_BOOT__.status,
    stageReady: attributes["stage:aria-busy"] === "false",
    alert: attributes["loading:role"] === "alert",
    loadingVisible: loading.hidden === false,
    retryEnabled: enter.disabled === false && enter.textContent === "Retry loading" && reloaded,
  };
} catch (_) {
  pageBootProbe = null;
}
check("26 executable page watchdog", pageBootProbe && Object.values(pageBootProbe).every(Boolean), "page-owned timeout does not execute into a visible retry state");

// Local testing must not depend on an agent-owned server process that vanishes
// between sessions. The Finder-friendly launcher owns a loopback-only server,
// waits for this exact game page, and then opens the playable URL.
check("local launcher", fs.existsSync(localLauncherPath), "missing one-click Open Mr Feast Mansion.command launcher");
check("local launcher", /^#!\/bin\/zsh/m.test(localLauncher), "local launcher is not a macOS double-clickable zsh command");
check("local launcher", /--bind\s+127\.0\.0\.1/.test(localLauncher), "local launcher must bind only to the local machine");
check("local launcher", /games\/mr-feast-mansion\.html/.test(localLauncher) && /Mr Feast's Mansion/.test(localLauncher), "local launcher does not validate and open the mansion page");
check("local launcher", /\.mr-feast-local-server\.pid/.test(localLauncher), "local launcher does not retain a reusable local-server pid");
check("local launcher", /Keep this window open/.test(localLauncher) && /wait\s+"\$\{SERVER_PID\}"/.test(localLauncher), "local launcher does not keep ownership of its server process while the game is open");
check("local launcher guidance", /Open Mr Feast Mansion\.command/.test(localBootstrap), "direct-file fallback does not name the one-click launcher");
check("local launcher guidance", /launcher will open the correct page automatically/i.test(localBootstrap), "direct-file fallback does not explain that the launcher opens the playable page");
check("local launcher guidance", /Server running\? Open game/.test(localBootstrap), "direct-file fallback still presents a misleading server-start action");

if (failures.length) {
  console.error(`Mr. Feast renovation regression: ${failures.length} unmet invariant${failures.length === 1 ? "" : "s"}`);
  failures.forEach((failure, index) => {
    console.error(`${String(index + 1).padStart(2, "0")}. [${failure.requirement}] ${failure.detail}`);
  });
  process.exitCode = 1;
} else {
  console.log("Mr. Feast renovation regression: all renovation invariants passed");
}
