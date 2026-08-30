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
import {
  makeGoldLampMaterial,
  makeGoldLampMesh,
  unitsPerWorldMetre,
} from "saintfall/summit-lights.js";

const WHITE_VIGIL = {
  name: "White Vigil",
  assetPath: "../../../assets/models/saintfall/white-vigil/white-vigil-player.glb",
  assetSource: "white-vigil-player.glb",
  /* Which reliquary pack rides the Spine. See jetpacks.js: the scout
     carries an instrument with its engines outboard, the bulwark
     carries a furnace with one bell. Vesper-IX names nothing and
     keeps the Seraph. */
  jetpack: "augur",
  /* THE AUGUR CARRIES MORE CHARGE. The scout's whole pack is
     instrument and tankage - no furnace, no bell - and the operative
     is the mobility kit, so the shared reliquary meter runs deeper
     and refills faster than Vesper's Seraph. Scalars over
     JETPACK_CONFIG (see jetpack.js `figure.jetpackProfile`). */
  jetpackProfile: {
    maxFuelScale: 1.30,
    rechargeRateScale: 1.25,
  },
  /* Dual crescents are wrist weapons: the combo runs 30% faster than
     the lance tempo (player.js MELEE_TIME_SCALE). */
  meleeProfile: { timeScale: 1.30 },
  /* Fast movement is the identity: quicker on foot than Vesper, and
     quicker to reach that speed. Everything not named keeps the
     stock value. */
  locomotionProfile: {
    walkSpeed: 4.8,
    sprintSpeed: 9.6,
    groundAcceleration: 4.4,
    groundDeceleration: 6.2,
    turnResponseScale: 1.12,
  },
  roughness: 0.56,
  metalness: 0.18,
  emissiveIntensity: 0.12,
  goldLights: {
    material: "white-vigil-gold-glow",
    head: [
      {
        name: "white-vigil-eye-left",
        position: [-2.004, 8.197, 4.437],
        normal: [-0.661, 0.297, 0.689],
        /* A facet-local vertical with zero model-X component keeps
           the lamp straight in the frontal silhouette. */
        up: [0.000, 0.918, -0.396],
        widthM: 0.014,
        heightM: 0.048,
      },
      {
        name: "white-vigil-eye-right",
        position: [2.427, 8.114, 4.385],
        normal: [0.598, 0.364, 0.714],
        up: [0.000, 0.891, -0.454],
        widthM: 0.014,
        heightM: 0.048,
      },
    ],
    chest: [
      {
        name: "white-vigil-chest-gem",
        position: [-0.176, -4.150, 10.284],
        normal: [0.009, 0.232, 0.973],
        widthM: 0.046,
        heightM: 0.114,
        /* A jewel is a lit volume, not a face lamp. Keep nearly all
           of the emissive energy at its perimeter so the complete
           socket reads instead of collapsing into one hot pixel. */
        centreBrightness: 0.88,
        perimeterBrightness: 0.88,
      },
    ],
    heart: {
      colour: 0xffaa52,
      intensity: 0.10,
      distance: 1.35,
      /* Keep the local halo, but not a near-field specular pinprick
         on the jewel itself. */
      offsetM: 0.090,
      /* Ivory returns far more of a local lamp than Vesper's dark
         plate. Keep the same time-of-day curve at a lower amplitude
         so the night chest stays modelled instead of clipping white. */
      scale: 0.36,
    },
  },
  ankle: 0.196,
  restPitch: 1.01,
  handGripInset: 0.116,
  palmTurnDeg: 35,
  freeArmPose: {
    idleX: 0.205, idleY: 0.980, idleZ: 0.060,
    walkX: 0.015, walkY: 0.020, sprintX: 0.008, sprintY: 0.080,
    walkSwing: 0.135, sprintSwing: 0.065, swingLift: 0.38, liftY: 0.75,
    /* Widened and brought forward for the crescents. Under the
       jetpack the knees come up to meet the hands, and a half-metre
       blade held along the forearm reaches them: the stock
       0.230/-0.150 swept both through the opposite thigh. Outboard
       alone only halved it - it takes the hands forward of the
       tucked knee as well. */
    flightX: 0.340, flightY: 1.020, flightZ: 0.140,
  },
};

