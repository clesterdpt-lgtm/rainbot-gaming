/* ============================================================
   SAINTFALL - The Apostate

   The operation's final enemy is the player silhouette after the Bloom has
   learned it: the same Reliquary trooper, the same Censer-Lance, the same
   movement and defensive verbs, with the command rite replaced by a brood
   call. It is intentionally a self-driven enemy. Player systems own input,
   camera, fuel and enemy-facing damage; this module mirrors their readable
   timings while keeping independent boss state and player-facing damage.

   ------------------------------------------------------------
   SURFACE: THE RECOLOUR WAS THE BUG.

   Vesper's figure is not one of the untextured boss .glb files. It
   carries a 2048 baseColour ATLAS - ivory reliquary plate, gold-leaf
   panels, blackened iron straps, with cracks, chips and panel lines
   painted into all of it - which is the richest single surface in
   the game. The Apostate then threw the whole thing away in one
   line: `material.color.lerp(chitin, 0.78)` multiplies that atlas by
   a dark violet whose linear value is about 0.05, so every painted
   crack, chip and gold panel came out at a twentieth of its authored
   value and the boss measured 3.47 microDetail against a Halo pool
   band of 6.07-13.9. It was not that the mirror had no surface; it
   was that the corruption pass was a near-black multiply over it.

   So the corruption is now a REPALETTE, not a wash, and it is
   ordered exactly the way the Scarab's is (see the art-direction
   doc): a lot of the neutral, a little of the warm, a spot of the
   saturated.

     - a lot   blackened reliquary iron, the atlas at full detail
               under a cool dark multiplier. Value DOWN and hue COOL
               against the Cathedral's warm grey-taupe #bfa88c, which
               is this boss's assigned separation strategy.
     - a little the SAME gold leaf the player wears, kept warm and
               kept bright. It is the one thing that says this is the
               player's own armour, and it is where the frame's
               highlights come from.
     - a spot  Bloom growth at the seams and the reliquary lamps,
               violet-cyan, above the bloom threshold.

   Which triangle is which is not guessed from bind-pose geometry -
   it is READ OFF THE ATLAS. The texture is sampled back at 512, each
   triangle is classified at its UV centroid, and the index buffer is
   re-sorted into three geometry groups. That is why the split lands
   on real armour parts (gold panel, plate, strap) rather than on a
   height band, and it costs +2 draw calls and one canvas readback at
   build time. If the readback fails - no 2D context, a tainted
   canvas - the whole thing degrades to a single plate zone rather
   than throwing, because a boss that does not exist is worse than a
   boss with one material.

   Each zone then takes a DIFFERENT family from the shared surface
   kit, because "different parts must read as different materials" is
   the first axis in the brief: plate is `bone` (fired reliquary
   ceramic - chalky, no gloss travel, high wear on the rubbed upward
   faces), leaf is `bronze` (gold over metal - pitted, rubbed high
   points, a real specular lobe), strap is `hide`, the Bloom growth
   is `chitin` and the wings are `membrane`. Five families in one
   silhouette.

   `applySurface` REPLACES `patchMaterial`; it goes through the same
   door and calling both trips the patch path's already-patched early
   return and leaves the surface silently off. Every material here
   arrives already patched (the figure loader patches, and
   `cloneVisual` re-patches its clones), so `resurface` below strips
   the prior patch first and is the only way into a material in this
   file.

   METALNESS IS CAPPED, and art.js already paid for the lesson twice:
   past about 0.6 the albedo becomes the specular F0, the diffuse
   term vanishes, and the surface renders as a blurred warm
   reflection of the environment - a gold at 0.72 measured TERRACOTTA
   and a bronze head rendered orange-red. The blown highlights this
   boss needs come from ROUGHNESS instead: a tight lobe on the leaf
   at 0.24 concentrates a 13-degree sun into something that clips,
   which is what the pool has and we did not.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus,
} from "saintfall/core.js";
import { PALETTE, patchBasicMaterial } from "saintfall/art.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
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
    /* Halved. At 8mm the ribs were thicker than the membrane could
       carry and they were the only part of the wing that read at
       fighting distance. A vein is a line ON a sheet, not a strut
       holding one up. */
    const rib = segment(THREE, [0, 0, 0.010], target, 0.0045, 0.0018, vein, 5);
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

/* ============================================================
   THE CORRUPTED RELIQUARY PALETTE

   These are MULTIPLIERS over the authored atlas, not flat colours,
   so every crack, chip and panel line the texture already carries
   survives underneath them. The value story is the whole point:
   the Cathedral's floor is warm grey-taupe #bfa88c, and a boss may
   not wear its district's sand.
   ============================================================ */
const SKIN = Object.freeze({
  /* The dominant. Cool and dark enough that ivory plate lands about
     two stops under the flagstones it stands on, while the atlas's
     own cracks fall to near-black and give the creases the brief
     asks for. Slightly blue so it reads as blackened metal rather
     than as dirty white. */
  plate: 0x767c92,
  /* The accent, and the one warm hue family on the animal. Barely
     darkened, because this is where the frame's highlights have to
     come from - the pool always has some blown pixels and the
     baseline measured a 99th percentile of 96 against a band that
     starts at 130. */
  leaf: 0xf0d49a,
  /* Boots, gauntlet webbing, undersuit. The darkest band on the
     figure and the one that separates the limbs from the plate. */
  strap: 0x40465a,
});

/* How far the corruption has advanced, from the health pool. Kept as
   a named curve because three separate systems read it - the growth
   scale, the surface damage uniform and the brood light - and a
   phase that means something different in each of them is not a
   phase. */
function corruptionOf(inst) {
  return clamp01(1 - inst.health / Math.max(1, inst.maxHealth));
}

/** Undo a prior `patchMaterial` so the surface kit can go in through
 *  the same door. Every material this module touches has already been
 *  patched by the figure loader or by `cloneVisual`, and the patch
 *  path early-returns on `sfPatched`, so without this the kit would
 *  silently do nothing and the boss would come back as plastic with
 *  no error anywhere. Assigning `undefined` to the hooks instead of
 *  deleting them shadows Material's prototype no-op and crashes the
 *  program builder - art.js records the same thing. */
function stripPatch(material) {
  material.userData = { ...material.userData };
  delete material.userData.sfPatched;
  delete material.userData.sfShader;
  delete material.userData.sfSurface;
  delete material.onBeforeCompile;
  delete material.customProgramCacheKey;
  return material;
}

function resurface(material, atmos, family, opts = {}) {
  if (!material || material.isMeshBasicMaterial) return material;
  stripPatch(material);
  return applySurface(material, atmos, family, opts);
}

/**
 * Read a loaded texture back as an RGBA byte grid.
 *
 * 512 rather than the atlas's native 2048: this is only ever asked
 * which ARMOUR PART a texel belongs to, and the islands are tens of
 * texels across at that size, so a sixteenth of the pixels answers
 * the same question for a sixteenth of the readback. The full-size
 * read was 4.2M pixels of getImageData on the boot path.
 *
 * Returns null rather than throwing on every failure mode - no 2D
 * context, a decode that has not landed, a tainted canvas - because
 * the caller's fallback is a working boss with one material and the
 * alternative is no Cathedral at all.
 */
function sampleTexture(texture, size = 512) {
  const image = texture && texture.image;
  if (!image) return null;
  const width = image.width || image.naturalWidth || 0;
  const height = image.height || image.naturalHeight || 0;
  if (!width || !height) return null;
  try {
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(image, 0, 0, size, size);
    return { size, data: g.getImageData(0, 0, size, size).data, flipY: !!texture.flipY };
  } catch (error) {
    console.warn("[saintfall] the Apostate could not read the reliquary atlas back", error);
    return null;
  }
}

/* Which of the three armour materials a painted texel belongs to.
   Thresholds read off the authored atlas rather than invented: the
   gold panels sit around (200,160,60) so their red-minus-blue is
   over half, the ivory plate is a near-neutral 0.85, and the straps,
   boots and gauntlet webbing are the only neutrals under 0.38. */
const ZONE_PLATE = 0;
const ZONE_LEAF = 1;
const ZONE_STRAP = 2;

function zoneOfTexel(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (r - b > 34 && r > 64) return ZONE_LEAF;
  /* 78, not 96. At 96 the atlas's mid-grey plate fell into the strap
     bucket as well as the boots and webbing - 45% of the figure - and
     the strap tint is the darkest of the three, on a boss whose whole
     measured failure is that nothing in its frame is bright. Below 78
     it is only the genuinely black leather. */
  return luma < 78 ? ZONE_STRAP : ZONE_PLATE;
}

/**
 * Re-sort a textured mesh's index buffer into one geometry group per
 * armour zone, so each can take a different material.
 *
 * The geometry is CLONED first. `cloneVisual` shares geometry with
 * the player by design and the figure loader is one cache setting
 * away from doing the same; re-sorting an index the player is also
 * drawing from is the kind of edit that shows up as a bug in a file
 * nobody touched.
 *
 * @returns {number[]|null} triangle counts per zone, or null if the
 *          mesh cannot be split (no UVs, no index, no atlas read).
 */
