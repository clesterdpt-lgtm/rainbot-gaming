#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
const manifestPath = path.join(root, "assets/models/mr-feast/demon-prototypes/manifest.json");
const milestonePath = path.join(root, "docs/milestones/65-demon-prototype-dev-patrol.md");

const runtime = await readFile(runtimePath, "utf8");
const milestone = await readFile(milestonePath, "utf8");

assert.match(runtime, /const DEMON_PROTOTYPES = Object\.freeze/, "missing named demon prototype tuning table");
assert.match(runtime, /class DemonPrototypePatrolSystem/, "missing isolated demon prototype patrol system");
assert.match(runtime, /demonPrototypePatrol\?\.setEnabled\(state\.devMode\)/, "developer mode does not own prototype visibility");
assert.match(runtime, /awaitDemonPrototypesForQA/, "missing deterministic prototype load control");
assert.match(runtime, /advanceDemonPrototypesForQA/, "missing deterministic prototype patrol control");
assert.match(runtime, /frameDemonPrototypeForQA/, "missing prototype framing control");
assert.match(runtime, /demonPrototypes:/, "prototype diagnostics are absent from render_game_to_text");

assert.match(milestone, /\*\*Status:\*\* (In progress|Automated acceptance complete)/, "milestone status is not current");
assert.match(milestone, /With developer mode off[\s\S]*no prototype asset fetch/, "milestone does not protect normal mode");

await access(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.version, 1, "unexpected demon prototype manifest version");
assert.equal(manifest.prototypes?.length, 2, "manifest must contain exactly two prototypes");
assert.deepEqual(
  manifest.prototypes.map((prototype) => prototype.id).sort(),
  ["banquet-saint", "pale-maw"],
  "manifest prototype identities changed"
);

function parseGlbJson(buffer, label) {
  assert.equal(buffer.toString("utf8", 0, 4), "glTF", `${label} is not a binary glTF`);
  assert.equal(buffer.readUInt32LE(4), 2, `${label} is not glTF 2.0`);
  const declaredLength = buffer.readUInt32LE(8);
  assert.equal(declaredLength, buffer.length, `${label} has a mismatched byte length`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buffer.toString("utf8", offset + 8, offset + 8 + chunkLength).replace(/\0+$/g, "").trim());
    }
    offset += 8 + chunkLength;
  }
  throw new Error(`${label} has no JSON chunk`);
}

function accessorCount(gltf, accessorIndex) {
  return gltf.accessors?.[accessorIndex]?.count ?? 0;
}

function triangleCount(gltf) {
  let total = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const vertexCount = accessorCount(gltf, primitive.attributes?.POSITION);
      const indexCount = primitive.indices === undefined ? vertexCount : accessorCount(gltf, primitive.indices);
      if (primitive.mode === undefined || primitive.mode === 4) total += Math.floor(indexCount / 3);
    }
  }
  return total;
}

for (const prototype of manifest.prototypes) {
  assert.ok(prototype.name, `${prototype.id} is missing a display name`);
  assert.ok(prototype.reference?.approvedConcept, `${prototype.id} is missing its concept reference`);
  assert.ok(prototype.provenance?.meshy?.generationTaskId, `${prototype.id} is missing Meshy generation provenance`);
  assert.ok(prototype.provenance?.meshy?.rigTaskId, `${prototype.id} is missing Meshy rig provenance`);
  assert.ok(prototype.provenance?.blender?.version, `${prototype.id} is missing Blender provenance`);
  assert.ok(prototype.preparationReport, `${prototype.id} is missing a Blender preparation report`);
  assert.ok(prototype.targetHeight >= 1.9 && prototype.targetHeight <= 2.5, `${prototype.id} has an invalid target height`);

  const modelPath = path.join(path.dirname(manifestPath), prototype.model);
  const modelBytes = (await stat(modelPath)).size;
  assert.ok(modelBytes <= 4 * 1024 * 1024, `${prototype.id} exceeds the 4 MiB runtime model budget`);
  const model = parseGlbJson(await readFile(modelPath), `${prototype.id} model`);
  assert.ok((model.meshes?.length ?? 0) >= 1, `${prototype.id} model has no mesh`);
  assert.ok((model.skins?.length ?? 0) >= 1, `${prototype.id} model has no skin`);
  assert.ok((model.nodes?.length ?? 0) >= 20, `${prototype.id} model has too few nodes for a character rig`);
  assert.equal(model.animations?.length ?? 0, 0, `${prototype.id} model must not embed animations`);
  assert.ok(triangleCount(model) <= 35_000, `${prototype.id} exceeds the triangle budget`);

  const report = JSON.parse(await readFile(path.join(path.dirname(manifestPath), prototype.preparationReport), "utf8"));
  assert.ok(Math.abs(report.groundY ?? 99) <= 0.03, `${prototype.id} is not grounded`);
  assert.ok((report.height ?? 0) >= 1.9 && report.height <= 2.5, `${prototype.id} report has an invalid height`);
  assert.ok((report.maxTextureDimension ?? 99_999) <= 1024, `${prototype.id} exceeds the texture budget`);
  assert.ok((report.skinnedMeshCount ?? 0) >= 1, `${prototype.id} report did not find a skinned mesh`);
  assert.ok((report.boneCount ?? 0) >= 20, `${prototype.id} report did not find a usable skeleton`);

  for (const action of ["idle", "walk", "run"]) {
    const relativeClipPath = prototype.animations?.[action];
    assert.ok(relativeClipPath, `${prototype.id} is missing its ${action} clip`);
    const clip = parseGlbJson(
      await readFile(path.join(path.dirname(manifestPath), relativeClipPath)),
      `${prototype.id} ${action}`,
    );
    assert.equal(clip.meshes?.length ?? 0, 0, `${prototype.id} ${action} is not animation-only`);
    assert.equal(clip.skins?.length ?? 0, 0, `${prototype.id} ${action} retained a skin`);
    assert.equal(clip.materials?.length ?? 0, 0, `${prototype.id} ${action} retained materials`);
    assert.equal(clip.textures?.length ?? 0, 0, `${prototype.id} ${action} retained textures`);
    assert.equal(clip.animations?.length ?? 0, 1, `${prototype.id} ${action} must contain one clip`);
    const channels = clip.animations[0].channels ?? [];
    const paths = channels.map((channel) => channel.target?.path);
    assert.ok(paths.filter((target) => target === "rotation").length >= 20, `${prototype.id} ${action} has too few rotation tracks`);
    assert.ok(paths.every((target) => target === "rotation"), `${prototype.id} ${action} contains root motion or scale tracks`);
  }
}

