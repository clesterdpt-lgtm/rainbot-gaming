/* ============================================================
   BLACKSAND - vehicles

   A light transport, a wheeled armoured carrier and a transport
   helicopter. Combined arms is the reason Conquest works at this map
   scale: without vehicles a 1km map is a walking simulator with
   occasional gunfire.

   ---- how the ground vehicles work ----

   A rigid body (position, velocity, orientation, angular velocity)
   with four to six raycast wheels. Each wheel casts down the chassis'
   own up axis, computes a spring/damper load from its travel, then a
   tyre force from its slip, and every force is applied AT ITS CONTACT
   POINT so the torque it generates is real. That is the whole reason
   the model produces weight transfer, body roll and lift-off oversteer
   without a constraint solver: dive under braking is not a scripted
   pitch animation, it is the front springs compressing because the
   braking force acts 0.7m below the centre of mass.

   The previous version faked all of this - it damped `pitch` and `roll`
   towards hand-tuned multiples of a torque estimate, then overwrote
   both by aligning the hull to the terrain normal. A vehicle built that
   way cannot understeer, cannot get two wheels off the ground, and
   cannot be pushed sideways, because none of those states exist in it.

   Wheels carry their own angular velocity, so drive torque, brake
   torque and tyre reaction all act on a real rotating mass. Wheelspin
   on sand and locked wheels under braking are emergent, not scripted,
   and the visible wheel rotation is the same number the physics uses.

   ---- how the helicopter works ----

   Thrust acts along the rotor axis, which is the airframe's up. So the
   only way to go anywhere is to tilt the airframe, and the only way to
   stop is to tilt it back - the coupling that makes a helicopter take
   practice. Cyclic applies a torque rather than setting an angle, so
   the airframe has inertia. Main rotor torque yaws the fuselage and the
   tail rotor fights it, so pulling collective needs pedal. Ground
   effect, translational lift and autorotation all fall out of the same
   thrust equation with different multipliers.
   ============================================================ */

import {
  makeRng, clamp, clamp01, lerp, damp, smoothstep, angleDelta, DEG, TAU,
} from "./core.js";
import { LAYER, SURFACE } from "./physics.js";
import { TEAM } from "./world.js";

/* ============================================================
   specifications
   ============================================================ */

/**
 * Livery per team. Two schemes that read differently at 300m, which is
 * the only distance at which the difference matters. The base colour is
 * the hull, `alt` is the disruptive pattern, `trim` is unpainted metal.
 */
const LIVERY = {
  [TEAM.BLUE]: {
    // 0x8d8467 was too light: under the desert key it clipped towards
    // white, and a hull panel with no value left in it reads as
    // untextured no matter what is on it. Two thirds of a stop down
    // keeps the disruptive pattern and gives the paint somewhere to go.
    base: 0x7a7359, alt: 0x625e49, accent: 0x514f42,
    marking: 0x2b3138, dust: 0xb9a682,
  },
  [TEAM.RED]: {
    base: 0x5f6647, alt: 0x494f38, accent: 0x6b5a3c,
    marking: 0x2a2620, dust: 0xa8956f,
  },
};

const RUBBER = 0x191a1c;
const RIM = 0x4a4d48;
const STEEL = 0x36393c;
const DARK = 0x232528;

/**
 * Seat roles. `eye` is the occupant's eye point in body space; `exit`
 * is the preferred dismount direction, tried first before the fallback
 * ring. A seat with a `weapon` is a gunner position.
 */
const SEAT = (role, eye, exit, weapon = null) => ({ role, eye, exit, weapon });

/** Mounted weapons. Hitscan with a travel-time tracer, same as the
 *  infantry weapons, so hit registration is consistent across the game. */
const MOUNTS = {
  pintle: {
    name: "7.62 PINTLE", damage: 34, rpm: 640, spread: 0.9, muzzleVelocity: 840,
    tracerEvery: 2, magazine: 200, reload: 5.5, explosive: 0, kick: 0.5,
    yawLimit: Math.PI, pitchLimit: [-18 * DEG, 55 * DEG], traverse: 2.6,
  },
  doorgun: {
    name: "DOOR GUN", damage: 30, rpm: 720, spread: 1.4, muzzleVelocity: 840,
    tracerEvery: 2, magazine: 250, reload: 6.0, explosive: 0, kick: 0.45,
    yawLimit: 75 * DEG, pitchLimit: [-62 * DEG, 20 * DEG], traverse: 2.9,
  },
  autocannon: {
    name: "25MM AUTOCANNON", damage: 78, rpm: 200, spread: 0.32, muzzleVelocity: 1100,
    tracerEvery: 1, magazine: 60, reload: 6.5, explosive: 2.6, kick: 1.5,
    yawLimit: Math.PI, pitchLimit: [-9 * DEG, 42 * DEG], traverse: 1.15,
  },
};

const TYPES = {
  jeep: {
    name: "Light Transport",
    kind: "ground",
    mass: 2400,
    /** Collider half-extents. Deliberately a touch smaller than the
     *  visible body so a passenger brushing the wing does not get
     *  shoved by an invisible edge. */
    halfExtents: [1.10, 0.92, 2.48],
    bodyRadius: 2.6,
    wheel: { radius: 0.44, width: 0.34, mass: 32 },
    axles: [
      { z: -1.62, track: 1.86, steer: 1, drive: 0.5, brakeBias: 0.62 },
      { z: 1.60, track: 1.86, steer: 0, drive: 0.5, brakeBias: 0.38 },
    ],
    suspension: { rest: 0.34, stiffness: 58000, damping: 5200, antiRoll: 16000 },
    engine: { peakTorque: 640, peakRpm: 2900, redline: 4200, idle: 780 },
    gearbox: {
      ratios: [4.2, 2.5, 1.62, 1.15, 0.92], reverse: 4.6, final: 5.4,
      shiftTime: 0.30, upshift: 0.90, downshift: 0.44,
    },
    brakeTorque: 4600,
    handbrakeTorque: 7200,
    steerMax: 36 * DEG,
    steerRate: 3.4,
    /** Steering lock shrinks with speed, or the vehicle is a spinning
     *  top above 60km/h. The number is metres-per-second at which lock
     *  has fallen to half. */
    steerSpeedHalf: 17,
    aero: { drag: 2.6, lift: -0.9 },
    grip: 0.95,
    health: 700,
    armour: 0.22,
    seats: [
      SEAT("driver", [-0.44, 0.50, -0.32], [-1.85, 0.1, -0.30]),
      SEAT("gunner", [0.00, 1.14, 0.42], [1.85, 0.1, 0.40], "pintle"),
      SEAT("passenger", [0.44, 0.50, -0.32], [1.85, 0.1, -0.30]),
      SEAT("passenger", [-0.46, 0.44, 0.92], [-1.85, 0.1, 1.10]),
    ],
  },

  apc: {
    name: "Armoured Carrier",
    kind: "ground",
    mass: 13600,
    halfExtents: [1.44, 1.22, 3.62],
    bodyRadius: 3.9,
    wheel: { radius: 0.62, width: 0.42, mass: 110 },
    axles: [
      { z: -2.32, track: 2.44, steer: 1, drive: 0.34, brakeBias: 0.40 },
      { z: -0.14, track: 2.44, steer: 0.42, drive: 0.33, brakeBias: 0.30 },
      { z: 2.06, track: 2.44, steer: 0, drive: 0.33, brakeBias: 0.30 },
    ],
    suspension: { rest: 0.40, stiffness: 260000, damping: 26000, antiRoll: 70000 },
    engine: { peakTorque: 1180, peakRpm: 1900, redline: 2700, idle: 620 },
    gearbox: {
      ratios: [5.0, 2.9, 1.85, 1.28, 1.0], reverse: 5.2, final: 6.4,
      shiftTime: 0.46, upshift: 0.88, downshift: 0.42,
    },
    brakeTorque: 26000,
    handbrakeTorque: 34000,
    steerMax: 27 * DEG,
    steerRate: 1.9,
    steerSpeedHalf: 14,
    aero: { drag: 6.4, lift: 0 },
    grip: 0.88,
    health: 2600,
    armour: 0.62,
    turret: "autocannon",
    seats: [
      SEAT("driver", [-0.62, 0.62, -2.05], [-2.30, 0.1, -1.6]),
      SEAT("gunner", [0.00, 1.05, -0.35], [2.30, 0.1, -0.4], "autocannon"),
      SEAT("passenger", [-0.66, 0.42, 0.55], [-2.30, 0.1, 2.9]),
      SEAT("passenger", [0.66, 0.42, 0.55], [2.30, 0.1, 2.9]),
      SEAT("passenger", [-0.66, 0.42, 1.75], [-2.30, 0.1, 3.4]),
      SEAT("passenger", [0.66, 0.42, 1.75], [2.30, 0.1, 3.4]),
    ],
  },

  heli: {
    name: "Transport Helicopter",
    kind: "air",
    mass: 5100,
    // The fuselage runs from -4.4 to +6.5 in z, so the collider is
    // pushed aft to cover the tail boom. Without the offset a burst
    // into the tail rotor passes through empty space.
    halfExtents: [1.34, 1.28, 5.40],
    colliderOffset: [0, -0.1, 1.0],
    bodyRadius: 7.6,
    rotor: { radius: 7.3, blades: 4, spinUp: 0.32, idleRpm: 0, maxRpm: 1.0 },
    tailRotor: { radius: 1.35, blades: 4 },
    /** Thrust at full collective and full rotor speed. Gravity in this
     *  game is 20 m/s^2, not 9.81, so the ratio is against that: 1.75x
     *  weight climbs briskly without being a rocket. */
    maxThrust: 5100 * 20 * 1.75,
    cyclicTorque: [46000, 30000],       // pitch, roll
    pedalTorque: 20000,
    rotorTorque: 16000,                  // reaction the tail must cancel
    /** Rate damping keeps the airframe from oscillating; the values are
     *  low enough that it still overshoots, which is the feel. */
    rateDamping: [2.6, 2.3, 2.1],
    aero: { drag: [7.2, 16.0, 2.9], weathercock: 9000 },
    maxSpeed: 74,
    // Contact points sit exactly on the drawn wheel hubs. A centimetre
    // of disagreement here is a helicopter that rests with its tyres
    // buried, which is the first thing anyone notices on the pad.
    gearLegs: [
      { local: [-1.34, -1.60, 0.62], radius: 0.34 },
      { local: [1.34, -1.60, 0.62], radius: 0.34 },
      { local: [0.00, -0.94, 5.35], radius: 0.24 },
    ],
    gearSpring: 190000,
    gearDamping: 24000,
    health: 1100,
    armour: 0.28,
    seats: [
      SEAT("driver", [-0.50, 0.42, -2.35], [-1.90, -0.6, -1.2]),
      SEAT("gunner", [0.50, 0.42, -2.35], [1.90, -0.6, -1.2], "doorgun"),
      SEAT("gunner", [-1.02, 0.10, 0.35], [-2.10, -0.6, 0.4], "doorgun"),
      SEAT("passenger", [1.02, 0.10, 0.35], [2.10, -0.6, 0.4]),
      SEAT("passenger", [-0.52, 0.05, 1.35], [-2.10, -0.6, 1.4]),
      SEAT("passenger", [0.52, 0.05, 1.35], [2.10, -0.6, 1.4]),
    ],
  },
};

/** Surface grip. Sand is the reason a transport is not a sports car:
 *  it takes a third of the lateral grip away and half the traction, and
 *  the rolling resistance alone costs a third of the top speed. */
const SURFACE_GRIP = {
  [SURFACE.SAND]: { lat: 0.62, long: 0.58, roll: 0.042, dust: 1.0 },
  [SURFACE.DIRT]: { lat: 0.74, long: 0.72, roll: 0.028, dust: 0.8 },
  [SURFACE.ROCK]: { lat: 0.86, long: 0.85, roll: 0.018, dust: 0.35 },
  [SURFACE.CONCRETE]: { lat: 1.00, long: 1.00, roll: 0.011, dust: 0.12 },
};

/* ============================================================
   module
   ============================================================ */