function splitArmourZones(THREE, mesh, atlas) {
  if (!atlas) return null;
  const source = mesh.geometry;
  const uv = source.getAttribute("uv");
  const index = source.getIndex();
  if (!uv || !index) return null;

  const geo = source.clone();
  mesh.geometry = geo;
  const src = geo.getIndex().array;
  const tris = (src.length / 3) | 0;
  const { size, data, flipY } = atlas;
  const buckets = [[], [], []];
  for (let t = 0; t < tris; t += 1) {
    let u = 0;
    let v = 0;
    for (let k = 0; k < 3; k += 1) {
      const vi = src[t * 3 + k];
      u += uv.getX(vi);
      v += uv.getY(vi);
    }
    u = (((u / 3) % 1) + 1) % 1;
    v = (((v / 3) % 1) + 1) % 1;
    /* glTF textures load with flipY false, so v runs DOWN the image
       exactly as a canvas row does. Honouring the flag anyway costs
       one branch and stops a future loader change from classifying
       the boots as gold leaf. */
    const px = Math.min(size - 1, (u * size) | 0);
    const py = Math.min(size - 1, ((flipY ? 1 - v : v) * size) | 0);
    const o = (py * size + px) * 4;
    buckets[zoneOfTexel(data[o], data[o + 1], data[o + 2])].push(t);
  }

  const out = new src.constructor(src.length);
  let cursor = 0;
  geo.clearGroups();
  for (let zone = 0; zone < buckets.length; zone += 1) {
    const list = buckets[zone];
    if (!list.length) continue;
    const start = cursor;
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i] * 3;
      out[cursor] = src[t];
      out[cursor + 1] = src[t + 1];
      out[cursor + 2] = src[t + 2];
      cursor += 3;
    }
    geo.addGroup(start, cursor - start, zone);
  }
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  return buckets.map((list) => list.length);
}

/**
 * Corrupt one of the player's own materials.
 *
 * `family`, `tint`, `rough` and `metal` are the whole art direction:
 * the atlas stays, the multiplier takes it cool and dark (or warm and
 * bright, for the leaf), and the kit supplies the grain, the cavity
 * and the specular travel that no amount of albedo can.
 */
function corruptMaterial(THREE, atmos, material, spec) {
  material.name = spec.name;
  /* The atlas is bound as the EMISSIVE map too, and the player nulls
     it for the same reason: a full-strength emissive copy of the
     albedo is a self-lit sticker, and it is exactly what stops a
     crease from ever going dark. */
  material.emissiveMap = null;
  if (material.color) material.color.set(spec.tint);
  if (material.emissive) material.emissive.set(spec.emissive ?? 0x120d18);
  material.emissiveIntensity = spec.emissiveIntensity ?? 0.05;
  material.roughness = spec.rough;
  material.metalness = spec.metal;
  material.envMapIntensity = spec.env ?? 1.12;
  material.needsUpdate = true;
  resurface(material, atmos, spec.family, {
    rim: spec.rim,
    bio: spec.bio ?? 0,
    scale: spec.scale,
    ...(spec.surface || {}),
  });
  return material;
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
  /* PALETTE.fleshy is a pink, and on three flattened spheres hung off
     the hip it came back as a row of jelly beans stuck to the
     armour - the single most toy-like thing in the close-up. Wet
     bruised violet at a fraction of the value reads as tissue under
     a shell, which is what these are. */
  const flesh = new THREE.MeshStandardMaterial({
    name: "sf-apostate-flesh",
    color: 0x46203a,
    emissive: 0x1c0a18,
    emissiveIntensity: 0.10,
    roughness: 0.52,
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
  /* Smoked, not pink. The membrane was PALETTE.chitinLit at 0.43
     opacity, which over a warm nave came back as four pale pink
     petals and read as a fairy costume from every framing in the
     gallery. Wet-black with a hot rim is what an insect wing does:
     the value lives in the rim term, not in the sheet. */
  const wingMembrane = new THREE.MeshStandardMaterial({
    name: "sf-apostate-wasp-membrane",
    color: 0x2a1c33,
    emissive: 0x1a0c24,
    emissiveIntensity: 0.18,
    transparent: true,
    /* 0.88, not 0.66. At two thirds the sheet all but vanished
       against a sunlit flagstone floor and only the three chitin ribs
       survived, so the wings read as the spokes of a broken umbrella.
       A membrane you can see through is one you have to be able to
       SEE - the transparency has to be the last 12%, not the first
       third. */
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.26,
    metalness: 0.02,
  });
  /* Five families in one silhouette, which is axis 1 of the brief.
     `scale` is the figure's own world scale so the grain is sized in
     WORLD metres on geometry the encounter draws 18% larger than it
     was authored - without it the corruption wears a finer grain
     than the armour it grows out of. */
  const grainScale = APOSTATE_CONFIG.bodyScale * (figure.baseScale?.x ?? 1);
  resurface(chitin, atmos, "chitin", { rim: 1.55, bio: 0.25, scale: grainScale });
  resurface(flesh, atmos, "membrane", { rim: 0.82, bio: 0.18, scale: grainScale });
  resurface(bio, atmos, "membrane", { rim: 1.1, bio: 1.9, scale: grainScale });
  resurface(wingMembrane, atmos, "membrane",
    { rim: 2.1, bio: 0.28, scale: grainScale, wear: 0.02, cavity: 0.18 });

  /* ------------------------------------------------------------
     REPALETTE THE PLAYER'S OWN ARMOUR.

     Independent copies, always: `cloneVisual` and the figure loader
     both hand back materials that may be shared with Vesper, and the
     Apostate's corruption must never recolour the trooper the player
     is looking through.
     ------------------------------------------------------------ */
  const armour = { plate: null, leaf: null, strap: null };
  let zoneCounts = null;
  const cloned = new Map();
  figure.root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const sources = Array.isArray(node.material) ? node.material : [node.material];
    const first = sources[0];
    const rootName = String(first?.name || "").toLowerCase();

    /* The atlas mesh is 20,817 of the figure's 21,000 triangles and
       carries the only painted surface on it. It is the one that gets
       split; everything else is a few dozen triangles of trim. */
    if (rootName.includes("atlas") && !armour.plate) {
      const atlas = sampleTexture(first.map, 512);
      zoneCounts = splitArmourZones(THREE, node, atlas);
      const base = () => {
        const m = first.clone();
        m.userData = { ...first.userData };
        return m;
      };
      armour.plate = corruptMaterial(THREE, atmos, base(), {
        name: "sf-apostate-plate", family: "bone", tint: SKIN.plate,
        rough: 0.58, metal: 0.14, rim: 1.05, scale: grainScale,
        /* Wear keys on upward-facing facets and goes pale AND
           desaturated - which on a blackened plate is the pewter
           rub along every shoulder and brow edge, and is most of
           what puts edges back into the frame. */
        /* Amplitudes above the family default, and the ceiling the
           kit records is set by the THINNEST limb on the animal -
           a cell field wrapped round a 30cm cylinder reads as cord.
           Nothing in this zone is thinner than a greave, and the
           frame's measured deficit is sub-facet grain, so the score
           and pore go up rather than the albedo going lighter.
           Gloss well above bone's 0.09 as well: a chalky family with
           no specular travel on the one boss whose highlight
           headroom was measured at 96 out of 255 is the wrong half
           of the trade. */
        surface: {
          wear: 0.22, cavity: 0.42, gloss: 0.24, mottle: 0.19,
          score: 0.0026, pore: 0.0016, wavelength: 0.70,
        },
      });
      armour.leaf = corruptMaterial(THREE, atmos, base(), {
        name: "sf-apostate-leaf", family: "bronze", tint: SKIN.leaf,
        /* The tight lobe. This is where the blown pixels come from,
           and it is roughness that buys them - metalness past 0.6
           would turn the leaf terracotta (art.js records it twice). */
        rough: 0.24, metal: 0.34, rim: 1.30, scale: grainScale, env: 1.35,
        surface: {
          wear: 0.20, gloss: 0.32, sheen: 0.18,
          score: 0.0034, pore: 0.0015, wavelength: 1.10,
        },
      });
      armour.strap = corruptMaterial(THREE, atmos, base(), {
        name: "sf-apostate-strap", family: "hide", tint: SKIN.strap,
        rough: 0.78, metal: 0.04, rim: 0.85, scale: grainScale,
        surface: { cavity: 0.36, score: 0.0020, pore: 0.0011, gloss: 0.18 },
      });
      node.material = zoneCounts
        ? [armour.plate, armour.leaf, armour.strap]
        : armour.plate;
      return;
    }

    const recolour = (source) => {
      if (!source) return source;
      if (cloned.has(source.uuid)) return cloned.get(source.uuid);
      const material = source.clone();
      const sf = source.userData || {};
      const name = String(material.name || "").toLowerCase();
      const holy = name.includes("amber") || name.includes("eye");
      material.userData = { ...material.userData };
      if (sf.sfBasic || source.isMeshBasicMaterial) {
        stripPatch(material);
        patchBasicMaterial(material, atmos,
          Number.isFinite(sf.sfFade) ? sf.sfFade : 0.7,
          sf.sfAdditive ?? source.blending === THREE.AdditiveBlending);
        if (material.color) material.color.set(holy ? PALETTE.bioCyan : SKIN.plate);
        cloned.set(source.uuid, material);
        return material;
      }
      if (holy) {
        /* The mask lamps and the reliquary amber: the saturated focal
           the art direction asks every boss for, and the only place
           on this one that clears the bloom chain's bright threshold.
           Diffuse stays nearly black so the socket reads as a hole
           that light comes out of rather than a plate stuck on. */
        corruptMaterial(THREE, atmos, material, {
          name: "sf-apostate-lamp", family: "membrane", tint: 0x1a2b30,
          emissive: PALETTE.bioCyan, emissiveIntensity: 4.6,
          rough: 0.30, metal: 0.0, rim: 1.2, bio: 1.6, scale: grainScale,
        });
      } else if (name.includes("dark")) {
        corruptMaterial(THREE, atmos, material, {
          name: "sf-apostate-dark-iron", family: "hide", tint: SKIN.strap,
          rough: 0.70, metal: 0.18, rim: 0.9, scale: grainScale,
        });
      } else {
        corruptMaterial(THREE, atmos, material, {
          name: "sf-apostate-trim", family: "bronze", tint: SKIN.leaf,
          rough: 0.30, metal: 0.30, rim: 1.25, scale: grainScale, env: 1.3,
        });
      }
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

  /* ------------------------------------------------------------
     BLOOM GROWTH AT THE SEAMS.

     The art direction asks for chitin growing where the armour joins
     and for the corruption to ADVANCE VISIBLY as the phases progress,
     and neither was true: every insect part was authored at final
     size and never moved again, so the fight's second half looked
     exactly like its first.

     Seams, specifically - collar, spine, pauldron, hip - because
     that is where a growth would find a gap, and because a nodule
     sitting in the middle of a plate reads as a barnacle. Each one
     carries its own threshold so they do not all bloom on the same
     frame; the collar is first because it is nearest the head and
     therefore nearest the camera in every framing that matters.
     ------------------------------------------------------------ */
  const growth = new THREE.Group();
  growth.name = "apostate-seam-growth";
  growth.userData.apostateFeature = "seam-growth";
  const growthNodes = [];
  const seamSpecs = [
    // [base, tip, radius, threshold]
    [[-0.115, 1.505, 0.020], [-0.175, 1.610, 0.075], 0.030, 0.00],
    [[0.115, 1.505, 0.020], [0.175, 1.610, 0.075], 0.030, 0.00],
    [[0.0, 1.470, -0.115], [0.0, 1.600, -0.185], 0.034, 0.05],
    [[-0.205, 1.395, -0.045], [-0.300, 1.455, -0.130], 0.032, 0.22],
    [[0.205, 1.395, -0.045], [0.300, 1.455, -0.130], 0.032, 0.22],
    [[0.0, 1.245, -0.140], [0.0, 1.225, -0.245], 0.030, 0.34],
    [[0.0, 1.075, -0.135], [0.035, 1.030, -0.240], 0.028, 0.48],
    [[-0.135, 0.960, -0.075], [-0.230, 0.905, -0.150], 0.026, 0.62],
    [[0.135, 0.960, -0.075], [0.230, 0.905, -0.150], 0.026, 0.62],
    [[-0.150, 1.330, 0.075], [-0.235, 1.310, 0.150], 0.024, 0.74],
    [[0.150, 1.330, 0.075], [0.235, 1.310, 0.150], 0.024, 0.74],
  ];
  for (let i = 0; i < seamSpecs.length; i += 1) {
    const [base, tip, radius, threshold] = seamSpecs[i];
    const node = new THREE.Group();
    node.name = `apostate-seam-growth-${i + 1}`;
    node.position.set(...base);
    const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.5, 0), flesh);
    bud.castShadow = true;
    node.add(bud);
    const horn = segment(THREE,
      [0, 0, 0],
      [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]],
      radius, 0.004, chitin, 5);
    node.add(horn);
    node.userData.apostateThreshold = threshold;
    node.scale.setScalar(0.0001);
    growth.add(node);
    growthNodes.push(node);
  }
  root.add(growth);

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
  for (const node of [...wingPivots.map((wing) => wing.node), abdomen, armorSpikes,
    growth, jetGlow]) {
    figure.chest.attach(node);
  }

  /* Every material that carries a damage response, gathered once.
     The kit refuses a write on a shared caste material; all of these
     are per-instance clones, so all of them accept one - and a boss
     whose plate scorches while its straps stay clean has a damage
     state that reads as a decal. */
  const hurtMaterials = [chitin, flesh, wingMembrane,
    armour.plate, armour.leaf, armour.strap].filter(Boolean);

  return {
    root, chitin, flesh, bio, wingMembrane, wingPivots, wings,
    abdomen, armorSpikes, spikeRoots, spikes, jetGlow,
    growth, growthNodes, armour, zoneCounts, hurtMaterials,
  };
}

