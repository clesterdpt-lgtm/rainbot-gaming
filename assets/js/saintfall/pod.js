/* ============================================================
   SAINTFALL - THE SANCTUM-CLASS LANDER

   The pod is one object with two lives. The cinematic borrows it
   for the fall, and the level keeps it forever afterwards as the
   landmark standing at the drop site: same mesh, same transform,
   same scorch. Nothing is rebuilt at the handoff, which is the
   only way the last cinematic frame and the first playable frame
   can hold the identical object.

   It is deliberately NOT gothic. Everything else on Vesper-IX is
   rust, bone and oxblood; the Concord's reliquary landers are
   white ceramic and polished gold, and the contrast is the point -
   the one clean thing in the basin is the thing you arrived in.

   THERE IS NO LANDING GEAR AND THERE ARE NO RETROS. This is a
   round fired at a planet. It comes in at terminal velocity, drives
   its prow into the ground, and the four hull petals blow outward
   onto the crater it just made. Everything below follows from that:
   the base is a blunt impact prow rather than a nozzle cluster, the
   hull rests BELOW grade rather than standing off it, and the front
   petal is the ramp because nothing else is going to deploy one.

   Materials are patched with the live atmosphere exactly like the
   world's own archetypes. An unpatched material skips the aerial
   perspective every other surface receives and the pod reads as a
   sticker on the sky from 400m up, which is precisely the altitude
   most of the descent is shot from.
   ============================================================ */

import {
  TAU, clamp01, lerp, makeRamp, smootherstep,
} from "saintfall/core.js";
import { patchMaterial, paintFlat, paintGeometry } from "saintfall/art.js";
import { mergeGeometries } from "saintfall/structures.js";
import { instantiateIntroVehicle } from "saintfall/intro-models.js";

/** Prow base to nose tip, in metres. The trooper is 1.85m. */
export const POD_HEIGHT = 6.9;
/** Widest point, at the ablative shoulder. */
export const POD_RADIUS = 2.28;

/* The petals part LOW - just above the prow - so the hull opens
   like a reliquary rather than popping a lid. A first pass hinged
   them at 2.3m and the pod read as a capsule with a door in it;
   splitting at the waist is what makes four identical shells read
   as something unfolding. */
const HINGE_Y = 1.15;
const HINGE_R = 2.05;
const PETALS = 4;

/* THE DOORS STOP AT THE SHOULDER. The ogive above `DOOR_TOP` is a
   fixed central mast that stays standing when they blow.

   Hinging the whole upper hull meant each door WAS a quarter of the
   nose - a 5.7m shard tapering to a point - and four of those thrown
   flat read as feathers, not as the sides of a hull. Cutting them at
   4.25m makes each one broader than it is long, and leaves the mast
   the halo hangs off: a column with four slabs fallen around it,
   which is the silhouette this kind of pod has always had. */
const DOOR_TOP = 5.20;
const PETAL_LENGTH = DOOR_TOP - HINGE_Y;

/* How far they go over. The front one is thrown furthest, far enough
   that its lip comes down on the inner wall of the crater - which is
   the only ramp this thing has, and the reason the trooper can get
   out of a hole it dug for itself. */
const DOOR_FRONT = 1.18;
const DOOR_SIDE = 1.02;

/** Radius at which the front door's lip comes down. */
export const POD_DOOR_REACH = HINGE_R + PETAL_LENGTH * Math.sin(DOOR_FRONT);

/* How far the hull's origin rests BELOW the crater floor it dug.
   Negative on purpose: the prow runs to -0.55 local, so at this
   offset the blunt end is nearly a metre into the floor of its own
   hole and the sand closes on the hull around the shoulder. A pod
   resting ON the crater floor is a pod that was set down in one. */
export const POD_SINK = -0.34;

/* Not level. A pod that drives itself into a planet at terminal
   velocity and comes to rest plumb is a pod that was placed. */
export const POD_LANDED_PITCH = 0.085;
export const POD_LANDED_ROLL = -0.052;

/* The lathed silhouette, as a column of [radius, height]. A tucked
   waist under a flared ablative shoulder, a long swelling body, and
   an ogive that comes to a point rather than a dome. The tuck is
   what stops it reading as a bullet. */
const PROW_PROFILE = [
  [0.00, -0.55], [0.86, -0.44], [1.34, -0.18], [1.72, 0.10],
  [2.06, 0.42], [2.28, 0.72], [2.22, 0.94], [2.08, 1.08], [2.05, HINGE_Y],
];
const UPPER_PROFILE = [
  [2.05, 1.15], [2.02, 1.54], [2.03, 1.96], [2.08, 2.42],
  [2.12, 2.92], [2.12, 3.42], [2.08, 3.90], [2.00, 4.36],
  [1.88, 4.80], [1.70, 5.22], [1.46, 5.62], [1.16, 6.00],
  [0.82, 6.34], [0.44, 6.66], [0.14, 6.86], [0.00, POD_HEIGHT],
];

