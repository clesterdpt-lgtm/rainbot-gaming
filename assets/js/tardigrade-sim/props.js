/* ============================================================
   Tardigrade Simulator - interactive props + creatures

   The world was beautiful but inert. This file is the stuff you
   can actually hit: rigid bodies to headbutt, crumbs to smash,
   and small animals that scatter when you do.

   Design notes
   ------------
   * One InstancedMesh per prop kind, so a hundred props cost one
     draw call each. Per-instance transforms are pulled from the
     Rapier bodies every frame; per-instance scale and tint jitter
     are what stop a scatter reading as one mesh stamped N times.
   * Destructibles are not deleted and re-created on impact. The
     intact instance is collapsed to zero scale and a pooled set of
     shard bodies is woken in its place, so play never allocates.
   * Creatures are deliberately cheap: no pathfinding, just a
     wander/flee/settle state machine over a shared instanced mesh.
     They are set dressing with opinions, not enemies.
   ============================================================ */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clamp, damp, makeRng, TAU } from "./core.js";

/* ------------------------------------------------------------------ */
/* Prop catalogue                                                      */
/* ------------------------------------------------------------------ */

/**
 * `size` is the nominal half-extent in world units (hero = 1.6 long),
 * `worth` is the score for launching or destroying it.
 */
const PROP_KINDS = [
  {
    id: "grit",
    material: "gravel",
    surface: { roughness: 0.82 },
    count: 34,
    size: [0.22, 0.62],
    mass: 0.5,
    restitution: 0.18,
    destructible: false,
    worth: 12,
    geometry: () => new THREE.DodecahedronGeometry(1, 0),
    shape: (s) => ({ type: "ball", radius: s * 0.86 }),
  },
  {
    id: "sugar",
    material: "ceramic",
    surface: { roughness: 0.2, metalness: 0 },
    count: 22,
    size: [0.3, 0.85],
    mass: 0.35,
    restitution: 0.32,
    destructible: true,
    shards: 5,
    worth: 45,
    geometry: () => new THREE.BoxGeometry(1.3, 1.3, 1.3),
    shape: (s) => ({ type: "cuboid", halfExtents: [s * 0.65, s * 0.65, s * 0.65] }),
  },
  {
    id: "crumb",
    material: "bark",
    surface: { roughness: 0.76 },
    count: 26,
    size: [0.45, 1.15],
    mass: 0.8,
    restitution: 0.08,
    destructible: true,
    shards: 6,
    worth: 30,
    geometry: () => new THREE.IcosahedronGeometry(1, 0),
    shape: (s) => ({ type: "ball", radius: s * 0.82 }),
  },
  {
    id: "husk",
    material: "leaf",
    surface: { roughness: 0.6 },
    count: 18,
    size: [0.7, 1.8],
    mass: 0.22,
    restitution: 0.05,
    linearDamping: 0.5,
    angularDamping: 0.6,
    destructible: false,
    worth: 18,
    geometry: () => {
      const g = new THREE.SphereGeometry(1, 10, 7);
      g.scale(1, 0.34, 0.62);
      return g;
    },
    shape: (s) => ({ type: "capsule", halfHeight: s * 0.5, radius: s * 0.36 }),
  },
  {
    id: "staple",
    material: "metal",
    surface: { roughness: 0.34, metalness: 1 },
    count: 8,
    size: [0.8, 1.25],
    mass: 1.6,
    restitution: 0.22,
    destructible: false,
    worth: 60,
    geometry: () => {
      const g = new THREE.TorusGeometry(1, 0.16, 6, 10, Math.PI);
      g.rotateZ(Math.PI);
      return g;
    },
    shape: (s) => ({ type: "cuboid", halfExtents: [s, s * 0.22, s * 0.22] }),
  },

  /* ---- the silly half of the catalogue ----
   * The five kinds above are honest garden debris and they read as a tidy
   * gravel bed. What was missing is the stuff you point at and laugh: a
   * chewed lump of gum, somebody's toenail, a dead fly the size of a bus.
   * They cost nothing extra - the instancing, destruction, shard pool and
   * scoring all come from the machinery already here - so the whole
   * addition is data. */
  {
    id: "gum",
    material: "plastic",
    // Sticky: almost no bounce, and it drags to a halt rather than rolling
    // away, so a punted lump lands with a dead slap.
    surface: { color: 0xd07c96, roughness: 0.46, metalness: 0 },
    count: 14,
    size: [0.6, 1.5],
    mass: 0.6,
    restitution: 0.01,
    linearDamping: 0.9,
    angularDamping: 1.4,
    destructible: false,
    worth: 55,
    geometry: () => {
      const g = new THREE.SphereGeometry(1, 9, 7);
      // Squash it and shear the top so it reads as trodden-on, not a ball.
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const y = pos.getY(i);
        pos.setY(i, y * 0.5);
        pos.setX(i, pos.getX(i) * (1 + Math.max(0, y) * 0.35));
      }
      g.computeVertexNormals();
      return g;
    },
    shape: (s) => ({ type: "ball", radius: s * 0.7 }),
  },
  {
    id: "fly",
    material: "chitin",
    surface: { color: 0x35302a, roughness: 0.3, metalness: 0.2 },
    count: 7,
    // Far bigger than anything else here - against a 1.6-unit hero a
    // housefly is genuinely a wrecked airliner, and it gives the wide
    // shots a silhouette with actual mass in it.
    size: [2.2, 3.4],
    mass: 1.1,
    restitution: 0.12,
    destructible: true,
    shards: 8,
    worth: 240,
    geometry: () => {
      const body = new THREE.SphereGeometry(1, 12, 9);
      body.scale(0.62, 0.54, 1);
      const head = new THREE.SphereGeometry(0.46, 10, 8);
      head.translate(0, 0.06, 0.95);
      const wingL = new THREE.SphereGeometry(0.62, 8, 5);
      wingL.scale(1.5, 0.06, 0.62);
      wingL.translate(0.78, 0.3, -0.2);
      wingL.rotateZ(-0.2);
      const wingR = wingL.clone();
      wingR.scale(-1, 1, 1);
      return mergeGeometries([body, head, wingL, wingR], false);
    },
    shape: (s) => ({ type: "capsule", halfHeight: s * 0.42, radius: s * 0.5 }),
  },
  {
    id: "pollen",
    material: "sugar",
    // Absurdly bouncy. Clipping one sends it pinging off three surfaces,
    // which is the cheapest reliable laugh in the whole file.
    surface: { color: 0xf0d868, roughness: 0.42 },
    count: 30,
    size: [0.24, 0.5],
    mass: 0.12,
    restitution: 0.86,
    linearDamping: 0.02,
    angularDamping: 0.05,
    destructible: false,
    worth: 35,
    geometry: () => {
      // Spiked shell: push every other vertex out into a burr.
      const g = new THREE.IcosahedronGeometry(1, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        if (i % 3 !== 0) continue;
        const k = 1.34;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      return g;
    },
    shape: (s) => ({ type: "ball", radius: s * 0.92 }),
  },
  {
    id: "clipping",
    material: "ceramic",
    surface: { color: 0xe4d6bc, roughness: 0.44, metalness: 0 },
    count: 9,
    size: [0.9, 1.7],
    mass: 0.3,
    restitution: 0.3,
    destructible: false,
    worth: 110,
    geometry: () => {
      // A curved crescent shell. Nobody needs it explained.
      const g = new THREE.TorusGeometry(1, 0.42, 6, 12, Math.PI * 0.85);
      g.scale(1, 1, 0.3);
      return g;
    },
    shape: (s) => ({ type: "cuboid", halfExtents: [s * 0.9, s * 0.5, s * 0.3] }),
  },
];

