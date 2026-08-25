/* ============================================================
   SAINTFALL - Kenosis playable figures

   The body is intentionally its own rigged GLB. Weapons remain a
   separate concern, so this figure can be tested on Kenosis without
   baking either hybrid blade into the character mesh.

   This adapter implements the figure contract consumed by player.js:
   the shared controller still owns locomotion, terrain IK, camera and
   traversal, while the selected operative supplies only the skinned
   appearance and its figure-specific resting pose.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";

const WHITE_VIGIL = {
  name: "White Vigil",
  assetPath: "../../../assets/models/saintfall/white-vigil/white-vigil-player.glb",
  assetSource: "white-vigil-player.glb",
  roughness: 0.56,
  metalness: 0.18,
  emissiveIntensity: 0.12,
  ankle: 0.196,
  restPitch: 1.01,
  handGripInset: 0.116,
  palmTurnDeg: 35,
  freeArmPose: {
    idleX: 0.205, idleY: 0.980, idleZ: 0.060,
    walkX: 0.015, walkY: 0.020, sprintX: 0.008, sprintY: 0.080,
    walkSwing: 0.135, sprintSwing: 0.065, swingLift: 0.38, liftY: 0.75,
    flightX: 0.230, flightY: 1.050, flightZ: -0.150,
  },
};

const BASTION_PENITENT = {
  name: "Bastion Penitent",
  assetPath: "../../../assets/models/saintfall/red-bastion/red-bastion-player.glb",
  assetSource: "red-bastion-player.glb",
  roughness: 0.58,
  metalness: 0.22,
  emissiveIntensity: 0.20,
  /* The second Meshy rig was requested at 2.00m. These initial
     targets preserve the same relaxed reach ratios as the proven
     1.90m figure while keeping its broader sabatons planted. */
  ankle: 0.205,
  restPitch: 1.01,
  handGripInset: 0.122,
  palmTurnDeg: 35,
  locomotionProfile: {
    /* A broad, deliberate bulwark rather than White Vigil at a lower
       playback rate. Lower top speed and longer response times carry
       inertia; the gait then adds a longer cycle, more double support,
       deeper contact compression, and visible side-to-side weight. */
    walkSpeed: 3.15,
    sprintSpeed: 5.65,
    groundAcceleration: 1.55,
    groundDeceleration: 2.20,
    turnResponseScale: 0.74,
    flightSpeedScale: 0.82,
    gaitSettleSpeed: 1.35,
    gaitSettleCadence: 3.00,
    hipHalf: 0.230,
    stanceGuard: 0.180,
    strideScale: 1.18,
    stanceBias: 0.10,
    stepLiftScale: 0.90,
    bodyDropScale: 1.48,
    impactScale: 1.36,
    passingRiseScale: 0.68,
    weightSwayM: 0.030,
    weightRoll: 0.026,
  },
  freeArmPose: {
    /* Hands ride outside the thigh plates and the elbow poles stay
       outboard, matching the concept's squared, space-owning frame. */
    idleX: 0.385, idleY: 1.015, idleZ: 0.020,
    walkX: 0.025, walkY: 0.015, sprintX: 0.025, sprintY: 0.060,
    walkSwing: 0.115, sprintSwing: 0.065, swingLift: 0.32, liftY: 0.55,
    flightX: 0.360, flightY: 1.085, flightZ: -0.175,
    poleX: 0.42, poleSprintX: 0.08, poleY: -0.54, poleZ: -0.70,
    flightPoleX: 0.45, flightPoleY: -0.46, flightPoleZ: -0.84,
  },
};

export function buildWhiteVigilTrooper(ctx) {
  return buildMeshyVigilTrooper(ctx, WHITE_VIGIL);
}

export function buildBastionPenitentTrooper(ctx) {
  return buildMeshyVigilTrooper(ctx, BASTION_PENITENT);
}