const SHELL_RAMP = makeRamp([
  [0.00, "#8d8b86"],
  [0.24, "#c6c2b7"],
  [0.55, "#e8e3d6"],
  [0.80, "#f6f2e6"],
  [1.00, "#fffdf4"],
]);
const GOLD_RAMP = makeRamp([
  [0.00, "#4b3413"],
  [0.28, "#8a6320"],
  [0.58, "#c69a3e"],
  [0.82, "#e8c674"],
  [1.00, "#fff0bd"],
]);
const ABLATIVE_RAMP = makeRamp([
  [0.00, "#0d0e11"], [0.35, "#1d1f24"], [0.70, "#33353c"], [1.00, "#4d4f57"],
]);

/** Close a lathe profile back on itself at `thickness` along its own
 *  inward normal, so the sector lathes as a SOLID SHELL.
 *
 *  A hull petal built from a bare profile is a surface with no
 *  thickness, and once the doors are thrown wide the camera is
 *  looking straight along their edges: 6cm of ceramic armour
 *  rendered as a blade with a bright rim, and four of them read as
 *  feathers rather than as the sides of a hull. */
function shellProfile(profile, thickness) {
  const inner = [];
  for (let i = 0; i < profile.length; i += 1) {
    const [x, y] = profile[i];
    const [px, py] = profile[Math.max(0, i - 1)];
    const [nx, ny] = profile[Math.min(profile.length - 1, i + 1)];
    let tx = nx - px;
    let ty = ny - py;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Inward normal of a profile walked bottom-to-top is (-ty, tx).
    inner.push([Math.max(0.02, x - ty * thickness), y + tx * thickness]);
  }
  inner.reverse();
  return profile.concat(inner);
}

function lathe(THREE, profile, segments, phiStart = 0, phiLength = TAU) {
  const points = profile.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y));
  return new THREE.LatheGeometry(points, segments, phiStart, phiLength);
}

/** Paint a lathed surface so the crest catches light and the
 *  undercut falls away, without the flat-shaded faceting the
 *  masonry archetypes rely on. */
function paintShell(THREE, geo, ramp, opts = {}) {
  geo.computeBoundingBox();
  const lo = opts.min ?? geo.boundingBox.min.y;
  const hi = opts.max ?? geo.boundingBox.max.y;
  const span = Math.max(1e-4, hi - lo);
  const normals = geo.attributes.normal;
  const bias = opts.bias ?? 0.5;
  return paintGeometry(THREE, geo, ramp, (x, y, z, i) => {
    const up = normals ? normals.getY(i) * 0.5 + 0.5 : 0.5;
    const h = (y - lo) / span;
    return clamp01(lerp(h, up, bias) + (opts.lift ?? 0));
  }, { jitter: opts.jitter ?? 0.05 });
}

function makePodMaterials(THREE, atmos) {
  const made = [];
  const mat = (name, spec) => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: false,
      roughness: spec.roughness,
      metalness: spec.metalness,
      emissive: new THREE.Color(spec.emissive || 0x000000),
      emissiveIntensity: spec.emissiveIntensity ?? 1,
      side: spec.side || THREE.FrontSide,
      envMapIntensity: spec.envMapIntensity ?? 1,
    });
    m.name = `sf-pod-${name}`;
    patchMaterial(m, atmos, { rim: spec.rim ?? 0.6 });
    made.push(m);
    return m;
  };
  return {
    all: made,
    /* Glazed ceramic. Kept dielectric: the moment a near-white
       surface takes metalness its albedo becomes specular F0 and it
       stops being white at all - it becomes a mirror of a sand
       basin, which is orange. The same mechanism this project
       already recorded for bronze and for gold. */
    shell: mat("shell", { roughness: 0.30, metalness: 0.04, rim: 0.45 }),
    /* The petals only. Once they swing out their INNER faces are what
       the camera sees, and a single-sided lathe has nothing there -
       the pod opened into four holes. */
    petal: mat("petal", {
      roughness: 0.32, metalness: 0.05, rim: 0.45, side: THREE.DoubleSide,
    }),
    /* Polished, but nowhere near bare metal, for the reason above.
       0.34 keeps a bright directional lobe while the pigment still
       carries the colour. */
    gold: mat("gold", { roughness: 0.20, metalness: 0.34, rim: 0.95 }),
    /* The prow. The only surface that met the atmosphere and then
       met the planet, and the only one allowed to be filthy. */
    ablative: mat("ablative", { roughness: 0.92, metalness: 0.08, rim: 0.70 }),
    /* Interior. Lit from within, so an open pod glows even with the
       sun behind it, and double-sided because the bowl is seen from
       inside through the parted petals. */
    lining: mat("lining", {
      roughness: 0.62, metalness: 0.05, rim: 0.30,
      emissive: 0xffdc9a, emissiveIntensity: 0.22, side: THREE.DoubleSide,
    }),
    /* Seam strips and the halo. */
    halo: mat("halo", {
      roughness: 0.40, metalness: 0.0, rim: 0.20,
      emissive: 0xfff0c8, emissiveIntensity: 3.4,
    }),
  };
}

