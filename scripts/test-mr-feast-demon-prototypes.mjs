#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
const pagePath = path.join(root, "games/mr-feast-mansion.html");
const manifestPath = path.join(root, "assets/models/mr-feast/demon-prototypes/manifest.json");
const milestonePath = path.join(root, "docs/milestones/65-demon-prototype-dev-patrol.md");
const locomotionPipelinePath = path.join(root, "scripts/blender/refine-demon-prototype-animation.py");
const PALE_MAW_DEFAULT_MODEL_SHA256 =
  "cb0aac538d2e2cf9665a6e6fc84652226c1d8a7e3364c99d92636a2f9fcdbb5c";

const runtime = await readFile(runtimePath, "utf8");
const pageHtml = await readFile(pagePath, "utf8");
const milestone = await readFile(milestonePath, "utf8");

assert.match(runtime, /const DEMON_PROTOTYPES = Object\.freeze/, "missing named demon prototype tuning table");
const runtimeCacheIdentity = runtime.match(/MANSION_RUNTIME_VERSION = "([^"]+)"/)?.[1] || "";
const pageCacheIdentity = pageHtml.match(/mr-feast-mansion\.js\?v=([^"'&]+)/)?.[1] || "";
assert.ok(
  runtimeCacheIdentity.startsWith("20260726-pale-maw-elbow-tuck-"),
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
assert.match(
  runtime,
  /id: "pale-maw"[\s\S]*?walkPlaybackRate: 1\.0,[\s\S]*?runPlaybackRate: 1\.0,/,
  "Pale Maw clip tempo does not match its patrol travel speed",
);

assert.match(milestone, /\*\*Status:\*\* (In progress|Automated acceptance complete)/, "milestone status is not current");
assert.match(milestone, /With developer mode off[\s\S]*no prototype asset fetch/, "milestone does not protect normal mode");

await access(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.version, 1, "unexpected demon prototype manifest version");
assert.equal(
  manifest.assetVersion,
  "20260726-pale-maw-elbow-tuck-1",
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

function maximumPairwiseQuaternionDelta(samples) {
  let maximum = 0;
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      maximum = Math.max(
        maximum,
        quaternionDeltaDegrees(samples[left], samples[right]),
      );
    }
  }
  return maximum;
}

function sampleRange(values) {
  return Math.max(...values) - Math.min(...values);
}

function correlation(left, right) {
  assert.equal(left.length, right.length, "correlation samples do not match");
  const leftMean = left.reduce((total, value) => total + value, 0) / left.length;
  const rightMean = right.reduce((total, value) => total + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  return numerator / Math.sqrt(leftVariance * rightVariance);
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
  const modelBuffer = await readFile(modelPath);
  const modelGlb = parseGlb(modelBuffer, `${prototype.id} model`);
  const model = modelGlb.json;
  const skinJointNames = (model.skins?.[0]?.joints ?? [])
    .map((nodeIndex) => model.nodes?.[nodeIndex]?.name)
    .filter(Boolean);
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
  if (prototype.id === "pale-maw") {
    assert.equal(
      createHash("sha256").update(modelBuffer).digest("hex"),
      PALE_MAW_DEFAULT_MODEL_SHA256,
      "Pale Maw model no longer matches the accepted default processed bind",
    );
    assert.equal(
      report.restPosture?.name,
      "processed-source-bind",
      "Pale Maw runtime model must preserve the default processed bind pose",
    );
    for (const [field, expected] of [
      ["hipsPitchDegrees", 0],
      ["armRaiseDegrees", 0],
      ["neckLiftDegrees", 0],
      ["lateralScale", 1],
    ]) {
      assert.equal(
        report.restPosture?.[field],
        expected,
        `Pale Maw default bind unexpectedly changes ${field}`,
      );
    }
    assert.equal(
      model.meshes?.length,
      1,
      "Pale Maw runtime GLB retained a non-skin rig helper mesh",
    );
  }

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
        animationReport.baselinePose,
        "processed-bind",
        `${prototype.id} ${action} still uses the crouched, sideways idle basis`,
      );
      assert.equal(
        animationReport.legMotionDegrees,
        0,
        `${prototype.id} ${action} must glide with motionless legs`,
      );
      assert.equal(
        animationReport.armMotionMode,
        "straight-pendulum-rear-trail",
        `${prototype.id} ${action} arms must hang and trail together`,
      );
      assert.ok(
        animationReport.armExcursionDegrees >= (action === "idle" ? 1.5 : 5)
          && animationReport.armExcursionDegrees <= 14,
        `${prototype.id} ${action} pendulum movement is outside its restrained range`,
      );
      assert.ok(
        animationReport.armSymmetryErrorDegrees <= 0.1,
        `${prototype.id} ${action} arm motion is not symmetric`,
      );
      assert.ok(
        animationReport.kneeLockMinimumDegrees >= 178.5,
        `${prototype.id} ${action} knees are not locked straight`,
      );
      assert.ok(
        animationReport.elbowLockMinimumDegrees >= 178.5,
        `${prototype.id} ${action} elbows are not locked straight`,
      );
      assert.equal(
        animationReport.pendulumOpposesTravel,
        true,
        `${prototype.id} ${action} arms do not trail opposite travel`,
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
        animationReport.maximumIkErrorMeters <= 0.01,
        `${prototype.id} ${action} contact solver misses its limb target`,
      );
      assert.equal(
        animationReport.bodyPosture,
        "default-processed-bind",
        `${prototype.id} ${action} is not authored on the accepted default body pose`,
      );
      assert.equal(
        animationReport.jointStabilization,
        "twist-free-two-bone-contact-ik",
        `${prototype.id} ${action} does not use the stable contact IK chain`,
      );
      assert.equal(
        animationReport.armDriver,
        "upper-arm-and-forearm-contact-chain",
        `${prototype.id} ${action} does not plant through both front-arm segments`,
      );
      assert.equal(
        animationReport.frontElbowControl?.bendMode,
        "symmetric-inward-pole",
        `${prototype.id} ${action} does not tuck both front elbows toward the body`,
      );
      assert.ok(
        animationReport.frontElbowControl?.maximumLateralSpanMeters <= 1.65,
        `${prototype.id} ${action} front elbows still bow too far apart`,
      );
      assert.ok(
        animationReport.frontElbowControl?.maximumOutwardOffsetMeters <= 0.55,
        `${prototype.id} ${action} front elbow moves too far outside its shoulder`,
      );
      assert.deepEqual(
        animationReport.diagonalPairs,
        {
          leftArm: "rightLeg",
          rightArm: "leftLeg",
        },
        `${prototype.id} ${action} does not declare the requested diagonal gait`,
      );
      assert.ok(
        Object.values(animationReport.jointAngleExcursionDegrees)
          .every((excursion) => excursion <= 60),
        `${prototype.id} ${action} over-folds a knee or elbow`,
      );
      assert.ok(
        animationReport.surfaceEdgeDeformation.maximumGrowthMeters <= 0.11,
        `${prototype.id} ${action} stretches a surface edge by more than 11cm`,
      );
      const animatedLimbBones = new Set([
        "LeftArm",
        "LeftForeArm",
        "LeftHand",
        "RightArm",
        "RightForeArm",
        "RightHand",
        "LeftUpLeg",
        "LeftLeg",
        "RightUpLeg",
        "RightLeg",
      ]);
      for (const boneName of skinJointNames.filter(
        (name) => !animatedLimbBones.has(name),
      )) {
        const bindRotation = bindRotationByBone.get(boneName);
        const samples = samplesByBone.get(boneName);
        assert.ok(bindRotation && samples?.length, `${clipLabel} is missing core bind bone ${boneName}`);
        assert.ok(
          samples.every((sample) => quaternionDeltaDegrees(bindRotation, sample) <= 0.02),
          `${clipLabel} changes ${boneName} instead of preserving the default model`,
        );
      }
      if (action === "idle") {
        assert.ok(
          animationReport.maximumLimbExcursionDegrees <= 30,
          `${prototype.id} idle is too restless`,
        );
      } else {
        assert.equal(
          animationReport.contactSolver,
          "planted-diagonal-two-bone-ik",
          `${prototype.id} ${action} does not solve each hand and foot to the floor`,
        );
        assert.equal(
          animationReport.propulsionMode,
          "four-limb-contact-push",
          `${prototype.id} ${action} does not use a four-limb propulsion gait`,
        );
        assert.ok(
          animationReport.maximumLimbExcursionDegrees >= 45
          && animationReport.maximumLimbExcursionDegrees <= 105,
          `${prototype.id} ${action} limb excursion does not match patrol speed`,
        );
        assert.ok(
          animationReport.minimumContactSweepMeters >= 0.45,
          `${prototype.id} ${action} contact sweep is too short to propel the root`,
        );
        for (const limbName of [
          "LeftHand",
          "RightHand",
          "LeftFoot",
          "RightFoot",
        ]) {
          const contact = animationReport.limbGroundContact?.[limbName];
          assert.ok(contact, `${prototype.id} ${action} has no ${limbName} floor-contact report`);
          assert.ok(
            contact.minimumClearanceMeters <= 0.035,
            `${prototype.id} ${action} ${limbName} never plants on the floor`,
          );
          assert.ok(
            contact.maximumPenetrationMeters <= 0.055,
            `${prototype.id} ${action} ${limbName} penetrates the floor`,
          );
          assert.ok(
            contact.liftMeters >= 0.04,
            `${prototype.id} ${action} ${limbName} does not lift for recovery`,
          );
          assert.ok(
            contact.plantedSampleRatio >= 0.16,
            `${prototype.id} ${action} ${limbName} has no sustained planted phase`,
          );
        }
        for (const boneName of [
          "LeftArm",
          "RightArm",
          "LeftUpLeg",
          "RightUpLeg",
          "LeftForeArm",
          "RightForeArm",
          "LeftLeg",
          "RightLeg",
        ]) {
          const samples = samplesByBone.get(boneName);
          assert.ok(samples?.length, `${clipLabel} is missing ${boneName}`);
          assert.ok(
            maximumPairwiseQuaternionDelta(samples) >= 4,
            `${clipLabel} ${boneName} does not participate in the planted gait`,
          );
        }
      }
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
        maximumHindChainDeviation <= 85,
        `${clipLabel} hind chain departs ${maximumHindChainDeviation.toFixed(2)} degrees from the clean bind plane`,
      );
    }
  }
}

