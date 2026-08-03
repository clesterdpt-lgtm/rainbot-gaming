/* ============================================================
   Tardigrade Simulator - hero character: procedural water bear

   Owned by the "character" agent.

   WHAT THIS FILE BUILDS
   ---------------------
   A single procedurally-generated SkinnedMesh water bear:

     * Barrel body = one generalised cylinder (lathe of ~130 rings)
       carrying a head segment plus four trunk segments, soft
       overlapping creases, a dorsal arch, a hexagonal lattice of
       dorsal tubercles, and a real, open buccal tube at the front
       (the profile folds back into a throat).
     * Eight stumpy legs, splayed sideways and slightly down, the
       rear pair pointing backwards, annulated like a real lobopod,
       each ending in a crown of five curved claws.
     * Two eye spots: dark pigment cup, warm amber annulus, glossy
       cornea (second material group).
     * The buccal tube as a third material group - unmapped, low
       roughness, clearcoated, so the mouth is the one wet surface
       on the animal.
     * Vertex colours paint the amber gut running the body length,
       the pale thin-cuticle belly, segment creases and ivory claws.
       On the cuticle they are authored as *linear multipliers* on
       whatever colour materials.js gives `chitin`, so the art tracks
       their palette; on the eyes and the buccal tube (which carry no
       texture) they are absolute linear albedos.

   THE ONE RULE THAT MATTERS AT REVIEW FRAMING
   -------------------------------------------
   The animal is judged at roughly 25-40% of frame height, where it
   is ~300px tall and every papilla is sub-pixel. Nothing survives
   that except silhouette and large-scale value. So: countershade
   hard (0.42x pigmented dorsum against a 1.40x belly), keep the
   segment steps and the tubercles in real geometry rather than in
   the normal map, and make the claws thick enough to be more than
   one pixel wide. Detail that only exists in the normal map is
   detail that only exists in a macro crop.

   RIGGING
   -------
   Real THREE.Skeleton / SkinnedMesh, 33 bones:

       bRoot -> bBody -> (bF1 -> bF2 -> bHead -> bMouth)
                      \> (bB1 -> bB2 -> bTail)
       bRoot -> 8 x (hip -> mid -> foot)

   `bBody` carries whole-trunk squash/stretch so the leg chains
   (children of the un-scaled `bRoot`) keep exact bone lengths and
   the analytic 2-bone IK stays correct. Each hip's transform is
   re-derived every frame from the spine bone it is "attached" to,
   so shoulders still follow the body when it arches or curls.

   ANIMATION
   ---------
   100% procedural, driven from setPose():
     * Metachronal 8-leg gait with world-space planted IK targets.
       Feet plant, the body travels over them, then they lift and
       swing to a *predicted* landing spot. Step length is derived
       from measured world velocity, so the feet cannot skate.
     * Spring squash/stretch on landing, jumping and acceleration.
     * Smooth curl into the cryptobiotic "tun" barrel.
     * Airborne flail, landing splay, idle breathing, head turn
       toward travel, banking into turns, jump anticipation crouch.

   API (contract - see docs/tardigrade-simulator-spec.md)
     root, length, setPose(), setFacing(), playOneShot(), update(),
     lateUpdate(), report()
   plus, for physics.js:
     getRagdollSpec(), bones, setBoneWorldTransform(), ragdollActive

   CONVENTIONS OTHER SYSTEMS RELY ON
     * Local +Z is forward (matches player.js yaw = atan2(dx, dz)).
     * `root` is expected ~0.5 units above the ground (player.js
       uses heightAt() + 0.5). The rig self-calibrates that offset
       while grounded, so a different controller still stands right.
   ============================================================ */

import * as THREE from "three";
import { TAU, clamp, clamp01, damp, lerp, smoothstep, wrapAngle } from "./core.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

const BODY_LENGTH = 1.6;
/** Height of the body centre above the ground when standing (model space). */
const STAND_Y = 0.4;
/** Expected distance from `root` down to the ground (player.js convention). */
const DEFAULT_GROUND_OFFSET = 0.5;
/** Height of the foot *bone* above the ground - the claws hang below it. */
const FOOT_CLEAR = 0.072;

const BODY_W = 1.07;
const BODY_H = 0.98;
const BELLY_FLATTEN = 0.17;

const LEG_UPPER = 0.2;
const LEG_LOWER = 0.17;
const LEG_REACH = LEG_UPPER + LEG_LOWER;

/**
 * Segment plates. The barrel is not a smooth capsule - it is five
 * overlapping cuticular plates, each swelling toward its rear edge and
 * then dropping away over the plate behind it, exactly like roof tiles
 * shedding backwards. `LIP` is how far the overhanging rear edge stands
 * proud, `TUCK` how far the front edge is recessed under the plate ahead.
 * Together they are ~15% of the body radius, which is enough to survive
 * a hero framing where shading alone reads as "a smooth beige capsule".
 */
const PLATE_LIP = 0.032;
/** Shallow secondary folds between the big ones, the way real cuticle wrinkles. */
const PLATE_SUBFOLD = 0.0055;

/**
 * Reference circumference. UVs are authored in *world units* divided by
 * this, so one texture tile covers the same physical area on the barrel,
 * on a leg and on a claw. Without it the legs get 5x the texel density of
 * the body and read as smooth plastic next to a bumpy trunk.
 */
const UV_REF = 2.073; // TAU * 0.33
/** Texture repeats across UV_REF world units. Integer so the seam wraps. */
const CUTICLE_REPEAT = 7;

/**
 * Claw crown. These have to survive a *review* framing, not a macro crop:
 * at 25-40% of frame height the whole animal is ~300px tall, so a claw
 * thinner than about 2% of body length is sub-pixel and simply is not
 * there. Sized against the foot, not against realism - a real Hypsibius
 * claw is finer than this, and a fine claw reads as nothing.
 */
const CLAW_ARC = 0.126;
const CLAW_THICK = 0.037;
const CLAW_BASE_R = 0.070;
const CLAW_SWEEP = 1.52;

const GAIT_DUTY = 0.68;
const GAIT_STRIDE = 0.78;
const GAIT_MAX_HZ = 9;
const GAIT_MIN_HZ = 1.15;

/**
 * Body silhouette, sampled as a Catmull-Rom through (z, radius).
 * Densely-keyed regions automatically get more rings, which is why
 * the creases and the buccal tube stay crisp.
 */
const BODY_KEYS = [
  [-0.800, 0.0010],
  [-0.795, 0.055],
  [-0.782, 0.108],
  [-0.762, 0.152],
  [-0.732, 0.198],
  [-0.692, 0.238],
  [-0.645, 0.268],
  [-0.592, 0.288],
  [-0.535, 0.300],
  [-0.482, 0.302],
  [-0.446, 0.294],
  [-0.428, 0.283],
  [-0.414, 0.282],
  [-0.392, 0.298],
  [-0.345, 0.313],
  [-0.292, 0.322],
  [-0.238, 0.324],
  [-0.192, 0.316],
  [-0.170, 0.302],
  [-0.156, 0.301],
  [-0.132, 0.315],
  [-0.082, 0.327],
  [-0.020, 0.332],
  [0.042, 0.330],
  [0.092, 0.320],
  [0.116, 0.306],
  [0.130, 0.305],
  [0.154, 0.318],
  [0.204, 0.325],
  [0.258, 0.323],
  [0.312, 0.314],
  [0.358, 0.300],
  [0.382, 0.287],
  [0.396, 0.286],
  [0.420, 0.296],
  [0.462, 0.298],
  [0.512, 0.291],
  [0.562, 0.278],
  [0.612, 0.258],
  [0.656, 0.232],
  [0.694, 0.202],
  [0.726, 0.170],
  [0.752, 0.140],
  [0.772, 0.116],
  [0.786, 0.103],
  [0.796, 0.098],
  [0.804, 0.101],
  [0.809, 0.093],
  [0.806, 0.078],
  [0.797, 0.062],
  [0.784, 0.046],
  [0.768, 0.031],
  [0.750, 0.017],
  [0.734, 0.0010],
];

/** Where the soft overlapping segment creases sit along z. */
const CREASES = [-0.428, -0.17, 0.116, 0.382];

/**
 * Four leg pairs. `z` is the attachment along the spine, `dir` the
 * emergence direction for the +x side (mirrored for -x). Legs point
 * sideways and slightly down - never underneath - and the rear pair
 * rakes backwards the way a real water bear's does.
 */
const LEG_PAIRS = [
  { z: 0.42, dir: [0.90, -0.40, 0.18], rest: [0.44, FOOT_CLEAR, 0.52], spine: "bF2" },
  { z: 0.12, dir: [0.94, -0.34, 0.02], rest: [0.48, FOOT_CLEAR, 0.16], spine: "bBody" },
  { z: -0.18, dir: [0.93, -0.35, -0.10], rest: [0.48, FOOT_CLEAR, -0.22], spine: "bB1" },
  { z: -0.52, dir: [0.60, -0.33, -0.73], rest: [0.34, FOOT_CLEAR, -0.70], spine: "bB2" },
];

const QUALITY_MESH = {
  low: { rings: 74, radial: 20, legRings: 16, legRadial: 10, claws: 4, clawRings: 5, clawRadial: 5, eyeLat: 8, eyeLon: 10, detail: false },
  medium: { rings: 100, radial: 28, legRings: 22, legRadial: 12, claws: 5, clawRings: 6, clawRadial: 6, eyeLat: 10, eyeLon: 12, detail: true },
  // Radial counts were raised for the tubercle lattice: a dome needs about
  // six columns of vertices across it or it renders as a faceted lump, and
  // at radial 36/44 the largest lattice that resolved was as coarse as the
  // segment plates themselves - so it read as nothing at all.
  high: { rings: 128, radial: 48, legRings: 28, legRadial: 14, claws: 5, clawRings: 7, clawRadial: 7, eyeLat: 12, eyeLon: 14, detail: true },
  ultra: { rings: 156, radial: 60, legRings: 36, legRadial: 16, claws: 5, clawRings: 8, clawRadial: 8, eyeLat: 16, eyeLon: 20, detail: true },
};

/* ------------------------------------------------------------------ */
/* Geometry builder                                                    */
/* ------------------------------------------------------------------ */

class Builder {
  constructor() {
    this.position = [];
    this.uv = [];
    this.color = [];
    this.flesh = [];
    this.skin = [];
    this.skinIndex = [];
    this.skinWeight = [];
    this.index = [];
    /** Fleshiness written by the next vertex() call: 0 = hard plate, 1 = thin translucent tissue. */
    this.nextFlesh = 0.3;
    /**
     * Surface properties written by the next vertex() call:
     *   x  grain  papilla SIZE. 0 = fine and tight, 1 = coarse and chunky.
     *   y  bump   papilla AMPLITUDE. 0 = smooth taut cuticle, 1 = full relief.
     *   z  wet    moisture. 0 = dusty and dry, 1 = a wet film with a tight
     *             specular. This is the whole of the "living animal, not a
     *             painted figurine" read, so it is authored per region rather
     *             than left as one number on the material.
     */
    this.nextSkin = [0.5, 0.8, 0.4];
  }

  get vertexCount() {
    return this.position.length / 3;
  }

  /** `weights` is an array of [boneIndex, weight]; top four win. */
  vertex(x, y, z, u, v, cr, cg, cb, weights) {
    this.position.push(x, y, z);
    this.uv.push(u, v);
    this.color.push(cr, cg, cb);
    this.flesh.push(this.nextFlesh);
    this.skin.push(this.nextSkin[0], this.nextSkin[1], this.nextSkin[2]);

    weights.sort((a, b) => b[1] - a[1]);
    let total = 0;
    for (let i = 0; i < 4 && i < weights.length; i += 1) total += Math.max(0, weights[i][1]);
    if (total <= 1e-6) {
      this.skinIndex.push(0, 0, 0, 0);
      this.skinWeight.push(1, 0, 0, 0);
    } else {
      for (let i = 0; i < 4; i += 1) {
        const entry = weights[i];
        this.skinIndex.push(entry ? entry[0] : 0);
        this.skinWeight.push(entry ? Math.max(0, entry[1]) / total : 0);
      }
    }
    return this.position.length / 3 - 1;
  }

  /**
   * Re-emit an existing vertex at the same position with a new colour and
   * fleshiness. Used where one surface has to hand over to another material
   * along a shared ring - the buccal tube takes over from the head cap at
   * the lip, and it needs its own (wet, unmapped) palette on that ring.
   * `weldNormals()` averages the normals of coincident vertices afterwards,
   * so the handover stays smooth.
   */
  duplicateVertex(index, cr, cg, cb, flesh) {
    const p = index * 3;
    this.position.push(this.position[p], this.position[p + 1], this.position[p + 2]);
    this.uv.push(this.uv[index * 2], this.uv[index * 2 + 1]);
    this.color.push(cr, cg, cb);
    this.flesh.push(flesh);
    this.skin.push(this.nextSkin[0], this.nextSkin[1], this.nextSkin[2]);
    for (let i = 0; i < 4; i += 1) {
      this.skinIndex.push(this.skinIndex[index * 4 + i]);
      this.skinWeight.push(this.skinWeight[index * 4 + i]);
    }
    return this.position.length / 3 - 1;
  }

  /** Quad corners in (ring, column) order: a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j). */
  quad(a, b, c, d) {
    this.index.push(a, c, b, a, d, c);
  }

  /**
   * Stitch a ring grid. `rows` is an array of arrays of vertex ids,
   * every row the same length (seam column duplicated by the caller).
   */
  grid(rows) {
    for (let i = 0; i < rows.length - 1; i += 1) {
      const r0 = rows[i];
      const r1 = rows[i + 1];
      for (let j = 0; j < r0.length - 1; j += 1) {
        this.quad(r0[j], r0[j + 1], r1[j + 1], r1[j]);
      }
    }
  }