async function buildMeshyVigilTrooper(ctx, spec) {
  const { THREE, atmos } = ctx;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const url = new URL(spec.assetPath, import.meta.url);
  if (ctx.build) url.searchParams.set("v", ctx.build);

  const gltf = await loader.loadAsync(url.href);
  const root = gltf.scene;
  root.name = "trooper";
  /* The rig request was authored at 1.90m. Unlike the older Vesper
     source, it needs no gameplay-scale correction after import. */
  root.scale.setScalar(1);

  let triangles = 0;
  const partMeshes = [];
  const readabilityMaterials = [];
  const seenMaterials = new Set();
  root.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    partMeshes.push(child);
    const geometry = child.geometry;
    triangles += (geometry.index
      ? geometry.index.count
      : geometry.attributes.position.count) / 3;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.35;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material || seenMaterials.has(material.uuid)) continue;
      seenMaterials.add(material.uuid);
      /* The rigged GLB omits both factors, whose glTF defaults are
         roughness=1 and metallic=1. That combination reflects the
         dark alpine sky across the entire ivory suit and makes it
         look black on snow. The concept is ceramic plate with metal
         edging, so a restrained shared compromise is the honest read
         until those regions are split into authored materials. */
      material.roughness = spec.roughness;
      material.metalness = spec.metalness;
      if ("specularIntensity" in material) material.specularIntensity = 0.68;
      material.envMapIntensity = 0.92;
      material.side = THREE.DoubleSide;
      /* Meshy's preview is authored with the colour atlas in both the
         base and emissive slots. Keep only a restrained fraction of
         that contribution: enough for the ivory/gold/verdigris read
         to survive blue shadow, nowhere near enough to self-light. */
      if (material.emissive) material.emissive.set(0xffffff);
      material.emissiveMap = material.emissiveMap || material.map;
      material.emissiveIntensity = spec.emissiveIntensity;
      patchMaterial(material, atmos, { rim: 1.30, glitter: 0 });
    }
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
  });

  const need = (name) => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`${spec.name} rig is missing required bone "${name}"`);
    return node;
  };

  const chest = need("Spine");
  const head = need("Head");
  /* Meshy's anatomical Right bones occupy model -X in the bind pose.
     player.js indexes legs by spatial side and arms by grip role, so
     these arrays intentionally match the proven Vesper adapter. */
  const legPivots = [need("RightUpLeg"), need("LeftUpLeg")];
  const kneePivots = [need("RightLeg"), need("LeftLeg")];
  const footPivots = [need("RightFoot"), need("LeftFoot")];
  const toePivots = [need("RightToeBase"), need("LeftToeBase")];
  const armPivots = [need("LeftArm"), need("RightArm")];
  const elbowPivots = [need("LeftForeArm"), need("RightForeArm")];
  const handPivots = [need("LeftHand"), need("RightHand")];

  const palmLocators = handPivots.map((hand, index) => {
    const palm = new THREE.Object3D();
    palm.name = index === 0 ? "LeftPalmContact" : "RightPalmContact";
    /* Meshy's armature is centimetre-authored below a 0.01 scale. */
    palm.position.set(0, 11.0, 0);
    hand.add(palm);
    return palm;
  });

  root.updateMatrixWorld(true);
  const worldA = new THREE.Vector3();
  const worldB = new THREE.Vector3();
  const jointDistance = (a, b) => {
    a.getWorldPosition(worldA);
    b.getWorldPosition(worldB);
    return worldA.distanceTo(worldB);
  };

  /* Keep the existing equipment contract even though White Vigil is
     deliberately unarmed today. Future weapon GLBs can attach here
     without changing or regenerating the body mesh. */
  const weaponMount = new THREE.Object3D();
  weaponMount.name = "weapon-mount";
  weaponMount.position.set(0.060, 1.34, 0.205);
  weaponMount.rotation.y = -Math.PI / 2;
  root.add(weaponMount);
  root.updateMatrixWorld(true);
  chest.attach(weaponMount);
  root.updateMatrixWorld(true);

  const torsoUpLocal = new THREE.Vector3(0, 1, 0)
    .transformDirection(chest.matrixWorld.clone().invert());

  return {
    root,
    chest,
    head,
    legPivots,
    kneePivots,
    footPivots,
    toePivots,
    armPivots,
    elbowPivots,
    handPivots,
    palmLocators,
    pauldronPivots: [],
    weaponMount,
    crestPivot: null,
    clothPivots: [],
    triangles: Math.round(triangles),
    limb: {
      upper: jointDistance(armPivots[0], elbowPivots[0]),
      fore: jointDistance(elbowPivots[0], handPivots[0]),
      thigh: jointDistance(legPivots[0], kneePivots[0]),
      shin: jointDistance(kneePivots[0], footPivots[0]),
      /* The imported pelvis sits higher than Vesper's relative to its
         leg chain. 0.118m put the ankle target beyond full extension,
         so the IK clamp forced both knees backward and left the
         sabatons balanced on one edge. 0.196m is the measured ankle
         height for the flattened sole pose below: both soles touch
         the terrain while the knees retain a relaxed bend. */
      ankle: spec.ankle,
    },
    legLengths: [0, 1].map((i) => ({
      thigh: jointDistance(legPivots[i], kneePivots[i]),
      shin: jointDistance(kneePivots[i], footPivots[i]),
    })),
    armLengths: [0, 1].map((i) => ({
      upper: jointDistance(armPivots[i], elbowPivots[i]),
      fore: jointDistance(elbowPivots[i], handPivots[i]),
    })),
    handGripInset: spec.handGripInset,
    triggerWristOffsetLocal: new THREE.Vector3(0.85, -0.62, 0.18).normalize(),
    legBindQuaternions: legPivots.map((joint) => joint.quaternion.clone()),
    kneeBindQuaternions: kneePivots.map((joint) => joint.quaternion.clone()),
    armBindQuaternions: armPivots.map((joint) => joint.quaternion.clone()),
    elbowBindQuaternions: elbowPivots.map((joint) => joint.quaternion.clone()),
    handBindQuaternions: handPivots.map((joint) => joint.quaternion.clone()),
    imported: true,
    assetSource: spec.assetSource,
    partMeshes,
    heartLight: null,
    eyeGlow: null,
    readabilityMaterials,
    torsoUpLocal,
    baseScale: root.scale.clone(),
    chestBindQuaternion: chest.quaternion.clone(),
    headBindQuaternion: head.quaternion.clone(),
    weaponBindPosition: weaponMount.position.clone(),
    weaponBindQuaternion: weaponMount.quaternion.clone(),
    armAxis: new THREE.Vector3(0, 1, 0),
    legAxis: new THREE.Vector3(0, 1, 0),
    /* Match Vesper's relaxed silhouette: this Meshy gauntlet also
       presents its visible palm a few degrees ahead of the hand bone. */
    freeHandPalmTurn: THREE.MathUtils.degToRad(spec.palmTurnDeg),
    /* Measured from the posed SKIN, not inferred from the toe bone.
       At the shared 0.55rad value only about 2cm of this authored sole
       sat near the snow. 1.01rad puts roughly 23cm of each sabaton
       within 5mm of the ground plane. */
    footPose: {
      restPitch: spec.restPitch,
    },
    /* Free-hand targets are expressed in figure-root space. Vesper's
       idle hand height was 12cm beyond this rig's reach, which made
       both elbows clamp straight. These targets keep a slight bend at
       rest, swing that bend through a walk, close it for a run, and
       trail the forearms naturally under jetpack flight. */
    freeArmPose: { ...spec.freeArmPose },
    locomotionProfile: spec.locomotionProfile ? { ...spec.locomotionProfile } : null,
  };
}
