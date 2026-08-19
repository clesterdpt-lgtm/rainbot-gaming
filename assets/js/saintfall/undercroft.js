/* ============================================================
   SAINTFALL - THE UNDERCROFT
   The Apostate's second communion, and the room it happens in.

   ------------------------------------------------------------
   WHAT THIS IS

   The Cathedral duel ends the way the operation was always going
   to end: the false saint's pool empties, the nave floor gives out
   underneath both of you, and you arrive together in the thing the
   Bloom has been building under the reliquary crypt for a hundred
   years. The boss does not change model and does not change brain -
   every mirrored verb in apostate.js keeps working, unedited, in a
   new room - and what phase two actually adds is a PLACE and two
   mechanics the surface fight cannot have.

   ------------------------------------------------------------
   THE ONE STRUCTURAL PROBLEM, AND ITS ONE ANSWER

   A height field has no underside. `terrain.heightAt` is the floor
   of this game everywhere: the collision raster is built from it,
   the walking plane is it, foot IK reads it, and every creature's
   `y` is it plus an altitude. There is no y below it, at any x/z,
   ever - which is why the Garner's pit had to be CARVED into the
   height field rather than modelled, and why a cavern (which needs
   a floor and a ceiling over the same x/z) cannot be.

   So the undercroft does not try to be terrain. It publishes an
   OVERRIDE, and `collide.groundHeight` - which is the single choke
   point every one of those consumers already goes through - asks it
   first. While the descent is live and the sample is inside the
   chamber's reach, the answer is the chamber's own floor and the
   terrain above is not consulted at all. Outside that disc, or
   before the collapse, the override returns null and the function
   is exactly what it was.

   That one hook buys the entire room: the player walks on it, the
   boss's `inst.y` sits on it, brood spawn on it, shots stop at it,
   and none of those modules learn that a cavern exists.

   Two consequences worth writing down, because both bit:

   1. THE DISC IS A COLUMN. `groundOverrideAt` takes x and z and has
      no idea what altitude the asker is at, so while it is live the
      surface above the chamber has the chamber's floor too. Nothing
      may be standing up there. `swallow()` takes the collapse disc
      with it (that is the fiction anyway - the nave floor fell), and
      breaches.js is told the whole map is a boss arena for the
      duration so no wave can spawn into a hole.

   2. THE WALL IS THE FLOOR. The chamber's shell is one profile
      function of radius, and the visible mesh is generated FROM that
      function - so the collision and the picture cannot drift apart
      the way a rasterised runtime mesh would (runtime meshes are not
      in the grid at all; this project has the note twice). Past the
      gallery the profile climbs at 2.5 rise over run, which is well
      past player.js's walk gate, and a hard radial clamp behind it
      catches anything that tries to fly the difference.

   ------------------------------------------------------------
   THE CEILING IS TALL ON PURPOSE

   The pack caps the player at ground + 10m (`jetpack.maxAltitude`),
   the Apostate's own jet tops out at 8.2m, and a reared lasher is
   about 16m of limb. The vault apex is at 48m over the pan and the
   hem where it meets the comb wall is at 20m, so the highest thing
   the fight can produce clears the lowest part of the roof by four
   metres and the middle of the room by thirty. Nobody scrapes their
   head, and - the part that actually matters for the picture - the
   room reads as a cathedral rather than as a corridor.

   ------------------------------------------------------------
   LIT WITHOUT ADDING A LIGHT TO THE SCENE

   A light entering a scene recompiles every material in it; this
   project measured 198ms of freeze from exactly that. So the two
   lamps this room wants are created at construction with intensity
   zero and only ever have their intensity written, the same
   contract apostate.js's figure lights use, and everything else is
   emissive geometry plus one additive daylight shaft down the hole
   you fell through. The world's sun is dimmed rather than removed
   (see `sky.setUnderground`), because a boss lit by nothing is a
   silhouette and the corrupted reliquary atlas is the richest
   surface in the game.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, hexToRgb, lerp, makeBus, makeRamp, makeRng,
  srgbToLinear, sstep,
} from "saintfall/core.js";
import {
  PALETTE, paintGeometry, patchBasicMaterial, patchMaterial,
} from "saintfall/art.js";
import { makeKit, cleanGeometry } from "saintfall/structures.js";
import { APOSTATE_CONFIG } from "saintfall/apostate.js";

export const UNDERCROFT_CONFIG = Object.freeze({
  /* Directly beneath the nave arena, and that is load-bearing rather
     than tidy: apostate.js leashes home to `arenaX/arenaZ` and
     breaches.js protects a radius around the same point. Put the
     chamber anywhere else and both of those start measuring to a
     place the fight is not. */
  x: APOSTATE_CONFIG.arenaX,
  z: APOSTATE_CONFIG.arenaZ,

  /* How far under the nave floor the pan sits. Long enough that the
     fall is an event (about three seconds under the player's own
     gravity), short enough that the shaft is a shaft and not a
     credits sequence. */
  depth: 88,

  /* THE SHELL, as radii on one profile.
       pan      flat fighting floor
       gallery  a two-step terrace, walkable, +3.2m
       wall     the comb face, unwalkable by 2.5 rise/run
       seal     keeps climbing past the vault so the room is closed
                and no sky leaks in over the rim */
  panRadius: 42,
  galleryRadius: 54,
  galleryRise: 3.2,
  wallRadius: 70,
  wallRise: 30,
  sealRadius: 88,
  sealRise: 96,

  /* Containment. Two metres inside the wall's foot, so the clamp
     lands where the picture already says "rock". */
  keepIn: 52,
  bossKeepIn: 49,

  /* THE VAULT. `apex` over the pan centre, `hem` where it lands on
     the comb. See the header for why these two numbers are what they
     are and not smaller. */
  apex: 48,
  hem: 20,
  vaultRadius: 62,

  /* THE BREACH - the hole you came through. Off-centre so the shaft
     of daylight rakes across the floor instead of standing in the
     middle of it, and so the fight has a lit half and a dark half. */
  breachX: 13,
  breachZ: -17,
  breachRadius: 9.6,

  /* Where the override stops answering. Nothing can reach past the
     seal, so this only has to be outside it. */
  reach: 92,

  /* ------------------------------------------------------------
     THE CINEMATIC, in seconds. */
  fractureSeconds: 2.4,
  fallSeconds: 3.4,
  settleSeconds: 2.6,
  riseSeconds: 1.6,

  /* ------------------------------------------------------------
     PHASE TWO'S POOL. A multiplier on whatever the difficulty tier
     already decided the boss was worth, never an absolute - the
     tiers scale `maxHealth` at spawn and an absolute here would
     quietly undo Martyr. */
  healthScale: 1.15,

  /* ------------------------------------------------------------
     THE CLUTCH. Smaller pools than the Abbess's because this room
     also fields six lashers and the reason to stand still here is
     supposed to be the tentacles, not the adds. */
  clutchCadence: 13.5,
  clutchEggs: [2, 5],
  eggHatchSeconds: 5.6,
  eggHealth: 90,
  eggMax: 20,
  broodCap: 9,
  /* Laid AROUND THE PLAYER rather than around the queen, which is
     the whole difference between this clutch and the Bloom's: the
     Abbess lays in front of herself and you choose whether to go in,
     the hive lays where you are standing and you have to leave. */
  clutchRing: [7.5, 15.5],

  /* ------------------------------------------------------------
     THE LASHERS. */
  /* EIGHT, ON TWO RINGS, and the second ring is the whole reason the
     mechanic exists rather than decorates. Rooted only at the rim,
     with a reach of fifteen, the limbs covered r 29..59 of a
     forty-two metre pan - which is the outer third, and the Apostate
     holds the player at eight to fifteen metres from itself in the
     MIDDLE of the room. A hazard that cannot reach the fight is a
     draw call. The inner ring erupts out of the fighting floor
     itself, which is also the better read: the ground you are
     standing on is part of the animal. */
  lashers: 8,
  lasherNodes: 14,
  lasherLength: 17.5,
  lasherRoot: 44,
  lasherInnerRoot: 25,
  lasherHealth: 320,
  lasherReach: 17.0,
  lasherDamage: 26,
  lasherCadence: [3.4, 6.2],
  lasherRegrow: 15,
  /* Cut this many and the hive loses hold of the thing it is
     feeding. The window is the fight's damage phase and it is the
     only reason to engage the limbs at all. */
  cutsPerStagger: 3,
  staggerSeconds: 4.5,
});

const C = UNDERCROFT_CONFIG;

/* ============================================================
   THE PROFILE

   One function of radius for the floor, one for the roof, and both
   the mesh and `groundOverrideAt` read them. That is the only way a
   runtime room can have honest collision in this engine: there is no
   rasteriser for meshes built after load, so the picture has to be
   generated from the collision rather than the other way round.
   ============================================================ */

/** Floor height above the chamber datum at radius `r`. */
export function undercroftFloor(r) {
  if (r <= C.panRadius) return 0;
  if (r <= C.galleryRadius) {
    /* Two steps rather than a ramp. A smooth cone reads as a dish and
       gives the eye nothing to measure the room against; a terrace
       says how big it is. Still under a 0.45 grade, so it walks. */
    const t = (r - C.panRadius) / (C.galleryRadius - C.panRadius);
    const stepped = (Math.floor(t * 2) + sstep(0.34, 0.66, (t * 2) % 1)) / 2;
    return stepped * C.galleryRise;
  }
  if (r <= C.wallRadius) {
    const t = (r - C.galleryRadius) / (C.wallRadius - C.galleryRadius);
    return C.galleryRise + sstep(0, 1, t) * C.wallRise;
  }
  if (r >= C.sealRadius) return C.galleryRise + C.wallRise + C.sealRise;
  const t = (r - C.wallRadius) / (C.sealRadius - C.wallRadius);
  return C.galleryRise + C.wallRise + t * t * C.sealRise;
}

/** Roof height above the chamber datum at radius `r`. */
export function undercroftRoof(r) {
  if (r >= C.vaultRadius) return C.hem;
  const t = r / C.vaultRadius;
  /* A catenary-ish fall rather than a hemisphere: the crown stays
     high and flat over the fight and the drop happens out at the
     springing, which is what a groin vault does and what stops the
     roof reading as the inside of a ball. */
  return C.hem + (C.apex - C.hem) * Math.pow(1 - t * t, 1.35);
}

/* ============================================================
   RELIEF

   Low swells across the pan so the floor is not a disc. Deliberately
   SMALLER THAN THE PLAYER'S STEP: the override and the mesh both call
   this, so it cannot drift, but keeping it under a step height means
   it can never change where a swing lands or trip an approach either.
   ============================================================ */
function reliefAt(dx, dz) {
  const a = Math.sin(dx * 0.083 + 1.7) * Math.cos(dz * 0.071 - 0.4);
  const b = Math.sin((dx + dz) * 0.164 + 3.1) * 0.5;
  const c = Math.sin(dx * 0.31 - 2.2) * Math.sin(dz * 0.287 + 0.9) * 0.22;
  return (a * 0.62 + b * 0.24 + c) * 0.30;
}

/* ============================================================
   ORIENTATION, MEASURED RATHER THAN REASONED ABOUT

   This project has now written the same bug three times in three
   files: a ring generated as (cos a, sin a) and dropped into (x, z)
   winds CLOCKWISE seen from above in a right-handed frame, so the
   obvious index order builds a floor whose front face points at the
   basement. It cost the apostate's vault pools a whole gallery round
   and the ground-FX decals another.

   So this does not reason about winding at all. It builds the
   triangles in whatever order, measures which way the majority of
   them actually face against a desired direction sampled at their
   own centroid, and reverses the index buffer if the majority is
   wrong. One pass over the indices at build time, and the class of
   bug stops existing.
   ============================================================ */
function orientGeometry(THREE, geo, wantAt) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) return geo;
  const arr = idx.array;
  let agree = 0;
  let total = 0;
  const ax = new THREE.Vector3();
  const bx = new THREE.Vector3();
  const cx = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const want = new THREE.Vector3();
  for (let i = 0; i + 2 < arr.length; i += 3) {
    ax.fromBufferAttribute(pos, arr[i]);
    bx.fromBufferAttribute(pos, arr[i + 1]);
    cx.fromBufferAttribute(pos, arr[i + 2]);
    e1.subVectors(bx, ax);
    e2.subVectors(cx, ax);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    ax.add(bx).add(cx).multiplyScalar(1 / 3);
    wantAt(ax, want);
    if (want.lengthSq() < 1e-9) continue;
    total += 1;
    if (n.dot(want) > 0) agree += 1;
  }
  if (total > 0 && agree * 2 < total) {
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

/** A radial sheet: rings of `sides` samples, stitched, painted. */
function radialSheet(THREE, { radii, sides, heightAt, colourAt, skip }) {
  const rows = radii.length;
  const pos = new Float32Array(rows * sides * 3);
  const col = new Float32Array(rows * sides * 3);
  const idx = [];
  for (let r = 0; r < rows; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * TAU;
      const x = Math.cos(a) * radii[r];
      const z = Math.sin(a) * radii[r];
      const y = heightAt(radii[r], a, x, z);
      const i = (r * sides + s) * 3;
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      const c = colourAt(radii[r], a, x, z, y);
      col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2];
    }
  }
  for (let r = 0; r + 1 < rows; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const s1 = (s + 1) % sides;
      const a0 = r * sides + s;
      const a1 = r * sides + s1;
      const b0 = (r + 1) * sides + s;
      const b1 = (r + 1) * sides + s1;
      if (skip) {
        const mr = (radii[r] + radii[r + 1]) * 0.5;
        const ma = ((s + 0.5) / sides) * TAU;
        if (skip(mr, ma, Math.cos(ma) * mr, Math.sin(ma) * mr)) continue;
      }
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ============================================================
   MATERIALS

   Two families and nothing else.

   SHELL is lit: standard, faceted, vertex-coloured, patched into the
   world's atmosphere so the room shares the game's rim/fog/grade and
   does not read as a set dropped into it.

   GLOW is not lit: a basic material with vertex colours, which is
   also how this project's shafts, pools and decals work. A cavern
   whose light comes from the walls cannot get that from `emissive`
   on a standard material, because emissive is uniform per material
   and the whole point is that every cell is a slightly different
   value. Basic + vertex colour gives per-vertex brightness for free
   and costs no light in the scene - see the header on why a new
   light is the one thing this room may not do.
   ============================================================ */
function shellMaterial(ctx, name, opts = {}) {
  const { THREE, atmos } = ctx;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: opts.flat !== false,
    roughness: opts.roughness ?? 0.93,
    metalness: opts.metalness ?? 0,
    side: opts.side || THREE.FrontSide,
    envMapIntensity: opts.env ?? 0.10,
  });
  m.name = `sf-undercroft-${name}`;
  patchMaterial(m, atmos, { rim: opts.rim ?? 0.62 });
  return m;
}