/* ============================================================
   THE BROKEN VAULT

   "It is fought in the nave, under a broken vault. That is the best
   light in the game - shafts through a hole in the roof. Use them:
   stage the fight so it moves through light and shadow."

   Three apertures, not one, and that is the whole staging: one pool
   at the arena's centre where the boss holds, two off-centre where
   it strafes to. The fight crosses them.

   FOUR THINGS THIS FILE HAD TO GET RIGHT, ALL OF THEM ALREADY
   RECORDED IN vfx.js AT SOMEBODY ELSE'S EXPENSE:

   1. AN ADDITIVE CONE IS BRIGHTEST AT ITS SILHOUETTE, because that
      is where the ray runs longest through the shell. Push one and
      its outline becomes a drawn shape - the nave review frame came
      back with a hard-edged white chevron across the floor and was
      read as a rendering fault every time. So the cones are faint
      and the FLOOR POOL carries the brightness: a pool has no
      silhouette to harden.

   2. THEY MUST NOT CONVERGE. Ten clerestory shafts raked inward met
      on the centreline and rendered as one wedge. These three are
      raked apart and land in three separate places.

   3. NEARLY VERTICAL, NOT ALONG THE SUN. A real 13.5-degree
      golden-hour sun puts a shaft's foot ninety metres from its
      aperture, which is outside the building. The nave's existing
      clerestory light already made this compromise for the same
      reason and this matches it rather than arguing with it.

   4. IT COSTS NOTHING WHEN DORMANT. Everything here is one merged
      geometry per layer - three draw calls total - hung off the
      scene with `visible = false` until the duel is live. A dormant
      boss's scenery once cost this game 1.3ms a frame.
   ============================================================ */