/* ------------------------------ parts ------------------------------ */

function buildBase(THREE, mats, group) {
  const shellParts = [];
  const goldParts = [];
  const darkParts = [];

  // Hull between the shoulder and the hinge line.
  shellParts.push(lathe(THREE, PROW_PROFILE.filter(([, y]) => y >= 0.70), 56));
  /* The mast. Fixed: it is what the doors fall away from, and what
     is still standing at the drop site a mission later. */
  shellParts.push(lathe(THREE, UPPER_PROFILE.filter(([, y]) => y >= DOOR_TOP), 40));
  /* The prow: blunt, heavy, and the part that arrives first. It is
     the whole reason there is a hole in the ground. */
  darkParts.push(lathe(THREE, PROW_PROFILE.filter(([, y]) => y <= 0.76), 56));

  /* Shoulder collar on the hinge line. It reads as the seam the
     petals part along and hides the gap between them when sealed. */
  const collar = new THREE.TorusGeometry(HINGE_R + 0.035, 0.115, 8, 56);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, HINGE_Y - 0.06, 0);
  goldParts.push(collar);

  // Shoulder rim: the one bright line above all that scorch.
  const rim = new THREE.TorusGeometry(2.29, 0.075, 6, 56);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.72, 0);
  goldParts.push(rim);

  // Where the doors part company with the mast.
  const crown = new THREE.TorusGeometry(1.70, 0.09, 6, 48);
  crown.rotateX(Math.PI / 2);
  crown.translate(0, DOOR_TOP + 0.05, 0);
  goldParts.push(crown);
  for (let i = 0; i < 4; i += 1) {
    const band = new THREE.TorusGeometry(
      UPPER_PROFILE.find(([, y]) => y >= DOOR_TOP + 0.22 + i * 0.24)?.[0] ?? 1.0,
      0.042, 5, 32);
    band.rotateX(Math.PI / 2);
    band.translate(0, DOOR_TOP + 0.22 + i * 0.24, 0);
    goldParts.push(band);
  }

  /* Impact ribs down the prow. Where a lander would carry nozzles
     this carries structure, because the load it is built for is a
     planet rather than a burn. */
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU;
    const rib = lathe(THREE, [
      [1.42, -0.10], [1.82, 0.16], [2.14, 0.46], [2.34, 0.72],
    ], 2, a - 0.075, 0.15);
    darkParts.push(rib);
  }

  const shell = new THREE.Mesh(
    paintShell(THREE, mergeGeometries(THREE, shellParts), SHELL_RAMP,
      { bias: 0.62, lift: 0.06 }), mats.shell);
  shell.name = "pod-lower-hull";
  const dark = new THREE.Mesh(
    paintShell(THREE, mergeGeometries(THREE, darkParts), ABLATIVE_RAMP,
      { bias: 0.5 }), mats.ablative);
  dark.name = "pod-impact-prow";
  const gold = new THREE.Mesh(
    paintShell(THREE, mergeGeometries(THREE, goldParts), GOLD_RAMP,
      { bias: 0.7, lift: 0.1 }), mats.gold);
  gold.name = "pod-lower-trim";

  /* Curved hull tessellation produces triangles smaller than the
     collision grid's clutter threshold. These are structural surfaces,
     not brush-through trim, so collision must rasterise the complete
     shipped mesh even though each individual facet is small. */
  shell.userData.collisionSolid = true;
  dark.userData.collisionSolid = true;

  for (const m of [shell, dark, gold]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { shell, dark, gold };
}

/** The lit cradle. Only ever seen through parted petals - but a
 *  smooth glowing bowl behind an opening door reads as a lampshade,
 *  not as somewhere a soldier just rode down from orbit. It needs
 *  ribs to catch the light and a throne to give it a scale. */
