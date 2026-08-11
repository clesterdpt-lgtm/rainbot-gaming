/* ============================================================
   BLACKSAND - visual effects

   Tracers, muzzle flashes, impact debris, smoke, explosions, decals
   and shell casings. Everything is pooled and drawn from a small
   number of shared instanced meshes - a shooter emits hundreds of
   effects a second and cannot allocate for any of them, in either the
   spawn path or the update path.

   Two structural decisions worth knowing before editing this file:

   1. THERE ARE TWO PARTICLE MESHES, not one. Smoke and dust must blend
      normally or they glow against bright sand; sparks and fire must
      blend additively or they read as grey confetti. One mesh cannot do
      both, and the version that tried faded its dust to BLACK rather
      than to transparent, because instance colour scales RGB and the
      only alpha available came from the sprite.

   2. INSTANCES CARRY THEIR OWN ALPHA. `instanceColor` is three's only
      built-in per-instance channel and it is RGB. A one-float custom
      attribute plus a two-line shader patch is what lets a normally
      blended particle actually fade out.
   ============================================================ */

import { makePool, makeRng, clamp, clamp01, lerp, smoothstep } from "./core.js";
import { SURFACE } from "./physics.js";

/**
 * Per-surface impact response.
 *
 * `dust` is a slow, soft plume; `spall` is the fast grey cone a hard
 * surface throws back along the incoming ray; `sparks` are hot and
 * gravity-bound; `debris` are solid tumbling chips. The mix is what
 * makes a surface identifiable from the impact alone, which is how a
 * player learns what is cover and what is concealment.
 */
const SURFACE_FX = {
  [SURFACE.SAND]: {
    dust: 1.15, dustColour: 0xd8c3a0, dustLife: 1.5, dustRise: 1.0,
    spall: 0.35, sparks: 0, sparkHeat: 0,
    debris: 3, debrisColour: 0xb49a72, debrisScale: 0.9, debrisShape: "chip",
    decal: "hole", decalSize: [0.15, 0.26], decalColour: 0xb8a58a, sound: "sand",
  },
  [SURFACE.DIRT]: {
    dust: 1.0, dustColour: 0x9c8261, dustLife: 1.4, dustRise: 0.9,
    spall: 0.4, sparks: 0, sparkHeat: 0,
    debris: 4, debrisColour: 0x6f5a3f, debrisScale: 1.0, debrisShape: "chip",
    decal: "hole", decalSize: [0.14, 0.24], decalColour: 0x8b755a, sound: "dirt",
  },
  [SURFACE.ROCK]: {
    dust: 0.45, dustColour: 0xbdb6a8, dustLife: 0.9, dustRise: 0.5,
    spall: 1.0, sparks: 5, sparkHeat: 0.85,
    debris: 7, debrisColour: 0x8c877d, debrisScale: 1.0, debrisShape: "chip",
    decal: "hole", decalSize: [0.085, 0.15], decalColour: 0xa9a49a, sound: "rock",
  },
  [SURFACE.CONCRETE]: {
    dust: 0.75, dustColour: 0xd6d0c4, dustLife: 1.2, dustRise: 0.7,
    spall: 1.0, sparks: 3, sparkHeat: 0.7,
    debris: 6, debrisColour: 0xa5a096, debrisScale: 0.9, debrisShape: "chip",
    decal: "hole", decalSize: [0.08, 0.145], decalColour: 0xbdb8ad, sound: "concrete",
  },
  [SURFACE.METAL]: {
    dust: 0.08, dustColour: 0x9a958c, dustLife: 0.5, dustRise: 0.3,
    spall: 0.25, sparks: 18, sparkHeat: 1.0,
    debris: 4, debrisColour: 0x6d6f72, debrisScale: 0.55, debrisShape: "flake",
    decal: "hole", decalSize: [0.05, 0.09], decalColour: 0x9fa0a2, sound: "metal",
  },
  [SURFACE.WOOD]: {
    dust: 0.30, dustColour: 0xb28f5f, dustLife: 0.9, dustRise: 0.5,
    spall: 0.5, sparks: 0, sparkHeat: 0,
    debris: 8, debrisColour: 0x7e5c31, debrisScale: 1.1, debrisShape: "splinter",
    decal: "hole", decalSize: [0.07, 0.13], decalColour: 0x7a5c36, sound: "wood",
  },
  [SURFACE.GLASS]: {
    dust: 0.05, dustColour: 0xdfeef5, dustLife: 0.5, dustRise: 0.2,
    spall: 0.2, sparks: 2, sparkHeat: 0.4,
    debris: 12, debrisColour: 0xcfe4ee, debrisScale: 0.6, debrisShape: "flake",
    decal: null, decalSize: [0, 0], decalColour: 0xffffff, sound: "glass",
  },
  [SURFACE.FLESH]: {
    dust: 0, dustColour: 0x8a1f16, dustLife: 0.6, dustRise: 0.2,
    spall: 0, sparks: 0, sparkHeat: 0,
    debris: 0, debrisColour: 0x6a140d, debrisScale: 0.4, debrisShape: "flake",
    decal: null, decalSize: [0, 0], decalColour: 0xffffff, sound: "flesh",
  },
  [SURFACE.WATER]: {
    dust: 0.5, dustColour: 0xcfe0e8, dustLife: 0.7, dustRise: 1.6,
    spall: 0.9, sparks: 0, sparkHeat: 0,
    debris: 0, debrisColour: 0x9fc4d6, debrisScale: 0.5, debrisShape: "flake",
    decal: null, decalSize: [0, 0], decalColour: 0xffffff, sound: "water",
  },
  [SURFACE.FOLIAGE]: {
    dust: 0.1, dustColour: 0x7c8a48, dustLife: 0.7, dustRise: 0.3,
    spall: 0.15, sparks: 0, sparkHeat: 0,
    debris: 5, debrisColour: 0x5d6a30, debrisScale: 0.7, debrisShape: "flake",
    decal: null, decalSize: [0, 0], decalColour: 0xffffff, sound: "foliage",
  },
};

/** Per-weapon muzzle signature. A carbine's brake throws a wide flat
 *  star, a sniper's long barrel burns most of the powder before the
 *  bullet leaves and produces almost nothing, and an LMG lights the
 *  room. Getting this uniform is how every gun ends up feeling the
 *  same regardless of what the damage numbers say. */
const MUZZLE = {
  rifle: { flare: 0.30, cone: 0.24, petals: 5, colour: 0xffd7a2, light: 30, smoke: 2 },
  carbine: { flare: 0.42, cone: 0.32, petals: 6, colour: 0xffb968, light: 44, smoke: 3 },
  smg: { flare: 0.23, cone: 0.15, petals: 4, colour: 0xffe2b6, light: 22, smoke: 1 },
  lmg: { flare: 0.40, cone: 0.30, petals: 6, colour: 0xffcb8a, light: 42, smoke: 3 },
  marksman: { flare: 0.26, cone: 0.40, petals: 3, colour: 0xfff2d0, light: 36, smoke: 4 },
  pistol: { flare: 0.19, cone: 0.12, petals: 4, colour: 0xffdca6, light: 16, smoke: 1 },
  default: { flare: 0.30, cone: 0.22, petals: 5, colour: 0xffd39a, light: 28, smoke: 2 },
};

