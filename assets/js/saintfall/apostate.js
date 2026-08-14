/* ============================================================
   SAINTFALL - The Apostate

   The operation's final enemy is the player silhouette after the Bloom has
   learned it: the same Reliquary trooper, the same Censer-Lance, the same
   movement and defensive verbs, with the command rite replaced by a brood
   call. It is intentionally a self-driven enemy. Player systems own input,
   camera, fuel and enemy-facing damage; this module mirrors their readable
   timings while keeping independent boss state and player-facing damage.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus,
} from "saintfall/core.js";
import { PALETTE, patchMaterial, patchBasicMaterial } from "saintfall/art.js";
import { DISTRICTS } from "saintfall/terrain.js";
import { buildReliquaryFigure } from "saintfall/player.js";
import { initIk, solveTwoJoint } from "saintfall/ik.js";

export const APOSTATE_CONFIG = Object.freeze({
  arenaX: DISTRICTS.cathedral.x,
  /* North of the nave's middle, under the broken vault and clear of the
     three intact coronae at z +6/+26/+46. */
  arenaZ: DISTRICTS.cathedral.z - 23,
  arenaRadius: 42,
  revealRadius: 54,
  naveHalfWidth: 20.5,
  naveHalfLength: 62,
  revealSeconds: 4.8,
  disengageRadius: 92,
  disengageSeconds: 12,
  health: 5600,
  bodyScale: 1.12,
  walkSpeed: 5.6,
  strafeSpeed: 3.4,
  holdRange: Object.freeze([8.5, 15.5]),

  shotDamage: 9,
  shotSpeed: 126,
  shotCount: 6,
  shotGap: 0.115,
  shotCadence: 3.6,
  shotSpread: 0.055,
  heatPerShot: 0.0333,
  heatCoolDelay: 0.55,
  /* Bloom-choked vents shed heat far more slowly than the player's clean
     reliquary, so sustained pressure eventually forces the mirrored vent
     vulnerability instead of every six-shot burst cooling to zero. */
  heatCoolRate: 0.025,
  ventSeconds: 1.4,
  overheatReset: 0.25,

  meleeCadence: 2.1,
  melee: Object.freeze([
    Object.freeze({ duration: 0.76, hit: 0.36, damage: 24, reach: 4.55, arc: 1.42 }),
    Object.freeze({ duration: 0.78, hit: 0.34, damage: 22, reach: 3.45, arc: 2.72 }),
    Object.freeze({ duration: 0.96, hit: 0.42, damage: 38, reach: 3.60, arc: 2.05 }),
  ]),

  boostCadence: 8.5,
  boostSeconds: 0.58,
  boostSpeed: 19,
  boostDamage: 32,
  boostReach: 1.75,

  shieldCadence: 13,
  shieldSeconds: 3.1,
  shieldFrontDot: 0.42,

  jetCadence: 15,
  jetRiseSeconds: 0.72,
  jetHoverSeconds: 1.65,
  jetPlungeSeconds: 0.34,
  jetRecoverSeconds: 0.52,
  jetAltitude: 8.2,
  slamRadius: 8,
  slamDamage: 48,

  summonCadence: 24,
  summonWindup: 1.35,
  summonCap: 8,
  summonCount: 4,
});

const SPEC = Object.freeze({
  health: APOSTATE_CONFIG.health,
  scale: 1,
  speed: Object.freeze({ walk: APOSTATE_CONFIG.walkSpeed, charge: APOSTATE_CONFIG.boostSpeed }),
  selfDriven: true,
  flies: true,
  legs: 0,
  stance: 0,
  stepHeight: 0,
  collisionRadius: 0.72,
  cullRange: 620,
  animRange: 620,
  poseRange: 620,
  shadowRange: 125,
  durableDomain: "apostate",
});

const ACTION_DURATIONS = Object.freeze({
  ranged: 1.18,
  shield: APOSTATE_CONFIG.shieldSeconds,
  boost: APOSTATE_CONFIG.boostSeconds,
  summon: APOSTATE_CONFIG.summonWindup + 0.92,
  vent: APOSTATE_CONFIG.ventSeconds,
  jet: APOSTATE_CONFIG.jetRiseSeconds + APOSTATE_CONFIG.jetHoverSeconds
    + APOSTATE_CONFIG.jetPlungeSeconds + APOSTATE_CONFIG.jetRecoverSeconds,
});

/** Orient a tapered segment between two local-space points. */
function segment(THREE, a, b, r0, r1, material, sides = 7) {
  const av = new THREE.Vector3(...a);
  const bv = new THREE.Vector3(...b);
  const d = bv.clone().sub(av);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r1, r0, d.length(), sides, 1, false), material
  );
  mesh.position.copy(av).add(bv).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A thin, tapered wasp wing with a readable chitin vein structure. */
function makeWaspWing(THREE, side, length, width, lift, membrane, vein, index) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(
    side * length * 0.22, lift + width * 0.55,
    side * length * 0.72, lift + width * 0.42,
    side * length, lift
  );
  shape.bezierCurveTo(
    side * length * 0.88, lift - width * 0.62,
    side * length * 0.36, lift - width * 0.76,
    0, 0
  );
  const group = new THREE.Group();
  group.name = `apostate-wasp-wing-${side < 0 ? "left" : "right"}-${index}`;
  group.userData.apostateFeature = "wasp-wing";

  const sail = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), membrane);
  sail.name = `${group.name}-membrane`;
  sail.position.z = -0.012 * index;
  sail.castShadow = false;
  sail.receiveShadow = false;
  group.add(sail);

  const veinTargets = [
    [side * length * 0.92, lift + width * 0.02, 0.008],
    [side * length * 0.66, lift + width * 0.30, 0.009],
    [side * length * 0.62, lift - width * 0.40, 0.009],
  ];
  for (const target of veinTargets) {
    const rib = segment(THREE, [0, 0, 0.010], target, 0.008, 0.003, vein, 5);
    rib.castShadow = false;
    rib.receiveShadow = false;
    group.add(rib);
  }
  return group;
}

/** Repaint a cloned, vertex-painted prop without flattening its authored
 *  value variation. cloneVisual shares geometry with the player, so the
 *  geometry copy is mandatory: the Apostate's corruption must never recolour
 *  Vesper's own Censer-Lance. */
function repaintVertexRamp(THREE, node, darkHex, lightHex, family) {
  const source = node.geometry?.getAttribute?.("color");
  if (!source || source.count === 0) return false;

  node.geometry = node.geometry.clone();
  const colour = node.geometry.getAttribute("color");
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < colour.count; i += 1) {
    const value = colour.getX(i) * 0.2126
      + colour.getY(i) * 0.7152 + colour.getZ(i) * 0.0722;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }

  const dark = new THREE.Color(darkHex);
  const light = new THREE.Color(lightHex);
  const sample = new THREE.Color();
  const span = Math.max(1e-5, hi - lo);
  for (let i = 0; i < colour.count; i += 1) {
    const value = colour.getX(i) * 0.2126
      + colour.getY(i) * 0.7152 + colour.getZ(i) * 0.0722;
    const raw = (value - lo) / span;
    const t = raw * raw * (3 - 2 * raw);
    sample.copy(dark).lerp(light, t);
    colour.setXYZ(i, sample.r, sample.g, sample.b);
  }
  colour.needsUpdate = true;
  node.userData.apostatePalette = family;
  return true;
}