function glowMaterial(ctx, name, opts = {}) {
  const { THREE, atmos } = ctx;
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: !!opts.additive,
    depthWrite: opts.additive ? false : true,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side || THREE.FrontSide,
    toneMapped: true,
  });
  m.name = `sf-undercroft-${name}`;
  patchBasicMaterial(m, atmos, opts.fade ?? 0.9, !!opts.additive);
  return m;
}

/* The additive cone that stands in the hole. Same construction and
   the same chord term as the level's own light shafts - a cone shell
   is a lie about a volume, and without dimming it toward its
   silhouette the lie is visible as a hard-edged wedge. */
function shaftMaterial(ctx) {
  const { THREE, atmos } = ctx;
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: true,
  });
  m.name = "sf-undercroft-shaft";
  patchBasicMaterial(m, atmos, 1.0, true);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 aRadial;
varying vec3 vShaftRadial;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  vShaftRadial = aRadial;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vShaftRadial;`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
{
  vec3 sfView = normalize(cameraPosition - vSFWorld);
  gl_FragColor.rgb *= pow(abs(dot(normalize(vShaftRadial), sfView)), 1.5);
}`);
    m.userData.sfShader = shader;
  };
  m.customProgramCacheKey = () => "sf-undercroft-shaft";
  m.needsUpdate = true;
  return m;
}

/* ============================================================
   RAMPS

   The room's palette, spelled out once. Every shaded surface in here
   samples one of these rather than picking a colour at its call
   site, which is the only way six separate builders end up looking
   like one room.
   ============================================================ */
const RIB_RAMP = makeRamp([
  [0.00, PALETTE.chitinDeep],
  [0.45, PALETTE.chitin],
  [0.80, "#6b5a74"],
  [1.00, PALETTE.boneShade],
]);

const COMB_RAMP = makeRamp([
  [0.00, "#1b1220"],
  [0.34, PALETTE.chitinDeep],
  [0.72, PALETTE.chitin],
  [1.00, PALETTE.chitinLit],
]);

/* The warm end, and the only one. Masonry that fell out of a Cathedral
   keeps the Cathedral's colour - which is what makes the rubble read
   as an intruder in this room rather than as more hive. */
const RUBBLE_RAMP = makeRamp([
  [0.00, "#332b33"],
  [0.30, "#5b5049"],
  [0.68, "#8d8072"],
  [1.00, "#b3a692"],
]);

/* The shaft, and it is the one surface in the room the daylight
   actually falls on at full strength. Painted at bone it came back as
   a floodlit cream slab that read as a hole in the frame; a rubbed
   masonry taupe under the same light reads as the underside of a
   Cathedral floor, which is what it is. */
const SHAFT_RAMP = makeRamp([
  [0.00, PALETTE.chitinDeep],
  [0.42, "#3f3340"],
  [0.78, "#5d5049"],
  [1.00, "#6a5c4c"],
]);

/* The limbs. Shell is the room's own resin, one value darker so a
   reared tentacle reads against the wall it came out of; the core is
   the same bio-violet as the comb, because they are the same animal
   and a second hue would say they were not. */
const LASH_SHELL = [0.115, 0.055, 0.155];
const LASH_CORE = [0.62, 0.22, 0.98];

/* THE PAN, and its values are the point rather than its hue.
   `chitin` is a five-percent linear violet: a floor painted at the
   Bloom's own pigment came back BLACK four metres outside the light
   pool, because a room lit at a fifth of the desert's sun cannot
   show a five-percent albedo. Resin that a hive has walked on for a
   century is paler than resin, so this ramp runs from stained plum
   up to a bone-grey crust and every stop is somewhere a dim room can
   actually put a value. */
const PAN_RAMP = makeRamp([
  [0.00, "#31212f"],
  [0.34, "#4a3646"],
  [0.62, "#6d5a5e"],
  [0.86, "#8d7c74"],
  [1.00, "#a89584"],
]);

const EGG_RAMP = makeRamp([
  [0.00, "#4a2b52"],
  [0.55, PALETTE.fleshy],
  [1.00, "#e0a8c4"],
]);

/**
 * Paint every vertex one LINEAR colour, scaled.
 *
 * `paintFlat` in art.js takes an sRGB hex and converts; this takes a
 * linear triple and a gain, because the glow meshes want values ABOVE
 * one (that is what puts them in the bloom pass) and a hex cannot
 * express that. Saturated hues are divided down by their own peak
 * channel first: an additive violet at gain 2 clips red and blue to
 * white and arrives on screen as a grey lamp, which is a mistake this
 * project has already paid for once in the doctrine effects.
 */