export async function createVfx(ctx) {
  const { THREE, render, settings, textures } = ctx;
  const q = settings.q;
  const rng = makeRng(ctx.seed ^ 0xfeed);

  const group = new THREE.Group();
  group.name = "vfx";
  group.frustumCulled = false;
  render.scene.add(group);

  /* --------------------------- shader patch --------------------------- */

  /**
   * Give an instanced material a per-instance alpha.
   *
   * three has exactly one built-in per-instance channel, `instanceColor`,
   * and it is RGB. Without this a normally-blended particle can only
   * fade by scaling its colour, which fades it to black rather than to
   * nothing - fine on an additive spark, catastrophic on dust.
   */
  function withInstanceAlpha(material) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute float instanceAlpha;\nvarying float vAlphaI;\n"
        + shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n\tvAlphaI = instanceAlpha;"
        );
      shader.fragmentShader = "varying float vAlphaI;\n"
        + shader.fragmentShader.replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n\tdiffuseColor.a *= vAlphaI;"
        );
    };
    // Without a distinct cache key three hands back the unpatched
    // program it already compiled for an identical material.
    material.customProgramCacheKey = () => "bs-instance-alpha";
    return material;
  }

  function instancedQuad(material, count) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("instanceAlpha",
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.userData.qaOpaque = false;
    group.add(mesh);
    return mesh;
  }

  /* ---------------------------- scratch ---------------------------- */

  // Everything below writes into these. The update loop runs over a
  // couple of thousand instances a frame and must not allocate.
  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _axisX = new THREE.Vector3();
  const _axisY = new THREE.Vector3();
  const _axisZ = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _colour = new THREE.Color();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _scale = new THREE.Vector3();

  /** Write a matrix from three basis vectors and a translation without
   *  going through a quaternion. */
  function composeBasis(matrix, px, py, pz, x, y, z, sx, sy, sz) {
    const e = matrix.elements;
    e[0] = x.x * sx; e[1] = x.y * sx; e[2] = x.z * sx; e[3] = 0;
    e[4] = y.x * sy; e[5] = y.y * sy; e[6] = y.z * sy; e[7] = 0;
    e[8] = z.x * sz; e[9] = z.y * sz; e[10] = z.z * sz; e[11] = 0;
    e[12] = px; e[13] = py; e[14] = pz; e[15] = 1;
  }

  /** Position + Euler + scale, for the solid pools (debris, casings)
   *  which tumble rather than billboard. */
  function composeTRS(matrix, position, angle, scale, fade) {
    _euler.set(angle.x, angle.y, angle.z, "XYZ");
    _quat.setFromEuler(_euler);
    _scale.set(scale.x * fade, scale.y * fade, scale.z * fade);
    matrix.compose(position, _quat, _scale);
  }

  /* ---------------------------- tracers ---------------------------- */

  /**
   * Tracers are stretched, camera-facing quads rather than lines.
   * gl.LINES has no width control across platforms and a 1px line at
   * 200m is invisible; a quad scaled by velocity reads as a streak the
   * way a real tracer does on camera.
   *
   * The map is the soft radial spark, not a hard rectangle: a tracer
   * with crisp ends reads as a floating stick.
   */
  const TRACER_BUDGET = q.tracerBudget;

  /**
   * The tracer's own sprite, rather than the radial spark.
   *
   * A radial gradient stretched along the travel axis produces a
   * symmetrical lozenge - bright in the middle, identical at both ends.
   * A real tracer is a burning tail behind a bright head, and the
   * asymmetry is the entire read: it tells the eye which way the round
   * is going, at a glance, from any angle.
   */
  function buildTracerSprite(w = 32, h = 128) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    const image = g.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      // Row 0 is the top of the canvas, which a flipped CanvasTexture
      // puts at uv.v = 1 - the +Y end of the quad, which the update
      // loop aligns with the direction of travel. So row 0 is the head.
      const v = y / (h - 1);
      const along = Math.exp(-v * 3.1);
      const width = 0.5 + v * 0.9;
      for (let x = 0; x < w; x += 1) {
        const u = (x / (w - 1) - 0.5) * 2;
        const across = Math.exp(-(u * u) / (0.10 * width * width));
        const a = clamp01(across * along);
        const hot = clamp01(across * (1 - v * 5.5));
        const i = (y * w + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 118 + hot * 130;
        image.data[i + 2] = 34 + hot * 190;
        image.data[i + 3] = a * 255;
      }
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = render.anisotropy;
    return texture;
  }

  const tracerSprite = buildTracerSprite();
  const tracerMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: tracerSprite,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }));
  const tracerMesh = instancedQuad(tracerMaterial, TRACER_BUDGET);

  const tracers = makePool(() => ({
    active: false,
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    speed: 900,
    travelled: 0,
    maxDistance: 400,
    length: 11,
    width: 0.035,
    colour: new THREE.Color(0xffc65c),
    life: 0,
  }), TRACER_BUDGET, (t) => { t.active = false; });

  /* -------------------------- particles -------------------------- */

  const PARTICLE_BUDGET = q.particleBudget;
  const SMOKE_BUDGET = Math.round(PARTICLE_BUDGET * 0.62);
  const SPARK_BUDGET = PARTICLE_BUDGET - SMOKE_BUDGET;

  const smokeMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: textures.sprites.smoke,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    side: THREE.DoubleSide,
  }));
  const sparkMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: textures.sprites.spark,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }));

  const smokeMesh = instancedQuad(smokeMaterial, SMOKE_BUDGET);
  const sparkMesh = instancedQuad(sparkMaterial, SPARK_BUDGET);

  function makeParticlePool(capacity) {
    return makePool(() => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colour: new THREE.Color(),
      colourEnd: new THREE.Color(),
      hasColourEnd: false,
      size: 1,
      sizeGrowth: 0,
      stretch: 1,
      life: 0,
      maxLife: 1,
      drag: 1.4,
      gravity: 0,
      fadeIn: 0.08,
      alpha: 1,
      rotation: 0,
      spin: 0,
      wobble: 0,
      /** Sticks to the ground instead of falling through it. Dust from a
       *  ground impact that sinks into the sand looks like a bug. */
      floor: -Infinity,
    }), capacity, (p) => { p.active = false; });
  }

  const smoke = makeParticlePool(SMOKE_BUDGET);
  const sparks = makeParticlePool(SPARK_BUDGET);

  /* ---------------------------- debris ---------------------------- */

  /**
   * Solid tumbling chips. Billboards cannot sell a piece of rock coming
   * off a wall - the give-away is that it never turns. These are lit by
   * the world sun like everything else, which is what makes them read as
   * matter rather than as sprites.
   */
  const DEBRIS_BUDGET = Math.max(24, Math.round(PARTICLE_BUDGET * 0.14));
  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.92, metalness: 0.0, flatShading: true,
  });
  const debrisGeometry = new THREE.TetrahedronGeometry(0.5, 0);
  const debrisMesh = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, DEBRIS_BUDGET);
  debrisMesh.frustumCulled = false;
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(DEBRIS_BUDGET * 3), 3);
  debrisMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.count = 0;
  debrisMesh.castShadow = false;
  debrisMesh.userData.qaOpaque = false;
  group.add(debrisMesh);

  const debris = makePool(() => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    angle: new THREE.Vector3(),
    scale: new THREE.Vector3(1, 1, 1),
    colour: new THREE.Color(),
    life: 0,
    maxLife: 1.6,
    bounces: 0,
  }), DEBRIS_BUDGET, (d) => { d.active = false; });

  /* --------------------------- shell casings --------------------------- */

  /**
   * Casings get their own pool rather than sharing debris because they
   * bounce, land, and make a noise - and because a brass case tumbling
   * out of the ejection port at eye level is one of the highest-value
   * details in a first-person shooter for how little it costs.
   */
  const CASING_BUDGET = q.particleBudget >= 900 ? 48 : 20;
  const casingMaterial = new THREE.MeshStandardMaterial({
    color: 0xb08a3c, roughness: 0.28, metalness: 1.0,
  });
  const casingGeometry = new THREE.CylinderGeometry(0.0044, 0.0050, 0.023, 6, 1);
  const casingMesh = new THREE.InstancedMesh(casingGeometry, casingMaterial, CASING_BUDGET);
  casingMesh.frustumCulled = false;
  casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  casingMesh.count = 0;
  casingMesh.userData.qaOpaque = false;
  group.add(casingMesh);

  const casings = makePool(() => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    angle: new THREE.Vector3(),
    scale: 1,
    life: 0,
    maxLife: 4.5,
    bounces: 0,
    resting: false,
  }), CASING_BUDGET, (c) => { c.active = false; });

  /* ---------------------------- decals ---------------------------- */

  /**
   * Impact decals.
   *
   * The version this replaces was an UNLIT ring sprite: one shape, one
   * effective size, a pale halo and no core. Four things were wrong
   * with it and all four are visible from two metres:
   *
   *   - Unlit. A MeshBasicMaterial decal keeps its own brightness when
   *     the wall behind it goes into shadow, so forty holes on a shaded
   *     wall glowed like stickers. Decals are lit here, by the same sun
   *     as the wall, which is the single biggest change in this file.
   *   - Radially symmetric. The placement code already rolls each decal
   *     randomly about its normal, but rolling a symmetric ring does
   *     nothing. The atlas below is deliberately lopsided.
   *   - No relief. A normal map turns the crater into something the sun
   *     rakes across; without it a bullet hole is a painted circle.
   *   - Floating. 12mm of normal offset is a visible gap at contact
   *     range. 2.5mm plus a polygon offset is enough to beat z-fighting
   *     and small enough to read as damage to the surface itself.
   */
  const DECAL_BUDGET = q.decalBudget;
  const SCORCH_BUDGET = Math.max(8, Math.round(DECAL_BUDGET * 0.2));
  const TRACK_BUDGET = Math.max(12, Math.round(DECAL_BUDGET * 0.35));

  /** 2x2 atlas of impact craters: albedo in one canvas, height (turned
   *  into a normal map) in another. Four variants is enough that, with
   *  a random roll and a 2:1 size range, a wall of forty holes has no
   *  visible repeat. */
  function buildImpactAtlas(size = 512) {
    const half = size / 2;
    const albedo = document.createElement("canvas");
    albedo.width = size; albedo.height = size;
    const ga = albedo.getContext("2d");
    ga.clearRect(0, 0, size, size);

    // Height is accumulated in a plain array so the normal map can be
    // differentiated from it - deriving a normal from the albedo would
    // put a bump wherever there is a dark speck.
    const height = new Float32Array(size * size);
    const arng = makeRng(ctx.seed ^ 0x1c7a);

    const stampHeight = (cx, cy, radius, amount, jitter) => {
      const r0 = Math.max(0, Math.floor(cx - radius));
      const r1 = Math.min(size - 1, Math.ceil(cx + radius));
      const c0 = Math.max(0, Math.floor(cy - radius));
      const c1 = Math.min(size - 1, Math.ceil(cy + radius));
      for (let y = c0; y <= c1; y += 1) {
        for (let x = r0; x <= r1; x += 1) {
          const d = Math.hypot(x - cx, y - cy) / radius;
          if (d > 1) continue;
          const falloff = (1 - d * d) ** 1.5;
          height[y * size + x] += amount * falloff * (1 + jitter * (arng() - 0.5));
        }
      }
    };

    for (let tile = 0; tile < 4; tile += 1) {
      const ox = (tile % 2) * half;
      const oy = Math.floor(tile / 2) * half;
      const cx = ox + half * 0.5;
      const cy = oy + half * 0.5;
      const coreR = half * (0.085 + arng() * 0.035);

      ga.save();
      ga.beginPath();
      ga.rect(ox, oy, half, half);
      ga.clip();

      // Spall: chalky dust thrown out of the hole, biased to one side
      // so the decal has an orientation worth rolling.
      const bias = arng() * Math.PI * 2;
      for (let i = 0; i < 30; i += 1) {
        const a = bias + (arng() - 0.5) * 4.2;
        const d = coreR * (1.1 + arng() * arng() * 4.4);
        const r = half * (0.035 + arng() * 0.075);
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const alpha = 0.34 * (1 - d / (coreR * 5.5));
        if (alpha <= 0.01) continue;
        const grad = ga.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(216,210,196,${alpha.toFixed(3)})`);
        grad.addColorStop(1, "rgba(216,210,196,0)");
        ga.fillStyle = grad;
        ga.beginPath(); ga.arc(x, y, r, 0, Math.PI * 2); ga.fill();
        stampHeight(x, y, r * 0.7, 0.10 * alpha, 0.8);
      }

      // Cracks. A few short radial fractures, thinning outwards.
      ga.lineCap = "round";
      const cracks = 3 + Math.floor(arng() * 4);
      for (let i = 0; i < cracks; i += 1) {
        let a = arng() * Math.PI * 2;
        let x = cx + Math.cos(a) * coreR * 0.9;
        let y = cy + Math.sin(a) * coreR * 0.9;
        const steps = 3 + Math.floor(arng() * 4);
        for (let s = 0; s < steps; s += 1) {
          a += (arng() - 0.5) * 0.9;
          const len = half * (0.03 + arng() * 0.05);
          const nx = x + Math.cos(a) * len;
          const ny = y + Math.sin(a) * len;
          ga.strokeStyle = `rgba(24,20,17,${(0.55 * (1 - s / steps)).toFixed(3)})`;
          ga.lineWidth = Math.max(0.8, half * 0.012 * (1 - s / steps));
          ga.beginPath(); ga.moveTo(x, y); ga.lineTo(nx, ny); ga.stroke();
          stampHeight((x + nx) * 0.5, (y + ny) * 0.5, half * 0.014, -0.22, 0.4);
          x = nx; y = ny;
        }
      }

      // Raised lip, then the crater itself punched through it. The lip
      // is what catches the sun and makes the hole read as displaced
      // material rather than as paint.
      const lip = ga.createRadialGradient(cx, cy, coreR * 0.8, cx, cy, coreR * 2.1);
      lip.addColorStop(0, "rgba(178,170,155,0.70)");
      lip.addColorStop(0.45, "rgba(150,142,128,0.34)");
      lip.addColorStop(1, "rgba(140,132,118,0)");
      ga.fillStyle = lip;
      ga.beginPath(); ga.arc(cx, cy, coreR * 2.1, 0, Math.PI * 2); ga.fill();
      stampHeight(cx, cy, coreR * 1.9, 0.55, 0.35);

      // Crater: irregular polygon, near black, with a darker pit dot so
      // the centre does not read as a flat disc.
      ga.fillStyle = "rgba(11,9,8,0.97)";
      ga.beginPath();
      for (let i = 0; i <= 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        const r = coreR * (0.78 + arng() * 0.42);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ga.moveTo(x, y); else ga.lineTo(x, y);
      }
      ga.closePath();
      ga.fill();
      stampHeight(cx, cy, coreR * 1.15, -1.6, 0.25);

      ga.fillStyle = "rgba(0,0,0,1)";
      ga.beginPath();
      ga.arc(cx + coreR * 0.1, cy + coreR * 0.08, coreR * 0.45, 0, Math.PI * 2);
      ga.fill();

      ga.restore();
    }

    // Height -> tangent-space normal, by central difference. Tiles are
    // differentiated independently so the seam between them cannot
    // produce a normal that runs across the atlas boundary.
    const normal = document.createElement("canvas");
    normal.width = size; normal.height = size;
    const gn = normal.getContext("2d");
    const image = gn.createImageData(size, size);
    const at = (x, y) => {
      const tx = Math.floor(x / half) * half;
      const ty = Math.floor(y / half) * half;
      const cx = clamp(x, tx, tx + half - 1);
      const cy = clamp(y, ty, ty + half - 1);
      return height[cy * size + cx];
    };
    const strength = size * 0.006;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        image.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        image.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        image.data[i + 3] = 255;
      }
    }
    gn.putImageData(image, 0, 0);

    return { albedo, normal };
  }

  /** One long, soft, ribbed band. Used for tyre tracks, which were
   *  previously drawn with the BULLET HOLE sprite at 0.62m across - a
   *  metre-wide glowing ring under every moving vehicle. */
  function buildTrackTexture(size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const trng = makeRng(ctx.seed ^ 0x5aa1);
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      const v = y / size;
      // Two ruts, softened at the ends so a run of stamps blends.
      const lug = 0.55 + 0.45 * Math.sin(v * Math.PI * 14);
      for (let x = 0; x < size; x += 1) {
        const u = x / size - 0.5;
        const across = Math.exp(-(u * u) / 0.055);
        const along = Math.min(1, Math.sin(v * Math.PI) * 1.6);
        const grain = 0.75 + trng() * 0.25;
        const a = clamp01(across * along * lug * grain) * 200;
        const i = (y * size + x) * 4;
        image.data[i] = 96; image.data[i + 1] = 84; image.data[i + 2] = 68;
        image.data[i + 3] = a;
      }
    }
    g.putImageData(image, 0, 0);
    return canvas;
  }

  const impactAtlas = buildImpactAtlas(512);
  const impactMap = new THREE.CanvasTexture(impactAtlas.albedo);
  impactMap.colorSpace = THREE.SRGBColorSpace;
  impactMap.anisotropy = render.anisotropy;
  const impactNormal = new THREE.CanvasTexture(impactAtlas.normal);
  impactNormal.anisotropy = render.anisotropy;
  const trackMap = new THREE.CanvasTexture(buildTrackTexture());
  trackMap.colorSpace = THREE.SRGBColorSpace;
  trackMap.anisotropy = render.anisotropy;

  /**
   * Per-instance atlas tile plus per-instance alpha, in one patch.
   *
   * Three has no built-in way to give instances different UVs. Two
   * floats of vertex attribute and a UV remap in the vertex shader is
   * the whole cost of four decal variants sharing one draw call.
   */
  function withDecalAtlas(material, tiles) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute float instanceAlpha;\nattribute float instanceTile;\n"
        + "varying float vAlphaI;\n"
        + shader.vertexShader
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\n\tvAlphaI = instanceAlpha;"
          )
          .replace(
            "#include <uv_vertex>",
            "#include <uv_vertex>\n"
            + `\tfloat bsTile = instanceTile;\n`
            + `\tvec2 bsCell = vec2(mod(bsTile, ${tiles.toFixed(1)}), floor(bsTile / ${tiles.toFixed(1)}));\n`
            + `\tvMapUv = (vMapUv + bsCell) / ${tiles.toFixed(1)};\n`
            + `\t#ifdef USE_NORMALMAP\n\tvNormalMapUv = vMapUv;\n\t#endif\n`
          );
      shader.fragmentShader = "varying float vAlphaI;\n"
        + shader.fragmentShader.replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n\tdiffuseColor.a *= vAlphaI;"
        );
    };
    material.customProgramCacheKey = () => `bs-decal-atlas-${tiles}`;
    return material;
  }

  function makeDecalMesh(options) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const budget = options.budget;
    geometry.setAttribute("instanceAlpha",
      new THREE.InstancedBufferAttribute(new Float32Array(budget).fill(1), 1));
    geometry.setAttribute("instanceTile",
      new THREE.InstancedBufferAttribute(new Float32Array(budget), 1));
    const material = new THREE.MeshStandardMaterial({
      map: options.map,
      normalMap: options.normalMap || null,
      roughness: options.roughness ?? 0.95,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: options.offset,
      polygonOffsetUnits: options.offset,
      dithering: true,
    });
    if (options.normalMap) material.normalScale.setScalar(options.normalScale ?? 1.5);
    withDecalAtlas(material, options.tiles || 1);
    const mesh = new THREE.InstancedMesh(geometry, material, budget);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(budget * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.qaOpaque = false;
    group.add(mesh);
    return mesh;
  }

  const decalMesh = makeDecalMesh({
    map: impactMap, normalMap: impactNormal, tiles: 2, budget: DECAL_BUDGET,
    offset: -6, normalScale: 1.6,
  });
  const scorchMesh = makeDecalMesh({
    map: textures.sprites.scorch, tiles: 1, budget: SCORCH_BUDGET, offset: -8,
    roughness: 0.99,
  });
  const trackMesh = makeDecalMesh({
    map: trackMap, tiles: 1, budget: TRACK_BUDGET, offset: -4, roughness: 1.0,
  });
  let decalCursor = 0;
  let scorchCursor = 0;
  let trackCursor = 0;

  const _decalUp = new THREE.Vector3(0, 0, 1);
  const _decalQuat = new THREE.Quaternion();
  const _decalScale = new THREE.Vector3();
  const _decalPos = new THREE.Vector3();
  const _rollQuat = new THREE.Quaternion();

  function placeDecal(mesh, cursor, budget, point, normal, size, colour, options = {}) {
    // Orient to the surface, then roll about the normal. The atlas is
    // deliberately asymmetric, which is what makes the roll visible -
    // rolling the old radially symmetric ring changed nothing.
    _decalQuat.setFromUnitVectors(_decalUp, normal);
    _rollQuat.setFromAxisAngle(_decalUp, options.roll ?? rng() * Math.PI * 2);
    _decalQuat.multiply(_rollQuat);
    // 2.5mm, not 12mm. Beyond about 4mm the quad is visibly a separate
    // object hovering in front of the wall at contact range, and the
    // polygon offset is doing the z-fighting work anyway.
    _decalPos.copy(point).addScaledVector(normal, options.lift ?? 0.0025);
    _decalScale.set(size * (options.aspect ?? 1), size, size);
    _m.compose(_decalPos, _decalQuat, _decalScale);
    mesh.setMatrixAt(cursor, _m);
    _colour.set(colour);
    mesh.setColorAt(cursor, _colour);
    const tiles = mesh.geometry.attributes.instanceTile;
    tiles.array[cursor] = options.tile ?? 0;
    tiles.needsUpdate = true;
    const alphas = mesh.geometry.attributes.instanceAlpha;
    alphas.array[cursor] = options.alpha ?? 1;
    alphas.needsUpdate = true;
    mesh.count = Math.min(mesh.count + 1, budget);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return (cursor + 1) % budget;
  }

  function addDecal(point, normal, size = 0.08, colour = 0xb0aaa0) {
    if (DECAL_BUDGET === 0) return;
    decalCursor = placeDecal(decalMesh, decalCursor, DECAL_BUDGET, point, normal, size, colour, {
      tile: Math.floor(rng() * 4),
    });
  }

  function addScorch(point, normal, size = 2.4) {
    if (SCORCH_BUDGET === 0) return;
    scorchCursor = placeDecal(scorchMesh, scorchCursor, SCORCH_BUDGET, point, normal, size,
      0xffffff, { lift: 0.02 });
  }

  /** A tyre print, aligned to the direction of travel. */
  function addTrack(point, normal, heading, width = 0.34) {
    if (TRACK_BUDGET === 0) return;
    trackCursor = placeDecal(trackMesh, trackCursor, TRACK_BUDGET, point, normal, width * 2.6,
      0x8a7860, { roll: heading, aspect: 1 / 2.6, lift: 0.015, alpha: 0.85 });
  }

  /* ------------------------- muzzle flash ------------------------- */

  const FLASH_BUDGET = 10;
  const flashMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: textures.sprites.flash,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }));
  const flashMesh = instancedQuad(flashMaterial, FLASH_BUDGET);

  // The cone is what gives a flash depth. A billboard alone reads as a
  // sticker the moment the shooter is seen from the side, which is
  // exactly the angle every other player sees them from.
  const coneMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const coneGeometry = new THREE.ConeGeometry(0.5, 1, 6, 1, true);
  coneGeometry.rotateX(Math.PI / 2);
  coneGeometry.translate(0, 0, -0.5);
  coneGeometry.setAttribute("instanceAlpha",
    new THREE.InstancedBufferAttribute(new Float32Array(FLASH_BUDGET), 1));
  withInstanceAlpha(coneMaterial);
  const coneMesh = new THREE.InstancedMesh(coneGeometry, coneMaterial, FLASH_BUDGET);
  coneMesh.frustumCulled = false;
  coneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coneMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(FLASH_BUDGET * 3), 3);
  coneMesh.count = 0;
  coneMesh.userData.qaOpaque = false;
  group.add(coneMesh);

  const flashes = makePool(() => ({
    active: false,
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, 1),
    life: 0,
    maxLife: 0.05,
    flare: 0.3,
    cone: 0.24,
    roll: 0,
    colour: new THREE.Color(0xffd7a2),
  }), FLASH_BUDGET, (f) => { f.active = false; });

  /**
   * Two permanent dynamic lights, never added or removed.
   *
   * Adding a light to a scene changes the shader define set and forces
   * every material in it to recompile - a hitch on the first shot of
   * every firefight. They live here at zero intensity instead, and the
   * brightest event of the frame claims them.
   */
  const flashLight = new THREE.PointLight(0xffcb85, 0, 18, 2);
  flashLight.castShadow = false;
  group.add(flashLight);
  const blastLight = new THREE.PointLight(0xffa14a, 0, 40, 2);
  blastLight.castShadow = false;
  group.add(blastLight);
  // Sustained fire gets its own light rather than borrowing the blast
  // slot: a burning wreck lights the ground around it for a minute,
  // and a blast light decaying at e^-7t is dark after half a second.
  const fireLight = new THREE.PointLight(0xff7a28, 0, 30, 2);
  fireLight.castShadow = false;
  group.add(fireLight);

  /* ------------------------------ fire ------------------------------ */

  /**
   * A burning vehicle.
   *
   * Three separate populations, because a flame that is one population
   * is a cartoon tongue:
   *
   *   body    additive, orange, short-lived, rising fast and shearing
   *   core    additive, near-white, small, the part that looks HOT
   *   column  normally-blended soot, long-lived, growing, drifting -
   *           the thing that makes a wreck visible from 300m
   *
   * Every additive colour here keeps G below R and B below G. That
   * ordering is not decorative: additive blending sums into whatever is
   * behind it, and a flame whose green channel can overtake its red
   * turns lime the moment it is drawn over a bright or cool background.
   *
   * `strength` is 0..1. `dt` is the caller's frame time - the emitter
   * meters itself so callers can just call this every frame.
   */
  const FLAME_BUDGET = Math.max(32, Math.round(PARTICLE_BUDGET * 0.16));
  const flameMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: buildFlameSprite(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }));
  const flameMesh = instancedQuad(flameMaterial, FLAME_BUDGET);
  const flames = makeParticlePool(FLAME_BUDGET);

  function buildFlameSprite(size = 128) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const frng = makeRng(ctx.seed ^ 0x0f14);
    const image = g.createImageData(size, size);
    // Canvas row 0 is the TOP of the image, and a CanvasTexture flips
    // Y, so row 0 ends up at the top of the quad - which is the end the
    // velocity-aligned billboard points along travel. That end is the
    // wisp; the base is fat, bright and nearly white.
    for (let y = 0; y < size; y += 1) {
      const v = y / (size - 1);
      const width = 0.055 + 0.44 * v ** 0.7;
      const taper = clamp01(v * 2.6) * (1 - 0.55 * clamp01((v - 0.86) / 0.14));
      for (let x = 0; x < size; x += 1) {
        const u = x / (size - 1) - 0.5;
        const across = clamp01(1 - Math.abs(u) / width);
        const wisp = 0.74 + frng() * 0.26;
        const a = clamp01(across ** 1.6 * taper * wisp);
        // Hot only deep in the base: a flame that is white all the way
        // to the tip reads as a light bulb.
        const hot = clamp01(across * clamp01((v - 0.45) / 0.55)) ** 1.4;
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 132 + hot * 112;
        image.data[i + 2] = 26 + hot * 168;
        image.data[i + 3] = a * 255;
      }
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = render.anisotropy;
    return texture;
  }

  // Emitters register themselves by calling fire(); the strongest one
  // within range of the camera claims the light. Cleared every frame.
  let fireClaim = 0;
  const _fireAt = new THREE.Vector3();
  let fireFlicker = 0;
  const fireTimers = new Map();

  function fire(position, strength = 1, dt = 1 / 60, key = 0) {
    const s = clamp01(strength);
    if (s <= 0.01) return;
    const scale = q.particleBudget >= 900 ? 1 : 0.5;

    if (s > fireClaim) {
      fireClaim = s;
      _fireAt.copy(position);
    }

    // One accumulator per emitter, so two burning vehicles do not steal
    // each other's emission budget.
    let timer = (fireTimers.get(key) || 0) - dt;
    if (timer > 0) { fireTimers.set(key, timer); return; }
    timer = 0.055 / Math.max(0.25, s * scale);
    fireTimers.set(key, timer);

    /* ---- body ---- */
    // Several overlapping tongues per beat, at a wide spread of size
    // and stretch. One tongue per beat at a fixed aspect is what makes
    // a fire read as a row of traffic cones: real flame is a crowd of
    // sheets at every scale, and the crowd is the effect.
    const bodyCount = 2 + Math.round(s * 3 * scale);
    for (let i = 0; i < bodyCount; i += 1) {
      const fat = rng.chance(0.45);
      spawnFrom(flames, {
        position: _v.copy(position).add(
          _axisX.set(rng.gauss() * 0.42 * s, rng.range(-0.15, 0.35) * s, rng.gauss() * 0.42 * s)
        ),
        // Shear: a flame leans and twists as it climbs, it does not go
        // straight up. This is most of what separates fire from a
        // column of orange sprites.
        velocity: _v2.set(rng.gauss() * 1.15, rng.range(2.2, 5.0) * (0.6 + s), rng.gauss() * 1.15),
        colour: fat ? 0xff9a34 : 0xffc262,
        colourEnd: fat ? 0x6e1400 : 0x9c2400,
        size: (fat ? rng.range(0.55, 1.15) : rng.range(0.28, 0.62)) * (0.55 + s * 0.7),
        sizeGrowth: fat ? 1.35 : 0.7,
        stretch: fat ? rng.range(1.05, 1.45) : rng.range(1.4, 2.1),
        life: rng.range(0.26, 0.66),
        drag: 1.7,
        gravity: -2.2,
        alpha: fat ? 0.40 : 0.62,
        fadeIn: 0.14,
        wobble: 2.6,
      });
    }

    /* ---- hot core ---- */
    if (rng.chance(0.7)) {
      spawnFrom(sparks, {
        position: _v.copy(position).add(
          _axisX.set(rng.gauss() * 0.16 * s, rng.range(-0.05, 0.12), rng.gauss() * 0.16 * s)
        ),
        velocity: _v2.set(rng.gauss() * 0.5, rng.range(1.8, 3.4), rng.gauss() * 0.5),
        colour: 0xfff0c6,
        colourEnd: 0xff5a10,
        size: rng.range(0.16, 0.36) * (0.5 + s),
        sizeGrowth: 1.2,
        life: rng.range(0.16, 0.30),
        drag: 1.8,
        gravity: -1.4,
        alpha: 0.85,
        fadeIn: 0.05,
      });
    }

    /* ---- embers ---- */
    if (rng.chance(0.5 * s)) {
      spawnFrom(sparks, {
        position,
        velocity: _v2.set(rng.gauss() * 1.4, rng.range(3.5, 8.0), rng.gauss() * 1.4),
        colour: 0xffca7a,
        colourEnd: 0xd02800,
        size: rng.range(0.02, 0.05),
        sizeGrowth: -0.4,
        stretch: 3.0,
        life: rng.range(0.9, 2.0),
        drag: 0.55,
        gravity: -1.2,
        fadeIn: 0.05,
      });
    }

    /* ---- smoke column ---- */
    if (rng.chance(0.85)) {
      spawnFrom(smoke, {
        position: _v.copy(position).add(_axisX.set(rng.gauss() * 0.3, 0.6 * s, rng.gauss() * 0.3)),
        // Rises then flattens out. The drag term is low so the plume
        // keeps climbing for its whole life instead of stalling at 5m,
        // which is what turns a puff into a column.
        velocity: _v2.set(rng.gauss() * 0.6 + 0.7, rng.range(3.0, 5.5) * (0.6 + s), rng.gauss() * 0.6),
        colour: 0x30291f,
        colourEnd: 0x171512,
        size: rng.range(0.9, 1.7) * (0.6 + s),
        sizeGrowth: 5.5,
        life: rng.range(4.5, 8.5),
        drag: 0.42,
        gravity: -0.55,
        alpha: 0.72,
        fadeIn: 0.09,
        wobble: 0.55,
        spin: rng.range(-0.5, 0.5),
      });
    }

    /* ---- heat shimmer above the flame ---- */
    if (hazeAmount > 0 && rng.chance(0.45)) {
      spawnFrom(smoke, {
        position: _v.copy(position).add(_axisX.set(rng.gauss() * 0.4, 1.4 + rng() * 1.4, rng.gauss() * 0.4)),
        velocity: _v2.set(rng.gauss() * 0.2, rng.range(2.0, 3.6), rng.gauss() * 0.2),
        colour: 0xffe8cc,
        size: rng.range(0.7, 1.5),
        sizeGrowth: 2.6,
        life: rng.range(0.5, 1.0),
        drag: 1.0,
        gravity: -1.6,
        alpha: 0.055 * hazeAmount,
        fadeIn: 0.25,
        wobble: 5.5,
      });
    }
  }

  /* ---------------------------- heat haze ---------------------------- */

  /**
   * Heat shimmer.
   *
   * True refraction needs the composed frame as a texture, and the
   * composed frame belongs to render.js - nothing outside it can sample
   * the screen. What is available is a very low-alpha, strongly wobbling
   * veil of warm air, which is what the eye actually reads as heat at
   * distance: a soft vertical disturbance, not a lens.
   *
   * High and ultra only, and deliberately near the threshold of
   * visibility - haze that announces itself looks like fog.
   */
  const hazeEnabled = q.volumetricLight;
  let hazeAmount = hazeEnabled ? 1 : 0;
  let hazeClock = 0;

  /* ---------------------------- spawning ---------------------------- */

  function spawnFrom(pool, options) {
    const p = pool.acquire();
    if (!p) return null;
    p.active = true;
    p.position.copy(options.position);
    if (options.velocity) p.velocity.copy(options.velocity);
    else p.velocity.set(0, 0, 0);
    p.colour.set(options.colour ?? 0xffffff);
    if (options.colourEnd !== undefined) {
      p.colourEnd.set(options.colourEnd);
      p.hasColourEnd = true;
    } else {
      p.hasColourEnd = false;
    }
    p.size = options.size ?? 0.4;
    p.sizeGrowth = options.sizeGrowth ?? 0;
    p.stretch = options.stretch ?? 1;
    p.life = 0;
    p.maxLife = options.life ?? 1;
    p.drag = options.drag ?? 1.4;
    p.gravity = options.gravity ?? 0;
    p.fadeIn = options.fadeIn ?? 0.08;
    p.alpha = options.alpha ?? 1;
    p.rotation = options.rotation ?? rng.range(0, Math.PI * 2);
    p.spin = options.spin ?? rng.range(-1.4, 1.4);
    p.wobble = options.wobble ?? 0;
    p.floor = options.floor ?? -Infinity;
    return p;
  }

  /** Back-compatible entry point. `additive` picks the pool. */
  function spawnParticle(options) {
    return spawnFrom(options.additive ? sparks : smoke, options);
  }

  function spawnDebris(options) {
    const d = debris.acquire();
    if (!d) return null;
    d.active = true;
    d.position.copy(options.position);
    d.velocity.copy(options.velocity);
    d.spin.set(rng.range(-16, 16), rng.range(-16, 16), rng.range(-16, 16));
    d.angle.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
    const s = options.size ?? 0.03;
    if (options.shape === "splinter") d.scale.set(s * 0.28, s * 0.28, s * 2.6);
    else if (options.shape === "flake") d.scale.set(s * 1.2, s * 0.3, s * 1.2);
    else d.scale.set(s, s * rng.range(0.7, 1.2), s * rng.range(0.7, 1.2));
    d.colour.set(options.colour ?? 0x888888);
    d.life = 0;
    d.maxLife = options.life ?? rng.range(1.1, 2.2);
    d.bounces = 0;
    return d;
  }

  /* ------------------------------ api ------------------------------ */

  const api = {
    group,
    SURFACE_FX,

    /** A bullet in flight, drawn from the muzzle to where it lands. */
    tracer(origin, direction, distance, options = {}) {
      const t = tracers.acquire();
      if (!t) return null;
      t.active = true;
      t.origin.copy(origin);
      t.direction.copy(direction).normalize();
      t.speed = options.speed ?? 880;
      t.travelled = 0;
      t.maxDistance = distance;
      t.length = options.length ?? 11;
      t.width = options.width ?? 0.035;
      t.colour.set(options.colour ?? 0xffc65c);
      t.life = 0;
      return t;
    },

    /**
     * Muzzle flash: a billboard star, a three-dimensional cone, a
     * dynamic light and a wisp of smoke. `options.weapon` selects the
     * per-weapon signature.
     */
    muzzleFlash(position, direction, scale = 1, options = {}) {
      const sig = MUZZLE[options.weapon] || MUZZLE.default;
      const f = flashes.acquire();
      if (f) {
        f.active = true;
        f.position.copy(position);
        f.direction.copy(direction).normalize();
        f.life = 0;
        f.maxLife = 0.042 + rng() * 0.022;
        f.flare = sig.flare * scale * rng.range(0.82, 1.24);
        f.cone = sig.cone * scale * rng.range(0.8, 1.3);
        f.roll = rng.range(0, Math.PI * 2);
        f.colour.set(sig.colour);
      }

      // The light claims the slot only if it is brighter than whatever
      // is currently using it, so a distant bot cannot steal the
      // player's own muzzle light.
      const intensity = sig.light * scale;
      if (intensity >= flashLight.intensity) {
        flashLight.position.copy(position).addScaledVector(direction, 0.35);
        flashLight.color.set(sig.colour);
        flashLight.intensity = intensity;
      }

      // Powder smoke. The thing that makes sustained fire read as a
      // weapon rather than a strobe.
      for (let i = 0; i < sig.smoke; i += 1) {
        spawnFrom(smoke, {
          position: _v.copy(position).addScaledVector(direction, 0.12 + i * 0.09),
          velocity: _v2.copy(direction).multiplyScalar(rng.range(1.6, 3.6))
            .add(_axisX.set(rng.gauss() * 0.4, rng.range(0.35, 1.0), rng.gauss() * 0.4)),
          colour: 0xa39c90,
          colourEnd: 0x6d675e,
          size: rng.range(0.09, 0.19),
          sizeGrowth: 2.2,
          life: rng.range(0.4, 0.85),
          drag: 3.4,
          gravity: 0.6,
          alpha: 0.5,
          wobble: 0.6,
        });
      }

      // Barrel heat. Only ever a few instances, and only where the
      // player is already looking.
      if (hazeAmount > 0 && rng.chance(0.5)) {
        spawnFrom(smoke, {
          position: _v.copy(position).addScaledVector(direction, -0.06),
          velocity: _v2.set(rng.gauss() * 0.12, rng.range(0.5, 1.1), rng.gauss() * 0.12),
          colour: 0xfff2e0,
          size: rng.range(0.07, 0.13),
          sizeGrowth: 3.4,
          life: rng.range(0.35, 0.6),
          drag: 1.4,
          gravity: -0.5,
          alpha: 0.075 * hazeAmount,
          fadeIn: 0.2,
          wobble: 3.4,
        });
      }
    },

    /** Impact: dust, spall, sparks, debris and a decal, chosen by
     *  surface. `energy` is 0..1 - a spent round makes a smaller mess. */
    impact(point, normal, surface = SURFACE.SAND, energy = 1) {
      const fx = SURFACE_FX[surface] || SURFACE_FX[SURFACE.SAND];
      const e = clamp01(energy);

      /* ---- dust plume ---- */
      if (fx.dust > 0.02) {
        const count = Math.round(lerp(1, 5, fx.dust) * lerp(0.5, 1, e));
        for (let i = 0; i < count; i += 1) {
          spawnFrom(smoke, {
            position: _v.copy(point).addScaledVector(normal, 0.04),
            velocity: _v2.copy(normal).multiplyScalar(rng.range(0.9, 2.6) * fx.dustRise)
              .add(_axisX.set(rng.gauss() * 0.8, rng.range(0.15, 1.0), rng.gauss() * 0.8)),
            colour: fx.dustColour,
            colourEnd: fx.dustColour,
            size: rng.range(0.14, 0.34) * lerp(0.6, 1, e),
            sizeGrowth: 2.4,
            life: fx.dustLife * rng.range(0.7, 1.25),
            drag: 2.2,
            gravity: 0.9,
            alpha: lerp(0.35, 0.8, fx.dust),
            wobble: 0.4,
            floor: point.y - 0.05,
          });
        }
      }

      /* ---- spall: the fast cone thrown back along the incoming ray ---- */
      if (fx.spall > 0.05) {
        const count = Math.round(3 * fx.spall * lerp(0.4, 1, e));
        for (let i = 0; i < count; i += 1) {
          spawnFrom(smoke, {
            position: _v.copy(point).addScaledVector(normal, 0.02),
            velocity: _v2.copy(normal).multiplyScalar(rng.range(3.5, 8.5))
              .add(_axisX.set(rng.gauss() * 1.4, rng.gauss() * 1.0, rng.gauss() * 1.4)),
            colour: fx.dustColour,
            size: rng.range(0.05, 0.13),
            sizeGrowth: 4.5,
            life: rng.range(0.18, 0.36),
            drag: 5.5,
            gravity: 1.2,
            alpha: 0.5,
            fadeIn: 0.02,
          });
        }
      }

      /* ---- sparks ---- */
      if (fx.sparks > 0) {
        const count = Math.round(fx.sparks * lerp(0.35, 1, e));
        for (let i = 0; i < count; i += 1) {
          _v2.copy(normal)
            .add(_axisX.set(rng.gauss(), rng.gauss(), rng.gauss()).multiplyScalar(0.8))
            .normalize()
            .multiplyScalar(rng.range(4, 15));
          spawnFrom(sparks, {
            position: point,
            velocity: _v2,
            // Hot sparks start near white and cool through orange as
            // they fall. A spark that stays one colour reads as a dot.
            colour: 0xfff3d2,
            colourEnd: 0xff5a12,
            size: rng.range(0.012, 0.034) * lerp(0.6, 1, fx.sparkHeat),
            sizeGrowth: -0.35,
            stretch: 4.5,
            life: rng.range(0.14, 0.46),
            drag: 0.9,
            gravity: 13,
            fadeIn: 0.01,
          });
        }
      }

      /* ---- solid debris ---- */
      if (fx.debris > 0 && DEBRIS_BUDGET > 0) {
        const count = Math.round(fx.debris * lerp(0.35, 1, e) * (q.particleBudget >= 900 ? 1 : 0.5));
        for (let i = 0; i < count; i += 1) {
          _v2.copy(normal)
            .add(_axisX.set(rng.gauss(), rng.gauss(), rng.gauss()).multiplyScalar(0.7))
            .normalize()
            .multiplyScalar(rng.range(2.2, 6.5));
          spawnDebris({
            position: point,
            velocity: _v2,
            colour: fx.debrisColour,
            size: rng.range(0.015, 0.038) * fx.debrisScale,
            shape: fx.debrisShape,
            life: rng.range(0.9, 2.0),
          });
        }
      }

      if (fx.decal) {
        addDecal(point, normal,
          rng.range(fx.decalSize[0], fx.decalSize[1]) * lerp(0.7, 1, e),
          fx.decalColour);
      }
    },

    /** A shell case leaving the ejection port. */
    ejectShell(position, velocity, options = {}) {
      const c = casings.acquire();
      if (!c) return null;
      c.active = true;
      c.position.copy(position);
      c.velocity.copy(velocity);
      c.spin.set(rng.range(-26, 26), rng.range(-20, 20), rng.range(-26, 26));
      c.angle.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      c.scale = options.calibre ?? 1;
      c.life = 0;
      c.maxLife = 4.5;
      c.bounces = 0;
      c.resting = false;
      return c;
    },

    /** Explosion: flash, fireball that becomes smoke, ground dust ring,
     *  debris and a scorch. */
    explosion(position, radius = 6, options = {}) {
      const power = clamp(radius / 6, 0.5, 3);
      const scale = q.particleBudget >= 900 ? 1 : 0.45;

      blastLight.position.copy(position);
      blastLight.color.set(0xffb066);
      blastLight.intensity = 260 * power;

      const f = flashes.acquire();
      if (f) {
        f.active = true;
        f.position.copy(position);
        f.direction.set(0, 1, 0);
        f.life = 0;
        f.maxLife = 0.12;
        f.flare = radius * 0.55;
        f.cone = 0;
        f.roll = rng.range(0, 6.28);
        f.colour.set(0xfff0c0);
      }

      // Fireball. Additive so it genuinely glows, and it hands over to
      // the smoke pool rather than trying to be both.
      for (let i = 0; i < Math.round(16 * power * scale); i += 1) {
        _v.set(rng.gauss(), Math.abs(rng.gauss()) * 0.7 + 0.25, rng.gauss()).normalize();
        _v2.copy(_v).multiplyScalar(rng.range(3, 12) * power);
        spawnFrom(sparks, {
          position: _axisX.copy(position).addScaledVector(_v, rng.range(0, radius * 0.3)),
          velocity: _v2,
          colour: 0xffd070,
          colourEnd: 0xd23000,
          size: rng.range(0.55, 1.5) * power,
          sizeGrowth: 2.4,
          life: rng.range(0.22, 0.5),
          drag: 2.8,
          gravity: -3.0,
          fadeIn: 0.015,
        });
      }
      // Smoke column: starts hot, cools to soot. This ramp is the whole
      // fireball-to-smoke lifecycle and it costs one colour lerp.
      for (let i = 0; i < Math.round(20 * power * scale); i += 1) {
        _v.set(rng.gauss() * 0.7, Math.abs(rng.gauss()) + 0.4, rng.gauss() * 0.7).normalize();
        _v2.copy(_v).multiplyScalar(rng.range(2, 8) * power);
        spawnFrom(smoke, {
          position,
          velocity: _v2,
          colour: 0x7a5236,
          colourEnd: 0x24211e,
          size: rng.range(0.9, 2.2) * power,
          sizeGrowth: 3.2,
          life: rng.range(1.8, 3.6),
          drag: 1.2,
          gravity: -0.7,
          alpha: 0.85,
          fadeIn: 0.06,
          wobble: 0.5,
        });
      }
      // Ground dust ring: flat, fast and wide. This is the part that
      // communicates the blast radius.
      const ringCount = Math.round(22 * power * scale);
      for (let i = 0; i < ringCount; i += 1) {
        const a = (i / ringCount) * Math.PI * 2 + rng.range(-0.18, 0.18);
        _v2.set(Math.cos(a), rng.range(0.03, 0.22), Math.sin(a))
          .multiplyScalar(rng.range(7, 17) * power);
        spawnFrom(smoke, {
          position,
          velocity: _v2,
          colour: 0xc9b593,
          colourEnd: 0x9c8a6c,
          size: rng.range(0.6, 1.5) * power,
          sizeGrowth: 3.4,
          life: rng.range(1.0, 2.3),
          drag: 2.3,
          gravity: 0.3,
          alpha: 0.72,
          floor: position.y - 0.4,
        });
      }
      // Debris.
      for (let i = 0; i < Math.round(14 * power * scale); i += 1) {
        _v2.set(rng.gauss(), Math.abs(rng.gauss()) * 1.4 + 0.3, rng.gauss())
          .normalize().multiplyScalar(rng.range(6, 17) * power);
        spawnDebris({
          position,
          velocity: _v2,
          colour: 0x4a423a,
          size: rng.range(0.03, 0.09) * power,
          shape: rng.chance(0.4) ? "splinter" : "chip",
          life: rng.range(1.4, 2.6),
        });
      }

      if (options.scorch !== false) {
        _v.set(0, 1, 0);
        _v2.copy(position);
        if (ctx.terrain) _v2.y = ctx.terrain.heightAt(position.x, position.z) + 0.03;
        addScorch(_v2, _v, radius * rng.range(0.8, 1.1));
      }

      // No audio here on purpose: vehicles.js and the grenade path both
      // call audio.explosion themselves with their own gain, and playing
      // it from the effect as well doubles every blast.

      if (ctx.player) {
        const distance = position.distanceTo(ctx.player.position);
        const falloff = clamp01(1 - distance / (radius * 6));
        if (falloff > 0.01) {
          ctx.player.addShake(falloff * 1.2);
          ctx.player.addSuppression(falloff * 0.8);
        }
      }
    },

    footstepDust(position, surface, speed) {
      const fx = SURFACE_FX[surface] || SURFACE_FX[SURFACE.SAND];
      if (fx.dust < 0.3 || speed < 3) return;
      spawnFrom(smoke, {
        position,
        velocity: _v2.set(rng.gauss() * 0.4, rng.range(0.2, 0.7), rng.gauss() * 0.4),
        colour: fx.dustColour,
        size: rng.range(0.12, 0.26),
        sizeGrowth: 1.8,
        life: rng.range(0.4, 0.9),
        drag: 3.0,
        gravity: 0.3,
        alpha: 0.45,
        floor: position.y - 0.05,
      });
    },

    spawnParticle,
    spawnDebris,
    addDecal,
    addScorch,
    addTrack,
    fire,

    /** Art-director knob: 0 disables heat shimmer entirely. */
    setHeatHaze(value) { hazeAmount = clamp01(value); },

    update(dt) {
      const camera = render.camera;
      camera.updateMatrixWorld();
      const cm = camera.matrixWorld.elements;
      _camRight.set(cm[0], cm[1], cm[2]).normalize();
      _camUp.set(cm[4], cm[5], cm[6]).normalize();
      const camX = cm[12];
      const camY = cm[13];
      const camZ = cm[14];

      /* ---- tracers ---- */
      let tracerCount = 0;
      const tracerAlpha = tracerMesh.geometry.attributes.instanceAlpha.array;
      const tracerColour = tracerMesh.instanceColor.array;
      for (const t of tracers.items) {
        if (!t.active) continue;
        t.travelled += t.speed * dt;
        if (t.travelled >= t.maxDistance) { tracers.release(t); continue; }

        // Head of the streak, pulled back by half its length so the
        // quad's centre sits behind the round rather than on it.
        const head = t.travelled - t.length * 0.5;
        _v.copy(t.origin).addScaledVector(t.direction, head);

        // Basis: Y along travel, Z toward the eye, X the cross product.
        _axisY.copy(t.direction);
        _v2.set(camX - _v.x, camY - _v.y, camZ - _v.z);
        const along = _v2.dot(_axisY);
        _axisZ.copy(_v2).addScaledVector(_axisY, -along);
        const zLen = _axisZ.length();
        if (zLen < 1e-4) continue;
        _axisZ.multiplyScalar(1 / zLen);
        _axisX.crossVectors(_axisY, _axisZ);

        // Dim with distance and fade the first few metres, so a tracer
        // does not flash across the lens on every shot.
        const near = clamp01(t.travelled / 4.5);
        const far = lerp(1, 0.28, clamp01((zLen - 60) / 240));
        const alpha = near * far;

        composeBasis(_m, _v.x, _v.y, _v.z, _axisX, _axisY, _axisZ,
          t.width, t.length, 1);
        tracerMesh.setMatrixAt(tracerCount, _m);
        tracerColour[tracerCount * 3] = t.colour.r;
        tracerColour[tracerCount * 3 + 1] = t.colour.g;
        tracerColour[tracerCount * 3 + 2] = t.colour.b;
        tracerAlpha[tracerCount] = alpha;
        tracerCount += 1;
      }
      tracerMesh.count = tracerCount;
      tracerMesh.instanceMatrix.needsUpdate = true;
      tracerMesh.instanceColor.needsUpdate = true;
      tracerMesh.geometry.attributes.instanceAlpha.needsUpdate = true;

      /* ---- particles ---- */
      const stepParticles = (pool, mesh) => {
        let count = 0;
        const alphas = mesh.geometry.attributes.instanceAlpha.array;
        const colours = mesh.instanceColor.array;
        for (const p of pool.items) {
          if (!p.active) continue;
          p.life += dt;
          if (p.life >= p.maxLife) { pool.release(p); continue; }

          const t = p.life / p.maxLife;
          p.velocity.y -= p.gravity * dt;
          const decay = Math.exp(-p.drag * dt);
          p.velocity.multiplyScalar(decay);
          p.position.addScaledVector(p.velocity, dt);
          if (p.position.y < p.floor) {
            p.position.y = p.floor;
            p.velocity.y = 0;
            // Dust that has hit the ground spreads instead of stopping.
            p.velocity.x *= 0.96;
            p.velocity.z *= 0.96;
          }
          p.rotation += p.spin * dt;

          const wobble = p.wobble > 0
            ? Math.sin(p.life * 9.5 + p.rotation * 3) * p.wobble * 0.08
            : 0;
          const size = p.size * (1 + p.sizeGrowth * t) * (1 + wobble);

          // Fade in fast, out slow. A particle that pops in at full
          // opacity reads as a sprite; one that fades in reads as smoke.
          const alpha = Math.min(1, t / Math.max(p.fadeIn, 1e-3))
            * (1 - t * t) * p.alpha;

          if (p.stretch > 1.01) {
            // Velocity-aligned billboard. A spark stretched along the
            // camera's up axis points the wrong way the instant it
            // arcs - the streak has to follow the round, not the eye.
            const speed = p.velocity.length();
            if (speed > 0.05) {
              _axisY.copy(p.velocity).multiplyScalar(1 / speed);
              _axisZ.crossVectors(_axisY, _camRight);
              if (_axisZ.lengthSq() < 1e-6) _axisZ.copy(_camUp);
              _axisZ.normalize();
              _axisX.crossVectors(_axisY, _axisZ);
            } else {
              _axisX.copy(_camRight); _axisY.copy(_camUp);
              _axisZ.crossVectors(_axisX, _axisY);
            }
          } else {
            // Roll the billboard in the camera plane rather than
            // composing a quaternion per particle - this loop runs a few
            // thousand times a frame.
            const c = Math.cos(p.rotation);
            const s = Math.sin(p.rotation);
            _axisX.set(
              _camRight.x * c + _camUp.x * s,
              _camRight.y * c + _camUp.y * s,
              _camRight.z * c + _camUp.z * s
            );
            _axisY.set(
              -_camRight.x * s + _camUp.x * c,
              -_camRight.y * s + _camUp.y * c,
              -_camRight.z * s + _camUp.z * c
            );
            _axisZ.crossVectors(_axisX, _axisY);
          }

          composeBasis(_m, p.position.x, p.position.y, p.position.z,
            _axisX, _axisY, _axisZ, size, size * p.stretch, size);
          mesh.setMatrixAt(count, _m);

          if (p.hasColourEnd) _colour.copy(p.colour).lerp(p.colourEnd, t);
          else _colour.copy(p.colour);
          colours[count * 3] = _colour.r;
          colours[count * 3 + 1] = _colour.g;
          colours[count * 3 + 2] = _colour.b;
          alphas[count] = alpha;
          count += 1;
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.geometry.attributes.instanceAlpha.needsUpdate = true;
        return count;
      };

      stepParticles(smoke, smokeMesh);
      stepParticles(sparks, sparkMesh);
      stepParticles(flames, flameMesh);

      /* ---- debris ---- */
      let debrisCount = 0;
      const debrisColours = debrisMesh.instanceColor.array;
      for (const d of debris.items) {
        if (!d.active) continue;
        d.life += dt;
        if (d.life >= d.maxLife) { debris.release(d); continue; }

        d.velocity.y -= 18 * dt;
        d.position.addScaledVector(d.velocity, dt);
        d.angle.addScaledVector(d.spin, dt);

        const groundY = ctx.terrain ? ctx.terrain.heightAt(d.position.x, d.position.z) : 0;
        if (d.position.y < groundY) {
          d.position.y = groundY;
          d.velocity.y = Math.abs(d.velocity.y) * 0.34;
          d.velocity.x *= 0.55;
          d.velocity.z *= 0.55;
          d.spin.multiplyScalar(0.5);
          d.bounces += 1;
          if (d.bounces > 2) { d.velocity.set(0, 0, 0); d.spin.set(0, 0, 0); }
        }

        // Shrink out at the end of life rather than fading - a lit solid
        // has no alpha channel to fade with.
        const fade = 1 - smoothstep(clamp01((d.life / d.maxLife - 0.75) / 0.25));
        composeTRS(_m, d.position, d.angle, d.scale, fade);
        debrisMesh.setMatrixAt(debrisCount, _m);
        debrisColours[debrisCount * 3] = d.colour.r;
        debrisColours[debrisCount * 3 + 1] = d.colour.g;
        debrisColours[debrisCount * 3 + 2] = d.colour.b;
        debrisCount += 1;
      }
      debrisMesh.count = debrisCount;
      debrisMesh.instanceMatrix.needsUpdate = true;
      debrisMesh.instanceColor.needsUpdate = true;

      /* ---- shell casings ---- */
      let casingCount = 0;
      for (const c of casings.items) {
        if (!c.active) continue;
        c.life += dt;
        if (c.life >= c.maxLife) { casings.release(c); continue; }

        if (!c.resting) {
          c.velocity.y -= 18 * dt;
          c.position.addScaledVector(c.velocity, dt);
          c.angle.addScaledVector(c.spin, dt);

          const groundY = ctx.terrain ? ctx.terrain.heightAt(c.position.x, c.position.z) : 0;
          if (c.position.y < groundY + 0.008) {
            c.position.y = groundY + 0.008;
            c.bounces += 1;
            const speed = c.velocity.length();
            if (c.bounces >= 3 || speed < 0.7) {
              c.resting = true;
              c.velocity.set(0, 0, 0);
              c.spin.set(0, 0, 0);
              // Lie flat once it has stopped.
              c.angle.x = Math.PI / 2;
            } else {
              c.velocity.y = Math.abs(c.velocity.y) * 0.42;
              c.velocity.x *= 0.6;
              c.velocity.z *= 0.6;
              c.spin.multiplyScalar(0.55);
              // Brass on hard ground. Quiet, close, and one of the
              // sounds players never consciously notice but miss.
              if (c.bounces === 1) {
                ctx.audio?.playAt?.("click", c.position, { volume: 0.16 });
              }
            }
          }
        }

        const fade = 1 - smoothstep(clamp01((c.life / c.maxLife - 0.85) / 0.15));
        _v.set(c.scale, c.scale, c.scale);
        composeTRS(_m, c.position, c.angle, _v, fade);
        casingMesh.setMatrixAt(casingCount, _m);
        casingCount += 1;
      }
      casingMesh.count = casingCount;
      casingMesh.instanceMatrix.needsUpdate = true;

      /* ---- muzzle flashes ---- */
      let flashCount = 0;
      let coneCount = 0;
      const flashAlpha = flashMesh.geometry.attributes.instanceAlpha.array;
      const flashColour = flashMesh.instanceColor.array;
      const coneAlpha = coneMesh.geometry.attributes.instanceAlpha.array;
      const coneColour = coneMesh.instanceColor.array;
      for (const f of flashes.items) {
        if (!f.active) continue;
        f.life += dt;
        if (f.life >= f.maxLife) { flashes.release(f); continue; }
        const t = f.life / f.maxLife;
        // A flash is brightest at ignition and collapses; it does not
        // ramp. Squared falloff, not linear.
        const alpha = (1 - t) * (1 - t);

        if (f.flare > 0.001) {
          const c = Math.cos(f.roll);
          const s = Math.sin(f.roll);
          _axisX.set(
            _camRight.x * c + _camUp.x * s,
            _camRight.y * c + _camUp.y * s,
            _camRight.z * c + _camUp.z * s
          );
          _axisY.set(
            -_camRight.x * s + _camUp.x * c,
            -_camRight.y * s + _camUp.y * c,
            -_camRight.z * s + _camUp.z * c
          );
          _axisZ.crossVectors(_axisX, _axisY);
          const size = f.flare * (1 + t * 0.55);
          composeBasis(_m, f.position.x, f.position.y, f.position.z,
            _axisX, _axisY, _axisZ, size, size, size);
          flashMesh.setMatrixAt(flashCount, _m);
          flashColour[flashCount * 3] = f.colour.r;
          flashColour[flashCount * 3 + 1] = f.colour.g;
          flashColour[flashCount * 3 + 2] = f.colour.b;
          flashAlpha[flashCount] = alpha;
          flashCount += 1;
        }

        if (f.cone > 0.001) {
          // Cone along the fire direction, apex at the muzzle.
          _axisZ.copy(f.direction).multiplyScalar(-1);
          _axisX.set(_axisZ.z, 0, -_axisZ.x);
          if (_axisX.lengthSq() < 1e-6) _axisX.set(1, 0, 0);
          _axisX.normalize();
          _axisY.crossVectors(_axisZ, _axisX);
          const width = f.cone * (1 + t * 0.9);
          const length = f.cone * 2.1 * (1 - t * 0.35);
          composeBasis(_m, f.position.x, f.position.y, f.position.z,
            _axisX, _axisY, _axisZ, width, width, length);
          coneMesh.setMatrixAt(coneCount, _m);
          coneColour[coneCount * 3] = f.colour.r;
          coneColour[coneCount * 3 + 1] = f.colour.g;
          coneColour[coneCount * 3 + 2] = f.colour.b;
          coneAlpha[coneCount] = alpha * 0.8;
          coneCount += 1;
        }
      }
      flashMesh.count = flashCount;
      flashMesh.instanceMatrix.needsUpdate = true;
      flashMesh.instanceColor.needsUpdate = true;
      flashMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
      coneMesh.count = coneCount;
      coneMesh.instanceMatrix.needsUpdate = true;
      coneMesh.instanceColor.needsUpdate = true;
      coneMesh.geometry.attributes.instanceAlpha.needsUpdate = true;

      // Lights decay on their own clock: a muzzle flash lasts about a
      // frame at 60fps, so a linear fade would flicker.
      flashLight.intensity *= Math.exp(-dt * 30);
      if (flashLight.intensity < 0.05) flashLight.intensity = 0;
      blastLight.intensity *= Math.exp(-dt * 7);
      if (blastLight.intensity < 0.05) blastLight.intensity = 0;

      /* ---- fire light ----
         The claim is rebuilt every frame by whoever calls fire(), so
         the light follows the strongest fire and goes out on its own
         when nothing is burning. Two sine terms at incommensurate
         rates give a flicker that never repeats audibly-obviously;
         a single sine reads as a pulsing lamp. */
      if (fireClaim > 0.01) {
        fireFlicker += dt;
        const wobble = 0.74
          + 0.20 * Math.sin(fireFlicker * 11.3)
          + 0.10 * Math.sin(fireFlicker * 27.7 + 1.9);
        fireLight.position.copy(_fireAt).addScaledVector(_axisY.set(0, 1, 0), 0.7);
        // Ramp up rather than snap, so a wreck catching fire does not
        // strobe the street on the frame it is destroyed.
        const target = 150 * fireClaim * wobble;
        fireLight.intensity = lerp(fireLight.intensity, target, clamp01(dt * 9));
        fireClaim = 0;
      } else {
        fireLight.intensity *= Math.exp(-dt * 3.5);
        if (fireLight.intensity < 0.05) fireLight.intensity = 0;
      }

      /* ---- hot ground shimmer ---- */
      if (hazeAmount > 0 && ctx.terrain && ctx.player) {
        hazeClock -= dt;
        if (hazeClock <= 0) {
          hazeClock = 0.10;
          // Spawn a couple of very faint cells out along the view
          // direction, where the eye reads distance haze. Close in it
          // would just be fog on the lens.
          for (let i = 0; i < 2; i += 1) {
            const distance = rng.range(28, 95);
            _v.copy(ctx.player.aimDirection);
            _v.y = 0;
            if (_v.lengthSq() < 1e-4) continue;
            _v.normalize();
            const lateral = rng.range(-0.45, 0.45);
            _v2.set(-_v.z, 0, _v.x).multiplyScalar(distance * lateral);
            _axisX.copy(ctx.player.position).addScaledVector(_v, distance).add(_v2);
            _axisX.y = ctx.terrain.heightAt(_axisX.x, _axisX.z) + rng.range(0.1, 1.4);
            spawnFrom(smoke, {
              position: _axisX,
              velocity: _v2.set(rng.gauss() * 0.15, rng.range(0.35, 0.8), rng.gauss() * 0.15),
              colour: 0xfff4e4,
              size: rng.range(2.2, 5.0),
              sizeGrowth: 1.4,
              life: rng.range(1.6, 3.0),
              drag: 0.3,
              gravity: -0.05,
              alpha: 0.045 * hazeAmount,
              fadeIn: 0.35,
              wobble: 2.6,
              spin: rng.range(-0.15, 0.15),
            });
          }
        }
      }
    },

    report() {
      return {
        tracers: tracers.active,
        smoke: smoke.active,
        sparks: sparks.active,
        flames: flames.active,
        debris: debris.active,
        casings: casings.active,
        flashes: flashes.active,
        decals: decalMesh.count,
        scorches: scorchMesh.count,
        tracks: trackMesh.count,
        fireLight: Number(fireLight.intensity.toFixed(1)),
        drawCalls: 11,
      };
    },

    dispose() {
      render.scene.remove(group);
      for (const mesh of [tracerMesh, smokeMesh, sparkMesh, flameMesh, debrisMesh, casingMesh,
        decalMesh, scorchMesh, trackMesh, flashMesh, coneMesh]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const texture of [impactMap, impactNormal, trackMap, tracerSprite]) texture.dispose();
      flameMaterial.map?.dispose();
    },
  };

  return api;
}