function makeCorruption(ctx, figure) {
  const { THREE, atmos } = ctx;
  const chitin = new THREE.MeshStandardMaterial({
    name: "sf-apostate-chitin",
    color: PALETTE.chitin,
    emissive: 0x24142f,
    emissiveIntensity: 0.14,
    roughness: 0.40,
    metalness: 0.16,
    flatShading: true,
  });
  const flesh = new THREE.MeshStandardMaterial({
    name: "sf-apostate-flesh",
    color: PALETTE.fleshy,
    emissive: 0x2a1223,
    emissiveIntensity: 0.12,
    roughness: 0.64,
    metalness: 0.02,
    flatShading: true,
  });
  const bio = new THREE.MeshStandardMaterial({
    name: "sf-apostate-bio",
    color: 0x322043,
    emissive: PALETTE.bioCyan,
    emissiveIntensity: 2.8,
    roughness: 0.28,
    metalness: 0.02,
    flatShading: true,
  });
  const wingMembrane = new THREE.MeshStandardMaterial({
    name: "sf-apostate-wasp-membrane",
    color: PALETTE.chitinLit,
    emissive: 0x24142f,
    emissiveIntensity: 0.26,
    transparent: true,
    opacity: 0.43,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.24,
    metalness: 0.0,
  });
  patchMaterial(chitin, atmos, { rim: 1.55, glitter: 0, bio: 0.25 });
  patchMaterial(flesh, atmos, { rim: 0.82, glitter: 0, bio: 0.18 });
  patchMaterial(bio, atmos, { rim: 1.1, glitter: 0, bio: 1.9 });
  patchMaterial(wingMembrane, atmos, { rim: 2.1, glitter: 0, bio: 0.28 });

  /* Repaint independent copies of the player materials. Ivory becomes deep
     violet chitin, gold becomes bruised shell, and every holy amber source is
     inverted to the Bloom's cyan/violet bioluminescence. */
  const cloned = new Map();
  figure.root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const recolour = (source) => {
      if (!source) return source;
      if (cloned.has(source.uuid)) return cloned.get(source.uuid);
      const material = source.clone();
      const sf = source.userData || {};
      if (sf.sfPatched) {
        material.userData = { ...material.userData };
        delete material.userData.sfPatched;
        delete material.userData.sfShader;
        delete material.onBeforeCompile;
        delete material.customProgramCacheKey;
        if (sf.sfBasic || source.isMeshBasicMaterial) {
          patchBasicMaterial(material, atmos,
            Number.isFinite(sf.sfFade) ? sf.sfFade : 0.7,
            sf.sfAdditive ?? source.blending === THREE.AdditiveBlending);
        } else {
          patchMaterial(material, atmos, {
            rim: sf.sfRim, glitter: sf.sfGlitter,
            bio: sf.sfBio, dunes: sf.sfDunes,
          });
        }
      }
      const name = String(material.name || "").toLowerCase();
      const target = name.includes("amber") || name.includes("eye")
        ? new THREE.Color(PALETTE.bioCyan)
        : name.includes("gold")
          ? new THREE.Color(PALETTE.chitinLit)
          : name.includes("dark")
            ? new THREE.Color(PALETTE.chitinDeep)
            : new THREE.Color(PALETTE.chitin);
      material.color?.lerp?.(target, name.includes("atlas") ? 0.78 : 0.68);
      if (material.emissive) {
        material.emissive.set(name.includes("amber") || name.includes("eye")
          ? PALETTE.bioCyan : 0x24142f);
        material.emissiveIntensity = name.includes("amber") || name.includes("eye") ? 3.2 : 0.12;
      }
      material.roughness = clamp(Number(material.roughness) || 0.48, 0.32, 0.68);
      material.metalness = clamp(Number(material.metalness) || 0.16, 0.02, 0.30);
      material.needsUpdate = true;
      cloned.set(source.uuid, material);
      return material;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(recolour) : recolour(node.material);
  });
  if (figure.heartLight) {
    figure.heartLight.color.set(PALETTE.bioViolet);
    figure.heartLight.intensity = 0.32;
    figure.heartLight.distance = 2.4;
  }

  const root = new THREE.Group();
  root.name = "apostate-insect-features";
  root.userData.apostateFeature = "corruption-root";
  figure.root.add(root);

  /* Four translucent, veined wasp wings. Their narrow membranes keep the
     Reliquary silhouette dominant at rest, then flare during Call and jet
     actions instead of reading as two bulky beetle-shell balloons. */
  const wingPivots = [];
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? "apostate-wing-root-left" : "apostate-wing-root-right";
    pivot.userData.apostateFeature = "wing-root";
    pivot.position.set(side * 0.13, 1.42, -0.22);
    const fore = makeWaspWing(THREE, side, 0.82, 0.24, 0.10,
      wingMembrane, chitin, 0);
    const hind = makeWaspWing(THREE, side, 0.58, 0.19, -0.12,
      wingMembrane, chitin, 1);
    hind.position.z = -0.025;
    pivot.add(fore, hind);
    root.add(pivot);
    wingPivots.push({ node: pivot, side });
    wings.push(fore, hind);
  }

  /* Close-fitting back plates imply a segmented thorax without hanging a
     bulbous insect abdomen off the otherwise disciplined armour silhouette. */
  const abdomen = new THREE.Group();
  abdomen.name = "apostate-carapace-plates";
  abdomen.userData.apostateFeature = "carapace-plates";
  for (let i = 0; i < 3; i += 1) {
    const plate = new THREE.Mesh(new THREE.SphereGeometry(0.14 - i * 0.012, 8, 6),
      i === 2 ? flesh : chitin);
    plate.scale.set(0.90, 0.42, 0.74);
    plate.position.set(0, 1.11 - i * 0.10, -0.20 - i * 0.035);
    plate.rotation.x = -0.10 - i * 0.04;
    plate.castShadow = true;
    abdomen.add(plate);
  }
  const abdomenGlow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), bio);
  abdomenGlow.position.set(0, 0.90, -0.28);
  abdomen.add(abdomenGlow);
  root.add(abdomen);

  /* Low-profile carapace spikes replace the face growths and vestigial arms.
     They sharpen the shoulder/collar armour while leaving the player's mask
     completely clean and recognisable. */
  const armorSpikes = new THREE.Group();
  armorSpikes.name = "apostate-armor-spikes";
  armorSpikes.userData.apostateFeature = "armor-spikes";
  const spikeSpecs = [
    [[-0.16, 1.46, -0.020], [-0.48, 1.57, -0.08], 0.045],
    [[0.16, 1.46, -0.020], [0.48, 1.57, -0.08], 0.045],
    [[-0.07, 1.53, -0.045], [-0.23, 1.78, -0.15], 0.038],
    [[0.07, 1.53, -0.045], [0.23, 1.78, -0.15], 0.038],
    [[-0.14, 1.20, -0.030], [-0.39, 1.15, -0.13], 0.032],
    [[0.14, 1.20, -0.030], [0.39, 1.15, -0.13], 0.032],
  ];
  const spikeRoots = [];
  const spikes = spikeSpecs.map(([base, tip, radius], index) => {
    /* The short cone overlaps the shell, while this faceted socket makes that
       overlap readable when an arm or wing hides the exact join. It is small
       enough to remain armour language, not another insect growth. */
    const socket = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.45, 6, 4), chitin);
    socket.name = `apostate-armor-spike-root-${index + 1}`;
    socket.userData.apostateFeature = "armor-spike-root";
    socket.position.set(...base);
    socket.scale.set(1.35, 0.72, 1.12);
    socket.castShadow = true;
    socket.receiveShadow = true;
    armorSpikes.add(socket);
    spikeRoots.push(socket);

    const spike = segment(THREE, base, tip, radius, 0.004, chitin, 6);
    spike.name = `apostate-armor-spike-${index + 1}`;
    spike.userData.apostateFeature = "armor-spike";
    armorSpikes.add(spike);
    return spike;
  });
  root.add(armorSpikes);

  const jetGlow = new THREE.Group();
  jetGlow.name = "apostate-jet-plumes";
  jetGlow.userData.apostateFeature = "jet-plumes";
  for (const side of [-1, 1]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.72, 7, 1, true), bio);
    flame.position.set(side * 0.13, 0.91, -0.25);
    flame.rotation.x = Math.PI;
    flame.scale.set(0.7, 1, 0.7);
    jetGlow.add(flame);
  }
  jetGlow.visible = false;
  root.add(jetGlow);

  /* Preserve the authored root-space placement while handing motion to the
     living rig. Wings, plates, spikes and jet organs follow Spine lean; the
     head intentionally receives no insect geometry. */
  figure.root.updateMatrixWorld(true);
  for (const node of [...wingPivots.map((wing) => wing.node), abdomen, armorSpikes, jetGlow]) {
    figure.chest.attach(node);
  }

  return {
    root, chitin, flesh, bio, wingMembrane, wingPivots, wings,
    abdomen, armorSpikes, spikeRoots, spikes, jetGlow,
  };
}

function makeAegis(ctx, figure) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  group.name = "apostate-aegis";
  group.userData.apostateFeature = "aegis";
  group.position.set(0, 1.05, 0.86);
  const faceMat = new THREE.MeshBasicMaterial({
    color: PALETTE.bioCyan,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const rimMat = faceMat.clone();
  rimMat.color.set(PALETTE.bioViolet);
  rimMat.opacity = 0.64;
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.18, 32), faceMat);
  face.scale.set(0.76, 1.16, 1);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.035, 6, 32), rimMat);
  rim.scale.copy(face.scale);
  group.add(face, rim);
  group.visible = false;
  figure.root.add(group);
  return { group, face, rim, faceMat, rimMat };
}