const locomotionPipeline = await readFile(locomotionPipelinePath, "utf8");
for (const marker of [
  "ceremonial-glide",
  "straight-pendulum-rear-trail",
  "anatomical-creep",
  "anatomical-backward-flex",
  "four-limb-contact-push",
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
    assert.ok(
      Number.isFinite(entry.route.walkPlaybackRate)
      && Number.isFinite(entry.route.runPlaybackRate),
      `${entry.id} does not report locomotion playback rates`,
    );
    if (entry.id === "banquet-saint") {
      for (const action of ["idle", "walk", "run"]) {
        assert.equal(
          entry.animationTracks[action].dynamicRotation,
          2,
          `${entry.id} ${action} moves bones beyond its two arms`,
        );
      }
    } else {
      for (const action of ["walk", "run"]) {
        assert.equal(
          entry.animationTracks[action].dynamicRotation,
          10,
          `${entry.id} ${action} must solve all four contact chains and preserve both planted palms`,
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
    assert.ok(
      entry.minimumFacingAlignment >= 0.96,
      `${entry.id} strafed instead of facing its patrol travel`,
    );
  }

  const stageBox = await page.locator("#mansion-stage").boundingBox();
  assert.ok(stageBox?.width > 0 && stageBox?.height > 0, "mansion stage has no visible browser bounds");
  for (const id of ["pale-maw", "banquet-saint"]) {
    const framed = await page.evaluate((prototypeId) => window.MrFeastFresh.frameDemonPrototypeForQA(prototypeId), id);
    assert.equal(framed.id, id, `could not frame ${id}`);
    assert.equal(framed.visible, true, `${id} disappeared while framed`);
    for (const [action, phase] of [["idle", 0.36], ["walk", 0.24], ["run", 0.3]]) {
      const anatomySamples = [];
      let lastSampled = null;
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
        lastSampled = sampled;
        assert.equal(
          sampled.activeClip,
          action,
          `${id} did not hold its ${action} clip at phase ${sampledPhase}`,
        );
        assert.ok(sampled.anatomy, `${id} ${action} has no anatomy diagnostics`);
        anatomySamples.push(sampled.anatomy);
      }
      if (id === "banquet-saint") {
        for (const anatomy of anatomySamples) {
          assert.ok(
            Math.min(anatomy.joints.leftKnee, anatomy.joints.rightKnee) >= 178.5,
            `${id} ${action} bends a locked knee`,
          );
          assert.ok(
            Math.min(anatomy.joints.leftElbow, anatomy.joints.rightElbow) >= 178.5,
            `${id} ${action} bends a locked elbow`,
          );
          assert.ok(
            anatomy.facingAlignment >= 0.97,
            `${id} ${action} faces sideways`,
          );
          if (action !== "idle") {
            assert.ok(
              Math.max(anatomy.armTrail.left, anatomy.armTrail.right) <= -0.04,
              `${id} ${action} arms do not trail behind travel`,
            );
          }
        }
      } else {
        for (const anatomy of anatomySamples) {
          assert.ok(
            anatomy.frontElbows.lateralSpan <= 1.65,
            `${id} ${action} front elbows span ${anatomy.frontElbows.lateralSpan.toFixed(3)}m`,
          );
          assert.ok(
            anatomy.frontElbows.maximumOutwardOffset <= 0.55,
            `${id} ${action} elbow bows ${anatomy.frontElbows.maximumOutwardOffset.toFixed(3)}m outside its shoulder`,
          );
        }
      }
      if (id === "pale-maw" && action !== "idle") {
        const playbackRate = action === "run"
          ? lastSampled.route.runPlaybackRate
          : lastSampled.route.walkPlaybackRate;
        const travelSpeed = action === "run"
          ? lastSampled.route.runSpeed
          : lastSampled.route.speed;
        const plantedHalfCycleTravel = (
          travelSpeed * lastSampled.animationDuration / playbackRate / 2
        );
        const projectionsByLimb = Object.fromEntries(
          ["LeftHand", "RightHand", "LeftFoot", "RightFoot"].map((limbName) => [
            limbName,
            anatomySamples.map((anatomy) => (
              anatomy.limbTips[limbName].x * anatomy.forwardLocal.x
              + anatomy.limbTips[limbName].z * anatomy.forwardLocal.z
            )),
          ]),
        );
        const jointSamples = {
          leftKnee: anatomySamples.map((anatomy) => anatomy.joints.leftKnee),
          rightKnee: anatomySamples.map((anatomy) => anatomy.joints.rightKnee),
          leftElbow: anatomySamples.map((anatomy) => anatomy.joints.leftElbow),
          rightElbow: anatomySamples.map((anatomy) => anatomy.joints.rightElbow),
        };
        for (const [jointName, values] of Object.entries(jointSamples)) {
          assert.ok(
            sampleRange(values) <= 60,
            `${id} ${action} ${jointName} over-folds during contact`,
          );
          assert.ok(
            Math.min(...values) >= 40,
            `${id} ${action} ${jointName} collapses or reverses`,
          );
        }
        for (const [limbName, projections] of Object.entries(projectionsByLimb)) {
          const sweep = sampleRange(projections);
          assert.ok(
            sweep >= 0.45,
            `${id} ${action} ${limbName} sweeps only ${sweep.toFixed(3)}m`,
          );
          assert.ok(
            sweep >= plantedHalfCycleTravel,
            `${id} ${action} ${limbName} cannot cover the `
              + `${plantedHalfCycleTravel.toFixed(3)}m root travel of its planted half-cycle`,
          );
        }
        const armSweeps = [
          sampleRange(projectionsByLimb.LeftHand),
          sampleRange(projectionsByLimb.RightHand),
        ];
        const legSweeps = [
          sampleRange(projectionsByLimb.LeftFoot),
          sampleRange(projectionsByLimb.RightFoot),
        ];
        assert.ok(
          Math.min(...armSweeps) / Math.max(...armSweeps) >= 0.82,
          `${id} ${action} right/left arm movement is visibly unbalanced`,
        );
        assert.ok(
          Math.min(...legSweeps) / Math.max(...legSweeps) >= 0.82,
          `${id} ${action} right/left leg movement is visibly unbalanced`,
        );
        assert.ok(
          correlation(
            projectionsByLimb.LeftHand,
            projectionsByLimb.RightFoot,
          ) >= 0.95,
          `${id} ${action} left arm does not pair with right leg`,
        );
        assert.ok(
          correlation(
            projectionsByLimb.RightHand,
            projectionsByLimb.LeftFoot,
          ) >= 0.95,
          `${id} ${action} right arm does not pair with left leg`,
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