console.log("Mr. Feast demon prototype static acceptance checks passed.");

if (process.env.MR_FEAST_BROWSER_QA !== "1") {
  console.log("Browser checks skipped. Set MR_FEAST_BROWSER_QA=1 to exercise the live dev-mode patrol.");
  process.exit(0);
}

const { chromium } = await import("playwright");
const baseUrl = process.env.MR_FEAST_BASE_URL ?? "http://127.0.0.1:8000";
const artifactDir = path.join(root, "output/iterate/demon-prototypes/browser");
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&frame=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.MrFeastFresh?.setDevModeForQA));
  await page.addStyleTag({
    content: [
      ".nav,.game-page__header,.mansion-aside,.footer{display:none!important}",
      ".game-page,.game-layout,.mansion-stage-shell,.mansion-surface{position:static!important;display:block!important;width:100vw!important;height:100vh!important;max-width:none!important;margin:0!important;padding:0!important}",
    ].join(""),
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });

  const normal = await page.evaluate(() => window.MrFeastFresh.getDemonPrototypeState());
  assert.equal(normal.enabled, false, "prototype patrol starts enabled in normal mode");
  assert.equal(normal.loadStatus, "idle", "normal mode fetched prototype assets");
  assert.equal(normal.loaded, 0, "normal mode created prototype actors");
  assert.equal(normal.visible, 0, "normal mode exposes prototype actors");

  await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(true));
  const loaded = await page.evaluate(() => window.MrFeastFresh.awaitDemonPrototypesForQA());
  assert.equal(loaded.enabled, true, "prototype patrol did not enable with developer mode");
  assert.equal(loaded.loadStatus, "ready", "prototype patrol did not finish loading");
  assert.equal(loaded.loaded, 2, "both prototypes were not loaded");
  assert.equal(loaded.visible, 2, "both prototypes are not visible");
  for (const entry of loaded.entries) {
    assert.equal(entry.grounded, true, `${entry.id} is not grounded at runtime`);
    assert.ok(entry.boundClips.includes("idle"), `${entry.id} idle is not bound`);
    assert.ok(entry.boundClips.includes("walk"), `${entry.id} walk is not bound`);
    assert.ok(entry.boundClips.includes("run"), `${entry.id} run is not bound`);
  }

  const advanced = await page.evaluate(() => window.MrFeastFresh.advanceDemonPrototypesForQA(18));
  for (const entry of advanced.entries) {
    assert.ok(entry.distanceTravelled > 1, `${entry.id} did not patrol`);
    assert.ok(entry.completedLegs >= 1, `${entry.id} did not complete a route leg`);
    assert.ok(entry.poseChanged, `${entry.id} animation remained frozen`);
    assert.ok(entry.turnRadians > 0.1, `${entry.id} did not turn`);
  }

  for (const id of ["pale-maw", "banquet-saint"]) {
    const framed = await page.evaluate((prototypeId) => window.MrFeastFresh.frameDemonPrototypeForQA(prototypeId), id);
    assert.equal(framed.id, id, `could not frame ${id}`);
    assert.equal(framed.visible, true, `${id} disappeared while framed`);
    for (const [action, phase] of [["idle", 0.36], ["walk", 0.24], ["run", 0.3]]) {
      const posed = await page.evaluate(
        ({ prototypeId, actionName, actionPhase }) => (
          window.MrFeastFresh.poseDemonPrototypeForQA(prototypeId, actionName, actionPhase)
        ),
        { prototypeId: id, actionName: action, actionPhase: phase },
      );
      assert.equal(posed.activeClip, action, `${id} did not pose its ${action} clip`);
      await page.waitForTimeout(120);
      await page.locator("#mansion-stage").screenshot({
        path: path.join(artifactDir, `${id}-${action}.png`),
      });
    }
  }

  await page.evaluate(() => window.MrFeastFresh.setDevModeForQA(false));
  const disabled = await page.evaluate(() => window.MrFeastFresh.getDemonPrototypeState());
  assert.equal(disabled.enabled, false, "prototype patrol stayed enabled");
  assert.equal(disabled.visible, 0, "prototype actors stayed visible");
  assert.ok(disabled.entries.every((entry) => entry.distanceTravelled === 0), "prototype route state did not reset");

  assert.deepEqual(consoleErrors, [], `browser console errors:\n${consoleErrors.join("\n")}`);
  console.log("Mr. Feast demon prototype browser acceptance checks passed.");
} finally {
  await browser.close();
}