  /**
   * Signed-volume check over the triangles added since `mark`. Closed
   * parts built with an inward winding get flipped automatically, so a
   * mistake in any one part can never ship as an invisible surface.
   */
  fixWinding(mark) {
    let volume = 0;
    const p = this.position;
    for (let i = mark; i < this.index.length; i += 3) {
      const a = this.index[i] * 3;
      const b = this.index[i + 1] * 3;
      const c = this.index[i + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const cx = p[c], cy = p[c + 1], cz = p[c + 2];
      volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    if (volume < 0) this.flipWinding(mark);
    return volume;
  }

  /**
   * Unconditionally reverse the winding from `mark` on. Open surfaces have
   * no meaningful signed volume, so a part that is built separately but
   * belongs to a closed shell (the buccal tube inside the head) inherits
   * the shell's decision instead of taking its own.
   */
  flipWinding(mark) {
    for (let i = mark; i < this.index.length; i += 3) {
      const t = this.index[i + 1];
      this.index[i + 1] = this.index[i + 2];
      this.index[i + 2] = t;
    }
  }
}

/** Average normals across duplicated seam / pole vertices. */
function weldNormals(geometry) {
  const pos = geometry.attributes.position.array;
  const nor = geometry.attributes.normal.array;
  const count = pos.length / 3;
  const buckets = new Map();
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(pos[i * 3] * 8192)},${Math.round(pos[i * 3 + 1] * 8192)},${Math.round(pos[i * 3 + 2] * 8192)}`;
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(i);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const i of list) { nx += nor[i * 3]; ny += nor[i * 3 + 1]; nz += nor[i * 3 + 2]; }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const i of list) { nor[i * 3] = nx; nor[i * 3 + 1] = ny; nor[i * 3 + 2] = nz; }
  }
  geometry.attributes.normal.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export async function createTardigrade(ctx) {
  const rng = ctx.rng || Math.random;
  const tier = QUALITY_MESH[ctx.settings && ctx.settings.tierName] || QUALITY_MESH.high;

  /* ================================================================
     1. Skeleton layout (model space: y = 0 is the ground plane)
     ================================================================ */

  const boneSpecs = [];
  const boneByName = new Map();

  function addBone(name, parent, x, y, z, quat, group) {
    const spec = {
      name,
      index: boneSpecs.length,
      parent,
      parentIndex: parent ? boneByName.get(parent).index : -1,
      local: new THREE.Vector3(x, y, z),
      quat: quat || new THREE.Quaternion(),
      model: new THREE.Vector3(),
      group: group || "trunk",
    };
    spec.model.copy(spec.local);
    if (parent) spec.model.add(boneByName.get(parent).model);
    boneSpecs.push(spec);
    boneByName.set(name, spec);
    return spec;
  }

  addBone("bRoot", null, 0, STAND_Y, 0, null, "trunk");
  addBone("bBody", "bRoot", 0, 0, 0, null, "trunk");
  addBone("bF1", "bBody", 0, 0, 0.26, null, "trunk");
  addBone("bF2", "bF1", 0, 0, 0.24, null, "trunk");
  addBone("bHead", "bF2", 0, 0, 0.2, null, "head");
  addBone("bMouth", "bHead", 0, 0, 0.08, null, "head");
  addBone("bB1", "bBody", 0, 0, -0.26, null, "trunk");
  addBone("bB2", "bB1", 0, 0, -0.24, null, "trunk");
  addBone("bTail", "bB2", 0, 0, -0.22, null, "trunk");

  /** Spine bones used for body skin weighting, sorted by z. */
  const SPINE_WEIGHTS = ["bTail", "bB2", "bB1", "bBody", "bF1", "bF2", "bHead", "bMouth"]
    .map((n) => boneByName.get(n));

  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  /** Per-leg static description, index 0..7 (pairs front->back, +x then -x). */
  const legDefs = [];
  for (let pair = 0; pair < LEG_PAIRS.length; pair += 1) {
    const def = LEG_PAIRS[pair];
    for (let s = 0; s < 2; s += 1) {
      const side = s === 0 ? 1 : -1;
      const dir = new THREE.Vector3(def.dir[0] * side, def.dir[1], def.dir[2]).normalize();
      // Slide the hip out to the body surface along `dir`.
      const surface = bodyRadiusAt(def.z) * 0.92;
      const hip = new THREE.Vector3(dir.x * surface * BODY_W, STAND_Y + dir.y * surface * BODY_H, def.z + dir.z * surface);
      const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
      const spineSpec = boneByName.get(def.spine);

      const hipSpec = addBone(`legHip${legDefs.length}`, "bRoot", hip.x - 0, hip.y - STAND_Y, hip.z - 0, quat, "leg");
      // model position of a rotated chain has to be composed manually
      hipSpec.model.set(hip.x, hip.y, hip.z);
      const midSpec = addBone(`legMid${legDefs.length}`, hipSpec.name, 0, LEG_UPPER, 0, null, "leg");
      midSpec.model.copy(hip).addScaledVector(dir, LEG_UPPER);
      const footSpec = addBone(`legFoot${legDefs.length}`, midSpec.name, 0, LEG_LOWER, 0, null, "leg");
      footSpec.model.copy(hip).addScaledVector(dir, LEG_REACH);

      legDefs.push({
        index: legDefs.length,
        pair,
        side,
        dir,
        hipModel: hip,
        hipQuat: quat,
        hipSpec,
        midSpec,
        footSpec,
        spineSpec,
        attachLocal: new THREE.Vector3().copy(hip).sub(spineSpec.model),
        restLocal: new THREE.Vector3(def.rest[0] * side, def.rest[1], def.rest[2]),
        // metachronal wave: rear pair leads, wave runs forward; sides alternate
        phase: (3 - pair) * 0.24 + (side > 0 ? 0 : 0.5),
        flail: rng() * TAU,
      });
    }
  }

  /* Body radius lookup used above (declared as a function so it hoists). */
  function bodyRadiusAt(z) {
    for (let i = 0; i < BODY_KEYS.length - 1; i += 1) {
      const a = BODY_KEYS[i];
      const b = BODY_KEYS[i + 1];
      if (z >= a[0] && z <= b[0]) {
        const t = (z - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return lerp(a[1], b[1], t);
      }
    }
    return 0.3;
  }

  /* ================================================================
     2. Build the mesh
     ================================================================ */

  const builder = new Builder();
  const scratch = new THREE.Vector3();

  /* ---- body profile curve ------------------------------------- */
  const curvePoints = BODY_KEYS.map(([z, r]) => new THREE.Vector3(z, r, 0));
  const profile = new THREE.CatmullRomCurve3(curvePoints, false, "centripetal", 0.5);

  const RINGS = tier.rings;
  const RADIAL = tier.radial;

  const EYE_Z = 0.545;
  const eyeSurface = bodyRadiusAt(EYE_Z);
  const eyeAngle = 1.0; // radians from the dorsal midline
  /**
   * How deep the eyeball centre sits inside the head, as a fraction of the
   * surface radius. 0.92 in the first pass, 0.845 in the second, 0.786 now.
   *
   * Both earlier numbers left the cornea standing proud of an otherwise flat
   * head, which is the single note that has survived every review: "the eyes
   * sit flush as glued-on beads with no socket or lid". A bead reads as a
   * bead because nothing occludes it. At 0.786 roughly a third of the sphere
   * is buried, and the orbital pit cut below takes another slice off the
   * lower rim, so the visible cornea is a lens set into a hole rather than a
   * hemisphere stuck onto a curve.
   */
  // An eyeball only breaks the surface when sink * R + r > R, i.e. when
  // sink > 1 - r/R. At r = 0.082 and the head radius here that threshold is
  // ~0.79, and this sat at 0.786 - a hair under it - so both eyes were
  // geometrically INSIDE the head and the face rendered as a smooth dome.
  // Reviews kept reporting "no eyes" and kept being told the eyes existed;
  // they did exist, and they were never visible. Sit them proud enough to
  // catch a specular.
  const EYE_SINK = 0.87;
  const eyeCentre = new THREE.Vector3(
    Math.sin(eyeAngle) * eyeSurface * BODY_W * EYE_SINK,
    STAND_Y + Math.cos(eyeAngle) * eyeSurface * BODY_H * EYE_SINK,
    EYE_Z
  );
  const EYE_RADIUS = 0.082;
  /**
   * Orbital socket. `PIT` is how far the cuticle is scooped away under the
   * eye, `RIM` how far the lid ridge stands proud around it, `RIM_R` where
   * that ridge peaks measured from the eye centre. The ridge is deliberately
   * asymmetric - see EYE_BROW - because a symmetric annulus reads as a washer,
   * and what makes an eye look seated is a heavier fold above it than below.
   */
  const EYE_PIT = 0.0295;
  const EYE_PIT_R = 0.061;
  const EYE_RIM = 0.0225;
  const EYE_RIM_R = 0.086;
  const EYE_RIM_W = 0.029;
  /** Extra lid thickness on the dorsal/anterior side: 0 = washer, 1 = heavy brow. */
  const EYE_BROW = 0.95;

  function dorsalArch(z) {
    return 0.034 * Math.exp(-(((z + 0.02) / 0.52) ** 2)) - 0.058 * smoothstep(0.4, 0.81, z);
  }

  /* ---- overlapping segment plates ------------------------------ */
  /**
   * Each crease is a single smooth S-step in radius: recessed on the head
   * side of the line (that plate's front edge slides under the one ahead)
   * and proud on the tail side (its rear edge overhangs the next plate).
   *
   * It has to be written as ONE continuous function of z. The obvious
   * formulation - find the plate, ramp from "proud" at its rear end to
   * "tucked" at its front end - puts a radial cliff between the last ring
   * of one plate and the first ring of the next. That cliff is a single
   * quad wide, so the mesh columns show up as a comb of vertical strands
   * running down every fold. This version is C1 across the boundary.
   */
  const CREASE_STEP = 0.036;  // half-width of the S, in body z
  const CREASE_SPAN = 0.10;   // how far a crease's influence reaches

  function shingle(z, radius) {
    let s = 0;
    let near = 0;
    for (const c of CREASES) {
      const d = z - c;
      const w = Math.exp(-((d / CREASE_SPAN) ** 2));
      s += w * (2 * smoothstep(-CREASE_STEP, CREASE_STEP, d) - 1);
      near = Math.max(near, w);
    }
    // Shallow secondary wrinkles between the big folds, so the space
    // between them still has something in it at close range.
    const sub = Math.sin(z * 62.8 + 0.6) * (1 - near);

    // Fade out where the barrel tapers to a point, or the tail tip and
    // the mouth rim would blow out into a trumpet.
    const fade = smoothstep(0.07, 0.21, radius);
    return (PLATE_LIP * s + PLATE_SUBFOLD * sub) * fade;
  }

  /** Folds bite deepest across the back and flanks, shallowest on the belly. */
  function foldDepth(cosTheta) {
    return 0.5 + 0.5 * smoothstep(-0.95, 0.35, cosTheta);
  }

  /* ---- ring placement + arc length ------------------------------ */
  /**
   * Rings are NOT spread evenly along the curve. A crease needs four or
   * five rings inside 0.03 units or the geometric step turns into a
   * faceted ramp, while the long smooth flanks are happy with far fewer.
   * Pre-sample the profile densely, weight each sample by arc length x a
   * density that spikes at the creases and the mouth rim, then invert the
   * cumulative distribution to choose the ring parameters.
   *
   * The same pre-sample gives arc length, which the UVs are authored in
   * so one texture tile covers the same physical area everywhere.
   */
  const PRE = 1536;
  const preZ = new Float32Array(PRE + 1);
  const preR = new Float32Array(PRE + 1);
  const preArc = new Float32Array(PRE + 1);
  const preCdf = new Float32Array(PRE + 1);
  {
    const p = new THREE.Vector3();
    for (let i = 0; i <= PRE; i += 1) {
      profile.getPoint(i / PRE, p);
      preZ[i] = p.x;
      preR[i] = Math.max(0.0008, p.y);
    }
    let arc = 0;
    let cdf = 0;
    for (let i = 1; i <= PRE; i += 1) {
      // Arc length has to follow the SHINGLED surface, not the smooth
      // profile: the plate edges add ~0.05 units of travel inside 0.02 of
      // z, and a UV that ignores that smears the texture into vertical
      // strands right where the eye is looking hardest.
      const r0 = preR[i - 1] + shingle(preZ[i - 1], preR[i - 1]);
      const r1 = preR[i] + shingle(preZ[i], preR[i]);
      const ds = Math.hypot(preZ[i] - preZ[i - 1], r1 - r0);
      arc += ds;
      preArc[i] = arc;
      const z = preZ[i];
      let density = 1;
      for (const c of CREASES) density += 2.1 * Math.exp(-(((z - c) / 0.040) ** 2));
      density += 1.5 * Math.exp(-(((z - 0.795) / 0.05) ** 2));
      density += 0.9 * Math.exp(-(((z + 0.76) / 0.05) ** 2));
      // The orbital socket is a 0.03-deep pit inside 0.09 of arc. At the
      // default ring density that is three rings, which renders as a faceted
      // crater instead of a lid, so buy rings here the same way the creases do.
      density += 1.8 * Math.exp(-(((z - EYE_Z) / 0.075) ** 2));
      cdf += ds * density;
      preCdf[i] = cdf;
    }
  }
  const TOTAL_ARC = preArc[PRE];

  /** Curve parameter whose cumulative weight is `frac` of the total. */
  function ringParam(frac) {
    const want = frac * preCdf[PRE];
    let lo = 0;
    let hi = PRE;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (preCdf[mid] < want) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const a = preCdf[lo - 1];
    const b = preCdf[lo];
    const t = b > a ? (want - a) / (b - a) : 0;
    return (lo - 1 + t) / PRE;
  }

  /** Linear sample of the pre-computed profile at curve parameter u. */
  function profileAt(u, out) {
    const f = clamp01(u) * PRE;
    const i = Math.min(PRE - 1, Math.floor(f));
    const t = f - i;
    out.z = lerp(preZ[i], preZ[i + 1], t);
    out.r = lerp(preR[i], preR[i + 1], t);
    out.arc = lerp(preArc[i], preArc[i + 1], t);
    return out;
  }

  /** Skin weights for a point at spine position z (+ nearby leg shoulders). */
  function spineWeights(z, px, py, pz) {
    const out = [];
    let lo = SPINE_WEIGHTS[0];
    let hi = SPINE_WEIGHTS[SPINE_WEIGHTS.length - 1];
    if (z <= lo.model.z) {
      out.push([lo.index, 1]);
    } else if (z >= hi.model.z) {
      out.push([hi.index, 1]);
    } else {
      for (let i = 0; i < SPINE_WEIGHTS.length - 1; i += 1) {
        const a = SPINE_WEIGHTS[i];
        const b = SPINE_WEIGHTS[i + 1];
        if (z >= a.model.z && z <= b.model.z) {
          const t = smoothstep(a.model.z, b.model.z, z);
          out.push([a.index, 1 - t], [b.index, t]);
          break;
        }
      }
    }
    if (out.length === 0) out.push([boneByName.get("bBody").index, 1]);

    // Let the shoulders follow their leg a little.
    for (const leg of legDefs) {
      const d = Math.hypot(px - leg.hipModel.x, py - leg.hipModel.y, pz - leg.hipModel.z);
      if (d > 0.185) continue;
      const w = 0.34 * smoothstep(0.185, 0.06, d);
      if (w > 0.01) {
        for (const entry of out) entry[1] *= 1 - w;
        out.push([leg.hipSpec.index, w]);
      }
    }
    return out;
  }

  /* ---- vertex colour painting --------------------------------- */
  /**
   * Vertex colours are LINEAR MULTIPLIERS on the baked `chitin` albedo,
   * which sits around (0.45, 0.33, 0.18). Everything here therefore has
   * to keep `multiplier * albedo` below 1.0 - a channel that clips loses
   * every gradient it had.
   *
   * The palette is deliberately wide in value: pigmented ochre plates on
   * the back at ~0.72x, pale honey belly at ~1.5x. The previous pass sat
   * between 1.0 and 1.4 everywhere, which is exactly how a creature ends
   * up reading as "a beige capsule".
   */
  const col = { r: 1, g: 1, b: 1, flesh: 0.3, grain: 0.5, bump: 0.8, wet: 0.4 };

  /**
   * Countershading depth. This is the single number that decides whether the
   * animal reads as a creature or as "a beige capsule": at review framing the
   * papillae are sub-pixel and *all* that survives is the large-scale value
   * design. A dark pigmented back over a pale belly separates the animal from
   * pale patio stone; a uniform tan does not.
   *
   * 0.42x on the dorsal midline against 1.40x on the belly is a 3.3:1 albedo
   * ratio - a real countershaded animal, not a tinted egg.
   */
  function paintBody(z, theta) {
    let r = 1, g = 1, b = 1;
    const dorsal = Math.cos(theta);
    const lateral = Math.abs(Math.sin(theta));

    // Pigmented dorsal plates: darker, browner, where the cuticle is thick.
    // Alternate tergites carry slightly different pigment, which is what
    // stops five identical bands reading as a stack of inner tubes.
    let plate = 0;
    for (const c of CREASES) if (z > c) plate += 1;
    const tone = plate % 2 === 0 ? 1 : 0.915;
    const back = smoothstep(-0.30, 0.72, dorsal) * tone;
    r *= 1 - back * 0.56; g *= 1 - back * 0.62; b *= 1 - back * 0.66;

    // Paired dorsolateral pigment blotches - one pair per tergite, sitting
    // off the midline the way a real eutardigrade's cuticular pigment does.
    // Breaks the five-identical-bands read that a pure cos(theta) gradient
    // always produces.
    let blotch = 0;
    for (let i = 0; i < CREASES.length; i += 1) {
      const mid = i === 0 ? -0.30 : (CREASES[i - 1] + CREASES[i]) * 0.5;
      blotch = Math.max(blotch, Math.exp(-(((z - mid) / 0.088) ** 2)));
    }
    blotch *= Math.exp(-(((Math.abs(theta > Math.PI ? TAU - theta : theta) - 0.78) / 0.30) ** 2)) * 0.30;
    r *= 1 - blotch * 0.44; g *= 1 - blotch * 0.50; b *= 1 - blotch * 0.52;

    // Thin belly cuticle: pale honey, and the light gets through it.
    const belly = smoothstep(0.1, -0.9, dorsal);
    r *= 1 + belly * 0.40; g *= 1 + belly * 0.44; b *= 1 + belly * 0.56;

    // Baked occlusion on the downward faces. The ground is a few tenths of
    // a unit away and steals most of the sky from them; without this the
    // belly is the same value as the back and the whole animal goes flat.
    const under = smoothstep(-0.35, -1.0, dorsal);
    r *= 1 - under * 0.20; g *= 1 - under * 0.21; b *= 1 - under * 0.20;

    // The flanks between them catch a warm mid-tone.
    const flank = 1 - Math.abs(dorsal);
    r *= 1 + flank * 0.13; g *= 1 + flank * 0.06; b *= 1 - flank * 0.04;

    // Thin, translucent extremities - head cap and tail - read paler.
    const pale = 0.5 * smoothstep(0.42, 0.8, z) + 0.42 * smoothstep(-0.5, -0.79, z);
    r *= 1 + pale * 0.17; g *= 1 + pale * 0.15; b *= 1 + pale * 0.13;

    // The gut: a dark amber-brown tube running the body length, read
    // through the shell. Strongest dorsally, lobed per segment.
    const along = smoothstep(-0.74, -0.44, z) * (1 - smoothstep(0.36, 0.66, z));
    const lobes = 0.6 + 0.4 * Math.cos(((z + 0.7) / 0.29) * TAU);
    const vertical = smoothstep(-0.3, 0.7, dorsal) * (1 - 0.25 * smoothstep(0.9, 1.0, dorsal));
    const narrow = 1 - 0.55 * smoothstep(0.2, 1.0, lateral);
    const gut = clamp01(along * lobes * vertical * narrow);
    r = lerp(r, 0.56, gut * 0.92); g = lerp(g, 0.30, gut * 0.92); b = lerp(b, 0.16, gut * 0.92);

    // Hard dark line in the shadow of each overlapping plate edge. The
    // geometry already steps here; this keeps the step reading as a seam
    // rather than a soft dent when the sun is straight on it.
    let crease = 0;
    for (const c of CREASES) crease = Math.max(crease, Math.exp(-(((z - c + 0.013) / 0.021) ** 2)));
    crease *= 0.78 * foldDepth(dorsal);
    r *= 1 - crease * 0.52; g *= 1 - crease * 0.58; b *= 1 - crease * 0.58;

    // Head cap and the hard chitinous ring around the buccal tube.
    const lip = smoothstep(0.72, 0.795, z);
    r *= 1 - lip * 0.18; g *= 1 - lip * 0.24; b *= 1 - lip * 0.30;
    const ring = Math.exp(-(((z - 0.803) / 0.014) ** 2));
    r *= 1 - ring * 0.30; g *= 1 - ring * 0.40; b *= 1 - ring * 0.46;

    /* ---- surface character: grain, relief, moisture ----
     * Two review notes are answered here, and both were caused by putting a
     * single number on the material instead of a field on the animal:
     * "the bump noise is one uniform scale across head, plates and legs",
     * and "there is no wet or waxy specular anywhere".
     *
     * grain  papilla SIZE. The thick pigmented tergites carry big coarse
     *        papillae; the soft unpigmented flanks, the taut head cap and
     *        the tail carry a much finer, tighter grain. One texture,
     *        sampled at different scales, which is how real cuticle differs
     *        between a sclerite and the arthrodial membrane beside it.
     * bump   papilla AMPLITUDE, so the plates are also in higher relief than
     *        the stretched skin between them.
     * wet    moisture. A live animal is damp where fluid collects and where
     *        the cuticle is polished - the crowns of the plates, the crease
     *        valleys, the mouth collar, the orbital rim - and dusty where it
     *        drags on the substrate, which is the belly. One clearcoat value
     *        over all of it is exactly what reads as lacquer on a figurine.
     */
    const dorsalness = smoothstep(-0.25, 0.75, dorsal);
    const caps = clamp01(smoothstep(0.50, 0.78, z) + smoothstep(-0.50, -0.78, z));
    col.grain = clamp01(0.06 + dorsalness * 0.94 * (1 - caps * 0.88));
    col.bump = clamp01(0.30 + dorsalness * 0.70 - caps * 0.52 - belly * 0.20);

    let wet = 0.19 + dorsalness * 0.44 + crease * 0.62 + lip * 0.40 + ring * 0.48;
    wet *= 1 - belly * 0.58;
    col.wet = clamp01(wet);

    col.r = r; col.g = g; col.b = b;
    // Fleshiness drives the subsurface term: thin extremities and the
    // pale belly glow, the pigmented dorsal plates barely do.
    col.flesh = clamp01(0.16 + pale * 0.9 + belly * 0.45 - back * 0.12 - gut * 0.3);
  }

  /**
   * The buccal tube is its OWN material - unmapped, low-roughness, heavy
   * clearcoat - so these are absolute linear albedos, not multipliers on the
   * cuticle texture. A wet mouth is the one place on an arthropod where the
   * specular is sharp, and it is what stops the head reading as a beige knob
   * with a painted-on hole.
   */
  function paintThroat(depth, theta) {
    const t = clamp01(depth / 0.062);
    // Dark oxblood at the lip, near-black down the tube. Kept deliberately
    // desaturated and dark: a bright pink under a full clearcoat reads as
    // bubblegum, and a cartoon mouth on an otherwise plausible animal is
    // worse than no mouth detail at all.
    const deep = smoothstep(0.02, 0.55, t);
    let r = lerp(0.098, 0.018, deep);
    let g = lerp(0.037, 0.0070, deep);
    let b = lerp(0.031, 0.0075, deep);
    // Six longitudinal folds carrying on from the peribuccal lamellae.
    const flute = 0.5 + 0.5 * Math.cos(theta * 6);
    const shade = (1 - flute) * (1 - deep) * 0.16;
    r *= 1 - shade; g *= 1 - shade * 0.9; b *= 1 - shade * 0.9;
    col.r = r; col.g = g; col.b = b;
    col.flesh = 0.06;
    // The throat is its own material and never reads these, but the lip ring
    // is shared with the cuticle, so it has to hand over something sane.
    col.grain = 0; col.bump = 0; col.wet = 1;
  }

  /* ---- dorsal tubercles ----------------------------------------
     The cuticle normal map already carries papillae, but a normal map has
     no silhouette. At review framing the animal is ~300px tall, every
     papilla is sub-pixel, and the back averages straight back to a smooth
     capsule - which is exactly the "beige capsule" note. These are real
     geometry: a hexagonal lattice of low domes over the tergites, fading
     out on the belly and at both ends, so the top edge is a bumpy line
     against the sky and the sun lays a texture of tiny highlights and
     micro-shadows across the back at any distance.

     Both theta multipliers are integers so the lattice is exactly periodic
     around the barrel and the UV seam does not crack. */
  const TUBERCLE_AMP = tier.radial >= 44 ? 0.036 : 0;
  const TUBERCLE_AROUND = 4;  // -> 8 dome columns, hex-offset row to row
  const TUBERCLE_ALONG = 28;

  function tubercles(z, theta, cosTheta) {
    if (TUBERCLE_AMP <= 0) return 0;
    const mask = smoothstep(-0.16, 0.52, cosTheta)
      * (1 - smoothstep(0.54, 0.74, z))
      * (1 - smoothstep(-0.46, -0.70, z));
    if (mask <= 0.002) return 0;
    const c = Math.cos(theta * TUBERCLE_AROUND);
    const h = (Math.cos(theta * TUBERCLE_AROUND * 2) + 2 * c * Math.cos(z * TUBERCLE_ALONG)) / 3;
    // A narrow window here (the first attempt used 0.30..0.98) isolates each
    // dome to a couple of vertices across, which the mesh cannot resolve -
    // the lattice renders as nothing. Wide window, low amplitude: broad soft
    // swells the mesh can actually carry.
    return smoothstep(-0.30, 0.95, h) * mask;
  }

  /* ---- body ---------------------------------------------------- */
  const bodyMark = builder.index.length;
  const bodyRows = [];
  const throatRows = [];
  let zMax = -Infinity;
  const sample = { z: 0, r: 0, arc: 0 };

  for (let i = 0; i < RINGS; i += 1) {
    profileAt(ringParam(i / (RINGS - 1)), sample);
    const z = sample.z;
    const radius = sample.r;
    const throat = z < zMax - 0.0015;
    if (!throat) zMax = Math.max(zMax, z);
    const zMono = throat ? zMax : z;

    const yOff = dorsalArch(zMono);
    const roundness = lerp(2.38, 2.02, smoothstep(0.42, 0.72, zMono));
    const flatten = BELLY_FLATTEN * (1 - smoothstep(0.45, 0.76, zMono)) * (1 - smoothstep(-0.5, -0.76, zMono));
    // Dorsal plates are slightly flat-topped, the way a real tergite is.
    const plateTop = 0.10 * (1 - smoothstep(0.5, 0.78, zMono)) * (1 - smoothstep(-0.55, -0.78, zMono));
    const step = throat ? 0 : shingle(zMono, radius);
    const lipFlute = Math.exp(-(((zMono - 0.793) / 0.026) ** 2));
    const v = sample.arc / UV_REF;

    const row = [];
    for (let j = 0; j <= RADIAL; j += 1) {
      const theta = (j / RADIAL) * TAU;
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      const e = 2 / roundness;
      const ax = Math.sign(s) * Math.abs(s) ** e;
      const ay = Math.sign(c) * Math.abs(c) ** e;

      // Peribuccal lamellae: the fluted collar of six lobes around the
      // mouth. Also the only feature on an otherwise blank head cap.
      const lamella = 1 + lipFlute * 0.16 * Math.cos(theta * 6);
      const bump = throat ? 0 : tubercles(zMono, theta, c);
      const rEff = (radius + step * foldDepth(c) + bump * TUBERCLE_AMP) * lamella;
      let vy = rEff * BODY_H * ay;
      vy *= 1 - flatten * smoothstep(0, -0.55, ay);
      vy *= 1 - plateTop * smoothstep(0.45, 1.0, ay);
      let vx = rEff * BODY_W * ax;
      let py = STAND_Y + vy + yOff;

      /* ---- orbital socket ----
       * The eye is scooped into a pit and framed by a lid ridge that is
       * heavier above and behind it than below - which is the difference
       * between an eye and a washer with a bead in it. Both are real
       * geometry: a socket painted into the vertex colours vanishes the
       * moment the sun moves, and the note it has to answer ("no socket,
       * no lid") is a note about silhouette, not about shading.
       */
      const dEyeR = Math.hypot(vx - eyeCentre.x, py - eyeCentre.y, z - eyeCentre.z);
      const dEyeL = Math.hypot(vx + eyeCentre.x, py - eyeCentre.y, z - eyeCentre.z);
      const dEye = Math.min(dEyeR, dEyeL);
      // Where this vertex sits around the eye it is nearest to: +1 straight
      // above/behind it (the brow), -1 below/in front (the thin lower lid).
      const upness = dEye > 1e-5
        ? ((py - eyeCentre.y) * 0.80 - (z - eyeCentre.z) * 0.60) / dEye
        : 0;
      const brow = 1 + EYE_BROW * smoothstep(-0.55, 0.85, upness);
      const rim = Math.exp(-(((dEye - EYE_RIM_R) / EYE_RIM_W) ** 2)) * EYE_RIM * brow;
      const dip = -Math.exp(-((dEye / EYE_PIT_R) ** 2)) * EYE_PIT;
      if (rim + dip !== 0 && rEff > 0.02) {
        const k = 1 + (rim + dip) / rEff;
        vx *= k;
        py = STAND_Y + (py - STAND_Y - yOff) * k + yOff;
      }

      if (throat) paintThroat(zMax - z, theta);
      else paintBody(zMono, theta);
      // Tubercle crowns are stretched, thinner cuticle and read paler; the
      // gaps between them hold pigment. Small, but it stops the lattice
      // being a pure shading effect that vanishes under a flat sky.
      const crown = 1 + bump * 0.16;
      const socket = smoothstep(0.112, 0.052, dEye);
      // Occlusion inside the pit, but warmer and lifted on the lower lid:
      // a socket that goes evenly black reads as a drilled hole. Light
      // bouncing off the cheek into the underside of the orbit is what makes
      // it read as tissue.
      const lidLift = clamp01(smoothstep(0.15, -0.75, upness)) * socket * 0.42;
      const cr = col.r * crown * lerp(1, 0.34, socket) * (1 + lidLift * 0.62);
      const cg = col.g * crown * lerp(1, 0.26, socket) * (1 + lidLift * 0.46);
      const cb = col.b * crown * lerp(1, 0.24, socket) * (1 + lidLift * 0.30);

      builder.nextFlesh = col.flesh;
      // Tubercle crowns are polished and coarse; the orbital rim carries the
      // wet meniscus every real eye has where the lid meets the cornea.
      builder.nextSkin[0] = clamp01(col.grain + bump * 0.30 - socket * 0.45);
      builder.nextSkin[1] = clamp01(col.bump + bump * 0.25 - socket * 0.70);
      builder.nextSkin[2] = clamp01(col.wet + bump * 0.22 + socket * 0.62);
      row.push(builder.vertex(vx, py, z, j / RADIAL, v, cr, cg, cb, spineWeights(zMono, vx, py, z)));
    }

    // The buccal tube is a separate material group. Hand over on the lip
    // ring: the last cuticle row is duplicated with the mouth palette so
    // both surfaces own a full ring and nothing is stretched across the
    // handover. weldNormals() re-averages the coincident normals.
    if (throat && throatRows.length === 0 && bodyRows.length) {
      const lipRow = bodyRows[bodyRows.length - 1];
      throatRows.push(lipRow.map((idx, j) => {
        paintThroat(0, (j / RADIAL) * TAU);
        builder.nextSkin[0] = col.grain;
        builder.nextSkin[1] = col.bump;
        builder.nextSkin[2] = col.wet;
        return builder.duplicateVertex(idx, col.r, col.g, col.b, col.flesh);
      }));
    }
    (throat ? throatRows : bodyRows).push(row);
  }
  builder.grid(bodyRows);
  const bodyVolume = builder.fixWinding(bodyMark);

  /* ---- legs + claws -------------------------------------------- */
  /**
   * Leg silhouette: buried flare -> shoulder -> telescoping shaft ->
   * foot pad. The alternating radii are cuticular annulations - a real
   * lobopod leg is a stack of soft rings, and without them the limb is
   * a smooth sausage that gives the whole animal a plush-toy read.
   */
  const LEG_PROFILE = [
    [-0.30, 0.150],
    [-0.16, 0.124],
    [-0.04, 0.104],
    [0.10, 0.094],
    [0.32, 0.087],
    [0.56, 0.081],
    [0.78, 0.077],
    [0.90, 0.081],
    [0.965, 0.074],
    [1.00, 0.052],
  ];

  /** Annulation ripple: how many soft cuticular rings ride the shaft. */
  const LEG_RINGS_N = 4.5;
  const LEG_RINGS_AMP = 0.125;

  function legRadius(u) {
    let base = u < 0 ? LEG_PROFILE[0][1] : LEG_PROFILE[LEG_PROFILE.length - 1][1];
    for (let i = 0; i < LEG_PROFILE.length - 1; i += 1) {
      const a = LEG_PROFILE[i];
      const b = LEG_PROFILE[i + 1];
      if (u >= a[0] && u <= b[0]) {
        base = lerp(a[1], b[1], smoothstep(a[0], b[0], u));
        break;
      }
    }
    // Telescoping folds. Analytic so any ring count samples them cleanly -
    // keyed ripples in the table above were aliasing to invisible.
    const window = smoothstep(-0.02, 0.16, u) * (1 - smoothstep(0.86, 1.0, u));
    return base * (1 + LEG_RINGS_AMP * Math.cos(u * TAU * LEG_RINGS_N + 0.7) * window);
  }

  /** Leg UV span so one texture tile is the same physical size as on the body. */
  const LEG_U_SPAN = 2 / CUTICLE_REPEAT;

  const legAxisX = new THREE.Vector3();
  const legAxisZ = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();

  for (const leg of legDefs) {
    // Orthonormal frame around the limb axis.
    tmpUp.set(0, 0, 1);
    if (Math.abs(tmpUp.dot(leg.dir)) > 0.9) tmpUp.set(1, 0, 0);
    legAxisX.copy(tmpUp).cross(leg.dir).normalize();
    legAxisZ.copy(leg.dir).cross(legAxisX).normalize();

    const legMark = builder.index.length;
    const rows = [];
    const RN = tier.legRings;
    for (let i = 0; i <= RN; i += 1) {
      const u = lerp(-0.3, 1.0, i / RN);
      const radius = legRadius(u);
      const axial = u * LEG_REACH;

      // Skin weights along the limb.
      const weights = [];
      if (u < 0.02) {
        const t = clamp01((u + 0.3) / 0.32);
        weights.push([leg.hipSpec.index, 0.25 + 0.75 * t]);
        const bodyBone = leg.spineSpec.index;
        weights.push([bodyBone, 0.75 * (1 - t)]);
      } else if (u < 0.55) {
        const t = smoothstep(0.2, 0.62, u);
        weights.push([leg.hipSpec.index, 1 - t], [leg.midSpec.index, t]);
      } else if (u < 0.9) {
        const t = smoothstep(0.62, 0.94, u);
        weights.push([leg.midSpec.index, 1 - t], [leg.footSpec.index, t]);
      } else {
        weights.push([leg.footSpec.index, 1]);
      }

      // Paler and more translucent toward the tip, where the cuticle is
      // thin enough for the sun to come through it. The shoulder end stays
      // in the body's warm mid-tone so the limbs read as attached rather
      // than as eight pale sausages stuck on the side.
      const paleness = clamp01(smoothstep(0.1, 1.0, u));
      // Pigment collects in the annular grooves. Without it the rings are a
      // pure shading effect that only exists when the sun is exactly
      // side-on, and from every other angle the limb is a smooth sausage.
      const groove = 0.5 - 0.5 * Math.cos(u * TAU * LEG_RINGS_N + 0.7);
      const band = groove
        * smoothstep(-0.02, 0.16, u) * (1 - smoothstep(0.86, 1.0, u)) * 0.26;
      const cr = (0.80 + paleness * 0.50) * (1 - band * 0.88);
      const cg = (0.72 + paleness * 0.50) * (1 - band);
      const cb = (0.62 + paleness * 0.48) * (1 - band * 1.06);
      builder.nextFlesh = clamp01(0.55 + paleness * 0.45);
      // A lobopod leg is soft arthrodial membrane, not a sclerite: a much
      // finer, tighter grain than the dorsal plates, in lower relief. Giving
      // the legs the plates' papillae is precisely the "one uniform scale
      // across head, plates and legs" note. Fluid pools in the annular
      // grooves, so those are the wet part of the limb.
      builder.nextSkin[0] = clamp01(0.13 + groove * 0.10);
      builder.nextSkin[1] = clamp01(0.74 - paleness * 0.26);
      builder.nextSkin[2] = clamp01(0.30 + groove * 0.34 - paleness * 0.12);

      const row = [];
      for (let j = 0; j <= tier.legRadial; j += 1) {
        const theta = (j / tier.legRadial) * TAU;
        const cs = Math.cos(theta);
        const sn = Math.sin(theta);
        scratch.copy(leg.hipModel)
          .addScaledVector(leg.dir, axial)
          .addScaledVector(legAxisX, cs * radius)
          .addScaledVector(legAxisZ, sn * radius);
        // Baked occlusion around the limb. A stubby cylinder a tenth of a
        // unit off the ground sees almost no sky underneath, and without
        // this the legs are eight uniform cream sausages - which is most of
        // what makes a procedural animal read as a soft toy.
        const up = legAxisX.y * cs + legAxisZ.y * sn;
        const lit = 1 - 0.19 * smoothstep(0.15, -0.95, up);
        row.push(builder.vertex(
          scratch.x, scratch.y, scratch.z,
          (j / tier.legRadial) * LEG_U_SPAN, (axial + 0.3 * LEG_REACH) / UV_REF,
          cr * lit, cg * lit, cb * lit, weights.map((w) => [w[0], w[1]])
        ));
      }
      rows.push(row);
    }
    builder.grid(rows);
    builder.fixWinding(legMark);

    /* ---- claw crown ----
       Five claws in a ring around the foot axis. The foot bone rolls the
       whole crown toward the ground while the leg is planted, so a full
       ring is right - one claw always points down into the surface. */
    const clawBase = new THREE.Vector3().copy(leg.hipModel).addScaledVector(leg.dir, LEG_REACH * 0.975);
    const CLAWS = tier.claws;
    for (let k = 0; k < CLAWS; k += 1) {
      const phi = (k / CLAWS) * TAU + 0.32;
      const radialDir = scratchRadial(legAxisX, legAxisZ, phi);
      const baseRadius = CLAW_BASE_R;
      const clawMark = builder.index.length;
      const rows2 = [];
      const CR = tier.clawRings;
      // Arc centre sits one radius "inward" so the claw hooks toward the axis.
      const centre = new THREE.Vector3().copy(clawBase)
        .addScaledVector(radialDir, baseRadius)
        .addScaledVector(radialDir, -CLAW_ARC);
      // Alternate long primary / shorter secondary claws, the way a real
      // water bear's double claws are built.
      const clawLen = (k % 2 === 0 ? 1.0 : 0.74) * (0.96 + 0.12 * Math.cos(phi * 2));
      const clawGirth = k % 2 === 0 ? 1.0 : 0.82;
      for (let i = 0; i <= CR; i += 1) {
        const t = i / CR;
        const ang = t * CLAW_SWEEP * clawLen;
        // Fat, load-bearing base that necks down into a needle point.
        const taper = (1 - t) ** 0.62 * (1 - 0.22 * smoothstep(0, 0.35, t));
        const thickness = Math.max(0.0013, CLAW_THICK * clawGirth * taper);
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        const p0 = new THREE.Vector3().copy(centre)
          .addScaledVector(radialDir, CLAW_ARC * cx)
          .addScaledVector(leg.dir, CLAW_ARC * sy);
        // Frame for the claw's own cross-section.
        const tangent = new THREE.Vector3()
          .addScaledVector(radialDir, -CLAW_ARC * sy)
          .addScaledVector(leg.dir, CLAW_ARC * cx)
          .normalize();
        const nx = new THREE.Vector3().copy(radialDir).cross(leg.dir).normalize();
        const ny = new THREE.Vector3().copy(tangent).cross(nx).normalize();

        // Ivory horn: near-black amber root so the claw separates from the
        // pale foot behind it, bleaching to bright bone at the tip. The
        // root is much darker than the first pass - a bright claw on a
        // bright foot is a claw you cannot see, and the value step at the
        // base is what makes the crown read as five separate hooks.
        const shine = smoothstep(0.04, 0.74, t);
        const cr = 0.30 + shine * 1.44;
        const cg = 0.24 + shine * 1.56;
        const cb = 0.19 + shine * 1.74;
        builder.nextFlesh = 0.12 + shine * 0.5;
        // Claw horn is smooth and polished - no papillae at all, and the one
        // hard specular on the animal apart from the mouth.
        builder.nextSkin[0] = 0;
        builder.nextSkin[1] = 0.06;
        builder.nextSkin[2] = clamp01(0.30 + shine * 0.55);

        const row = [];
        for (let j = 0; j <= tier.clawRadial; j += 1) {
          const theta = (j / tier.clawRadial) * TAU;
          scratch.copy(p0)
            .addScaledVector(nx, Math.cos(theta) * thickness)
            .addScaledVector(ny, Math.sin(theta) * thickness);
          row.push(builder.vertex(
            scratch.x, scratch.y, scratch.z,
            (j / tier.clawRadial) * (1 / CUTICLE_REPEAT),
            (t * CLAW_ARC * CLAW_SWEEP) / UV_REF,
            cr, cg, cb, [[leg.footSpec.index, 1]]
          ));
        }
        rows2.push(row);
      }
      builder.grid(rows2);
      builder.fixWinding(clawMark);
    }
  }

  function scratchRadial(ax, az, phi) {
    return new THREE.Vector3()
      .addScaledVector(ax, Math.cos(phi))
      .addScaledVector(az, Math.sin(phi))
      .normalize();
  }

  const bodyIndexCount = builder.index.length;

  /* ---- eyes (second material group) ----------------------------
     Not "two black dots": a domed cornea over a dark amber iris and a
     jet pupil, sitting in the socket the body loop cut for it. The eye
     material is glossy and unmapped, so the sky gives it a catchlight
     from any angle. */
  const headIndex = boneByName.get("bHead").index;
  /** Where the eye looks: out and slightly forward. */
  const eyeOut = new THREE.Vector3(Math.sin(eyeAngle), Math.cos(eyeAngle) * 0.72, 0.42).normalize();
  for (let s = 0; s < 2; s += 1) {
    const side = s === 0 ? 1 : -1;
    const eyeMark = builder.index.length;
    const rows = [];
    for (let i = 0; i <= tier.eyeLat; i += 1) {
      const v = i / tier.eyeLat;
      const polar = v * Math.PI;
      const row = [];
      for (let j = 0; j <= tier.eyeLon; j += 1) {
        const az = (j / tier.eyeLon) * TAU;
        const sx = Math.sin(polar) * Math.cos(az);
        const sy = Math.cos(polar);
        const sz = Math.sin(polar) * Math.sin(az);

        // Facing: 1 straight down the line of sight, -1 buried in the head.
        const face = sx * eyeOut.x + sy * eyeOut.y + sz * eyeOut.z;
        // Bulge the cornea forward, flatten the buried hemisphere.
        const bulge = 1 + 0.20 * clamp01(face) ** 1.6 - 0.16 * clamp01(-face);

        const px = eyeCentre.x * side + sx * EYE_RADIUS * bulge * side;
        const py = eyeCentre.y + sy * EYE_RADIUS * 0.95 * bulge + eyeOut.y * EYE_RADIUS * 0.1;
        const pz = eyeCentre.z + sz * EYE_RADIUS * 0.95 * bulge + eyeOut.z * EYE_RADIUS * 0.1;

        // Jet pupil in a broad amber iris, ringed by a dark limbus.
        //
        // This is what stops the "flat black dot eyes" note. A uniformly
        // dark eyespot averages, at review distance, to a black pixel; an
        // amber annulus around a jet centre averages to a warm dark dot
        // with structure, and up close it is unmistakably an eye. The
        // limbal ring is the trick portrait painters use - a dark edge
        // makes the iris read as a sphere set into a socket rather than a
        // disc painted onto a bump.
        // `face` is 1 at the centre of the cornea and 0 at the rim of the
        // visible hemisphere, so the *bands* matter more than the colours.
        //
        // Two failure modes were measured on the way here. Flooding the disc
        // with amber makes a mid-tone eye on a mid-tone head, and the eye
        // disappears at any distance. Flooding it with pupil gives exactly
        // the "flat black dot" the review called out. What works is a dark
        // eye - so it holds against the pale head at 30% frame height - with
        // a warm amber annulus at about 70% of the radius, which is what a
        // real pigment-cup eyespot looks like and what rewards a close look.
        const ring = Math.exp(-(((face - 0.70) / 0.17) ** 2))
          * smoothstep(0.04, 0.26, face);
        let cr = 0.040 + ring * 0.470;
        let cg = 0.018 + ring * 0.168;
        let cb = 0.015 + ring * 0.034;
        // Dark limbus at the very edge: a hard rim is what makes the eye
        // read as a sphere set into a socket instead of a disc stuck on.
        const limbal = smoothstep(0.26, 0.03, face);
        cr *= 1 - limbal * 0.62; cg *= 1 - limbal * 0.66; cb *= 1 - limbal * 0.64;

        builder.nextFlesh = 0;
        row.push(builder.vertex(px, py, pz, j / tier.eyeLon, v, cr, cg, cb, [[headIndex, 1]]));
      }
      rows.push(row);
    }
    builder.grid(rows);
    builder.fixWinding(eyeMark);
  }

  const eyeIndexCount = builder.index.length;

  /* ---- buccal tube (third material group) -----------------------
     Built last so the three material groups are contiguous and the hero
     still costs three draw calls. The tube is an open surface, so its
     signed volume is meaningless - it inherits the closed body shell's
     winding decision instead of taking its own. */
  const throatMark = builder.index.length;
  builder.grid(throatRows);
  if (bodyVolume < 0) builder.flipWinding(throatMark);

  /* ---- assemble geometry --------------------------------------- */
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(builder.position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(builder.uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(builder.color, 3));
  // How thin/translucent the cuticle is here. Drives the subsurface term.
  geometry.setAttribute("aFlesh", new THREE.Float32BufferAttribute(builder.flesh, 1));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(builder.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(builder.skinWeight, 4));
  geometry.setIndex(builder.index);
  geometry.computeVertexNormals();
  weldNormals(geometry);
  geometry.addGroup(0, bodyIndexCount, 0);
  geometry.addGroup(bodyIndexCount, eyeIndexCount - bodyIndexCount, 1);
  // A tier coarse enough that the profile never folds back has no throat
  // rings at all; a zero-count group would still cost a draw call.
  if (builder.index.length > throatMark) {
    geometry.addGroup(throatMark, builder.index.length - throatMark, 2);
  }
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius *= 1.6;
  ctx.track(geometry);

  /* ---- materials ------------------------------------------------ */
  function cloneChitin() {
    if (ctx.materials && typeof ctx.materials.make === "function") return ctx.materials.make("chitin", {});
    const base = ctx.materials.get("chitin");
    return ctx.track(base.clone());
  }

  /**
   * The cuticle. Retiled so one texture tile lands on ~0.3 world units of
   * skin, which - with the world-unit UVs authored above - puts the same
   * papilla density on the barrel, the legs and the claws.
   */
  const shell = ctx.materials && typeof ctx.materials.make === "function"
    ? ctx.materials.make("chitin", { repeat: CUTICLE_REPEAT })
    : cloneChitin();
  shell.name = "TardigradeCuticle";
  shell.vertexColors = true;
  if ("clearcoat" in shell) {
    // A waxy epicuticle, not a lacquered toy. The previous 0.85/0.16 put a
    // hard white gloss over every papilla and flattened the albedo; worse,
    // a sharp coat over a high-frequency normal makes every papilla mirror
    // the blue sky and the animal comes out covered in cyan glitter.
    // Raised from 0.16/0.52: at 0.16 the cuticle read chalk-dry, like
    // bisque. A live arthropod is faintly waxy, so the sun leaves a broad
    // soft sheet across the tergites rather than nothing at all. Kept well
    // short of a lacquer, and the specular-AA term below stops the
    // papillae mirroring the sky as cyan glitter.
    shell.clearcoat = 0.27;
    shell.clearcoatRoughness = 0.38;
    if (shell.clearcoatNormalScale) shell.clearcoatNormalScale.set(0.16, 0.16);
  }
  if ("sheen" in shell) {
    // Sheen is the velvet BRDF. On a rounded body it reads as *fabric*,
    // which is most of why the first pass looked like a plush toy.
    shell.sheen = 0;
    shell.sheenRoughness = 1;
  }
  if ("iridescence" in shell) shell.iridescence = 0;
  if ("transmission" in shell) {
    // Real transmission costs a full scene resolve per frame and reads as
    // nothing at this size. The subsurface term below does the job.
    shell.transmission = 0;
    shell.thickness = 0;
  }
  if (shell.normalScale) shell.normalScale.set(0.92, 0.92);
  shell.roughness = 0.46;
  shell.envMapIntensity = 0.95;
  shell.side = THREE.FrontSide;
  shell.needsUpdate = true;

  /* ---- cuticle shader: micro-normal + subsurface + rim ----------
     Three additions on top of the standard physical shader:

       detail normal  a second, much finer sample of the same tangent
                      normal map, so the surface still has structure when
                      the camera is close enough to see individual
                      papillae.
       subsurface     wrapped diffuse plus back-scatter through the shell,
                      weighted by the aFlesh attribute. Thin legs and the
                      pale belly glow; the pigmented dorsal plates do not.
       rim            a fresnel edge light - cool sky blue on the shadow
                      side, warm on the sun side. This is the "rim from
                      behind" of a three-point rig, done in the material
                      so no extra scene lights are added (an extra light
                      recompiles every material in the scene and costs a
                      full lighting loop on all of them).

     NEVER put a backtick inside a GLSL comment here: the shader source is
     a JS template literal and the error surfaces nowhere near the cause. */
  const detailMap = ctx.materials && typeof ctx.materials.texture === "function"
    ? ctx.materials.texture("chitin.normal")
    : null;
  const wantDetail = Boolean(detailMap) && tier.detail !== false;

  const cuticle = {
    uTsSunView: { value: new THREE.Vector3(0.46, 0.62, 0.64).normalize() },
    uTsSunColor: { value: new THREE.Color(1.0, 0.90, 0.74) },
    uTsSssTint: { value: new THREE.Color(1.0, 0.46, 0.20) },
    uTsSss: { value: new THREE.Vector3(0.58, 2.7, 0.32) }, // back gain, back power, wrap gain
    uTsRimCool: { value: new THREE.Color(0.62, 0.78, 1.0) },
    uTsRimWarm: { value: new THREE.Color(1.0, 0.76, 0.44) },
    // Strength was 0.26, which is a rim you have to be told is there. The
    // critic asked for a rim light and this is the whole of it - there is
    // no second scene light on the hero, so if this is timid the animal has
    // no edge against the sky and reads as a flat cutout.
    uTsRim: { value: new THREE.Vector2(0.44, 3.3) }, // strength, power
    uTsDetailMap: { value: detailMap },
    uTsDetail: { value: new THREE.Vector2(4.3, 0.34) }, // uv scale, strength
  };

  shell.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cuticle);

    let vert = shader.vertexShader;
    let frag = shader.fragmentShader;

    vert = vert.replace(
      "#include <common>",
      ["#include <common>", "attribute float aFlesh;", "varying float vTsFlesh;"].join("\n")
    );
    vert = vert.replace(
      "#include <begin_vertex>",
      ["#include <begin_vertex>", "vTsFlesh = aFlesh;"].join("\n")
    );

    let head = [
      "uniform vec3 uTsSunView;",
      "uniform vec3 uTsSunColor;",
      "uniform vec3 uTsSssTint;",
      "uniform vec3 uTsSss;",
      "uniform vec3 uTsRimCool;",
      "uniform vec3 uTsRimWarm;",
      "uniform vec2 uTsRim;",
      "varying float vTsFlesh;",
    ].join("\n") + "\n";

    if (frag.includes("#include <normal_fragment_maps>")) {
      const block = ["#include <normal_fragment_maps>", "{"];

      if (wantDetail) {
        head += "uniform sampler2D uTsDetailMap;\nuniform vec2 uTsDetail;\n";
        block.push(
          // Cotangent frame from screen-space derivatives. Independent of
          // whichever tangent helper the current Three.js ships.
          "  vec3 tsEye = - vViewPosition;",
          "  vec2 tsUv = vNormalMapUv * uTsDetail.x;",
          "  vec3 tsQ0 = dFdx( tsEye );",
          "  vec3 tsQ1 = dFdy( tsEye );",
          "  vec2 tsS0 = dFdx( tsUv );",
          "  vec2 tsS1 = dFdy( tsUv );",
          "  vec3 tsT = tsQ0 * tsS1.y - tsQ1 * tsS0.y;",
          "  vec3 tsB = tsQ1 * tsS0.x - tsQ0 * tsS1.x;",
          "  float tsLen = max( dot( tsT, tsT ), dot( tsB, tsB ) );",
          "  if ( tsLen > 1e-12 ) {",
          "    float tsScale = inversesqrt( tsLen );",
          "    vec3 tsN = texture2D( uTsDetailMap, tsUv ).xyz * 2.0 - 1.0;",
          "    normal = normalize( normal + ( tsT * tsN.x + tsB * tsN.y ) * tsScale * uTsDetail.y );",
          "  }"
        );
      }

      block.push(
        // Fade the whole normal-map perturbation out on surfaces that are
        // edge-on to the camera. A derivative tangent frame is degenerate
        // there, and the deep walls between the segment plates smear into
        // stringy highlights that look like fur. Full strength wherever the
        // surface actually faces the lens.
        "  float tsGraze = clamp( dot( nonPerturbedNormal, normalize( vViewPosition ) ), 0.0, 1.0 );",
        "  normal = normalize( mix( nonPerturbedNormal, normal, smoothstep( 0.02, 0.34, tsGraze ) ) );",
        // Specular anti-aliasing. Thousands of papillae smaller than a
        // pixel each try to mirror the sky, and the result is cyan
        // glitter crawling over the cuticle. Widen the lobe wherever the
        // normal is changing fast across the pixel - crisp up close,
        // smooth at distance, no sparkle at any range.
        "  vec3 tsVx = dFdx( normal );",
        "  vec3 tsVy = dFdy( normal );",
        "  float tsVar = max( dot( tsVx, tsVx ), dot( tsVy, tsVy ) );",
        "  roughnessFactor = clamp( sqrt( roughnessFactor * roughnessFactor + tsVar * 0.85 ), 0.0, 1.0 );",
        "}"
      );

      // nonPerturbedNormal has been standard since r155; if a future Three
      // drops it, skip the grazing fade rather than shipping a broken shader.
      if (frag.includes("nonPerturbedNormal")) {
        frag = frag.replace("#include <normal_fragment_maps>", block.join("\n"));
      } else if (wantDetail) {
        frag = frag.replace(
          "#include <normal_fragment_maps>",
          block.filter((line) => !line.includes("nonPerturbedNormal")).join("\n")
        );
      }
    }

    if (frag.includes("#include <opaque_fragment>")) {
      // Subsurface and rim are both low-frequency effects: light diffusing
      // under the shell, and the shape of the silhouette. Driving them from
      // the micro-normal makes every papilla flip its own fresnel and the
      // animal comes out stippled with blue-white glitter. Use the smooth
      // interpolated normal where Three.js publishes it.
      const smoothN = frag.includes("nonPerturbedNormal") ? "nonPerturbedNormal" : "geometryNormal";
      frag = frag.replace(
        "#include <opaque_fragment>",
        [
          "{",
          `  vec3 tsSmoothN = normalize( ${smoothN} );`,
          "  float tsNdL = dot( tsSmoothN, uTsSunView );",
          "  float tsNdV = clamp( dot( tsSmoothN, geometryViewDir ), 0.0, 1.0 );",
          // Wrapped diffuse: light bleeds a little past the terminator.
          "  float tsWrapped = clamp( ( tsNdL + 0.55 ) / 1.55, 0.0, 1.0 ) - clamp( tsNdL, 0.0, 1.0 );",
          // Back-scatter: sun behind the body, seen through the shell.
          "  float tsBack = pow( clamp( dot( geometryViewDir, - uTsSunView ), 0.0, 1.0 ), uTsSss.y );",
          "  float tsThin = mix( 0.22, 1.0, vTsFlesh ) * mix( 0.55, 1.0, 1.0 - tsNdV );",
          "  vec3 tsSss = uTsSunColor * uTsSssTint * diffuseColor.rgb",
          "             * ( tsBack * uTsSss.x + tsWrapped * uTsSss.z ) * tsThin;",
          // Fresnel rim: cool on the shadow side, warm on the sun side.
          "  float tsFres = pow( 1.0 - tsNdV, uTsRim.y );",
          "  vec3 tsRimCol = mix( uTsRimCool, uTsRimWarm, clamp( tsNdL * 0.5 + 0.5, 0.0, 1.0 ) );",
          "  vec3 tsRim = tsRimCol * tsFres * uTsRim.x * mix( 0.7, 1.0, vTsFlesh );",
          "  outgoingLight += tsSss + tsRim;",
          "}",
          "#include <opaque_fragment>",
        ].join("\n")
      );
    }

    shader.vertexShader = vert;
    shader.fragmentShader = head + frag;
  };
  shell.customProgramCacheKey = () => `tsim-cuticle${wantDetail ? "-d" : ""}`;

  /* ---- eyes: a clean glossy cornea, no cuticle texture ---------- */
  const eyeMat = cloneChitin();
  eyeMat.name = "TardigradeEye";
  eyeMat.vertexColors = true;
  eyeMat.color.setRGB(1, 1, 1);
  eyeMat.map = null;
  eyeMat.normalMap = null;
  eyeMat.aoMap = null;
  eyeMat.roughnessMap = null;
  eyeMat.metalnessMap = null;
  eyeMat.metalness = 0;
  eyeMat.roughness = 0.075;
  if ("clearcoatNormalMap" in eyeMat) eyeMat.clearcoatNormalMap = null;
  if ("clearcoat" in eyeMat) {
    // Clearcoat 1.0 stacks a second, near-mirror lobe on top of an already
    // glossy base and the sky wins over the pigment: the eye turns into a
    // navy bead. Halved, the sun still leaves a crisp catchlight and the
    // amber iris survives.
    eyeMat.clearcoat = 0.5;
    eyeMat.clearcoatRoughness = 0.035;
  }
  if ("sheen" in eyeMat) eyeMat.sheen = 0;
  if ("iridescence" in eyeMat) eyeMat.iridescence = 0;
  if ("transmission" in eyeMat) { eyeMat.transmission = 0; eyeMat.thickness = 0; }
  // 2.4 turned the cornea into a chrome bead: the whole dome mirrored the
  // sky and both the pupil and the iris disappeared under it. 0.6 leaves a
  // single tight catchlight and lets the amber through.
  eyeMat.envMapIntensity = 0.6;
  eyeMat.needsUpdate = true;

  /* ---- buccal tube: wet, unmapped, sharp specular ----------------
     The one genuinely wet surface on the animal, and the reason the head
     stops reading as a beige knob with a hole painted on it. No cuticle
     texture (a wet membrane has no papillae), very low roughness, full
     clearcoat, so the sun and the sky both put a hard highlight on the rim
     of the tube and down one wall of it. */
  const mouthMat = cloneChitin();
  mouthMat.name = "TardigradeBuccalTube";
  mouthMat.vertexColors = true;
  mouthMat.color.setRGB(1, 1, 1);
  mouthMat.map = null;
  mouthMat.normalMap = null;
  mouthMat.aoMap = null;
  mouthMat.roughnessMap = null;
  mouthMat.metalnessMap = null;
  mouthMat.metalness = 0;
  mouthMat.roughness = 0.26;
  if ("clearcoatNormalMap" in mouthMat) mouthMat.clearcoatNormalMap = null;
  if ("clearcoat" in mouthMat) {
    // A near-mirror coat over a dark red base picks up the blue sky and the
    // whole mouth turns lavender. Enough coat for a wet sun highlight, not
    // enough to reflect the sky as a colour.
    mouthMat.clearcoat = 0.38;
    mouthMat.clearcoatRoughness = 0.16;
  }
  if ("sheen" in mouthMat) mouthMat.sheen = 0;
  if ("iridescence" in mouthMat) mouthMat.iridescence = 0;
  if ("transmission" in mouthMat) { mouthMat.transmission = 0; mouthMat.thickness = 0; }
  // A wet membrane deep inside a tube sees almost no sky. Anything above
  // ~0.5 here and the whole mouth turns pearlescent.
  mouthMat.envMapIntensity = 0.35;
  mouthMat.side = THREE.FrontSide;
  mouthMat.needsUpdate = true;

  /* ---- scene graph + skeleton ----------------------------------- */
  const root = new THREE.Group();
  root.name = "Tardigrade";
  ctx.scene.add(root);

  const rig = new THREE.Group();
  rig.name = "TardigradeRig";
  rig.position.y = -DEFAULT_GROUND_OFFSET;
  root.add(rig);

  const bones = boneSpecs.map((spec) => {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.copy(spec.local);
    bone.quaternion.copy(spec.quat);
    return bone;
  });
  for (const spec of boneSpecs) {
    if (spec.parentIndex >= 0) bones[spec.parentIndex].add(bones[spec.index]);
    else rig.add(bones[spec.index]);
  }

  const mesh = new THREE.SkinnedMesh(geometry, [shell, eyeMat, mouthMat]);
  mesh.name = "TardigradeBody";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  rig.add(mesh);

  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  ctx.track(skeleton);

  // Rest-pose snapshot, used for blending and for the ragdoll spec.
  const restQuat = bones.map((b) => b.quaternion.clone());
  const restPos = bones.map((b) => b.position.clone());

  const bRoot = bones[boneByName.get("bRoot").index];
  const bBody = bones[boneByName.get("bBody").index];
  const bF1 = bones[boneByName.get("bF1").index];
  const bF2 = bones[boneByName.get("bF2").index];
  const bHead = bones[boneByName.get("bHead").index];
  const bMouth = bones[boneByName.get("bMouth").index];
  const bB1 = bones[boneByName.get("bB1").index];
  const bB2 = bones[boneByName.get("bB2").index];
  const bTail = bones[boneByName.get("bTail").index];
  const spineChain = [bF1, bF2, bHead, bB1, bB2, bTail];

  for (const leg of legDefs) {
    leg.hipBone = bones[leg.hipSpec.index];
    leg.midBone = bones[leg.midSpec.index];
    leg.footBone = bones[leg.footSpec.index];
    leg.spineBone = bones[leg.spineSpec.index];
    leg.restWorld = new THREE.Vector3();
    leg.plant = new THREE.Vector3();
    leg.from = new THREE.Vector3();
    leg.to = new THREE.Vector3();
    leg.foot = new THREE.Vector3();
    leg.swinging = false;
    leg.lift = 0;
    leg.hipWorld = new THREE.Vector3();
    leg.poleDir = new THREE.Vector3(leg.dir.x * 0.35, 0.94, leg.dir.z * 0.2).normalize();
    leg.retractDir = new THREE.Vector3(leg.dir.x * 0.32, -0.86, leg.dir.z * 0.3).normalize();
  }

  /* ================================================================
     3. Animation state
     ================================================================ */

  const pose = {
    speed: 0,
    grounded: true,
    airborne: false,
    curled: false,
    ragdoll: false,
    turnRate: null,
  };

  const state = {
    gaitPhase: 0,
    gaitHz: 0,
    speedWorld: 0,
    curl: 0,
    air: 0,
    procBlend: 1,
    squash: 0,
    squashVel: 0,
    crouch: 0,
    headYaw: 0,
    headPitch: 0,
    bank: 0,
    turn: 0,
    groundOffset: DEFAULT_GROUND_OFFSET,
    landTimer: 0,
    bonkTimer: 0,
    chompTimer: 0,
    squeakTimer: 0,
    breathPhase: rng() * TAU,
    elapsed: 0,
    steps: 0,
  };

  const prevPos = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const smoothVel = new THREE.Vector3();
  let prevYaw = 0;
  let wasGrounded = true;
  let initialised = false;

  /* Scratch - nothing below allocates per frame. */
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _v5 = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _q3 = new THREE.Quaternion();
  /** Extra scratch quaternion for composing rotations onto _q3. */
  const _qa = new THREE.Quaternion();
  const _m1 = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _m3 = new THREE.Matrix4();
  const _basis = new THREE.Matrix4();
  const _bx = new THREE.Vector3();
  const _by = new THREE.Vector3();
  const _bz = new THREE.Vector3();
  const _euler = new THREE.Euler();

  function groundAt(x, z) {
    if (ctx.world && typeof ctx.world.heightAt === "function") {
      const h = ctx.world.heightAt(x, z);
      return Number.isFinite(h) ? h : 0;
    }
    return 0;
  }

  function resetFeet() {
    rig.updateWorldMatrix(true, false);
    for (const leg of legDefs) {
      leg.restWorld.copy(leg.restLocal).applyMatrix4(rig.matrixWorld);
      leg.restWorld.y = groundAt(leg.restWorld.x, leg.restWorld.z) + FOOT_CLEAR;
      leg.plant.copy(leg.restWorld);
      leg.from.copy(leg.restWorld);
      leg.to.copy(leg.restWorld);
      leg.foot.copy(leg.restWorld);
      leg.swinging = false;
    }
  }

  /* ---- events --------------------------------------------------- */
  if (ctx.events && typeof ctx.events.on === "function") {
    ctx.events.on("player:land", (payload) => {
      const impact = payload && Number.isFinite(payload.impactSpeed) ? Math.abs(payload.impactSpeed) : 6;
      applyLanding(impact);
    });
    ctx.events.on("player:jump", () => {
      state.squash -= 0.3;
      state.squashVel -= 1.4;
      state.crouch = 0;
    });
    ctx.events.on("player:ragdoll", (payload) => {
      pose.ragdoll = !!(payload && payload.enabled);
    });
  }

  function applyLanding(impact) {
    const hit = clamp(impact * 0.024, 0.06, 0.44);
    state.squash += hit;
    state.squashVel += hit * 7;
    state.landTimer = 1;
  }

  /* ================================================================
     4. Posing
     ================================================================ */

  /** Blend a bone toward a target local transform, honouring procBlend. */
  function setBone(bone, quat, blend) {
    if (blend >= 0.999) bone.quaternion.copy(quat);
    else bone.quaternion.slerp(quat, blend);
  }

  function poseSpine(dt) {
    const blend = state.procBlend;
    const curl = state.curl;
    const air = state.air;

    /* ---- squash / stretch spring ---- */
    state.squashVel += (-state.squash * 190 - state.squashVel * 17) * dt;
    state.squash += state.squashVel * dt;
    state.squash = clamp(state.squash, -0.45, 0.55);

    const vertical = clamp(-velocity.y * 0.006, -0.16, 0.16);
    const sq = clamp(state.squash + vertical + state.crouch * 0.35, -0.4, 0.55);

    const breath = Math.sin(state.elapsed * 1.55 + state.breathPhase);
    const walkPulse = Math.sin(state.gaitPhase * TAU * 2) * 0.016 * clamp01(state.speedWorld / 4);

    /* ---- whole-trunk scale on bBody ---- */
    const fat = 1 + sq * 0.32 + breath * 0.016 + walkPulse + curl * 0.2;
    const tall = 1 - sq * 0.5 + breath * 0.012 - curl * 0.02;
    const long = 1 - sq * 0.26 - curl * 0.2 + clamp(-vertical, -0.1, 0.14);
    _v1.set(fat, tall, long);
    if (blend >= 0.999) bBody.scale.copy(_v1);
    else bBody.scale.lerp(_v1, blend);

    /* ---- lateral body curve into turns + curl ---- */
    const turnCurve = clamp(state.turn * 0.055, -0.24, 0.24);
    const arch = 0.05 * clamp01(air) - 0.03 * clamp01(state.speedWorld / 8);

    const forwardCurl = [0.55, 0.68, 0.78, 0.2];
    const backCurl = [-0.58, -0.7, -0.72];

    _euler.set(forwardCurl[0] * curl + arch + state.landTimer * 0.05, turnCurve, 0, "YXZ");
    setBone(bF1, _q1.setFromEuler(_euler), blend);
    _euler.set(forwardCurl[1] * curl + arch * 1.2, turnCurve * 1.15, turnCurve * 0.5, "YXZ");
    setBone(bF2, _q1.setFromEuler(_euler), blend);
    _euler.set(
      forwardCurl[2] * curl + state.headPitch,
      state.headYaw + turnCurve * 0.6,
      -state.bank * 0.4,
      "YXZ"
    );
    setBone(bHead, _q1.setFromEuler(_euler), blend);

    const chomp = state.chompTimer > 0 ? Math.sin((1 - state.chompTimer) * Math.PI * 2) : 0;
    _euler.set(forwardCurl[3] * curl - chomp * 0.25, 0, 0, "YXZ");
    setBone(bMouth, _q1.setFromEuler(_euler), blend);
    const mouthOut = 1 + chomp * 0.5 - curl * 0.6 + Math.sin(state.elapsed * 0.9) * 0.03;
    _v1.set(1 + chomp * 0.35 - curl * 0.5, 1 + chomp * 0.35 - curl * 0.5, clamp(mouthOut, 0.28, 1.7));
    if (blend >= 0.999) bMouth.scale.copy(_v1); else bMouth.scale.lerp(_v1, blend);

    _euler.set(backCurl[0] * curl - arch * 0.5, -turnCurve * 0.8, 0, "YXZ");
    setBone(bB1, _q1.setFromEuler(_euler), blend);
    _euler.set(backCurl[1] * curl - arch * 0.6, -turnCurve * 0.9, 0, "YXZ");
    setBone(bB2, _q1.setFromEuler(_euler), blend);
    _euler.set(backCurl[2] * curl - arch * 0.8 - clamp01(air) * 0.18, -turnCurve * 0.7, 0, "YXZ");
    setBone(bTail, _q1.setFromEuler(_euler), blend);

    /* ---- root bob, bank, lean ---- */
    const bobY = Math.sin(state.gaitPhase * TAU * 2) * 0.018 * clamp01(state.speedWorld / 3);
    const swayX = Math.sin(state.gaitPhase * TAU) * 0.016 * clamp01(state.speedWorld / 3);
    const settle = -sq * 0.13 - curl * 0.02 - state.crouch * 0.09;
    _v1.set(swayX, STAND_Y + bobY + settle + curl * 0.03, 0);
    if (blend >= 0.999) bRoot.position.copy(_v1); else bRoot.position.lerp(_v1, blend);

    // Lean into acceleration; roll into turns; nose up when rising.
    _v2.copy(smoothVel);
    _v2.y = 0;
    const forwardLean = clamp(_v2.length() * 0.012, 0, 0.1);
    const bonk = state.bonkTimer > 0 ? Math.sin(state.bonkTimer * Math.PI * 3) * state.bonkTimer : 0;
    _euler.set(
      -forwardLean + clamp(velocity.y * 0.004, -0.12, 0.12) + bonk * 0.28,
      bonk * 0.12,
      state.bank + bonk * 0.2,
      "YXZ"
    );
    setBone(bRoot, _q1.setFromEuler(_euler), blend);

    const squeak = state.squeakTimer > 0 ? Math.sin(state.squeakTimer * Math.PI) : 0;
    if (squeak > 0.001) {
      bBody.scale.multiplyScalar(1 + squeak * 0.12);
      bBody.scale.y *= 1 - squeak * 0.16;
    }
  }

  /* ---- re-derive each hip from the spine bone it hangs off ------- */
  function updateHips(blend) {
    _m3.copy(bRoot.matrixWorld).invert();
    for (const leg of legDefs) {
      _m1.makeRotationFromQuaternion(leg.hipQuat);
      _m1.setPosition(leg.attachLocal.x, leg.attachLocal.y, leg.attachLocal.z);
      _m2.multiplyMatrices(leg.spineBone.matrixWorld, _m1);
      _m2.premultiply(_m3);
      _m2.decompose(_v1, _q1, _v2);
      if (blend >= 0.999) {
        leg.hipBone.position.copy(_v1);
        leg.hipBone.quaternion.copy(_q1);
      } else {
        leg.hipBone.position.lerp(_v1, blend);
        leg.hipBone.quaternion.slerp(_q1, blend);
      }
      leg.hipBone.scale.set(1, 1, 1);
    }
  }

  /* ---- gait ------------------------------------------------------ */
  function updateGait(dt) {
    const speed = state.speedWorld;
    let hz = 0;
    if (speed > 0.2) hz = clamp(speed / GAIT_STRIDE, GAIT_MIN_HZ, GAIT_MAX_HZ);

    // Turning on the spot still needs the wave to run so feet reposition.
    let maxError = 0;
    rig.updateWorldMatrix(true, false);
    for (const leg of legDefs) {
      leg.restWorld.copy(leg.restLocal).applyMatrix4(rig.matrixWorld);
      const dx = leg.plant.x - leg.restWorld.x;
      const dz = leg.plant.z - leg.restWorld.z;
      maxError = Math.max(maxError, Math.hypot(dx, dz));
    }
    if (hz <= 0 && maxError > 0.2) hz = GAIT_MIN_HZ * clamp(maxError * 3, 0.6, 2.2);

    state.gaitHz = hz;
    state.gaitPhase += dt * hz;
    if (state.gaitPhase > 1e6) state.gaitPhase = 0;

    const swingDur = (1 - GAIT_DUTY) / Math.max(0.6, hz);
    const stanceDur = GAIT_DUTY / Math.max(0.6, hz);
    const liftHeight = 0.075 + 0.06 * clamp01(speed / 7);
    const splay = state.landTimer * 0.12;

    for (const leg of legDefs) {
      const target = leg.restWorld;
      target.addScaledVector(_v5.copy(target).sub(rigWorldPos).setY(0).normalize(), splay);
      target.y = groundAt(target.x, target.z) + FOOT_CLEAR;

      let phase = (state.gaitPhase + leg.phase) % 1;
      if (phase < 0) phase += 1;

      if (hz <= 0.001) {
        // Frozen: hold the plant, but keep it glued to the ground.
        leg.swinging = false;
        leg.plant.y = groundAt(leg.plant.x, leg.plant.z) + FOOT_CLEAR;
        leg.foot.copy(leg.plant);
        continue;
      }

      if (phase >= GAIT_DUTY) {
        const s = (phase - GAIT_DUTY) / (1 - GAIT_DUTY);
        if (!leg.swinging) {
          leg.swinging = true;
          leg.from.copy(leg.plant);
          state.steps += 1;
        }
        const remaining = (1 - s) * swingDur + stanceDur * 0.5;
        leg.to.copy(target).addScaledVector(smoothVel, remaining * 1.04);
        leg.to.y = groundAt(leg.to.x, leg.to.z) + FOOT_CLEAR;

        const ease = s * s * (3 - 2 * s);
        leg.foot.lerpVectors(leg.from, leg.to, ease);
        leg.foot.y += Math.sin(Math.PI * s) * liftHeight;
        leg.lift = Math.sin(Math.PI * s);
      } else {
        if (leg.swinging) {
          leg.swinging = false;
          leg.plant.copy(leg.to);
        }
        leg.plant.y = groundAt(leg.plant.x, leg.plant.z) + FOOT_CLEAR;
        leg.foot.copy(leg.plant);
        leg.lift = 0;
      }
    }
  }

  const rigWorldPos = new THREE.Vector3();

  /* ---- two-bone analytic IK -------------------------------------- */
  function solveLeg(leg, blend) {
    leg.hipWorld.setFromMatrixPosition(leg.hipBone.matrixWorld);

    // Work in bRoot space so the hip's local quaternion is the answer.
    _m3.copy(bRoot.matrixWorld).invert();
    _v1.copy(leg.foot).applyMatrix4(_m3);      // target
    _v2.copy(leg.hipBone.position);            // hip origin
    _v3.subVectors(_v1, _v2);                  // hip -> target

    let dist = _v3.length();
    const maxLen = LEG_REACH * 0.995;
    if (dist < 0.04) { _v3.set(0, -0.04, 0); dist = 0.04; }
    if (dist > maxLen) { _v3.multiplyScalar(maxLen / dist); dist = maxLen; }
    _v3.normalize();

    const cosKnee = clamp((LEG_UPPER * LEG_UPPER + LEG_LOWER * LEG_LOWER - dist * dist) / (2 * LEG_UPPER * LEG_LOWER), -1, 1);
    const knee = Math.acos(cosKnee);
    const alpha = Math.atan2(LEG_LOWER * Math.sin(knee), LEG_UPPER + LEG_LOWER * Math.cos(knee));

    // Pole: knee bows up and outward like a crab's.
    _v4.copy(_v3).cross(leg.poleDir);
    if (_v4.lengthSq() < 1e-8) _v4.set(1, 0, 0);
    _v4.normalize();                              // bend normal -> hip local +X
    _by.copy(_v3).applyAxisAngle(_v4, alpha);     // hip local +Y
    _bx.copy(_v4);
    _bz.copy(_bx).cross(_by).normalize();
    _basis.makeBasis(_bx, _by, _bz);
    _q1.setFromRotationMatrix(_basis);

    _q2.setFromAxisAngle(X_AXIS, -(Math.PI - knee));

    if (state.curl > 0.001) {
      // Retract: tuck the leg under the barrel.
      _v5.copy(leg.retractDir);
      _by.copy(_v5);
      _bx.set(-_v5.z, 0, _v5.x).normalize();
      _bz.copy(_bx).cross(_by).normalize();
      _basis.makeBasis(_bx, _by, _bz);
      _q3.setFromRotationMatrix(_basis);
      _q1.slerp(_q3, state.curl);
      _q3.setFromAxisAngle(X_AXIS, -2.35);
      _q2.slerp(_q3, state.curl);
    }

    if (state.air > 0.001) {
      // Loose, wind-milling flail around the leg's neutral splay.
      const t = state.elapsed;
      const p = leg.flail;
      _by.copy(leg.dir);
      _bx.set(-_by.z, 0, _by.x).normalize();
      _bz.copy(_bx).cross(_by).normalize();
      _basis.makeBasis(_bx, _by, _bz);
      _q3.setFromRotationMatrix(_basis);
      _q3.multiply(_qa.setFromAxisAngle(X_AXIS, Math.sin(t * 11.5 + p) * 0.7));
      _q3.multiply(_qa.setFromAxisAngle(Z_AXIS, Math.cos(t * 8.7 + p * 1.7) * 0.5));
      _q1.slerp(_q3, state.air);
      _q3.setFromAxisAngle(X_AXIS, -(1.1 + Math.sin(t * 15.5 + p * 1.7) * 0.6));
      _q2.slerp(_q3, state.air * 0.9);
    }

    if (blend >= 0.999) {
      leg.hipBone.quaternion.copy(_q1);
      leg.midBone.quaternion.copy(_q2);
    } else {
      leg.hipBone.quaternion.slerp(_q1, blend);
      leg.midBone.quaternion.slerp(_q2, blend);
    }

    // Foot: roll the claw crown down onto the ground while planted.
    leg.hipBone.updateWorldMatrix(false, false);
    leg.midBone.updateWorldMatrix(false, false);
    _q3.setFromRotationMatrix(leg.midBone.matrixWorld).invert();
    _v5.set(0, -1, 0).applyQuaternion(_q3).normalize();
    const plantAmount = (1 - leg.lift * 0.8) * (1 - state.curl) * (1 - state.air) * 0.8;
    _q1.setFromUnitVectors(Y_AXIS, _v5);
    _q2.identity().slerp(_q1, plantAmount);
    if (blend >= 0.999) leg.footBone.quaternion.copy(_q2);
    else leg.footBone.quaternion.slerp(_q2, blend);
  }

  /* ================================================================
     5. Per-frame tick
     ================================================================ */

  let lateSeen = false;

  /**
   * The cuticle shader works in view space (that is where `geometryNormal`
   * and `geometryViewDir` live), so the sun has to be rotated into the
   * camera's frame once a frame. One quaternion, no allocation.
   */
  const sunWorld = new THREE.Vector3(0.46, 0.62, 0.64).normalize();
  function updateCuticleUniforms() {
    const engine = ctx.engine;
    if (engine && engine.sun && engine.sun.direction) sunWorld.copy(engine.sun.direction);
    const cam = ctx.camera;
    if (!cam) return;
    cam.getWorldQuaternion(_q1);
    _q1.invert();
    cuticle.uTsSunView.value.copy(sunWorld).applyQuaternion(_q1);
  }

  function tick(dt) {
    const step = clamp(dt, 0.0001, 0.1);
    state.elapsed += step;
    updateCuticleUniforms();

    root.updateWorldMatrix(true, false);
    rigWorldPos.setFromMatrixPosition(root.matrixWorld);

    if (!initialised) {
      prevPos.copy(rigWorldPos);
      prevYaw = root.rotation.y;
      initialised = true;
      resetFeet();
    }

    /* ---- measured motion ---- */
    _v1.subVectors(rigWorldPos, prevPos);
    if (_v1.lengthSq() > 9) {
      // Teleport: reset instead of launching the feet across the map.
      prevPos.copy(rigWorldPos);
      velocity.set(0, 0, 0);
      smoothVel.set(0, 0, 0);
      resetFeet();
      _v1.set(0, 0, 0);
    }
    velocity.copy(_v1).divideScalar(step);
    prevPos.copy(rigWorldPos);
    smoothVel.lerp(velocity, 1 - Math.exp(-14 * step));
    smoothVel.y = 0;
    state.speedWorld = Math.hypot(velocity.x, velocity.z);

    const yaw = root.rotation.y;
    const measuredTurn = wrapAngle(yaw - prevYaw) / step;
    prevYaw = yaw;
    state.turn = damp(state.turn, Number.isFinite(pose.turnRate) ? pose.turnRate : measuredTurn, 9, step);

    /* ---- ground calibration: works with any root height convention ---- */
    const grounded = pose.grounded !== false && pose.airborne !== true;
    const groundY = groundAt(rigWorldPos.x, rigWorldPos.z);
    if (grounded) {
      const measured = clamp(rigWorldPos.y - groundY, -0.4, 1.6);
      state.groundOffset = damp(state.groundOffset, measured, 1.6, step);
    }
    rig.position.y = -state.groundOffset;

    /* ---- landing detection fallback ---- */
    if (grounded && !wasGrounded) applyLanding(Math.abs(velocity.y));
    wasGrounded = grounded;

    /* ---- blends ---- */
    state.curl = damp(state.curl, pose.curled ? 1 : 0, 6.5, step);
    state.air = damp(state.air, grounded ? 0 : 1, 7, step);
    state.procBlend = damp(state.procBlend, pose.ragdoll ? 0 : 1, 7, step);
    state.landTimer = Math.max(0, state.landTimer - step * 4.5);
    state.bonkTimer = Math.max(0, state.bonkTimer - step * 2.6);
    state.chompTimer = Math.max(0, state.chompTimer - step * 3.4);
    state.squeakTimer = Math.max(0, state.squeakTimer - step * 3.8);

    // Anticipation crouch while the jump button is held on the ground.
    const wantJump = !!(ctx.input && typeof ctx.input.down === "function" && ctx.input.down("jump"));
    state.crouch = damp(state.crouch, wantJump && grounded ? 1 : 0, wantJump ? 26 : 12, step);

    if (pose.ragdoll && state.procBlend < 0.01) {
      rig.updateMatrixWorld(true);
      return;
    }

    /* ---- head aim toward travel ---- */
    _v2.copy(smoothVel);
    const travel = _v2.length();
    let targetHeadYaw = 0;
    let targetPitch = -0.06 + state.crouch * 0.1;
    if (travel > 0.5) {
      const localAngle = wrapAngle(Math.atan2(_v2.x, _v2.z) - yaw);
      targetHeadYaw = clamp(localAngle * 0.55, -0.5, 0.5);
    }
    targetHeadYaw += clamp(state.turn * 0.07, -0.32, 0.32);
    targetPitch += clamp(-velocity.y * 0.006, -0.2, 0.24) * clamp01(state.air);
    state.headYaw = damp(state.headYaw, targetHeadYaw * (1 - state.curl), 9, step);
    state.headPitch = damp(state.headPitch, targetPitch, 8, step);
    state.bank = damp(state.bank, clamp(-state.turn * 0.075, -0.3, 0.3) * clamp01(state.speedWorld / 3), 7, step);

    /* ---- gait ---- */
    if (state.curl < 0.85 && state.air < 0.9) updateGait(step);
    else {
      state.gaitHz = 0;
      for (const leg of legDefs) leg.lift = 0;
    }

    /* ---- pose the rig ---- */
    poseSpine(step);
    bRoot.updateWorldMatrix(true, true);
    updateHips(state.procBlend);
    bRoot.updateWorldMatrix(false, true);
    for (const leg of legDefs) solveLeg(leg, state.procBlend);
    rig.updateMatrixWorld(true);
  }

  /* ================================================================
     6. Ragdoll spec
     ================================================================ */

  const RAGDOLL_TRUNK = {
    bBody: { radius: 0.31, length: 0.5, mass: 0.34, simulate: true },
    bF1: { radius: 0.3, length: 0.24, mass: 0.16, simulate: false },
    bF2: { radius: 0.28, length: 0.2, mass: 0.14, simulate: true },
    bHead: { radius: 0.22, length: 0.14, mass: 0.1, simulate: true },
    bMouth: { radius: 0.1, length: 0.05, mass: 0.02, simulate: false },
    bB1: { radius: 0.3, length: 0.24, mass: 0.16, simulate: false },
    bB2: { radius: 0.27, length: 0.22, mass: 0.13, simulate: true },
    bTail: { radius: 0.16, length: 0.1, mass: 0.05, simulate: true },
    bRoot: { radius: 0.3, length: 0.3, mass: 0.0, simulate: false },
  };

  const Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

  let ragdollSpec = null;
  function buildRagdollSpec() {
    const list = boneSpecs.map((spec) => {
      const bone = bones[spec.index];
      let shape;
      let mass;
      let simulate;
      let group = spec.group;

      if (spec.name.startsWith("legHip")) {
        shape = { type: "capsule", radius: 0.085, halfHeight: LEG_UPPER * 0.42, axis: [0, 1, 0], offset: [0, LEG_UPPER * 0.5, 0], rotation: [0, 0, 0, 1] };
        mass = 0.022; simulate = true; group = "leg";
      } else if (spec.name.startsWith("legMid")) {
        shape = { type: "capsule", radius: 0.07, halfHeight: LEG_LOWER * 0.38, axis: [0, 1, 0], offset: [0, LEG_LOWER * 0.5, 0], rotation: [0, 0, 0, 1] };
        mass = 0.016; simulate = true; group = "leg";
      } else if (spec.name.startsWith("legFoot")) {
        shape = { type: "sphere", radius: 0.062, halfHeight: 0, axis: [0, 1, 0], offset: [0, 0.02, 0], rotation: [0, 0, 0, 1] };
        mass = 0.008; simulate = false; group = "leg";
      } else {
        const d = RAGDOLL_TRUNK[spec.name];
        shape = {
          type: "capsule",
          radius: d.radius,
          halfHeight: d.length * 0.5,
          axis: [0, 0, 1],
          offset: [0, 0, spec.name.startsWith("bB") || spec.name === "bTail" ? -d.length * 0.35 : d.length * 0.35],
          rotation: [Y_TO_Z.x, Y_TO_Z.y, Y_TO_Z.z, Y_TO_Z.w],
        };
        if (spec.name === "bBody" || spec.name === "bRoot") shape.offset = [0, 0, 0];
        mass = d.mass;
        simulate = d.simulate;
      }

      return {
        index: spec.index,
        name: spec.name,
        parent: spec.parent,
        parentIndex: spec.parentIndex,
        group,
        simulate,
        mass,
        /** Rest transform in MODEL space (y = 0 is the ground plane). */
        position: [spec.model.x, spec.model.y, spec.model.z],
        quaternion: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
        /** Rest transform relative to the parent bone. */
        localPosition: [spec.local.x, spec.local.y, spec.local.z],
        shape,
        limits: group === "leg"
          ? { swing: 0.9, twist: 0.35 }
          : spec.name === "bHead" ? { swing: 0.7, twist: 0.4 } : { swing: 0.55, twist: 0.3 },
      };
    });

    return {
      version: 1,
      length: BODY_LENGTH,
      /** model space -> `root` local space (add this to a model-space point). */
      rootOffset: [0, rig.position.y, 0],
      /** Distance from `root` down to the ground that the rig is calibrated to. */
      groundOffset: state.groundOffset,
      totalMass: list.reduce((sum, b) => sum + b.mass, 0),
      bones: list,
      simulated: list.filter((b) => b.simulate).map((b) => b.index),
    };
  }

  /* ================================================================
     7. API
     ================================================================ */

  const api = {
    root,
    rig,
    mesh,
    bones,
    skeleton,
    length: BODY_LENGTH,
    /** Height of the body centre above the ground when standing. */
    standHeight: STAND_Y,

    setPose(next) {
      if (!next) return;
      if (next.speed !== undefined) pose.speed = next.speed;
      if (next.grounded !== undefined) pose.grounded = next.grounded;
      if (next.airborne !== undefined) pose.airborne = next.airborne;
      if (next.curled !== undefined) pose.curled = !!next.curled;
      if (next.ragdoll !== undefined) pose.ragdoll = !!next.ragdoll;
      pose.turnRate = Number.isFinite(next.turnRate) ? next.turnRate : null;
    },

    setFacing(yaw) {
      if (Number.isFinite(yaw)) root.rotation.y = yaw;
    },

    /**
     * Pitch the body about its own right axis, in radians. Used to lie the
     * animal flat against a wall while it climbs.
     *
     * This tilts the RIG, not the root: the root's rotation.y is read back
     * every frame for turn rate and banking, so putting the tilt on the root
     * (which keeps quaternion and euler in sync) would corrupt that
     * bookkeeping and make the animal bank as though it were cornering.
     */
    setTilt(pitch) {
      if (Number.isFinite(pitch)) rig.rotation.x = pitch;
    },

    /**
     * World position of the body centre - the point a camera should aim at
     * to frame the animal.
     *
     * `root` is a *controller* position, not a visual one: the rig hangs
     * below it by a self-calibrated ground offset that varies with the
     * surface (it measured 0.5 on soil and 1.4 standing on the patio slab).
     * A beauty shot that aims at `root` therefore sits somewhere between
     * "centred" and "the animal is falling out of the bottom of the frame"
     * depending on where the hero happens to be standing, which is exactly
     * the crop the last review saw. Aim here instead.
     */
    focusPoint(out) {
      const target = out || new THREE.Vector3();
      root.updateWorldMatrix(true, false);
      bBody.updateWorldMatrix(true, false);
      return target.setFromMatrixPosition(bBody.matrixWorld);
    },

    playOneShot(name) {
      switch (name) {
        case "bonk": state.bonkTimer = 1; state.squash += 0.16; state.squashVel += 3.2; break;
        case "chomp": state.chompTimer = 1; break;
        case "land": applyLanding(10); break;
        case "squeak": state.squeakTimer = 1; state.squash -= 0.12; break;
        default: return null;
      }
      return name;
    },

    update(dt) {
      if (!lateSeen) tick(dt);
    },

    lateUpdate(dt) {
      lateSeen = true;
      tick(dt);
    },

    /* ---- ragdoll hookup for physics.js ---- */
    getRagdollSpec() {
      if (!ragdollSpec) ragdollSpec = buildRagdollSpec();
      ragdollSpec.groundOffset = state.groundOffset;
      ragdollSpec.rootOffset[1] = rig.position.y;
      return ragdollSpec;
    },

    get ragdollActive() {
      return pose.ragdoll;
    },

    setRagdoll(enabled) {
      pose.ragdoll = !!enabled;
    },

    /**
     * Drive a bone from an external simulation. `position`/`quaternion`
     * are WORLD space; the parent transform is divided out for you.
     */
    setBoneWorldTransform(index, px, py, pz, qx, qy, qz, qw) {
      const bone = bones[index];
      if (!bone) return;
      _q1.set(qx, qy, qz, qw);
      _v1.set(px, py, pz);
      _m1.makeRotationFromQuaternion(_q1);
      _m1.setPosition(_v1);
      if (bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        _m2.copy(bone.parent.matrixWorld).invert();
        _m1.premultiply(_m2);
      }
      _m1.decompose(bone.position, bone.quaternion, _v2);
      bone.scale.set(1, 1, 1);
    },

    /** Reset every bone to the authored rest pose. */
    resetPose() {
      for (let i = 0; i < bones.length; i += 1) {
        bones[i].quaternion.copy(restQuat[i]);
        bones[i].position.copy(restPos[i]);
        bones[i].scale.set(1, 1, 1);
      }
      resetFeet();
    },

    report() {
      return {
        triangles: builder.index.length / 3,
        vertices: builder.vertexCount,
        bones: bones.length,
        legs: legDefs.length,
        clawsPerFoot: tier.claws,
        drawCalls: geometry.groups.length,
        skinned: true,
        gaitHz: Number(state.gaitHz.toFixed(2)),
        steps: state.steps,
        speed: Number(state.speedWorld.toFixed(2)),
        curl: Number(state.curl.toFixed(3)),
        airborne: Number(state.air.toFixed(3)),
        squash: Number(state.squash.toFixed(3)),
        groundOffset: Number(state.groundOffset.toFixed(3)),
        ragdoll: pose.ragdoll,
      };
    },

    dispose() {
      geometry.dispose();
      skeleton.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };

  ctx.track(api);
  return api;
}