const BASTION_PENITENT = {
  name: "Bastion Penitent",
  assetPath: "../../../assets/models/saintfall/red-bastion/red-bastion-player.glb",
  assetSource: "red-bastion-player.glb",
  jetpack: "censer",
  /* THE CENSER CANNOT FLY. A boiler on legs buys leaps, not lift:
     the flight chord performs a single jet-boosted leap and nothing
     ever hovers (jetpack.js leap mode). Costs and impulse are the
     bulwark's - expensive, high, and committed. */
  /* A boiler on legs buys ground, not lift: 24 m/s held for most of
     the arc carries the bulwark ~18m and clears most of what the
     mountain puts in its way, which is the whole point of the verb
     for a figure that walks at 3.15. Higher and faster than the
     first pass, which set a one-frame nudge and travelled ~4m. */
  jetpackProfile: {
    mode: "leap",
    leap: {
      cost: 22,
      vertical: 13.8,
      driveSpeed: 24.0,
      driveSeconds: 0.85,
      fade: 0.30,
      cooldown: 1.7,
    },
  },
  /* The reliquary hammer swings at three quarters of lance tempo -
     weight the player can feel between presses. */
  /* A HEAVY FIGURE NEEDS A CONTINUOUS CLIP, not just a slower one.
     `smooth` samples the melee keys with a C1 Hermite instead of the
     per-segment easing: the easing is continuous in value but not in
     VELOCITY, and the Bastion multiplies every one of those jolts by
     a 0.83m hammer lever at 0.78x tempo. See player.js's
     MELEE_SMOOTH. */
  meleeProfile: {
    timeScale: 0.78,
    smooth: true,
    /* THE OPENER IS A THRUST, NOT A SWING.
     *
     * The shared melee1 is authored for Vesper's polearm: it counters
     * the chest through 1.56 radians and the pelvis through 0.72
     * while the blade crosses the body. On a figure carrying a
     * two-handed hammer and a tower shield that reads as the torso
     * twisting mid-blow - reported from play as "a weird twist".
     *
     * So the Bastion opens by driving the reliquary straight out
     * instead. The chest barely rotates; what moves is the WEIGHT -
     * the hips square up, the body sinks and leans into the drive,
     * and the front foot plants. Holding forward still turns this
     * press into `meleeLunge`, which is the same shape with a
     * committed dash under it, so a standing thrust and a charging
     * one are the same blow at two ranges.
     *
     * `sweep: 5` draws the lunge STREAK rather than a wide crescent:
     * a thrust that paints an arc is a thrust nobody believes.
     *
     * Channels: [t, x,y,z, pitch,yaw,roll, chestYaw, chestPitch,
     *            pelvisYaw, drop, stanceZ, stanceSpread, slide, lean] */
    clips: {
      melee1: {
        dur: 0.72, hit: [0.28, 0.46], damage: 1.25, arc: 1.0, lunge: 1.45,
        sweep: 5,
        keys: [
          [0.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "load"],
          // Cock: hammer drawn back beside the hip, weight onto the
          // rear foot, shoulders squaring to the target.
          [0.24, 0, 0, 0, 0, 0, 0, -0.16, 0.10, -0.08, 0.045, -0.15, 0.08, -0.045, -0.04, "load"],
          // The drive: everything goes FORWARD. The chest opens only
          // enough to let the arm through - a twelfth of what the
          // shared clip does - and the body sinks into the plant.
          [0.40, 0, 0, 0, 0, 0, 0, 0.13, -0.26, 0.06, -0.075, 0.30, 0.16, 0.235, 0.14, "strike"],
          // Riding it out at full extension before the recovery.
          [0.54, 0, 0, 0, 0, 0, 0, 0.07, -0.14, 0.03, -0.035, 0.17, 0.11, 0.130, 0.07, "settle"],
          [0.72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "settle"],
        ],
      },
    },
  },
  roughness: 0.58,
  metalness: 0.22,
  emissiveIntensity: 0.20,
  goldLights: {
    material: "bastion-penitent-gold-glow",
    head: [
      {
        name: "bastion-penitent-eye",
        /* The tall visor lies on the helmet's raked centre facet.
           `up` follows that rake, rather than cutting a vertical card
           through the widening lower half of the helm. */
        position: [-0.350, 25.200, 1.500],
        normal: [0.000, 0.560, 0.828],
        up: [0.000, 0.828, -0.560],
        widthM: 0.016,
        heightM: 0.172,
      },
    ],
    chest: [],
    heart: null,
  },
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
       inertia; the gait then adds more double support, deeper contact
       compression, and visible side-to-side weight.

       THE FIRST VERSION READ AS A STILT-WALK, and the measurements
       say why. `saintfall-walk-shape-probe.mjs` put the two figures
       side by side at their own walking paces:

                        White Vigil      Bastion v1
         stride            2.05m           2.41m
         cadence          4.29 step/s     2.61 step/s
         track (ankles)    0.23m           0.46m

       Both of those are worse than they look as ratios. This rig is
       1.74m to the crown - the SAME stature as White Vigil, whatever
       the 2.00m request said - on a 1.17m leg, so a 2.41m stride is
       2.07 leg-lengths at a pace where 1.6 is what a body that heavy
       would take; and a 0.46m track is wider than the figure's own
       hip bones, which are 0.33m apart. Long steps at a low cadence
       with the feet outside the hips is the definition of a waddle,
       and slowing the cycle further to sell weight makes it worse,
       not better. Weight is in the DROP and the roll, which is where
       it now lives. */
    walkSpeed: 3.15,
    sprintSpeed: 5.65,
    groundAcceleration: 1.55,
    groundDeceleration: 2.20,
    turnResponseScale: 0.74,
    flightSpeedScale: 0.82,
    gaitSettleSpeed: 1.35,
    gaitSettleCadence: 3.00,
    /* Standing wide and walking narrow. The planted bulwark stance
       is the read this figure was designed around and is unchanged;
       the track it walks on closes to just inside its own hip bones,
       because the mass has to pass over each planted foot. */
    hipHalf: 0.230,
    hipHalfMoving: 0.150,
    /* The CEILING on the planted-foot guard, not the guard itself:
       once a figure narrows its track, player.js sizes that guard off
       the narrowest width it can plant at (0.120 here) so widening
       back out to the standing stance can never shove a planted
       sabaton. This still holds the ceiling below the standing
       width, which is what it was authored for. */
    stanceGuard: 0.180,
    strideScale: 0.92,
    stanceBias: 0.10,
    stepLiftScale: 0.90,
    bodyDropScale: 1.48,
    impactScale: 1.36,
    passingRiseScale: 0.68,
    weightSwayM: 0.030,
    weightRoll: 0.026,
    /* Tipped further into the march than the default body. At the
       shared values this figure walked at 5.7 degrees off vertical,
       which reads as a suit of armour being carried upright rather
       than a body driving one forward. 10 degrees at a walk is a
       lean you can see from the side; the sprint moves much less
       (16 -> 18) because it was already committed. */
    leanWalk: 0.100,
    leanSprint: 0.120,
    spineLeanWalk: 0.075,
    spineLeanSprint: 0.020,
  },
  freeArmPose: {
    /* Hands ride outside the thigh plates and the elbow poles stay
       outboard, matching the concept's squared, space-owning frame.

       BUT NOT AT FULL STRETCH. This rig's arm is 0.72m against White
       Vigil's 0.55m, so the inherited hand targets left the elbow
       carried at 143 degrees - all but locked - and travelling
       140..149 across a whole stride. Nine degrees. The arm was a
       plank on a hinge, and no amount of widening the SWING fixes
       that, because a wider swing on a locked elbow is a longer
       pendulum.

       Three changes, each measured back off the joint with
       `--sweep fold`, because the elbow is not authored anywhere: it
       is whatever the distance from shoulder to this target leaves
       over. The hands come 5cm inboard and 4cm up, which folds the
       carried elbow to 125 degrees; the swing doubles; and
       `swingFoldY` closes the elbow on the drive and lets it open on
       the return. The joint now travels 111..125..148 - a 37-degree
       range where there were nine. The elbow poles are untouched;
       the side the bend chooses was never the problem.

       ALL OF IT RIDES `walkX`/`walkY`, NOT THE IDLE TARGET. The
       standing figure is the one pose nobody complained about, and
       authoring the folded carry into `idleX`/`idleY` took its
       elbows from 153 degrees to 129 - a different statue. These two
       are scaled by the walk ramp, so a stationary Bastion holds
       exactly the arms it always held and folds them as it steps
       off. Standing: 0.385/1.015. Walking: 0.360/1.070. */
    idleX: 0.385, idleY: 1.015, idleZ: 0.020,
    walkX: -0.025, walkY: 0.055, sprintX: 0.025, sprintY: 0.060,
    walkSwing: 0.235, sprintSwing: 0.105, swingLift: 0.32, liftY: 0.55,
    swingFoldY: 0.22,
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
  root.updateMatrixWorld(true);
  const goldMaterial = makeGoldLampMaterial(THREE, atmos, {
    name: spec.goldLights.material,
    intensity: 4.2,
  });
  const glowMeshes = [];
  let headGlow = null;
  if (spec.goldLights.head.length) {
    headGlow = makeGoldLampMesh(THREE, {
      name: `${spec.assetSource}-face-gold`,
      material: goldMaterial,
      targets: spec.goldLights.head,
      unitsPerMetre: unitsPerWorldMetre(THREE, head),
      standoffM: 0.003,
    });
    head.add(headGlow);
    glowMeshes.push(headGlow);
  }
  let chestMaterial = null;
  if (spec.goldLights.chest.length) {
    /* Vesper's chest amber runs at intensity 1 with a nearby point
       light; its face lamps run at 4.2. Keep that hierarchy here so
       the larger jewel glows through its frame without becoming a
       flat yellow flare larger than the socket itself. */
    chestMaterial = makeGoldLampMaterial(THREE, atmos, {
      name: `${spec.assetSource}-chest-amber`,
      intensity: 1.55,
    });
    chestMaterial.roughness = 0.78;
    const chestGlow = makeGoldLampMesh(THREE, {
      name: `${spec.assetSource}-chest-gold`,
      material: chestMaterial,
      targets: spec.goldLights.chest,
      unitsPerMetre: unitsPerWorldMetre(THREE, chest),
      standoffM: 0.003,
    });
    chest.add(chestGlow);
    glowMeshes.push(chestGlow);
  }
  let heartLight = null;
  if (spec.goldLights.heart && spec.goldLights.chest[0]) {
    const source = spec.goldLights.chest[0];
    const chestUnits = unitsPerWorldMetre(THREE, chest);
    heartLight = new THREE.PointLight(
      spec.goldLights.heart.colour,
      spec.goldLights.heart.intensity,
      spec.goldLights.heart.distance,
      2);
    heartLight.name = `${spec.assetSource}-heart-light`;
    heartLight.userData.sfIntensityScale = spec.goldLights.heart.scale ?? 1;
    heartLight.position.fromArray(source.position).addScaledVector(
      new THREE.Vector3().fromArray(source.normal).normalize(),
      spec.goldLights.heart.offsetM * chestUnits);
    heartLight.castShadow = false;
    chest.add(heartLight);
  }
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

  /* Preserve the legacy chest equipment contract for shared combat
     systems. The new character-specific weapon GLBs attach through
     the palm locators above, without changing either body mesh. */
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
    jetpack: spec.jetpack || null,
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
    heartLight,
    eyeGlow: { meshes: headGlow ? [headGlow] : [], material: goldMaterial },
    glowStatus: {
      materials: [goldMaterial.name, chestMaterial?.name].filter(Boolean),
      meshes: glowMeshes.map((mesh) => mesh.name),
      targets: [...spec.goldLights.head, ...spec.goldLights.chest]
        .map((target) => target.name),
      pointLight: heartLight?.name || null,
    },
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
    /* Kenosis kit authorship channels, consumed by player.js
       (melee tempo) and jetpack.js (pack proportions / leap mode). */
    meleeProfile: spec.meleeProfile ? { ...spec.meleeProfile } : null,
    jetpackProfile: spec.jetpackProfile
      ? JSON.parse(JSON.stringify(spec.jetpackProfile)) : null,
  };
}