function buildInterior(THREE, mats, group) {
  const shellParts = [];
  const trimParts = [];

  /* A 250-degree bowl, OPEN toward the hatch. Lathed all the way
     round, the cradle's own back wall stands between the camera and
     everything inside it: the pod parted its petals to reveal a
     smooth glowing cylinder, which is a lampshade. The gap is what
     lets the throne, the ribs and the light actually be seen. */
  const BOWL_GAP = 1.92;
  const bowlArc = TAU - BOWL_GAP;
  shellParts.push(lathe(THREE, [
    [1.84, 0.58], [1.88, 1.10], [1.90, 1.90], [1.90, 2.70],
    [1.86, 3.40], [1.82, 4.10], [1.74, 4.70], [1.58, 5.30],
  ], 26, BOWL_GAP / 2, bowlArc));
  const floor = new THREE.CylinderGeometry(1.84, 1.70, 0.16, 28);
  floor.translate(0, 0.60, 0);
  shellParts.push(floor);

  // Ribs up the inside of the bowl, skipping the open sector.
  for (let i = 0; i < 7; i += 1) {
    const rib = lathe(THREE, [
      [1.79, 0.70], [1.83, 1.90], [1.83, 2.80], [1.74, 3.60], [1.50, 4.40],
    ], 2, -0.045, 0.09);
    rib.rotateY(BOWL_GAP / 2 + ((i + 0.5) / 7) * bowlArc);
    trimParts.push(rib);
  }

  /* Restraint throne, facing the hatch. Built in TRIM, not lining:
     the lining is emissive, and a 1.15m emissive backrest square-on
     to the opening was simply the brightest thing in the frame - a
     white slab where a seat should be. */
  const seat = new THREE.BoxGeometry(1.05, 0.16, 0.9);
  seat.translate(0, 1.18, -0.62);
  trimParts.push(seat);
  const back = new THREE.BoxGeometry(1.0, 1.7, 0.16);
  back.rotateX(-0.12);
  back.translate(0, 2.0, -1.08);
  trimParts.push(back);
  for (const side of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6);
    post.rotateX(0.42);
    post.translate(side * 0.5, 0.55, -0.36);
    trimParts.push(post);
    const harness = new THREE.BoxGeometry(0.12, 1.25, 0.1);
    harness.rotateZ(side * 0.30);
    harness.translate(side * 0.34, 2.16, -0.86);
    trimParts.push(harness);
  }

  const bowl = new THREE.Mesh(
    paintShell(THREE, mergeGeometries(THREE, shellParts), makeRamp([
      [0.00, "#5d4c33"], [0.40, "#a08654"], [0.75, "#d9bb80"], [1.00, "#fff2cf"],
    ]), { bias: 0.35, lift: 0.12 }), mats.lining);
  bowl.name = "pod-interior-cradle";
  bowl.userData.collisionSolid = true;
  bowl.receiveShadow = true;
  group.add(bowl);

  const trim = new THREE.Mesh(
    paintShell(THREE, mergeGeometries(THREE, trimParts), GOLD_RAMP,
      { bias: 0.6, lift: 0.22 }), mats.gold);
  trim.name = "pod-interior-trim";
  group.add(trim);
  return { bowl, trim };
}

/** Four hinged hull petals. Sealed they ARE the upper hull; blown,
 *  the front one is the ramp and the other three are the reason the
 *  silhouette reads as a reliquary rather than as wreckage. */