function makeVaultLight(ctx, floorY) {
  const { THREE, atmos } = ctx;
  const C = APOSTATE_CONFIG;
  const group = new THREE.Group();
  group.name = "apostate-broken-vault";
  group.visible = false;

  /* Aperture, rake and size per shaft. Offsets are inside the hold
     range so the boss is genuinely in one of them most of the time
     rather than lit by scenery it never reaches. */
  const APERTURES = [
    { x: 0, z: 0, r: 6.6, rake: [0.10, 0.16], gain: 1.00, seed: 11 },
    { x: -14.5, z: 10.5, r: 5.0, rake: [-0.22, -0.10], gain: 0.82, seed: 29 },
    { x: 12.5, z: -13.0, r: 4.4, rake: [0.20, -0.22], gain: 0.74, seed: 47 },
    { x: 3.0, z: 17.0, r: 4.0, rake: [-0.14, 0.24], gain: 0.66, seed: 63 },
  ];
  const HEIGHT = 27;

  /**
   * One patch of floor the vault let light onto.
   *
   * NOT a circle with a smooth falloff. A hole in a roof lit by a
   * point source ninety million miles away throws a patch with the
   * hole's own ragged shape and a penumbra a few centimetres wide -
   * so the outline is irregular and the rim is nearly hard, and both
   * of those are the whole point. A soft disc adds brightness to a
   * frame; a shaped patch with a rim adds brightness AND an edge.
   *
   * Built as a triangle fan by hand rather than from CircleGeometry
   * because the radius has to vary per vertex and the bright core
   * needs its own ring - a two-ring fan is what makes the falloff
   * land as a plateau and a lip rather than as a cone.
   */
  const pool = (gain, radius, seed, cx, cz) => {
    const SIDES = 22;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((1 + SIDES * 2) * 3);
    const col = new Float32Array((1 + SIDES * 2) * 3);
    const idx = [];
    const jitter = (n) => {
      /* Deterministic and seeded, like everything else procedural in
         this project - two runs of the gallery have to photograph the
         same floor or the diff measures the noise. */
      const s = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const put = (i, x, z, v) => {
      pos[i * 3] = x; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = z;
      col[i * 3] = v; col[i * 3 + 1] = v * 0.90; col[i * 3 + 2] = v * 0.70;
    };
    /* 0.56 at the core. At 0.86 the pool was measurably OVER the
       reference: mean luminance 113 against a Halo pool whose
       brightest frame is 108, a 99th percentile of 242 against a
       band ending at 234, and 2.3% blown against 1.1%. A boss frame
       that fails for being too bright is still a boss frame that
       fails, and the fix is the light's level rather than the
       animal's - the armour under it was already reading.

       AND NOT TRIMMED AGAIN. A further cut to 0.49 was tried and
       measured, and it bought four RMS-contrast points at the cost
       of the two metrics that were actually failing: edge density
       6.96 -> 6.51 and micro detail 4.61 -> 4.27. Mean luminance did
       not move at all (94.2 -> 95.4), which is the useful part of
       that result - between runs the boss stands somewhere slightly
       different and the frame's exposure moves more from THAT than
       from this number. Past this point the pool is not the lever
       and the round was reverted. */
    put(0, 0, 0, gain * 0.56);
    const shape = [];
    for (let i = 0; i < SIDES; i += 1) {
      const a = (i / SIDES) * TAU;
      /* Elongated as well as ragged: a rib gap is a slot, not a hole,
         and a row of round patches reads as spotlights. */
      const r = radius * (0.58 + jitter(i) * 0.42)
        * (1 + 0.42 * Math.cos(a * 2 + seed));
      shape.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 0; i < SIDES; i += 1) {
      /* Inner ring at 0.80 carries the plateau; the outer is the lip,
         and the gap between them is the penumbra.

         THE PLATEAU IS THE MEASUREMENT. The first version of this
         function put the plateau at 0.72 of a radius that had also
         shrunk, and the gallery came straight back with meanLuma
         46 and a 99th percentile of 94 - the exact numbers the
         BASELINE had, before any of this work. A large soft pool was
         doing almost all of the frame's brightness and nobody had
         said so out loud. The lit AREA is the lever; the ragged rim
         is only what stops it reading as a spotlight. */
      put(1 + i, shape[i][0] * 0.80, shape[i][1] * 0.80, gain * 0.46);
      put(1 + SIDES + i, shape[i][0], shape[i][1], 0);
      /* WOUND FOR AN UPWARD FACE, and this cost a whole gallery
         round. The ring is generated as (cos a, sin a) and dropped
         into (x, z) - and in a right-handed frame a sequence
         increasing in angle across the XZ plane is CLOCKWISE seen
         from above, so the obvious index order builds a floor decal
         whose front face points at the basement. The whole pool set
         rendered as nothing, the frame came back at exactly its
         pre-work luminance, and the change looked inert rather than
         inverted. This project has the same note about a ground quad
         in the ground-FX work; it is apparently a lesson per author. */
      const j = (i + 1) % SIDES;
      idx.push(0, 1 + j, 1 + i);
      idx.push(1 + i, 1 + SIDES + j, 1 + SIDES + i);
      idx.push(1 + i, 1 + j, 1 + SIDES + j);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.translate(cx, floorY + 0.06, cz);
    return geo;
  };

  const shaftGeos = [];
  const poolGeos = [];
  for (const a of APERTURES) {
    /* 22 sides. Fewer and the shell's own polygon edges are visible
       against a dark nave, which is the tell that says "cone" - the
       Choir shaft work landed on the same number for the same
       reason. */
    const cone = new THREE.CylinderGeometry(a.r * 0.34, a.r, HEIGHT, 22, 1, true);
    cone.translate(0, HEIGHT * 0.5, 0);
    /* Vertex alpha carried in COLOUR, because this is one merged
       mesh and a per-shaft opacity would need a per-shaft material
       and therefore a per-shaft draw call. */
    {
      const count = cone.attributes.position.count;
      const colour = new Float32Array(count * 3);
      const pos = cone.attributes.position;
      for (let i = 0; i < count; i += 1) {
        const t = clamp01(pos.getY(i) / HEIGHT);
        /* Brightest a third of the way up and fading at BOTH ends:
           the top is where the aperture is and would otherwise end
           in a hard disc against the sky, and the bottom has to hand
           over to the pool without a seam. */
        /* 0.030, after two passes down from 0.135. A cone shell has
           no way to hide its own straight edges without a view-
           dependent chord term in a shader, and this encounter is
           not spending a program on scenery - so the shaft is taken
           to the brightness at which its outline stops being a drawn
           shape, and the FLOOR POOL below carries the light instead.
           The extra factor of t squared takes the wide bottom edge -
           the longest straight line in the whole thing - to nothing
           before it ever meets the floor. */
        const v = a.gain * 0.030 * t * t
          * (0.25 + 0.75 * Math.sin(Math.PI * clamp01(t * 0.9 + 0.05)));
        colour[i * 3] = v;
        colour[i * 3 + 1] = v * 0.93;
        colour[i * 3 + 2] = v * 0.80;
      }
      cone.setAttribute("color", new THREE.BufferAttribute(colour, 3));
    }
    const tilt = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(a.rake[1], 0, -a.rake[0]));
    cone.applyMatrix4(tilt);
    cone.translate(C.arenaX + a.x, floorY, C.arenaZ + a.z);
    shaftGeos.push(cone);

    /* 2.05 rather than 1.55, because the ragged outline averages 0.79
       of its nominal radius and the area has to come back to where a
       plain disc of 1.55 had it. */
    poolGeos.push(pool(a.gain, a.r * 2.05, a.seed,
      C.arenaX + a.x + a.rake[0] * 2.5, C.arenaZ + a.z - a.rake[1] * 2.5));
  }

  /* Light through the CRACKS between the ribs, which is most of what
     a broken vault actually throws on a floor: a scatter of small
     hard-edged slivers, not four clean discs. Two reasons to have
     them, and the second is measured rather than aesthetic.

     The first is that a ruined roof does not have four holes in it.

     The second is edge density. The gallery frames are shot from
     three metres at a ten-degree pitch, so between a third and a
     half of every one of them is nave flagstone - which is untextured
     merged geometry a metre across and contributes nothing at all to
     the frame's mean gradient. Our baseline measured 5.71 edge
     density against a Halo band that starts at 8.63, and no amount of
     work on a boss occupying a tenth of the frame closes that. A
     scattered light pattern is the one thing this encounter can
     legitimately put on that floor, and each sliver's rim is a real
     luminance step in a place the picture currently has none. */
  const SLIVERS = 15;
  for (let i = 0; i < SLIVERS; i += 1) {
    const ang = (i * 2.399963) % TAU;
    const rr = 6 + ((i * 0.618034) % 1) * 21;
    poolGeos.push(pool(0.36 + ((i * 0.7548) % 1) * 0.28,
      1.5 + ((i * 0.4142) % 1) * 2.6, i * 7 + 3,
      C.arenaX + Math.cos(ang) * rr, C.arenaZ + Math.sin(ang) * rr));
  }

  const merge = (list) => {
    const out = new THREE.BufferGeometry();
    const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const idx = [];
    let base = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, base * 3);
      col.set(g.attributes.color.array, base * 3);
      const gi = g.getIndex();
      if (gi) for (let i = 0; i < gi.count; i += 1) idx.push(gi.getX(i) + base);
      else for (let i = 0; i < g.attributes.position.count; i += 1) idx.push(i + base);
      base += g.attributes.position.count;
      g.dispose();
    }
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setIndex(idx);
    out.computeBoundingSphere();
    return out;
  };

  const makeMat = (name, side) => {
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side,
      toneMapped: true,
    });
    m.name = name;
    /* Additive, so it fades to BLACK with distance rather than
       toward the sky - fading a light shaft toward the sky colour is
       how it ends up brightest a kilometre away. The near fade in
       the same block is what stops the shell painting itself across
       the frame when the player walks inside it. */
    patchBasicMaterial(m, atmos, 1.0, true);
    return m;
  };

  /* BACK FACES ONLY. On DoubleSide the camera adds the near shell to
     the far one, which doubles the gain exactly where the cone is
     already brightest - at its silhouette - and the first pass came
     back with four pale trapezoids standing in the nave with visible
     straight edges. That is the "hard-edged white chevron" this
     project has already rejected once. One shell is a volume; two is
     a wall. */
  const shafts = new THREE.Mesh(merge(shaftGeos),
    makeMat("sf-apostate-vault-shaft", THREE.BackSide));
  shafts.name = "apostate-vault-shafts";
  shafts.renderOrder = 3;
  shafts.userData.noCollide = true;
  shafts.frustumCulled = true;
  group.add(shafts);

  /* DoubleSide as well as the corrected winding. A pool is one flat
     layer lying on a floor, so only one of its faces can ever be
     visible and the second costs no fill - and the alternative is a
     silent disappearance that reads as "the change did nothing". */
  const pools = new THREE.Mesh(merge(poolGeos),
    makeMat("sf-apostate-vault-pool", THREE.DoubleSide));
  pools.name = "apostate-vault-pools";
  pools.renderOrder = 2;
  pools.userData.noCollide = true;
  group.add(pools);

  /* Motes. The one cheap thing on this list that adds real
     sub-facet detail to the FRAME rather than to the animal, and
     the reason a shaft reads as air rather than as a cone: 260
     points, one draw, animated on the CPU because 260 sine
     evaluations a frame is cheaper than a shader that has to be
     compiled, warmed and cache-keyed. */
  /* 620, up from 260, and spread over the whole arena rather than
     only inside the four cones. Two thirds of them are still in a
     shaft - that is where dust is visible - but the rest carry a
     faint suspension across the nave, and the reason is the same
     measured one as the slivers: a mote is a two-pixel luminance
     spike, which is exactly what a mean-|laplacian| detail metric
     counts, and the nave floor supplies none. */
  const MOTES = 620;
  const motes = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MOTES * 3);
    const seed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i += 1) {
      const a = APERTURES[i % APERTURES.length];
      const ang = (i * 2.399963) % TAU;
      const inShaft = i % 3 !== 2;
      const rr = Math.sqrt(((i * 0.618034) % 1)) * (inShaft ? a.r * 1.1 : 30);
      const ox = inShaft ? a.x : 0;
      const oz = inShaft ? a.z : 0;
      pos[i * 3] = C.arenaX + ox + Math.cos(ang) * rr;
      pos[i * 3 + 1] = floorY + 0.6 + ((i * 0.7548) % 1) * (HEIGHT * 0.62);
      pos[i * 3 + 2] = C.arenaZ + oz + Math.sin(ang) * rr;
      seed[i] = (i * 1.618034) % TAU;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.arenaX, floorY + HEIGHT * 0.4, C.arenaZ), 60);
    const mat = new THREE.PointsMaterial({
      color: 0xffe6c2,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    });
    mat.name = "sf-apostate-vault-motes";
    const points = new THREE.Points(geo, mat);
    points.name = "apostate-vault-motes";
    points.userData.noCollide = true;
    return { points, geo, pos, seed, base: pos.slice() };
  })();
  group.add(motes.points);

  ctx.scene.add(group);

  return {
    group,
    /** Which of the apertures a world position stands in, 0..1. The
     *  encounter reads this so the boss's own rim can answer the
     *  light it is standing in instead of ignoring it. */
    litAt(x, z) {
      let best = 0;
      for (const a of APERTURES) {
        const d = Math.hypot(x - (C.arenaX + a.x), z - (C.arenaZ + a.z));
        best = Math.max(best, a.gain * (1 - clamp01(d / (a.r * 1.62))));
      }
      return best;
    },
    setLive(live) {
      if (group.visible === live) return;
      group.visible = live;
    },
    update(elapsed) {
      if (!group.visible) return;
      const p = motes.pos;
      const b = motes.base;
      for (let i = 0; i < MOTES; i += 1) {
        const s = motes.seed[i];
        const t = elapsed * 0.11 + s;
        p[i * 3] = b[i * 3] + Math.sin(t * 1.7) * 0.42;
        /* Drifting DOWN and wrapping, because dust in a shaft falls.
           Rising motes read as embers, which is the Censer Works'
           language and not this one. */
        p[i * 3 + 1] = b[i * 3 + 1]
          - ((elapsed * 0.22 + s * 3.3) % (HEIGHT * 0.62));
        p[i * 3 + 2] = b[i * 3 + 2] + Math.cos(t * 1.31) * 0.42;
      }
      motes.geo.attributes.position.needsUpdate = true;
    },
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
  const { THREE, atmos, enemies, collide } = ctx;
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
  const vault = makeVaultLight(ctx, groundAt(C.arenaX, C.arenaZ));
  const weapon = ctx.weapons?.cloneVisual?.("autogun");
  if (!weapon?.root) throw new Error("The Apostate could not mirror the Censer-Lance visual.");
  weapon.root.name = "apostate-censer-lance";
  figure.weaponMount.add(weapon.root);
  /* `cloneVisual` hands back one material per archetype shared across
     every mesh that uses it, and the traversal below visits each mesh.
     Without this the kit would be applied to the same material five
     times, and the second call would warn and early-return. */
  const weaponSurfaced = new Set();
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
         flattened those ramps into the untextured neon shape seen in play,
         so the painted values are rebuilt through a ramp instead of being
         multiplied by a pale tint (which left the shaft green).

         THE RAMPS ARE NO LONGER VIOLET. The lance is the largest single
         object in every gallery framing - it spans nearly half the frame -
         so painting it the same chitin as the body made the whole picture
         one hue and one value, which is the failure the art direction names
         first. It is the PLAYER'S censer-lance, and it keeps the player's
         material language: blackened iron structure, tarnished gold brass,
         cyan only in the living chambers and the muzzle flare. That is
         where a third of the frame's warm accent now comes from. */
      if (!isFlash && node.isMesh) {
        if (name === "sf-emissive") {
          repaintVertexRamp(THREE, node, 0x1f7d6c, 0xa9ffe8, "bio-cyan");
        } else if (name === "sf-gold" || name === "sf-bronze") {
          repaintVertexRamp(THREE, node, 0x3a2a10, 0xf7d998, "tarnished-leaf");
        } else if (name === "sf-cloth") {
          repaintVertexRamp(THREE, node, 0x2a1522, 0x7d4f68, "fleshy-cloth");
        } else {
          repaintVertexRamp(THREE, node, 0x0e1014, 0x9aa2b6, "blackened-iron");
        }
      }
      if (material.color) {
        if (isFlash) material.color.set(PALETTE.bioCyan);
        else if (node.userData.apostatePalette) material.color.set(0xffffff);
        else if (name === "sf-emissive") material.color.set(PALETTE.bioCyan);
        else material.color.set(SKIN.plate);
      }
      if (material.emissive) {
        material.emissive.set(0x140f1a);
        material.emissiveIntensity = 0.06;
      }
      material.needsUpdate = true;
      /* The lance goes through the kit too, and it is the best
         showcase in the encounter: a haft is a long cylinder held
         across the frame, which is the one shape a travelling
         specular lobe is unmistakable on. Basic materials (the
         emissive chambers, the flare) are skipped - the kit's blocks
         read `normal` and `roughnessFactor`, neither of which a
         MeshBasicMaterial declares, and it would not compile. */
      if (!isFlash && !material.isMeshBasicMaterial && !weaponSurfaced.has(material.uuid)) {
        weaponSurfaced.add(material.uuid);
        if (name === "sf-gold" || name === "sf-bronze") {
          material.roughness = 0.26;
          material.metalness = 0.32;
          material.envMapIntensity = 1.3;
          resurface(material, atmos, "bronze", { rim: 1.25 });
        } else if (name === "sf-cloth") {
          material.roughness = 0.86;
          material.metalness = 0.02;
          resurface(material, atmos, "hide", { rim: 0.6 });
        } else {
          material.roughness = 0.44;
          material.metalness = 0.26;
          resurface(material, atmos, "bronze", { rim: 1.05, wear: 0.20 });
        }
      }
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
    phase: "dormant",       // dormant -> reveal -> duel -> descent -> duel -> dead
    /* WHICH POOL IS BEING SPENT. One is the Cathedral duel; two is
       the same brain, the same verbs and a bigger pool in the room
       under it - see undercroft.js. The stage is durable because the
       bar's name, the health scale and whether a lethal hit kills or
       collapses the floor all read it. */
    stage: 1,
    /* The Cathedral pool, remembered across the collapse so phase
       two can be a multiple of it rather than of itself. */
    stageOneMax: 0,
    /* Set only while the collapse owns the body. `poseFigure` uses it
       INSTEAD of ground-plus-altitude, because during the fall there
       is deliberately no ground to be a height above. */
    descentY: null,
    pendingDescent: false,
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

    /* --- presentation only, and deliberately NOT in the snapshot ---
       Every field below decays to rest inside a second and none of
       them changes a hit, a timing or a position. A save that carried
       them would be a save that can fail validation over a flinch. */
    corrupt: 0,          // 0..1, how far the Bloom has taken the armour
    surfaced: -1,        // last damage value written to the kit
    flinch: 0,           // amplitude of the current hit reaction
    flinchX: 0,          // where it came from, in body space
    flinchZ: 0,
    flinchY: 0,          // high hit or low hit
    recoil: 0,           // lance kick, per shot
    landAbsorb: 0,       // knees taking a landing
    strideParity: 0,     // which foot the last plant was
    stridePhase: 0,
    deathImpact: false,
  };

  /* Ichor. "Blood that lands and stains" is axis 4 of the brief, and
     the shared impact pool has no violet in it - its tint bands are
     the Concord's gold, the Coulter's green and five doctrine hues,
     none of which is the Bloom. Rather than ask for an eighth band in
     a file six other agents are editing, the encounter carries its
     own: ONE InstancedMesh, twenty-four stains, one draw call.

     They do not fade. A stain that fades is a decal with a timer; the
     brief asks for damage that accumulates and STAYS, and the pool
     recycling oldest-first is the only limit that should exist. */
  const ichor = (() => {
    const MAX = 24;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(64, 64)
      : Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
    const g2d = canvas.getContext && canvas.getContext("2d");
    let map = null;
    if (g2d) {
      const grad = g2d.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g2d.fillStyle = grad;
      g2d.fillRect(0, 0, 64, 64);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const mat = new THREE.MeshBasicMaterial({
      name: "sf-apostate-ichor",
      color: 0x2a0f36,
      map,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    patchBasicMaterial(mat, atmos, 0.72, false);
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.name = "apostate-ichor-stains";
    mesh.userData.noCollide = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    ctx.scene.add(mesh);
    const m4 = new THREE.Matrix4();
    let cursor = 0;
    let placed = 0;
    return {
      mesh,
      clear() { placed = 0; cursor = 0; mesh.count = 0; mesh.visible = false; },
      stain(x, z, scale = 1) {
        const y = groundAt(x, z) + 0.035;
        m4.makeRotationY((cursor * 2.399963) % TAU);
        m4.scale(new THREE.Vector3(scale, 1, scale));
        m4.setPosition(x, y, z);
        mesh.setMatrixAt(cursor, m4);
        cursor = (cursor + 1) % MAX;
        placed = Math.min(MAX, placed + 1);
        mesh.count = placed;
        mesh.visible = true;
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
  })();

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

  /* ============================================================
     THE BODY'S ANSWER TO BEING HIT

     Three separate things the brief asks for and this encounter did
     not have: a flinch that respects WHERE it was hit, damage that
     accumulates and STAYS, and ichor that lands.
     ============================================================ */

  /**
   * Advance the corruption and the surface damage together.
   *
   * They are one number on purpose. The Bloom growing out of the
   * seams and the plate cracking open are the same event seen from
   * two sides, and the moment they were driven by two curves the
   * boss had horns at 40% health and clean armour at 10%.
   *
   * Written only when it has actually moved. `setSurfaceDamage` is a
   * uniform write and a cheap one, but the growth loop underneath is
   * eleven matrix updates and there is no reason to spend them on a
   * frame where nothing changed.
   */
  function advanceCorruption(force = false) {
    const want = state.phase === "dead" ? 1 : corruptionOf(inst);
    state.corrupt = want;
    if (!force && Math.abs(want - state.surfaced) < 0.01) return;
    state.surfaced = want;
    for (const material of corruption.hurtMaterials) setSurfaceDamage(material, want);
    for (const node of corruption.growthNodes) {
      const threshold = node.userData.apostateThreshold || 0;
      /* Each bud opens over its own 30% of the pool, so the growth
         creeps across the armour through the fight instead of the
         whole set inflating together. */
      const t = clamp01((want - threshold) / 0.30);
      const eased = t * t * (3 - 2 * t);
      node.scale.setScalar(Math.max(0.0001, 0.22 + eased * 1.05));
    }
    /* The brood light in the thorax answers the same curve. It is a
       prewarmed scene light, so this is an intensity write and not a
       new light entering the scene - which would recompile every
       material in the Cathedral on the frame the boss got hurt. */
    if (figure.heartLight) {
      figure.heartLight.userData.apostateRequestedIntensity = 0.28 + want * 1.35;
    }
    if (corruption.bio) corruption.bio.emissiveIntensity = 2.8 + want * 2.6;
  }

  /**
   * Record a hit so the body can answer it.
   *
   * The direction is stored in BODY space, not world space, because
   * the flinch is applied to the chest and head after the yaw has
   * been written - a world-space shove would slide around the torso
   * as the boss turned to face the player mid-reaction.
   */
  function noteHit(request, damage) {
    const hx = Number(request.x);
    const hy = Number(request.y);
    const hz = Number(request.z);
    if (!Number.isFinite(hx) || !Number.isFinite(hz)) return;
    const ox = Number.isFinite(request.originX) ? request.originX : hx;
    const oz = Number.isFinite(request.originZ) ? request.originZ : hz;
    let dx = hx - ox;
    let dz = hz - oz;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) { dx = Math.sin(inst.yaw); dz = Math.cos(inst.yaw); }
    else { dx /= length; dz /= length; }
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    state.flinchZ = dx * s + dz * c;          // along the boss's forward
    state.flinchX = dx * c - dz * s;          // across it
    state.flinchY = Number.isFinite(hy)
      ? clamp((hy - (inst.y + 1.05)) / 0.8, -1, 1) : 0;
    /* Scaled by the BITE, not by the raw request: a chip does not
       stagger a boss and a rite should. Capped well under 1 so the
       reaction never fights the action pose it lands during. */
    const bite = clamp01(damage / Math.max(1, inst.maxHealth * 0.012));
    state.flinch = Math.min(0.85, state.flinch * 0.55 + 0.22 + bite * 0.5);
    /* Only a real bite gets its own spray. Combat already emits an
       impact for every hit, so an unconditional second one here
       doubles the particle count of a six-round burst for no read at
       all - and the pool is 512 slots recycled oldest-first, so the
       cost of that is other people's effects disappearing. */
    if (Number.isFinite(hy) && bite > 0.25) {
      ctx.vfx?.spark?.(hx, hy, hz, 0.45 + bite * 0.6, false, false);
    }
    /* Ichor drops where the hit was, not where the boss is: a stain
       under a body that has since walked away is what makes the
       floor read as a record of the fight. */
    if (bite > 0.35) ichor.stain(hx + state.flinchX * 0.3, hz, 0.55 + bite * 0.7);
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
        /* The arena is a different size underground. Reading the live
           chamber's own containment radius rather than restating it
           keeps a Call from silently failing at the hive's rim, which
           is exactly where the boss spends the second phase. */
        const cap = ctx.undercroft?.active?.()
          ? (ctx.undercroft.config?.keepIn ?? C.arenaRadius) - 3
          : C.arenaRadius - 2;
        if (Math.hypot(px - C.arenaX, pz - C.arenaZ) > cap) return false;
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
    /* Every round moves the weapon and the shoulder. A six-round
       burst fired from a lance that does not move is the single
       clearest "this is a prop" tell in the encounter, and the
       player's own lance has had recoil since it was built. */
    state.recoil = Math.min(1, state.recoil + 0.72);
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
      ctx.vfx?.boostImpact?.(contactX, groundAt(contactX, contactZ) + 0.9, contactZ,
        Math.sin(inst.yaw), Math.cos(inst.yaw), true);
      ctx.player?.doctrineKick?.(0.34, 0.4);
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
        /* THE encounter's heaviest footfall, and the one place the
           shake budget is spent. Scaled by range so a slam across the
           nave is a rumble and a slam at the player's feet is a
           blow - a fixed amplitude reads as a scripted camera. */
        {
          const range = Math.hypot(ps.x - inst.x, ps.z - inst.z);
          ctx.player?.doctrineKick?.(0.85 * (1 - clamp01(range / (C.slamRadius * 2.4))), 1);
          state.landAbsorb = 1;
        }
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
    /* During the collapse the floor is being taken away underneath
       this body, so "ground plus altitude" is the one expression that
       cannot describe where it is. The cinematic writes an absolute
       height instead and this is the only place that reads it. */
    inst.y = state.descentY === null ? baseY + state.altitude : state.descentY;
    const speedN = clamp01(inst.speed / Math.max(1, C.walkSpeed));
    const walk = Math.sin(inst.stride * 2.9) * 0.48 * speedN;

    /* --- the death, staged as a physical event -------------------
       It was one linear rotation to -0.47pi over 2.2 seconds, which
       is a body being turned rather than a body falling. A fall has
       three beats and the brief asks for all of them: the knees go
       first, the mass topples after them and accelerates, and then it
       LANDS - once, audibly, with the floor answering - and settles.
       The landing is fired exactly once from `deathImpact`, because a
       restore into a dead phase re-enters this function and a second
       shockwave from a corpse is worse than none. */
    const dead = state.phase === "dead";
    const deathAge = dead ? state.timer : 0;
    const buckle = dead ? clamp01(deathAge / 0.40) : 0;
    const topple = dead ? clamp01((deathAge - 0.30) / 0.58) : 0;
    const landed = dead ? clamp01((deathAge - 0.88) / 0.55) : 0;
    if (dead && !state.deathImpact && deathAge >= 0.86 && state.altitude <= 0.6) {
      state.deathImpact = true;
      const y = groundAt(inst.x, inst.z);
      ctx.vfx?.blast?.(inst.x, y + 0.18, inst.z, 2.6);
      ctx.vfx?.skidMark?.(inst.x, inst.z, inst.yaw + Math.PI * 0.5, 0.9, 1.3);
      ichor.stain(inst.x, inst.z, 1.5);
      ichor.stain(inst.x + Math.sin(inst.yaw) * 0.8, inst.z + Math.cos(inst.yaw) * 0.8, 1.0);
      const range = Math.hypot(ctx.player.state.x - inst.x, ctx.player.state.z - inst.z);
      ctx.player?.doctrineKick?.(0.55 * (1 - clamp01(range / 26)), 1);
      bus.emit("corpseLanded", { x: inst.x, y, z: inst.z });
    }

    /* --- decay the presentation channels -------------------------
       All of them are first-order and all of them are frame-rate
       independent through `damp`, because the gallery steps this at
       a fixed 1/60 and the game does not. */
    state.recoil = damp(state.recoil, 0, 11, dt);
    state.flinch = damp(state.flinch, 0, 7.5, dt);
    state.landAbsorb = damp(state.landAbsorb, 0, 8, dt);

    /* --- footfalls -----------------------------------------------
       The walk cycle is a sine on distance travelled, so a foot
       plants every time it crosses a half-period. Detecting it off
       the PHASE rather than off a timer is what keeps the dust under
       the boot when the boss strafes, boosts and walks at three
       different speeds inside one action.

       Two metres of armoured trooper is not a nine-metre animal, so
       the camera answer is deliberately small and it is scaled by
       range: at ten metres a footstep is a texture, not an event.
       The slam and the boost impact are where this encounter spends
       its shake. */
    if (speedN > 0.18 && state.altitude <= 0.05 && state.phase === "duel") {
      const phase = inst.stride * 2.9;
      const half = Math.floor(phase / Math.PI);
      if (half !== state.stridePhase) {
        state.stridePhase = half;
        state.strideParity ^= 1;
        const side = state.strideParity ? 1 : -1;
        const px = inst.x + Math.cos(inst.yaw) * side * 0.19;
        const pz = inst.z - Math.sin(inst.yaw) * side * 0.19;
        ctx.vfx?.footprint?.(px, pz, inst.yaw, state.strideParity, 0.34 + speedN * 0.5);
        const range = Math.hypot(ctx.player.state.x - inst.x, ctx.player.state.z - inst.z);
        if (range < 11) {
          ctx.player?.doctrineKick?.(0.05 * speedN * (1 - range / 11), 0.85);
        }
      }
    }

    for (let i = 0; i < 2; i += 1) {
      figure.legPivots[i].quaternion.copy(bind.legs[i]);
      figure.kneePivots[i].quaternion.copy(bind.knees[i]);
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (i ? -walk : walk));
      figure.legPivots[i].quaternion.multiply(q);
      /* Knees also take the landing absorb, which is what makes a
         plunge land instead of stopping. */
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0),
        Math.max(0, (i ? walk : -walk)) * 0.55 + state.landAbsorb * 0.55
        + buckle * 0.95);
      figure.kneePivots[i].quaternion.multiply(q);
    }
    figure.chest.quaternion.copy(bind.chest);
    figure.head.quaternion.copy(bind.head);

    /* --- anticipation and recovery -------------------------------
       The simulation has no windup phase and must not grow one: the
       cadences, reaches and hit frames are balanced and a fight-timing
       change is a gameplay change. So the anticipation is carved out
       of the action's OWN window, purely in the pose.

       A melee swing was `sin(t * PI)`, which is symmetric - it has
       neither a wind-back nor a follow-through, and a symmetric
       swing is the thing that reads as an animation loop rather than
       as a blow. It is now three-phase against the authored hit
       frame: load back, strike through it, and hang in the
       follow-through while the body catches up. */
    let coil = 0;
    let lean = 0;
    if (action === "boost") {
      coil = 1 - clamp01(state.actionElapsed / 0.14);
      lean = -0.34 * (1 - coil * 0.4);
    } else if (action === "jet") {
      coil = 1 - clamp01(state.actionElapsed / 0.16);
      lean = -0.10;
    } else if (action?.startsWith("melee")) {
      const spec = C.melee[state.meleeStep];
      const t = clamp01(state.actionElapsed / Math.max(0.01, spec.duration));
      const hit = clamp01(spec.hit / Math.max(0.01, spec.duration));
      lean = t < hit ? -0.16 * (t / Math.max(0.01, hit)) : 0.22 * (1 - (t - hit) / (1 - hit));
    } else if (action === "summon" || action === "vent") {
      lean = 0.08;
    }
    lean -= state.landAbsorb * 0.24;
    /* Recoil sits on the chest as well as on the lance. A weapon
       that kicks on a body that does not is a prop being waggled. */
    lean += state.recoil * 0.09;
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean - coil * 0.20);
    figure.chest.quaternion.multiply(q);
    /* The hit reaction, in body space: a shot in the chest folds it,
       a shot from the side twists it, a headshot snaps the head. */
    if (state.flinch > 0.002) {
      q.setFromEuler(euler.set(
        state.flinch * (0.16 + state.flinchY * 0.10) * state.flinchZ,
        state.flinch * -0.20 * state.flinchX,
        state.flinch * 0.12 * state.flinchX));
      figure.chest.quaternion.multiply(q);
    }

    const ps = ctx.player.state;
    const dy = ps.y + 1.25 - (inst.y + 1.70);
    const horizontal = Math.max(1, Math.hypot(ps.x - inst.x, ps.z - inst.z));
    q.setFromEuler(euler.set(clamp(-Math.atan2(dy, horizontal), -0.32, 0.32), 0, 0));
    figure.head.quaternion.multiply(q);
    if (state.flinch > 0.002) {
      q.setFromEuler(euler.set(
        state.flinch * 0.34 * Math.max(0, state.flinchY) * state.flinchZ,
        state.flinch * -0.26 * state.flinchX, 0));
      figure.head.quaternion.multiply(q);
    }

    /* The player carry pose, then authored deltas for the mirrored actions.
       The weapon drives both hands through the same two-joint IK solver. */
    weapon.root.position.set(0.050, -0.225, 0.185);
    weapon.root.rotation.set(0.02, -0.03, 0.22);
    /* Straight back along the haft and a muzzle rise, which is the
       shape of a recoil and not a shake. */
    weapon.root.position.z -= state.recoil * 0.085;
    weapon.root.rotation.z += state.recoil * 0.11;
    if (action?.startsWith("melee")) {
      const spec = C.melee[state.meleeStep];
      const t = clamp01(state.actionElapsed / Math.max(0.01, spec.duration));
      const hit = clamp01(spec.hit / Math.max(0.01, spec.duration));
      /* -1 loaded, 0 at the hit frame, +1 fully followed through. */
      const swept = t < hit
        ? -((1 - (t / Math.max(0.01, hit))) ** 2)
        : Math.sin(clamp01((t - hit) / (1 - hit)) * Math.PI * 0.62);
      const reach = Math.max(0, swept);
      weapon.root.position.x += lerp(-0.14, 0.30, t) * (0.35 + reach);
      weapon.root.position.y += 0.20 * reach - 0.10 * Math.max(0, -swept);
      weapon.root.rotation.y += (state.meleeStep === 1 ? -1.35 : 1.0) * (swept * 0.5 + 0.5);
      weapon.root.rotation.z += (state.meleeStep === 2 ? -1.0 : 0.56) * (swept * 0.5 + 0.5);
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
    /* Accelerating, then arrested: a topple squared reads as mass,
       a topple linear reads as a hinge. The small negative on the
       settle is the shoulder rocking back once after contact. */
    const toppled = dead
      ? -Math.PI * 0.47 * (topple * topple * (3 - 2 * topple))
        + Math.sin(landed * Math.PI) * 0.055
      : 0;
    inst.root.rotation.set(
      action === "jet" ? clamp(-state.altitude * 0.018, -0.14, 0) : 0,
      inst.yaw,
      dead ? toppled : action === "boost" ? -0.10 : 0
    );
    /* The knees taking the body down before it falls. Without this
       the figure pivots about its boots and the fall has no weight. */
    if (dead) inst.root.position.y -= buckle * 0.28 * (1 - topple * 0.5);
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

    /* Wings. They open on the airborne verbs and, once the corruption
       is well advanced, they no longer fully close - the Bloom has
       taken the shoulder and the plates cannot lie flat over it. On
       death they collapse, which is most of what makes the corpse
       read as a corpse from behind. */
    const wingOpen = dead ? 0.06
      : (action === "jet" ? 0.76 : action === "summon" ? 0.46 : 0.14)
        + state.corrupt * 0.18;
    const flutter = dead ? 0
      : action === "jet" ? Math.sin(state.elapsed * 36) * 0.075
        : action === "summon" ? Math.sin(state.elapsed * 18) * 0.035
          /* Secondary motion at rest. A wing that is perfectly still
             on a breathing body is a decal; this is small enough that
             it is never the read and large enough that it is never
             frozen. */
          : Math.sin(state.elapsed * 1.7) * 0.012;
    for (const wing of corruption.wingPivots) {
      const targetYaw = wing.side * (wingOpen + flutter);
      /* Slower than the body on purpose. Lag IS the secondary motion:
         at the old rate of 12 the wings arrived with the shoulder and
         four rigid plates moved as one object. */
      wing.node.rotation.y = damp(wing.node.rotation.y, targetYaw, 6.5, dt);
      wing.node.rotation.z = damp(wing.node.rotation.z,
        dead ? wing.side * -0.5 : -state.recoil * 0.12 - state.flinch * 0.10, 5.0, dt);
    }
    corruption.abdomen.rotation.x = Math.sin(state.elapsed * 2.2) * 0.035
      + state.flinch * 0.16 * state.flinchZ + (dead ? buckle * 0.22 : 0);
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

  /* ============================================================
     PHASE TWO

     The pool empties and the floor does not hold. Three entry points,
     and between them the undercroft owns the body for about eight
     seconds; nothing else in this file changes.

     WHY THE KILL IS INTERCEPTED IN `modifyIncomingDamage` RATHER
     THAN AT ZERO HEALTH. combat.js's `applyDamage` treats health
     reaching zero as a death outright: it calls `enemies.kill`,
     increments the player's kill count, emits `kill` and awards
     progression. All four of those are wrong for a phase change, and
     none of them can be taken back afterwards. The one place that
     sees the hit BEFORE the pool is written is the damage hook this
     encounter already owns, so the lethal blow is floored at one
     point of health there and the collapse is armed instead.
     ============================================================ */
  function beginDescent() {
    if (state.phase === "descent") return false;
    state.phase = "descent";
    state.pendingDescent = false;
    state.timer = 0;
    state.descentY = null;
    state.stageOneMax = inst.maxHealth;
    state.stage = 2;
    clearAction();
    inst.stunTime = 0;
    inst.grounded = false;
    /* The Cathedral's brood does not come down with you. They were
       called into a nave that no longer has a floor, and leaving them
       in `enemies.live` would drop a garrison eighty-eight metres
       onto the fight the moment the override went live. */
    dismissOwnedThreats("collapse");
    bus.emit("descent", { x: inst.x, y: inst.y, z: inst.z });
    return true;
  }

  /** Absolute placement while the cinematic owns the body. */
  function driveDescent(x, y, z, yaw) {
    if (state.phase !== "descent") return false;
    if (Number.isFinite(x)) inst.x = x;
    if (Number.isFinite(z)) inst.z = z;
    if (Number.isFinite(y)) state.descentY = y;
    if (Number.isFinite(yaw)) inst.yaw = yaw;
    inst.grounded = false;
    return true;
  }

  /** Land, and open the second pool. */
  function enterHive(x, z, yaw) {
    state.phase = "duel";
    state.stage = 2;
    state.descentY = null;
    state.altitude = 0;
    state.disengageFor = 0;
    state.timer = 0;
    clearAction();
    if (Number.isFinite(x)) inst.x = x;
    if (Number.isFinite(z)) inst.z = z;
    inst.grounded = true;
    inst.stunTime = 0;
    /* A MULTIPLIER ON WHAT THE TIER ALREADY DECIDED, never a number.
       difficulty.js scales `maxHealth` at spawn, so an absolute pool
       here would quietly hand every tier the same second phase and
       undo Martyr for the last fight in the game. */
    const scale = ctx.undercroft?.config?.healthScale ?? 1.15;
    inst.maxHealth = Math.max(1,
      Math.round((state.stageOneMax || inst.maxHealth) * scale));
    /* Starts at one and is filled by the reveal - see the note in
       undercroft.js's `stepSettle`. */
    inst.health = 1;
    inst.state = "idle";
    if (Number.isFinite(yaw)) inst.yaw = yaw;
    else facePlayer(99, 1);
    setEncounterGate(false, false);
    bus.emit("phaseTwo", { x: inst.x, z: inst.z, maxHealth: inst.maxHealth });
    return true;
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
      state.deathImpact = false;
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
    /* The vault light is scenery and it is GATED. A dormant boss must
       cost nothing - the Stylite's dormant pose solve once cost this
       game 1.3ms a frame and surfaced as a different boss failing its
       budget - so nothing here is drawn, and the motes are not
       stepped, until the encounter is actually live. */
    vault.setLive(state.phase !== "dormant");
    vault.update(state.elapsed);
    advanceCorruption();
    updateHeat(d);
    /* THE FLOOR, BEFORE THE FUNERAL. A lethal hit in the Cathedral is
       floored at one point of health by `modifyIncomingDamage` and
       arms this instead; if the room under the nave refuses for any
       reason - no module, already spent - the arm is dropped and the
       ordinary death below runs on the next frame. */
    if (state.pendingDescent) {
      state.pendingDescent = false;
      if (ctx.undercroft?.begin?.()) {
        beginDescent();
      } else {
        inst.health = 0;
      }
    }
    if (state.phase === "descent") {
      /* The cinematic owns position, height and yaw. Everything here
         does is keep the body posed while it is being moved. */
      poseFigure(d);
      return;
    }
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
    if (targetInst !== inst) return damage;
    /* This is combat's ONE authoritative entry for a hit on the
       Apostate, which makes it the only place that can see every
       shot, swing, shockwave and command blast in one signature.
       The flinch is recorded here rather than in the aegis branch
       below, because a blocked hit still shoves the body - it was
       previously invisible that the shield had eaten anything. */
    /* Untouchable while the floor is falling. `untouchable()` in
       combat.js reads `encounterLocked`, which the collapse
       deliberately does NOT set - the boss has to stay visible and
       shootable-at all the way down, it just must not take a hit. */
    if (state.phase === "descent") return 0;
    if (state.phase !== "duel") return damage;
    /* ARMING THE COLLAPSE. See the note on `beginDescent`: this is
       the last point in the pipeline that sees a hit before the pool
       is written, and therefore the only one that can stop a lethal
       blow from becoming an actual death with a kill count and a
       progression award attached to it. */
    if (state.stage === 1 && !state.pendingDescent
      && damage >= inst.health && ctx.undercroft?.available?.()) {
      state.pendingDescent = true;
      noteHit(request, damage);
      return Math.max(0, inst.health - 1);
    }
    noteHit(request, damage);
    if (!state.shieldActive) return damage;
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
      stage: state.stage,
      descending: state.phase === "descent",
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
      corruption: Number(state.corrupt.toFixed(3)),
      lit: Number(vault.litAt(inst.x, inst.z).toFixed(3)),
      model: {
        asset: figure.assetSource,
        corrupted: true,
        featureCount: corruption.wings.length + corruption.spikes.length + 3,
        /* Triangle counts per armour zone, so a harness can tell a
           successful atlas read from the single-material fallback
           without opening a screenshot. */
        zones: corruption.zoneCounts || null,
        surfaces: corruption.hurtMaterials.map(
          (m) => m.userData?.sfSurface?.family || "unsurfaced"),
      },
    };
  }

  function snapshot() {
    return {
      instanceId: inst.id,
      /* The collapse is a two-second cinematic during which save.js
         already refuses to write - the free camera and an airborne
         trooper both block it - so the only phases this can produce
         are the four `restore` has always accepted plus the one it
         now does. Serialising "descent" as "duel" instead would
         reload a boss standing in a nave with no floor. */
      phase: state.phase,
      stage: state.stage,
      stageOneMax: Math.round(state.stageOneMax || 0),
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
    /* "descent" is accepted here and CANONICALISED to the duel it
       resolves into. save.js cannot produce one - the collapse holds
       the free camera up and the trooper off the ground, and both of
       those refuse a write - but a hand-edited or forward-dated file
       must not be able to load a boss into a cinematic that has no
       cinematic left to run. */
    const phases = new Set(["dormant", "reveal", "duel", "descent", "dead"]);
    state.phase = phases.has(saved.phase) ? saved.phase : "dormant";
    if (state.phase === "descent") state.phase = "duel";
    state.stage = Number(saved.stage) === 2 ? 2 : 1;
    state.stageOneMax = Math.max(0, Math.round(Number(saved.stageOneMax) || 0));
    state.descentY = null;
    state.pendingDescent = false;
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
    /* Presentation channels are not serialized, so they are re-derived
       here rather than restored. A load must never arrive mid-flinch,
       and the corrupted armour must match the health that came back
       with the save - `force` because `surfaced` still holds the
       abandoned future's value and would suppress the write. */
    state.flinch = 0;
    state.recoil = 0;
    state.landAbsorb = 0;
    state.deathImpact = state.defeated;
    vault.setLive(state.phase !== "dormant");
    advanceCorruption(true);
    setEncounterGate(state.phase === "dormant", state.phase === "dormant" || state.phase === "reveal"
      || state.defeated);
    poseFigure(0);
    return true;
  }

  function reset() {
    dismissOwnedThreats("reset");
    clearAction();
    state.phase = "dormant";
    state.stage = 1;
    state.stageOneMax = 0;
    state.descentY = null;
    state.pendingDescent = false;
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
    ctx.player?.setFree?.(false);
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
    state.flinch = 0;
    state.recoil = 0;
    state.landAbsorb = 0;
    state.deathImpact = false;
    state.stridePhase = 0;
    /* The stains are the record of ONE fight. Re-arming the encounter
       has to wipe the floor or the second run starts standing in the
       first one's blood. */
    ichor.clear();
    vault.setLive(false);
    advanceCorruption(true);
    ensureSpawned();
    setEncounterGate(true, true);
    poseFigure(0);
    bus.emit("reset", { x: inst.x, z: inst.z });
    return status();
  }

  ensureSpawned();
  advanceCorruption(true);
  poseFigure(0);

  return {
    bus,
    config: C,
    state,
    figure,
    weapon,
    corruption,
    vault,
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
    beginDescent,
    driveDescent,
    enterHive,
    stage: () => state.stage,
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