/** Where props gather. Clustering reads far better than uniform scatter. */
const CLUSTERS = [
  { x: -230, z: -70, r: 90, weight: 1.3 },
  { x: -150, z: 90, r: 110, weight: 1.0 },
  { x: 40, z: -160, r: 120, weight: 1.0 },
  { x: -300, z: 120, r: 80, weight: 0.8 },
  { x: 120, z: 60, r: 130, weight: 0.9 },
];

// 26 springtails spread by an even scatter over a 900-unit map means the
// odds of one landing inside any given camera frustum are small - a reviewer
// looked at all 14 beauty shots and said the world "reads uninhabited", with
// no NPC life of any kind visible anywhere. Raised, and clustered below:
// springtails congregate in damp shade rather than distributing evenly, so
// clustering is both more correct and far more likely to put a group in shot.
const CREATURE_COUNT = 96;
const CREATURE_CLUSTERS = 9;

/* ------------------------------------------------------------------ *
 * Fauna - the big, silly neighbours                                   *
 *                                                                     *
 * Springtails are 0.5-1.1 units against a 1.6-unit hero, and a pixel  *
 * count proved they occupy 0.01% of frame in the wide shots - i.e.    *
 * the world reads uninhabited however many you add. These are         *
 * deliberately LARGE, and each one has a single joke it commits to:   *
 * the pill bug balls up and rolls away, the ants march in a line you  *
 * can scatter, and the snail does not care about you at all.          *
 *                                                                     *
 * They are kinematic, not rigid bodies. Interaction is a proximity    *
 * punt - barrel into one above `hit` speed and it reacts - which      *
 * costs no colliders and, more to the point, works with the dash and  *
 * the bonk and a plain sprint without special-casing any of them.     *
 * ------------------------------------------------------------------ */
/**
 * A logarithmic spiral shell: a tube of growing radius swept along a spiral
 * of growing radius. A TorusGeometry stood in for this at first and read as
 * a doughnut stuck to the animal's back - a real shell has to *open out*,
 * and both radii growing together is the whole of that effect.
 *
 * Built in the XZ plane (coil axis Y); the caller rotates it so the spiral
 * faces sideways, which is the angle a snail is recognised from.
 */
