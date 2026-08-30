import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_SEATING_TEST_PORT || (52000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-seating-and-routes");
const contestantIds = Object.freeze(["mara-voss", "kip-solano", "juniper-cross"]);
const seatedHandClearanceByContestant = Object.freeze({
  "mara-voss": 0.14,
  "kip-solano": 0.15,
  "juniper-cross": 0.21,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const radians = (degrees) => degrees * Math.PI / 180;

function assertAttentionProbe(probe, label) {
  assert(probe?.acquired?.active && probe.acquired.inRange && probe.acquired.inFov, `${label} should notice a nearby player inside its field of view: ${JSON.stringify(probe)}`);
  assert(Math.abs(probe.acquired.yaw) >= radians(8), `${label} head turn is too subtle to read: ${JSON.stringify(probe.acquired)}`);
  if (label === "Mr. Feast") {
    assert(probe.acquired.visualTurnDegrees >= 8, `${label} must visibly turn the face rig, not only update an internal yaw number: ${JSON.stringify(probe.acquired)}`);
    assert(probe.acquired.visualFacingDot >= 0.96, `${label} face marker should point toward the nearby player after attention settles: ${JSON.stringify(probe.acquired)}`);
    assert(probe.samples.every((sample) => Math.abs(sample.visualYawDegrees) <= probe.limits.maxYawDegrees + 0.5), `${label} visible face yaw exceeded the anatomical limit: ${JSON.stringify(probe.samples)}`);
  }
  assert(Math.abs(probe.bodyYawAfter - probe.bodyYawBefore) <= 0.001, `${label} passive attention must remain head-and-neck-only: ${JSON.stringify(probe)}`);
  assert(Math.abs(probe.afterFirstFrame.yaw) > 0 && Math.abs(probe.afterFirstFrame.yaw) < Math.abs(probe.acquired.yaw) * 0.8, `${label} attention should ease in instead of snapping: ${JSON.stringify(probe)}`);
  assert(Math.abs(probe.afterFirstReturnFrame.yaw) > radians(0.25) && Math.abs(probe.afterFirstReturnFrame.yaw) < Math.abs(probe.acquired.yaw), `${label} attention should ease back instead of snapping neutral: ${JSON.stringify(probe)}`);
  assert(Math.abs(probe.returned.yaw) <= radians(1) && Math.abs(probe.returned.pitch) <= radians(1), `${label} attention should settle back to neutral: ${JSON.stringify(probe.returned)}`);
  const yawLimit = radians(probe.limits.maxYawDegrees) + 0.001;
  const pitchLimit = radians(probe.limits.maxPitchDegrees) + 0.001;
  assert(probe.limits.maxYawDegrees >= 25 && probe.limits.maxYawDegrees <= 40, `${label} yaw limit should be visible but anatomical: ${JSON.stringify(probe.limits)}`);
  assert(probe.limits.maxPitchDegrees >= 10 && probe.limits.maxPitchDegrees <= 22, `${label} pitch limit should be anatomical: ${JSON.stringify(probe.limits)}`);
  assert(probe.maximumObservedYaw <= yawLimit && probe.maximumObservedPitch <= pitchLimit, `${label} exceeded its anatomical clamp: ${JSON.stringify(probe)}`);
  assert(probe.samples.every((sample) => Math.abs(sample.headQuaternionLength - 1) <= 0.0001), `${label} accumulated an invalid head quaternion: ${JSON.stringify(probe.samples)}`);
}

async function inspectHeadShading(glbPath) {
  const bytes = await readFile(glbPath);
  assert(bytes.toString("ascii", 0, 4) === "glTF", `${glbPath} is not GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).replace(/\0+$/, ""));
  const binHeader = 20 + jsonLength;
  assert(bytes.readUInt32LE(binHeader + 4) === 0x004e4942, `${glbPath} has no BIN chunk`);
  const binOffset = binHeader + 8;
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  const readComponent = {
    5121: (offset) => bytes.readUInt8(offset),
    5123: (offset) => bytes.readUInt16LE(offset),
    5125: (offset) => bytes.readUInt32LE(offset),
    5126: (offset) => bytes.readFloatLE(offset),
  };
  const readAccessor = (index) => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const width = componentCount[accessor.type];
    const scalarBytes = componentBytes[accessor.componentType];
    const stride = view.byteStride || width * scalarBytes;
    const start = binOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return Array.from({ length: accessor.count }, (_, item) => Array.from(
      { length: width },
      (_, component) => readComponent[accessor.componentType](start + item * stride + component * scalarBytes),
    ));
  };
  const primitive = json.meshes[0].primitives[0];
  assert(primitive.attributes.NORMAL !== undefined, `${glbPath} is missing vertex normals`);
  const positions = readAccessor(primitive.attributes.POSITION);
  const normals = readAccessor(primitive.attributes.NORMAL);
  const joints = readAccessor(primitive.attributes.JOINTS_0);
  const weights = readAccessor(primitive.attributes.WEIGHTS_0);
  const indices = readAccessor(primitive.indices).flat();
  const jointNames = json.skins[0].joints.map((nodeIndex) => json.nodes[nodeIndex].name);
  const headJointIndices = new Set(
    [jointNames.indexOf("Head"), jointNames.indexOf("neck")].filter((index) => index >= 0),
  );
  const headWeights = joints.map((vertexJoints, vertex) => vertexJoints.reduce(
    (total, joint, slot) => total + (headJointIndices.has(joint) ? weights[vertex][slot] : 0),
    0,
  ));
  const normalLengths = normals.map((normal) => Math.hypot(...normal));
  let headTriangles = 0;
  let flatHeadTriangles = 0;
  let invertedHeadTriangles = 0;
  let degenerateHeadTriangles = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = indices.slice(offset, offset + 3);
    if (ids.filter((id) => headWeights[id] > 0.25).length < 2) continue;
    headTriangles += 1;
    const [a, b, c] = ids.map((id) => positions[id]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const geometric = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...geometric);
    if (length < 1e-9) {
      degenerateHeadTriangles += 1;
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) geometric[axis] /= length;
    const dots = ids.map((id) => normals[id].reduce(
      (sum, value, axis) => sum + value * geometric[axis],
      0,
    ));
    if (dots.every((dot) => Math.abs(dot) >= 0.9999)) flatHeadTriangles += 1;
    if (dots.reduce((sum, dot) => sum + dot, 0) / 3 < 0) invertedHeadTriangles += 1;
  }
  return {
    headWeightedVertices: headWeights.filter((weight) => weight > 0.25).length,
    headTriangles,
    flatHeadTriangleRatio: flatHeadTriangles / headTriangles,
    invertedHeadTriangleRatio: invertedHeadTriangles / headTriangles,
    degenerateHeadTriangles,
    normalsFinite: normalLengths.every(Number.isFinite),
    minimumNormalLength: Math.min(...normalLengths),
    maximumNormalLength: Math.max(...normalLengths),
  };
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

function watchErrors(page, errors, prefix = "", ignoredPatterns = []) {
  page.on("pageerror", (error) => errors.push(`${prefix}${error.message}`));
  page.on("console", (message) => {
    if (ignoredPatterns.some((pattern) => pattern.test(message.text()))) return;
    const bindingWarning = message.type() === "warning" && /propertybinding|no target node|could not bind/i.test(message.text());
    if ((message.type() === "error" || bindingWarning) && !/favicon\.ico/i.test(message.text())) {
      errors.push(`${prefix}${message.text()}`);
    }
  });
}

async function pressKey(page, code, key) {
  await page.evaluate(({ code, key }) => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
  }, { code, key });
}

async function pressInteract(page) {
  await pressKey(page, "KeyE", "e");
}

async function holdMove(page, { sprint = false, seconds = 0.75 } = {}) {
  if (sprint) await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.evaluate((duration) => window.MrFeastFresh.advancePlayerForQA(duration), seconds);
  await page.keyboard.up("w");
  if (sprint) await page.keyboard.up("Shift");
  return diagnostics(page);
}

function entryById(state, id) {
  return state.contestants.entries.find((entry) => entry.id === id) || null;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const manifestPath = path.join(root, "assets/models/mr-feast/contestants/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  // Keep the first failure focused on the missing feature rather than waiting
  // for three WebGL character loads. This is the red-first milestone gate.
  assert(/const MANSION_SEATING\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MANSION_SEATING tuning table");
  assert(/const CONTESTANT_ACTIVITY\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the contestant activity state table");
  assert(/class MansionSeatingSystem/.test(runtimeSource), "runtime is missing MansionSeatingSystem");
  assert(/runContestantRoutineForQA/.test(runtimeSource), "runtime is missing deterministic contestant routine QA");
  assert(/const CONTESTANT_SEATED_IDLE_MOTION\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the planted procedural seated-idle tuning table");
  assert(/advanceContestantSeatedIdleForQA/.test(runtimeSource), "runtime is missing deterministic seated-idle motion QA");
  assert(/readingRoomSofaHeightScale:\s*0\.77/.test(runtimeSource), "runtime is missing the lower Reading Room sofa tuning value");
  assert(/regularChairHeightScale:\s*0\.86/.test(runtimeSource), "runtime is missing the fitted regular-chair height tuning value");
  assert(/getSeatingState/.test(runtimeSource), "runtime is missing focused seating diagnostics");
  assert(/sanitizeLocomotionClip/.test(runtimeSource), "contestant walk clips must strip the source arm tracks before playback");
  assert(/canCharacterOccupy/.test(runtimeSource), "NPC movement must reject fixed furniture footprints rather than relying on route clearance alone");
  assert(/probeFurnitureCollisionForQA/.test(runtimeSource), "runtime is missing deterministic NPC furniture-collision QA");
  assert(/preserveContestantModelOrientation/.test(runtimeSource), "contestant GLBs must preserve GLTFLoader's imported Y-up orientation");
  assert(!/model\.rotation\.x\s*=\s*-Math\.PI\s*\/\s*2/.test(runtimeSource), "contestant models must not receive a second X-axis conversion after GLTFLoader");
  assert(/updateHeadAttention/.test(runtimeSource), "contestants need nearby field-of-view head attention with anatomical limits");
  assert(/probeNpcAttentionForQA/.test(runtimeSource), "runtime is missing deterministic contestant and Mr. Feast head-attention QA");
  assert(/applyRelaxedArmPose/.test(runtimeSource), "contestants need one coherent relaxed arm pose layer for standing, walking, and seating");

  for (const id of contestantIds) {
    const spec = manifest.characters.find((entry) => entry.id === id);
    assert(spec?.animations?.idle?.file && spec.animations.idle.name === "neutral-idle", `${id} is missing its relaxed neutral idle clip`);
    assert(spec?.animations?.walk?.file, `${id} is missing its walk clip manifest entry`);
    const idlePath = path.join(path.dirname(manifestPath), spec.animations.idle.file);
    const modelPath = path.join(path.dirname(manifestPath), spec.model);
    const idleReportPath = idlePath.replace(/\.glb$/i, ".animation-report.json");
    const walkPath = path.join(path.dirname(manifestPath), spec.animations.walk.file);
    const walkReportPath = walkPath.replace(/\.glb$/i, ".animation-report.json");
    const [idleStats, idleReport, walkStats, walkReport] = await Promise.all([
      stat(idlePath),
      readFile(idleReportPath, "utf8").then(JSON.parse),
      stat(walkPath),
      readFile(walkReportPath, "utf8").then(JSON.parse),
    ]);
    assert(idleStats.size > 1_000 && idleStats.size <= 128 * 1024, `${id} neutral idle clip exceeds the 128 KiB budget (${idleStats.size})`);
    assert(
      idleReport.name === "neutral-idle"
      && idleReport.stationary === true
      && idleReport.loopClosed === true
      && idleReport.channelsAfter?.rotation >= 20
      && idleReport.channelsAfter?.translation === 0
      && idleReport.channelsAfter?.scale === 0,
      `${id} neutral idle must be a loop-closed stationary rotation-only action; got ${JSON.stringify(idleReport)}`,
    );
    assert(walkStats.size > 1_000 && walkStats.size <= 512 * 1024, `${id} walk clip exceeds the 512 KiB budget (${walkStats.size})`);
    assert(
      walkReport.name === "walk"
      && walkReport.stationary === true
      && walkReport.channelsAfter?.rotation >= 20
      && walkReport.channelsAfter?.translation === 0
      && walkReport.channelsAfter?.scale === 0,
      `${id} walk clip must be a stationary rotation-only rig action; got ${JSON.stringify(walkReport)}`,
    );
    const shading = await inspectHeadShading(modelPath);
    assert(shading.headWeightedVertices >= 1_000 && shading.headTriangles >= 1_500, `${id} head coverage is invalid: ${JSON.stringify(shading)}`);
    assert(shading.normalsFinite && shading.minimumNormalLength >= 0.999 && shading.maximumNormalLength <= 1.001, `${id} normals are invalid: ${JSON.stringify(shading)}`);
    assert(shading.degenerateHeadTriangles === 0 && shading.invertedHeadTriangleRatio <= 0.005, `${id} head has degenerate or inverted shading: ${JSON.stringify(shading)}`);
    assert(shading.flatHeadTriangleRatio <= 0.02, `${id} head is visibly faceted: ${JSON.stringify(shading)}`);
  }

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const desktopErrors = [];
    watchErrors(desktop, desktopErrors);
    await desktop.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await desktop.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await desktop.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await desktop.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    await desktop.waitForTimeout(300);

    let state = await diagnostics(desktop);
    assert(state.seating?.total >= 20, `chairs and sofas should register reusable seats; got ${JSON.stringify(state.seating)}`);
    assert(state.seating.entries.some((entry) => entry.kind === "chair"), "seating registry should include standard chairs");
    assert(state.seating.entries.some((entry) => entry.kind === "sofa"), "seating registry should include sofa slots");
    assert(state.seating.occupied === 0 && state.seating.player.seated === false, "fresh seating should begin unoccupied");
    const readingRoomSofa = state.seating.entries.find((entry) => entry.tag === "reading-room-sofa");
    const standardSofaSlots = state.seating.entries.filter((entry) => entry.kind === "sofa" && entry.tag !== "reading-room-sofa");
    const regularChairs = state.seating.entries.filter((entry) => entry.kind === "chair");
    assert(readingRoomSofa?.heightScale === 0.77, `Reading Room sofa should use only the named lower profile; got ${JSON.stringify(readingRoomSofa)}`);
    assert(readingRoomSofa.supportHeight >= 0.55 && readingRoomSofa.supportHeight <= 0.56, `Reading Room cushion top should sit near 0.55m; got ${JSON.stringify(readingRoomSofa)}`);
    assert(Math.abs(readingRoomSofa.colliderHeight / 1.3 - readingRoomSofa.heightScale) <= 0.001, `Reading Room sofa collider must follow its visual height scale; got ${JSON.stringify(readingRoomSofa)}`);
    assert(Math.abs(readingRoomSofa.colliderCenterHeight - readingRoomSofa.colliderHeight / 2) <= 0.001 && Math.abs(readingRoomSofa.colliderBottomHeight) <= 0.001, `Reading Room sofa collider must remain floor-anchored; got ${JSON.stringify(readingRoomSofa)}`);
    assert(Math.abs(readingRoomSofa.colliderTopHeight - readingRoomSofa.visualBackTopHeight) <= 0.03, `Reading Room sofa collider must track the shortened visible back; got ${JSON.stringify(readingRoomSofa)}`);
    assert(standardSofaSlots.length >= 2 && standardSofaSlots.every((entry) => (
      Math.abs(entry.heightScale - 1) <= 0.001
      && Math.abs(entry.supportHeight - 0.72) <= 0.001
      && Math.abs(entry.colliderHeight - 1.3) <= 0.001
      && Math.abs(entry.colliderBottomHeight) <= 0.001
    )), `all non-Reading-Room sofas should retain their original height; got ${JSON.stringify(standardSofaSlots)}`);
    assert(regularChairs.length >= 17 && regularChairs.every((entry) => (
      Math.abs(entry.heightScale - 0.86) <= 0.001
      && entry.supportHeight >= 0.52
      && entry.supportHeight <= 0.53
      && Math.abs(entry.supportHeight - entry.visualSeatTopHeight) <= 0.001
      && Math.abs(entry.colliderHeight - 1.1) <= 0.001
      && Math.abs(entry.colliderBottomHeight) <= 0.001
      && Math.abs(entry.colliderTopHeight - entry.visualBackTopHeight) <= 0.03
    )), `all standard chairs should share the fitted floor-anchored profile; got ${JSON.stringify(regularChairs)}`);

    // --- Real player E interaction and movement lock ------------------------
    const sofaSeat = state.seating.entries.find((entry) => entry.kind === "sofa" && !entry.occupiedBy);
    assert(sofaSeat, "expected at least one available sofa slot");
    const approach = await desktop.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), sofaSeat.id);
    assert(approach?.seatId === sofaSeat.id && approach.distance <= 2.35, `QA seat placement should use a real interaction approach; got ${JSON.stringify(approach)}`);
    await desktop.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(desktop);
    await desktop.waitForTimeout(100);
    state = await diagnostics(desktop);
    assert(state.seating.player.seated && state.seating.player.seatId === sofaSeat.id, `E should occupy the aimed sofa slot; got ${JSON.stringify(state.seating.player)}`);
    assert(state.seating.player.movementLocked && state.player.movement.mode === "seated", "sitting should select the authoritative movement-locked seated mode");
    assert(state.hidden === false && state.player.hidden === false, "sitting must stay visible to cameras and danger");
    assert(state.player.movement.eyeHeight < state.player.movement.standingEyeHeight - 0.2, "sitting should visibly lower the player's eye line");
    assert(/^stand up$/i.test(state.prompt || ""), `the occupied seat should expose Stand up; got ${state.prompt}`);
    const occupiedSofa = state.seating.entries.find((entry) => entry.id === sofaSeat.id);
    assert(planarDistance(state.player, occupiedSofa.position) < 0.12, "the authoritative player body should move to the visible seated position");
    assert(state.seating.player.colliderEnabled === false, "the player collider should be disabled only while embedded in furniture");

    const seatedEnergy = state.player.movement.energy;
    const seatedPlayerPosition = state.player;
    await pressKey(desktop, "KeyC", "c");
    const afterBlockedMove = await holdMove(desktop, { sprint: true, seconds: 0.8 });
    assert(planarDistance(seatedPlayerPosition, afterBlockedMove.player) < 0.01, "W/Shift must not move the seated player capsule");
    assert(afterBlockedMove.player.movement.mode === "seated" && !afterBlockedMove.player.movement.crouched && !afterBlockedMove.player.movement.sprinting, "seated input must not crouch or sprint");
    assert(Math.abs(afterBlockedMove.player.movement.energy - seatedEnergy) < 0.01, "blocked seated sprint input must not drain energy");

    await pressKey(desktop, "Escape", "Escape");
    state = await diagnostics(desktop);
    assert(state.menus.escapeOpen, "Escape menu should remain available while seated");
    await pressKey(desktop, "Escape", "Escape");
    await pressInteract(desktop);
    await desktop.waitForTimeout(80);
    state = await diagnostics(desktop);
    assert(!state.seating.player.seated && state.player.movement.mode !== "seated", "second real E interaction should stand the player");
    assert(state.seating.entries.find((entry) => entry.id === sofaSeat.id).occupiedBy === null, "standing should release the sofa slot");
    const afterStandStart = state.player;
    const afterStandMove = await holdMove(desktop, { seconds: 0.45 });
    assert(planarDistance(afterStandStart, afterStandMove.player) > 0.35, "normal movement should resume after standing");

    // --- Exclusive occupancy and transient save/load recovery ---------------
    await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    const blockedNpcSeat = await desktop.evaluate(({ id, seatId }) => window.MrFeastFresh.seatContestantForQA(id, seatId), { id: "juniper-cross", seatId: sofaSeat.id });
    assert(blockedNpcSeat?.seated === false && /occupied/i.test(blockedNpcSeat.reason || ""), `a contestant must not steal the player's seat; got ${JSON.stringify(blockedNpcSeat)}`);
    assert(await desktop.evaluate(() => window.MrFeastFresh.saveGameForQA()), "saving should remain available while seated");
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const npcSeat = await desktop.evaluate(({ id, seatId }) => window.MrFeastFresh.seatContestantForQA(id, seatId), { id: "juniper-cross", seatId: sofaSeat.id });
    assert(npcSeat?.seated === true && npcSeat.seatId === sofaSeat.id, `released seat should accept a contestant; got ${JSON.stringify(npcSeat)}`);
    const blockedPlayerSeat = await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    assert(blockedPlayerSeat?.seated === false && /occupied/i.test(blockedPlayerSeat.reason || ""), `player must not steal an NPC seat; got ${JSON.stringify(blockedPlayerSeat)}`);
    await desktop.evaluate(() => window.MrFeastFresh.standContestantForQA("juniper-cross"));
    await desktop.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    assert(await desktop.evaluate(() => window.MrFeastFresh.loadGameForQA()), "the seated save should restore as a compatible save");
    state = await diagnostics(desktop);
    assert(!state.seating.player.seated && state.seating.occupied === 0, "load should clear transient seat reservations rather than restore a stale seated state");

    // --- Chair cushion/back resolver and tamper compatibility ----------------
    const chairSeat = state.seating.entries.find((entry) => entry.kind === "chair" && entry.tamperId && !entry.tag && !entry.occupiedBy);
    assert(chairSeat, "standard chair seats should link to the existing tamper entry");
    await desktop.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), chairSeat.id);
    await desktop.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(desktop);
    const occupiedTamper = await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, true), chairSeat.tamperId);
    assert(occupiedTamper?.tampered === false && /occupied/i.test(occupiedTamper.blockedReason || ""), `occupied chairs must reject tampering; got ${JSON.stringify(occupiedTamper)}`);
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const vacantTamper = await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, true), chairSeat.tamperId);
    assert(vacantTamper?.tampered === true, `vacant chair should keep the existing tamper action; got ${JSON.stringify(vacantTamper)}`);
    await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, false), chairSeat.tamperId);

    // --- Three deterministic walk-idle-sit routines --------------------------
    for (const id of contestantIds) {
      const initial = entryById(await diagnostics(desktop), id);
      assert(initial?.size?.y >= 1.65 && initial.size.y <= 1.9, `${id} should retain its authored human-scale vertical height; got ${JSON.stringify(initial?.size)}`);
      assert(initial.size.y > initial.size.x && initial.size.y > initial.size.z, `${id} must remain upright after GLTF loading; got ${JSON.stringify(initial.size)}`);
      assert(initial?.route?.points >= 3, `${id} needs a compact multi-point route; got ${JSON.stringify(initial?.route)}`);
      assert(initial.route.length >= 1 && initial.route.length <= 8, `${id} route should remain room-scale; got ${initial.route.length}m`);
      assert(initial.route.seatStops >= 1 && initial.route.seatPauseSeconds >= 30 && initial.route.estimatedSeatedShare >= 0.6 && initial.route.behavior === "sit-dominant-hangout", `${id} should spend most of the routine seated, with walking used only between hangouts; got ${JSON.stringify(initial.route)}`);
      assert(initial.route.seatPauseSeconds <= initial.route.maximumSeatDwellSeconds && initial.route.maximumSeatDwellSeconds < 300, `${id} seated dwell must be hard-clamped below five minutes; got ${JSON.stringify(initial.route)}`);
      assert(initial.route.minimumPostSeatWalkDistance >= 0.35, `${id} needs a meaningful post-seat departure distance; got ${JSON.stringify(initial.route)}`);
      assert(initial.route.minimumPatrolClearance >= 1.65, `${id} route is too close to Mr. Feast's patrol; got ${initial.route.minimumPatrolClearance}m`);
      assert(initial.route.minimumStaticClearance >= 0.28, `${id} route clips fixed furniture or walls; got ${initial.route.minimumStaticClearance}m clearance`);
      assert(initial.animation?.available?.includes("walk") && initial.animation.available.includes("idle"), `${id} should bind idle and walk actions; got ${JSON.stringify(initial.animation)}`);
      const handOrientationSamples = await desktop.evaluate((contestantId) => {
        const samples = [window.MrFeastFresh.restoreContestantIdleForQA(contestantId)];
        samples.push(...[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((phase) => (
          window.MrFeastFresh.poseContestantWalkingForQA(contestantId, phase)
        )));
        return samples;
      }, id);
      assert(handOrientationSamples.every((sample) => sample?.armPose?.valid), `${id} needs valid standing and walking hand diagnostics; got ${JSON.stringify(handOrientationSamples)}`);
      assert(handOrientationSamples.every((sample) => sample.armPose.minimumPalmTowardBodyAlignment >= 0.7), `${id} should preserve inward-facing palms at both walk-swing extremes; got ${JSON.stringify(handOrientationSamples)}`);
      assert(handOrientationSamples.every((sample) => sample.armPose.maximumPalmForwardAlignment <= 0.02), `${id} palms should stay beside or slightly behind the body plane instead of opening toward the contestant's forward view; got ${JSON.stringify(handOrientationSamples)}`);
      if (id === "kip-solano") {
        const wristSamples = handOrientationSamples;
        const wristSides = wristSamples.flatMap((sample) => Object.values(sample.wristGeometry?.sides || {}));
        assert(wristSamples.every((sample) => sample.wristGeometry?.valid) && wristSides.every((side) => side.samples >= 24), `Kip needs valid deformed wrist cross-sections in idle and throughout the walk cycle; got ${JSON.stringify(wristSamples)}`);
        assert(wristSides.every((side) => side.minorSectionRetention >= 0.78), `Kip's skinned wrists should retain their thickness instead of collapsing into a thin twist; got ${JSON.stringify(wristSamples)}`);
        assert(wristSides.every((side) => side.handTwistDegrees <= 66 && side.handSwingDegrees <= 60), `Kip's hand joints should eliminate the excessive 85-105 degree wrist twist without introducing a sharp bend; got ${JSON.stringify(wristSamples)}`);
        assert(wristSamples.every((sample) => sample.armPose.maximumHandLocalOffsetDegrees <= 70), `Kip's walking hand joints should stay within 70 degrees of bind so the skinned wrists retain their thickness; got ${JSON.stringify(wristSamples)}`);
      }
      await desktop.evaluate((contestantId) => window.MrFeastFresh.restoreContestantIdleForQA(contestantId), id);
      const result = await desktop.evaluate(({ id, seconds }) => window.MrFeastFresh.runContestantRoutineForQA(id, seconds), { id, seconds: 90 });
      assert(result?.completed === true && result.cycles >= 1, `${id} should complete a deterministic routine cycle; got ${JSON.stringify(result)}`);
      assert(result.activities.includes("walking") && result.activities.includes("idle") && result.activities.includes("seated"), `${id} routine should walk, pause, and sit; got ${JSON.stringify(result.activities)}`);
      assert(result.distanceTravelled >= 1 && result.teleports === 0, `${id} should materially walk without teleporting; got ${JSON.stringify(result)}`);
      assert(result.maximumArmSwingRadians >= 0.08 && result.maximumArmSwingRadians <= 0.11, `${id} walk should have a restrained procedural counter-swing instead of frozen or flailing arms; got ${JSON.stringify(result)}`);
      assert(result.minimumWalkingPalmTowardBodyAlignment >= 0.7, `${id} should keep both palms naturally facing the torso throughout the walking swing; got ${JSON.stringify(result)}`);
      assert(result.segmentsTraversed >= (initial.route.points - 1) * 2 - 1, `${id} should visit the authored loop while skipping only the duplicate seat-exit waypoint; got ${JSON.stringify(result)}`);
      assert(result.seatExitsCompleted >= 2, `${id} QA cycle should include both outbound and return seat exits; got ${JSON.stringify(result)}`);
      assert(result.postSeatDeparturesCompleted === result.seatExitsCompleted && result.postSeatDeparturePending === false, `${id} must walk to a different hangout after every seat exit; got ${JSON.stringify(result)}`);
      assert(result.minimumPostSeatDepartureDistance >= initial.route.minimumPostSeatWalkDistance, `${id} post-seat walk was too short; got ${JSON.stringify(result)}`);
      assert(result.maximumRootStep <= 0.09, `${id} sit/stand ingress should interpolate without a visible root snap; got ${JSON.stringify(result)}`);
      assert(result.maximumTransitionArmStepRadians <= 0.22, `${id} arms should blend through sit/stand transitions without an IK pop; got ${JSON.stringify(result)}`);
      assert(result.blockedSteps === 0 && result.maximumColliderOffset <= 0.03, `${id} collider should follow the rendered root; got ${JSON.stringify(result)}`);
      assert(result.floorStayedFixed === true && result.minimumPatrolClearance >= 1.65 && result.minimumStaticClearance >= 0.28, `${id} should remain on a route-safe authored floor; got ${JSON.stringify(result)}`);
      const settled = entryById(await diagnostics(desktop), id);
      assert(settled.activity === "idle" && settled.animation.name === "idle" && settled.animation.neutralRestApplied === true, `${id} should end the routine in a relaxed arms-down idle; got ${JSON.stringify(settled.animation)}`);
      assert(settled.armPose?.coherentChain && settled.armPose.handsIncluded && settled.armPose.world?.valid && !settled.armPose.world.handsCrossedCenterline, `${id} standing arm chain should keep elbows and hands on their anatomical sides; got ${JSON.stringify(settled.armPose)}`);
      assert(settled.armPose.world.handSeparation >= 0.12 && settled.armPose.world.minimumWristDrop >= 0.2, `${id} standing hands should hang separately below the shoulders; got ${JSON.stringify(settled.armPose.world)}`);
      await desktop.evaluate((contestantId) => {
        window.MrFeastFresh.state.started = false;
        window.MrFeastFresh.placePlayerNearContestantForQA(contestantId, 2.2);
        window.MrFeastFresh.state.pitch = -0.16;
        const speech = document.getElementById("mansion-speech");
        if (speech) speech.hidden = true;
      }, id);
      await desktop.waitForTimeout(100);
      await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `${id}-neutral-idle-desktop.png`) });
      for (const phase of [0.25, 0.75]) {
        await desktop.evaluate(({ contestantId, walkingPhase }) => {
          window.MrFeastFresh.poseContestantWalkingForQA(contestantId, walkingPhase);
        }, { contestantId: id, walkingPhase: phase });
        await desktop.waitForTimeout(100);
        await desktop.locator("#mansion-stage").screenshot({
          path: path.join(artifactDir, `${id}-walking-${phase}-desktop.png`),
        });
      }
      await desktop.evaluate((contestantId) => window.MrFeastFresh.restoreContestantIdleForQA(contestantId), id);
      const seatedMotion = await desktop.evaluate((contestantId) => {
        const seated = window.MrFeastFresh.seatContestantForQA(contestantId);
        const probe = window.MrFeastFresh.advanceContestantSeatedIdleForQA(contestantId, 2.4);
        window.MrFeastFresh.standContestantForQA(contestantId);
        window.MrFeastFresh.state.started = true;
        return { seated, probe };
      }, id);
      assert(seatedMotion.seated?.seated && seatedMotion.probe?.stillSeated && seatedMotion.probe.poseChanged, `${id} should use a living seated idle; got ${JSON.stringify(seatedMotion)}`);
      assert(seatedMotion.probe.rootDrift <= 0.002 && seatedMotion.probe.maximumLowerBodyDelta <= 0.000001, `${id} seated motion must keep its root and lower body planted; got ${JSON.stringify(seatedMotion.probe)}`);
      assert(seatedMotion.probe.maximumUpperBodyDelta >= 0.000001 && seatedMotion.probe.maximumUpperBodyDelta <= 0.02, `${id} seated upper-body motion should stay restrained; got ${JSON.stringify(seatedMotion.probe)}`);
      assert(seatedMotion.probe.armPose?.valid && !seatedMotion.probe.armPose.handsCrossedCenterline && seatedMotion.probe.armPose.handSeparation >= 0.12, `${id} seated hands should remain relaxed and separated on their own side; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.minimumWristForwardOfTorso >= 0.04, `${id} seated wrists should rest forward over the lap instead of hanging behind the torso; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.maximumWristToLapDistance <= 0.25, `${id} seated hands should rest naturally over the upper thighs; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.minimumElbowFlexionDegrees >= 45 && seatedMotion.probe.armPose.maximumElbowFlexionDegrees <= 105, `${id} seated elbows should flex forward in a relaxed anatomical range; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.minimumFingerThighDot >= 0.7, `${id} seated fingers should point down the thighs instead of flipping backward; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      const palmAlignments = Object.values(seatedMotion.probe.armPose.sides)
        .map((side) => side.palmTowardThighAlignment);
      const wristThighFractions = Object.values(seatedMotion.probe.armPose.sides)
        .map((side) => side.wristThighFraction);
      assert(seatedMotion.probe.armPose.minimumPalmTowardThighAlignment >= 0.65, `${id} should roll both palms down toward the thighs instead of exposing them upward; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(palmAlignments.every((alignment) => alignment >= 0.65), `${id} should keep each palm individually facing the thigh; got ${JSON.stringify({ palmAlignments, armPose: seatedMotion.probe.armPose })}`);
      assert(wristThighFractions.every((fraction) => fraction >= 0.24 && fraction <= 0.36), `${id} seated wrists should rest on top of the thighs instead of tucking back toward the hips; got ${JSON.stringify({ wristThighFractions, armPose: seatedMotion.probe.armPose })}`);
      const expectedHandClearance = seatedHandClearanceByContestant[id];
      assert(seatedMotion.probe.armPose.minimumHandPlaneThighClearance >= expectedHandClearance - 0.015, `${id} seated hand mesh should remain above its thigh bone line instead of tucking into it; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.maximumHandPlaneThighClearance <= expectedHandClearance + 0.015, `${id} seated hands should remain supported by the thighs instead of floating above them; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      assert(seatedMotion.probe.armPose.maximumHandPlaneTilt <= 0.025, `${id} seated wrists and fingertips should form a flat plane along the thigh; got ${JSON.stringify(seatedMotion.probe.armPose)}`);
      const handSurfaceSides = Object.values(seatedMotion.probe.handThighSurface?.sides || {});
      assert(seatedMotion.probe.handThighSurface?.valid && handSurfaceSides.length === 2, `${id} needs a valid deformed hand-to-thigh surface probe; got ${JSON.stringify(seatedMotion.probe.handThighSurface)}`);
      assert(handSurfaceSides.every((side) => side.minimumGap >= 0.005 && side.minimumGap <= 0.06), `${id} hands should visibly clear, but remain supported by, the actual skinned thigh surface; got ${JSON.stringify(seatedMotion.probe.handThighSurface)}`);
      if (id !== "juniper-cross") {
        const chairFit = seatedMotion.probe.seatFit;
        assert(chairFit?.kind === "chair", `${id} should use an authored standard chair; got ${JSON.stringify(chairFit)}`);
        assert(chairFit.minimumThighCushionTopClearance >= 0.025, `${id}'s thigh line should visibly clear the regular-chair cushion; got ${JSON.stringify(chairFit)}`);
        assert(chairFit.minimumHipSupportDepth >= 0.06 && chairFit.minimumKneeFrontClearance >= 0.22, `${id} should retain supported hips and forward knees on a regular chair; got ${JSON.stringify(chairFit)}`);
        assert(chairFit.maximumThighCushionOverlapRatio <= 0.3 && chairFit.maximumToeFloorDistance <= 0.08, `${id} should avoid a buried/perched chair pose and keep floor-near boots; got ${JSON.stringify(chairFit)}`);
      }
    }

    // Nearby passive attention is head/neck-only, smoothly damped, and cannot
    // follow a player around the back of the body.
    for (const id of contestantIds) {
      const near = await desktop.evaluate((contestantId) => (
        window.MrFeastFresh.probeContestantHeadTrackingForQA(contestantId, {
          distance: 1.8,
          bearingDegrees: 30,
          elevationDegrees: 8,
          holdSeconds: 0.9,
          releaseSeconds: 1.4,
        })
      ), id);
      assertAttentionProbe(near, id);
      const rear = await desktop.evaluate((contestantId) => (
        window.MrFeastFresh.probeContestantHeadTrackingForQA(contestantId, {
          distance: 1.8,
          bearingDegrees: 170,
          holdSeconds: 1.1,
        })
      ), id);
      assert(!rear.acquired.active && !rear.acquired.inFov && Math.abs(rear.acquired.targetYaw) <= 0.001, `${id} must not turn its head backward toward a player behind it: ${JSON.stringify(rear)}`);
      const extreme = await desktop.evaluate((contestantId) => (
        window.MrFeastFresh.probeContestantHeadTrackingForQA(contestantId, {
          distance: 1.5,
          bearingDegrees: 50,
          elevationDegrees: 25,
          holdSeconds: 10,
          releaseSeconds: 0.2,
        })
      ), id);
      assert(extreme.maximumObservedYaw <= radians(extreme.limits.maxYawDegrees) + 0.001 && extreme.maximumObservedPitch <= radians(extreme.limits.maxPitchDegrees) + 0.001, `${id} extreme attention hold exceeded its clamp: ${JSON.stringify(extreme)}`);
    }

    await desktop.evaluate(() => window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 0, z: -7, yaw: 0 }));
    const mrFeastAttention = await desktop.evaluate(() => window.MrFeastFresh.probeMrFeastHeadTrackingForQA({
      distance: 2.1,
      bearingDegrees: 30,
      elevationDegrees: 8,
      holdSeconds: 0.9,
      releaseSeconds: 1.4,
    }));
    assertAttentionProbe(mrFeastAttention, "Mr. Feast");
    const mrFeastOutsideFov = await desktop.evaluate(() => window.MrFeastFresh.probeMrFeastHeadTrackingForQA({
      distance: 2.1,
      bearingDegrees: 60,
      holdSeconds: 1,
    }));
    assert(!mrFeastOutsideFov.acquired.active && !mrFeastOutsideFov.acquired.inFov && Math.abs(mrFeastOutsideFov.acquired.targetYaw) <= 0.001, `Mr. Feast must ignore a player outside his forward field of view: ${JSON.stringify(mrFeastOutsideFov)}`);
    const mrFeastBehind = await desktop.evaluate(() => window.MrFeastFresh.probeMrFeastHeadTrackingForQA({
      distance: 2.1,
      bearingDegrees: 180,
      holdSeconds: 10,
    }));
    assert(!mrFeastBehind.acquired.active && !mrFeastBehind.acquired.inFov && mrFeastBehind.maximumObservedYaw <= radians(mrFeastBehind.limits.maxYawDegrees) + 0.001, `Mr. Feast must never track through 180 degrees: ${JSON.stringify(mrFeastBehind)}`);
    assert(mrFeastBehind.acquired.visualTurnDegrees <= 1, `Mr. Feast's visible head rig must remain neutral for a player behind him: ${JSON.stringify(mrFeastBehind.acquired)}`);
    const mrFeastFar = await desktop.evaluate((distance) => window.MrFeastFresh.probeMrFeastHeadTrackingForQA({
      distance,
      bearingDegrees: 0,
      holdSeconds: 1,
    }), mrFeastAttention.limits.maximumDistance + 1);
    assert(!mrFeastFar.acquired.active && !mrFeastFar.acquired.inRange, `Mr. Feast attention must be nearby-only: ${JSON.stringify(mrFeastFar)}`);
    assert(mrFeastFar.acquired.visualTurnDegrees <= 1, `Mr. Feast's visible head rig must remain neutral for a distant player: ${JSON.stringify(mrFeastFar.acquired)}`);
    await desktop.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resumeMrFeastForQA();
    });

    // Kinematic character controllers, not only authored route clearance,
    // must stop every living character against the mansion's furniture boxes.
    const contestantCollision = await desktop.evaluate(() => window.MrFeastFresh.probeContestantFurnitureCollisionForQA("mara-voss"));
    const mrFeastCollision = await desktop.evaluate(() => window.MrFeastFresh.probeMrFeastFurnitureCollisionForQA());
    assert(contestantCollision?.blocked === true && contestantCollision.moved < contestantCollision.requested, `contestant furniture collision should reject the blocked step; got ${JSON.stringify(contestantCollision)}`);
    assert(mrFeastCollision?.blocked === true && mrFeastCollision.moved < mrFeastCollision.requested, `Mr. Feast furniture collision should reject the blocked step; got ${JSON.stringify(mrFeastCollision)}`);

    // Conversations must still bind to the contestant's live moving root.
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearContestantForQA("mara-voss", 1.6));
    await desktop.waitForFunction(() => /speak with mara voss/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(desktop);
    await desktop.waitForTimeout(100);
    state = await diagnostics(desktop);
    assert(state.speech.speakerId === "mara-voss" && state.speech.visible, `conversation should follow Mara's moved body; got ${JSON.stringify(state.speech)}`);

    // Visual proof for both sides of the shared seating contract.
    await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    await desktop.waitForTimeout(100);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "player-seated-desktop.png") });
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const chairProofCases = [
      { id: "mara-voss", tag: "library-writing-chair", views: [{ name: "three-quarter", orbit: Math.PI / 2 }] },
      {
        id: "kip-solano",
        tag: "ballroom-sideline-chair",
        views: [
          { name: "front", orbit: 0 },
          { name: "profile", orbit: Math.PI / 2 },
          { name: "three-quarter", orbit: -Math.PI / 4 },
        ],
      },
    ];
    for (const proof of chairProofCases) {
      const chairSeat = (await diagnostics(desktop)).seating.entries.find((entry) => entry.tag === proof.tag);
      const standing = entryById(await diagnostics(desktop), proof.id);
      const seated = await desktop.evaluate(({ id, seatId }) => window.MrFeastFresh.seatContestantForQA(id, seatId), { id: proof.id, seatId: chairSeat.id });
      const probe = await desktop.evaluate((id) => window.MrFeastFresh.advanceContestantSeatedIdleForQA(id, 3.2), proof.id);
      assert(seated?.seated && seated.poseApplied && probe?.seatFit?.kind === "chair", `${proof.id} should visibly use the fitted standard chair; got ${JSON.stringify({ seated, probe })}`);
      assert(probe.seatFit.minimumThighCushionTopClearance >= 0.025 && probe.seatFit.maximumToeFloorDistance <= 0.08, `${proof.id} chair visual proof should preserve thigh and boot clearance; got ${JSON.stringify(probe.seatFit)}`);
      const sitting = entryById(await diagnostics(desktop), proof.id);
      assert(Math.abs(sitting.position.y - standing.position.y) <= 0.001, `fitting the chair must not lower ${proof.id}'s floor root; standing ${JSON.stringify(standing.position)}, seated ${JSON.stringify(sitting.position)}`);
      for (const view of proof.views) {
        await desktop.evaluate(({ id, orbit }) => {
          window.MrFeastFresh.placePlayerNearContestantForQA(id, 2.05, orbit);
          window.MrFeastFresh.state.pitch = -0.34;
          const speech = document.getElementById("mansion-speech");
          if (speech) speech.hidden = true;
        }, { id: proof.id, orbit: view.orbit });
        await desktop.waitForTimeout(120);
        await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `${proof.id}-regular-chair-${view.name}.png`) });
      }
      await desktop.evaluate((id) => window.MrFeastFresh.standContestantForQA(id), proof.id);
    }
    const juniperBeforeSeat = entryById(await diagnostics(desktop), "juniper-cross");
    const seatedContestant = await desktop.evaluate(() => window.MrFeastFresh.seatContestantForQA("juniper-cross"));
    assert(seatedContestant?.seated && seatedContestant.poseApplied, `Juniper should visibly use the shared seated pose; got ${JSON.stringify(seatedContestant)}`);
    const seatedIdleProbe = await desktop.evaluate(() => window.MrFeastFresh.advanceContestantSeatedIdleForQA("juniper-cross", 3.2));
    assert(seatedIdleProbe?.stillSeated && seatedIdleProbe.poseChanged, `Juniper should visibly breathe and glance while seated; got ${JSON.stringify(seatedIdleProbe)}`);
    assert(seatedIdleProbe.rootDrift <= 0.002 && seatedIdleProbe.maximumLowerBodyDelta <= 0.000001, `Juniper's seated root and lower body must remain planted; got ${JSON.stringify(seatedIdleProbe)}`);
    assert(seatedIdleProbe.maximumUpperBodyDelta >= 0.000001 && seatedIdleProbe.maximumUpperBodyDelta <= 0.02, `Juniper's seated motion should be visible but restrained; got ${JSON.stringify(seatedIdleProbe)}`);
    assert(seatedIdleProbe.seatFit?.kind === "sofa" && seatedIdleProbe.seatFit.forwardOffset >= 0.16, `Juniper should be moved toward the sofa front; got ${JSON.stringify(seatedIdleProbe?.seatFit)}`);
    assert(seatedIdleProbe.seatFit.maximumThighCushionOverlapRatio <= 0.45 && seatedIdleProbe.seatFit.minimumKneeFrontClearance >= 0.18, `Juniper's legs should clear most of the sofa cushion/fascia; got ${JSON.stringify(seatedIdleProbe?.seatFit)}`);
    assert(seatedIdleProbe.seatFit.minimumThighCushionTopClearance >= 0.025, `Juniper's thigh line should visibly clear the lowered cushion top; got ${JSON.stringify(seatedIdleProbe?.seatFit)}`);
    assert(seatedIdleProbe.seatFit.minimumHipSupportDepth >= 0.08 && seatedIdleProbe.seatFit.maximumToeFloorDistance <= 0.08, `Juniper should keep supported hips and floor-near boots; got ${JSON.stringify(seatedIdleProbe?.seatFit)}`);
    const juniperWhileSeated = entryById(await diagnostics(desktop), "juniper-cross");
    assert(Math.abs(juniperWhileSeated.position.y - juniperBeforeSeat.position.y) <= 0.001, `shortening the sofa must not lower Juniper's floor-anchored root; before ${JSON.stringify(juniperBeforeSeat.position)}, seated ${JSON.stringify(juniperWhileSeated.position)}`);
    await desktop.evaluate(() => {
      window.MrFeastFresh.placePlayerNearContestantForQA("juniper-cross", 2.25, -0.62);
      window.MrFeastFresh.state.pitch = -0.38;
      const speech = document.getElementById("mansion-speech");
      if (speech) speech.hidden = true;
    });
    await desktop.waitForTimeout(120);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "juniper-seated-desktop.png") });
    await desktop.setViewportSize({ width: 1920, height: 1080 });
    await desktop.waitForTimeout(120);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "juniper-seated-lowered-sofa-three-quarter.png") });
    await desktop.evaluate(() => window.MrFeastFresh.standContestantForQA("juniper-cross"));
    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await desktop.close();

    // Abort one optional walk request: the mansion and social roster must
    // still boot, while that contestant reports an idle-only fallback.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors, "mobile: ", [/net::ERR_FAILED/i]);
    await mobile.route(/kip-solano-walk\.glb(?:\?|$)/, (route) => route.abort("failed"));
    await mobile.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobile.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    state = await diagnostics(mobile);
    const mobileKip = entryById(state, "kip-solano");
    assert(state.ready && state.contestants.loaded === 3, `optional walk failure must not block the roster or mansion; got ${JSON.stringify(state.contestants)}`);
    assert(mobileKip.locomotionStatus === "idle-fallback" && mobileKip.loaded, `Kip should isolate the failed walk clip; got ${JSON.stringify(mobileKip)}`);

    const mobileSeat = state.seating.entries.find((entry) => entry.kind === "sofa" && !entry.occupiedBy);
    await mobile.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), mobileSeat.id);
    await mobile.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await mobile.locator("#touch-interact").click({ force: true });
    await mobile.waitForTimeout(100);
    state = await diagnostics(mobile);
    assert(state.seating.player.seated && /^stand up$/i.test(state.prompt || ""), `touch interaction should sit and expose Stand up; got ${JSON.stringify(state.seating.player)}`);
    const touchControl = await mobile.locator("#touch-interact").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, stage };
    });
    assert(touchControl.width >= 44 && touchControl.height >= 44, `touch interact should remain at least 44px; got ${JSON.stringify(touchControl)}`);
    assert(touchControl.left >= touchControl.stage.left && touchControl.right <= touchControl.stage.right && touchControl.top >= touchControl.stage.top && touchControl.bottom <= touchControl.stage.bottom, `touch interact should remain inside the stage; got ${JSON.stringify(touchControl)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "player-seated-mobile.png") });
    await mobile.locator("#touch-interact").click({ force: true });
    assert(!(await diagnostics(mobile)).seating.player.seated, "second touch interaction should stand the player");
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast seating and contestant routine checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