function buildPetals(THREE, mats, group) {
  const arc = TAU / PETALS - 0.055;
  const petals = [];
  for (let i = 0; i < PETALS; i += 1) {
    const pivot = new THREE.Group();
    pivot.name = `pod-petal-pivot-${i}`;
    pivot.rotation.y = (i / PETALS) * TAU;
    group.add(pivot);

    const hinge = new THREE.Group();
    hinge.name = `pod-petal-hinge-${i}`;
    hinge.position.set(0, HINGE_Y, HINGE_R);
    pivot.add(hinge);

    const doorProfile = UPPER_PROFILE.filter(([, y]) => y <= DOOR_TOP);
    const shellGeo = lathe(THREE, shellProfile(doorProfile, 0.17),
      16, -arc / 2, arc);
    shellGeo.translate(0, -HINGE_Y, -HINGE_R);
    const shell = new THREE.Mesh(
      paintShell(THREE, shellGeo, SHELL_RAMP,
        { min: -HINGE_Y, max: DOOR_TOP - HINGE_Y, bias: 0.6, lift: 0.08 }),
      mats.petal);
    shell.name = `pod-petal-${i}`;
    shell.userData.collisionSolid = true;
    shell.castShadow = true;
    shell.receiveShadow = true;
    hinge.add(shell);

    /* Trim: a raised spine along each edge of the petal, and a cap
       band near the tip. The spines are what make four identical
       shells read as a hinged flower once they part - the eye
       follows the gold line, not the ceramic. */
    const trimParts = [];
    for (const edge of [-1, 1]) {
      trimParts.push(lathe(THREE, doorProfile.map(([x, y]) => [x + 0.05, y]),
        2, edge * (arc / 2 - 0.020), 0.040));
    }
    // Lip band across the free edge, so the door ends in a rail.
    trimParts.push(lathe(THREE, [[1.76, DOOR_TOP - 0.12], [1.83, DOOR_TOP - 0.02],
      [1.76, DOOR_TOP + 0.06]], 14, -arc / 2, arc));
    trimParts.push(lathe(THREE, [[2.09, 2.36], [2.15, 2.44], [2.09, 2.52]],
      14, -arc / 2, arc));
    /* Cleats across the inner face. Once a door is lying across a
       crater it is a walking surface, and a walking surface with
       nothing on it reads as a slide. */
    for (let c = 0; c < 5; c += 1) {
      const at = 1.70 + c * 0.72;
      trimParts.push(lathe(THREE, [[2.02, at], [1.98, at + 0.03], [2.02, at + 0.14]],
        12, -arc / 2 + 0.06, arc - 0.12));
    }
    const trimGeo = mergeGeometries(THREE, trimParts);
    trimGeo.translate(0, -HINGE_Y, -HINGE_R);
    const trim = new THREE.Mesh(
      paintShell(THREE, trimGeo, GOLD_RAMP,
        { min: -HINGE_Y, max: DOOR_TOP - HINGE_Y, bias: 0.72, lift: 0.12 }),
      mats.gold);
    trim.name = `pod-petal-trim-${i}`;
    trim.castShadow = true;
    hinge.add(trim);

    /* The seam light. Sealed it is a hairline; open it is the source
       of the spill on the ground. It rides the petal so it travels
       with the opening edge. */
    const seamGeo = lathe(THREE, doorProfile
      .filter(([, y]) => y > 1.35)
      .map(([x, y]) => [x - 0.02, y]), 2, arc / 2 - 0.05, 0.04);
    seamGeo.translate(0, -HINGE_Y, -HINGE_R);
    const seam = new THREE.Mesh(paintFlat(THREE, seamGeo, "#fff4d2"), mats.halo);
    seam.name = `pod-petal-seam-${i}`;
    hinge.add(seam);

    petals.push({ pivot, hinge, shell, trim, seam, index: i });
  }
  return petals;
}

/** The halo: two counter-rotating rings above the nose and a soft
 *  shaft climbing out of them. This is the whole "heavenly" read in
 *  three draw calls, and it is what identifies the drop site from
 *  the far side of the basin once the cinematic is over. */
function buildHalo(THREE, mats, glowMat, group) {
  const halo = new THREE.Group();
  halo.name = "pod-halo";
  halo.position.set(0, POD_HEIGHT + 1.15, 0);
  group.add(halo);

  const ring = (radius, tube, segs, tilt, hex) => {
    const g = new THREE.TorusGeometry(radius, tube, 6, segs);
    g.rotateX(Math.PI / 2);
    if (tilt) g.rotateZ(tilt);
    const m = new THREE.Mesh(paintFlat(THREE, g, hex), mats.halo);
    m.userData.noCollide = true;
    halo.add(m);
    return m;
  };
  const outer = ring(2.35, 0.055, 72, 0, "#ffeaae");
  outer.name = "pod-halo-outer";
  const inner = ring(1.55, 0.038, 56, 0.22, "#fffbe6");
  inner.name = "pod-halo-inner";

  const shaftGeo = new THREE.CylinderGeometry(0.55, 2.1, 26, 18, 1, true);
  shaftGeo.translate(0, 13, 0);
  paintGeometry(THREE, shaftGeo, makeRamp([
    [0.00, "#050403"], [0.30, "#3a3020"], [0.70, "#b79758"], [1.00, "#fff3cd"],
  ]), (x, y) => clamp01(1 - y / 26));
  const shaft = new THREE.Mesh(shaftGeo, glowMat);
  shaft.name = "pod-halo-shaft";
  shaft.renderOrder = 3;
  shaft.userData.noCollide = true;
  halo.add(shaft);

  return { halo, outer, inner, shaft };
}

/* ------------------------------ module ------------------------------ */