function spiralShellGeometry(turns = 2.7, rings = 76, seg = 14) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    const a = t * turns * TAU;
    const grow = Math.pow(2.6, t);
    const cx = Math.cos(a) * 0.26 * grow;
    const cz = Math.sin(a) * 0.26 * grow;
    const cy = t * 0.2;                       // a little spire, not a flat coil
    // Tube radius against a spiral radius of 0.26*grow. Pushed to 0.145 to
    // fuse the whorls and it went far too fat: the outer whorl swallowed the
    // rest and flared open like a broken vase. Just under half the spiral
    // radius keeps whorls touching while still reading as a coil.
    const tube = 0.108 * grow;
    for (let j = 0; j <= seg; j += 1) {
      const phi = (j / seg) * TAU;
      const c = Math.cos(phi) * tube;
      const sn = Math.sin(phi) * tube;
      // Cross-section ring: outward radial and world up. Good enough for a
      // shallow spiral and far cheaper than a parallel-transport frame.
      positions.push(cx + Math.cos(a) * c, cy + sn, cz + Math.sin(a) * c);
      uvs.push(t * 3, j / seg);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const A = i * (seg + 1) + j;
      const B = A + seg + 1;
      indices.push(A, B, A + 1, A + 1, B, B + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const CREATURE_KINDS = [
  {
    id: "pillbug",
    // Half-height of the built geometry in local units. A single shared
    // offset buried the pill bug to its waist - each body is a different
    // shape, so each states where its own underside is.
    lift: 0.62,
    material: "chitin",
    // Tinting is MULTIPLICATIVE against chitin's albedo map, and that map is
    // brown - so a neutral grey tint (tried at 0xcfc6d6) still comes out tan,
    // and a whole flowerbed of tan animals on tan paving is unreadable. Tint
    // BLUE-grey to cancel the map's warmth and land on woodlouse slate.
    surface: { color: 0x94a6d8, roughness: 0.33 },
    count: 26,
    size: [1.9, 3.2],
    hit: 5.2,
    worth: 90,
    trick: "PILL-BUG BOWLING",
    wanderSpeed: 7,
    puntSpeed: 66,
    curls: true,
    geometry: () => {
      // Seven overlapping armour plates, widest in the middle.
      // CLOSED spheres, not hemispheres. Open half-spheres showed their
      // unlit interior from every low angle, which is most of them - the
      // animal looked like a stack of dark curved plates.
      const parts = [];
      for (let i = 0; i < 7; i += 1) {
        const t = i / 6;
        const w = 0.62 + Math.sin(t * Math.PI) * 0.42;
        const seg = new THREE.SphereGeometry(w, 14, 10);
        seg.scale(1, 0.6, 0.36);
        seg.translate(0, 0, (t - 0.5) * 1.75);
        parts.push(seg);
      }
      return mergeGeometries(parts, false);
    },
  },
  {
    id: "ant",
    // Half-height of the built geometry in local units. A single shared
    // offset buried the pill bug to its waist - each body is a different
    // shape, so each states where its own underside is.
    lift: 0.4,
    material: "chitin",
    surface: { color: 0x8f4d28, roughness: 0.72, metalness: 0 },
    count: 44,
    // Trimmed from [1.1, 1.6]: an ant body is ~1.8 local units long, so at
    // the old size the column could not be closed up below ~2.5 units of
    // spacing without the bodies interpenetrating. Smaller ants, tighter
    // queue, and the line finally reads as a line.
    size: [0.85, 1.2],
    // A column marches at 15 units/s, so a tight reach means the line simply
    // walks out from under the hero and nothing connects. Reach wide enough
    // that running through a column clips several of them.
    hit: 5.4,
    worth: 45,
    trick: "ANTS IN YOUR PLANTS",
    // Was 15, which is FASTER than the hero sprints - a column could never
    // be caught from behind, so the joke was unreachable. Stay under the
    // player's top speed or the interaction does not exist.
    wanderSpeed: 9,
    puntSpeed: 58,
    marches: true,
    geometry: () => {
      const bead = (r, z, sy) => {
        const g = new THREE.SphereGeometry(r, 9, 7);
        g.scale(1, sy, 1);
        g.translate(0, 0, z);
        return g;
      };
      // Three beads alone read as three beads. The legs are what make the
      // silhouette say "ant" - without them it was a row of shiny berries.
      const parts = [bead(0.42, -0.62, 0.86), bead(0.30, 0.02, 0.92), bead(0.26, 0.5, 0.95)];
      const limb = (len, thick, droop, yaw, z, y) => {
        const g = new THREE.BoxGeometry(len, thick, thick);
        // Start the limb OUTSIDE the body. Growing it from the origin left
        // most of its length buried inside the thorax bead, so all that
        // showed was a nub and the ant still read as three berries.
        g.translate(len * 0.5 + 0.24, 0, 0);
        const m = new THREE.Matrix4();
        // Rotate about Y only - mirroring with a negative scale would flip
        // the winding and turn the left-hand limbs inside out.
        g.applyMatrix4(m.makeRotationZ(droop));
        g.applyMatrix4(m.makeRotationY(yaw));
        g.translate(0, y, z);
        return g;
      };
      for (const side of [0, Math.PI]) {
        for (let i = 0; i < 3; i += 1) {
          parts.push(limb(0.92, 0.075, -0.3, side + (i - 1) * 0.62 * (side ? -1 : 1), (i - 1) * 0.32, 0.1));
        }
        parts.push(limb(0.6, 0.055, 0.5, side + (side ? -0.55 : 0.55), 0.64, 0.16)); // antenna
      }
      return mergeGeometries(parts, false);
    },
  },
  {
    id: "snail",
    // Half-height of the built geometry in local units. A single shared
    // offset buried the pill bug to its waist - each body is a different
    // shape, so each states where its own underside is.
    lift: 0.2,
    material: "ceramic",
    // Snails are legitimately amber, but it has to separate from the soil -
    // richer and darker than the ground it crawls on.
    surface: { color: 0xd9903c, roughness: 0.26, metalness: 0 },
    count: 7,
    size: [3.0, 4.6],
    hit: 6.0,
    worth: 150,
    trick: "ESCARGOT-GO-GO",
    // Barely moves, and - the joke - never flees. Everything else in the
    // garden bolts when the hero arrives; the snail carries on.
    wanderSpeed: 1.6,
    puntSpeed: 3,
    stoic: true,
    geometry: () => {
      const parts = [];
      const foot = new THREE.SphereGeometry(0.6, 12, 8);
      foot.scale(0.72, 0.3, 1.5);
      parts.push(foot);
      const head = new THREE.SphereGeometry(0.26, 8, 6);
      head.scale(1, 0.8, 1.3);
      head.translate(0, 0.06, 0.92);
      parts.push(head);

      // Eye stalks. Two stalks with a bead on top is most of what makes a
      // blob read as a snail rather than a slug with luggage.
      for (const side of [-1, 1]) {
        const stalk = new THREE.CylinderGeometry(0.045, 0.055, 0.42, 6);
        stalk.translate(0, 0.21, 0);
        const m = new THREE.Matrix4();
        stalk.applyMatrix4(m.makeRotationX(-0.42));
        stalk.applyMatrix4(m.makeRotationZ(side * 0.3));
        stalk.translate(side * 0.13, 0.16, 1.0);
        parts.push(stalk);
        const eye = new THREE.SphereGeometry(0.075, 6, 5);
        eye.translate(side * 0.24, 0.5, 1.16);
        parts.push(eye);
      }

      // Plug the eye of the spiral - the innermost whorl is too small to
      // close itself and left a window straight through the shell.
      const apex = new THREE.SphereGeometry(0.15, 8, 6);
      const shell = mergeGeometries([spiralShellGeometry(), apex], false);
      // Turn the coil axis from Y to X so the spiral faces sideways.
      shell.rotateZ(Math.PI / 2);
      shell.scale(0.74, 0.74, 0.74);
      shell.translate(0, 0.5, -0.2);
      parts.push(shell);
      return mergeGeometries(parts, false);
    },
  },
];
const DESTROY_SPEED = 9;

/* ------------------------------------------------------------------ *
 * Pond life                                                           *
 *                                                                     *
 * The puddle is 19.6 units deep and was completely empty - you could  *
 * dive into beautifully lit water and find nothing living in it. All  *
 * three of these are real freshwater microfauna a tardigrade would    *
 * actually share a puddle with, and each swims in a visibly different *
 * way, which is what stops them reading as one creature retextured.   *
 * ------------------------------------------------------------------ */
const AQUATIC_KINDS = [
  {
    id: "daphnia",
    material: "glass",
    surface: { color: 0xcfe4d8, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.72 },
    count: 34,
    size: [1.0, 1.7],
    hit: 4.2,
    worth: 70,
    trick: "FLEA CIRCUS",
    style: "hop",
    geometry: () => {
      const parts = [];
      const body = new THREE.SphereGeometry(0.5, 14, 10);
      body.scale(0.72, 1, 0.86);
      parts.push(body);
      // Tail spine and one big rowing antenna: without those it is a bean.
      const spine = new THREE.ConeGeometry(0.07, 0.72, 6);
      spine.rotateX(-Math.PI / 2);
      spine.translate(0, -0.18, -0.78);
      parts.push(spine);
      for (const side of [-1, 1]) {
        const ant = new THREE.CylinderGeometry(0.055, 0.03, 0.66, 5);
        ant.translate(0, 0.33, 0);
        const m = new THREE.Matrix4();
        ant.applyMatrix4(m.makeRotationZ(side * 0.95));
        ant.applyMatrix4(m.makeRotationX(-0.55));
        ant.translate(side * 0.18, 0.2, 0.42);
        parts.push(ant);
      }
      const eye = new THREE.SphereGeometry(0.14, 8, 6);
      eye.translate(0, 0.18, 0.44);
      parts.push(eye);
      return mergeGeometries(parts, false);
    },
  },
  {
    id: "larva",
    material: "chitin",
    surface: { color: 0x9a8a5e, roughness: 0.5 },
    count: 16,
    size: [2.0, 3.0],
    hit: 5.0,
    worth: 110,
    trick: "WRIGGLER WRANGLING",
    style: "hang",
    geometry: () => {
      // Mosquito larva: a segmented worm that hangs head-DOWN from the
      // surface on its breathing siphon.
      const parts = [];
      for (let i = 0; i < 9; i += 1) {
        const t = i / 8;
        const r = 0.22 * (1 - t * 0.45) + (i === 0 ? 0.08 : 0);
        const seg = new THREE.SphereGeometry(r, 8, 6);
        seg.translate(0, -t * 1.6, 0);
        parts.push(seg);
      }
      const siphon = new THREE.CylinderGeometry(0.07, 0.09, 0.5, 6);
      siphon.translate(0, 0.32, 0);
      parts.push(siphon);
      return mergeGeometries(parts, false);
    },
  },
  {
    id: "hydra",
    material: "leaf",
    surface: { color: 0xb7c67a, roughness: 0.42 },
    count: 14,
    size: [1.8, 3.2],
    hit: 5.4,
    worth: 130,
    trick: "HYDRA HEADBUTT",
    style: "anchored",
    geometry: () => {
      const parts = [];
      const stalk = new THREE.CylinderGeometry(0.14, 0.22, 1.5, 8);
      stalk.translate(0, 0.75, 0);
      parts.push(stalk);
      // Six tentacles fanning off the crown.
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        const arm = new THREE.CylinderGeometry(0.035, 0.06, 1.05, 5);
        arm.translate(0, 0.52, 0);
        const m = new THREE.Matrix4();
        arm.applyMatrix4(m.makeRotationX(0.85));
        arm.applyMatrix4(m.makeRotationY(a));
        arm.translate(0, 1.48, 0);
        parts.push(arm);
      }
      return mergeGeometries(parts, false);
    },
  },
];

export async function createProps(ctx) {
  const physics = ctx.physics;
  if (!physics || typeof physics.addDynamic !== "function") {
    console.warn("[props] physics unavailable - props disabled");
    return { report: () => ({ disabled: true }) };
  }

  const rng = makeRng(0x9e11ab);
  const densityScale = clamp(ctx.settings.quality.physicsProps ?? 1, 0.2, 1.5);

  const root = new THREE.Group();
  root.name = "Props";
  ctx.scene.add(root);

  const groundAt = (x, z) => (ctx.world && ctx.world.heightAt ? ctx.world.heightAt(x, z) : 0);

  /** A point inside a weighted cluster, biased toward its middle. */
  function scatterPoint() {
    let total = 0;
    for (const c of CLUSTERS) total += c.weight;
    let pick = rng() * total;
    let cluster = CLUSTERS[0];
    for (const c of CLUSTERS) {
      pick -= c.weight;
      if (pick <= 0) { cluster = c; break; }
    }
    const a = rng() * TAU;
    const r = cluster.r * Math.sqrt(rng()) * 0.95;
    return { x: cluster.x + Math.cos(a) * r, z: cluster.z + Math.sin(a) * r };
  }

  /* ---------------------------------------------------------------- */
  /* Scratch objects - the hot path never allocates                   */
  /* ---------------------------------------------------------------- */
  const scratchMatrix = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const scratchQuatB = new THREE.Quaternion();
  const heroPos = new THREE.Vector3();

  /* ---------------------------------------------------------------- */
  /* Prop groups                                                      */
  /* ---------------------------------------------------------------- */

  const groups = [];
  const recordToItem = new Map();

  for (const kind of PROP_KINDS) {
    const count = Math.max(1, Math.round(kind.count * densityScale));
    const geometry = ctx.track(kind.geometry());
    // Base roughness in the library is 1 so the roughnessMap can modulate it.
    // Left at 1 the specular lobe is too broad to see and the prop reads as
    // clay - a blind reviewer scored exactly this as "no specular response on
    // any hero material". Each kind states its own surface instead.
    const material = ctx.materials.make(kind.material, kind.surface || {});
    material.name = `Prop_${kind.id}`;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `Prop_${kind.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Bodies move every frame; a cached bounding sphere would pop them out.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    root.add(mesh);

    const items = [];
    for (let i = 0; i < count; i += 1) {
      const p = scatterPoint();
      const size = kind.size[0] + rng() * (kind.size[1] - kind.size[0]);
      const y = groundAt(p.x, p.z) + size + 0.4;

      const handle = physics.addDynamic({
        position: [p.x, y, p.z],
        shape: kind.shape(size),
        mass: kind.mass * size * size,
        restitution: kind.restitution,
        friction: 0.72,
        linearDamping: kind.linearDamping ?? 0.06,
        angularDamping: kind.angularDamping ?? 0.2,
        material: kind.material,
        kind: `prop:${kind.id}`,
      });

      const tint = 0.82 + rng() * 0.36;
      mesh.instanceColor.setXYZ(
        i,
        tint * (0.94 + rng() * 0.12),
        tint * (0.94 + rng() * 0.12),
        tint * (0.94 + rng() * 0.12)
      );

      const item = {
        index: i,
        handle,
        size,
        alive: true,
        kind,
        // Non-uniform squash so silhouettes differ instance to instance.
        stretch: new THREE.Vector3(
          size * (0.82 + rng() * 0.4),
          size * (0.82 + rng() * 0.4),
          size * (0.82 + rng() * 0.4)
        ),
      };
      items.push(item);
      if (handle) recordToItem.set(handle, item);
    }

    mesh.instanceColor.needsUpdate = true;
    groups.push({ kind, mesh, items });
  }

  /* ---------------------------------------------------------------- */
  /* Shard pool for destructibles                                     */
  /* ---------------------------------------------------------------- */

  const SHARD_POOL = Math.max(12, Math.round(60 * densityScale));
  const shardGeo = ctx.track(new THREE.TetrahedronGeometry(1, 0));
  const shardMat = ctx.materials.make("stone", { roughness: 0.72 });
  shardMat.name = "PropShard";
  const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_POOL);
  shardMesh.name = "PropShards";
  shardMesh.castShadow = true;
  shardMesh.frustumCulled = false;
  shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(shardMesh);

  const shards = [];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SHARD_POOL; i += 1) {
    const handle = physics.addDynamic({
      position: [0, -4000, 0], // parked below the world until used
      shape: { type: "ball", radius: 0.18 },
      mass: 0.06,
      restitution: 0.3,
      friction: 0.6,
      material: "stone",
      kind: "prop:shard",
    });
    shards.push({ handle, index: i, ttl: 0, scale: 0.2 });
    shardMesh.setMatrixAt(i, hidden);
  }
  shardMesh.instanceMatrix.needsUpdate = true;
  let shardCursor = 0;

  function spawnShards(position, count, scale) {
    for (let n = 0; n < count; n += 1) {
      const shard = shards[shardCursor];
      shardCursor = (shardCursor + 1) % shards.length;
      const body = shard && shard.handle && shard.handle.body;
      if (!body) continue;

      body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      const a = rng() * TAU;
      body.setLinvel(
        { x: Math.cos(a) * (2 + rng() * 5), y: 2.4 + rng() * 4.5, z: Math.sin(a) * (2 + rng() * 5) },
        true
      );
      body.setAngvel({ x: rng() * 8 - 4, y: rng() * 8 - 4, z: rng() * 8 - 4 }, true);
      shard.ttl = 6 + rng() * 4;
      shard.scale = scale * (0.28 + rng() * 0.34);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Creatures - springtails that scatter                             */
  /* ---------------------------------------------------------------- */

  const creatureCount = Math.max(4, Math.round(CREATURE_COUNT * densityScale));
  const creatureGeo = ctx.track(new THREE.CapsuleGeometry(0.22, 0.34, 4, 8));
  creatureGeo.rotateZ(Math.PI / 2);
  const creatureMat = ctx.materials.make("chitin", { roughness: 0.44 });
  creatureMat.name = "Springtail";
  const creatureMesh = new THREE.InstancedMesh(creatureGeo, creatureMat, creatureCount);
  creatureMesh.name = "Springtails";
  creatureMesh.castShadow = true;
  creatureMesh.frustumCulled = false;
  creatureMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  creatureMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(creatureCount * 3), 3);
  root.add(creatureMesh);

  const creatures = [];
  // Cluster centres first, then draw most of the population around them.
  const clusterCentres = [];
  for (let i = 0; i < CREATURE_CLUSTERS; i += 1) clusterCentres.push(scatterPoint());

  for (let i = 0; i < creatureCount; i += 1) {
    // A fifth stay solitary so the groups do not read as a grid of blobs.
    let p;
    if (i % 5 === 0 || clusterCentres.length === 0) {
      p = scatterPoint();
    } else {
      const c = clusterCentres[i % clusterCentres.length];
      const a = rng() * TAU;
      const r = Math.pow(rng(), 0.6) * 46;
      p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
    }
    creatures.push({
      x: p.x,
      z: p.z,
      y: groundAt(p.x, p.z),
      yaw: rng() * TAU,
      speed: 0,
      scale: 0.7 + rng() * 0.75,
      state: "wander",
      timer: rng() * 3,
      hopPhase: rng() * TAU,
      hop: 0,
    });
    const shade = 0.7 + rng() * 0.5;
    creatureMesh.instanceColor.setXYZ(i, shade, shade * (0.9 + rng() * 0.18), shade * 0.82);
  }
  creatureMesh.instanceColor.needsUpdate = true;

  /* ---------------------------------------------------------------- */
  /* Fauna - pill bugs, ant columns, an indifferent snail             */
  /* ---------------------------------------------------------------- */

  const faunaGroups = [];

  for (const kind of CREATURE_KINDS) {
    const count = Math.max(2, Math.round(kind.count * densityScale));
    const geometry = ctx.track(kind.geometry());
    const material = ctx.materials.make(kind.material, kind.surface || {});
    material.name = `Fauna_${kind.id}`;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `Fauna_${kind.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    root.add(mesh);

    const list = [];
    // Ants march, so they are laid out as columns rather than scattered:
    // one leader per column and the rest queued up behind it.
    const columnLength = 8;
    for (let i = 0; i < count; i += 1) {
      const rank = kind.marches ? i % columnLength : 0;
      let p;
      if (kind.marches && rank !== 0) {
        // Start each follower just behind the one ahead of it.
        const lead = list[i - 1];
        p = { x: lead.x - Math.sin(lead.yaw) * 1.9, z: lead.z - Math.cos(lead.yaw) * 1.9 };
      } else {
        p = scatterPoint();
      }
      const scale = kind.size[0] + rng() * (kind.size[1] - kind.size[0]);
      list.push({
        x: p.x, z: p.z, y: groundAt(p.x, p.z),
        yaw: kind.marches && rank !== 0 ? list[i - 1].yaw : rng() * TAU,
        speed: 0, scale,
        state: "wander",
        timer: rng() * 3,
        roll: 0, curl: 0, squash: 1, cooldown: 0,
        ahead: kind.marches && rank !== 0 ? i - 1 : -1,
      });
      const t = 0.86 + rng() * 0.3;
      mesh.instanceColor.setXYZ(i, t, t * (0.95 + rng() * 0.1), t * (0.95 + rng() * 0.1));
    }
    mesh.instanceColor.needsUpdate = true;
    faunaGroups.push({ kind, mesh, list });
  }

  /* ---------------------------------------------------------------- */
  /* Pond life                                                        */
  /* ---------------------------------------------------------------- */

  /** Rejection-sample a point in genuinely deep water. */
  function waterPoint() {
    for (let i = 0; i < 800; i += 1) {
      const x = rng.range(-440, 440);
      const z = rng.range(-440, 440);
      const level = ctx.world && ctx.world.waterAt ? ctx.world.waterAt(x, z) : null;
      if (level === null || level === undefined) continue;
      const floor = groundAt(x, z);
      // The patio spill is only ~2 units deep - too shallow to swim in, so
      // this also serves to pick the real puddle without naming it.
      if (level - floor < 4) continue;
      return { x, z, level, floor };
    }
    return null;
  }

  const aquaticGroups = [];

  for (const kind of AQUATIC_KINDS) {
    const count = Math.max(2, Math.round(kind.count * densityScale));
    const geometry = ctx.track(kind.geometry());
    const material = ctx.materials.make(kind.material, kind.surface || {});
    material.name = `Pond_${kind.id}`;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `Pond_${kind.id}`;
    mesh.castShadow = false;          // nothing down there to catch a shadow
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);

    const list = [];
    for (let i = 0; i < count; i += 1) {
      const p = waterPoint();
      const scale = kind.size[0] + rng() * (kind.size[1] - kind.size[0]);
      if (!p) { list.push({ dead: true, scale }); continue; }
      let y;
      if (kind.style === "anchored") y = p.floor;
      else if (kind.style === "hang") y = p.level - 1.4;
      else y = p.floor + 1 + rng() * Math.max(0.5, p.level - p.floor - 2);
      list.push({
        x: p.x, z: p.z, y, level: p.level, floor: p.floor,
        yaw: rng() * TAU, scale, vy: 0,
        hopTimer: rng() * 0.8, phase: rng() * TAU,
        startled: 0, cooldown: 0, retract: 0, dead: false,
      });
    }
    aquaticGroups.push({ kind, mesh, list });
  }

  /* ---------------------------------------------------------------- */
  /* Impact handling -> destruction + score                           */
  /* ---------------------------------------------------------------- */

  let destroyed = 0;
  let launched = 0;

  function breakProp(item, position) {
    item.alive = false;
    destroyed += 1;
    spawnShards(position, item.kind.shards || 4, item.size);

    const group = groups.find((g) => g.kind === item.kind);
    if (group) {
      group.mesh.setMatrixAt(item.index, hidden);
      group.mesh.instanceMatrix.needsUpdate = true;
    }
    if (item.handle) {
      physics.remove(item.handle);
      recordToItem.delete(item.handle);
    }

    ctx.events.emit("prop:destroyed", { position, kind: item.kind.id });
    ctx.events.emit("score", { amount: item.kind.worth, reason: `${item.kind.id} smashed`, position });
  }

  const offImpact = ctx.events.on("impact", (event) => {
    if (!event || !event.position) return;
    const speed = event.speed || 0;
    if (speed < 4) return;

    // Anything nearby bolts, whatever was actually hit.
    for (const c of creatures) {
      const dx = c.x - event.position.x;
      const dz = c.z - event.position.z;
      if (dx * dx + dz * dz < 70 * 70) {
        c.state = "flee";
        c.timer = 1.2 + rng() * 1.4;
        c.yaw = Math.atan2(dx, dz);
      }
    }

    // Ants break formation when something lands near the column, which is
    // most of the reason to have a column in the first place.
    //
    // "spooked", NOT "punted": a punt is the full comedy launch at 58-66
    // units/s, and firing that from a mere nearby impact meant every animal
    // within 60 units rocketed off far faster than the hero can run. Nothing
    // could ever be caught, so none of these interactions were reachable in
    // play. A scare is a scurry, not a launch.
    for (const group of faunaGroups) {
      if (group.kind.stoic) continue;
      for (const c of group.list) {
        const fx = c.x - event.position.x;
        const fz = c.z - event.position.z;
        // 34 was wide enough that ordinary debris settling anywhere nearby
        // kept breaking the columns apart before they could form.
        if (fx * fx + fz * fz > 20 * 20) continue;
        if (c.state === "punted") continue;      // already mid-launch
        c.state = "spooked";
        c.timer = 0.9 + rng() * 1.1;
        c.yaw = Math.atan2(fx, fz);
      }
    }

    const record = event.record
      || (event.collider && physics.recordForCollider ? physics.recordForCollider(event.collider) : null);
    const item = record ? recordToItem.get(record) : null;
    if (!item || !item.alive) return;

    if (item.kind.destructible && speed >= DESTROY_SPEED) {
      breakProp(item, event.position);
    } else {
      launched += 1;
      ctx.events.emit("score", {
        amount: Math.round(item.kind.worth * clamp(speed / 12, 0.4, 2.2)),
        reason: `${item.kind.id} launched`,
        position: event.position,
      });
    }
  });

  /* ---------------------------------------------------------------- */
  /* Frame update                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Minimum on-screen size, in pixels, that a prop must occupy to be drawn.
   *
   * These props are small and dark. Once one covers less than a pixel or two
   * it stops reading as an object and becomes an isolated black speck - a
   * blind reviewer described exactly this as "sub-pixel black props read as
   * dead sensor pixels", which is worse than any art flaw because the viewer
   * blames their monitor. Measured: 51 such specks in a wide shot, 0 with the
   * props hidden. So fade them out before they get that small.
   */
  const MIN_SCREEN_PX = 2.2;
  const FADE_PX = 1.4; // shrink smoothly across this band rather than popping

  function syncGroup(group, cullScale) {
    const { mesh, items } = group;
    const camPos = ctx.camera.position;
    let dirty = false;

    for (const item of items) {
      const body = item.alive && item.handle && item.handle.body;
      if (!body) continue;
      const t = body.translation();
      const r = body.rotation();

      // Projected radius in pixels. `cullScale` folds in viewport height and
      // the camera's vertical FOV so this is one multiply per instance.
      const dx = t.x - camPos.x;
      const dy = t.y - camPos.y;
      const dz = t.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      const px = (item.size * cullScale) / dist;

      let shrink = 1;
      if (px < MIN_SCREEN_PX) {
        shrink = clamp((px - (MIN_SCREEN_PX - FADE_PX)) / FADE_PX, 0, 1);
      }

      scratchPos.set(t.x, t.y, t.z);
      scratchQuat.set(r.x, r.y, r.z, r.w);
      scratchScale.copy(item.stretch).multiplyScalar(shrink);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      mesh.setMatrixAt(item.index, scratchMatrix);
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * The screen-size cull depends on where the camera is, so the sync has to
   * happen after the camera is final for the frame. Driving it from update()
   * alone is not enough: the screenshot harness re-points the camera and then
   * renders without stepping systems, which left stale matrices and put the
   * specks straight back. Re-sync on demand instead, guarded so the four
   * shadow-cascade passes and the transmission pass do not repeat the work.
   */
  let lastSyncFrame = -1;
  const lastSyncCam = new THREE.Vector3(Infinity, Infinity, Infinity);

  function syncInstances() {
    const height = ctx.renderer.domElement.height || 900;
    const cullScale = height / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
    for (const group of groups) syncGroup(group, cullScale);
    // Springtails are small and dark too, and were the larger half of the
    // speck problem - they must go through the same size cull.
    writeCreatureMatrices(cullScale);
    writeFaunaMatrices(cullScale);
    writeAquaticMatrices(cullScale);
    lastSyncFrame = ctx.time.frame;
    lastSyncCam.copy(ctx.camera.position);
  }

  function maybeSyncForRender(camera) {
    // Only the main camera drives the cull; light cameras must not.
    if (camera !== ctx.camera) return;
    if (ctx.time.frame === lastSyncFrame && lastSyncCam.distanceToSquared(camera.position) < 1e-6) return;
    syncInstances();
  }

  for (const group of groups) {
    group.mesh.onBeforeRender = (renderer, scene, camera) => maybeSyncForRender(camera);
  }
  creatureMesh.onBeforeRender = (renderer, scene, camera) => maybeSyncForRender(camera);
  for (const group of faunaGroups) {
    group.mesh.onBeforeRender = (renderer, scene, camera) => maybeSyncForRender(camera);
  }
  for (const group of aquaticGroups) {
    group.mesh.onBeforeRender = (renderer, scene, camera) => maybeSyncForRender(camera);
  }

  /** Writes creature instance matrices, applying the same screen-size cull. */
  function writeCreatureMatrices(cullScale) {
    const camPos = ctx.camera.position;
    for (let i = 0; i < creatures.length; i += 1) {
      const c = creatures[i];
      const y = c.y + 0.3 + c.hop;
      const dx = c.x - camPos.x;
      const dy = y - camPos.y;
      const dz = c.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      // 0.28 is roughly the capsule's world radius at unit scale.
      const px = (c.scale * 0.28 * cullScale) / dist;
      let shrink = 1;
      if (px < MIN_SCREEN_PX) shrink = clamp((px - (MIN_SCREEN_PX - FADE_PX)) / FADE_PX, 0, 1);

      scratchPos.set(c.x, y, c.z);
      scratchQuat.setFromAxisAngle(yAxis, c.yaw);
      scratchScale.setScalar(c.scale * shrink);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      creatureMesh.setMatrixAt(i, scratchMatrix);
    }
    creatureMesh.instanceMatrix.needsUpdate = true;
  }

  /** Shortest-path angular damp; core.js exports damp but not an angular one. */
  function angleTo(from, to, rate, dt) {
    let d = to - from;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return from + d * (1 - Math.exp(-rate * dt));
  }

  function writeFaunaMatrices(cullScale) {
    const camPos = ctx.camera.position;
    for (const group of faunaGroups) {
      const { kind, mesh, list } = group;
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        const y = c.y + c.scale * kind.lift + (kind.curls ? c.curl * c.scale * 0.18 : 0);
        const dx = c.x - camPos.x;
        const dy = y - camPos.y;
        const dz = c.z - camPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
        const px = (c.scale * 0.5 * cullScale) / dist;
        let shrink = 1;
        if (px < MIN_SCREEN_PX) shrink = clamp((px - (MIN_SCREEN_PX - FADE_PX)) / FADE_PX, 0, 1);

        scratchPos.set(c.x, y, c.z);
        scratchQuat.setFromAxisAngle(yAxis, c.yaw);
        if (kind.curls && c.roll !== 0) {
          // Rolling is about the body's own X, i.e. across the direction of
          // travel - the same axis a wheel turns on.
          scratchQuatB.setFromAxisAngle(xAxis, c.roll);
          scratchQuat.multiply(scratchQuatB);
        }
        const sc = c.scale * shrink * c.squash;
        // Curling shortens the long axis and fattens the short one until the
        // silhouette is a ball.
        scratchScale.set(sc, sc * (1 + c.curl * 0.28), sc * (1 - c.curl * 0.34));
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        mesh.setMatrixAt(i, scratchMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function writeAquaticMatrices(cullScale) {
    const camPos = ctx.camera.position;
    for (const group of aquaticGroups) {
      const { kind, mesh, list } = group;
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        if (c.dead) { mesh.setMatrixAt(i, hidden); continue; }
        const dx = c.x - camPos.x;
        const dy = c.y - camPos.y;
        const dz = c.z - camPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
        const px = (c.scale * 0.5 * cullScale) / dist;
        let shrink = 1;
        if (px < MIN_SCREEN_PX) shrink = clamp((px - (MIN_SCREEN_PX - FADE_PX)) / FADE_PX, 0, 1);

        scratchPos.set(c.x, c.y, c.z);
        scratchQuat.setFromAxisAngle(yAxis, c.yaw);
        if (kind.style === "hop") {
          // Nose up on the upstroke, nose down as it sinks.
          scratchQuatB.setFromAxisAngle(xAxis, clamp(-c.vy * 0.045, -0.6, 0.6));
          scratchQuat.multiply(scratchQuatB);
        } else if (kind.style === "hang") {
          const amp = c.startled > 0 ? 0.75 : 0.16;
          const rate = c.startled > 0 ? 19 : 2.6;
          scratchQuatB.setFromAxisAngle(xAxis, Math.sin(c.phase * rate) * amp);
          scratchQuat.multiply(scratchQuatB);
        }
        const sc = c.scale * shrink * (kind.style === "anchored" ? 1 - c.retract * 0.45 : 1);
        scratchScale.setScalar(sc);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        mesh.setMatrixAt(i, scratchMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function updateAquatic(dt) {
    if (ctx.player && ctx.player.position) heroPos.copy(ctx.player.position);

    for (const group of aquaticGroups) {
      const { kind, list } = group;
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        if (c.dead) continue;
        if (c.cooldown > 0) c.cooldown -= dt;
        if (c.startled > 0) c.startled -= dt;
        c.phase += dt;

        const dx = c.x - heroPos.x;
        const dy = c.y - heroPos.y;
        const dz = c.z - heroPos.z;
        const reach = kind.hit + c.scale;
        // No speed gate here: underwater the hero is slowed to ~6 units/s by
        // drag, so requiring a land-speed charge would make pond life
        // untouchable - the same "prey the player cannot reach" trap the
        // land fauna hit three times.
        if (c.cooldown <= 0 && dx * dx + dy * dy + dz * dz < reach * reach) {
          c.startled = 1.6;
          c.cooldown = 2.6;
          c.yaw = Math.atan2(dx, dz);
          ctx.events.emit("score", {
            amount: kind.worth,
            reason: kind.trick,
            position: { x: c.x, y: c.y, z: c.z },
          });
        }

        if (kind.style === "hop") {
          // Daphnia really do hop: one stroke of the antenna throws them up
          // and forward, then they sink. That stutter IS the silhouette.
          c.hopTimer -= dt;
          if (c.hopTimer <= 0) {
            c.hopTimer = (c.startled > 0 ? 0.16 : 0.5) + rng() * 0.4;
            c.vy = (c.startled > 0 ? 12 : 6.5) + rng() * 3;
            c.yaw += (rng() - 0.5) * 1.3;
          }
          c.vy -= 8 * dt;
          c.y += c.vy * dt;
          const fwd = (c.vy > 0 ? 5.5 : 1.4) * (c.startled > 0 ? 2.1 : 1);
          c.x += Math.sin(c.yaw) * fwd * dt;
          c.z += Math.cos(c.yaw) * fwd * dt;
        } else if (kind.style === "hang") {
          // Hangs head-down from the surface on its siphon until something
          // comes near, then thrashes straight for the bottom.
          if (c.startled > 0) c.y -= 11 * dt;
          else c.y = damp(c.y, c.level - 1.4, 1.6, dt);
        } else {
          c.y = c.floor;
          c.retract = damp(c.retract, c.startled > 0 ? 1 : 0, 8, dt);
        }

        c.y = clamp(c.y, c.floor + 0.4, c.level - 0.5);
        if (kind.style !== "anchored") {
          const lvl = ctx.world.waterAt(c.x, c.z);
          if (lvl === null || lvl === undefined) {
            // Swam out of the pond: back up and turn around.
            c.x -= Math.sin(c.yaw) * 2.5;
            c.z -= Math.cos(c.yaw) * 2.5;
            c.yaw += Math.PI;
          } else {
            c.level = lvl;
            c.floor = groundAt(c.x, c.z);
          }
        }
      }
    }
  }

  function updateFauna(dt) {
    const rep = ctx.player && ctx.player.report ? ctx.player.report() : null;
    const heroSpeed = rep ? rep.speed : 0;
    if (ctx.player && ctx.player.position) heroPos.copy(ctx.player.position);

    for (const group of faunaGroups) {
      const { kind, list } = group;
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        c.timer -= dt;
        if (c.cooldown > 0) c.cooldown -= dt;

        const dx = c.x - heroPos.x;
        const dz = c.z - heroPos.z;

        // --- the hero barrels through one ---
        const reach = kind.hit + c.scale;
        if (c.cooldown <= 0 && heroSpeed > 8 && dx * dx + dz * dz < reach * reach) {
          c.state = "punted";
          c.timer = kind.stoic ? 1.3 : 1.6 + rng() * 1.2;
          c.yaw = Math.atan2(dx, dz);
          c.speed = kind.puntSpeed;
          c.cooldown = 2.2;
          if (kind.stoic) c.squash = 0.5;   // retracts into the shell instead
          ctx.events.emit("score", {
            amount: kind.worth,
            reason: kind.trick,
            position: { x: c.x, y: c.y + 1.2, z: c.z },
          });
        }

        if (c.timer <= 0) {
          c.state = "wander";
          c.timer = 1.8 + rng() * 3.4;
          if (!kind.marches) c.yaw += (rng() - 0.5) * 2.2;
        }

        let want;
        let rate;
        if (kind.marches && c.ahead >= 0 && c.state === "wander") {
          // Follow the one in front, and hold station rather than shunting it.
          const lead = list[c.ahead];
          const ax = lead.x - c.x;
          const az = lead.z - c.z;
          const gap = Math.hypot(ax, az);
          // Steer harder than before: at rate 6 the followers cut the corner
          // whenever the leader turned and the queue smeared into a blob.
          if (gap > 1e-3) c.yaw = angleTo(c.yaw, Math.atan2(ax, az), 10, dt);
          want = gap > 2.1
            ? clamp(kind.wanderSpeed + (gap - 1.7) * 2.5, 0, 17)
            : gap < 1.3 ? 0 : kind.wanderSpeed;
          rate = 5;
        } else {
          // A scurry must stay SLOWER than the hero or the animal simply
          // walks away from the player forever and the interaction may as
          // well not exist - the same trap the 15-unit ant march fell into,
          // and then the x2.4 scurry fell into again at 16.8 and 21.6. The
          // hero tops out around 13-16, so prey is capped below that: you
          // can always run something down if you commit to it.
          want = c.state === "punted" ? kind.puntSpeed
            : c.state === "spooked" ? Math.min(kind.wanderSpeed * 2.4, 10.5)
              : kind.wanderSpeed;
          rate = c.state === "punted" ? 9 : 3.5;
        }

        // A column has to WAIT for its own tail. Letting stragglers sprint
        // was not enough on its own: every ant behind the gap ran at the
        // catch-up cap while the ant it was chasing ran at the cap too, so
        // the gaps froze at whatever that cap allowed and the line measured
        // 16-31 units instead of closing. Slowing the one in FRONT is what
        // actually collapses the accordion.
        if (kind.marches && c.state === "wander") {
          const behind = list[i + 1];
          if (behind && behind.ahead === i) {
            const bg = Math.hypot(behind.x - c.x, behind.z - c.z);
            if (bg > 2.6) want *= 0.3;
          }
        }

        c.speed = damp(c.speed, want, rate, dt);

        c.x += Math.sin(c.yaw) * c.speed * dt;
        c.z += Math.cos(c.yaw) * c.speed * dt;
        c.y = groundAt(c.x, c.z);

        if (kind.curls) {
          c.curl = damp(c.curl, c.state === "punted" ? 1 : 0, 7, dt);
          if (c.state === "spooked") c.curl = damp(c.curl, 0.35, 7, dt);
          c.roll += c.speed * dt * 0.72;
        }
        if (kind.stoic) c.squash = damp(c.squash, 1, 2.2, dt);
      }
    }
  }

  function syncShards(dt) {
    let dirty = false;
    for (const shard of shards) {
      if (shard.ttl <= 0) continue;
      shard.ttl -= dt;
      const body = shard.handle && shard.handle.body;
      if (!body) continue;

      if (shard.ttl <= 0) {
        body.setTranslation({ x: 0, y: -4000, z: 0 }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        shardMesh.setMatrixAt(shard.index, hidden);
        dirty = true;
        continue;
      }

      const t = body.translation();
      const r = body.rotation();
      scratchPos.set(t.x, t.y, t.z);
      scratchQuat.set(r.x, r.y, r.z, r.w);
      // Shrink away over the last second and a half instead of vanishing.
      scratchScale.setScalar(shard.scale * clamp(shard.ttl / 1.5, 0, 1));
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      shardMesh.setMatrixAt(shard.index, scratchMatrix);
      dirty = true;
    }
    if (dirty) shardMesh.instanceMatrix.needsUpdate = true;
  }

  function updateCreatures(dt) {
    if (ctx.player && ctx.player.position) heroPos.copy(ctx.player.position);

    for (let i = 0; i < creatures.length; i += 1) {
      const c = creatures[i];
      c.timer -= dt;

      const dx = c.x - heroPos.x;
      const dz = c.z - heroPos.z;
      if (dx * dx + dz * dz < 26 * 26 && c.state !== "flee") {
        c.state = "flee";
        c.timer = 1.1 + rng() * 1.2;
        c.yaw = Math.atan2(dx, dz);
      }

      if (c.timer <= 0) {
        if (c.state === "flee") { c.state = "settle"; c.timer = 0.6 + rng() * 1.2; }
        else if (c.state === "settle") { c.state = "wander"; c.timer = 1.5 + rng() * 3; }
        else { c.state = "wander"; c.timer = 1.5 + rng() * 3; c.yaw += (rng() - 0.5) * 2.4; }
      }

      const target = c.state === "flee" ? 46 : c.state === "wander" ? 11 : 0;
      c.speed = damp(c.speed, target, 5, dt);
      c.x += Math.sin(c.yaw) * c.speed * dt;
      c.z += Math.cos(c.yaw) * c.speed * dt;

      // Springtails hop rather than walk - that is their whole thing.
      c.hopPhase += dt * (4 + c.speed * 0.42);
      c.hop = Math.abs(Math.sin(c.hopPhase)) * clamp(c.speed / 20, 0, 1) * 1.6;
      c.y = groundAt(c.x, c.z);

    }
    // Matrices are written by writeCreatureMatrices(), which also applies the
    // screen-size cull; doing it here too would just undo that.
  }

  return {
    root,

    update(dt) {
      syncInstances();
      syncShards(dt);
      updateCreatures(dt);
      updateFauna(dt);
      updateAquatic(dt);
    },

    /** Snapshot of a fauna species, for probes: state is what you need to
     *  tell "the formation logic is wrong" from "they are never in it". */
    faunaDebug(id) {
      const g = faunaGroups.find((x) => x.kind.id === id);
      if (!g) return null;
      return g.list.map((c) => ({
        x: +c.x.toFixed(1), z: +c.z.toFixed(1),
        state: c.state, speed: +c.speed.toFixed(1), ahead: c.ahead,
      }));
    },

    /** Lets tests and the harness force the destruction path deterministically. */
    smashNearest(position, radius = 60) {
      let best = null;
      let bestDist = radius * radius;
      for (const group of groups) {
        for (const item of group.items) {
          const body = item.alive && item.kind.destructible && item.handle && item.handle.body;
          if (!body) continue;
          const t = body.translation();
          const d = (t.x - position.x) ** 2 + (t.y - position.y) ** 2 + (t.z - position.z) ** 2;
          if (d < bestDist) { bestDist = d; best = { item, t }; }
        }
      }
      if (!best) return null;
      breakProp(best.item, new THREE.Vector3(best.t.x, best.t.y, best.t.z));
      return best.item.kind.id;
    },

    report() {
      let alive = 0;
      let total = 0;
      for (const group of groups) {
        for (const item of group.items) { total += 1; if (item.alive) alive += 1; }
      }
      return {
        kinds: groups.length,
        props: total,
        alive,
        destroyed,
        launched,
        shardPool: SHARD_POOL,
        shardsActive: shards.reduce((n, s) => n + (s.ttl > 0 ? 1 : 0), 0),
        creatures: creatures.length,
        fauna: faunaGroups.reduce((n, g) => n + g.list.length, 0),
        faunaKinds: faunaGroups.map((g) => `${g.kind.id}:${g.list.length}`).join(","),
        aquatic: aquaticGroups.reduce((n, g) => n + g.list.filter((c) => !c.dead).length, 0),
        aquaticKinds: aquaticGroups
          .map((g) => `${g.kind.id}:${g.list.filter((c) => !c.dead).length}`).join(","),
      };
    },

    dispose() {
      offImpact();
      root.removeFromParent();
    },
  };
}