function paintFlatLinear(THREE, geo, rgb, gain = 1) {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  /* Normalised by its own brightest channel BEFORE the gain, so the
     brightest channel lands exactly on `gain` and the other two stay
     in proportion to it. Scaling the raw triple instead drives every
     channel past one at high gain and the hue washes out to white. */
  const k = gain / peak;
  const count = geo.attributes.position.count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    col[i * 3] = rgb[0] * k;
    col[i * 3 + 1] = rgb[1] * k;
    col[i * 3 + 2] = rgb[2] * k;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/* ============================================================
   THE CHAMBER

   Built once, at construction, and held `visible = false` until the
   floor gives. Building it lazily would put a geometry build and a
   shader compile on the frame the boss dies, which is the single
   worst frame in the game to spend forty milliseconds on; building
   it here costs about a fifth of a second of load and nothing at all
   afterwards, because Three skips an invisible subtree entirely.

   ART DIRECTION, and it is the level's own rule applied to a room
   the level has never seen: a lot of the neutral, a little of the
   warm, a spot of the saturated.

     a lot     resin-black chitin over the whole shell, cool and
               faceted, which is the separation strategy against the
               Cathedral above it - that district is warm grey-taupe
               masonry, so its underside is cold and organic.
     a little  the crypt the Bloom ate. Bone shelves in the gallery,
               and the nave floor itself lying in pieces under the
               hole - masonry, a snapped corona, the warm end of the
               palette and the only straight lines in the room.
     a spot    bio-violet in the comb, cyan at the veins, and one
               shaft of real daylight down the hole, which is the
               brightest thing in the frame and the only warm light.
   ============================================================ */
function buildChamber(ctx, floorY) {
  const { THREE, atmos } = ctx;
  const kit = makeKit(THREE);
  const rng = makeRng(0x5a1cf0);
  const group = new THREE.Group();
  group.name = "undercroft";
  group.position.set(C.x, floorY, C.z);
  group.visible = false;

  const lin = (hex) => {
    const c = hexToRgb(hex);
    return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
  };
  const RESIN_DEEP = lin(PALETTE.chitinDeep);
  const RESIN = lin(PALETTE.chitin);
  const RESIN_LIT = lin(PALETTE.chitinLit);
  const BONE_MID = lin(PALETTE.boneMid);
  const BONE_SHADE = lin(PALETTE.boneShade);
  const BIO = lin(PALETTE.bioViolet);
  const CYAN = lin(PALETTE.bioCyan);
  const PINK = lin(PALETTE.fleshy);
  const mix3 = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
  ];

  /* ---------------------------------------------------------- floor */

  const floorRadii = [];
  for (let r = 0; r <= C.galleryRadius; r += 2.6) floorRadii.push(r);
  for (let r = C.galleryRadius + 1.4; r <= C.sealRadius; r += 3.1) floorRadii.push(r);
  floorRadii.push(C.sealRadius);
  const SIDES = 60;

  const floorGeo = radialSheet(THREE, {
    radii: floorRadii,
    sides: SIDES,
    heightAt: (r, a, x, z) => undercroftFloor(r) + (r < C.galleryRadius ? reliefAt(x, z) : 0),
    colourAt: (r, a, x, z, y) => {
      /* Wet at the middle and dry at the edges. A hive floor is a
         drain: the resin pools where the eggs are and cakes pale
         where it has been walked on, which also happens to put the
         value contrast exactly where the fight is. */
      const wet = 1 - sstep(6, 34, r);
      const dry = sstep(C.panRadius - 8, C.galleryRadius, r);
      const grain = 0.5 + 0.5 * Math.sin(x * 0.44 + 1.1) * Math.cos(z * 0.39 - 0.7);
      /* THE MIDDLE OF THE ROOM IS WHERE THE FIGHT IS. The first
         version ran `wet` to full at the centre and pulled the ramp
         down by nearly a third there, which painted a black bowl
         exactly under the duel and left the pale crust out at the
         wall where nothing happens. The stain still reads - it is
         worth about a fifth of the range - but it can no longer take
         the floor below something a dim room can show. */
      const t = clamp01(0.44 + dry * 0.34 + grain * 0.20 - wet * 0.16);
      const c = PAN_RAMP.at(t);
      let out = [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
      /* The wall goes darker, because everything above the gallery is
         only ever seen against the glow set into it - but not to the
         pigment either: a black wall behind a lit comb reads as no
         wall at all and the room loses its far edge. */
      out = mix3(out, RESIN_DEEP,
        sstep(C.galleryRadius - 4, C.galleryRadius + 9, r) * 0.84);
      return out;
    },
  });
  orientGeometry(THREE, floorGeo, (p, out) => out.set(0, 1, 0));
  const floorMesh = new THREE.Mesh(floorGeo, shellMaterial(ctx, "floor", {
    roughness: 0.96, rim: 0.5,
  }));
  floorMesh.name = "undercroft-floor";
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  /* ---------------------------------------------------------- vault */

  const vaultRadii = [];
  for (let r = 0; r <= C.vaultRadius; r += 2.8) vaultRadii.push(r);
  vaultRadii.push(C.vaultRadius);
  const breachHere = (x, z) => Math.hypot(x - C.breachX, z - C.breachZ) < C.breachRadius;

  const vaultGeo = radialSheet(THREE, {
    radii: vaultRadii,
    sides: SIDES,
    heightAt: (r, a, x, z) => undercroftRoof(r)
      + Math.sin(a * 7 + r * 0.11) * 0.9 - Math.sin(r * 0.23) * 0.7,
    colourAt: (r, a, x, z) => {
      const up = sstep(C.vaultRadius * 0.35, C.vaultRadius, r);
      const cell = 0.5 + 0.5 * Math.sin(a * 14) * Math.sin(r * 0.42);
      let c = mix3(RESIN_DEEP, RESIN, up * 0.5 + cell * 0.16);
      /* Faint bio bleed near the crown so the roof is not a void. The
         eye needs SOMETHING up there or a forty-eight metre ceiling
         photographs as black sky and the room loses its scale. */
      c = mix3(c, BIO, (1 - up) * 0.10 * (0.4 + cell * 0.6));
      return c;
    },
    skip: (r, a, x, z) => breachHere(x, z),
  });
  orientGeometry(THREE, vaultGeo, (p, out) => out.set(0, -1, 0));
  const vaultMesh = new THREE.Mesh(vaultGeo, shellMaterial(ctx, "vault", {
    roughness: 0.98, rim: 0.9,
  }));
  vaultMesh.name = "undercroft-vault";
  group.add(vaultMesh);

  /* Ribs across the vault. Real geometry rather than painted lines:
     at this span the roof needs something with a silhouette or the
     crown is one unbroken sheet however it is coloured. */
  /* RIBS THAT SPRING, not spokes that meet at a point. Fifteen tubes
     run all the way to r=2.5 converge into a starburst directly over
     the fight - looking up photographed as a bicycle wheel. Real
     vaulting lands its ribs on a boss at the crown and ties them
     together with ring courses part-way down, and both of those are
     what give a ceiling a scale you can read from underneath. */
  const ribGeos = [];
  const RIBS = 12;
  for (let i = 0; i < RIBS; i += 1) {
    const a = (i / RIBS) * TAU + 0.12;
    const pts = [];
    for (let k = 0; k <= 10; k += 1) {
      const t = k / 10;
      const r = lerp(9.5, C.vaultRadius - 0.5, t);
      pts.push([Math.cos(a) * r, undercroftRoof(r) - 0.55, Math.sin(a) * r]);
    }
    /* Thicker where it lands on the comb and thin at the crown, which
       is the way weight actually travels down one of these. */
    ribGeos.push(kit.tube(pts, 0.55, 5, { taper: -0.65 }));
  }
  /* Two ring courses and a crown boss. */
  for (const [ringR, ringT] of [[9.5, 0.85], [30, 0.55], [48, 0.42]]) {
    const pts = [];
    const steps = 34;
    for (let k = 0; k <= steps; k += 1) {
      const a = (k / steps) * TAU;
      pts.push([Math.cos(a) * ringR, undercroftRoof(ringR) - 0.55, Math.sin(a) * ringR]);
    }
    ribGeos.push(kit.tube(pts, ringT, 5));
  }
  ribGeos.push(kit.transform(kit.prism({
    h: 2.6, rBottom: 5.2, rTop: 2.1, sides: 9, segments: 3, bulge: 0.18,
  }), { pos: [0, undercroftRoof(0) - 2.9, 0] }));
  const ribGeo = kit.merge(ribGeos);
  paintGeometry(THREE, ribGeo, RIB_RAMP, (x, y) => clamp01((y - C.hem) / (C.apex - C.hem)));
  const ribMesh = new THREE.Mesh(cleanGeometry(THREE, ribGeo),
    shellMaterial(ctx, "ribs", { roughness: 0.88, rim: 0.5 }));
  ribMesh.name = "undercroft-ribs";
  group.add(ribMesh);

  /* ------------------------------------------------------- the comb */

  /* Where on the wall a given height sits. The profile is monotone
     across the band, so a bisection is exact enough and means the
     cells are placed on the surface the collision actually uses
     rather than on a second guess at where the wall is. */
  const radiusAtHeight = (h) => {
    let lo = C.galleryRadius;
    let hi = C.wallRadius;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) * 0.5;
      if (undercroftFloor(mid) < h) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  };

  const combGeos = [];
  const cellGeos = [];

  /* ONE CELL, AND THE LIGHT FACES THE ROOM.

     The first build sank a capped hexagonal prism two metres into the
     wall and put the lamp at the bottom of it. Two hundred and eighty
     cells later the wall photographed as a field of dark chevrons and
     not one photon of the room's own light reached the frame: a
     recess that deep is only ever seen end-on from one spot on the
     floor, and everywhere else you are looking at its shaded lip.

     So the lamp is now FLUSH - a hexagonal plate on the surface,
     visible from anywhere in the room - and the recess is implied by
     a rim standing proud of it. That is the same trick the game's
     ground decals use, and it costs one prism instead of two. */
  function placeCell(px, py, pz, dir, rr, heat, tint) {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir);
    const rim = kit.prism({
      h: rr * 0.78, rBottom: rr * 1.12, rTop: rr * 0.86,
      sides: 6, segments: 2, jitter: 0.06, seed: rng.int(1, 1e6),
      capTop: false, capBottom: false,
    });
    rim.applyQuaternion(q);
    rim.translate(px - dir.x * rr * 0.26, py - dir.y * rr * 0.26,
      pz - dir.z * rr * 0.26);
    combGeos.push(rim);

    /* PROUD OF THE SURFACE, not behind it. Set at -0.34 along the
       inward normal the plate sat a third of a metre INSIDE the shell
       it was decorating, and the wall's own triangles occluded every
       one of them - the comb came back as dark hexagons with lit rims
       and the room lost its light source. The plate now stands ten
       centimetres out and the rim, which spans further than that,
       still reads as a socket around it. */
    const plate = kit.prism({
      h: 0.24, rBottom: rr * 0.94, rTop: rr * 0.80, sides: 6, segments: 1,
    });
    plate.applyQuaternion(q);
    plate.translate(px + dir.x * 0.06, py + dir.y * 0.06, pz + dir.z * 0.06);
    if (heat <= 0) { combGeos.push(plate); return; }
    paintFlatLinear(THREE, plate, tint, heat);
    cellGeos.push(plate);
  }

  const TIERS = [5.2, 9.4, 13.8, 18.4, 23.2, 27.8];
  for (let t = 0; t < TIERS.length; t += 1) {
    const h = TIERS[t];
    const r = radiusAtHeight(h);
    const slope = (undercroftFloor(r + 0.4) - undercroftFloor(r - 0.4)) / 0.8;
    const inv = 1 / Math.hypot(1, slope);
    const count = Math.max(12, Math.round((TAU * r) / 8.2));
    for (let i = 0; i < count; i += 1) {
      const a = ((i + (t % 2) * 0.5) / count) * TAU + rng.jit(0.03);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      /* Inward-and-up normal of the wall face at this radius. */
      const dir = new THREE.Vector3(-ca * slope * inv, inv, -sa * slope * inv)
        .normalize();
      /* A THIRD OF THEM ARE EMPTY, and the brightest is under half of
         a clipping value. At a peak of one every cell tone-mapped to
         the same pale lavender and the wall read as a switchboard;
         the point of a comb is that most of it is dark and the light
         is where the brood is. */
      placeCell(ca * r, h, sa * r, dir, rng.range(1.5, 2.5),
        rng.chance(0.42) ? 0 : rng.range(0.09, 0.30),
        mix3(BIO, CYAN, rng.range(0, 0.30)));
    }
  }

  /* AND THE SAME CELLS OVERHEAD. A forty-eight metre vault with
     nothing lit on it photographs as open black sky, which is the one
     thing an underground room must never look like - the ceiling is
     what says you are inside something. Clustered rather than
     regular, so the roof reads as growth and the wall reads as
     construction. */
  for (let cluster = 0; cluster < 9; cluster += 1) {
    const ca0 = rng() * TAU;
    const cr0 = rng.range(14, C.vaultRadius - 9);
    for (let i = 0; i < rng.int(5, 11); i += 1) {
      const a = ca0 + rng.jit(0.30);
      const r = clamp(cr0 + rng.jit(7), 10, C.vaultRadius - 4);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (breachHere(x, z)) continue;
      const slope = (undercroftRoof(r + 0.4) - undercroftRoof(r - 0.4)) / 0.8;
      const inv = 1 / Math.hypot(1, slope);
      const dir = new THREE.Vector3(Math.cos(a) * slope * inv, -inv,
        Math.sin(a) * slope * inv).normalize();
      placeCell(x, undercroftRoof(r), z, dir, rng.range(1.6, 2.6),
        rng.chance(0.26) ? 0 : rng.range(0.08, 0.26),
        mix3(BIO, CYAN, rng.range(0, 0.48)));
    }
  }

  const combGeo = cleanGeometry(THREE, kit.merge(combGeos));
  paintGeometry(THREE, combGeo, COMB_RAMP,
    (x, y) => clamp01(0.25 + (y / 30) * 0.7 + Math.sin(x * 0.7) * 0.08), { jitter: 0.20 });
  const combMesh = new THREE.Mesh(combGeo, shellMaterial(ctx, "comb", {
    roughness: 0.9, rim: 0.85,
  }));
  combMesh.name = "undercroft-comb";
  group.add(combMesh);

  const cellMesh = new THREE.Mesh(cleanGeometry(THREE, kit.merge(cellGeos)),
    glowMaterial(ctx, "cells"));
  cellMesh.name = "undercroft-cells";
  group.add(cellMesh);

  /* ------------------------------------------------------- the veins */

  /* Roots running up out of the pan and into the comb. They are the
     one thing that ties the floor to the wall - without them the
     room is a disc with a wallpaper around it - and they are also
     where the room's colour lives at eye level, because the comb
     starts above the player's head. */
  /* ON the wall, not in front of it. The first pass ran these as free
     curves through the air between the player and the comb, and
     twenty-six glowing tubes floating in a cavern read as drinking
     straws. Each sample now solves the wall's own radius for its own
     height and sits fifteen centimetres proud of it, which is what
     makes them a seam in a surface rather than an object in a room. */
  const veinGeos = [];
  const wallRadiusAt = (h) => (h <= C.galleryRise
    ? lerp(C.panRadius, C.galleryRadius, clamp01(h / Math.max(0.01, C.galleryRise)))
    : radiusAtHeight(h));
  for (let i = 0; i < 22; i += 1) {
    const a = (i / 22) * TAU + rng.jit(0.08);
    const wander = rng.jit(0.05);
    const pts = [];
    const foot = -rng.range(4, 13);
    const top = rng.range(9, 27);
    const steps = 11;
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const h = lerp(foot, top, t);
      const aa = a + wander * Math.sin(t * 3.1);
      if (h <= 0) {
        /* The root end runs out across the pan toward the middle of
           the room, which is what says the wall and the floor are
           one animal. */
        const rr = C.panRadius + h;
        pts.push([Math.cos(aa) * rr, undercroftFloor(rr) + reliefAt(
          Math.cos(aa) * rr, Math.sin(aa) * rr) + 0.16, Math.sin(aa) * rr]);
      } else {
        const rr = wallRadiusAt(h) - 0.15;
        pts.push([Math.cos(aa) * rr, h, Math.sin(aa) * rr]);
      }
    }
    const g = kit.tube(pts, rng.range(0.13, 0.24), 5, { taper: 0.45 });
    paintFlatLinear(THREE, g, mix3(CYAN, BIO, rng.range(0.1, 0.8)), rng.range(0.13, 0.34));
    veinGeos.push(g);
  }
  const veinMesh = new THREE.Mesh(cleanGeometry(THREE, kit.merge(veinGeos)),
    glowMaterial(ctx, "veins"));
  veinMesh.name = "undercroft-veins";
  group.add(veinMesh);

  /* -------------------------------------------------- hanging brood */

  const sacShell = [];
  const sacGlow = [];
  for (let i = 0; i < 19; i += 1) {
    const a = rng() * TAU;
    const r = rng.range(6, C.vaultRadius - 8);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (breachHere(x, z)) continue;
    const roof = undercroftRoof(r);
    const len = rng.range(4.5, 11.5);
    const rad = rng.range(1.2, 2.5);
    /* A STALK. Without one these hung in the dark with no visible
       join and photographed as pink petals floating under a black
       roof - the roof is nearly unlit, so the attachment has to be
       drawn or it is not there. */
    const stalk = rng.range(1.4, 4.5);
    const neck = kit.tube([
      [x, roof + 0.3, z],
      [x + rng.jit(0.3), roof - stalk * 0.5, z + rng.jit(0.3)],
      [x, roof - stalk, z],
    ], rng.range(0.28, 0.5), 5, { taper: 0.3 });
    paintFlatLinear(THREE, neck, mix3(RESIN_DEEP, RESIN, 0.4), 0.5);
    sacShell.push(neck);

    const sac = kit.membraneSac(rng, { r: rad, h: len });
    /* Built growing up from y=0; hung by turning it over. */
    sac.rotateX(Math.PI);
    sac.translate(x, roof - stalk, z);
    /* Held down near the resin rather than at the pigment's own
       value: a saturated membrane at full strength is a balloon, and
       twenty-four balloons is a party. The colour is carried by the
       core inside it. */
    paintFlatLinear(THREE, sac, mix3(RESIN, PINK, rng.range(0.12, 0.34)),
      rng.range(0.11, 0.22));
    sacShell.push(sac);

    const core = kit.membraneSac(rng, { r: rad * 0.5, h: len * 0.7 });
    core.rotateX(Math.PI);
    core.translate(x, roof - stalk - 0.7, z);
    paintFlatLinear(THREE, core, mix3(BIO, CYAN, rng.range(0, 0.3)), rng.range(0.24, 0.52));
    sacGlow.push(core);
  }
  const sacMesh = new THREE.Mesh(cleanGeometry(THREE, kit.merge(sacShell)),
    shellMaterial(ctx, "sacs", { roughness: 0.72, rim: 0.65 }));
  sacMesh.name = "undercroft-sacs";
  group.add(sacMesh);
  const sacCoreMesh = new THREE.Mesh(cleanGeometry(THREE, kit.merge(sacGlow)),
    glowMaterial(ctx, "sac-cores"));
  sacCoreMesh.name = "undercroft-sac-cores";
  group.add(sacCoreMesh);

  /* -------------------------------------------------- the fallen nave */

  /* WHAT CAME DOWN WITH YOU, and it is the room's whole story in one
     prop set: the crypt was a reliquary before it was a hive, and the
     floor of the Cathedral is now lying under the hole in pieces.
     Straight lines and warm stone, which also happens to be the only
     contrast in a room that is otherwise curves and cold violet. */
  const rubbleGeos = [];
  for (let i = 0; i < 44; i += 1) {
    const a = rng() * TAU;
    const r = Math.abs(rng.gauss()) * 12 + rng.range(0, 6);
    const x = C.breachX + Math.cos(a) * r;
    const z = C.breachZ + Math.sin(a) * r;
    if (Math.hypot(x, z) > C.panRadius - 3) continue;
    const w = rng.range(0.9, 3.6);
    const h = rng.range(0.4, 1.5);
    const d = rng.range(0.8, 3.2);
    const slab = kit.slab(w, h, d, Math.min(w, d) * 0.06);
    kit.transform(slab, {
      pos: [x, undercroftFloor(Math.hypot(x, z)) + reliefAt(x, z) - h * 0.15, z],
      rot: [rng.jit(0.42), rng() * TAU, rng.jit(0.42)],
    });
    rubbleGeos.push(slab);
  }
  /* Two arcs of a snapped corona - the rings that hung over the nave.
     Broken, half-buried and leaning, because a whole one reads as
     scenery placed here rather than as something that fell. */
  for (let i = 0; i < 2; i += 1) {
    const pts = [];
    const a0 = rng() * TAU;
    const span = rng.range(1.5, 2.4);
    const rad = rng.range(9, 13);
    for (let k = 0; k <= 11; k += 1) {
      const a = a0 + (k / 11) * span;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.22, Math.sin(a) * rad]);
    }
    const arc = kit.tube(pts, rng.range(0.55, 0.85), 6);
    kit.transform(arc, {
      pos: [C.breachX + rng.jit(11), 0.5 + rng.range(0, 1.4), C.breachZ + rng.jit(11)],
      rot: [rng.jit(0.5), rng() * TAU, 0.4 + rng.jit(0.35)],
    });
    rubbleGeos.push(arc);
  }
  const rubbleGeo = cleanGeometry(THREE, kit.merge(rubbleGeos));
  paintGeometry(THREE, rubbleGeo, RUBBLE_RAMP,
    (x, y, z) => clamp01(0.32 + y * 0.16 + Math.sin(x * 0.9 + z * 0.7) * 0.22),
    { jitter: 0.24 });
  const rubbleMesh = new THREE.Mesh(rubbleGeo, shellMaterial(ctx, "rubble", {
    roughness: 0.9, rim: 0.55,
  }));
  rubbleMesh.name = "undercroft-rubble";
  rubbleMesh.receiveShadow = true;
  group.add(rubbleMesh);

  /* ----------------------------------------------------- the breach */

  /* The shaft you came down. Open at the top, which is the point: the
     one place in this room you can see real sky from, and the reason
     the daylight in here is daylight rather than another lamp. */
  const shaftRings = [];
  const shaftTop = C.depth + 3;
  const shaftBottom = undercroftRoof(Math.hypot(C.breachX, C.breachZ)) - 1.5;
  for (let k = 0; k <= 10; k += 1) {
    const t = k / 10;
    shaftRings.push({
      y: lerp(shaftBottom, shaftTop, t),
      /* RAGGED, and it has to be. A smooth tapering tube standing in
         a black ceiling photographs as a pale trapezoid hung in the
         room - a flat panel, not a hole. The radius wobbles by a
         quarter and every ring is jittered, so the daylight arrives
         through a broken floor rather than through a lampshade. */
      r: C.breachRadius * lerp(1.06, 0.68, t) * (1 + Math.sin(t * 5.1 + k) * 0.22),
      sides: 13,
      phase: t * 1.4,
      jitter: 0.30,
      seed: 4001 + k * 37,
      cx: C.breachX + Math.sin(t * 2.2) * 1.3,
      cz: C.breachZ + Math.cos(t * 1.7) * 1.1,
    });
  }
  const shaftGeo = kit.ringSolid(shaftRings, { capTop: false, capBottom: false });
  orientGeometry(THREE, shaftGeo, (p, out) => out.set(C.breachX - p.x, 0, C.breachZ - p.z));
  paintGeometry(THREE, shaftGeo, SHAFT_RAMP,
    (x, y) => clamp01((y - shaftBottom) / Math.max(1, shaftTop - shaftBottom)),
    { jitter: 0.22 });
  /* FRONT FACES ONLY, and `orientGeometry` above has already turned
     them to face the axis. Drawn DoubleSide the tube's OUTSIDE is
     visible from the floor - a pale cone hanging through the ceiling,
     which photographed as a lit sheet of cloth rather than as a hole.
     Culled to its interior, the only thing the room can see of it is
     the throat receding upward toward daylight. */
  /* THE TORN LIP, and it is what turns the shaft from a lit panel
     into a hole. The tube's interior is the brightest surface in the
     room by a wide margin, and where it meets an unlit black ceiling
     the join is a clean trapezoid - the eye reads a clean bright
     trapezoid as a screen, whatever is painted on it. Two dozen
     shards of the broken floor still hanging off the rim break that
     silhouette, catch the daylight on their undersides, and put
     something in front of the light that is obviously ROCK. */
  const collarGeos = [shaftGeo];
  {
    const rBreach = Math.hypot(C.breachX, C.breachZ);
    const lip = undercroftRoof(rBreach);
    for (let i = 0; i < 22; i += 1) {
      const a = (i / 22) * TAU + rng.jit(0.09);
      const rr = C.breachRadius * rng.range(0.94, 1.26);
      const x = C.breachX + Math.cos(a) * rr;
      const z = C.breachZ + Math.sin(a) * rr;
      const drop = rng.range(1.6, 6.5);
      const shard = kit.prism({
        h: drop, rBottom: rng.range(0.5, 1.7), rTop: rng.range(0.05, 0.35),
        sides: rng.int(4, 6), segments: 2, jitter: 0.22, seed: rng.int(1, 1e6),
      });
      shard.rotateX(Math.PI);
      kit.transform(shard, {
        pos: [x, lip + rng.range(0.2, 1.6), z],
        rot: [rng.jit(0.34), rng() * TAU, rng.jit(0.34)],
      });
      collarGeos.push(shard);
    }
  }
  const shaftMesh = new THREE.Mesh(
    cleanGeometry(THREE, kit.merge(collarGeos.map((g, i) => {
      if (i === 0) return g;
      paintGeometry(THREE, g, SHAFT_RAMP, (x, y) => clamp01(0.18
        + (y - undercroftRoof(Math.hypot(C.breachX, C.breachZ))) * 0.09), { jitter: 0.3 });
      return g;
    }))),
    shellMaterial(ctx, "shaft", { roughness: 0.94, rim: 0.7 }));
  shaftMesh.name = "undercroft-shaft-wall";
  group.add(shaftMesh);

  /* ------------------------------------------------------- daylight */

  /* One cone of lit air standing in the hole, and the room's key.
     Wide at the top and wider at the bottom, windowed to nothing at
     both ends, and dimmed toward its own silhouette by the chord term
     in `shaftMaterial` so a cone shell does not read as a wedge of
     solid pale. The peak is 0.30 of the tint: this project has the
     note twice that a shaft is a small amount of dust catching a lot
     of sun, and that at 0.9 they render as plates. */
  const CONE_SIDES = 22;
  const CONE_STEPS = 12;
  const conePos = new Float32Array((CONE_STEPS + 1) * CONE_SIDES * 3);
  const coneCol = new Float32Array((CONE_STEPS + 1) * CONE_SIDES * 3);
  const coneRad = new Float32Array((CONE_STEPS + 1) * CONE_SIDES * 3);
  const coneIdx = [];
  const DAY = lin("#ffe6b4");
  const coneTop = shaftBottom + 7;
  const coneBottom = -0.2;
  for (let k = 0; k <= CONE_STEPS; k += 1) {
    const t = k / CONE_STEPS;
    const y = lerp(coneTop, coneBottom, t);
    /* The sun is low on this planet, so the beam LEANS. Taken off the
       live sun bearing once at build time rather than tracked: the
       chamber exists for one fight, and a cone that re-writes its
       buffers every few seconds to follow an eighteen-minute day is
       spending frames on something nobody in this room can see the
       source of. */
    const lean = t * 13.5;
    const cx = C.breachX - atmos.sunDir.x * lean;
    const cz = C.breachZ - atmos.sunDir.z * lean;
    const rr = C.breachRadius * lerp(0.72, 1.55, t);
    /* 0.13, not 0.30. The shell is DoubleSide, so every pixel outside
       the silhouette is the far wall plus the near wall - the cone
       arrives on screen at twice whatever this says, and at 0.30 it
       photographed as a cream curtain hanging in the room rather than
       as lit air. The level's own shafts carry the same note at a
       different number for the same reason. */
    const bright = sstep(0, 0.22, t) * (1 - sstep(0.55, 1, t)) * (1 - t * 0.45) * 0.13;
    for (let s = 0; s < CONE_SIDES; s += 1) {
      const a = (s / CONE_SIDES) * TAU;
      const rx = Math.cos(a);
      const rz = Math.sin(a);
      const i = (k * CONE_SIDES + s) * 3;
      conePos[i] = cx + rx * rr; conePos[i + 1] = y; conePos[i + 2] = cz + rz * rr;
      coneRad[i] = rx; coneRad[i + 1] = 0; coneRad[i + 2] = rz;
      coneCol[i] = DAY[0] * bright;
      coneCol[i + 1] = DAY[1] * bright;
      coneCol[i + 2] = DAY[2] * bright;
    }
  }
  for (let k = 0; k < CONE_STEPS; k += 1) {
    for (let s = 0; s < CONE_SIDES; s += 1) {
      const s1 = (s + 1) % CONE_SIDES;
      const a0 = k * CONE_SIDES + s;
      const a1 = k * CONE_SIDES + s1;
      const b0 = (k + 1) * CONE_SIDES + s;
      const b1 = (k + 1) * CONE_SIDES + s1;
      coneIdx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute("position", new THREE.BufferAttribute(conePos, 3));
  coneGeo.setAttribute("color", new THREE.BufferAttribute(coneCol, 3));
  coneGeo.setAttribute("aRadial", new THREE.BufferAttribute(coneRad, 3));
  coneGeo.setIndex(coneIdx);
  const coneMesh = new THREE.Mesh(coneGeo, shaftMaterial(ctx));
  coneMesh.name = "undercroft-daylight";
  coneMesh.renderOrder = 7;
  group.add(coneMesh);

  /* The patch the shaft actually lands on. A hole in a roof lit by a
     source ninety million miles away throws a patch with the hole's
     own ragged outline and a penumbra a few centimetres wide, so this
     is a two-ring fan with a plateau and a lip rather than a soft
     disc - a soft disc adds brightness, a shaped patch adds
     brightness AND an edge. Same construction as the nave's pools
     above, which is deliberate: it is the same sun through the same
     broken vault, one floor further down. */
  const poolX = C.breachX - atmos.sunDir.x * 13.5;
  const poolZ = C.breachZ - atmos.sunDir.z * 13.5;
  const POOL_SIDES = 24;
  const poolPos = new Float32Array((1 + POOL_SIDES * 2) * 3);
  const poolCol = new Float32Array((1 + POOL_SIDES * 2) * 3);
  const poolIdx = [];
  const poolPut = (i, x, z, v) => {
    poolPos[i * 3] = x;
    poolPos[i * 3 + 1] = undercroftFloor(Math.hypot(x, z)) + reliefAt(x, z) + 0.07;
    poolPos[i * 3 + 2] = z;
    poolCol[i * 3] = v; poolCol[i * 3 + 1] = v * 0.90; poolCol[i * 3 + 2] = v * 0.68;
  };
  poolPut(0, poolX, poolZ, 0.15);
  const poolShape = [];
  for (let i = 0; i < POOL_SIDES; i += 1) {
    const a = (i / POOL_SIDES) * TAU;
    const jr = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const rr = C.breachRadius * 1.65 * (0.62 + Math.abs(jr) * 0.38)
      * (1 + 0.30 * Math.cos(a * 2 + 1.1));
    poolShape.push([poolX + Math.cos(a) * rr, poolZ + Math.sin(a) * rr]);
  }
  for (let i = 0; i < POOL_SIDES; i += 1) {
    const j = (i + 1) % POOL_SIDES;
    poolPut(1 + i, poolX + (poolShape[i][0] - poolX) * 0.78,
      poolZ + (poolShape[i][1] - poolZ) * 0.78, 0.095);
    poolPut(1 + POOL_SIDES + i, poolShape[i][0], poolShape[i][1], 0);
    poolIdx.push(0, 1 + j, 1 + i);
    poolIdx.push(1 + i, 1 + POOL_SIDES + j, 1 + POOL_SIDES + i);
    poolIdx.push(1 + i, 1 + j, 1 + POOL_SIDES + j);
  }
  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute("position", new THREE.BufferAttribute(poolPos, 3));
  poolGeo.setAttribute("color", new THREE.BufferAttribute(poolCol, 3));
  poolGeo.setIndex(poolIdx);
  orientGeometry(THREE, poolGeo, (p, out) => out.set(0, 1, 0));
  const poolMesh = new THREE.Mesh(poolGeo, glowMaterial(ctx, "pool", {
    additive: true, fade: 1.0,
  }));
  poolMesh.name = "undercroft-pool";
  poolMesh.renderOrder = 6;
  group.add(poolMesh);

  /* --------------------------------------------------------- lamps */

  /* TWO, AND BOTH ARE BORN AT ZERO. A light entering a scene
     recompiles every material in it - this project measured 198ms of
     freeze from exactly that, on the frame the Apostate first raised
     its shield - so these are created here, at load, and the only
     thing that ever happens to them afterwards is an intensity
     write. */
  /* The daylight, where it lands. DECAY 2 - a real inverse square -
     rather than the 1.7 this started at: at 1.7 with a 78m range the
     patch of wall thirty metres away was still receiving most of the
     lamp and photographed as cream sandstone, which is what turned a
     shaft of light into a floodlit set. */
  const keyLight = new THREE.PointLight(0xffdca8, 0, 38, 2.0);
  keyLight.name = "undercroft-key";
  keyLight.position.set(poolX, 5.5, poolZ);
  keyLight.castShadow = false;
  group.add(keyLight);
  const hiveLight = new THREE.PointLight(0x8f5ce0, 0, 110, 1.35);
  hiveLight.name = "undercroft-hive";
  hiveLight.position.set(0, 18, 0);
  hiveLight.castShadow = false;
  group.add(hiveLight);
  /* AND A FILL, because the alternative is a black floor. The world's
     own hemisphere is turned down to almost nothing while the player
     is under the map (see `sky.setUnderground`), and a cave lit only
     by point sources loses everything outside their falloff - the
     first build's fighting pan measured pure black four metres from
     the light pool. This is the room's answer to its own sky: violet
     from the comb above, near-black from the resin below. Born at
     zero like the other two, for the same reason. */
  const fill = new THREE.HemisphereLight(0x6b46a8, 0x140c18, 0);
  fill.name = "undercroft-fill";
  group.add(fill);

  ctx.scene.add(group);

  const glowMeshes = [cellMesh, veinMesh, sacCoreMesh];
  let pulse = 0;

  return {
    group,
    floorMesh,
    keyLight,
    hiveLight,
    poolMesh,
    coneMesh,
    poolAt: { x: poolX, z: poolZ },
    counts: {
      cells: cellGeos.length,
      veins: veinGeos.length,
      sacs: sacShell.length,
      rubble: rubbleGeos.length,
    },
    setLive(on) {
      if (group.visible === on) return;
      group.visible = on;
      keyLight.intensity = on ? 22 : 0;
      hiveLight.intensity = on ? 34 : 0;
      fill.intensity = on ? 1.55 : 0;
    },
    /** The hive breathes. One colour write per glow mesh - the
     *  material's own `color` multiplies the vertex colours, so a
     *  whole wall of cells pulses without touching a buffer. */
    update(elapsed, dt, heat = 0) {
      if (!group.visible) return;
      pulse = damp(pulse, 0.86 + Math.sin(elapsed * 0.9) * 0.12
        + Math.sin(elapsed * 2.3 + 1.4) * 0.05 + heat * 0.45, 6, dt);
      for (const m of glowMeshes) m.material.color.setScalar(pulse);
      hiveLight.intensity = 34 * pulse + heat * 22;
      fill.intensity = 1.55 * (0.84 + pulse * 0.20);
    },
  };
}

/* ============================================================
   THE ENCOUNTER
   ============================================================ */
export function buildUndercroft(ctx) {
  const { THREE, atmos, enemies } = ctx;
  const bus = makeBus();
  const rng = makeRng(0x11ce7a);

  const surfaceY = ctx.collide?.groundHeight?.(C.x, C.z)
    ?? ctx.terrain?.groundHeightAt?.(C.x, C.z)
    ?? ctx.terrain.heightAt(C.x, C.z);
  const floorY = surfaceY - C.depth;

  const chamber = buildChamber(ctx, floorY);

  const state = {
    /* idle -> fracture -> fall -> settle -> live -> spent */
    phase: "idle",
    timer: 0,
    elapsed: 0,
    fallY: surfaceY,
    fallSpeed: 0,
    used: false,
    cuts: 0,
    totalCuts: 0,
    unmooredFor: 0,
    clutchTimer: C.clutchCadence * 0.55,
    clutchClosed: false,
    heat: 0,
    swallowed: 0,
    landedAt: 0,
    elapsedInPhase: 0,
  };

  const live = () => state.phase === "fall" || state.phase === "settle"
    || state.phase === "live";

  /* ============================================================
     THE OVERRIDE

     `collide.groundHeight` asks this first and takes the answer
     whole when it is a number. Everything in the header about a
     height field having no underside comes down to these thirty
     lines being the room's actual floor - the mesh above is a
     picture of what this function returns.
     ============================================================ */
  function groundOverrideAt(x, z) {
    if (!live()) return null;
    const dx = x - C.x;
    const dz = z - C.z;
    const r = Math.hypot(dx, dz);
    if (r > C.reach) return null;
    const chamberY = floorY + undercroftFloor(r)
      + (r < C.galleryRadius ? reliefAt(dx, dz) : 0);
    /* DURING THE FALL THE FLOOR RUNS AWAY. Rather than scripting the
       drop against the player controller - which owns gravity,
       grounding, foot plants and the slope gate, and would have to be
       fought for every one of them - the ground itself is held a
       couple of metres under the falling pair and released onto the
       real chamber floor when it arrives. Nothing has to be told a
       cutscene is happening; there is simply nothing to stand on. */
    if (state.phase === "fall") return Math.max(chamberY, state.fallY - 2.6);
    return chamberY;
  }

  /** World-space floor of the chamber, whether or not it is live. */
  const chamberFloorAt = (x, z) => {
    const dx = x - C.x;
    const dz = z - C.z;
    const r = Math.hypot(dx, dz);
    return floorY + undercroftFloor(r) + (r < C.galleryRadius ? reliefAt(dx, dz) : 0);
  };

  /* ============================================================
     CONTAINMENT

     The comb wall is unwalkable by its own gradient - past the
     gallery the profile climbs at about 2.5 rise over run and
     player.js refuses anything over 1.7 - but the pack can fly ten
     metres and a boss on a jet can cross a metre of that per frame.
     A hard radial clamp two metres inside the wall's foot is what
     actually guarantees nobody leaves, and at that radius the picture
     already says rock, so the stop reads as the wall it is.
     ============================================================ */
  function contain(obj, limit) {
    const dx = obj.x - C.x;
    const dz = obj.z - C.z;
    const r = Math.hypot(dx, dz);
    if (r <= limit || r < 1e-4) return false;
    obj.x = C.x + (dx / r) * limit;
    obj.z = C.z + (dz / r) * limit;
    return true;
  }

  /* ============================================================
     WHAT THE COLLAPSE TAKES WITH IT

     The override is a COLUMN: it answers for an x/z whatever altitude
     the asker is at, so while the chamber is live the nave above it
     has the chamber's floor too and anything standing up there would
     be reading its ground eighty-eight metres down. That is also
     exactly what the fiction says happens, so the collapse simply
     takes them - and breaches.js is separately told to treat the map
     as a boss arena for the duration so no wave can arrive into a
     hole that is no longer a floor.
     ============================================================ */
  function swallow() {
    const boss = ctx.apostate?.instance?.();
    let taken = 0;
    for (const inst of [...enemies.live]) {
      if (inst === boss) continue;
      if (Math.hypot(inst.x - C.x, inst.z - C.z) > C.reach) continue;
      ctx.combat?.clearProjectiles?.(inst.id);
      if (enemies.remove?.(inst)) taken += 1;
    }
    state.swallowed = taken;
    return taken;
  }

  /* ============================================================
     THE CLUTCH

     The Bloom's queen lays in an arc in front of herself and the
     player decides whether to walk into it. The hive lays AROUND
     YOU, which is the same object doing the opposite job: the Abbess
     asks you to come in, this asks you to leave. That is what makes
     a clutch worth having in a room that also has six tentacles -
     the eggs move the player and the lashers punish the movement.

     They are NOT enemies: no rig, no brain, no place in
     `enemies.live`. combat.js cannot route damage to them, so this
     module publishes a sphere test and every damage path that can
     reach the ground calls it - see `hitProps`.
     ============================================================ */
  const EGG_SIDES = 7;
  const EGG_RINGS = 4;
  const EGG_VERTS = EGG_RINGS * EGG_SIDES + 2;
  const eggGeo = new THREE.BufferGeometry();
  const eggPos = new Float32Array(C.eggMax * EGG_VERTS * 3);
  const eggCol = new Float32Array(C.eggMax * EGG_VERTS * 3);
  {
    const idx = [];
    for (let e = 0; e < C.eggMax; e += 1) {
      const base = e * EGG_VERTS;
      const bot = base;
      const top = base + EGG_VERTS - 1;
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const s1 = (s + 1) % EGG_SIDES;
        idx.push(bot, base + 1 + s1, base + 1 + s);
        for (let r = 0; r + 1 < EGG_RINGS; r += 1) {
          const a0 = base + 1 + r * EGG_SIDES + s;
          const a1 = base + 1 + r * EGG_SIDES + s1;
          const b0 = base + 1 + (r + 1) * EGG_SIDES + s;
          const b1 = base + 1 + (r + 1) * EGG_SIDES + s1;
          idx.push(a0, a1, b1, a0, b1, b0);
        }
        idx.push(top, base + 1 + (EGG_RINGS - 1) * EGG_SIDES + s,
          base + 1 + (EGG_RINGS - 1) * EGG_SIDES + s1);
      }
    }
    eggGeo.setAttribute("position", new THREE.BufferAttribute(eggPos, 3));
    eggGeo.setAttribute("color", new THREE.BufferAttribute(eggCol, 3));
    eggGeo.setIndex(idx);
  }
  const eggMat = shellMaterial(ctx, "eggs", { flat: false, roughness: 0.52, rim: 1.35 });
  eggMat.emissive = new THREE.Color(0x3a1450);
  eggMat.emissiveIntensity = 1.0;
  const eggMesh = new THREE.Mesh(eggGeo, eggMat);
  eggMesh.name = "undercroft-eggs";
  eggMesh.frustumCulled = false;
  eggMesh.visible = false;
  chamber.group.add(eggMesh);

  const eggs = [];
  for (let i = 0; i < C.eggMax; i += 1) {
    eggs.push({ live: false, x: 0, y: 0, z: 0, t: 0, hp: 0, burst: 0,
      caste: "thresher", seed: rng(), base: i * EGG_VERTS });
  }
  let eggCursor = 0;
  let eggsDirty = false;
  const brood = [];

  function writeEgg(egg) {
    const grown = egg.live
      ? lerp(0.36, 1.05, Math.pow(clamp01(egg.t), 0.7))
      : egg.burst > 0 ? lerp(1.45, 0.02, 1 - egg.burst / 0.22) : 0;
    const rr = grown * 1.05;
    const hh = grown * 1.55;
    const tint = egg.caste === "gleaner"
      ? [0.13, 0.62, 0.30] : EGG_RAMP.at(0.55 + egg.seed * 0.4);
    const c = egg.caste === "gleaner" ? tint : [
      srgbToLinear(tint[0]), srgbToLinear(tint[1]), srgbToLinear(tint[2]),
    ];
    const ripe = egg.live ? clamp01(egg.t) : 0;
    const put = (i, x, y, z) => {
      const o = (egg.base + i) * 3;
      eggPos[o] = x; eggPos[o + 1] = y; eggPos[o + 2] = z;
      /* The one that is about to split is the fat pale one, and it
         says so before it says it. */
      eggCol[o] = c[0] * (0.7 + ripe * 0.9);
      eggCol[o + 1] = c[1] * (0.7 + ripe * 0.55);
      eggCol[o + 2] = c[2] * (0.7 + ripe * 0.75);
    };
    put(0, egg.x, egg.y, egg.z);
    for (let r = 0; r < EGG_RINGS; r += 1) {
      const t = (r + 1) / (EGG_RINGS + 1);
      const ry = egg.y + t * hh;
      const rad = rr * Math.sin(Math.pow(t, 0.78) * Math.PI) * (0.92 + egg.seed * 0.2);
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const a = (s / EGG_SIDES) * TAU + r * 0.22 + egg.seed * 6;
        put(1 + r * EGG_SIDES + s,
          egg.x + Math.cos(a) * rad, ry, egg.z + Math.sin(a) * rad);
      }
    }
    put(EGG_VERTS - 1, egg.x, egg.y + hh, egg.z);
  }

  function pruneBrood() {
    for (let i = brood.length - 1; i >= 0; i -= 1) {
      const kid = brood[i];
      if (!kid || kid.state === "death" || kid.health <= 0
        || !enemies.live.includes(kid)) brood.splice(i, 1);
    }
  }

  function hatchEgg(egg) {
    egg.live = false;
    pruneBrood();
    if (brood.length >= C.broodCap) {
      ctx.vfx?.spark?.(egg.x, egg.y + 0.5, egg.z, 1.4, false, false);
      return null;
    }
    const kid = enemies.spawn(egg.caste, egg.x, egg.z, {
      yaw: rng() * TAU,
      emerge: { delay: 0, duration: 0.8, depth: 1.0 },
    });
    if (!kid) return null;
    kid.alerted = true;
    kid.suspicion = 1;
    /* Owned by the boss, so victory's own cleanup finds them: the
       Apostate already dismisses everything carrying its id. */
    const boss = ctx.apostate?.instance?.();
    if (boss) {
      kid.eventId = boss.id;
      if (!Array.isArray(boss.broodKids)) boss.broodKids = [];
      boss.broodKids.push(kid);
    }
    brood.push(kid);
    ctx.vfx?.blast?.(egg.x, egg.y + 0.4, egg.z, egg.caste === "gleaner" ? 3.2 : 2.4);
    bus.emit("hatch", { x: egg.x, y: egg.y, z: egg.z, caste: egg.caste });
    return kid;
  }

  function killEgg(egg, x, y, z) {
    egg.burst = 0.22;
    egg.live = false;
    ctx.vfx?.blast?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 3.0);
    ctx.vfx?.spark?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 2.2, false, true);
    ctx.vfx?.scorchFx?.(egg.x, egg.z, 2.1, 22,
      new THREE.Color(0.16, 0.05, 0.20), 0.48);
    bus.emit("eggKilled", { x: egg.x, y: egg.y, z: egg.z });
  }

  function layClutch() {
    const ps = ctx.player.state;
    const boss = ctx.apostate?.instance?.();
    const hurt = boss ? 1 - clamp01(boss.health / Math.max(1, boss.maxHealth)) : 0;
    const want = Math.round(lerp(C.clutchEggs[0], C.clutchEggs[1], hurt));
    const a0 = rng() * TAU;
    let laid = 0;
    for (let i = 0; i < want; i += 1) {
      const a = a0 + (i / want) * TAU + rng.jit(0.35);
      const r = rng.range(C.clutchRing[0], C.clutchRing[1]);
      let x = ps.x + Math.cos(a) * r;
      let z = ps.z + Math.sin(a) * r;
      /* Kept off the wall, so a clutch is never laid where the player
         cannot get a shot at it, and off the boss so the eggs do not
         become cover it stands behind. */
      const dr = Math.hypot(x - C.x, z - C.z);
      if (dr > C.panRadius - 3) {
        const k = (C.panRadius - 3) / dr;
        x = C.x + (x - C.x) * k;
        z = C.z + (z - C.z) * k;
      }
      if (boss && Math.hypot(x - boss.x, z - boss.z) < 3.2) continue;
      const egg = eggs[eggCursor % C.eggMax];
      eggCursor += 1;
      egg.live = true;
      egg.burst = 0;
      egg.t = 0;
      egg.hp = C.eggHealth;
      egg.x = x;
      egg.z = z;
      egg.y = chamberFloorAt(x, z) + 0.05;
      egg.seed = rng();
      /* A ranged caste as the fight wears on, because a clutch of
         nothing but melee is answered by walking backwards. */
      egg.caste = rng() < 0.24 + hurt * 0.3 ? "gleaner" : "thresher";
      laid += 1;
    }
    if (laid) {
      eggsDirty = true;
      bus.emit("clutch", { count: laid, x: ps.x, z: ps.z });
    }
    return laid;
  }

  function updateEggs(dt) {
    let any = false;
    for (const egg of eggs) if (egg.live || egg.burst > 0) { any = true; break; }
    if (!any) {
      if (eggsDirty) {
        eggsDirty = false;
        for (const egg of eggs) writeEgg(egg);
        eggGeo.attributes.position.needsUpdate = true;
        eggGeo.attributes.color.needsUpdate = true;
      }
      eggMesh.visible = false;
      return;
    }
    eggsDirty = true;
    eggMesh.visible = true;
    for (const egg of eggs) {
      if (egg.live) {
        egg.t += dt / C.eggHatchSeconds;
        if (egg.t >= 1) hatchEgg(egg);
      } else if (egg.burst > 0) {
        egg.burst = Math.max(0, egg.burst - dt);
      }
      writeEgg(egg);
    }
    eggGeo.attributes.position.needsUpdate = true;
    eggGeo.attributes.color.needsUpdate = true;
    eggGeo.computeVertexNormals();
  }

  /* ============================================================
     THE LASHERS

     Six of them, rooted in the pan's rim, and they are the reason
     this phase is a different fight rather than the same fight in a
     nicer room.

     WHAT THEY ARE FOR. A duel against a mirror of yourself is a
     duel about spacing, and the surface fight is already good at
     that. Underground the floor itself argues: a limb rears where
     you were about to stand, sweeps the ground you were about to
     back across, and the space you are allowed shrinks and moves.
     They do not out-damage the boss and they are not supposed to -
     `lasherDamage` is under a single Apostate melee - because their
     job is to take ground, not health.

     WHY YOU CUT THEM. A hazard you can only dodge is weather. These
     share a nerve with the thing feeding them, so cutting one
     staggers the boss and every third cut UNMOORS it - four and a
     half seconds of a boss that cannot act, which is the fight's
     damage window and the only one it has. That is the loop: the
     tentacles push you off the boss, and going through the
     tentacles is how you get back onto it.

     THE FRAME IS TRANSPORTED ALONG THE LIMB. Building a ring basis
     from scratch at every node flips it 180 degrees the moment the
     tangent passes vertical, and a reversed ring winds its quads
     backwards - which does not read as an error, it reads as a
     length of tentacle turning transparent. The Garner's limbs have
     the same note. Each node's basis is the previous node's, rotated
     by the minimum rotation between the two tangents.
     ============================================================ */
  const L_SIDES = 7;
  const L_CORE_SIDES = 5;
  const L_NODES = C.lasherNodes;

  function limbBuffers(sides) {
    const verts = C.lashers * L_NODES * sides;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(verts * 3);
    const nrm = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const idx = [];
    for (let l = 0; l < C.lashers; l += 1) {
      const base = l * L_NODES * sides;
      for (let n = 0; n + 1 < L_NODES; n += 1) {
        for (let s = 0; s < sides; s += 1) {
          const s1 = (s + 1) % sides;
          const a0 = base + n * sides + s;
          const a1 = base + n * sides + s1;
          const b0 = base + (n + 1) * sides + s;
          const b1 = base + (n + 1) * sides + s1;
          /* WOUND OUTWARD, and the obvious order is not. The ring is
             laid in a right-handed frame as `nrm*cos + bin*sin` and
             advanced along `tan`, so (a0, b0, b1) has a face normal of
             `tan x ring-tangent`, which at angle zero evaluates to
             MINUS nrm - into the tube. Culled, that draws the far wall
             and hides the near one, and the result does not read as an
             error: a fifteen-metre tentacle renders as a flat glowing
             ribbon, because what you are looking at is the glow core
             through a shell that is not being drawn. The Garner's
             limbs and this project's floor decals both have the same
             note; it is apparently a lesson per author. */
          idx.push(a0, b1, b0, a0, a1, b1);
        }
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), C.reach);
    return { geo, pos, nrm, col, sides };
  }

  const shellBuf = limbBuffers(L_SIDES);
  const coreBuf = limbBuffers(L_CORE_SIDES);
  const lasherMat = shellMaterial(ctx, "lashers", { roughness: 0.66, rim: 1.15 });
  lasherMat.emissive = new THREE.Color(0x1d0c28);
  lasherMat.emissiveIntensity = 1.0;
  const lasherMesh = new THREE.Mesh(shellBuf.geo, lasherMat);
  lasherMesh.name = "undercroft-lashers";
  lasherMesh.frustumCulled = false;
  lasherMesh.castShadow = false;
  chamber.group.add(lasherMesh);
  const lasherCore = new THREE.Mesh(coreBuf.geo, glowMaterial(ctx, "lasher-core"));
  lasherCore.name = "undercroft-lasher-cores";
  lasherCore.frustumCulled = false;
  chamber.group.add(lasherCore);

  /* The shell PINCHES at every segment and the core does not, so the
     lit shell dips inside the unlit core at each joint and a band of
     it shows through. Two tubes is the whole trick: one wet, glowing
     ring per segment for the price of a second write over 420
     vertices, and no second material family. */
  const shellRadius = (t) => C.lasherLength * 0.048
    * Math.pow(1 - t * 0.86, 0.55) * (1 + 0.34 * Math.sin(t * Math.PI * 7.5));
  const coreRadius = (t) => C.lasherLength * 0.048
    * Math.pow(1 - t * 0.86, 0.55) * 0.80;

  const lashers = [];
  for (let i = 0; i < C.lashers; i += 1) {
    const a = (i / C.lashers) * TAU + 0.31;
    const r = (i % 2 ? C.lasherInnerRoot : C.lasherRoot) + rng.jit(2.6);
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    lashers.push({
      index: i,
      /* Local chamber space, like every other buffer in this file.
         The root sits UNDER the pan so a sheathed limb is genuinely
         below the floor rather than lying on it. */
      rootX: rx, rootY: undercroftFloor(r) - 2.4, rootZ: rz,
      bearing: Math.atan2(-rz, -rx),
      hp: C.lasherHealth,
      maxHp: C.lasherHealth,
      mode: "sheathed",
      t: 0,
      wait: rng.range(1.5, 7.5),
      rise: 0,
      sway: rng() * TAU,
      cut: 0,
      struck: false,
      tip: new THREE.Vector3(rx, undercroftFloor(r) - 2.4, rz),
      aim: new THREE.Vector3(rx * 0.4, 9, rz * 0.4),
      nodes: Array.from({ length: L_NODES }, () => new THREE.Vector3(rx, 0, rz)),
    });
  }

  const _p0 = new THREE.Vector3();
  const _p1 = new THREE.Vector3();
  const _p2 = new THREE.Vector3();
  const _p3 = new THREE.Vector3();
  const _tan = new THREE.Vector3();
  const _prevTan = new THREE.Vector3();
  const _nrm = new THREE.Vector3();
  const _bin = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _tmp = new THREE.Vector3();

  /** Lay the spine as a cubic: out of the floor, over, and down to
   *  the tip. The two controls are what make it a tentacle instead of
   *  a bent stick - it leaves the ground vertically and arrives at
   *  the tip from behind itself. */
  function solveSpine(limb) {
    const rise = limb.rise;
    _p0.set(limb.rootX, limb.rootY, limb.rootZ);
    _p3.copy(limb.tip);
    const span = _tmp.subVectors(_p3, _p0).length();
    const lift = Math.max(2.5, C.lasherLength * 0.55 * rise);
    _p1.set(_p0.x, _p0.y + lift, _p0.z);
    /* The approach control trails the tip back toward the root, so a
       striking limb whips rather than pivots. */
    _p2.copy(_p3).addScaledVector(_tmp.subVectors(_p0, _p3).normalize(),
      Math.max(1.5, span * 0.42))
      .add(_tmp.set(0, lift * 0.35 * (1 - limb.t * 0.6), 0));
    for (let n = 0; n < L_NODES; n += 1) {
      const t = n / (L_NODES - 1);
      const u = 1 - t;
      const b0 = u * u * u;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const b3 = t * t * t;
      const node = limb.nodes[n];
      node.set(
        _p0.x * b0 + _p1.x * b1 + _p2.x * b2 + _p3.x * b3,
        _p0.y * b0 + _p1.y * b1 + _p2.y * b2 + _p3.y * b3,
        _p0.z * b0 + _p1.z * b1 + _p2.z * b2 + _p3.z * b3
      );
      /* A slow travelling wave, biggest at the tip. Without it a
         waiting limb is a static arch and the room stops breathing. */
      const w = Math.sin(limb.sway + t * 4.1) * t * t * 0.55 * rise;
      node.x += Math.cos(limb.bearing + 1.57) * w;
      node.z += Math.sin(limb.bearing + 1.57) * w;
    }
  }

  /** Write one limb into both tubes with a transported frame. */
  function writeLimb(limb) {
    const shellBase = limb.index * L_NODES;
    let seeded = false;
    for (let n = 0; n < L_NODES; n += 1) {
      const t = n / (L_NODES - 1);
      const here = limb.nodes[n];
      const next = limb.nodes[Math.min(L_NODES - 1, n + 1)];
      const prev = limb.nodes[Math.max(0, n - 1)];
      _tan.subVectors(next, prev);
      if (_tan.lengthSq() < 1e-8) _tan.set(0, 1, 0);
      _tan.normalize();
      if (!seeded) {
        seeded = true;
        _nrm.set(0, 1, 0);
        if (Math.abs(_tan.y) > 0.94) _nrm.set(1, 0, 0);
        _bin.crossVectors(_tan, _nrm).normalize();
        _nrm.crossVectors(_bin, _tan).normalize();
      } else {
        _q.setFromUnitVectors(_prevTan, _tan);
        _nrm.applyQuaternion(_q).normalize();
        _bin.crossVectors(_tan, _nrm).normalize();
        _nrm.crossVectors(_bin, _tan).normalize();
      }
      _prevTan.copy(_tan);

      const dead = limb.mode === "cut" ? 0.55 : 1;
      const rs = shellRadius(t) * dead;
      const rc = coreRadius(t) * dead;
      const shade = 0.62 + t * 0.34;
      const bright = 0.72 + (1 - t) * 0.34;
      for (let s = 0; s < L_SIDES; s += 1) {
        const a = (s / L_SIDES) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const o = (shellBase + n) * L_SIDES * 3 + s * 3;
        const nx = _nrm.x * ca + _bin.x * sa;
        const ny = _nrm.y * ca + _bin.y * sa;
        const nz = _nrm.z * ca + _bin.z * sa;
        shellBuf.pos[o] = here.x + nx * rs;
        shellBuf.pos[o + 1] = here.y + ny * rs;
        shellBuf.pos[o + 2] = here.z + nz * rs;
        shellBuf.nrm[o] = nx; shellBuf.nrm[o + 1] = ny; shellBuf.nrm[o + 2] = nz;
        shellBuf.col[o] = LASH_SHELL[0] * shade;
        shellBuf.col[o + 1] = LASH_SHELL[1] * shade;
        shellBuf.col[o + 2] = LASH_SHELL[2] * shade;
      }
      for (let s = 0; s < L_CORE_SIDES; s += 1) {
        const a = (s / L_CORE_SIDES) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const o = (limb.index * L_NODES + n) * L_CORE_SIDES * 3 + s * 3;
        const nx = _nrm.x * ca + _bin.x * sa;
        const ny = _nrm.y * ca + _bin.y * sa;
        const nz = _nrm.z * ca + _bin.z * sa;
        coreBuf.pos[o] = here.x + nx * rc;
        coreBuf.pos[o + 1] = here.y + ny * rc;
        coreBuf.pos[o + 2] = here.z + nz * rc;
        coreBuf.nrm[o] = nx; coreBuf.nrm[o + 1] = ny; coreBuf.nrm[o + 2] = nz;
        const g = limb.mode === "cut" ? 0.14 : bright;
        coreBuf.col[o] = LASH_CORE[0] * g;
        coreBuf.col[o + 1] = LASH_CORE[1] * g;
        coreBuf.col[o + 2] = LASH_CORE[2] * g;
      }
    }
  }

  /* ------------------------------------------------- limb behaviour */

  const LIMB_TIMES = Object.freeze({
    erupt: 0.62, wind: 0.44, strike: 0.26, recover: 0.72, sheathe: 0.55,
  });

  function limbAnchor(limb, out) {
    return out.set(limb.rootX, limb.rootY, limb.rootZ);
  }

  /** Clamp a wanted tip to what this limb can actually reach, so a
   *  tentacle never stretches and never reaches across the room. */
  function reachable(limb, wx, wy, wz, out) {
    out.set(wx - limb.rootX, wy - limb.rootY, wz - limb.rootZ);
    const span = out.length();
    const max = C.lasherLength * 0.92;
    if (span > max) out.multiplyScalar(max / span);
    out.set(limb.rootX + out.x, limb.rootY + out.y, limb.rootZ + out.z);
    return out;
  }

  const _want = new THREE.Vector3();

  /** Player position in the chamber's local space. */
  function playerLocal(out) {
    const ps = ctx.player.state;
    return out.set(ps.x - C.x, ps.y - floorY, ps.z - C.z);
  }

  function playerInLimb(limb, from, pad = 1.75) {
    playerLocal(_tmp);
    for (let n = from; n + 1 < L_NODES; n += 1) {
      const a = limb.nodes[n];
      const b = limb.nodes[n + 1];
      _p1.subVectors(b, a);
      const len2 = _p1.lengthSq();
      if (len2 < 1e-6) continue;
      _p2.subVectors(_tmp, a);
      const t = clamp01(_p2.dot(_p1) / len2);
      _p2.set(a.x + _p1.x * t, a.y + _p1.y * t, a.z + _p1.z * t);
      const dx = _tmp.x - _p2.x;
      const dz = _tmp.z - _p2.z;
      /* The capsule is measured against the trooper's chest rather
         than their feet: a limb sweeping at knee height and one
         passing overhead are different events and a point test at the
         origin cannot tell them apart. */
      const dy = (_tmp.y + 0.95) - _p2.y;
      const r = shellRadius(n / (L_NODES - 1)) + pad;
      if (dx * dx + dy * dy + dz * dz <= r * r) return true;
    }
    return false;
  }

  function cutLimb(limb, x, y, z) {
    limb.mode = "cut";
    limb.t = 0;
    limb.cut = C.lasherRegrow;
    limb.hp = 0;
    state.cuts += 1;
    state.totalCuts += 1;
    ctx.vfx?.blast?.(x, y, z, 3.6);
    ctx.vfx?.spark?.(x, y, z, 3.0, true, true);
    const boss = ctx.apostate?.instance?.();
    const unmoored = state.cuts >= C.cutsPerStagger;
    if (unmoored) {
      state.cuts = 0;
      state.unmooredFor = C.staggerSeconds;
      if (boss) boss.stunTime = Math.max(boss.stunTime || 0, C.staggerSeconds);
      bus.emit("unmoored", { seconds: C.staggerSeconds, x: boss?.x, z: boss?.z });
    } else if (boss) {
      /* A short, non-stacking flinch. The reward for one cut is that
         the boss loses its move; the reward for the third is the
         window. Refreshing rather than adding stops three quick cuts
         from chaining into a stun the fight never recovers from. */
      boss.stunTime = Math.max(boss.stunTime || 0, 1.15);
    }
    bus.emit("lasherCut", {
      index: limb.index, x: x + C.x, y: y + floorY, z: z + C.z,
      unmoored, remaining: lashers.filter((l) => l.mode !== "cut").length,
    });
  }

  function stepLimb(limb, dt) {
    const ps = ctx.player.state;
    const bossDead = ctx.apostate?.status?.()?.dead === true;
    limb.sway += dt * 1.35;

    if (limb.mode === "cut") {
      limb.cut -= dt;
      limb.rise = damp(limb.rise, 0.16, 3.2, dt);
      /* Flopped onto the pan in front of its own root, which is what
         makes a cut limb a piece of scenery the player can see they
         made rather than a thing that vanished. */
      reachable(limb, limb.rootX * 0.72, undercroftFloor(
        Math.hypot(limb.rootX, limb.rootZ) * 0.72) + 0.5, limb.rootZ * 0.72, _want);
      limb.tip.lerp(_want, 1 - Math.exp(-2.6 * dt));
      if (limb.cut <= 0) {
        limb.mode = "sheathed";
        limb.hp = limb.maxHp;
        limb.wait = rng.range(1.2, 3.4);
        limb.tip.set(limb.rootX, limb.rootY, limb.rootZ);
        limb.rise = 0;
      }
      return;
    }

    if (limb.mode === "sheathed") {
      limb.rise = damp(limb.rise, 0, 6, dt);
      limb.tip.lerp(_want.set(limb.rootX, limb.rootY, limb.rootZ),
        1 - Math.exp(-6 * dt));
      if (bossDead || state.phase !== "live") return;
      limb.wait -= dt;
      if (limb.wait > 0) return;
      /* Only erupts where the player can actually be threatened. A
         limb rearing on the far side of a hundred-metre room is a
         draw call and a lie about danger. */
      playerLocal(_tmp);
      const span = Math.hypot(_tmp.x - limb.rootX, _tmp.z - limb.rootZ);
      if (span > C.lasherReach + 6) { limb.wait = 0.6; return; }
      limb.mode = "erupt";
      limb.t = 0;
      ctx.vfx?.sandSpray?.(limb.rootX + C.x,
        chamberFloorAt(limb.rootX + C.x, limb.rootZ + C.z), limb.rootZ + C.z, 2.4);
      ctx.vfx?.blast?.(limb.rootX + C.x,
        chamberFloorAt(limb.rootX + C.x, limb.rootZ + C.z) + 0.6, limb.rootZ + C.z, 2.8);
      bus.emit("erupt", { index: limb.index, x: limb.rootX + C.x, z: limb.rootZ + C.z });
      return;
    }

    limb.t += dt;

    if (limb.mode === "erupt") {
      const k = clamp01(limb.t / LIMB_TIMES.erupt);
      limb.rise = k * k * (3 - 2 * k);
      playerLocal(_tmp);
      reachable(limb, lerp(limb.rootX, _tmp.x, 0.45), 9.5 + k * 3.5,
        lerp(limb.rootZ, _tmp.z, 0.45), _want);
      limb.tip.lerp(_want, 1 - Math.exp(-7 * dt));
      if (limb.t >= LIMB_TIMES.erupt) {
        limb.mode = "track";
        limb.t = 0;
        limb.wait = rng.range(C.lasherCadence[0], C.lasherCadence[1]) * 0.4;
      }
      return;
    }

    if (limb.mode === "track") {
      limb.rise = damp(limb.rise, 1, 5, dt);
      playerLocal(_tmp);
      /* Hangs over and slightly beside the player: a limb aimed
         exactly at them reads as already committed, and the player
         cannot tell the tracking from the strike. */
      reachable(limb, _tmp.x + Math.cos(limb.sway * 0.7) * 3.0,
        _tmp.y + 7.5 + Math.sin(limb.sway) * 1.2,
        _tmp.z + Math.sin(limb.sway * 0.7) * 3.0, _want);
      limb.tip.lerp(_want, 1 - Math.exp(-2.4 * dt));
      limb.wait -= dt;
      const span = Math.hypot(_tmp.x - limb.rootX, _tmp.z - limb.rootZ);
      if (bossDead || state.phase !== "live" || span > C.lasherReach + 8) {
        limb.mode = "sheathe";
        limb.t = 0;
        return;
      }
      if (limb.wait <= 0) {
        limb.mode = "wind";
        limb.t = 0;
        limb.struck = false;
        bus.emit("wind", { index: limb.index });
      }
      return;
    }

    if (limb.mode === "wind") {
      /* THE TELL, and it is deliberately generous. Every enemy melee
         in this game is a wind-up you can read and step out of - see
         the melee-viability work - and a hazard that arrives without
         one is not difficulty, it is a dice roll. Four hundred and
         forty milliseconds of the limb pulling up and back, away from
         where it is about to go. */
      const k = clamp01(limb.t / LIMB_TIMES.wind);
      playerLocal(_tmp);
      reachable(limb, lerp(_tmp.x, limb.rootX, 0.35),
        11 + k * 4.5, lerp(_tmp.z, limb.rootZ, 0.35), _want);
      limb.tip.lerp(_want, 1 - Math.exp(-8 * dt));
      if (limb.t >= LIMB_TIMES.wind) { limb.mode = "strike"; limb.t = 0; }
      return;
    }

    if (limb.mode === "strike") {
      const k = clamp01(limb.t / LIMB_TIMES.strike);
      playerLocal(_tmp);
      reachable(limb, _tmp.x, chamberFloorAt(ps.x, ps.z) - floorY + 0.5, _tmp.z, _want);
      limb.tip.lerp(_want, 1 - Math.exp(-22 * dt));
      if (!limb.struck && k > 0.55) {
        limb.struck = true;
        if (playerInLimb(limb, L_NODES - 7)) {
          ctx.combat?.hurtPlayer?.(C.lasherDamage, {
            source: "undercroft-lasher",
            x: limb.tip.x + C.x, y: limb.tip.y + floorY, z: limb.tip.z + C.z,
            enemy: "undercroft", enemyKey: "undercroft",
          });
          /* Rooted, not stunned. The hands stay live so the answer to
             being caught is to cut the thing that caught you. */
          ctx.player?.applyRoot?.(0.55);
          bus.emit("lash", { index: limb.index, hit: true });
        } else {
          bus.emit("lash", { index: limb.index, hit: false });
        }
        /* NOT `slamImpact`: that effect is the PLAYER's aerial slam and
           it disarms the player's own impulse charge on the way past.
           A tentacle hitting the floor wants the picture, not the
           side effect. */
        ctx.vfx?.blast?.(limb.tip.x + C.x, limb.tip.y + floorY + 0.4,
          limb.tip.z + C.z, 3.4);
        ctx.vfx?.sandSpray?.(limb.tip.x + C.x, limb.tip.y + floorY,
          limb.tip.z + C.z, 2.6);
      }
      if (limb.t >= LIMB_TIMES.strike) { limb.mode = "recover"; limb.t = 0; }
      return;
    }

    if (limb.mode === "recover") {
      playerLocal(_tmp);
      reachable(limb, lerp(limb.tip.x, _tmp.x, 0.2), 10.5,
        lerp(limb.tip.z, _tmp.z, 0.2), _want);
      limb.tip.lerp(_want, 1 - Math.exp(-4 * dt));
      if (limb.t >= LIMB_TIMES.recover) {
        limb.t = 0;
        if (rng() < 0.62) {
          limb.mode = "track";
          limb.wait = rng.range(C.lasherCadence[0], C.lasherCadence[1]);
        } else {
          limb.mode = "sheathe";
        }
      }
      return;
    }

    if (limb.mode === "sheathe") {
      limb.rise = damp(limb.rise, 0, 4, dt);
      limb.tip.lerp(_want.set(limb.rootX, limb.rootY, limb.rootZ),
        1 - Math.exp(-4.5 * dt));
      if (limb.t >= LIMB_TIMES.sheathe) {
        limb.mode = "sheathed";
        limb.wait = rng.range(C.lasherCadence[0], C.lasherCadence[1]);
      }
    }
  }

  function updateLimbs(dt) {
    for (const limb of lashers) {
      stepLimb(limb, dt);
      solveSpine(limb);
      writeLimb(limb);
    }
    shellBuf.geo.attributes.position.needsUpdate = true;
    shellBuf.geo.attributes.normal.needsUpdate = true;
    shellBuf.geo.attributes.color.needsUpdate = true;
    coreBuf.geo.attributes.position.needsUpdate = true;
    coreBuf.geo.attributes.normal.needsUpdate = true;
    coreBuf.geo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     THE ONE DAMAGE DOOR

     Eggs and limbs are both invisible to `raycastEnemies` - neither
     is in `enemies.live` - so combat.js calls this instead, from the
     same four places it already calls the Abbess's clutch test:
     shots, the melee arc, explosions and shockwaves. One function
     rather than two so those four call sites stay four lines.
     ============================================================ */
  function hitProps(x, y, z, radius, damage, opts = {}) {
    if (state.phase !== "live") return 0;
    let hits = 0;
    for (const egg of eggs) {
      if (!egg.live) continue;
      const dx = egg.x - x;
      const dz = egg.z - z;
      const dy = (egg.y + 1.0) - y;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      /* A melee connection is always lethal, and that is a rule
         rather than a number: `eggHealth` is written for the rifle,
         and one swing killing one egg must not depend on a weapon
         tuning pass keeping the lance either side of it. */
      egg.hp = opts.melee ? 0 : egg.hp - damage;
      hits += 1;
      if (egg.hp <= 0) killEgg(egg, x, y, z);
      else ctx.vfx?.spark?.(egg.x, egg.y + 1.0, egg.z, 1.0, false, true);
    }
    const lx = x - C.x;
    const ly = y - floorY;
    const lz = z - C.z;
    for (const limb of lashers) {
      if (limb.mode === "cut" || limb.mode === "sheathed" || limb.rise < 0.25) continue;
      let best = -1;
      for (let n = 1; n + 1 < L_NODES; n += 1) {
        const node = limb.nodes[n];
        const dx = node.x - lx;
        const dy = node.y - ly;
        const dz = node.z - lz;
        const r = radius + shellRadius(n / (L_NODES - 1));
        if (dx * dx + dy * dy + dz * dz <= r * r) { best = n; break; }
      }
      if (best < 0) continue;
      hits += 1;
      limb.hp -= opts.melee ? damage * 2.2 : damage;
      if (limb.hp <= 0) {
        const node = limb.nodes[best];
        cutLimb(limb, node.x, node.y, node.z);
      } else {
        const node = limb.nodes[best];
        ctx.vfx?.spark?.(node.x + C.x, node.y + floorY, node.z + C.z, 1.2, false, true);
      }
    }
    return hits;
  }

  /* ============================================================
     THE COLLAPSE

     Four beats and one rule: the player never loses the boss. A
     transition cinematic that cuts away from the thing it is about
     has to spend its last second re-establishing it, so this one
     simply keeps it in frame the whole way down.

       FRACTURE  the nave splits. Low and close, looking up past the
                 kneeling mirror at the vault it is about to leave.
       FALL      from below, looking up: the trooper, the boss, and
                 the hole shrinking behind them. Swings over at the
                 end so the room arrives rather than appears.
       SETTLE    impact, then one slow orbit that is the only wide
                 shot of the chamber the fight will ever give.
       LIVE      camera back on the trooper's shoulder.
     ============================================================ */
  const camPos = [0, 0, 0];
  const camTarget = [0, 0, 0];
  const landing = { x: C.x + chamber.poolAt.x, z: C.z + chamber.poolAt.z };
  const fallFrom = { x: C.x, z: C.z, y: surfaceY };

  function setCamera(px, py, pz, tx, ty, tz, fov) {
    camPos[0] = px; camPos[1] = py; camPos[2] = pz;
    camTarget[0] = tx; camTarget[1] = ty; camTarget[2] = tz;
    ctx.player?.setFree?.(true, camPos, camTarget, fov);
  }

  function driveCamera() {
    const ps = ctx.player.state;
    const boss = ctx.apostate?.instance?.();
    const bx = boss ? boss.x : C.x;
    const by = boss ? boss.y : surfaceY;
    const bz = boss ? boss.z : C.z;
    if (state.phase === "fracture") {
      const k = 1 - clamp01(state.timer / C.fractureSeconds);
      const swing = 0.55 + k * 0.5;
      setCamera(bx + Math.sin(swing) * 9.5, by + 1.1 - k * 0.7,
        bz + Math.cos(swing) * 9.5,
        bx, by + 2.3 + k * 1.4, bz, 46 - k * 4);
      return;
    }
    if (state.phase === "fall") {
      const k = clamp01(state.elapsedInPhase / C.fallSeconds);
      if (k < 0.62) {
        /* Under them, looking up. The daylight closing overhead is
           the only thing in frame that says how far this is going. */
        setCamera(ps.x + 4.6, state.fallY - 8.5, ps.z + 4.6,
          ps.x, state.fallY + 5.5, ps.z, 64);
      } else {
        const t = (k - 0.62) / 0.38;
        setCamera(ps.x + 7.5 - t * 2.5, state.fallY + 7.5 + t * 4,
          ps.z + 7.5 - t * 2.5,
          ps.x, state.fallY - 6 - t * 16, ps.z, 62);
      }
      return;
    }
    if (state.phase === "settle") {
      const k = 1 - clamp01(state.timer / C.settleSeconds);
      const a = 2.1 + k * 1.35;
      const r = 26 - k * 8;
      const mid = {
        x: lerp(ps.x, bx, clamp01((k - 0.45) / 0.5)),
        y: lerp(ps.y + 1.4, by + 2.4, clamp01((k - 0.45) / 0.5)),
        z: lerp(ps.z, bz, clamp01((k - 0.45) / 0.5)),
      };
      setCamera(mid.x + Math.sin(a) * r, floorY + 7.5 + k * 5.5,
        mid.z + Math.cos(a) * r, mid.x, mid.y, mid.z, 52 - k * 6);
    }
  }

  /** Everything the collapse does to the world, once. */
  function begin() {
    if (state.used || state.phase !== "idle") return false;
    const boss = ctx.apostate?.instance?.();
    if (!boss) return false;
    state.used = true;
    state.phase = "fracture";
    state.timer = C.fractureSeconds;
    state.elapsedInPhase = 0;
    fallFrom.x = ctx.player.state.x;
    fallFrom.z = ctx.player.state.z;
    fallFrom.y = ctx.player.state.y;
    state.fallY = fallFrom.y;
    state.fallSpeed = 0;
    /* Brought up here rather than at the cut, so the room's eight
       materials compile during a beat that is already shaking
       instead of on the frame the picture changes. */
    chamber.setLive(true);
    ctx.render?.requestShadowUpdate?.();
    ctx.player?.input?.clearAll?.();
    ctx.player?.applyStun?.(C.fractureSeconds + C.fallSeconds + C.settleSeconds);
    ctx.combat?.clearEnemyProjectiles?.();
    swallow();
    for (let i = 0; i < 7; i += 1) {
      const a = rng() * TAU;
      const r = rng.range(3, 22);
      ctx.vfx?.sandSpray?.(fallFrom.x + Math.cos(a) * r, fallFrom.y,
        fallFrom.z + Math.sin(a) * r, 3.4);
    }
    ctx.vfx?.blast?.(boss.x, boss.y + 1.2, boss.z, 7.5);
    bus.emit("fracture", { x: fallFrom.x, y: fallFrom.y, z: fallFrom.z });
    return true;
  }

  function stepFracture(dt) {
    state.timer -= dt;
    if (rng() < dt * 9) {
      const a = rng() * TAU;
      const r = rng.range(2, 26);
      ctx.vfx?.sandSpray?.(fallFrom.x + Math.cos(a) * r, fallFrom.y,
        fallFrom.z + Math.sin(a) * r, rng.range(1.6, 3.8));
    }
    if (state.timer > 0) return;
    state.phase = "fall";
    state.elapsedInPhase = 0;
    state.fallSpeed = 0;
    ctx.apostate?.beginDescent?.();
    ctx.vfx?.blast?.(fallFrom.x, fallFrom.y, fallFrom.z, 14);
    bus.emit("fall", { x: fallFrom.x, z: fallFrom.z });
  }

  function stepFall(dt) {
    const ps = ctx.player.state;
    const target = chamberFloorAt(landing.x, landing.z);
    const drop = Math.max(6, fallFrom.y - target);
    /* Acceleration chosen from the distance so the fall always takes
       about `fallSeconds` whatever the nave floor happens to sit at.
       A fixed gravity here would make the beat's length a property of
       the terrain generator. */
    const accel = (2 * drop) / (C.fallSeconds * C.fallSeconds);
    state.fallSpeed = Math.min(70, state.fallSpeed + accel * dt);
    state.fallY = Math.max(target, state.fallY - state.fallSpeed * dt);
    state.elapsedInPhase += dt;
    const k = clamp01(1 - (state.fallY - target) / drop);

    ps.x = lerp(fallFrom.x, landing.x, k * k * (3 - 2 * k));
    ps.z = lerp(fallFrom.z, landing.z, k * k * (3 - 2 * k));
    ps.y = state.fallY;
    ps.vy = -state.fallSpeed;
    ps.grounded = false;
    ps.speed = 0;
    ps.travelSpeed = 0;

    /* The boss falls beside you, tumbling, and stays in frame. */
    const bx = lerp(fallFrom.x + 6, landing.x + 13, k);
    const bz = lerp(fallFrom.z - 5, landing.z - 9, k);
    ctx.apostate?.driveDescent?.(bx, state.fallY + lerp(2.5, 6.5, k), bz,
      state.elapsed * 2.4);

    ctx.sky?.setUnderground?.(clamp01(k * 1.35));
    if (rng() < dt * 26) {
      ctx.vfx?.spark?.(ps.x + rng.jit(6), state.fallY + rng.range(4, 22),
        ps.z + rng.jit(6), rng.range(0.8, 2.2), false, false);
    }
    if (state.fallY <= target + 0.001) {
      state.phase = "settle";
      state.timer = C.settleSeconds;
      state.landedAt = state.elapsed;
      ps.y = target;
      ps.vy = 0;
      ps.grounded = true;
      state.heat = 1;
      ctx.sky?.setUnderground?.(1);
      ctx.vfx?.blast?.(ps.x, target + 0.8, ps.z, 7.5);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        ctx.vfx?.sandSpray?.(ps.x + Math.cos(a) * 2.2, target,
          ps.z + Math.sin(a) * 2.2, 3.0, Math.cos(a), Math.sin(a));
      }
      ctx.vfx?.scorchFx?.(ps.x, ps.z, 4.4, 40,
        new THREE.Color(0.10, 0.04, 0.14), 0.5);
      ctx.apostate?.enterHive?.(landing.x + 15, landing.z - 10);
      bus.emit("landed", { x: ps.x, y: target, z: ps.z });
    }
  }

  function stepSettle(dt) {
    const before = state.timer;
    state.timer -= dt;
    const boss = ctx.apostate?.instance?.();
    /* THE BAR REFILLS WHILE YOU WATCH, which is the whole reason the
       transition drains it to nothing first. A second pool that was
       simply full from the moment of the cut says "that did not
       count"; one that fills across the reveal says "there is more
       of it". */
    if (boss) {
      const k = clamp01(1 - state.timer / Math.max(0.001, C.settleSeconds));
      boss.health = Math.max(1, Math.round(boss.maxHealth
        * clamp01((k - 0.25) / 0.6)));
    }
    if (before > C.settleSeconds * 0.62 && state.timer <= C.settleSeconds * 0.62) {
      /* The hive answers: every limb at once, one time only. After
         this they run on their own cadences and never all rear
         together again. */
      for (const limb of lashers) {
        limb.mode = "erupt";
        limb.t = 0;
        limb.hp = limb.maxHp;
      }
      state.heat = 1.4;
      layClutch();
      bus.emit("answer", { lashers: lashers.length });
    }
    if (state.timer > 0) return;
    state.phase = "live";
    state.timer = 0;
    state.clutchTimer = C.clutchCadence;
    if (boss) boss.health = boss.maxHealth;
    ctx.player?.clearStun?.();
    ctx.player?.setFree?.(false);
    bus.emit("engaged", { x: landing.x, z: landing.z });
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */

  function clearEggs() {
    for (const egg of eggs) { egg.live = false; egg.burst = 0; egg.t = 0; }
    eggsDirty = true;
    brood.length = 0;
  }

  function sheatheAll() {
    for (const limb of lashers) {
      limb.mode = "sheathed";
      limb.t = 0;
      limb.cut = 0;
      limb.hp = limb.maxHp;
      limb.rise = 0;
      limb.wait = rng.range(1.5, 6.5);
      limb.tip.set(limb.rootX, limb.rootY, limb.rootZ);
      solveSpine(limb);
      writeLimb(limb);
    }
    shellBuf.geo.attributes.position.needsUpdate = true;
    coreBuf.geo.attributes.position.needsUpdate = true;
  }

  function stepLive(dt) {
    const ps = ctx.player.state;
    const boss = ctx.apostate?.instance?.();
    const bossDead = ctx.apostate?.status?.()?.dead === true;

    contain(ps, C.keepIn);
    if (boss && !bossDead) contain(boss, C.bossKeepIn);
    pruneBrood();
    for (const kid of brood) contain(kid, C.keepIn);

    state.unmooredFor = Math.max(0, state.unmooredFor - dt);
    if (!bossDead) {
      state.clutchTimer -= dt;
      if (state.clutchTimer <= 0) {
        state.clutchTimer = C.clutchCadence * rng.range(0.85, 1.15);
        if (layClutch()) state.heat = Math.max(state.heat, 0.55);
      }
    } else if (!state.clutchClosed) {
      /* A LATCH, NOT A SENTINEL TIMER. This used to park `clutchTimer`
         at 999 to mean "never again", and that number went straight
         into the save file - where the validator's own upper bound
         rejected it and every file written after the boss died was
         refused on load. A run-once flag says the same thing and is
         not durable state at all. */
      state.clutchClosed = true;
      clearEggs();
    }
  }

  function update(dt) {
    if (state.phase === "idle") return;
    const d = Math.min(0.1, Math.max(0, dt));
    state.elapsed += d;
    state.heat = Math.max(0, state.heat - d * 0.85);

    if (state.phase === "fracture") { stepFracture(d); driveCamera(); }
    else if (state.phase === "fall") { stepFall(d); driveCamera(); }
    else if (state.phase === "settle") { stepSettle(d); driveCamera(); }
    else if (state.phase === "live") stepLive(d);

    if (live()) {
      updateEggs(d);
      updateLimbs(d);
      chamber.update(state.elapsed, d, state.heat + state.unmooredFor * 0.12);
      ctx.sky?.setUnderground?.(state.phase === "fall"
        ? clamp01(state.elapsedInPhase / C.fallSeconds * 1.35) : 1);
    }
  }

  function reset() {
    state.phase = "idle";
    state.timer = 0;
    state.elapsed = 0;
    state.elapsedInPhase = 0;
    state.used = false;
    state.cuts = 0;
    state.totalCuts = 0;
    state.unmooredFor = 0;
    state.clutchTimer = C.clutchCadence * 0.55;
    state.clutchClosed = false;
    state.heat = 0;
    state.swallowed = 0;
    state.fallY = surfaceY;
    state.fallSpeed = 0;
    clearEggs();
    updateEggs(0);
    sheatheAll();
    chamber.setLive(false);
    ctx.sky?.setUnderground?.(0);
  }

  function status() {
    return {
      phase: state.phase,
      active: live(),
      used: state.used,
      floorY: Number(floorY.toFixed(2)),
      surfaceY: Number(surfaceY.toFixed(2)),
      depth: C.depth,
      /* Reported so a harness can assert the promise in the header
         rather than trust it: the roof over the fighting pan against
         the highest point anything in the fight can reach. */
      headroom: Number((C.apex - 10).toFixed(2)),
      hemHeadroom: Number((C.hem - 10).toFixed(2)),
      apex: C.apex,
      landing: { x: Number(landing.x.toFixed(2)), z: Number(landing.z.toFixed(2)) },
      eggs: eggs.filter((e) => e.live).length,
      brood: brood.length,
      lashers: lashers.map((l) => ({
        index: l.index, mode: l.mode, rise: Number(l.rise.toFixed(3)),
        hp: Math.max(0, Math.round(l.hp)),
        tipY: Number((l.tip.y + floorY).toFixed(2)),
      })),
      lashersUp: lashers.filter((l) => l.rise > 0.5 && l.mode !== "cut").length,
      cuts: state.cuts,
      totalCuts: state.totalCuts,
      unmooredFor: Number(state.unmooredFor.toFixed(2)),
      swallowed: state.swallowed,
      counts: chamber.counts,
      visible: chamber.group.visible,
    };
  }

  function snapshot() {
    return {
      /* Only the three phases `restore` accepts are ever written. A
         cinematic phase cannot be saved anyway - save.js refuses while
         the free camera is up or the trooper is off the ground - and
         a snapshot that can produce a value its own restore rejects is
         a save file the game refuses to load. */
      phase: state.phase === "idle" ? "idle"
        : state.phase === "spent" ? "spent" : "live",
      used: !!state.used,
      cuts: Math.max(0, Math.round(state.cuts)),
      totalCuts: Math.max(0, Math.round(state.totalCuts)),
      swallowed: Math.max(0, Math.round(state.swallowed)),
      /* Bounded to what `restore` and save.js's validator both accept.
         An unbounded durable number is a file the game can write and
         then refuse to read. */
      clutchTimer: clamp(Number(state.clutchTimer.toFixed(2)),
        0, C.clutchCadence * 3),
    };
  }

  function restore(saved) {
    reset();
    if (!saved || typeof saved !== "object") return true;
    const phase = saved.phase === "live" ? "live"
      : saved.phase === "spent" ? "spent" : "idle";
    state.used = !!saved.used || phase !== "idle";
    state.cuts = clamp(Math.round(Number(saved.cuts) || 0), 0, 99);
    state.totalCuts = clamp(Math.round(Number(saved.totalCuts) || 0), 0, 9999);
    state.swallowed = clamp(Math.round(Number(saved.swallowed) || 0), 0, 9999);
    const timer = Number(saved.clutchTimer);
    state.clutchTimer = Number.isFinite(timer)
      ? clamp(timer, 0, C.clutchCadence * 3) : C.clutchCadence;
    if (phase === "live") {
      state.phase = "live";
      chamber.setLive(true);
      ctx.sky?.setUnderground?.(1);
      /* The limbs and the clutch are NOT serialised and that is a
         decision rather than an omission: twenty procedural arms
         mid-solve and a clutch mid-hatch are momentary combat state,
         and the save contract in this project is that files carry
         outcomes. A restored fight resumes in the room, at the boss's
         real health, with the hive taking a fresh breath. */
      sheatheAll();
    }
    return true;
  }

  return {
    bus,
    config: C,
    floorY,
    surfaceY,
    chamber,
    lashers,
    eggs,
    groundOverrideAt,
    chamberFloorAt,
    hitProps,
    begin,
    swallow,
    active: live,
    /** Whether the collapse is still ahead of the fight. apostate.js
     *  asks before it floors a lethal hit, so a boss whose second
     *  phase has already been spent - or a build with this module
     *  absent - dies the ordinary way. */
    available: () => !state.used && state.phase === "idle",
    /** Dying underground must not respawn the trooper at the drop
     *  point two kilometres away and eighty-eight metres up - the
     *  fight would be unwinnable and the boss would leash home to a
     *  nave that is no longer there. combat.js asks this first. */
    respawnPoint() {
      if (state.phase !== "live") return null;
      const boss = ctx.apostate?.instance?.();
      const x = landing.x;
      const z = landing.z;
      return {
        x, z,
        yaw: boss ? Math.atan2(boss.x - x, boss.z - z) : 0,
      };
    },
    status,
    snapshot,
    restore,
    reset,
    update,
  };
}