export async function createVehicles(ctx) {
  const { THREE, render, terrain, physics, world, settings, input } = ctx;
  const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
  const rng = makeRng(ctx.seed ^ 0x7e41c);

  const group = new THREE.Group();
  group.name = "vehicles";
  render.scene.add(group);

  const vehicles = [];
  const ownedMaterials = [];
  const ownedGeometries = [];
  const ownedTextures = [];

  /* ============================================================
     part kit

     Every vehicle is assembled from primitives into a handful of
     material buckets and merged once. A vehicle with 90 visible
     details has to cost 6 draw calls, not 90 - and merging at build
     time is free, whereas instancing 90 unique shapes is not.
     ============================================================ */

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v3 = new THREE.Vector3();
  const _s3 = new THREE.Vector3(1, 1, 1);
  const _col = new THREE.Color();

  function makeKit() {
    const buckets = new Map();
    const kit = {
      /** Push a geometry into a bucket, transformed and colour-baked. */
      add(bucket, geometry, opts = {}) {
        const {
          pos = [0, 0, 0], rot = [0, 0, 0], scale = null,
          colour = 0xffffff, dust = 1,
        } = opts;
        _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], "XYZ"));
        _m4.compose(_v3.set(pos[0], pos[1], pos[2]), _q,
          scale ? _s3.set(scale[0], scale[1], scale[2]) : _s3.set(1, 1, 1));
        geometry.applyMatrix4(_m4);
        // Nothing here samples a texture, and mergeGeometries refuses to
        // merge buffers whose attribute sets differ - the hull generator
        // produces no UVs, the three primitives do.
        geometry.deleteAttribute("uv");
        geometry.deleteAttribute("uv1");
        geometry.deleteAttribute("uv2");

        // Per-vertex colour: the part's tint, darkened towards the
        // underside. A uniform paint colour is the single biggest tell
        // that a model is untextured; a dust gradient off the sills
        // costs nothing and reads as a vehicle that has been driven.
        const position = geometry.attributes.position;
        const count = position.count;
        const colours = new Float32Array(count * 3);
        _col.set(colour);
        for (let i = 0; i < count; i += 1) {
          const y = position.getY(i);
          const grime = dust * clamp01((0.35 - y) / 1.3) * 0.42;
          colours[i * 3] = _col.r * (1 - grime) + 0.42 * grime;
          colours[i * 3 + 1] = _col.g * (1 - grime) + 0.37 * grime;
          colours[i * 3 + 2] = _col.b * (1 - grime) + 0.29 * grime;
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(geometry);
        return geometry;
      },
      merge() {
        const out = new Map();
        for (const [name, list] of buckets) {
          if (!list.length) continue;
          const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
          if (list.length > 1) list.forEach((g) => g.dispose());
          merged.computeBoundingSphere();
          ownedGeometries.push(merged);
          out.set(name, merged);
        }
        buckets.clear();
        return out;
      },
    };
    return kit;
  }

  /**
   * A convex hull from eight corners: bottom quad then top quad, each
   * wound counter-clockwise seen from above.
   *
   * This one primitive is what makes the models read as vehicles rather
   * than as crates. A sloped glacis, a tapering nose, a chamfered
   * fighting compartment and a wheel-arch flare are all "a box with two
   * corners moved", and a box generator cannot express any of them.
   */
  const HULL_TRIS = [
    [0, 1, 2], [0, 2, 3],       // bottom
    [4, 6, 5], [4, 7, 6],       // top
    [0, 5, 1], [0, 4, 5],       // front
    [1, 6, 2], [1, 5, 6],       // right
    [2, 7, 3], [2, 6, 7],       // back
    [3, 4, 0], [3, 7, 4],       // left
  ];

  function hull8(c) {
    const p = new Float32Array(c.length * 3);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < c.length; i += 1) {
      p[i * 3] = c[i][0]; p[i * 3 + 1] = c[i][1]; p[i * 3 + 2] = c[i][2];
      cx += c[i][0]; cy += c[i][1]; cz += c[i][2];
    }
    cx /= c.length; cy /= c.length; cz /= c.length;

    // Orient every face outward against the hull's own centroid rather
    // than trusting the caller's corner order. Half these hulls are
    // authored mirrored or back-to-front, and a single inverted winding
    // is invisible until the vehicle is lit from the other side and one
    // panel vanishes.
    const index = [];
    for (const tri of HULL_TRIS) {
      const A = c[tri[0]];
      const B = c[tri[1]];
      const C = c[tri[2]];
      // three's computeVertexNormals uses (C - B) x (A - B).
      const ux = C[0] - B[0]; const uy = C[1] - B[1]; const uz = C[2] - B[2];
      const vx = A[0] - B[0]; const vy = A[1] - B[1]; const vz = A[2] - B[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const mx = (A[0] + B[0] + C[0]) / 3 - cx;
      const my = (A[1] + B[1] + C[1]) / 3 - cy;
      const mz = (A[2] + B[2] + C[2]) / 3 - cz;
      if (nx * mx + ny * my + nz * mz < 0) index.push(tri[0], tri[2], tri[1]);
      else index.push(tri[0], tri[1], tri[2]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
    geometry.setIndex(index);
    // Non-indexed so every face gets its own normal. Faceted shading is
    // the look; smoothing a hull like this turns it into a bar of soap.
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    flat.computeVertexNormals();
    return flat;
  }

  /** Axis-aligned box as eight corners, so it composes with hull8. */
  function boxCorners(x0, x1, y0, y1, z0, z1) {
    return [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
  }

  const box = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const flat = g.toNonIndexed();
    g.dispose();
    flat.computeVertexNormals();
    return flat;
  };
  const cyl = (r1, r2, h, seg = 8, open = false) => {
    const g = new THREE.CylinderGeometry(r1, r2, h, seg, 1, open);
    const flat = g.toNonIndexed();
    g.dispose();
    flat.computeVertexNormals();
    return flat;
  };
  const sph = (r, w = 8, h = 5) => {
    const g = new THREE.SphereGeometry(r, w, h);
    const flat = g.toNonIndexed();
    g.dispose();
    flat.computeVertexNormals();
    return flat;
  };

  /* ============================================================
     shared materials
     ============================================================ */

  /**
   * A shared micro-surface height field, sampled triplanar in the
   * vehicle's OWN object space.
   *
   * The hulls are built from convex primitives and merged; there is no
   * UV set worth texturing against, and world-space projection would
   * make the grain swim across the paint as the vehicle drives. Object
   * space costs one varying and stays welded to the body.
   *
   * Only the alpha matters - it is a height, and the shader takes its
   * screen-space gradient. Storing an RGB normal here as well would be
   * redundant: the gradient IS the normal.
   */
  function buildGrainTexture(size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const grng = makeRng(ctx.seed ^ 0x77a3);
    const lattice = (n, seed) => {
      const grid = new Float32Array(n * n);
      const r = makeRng(seed);
      for (let i = 0; i < grid.length; i += 1) grid[i] = r();
      return (u, v) => {
        const x = u * n; const y = v * n;
        const x0 = Math.floor(x); const y0 = Math.floor(y);
        const fx = x - x0; const fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (px, py) => grid[(((py % n) + n) % n) * n + (((px % n) + n) % n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        return a + (b - a) * sy;
      };
    };
    const coarse = lattice(8, 0x31a7);
    const mid = lattice(28, 0x5c19);
    const fine = lattice(96, 0x9e2b);

    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size; const v = y / size;
        // Orange-peel paint over a coarse dust blotch, plus a sparse
        // scratch layer so the panels are not uniformly pebbled.
        let h = coarse(u, v) * 0.5 + mid(u, v) * 0.32 + fine(u, v) * 0.18;
        const scratch = Math.abs(Math.sin(u * 41.0 + coarse(u, v) * 9.0));
        if (scratch > 0.985) h -= 0.35;
        const i = (y * size + x) * 4;
        image.data[i] = 128; image.data[i + 1] = 128; image.data[i + 2] = 255;
        image.data[i + 3] = clamp01(h) * 255;
      }
    }
    g.putImageData(image, 0, 0);
    void grng;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = render.anisotropy;
    return texture;
  }

  const grainTexture = buildGrainTexture();
  ownedTextures.push(grainTexture);

  /**
   * Inject the grain into a standard material.
   *
   * `bump` is the physical depth of the relief in METRES. That unit is
   * load-bearing: the perturbation below differentiates the height
   * against view-space position, so a 0..1 texture value fed in raw is
   * about six orders of magnitude too large and replaces the shading
   * normal with noise. Expressed as a real depth it is stable at every
   * distance, because the ratio of the two terms is amplitude times
   * spatial frequency and both are properties of the material.
   */
  function injectGrain(material, options) {
    const scale = options.scale ?? 5.5;
    // Amplitude in metres, solved from a target SLOPE. The height is
    // differentiated against view-space position, so what the eye
    // reads is amplitude x spatial frequency; the field here runs at
    // roughly 190 x scale cycles per metre. Writing a depth directly
    // means guessing across four orders of magnitude, and guessing
    // high replaces the shading normal with noise.
    const bump = (options.slope ?? 0.22) / (190 * scale);
    const roughVary = options.roughVary ?? 0.22;
    const albedoVary = options.albedoVary ?? 0.14;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrain = { value: grainTexture };
      shader.uniforms.uGrainScale = { value: scale };
      shader.uniforms.uGrainBump = { value: bump };
      shader.uniforms.uGrainRough = { value: roughVary };
      shader.uniforms.uGrainAlbedo = { value: albedoVary };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `
          #include <common>
          varying vec3 vGrainPos;
          varying vec3 vGrainNormal;
        `)
        .replace("#include <beginnormal_vertex>", `
          #include <beginnormal_vertex>
          vGrainNormal = objectNormal;
        `)
        .replace("#include <begin_vertex>", `
          #include <begin_vertex>
          vGrainPos = transformed;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `
          #include <common>
          uniform sampler2D uGrain;
          uniform float uGrainScale;
          uniform float uGrainBump;
          uniform float uGrainRough;
          uniform float uGrainAlbedo;
          varying vec3 vGrainPos;
          varying vec3 vGrainNormal;
        `)
        .replace("#include <map_fragment>", `
          #include <map_fragment>
          vec3 bsGw = pow(abs(normalize(vGrainNormal)), vec3(4.0));
          bsGw /= max(bsGw.x + bsGw.y + bsGw.z, 1e-4);
          vec3 bsGp = vGrainPos * uGrainScale;
          float bsG = texture2D(uGrain, bsGp.zy).a * bsGw.x
                    + texture2D(uGrain, bsGp.xz).a * bsGw.y
                    + texture2D(uGrain, bsGp.xy).a * bsGw.z;
          diffuseColor.rgb *= 1.0 - uGrainAlbedo * 0.5 + bsG * uGrainAlbedo;
        `)
        .replace("#include <roughnessmap_fragment>", `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).g;
          #endif
          roughnessFactor = clamp(
            roughnessFactor * (1.0 - uGrainRough * 0.5 + bsG * uGrainRough), 0.04, 1.0);
        `)
        .replace("#include <normal_fragment_maps>", `
          #include <normal_fragment_maps>
          {
            float bsH = bsG * uGrainBump;
            vec3 bsPx = dFdx(-vViewPosition);
            vec3 bsPy = dFdy(-vViewPosition);
            vec3 bsR1 = cross(bsPy, normal);
            vec3 bsR2 = cross(normal, bsPx);
            float bsDet = dot(bsPx, bsR1);
            vec3 bsGrad = sign(bsDet) * (dFdx(bsH) * bsR1 + dFdy(bsH) * bsR2);
            normal = normalize(abs(bsDet) * normal - bsGrad);
          }
        `);
    };
    material.customProgramCacheKey = () => "bs-veh-grain";
    return material;
  }

  function makeMaterial(options) {
    const { grain, ...rest } = options;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      dithering: true,
      ...rest,
    });
    if (grain) injectGrain(material, grain);
    ownedMaterials.push(material);
    return material;
  }

  /**
   * The envMapIntensity values that used to be on these five materials
   * were DEAD, and the comment that defended them was wrong.
   *
   * It argued that scaling the ambient response per material rescued a
   * four-metre object from a sky IBL tuned for a 1km vista - "every
   * normal facing away from the sun collapses to black". Plausible, and
   * it is exactly what an art director had complained about. But on
   * Three r180 `envMapIntensity` does nothing at all unless the material
   * has its OWN `envMap`; a material that merely inherits
   * `scene.environment` is scaled only by `scene.environmentIntensity`.
   * A 12x sweep on the running build moves frame luma by 0.14 (see
   * `docs/blacksand-agent-brief.md` for the measurement). Only
   * `viewmodel.js` assigns an envMap, so nothing here was ever live.
   *
   * They are removed rather than corrected. Removing them is provably
   * behaviour-neutral, and leaving them invites the next reader to tune
   * a knob that three separate agents have already tuned to no effect.
   * If vehicles do read too dark on their shaded normals, the fix is a
   * real one: assign `material.envMap = scene.environment` and own
   * re-assigning it whenever sky.js regenerates the probe, as
   * viewmodel.js does - or change roughness, or the one scene-level
   * knob. Measure it first; the lighting has moved a long way since
   * that complaint.
   */
  const MAT = {
    paint: makeMaterial({
      roughness: 0.70, metalness: 0.16, flatShading: true,
      // Orange-peel over sheet steel plus dust: 2.5mm of relief at
      // about six repeats per metre, which lands the grain around the
      // size of a thumbnail on a real hull.
      grain: { scale: 5.5, slope: 0.26, roughVary: 0.26, albedoVary: 0.16 },
    }),
    trim: makeMaterial({
      roughness: 0.44, metalness: 0.74, flatShading: true,
      grain: { scale: 9.0, slope: 0.22, roughVary: 0.30, albedoVary: 0.12 },
    }),
    // Tyre rubber is genuinely a 0.05 albedo, and modelling it honestly
    // is how a wheel ends up as a hole cut in the frame. Games cheat it
    // up, and so does this: the tread pattern has to survive.
    rubber: makeMaterial({
      roughness: 0.92, metalness: 0.04, flatShading: true,
    }),
    // Glass on a military vehicle is thick, slightly green and mostly
    // reflective. Low roughness is what separates it from "a dark
    // plastic panel" - the env contribution it used to claim was inert.
    glass: makeMaterial({
      roughness: 0.07, metalness: 0.0,
      transparent: true, opacity: 0.62, color: 0x8fa39c, vertexColors: false,
      side: THREE.DoubleSide,
    }),
    lens: makeMaterial({
      roughness: 0.16, metalness: 0.1, emissiveIntensity: 1.0,
      emissive: 0x000000, flatShading: true,
    }),
  };

  const rotorDiscMaterial = new THREE.MeshBasicMaterial({
    color: 0x1a1c1e, transparent: true, opacity: 0.0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
  });
  ownedMaterials.push(rotorDiscMaterial);

  /* ============================================================
     models
     ============================================================ */

  /** Tyre + rim as one mesh: a chunky off-road block pattern from
   *  alternating radial lugs, which is what makes a wheel read as a
   *  wheel at 30m instead of as a black cylinder. */
  function buildWheel(spec, wear) {
    const kit = makeKit();
    const { radius, width } = spec.wheel;
    // Real tyre rubber is around 0.04 albedo. Modelled honestly it is
    // indistinguishable from a hole cut in the frame the moment the
    // face is turned away from the sun, which is what made the spare
    // wheel read as flat black in every three-quarter shot. Dusty
    // desert rubber is genuinely lighter than showroom rubber anyway.
    const rubber = 0x2e2f32;

    kit.add("w", cyl(radius * 0.93, radius * 0.93, width, 20),
      { rot: [0, 0, Math.PI / 2], colour: rubber, dust: 1.6 });
    // Sidewall shoulders, slightly proud, so the tyre has a profile.
    for (const s of [-1, 1]) {
      kit.add("w", cyl(radius * 0.80, radius * 0.88, width * 0.16, 20),
        { pos: [s * width * 0.44, 0, 0], rot: [0, 0, Math.PI / 2], colour: 0x252629, dust: 1.6 });
    }
    // Tread lugs.
    const lugs = 12;
    for (let i = 0; i < lugs; i += 1) {
      const a = (i / lugs) * TAU;
      const skew = (i % 2 === 0 ? 1 : -1) * 0.12;
      kit.add("w", box(width * 0.86, radius * 0.16, radius * 0.30), {
        pos: [0, Math.cos(a) * radius * 0.9, Math.sin(a) * radius * 0.9],
        rot: [-a + skew, 0, 0],
        colour: 0x3a3c40, dust: 1.6,
      });
    }
    // Rim, hub, and lug nuts.
    kit.add("w", cyl(radius * 0.56, radius * 0.56, width * 0.66, 10),
      { rot: [0, 0, Math.PI / 2], colour: RIM, dust: 1.3 });
    for (const s of [-1, 1]) {
      kit.add("w", cyl(radius * 0.60, radius * 0.52, width * 0.06, 10),
        { pos: [s * width * 0.34, 0, 0], rot: [0, 0, Math.PI / 2], colour: 0x55585a, dust: 1.3 });
      kit.add("w", cyl(radius * 0.20, radius * 0.20, width * 0.14, 8),
        { pos: [s * width * 0.40, 0, 0], rot: [0, 0, Math.PI / 2], colour: 0x6a6d6c, dust: 1.0 });
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        kit.add("w", cyl(radius * 0.045, radius * 0.045, width * 0.10, 6), {
          pos: [s * width * 0.40, Math.cos(a) * radius * 0.33, Math.sin(a) * radius * 0.33],
          rot: [0, 0, Math.PI / 2], colour: 0x7b7e7d, dust: 1.0,
        });
      }
    }

    const merged = kit.merge().get("w");
    const material = MAT.rubber.clone();
    material.color.setScalar(lerp(1.0, 0.84, wear));
    ownedMaterials.push(material);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = settings.q.shadows;
    mesh.receiveShadow = true;
    return mesh;
  }

  /* -------------------------- light transport -------------------------- */

  function buildJeep(kit, livery, r) {
    const P = "paint";
    const T = "trim";
    const G = "glass";
    const L = "lens";
    const alt = () => (r.chance(0.34) ? livery.alt : livery.base);

    /* ---- lower tub ---- */
    kit.add(P, hull8([
      [-0.94, -0.46, -2.30], [0.94, -0.46, -2.30], [0.90, -0.46, 2.34], [-0.90, -0.46, 2.34],
      [-1.05, 0.14, -2.34], [1.05, 0.14, -2.34], [1.02, 0.14, 2.38], [-1.02, 0.14, 2.38],
    ]), { colour: livery.base });

    /* ---- bonnet: rises to the scuttle, flat top, sloped nose ---- */
    kit.add(P, hull8([
      [-1.00, 0.10, -2.32], [1.00, 0.10, -2.32], [1.02, 0.10, -0.70], [-1.02, 0.10, -0.70],
      [-0.92, 0.34, -2.28], [0.92, 0.34, -2.28], [0.99, 0.50, -0.70], [-0.99, 0.50, -0.70],
    ]), { colour: alt() });
    // Bonnet centre rib and two latches.
    kit.add(T, box(0.10, 0.05, 1.44), { pos: [0, 0.45, -1.50], colour: livery.accent });
    for (const s of [-1, 1]) {
      kit.add(T, box(0.16, 0.045, 0.12), { pos: [s * 0.62, 0.40, -2.20], colour: STEEL });
    }

    /* ---- cab shell ---- */
    kit.add(P, hull8([
      [-1.02, 0.14, -0.72], [1.02, 0.14, -0.72], [1.02, 0.14, 0.62], [-1.02, 0.14, 0.62],
      [-0.94, 1.16, -0.28], [0.94, 1.16, -0.28], [0.94, 1.16, 0.58], [-0.94, 1.16, 0.58],
    ]), { colour: livery.base });
    // Roof panel, proud of the shell so there is a shadow line.
    kit.add(P, hull8([
      [-0.96, 1.16, -0.30], [0.96, 1.16, -0.30], [0.96, 1.16, 0.60], [-0.96, 1.16, 0.60],
      [-0.92, 1.24, -0.26], [0.92, 1.24, -0.26], [0.92, 1.24, 0.56], [-0.92, 1.24, 0.56],
    ]), { colour: alt() });
    // Gunner's hatch ring.
    kit.add(T, cyl(0.42, 0.42, 0.09, 12), { pos: [0, 1.28, 0.24], colour: livery.accent });

    /* ---- glass ---- */
    // Windscreen: a single raked pane with a centre post and a frame.
    kit.add(G, box(1.70, 0.02, 1.10), { pos: [0, 0.80, -0.53], rot: [1.02, 0, 0] });
    kit.add(T, box(0.07, 0.06, 1.14), { pos: [0, 0.80, -0.52], rot: [1.02, 0, 0], colour: livery.accent });
    for (const s of [-1, 1]) {
      kit.add(T, box(0.09, 0.10, 1.16), { pos: [s * 0.90, 0.80, -0.52], rot: [1.02, 0, 0], colour: livery.accent });
      // Side glass and door frame.
      kit.add(G, box(0.02, 0.44, 0.74), { pos: [s * 0.96, 0.86, 0.14] });
      kit.add(T, box(0.035, 0.05, 0.78), { pos: [s * 0.98, 0.62, 0.14], colour: livery.accent });
      // Wipers.
      kit.add(T, box(0.03, 0.02, 0.42), { pos: [s * 0.34, 0.48, -0.86], rot: [0.2, 0.3 * s, 0], colour: STEEL });
    }

    /* ---- doors: recessed shut lines and handles ---- */
    for (const s of [-1, 1]) {
      kit.add(T, box(0.02, 0.60, 0.045), { pos: [s * 1.045, -0.10, -0.62], colour: 0x1b1d1e, dust: 1.2 });
      kit.add(T, box(0.02, 0.60, 0.045), { pos: [s * 1.045, -0.10, 0.60], colour: 0x1b1d1e, dust: 1.2 });
      kit.add(T, box(0.05, 0.05, 0.20), { pos: [s * 1.06, 0.02, 0.34], colour: STEEL });
      // Step bar under the door.
      kit.add(T, cyl(0.045, 0.045, 1.30, 6), { pos: [s * 1.10, -0.44, 0.0], rot: [Math.PI / 2, 0, 0], colour: STEEL, dust: 1.8 });
      for (const z of [-0.55, 0.55]) {
        kit.add(T, cyl(0.03, 0.03, 0.22, 5), { pos: [s * 1.06, -0.34, z], rot: [0, 0, s * 0.35], colour: STEEL, dust: 1.8 });
      }
    }

    /* ---- wheel arch flares ---- */
    for (const s of [-1, 1]) {
      for (const z of [-1.62, 1.60]) {
        kit.add(P, hull8([
          [s * 0.88, -0.34, z - 0.70], [s * 1.20, -0.34, z - 0.62],
          [s * 1.20, -0.34, z + 0.62], [s * 0.88, -0.34, z + 0.70],
          [s * 0.94, 0.16, z - 0.60], [s * 1.14, 0.16, z - 0.54],
          [s * 1.14, 0.16, z + 0.54], [s * 0.94, 0.16, z + 0.60],
        ]), { colour: livery.base, dust: 2.2 });
        // Mudflap.
        kit.add(T, box(0.02, 0.30, 0.42), { pos: [s * 1.14, -0.52, z + 0.62], colour: 0x141516, dust: 2.4 });
      }
    }

    /* ---- cargo bed ---- */
    kit.add(P, hull8(boxCorners(-1.00, 1.00, 0.12, 0.18, 0.62, 2.36)), { colour: livery.accent });
    for (const s of [-1, 1]) {
      kit.add(P, hull8([
        [s * 0.92, 0.14, 0.62], [s * 1.02, 0.14, 0.62], [s * 1.02, 0.14, 2.36], [s * 0.92, 0.14, 2.36],
        [s * 0.94, 0.66, 0.66], [s * 1.00, 0.66, 0.66], [s * 1.00, 0.66, 2.34], [s * 0.94, 0.66, 2.34],
      ]), { colour: livery.base });
    }
    // Tailgate.
    kit.add(P, hull8(boxCorners(-1.00, 1.00, 0.10, 0.68, 2.30, 2.38)), { colour: alt() });
    kit.add(T, box(1.60, 0.05, 0.03), { pos: [0, 0.50, 2.41], colour: livery.accent });

    /* ---- cargo hoop / roll bar ---- */
    for (const s of [-1, 1]) {
      kit.add(T, cyl(0.055, 0.055, 0.80, 6), { pos: [s * 0.90, 1.05, 0.72], colour: livery.accent });
      kit.add(T, cyl(0.05, 0.05, 0.62, 6), { pos: [s * 0.90, 0.94, 1.90], colour: livery.accent });
    }
    kit.add(T, cyl(0.055, 0.055, 1.80, 6), { pos: [0, 1.44, 0.72], rot: [0, 0, Math.PI / 2], colour: livery.accent });
    kit.add(T, cyl(0.05, 0.05, 1.80, 6), { pos: [0, 1.24, 1.90], rot: [0, 0, Math.PI / 2], colour: livery.accent });
    kit.add(T, cyl(0.045, 0.045, 1.20, 5), { pos: [0, 1.34, 1.31], rot: [Math.PI / 2 + 0.16, 0, 0], colour: livery.accent });

    /* ---- bumpers, hooks, hitch ---- */
    kit.add(T, box(2.14, 0.20, 0.16), { pos: [0, -0.28, -2.42], colour: STEEL, dust: 2.0 });
    kit.add(T, box(2.10, 0.18, 0.15), { pos: [0, -0.26, 2.44], colour: STEEL, dust: 2.0 });
    for (const s of [-1, 1]) {
      kit.add(T, box(0.10, 0.22, 0.30), { pos: [s * 0.70, -0.28, -2.52], colour: 0x2c2e30, dust: 2.0 });
      kit.add(T, box(0.10, 0.20, 0.26), { pos: [s * 0.68, -0.26, 2.54], colour: 0x2c2e30, dust: 2.0 });
    }
    kit.add(T, cyl(0.07, 0.07, 0.26, 6), { pos: [0, -0.34, 2.60], rot: [Math.PI / 2, 0, 0], colour: 0x303234, dust: 2.2 });
    kit.add(T, sph(0.075, 6, 4), { pos: [0, -0.24, 2.68], colour: 0x3a3c3e, dust: 2.0 });

    /* ---- grille and lights ---- */
    kit.add(T, box(1.62, 0.34, 0.06), { pos: [0, 0.12, -2.34], colour: 0x191b1c });
    for (let i = 0; i < 7; i += 1) {
      kit.add(T, box(0.055, 0.30, 0.05), { pos: [-0.66 + i * 0.22, 0.12, -2.37], colour: livery.accent });
    }
    for (const s of [-1, 1]) {
      // Headlight bucket, lens and brush guard.
      kit.add(T, cyl(0.19, 0.19, 0.10, 10), { pos: [s * 0.74, 0.16, -2.34], rot: [Math.PI / 2, 0, 0], colour: livery.accent });
      kit.add(L, cyl(0.155, 0.155, 0.05, 10), { pos: [s * 0.74, 0.16, -2.40], rot: [Math.PI / 2, 0, 0], colour: 0xd8d6c8 });
      for (let i = -1; i <= 1; i += 1) {
        kit.add(T, cyl(0.016, 0.016, 0.40, 4), { pos: [s * 0.74 + i * 0.13, 0.16, -2.44], colour: STEEL });
      }
      kit.add(T, cyl(0.016, 0.016, 0.40, 4), { pos: [s * 0.74, 0.16, -2.44], rot: [0, 0, Math.PI / 2], colour: STEEL });
      // Indicator and tail lights.
      kit.add(L, box(0.10, 0.10, 0.05), { pos: [s * 1.02, 0.06, -2.30], colour: 0xd8933a });
      kit.add(L, box(0.14, 0.20, 0.05), { pos: [s * 0.84, 0.06, 2.48], colour: 0x8e2822 });
      kit.add(L, box(0.10, 0.09, 0.05), { pos: [s * 0.66, 0.02, 2.48], colour: 0xc9c3ae });
    }

    /* ---- mirrors ---- */
    for (const s of [-1, 1]) {
      kit.add(T, cyl(0.024, 0.024, 0.34, 5), { pos: [s * 1.10, 0.92, -0.36], rot: [0, 0, s * 1.1], colour: STEEL });
      kit.add(T, box(0.06, 0.24, 0.16), { pos: [s * 1.28, 0.96, -0.34], colour: livery.accent });
      kit.add(G, box(0.015, 0.19, 0.12), { pos: [s * 1.31, 0.96, -0.34] });
    }

    /* ---- exhaust: down the flank and up the rear pillar ---- */
    kit.add(T, cyl(0.055, 0.055, 2.40, 6), { pos: [0.88, -0.42, 0.20], rot: [Math.PI / 2, 0, 0], colour: 0x2a2b2c, dust: 2.2 });
    kit.add(T, cyl(0.06, 0.06, 0.70, 6), { pos: [0.92, 0.02, 1.62], rot: [0.28, 0, 0], colour: 0x30322f, dust: 1.6 });
    kit.add(T, cyl(0.075, 0.065, 0.34, 6), { pos: [0.96, 0.44, 1.72], colour: 0x1e1f20 });

    /* ---- aerial ---- */
    kit.add(T, cyl(0.018, 0.008, 2.10, 4), { pos: [-0.96, 1.10, 1.10], rot: [0.06, 0, 0.05], colour: 0x24262a });
    kit.add(T, cyl(0.04, 0.04, 0.12, 6), { pos: [-0.96, 0.12, 1.10], colour: STEEL });

    /* ---- stowage: jerry cans, crate, rolled tarp, spare wheel ---- */
    for (let i = 0; i < 2; i += 1) {
      const x = -0.66 + i * 0.36;
      kit.add(P, hull8(boxCorners(x - 0.15, x + 0.15, 0.18, 0.66, 1.90, 2.24)), { colour: livery.alt, dust: 1.4 });
      kit.add(T, box(0.24, 0.03, 0.03), { pos: [x, 0.58, 1.88], colour: STEEL });
      kit.add(T, cyl(0.035, 0.035, 0.10, 6), { pos: [x, 0.70, 2.06], colour: STEEL });
    }
    kit.add(P, hull8(boxCorners(0.14, 0.88, 0.18, 0.54, 1.42, 2.20)), { colour: livery.accent, dust: 1.4 });
    kit.add(T, box(0.72, 0.03, 0.05), { pos: [0.51, 0.55, 1.60], colour: 0x2e3032 });
    kit.add(P, cyl(0.17, 0.17, 1.30, 7), { pos: [-0.62, 0.34, 1.05], rot: [0, 0, Math.PI / 2], colour: livery.alt, dust: 1.6 });
    // Spare wheel on the tailgate.
    // Spare wheel. Two cylinders was a 12-sided black disc seen end-on
    // from behind - the shape the art director called a black hole.
    // A sidewall recess plus tread blocks gives it something to shade.
    kit.add("wheelspare", cyl(0.42, 0.42, 0.30, 20), { pos: [0, 0.30, 2.56], rot: [Math.PI / 2, 0, 0], colour: 0x2e2f32, dust: 1.8 });
    kit.add("wheelspare", cyl(0.36, 0.36, 0.34, 20), { pos: [0, 0.30, 2.56], rot: [Math.PI / 2, 0, 0], colour: 0x232427, dust: 1.8 });
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * TAU;
      kit.add("wheelspare", box(0.26, 0.06, 0.10), {
        pos: [Math.cos(a) * 0.40, 0.30 + Math.sin(a) * 0.40, 2.56],
        rot: [0, 0, -a + (i % 2 ? 0.14 : -0.14)],
        colour: 0x3a3c40, dust: 1.8,
      });
    }
    kit.add("wheelspare", cyl(0.20, 0.20, 0.32, 12), { pos: [0, 0.30, 2.56], rot: [Math.PI / 2, 0, 0], colour: RIM, dust: 1.5 });
    kit.add("wheelspare", cyl(0.09, 0.09, 0.36, 10), { pos: [0, 0.30, 2.56], rot: [Math.PI / 2, 0, 0], colour: 0x6a6d6c, dust: 1.2 });

    /* ---- pintle mount and MG (the gunner's weapon) ---- */
    const mount = makeKit();
    mount.add("m", cyl(0.06, 0.06, 0.52, 6), { pos: [0, 0.26, 0], colour: livery.accent });
    mount.add("m", box(0.34, 0.10, 0.14), { pos: [0, 0.52, 0], colour: STEEL });
    mount.add("m", box(0.13, 0.16, 0.74), { pos: [0, 0.60, 0.06], colour: 0x2a2c2e });
    mount.add("m", cyl(0.032, 0.028, 0.86, 6), { pos: [0, 0.63, -0.52], rot: [Math.PI / 2, 0, 0], colour: 0x1c1d1f });
    mount.add("m", cyl(0.045, 0.045, 0.16, 6), { pos: [0, 0.63, -0.92], rot: [Math.PI / 2, 0, 0], colour: 0x24262a });
    mount.add("m", box(0.09, 0.09, 0.26), { pos: [0, 0.74, -0.20], colour: 0x303234 });
    mount.add("m", box(0.20, 0.22, 0.20), { pos: [0.16, 0.55, 0.12], colour: 0x35372f });
    // Gun shield: what makes a pintle read as a weapon station.
    mount.add("m", hull8([
      [-0.36, 0.42, -0.30], [0.36, 0.42, -0.30], [0.36, 0.42, -0.26], [-0.36, 0.42, -0.26],
      [-0.30, 0.92, -0.34], [0.30, 0.92, -0.34], [0.30, 0.92, -0.30], [-0.30, 0.92, -0.30],
    ]), { colour: livery.base });
    return { mount: mount.merge().get("m"), mountAt: [0, 1.30, 0.24] };
  }

  /* ------------------------- armoured carrier ------------------------- */

  function buildApc(kit, livery, r) {
    const P = "paint";
    const T = "trim";
    const G = "glass";
    const L = "lens";
    const alt = () => (r.chance(0.3) ? livery.alt : livery.base);

    /* ---- hull: boat-shaped bottom, chamfered sides, sloped glacis ---- */
    kit.add(P, hull8([
      [-1.12, -0.86, -2.90], [1.12, -0.86, -2.90], [1.16, -0.86, 3.30], [-1.16, -0.86, 3.30],
      [-1.44, 0.14, -3.10], [1.44, 0.14, -3.10], [1.44, 0.14, 3.46], [-1.44, 0.14, 3.46],
    ]), { colour: livery.base });
    // Glacis.
    kit.add(P, hull8([
      [-1.12, -0.86, -2.92], [1.12, -0.86, -2.92], [1.16, -0.60, -3.56], [-1.16, -0.60, -3.56],
      [-1.44, 0.14, -3.08], [1.44, 0.14, -3.08], [1.20, 0.28, -3.52], [-1.20, 0.28, -3.52],
    ]), { colour: alt() });
    // Upper hull with the tumblehome the whole silhouette depends on.
    kit.add(P, hull8([
      [-1.44, 0.14, -3.06], [1.44, 0.14, -3.06], [1.44, 0.14, 3.44], [-1.44, 0.14, 3.44],
      [-1.20, 0.86, -2.86], [1.20, 0.86, -2.86], [1.20, 0.86, 3.36], [-1.20, 0.86, 3.36],
    ]), { colour: livery.base });
    // Roof deck and raised turret plinth.
    kit.add(P, hull8(boxCorners(-1.20, 1.20, 0.86, 0.96, -2.86, 3.36)), { colour: alt() });
    kit.add(P, hull8([
      [-1.06, 0.96, -1.30], [1.06, 0.96, -1.30], [1.06, 0.96, 0.66], [-1.06, 0.96, 0.66],
      [-0.96, 1.16, -1.16], [0.96, 1.16, -1.16], [0.96, 1.16, 0.56], [-0.96, 1.16, 0.56],
    ]), { colour: livery.base });
    // Rear plate with the two crew doors outlined.
    kit.add(P, hull8([
      [-1.20, -0.80, 3.30], [1.20, -0.80, 3.30], [1.16, -0.80, 3.62], [-1.16, -0.80, 3.62],
      [-1.20, 0.86, 3.42], [1.20, 0.86, 3.42], [1.16, 0.86, 3.66], [-1.16, 0.86, 3.66],
    ]), { colour: alt() });
    for (const s of [-1, 1]) {
      kit.add(T, box(0.03, 1.30, 0.03), { pos: [s * 0.04, 0.0, 3.66], colour: 0x1a1c1d });
      kit.add(T, box(0.55, 0.03, 0.03), { pos: [s * 0.56, 0.66, 3.66], colour: 0x1a1c1d });
      kit.add(T, box(0.09, 0.14, 0.06), { pos: [s * 0.30, 0.10, 3.68], colour: STEEL });
      kit.add(L, box(0.13, 0.16, 0.05), { pos: [s * 0.94, 0.44, 3.68], colour: 0x8e2822 });
    }

    /* ---- wheel arches, six of them ---- */
    const AXLE_Z = [-2.32, -0.14, 2.06];
    for (const s of [-1, 1]) {
      for (const z of AXLE_Z) {
        kit.add(P, hull8([
          [s * 1.10, -0.60, z - 0.86], [s * 1.42, -0.60, z - 0.78],
          [s * 1.42, -0.60, z + 0.78], [s * 1.10, -0.60, z + 0.86],
          [s * 1.16, 0.18, z - 0.74], [s * 1.36, 0.18, z - 0.68],
          [s * 1.36, 0.18, z + 0.68], [s * 1.16, 0.18, z + 0.74],
        ]), { colour: livery.base, dust: 2.4 });
      }
      // Stowage bins along the flanks, between the arches.
      for (const [z0, z1] of [[-1.36, -0.94], [0.86, 1.84]]) {
        kit.add(P, hull8(boxCorners(
          s > 0 ? 1.20 : -1.46, s > 0 ? 1.46 : -1.20, -0.10, 0.52, z0, z1
        )), { colour: livery.accent, dust: 1.8 });
        kit.add(T, box(0.03, 0.04, z1 - z0 - 0.08), { pos: [s * 1.47, 0.24, (z0 + z1) * 0.5], colour: STEEL, dust: 1.8 });
      }
    }

    /* ---- vision blocks, firing ports, grab rails ---- */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i += 1) {
        const z = -1.9 + i * 1.35;
        kit.add(T, box(0.05, 0.16, 0.30), { pos: [s * 1.33, 0.62, z], colour: 0x141618 });
        kit.add(G, box(0.02, 0.11, 0.24), { pos: [s * 1.36, 0.62, z] });
        kit.add(T, cyl(0.09, 0.09, 0.07, 8), { pos: [s * 1.31, 0.30, z + 0.42], rot: [0, 0, Math.PI / 2], colour: 0x1b1d1f });
      }
      // Grab rails along the roof edge.
      for (let i = 0; i < 5; i += 1) {
        const z = -2.4 + i * 1.4;
        kit.add(T, cyl(0.022, 0.022, 0.42, 4), { pos: [s * 1.12, 1.00, z], rot: [Math.PI / 2, 0, 0], colour: livery.accent });
        for (const dz of [-0.19, 0.19]) {
          kit.add(T, cyl(0.02, 0.02, 0.09, 4), { pos: [s * 1.12, 0.94, z + dz], colour: livery.accent });
        }
      }
    }

    /* ---- driver's station: hatch, periscopes ---- */
    kit.add(T, box(0.62, 0.06, 0.58), { pos: [-0.62, 1.00, -2.10], colour: livery.accent });
    kit.add(T, box(0.66, 0.10, 0.10), { pos: [-0.62, 1.02, -2.42], colour: 0x1a1c1d });
    for (let i = -1; i <= 1; i += 1) {
      kit.add(G, box(0.16, 0.09, 0.03), { pos: [-0.62 + i * 0.20, 1.04, -2.46] });
    }
    kit.add(T, box(0.52, 0.06, 0.50), { pos: [0.58, 1.00, -2.10], colour: livery.accent });

    /* ---- trim vane, tow cable, headlights ---- */
    kit.add(P, hull8([
      [-1.05, 0.26, -3.44], [1.05, 0.26, -3.44], [1.05, 0.26, -2.86], [-1.05, 0.26, -2.86],
      [-1.05, 0.32, -3.42], [1.05, 0.32, -3.42], [1.05, 0.32, -2.88], [-1.05, 0.32, -2.88],
    ]), { colour: livery.accent, dust: 1.6 });
    {
      // A coiled tow cable on the glacis, faked with a flattened torus.
      const g = new THREE.TorusGeometry(0.46, 0.035, 4, 14).toNonIndexed();
      g.computeVertexNormals();
      kit.add(T, g, { pos: [0.55, 0.36, -2.45], rot: [Math.PI / 2, 0, 0], scale: [1, 0.7, 1], colour: 0x2b2d2f, dust: 1.8 });
    }
    for (const s of [-1, 1]) {
      kit.add(T, box(0.44, 0.30, 0.14), { pos: [s * 0.86, 0.02, -3.38], rot: [0.22, 0, 0], colour: livery.accent });
      kit.add(L, cyl(0.13, 0.13, 0.05, 10), { pos: [s * 0.94, 0.03, -3.46], rot: [Math.PI / 2 - 0.22, 0, 0], colour: 0xd8d6c8 });
      kit.add(L, cyl(0.08, 0.08, 0.05, 8), { pos: [s * 0.74, 0.0, -3.46], rot: [Math.PI / 2 - 0.22, 0, 0], colour: 0xd8933a });
      for (let i = -1; i <= 1; i += 1) {
        kit.add(T, cyl(0.014, 0.014, 0.34, 4), { pos: [s * 0.86 + i * 0.14, 0.02, -3.48], colour: STEEL });
      }
    }

    /* ---- exhaust louvres and aerials ---- */
    for (let i = 0; i < 6; i += 1) {
      kit.add(T, box(0.03, 0.06, 0.44), { pos: [1.46, 0.34 + i * 0.09, 2.60], rot: [0.5, 0, 0], colour: 0x1e2021, dust: 1.4 });
    }
    kit.add(T, box(0.34, 0.42, 0.52), { pos: [1.30, 0.34, 2.60], colour: livery.accent, dust: 1.4 });
    for (const [x, z] of [[-1.02, 2.90], [1.02, 2.90]]) {
      kit.add(T, cyl(0.05, 0.05, 0.16, 6), { pos: [x, 1.00, z], colour: STEEL });
      kit.add(T, cyl(0.022, 0.008, 2.60, 4), { pos: [x, 2.34, z], rot: [0.05, 0, x > 0 ? -0.05 : 0.05], colour: 0x24262a });
    }

    /* ---- turret ---- */
    const turret = makeKit();
    turret.add("t", hull8([
      [-0.74, -0.02, -0.66], [0.74, -0.02, -0.66], [0.78, -0.02, 0.72], [-0.78, -0.02, 0.72],
      [-0.58, 0.52, -0.52], [0.58, 0.52, -0.52], [0.62, 0.52, 0.58], [-0.62, 0.52, 0.58],
    ]), { colour: livery.base });
    turret.add("t", hull8(boxCorners(-0.60, 0.60, 0.52, 0.60, -0.50, 0.56)), { colour: livery.alt });
    // Mantlet and barrel.
    turret.add("t", hull8([
      [-0.28, 0.02, -0.90], [0.28, 0.02, -0.90], [0.30, 0.02, -0.60], [-0.30, 0.02, -0.60],
      [-0.24, 0.42, -0.86], [0.24, 0.42, -0.86], [0.28, 0.46, -0.60], [-0.28, 0.46, -0.60],
    ]), { colour: livery.accent });
    turret.add("t", cyl(0.085, 0.072, 2.30, 8), { pos: [0, 0.24, -1.98], rot: [Math.PI / 2, 0, 0], colour: 0x26282a });
    turret.add("t", cyl(0.105, 0.105, 0.26, 8), { pos: [0, 0.24, -3.02], rot: [Math.PI / 2, 0, 0], colour: 0x1c1d1f });
    for (let i = 0; i < 4; i += 1) {
      turret.add("t", box(0.026, 0.24, 0.05), { pos: [0, 0.24, -2.98 + i * 0.07], colour: 0x131415 });
    }
    // Coaxial machine gun.
    turret.add("t", cyl(0.032, 0.028, 0.86, 6), { pos: [0.30, 0.16, -1.16], rot: [Math.PI / 2, 0, 0], colour: 0x1c1d1f });
    // Commander's sight and hatch.
    turret.add("t", box(0.26, 0.20, 0.22), { pos: [-0.32, 0.68, -0.24], colour: livery.accent });
    turret.add("t", box(0.20, 0.03, 0.03), { pos: [-0.32, 0.68, -0.36], colour: 0x131415 });
    turret.add("t", cyl(0.30, 0.30, 0.07, 10), { pos: [0.22, 0.63, 0.16], colour: livery.accent });
    // Smoke grenade launchers, three tubes a side.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        turret.add("t", cyl(0.058, 0.058, 0.30, 6), {
          pos: [s * (0.52 + i * 0.005), 0.30, -0.50 + i * 0.15],
          rot: [-0.5, 0, s * 0.42], colour: 0x2c2e30,
        });
      }
      turret.add("t", box(0.05, 0.16, 0.50), { pos: [s * 0.56, 0.18, -0.28], colour: livery.accent });
      // Stowage basket at the rear of the turret.
      turret.add("t", cyl(0.028, 0.028, 0.62, 4), { pos: [s * 0.50, 0.36, 0.86], rot: [Math.PI / 2, 0, 0], colour: STEEL });
    }
    turret.add("t", box(0.98, 0.26, 0.06), { pos: [0, 0.30, 1.14], colour: STEEL });
    turret.add("t", box(0.98, 0.06, 0.56), { pos: [0, 0.18, 0.88], colour: STEEL });

    return { turretGeo: turret.merge().get("t"), turretAt: [0, 1.16, -0.30] };
  }

  /* ------------------------ transport helicopter ------------------------ */

  function buildHeli(kit, livery, r) {
    const P = "paint";
    const T = "trim";
    const G = "glass";
    const L = "lens";

    /* ---- nose ---- */
    kit.add(P, hull8([
      [-0.72, -0.62, -4.30], [0.72, -0.62, -4.30], [1.10, -0.86, -3.10], [-1.10, -0.86, -3.10],
      [-0.66, -0.10, -4.34], [0.66, -0.10, -4.34], [1.16, 0.40, -3.10], [-1.16, 0.40, -3.10],
    ]), { colour: livery.base });
    // Chin fairing and FLIR ball.
    kit.add(P, hull8([
      [-0.60, -0.90, -3.90], [0.60, -0.90, -3.90], [0.86, -0.90, -3.06], [-0.86, -0.90, -3.06],
      [-0.72, -0.62, -4.24], [0.72, -0.62, -4.24], [1.10, -0.84, -3.08], [-1.10, -0.84, -3.08],
    ]), { colour: livery.alt });
    kit.add(T, sph(0.26, 8, 6), { pos: [0.30, -0.98, -3.62], colour: 0x2a2c2e });
    kit.add(G, sph(0.14, 6, 5), { pos: [0.30, -1.06, -3.78] });

    /* ---- cockpit ---- */
    kit.add(P, hull8([
      [-1.16, -0.86, -3.10], [1.16, -0.86, -3.10], [1.24, -0.90, -1.30], [-1.24, -0.90, -1.30],
      [-1.16, 0.40, -3.10], [1.16, 0.40, -3.10], [1.24, 0.86, -1.30], [-1.24, 0.86, -1.30],
    ]), { colour: livery.base });
    // Windscreen: two raked panes with a centre post, plus chin glass.
    for (const s of [-1, 1]) {
      kit.add(G, box(1.06, 0.02, 1.44), { pos: [s * 0.56, 0.20, -3.28], rot: [0.82, s * 0.10, 0] });
      kit.add(G, box(0.86, 0.02, 0.72), { pos: [s * 0.52, -0.74, -3.58], rot: [-0.36, 0, 0] });
      kit.add(T, box(0.09, 0.10, 1.48), { pos: [s * 1.10, 0.20, -3.24], rot: [0.82, 0, 0], colour: livery.accent });
      // Cockpit side door and its window.
      kit.add(G, box(0.02, 0.62, 0.92), { pos: [s * 1.22, 0.28, -2.32] });
      kit.add(T, box(0.035, 0.05, 0.96), { pos: [s * 1.24, -0.06, -2.32], colour: livery.accent });
      kit.add(T, box(0.05, 0.05, 0.06), { pos: [s * 1.28, -0.20, -1.98], colour: STEEL });
    }
    kit.add(T, box(0.10, 0.12, 1.46), { pos: [0, 0.20, -3.26], rot: [0.82, 0, 0], colour: livery.accent });
    // Wire cutter above the screen, pitot tubes on the nose.
    kit.add(T, box(0.06, 0.22, 0.34), { pos: [0, 0.60, -3.02], colour: STEEL });
    for (const s of [-1, 1]) {
      kit.add(T, cyl(0.016, 0.016, 0.40, 4), { pos: [s * 0.60, 0.12, -4.44], rot: [Math.PI / 2, 0, 0], colour: STEEL });
    }

    /* ---- cabin ---- */
    kit.add(P, hull8([
      [-1.24, -0.90, -1.30], [1.24, -0.90, -1.30], [1.22, -0.86, 2.40], [-1.22, -0.86, 2.40],
      [-1.24, 0.86, -1.30], [1.24, 0.86, -1.30], [1.20, 0.80, 2.40], [-1.20, 0.80, 2.40],
    ]), { colour: livery.base });
    for (const s of [-1, 1]) {
      // Sliding door: a recessed panel with a rail and a big window.
      kit.add(P, hull8(boxCorners(
        s > 0 ? 1.22 : -1.28, s > 0 ? 1.28 : -1.22, -0.80, 0.74, -0.70, 1.20
      )), { colour: livery.alt });
      kit.add(T, box(0.05, 0.055, 2.10), { pos: [s * 1.26, 0.78, 0.25], colour: livery.accent });
      kit.add(T, box(0.05, 0.055, 2.10), { pos: [s * 1.26, -0.84, 0.25], colour: livery.accent });
      kit.add(G, box(0.02, 0.66, 1.24), { pos: [s * 1.30, 0.24, 0.20] });
      kit.add(T, box(0.05, 0.09, 0.16), { pos: [s * 1.32, -0.30, 1.08], colour: STEEL });
      // Cabin rear window.
      kit.add(G, box(0.02, 0.44, 0.60), { pos: [s * 1.26, 0.26, 1.86] });
      // Step under the door.
      kit.add(T, box(0.36, 0.05, 0.72), { pos: [s * 1.30, -0.92, 0.25], colour: livery.accent });
    }

    /* ---- engine deck, intakes, exhausts ---- */
    kit.add(P, hull8([
      [-0.96, 0.80, -1.30], [0.96, 0.80, -1.30], [0.96, 0.78, 1.90], [-0.96, 0.78, 1.90],
      [-0.80, 1.32, -1.06], [0.80, 1.32, -1.06], [0.80, 1.26, 1.60], [-0.80, 1.26, 1.60],
    ]), { colour: livery.alt });
    for (const s of [-1, 1]) {
      kit.add(T, cyl(0.30, 0.30, 0.30, 8), { pos: [s * 0.56, 1.10, -1.14], rot: [Math.PI / 2 - 0.2, 0, 0], colour: 0x1d1f21 });
      kit.add(T, cyl(0.24, 0.24, 0.16, 8), { pos: [s * 0.56, 1.06, -1.30], rot: [Math.PI / 2 - 0.2, 0, 0], colour: 0x101112 });
      // IR-suppressing exhaust, canted outboard.
      kit.add(T, cyl(0.22, 0.26, 0.62, 8), { pos: [s * 0.88, 1.02, 1.30], rot: [Math.PI / 2, 0, s * 0.5], colour: 0x232527 });
      kit.add(T, cyl(0.20, 0.20, 0.08, 8), { pos: [s * 1.06, 1.02, 1.58], rot: [Math.PI / 2, 0, s * 0.5], colour: 0x0e0f10 });
    }
    // Mast fairing.
    kit.add(P, cyl(0.34, 0.44, 0.36, 8), { pos: [0, 1.44, -0.10], colour: livery.accent });

    /* ---- tail boom ---- */
    kit.add(P, hull8([
      [-0.92, -0.62, 2.40], [0.92, -0.62, 2.40], [0.30, -0.34, 5.60], [-0.30, -0.34, 5.60],
      [-0.92, 0.72, 2.40], [0.92, 0.72, 2.40], [0.30, 0.24, 5.60], [-0.30, 0.24, 5.60],
    ]), { colour: livery.base });
    // Stabilator.
    kit.add(P, hull8([
      [-1.50, -0.30, 5.00], [1.50, -0.30, 5.00], [1.34, -0.28, 5.62], [-1.34, -0.28, 5.62],
      [-1.50, -0.20, 4.98], [1.50, -0.20, 4.98], [1.34, -0.20, 5.60], [-1.34, -0.20, 5.60],
    ]), { colour: livery.alt });
    for (const s of [-1, 1]) {
      kit.add(T, box(0.05, 0.24, 0.30), { pos: [s * 1.46, -0.10, 5.30], colour: livery.accent });
    }
    // Canted tail pylon.
    kit.add(P, hull8([
      [-0.24, -0.34, 5.40], [0.24, -0.34, 5.40], [0.20, -0.30, 6.34], [-0.20, -0.30, 6.34],
      [-0.20, 1.42, 5.86], [0.20, 1.42, 5.86], [0.17, 1.42, 6.46], [-0.17, 1.42, 6.46],
    ]), { colour: livery.base });
    kit.add(P, hull8([
      [-0.17, 1.42, 5.88], [0.17, 1.42, 5.88], [0.15, 1.42, 6.44], [-0.15, 1.42, 6.44],
      [-0.12, 1.72, 6.00], [0.12, 1.72, 6.00], [0.11, 1.72, 6.40], [-0.11, 1.72, 6.40],
    ]), { colour: livery.alt });
    // Tail rotor gearbox and stub.
    kit.add(T, cyl(0.19, 0.19, 0.34, 8), { pos: [-0.26, 1.22, 6.10], rot: [0, 0, Math.PI / 2], colour: livery.accent });

    /* ---- landing gear ---- */
    for (const s of [-1, 1]) {
      // Sponson strut: an A-frame down and outboard from the belly.
      kit.add(T, cyl(0.07, 0.07, 0.86, 6), { pos: [s * 1.06, -1.16, 0.62], rot: [0, 0, s * 0.62], colour: livery.accent });
      kit.add(T, cyl(0.055, 0.055, 0.92, 6), { pos: [s * 1.12, -1.10, 0.94], rot: [-0.62, 0, s * 0.72], colour: livery.accent });
      kit.add(T, cyl(0.05, 0.05, 0.42, 6), { pos: [s * 1.34, -1.36, 0.62], colour: STEEL });
      kit.add(T, cyl(0.34, 0.34, 0.24, 12), { pos: [s * 1.34, -1.60, 0.62], rot: [0, 0, Math.PI / 2], colour: 0x1b1c1e, dust: 2.2 });
      kit.add(T, cyl(0.16, 0.16, 0.26, 8), { pos: [s * 1.34, -1.60, 0.62], rot: [0, 0, Math.PI / 2], colour: RIM, dust: 1.8 });
    }
    kit.add(T, cyl(0.05, 0.05, 0.52, 6), { pos: [0, -0.62, 5.35], colour: livery.accent });
    kit.add(T, cyl(0.24, 0.24, 0.18, 10), { pos: [0, -0.94, 5.35], rot: [0, 0, Math.PI / 2], colour: 0x1b1c1e, dust: 2.0 });

    /* ---- door guns ---- */
    for (const s of [-1, 1]) {
      kit.add(T, cyl(0.05, 0.05, 0.44, 6), { pos: [s * 1.16, -0.30, 0.35], colour: STEEL });
      kit.add(T, box(0.11, 0.14, 0.62), { pos: [s * 1.24, -0.06, 0.30], colour: 0x2a2c2e });
      kit.add(T, cyl(0.028, 0.024, 0.78, 6), { pos: [s * 1.24, -0.04, -0.24], rot: [Math.PI / 2, 0, 0], colour: 0x1c1d1f });
      kit.add(T, box(0.18, 0.20, 0.18), { pos: [s * 1.34, -0.14, 0.44], colour: 0x35372f });
    }

    /* ---- lights ---- */
    kit.add(L, box(0.10, 0.09, 0.09), { pos: [-1.24, 0.10, -2.10], colour: 0x7d1f1c });   // port red
    kit.add(L, box(0.10, 0.09, 0.09), { pos: [1.24, 0.10, -2.10], colour: 0x1c6b3a });    // starboard green
    kit.add(L, box(0.09, 0.08, 0.08), { pos: [0, 1.70, 6.36], colour: 0xc9c3ae });        // tail white
    kit.add(L, cyl(0.08, 0.08, 0.07, 8), { pos: [0, 1.36, 1.68], colour: 0x8e2822 });      // anti-collision beacon
    kit.add(L, cyl(0.15, 0.15, 0.07, 10), { pos: [0, -1.02, -2.60], rot: [Math.PI / 2, 0, 0], colour: 0xd8d6c8 }); // landing light

    /* ---- rotor head and blades ---- */
    const head = makeKit();
    head.add("h", cyl(0.13, 0.15, 0.62, 8), { pos: [0, -0.10, 0], colour: 0x3a3d3f });
    head.add("h", cyl(0.36, 0.30, 0.16, 8), { pos: [0, 0.22, 0], colour: livery.accent });
    head.add("h", cyl(0.30, 0.30, 0.05, 10), { pos: [0, 0.02, 0], colour: 0x2c2e30 });   // swashplate
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Blade grip, pitch link and damper - the parts that make a rotor
      // head read as machinery rather than as a disc on a stick.
      head.add("h", box(0.16, 0.13, 0.44), { pos: [sa * 0.42, 0.22, ca * 0.42], rot: [0, a, 0], colour: 0x3f4244 });
      head.add("h", cyl(0.026, 0.026, 0.30, 4), { pos: [sa * 0.34, 0.06, ca * 0.34], rot: [0, a, 0.22], colour: 0x6a6d6c });
      head.add("h", cyl(0.05, 0.05, 0.26, 5), { pos: [sa * 0.30, 0.24, ca * 0.30], rot: [Math.PI / 2, a, 0], colour: 0x55585a });
      // Blade: tapers, droops when stopped, dark tip cap.
      head.add("h", hull8([
        [-0.26, -0.028, 0.62], [0.26, -0.028, 0.62], [0.20, -0.020, 7.10], [-0.20, -0.020, 7.10],
        [-0.26, 0.028, 0.62], [0.26, 0.028, 0.62], [0.20, 0.020, 7.10], [-0.20, 0.020, 7.10],
      ]), { rot: [-0.055, a, 0], colour: 0x232527 });
      head.add("h", box(0.42, 0.05, 0.34), {
        pos: [sa * 7.12, 0.22 - 7.12 * 0.055, ca * 7.12], rot: [0, a, 0], colour: 0xb9b3a4,
      });
    }

    const tail = makeKit();
    tail.add("h", cyl(0.10, 0.10, 0.16, 8), { rot: [0, 0, Math.PI / 2], colour: 0x3a3d3f });
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU;
      tail.add("h", hull8([
        [-0.03, -0.10, 0.16], [0.03, -0.10, 0.16], [0.024, -0.08, 1.34], [-0.024, -0.08, 1.34],
        [-0.03, 0.10, 0.16], [0.03, 0.10, 0.16], [0.024, 0.08, 1.34], [-0.024, 0.08, 1.34],
      ]), { rot: [a, 0, 0], colour: 0x232527 });
    }

    return {
      headGeo: head.merge().get("h"),
      headAt: [0, 1.62, -0.10],
      tailGeo: tail.merge().get("h"),
      tailAt: [-0.34, 1.22, 6.10],
    };
  }

  /* ------------------------------ assembly ------------------------------ */

  function buildBody(type, team, wear, seed) {
    const spec = TYPES[type];
    const livery = LIVERY[team] || LIVERY[TEAM.BLUE];
    const r = makeRng(seed);
    const kit = makeKit();

    let extras = {};
    if (type === "jeep") extras = buildJeep(kit, livery, r);
    else if (type === "apc") extras = buildApc(kit, livery, r);
    else extras = buildHeli(kit, livery, r);

    const merged = kit.merge();
    const body = new THREE.Group();
    body.name = `vehicle-${type}`;

    const paint = MAT.paint.clone();
    // Per-vehicle wear: sun-bleached and dust-loaded rather than a
    // different colour, so two of the same type in one convoy read as
    // the same vehicle with different histories.
    paint.color.setRGB(
      lerp(1, 1.06, wear), lerp(1, 1.02, wear), lerp(1, 0.94, wear)
    ).multiplyScalar(lerp(1.0, 0.84, wear));
    paint.roughness = lerp(0.62, 0.88, wear);
    ownedMaterials.push(paint);

    const trim = MAT.trim.clone();
    trim.roughness = lerp(0.34, 0.62, wear);
    trim.metalness = lerp(0.82, 0.58, wear);
    ownedMaterials.push(trim);

    const lens = MAT.lens.clone();
    lens.emissive = new THREE.Color(0x000000);
    ownedMaterials.push(lens);

    const meshes = {};
    const attach = (name, geometry, material, shadow = true) => {
      if (!geometry) return null;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = shadow && settings.q.shadows;
      mesh.receiveShadow = true;
      body.add(mesh);
      meshes[name] = mesh;
      return mesh;
    };

    attach("paint", merged.get("paint"), paint);
    attach("trim", merged.get("trim"), trim);
    attach("lens", merged.get("lens"), lens);
    attach("wheelspare", merged.get("wheelspare"), MAT.rubber);
    const glassMesh = attach("glass", merged.get("glass"), MAT.glass, false);
    if (glassMesh) glassMesh.userData.qaOpaque = false;

    return { body, meshes, materials: { paint, trim, lens }, extras };
  }

  /* ============================================================
     surface map

     Sand and asphalt have to behave differently, and the terrain has
     no notion of "there is a road here" - the roads are a decorative
     ribbon with no collider. Bake the road network into a coarse mask
     once, and the tyre model gets a real surface lookup for the cost
     of an array index.
     ============================================================ */

  const SURFACE_CELL = 3;
  const surfaceDim = Math.ceil(terrain.MAP_SIZE / SURFACE_CELL) + 1;
  const surfaceMask = new Uint8Array(surfaceDim * surfaceDim);
  {
    const half = terrain.MAP_SIZE * 0.5;
    const stamp = (x, z, radius) => {
      const i0 = Math.max(0, Math.floor((x - radius + half) / SURFACE_CELL));
      const i1 = Math.min(surfaceDim - 1, Math.ceil((x + radius + half) / SURFACE_CELL));
      const j0 = Math.max(0, Math.floor((z - radius + half) / SURFACE_CELL));
      const j1 = Math.min(surfaceDim - 1, Math.ceil((z + radius + half) / SURFACE_CELL));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const wx = -half + i * SURFACE_CELL;
          const wz = -half + j * SURFACE_CELL;
          if (Math.hypot(wx - x, wz - z) <= radius) surfaceMask[j * surfaceDim + i] = 1;
        }
      }
    };
    for (const segment of world.roadSegments || []) {
      const pts = segment.points;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          stamp(lerp(a.x, b.x, t), lerp(a.z, b.z, t), segment.width * 0.46);
        }
      }
    }
  }

  function surfaceAt(x, z) {
    const half = terrain.MAP_SIZE * 0.5;
    const i = Math.round((x + half) / SURFACE_CELL);
    const j = Math.round((z + half) / SURFACE_CELL);
    if (i >= 0 && j >= 0 && i < surfaceDim && j < surfaceDim
      && surfaceMask[j * surfaceDim + i]) return SURFACE.CONCRETE;
    return terrain.slopeAt(x, z) > 0.34 ? SURFACE.ROCK : SURFACE.SAND;
  }

  /* ============================================================
     spawning
     ============================================================ */

  const _tmpA = new THREE.Vector3();

  /**
   * The base's authored vehicle pads sit on the compound wall, which
   * parked every vehicle half inside masonry. Rather than trusting the
   * pad, walk outward from the base centre until the footprint is
   * clear of colliders and the ground is flat enough to park on.
   */
  function findPad(base, index, footprint) {
    const toCentre = Math.atan2(-base.position.x, -base.position.z);
    const best = { point: null, score: -Infinity };
    for (let ring = 0; ring < 7; ring += 1) {
      const radius = 15 + ring * 5.5;
      for (let k = 0; k < 11; k += 1) {
        const spread = (k - 5) / 5;
        const angle = toCentre + spread * 1.25 + index * 0.42;
        const x = base.position.x + Math.sin(angle) * radius;
        const z = base.position.z + Math.cos(angle) * radius;
        if (!terrain.inBounds(x, z)) continue;
        if (terrain.slopeAt(x, z) > 0.16) continue;
        _tmpA.set(x, terrain.heightAt(x, z) + footprint * 0.5, z);
        const blocked = physics.overlapSphere(_tmpA, footprint, LAYER.STATIC | LAYER.VEHICLE);
        if (blocked.length) continue;
        // Prefer close to the base and near the axis the crew will
        // drive out along, so the motor pool reads as a motor pool.
        const score = -radius - Math.abs(spread) * 9 + rng() * 2;
        if (score > best.score) {
          best.score = score;
          best.point = new THREE.Vector3(x, terrain.heightAt(x, z), z);
          best.yaw = angle;
        }
      }
      if (best.point) break;
    }
    return best.point
      ? { position: best.point, yaw: best.yaw }
      : { position: base.vehicleSpawns[index % base.vehicleSpawns.length].clone(), yaw: toCentre };
  }

  let nextId = 0;

  function spawn(type, position, team, yaw = 0) {
    const spec = TYPES[type];
    const wear = clamp01(rng.range(0.12, 0.85));
    const built = buildBody(type, team, wear, ctx.seed ^ (nextId * 0x9e3779b9) ^ 0x51ed);
    group.add(built.body);

    const vehicle = {
      id: `veh-${nextId}`,
      index: nextId,
      type,
      spec,
      team,
      wear,
      body: built.body,
      meshes: built.meshes,
      materials: built.materials,

      position: position.clone(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ")),
      forward: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      speed: 0,
      forwardSpeed: 0,
      surface: SURFACE.SAND,
      groundedWheels: 0,
      airborne: false,

      /* driver intent, written by the player, a bot or the harness */
      control: {
        throttle: 0, steer: 0, brake: 0, handbrake: 0,
        collective: 0, pitch: 0, roll: 0, yaw: 0,
        fire: false, lights: false,
      },
      steerAngle: 0,

      /* drivetrain */
      gear: 1,
      gearTimer: 0,
      rpm: spec.engine ? spec.engine.idle : 0,
      engineLoad: 0,
      wheelSlip: 0,
      rotorSpin: 0,
      rotorRpm: 0,
      autorotating: false,

      wheels: [],
      gearLegs: [],

      health: spec.health,
      maxHealth: spec.health,
      components: { engine: 1, transmission: 1, rotor: 1, tailRotor: 1 },
      state: "intact",
      alive: true,
      wreckTimer: 0,
      respawnTimer: 0,
      smokeTimer: 0,
      flipTimer: 0,
      sleepTimer: 0,
      asleep: false,
      dustTimer: 0,
      trackTimer: 0,
      lightsOn: false,

      occupants: [],
      driver: null,
      seats: spec.seats.map(() => null),
      mounts: [],

      spawnPoint: position.clone(),
      spawnYaw: yaw,
      collider: null,

      /** Undented vertex buffer and factory-fresh material values, so a
       *  respawned vehicle can be restored rather than rebuilt. */
      pristine: built.meshes.paint
        ? Float32Array.from(built.meshes.paint.geometry.attributes.position.array)
        : null,
      baseLook: {
        paint: built.materials.paint.color.clone(),
        paintRoughness: built.materials.paint.roughness,
        paintMetalness: built.materials.paint.metalness,
        trim: built.materials.trim.color.clone(),
        trimRoughness: built.materials.trim.roughness,
        trimMetalness: built.materials.trim.metalness,
      },
    };

    /* ---- inertia (box approximation, scaled per axis) ---- */
    const [hx, hy, hz] = spec.halfExtents;
    const m = spec.mass;
    // Yaw inertia is deliberately below the solid-box value: a real
    // vehicle carries its mass low and central, and a box tensor makes
    // anything with a long wheelbase steer like a barge.
    vehicle.inertia = new THREE.Vector3(
      (m / 3) * (hy * hy + hz * hz) * 0.62,
      (m / 3) * (hx * hx + hz * hz) * 0.44,
      (m / 3) * (hx * hx + hy * hy) * 0.78
    );
    vehicle.invInertia = new THREE.Vector3(
      1 / vehicle.inertia.x, 1 / vehicle.inertia.y, 1 / vehicle.inertia.z
    );

    /* ---- wheels ---- */
    if (spec.kind === "ground") {
      const wheelWear = clamp01(wear + rng.range(-0.15, 0.15));
      const wheelMesh = buildWheel(spec, wheelWear);
      for (const axle of spec.axles) {
        for (const side of [-1, 1]) {
          const mesh = side === -1 && axle === spec.axles[0]
            ? wheelMesh
            : new THREE.Mesh(wheelMesh.geometry, wheelMesh.material);
          mesh.castShadow = settings.q.shadows;
          mesh.receiveShadow = true;
          built.body.add(mesh);
          vehicle.wheels.push({
            /** Suspension anchor in body space: the top of the travel. */
            anchor: new THREE.Vector3(side * axle.track * 0.5, 0.06, axle.z),
            side,
            axle,
            steer: axle.steer || 0,
            drive: axle.drive || 0,
            brakeBias: axle.brakeBias,
            mesh,
            travel: spec.suspension.rest * 0.4,
            prevTravel: spec.suspension.rest * 0.4,
            compression: 0.4,
            grounded: false,
            load: 0,
            omega: 0,
            spin: rng.range(0, TAU),
            slip: 0,
            slipAngle: 0,
            surface: SURFACE.SAND,
            health: 1,
            contact: new THREE.Vector3(),
            normal: new THREE.Vector3(0, 1, 0),
          });
        }
      }
    } else {
      for (const leg of spec.gearLegs) {
        vehicle.gearLegs.push({
          local: new THREE.Vector3(...leg.local),
          radius: leg.radius,
          grounded: false,
          load: 0,
        });
      }
    }

    /* ---- moving sub-assemblies ---- */
    const extras = built.extras;
    if (extras.turretGeo) {
      const turret = new THREE.Mesh(extras.turretGeo, built.materials.paint);
      turret.castShadow = settings.q.shadows;
      turret.receiveShadow = true;
      turret.position.fromArray(extras.turretAt);
      built.body.add(turret);
      vehicle.turret = {
        node: turret, base: turret.position.clone(), yaw: 0, pitch: 0, recoil: 0,
      };
    }
    if (extras.mount) {
      const mount = new THREE.Mesh(extras.mount, built.materials.trim);
      mount.castShadow = settings.q.shadows;
      mount.position.fromArray(extras.mountAt);
      built.body.add(mount);
      vehicle.turret = {
        node: mount, base: mount.position.clone(), yaw: 0, pitch: 0, recoil: 0,
      };
    }
    if (extras.headGeo) {
      const head = new THREE.Mesh(extras.headGeo, built.materials.trim);
      head.castShadow = settings.q.shadows;
      head.position.fromArray(extras.headAt);
      built.body.add(head);
      const tail = new THREE.Mesh(extras.tailGeo, built.materials.trim);
      tail.position.fromArray(extras.tailAt);
      tail.rotation.z = Math.PI / 2;
      built.body.add(tail);

      // Blur discs. A spinning four-blade rotor drawn as four boxes
      // strobes horribly at any frame rate; crossfading to a disc is
      // what every flight game does and what the eye expects.
      const discGeo = new THREE.RingGeometry(0.55, spec.rotor.radius, 32, 1);
      discGeo.rotateX(-Math.PI / 2);
      ownedGeometries.push(discGeo);
      const discMat = rotorDiscMaterial.clone();
      ownedMaterials.push(discMat);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.fromArray(extras.headAt);
      disc.position.y += 0.22;
      disc.userData.qaOpaque = false;
      built.body.add(disc);

      const tailDiscGeo = new THREE.RingGeometry(0.14, spec.tailRotor.radius, 20, 1);
      tailDiscGeo.rotateX(-Math.PI / 2);
      tailDiscGeo.rotateZ(Math.PI / 2);
      ownedGeometries.push(tailDiscGeo);
      const tailDiscMat = rotorDiscMaterial.clone();
      ownedMaterials.push(tailDiscMat);
      const tailDisc = new THREE.Mesh(tailDiscGeo, tailDiscMat);
      tailDisc.position.fromArray(extras.tailAt);
      tailDisc.userData.qaOpaque = false;
      built.body.add(tailDisc);

      vehicle.rotor = { head, tail, disc, discMat, tailDisc, tailDiscMat, angle: 0, tailAngle: 0 };
    }

    /* ---- mounted weapons ---- */
    spec.seats.forEach((seat, index) => {
      if (!seat.weapon) return;
      const def = MOUNTS[seat.weapon];
      vehicle.mounts[index] = {
        def, ammo: def.magazine, reserve: def.magazine * 4,
        cooldown: 0, reloading: 0, shots: 0, heat: 0,
      };
    });

    /* ---- collider ---- */
    vehicle.collider = physics.addBox({
      center: position,
      halfExtents: new THREE.Vector3(...spec.halfExtents),
      quaternion: vehicle.quaternion,
      layer: LAYER.VEHICLE,
      surface: SURFACE.METAL,
      penetrable: spec.armour > 0.5 ? 0 : 0.35,
    });
    vehicle.collider.userData = vehicle;

    built.body.position.copy(position);
    built.body.quaternion.copy(vehicle.quaternion);

    nextId += 1;
    vehicles.push(vehicle);
    return vehicle;
  }

  /* ---- initial fleet ---- */

  for (const base of world.bases) {
    const roster = ["jeep", "jeep", "apc", "heli"];
    roster.forEach((type, index) => {
      const pad = findPad(base, index, TYPES[type].bodyRadius * 0.7);
      const position = pad.position.clone();
      // Sit the chassis at ride height so the springs do not have to
      // catch a drop on the first frame.
      position.y += TYPES[type].kind === "ground"
        ? TYPES[type].wheel.radius + TYPES[type].suspension.rest * 0.55
        : 2.02;
      spawn(type, position, base.team, pad.yaw + Math.PI);
    });
  }

  /* ============================================================
     headlights

     Two spotlights, created once and parked at zero intensity. Adding
     a light later changes the light count and forces every material in
     the scene to recompile - a visible hitch the first time anyone
     switches the headlights on at dusk.
     ============================================================ */

  const headlights = [0, 1].map(() => {
    const light = new THREE.SpotLight(0xfff0d0, 0, 62, 0.52, 0.42, 1.4);
    light.castShadow = false;
    light.target.position.set(0, 0, -1);
    group.add(light);
    group.add(light.target);
    return light;
  });

  /* ============================================================
     dynamics helpers
     ============================================================ */

  const _f = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _pv = new THREE.Vector3();
  const _wf = new THREE.Vector3();
  const _wr = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _accForce = new THREE.Vector3();
  const _accTorque = new THREE.Vector3();
  const _inv = new THREE.Quaternion();
  const _spin = new THREE.Quaternion();

  function refreshBasis(vehicle) {
    vehicle.forward.set(0, 0, -1).applyQuaternion(vehicle.quaternion);
    vehicle.right.set(1, 0, 0).applyQuaternion(vehicle.quaternion);
    vehicle.up.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
  }

  /** Velocity of the material point at world offset `r` from the CoM. */
  function pointVelocity(vehicle, r, out) {
    return out.copy(vehicle.angularVelocity).cross(r).add(vehicle.velocity);
  }

  function addForceAt(vehicle, force, r) {
    _accForce.add(force);
    _t.copy(r).cross(force);
    _accTorque.add(_t);
  }

  function integrate(vehicle, dt) {
    // Linear.
    vehicle.velocity.addScaledVector(_accForce, dt / vehicle.spec.mass);
    // Angular: torque into body space, divide by the diagonal tensor,
    // back out to world. Off-diagonal terms are ignored - for a body
    // this close to its principal axes the error is not observable.
    _inv.copy(vehicle.quaternion).invert();
    _t.copy(_accTorque).applyQuaternion(_inv);
    _t.x *= vehicle.invInertia.x;
    _t.y *= vehicle.invInertia.y;
    _t.z *= vehicle.invInertia.z;
    _t.applyQuaternion(vehicle.quaternion);
    vehicle.angularVelocity.addScaledVector(_t, dt);

    vehicle.position.addScaledVector(vehicle.velocity, dt);

    const w = vehicle.angularVelocity;
    if (w.lengthSq() > 1e-10) {
      _spin.set(w.x, w.y, w.z, 0).multiply(vehicle.quaternion);
      vehicle.quaternion.x += _spin.x * 0.5 * dt;
      vehicle.quaternion.y += _spin.y * 0.5 * dt;
      vehicle.quaternion.z += _spin.z * 0.5 * dt;
      vehicle.quaternion.w += _spin.w * 0.5 * dt;
      vehicle.quaternion.normalize();
    }
    refreshBasis(vehicle);
  }

  /**
   * Ground under a point. Terrain is sampled directly - it is a baked
   * grid lookup and exact. Static geometry is only raycast for vehicles
   * that matter this frame, because six wheels times eight vehicles
   * times 120Hz of ray marching is a millisecond nobody gets back.
   */
  const _rayFrom = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();

  function groundUnder(vehicle, origin, down, maxDist, out) {
    const denom = down.y;
    let best = Infinity;
    if (denom < -1e-4) {
      // Two fixed-point iterations against the height field. One is
      // wrong on a slope because the height is sampled at the ray's
      // origin, not at where it lands; three is indistinguishable from
      // two at the scale a wheel travels.
      let d = (terrain.heightAt(origin.x, origin.z) - origin.y) / denom;
      for (let i = 0; i < 2; i += 1) {
        const px = origin.x + down.x * d;
        const pz = origin.z + down.z * d;
        d = (terrain.heightAt(px, pz) - origin.y) / denom;
      }
      if (d >= 0 && d <= maxDist) {
        best = d;
        out.point.copy(origin).addScaledVector(down, d);
        terrain.normalAt(out.point.x, out.point.z, out.normal);
        out.surface = surfaceAt(out.point.x, out.point.z);
        out.collider = null;
      }
    }
    if (vehicle.detailedContacts) {
      _rayFrom.copy(origin);
      _rayDir.copy(down);
      const hit = physics.raycast(_rayFrom, _rayDir, maxDist, {
        layer: LAYER.STATIC | LAYER.DYNAMIC,
      });
      if (hit.hit && hit.distance < best) {
        best = hit.distance;
        out.point.copy(hit.point);
        out.normal.copy(hit.normal);
        out.surface = hit.surface;
        out.collider = hit.collider;
      }
    }
    out.distance = best;
    return best < Infinity;
  }

  const _contact = {
    distance: Infinity,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    surface: SURFACE.SAND,
    collider: null,
  };

  /* ------------------------------ engine ------------------------------ */

  /** Torque curve: rises off idle, peaks, falls to the limiter. */
  function engineTorque(spec, rpm) {
    const e = spec.engine;
    const x = clamp(rpm, e.idle, e.redline);
    const norm = (x - e.idle) / (e.redline - e.idle);
    const peak = (e.peakRpm - e.idle) / (e.redline - e.idle);
    // A skewed parabola, so there is real torque low down and it
    // genuinely falls away at the top rather than being a flat line.
    const shape = norm < peak
      ? 0.55 + 0.45 * smoothstep(norm / Math.max(peak, 1e-3))
      : 1.0 - 0.42 * smoothstep((norm - peak) / Math.max(1 - peak, 1e-3));
    return e.peakTorque * shape;
  }

  function updateGearbox(vehicle, dt) {
    const spec = vehicle.spec;
    const gb = spec.gearbox;
    const drivenWheels = vehicle.wheels.filter((w) => w.drive > 0);
    let omega = 0;
    for (const w of drivenWheels) omega += w.omega;
    omega = drivenWheels.length ? omega / drivenWheels.length : 0;

    if (vehicle.gearTimer > 0) {
      vehicle.gearTimer -= dt;
      // Off the throttle mid-shift: the reason a shift is audible.
      vehicle.rpm = damp(vehicle.rpm, spec.engine.idle * 1.6, 4.5, dt);
      return 0;
    }

    const ratio = vehicle.gear === -1 ? -gb.reverse : gb.ratios[vehicle.gear - 1];
    const total = Math.abs(ratio) * gb.final;
    const targetRpm = clamp(
      Math.abs(omega) * total * (60 / TAU), spec.engine.idle, spec.engine.redline
    );
    // The clutch: rpm chases the wheels rather than snapping to them,
    // so pulling away from rest flares rather than bogging.
    vehicle.rpm = damp(vehicle.rpm, Math.max(targetRpm,
      spec.engine.idle + Math.abs(vehicle.control.throttle) * 900), 9, dt);

    const forwardWanted = vehicle.control.throttle > 0.05;
    const reverseWanted = vehicle.control.throttle < -0.05;
    const rolling = vehicle.forwardSpeed;

    if (vehicle.gear === -1 && forwardWanted && rolling > -0.6) {
      vehicle.gear = 1; vehicle.gearTimer = gb.shiftTime * 0.6;
    } else if (vehicle.gear > 0 && reverseWanted && rolling < 0.8) {
      vehicle.gear = -1; vehicle.gearTimer = gb.shiftTime * 0.6;
    } else if (vehicle.gear > 0) {
      const maxGear = Math.max(1, Math.round(gb.ratios.length * vehicle.components.transmission));
      if (vehicle.rpm > spec.engine.redline * gb.upshift && vehicle.gear < maxGear) {
        vehicle.gear += 1; vehicle.gearTimer = gb.shiftTime;
      } else if (vehicle.rpm < spec.engine.redline * gb.downshift && vehicle.gear > 1) {
        vehicle.gear -= 1; vehicle.gearTimer = gb.shiftTime * 0.7;
      }
    }

    const throttle = vehicle.gear === -1
      ? clamp01(-vehicle.control.throttle)
      : clamp01(vehicle.control.throttle);
    vehicle.engineLoad = throttle;
    const sign = vehicle.gear === -1 ? -1 : 1;
    return sign * throttle * engineTorque(spec, vehicle.rpm)
      * total * 0.92 * vehicle.components.engine;
  }

  /* ------------------------------ tyres ------------------------------ */

  /** Normalised magic formula. Peaks at 1.0 for slip == 1. */
  const tyreCurve = (s) => (2 * s) / (1 + s * s);

  function simulateGround(vehicle, dt) {
    const spec = vehicle.spec;
    const sus = spec.suspension;
    refreshBasis(vehicle);

    vehicle.speed = vehicle.velocity.length();
    vehicle.forwardSpeed = vehicle.velocity.dot(vehicle.forward);

    _accForce.set(0, -spec.mass * 20, 0);
    _accTorque.set(0, 0, 0);

    /* ---- steering ---- */
    // Lock shrinks with speed. Without this, a flick of the stick at
    // 100km/h asks for a 36-degree slip angle and the vehicle simply
    // spins - which reads as "the handling is broken", not as realism.
    const lockScale = 1 / (1 + Math.abs(vehicle.forwardSpeed) / spec.steerSpeedHalf);
    const targetSteer = vehicle.control.steer * spec.steerMax * lerp(0.32, 1, lockScale);
    vehicle.steerAngle = damp(vehicle.steerAngle, targetSteer, spec.steerRate * 3.4, dt);

    const driveTorque = updateGearbox(vehicle, dt);
    const drivenCount = vehicle.wheels.reduce((n, w) => n + (w.drive > 0 ? 1 : 0), 0) || 1;

    /* ---- suspension and tyres ---- */
    let grounded = 0;
    let slipSum = 0;
    const maxRay = sus.rest + spec.wheel.radius + 0.35;

    for (const wheel of vehicle.wheels) {
      _r.copy(wheel.anchor).applyQuaternion(vehicle.quaternion);
      _f.copy(_r).add(vehicle.position);
      _n.copy(vehicle.up).negate();

      wheel.prevTravel = wheel.travel;
      const hit = groundUnder(vehicle, _f, _n, maxRay, _contact);
      const reach = hit ? _contact.distance : maxRay;
      const travel = sus.rest + spec.wheel.radius - reach;

      if (travel <= 0) {
        wheel.grounded = false;
        wheel.travel = 0;
        wheel.compression = damp(wheel.compression, 0, 9, dt);
        wheel.load = 0;
        // Free wheel: drive torque still spins it (visible wheelspin
        // when a wheel drops into a hollow) and it slowly decays.
        if (wheel.drive > 0) {
          wheel.omega += (driveTorque * wheel.drive / drivenCount)
            / (0.5 * spec.wheel.mass * spec.wheel.radius ** 2) * dt;
        }
        wheel.omega *= Math.exp(-1.6 * dt);
        wheel.slip = 0;
        continue;
      }

      grounded += 1;
      wheel.grounded = true;
      wheel.travel = Math.min(travel, sus.rest);
      wheel.compression = wheel.travel / sus.rest;
      wheel.contact.copy(_contact.point);
      wheel.normal.copy(_contact.normal);
      wheel.surface = _contact.surface;

      _r.copy(_contact.point).sub(vehicle.position);
      pointVelocity(vehicle, _r, _pv);

      // Spring + damper along the chassis' own up axis.
      const springForce = sus.stiffness * wheel.travel;
      const damperForce = -sus.damping * _pv.dot(vehicle.up);
      let load = Math.max(0, springForce + damperForce);
      // Bump stop: the last 15% of travel gets progressively harsher,
      // which is what stops a hard landing punching through the arch.
      if (wheel.compression > 0.85) {
        load += (wheel.compression - 0.85) * sus.stiffness * 7;
      }
      wheel.load = load;
      _f.copy(vehicle.up).multiplyScalar(load);
      addForceAt(vehicle, _f, _r);

      /* ---- tyre frame, on the contact plane ---- */
      const steer = wheel.steer ? vehicle.steerAngle * wheel.steer : 0;
      _wf.copy(vehicle.forward).applyAxisAngle(vehicle.up, steer);
      _wr.copy(vehicle.right).applyAxisAngle(vehicle.up, steer);
      // Project onto the contact plane so a wheel on a slope drives
      // along the slope rather than into it.
      _wf.addScaledVector(wheel.normal, -_wf.dot(wheel.normal)).normalize();
      _wr.addScaledVector(wheel.normal, -_wr.dot(wheel.normal)).normalize();

      const vLong = _pv.dot(_wf);
      const vLat = _pv.dot(_wr);

      const grip = SURFACE_GRIP[wheel.surface] || SURFACE_GRIP[SURFACE.SAND];
      const tyre = spec.grip * lerp(0.45, 1, wheel.health);

      /* ---- longitudinal: drive, brake, slip ratio ---- */
      const wheelInertia = 0.5 * spec.wheel.mass * spec.wheel.radius ** 2;
      if (wheel.drive > 0) {
        wheel.omega += (driveTorque * wheel.drive / drivenCount) / wheelInertia * dt;
      }
      const brakeInput = Math.max(
        vehicle.control.brake * wheel.brakeBias,
        vehicle.control.handbrake * (wheel.steer ? 0.12 : 1)
      );
      const brakeTorque = brakeInput
        * (vehicle.control.handbrake > 0.5 && !wheel.steer
          ? spec.handbrakeTorque : spec.brakeTorque);
      if (brakeTorque > 0) {
        const stop = Math.abs(wheel.omega) * wheelInertia / dt;
        const applied = Math.min(brakeTorque, stop);
        wheel.omega -= Math.sign(wheel.omega) * applied / wheelInertia * dt;
      }

      const contactSpeed = Math.max(Math.abs(vLong), 2.2);
      const slipRatio = clamp((wheel.omega * spec.wheel.radius - vLong) / contactSpeed, -4, 4);
      const slipAngle = Math.atan2(-vLat, Math.abs(vLong) + 1.1);

      // Peak slip ratio around 0.34 and peak slip angle around 9 degrees
      // are the numbers a real tyre curve puts them at. Getting them
      // roughly right is what makes throttle steer work.
      let fLong = load * grip.long * tyre * tyreCurve(slipRatio / 0.34);
      let fLat = load * grip.lat * tyre * tyreCurve(slipAngle / (9 * DEG));

      // Combined slip: a tyre has one friction budget for both axes,
      // and that single fact is what makes braking in a corner lose
      // the front end.
      const limit = load * tyre * lerp(grip.long, grip.lat, 0.5) * 1.25;
      const magnitude = Math.hypot(fLong, fLat);
      if (magnitude > limit && magnitude > 1e-3) {
        const scale = limit / magnitude;
        fLong *= scale;
        fLat *= scale;
      }

      // Rolling resistance, scaled by wheel size - a 0.62m APC tyre
      // rolls over soft ground far better than a 0.44m one, which is
      // most of why heavy vehicles have big wheels. The taper below
      // 0.4 m/s is a stiction term so a parked vehicle on a dune stays
      // parked instead of creeping.
      const roll = -Math.sign(vLong) * load * grip.roll * (0.44 / spec.wheel.radius)
        * (Math.abs(vLong) < 0.4 ? Math.abs(vLong) / 0.4 : 1);

      _f.copy(_wf).multiplyScalar(fLong + roll).addScaledVector(_wr, fLat);
      addForceAt(vehicle, _f, _r);

      // Tyre reaction back on the wheel.
      wheel.omega -= (fLong * spec.wheel.radius) / wheelInertia * dt;
      if (brakeTorque > spec.brakeTorque * 0.92 && Math.abs(wheel.omega) < 1.2) wheel.omega = 0;

      wheel.slip = Math.abs(slipRatio);
      wheel.slipAngle = slipAngle;
      slipSum += Math.max(Math.abs(slipRatio) * 0.55, Math.abs(slipAngle) / (12 * DEG));
    }

    /* ---- anti-roll bars ---- */
    for (const axle of spec.axles) {
      const left = vehicle.wheels.find((w) => w.axle === axle && w.side === -1);
      const rightW = vehicle.wheels.find((w) => w.axle === axle && w.side === 1);
      if (!left || !rightW) continue;
      const delta = (left.travel - rightW.travel) * sus.antiRoll;
      if (Math.abs(delta) < 1e-3) continue;
      for (const [wheel, sign] of [[left, -1], [rightW, 1]]) {
        if (!wheel.grounded) continue;
        _r.copy(wheel.anchor).applyQuaternion(vehicle.quaternion);
        _f.copy(vehicle.up).multiplyScalar(sign * delta);
        addForceAt(vehicle, _f, _r);
      }
    }

    vehicle.groundedWheels = grounded;
    vehicle.airborne = grounded === 0;
    vehicle.wheelSlip = vehicle.wheels.length ? slipSum / vehicle.wheels.length : 0;
    vehicle.surface = vehicle.wheels.find((w) => w.grounded)?.surface || SURFACE.SAND;

    /* ---- aero ---- */
    const speed = vehicle.velocity.length();
    if (speed > 0.05) {
      _f.copy(vehicle.velocity).multiplyScalar(-spec.aero.drag * speed);
      _accForce.add(_f);
    }
    // Angular damping: without it the yaw rate integrates forever on a
    // jump and the vehicle lands spinning.
    _accTorque.addScaledVector(vehicle.angularVelocity,
      -spec.mass * (grounded ? 0.30 : 0.55));

    integrate(vehicle, dt);
    resolveChassis(vehicle, dt);

    /* ---- wheel visuals ---- */
    for (const wheel of vehicle.wheels) {
      wheel.spin += wheel.omega * dt;
      if (wheel.spin > TAU) wheel.spin -= TAU;
      if (wheel.spin < -TAU) wheel.spin += TAU;
      wheel.mesh.position.set(
        wheel.anchor.x,
        wheel.anchor.y - (sus.rest - wheel.travel),
        wheel.anchor.z
      );
      wheel.mesh.rotation.set(wheel.spin, wheel.steer ? vehicle.steerAngle * wheel.steer : 0, 0, "YXZ");
      // A shot-out tyre sits on its rim and drags.
      if (wheel.health < 0.35) wheel.mesh.scale.set(1, lerp(0.72, 1, wheel.health / 0.35), lerp(0.72, 1, wheel.health / 0.35));
    }

    /* ---- flipped ---- */
    if (vehicle.up.y < 0.18 && grounded < 2) {
      vehicle.flipTimer += dt;
      // Self-right after a few seconds. Every vehicle game that does
      // not do this ends up with half its fleet on its roof by minute
      // ten, and a player stuck upside-down just quits.
      if (vehicle.flipTimer > 3.2) {
        const yaw = Math.atan2(vehicle.forward.x, vehicle.forward.z) + Math.PI;
        _spin.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
        vehicle.quaternion.slerp(_spin, clamp01(dt * 3.4));
        vehicle.angularVelocity.multiplyScalar(Math.exp(-6 * dt));
        vehicle.position.y += 1.4 * dt;
        if (vehicle.up.y > 0.86) vehicle.flipTimer = 0;
      }
    } else {
      vehicle.flipTimer = 0;
    }
  }

  /* ------------------------------ flight ------------------------------ */

  function simulateAir(vehicle, dt) {
    const spec = vehicle.spec;
    const control = vehicle.control;
    refreshBasis(vehicle);

    vehicle.speed = vehicle.velocity.length();
    vehicle.forwardSpeed = vehicle.velocity.dot(vehicle.forward);

    const engineAlive = vehicle.components.engine > 0.25 && vehicle.alive;
    const agl = vehicle.position.y - terrain.heightAt(vehicle.position.x, vehicle.position.z);
    const descentRate = -vehicle.velocity.y;

    /* ---- rotor ---- */
    if (engineAlive) {
      const demand = vehicle.driver ? 1 : 0;
      vehicle.rotorRpm = damp(vehicle.rotorRpm, demand, spec.rotor.spinUp * 2.6, dt);
      vehicle.autorotating = false;
    } else {
      // Autorotation: the disc is driven by air coming up through it,
      // so a controlled descent keeps rotor rpm alive and the stored
      // energy can be cashed in once, at the bottom, as a flare.
      const inflow = clamp01(descentRate / 16) * 0.55;
      const drain = 0.20 + control.collective * 0.75;
      vehicle.rotorRpm = clamp(vehicle.rotorRpm + (inflow - drain * 0.34) * dt, 0, 1.05);
      vehicle.autorotating = vehicle.rotorRpm > 0.25;
    }
    vehicle.rotorSpin = vehicle.rotorRpm;

    _accForce.set(0, -spec.mass * 20, 0);
    _accTorque.set(0, 0, 0);

    /* ---- thrust ---- */
    // Ground effect: the disc pushes against its own downwash near the
    // ground and gets up to 30% more lift for free. It is why a heavy
    // helicopter can hover at 2m but not at 20m, and it is the single
    // most missed detail in games with helicopters.
    const groundEffect = 1 + 0.30 * clamp01(1 - agl / (spec.rotor.radius * 1.35));
    // Translational lift: clean air through the disc once you are
    // moving. The bump through 12-16 m/s is a real, felt event.
    const etl = 1 + 0.16 * smoothstep(clamp01((Math.abs(vehicle.forwardSpeed) - 5) / 12));
    const rotorHealth = lerp(0.45, 1, vehicle.components.rotor);
    const thrust = spec.maxThrust * control.collective
      * vehicle.rotorRpm * vehicle.rotorRpm * groundEffect * etl * rotorHealth;
    _accForce.addScaledVector(vehicle.up, thrust);

    /* ---- cyclic and pedals ---- */
    const authority = vehicle.rotorRpm * (vehicle.driver ? 1 : 0);
    _t.set(0, 0, 0);
    _t.addScaledVector(vehicle.right, -control.pitch * spec.cyclicTorque[0] * authority);
    _t.addScaledVector(vehicle.forward, -control.roll * spec.cyclicTorque[1] * authority);

    // Main rotor torque yaws the fuselage; the tail rotor cancels it,
    // and the pedals bias that balance. Raise collective and the nose
    // swings unless you feed in pedal - the coupling that makes a
    // helicopter feel like a helicopter.
    const tailAuthority = vehicle.components.tailRotor;
    const reaction = spec.rotorTorque * control.collective * vehicle.rotorRpm;
    const tail = spec.pedalTorque * control.yaw * authority * tailAuthority
      + reaction * tailAuthority;
    _t.addScaledVector(vehicle.up, reaction * -1 + tail);
    _accTorque.add(_t);

    // Rate damping and a weak pendulum: the airframe hangs under the
    // disc, so it self-levels slowly. Slowly is the operative word -
    // a strong term turns the aircraft into a hovering brick.
    _t.copy(vehicle.angularVelocity);
    _t.multiplyScalar(-1);
    _accTorque.addScaledVector(vehicle.right, _t.dot(vehicle.right) * spec.rateDamping[0] * spec.mass * 0.08);
    _accTorque.addScaledVector(vehicle.up, _t.dot(vehicle.up) * spec.rateDamping[1] * spec.mass * 0.08);
    _accTorque.addScaledVector(vehicle.forward, _t.dot(vehicle.forward) * spec.rateDamping[2] * spec.mass * 0.08);

    _n.set(0, 1, 0).cross(vehicle.up);
    _accTorque.addScaledVector(_n, -spec.mass * 5.5 * vehicle.rotorRpm);

    /* ---- drag, anisotropic ---- */
    if (vehicle.speed > 0.05) {
      const [dLong, dLat, dVert] = spec.aero.drag;
      const vf = vehicle.velocity.dot(vehicle.forward);
      const vr = vehicle.velocity.dot(vehicle.right);
      const vu = vehicle.velocity.dot(vehicle.up);
      _f.set(0, 0, 0)
        .addScaledVector(vehicle.forward, -dLong * vf * Math.abs(vf))
        .addScaledVector(vehicle.right, -dLat * vr * Math.abs(vr))
        .addScaledVector(vehicle.up, -dVert * vu * Math.abs(vu));
      _accForce.add(_f);
      // Weathercock: the tail fin wants to point downwind.
      _accTorque.addScaledVector(vehicle.up, -vr * Math.abs(vf) * spec.aero.weathercock * 0.02);
    }

    /* ---- undercarriage ---- */
    let onGround = 0;
    for (const leg of vehicle.gearLegs) {
      _r.copy(leg.local).applyQuaternion(vehicle.quaternion);
      _f.copy(_r).add(vehicle.position);
      const groundY = terrain.heightAt(_f.x, _f.z);
      const penetration = groundY + leg.radius - _f.y;
      leg.grounded = penetration > 0;
      if (!leg.grounded) { leg.load = 0; continue; }
      onGround += 1;
      pointVelocity(vehicle, _r, _pv);
      const load = Math.max(0, spec.gearSpring * penetration - spec.gearDamping * _pv.y);
      leg.load = load;
      _t.set(0, load, 0);
      addForceAt(vehicle, _t, _r);
      // Ground friction so the aircraft does not skate on landing.
      _t.set(-_pv.x, 0, -_pv.z).multiplyScalar(Math.min(load * 0.55, spec.mass * 5));
      addForceAt(vehicle, _t, _r);
    }
    vehicle.groundedWheels = onGround;

    /* ---- crash detection ---- */
    if (onGround > 0 && !vehicle.wasOnGround) {
      const impact = Math.max(0, descentRate - 3.2);
      const attitude = Math.max(0, 0.94 - vehicle.up.y) * 26;
      if (impact > 0 || attitude > 1) {
        // Under ~7 m/s of descent this is a heavy landing, not a crash.
        // Above that it climbs fast, which is the shape a player can
        // learn: you can drop it in from 5m and walk away.
        const harm = impact * impact * 12 + attitude * attitude * 9;
        if (harm > 24) damage(vehicle, harm, { cause: "impact" });
        ctx.audio?.playAt?.("land", vehicle.position, { volume: clamp01(harm / 400) });
      }
    }
    vehicle.wasOnGround = onGround > 0;

    if (vehicle.speed > spec.maxSpeed) {
      vehicle.velocity.multiplyScalar(spec.maxSpeed / vehicle.speed);
    }

    integrate(vehicle, dt);
    resolveChassis(vehicle, dt);
  }

  /* --------------------------- collisions --------------------------- */

  /**
   * Push the chassis out of static geometry and react to the impact.
   *
   * Sampling the OBB at its corners and face centres rather than doing
   * a proper OBB-OBB SAT test: the error is a few centimetres on the
   * shapes this map contains (axis-ish boxes, nothing thin), and the
   * cheap version can run for every vehicle every step, which the
   * correct version cannot.
   */
  const SAMPLES = [];
  {
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, -0.5, 0.5, 1]) {
          if (x === 0 && Math.abs(z) !== 1) continue;
          SAMPLES.push([x, y, z]);
        }
      }
    }
  }

  const _sample = new THREE.Vector3();
  const _local = new THREE.Vector3();
  const _push = new THREE.Vector3();
  const _qmin = new THREE.Vector3();
  const _qmax = new THREE.Vector3();

  function resolveChassis(vehicle, dt) {
    const spec = vehicle.spec;
    const [hx, hy, hz] = spec.halfExtents;
    const reach = Math.max(hx, hy, hz) + 0.4;
    _qmin.set(vehicle.position.x - reach, vehicle.position.y - reach, vehicle.position.z - reach);
    _qmax.set(vehicle.position.x + reach, vehicle.position.y + reach, vehicle.position.z + reach);
    const nearby = physics.queryBox(_qmin, _qmax, LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE);
    if (!nearby.length) return;
    // queryBox reuses one array, and closestPointOnBox below can
    // re-enter it. Copy before iterating.
    const candidates = nearby.slice();

    let deepest = 0;
    let deepestNormal = null;
    let deepestPoint = null;

    for (const collider of candidates) {
      if (collider === vehicle.collider) continue;
      for (const s of SAMPLES) {
        _sample.set(s[0] * hx * 0.94, s[1] * hy * 0.94, s[2] * hz * 0.94)
          .applyQuaternion(vehicle.quaternion).add(vehicle.position);
        _local.copy(_sample).sub(collider.center).applyQuaternion(collider.invQuaternion);
        const e = collider.halfExtents;
        if (Math.abs(_local.x) > e.x || Math.abs(_local.y) > e.y || Math.abs(_local.z) > e.z) continue;
        // Inside: push out along the shallowest axis.
        const dx = e.x - Math.abs(_local.x);
        const dy = e.y - Math.abs(_local.y);
        const dz = e.z - Math.abs(_local.z);
        let depth;
        if (dx < dy && dx < dz) { depth = dx; _push.set(Math.sign(_local.x) || 1, 0, 0); }
        else if (dy < dz) { depth = dy; _push.set(0, Math.sign(_local.y) || 1, 0); }
        else { depth = dz; _push.set(0, 0, Math.sign(_local.z) || 1); }
        if (depth <= deepest) continue;
        deepest = depth;
        deepestNormal = _push.clone().applyQuaternion(collider.quaternion).normalize();
        deepestPoint = _sample.clone();
      }
    }

    if (!deepestNormal) return;

    vehicle.position.addScaledVector(deepestNormal, deepest + 0.004);

    _r.copy(deepestPoint).sub(vehicle.position);
    pointVelocity(vehicle, _r, _pv);
    const closing = _pv.dot(deepestNormal);
    if (closing < 0) {
      // Impulse with an effective mass that accounts for the lever arm,
      // so a corner strike spins the vehicle and a square-on hit does
      // not. Restitution is low: metal does not bounce.
      _t.copy(_r).cross(deepestNormal);
      const angularTerm = (_t.x * _t.x) * vehicle.invInertia.x
        + (_t.y * _t.y) * vehicle.invInertia.y
        + (_t.z * _t.z) * vehicle.invInertia.z;
      const effMass = 1 / (1 / spec.mass + angularTerm);
      const j = -(1 + 0.12) * closing * effMass;
      _f.copy(deepestNormal).multiplyScalar(j);
      vehicle.velocity.addScaledVector(_f, 1 / spec.mass);
      _t.copy(_r).cross(_f);
      _inv.copy(vehicle.quaternion).invert();
      _t.applyQuaternion(_inv);
      _t.x *= vehicle.invInertia.x; _t.y *= vehicle.invInertia.y; _t.z *= vehicle.invInertia.z;
      _t.applyQuaternion(vehicle.quaternion);
      vehicle.angularVelocity.add(_t);
      // Scrub tangential velocity so a vehicle sliding along a wall
      // slows rather than gliding.
      vehicle.velocity.multiplyScalar(Math.exp(-2.4 * dt));

      if (closing < -5.5) {
        const severity = (-closing - 5.5);
        damage(vehicle, severity * severity * 1.6 * (spec.mass / 4000), { cause: "collision" });
        ctx.audio?.playAt?.("land", deepestPoint, { volume: clamp01(severity / 12) });
        ctx.vfx?.impact?.(deepestPoint, deepestNormal, SURFACE.METAL, clamp01(severity / 8));
      }
    }
  }

  /** Run down anything standing in front of a moving vehicle. */
  const _flat = new THREE.Vector3();
  function crushCheck(vehicle, dt) {
    if (vehicle.speed < 5 || !vehicle.alive) return;
    const reach = vehicle.spec.halfExtents[2] + 1.0;
    const width = vehicle.spec.halfExtents[0] + 0.5;
    const energy = clamp01((vehicle.speed - 5) / 12) * (vehicle.spec.mass / 3000);

    const test = (target, position, applyHarm) => {
      _flat.copy(position).sub(vehicle.position);
      if (Math.abs(_flat.y) > 2.4) return;
      const along = _flat.dot(vehicle.forward);
      const across = _flat.dot(vehicle.right);
      if (Math.abs(along) > reach || Math.abs(across) > width) return;
      // Rate-based, so a glancing brush hurts and a full-speed run over
      // is fatal, without either needing a special case.
      applyHarm((120 + 420 * energy) * dt);
    };

    if (ctx.bots) {
      for (const bot of ctx.bots.bots) {
        if (!bot.alive || bot.inVehicle) continue;
        test(bot, bot.position, (harm) => ctx.bots.applyDamage(bot, harm, { source: vehicle }));
      }
    }
    const player = ctx.player;
    if (player && player.state.alive && !player.state.inVehicle) {
      test(player, player.position, (harm) => player.applyDamage(harm, vehicle, "roadkill"));
    }
  }

  /* ============================================================
     damage and states
     ============================================================ */

  /** Which component a hit at `point` lands on. */
  function componentAt(vehicle, point) {
    if (!point) return null;
    _local.copy(point).sub(vehicle.position).applyQuaternion(
      _inv.copy(vehicle.quaternion).invert()
    );
    if (vehicle.spec.kind === "air") {
      if (_local.z > 3.6) return "tailRotor";
      if (_local.y > 0.9) return "rotor";
      return "engine";
    }
    if (_local.z < -vehicle.spec.halfExtents[2] * 0.45) return "engine";
    if (_local.z > vehicle.spec.halfExtents[2] * 0.5) return "transmission";
    return null;
  }

  function setState(vehicle, next) {
    if (vehicle.state === next) return;
    vehicle.state = next;
    const paint = vehicle.materials.paint;
    if (next === "damaged") {
      paint.color.multiplyScalar(0.86);
      dentBody(vehicle, 0.055);
    } else if (next === "burning") {
      paint.color.multiplyScalar(0.78);
      dentBody(vehicle, 0.09);
    } else if (next === "wreck") {
      // Charred: near-black, matte, and the glass is gone.
      paint.color.setRGB(0.10, 0.088, 0.082);
      paint.roughness = 0.96;
      paint.metalness = 0.08;
      vehicle.materials.trim.color.setRGB(0.14, 0.13, 0.12);
      vehicle.materials.trim.roughness = 0.92;
      vehicle.materials.trim.metalness = 0.2;
      if (vehicle.meshes.glass) vehicle.meshes.glass.visible = false;
      if (vehicle.meshes.lens) vehicle.meshes.lens.visible = false;
      dentBody(vehicle, 0.16);
      for (const wheel of vehicle.wheels) {
        wheel.health = 0;
        wheel.mesh.scale.set(1, 0.66, 0.66);
      }
      if (vehicle.rotor) {
        // A dead rotor droops and the disc goes.
        vehicle.rotor.head.rotation.z = 0.16;
        vehicle.rotor.disc.visible = false;
        vehicle.rotor.tailDisc.visible = false;
      }
      if (vehicle.turret) vehicle.turret.node.rotation.x = -0.22;
    }
    ctx.bus.emit("vehicle:state", { vehicle, state: next });
  }

  /**
   * Panel-beat the hull.
   *
   * Real dents, not a decal: push a random subset of paint vertices in
   * along their own normal. It costs one pass over the buffer and it is
   * the difference between "damaged" reading as a colour change and as
   * a vehicle that has been hit.
   */
  function dentBody(vehicle, amount) {
    const mesh = vehicle.meshes.paint;
    if (!mesh) return;
    const position = mesh.geometry.attributes.position;
    const dentRng = makeRng(vehicle.index * 2654435761 + Math.round(amount * 1000));
    const count = position.count;
    for (let i = 0; i < count; i += 3) {
      if (!dentRng.chance(0.22)) continue;
      const push = dentRng.range(0.4, 1.6) * amount;
      for (let k = 0; k < 3; k += 1) {
        const idx = i + k;
        const x = position.getX(idx);
        const y = position.getY(idx);
        const z = position.getZ(idx);
        const len = Math.hypot(x, y, z) || 1;
        position.setXYZ(idx, x - (x / len) * push, y - (y / len) * push, z - (z / len) * push);
      }
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function damage(vehicle, amount, options = {}) {
    if (!vehicle.alive || amount <= 0) return false;
    vehicle.asleep = false;
    vehicle.sleepTimer = 0;

    const reduced = amount * (1 - vehicle.spec.armour * (options.cause === "bullet" ? 1 : 0.35));
    vehicle.health -= reduced;

    const component = options.component || componentAt(vehicle, options.point);
    if (component && vehicle.components[component] !== undefined) {
      vehicle.components[component] = clamp01(
        vehicle.components[component] - reduced / (vehicle.maxHealth * 0.42)
      );
    }
    // A wheel hit by the round that came in low.
    if (options.point && vehicle.wheels.length) {
      let nearest = null;
      let best = 1.1;
      for (const wheel of vehicle.wheels) {
        const d = wheel.contact.distanceTo(options.point);
        if (d < best) { best = d; nearest = wheel; }
      }
      if (nearest) nearest.health = clamp01(nearest.health - reduced / 260);
    }

    const fraction = vehicle.health / vehicle.maxHealth;
    if (vehicle.health <= 0) {
      vehicle.health = 0;
      vehicle.alive = false;
      vehicle.wreckTimer = 22;
      setState(vehicle, "wreck");
      ctx.vfx?.explosion?.(vehicle.position, vehicle.spec.kind === "air" ? 12 : 9);
      ctx.audio?.explosion?.(vehicle.position, vehicle.spec.kind === "air" ? 2.0 : 1.5);
      // Kick the wreck: an explosion that does not move the thing it
      // destroyed reads as a sprite being swapped.
      vehicle.velocity.y += 5.5;
      vehicle.angularVelocity.set(rng.gauss() * 1.2, rng.gauss() * 0.9, rng.gauss() * 1.2);
      for (const occupant of vehicle.occupants.slice()) {
        exit(vehicle, occupant, true);
        if (occupant === ctx.player) ctx.player.applyDamage(220, null, "vehicle-destroyed");
        else if (ctx.bots && occupant.health !== undefined) {
          ctx.bots.applyDamage(occupant, 220, { source: null });
        }
      }
      ctx.bus.emit("vehicle:destroyed", { vehicle, by: options.source || null });
      return true;
    }

    if (fraction < 0.24) setState(vehicle, "burning");
    else if (fraction < 0.58) setState(vehicle, "damaged");
    return false;
  }

  /* ============================================================
     seats
     ============================================================ */

  const _seatWorld = new THREE.Vector3();
  const _exitProbe = new THREE.Vector3();

  function seatWorldPosition(vehicle, seatIndex, out) {
    const seat = vehicle.spec.seats[seatIndex];
    return out.fromArray(seat.eye).applyQuaternion(vehicle.quaternion).add(vehicle.position);
  }

  function freeSeat(vehicle, preferDriver = true) {
    if (preferDriver && vehicle.seats[0] === null) return 0;
    for (let i = 0; i < vehicle.seats.length; i += 1) {
      if (vehicle.seats[i] === null) return i;
    }
    return -1;
  }

  function enter(vehicle, occupant, seatIndex = -1) {
    if (!vehicle || !vehicle.alive || !occupant) return false;
    if (vehicle.occupants.includes(occupant)) return true;
    const index = seatIndex >= 0 && vehicle.seats[seatIndex] === null
      ? seatIndex
      : freeSeat(vehicle);
    if (index < 0) return false;

    vehicle.seats[index] = occupant;
    vehicle.occupants.push(occupant);
    occupant.vehicleSeat = index;
    occupant.inVehicle = vehicle;
    if (index === 0) vehicle.driver = occupant;
    vehicle.asleep = false;
    vehicle.sleepTimer = 0;

    if (occupant === ctx.player) {
      ctx.player.state.inVehicle = vehicle;
      ctx.player.state.vehicleSeat = index;
    } else if (occupant.root) {
      // A bot in a seat: hide the walking figure. Posing a soldier to
      // sit needs a rig this character system does not have, and a
      // standing man sliding along inside a jeep is worse than none.
      occupant.root.visible = false;
    }
    ctx.bus.emit("vehicle:enter", { vehicle, occupant, seat: index });
    return true;
  }

  /**
   * Find somewhere outside the vehicle that a soldier actually fits.
   *
   * The old version stepped one fixed offset to the right, which put
   * the player inside a wall any time the vehicle was parked against
   * one - and inside the vehicle any time it was on its side.
   */
  function findExitPoint(vehicle, seatIndex, out) {
    const seat = vehicle.spec.seats[seatIndex];
    const radius = 0.36;
    const height = 1.8;
    const candidates = [seat.exit];
    const reach = vehicle.spec.halfExtents[0] + 1.5;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU;
      candidates.push([Math.sin(a) * reach, 0.2, Math.cos(a) * (vehicle.spec.halfExtents[2] + 1.1)]);
    }
    // Last resort: on the roof. Ugly, but never inside anything.
    candidates.push([0, vehicle.spec.halfExtents[1] + 1.2, 0]);

    for (const offset of candidates) {
      _exitProbe.fromArray(offset).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      _exitProbe.y = Math.max(
        terrain.heightAt(_exitProbe.x, _exitProbe.z),
        _exitProbe.y - 1.4
      );
      const hits = [];
      physics.resolveCapsule(_exitProbe.clone(), radius, height,
        LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE, hits);
      if (!hits.length) return out.copy(_exitProbe);
    }
    out.copy(vehicle.position);
    out.y = terrain.heightAt(out.x, out.z) + 0.2;
    return out;
  }

  function exit(vehicle, occupant, forced = false) {
    const index = vehicle.occupants.indexOf(occupant);
    const seatIndex = occupant.vehicleSeat ?? 0;
    if (index >= 0) vehicle.occupants.splice(index, 1);
    if (vehicle.seats[seatIndex] === occupant) vehicle.seats[seatIndex] = null;
    if (vehicle.driver === occupant) {
      vehicle.driver = vehicle.occupants[0] || null;
      if (!vehicle.driver) {
        vehicle.control.throttle = 0;
        vehicle.control.steer = 0;
        vehicle.control.handbrake = 1;
        vehicle.control.collective = 0;
      }
    }
    occupant.vehicleSeat = null;
    occupant.inVehicle = null;

    findExitPoint(vehicle, seatIndex, _seatWorld);
    if (occupant === ctx.player) {
      ctx.player.state.inVehicle = null;
      ctx.player.state.vehicleSeat = null;
      ctx.player.teleport(_seatWorld.x, _seatWorld.y, _seatWorld.z);
      // Carry a little of the vehicle's momentum out with them, capped
      // so bailing at 100km/h is a bad idea rather than a teleport.
      if (!forced) {
        ctx.player.velocity.copy(vehicle.velocity).multiplyScalar(0.55);
        if (ctx.player.velocity.length() > 12) ctx.player.velocity.setLength(12);
      }
    } else {
      if (occupant.position) occupant.position.copy(_seatWorld);
      if (occupant.root) occupant.root.visible = true;
    }
    ctx.bus.emit("vehicle:exit", { vehicle, occupant });
  }

  /** The vehicle a soldier could get into right now. */
  function nearestUsable(position, team, maxDistance = 5.0) {
    let best = null;
    let bestScore = -Infinity;
    for (const vehicle of vehicles) {
      if (!vehicle.alive) continue;
      if (vehicle.occupants.length >= vehicle.spec.seats.length) continue;
      const distance = vehicle.position.distanceTo(position);
      const reach = maxDistance + vehicle.spec.bodyRadius * 0.55;
      if (distance > reach) continue;
      // Own team first, then the nearer one; an enemy vehicle can still
      // be stolen, which is half the fun of leaving one unattended.
      const score = (vehicle.team === team ? 40 : 0) - distance;
      if (score > bestScore) { bestScore = score; best = vehicle; }
    }
    return best;
  }

  /* ============================================================
     mounted weapons
     ============================================================ */

  const _muzzle = new THREE.Vector3();
  const _aim = new THREE.Vector3();
  const _side = new THREE.Vector3();

  function mountMuzzle(vehicle, seatIndex, out) {
    if (vehicle.turret && vehicle.spec.seats[seatIndex].weapon !== "doorgun") {
      vehicle.turret.node.getWorldPosition(out);
      const def = MOUNTS[vehicle.spec.seats[seatIndex].weapon];
      const length = def === MOUNTS.autocannon ? 3.1 : 1.0;
      out.addScaledVector(_aim, length);
      return out;
    }
    seatWorldPosition(vehicle, seatIndex, out);
    return out.addScaledVector(_aim, 1.3);
  }

  function fireMount(vehicle, seatIndex, direction) {
    const mount = vehicle.mounts[seatIndex];
    if (!mount || mount.cooldown > 0 || mount.reloading > 0) return false;
    if (mount.ammo <= 0) {
      if (mount.reserve > 0) mount.reloading = mount.def.reload;
      else ctx.audio?.playAt?.("click", vehicle.position);
      return false;
    }
    const def = mount.def;
    mount.cooldown = 60 / def.rpm;
    mount.ammo -= 1;
    mount.shots += 1;
    mount.heat = clamp01(mount.heat + 0.06);

    _aim.copy(direction).normalize();
    // Dispersion grows with sustained fire, the same way the infantry
    // weapons do, so a mounted gun is suppression at range and a
    // scalpel in bursts.
    const spread = (def.spread + mount.heat * 1.4) * DEG;
    _side.set(_aim.z, 0, -_aim.x).normalize();
    _t.crossVectors(_side, _aim).normalize();
    const angle = rng() * TAU;
    const radius = Math.sqrt(rng()) * Math.tan(spread);
    _aim.addScaledVector(_side, Math.cos(angle) * radius)
      .addScaledVector(_t, Math.sin(angle) * radius).normalize();

    mountMuzzle(vehicle, seatIndex, _muzzle);

    const hit = physics.raycast(_muzzle, _aim, 700, {
      layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
      ignore: (c) => c === vehicle.collider,
    });
    const characterHit = ctx.bots
      ? ctx.bots.raycast(_muzzle, _aim, hit.hit ? hit.distance : 700)
      : null;
    const distance = characterHit ? characterHit.distance : (hit.hit ? hit.distance : 700);

    ctx.vfx?.muzzleFlash?.(_muzzle, _aim, def === MOUNTS.autocannon ? 2.2 : 1.4);
    ctx.audio?.gunshot?.(_muzzle, {
      gain: def === MOUNTS.autocannon ? 1.6 : 1.1,
      pitch: def === MOUNTS.autocannon ? 0.62 : 0.92,
    });
    if (mount.shots % def.tracerEvery === 0) {
      ctx.vfx?.tracer?.(_muzzle, _aim, distance, {
        speed: def.muzzleVelocity,
        colour: def === MOUNTS.autocannon ? 0xffb45a : 0xffd08a,
        length: def === MOUNTS.autocannon ? 16 : 11,
        width: def === MOUNTS.autocannon ? 0.10 : 0.06,
      });
    }

    const impactPoint = characterHit ? characterHit.point : (hit.hit ? hit.point : null);
    if (def.explosive > 0 && impactPoint) {
      ctx.vfx?.explosion?.(impactPoint, def.explosive);
      ctx.audio?.explosion?.(impactPoint, def.explosive * 0.4);
      // Splash: everything within the blast takes falloff damage.
      if (ctx.bots) {
        for (const bot of ctx.bots.bots) {
          if (!bot.alive) continue;
          const d = bot.position.distanceTo(impactPoint);
          if (d > def.explosive * 2.2) continue;
          ctx.bots.applyDamage(bot, def.damage * clamp01(1 - d / (def.explosive * 2.2)), {});
        }
      }
      for (const other of vehicles) {
        if (other === vehicle || !other.alive) continue;
        const d = other.position.distanceTo(impactPoint);
        if (d > def.explosive * 3) continue;
        damage(other, def.damage * 1.6 * clamp01(1 - d / (def.explosive * 3)), { point: impactPoint });
      }
    }

    if (characterHit) {
      ctx.vfx?.impact?.(characterHit.point, characterHit.normal, SURFACE.FLESH, 1);
      const killed = ctx.bots.applyDamage(characterHit.target, def.damage * characterHit.multiplier, {
        source: vehicle.driver === ctx.player ? "player" : vehicle,
      });
      if (killed && vehicle.seats[seatIndex] === ctx.player) {
        ctx.player.state.kills += 1;
        ctx.player.state.score += 100;
      }
    } else if (hit.hit) {
      ctx.vfx?.impact?.(hit.point, hit.normal, hit.surface, 1);
      const target = hit.collider && hit.collider.userData;
      if (target && target.spec && target.alive) {
        damage(target, def.damage * 1.35, { point: hit.point, cause: "bullet", source: vehicle });
      }
    }

    if (vehicle.turret) vehicle.turret.recoil = def === MOUNTS.autocannon ? 0.26 : 0.08;
    if (vehicle.seats[seatIndex] === ctx.player) {
      ctx.player.addRecoil(def.kick * 0.4 * DEG, (rng() - 0.5) * def.kick * DEG);
      input.rumble(0.4, 0.2, 60);
    }
    return true;
  }

  /* ============================================================
     effects
     ============================================================ */

  function emitWheelDust(vehicle, dt) {
    const vfx = ctx.vfx;
    if (!vfx || !vfx.spawnParticle) return;
    vehicle.dustTimer -= dt;
    if (vehicle.dustTimer > 0) return;
    vehicle.dustTimer = 0.045;

    for (const wheel of vehicle.wheels) {
      if (!wheel.grounded) continue;
      const grip = SURFACE_GRIP[wheel.surface] || SURFACE_GRIP[SURFACE.SAND];
      if (grip.dust < 0.2) continue;
      const intensity = clamp01(
        Math.abs(vehicle.forwardSpeed) / 14 + wheel.slip * 0.5 + Math.abs(wheel.slipAngle) * 2.4
      ) * grip.dust;
      if (intensity < 0.16) continue;
      if (rng() > intensity) continue;
      vfx.spawnParticle({
        position: wheel.contact.clone().addScaledVector(vehicle.forward, -0.25),
        velocity: new THREE.Vector3(
          rng.gauss() * 1.1 - vehicle.velocity.x * 0.14,
          rng.range(0.4, 1.9) * intensity,
          rng.gauss() * 1.1 - vehicle.velocity.z * 0.14
        ),
        colour: 0xc3ae8b,
        colourEnd: 0x8e8067,
        size: rng.range(0.20, 0.44) * (0.6 + intensity),
        sizeGrowth: 2.1,
        life: rng.range(0.9, 2.1),
        drag: 1.7,
        gravity: 0.5,
        // Particles are unlit billboards; at full opacity a dust puff
        // in a building's shadow is a solid cream blob stuck to the
        // frame. Half alpha lets the shaded ground read through it,
        // which is most of what makes it look like airborne dust.
        alpha: 0.5,
      });
    }

    // Tyre tracks, rate-limited by distance so a slow crawl does not
    // flood the decal ring.
    //
    // These used to be stamped with `addDecal`, which is the BULLET
    // HOLE - a 0.62m unlit ring under every moving vehicle, and the
    // pale blob that made a parked jeep look like it was hovering over
    // its own glow. `addTrack` is a real tread print, aligned to the
    // direction of travel and lit like the ground it is on.
    if (ctx.vfx.addTrack && Math.abs(vehicle.forwardSpeed) > 1.4) {
      vehicle.trackTimer += Math.abs(vehicle.forwardSpeed) * 0.045;
      if (vehicle.trackTimer > 0.55) {
        vehicle.trackTimer = 0;
        for (const wheel of vehicle.wheels) {
          if (!wheel.grounded || wheel.steer) continue;
          const grip = SURFACE_GRIP[wheel.surface] || SURFACE_GRIP[SURFACE.SAND];
          if (grip.dust < 0.4) continue;
          ctx.vfx.addTrack(wheel.contact, wheel.normal, -vehicle.yaw,
            vehicle.spec.wheel.width * 1.5);
        }
      }
    }
  }

  function emitRotorWash(vehicle, dt) {
    const vfx = ctx.vfx;
    if (!vfx || !vfx.spawnParticle) return;
    const agl = vehicle.position.y - terrain.heightAt(vehicle.position.x, vehicle.position.z);
    if (agl > 16 || vehicle.rotorRpm < 0.25) return;
    vehicle.dustTimer -= dt;
    if (vehicle.dustTimer > 0) return;
    vehicle.dustTimer = 0.035;

    const strength = vehicle.rotorRpm * clamp01(1 - agl / 16);
    const count = Math.round(2 + strength * 4);
    const radius = vehicle.spec.rotor.radius;
    for (let i = 0; i < count; i += 1) {
      const a = rng() * TAU;
      const d = radius * (0.35 + rng() * 0.85);
      const x = vehicle.position.x + Math.cos(a) * d;
      const z = vehicle.position.z + Math.sin(a) * d;
      const y = terrain.heightAt(x, z);
      const surface = surfaceAt(x, z);
      const grip = SURFACE_GRIP[surface] || SURFACE_GRIP[SURFACE.SAND];
      if (grip.dust < 0.2) continue;
      vfx.spawnParticle({
        position: new THREE.Vector3(x, y + 0.1, z),
        // Blown outward and up: a rotor wash is a ring expanding from
        // under the aircraft, not a puff at its centre.
        velocity: new THREE.Vector3(
          Math.cos(a) * (5 + strength * 12), rng.range(0.4, 2.2), Math.sin(a) * (5 + strength * 12)
        ),
        colour: 0xc6b190,
        colourEnd: 0x93856c,
        size: rng.range(0.7, 1.6) * (0.5 + strength),
        sizeGrowth: 2.9,
        life: rng.range(1.2, 2.6),
        drag: 1.5,
        gravity: 0.35,
        alpha: 0.55,
      });
    }
  }

  const _fireAt = new THREE.Vector3();

  function emitDamageSmoke(vehicle, dt) {
    const vfx = ctx.vfx;
    if (!vfx || !vfx.spawnParticle) return;
    if (vehicle.state === "intact") return;

    const wreck = vehicle.state === "wreck";
    const burning = wreck || vehicle.state === "burning";

    _fireAt.copy(vehicle.position);
    _fireAt.addScaledVector(vehicle.forward,
      vehicle.spec.kind === "air" ? 1.2 : -vehicle.spec.halfExtents[2] * 0.55);
    _fireAt.addScaledVector(vehicle.up, vehicle.spec.halfExtents[1] * 0.6);

    // The fire itself belongs to vfx.js: it owns the flame pool, the
    // soot column and the flicker light, and it meters its own emission
    // so this can be called unconditionally every frame.
    if (burning && vfx.fire) {
      const size = clamp01(vehicle.spec.halfExtents[2] / 3.2);
      vfx.fire(_fireAt, wreck ? 0.6 + size * 0.5 : 0.85 + size * 0.4, dt, vehicle.id);
    }

    // Light damage: an oil-smoke wisp only, on its own slow clock.
    vehicle.smokeTimer -= dt;
    if (vehicle.smokeTimer > 0) return;
    vehicle.smokeTimer = burning ? 0.5 : 0.28;
    if (burning) return;

    vfx.spawnParticle({
      position: _fireAt.clone().add(new THREE.Vector3(rng.gauss() * 0.3, 0, rng.gauss() * 0.3)),
      velocity: new THREE.Vector3(rng.gauss() * 0.5, rng.range(1.4, 3.6), rng.gauss() * 0.5)
        .addScaledVector(vehicle.velocity, 0.35),
      colour: 0x5c574f,
      size: rng.range(0.3, 0.7),
      sizeGrowth: 3.2,
      life: rng.range(1.8, 2.6),
      drag: 1.1,
      gravity: -0.9,
    });
  }

  /* ============================================================
     driver input
     ============================================================ */

  /** Stable hook for bots, the netcode and the test harness. */
  function setDriverInput(vehicle, patch) {
    if (!vehicle) return;
    Object.assign(vehicle.control, patch);
    vehicle.asleep = false;
    vehicle.sleepTimer = 0;
  }

  let lastPlayerYaw = 0;

  function readPlayerControls(vehicle, seatIndex, dt) {
    const player = ctx.player;
    const control = vehicle.control;

    if (seatIndex === 0) {
      if (vehicle.spec.kind === "ground") {
        control.throttle = clamp(-input.state.moveY, -1, 1);
        control.steer = clamp(input.state.moveX, -1, 1);
        // W and S are throttle and reverse; braking is what happens
        // when you ask for the opposite of the way you are going. That
        // is how every driving game the player has ever touched works.
        const opposing = control.throttle * vehicle.forwardSpeed < -0.4;
        control.brake = opposing ? Math.abs(control.throttle) : 0;
        if (opposing) control.throttle = 0;
        control.handbrake = input.isDown("jump") ? 1 : 0;
      } else {
        // Collective on space/crouch, cyclic on WASD, pedals on the
        // mouse. Reading the delta of the player's own yaw rather than
        // draining the look buffer keeps this working no matter what
        // else consumed the mouse this step.
        const yawDelta = angleDelta(lastPlayerYaw, player.state.yaw);
        // Collective holds where it is left, like a real lever. A stick
        // that springs back to zero means the pilot is tapping space to
        // stay airborne, which is exhausting and reads as broken.
        control.collective = clamp01(
          control.collective
          + (input.isDown("jump") ? 0.85 : 0) * dt
          - (input.isDown("crouch") ? 0.85 : 0) * dt
        );
        control.pitch = damp(control.pitch, clamp(input.state.moveY, -1, 1), 7, dt);
        control.roll = damp(control.roll, clamp(input.state.moveX, -1, 1), 7, dt);
        control.yaw = damp(control.yaw, clamp(yawDelta * 26, -1, 1), 9, dt);
      }
      if (input.wasPressed("flashlight")) control.lights = !control.lights;
    }

    control.fire = input.state.fire && Boolean(vehicle.mounts[seatIndex]);
    lastPlayerYaw = player.state.yaw;
  }

  /* ============================================================
     update
     ============================================================ */

  const _seatEye = new THREE.Vector3();

  /**
   * Put a destroyed vehicle back on its pad.
   *
   * The panels are un-beaten by restoring the pristine vertex buffer
   * captured at build time, rather than by rebuilding the model. A
   * rebuild would allocate a fresh set of merged geometries on every
   * respawn, and over a twenty-minute round that is a slow leak of
   * several megabytes of GPU memory for no visible gain.
   */
  function respawnVehicle(vehicle) {
    vehicle.position.copy(vehicle.spawnPoint);
    vehicle.quaternion.setFromEuler(new THREE.Euler(0, vehicle.spawnYaw, 0, "YXZ"));
    vehicle.velocity.set(0, 0, 0);
    vehicle.angularVelocity.set(0, 0, 0);
    vehicle.health = vehicle.maxHealth;
    vehicle.alive = true;
    vehicle.state = "intact";
    vehicle.gear = 1;
    vehicle.rpm = vehicle.spec.engine ? vehicle.spec.engine.idle : 0;
    vehicle.rotorRpm = 0;
    vehicle.components = { engine: 1, transmission: 1, rotor: 1, tailRotor: 1 };
    vehicle.control.throttle = 0;
    vehicle.control.steer = 0;
    vehicle.control.collective = 0;
    vehicle.control.handbrake = 1;

    if (vehicle.pristine) {
      const mesh = vehicle.meshes.paint;
      mesh.geometry.attributes.position.array.set(vehicle.pristine);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    const base = vehicle.baseLook;
    vehicle.materials.paint.color.copy(base.paint);
    vehicle.materials.paint.roughness = base.paintRoughness;
    vehicle.materials.paint.metalness = base.paintMetalness;
    vehicle.materials.trim.color.copy(base.trim);
    vehicle.materials.trim.roughness = base.trimRoughness;
    vehicle.materials.trim.metalness = base.trimMetalness;
    if (vehicle.meshes.glass) vehicle.meshes.glass.visible = true;
    if (vehicle.meshes.lens) vehicle.meshes.lens.visible = true;

    for (const wheel of vehicle.wheels) {
      wheel.health = 1;
      wheel.omega = 0;
      wheel.mesh.scale.set(1, 1, 1);
    }
    for (const mount of vehicle.mounts) {
      if (!mount) continue;
      mount.ammo = mount.def.magazine;
      mount.reserve = mount.def.magazine * 4;
      mount.heat = 0;
    }
    if (vehicle.turret) {
      vehicle.turret.yaw = 0;
      vehicle.turret.pitch = 0;
      vehicle.turret.node.rotation.set(0, 0, 0);
    }
    if (vehicle.rotor) {
      vehicle.rotor.head.rotation.z = 0;
      vehicle.rotor.disc.visible = true;
      vehicle.rotor.tailDisc.visible = true;
    }

    syncTransform(vehicle);
    vehicle.collider.active = true;
    physics.rebuildGrid();
    ctx.bus.emit("vehicle:respawn", { vehicle });
  }

  function fixedUpdate(dt) {
    const player = ctx.player;

    for (const vehicle of vehicles) {
      /* ---- wreck lifecycle ---- */
      if (!vehicle.alive) {
        vehicle.wreckTimer -= dt;
        // A wreck is cover and a landmark, so it stays and keeps its
        // collider. Only once it has burned out does the base issue a
        // replacement.
        if (vehicle.wreckTimer > 0) {
          if (vehicle.spec.kind === "ground") simulateGround(vehicle, dt);
          else simulateAir(vehicle, dt);
          syncTransform(vehicle);
          continue;
        }
        vehicle.respawnTimer -= dt;
        if (vehicle.body.visible) {
          vehicle.body.visible = false;
          vehicle.collider.active = false;
          vehicle.respawnTimer = 12;
          physics.rebuildGrid();
        }
        if (vehicle.respawnTimer <= 0) {
          respawnVehicle(vehicle);
          vehicle.body.visible = true;
        }
        continue;
      }

      /* ---- occupant control ---- */
      const driverSeat = vehicle.seats[0];
      if (driverSeat === player && player.state.alive) {
        readPlayerControls(vehicle, 0, dt);
        if (input.wasPressed("exitVehicle")) {
          exit(vehicle, player);
          continue;
        }
      } else if (!vehicle.driver) {
        vehicle.control.throttle = 0;
        vehicle.control.steer = 0;
        vehicle.control.handbrake = 1;
        vehicle.control.collective = 0;
        vehicle.control.fire = false;
      }
      // A gunner riding in someone else's vehicle still gets to shoot.
      for (let i = 1; i < vehicle.seats.length; i += 1) {
        if (vehicle.seats[i] === player && player.state.alive) {
          readPlayerControls(vehicle, i, dt);
          if (input.wasPressed("exitVehicle")) exit(vehicle, player);
        }
      }

      /* ---- sleep ----
         Six of the eight vehicles on the map are parked at any moment.
         Simulating six wheels of suspension for each of them at 120Hz
         is a millisecond a frame spent on nothing anyone can see. */
      const idle = !vehicle.occupants.length
        && vehicle.speed < 0.14
        && vehicle.angularVelocity.lengthSq() < 0.01
        && vehicle.state === "intact";
      if (idle) {
        vehicle.sleepTimer += dt;
        if (vehicle.sleepTimer > 1.4) vehicle.asleep = true;
      } else {
        vehicle.sleepTimer = 0;
        vehicle.asleep = false;
      }

      // Only vehicles someone is in get per-wheel raycasts against
      // static geometry; parked ones ride the terrain sampler alone.
      vehicle.detailedContacts = vehicle.occupants.length > 0
        || vehicle.position.distanceToSquared(player ? player.position : vehicle.position) < 6400;

      if (!vehicle.asleep) {
        if (vehicle.spec.kind === "ground") {
          simulateGround(vehicle, dt);
          crushCheck(vehicle, dt);
        } else {
          simulateAir(vehicle, dt);
        }
        syncTransform(vehicle);
      }

      /* ---- turret ---- */
      updateTurret(vehicle, dt);

      /* ---- mounted weapons ---- */
      for (let i = 0; i < vehicle.mounts.length; i += 1) {
        const mount = vehicle.mounts[i];
        if (!mount) continue;
        mount.cooldown = Math.max(0, mount.cooldown - dt);
        mount.heat = Math.max(0, mount.heat - dt * 0.42);
        if (mount.reloading > 0) {
          mount.reloading -= dt;
          if (mount.reloading <= 0) {
            const taken = Math.min(mount.def.magazine, mount.reserve);
            mount.reserve -= taken;
            mount.ammo = taken;
          }
          continue;
        }
        const gunner = vehicle.seats[i];
        if (!gunner) continue;
        const wantsFire = gunner === player ? vehicle.control.fire : gunner.vehicleFire;
        if (!wantsFire) continue;
        const direction = gunner === player
          ? player.aimDirection
          : (gunner.aimDirection || vehicle.forward);
        fireMount(vehicle, i, direction);
      }

      /* ---- carry occupants ---- */
      for (let i = 0; i < vehicle.seats.length; i += 1) {
        const occupant = vehicle.seats[i];
        if (!occupant) continue;
        seatWorldPosition(vehicle, i, _seatEye);
        if (occupant === player) {
          // player.position is the soldier's feet and the camera sits
          // eyeHeight above it, so aim the seat at the eye point.
          player.teleport(_seatEye.x, _seatEye.y - player.state.eyeHeight, _seatEye.z);
          player.velocity.copy(vehicle.velocity);
          player.state.grounded = true;
        } else {
          if (occupant.position) occupant.position.copy(_seatEye);
          if (occupant.velocity) occupant.velocity.copy(vehicle.velocity);
        }
      }

      world.reportPresence(vehicle.team, vehicle.position);
    }

    // Vehicles are moving colliders, so the broadphase is stale the
    // moment they do. Rebuild once per step, not once per vehicle.
    physics.rebuildGrid();

    /* ---- entering ---- */
    if (player && player.state.alive && !player.state.inVehicle && input.wasPressed("use")) {
      const candidate = nearestUsable(player.position, player.state.team);
      if (candidate) enter(candidate, player);
    }
  }

  const _colliderOffset = new THREE.Vector3();

  function syncTransform(vehicle) {
    vehicle.body.position.copy(vehicle.position);
    vehicle.body.quaternion.copy(vehicle.quaternion);
    vehicle.collider.center.copy(vehicle.position);
    if (vehicle.spec.colliderOffset) {
      _colliderOffset.fromArray(vehicle.spec.colliderOffset)
        .applyQuaternion(vehicle.quaternion);
      vehicle.collider.center.add(_colliderOffset);
    }
    vehicle.collider.quaternion.copy(vehicle.quaternion);
    vehicle.collider.invQuaternion.copy(vehicle.quaternion).invert();
    // The broadphase AABB is derived from the OBB, so it has to move
    // with it or a fast vehicle stops being hittable.
    const e = vehicle.collider.halfExtents;
    const reach = Math.max(e.x, e.y, e.z);
    vehicle.collider.min.set(
      vehicle.collider.center.x - reach,
      vehicle.collider.center.y - reach,
      vehicle.collider.center.z - reach
    );
    vehicle.collider.max.set(
      vehicle.collider.center.x + reach,
      vehicle.collider.center.y + reach,
      vehicle.collider.center.z + reach
    );
  }

  const _turretAim = new THREE.Vector3();

  function updateTurret(vehicle, dt) {
    const turret = vehicle.turret;
    if (!turret) return;
    const gunnerSeat = vehicle.spec.seats.findIndex((s) => s.weapon);
    const gunner = gunnerSeat >= 0 ? vehicle.seats[gunnerSeat] : null;
    const def = gunnerSeat >= 0 ? MOUNTS[vehicle.spec.seats[gunnerSeat].weapon] : null;

    if (gunner && def && vehicle.alive) {
      const aim = gunner === ctx.player
        ? ctx.player.aimDirection
        : (gunner.aimDirection || vehicle.forward);
      // Convert the gunner's world aim into the hull's frame, so the
      // turret slews relative to a hull that is itself turning.
      _turretAim.copy(aim).applyQuaternion(_inv.copy(vehicle.quaternion).invert());
      const wantYaw = clamp(Math.atan2(-_turretAim.x, -_turretAim.z), -def.yawLimit, def.yawLimit);
      const wantPitch = clamp(Math.asin(clamp(_turretAim.y, -1, 1)), def.pitchLimit[0], def.pitchLimit[1]);
      // Traverse rate is the whole character of a turret: an autocannon
      // that snaps to the crosshair is a mouse cursor, not a machine.
      const step = def.traverse * dt;
      turret.yaw += clamp(angleDelta(turret.yaw, wantYaw), -step, step);
      turret.pitch += clamp(wantPitch - turret.pitch, -step, step);
    }

    turret.recoil = damp(turret.recoil, 0, 11, dt);
    turret.node.rotation.set(-turret.pitch, turret.yaw, 0, "YXZ");
    // Recoil pushes the whole mount back along its own axis, so a
    // 25mm burst visibly rocks the turret rather than the shells
    // simply appearing at the muzzle.
    turret.node.position.copy(turret.base);
    turret.node.position.z += Math.cos(turret.yaw) * turret.recoil;
    turret.node.position.x += Math.sin(turret.yaw) * turret.recoil;
  }

  /* ------------------------------ frame ------------------------------ */

  function update(dt) {
    const player = ctx.player;
    const daylight = ctx.sky ? ctx.sky.daylight : 1;
    let headlightCursor = 0;

    for (const vehicle of vehicles) {
      if (!vehicle.body.visible) continue;

      /* ---- rotors ---- */
      if (vehicle.rotor) {
        const rotor = vehicle.rotor;
        const rate = vehicle.rotorRpm * 34;
        rotor.angle = (rotor.angle + rate * dt) % TAU;
        rotor.tailAngle = (rotor.tailAngle + rate * 4.6 * dt) % TAU;
        rotor.head.rotation.y = rotor.angle;
        rotor.tail.rotation.x = rotor.tailAngle;
        // Crossfade blades to a disc as it spools up: four boxes at
        // 300rpm strobe into a mess at any frame rate.
        const blur = smoothstep(clamp01((vehicle.rotorRpm - 0.22) / 0.30));
        rotor.head.visible = blur < 0.98;
        rotor.discMat.opacity = blur * 0.30;
        rotor.disc.visible = blur > 0.02 && vehicle.alive;
        rotor.tailDiscMat.opacity = blur * 0.34;
        rotor.tailDisc.visible = blur > 0.02 && vehicle.alive;
        rotor.tail.visible = blur < 0.98;
        // The disc coning under load, which is what sells the lift.
        rotor.disc.rotation.x = vehicle.control.collective * 0.03;
      }

      if (vehicle.asleep || !vehicle.alive) {
        // A burning vehicle that has come to rest goes to sleep, and a
        // fire that stops the moment the wreck stops rolling is a bug
        // the player watches happen.
        if (!vehicle.alive || vehicle.state !== "intact") emitDamageSmoke(vehicle, dt);
        continue;
      }

      if (vehicle.spec.kind === "ground") emitWheelDust(vehicle, dt);
      else emitRotorWash(vehicle, dt);
      emitDamageSmoke(vehicle, dt);

      /* ---- lights ---- */
      const wantLights = vehicle.control.lights || (daylight < 0.34 && vehicle.occupants.length > 0);
      if (wantLights !== vehicle.lightsOn) {
        vehicle.lightsOn = wantLights;
        const lens = vehicle.materials.lens;
        lens.emissive.setHex(wantLights ? 0xffe9c0 : 0x000000);
        lens.emissiveIntensity = wantLights ? 1.6 : 0;
      }
      // Only the vehicle the player is in gets real spotlights; two of
      // them is the entire dynamic-light budget a scene like this has.
      if (wantLights && vehicle.occupants.includes(player) && headlightCursor < headlights.length
        && vehicle.spec.kind === "ground") {
        for (const side of [-1, 1]) {
          const light = headlights[headlightCursor];
          if (!light) break;
          headlightCursor += 1;
          _v3.set(side * 0.74, 0.16, -vehicle.spec.halfExtents[2])
            .applyQuaternion(vehicle.quaternion).add(vehicle.position);
          light.position.copy(_v3);
          light.target.position.copy(_v3)
            .addScaledVector(vehicle.forward, 34)
            .addScaledVector(vehicle.up, -6);
          light.target.updateMatrixWorld();
          light.intensity = 260;
        }
      }
    }
    for (let i = headlightCursor; i < headlights.length; i += 1) headlights[i].intensity = 0;
  }

  /* ============================================================
     api
     ============================================================ */

  return {
    TYPES,
    MOUNTS,
    vehicles,
    group,

    spawn,
    enter,
    exit,
    damage,
    nearestUsable,
    setDriverInput,
    fireMount,
    surfaceAt,

    /** Seat metadata, for the HUD and the AI. */
    seatsOf(vehicle) {
      return vehicle.spec.seats.map((seat, i) => ({
        index: i, role: seat.role, weapon: seat.weapon,
        occupied: vehicle.seats[i] !== null,
      }));
    },

    /** Everything an engine-sound module needs, pulled rather than
     *  pushed so audio.js can sample it at whatever rate it likes. */
    audioState() {
      return vehicles.filter((v) => v.alive && !v.asleep).map((v) => ({
        id: v.id,
        type: v.type,
        position: v.position,
        kind: v.spec.kind,
        rpm: v.rpm,
        rpmNorm: v.spec.engine ? clamp01(v.rpm / v.spec.engine.redline) : 0,
        load: v.engineLoad,
        gear: v.gear,
        speed: v.speed,
        slip: v.wheelSlip,
        rotor: v.rotorRpm,
        occupied: v.occupants.length > 0,
        local: v.occupants.includes(ctx.player),
      }));
    },

    setLights(vehicle, on) {
      if (vehicle) vehicle.control.lights = Boolean(on);
    },

    fixedUpdate,
    update,

    report() {
      const byType = {};
      for (const v of vehicles) {
        byType[v.type] = (byType[v.type] || 0) + 1;
      }
      const driven = vehicles.find((v) => v.occupants.includes(ctx.player));
      return {
        total: vehicles.length,
        alive: vehicles.filter((v) => v.alive).length,
        awake: vehicles.filter((v) => !v.asleep && v.alive).length,
        occupied: vehicles.filter((v) => v.occupants.length > 0).length,
        wrecks: vehicles.filter((v) => !v.alive).length,
        byType,
        driving: driven
          ? {
            type: driven.type,
            kmh: Number((driven.speed * 3.6).toFixed(1)),
            gear: driven.gear,
            rpm: Math.round(driven.rpm),
            surface: driven.surface,
            wheelsDown: driven.groundedWheels,
          }
          : null,
      };
    },

    dispose() {
      render.scene.remove(group);
      for (const material of ownedMaterials) material.dispose();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const texture of ownedTextures) texture.dispose();
      ownedMaterials.length = 0;
      ownedGeometries.length = 0;
      ownedTextures.length = 0;
    },
  };
}
