#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
const pagePath = path.join(root, "games/mr-feast-mansion.html");
const manifestPath = path.join(root, "assets/models/mr-feast/demon-prototypes/manifest.json");
const milestonePath = path.join(root, "docs/milestones/65-demon-prototype-dev-patrol.md");
const locomotionPipelinePath = path.join(root, "scripts/blender/refine-demon-prototype-animation.py");

const runtime = await readFile(runtimePath, "utf8");
const pageHtml = await readFile(pagePath, "utf8");
const milestone = await readFile(milestonePath, "utf8");

assert.match(runtime, /const DEMON_PROTOTYPES = Object\.freeze/, "missing named demon prototype tuning table");
const runtimeCacheIdentity = runtime.match(/MANSION_RUNTIME_VERSION = "([^"]+)"/)?.[1] || "";
const pageCacheIdentity = pageHtml.match(/mr-feast-mansion\.js\?v=([^"'&]+)/)?.[1] || "";
assert.ok(
  runtimeCacheIdentity.startsWith("20260725-demon-locomotion-polish-"),
  `demon prototype runtime cache identity is stale: ${runtimeCacheIdentity || "missing"}`,
);
assert.equal(
  pageCacheIdentity,
  runtimeCacheIdentity,
  `page/runtime cache identities must agree: ${JSON.stringify({ runtimeCacheIdentity, pageCacheIdentity })}`,
);
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
assert.equal(
  manifest.assetVersion,
  "20260725-demon-locomotion-polish-1",
  "demon animation assets need a fresh cache identity",
);
assert.equal(manifest.prototypes?.length, 2, "manifest must contain exactly two prototypes");
assert.deepEqual(
  manifest.prototypes.map((prototype) => prototype.id).sort(),
  ["banquet-saint", "pale-maw"],
  "manifest prototype identities changed"
);

function parseGlb(buffer, label) {
  assert.equal(buffer.toString("utf8", 0, 4), "glTF", `${label} is not a binary glTF`);
  assert.equal(buffer.readUInt32LE(4), 2, `${label} is not glTF 2.0`);
  const declaredLength = buffer.readUInt32LE(8);
  assert.equal(declaredLength, buffer.length, `${label} has a mismatched byte length`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(
        buffer.toString("utf8", offset + 8, offset + 8 + chunkLength)
          .replace(/\0+$/g, "")
          .trim(),
      );
    } else if (chunkType === 0x004e4942) {
      binary = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    }
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error(`${label} has no JSON chunk`);
  return { json, binary };
}

function parseGlbJson(buffer, label) {
  return parseGlb(buffer, label).json;
}

function readFloatAccessor(glb, accessorIndex, label) {
  const accessor = glb.json.accessors?.[accessorIndex];
  const view = glb.json.bufferViews?.[accessor?.bufferView];
  assert.ok(accessor && view && glb.binary, `${label} accessor is incomplete`);
  assert.equal(accessor.componentType, 5126, `${label} accessor is not FLOAT`);
  const components = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  }[accessor.type];
  assert.ok(components, `${label} accessor has unsupported type ${accessor.type}`);
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const byteStride = view.byteStride ?? components * Float32Array.BYTES_PER_ELEMENT;
  return Array.from({ length: accessor.count }, (_, index) => (
    Array.from({ length: components }, (_unused, component) => (
      glb.binary.readFloatLE(
        byteOffset + index * byteStride + component * Float32Array.BYTES_PER_ELEMENT,
      )
    ))
  ));
}

function quaternionDeltaDegrees(left, right) {
  const leftMagnitude = Math.hypot(...left);
  const rightMagnitude = Math.hypot(...right);
  assert.ok(leftMagnitude > 0 && rightMagnitude > 0, "invalid zero quaternion");
  const dot = Math.min(
    1,
    Math.max(
      -1,
      Math.abs(
        left.reduce((total, value, index) => total + value * right[index], 0)
        / (leftMagnitude * rightMagnitude),
      ),
    ),
  );
  return 2 * Math.acos(dot) * 180 / Math.PI;
}

function rotationSamplesByBone(glb, label) {
  const animation = glb.json.animations?.[0];
  return new Map((animation?.channels ?? []).map((channel) => {
    const boneName = glb.json.nodes?.[channel.target?.node]?.name;
    const sampler = animation.samplers?.[channel.sampler];
    return [
      boneName,
      readFloatAccessor(glb, sampler?.output, `${label} ${boneName}`),
    ];
  }));
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
  const modelGlb = parseGlb(await readFile(modelPath), `${prototype.id} model`);
  const model = modelGlb.json;
  const bindRotationByBone = new Map(
    (model.nodes ?? []).map((node) => [
      node.name,
      node.rotation ?? [0, 0, 0, 1],
    ]),
  );
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

  const expectedLocomotionStyle = prototype.id === "banquet-saint"
    ? "ceremonial-glide"
    : "anatomical-creep";
  assert.equal(
    prototype.locomotionStyle,
    expectedLocomotionStyle,
    `${prototype.id} does not declare its corrected locomotion style`,
  );

  for (const action of ["idle", "walk", "run"]) {
    const relativeClipPath = prototype.animations?.[action];
    assert.ok(relativeClipPath, `${prototype.id} is missing its ${action} clip`);
    const clipLabel = `${prototype.id} ${action}`;
    const clipGlb = parseGlb(
      await readFile(path.join(path.dirname(manifestPath), relativeClipPath)),
      clipLabel,
    );
    const clip = clipGlb.json;
    assert.equal(clip.meshes?.length ?? 0, 0, `${prototype.id} ${action} is not animation-only`);
    assert.equal(clip.skins?.length ?? 0, 0, `${prototype.id} ${action} retained a skin`);
    assert.equal(clip.materials?.length ?? 0, 0, `${prototype.id} ${action} retained materials`);
    assert.equal(clip.textures?.length ?? 0, 0, `${prototype.id} ${action} retained textures`);
    assert.equal(clip.animations?.length ?? 0, 1, `${prototype.id} ${action} must contain one clip`);
    const channels = clip.animations[0].channels ?? [];
    const paths = channels.map((channel) => channel.target?.path);
    assert.ok(paths.filter((target) => target === "rotation").length >= 20, `${prototype.id} ${action} has too few rotation tracks`);
    assert.ok(paths.every((target) => target === "rotation"), `${prototype.id} ${action} contains root motion or scale tracks`);

    const animationReport = JSON.parse(
      await readFile(
        path.join(path.dirname(manifestPath), prototype.animationReports?.[action]),
        "utf8",
      ),
    );
    assert.equal(
      animationReport.pipeline,
      "blender-authored-demon-locomotion",
      `${prototype.id} ${action} still uses an uncorrected generic motion`,
    );
    assert.equal(
      animationReport.authoredStyle,
      expectedLocomotionStyle,
      `${prototype.id} ${action} does not match its authored locomotion style`,
    );
    assert.equal(
      animationReport.quaternionHemisphereFlips,
      0,
      `${prototype.id} ${action} contains a quaternion interpolation flip`,
    );

    const samplesByBone = rotationSamplesByBone(clipGlb, clipLabel);
    if (prototype.id === "banquet-saint") {
      assert.equal(
        animationReport.legMotionDegrees,
        0,
        `${prototype.id} ${action} must glide with motionless legs`,
      );
      assert.equal(
        animationReport.armMotionMode,
        "symmetric-back-drift",
        `${prototype.id} ${action} arms must drift back together`,
      );
      assert.ok(
        animationReport.armExcursionDegrees >= 1
          && animationReport.armExcursionDegrees <= 6,
        `${prototype.id} ${action} arm movement is not slight`,
      );
      assert.ok(
        animationReport.armSymmetryErrorDegrees <= 0.1,
        `${prototype.id} ${action} arm motion is not symmetric`,
      );
      for (const boneName of [
        "Hips",
        "LeftUpLeg",
        "LeftLeg",
        "LeftFoot",
        "RightUpLeg",
        "RightLeg",
        "RightFoot",
      ]) {
        const samples = samplesByBone.get(boneName);
        assert.ok(samples?.length, `${clipLabel} is missing ${boneName}`);
        assert.ok(
          samples.every((sample) => quaternionDeltaDegrees(samples[0], sample) <= 0.02),
          `${clipLabel} moves ${boneName} instead of gliding`,
        );
      }
      const leftArmSamples = samplesByBone.get("LeftArm");
      const rightArmSamples = samplesByBone.get("RightArm");
      assert.equal(
        leftArmSamples?.length,
        rightArmSamples?.length,
        `${clipLabel} arm samples do not match`,
      );
      const leftArmDeltas = leftArmSamples.map((sample) => (
        quaternionDeltaDegrees(leftArmSamples[0], sample)
      ));
      const rightArmDeltas = rightArmSamples.map((sample) => (
        quaternionDeltaDegrees(rightArmSamples[0], sample)
      ));
      assert.ok(
        Math.max(...leftArmDeltas) >= 1 && Math.max(...leftArmDeltas) <= 6,
        `${clipLabel} left arm does not move slightly`,
      );
      assert.ok(
        leftArmDeltas.every((delta, index) => (
          Math.abs(delta - rightArmDeltas[index]) <= 0.1
        )),
        `${clipLabel} arms do not drift in the same phase`,
      );
    } else {
      assert.equal(
        animationReport.baselinePose,
        "processed-bind",
        `${prototype.id} ${action} is authored on the twisted generic idle pose`,
      );
      assert.equal(
        animationReport.kneeBendDirection,
        "anatomical-backward-flex",
        `${prototype.id} ${action} knees are not constrained to the corrected bend direction`,
      );
      assert.ok(
        animationReport.maximumKneeTwistDegrees <= 2,
        `${prototype.id} ${action} retains excessive knee twist`,
      );
      assert.ok(
        animationReport.maximumLimbExcursionDegrees <= 18,
        `${prototype.id} ${action} limb excursion is still large enough to collapse the rig`,
      );
      assert.equal(
        animationReport.bilateralPhaseOffset,
        0.5,
        `${prototype.id} ${action} is not a stable alternating gait`,
      );
      const hindChainBones = [
        "Hips",
        "LeftUpLeg",
        "LeftLeg",
        "LeftFoot",
        "LeftToeBase",
        "RightUpLeg",
        "RightLeg",
        "RightFoot",
        "RightToeBase",
      ];
      const maximumHindChainDeviation = Math.max(
        ...hindChainBones.flatMap((boneName) => {
          const bindRotation = bindRotationByBone.get(boneName);
          const samples = samplesByBone.get(boneName);
          assert.ok(bindRotation && samples?.length, `${clipLabel} is missing ${boneName}`);
          return samples.map((sample) => quaternionDeltaDegrees(bindRotation, sample));
        }),
      );
      assert.ok(
        maximumHindChainDeviation <= 18,
        `${clipLabel} hind chain departs ${maximumHindChainDeviation.toFixed(2)} degrees from the clean bind plane`,
      );
    }
  }
}

const locomotionPipeline = await readFile(locomotionPipelinePath, "utf8");
for (const marker of [
  "ceremonial-glide",
  "symmetric-back-drift",
  "anatomical-creep",
  "anatomical-backward-flex",
]) {
  assert.match(
    locomotionPipeline,
    new RegExp(marker),
    `Blender locomotion pipeline is missing ${marker}`,
  );
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

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen);
  assert.equal(
    await page.locator("#mansion-menu-dev").textContent(),
    "Dev mode: Off",
    "the player-facing menu does not expose the disabled Developer Mode state",
  );
  await page.locator("#mansion-menu-dev").click();
  assert.equal(
    await page.locator("#mansion-menu-dev").textContent(),
    "Dev mode: On",
    "the player-facing Developer Mode button did not enable the patrol",
  );
  await page.locator("#mansion-menu-resume").click();
  await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).menus.escapeOpen);
  const loaded = await page.evaluate(() => window.MrFeastFresh.awaitDemonPrototypesForQA());
  assert.equal(loaded.enabled, true, "prototype patrol did not enable with developer mode");
  assert.equal(loaded.loadStatus, "ready", "prototype patrol did not finish loading");
  assert.equal(loaded.loaded, 2, "both prototypes were not loaded");
  assert.equal(loaded.visible, 2, "both prototypes are not visible");
  for (const entry of loaded.entries) {
    const expectedLocomotionStyle = entry.id === "banquet-saint"
      ? "ceremonial-glide"
      : "anatomical-creep";
    assert.equal(
      entry.locomotionStyle,
      expectedLocomotionStyle,
      `${entry.id} runtime locomotion style is stale`,
    );
    assert.equal(entry.grounded, true, `${entry.id} is not grounded at runtime`);
    assert.ok(entry.boundClips.includes("idle"), `${entry.id} idle is not bound`);
    assert.ok(entry.boundClips.includes("walk"), `${entry.id} walk is not bound`);
    assert.ok(entry.boundClips.includes("run"), `${entry.id} run is not bound`);
    if (entry.id === "banquet-saint") {
      for (const action of ["idle", "walk", "run"]) {
        assert.equal(
          entry.animationTracks[action].dynamicRotation,
          2,
          `${entry.id} ${action} moves bones beyond its two arms`,
        );
      }
    }
  }

  const advanced = await page.evaluate(() => window.MrFeastFresh.advanceDemonPrototypesForQA(18));
  for (const entry of advanced.entries) {
    assert.ok(entry.distanceTravelled > 1, `${entry.id} did not patrol`);
    assert.ok(entry.completedLegs >= 1, `${entry.id} did not complete a route leg`);
    assert.ok(entry.poseChanged, `${entry.id} animation remained frozen`);
    assert.ok(entry.turnRadians > 0.1, `${entry.id} did not turn`);
  }

  const stageBox = await page.locator("#mansion-stage").boundingBox();
  assert.ok(stageBox?.width > 0 && stageBox?.height > 0, "mansion stage has no visible browser bounds");
  for (const id of ["pale-maw", "banquet-saint"]) {
    const framed = await page.evaluate((prototypeId) => window.MrFeastFresh.frameDemonPrototypeForQA(prototypeId), id);
    assert.equal(framed.id, id, `could not frame ${id}`);
    assert.equal(framed.visible, true, `${id} disappeared while framed`);
    for (const [action, phase] of [["idle", 0.36], ["walk", 0.24], ["run", 0.3]]) {
      for (const sampledPhase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
        const sampled = await page.evaluate(
          ({ prototypeId, actionName, actionPhase }) => (
            window.MrFeastFresh.poseDemonPrototypeForQA(
              prototypeId,
              actionName,
              actionPhase,
            )
          ),
          {
            prototypeId: id,
            actionName: action,
            actionPhase: sampledPhase,
          },
        );
        assert.equal(
          sampled.activeClip,
          action,
          `${id} did not hold its ${action} clip at phase ${sampledPhase}`,
        );
      }
      const posed = await page.evaluate(
        ({ prototypeId, actionName, actionPhase }) => (
          window.MrFeastFresh.poseDemonPrototypeForQA(prototypeId, actionName, actionPhase)
        ),
        { prototypeId: id, actionName: action, actionPhase: phase },
      );
      assert.equal(posed.activeClip, action, `${id} did not pose its ${action} clip`);
      await page.waitForTimeout(120);
      await page.screenshot({
        path: path.join(artifactDir, `${id}-${action}.png`),
        clip: stageBox,
      });
    }
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen);
  await page.locator("#mansion-menu-dev").click();
  const disabled = await page.evaluate(() => window.MrFeastFresh.getDemonPrototypeState());
  assert.equal(disabled.enabled, false, "prototype patrol stayed enabled");
  assert.equal(disabled.visible, 0, "prototype actors stayed visible");
  assert.ok(disabled.entries.every((entry) => entry.distanceTravelled === 0), "prototype route state did not reset");

  assert.deepEqual(consoleErrors, [], `browser console errors:\n${consoleErrors.join("\n")}`);
  console.log("Mr. Feast demon prototype browser acceptance checks passed.");
} finally {
  await browser.close();
}