/**
 * Build the lander and add it to the live scene.
 *
 * @param {object} ctx  shared Saintfall context (THREE, scene, atmos, terrain)
 * @param {object} site {x, z, yaw} - the landed transform, in world space
 */
export function buildPod(ctx, site) {
  const { THREE } = ctx;
  const mats = makePodMaterials(THREE, ctx.atmos);
  const glowMat = ctx.materials.glow;

  const root = new THREE.Group();
  root.name = "saintfall-drop-pod";
  ctx.scene.add(root);

  /* `heightAt` at the axis is the CRATER FLOOR - terrain.js composes
     the dish into the height field - so the hull only has to sink
     the last little way past it. */
  const groundY = ctx.terrain?.heightAt
    ? ctx.terrain.heightAt(site.x, site.z) : 0;
  const restY = groundY + POD_SINK;

  const base = buildBase(THREE, mats, root);
  const cradle = buildInterior(THREE, mats, root);
  const petals = buildPetals(THREE, mats, root);
  const haloRig = buildHalo(THREE, mats, glowMat, root);

  /* Keep the original lander as the zero-network fallback, but replace
     every visible surface when the approved Meshy pair is available.
     Direct-gameplay QA deliberately loads only the opened model. */
  const proceduralMeshes = [];
  root.traverse((node) => {
    if (node.isMesh) proceduralMeshes.push(node);
  });
  const introModels = ctx.introVehicles?.models || {};
  const openVisual = instantiateIntroVehicle(ctx, introModels.openPod, {
    name: "sanctum-drop-pod-open",
    atmosphere: true,
    envMapIntensity: 0.94,
    collision: "solid",
  });
  const closedVisual = instantiateIntroVehicle(ctx, introModels.closedPod, {
    name: "sanctum-drop-pod-closed",
    atmosphere: true,
    envMapIntensity: 0.94,
    collision: "none",
    castShadow: false,
  });
  const authoredMode = !!openVisual
    && (!ctx.introVehicles?.includeFlight || !!closedVisual);
  const authoredVisuals = [closedVisual, openVisual].filter(Boolean);

  /* Both source models are centred and share a vertical Y axis. Fit the
     complete halo-to-prow silhouette to the established 8.15m envelope,
     then pin the impact point to the procedural pod's -0.55m datum. */
  for (const visual of authoredVisuals) {
    const scale = 8.15 / visual.asset.size.y;
    const yaw = 0;
    visual.root.scale.setScalar(scale);
    visual.root.rotation.y = yaw;
    const centreOffset = visual.asset.center.clone()
      .multiplyScalar(scale)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    visual.root.position.set(
      -centreOffset.x,
      -0.55 - visual.asset.box.min.y * scale,
      -centreOffset.z,
    );
    root.add(visual.root);
    for (const material of visual.materials) {
      material.userData.sfIntroBase = {
        color: material.color?.clone?.() || null,
        emissive: material.emissive?.clone?.() || null,
        emissiveIntensity: material.emissiveIntensity ?? 1,
        opacity: material.opacity ?? 1,
        transparent: !!material.transparent,
        depthWrite: material.depthWrite !== false,
      };
    }
  }

  /* Collision is baked while the pod is landed and open. The hidden
     procedural hull and sealed Meshy state must never become invisible
     walls beside the model the player can actually see. */
  if (authoredMode) {
    for (const mesh of proceduralMeshes) mesh.userData.noCollide = true;
  } else {
    /* Never mix half of the authored pair with the procedural fallback.
       Collision ignores visibility, so a partially loaded open GLB must
       also surrender its structural tag before the grid is baked. */
    for (const visual of authoredVisuals) {
      visual.root.visible = false;
      for (const mesh of visual.meshes) {
        mesh.userData.noCollide = true;
        delete mesh.userData.collisionSolid;
      }
    }
  }

  /* One practical, so the pod actually lights the sand it sits in.
     Without it an "open, glowing" pod is a bright texture next to
     unlit ground and the spill has to be faked in the overlay.

     SCENE-PARENTED, NOT HULL-PARENTED. The drop cinematic lends the
     hull to its isolated orbital scene at boot and returns it at
     cloud break - and a light that rides along leaves and re-enters
     the level's light state with it. A light entering a scene changes
     the visible light count, which re-keys and recompiles every lit
     material in the level (the 198ms Aegis freeze; multi-second on
     Windows/ANGLE) - and because the boot warm-up had compiled
     against the pod-less count, the cloud-break frame paid it for the
     whole world at once. The lamp therefore lives in the level scene
     permanently; land() pins it to the landed interior point, which
     is the only pose in which the interior glow has anything to
     light. While the hull flies, the glow is near zero and the pinned
     lamp is invisible. */
  const spill = new THREE.PointLight(0xffd79a, 0, 26, 2);
  spill.name = "pod-interior-spill";
  const spillSocket = new THREE.Object3D();
  spillSocket.name = "pod-interior-spill-socket";
  spillSocket.position.set(0, 2.4, 0.8);
  root.add(spillSocket);
  ctx.scene.add(spill);

  /* Entry heat is a uniform-free effect: the prow goes incandescent
     and the shell sooties. Storing the authored colours once lets
     `setHeat` interpolate them every frame without ever re-painting
     geometry. */
  const ceramics = [mats.shell, mats.petal];
  const shellColour = mats.shell.color.clone();
  const goldEmissive = mats.gold.emissive.clone();
  const tintCeramic = (r, g, b) => {
    for (const m of ceramics) m.color.setRGB(r, g, b);
  };

  const pose = { petals: 1, glow: 1, halo: 1, heat: 0 };
  let authoredScorch = 0;

  function setVisualAlpha(visual, alpha) {
    if (!visual) return;
    const a = clamp01(alpha);
    visual.root.visible = a > 0.01;
    for (const material of visual.materials) {
      const baseMat = material.userData.sfIntroBase;
      if (!baseMat) continue;
      material.opacity = baseMat.opacity * a;
      const translucent = a < 0.995 || baseMat.transparent;
      if (material.transparent !== translucent) {
        material.transparent = translucent;
        material.needsUpdate = true;
      }
      material.depthWrite = a >= 0.995 && baseMat.depthWrite;
    }
  }

  function refreshAuthoredFinish() {
    if (!authoredMode) return;
    const heat = pose.heat;
    const soot = Math.max(heat * 0.52, authoredScorch * 0.30);
    for (const visual of authoredVisuals) {
      for (const material of visual.materials) {
        const baseMat = material.userData.sfIntroBase;
        if (!baseMat) continue;
        if (baseMat.color && material.color) {
          material.color.copy(baseMat.color);
          material.color.multiplyScalar(1 - soot);
          if (heat > 0.01) {
            material.color.r = Math.min(1, material.color.r + heat * 0.12);
            material.color.g *= 1 - heat * 0.13;
            material.color.b *= 1 - heat * 0.24;
          }
        }
        if (baseMat.emissive && material.emissive) {
          material.emissive.copy(baseMat.emissive);
          material.emissive.r = Math.min(1, material.emissive.r + heat * 0.82);
          material.emissive.g = Math.min(1, material.emissive.g + heat * heat * 0.24);
          material.emissive.b = Math.min(1, material.emissive.b + heat * heat * 0.04);
          material.emissiveIntensity = baseMat.emissiveIntensity + heat * 1.35;
        }
      }
    }
  }

  function refreshAuthoredState() {
    if (!authoredMode) return;
    for (const mesh of proceduralMeshes) mesh.visible = false;
    const open = smootherstep(clamp01((pose.petals - 0.08) / 0.84));
    setVisualAlpha(closedVisual, 1 - open);
    setVisualAlpha(openVisual, open);
  }

  function refreshSeams() {
    mats.halo.emissiveIntensity = lerp(1.1, 4.2, smootherstep(pose.petals)) * pose.glow;
    for (const petal of petals) petal.seam.visible = pose.glow > 0.02;
  }

  function setPetals(v) {
    pose.petals = clamp01(v);
    for (const petal of petals) {
      /* The front petal is thrown furthest and first - it is the one
         the player walks out over, and a symmetric bloom reads as a
         machine rather than as something that blew open. */
      const front = petal.index === 0;
      const delay = front ? 0 : 0.10 + (petal.index % 2) * 0.05;
      const local = smootherstep(clamp01((pose.petals - delay) / (1 - delay)));
      petal.hinge.rotation.x = local * (front ? DOOR_FRONT : DOOR_SIDE);
    }
    refreshSeams();
    refreshAuthoredState();
  }

  function setGlow(v) {
    pose.glow = clamp01(v);
    spill.intensity = pose.glow * 5.4;
    mats.lining.emissiveIntensity = 0.08 + pose.glow * 0.40;
    refreshSeams();
    refreshAuthoredState();
  }

  function setHalo(v) {
    pose.halo = clamp01(v);
    haloRig.halo.visible = pose.halo > 0.01;
    haloRig.halo.scale.setScalar(0.55 + pose.halo * 0.45);
    haloRig.shaft.visible = pose.halo > 0.35;
    refreshAuthoredState();
  }

  function setHeat(v) {
    const h = clamp01(v);
    /* Scorch is multiplicative on the shell and additive on the
       trim, because that is how the two actually fail: the ceramic
       greys under soot, the gold runs incandescent before it dulls. */
    tintCeramic(
      shellColour.r * lerp(1, 0.52, h),
      shellColour.g * lerp(1, 0.44, h),
      shellColour.b * lerp(1, 0.40, h),
    );
    mats.ablative.emissive.setRGB(h * 0.95, h * h * 0.30, h * h * 0.05);
    mats.ablative.emissiveIntensity = h * 2.6;
    mats.gold.emissive.setRGB(
      goldEmissive.r + h * 0.62, goldEmissive.g + h * 0.22, goldEmissive.b,
    );
    mats.gold.emissiveIntensity = h * 1.5;
    pose.heat = h;
    refreshAuthoredFinish();
  }

  /** Permanent scorch, applied once at landfall. A pod that came
   *  through 90km of atmosphere and comes to rest showroom-white is
   *  the single most common tell that a landing was a cutscene. */
  function scorch(amount = 0.42) {
    const h = clamp01(amount);
    tintCeramic(
      shellColour.r * lerp(1, 0.70, h),
      shellColour.g * lerp(1, 0.66, h),
      shellColour.b * lerp(1, 0.62, h),
    );
    mats.ablative.emissive.setRGB(0, 0, 0);
    mats.ablative.emissiveIntensity = 0;
    mats.gold.emissive.copy(goldEmissive);
    mats.gold.emissiveIntensity = 1;
    pose.heat = 0;
    authoredScorch = h;
    refreshAuthoredFinish();
  }

  let clock = 0;
  function update(dt) {
    clock += dt;
    haloRig.outer.rotation.y += dt * 0.24;
    haloRig.inner.rotation.y -= dt * 0.41;
    haloRig.halo.position.y = POD_HEIGHT + 1.15 + Math.sin(clock * 0.7) * 0.11;
    if (pose.glow > 0.01) {
      spill.intensity = pose.glow * (5.0 + Math.sin(clock * 1.7) * 0.5);
    }
    return clock;
  }

  /** Put the pod exactly where the level expects to find it. */
  function land() {
    root.position.set(site.x, restY, site.z);
    root.rotation.set(POD_LANDED_PITCH, site.yaw, POD_LANDED_ROLL);
    root.visible = true;
    /* Pin the scene-parented interior lamp to the landed hull. Done
       here, not per frame: the hull only ever glows meaningfully in
       this pose, and following the flight would mean the light
       leaving the scene with the borrowed hull (see its note above). */
    root.updateMatrixWorld(true);
    spillSocket.getWorldPosition(spill.position);
    setPetals(1);
    setGlow(1);
    setHalo(1);
    scorch();
  }

  /** Sealed and unscorched - the state the cinematic starts from and
   *  the only one in which the silhouette is a clean ogive. */
  function seal() {
    setPetals(0);
    setGlow(0.32);
    setHalo(0.75);
    setHeat(0);
  }

  land();

  return {
    root,
    materials: mats,
    parts: {
      base, cradle, petals, halo: haloRig, spill,
      authored: { enabled: authoredMode, closed: closedVisual, open: openVisual },
    },
    /** World Y of the landed hull origin, and of the crater floor. */
    restY,
    groundY,
    site,
    height: POD_HEIGHT,
    radius: POD_RADIUS,
    /** Axis-to-door-lip, so the egress mark is never guessed. */
    doorReach: POD_DOOR_REACH,
    get pose() { return { ...pose }; },
    setPetals,
    setGlow,
    setHalo,
    setHeat,
    scorch,
    update,
    land,
    seal,
    setTransform(x, y, z, rx = 0, ry = site.yaw, rz = 0) {
      root.position.set(x, y, z);
      root.rotation.set(rx, ry, rz);
    },
    setVisible(v) { root.visible = !!v; },
    /** Draw-call and triangle census, for the intro's scene budget. */
    diagnostics() {
      let meshes = 0;
      let triangles = 0;
      root.traverse((n) => {
        if (!n.isMesh || !n.visible) return;
        meshes += 1;
        const g = n.geometry;
        const count = g.index ? g.index.count : (g.attributes.position?.count || 0);
        triangles += count / 3;
      });
      return {
        meshes,
        triangles: Math.round(triangles),
        materials: mats.all.length
          + authoredVisuals.reduce((sum, visual) => sum + visual.materials.length, 0),
        authored: authoredMode,
        closedAsset: closedVisual?.asset.file || null,
        openAsset: openVisual?.asset.file || null,
      };
    },
  };
}
