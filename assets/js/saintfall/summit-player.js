/* ============================================================
   SAINTFALL - White Vigil player figure

   The body is intentionally its own rigged GLB. Weapons remain a
   separate concern, so this figure can be tested on Kenosis without
   baking either hybrid blade into the character mesh.

   This adapter implements the figure contract consumed by player.js:
   the shared controller still owns locomotion, terrain IK, camera and
   traversal, while White Vigil supplies only the skinned appearance.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";

export async function buildWhiteVigilTrooper(ctx) {
  const { THREE, atmos } = ctx;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const url = new URL(
    "../../../assets/models/saintfall/white-vigil/white-vigil-player.glb",
    import.meta.url
  );
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
      material.roughness = 0.56;
      material.metalness = 0.18;
      if ("specularIntensity" in material) material.specularIntensity = 0.68;
      material.envMapIntensity = 0.92;
      material.side = THREE.DoubleSide;
      /* Meshy's preview is authored with the colour atlas in both the
         base and emissive slots. Keep only a restrained fraction of
         that contribution: enough for the ivory/gold/verdigris read
         to survive blue shadow, nowhere near enough to self-light. */
      if (material.emissive) material.emissive.set(0xffffff);
      material.emissiveMap = material.emissiveMap || material.map;
      material.emissiveIntensity = 0.12;
      patchMaterial(material, atmos, { rim: 1.30, glitter: 0 });
    }
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
  });

  const need = (name) => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`White Vigil rig is missing required bone "${name}"`);
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
      ankle: 0.196,
    },
    legLengths: [0, 1].map((i) => ({
      thigh: jointDistance(legPivots[i], kneePivots[i]),
      shin: jointDistance(kneePivots[i], footPivots[i]),
    })),
    armLengths: [0, 1].map((i) => ({
      upper: jointDistance(armPivots[i], elbowPivots[i]),
      fore: jointDistance(elbowPivots[i], handPivots[i]),
    })),
    handGripInset: 0.116,
    triggerWristOffsetLocal: new THREE.Vector3(0.85, -0.62, 0.18).normalize(),
    legBindQuaternions: legPivots.map((joint) => joint.quaternion.clone()),
    kneeBindQuaternions: kneePivots.map((joint) => joint.quaternion.clone()),
    armBindQuaternions: armPivots.map((joint) => joint.quaternion.clone()),
    elbowBindQuaternions: elbowPivots.map((joint) => joint.quaternion.clone()),
    handBindQuaternions: handPivots.map((joint) => joint.quaternion.clone()),
    imported: true,
    assetSource: "white-vigil-player.glb",
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
    freeHandPalmTurn: THREE.MathUtils.degToRad(35),
    /* Measured from the posed SKIN, not inferred from the toe bone.
       At the shared 0.55rad value only about 2cm of this authored sole
       sat near the snow. 1.01rad puts roughly 23cm of each sabaton
       within 5mm of the ground plane. */
    footPose: {
      restPitch: 1.01,
    },
    /* Free-hand targets are expressed in figure-root space. Vesper's
       idle hand height was 12cm beyond this rig's reach, which made
       both elbows clamp straight. These targets keep a slight bend at
       rest, swing that bend through a walk, close it for a run, and
       trail the forearms naturally under jetpack flight. */
    freeArmPose: {
      idleX: 0.205,
      idleY: 0.980,
      idleZ: 0.060,
      walkX: 0.015,
      walkY: 0.020,
      sprintX: 0.008,
      sprintY: 0.080,
      walkSwing: 0.135,
      sprintSwing: 0.065,
      swingLift: 0.38,
      liftY: 0.75,
      flightX: 0.230,
      flightY: 1.050,
      flightZ: -0.150,
    },
  };
}