export async function buildApostate(ctx) {
  const { THREE, enemies, collide } = ctx;
  const C = APOSTATE_CONFIG;
  const bus = makeBus();
  initIk(THREE);
  const groundAt = (x, z) => collide?.groundHeight?.(x, z)
    ?? ctx.terrain.groundHeightAt?.(x, z) ?? ctx.terrain.heightAt(x, z);

  const figure = await buildReliquaryFigure(ctx);
  /* The procedural safety figure predates a separate head joint. Give the
     encounter a harmless aim pivot so an asset outage degrades visually
     instead of aborting the entire game during startup. */
  if (!figure.head) {
    figure.head = new THREE.Object3D();
    figure.head.name = "apostate-fallback-head-pivot";
    figure.head.position.set(0, 1.72, 0);
    figure.root.add(figure.head);
  }
  if (!figure.armAxis) figure.armAxis = new THREE.Vector3(0, -1, 0);
  figure.root.name = "the-apostate";
  figure.root.scale.multiplyScalar(C.bodyScale);
  const corruption = makeCorruption(ctx, figure);
  const aegis = makeAegis(ctx, figure);
  const weapon = ctx.weapons?.cloneVisual?.("autogun");
  if (!weapon?.root) throw new Error("The Apostate could not mirror the Censer-Lance visual.");
  weapon.root.name = "apostate-censer-lance";
  figure.weaponMount.add(weapon.root);
  weapon.root.traverse((node) => {
    if (node.isLight) {
      node.color.set(PALETTE.bioCyan);
      node.intensity *= 1.35;
    }
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      const name = String(material.name || "").toLowerCase();
      const isFlash = node.parent?.name === "muzzle-flare";
      /* The weapon's surface detail is vertex-painted into its iron, brass
         and haft geometry. A strong cyan emissive on every Standard material
         flattened those ramps into the untextured neon shape seen in play.
         Rebuild those painted values in the hostile cast's violet-chitin
         ramp instead of multiplying the original gold/verdigris ramps by a
         pale tint (which left the shaft green). Cyan is reserved for living
         chambers and the momentary muzzle flare. */
      if (!isFlash && node.isMesh) {
        if (name === "sf-emissive") {
          repaintVertexRamp(THREE, node, 0x1f7d6c, 0xa9ffe8, "bio-cyan");
        } else if (name === "sf-gold" || name === "sf-bronze") {
          repaintVertexRamp(THREE, node, PALETTE.chitinDeep, 0xb18ec6,
            "chitin-ornament");
        } else if (name === "sf-cloth") {
          repaintVertexRamp(THREE, node, 0x4b243d, PALETTE.fleshy,
            "fleshy-cloth");
        } else {
          repaintVertexRamp(THREE, node, 0x1d1326, PALETTE.chitinLit,
            "chitin-structure");
        }
      }
      if (material.color) {
        if (isFlash) material.color.set(PALETTE.bioCyan);
        else if (node.userData.apostatePalette) material.color.set(0xffffff);
        else if (name === "sf-emissive") material.color.set(PALETTE.bioCyan);
        else material.color.set(PALETTE.chitin);
      }
      if (material.emissive) {
        material.emissive.set(0x1c1026);
        material.emissiveIntensity = 0.10;
      }
      material.needsUpdate = true;
    }
  });
  const weaponFlashMaterials = [];
  const weaponLights = [];
  const weaponLightNodes = new Set();
  const lightRigs = [];
  weapon.flash?.traverse?.((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material && !weaponFlashMaterials.includes(material)) weaponFlashMaterials.push(material);
    }
  });
  weapon.root.traverse((node) => {
    if (node.isLight) weaponLightNodes.add(node);
  });

  /* Keep the boss lights scene-parented from boot. Three compiles a lighting
     program for the number of visible lights; revealing child lights from a
     hidden enemy root would otherwise recompile the whole Cathedral on the
     reveal frame. Locator sockets retain the animated rig positions while the
     zero-intensity scene lights keep that program shape permanently warm. */
  const authoredLights = [];
  figure.root.traverse((node) => { if (node.isLight) authoredLights.push(node); });
  for (const source of authoredLights) {
    const parent = source.parent;
    if (!parent) continue;
    const socket = new THREE.Object3D();
    socket.name = `${source.name || "apostate-light"}-socket`;
    socket.position.copy(source.position);
    socket.quaternion.copy(source.quaternion);
    socket.scale.copy(source.scale);
    parent.add(socket);
    parent.remove(source);

    const light = source.clone(false);
    light.name = `${source.name || "apostate-light"}-prewarmed`;
    light.intensity = 0;
    light.userData.apostateRestIntensity = source.intensity;
    light.userData.apostateRequestedIntensity = source.intensity;
    ctx.scene.add(light);
    lightRigs.push({ socket, light });
    if (weaponLightNodes.has(source)) weaponLights.push(light);
    if (figure.heartLight === source) figure.heartLight = light;
  }

  /* cloneVisual deliberately returns presentation-only parts, so its flare
     starts transparent just like the player's. Drive both opacity and the
     reliquary light here; merely toggling the group leaves an invisible
     flash and makes a six-round burst look disconnected from the lance. */
  function setMuzzleFlash(amount = 0) {
    const f = clamp01(amount);
    if (weapon.flash) {
      weapon.flash.visible = f > 0.015;
      weapon.flash.scale.setScalar(0.68 + (1 - f) * 0.48);
    }
    for (const material of weaponFlashMaterials) {
      material.opacity = Math.min(1, f * 1.18);
      material.needsUpdate = true;
    }
    for (const light of weaponLights) {
      const rest = Number(light.userData.apostateRestIntensity) || 0;
      light.userData.apostateRequestedIntensity = rest + f * 3.4;
    }
  }
  setMuzzleFlash(0);

  const bones = new Map();
  let skin = null;
  figure.root.traverse((node) => {
    if (node.isBone) bones.set(node.name, node);
    if (node.isSkinnedMesh && !skin) skin = node;
  });
  const mixer = { update() {} };
  const open = collide?.findOpen?.(
    C.arenaX, C.arenaZ, groundAt(C.arenaX, C.arenaZ), 18, 12, SPEC.collisionRadius
  );
  const spawnX = open?.[0] ?? C.arenaX;
  const spawnZ = open?.[1] ?? C.arenaZ;
  const inst = {
    id: "sf-enemy-apostate",
    key: "apostate",
    root: figure.root,
    mixer,
    actions: new Map(),
    bones,
    legs: [],
    spine: [],
    skin,
    spec: SPEC,
    x: spawnX,
    z: spawnZ,
    y: groundAt(spawnX, spawnZ),
    yaw: Math.PI,
    pitch: 0,
    roll: 0,
    speed: 0,
    state: "idle",
    health: C.health,
    maxHealth: C.health,
    damageScale: 1,
    stride: 0,
    current: null,
    knockbackX: 0,
    knockbackZ: 0,
    knockbackTime: 0,
    stunTime: 0,
    grounded: true,
    bodyDrop: 0,
    encounterHidden: true,
    encounterLocked: true,
    broodKids: [],
    externalFigure: figure,
  };

  const state = {
    phase: "dormant",       // dormant -> reveal -> duel -> dead
    timer: 0,
    elapsed: 0,
    action: null,
    actionFor: 0,
    actionElapsed: 0,
    actionHit: false,
    actionYaw: Math.PI,
    shotIndex: 0,
    meleeStep: 0,
    muzzleFor: 0,
    altitude: 0,
    jetImpacted: false,
    deathStartAltitude: 0,
    victoryReported: false,
    heat: 0,
    sinceShot: 99,
    overheated: false,
    shieldActive: false,
    shieldBlocks: 0,
    summonTimer: C.summonCadence * 0.45,
    shotTimer: C.shotCadence * 0.42,
    meleeTimer: C.meleeCadence * 0.72,
    boostTimer: C.boostCadence * 0.65,
    shieldTimer: C.shieldCadence * 0.62,
    jetTimer: C.jetCadence * 0.72,
    actionSerial: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    disengageFor: 0,
    blockedRelayHinted: false,
  };

  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const grip = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const emitter = new THREE.Vector3();
  const target = new THREE.Vector3();
  const weaponButt = new THREE.Vector3();
  const weaponTip = new THREE.Vector3();
  const weaponAxis = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();
  const bind = {
    chest: figure.chest.quaternion.clone(),
    head: figure.head.quaternion.clone(),
    legs: figure.legPivots.map((joint) => joint.quaternion.clone()),
    knees: figure.kneePivots.map((joint) => joint.quaternion.clone()),
    arms: figure.armPivots.map((joint) => joint.quaternion.clone()),
    elbows: figure.elbowPivots.map((joint) => joint.quaternion.clone()),
  };
  const q = new THREE.Quaternion();
  const aimDeltaQ = new THREE.Quaternion();
  const weaponWorldQ = new THREE.Quaternion();
  const parentWorldQ = new THREE.Quaternion();
  const euler = new THREE.Euler();

  function registered() {
    return enemies.live.includes(inst) && inst.root.parent === enemies.group;
  }

  function updatePrewarmedLights() {
    const visible = registered() && figure.root.visible;
    for (const { socket, light } of lightRigs) {
      socket.getWorldPosition(light.position);
      light.intensity = visible
        ? Number(light.userData.apostateRequestedIntensity) || 0 : 0;
    }
  }

  function ensureSpawned() {
    if (!enemies.live.includes(inst)) enemies.live.push(inst);
    if (inst.root.parent !== enemies.group) enemies.group.add(inst.root);
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.set(0, inst.yaw, 0);
    setEncounterGate(state.phase === "dormant", state.phase === "dormant" || state.phase === "reveal");
    return inst;
  }

  function setEncounterGate(hidden, locked = hidden) {
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    inst.root.visible = !inst.encounterHidden;
    if (inst.encounterHidden) {
      for (const { light } of lightRigs) light.intensity = 0;
    }
  }

  function beginReveal() {
    if (state.phase !== "dormant") return false;
    const life = ctx.combat?.player;
    /* Dying while crossing the nave must not consume the one authored reveal
       during the respawn camera. Wait for a living player to return and
       actually witness the encounter. */
    if (life?.dead || (Number.isFinite(life?.hp) && life.hp <= 0)) return false;
    state.phase = "reveal";
    state.timer = C.revealSeconds;
    state.revealed = true;
    setEncounterGate(false, true);
    bus.emit("aggro", { x: inst.x, y: inst.y, z: inst.z, title: "THE APOSTATE" });
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const camX = inst.x + 9.4;
      const camZ = inst.z + 9.8;
      ctx.player.setFree(true,
        [camX, groundAt(camX, camZ) + 3.5, camZ],
        [inst.x, inst.y + 1.25, inst.z], 44);
      state.releaseCameraAt = 0;
    }
    return true;
  }

  function beginDuel() {
    state.phase = "duel";
    /* The reveal countdown can cross zero by one simulation step. Saves
       validate every durable timer as non-negative, so normalize the phase
       handoff instead of serializing that harmless negative remainder. */
    state.timer = 0;
    state.action = null;
    state.actionFor = 0;
    state.actionElapsed = 0;
    setEncounterGate(false, false);
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
    bus.emit("engaged", { x: inst.x, z: inst.z });
  }

  function clearAction({ preserveAltitude = false } = {}) {
    state.action = null;
    state.actionFor = 0;
    state.actionElapsed = 0;
    state.actionHit = false;
    state.actionYaw = inst.yaw;
    state.shotIndex = 0;
    state.jetImpacted = false;
    state.shieldActive = false;
    aegis.group.visible = false;
    corruption.jetGlow.visible = false;
    /* A plunge can land on authored Cathedral rubble above terrain. That is
       still a grounded support, and clearing the action must not teleport the
       capsule through it. Once the boss walks clear, the ordinary settling
       sweep below can bring it back to terrain safely. */
    const supportedAboveGround = inst.grounded && state.altitude > 0.05;
    if (!preserveAltitude && !supportedAboveGround) {
      inst.grounded = true;
      state.altitude = 0;
    }
  }

  function beginAction(name, duration = ACTION_DURATIONS[name] || 1) {
    if (state.phase !== "duel" || inst.state === "death") return false;
    state.action = name;
    state.actionFor = duration;
    state.actionElapsed = 0;
    state.actionHit = false;
    /* Telegraphs commit to the heading that was shown. The idle controller
       may continue tracking afterward, but a boost or glaive swing cannot
       curve toward a dodging player after its windup. */
    state.actionYaw = inst.yaw;
    state.shotIndex = 0;
    state.jetImpacted = false;
    state.actionSerial += 1;
    if (name !== "boost" && name !== "jet") inst.speed = 0;
    if (name === "shield") {
      state.shieldActive = true;
      aegis.group.visible = true;
      bus.emit("shield", { x: inst.x, z: inst.z, active: true });
    } else if (name === "boost") {
      bus.emit("boost", { x: inst.x, z: inst.z });
    } else if (name === "jet") {
      inst.grounded = false;
      corruption.jetGlow.visible = true;
      bus.emit("jet", { x: inst.x, z: inst.z });
    } else if (name === "summon") {
      bus.emit("call", { x: inst.x, z: inst.z });
    } else if (name === "vent") {
      bus.emit("vent", { x: inst.x, z: inst.z });
    } else if (name.startsWith("melee")) {
      bus.emit("meleeTelegraph", { x: inst.x, z: inst.z, step: state.meleeStep + 1 });
    } else if (name === "ranged") {
      bus.emit("rangedTelegraph", { x: inst.x, z: inst.z });
    }
    return true;
  }

  function livingSummons() {
    inst.broodKids = (inst.broodKids || []).filter(
      (kid) => kid && kid.state !== "death" && kid.health > 0);
    return inst.broodKids;
  }

  function summonRoster() {
    const ratio = inst.health / Math.max(1, inst.maxHealth);
    if (ratio > 0.66) return ["thresher", "thresher", "thresher", "gleaner"];
    if (ratio > 0.33) return ["thresher", "thresher", "gleaner", "harrow"];
    return ["thresher", "gleaner", "gleaner", "harrow"];
  }

  function summonBrood() {
    const children = livingSummons();
    const room = C.summonCap - children.length;
    if (room <= 0) return 0;
    const roster = summonRoster().slice(0, Math.min(room, C.summonCount));
    let spawned = 0;
    for (let i = 0; i < roster.length; i += 1) {
      const angle = (i / Math.max(1, roster.length)) * TAU + inst.yaw + Math.PI * 0.5;
      const reach = 5.0 + (i % 2) * 2.2;
      const wantX = inst.x + Math.cos(angle) * reach;
      const wantZ = inst.z + Math.sin(angle) * reach;
      const radius = roster[i] === "harrow" ? 1.05 : roster[i] === "gleaner" ? 0.8 : 0.62;
      const acceptsSummon = (px, pz) => {
        if (Math.hypot(px - C.arenaX, pz - C.arenaZ) > C.arenaRadius - 2) return false;
        if (collide?.walkClear
          && !collide.walkClear(inst.x, inst.z, px, pz, radius)) return false;
        if (!collide?.walkClear) return true;
        for (let bearing = 0; bearing < 16; bearing += 1) {
          const turn = (bearing / 16) * TAU;
          if (collide.walkClear(px, pz,
            px + Math.cos(turn) * 4, pz + Math.sin(turn) * 4, radius)) return true;
        }
        return false;
      };
      const open = collide?.findOpen?.(
        wantX, wantZ, groundAt(wantX, wantZ), 16, 8, radius, null, acceptsSummon
      );
      if (!open) continue;
      const kid = enemies.spawn(roster[i], open[0], open[1], {
        yaw: Math.atan2(ctx.player.state.x - open[0], ctx.player.state.z - open[1]),
        damageScale: 0.82,
        eventId: inst.id,
        emerge: { delay: i * 0.13, duration: 1.05, depth: 1.35 },
      });
      if (!kid) continue;
      kid.alerted = true;
      kid.suspicion = 1;
      kid.home = { x: C.arenaX, z: C.arenaZ };
      children.push(kid);
      spawned += 1;
    }
    bus.emit("summoned", {
      x: inst.x, z: inst.z, count: spawned,
      living: children.length, keys: roster.slice(0, spawned),
    });
    return spawned;
  }

  function facePlayer(rate, dt) {
    const ps = ctx.player.state;
    inst.yaw = dampAngle(inst.yaw, Math.atan2(ps.x - inst.x, ps.z - inst.z), rate, dt);
  }

  function move(dx, dz, speed, dt) {
    const length = Math.hypot(dx, dz);
    if (length < 1e-5) { inst.speed = 0; return 0; }
    let tx = inst.x + (dx / length) * speed * dt;
    let tz = inst.z + (dz / length) * speed * dt;
    const homeDx = tx - C.arenaX;
    const homeDz = tz - C.arenaZ;
    const homeDist = Math.hypot(homeDx, homeDz);
    if (homeDist > C.arenaRadius) {
      tx = C.arenaX + (homeDx / homeDist) * C.arenaRadius;
      tz = C.arenaZ + (homeDz / homeDist) * C.arenaRadius;
    }
    let outX = tx;
    let outZ = tz;
    if (state.altitude > 0.2 && collide?.sweepFlightCapsule) {
      const feetY = groundAt(inst.x, inst.z) + state.altitude;
      const swept = collide.sweepFlightCapsule(
        inst.x, feetY, inst.z, tx, feetY, tz,
        SPEC.collisionRadius, 2.12, 0.18, false
      );
      outX = swept.x;
      outZ = swept.z;
      /* Altitude is relative to the local walking support while the sweep is
         world-space. Rebase after a horizontal flight move so crossing a
         slope does not teleport the airborne capsule up or down with it. */
      state.altitude = Math.max(0, swept.y - groundAt(outX, outZ));
    } else if (collide?.slide) {
      /* Boost can cross nearly two metres in one accepted frame. Substep the
         grounded capsule so a nave rib cannot be skipped between endpoints. */
      const steps = Math.max(1, Math.ceil(Math.hypot(tx - inst.x, tz - inst.z) / 0.28));
      let px = inst.x;
      let pz = inst.z;
      for (let step = 1; step <= steps; step += 1) {
        const wantStepX = inst.x + (tx - inst.x) * (step / steps);
        const wantStepZ = inst.z + (tz - inst.z) * (step / steps);
        const resolved = collide.slide(px, pz, wantStepX, wantStepZ,
          null, SPEC.collisionRadius);
        px = resolved[0];
        pz = resolved[1];
      }
      outX = px;
      outZ = pz;
    }
    const travelled = Math.hypot(outX - inst.x, outZ - inst.z);
    inst.x = outX;
    inst.z = outZ;
    inst.speed = travelled / Math.max(1e-4, dt);
    inst.stride += travelled;
    return travelled;
  }

  function setJetAltitude(wantedAltitude, allowTakeoffExit = false) {
    const ground = groundAt(inst.x, inst.z);
    const wanted = Math.max(0, wantedAltitude);
    if (!collide?.sweepFlightCapsule) {
      state.altitude = wanted;
      return { y: ground + wanted, hitY: false };
    }
    const currentFeetY = ground + state.altitude;
    const wantedFeetY = ground + wanted;
    const swept = collide.sweepFlightCapsule(
      inst.x, currentFeetY, inst.z,
      inst.x, wantedFeetY, inst.z,
      SPEC.collisionRadius, 2.12, 0.14, allowTakeoffExit
    );
    state.altitude = Math.max(0, swept.y - ground);
    return swept;
  }

  function aimLance(outOrigin = emitter, outTarget = target) {
    figure.root.updateMatrixWorld(true);
    if (weapon.emitter) weapon.emitter.getWorldPosition(outOrigin);
    else outOrigin.set(inst.x, inst.y + 1.32, inst.z);
    const ps = ctx.player.state;
    outTarget.set(ps.x, ps.y + 1.25, ps.z);
    return { origin: outOrigin, target: outTarget };
  }

  function lineToPlayer(mode = "body") {
    const ps = ctx.player.state;
    let ox = inst.x;
    let oy = inst.y + 1.15;
    let oz = inst.z;
    let tx = ps.x;
    let ty = ps.y + 1.0;
    let tz = ps.z;
    if (mode === "weapon") {
      aimLance(emitter, target);
      ox = emitter.x; oy = emitter.y; oz = emitter.z;
      tx = target.x; ty = target.y; tz = target.z;
    } else if (mode === "ground") {
      oy = groundAt(inst.x, inst.z) + 0.32;
      ty = groundAt(ps.x, ps.z) + 0.32;
    }
    return clearLine(ox, oy, oz, tx, ty, tz);
  }

  function clearLine(ox, oy, oz, tx, ty, tz) {
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const distance = Math.hypot(dx, dy, dz) || 1;
    return !collide?.rayBlock
      || collide.rayBlock(ox, oy, oz, dx / distance, dy / distance, dz / distance,
        distance, false) >= distance - 0.08;
  }

  function playerInArc(reach, arc) {
    const ps = ctx.player.state;
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach || Math.abs((ps.y || 0) - inst.y) > 3.2) return false;
    const inv = 1 / Math.max(1e-5, distance);
    const dot = (Math.sin(inst.yaw) * dx + Math.cos(inst.yaw) * dz) * inv;
    return dot >= Math.cos(arc * 0.5) && lineToPlayer();
  }

  function hurtPlayer(amount, source, origin = null) {
    const ox = Number.isFinite(origin?.x) ? origin.x : inst.x;
    const oy = Number.isFinite(origin?.y) ? origin.y : inst.y + 1.1;
    const oz = Number.isFinite(origin?.z) ? origin.z : inst.z;
    return ctx.combat?.hurtPlayer?.(amount, {
      source,
      x: ox,
      y: oy,
      z: oz,
      enemy: inst.key,
      enemyId: inst.id,
      enemyKey: inst.key,
    }) || 0;
  }

  function fireLance() {
    aimLance(emitter, target);
    const projectile = ctx.combat?.launchEnemyProjectile?.(inst, {}, {
      origin: emitter,
      target,
      damage: C.shotDamage,
      speed: C.shotSpeed,
      maxRange: 86,
      directAimChance: 0.62,
      horizontalSpread: C.shotSpread,
      verticalSpread: C.shotSpread * 0.58,
      tracerWidth: 0.075,
      tracerStyle: "bloom",
      muzzleScale: 1.05,
      /* The cloned lance owns a socket-perfect cyan flare; suppress the
         generic world-space orange muzzle card used by ordinary insects. */
      muzzle: false,
      source: "enemy-fire",
      idPrefix: "apostate-lance",
    });
    state.heat = clamp01(state.heat + C.heatPerShot);
    state.sinceShot = 0;
    state.overheated ||= state.heat >= 0.999;
    state.muzzleFor = 0.065;
    setMuzzleFlash(1);
    bus.emit("shot", {
      x: emitter.x, y: emitter.y, z: emitter.z,
      heat: state.heat, projectileId: projectile?.id || null,
    });
  }

  function updateHeat(dt) {
    state.sinceShot += dt;
    if (state.action === "vent") {
      state.heat = Math.max(0, state.heat - dt / C.ventSeconds);
    } else if (state.sinceShot > C.heatCoolDelay && state.action !== "ranged") {
      state.heat = Math.max(0, state.heat - C.heatCoolRate * dt);
    }
    if (state.overheated && state.heat <= C.overheatReset) state.overheated = false;
    state.muzzleFor = Math.max(0, state.muzzleFor - dt);
    setMuzzleFlash(state.muzzleFor / 0.065);
  }

  function finishAction(name) {
    if (name === "shield") bus.emit("shield", { x: inst.x, z: inst.z, active: false });
    if (name === "vent") {
      state.heat = Math.min(state.heat, C.overheatReset * 0.82);
      state.overheated = false;
      bus.emit("vented", { x: inst.x, z: inst.z, heat: state.heat });
    }
    clearAction();
  }

  function updateMelee(dt) {
    const spec = C.melee[state.meleeStep];
    if (!spec) { finishAction(state.action); return; }
    inst.yaw = state.actionYaw;
    const ps = ctx.player.state;
    if (state.actionElapsed < spec.hit + 0.08) {
      move(ps.x - inst.x, ps.z - inst.z, 2.6, dt);
    }
    if (!state.actionHit && state.actionElapsed >= spec.hit) {
      state.actionHit = true;
      const hit = playerInArc(spec.reach, spec.arc);
      const damage = hit ? hurtPlayer(spec.damage, "apostate-melee") : 0;
      ctx.vfx?.meleeArc?.(inst.x, inst.y, inst.z,
        inst.yaw, spec.reach, spec.arc, damage > 0 ? 1 : 0, state.meleeStep === 2);
      bus.emit("melee", {
        x: inst.x, z: inst.z, step: state.meleeStep + 1,
        hit: damage > 0, damage,
      });
    }
    if (state.actionElapsed >= spec.duration) {
      const completed = state.meleeStep;
      finishAction(state.action);
      if (completed < C.melee.length - 1) {
        state.meleeStep = completed + 1;
        beginAction(`melee${state.meleeStep + 1}`, C.melee[state.meleeStep].duration);
      } else {
        state.meleeStep = 0;
        state.meleeTimer = C.meleeCadence;
      }
    }
  }

  function updateRanged() {
    const first = 0.24;
    while (state.shotIndex < C.shotCount
      && state.actionElapsed >= first + state.shotIndex * C.shotGap) {
      if (state.overheated) break;
      fireLance();
      state.shotIndex += 1;
    }
    if (state.actionElapsed >= ACTION_DURATIONS.ranged || state.overheated) {
      state.shotTimer = C.shotCadence;
      finishAction("ranged");
    }
  }

  function updateBoost(dt) {
    const ps = ctx.player.state;
    inst.yaw = state.actionYaw;
    const startX = inst.x;
    const startZ = inst.z;
    const moved = move(Math.sin(inst.yaw), Math.cos(inst.yaw), C.boostSpeed, dt);
    const segmentX = inst.x - startX;
    const segmentZ = inst.z - startZ;
    const segmentLengthSq = segmentX * segmentX + segmentZ * segmentZ;
    const contactT = segmentLengthSq > 1e-6
      ? clamp(((ps.x - startX) * segmentX + (ps.z - startZ) * segmentZ)
        / segmentLengthSq, 0, 1) : 0;
    const contactX = startX + segmentX * contactT;
    const contactZ = startZ + segmentZ * contactT;
    const contactDistance = Math.hypot(ps.x - contactX, ps.z - contactZ);
    const contactY = groundAt(contactX, contactZ) + 1.10;
    if (!state.actionHit
      && Math.abs(ps.y - inst.y) <= 2.4
      && contactDistance <= C.boostReach
      && clearLine(contactX, contactY, contactZ, ps.x, ps.y + 1.0, ps.z)) {
      state.actionHit = true;
      /* Report the telegraphed approach side, not the post-sweep endpoint.
         Otherwise a coarse frame can carry the boss just past the player and
         make a correctly-facing Aegis interpret the hit as coming from behind. */
      const damage = hurtPlayer(C.boostDamage, "apostate-boost", {
        x: startX,
        y: groundAt(startX, startZ) + 1.1,
        z: startZ,
      });
      ctx.vfx?.blast?.(contactX, groundAt(contactX, contactZ) + 0.45, contactZ, 3.2);
      bus.emit("boostHit", { x: contactX, z: contactZ, damage });
    }
    if (state.actionElapsed >= C.boostSeconds || moved < C.boostSpeed * dt * 0.12) {
      state.boostTimer = C.boostCadence;
      finishAction("boost");
    }
  }

  function updateJet(dt) {
    const riseEnd = C.jetRiseSeconds;
    const hoverEnd = riseEnd + C.jetHoverSeconds;
    const plungeEnd = hoverEnd + C.jetPlungeSeconds;
    if (state.actionElapsed < riseEnd) {
      const t = clamp01(state.actionElapsed / riseEnd);
      setJetAltitude(C.jetAltitude * (1 - (1 - t) ** 3), state.altitude < 0.82);
      facePlayer(3.8, dt);
    } else if (state.actionElapsed < hoverEnd) {
      setJetAltitude(C.jetAltitude + Math.sin(state.actionElapsed * 5.5) * 0.32);
      facePlayer(5.8, dt);
      const ps = ctx.player.state;
      const dx = ps.x - inst.x;
      const dz = ps.z - inst.z;
      const distance = Math.hypot(dx, dz) || 1;
      move(-dz / distance, dx / distance, C.strafeSpeed * 0.7, dt);
      const hoverTime = state.actionElapsed - riseEnd;
      const wantedShots = Math.min(3, Math.floor((hoverTime + 0.02) / 0.42));
      while (!state.overheated && state.shotIndex < wantedShots) {
        fireLance();
        state.shotIndex += 1;
      }
    } else if (state.actionElapsed < plungeEnd) {
      const t = clamp01((state.actionElapsed - hoverEnd) / C.jetPlungeSeconds);
      setJetAltitude(C.jetAltitude * (1 - t * t));
      corruption.jetGlow.visible = t < 0.55;
    } else {
      const landing = setJetAltitude(0);
      if (!state.jetImpacted) {
        state.jetImpacted = true;
        inst.grounded = state.altitude <= 0.05 || !!landing.hitY;
        const impactY = landing.y;
        const ps = ctx.player.state;
        const distance = Math.hypot(ps.x - inst.x, ps.z - inst.z);
        const nearGround = ps.grounded
          || Math.abs(ps.y - groundAt(ps.x, ps.z)) <= 2.2;
        const impactClear = clearLine(inst.x, impactY + 0.32, inst.z,
          ps.x, groundAt(ps.x, ps.z) + 0.32, ps.z);
        const damage = nearGround && distance <= C.slamRadius && impactClear
          ? hurtPlayer(C.slamDamage * (1 - 0.45 * distance / C.slamRadius),
            "apostate-slam", { x: inst.x, y: impactY + 0.32, z: inst.z }) : 0;
        ctx.vfx?.blast?.(inst.x, impactY + 0.15, inst.z, C.slamRadius);
        bus.emit("slam", {
          x: inst.x, y: impactY, z: inst.z, radius: C.slamRadius,
          hit: damage > 0, damage,
        });
      }
    }
    if (state.actionElapsed >= ACTION_DURATIONS.jet) {
      state.jetTimer = C.jetCadence;
      finishAction("jet");
    }
  }

  function updateAction(dt) {
    if (!state.action) return false;
    state.actionElapsed += dt;
    state.actionFor = Math.max(0, state.actionFor - dt);
    if (state.action.startsWith("melee")) updateMelee(dt);
    else if (state.action === "ranged") updateRanged();
    else if (state.action === "boost") updateBoost(dt);
    else if (state.action === "jet") updateJet(dt);
    else if (state.action === "summon") {
      facePlayer(2.8, dt);
      if (!state.actionHit && state.actionElapsed >= C.summonWindup) {
        state.actionHit = true;
        summonBrood();
      }
      if (state.actionFor <= 0) {
        state.summonTimer = C.summonCadence;
        finishAction("summon");
      }
    } else if (state.action === "shield") {
      facePlayer(4.2, dt);
      if (state.actionFor <= 0) {
        state.shieldTimer = C.shieldCadence;
        finishAction("shield");
      }
    } else if (state.action === "vent") {
      facePlayer(2.4, dt);
      if (state.actionFor <= 0) finishAction("vent");
    }
    return true;
  }

  function chooseAction(dist) {
    if (state.overheated) return beginAction("vent");
    if (state.summonTimer <= 0 && livingSummons().length < C.summonCap) {
      return beginAction("summon");
    }
    /* Defensive and mobility verbs rotate through the same fight instead of
       all firing as soon as their cooldown happens to cross zero together. */
    const selector = state.actionSerial % 4;
    if (state.jetTimer <= 0 && selector === 0) return beginAction("jet");
    if (state.shieldTimer <= 0 && selector === 1) return beginAction("shield");
    if (state.boostTimer <= 0 && dist > 8 && selector === 2) return beginAction("boost");
    if (dist <= C.melee[state.meleeStep].reach + 0.8 && state.meleeTimer <= 0) {
      return beginAction(`melee${state.meleeStep + 1}`, C.melee[state.meleeStep].duration);
    }
    if (state.shotTimer <= 0 && lineToPlayer("weapon")) return beginAction("ranged");
    if (state.jetTimer <= 0) return beginAction("jet");
    if (state.shieldTimer <= 0) return beginAction("shield");
    if (state.boostTimer <= 0 && dist > 10) return beginAction("boost");
    return false;
  }

  function updateDuel(dt) {
    const ps = ctx.player.state;
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const dist = Math.hypot(dx, dz);
    /* Cooldowns only need one ready sentinel. Letting them count down forever
       while the player is across the map eventually creates a snapshot outside
       the save validator's finite durable range. */
    state.summonTimer = Math.max(-1, state.summonTimer - dt);
    state.shotTimer = Math.max(-1, state.shotTimer - dt);
    state.meleeTimer = Math.max(-1, state.meleeTimer - dt);
    state.boostTimer = Math.max(-1, state.boostTimer - dt);
    state.shieldTimer = Math.max(-1, state.shieldTimer - dt);
    state.jetTimer = Math.max(-1, state.jetTimer - dt);

    /* If the plunge found a real mesh support above the terrain, keep using
       swept vertical motion until the boss walks off it. This prevents both a
       through-rubble teleport and a permanent hover after leaving the ledge. */
    if (inst.grounded && state.altitude > 0.05 && state.action !== "jet") {
      const settling = setJetAltitude(Math.max(0, state.altitude - dt * 11));
      inst.grounded = state.altitude <= 0.05 || !!settling.hitY;
    }

    /* Self-driven actors deliberately bypass generic AI, including the
       generic stun clock. Honour that shared field here so a player slam
       visibly staggers the mirror instead of reporting a stun it ignores. */
    if (inst.stunTime > 0) {
      inst.stunTime = Math.max(0, inst.stunTime - dt);
      inst.speed = 0;
      return;
    }

    if (dist > C.disengageRadius) {
      /* Crossing the leash is an immediate, readable cancel. Freezing an
         action here let an expired melee/boost resume many seconds later; a
         frozen jet was worse because the eventual clear snapped its altitude.
         Preserve height and descend through the same flight sweep instead. */
      if (state.disengageFor <= 0 && state.action) {
        if (state.action === "shield") {
          bus.emit("shield", { x: inst.x, z: inst.z, active: false });
        }
        clearAction({ preserveAltitude: state.altitude > 0.05 });
      }
      state.disengageFor = Math.min(C.disengageSeconds + 1, state.disengageFor + dt);
      if (state.altitude > 0.05) {
        const retreatFall = setJetAltitude(Math.max(0, state.altitude - dt * 11));
        inst.grounded = state.altitude <= 0.05 || !!retreatFall.hitY;
      }
      if (state.disengageFor > C.disengageSeconds) {
        const hx = C.arenaX - inst.x;
        const hz = C.arenaZ - inst.z;
        facePlayer(1.2, dt);
        move(hx, hz, C.walkSpeed, dt);
        if (Math.hypot(hx, hz) < 1.2) {
          inst.health = Math.min(inst.maxHealth, inst.health + inst.maxHealth * dt * 0.12);
        }
      }
      return;
    }
    state.disengageFor = 0;
    facePlayer(state.action ? 5.2 : 7.2, dt);
    if (updateAction(dt)) return;
    if (chooseAction(dist)) return;

    if (dist > C.holdRange[1]) move(dx, dz, C.walkSpeed, dt);
    else if (dist < C.holdRange[0]) move(-dx, -dz, C.walkSpeed * 0.68, dt);
    else {
      const side = (Math.floor(state.elapsed / 3.8) % 2) ? 1 : -1;
      move(-dz * side, dx * side, C.strafeSpeed, dt);
    }
  }

  function poseFigure(dt) {
    const action = state.action;
    const baseY = groundAt(inst.x, inst.z);
    inst.y = baseY + state.altitude;
    const speedN = clamp01(inst.speed / Math.max(1, C.walkSpeed));
    const walk = Math.sin(inst.stride * 2.9) * 0.48 * speedN;
    for (let i = 0; i < 2; i += 1) {
      figure.legPivots[i].quaternion.copy(bind.legs[i]);
      figure.kneePivots[i].quaternion.copy(bind.knees[i]);
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (i ? -walk : walk));
      figure.legPivots[i].quaternion.multiply(q);
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.max(0, (i ? walk : -walk)) * 0.55);
      figure.kneePivots[i].quaternion.multiply(q);
    }
    figure.chest.quaternion.copy(bind.chest);
    figure.head.quaternion.copy(bind.head);
    const lean = action === "boost" ? -0.34 : action === "jet" ? -0.10
      : action?.startsWith("melee") ? 0.10 : 0;
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    figure.chest.quaternion.multiply(q);

    const ps = ctx.player.state;
    const dy = ps.y + 1.25 - (inst.y + 1.70);
    const horizontal = Math.max(1, Math.hypot(ps.x - inst.x, ps.z - inst.z));
    q.setFromEuler(euler.set(clamp(-Math.atan2(dy, horizontal), -0.32, 0.32), 0, 0));
    figure.head.quaternion.multiply(q);

    /* The player carry pose, then authored deltas for the mirrored actions.
       The weapon drives both hands through the same two-joint IK solver. */
    weapon.root.position.set(0.050, -0.225, 0.185);
    weapon.root.rotation.set(0.02, -0.03, 0.22);
    if (action?.startsWith("melee")) {
      const spec = C.melee[state.meleeStep];
      const t = clamp01(state.actionElapsed / Math.max(0.01, spec.duration));
      const swing = Math.sin(t * Math.PI);
      weapon.root.position.x += lerp(-0.10, 0.26, t) * swing;
      weapon.root.position.y += 0.18 * swing;
      weapon.root.rotation.y += (state.meleeStep === 1 ? -1.35 : 1.0) * swing;
      weapon.root.rotation.z += (state.meleeStep === 2 ? -1.0 : 0.56) * swing;
    } else if (action === "shield") {
      weapon.root.position.y -= 0.18;
      weapon.root.rotation.z -= 0.36;
    } else if (action === "vent" || action === "summon") {
      weapon.root.rotation.z += 0.52;
      weapon.root.position.y -= 0.12;
    } else if (action === "jet") {
      weapon.root.position.y += 0.07;
      weapon.root.rotation.z -= 0.16;
    }

    inst.root.position.set(inst.x, inst.y, inst.z);
    const deathT = state.phase === "dead" ? clamp01(state.timer / 2.2) : 0;
    inst.root.rotation.set(
      action === "jet" ? clamp(-state.altitude * 0.018, -0.14, 0) : 0,
      inst.yaw,
      state.phase === "dead" ? -Math.PI * 0.47 * deathT
        : action === "boost" ? -0.10 : 0
    );
    if (state.phase === "reveal") {
      const reveal = 1 - clamp01(state.timer / C.revealSeconds);
      inst.root.scale.copy(figure.baseScale).multiplyScalar(C.bodyScale * (0.88 + reveal * 0.12));
    } else {
      inst.root.scale.copy(figure.baseScale).multiplyScalar(C.bodyScale);
    }
    inst.root.updateMatrixWorld(true);

    /* The projectile and the rendered lance share an aim. Rotate the current
       authored carry pose by the smallest world-space delta from its physical
       butt-to-tip axis to the player, then let both arms follow the grips. */
    if ((action === "ranged" || action === "jet")
      && weapon.root.parent && weapon.tip && weapon.butt) {
      weapon.tip.getWorldPosition(weaponTip);
      weapon.butt.getWorldPosition(weaponButt);
      weaponAxis.copy(weaponTip).sub(weaponButt);
      aimDirection.set(ps.x, ps.y + 1.25, ps.z).sub(weaponButt);
      if (weaponAxis.lengthSq() > 1e-6 && aimDirection.lengthSq() > 1e-6) {
        weaponAxis.normalize();
        aimDirection.normalize();
        aimDeltaQ.setFromUnitVectors(weaponAxis, aimDirection);
        weapon.root.getWorldQuaternion(weaponWorldQ);
        weaponWorldQ.premultiply(aimDeltaQ);
        weapon.root.parent.getWorldQuaternion(parentWorldQ).invert();
        weapon.root.quaternion.copy(parentWorldQ).multiply(weaponWorldQ);
        weapon.root.updateWorldMatrix(false, true);
      }
    }

    forward.set(Math.sin(inst.yaw), 0, Math.cos(inst.yaw));
    right.set(Math.cos(inst.yaw), 0, -Math.sin(inst.yaw));
    for (let i = 0; i < 2; i += 1) {
      figure.armPivots[i].quaternion.copy(bind.arms[i]);
      figure.elbowPivots[i].quaternion.copy(bind.elbows[i]);
    }
    inst.root.updateMatrixWorld(true);
    const grips = [weapon.gripFront, weapon.gripRear];
    for (let i = 0; i < 2; i += 1) {
      const anchor = grips[i];
      if (!anchor) continue;
      anchor.getWorldPosition(grip);
      const localPole = ctx.player?.carryElbowPole?.(i);
      if (localPole) {
        pole.copy(localPole).applyAxisAngle(up, inst.yaw).normalize();
      } else {
        pole.copy(up).multiplyScalar(-0.8).addScaledVector(right, i ? 0.6 : -0.6).normalize();
      }
      const lengths = figure.armLengths?.[i] || figure.limb;
      solveTwoJoint(figure.armPivots[i], figure.elbowPivots[i], grip, pole,
        lengths.upper * C.bodyScale, lengths.fore * C.bodyScale, figure.armAxis);
    }

    const wingOpen = action === "jet" ? 0.76 : action === "summon" ? 0.46 : 0.14;
    const flutter = action === "jet" ? Math.sin(state.elapsed * 36) * 0.075
      : action === "summon" ? Math.sin(state.elapsed * 18) * 0.035 : 0;
    for (const wing of corruption.wingPivots) {
      const targetYaw = wing.side * (wingOpen + flutter);
      wing.node.rotation.y = damp(wing.node.rotation.y, targetYaw, 12, dt);
    }
    corruption.abdomen.rotation.x = Math.sin(state.elapsed * 2.2) * 0.035;
    if (aegis.group.visible) {
      aegis.group.scale.setScalar(0.96 + Math.sin(state.elapsed * 8.2) * 0.035);
      aegis.faceMat.opacity = 0.11 + Math.sin(state.elapsed * 6.4) * 0.035;
      aegis.rim.rotation.z += dt * 0.42;
    }
    inst.root.updateMatrixWorld(true);
    updatePrewarmedLights();
  }

  function dismissOwnedThreats(reason) {
    let removed = 0;
    let projectiles = ctx.combat?.clearProjectiles?.(inst.id) || 0;
    /* Status/HUD pruning intentionally removes dead children from broodKids.
       Their short-lived bolts can still be airborne, so recover every actor
       bearing the durable owner id from the authoritative roster as well. */
    const owned = new Set([
      ...(inst.broodKids || []),
      ...enemies.live.filter((enemy) => enemy !== inst && enemy.eventId === inst.id),
    ]);
    for (const kid of owned) {
      /* Gleaners own their bolts even when the Apostate owns the Gleaner.
         Silence those descendants before removing the actors so victory can
         never be followed by an orphaned brood projectile. */
      projectiles += ctx.combat?.clearProjectiles?.(kid.id) || 0;
      if (enemies.remove?.(kid)) removed += 1;
    }
    inst.broodKids = [];
    if (removed || projectiles) bus.emit("broodDismissed", {
      x: inst.x, z: inst.z, reason, removed, projectiles,
    });
    return { removed, projectiles };
  }

  function finishDeath({ emit = true, reason = "defeated" } = {}) {
    const entering = !state.defeated || state.phase !== "dead";
    /* A lethal player shot is flushed after this controller's update. An
       autosave on that same frame can therefore restore health=0 beside a
       still-duelling phase. Treat death finalization as idempotent so restore
       can canonicalize that legitimate intermediate without leaving its brood
       alive through victory. */
    if (!entering && !(inst.broodKids || []).length) return false;
    if (entering) {
      state.defeated = true;
      state.phase = "dead";
      state.timer = 0;
      state.deathStartAltitude = state.altitude;
      state.victoryReported = false;
      clearAction({ preserveAltitude: true });
      inst.grounded = state.deathStartAltitude <= 0.05;
      setEncounterGate(false, true);
      if (emit) bus.emit("defeated", { x: inst.x, y: inst.y, z: inst.z });
    }
    dismissOwnedThreats(reason);
    return entering;
  }

  function update(dt) {
    if (!registered()) {
      if (state.defeated) {
        updatePrewarmedLights();
        return;
      }
      ensureSpawned();
    }
    const d = Math.min(0.1, Math.max(0, dt));
    state.elapsed += d;
    updateHeat(d);
    if (inst.state === "death" || inst.health <= 0) {
      finishDeath();
      state.timer = Math.min(2.2, state.timer + d);
      const fall = clamp01(state.timer / 0.82);
      const falling = setJetAltitude(state.deathStartAltitude * (1 - fall * fall));
      inst.grounded = state.altitude <= 0.05 || !!falling.hitY;
      poseFigure(d);
      if (state.timer >= 2.2 && !state.victoryReported) {
        const completed = ctx.mission?.completeFinalBoss?.("apostate") === true;
        if (completed || ctx.mission?.state?.phase === "won") {
          state.victoryReported = true;
          bus.emit("settled", { x: inst.x, y: inst.y, z: inst.z });
        }
      }
      return;
    }

    if (state.phase === "dormant") {
      const missionReady = ctx.mission?.state?.phase === "cathedralBoss";
      const ps = ctx.player.state;
      const distance = Math.hypot(ps.x - inst.x, ps.z - inst.z);
      const insideNave = Math.abs(ps.x - C.arenaX) <= C.naveHalfWidth
        && Math.abs(ps.z - DISTRICTS.cathedral.z) <= C.naveHalfLength;
      if (missionReady && insideNave && distance <= C.revealRadius) beginReveal();
    } else if (state.phase === "reveal") {
      const life = ctx.combat?.player;
      if (life?.dead || (Number.isFinite(life?.hp) && life.hp <= 0)) {
        /* Combat keeps simulating during the free-camera beat. If Cathedral
           garrison kills the player, re-arm the encounter instead of unlocking
           a duel while respawn places them across the map. */
        ctx.player?.setFree?.(false);
        state.phase = "dormant";
        state.timer = 0;
        state.revealed = false;
        state.releaseCameraAt = undefined;
        setEncounterGate(true, true);
        bus.emit("revealCancelled", { x: inst.x, z: inst.z, reason: "player-dead" });
      } else {
        state.timer -= d;
        facePlayer(1.8, d);
        if (state.timer <= 0) beginDuel();
      }
    } else if (state.phase === "duel") {
      updateDuel(d);
    }
    poseFigure(d);
  }

  function modifyIncomingDamage(targetInst, request, damage) {
    if (targetInst !== inst || !state.shieldActive || state.phase !== "duel") return damage;
    const attackX = Number.isFinite(request.originX) ? request.originX : Number(request.x);
    const attackZ = Number.isFinite(request.originZ) ? request.originZ : Number(request.z);
    const hx = attackX - inst.x;
    const hz = attackZ - inst.z;
    const distance = Math.hypot(hx, hz);
    /* Area damage reports the target centre. The player's Aegis blocks a
       directed hit, not an orbital blast centred inside it; retain a reduced
       leak for that centre case and fully block honest frontal contacts. */
    let blocked = false;
    let result = damage;
    if (distance < 0.08) {
      if (request.source === "explosion" || request.source === "slam") result *= 0.40;
    } else {
      const dot = (Math.sin(inst.yaw) * hx + Math.cos(inst.yaw) * hz) / distance;
      blocked = dot >= C.shieldFrontDot;
      if (blocked) result = 0;
    }
    if (blocked || result < damage) {
      state.shieldBlocks += 1;
      ctx.vfx?.spark?.(request.x, request.y, request.z, blocked ? 1.7 : 1.15, false, true);
      bus.emit("shieldBlock", {
        x: request.x, y: request.y, z: request.z,
        source: request.source, requested: damage, damage: result,
      });
    }
    return result;
  }

  function status() {
    return {
      phase: state.phase,
      action: state.action,
      actionFor: Number(state.actionFor.toFixed(2)),
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      heat: Number(state.heat.toFixed(3)),
      overheated: state.overheated,
      shieldActive: state.shieldActive,
      shieldBlocks: state.shieldBlocks,
      airborne: !inst.grounded,
      altitude: Number(state.altitude.toFixed(2)),
      summons: livingSummons().length,
      summonCap: C.summonCap,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      revealed: state.revealed,
      dead: state.phase === "dead" || inst.state === "death",
      defeated: state.defeated,
      x: Number(inst.x.toFixed(2)),
      y: Number(inst.y.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
      abilities: ["lance", "melee", "boost", "jet", "slam", "aegis", "summon"],
      model: {
        asset: figure.assetSource,
        corrupted: true,
        featureCount: corruption.wings.length + corruption.spikes.length + 3,
      },
    };
  }

  function snapshot() {
    return {
      instanceId: inst.id,
      phase: state.phase,
      timer: Number(state.timer.toFixed(3)),
      action: state.action,
      actionFor: Number(state.actionFor.toFixed(3)),
      actionElapsed: Number(state.actionElapsed.toFixed(3)),
      actionHit: state.actionHit,
      actionYaw: state.actionYaw,
      shotIndex: state.shotIndex,
      meleeStep: state.meleeStep,
      heat: Number(state.heat.toFixed(4)),
      sinceShot: Number(state.sinceShot.toFixed(3)),
      overheated: state.overheated,
      shieldBlocks: state.shieldBlocks,
      altitude: Number(state.altitude.toFixed(3)),
      jetImpacted: state.jetImpacted,
      deathStartAltitude: Number(state.deathStartAltitude.toFixed(3)),
      victoryReported: state.victoryReported,
      actionSerial: state.actionSerial,
      disengageFor: Number(state.disengageFor.toFixed(3)),
      cooldowns: {
        summon: state.summonTimer,
        shot: state.shotTimer,
        melee: state.meleeTimer,
        boost: state.boostTimer,
        shield: state.shieldTimer,
        jet: state.jetTimer,
      },
      health: inst.health,
      maxHealth: inst.maxHealth,
      x: inst.x,
      z: inst.z,
      yaw: inst.yaw,
      revealed: state.revealed,
      defeated: state.defeated,
      summonIds: livingSummons().map((kid) => kid.id),
    };
  }

  function restore(saved = {}, restoredEnemies = null) {
    if (!saved || typeof saved !== "object") return false;
    ensureSpawned();
    const phases = new Set(["dormant", "reveal", "duel", "dead"]);
    state.phase = phases.has(saved.phase) ? saved.phase : "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.action = typeof saved.action === "string"
      && (Object.hasOwn(ACTION_DURATIONS, saved.action) || /^melee[123]$/.test(saved.action))
      ? saved.action : null;
    state.actionFor = Math.max(0, Number(saved.actionFor) || 0);
    state.actionElapsed = Math.max(0, Number(saved.actionElapsed) || 0);
    state.actionHit = !!saved.actionHit;
    state.actionYaw = Number.isFinite(saved.actionYaw) ? saved.actionYaw : inst.yaw;
    state.shotIndex = clamp(Math.round(Number(saved.shotIndex) || 0), 0, C.shotCount);
    state.meleeStep = clamp(Math.round(Number(saved.meleeStep) || 0), 0, C.melee.length - 1);
    state.heat = clamp01(Number(saved.heat) || 0);
    state.sinceShot = Math.max(0, Number(saved.sinceShot) || 0);
    state.overheated = !!saved.overheated;
    state.shieldBlocks = Math.max(0, Math.round(Number(saved.shieldBlocks) || 0));
    state.altitude = clamp(Number(saved.altitude) || 0, 0, C.jetAltitude + 1);
    state.jetImpacted = !!saved.jetImpacted;
    state.deathStartAltitude = clamp(Number(saved.deathStartAltitude) || 0,
      0, C.jetAltitude + 1);
    state.victoryReported = !!saved.victoryReported;
    state.actionSerial = Math.max(0, Math.round(Number(saved.actionSerial) || 0));
    state.disengageFor = Math.max(0, Number(saved.disengageFor) || 0);
    const cds = saved.cooldowns && typeof saved.cooldowns === "object" ? saved.cooldowns : {};
    state.summonTimer = Number(cds.summon) || 0;
    state.shotTimer = Number(cds.shot) || 0;
    state.meleeTimer = Number(cds.melee) || 0;
    state.boostTimer = Number(cds.boost) || 0;
    state.shieldTimer = Number(cds.shield) || 0;
    state.jetTimer = Number(cds.jet) || 0;
    inst.maxHealth = Math.max(1, Number(saved.maxHealth) || C.health);
    const savedHealth = Number(saved.health);
    inst.health = clamp(Number.isFinite(savedHealth) ? savedHealth : inst.maxHealth,
      0, inst.maxHealth);
    inst.x = Number.isFinite(saved.x) ? saved.x : C.arenaX;
    inst.z = Number.isFinite(saved.z) ? saved.z : C.arenaZ;
    inst.yaw = Number.isFinite(saved.yaw) ? saved.yaw : Math.PI;
    /* This domain reuses one rig instead of rebuilding an enemy instance.
       Runtime-only motion from the abandoned future must not survive a load
       and push or stun the restored boss on the following generic enemy tick. */
    inst.speed = 0;
    inst.stride = 0;
    inst.stunTime = 0;
    inst.knockbackX = 0;
    inst.knockbackZ = 0;
    inst.knockbackTime = 0;
    inst.bodyDrop = 0;
    state.revealed = !!saved.revealed || state.phase !== "dormant";
    state.defeated = !!saved.defeated || state.phase === "dead" || inst.health <= 0;
    inst.grounded = state.defeated
      ? state.altitude <= 0.05
      : state.action !== "jet" || state.jetImpacted || state.altitude <= 0.05;
    /* The reusable durable instance outlives generic roster restores. Its old
       session-clock corpse stamp must not make a reloaded 2.2s death handoff
       look 26 seconds old and disappear before mission completion. */
    delete inst.diedAt;
    inst.state = state.defeated ? "death" : "idle";
    state.shieldActive = state.action === "shield" && !state.defeated;
    aegis.group.visible = state.shieldActive;
    corruption.jetGlow.visible = state.action === "jet" && !state.defeated;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    inst.broodKids = (Array.isArray(saved.summonIds) ? saved.summonIds : [])
      .map((id) => byId.get(id)).filter(Boolean);
    if (state.defeated) finishDeath({ emit: false, reason: "restored-defeat" });
    setEncounterGate(state.phase === "dormant", state.phase === "dormant" || state.phase === "reveal"
      || state.defeated);
    poseFigure(0);
    return true;
  }

  function reset() {
    dismissOwnedThreats("reset");
    clearAction();
    state.phase = "dormant";
    state.timer = 0;
    state.elapsed = 0;
    state.altitude = 0;
    state.heat = 0;
    state.sinceShot = 99;
    state.overheated = false;
    state.defeated = false;
    state.victoryReported = false;
    state.deathStartAltitude = 0;
    state.revealed = false;
    state.shieldBlocks = 0;
    state.meleeStep = 0;
    state.actionSerial = 0;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    state.summonTimer = C.summonCadence * 0.45;
    state.shotTimer = C.shotCadence * 0.42;
    state.meleeTimer = C.meleeCadence * 0.72;
    state.boostTimer = C.boostCadence * 0.65;
    state.shieldTimer = C.shieldCadence * 0.62;
    state.jetTimer = C.jetCadence * 0.72;
    inst.health = inst.maxHealth = C.health;
    delete inst.diedAt;
    inst.state = "idle";
    inst.grounded = true;
    inst.speed = 0;
    inst.stride = 0;
    inst.stunTime = 0;
    inst.knockbackX = 0;
    inst.knockbackZ = 0;
    inst.knockbackTime = 0;
    inst.bodyDrop = 0;
    inst.x = spawnX;
    inst.z = spawnZ;
    inst.yaw = Math.PI;
    inst.broodKids = [];
    ensureSpawned();
    setEncounterGate(true, true);
    poseFigure(0);
    bus.emit("reset", { x: inst.x, z: inst.z });
    return status();
  }

  ensureSpawned();
  poseFigure(0);

  return {
    bus,
    config: C,
    state,
    figure,
    weapon,
    corruption,
    update,
    status,
    snapshot,
    restore,
    reset,
    ensureSpawned,
    instance: () => inst,
    registered,
    setEncounterGate,
    beginReveal,
    modifyIncomingDamage,
    objective() {
      const ps = ctx.player.state;
      return {
        name: state.phase === "dormant" ? "RETURN TO THE VAULT-CATHEDRAL"
          : state.phase === "reveal" ? "WITNESS THE APOSTATE"
            : "DESTROY THE APOSTATE",
        x: inst.x,
        z: inst.z,
        dist: Math.hypot(ps.x - inst.x, ps.z - inst.z),
        progress: state.phase === "duel"
          ? clamp01(1 - inst.health / Math.max(1, inst.maxHealth)) : 0,
        event: true,
      };
    },
    forceAction(name) {
      if (state.phase === "dormant") beginReveal();
      if (state.phase === "reveal") beginDuel();
      clearAction();
      if (/^melee[123]$/.test(name)) state.meleeStep = Number(name.slice(-1)) - 1;
      return beginAction(name, /^melee[123]$/.test(name)
        ? C.melee[state.meleeStep].duration : ACTION_DURATIONS[name]);
    },
    forceSummon: summonBrood,
  };
}
